// Per IFS-01 follow-up (2026-11-21, decisions #336 + #337): the in-room
// panel LANDS on the shop when the hotel switched the chat off but left
// the store on — and the shop carries NO phone link.
//
// The landing rule is unit-tested (`intercom-landing-tab.test.ts`). These
// are SOURCE-TEXT pins, because what regressed before was the WIRING:
// the resolver existed but the panel never called it, and the shop grew
// a "Call Front Desk" link that the owner then removed again.
//
// The phone lives in ONE place: the chat card (`IntercomUnavailableCard`)
// — the surface that explains WHY the chat is gone. The shop is a
// catalogue; a phone number in the middle of it is noise, not a next
// step, and the Chat tab is one tap away.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("IntercomPage — the shop landing, and the phone that stays off the shop", () => {
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

  it("keeps EVERY phone link OFF the shop tab (decision #337)", () => {
    expect(shopTabStart).toBeGreaterThan(-1);
    expect(shopTabEnd).toBeGreaterThan(shopTabStart);
    // The shop carries no `tel:` link at all — not behind a guard, not
    // anywhere. The front-desk phone lives on the chat card.
    expect(shopTab.match(/tel:/g) ?? []).toHaveLength(0);
    expect(shopTab).not.toMatch(/Call Front Desk/);
  });

  it("keeps the phone on the chat card — the guest still has a next step", () => {
    expect(page).toMatch(/href=\{`tel:\$\{phone\}`\}/);
    expect(page).toMatch(/Call Front Desk/);
  });
});
