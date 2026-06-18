import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const trapSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/utils/useFocusTrap.ts"),
  "utf8"
);
const drawerSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Drawer.tsx"),
  "utf8"
);
const modalSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Modal.tsx"),
  "utf8"
);
const barSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/BottomTabBar.tsx"),
  "utf8"
);

describe("Phase 11.7 — a11y polish (P2): focus trap, ARIA, focus restore", () => {
  describe("useFocusTrap hook", () => {
    it("exists at admin-app/src/utils/useFocusTrap.ts", () => {
      expect(trapSrc).toMatch(/export function useFocusTrap/);
    });

    it("queries focusable elements (a, button, input, textarea, select, [tabindex])", () => {
      expect(trapSrc).toMatch(/a\[href\]/);
      expect(trapSrc).toMatch(/\bbutton\b/);
      expect(trapSrc).toMatch(/\binput\b/);
      expect(trapSrc).toMatch(/\btextarea\b/);
      expect(trapSrc).toMatch(/\bselect\b/);
      expect(trapSrc).toMatch(/\[tabindex\]/);
    });

    it("filters out disabled elements and tabindex=-1", () => {
      expect(trapSrc).toMatch(/disabled/);
      expect(trapSrc).toMatch(/tabIndex\s*!==\s*-1/);
    });

    it("cycles focus on Tab from last element back to first", () => {
      expect(trapSrc).toMatch(/firstEl\.focus\(\)/);
      expect(trapSrc).toMatch(/lastEl\.focus\(\)/);
    });

    it("calls onEscape when the user presses Escape", () => {
      expect(trapSrc).toMatch(/if\s*\(e\.key\s*===\s*["']Escape["']\)\s*\{[\s\S]*?onEscape\(\)/);
    });

    it("saves and restores focus on mount/unmount", () => {
      expect(trapSrc).toMatch(/previouslyFocused\.current\s*=\s*document\.activeElement/);
      expect(trapSrc).toMatch(/previous\.focus\(\)/);
    });

    it("cleans up the document keydown listener on unmount", () => {
      expect(trapSrc).toMatch(/document\.removeEventListener\(["']keydown["']/);
    });
  });

  describe("Drawer uses useFocusTrap", () => {
    it("imports useFocusTrap", () => {
      expect(drawerSrc).toMatch(/import\s*\{\s*useFocusTrap\s*\}\s*from\s*["']\.\.\/utils\/useFocusTrap["']/);
    });

    it("calls useFocusTrap(true, onClose) in both mobile and desktop panel components", () => {
      const mobileRef = drawerSrc.match(/MobileDrawerPanel[\s\S]*?useFocusTrap<HTMLElement>\(true, onClose\)/);
      const desktopRef = drawerSrc.match(/DesktopDrawerPanel[\s\S]*?useFocusTrap<HTMLElement>\(true, onClose\)/);
      expect(mobileRef, "expected mobile drawer to use focus trap").toBeTruthy();
      expect(desktopRef, "expected desktop drawer to use focus trap").toBeTruthy();
    });

    it("uses aria-labelledby pointing to a title id (not just aria-label)", () => {
      expect(drawerSrc).toMatch(/aria-labelledby=\{titleId\}/);
    });

    it("renders the title with the id used by aria-labelledby", () => {
      expect(drawerSrc).toMatch(/<h2 id=\{titleId\}/);
    });
  });

  describe("Modal uses useFocusTrap", () => {
    it("imports useFocusTrap", () => {
      expect(modalSrc).toMatch(/import\s*\{\s*useFocusTrap\s*\}\s*from\s*["']\.\.\/utils\/useFocusTrap["']/);
    });

    it("calls useFocusTrap(true, onClose) in both mobile and desktop panel components", () => {
      const mobileRef = modalSrc.match(/MobileModalPanel[\s\S]*?useFocusTrap<HTMLElement>\(true, onClose\)/);
      const desktopRef = modalSrc.match(/DesktopModalPanel[\s\S]*?useFocusTrap<HTMLElement>\(true, onClose\)/);
      expect(mobileRef, "expected mobile modal to use focus trap").toBeTruthy();
      expect(desktopRef, "expected desktop modal to use focus trap").toBeTruthy();
    });

    it("uses aria-labelledby pointing to a title id", () => {
      expect(modalSrc).toMatch(/aria-labelledby=\{titleId\}/);
      expect(modalSrc).toMatch(/<h2 id=\{titleId\}/);
    });
  });

  describe("BottomTabBar ARIA polish", () => {
    it("sets aria-current=page on the active tab", () => {
      expect(barSrc).toMatch(/aria-current=\{active\s*\?\s*["']page["']\s*:\s*undefined\}/);
    });
  });
});
