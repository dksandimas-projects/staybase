import { AlertTriangle, ArrowLeft, Calendar, ListChecks, Mail, Search, ShieldAlert, Sparkles, User, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { scaleIn } from "@spark-inn/shared";
import type { BookingRateBreakdown } from "@spark-inn/shared";
import config from "@config";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { Modal } from "../components/Modal";
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
  // Per decision #128 (2026-07-25): the email-alone entry
  // point on the public /my-booking page no longer reflects
  // the guest name back to the caller. The strict paths
  // (ref+email, ref+token, ref alone, token alone) still
  // include it because they each demonstrate possession of a
  // non-email secret. The field is optional on the client
  // shape; the page branches on its presence to hide the
  // "Lead Guest" section (mirroring the picker's field-
  // absence signal from decision #126).
  guestName?: string;
  guestEmail: string;
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

  // Action state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sent" | "rate-limited" | "error">("idle");
  const [resendError, setResendError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState<number>(0);
  const [resendCooldownTick, setResendCooldownTick] = useState(0);
  const lastAutoLookupSignatureRef = useRef("");

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

  // Per H2 (hardening batch 2026-06-26): `performLookup`
  // takes an optional token; when present, the email
  // field is omitted from the request body. The server
  // picks the token-vs-email query path based on which
  // is supplied.
  const performLookup = async (bookingRef: string, guestEmail?: string, token?: string) => {
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
      if (bookingRef) {
        payload.bookingRef = bookingRef;
      }
      if (token) {
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
      const kind = (data?.kind ?? "single") as "single" | "list";
      if (kind === "list" && Array.isArray(data?.bookings)) {
        setPickerResults(data.bookings as PickerEntry[]);
        setPickerMoreExist(Boolean(data?.moreExist));
        // Clear any stale single-booking state from a prior
        // lookup. The picker takes over the result area until
        // the user clicks a row.
        setActiveBooking(null);
        // Mark so the finally block leaves the Turnstile
        // token in place — the row click reuses it.
        showedPicker = true;
        return;
      }

      const normalized: BookingData = {
        id: data.id,
        bookingRef: data.bookingRef,
        guestName: data.guestName,
        guestEmail: data.guestEmail,
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
    const ref = searchParams.get("ref");
    // Per H2 (hardening batch 2026-06-26): the deep-link
    // now carries `?token=<lookupToken>` (set by the
    // email magic link + the StaysPage "View details"
    // link). The legacy `?email=` is still accepted for
    // backward compat with any old in-flight links.
    const token = searchParams.get("token");
    const email = searchParams.get("email");
    if (!ref) return;
    if (!token && !email) return;
    // Per BI-02/BI-03: the magic-link auto-lookup must wait for the
    // Turnstile widget to issue a token — the lookup endpoint is
    // gated for real now. The effect re-runs when the token arrives
    // (deps below); the signature guard keeps it single-fire.
    if (!turnstileToken) return;
    const signature = `${ref}::${token || email || ""}`;
    if (lastAutoLookupSignatureRef.current === signature) return;
    lastAutoLookupSignatureRef.current = signature;
    setRefInput(ref);
    if (email) setEmailInput(email);
    setHasSearched(true);
    void performLookup(ref, email || undefined, token || undefined);
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
    setPickerResults(null);
    setPickerMoreExist(false);
    setResendStatus("idle");
    setResendError("");
    setCancelError("");
    setShowCancelModal(false);
    setCancelReason("");
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
    if (!activeBooking) return;
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
        activeBooking.status === "pending" || activeBooking.status === "payment-uploaded"
          ? "booking-submitted"
          : "booking-confirmed";

      const response = await fetch(`/api/email/${triggerAction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingRef: activeBooking.bookingRef,
          guestEmail: activeBooking.guestEmail
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
    if (!activeBooking) return;
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
      const cancelPayload: Record<string, string> = {
        bookingRef: activeBooking.bookingRef,
        reason: cancelReason,
        turnstileToken
      };
      if (lookupAuthMode === "token" && activeLookupToken) {
        cancelPayload.token = activeLookupToken;
      } else {
        cancelPayload.guestEmail = activeBooking.guestEmail;
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

      setActiveBooking({ ...activeBooking, status: "cancelled" });
      setShowCancelModal(false);
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

  const paymentLabels: Record<string, string> = {
    gcash: "Digital Wallet (GCash/Maya)",
    "pay-at-hotel": "Pay at Hotel",
    paypal: "PayPal",
    bank: "Bank Transfer"
  };

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
  const canCancel =
    activeBooking?.status === "pending" || activeBooking?.status === "payment-uploaded";
  const canResend = Boolean(activeBooking) && !isCancelled;

  const cooldownRemainingMs = Math.max(0, resendCooldownUntil - Date.now());
  const isOnCooldown = cooldownRemainingMs > 0;
  const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900">
      <Navbar />

      <section className="mx-auto max-w-4xl px-4 pt-10 pb-20">
        {/* Per MBP / decision #123 (2026-07-24): the picker
            renders here when the email-alone lookup matched
            >1 booking. The result area cycles between search
            form → picker (if >1 match) → single-booking card
            (after the user picks a row). Each state is
            exclusive. */}
        {pickerResults && pickerResults.length > 0 ? (
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
        ) : !activeBooking ? (
          <motion.div
            variants={scaleIn}
            initial={shouldReduceMotion ? false : "hidden"}
            animate="visible"
            className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
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
                Booking Reference
                <input
                  type="text"
                  placeholder="e.g. SI-20260612-042"
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
        ) : (
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
                        Email sent to {activeBooking.guestEmail}.
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
                        <p className="mt-1 font-semibold text-gray-900">
                          {activeBooking.numGuests} {activeBooking.numGuests === 1 ? "Guest" : "Guests"}
                        </p>
                        <p className="text-xs text-gray-500">{activeBooking.numNights} {activeBooking.numNights === 1 ? "night" : "nights"} duration</p>
                      </div>
                    </div>

                    {/* Per decision #128 (2026-07-25): the
                        email-alone 1-match path omits guestName
                        from the response (no second factor), so
                        this section hides entirely for that
                        case. The user can still see their booking
                        via ref + dates + room + status + email,
                        and the email itself is reflected back via
                        the "Email sent to" status line above. The
                        strict paths (ref+email, ref+token, ref
                        alone, token alone) still include
                        guestName and render the full section. */}
                    {activeBooking.guestName && (
                      <div className="flex gap-3">
                        <User className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase">Lead Guest</p>
                          <p className="mt-1 font-semibold text-gray-900">{activeBooking.guestName}</p>
                          <p className="text-xs text-gray-500">{activeBooking.guestEmail}</p>
                        </div>
                      </div>
                    )}
                  </div>

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
                    <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                      <ShieldAlert size={20} className="shrink-0" />
                      <p>This reservation was cancelled. If this is an error, please contact the front desk.</p>
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
                        {paymentLabels[activeBooking.paymentMethod] ?? activeBooking.paymentMethod}
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
      </section>

      {showCancelModal && activeBooking && (
        <Modal open={showCancelModal} onClose={() => !isCancelling && setShowCancelModal(false)} title="Cancel reservation?">
          <form onSubmit={handleCancelBookingSubmit} className="space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              Are you sure you want to cancel your booking <span className="font-mono font-semibold text-gray-900">{activeBooking.bookingRef}</span>? This action is permanent.
            </p>

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
                onClick={() => setShowCancelModal(false)}
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
