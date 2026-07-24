// Per `plan/project/ROADMAP.md §Modal Backdrop Z-Index (MBZ)` and
// `plan/admin-app/CLAUDE.md §Z-Index Scale`: modal/drawer/sidebar
// backdrops must sit ABOVE the panel of any overlay they might be
// rendered inside (the most common case being a modal opening on top
// of the booking drawer). Pre-MBZ the backdrop was z-40 and the panel
// was z-50, so the modal backdrop was behind the drawer panel and the
// right ~480px of the viewport stayed unfaded.
//
// This test pins the new className so a future refactor that reverts
// to z-40 fails CI.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Modal backdrop z-index (MBZ)", () => {
  const modal = read("admin-app/src/components/Modal.tsx");
  const drawer = read("admin-app/src/components/Drawer.tsx");
  const sidebar = read("admin-app/src/components/Sidebar.tsx");

  it("Modal backdrop is z-[60] and bg-gray-950/60", () => {
    // The exact className string is intentionally pinned so any
    // refactor that drops the new z-index fails loudly here.
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

  it("Modal backdrop is NOT z-40 anymore (regression guard)", () => {
    const modalBackdrop = modal.match(
      /key="modal-backdrop"[\s\S]*?className="([^"]+)"/
    );
    expect(modalBackdrop?.[1]).not.toMatch(/\bz-40\b/);
    expect(modalBackdrop?.[1]).not.toMatch(/bg-gray-950\/50/);
  });

  it("Drawer backdrop is z-[60] and bg-gray-950/60", () => {
    const drawerBackdrop = drawer.match(
      /key="drawer-backdrop"[\s\S]*?className="([^"]+)"[\s\S]*?aria-hidden="true"/
    );
    expect(drawerBackdrop, "expected to find the drawer backdrop block").not.toBeNull();
    expect(drawerBackdrop?.[1]).toMatch(/z-\[60\]/);
    expect(drawerBackdrop?.[1]).toMatch(/bg-gray-950\/60/);
    expect(drawerBackdrop?.[1]).toMatch(/backdrop-blur-sm/);
  });

  it("Drawer backdrop is NOT z-40 anymore (regression guard)", () => {
    const drawerBackdrop = drawer.match(
      /key="drawer-backdrop"[\s\S]*?className="([^"]+)"/
    );
    expect(drawerBackdrop?.[1]).not.toMatch(/\bz-40\b/);
    expect(drawerBackdrop?.[1]).not.toMatch(/bg-gray-950\/50/);
  });

  it("Mobile sidebar backdrop is z-[60] and bg-gray-950/60", () => {
    const sidebarBackdrop = sidebar.match(
      /key="sidebar-backdrop"[\s\S]*?className="([^"]+)"[\s\S]*?aria-hidden="true"/
    );
    expect(sidebarBackdrop, "expected to find the sidebar backdrop block").not.toBeNull();
    expect(sidebarBackdrop?.[1]).toMatch(/z-\[60\]/);
    expect(sidebarBackdrop?.[1]).toMatch(/bg-gray-950\/60/);
  });

  it("Modal and Drawer panel stay at z-50 (so the panel still sits above its own backdrop)", () => {
    const modalPanel = modal.match(
      /z-50 flex w-full max-w-2xl -translate-x-1\/2 -translate-y-1\/2/
    );
    expect(modalPanel, "expected the desktop modal panel to still use z-50").not.toBeNull();

    const drawerPanel = drawer.match(
      /z-50 ml-auto flex h-full w-full flex-col bg-white shadow-xl/
    );
    expect(drawerPanel, "expected the desktop drawer panel to still use z-50").not.toBeNull();
  });

  it("Toast stays at z-[100] so it stays above the modal layer", () => {
    const toast = read("admin-app/src/components/Toast.tsx");
    const toastContainer = toast.match(/z-\[100\]/);
    expect(toastContainer, "Toast should keep its z-[100] above the modal/drawer backdrop").not.toBeNull();
  });
});
