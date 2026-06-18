import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);

describe("Phase 11.7 — Settings mobile horizontal tab bar (P1)", () => {
  it("imports useBreakpoint from utils", () => {
    expect(settingsSrc).toMatch(/import\s*\{\s*useBreakpoint\s*\}\s*from\s*["']\.\.\/utils\/useBreakpoint["']/);
  });

  it("reads isMobile from useBreakpoint", () => {
    expect(settingsSrc).toMatch(/const\s*\{\s*isMobile\s*\}\s*=\s*useBreakpoint/);
  });

  it("renders a horizontal scrollable tab bar with lg:hidden (mobile only)", () => {
    expect(settingsSrc).toMatch(/<div[^>]*lg:hidden[^>]*>/);
    expect(settingsSrc).toMatch(/overflow-x-auto/);
    expect(settingsSrc).toMatch(/min-w-max/);
  });

  it("the mobile tab bar uses pill-style buttons (rounded-full, icon + label)", () => {
    const mobileBar = settingsSrc.match(
      /<div ref=\{tabBarRef\}[\s\S]*?<\/div>/
    );
    expect(mobileBar, "expected mobile tab bar with tabBarRef").toBeTruthy();
    expect(mobileBar![0]).toMatch(/rounded-full/);
    expect(mobileBar![0]).toMatch(/shrink-0/);
  });

  it("the mobile tab bar uses data-tab-id for auto-scroll targeting", () => {
    expect(settingsSrc).toMatch(/data-tab-id=\{tab\.id\}/);
  });

  it("hides the 260px left nav on mobile with hidden lg:block", () => {
    expect(settingsSrc).toMatch(/<aside[^>]*hidden lg:block/);
  });

  it("auto-scrolls the tab bar to the active tab on mobile when activeTab changes", () => {
    const effect = settingsSrc.match(
      /useEffect\(\(\) =>\s*\{[\s\S]*?if\s*\(!isMobile\)\s*return;[\s\S]*?bar\.querySelector<HTMLElement>\(`\[data-tab-id="\$\{activeTab\}"\]`\)/
    );
    expect(effect, "expected auto-scroll-to-active-tab effect").toBeTruthy();
  });

  it("the desktop layout still uses the lg:grid-cols-[260px_1fr] grid", () => {
    expect(settingsSrc).toMatch(/lg:grid-cols-\[260px_1fr\]/);
  });

  it("the section content area still renders the active section's content", () => {
    expect(settingsSrc).toMatch(/\{activeTab === ["']hotel["']/);
    expect(settingsSrc).toMatch(/\{activeTab === ["']roomtypes["']/);
    expect(settingsSrc).toMatch(/\{activeTab === ["']website["']/);
    expect(settingsSrc).toMatch(/\{activeTab === ["']staff["']/);
  });
});
