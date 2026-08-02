import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for the 4 small Phase 11.6 Batch 6 fixes — the
// embarrassing-in-staging polish items the audit called out:
//   S1.4 — self-cancel after payment-confirmed or confirmed
//   S6.1 — Google Maps blocked by CSP
//   S5.1 — Dashboard NaN% on first paint (empty rooms)
//   S5.3 — Hardcoded weekly chart
//
// This is a source-pattern test, not a behavioral test. The handler
// and CSP behavioral tests live in the existing test suites; these
// assertions prevent the same regressions from sneaking back in.

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const vercelJson = JSON.parse(
  readFileSync(resolve(__dirname, "../../../vercel.json"), "utf8")
);
const dashboardSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/DashboardPage.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 6 — small polish fixes", () => {
  // Per BF-16 (booking-flow audit 2026-06-26): the cancel
  // block list was relaxed to block only the terminal
  // states (checked-in, checked-out, cancelled).
  // `confirmed` and `payment-confirmed` are now
  // self-cancellable.
  //
  // Per MRB-05 PR #2 (2026-08-02, per decision #159): the
  // block list was relaxed ONE STEP further — `checked-out`
  // is now allowed for staff-initiated cancellation (the
  // post-settlement cancellation path is the loyalty
  // clawback scenario: the booking's `status` flips to
  // `cancelled` and a negative `pointsHistory` entry is
  // recorded against the awarding member). The remaining
  // blocked states are `checked-in` (in-house cancellation
  // is a separate flow) + `cancelled` (idempotent
  // rejection of an already-cancelled booking). The
  // batch-6 tests below were updated to assert the new
  // MRB-05 PR #2 2-state list (was the BF-16 3-state
  // list before PR #2).
  describe("S1.4 — self-cancel block list (BF-16 + MRB-05 PR #2 policy)", () => {
    // NOTE: the regex below anchors on the status literal
    // (`bookingData.status === "checked-in"`) instead of
    // on `if (`. The status literal is unique to the
    // pre-transaction guard (the in-transaction mirror
    // uses `freshBooking.status`), so anchoring on the
    // literal avoids accidentally matching an unrelated
    // `if (...)` block earlier in the file. The MRB-05
    // PR #2 comment block lives between `if (` and the
    // status literal; the regex ignores that gap.
    const guardMatch = bookingsSrc.match(
      /bookingData\.status\s*===\s*["']checked-in["'][\s\S]*?return\s+res\.status\(400\)/
    );

    it("no longer blocks cancellation for payment-confirmed bookings", () => {
      // payment-confirmed must NOT be in the guard.
      expect(guardMatch, "expected to find the cancel status guard").toBeTruthy();
      expect(guardMatch![0]).not.toMatch(/["']payment-confirmed["']/);
    });

    it("no longer blocks cancellation for confirmed bookings", () => {
      expect(guardMatch).toBeTruthy();
      expect(guardMatch![0]).not.toMatch(/["']confirmed["']/);
    });

    it("still blocks cancellation for the two remaining terminal states", () => {
      // Per MRB-05 PR #2: `checked-out` is no longer in
      // the block list (the clawback scenario is the
      // post-settlement cancellation path). The two
      // remaining blocked states are `checked-in` +
      // `cancelled`.
      expect(guardMatch).toBeTruthy();
      expect(guardMatch![0]).toMatch(/["']checked-in["']/);
      expect(guardMatch![0]).toMatch(/["']cancelled["']/);
      // Explicitly assert `checked-out` is NOT in the
      // block — the PR #2 change. The status literal in
      // the actual condition uses double quotes
      // (e.g. `bookingData.status === "checked-out"`),
      // and the comment block uses backticks
      // (`` `checked-out` ``), so a bare
      // /["']checked-out["']/ negation would not false-
      // match the backtick form. (Verified by reading
      // the current code: only double-quoted status
      // literals appear in the actual `if (...)` clause.)
      expect(guardMatch![0]).not.toMatch(/["']checked-out["']/);
    });
  });

  describe("S6.1 — Google Maps allowlisted in CSP frame-src", () => {
    it("frame-src includes https://www.google.com and https://maps.google.com", () => {
      const cspHeader = vercelJson.headers
        .flatMap((block: any) => block.headers)
        .find((h: any) => h.key === "Content-Security-Policy");
      expect(cspHeader, "expected a CSP header").toBeTruthy();
      const csp = cspHeader.value as string;
      const frameSrc = csp
        .split(";")
        .map((d: string) => d.trim())
        .find((d: string) => d.startsWith("frame-src"));
      expect(frameSrc, "expected a frame-src directive").toBeTruthy();
      expect(frameSrc).toMatch(/https:\/\/www\.google\.com/);
      expect(frameSrc).toMatch(/https:\/\/maps\.google\.com/);
      expect(frameSrc).toMatch(/'self'/);
      expect(frameSrc).toMatch(/https:\/\/challenges\.cloudflare\.com/);
    });
  });

  describe("S5.1 — Dashboard NaN% guard", () => {
    it("guards occupancyPercentage when totalRoomsCount is 0", () => {
      // Expect a ternary that explicitly returns 0 when totalRoomsCount
      // is 0, before the Math.round((occupied / total) * 100) call.
      expect(dashboardSrc).toMatch(
        /totalRoomsCount\s*===\s*0\s*\?\s*0\s*:\s*Math\.round\(\s*\(occupiedRoomsCount\s*\/\s*totalRoomsCount\)\s*\*\s*100\s*\)/
      );
    });
  });

  describe("S5.3 — Live weekly occupancy chart", () => {
    it("no longer hardcodes the chart data array of fake rates", () => {
      // The hardcoded block was:
      //   const chartData = [
      //     { day: "Mon", rate: 60 }, ... { day: "Sun", rate: 80 }
      //   ];
      expect(dashboardSrc).not.toMatch(/day:\s*["']Mon["']\s*,\s*rate:\s*60/);
      expect(dashboardSrc).not.toMatch(/day:\s*["']Sun["']\s*,\s*rate:\s*80/);
    });

    it("derives chartData from real bookings (occupancy per day)", () => {
      // The fix iterates the last 7 days and counts distinct rooms
      // occupied via bookings.checkIn / checkOut ranges.
      expect(dashboardSrc).toMatch(/chartData\s*=\s*\(\(\s*\)\s*=>\s*\{/);
      expect(dashboardSrc).toMatch(/for\s*\(\s*let\s+i\s*=\s*6\s*;\s*i\s*>=\s*0\s*;\s*i\s*-=\s*1\s*\)/);
      expect(dashboardSrc).toMatch(/occupied\.add\(b\.roomNumber\)/);
      expect(dashboardSrc).toMatch(/bookings\.forEach\(/);
      expect(dashboardSrc).toMatch(/b\.status\s*===\s*["']cancelled["']/);
    });

    it("guards the per-day rate against zero rooms (matches S5.1 fix)", () => {
      expect(dashboardSrc).toMatch(
        /const\s+rate\s*=\s*totalRoomsCount\s*===\s*0\s*\?\s*0\s*:\s*Math\.round\(\s*\(occupied\.size\s*\/\s*totalRoomsCount\)\s*\*\s*100\s*\)/
      );
    });
  });
});
