import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockAdd } = vi.hoisted(() => ({
  mockAdd: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation(() => ({
      add: mockAdd
    }))
  }
}));

const { mockSendTrigger, mockSendConfirmationTrigger } = vi.hoisted(() => ({
  mockSendTrigger: vi.fn().mockResolvedValue(undefined),
  mockSendConfirmationTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/handlers/email", () => ({
  sendContactInquiryTrigger: mockSendTrigger,
  sendContactConfirmationTrigger: mockSendConfirmationTrigger
}));

import { handleCreateContactInquiry } from "../../server/handlers/contact";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const validBody = {
  name: "John Doe",
  email: "john.doe@example.com",
  subject: "Question about pool access",
  message: "Hi, is the pool open during the rainy season? Thanks!",
  _hp: "",
  turnstileToken: "mock_token"
};

describe("/api/contact/inquiry handler", () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockSendTrigger.mockClear();
    mockSendConfirmationTrigger.mockClear();
  });

  test("creates a contact inquiry with normalized fields and triggers emails", async () => {
    mockAdd.mockResolvedValueOnce({ id: "con_123" });
    const req = { method: "POST", body: validBody };
    const res = mockResponse();

    await handleCreateContactInquiry(req, res);

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      name: "John Doe",
      email: "john.doe@example.com",
      subject: "Question about pool access",
      message: "Hi, is the pool open during the rainy season? Thanks!",
      status: "new",
      isRead: false,
      handledBy: "",
      notes: [],
      source: "contact-page"
    }));
    expect(mockAdd.mock.calls[0][0]).not.toHaveProperty("_hp");
    expect(mockAdd.mock.calls[0][0]).not.toHaveProperty("turnstileToken");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { inquiryId: "con_123" }
    });

    expect(mockSendTrigger).toHaveBeenCalledWith(expect.objectContaining({
      id: "con_123",
      subject: "Question about pool access"
    }));
    expect(mockSendConfirmationTrigger).toHaveBeenCalledWith(expect.objectContaining({
      id: "con_123",
      email: "john.doe@example.com"
    }));
  });

  test("rejects invalid contact fields", async () => {
    const req = { method: "POST", body: { ...validBody, email: "invalid-email" } };
    const res = mockResponse();

    await handleCreateContactInquiry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Please share a valid email."
    });
  });

  test("rejects non-POST method", async () => {
    const req = { method: "GET", body: {} };
    const res = mockResponse();

    await handleCreateContactInquiry(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("success response is returned even if submitter confirmation email fails", async () => {
    mockAdd.mockResolvedValueOnce({ id: "con_456" });
    mockSendConfirmationTrigger.mockRejectedValueOnce(new Error("Email delivery failed"));
    const req = { method: "POST", body: validBody };
    const res = mockResponse();

    await handleCreateContactInquiry(req, res);

    expect(mockSendTrigger).toHaveBeenCalled();
    expect(mockSendConfirmationTrigger).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { inquiryId: "con_456" }
    });
  });
});
