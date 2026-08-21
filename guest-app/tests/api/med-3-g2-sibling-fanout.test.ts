// Per MED-3 G2 (build-variant follow-up 2026-08-20):
// when the staff links a member to a multi-room
// reservation via `handleLinkBookingToMember`, the
// transaction now fans the `memberId` write out to
// EVERY sibling in the reservation (not just the lead
// child). Pre-G2, the transaction only wrote to the
// booking doc the resolver returned — so the member's
// My Stays list (which queries
// `bookings.where("memberId", "==", uid)` at
// `members.ts:192`) only showed the lead child of N>1
// reservations. G2 closes that gap.
//
// Test-first (per `plan/docs/CONTRIBUTING.md
// §Testing`): RED — this file pins the contract at
// the runtime level. The pre-G1 + G1 tests at
// `med-3-g1-link-booking-resolver.test.ts` and
// `members-link-booking.test.ts` continue to pass —
// G2 is additive (the existing single-doc write is
// preserved when `reservationId` is null).

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockMemberDoc,
  mockBookingDoc,
  mockBookingDocs,
  mockReservationDoc,
  mockBookingsWhereQuery,
  mockReservationsWhereQuery,
  mockUpdate,
  mockSet,
  mockGet,
  txUpdateCalls,
  txSetCalls
} = vi.hoisted(() => ({
  mockMemberDoc: { exists: true, data: vi.fn() },
  mockBookingDoc: { exists: true, data: vi.fn() },
  mockBookingDocs: new Map<string, any>(),
  mockReservationDoc: { exists: true, data: vi.fn() },
  mockBookingsWhereQuery: vi.fn(),
  mockReservationsWhereQuery: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockGet: vi.fn(),
  txUpdateCalls: [] as Array<{ ref: any; data: any }>,
  txSetCalls: [] as Array<{ ref: any; data: any }>,
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
              get: vi.fn().mockImplementation(async function getImpl(this: any) {
                return mockGet(this);
              })
            };
          }),
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
          doc: vi.fn().mockImplementation((docId: string) => ({
            path: `reservations/${docId}`,
            id: docId,
            get: vi.fn().mockImplementation(async function getImpl(this: any) {
              return mockGet(this);
            })
          })),
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
      // Reset the per-transaction call loggers so
      // each test's assertions are isolated.
      txUpdateCalls.length = 0;
      txSetCalls.length = 0;
      const tx = {
        get: mockGet,
        update: vi.fn().mockImplementation((ref: any, data: any) => {
          txUpdateCalls.push({ ref, data });
          return Promise.resolve();
        }),
        set: vi.fn().mockImplementation((ref: any, data: any) => {
          txSetCalls.push({ ref, data });
          return Promise.resolve();
        })
      };
      await callback(tx);
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
    bookingId: "SPK-20260820-00001",
    reason: "Guest used Google sign-in but booked under work email"
  }
};

describe("/api/members/link-booking MED-3 G2 — MRB-aware sibling fan-out", () => {
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
    mockBookingsWhereQuery.mockResolvedValue({ empty: true, docs: [] });
    mockReservationsWhereQuery.mockResolvedValue({ empty: true, docs: [] });
    mockBookingDocs.clear();
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      if (ref.path.startsWith("bookings/")) {
        return mockBookingDocs.get(ref.path) || { exists: false, data: vi.fn() };
      }
      if (ref.path.startsWith("reservations/")) return mockReservationDoc;
      return { exists: false, data: vi.fn() };
    });
    mockUpdate.mockReset();
    mockSet.mockReset();
  });

  // ─── G2.A: N=1 (no reservationId) — unchanged behavior ─────

  test("G2.A1: a single-room link (no reservationId) writes ONLY to the resolved booking — no sibling fan-out", async () => {
    // The pre-G2 behavior is preserved: a booking
    // without a `reservationId` is a legacy
    // single-room path, the transaction writes to
    // exactly one booking doc.
    mockBookingsWhereQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "booking_solo", data: () => mockBookingDoc.data() }]
    });
    mockBookingDocs.set("bookings/booking_solo", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00001",
        guestEmail: "maria.santos@workmail.com",
        status: "confirmed",
        memberId: null,
        testRunId: null,
        reservationId: null
      })
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Exactly ONE transaction.update call (the
    // single booking). The fan-out skipped because
    // `reservationId` is null.
    expect(txUpdateCalls).toHaveLength(1);
    expect(txUpdateCalls[0].ref.id || txUpdateCalls[0].ref.path).toContain("booking_solo");
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.bookingId).toBe("booking_solo");
    expect(payload.data.linkedBookingIds).toEqual(["booking_solo"]);
  });

  // ─── G2.B: N>=2 (reservationId set) — sibling fan-out ─────

  test("G2.B1: an N=2 reservation link fans the memberId write out to BOTH siblings", async () => {
    // Pre-G2: the transaction only wrote to the
    // lead. Post-G2: the transaction queries the
    // siblings in the same `runTransaction` and
    // stamps `memberId` on every one.
    mockBookingsWhereQuery.mockImplementation(() => {
      // Two call sites in production:
      // 1. `resolveBookingForLink` — bookings.where(bookingRef)
      //    resolves the SPK-… input to the lead doc id.
      // 2. Inside the transaction — bookings.where(reservationId)
      //    returns all N siblings.
      const callIndex = mockBookingsWhereQuery.mock.calls.length - 1;
      if (callIndex === 0) {
        return Promise.resolve({
          empty: false,
          docs: [{
            id: "booking_lead",
            data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {}
          }]
        });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          { id: "booking_lead", data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {} },
          { id: "booking_sibling_1", data: () => mockBookingDocs.get("bookings/booking_sibling_1")?.data() || {} }
        ]
      });
    });
    mockBookingDocs.set("bookings/booking_lead", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00001",
        guestEmail: "maria.santos@workmail.com",
        status: "confirmed",
        memberId: null,
        testRunId: null,
        reservationId: "R-20260820-00001"
      })
    });
    mockBookingDocs.set("bookings/booking_sibling_1", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00002",
        status: "confirmed",
        memberId: null,
        testRunId: null,
        reservationId: "R-20260820-00001"
      })
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // TWO transaction.update calls: lead + sibling.
    const updateIds = txUpdateCalls.map((c) => c.ref.id || c.ref.path);
    expect(updateIds).toHaveLength(2);
    expect(updateIds.some((id) => id.includes("booking_lead"))).toBe(true);
    expect(updateIds.some((id) => id.includes("booking_sibling_1"))).toBe(true);
    // Both writes carry the same memberId + linkedReason.
    txUpdateCalls.forEach((c) => {
      expect(c.data.memberId).toBe("member_1");
      expect(c.data.linkedReason).toBe("Guest used Google sign-in but booked under work email");
    });
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.linkedBookingIds).toEqual(
      expect.arrayContaining(["booking_lead", "booking_sibling_1"])
    );
    expect(payload.data.linkedBookingIds).toHaveLength(2);
  });

  test("G2.B2: an N=3 reservation link fans the memberId write to all 3 siblings", async () => {
    mockBookingsWhereQuery.mockImplementation(() => {
      const callIndex = mockBookingsWhereQuery.mock.calls.length - 1;
      if (callIndex === 0) {
        return Promise.resolve({
          empty: false,
          docs: [{
            id: "booking_lead",
            data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {}
          }]
        });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          { id: "booking_lead", data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {} },
          { id: "booking_sibling_1", data: () => mockBookingDocs.get("bookings/booking_sibling_1")?.data() || {} },
          { id: "booking_sibling_2", data: () => mockBookingDocs.get("bookings/booking_sibling_2")?.data() || {} }
        ]
      });
    });
    ["booking_lead", "booking_sibling_1", "booking_sibling_2"].forEach((id) => {
      mockBookingDocs.set(`bookings/${id}`, {
        exists: true,
        data: () => ({
          bookingRef: `SPK-20260820-${id.slice(-2)}`,
          status: "confirmed",
          memberId: null,
          testRunId: null,
          reservationId: "R-20260820-00001"
        })
      });
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(txUpdateCalls).toHaveLength(3);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.linkedBookingIds).toHaveLength(3);
  });

  test("G2.B3: the audit row carries linkedBookingIds + reservationId + reservationRef for MRB links", async () => {
    mockBookingsWhereQuery.mockImplementation(() => {
      const callIndex = mockBookingsWhereQuery.mock.calls.length - 1;
      if (callIndex === 0) {
        return Promise.resolve({
          empty: false,
          docs: [{
            id: "booking_lead",
            data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {}
          }]
        });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          { id: "booking_lead", data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {} },
          { id: "booking_sibling_1", data: () => mockBookingDocs.get("bookings/booking_sibling_1")?.data() || {} }
        ]
      });
    });
    mockBookingDocs.set("bookings/booking_lead", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00001",
        guestEmail: "maria.santos@workmail.com",
        status: "confirmed",
        memberId: null,
        testRunId: null,
        reservationId: "R-20260820-00001",
        reservationRef: "R-20260820-00001"
      })
    });
    mockBookingDocs.set("bookings/booking_sibling_1", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00002",
        status: "confirmed",
        memberId: null,
        testRunId: null,
        reservationId: "R-20260820-00001",
        reservationRef: "R-20260820-00001"
      })
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // The audit row set() call carries the
    // linkedBookingIds cluster so a future auditor
    // can see "the staff linked the WHOLE
    // reservation" vs "the staff linked a single
    // child".
    const auditSet = txSetCalls.find((c) =>
      (c.ref.path || "").includes("bookings/audit/records/")
    );
    expect(auditSet).toBeDefined();
    expect(auditSet!.data.action).toBe("manual-link-member");
    expect(auditSet!.data.linkedBookingIds).toEqual(
      expect.arrayContaining(["booking_lead", "booking_sibling_1"])
    );
    expect(auditSet!.data.reservationId).toBe("R-20260820-00001");
  });

  // ─── G2.C: idempotency — siblings already linked to the same member are skipped ─────

  test("G2.C1: re-linking the same member to a reservation skips siblings already linked to that member (no overwrite)", async () => {
    // The fan-out must be idempotent: re-linking a
    // booking to the same member is a no-op for
    // siblings that already carry that memberId
    // (matches the pre-G2 single-doc idempotency
    // guard at line 845).
    mockBookingsWhereQuery.mockImplementation(() => {
      const callIndex = mockBookingsWhereQuery.mock.calls.length - 1;
      if (callIndex === 0) {
        return Promise.resolve({
          empty: false,
          docs: [{ id: "booking_lead", data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {} }]
        });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          { id: "booking_lead", data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {} },
          { id: "booking_sibling_1", data: () => mockBookingDocs.get("bookings/booking_sibling_1")?.data() || {} }
        ]
      });
    });
    mockBookingDocs.set("bookings/booking_lead", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00001",
        status: "confirmed",
        memberId: "member_1", // already linked
        testRunId: null,
        reservationId: "R-20260820-00001"
      })
    });
    mockBookingDocs.set("bookings/booking_sibling_1", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00002",
        status: "confirmed",
        memberId: "member_1", // already linked
        testRunId: null,
        reservationId: "R-20260820-00001"
      })
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // ZERO transaction.update calls (both already linked)
    // but the audit row still writes.
    expect(txUpdateCalls).toHaveLength(0);
    const auditSet = txSetCalls.find((c) =>
      (c.ref.path || "").includes("bookings/audit/records/")
    );
    expect(auditSet).toBeDefined();
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.alreadyLinked).toBe(true);
    expect(payload.data.linkedBookingIds).toEqual(
      expect.arrayContaining(["booking_lead", "booking_sibling_1"])
    );
  });

  // ─── G2.D: conflict guard — siblings already linked to a DIFFERENT member are 409 ─────

  test("G2.D1: a sibling already linked to a DIFFERENT member causes a 409 (no silent overwrite)", async () => {
    // The pre-G2 conflict guard at line 837
    // (`existingMemberId !== memberUid → 409`) was
    // scoped to the resolved booking only. G2
    // extends the guard to every sibling in the
    // same reservation: if ANY sibling is linked
    // to a different member, the whole link fails
    // 409 with a clear message.
    mockBookingsWhereQuery.mockImplementation(() => {
      const callIndex = mockBookingsWhereQuery.mock.calls.length - 1;
      if (callIndex === 0) {
        return Promise.resolve({
          empty: false,
          docs: [{
            id: "booking_lead",
            data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {}
          }]
        });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          { id: "booking_lead", data: () => mockBookingDocs.get("bookings/booking_lead")?.data() || {} },
          { id: "booking_sibling_1", data: () => mockBookingDocs.get("bookings/booking_sibling_1")?.data() || {} }
        ]
      });
    });
    mockBookingDocs.set("bookings/booking_lead", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00001",
        status: "confirmed",
        memberId: null, // not linked — OK
        testRunId: null,
        reservationId: "R-20260820-00001"
      })
    });
    mockBookingDocs.set("bookings/booking_sibling_1", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00002",
        status: "confirmed",
        memberId: "other_member_99", // DIFFERENT member
        testRunId: null,
        reservationId: "R-20260820-00001"
      })
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/different member/i);
    // No transaction.update or transaction.set fired
    // (the transaction rolled back).
    expect(txUpdateCalls).toHaveLength(0);
    expect(txSetCalls).toHaveLength(0);
  });

  // ─── G2.E: pre-MRB-01 single-room back-compat ─────

  test("G2.E1: a legacy pre-MRB-01 booking (no reservationId) keeps the pre-G2 single-doc write", async () => {
    // The G2 fan-out is conditional on
    // `bookingData.reservationId` being set. Legacy
    // pre-MRB-01 bookings + N=1 reservations have
    // no `reservationId` and skip the sibling
    // query entirely.
    mockBookingsWhereQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "legacy_booking", data: () => ({}) }]
    });
    mockBookingDocs.set("bookings/legacy_booking", {
      exists: true,
      data: () => ({
        bookingRef: "SPK-20260820-00001",
        guestEmail: "maria.santos@workmail.com",
        status: "confirmed",
        memberId: null,
        testRunId: null
        // No reservationId — legacy pre-MRB-01.
      })
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(txUpdateCalls).toHaveLength(1);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.linkedBookingIds).toEqual(["legacy_booking"]);
  });
});