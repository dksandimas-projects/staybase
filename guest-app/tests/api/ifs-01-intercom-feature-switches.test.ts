// Per IFS-01 (2026-11-20, decision #318) — the hotel-wide in-room
// feature switches for the intercom.
//
// THE FEATURE
// -----------
// The hotel (the client) asked for the ability to switch off, for a
// while:
//   - the in-room intercom CHAT,
//   - the intercom VOICE CALL,
//   - and (already existing) the Spark Essentials store.
//
// The store already had a master switch (`settings/storeConfig.isEnabled`)
// that is enforced SERVER-SIDE, so it needed no new work. The chat and
// the voice call are new.
//
// WHY THE CONTRACT IS PINNED HERE
// -------------------------------
// Two properties are worth a test, because both fail silently when
// they break:
//
//   1. **FAIL OPEN.** A switch that turns a guest service OFF must
//      only ever read `false` from an EXPLICIT `false`. A missing
//      field, a missing document, a hand-edited typo, or a transient
//      Firestore read error must all leave the feature ON. The
//      opposite mistake (failing closed) takes a hotel's guest service
//      offline because of a settings hiccup.
//
//   2. **THE SERVER IS THE CHAT GATE.** The guest's chat messages are
//      written by the SERVER (the browser has no Firestore write path
//      for them). So the server is the only place where "the chat is
//      off" can be enforced for real — hiding the composer in the
//      browser would be cosmetic.
//
// The one carve-out is the STORE message: the order badge that follows
// a Spark Essentials order travels through the same endpoint, and the
// desk needs it even when the chat is off. The store has its own
// master switch.
//
// The behavioural tests import the modules lazily so a pre-fix run
// reports clean assertion failures for the source-text tripwires
// instead of dying at module resolution.

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  INTERCOM_CALLS_ENABLED_DEFAULT,
  INTERCOM_CHAT_ENABLED_DEFAULT,
  normalizeIntercomCallsEnabled,
  normalizeIntercomChatEnabled
} from "@spark-inn/shared";

const ROOT = resolve(__dirname, "../../..");
const INTERCOM_HANDLER = resolve(ROOT, "guest-app/server/handlers/intercom.ts");
const INTERCOM_SETTINGS = resolve(ROOT, "guest-app/server/lib/intercom-settings.ts");

describe("IFS-01 — the intercom feature switches are FAIL OPEN", () => {
  it("both switches default to ON", () => {
    expect(INTERCOM_CHAT_ENABLED_DEFAULT).toBe(true);
    expect(INTERCOM_CALLS_ENABLED_DEFAULT).toBe(true);
  });

  it("an absent field keeps the feature ON", () => {
    expect(normalizeIntercomChatEnabled(undefined)).toBe(true);
    expect(normalizeIntercomCallsEnabled(undefined)).toBe(true);
    expect(normalizeIntercomChatEnabled(null)).toBe(true);
    expect(normalizeIntercomCallsEnabled(null)).toBe(true);
  });

  it("an explicit false turns the feature OFF", () => {
    expect(normalizeIntercomChatEnabled(false)).toBe(false);
    expect(normalizeIntercomCallsEnabled(false)).toBe(false);
  });

  it("an explicit true keeps the feature ON", () => {
    expect(normalizeIntercomChatEnabled(true)).toBe(true);
    expect(normalizeIntercomCallsEnabled(true)).toBe(true);
  });

  it("a hand-edited \"false\" STRING is read as the boolean it spells", () => {
    expect(normalizeIntercomChatEnabled("false")).toBe(false);
    expect(normalizeIntercomCallsEnabled("false")).toBe(false);
    expect(normalizeIntercomChatEnabled(" FALSE ")).toBe(false);
    expect(normalizeIntercomCallsEnabled(" FALSE ")).toBe(false);
  });

  it("a typo or a loosely-typed value keeps the feature ON", () => {
    // These are the values a hand-edited document or a bad form field
    // actually lands on. None of them may switch a guest service off.
    for (const value of ["off", "flase", "no", "0", 0, 1, {}, [], "yes"]) {
      expect(normalizeIntercomChatEnabled(value)).toBe(true);
      expect(normalizeIntercomCallsEnabled(value)).toBe(true);
    }
  });
});

describe("IFS-01 — the public projection carries both switches", () => {
  let buildPublicHotelConfig: typeof import("../../server/lib/publicHotelConfig").buildPublicHotelConfig;

  beforeAll(async () => {
    const mod = await import("../../server/lib/publicHotelConfig");
    buildPublicHotelConfig = mod.buildPublicHotelConfig;
  });

  it("a settings doc without the fields projects BOTH switches as ON", () => {
    const projected = buildPublicHotelConfig({ brandName: "spark inn" });
    expect(projected.intercomChatEnabled).toBe(true);
    expect(projected.intercomCallsEnabled).toBe(true);
  });

  it("an explicit false projects as OFF", () => {
    const projected = buildPublicHotelConfig({
      brandName: "spark inn",
      intercomChatEnabled: false,
      intercomCallsEnabled: false
    });
    expect(projected.intercomChatEnabled).toBe(false);
    expect(projected.intercomCallsEnabled).toBe(false);
  });

  it("the switches are INDEPENDENT — one can be off while the other is on", () => {
    const chatOff = buildPublicHotelConfig({
      brandName: "spark inn",
      intercomChatEnabled: false
    });
    expect(chatOff.intercomChatEnabled).toBe(false);
    expect(chatOff.intercomCallsEnabled).toBe(true);

    const callsOff = buildPublicHotelConfig({
      brandName: "spark inn",
      intercomCallsEnabled: false
    });
    expect(callsOff.intercomChatEnabled).toBe(true);
    expect(callsOff.intercomCallsEnabled).toBe(false);
  });

  it("a null settings doc projects both switches as ON", () => {
    const projected = buildPublicHotelConfig(null);
    expect(projected.intercomChatEnabled).toBe(true);
    expect(projected.intercomCallsEnabled).toBe(true);
  });
});

describe("IFS-01 — the server gate on the guest chat message", () => {
  const handlerSrc = readFileSync(INTERCOM_HANDLER, "utf8");
  const settingsSrc = readFileSync(INTERCOM_SETTINGS, "utf8");

  it("handleSendGuestMessage reads the hotel-wide chat switch", () => {
    expect(handlerSrc).toMatch(/loadIntercomChatEnabled\(\)/);
  });

  it("the gate answers 403 with the guest-facing message", () => {
    expect(handlerSrc).toMatch(/INTERCOM_CHAT_UNAVAILABLE_ERROR/);
    expect(handlerSrc).toMatch(/status\(403\)[\s\S]{0,200}INTERCOM_CHAT_UNAVAILABLE_ERROR/);
  });

  it("the gate runs BEFORE the rate limiter (a switched-off chat must not burn the guest's quota)", () => {
    const gateIdx = handlerSrc.indexOf("loadIntercomChatEnabled()");
    // The CALL site, not the helper's declaration — the helper is
    // defined above the handler.
    const rateLimitIdx = handlerSrc.indexOf("isGuestMessageRateLimited(`intercom-msg:");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(rateLimitIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(rateLimitIdx);
  });

  it("a STORE message is NOT gated — the desk still needs the order notification", () => {
    expect(handlerSrc).toMatch(/if\s*\(\s*!isStoreOrder\s*\)/);
  });

  it("the server-side reader FAILS OPEN on a Firestore read error", () => {
    // The whole point of the switch is that a transient infrastructure
    // blip must not take the hotel's guest chat offline.
    expect(settingsSrc).toMatch(/catch\s*\(/);
    expect(settingsSrc).toMatch(/return true;/);
    expect(settingsSrc).toMatch(/normalizeIntercomChatEnabled/);
  });

  it("the server-side reader treats a missing document as ON", () => {
    expect(settingsSrc).toMatch(/if\s*\(\s*!snap\.exists\s*\)\s*return true;/);
  });
});
