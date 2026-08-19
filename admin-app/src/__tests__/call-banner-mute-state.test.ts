import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for operator-reported 2026-08-19: two
// active-call banner bugs the operator flagged immediately
// after the #217 call-history fix landed.
//
// Bug #1 — "muted by default" UX confusion. The pre-#218
// active-call banner showed a `hidden lg:flex` mic-status
// indicator (desktop only) + a mute toggle button whose label
// was the ACTION ("Mute" = click to mute), not the current
// state. On mobile/tablet/smaller laptop screens the operator
// saw only the button — and the "Mute" label read as "I'm
// currently muted" even when the mic was actually open. Fix:
// replace the hidden indicator with an ALWAYS-VISIBLE live
// mic status pill (green/red dot + "Mic open" / "Mic muted"
// label) so the current state is visible on every breakpoint
// independent of the action button label.
//
// Bug #2 — Disconnect button invisible. The pre-#218 className
// used `bg-red-650` which is NOT in the Tailwind palette (the
// standard scale jumps 600 → 700). Tailwind silently dropped the
// class so the button rendered with no background and was
// effectively invisible against the white card. Fix:
// `bg-red-650` → `bg-red-600` + the standard `hover:bg-red-700`.
//
// Bug #3 — Stale title attribute phrasing. The pre-#218
// "Mute mic. The guest will not hear you while muted." copy
// was the OUTCOME description, not the current-state
// description. Replaced with "Mic is open. The guest can hear
// you. Click to mute." which reads consistently with the
// muted-state title ("Mic is muted. The guest can't hear you.
// Click to unmute.").

const inboxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/IntercomInboxPage.tsx"),
  "utf8"
);

describe("IntercomInboxPage — active-call banner (decision #218)", () => {
  describe("Bug #1 — Live mic status pill is always visible", () => {
    // The pre-#218 indicator was `hidden lg:flex` (desktop only).
    // The fix replaces it with an always-visible pill so mobile /
    // tablet / smaller-laptop screens also see the current state.
    it("the mic status indicator is NOT gated behind `hidden lg:flex`", () => {
      // Find the indicator div that follows the `incomingCall.status === "active"`
      // branch. The pre-#218 code used `hidden lg:flex` — verify it
      // is gone.
      expect(inboxSrc).not.toMatch(/hidden\s+lg:flex\s+items-center\s+gap-1\s+bg-white\/60/);
    });

    it("declares an always-visible mic-status pill with a testid", () => {
      // The new pill uses a `data-testid="call-mic-status-pill-{roomId}"`
      // pattern so downstream tests can pin the live state.
      expect(inboxSrc).toMatch(/data-testid=\{`call-mic-status-pill-\$\{incomingCall\.roomId\}`\}/);
    });

    it("the pill shows 'Mic open' when unmuted", () => {
      // The pill text is `Mic open` in the unmuted branch. Without
      // this pin a future refactor that breaks the green/red colour
      // mapping won't fail any test — the explicit text pin is the
      // cheapest gate.
      expect(inboxSrc).toMatch(/Mic open/);
    });

    it("the pill shows 'Mic muted' when muted", () => {
      expect(inboxSrc).toMatch(/Mic muted/);
    });

    it("the pill uses emerald (green) when unmuted", () => {
      // Pre-#218 the unmuted indicator used primary (blue) which
      // was visually too "active" for a passive state. The fix
      // uses emerald-200/50/700 for a clear "live" green that
      // mirrors the standard conferencing-app convention.
      expect(inboxSrc).toMatch(/emerald-200\s+bg-emerald-50\s+text-emerald-700/);
    });

    it("the pill uses red when muted", () => {
      // Red communicates "muted" universally. The exact shade
      // matches the rest of the app's red palette.
      expect(inboxSrc).toMatch(/border-red-200\s+bg-red-50\s+text-red-700/);
    });

    it("the pill carries a coloured dot that tracks the state", () => {
      // The dot is a small filled circle — `bg-emerald-500` for
      // open, `bg-red-500` for muted. The dot is the first
      // visual cue the eye lands on; without this pin a future
      // refactor that drops the dot won't fail any test.
      expect(inboxSrc).toMatch(/bg-emerald-500/);
      expect(inboxSrc).toMatch(/bg-red-500/);
    });
  });

  describe("Bug #2 — Disconnect button has a visible background", () => {
    // The pre-#218 className used `bg-red-650` which is not in the
    // Tailwind palette. The button rendered with NO background.
    it("does NOT use the non-existent `bg-red-650` class on the disconnect button", () => {
      // The exact bug — pin the absence.
      expect(inboxSrc).not.toMatch(/bg-red-650\s+hover:bg-red-700/);
    });

    it("uses the standard `bg-red-600` class on the disconnect button", () => {
      // The fix uses red-600 (the standard palette shade for
      // "danger" actions) plus red-700 on hover. Matches the
      // rest of the app's red palette (e.g. ReportsPage
      // table cells, SettingsPage delete buttons).
      expect(inboxSrc).toMatch(/bg-red-600\s+hover:bg-red-700/);
    });

    it("the disconnect button keeps the `text-white` class so the label is legible on red", () => {
      // Belt-and-braces pin: red-600 background + white text is
      // the standard "danger" CTA. A future refactor that drops
      // the text-white would make the white-on-red label
      // illegible.
      expect(inboxSrc).toMatch(/bg-red-600\s+hover:bg-red-700\s+text-xs\s+font-bold\s+text-white/);
    });
  });

  describe("Bug #3 — Mute button title attribute matches the current state", () => {
    // The pre-#218 title copy was "Mute mic. The guest will not
    // hear you while muted." — describing the OUTCOME of clicking,
    // not the current state. The fix uses "Mic is open. The guest
    // can hear you. Click to mute." which matches the muted-state
    // title's pattern of "state + click-to-toggle".
    it("the unmuted title says 'Mic is open' (state) + 'Click to mute' (action)", () => {
      expect(inboxSrc).toMatch(/Mic is open\. The guest can hear you\. Click to mute\./);
    });

    it("the muted title still says 'Mic is muted' + 'Click to unmute'", () => {
      // Pre-existing — pin it stays the same shape as the unmuted
      // branch so the title is consistent across both states.
      expect(inboxSrc).toMatch(/Mic is muted\. The guest can't hear you\. Click to unmute\./);
    });
  });

  describe("Regression sanity — the original two surfaces still exist", () => {
    // These existed pre-#218 and the fix preserves them. Pinning
    // them ensures a future refactor doesn't accidentally drop
    // the mute toggle button or the disconnect button while
    // rearranging the active-call banner.
    it("the mute toggle button still has its data-testid", () => {
      expect(inboxSrc).toMatch(/data-testid=\{`call-mute-toggle-\$\{incomingCall\.roomId\}`\}/);
    });

    it("the mute toggle button still has the Mic / MicOff icon swap", () => {
      expect(inboxSrc).toMatch(/isMicMuted\s*\?\s*<MicOff/);
    });

    it("the mute toggle button label is still 'Mute' / 'Unmute' (the action, not the state)", () => {
      // The action label stays. The CURRENT state lives in the
      // pill above. Together they read as
      // "Mic open · Mute" / "Mic muted · Unmute" which is
      // unambiguous even on first read.
      expect(inboxSrc).toMatch(/isMicMuted\s*\?\s*"Unmute"\s*:\s*"Mute"/);
    });

    it("the disconnect button still has the PhoneOff icon + 'Disconnect Call' label", () => {
      expect(inboxSrc).toMatch(/<PhoneOff size=\{14\} \/>\s*Disconnect Call/);
    });
  });
});