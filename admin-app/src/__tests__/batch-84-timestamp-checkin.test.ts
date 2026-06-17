import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 14 — Booking checkIn/checkOut
// always stored as Firestore Timestamp (audit decision #84 / 2.1 SEV-1 #2).
//
// Before this batch the create / walk-in handlers stored a raw JS Date
// and relied on the Admin SDK's implicit Date → Timestamp conversion. The
// field-write ternary
//   `checkIn: adminDb.doc(`rooms/${roomId}`).firestore.valueType ? checkInDate : checkInDate`
// was a no-op left over from a refactor. Read paths called `.toDate()`
// directly, which throws if a legacy document ever stored an ISO string.
//
// The batch:
//   * Replaces the no-op ternary with an explicit
//     `Timestamp.fromDate(checkInDate)` write in both handleCreateBooking
//     and handleCreateWalkin.
//   * Adds `toDateOrNull` / `toDateOrNow` helpers in `shared/utils/bookingDates.ts`
//     so read paths handle Date | Timestamp | {_seconds, _nanoseconds} | string
//     without crashing.
//   * Switches the two overlap checks (one in handleCreateBooking, one in
//     handleCreateWalkin) to call `toDateOrNull(data.checkIn)` and bail
//     when the value is unparseable (legacy ISO docs become inert).

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);
const helperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingDates.ts"),
  "utf8"
);
const bookingTypeSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

describe("Phase 11.6 Batch 14 — booking checkIn/checkOut are always Firestore Timestamps", () => {
  describe("shared/utils/bookingDates helper is exported and shape-aware", () => {
    it("is exported from the shared barrel", () => {
      expect(sharedIndexSrc).toMatch(/export\s+\*\s+from\s+["']\.\/utils\/bookingDates["']/);
    });

    it("exports toDateOrNull + toDateOrNow", () => {
      expect(helperSrc).toMatch(/export\s+function\s+toDateOrNull\(/);
      expect(helperSrc).toMatch(/export\s+function\s+toDateOrNow\(/);
    });

    it("toDateOrNull accepts a Firestore Timestamp (calls .toDate())", () => {
      const fn = readFileSync(
        resolve(__dirname, "../../../shared/utils/bookingDates.ts"),
        "utf8"
      );
      expect(fn).toMatch(/typeof\s+\(value as \{ toDate\?:\s*unknown \}\)\.toDate\s*===\s*["']function["']/);
    });

    it("toDateOrNull accepts a Firestore raw object ({ _seconds, _nanoseconds })", () => {
      expect(helperSrc).toMatch(/typeof\s+obj\._seconds\s*===\s*["']number["']/);
    });

    it("toDateOrNull accepts an ISO date string and returns a real Date", () => {
      expect(helperSrc).toMatch(/typeof\s+value\s*===\s*["']string["']\s*\|\|\s*typeof\s+value\s*===\s*["']number["']/);
    });

    it("toDateOrNow returns `new Date()` for null / undefined input", () => {
      expect(helperSrc).toMatch(/function\s+toDateOrNow\([\s\S]*?return\s+d\s*\?\?\s*new\s+Date\(\)/);
    });
  });

  describe("handleCreateBooking + handleCreateWalkin write Timestamp.fromDate(...)", () => {
    it("imports Timestamp from firebase-admin/firestore", () => {
      expect(bookingsSrc).toMatch(/import\s*\{\s*Timestamp\s*\}\s*from\s+["']firebase-admin\/firestore["']/);
    });

    it("imports toDateOrNull from @spark-inn/shared", () => {
      expect(bookingsSrc).toMatch(/import\s*\{[^}]*\btoDateOrNull\b[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
    });

    it("handleCreateBooking stores checkIn as Timestamp.fromDate(...)", () => {
      const handleMatch = bookingsSrc.match(
        /async\s+function\s+handleCreateBooking\s*\([\s\S]*?transaction\.set\(bookingDocRef,\s*newBooking\);/
      );
      expect(handleMatch, "expected to find handleCreateBooking body").toBeTruthy();
      const body = handleMatch![0];
      expect(body).toMatch(/checkIn:\s*Timestamp\.fromDate\(checkInDate\)/);
      expect(body).toMatch(/checkOut:\s*Timestamp\.fromDate\(checkOutDate\)/);
    });

    it("handleCreateWalkin stores checkIn as Timestamp.fromDate(...)", () => {
      const handleMatch = bookingsSrc.match(
        /async\s+function\s+handleCreateWalkin\s*\([\s\S]*?transaction\.set\(bookingDocRef,\s*newBooking\);/
      );
      expect(handleMatch, "expected to find handleCreateWalkin body").toBeTruthy();
      const body = handleMatch![0];
      expect(body).toMatch(/checkIn:\s*Timestamp\.fromDate\(checkInDate\)/);
      expect(body).toMatch(/checkOut:\s*Timestamp\.fromDate\(checkOutDate\)/);
    });

    it("the no-op `adminDb.doc(...).firestore.valueType ? a : a` ternary is gone", () => {
      // The previous dead-code ternary that was supposed to switch
      // between raw Date and Timestamp is replaced.
      expect(bookingsSrc).not.toMatch(/adminDb\.doc\([^)]+\)\.firestore\.valueType\s*\?/);
    });
  });

  describe("Overlap checks use the safe read helper", () => {
    it("calls toDateOrNull on data.checkIn and data.checkOut in handleCreateBooking", () => {
      // Locate the first `hasConflict` block (handleCreateBooking).
      const blockMatch = bookingsSrc.match(
        /const\s+hasConflict\s*=\s*bookingsSnapshot\.docs\.some\(\s*\(doc\)\s*=>\s*\{[\s\S]*?\}\s*\);/
      );
      expect(blockMatch, "expected to find the overlap check").toBeTruthy();
      const body = blockMatch![0];
      expect(body).toMatch(/toDateOrNull\(data\.checkIn\)/);
      expect(body).toMatch(/toDateOrNull\(data\.checkOut\)/);
      // Direct .toDate() calls on read-path values must be gone — those
      // crash on a legacy ISO string.
      expect(body).not.toMatch(/data\.checkIn\.toDate\(\)/);
      expect(body).not.toMatch(/data\.checkOut\.toDate\(\)/);
    });

    it("handles a malformed legacy value by skipping the conflict (no throw)", () => {
      const blockMatch = bookingsSrc.match(
        /const\s+hasConflict\s*=\s*bookingsSnapshot\.docs\.some\(\s*\(doc\)\s*=>\s*\{[\s\S]*?\}\s*\);/
      );
      expect(blockMatch).toBeTruthy();
      const body = blockMatch![0];
      expect(body).toMatch(/if\s*\(\s*!existingCheckIn\s*\|\|\s*!existingCheckOut\s*\)\s*return\s+false/);
    });
  });

  describe("Booking type still uses Date (the canonical shape)", () => {
    it("checkIn and checkOut are typed as Date in shared/types", () => {
      const blockMatch = bookingTypeSrc.match(
        /export\s+interface\s+Booking\s*\{[\s\S]*?\n\}/
      );
      expect(blockMatch, "expected to find the Booking interface").toBeTruthy();
      const body = blockMatch![0];
      expect(body).toMatch(/checkIn:\s*Date;/);
      expect(body).toMatch(/checkOut:\s*Date;/);
    });
  });
});
