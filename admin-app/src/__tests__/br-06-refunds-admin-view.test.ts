// Per BR-06 (Phase 13 — Breakfast Redesign, decision
// #235, 2026-10-13): source-text tripwires for the
// admin Refunds admin-view surface extensions. The
// test shape mirrors BR-05's `br-05-staff-breakfast-drawer.test.ts`
// pattern — static string checks so the admin UI
// contract cannot regress without a test failure.
//
// Covered:
//   1. The Refunds admin view (in BookingDrawerWorkspace.tsx)
//      has a category filter chip with the three options
//      from the BR-06 spec: "All" / "Cancellation" /
//      "Breakfast". The default key matches the spec
//      ("all" — back-compat with the pre-BR-06 view).
//   2. The view shows a "Breakfast" badge on
//      breakfast-category rows. A matching "Cancellation"
//      badge handles the legacy `null` category fallback
//      (BR-01 §OnsitePayment extension contract).
//   3. The view has a [Mark as paid] button on
//      breakfast-category `status: "pending"` rows + an
//      advanced modal that posts to the new
//      `/api/refunds/mark-paid` endpoint (via the unified
//      `markRefundPaid` helper).
//   4. The dashboard pending-refunds counter reads both
//      cancellation AND breakfast categories.
//   5. The Reports → Liability tab has a "Breakfast
//      refunds pending" line.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readSource(relativePath: string): string {
  const fullPath = path.resolve(REPO_ROOT, relativePath);
  return fs.readFileSync(fullPath, "utf8");
}

describe("BR-06 — Refunds admin view (source-text tripwires)", () => {
  // 1. Category filter chip — "All" / "Cancellation" /
  //    "Breakfast" options.
  it("BookingDrawerWorkspace has a category filter chip with All / Cancellation / Breakfast options", () => {
    const source = readSource(
      "admin-app/src/components/BookingDrawerWorkspace.tsx"
    );
    expect(source).toContain("REFUND_CATEGORY_OPTIONS");
    // The three options from the BR-06 spec.
    expect(source).toContain('"all"');
    expect(source).toContain('"cancellation"');
    expect(source).toContain('"breakfast"');
    // Display labels match the spec verbatim.
    expect(source).toMatch(/All/);
    expect(source).toMatch(/Cancellation/);
    expect(source).toMatch(/Breakfast/);
    // Default state is "all" — back-compat with the
    // pre-BR-06 view (per the BR-06 spec).
    expect(source).toMatch(/(useState<RefundCategoryFilterKey>\("all"\)|default.*all)/);
    // The filter chip renders a 3-button toggle with
    // aria-pressed accessibility attributes (the spec
    // explicitly calls out the chip is a toggle group).
    expect(source).toContain('role="group"');
    expect(source).toContain("aria-pressed");
    // A testid pin so the BR-07 admin trips can target
    // the chip.
    expect(source).toContain("data-testid=\"refund-category-filter\"");
  });

  // 2. "Breakfast" badge per breakfast row + "Cancellation"
  //    badge for the legacy `null` category.
  it("BookingDrawerWorkspace renders Breakfast + Cancellation badges on refund rows", () => {
    const source = readSource(
      "admin-app/src/components/BookingDrawerWorkspace.tsx"
    );
    // The badge label "Breakfast" appears as a standalone
    // string (the actual rendered badge text).
    expect(source).toMatch(/Breakfast<\/span>|Breakfast\"/);
    // Legacy `null` category reads as Cancellation (BR-01).
    expect(source).toMatch(/isBreakfast\s*\?\s*"Breakfast"\s*:\s*"Cancellation"/);
    // Testid pin so the BR-07 kitchen-list page can
    // locate breakfast rows (template-literal form).
    expect(source).toContain("refund-category-badge-${r.id}");
  });

  // 3. [Mark as paid] button on breakfast pending rows
  //    + the advanced modal that posts to
  //    `/api/refunds/mark-paid`.
  it("BookingDrawerWorkspace has a Mark as paid button on breakfast pending rows + an advanced modal", () => {
    const source = readSource(
      "admin-app/src/components/BookingDrawerWorkspace.tsx"
    );
    // The BR-05 prototype's "Mark as paid" one-click
    // button is preserved (back-compat with the BR-05
    // drawer contract).
    expect(source).toContain("Mark as paid");
    // The new BR-06 advanced modal button + form
    // expose the `mark-refund-paid` testid so the
    // smoke test can find them.
    expect(source).toContain("Mark as paid (advanced)");
    expect(source).toContain("data-testid=\"mark-refund-paid-advanced-form\"");
    expect(source).toContain("data-testid=\"mark-refund-paid-method\"");
    // The form posts to `/api/refunds/mark-paid` (the
    // new BR-06 endpoint).
    expect(source).toContain("/api/refunds/mark-paid");
    // `posted from a fetch helper called postMarkRefundPaid`
    // — the helper's name is preserved for the source-text
    // tripwire pattern.
    expect(source).toContain("postMarkRefundPaid");
  });

  // 4. Dashboard pending-refunds counter reads both
  //    cancellation AND breakfast categories.
  it("DashboardPage has a Pending refunds card that aggregates cancellation + breakfast counts", () => {
    const source = readSource("admin-app/src/pages/DashboardPage.tsx");
    // The new StatsCard label "Pending refunds" (matches
    // the BR-06 spec).
    expect(source).toContain("Pending refunds");
    // The counter aggregates both categories:
    //   - `cancellationPendingRefunds` derived from
    //     `booking.cancellationLiability`.
    //   - `breakfastPendingRefunds` derived from the
    //     collectionGroup("refunds") read.
    expect(source).toContain("cancellationPendingRefunds");
    expect(source).toContain("breakfastPendingRefunds");
    expect(source).toContain("pendingRefundsTotal");
    // The collectionGroup read filters on
    // `category === "breakfast" && status === "pending"`.
    expect(source).toMatch(/category.*breakfast/);
    expect(source).toMatch(/status.*pending/);
    // Testid pin for the BR-07 kitchen-list surface.
    expect(source).toContain("data-testid=\"dashboard-pending-refunds-card\"");
  });

  // 5. Reports → Liability tab has a "Breakfast refunds
  //    pending" line.
  it("LiabilityTab has a Breakfast refunds pending headline metric", () => {
    const source = readSource("admin-app/src/components/LiabilityTab.tsx");
    // The headline label matches the BR-06 spec verbatim.
    expect(source).toContain("Breakfast refunds pending");
    // The count is derived from the same
    // collectionGroup("refunds") read the desk's
    // processedAmount uses (no second listener).
    expect(source).toContain("breakfastPendingCount");
    expect(source).toContain("breakfastPendingAmount");
    expect(source).toContain("breakfastPendingState");
  });
});
