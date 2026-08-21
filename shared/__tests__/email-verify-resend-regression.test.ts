import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for the 2026-08-20 bug:
// "Resend verification email" button on the EmailVerifyBanner
// shows "Please wait a minute before resending." even after
// the user has waited more than a minute.
//
// Root cause (GuestAuthContext.tsx:80-101, sendCustomVerificationEmail):
// the catch block around the custom API call swallows the API's
// 429 ("Too many verification email requests…") and then
// runs `firebaseSendEmailVerification(user)` unconditionally
// as a fallback. The Firebase SDK then throws
// `auth/too-many-requests` (its own per-user throttle) and
// that error propagates uncaught out of the helper, into
// resendVerification, and into the banner's catch block which
// maps `auth/too-many-requests` to the user-facing "wait a
// minute" message — even when the API call itself succeeded
// or when the real cause was the API's 429.
//
// Fix:
//   1. Only fall back to the SDK when the API call failed
//      because the request never reached the server (network
//      error). When the API returned a real HTTP error (any
//      non-2xx), re-throw that error so the banner sees the
//      true cause. Do NOT swallow API HTTP errors just to
//      attempt an SDK fallback that produces an unbranded
//      email via a different code path.
//   2. Never silently swallow SDK errors in the catch — if
//      the SDK fallback throws (e.g. `auth/too-many-requests`),
//      surface it.
//
// The banner keeps its existing `auth/too-many-requests`
// mapping (the SDK fallback path is still reachable on
// network failure, e.g. offline), but it will no longer be
// triggered by the API's own 429.

const repoRoot = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("EMAIL-RESEND-1 — sendCustomVerificationEmail does not silently swallow API HTTP errors", () => {
  const ctxSrc = read("guest-app/src/context/GuestAuthContext.tsx");

  it("re-throws (does not swallow) errors thrown when the API returns a non-OK response", () => {
    // The fix moves the `firebaseSendEmailVerification(user)`
    // fallback out of the unconditional catch. The API path's
    // own errors must propagate so resendVerification() can
    // surface them to the banner with the right cause.
    //
    // We pin the structural pattern: there must NOT be a bare
    // `await firebaseSendEmailVerification(user)` inside the
    // catch block that wraps the `fetch` to
    // `/api/members/send-verification-email`. If the API
    // responds with 429, the helper must re-throw that error
    // rather than calling the SDK.
    //
    // The simplest source-level check: the SDK fallback call
    // is gone, OR it lives inside a `catch` that only fires on
    // network errors (the `fetch` itself threw), and a
    // separate `if (!res.ok)` branch re-throws the API error.
    //
    // Either shape is acceptable. We assert the bug-shape is
    // gone: the catch block does not unconditionally call the
    // SDK fallback AND continue returning `false` regardless of
    // what the SDK did.
    const helperStart = ctxSrc.indexOf("async function sendCustomVerificationEmail");
    expect(helperStart, "sendCustomVerificationEmail helper must exist").toBeGreaterThan(-1);
    const helperEnd = ctxSrc.indexOf("export async function GuestAuthProvider", helperStart);
    const helperBody = ctxSrc.slice(helperStart, helperEnd);

    // The bug: a single try/catch where the catch calls the SDK
    // fallback and returns false regardless of what the SDK did.
    // Pin that this shape is no longer present.
    const unconditionalSdkFallbackPattern =
      /} catch \(err\) \{[\s\S]*?await firebaseSendEmailVerification\(user\);[\s\S]*?return false;[\s\S]*?\}/;
    expect(
      helperBody.match(unconditionalSdkFallbackPattern),
      "sendCustomVerificationEmail must not unconditionally fall back to firebaseSendEmailVerification on every error"
    ).toBeNull();
  });

  it("the API's 429 response is not swallowed by a silent SDK fallback", () => {
    // Stronger pin: when the fetch gets a non-OK response, the
    // helper either re-throws (preferred) or surfaces the API's
    // error message back to the caller. Either way, the
    // Firebase SDK is not called as a fallback when the API
    // already responded.
    //
    // Implementation guidance: split the function into
    //   - try { fetch; if (!res.ok) throw new Error(data.error); return true; }
    //   - catch only network-class errors → fall back to SDK
    // OR
    //   - keep one try/catch but re-throw the API error after
    //     logging, and only attempt the SDK fallback when the
    //     error came from the fetch itself.
    //
    // Both shapes remove the bug. This test asserts the
    // observable contract: there is no `firebaseSendEmailVerification`
    // call reachable from the `if (!res.ok)` branch.
    const helperStart = ctxSrc.indexOf("async function sendCustomVerificationEmail");
    const helperEnd = ctxSrc.indexOf("export async function GuestAuthProvider", helperStart);
    const helperBody = ctxSrc.slice(helperStart, helperEnd);

    // Look for the `!res.ok` branch and assert it does not
    // contain the SDK fallback call.
    const nonOkMatch = helperBody.match(/if \(!res\.ok\) \{([\s\S]*?)\n\s*\}/);
    expect(nonOkMatch, "expected an `if (!res.ok)` branch").not.toBeNull();
    const nonOkBranch = nonOkMatch![1];
    expect(
      nonOkBranch.includes("firebaseSendEmailVerification"),
      "`if (!res.ok)` branch must not invoke the Firebase SDK fallback — it must throw so the banner sees the real API error"
    ).toBe(false);
  });
});

describe("EMAIL-RESEND-2 — EmailVerifyBanner keeps its `auth/too-many-requests` mapping", () => {
  // We are NOT changing the banner's error mapping — the SDK
  // fallback is still reachable on network failure (offline,
  // DNS failure), and Firebase's per-user throttle on the SDK
  // path is a real signal we want to surface as "wait a minute".
  // This test guards against an over-broad fix that removes the
  // mapping entirely.
  const bannerSrc = read("guest-app/src/components/EmailVerifyBanner.tsx");

  it("still maps the SDK's auth/too-many-requests code to the friendly copy", () => {
    expect(bannerSrc).toMatch(/err\?\.code === ["']auth\/too-many-requests["']/);
    expect(bannerSrc).toMatch(/Please wait a minute before resending\./);
  });
});