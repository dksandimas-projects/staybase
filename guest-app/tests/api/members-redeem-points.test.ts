import { beforeEach, describe, expect, test, vi } from "vitest";
import { assertBookingFinanceInvariant } from "@spark-inn/shared";

const {
  mockBookingDoc,
  mockMemberDoc,
  mockRewardsConfigDoc,
  mockUpdate,
  mockSet
} = vi.hoisted(() => ({
  mockBookingDoc: { exists: true, data: vi.fn() },
  mockMemberDoc: { exists: true, data: vi.fn() },
  mockRewardsConfigDoc: { exists: true, data: vi.fn() },
  mockUpdate: vi.fn(),
  mockSet: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const createDocRef = (path: string) => ({ path });

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collectionName: string) => ({
        doc: vi.fn().mockImplementation((docId = "history_1") => createDocRef(`${collectionName}/${docId}`))
      })),
      runTransaction: vi.fn().mockImplementation(async (callback) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref.path === "bookings/booking_1") return mockBookingDoc;
            if (ref.path === "members/member_1") return mockMemberDoc;
            if (ref.path === "settings/rewardsConfig") return mockRewardsConfigDoc;
            return { exists: false, data: vi.fn() };
          }),
          update: mockUpdate,
          set: mockSet
        });
      })
    }
  };
});

import { handleRedeemMemberPoints, handleUndoMemberPointsRedemption } from "../../server/handlers/members";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const staffReq = {
  method: "POST",
  staff: { uid: "staff_1", role: "front-desk" },
  body: {
    bookingId: "booking_1",
    memberId: "member_1",
    pointsToRedeem: 500
  }
};

const adminReq = {
  method: "POST",
  staff: { uid: "admin_1", role: "admin" },
  body: {
    bookingId: "booking_1"
  }
};

describe("/api/members/redeem-points", () => {
  beforeEach(() => {
    mockBookingDoc.exists = true;
    mockMemberDoc.exists = true;
    mockRewardsConfigDoc.exists = true;
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SI-20260615-001",
      memberId: "member_1",
      status: "confirmed",
      totalPrice: 5000,
      pointsRedeemed: 0,
      pointsRedeemedValue: 0,
      rateBreakdown: {
        roomSubtotal: 4500,
        roomLines: [{
          source: "regular",
          label: "Regular rate",
          startDate: "2026-06-15",
          endDate: "2026-06-17",
          nights: 2,
          nightlyRate: 2250,
          subtotal: 4500
        }],
        addOns: [{ label: "Breakfast add-on", amount: 500 }],
        deductions: [],
        finalTotal: 5000
      }
    });
    mockMemberDoc.data.mockReturnValue({
      isMember: true,
      isActive: true,
      rewardsPoints: 1000
    });
    mockRewardsConfigDoc.data.mockReturnValue({
      pointsRedemptionRate: 100
    });
    mockUpdate.mockReset();
    mockSet.mockReset();
  });

  test("rejects insufficient balance", async () => {
    mockMemberDoc.data.mockReturnValue({
      isMember: true,
      isActive: true,
      rewardsPoints: 100
    });
    const res = mockResponse();

    await handleRedeemMemberPoints(staffReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Insufficient points balance."
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("updates booking total, member balance, and points history together", async () => {
    const res = mockResponse();

    await handleRedeemMemberPoints(staffReq, res);

    expect(mockUpdate).toHaveBeenCalledWith({ path: "bookings/booking_1" }, expect.objectContaining({
      totalPrice: 4500,
      pointsRedeemed: 500,
      pointsRedeemedValue: 500,
      pointsRedeemedBy: "staff_1",
      rateBreakdown: expect.objectContaining({
        roomSubtotal: 4500,
        addOns: [{ label: "Breakfast add-on", amount: 500 }],
        deductions: [{ label: "Spark Rewards points redeemed", amount: 500 }],
        finalTotal: 4500
      })
    }));
    expect(mockUpdate).toHaveBeenCalledWith({ path: "members/member_1" }, expect.objectContaining({
      rewardsPoints: 500
    }));
    const bookingUpdate = mockUpdate.mock.calls.find(([ref]) => ref.path === "bookings/booking_1")?.[1];
    assertBookingFinanceInvariant(bookingUpdate);
    expect(mockSet).toHaveBeenCalledWith({ path: "members/member_1/pointsHistory/history_1" }, expect.objectContaining({
      type: "redeem",
      points: -500,
      bookingId: "booking_1",
      by: "staff_1"
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        bookingId: "booking_1",
        memberId: "member_1",
        pointsRedeemed: 500,
        pointsRedeemedValue: 500,
        totalPrice: 4500,
        rewardsPoints: 500
      })
    });
  });

  test("rejects undo after check-in", async () => {
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SI-20260615-001",
      memberId: "member_1",
      status: "checked-in",
      totalPrice: 4500,
      pointsRedeemed: 500,
      pointsRedeemedValue: 500
    });
    const res = mockResponse();

    await handleUndoMemberPointsRedemption(adminReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Points redemption can only be undone while the booking is confirmed."
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("admin undo restores booking total, member balance, and logs reversal", async () => {
    mockBookingDoc.data.mockReturnValue({
      bookingRef: "SI-20260615-001",
      memberId: "member_1",
      status: "confirmed",
      totalPrice: 4500,
      pointsRedeemed: 500,
      pointsRedeemedValue: 500,
      rateBreakdown: {
        roomSubtotal: 4500,
        roomLines: [{
          source: "regular",
          label: "Regular rate",
          startDate: "2026-06-15",
          endDate: "2026-06-17",
          nights: 2,
          nightlyRate: 2250,
          subtotal: 4500
        }],
        addOns: [{ label: "Breakfast add-on", amount: 500 }],
        deductions: [{ label: "Spark Rewards points redeemed", amount: 500 }],
        finalTotal: 4500
      }
    });
    mockMemberDoc.data.mockReturnValue({
      rewardsPoints: 500
    });
    const res = mockResponse();

    await handleUndoMemberPointsRedemption(adminReq, res);

    expect(mockUpdate).toHaveBeenCalledWith({ path: "bookings/booking_1" }, expect.objectContaining({
      totalPrice: 5000,
      pointsRedeemed: 0,
      pointsRedeemedValue: 0,
      pointsRedeemedBy: null,
      pointsRedeemedAt: null,
      rateBreakdown: expect.objectContaining({
        roomSubtotal: 4500,
        addOns: [{ label: "Breakfast add-on", amount: 500 }],
        deductions: [],
        finalTotal: 5000
      })
    }));
    expect(mockUpdate).toHaveBeenCalledWith({ path: "members/member_1" }, expect.objectContaining({
      rewardsPoints: 1000
    }));
    const bookingUpdate = mockUpdate.mock.calls.find(([ref]) => ref.path === "bookings/booking_1")?.[1];
    assertBookingFinanceInvariant(bookingUpdate);
    expect(mockSet).toHaveBeenCalledWith({ path: "members/member_1/pointsHistory/history_1" }, expect.objectContaining({
      type: "manual",
      points: 500,
      bookingId: "booking_1",
      by: "admin_1"
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
