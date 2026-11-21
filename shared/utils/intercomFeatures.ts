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

/**
 * What the guest's CHAT TAB shows, per IFS-01 follow-up (2026-11-21,
 * decision #335).
 *
 * The hotel has TWO independent in-room switches, and the guest's next
 * step depends on both at once:
 *
 *   chat ON              → the chat thread (the call is a separate
 *                          control in the panel header).
 *   chat OFF, calls ON   → the IN-ROOM CALL is the guest's next step,
 *                          so the chat tab offers the call as its
 *                          primary action. Falling back to the phone
 *                          number here would hide a channel the hotel
 *                          deliberately left open.
 *   chat OFF, calls OFF  → there is no in-room channel left, so the
 *                          phone number is the action.
 */
export type InRoomChatTabSurface = "chat" | "call" | "phone";

/**
 * Resolve what the chat tab renders for the current pair of switches.
 *
 * Pure and shared so the guest panel and any future surface can never
 * disagree about which channel the guest is offered.
 */
export function resolveInRoomChatTabSurface(
  chatEnabled: boolean,
  callsEnabled: boolean
): InRoomChatTabSurface {
  if (chatEnabled) return "chat";
  return callsEnabled ? "call" : "phone";
}

/**
 * Is EVERY in-room feature switched off — chat, voice calls and the
 * store?
 *
 * When this is true the whole panel becomes the phone-only card. That
 * card has no panel header, so it would take the "Call Desk" button
 * with it — which is why the voice call counts as a live channel here:
 * with the call still ON, the panel must keep its header and offer the
 * call.
 */
export function everyInRoomFeatureIsOff(
  chatEnabled: boolean,
  callsEnabled: boolean,
  storeEnabled: boolean
): boolean {
  return !chatEnabled && !callsEnabled && !storeEnabled;
}
