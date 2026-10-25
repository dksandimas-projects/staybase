// Per QA-2026-10-23 §3.2 (2026-10-25) — the hotel-wide bot-protection
// mode switch.
//
// Every public guest WRITE endpoint is gated by Cloudflare Turnstile.
// During the 2026-10-23 QA pass 21 scenarios could not be executed
// because the Cloudflare challenge platform is unreachable from the QA
// host, so no token is ever issued. The owner asked for a switch that
// opens the gate for a testing window, controlled from the admin app.
//
// This is a source-text tripwire suite, in the same shape as the other
// admin settings suites (MSL-01, OCT-M1). It pins:
//
//   1. The control lives in the Settings → ENVIRONMENT TESTING tab,
//      which is already admin-gated — the gate is never opened by a
//      front-desk account.
//   2. The write persists `botProtectionMode` through the existing
//      `updateSettings("hotelConfig", …)` channel.
//   3. Turning the gate OFF writes the AUDIT trail (who / when / why)
//      and REQUIRES a reason.
//   4. Turning the gate back ON CLEARS the audit trail.
//   5. A loud banner is shown while the gate is open, so the window
//      cannot be forgotten.
//   6. `AdminContext` hydrates the mode through the SHARED normaliser
//      (fail closed) instead of trusting the raw doc value.
//
// A regression that drops the audit fields, lets the switch live on a
// non-admin tab, or writes an un-normalised mode fails one of these.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const settingsPage = read("admin-app/src/pages/SettingsPage.tsx");
const adminContext = read("admin-app/src/context/AdminContext.tsx");
const sharedBotProtection = read("shared/utils/botProtection.ts");

/** The Settings → Environment Testing tab block. */
function environmentTab(): string {
  const start = settingsPage.indexOf('activeTab === "environment"');
  const end = settingsPage.indexOf('activeTab === "staff"', start);
  expect(start, "the Environment Testing tab must exist").toBeGreaterThan(-1);
  expect(end, "the tab after Environment Testing must exist").toBeGreaterThan(-1);
  return settingsPage.slice(start, end);
}

describe("BP-01 — the bot-protection switch lives in Settings → Environment Testing", () => {
  test("the control is inside the Environment Testing tab", () => {
    const tab = environmentTab();

    expect(tab).toContain('data-testid="bot-protection-toggle"');
    expect(tab).toContain('data-testid="bot-protection-reason"');
  });

  test("the tab is admin-gated (front desk cannot open the gate)", () => {
    expect(environmentTab()).toMatch(/!isAdmin\s*\?/);
  });

  test("the control is NOT on another settings tab", () => {
    // The toggle must not have been duplicated onto a front-desk
    // reachable tab.
    const toggleId = 'data-testid="bot-protection-toggle"';
    const occurrences = settingsPage.split(toggleId).length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("BP-01 — the toggle writes the mode AND the audit trail", () => {
  test("the mode is persisted through the hotelConfig settings channel", () => {
    expect(settingsPage).toMatch(
      /updateSettings\("hotelConfig",\s*\{\s*botProtectionMode: "disabled"/
    );
    expect(settingsPage).toMatch(/botProtectionMode: "turnstile"/);
  });

  test("turning the gate OFF writes who / when / why", () => {
    const disabledWrite = settingsPage.match(
      /updateSettings\("hotelConfig",\s*\{\s*botProtectionMode: "disabled"[\s\S]*?\}\s*\)/
    );
    expect(disabledWrite, "the disabled write must exist").toBeTruthy();

    const payload = disabledWrite![0];
    expect(payload).toMatch(/botProtectionDisabledBy:/);
    expect(payload).toMatch(/botProtectionDisabledAt:/);
    expect(payload).toMatch(/botProtectionReason:/);
    // The audit fields must carry the admin's identity and a real
    // timestamp, not a placeholder.
    expect(settingsPage).toMatch(/botProtectionDisabledBy: by,/);
    expect(settingsPage).toMatch(/botProtectionDisabledAt: at,/);
    expect(settingsPage).toMatch(/const by = currentUser\?\.uid/);
    expect(settingsPage).toMatch(/const at = new Date\(\)\.toISOString\(\)/);
  });

  test("a reason is REQUIRED before the gate can be turned off", () => {
    expect(settingsPage).toMatch(
      /if \(!reason\) \{[\s\S]{0,300}?A reason is required before bot protection can be turned off/
    );
  });

  test("turning the gate back ON clears the audit trail", () => {
    const turnstileWrite = settingsPage.match(
      /updateSettings\("hotelConfig",\s*\{\s*botProtectionMode: "turnstile"[\s\S]*?\}\s*\)/
    );
    expect(turnstileWrite, "the turnstile write must exist").toBeTruthy();

    const payload = turnstileWrite![0];
    expect(payload).toMatch(/botProtectionDisabledBy: deleteField\(\)/);
    expect(payload).toMatch(/botProtectionDisabledAt: deleteField\(\)/);
    expect(payload).toMatch(/botProtectionReason: deleteField\(\)/);
  });

  test("a failed write is reverted and surfaced to the admin", () => {
    expect(settingsPage).toMatch(
      /Failed to save the bot-protection mode\. The previous setting is still in effect\./
    );
    expect(settingsPage).toContain('data-testid="bot-protection-error"');
  });
});

describe("BP-01 — the disabled window cannot be forgotten", () => {
  test("a red banner is shown while the gate is open", () => {
    const tab = environmentTab();

    expect(tab).toContain('data-testid="bot-protection-disabled-banner"');
    expect(tab).toContain('role="alert"');
    // The banner must name WHO turned it off and WHEN.
    expect(tab).toContain("botProtectionDisabledByName");
    expect(tab).toContain("botProtectionDisabledAtLabel");
    expect(tab).toContain("botProtectionAudit.reason");
    // The banner is red — the danger colour, not a neutral one.
    expect(tab).toMatch(/bot-protection-disabled-banner[\s\S]{0,400}?bg-red-50/);
  });

  test("the banner is gated on the mode being \"disabled\"", () => {
    expect(settingsPage).toMatch(
      /\{botProtectionMode === "disabled" && \(\s*<div\s*\n?\s*role="alert"/
    );
  });
});

describe("BP-01 — the mode is hydrated FAIL CLOSED", () => {
  test("AdminContext normalizes the mode on hydrate", () => {
    expect(adminContext).toMatch(
      /botProtectionMode: normalizeBotProtectionMode\(\(data as Partial<typeof hotelConfig>\)\?\.botProtectionMode\)/
    );
  });

  test("a settings doc with no mode hydrates to \"turnstile\"", () => {
    expect(adminContext).toMatch(/botProtectionMode: BOT_PROTECTION_MODE_DEFAULT,/);
    expect(sharedBotProtection).toMatch(
      /export const BOT_PROTECTION_MODE_DEFAULT: BotProtectionMode = "turnstile";/
    );
  });

  test("the admin app and the server share ONE definition of \"off\"", () => {
    // Both sides must go through the shared normaliser — a local
    // comparison in the admin app could disagree with the server and
    // silently open the gate.
    expect(settingsPage).toContain("normalizeBotProtectionMode");
    expect(adminContext).toContain("normalizeBotProtectionMode");
    expect(sharedBotProtection).toMatch(
      /export function normalizeBotProtectionMode\(raw: unknown\): BotProtectionMode/
    );
  });
});
