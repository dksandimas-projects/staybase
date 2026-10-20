import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDaysToIsoDate,
  diffNightsBetweenIso,
  getDateKeyInTimezone,
  isValidIsoDate,
  normalizeStayRange,
  resolveRangeSelection,
  resolveMaxStayNights,
  describeMaxStayNights,
  DEFAULT_BOOKING_HORIZON_DAYS,
  type StayRangeAdjustmentReason,
} from "@spark-inn/shared";
import { DayPicker, TZDate, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import config from "@config";
import { X } from "lucide-react";
import { cn } from "../utils/cn";

type DateRangePickerOrientation = "horizontal" | "vertical";

interface DateRangePickerProps {
  checkIn: string;
  checkOut: string;
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
  /**
   * Called ONCE with both dates when a range completes.
   *
   * DR-03 (2026-10-15): the picker used to commit via `onCheckInChange`
   * then `onCheckOutChange`. Both handlers close over the same render's
   * `checkIn`, so the second call rewrote the URL from a STALE value and
   * clobbered the check-in the first call had just written — leaving
   * `?checkIn=2026-10-15&checkOut=2026-12-24` on a December booking. Any
   * parent that derives side effects (URL params) from these must be
   * given the pair together. Optional: when absent the two individual
   * callbacks are used, which is only safe for parents whose handlers do
   * not read the other date.
   */
  onRangeChange?: (checkIn: string, checkOut: string) => void;
  orientation?: DateRangePickerOrientation;
  /**
   * MSL-01 (2026-10-15): the RAW `settings/hotelConfig.maxStayNights`
   * value (undefined until the hook resolves). It is resolved INSIDE
   * this component via `resolveMaxStayNights` rather than by the
   * parent, so no call site can hand a literal `0` to the clamp
   * arithmetic — see the `0` trap in `stayRange.ts`. `0` means "no
   * limit"; omitting the prop keeps the historical 30-night default.
   */
  maxStayNights?: number | null;
}

// DR-03 (2026-10-15): furthest AHEAD a guest may book. This is a
// separate limit from the stay-LENGTH cap and used to be the same
// number, which capped the calendar at 30 days out — the owner could
// not reach December at all and read it as a broken pager rather than a
// policy.
//
// MSL-01 (2026-10-15): the stay-length cap is NO LONGER a module
// constant. It arrives as the `maxStayNights` prop (the raw
// `settings/hotelConfig` value) and is resolved once per render below.
// The `dr-01` suite deliberately no longer pins a literal `30` here —
// see its "picker must not hardcode the cap" test.
const BOOKING_HORIZON_DAYS = DEFAULT_BOOKING_HORIZON_DAYS;

/**
 * DR-02 (2026-10-15): the picker is now the single-overlay range
 * calendar used by Agoda / Airbnb / Booking.com rather than two
 * independent native date inputs.
 *
 * The reason to change is structural, not cosmetic. With two
 * independent fields there is always a moment where the two hold
 * values that disagree, and every downstream rule (the clamps, the
 * `nights-preserved` correction, the "we changed your date"
 * message) exists only to repair that state. A range calendar has
 * no such moment: the first click sets arrival and the UI moves to
 * departure, so an inverted range is never representable.
 *
 * Timezone: every date crossing this boundary is a hotel-local ISO
 * `YYYY-MM-DD` key (see `getDateKeyInTimezone`). The calendar
 * operates on `TZDate` pinned to `config.timezone` so that a guest
 * in any timezone sees the property's days, not their own — and
 * `getFullYear` / `getMonth` / `getDate` on a `TZDate` read the
 * tz-local parts, which is what makes the round-trip exact.
 */
/**
 * Per OCT-C4 (2026-10-20, audit `plan/project/AUDIT-OCTOBER-2026.md`):
 * build the calendar's date value from its Y / M / D components, pinned
 * to the HOTEL's timezone.
 *
 * The previous implementation was `new TZDate(`${iso}T00:00:00`,
 * config.timezone)`. `@date-fns/tz`'s TZDate constructor pops the
 * timezone string and, when the REMAINING argument is a single date
 * STRING, parses it with the native `Date` constructor — i.e. in the
 * BROWSER's timezone — and only then re-projects the instant into
 * `config.timezone`. For any browser whose clock is ahead of
 * Asia/Manila (UTC+8) the re-projection lands on the PREVIOUS day.
 * Verified against the installed package:
 *
 *   browser TZ: Asia/Manila      isoToTzDate(Oct 25) -> 2026-10-25  OK
 *   browser TZ: Asia/Tokyo        isoToTzDate(Oct 25) -> 2026-10-24  WRONG
 *   browser TZ: Australia/Sydney  isoToTzDate(Oct 25) -> 2026-10-24  WRONG
 *
 * `react-day-picker` re-exports the SAME `TZDate` class, and its
 * `DateLib.newDate(year, monthIndex, date)` builds its day cells as
 * `new TZDate(year, monthIndex, date, timeZone)` — the 3-number
 * (components) form, which constructs the wall-clock in the TARGET
 * zone. So the library's cells were correctly Manila-anchored while
 * every value WE built was not, and the two disagreed — the exact
 * invariant `BOOKING-FLOW.md §Date picker` requires never to happen.
 *
 * The components form below is byte-for-byte the construction rdp
 * uses, so our values and the library's cells now agree in every
 * browser timezone.
 */
function isoToTzDate(iso: string): TZDate {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new TZDate(NaN);
  }
  // `TZDate` takes a zero-based month index, like `Date`.
  return new TZDate(year, month - 1, day, config.timezone);
}

function tzDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatStayDate(iso: string): string {
  if (!isValidIsoDate(iso)) return "—";
  return isoToTzDate(iso).toLocaleDateString(config.locale, {
    timeZone: config.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Copy for each auto-correction. The range calendar makes most
 * corrections unrepresentable, so this only fires for inputs that
 * arrived from outside the picker (a shared `?checkIn=` link, a
 * past date, a horizon overrun).
 */
function describeAdjustment(
  reason: StayRangeAdjustmentReason,
  maxNights: number,
): string | null {
  switch (reason) {
    case "check-in-clamped-to-today":
      return "Check-in can't be in the past — moved to today.";
    case "nights-clamped":
      // Unreachable when unlimited — `nights-clamped` requires a finite
      // cap to have fired.
      return `A single stay can run at most ${describeMaxStayNights(maxNights)}, so check-out was moved.`;
    case "horizon-capped":
      return `Bookings open ${BOOKING_HORIZON_DAYS} days ahead, so check-out was capped.`;
    case "invalid-check-in":
    case "invalid-check-out":
    case "check-out-clamped-after-check-in":
      return "We fixed an invalid date and kept your stay length.";
    default:
      return null;
  }
}

/** Two months side by side where there is room for them, one on phones. */
function useTwoMonthLayout(): boolean {
  const [wide, setWide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function DateRangePicker({
  checkIn,
  checkOut,
  onCheckInChange,
  onCheckOutChange,
  onRangeChange,
  orientation = "vertical",
  maxStayNights,
}: DateRangePickerProps) {
  const todayIso = useMemo(() => getDateKeyInTimezone(config.timezone), []);
  // MSL-01: resolve the raw setting ONCE, here, so every clamp site
  // below receives a safe number. `Infinity` = unlimited; a missing
  // prop resolves to the historical 30-night default.
  const maxNights = useMemo(
    () => resolveMaxStayNights(maxStayNights ?? undefined),
    [maxStayNights],
  );
  // Horizon = how far ahead you may book. Stay length is capped
  // separately by `maxNights` inside the normalizer / resolver.
  const maxCheckOut = useMemo(
    () => addDaysToIsoDate(todayIso, BOOKING_HORIZON_DAYS),
    [todayIso],
  );
  const twoMonths = useTwoMonthLayout();

  // DR-01: the resolved pair stays the source of truth for anything
  // OUTSIDE the calendar (URL params, pricing, availability). The
  // calendar commits into it; it never replaces it.
  const resolved = useMemo(
    () =>
      normalizeStayRange({
        checkIn,
        checkOut,
        minCheckIn: todayIso,
        maxCheckOut,
        maxNights,
      }),
    [checkIn, checkOut, todayIso, maxCheckOut, maxNights],
  );

  const [open, setOpen] = useState(false);

  // The calendar's own draft range. This is what makes the two-step
  // selection work: after the first click there is no check-out yet,
  // so the check-out box reads "Select check-out" instead of
  // flashing a provisional date the guest didn't choose.
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: isoToTzDate(resolved.checkIn),
    to: isoToTzDate(resolved.checkOut),
  }));

  // Re-sync the draft whenever the committed range changes from
  // outside (URL params on mount, a parent reset, the self-heal
  // below). Without this the calendar would show a stale range.
  useEffect(() => {
    setDraft({
      from: isoToTzDate(resolved.checkIn),
      to: isoToTzDate(resolved.checkOut),
    });
  }, [resolved.checkIn, resolved.checkOut]);

  // Self-heal: a bad pair from a URL or parent still can't render.
  useEffect(() => {
    if (resolved.checkIn !== checkIn) onCheckInChange(resolved.checkIn);
    if (resolved.checkOut !== checkOut) onCheckOutChange(resolved.checkOut);
  }, [resolved, checkIn, checkOut, onCheckInChange, onCheckOutChange]);

  const [hint, setHint] = useState<StayRangeAdjustmentReason | null>(null);
  useEffect(() => {
    if (resolved.adjustment) setHint(resolved.adjustment);
  }, [resolved.adjustment]);
  const hintText = hint ? describeAdjustment(hint, maxNights) : null;

  // DR-04: why the last click could not complete the range. Rendered in
  // BOTH the page flow and the sheet, because on phones the sheet covers
  // the flow area.
  const [selectionError, setSelectionError] = useState<string | null>(null);

  // Why the calendar is driven from `onSelect` and NOT `onDayClick`
  // (DR-04, owner-reported 2026-10-15). Two separate traps.
  //
  // (1) THE PHANTOM BAND. `useRange` decides controlled vs uncontrolled
  //     with `useControlledValue(selected, onSelect ? selected : undefined)`.
  //     With NO `onSelect` the controlled value is `undefined`, so the
  //     component falls back to its OWN internal state and calls
  //     `setSelected(addToRange(...))` on every click — `selected={draft}`
  //     is read ONCE as an initial value and then ignored. The band the
  //     guest saw was react-day-picker painting its own stale range (old
  //     check-in -> clicked day) on top of a draft that had already
  //     moved. Passing `onSelect` puts it in controlled mode, so the
  //     painted range is always exactly our `draft`.
  // (2) WE IGNORE ITS RANGE ANYWAY. `addToRange` checks
  //     `isAfter(date, from)` BEFORE `isAfter(date, to)`, so once a
  //     complete range exists, EVERY click later than its check-in is
  //     absorbed as "move the check-out here" and the old `from` is kept.
  //     A guest who wanted a different stay silently stretched the current
  //     one. So we take only `triggerDate` (the clicked day) and derive the
  //     range ourselves: a click completes a range ONLY while a pending
  //     check-in is waiting, and otherwise starts a new stay.
  const handleSelect = useCallback(
    (
      _rangeByLibrary: DateRange | undefined,
      clicked: Date,
    ) => {
      const clickedIso = tzDateToIso(clicked);
      const fromIso = draft?.from ? tzDateToIso(draft.from) : null;
      const toIso = draft?.to ? tzDateToIso(draft.to) : null;

      const completesPending =
        fromIso !== null && toIso === null && clickedIso > fromIso;
      const nextFrom = completesPending ? draft!.from! : clicked;
      const nextTo = completesPending ? clicked : undefined;

      const selection = resolveRangeSelection({
        from: tzDateToIso(nextFrom),
        to: nextTo ? tzDateToIso(nextTo) : null,
        minCheckIn: todayIso,
        maxCheckOut,
        maxNights,
      });

      if (selection.status === "complete") {
        setDraft({
          from: isoToTzDate(selection.checkIn),
          to: isoToTzDate(selection.checkOut),
        });
        setHint(null);
        setSelectionError(null);
        if (onRangeChange) {
          onRangeChange(selection.checkIn, selection.checkOut);
        } else {
          onCheckInChange(selection.checkIn);
          onCheckOutChange(selection.checkOut);
        }
        return;
      }
      if (selection.status === "cleared") {
        setDraft(undefined);
        setSelectionError(null);
        return;
      }
      // First click of a new selection — hold it as a pending check-in.
      // Committing here would fire an availability refetch, and
      // BookingPage swaps itself for a full-page "Checking room
      // availability…" loader that unmounts this picker, discarding the
      // half-made selection. The guest's single click would vanish.
      setDraft({ from: isoToTzDate(selection.checkIn), to: undefined });

      // DR-04: a click that CANNOT complete the range (here: a stay
      // longer than the cap) used to be swallowed with no
      // feedback at all — the check-out box simply stayed empty, which
      // reads as a broken picker. Say so, and keep the check-in so the
      // guest can immediately pick again. We do NOT silently clamp the
      // check-out: an invisible date move is the DR-01 failure mode.
      // Unreachable when unlimited: an over-cap range cannot exist if
      // `maxNights` is `Infinity`, so this branch stays quiet.
      const cap = describeMaxStayNights(maxNights);
      setSelectionError(
        completesPending
          ? `A single stay can run at most ${cap} — pick a check-out within ${cap} of your check-in.`
          : null,
      );
    },
    [
      draft,
      maxCheckOut,
      maxNights,
      onCheckInChange,
      onCheckOutChange,
      onRangeChange,
      todayIso,
    ],
  );

  const startMonth = isoToTzDate(todayIso);
  const endMonth = isoToTzDate(maxCheckOut);

  const checkInIso = draft?.from ? tzDateToIso(draft.from) : "";
  const checkOutIso = draft?.to ? tzDateToIso(draft.to) : "";
  const nights =
    checkInIso && checkOutIso
      ? Math.max(diffNightsBetweenIso(checkInIso, checkOutIso), 1)
      : 0;

  const dateBox = (label: string, iso: string, placeholder: string) => (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className={cn(
        "grid min-h-11 gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
        open
          ? "border-primary ring-2 ring-primary-light"
          : "border-gray-200 hover:border-gray-300",
      )}
    >
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className={cn("text-sm", iso ? "text-gray-950" : "text-gray-400")}>
        {iso ? formatStayDate(iso) : placeholder}
      </span>
    </button>
  );

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          "grid gap-2",
          orientation === "horizontal" && "sm:grid-cols-2",
        )}
      >
        {dateBox("Check-in", checkInIso, "Select date")}
        {dateBox(
          "Check-out",
          checkOutIso,
          nights > 0 ? "" : "Select check-out",
        )}
      </div>

      <p className="text-sm font-medium text-gray-700">
        {nights > 0 ? (
          <>
            {formatStayDate(checkInIso)} — {formatStayDate(checkOutIso)}
            <span className="ml-2 font-normal text-gray-500">
              · {nights} {nights === 1 ? "night" : "nights"}
            </span>
          </>
        ) : (
          <span className="font-normal text-gray-500">
            Select a check-in and check-out date.
          </span>
        )}
      </p>

      {selectionError ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {selectionError}
        </p>
      ) : null}

      {hintText ? (
        <p role="status" className="text-xs font-medium text-primary">
          {hintText}
        </p>
      ) : null}

      {open ? (
        <>
          {/* Backdrop — mobile only. The desktop calendar is an inline
              card, so it must not dim the page behind it there. */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-gray-950/40 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "spark-date-range z-50 border border-gray-200 bg-white shadow-sm",
              // Phones: a bottom sheet sized to its CONTENT and anchored to
              // the bottom edge. It used to stretch from `top-16` to
              // `bottom-0`, so a five-row month left roughly half the
              // screen as dead white space below the Done button. No
              // `top` means height:auto; `max-h` caps it for short
              // viewports and two-month layouts, and only then does it
              // scroll. It still has to overlay the page — inline, the
              // grid fell below the fold and was clipped by the sticky
              // cart bar.
              "fixed inset-x-0 bottom-0 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-t-card p-4",
              // Desktop: back to an inline card in the flow.
              "md:static md:inset-auto md:z-auto md:max-h-none md:overflow-visible md:rounded-card md:p-3",
            )}
            // Hard rule: all primary CTAs use `config.colors.primary`.
            // react-day-picker ships a blue default for the selected
            // range, which would put an off-brand colour on the single
            // most prominent element of the booking flow. Scoped to this
            // wrapper rather than declared globally so the override
            // cannot leak into any other surface.
            style={
              {
                "--spark-primary": config.colors.primary,
              } as React.CSSProperties
            }
          >
            {selectionError ? (
              <p
                role="alert"
                className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 md:hidden"
              >
                {selectionError}
              </p>
            ) : null}
            <div className="mb-2 flex items-center justify-between md:hidden">
              <p className="text-sm font-semibold text-gray-950">
                {checkInIso && !checkOutIso
                  ? "Now pick a check-out date"
                  : "Select your dates"}
              </p>
              <button
                type="button"
                aria-label="Close calendar"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500"
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            {/* `classNames` SHALLOW-MERGES over react-day-picker's defaults
                (`{ ...getDefaultClassNames(), ...props.classNames }`), so
                naming a slot REPLACES its default rather than adding to it.
                Dropping `rdp-root` silently un-defines every `--rdp-*`
                variable the stylesheet declares on it — day cells collapse
                from 42px to their text width. Keep `rdp-root` and APPEND. */}
            <DayPicker
              mode="range"
              timeZone={config.timezone}
              classNames={{ root: "rdp-root spark-range-root" }}
              autoFocus
              selected={draft}
              onSelect={handleSelect}
              defaultMonth={startMonth}
              startMonth={startMonth}
              endMonth={endMonth}
              numberOfMonths={twoMonths ? 2 : 1}
              disabled={{ before: startMonth, after: endMonth }}
              showOutsideDays={false}
            />
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
              <button
                type="button"
                className="hidden text-xs font-medium text-gray-600 hover:text-gray-900 md:inline-flex"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
              {/* Phones already show this instruction in the sheet
                  header, so repeating it down here was duplicate text
                  competing with the only control that matters. Desktop
                  keeps the inline hint because it has no header row
                  there. */}
              <span className="hidden text-xs text-gray-500 md:inline">
                {checkInIso && !checkOutIso
                  ? "Now pick a check-out date."
                  : "Select a check-in, then a check-out date."}
              </span>
              {/* Phones get an explicit Done affordance — the sheet has no
                  click-outside affordance, and the header X is small. Full
                  width because it is the primary action and sits in the
                  thumb zone at the bottom of the sheet. */}
              <button
                type="button"
                className="min-h-11 w-full rounded-lg px-4 text-sm font-semibold text-white md:hidden"
                style={{ backgroundColor: config.colors.primary }}
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
