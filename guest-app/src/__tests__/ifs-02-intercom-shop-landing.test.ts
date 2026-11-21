// Per IFS-01 follow-up (2026-11-21, decision #336): the in-room panel
// LANDS on the shop when the hotel switched the chat off but left the
// store on, and the shop tab carries the "Call Front Desk" phone link
// while the voice call is off.
//
// The rules themselves are unit-tested (`intercom-landing-tab.test.ts`).
// These are SOURCE-TEXT pins, because what regressed before was the
// WIRING: the resolver existed but the panel never called it, and the
// phone link was offered while the in-room call was still on (breaking
// the mutual exclusivity of decision #335).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("IntercomPage — the shop landing and the shop phone link", () => {
  const page = readFileSync(
    resolve(__dirname, "../pages/IntercomPage.tsx"),
    "utf8"
  );

  const shopTabStart = page.indexOf('{activeTab === "shop" && (');
  const shopTabEnd = page.indexOf('{activeTab === "shop" && getCartCount()');
  const shopTab = page.slice(shopTabStart, shopTabEnd);

  it("reads the landing rule from the shared resolver", () => {
    expect(page).toMatch(/resolveIntercomLandingTab/);
    expect(page).toMatch(
      /resolveIntercomLandingTab\(\s*activeTab,\s*intercomChatEnabled,\s*isStoreEnabled\s*\)/
    );
  });

  it("takes the landing ONCE and never fights the guest", () => {
    expect(page).toMatch(/const landingAppliedRef = useRef<boolean>\(false\)/);
    expect(page).toMatch(/const guestChoseTabRef = useRef<boolean>\(false\)/);
    expect(page).toMatch(/if \(landingAppliedRef\.current\) return;/);
    expect(page).toMatch(/if \(guestChoseTabRef\.current\) return;/);
    // The one-shot flag is set BEFORE the tab is switched.
    expect(page).toMatch(
      /landingAppliedRef\.current = true;\s*handleTabChange\(landingTab\);/
    );
  });

  it("marks a guest tap as the guest's own choice", () => {
    expect(page).toMatch(/handleTabChange\("chat", "guest"\)/);
    expect(page).toMatch(/handleTabChange\("shop", "guest"\)/);
    expect(page).toMatch(/if \(source === "guest"\) \{\s*guestChoseTabRef\.current = true;/);
  });

  it("puts exactly ONE phone link in the shop tab — behind the call-off guard", () => {
    expect(shopTabStart).toBeGreaterThan(-1);
    expect(shopTabEnd).toBeGreaterThan(shopTabStart);
    // The intercom call and the phone are mutually exclusive (decision
    // #335): the phone link exists in the shop tab ONLY while the voice
    // call is off.
    expect(shopTab).toMatch(
      /\{!intercomCallsEnabled && \(\s*<a\s+href=\{`tel:\$\{hotelContact\.frontDeskPhone\}`\}/
    );
    expect(shopTab.match(/tel:/g)?.length ?? 0).toBe(1);
  });

  it("keeps the shop phone link out of the way while the call is on", () => {
    // The header's "Call Desk" button is the channel while the call is
    // on — the shop link must never be offered next to it.
    expect(page).toMatch(/\{intercomCallsEnabled && \(\s*<button/);
  });
});
