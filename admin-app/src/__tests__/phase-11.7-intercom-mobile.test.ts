import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const intercomSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/IntercomInboxPage.tsx"),
  "utf8"
);
const panelSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/IntercomChatPanel.tsx"),
  "utf8"
);
const cardSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/StoreOrderMessageCard.tsx"),
  "utf8"
);

describe("Phase 11.7 — Intercom single-pane mobile rewrite (P1)", () => {
  describe("StoreOrderMessageCard extracted to its own file", () => {
    it("lives in admin-app/src/components/StoreOrderMessageCard.tsx", () => {
      expect(cardSrc).toMatch(/export function StoreOrderMessageCard/);
    });

    it("is imported by IntercomInboxPage (no longer inline)", () => {
      expect(intercomSrc).toMatch(/import\s*\{\s*StoreOrderMessageCard\s*\}\s*from\s*["']\.\.\/components\/StoreOrderMessageCard["']/);
      // No inline function in the page anymore
      expect(intercomSrc).not.toMatch(/^function StoreOrderMessageCard\(/m);
    });
  });

  describe("IntercomChatPanel extracted and reusable", () => {
    it("lives in admin-app/src/components/IntercomChatPanel.tsx", () => {
      expect(panelSrc).toMatch(/export function IntercomChatPanel/);
    });

    it("accepts a 'panel' or 'drawer' variant prop", () => {
      expect(panelSrc).toMatch(/variant\?:\s*["']panel["']\s*\|\s*["']drawer["']/);
    });

    it("accepts an optional onBack callback + BackIcon for the drawer's back button", () => {
      expect(panelSrc).toMatch(/onBack\?:\s*\(\)\s*=>\s*void/);
      expect(panelSrc).toMatch(/BackIcon\?:\s*LucideIcon/);
    });

    it("renders an aria-label='Back to threads' button when onBack is provided", () => {
      expect(panelSrc).toMatch(/aria-label="Back to threads"/);
    });

    it("scrolls messages to the bottom via a local ref", () => {
      expect(panelSrc).toMatch(/messagesEndRef\s*=\s*useRef/);
    });
  });

  describe("IntercomInboxPage uses the panel + Drawer", () => {
    it("imports useBreakpoint, Drawer, and IntercomChatPanel", () => {
      expect(intercomSrc).toMatch(/import\s*\{\s*useBreakpoint\s*\}\s*from\s*["']\.\.\/utils\/useBreakpoint["']/);
      expect(intercomSrc).toMatch(/import\s*\{\s*Drawer\s*\}\s*from\s*["']\.\.\/components\/Drawer["']/);
      expect(intercomSrc).toMatch(/import\s*\{[^}]*IntercomChatPanel[^}]*\}\s*from\s*["']\.\.\/components\/IntercomChatPanel["']/);
    });

    it("reads isMobile from useBreakpoint", () => {
      expect(intercomSrc).toMatch(/const\s*\{\s*isMobile\s*\}\s*=\s*useBreakpoint/);
    });

    it("the chat panel renders desktop-only (gated by !isMobile)", () => {
      // The right column's IntercomChatPanel should be wrapped in {!isMobile && (...)}
      const rightColumnBlock = intercomSrc.match(
        /\{\!isMobile\s*&&\s*\(\s*<IntercomChatPanel[\s\S]*?variant="panel"/
      );
      expect(rightColumnBlock, "expected desktop chat gated by !isMobile").toBeTruthy();
    });

    it("a Drawer wraps a second IntercomChatPanel for the mobile chat", () => {
      expect(intercomSrc).toMatch(/<Drawer[\s\S]*?open=\{isMobile\s*&&\s*isMobileChatOpen/);
      // The Drawer body contains a second IntercomChatPanel with variant="drawer"
      const drawerPanelBlock = intercomSrc.match(
        /<Drawer[\s\S]*?<IntercomChatPanel[\s\S]*?variant="drawer"/
      );
      expect(drawerPanelBlock, "expected a drawer-wrapped IntercomChatPanel").toBeTruthy();
    });

    it("the mobile Drawer has a back button (onBack + ArrowLeft icon)", () => {
      expect(intercomSrc).toMatch(/onBack=\{closeMobileChat\}/);
      expect(intercomSrc).toMatch(/BackIcon=\{ArrowLeft\}/);
    });

    it("handleSelectRoom opens the mobile drawer when isMobile", () => {
      const handleSelectRoomBlock = intercomSrc.match(
        /const handleSelectRoom\s*=\s*\(roomNum: string\)\s*=>\s*\{[\s\S]*?\}/
      );
      expect(handleSelectRoomBlock, "expected handleSelectRoom block").toBeTruthy();
      expect(handleSelectRoomBlock![0]).toMatch(/if\s*\(isMobile\)\s*\{[\s\S]*?setIsMobileChatOpen\(true\)/);
    });
  });

  describe("Auto-select-first-thread effect is desktop-only", () => {
    it("skips auto-selecting on mobile", () => {
      // The useEffect that auto-selects the first thread should
      // have a `if (isMobile) return;` early-return guard.
      const autoSelectBlock = intercomSrc.match(
        /useEffect\(\(\) =>\s*\{[\s\S]*?setSelectedRoomNumber\(filteredRooms\[0\][\s\S]*?\}\s*,\s*\[filteredRooms[\s\S]*?isMobile/
      );
      expect(autoSelectBlock, "expected auto-select effect with isMobile guard").toBeTruthy();
      expect(autoSelectBlock![0]).toMatch(/if\s*\(isMobile\)\s*return/);
    });
  });

  describe("No more messagesEndRef or auto-scroll useEffect in the page", () => {
    it("the page does not declare messagesEndRef anymore", () => {
      expect(intercomSrc).not.toMatch(/const\s+messagesEndRef\s*=\s*useRef/);
    });

    it("the page does not have the inline auto-scroll useEffect anymore", () => {
      expect(intercomSrc).not.toMatch(/messagesEndRef\.current\?\.scrollIntoView/);
    });
  });
});
