// Per QA-2026-10-23 §3.2 (2026-10-25) — the hotel-wide bot-protection
// mode.
//
// THE PROBLEM
// -----------
// Every public guest WRITE endpoint is gated by Cloudflare Turnstile
// (`verifyTurnstile` in `guest-app/server/apiRouter.ts`). During the
// 2026-10-23 QA pass 21 scenarios could not be executed at all: the
// Cloudflare challenge platform is unreachable from the QA host, so the
// widget never issues a token and every gated endpoint answers
// HTTP 400 "Bot verification token is missing."
//
// THE FIX
// -------
// A hotel-wide mode stored on `settings/hotelConfig.botProtectionMode`:
// "turnstile" (default) or "disabled". When it is "disabled" the gate
// lets the request through.
//
// WHAT MUST STAY TRUE
// -------------------
//   * the server reads the mode from `settings/hotelConfig` and
//     resolves "disabled" ONLY for the exact string
//   * the gate FAILS CLOSED — a missing doc, a missing field, an
//     unrecognised value and a failed read all keep the gate ON
//   * the mode is consulted BEFORE the token check, so EVERY gated
//     path honours it (booking create / cancel / extend-stay / lookup,
//     breakfast update, add-ons update, voucher, corporate code,
//     inquiry, contact)
//   * the Turnstile verification itself is NOT removed: with the gate
//     on, a request still needs a real token, and the rate limits and
//     every other validation are untouched
//
// This suite exercises the REAL server module (`loadBotProtectionMode`)
// over a mocked Firestore layer, so the read + the fail-closed
// normalising are asserted BEHAVIOURALLY, and pins the router wiring
// by source scan.
//
// (The router is scanned as text rather than imported on purpose: the
// apiRouter module graph pulls in every handler, and importing it here
// pushes the parallel API suite past its per-test timeout on this
// host. The existing `p0-staff-turnstile-gate.test.ts` suite already
// exercises the gate itself through `enforceBotGate`.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadBotProtectionMode,
  resetBotProtectionModeCache
} from "../../server/lib/botProtection-settings";

/**
 * The Firestore `get()` the settings reader calls. Each test decides
 * what the `settings/hotelConfig` doc looks like (or that the read
 * fails outright).
 */
const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("../../server/lib/firebase-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/lib/firebase-admin")>();
  return {
    ...actual,
    adminDb: {
      collection: () => ({
        doc: () => ({ get: mockGet })
      })
    }
  };
});

/** A settings doc that exists and carries the given fields. */
function settingsDoc(fields: Record<string, unknown>) {
  mockGet.mockResolvedValue({
    exists: true,
    data: () => fields
  });
}

/** The settings doc does not exist at all. */
function missingSettingsDoc() {
  mockGet.mockResolvedValue({ exists: false, data: () => undefined });
}

/** The settings read fails (Firestore blip / missing Admin credentials). */
function failedSettingsRead() {
  mockGet.mockRejectedValue(new Error("Firestore unavailable"));
}

beforeEach(() => {
  mockGet.mockReset();
  resetBotProtectionModeCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BP-01 — the server reads the hotel-wide bot-protection mode", () => {
  it("reads settings/hotelConfig.botProtectionMode", async () => {
    settingsDoc({ botProtectionMode: "disabled" });

    const mode = await loadBotProtectionMode();

    expect(mode).toBe("disabled");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("resolves \"turnstile\" when the mode is \"turnstile\"", async () => {
    settingsDoc({ botProtectionMode: "turnstile" });

    expect(await loadBotProtectionMode()).toBe("turnstile");
  });

  it("resolves a missing doc to \"turnstile\"", async () => {
    missingSettingsDoc();

    expect(await loadBotProtectionMode()).toBe("turnstile");
  });

  it("resolves a doc with no mode to \"turnstile\"", async () => {
    // A settings doc written before this feature existed.
    settingsDoc({ address: "Panglao, Bohol" });

    expect(await loadBotProtectionMode()).toBe("turnstile");
  });

  it("resolves a failed read to \"turnstile\" (FAIL CLOSED)", async () => {
    failedSettingsRead();

    expect(await loadBotProtectionMode()).toBe("turnstile");
  });

  it("resolves an unrecognised value to \"turnstile\"", async () => {
    // "off" / "false" / a typo / an object must NOT open the gate —
    // only the exact string "disabled" does.
    settingsDoc({ botProtectionMode: "off" });
    resetBotProtectionModeCache();
    expect(await loadBotProtectionMode()).toBe("turnstile");

    settingsDoc({ botProtectionMode: { disabled: true } });
    resetBotProtectionModeCache();
    expect(await loadBotProtectionMode()).toBe("turnstile");
  });

  it("caches the mode so the gate stays cheap", async () => {
    settingsDoc({ botProtectionMode: "turnstile" });

    await loadBotProtectionMode();
    await loadBotProtectionMode();
    await loadBotProtectionMode();

    expect(
      mockGet,
      "the settings doc must not be re-read on every gated request"
    ).toHaveBeenCalledTimes(1);
  });
});

describe("BP-01 — the route wiring (tripwire)", () => {
  const routerSrc = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
  const settingsSrc = readFileSync(
    resolve(__dirname, "../../server/lib/botProtection-settings.ts"),
    "utf8"
  );

  /** The body of `verifyTurnstile`, from its signature to `enforceBotGate`. */
  function verifyTurnstileBody(): string {
    const start = routerSrc.indexOf("async function verifyTurnstile");
    const end = routerSrc.indexOf("export async function enforceBotGate");
    expect(start, "`verifyTurnstile` must still exist").toBeGreaterThan(-1);
    expect(end, "`enforceBotGate` must still exist").toBeGreaterThan(-1);
    return routerSrc.slice(start, end);
  }

  it("the mode is read BEFORE the token check, so EVERY gated path honours it", () => {
    const body = verifyTurnstileBody();
    const modeRead = body.indexOf("loadBotProtectionMode()");
    const tokenCheck = body.indexOf("if (!token)");

    expect(modeRead, "`verifyTurnstile` must read the bot-protection mode").toBeGreaterThan(-1);
    expect(tokenCheck, "the token check must still exist").toBeGreaterThan(-1);
    expect(
      modeRead,
      "the mode check must come before the token check"
    ).toBeLessThan(tokenCheck);
  });

  it("the mode opens the gate only for the \"disabled\" value", () => {
    const body = verifyTurnstileBody();

    expect(body).toMatch(/botProtectionMode === "disabled"/);
    expect(body).toMatch(/if \(botProtectionMode === "disabled"\) \{\s*return \{ success: true \};/);
  });

  it("the Turnstile verification itself is NOT removed", () => {
    const body = verifyTurnstileBody();

    expect(body, "the Cloudflare siteverify call must remain").toContain(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    expect(body, "the production secret must still be read").toContain(
      "process.env.TURNSTILE_SECRET_KEY"
    );
    expect(body, "the missing-token refusal must remain").toContain(
      "Bot verification token is missing."
    );
  });

  it("the guest write paths are STILL gated", () => {
    // The count of direct `verifyTurnstile` call sites must not shrink:
    // the mode opens the gate, it does not remove the gate.
    const strict = routerSrc.match(/verifyTurnstile\(req\.body\?\.turnstileToken, req\)/g) || [];
    // bookings/create, bookings/cancel, extend-stay, lookup,
    // breakfast/update, addons/update, validate/voucher,
    // validate/corporate-code, corporate/inquiry, contact/create.
    expect(strict.length, "the anonymous / guest gate call sites").toBeGreaterThanOrEqual(10);
  });

  it("the server module uses the SHARED normaliser — one definition of \"off\"", () => {
    expect(settingsSrc).toContain("normalizeBotProtectionMode");
    expect(settingsSrc).toContain("@spark-inn/shared");
    expect(settingsSrc).toContain('.doc("hotelConfig")');
  });

  it("the server module fails closed on a read error", () => {
    expect(settingsSrc).toContain("catch");
    // The catch block must fall back to the fail-closed default.
    expect(settingsSrc).toMatch(/catch[\s\S]{0,600}BOT_PROTECTION_MODE_DEFAULT/);
  });
});
