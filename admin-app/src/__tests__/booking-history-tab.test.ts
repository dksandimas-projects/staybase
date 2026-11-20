// ATR-08 follow-up (2026-11-21, `plan/features/AUDIT-TRAIL.md`): the
// booking drawer's HISTORY tab.
//
// WHY THIS FILE EXISTS
// --------------------
// The admin app has NO component-test harness (no
// @testing-library/react), so this file pins the HISTORY tab's
// STRUCTURE at the source level — the same discipline the rest of the
// admin suite uses.
//
// The behavioural rules (which action maps to which sentence, how an
// undated row sorts, who an actor renders as) live in
// `shared/utils/bookingHistory.ts` and are unit-tested for real in
// `shared/__tests__/booking-history.test.ts`. THIS file pins the
// things only the source can show:
//
//   1. the drawer registers a `history` section;
//   2. the nav does not fall back to a fixed-column grid that would
//      wrap or clip seven tabs;
//   3. the page renders the panel in the RIGHT place;
//   4. the hook detaches BOTH listeners (a leaked listener is a
//      duplicate-update bug — GOTCHAS §Firebase);
//   5. the hook force-refreshes the staff token before attaching and
//      CATCHES the rejection (MRB-15-09 / RPT-01b);
//   6. the hook does not attach until the section is active;
//   7. the actor resolves through the ONE shared resolver — a raw uid
//      must never reach the screen;
//   8. the charge ledger is REUSED, not listened to a second time;
//   9. the loading state is a skeleton, not a spinner.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (relative: string) =>
  readFileSync(resolve(repoRoot, relative), "utf8");

const workspaceSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const historySrc = read("admin-app/src/components/BookingHistoryTab.tsx");
const hookSrc = read("admin-app/src/hooks/useBookingHistory.ts");
const sharedSrc = read("shared/utils/bookingHistory.ts");

describe("booking history tab — the drawer section", () => {
  it("registers a `history` section with the History icon", () => {
    expect(workspaceSrc).toMatch(
      /\{\s*id:\s*["']history["'],\s*desktopLabel:\s*["']History["'],\s*mobileLabel:\s*["']History["']/
    );
    expect(workspaceSrc).toMatch(/import\s*\{[^}]*\bHistory\b[^}]*\}\s*from\s*["']lucide-react["']/);
  });

  it("includes `history` in the section type", () => {
    expect(workspaceSrc).toMatch(/export type BookingDrawerSection\s*=/);
    expect(workspaceSrc).toMatch(/["']history["']/);
  });

  it("does not fall back to a fixed-column grid that would wrap seven tabs", () => {
    // The previous `grid-cols-5` already wrapped its sixth tab onto a
    // second row; with seven sections it would also force the longest
    // label ("Breakfast") to overflow its cell. The tab row is now a
    // content-width scrolling row.
    expect(workspaceSrc).not.toMatch(/grid min-w-\[420px\] grid-cols-5/);
    expect(workspaceSrc).toMatch(/className="flex min-w-max gap-1" role="tablist"/);
    // The tabs still keep their 44px touch target and never shrink.
    expect(workspaceSrc).toMatch(/min-h-\[44px\] shrink-0/);
  });

  it("keeps the accessible tab wiring the drawer already had", () => {
    expect(workspaceSrc).toMatch(/role="tablist"/);
    expect(workspaceSrc).toMatch(/role="tab"/);
    expect(workspaceSrc).toMatch(/aria-selected=\{active\}/);
    expect(workspaceSrc).toMatch(/aria-controls=\{`booking-drawer-panel-\$\{id\}`\}/);
  });
});

describe("booking history tab — the page wiring", () => {
  it("renders the history panel inside the drawer's section panel", () => {
    expect(pageSrc).toMatch(
      /<BookingDrawerSectionPanel section="history" activeSection=\{activeBookingSection\}>/
    );
    expect(pageSrc).toMatch(/<BookingHistoryTab/);
    expect(pageSrc).toMatch(
      /import \{ BookingHistoryTab \} from "\.\.\/components\/BookingHistoryTab"/
    );
  });

  it("passes the ALREADY-LOADED charges instead of listening to them again", () => {
    // The drawer's charge listener is RESERVATION-scoped (it reads
    // `reservations/{id}/charges` plus every child's charges). A
    // second copy of that resolution is the drift this repo keeps
    // paying for.
    expect(pageSrc).toMatch(/charges=\{selectedBookingCharges\}/);
    expect(hookSrc).not.toMatch(/"charges"/);
  });

  it("only reads the trails while the history section is the active one", () => {
    // The drawer mounts EVERY section panel at once (the panels are
    // hidden with CSS, not unmounted), so an always-on subscription
    // would attach for every staff member who opens a booking.
    expect(pageSrc).toMatch(/active=\{activeBookingSection === "history"\}/);
    expect(hookSrc).toMatch(/if \(!bookingId \|\| !enabled\)/);
    expect(hookSrc).toMatch(/\}, \[bookingId, enabled\]\);/);
  });
});

describe("booking history tab — the hook", () => {
  it("reads both server-written trails", () => {
    expect(hookSrc).toMatch(/collection\(db, "bookings", bookingId, "breakfastAudit"\)/);
    expect(hookSrc).toMatch(/collection\(db, "bookings", bookingId, "otherAddOnAudit"\)/);
  });

  it("detaches BOTH listeners on cleanup", () => {
    // A leaked listener is a duplicate-update bug and a leak (GOTCHAS
    // §Firebase: always unsubscribe in the useEffect cleanup).
    expect(hookSrc).toMatch(/unsubscribeBreakfast\?\.\(\);/);
    expect(hookSrc).toMatch(/unsubscribeAddOn\?\.\(\);/);
    expect(hookSrc).toMatch(/cancelled = true;/);
  });

  it("force-refreshes the staff token before attaching, and catches the rejection", () => {
    // MRB-15-09: a listener attached with a stale token is
    // PERMISSION_DENIED with no useful error. RPT-01b: an unhandled
    // rejection is NOT a console.error, so the surface would silently
    // render empty — the `.catch()` is what makes it visible.
    expect(hookSrc).toMatch(/getIdToken\(true\)/);
    expect(hookSrc).toMatch(/\.catch\(\(refreshError\) => \{/);
    expect(hookSrc).toMatch(/if \(cancelled\) return;/);
  });

  it("surfaces a listener failure instead of rendering an empty trail", () => {
    expect(hookSrc).toMatch(/\(err\) => \{/);
    expect(hookSrc).toMatch(/setError\(/);
  });
});

describe("booking history tab — the component", () => {
  it("resolves the actor through the ONE shared resolver", () => {
    // A raw 28-character uid on a staff-facing surface tells a
    // front-desk user nothing (GOTCHAS §Security & PII).
    expect(historySrc).toMatch(/buildStaffNameMap/);
    expect(historySrc).toMatch(/bookingHistoryActorLabel/);
    // Every uid the component touches goes through the MAP — the
    // discount verifier included. A uid read straight off the booking
    // would render the raw 28 characters.
    expect(historySrc).toMatch(/staffNameMap\.get\(booking\.discountVerifiedBy\)/);
    expect(historySrc).not.toMatch(/booking\.(discountVerifiedBy|handledBy|createdBy)\b\s*\}/);
  });

  it("merges the four sources through the shared helpers", () => {
    expect(historySrc).toMatch(/mergeBookingHistoryEvents\(/);
    expect(historySrc).toMatch(/bookingMilestoneEvents\(/);
    expect(historySrc).toMatch(/incidentalChargeEvent\(/);
    expect(historySrc).toMatch(/useBookingHistory\(/);
  });

  it("renders a skeleton, never a spinner", () => {
    expect(historySrc).toMatch(/data-testid="booking-history-skeleton"/);
    expect(historySrc).toMatch(/animate-pulse/);
    expect(historySrc).not.toMatch(/animate-spin/);
  });

  it("explains an empty trail instead of showing a bare 'no results'", () => {
    expect(historySrc).toMatch(/data-testid="booking-history-empty"/);
    expect(historySrc).toMatch(/Nothing recorded yet/);
  });

  it("does not claim to be the complete audit trail", () => {
    // ATR-02 (the forensic server writers on every booking mutation)
    // is still open. The tab must not imply a completeness it does
    // not have.
    expect(historySrc).toMatch(/ATR-02/);
  });
});

describe("booking history tab — the shared module", () => {
  it("keeps the event model and the merge in the shared package", () => {
    expect(sharedSrc).toMatch(/export function mergeBookingHistoryEvents\(/);
    expect(sharedSrc).toMatch(/export function bookingHistoryActorLabel\(/);
    expect(sharedSrc).toMatch(/export function bookingMilestoneEvents\(/);
    // The shared package is the only place these rules are
    // unit-tested for real — the admin app cannot render a component
    // in a test.
    expect(
      read("shared/__tests__/booking-history.test.ts")
    ).toMatch(/mergeBookingHistoryEvents/);
  });

  it("never renders a raw uid as an actor label", () => {
    expect(sharedSrc).toMatch(/export function bookingHistoryActorLabel\(/);
    // The fallback is a caller-supplied LABEL, never the uid.
    expect(sharedSrc).toMatch(/fallback = "Staff"/);
  });

  it("keeps the RENDER test — it is the only proof the tab renders", () => {
    // The admin app's suite is source-text only, so without this
    // file NOTHING would prove that the component renders the right
    // thing — only that its source mentions the right words. The
    // render test uses `react-dom/server` (already a dependency; the
    // admin app's `vite.config.ts` already carries the `@config`
    // alias and the React JSX transform, so no new config is needed).
    const renderTest = read(
      "admin-app/src/__tests__/booking-history-render.test.tsx"
    );
    expect(renderTest).toMatch(/renderToStaticMarkup/);
    expect(renderTest).toMatch(/not\.toContain\("uid-juan"\)/);
  });
});
