// Per QA-2026-10-23 §3.2 (2026-10-25): the hotel-wide bot-protection
// mode, read from `settings/hotelConfig.botProtectionMode`.
//
// The Settings → Environment Testing tab can open the bot gate for a
// testing window. This module is the ONE place the server reads that
// setting, so every gated guest write endpoint (booking create /
// cancel / extend-stay / lookup, breakfast update, add-ons update,
// voucher, corporate code, inquiry, contact) sees the same mode.
//
// FAIL CLOSED: a missing doc, a missing field, an unrecognised value
// or a read failure ALL resolve to "turnstile" — the gate stays ON. A
// bot-protection switch that fails open is not a bot-protection
// switch.
//
// The value is cached for ~10 seconds so the gate stays cheap on the
// hot path. The trade-off is deliberate: a switch flipped in the admin
// app takes up to 10 seconds to take effect on a warm server, and a
// read that fails is retried at most once per cache window.
//
// This mirrors `otherAddOns-settings.ts` (OCT-M1) in shape — same
// settings doc, same Admin SDK access, same "log it, never be silent"
// error handling — with the failure direction INVERTED.

import { adminDb } from "./firebase-admin";
import {
  BOT_PROTECTION_MODE_DEFAULT,
  normalizeBotProtectionMode,
  type BotProtectionMode
} from "@spark-inn/shared";

/** How long a resolved mode stays fresh. */
const CACHE_TTL_MS = 10_000;

let cachedMode: BotProtectionMode | null = null;
let cachedAt = 0;

/**
 * The mode the server last logged. Used so the "bot protection is
 * DISABLED" warning is logged once per change instead of once per
 * request (the gate runs on every guest write).
 */
let lastLoggedMode: BotProtectionMode | null = null;

/**
 * Read the hotel-wide bot-protection mode.
 *
 * @returns `"disabled"` ONLY when `settings/hotelConfig.botProtectionMode`
 *   is exactly the string "disabled". A missing doc, a missing field,
 *   an unrecognised value or a read failure all resolve to
 *   `"turnstile"` — the fail-closed default.
 */
export async function loadBotProtectionMode(): Promise<BotProtectionMode> {
  const now = Date.now();
  if (cachedMode !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedMode;
  }

  let mode: BotProtectionMode = BOT_PROTECTION_MODE_DEFAULT;
  try {
    const snap = await adminDb
      .collection("settings")
      .doc("hotelConfig")
      .get();
    if (snap.exists) {
      mode = normalizeBotProtectionMode(snap.data()?.botProtectionMode);
    }
  } catch (err) {
    // FAIL CLOSED. The gate must stay ON when the setting cannot be
    // read — a Firestore blip must never open every guest write
    // endpoint. The error is logged so it is never silent.
    console.error(
      "Failed to read settings/hotelConfig.botProtectionMode; keeping bot protection enabled:",
      err
    );
    mode = BOT_PROTECTION_MODE_DEFAULT;
  }

  cachedMode = mode;
  cachedAt = Date.now();
  logModeOnce(mode);
  return mode;
}

/**
 * Is the bot gate open for this hotel right now?
 *
 * The single question the gate asks. `true` means "no Turnstile token
 * required" — and it is only ever `true` for an explicit `"disabled"`
 * setting.
 */
export async function isBotProtectionDisabled(): Promise<boolean> {
  return (await loadBotProtectionMode()) === "disabled";
}

/**
 * Log the mode the server is actually using, once per change.
 *
 * The "disabled" line is deliberately loud: while it is on, every
 * public guest write endpoint accepts unverified requests.
 */
function logModeOnce(mode: BotProtectionMode): void {
  if (lastLoggedMode === mode) return;
  lastLoggedMode = mode;
  if (mode === "disabled") {
    console.warn(
      "[bot-protection] Bot protection is DISABLED for this hotel — every public guest write endpoint is accepting requests without a Turnstile token."
    );
  } else {
    console.log("[bot-protection] Bot protection mode: turnstile.");
  }
}

/**
 * Drop the cached mode. Exists for tests and for a future
 * "apply immediately" action — the admin toggle does NOT need it
 * because the ~10s cache window is the documented trade-off.
 */
export function resetBotProtectionModeCache(): void {
  cachedMode = null;
  cachedAt = 0;
  lastLoggedMode = null;
}
