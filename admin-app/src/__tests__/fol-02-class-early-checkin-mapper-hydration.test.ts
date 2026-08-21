// Per EC-01 + FOL-02-class regression (operator-reported 2026-08-21):
// the admin `bookings` snapshot mapper silently drops the
// `earlyCheckIn` field. The mapper at
// `AdminContext.tsx:1482+` explicitly lists every field it
// reads from `docSnap.data()`; a field not in the list reads
// as `undefined` on the mapped `Booking`. The dashboard
// widget at `DashboardPage.tsx` keys its list filter on
// `b.earlyCheckIn?.status === "requested"` — so when the
// mapper drops the field, the widget never renders even
// though the bell + the `notifications` doc both work
// (the server write goes through a different surface).
//
// This is the same shape of bug as FOL-02 (decision #198,
// `fol-02-admin-bookings-mapper-missing-fields.test.ts`):
// the type declares the field, the mapper forgets to read
// it from the snapshot. The fix is one defensive-coercion
// line in the mapper + the regression pin below.
//
// Source-text pin (cheap, deterministic, runs in <5s per
// `plan/docs/CONTRIBUTING.md §Testing`). The behavioural
// test (snapshot → hydrated booking → widget filter matches)
// would need a Firestore emulator harness and is overkill
// for this surface; the source-text pin + the live
// dashboard test (you just exercised) are sufficient
// contract enforcement.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

const dashboardSrc = readFileSync(
  resolve(__dirname, "../pages/DashboardPage.tsx"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

// Slice the bookings hydration `useEffect` so the pin only
// targets the mapper (the rest of `AdminContext.tsx` is 7000+
// lines and unrelated fields would bleed into the match).
// Mirrors the FOL-02 test's slicing shape.
const hydrationEffectStart = adminContextSrc.indexOf(
  "    let active = true;\n    setBookingsLoading(true);\n    const bookingsRef = collection(db, \"bookings\");"
);
const hydrationEffectEnd = adminContextSrc.indexOf(
  "        if (!active) return;\n\n        // Natural sort by createdAt descending"
);
const hydrationEffect =
  hydrationEffectStart >= 0 && hydrationEffectEnd > hydrationEffectStart
    ? adminContextSrc.slice(hydrationEffectStart, hydrationEffectEnd)
    : "";

describe("EC-01 — admin bookings mapper hydrates the earlyCheckIn field", () => {
  it("the bookings hydration useEffect is present and locatable", () => {
    expect(hydrationEffect.length).toBeGreaterThan(0);
    expect(hydrationEffect).toMatch(/bookingsData\.push\(\{/);
  });

  it("the mapper reads `data.earlyCheckIn` so the dashboard widget filter can match", () => {
    // The fix: a defensive `earlyCheckIn: data.earlyCheckIn ?? null`
    // line at the end of the mapper (mirrors the BSP-01
    // `breakfastServed` hydration pattern at the same site).
    // Without this line the field reads as `undefined` and the
    // widget's `b.earlyCheckIn?.status === "requested"` filter
    // is always false → widget hidden even when bell fires.
    expect(hydrationEffect).toMatch(/earlyCheckIn\s*:\s*data\.earlyCheckIn/);
  });

  it("the dashboard widget filter is keyed on the hydrated field, not a server-side fetch", () => {
    // The widget derives its list from the existing bookings
    // snapshot (no second Firestore listener). The filter
    // MUST read `earlyCheckIn?.status === "requested"` so it
    // matches whatever the mapper hydrates.
    expect(dashboardSrc).toMatch(/earlyCheckIn\?\.status\s*===\s*["']requested["']/);
  });

  it("the Booking type declares the earlyCheckIn contract with all 7 fields", () => {
    // The type lives in `AdminContext.tsx` (admin-side extension
    // of the shared `Booking`). All 7 server-written fields must
    // be declared so the mapper hydration has a target.
    // Per the `guest-app/server/handlers/email.ts:2338-2346`
    // early-checkin-request handler, the server writes:
    //   status, requestedTime, notes, requestedAt, resolvedAt,
    //   resolvedBy, staffNote
    expect(adminContextSrc).toMatch(/earlyCheckIn\?:\s*\{/);
    expect(adminContextSrc).toMatch(/status:\s*["']requested["']\s*\|\s*["']approved["']\s*\|\s*["']declined["']/);
    expect(adminContextSrc).toMatch(/requestedTime:\s*string/);
    expect(adminContextSrc).toMatch(/notes:\s*string/);
    expect(adminContextSrc).toMatch(/requestedAt:\s*string/);
    expect(adminContextSrc).toMatch(/resolvedAt:\s*string\s*\|\s*null/);
    expect(adminContextSrc).toMatch(/resolvedBy:\s*string\s*\|\s*null/);
    expect(adminContextSrc).toMatch(/staffNote:\s*string\s*\|\s*null/);
  });

  it("the dashboard widget never reads the field from a separate listener", () => {
    // Anti-regression: a future refactor that adds a second
    // `onSnapshot` for early check-ins would double the read
    // cost AND drift from the canonical booking state. Pin
    // that the widget derives from the existing `bookings`
    // prop only.
    expect(dashboardSrc).toMatch(/pendingEarlyCheckIns\s*=\s*useMemo/);
    // Confirm the memo's filter uses the bookings prop.
    const memoMatch = dashboardSrc.match(
      /pendingEarlyCheckIns\s*=\s*useMemo\([\s\S]{0,500}?return\s*bookings/
    );
    expect(memoMatch, "pendingEarlyCheckIns memo must derive from bookings").toBeTruthy();
  });
});

describe("EC-01 — wire-path regression sanity (downstream effect)", () => {
  it("the shared NotificationType union already includes early-checkin-request (already shipped)", () => {
    // Sanity: this isn't a regression on the union — the bell
    // works (operator confirmed), so the union is fine. The
    // bug is purely on the bookings mapper.
    expect(sharedTypesSrc).toMatch(/["']early-checkin-request["']/);
  });
});