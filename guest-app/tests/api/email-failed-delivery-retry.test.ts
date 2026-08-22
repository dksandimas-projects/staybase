// Per #11 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §Open Operator-Reported Bugs → #11`):
// every Resend API failure must persist to a new
// `failed_emails` Firestore collection so the staff
// dashboard can surface a banner + the operator can
// audit + retry. Pre-#11 the `resend.emails.send` call
// in `email.ts:912` was unguarded and the outer
// try/catch at every trigger site just
// `console.error`'d + continued — silent swallow.

// Test-first (per `plan/docs/CONTRIBUTING.md §Testing`):
// RED — this file pins the contract at the runtime
// level for the DLQ write inside `sendEmail` (the
// canonical Resend wrapper). The contract lives in
// the source-text guards at
// `email-failed-delivery-retry-source-text.test.ts`
// for the caller-side wiring (the 5 outer try/catch
// sites at `bookings.ts` + the `emailQueued` response
// shape on the `booking-confirmed` HTTP path).

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockResendSend,
  mockFailedEmailAdd,
  mockConsoleError
} = vi.hoisted(() => ({
  mockResendSend: vi.fn(),
  mockFailedEmailAdd: vi.fn(),
  mockConsoleError: vi.spyOn(console, "error").mockImplementation(() => {})
}));

vi.mock("../../server/lib/resend", () => ({
  resend: { emails: { send: mockResendSend } },
  getResend: () => ({ emails: { send: mockResendSend } })
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => {
      if (collectionName === "failed_emails") {
        return {
          add: mockFailedEmailAdd
        };
      }
      return { doc: vi.fn() };
    })
  },
  adminAuth: {}
}));

// `sendBookingTrigger` is exercised as the public
// surface that calls `sendEmail` internally.
import {
  loadLiabilityProjectionForEmail,
  sendBookingTrigger
} from "../../server/handlers/email";

describe("#11 — failed_emails DLQ on Resend send failure (sendEmail contract)", () => {
  beforeEach(() => {
    mockResendSend.mockReset();
    mockFailedEmailAdd.mockReset();
    mockConsoleError.mockClear();
  });

  // Helper to build a minimal booking view that
  // satisfies `sendBookingTrigger`'s template
  // resolution for a `booking-submitted` action (no
  // houseRules, no attachments).
  function buildBooking(overrides: Record<string, any> = {}) {
    return {
      bookingRef: "SPK-20260820-00001",
      guestEmail: "guest@example.com",
      guestName: "Test Guest",
      checkIn: "2026-08-25",
      checkOut: "2026-08-27",
      numNights: 2,
      numAdults: 2,
      numChildren: 0,
      status: "pending",
      rooms: [],
      ...overrides
    };
  }

  test("a Resend error on `sendEmail` writes a `failed_emails` doc with the canonical field shape", async () => {
    mockResendSend.mockRejectedValueOnce(new Error("Resend API timeout"));
    // sendBookingTrigger currently throws on
    // Resend failure (the `sendEmail` re-throw
    // after the DLQ write). The caller's outer
    // try/catch + the booking-confirmed HTTP
    // response shape change is in the
    // source-text test. The pre-#11 behaviour is
    // to throw; the post-#11 behaviour ALSO
    // throws (the `sendEmail` re-throws after the
    // DLQ write) — but the DLQ has the failure
    // persisted.
    await expect(
      sendBookingTrigger("booking-submitted", buildBooking())
    ).rejects.toThrow("Resend API timeout");
    // The DLQ write happened with the canonical
    // field shape.
    expect(mockFailedEmailAdd).toHaveBeenCalledTimes(1);
    const dlqDoc = mockFailedEmailAdd.mock.calls[0][0];
    expect(dlqDoc).toEqual(
      expect.objectContaining({
        recipient: "guest@example.com",
        error: "Resend API timeout",
        retryCount: 0
      })
    );
    // `lastAttemptAt` is a Date; `subject` is the
    // email's subject line.
    expect(dlqDoc.lastAttemptAt).toBeInstanceOf(Date);
    expect(typeof dlqDoc.subject).toBe("string");
    expect(dlqDoc.subject).toMatch(/booking request received/i);
  });

  test("a successful Resend send does NOT write to failed_emails", async () => {
    mockResendSend.mockResolvedValueOnce({ id: "email_123" });
    await sendBookingTrigger("booking-submitted", buildBooking());
    expect(mockFailedEmailAdd).not.toHaveBeenCalled();
  });

  test("a Resend send to a placeholder address (`@example.invalid` / `@invalid`) is treated as success + no DLQ write", async () => {
    // The pre-existing skip-guard at email.ts:907
    // (LOW-7 audit) is preserved — placeholder
    // addresses never call Resend + never write to
    // the DLQ.
    await sendBookingTrigger(
      "booking-submitted",
      buildBooking({ guestEmail: "erased@invalid" })
    );
    expect(mockResendSend).not.toHaveBeenCalled();
    expect(mockFailedEmailAdd).not.toHaveBeenCalled();
  });

  test("a Resend network failure (no response) writes to failed_emails with a clear error string", async () => {
    // Resend's `fetch` can fail with `TypeError:
    // fetch failed` (DNS, network reset, etc.) —
    // a non-Error object. The DLQ write must
    // still capture a usable `error` string.
    mockResendSend.mockRejectedValueOnce("network reset" as any);
    await expect(
      sendBookingTrigger("booking-submitted", buildBooking())
    ).rejects.toBe("network reset");
    expect(mockFailedEmailAdd).toHaveBeenCalledTimes(1);
    const dlqDoc = mockFailedEmailAdd.mock.calls[0][0];
    expect(dlqDoc.error).toBe("network reset");
  });

  test("a DLQ write failure (Firestore down) does NOT swallow the original Resend error", async () => {
    // The DLQ write is best-effort — if the DLQ
    // write itself fails, the original Resend
    // error must still propagate so the caller's
    // outer try/catch sees it. (Defensive: the
    // pre-#11 behaviour was to throw on Resend
    // failure; the post-#11 behaviour is to also
    // try the DLQ write, but the DLQ failure must
    // not mask the original error.)
    mockResendSend.mockRejectedValueOnce(new Error("Resend API timeout"));
    mockFailedEmailAdd.mockRejectedValueOnce(new Error("Firestore write failed"));
    await expect(
      sendBookingTrigger("booking-submitted", buildBooking())
    ).rejects.toThrow("Resend API timeout");
    expect(mockFailedEmailAdd).toHaveBeenCalledTimes(1);
    // The DLQ error gets console.error'd (for the
    // operator's breadcrumb) but doesn't replace
    // the original error.
    expect(mockConsoleError).toHaveBeenCalled();
  });
});

describe("booking confirmation email module contract", () => {
  test("exports the liability loader used by the reservation confirmation path", () => {
    expect(typeof loadLiabilityProjectionForEmail).toBe("function");
  });
});
