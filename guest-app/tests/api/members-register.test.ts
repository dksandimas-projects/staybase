import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockMemberDoc, mockCounterDoc, mockBookingDocs, mockSet, mockUpdate, mockBatchUpdate, mockBatchCommit } = vi.hoisted(() => ({
  mockMemberDoc: { exists: false, data: vi.fn() },
  mockCounterDoc: { exists: false, data: vi.fn() },
  mockBookingDocs: [] as any[],
  mockSet: vi.fn(),
  mockUpdate: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn(),
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const memberRef = { path: "members/member_123" };
  const counterRef = { path: "counters/memberNumbers" };

  const collection = vi.fn().mockImplementation((collectionName: string) => {
    if (collectionName === "members") {
      return { doc: vi.fn().mockReturnValue(memberRef) };
    }
    if (collectionName === "counters") {
      return { doc: vi.fn().mockReturnValue(counterRef) };
    }
    if (collectionName === "bookings") {
      return {
        doc: vi.fn().mockImplementation((id: string) => ({ path: `bookings/${id}` })),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: mockBookingDocs })
        })
      };
    }
    return { doc: vi.fn() };
  });

  return {
    adminDb: {
      collection,
      batch: vi.fn().mockReturnValue({
        update: mockBatchUpdate,
        commit: mockBatchCommit
      }),
      runTransaction: vi.fn().mockImplementation(async (callback) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref.path === "members/member_123") return mockMemberDoc;
            if (ref.path === "counters/memberNumbers") return mockCounterDoc;
            return { exists: false, data: vi.fn() };
          }),
          set: mockSet,
          update: mockUpdate
        });
      })
    }
  };
});

import { handleListMemberStays, handleRegisterMember } from "../../server/handlers/members";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const authedReq = {
  method: "POST",
  user: {
    uid: "member_123",
    email: "Guest@Example.test",
    // Per Spark Rewards audit 2026-07-18 HIGH-1: tests assume the
    // authed user has a verified email so the link/stays matchers
    // still work. The unverified-path tests override this field.
    email_verified: true,
    name: "Guest Example"
  },
  body: {
    fullName: "Guest Example",
    phone: "+63 917 000 0000",
    authProvider: "email"
  }
};

const unverifiedAuthedReq = {
  ...authedReq,
  user: { ...authedReq.user, email_verified: false }
};

describe("/api/members/register handler", () => {
  beforeEach(() => {
    mockMemberDoc.exists = false;
    mockMemberDoc.data.mockReturnValue({});
    mockCounterDoc.exists = false;
    mockCounterDoc.data.mockReturnValue({});
    mockBookingDocs.length = 0;
    mockSet.mockReset();
    mockUpdate.mockReset();
    mockBatchUpdate.mockReset();
    mockBatchCommit.mockReset();
  });

  test("creates a member with the next sequential member number", async () => {
    mockCounterDoc.exists = true;
    mockCounterDoc.data.mockReturnValue({ count: 41 });
    mockBookingDocs.push({
      ref: { path: "bookings/booking_1" },
      data: () => ({ memberId: null })
    });
    const res = mockResponse();

    await handleRegisterMember(authedReq, res);

    expect(mockSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fullName: "Guest Example",
      email: "guest@example.test",
      memberNumber: "SR-00042",
      isMember: true,
      rewardsPoints: 0,
      tier: "standard"
    }), { merge: true });
    expect(mockBatchUpdate).toHaveBeenCalledWith({ path: "bookings/booking_1" }, expect.objectContaining({
      memberId: "member_123"
    }));
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        memberId: "member_123",
        memberNumber: "SR-00042",
        linkedBookings: 1,
        emailVerified: true
      }
    });
  });

  test("is idempotent for an existing member number", async () => {
    mockMemberDoc.exists = true;
    mockMemberDoc.data.mockReturnValue({
      memberNumber: "SR-00007",
      isMember: true,
      memberSince: new Date("2026-01-01")
    });
    const res = mockResponse();

    await handleRegisterMember(authedReq, res);

    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      isMember: true
    }));
    expect(mockSet).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        memberId: "member_123",
        memberNumber: "SR-00007",
        linkedBookings: 0,
        emailVerified: true
      }
    });
  });

  test("requires an authenticated user", async () => {
    const res = mockResponse();

    await handleRegisterMember({ method: "POST", body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("rejects non-POST method", async () => {
    const res = mockResponse();

    await handleRegisterMember({ ...authedReq, method: "GET" }, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("lists deduped member stays through a guest-safe projection", async () => {
    mockBookingDocs.push(
      {
        id: "booking_1",
        ref: { path: "bookings/booking_1" },
        data: () => ({
          bookingRef: "SI-20260710-001",
          lookupToken: "lookup_1",
          roomNumber: "101",
          roomType: "standard",
          roomName: "Standard Room",
          guestEmail: "guest@example.test",
          memberId: "member_123",
          checkIn: new Date("2026-07-10T00:00:00.000Z"),
          checkOut: new Date("2026-07-12T00:00:00.000Z"),
          numNights: 2,
          totalPrice: 5000,
          status: "pending",
          hasBreakfast: true,
          paymentProofUrl: "https://example.test/private-proof.jpg",
          remarks: "Internal staff note"
        })
      },
      {
        id: "booking_2",
        ref: { path: "bookings/booking_2" },
        data: () => ({
          bookingRef: "SI-20260701-001",
          lookupToken: "lookup_2",
          guestEmail: "guest@example.test",
          memberId: "",
          checkIn: new Date("2026-07-01T00:00:00.000Z"),
          checkOut: new Date("2026-07-02T00:00:00.000Z"),
          status: "checked-out"
        })
      }
    );
    const res = mockResponse();

    await handleListMemberStays({ ...authedReq, method: "GET" }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.stays).toHaveLength(2);
    expect(payload.data.stays[0]).toMatchObject({
      id: "booking_1",
      bookingRef: "SI-20260710-001",
      lookupToken: "lookup_1",
      checkIn: "2026-07-10",
      checkOut: "2026-07-12",
      status: "pending",
      hasBreakfast: true
    });
    expect(payload.data.stays[0]).not.toHaveProperty("paymentProofUrl");
    expect(payload.data.stays[0]).not.toHaveProperty("remarks");
  });

  // Per Spark Rewards audit 2026-07-18 HIGH-1: an unverified
  // email/password user must not be able to read their past
  // bookings. The server returns a structured 403 with
  // `code: "EMAIL_NOT_VERIFIED"` so the client can render the
  // "verify your email" prompt. Same gate is enforced at the
  // router level for /api/email/early-checkin-request.
  test("rejects stays list with EMAIL_NOT_VERIFIED when email is unverified", async () => {
    const res = mockResponse();
    await handleListMemberStays({ ...unverifiedAuthedReq, method: "GET" }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload).toMatchObject({
      success: false,
      code: "EMAIL_NOT_VERIFIED"
    });
    expect(payload.error).toMatch(/verify your email/i);
  });

  test("skips linkBookingsByEmail when the registering user's email is unverified", async () => {
    mockCounterDoc.exists = true;
    mockCounterDoc.data.mockReturnValue({ count: 41 });
    mockBookingDocs.push({
      ref: { path: "bookings/booking_1" },
      data: () => ({ memberId: null })
    });
    const res = mockResponse();

    await handleRegisterMember(unverifiedAuthedReq, res);

    // The member record is still created (the user is a member,
    // just without past-booking linkage until they verify).
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      memberNumber: "SR-00042",
      isMember: true
    }), { merge: true });
    // But the booking batch is NOT updated (no stranger's
    // booking takeover).
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data).toMatchObject({
      memberNumber: "SR-00042",
      linkedBookings: 0,
      emailVerified: false
    });
    // The non-blocking warning is surfaced so the client can
    // render a "verify your email" prompt.
    expect(payload.warning).toMatch(/verify your email/i);
  });
});
