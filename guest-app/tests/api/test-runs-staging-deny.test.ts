import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGet, mockCollection, mockRunTransaction } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockCollection = vi.fn((name: string) => {
    if (name === "janitor") {
      return {
        doc: () => ({
          collection: () => ({
            add: vi.fn().mockResolvedValue({ id: "audit_123" })
          })
        })
      };
    }
    const chain = {
      get: mockGet,
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis()
    };
    return {
      ...chain,
      doc: () => ({
        get: mockGet,
        set: vi.fn(),
        update: vi.fn(),
        collection: () => ({ get: mockGet, add: vi.fn() })
      }),
      where: () => chain,
      add: vi.fn()
    };
  });
  const mockRunTransaction = vi.fn(async (fn: any) => {
    const transaction = {
      get: mockGet,
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    };
    return fn(transaction);
  });
  return { mockGet, mockCollection, mockRunTransaction };
});

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: (fn: any) => mockRunTransaction(fn),
    doc: () => ({
      collection: () => ({
        get: mockGet
      })
    })
  },
  adminAuth: {},
  adminStorage: {}
}));

import { handleStagingResetPreview, handleStagingResetExecute } from "../../server/handlers/test-runs";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const adminReq = (body?: any) => ({
  method: "POST",
  body: body || {},
  staff: { uid: "admin_1", role: "admin", email: "admin@test.com" }
});

describe("ETR-S08 — Staging reset production denial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockRunTransaction.mockReset();
    mockRunTransaction.mockImplementation(async (fn: any) => {
      const transaction = {
        get: mockGet,
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      };
      return fn(transaction);
    });
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
  });

  it("handleStagingResetPreview returns 403 when FIREBASE_PROJECT_ID is not in the staging allowlist", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    await handleStagingResetPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/staging allowlist/i);
  });

  it("handleStagingResetPreview returns 403 when no FIREBASE_PROJECT_ID is set", async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    await handleStagingResetPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/staging allowlist/i);
  });

  it("handleStagingResetExecute returns 403 when FIREBASE_PROJECT_ID is not in the staging allowlist", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({ confirmation: "RESET STAGING", projectName: "spark-inn-prod" }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/staging allowlist/i);
  });

  it("handleStagingResetExecute returns 403 when no STAGING_ALLOWLIST_PROJECT_IDS is set", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({ confirmation: "RESET STAGING", projectName: "spark-inn-prod" }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/staging allowlist/i);
  });

  it("handleStagingResetPreview succeeds when FIREBASE_PROJECT_ID is in the staging allowlist", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    // Mock empty collections for the preview manifest
    mockGet.mockResolvedValue({ exists: true, data: () => ({ roomTypes: [] }), docs: [], empty: true });

    const res = mockResponse();
    await handleStagingResetPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.isStaging).toBe(true);
  });

  it("handleStagingResetExecute succeeds when project is allowlisted and confirmation is correct", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const emptyCollection = { docs: [], empty: true };

    // collectStagingManifest calls Promise.all on 5 queries.
    // After manifest, the delete loop queries → empty → loop breaks immediately.
    // Then audit write, post-tx runRef.get() for room manifest, runRef.set().
    let callCount = 0;
    mockGet.mockImplementation(async () => {
      callCount++;
      // Calls 1-5: collectStagingManifest (Promise.all — all 5 fire synchronously)
      // Calls 6+: delete loops, post-tx reads → all return empty to break loops
      if (callCount <= 5) return emptyCollection;
      return emptyCollection;
    });

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({ confirmation: "RESET STAGING", projectName: "spark-inn-stg" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
  });

  it("handleStagingResetExecute returns 400 when confirmation phrase is wrong", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({ confirmation: "WRONG", projectName: "spark-inn-stg" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("handleStagingResetExecute returns 400 when project name does not match", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({ confirmation: "RESET STAGING", projectName: "wrong-project" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("handleStagingResetExecute returns 403 for non-admin staff", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    const staffReq = {
      method: "POST",
      body: { confirmation: "RESET STAGING", projectName: "spark-inn-stg" },
      staff: { uid: "staff_1", role: "front-desk", email: "staff@test.com" }
    };
    await handleStagingResetExecute(staffReq, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
  });
});
