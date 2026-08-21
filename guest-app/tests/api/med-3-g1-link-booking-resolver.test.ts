// Per MED-3 build-variant follow-up G1 (operator-reported
// 2026-08-20, not yet shipped per the
// `plan/features/SPARK-REWARDS.md §Front-desk manual
// link` follow-up note): extend the handler's resolver
// at `guest-app/server/handlers/members.ts:808` to
// accept all three input shapes the staff actually
// paste:
//
// - `SPK-YYYYMMDD-NNNNN` (the human `bookingRef`,
//   matches `BOOKING_REF_REGEX`)
// - `R-YYYYMMDD-NNNNN` (the human `reservationRef`,
//   matches `RESERVATION_REF_REGEX`) — resolves to the
//   lead child via the reservation header
// - raw Firestore doc id (legacy pre-MRB-01 UUID-shaped
//   strings)
//
// The pre-G1 surface only did the doc-id lookup, so
// pasting a ref returned `{ exists: false }` → the
// catch mapped "was not found" to **400** with the
// verbatim "Booking was not found." message (the staff
// reasonably read this as a typo, not as "the server
// expected a doc id, you gave it a ref"). G1 also
// tightens the not-found branches to 404 + structured
// `code: "BOOKING_NOT_FOUND"` / `code:
// "RESERVATION_NOT_FOUND"` on the JSON response so the
// toast can branch on code, not prose (per
// `silent-rate-limit-fallback` skill's AFTER pattern).
//
// Test-first (per `plan/docs/CONTRIBUTING.md
// §Testing`): RED — this file pins the contract at the
// runtime level via the existing test mock harness
// (mirrors the `members-link-booking.test.ts` mock
// shape so the pre-G1 fixtures stay compatible).

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockMemberDoc,
  mockBookingDoc,
  mockReservationDoc,
  mockBookingsWhereQuery,
  mockReservationsWhereQuery,
  mockUpdate,
  mockSet,
  mockGet,
} = vi.hoisted(() => ({
  mockMemberDoc: { exists: true, data: vi.fn() },
  mockBookingDoc: { exists: true, data: vi.fn() },
  mockReservationDoc: { exists: true, data: vi.fn() },
  mockBookingsWhereQuery: vi.fn(),
  mockReservationsWhereQuery: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => {
      if (collectionName === "bookings") {
        return {
          doc: vi.fn().mockImplementation((docId: string) => {
            if (docId === "audit") {
              return {
                path: "bookings/audit",
                collection: vi.fn().mockImplementation(() => ({
                  doc: vi.fn().mockImplementation((auditId: string) => ({
                    path: `bookings/audit/records/${auditId}`,
                    id: auditId
                  }))
                }))
              };
            }
            return {
              path: `bookings/${docId}`,
              id: docId,
              // Forward to mockGet so the test's
              // path-based dispatch returns the right
              // doc for the transaction's
              // `transaction.get(bookingRef)`.
              get: vi.fn().mockImplementation(async function getImpl(this: any) {
                return mockGet(this);
              })
            };
          }),
          // G1: the resolver calls
          // `bookings.where("bookingRef", "==", input).limit(1).get()`
          // and
          // `bookings.where("reservationId", "==", id).limit(1).get()`.
          // Both surface via this `.where()` chain. The
          // mock resolves them through
          // `mockBookingsWhereQuery` (a hoisted vi.fn
          // that the test sets per scenario). The
          // `.limit(1)` chain returns the same
          // `mockBookingsWhereQuery()` so the `.get()`
          // call dispatches to the same mock —
          // production calls `.get()` on the result of
          // `.limit(1)`.
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => ({
              get: vi.fn().mockImplementation(() => Promise.resolve(mockBookingsWhereQuery()))
            })),
            get: vi.fn().mockImplementation(() => Promise.resolve(mockBookingsWhereQuery()))
          })),
        };
      }
      if (collectionName === "reservations") {
        return {
          // The resolver calls
          // `reservations.doc(reservationRef).get()`
          // for `R-…` shaped input — a single-doc
          // lookup.
          doc: vi.fn().mockImplementation((docId: string) => ({
            path: `reservations/${docId}`,
            id: docId,
            // The test's outer `mockGet` dispatches on
            // `ref.path` and returns
            // `mockReservationDoc` for the matching
            // reservation. The `get` method here
            // forwards the ref so the dispatch hits the
            // right branch.
            get: vi.fn().mockImplementation(async function getImpl(this: any) {
              return mockGet(this);
            })
          })),
          // The reservation-ref fallback path calls
          // `reservations.where("reservationRef", "==", input).get()`.
          where: vi.fn().mockImplementation(() => ({
            get: vi.fn().mockImplementation(() => Promise.resolve(mockReservationsWhereQuery()))
          })),
        };
      }
      return {
        doc: vi.fn().mockImplementation((docId: string) => ({
          path: `${collectionName}/${docId}`,
          id: docId
        }))
      };
    }),
    runTransaction: vi.fn().mockImplementation(async (callback) => {
      await callback({
        get: mockGet,
        update: mockUpdate,
        set: mockSet
      });
    })
  }
}));

import { handleLinkBookingToMember } from "../../server/handlers/members";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseAdminReq = {
  method: "POST",
  staff: { uid: "admin_1", role: "admin" },
  body: {
    memberUid: "member_1",
    bookingId: "SPK-20260820-00001", // G1: human booking ref shape
    reason: "Guest used Google sign-in but booked under work email"
  }
};

describe("/api/members/link-booking MED-3 G1 — resolver accepts bookingRef + reservationRef + doc id", () => {
  beforeEach(() => {
    mockMemberDoc.exists = true;
    mockMemberDoc.data.mockReturnValue({
      email: "member1@gmail.com",
      fullName: "Maria Santos",
      isActive: true
    });
    mockBookingDoc.exists = true;
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SPK-20260820-00001",
      guestEmail: "maria.santos@workmail.com",
      status: "confirmed",
      memberId: null,
      testRunId: null,
      reservationId: null
    });
    mockReservationDoc.exists = true;
    mockReservationDoc.data.mockReturnValue({
      reservationRef: "R-20260820-00001",
      leadBookingId: "booking_lead"
    });
    // Default: every resolver path returns empty (the test
    // sets a specific path's mock per scenario).
    mockBookingsWhereQuery.mockResolvedValue({ empty: true, docs: [] });
    mockReservationsWhereQuery.mockResolvedValue({ empty: true, docs: [] });
    // The transaction's `get` dispatches by ref.path.
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      if (ref.path.startsWith("bookings/")) return mockBookingDoc;
      if (ref.path.startsWith("reservations/")) return mockReservationDoc;
      return { exists: false, data: vi.fn() };
    });
    mockUpdate.mockReset();
    mockSet.mockReset();
  });

  // ─── G1.A: bookingRef lookup ──────────────────────────────────────

  test("G1.A1: resolves a `SPK-…` bookingRef via `bookings.where(bookingRef)` and links", async () => {
    mockBookingsWhereQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "booking_resolved", data: () => mockBookingDoc.data() }]
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    // The resolver routes the ref → booking doc id, so
    // the audit row + the update use the RESOLVED id,
    // not the raw ref string.
    expect(payload.data.bookingId).toBe("booking_resolved");
    expect(payload.data.bookingRef).toBe("SPK-20260820-00001");
  });

  test("G1.A2: returns 404 with `code: BOOKING_NOT_FOUND` when a `SPK-…` bookingRef matches no doc", async () => {
    // Both the where(bookingRef) and the doc-id fallback
    // miss.
    mockBookingsWhereQuery.mockResolvedValue({ empty: true, docs: [] });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("BOOKING_NOT_FOUND");
    expect(payload.error).toMatch(/was not found/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  // ─── G1.B: reservationRef lookup ──────────────────────────────────

  test("G1.B1: resolves a `R-…` reservationRef via `reservations.doc(ref)` and routes to the lead child", async () => {
    const req = {
      ...baseAdminReq,
      body: { ...baseAdminReq.body, bookingId: "R-20260820-00001" }
    };
    // The reservation header exists; the lead child
    // lookup returns the lead booking.
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      if (ref.path === "reservations/R-20260820-00001") return mockReservationDoc;
      if (ref.path === "bookings/booking_lead") return mockBookingDoc;
      return { exists: false, data: vi.fn() };
    });
    const res = mockResponse();
    await handleLinkBookingToMember(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.bookingId).toBe("booking_lead");
    expect(payload.data.bookingRef).toBe("SPK-20260820-00001");
  });

  test("G1.B2: returns 404 with `code: RESERVATION_NOT_FOUND` when an `R-…` reservationRef matches no reservation", async () => {
    const req = {
      ...baseAdminReq,
      body: { ...baseAdminReq.body, bookingId: "R-20260820-99999" }
    };
    // Reservation header doesn't exist; the
    // reservationRef fallback where-query also misses.
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      return { exists: false, data: vi.fn() };
    });
    mockReservationsWhereQuery.mockResolvedValue({ empty: true, docs: [] });
    const res = mockResponse();
    await handleLinkBookingToMember(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("RESERVATION_NOT_FOUND");
    expect(payload.error).toMatch(/reservation/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  // ─── G1.C: raw doc id (legacy) ────────────────────────────────────

  test("G1.C1: still accepts a raw Firestore doc id for legacy pre-MRB-01 bookings (back-compat)", async () => {
    // Input is neither a SPK-… nor an R-… ref — falls
    // through to the doc-id lookup on the transaction.
    const legacyReq = {
      ...baseAdminReq,
      body: { ...baseAdminReq.body, bookingId: "c749ebfa-6a50-40ac-acaf-d282dec0296e" }
    };
    const res = mockResponse();
    await handleLinkBookingToMember(legacyReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.bookingId).toBe("c749ebfa-6a50-40ac-acaf-d282dec0296e");
  });

  // ─── G1.D: status code tightening ─────────────────────────────────

  test("G1.D1: a 404 booking-not-found response is `code: BOOKING_NOT_FOUND` (NOT 400 with prose)", async () => {
    // The pre-G1 catch mapped "was not found" to 400.
    // G1 changes this to 404 + structured code so the
    // toast can branch on code, not prose.
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      return { exists: false, data: vi.fn() };
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.code).toBe("BOOKING_NOT_FOUND");
  });

  test("G1.D2: cancelled-booking and test-run-booking errors STAY at 400 (validation errors, not lookups)", async () => {
    // The pre-G1 mapping for "Cancelled bookings" /
    // "Test-run bookings" was 400 — G1 preserves that
    // shape (these are validation errors, not 404
    // lookups). The resolver routes the SPK-… input
    // through `bookings.where(bookingRef)`; the mock
    // returns the cancelled booking so the transaction
    // can throw the validation error.
    mockBookingsWhereQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{
        id: "cancelled_booking_id",
        data: () => ({
          bookingRef: "SPK-20260820-00001",
          guestEmail: "maria.santos@workmail.com",
          status: "cancelled",
          memberId: null,
          testRunId: null
        })
      }]
    });
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      if (ref.path === "bookings/cancelled_booking_id") return {
        exists: true,
        data: () => ({
          bookingRef: "SPK-20260820-00001",
          guestEmail: "maria.santos@workmail.com",
          status: "cancelled",
          memberId: null,
          testRunId: null
        })
      };
      return { exists: false, data: vi.fn() };
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/cancelled/i);
  });
});