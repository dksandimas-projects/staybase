// Per BR-07 (Phase 13 — Breakfast Redesign, decision
// #236, 2026-10-13): tripwire tests that anchor the
// kitchen list page's two-column layout, the Acknowledge
// button per late change, the Today/Tomorrow tab toggle,
// the Print button route, the AdminLayout route
// registration, and the sidebar nav entry.
//
// Source-text tripwires (mirrors the BR-05 admin-app
// pattern in `br-05-staff-breakfast-drawer.test.ts`):
// each `it` reads one or two files + asserts the page
// has the expected literal strings. No Firebase mock —
// the page's behavior is provable from source alone for
// this tier (rendering correctness is the smoke-test's
// job, which lives in `br-07-kitchen-list-routes.test.ts`
// on the guest-app side).

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const PAGE_PATH = path.resolve(__dirname, "../pages/KitchenListPage.tsx");
const APP_PATH = path.resolve(__dirname, "../App.tsx");
const SIDEBAR_PATH = path.resolve(
  __dirname,
  "../components/Sidebar.tsx"
);

function readFileSafe(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("BR-07 — Kitchen list page (admin-app)", () => {
  it("1. KitchenListPage.tsx exists and exports a default page component", () => {
    const source = readFileSafe(PAGE_PATH);
    // Default export — the App.tsx route mounts
    // `<KitchenListPage />` via the default export.
    expect(source).toMatch(/export\s+default\s+function\s+KitchenListPage\b/);
    // The named print-page export is required so
    // `App.tsx` can mount it via
    // `import { KitchenListPrintPage }`.
    expect(source).toMatch(
      /export\s+function\s+KitchenListPrintPage\b/
    );
  });

  it("2. The page reads the date from the query string (or defaults to tomorrow)", () => {
    const source = readFileSafe(PAGE_PATH);
    // Query-string read is via `useSearchParams` (the
    // canonical admin-side date picker pattern). The
    // default falls back to `tomorrow` via the shared
    // hotel-timezone helper `tomorrowDateKey()`.
    expect(source).toMatch(/useSearchParams\s*\(\s*\)/);
    expect(source).toMatch(/searchParams\.get\(\s*["']date["']\s*\)/);
    expect(source).toMatch(/tomorrowDateKey\s*\(\s*\)/);
    // The hotel timezone drives the default — using
    // `config.timezone` (not `Date.now()` UTC math).
    expect(source).toMatch(/config\.timezone|HOTEL_TIMEZONE/);
  });

  it("3. The page renders the 'Finalized at 8 PM' column header", () => {
    const source = readFileSafe(PAGE_PATH);
    expect(source).toContain("Finalized at 8 PM");
  });

  it("4. The page renders the 'Late changes' column header", () => {
    const source = readFileSafe(PAGE_PATH);
    expect(source).toContain("Late changes");
  });

  it("5. The page has a Print button that routes to /admin/kitchen-list/print?date=...", () => {
    const source = readFileSafe(PAGE_PATH);
    // The print href is built in `KitchenListHeader`
    // and pushed into the location via a `<Link to=>`
    // element with the `Print` icon.
    expect(source).toMatch(/to=\{?printHref\}?/);
    expect(source).toMatch(/\/kitchen-list\/print\?date=/);
    // The header also imports `Printer` from lucide
    // and uses it on the link's button.
    expect(source).toMatch(/Printer/);
  });

  it("6. The page has an Acknowledge button per late-change entry", () => {
    const source = readFileSafe(PAGE_PATH);
    // The button is rendered by `LateChangeRow` and
    // calls the `onAcknowledge` callback (which POSTs
    // to `/api/bookings/breakfast/kitchen-list/acknowledge`).
    expect(source).toMatch(/>\s*Acknowledge\s*</);
    // The page wires `handleAcknowledge` (which calls
    // `acknowledgeAuditEntry`) — single source of truth
    // for the POST.
    expect(source).toMatch(/acknowledgeAuditEntry/);
    expect(source).toMatch(
      /\/api\/bookings\/breakfast\/kitchen-list\/acknowledge/
    );
  });

  it("7. The page has a 'Today' / 'Tomorrow's prep' tab toggle", () => {
    const source = readFileSafe(PAGE_PATH);
    expect(source).toContain("Today");
    expect(source).toContain("Tomorrow's prep");
    // The tab buttons carry `role="tab"` and an
    // `aria-selected` flag for a11y.
    expect(source).toMatch(/role\s*=\s*["']tab["']/);
    expect(source).toMatch(/aria-selected/);
  });

  it("8. The App.tsx router registers a /kitchen-list route", () => {
    const source = readFileSafe(APP_PATH);
    // The route registration is a sibling of `/reports`
    // + `/bookings`. The path string in `App.tsx` is
    // `/kitchen-list` (the admin app is mounted at the
    // admin subdomain, so the path has no `/admin/`
    // prefix).
    expect(source).toMatch(/<Route\s+path="\/kitchen-list"/);
    expect(source).toMatch(/element=\{<KitchenListPage\s*\/>\}/);
  });

  it("9. The App.tsx router registers a /kitchen-list/print route", () => {
    const source = readFileSafe(APP_PATH);
    // The print route is OUTSIDE the AdminLayout (no
    // chrome when printing) — a single bare `<Route>`.
    expect(source).toMatch(/<Route\s+path="\/kitchen-list\/print"/);
    expect(source).toMatch(/element=\{<KitchenListPrintPage\s*\/>\}/);
  });

  it("10. The admin sidebar renders a 'Kitchen List' link", () => {
    const source = readFileSafe(SIDEBAR_PATH);
    // The nav array carries `{ label: "Kitchen List", to: "/kitchen-list", ... }`.
    expect(source).toContain('label: "Kitchen List"');
    expect(source).toContain('to: "/kitchen-list"');
    // Lucide icon import for the nav row.
    expect(source).toMatch(/ChefHat/);
  });

  it("11. The page uses the existing useToast / useAdmin patterns (no new providers)", () => {
    const source = readFileSafe(PAGE_PATH);
    expect(source).toMatch(/import\s*\{\s*useAdmin\s*\}\s*from\s*["']\.\.\/context\/AdminContext["']/);
    expect(source).toMatch(/import\s*\{\s*useToast\s*\}\s*from\s*["']\.\.\/components\/Toast["']/);
  });

  it("12. The page refreshes the late-change column on window focus", () => {
    const source = readFileSafe(PAGE_PATH);
    // Per spec: ack signals should feel responsive without
    // a full page reload — the focus listener covers the
    // common case (kitchen walks back to the desk and the
    // colleague's ack should be visible immediately).
    expect(source).toMatch(/window\.addEventListener\(\s*["']focus["']/);
    expect(source).toMatch(/window\.removeEventListener\(\s*["']focus["']/);
  });
});
