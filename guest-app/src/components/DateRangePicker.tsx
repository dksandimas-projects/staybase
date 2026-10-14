import { useEffect, useMemo, useState } from "react";
import {
  addDaysToIsoDate,
  diffNightsBetweenIso,
  getDateKeyInTimezone,
  normalizeStayRange,
  type StayRangeAdjustmentReason
} from "@spark-inn/shared";
import { Minus, Moon, Plus } from "lucide-react";
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
 * Copy for each auto-correction. Per the industry pattern (Agoda's
 * "Nights" ticker, Booking.com's adjusting calendar) the stay
 * LENGTH is a control the guest owns and can see — so once the
 * nights stepper below is on screen, a correction that merely
 * preserves that visible length is self-explanatory and needs no
 * message. Only corrections the guest cannot infer from the
 * inputs get one; announcing those is what stops a silent
 * auto-move from reading as a broken form.
 */
function describeAdjustment(
  reason: StayRangeAdjustmentReason,
  nights: number
): string | null {
  switch (reason) {
    case "nights-preserved":
      // The stepper already shows `nights`, and check-out is
      // visibly check-in + nights. Nothing to explain.
      return null;
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
  // past check-out we reuse this so the stay length the guest
  // already chose is preserved rather than silently collapsing to
  // 1. Now that the nights stepper renders this value, the guest
  // can see it — but the behaviour is unchanged.
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

  // The stepper can only offer as many nights as the booking
  // horizon still allows from the current check-in. Measured from
  // the check-in, not from today — a check-in 20 days out with a
  // 30-night horizon only has 10 nights of room.
  const maxNights = Math.max(
    Math.min(MAX_STAY_NIGHTS, diffNightsBetweenIso(resolved.checkIn, maxCheckOut)),
    1
  );

  function setNights(next: number) {
    setHint(null);
    onCheckOutChange(addDaysToIsoDate(resolved.checkIn, next));
  }

  const checkInField = (
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
  );

  const checkOutField = (
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
  );

  // Matches the existing Adults / Children steppers on the booking
  // page (same markup, same 44px touch targets, same disabled
  // treatment). Making the stay length a visible control is what
  // turns "check-out moved on its own" from arbitrary into
  // obvious: check-out is always check-in + this number.
  const nightsStepper = (
    <label className="grid gap-2 text-sm font-medium text-gray-700">
      Nights
      <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
        <button
          aria-label="Remove one night"
          className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={resolved.nights <= 1}
          type="button"
          onClick={() => setNights(resolved.nights - 1)}
        >
          <Minus size={16} />
        </button>
        <span className="flex items-center gap-2 text-sm text-gray-700">
          <Moon size={16} className="text-primary" />
          {resolved.nights} {resolved.nights === 1 ? "night" : "nights"}
        </span>
        <button
          aria-label="Add one night"
          className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={resolved.nights >= maxNights}
          type="button"
          onClick={() => setNights(resolved.nights + 1)}
        >
          <Plus size={16} />
        </button>
      </div>
    </label>
  );

  return (
    <div className="grid gap-2">
      {orientation === "horizontal" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {checkInField}
            {checkOutField}
          </div>
          {nightsStepper}
        </>
      ) : (
        <>
          {checkInField}
          {nightsStepper}
          {checkOutField}
        </>
      )}
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