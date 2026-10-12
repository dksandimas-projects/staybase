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
import { ARRIVAL_WINDOW_HOURS } from "../constants";

export interface ArrivalTimeOption {
  value: string | null;
  label: string;
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
  const safeHours = ((hours % 24) + 24) % 24;
  const safeMinutes = Math.max(0, Math.min(59, minutes));
  const reference = new Date(Date.UTC(1970, 0, 1, safeHours, safeMinutes, 0));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(reference);
}