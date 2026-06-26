import { beforeEach, describe, expect, test, vi } from "vitest";
import { runBackfill } from "../utils/storageJanitor";

describe("runBackfill (S1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("updates only docs that satisfy needsUpdate", async () => {
    const docs = [
      { id: "a", data: { bookingRef: "SI-20260101-00001" } }, // missing token
      { id: "b", data: { bookingRef: "SI-20260101-00002", lookupToken: "000102030405060708090a0b0c0d0e0f" } },
      { id: "c", data: { bookingRef: "SI-20260101-00003" } }, // missing token
    ];
    const updates: Array<{ id: string; patch: any }> = [];
    const result = await runBackfill({
      collection: {
        query: async (_afterId, _limit) => docs,
        update: async (id, patch) => { updates.push({ id, patch }); }
      },
      needsUpdate: (doc) => !doc.data.lookupToken,
      buildPatch: () => ({ lookupToken: "newtoken0000000000000000000000" }),
      batchSize: 10
    });
    expect(result.scanned).toBe(3);
    expect(result.updated).toBe(2);
    expect(result.skipped).toBe(1);
    expect(updates.map((u) => u.id).sort()).toEqual(["a", "c"]);
    expect(result.exhausted).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  test("reports exhausted when the page is smaller than the batch", async () => {
    const docs = [{ id: "a", data: {} }];
    const result = await runBackfill({
      collection: {
        query: async () => docs,
        update: async () => {}
      },
      needsUpdate: () => true,
      buildPatch: () => ({}),
      batchSize: 500
    });
    expect(result.exhausted).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  test("returns the cursor when the page is full (resume point)", async () => {
    const docs = Array.from({ length: 3 }, (_, i) => ({ id: `id_${i}`, data: {} }));
    const result = await runBackfill({
      collection: {
        query: async () => docs,
        update: async () => {}
      },
      needsUpdate: () => true,
      buildPatch: () => ({}),
      batchSize: 3
    });
    expect(result.exhausted).toBe(false);
    expect(result.nextCursor).toBe("id_2");
  });

  test("invokes onUpdate once per updated doc", async () => {
    const onUpdate = vi.fn();
    await runBackfill({
      collection: {
        query: async () => [
          { id: "a", data: {} },
          { id: "b", data: { lookupToken: "set" } },
          { id: "c", data: {} }
        ],
        update: async () => {}
      },
      needsUpdate: (doc) => !doc.data.lookupToken,
      buildPatch: () => ({}),
      batchSize: 10,
      onUpdate
    });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledWith("a");
    expect(onUpdate).toHaveBeenCalledWith("c");
  });
});
