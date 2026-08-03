import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handler = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const holdExpiry = readFileSync(resolve(__dirname, "../../server/handlers/hold-expiry.ts"), "utf8");

describe("CRL-02 cancellation audit metadata", () => {
  // Per CRL-02 (2026-08-02): every cancellation stamps
  // `cancelledAt` + `cancelledBy` + `cancellationSource` in the
  // same Firestore transaction as the status flip. System expiry
  // keeps its canonical `cancellationReason: "payment-hold-expired"`.
  // Cancellation records remain permanent; no path deletes a
  // booking or rewrites collected-money entries (verified by the
  // existing `isBookingOccupyingRoom` and `cancellationReason`
  // write-only contract — see shared/__tests__/booking-occupancy.test.ts).

  function isolateHandleCancelBooking() {
    const start = handler.indexOf("export async function handleCancelBooking");
    expect(start).toBeGreaterThanOrEqual(0);
    // Stop at the next export async function (handleAddPayment).
    const next = handler.indexOf("export async function handleAddPayment", start);
    expect(next).toBeGreaterThan(start);
    return handler.slice(start, next);
  }

  describe("handleCancelBooking (the main path)", () => {
    it("derives cancellationSource at the entry point from req.staff (no client-supplied source)", () => {
      const body = isolateHandleCancelBooking();
      // The boolean check + the source derivation sit at the top of
      // the handler so every downstream branch (staff / guest) shares
      // the same audit contract.
      expect(body).toMatch(/isStaffCancellation = Boolean\(req\.staff\?\.uid\)/);
      expect(body).toMatch(/cancellationSource[\s\S]+?isStaffCancellation\s*\?\s*"staff"\s*:\s*"guest"/);
    });

    it("stamps cancelledBy from the staff UID (staff path) or the literal \"guest\" (guest path)", () => {
      const body = isolateHandleCancelBooking();
      expect(body).toMatch(/cancelledBy[\s\S]+?isStaffCancellation[\s\S]+?req\.staff\.uid[\s\S]+?"guest"/);
    });

    it("writes all three audit fields in the same transaction.update call as the status flip", () => {
      // The 4 fields must share one `transaction.update` block so a
      // partial failure cannot leave a half-stamped cancellation.
      // CRL-07 (2026-08-03) refactored the inline object into a
      // `bookingUpdate` variable (the per-child branch now also
      // includes the `cancellationLiability` snapshot when the
      // policy refunds money), so the test reads the audit fields
      // from the variable assignment instead of the inline object.
      const body = isolateHandleCancelBooking();
      const updateVarBlock = body.match(/const bookingUpdate:\s*Record<string,\s*any>\s*=\s*\{[\s\S]+?\};/);
      expect(updateVarBlock, "expected the per-child `bookingUpdate` variable").toBeTruthy();
      const block = updateVarBlock![0];
      expect(block).toMatch(/status:\s*"cancelled"/);
      expect(block).toMatch(/cancellationReason:\s*validReason/);
      expect(block).toMatch(/cancelledAt:\s*now/);
      expect(block).toMatch(/cancelledBy/);
      expect(block).toMatch(/cancellationSource/);
      expect(block).toMatch(/updatedAt:\s*now/);
      // The variable is then passed to a single
      // `transaction.update(bookingDocumentRef, bookingUpdate)`
      // call so a partial failure cannot leave a
      // half-stamped cancellation.
      expect(body).toMatch(/transaction\.update\(bookingDocumentRef,\s*bookingUpdate\)/);
    });

    it("the per-child `bookingUpdate` shape carries the CRL-07 liability snapshot when one was produced", () => {
      // CRL-07 (2026-08-03) added the optional
      // `cancellationLiability` field to the
      // per-child `bookingUpdate` (the snapshot is
      // stamped in the same transaction as the
      // status flip). The test matches the
      // conditional set: when `liabilitySnapshot` is
      // non-null, the field is added to the
      // update; when `null` (no-refund cancel), the
      // field is omitted.
      const body = isolateHandleCancelBooking();
      expect(body).toMatch(/bookingUpdate\.cancellationLiability\s*=\s*liabilitySnapshot/);
    });

    it("preserves the bounded cancellationReason contract (reason is sliced to 500 chars)", () => {
      const body = isolateHandleCancelBooking();
      expect(body).toMatch(/validReason[\s\S]+?reason\.slice\(0,\s*500\)/);
    });
  });

  describe("PEX-03 in-transaction retirement (3 call sites in bookings.ts)", () => {
    function countRetirementBlocks() {
      // Match the per-site `for (const retirement of expiredHoldRetirements) { transaction.update(...) }` block.
      const re = /for \(const retirement of expiredHoldRetirements\) \{[\s\S]+?transaction\.update\(retirement\.ref,\s*\{[\s\S]+?\}\);[\s\S]+?\}/g;
      const matches = handler.match(re);
      return matches?.length ?? 0;
    }

    it("exists at exactly 3 call sites (handleCreateBooking + handleCreateWalkin + handleRescheduleBooking)", () => {
      expect(countRetirementBlocks()).toBe(3);
    });

    it("every retirement block stamps cancelledBy: \"system\" + cancellationSource: \"system\"", () => {
      const re = /for \(const retirement of expiredHoldRetirements\) \{[\s\S]+?transaction\.update\(retirement\.ref,\s*\{[\s\S]+?\}\);[\s\S]+?\}/g;
      const matches = handler.match(re) ?? [];
      expect(matches.length).toBe(3);
      for (const block of matches) {
        expect(block).toMatch(/cancelledBy:\s*"system"/);
        expect(block).toMatch(/cancellationSource:\s*"system"/);
        expect(block).toMatch(/cancellationReason:\s*EXPIRED_HOLD_CANCELLATION_REASON/);
        expect(block).toMatch(/cancelledAt:\s*now/);
      }
    });
  });

  describe("PEX-06 daily cron (hold-expiry.ts)", () => {
    it("the retirement update writes cancelledBy: SYSTEM_CANCELLATION_SOURCE + cancellationSource: SYSTEM_CANCELLATION_SOURCE", () => {
      expect(holdExpiry).toMatch(/transaction\.update\(doc\.ref,\s*\{[\s\S]+?cancelledBy:\s*SYSTEM_CANCELLATION_SOURCE/);
      expect(holdExpiry).toMatch(/cancellationSource:\s*SYSTEM_CANCELLATION_SOURCE/);
    });

    it("the SYSTEM_CANCELLATION_SOURCE constant is the literal \"system\" (no PII, no UID)", () => {
      expect(holdExpiry).toMatch(/const SYSTEM_CANCELLATION_SOURCE = "system"/);
    });

    it("preserves the canonical EXPIRED_HOLD_CANCELLATION_REASON on the cron retirement", () => {
      expect(holdExpiry).toMatch(/cancellationReason:\s*EXPIRED_HOLD_CANCELLATION_REASON/);
    });
  });

  describe("admin-app hydration (AdminContext.tsx)", () => {
    const admin = readFileSync(resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"), "utf8");

    it("hydrates cancelledAt, cancelledBy, cancellationSource from the booking snapshot", () => {
      // CRL-02 is a server-authoritative contract; the admin read
      // path must hydrate the 3 fields so the booking drawer can
      // render the audit row in a follow-up CRL-09 UI pass.
      expect(admin).toMatch(/cancelledAt: data\.cancelledAt \? parseDateTimeString\(data\.cancelledAt\) : null/);
      expect(admin).toMatch(/cancelledBy: data\.cancelledBy \|\| null/);
      expect(admin).toMatch(/cancellationSource: data\.cancellationSource \|\| null/);
    });
  });
});
