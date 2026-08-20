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
});
