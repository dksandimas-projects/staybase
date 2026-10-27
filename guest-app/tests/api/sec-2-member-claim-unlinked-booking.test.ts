// SEC-2 — a member must not be able to CLAIM an unlinked booking.
//
// The defect (QA-REPORT-2026-10-21 §SEC-2, still open as of
// 2026-10-27): `POST /api/members/redeem-points-self` let any
// signed-in member adopt ANY booking whose `memberId` was unset.
//
// The old guard in `applyPointsRedemption` was:
//
//     const memberId = requestedMemberId || booking.memberId;
//     if (!memberId || (booking.memberId && requestedMemberId
//                       && requestedMemberId !== booking.memberId)) {
//       throw new Error("Booking is not linked to this member.");
//     }
//
// Read it carefully: the second clause only fires when
// `booking.memberId` is ALREADY SET and different. When
// `booking.memberId` is UNSET — which is the case for every
// anonymous booking — the clause is false, `memberId` falls back to
// the CALLER's uid, and the transaction then WRITES that uid onto
// the victim's booking. The victim's booking (with its public
// `lookupToken` cancel credential) moves into the attacker's
// portal.
//
// Production exposure measured on 2026-10-27: 144 of 157 bookings
// carry no `memberId`, `rewardsConfig.allowMemberPointsRedemption`
// is `true`, and 9 member accounts hold a positive points balance.
//
// The fix must distinguish the two actors. The STAFF path is
// intentionally allowed to link an unlinked booking (the front desk
// applying points to an anonymous booking is a deliberate,
// documented operation — see SPARK-REWARDS-PAIRING-ARCHIVE). The
// SELF path must NOT be: a member may only redeem against a
// booking that is ALREADY theirs.
//
// Both directions are pinned below:
//   1. the member's own linked booking  -> redemption proceeds
//   2. an UNLINKED booking              -> refused, nothing written
//   3. a booking linked to ANOTHER uid  -> refused, nothing written
//
// A gate that refuses everything is not a fix, so case 1 is the
// control that proves the door still opens for the right person.

import { beforeEach, describe, expect, test, vi } from "vitest";

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
  // The handler reads `settings/rewardsConfig` OUTSIDE the
  // transaction (the toggle fast-fail) — so a doc ref needs a
  // `get()` as well as a `path`.
  const createDocRef = (path: string) => ({
    path,
    get: vi.fn().mockImplementation(async () => {
      if (path === "settings/rewardsConfig") return mockRewardsConfigDoc;
      return { exists: false, data: vi.fn() };
    })
  });

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collectionName: string) => ({
        doc: vi.fn().mockImplementation((docId = "history_1") => createDocRef(`${collectionName}/${docId}`))
      })),
      runTransaction: vi.fn().mockImplementation(async (callback) => {
        return callback({
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
    },
    adminAuth: {
      verifyIdToken: vi.fn().mockResolvedValue({ uid: "member_1", email: "member@example.test" })
    }
  };
});

import { handleRedeemMemberPoints, handleRedeemPointsSelf } from "../../server/handlers/members";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const selfReq = {
  method: "POST",
  headers: { authorization: "Bearer member-token" },
  body: {
    bookingId: "booking_1",
    pointsToRedeem: 500
  }
};

const linkedBooking = {
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
};

describe("SEC-2 — the member self-service redemption path cannot claim an unlinked booking", () => {
  beforeEach(() => {
    mockBookingDoc.exists = true;
    mockMemberDoc.exists = true;
    mockRewardsConfigDoc.exists = true;
    mockBookingDoc.data.mockReturnValue({ ...linkedBooking });
    mockMemberDoc.data.mockReturnValue({
      isMember: true,
      isActive: true,
      rewardsPoints: 1000
    });
    // The toggle is ON in production (verified 2026-10-27), so the
    // suite exercises the path as it actually runs.
    mockRewardsConfigDoc.data.mockReturnValue({
      allowMemberPointsRedemption: true,
      pointsRedemptionRate: 100
    });
    mockUpdate.mockReset();
    mockSet.mockReset();
  });

  test("the member CAN redeem against a booking that is already linked to them", async () => {
    const res = mockResponse();

    await handleRedeemPointsSelf(selfReq, res);

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
    // The booking's own memberId is untouched — it was already the
    // caller's, and the redemption must not have rewritten it.
    const bookingUpdate = mockUpdate.mock.calls.find(([ref]) => ref.path === "bookings/booking_1")?.[1];
    expect(bookingUpdate?.memberId).toBe("member_1");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "members/member_1" }),
      expect.objectContaining({ rewardsPoints: 500 })
    );
  });

  test("an UNLINKED booking is refused — the member cannot claim it", async () => {
    // The defect: `memberId` is absent, exactly like the 144
    // anonymous bookings sitting in production.
    mockBookingDoc.data.mockReturnValue({ ...linkedBooking, memberId: undefined });
    const res = mockResponse();

    await handleRedeemPointsSelf(selfReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Booking is not linked to this member."
    });
    // NOTHING may be written: not the booking (which would adopt
    // the victim's booking), not the member's balance, not the
    // points ledger.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("a booking linked to ANOTHER member is refused", async () => {
    mockBookingDoc.data.mockReturnValue({ ...linkedBooking, memberId: "someone_else" });
    const res = mockResponse();

    await handleRedeemPointsSelf(selfReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Booking is not linked to this member."
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("an unlinked booking is refused even when the points amount is valid and the balance is sufficient", async () => {
    // Guards against a fix that only rejects when the balance is
    // short — the refusal must come from OWNERSHIP, not from the
    // arithmetic. Here the member has 1000 points and asks for 500,
    // well inside the balance, the bill cap and the min floor.
    mockBookingDoc.data.mockReturnValue({ ...linkedBooking, memberId: undefined });
    const res = mockResponse();

    await handleRedeemPointsSelf(selfReq, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Booking is not linked to this member."
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("the STAFF path still auto-links an unlinked booking — the front desk operation is unchanged", async () => {
    // The other direction of the same gate. The front desk applying
    // points to an anonymous booking is a DOCUMENTED, deliberate
    // operation (SPARK-REWARDS-PAIRING-ARCHIVE-2026-08-14), and that
    // route is admin-only at the router (SEC-3). If the fix had
    // tightened the shared guard instead of splitting it by actor,
    // this legitimate operation would have died with the hole.
    mockBookingDoc.data.mockReturnValue({ ...linkedBooking, memberId: undefined });
    const res = mockResponse();

    await handleRedeemMemberPoints(
      {
        method: "POST",
        staff: { uid: "admin_1", role: "admin" },
        body: { bookingId: "booking_1", memberId: "member_1", pointsToRedeem: 500 }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const bookingUpdate = mockUpdate.mock.calls.find(([ref]) => ref.path === "bookings/booking_1")?.[1];
    expect(bookingUpdate?.memberId).toBe("member_1");
  });
});
