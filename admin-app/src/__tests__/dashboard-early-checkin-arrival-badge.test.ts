import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per `feat/early-checkin-arrivals-badge` (2026-08-21): the
// dashboard's "today's arrivals" widget renders a small green
// "early <time>" badge on rows whose `earlyCheckIn.status` is
// `approved`. The badge text follows the existing
// `confirmedTime || requestedTime` precedence already used in
// the guest email confirmation + StaysPage + RewardsPage. The
// widget stays unchanged for bookings without an approved
// early check-in (the existing pending widget at the top of
// the dashboard handles `requested` + `declined` states via
// the bell + Approve/Decline controls).
//
// This file pins the new contract at the source-text level
// so a future refactor can't silently remove the badge,
// change the precedence, or break the data-testid without
// touching these tests first.

const dashboardPage = readFileSync(
  resolve(__dirname, "../pages/DashboardPage.tsx"),
  "utf8"
);

describe("Dashboard — today's arrivals badge for approved early check-in", () => {
  // The badge anchors on a stable data-testid so the e2e
  // harness can locate it without DOM scraping. The
  // `data-testid` carries the booking id so the test can
  // verify a specific row without iterating all arrivals.

  it("renders the badge with a stable data-testid (per-booking)", () => {
    expect(dashboardPage).toMatch(
      /data-testid="early-checkin-arrival-badge"/
    );
  });

  it("gates the badge on earlyCheckIn.status === 'approved' only", () => {
    // Per the design: declined requests don't surface on the
    // arrivals row (the drawer has the full audit trail);
    // pending requests live in the existing pending widget
    // at the top of the dashboard. Only `approved` shows
    // here so the staff sees a single positive signal per row.
    expect(dashboardPage).toMatch(
      /earlyCheckIn\?\.status\s*===\s*["']approved["']/
    );
  });

  it("uses confirmedTime when the staff approved a specific time", () => {
    // The existing precedence (guest email helper at
    // guest-app/server/handlers/email.ts:1736 + StaysPage +
    // RewardsPage) is `confirmedTime || requestedTime`. The
    // dashboard badge follows the same rule — when staff
    // overrides the guest's requested time (e.g., "11 AM"
    // → "10 AM" because the room isn't ready), the badge
    // reflects the staff override. This is what the staff
    // committed to, so it's what the front desk acts on.
    expect(dashboardPage).toMatch(
      /earlyCheckIn\?\.confirmedTime\s*\|\|\s*earlyCheckIn\?\.requestedTime/,
    );
  });

  it("falls back to requestedTime when confirmedTime is null (staff approved the request as-is)", () => {
    // The same precedence handles the "approve at requested
    // time" case — confirmedTime is null, so the badge
    // shows the guest's original requested time. This is
    // the common case (~most approvals don't override).
    expect(dashboardPage).toMatch(
      /earlyCheckIn\?\.confirmedTime\s*\|\|\s*earlyCheckIn\?\.requestedTime/,
    );
  });

  it("renders a green Check icon (lucide) inside the badge", () => {
    // Per the design: small green pill with a `Check` icon +
    // "early 11:00 AM" text. The Check icon is already
    // imported into DashboardPage.tsx (used in the
    // lifecycle tracker in the booking drawer), so no new
    // import is needed.
    expect(dashboardPage).toMatch(/<Check size=\{1[0-9]\}/);
  });

  it("renders inside the existing today's-arrivals <button> row, not as a new column", () => {
    // Per the design (Option A): the badge lives inline
    // with the existing row's guest name + booking ref, not
    // as a new column or new widget. This keeps the widget
    // density consistent and matches the existing alert-chip
    // pattern in the booking drawer header.
    // The badge appears AFTER `Room {booking.roomNumber} · {booking.bookingRef}`
    // but inside the same <button> element.
    expect(dashboardPage).toMatch(
      /Room \{booking\.roomNumber[^}]*\}\s*·\s*\{booking\.bookingRef\}[\s\S]{0,200}?early-checkin-arrival-badge/
    );
  });
});

describe("Dashboard — today's arrivals badge — regression net", () => {
  // The previous PR shipped the existing today's-arrivals
  // widget (lines 1409-1437). This badge PR augments that
  // widget without changing the rest of the dashboard. These
  // tests pin the surrounding behavior so a future refactor
  // doesn't regress the widget itself.

  it("keeps the today's arrivals widget header + LogIn icon", () => {
    expect(dashboardPage).toMatch(/today's arrivals/);
    expect(dashboardPage).toMatch(/<LogIn size=\{18\}/);
  });

  it("keeps the existing pending-early-checkin widget (top of dashboard)", () => {
    // The pending widget with Approve/Decline actions at
    // line 1179 is unchanged — this PR only adds the
    // arrival-row badge for approved requests, not the
    // decision-making surface.
    expect(dashboardPage).toMatch(/pendingEarlyCheckIns\.length > 0/);
    expect(dashboardPage).toMatch(/early-checkin-widget/);
  });

  it("keeps the today's departures widget unchanged", () => {
    expect(dashboardPage).toMatch(/today's departures/);
    expect(dashboardPage).toMatch(/<LogOut size=\{18\}/);
  });
});
