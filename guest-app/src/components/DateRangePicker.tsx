import { useEffect, useMemo, useState } from "react";
import {
  addDaysToIsoDate,
  diffNightsBetweenIso,
  getDateKeyInTimezone,
  normalizeStayRange,
  type StayRangeAdjustmentReason
} from "@spark-inn/shared";
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
 * Copy for each auto-correction. The point is to make a silent
 * correction legible — a guest who watches check-out slide to
 * Oct 18 without being told why will assume the picker is broken.
 */
function describeAdjustment(
  reason: StayRangeAdjustmentReason,
  nights: number
): string | null {
  switch (reason) {
    case "nights-preserved":
      return `Check-out moved to keep your ${nights}-night stay.`;
    case "check-out-clamped-after-check-in":
      return "Check-out must be at least one night after check-in.";
    case "check-in-clamped-to-today":
      return "Check-in can't be in the past — moved to today.";
    case "horizon-capped":
      return `Bookings open ${MAX_STAY_NIGHTS} nights ahead, so check-out was capped.`;
    case "invalid-check-in":
    case "invalid-check-out":
      return "We fixed an invalid date and kept your stay length.";
    default:
      return null;
  }
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

  // The last *valid* stay length. When check-in is moved onto or
  // past check-out we reuse this so a 2-night stay stays 2 nights
  // (Booking.com / Airbnb convention) instead of silently
  // collapsing to 1 and changing the price the guest agreed to.
  const [lastValidNights, setLastValidNights] = useState<number | null>(null);
  useEffect(() => {
    const nights = diffNightsBetweenIso(checkIn, checkOut);
    if (nights >= 1) setLastValidNights(nights);
  }, [checkIn, checkOut]);

  // DR-01: the resolved pair is what we RENDER, so an invalid value
  // arriving from a parent (a hand-edited or shared `?checkIn=`
  // link, the corporate stays form, any future call site) can never
  // put an inverted range on screen — not just when the guest
  // touches the inputs.
  const resolved = useMemo(
    () =>
      normalizeStayRange({
        checkIn,
        checkOut,
        minCheckIn: todayIso,
        previousNights: lastValidNights,
        maxCheckOut
      }),
    [checkIn, checkOut, todayIso, lastValidNights, maxCheckOut]
  );

  // Latch the reason so the hint survives the self-heal below —
  // once the parent state catches up the range is valid again and
  // `resolved.adjustment` goes null, which would make the
  // explanation flash for a single frame.
  const [hint, setHint] = useState<StayRangeAdjustmentReason | null>(null);
  useEffect(() => {
    if (resolved.adjustment) setHint(resolved.adjustment);
  }, [resolved.adjustment]);

  // Push the correction into the parent so the URL params, the
  // price summary and the availability query all see the same
  // range the inputs display.
  useEffect(() => {
    if (resolved.checkIn !== checkIn) onCheckInChange(resolved.checkIn);
    if (resolved.checkOut !== checkOut) onCheckOutChange(resolved.checkOut);
  }, [resolved, checkIn, checkOut, onCheckInChange, onCheckOutChange]);

  const hintText = hint ? describeAdjustment(hint, resolved.nights) : null;

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          "grid gap-3",
          orientation === "horizontal" && "sm:grid-cols-2"
        )}
      >
        <label className="grid gap-2 text-sm font-medium text-gray-700">
          Check-in
          <input
            className="min-h-11 rounded-lg border border-gray-200 px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
            // DR-01 follow-up (2026-10-15): do NOT bound check-in
            // by `checkOut - 1`. With the default 1-night stay,
            // check-out is always `checkIn + 1`, so that max
            // resolved to check-in's OWN current value and the
            // native picker greyed out every day after it — the
            // guest could not move check-in at all. The
            // `nights-preserved` correction path exists precisely
            // to handle check-in landing after check-out, so the
            // bound has to leave that path reachable. The upper
            // bound here is the booking horizon, not the other
            // field.
            max={maxCheckOut}
            min={todayIso}
            type="date"
            value={resolved.checkIn}
            aria-describedby={hintText ? "date-range-hint" : undefined}
            onChange={(event) => {
              setHint(null);
              onCheckInChange(event.target.value);
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-gray-700">
          Check-out
          <input
            className="min-h-11 rounded-lg border border-gray-200 px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
            max={maxCheckOut}
            min={addDaysToIsoDate(resolved.checkIn, 1)}
            type="date"
            value={resolved.checkOut}
            aria-describedby={hintText ? "date-range-hint" : undefined}
            onChange={(event) => {
              setHint(null);
              onCheckOutChange(event.target.value);
            }}
          />
        </label>
      </div>
      {hintText ? (
        <p
          id="date-range-hint"
          role="status"
          className="flex items-start gap-1.5 text-xs font-medium text-primary"
        >
          {hintText}
        </p>
      ) : null}
    </div>
  );
}