import { describe, expect, it } from "vitest";
import {
  parseCheckInTime,
  getCheckInInstant,
  evaluateCancellation,
  createCancellationPolicySnapshot,
  CancellationPolicySnapshot
} from "../utils/cancellation";

describe("cancellation utilities", () => {
  describe("parseCheckInTime", () => {
    it("parses 24h formatted check-in time", () => {
      expect(parseCheckInTime("14:00")).toEqual({ hours: 14, minutes: 0 });
      expect(parseCheckInTime("09:30")).toEqual({ hours: 9, minutes: 30 });
    });

    it("parses 12h formatted check-in time with am/pm", () => {
      expect(parseCheckInTime("2:00 PM")).toEqual({ hours: 14, minutes: 0 });
      expect(parseCheckInTime("12:00 AM")).toEqual({ hours: 0, minutes: 0 });
      expect(parseCheckInTime("12:00 PM")).toEqual({ hours: 12, minutes: 0 });
      expect(parseCheckInTime("11:30 am")).toEqual({ hours: 11, minutes: 30 });
      expect(parseCheckInTime("2 PM")).toEqual({ hours: 14, minutes: 0 });
    });

    it("falls back to standard 14:00 for invalid formats", () => {
      expect(parseCheckInTime("invalid")).toEqual({ hours: 14, minutes: 0 });
      expect(parseCheckInTime("")).toEqual({ hours: 14, minutes: 0 });
    });
  });

  describe("getCheckInInstant", () => {
    it("returns correct Date instant in Asia/Manila (UTC+8)", () => {
      // 2026-08-05 at 14:00:00 in UTC+8 is 2026-08-05 at 06:00:00 UTC (14:00 - 8h)
      const instant = getCheckInInstant("2026-08-05", "14:00", "Asia/Manila");
      expect(instant.toISOString()).toBe("2026-08-05T06:00:00.000Z");
    });

    it("handles standard 12h formats in resolving instant", () => {
      const instant = getCheckInInstant("2026-08-05", "2:00 PM", "Asia/Manila");
      expect(instant.toISOString()).toBe("2026-08-05T06:00:00.000Z");
    });
  });

  describe("evaluateCancellation", () => {
    // Standard setup: check-in is 2026-08-05T06:00:00.000Z (14:00 Manila)
    // Cutoff is 48 hours. Cutoff time is 2026-08-03T06:00:00.000Z
    const checkInTimeStr = "2026-08-05T06:00:00.000Z";
    const cutoffTimeStr = "2026-08-03T06:00:00.000Z";
    const cutoffMs = new Date(cutoffTimeStr).getTime();

    const policy: CancellationPolicySnapshot = {
      cutoffHours: 48,
      refundPctBefore: 100,
      refundPctAfter: 0,
      policyText: "Test policy",
      scheduledCheckInTime: checkInTimeStr,
      source: "settings"
    };

    it("allows full refund exactly at the cutoff limit", () => {
      const res = evaluateCancellation(cutoffMs, policy);
      expect(res.refundPct).toBe(100);
      expect(res.isBeforeCutoff).toBe(true);
      expect(res.hoursRemaining).toBe(48);
    });

    it("allows full refund 1 minute before the cutoff limit (earlier cancellation)", () => {
      const cancellationTime = cutoffMs - 60000; // 1 min before cutoff (48.016 hours before check-in)
      const res = evaluateCancellation(cancellationTime, policy);
      expect(res.refundPct).toBe(100);
      expect(res.isBeforeCutoff).toBe(true);
      expect(res.hoursRemaining).toBeGreaterThan(48);
    });

    it("rejects refund 1 minute after the cutoff limit (late cancellation)", () => {
      const cancellationTime = cutoffMs + 60000; // 1 min after cutoff (47.983 hours before check-in)
      const res = evaluateCancellation(cancellationTime, policy);
      expect(res.refundPct).toBe(0);
      expect(res.isBeforeCutoff).toBe(false);
      expect(res.hoursRemaining).toBeLessThan(48);
    });

    it("supports partial percentages", () => {
      const partialPolicy: CancellationPolicySnapshot = {
        ...policy,
        refundPctBefore: 50.5,
        refundPctAfter: 12.75
      };
      // Before cutoff
      expect(evaluateCancellation(cutoffMs, partialPolicy).refundPct).toBe(50.5);
      // After cutoff
      expect(evaluateCancellation(cutoffMs + 60000, partialPolicy).refundPct).toBe(12.75);
    });

    it("gracefully falls back for legacy bookings (null snapshot)", () => {
      // Fallback context: check-in 2026-08-05, check-in 14:00 (default), Manila timezone
      const res = evaluateCancellation(
        cutoffMs - 60000,
        null,
        {
          checkInDateKey: "2026-08-05",
          checkInTime: "14:00",
          timeZone: "Asia/Manila"
        }
      );
      expect(res.refundPct).toBe(100);
      expect(res.isBeforeCutoff).toBe(true);
      expect(res.policySource).toBe("legacy-fallback");
    });
  });

  describe("createCancellationPolicySnapshot", () => {
    const websiteContent = {
      cancellationCutoffHours: 24,
      cancellationRefundPctBefore: 80,
      cancellationRefundPctAfter: 10,
      cancellationPolicy: "24h policy copy"
    };

    const hotelConfig = {
      checkInTime: "12:00 PM",
      timezone: "Asia/Manila"
    };

    it("creates standard settings snapshot", () => {
      const snap = createCancellationPolicySnapshot({
        websiteContent,
        hotelConfig,
        checkInDateKey: "2026-08-05"
      });

      expect(snap.cutoffHours).toBe(24);
      expect(snap.refundPctBefore).toBe(80);
      expect(snap.refundPctAfter).toBe(10);
      expect(snap.policyText).toBe("24h policy copy");
      expect(snap.scheduledCheckInTime).toBe("2026-08-05T04:00:00.000Z"); // 12 PM Manila - 8h = 4 AM UTC
      expect(snap.source).toBe("settings");
    });

    it("merges corporate overrides if present", () => {
      const corporateCodeData = {
        cancellationCutoffHours: 72,
        cancellationRefundPctBefore: 100,
        cancellationRefundPctAfter: 50,
        cancellationPolicyText: "Corporate override text"
      };

      const snap = createCancellationPolicySnapshot({
        websiteContent,
        hotelConfig,
        checkInDateKey: "2026-08-05",
        corporateCodeData
      });

      expect(snap.cutoffHours).toBe(72);
      expect(snap.refundPctBefore).toBe(100);
      expect(snap.refundPctAfter).toBe(50);
      expect(snap.policyText).toBe("Corporate override text");
      expect(snap.source).toBe("corporate-override");
    });

    it("falls back to standard websiteContent settings for partial corporate overrides", () => {
      const corporateCodeData = {
        cancellationCutoffHours: 72
        // percentages and text omitted
      };

      const snap = createCancellationPolicySnapshot({
        websiteContent,
        hotelConfig,
        checkInDateKey: "2026-08-05",
        corporateCodeData
      });

      expect(snap.cutoffHours).toBe(72);
      expect(snap.refundPctBefore).toBe(80); // inherits settings
      expect(snap.refundPctAfter).toBe(10);  // inherits settings
      expect(snap.policyText).toBe("24h policy copy"); // inherits settings
      expect(snap.source).toBe("corporate-override");
    });
  });
});
