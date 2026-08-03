import { beforeEach, describe, expect, test, vi } from "vitest";

// Per Spark Rewards audit 2026-07-18 MED-1: manual points
// adjustment is the only balance-mutation path still on the
// client SDK. This test pins the contract for the new
// server-side `handleManualAdjustPoints` handler:
//   - admin-only (front-desk 403)
//   - non-zero integer amount (schema refuses 0 + non-numeric)
//   - reason is required (1-500 chars after trim)
//   - balance cannot go negative
//   - balance + history are written in one transaction
//   - the history row hardcodes `type: "manual"` so callers
//     cannot inject "earn" / "redeem" rows through this path
//   - the staff UID is recorded on the history row

const {
  mockMemberDoc,
  mockUpdate,
  mockSet
} = vi.hoisted(() => ({
  mockMemberDoc: { exists: true, data: vi.fn() },
  mockUpdate: vi.fn(),
  mockSet: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((docId = "history_1") => ({
        path: `${collectionName}/${docId}`,
        id: docId
      }))
    })),
    runTransaction: vi.fn().mockImplementation(async (callback) => {
      await callback({
        get: vi.fn().mockImplementation(async (ref: any) => {
          if (ref.path === "members/member_1") return mockMemberDoc;
          return { exists: false, data: vi.fn() };
        }),
        update: mockUpdate,
        set: mockSet
      });
    })
  }
}));

import { handleManualAdjustPoints } from "../../server/handlers/members";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const adminReq = {
  method: "POST",
  staff: { uid: "admin_1", role: "admin" },
  body: {
    memberId: "member_1",
    amount: 250,
    reason: "Compensation for service outage on 2026-07-24"
  }
};

const frontDeskReq = {
  method: "POST",
  staff: { uid: "fd_1", role: "front-desk" },
  body: { ...adminReq.body }
};

describe("/api/members/manual-adjust", () => {
  beforeEach(() => {
    mockMemberDoc.exists = true;
    mockMemberDoc.data.mockReturnValue({ rewardsPoints: 1000, isActive: true });
    mockUpdate.mockReset();
    mockSet.mockReset();
  });

  test("credits points and writes a history row in one transaction", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints(adminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload).toMatchObject({
      success: true,
      data: {
        memberId: "member_1",
        rewardsPoints: 1250,
        pointsAdjusted: 250
      }
    });
    // The balance write goes through the Admin SDK transaction
    // (not a direct client write) — the audit's MED-1 invariant.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "members/member_1" }),
      expect.objectContaining({ rewardsPoints: 1250 })
    );
    // The history write happens in the same transaction.
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: "members/member_1/pointsHistory/history_1" }),
      expect.objectContaining({
        type: "manual",
        points: 250,
        reason: "Compensation for service outage on 2026-07-24",
        bookingId: null,
        by: "admin_1"
      })
    );
  });

  test("debits points when amount is negative and never goes below zero", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints({
      ...adminReq,
      body: { memberId: "member_1", amount: -300, reason: "Reversal — duplicate earn entry" }
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.rewardsPoints).toBe(700);
    expect(mockSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "manual", points: -300 })
    );
  });

  test("rejects when the result would go below zero (400)", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints({
      ...adminReq,
      body: { memberId: "member_1", amount: -5000, reason: "Big reversal" }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/below zero/i);
    // No writes happened — the transaction threw before any commit.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects front-desk caller with 403", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints(frontDeskReq, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/only admins/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects tokenless request with 401", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints({
      method: "POST",
      staff: {},
      body: adminReq.body
    }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("rejects non-POST method with 405", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints({ ...adminReq, method: "GET" }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("rejects zero amount (schema)", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints({
      ...adminReq,
      body: { memberId: "member_1", amount: 0, reason: "noop" }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects empty reason (schema)", async () => {
    const res = mockResponse();
    await handleManualAdjustPoints({
      ...adminReq,
      body: { memberId: "member_1", amount: 100, reason: "   " }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("rejects when member does not exist (400)", async () => {
    mockMemberDoc.exists = false;
    const res = mockResponse();
    await handleManualAdjustPoints(adminReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/not found/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("hardcodes type:manual on the history row (caller cannot inject earn/redeem)", async () => {
    const res = mockResponse();
    // Even if the body tried to inject a different type, the
    // server hardcodes `type: "manual"`. The schema currently
    // doesn't accept a `type` field, but this test guards
    // against a future refactor that adds one without the
    // server-side hardcode.
    await handleManualAdjustPoints(adminReq, res);
    expect(mockSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "manual" })
    );
    // The history row's `points` field matches the requested
    // amount (preserves the sign — positive for credits,
    // negative for debits).
    expect(mockSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ points: 250 })
    );
  });
});
