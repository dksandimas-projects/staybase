// BR-12 cut-off helper tripwires. Mirrors the BR-01
// breakfast-cutoff test contract.

import { describe, expect, it } from "vitest";
import { computeOtherAddOnCutoffState, type AddOn } from "@spark-inn/shared";

const addOn = (overrides: Partial<Pick<AddOn, "isEnabled" | "cutoffHoursBeforeCheckIn">> = {}): AddOn => ({
  id: "airport-transfer",
  name: "Airport transfer",
  description: "",
  price: 500,
  unit: "per-person",
  isEnabled: overrides.isEnabled !== false,
  cutoffHoursBeforeCheckIn: overrides.cutoffHoursBeforeCheckIn ?? 24,
  displayOrder: 10,
  updatedAt: new Date().toISOString(),
  updatedBy: "test"
});

describe("BR-12 — computeOtherAddOnCutoffState", () => {
  it("returns isLocked=false when now < cutoff (24h before check-in)", () => {
    // check-in 2026-12-01; cutoff = 2026-11-30 00:00 UTC.
    const now = new Date("2026-11-29T00:00:00Z");
    const s = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn(),
      now
    });
    expect(s.isLocked).toBe(false);
    expect(s.cutoffAt).toBe(new Date("2026-11-30T00:00:00Z").toISOString());
    expect(s.minutesUntilCutoff).toBeGreaterThan(0);
  });

  it("returns isLocked=true with reasonOrCutoff='cutoff-passed' when now > cutoff", () => {
    const now = new Date("2026-11-30T12:00:00Z");
    const s = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn(),
      now
    });
    expect(s.isLocked).toBe(true);
    expect(s.reasonOrCutoff).toBe("cutoff-passed");
    expect(s.minutesUntilCutoff).toBeLessThan(0);
  });

  it("returns isLocked=true with reasonOrCutoff='addons-disabled' when isEnabled === false", () => {
    const now = new Date("2026-11-29T00:00:00Z");
    const s = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn({ isEnabled: false }),
      now
    });
    expect(s.isLocked).toBe(true);
    expect(s.reasonOrCutoff).toBe("addons-disabled");
    expect(s.minutesUntilCutoff).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("computes per-add-on cutoff, NOT a hotel-wide HH:MM", () => {
    // check-in 2026-12-01; 24h cutoff = 2026-11-30 00:00 UTC;
    // 48h cutoff = 2026-11-29 00:00 UTC.
    // now = 2026-11-29 12:00 UTC: between the 48h and 24h
    // cutoffs. The 48h add-on is locked (longer lead =
    // earlier lock), the 24h add-on is still open.
    const now = new Date("2026-11-29T12:00:00Z");
    const s24 = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn({ cutoffHoursBeforeCheckIn: 24 }),
      now
    });
    const s48 = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn({ cutoffHoursBeforeCheckIn: 48 }),
      now
    });
    expect(s24.isLocked).toBe(false);
    expect(s48.isLocked).toBe(true);
  });

  it("treats the cutoff as inclusive (now === cutoffAt → locked)", () => {
    const cutoff = new Date("2026-11-30T00:00:00Z");
    const s = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn(),
      now: cutoff
    });
    expect(s.isLocked).toBe(true);
    expect(s.reasonOrCutoff).toBe("cutoff-passed");
  });

  it("defaults to 24h lead time when cutoffHoursBeforeCheckIn is missing", () => {
    const s = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn({ cutoffHoursBeforeCheckIn: undefined as any }),
      now: new Date("2026-11-29T00:00:00Z")
    });
    expect(s.cutoffAt).toBe(new Date("2026-11-30T00:00:00Z").toISOString());
    expect(s.isLocked).toBe(false);
  });

  it("returns a safe fallback (cutoffAt = now, no lock) for malformed dates", () => {
    const s = computeOtherAddOnCutoffState({
      checkInDate: "not-a-date",
      addOn: addOn(),
      now: new Date("2026-11-29T00:00:00Z")
    });
    expect(s.isLocked).toBe(false);
    expect(typeof s.cutoffAt).toBe("string");
    expect(s.minutesUntilCutoff).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("clamps lead time to 0..168 (server-side safety)", () => {
    const sHigh = computeOtherAddOnCutoffState({
      checkInDate: "2026-12-01",
      addOn: addOn({ cutoffHoursBeforeCheckIn: 9999 }),
      now: new Date("2026-11-20T00:00:00Z")
    });
    // 168h lead = 7 days; now = 11-20 (11 days before check-in)
    // is well inside 7 days, so unlocked.
    expect(sHigh.isLocked).toBe(false);
    // The helper should clamp to 168h, so cutoffAt = 11-24 (7d before)
    expect(new Date(sHigh.cutoffAt).getTime()).toBe(
      Date.parse("2026-11-24T00:00:00Z")
    );
  });
});