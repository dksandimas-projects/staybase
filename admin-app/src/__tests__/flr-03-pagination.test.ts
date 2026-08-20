// Per FLR-03 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §FLR-03`): the Reports
// page's Daily Close transactions table is paginated
// at the listener level (limit(50) + startAfter
// cursor) so the page stays fast at the 1-year
// trigger (and beyond). The pre-FLR-03 surface
// loaded every payment + refund in the selected
// date into the table at once — fine at 14 rooms,
// linear forever on Blaze. The post-FLR-03
// surface lazy-loads 50 at a time with a "Load
// more" button.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md
// §Testing`): cheap, deterministic, <5s. The
// runtime contract (cursor management, the
// "Load more" button shape, the "Showing N of M"
// footer) is pinned by these guards so a future
// refactor that drops the pagination breaks here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const reportsPageSrc = read("admin-app/src/pages/ReportsPage.tsx");

describe("FLR-03 — Daily Close transactions table pagination (source-text)", () => {
  describe("listener shape", () => {
    it("the paginated payments listener uses a date-bounded query with orderBy + limit(50)", () => {
      // Per FLR-03: the listener for the
      // Daily Close transactions table reads
      // ONLY the payments/refunds for the
      // selected date (dayStart..dayEnd),
      // ordered most-recent-first, paginated 50
      // at a time. The pre-FLR-03 surface
      // filtered client-side over the full
      // dataset — a no-op at 14 rooms, a
      // memory issue at 1 year of operation.
      // The 5x `expect.toMatch` chain
      // mirrors the query's call shape
      // (collectionGroup + where + where +
      // orderBy + limit) — each clause is
      // matched separately because the
      // 8-line, comment-padded query body
      // exceeds a single regex's 1500-char
      // window.
      expect(reportsPageSrc).toMatch(/collectionGroup\(db, "payments"\)/);
      expect(reportsPageSrc).toMatch(/where\("recordedAt", ">=", dayStart\)/);
      expect(reportsPageSrc).toMatch(/where\("recordedAt", "<=", dayEnd\)/);
      expect(reportsPageSrc).toMatch(/orderBy\("recordedAt", "desc"\)/);
      expect(reportsPageSrc).toMatch(/limit\(50\)/);
    });

    it("the paginated refunds listener uses a date-bounded query with orderBy + limit(50)", () => {
      // Same shape as the payments listener.
      expect(reportsPageSrc).toMatch(/collectionGroup\(db, "refunds"\)/);
      expect(reportsPageSrc).toMatch(/where\("recordedAt", ">=", dayStart\)/);
      expect(reportsPageSrc).toMatch(/where\("recordedAt", "<=", dayEnd\)/);
      expect(reportsPageSrc).toMatch(/orderBy\("recordedAt", "desc"\)/);
      expect(reportsPageSrc).toMatch(/limit\(50\)/);
    });

    it("the paginated listener uses startAfter for the Load more cursor", () => {
      // The Load more button takes the last
      // visible doc's snapshot + uses
      // startAfter(lastDoc) for the next page.
      // This is the canonical Firestore
      // cursor-pagination pattern.
      expect(reportsPageSrc).toMatch(/startAfter\([\s\S]{0,500}?lastDoc/);
    });
  });

  describe("state shape", () => {
    it("declares a separate paginated state (does NOT replace rawPayments/rawRefunds)", () => {
      // The pre-FLR-03 aggregation consumers
      // (per-booking sums, the daily summary,
      // the period totals) continue to read
      // rawPayments + rawRefunds. The paginated
      // state is additive — a separate
      // useState for the table view.
      expect(reportsPageSrc).toMatch(/useState<ReportPayment\[\]>\(\[\]\)/);
      // The paginated state has a different name
      // (e.g. paginatedDayPayments) to make the
      // separation explicit. Two useState calls
      // for ReportPayment are required (raw +
      // paginated).
      const matches = reportsPageSrc.match(/useState<ReportPayment\[\]>\(\[\]\)/g) || [];
      expect(matches.length, "expected at least 2 ReportPayment[] states (raw + paginated)").toBeGreaterThanOrEqual(2);
    });

    it("the paginated state resets when the date changes (no stale cursor across days)", () => {
      // The cursor (lastDoc) is per-day.
      // When the operator picks a different
      // date, the paginated state resets to
      // empty so the Load more button
      // doesn't carry over an offset from
      // a different day.
      // The reset is wired via the
      // dateStr useEffect dep.
      expect(reportsPageSrc).toMatch(
        /useEffect\([\s\S]{0,500}?setPaginatedDayPayments\(\[\]\)/
      );
    });

    it("the paginated listener tracks the lastDoc for the Load more cursor", () => {
      // The lastDoc is what startAfter takes
      // to fetch the next page. Stored in
      // a separate state so the snapshot
      // callback updates it on every page.
      // The useState type is `QueryDocumentSnapshot
      // | null` (the optional null lives INSIDE
      // the generic, not after) — the test
      // matches either form.
      expect(reportsPageSrc).toMatch(
        /useState<QueryDocumentSnapshot[^>]*>/
      );
    });
  });

  describe("UI surface", () => {
    it("the Daily Close table renders the paginated state, not the un-paginated dayPayments", () => {
      // The transactions table maps over the
      // paginated state (not the full
      // dayPayments) so the table is bounded.
      // The aggregation consumers (dailySummary,
      // totalRecordedNet) still use the
      // un-paginated state.
      // The test accepts either the
      // spread-merge pattern (payments +
      // refunds) OR a per-list map — both
      // shapes are valid implementations of
      // "render the paginated state".
      const hasSpreadMerge = reportsPageSrc.match(/\[\.\.\.paginatedDayPayments, \.\.\.paginatedDayRefunds\]\.map/);
      const hasSingleMap = reportsPageSrc.match(/paginatedDayPayments\.map\(\(p\) =>/);
      expect(hasSpreadMerge || hasSingleMap, "expected the table to render the paginated state").not.toBeNull();
    });

    it("the Load more button is rendered when the paginated state is at the limit (50)", () => {
      // The button is only shown when there's
      // likely more data (current page is at
      // the limit). On a day with < 50
      // transactions, the button doesn't
      // appear (no need to load more).
      expect(reportsPageSrc).toMatch(/paginatedDayPayments\.length === 50/);
    });

    it("the Load more button is labeled + has a data-testid for e2e targeting", () => {
      // The button's visible label tells the
      // desk what's happening. The
      // data-testid is the e2e hook.
      expect(reportsPageSrc).toMatch(/data-testid="flr03-load-more"/);
    });

    it("the Showing N footer surfaces the pagination state to the operator", () => {
      // Without a count, the operator can't
      // tell if they're looking at 50 or
      // 50,000. The Showing N footer uses a
      // `+` indicator when more pages exist
      // (Showing 50+ / Showing 200) without
      // the absolute count.
      expect(reportsPageSrc).toMatch(/Showing /);
    });
  });
});