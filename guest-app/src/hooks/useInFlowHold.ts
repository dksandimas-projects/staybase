// useInFlowHold — fetches the in-flow hold (Steps 2 + 3
// countdown banner) and exposes a ticking countdown to
// the component.
//
// Lifecycle:
//   1. On mount (or when `holdId` changes), the hook
//      tries GET /api/holds/:holdId.
//   2. If GET returns 404, the hold hasn't been
//      stamped yet (the user just navigated from
//      Step 1 with a fresh `holdId`). The hook fires
//      POST /api/holds/start with the supplied
//      `startInput` (idempotent — a second POST with
//      the same holdId is a no-op replay) and
//      re-reads.
//   3. The hook captures the server's `expiresAt`
//      (authoritative timestamp) and ticks every 1
//      second using `Date.now()`. A 30-second
//      resync re-fetch is wired in for the rare
//      clock-skew case.
//   4. When the local clock crosses `expiresAt`, the
//      banner flips to the red "Hold expired" state —
//      the booking transaction at Step 3's Confirm
//      re-checks the server, so a wrong-local-clock
//      banner is at worst a slight UX glitch, not a
//      safety issue.
//
// Why not `onSnapshot`? The Firestore rules for
// `bookingHolds/{id}` are intentionally narrow — we
// don't want every anonymous guest to be able to
// listen to every hold. The hold id is
// client-preallocated (UUIDv4) + opaque, so the
// fetch-by-id surface is the same trust model as
// the booking lookup endpoint. The polling is
// cheap (1 request per page mount) and matches the
// existing /api/bookings/lookup pattern.

import { useEffect, useMemo, useRef, useState } from "react";

export interface InFlowHoldView {
  id: string;
  reservationId: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  expiresAt: string;
  status: "active" | "consumed" | "expired";
  holdMinutes: number;
}

export interface InFlowHoldStartInput {
  reservationId: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  numNights: number;
  turnstileToken?: string;
}

export interface UseInFlowHoldResult {
  hold: InFlowHoldView | null;
  secondsLeft: number;
  isExpired: boolean;
  isConsumed: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

const RESYNC_MS = 30_000;
const TICK_MS = 1_000;

export function useInFlowHold(
  holdId: string | null | undefined,
  startInput: InFlowHoldStartInput | null
): UseInFlowHoldResult {
  const [hold, setHold] = useState<InFlowHoldView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(holdId));
  const [now, setNow] = useState<number>(() => Date.now());
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    if (!holdId) {
      setHold(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      let json: any = null;
      try {
        const readResponse = await fetch(
          `/api/holds/read?holdId=${encodeURIComponent(holdId as string)}`,
          { method: "GET", headers: { Accept: "application/json" } }
        );
        if (cancelled) return;
        if (readResponse.status === 404 && startInput) {
          // Hold not stamped yet — start it. The
          // /api/holds/start endpoint is
          // idempotent on the same holdId, so a
          // second POST is a no-op replay. The
          // endpoint is rate-limit-only — no
          // Turnstile (the useTurnstileToken hook
          // is gated to isReviewStep and isn't
          // loaded when the banner fires on
          // Step 2 mount; the actual security
          // gate is the booking transaction's
          // /api/bookings/create). See
          // fix/holds-start-turnstile.
          await fetch("/api/holds/start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              holdId,
              reservationId: startInput.reservationId,
              roomType: startInput.roomType,
              checkIn: startInput.checkIn,
              checkOut: startInput.checkOut,
              numNights: startInput.numNights
            })
          });
          if (cancelled) return;
          const retry = await fetch(
            `/api/holds/read?holdId=${encodeURIComponent(holdId as string)}`,
            { method: "GET", headers: { Accept: "application/json" } }
          );
          if (cancelled) return;
          if (!retry.ok) {
            setError("We couldn't load the hold timer. The booking will still go through if you finish in time.");
            setHold(null);
            setIsLoading(false);
            return;
          }
          json = await retry.json();
        } else if (!readResponse.ok) {
          setError("We couldn't load the hold timer. The booking will still go through if you finish in time.");
          setHold(null);
          setIsLoading(false);
          return;
        } else {
          json = await readResponse.json();
        }
      } catch (err) {
        if (cancelled) return;
        setError("We couldn't load the hold timer. The booking will still go through if you finish in time.");
        setIsLoading(false);
        return;
      }
      if (cancelled) return;
      if (json && json.success && json.data) {
        setHold(json.data as InFlowHoldView);
        setError(null);
      } else {
        setError("We couldn't load the hold timer. The booking will still go through if you finish in time.");
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [holdId, refreshTick, startInput?.reservationId, startInput?.roomType, startInput?.checkIn, startInput?.checkOut, startInput?.numNights, startInput?.turnstileToken]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!holdId) return;
    if (hold && hold.status !== "active") return;
    const interval = setInterval(() => {
      setRefreshTick((value) => value + 1);
    }, RESYNC_MS);
    return () => clearInterval(interval);
  }, [holdId, hold?.status]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const expiresAtMs = useMemo(() => {
    if (!hold?.expiresAt) return 0;
    const ms = new Date(hold.expiresAt).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }, [hold?.expiresAt]);

  const secondsLeft = expiresAtMs > 0 ? Math.floor((expiresAtMs - now) / 1000) : 0;

  const isExpired = Boolean(hold && (hold.status !== "active" || secondsLeft <= 0));
  const isConsumed = hold?.status === "consumed";

  return {
    hold,
    secondsLeft,
    isExpired,
    isConsumed,
    isLoading,
    error,
    refresh: () => setRefreshTick((value) => value + 1)
  };
}
