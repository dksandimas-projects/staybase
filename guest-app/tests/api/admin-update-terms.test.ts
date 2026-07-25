import { beforeEach, describe, expect, test, vi } from "vitest";

// Per LCE-01 (decision #137, 2026-07-25): the admin-only
// `/api/admin/update-terms` endpoint overwrites
// `settings/websiteContent.termsBody` and auto-bumps the
// patch version (1.0.0 → 1.0.1) inside a transaction. This
// test pins the contract: admin-only (front-desk 403),
// tokenless 401, method 405, payload validation, version
// auto-bump, and the empty / malformed current-version
// fallback path.

const {
  mockWebsiteContentDoc,
  mockSet
} = vi.hoisted(() => ({
  mockWebsiteContentDoc: { exists: false, data: vi.fn() },
  mockSet: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => {
      if (collectionName === "settings") {
        return {
          doc: vi.fn().mockImplementation((docId: string) => ({
            path: `settings/${docId}`
          }))
        };
      }
      return { doc: vi.fn() };
    }),
    runTransaction: vi.fn().mockImplementation(async (callback) => {
      await callback({
        get: vi.fn().mockImplementation(async (ref: any) => {
          if (ref.path === "settings/websiteContent") return mockWebsiteContentDoc;
          return { exists: false, data: vi.fn() };
        }),
        set: mockSet
      });
    })
  }
}));

import { handleUpdateTerms } from "../../server/handlers/legal";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const adminReq = {
  method: "POST",
  staff: { uid: "admin_1", role: "admin" },
  body: { termsBody: "Updated terms. By booking you agree to these." }
};

const frontDeskReq = {
  method: "POST",
  staff: { uid: "fd_1", role: "front-desk" },
  body: { termsBody: "x" }
};

describe("/api/admin/update-terms", () => {
  beforeEach(() => {
    mockWebsiteContentDoc.exists = true;
    mockWebsiteContentDoc.data.mockReturnValue({ termsVersion: "1.0.0" });
    mockSet.mockReset();
  });

  test("auto-bumps the patch version from 1.0.0 to 1.0.1 and stamps termsBody", async () => {
    const res = mockResponse();
    await handleUpdateTerms(adminReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload).toMatchObject({
      success: true,
      data: {
        termsBody: "Updated terms. By booking you agree to these.",
        termsVersion: "1.0.1",
        termsLastUpdated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
      }
    });
    // The transaction.set call is what actually writes the
    // new body + bumped version + lastUpdated to
    // settings/websiteContent. We assert the shape of the
    // merge payload (other websiteContent keys are
    // preserved by the `set(..., { merge: true })` semantics).
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: "settings/websiteContent" }),
      expect.objectContaining({
        termsBody: "Updated terms. By booking you agree to these.",
        termsVersion: "1.0.1",
        termsLastUpdated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        termsUpdatedBy: "admin_1"
      }),
      expect.objectContaining({ merge: true })
    );
  });

  test("auto-bumps 1.0.4 to 1.0.5 (preserves major + minor)", async () => {
    mockWebsiteContentDoc.data.mockReturnValue({ termsVersion: "1.0.4" });
    const res = mockResponse();
    await handleUpdateTerms(adminReq, res);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.termsVersion).toBe("1.0.5");
  });

  test("preserves a pre-release suffix on bump (1.0.0-draft → 1.0.1-draft)", async () => {
    mockWebsiteContentDoc.data.mockReturnValue({ termsVersion: "1.0.0-draft" });
    const res = mockResponse();
    await handleUpdateTerms(adminReq, res);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.termsVersion).toBe("1.0.1-draft");
  });

  test("falls back to DEFAULT_TERMS_VERSION + a patch bump when the current version is missing", async () => {
    // Legacy hotel that hasn't saved terms yet — the
    // websiteContent doc has no termsVersion field. The
    // first save should land at "1.0.1" (the default
    // 1.0.0 + a patch bump), not crash on undefined.
    mockWebsiteContentDoc.data.mockReturnValue({});
    const res = mockResponse();
    await handleUpdateTerms(adminReq, res);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.termsVersion).toBe("1.0.1");
  });

  test("falls back to DEFAULT_TERMS_VERSION on malformed current version", async () => {
    // Garbage in the field doesn't crash the endpoint —
    // the next version is `DEFAULT + 1` (1.0.0 → 1.0.1).
    mockWebsiteContentDoc.data.mockReturnValue({ termsVersion: "not-a-semver" });
    const res = mockResponse();
    await handleUpdateTerms(adminReq, res);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.termsVersion).toBe("1.0.1");
  });

  test("falls back to DEFAULT_TERMS_VERSION when the websiteContent doc is missing entirely", async () => {
    mockWebsiteContentDoc.exists = false;
    const res = mockResponse();
    await handleUpdateTerms(adminReq, res);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.termsVersion).toBe("1.0.1");
  });

  test("rejects empty body (schema requires min(1))", async () => {
    const res = mockResponse();
    await handleUpdateTerms({ ...adminReq, body: { termsBody: "   " } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects front-desk caller with 403", async () => {
    const res = mockResponse();
    await handleUpdateTerms(frontDeskReq, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects tokenless request with 401", async () => {
    const res = mockResponse();
    await handleUpdateTerms({ method: "POST", staff: {}, body: adminReq.body }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("rejects non-POST method with 405", async () => {
    const res = mockResponse();
    await handleUpdateTerms({ ...adminReq, method: "GET" }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
