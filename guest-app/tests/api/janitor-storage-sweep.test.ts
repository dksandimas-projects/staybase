import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBucket, mockDb, mockSweep, mockHistory } = vi.hoisted(() => {
  const mockBucket = { name: "test-bucket" };
  const mockDb = { __db: true };
  const mockSweep = vi.fn();
  const mockHistory: Array<any> = [];
  return { mockBucket, mockDb, mockSweep, mockHistory };
});

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: mockDb,
  adminAuth: {},
  adminStorage: { bucket: vi.fn(() => mockBucket) }
}));

vi.mock("@spark-inn/shared", async () => {
  const actual = await vi.importActual<any>("@spark-inn/shared");
  return {
    ...actual,
    sweepBookingsStorage: mockSweep,
    recordSweepResult: (r: any) => mockHistory.unshift({ ...r, at: Date.now() }),
    getSweepHistory: () => mockHistory
  };
});

import { handleJanitorStorageSweep, handleJanitorStats } from "../../server/handlers/janitor";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("handleJanitorStorageSweep (BF-50)", () => {
  const originalSecret = process.env.CRON_SECRET;
  const originalBucket = process.env.FIREBASE_STORAGE_BUCKET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.FIREBASE_STORAGE_BUCKET = "test-bucket";
    // Set the mock implementation AFTER clearAllMocks so
    // it survives across tests.
    mockSweep.mockResolvedValue({
      scanned: 5,
      deleted: 3,
      kept: 2,
      errors: [],
      nextPageToken: null,
      dryRun: false,
      durationMs: 42
    });
  });

  test("rejects requests without a CRON_SECRET header (401)", async () => {
    const res = mockResponse();
    await handleJanitorStorageSweep({ method: "POST", headers: {}, body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  test("rejects requests with a wrong CRON_SECRET header (401)", async () => {
    const res = mockResponse();
    await handleJanitorStorageSweep(
      { method: "POST", headers: { "x-cron-secret": "wrong" }, body: {} } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  test("accepts a valid x-cron-secret header and runs the sweep", async () => {
    const res = mockResponse();
    await handleJanitorStorageSweep(
      { method: "POST", headers: { "x-cron-secret": "test-cron-secret" }, body: {} } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSweep).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: mockBucket,
        db: mockDb,
        prefix: "bookings/",
        maxItems: 500,
        dryRun: false
      })
    );
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.scanned).toBe(5);
    expect(payload.data.deleted).toBe(3);
  });

  test("accepts a valid Bearer CRON_SECRET and runs the sweep", async () => {
    const res = mockResponse();
    await handleJanitorStorageSweep(
      {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
        body: {}
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSweep).toHaveBeenCalledTimes(1);
  });

  test("supports GET (Vercel Cron sends GET)", async () => {
    const res = mockResponse();
    await handleJanitorStorageSweep(
      { method: "GET", headers: { "x-cron-secret": "test-cron-secret" }, body: {} } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("rejects non-GET/POST methods (405)", async () => {
    const res = mockResponse();
    await handleJanitorStorageSweep(
      { method: "DELETE", headers: { "x-cron-secret": "test-cron-secret" }, body: {} } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("forwards dryRun + pageToken from the body", async () => {
    const res = mockResponse();
    await handleJanitorStorageSweep(
      {
        method: "POST",
        headers: { "x-cron-secret": "test-cron-secret" },
        body: { dryRun: true, pageToken: "page-2", maxItems: 100 }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSweep).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        pageToken: "page-2",
        maxItems: 100
      })
    );
  });

  test("returns 500 when the server has no CRON_SECRET configured", async () => {
    delete process.env.CRON_SECRET;
    const res = mockResponse();
    await handleJanitorStorageSweep(
      { method: "POST", headers: { "x-cron-secret": "anything" }, body: {} } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.CRON_SECRET = originalSecret;
    process.env.FIREBASE_STORAGE_BUCKET = originalBucket;
  });

  test("records the sweep result in the in-memory history", async () => {
    mockHistory.length = 0;
    const res = mockResponse();
    await handleJanitorStorageSweep(
      { method: "POST", headers: { "x-cron-secret": "test-cron-secret" }, body: {} } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockHistory.length).toBe(1);
    expect(mockHistory[0].scanned).toBe(5);
  });
});

describe("handleJanitorStats (H5)", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    mockHistory.length = 0;
  });

  test("rejects requests without a CRON_SECRET header (401)", async () => {
    const res = mockResponse();
    await handleJanitorStats({ method: "GET", headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("rejects non-GET methods (405)", async () => {
    const res = mockResponse();
    await handleJanitorStats(
      { method: "POST", headers: { "x-cron-secret": "test-cron-secret" } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("returns an empty history on a fresh deployment", async () => {
    const res = mockResponse();
    await handleJanitorStats(
      { method: "GET", headers: { "x-cron-secret": "test-cron-secret" } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.runs).toBe(0);
    expect(payload.data.totalDeleted).toBe(0);
    expect(payload.data.lastRunAt).toBeNull();
  });

  test("aggregates totals across the recorded runs", async () => {
    mockHistory.unshift({ scanned: 3, deleted: 2, kept: 1, errors: [], dryRun: false, durationMs: 5, at: 1 });
    mockHistory.unshift({ scanned: 5, deleted: 4, kept: 1, errors: [{ id: "x", error: "y" }], dryRun: false, durationMs: 8, at: 2 });
    const res = mockResponse();
    await handleJanitorStats(
      { method: "GET", headers: { "x-cron-secret": "test-cron-secret" } } as any,
      res
    );
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.runs).toBe(2);
    expect(payload.data.totalScanned).toBe(8);
    expect(payload.data.totalDeleted).toBe(6);
    expect(payload.data.totalErrors).toBe(1);
    expect(payload.data.lastRunAt).toBe(2);
  });

  test("returns 500 when the server has no CRON_SECRET configured", async () => {
    delete process.env.CRON_SECRET;
    const res = mockResponse();
    await handleJanitorStats(
      { method: "GET", headers: { "x-cron-secret": "anything" } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.CRON_SECRET = originalSecret;
  });
});
