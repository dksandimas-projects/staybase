// Per RPT-13 (QA pass 2026-10-21): the Reports page dropped every
// incidental charge from the receivables report.
//
// THE DEFECT THIS SUITE PINS
// ---------------------------
// Incidental charges live at ONE of two paths:
//
//   reservations/{reservationId}/charges/{chargeId}   (canonical)
//   bookings/{bookingId}/charges/{chargeId}           (legacy)
//
// The Reports page's live listener resolved the booking with
// `chargeDoc.ref.parent.parent?.id`. For the canonical path that is
// the RESERVATION id — which matches no booking. Every downstream join
// (`charges.filter((charge) => charge.bookingId === booking.id)`)
// therefore matched nothing.
//
// Measured against production on 2026-10-21: all 5 charges live under
// a reservation, all 5 carry a correct `data.bookingId`, and all 5
// were invisible in the receivables table — ₱1,350 of incidental
// revenue missing.
//
// The XLSX export in the same file already resolved it correctly, so
// the page had two resolvers that disagreed. One now serves both.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveChargeBookingId,
  isReservationScopedCharge
} from "../utils/chargeBookingId";

const reportsPageSrc = readFileSync(
  resolve(__dirname, "../pages/ReportsPage.tsx"),
  "utf8"
);

/** The production charge docs, verbatim in shape. */
const PRODUCTION_CHARGES = [
  {
    path: "reservations/4ef13ab8-8bec-4c95-a204-ecf281945531/charges/RpiCYUxuueAQqxvVNiNj",
    bookingId: "A2FD08Walkin0001",
    amount: 600
  },
  {
    path: "reservations/8c2340b4-2e5b-4a34-bb8b-9165d2d108c4/charges/LjS4vR9kJ8V0PbrKTX3V",
    bookingId: "A2FD07Walkin0001",
    amount: 300
  },
  {
    path: "reservations/8c2340b4-2e5b-4a34-bb8b-9165d2d108c4/charges/VVJojefrIG7ts1WLM4cF",
    bookingId: "A2FD07Walkin0001",
    amount: 500
  },
  {
    path: "reservations/8c2340b4-2e5b-4a34-bb8b-9165d2d108c4/charges/tcwF1RKhcil0BrqsHdIJ",
    bookingId: "A2FD07Walkin0001",
    amount: 250
  },
  {
    path: "reservations/8c2340b4-2e5b-4a34-bb8b-9165d2d108c4/charges/void-LjS4vR9kJ8V0PbrKTX3V",
    bookingId: "A2FD07Walkin0001",
    amount: -300
  }
];

/** The RESERVATION ids in the production data — never booking ids. */
const PRODUCTION_RESERVATION_IDS = [
  "4ef13ab8-8bec-4c95-a204-ecf281945531",
  "8c2340b4-2e5b-4a34-bb8b-9165d2d108c4"
];

describe("RPT-13 — the charge → booking resolver", () => {
  it("resolves a reservation-scope charge to its STAMPED booking id", () => {
    for (const charge of PRODUCTION_CHARGES) {
      expect(resolveChargeBookingId(charge.path, { bookingId: charge.bookingId })).toBe(
        charge.bookingId
      );
    }
  });

  it("never returns the reservation id for a reservation-scope charge", () => {
    // The exact defect: `ref.parent.parent?.id` returned the
    // reservation id, which matched no booking.
    for (const charge of PRODUCTION_CHARGES) {
      const pathParentId = charge.path.split("/")[1];
      expect(PRODUCTION_RESERVATION_IDS).toContain(pathParentId);
      const resolved = resolveChargeBookingId(charge.path, { bookingId: charge.bookingId });
      expect(resolved).not.toBe(pathParentId);
    }
  });

  it("resolves a LEGACY booking-scope charge from its path", () => {
    // `bookings/{id}/charges/{cid}` — the path parent IS the booking.
    expect(
      resolveChargeBookingId("bookings/A2FD01Walkin0001/charges/c-1", {})
    ).toBe("A2FD01Walkin0001");
  });

  it("returns \"\" for a reservation-scope charge with no stamped bookingId", () => {
    // It cannot be attributed — guessing the reservation id would
    // attribute it to a booking that does not exist.
    expect(
      resolveChargeBookingId("reservations/8c2340b4-2e5b-4a34-bb8b-9165d2d108c4/charges/c-1", {})
    ).toBe("");
  });

  it("ignores a blank / non-string stamped bookingId", () => {
    expect(resolveChargeBookingId("bookings/B1/charges/c-1", { bookingId: "  " })).toBe("B1");
    expect(resolveChargeBookingId("bookings/B1/charges/c-1", { bookingId: 42 })).toBe("B1");
  });

  it("tolerates a null / undefined data object", () => {
    expect(resolveChargeBookingId("bookings/B1/charges/c-1", null)).toBe("B1");
    expect(resolveChargeBookingId("bookings/B1/charges/c-1", undefined)).toBe("B1");
  });

  it("recognises a reservation-scope charge", () => {
    expect(isReservationScopedCharge(PRODUCTION_CHARGES[0].path)).toBe(true);
    expect(isReservationScopedCharge("bookings/B1/charges/c-1")).toBe(false);
  });

  it("attributes all 5 production charges to exactly 2 bookings", () => {
    const byBooking = new Map<string, number>();
    for (const charge of PRODUCTION_CHARGES) {
      const id = resolveChargeBookingId(charge.path, { bookingId: charge.bookingId });
      byBooking.set(id, (byBooking.get(id) || 0) + charge.amount);
    }
    expect(byBooking.get("A2FD07Walkin0001")).toBe(750);
    expect(byBooking.get("A2FD08Walkin0001")).toBe(600);
    // ₱1,350 of incidental revenue that the receivables table was
    // silently dropping.
    const total = [...byBooking.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(1350);
  });
});

describe("RPT-13 — the Reports page uses ONE resolver (tripwire)", () => {
  it("the live listener resolves through the helper", () => {
    expect(reportsPageSrc).toMatch(
      /const bookingId = resolveChargeBookingId\(chargeDoc\.ref\.path, data\);/
    );
  });

  it("the XLSX export resolves through the same helper", () => {
    expect(reportsPageSrc).toMatch(
      /const bookingId = resolveChargeBookingId\(chargeDoc\.ref\.path, charge\);/
    );
  });

  it("the CHARGES listener no longer resolves a booking from the path parent", () => {
    // This is the defect line. It must not come back.
    //
    // Scoped to the charges listener block on purpose: the PAYMENTS
    // and REFUNDS listeners legitimately read `ref.parent.parent?.id`
    // for the RESERVATION id (their `sourceId`), and both already
    // resolve the booking id from the stamped `data.bookingId`.
    const start = reportsPageSrc.indexOf("setRawCharges(");
    const end = reportsPageSrc.indexOf("setRawPayments(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const chargesBlock = reportsPageSrc.slice(start, end);
    expect(chargesBlock).not.toMatch(/ref\.parent\.parent\?\.id/);
  });

  it("the payments + refunds listeners still resolve their booking id from the stamp", () => {
    // Guard against over-correcting: those two were already right.
    expect(reportsPageSrc).toMatch(
      /isReservationPayment\s*\?\s*String\(data\.bookingId\s*\|\|\s*parentDocumentId\)/
    );
    expect(reportsPageSrc).toMatch(
      /isReservationRefund\s*\r?\n\s*\?\s*String\(data\.bookingId\s*\|\|\s*parentDocumentId\)/
    );
  });

  it("imports the helper", () => {
    expect(reportsPageSrc).toMatch(
      /import \{ resolveChargeBookingId \} from "\.\.\/utils\/chargeBookingId";/
    );
  });
});
