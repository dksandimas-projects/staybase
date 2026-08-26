import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.7 — Admin Mobile UX (P0 foundations).
//
// Guards:
//   - useBreakpoint hook exists with the correct API
//   - Sidebar reads useBreakpoint and implements the three-mode behavior
//     (mobile slide-in / tablet icon-only / desktop full)
//   - AdminLayout passes isOpen/onClose to Sidebar, renders a hamburger
//     button on mobile with the right a11y attributes
//   - <meta name="viewport"> declares viewport-fit=cover (iOS safe areas)

const useBreakpointSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/utils/useBreakpoint.ts"),
  "utf8"
);
const sidebarSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Sidebar.tsx"),
  "utf8"
);
const layoutSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/AdminLayout.tsx"),
  "utf8"
);
const indexHtml = readFileSync(
  resolve(__dirname, "../../../admin-app/index.html"),
  "utf8"
);
const sharedAnimSrc = readFileSync(
  resolve(__dirname, "../../../shared/animations.ts"),
  "utf8"
);

describe("Phase 11.7 — Admin Mobile UX (P0 foundations)", () => {
  describe("useBreakpoint hook", () => {
    it("exists at admin-app/src/utils/useBreakpoint.ts", () => {
      expect(useBreakpointSrc).toMatch(/export function useBreakpoint/);
    });

    it("returns the full BreakpointState shape", () => {
      // The hook must expose isMobile, isTablet, isDesktop, isMobileLandscape, width, height
      const returnType = useBreakpointSrc.match(
        /export interface BreakpointState[\s\S]*?\n\}/
      );
      expect(returnType, "expected BreakpointState interface").toBeTruthy();
      expect(returnType![0]).toMatch(/\bisMobile\b/);
      expect(returnType![0]).toMatch(/\bisTablet\b/);
      expect(returnType![0]).toMatch(/\bisDesktop\b/);
      expect(returnType![0]).toMatch(/\bisMobileLandscape\b/);
      expect(returnType![0]).toMatch(/\bwidth\b/);
      expect(returnType![0]).toMatch(/\bheight\b/);
    });

    it("uses the documented breakpoints (768 / 1024)", () => {
      // mobile < 768, tablet 768-1023, desktop >= 1024
      expect(useBreakpointSrc).toMatch(/MOBILE_MAX\s*=\s*768/);
      expect(useBreakpointSrc).toMatch(/TABLET_MAX\s*=\s*1024/);
    });

    it("subscribes to window resize and cleans up the listener", () => {
      expect(useBreakpointSrc).toMatch(/addEventListener\(\s*["']resize["']/);
      expect(useBreakpointSrc).toMatch(/removeEventListener\(\s*["']resize["']/);
    });
  });

  describe("Sidebar — three-mode responsive behavior", () => {
    it("imports useBreakpoint", () => {
      expect(sidebarSrc).toMatch(/import\s*\{[^}]*useBreakpoint[^}]*\}\s*from\s*["']\.\.\/utils\/useBreakpoint["']/);
    });

    it("accepts isOpen and onClose props (mobile slide-in)", () => {
      const propsBlock = sidebarSrc.match(/interface SidebarProps[\s\S]*?\n\}/);
      expect(propsBlock, "expected SidebarProps interface").toBeTruthy();
      expect(propsBlock![0]).toMatch(/\bisOpen\?:\s*boolean\b/);
      expect(propsBlock![0]).toMatch(/\bonClose\?:\s*\(\)\s*=>\s*void\b/);
    });

    it("branches on isMobile for the slide-in drawer", () => {
      expect(sidebarSrc).toMatch(/if\s*\(\s*isMobile\s*\)/);
    });

    it("branches on isTablet for the icon-only column", () => {
      expect(sidebarSrc).toMatch(/if\s*\(\s*isTablet\s*\)/);
    });

    it("uses AnimatePresence + slideInLeft for the mobile panel", () => {
      expect(sidebarSrc).toMatch(/AnimatePresence/);
      expect(sidebarSrc).toMatch(/slideInLeft/);
    });

    it("locks body scroll while the mobile drawer is open", () => {
      expect(sidebarSrc).toMatch(/document\.body\.style\.overflow\s*=\s*["']hidden["']/);
    });

    it("closes on ESC while the mobile drawer is open (via useFocusTrap)", () => {
      // Escape handling now lives in useFocusTrap (useFocusTrap.ts).
      // Verify the hook is imported and wired to onClose so that pressing
      // Escape inside the open mobile sidebar closes it.
      expect(sidebarSrc).toMatch(/import\s*\{\s*useFocusTrap\s*\}\s*from\s*["']\.\.\/utils\/useFocusTrap["']/);
      expect(sidebarSrc).toMatch(/useFocusTrap<HTMLElement>\(isOpen,\s*\(\)\s*=>\s*onClose\?\.\(\)\)/);
      expect(sidebarSrc).toMatch(/ref=\{trapRef\}/);
    });

    it("auto-closes on route change (pathname) while open on mobile", () => {
      // The auto-close effect must depend on location.pathname.
      expect(sidebarSrc).toMatch(/location\.pathname/);
    });

    it("auto-close effect does NOT depend on isOpen (regression: hamburger must not close itself)", () => {
      // Bug fix: previously the effect dep array included isOpen, so
      // the effect fired when the user opened the sidebar (isOpen:
      // false -> true) and immediately called onClose(), making the
      // sidebar appear to not open. The fix uses a prevPathnameRef
      // and only fires on actual pathname changes.
      expect(sidebarSrc).toMatch(/prevPathnameRef\.current\s*=\s*location\.pathname/);
      expect(sidebarSrc).toMatch(/location\.pathname\s*===\s*prevPathnameRef\.current/);
    });

    it("uses role/aria attributes for the mobile drawer", () => {
      expect(sidebarSrc).toMatch(/role\s*=\s*["']dialog["']/);
      expect(sidebarSrc).toMatch(/aria-modal\s*=\s*["']true["']/);
      expect(sidebarSrc).toMatch(/aria-label\s*=\s*["']Main navigation["']/);
    });
  });

  describe("AdminLayout — hamburger + sticky header", () => {
    it("passes isOpen and onClose to Sidebar", () => {
      expect(layoutSrc).toMatch(/<Sidebar[\s\S]*?isOpen\s*=\s*\{isMobileSidebarOpen\}/);
      expect(layoutSrc).toMatch(/onClose\s*=\s*\{\s*\(\)\s*=>\s*setMobileSidebarOpen\(false\)\s*\}/);
    });

    it("renders a hamburger button on mobile with a11y attributes", () => {
      expect(layoutSrc).toMatch(/aria-label\s*=\s*["']Open navigation menu["']/);
      expect(layoutSrc).toMatch(/aria-expanded\s*=\s*\{isMobileSidebarOpen\}/);
      expect(layoutSrc).toMatch(/aria-controls\s*=\s*["']admin-sidebar["']/);
    });

    it("uses responsive header padding (sm:px-6 lg:px-8, sm:py-4)", () => {
      expect(layoutSrc).toMatch(/sm:px-6[^"]*lg:px-8/);
      expect(layoutSrc).toMatch(/sm:py-4/);
    });

    it("renders a centered brand wordmark on mobile (per Stitch mobile design)", () => {
      // The mobile header centers the "spark inn" wordmark between the
      // hamburger and the right-side action, per the Stitch mobile designs.
      //
      // Per decision #225 (2026-08-26): the historical size was
      // `text-lg` (18px) but that overflowed the 151px center slot
      // on a 375px viewport, visually colliding with the right-zone
      // icons. The current contract uses `text-sm` + `tracking-tight`
      // so "spark inn" measures ~110px and fits cleanly. The test
      // pins the new size + the centered absolute positioning +
      // the primary color (which must stay - it's the brand signal).
      expect(layoutSrc).toMatch(/absolute\s+left-1\/2[^"]*-translate-x-1\/2/);
      expect(layoutSrc).toMatch(/font-heading[^"]*text-sm[^"]*tracking-tight[^"]*text-primary/);
    });

    it("hides the Operational Dashboard label on mobile", () => {
      // The "Operational Dashboard" label is rendered inside a ternary that
      // branches on isMobile — true branch is the hamburger button, false
      // branch (tablet+) shows the label. Confirm the label is wrapped in
      // the !isMobile branch.
      const ternaryMatch = layoutSrc.match(/isMobile\s*\?\s*\([\s\S]*?\)\s*:\s*\([\s\S]*?Operational Dashboard[\s\S]*?\)/);
      expect(ternaryMatch, "expected Operational Dashboard in the !isMobile branch").toBeTruthy();
    });

    it("uses responsive main padding (p-4 sm:p-6 lg:p-8)", () => {
      expect(layoutSrc).toMatch(/p-4[^"]*sm:p-6[^"]*lg:p-8/);
    });

    it("uses safe-area-inset for iOS notched devices", () => {
      expect(layoutSrc).toMatch(/env\(safe-area-inset-/);
    });

    it("sets the header to sticky on mobile", () => {
      expect(layoutSrc).toMatch(/sticky\s+top-0/);
    });
  });

  describe("index.html — viewport-fit=cover for iOS safe areas", () => {
    it("declares viewport-fit=cover in the viewport meta", () => {
      expect(indexHtml).toMatch(/<meta\s+name=["']viewport["'][^>]*viewport-fit=cover/);
    });
  });

  describe("shared/animations.ts — slideInLeft variant", () => {
    it("exports a slideInLeft variant matching the existing pattern", () => {
      expect(sharedAnimSrc).toMatch(/export const slideInLeft\s*=/);
      const block = sharedAnimSrc.match(/export const slideInLeft\s*=\s*\{[\s\S]*?\};/);
      expect(block, "expected slideInLeft definition").toBeTruthy();
      expect(block![0]).toMatch(/opacity:\s*0,\s*x:\s*-48/);
      expect(block![0]).toMatch(/opacity:\s*1,\s*x:\s*0/);
    });
  });
});
