// Per RSQ-01 (2026-11-19): the desk-facing RESEND path for the
// "your booking changed" email.
//
// THE DEFECT (pre-fix): the `booking-rescheduled` template + the
// `sendBookingTrigger` action existed, and the inline reschedule
// path fired them after every room/date move — but the action was
// in NEITHER the public nor the staff-only email allowlist in
// `guest-app/server/apiRouter.ts`. `POST /api/email/booking-
// rescheduled` therefore fell through to the router's fallback 404
// and the desk could NOT re-send a guest notification whose
// delivery had failed.
//
// THE FIX (three parts):
//   1. the router registers `booking-rescheduled` as a STAFF-ONLY
//      action (same posture as `booking-confirmed`);
//   2. the resend renders the RESERVATION-SCOPE view (every room
//      in the block), matching what the inline path sent — the
//      generic resend path hands the trigger a single booking doc,
//      which for an N-room reservation renders only the lead room;
//   3. a delivery failure is surfaced to the caller (the route
//      answers 500 instead of a false 200).
//
// This file pins the RUNTIME contract. The caller-side wiring
// (the `emailQueued` flag on the reschedule + add-room responses)
// is pinned at `rsq-01-reschedule-email-queued.test.ts`; the
// admin-app side is pinned at
// `admin-app/src/__tests__/rsq-01-reschedule-email-wiring.test.ts`.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockResendSend,
  mockFailedEmailAdd,
  mockConsoleError,
  mockBookings,
  mockReservations
} = vi.hoisted(() => ({
  mockResendSend: vi.fn(),
  mockFailedEmailAdd: vi.fn(),
  mockConsoleError: vi.spyOn(console, "error").mockImplementation(() => {}),
  mockBookings: {} as Record<string, any>,
  mockReservations: {} as Record<string, any>
}));

vi.mock("../../server/lib/resend", () => ({
  resend: { emails: { send: mockResendSend } },
  getResend: () => ({ emails: { send: mockResendSend } })
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const storeFor = (coll: string): Record<string, any> => {
    if (coll === "bookings") return mockBookings;
    if (coll === "reservations") return mockReservations;
    return {};
  };
  const docRef = (coll: string, id: string) => {
    const store = storeFor(coll);
    return {
      path: `${coll}/${id}`,
      id,
      get: async () => {
        const data = store[id];
        return data
          ? { exists: true, id, data: () => data }
          : { exists: false, id, data: () => undefined };
      },
      set: async (data: any) => {
        store[id] = data;
      },
      update: async (data: any) => {
        store[id] = { ...(store[id] || {}), ...data };
      }
    };
  };
  const collectionChain = (coll: string): any => ({
    _coll: coll,
    doc: (id?: string) => docRef(coll, id || "auto_id"),
    where: function () { return this; },
    limit: function () { return this; },
    get: async function () {
      const store = storeFor(coll);
      const docs = Object.entries(store).map(([id, data]) => ({
        id,
        data: () => data
      }));
      return { empty: docs.length === 0, docs };
    },
    add: async (data: any) => {
      mockFailedEmailAdd(data);
      return { id: "dlq-row" };
    }
  });
  return {
    adminDb: {
      collection: vi.fn().mockImplementation((coll: string) => collectionChain(coll))
    },
    adminAuth: {}
  };
});

import { handleEmailTrigger } from "../../server/handlers/email";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const staffRequest = (bookingId: string) => ({
  method: "POST",
  body: { bookingId },
  staff: { success: true, role: "front-desk", uid: "staff-1" }
}) as any;

const sentCall = () => mockResendSend.mock.calls[0]?.[0] || {};

describe("RSQ-01 — the desk can re-send the `booking-rescheduled` notification", () => {
  beforeEach(() => {
    mockResendSend.mockReset();
    mockResendSend.mockResolvedValue({ id: "resend-1" });
    mockFailedEmailAdd.mockReset();
    mockConsoleError.mockClear();
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockReservations).forEach((k) => delete mockReservations[k]);
  });

  test("a staff resend sends the 'Booking updated' email to the guest", async () => {
    mockBookings["b1"] = {
      bookingRef: "SI-20261119-00001",
      guestEmail: "guest@sparkinn.test",
      guestName: "Test Guest",
      roomType: "deluxe",
      roomName: "Deluxe Sea View",
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      numNights: 2,
      numAdults: 2,
      totalPrice: 8500,
      status: "confirmed"
    };

    const res = mockResponse();
    await handleEmailTrigger(staffRequest("b1"), res, "booking-rescheduled");

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(sentCall().to).toBe("guest@sparkinn.test");
    expect(String(sentCall().subject)).toContain("Booking updated");
    expect(String(sentCall().subject)).toContain("SI-20261119-00001");
  });

  test("a multi-room reservation resend renders EVERY room (reservation scope)", async () => {
    mockReservations["r1"] = {
      reservationRef: "R-20261119-00001",
      leadGuestName: "Test Guest",
      leadGuestEmail: "guest@sparkinn.test",
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      numNights: 2,
      totalPrice: 17000
    };
    mockBookings["b1"] = {
      bookingRef: "SI-20261119-00001",
      reservationId: "r1",
      reservationPosition: 1,
      guestEmail: "guest@sparkinn.test",
      guestName: "Test Guest",
      roomType: "deluxe",
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      totalPrice: 8500,
      status: "confirmed"
    };
    mockBookings["b2"] = {
      bookingRef: "SI-20261119-00002",
      reservationId: "r1",
      reservationPosition: 2,
      guestEmail: "guest@sparkinn.test",
      guestName: "Test Guest",
      roomType: "deluxe",
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      totalPrice: 8500,
      status: "confirmed"
    };

    const res = mockResponse();
    await handleEmailTrigger(staffRequest("b1"), res, "booking-rescheduled");

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    // The subject switches to the reservation-scope shape.
    expect(String(sentCall().subject)).toContain("R-20261119-00001");
    expect(String(sentCall().subject)).toContain("(2 rooms)");
    // BOTH rooms are listed in the body — the per-child view would
    // have rendered only the lead room.
    const html = String(sentCall().html);
    expect(html).toContain("SI-20261119-00001");
    expect(html).toContain("SI-20261119-00002");
  });

  test("a delivery failure is surfaced to the caller (500, not a false 200)", async () => {
    mockResendSend.mockRejectedValueOnce(new Error("Resend API timeout"));
    mockBookings["b1"] = {
      bookingRef: "SI-20261119-00001",
      guestEmail: "guest@sparkinn.test",
      guestName: "Test Guest",
      roomType: "deluxe",
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      status: "confirmed"
    };

    const res = mockResponse();
    await handleEmailTrigger(staffRequest("b1"), res, "booking-rescheduled");

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    // The DLQ write still happened (per #11) so the desk banner
    // lists the failure.
    expect(mockFailedEmailAdd).toHaveBeenCalledTimes(1);
  });

  test("an unknown booking answers 404 (no email attempted)", async () => {
    const res = mockResponse();
    await handleEmailTrigger(staffRequest("missing"), res, "booking-rescheduled");

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockResendSend).not.toHaveBeenCalled();
  });
});
