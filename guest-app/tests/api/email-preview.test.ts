import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

  // ─── ETR-22.b — environment banner in previews ─────────────────
  //
  // The preview handler renders the same template functions the
  // production path uses, so the banner auto-detect and the
  // body opt-in both flow through here. These tests pin the
  // three end states (default / staging / test-run opt-in) so a
  // regression in `enrichedMockBooking` wiring surfaces here.
  describe("ETR-22.b — environment banner in preview", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    test("default preview (no staging, no override) renders NO banner", async () => {
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
      const req: any = {
        method: "POST",
        staff: { success: true },
        body: { template: "booking-submitted" }
      };
      const res = mockResponse();
      await handleEmailPreview(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const html = res.send.mock.calls[0][0] as string;
      expect(html).not.toContain("Test run email");
      expect(html).not.toContain("Staging environment email");
    });

    test("preview on a staging project renders the staging banner", async () => {
      process.env.FIREBASE_PROJECT_ID = "staging-spark-inn";
      process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
      const req: any = {
        method: "POST",
        staff: { success: true },
        body: { template: "booking-submitted" }
      };
      const res = mockResponse();
      await handleEmailPreview(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const html = res.send.mock.calls[0][0] as string;
      expect(html).toContain("Staging environment email");
      expect(html).not.toContain("Test run email");
    });

    test("preview with body opt-in renders the test-run banner with the supplied name", async () => {
      // No env vars needed — the body override bypasses the
      // auto-detect (which would otherwise need a mocked
      // adminDb). This is the "force a specific scenario"
      // path the docs describe.
      const req: any = {
        method: "POST",
        staff: { success: true },
        body: {
          template: "booking-submitted",
          isTestData: true,
          testRunName: "Q3 smoke 2026",
          testRunEnvironment: "production"
        }
      };
      const res = mockResponse();
      await handleEmailPreview(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const html = res.send.mock.calls[0][0] as string;
      expect(html).toContain("Test run email");
      expect(html).toContain("Q3 smoke 2026");
      expect(html).toContain("on production");
    });

    test("body opt-in with testRunName only (no environment) renders 'test run \"name\"' descriptor", async () => {
      const req: any = {
        method: "POST",
        staff: { success: true },
        body: {
          template: "booking-submitted",
          isTestData: true,
          testRunName: "Name-only run"
        }
      };
      const res = mockResponse();
      await handleEmailPreview(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const html = res.send.mock.calls[0][0] as string;
      expect(html).toContain("Test run email");
      expect(html).toContain("Name-only run");
      expect(html).not.toContain("on staging");
      expect(html).not.toContain("on production");
    });
  });
});
