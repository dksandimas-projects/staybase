// HoldCountdownBanner — the in-flow hold UI for the
// public booking flow's Steps 2 + 3.
//
// Surfaces:
//   * **active** + time left: brand-tinted banner with a
//     live MM:SS countdown. Per MBUX-01 (2026-10-15) the
//     active state is COMPACT on mobile — a single line
//     reading `Room held · 13:21 remaining`, with the full
//     explanation behind a `What is this?` disclosure. From
//     `sm:` up the full copy is shown unconditionally, so
//     desktop is unchanged. Honest copy: "Your room is
//     held for you while you finish and pay. We'll lock
//     it in the moment you confirm — if another guest
//     books first, we'll let you know and you can pick
//     a new room."
//   * **expired** (or the local clock has crossed
//     `expiresAt`): red banner. "Your hold has expired."
//     Per IMT-03 the PRIMARY action here is "I need more
//     time" (brand `primary`); "Pick a new room" demotes
//     to a secondary outline. Both stay one tap.
//   * **consumed** (the booking transaction committed):
//     the banner hides entirely — the Step 4
//     confirmation page is the next surface.
//   * **error** (fetch failed): amber banner with a
//     "Retry" CTA so the user is not stranded.
//
// COLOR POLICY (IMT-05)
// The active state is brand-tinted via the `primary*`
// Tailwind tokens so a white-label hotel's booking banner
// adopts their colors. The expired (danger) and error
// (warning) surfaces stay on Tailwind's red/amber palette
// DELIBERATELY: those are semantic state signals, not brand
// color, and they match the rest of the guest app
// (`border-amber-200 bg-amber-50` is the established
// warning banner, and `bg-red-600` the established danger
// action). Rebranding "your hold expired" to orange would
// destroy the signal.
//
// The one deliberate exception to the app-wide
// `bg-primary text-white` convention: the CTAs here use
// `text-gray-900`, because #EA8A1A on white is 2.58:1 and
// fails WCAG AA, while #EA8A1A on gray-900 is 6.88:1. The
// app-wide 2.58:1 issue is filed separately — see the
// IMT-05 note in `plan/project/ROADMAP.md`.
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

import { Clock4, Hourglass, Info, RefreshCcw, TimerReset } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useState } from "react";
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

/**
 * Per IMT-03 follow-up (2026-10-14): how close to expiry the "I need
 * more time" CTA reveals on the ACTIVE state.
 *
 * The button used to sit next to the countdown for the whole window,
 * which meant it competed with the banner's actual message and invited
 * the occasional reflex tap. Revealing it only as the deadline nears
 * makes it read as "this is the moment to ask" — and it disappears
 * again after an extension, so it can never be habitually clicked.
 *
 * **Why 60s and not a much tighter window.** The reason this feature
 * exists is a guest mid-payment on a slow connection or mid-terms
 * read. Those are exactly the flows that blow past 15 seconds without
 * looking up, and a 15s reveal would drop them into the expired state —
 * the *worse* experience — when extending while still calm was
 * available to them. 60s is long enough to survive a distracted
 * glance and short enough that the guest still perceives it as
 * time-critical.
 *
 * **Why 60 specifically, and not an arbitrary number.** It is the
 * countdown pill's own red-tier boundary (see the ring/text classes
 * below). The CTA appears at the exact moment the timer already *looks*
 * alarming, so the reveal is motivated by a signal that is already on
 * screen rather than introducing a fourth, arbitrary threshold.
 *
 * Not a server concern: the cap and status gate are still the server's
 * (`canExtendInFlowHold`). This is purely when the affordance is shown.
 */
const HOLD_EXTEND_CTA_REVEAL_SECONDS = 60;

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
  const {
    hold,
    secondsLeft,
    isExpired,
    isConsumed,
    isLoading,
    error,
    refresh,
    // --- IMT-03: the "I need more time" surface ---
    extendHold,
    isExtending,
    extendError,
    canExtend
  } = useInFlowHold(holdId, startInput ?? null);

  /**
   * IMT-03: announcements live in their OWN visually-hidden live
   * region rather than inside the banner.
   *
   * The banner previously carried `role="status" aria-live="polite"`
   * while containing a countdown that re-renders EVERY SECOND — which
   * means a screen reader was being handed a text mutation once per
   * second. That is a live-region flood, and it also meant any
   * extension announcement would have been drowned by the ticking
   * digits. The ticking container is now a plain region; only
   * meaningful, infrequent messages go through this state.
   */
  const [announcement, setAnnouncement] = useState<string>("");

  /**
   * MBUX-01 (2026-10-15): whether the mobile guest has expanded the
   * full hold explanation. Desktop (`sm:` and up) never consults
   * this — the copy is always visible there — so the flag only ever
   * changes the phone layout.
   */
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const handleExtend = useCallback(async () => {
    // Clear first so re-announcing the same outcome (e.g. the guest
    // taps twice and both fail identically) still registers as a
    // change rather than being swallowed as an unchanged node.
    setAnnouncement("");
    const result = await extendHold();
    if (result.ok) {
      setAnnouncement(
        result.expiresAt
          ? `Done — your room is held until ${formatTime(result.expiresAt, locale)}.`
          : "Done — we've added more time to your room hold."
      );
      return;
    }
    setAnnouncement(result.error || "We couldn't extend your hold right now.");
  }, [extendHold, locale]);

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
        className="w-full border-b border-primary/40 bg-primary-light px-4 py-3 text-sm text-gray-900"
        data-testid="hold-countdown-banner"
        data-state="loading"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Hourglass className="h-4 w-4 shrink-0 animate-pulse text-primary" aria-hidden />
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

  // Expired state — red banner. Per IMT-03, "I need more time" is the
  // PRIMARY action here and "Pick a new room" demotes to secondary: a
  // guest who just watched the timer hit 0:00 wants to CONTINUE, not
  // restart. The two are both one tap, so nothing is taken away — only
  // the emphasis moves to the one the request describes.
  if (isExpired) {
    return (
      <motion.div
        role="alert"
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
              {canExtend
                ? "Need a bit more time? Ask for more and carry on where you left off — if another guest gets the room first, we'll let you know before you pay."
                : "This hold can't be extended any further. Pick a new room to carry on, or finish quickly — if another guest gets the room first, we'll let you know before you pay."}
            </p>
            {extendError ? (
              <p className="mt-1 text-xs font-medium text-red-700" data-testid="hold-extend-error">
                {extendError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExtend ? (
              <button
                type="button"
                onClick={handleExtend}
                disabled={isExtending}
                data-testid="hold-extend-cta"
                data-state={isExtending ? "extending" : "idle"}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-gray-900 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                <TimerReset className="h-3.5 w-3.5" aria-hidden />
                {isExtending ? "Adding time…" : "I need more time"}
              </button>
            ) : null}
            {onPickNewRoom ? (
              <button
                type="button"
                onClick={onPickNewRoom}
                data-testid="hold-pick-new-room-cta"
                className="inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                Pick a new room
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    );
  }

  // Active state — brand-tinted banner, live countdown.
  const expiresAt = formatTime(hold.expiresAt, locale);
  // Urgent-only reveal — see HOLD_EXTEND_CTA_REVEAL_SECONDS. Once an
  // extension lands, `secondsLeft` jumps back to a full window, so the
  // CTA hides again and can only re-arm after another countdown.
  const showExtendCta = canExtend && secondsLeft <= HOLD_EXTEND_CTA_REVEAL_SECONDS;
  return (
    <motion.div
      // Per IMT-03: deliberately NOT a live region. This subtree
      // re-renders every second (the MM:SS pill), so wrapping it in a
      // polite live region would emit one screen-reader announcement
      // per second — and would drown any extension message. Meaningful
      // messages go through the dedicated sr-only live region rendered
      // at the bottom of this branch instead.
      role="region"
      aria-label="Room hold status"
      initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full border-b border-primary/40 bg-primary-light px-4 py-3 text-sm text-gray-900"
      data-testid="hold-countdown-banner"
      data-state="active"
      data-seconds-left={secondsLeft}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
        <Clock4 className="h-4 w-4 shrink-0 text-primary-dark" aria-hidden />

        {/* MBUX-01: the compact mobile state — ONE line carrying the
            same "held / how long" facts the desktop block leads with.
            Pre-MBUX-01 this banner opened with a two-line headline and
            a two-line paragraph, which on a 375px phone pushed the
            Step 2 content below the fold on every single render. */}
        <p className="min-w-0 flex-1 text-sm font-semibold text-gray-900 sm:hidden">
          Room held · {formatCountdown(secondsLeft)} remaining
        </p>

        {/* The full explanation. Always visible from `sm:` up; on mobile
            it sits behind the info affordance below. NOTE the countdown
            is NOT duplicated: the mobile line above reads it, the pill
            below reads it from `sm:` up, and `display:none` keeps only
            one of them in the accessibility tree at any width — so the
            ticking digits are never announced twice. */}
        <div
          id="hold-help-text"
          className={cn("min-w-0 sm:flex-1 sm:block", isHelpOpen ? "block w-full" : "hidden")}
        >
          <p className="font-semibold text-gray-900">
            Your room is held for you until {expiresAt || "the hold expires"}.
          </p>
          <p className="text-xs text-gray-700">
            We'll lock it in the moment you confirm — if another guest books first, we'll let you know and you can pick a new room.
          </p>
        </div>

        {/* Per MBUX-01: an extension failure is NOT allowed to hide
            behind the collapsed explanation. A mobile guest who
            expanded nothing and still needs to know the extend button
            failed would otherwise meet a silently broken CTA. */}
        {extendError ? (
          <p className="w-full text-xs font-medium text-amber-700" data-testid="hold-extend-error">
            {extendError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {/* Countdown pill — `sm:` and up only; the compact line
              above carries the same MM:SS on mobile. */}
          <div
            className={cn(
              "hidden rounded-full bg-white px-3 py-1 text-sm font-semibold tabular-nums ring-1 ring-inset sm:inline-flex",
              secondsLeft <= 60
                ? "text-red-700 ring-red-200"
                : secondsLeft <= 180
                  ? "text-amber-700 ring-amber-200"
                  : "text-gray-700 ring-gray-200"
            )}
            aria-label={`Time left: ${formatCountdown(secondsLeft)}`}
          >
            <span className="text-xs font-medium text-gray-500">Time left&nbsp;</span>
            {formatCountdown(secondsLeft)}
          </div>
          {/* MBUX-01: mobile-only information affordance. 44px target;
              `aria-expanded` + `aria-controls` carry the state without
              relying on the label change alone. */}
          <button
            type="button"
            onClick={() => setIsHelpOpen((v) => !v)}
            aria-expanded={isHelpOpen}
            aria-controls="hold-help-text"
            data-testid="hold-info-toggle"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-primary/40 bg-white px-2.5 text-xs font-semibold text-gray-900 sm:hidden"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
            {isHelpOpen ? "Hide" : "What is this?"}
          </button>
          {/* Secondary affordance while the hold is still running — the
              guest gets more room than the full 15 minutes without ever
              having to hit zero. Hidden once the cap is spent so the
              guest never taps a button the server would 409, and hidden
              until the timer is genuinely urgent (see
              HOLD_EXTEND_CTA_REVEAL_SECONDS). */}
          {showExtendCta ? (
            <button
              type="button"
              onClick={handleExtend}
              disabled={isExtending}
              data-testid="hold-extend-cta"
              data-state={isExtending ? "extending" : "idle"}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-primary bg-white px-3 text-xs font-semibold text-gray-900 hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              <TimerReset className="h-3.5 w-3.5" aria-hidden />
              {isExtending ? "Adding time…" : "I need more time"}
            </button>
          ) : null}
        </div>
      </div>
      {/* The ONLY live region in this component. Renders nothing until an
          extension resolves, so the ticking countdown above cannot
          flood a screen reader. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="hold-announcement">
        {announcement}
      </p>
    </motion.div>
  );
}
