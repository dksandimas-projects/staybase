import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBucket, mockDb, mockSweep } = vi.hoisted(() => {
  const mockBucket = { name: "test-bucket" };
  const mockDb = { __db: true };
  const mockSweep = vi.fn();
  return { mockBucket, mockDb, mockSweep };
});

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: mockDb,
  adminAuth: {},
  adminStorage: { bucket: vi.fn(() => mockBucket) }
}));

vi.mock("@spark-inn/shared", async () => {
  const actual = await vi.importActual<any>("@spark-inn/shared");
  return { ...actual, sweepBookingsStorage: mockSweep };
});

import { handleJanitorStorageSweep } from "../../server/handlers/janitor";

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
});
