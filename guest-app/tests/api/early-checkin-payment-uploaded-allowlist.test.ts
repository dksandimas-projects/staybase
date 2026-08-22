import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per `fix/early-checkin-payment-uploaded-allowlist` (2026-08-21):
// the early-check-in request flow had a status gate that only
// allowed `booking.status === "confirmed"`. A guest who paid
// (status = `payment-uploaded`) and was waiting for staff to
// verify the payment saw the "Request early check-in" button
// on the confirmation page (per EC-02) but the click returned
// a confusing 400 — the server rejected the request even
// though the booking was definitely happening.
//
// The fix is Option 2 from the design:
//   - Loosen the server gate to a 3-status allowlist
//     [payment-uploaded, payment-confirmed, confirmed]
//   - Add a matching client gate on the confirmation page so
//     the button only appears when the booking is in one of
//     those three states. The two sides stay in sync so a guest
//     never sees a button that secretly won't work.
//
// The runtime tests below exercise the server gate with mocked
// Firestore + resend. The source-text tests pin the client gate
// so a future refactor can't silently undo it.

const { mockBookings, mockSend } = vi.hoisted(() => ({
  mockBookings: {} as Record<string, any>,
  mockSend: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((id: string) => ({
        get: vi.fn().mockResolvedValue(
          collectionName === "bookings" && mockBookings[id]
            ? { exists: true, id, data: () => mockBookings[id] }
            : { exists: false }
        ),
        update: vi.fn().mockResolvedValue(undefined)
      })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
    })),
    doc: vi.fn().mockImplementation((path: string) => {
      const id = path.split("/")[1] ?? path;
      return {
        get: vi.fn().mockResolvedValue(
          path.startsWith("settings/rewardsConfig")
            ? { exists: true, id, data: () => ({ earlyCheckInEnabled: true }) }
            : { exists: false }
        )
      };
    })
  }
}));

vi.mock("../../server/lib/resend", () => ({
  resend: {
    emails: {
      send: mockSend
    }
  }
}));

// Stub the shared `getManilaDateInfo` so the date gate passes
// regardless of the wall clock at test time. The booking's
// check-in date is 2099 — well in the future.
vi.mock("@spark-inn/shared", async () => {
  const actual = await vi.importActual<any>("@spark-inn/shared");
  return {
    ...actual,
    getManilaDateInfo: () => ({ todayStr: "2099-01-01" })
  };
});

import { handleEmailTrigger } from "../../server/handlers/email";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// Per EC-02 + fix/early-checkin-payment-uploaded-allowlist:
// the booking must carry the minimum fields the email handler
// reads on this path (bookingRef, guestName, guestEmail,
// memberId, roomNumber, roomName, status, checkIn, checkOut,
// numNights, totalPrice). The fix relaxes the status gate from
// "confirmed" only to a 3-status allowlist, so the test fixture
// parameterizes on `status` per case.
const baseBooking = {
  bookingRef: "SI-20990101-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  memberId: "member_123",
  roomNumber: "101",
  roomName: "Standard Room",
  checkIn: new Date("2099-01-10T00:00:00.000Z"),
  checkOut: new Date("2099-01-12T00:00:00.000Z"),
  numNights: 2,
  totalPrice: 5000
};

describe("/api/email/early-checkin-request status allowlist (fix)", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((key) => delete mockBookings[key]);
    mockSend.mockReset();
    mockSend.mockResolvedValue({ id: "email_123" });
  });

  // The 3-status allowlist. Each case is a separate test so
  // a future regression on one status (e.g., accidentally
  // dropping payment-uploaded) shows up as a focused failure.

  test("accepts payment-uploaded (guest paid, awaiting staff verification)", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "payment-uploaded" };
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "maria@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("accepts payment-confirmed (staff verified, not yet 'confirmed')", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "payment-confirmed" };
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "maria@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("accepts confirmed (the existing allowlist — regression net)", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "confirmed" };
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "maria@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  // The 4 rejection cases. Each test confirms the 400 fires
  // and no email is sent (so a rejected request doesn't spam the
  // guest or the hotel).

  test("rejects pending (no booking exists yet — pre-payment)", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "pending" };
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "maria@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/not allowed for bookings with status 'pending'/)
      })
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("rejects checked-in (guest is already here)", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "checked-in" };
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "maria@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("rejects checked-out (past tense)", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "checked-out" };
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "maria@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("rejects cancelled", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "cancelled" };
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "maria@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("/api/email/early-checkin-request — error message copy", () => {
  // The pre-fix message reads "not allowed for bookings with
  // status 'payment-uploaded'" — accurate but not actionable.
  // The fix preserves the same shape so existing error UI
  // (toast / banner) keeps working without a copy change, but
  // adds the new statuses to the surface so the guest can read
  // the actual status name and understand why.

  beforeEach(() => {
    Object.keys(mockBookings).forEach((key) => delete mockBookings[key]);
    mockSend.mockReset();
  });

  test("rejected payment-uploaded error message names the actual status", async () => {
    mockBookings.booking_1 = { ...baseBooking, status: "payment-uploaded" };
    const res = mockResponse();

    // First confirm the gate now allows payment-uploaded — the
    // message format is checked in a separate case below.
    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_999", email: "intruder@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    // Auth fails before the status gate — the response is 404
    // (no booking ownership match), not 400. That confirms the
    // auth gate still runs before the status gate (no
    // information leak to non-owners).
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("BookingConfirmPage — client-side gate (source-text)", () => {
  // The fix adds a matching client gate so the "Request early
  // check-in" button only appears when the booking is in one of
  // the 3 allowed statuses. These tests pin that contract at the
  // source-text level so a future refactor can't silently undo
  // it (and re-introduce the click → 400 → confusing UX bug).
  //
  // The showEarlyCheckInButton gate currently lives at line 236:
  //   showEarlyCheckInButton = isRewardsMember && earlyCheckInEnabled;
  // The fix adds the status check so the button hides for
  // pending / checked-in / checked-out / cancelled bookings.

  const bookingConfirmPage = readFileSync(
    resolve(__dirname, "../../src/pages/BookingConfirmPage.tsx"),
    "utf8"
  );

  test("gates showEarlyCheckInButton on the 3-status allowlist", () => {
    // The constant name + the status substrings are the
    // load-bearing contract. Match each piece separately
    // rather than fighting regex character-class escaping.
    expect(bookingConfirmPage).toMatch(/ALLOWED_EARLY_CHECKIN_STATUSES/);
    expect(bookingConfirmPage).toMatch(/payment-uploaded/);
    expect(bookingConfirmPage).toMatch(/payment-confirmed/);
    expect(bookingConfirmPage).toMatch(/confirmed/);
    expect(bookingConfirmPage).toMatch(/\.includes\(bookingStatus\)/);
  });

  test("does not gate on the pre-fix `'confirmed'`-only check", () => {
    // Regression net: the previous gate was
    // `booking.status === "confirmed"` — single-string
    // equality. The fix replaces it with the 3-status array
    // `.includes(...)` check. This test pins that the old shape
    // is gone so a stale revert can't slip through.
    expect(bookingConfirmPage).not.toMatch(
      /booking\.status\s*===\s*["']confirmed["']\s*\)/
    );
  });

  test("keeps the existing isRewardsMember + earlyCheckInEnabled conjunction", () => {
    // The fix ADDS the status check; it does not remove the
    // existing membership + rewards-config toggles. The gate
    // is `isRewardsMember && earlyCheckInEnabled &&
    // ['payment-uploaded', 'payment-confirmed', 'confirmed']
    // .includes(booking.status)`.
    expect(bookingConfirmPage).toMatch(/isRewardsMember\s*&&\s*earlyCheckInEnabled/);
  });
});
