// Per IFS-01 (2026-11-20, decision #318): the hotel-wide in-room
// feature switches for the intercom — the GUEST CHAT and the
// intercom VOICE CALL.
//
// Both are stored on `settings/hotelConfig`:
//
//   intercomChatEnabled   → the in-room chat surface
//   intercomCallsEnabled  → the WebRTC "Call Desk" button
//
// Both default to ON. Only an EXPLICIT `false` turns a feature off,
// so a settings document written before these switches existed keeps
// behaving exactly as it did — the same rule the Other Add-Ons master
// switch uses (OCT-M1 / decision #295, `otherAddOnsEnabled`). A
// hotel's guest service is never silently switched off by a missing
// field.
//
// The normalisers live in `shared/` because the SERVER (which gates
// the guest message write) and the CLIENTS (which hide the surfaces)
// must never disagree about what "off" means. A hand-edited doc that
// spells `"false"` as a STRING is read as the boolean it spells —
// the same tolerance `normalizeOtherAddOnsEnabled` applies.

/** Default when the field is absent: the feature is ON. */
export const INTERCOM_CHAT_ENABLED_DEFAULT = true;

/** Default when the field is absent: the feature is ON. */
export const INTERCOM_CALLS_ENABLED_DEFAULT = true;

function normalizeBooleanFlag(raw: unknown, fallback: boolean): boolean {
  if (raw === false) return false;
  if (raw === true) return true;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "false") return false;
    if (normalized === "true") return true;
  }
  return fallback;
}

/**
 * Is the in-room intercom CHAT switched on?
 *
 * `false` only when the settings document explicitly says so. A
 * missing field, a missing document, or an unreadable value all
 * resolve to `true` (fail OPEN — a transient read must not take the
 * hotel's guest chat offline).
 */
export function normalizeIntercomChatEnabled(raw: unknown): boolean {
  return normalizeBooleanFlag(raw, INTERCOM_CHAT_ENABLED_DEFAULT);
}

/**
 * Is the intercom VOICE CALL switched on?
 *
 * Same rule as {@link normalizeIntercomChatEnabled}: only an explicit
 * `false` disables it.
 */
export function normalizeIntercomCallsEnabled(raw: unknown): boolean {
  return normalizeBooleanFlag(raw, INTERCOM_CALLS_ENABLED_DEFAULT);
}
