// RPT-04 (2026-08-10): restrict the Reports page so front-desk
// staff only see the Daily Close tab.
//
// Context: before this change, /reports rendered four tabs —
// Performance, Sales, Daily Close, and Liability — for both
// staff roles, even though (a) the data those three tabs
// surface (occupancy KPIs, full finance PII including VAT and
// corporate receivables, cancellation-liability queue) is
// managerial / financial and not part of front-desk's daily
// workflow, and (b) the in-page actions those tabs lead to
// (refunds, points redemption, full backup export) are
// already admin-only. The split was: admin could *act* on
// refunds but front-desk could *see* the queue. This PR
// collapses the view to match the action surface — front desk
// keeps Daily Close (the end-of-shift reconciliation they
// own) and the page header CSV export, nothing else.
//
// All tripwires here are source-text guards so the role gate
// can't quietly regress on a future refactor.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const authRoles = readFileSync(
  resolve(__dirname, "../../../plan/features/AUTH-ROLES.md"),
  "utf8"
);

describe("RPT-04 front-desk Reports page is restricted to Daily Close", () => {
  it("default activeTab is Daily Close for non-admin staff", () => {
    // The useState initializer must branch on role. Pin the
    // exact shape so a future refactor that flattens the
    // initializer (e.g. back to a constant) breaks the test.
    const initializer = reports.match(
      /useState<ReportTab>\(\s*[\s\S]*?\)\s*;/
    );
    expect(initializer, "expected useState<ReportTab>(...) initializer").toBeTruthy();
    expect(initializer![0]).toMatch(/currentUser\?\.role\s*===\s*["']admin["']/);
    expect(initializer![0]).toMatch(/:\s*["']daily-close["']/);
  });

  it("Performance tab button is gated on role === admin", () => {
    // The Performance <button> sits inside a role guard.
    // Find a JSX fragment that opens with
    // `currentUser?.role === "admin" && (` and contains the
    // Performance tab text before the matching `)}`.
    const guard = reports.match(
      /\{currentUser\?\.role\s*===\s*["']admin["']\s*&&\s*\(\s*[\s\S]*?Performance[\s\S]*?\)\s*\}/
    );
    expect(guard, "Performance tab button should be wrapped in an admin-role guard").toBeTruthy();
  });

  it("Sales tab button is gated on role === admin", () => {
    const guard = reports.match(
      /\{currentUser\?\.role\s*===\s*["']admin["']\s*&&\s*\(\s*[\s\S]*?[\s\S]*?Sales[\s\S]*?\)\s*\}/
    );
    expect(guard, "Sales tab button should be wrapped in an admin-role guard").toBeTruthy();
  });

  it("Liability tab button is gated on role === admin", () => {
    // The Liability button keeps its `data-testid="report-tab-liability"`
    // attribute — the existing RPT-03 test relies on that selector.
    const guard = reports.match(
      /\{currentUser\?\.role\s*===\s*["']admin["']\s*&&\s*\(\s*[\s\S]*?Liability[\s\S]*?data-testid=["']report-tab-liability["'][\s\S]*?\)\s*\}/
    );
    expect(guard, "Liability tab button should be wrapped in an admin-role guard").toBeTruthy();
  });

  it("Daily Close tab button is NOT wrapped in a role guard", () => {
    // The Daily Close button must render for both roles —
    // it's the only tab front-desk can see. Find the button
    // by its `aria-selected` reference to the daily-close
    // tab key, then walk backwards 300 chars and confirm
    // the nearest preceding role guard does NOT enclose it.
    const ariaIdx = reports.indexOf('aria-selected={activeTab === "daily-close"}');
    expect(ariaIdx, "expected the Daily Close tab button aria-selected").toBeGreaterThanOrEqual(0);
    const slice = reports.slice(Math.max(0, ariaIdx - 600), ariaIdx);
    // The opening `&& (` of an admin role guard, if it
    // existed right before this button, would still be open
    // (no matching `)}` between it and the button). The
    // three admin-only buttons come *before* the Daily Close
    // button in source order, so any guard for them must be
    // closed by the time we reach the Daily Close button.
    // Look for an unclosed guard right before the button.
    expect(slice, "Daily Close button must not be inside an admin-only role guard").not.toMatch(
      /\{currentUser\?\.role\s*===\s*["']admin["']\s*&&\s*\(\s*$/
    );
  });

  it("AUTH-ROLES.md documents the Reports → Daily Close split", () => {
    // The spec lists "Reports" as a front-desk page, but
    // the row must call out the Daily Close qualifier so a
    // doc-only drift back to "Reports (all tabs)" breaks
    // this test. Pin the exact qualifier phrasing.
    expect(authRoles).toMatch(/Reports \(Daily Close tab only/);
    // The admin row must still call out the additional
    // admin-only Reports tabs explicitly.
    expect(authRoles).toMatch(/Performance \/ Sales \/ Liability tabs on Reports/);
  });
});
