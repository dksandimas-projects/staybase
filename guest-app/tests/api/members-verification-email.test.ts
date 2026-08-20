import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockGenerateEmailVerificationLink, mockSend } = vi.hoisted(() => ({
  mockGenerateEmailVerificationLink: vi.fn(),
  mockSend: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminAuth: {
    generateEmailVerificationLink: mockGenerateEmailVerificationLink
  },
  adminDb: {}
}));

vi.mock("../../server/lib/resend", () => ({
  resend: {
    emails: {
      send: mockSend
    }
  }
}));

import { handleSendVerificationEmail } from "../../server/handlers/members";

const createMockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("handleSendVerificationEmail API Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 if request is unauthenticated or missing email", async () => {
    const req = { method: "POST", user: null };
    const res = createMockResponse();

    await handleSendVerificationEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringMatching(/Unauthorized/)
    }));
  });

  test("returns 200 early if email is already verified", async () => {
    const req = {
      method: "POST",
      user: {
        uid: "user_123",
        email: "verified@example.com",
        email_verified: true
      }
    };
    const res = createMockResponse();

    await handleSendVerificationEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: "Email is already verified.",
      data: { alreadyVerified: true }
    }));
    expect(mockGenerateEmailVerificationLink).not.toHaveBeenCalled();
  });

  test("generates action link and sends custom Resend verification email when unverified", async () => {
    mockGenerateEmailVerificationLink.mockResolvedValue("https://sparkinn.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=12345");
    mockSend.mockResolvedValue({ id: "resend_msg_123" });

    const req = {
      method: "POST",
      user: {
        uid: "user_456",
        email: "unverified@example.com",
        email_verified: false,
        name: "Unverified Guest"
      }
    };
    const res = createMockResponse();

    await handleSendVerificationEmail(req, res);

    expect(mockGenerateEmailVerificationLink).toHaveBeenCalledWith("unverified@example.com", expect.objectContaining({
      url: expect.stringContaining("/account/profile?emailVerified=true"),
      handleCodeInApp: true
    }));

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      to: "unverified@example.com",
      subject: expect.stringContaining("Verify your email address"),
      html: expect.stringContaining("https://sparkinn.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=12345")
    }));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: "Verification email sent successfully."
    }));
  });

  test("returns 500 if link generation fails", async () => {
    mockGenerateEmailVerificationLink.mockRejectedValue(new Error("Firebase Admin SDK error"));

    const req = {
      method: "POST",
      user: {
        uid: "user_789",
        email: "error@example.com",
        email_verified: false
      }
    };
    const res = createMockResponse();

    await handleSendVerificationEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: "Failed to send verification email. Please try again."
    }));
  });

  // Operator-reported 2026-08-20: a generic 500 surfaced to the
  // EmailVerifyBanner after sendCustomVerificationEmail stopped
  // swallowing API errors (the previous "Please wait a minute"
  // misdirection went away, exposing a real config bug on
  // staging — Firebase Auth unauthorized-continue-uri because
  // stg.sparkinnbohol.com was missing from the project's
  // authorized domains list). The banner now shows a useful
  // message that points the operator at the real problem rather
  // than a generic "try again". The Firebase error info
  // surfaces on `error.errorInfo.code` (see firebase-admin
  // auth errors) AND `error.code` (the same value as a top-level
  // property on `_FirebaseAuthError`). The handler matches both
  // shapes so future Firebase SDK shape changes don't break the
  // mapping.
  test("returns 500 with a specific message when the continue URL domain is not allowlisted", async () => {
    const firebaseAuthError: any = new Error("Domain not allowlisted by project");
    firebaseAuthError.code = "auth/unauthorized-continue-uri";
    firebaseAuthError.errorInfo = { code: "auth/unauthorized-continue-uri", message: "Domain not allowlisted by project" };
    mockGenerateEmailVerificationLink.mockRejectedValue(firebaseAuthError);

    const req = {
      method: "POST",
      user: {
        uid: "user_al",
        email: "unverified@example.com",
        email_verified: false,
        name: "Allowlist Guest"
      }
    };
    const res = createMockResponse();

    await handleSendVerificationEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.success).toBe(false);
    // The user-facing message must name the actual cause (the
    // continue URL domain not being allowlisted) so the operator
    // can fix the Firebase console config rather than staring at
    // a generic "try again".
    expect(jsonArg.error).toMatch(/not allowlisted/i);
    expect(jsonArg.error).toMatch(/Firebase/);
    // And the API contract must surface the Firebase error code
    // so the banner (or a future error-mapping layer) can
    // branch on it without parsing prose.
    expect(jsonArg.code).toBe("auth/unauthorized-continue-uri");
  });
});
