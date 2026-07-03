// Cross-tab cache-invalidation tests for the public site content
// hook. Covers:
//   - `bustPublicSiteContentCache` writes the bust key
//   - `subscribeToPublicSiteContentBust` fires on a matching storage
//     event and clears the localStorage content cache before
//     calling back
//   - the hook imports + wires the subscription
//   - the admin updateSettings path calls the bust after a
//     websiteContent / hotelConfig save
//
// Tests are source-pattern + localStorage-stub style (consistent
// with `cache.test.ts`) so they don't need a JSDOM environment.

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Vitest runs each workspace from its own root; resolve paths
// relative to this file (the test) so the same code works whether
// the test is invoked from `/shared` (workspace) or from the
// monorepo root via `npm test`.
const HERE = resolve(__dirname, "..");
const REPO_ROOT = resolve(HERE, "..");

const SHARED_CACHE_TS = readFileSync(join(HERE, "utils", "publicSiteCache.ts"), "utf8");
const SHARED_INDEX_TS = readFileSync(join(HERE, "index.ts"), "utf8");
const SHARED_CONSTANTS_TS = readFileSync(join(HERE, "constants", "index.ts"), "utf8");
const HOOK_TS = readFileSync(
  join(REPO_ROOT, "guest-app", "src", "hooks", "usePublicSiteContent.ts"),
  "utf8"
);
const ADMIN_CTX_TS = readFileSync(
  join(REPO_ROOT, "admin-app", "src", "context", "AdminContext.tsx"),
  "utf8"
);

// In-memory localStorage + window stub for the runtime tests.
function makeStorageStub() {
  const data = new Map<string, string>();
  const listeners: Array<(e: { key: string; newValue: string | null; oldValue: string | null }) => void> = [];
  return {
    data,
    listeners,
    getItem: vi.fn((k: string) => (data.has(k) ? data.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      const old = data.get(k) ?? null;
      data.set(k, v);
      // Mirror the browser's storage event semantics: the writer's
      // own tab does NOT receive the event.
      for (const l of listeners) l({ key: k, newValue: v, oldValue: old });
    }),
    removeItem: vi.fn((k: string) => {
      const old = data.get(k) ?? null;
      data.delete(k);
      for (const l of listeners) l({ key: k, newValue: null, oldValue: old });
    }),
    clear: vi.fn(() => data.clear()),
    addEventListener: vi.fn((_e: string, fn: any) => listeners.push(fn)),
    removeEventListener: vi.fn((fn: any) => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    })
  };
}

function makeWindowStub(storage: ReturnType<typeof makeStorageStub>) {
  // Storage event listeners registered via `window.addEventListener`
  // (the way the production module subscribes). The localStorage
  // stub's `setItem` / `removeItem` fan out to these listeners so a
  // "write from another tab" can drive the bust handler.
  const listeners: Array<(e: { key: string; newValue: string | null; oldValue: string | null }) => void> = [];
  storage.addEventListener = vi.fn((_e: string, fn: any) => {
    // Reuse the same listener list as localStorage — the browser
    // does the same (the storage event is dispatched on `window`).
    if (!listeners.includes(fn)) listeners.push(fn);
  });
  storage.removeEventListener = vi.fn((fn: any) => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  });
  // When localStorage.setItem fires its own listeners, also fire the
  // window-scoped ones (the browser delivers one storage event to
  // the `window` per cross-tab change, not one per addEventListener).
  const originalSetItem = storage.setItem;
  storage.setItem = vi.fn((k: string, v: string) => {
    originalSetItem(k, v);
    for (const l of listeners) l({ key: k, newValue: v, oldValue: null });
  });
  return {
    localStorage: storage,
    addEventListener: storage.addEventListener,
    removeEventListener: storage.removeEventListener
  };
}

describe("publicSiteCache module", () => {
  describe("source wiring", () => {
    test("shared/index.ts re-exports the new module", () => {
      expect(SHARED_INDEX_TS).toMatch(/export\s+\*\s+from\s+["']\.\/utils\/publicSiteCache["']/);
    });

    test("shared/constants/index.ts declares the bust key constant", () => {
      expect(SHARED_CONSTANTS_TS).toMatch(
        /PUBLIC_SITE_CONTENT_CACHE_BUST_KEY\s*=\s*["']publicSiteContent:bust["']/
      );
      // Both constants live in the same file and the bust key sits
      // right after the existing content key.
      expect(SHARED_CONSTANTS_TS.indexOf("PUBLIC_SITE_CONTENT_CACHE_BUST_KEY")).toBeGreaterThan(
        SHARED_CONSTANTS_TS.indexOf("PUBLIC_SITE_CONTENT_CACHE_KEY")
      );
    });

    test("the hook imports the subscribe helper", () => {
      expect(HOOK_TS).toMatch(
        /import\s*\{[^}]*\bsubscribeToPublicSiteContentBust\b[^}]*\}\s+from\s+["']@spark-inn\/shared["']/
      );
    });

    test("the hook subscribes inside the useEffect and unsubscribes in cleanup", () => {
      // Must call subscribe inside the effect body…
      expect(HOOK_TS).toMatch(/subscribeToPublicSiteContentBust\(/);
      // …and invoke the returned unsubscribe function in the cleanup.
      expect(HOOK_TS).toMatch(/unsubscribeBust\(\)/);
    });

    test("AdminContext calls bustPublicSiteContentCache after a settings save", () => {
      expect(ADMIN_CTX_TS).toMatch(/import\s*\{[^}]*\bbustPublicSiteContentCache\b[^}]*\}/);
      expect(ADMIN_CTX_TS).toMatch(/bustPublicSiteContentCache\(\)/);
      // The bust call is gated on the two sections that affect the
      // public site hook.
      expect(ADMIN_CTX_TS).toMatch(
        /section\s*===\s*["']websiteContent["']\s*\|\|\s*section\s*===\s*["']hotelConfig["']/
      );
    });
  });

  describe("runtime behavior", () => {
    let storage: ReturnType<typeof makeStorageStub>;
    let originalWindow: any;
    let originalLocalStorage: any;

    beforeEach(() => {
      storage = makeStorageStub();
      originalWindow = (globalThis as any).window;
      originalLocalStorage = (globalThis as any).localStorage;
      const win = makeWindowStub(storage);
      (globalThis as any).window = win;
      (globalThis as any).localStorage = storage;
    });

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      (globalThis as any).localStorage = originalLocalStorage;
      vi.resetModules();
    });

    test("bustPublicSiteContentCache writes the current timestamp to the bust key", async () => {
      const mod = await import("../../shared/utils/publicSiteCache");
      const before = Date.now();
      mod.bustPublicSiteContentCache();
      const after = Date.now();
      const raw = storage.getItem("publicSiteContent:bust");
      expect(raw).not.toBeNull();
      const ts = Number.parseInt(raw!, 10);
      expect(Number.isFinite(ts)).toBe(true);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    test("readPublicSiteContentBustTimestamp returns 0 when the key is missing", async () => {
      const mod = await import("../../shared/utils/publicSiteCache");
      expect(mod.readPublicSiteContentBustTimestamp()).toBe(0);
    });

    test("readPublicSiteContentBustTimestamp returns the stored value", async () => {
      const mod = await import("../../shared/utils/publicSiteCache");
      storage.setItem("publicSiteContent:bust", "1234567890");
      expect(mod.readPublicSiteContentBustTimestamp()).toBe(1234567890);
    });

    test("subscribeToPublicSiteContentBust fires onBust when the bust key changes in another tab", async () => {
      const mod = await import("../../shared/utils/publicSiteCache");
      // Pre-populate the content cache so we can assert the bust
      // handler clears it.
      storage.setItem("publicSiteContent:v3", JSON.stringify({ fetchedAt: Date.now(), value: { x: 1 } }));

      const onBust = vi.fn();
      const unsubscribe = mod.subscribeToPublicSiteContentBust(onBust);

      // Simulate another tab writing the bust key.
      storage.setItem("publicSiteContent:bust", "9876543210");

      // The handler should have called back with the new timestamp…
      expect(onBust).toHaveBeenCalledTimes(1);
      expect(onBust).toHaveBeenCalledWith(9876543210);
      // …and cleared the cached content.
      expect(storage.getItem("publicSiteContent:v3")).toBeNull();

      unsubscribe();
    });

    test("subscribeToPublicSiteContentBust ignores storage events on other keys", async () => {
      const mod = await import("../../shared/utils/publicSiteCache");
      const onBust = vi.fn();
      const unsubscribe = mod.subscribeToPublicSiteContentBust(onBust);

      storage.setItem("some-other-key", "irrelevant");

      expect(onBust).not.toHaveBeenCalled();
      unsubscribe();
    });

    test("subscribeToPublicSiteContentBust returns a no-op unsubscribe when window is undefined (SSR)", async () => {
      (globalThis as any).window = undefined;
      const mod = await import("../../shared/utils/publicSiteCache");
      const onBust = vi.fn();
      const unsubscribe = mod.subscribeToPublicSiteContentBust(onBust);
      // Must not throw.
      unsubscribe();
      expect(onBust).not.toHaveBeenCalled();
    });
  });
});
