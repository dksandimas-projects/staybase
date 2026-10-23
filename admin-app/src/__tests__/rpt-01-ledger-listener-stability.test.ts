// Per RPT-01 (2026-10-23 handoff §4): the Bookings LIST showed
// "Balance due 69" (every booking owing) while the booking DRAWER showed
// the correct amounts for the same booking.
//
// The diagnosis, reproduced against live production data:
//
//   - the money math and the ledger projection are CORRECT (an empty
//     ledger index reproduces the live chips exactly — 0 paid pills /
//     69 balance due / 10 needs attention);
//   - the deployed bundle is byte-identical to a fresh build of this
//     source;
//   - the Firestore rules allow the `collectionGroup("payments")` read;
//   - a denied collection-group query errors LOUDLY, and the live app
//     logged no such error.
//
// What was left was the client's own listener lifecycle. The auth
// handler called `getIdTokenResult(firebaseUser, true)` on EVERY
// `onAuthStateChanged` event. Forcing a refresh mints a new ID token,
// the SDK fires `onAuthStateChanged` again for that token, and the
// handler forces another refresh — a feedback loop (observed: five
// forced refreshes in ~3ms at load, then one every 30s).
//
// Every firing built a BRAND-NEW `currentUser` object, so every effect
// whose dependency array listed `currentUser` was torn down and
// re-attached. The LIST's ledger listeners
// (`collectionGroup("payments")` / `collectionGroup("refunds")`) were
// re-subscribed before their first snapshot could land, so the ledger
// index stayed EMPTY. The DRAWER was unaffected because its listener
// depends on `selectedBooking?.id` — a stable primitive.
//
// This file pins the three fixes so the next reader cannot revert any
// of them:
//
//   1. the forced token refresh happens ONCE per uid, not per event;
//   2. `currentUser`'s identity is preserved when nothing changed, so
//      the `[currentUser]`-dependency effects are not re-subscribed;
//   3. the ledger listeners depend on the stable `currentUser?.uid` and
//      hydrate through a one-shot `getDocs` read that cannot be starved
//      by re-subscription timing.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../src/context/AdminContext.tsx"),
  "utf8"
);

// The auth handler: from the `onAuthStateChanged` subscription to the
// end of its effect.
const authHandlerStart = adminContextSrc.indexOf(
  "const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {"
);
const authHandlerEnd = adminContextSrc.indexOf("}, [", authHandlerStart);
const authHandler =
  authHandlerStart >= 0 && authHandlerEnd > authHandlerStart
    ? adminContextSrc.slice(authHandlerStart, authHandlerEnd)
    : "";

// The payments ledger listener: the WHOLE effect, from its `useEffect`
// opener through the end of its dependency array.
const paymentsCollectionStart = adminContextSrc.indexOf(
  'collectionGroup(db, "payments"),'
);
const paymentsEffectStart = adminContextSrc.lastIndexOf(
  "useEffect(() => {",
  paymentsCollectionStart
);
const paymentsEffectEnd = adminContextSrc.indexOf(
  "}, [currentUser?.uid]);",
  paymentsCollectionStart
);
const paymentsListener =
  paymentsEffectStart >= 0 && paymentsEffectEnd > paymentsEffectStart
    ? adminContextSrc.slice(paymentsEffectStart, paymentsEffectEnd)
    : "";

const refundsCollectionStart = adminContextSrc.indexOf(
  'collectionGroup(db, "refunds"),'
);
const refundsEffectStart = adminContextSrc.lastIndexOf(
  "useEffect(() => {",
  refundsCollectionStart
);
const refundsEffectEnd = adminContextSrc.indexOf(
  "}, [currentUser?.uid]);",
  refundsCollectionStart
);
const refundsListener =
  refundsEffectStart >= 0 && refundsEffectEnd > refundsEffectStart
    ? adminContextSrc.slice(refundsEffectStart, refundsEffectEnd)
    : "";

describe("RPT-01 — the admin list's ledger listener must stay attached", () => {
  it("the auth handler forces the token refresh only ONCE per uid", () => {
    expect(authHandler).not.toBe("");
    // The forced refresh must be conditional, not unconditional.
    expect(authHandler).not.toMatch(
      /getIdTokenResult\(\s*firebaseUser\s*,\s*true\s*\)/
    );
    expect(authHandler).toMatch(/needsForcedRefresh/);
    expect(authHandler).toMatch(
      /forcedRoleForUidRef\.current !== firebaseUser\.uid/
    );
    expect(authHandler).toMatch(
      /getIdTokenResult\(\s*firebaseUser\s*,\s*needsForcedRefresh\s*\)/
    );
  });

  it("`currentUser` keeps a stable identity so the listener effects are not re-subscribed", () => {
    expect(authHandler).toMatch(/setCurrentUser\(\(prev\) =>/);
    // The previous object is returned unchanged when nothing differs.
    expect(authHandler).toMatch(/prev\.uid === firebaseUser\.uid/);
    expect(authHandler).toMatch(/prev\.email === email/);
    expect(authHandler).toMatch(/prev\.displayName === displayName/);
    expect(authHandler).toMatch(/prev\.role === role/);
    expect(authHandler).toMatch(/\? prev\b/);
  });

  it("the payments ledger listener depends on the stable staff UID", () => {
    expect(paymentsListener).not.toBe("");
    expect(paymentsListener).toMatch(/currentUser\?\.uid/);
    // It must NOT depend on the `currentUser` object identity.
    expect(paymentsListener).not.toMatch(/\}, \[currentUser\]\);/);
  });

  it("the refunds ledger listener depends on the stable staff UID", () => {
    expect(refundsListener).not.toBe("");
    expect(refundsListener).toMatch(/currentUser\?\.uid/);
    expect(refundsListener).not.toMatch(/\}, \[currentUser\]\);/);
  });

  it("both ledger listeners hydrate through a one-shot `getDocs` read", () => {
    // A one-shot read cannot be starved by re-subscription timing, which
    // is exactly what emptied the index in production.
    expect(adminContextSrc).toMatch(
      /getDocs\(collectionGroup\(db, "payments"\)\)/
    );
    expect(adminContextSrc).toMatch(
      /getDocs\(collectionGroup\(db, "refunds"\)\)/
    );
  });

  it("both ledger listeners attach with a force-refreshed staff token", () => {
    // Same handshake the reservations listener uses (MRB-12): the attach
    // must carry the staff `role` custom claim.
    expect(paymentsListener).toMatch(/getIdToken\(true\)/);
    expect(refundsListener).toMatch(/getIdToken\(true\)/);
  });

  it("the drawer keeps its stable primitive dependency (the surface that always worked)", () => {
    const bookingsPageSrc = readFileSync(
      resolve(__dirname, "../../src/pages/BookingsPage.tsx"),
      "utf8"
    );
    expect(bookingsPageSrc).toMatch(/selectedBooking\?\.id/);
  });
});
