import { beforeEach, describe, expect, test, vi } from "vitest";
import { handleEmailPreview } from "../../server/handlers/email";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
};

describe("POST /api/email/preview handler", () => {
  test("rejects non-POST requests", async () => {
    const req: any = {
      method: "GET"
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Method not allowed." })
    );
  });

  test("rejects unauthenticated requests", async () => {
    const req: any = {
      method: "POST",
      staff: null
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Staff authentication is required." })
    );
  });

  test("rejects requests missing template parameter", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: {}
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Template parameter is required." })
    );
  });

  test("returns rendered HTML for booking-submitted template", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "booking-submitted" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Your stay request is under review"));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("BK-2026-MOCK"));
  });

  test("returns rendered HTML for discount-rejected template", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "discount-rejected" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("BK-2026-MOCK"));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("ID photo was blurred and expired."));
  });

  test("returns rendered HTML for corporate-inquiry template", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "corporate-inquiry" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Acme Tech Solutions Inc."));
  });

  test.each([
    ["corporate-inquiry-confirmation", "Acme Tech Solutions Inc."],
    ["contact-inquiry", "Airport transfer availability"],
    ["contact-confirmation", "Airport transfer availability"]
  ])("returns rendered HTML for %s template", async (template, expectedContent) => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining(expectedContent));
  });

  test("rejects unknown templates", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "unknown-action-abc" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Unknown email template: unknown-action-abc" })
    );
  });
});
