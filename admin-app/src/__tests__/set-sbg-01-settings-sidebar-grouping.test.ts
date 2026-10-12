import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);

/**
 * SET-SBG-01 (settings-sidebar-grouping, 2026-10-12) contract —
 * the 18 settings tabs are clustered into 5 stakeholder-oriented
 * groups so the desktop sidebar can collapse/expand per group
 * instead of dumping every item into one 18-row list.
 *
 * The tests below are source-text guards (per CONTRIBUTING.md
 * §Testing — cheap, deterministic, no emulator). Each tripwire
 * pins one contract point so a future refactor that breaks the
 * grouping invariant fails loudly.
 */

// Group definition mirrors the source-of-truth array. If a future
// refactor moves the constant somewhere else, these tripwires fail
// on the file path itself.
const EXPECTED_GROUP_LABELS = [
  "Property",
  "Bookings & Revenue",
  "Guest Experience",
  "Marketing & Reach",
  "Admin"
];

// Every TabId currently registered in `VALID_TAB_IDS` must appear
// in exactly one group — the union must cover the whitelist with
// no duplicates. Duplicates would mean a tab renders twice in the
// sidebar (UX bug); a missing tab means the deep-link falls back
// to "hotel" silently (the SETTINGS.md §Deep Linking invariant).
const EXPECTED_GROUP_TABS: Record<string, string[]> = {
  Property: ["hotel", "roomtypes", "branding"],
  "Bookings & Revenue": ["preferences", "sources", "holds", "payment", "discounts"],
  "Guest Experience": ["rewards", "breakfast", "store", "intercom"],
  "Marketing & Reach": ["website", "seo", "email"],
  Admin: ["staff", "legal", "environment"]
};

describe("SET-SBG-01 — Settings sidebar grouping", () => {
  it("declares the SETTINGS_GROUPS constant with exactly 5 groups", () => {
    expect(settingsPageSrc).toMatch(/const\s+SETTINGS_GROUPS[\s\S]*?readonly\s+SettingsGroup\[\]\s*=/);
    const groupsBlock = settingsPageSrc.match(/const\s+SETTINGS_GROUPS[\s\S]*?\n\];/);
    expect(groupsBlock).toBeTruthy();
    for (const label of EXPECTED_GROUP_LABELS) {
      expect(groupsBlock![0], `missing group "${label}"`).toContain(`label: "${label}"`);
    }
  });

  it("covers every deep-linkable TabId exactly once across the groups", () => {
    const groupsBlock = settingsPageSrc.match(/const\s+SETTINGS_GROUPS[\s\S]*?\n\];/);
    expect(groupsBlock).toBeTruthy();
    const union: string[] = [];
    for (const label of EXPECTED_GROUP_LABELS) {
      const expectedTabs = EXPECTED_GROUP_TABS[label];
      for (const tabId of expectedTabs) {
        // Each tab id appears literally inside the groups array.
        expect(groupsBlock![0], `group "${label}" missing tab "${tabId}"`).toMatch(
          new RegExp(`"${tabId}"`)
        );
        union.push(tabId);
      }
    }
    const unique = new Set(union);
    expect(unique.size, "duplicate tab id across groups").toBe(union.length);
    expect(union.length, "group union must cover all 18 tabs").toBe(18);
  });

  it("persists the user's collapsed-group choice in localStorage under a versioned key", () => {
    expect(settingsPageSrc).toContain(
      'const SETTINGS_GROUPS_COLLAPSED_STORAGE_KEY = "settings.sidebar.collapsedGroups.v1"'
    );
    expect(settingsPageSrc).toMatch(
      /window\.localStorage\.(?:getItem|setItem)\([\s\S]*?SETTINGS_GROUPS_COLLAPSED_STORAGE_KEY/
    );
    expect(settingsPageSrc).toMatch(
      /window\.localStorage\.setItem\(\s*SETTINGS_GROUPS_COLLAPSED_STORAGE_KEY/
    );
  });

  it("forces the active group to stay expanded regardless of the persisted choice", () => {
    // Auto-expand effect: removing the active group id from the
    // collapsed set on every activeTab change.
    expect(settingsPageSrc).toMatch(
      /const activeGroupId = groupOfTab\(activeTab\)/
    );
    expect(settingsPageSrc).toMatch(
      /next\s*=\s*prev\.filter\(\(id\)\s*=>\s*id\s*!==\s*activeGroupId\)/
    );
  });

  it("disables collapsing the active group's header so the operator can't lose their place", () => {
    // The desktop sidebar uses `isActiveGroup` to short-circuit the
    // toggle — clicking the active header is a no-op. Visual cue:
    // `cursor-default` on the active group.
    expect(settingsPageSrc).toMatch(
      /isActiveGroup\s*\?\s*"text-gray-700\s+cursor-default"\s*:\s*"text-gray-500/
    );
    expect(settingsPageSrc).toMatch(
      /if\s*\(\s*isActiveGroup\s*\)\s*return;\s*\n\s*toggleGroup\(group\.id\)/
    );
  });

  it("renders the desktop <aside> from SETTINGS_GROUPS, not from the flat tabs array", () => {
    // The aside block uses `SETTINGS_GROUPS.map(...)` with nested
    // `<div role="group">` containers keyed by group id. The old
    // `tabs.map(...)` inside the aside is gone.
    const asideStart = settingsPageSrc.indexOf('<aside className="hidden lg:block rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 h-fit"');
    expect(asideStart).toBeGreaterThan(-1);
    const asideEnd = settingsPageSrc.indexOf("</aside>", asideStart);
    const asideBlock = settingsPageSrc.slice(asideStart, asideEnd);
    expect(asideBlock).toContain("SETTINGS_GROUPS.map(");
    expect(asideBlock).toContain('role="group"');
    expect(asideBlock).toContain("aria-expanded={!isCollapsed}");
    expect(asideBlock).toContain("aria-controls={`settings-group-${group.id}`}");
    expect(asideBlock).not.toMatch(/^\s*\{tabs\.map\(/m);
  });

  it("inserts visual dividers between groups in the mobile pill bar", () => {
    const mobileBarStart = settingsPageSrc.indexOf('<div ref={tabBarRef}');
    expect(mobileBarStart).toBeGreaterThan(-1);
    const mobileBarBlock = settingsPageSrc.slice(
      mobileBarStart,
      settingsPageSrc.indexOf("</div>\n      </div>", mobileBarStart)
    );
    expect(mobileBarBlock).toContain("SETTINGS_GROUPS.flatMap(");
    expect(mobileBarBlock).toContain('aria-hidden="true"');
    expect(mobileBarBlock).toContain('groupIdx === SETTINGS_GROUPS.length - 1');
    expect(mobileBarBlock).toMatch(/h-5 w-px shrink-0 bg-gray-200/);
  });

  it("uses 44px minimum touch targets on the nested tab buttons inside each group", () => {
    expect(settingsPageSrc).toMatch(
      /w-full min-h-\[44px\] flex items-center gap-3 pl-9 pr-3 rounded-lg text-xs font-bold/
    );
  });
});
