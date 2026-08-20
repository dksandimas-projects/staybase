// Per EXB-12 (2026-08-06, per decision #199) hotfix (v0.264.6):
// a REAL runtime regression test for the class of bug that
// shipped in v0.264.5 — the client added a new field
// (`extraBedBreakfast`) and the server's strict Zod schemas
// were not updated to accept it. Result: every `/book`
// POST returned
//   "Please check the booking details — a required field is
//    missing or invalid."
// because the strict `createBookingSchema` + `publicRoomSelectionSchema`
// rejected the unknown field. The v0.264.5 test surface
// (`exb-12-extra-bed-breakfast.test.ts`) was source-text regex only —
// it greps `shared/schemas/booking.ts` (a different file) and
// never exercised the strict server handler schemas. This file
// is the real test: imports the actual exported schemas and
// runs `safeParse` on the exact body shape that
// `BookingPage.handleConfirmBooking` sends.
//
// Why this matters beyond EXB-12: the next time the client
// adds a new field to the `/book` body, the strict server
// schemas will reject it. A single integration test like
// this one (no Firebase, no HTTP, no emulator) catches the
// whole class in <100ms.
//
// Reference IDs: TEST-EXB-12-STRICT-001..003. See
// `plan/docs/DECISIONS-FEATURES.md` decision #199 for the
// feature spec and the v0.264.5 post-mortem.

import { describe, expect, it, vi } from "vitest";

// Minimal mock so the handler file can be imported without a
// live Firebase project. The schemas themselves are pure Zod
// and never touch `adminDb` / `adminAuth` at parse time — we
// only need the import to not blow up at module load.
// `vi.mock` is hoisted by vitest to the top of the file, so
// this call intercepts the module before the handler
// import below runs.
vi.mock("../../server/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: () => Promise.resolve({ uid: "test" }) },
  adminDb: new Proxy({}, { get: () => () => ({ get: () => ({ then: () => null }) }) })
}));

import { createBookingSchema, publicRoomSelectionSchema } from "../../server/handlers/bookings";

// A realistic `/book` body, shaped to match
// `BookingPage.handleConfirmBooking` (BookingPage.tsx ~line
// 1339-1431). Uses Manila-future dates so the past-date
// invariant in the handler is irrelevant here (this test
// only exercises schema parsing, not the handler's business
// logic).
const makeFutureDate = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const baseBookingBody = {
  bookingId: "abc123def456ghi789",
  reservationId: "12345678-90ab-4cde-9f01-23456789abcd",
  roomType: "Deluxe Queen",
  roomCount: 1,
  roomSelections: [
    {
      bookingId: "abc123def456ghi789",
      roomType: "Deluxe Queen",
      numAdults: 2,
      numChildren: 0,
      extraBedCount: 0,
      extraBedBreakfast: false,
      hasBreakfast: false,
      breakfastIncludesChildren: false
    }
  ],
  checkIn: makeFutureDate(7),
  checkOut: makeFutureDate(9),
  guests: 2,
  hasBreakfast: false,
  breakfastIncludesChildren: false,
  numAdults: 2,
  numChildren: 0,
  extraBedCount: 0,
  extraBedBreakfast: false,
  guestDetails: {
    firstName: "Maria",
    lastName: "Santos",
    email: "maria@example.com",
    phone: "+639171234567",
    requests: "",
    consent: true
  },
  discountType: "",
  discountIdPhotoUrl: null,
  discountIdPhotoPath: null,
  voucherCode: "",
  paymentMethod: "bank-transfer",
  paymentProofUrl: null,
  paymentProofPath: null,
  turnstileToken: "test-token",
  _hp: ""
};

describe("EXB-12 — strict server schemas accept the EXB-12 client body shape", () => {
  it("TEST-EXB-12-STRICT-001: createBookingSchema.safeParse accepts the full /book body (no Firebase)", () => {
    // The single most important assertion in this file.
    // Pre-v0.264.6 this would have failed with
    // `unrecognized_keys: ["extraBedBreakfast"]` because
    // the top-level `createBookingSchema` is `.strict()`
    // and did not declare the field. The bug shipped to
    // production because the regex-only test surface
    // greps a different file.
    const result = createBookingSchema.safeParse(baseBookingBody);
    expect(result.success).toBe(true);
    if (!result.success) {
      // Fail loudly with the actual Zod issue list so a
      // future regression isn't silently masked.
      throw new Error(
        `createBookingSchema rejected the v0.264.6 client body: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
  });

  it("TEST-EXB-12-STRICT-002: publicRoomSelectionSchema.safeParse accepts each roomSelections[i]", () => {
    // The per-room strict schema must also accept
    // `extraBedBreakfast`. Pre-v0.264.6 this failed with
    // the same `unrecognized_keys` error.
    const result = publicRoomSelectionSchema.safeParse(baseBookingBody.roomSelections[0]);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(
        `publicRoomSelectionSchema rejected the v0.264.6 client room line: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
  });

  it("TEST-EXB-12-STRICT-003: extraBedBreakfast=true with extraBedCount>0 is accepted (no schema-level invariant)", () => {
    // The schema accepts the field. The invariant
    // `extraBedBreakfast implies extraBedCount > 0` is
    // enforced inside the handler's `validatedRoomStays`
    // loop (force-off when extraBedCount is 0), not by
    // the schema. This test pins the split of concerns:
    // schema = shape, handler = business rules.
    const body = {
      ...baseBookingBody,
      roomSelections: [
        {
          ...baseBookingBody.roomSelections[0],
          extraBedCount: 1,
          extraBedBreakfast: true
        }
      ]
    };
    const result = createBookingSchema.safeParse(body);
    expect(result.success).toBe(true);
  });
});
