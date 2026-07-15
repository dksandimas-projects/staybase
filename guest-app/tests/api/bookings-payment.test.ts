import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockMembers, mockPayments, mockPointsHistory, mockUpdates, sendBookingTrigger } = vi.hoisted(() => {
  const mockPayments: Array<{ id?: string; amount: number; method?: string; note?: string }> = [];
  const mockBookings: Record<string, any> = {};
  const mockUpdates: Array<{ path: string; data: any }> = [];
  return {
    mockBookings,
    mockMembers: {} as Record<string, any>,
    mockPayments,
    mockPointsHistory: [] as Array<{ id: string; data: any }>,
    mockUpdates,
    sendBookingTrigger: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger,
  sendCorporateInquiryTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const bookingDocRef = (path: string) => {
    const segments = path.split("/");
    const collectionName = segments[0];
    const docId = segments[1] || "";
    const ref = {
      id: docId,
      path,
      get: async () => {
        const store = collectionName === "members" ? mockMembers : mockBookings;
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      },
      update: async (data: any) => {
        const store = collectionName === "members" ? mockMembers : mockBookings;
        if (store[docId]) {
          Object.assign(store[docId], data);
        }
        mockUpdates.push({ path, data });
      },
      collection: (sub: string) => {
        if (sub === "payments") {
          return {
            doc: (paymentId = `payment_${mockPayments.length + 1}`) => ({
              id: paymentId,
              set: async (data: any) => {
                mockPayments.push({ id: paymentId, ...data });
              }
            }),
            add: async (data: any) => {
              mockPayments.push(data);
              return { id: `payment_${mockPayments.length}` };
            },
            get: async () => ({
              docs: mockPayments.map((p, i) => ({
                id: p.id || `payment_${i + 1}`,
                data: () => p
              }))
            })
          };
        }
        if (sub === "pointsHistory") {
          return {
            doc: (historyId: string) => ({
              id: historyId,
              path: `${path}/pointsHistory/${historyId}`,
              set: async (data: any) => mockPointsHistory.push({ id: historyId, data })
            })
          };
        }
        return {
          add: async () => ({ id: "mock_sub_id" })
        };
      }
    };
    return ref;
  };

  // Per BF-14 (booking-flow audit 2026-06-26): handleAddPayment
  // now wraps the payment append + re-sum + status decision in
  // a Firestore transaction. The mock transaction mirrors the
  // calls the handler makes: get() reads from the underlying
  // ref's get(), set() routes writes to the doc/subcollection,
  // update() merges into the booking.
  const mockTransaction = {
    get: vi.fn().mockImplementation(async (ref: any) => {
      if (ref && typeof ref.get === "function") return ref.get();
      return { exists: false };
    }),
    set: vi.fn().mockImplementation((ref: any, data: any) => {
      if (ref && typeof ref.set === "function") return ref.set(data);
      if (ref?.path?.includes("/pointsHistory/")) {
        mockPointsHistory.push({ id: ref.id, data });
      } else if (ref?.path) mockUpdates.push({ path: ref.path, data });
    }),
    create: vi.fn().mockImplementation((ref: any, data: any) => {
      if (ref && typeof ref.set === "function") return ref.set(data);
    }),
    update: vi.fn().mockImplementation((ref: any, data: any) => {
      if (ref && typeof ref.update === "function") return ref.update(data);
    })
  };

  const mockHotelConfig = {
    paymentMethods: [
      { method: "cash", requireReferenceNumber: false },
      { method: "gcash", requireReferenceNumber: true },
      { method: "maya", requireReferenceNumber: true },
      { method: "bank", requireReferenceNumber: true }
    ]
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => {
        if (collName === "settings") {
          return {
            doc: () => ({
              get: async () => ({ exists: true, data: () => mockHotelConfig })
            })
          };
        }
        return {
          doc: (docId: string) => bookingDocRef(`${collName}/${docId}`)
        };
      }),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        return await callback(mockTransaction);
      })
    },
    adminAuth: {}
  };
});

import { handleAddPayment, handleVerifyAndRecordPayment } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const staffReq = (overrides: Record<string, any> = {}) => ({
  method: "POST",
  staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
  body: {
    bookingId: "booking_1",
    paymentId: "paymentRequest001",
    amount: 1500,
    method: "gcash",
    note: "First installment",
    ...overrides
  }
});

describe("/api/bookings/add-payment payment-confirmed trigger", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockMembers).forEach((k) => delete mockMembers[k]);
    mockPayments.length = 0;
    mockPointsHistory.length = 0;
    mockUpdates.length = 0;
    sendBookingTrigger.mockClear();
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      totalPrice: 5000,
      status: "pending"
    };
  });

  test("records a partial payment without firing payment-confirmed email", async () => {
    const res = mockResponse();

    await handleAddPayment(staffReq({ amount: 2000 }), res);

    expect(mockPayments).toHaveLength(1);
    expect(mockPayments[0].amount).toBe(2000);
    expect(mockBookings["booking_1"].status).toBe("pending");
    expect(sendBookingTrigger).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("replaying the same payment ID does not append a duplicate", async () => {
    const res1 = mockResponse();
    const res2 = mockResponse();

    await handleAddPayment(staffReq({ amount: 2000 }), res1);
    await handleAddPayment(staffReq({ amount: 2000 }), res2);

    expect(mockPayments).toHaveLength(1);
    expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotentReplay: true, totalPaid: 2000 })
    }));
  });

  test("rejects reuse of a payment ID for different payment details", async () => {
    await handleAddPayment(staffReq({ amount: 2000 }), mockResponse());
    const res = mockResponse();

    await handleAddPayment(staffReq({ amount: 2500 }), res);

    expect(mockPayments).toHaveLength(1);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test("fires payment-confirmed once the running total reaches totalPrice for a pending booking", async () => {
    mockPayments.push({ amount: 2000 });
    mockPayments.push({ amount: 1500 });

    const res = mockResponse();

    await handleAddPayment(staffReq({ amount: 1500 }), res);

    expect(sendBookingTrigger).toHaveBeenCalledTimes(1);
    expect(mockBookings["booking_1"]).toEqual(expect.objectContaining({
      status: "payment-confirmed",
      handledBy: "staff_1"
    }));
    expect(sendBookingTrigger).toHaveBeenCalledWith(
      "payment-confirmed",
      expect.objectContaining({
        bookingRef: "SI-20260615-001",
        guestEmail: "maria@example.test",
        totalPrice: 5000
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("fires payment-confirmed for a payment-uploaded booking when fully paid", async () => {
    mockBookings["booking_1"].status = "payment-uploaded";
    mockPayments.push({ amount: 5000 });

    const res = mockResponse();

    await handleAddPayment(staffReq({ amount: 5000 }), res);

    expect(sendBookingTrigger).toHaveBeenCalledTimes(1);
    expect(sendBookingTrigger).toHaveBeenCalledWith(
      "payment-confirmed",
      expect.objectContaining({ status: "payment-confirmed" })
    );
    expect(mockBookings["booking_1"].status).toBe("payment-confirmed");
  });

  test("uses the committed status transition to prevent duplicate confirmation email", async () => {
    mockBookings["booking_1"].status = "payment-confirmed";
    mockPayments.push({ amount: 5000 });

    const res = mockResponse();
    await handleAddPayment(staffReq({ amount: 100 }), res);

    expect(sendBookingTrigger).not.toHaveBeenCalled();
    expect(mockBookings["booking_1"].status).toBe("payment-confirmed");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("does not re-fire payment-confirmed if the booking is already confirmed", async () => {
    mockBookings["booking_1"].status = "confirmed";
    mockPayments.push({ amount: 5000 });

    const res = mockResponse();

    await handleAddPayment(staffReq({ amount: 5000 }), res);

    expect(sendBookingTrigger).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("rejects missing required fields", async () => {
    const res = mockResponse();

    await handleAddPayment({ method: "POST", staff: { email: "x" }, body: { bookingId: "booking_1" } } as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sendBookingTrigger).not.toHaveBeenCalled();
  });

  test("returns 404 when the booking does not exist", async () => {
    const res = mockResponse();

    await handleAddPayment(staffReq({ bookingId: "missing_booking" }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(sendBookingTrigger).not.toHaveBeenCalled();
  });

  test("awards deferred checkout points exactly when the final folio payment lands", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      totalPrice: 5000,
      status: "checked-out",
      memberId: "member_1",
      checkedOutFolioTotal: 5800,
      checkedOutWithBalance: 3800,
      pendingLoyaltyPoints: 500,
      loyaltyAwardStatus: "pending-payment",
      pointsAwarded: 0
    };
    mockMembers["member_1"] = { rewardsPoints: 100 };
    mockPayments.push({ amount: 2000 });

    const res = mockResponse();
    await handleAddPayment(staffReq({ amount: 3800 }), res);

    expect(mockBookings["booking_1"]).toEqual(expect.objectContaining({
      pointsAwarded: 500,
      pendingLoyaltyPoints: 0,
      loyaltyAwardStatus: "awarded",
      checkedOutWithBalance: 3800
    }));
    expect(mockMembers["member_1"].rewardsPoints).toBe(600);
    expect(mockPointsHistory).toHaveLength(1);
    expect(mockPointsHistory[0].data).toMatchObject({ type: "earn", points: 500, bookingId: "booking_1" });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ loyaltyPointsAwarded: 500 })
    }));
  });

  test("keeps deferred points pending on another partial payment", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      totalPrice: 5000,
      status: "checked-out",
      memberId: "member_1",
      checkedOutFolioTotal: 5800,
      checkedOutWithBalance: 3800,
      pendingLoyaltyPoints: 500,
      loyaltyAwardStatus: "pending-payment"
    };
    mockMembers["member_1"] = { rewardsPoints: 100 };
    mockPayments.push({ amount: 2000 });

    const res = mockResponse();
    await handleAddPayment(staffReq({ amount: 1000 }), res);

    expect(mockBookings["booking_1"].loyaltyAwardStatus).toBe("pending-payment");
    expect(mockMembers["member_1"].rewardsPoints).toBe(100);
    expect(mockPointsHistory).toHaveLength(0);
  });

  test("PRC-07: cash without transaction reference is accepted", async () => {
    const res = mockResponse();
    await handleAddPayment(staffReq({ amount: 1000, method: "cash" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const recordedPayment = mockPayments.find((p) => p.amount === 1000 && p.method === "cash");
    expect(recordedPayment).toBeDefined();
    expect((recordedPayment as any)?.transactionReference).toBeUndefined();
  });

  test("PRC-07: digital method with missing reference is rejected", async () => {
    const savedPaymentsLength = mockPayments.length;
    const res = mockResponse();
    await handleAddPayment(staffReq({ amount: 2000, method: "gcash" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringMatching(/Transaction reference is required/i)
    }));
    expect(mockPayments.length).toBe(savedPaymentsLength);
  });

  test("PRC-07: digital method with valid reference is accepted", async () => {
    const res = mockResponse();
    await handleAddPayment(staffReq({ amount: 1500, method: "gcash", transactionReference: "GCASH-REF-123" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const recordedPayment = mockPayments.find((p) => p.amount === 1500 && p.method === "gcash");
    expect(recordedPayment).toBeDefined();
    expect((recordedPayment as any)?.transactionReference).toBe("GCASH-REF-123");
  });

  test("PRC-09: legacy note without transactionReference renders as-is", async () => {
    const res = mockResponse();
    await handleAddPayment(staffReq({ amount: 800, method: "cash", note: "Legacy payment note from old system" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const recordedPayment = mockPayments.find((p) => p.amount === 800 && p.method === "cash");
    expect(recordedPayment).toBeDefined();
    expect((recordedPayment as any)?.note).toBe("Legacy payment note from old system");
    expect((recordedPayment as any)?.transactionReference).toBeUndefined();
  });
});

describe("PRC-19: Verify & Record Payment handler", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    mockPayments.length = 0;
    mockPointsHistory.length = 0;
    mockUpdates.length = 0;
    sendBookingTrigger.mockClear();
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260716-001",
      totalPrice: 5000,
      status: "payment-uploaded",
      paymentMethod: "gcash",
      paymentReferenceNumber: "ORIG-REF-001",
      paymentProofUrl: "https://example.com/proof.jpg",
      memberId: "member_1",
      guestEmail: "guest@example.com",
      guestName: "Test Guest"
    };
    mockMembers["member_1"] = { rewardsPoints: 100 };
  });

  test("creates payment entry and transitions status to payment-confirmed when fully paid", async () => {
    const req = { method: "POST", staff: { uid: "staff_1", email: "admin@sparkinn.com", role: "admin" }, body: { bookingId: "booking_1", amount: 5000, method: "gcash", transactionReference: "GCASH-VRF-001" } };
    const res = mockResponse();
    await handleVerifyAndRecordPayment(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const createdPayment = mockPayments.find((p) => (p as any).transactionReference === "GCASH-VRF-001");
    expect(createdPayment).toBeDefined();
    expect(mockBookings["booking_1"].status).toBe("payment-confirmed");
  });

  test("partial verification creates payment entry but does not transition status", async () => {
    const req = { method: "POST", staff: { uid: "staff_1", role: "admin" }, body: { bookingId: "booking_1", amount: 2000, method: "gcash", transactionReference: "GCASH-PARTIAL-001" } };
    const res = mockResponse();
    await handleVerifyAndRecordPayment(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const createdPayment = mockPayments.find((p) => (p as any).transactionReference === "GCASH-PARTIAL-001");
    expect(createdPayment).toBeDefined();
    expect(createdPayment?.amount).toBe(2000);
    expect(mockBookings["booking_1"].status).toBe("payment-uploaded");
  });

  test("rejects missing required fields", async () => {
    const res = mockResponse();
    await handleVerifyAndRecordPayment({ method: "POST", body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("rejects invalid amount (zero)", async () => {
    const req = { method: "POST", staff: { uid: "staff_1", role: "admin" }, body: { bookingId: "booking_1", amount: 0, method: "gcash", transactionReference: "GCASH-ZERO" } };
    const res = mockResponse();
    await handleVerifyAndRecordPayment(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
