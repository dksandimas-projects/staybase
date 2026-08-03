// Per `plan/project/ROADMAP.md §Modal Backdrop Z-Index (MBZ)` and
// `plan/admin-app/CLAUDE.md §Z-Index Scale`: modal/drawer/sidebar
// overlays use a TWO-TIER z-index system.
//
//   Tier 1 (z-50):  Drawer backdrop, Drawer panel, Sidebar backdrop,
//                   Sidebar panel
//   Tier 2 (z-[60]): Modal backdrop, Modal panel (mobile + desktop)
//
// Within a tier the backdrop and panel share the SAME z-index and
// rely on DOM order (backdrop rendered first, panel rendered after)
// to keep the panel on top of its own backdrop. The Modal tier sits
// one step above the Drawer/Sidebar tier, so a modal that opens on
// top of a drawer still fades the drawer panel across the full
// viewport.
//
// Why this is not a single bumped z-index on the backdrop: an earlier
// attempt set every backdrop to z-[60] while leaving every panel at
// z-50. Within a stacking context, higher z-index wins regardless of
// DOM order, so each component's own backdrop then covered its own
// panel (drawer/modal panels disappeared behind their own fade).
//
// These tests pin the two-tier shape so a refactor that re-introduces
// the inversion fails CI.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Two-tier z-index system (MBZ regression fix)", () => {
  const modal = read("admin-app/src/components/Modal.tsx");
  const drawer = read("admin-app/src/components/Drawer.tsx");
  const sidebar = read("admin-app/src/components/Sidebar.tsx");

  it("Modal backdrop is z-[60] (modal tier) with bg-gray-950/60 and backdrop-blur-sm", () => {
    const modalBackdrop = modal.match(
      /key="modal-backdrop"[\s\S]*?className="([^"]+)"[\s\S]*?aria-hidden="true"/
    );
    expect(modalBackdrop, "expected to find the modal backdrop block").not.toBeNull();
    expect(modalBackdrop?.[1]).toMatch(/z-\[60\]/);
    expect(modalBackdrop?.[1]).toMatch(/bg-gray-950\/60/);
    expect(modalBackdrop?.[1]).toMatch(/backdrop-blur-sm/);
    expect(modalBackdrop?.[1]).toMatch(/fixed/);
    expect(modalBackdrop?.[1]).toMatch(/inset-0/);
  });

  it("Modal backdrop is NOT z-40 or z-50 (must stay in the modal tier)", () => {
    const modalBackdrop = modal.match(
      /key="modal-backdrop"[\s\S]*?className="([^"]+)"/
    );
    expect(modalBackdrop?.[1]).not.toMatch(/\bz-40\b/);
    expect(modalBackdrop?.[1]).not.toMatch(/\bz-50\b/);
    expect(modalBackdrop?.[1]).not.toMatch(/bg-gray-950\/50/);
  });

  it("Modal panel (mobile + desktop) sits in the modal tier at z-[60]", () => {
    const mobilePanel = modal.match(
      /fixed inset-x-0 bottom-0 z-\[60\] flex max-h-\[95vh\]/
    );
    expect(mobilePanel, "expected the mobile modal panel to use z-[60]").not.toBeNull();

    const desktopPanel = modal.match(
      /pointer-events-auto fixed left-1\/2 top-1\/2 z-\[60\]/
    );
    expect(desktopPanel, "expected the desktop modal panel to use z-[60]").not.toBeNull();
  });

  it("Drawer backdrop shares z-50 with its panel (drawer/sidebar tier)", () => {
    const drawerBackdrop = drawer.match(
      /key="drawer-backdrop"[\s\S]*?className="([^"]+)"[\s\S]*?aria-hidden="true"/
    );
    expect(drawerBackdrop, "expected to find the drawer backdrop block").not.toBeNull();
    expect(drawerBackdrop?.[1]).toMatch(/\bz-50\b/);
    expect(drawerBackdrop?.[1]).toMatch(/bg-gray-950\/60/);
    expect(drawerBackdrop?.[1]).toMatch(/backdrop-blur-sm/);
    // Regression guard: the previous MBZ fix left the backdrop at z-[60]
    // and the panel at z-50, which inverted the per-component stacking
    // and made every drawer panel disappear behind its own fade.
    expect(drawerBackdrop?.[1]).not.toMatch(/z-\[60\]/);
  });

  it("Drawer panel (mobile + desktop) stays at z-50 (drawer/sidebar tier)", () => {
    const mobilePanel = drawer.match(
      /fixed inset-x-0 bottom-0 z-50 flex max-h-\[95vh\]/
    );
    expect(mobilePanel, "expected the mobile drawer panel to use z-50").not.toBeNull();

    const desktopPanel = drawer.match(
      /fixed inset-y-0 right-0 z-50 ml-auto/
    );
    expect(desktopPanel, "expected the desktop drawer panel to use z-50").not.toBeNull();
  });

  it("Mobile sidebar backdrop shares z-50 with its panel (drawer/sidebar tier)", () => {
    const sidebarBackdrop = sidebar.match(
      /key="sidebar-backdrop"[\s\S]*?className="([^"]+)"[\s\S]*?aria-hidden="true"/
    );
    expect(sidebarBackdrop, "expected to find the sidebar backdrop block").not.toBeNull();
    expect(sidebarBackdrop?.[1]).toMatch(/\bz-50\b/);
    expect(sidebarBackdrop?.[1]).toMatch(/bg-gray-950\/60/);
    // Regression guard: same as the drawer backdrop, must not be z-[60].
    expect(sidebarBackdrop?.[1]).not.toMatch(/z-\[60\]/);
  });

  it("Toast stays at z-[100] so it sits above the modal tier", () => {
    const toast = read("admin-app/src/components/Toast.tsx");
    const toastContainer = toast.match(/z-\[100\]/);
    expect(
      toastContainer,
      "Toast should keep its z-[100] above the modal/drawer backdrop"
    ).not.toBeNull();
  });
});
