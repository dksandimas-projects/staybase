import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockPayments, mockUpdates, sendBookingTrigger } = vi.hoisted(() => {
  const mockPayments: Array<{ amount: number }> = [];
  const mockBookings: Record<string, any> = {};
  const mockUpdates: Array<{ path: string; data: any }> = [];
  return {
    mockBookings,
    mockPayments,
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
    const docId = path.split("/").pop() || "";
    const ref = {
      id: docId,
      path,
      get: async () => {
        const booking = mockBookings[docId];
        return booking
          ? { exists: true, id: docId, data: () => booking }
          : { exists: false };
      },
      update: async (data: any) => {
        const booking = mockBookings[docId];
        if (booking) {
          Object.assign(booking, data);
        }
        mockUpdates.push({ path, data });
      },
      collection: (sub: string) => {
        if (sub === "payments") {
          return {
            doc: () => ({
              id: `payment_${mockPayments.length + 1}`,
              set: async (data: any) => {
                mockPayments.push(data);
              }
            }),
            add: async (data: any) => {
              mockPayments.push(data);
              return { id: `payment_${mockPayments.length}` };
            },
            get: async () => ({
              docs: mockPayments.map((p, i) => ({
                id: `payment_${i + 1}`,
                data: () => p
              }))
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
      if (ref?.path) mockUpdates.push({ path: ref.path, data });
    }),
    update: vi.fn().mockImplementation((ref: any, data: any) => {
      if (ref && typeof ref.update === "function") return ref.update(data);
    })
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => ({
        doc: (docId: string) => bookingDocRef(`${collName}/${docId}`)
      })),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        return await callback(mockTransaction);
      })
    },
    adminAuth: {}
  };
});

import { handleAddPayment } from "../../server/handlers/bookings";

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
    amount: 1500,
    method: "gcash",
    note: "First installment",
    ...overrides
  }
});

describe("/api/bookings/add-payment payment-confirmed trigger", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    mockPayments.length = 0;
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
    expect(sendBookingTrigger).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("fires payment-confirmed once the running total reaches totalPrice for a pending booking", async () => {
    mockPayments.push({ amount: 2000 });
    mockPayments.push({ amount: 1500 });

    const res = mockResponse();

    await handleAddPayment(staffReq({ amount: 1500 }), res);

    expect(sendBookingTrigger).toHaveBeenCalledTimes(1);
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
      expect.objectContaining({ status: "payment-uploaded" })
    );
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
});
