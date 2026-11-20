// Per HC-02 (decision #329, 2026-11-20): the hotel's CHECK-IN and
// CHECK-OUT TIMES have ONE source of truth — `settings/hotelConfig`.
//
// WHY
// ---
// The check-in / check-out times were already configurable (Settings →
// Hotel Info → `checkInTime` / `checkOutTime`), and the guest booking
// flow already read them from there — the Step 2 "Expected arrival
// time" dropdown is derived from `hotelConfig.checkInTime`.
//
// But the HOUSE RULES — the free-text block the admin edits in
// Settings → Legal and that rides in every guest email — is prose the
// admin typed by hand. It said *"Check-in time is 2:00 PM. Check-out
// time is 12:00 PM."* while the live `hotelConfig` said `checkInTime:
// "14:00"` / `checkOutTime: "11:00"`. Two sources for the same fact,
// and they already disagreed: the email told the guest 12:00 PM while
// the booking flow told them 11:00.
//
// THE RULE
// --------
// The times are a VARIABLE, not prose. The house-rules text may
// contain the tokens `{{checkInTime}}` and `{{checkOutTime}}`; every
// surface that renders the house rules resolves them against the live
// `settings/hotelConfig` before rendering. The admin keeps full
// control of the wording; the VALUES come from the one source.
//
// This module is the shared, pure half of that: resolve the times,
// format them for display, and substitute the tokens. The server
// (guest emails) and the admin app (the registration PDF) both call
// it, so the email and the printed form can never disagree.
//
// WHY THE TIMES ARE FORMATTED TO 12-HOUR
// --------------------------------------
// The guest booking Step 2 dropdown renders the arrival window as
// "2:00 PM" / "9:30 AM" (the shared `buildArrivalTimeOptions`), and
// the admin's own hotel-config field defaults to "2:00 PM". A raw
// "14:00" in the middle of a prose sentence would read like a bug, so
// a 24-hour value is rendered as 12-hour — with the SAME formatter
// the arrival-time dropdown uses, so the two surfaces read identically.

import { parseCheckInTimeToPair } from "./bookingPreferences";

/**
 * The hotel's check-in / check-out times, as DISPLAY labels.
 *
 * Both are always strings. An empty string means "the hotel has not
 * set this one" — the resolver falls back to the deploy-time config
 * before that.
 */
export interface HotelTimes {
  /** e.g. "2:00 PM" */
  checkInTime: string;
  /** e.g. "11:00 AM" */
  checkOutTime: string;
}

/** The token the house-rules text uses for the check-in time. */
export const CHECK_IN_TIME_TOKEN = "{{checkInTime}}";
/** The token the house-rules text uses for the check-out time. */
export const CHECK_OUT_TIME_TOKEN = "{{checkOutTime}}";

/**
 * The tokens the house-rules textarea offers, with the field each one
 * reads. The admin UI renders this next to the textarea so the admin
 * can see the available substitutions (and their current values)
 * without guessing.
 */
export const HOUSE_RULES_TIME_TOKENS = [
  { token: CHECK_IN_TIME_TOKEN, field: "checkInTime" },
  { token: CHECK_OUT_TIME_TOKEN, field: "checkOutTime" }
] as const;

// Render a `{ hours, minutes }` pair as a 12h display label like
// "2:00 PM" / "9:30 AM". This mirrors the private `format12hLabel` in
// `bookingPreferences.ts` (same hotel-timezone handling, same
// `Intl.DateTimeFormat` approach) so the email and the booking Step 2
// dropdown read identically.
function format12hLabel(hours: number, minutes: number, locale: string): string {
  const HOTEL_TZ_OFFSET_HOURS = 8;
  const HOTEL_TZ_IANA = "Asia/Manila";
  const safeHours = ((hours % 24) + 24) % 24;
  const safeMinutes = Math.max(0, Math.min(59, minutes));
  const utcHours = (safeHours - HOTEL_TZ_OFFSET_HOURS + 24) % 24;
  const reference = new Date(Date.UTC(1970, 0, 1, utcHours, safeMinutes, 0));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: HOTEL_TZ_IANA
  }).format(reference);
}

/**
 * Formats a stored time value as a 12-hour display label.
 *
 * Accepts both shapes the hotel's config carries:
 *   - a 24-hour string ("14:00", "9:30") → "2:00 PM" / "9:30 AM";
 *   - an already-12-hour string ("2:00 PM", "2 pm") → normalised to
 *     "2:00 PM" (the hour/minute width is made consistent).
 *
 * A value that is not a time at all (the admin typed something else,
 * e.g. "Flexible") is returned TRIMMED AND VERBATIM — the admin's
 * wording wins, because it is not a time this helper can improve.
 *
 * A blank value returns "".
 */
export function formatHotelTimeLabel(raw: unknown, locale: string = "en-US"): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  // `parseCheckInTimeToPair` silently falls back to 14:00 for
  // unparseable input, so detect that case BEFORE trusting it: a value
  // that is neither a 24-hour nor a 12-hour clock is not a time.
  const looksLike24h = /^\d{1,2}:\d{2}$/.test(text);
  const looksLike12h = /^\d{1,2}(:\d{2})?\s*(am|pm)$/i.test(text);
  if (!looksLike24h && !looksLike12h) return text;
  const { hours, minutes } = parseCheckInTimeToPair(text);
  return format12hLabel(hours, minutes, locale);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves the hotel's check-in / check-out times from the runtime
 * `settings/hotelConfig` document with a deploy-time fallback, and
 * renders them as 12-hour display labels.
 *
 * Same shape as `resolveHotelContact`: the runtime value wins when it
 * is present, the fallback covers a field the document does not carry,
 * and the result is always a string.
 */
export function resolveHotelTimes(
  runtime: unknown,
  fallback?: unknown,
  locale: string = "en-US"
): HotelTimes {
  const r = asRecord(runtime);
  const f = asRecord(fallback);
  const pick = (key: "checkInTime" | "checkOutTime"): string =>
    asTrimmedString(r[key]) || asTrimmedString(f[key]);
  return {
    checkInTime: formatHotelTimeLabel(pick("checkInTime"), locale),
    checkOutTime: formatHotelTimeLabel(pick("checkOutTime"), locale)
  };
}

/**
 * Substitutes the check-in / check-out tokens in a house-rules text
 * with the resolved times.
 *
 * A token whose time is BLANK is left in place (rather than replaced
 * with an empty string) so a misconfigured hotel produces a visibly
 * unresolved token instead of a broken sentence like "Check-in time
 * is .". Everything else in the text is untouched.
 */
export function interpolateHotelTimes(text: string, times: HotelTimes): string {
  if (typeof text !== "string" || !text) return text ?? "";
  let out = text;
  if (times.checkInTime) {
    out = out.split(CHECK_IN_TIME_TOKEN).join(times.checkInTime);
  }
  if (times.checkOutTime) {
    out = out.split(CHECK_OUT_TIME_TOKEN).join(times.checkOutTime);
  }
  return out;
}
