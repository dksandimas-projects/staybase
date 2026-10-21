// Per SR-01..05 (2026-10-12): the helpers for the booking
// Step 2 "Expected arrival time" dropdown + the per-room
// bed-set-up lookup. Pure functions, shared by the guest +
// corporate apps.
//
// The 24-hour arrival window is a hardcoded constant per
// the design decision on 2026-10-12 ("keep it fixed"). The
// dropdown starts at the hotel's `checkInTime` and rolls
// forward hour-by-hour for `ARRIVAL_WINDOW_HOURS`. Times
// earlier than `checkInTime` are intentionally not offered
// (the existing `earlyCheckIn` flow covers that).
import { ARRIVAL_WINDOW_HOURS, DEFAULT_BOOKING_PREFERENCES } from "../constants";

export interface ArrivalTimeOption {
  value: string | null;
  label: string;
}

// Per RPT-03 (QA pass 2026-10-21): the SERVER's allowed-value
// catalog for the Step 2 "additional preferences" check.
//
// THE DEFECT THIS FIXES
// ---------------------
// The guest client hydrates the preference catalog WITH a fallback:
// `hydrateBookingPreferenceCatalog` in
// `guest-app/src/hooks/useRoomTypes.ts` returns
// `DEFAULT_BOOKING_PREFERENCES` when the live `hotelConfig`
// catalog is empty or holds no usable entry. So a hotel that never
// configured the list still RENDERS the nine shipped chips.
//
// The server had no such fallback. It built the allowed-value list
// straight from `hotelConfig.bookingPreferences` — empty for every
// hotel that never configured it (production included: the doc had
// no `bookingPreferences` field at all on 2026-10-21) — and threw
// "Selected preferences are not configured: <key>" for every key
// the guest ticked. The throw happened INSIDE the create
// transaction, so the whole booking failed.
//
// Net effect: a guest who ticked a single preference chip could not
// complete a booking. The 500 was indistinguishable from a server
// fault.
//
// THE FIX
// -------
// Resolve the catalog through ONE shared helper, so the client's
// fallback and the server's validation can never disagree again.
// An EMPTY catalog means "the hotel has not configured this list"
// — which is the correct state for a hotel that wants the shipped
// defaults, and the state the client already assumed. A NON-EMPTY
// catalog is the admin's explicit choice and is used verbatim (so
// removing a chip in the admin genuinely rejects it at the API).
export function resolveBookingPreferenceValues(raw: unknown): string[] {
  const values: string[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const value = (entry as { value?: unknown }).value;
      if (typeof value === "string" && value) values.push(value);
    }
  }
  return values.length > 0
    ? values
    : DEFAULT_BOOKING_PREFERENCES.map((option) => option.value);
}

// Per SR-01..05 (2026-10-12): parse the hotel's
// `checkInTime` string ("14:00", "2:00 PM", "9:30 am",
// etc.) into a { hours, minutes } pair. Falls back to the
// 14:00 (2 PM) standard when the string is empty or
// unparseable — same fallback the cancellation utils use so
// the dropdown matches the existing UX when settings are
// missing.
export function parseCheckInTimeToPair(timeStr: string): { hours: number; minutes: number } {
  const normalized = timeStr.trim().toLowerCase();
  if (!normalized) return { hours: 14, minutes: 0 };

  // 12h with am/pm: "2:00 pm", "9:30 am", "2 pm"
  const ampm = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2] ?? "0");
    const isPm = ampm[3] === "pm";
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
    return { hours, minutes };
  }

  // 24h with colon: "14:00", "9:30"
  const h24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const hours = Number(h24[1]);
    const minutes = Number(h24[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }

  return { hours: 14, minutes: 0 };
}

// Per SR-01..05 (2026-10-12): build the dropdown options
// for the Step 2 "Expected arrival time" selector. Always
// returns `[{ value: null, label: "I don't know" }, ...times]`
// — the null sentinel matches the wire shape on
// `Reservation.expectedArrivalTime`. The time options are
// rolled hour-by-hour from `checkInTime` for
// `ARRIVAL_WINDOW_HOURS` (24 by default). Labels are
// rendered in the user-facing 12h format so the guest sees
// "2:00 PM", "3:00 PM", ..., "1:00 PM" (next day) — the
// wraparound past midnight is intentional.
export function buildArrivalTimeOptions(
  checkInTimeStr: string,
  locale: string = "en-US"
): ArrivalTimeOption[] {
  const base = parseCheckInTimeToPair(checkInTimeStr);
  const options: ArrivalTimeOption[] = [
    { value: null, label: "I don't know" }
  ];

  for (let i = 0; i < ARRIVAL_WINDOW_HOURS; i += 1) {
    const totalMinutes = base.minutes + (base.hours + i) * 60;
    const hours24 = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    options.push({
      value: formatHHMM(hours24, minutes),
      label: format12hLabel(hours24, minutes, locale)
    });
  }

  return options;
}

// Render a `{ hours, minutes }` pair as an `HH:MM` 24h
// string (the wire format the server validates against).
function formatHHMM(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Per SR-01..05 follow-up (2026-10-12): the fixed UTC+8
// offset for the Philippine-time hotel. Philippine
// Standard Time (PST) is UTC+8 year-round — no DST since
// the 1970s — so a fixed `+8` offset is correct for every
// date. The hotel is Philippine-based for the foreseeable
// product, so we hardcode the offset here rather than
// reading the deploy-time `config.timezone` (shared/ has
// no `@config` import). When the project goes white-label
// to a non-Philippine hotel, switch to reading the offset
// via `Intl.DateTimeFormat` against the host timezone.
const HOTEL_TZ_OFFSET_HOURS = 8;
const HOTEL_TZ_IANA = "Asia/Manila";

// Render a `{ hours, minutes }` pair as a 12h display
// label like "2:00 PM" / "9:30 AM". Uses `Intl.DateTimeFormat`
// when `locale` is provided so future Filipino locales
// land cleanly.
function format12hLabel(
  hours: number,
  minutes: number,
  locale: string
): string {
  // Build a synthetic Date at 1970-01-01 HH:MM in UTC so
  // we can reuse the locale-aware `Intl.DateTimeFormat`
  // instead of writing a custom formatter. The date part
  // is intentionally stable so callers don't see
  // locale-specific date fragments.
  //
  // The wire value `HH:MM` is interpreted in the HOTEL
  // timezone (Asia/Manila = UTC+8). To make the label render
  // that wall-clock time regardless of the guest's browser
  // timezone, we shift the hours back by the hotel offset
  // before `Date.UTC(...)`, then format with `timeZone:
  // HOTEL_TZ_IANA` so the formatter treats the constructed
  // instant as hotel-local time.
  //
  // For `hours = 14`, `minutes = 0`:
  //   utcHours = (14 - 8 + 24) % 24 = 6
  //   reference = `Date.UTC(1970, 0, 1, 6, 0)` = 06:00 UTC
  //   = 14:00 Asia/Manila → "2:00 PM"
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