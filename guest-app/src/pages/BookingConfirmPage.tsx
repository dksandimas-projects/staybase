import { CalendarPlus, CheckCircle2, ExternalLink, Home, Mail, Sparkles, Star } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { buildGoogleCalendarUrl, buildIcsContent, downloadIcsFile, scaleIn, staggerChild, staggerContainer } from "@spark-inn/shared";
import config from "@config";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { useRoomTypes } from "../hooks/useRoomTypes";
import { formatPrice } from "../utils/format";

function formatStayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export function BookingConfirmPage() {
  const [searchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const { roomTypes } = useRoomTypes();

  // Read query params from URL
  const bookingRef = searchParams.get("bookingRef") ?? `SI-${new Date().getFullYear()}0612-042`;
  const checkIn = searchParams.get("checkIn") ?? "2026-06-12";
  const checkOut = searchParams.get("checkOut") ?? "2026-06-14";
  const guests = Number(searchParams.get("guests") ?? 2);
  // Per the room-type booking refactor: confirmation page receives
  // the chosen `roomType` and the server-assigned `roomNumber`
  // (passed through from /api/bookings/create response). Falls back
  // to `roomId` for legacy URL params.
  const roomTypeParam = searchParams.get("roomType") ?? "";
  const roomNumberParam = searchParams.get("roomNumber") ?? "";
  const roomTypeEntry = roomTypes.find((t) => t.value === roomTypeParam);
  const roomDisplayLabel = roomTypeEntry?.label ?? roomTypeParam;
  const rawPaymentMethod = searchParams.get("paymentMethod") ?? "gcash";
  const total = Number(searchParams.get("total") ?? 6400);

  const paymentLabels: Record<string, string> = {
    gcash: "Digital Wallet (GCash/Maya)",
    bank: "Bank Transfer (Direct Deposit)",
    "pay-at-hotel": "Pay at Hotel"
  };

  const paymentMethodLabel = paymentLabels[rawPaymentMethod] ?? rawPaymentMethod;

  function handleAddToCalendar() {
    const address = `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`;
    const roomLine = roomNumberParam
      ? `${roomDisplayLabel} — Room ${roomNumberParam}`
      : roomDisplayLabel;
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
      const roomLine = roomNumberParam
        ? `${roomDisplayLabel} — Room ${roomNumberParam}`
        : roomDisplayLabel;
      return `Booking reference: ${bookingRef}\nGuests: ${guests}\nRoom: ${roomLine}\nTotal: ${formatPrice(total)}\nPayment: ${paymentMethodLabel}`;
    })(),
    location: `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`,
    start: checkIn,
    end: checkOut,
    allDay: true,
    brand: config.brandName
  });

  const isOnlinePayment = rawPaymentMethod === "gcash" || rawPaymentMethod === "bank";

  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        animate: "visible"
      };

  return (
    <main className="min-h-screen bg-gray-50 pb-20 font-body text-gray-900">
      <Navbar />

      <section className="mx-auto max-w-[620px] px-4 pt-10">
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
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Booking Reference</span>
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
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Room Type</p>
                <p className="mt-1 font-semibold text-gray-900">
                  {roomDisplayLabel || "Reserved"}
                  {roomNumberParam ? (
                    <span className="ml-2 text-sm font-medium text-primary">Room {roomNumberParam}</span>
                  ) : null}
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

        {/* Spark Rewards Sign-up Incentive Block */}
        <motion.div
          className="mt-10 rounded-xl border border-primary/20 bg-sidebar p-6 text-white shadow-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.45 }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-primary animate-pulse" />
            <h3 className="text-lg font-bold">Join Spark Rewards</h3>
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
            <PrimaryButton to="/signup" className="w-full text-xs font-semibold py-2">
              Sign up with email
            </PrimaryButton>
            <GhostButton to="/rewards" className="w-full text-xs font-semibold border-white text-white hover:bg-white/10 py-2">
              Learn more
            </GhostButton>
          </div>
        </motion.div>
      </section>

      <Footer />
    </main>
  );
}
