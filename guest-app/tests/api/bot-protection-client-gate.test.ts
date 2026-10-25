// Per QA-2026-10-23 §3.2 (2026-10-25) — the CLIENT half of the
// hotel-wide bot-protection mode.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The server honours `settings/hotelConfig.botProtectionMode`
// (`guest-app/server/lib/botProtection-settings.ts` + `enforceBotGate`
// in the apiRouter), but the GUEST CLIENT still gated on the
// Turnstile token. With the switch off the browser refused to even
// SEND the request: a voucher could not be applied, a booking could
// not be looked up, a stay could not be cancelled or extended, a
// corporate inquiry could not be submitted, a contact message could
// not be sent and a corporate booking could not be confirmed — even
// though the server would have accepted every one of them.
//
// The repo states the principle itself (BookingPage.tsx):
//   "whenever the client gates on a value the server does not
//    validate, the gate is decorative."
//
// WHAT MUST STAY TRUE
// -------------------
//   * the mode travels in the PUBLIC projection — the raw
//     `settings/hotelConfig` document is NOT readable by an anonymous
//     client, so the client reads `GET /api/public/hotel-config`
//   * the projection NORMALISES the mode with the SHARED normaliser, so
//     a malformed value projects as "turnstile" (fail closed) and the
//     client and the server can never disagree about what "off" means
//   * every client gate is CONDITIONAL on the mode — the token is
//     still required in the default mode, and NO gate is deleted
//   * the Turnstile widget does not mount at all when the mode is
//     "disabled": there is nothing to solve
//   * the client FAILS CLOSED — an unreadable config, a missing field
//     or a malformed value keeps the token required
//
// The behavioural part exercises the REAL projection module over a
// mocked Firestore layer. The client half is pinned by source scan:
// the guest pages are React components and this repo has no DOM test
// environment for them (the same pattern the other source-scan suites
// in this folder use).
//
// The scan below is NOT a "does the string exist" check: it finds
// every line that REQUIRES a token and asserts the line is also
// conditional on the mode. Re-introducing an unconditional
// `if (!turnstileToken) return;` — or an unconditional
// `Boolean(turnstileToken)` conjunct — fails the suite.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The projection module imports the Admin SDK. Mocking it keeps the
// suite fast (no firebase-admin module graph) and deterministic — the
// projection function itself is pure.
vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {}
}));

const ROOT = resolve(__dirname, "../../..");
const GUEST_SRC = join(ROOT, "guest-app", "src");

const PROJECTION_SRC = join(ROOT, "guest-app", "server", "lib", "publicHotelConfig.ts");
const PUBLIC_CONFIG_HANDLER_SRC = join(
  ROOT,
  "guest-app",
  "server",
  "handlers",
  "public-config.ts"
);
const MODE_HOOK_SRC = join(GUEST_SRC, "hooks", "useBotProtectionMode.ts");
const PUBLIC_CONFIG_HOOK_SRC = join(GUEST_SRC, "hooks", "usePublicHotelConfig.ts");

/** The guest pages that gate on a Turnstile token. */
const GATE_PAGES = [
  "pages/BookingPage.tsx",
  "pages/BookingLookupPage.tsx",
  "pages/CorporateStaysPage.tsx",
  "pages/CorporateBookingPage.tsx",
  "pages/ContactPage.tsx"
] as const;

function pageSource(relativePath: string): string {
  return readFileSync(join(GUEST_SRC, relativePath), "utf8");
}

/**
 * A line that REQUIRES a Turnstile token: a negated token expression
 * (`!turnstileToken`, `!turnstile.token`, `!gateTurnstile.token`,
 * `!reviewTurnstile.token`) or a `Boolean(<token>)` conjunct.
 */
const TOKEN_REQUIREMENT =
  /!\s*[\w.]*turnstile[\w.]*token|Boolean\(\s*[\w.]*turnstile[\w.]*token/i;

/** The mode flag every gate has to be conditional on. */
const MODE_FLAG = "isBotProtectionDisabled";

describe("BP-01 — the public projection carries the bot-protection mode", () => {
  it("projects the mode, normalised", async () => {
    const { buildPublicHotelConfig } = await import(
      "../../server/lib/publicHotelConfig"
    );

    expect(buildPublicHotelConfig({ botProtectionMode: "disabled" }).botProtectionMode).toBe(
      "disabled"
    );
    expect(buildPublicHotelConfig({ botProtectionMode: "turnstile" }).botProtectionMode).toBe(
      "turnstile"
    );
  });

  it("projects a malformed / missing mode as \"turnstile\" (FAIL CLOSED)", async () => {
    const { buildPublicHotelConfig } = await import(
      "../../server/lib/publicHotelConfig"
    );

    // A typo, a boolean, an object, a legacy doc with no field at all
    // and a doc that does not exist — every one of them keeps the gate
    // ON. The client reads this SAME projection, so a malformed value
    // cannot open the gate on either side.
    const malformed: unknown[] = [
      { botProtectionMode: "disbled" },
      { botProtectionMode: "off" },
      { botProtectionMode: "false" },
      { botProtectionMode: true },
      { botProtectionMode: { disabled: true } },
      { botProtectionMode: 1 },
      {},
      null
    ];

    for (const raw of malformed) {
      expect(
        buildPublicHotelConfig(raw).botProtectionMode,
        `the raw config ${JSON.stringify(raw)} must project the fail-closed mode`
      ).toBe("turnstile");
    }
  });

  it("normalises with the SHARED normaliser — one definition of \"off\"", () => {
    const src = readFileSync(PROJECTION_SRC, "utf8");
    expect(src).toContain("normalizeBotProtectionMode");
    expect(src).toContain("@spark-inn/shared");
    expect(src).toMatch(/botProtectionMode:\s*normalizeBotProtectionMode\(/);
  });

  it("the public endpoint serves the projection", () => {
    const handlerSrc = readFileSync(PUBLIC_CONFIG_HANDLER_SRC, "utf8");
    expect(handlerSrc).toContain("loadPublicHotelConfig");
    expect(handlerSrc).toMatch(/data:\s*config/);
  });
});

describe("BP-01 — the client resolves the mode from the public projection", () => {
  it("the mode hook reads the public projection and normalises it", () => {
    const src = readFileSync(MODE_HOOK_SRC, "utf8");
    expect(src).toContain("fetchPublicHotelConfig");
    expect(src).toContain("normalizeBotProtectionMode");
    expect(src).toContain("BOT_PROTECTION_MODE_DEFAULT");
    // The resolved flag is the normaliser's answer — never a raw read.
    expect(src).toMatch(/isBotProtectionDisabled:\s*mode\s*===\s*"disabled"/);
  });

  it("the public-config reader carries the mode", () => {
    const src = readFileSync(PUBLIC_CONFIG_HOOK_SRC, "utf8");
    // The reader's payload IS the shared public projection, and the mode
    // is an OPTIONAL field on that projection — optional on the client so
    // a missing field fails closed.
    //
    // (This assertion used to be a case-sensitive literal scan for
    // "botProtectionMode" inside the reader. The reader never spells the
    // field out — it inherits it from the shared type, where the field
    // name appears in its CANONICAL capitalisation as the type
    // `BotProtectionMode`. The literal scan therefore never matched and
    // the guard had been RED since the day it was written. It now pins
    // the real invariant instead: the reader uses the shared projection,
    // and the projection declares the optional mode field.)
    expect(src).toMatch(/PublicHotelConfigWithBotProtection\s*=\s*PublicHotelConfig/);

    const sharedTypeSrc = readFileSync(join(ROOT, "shared", "types", "publicHotelConfig.ts"), "utf8");
    expect(sharedTypeSrc).toMatch(/botProtectionMode\?\s*:\s*BotProtectionMode/);
  });

  it("every gate page resolves the mode through the shared hook", () => {
    for (const file of GATE_PAGES) {
      const src = pageSource(file);
      expect(src, `${file} must resolve the bot-protection mode`).toContain(
        "useBotProtectionMode"
      );
      expect(src, `${file} must use the resolved mode flag`).toContain(MODE_FLAG);
    }
  });
});

describe("BP-01 — every client gate is CONDITIONAL on the mode", () => {
  it("no page gates on the token unconditionally", () => {
    const offenders: string[] = [];

    for (const file of GATE_PAGES) {
      const lines = pageSource(file).split("\n");
      lines.forEach((line, index) => {
        if (!TOKEN_REQUIREMENT.test(line)) return;
        if (line.includes(MODE_FLAG)) return;
        offenders.push(`${file}:${index + 1}  ${line.trim()}`);
      });
    }

    expect(
      offenders,
      "every token requirement must be conditional on the bot-protection mode"
    ).toEqual([]);
  });

  it("no page uses the bare `if (!turnstileToken) return;` shape", () => {
    for (const file of GATE_PAGES) {
      const src = pageSource(file);
      expect(src, `${file} must not gate unconditionally`).not.toMatch(
        /if\s*\(\s*!\s*turnstile(Token|\.token)\s*\)/
      );
      expect(src, `${file} must not gate unconditionally`).not.toMatch(
        /if\s*\(\s*!\s*(gate|review)Turnstile\.token\s*\)/
      );
    }
  });

  it("the six named gate sites are the ones that carry the mode flag", () => {
    const sites: Array<{ file: string; label: string; pattern: RegExp }> = [
      {
        file: "pages/BookingPage.tsx",
        label: "the voucher Apply handler",
        pattern: /if \(!isBotProtectionDisabled && !turnstileToken\) \{/
      },
      {
        file: "pages/BookingPage.tsx",
        label: "the Confirm gate",
        pattern: /\(isBotProtectionDisabled \|\| Boolean\(turnstileToken\)\)/
      },
      {
        file: "pages/BookingLookupPage.tsx",
        label: "the magic-link auto-lookup",
        pattern: /if \(!isBotProtectionDisabled && !turnstileToken\) return;/
      },
      {
        file: "pages/BookingLookupPage.tsx",
        label: "the search submit",
        pattern: /if \(!isBotProtectionDisabled && !turnstileToken\) \{\s*\n\s*setSearchError\(/
      },
      {
        file: "pages/BookingLookupPage.tsx",
        label: "the cancel handler",
        pattern: /if \(!isBotProtectionDisabled && !turnstileToken\) \{\s*\n\s*setCancelError\(/
      },
      {
        file: "pages/BookingLookupPage.tsx",
        label: "the extend-stay handler",
        pattern: /if \(!isBotProtectionDisabled && !turnstileToken\) \{\s*\n\s*setExtendError\(/
      },
      {
        file: "pages/CorporateStaysPage.tsx",
        label: "the corporate inquiry form",
        pattern: /if \(!isBotProtectionDisabled && !turnstileToken\) \{/
      },
      {
        file: "pages/CorporateBookingPage.tsx",
        label: "the corporate code gate",
        pattern: /if \(!isBotProtectionDisabled && !gateTurnstile\.token\) \{/
      },
      {
        file: "pages/CorporateBookingPage.tsx",
        label: "the corporate Confirm gate",
        pattern: /\(isBotProtectionDisabled \|\| Boolean\(reviewTurnstile\.token\)\)/
      },
      {
        file: "pages/ContactPage.tsx",
        label: "the contact form",
        pattern: /if \(!isBotProtectionDisabled && !turnstile\.token\) \{/
      }
    ];

    for (const site of sites) {
      expect(
        pageSource(site.file),
        `${site.file} — ${site.label} must be conditional on the mode`
      ).toMatch(site.pattern);
    }
  });
});

describe("BP-01 — the challenge is not mounted when the gate is off", () => {
  it("the booking flow does not mount the widget when the mode is off", () => {
    expect(pageSource("pages/BookingPage.tsx")).toMatch(
      /useTurnstileToken\(\{\s*enabled: isReviewStep && !isBotProtectionDisabled\s*\}\)/s
    );
  });

  it("the lookup page does not mount the widget when the mode is off", () => {
    expect(pageSource("pages/BookingLookupPage.tsx")).toMatch(
      /useTurnstileToken\(\{ enabled: !isBotProtectionDisabled \}\)/
    );
  });

  it("neither corporate widget mounts when the mode is off", () => {
    const src = pageSource("pages/CorporateBookingPage.tsx");
    expect(src).toMatch(
      /useTurnstileToken\(\{\s*enabled: currentStepKey === "gate" && !isBotProtectionDisabled\s*\}\)/s
    );
    expect(src).toMatch(
      /useTurnstileToken\(\{\s*enabled: currentStepKey === "review" && !isBotProtectionDisabled\s*\}\)/s
    );
  });

  it("the contact widget does not mount when the mode is off", () => {
    expect(pageSource("pages/ContactPage.tsx")).toMatch(
      /useTurnstileToken\(\{ enabled: !isBotProtectionDisabled \}\)/
    );
  });

  it("the corporate inquiry widget does not render when the mode is off", () => {
    // This page mounts the widget imperatively (it predates the shared
    // hook), so its mount effect has to bail out instead.
    const src = pageSource("pages/CorporateStaysPage.tsx");
    expect(src).toMatch(/if \(isBotProtectionDisabled\) return;/);
    expect(src).toMatch(/\[isSubmitted, isBotProtectionDisabled\]/);
  });
});
