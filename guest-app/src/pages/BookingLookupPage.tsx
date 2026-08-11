import { AlertTriangle, ArrowLeft, BedDouble, Calendar, CalendarPlus, History, ListChecks, Mail, Search, ShieldAlert, Sparkles, Users, Wallet } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { GUEST_CANCELLABLE_STATUSES, RESERVATION_REF_REGEX, resolvePaymentMethodLabel, scaleIn } from "@spark-inn/shared";
import type { BookingRateBreakdown, CancellationPreview } from "@spark-inn/shared";
import config from "@config";
import { db } from "../firebase/config";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { Modal } from "../components/Modal";
import { CancellationPreviewPanel } from "../components/CancellationPreviewPanel";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusBadge } from "../components/StatusBadge";
import { PriceBreakdown } from "../components/PriceBreakdown";
import { formatPrice } from "../utils/format";
import { cn } from "../utils/cn";
import { useTurnstileToken } from "../hooks/useTurnstileToken";

interface BookingData {
  id: string;
  bookingRef: string;
  // Per decisions #126 (2026-07-25) + #128 (2026-07-25) +
  // #131 (2026-07-25): the public /my-booking page never
  // reflects the guest name back to the caller. The picker
  // (#126) and the email-alone 1-match single card (#128)
  // already dropped it; #131 extends the same rule to the
  // strict paths (ref+email, ref+token, ref alone, token
  // alone). The `guestName` field is gone from the wire
  // entirely; the booking doc still stores it for staff-
  // gated readers (drawer, table, PDF, email).
  // The card uses `maskedEmail` (first char of local +
  // *** + full domain) as a low-fidelity echo of the
  // search key — the attacker already typed the email so
  // there's no new leak, and the legit user gets a small
  // "yes, the search keyed on the email I typed"
  // confirmation. The full email is NOT on the card; the
  // cancel + resend flows use the value the user typed
  // into the form (kept in local `emailInput` state), which
  // the server already validated via the lookup.
  maskedEmail: string;
  guestPhone: string;
  roomId: string;
  roomName: string;
  roomNumber: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  numNights: number;
  numGuests: number;
  ratePerNight: number;
  totalPrice: number;
  rateBreakdown?: BookingRateBreakdown | null;
  paymentMethod: string;
  status: string;
  hasBreakfast: boolean;
  specialRequests: string;
  // Per 2026-07-24 (refactor/unify-payment-reference-fields):
  // the previous top-level `paymentReferenceNumber` was retired.
  // The canonical reference (if any) lives on the most recent
  // entry in the booking's onsitePayments[] ledger as
  // `transactionReference`. The lookup response no longer
  // surfaces a reference number to guests; staff read it from
  // the admin drawer when needed.
  paymentRejectionReason?: string | null;
  // Per CRL-08 (2026-08-11, per decision #213): the
  // booking's "Booked on" + "Originally for" dates.
  // Both ISO strings; `null` when the underlying
  // date is unknown. "Originally for" is `null` when
  // the booking has never been rescheduled — the
  // card suppresses the "Originally for" line in
  // that case so the surface stays clean.
  bookedOn?: string | null;
  originallyFor?: string | null;
}

// Per MBP / decisions #123 (2026-07-24) + #126 (2026-07-25):
// the privacy-preserving picker row shape returned by
// `kind: "list"` responses. Tightened in #126 to drop
// `guestName` entirely — the earlier "single-name mode
// attaches guestName / multi-name mode omits it" still
// leaked the full name to anyone with email access (a
// spouse, ex-partner, shared family inbox). Now the row is
// uniform regardless of how many distinct names are behind
// the email; `maskedEmail` is a low-fidelity echo of the
// search key (e.g. `j***@gmail.com`) so the legit user can
// confirm "yes, the search keyed on the email I typed".
// The single-booking card (rendered after the user picks
// a row) still shows the full name behind the existing
// ref+email second factor.
interface PickerEntry {
  id: string;
  bookingRef: string;
  maskedEmail: string;
  checkIn: unknown;
  checkOut: unknown;
  numNights: number;
  roomType: string;
  status: string;
}

// Per MRB-10 (2026-08-02, per decision #169): the
// reservation-scope lookup view shape. Returned by
// `kind: "reservation"` responses when the looked-up
// booking is part of a multi-room reservation. The
// shape mirrors the MRB-09 email view's privacy
// posture (no `guestName`, `maskedEmail` instead of
// `guestEmail`) + the per-room projection shape
// (position + ref + type + occupancy + per-stay
// total). Cancel + resend act on the reservation
// (the server resolves the first child for the
// credential).
interface ReservationRoom {
  id: string;
  position: number;
  bookingRef: string;
  maskedEmail: string;
  roomId: string;
  roomName: string;
  roomNumber: string;
  roomType: string;
  checkIn: unknown;
  checkOut: unknown;
  numNights: number;
  numGuests: number;
  numAdults: number;
  numChildren: number;
  extraBedCount: number;
  hasBreakfast: boolean;
  ratePerNight: number;
  totalPrice: number;
  status: string;
  rateBreakdown: BookingRateBreakdown | null;
}

interface ReservationView {
  kind: "reservation";
  id: string;
  reservationRef: string;
  maskedEmail: string;
  guestPhone: string;
  checkIn: unknown;
  checkOut: unknown;
  numNights: number;
  totalPrice: number;
  paymentMethod: string;
  status: string;
  roomCount: number;
  activeRoomCount: number;
  cancelledRoomCount: number;
  rooms: ReservationRoom[];
  primaryBookingId: string;
  primaryBookingRef: string;
  // Per CRL-08 (2026-08-11, per decision #213): the
  // reservation's "Booked on" + "Originally for" dates.
  // Both ISO strings; `null` when the underlying date
  // is unknown. The card surfaces "Booked on" always
  // and "Originally for" only when set (the helper
  // returns `null` when the booking has never been
  // rescheduled).
  bookedOn?: string | null;
  originallyFor?: string | null;
}

function toDateInput(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object" && value && typeof (value as any).toDate === "function") {
    const d = (value as any).toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return "";
}

function formatStayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

// Per CRL-08 (2026-08-11, per decision #213): the
// booking-date label formatter for the "Booked on" /
// "Originally for" rows. The server returns ISO
// strings (or `null` when the date is unknown); this
// helper turns the ISO into the same friendly
// "Aug 7, 2026" format the existing `formatStayDate`
// helper uses, with `timeZone: "UTC"` so the day
// matches the stored date regardless of the viewer's
// local timezone. Returns the original string when
// the input is unparseable so the UI doesn't crash on
// a malformed value.
function formatBookedOnLabel(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

const RESEND_COOLDOWN_MS = 60_000;

export function BookingLookupPage() {
  const shouldReduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Search state
  const [refInput, setRefInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [activeBooking, setActiveBooking] = useState<BookingData | null>(null);
  // Per MRB-10 (2026-08-02, per decision #169): the
  // reservation-scope lookup view. Set when the
  // server returns `kind: "reservation"`. Mutually
  // exclusive with `activeBooking` (a single
  // `performLookup` call sets one or the other, never
  // both). Cancel + resend routes through this state
  // when the view is reservation-scope.
  const [activeReservation, setActiveReservation] = useState<ReservationView | null>(null);

  // Per MBP / decision #123 (2026-07-24): when the email-alone
  // lookup matches >1 booking, the server returns a privacy-
  // preserving list. The page renders the picker until the
  // user clicks a row, at which point we re-query with the
  // picked `bookingRef` + the originally-typed email through
  // the strict `ref + email` path. The strict path's
  // `kind: "single"` response renders the existing single-
  // booking card unchanged.
  const [pickerResults, setPickerResults] = useState<PickerEntry[] | null>(null);
  const [pickerMoreExist, setPickerMoreExist] = useState(false);

  // Per H2 (hardening batch 2026-06-26): the auth mode
  // used for the most recent successful lookup. The
  // cancel call must reuse the same mode so a bot that
  // scraped the displayed `guestEmail` after a
  // token-mode lookup can't pivot to the email path.
  const [lookupAuthMode, setLookupAuthMode] = useState<"email" | "token" | null>(null);
  const [activeLookupToken, setActiveLookupToken] = useState<string>("");

  // Per 2026-08-07 (decision #200): the payment-method label
  // shown on the result card is now sourced from the admin's
  // `settings/hotelConfig.paymentMethods[].label` so a renamed
  // or custom method on the admin side never drifts from what
  // the guest sees here. The legacy map (decision #200) is the
  // last-resort fallback for keys the admin has not surfaced
  // yet (e.g. `paypal`). The single-booking card + the
  // reservation-scope card both render through this state. The
  // fetch is gated on a successful lookup so an empty search
  // form does not pay the Firestore read.
  const [paymentMethodConfigs, setPaymentMethodConfigs] = useState<
    ReadonlyArray<{ method: string; label: string }> | null
  >(null);

  // Action state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  // Per CRL-06 (2026-08-02): the cancellation preview
  // state. The guest cancel modal calls the new
  // `POST /api/bookings/cancel-preview` endpoint on
  // open and renders the financial breakdown BEFORE
  // the user taps confirm. The preview is best-effort
  // — the destructive cancel still proceeds if the
  // preview errors (the error state surfaces a clear
  // "breakdown unavailable" message). The state
  // resets to `null` on close so a previous session's
  // preview never bleeds into a new one.
  const [cancelPreview, setCancelPreview] = useState<CancellationPreview | null>(null);
  const [cancelPreviewLoading, setCancelPreviewLoading] = useState(false);
  const [cancelPreviewError, setCancelPreviewError] = useState<string | null>(null);
  const [completedCancellationPreview, setCompletedCancellationPreview] = useState<CancellationPreview | null>(null);
  const cancelPreviewRequestIdRef = useRef(0);

  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sent" | "rate-limited" | "error">("idle");
  const [resendError, setResendError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState<number>(0);
  const [resendCooldownTick, setResendCooldownTick] = useState(0);
  const lastAutoLookupSignatureRef = useRef("");

  // Per CRL-06 (2026-08-02): the cancellation preview
  // fetch. The guest cancel modal calls this on open
  // (and on the lookup re-render that swaps the
  // booking) and renders the financial breakdown
  // BEFORE the user taps confirm. The endpoint is
  // `/api/bookings/cancel-preview`; the body reuses
  // the same `ref + (email | token)` credential as
  // the destructive cancel. The fetch never mutates
  // anything — the guest can still confirm with the
  // panel in the error state.
  const fetchCancelPreview = async () => {
    const requestId = ++cancelPreviewRequestIdRef.current;
    const isReservationScope = Boolean(activeReservation);
    const activeRef = isReservationScope
      ? activeReservation?.primaryBookingRef
      : activeBooking?.bookingRef;
    if (!activeRef) return;
    const previewScope: "room" | "reservation" = isReservationScope ? "reservation" : "room";
    setCancelPreviewLoading(true);
    setCancelPreviewError(null);
    try {
      const previewPayload: Record<string, string> = {
        bookingRef: activeRef,
        scope: previewScope
      };
      if (lookupAuthMode === "token" && activeLookupToken) {
        previewPayload.token = activeLookupToken;
      } else {
        previewPayload.guestEmail = emailInput.trim();
      }
      const response = await fetch("/api/bookings/cancel-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previewPayload)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Could not load the cancellation preview.");
      }
      if (requestId !== cancelPreviewRequestIdRef.current) return;
      setCancelPreview(result.preview);
    } catch (err: any) {
      // Best-effort: the destructive cancel still
      // proceeds if the preview errors. The error
      // state surfaces a clear "breakdown
      // unavailable" message in the panel.
      if (requestId === cancelPreviewRequestIdRef.current) {
        setCancelPreview(null);
        setCancelPreviewError(err?.message || "Could not load the cancellation preview.");
      }
    } finally {
      if (requestId === cancelPreviewRequestIdRef.current) {
        setCancelPreviewLoading(false);
      }
    }
  };

  // Per CRL-06: fire the preview fetch when the
  // cancel modal opens. The `useEffect` is scoped to
  // the `[showCancelModal, activeRef]` pair so a
  // modal close + reopen with the same booking does
  // not double-fetch (the destructive cancel handler
  // closes the modal without clearing the preview —
  // this `useEffect` handles the close path by
  // short-circuiting on the closed state).
  useEffect(() => {
    if (showCancelModal) {
      void fetchCancelPreview();
    }
    // We intentionally omit `fetchCancelPreview`
    // from the deps — it captures fresh values from
    // state on every render via closure, and the
    // effect re-fires on the `[showCancelModal,
    // activeRef]` change which is the right trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCancelModal, activeBooking?.bookingRef, activeReservation?.primaryBookingRef]);

  // Per H1 (hardening batch 2026-06-26): the lookup +
  // cancel POSTs are Turnstile-gated. The widget renders
  // below the submit button on the search form; the cancel
  // modal reuses the same token (still valid within the
  // 2-min expiry window for a typical cancel flow).
  const {
    token: turnstileToken,
    reset: resetTurnstile,
    containerRef: turnstileContainerRef
  } = useTurnstileToken();

  useEffect(() => {
    if (resendCooldownUntil === 0) return;
    const interval = setInterval(() => {
      setResendCooldownTick((tick) => tick + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldownUntil]);

  // Per 2026-08-07 (decision #200): the dynamic label
  // fetch. The page only needs the small `paymentMethods[]`
  // array from `settings/hotelConfig`, not the whole
  // websiteContent / roomTypes / etc. bundle. The effect
  // fires when a result card becomes visible (either the
  // single-booking or the reservation-scope view) and is
  // a no-op otherwise — the search form alone never pays
  // the Firestore read. The fetch is best-effort: a
  // permission error, offline mode, or a missing document
  // keeps the page rendering through the legacy map (the
  // card's label is `resolvePaymentMethodLabel(...)` which
  // is defensive about the input shape).
  useEffect(() => {
    const needsConfig = Boolean(activeBooking || activeReservation);
    if (!needsConfig) {
      setPaymentMethodConfigs(null);
      return;
    }
    if (paymentMethodConfigs !== null) return; // already loaded
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "hotelConfig"));
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : null;
        const raw = data && Array.isArray((data as { paymentMethods?: unknown }).paymentMethods)
          ? (data as { paymentMethods: Array<{ method?: unknown; label?: unknown }> }).paymentMethods
          : null;
        const safe: ReadonlyArray<{ method: string; label: string }> = raw
          ? raw
              .filter(
                (m): m is { method: string; label: string } =>
                  !!m &&
                  typeof m === "object" &&
                  typeof (m as { method?: unknown }).method === "string" &&
                  typeof (m as { label?: unknown }).label === "string"
              )
              .map((m) => ({ method: m.method, label: m.label }))
          : [];
        if (!cancelled) setPaymentMethodConfigs(safe);
      } catch {
        // Best-effort: leave the state null and let the
        // legacy map carry the render. The card still
        // shows a label.
        if (!cancelled) setPaymentMethodConfigs(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBooking, activeReservation, paymentMethodConfigs]);

  // Per H2 (hardening batch 2026-06-26): `performLookup`
  // takes an optional token; when present, the email
  // field is omitted from the request body. The server
  // picks the token-vs-email query path based on which
  // is supplied.
  //
  // Per #209 (RFO-01 reservation-lookup surface,
  // 2026-08-10): the lookup also accepts a
  // `reservationRef` (R-YYYYMMDD-NNNNN). When the
  // deep-link / form routes through a reservation ref,
  // the email field is required (the server verifies
  // it against `reservation.leadGuestEmail`; a bare
  // R- ref is not enough to enumerate reservations).
  // The dispatch priority is most-specific-first
  // (mirrors the server's `handleLookupBooking`):
  //   reservationRef + email → reservation-scope path
  //   ref + token            → magic-link path (H2)
  //   ref + email            → ref+email path
  //   ref alone              → ref-only path
  //   email alone            → picker / single card
  //   token alone            → magic-link w/o ref
  const performLookup = async (
    bookingRef: string,
    guestEmail?: string,
    token?: string,
    reservationRef?: string
  ) => {
    setCompletedCancellationPreview(null);
    setIsSearching(true);
    setSearchError("");
    setActiveBooking(null);

    // Per fix/mbp-picker-click-turnstile (2026-07-25): track
    // whether this lookup landed the user on the picker. The
    // Turnstile token is single-use, so the unconditional
    // reset in the finally block used to consume it right
    // after the email-alone lookup returned the list — by the
    // time the user clicked a row, the token was gone and
    // the second lookup failed with "Bot verification token
    // is missing" (the screenshot bug). When the picker is
    // shown, we keep the token alive so the row click can
    // reuse it. Reset only when the flow is otherwise done
    // (single-booking rendered, hard error, or 404).
    let showedPicker = false;

    try {
      // Per BI-02 (booking-intercom audit 2026-07-06): real token
      // only — the "mock_token" sentinel is test-env-only server-side.
      //
      // Per fix/lookup-empty-string-handling: only include
      // the keys the user actually filled in. The server
      // schema is defensive too (`.or(z.literal(""))` on the
      // ref/email/token fields), but sending only the
      // meaningful keys keeps the request log + Vercel
      // function logs cleaner and avoids any future
      // schema-validation drift.
      const payload: Record<string, string> = {
        turnstileToken
      };
      // Per #209: the reservation-scope dispatch takes
      // priority over the per-child ref path. The server
      // reads the `reservationRef` key first (see
      // `handleLookupBooking`), and the MRB-09 emails
      // carry `?reservationRef=…&email=…` so the guest
      // can paste the public identifier from the email
      // subject into /my-booking without a magic link.
      if (reservationRef) {
        payload.reservationRef = reservationRef;
        if (guestEmail) {
          payload.guestEmail = guestEmail;
          setLookupAuthMode("email");
          setActiveLookupToken("");
        } else if (token) {
          // The server also accepts a per-child
          // lookupToken on the reservation path (the
          // first child's token is the email footer's
          // magic link). Keep the auth mode as "token"
          // so the cancel + resend re-uses the token.
          payload.token = token;
          setLookupAuthMode("token");
          setActiveLookupToken(token);
        } else {
          // No second factor — the server will 400 with
          // "Please provide your booking email or
          // lookup token along with the reservation
          // reference." Surface the same copy locally
          // so a guest who arrived via the R--only
          // deep link (e.g. a screenshot of the email
          // subject) sees the right next step.
          setLookupAuthMode("email");
          setActiveLookupToken("");
        }
      } else if (bookingRef) {
        payload.bookingRef = bookingRef;
        if (token) {
          payload.token = token;
          setLookupAuthMode("token");
          setActiveLookupToken(token);
        } else if (guestEmail) {
          payload.guestEmail = guestEmail;
          setLookupAuthMode("email");
          setActiveLookupToken("");
        }
      } else if (token) {
        payload.token = token;
        setLookupAuthMode("token");
        setActiveLookupToken(token);
      } else if (guestEmail) {
        payload.guestEmail = guestEmail;
        setLookupAuthMode("email");
        setActiveLookupToken("");
      }

      const response = await fetch("/api/bookings/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        setSearchError(
          result?.error ||
            "We couldn't find a booking with those details. Please check your reference number and email."
        );
        return;
      }

      const data: any = result.data;

      // Per MBP / decision #123 (2026-07-24): the email-alone
      // path returns `kind: "list"` when the email matches >1
      // booking. The page renders the picker instead of an
      // auto-picked "most recent" — repeat guests see all
      // their stays, shared-email users see a privacy-safe
      // list with names suppressed. Every other path
      // (ref+token, ref+email, ref alone, token alone, and
      // email-alone with 1 match) returns `kind: "single"`
      // and renders the existing single-booking card.
      //
      // Per MRB-10 (2026-08-02, per decision #169): the
      // reservation-scope path. The server returns
      // `kind: "reservation"` when the looked-up booking
      // has a `reservationId` and the reservation has
      // N>1 children. The page renders a single card
      // with the reservation header + a list of N
      // room children. N=1 (single room stays that
      // happen to be part of a `reservations/{id}` doc)
      // falls through to `kind: "single"` — the
      // server-side helper detects the N=1 case and
      // returns the single-booking shape (byte-
      // equivalent to the pre-MRB-10 contract).
      const kind = (data?.kind ?? "single") as "single" | "list" | "reservation";
      if (kind === "list" && Array.isArray(data?.bookings)) {
        setPickerResults(data.bookings as PickerEntry[]);
        setPickerMoreExist(Boolean(data?.moreExist));
        // Clear any stale single-booking state from a prior
        // lookup. The picker takes over the result area until
        // the user clicks a row.
        setActiveBooking(null);
        setActiveReservation(null);
        // Mark so the finally block leaves the Turnstile
        // token in place — the row click reuses it.
        showedPicker = true;
        return;
      }
      if (kind === "reservation" && Array.isArray(data?.rooms)) {
        // The server returns a fully-shaped view.
        // We only re-normalize the date fields (the
        // server can return `Timestamp` objects; the
        // page's render path expects ISO strings).
        const normalized: ReservationView = {
          ...data,
          checkIn: toDateInput(data.checkIn),
          checkOut: toDateInput(data.checkOut),
          rooms: data.rooms.map((room: any) => ({
            ...room,
            checkIn: toDateInput(room.checkIn),
            checkOut: toDateInput(room.checkOut)
          }))
        } as ReservationView;
        setPickerResults(null);
        setPickerMoreExist(false);
        setActiveBooking(null);
        setActiveReservation(normalized);
        return;
      }

      const normalized: BookingData = {
        id: data.id,
        bookingRef: data.bookingRef,
        // Per #131: `guestName` is gone from the wire;
        // `guestEmail` is gone too — the card uses
        // `maskedEmail` for the echo. Cancel + resend use
        // `emailInput` (the user's typed value, already
        // validated by the lookup).
        maskedEmail: data.maskedEmail || "",
        guestPhone: data.guestPhone || "",
        roomId: data.roomId || "",
        roomName: data.roomName || data.roomType || "",
        roomNumber: data.roomNumber || "",
        roomType: data.roomType || "",
        checkIn: toDateInput(data.checkIn),
        checkOut: toDateInput(data.checkOut),
        numNights: Number(data.numNights || 0),
        numGuests: Number(data.numGuests || 0),
        ratePerNight: Number(data.ratePerNight || 0),
        totalPrice: Number(data.totalPrice || 0),
        rateBreakdown: data.rateBreakdown || null,
        paymentMethod: data.paymentMethod || "",
        status: data.status,
        hasBreakfast: Boolean(data.hasBreakfast),
        specialRequests: data.specialRequests || "",
        paymentRejectionReason: data.paymentRejectionReason || null
      };
      // A successful single-booking response clears the
      // picker (if any) so the result area reverts to the
      // single-booking card.
      setPickerResults(null);
      setPickerMoreExist(false);
      setActiveBooking(normalized);
    } catch (err) {
      console.error("Booking lookup failed:", err);
      setSearchError(
        "We couldn't reach the booking service. Please check your connection and try again."
      );
    } finally {
      // Per BI-02: Turnstile tokens are single-use — siteverify
      // consumed this one whether the lookup succeeded or not.
      // Reset so a follow-up submit (including the cancel modal,
      // which shares this widget) gets a fresh token. The
      // exception is `kind: "list"` (the picker path): the
      // user might still click a row, and the row click reuses
      // the same token. Without this exception the second
      // lookup fires with `turnstileToken: ""` and the server
      // rejects it with "Bot verification token is missing"
      // (the MBP-07 screenshot bug).
      if (!showedPicker) {
        resetTurnstile();
      }
      setIsSearching(false);
    }
  };

  useEffect(() => {
    // Per #209 (RFO-01 reservation-lookup surface,
    // 2026-08-10): the deep-link now also accepts a
    // `reservationRef` (R-YYYYMMDD-NNNNN) for the
    // MRB-09 reservation-scope emails. Priority is
    // reservation-scope first (the email subject
    // carries the R- ref; the email is the public
    // identifier the guest is most likely to paste
    // into the form), then the legacy `?ref=…&token=…`
    // / `?ref=…&email=…` paths.
    const reservationRef = searchParams.get("reservationRef");
    const ref = searchParams.get("ref");
    // Per H2 (hardening batch 2026-06-26): the deep-link
    // now carries `?token=<lookupToken>` (set by the
    // email magic link + the StaysPage "View details"
    // link). The legacy `?email=` is still accepted for
    // backward compat with any old in-flight links.
    const token = searchParams.get("token");
    const email = searchParams.get("email");
    if (!reservationRef && !ref) return;
    // The reservation-scope path requires a credential
    // (email or token). Without it the server returns
    // 400 — we still render the form so the guest can
    // fill in the missing piece rather than showing a
    // blank page with a hard error.
    if (reservationRef && !token && !email) return;
    if (!reservationRef && !token && !email) return;
    // Per BI-02/BI-03: the magic-link auto-lookup must wait for the
    // Turnstile widget to issue a token — the lookup endpoint is
    // gated for real now. The effect re-runs when the token arrives
    // (deps below); the signature guard keeps it single-fire.
    if (!turnstileToken) return;
    const activeRef = reservationRef || ref || "";
    const signature = `${activeRef}::${token || email || ""}`;
    if (lastAutoLookupSignatureRef.current === signature) return;
    lastAutoLookupSignatureRef.current = signature;
    // Pre-fill the visible form so a deep-link
    // landing still shows the guest what was used
    // (the form stays mounted; the search form is
    // hidden when the result card is the active
    // view, per decision #130).
    if (reservationRef) {
      setRefInput(reservationRef);
    } else if (ref) {
      setRefInput(ref);
    }
    if (email) setEmailInput(email);
    setHasSearched(true);
    if (reservationRef) {
      void performLookup("", email || undefined, token || undefined, reservationRef);
    } else {
      // The early `return` above guarantees `ref` is
      // non-null when we reach this branch (we returned
      // when both `reservationRef` and `ref` were empty),
      // so the `?? ""` is purely for the typecheck.
      void performLookup(ref ?? "", email || undefined, token || undefined);
    }
  }, [searchParams, turnstileToken]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    // Per BI-02/BI-03: don't burn a request that will 400 — the
    // widget below the form auto-resolves for most visitors.
    if (!turnstileToken) {
      setSearchError("The security check hasn't finished yet. Please wait a moment and try again.");
      return;
    }
    // Per feat/relax-booking-lookup: either the ref OR the
    // email is enough — guests often forget which email they
    // booked under, or vice versa. The server-side schema
    // enforces the same rule, but the client-side check
    // keeps the empty-submit out of the request log.
    const trimmedRef = refInput.trim();
    const trimmedEmail = emailInput.trim();
    if (!trimmedRef && !trimmedEmail) {
      setSearchError("Please enter your booking reference or the email you used to book.");
      return;
    }
    // Per #209 (RFO-01 reservation-lookup surface,
    // 2026-08-10): the form's ref field accepts BOTH a
    // per-child booking ref (SI-YYYYMMDD-NNNNN) AND a
    // reservation ref (R-YYYYMMDD-NNNNN). The two share
    // the same field so the guest doesn't have to know
    // which one they have — they paste the public
    // identifier from the email subject and the page
    // routes to the right server path.
    //
    // The R- alone path is accepted (no email
    // required) — the server's `handleLookupBooking`
    // reads `reservationRef` from the reservations
    // collection and hands the first child to
    // `enrichAndRespond`. The defense is the same
    // Turnstile + 10/min rate limit + 3-failure
    // 1-hour backoff as the SI- `ref`-alone path
    // (the 99,999-key per-day namespace is the same
    // for both ref types). The form's header copy
    // reads "Enter your booking reference or the
    // email you used to book" — the R- alone case
    // matches that contract. If the user also typed
    // an email, the server uses it as a
    // second-factor gate against
    // `reservation.leadGuestEmail` (a stricter
    // check; the 404 reply is identical to the
    // not-found case so the response is not an
    // email-existence oracle).
    if (trimmedRef && RESERVATION_REF_REGEX.test(trimmedRef)) {
      setSearchError("");
      setHasSearched(true);
      await performLookup("", trimmedEmail || undefined, undefined, trimmedRef);
      return;
    }
    setSearchError("");
    setHasSearched(true);
    await performLookup(trimmedRef, trimmedEmail || undefined);
  };

  const handleResetSearch = () => {
    setRefInput("");
    setEmailInput("");
    setHasSearched(false);
    setSearchError("");
    setActiveBooking(null);
    // Per MRB-10 (2026-08-02, per decision #169): also
    // clear the reservation-scope view when the user
    // goes back to the search screen.
    setActiveReservation(null);
    setPickerResults(null);
    setPickerMoreExist(false);
    setResendStatus("idle");
    setResendError("");
    setCancelError("");
    setShowCancelModal(false);
    setCancelReason("");
    setCompletedCancellationPreview(null);
    // Per H2 (hardening batch 2026-06-26): clear the
    // cached auth mode + token when the user goes back
    // to the search screen so the next lookup starts
    // from a known state.
    setLookupAuthMode(null);
    setActiveLookupToken("");
    lastAutoLookupSignatureRef.current = "";
  };

  // Per MBP / decision #123 (2026-07-24): when the user picks
  // a row from the privacy-preserving list, re-query through
  // the strict `ref + email` path. The strict path returns
  // `kind: "single"` and the existing single-booking card
  // takes over. This re-validation is the point: the picker's
  // "happy path" goes through the same auth check that
  // protects every other guest action. A picker click
  // never deep-links straight into a booking without a
  // second factor.
  //
  // Per fix/mbp-picker-click-turnstile (2026-07-25): we
  // navigate to `/my-booking?ref=…&email=…` so the URL
  // reflects the booking the user is viewing (bookmarkable,
  // refreshable, shareable, Back button works). The
  // existing useEffect on `searchParams` handles the
  // auto-lookup, gated on a fresh Turnstile token. The
  // previous in-place `performLookup` call worked the same
  // way (same strict ref+email path, same token reuse per
  // the picker-reset fix above) but didn't update the URL.
  const handlePickerSelect = async (entry: PickerEntry) => {
    const trimmedRef = String(entry.bookingRef || "").trim();
    const trimmedEmail = emailInput.trim();
    if (!trimmedRef || !trimmedEmail) {
      setSearchError("Please re-enter the email you used to book to open this booking.");
      return;
    }
    setRefInput(trimmedRef);
    setEmailInput(trimmedEmail);
    setPickerResults(null);
    setPickerMoreExist(false);
    setSearchError("");
    setHasSearched(true);
    const params = new URLSearchParams();
    params.set("ref", trimmedRef);
    params.set("email", trimmedEmail);
    navigate(`/my-booking?${params.toString()}`, { replace: true });
  };

  const handleResendEmail = async () => {
    // Per MRB-10 (2026-08-02, per decision #169): the
    // resend routes to the primary child of the
    // reservation when the view is reservation-scope.
    // The MRB-09 reservation-scope email templates
    // (one email listing every room) are fired
    // server-side on create; the resend endpoint is
    // per-child. For MVP the resend fires the primary
    // child's email — the existing per-child template
    // renders the full reservation view (per MRB-09).
    // A future "resend reservation email" endpoint
    // (MRB-15 follow-up) can fire the
    // booking-cancelled-reservation action's cousin
    // for the active-state email.
    const isReservationScope = Boolean(activeReservation);
    const activeRef = isReservationScope
      ? activeReservation?.primaryBookingRef
      : activeBooking?.bookingRef;
    const activeStatus = isReservationScope
      ? activeReservation?.status
      : activeBooking?.status;
    if (!activeRef) return;
    if (resendCooldownUntil > Date.now()) {
      setResendStatus("rate-limited");
      setResendError("Email already resent recently, please wait.");
      return;
    }

    setIsResending(true);
    setResendStatus("idle");
    setResendError("");

    try {
      const triggerAction =
        activeStatus === "pending" || activeStatus === "payment-uploaded"
          ? "booking-submitted"
          : "booking-confirmed";

      const response = await fetch(`/api/email/${triggerAction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingRef: activeRef,
          // Per #131: the lookup response no longer carries
          // the full email. Cancel + resend use the value
          // the user typed into the form (already validated
          // by the lookup that returned the booking).
          guestEmail: emailInput.trim()
        })
      });

      const result = await response.json().catch(() => null);

      if (response.status === 429) {
        setResendStatus("rate-limited");
        setResendError("Email already resent recently, please wait.");
        setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
        return;
      }

      if (!response.ok || !result?.success) {
        setResendStatus("error");
        setResendError(result?.error || "We couldn't resend the email. Please try again later.");
        return;
      }

      setResendStatus("sent");
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      console.error("Resend email failed:", err);
      setResendStatus("error");
      setResendError("We couldn't reach the email service. Please try again later.");
    } finally {
      setIsResending(false);
    }
  };

  const handleCancelBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Per MRB-10 (2026-08-02, per decision #169): the
    // cancel routes to the reservation when the view
    // is reservation-scope (`activeReservation` set),
    // otherwise to the single booking (`activeBooking`
    // set). The two are mutually exclusive — exactly
    // one is non-null after a successful lookup.
    const isReservationScope = Boolean(activeReservation);
    const activeRef = isReservationScope
      ? activeReservation?.primaryBookingRef
      : activeBooking?.bookingRef;
    if (!activeRef) return;
    // Per BI-02: the lookup consumed the previous token and
    // `performLookup` reset the widget — wait for the fresh one.
    if (!turnstileToken) {
      setCancelError("The security check hasn't finished yet. Please wait a moment and try again.");
      return;
    }
    setIsCancelling(true);
    setCancelError("");

    try {
      // Per H2 (hardening batch 2026-06-26): the cancel
      // call must reuse the same auth mode that was used
      // for the lookup. If the lookup was authenticated
      // by a token, the cancel reuses that token — even
      // though the displayed `guestEmail` would also
      // authenticate, pivoting across modes is denied so
      // a bot can't scrape the email from the page
      // response and re-authenticate via the email path.
      //
      // Per MRB-13 (decision #166): when the view is
      // reservation-scope, the cancel body adds
      // `scope: "reservation"` so the server cancels the
      // whole reservation in one transaction (per
      // MRB-13's reservation-scope cancel path). The
      // server's `handleCancelBooking` honours the
      // `scope` field; a missing/unknown scope is the
      // legacy per-room default. The modal copy
      // (BOOKING-LOOKUP.md §MRB-13) tells the guest the
      // room count is being cancelled.
      const cancelPayload: Record<string, string> = {
        bookingRef: activeRef,
        reason: cancelReason,
        turnstileToken
      };
      if (isReservationScope) {
        cancelPayload.scope = "reservation";
      }
      if (lookupAuthMode === "token" && activeLookupToken) {
        cancelPayload.token = activeLookupToken;
      } else {
        // Per #131: the lookup response no longer carries
        // the full email. Cancel uses the value the user
        // typed into the form (already validated by the
        // lookup that returned the booking). The deep-link
        // /my-booking?ref=…&email=… path also sets
        // `emailInput` from the URL, so this is consistent
        // across the picker-strict path and the direct
        // ref+email form path.
        cancelPayload.guestEmail = emailInput.trim();
      }
      const response = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cancelPayload)
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        setCancelError(result?.error || "We couldn't cancel your booking. Please try again.");
        return;
      }

      if (isReservationScope && activeReservation) {
        // The server cancelled every room in the
        // transaction that remained guest-cancellable.
        // Preserve terminal siblings in mixed-state
        // reservations so the optimistic card mirrors
        // the server's skip rules.
        const cancellableIds = new Set(
          activeReservation.rooms
            .filter((room) =>
              (GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(room.status)
            )
            .map((room) => room.id)
        );
        const nextRooms = activeReservation.rooms.map((room) =>
          cancellableIds.has(room.id) ? { ...room, status: "cancelled" } : room
        );
        const cancelledRoomCount = nextRooms.filter((room) => room.status === "cancelled").length;
        const activeRoomCount = Math.max(activeReservation.roomCount - cancelledRoomCount, 0);
        setActiveReservation({
          ...activeReservation,
          status: activeRoomCount === 0 ? "cancelled" : activeReservation.status,
          rooms: nextRooms,
          activeRoomCount,
          cancelledRoomCount
        });
      } else if (activeBooking) {
        setActiveBooking({ ...activeBooking, status: "cancelled" });
      }
      setCompletedCancellationPreview(cancelPreview);
      setShowCancelModal(false);
      cancelPreviewRequestIdRef.current += 1;
      setCancelReason("");
    } catch (err) {
      console.error("Cancel booking failed:", err);
      setCancelError("We couldn't reach the booking service. Please try again.");
    } finally {
      // Per BI-02: single-use token consumed — mint a fresh one.
      resetTurnstile();
      setIsCancelling(false);
    }
  };

  // Per 2026-08-07 (decision #200): the payment-method label
  // for the result card is resolved through the shared
  // `resolvePaymentMethodLabel` helper. The admin's
  // `hotelConfig.paymentMethods[]` (fetched above) is the
  // canonical source, the `LEGACY_PAYMENT_METHOD_LABELS` map
  // is the last-resort fallback for keys the admin has not
  // surfaced yet, and the raw `paymentMethod` key is the
  // final fallback. The single-booking + reservation-scope
  // cards both render through the same helper so the two
  // surfaces can never drift apart.
  const resolveLabel = (methodKey: string | undefined | null) =>
    resolvePaymentMethodLabel(methodKey, paymentMethodConfigs);

  const timelineSteps = [
    { label: "Submitted", statusKey: "pending", description: "Booking received" },
    { label: "Confirmed", statusKey: "payment-confirmed", description: "Payment verified" },
    { label: "Checked In", statusKey: "checked-in", description: "In your room" },
    { label: "Checked Out", statusKey: "checked-out", description: "Stay completed" }
  ];

  const getActiveStepIndex = (status: string) => {
    if (status === "pending" || status === "payment-uploaded") return 0;
    if (status === "payment-confirmed" || status === "confirmed") return 1;
    if (status === "checked-in") return 2;
    if (status === "checked-out") return 3;
    return -1;
  };

  const currentStepIndex = activeBooking ? getActiveStepIndex(activeBooking.status) : -1;
  const isCancelled = activeBooking?.status === "cancelled";
  const canCancel = Boolean(
    activeBooking
    && (GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(activeBooking.status)
  );
  const guestCancellableReservationRooms = activeReservation?.rooms.filter((room) =>
      (GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(room.status)
    ) ?? [];
  const canCancelReservation = guestCancellableReservationRooms.length > 0;
  const canResend = Boolean(activeBooking) && !isCancelled;

  const cooldownRemainingMs = Math.max(0, resendCooldownUntil - Date.now());
  const isOnCooldown = cooldownRemainingMs > 0;
  const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900">
      <Navbar />

      <section className="mx-auto max-w-4xl px-4 pt-10 pb-20">
        {/* Per MBP / decisions #123 (2026-07-24) + #129
            (2026-07-25): the result area cycles between
            search form → picker (if >1 match) → single-
            booking card (after the user picks a row). The
            form is ALWAYS mounted (`hidden` when not active)
            so the Turnstile widget persists across picker
            and card transitions — when the user clicks
            "Back to search" from the picker or card, the
            widget's container div is the same DOM node and
            the token is still valid. The picker and card
            are conditionally rendered on top of the
            (hidden) form. */}
        {pickerResults && pickerResults.length > 0 && (
          <motion.div
            variants={scaleIn}
            initial={shouldReduceMotion ? false : "hidden"}
            animate="visible"
            className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
            data-testid="booking-picker"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <ListChecks className="h-8 w-8 text-primary" aria-hidden="true" />
                <h1 className="mt-2 font-heading text-2xl text-gray-950 sm:text-3xl">
                  We found stays for this email
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  Pick the stay you want to view. Each one opens the same secure lookup.
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetSearch}
                className="text-xs font-semibold text-gray-500 underline-offset-2 hover:text-primary hover:underline"
              >
                Back to search
              </button>
            </div>

            <ul className="mt-6 grid gap-3">
              {pickerResults.map((entry) => {
                const checkIn = toDateInput(entry.checkIn);
                const checkOut = toDateInput(entry.checkOut);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => handlePickerSelect(entry)}
                      disabled={isSearching}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-primary hover:bg-primary-light/20 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-gray-950">
                          {entry.bookingRef}
                        </p>
                        {entry.maskedEmail && (
                          <p className="mt-0.5 truncate text-xs text-gray-600">
                            {entry.maskedEmail}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-gray-600">
                          {formatStayDate(checkIn)} → {formatStayDate(checkOut)} · {entry.numNights} night{Number(entry.numNights) === 1 ? "" : "s"} · {entry.roomType}
                        </p>
                      </div>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-600">
                        {String(entry.status || "").replace(/-/g, " ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {pickerMoreExist && (
              <p className="mt-4 rounded-lg border border-dashed border-gray-250 bg-gray-50 px-3 py-2 text-center text-xs text-gray-600">
                10 most recent — contact the front desk for older stays.
              </p>
            )}
          </motion.div>
        )}

        {/* Form: always mounted so the Turnstile widget persists
            across picker/card transitions. The `hidden` class
            (display: none) suppresses the form when the picker
            or card is the active view; when the user clicks
            "Back to search" the form re-appears with the widget
            already rendered. See #129 for the full rationale. */}
        <motion.div
          variants={scaleIn}
          initial={shouldReduceMotion ? false : "hidden"}
          animate="visible"
          aria-hidden={Boolean(pickerResults?.length || activeBooking || activeReservation) || undefined}
          className={`mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 ${pickerResults?.length || activeBooking || activeReservation ? "hidden" : ""}`}
        >
            <div className="text-center">
              <Search className="mx-auto h-12 w-12 text-primary" />
              <h1 className="mt-4 font-heading text-3xl text-gray-950">Find your booking</h1>
              <p className="mt-2 text-sm text-gray-600">
                Enter your booking reference <span className="font-semibold">or</span> the email you used to book.
              </p>
            </div>

            <form onSubmit={handleSearch} className="mt-8 space-y-5">
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Booking or Reservation Reference
                <input
                  type="text"
                  placeholder="e.g. SI-20260612-042 or R-20260815-00012"
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  disabled={isSearching}
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                <div className="h-px flex-1 bg-gray-200" />
                <span>or</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Email Address
                <input
                  type="email"
                  placeholder="maria@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  disabled={isSearching}
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              {searchError && (
                <p className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-600">
                  {searchError}
                </p>
              )}

              {/* Per H1 (hardening batch 2026-06-26):
                  Turnstile challenge gates the lookup
                  endpoint against ref-guessing bots. */}
              <div
                ref={turnstileContainerRef}
                className="flex justify-center"
              />

              <PrimaryButton type="submit" className="w-full" disabled={isSearching}>
                {isSearching ? "Looking up..." : "Find My Booking"}
              </PrimaryButton>
            </form>
          </motion.div>

        {/* Single-booking card: shown after the picker click (or
            any direct 1-match lookup). Always rendered as a
            conditional so the form's persistent Turnstile
            widget doesn't re-render behind it. */}
        {activeBooking && (
          <div className="space-y-6">
            <button
              onClick={handleResetSearch}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              <ArrowLeft size={16} />
              Back to search
            </button>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Booking Status</span>
                <div className="mt-1 flex items-center gap-3">
                  <h1 className="font-heading text-3xl text-gray-950 sm:text-4xl">
                    Reference: {activeBooking.bookingRef}
                  </h1>
                  <StatusBadge label={activeBooking.status.replace("-", " ")} status={activeBooking.status} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canResend && (
                  <div className="flex flex-col items-end gap-1">
                    <GhostButton
                      onClick={handleResendEmail}
                      disabled={isResending || isOnCooldown}
                    >
                      <Mail size={16} />
                      {isResending
                        ? "Resending..."
                        : isOnCooldown
                          ? `Wait ${cooldownSeconds}s`
                          : "Resend Email"}
                    </GhostButton>
                    {resendStatus === "sent" && (
                      <span className="text-[10px] font-semibold text-green-600">
                        {/* Per #131: the card no longer shows
                            the full email (the lookup response
                            only carries `maskedEmail`). The
                            resend success indicator just
                            confirms the email was dispatched
                            without echoing the address. */}
                        Confirmation email sent.
                      </span>
                    )}
                    {(resendStatus === "rate-limited" || resendStatus === "error") && resendError && (
                      <span className="text-[10px] font-semibold text-red-600">
                        {resendError}
                      </span>
                    )}
                  </div>
                )}
                {canCancel && (
                  <GhostButton
                    onClick={() => setShowCancelModal(true)}
                    className="border-red-200 text-red-600 hover:bg-red-50"
                  >
                    <ShieldAlert size={16} />
                    Cancel Booking
                  </GhostButton>
                )}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <div className="space-y-6">
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-bold text-gray-950 mb-4">Stay Summary</h2>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex gap-3">
                      <Calendar className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Check-in</p>
                        <p className="mt-1 font-semibold text-gray-900">{formatStayDate(activeBooking.checkIn)}</p>
                        <p className="text-xs text-gray-500">From 2:00 PM</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Calendar className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Check-out</p>
                        <p className="mt-1 font-semibold text-gray-900">{formatStayDate(activeBooking.checkOut)}</p>
                        <p className="text-xs text-gray-500">Before 12:00 PM</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Users className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Guests</p>
                        {/* Per EXB-08 (2026-08-01, per decision
                            #156): the /my-booking card now
                            shows the adult/child split when
                            both fields are present, with
                            the extra bed count appended
                            when > 0. Legacy pre-CHD bookings
                            read as a single `numGuests`
                            total. Matches the receipt PDF
                            + the email helper + the admin
                            drawer header so the staff +
                            guest surfaces stay in
                            lockstep. The guest sees the
                            exact same occupancy breakdown
                            the desk sees. */}
                        <p className="mt-1 font-semibold text-gray-900">
                          {(() => {
                            const numAdults = Number((activeBooking as any).numAdults);
                            const numChildren = Number((activeBooking as any).numChildren);
                            const extraBedCount = Number((activeBooking as any).extraBedCount);
                            if (Number.isFinite(numAdults) && Number.isFinite(numChildren) && (numAdults > 0 || numChildren > 0)) {
                              const splitLabel = `${numAdults} adult${numAdults === 1 ? "" : "s"} + ${numChildren} child${numChildren === 1 ? "" : "ren"} (${activeBooking.numGuests} total)`;
                              const extraLabel = Number.isFinite(extraBedCount) && extraBedCount > 0
                                ? ` + ${extraBedCount} extra bed${extraBedCount === 1 ? "" : "s"}`
                                : "";
                              return <span>{splitLabel}{extraLabel}</span>;
                            }
                            return <>{activeBooking.numGuests} {activeBooking.numGuests === 1 ? "Guest" : "Guests"}</>;
                          })()}
                        </p>
                        <p className="text-xs text-gray-500">{activeBooking.numNights} {activeBooking.numNights === 1 ? "night" : "nights"} duration</p>
                      </div>
                    </div>

                    {/* Per decisions #126 + #128 + #131: the
                        public /my-booking card never reflects
                        the guest name back to the caller.
                        Instead, the "Lead Guest" section now
                        shows the masked email (e.g.
                        "j***@gmail.com") as a low-fidelity
                        echo of the search key — the attacker
                        already typed the email so there's no
                        new leak, and the legit user gets a
                        small "yes, the search keyed on the
                        email I typed" confirmation. The full
                        email is not on the card; the cancel +
                        resend flows use the value the user
                        typed into the form (kept in local
                        `emailInput` state). */}
                    {activeBooking.maskedEmail && (
                      <div className="flex gap-3">
                        <Mail className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase">Booked under</p>
                          <p className="mt-1 font-mono text-sm font-semibold text-gray-900">{activeBooking.maskedEmail}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Per CRL-08 (2026-08-11, per decision #213):
                      the booking's "Booked on" + "Originally for"
                      dates as a small footer line. "Booked on"
                      always renders when present; "Originally for"
                      is suppressed when the booking has never been
                      rescheduled (the server returns `null` in that
                      case). The two dates make a recent reschedule
                      visible at a glance — when "Originally for" is
                      before the current stay dates, the booking was
                      moved. Renders as a thin row under the existing
                      3-column "Stay dates / Room / Reservation
                      total" grid so the timeline reads top-to-bottom
                      in the same place the guest already looks for
                      the booking metadata. */}
                  {(activeBooking.bookedOn || activeBooking.originallyFor) && (
                    <div
                      data-testid="booking-card-booking-dates"
                      className="mt-5 grid gap-3 border-t border-gray-100 pt-5 sm:grid-cols-2"
                    >
                      {activeBooking.bookedOn && (
                        <div className="flex gap-3">
                          <CalendarPlus className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase">Booked on</p>
                            <p className="mt-1 text-sm font-semibold text-gray-900">
                              {formatBookedOnLabel(activeBooking.bookedOn)}
                            </p>
                          </div>
                        </div>
                      )}
                      {activeBooking.originallyFor && (
                        <div className="flex gap-3">
                          <History className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase">Originally for</p>
                            <p className="mt-1 text-sm font-semibold text-gray-900">
                              {formatBookedOnLabel(activeBooking.originallyFor)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeBooking.specialRequests && (
                    <div className="mt-6 border-t border-gray-100 pt-5">
                      <p className="text-xs font-semibold text-gray-500 uppercase">Special Requests</p>
                      <p className="mt-1 text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{activeBooking.specialRequests}</p>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-bold text-gray-950 mb-5">Timeline</h2>

                  {isCancelled ? (
                    <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
                      <div className="flex items-center gap-3">
                      <ShieldAlert size={20} className="shrink-0" />
                      <p>This reservation was cancelled. If this is an error, please contact the front desk.</p>
                      </div>
                      {completedCancellationPreview && (
                        <p className="mt-3 border-t border-red-200 pt-3 text-xs leading-relaxed">
                          {completedCancellationPreview.staffProcessingRequired
                            ? `Your cancellation is complete. An applicable refund of up to ${formatPrice(completedCancellationPreview.policyRefund)} still requires staff processing and is not issued automatically.`
                            : completedCancellationPreview.retainedAmount > 0
                              ? `${formatPrice(completedCancellationPreview.retainedAmount)} is retained under the cancellation policy. No refund is issued automatically.`
                              : "No payment refund is currently due under the cancellation preview."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="relative flex flex-col gap-6 md:flex-row md:justify-between md:gap-0">
                      <div className="absolute top-4 left-0 hidden h-1 w-full bg-gray-200 md:block" />

                      {timelineSteps.map((step, index) => {
                        const isCompleted = index <= currentStepIndex;
                        const isActive = index === currentStepIndex;

                        return (
                          <div
                            key={step.label}
                            className="relative flex items-start gap-4 md:flex-col md:items-center md:gap-0 md:text-center md:flex-1"
                          >
                            {index > 0 && (
                              <div className="absolute -top-6 left-4 h-6 w-0.5 bg-gray-200 md:hidden" />
                            )}

                            <span
                              className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-semibold z-10 transition-all",
                                isCompleted
                                  ? "border-primary bg-primary text-white scale-110 shadow-sm"
                                  : "border-gray-300 bg-white text-gray-400"
                              )}
                            >
                              {index + 1}
                            </span>

                            <div className="mt-1 md:mt-3">
                              <p className={cn("text-sm font-semibold", isActive ? "text-primary" : "text-gray-950")}>
                                {step.label}
                              </p>
                              <p className="text-xs text-gray-500">{step.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-bold text-gray-950 mb-4">Pricing & Details</h2>

                  <div className="space-y-4">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Room Type</span>
                      <span className="font-semibold text-gray-900">
                        {activeBooking.roomName || activeBooking.roomType}
                        {/* Per the refactor/room-number-visibility change:
                            the assigned room number is only surfaced once
                            it's been locked in by the front desk at check-in.
                            For pending/confirmed stays the assignment can
                            still shift (room blocks, housekeeping, upgrades),
                            so we deliberately keep that information away
                            from the guest until it becomes firm. */}
                        {activeBooking.roomNumber &&
                        (activeBooking.status === "checked-in" ||
                          activeBooking.status === "checked-out") ? (
                          <span className="text-gray-500"> (Room {activeBooking.roomNumber})</span>
                        ) : null}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Rate Type</span>
                      <span className="font-semibold text-gray-900">
                        {activeBooking.hasBreakfast ? "Room + Breakfast" : "Room Only"}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Payment Method</span>
                      <span className="font-semibold text-gray-900">
                        {/* Per decision #200 (2026-08-07): resolves through the
                            admin's `paymentMethods[].label` with the shared
                            legacy map as fallback. */}
                        {resolveLabel(activeBooking.paymentMethod)}
                      </span>
                    </div>

                    {activeBooking.rateBreakdown ? (
                      <PriceBreakdown breakdown={activeBooking.rateBreakdown} total={activeBooking.totalPrice} />
                    ) : null}

                    <div className="border-t border-gray-100 pt-4 flex justify-between items-end">
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase block">Total Price</span>
                        <span className="text-2xl font-bold text-primary">{formatPrice(activeBooking.totalPrice)}</span>
                      </div>
                      <span className="text-xs text-gray-500">VAT inclusive</span>
                    </div>
                  </div>
                </div>

                {activeBooking.paymentRejectionReason && (
                  <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
                    <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={18} />
                    <div>
                      <p className="text-sm font-bold text-red-800">Payment proof needs attention</p>
                      <p className="mt-1 text-xs leading-relaxed text-red-700">
                        {activeBooking.paymentRejectionReason}
                      </p>
                      <p className="mt-2 text-xs font-semibold text-red-700">
                        Please upload a corrected payment proof below.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 p-4 bg-primary-light rounded-xl border border-primary/20">
                  <Sparkles className="text-primary shrink-0 mt-0.5 animate-pulse" size={18} />
                  <div>
                    <p className="text-sm font-bold text-primary-dark">Need to make adjustments?</p>
                    <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                      To change check-in dates, guest count, or breakfast selections, please call our front desk directly at {config.frontDeskPhone}.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reservation card: shown when the looked-up booking
            has a `reservationId` and the reservation has N>1
            children. Renders the reservation header + a list
            of N room children. The cancel + resend actions
            act on the reservation (the first child carries
            the server credential). Per MRB-10 (2026-08-02,
            per decision #169) + MRB-13's reservation-scope
            cancel scope. */}
        {activeReservation && (
          <div className="space-y-6">
            <button
              onClick={handleResetSearch}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              <ArrowLeft size={16} />
              Back to search
            </button>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Reservation Status</span>
                <div className="mt-1 flex items-center gap-3">
                  <h1 className="font-heading text-3xl text-gray-950 sm:text-4xl">
                    Reference: {activeReservation.reservationRef}
                  </h1>
                  <StatusBadge
                    label={String(activeReservation.status).replace("-", " ")}
                    status={activeReservation.status}
                  />
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {activeReservation.roomCount} room{activeReservation.roomCount === 1 ? "" : "s"} ·{" "}
                  {activeReservation.numNights} night{activeReservation.numNights === 1 ? "" : "s"} duration
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <GhostButton
                  onClick={handleResendEmail}
                  disabled={isResending || isOnCooldown}
                >
                  <Mail size={16} />
                  {isResending
                    ? "Resending..."
                    : isOnCooldown
                      ? `Wait ${cooldownSeconds}s`
                      : "Resend Email"}
                </GhostButton>
                {canCancelReservation && (
                  <PrimaryButton
                    onClick={() => setShowCancelModal(true)}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Cancel all rooms
                  </PrimaryButton>
                )}
              </div>
            </div>

            {/* Reservation header card — the per-reservation
                dates + aggregate total + masked email. Mirrors
                the single-booking card's privacy posture (no
                `guestName` reflected back, per #131). */}
            <div className="rounded-card-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
              <div className="grid gap-5 md:grid-cols-3">
                <div className="flex gap-3">
                  <Calendar className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Stay dates</p>
                    <p className="mt-1 font-semibold text-gray-900">
                      {formatStayDate(String(activeReservation.checkIn))} — {formatStayDate(String(activeReservation.checkOut))}
                    </p>
                    <p className="text-xs text-gray-500">{activeReservation.numNights} night{activeReservation.numNights === 1 ? "" : "s"}</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <BedDouble className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Rooms</p>
                    <p className="mt-1 font-semibold text-gray-900">
                      {activeReservation.activeRoomCount} active / {activeReservation.cancelledRoomCount} cancelled
                    </p>
                    <p className="text-xs text-gray-500">
                      {activeReservation.rooms.length} total in this reservation
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Wallet className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Reservation total</p>
                    <p className="mt-1 text-lg font-bold text-gray-900">
                      {formatPrice(activeReservation.totalPrice)}
                    </p>
                    {activeReservation.paymentMethod && (
                      // Per decision #200 (2026-08-07): the
                      // reservation-scope card used to dump the raw
                      // `paymentMethod` key directly. Resolves through
                      // the admin's `paymentMethods[].label` with the
                      // shared legacy map as fallback (same helper the
                      // single-booking card uses).
                      <p className="text-xs text-gray-500">{resolveLabel(activeReservation.paymentMethod)}</p>
                    )}
                  </div>
                </div>
              </div>

              {activeReservation.maskedEmail && (
                <div className="mt-5 border-t border-gray-100 pt-5 flex gap-3">
                  <Mail className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Booked under</p>
                    <p className="mt-1 font-mono text-sm font-semibold text-gray-900">{activeReservation.maskedEmail}</p>
                  </div>
                </div>
              )}

              {/* Per CRL-08 (2026-08-11, per decision #213):
                  the reservation's "Booked on" + "Originally for"
                  dates as a footer line. Same shape as the
                  single-booking card above; renders under the
                  "Booked under" line so the timeline reads in the
                  same place the guest already looks for the
                  reservation metadata. "Originally for" is
                  suppressed when the reservation has never been
                  rescheduled (the server returns `null` in that
                  case). */}
              {(activeReservation.bookedOn || activeReservation.originallyFor) && (
                <div
                  data-testid="reservation-card-booking-dates"
                  className="mt-5 grid gap-3 border-t border-gray-100 pt-5 sm:grid-cols-2"
                >
                  {activeReservation.bookedOn && (
                    <div className="flex gap-3">
                      <CalendarPlus className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold uppercase text-gray-500">Booked on</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">
                          {formatBookedOnLabel(activeReservation.bookedOn)}
                        </p>
                      </div>
                    </div>
                  )}
                  {activeReservation.originallyFor && (
                    <div className="flex gap-3">
                      <History className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold uppercase text-gray-500">Originally for</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">
                          {formatBookedOnLabel(activeReservation.originallyFor)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {activeReservation.status === "cancelled" && completedCancellationPreview && (
              <div className="rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Cancellation complete</p>
                <p className="mt-1 text-xs leading-relaxed">
                  {completedCancellationPreview.staffProcessingRequired
                    ? `An applicable refund of up to ${formatPrice(completedCancellationPreview.policyRefund)} still requires staff processing and is not issued automatically.`
                    : completedCancellationPreview.retainedAmount > 0
                      ? `${formatPrice(completedCancellationPreview.retainedAmount)} is retained under the cancellation policy. No refund is issued automatically.`
                      : "No payment refund is currently due under the cancellation preview."}
                </p>
              </div>
            )}

            {/* Per-room list — every room in the reservation,
                with its own ref + type + per-stay total. The
                receipt PDF + the email helper use the same
                per-stay shape (per MRB-04). */}
            <div className="rounded-card-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
              <h2 className="text-base font-semibold text-gray-950 mb-4">
                Rooms in this reservation
              </h2>
              <ul className="space-y-3">
                {activeReservation.rooms.map((room) => (
                  <li
                    key={room.id}
                    className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <BedDouble size={16} className="text-primary" />
                        <span className="font-semibold text-gray-950">
                          Room {room.position} · {room.roomType || "Room"}
                        </span>
                        <StatusBadge
                          label={String(room.status).replace("-", " ")}
                          status={room.status}
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500 font-mono">
                        {room.bookingRef}
                        {room.roomNumber ? ` · Room ${room.roomNumber}` : ""}
                        {room.hasBreakfast ? " · breakfast" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{formatPrice(room.totalPrice)}</p>
                      <p className="text-xs text-gray-500">
                        {room.numAdults} adult{room.numAdults === 1 ? "" : "s"}
                        {room.numChildren > 0 ? `, ${room.numChildren} child${room.numChildren === 1 ? "" : "ren"}` : ""}
                        {room.extraBedCount > 0 ? `, ${room.extraBedCount} extra bed${room.extraBedCount === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-card-lg bg-primary-light/30 border border-primary/20 p-5 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">Need to change something?</p>
              <p className="mt-1 text-xs leading-relaxed">
                To change check-in dates, guest count, or breakfast selections for a specific room, please call our front desk directly at {config.frontDeskPhone}. To cancel the whole reservation, use the button above — every room in the reservation will be cancelled in one step.
              </p>
            </div>
          </div>
        )}
      </section>

      {(showCancelModal && (activeBooking || activeReservation)) && (
        <Modal open={showCancelModal} onClose={() => {
          if (isCancelling) return;
          // Per CRL-06: drop the preview state on
          // close so a previous session's
          // breakdown never bleeds into a new one.
          setShowCancelModal(false);
          cancelPreviewRequestIdRef.current += 1;
          setCancelPreview(null);
          setCancelPreviewError(null);
        }} title="Cancel reservation?">
          <form onSubmit={handleCancelBookingSubmit} className="space-y-4">
            {/* Per MRB-10 (2026-08-02, per decision #169):
                the cancel modal copy is reservation-scope
                when the view is reservation-scope. The
                guest sees the room count and a per-room
                list so they can verify they're
                cancelling the right reservation. The
                per-room copy mirrors the spec in
                BOOKING-LOOKUP.md §MRB-13. */}
            {activeReservation ? (
              <>
                <p className="text-sm text-gray-600 leading-relaxed">
                  This will cancel all <strong>{guestCancellableReservationRooms.length} eligible room{guestCancellableReservationRooms.length === 1 ? "" : "s"}</strong> in your reservation <span className="font-mono font-semibold text-gray-900">{activeReservation.reservationRef}</span>. This action is permanent.
                </p>
                <ul className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
                  {guestCancellableReservationRooms.map((room) => (
                    <li key={room.id} className="flex justify-between">
                      <span className="font-mono">{room.bookingRef} · {room.roomType}</span>
                      <span className="text-gray-500">Room {room.position}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : activeBooking ? (
              <p className="text-sm text-gray-600 leading-relaxed">
                Are you sure you want to cancel your booking <span className="font-mono font-semibold text-gray-900">{activeBooking.bookingRef}</span>? This action is permanent.
              </p>
            ) : null}
            {/* Per CRL-04/06 (2026-08-02): the explicit "no refund is
                automatic" line is the same in the booking-cancelled
                email and the admin confirm modal. CRL-06 allows paid
                pre-arrival cancellations after this policy preview,
                so the staff-processing distinction is material. */}
            <p className="text-sm text-gray-600 leading-relaxed">
              <strong>No refund is issued automatically</strong> by the cancellation. If you have already sent payment, our team will review your booking and reach out to arrange any applicable refund.
            </p>

            {/* Per CRL-06 (2026-08-02): the financial-effect
                preview. The panel is mounted below the
                CRL-04 callout so the guest sees the
                policy-derived breakdown before tapping
                confirm. The panel is best-effort — the
                destructive cancel still proceeds if the
                preview errors. The state resets to `null`
                on close (see the modal `onClose` +
                `handleCancelBookingSubmit` paths). */}
            <CancellationPreviewPanel
              preview={cancelPreview}
              isLoading={cancelPreviewLoading}
              error={cancelPreviewError}
            />

            <label className="grid gap-2 text-sm font-semibold text-gray-700">
              Reason for Cancellation (optional)
              <textarea
                placeholder="Please tell us why you are cancelling..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                disabled={isCancelling}
                className="min-h-24 w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            {cancelError && (
              <p className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-600">
                {cancelError}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowCancelModal(false);
                  cancelPreviewRequestIdRef.current += 1;
                  // Per CRL-06: drop the preview
                  // state on close so a previous
                  // session's breakdown never
                  // bleeds into a new one.
                  setCancelPreview(null);
                  setCancelPreviewError(null);
                }}
                disabled={isCancelling}
                className="min-h-11 rounded-lg border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                No, keep booking
              </button>
              <button
                type="submit"
                disabled={isCancelling}
                className="min-h-11 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 shadow-sm shadow-red-600/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCancelling ? "Cancelling..." : "Yes, cancel reservation"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <Footer />
    </main>
  );
}
