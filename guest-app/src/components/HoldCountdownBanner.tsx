// HoldCountdownBanner — the in-flow hold UI for the
// public booking flow's Steps 2 + 3.
//
// Surfaces:
//   * **active** + time left: blue/indigo banner with a
//     live MM:SS countdown. Honest copy: "Your room is
//     held for you while you finish and pay. We'll lock
//     it in the moment you confirm — if another guest
//     books first, we'll let you know and you can pick
//     a new room."
//   * **expired** (or the local clock has crossed
//     `expiresAt`): red banner. "Your hold has expired.
//     Return to Step 1 to pick a new room, or finish
//     quickly — if another guest gets the room first
//     we'll let you know before you pay."
//   * **consumed** (the booking transaction committed):
//     the banner hides entirely — the Step 4
//     confirmation page is the next surface.
//   * **error** (fetch failed): muted gray banner with
//     a "Retry" CTA so the user is not stranded.
//
// The component is fully self-contained: it reads the
// `holdId` prop, fetches + ticks via `useInFlowHold`,
// and renders a sticky banner that's dismissable in
// the error case only (the active/expired banners are
// always visible while the user is in the flow).
//
// The "Pick a new room" CTA on the expired state calls
// the optional `onPickNewRoom` prop — BookingPage wires
// this to `setSearchParams({ step: "select-room", ... })`
// with `replace: true` so the user lands back on Step 1
// without stacking history.

import { Clock4, Hourglass, RefreshCcw } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useInFlowHold, type InFlowHoldStartInput } from "../hooks/useInFlowHold";
import { cn } from "../utils/cn";

interface HoldCountdownBannerProps {
  /** Opaque hold id, mirrors the URL ?hold= param. When null, the component renders nothing. */
  holdId: string | null | undefined;
  /**
   * Booking context the hook needs to stamp the hold on
   * first read. Required when `holdId` is present —
   * the hook fires POST /api/holds/start when the GET
   * returns 404, and that call needs the booking
   * context. BookingPage passes this in from URL params
   * + the Turnstile token.
   */
  startInput?: InFlowHoldStartInput | null;
  /** Called when the user taps "Pick a new room" on the expired state. BookingPage wires this to Step 1. */
  onPickNewRoom?: () => void;
  /** Optional locale override for the AM/PM time format. Defaults to `en-PH`. */
  locale?: string;
}

function formatTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function HoldCountdownBanner({
  holdId,
  startInput,
  onPickNewRoom,
  locale = "en-PH"
}: HoldCountdownBannerProps) {
  const shouldReduceMotion = useReducedMotion();
  const { hold, secondsLeft, isExpired, isConsumed, isLoading, error, refresh } =
    useInFlowHold(holdId, startInput ?? null);

  if (!holdId) return null;
  if (isConsumed) return null;

  // Loading skeleton — the first paint before the
  // fetch resolves. Cheap, two-line layout, same
  // height as the active state so the page doesn't
  // jump on hydration.
  if (isLoading && !hold && !error) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full border-b border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
        data-testid="hold-countdown-banner"
        data-state="loading"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Hourglass className="h-4 w-4 shrink-0 animate-pulse text-indigo-500" aria-hidden />
          <span className="font-medium">Loading your room hold…</span>
        </div>
      </div>
    );
  }

  if (error && !hold) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        data-testid="hold-countdown-banner"
        data-state="error"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <span className="font-medium">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!hold) return null;

  // Expired state — red banner, "Pick a new room" CTA.
  if (isExpired) {
    return (
      <motion.div
        role="alert"
        aria-live="assertive"
        initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full border-b border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        data-testid="hold-countdown-banner"
        data-state="expired"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <Clock4 className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Your hold has expired.</p>
            <p className="text-xs text-red-800/80">
              Return to Step 1 to pick a new room, or finish quickly — if another guest gets the room first, we'll let you know before you pay.
            </p>
          </div>
          {onPickNewRoom ? (
            <button
              type="button"
              onClick={onPickNewRoom}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Pick a new room
            </button>
          ) : null}
        </div>
      </motion.div>
    );
  }

  // Active state — blue banner, live countdown.
  const expiresAt = formatTime(hold.expiresAt, locale);
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full border-b border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950"
      data-testid="hold-countdown-banner"
      data-state="active"
      data-seconds-left={secondsLeft}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <Clock4 className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            Your room is held for you until {expiresAt || "the hold expires"}.
          </p>
          <p className="text-xs text-indigo-900/80">
            We'll lock it in the moment you confirm — if another guest books first, we'll let you know and you can pick a new room.
          </p>
        </div>
        <div
          className={cn(
            "rounded-full bg-white px-3 py-1 text-sm font-semibold tabular-nums ring-1 ring-inset",
            secondsLeft <= 60
              ? "text-red-700 ring-red-200"
              : secondsLeft <= 180
                ? "text-amber-700 ring-amber-200"
                : "text-indigo-700 ring-indigo-200"
          )}
          aria-label={`Time left: ${formatCountdown(secondsLeft)}`}
        >
          <span className="text-xs font-medium text-gray-500">Time left&nbsp;</span>
          {formatCountdown(secondsLeft)}
        </div>
      </div>
    </motion.div>
  );
}
