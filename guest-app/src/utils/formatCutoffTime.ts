// Per MBUX-16 (decision #269, 2026-10-16): format a HH:MM
// (24-hour) string like "20:00" into a localized 12-hour
// time like "8:00 PM". The breakfast config carries the
// cut-off as a 24-hour string in the hotel's timezone (per
// BR-10 / shared/utils/breakfastCutoff.ts); the guest surface
// needs the 12-hour form to match what they read on a clock
// face.
//
// Falls back to the raw input string if the format is
// unparseable so a misconfigured admin value doesn't crash
// the page — the meal picker still disables correctly via
// `cutoff.isLocked` in the parent helper; the explanation
// just reads the raw value.

export function formatCutoffTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return hhmm;
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${match[2]} ${period}`;
}