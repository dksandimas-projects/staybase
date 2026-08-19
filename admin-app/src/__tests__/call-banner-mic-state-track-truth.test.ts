import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression regression test for decision #219 (2026-08-19): the
// mic mute state displayed in the active-call banner MUST be
// derived from the LIVE `track.enabled` value, not from the
// React `isMicMuted` state.
//
// Operator-reported 2026-08-19 (post-#218): the pill said "MIC
// OPEN" but the audio was muted. Root cause: something other
// than `toggleMicMute` set `track.enabled = false` (WebRTC
// renegotiation, browser tab mute, the OS audio subsystem, or
// a stale closure in an early render) and `isMicMuted` did
// not follow. The displayed state and the actual audio
// desynced, so the operator saw "Mic open" but the guest heard
// silence. The fix: every render of the banner reads the live
// `track.enabled` value via `getActualMicMuted()`, so the
// pill and the button can never disagree with the audio.

const adminSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const inboxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/IntercomInboxPage.tsx"),
  "utf8"
);

describe("AdminContext.tsx — track.enabled is the source of truth for mic state (decision #219)", () => {
  describe("getActualMicMuted reads the live track state", () => {
    it("exposes getActualMicMuted on the AdminContext return value", () => {
      // The context must expose a function the banner can call
      // to read the live mic state. The banner derives
      // `actualMicMuted` from this function — not from
      // `isMicMuted`.
      expect(adminSrc).toMatch(/getActualMicMuted,/);
    });

    it("declares getActualMicMuted: () => boolean on the AdminContextType interface", () => {
      // Type contract — the banner subscribes via the context
      // type so it gets TypeScript support on the return value.
      expect(adminSrc).toMatch(/getActualMicMuted:\s*\(\)\s*=>\s*boolean/);
    });

    it("getActualMicMuted reads adminMediaStreamRef.current.getAudioTracks()[0].enabled", () => {
      // The single source of truth is `track.enabled`. The
      // implementation walks the same path as `toggleMicMute`
      // (adminMediaStreamRef → getAudioTracks → tracks[0]) so
      // the read sees exactly what the write targets.
      expect(adminSrc).toMatch(
        /getActualMicMuted[\s\S]+?adminMediaStreamRef\.current[\s\S]+?getAudioTracks\(\)[\s\S]+?tracks\[0\]\.enabled/
      );
    });

    it("getActualMicMuted returns false when there is no active stream (idle inbox state)", () => {
      // No stream means no active call, so the banner has no
      // mute toggle to render anyway — the function should
      // return false (consistent with the initial `isMicMuted`
      // useState default and the cleanupAdminCall reset). The
      // exact contract: `!stream` → return false.
      expect(adminSrc).toMatch(
        /getActualMicMuted[\s\S]+?if\s*\(\s*!stream\s*\)\s*return\s*false/
      );
    });

    it("getActualMicMuted returns the negated enabled flag (muted = !enabled)", () => {
      // The convention pinned by toggleMicMute: muted when
      // `track.enabled === false`. The return value is the
      // negation — `return !tracks[0].enabled;` — so callers
      // see "muted?" as a positive boolean.
      expect(adminSrc).toMatch(/return\s*!tracks\[0\]\.enabled/);
    });
  });

  describe("toggleMicMute uses the live track state as its flip source", () => {
    // Pre-#219 the toggle computed `nextEnabled = !isMicMuted`
    // which could drift from `track.enabled` if the track was
    // mutated outside `toggleMicMute`. Post-#219 it reads the
    // LIVE track state so rapid double-clicks don't oscillate
    // against a stale React closure.
    const fnBodyMatch = adminSrc.match(
      /const toggleMicMute\s*=\s*useCallback\([\s\S]+?}\s*,\s*\[\]\);/
    );
    const fnBody = fnBodyMatch ? fnBodyMatch[0] : "";

    it("toggleMicMute is now a useCallback with empty deps (no isMicMuted dep)", () => {
      // The function reads from a ref + the live track — no
      // React state dependency. An empty dep array is the
      // canonical signal that the callback is referentially
      // stable across renders, which matters because the
      // banner's button onClick prop must not churn.
      expect(adminSrc).toMatch(
        /const toggleMicMute\s*=\s*useCallback\([\s\S]+?}\s*,\s*\[\]\);/
      );
    });

    it("toggleMicMute reads `tracks[0].enabled` to compute nextEnabled", () => {
      // The flip source is the live track state, NOT the React
      // state. This is the critical pin — without this the
      // track-state / React-state desync that #219 fixes can
      // silently regress.
      expect(fnBody).toMatch(/const currentTrackEnabled[\s\S]+?tracks\[0\]\.enabled/);
    });

    it("toggleMicMute computes nextEnabled = !currentTrackEnabled", () => {
      expect(fnBody).toMatch(/const nextEnabled\s*=\s*!currentTrackEnabled/);
    });

    it("toggleMicMute still walks every audio track in the stream", () => {
      // Multi-track streams (echo cancellation + noise
      // suppression) need every track flipped — don't narrow to
      // tracks[0] only.
      expect(fnBody).toMatch(/tracks\.forEach\(\(track\)\s*=>\s*\{?\s*track\.enabled\s*=\s*nextEnabled/);
    });
  });

  describe("isMicMuted remains on the context as a hint (not the display source)", () => {
    // Per decision #219 the React `isMicMuted` state is no
    // longer the source of truth for the displayed mic state.
    // It stays on the context for any future consumer that
    // wants the user's last-intent hint (e.g. an analytics
    // event, or a different surface that doesn't need live-
    // track accuracy). Pin that the type contract + return
    // value are unchanged.
    it("AdminContextType still declares isMicMuted: boolean", () => {
      expect(adminSrc).toMatch(/isMicMuted:\s*boolean/);
    });

    it("the context return value still exposes isMicMuted", () => {
      expect(adminSrc).toMatch(/isMicMuted,/);
    });

    it("cleanupAdminCall still resets isMicMuted to false on every disconnect", () => {
      // The reset is still important — it's the next-call
      // invariant (every new call starts unmuted). The React
      // state is the hint for `toggleMicMute`'s first-flip, and
      // it must be reset between calls so the hint is fresh.
      expect(adminSrc).toMatch(
        /cleanupAdminCall[\s\S]+?setIsMicMuted\(false\)/
      );
    });

    it("acceptCall's clearCallRefsOnly also resets isMicMuted (the per-call #217 helper)", () => {
      // Decision #217 extracted clearCallRefsOnly as the
      // non-dispatching sibling of cleanupAdminCall for the
      // accept success path. The reset to unmuted is a
      // per-call invariant so it lives in BOTH helpers (the
      // #217 path resets via clearCallRefsOnly; the
      // post-cleanup path resets via cleanupAdminCall).
      expect(adminSrc).toMatch(
        /clearCallRefsOnly[\s\S]+?setIsMicMuted\(false\)/
      );
    });
  });
});

describe("IntercomInboxPage.tsx — banner derives state from getActualMicMuted (decision #219)", () => {
  it("captures getActualMicMuted() at the top of the active-call IIFE", () => {
    // The IIFE renders every active-call surface on each
    // render. Capturing the live state once per render
    // guarantees the pill, button, aria-pressed, title, and
    // styling all see the same value.
    expect(inboxSrc).toMatch(/const actualMicMuted\s*=\s*getActualMicMuted\(\)/);
  });

  it("the mic status pill text derives from actualMicMuted", () => {
    expect(inboxSrc).toMatch(/actualMicMuted\s*\?\s*"Mic muted"\s*:\s*"Mic open"/);
  });

  it("the mic status pill border + fill + text colour derive from actualMicMuted", () => {
    expect(inboxSrc).toMatch(/actualMicMuted\s*\?\s*"border-red-200\s+bg-red-50\s+text-red-700"/);
  });

  it("the mic status pill dot colour derives from actualMicMuted", () => {
    expect(inboxSrc).toMatch(/actualMicMuted\s*\?\s*"bg-red-500"\s*:\s*"bg-emerald-500"/);
  });

  it("the mute toggle button styling derives from actualMicMuted", () => {
    // The amber (muted) vs primary-light (unmuted) palette
    // mapping. The pre-#219 colour could disagree with the
    // audio if isMicMuted and track.enabled desynced.
    expect(inboxSrc).toMatch(/actualMicMuted\s*\?\s*"border-amber-200\s+bg-amber-50\s+text-amber-800\s+hover:bg-amber-100"/);
  });

  it("the mute toggle button icon swap derives from actualMicMuted", () => {
    expect(inboxSrc).toMatch(/actualMicMuted\s*\?\s*<MicOff/);
  });

  it("the mute toggle button label derives from actualMicMuted", () => {
    expect(inboxSrc).toMatch(/actualMicMuted\s*\?\s*"Unmute"\s*:\s*"Mute"/);
  });

  it("the mute toggle button aria-pressed derives from actualMicMuted", () => {
    // Accessibility — screen readers announce the pressed state
    // from aria-pressed. If it were driven by isMicMuted (a
    // stale React state), the announcement could disagree
    // with the audio.
    expect(inboxSrc).toMatch(/aria-pressed=\{actualMicMuted\}/);
  });

  it("the mute toggle button title attribute derives from actualMicMuted", () => {
    // The hover tooltip. Must reflect the actual audio state.
    expect(inboxSrc).toMatch(/title=\{actualMicMuted/);
  });

  it("the mute toggle button aria-label derives from actualMicMuted", () => {
    // The accessibility label. Must reflect the actual audio
    // state so screen-reader users hear the right action.
    expect(inboxSrc).toMatch(/aria-label=\{actualMicMuted\s*\?\s*"Unmute microphone"\s*:\s*"Mute microphone"/);
  });

  it("the destructured `isMicMuted` is intentionally NOT pulled from useAdmin()", () => {
    // Belt-and-braces — pin the absence so a future refactor
    // that re-introduces the `isMicMuted` destructure (and
    // re-uses it for display) fails this test. The pre-#219
    // bug was directly caused by reading `isMicMuted` for
    // display; the destructured-not-used invariant prevents
    // the regression.
    //
    // Note: `isMicMuted` is still on the context (it's a hint
    // for toggleMicMute's first flip), just not destructured
    // in this file. We anchor on the new entry to get the
    // actual destructure lines (not the prose comment that
    // mentions the symbol by name as documentation).
    const getActualIdx = inboxSrc.indexOf("getActualMicMuted,");
    expect(getActualIdx, "the getActualMicMuted destructure entry must exist").toBeGreaterThan(-1);
    const toggleIdx = inboxSrc.indexOf("toggleMicMute,");
    expect(toggleIdx, "the toggleMicMute destructure entry must exist").toBeGreaterThan(-1);
    const useAdminIdx = inboxSrc.indexOf("= useAdmin();");
    expect(useAdminIdx, "the useAdmin() destructure must exist").toBeGreaterThan(-1);
    // The slice from the FIRST destructure variable up to the
    // = useAdmin(); line is the actual destructuring block.
    // Find the variable just before `toggleMicMute,` (which
    // is `getActualMicMuted`'s neighbour) and slice from there.
    const firstVarIdx = inboxSrc.indexOf("intercoms,", getActualIdx - 200);
    expect(firstVarIdx).toBeGreaterThan(-1);
    const destructureBlock = inboxSrc.slice(firstVarIdx, useAdminIdx);
    expect(destructureBlock).not.toMatch(/^\s*isMicMuted\s*,/m);
  });

  it("the destructured `getActualMicMuted` IS pulled from useAdmin()", () => {
    // The companion pin to the one above — the new symbol
    // must be in the destructure.
    expect(inboxSrc).toMatch(/const\s*\{[\s\S]+?getActualMicMuted\s*,[\s\S]+?\}\s*=\s*useAdmin\(\)/);
  });
});