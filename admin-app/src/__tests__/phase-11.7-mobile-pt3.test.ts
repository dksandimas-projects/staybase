import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sidebarSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Sidebar.tsx"),
  "utf8"
);
const settingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);
const reportsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/ReportsPage.tsx"),
  "utf8"
);
const ratesSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/RatesPage.tsx"),
  "utf8"
);

describe("Phase 11.7 P3 — remaining mobile responsive work", () => {
  describe("Sidebar focus trap (replaces manual Escape handler)", () => {
    it("imports useFocustrap from utils", () => {
      expect(sidebarSrc).toMatch(
        /import\s*\{\s*useFocusTrap\s*\}\s*from\s*["']\.\.\/utils\/useFocusTrap["']/
      );
    });

    it("calls useFocusTrap with isOpen + onClose", () => {
      expect(sidebarSrc).toMatch(
        /useFocusTrap<HTMLElement>\(isOpen,\s*\(\)\s*=>\s*onClose\?\.\(\)\)/
      );
    });

    it("applies the trap ref to the mobile motion.aside", () => {
      expect(sidebarSrc).toMatch(/ref=\{trapRef\}/);
    });

    it("no longer has the manual document keydown listener for Escape", () => {
      // The old useEffect that registered a keydown listener for Escape
      // directly on `window` should be gone — useFocusTrap owns that now.
      expect(sidebarSrc).not.toMatch(/window\.addEventListener\(["']keydown["']/);
      expect(sidebarSrc).not.toMatch(/window\.removeEventListener\(["']keydown["']/);
    });
  });

  describe("Settings — room-types + staff-accounts tables → mobile card view", () => {
    it("uses useBreakpoint in SettingsPage", () => {
      expect(settingsSrc).toMatch(
        /import\s*\{\s*useBreakpoint\s*\}\s*from\s*["']\.\.\/utils\/useBreakpoint["']/
      );
      expect(settingsSrc).toMatch(/const\s*\{\s*isMobile\s*\}\s*=\s*useBreakpoint\(\)/);
    });

    it("room-types table has a card-list branch on mobile", () => {
      const cardBlock = settingsSrc.match(
        /isMobile\s*\?\s*\(\s*<ul[\s\S]*?roomTypes\.map[\s\S]*?<\/ul>/
      );
      expect(cardBlock, "expected mobile card list for room types").toBeTruthy();
    });

    it("staff-accounts table has a card-list branch on mobile", () => {
      const cardBlock = settingsSrc.match(
        /isMobile\s*\?\s*\(\s*<ul[\s\S]*?staff\.map[\s\S]*?<\/ul>/
      );
      expect(cardBlock, "expected mobile card list for staff accounts").toBeTruthy();
    });

    it("preserves the desktop table branches for tablet+", () => {
      expect(settingsSrc).toMatch(
        /<table className="min-w-full divide-y divide-gray-150 text-xs">/
      );
    });
  });

  describe("Reports — 4 raw tables → mobile card view", () => {
    it("uses useBreakpoint in ReportsPage", () => {
      expect(reportsSrc).toMatch(
        /import\s*\{\s*useBreakpoint\s*\}\s*from\s*["']\.\.\/utils\/useBreakpoint["']/
      );
      expect(reportsSrc).toMatch(/const\s*\{\s*isMobile\s*\}\s*=\s*useBreakpoint\(\)/);
    });

    it("passes isMobile to SalesBookingsTable / SalesBreakfastTable / SalesStoreOrdersTable", () => {
      expect(reportsSrc).toMatch(/<SalesBookingsTable[\s\S]*?isMobile=\{isMobile\}/);
      expect(reportsSrc).toMatch(/<SalesBreakfastTable[\s\S]*?isMobile=\{isMobile\}/);
      expect(reportsSrc).toMatch(/<SalesStoreOrdersTable[\s\S]*?isMobile=\{isMobile\}/);
    });

    it("forwards isMobile through the SalesTab sub-component", () => {
      expect(reportsSrc).toMatch(/<SalesTab[\s\S]*?isMobile=\{isMobile\}/);
      expect(reportsSrc).toMatch(/function SalesTab\(props:\s*\{[\s\S]*?isMobile:\s*boolean/);
    });

    it("all 3 sales sub-tables branch on isMobile and render card lists when true", () => {
      // Each sub-table: function signature accepts isMobile, has an
      // `if (isMobile) { return (<div className="space-y-3"> ...) }` block,
      // then a desktop <table className="min-w-full text-xs border-collapse">.
      const branches = [
        /function SalesBookingsTable[\s\S]*?if\s*\(isMobile\)\s*\{\s*return\s*\([\s\S]*?<div className="space-y-3">[\s\S]*?\}\s*return\s*\([\s\S]*?overflow-x-auto/,
        /function SalesBreakfastTable[\s\S]*?if\s*\(isMobile\)\s*\{\s*return\s*\([\s\S]*?<div className="space-y-3">[\s\S]*?\}\s*return\s*\([\s\S]*?overflow-x-auto/,
        /function SalesStoreOrdersTable[\s\S]*?if\s*\(isMobile\)\s*\{\s*return\s*\([\s\S]*?<div className="space-y-3">[\s\S]*?\}\s*return\s*\([\s\S]*?overflow-x-auto/
      ];
      for (const r of branches) {
        expect(reportsSrc.match(r), `expected isMobile card branch in ${r}`).toBeTruthy();
      }
    });

    it("Daily Kitchen Prep Report has a mobile card branch", () => {
      // The kitchen prep table is inline in the page (not a sub-component).
      // Verify the ternary: isMobile ? <div className="space-y-3"> cards : <table>
      const cardBlock = reportsSrc.match(
        /isMobile\s*\?\s*\(\s*<div className="space-y-3">[\s\S]*?dailyKitchenPrep\.dates\.map[\s\S]*?<\/div>/
      );
      expect(cardBlock, "expected mobile card list for kitchen prep").toBeTruthy();
    });
  });

  describe("Rates — room-pricing grid → per-room rate cards on mobile", () => {
    it("uses useBreakpoint in RatesPage", () => {
      expect(ratesSrc).toMatch(
        /import\s*\{\s*useBreakpoint\s*\}\s*from\s*["']\.\.\/utils\/useBreakpoint["']/
      );
      expect(ratesSrc).toMatch(/const\s*\{\s*isMobile\s*\}\s*=\s*useBreakpoint\(\)/);
    });

    it("room-pricing grid has a mobile card branch", () => {
      const cardBlock = ratesSrc.match(
        /isMobile\s*\?\s*\(\s*<div className="space-y-3">[\s\S]*?roomTypes\.map[\s\S]*?<\/div>\s*\)/
      );
      expect(cardBlock, "expected mobile card list for room pricing").toBeTruthy();
    });

    it("mobile rate card contains all 3 numeric inputs (base / weekend / corporate)", () => {
      const card = ratesSrc.match(
        /isMobile\s*\?\s*\(\s*<div className="space-y-3">[\s\S]*?roomTypes\.map[\s\S]*?<\/div>\s*\)/
      );
      expect(card).toBeTruthy();
      if (card) {
        const text = card[0];
        // Three <input type="number"> with values bound to base/weekend/corporate.
        const inputCount = (text.match(/<input\s+type="number"/g) || []).length;
        expect(inputCount).toBe(3);
        expect(text).toMatch(/prices\[type\.value\]\?\.base/);
        expect(text).toMatch(/prices\[type\.value\]\?\.weekend/);
        expect(text).toMatch(/prices\[type\.value\]\?\.corporate/);
      }
    });

    it("mobile rate card has 44px min-height inputs", () => {
      const card = ratesSrc.match(
        /isMobile\s*\?\s*\(\s*<div className="space-y-3">[\s\S]*?roomTypes\.map[\s\S]*?<\/div>\s*\)/
      );
      expect(card).toBeTruthy();
      if (card) {
        const inputCount = (card[0].match(/min-h-\[44px\]/g) || []).length;
        expect(inputCount).toBeGreaterThanOrEqual(3);
      }
    });

    it("preserves the desktop table for tablet+", () => {
      expect(ratesSrc).toMatch(
        /<table className="min-w-full divide-y divide-gray-150 text-xs">/
      );
    });
  });
});
