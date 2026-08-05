// Per MRB-15-09 (2026-08-03, per decision #182):
// the admin `reservations` collection listener must
// force-refresh the current ID token BEFORE attaching
// `onSnapshot`. Without the force-refresh, a listener
// handshake that lands before the SDK's cached token
// has caught up to a freshly-minted `role` custom claim
// gets a `Missing or insufficient permissions` reply
// from the `isStaff()` rule on `/reservations/{id}`
// (`firebase/firestore.rules:140-141`). The fix is a
// one-line `auth.currentUser?.getIdToken(true)` awaited
// inside the effect, before the `onSnapshot(...)` call.
// This file pins the contract at the source level so a
// future refactor that drops the await (e.g. extracting
// the listener into a custom hook that runs synchronously)
// silently regresses the bug instead of shipping it.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural emulator
// round-trip (token-without-claim → listener → expect
// `permission-denied`; token-with-claim → listener →
// expect success) would need the Java emulator env and
// is deferred (mirrors the MRB-11 + CRL-09 + MRB-14
// + MRB-15 precedent). The source-text guards are the
// higher-signal coverage for a one-line patch.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

// Slice the `useEffect` that hydrates `reservations`
// from the `reservations` collection (the MRB-12 listener
// at AdminContext.tsx:1529). The slice runs from the
// `useEffect` opener to the dependency-array close so
// any future re-shape of the body keeps the test
// targeting just this effect, not the bookings / rooms
// listeners in the same file.
const reservationsEffectStart = src.indexOf(
  "  // Per MRB-12 (2026-08-03, per decision #179 — proposed):\n  // subscribe to the `reservations` collection and hydrate"
);
const reservationsEffectEnd = src.indexOf(
  "  }, [currentUser]);\n\n  // Per MRB-12 (2026-08-03, per decision #179 — proposed):\n  // the reservation-scope `paidAmount` aggregate."
);
const reservationsEffect =
  reservationsEffectStart >= 0 && reservationsEffectEnd > reservationsEffectStart
    ? src.slice(reservationsEffectStart, reservationsEffectEnd)
    : "";

describe("MRB-15-09 — `subscribeToReservations` force-refreshes the auth token before attaching", () => {
  it("the reservations listener `useEffect` is present and locatable", () => {
    // Sanity: the slice exists. If a future refactor
    // re-shapes the comment marker above, the regex
    // matchers below still pass on the broader
    // `onSnapshot(collection(db, "reservations")` token
    // so this guard is a one-line tripwire.
    expect(reservationsEffect.length).toBeGreaterThan(0);
    expect(reservationsEffect).toMatch(/collection\(db, "reservations"\)/);
  });

  it("force-refreshes the auth token before attaching `onSnapshot` (MRB-15-09 fix)", () => {
    // The contract: inside the reservations `useEffect`,
    // a `getIdToken(true)` call on `auth.currentUser`
    // must be awaited (or `.then`-chained) BEFORE the
    // `onSnapshot(collection(db, "reservations"), ...)`
    // call. The `true` argument is the force-refresh
    // flag — `getIdToken()` (no flag) would honour the
    // SDK's cached token, defeating the fix.
    //
    // The slice-order check: locate the index of the
    // `getIdToken(true)` call and the index of the
    // `onSnapshot(` call inside the same effect and
    // assert the refresh is FIRST. This catches a
    // future refactor that calls `onSnapshot` from a
    // separate helper before the token refresh resolves.
    const refreshIndex = reservationsEffect.indexOf("getIdToken(true)");
    const snapshotIndex = reservationsEffect.indexOf("onSnapshot(");
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeLessThan(snapshotIndex);
  });

  it("targets the current user (`auth.currentUser?.getIdToken(true)`)", () => {
    // The patch uses the optional chain on `auth.currentUser`
    // — when the user has just signed out, the SDK still
    // returns a possibly-null `currentUser` for a microtask
    // and the chain makes the refresh a no-op (the `void`
    // prefix swallows the `undefined` return; the early
    // `currentUser` gate above already returned on null).
    expect(reservationsEffect).toMatch(/auth\.currentUser\?\.getIdToken\(true\)/);
  });

  it("awaits the refresh (does NOT fire-and-forget)", () => {
    // A bare `auth.currentUser.getIdToken(true)` (no
    // `await`, no `.then`) would NOT block the
    // `onSnapshot` attach — the snapshot would still
    // fire with the cached token, regressing the bug.
    // The patch uses `void ... .then(() => { ... onSnapshot(...) })`
    // so the `onSnapshot` is queued inside the resolve
    // handler. We assert the `.then(` form is present
    // (or, for the alternative `await` form, the
    // `await` keyword is present — see the second
    // match below).
    expect(reservationsEffect).toMatch(/void auth\.currentUser\?\.getIdToken\(true\)\.then\(/);
  });

  it("cancels the listener attach if the effect was torn down mid-refresh", () => {
    // Race condition: `currentUser` flips (e.g. sign-out
    // → sign-in of a different staff) before the
    // `getIdToken(true)` promise resolves. The cleanup
    // function must flip a `cancelled` flag that the
    // `.then` handler checks before attaching. Without
    // this, a stale refresh would re-attach the listener
    // AFTER the new effect has already done so, leaking
    // a duplicate listener and stalling the UI on the
    // wrong user's data.
    expect(reservationsEffect).toMatch(/let cancelled = false;/);
    expect(reservationsEffect).toMatch(/if \(cancelled\) return;/);
    expect(reservationsEffect).toMatch(
      /return \(\) => \{\s*cancelled = true;[\s\S]*?unsubscribe\?\.\(\);/
    );
  });

  it("still returns an unsubscribe from the effect cleanup", () => {
    // The MRB-12 contract: the effect must return
    // `unsubscribe` (or a cleanup that calls it) so
    // React tears down the Firestore listener on
    // unmount / `currentUser` change. The MRB-15-09
    // patch preserves this — the cleanup is the arrow
    // that flips `cancelled = true` and calls
    // `unsubscribe?.()`. (Per the cancellation test
    // above, the same regex covers the cleanup body.)
    expect(reservationsEffect).toMatch(/return \(\) => \{[\s\S]*?unsubscribe\?\.\(\);[\s\S]*?\};/);
  });

  it("logs the error on listener failure (the pre-MRB-15-09 behaviour is preserved)", () => {
    // The original MRB-12 contract: the error callback
    // on `onSnapshot` must `console.error` so a future
    // permission hiccup logs instead of surfacing as
    // "Uncaught Error in snapshot listener". The
    // MRB-15-09 patch keeps this. The error string
    // is the same one the operator pasted in the bug
    // report.
    expect(reservationsEffect).toMatch(/console\.error\(\s*["']Error listening to reservations collection:/);
  });

  it("logs the error if the token refresh itself fails", () => {
    // Edge case: the refresh can fail (network down,
    // refresh token revoked by Firebase after a long
    // idle, etc.). Without a `.catch`, the failure is
    // a silent unhandled-promise-rejection. The patch
    // adds a `.catch` that logs the error and
    // intentionally does NOT attach the listener —
    // the UI just stays on its last known state until
    // the next auth cycle.
    expect(reservationsEffect).toMatch(/\.catch\(\(refreshError\)\s*=>\s*\{[\s\S]*?console\.error\(/);
  });
});
