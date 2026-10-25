// QA-2026-10-23 §3.11 — the front desk was shown the SAME
// navigation as the admin (`Dashboard | Bookings | Calendar | Rooms |
// Rates | Reports | Kitchen List | Corporate | Intercom | QR |
// Members | Settings`), and every admin-only destination in that
// list answers "ACCESS DENIED — administrative clearance required"
// for the front-desk role.
//
// The route guard was always correct; the nav was the bug. These
// guards pin the role filter (unit) and its wiring (source text),
// and pin that the guard in `AdminLayout` is untouched.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visibleNavItemsForRole } from "../components/Sidebar";

const sidebar = readFileSync(resolve(__dirname, "../components/Sidebar.tsx"), "utf8");
const layout = readFileSync(resolve(__dirname, "../components/AdminLayout.tsx"), "utf8");
const bottomTabBar = readFileSync(resolve(__dirname, "../components/BottomTabBar.tsx"), "utf8");

const pathsOf = (items: { to: string }[]) => items.map((item) => item.to);

const ADMIN_PATHS = [
  "/",
  "/bookings",
  "/calendar",
  "/rooms",
  "/rates",
  "/reports",
  "/kitchen-list",
  "/corporate",
  "/intercom",
  "/qr",
  "/members",
  "/settings"
];

describe("QA-2026-10-23 §3.11 — the admin nav is role-filtered", () => {
  it("keeps the full navigation for admin (unchanged)", () => {
    expect(pathsOf(visibleNavItemsForRole("admin"))).toEqual(ADMIN_PATHS);
  });

  it("omits the admin-only destinations for front-desk staff", () => {
    const frontDeskPaths = pathsOf(visibleNavItemsForRole("front-desk"));
    expect(frontDeskPaths).not.toContain("/rates");
    expect(frontDeskPaths).not.toContain("/members");
    expect(frontDeskPaths).not.toContain("/settings");
    // Everything else the desk can actually use stays.
    expect(frontDeskPaths).toEqual([
      "/",
      "/bookings",
      "/calendar",
      "/rooms",
      "/reports",
      "/kitchen-list",
      "/corporate",
      "/intercom",
      "/qr"
    ]);
  });

  it("treats a signed-out / unknown role as the least-privileged nav", () => {
    expect(pathsOf(visibleNavItemsForRole(null))).not.toContain("/settings");
    expect(pathsOf(visibleNavItemsForRole(undefined))).not.toContain("/settings");
  });

  it("reads the staff role from the admin context", () => {
    expect(sidebar).toMatch(/const\s*\{\s*intercoms,\s*currentUser\s*\}\s*=\s*useAdmin\(\)/);
    expect(sidebar).toMatch(/visibleNavItemsForRole\(currentUser\?\.role\)/);
    // The nav must render the filtered list, not the raw one.
    expect(sidebar).toMatch(/items=\{visibleNavItems\}/);
    expect(sidebar).toMatch(/\{items\.map\(\(item\)/);
  });

  it("filters exactly the destinations the route guard refuses", () => {
    // The nav filter and the route guard must name the same paths —
    // otherwise the nav advertises a dead end (or hides a page the
    // guard allows).
    const guardMatch = layout.match(/const restrictedPaths = \[([^\]]+)\]/);
    expect(guardMatch, "expected AdminLayout's restrictedPaths list").toBeTruthy();
    const guardPaths = [...guardMatch![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);

    const navMatch = sidebar.match(/const ADMIN_ONLY_NAV_PATHS = \[([^\]]+)\]/);
    expect(navMatch, "expected Sidebar's ADMIN_ONLY_NAV_PATHS list").toBeTruthy();
    const navPaths = [...navMatch![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);

    expect(navPaths.sort()).toEqual([...guardPaths].sort());
    expect(navPaths.sort()).toEqual(["/members", "/rates", "/settings"]);
  });

  it("leaves the route guard itself untouched", () => {
    expect(layout).toMatch(/const isPathRestricted = restrictedPaths\.includes\(normalizedPath\)/);
    expect(layout).toMatch(/const isUserRestricted = currentUser\.role !== "admin"/);
    expect(layout).toMatch(/isPathRestricted && isUserRestricted/);
  });

  it("does not offer the admin-only Settings tab in the mobile bottom bar", () => {
    expect(bottomTabBar).toMatch(
      /const lastTab = variant === "settings" && isAdmin \? SETTINGS_TAB : ALERTS_TAB;/
    );
    expect(bottomTabBar).toMatch(/const isAdmin = currentUser\?\.role === "admin"/);
  });
});
