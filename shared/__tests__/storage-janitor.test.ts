import { beforeEach, describe, expect, test, vi } from "vitest";
import { sweepBookingsStorage } from "../utils/storageJanitor";

const { mockBucket, mockDb, mockDoc, mockFirestore } = vi.hoisted(() => {
  const mockDoc = vi.fn();
  const mockFirestore = { collection: vi.fn() };
  const mockBucket = {
    getFiles: vi.fn(),
    deleteFiles: vi.fn()
  };
  const mockDb = { collection: vi.fn() };
  return { mockBucket, mockDb, mockDoc, mockFirestore };
});

describe("sweepBookingsStorage (BF-50)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupBucket(prefixes: string[], nextPageToken?: string) {
    // The Admin SDK returns "files" whose names end with
    // "/" when `delimiter: "/"` is set; we model them as
    // raw `name` strings.
    const files = prefixes.map((name) => ({ name }));
    mockBucket.getFiles.mockResolvedValue([files, nextPageToken ?? undefined]);
  }

  function setupFirestore(existingIds: string[]) {
    const existing = new Set(existingIds);
    mockDb.collection.mockImplementation(() => ({
      doc: (id: string) => ({
        get: async () => ({ exists: existing.has(id) })
      })
    }));
  }

  test("deletes subfolders whose booking doc does not exist", async () => {
    setupBucket(["bookings/abc/", "bookings/def/"]);
    setupFirestore([]); // no docs exist
    mockBucket.deleteFiles.mockResolvedValue(undefined);

    const result = await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any
    });

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.kept).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.nextPageToken).toBeNull();
    expect(mockBucket.deleteFiles).toHaveBeenCalledTimes(2);
    expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
      prefix: "bookings/abc/",
      force: true
    });
    expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
      prefix: "bookings/def/",
      force: true
    });
  });

  test("keeps subfolders whose booking doc exists", async () => {
    setupBucket(["bookings/abc/", "bookings/def/"]);
    setupFirestore(["abc"]); // only "abc" has a doc
    mockBucket.deleteFiles.mockResolvedValue(undefined);

    const result = await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any
    });

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.kept).toBe(1);
    expect(mockBucket.deleteFiles).toHaveBeenCalledTimes(1);
    expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
      prefix: "bookings/def/",
      force: true
    });
  });

  test("passes the continuation token through to the next call", async () => {
    setupBucket(["bookings/a/"], "page-2-token");
    setupFirestore([]);

    const result = await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any
    });

    expect(result.nextPageToken).toBe("page-2-token");
    expect(mockBucket.getFiles).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "bookings/", delimiter: "/" })
    );
  });

  test("forwards a custom pageToken on a continuation call", async () => {
    setupBucket(["bookings/z/"]);
    setupFirestore([]);
    await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any,
      pageToken: "page-2-token"
    });
    expect(mockBucket.getFiles).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: "page-2-token" })
    );
  });

  test("dryRun reports deletions without calling deleteFiles", async () => {
    setupBucket(["bookings/abc/"]);
    setupFirestore([]);

    const result = await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any,
      dryRun: true
    });

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(mockBucket.deleteFiles).not.toHaveBeenCalled();
  });

  test("ignores files outside the prefix", async () => {
    setupBucket(["other/x/", "bookings/abc/"]);
    setupFirestore([]);

    const result = await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any
    });

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(1);
  });

  test("ignores files that are not subfolders (no trailing slash)", async () => {
    setupBucket(["bookings/abc/somefile.png", "bookings/def/"]);
    setupFirestore([]);

    const result = await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any
    });

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(1);
  });

  test("captures per-id errors and continues the sweep", async () => {
    setupBucket(["bookings/abc/", "bookings/def/"]);
    setupFirestore([]);
    mockBucket.deleteFiles
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(undefined);

    const result = await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any
    });

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.errors).toEqual([
      { id: "abc", error: "storage unavailable" }
    ]);
  });

  test("respects the maxItems cap by passing it to getFiles", async () => {
    setupBucket(["bookings/abc/"]);
    setupFirestore([]);
    await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any,
      maxItems: 50
    });
    expect(mockBucket.getFiles).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 50 })
    );
  });

  test("uses a custom prefix when supplied", async () => {
    setupBucket(["discounts/abc/"]);
    setupFirestore([]);
    await sweepBookingsStorage({
      bucket: mockBucket,
      db: mockDb as any,
      prefix: "discounts/"
    });
    expect(mockBucket.getFiles).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "discounts/" })
    );
    expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
      prefix: "discounts/abc/",
      force: true
    });
  });
});
