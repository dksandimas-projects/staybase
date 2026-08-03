import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(__dirname, "../../..");
const bookingsHandler = readFileSync(resolve(root, "guest-app/server/handlers/bookings.ts"), "utf8");
const adminBookings = readFileSync(resolve(root, "admin-app/src/pages/BookingsPage.tsx"), "utf8");

describe("Finance Lifecycle FL-16 and FL-19", () => {
  test("all booking pricing writers persist the pre-discount subtotal", () => {
    expect(bookingsHandler).toContain("const originalTotalPrice = subtotal;");
    expect((bookingsHandler.match(/const originalTotalPrice = subtotal;/g) || [])).toHaveLength(2);
    expect(bookingsHandler).toContain("originalTotalPrice: pricingSubtotal,");
    expect(bookingsHandler).toContain("originalTotalPrice: subtotal,");
    expect(bookingsHandler).not.toMatch(/originalTotalPrice = discountPct > 0 \? subtotal : null/);
  });

  test("onsite payments require a preallocated ID and create that exact document", () => {
    const start = bookingsHandler.indexOf("export async function handleAddPayment");
    const end = bookingsHandler.indexOf("export async function handleAddRefund", start);
    const handler = bookingsHandler.slice(start, end);

    expect(handler).toMatch(/PREALLOCATED_PAYMENT_ID_REGEX\.test\(String\(paymentId\)\)/);
    expect(handler).toMatch(/paymentsRef\.doc\(paymentId\)/);
    // Per MRB-04 Phase 2 (2026-08-02, per decision
    // #159): the reservation-owned payment subcollection
    // path. For new reservations the payment record
    // includes `reservationId` + `bookingId`; for legacy
    // null-`reservationId` bookings the record shape is
    // byte-equivalent to the historical `paymentRecord`.
    // The guard accepts either shape — both are valid.
    expect(handler).toMatch(/transaction\.create\(newPaymentRef, (?:paymentRecord|recordWithReservation)\)/);
    expect(handler).toMatch(/idempotentReplay = true/);
    expect(adminBookings).toMatch(/paymentSubmissionIdRef = useRef<string \| null>\(null\)/);
    expect(adminBookings).toMatch(/addOnsitePayment\(selectedBooking\.id, paymentId, amount/);
    expect(adminBookings).toMatch(/if \(paymentCompleted\) paymentSubmissionIdRef\.current = null/);
  });
});
