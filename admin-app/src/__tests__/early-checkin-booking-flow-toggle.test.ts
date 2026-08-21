// Per EC-02 (operator-requested 2026-08-21): Spark Rewards
// early check-in perk becomes a) available in the booking flow
// (Step 4 confirmation page) with a strong disclaimer copy and
// b) globally togglable from the admin Settings → Rewards tab.
// The toggle hides the button on the guest side AND gates the
// server-side `/api/email?action=early-checkin-request` handler
// (defense-in-depth per Hard Rule #1: never trust the client).
//
// Source-text pin tests verify the integration points are
// wired in the same places the rest of the codebase lives.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/email.ts"),
  "utf8"
);
const bookingConfirmPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingConfirmPage.tsx"),
  "utf8"
);
const rewardsPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/RewardsPage.tsx"),
  "utf8"
);
const settingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);
const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/apiRouter.ts"),
  "utf8"
);

// Slice the early-checkin-request handler from the action
// anchor so we don't bleed into the next handler. The
// end-anchor is the schema block at the bottom of the
// handler body (~50 lines after the start) — earlier
// anchors like "sendCorporateInquiryTrigger" sit BEFORE
// this handler in the file (it's the previous action),
// so we need something inside this handler body to
// bound the slice.
const earlyCheckinSliceStart = emailHandlerSrc.indexOf(
  'if (action === "early-checkin-request")'
);
const earlyCheckinSliceEnd = emailHandlerSrc.indexOf(
  "earlyCheckinRequestSchema",
  earlyCheckinSliceStart
);
const earlyCheckinSlice =
  earlyCheckinSliceStart >= 0 && earlyCheckinSliceEnd > earlyCheckinSliceStart
    ? emailHandlerSrc.slice(earlyCheckinSliceStart, earlyCheckinSliceEnd)
    : "";

describe("EC-02 — Spark Rewards early check-in toggle + booking flow button", () => {
  describe("server: the early-checkin-request handler gates on the admin toggle", () => {
    it("reads settings/rewardsConfig earlyCheckInEnabled from Firestore", () => {
      // Per Hard Rule #1 (never trust the client), the toggle
      // MUST be re-read server-side on every request, not
      // cached. Mirrors the existing memberDiscountEnabled /
      // pointsEnabled patterns at
      // `guest-app/server/handlers/bookings.ts:2582` /
      // `:11102`. The 403 path is what makes the toggle
      // effective against a member who crafts a direct API call
      // after disabling via the admin app.
      expect(earlyCheckinSlice).toMatch(
        /adminDb\.doc\(\s*["']settings\/rewardsConfig["']\s*\)/
      );
    });

    it("rejects with 403 when earlyCheckInEnabled === false", () => {
      // Defense-in-depth: the admin toggle is the source of
      // truth. Even if a member somehow has the page open with
      // the button rendered (stale config cache), the server
      // rejects the write. Mirrors the existing
      // `memberDiscountEnabled !== false` boolean treatment at
      // `bookings.ts:2586`.
      expect(earlyCheckinSlice).toMatch(/earlyCheckInEnabled\s*[!=]==\s*false/);
      expect(earlyCheckinSlice).toMatch(/return\s+res\.status\(403\)/);
    });
  });

  describe("guest booking flow: the button appears on Step 4 confirmation", () => {
    it("BookingConfirmPage renders the Request Early Check-In button for members", () => {
      // The button is gated on `isRewardsMember` (already
      // computed at line 193 of BookingConfirmPage) AND on
      // `earlyCheckInEnabled` from the config (new). Pinned
      // here as a guard so a future refactor that moves the
      // button (e.g. to a different step) breaks the test.
      expect(bookingConfirmPageSrc).toMatch(
        /Request\s+Early\s+Check-?In|request.{0,5}early.{0,5}check.?in/i
      );
    });

    it("the button is gated on a logged-in member (NOT visible to anonymous guests)", () => {
      // Per the spec: "only if the member is logged in". The
      // page already derives `isRewardsMember` from
      // `useGuestAuth`; the button render condition must
      // include it.
      expect(bookingConfirmPageSrc).toMatch(/isRewardsMember/);
    });

    it("the strong disclaimer copy appears next to the button", () => {
      // Operator-specified: "not guaranteed and is for approval,
      // email will be received for the approval or rejection".
      // The exact phrasing may evolve but the three required
      // concepts — not guaranteed / approval / email
      // confirmation — must all be present so a future copy
      // change that drops one of them trips this test.
      expect(bookingConfirmPageSrc).toMatch(/not\s+guaranteed/i);
      expect(bookingConfirmPageSrc).toMatch(/approval/i);
      expect(bookingConfirmPageSrc).toMatch(/email/i);
    });

    it("the button is hidden when rewardsConfig.earlyCheckInEnabled is false", () => {
      // The booking flow + the rewards page must both honor the
      // toggle — consistent UX across surfaces. The state name
      // is the same shape as the existing
      // `memberDiscountEnabled` useState.
      expect(bookingConfirmPageSrc).toMatch(/earlyCheckInEnabled/);
    });
  });

  describe("guest RewardsPage: existing button also respects the toggle", () => {
    it("RewardsPage button is gated on earlyCheckInEnabled", () => {
      // The button already exists at line 305-306 (per the
      // v0.287.0 ship). The new toggle must hide it when off,
      // otherwise the disable is leaky — the guest can still
      // submit from the rewards page even with the admin
      // toggle off.
      expect(rewardsPageSrc).toMatch(/earlyCheckInEnabled/);
    });
  });

  describe("admin: the toggle lives in Settings → Rewards tab", () => {
    it("SettingsPage has an earlyCheckInEnabled useState mirroring memberDiscountEnabled", () => {
      // The toggle follows the existing pointsEnabled /
      // memberDiscountEnabled pattern. The actual code
      // splits the useState across two lines:
      //   const [earlyCheckInEnabled, setEarlyCheckInEnabled] = useState<boolean>(
      //     rewardsConfig.earlyCheckInEnabled !== false
      //   );
      // so the regex needs the `s` flag to match across the
      // newline. Pin both halves of the declaration so a future
      // refactor (renaming the variable OR changing the
      // defensive coercion) breaks one of them.
      const setupDeclRegex = /const\s+\[\s*earlyCheckInEnabled\s*,\s*setEarlyCheckInEnabled\s*\]\s*=\s*useState<boolean>\(/;
      const initValueRegex = /rewardsConfig\.earlyCheckInEnabled\s*!==\s*false/;
      expect(settingsPageSrc).toMatch(setupDeclRegex);
      // The defensive `!== false` coercion must appear somewhere
      // in the file (used by both the initial state and the
      // snapshot-rehydrate `useEffect` block).
      expect(settingsPageSrc).toMatch(initValueRegex);
    });

    it("the toggle is rendered in the Rewards tab with the same toggle UI as the others", () => {
      // The existing toggles at lines 4378-4406 use a 6×11
      // round button + translate-x animation. The new toggle
      // must use the same shape for visual consistency.
      // Pin the toggle's outer label text.
      expect(settingsPageSrc).toMatch(/Early\s+Check-?In\s+Request/i);
    });

    it("the toggle value is persisted via updateSettings(\"rewardsConfig\", {...})", () => {
      // The save handler at line 2685 writes
      // updateSettings("rewardsConfig", {...}) with the
      // current state. The new field must be in the same call
      // so a single save persists all toggles together.
      const handleSaveRewardsIdx = settingsPageSrc.indexOf("handleSaveRewards");
      const handleSaveRewardsEnd = settingsPageSrc.indexOf(
        "};",
        handleSaveRewardsIdx
      );
      const handleSaveRewards = settingsPageSrc.slice(
        handleSaveRewardsIdx,
        handleSaveRewardsEnd + 2
      );
      expect(handleSaveRewards).toMatch(/earlyCheckInEnabled/);
    });
  });

  describe("email: the staff notification mentions the approval loop", () => {
    it("the earlyCheckinRequestEmail intro mentions approval/rejection", () => {
      // The operator asked for "email will be received for the
      // approval or rejection" copy on the guest side; mirror
      // it on the staff side so the receiving operator
      // understands the loop they're entering. Slice just the
      // template function so the assertion doesn't bleed.
      const templateIdx = emailHandlerSrc.indexOf("function earlyCheckinRequestEmail");
      const templateEnd = emailHandlerSrc.indexOf(
        "}",
        emailHandlerSrc.indexOf("ctaUrl:", templateIdx)
      );
      const template =
        templateIdx >= 0 && templateEnd > templateIdx
          ? emailHandlerSrc.slice(templateIdx, templateEnd + 1)
          : "";
      expect(template).toMatch(/approval/i);
    });
  });
});