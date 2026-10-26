// Per §3.19 (AI-BROWSER-QA 2026-10-26): the booking drawer's "Refunds
// due" panel was dead.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// When a guest cancels a PAID breakfast, the server writes a pending
// refund liability to `bookings/{bookingId}/refunds/{refundId}` with
// `category: "breakfast"` + `status: "pending"`
// (`guest-app/server/handlers/breakfast-manage.ts` →
// `createBreakfastRefundLiability`).
//
// The admin drawer's breakfast tab reads that liability from
// `booking.refunds` — the `Booking` type declares the field
// ("Per BR-05: the per-booking breakfast liability surface"), and
// `BookingDrawerWorkspace.tsx` filters it for
// `category === "breakfast" && status === "pending"`.
//
// The admin app's booking mapper NEVER populated it. The mapper
// hydrated `booking.onsitePayments` (the RPT-01 fix) but nothing ever
// wrote `booking.refunds`, so `pendingRefunds` was ALWAYS empty: the
// "Refunds due" panel never rendered, and the "Mark as paid" control
// that clears the liability was unreachable. The staff had no way to
// see or settle a guest's breakfast refund.
//
// The BR-06 suite for this panel is a SOURCE-TEXT tripwire — it checks
// that the strings are present in the component, not that the data ever
// reaches it — which is why the break was invisible to the suite.
//
// The fix: the mapper now derives `booking.refunds` from the canonical
// ledger (the `refunds` collection group), with the BARE doc id as
// `id` so `POST /api/refunds/mark-paid` can resolve it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBookingPaymentIndex,
  normalizeLedgerDoc,
  resolveBookingRefunds,
  type PaymentLedgerDoc,
} from "../utils/bookingPaymentEntries";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

const doc = (path: string, data: Record<string, unknown>): PaymentLedgerDoc =>
  normalizeLedgerDoc(path, data);

const BREAKFAST_REFUND_ID = "0f3c2d1e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

const index = buildBookingPaymentIndex([
  doc("bookings/BOOK-1/refunds/" + BREAKFAST_REFUND_ID, {
    type: "refund",
    category: "breakfast",
    status: "pending",
    amount: -100,
    method: "pending",
    note: "Pending — staff processes the payout.",
    reason: "Guest removed a paid breakfast",
    recordedAt: "2026-10-26T02:00:00.000Z",
  }),
  doc("reservations/r-1/payments/p-1", {
    amount: 2600,
    bookingId: "BOOK-1",
    recordedAt: "2026-10-26T01:00:00.000Z",
  }),
]);

describe("§3.19 — the drawer's refund liability surface", () => {
  describe("resolveBookingRefunds", () => {
    it("returns the booking's refund entries", () => {
      const refunds = resolveBookingRefunds("BOOK-1", index);
      expect(refunds.length).toBe(1);
      expect(refunds[0].category).toBe("breakfast");
      expect(refunds[0].status).toBe("pending");
      expect(refunds[0].amount).toBe(-100);
    });

    it("carries the BARE doc id, not the doc path", () => {
      const refunds = resolveBookingRefunds("BOOK-1", index);
      // The "Mark as paid" control posts this id to
      // `POST /api/refunds/mark-paid`, which reads
      // `bookings/{bookingId}/refunds/{refundId}`.
      expect(refunds[0].id).toBe(BREAKFAST_REFUND_ID);
      expect(refunds[0].id).not.toContain("/");
    });

    it("excludes payments", () => {
      const refunds = resolveBookingRefunds("BOOK-1", index);
      expect(refunds.some((entry) => entry.type === "payment")).toBe(false);
    });

    it("returns an empty list for a booking with no refunds", () => {
      expect(resolveBookingRefunds("BOOK-OTHER", index)).toEqual([]);
    });
  });

  describe("the wiring (the tripwire that the break cannot come back)", () => {
    it("the admin mapper assigns `booking.refunds`", () => {
      expect(adminContextSrc).toMatch(/booking\.refunds\s*=\s*resolveBookingRefunds\(/);
    });

    it("the re-hydration effect keeps `booking.refunds` in step", () => {
      expect(adminContextSrc).toMatch(/resolveBookingRefunds\(booking\.id, paymentIndex\)/);
    });
  });
});
