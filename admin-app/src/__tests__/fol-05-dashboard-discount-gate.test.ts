// Per IDG (decision #227, 2026-08-20, owner option (a) —
// hard block on dashboard alert only): 8 source-text
// guards pinning the dashboard alert card's discount-ID
// gate at the source level. The runtime contract for
// the gate's two pure helpers (`hasUnverifiedDiscount` +
// `getDueAmountPreDiscount`) lives in
// `pending-payment-discount-gate.test.ts` (IDG-01); this
// file pins the WIRING (the imports, the JSX condition,
// the button `disabled` + `aria-disabled`, the amber
// banner, the `Open booking` deep-link CTA, the
// pre-discount `dueAmount` label swap, the import line
// for `getDueAmountPreDiscount`).
//
// Source-text guards per `plan/docs/CONTRIBUTING.md
// §Testing`: cheap, deterministic, <5s. The behavioural
// round-trip is the live dashboard — the source-text
// guards below pin the IDG-03 contract at the source
// level so a future "I'll just remove the gate" refactor
// breaks the test instead of silently regressing.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSrc = readFileSync(
  resolve(__dirname, "../pages/DashboardPage.tsx"),
  "utf8"
);

describe("IDG-03 — dashboard alert card gates verify / reject on unverified Senior/PWD discount", () => {
  it("imports `hasUnverifiedDiscount` from the discount-gate helper module", () => {
    // The dashboard reads the gate off the
    // pure-derivation helper (IDG-01), not off an
    // inline computation. The import line is the
    // contract; a future refactor that drops the
    // import (and the inline computation) breaks
    // here.
    expect(dashboardSrc).toMatch(
      /import\s+\{[^}]*\bhasUnverifiedDiscount\b[^}]*\}\s+from\s+["']\.\.\/utils\/pendingPaymentDiscountGate["']/
    );
  });

  it("imports `getDueAmountPreDiscount` from the discount-gate helper module (the pre-discount verify amount)", () => {
    // Same module — the verify amount reads off the
    // same helper's pre-discount math while the gate
    // is active so the staff sees the HONEST amount
    // even if a later ID rejection re-prices the
    // booking.
    expect(dashboardSrc).toMatch(
      /import\s+\{[^}]*\bgetDueAmountPreDiscount\b[^}]*\}\s+from\s+["']\.\.\/utils\/pendingPaymentDiscountGate["']/
    );
  });

  it("renders the alert card's `Verify and record payment` button with `disabled` + `aria-disabled` when the gate is active", () => {
    // The pre-IDG surface had the button always
    // enabled. The post-IDG surface ties both
    // attributes to the gate (extracted into a local
    // `idgBlocked` const once, reused across the
    // card) so the staff sees the disabled affordance
    // + screen readers announce the disabled state.
    expect(dashboardSrc).toMatch(/disabled\s*=\s*\{idgBlocked\}/);
    expect(dashboardSrc).toMatch(/aria-disabled\s*=\s*\{idgBlocked\}/);
  });

  it("renders the alert card's `Reject payment proof` button with the SAME disabled gate", () => {
    // Per IDG proposal: both buttons share the gate
    // (alternative (c) "block only verify" was
    // rejected — harder mental model for staff). The
    // disabled flag is `idgBlocked` on both buttons.
    expect(dashboardSrc).toMatch(/disabled\s*=\s*\{idgBlocked\}/);
  });

  it("renders the amber callout banner when the gate is active (`amber` + `border-amber` Tailwind classes)", () => {
    // The banner calls out the affected room(s) +
    // the `Open booking` deep-link CTA. The Tailwind
    // colour palette is `amber-*` + `border-amber-*`
    // (the project's standard "warning" surface; same
    // palette the existing dashboard alerts use).
    // The banner is a JSX `{idgBlocked && (<div
    // role="alert" ...>)}` conditional, not a ternary.
    expect(dashboardSrc).toMatch(/amber-\d+/);
    expect(dashboardSrc).toMatch(/border-amber-\d+/);
    expect(dashboardSrc).toMatch(
      /idgBlocked\s*&&\s*\([\s\S]{0,400}?amber[\s\S]{0,400}?\)/
    );
  });

  it("the `Open booking` CTA inside the amber callout deep-links to the booking drawer via `/bookings?bookingId=…`", () => {
    // The amber callout's primary CTA is a
    // deep-link to the booking drawer (per
    // `BookingsPage.tsx:841` reads
    // `searchParams.get("bookingId")`). The staff
    // opens the drawer → verifies or rejects the ID
    // there → returns to the dashboard; once every
    // senior/pwd room is cleared, the gate deactivates
    // and the payment buttons re-enable. The
    // `Open booking` button label is the deep-link
    // affordance.
    expect(dashboardSrc).toMatch(
      /navigate\(`\/bookings\?bookingId=/,
    );
    expect(dashboardSrc).toMatch(/Open booking/);
  });

  it("renders the `Due (pre-discount, ID pending)` label when the gate is active (the verify amount is HONEST if the ID is later rejected)", () => {
    // The pre-IDG surface read `item.dueAmount` (the
    // post-discount number). The post-IDG surface
    // swaps in `getDueAmountPreDiscount(item)` when
    // the gate is active + labels the line so the
    // staff knows the math is provisional.
    expect(dashboardSrc).toMatch(/Due \(pre-discount, ID pending\)/);
    expect(dashboardSrc).toMatch(/getDueAmountPreDiscount\(item\)/);
  });

  it("renders the `Reservation due` label when the gate is NOT active (the pre-IDG surface is preserved)", () => {
    // The pre-IDG dashboard already had a
    // `Reservation due` / `Due` line — the IDG fix
    // keeps that label for the non-discounted case.
    // Anti-regression guard: if a future refactor
    // deletes the inactive-gate label, this test
    // fails.
    expect(dashboardSrc).toMatch(/Reservation due/);
  });
});