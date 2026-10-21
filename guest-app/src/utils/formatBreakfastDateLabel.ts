// Per BR-03: the human-readable date label for the guest booking
// flow's per-date rows — "Oct 14 (Tue)".
//
// Per BR-03-FIT-02 (QA pass 2026-10-21): the UTC anchor on the
// parse is REQUIRED, not cosmetic.
//
// The pre-fix implementation parsed the `yyyy-mm-dd` value WITHOUT
// the `Z` suffix — `new Date("2026-11-05T00:00:00")` — which
// JavaScript interprets in the BROWSER's local timezone, but then
// formatted the result with `timeZone: "UTC"`. Parsing local +
// formatting UTC is a guaranteed one-day mismatch in every timezone
// east of UTC.
//
// Observed in production on 2026-10-21 (guest booking Step 2, a
// Nov 5 -> Nov 7 stay): the breakfast date cards rendered
// "Nov 4 (Wed)" and "Nov 5 (Thu)" instead of "Nov 5 (Thu)" and
// "Nov 6 (Fri)", and the Other add-ons date rows rendered the same
// two shifted dates. The hotel is in Asia/Manila (UTC+8), so every
// guest booking from the Philippines saw breakfast dates one day
// early — including a first breakfast "on" a date before check-in.
//
// The OCT-H2 audit (2026-10-20) fixed the sibling
// `enumerateBreakfastDates` enumerator with the same `Z` anchor but
// did NOT touch this formatter, so the shift survived the fix. The
// admin-app counterparts — `ManageBreakfastPage.tsx` and
// `ManageOtherAddOnsPage.tsx` — already anchor with `Z`, which is
// why the guest and the kitchen saw DIFFERENT dates for the same
// booking.
//
// This helper lives in its own module (like `formatCutoffTime.ts`
// before it) so the test suite can exercise the real behaviour
// instead of matching source text — the bug is timezone-dependent,
// so a source-regex tripwire cannot see it.
//
// The `+ 'T00:00:00Z'` anchor and the `timeZone: "UTC"` format
// option must both stay: they are what make the output independent
// of the viewer's timezone.

export function formatBreakfastDateLabel(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(parsed);
  const monthDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
  return `${monthDay} (${weekday})`;
}
