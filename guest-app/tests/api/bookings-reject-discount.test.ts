import { beforeEach, describe, expect, test, vi } from "vitest";

// Per BF-05 (booking-flow audit 2026-06-26): the
// `originalTotalPrice` stored on the booking at creation time
// was `subtotal - voucherDiscount`, which was correct only when
// a voucher was also applied. The reject-discount handler then
// restored `totalPrice` to that value. Without a voucher, the
// stored value was `null` and the handler 500'd. The fix stores
// the full pre-Senior/PWD `subtotal` and the reject handler
// subtracts the voucher deduction on the fly.

const { sendBookingTrigger } = vi.hoisted(() => ({
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger,
  sendStaffNewBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendStaffNewPaymentTrigger: vi.fn().mockResolvedValue(undefined),
  sendCorporateInquiryTrigger: vi.fn(),
  sendContactInquiryTrigger: vi.fn(),
  sendEarlyCheckinRequestTrigger: vi.fn(),
  sendVoucherIssuedTrigger: vi.fn(),
  sendStoreOrderTrigger: vi.fn()
}));

let mockBookings: Record<string, any> = {};
const updateCalls: Array<{ ref: string; data: any }> = [];

vi.mock("../../server/lib/resend", () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: "mock_email_id" }) } }
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (path: string) => {
    const [coll, docId] = path.split("/");
    return {
      id: docId,
      path,
      get: async () => {
        if (coll === "bookings" && mockBookings[docId]) {
          return { exists: true, id: docId, data: () => mockBookings[docId] };
        }
        return { exists: false };
      },
      update: async (data: any) => {
        if (coll === "bookings" && mockBookings[docId]) {
          mockBookings[docId] = { ...mockBookings[docId], ...data };
        }
        updateCalls.push({ ref: path, data });
      }
    };
  };
  return {
    adminDb: {
      doc: vi.fn().mockImplementation((path: string) => docRef(path)),
      collection: vi.fn().mockImplementation((collName: string) => ({
        doc: (id: string) => docRef(`${collName}/${id}`)
      })),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => callback({
        get: async (ref: any) => ref.get(),
        update: async (ref: any, data: any) => ref.update(data)
      }))
    },
    adminAuth: { verifyIdToken: vi.fn() }
  };
});

import { handleApplyBookingDiscount, handleRejectDiscount } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseStaffReq = (body: any) => ({
  method: "POST",
  body,
  staff: { uid: "staff_uid_1", email: "frontdesk@sparkinn.com", role: "front-desk" }
} as any);

describe("BF-05 — handleRejectDiscount restores totalPrice to pre-Senior/PWD subtotal, minus voucher deduction", () => {
  beforeEach(() => {
    mockBookings = {};
    updateCalls.length = 0;
    sendBookingTrigger.mockClear();
  });

  test("rejects with senior + voucher: restores to subtotal - voucherDiscount", async () => {
    // Subtotal = 4000 (2 nights @ 2000). Senior discount 20% = 800.
    // After senior = 3200. Voucher flat 500. After voucher = 2700.
    // originalTotalPrice (pre-senior) = 4000.
    // Reject: restore to 4000 - 500 = 3500.
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260601-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      totalPrice: 2700,
      originalTotalPrice: 4000,
      discountType: "senior",
      discountPct: 20,
      voucherCode: "PROMO500",
      voucherDiscount: 500
    };

    const res = mockResponse();
    await handleRejectDiscount(baseStaffReq({ bookingId: "booking_1" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateData = updateCalls.find((c) => c.ref === "bookings/booking_1")?.data;
    expect(updateData.totalPrice).toBe(3500);
    expect(updateData.discountPct).toBe(0);
    expect(updateData).not.toHaveProperty("status");
    expect(mockBookings["booking_1"].totalPrice).toBe(3500);
  });

  test("rejects with senior only (no voucher): restores to full subtotal", async () => {
    // Subtotal = 4000. Senior 20% = 800. After senior = 3200.
    // originalTotalPrice (pre-senior) = 4000.
    // Reject: restore to 4000 - 0 = 4000.
    mockBookings["booking_2"] = {
      bookingRef: "SI-20260601-002",
      guestName: "Juan Dela Cruz",
      guestEmail: "juan@example.test",
      totalPrice: 3200,
      originalTotalPrice: 4000,
      discountType: "pwd",
      discountPct: 20,
      voucherCode: "",
      voucherDiscount: 0
    };

    const res = mockResponse();
    await handleRejectDiscount(baseStaffReq({ bookingId: "booking_2" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateData = updateCalls.find((c) => c.ref === "bookings/booking_2")?.data;
    expect(updateData.totalPrice).toBe(4000);
    expect(mockBookings["booking_2"].totalPrice).toBe(4000);
  });

  test("rejects with senior + voucher where voucher would underflow: clamps to 0", async () => {
    // Edge case: subtotal 4000, voucher 4000, senior 20% = 800.
    // After senior = 3200, after voucher = 3200 - 4000 = -800 (clamped to 0).
    // originalTotalPrice = 4000.
    // Reject: 4000 - 4000 = 0.
    mockBookings["booking_3"] = {
      bookingRef: "SI-20260601-003",
      guestName: "Edge Case",
      guestEmail: "edge@example.test",
      totalPrice: 0,
      originalTotalPrice: 4000,
      discountType: "senior",
      discountPct: 20,
      voucherCode: "BIGDEAL",
      voucherDiscount: 4000
    };

    const res = mockResponse();
    await handleRejectDiscount(baseStaffReq({ bookingId: "booking_3" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateData = updateCalls.find((c) => c.ref === "bookings/booking_3")?.data;
    expect(updateData.totalPrice).toBe(0);
  });

  test("preserves redeemed points and rebuilds the breakdown after rejection", async () => {
    mockBookings["booking_points"] = {
      bookingRef: "SI-20260601-005",
      guestName: "Points Member",
      guestEmail: "points@example.test",
      totalPrice: 2_700,
      originalTotalPrice: 4_000,
      discountType: "senior",
      discountPct: 20,
      voucherDiscount: 0,
      memberDiscountPct: 10,
      pointsRedeemedValue: 500,
      rateBreakdown: {
        roomSubtotal: 3_500,
        roomLines: [{ label: "Regular rate", subtotal: 3_500 }],
        addOns: [{ label: "Breakfast add-on", amount: 500 }],
        deductions: [],
        finalTotal: 2_700
      }
    };

    const res = mockResponse();
    await handleRejectDiscount(baseStaffReq({ bookingId: "booking_points" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateData = updateCalls.find((c) => c.ref === "bookings/booking_points")?.data;
    expect(updateData.totalPrice).toBe(3_100);
    expect(updateData.rateBreakdown.finalTotal).toBe(3_100);
    expect(updateData.rateBreakdown.deductions).toEqual([
      { label: "Spark Rewards member discount (10%)", amount: 400 },
      { label: "Spark Rewards points redeemed", amount: 500 }
    ]);
  });

  test("rejects when originalTotalPrice is null: returns 500 (guard remains)", async () => {
    // Defensive: bookings that pre-date the fix (or somehow have
    // a missing originalTotalPrice) still 500 instead of silently
    // mis-computing.
    mockBookings["booking_4"] = {
      bookingRef: "SI-20260601-004",
      guestName: "Legacy",
      guestEmail: "legacy@example.test",
      totalPrice: 2000,
      originalTotalPrice: null,
      discountType: "senior",
      discountPct: 20,
      voucherCode: "",
      voucherDiscount: 0
    };

    const res = mockResponse();
    await handleRejectDiscount(baseStaffReq({ bookingId: "booking_4" }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.error).toBe("Original total price not stored on booking.");
    // No update was written.
    expect(updateCalls.find((c) => c.ref === "bookings/booking_4")).toBeUndefined();
  });
});

describe("FL-03 — handleApplyBookingDiscount preserves legacy booking prices", () => {
  beforeEach(() => {
    mockBookings = {};
    updateCalls.length = 0;
  });

  test("uses totalPrice when a legacy booking has no original total or rate breakdown", async () => {
    mockBookings["legacy_booking"] = {
      bookingRef: "SI-LEGACY-001",
      totalPrice: 4_000,
      originalTotalPrice: null,
      rateBreakdown: null,
      status: "confirmed",
      discountType: "",
      voucherCode: "",
      memberDiscountPct: 0,
      pointsRedeemedValue: 0
    };

    const res = mockResponse();
    await handleApplyBookingDiscount(baseStaffReq({ bookingId: "legacy_booking", discountType: "senior" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateData = updateCalls.find((c) => c.ref === "bookings/legacy_booking")?.data;
    expect(updateData.originalTotalPrice).toBe(4_000);
    expect(updateData.totalPrice).toBe(3_200);
  });

  test("rejects instead of writing zero when no legacy pricing basis exists", async () => {
    mockBookings["invalid_legacy_booking"] = {
      bookingRef: "SI-LEGACY-002",
      totalPrice: undefined,
      originalTotalPrice: null,
      rateBreakdown: null,
      status: "confirmed",
      discountType: "",
      voucherCode: ""
    };

    const res = mockResponse();
    await handleApplyBookingDiscount(baseStaffReq({ bookingId: "invalid_legacy_booking", discountType: "pwd" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(updateCalls.find((c) => c.ref === "bookings/invalid_legacy_booking")).toBeUndefined();
  });
});
