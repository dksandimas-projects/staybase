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
//
// Per OCT-M6 (2026-10-20, decision #293): this list is NO LONGER
// the source of truth for the assertion. It used to be, and the
// test built its `union` from this hardcoded copy — so the test
// compared the hardcoded list with itself and could NEVER detect
// a source-side omission (a new `VALID_TAB_IDS` entry with no
// group, or a group tab that was deleted from the source). The
// docstring claimed "Every TabId currently registered in
// `VALID_TAB_IDS` must appear in exactly one group" while never
// reading `VALID_TAB_IDS` at all.
//
// The test now parses BOTH arrays out of the source and asserts
// the real invariant. `EXPECTED_GROUP_TABS` is kept only as a
// human-readable map of the intended grouping (the labels are
// asserted against the source), never as the assertion's input.
const EXPECTED_GROUP_TABS: Record<string, string[]> = {
  Property: ["hotel", "roomtypes", "branding"],
  "Bookings & Revenue": ["preferences", "sources", "holds", "payment", "discounts"],
  "Guest Experience": ["rewards", "breakfast", "addons", "store", "intercom"],
  "Marketing & Reach": ["website", "seo", "email"],
  Admin: ["staff", "legal", "environment"]
};

/**
 * Parse the string literals out of a JS array-literal body.
 * e.g. `"hotel", "payment", /* comment *\/ "seo"` → `["hotel", "payment", "seo"]`.
 */
function parseStringLiterals(body: string): string[] {
  const withoutComments = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const matches = withoutComments.match(/"([^"]*)"/g) || [];
  return matches.map((literal) => literal.slice(1, -1));
}

/** The `VALID_TAB_IDS` whitelist, parsed from the source. */
function readValidTabIds(): string[] {
  const block = settingsPageSrc.match(
    /const\s+VALID_TAB_IDS[^=]*=\s*\[([\s\S]*?)\n\];/
  );
  expect(block, "expected a VALID_TAB_IDS array literal in SettingsPage.tsx").toBeTruthy();
  return parseStringLiterals(block![1]);
}

/** The `SETTINGS_GROUPS` array, parsed from the source. */
function readSettingsGroups(): Array<{ id: string; label: string; tabs: string[] }> {
  const block = settingsPageSrc.match(/const\s+SETTINGS_GROUPS[\s\S]*?\n\];/);
  expect(block, "expected a SETTINGS_GROUPS array literal in SettingsPage.tsx").toBeTruthy();
  const groups: Array<{ id: string; label: string; tabs: string[] }> = [];
  const groupRe = /\{\s*id:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*,\s*tabs:\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = groupRe.exec(block![0])) !== null) {
    groups.push({
      id: match[1],
      label: match[2],
      tabs: parseStringLiterals(match[3])
    });
  }
  return groups;
}

/** The flat `tabs` metadata array (the one the render sites look up). */
function readFlatTabIds(): string[] {
  const block = settingsPageSrc.match(/const tabs = \[([\s\S]*?)\n  \];/);
  expect(block, "expected the flat tabs array literal in SettingsPage.tsx").toBeTruthy();
  const withoutComments = block![1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const ids: string[] = [];
  const idRe = /id:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = idRe.exec(withoutComments)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

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
    // Per OCT-M6 (2026-10-20, decision #293): the union is built
    // from the SOURCE (`SETTINGS_GROUPS` + `VALID_TAB_IDS`), not
    // from this file's hardcoded copy — so a new tab that is
    // missing from a group (or a group entry that was deleted)
    // now FAILS the test.
    const groups = readSettingsGroups();
    const validTabIds = readValidTabIds();

    const union: string[] = [];
    for (const group of groups) {
      union.push(...group.tabs);
    }

    // No duplicates — a duplicated tab renders twice in the
    // sidebar.
    const unique = new Set(union);
    expect(unique.size, "duplicate tab id across groups").toBe(union.length);

    // The union must cover the whitelist EXACTLY: no missing tab
    // (the deep link falls back to "hotel" silently) and no extra
    // tab (a group entry with no `VALID_TAB_IDS` entry can never
    // be deep-linked).
    const missing = validTabIds.filter((id) => !unique.has(id));
    expect(missing, "tabs in VALID_TAB_IDS with no group").toEqual([]);
    const extra = union.filter((id) => !validTabIds.includes(id));
    expect(extra, "group tabs that are not in VALID_TAB_IDS").toEqual([]);

    // The count is DERIVED, not hardcoded — the old assertion
    // pinned "18" while the real number is 19 (BR-12.1 added
    // "addons"). A hardcoded count goes stale on every new tab,
    // which is exactly what happened.
    expect(union.length, "group union must cover every valid tab id").toBe(validTabIds.length);
  });

  it("the intended grouping matches the source (labels + membership)", () => {
    // The human-readable expectation is still asserted — but
    // against the SOURCE this time, so it detects a source-side
    // change (a moved tab, a renamed group) as well.
    const groups = readSettingsGroups();
    expect(groups.map((g) => g.label)).toEqual(EXPECTED_GROUP_LABELS);
    for (const group of groups) {
      expect(group.tabs, `group "${group.label}" membership`).toEqual(
        EXPECTED_GROUP_TABS[group.label]
      );
    }
  });

  it("every grouped tab has a matching entry in the flat `tabs` metadata", () => {
    // Per OCT-M6 (2026-10-20, decision #293): the render sites do
    // `const tab = tabs.find((entry) => entry.id === tabId); if (!tab)
    // return null;` — so a tab id present in a group but missing
    // from the flat `tabs` array renders as NOTHING. That is
    // exactly the bug that shipped once already: the `addons`
    // tab was invisible in the sidebar (while the badge counter
    // said "5") until the decision-#251 follow-up.
    const flatTabIds = readFlatTabIds();
    const groups = readSettingsGroups();
    const grouped = groups.flatMap((g) => g.tabs);
    const missing = grouped.filter((id) => !flatTabIds.includes(id));
    expect(missing, "grouped tabs with no entry in the flat tabs array").toEqual([]);
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
