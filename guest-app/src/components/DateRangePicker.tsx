import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDaysToIsoDate,
  diffNightsBetweenIso,
  getDateKeyInTimezone,
  isValidIsoDate,
  normalizeStayRange,
  resolveRangeSelection,
  type StayRangeAdjustmentReason
} from "@spark-inn/shared";
import { DayPicker, TZDate, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import config from "@config";
import { cn } from "../utils/cn";

type DateRangePickerOrientation = "horizontal" | "vertical";

interface DateRangePickerProps {
  checkIn: string;
  checkOut: string;
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
  orientation?: DateRangePickerOrientation;
}

// DR-01 (2026-10-14): furthest a guest may book ahead. Also caps
// how long a single stay may run, so a stale URL param can't
// request a 4000-night stay.
const MAX_STAY_NIGHTS = 30;

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
function isoToTzDate(iso: string): TZDate {
  return new TZDate(`${iso}T00:00:00`, config.timezone);
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
    year: "numeric"
  });
}

/**
 * Copy for each auto-correction. The range calendar makes most
 * corrections unrepresentable, so this only fires for inputs that
 * arrived from outside the picker (a shared `?checkIn=` link, a
 * past date, a horizon overrun).
 */
function describeAdjustment(reason: StayRangeAdjustmentReason): string | null {
  switch (reason) {
    case "check-in-clamped-to-today":
      return "Check-in can't be in the past — moved to today.";
    case "horizon-capped":
      return `Bookings open ${MAX_STAY_NIGHTS} nights ahead, so check-out was capped.`;
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
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
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
  orientation = "vertical"
}: DateRangePickerProps) {
  const todayIso = useMemo(() => getDateKeyInTimezone(config.timezone), []);
  const maxCheckOut = useMemo(
    () => addDaysToIsoDate(todayIso, MAX_STAY_NIGHTS),
    [todayIso]
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
        maxCheckOut
      }),
    [checkIn, checkOut, todayIso, maxCheckOut]
  );

  const [open, setOpen] = useState(false);

  // The calendar's own draft range. This is what makes the two-step
  // selection work: after the first click there is no check-out yet,
  // so the check-out box reads "Select check-out" instead of
  // flashing a provisional date the guest didn't choose.
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: isoToTzDate(resolved.checkIn),
    to: isoToTzDate(resolved.checkOut)
  }));

  // Re-sync the draft whenever the committed range changes from
  // outside (URL params on mount, a parent reset, the self-heal
  // below). Without this the calendar would show a stale range.
  useEffect(() => {
    setDraft({ from: isoToTzDate(resolved.checkIn), to: isoToTzDate(resolved.checkOut) });
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
  const hintText = hint ? describeAdjustment(hint) : null;

  const handleSelect = useCallback(
    (range: DateRange | undefined) => {
      const selection = resolveRangeSelection({
        from: range?.from ? tzDateToIso(range.from) : null,
        to: range?.to ? tzDateToIso(range.to) : null,
        minCheckIn: todayIso,
        maxCheckOut
      });

      if (selection.status === "cleared") {
        setDraft(undefined);
        return;
      }
      if (selection.status === "complete") {
        setDraft({ from: isoToTzDate(selection.checkIn), to: isoToTzDate(selection.checkOut) });
        setHint(null);
        onCheckInChange(selection.checkIn);
        onCheckOutChange(selection.checkOut);
        return;
      }
      // First click of a new selection — hold it as a pending
      // check-in and let the second click complete the range.
      // Committing here would fire an availability refetch, and
      // BookingPage swaps itself for a full-page "Checking room
      // availability…" loader that unmounts this picker, discarding
      // the half-made selection. The guest's single click would
      // silently vanish.
      setDraft({ from: isoToTzDate(selection.checkIn), to: undefined });
    },
    [maxCheckOut, onCheckInChange, onCheckOutChange, todayIso]
  );

  const startMonth = isoToTzDate(todayIso);
  const endMonth = isoToTzDate(maxCheckOut);

  const checkInIso = draft?.from ? tzDateToIso(draft.from) : "";
  const checkOutIso = draft?.to ? tzDateToIso(draft.to) : "";
  const nights =
    checkInIso && checkOutIso ? Math.max(diffNightsBetweenIso(checkInIso, checkOutIso), 1) : 0;

  const dateBox = (label: string, iso: string, placeholder: string) => (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className={cn(
        "grid min-h-11 gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
        open ? "border-primary ring-2 ring-primary-light" : "border-gray-200 hover:border-gray-300"
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
          orientation === "horizontal" && "sm:grid-cols-2"
        )}
      >
        {dateBox("Check-in", checkInIso, "Select date")}
        {dateBox("Check-out", checkOutIso, nights > 0 ? "" : "Select check-out")}
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
          <span className="font-normal text-gray-500">Select a check-in and check-out date.</span>
        )}
      </p>

      {hintText ? (
        <p role="status" className="text-xs font-medium text-primary">
          {hintText}
        </p>
      ) : null}

      {open ? (
        <div
          className="spark-date-range rounded-card overflow-x-auto border border-gray-200 bg-white p-3 shadow-sm"
          // Hard rule: all primary CTAs use `config.colors.primary`.
          // react-day-picker ships a blue default for the selected
          // range, which would put an off-brand colour on the single
          // most prominent element of the booking flow. Scoped to this
          // wrapper rather than declared globally so the override
          // cannot leak into any other surface.
          style={{
            "--rdp-accent-color": config.colors.primary,
            "--rdp-accent-background-color": config.colors.primary,
            "--rdp-today-color": config.colors.primary
          } as React.CSSProperties}
        >
          <DayPicker
            mode="range"
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
              className="text-xs font-medium text-gray-600 hover:text-gray-900"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            <span className="text-xs text-gray-500">Select a check-in, then a check-out date.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}