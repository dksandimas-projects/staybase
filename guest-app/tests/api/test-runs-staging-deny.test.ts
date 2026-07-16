import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock Firebase Admin ────────────────────────────────────────────
const { mockGet, mockCollection, mockRunTransaction } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockCollection = vi.fn();
  const mockRunTransaction = vi.fn();
  return { mockGet, mockCollection, mockRunTransaction };
});

function installDefaultMock() {
  const baseDoc = {
    get: mockGet,
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    collection: () => baseColl
  };
  const baseColl = {
    get: mockGet,
    limit: vi.fn(() => ({ get: mockGet, startAfter: vi.fn(() => ({ get: mockGet })) })),
    startAfter: vi.fn(() => ({ get: mockGet })),
    doc: () => baseDoc,
    where: () => ({
      get: mockGet,
      limit: vi.fn(() => ({ get: mockGet, startAfter: vi.fn(() => ({ get: mockGet })) })),
      startAfter: vi.fn(() => ({ get: mockGet }))
    }),
    add: vi.fn()
  };
  mockCollection.mockReturnValue(baseColl);
  mockRunTransaction.mockImplementation(async (fn: any) => {
    const tx = { get: mockGet, set: vi.fn(), update: vi.fn(), delete: vi.fn() };
    return fn(tx);
  });
}

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: (fn: any) => mockRunTransaction(fn)
  },
  adminAuth: {},
  adminStorage: {}
}));

import { handleStagingResetPreview, handleStagingResetExecute, hashManifest } from "../../server/handlers/test-runs";

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

function snapWithDocs(count: number): any {
  const docs = Array.from({ length: count }, (_, i) => ({
    id: `doc_${i}`,
    data: () => ({ roomNumber: `101` }),
    ref: { delete: vi.fn().mockResolvedValue(undefined) }
  }));
  return { docs, empty: count === 0, size: count, forEach: (fn: any) => docs.forEach(fn) };
}

function emptyManifestHash(): string {
  return hashManifest({
    bookings: 0, storeOrders: 0, notifications: 0, intercomStays: 0,
    testRuns: 0, calls: 0, dailyCloses: 0, corporateInquiries: 0,
    roomBlocks: 0, cleanupHistory: 0, affectedRooms: [], affectedStockItems: []
  });
}

function validPreviewDoc() {
  return {
    exists: true,
    data: () => ({
      projectId: "spark-inn-stg",
      manifestHash: emptyManifestHash(),
      createdAt: new Date(Date.now() + 60000)
    })
  };
}

function buildSequence(returns: any[]): () => any {
  let i = 0;
  return () => {
    const r = returns[i] ?? snapWithDocs(0);
    i++;
    return r;
  };
}

const STEPS_VALID_PREVIEW = [
  /* 1 */  { exists: true, data: () => ({ projectId: "spark-inn-stg", manifestHash: emptyManifestHash(), createdAt: new Date(Date.now() + 60000) }) },
];
const STEPS_MANIFEST_EMPTY = [
  /* 1-10: collectFullManifest → 0 docs */
  snapWithDocs(0), snapWithDocs(0), snapWithDocs(0), snapWithDocs(0), snapWithDocs(0),
  snapWithDocs(0), snapWithDocs(0), snapWithDocs(0), snapWithDocs(0), snapWithDocs(0),
];
const STEPS_LOCK_NONE = [
  /* 1 */  { exists: false, data: () => undefined },
];
// Full success sequence: preview + drift empty + lock none + manifestBefore empty
const STEPS_FULL_SUCCESS = [
  ...STEPS_VALID_PREVIEW,
  ...STEPS_MANIFEST_EMPTY,
  ...STEPS_LOCK_NONE,
  ...STEPS_MANIFEST_EMPTY,
];

describe("ETR-S08 — Staging reset production denial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultMock();
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
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("handleStagingResetPreview returns 403 when no FIREBASE_PROJECT_ID is set", async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";
    const res = mockResponse();
    await handleStagingResetPreview(adminReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("handleStagingResetExecute returns 403 when FIREBASE_PROJECT_ID is not in the staging allowlist", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";
    const res = mockResponse();
    await handleStagingResetExecute(adminReq({ confirmation: "RESET STAGING", projectName: "spark-inn-prod" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("handleStagingResetExecute returns 403 when no STAGING_ALLOWLIST_PROJECT_IDS is set", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
    const res = mockResponse();
    await handleStagingResetExecute(adminReq({ confirmation: "RESET STAGING", projectName: "spark-inn-prod" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("handleStagingResetPreview succeeds when FIREBASE_PROJECT_ID is in the staging allowlist", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    mockGet.mockImplementation(buildSequence(STEPS_MANIFEST_EMPTY));

    const res = mockResponse();
    await handleStagingResetPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data.isStaging).toBe(true);
    expect(res.json.mock.calls[0][0].data.previewId).toBeDefined();
  });

  it("handleStagingResetExecute returns 400 when confirmation phrase is wrong", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "WRONG",
      projectName: "spark-inn-stg",
      previewId: "abc123"
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("handleStagingResetExecute returns 400 when project name does not match", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "wrong-project",
      previewId: "abc123"
    }), res);

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
  });
});

describe("ETR-S10 — Preview-bound execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultMock();
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
  });

  it("rejects when no previewId is provided", async () => {
    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg"
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects when preview does not exist", async () => {
    mockGet.mockImplementation(buildSequence([
      { exists: false, data: () => undefined },
    ]));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "nonexistent"
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/preview not found/i);
  });

  it("rejects when preview is expired", async () => {
    mockGet.mockImplementation(buildSequence([
      { exists: true, data: () => ({ projectId: "spark-inn-stg", manifestHash: "abc", createdAt: new Date(Date.now() - 600000) }) },
    ]));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "expired"
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/expired/i);
  });

  it("rejects when preview was created for a different project", async () => {
    mockGet.mockImplementation(buildSequence([
      { exists: true, data: () => ({ projectId: "other-project", manifestHash: "abc", createdAt: new Date(Date.now() + 60000) }) },
    ]));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "wrong-proj"
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/different project/i);
  });

  it("rejects when staging data has drifted since preview (409)", async () => {
    // Hash in preview doc: "abc" (won't match hash of 1-doc collections)
    mockGet.mockImplementation(buildSequence([
      { exists: true, data: () => ({ projectId: "spark-inn-stg", manifestHash: "abc", createdAt: new Date(Date.now() + 60000) }) },
      ...STEPS_MANIFEST_EMPTY,
    ]));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "drifted"
    }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].error).toMatch(/changed since preview/i);
  });
});

describe("ETR-S09 — Atomic lock acquisition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultMock();
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
  });

  it("acquires lock when none exists and executes successfully", async () => {
    mockGet.mockImplementation(buildSequence(STEPS_FULL_SUCCESS));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "valid"
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.terminalStatus).toBe("complete");
  });

  it("returns 409 when lock is held by another running job (not stale)", async () => {
    mockGet.mockImplementation(buildSequence([
      ...STEPS_VALID_PREVIEW,
      ...STEPS_MANIFEST_EMPTY,
      { exists: true, data: () => ({ projectId: "spark-inn-stg", status: "running", startedAt: new Date() }) },
    ]));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "valid"
    }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].error).toMatch(/already in progress/i);
  });

  it("recovers stale lock (older than 30 min)", async () => {
    const oldStart = new Date(Date.now() - 31 * 60 * 1000);
    mockGet.mockImplementation(buildSequence([
      ...STEPS_VALID_PREVIEW,
      ...STEPS_MANIFEST_EMPTY,
      { exists: true, data: () => ({ projectId: "spark-inn-stg", status: "running", startedAt: oldStart }) },
      ...STEPS_MANIFEST_EMPTY,
    ]));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "valid"
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.terminalStatus).toBe("complete");
  });

  it("recovers lock from completed/failed state", async () => {
    mockGet.mockImplementation(buildSequence([
      ...STEPS_VALID_PREVIEW,
      ...STEPS_MANIFEST_EMPTY,
      { exists: true, data: () => ({ projectId: "spark-inn-stg", status: "complete", startedAt: new Date(Date.now() - 10000) }) },
      ...STEPS_MANIFEST_EMPTY,
    ]));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "valid"
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.terminalStatus).toBe("complete");
  });
});

describe("ETR-S11 — Fail-closed semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultMock();
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
  });

  it("returns 500 when a deletion phase throws", async () => {
    let callIdx = 0;
    mockGet.mockImplementation(async () => {
      callIdx++;
      if (callIdx <= 22) {
        if (callIdx === 1) return validPreviewDoc();
        if (callIdx === 12) return { exists: false, data: () => undefined };
        return snapWithDocs(0);
      }
      throw new Error("Simulated Firestore failure");
    });

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "valid"
    }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].error).toMatch(/unable to execute/i);
  });
});

describe("ETR-S12 — Complete scope / ETR-S13 — Integrity scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultMock();
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg";
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
  });

  it("passes integrity scan after successful deletion of all collections", async () => {
    mockGet.mockImplementation(buildSequence(STEPS_FULL_SUCCESS));

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "valid"
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.terminalStatus).toBe("complete");
  });

  it("returns 500 when integrity scan finds remaining data", async () => {
    // Deletion phases consume 1 get call per collection (10 total).
    // Integrity scan starts at call 23+10 = 33. Set bookings check to return 1 doc.
    const INTEGRITY_START = 33;
    let callIdx = 0;
    mockGet.mockImplementation(async () => {
      callIdx++;
      if (callIdx <= 22) {
        if (callIdx === 1) return validPreviewDoc();
        if (callIdx === 12) return { exists: false, data: () => undefined };
        return snapWithDocs(0);
      }
      if (callIdx === INTEGRITY_START) return snapWithDocs(1);
      return snapWithDocs(0);
    });

    const res = mockResponse();
    await handleStagingResetExecute(adminReq({
      confirmation: "RESET STAGING",
      projectName: "spark-inn-stg",
      previewId: "valid"
    }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    const json = res.json.mock.calls[0][0];
    expect(json.data.terminalStatus).toBe("incomplete");
    expect(json.data.integrityErrors).toBeDefined();
    expect(json.data.integrityErrors[0]).toMatch(/bookings/i);
  });

  it("inventories all collections in manifest", async () => {
    mockGet.mockImplementation(buildSequence(STEPS_MANIFEST_EMPTY));

    const res = mockResponse();
    await handleStagingResetPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const manifest = res.json.mock.calls[0][0].data.manifest;
    const expectedKeys = [
      "bookings", "storeOrders", "notifications", "intercomStays",
      "testRuns", "calls", "dailyCloses", "corporateInquiries",
      "roomBlocks", "cleanupHistory", "affectedRooms"
    ];
    for (const key of expectedKeys) {
      expect(manifest).toHaveProperty(key);
    }
  });
});
