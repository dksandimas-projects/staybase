// Per MRB-04 Phase 3 (2026-08-02, per decision #159):
// the reservation header's `paymentStatus` is a
// denormalized mirror of the child booking statuses —
// the canonical N>1 aggregate. The pre-BAR-02 contract
// was that the verify-payment + add-payment + reject +
// apply-discount + confirm-with-balance + CWB-rebooking
// handlers wrote the mirror in the same `runTransaction`
// as the per-child status flip.
//
// Per BAR-02 (2026-08-08, per decision #203): the
// `paymentStatus` mirror is no longer written to the
// reservation header. Consumers derive it at read time
// via `computeReservationAggregatePaymentStatus` over
// the children. The aggregate helper is unchanged
// (still lives at `shared/utils/bookingFolio.ts`, still
// pinned by the characterization tests in
// `shared/__tests__/booking-folio.test.ts`).
//
// This file is now slimmed down to the BAR-02
// assertion: the mirror write is GONE from every
// handler that used to do it. The pre-BAR-02 test
// surface (12 source-text guards across the 6
// handlers) is replaced by a single guard per
// handler. The corresponding read-time derivation
// tests are in `bar-02-derive-counters.test.ts`.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const HANDLERS_PATH = join(REPO_ROOT, "guest-app", "server", "handlers", "bookings.ts");
const handlers = readFileSync(HANDLERS_PATH, "utf-8");

// Per MRB-04 Phase 3 + per BAR-02: the 6 handlers that
// used to write the `paymentStatus` mirror now only
// touch the header with a heartbeat `updatedAt` write.
// The aggregate helper is no longer used as a write
// value in any handler.
describe("MRB-04 Phase 3 — the `paymentStatus` mirror is no longer written (per BAR-02 / #203)", () => {
  it("the verify-payment handler does NOT write `paymentStatus` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /handleVerifyAndRecordPayment[\s\S]{0,20000}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });

  it("the add-payment handler does NOT write `paymentStatus` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /handleAddPayment[\s\S]{0,20000}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });

  it("the reject-payment handler does NOT write `paymentStatus` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /handleRejectPayment[\s\S]{0,20000}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });

  it("the apply-discount handler does NOT write `paymentStatus` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /handleApplyDiscount[\s\S]{0,20000}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });

  it("the confirm-with-balance handler does NOT write `paymentStatus` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /handleConfirmWithBalance[\s\S]{0,20000}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });

  it("the reservation-scope cancel does NOT write `paymentStatus` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /paymentStatus: computeReservationAggregatePaymentStatus\(postStatuses\)/
    );
  });

  it("the single-cancel does NOT write `paymentStatus` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /paymentStatus: computeReservationAggregatePaymentStatus\(\["cancelled"\]\)/
    );
  });

  it("the create / walkin / checkin / checkout / add-room / corporate paths do NOT write `paymentStatus` to the reservation header", () => {
    // Broader scan — the 5 lifecycle handlers + the
    // add-room + corporate create-walkin. None of
    // them write `paymentStatus` per BAR-02.
    const lifecycleHandlers = [
      "handleCreateBooking",
      "handleCreateWalkin",
      "handleCheckinBooking",
      "handleCheckoutBooking",
      "handleAddRoomToReservation",
      "handleCorporateCreateWalkin"
    ];
    for (const name of lifecycleHandlers) {
      expect(handlers).not.toMatch(
        new RegExp(`${name}[\\s\\S]{0,20000}?paymentStatus:\\s*computeReservationAggregatePaymentStatus`)
      );
    }
  });
});
