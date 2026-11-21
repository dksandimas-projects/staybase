// Per IFS-01 follow-up (2026-11-21, decision #336): WHERE the in-room
// panel lands.
//
// The hotel can switch the CHAT off and leave the STORE on. The chat QR
// then opened on the "chat is unavailable" card — a dead end for a guest
// whose only working surface was the shop. The landing resolver sends
// them to the shop instead.
//
// The resolver is pure, so the rule is unit-tested on its own; the wiring
// in `IntercomPage.tsx` is pinned by `ifs-02-intercom-shop-landing.test.ts`.

import { describe, expect, it } from "vitest";
import { resolveIntercomLandingTab } from "../utils/intercomTab";

describe("intercom landing tab", () => {
  it("keeps the chat tab when the chat works", () => {
    expect(resolveIntercomLandingTab("chat", true, true)).toBe("chat");
    expect(resolveIntercomLandingTab("chat", true, false)).toBe("chat");
  });

  it("lands on the shop when the chat is off and the store is on", () => {
    expect(resolveIntercomLandingTab("chat", false, true)).toBe("shop");
  });

  it("keeps the store QR on the shop — the chat being off never overrides it", () => {
    expect(resolveIntercomLandingTab("shop", false, true)).toBe("shop");
    expect(resolveIntercomLandingTab("shop", true, true)).toBe("shop");
  });

  it("falls back to the chat tab when the store is off as well", () => {
    // No shop to land on — the chat tab carries the "Call Desk" card
    // (call ON) or the whole-panel fallback card (everything off).
    expect(resolveIntercomLandingTab("shop", true, false)).toBe("chat");
    expect(resolveIntercomLandingTab("chat", false, false)).toBe("chat");
  });
});
