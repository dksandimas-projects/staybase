import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { readCacheWithTtl, writeCache, clearCache } from "../utils/cache";

// The shared package's vitest config runs in node (no jsdom). The
// cache helper is environment-agnostic, so we stub the global
// `window` / `localStorage` per test rather than depending on a
// DOM library. Each test sets up its own fresh in-memory store.

interface FakeStorage {
  store: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
}

function makeFakeStorage(): FakeStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
}

interface GlobalWindow {
  localStorage: FakeStorage;
}

const KEY = "test:cache:v1";
const TTL = 5 * 60 * 1000; // 5 minutes — matches the public site TTL

let originalWindow: unknown;

beforeEach(() => {
  originalWindow = (globalThis as { window?: unknown }).window;
  const fake = makeFakeStorage();
  (globalThis as { window: GlobalWindow }).window = { localStorage: fake };
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("cache helper", () => {
  describe("readCacheWithTtl", () => {
    test("returns null when the key is not set", () => {
      expect(readCacheWithTtl<string>(KEY, TTL)).toBeNull();
    });

    test("returns the value when fresh", () => {
      writeCache(KEY, { name: "spark inn" });
      expect(readCacheWithTtl<{ name: string }>(KEY, TTL)).toEqual({ name: "spark inn" });
    });

    test("returns null when the value is stale (older than TTL)", () => {
      // Write at t=0, read at t=TTL+1ms → stale.
      writeCache(KEY, { name: "spark inn" }, 0);
      expect(readCacheWithTtl<{ name: string }>(KEY, TTL, TTL + 1)).toBeNull();
    });

    test("returns the value exactly at the TTL boundary", () => {
      // `now - fetchedAt > ttl` is the strict-greater-than check,
      // so the boundary itself is still considered fresh.
      writeCache(KEY, "v1", 0);
      expect(readCacheWithTtl<string>(KEY, TTL, TTL)).toBe("v1");
    });

    test("returns null when the JSON is malformed", () => {
      window.localStorage.setItem(KEY, "{not valid json");
      expect(readCacheWithTtl<string>(KEY, TTL)).toBeNull();
    });

    test("returns null when the envelope shape is wrong (missing fetchedAt)", () => {
      window.localStorage.setItem(KEY, JSON.stringify({ value: "x" }));
      expect(readCacheWithTtl<string>(KEY, TTL)).toBeNull();
    });

    test("returns null when fetchedAt is not a number", () => {
      window.localStorage.setItem(KEY, JSON.stringify({ fetchedAt: "yesterday", value: "x" }));
      expect(readCacheWithTtl<string>(KEY, TTL)).toBeNull();
    });

    test("returns null on the server (no window)", () => {
      delete (globalThis as { window?: unknown }).window;
      expect(readCacheWithTtl<string>(KEY, TTL)).toBeNull();
    });

    test("returns null when localStorage.getItem throws (e.g. private mode)", () => {
      const originalGetItem = window.localStorage.getItem;
      window.localStorage.getItem = vi.fn(() => {
        throw new Error("SecurityError: storage access denied");
      }) as FakeStorage["getItem"];
      try {
        expect(readCacheWithTtl<string>(KEY, TTL)).toBeNull();
      } finally {
        window.localStorage.getItem = originalGetItem;
      }
    });
  });

  describe("writeCache", () => {
    test("stores a value that survives a round-trip read", () => {
      writeCache(KEY, { hello: "world" });
      expect(readCacheWithTtl<{ hello: string }>(KEY, TTL)).toEqual({ hello: "world" });
    });

    test("no-ops on the server (no window)", () => {
      delete (globalThis as { window?: unknown }).window;
      expect(() => writeCache(KEY, { hello: "world" })).not.toThrow();
    });

    test("no-ops when localStorage.setItem throws (e.g. quota / private mode)", () => {
      const originalSetItem = window.localStorage.setItem;
      window.localStorage.setItem = vi.fn(() => {
        throw new Error("QuotaExceededError");
      }) as FakeStorage["setItem"];
      try {
        expect(() => writeCache(KEY, { hello: "world" })).not.toThrow();
      } finally {
        window.localStorage.setItem = originalSetItem;
      }
    });
  });

  describe("clearCache", () => {
    test("removes a previously-written key", () => {
      writeCache(KEY, "v1");
      expect(readCacheWithTtl<string>(KEY, TTL)).toBe("v1");
      clearCache(KEY);
      expect(readCacheWithTtl<string>(KEY, TTL)).toBeNull();
    });

    test("no-ops on the server (no window)", () => {
      delete (globalThis as { window?: unknown }).window;
      expect(() => clearCache(KEY)).not.toThrow();
    });
  });
});
