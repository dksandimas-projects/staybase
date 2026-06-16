import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockMemberDoc,
  mockLinkedBookings,
  mockHistoryDocs,
  mockTransactionSet,
  mockTransactionUpdate,
  mockTransactionGet,
  mockBatchDelete,
  mockBatchCommit,
  mockMemberDelete,
  mockAuthDelete,
  mockMemberDocGet
} = vi.hoisted(() => ({
  mockMemberDoc: { exists: true, data: vi.fn() },
  mockLinkedBookings: [] as any[],
  mockHistoryDocs: [] as any[],
  mockTransactionSet: vi.fn(),
  mockTransactionUpdate: vi.fn(),
  mockTransactionGet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(),
  mockMemberDelete: vi.fn(),
  mockAuthDelete: vi.fn(),
  mockMemberDocGet: vi.fn()
}));

vi.mock("../lib/firebase-admin", () => ({
  adminAuth: {
    deleteUser: mockAuthDelete
  },
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => {
      if (collectionName === "bookings") {
        return {
          doc: vi.fn().mockImplementation((docId: string) => ({
            path: docId === "audit"
              ? "bookings/audit"
              : `bookings/${docId}`,
            collection: vi.fn().mockImplementation(() => ({
              doc: vi.fn().mockImplementation((auditId: string) => ({
                path: `bookings/audit/records/${auditId}`
              }))
            }))
          })),
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              forEach: (cb: any) => mockLinkedBookings.forEach(cb),
              docs: mockLinkedBookings
            })
          })
        };
      }
      if (collectionName === "members") {
        return {
          doc: vi.fn().mockImplementation((uid: string) => {
            const ref = { path: `members/${uid}` };
            return {
              ...ref,
              collection: vi.fn().mockImplementation((sub: string) => ({
                get: vi.fn().mockResolvedValue({
                  empty: mockHistoryDocs.length === 0,
                  size: mockHistoryDocs.length,
                  forEach: (cb: any) => mockHistoryDocs.forEach(cb),
                  docs: mockHistoryDocs
                })
              })),
              get: vi.fn().mockImplementation(() => mockMemberDocGet()),
              delete: mockMemberDelete
            };
          })
        };
      }
      return { doc: vi.fn() };
    }),
    runTransaction: vi.fn().mockImplementation(async (callback) => {
      await callback({
        get: mockTransactionGet,
        set: mockTransactionSet,
        update: mockTransactionUpdate
      });
    }),
    batch: vi.fn().mockReturnValue({
      delete: mockBatchDelete,
      commit: mockBatchCommit
    })
  }
}));

import { handleEraseMemberAccount } from "../handlers/members";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const authedReq = {
  method: "POST",
  user: { uid: "member_42", email: "member@sparkinn.com", name: "Test Member" },
  body: { confirmation: "erase-my-account" }
};

describe("/api/members/delete-account (audit S2.3, decision #49, W1.4)", () => {
  beforeEach(() => {
    mockTransactionSet.mockReset();
    mockTransactionUpdate.mockReset();
    mockTransactionGet.mockReset();
    mockBatchDelete.mockReset();
    mockBatchCommit.mockReset();
    mockMemberDelete.mockReset();
    mockAuthDelete.mockReset();
    mockMemberDocGet.mockReset();
    mockLinkedBookings.length = 0;
    mockHistoryDocs.length = 0;
    mockMemberDoc.exists = true;
    mockMemberDoc.data.mockReturnValue({
      fullName: "Test Member",
      email: "member@sparkinn.com",
      rewardsPoints: 250
    });
    mockTransactionGet.mockImplementation(async (ref: any) => {
      if (ref.path === "members/member_42") return mockMemberDoc;
      return { exists: false, data: vi.fn() };
    });
    mockMemberDocGet.mockResolvedValue(mockMemberDoc);
    mockAuthDelete.mockResolvedValue(undefined);
    mockMemberDelete.mockResolvedValue(undefined);
  });

  test("rejects when no auth user is on the request", async () => {
    const req = { method: "POST", user: {}, body: { confirmation: "erase-my-account" } };
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("rejects when confirmation string is missing or wrong", async () => {
    const req = { method: "POST", user: { uid: "member_42", email: "x@x.test" }, body: { confirmation: "nope" } };
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("returns 404 when the member document does not exist", async () => {
    mockMemberDoc.exists = false;
    const req = authedReq;
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Member account was not found."
    });
  });

  test("writes an audit record and anonymizes each linked booking", async () => {
    mockLinkedBookings.push(
      {
        id: "booking_a",
        ref: { path: "bookings/booking_a" },
        data: () => ({
          bookingRef: "SI-20260616-001",
          roomId: "room_201",
          roomNumber: "201",
          roomType: "deluxe",
          checkIn: "2026-06-20",
          checkOut: "2026-06-22",
          numNights: 2,
          numGuests: 2,
          totalPrice: 4500,
          status: "checked-out",
          source: "online",
          createdAt: "2026-06-10T00:00:00Z",
          memberId: "member_42"
        })
      }
    );

    const req = authedReq;
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);

    // Audit record written to bookings/audit/records/booking_a
    expect(mockTransactionSet).toHaveBeenCalledWith(
      { path: "bookings/audit/records/booking_a" },
      expect.objectContaining({
        bookingRef: "SI-20260616-001",
        roomType: "deluxe",
        checkIn: "2026-06-20",
        checkOut: "2026-06-22",
        numNights: 2,
        totalPrice: 4500,
        status: "checked-out",
        erasedByUid: "member_42"
      })
    );

    // Booking doc anonymized — no PII, no memberId
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      { path: "bookings/booking_a" },
      expect.objectContaining({
        memberId: null,
        guestName: "Erased",
        guestEmail: "erased@invalid",
        guestPhone: "",
        erasedByUid: "member_42"
      })
    );

    // Member doc flagged as erased + PII blanked (3rd arg is the merge
    // option used by `set(memberRef, ..., { merge: true })`)
    expect(mockTransactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: "members/member_42" }),
      expect.objectContaining({
        isErased: true,
        isActive: false,
        rewardsPoints: 0,
        fullName: "Erased",
        email: "erased@invalid"
      }),
      { merge: true }
    );
  });

  test("recursively deletes the pointsHistory subcollection in a batch", async () => {
    mockHistoryDocs.push(
      { ref: { path: "members/member_42/pointsHistory/h1" } },
      { ref: { path: "members/member_42/pointsHistory/h2" } },
      { ref: { path: "members/member_42/pointsHistory/h3" } }
    );

    const req = authedReq;
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);

    expect(mockBatchDelete).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ deletedHistoryCount: 3 })
      })
    );
  });

  test("deletes the member doc and the Firebase Auth user", async () => {
    const req = authedReq;
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);

    expect(mockMemberDelete).toHaveBeenCalledTimes(1);
    expect(mockAuthDelete).toHaveBeenCalledWith("member_42");
  });

  test("treats auth/user-not-found as success (idempotent)", async () => {
    mockAuthDelete.mockRejectedValueOnce({ code: "auth/user-not-found" });
    const req = authedReq;
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  test("returns the audit + anonymize + history counts in the response", async () => {
    mockLinkedBookings.push(
      { id: "b1", ref: { path: "bookings/b1" }, data: () => ({ bookingRef: "X1", memberId: "member_42" }) },
      { id: "b2", ref: { path: "bookings/b2" }, data: () => ({ bookingRef: "X2", memberId: "member_42" }) }
    );
    mockHistoryDocs.push(
      { ref: { path: "members/member_42/pointsHistory/h1" } }
    );

    const req = authedReq;
    const res = mockResponse();
    await handleEraseMemberAccount(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        uid: "member_42",
        auditBookingsCount: 2,
        anonymizedBookingsCount: 2,
        deletedHistoryCount: 1,
        erasedAt: expect.any(String)
      }
    });
  });
});
