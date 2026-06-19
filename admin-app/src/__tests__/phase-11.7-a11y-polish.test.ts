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

  describe("Drawer — desktop right-side positioning (regression: W3.6 / Phase 11.8)", () => {
    // Per `plan/admin-app/CLAUDE.md §Layout`: the desktop drawer is a
    // 240–480px right-side panel. Before the Phase 11.7 refactor the
    // aside was a child of the fixed-positioned backdrop and inherited
    // its positioning. The refactor made it a sibling, so the panel
    // now needs `fixed inset-y-0 right-0` (or equivalent) on a static
    // wrapper to stay pinned to the right edge — otherwise it falls
    // into the document flow and renders in the lower-right of the
    // page content.

    it("DesktopDrawerPanel has a positioning wrapper with fixed right-0 + z-50", () => {
      const block = drawerSrc.match(/function DesktopDrawerPanel[\s\S]*?^}\s*$/m);
      expect(block, "expected DesktopDrawerPanel definition").toBeTruthy();
      const body = block![0];
      expect(body).toMatch(/fixed/);
      expect(body).toMatch(/right-0/);
      expect(body).toMatch(/z-50/);
    });

    it("DesktopDrawerPanel wrapper owns the consumer's className (width, etc.)", () => {
      const block = drawerSrc.match(/function DesktopDrawerPanel[\s\S]*?^}\s*$/m);
      expect(block, "expected DesktopDrawerPanel definition").toBeTruthy();
      // The max-w-[480px] default lives on the wrapper so the panel
      // doesn't reflow when Framer animates the inner motion.aside.
      expect(block![0]).toMatch(/max-w-\[480px\]/);
    });

    it("the motion.aside inside DesktopDrawerPanel no longer owns the positioning classes", () => {
      const block = drawerSrc.match(/function DesktopDrawerPanel[\s\S]*?^}\s*$/m);
      expect(block, "expected DesktopDrawerPanel definition").toBeTruthy();
      const motionBlock = block![0].match(/<motion\.aside[\s\S]*?>/);
      expect(motionBlock, "expected motion.aside opening tag").toBeTruthy();
      expect(motionBlock![0]).not.toMatch(/fixed/);
      expect(motionBlock![0]).not.toMatch(/right-0/);
    });

    it("MobileDrawerPanel still anchors to the bottom of the viewport on mobile", () => {
      const block = drawerSrc.match(/function MobileDrawerPanel[\s\S]*?^}\s*$/m);
      expect(block, "expected MobileDrawerPanel definition").toBeTruthy();
      const body = block![0];
      expect(body).toMatch(/fixed/);
      expect(body).toMatch(/inset-x-0/);
      expect(body).toMatch(/bottom-0/);
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

  describe("Modal — desktop centering (regression: W3.6 / Phase 11.8)", () => {
    // Per `plan/docs/FRONTEND.md §Modals`: desktop modals are centered via
    // `top-1/2 left-1/2` with a -50% / -50% translate. The translate MUST
    // live on a STATIC wrapper, NOT on the motion.section — Framer Motion
    // composes its own `transform` property for the `scaleIn` variant,
    // which would otherwise override any Tailwind translate class on the
    // motion element and drop the modal into the lower-right quadrant of
    // the viewport. The fix wraps the motion.section in a div that owns
    // the positioning, so the two concerns never collide.

    it("DesktopModalPanel has a positioning wrapper with top-1/2 + left-1/2 + -translate-x-1/2 + -translate-y-1/2", () => {
      const block = modalSrc.match(/function DesktopModalPanel[\s\S]*?^}\s*$/m);
      expect(block, "expected DesktopModalPanel definition").toBeTruthy();
      const body = block![0];
      // The wrapper div uses cn(...) with the centering classes. Check the
      // full function body for each of the four required Tailwind tokens.
      expect(body).toMatch(/top-1\/2/);
      expect(body).toMatch(/left-1\/2/);
      expect(body).toMatch(/-translate-x-1\/2/);
      expect(body).toMatch(/-translate-y-1\/2/);
    });

    it("the motion.section inside DesktopModalPanel no longer carries the translate classes", () => {
      // The translate must live on the wrapper, not the motion element —
      // otherwise Framer's transform composition drops the modal into the
      // lower-right corner of the viewport.
      const block = modalSrc.match(/function DesktopModalPanel[\s\S]*?^}\s*$/m);
      expect(block, "expected DesktopModalPanel definition").toBeTruthy();
      const motionBlock = block![0].match(/<motion\.section[\s\S]*?>/);
      expect(motionBlock, "expected motion.section opening tag").toBeTruthy();
      expect(motionBlock![0]).not.toMatch(/-translate-x-1\/2/);
      expect(motionBlock![0]).not.toMatch(/-translate-y-1\/2/);
    });

    it("DesktopModalPanel still calls useFocusTrap(true, onClose)", () => {
      const block = modalSrc.match(/function DesktopModalPanel[\s\S]*?^}\s*$/m);
      expect(block, "expected DesktopModalPanel definition").toBeTruthy();
      expect(block![0]).toMatch(/useFocusTrap<HTMLElement>\(true, onClose\)/);
      expect(block![0]).toMatch(/ref=\{trapRef\}/);
    });
  });

  describe("BottomTabBar ARIA polish", () => {
    it("sets aria-current=page on the active tab", () => {
      expect(barSrc).toMatch(/aria-current=\{active\s*\?\s*["']page["']\s*:\s*undefined\}/);
    });
  });
});
