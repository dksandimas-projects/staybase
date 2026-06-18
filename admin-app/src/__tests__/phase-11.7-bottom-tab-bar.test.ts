import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const barSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/BottomTabBar.tsx"),
  "utf8"
);
const layoutSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/AdminLayout.tsx"),
  "utf8"
);

describe("Phase 11.7 — Bottom tab bar (P1)", () => {
  describe("BottomTabBar component", () => {
    it("exists at admin-app/src/components/BottomTabBar.tsx", () => {
      expect(barSrc).toMatch(/export function BottomTabBar/);
    });

    it("uses useBreakpoint to gate on isMobile", () => {
      expect(barSrc).toMatch(/useBreakpoint/);
      expect(barSrc).toMatch(/if\s*\(\s*!isMobile\s*\)\s*return\s+null/);
    });

    it("uses navigate from react-router-dom for tab clicks", () => {
      expect(barSrc).toMatch(/useNavigate/);
      expect(barSrc).toMatch(/navigate\(tab\.path\)/);
    });

    it("renders role=tablist with aria-label", () => {
      expect(barSrc).toMatch(/role\s*=\s*["']tablist["']/);
      expect(barSrc).toMatch(/aria-label\s*=\s*["']Quick operational navigation["']/);
    });

    it("each tab has role=tab with aria-selected + aria-current", () => {
      expect(barSrc).toMatch(/role\s*=\s*["']tab["']/);
      expect(barSrc).toMatch(/aria-selected=\{active\}/);
      expect(barSrc).toMatch(/aria-current=\{active\s*\?\s*["']page["']\s*:\s*undefined\}/);
    });

    it("is fixed at the bottom of the viewport with safe-area-inset", () => {
      expect(barSrc).toMatch(/fixed\s+inset-x-0\s+bottom-0/);
      expect(barSrc).toMatch(/env\(safe-area-inset-bottom\)/);
    });

    it("supports a variant prop that switches the last tab between Alerts and Settings", () => {
      expect(barSrc).toMatch(/variant\?:\s*["']bookings["']\s*\|\s*["']settings["']/);
      expect(barSrc).toMatch(/ALERTS_TAB/);
      expect(barSrc).toMatch(/SETTINGS_TAB/);
    });

    it("shows an unread badge on the Alerts tab when unreadAlertCount > 0", () => {
      expect(barSrc).toMatch(/unreadAlertCount/);
      expect(barSrc).toMatch(/showBadge\s*=\s*tab\.id\s*===\s*["']alerts["']\s*&&\s*unreadAlertCount\s*>\s*0/);
    });

    it("defines Arrivals / Departures / In-House tabs as the base set", () => {
      expect(barSrc).toMatch(/id:\s*["']arrivals["']/);
      expect(barSrc).toMatch(/id:\s*["']departures["']/);
      expect(barSrc).toMatch(/id:\s*["']in-house["']/);
    });
  });

  describe("AdminLayout mounts BottomTabBar", () => {
    it("imports BottomTabBar", () => {
      expect(layoutSrc).toMatch(/import\s*\{\s*BottomTabBar\s*\}\s*from\s*["']\.\/BottomTabBar["']/);
    });

    it("renders <BottomTabBar /> with the variant derived from the route", () => {
      expect(layoutSrc).toMatch(/<BottomTabBar\s+variant=\{bottomTabVariant\}/);
      expect(layoutSrc).toMatch(/bottomTabVariant\s*=\s*location\.pathname\s*===\s*["']\/settings["']\s*\?\s*["']settings["']\s*:\s*["']bookings["']/);
    });

    it("passes unreadAlertCount derived from intercoms", () => {
      expect(layoutSrc).toMatch(/unreadAlertCount=\{unreadAlertCount\}/);
      expect(layoutSrc).toMatch(/Object\.values\(intercoms\)/);
    });

    it("adds bottom padding to <main> on mobile so content is not hidden under the bar", () => {
      expect(layoutSrc).toMatch(/paddingBottom:\s*isMobile\s*\?\s*["']max\(5rem, calc\(56px/);
    });
  });
});
