import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(__dirname, "../../..");
const rules = readFileSync(resolve(root, "firebase/firestore.rules"), "utf8");
const context = readFileSync(resolve(root, "admin-app/src/context/AdminContext.tsx"), "utf8");
const bookingsPage = readFileSync(resolve(root, "admin-app/src/pages/BookingsPage.tsx"), "utf8");

describe("FLR-02 booking update authority", () => {
  test("restricts staff client updates to operational fields", () => {
    const start = rules.indexOf("match /bookings/{bookingId}");
    const end = rules.indexOf("match /payments/{paymentId}", start);
    const bookingRule = rules.slice(start, end);

    expect(bookingRule).toContain("affectedKeys().hasOnly([");
    for (const field of [
      "guestIdPhotoUrl",
      "guestRegistration",
      "breakfastSelections",
      "breakfastServed",
      "paymentReferenceNumber",
      "discountVerified",
      "discountVerifiedBy",
      "discountRejected",
      "notes",
      "specialRequests",
      "handledBy",
      "updatedAt"
    ]) {
      expect(bookingRule).toContain(`"${field}"`);
    }
    for (const forbidden of ["status", "totalPrice", "originalTotalPrice", "rateBreakdown", "pointsAwarded"]) {
      expect(bookingRule).not.toContain(`"${forbidden}"`);
    }
  });

  test("routes payment confirmation through the authenticated booking API", () => {
    expect(context).toContain("/api/bookings/mark-payment-confirmed");
    expect(context).not.toMatch(/status === "payment-confirmed"[\s\S]{0,500}updateDoc\(bookingDocRef/);
  });

  test("does not write authoritative server response fields back from the drawer", () => {
    expect(bookingsPage).toMatch(/const syncSelectedBooking = \(updates: Partial<Booking>\) => \{[\s\S]*?setSelectedBooking/);
    expect(bookingsPage).not.toMatch(/const syncSelectedBooking[\s\S]{0,200}updateBookingStatus/);
    expect(bookingsPage).toContain("const persistSelectedBooking");
  });
});
