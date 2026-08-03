import { beforeEach, describe, expect, test, vi } from "vitest";

// Per Spark Rewards audit 2026-07-18 MED-3 (decision #135):
// the front-desk manual-link path for "different email" booking
// reconciliation. This test pins the contract for
// `handleLinkBookingToMember`:
//   - admin-only (front-desk 403, tokenless 401)
//   - POST only (GET 405)
//   - strict schema: { memberUid, bookingId, reason (1..500) }
//   - member and booking must both exist
//   - cancelled bookings cannot be linked
//   - test-run bookings cannot be linked (test isolation invariant)
//   - bookings already linked to a DIFFERENT member → 409
//     (no silent overwrite, no unlink from this surface)
//   - re-linking a booking to the same member is idempotent
//     (no booking update, but the audit row is still written)
//   - the first link sets memberId + linkedByStaff + linkedAt +
//     linkedReason on the booking doc and writes an audit row under
//     bookings/audit/records/{bookingId}-link-{timestamp}

const {
  mockMemberDoc,
  mockBookingDoc,
  mockUpdate,
  mockSet,
  mockGet
} = vi.hoisted(() => ({
  mockMemberDoc: { exists: true, data: vi.fn() },
  mockBookingDoc: { exists: true, data: vi.fn() },
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockGet: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => {
      if (collectionName === "bookings") {
        // The handler writes an audit row under
        // `bookings/audit/records/{id}` — the same nested shape the
        // existing erasure handler uses (decision #49 / W1.4). The
        // mock needs the `doc("audit").collection("records").doc(...)`
        // chain to resolve, plus the flat `doc(bookingId)` for the
        // memberId write.
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
              id: docId
            };
          })
        };
      }
      // For "members" and any other collection, just return the flat
      // shape — sufficient for the member lookup.
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
    bookingId: "booking_1",
    reason: "Guest used Google sign-in but booked under work email"
  }
};

const baseFrontDeskReq = {
  ...baseAdminReq,
  staff: { uid: "fd_1", role: "front-desk" }
};

describe("/api/members/link-booking (MED-3)", () => {
  beforeEach(() => {
    mockMemberDoc.exists = true;
    mockMemberDoc.data.mockReturnValue({
      email: "member1@gmail.com",
      fullName: "Maria Santos",
      isActive: true
    });
    mockBookingDoc.exists = true;
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SPK-2026-0142",
      guestEmail: "maria.santos@workmail.com",
      status: "confirmed",
      memberId: null,
      testRunId: null
    });
    // The transaction's `get` dispatches by ref.path: the member
    // doc returns mockMemberDoc; the booking doc returns
    // mockBookingDoc; anything else returns { exists: false }.
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      if (ref.path === "bookings/booking_1") return mockBookingDoc;
      return { exists: false, data: vi.fn() };
    });
    mockUpdate.mockReset();
    mockSet.mockReset();
  });

  // ─── 1. Auth + method guards ──────────────────────────────────────

  test("rejects non-POST methods with 405", async () => {
    const res = mockResponse();
    await handleLinkBookingToMember({ ...baseAdminReq, method: "GET" }, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects tokenless request with 401", async () => {
    const res = mockResponse();
    await handleLinkBookingToMember({ ...baseAdminReq, staff: {} }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects front-desk caller with 403", async () => {
    const res = mockResponse();
    await handleLinkBookingToMember(baseFrontDeskReq, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/only admins/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  // ─── 2. Schema guards ─────────────────────────────────────────────

  test("rejects when the schema is missing a required field (400)", async () => {
    const res = mockResponse();
    await handleLinkBookingToMember({
      ...baseAdminReq,
      body: { memberUid: "member_1", bookingId: "booking_1" } // no reason
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/reason/i);
  });

  test("rejects when the reason is whitespace-only (400)", async () => {
    const res = mockResponse();
    await handleLinkBookingToMember({
      ...baseAdminReq,
      body: { ...baseAdminReq.body, reason: "   " }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects when the reason exceeds 500 characters (400)", async () => {
    const res = mockResponse();
    await handleLinkBookingToMember({
      ...baseAdminReq,
      body: { ...baseAdminReq.body, reason: "x".repeat(501) }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ─── 3. Lookup guards ─────────────────────────────────────────────

  test("rejects when the member does not exist (400)", async () => {
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return { exists: false, data: vi.fn() };
      if (ref.path === "bookings/booking_1") return mockBookingDoc;
      return { exists: false, data: vi.fn() };
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/member account was not found/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects when the booking does not exist (400)", async () => {
    mockGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_1") return mockMemberDoc;
      if (ref.path === "bookings/booking_1") return { exists: false, data: vi.fn() };
      return { exists: false, data: vi.fn() };
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/booking was not found/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  // ─── 4. Booking-state guards ──────────────────────────────────────

  test("rejects cancelled bookings (400)", async () => {
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SPK-2026-0142",
      guestEmail: "maria.santos@workmail.com",
      status: "cancelled",
      memberId: null,
      testRunId: null
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/cancelled/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects test-run bookings (400) — test isolation invariant", async () => {
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SPK-2026-0142",
      guestEmail: "maria.santos@workmail.com",
      status: "checked-out",
      memberId: null,
      testRunId: "test-run-Q3-launch"
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/test-run/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects when the booking is already linked to a DIFFERENT member (409)", async () => {
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SPK-2026-0142",
      guestEmail: "maria.santos@workmail.com",
      status: "confirmed",
      memberId: "member_OTHER", // ← different member
      testRunId: null
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/already linked to a different member/i);
    // No unlink from this surface — the staff must use the
    // booking-drawer memberId edit to unlink first.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  // ─── 5. Happy paths ───────────────────────────────────────────────

  test("links an unlinked booking: sets memberId + linkedBy/At/Reason + writes audit row", async () => {
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload).toMatchObject({
      success: true,
      data: {
        memberUid: "member_1",
        bookingId: "booking_1",
        bookingRef: "SPK-2026-0142",
        alreadyLinked: false
      }
    });

    // The booking doc got the memberId + audit fields.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "bookings/booking_1" }),
      expect.objectContaining({
        memberId: "member_1",
        linkedByStaff: "admin_1",
        linkedReason: "Guest used Google sign-in but booked under work email"
      })
    );
    // The audit row lives under bookings/audit/records/{id} (matches
    // the existing erasure audit shape — decision #49 / W1.4).
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^bookings\/audit\/records\/booking_1-link-/) }),
      expect.objectContaining({
        action: "manual-link-member",
        fromMemberId: null,
        toMemberId: "member_1",
        memberEmail: "member1@gmail.com",
        bookingEmail: "maria.santos@workmail.com",
        reason: "Guest used Google sign-in but booked under work email",
        staffUid: "admin_1",
        staffRole: "admin"
      })
    );
  });

  test("re-linking a booking to the SAME member is idempotent (no booking update, audit row still written)", async () => {
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SPK-2026-0142",
      guestEmail: "maria.santos@workmail.com",
      status: "confirmed",
      memberId: "member_1", // ← already linked to this member
      testRunId: null
    });
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data).toMatchObject({
      memberUid: "member_1",
      bookingId: "booking_1",
      alreadyLinked: true
    });
    // The booking doc was NOT rewritten (the existing memberId +
    // linkedBy/At/Reason stay intact).
    expect(mockUpdate).not.toHaveBeenCalled();
    // But the audit row IS written so the re-link is recorded.
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^bookings\/audit\/records\/booking_1-link-/) }),
      expect.objectContaining({
        action: "manual-link-member",
        fromMemberId: "member_1",
        toMemberId: "member_1"
      })
    );
  });

  test("the booking write is done through the Admin SDK transaction (not a direct client write)", async () => {
    // Per MED-1's posture (and the audit's defense-in-depth rule):
    // the link must be a server-side Admin SDK write, not a direct
    // client update. This test asserts the transaction ran and the
    // update was issued via the same transaction object the
    // existing manual-adjust endpoint uses.
    const res = mockResponse();
    await handleLinkBookingToMember(baseAdminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "bookings/booking_1" }),
      expect.objectContaining({ memberId: "member_1" })
    );
  });
});
