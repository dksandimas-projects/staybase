// Per QA-2026-10-23 §3.2 (2026-10-25) — the hotel-wide bot-protection
// mode normaliser.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// Every public guest WRITE endpoint is gated by Cloudflare Turnstile
// (`verifyTurnstile` in `guest-app/server/apiRouter.ts`). During the
// 2026-10-23 QA pass 21 scenarios could not be executed because the
// Cloudflare challenge platform is unreachable from the QA host, so no
// token is ever issued and every gated endpoint answers HTTP 400
// "Bot verification token is missing."
//
// The fix adds a hotel-wide switch (`settings/hotelConfig.botProtectionMode`)
// that can open the gate for a testing window. A switch that can turn a
// BOT GATE off is only safe if it FAILS CLOSED: anything the normaliser
// does not positively recognise as "disabled" must leave the gate ON.
//
// This suite pins that rule on the shared normaliser, which is the ONE
// place the admin app and the guest-app server both read it from — if the
// two sides ever disagreed about what "off" means, one of them would
// silently open the gate.
//
// Every test here FAILS against a normaliser that treats a truthy /
// loosely-typed value as "off":
//   - `true`, `1`, `{}`, `[]` and `"off"` must all keep the gate ON.
//   - a typo ("disbled") must keep the gate ON.
//   - `undefined` / `null` (a legacy settings doc) must keep the gate ON.

import { describe, expect, it } from "vitest";
import {
  BOT_PROTECTION_MODE_DEFAULT,
  BOT_PROTECTION_MODE_DISABLED,
  isBotProtectionDisabled,
  normalizeBotProtectionMode,
  type BotProtectionMode
} from "@spark-inn/shared";

describe("BP-01 — the bot-protection normaliser is FAIL CLOSED", () => {
  it("the default mode is \"turnstile\" (the gate is ON)", () => {
    expect(BOT_PROTECTION_MODE_DEFAULT).toBe("turnstile");
  });

  it("the only raw value that opens the gate is the exact string \"disabled\"", () => {
    expect(BOT_PROTECTION_MODE_DISABLED).toBe("disabled");
    expect(normalizeBotProtectionMode("disabled")).toBe("disabled");
  });

  it("accepts \"disabled\" regardless of case and surrounding whitespace", () => {
    // A hand-edited Firestore doc or a form field tends to land on a
    // padded / capitalised shape. These all mean the same thing.
    expect(normalizeBotProtectionMode("  disabled  ")).toBe("disabled");
    expect(normalizeBotProtectionMode("DISABLED")).toBe("disabled");
    expect(normalizeBotProtectionMode("Disabled")).toBe("disabled");
    expect(normalizeBotProtectionMode("\tdisabled\n")).toBe("disabled");
  });

  it("keeps the gate ON for every value that is not exactly \"disabled\"", () => {
    const keepsTheGateOn: unknown[] = [
      undefined,
      null,
      "",
      "   ",
      "off",
      "OFF",
      "false",
      "FALSE",
      "no",
      "0",
      "1",
      "on",
      "enabled",
      "none",
      "disbled",
      "disabed",
      "disabledx",
      "xdisabled",
      "disable",
      true,
      false,
      0,
      1,
      {},
      { mode: "disabled" },
      [],
      ["disabled"]
    ];

    for (const raw of keepsTheGateOn) {
      expect(
        normalizeBotProtectionMode(raw),
        `the raw value ${JSON.stringify(raw)} must keep the bot gate ON`
      ).toBe("turnstile");
      expect(
        isBotProtectionDisabled(raw),
        `the raw value ${JSON.stringify(raw)} must not open the bot gate`
      ).toBe(false);
    }
  });

  it("a legacy settings doc with no mode behaves as \"turnstile\"", () => {
    // Requirement: a settings doc written before this feature existed
    // has no `botProtectionMode` field at all.
    expect(normalizeBotProtectionMode(undefined)).toBe("turnstile");
  });

  it("the normalised mode is always one of the two known values", () => {
    const raws: unknown[] = ["disabled", "turnstile", "off", true, undefined, {}, "nonsense"];
    for (const raw of raws) {
      const mode: BotProtectionMode = normalizeBotProtectionMode(raw);
      expect(["turnstile", "disabled"]).toContain(mode);
    }
  });

  it("the boolean helper agrees with the normaliser", () => {
    expect(isBotProtectionDisabled("disabled")).toBe(true);
    expect(isBotProtectionDisabled("  DISABLED ")).toBe(true);
    expect(isBotProtectionDisabled("turnstile")).toBe(false);
    expect(isBotProtectionDisabled(undefined)).toBe(false);
  });
});
