// Per IFS-01 follow-up (2026-11-21, decision #335) — the guest panel's
// in-room feature MATRIX.
//
// THE FEATURE
// -----------
// The hotel has TWO independent in-room switches (the chat + the voice
// call) plus the store's own. The guest's next step depends on the pair
// the hotel actually left on:
//
//   chat ON              → the chat thread; the call is a separate
//                          control in the panel header.
//   chat OFF, calls ON   → the IN-ROOM CALL is the next step — the chat
//                          tab offers "Call Desk" as its primary action.
//   chat OFF, calls OFF  → no in-room channel is left, so the phone
//                          number is the action.
//
// The rule is a pure function in `shared/utils/intercomFeatures.ts` so
// the guest panel and any future surface can never disagree about which
// channel the guest is offered. This suite pins the MATRIX itself; the
// source-text tripwires in
// `admin-app/src/__tests__/ifs-01-intercom-feature-switches.test.ts` pin
// that the panel is WIRED to it.
//
// WHY IT IS NOT A COMPONENT TEST
// -------------------------------
// The repo has no jsdom/RTL harness, so a render-level assertion would
// be a source regex in disguise. The decision lives in a pure resolver
// (GOTCHAS.md §Firebase — "a component without a jsdom/RTL harness has
// no render-level safety net at all": extract the logic into
// `shared/utils/` and test it there).

import { describe, expect, it } from "vitest";
import {
  everyInRoomFeatureIsOff,
  resolveInRoomChatTabSurface
} from "../utils/intercomFeatures";

describe("IFS-01 follow-up — what the guest's chat tab offers", () => {
  it("chat ON → the chat thread, whatever the call is doing", () => {
    expect(resolveInRoomChatTabSurface(true, true)).toBe("chat");
    expect(resolveInRoomChatTabSurface(true, false)).toBe("chat");
  });

  it("chat OFF + call ON → the in-room CALL is the next step", () => {
    // Falling back to the phone number here would hide a channel the
    // hotel deliberately left open.
    expect(resolveInRoomChatTabSurface(false, true)).toBe("call");
  });

  it("chat OFF + call OFF → the phone-only fallback", () => {
    expect(resolveInRoomChatTabSurface(false, false)).toBe("phone");
  });

  it("the call and the phone surfaces are never offered together", () => {
    const surfaces = [
      resolveInRoomChatTabSurface(true, true),
      resolveInRoomChatTabSurface(true, false),
      resolveInRoomChatTabSurface(false, true),
      resolveInRoomChatTabSurface(false, false)
    ];
    // Exactly one surface per state, and the "call" surface never
    // coexists with the "phone" surface.
    expect(surfaces.filter((s) => s === "call")).toHaveLength(1);
    expect(surfaces.filter((s) => s === "phone")).toHaveLength(1);
    expect(surfaces.filter((s) => s === "chat")).toHaveLength(2);
  });
});

describe("IFS-01 follow-up — when the whole panel collapses", () => {
  it("every feature off (chat + calls + store) → the phone-only panel", () => {
    expect(everyInRoomFeatureIsOff(false, false, false)).toBe(true);
  });

  it("a live voice call keeps the panel up (and its Call Desk button)", () => {
    // The whole-panel card has NO header, so it would take the "Call
    // Desk" button with it. A hotel that left the call ON must not lose
    // it just because the chat and the store are off.
    expect(everyInRoomFeatureIsOff(false, true, false)).toBe(false);
    expect(everyInRoomFeatureIsOff(false, true, true)).toBe(false);
  });

  it("the chat or the store alone keeps the panel up", () => {
    expect(everyInRoomFeatureIsOff(true, false, false)).toBe(false);
    expect(everyInRoomFeatureIsOff(false, false, true)).toBe(false);
  });

  it("everything ON → the panel is fully up", () => {
    expect(everyInRoomFeatureIsOff(true, true, true)).toBe(false);
  });
});
