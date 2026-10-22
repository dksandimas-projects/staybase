// Per RPT-16 (P1 security fix, 2026-10-22): the reservation-ref
// branch of `findBooking` did NOT enforce the guest credential.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// `guest-app/server/handlers/email.ts` → `findBooking` has three
// lookup branches:
//
//   1. `bookingId`  — fetches the doc directly.
//   2. `bookingRef` →
//      a) `RESERVATION_REF_REGEX` (`R-YYYYMMDD-NNNNN`) — queries
//         the `reservations` collection by `reservationRef`.
//      b) `else` (`SI-YYYYMMDD-NNNNN`) — queries `bookings`.
//
// Pre-fix, branch 2a ran with NO guest-email filter at all, and the
// post-resolution guard only ran the guest-email check for
// `bookingId` payloads. So an UNAUTHENTICATED caller holding an
// enumerable reservation ref could:
//
//   (a) resolve the booking,
//   (b) fire the guest-facing `booking-submitted` /
//       `booking-cancelled` emails (both are in `publicEmailActions`
//       in `apiRouter.ts`, so neither needs a token), and
//   (c) use the response difference as an enumeration oracle:
//
//       POST /api/email/booking-submitted {"bookingRef":"SI-…"}
//         -> 400 "Booking reference and guest email are required."
//       POST /api/email/booking-submitted {"bookingRef":"R-…"}
//         -> 404 "Booking not found."   (branch entered, no email)
//
// THE FIX
// -------
// The reservation-ref branch now enforces the SAME credential as the
// `SI-…` branch: when `requireGuestMatch` is on and there is no
// authenticated `user.uid`, `guestEmail` is required (same error
// string → same status code) and the booking only resolves when the
// email matches (case-insensitive + trimmed).
//
// The two branches must be INDISTINGUISHISHABLE to the caller: same
// status code, same message, same "no email sent" outcome.
//
// This suite is behavioural — it drives the real `handleEmailTrigger`
// against an in-memory Firestore mock, so it fails against the
// pre-fix code and passes after the fix.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Filter = [string, string, unknown];

const { store, mockSend, mockUpdate, mockAdd } = vi.hoisted(() => ({
  store: {
    reservations: [] as any[],
    bookings: [] as any[]
  },
  mockSend: vi.fn(),
  mockUpdate: vi.fn(),
  mockAdd: vi.fn()
}));

// ── In-memory Firestore mock ─────────────────────────────────────
// A tiny query engine: `where` accumulates equality filters,
// `orderBy` sorts, `limit` is a no-op (the production code always
// uses limit(1) and then reads docs[0]).
vi.mock("../../server/lib/firebase-admin", () => {
  const makeQuery = (collectionName: string, filters: Filter[] = [], sorts: Array<[string, string]> = []) => {
    const query: any = {
      where(field: string, op: string, value: unknown) {
        return makeQuery(collectionName, [...filters, [field, op, value]], sorts);
      },
      orderBy(field: string, dir = "asc") {
        return makeQuery(collectionName, filters, [...sorts, [field, dir]]);
      },
      limit() {
        return query;
      },
      async get() {
        let rows = (store[collectionName] || []).filter((doc: any) =>
          filters.every(([field, op, value]) => (op === "==" ? doc[field] === value : true))
        );
        for (const [field, dir] of sorts) {
          rows = [...rows].sort((a: any, b: any) => {
            if (a[field] === b[field]) return 0;
            const cmp = a[field] > b[field] ? 1 : -1;
            return dir === "desc" ? -cmp : cmp;
          });
        }
        const docs = rows.map((doc: any) => ({
          id: doc.id,
          exists: true,
          data: () => ({ ...doc })
        }));
        return { empty: docs.length === 0, docs };
      }
    };
    return query;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collectionName: string) => ({
        doc: vi.fn().mockImplementation((docId: string) => ({
          id: docId,
          path: `${collectionName}/${docId}`,
          get: vi.fn().mockImplementation(async () => {
            const found = (store[collectionName] || []).find((d: any) => d.id === docId);
            return found
              ? { exists: true, id: docId, data: () => ({ ...found }) }
              : { exists: false, id: docId, data: () => undefined };
          }),
          update: mockUpdate
        })),
        where: vi.fn().mockImplementation((field: string, op: string, value: unknown) =>
          makeQuery(collectionName, [[field, op, value]])
        ),
        add: mockAdd
      }))
    }
  };
});

vi.mock("../../server/lib/resend", () => ({
  resend: {
    emails: {
      send: mockSend
    }
  }
}));

import { handleEmailTrigger } from "../../server/handlers/email";

// ── Fixtures ──────────────────────────────────────────────────────
const RESERVATION_REF = "R-20261021-00001";
const BOOKING_REF = "SI-20261021-00001";
const GUEST_EMAIL = "maria.santos@example.test";

const leadBooking = {
  id: "booking_lead",
  bookingRef: BOOKING_REF,
  reservationId: "res_1",
  reservationRef: RESERVATION_REF,
  reservationPosition: 1,
  reservationRoomCount: 2,
  guestName: "Maria Santos",
  guestEmail: GUEST_EMAIL,
  guestPhone: "+63 917 000 0000",
  roomNumber: "201",
  roomName: "Deluxe Sea View",
  roomType: "deluxe",
  checkIn: new Date("2099-01-10T00:00:00.000Z"),
  checkOut: new Date("2099-01-12T00:00:00.000Z"),
  numNights: 2,
  totalPrice: 5000,
  paymentMethod: "gcash",
  status: "confirmed",
  lookupToken: "lead_lookup_token_0123456789abcdef",
  memberId: null
};

const siblingBooking = {
  ...leadBooking,
  id: "booking_sibling",
  bookingRef: "SI-20261021-00002",
  reservationPosition: 2
};

const reservationHeader = {
  id: "res_1",
  reservationRef: RESERVATION_REF,
  leadGuestName: "Maria Santos",
  leadGuestEmail: GUEST_EMAIL,
  checkIn: new Date("2099-01-10T00:00:00.000Z"),
  checkOut: new Date("2099-01-12T00:00:00.000Z"),
  numNights: 2,
  totalPrice: 10000,
  paymentMethod: "gcash",
  paymentStatus: "confirmed"
};

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const statusOf = (res: any) => res.status.mock.calls[0]?.[0];
const bodyOf = (res: any) => res.json.mock.calls[0]?.[0];

/** An unauthenticated public request (no `staff`, no `user`). */
const guestReq = (body: Record<string, unknown>) =>
  ({ method: "POST", body }) as any;

beforeEach(() => {
  store.reservations = [reservationHeader];
  store.bookings = [leadBooking, siblingBooking];
  mockSend.mockReset();
  mockSend.mockResolvedValue({ id: "email_123" });
  mockUpdate.mockReset();
  mockAdd.mockReset();
  // The handler logs the failed trigger — keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RPT-16 — the reservation-ref branch enforces the guest credential", () => {
  test("an unauthenticated `R-…` ref with NO guest email is rejected with the SAME 400 the `SI-…` branch returns", async () => {
    const res = mockResponse();
    await handleEmailTrigger(guestReq({ bookingRef: RESERVATION_REF }), res, "booking-submitted");

    // The `SI-…` branch's answer (unchanged by the fix).
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).error).toBe("Booking reference and guest email are required.");
    // …and no guest email may leave the building.
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("an unauthenticated `R-…` ref with a WRONG guest email is a 404 and fires NO email", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: RESERVATION_REF, guestEmail: "attacker@example.test" }),
      res,
      "booking-submitted"
    );

    // Identical to the `SI-…` wrong-email case: 404 "Booking not found."
    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res).error).toBe("Booking not found.");
    // THE security assertion: pre-fix this fired the guest email.
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("an unauthenticated `R-…` ref with the CORRECT guest email still works (no regression)", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: RESERVATION_REF, guestEmail: GUEST_EMAIL }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).success).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("the guest-email comparison is case-insensitive and trimmed", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: RESERVATION_REF, guestEmail: `  ${GUEST_EMAIL.toUpperCase()}  ` }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("the `R-…` branch is indistinguishable from the `SI-…` branch (same status, same message)", async () => {
    const rNoEmail = mockResponse();
    await handleEmailTrigger(guestReq({ bookingRef: RESERVATION_REF }), rNoEmail, "booking-submitted");

    const siNoEmail = mockResponse();
    await handleEmailTrigger(guestReq({ bookingRef: BOOKING_REF }), siNoEmail, "booking-submitted");

    expect(statusOf(rNoEmail)).toBe(statusOf(siNoEmail));
    expect(bodyOf(rNoEmail).error).toBe(bodyOf(siNoEmail).error);

    const rWrongEmail = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: RESERVATION_REF, guestEmail: "attacker@example.test" }),
      rWrongEmail,
      "booking-submitted"
    );

    const siWrongEmail = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: BOOKING_REF, guestEmail: "attacker@example.test" }),
      siWrongEmail,
      "booking-submitted"
    );

    expect(statusOf(rWrongEmail)).toBe(statusOf(siWrongEmail));
    expect(bodyOf(rWrongEmail).error).toBe(bodyOf(siWrongEmail).error);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("RPT-16 — the `SI-…` branch behaviour is unchanged", () => {
  test("`SI-…` + no email → 400 'Booking reference and guest email are required.'", async () => {
    const res = mockResponse();
    await handleEmailTrigger(guestReq({ bookingRef: BOOKING_REF }), res, "booking-submitted");

    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).error).toBe("Booking reference and guest email are required.");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("`SI-…` + wrong email → 404 'Booking not found.'", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: BOOKING_REF, guestEmail: "attacker@example.test" }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res).error).toBe("Booking not found.");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("`SI-…` + correct email → 200 + one email", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: BOOKING_REF, guestEmail: GUEST_EMAIL }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// Per RPT-16 follow-on (2026-10-22): the `SI-…` branch was still
// CASE-SENSITIVE while the `R-…` branch was not.
//
// The stored `guestEmail` is lowercased + trimmed on write (SEV-1 #4),
// and Firestore has no case-insensitive equality query, so the `SI-…`
// branch used `where("guestEmail", "==", guestEmail)` — a
// case-sensitive filter. A guest who typed `Maria@Example.com` got a
// 404 on an `SI-…` ref but a 200 on an `R-…` ref. The two branches
// are now identical.
describe("RPT-16 follow-on — the `SI-…` branch compares the email case-insensitively", () => {
  test("`SI-…` + an UPPERCASED email → 200 + one email (was 404)", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: BOOKING_REF, guestEmail: GUEST_EMAIL.toUpperCase() }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("`SI-…` + a PADDED email → 200 + one email (was 404)", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: BOOKING_REF, guestEmail: `  ${GUEST_EMAIL}  ` }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("`SI-…` + a wrong email is STILL a 404 and fires no email (no regression)", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: BOOKING_REF, guestEmail: "attacker@example.test" }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res).error).toBe("Booking not found.");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("the `SI-…` and `R-…` branches now answer identically for a mixed-case email", async () => {
    const si = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: BOOKING_REF, guestEmail: `  ${GUEST_EMAIL.toUpperCase()}  ` }),
      si,
      "booking-submitted"
    );

    const r = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingRef: RESERVATION_REF, guestEmail: `  ${GUEST_EMAIL.toUpperCase()}  ` }),
      r,
      "booking-submitted"
    );

    expect(statusOf(si)).toBe(statusOf(r));
    expect(bodyOf(si).success).toBe(bodyOf(r).success);
  });
});

describe("RPT-16 — the `bookingId` branch behaviour is unchanged", () => {
  test("`bookingId` + no email → 400 'Guest email is required.' (the bookingId branch keeps its own message)", async () => {
    const res = mockResponse();
    await handleEmailTrigger(guestReq({ bookingId: leadBooking.id }), res, "booking-submitted");

    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).error).toBe("Guest email is required.");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("`bookingId` + wrong email → 404 'Booking not found.'", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingId: leadBooking.id, guestEmail: "attacker@example.test" }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res).error).toBe("Booking not found.");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("`bookingId` + correct email → 200 + one email", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      guestReq({ bookingId: leadBooking.id, guestEmail: GUEST_EMAIL }),
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("RPT-16 — the legitimate authenticated + staff flows are preserved", () => {
  test("a SIGNED-IN member resolving an `R-…` ref does NOT need to send `guestEmail`", async () => {
    // The BookingConfirmPage wire (per EC-02b): the success URL
    // carries `reservationRef || bookingRef`, so the early-checkin
    // POST can carry an `R-…` ref. The request is authenticated
    // (Bearer id token) → `req.user.uid` is set → the credential
    // gate must NOT demand a `guestEmail` in the body.
    const res = mockResponse();
    await handleEmailTrigger(
      {
        method: "POST",
        body: {
          bookingRef: RESERVATION_REF,
          request: { requestedCheckInTime: "10:00 AM", notes: "" }
        },
        user: { uid: "member_1", email: GUEST_EMAIL, email_verified: true }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).success).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("a signed-in member resolving an `SI-…` ref does NOT need to send `guestEmail` either", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingRef: BOOKING_REF, request: { requestedCheckInTime: "10:00 AM", notes: "" } },
        user: { uid: "member_1", email: GUEST_EMAIL, email_verified: true }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("a STAFF caller needs NO guest email for an `R-…` ref (the desk's resend path)", async () => {
    // Staff callers run with `requireGuestMatch: false` — the
    // credential check must not apply to them at all.
    const res = mockResponse();
    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingRef: RESERVATION_REF },
        staff: { success: true, uid: "admin_1", role: "admin" }
      } as any,
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("a STAFF caller needs NO guest email for an `SI-…` ref", async () => {
    const res = mockResponse();
    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingRef: BOOKING_REF },
        staff: { success: true, uid: "admin_1", role: "admin" }
      } as any,
      res,
      "booking-submitted"
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("RPT-16 — source tripwire (the gate must precede the reservations query)", () => {
  const emailHandlerSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email.ts"),
    "utf8"
  );
  const findBookingStart = emailHandlerSrc.indexOf("async function findBooking(");
  const findBookingEnd = emailHandlerSrc.indexOf("return booking;\n}", findBookingStart);
  const findBookingSlice =
    findBookingStart >= 0 && findBookingEnd > findBookingStart
      ? emailHandlerSrc.slice(findBookingStart, findBookingEnd + "return booking;\n}".length)
      : "";

  test("findBooking is locatable", () => {
    expect(findBookingSlice.length).toBeGreaterThan(0);
  });

  test("the credential gate is thrown BEFORE the `reservations` query", () => {
    const gateIndex = findBookingSlice.indexOf("Booking reference and guest email are required.");
    const reservationsQueryIndex = findBookingSlice.search(/\.collection\(\s*["']reservations["']\s*\)/);

    expect(gateIndex).toBeGreaterThan(-1);
    expect(reservationsQueryIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(reservationsQueryIndex);
  });

  test("the reservation branch compares the guest email case-insensitively", () => {
    expect(findBookingSlice).toMatch(/requiresGuestEmail/);
    expect(findBookingSlice).toMatch(/bookingEmail\s*!==\s*providedEmail/);
    expect(findBookingSlice).toMatch(/providedEmail\s*=\s*String\(guestEmail\)\.trim\(\)\.toLowerCase\(\)/);
  });
});

describe("RPT-16 follow-on — source tripwire (the `SI-…` branch must not use a case-sensitive filter)", () => {
  const emailHandlerSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email.ts"),
    "utf8"
  );
  const findBookingStart = emailHandlerSrc.indexOf("async function findBooking(");
  const findBookingEnd = emailHandlerSrc.indexOf("return booking;\n}", findBookingStart);
  const findBookingSlice =
    findBookingStart >= 0 && findBookingEnd > findBookingStart
      ? emailHandlerSrc.slice(findBookingStart, findBookingEnd + "return booking;\n}".length)
      : "";

  test("the `SI-…` branch no longer pushes the guest email into a Firestore equality filter", () => {
    // A `where("guestEmail", "==", …)` filter is CASE-SENSITIVE in
    // Firestore, which is what made the `SI-…` branch disagree with
    // the `R-…` branch.
    // The `.where(` prefix keeps the assertion on CODE, not on the
    // explanatory comment that names the old filter.
    expect(findBookingSlice).not.toMatch(/\.where\(\s*["']guestEmail["']\s*,\s*["']==["']/);
  });

  test("the `SI-…` branch compares the email in memory, case-insensitively", () => {
    expect(findBookingSlice).toMatch(/providedEmail\s*=\s*String\(guestEmail\)\.trim\(\)\.toLowerCase\(\)/);
    expect(findBookingSlice).toMatch(/bookingEmail\s*!==\s*providedEmail/);
  });

  test("a wrong email on the `SI-…` branch still returns null (the same 404)", () => {
    expect(findBookingSlice).toMatch(/if \(bookingEmail !== providedEmail\) return null;/);
  });
});
