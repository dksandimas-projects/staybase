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

vi.mock("../../server/handlers/email", () => ({
  sendCorporateInquiryTrigger: vi.fn().mockResolvedValue(undefined)
}));

import { handleCreateCorporateInquiry } from "../../server/handlers/corporate-inquiries";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const validBody = {
  companyName: "Acme Corporation",
  contactPerson: "Maria Santos",
  email: "maria@acme.test",
  phone: "+63 917 000 0000",
  numRooms: "5",
  preferredDates: "October 2026",
  specialRequirements: "Needs meeting room access.",
  _hp: "",
  turnstileToken: "mock_token"
};

describe("/api/corporate/inquiry handler", () => {
  beforeEach(() => {
    mockAdd.mockReset();
  });

  test("creates a corporate inquiry with normalized fields", async () => {
    mockAdd.mockResolvedValueOnce({ id: "inq_123" });
    const req = { method: "POST", body: validBody };
    const res = mockResponse();

    await handleCreateCorporateInquiry(req, res);

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      companyName: "Acme Corporation",
      contactPerson: "Maria Santos",
      email: "maria@acme.test",
      phone: "+63 917 000 0000",
      numRooms: 5,
      preferredDates: "October 2026",
      specialRequirements: "Needs meeting room access.",
      status: "new",
      handler: "",
      notes: [],
      accessCodeId: ""
    }));
    expect(mockAdd.mock.calls[0][0]).not.toHaveProperty("_hp");
    expect(mockAdd.mock.calls[0][0]).not.toHaveProperty("turnstileToken");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { inquiryId: "inq_123" }
    });
  });

  test("rejects invalid inquiry fields", async () => {
    const req = { method: "POST", body: { ...validBody, email: "not-an-email" } };
    const res = mockResponse();

    await handleCreateCorporateInquiry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Please check the inquiry form and try again."
    });
  });

  test("rejects non-POST method", async () => {
    const req = { method: "GET", body: {} };
    const res = mockResponse();

    await handleCreateCorporateInquiry(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});
