// Per QA-2026-10-23 §3.2 (2026-10-25): the hotel-wide bot-protection
// mode, stored on `settings/hotelConfig.botProtectionMode`.
//
// WHY THIS EXISTS
// ---------------
// Every public guest WRITE endpoint is gated by Cloudflare Turnstile
// (`verifyTurnstile` in `guest-app/server/apiRouter.ts`). During the
// 2026-10-23 QA pass 21 scenarios could not be executed at all: the
// Cloudflare challenge platform is unreachable from the QA host, so the
// widget never issues a token and every gated endpoint answers
// HTTP 400 "Bot verification token is missing."
//
// The owner asked for a switch that opens the gate for a testing
// window, controlled from the admin app. The mode has exactly two
// values:
//
//   * "turnstile"  — the default. The bot gate is ON.
//   * "disabled"  — the bot gate is OFF. Every gated guest write
//                    endpoint accepts the request without a token.
//
// FAIL CLOSED
// -----------
// Only the EXACT string "disabled" (after trim + lowercase) turns the
// gate off. A typo ("disbled"), a boolean, an object, a missing field
// or a failed read all keep the gate ON — the safe direction. A
// bot-protection switch that fails open is a bot-protection switch that
// does not exist.
//
// The normaliser lives here, in `shared/`, so the admin app and the
// guest-app server can never disagree about what "off" means. This
// mirrors `normalizeOtherAddOnsEnabled` (OCT-M1) in shape and comment
// style, but with the failure direction INVERTED: that one fails OPEN
// (add-ons stay on sale during a Firestore blip); this one fails
// CLOSED (the bot gate stays on during a Firestore blip).

/** The two bot-protection modes a hotel can be in. */
export type BotProtectionMode = "turnstile" | "disabled";

/**
 * The default mode. The bot gate is ON unless a setting explicitly
 * says otherwise, so a settings doc written before this feature existed
 * (or a hand-edited doc with a corrupt value) keeps the gate closed.
 */
export const BOT_PROTECTION_MODE_DEFAULT: BotProtectionMode = "turnstile";

/**
 * The one raw value that opens the gate. Compared against the trimmed,
 * lower-cased raw string — nothing else disables the gate.
 */
export const BOT_PROTECTION_MODE_DISABLED = "disabled";

/**
 * Normalize the raw `settings/hotelConfig.botProtectionMode` value.
 *
 * Defensive on purpose: the field is absent on every settings doc
 * written before this feature, and a hand-edited doc could carry any
 * shape at all.
 *
 * @param raw The value straight off the Firestore doc.
 * @returns `"disabled"` ONLY for the exact string "disabled" (trimmed +
 *   lower-cased). Every other value — including `undefined`, `null`,
 *   booleans, numbers, objects, `"off"`, `"false"` and typos — returns
 *   the fail-closed default `"turnstile"`.
 */
export function normalizeBotProtectionMode(raw: unknown): BotProtectionMode {
  if (typeof raw !== "string") return BOT_PROTECTION_MODE_DEFAULT;
  const normalized = raw.trim().toLowerCase();
  if (normalized === BOT_PROTECTION_MODE_DISABLED) return "disabled";
  return BOT_PROTECTION_MODE_DEFAULT;
}

/**
 * Is the bot gate open for the given raw setting value?
 *
 * Convenience wrapper for the server-side gate, which only needs the
 * yes/no answer. Kept next to the normaliser so the admin app and the
 * server keep sharing ONE definition of "off".
 */
export function isBotProtectionDisabled(raw: unknown): boolean {
  return normalizeBotProtectionMode(raw) === "disabled";
}
