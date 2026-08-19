import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  raceUploadWithTimeout,
  DEFAULT_UPLOAD_TIMEOUT_MS
} from "../../shared/utils/uploads";

// Regression test for B-10 / B-10c / decision #223 (2026-08-19):
// the payment-proof + Senior/PWD discount-ID upload handlers in
// `guest-app/src/pages/BookingPage.tsx` race `uploadBytes(...)` on
// Firebase Storage against a 90s timeout (the shared helper
// `raceUploadWithTimeout` from `shared/utils/uploads.ts`). Without
// the wrap, a hung mobile connection leaves the "Uploading..."
// spinner up indefinitely (the `finally` block runs but
// `uploadBytes` never resolves).
//
// The test plan: source-text pins on the helper + the two call
// sites (cheap, deterministic) plus runtime assertions on the
// helper itself (the audit-skill v0.264.9 retrofit pattern:
// source-text pins alone allow the same shape against any typed
// input; runtime assertions against representative fixtures
// catch drift in the actual race semantics).

describe("B-10/B-10c — Upload timeout helper (decision #223)", () => {
  describe("shared/utils/uploads.ts — source-text contract", () => {
    const src = readFileSync(
      resolve(__dirname, "../../shared/utils/uploads.ts"),
      "utf8"
    );

    it("exports raceUploadWithTimeout as an async function", () => {
      expect(src).toMatch(/export\s+async\s+function\s+raceUploadWithTimeout/);
    });

    it("accepts (uploadPromise, timeoutMs, label) parameters", () => {
      // The signature is `<T>(uploadPromise: Promise<T>,
      // timeoutMs: number, label = "Upload")`. A future refactor
      // that drops the `label` parameter (so the error message
      // loses its tag) would break this pin.
      expect(src).toMatch(/uploadPromise:\s*Promise<T>/);
      expect(src).toMatch(/timeoutMs:\s*number/);
      expect(src).toMatch(/label\s*=\s*["']Upload["']/);
    });

    it("rejects with a tagged Error mentioning the timeout", () => {
      // The thrown error is the only surface the UI sees when
      // the race times out — its message goes to the existing
      // catch block at BookingPage.tsx:1359. The message MUST
      // include "timed out" so the catch's
      // "Receipt upload failed. Please check your connection..."
      // fallback isn't the only diagnostic the staff sees in
      // the browser console. The source uses a backtick
      // template literal (matches the helper's `label` parameter
      // plus the `${Math.round(timeoutMs / 1000)}` seconds).
      expect(src).toMatch(/new Error\s*\(/);
      expect(src).toMatch(/\$\{label\}\s+timed\s+out\s+after/);
      expect(src).toMatch(/Please check your connection and retry/);
    });

    it("clears the timeout via `finally` (no leaked Node timers)", () => {
      // Without the `clearTimeout(timeoutHandle)` in the finally
      // block, every timed-out upload would leave a Node timer
      // queued. At 14 rooms × manual check-ins during a busy
      // morning a memory leak is plausible. Pin the cleanup.
      expect(src).toMatch(/clearTimeout\(timeoutHandle\)/);
      expect(src).toMatch(/finally\s*\{/);
    });

    it("exports DEFAULT_UPLOAD_TIMEOUT_MS as 90_000 (90s)", () => {
      // 90s covers the worst-case 5MB screenshot upload on 3G
      // (~50KB/s) plus auth handshake + SDK round-trips. Pin
      // the exact value so a future refactor that lowers it to
      // 5s "to be safer" doesn't silently break slow-network users.
      expect(src).toMatch(/export\s+const\s+DEFAULT_UPLOAD_TIMEOUT_MS\s*=\s*90_000/);
    });
  });

  describe("BookingPage.tsx — both upload call sites use the helper", () => {
    const src = readFileSync(
      resolve(__dirname, "../../guest-app/src/pages/BookingPage.tsx"),
      "utf8"
    );

    it("imports raceUploadWithTimeout + DEFAULT_UPLOAD_TIMEOUT_MS from @spark-inn/shared", () => {
      // The helper is re-exported via shared/index.ts so the
      // booking page imports it the same way it imports
      // compressImageFile / requiredExtraBedsFor.
      const importBlock = src.match(
        /import\s*\{[\s\S]*?\}\s*from\s*["']@spark-inn\/shared["']/
      );
      expect(importBlock).not.toBeNull();
      expect(importBlock![0]).toMatch(/raceUploadWithTimeout/);
      expect(importBlock![0]).toMatch(/DEFAULT_UPLOAD_TIMEOUT_MS/);
    });

    it("payment-proof upload wraps uploadBytes in raceUploadWithTimeout", () => {
      // Slice from the payment-proof `try {` (after the
      // `setUploadingPaymentProof(true)` line) to the matching
      // `} catch (err) {`. Anchor on the unique
      // `bookings/${bookingId}/payment-proof/${safeFileName}`
      // path string.
      const slice = src.match(
        /bookings\/\$\{bookingId\}\/payment-proof\/\$\{safeFileName\}[\s\S]*?\} catch\s*\(err:\s*any\)\s*\{/
      );
      expect(slice).not.toBeNull();
      expect(slice![0]).toMatch(/raceUploadWithTimeout\s*\(/);
      expect(slice![0]).toMatch(/DEFAULT_UPLOAD_TIMEOUT_MS/);
      expect(slice![0]).toMatch(/["']Receipt upload["']/);
    });

    it("discount-ID upload wraps uploadBytes in raceUploadWithTimeout", () => {
      const slice = src.match(
        /bookings\/\$\{bookingId\}\/discount-id\/\$\{safeFileName\}[\s\S]*?\} catch\s*\(err:\s*any\)\s*\{/
      );
      expect(slice).not.toBeNull();
      expect(slice![0]).toMatch(/raceUploadWithTimeout\s*\(/);
      expect(slice![0]).toMatch(/DEFAULT_UPLOAD_TIMEOUT_MS/);
      expect(slice![0]).toMatch(/["']Discount ID upload["']/);
    });

    it("does NOT have any unguarded `await uploadBytes(` calls remaining", () => {
      // Belt-and-braces — pins both replacements, not just the
      // new ones. A future refactor that adds a third upload
      // site without wrapping it would fail this pin.
      const unguardedCalls = src.match(
        /^\s*const\s+\w+\s*=\s*await\s+uploadBytes\s*\(/gm
      );
      expect(unguardedCalls).toBeNull();
    });
  });

  describe("runtime — raceUploadWithTimeout behavior against representative fixtures", () => {
    it("resolves with the upload promise's value when it settles first", async () => {
      // The fast-path: successful upload. The race should return
      // the underlying promise's value (the UploadResult the
      // Firebase SDK would normally return).
      const result = await raceUploadWithTimeout(
        Promise.resolve({ ref: { fullPath: "/ok" } }),
        1000,
        "Test upload"
      );
      expect(result).toEqual({ ref: { fullPath: "/ok" } });
    });

    it("rejects with a tagged Error when the timeout wins the race", async () => {
      vi.useFakeTimers();
      try {
        const neverResolves = new Promise(() => {});
        const pending = raceUploadWithTimeout(neverResolves, 100, "Test upload");
        // Advance the fake timers past the 100ms timeout so
        // the setTimeout inside the helper fires.
        vi.advanceTimersByTime(150);
        await expect(pending).rejects.toThrow(/Test upload timed out after/);
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears the timeout when the upload resolves (no leaked timers)", async () => {
      // Spy on clearTimeout to confirm the cleanup happens. If
      // the helper forgot the `finally { clearTimeout(...) }`,
      // the timer would stay queued after the upload finished.
      const clearSpy = vi.spyOn(globalThis, "clearTimeout");
      try {
        await raceUploadWithTimeout(
          Promise.resolve({ ok: true }),
          60_000,
          "Test upload"
        );
        expect(clearSpy).toHaveBeenCalled();
      } finally {
        clearSpy.mockRestore();
      }
    });

    it("uses DEFAULT_UPLOAD_TIMEOUT_MS = 90_000", () => {
      expect(DEFAULT_UPLOAD_TIMEOUT_MS).toBe(90_000);
    });
  });
});
