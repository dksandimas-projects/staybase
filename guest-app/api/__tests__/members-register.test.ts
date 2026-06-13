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

vi.mock("../lib/firebase-admin", () => {
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

import { handleRegisterMember } from "../handlers/members";

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
    name: "Guest Example"
  },
  body: {
    fullName: "Guest Example",
    phone: "+63 917 000 0000",
    authProvider: "email"
  }
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
        linkedBookings: 1
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
        linkedBookings: 0
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
});
