import { CalendarPlus, CheckCircle2, Clock, ExternalLink, Home, Mail, MessageSquareText, Phone, Sparkles, Star, X } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { buildGoogleCalendarUrl, buildIcsContent, downloadIcsFile, resolvePaymentMethodLabel, scaleIn, staggerChild, staggerContainer } from "@spark-inn/shared";
import type { BookingRateBreakdown } from "@spark-inn/shared";
import config from "@config";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { Navbar } from "../components/Navbar";
import { PriceBreakdown } from "../components/PriceBreakdown";
import { PrimaryButton } from "../components/PrimaryButton";
import { useGuestAuth } from "../context/GuestAuthContext";
import { useRoomTypes } from "../hooks/useRoomTypes";
// Per feat/special-requests-redirect (2026-08-21): the redirect
// card on the confirmation page reads the per-hotel contact
// override (Settings → Hotel Info) with the deploy-time
// `hotel.config.ts` as the fallback. Same source-of-truth chain
// as ContactPage + Footer.
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import { formatPrice } from "../utils/format";

function formatStayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function parseRateBreakdown(value: string | null): BookingRateBreakdown | null {
  if (!value) return null;
  try {
    return JSON.parse(decodeURIComponent(value)) as BookingRateBreakdown;
  } catch {
    return null;
  }
}

interface ConfirmedRoom {
  bookingId: string;
  roomType: string;
  reservationPosition: number;
  numAdults: number;
  numChildren: number;
  extraBedCount: number;
  hasBreakfast: boolean;
  totalPrice: number;
}

function parseConfirmedRooms(value: string | null): ConfirmedRoom[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function BookingConfirmPage() {
  const [searchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const { roomTypes } = useRoomTypes();
  const { user, memberProfile } = useGuestAuth();
  // Per feat/special-requests-redirect (2026-08-21): the
  // redirect card on the confirmation page reads the per-hotel
  // contact override (Settings → Hotel Info) with the
  // deploy-time `hotel.config.ts` as the fallback. Same pattern
  // as ContactPage + Footer.
  const { contact } = usePublicSiteContent();
  const redirectPhone = contact?.frontDeskPhone || config.frontDeskPhone;
  const redirectEmail = contact?.supportEmail || config.supportEmail;

  // The payment-method label shown to the guest is now sourced
  // from `settings/hotelConfig.paymentMethods[].label` (admin-
  // editable) so the confirm page never hardcodes "Digital Wallet"
  // / "Bank Transfer" / "Pay at Hotel". The dynamic label is
  // resolved through the shared `resolvePaymentMethodLabel`
  // helper (decision #200, 2026-08-07) so the confirm page + the
  // my-booking single card + the my-booking reservation card all
  // read through the same legacy-fallback logic.
  const [dynamicPaymentMethods, setDynamicPaymentMethods] = useState<
    ReadonlyArray<{ method: string; label: string }> | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "hotelConfig"));
        if (cancelled) return;
        const raw = snap.exists()
          ? (snap.data() as { paymentMethods?: unknown }).paymentMethods
          : null;
        const safe: ReadonlyArray<{ method: string; label: string }> = Array.isArray(raw)
          ? (raw as Array<{ method?: unknown; label?: unknown }>)
              .filter(
                (m): m is { method: string; label: string } =>
                  !!m &&
                  typeof m === "object" &&
                  typeof (m as { method?: unknown }).method === "string" &&
                  typeof (m as { label?: unknown }).label === "string"
              )
              .map((m) => ({ method: m.method, label: m.label }))
          : [];
        if (!cancelled) setDynamicPaymentMethods(safe);
      } catch {
        if (!cancelled) setDynamicPaymentMethods(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const rawPaymentMethod = searchParams.get("paymentMethod") ?? "gcash";
  // `dynamicPaymentMethods` is the admin-editable config. While
  // Firestore is still resolving the page renders the raw key
  // (or the legacy map, for the common cases) — the helper
  // handles every shape of input so the user never sees a
  // blank label.
  const resolvedPaymentMethodLabel =
    dynamicPaymentMethods !== null
      ? resolvePaymentMethodLabel(rawPaymentMethod, dynamicPaymentMethods)
      : resolvePaymentMethodLabel(rawPaymentMethod, null);

  // Read query params from URL
  // Per BF-27 (booking-flow audit 2026-06-26): the previous
  // fallbacks hardcoded mock data (e.g. `2026-06-12` /
  // `2026-06-14` / `total: 6400`) which produced a convincing-
  // looking but fake confirmation page if a user landed on the
  // bare URL. Now we surface a friendly "no booking details"
  // state when any required param is missing.
  const bookingRef = searchParams.get("bookingRef") ?? "";
  const checkIn = searchParams.get("checkIn") ?? "";
  const checkOut = searchParams.get("checkOut") ?? "";
  const guests = Number(searchParams.get("guests") ?? 0);
  // Per the room-type booking refactor: confirmation page receives
  // the chosen `roomType` and the server-assigned `roomNumber`
  // (passed through from /api/bookings/create response). Falls back
  // to `roomId` for legacy URL params.
  const roomTypeParam = searchParams.get("roomType") ?? "";
  const roomNumberParam = searchParams.get("roomNumber") ?? "";
  const roomTypeEntry = roomTypes.find((t) => t.value === roomTypeParam);
  const roomDisplayLabel = roomTypeEntry?.label ?? roomTypeParam;
  const confirmedRooms = parseConfirmedRooms(searchParams.get("rooms"));
  const roomSummaryLabel = confirmedRooms.length > 1
    ? `${confirmedRooms.length} rooms`
    : roomDisplayLabel;
  const total = Number(searchParams.get("total") ?? 0);
  const rateBreakdown = parseRateBreakdown(searchParams.get("rateBreakdown"));
  const hasAllParams = !!(bookingRef && checkIn && checkOut && guests > 0);

  const paymentMethodLabel = resolvedPaymentMethodLabel;

  function handleAddToCalendar() {
    const address = `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`;
    // Per the refactor/room-number-visibility change: only the
    // room type is surfaced on the post-booking confirmation
    // page (and the calendar event it generates). Room
    // assignment is shown to the guest at check-in instead.
    const roomLine = roomSummaryLabel;
    const descriptionLines = [
      `Booking reference: ${bookingRef}`,
      `Guests: ${guests}`,
      `Room: ${roomLine}`,
      `Total: ${formatPrice(total)}`,
      `Payment: ${paymentMethodLabel}`
    ];
    const icsContent = buildIcsContent({
      uid: `${bookingRef}@${config.domain}`,
      title: `Stay at ${config.brandName} (${bookingRef})`,
      description: descriptionLines.join("\n"),
      location: address,
      start: checkIn,
      end: checkOut,
      allDay: true,
      brand: config.brandName
    });
    // Per BF-11 (booking-flow audit 2026-06-26): the previous
    // filename hardcoded `spark-inn-`, which violates the
    // white-label rule (GOTCHAS.md). The bookingRef already
    // carries the configured prefix (e.g. "SI-...") and the
    // brand name is in the event title; just use the ref.
    downloadIcsFile(`${bookingRef}.ics`, icsContent);
  }

  const googleCalendarUrl = buildGoogleCalendarUrl({
    uid: `${bookingRef}@${config.domain}`,
    title: `Stay at ${config.brandName} (${bookingRef})`,
    description: (() => {
      // See handleAddToCalendar above — room number is not
      // surfaced in the calendar event description either.
      const roomLine = roomSummaryLabel;
      return `Booking reference: ${bookingRef}\nGuests: ${guests}\nRoom: ${roomLine}\nTotal: ${formatPrice(total)}\nPayment: ${paymentMethodLabel}`;
    })(),
    location: `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`,
    start: checkIn,
    end: checkOut,
    allDay: true,
    brand: config.brandName
  });

  const isOnlinePayment = rawPaymentMethod === "gcash" || rawPaymentMethod === "bank";
  const isRewardsMember = !!user && !!memberProfile?.isMember;
  const showRewardsJoinPrompt = !isRewardsMember;

  // Per EC-02 (2026-08-21): the "Request Early Check-In"
  // section on Step 4. The button is gated on (a) the
  // member being signed in (Spark Rewards perk) AND (b) the
  // admin toggle in Settings → Rewards tab. The strong
  // disclaimer copy sits next to the button so the member
  // sees the exact wording before they open the modal —
  // "not guaranteed, subject to approval, email will be
  // received for the approval or rejection".
  const [earlyCheckInEnabled, setEarlyCheckInEnabled] = useState<boolean>(true);
  // Per fix/early-checkin-payment-uploaded-allowlist (2026-08-21):
  // the booking status is fetched so the "Request early
  // check-in" button only appears when the booking is in one
  // of the three statuses the server allowlists. Mirrors the
  // rewardsConfig fetch above (best-effort, doesn't block the
  // page on a transient read failure). Defaults to a
  // conservative "" so the gate stays closed until the read
  // resolves — a guest on payment-uploaded sees the button
  // appear as soon as the status arrives (typically < 200ms).
  const [bookingStatus, setBookingStatus] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "rewardsConfig"));
        if (!cancelled && snap.exists()) {
          const data = snap.data();
          // Default to true when absent so pre-EC-02 deployments
          // keep the perk on until the admin explicitly turns it off.
          setEarlyCheckInEnabled(data?.earlyCheckInEnabled !== false);
        }
      } catch (err) {
        console.error("[BookingConfirmPage] Failed to load rewardsConfig:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    // Fetch the booking status so the client gate mirrors the
    // server allowlist in `guest-app/server/handlers/email.ts`
    // (`ALLOWED_EARLY_CHECKIN_STATUSES`). Until the read
    // resolves, `bookingStatus` is "" which is not in the
    // allowlist, so the button stays hidden — the conservative
    // default avoids a click → 400 surprise.
    if (!bookingRef) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "bookings", bookingRef));
        if (!cancelled && snap.exists()) {
          const data = snap.data();
          setBookingStatus(typeof data?.status === "string" ? data.status : "");
        }
      } catch (err) {
        console.error("[BookingConfirmPage] Failed to load booking status:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [bookingRef]);
  // Per fix/early-checkin-payment-uploaded-allowlist (2026-08-21):
  // the gate mirrors the server allowlist in
  // `guest-app/server/handlers/email.ts`. The button only
  // appears when the booking is in one of the three allowed
  // statuses — `payment-uploaded` (the common case after a
  // guest paid online but before staff verified), `payment-
  // confirmed` (staff verified but not yet transitioned), or
  // `confirmed` (the existing allowlist). All other statuses
  // hide the button so the guest never sees a click that
  // secretly 400s. The two sides stay in sync via the shared
  // allowlist shape — server enforces for defense in depth,
  // client enforces for UX (no confusing error toast).
  const ALLOWED_EARLY_CHECKIN_STATUSES = [
    "payment-uploaded",
    "payment-confirmed",
    "confirmed"
  ] as const;
  const bookingStatusAllowsEarlyCheckIn = (ALLOWED_EARLY_CHECKIN_STATUSES as readonly string[])
    .includes(bookingStatus);
  const showEarlyCheckInButton = isRewardsMember && earlyCheckInEnabled && bookingStatusAllowsEarlyCheckIn;
  const [showEarlyCheckInModal, setShowEarlyCheckInModal] = useState(false);
  const [earlyCheckInRequestedTime, setEarlyCheckInRequestedTime] = useState<string>("11:00 AM");
  const [earlyCheckInNotes, setEarlyCheckInNotes] = useState<string>("");
  const [earlyCheckInSubmitting, setEarlyCheckInSubmitting] = useState(false);
  const [earlyCheckInSent, setEarlyCheckInSent] = useState(false);
  const [earlyCheckInError, setEarlyCheckInError] = useState<string | null>(null);
  // Reset all modal state when closing — the per-booking
  // guest can re-open after a decline / after re-thinking.
  // Per fix/early-checkin-modal-success-state (2026-08-21):
  // the success state (`earlyCheckInSent`) is reset alongside
  // notes + error so re-opening the modal starts on the form,
  // not on a stale "Request sent" panel. Pre-fix the success
  // flag persisted across closes — opening the modal after a
  // previous successful submit would show the success panel
  // instead of the form.
  const closeEarlyCheckInModal = () => {
    setShowEarlyCheckInModal(false);
    setEarlyCheckInNotes("");
    setEarlyCheckInError(null);
    setEarlyCheckInSent(false);
  };
  const handleSubmitEarlyCheckIn = async () => {
    if (!user) {
      setEarlyCheckInError("Please sign in to your member account to submit a request.");
      return;
    }
    setEarlyCheckInSubmitting(true);
    setEarlyCheckInError(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/email/early-checkin-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          bookingRef,
          request: {
            requestedCheckInTime: earlyCheckInRequestedTime,
            notes: earlyCheckInNotes
          }
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to submit the request.");
      }
      setEarlyCheckInSent(true);
    } catch (submitErr) {
      console.error("Early check-in submit failed:", submitErr);
      setEarlyCheckInError(
        submitErr instanceof Error
          ? submitErr.message
          : "Unable to submit the request. Please try again."
      );
    } finally {
      setEarlyCheckInSubmitting(false);
    }
  };

  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        animate: "visible"
      };

  // Per BF-27: when the URL is missing required booking details
  // (user landed on /book/confirm directly, or the redirect was
  // lost), render a friendly empty state instead of fake data.
  if (!hasAllParams) {
    return (
      <main className="min-h-screen bg-gray-50 font-body text-gray-900">
        <Navbar />
        <section className="mx-auto max-w-[620px] px-4 pt-20 pb-20 text-center">
          <h1 className="font-heading text-3xl text-gray-950 sm:text-4xl">
            No booking details found
          </h1>
          <p className="mt-4 text-base text-gray-600">
            We couldn't find your booking in the link. Please return to the
            homepage and start a new booking, or check your email for the
            original confirmation.
          </p>
          <div className="mt-8">
            <PrimaryButton to="/" className="sm:min-w-56">
              <Home size={18} />
              Return to Homepage
            </PrimaryButton>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900">
      <Navbar />

      <section className="mx-auto max-w-[620px] px-4 pt-10 pb-20">
        {/* Success Header */}
        <motion.div
          className="flex flex-col items-center text-center"
          variants={scaleIn}
          {...entranceProps}
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-light text-primary shadow-lg shadow-primary-light/50">
            <CheckCircle2 size={48} className="animate-pulse" />
          </div>
          <h1 className="mt-6 font-heading text-4xl text-gray-950 sm:text-5xl">
            {isOnlinePayment ? "Booking submitted for review" : "Your booking is confirmed."}
          </h1>
          <p className="mt-3 text-base text-gray-600 sm:text-lg">
            {isOnlinePayment
              ? "We have received your details. Our team is verifying your payment and will send an official confirmation shortly."
              : `We're looking forward to hosting you at ${config.brandName}.`}
          </p>
        </motion.div>

        {/* Booking Reference Box */}
        <motion.div
          className="mx-auto mt-8 flex flex-col items-center rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Reservation Reference</span>
          <span className="mt-1 font-mono text-2xl font-bold tracking-tight text-primary">{bookingRef}</span>
        </motion.div>

        {/* Details Card */}
        <motion.div
          className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
        >
          <h2 className="font-heading text-2xl text-gray-950">Reservation Details</h2>
          <div className="mt-6 space-y-5">
            <div className="flex justify-between border-b border-gray-100 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {confirmedRooms.length > 1 ? "Rooms" : "Room Type"}
                </p>
                {confirmedRooms.length > 1 ? (
                  <div className="mt-2 space-y-2">
                    {confirmedRooms.map((room) => {
                      const type = roomTypes.find((entry) => entry.value === room.roomType);
                      return (
                        <div key={room.bookingId} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                          <span className="font-semibold text-gray-900">
                            Room {room.reservationPosition} · {type?.label || room.roomType}
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">
                            {room.numAdults} adult{room.numAdults === 1 ? "" : "s"} ·{" "}
                            {room.numChildren} child{room.numChildren === 1 ? "" : "ren"}
                            {room.extraBedCount > 0 ? ` · ${room.extraBedCount} extra bed${room.extraBedCount === 1 ? "" : "s"}` : ""}
                            {room.hasBreakfast ? " · Breakfast included" : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1 font-semibold text-gray-900">
                    {roomDisplayLabel || "Reserved"}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Your specific room is assigned at check-in.
                </p>
              </div>
            </div>

            <div className="flex justify-between border-b border-gray-100 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Stay Dates</p>
                <p className="mt-1 font-semibold text-gray-900">
                  {formatStayDate(checkIn)} — {formatStayDate(checkOut)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-b border-gray-100 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Guests</p>
                <p className="mt-1 font-semibold text-gray-900">{guests} {guests === 1 ? "Guest" : "Guests"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Payment Method</p>
                <p className="mt-1 font-semibold text-gray-900">{paymentMethodLabel}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="font-semibold text-gray-900">Total Price</span>
              <span className="text-2xl font-bold text-primary">{formatPrice(total)}</span>
            </div>
            {rateBreakdown ? (
              <PriceBreakdown breakdown={rateBreakdown} total={total} />
            ) : null}
          </div>
        </motion.div>

        {/* Email Alert Banner */}
        <motion.div
          className="mt-6 flex items-center justify-center gap-2 px-4 text-center text-sm italic text-gray-600"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          <Mail size={16} className="text-primary" />
          <span>
            {isOnlinePayment
              ? "An acknowledgment email has been sent. Official confirmation will follow after payment verification."
              : "A confirmation has been sent to your email. See you soon!"}
          </span>
        </motion.div>

        {/* Per feat/special-requests-redirect (2026-08-21): the
            "Forgot something?" prompt lives right after the email
            alert and before the early check-in section. The
            confirmation moment is when guests most often remember
            a special need (late check-in, dietary notes, room
            preferences) — surfacing the prompt here, with the
            booking ref already on the page, gives the guest a
            clear path to reach the front desk without leaving the
            flow. Same per-hotel contact override as the booking
            form redirect (Settings → Hotel Info →
            `hotel.config.ts` fallback). */}
        <motion.div
          data-testid="special-requests-redirect"
          className="mt-6 rounded-xl border border-primary/20 bg-primary-light p-5 shadow-sm"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <div className="flex items-start gap-3">
            <MessageSquareText
              size={20}
              className="mt-0.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div className="flex-1">
              <h3 className="font-heading text-base text-gray-950">
                Forgot something? Need something special?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-700">
                If you have requests like late check-in, dietary needs, or room preferences,
                please reach out before your stay — we&apos;ll do our best to accommodate:
              </p>
              <ul className="mt-3 flex flex-col gap-1.5 text-xs sm:flex-row sm:gap-4">
                <li className="flex items-center gap-1.5">
                  <Mail size={14} className="text-primary" aria-hidden="true" />
                  <a
                    href={`mailto:${redirectEmail}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {redirectEmail}
                  </a>
                </li>
                <li className="flex items-center gap-1.5">
                  <Phone size={14} className="text-primary" aria-hidden="true" />
                  <a
                    href={`tel:${redirectPhone}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {redirectPhone}
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </motion.div>

        {/* Per EC-02 (2026-08-21): Spark Rewards early
            check-in request section. The button is visible
            ONLY to logged-in members when the admin toggle is
            on. The strong disclaimer is right under the
            button so the member sees the exact wording before
            they open the modal — "not guaranteed and is for
            approval, email will be received for the approval
            or rejection". A separate `sent` state shows a
            confirmation panel after the request goes through
            (so the member doesn't accidentally double-submit
            if they re-open the modal). */}
        {showEarlyCheckInButton && (
          <motion.div
            data-testid="early-checkin-request-section"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.4 }}
          >
            <div className="flex items-start gap-3">
              <Clock size={20} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="flex-1">
                <h3 className="font-heading text-base text-amber-950">
                  Request early check-in
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-amber-900">
                  As a {config.rewardsName} member, you can request an earlier arrival for
                  booking <span className="font-mono font-bold">{bookingRef}</span>. This
                  request is <strong>not guaranteed</strong> — it's subject to approval by our
                  team, and you'll receive an email once we approve or decline the request.
                </p>
                {earlyCheckInSent ? (
                  <div
                    data-testid="early-checkin-sent"
                    className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"
                  >
                    <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
                    Request sent — we'll email you when our team has reviewed it.
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowEarlyCheckInModal(true);
                      setEarlyCheckInError(null);
                    }}
                    data-testid="early-checkin-open-modal"
                    className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                  >
                    <Clock size={14} />
                    Request early check-in
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Action Buttons */}
        <motion.div
          className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <GhostButton type="button" className="sm:min-w-48" onClick={handleAddToCalendar}>
            <CalendarPlus size={18} />
            Download .ics
          </GhostButton>
          <a
            href={googleCalendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-250 bg-white px-5 text-sm font-semibold text-gray-800 shadow-sm transition hover:border-primary hover:text-primary sm:min-w-48"
          >
            <ExternalLink size={16} />
            Add to Google Calendar
          </a>
          <PrimaryButton to="/" className="sm:min-w-48">
            <Home size={18} />
            Return to Homepage
          </PrimaryButton>
        </motion.div>

        {showRewardsJoinPrompt && (
          <motion.div
            className="mt-10 rounded-xl border border-primary/20 bg-sidebar p-6 text-white shadow-md"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.45 }}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={20} className="text-primary animate-pulse" />
              <h3 className="text-lg font-bold">Join {config.rewardsName}</h3>
            </div>
            <p className="mt-2 text-sm text-gray-300">
              Sign up now to earn points on this stay and unlock member-only benefits for your next visit!
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-xs text-gray-300">
              <div className="flex items-center gap-2">
                <Star size={14} className="text-primary" />
                <span>Earn Points</span>
              </div>
              <div className="flex items-center gap-2">
                <Star size={14} className="text-primary" />
                <span>Member Discounts</span>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <PrimaryButton to={user ? "/rewards" : "/signup"} className="w-full text-xs font-semibold py-2">
                {user ? "Join Rewards" : "Sign up with email"}
              </PrimaryButton>
              <GhostButton to="/rewards" className="w-full text-xs font-semibold border-white text-white hover:bg-white/10 py-2">
                Learn more
              </GhostButton>
            </div>
          </motion.div>
        )}

        {/* Per EC-02 (2026-08-21): the early check-in request
            modal. Single-booking flow (no picker) — the URL
            params carry the bookingRef so the server can
            resolve via the same `findBooking` helper the
            RewardsPage path uses. The disclaimer copy is
            repeated inside the modal so the member sees it
            before they hit submit (not just next to the
            button). After a successful send the modal flips
            to a confirmation panel — the section above also
            flips to the "Request sent" callout, so closing
            the modal doesn't lose the success state. */}
        {showEarlyCheckInModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="early-checkin-modal-title"
          >
            <motion.div
              data-testid="early-checkin-modal"
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md rounded-card-lg bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <h3
                  id="early-checkin-modal-title"
                  className="font-heading text-xl text-gray-950"
                >
                  Request early check-in
                </h3>
                <button
                  type="button"
                  onClick={closeEarlyCheckInModal}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                  aria-label="Close early check-in modal"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                <strong>Heads up:</strong> early check-in is a member perk and is{" "}
                <strong>not guaranteed</strong>. Your request is subject to approval by our
                team. You'll receive an email once we approve or decline the request.
              </div>
              {earlyCheckInSent ? (
                // Per fix/early-checkin-modal-success-state (2026-08-21):
                // the success state swaps the form out for a
                // confirmation panel. The CheckCircle2 icon + the
                // "Request sent" copy give the guest instant
                // confirmation; the single Done button closes the
                // modal. The X close button at the top of the modal
                // header continues to work in this state (it calls
                // the same closeEarlyCheckInModal), so the guest
                // has two equivalent dismiss paths.
                <div
                  data-testid="early-checkin-sent"
                  className="mt-5 flex flex-col items-center gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center"
                >
                  <CheckCircle2
                    size={36}
                    className="text-emerald-600"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-bold text-emerald-900">
                      Request sent
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-emerald-800">
                      We&apos;ll email you at your booking contact when our team
                      has reviewed the request.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeEarlyCheckInModal}
                    className="min-h-[44px] rounded-lg bg-emerald-700 px-6 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-5 space-y-4">
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        Requested arrival time
                      </span>
                      <select
                        value={earlyCheckInRequestedTime}
                        onChange={(e) => setEarlyCheckInRequestedTime(e.target.value)}
                        disabled={earlyCheckInSubmitting}
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="08:00 AM">08:00 AM</option>
                        <option value="09:00 AM">09:00 AM</option>
                        <option value="10:00 AM">10:00 AM</option>
                        <option value="11:00 AM">11:00 AM</option>
                        <option value="12:00 PM">12:00 PM (noon)</option>
                        <option value="01:00 PM">01:00 PM</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        Notes for our team (optional)
                      </span>
                      <textarea
                        value={earlyCheckInNotes}
                        onChange={(e) => setEarlyCheckInNotes(e.target.value)}
                        rows={3}
                        maxLength={500}
                        disabled={earlyCheckInSubmitting}
                        placeholder="e.g. arriving from a long flight, would help to be settled earlier"
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    {earlyCheckInError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                      >
                        {earlyCheckInError}
                      </div>
                    )}
                  </div>
                  <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeEarlyCheckInModal}
                      disabled={earlyCheckInSubmitting}
                      className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSubmitEarlyCheckIn()}
                      disabled={earlyCheckInSubmitting}
                      data-testid="early-checkin-submit"
                      className="min-h-[44px] rounded-lg bg-amber-700 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {earlyCheckInSubmitting ? "Sending…" : "Submit request"}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </section>

      <Footer />
    </main>
  );
}
