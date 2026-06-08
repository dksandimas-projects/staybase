import { ArrowLeft, Calendar, FileText, Landmark, Mail, Search, ShieldAlert, Sparkles, User, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { scaleIn } from "@spark-inn/shared";
import config from "@config";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { Modal } from "../components/Modal";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusBadge } from "../components/StatusBadge";
import { formatPrice } from "../utils/format";
import { cn } from "../utils/cn";

interface BookingData {
  bookingRef: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  roomName: string;
  roomNumber: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  numNights: number;
  numGuests: number;
  ratePerNight: number;
  totalPrice: number;
  paymentMethod: string;
  status: string;
  hasBreakfast: boolean;
  specialRequests: string;
}

const mockBookingsList: BookingData[] = [
  {
    bookingRef: "SI-20260612-042",
    guestName: "Maria Santos",
    guestEmail: "maria@example.com",
    guestPhone: "+63 917 000 0000",
    roomName: "Executive Queen",
    roomNumber: "201",
    roomType: "executive",
    checkIn: "2026-06-12",
    checkOut: "2026-06-14",
    numNights: 2,
    numGuests: 2,
    ratePerNight: 3200,
    totalPrice: 6400,
    paymentMethod: "gcash",
    status: "pending",
    hasBreakfast: false,
    specialRequests: "Late check-in around 8 PM, please."
  },
  {
    bookingRef: "SI-09214",
    guestName: "Alex Mercer",
    guestEmail: "member@sparkinn.com",
    guestPhone: "+63 912 345 6789",
    roomName: "The Riverview Suite",
    roomNumber: "305",
    roomType: "executive",
    checkIn: "2026-10-12",
    checkOut: "2026-10-15",
    numNights: 3,
    numGuests: 2,
    ratePerNight: 4500,
    totalPrice: 13500,
    paymentMethod: "bank",
    status: "confirmed",
    hasBreakfast: true,
    specialRequests: "High floor, quiet room please."
  },
  {
    bookingRef: "SI-08103",
    guestName: "Alex Mercer",
    guestEmail: "member@sparkinn.com",
    guestPhone: "+63 912 345 6789",
    roomName: "Garden Sanctuary Villa",
    roomNumber: "102",
    roomType: "family",
    checkIn: "2025-08-05",
    checkOut: "2025-08-09",
    numNights: 4,
    numGuests: 4,
    ratePerNight: 7500,
    totalPrice: 30000,
    paymentMethod: "gcash",
    status: "checked-out",
    hasBreakfast: true,
    specialRequests: "Vegetarian breakfast options."
  },
  {
    bookingRef: "SI-07524",
    guestName: "Alex Mercer",
    guestEmail: "member@sparkinn.com",
    guestPhone: "+63 912 345 6789",
    roomName: "Sky Loft",
    roomNumber: "401",
    roomType: "single",
    checkIn: "2025-07-10",
    checkOut: "2025-07-12",
    numNights: 2,
    numGuests: 2,
    ratePerNight: 5500,
    totalPrice: 11000,
    paymentMethod: "pay-at-hotel",
    status: "cancelled",
    hasBreakfast: false,
    specialRequests: ""
  }
];

function formatStayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export function BookingLookupPage() {
  const shouldReduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();

  // Search state
  const [refInput, setRefInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeBooking, setActiveBooking] = useState<BookingData | null>(null);

  // Modal and Action state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [resendStatus, setResendStatus] = useState("");

  // Check URL parameters for direct lookup
  useEffect(() => {
    const ref = searchParams.get("ref");
    const email = searchParams.get("email");
    if (ref && email) {
      setRefInput(ref);
      setEmailInput(email);
      setHasSearched(true);
      
      const found = mockBookingsList.find(
        (b) =>
          b.bookingRef === ref.trim().toUpperCase() &&
          b.guestEmail.toLowerCase() === email.trim().toLowerCase()
      );

      if (found) {
        setActiveBooking({ ...found });
      } else {
        setActiveBooking(null);
        setSearchError(
          "We couldn't find a booking with those details. Please check your reference number and email."
        );
      }
    }
  }, [searchParams]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError("");
    setHasSearched(true);

    const found = mockBookingsList.find(
      (b) =>
        b.bookingRef === refInput.trim().toUpperCase() &&
        b.guestEmail.toLowerCase() === emailInput.trim().toLowerCase()
    );

    if (found) {
      setActiveBooking({ ...found });
    } else {
      setActiveBooking(null);
      setSearchError(
        "We couldn't find a booking with those details. Please check your reference number and email."
      );
    }
  };

  const handleResetSearch = () => {
    setRefInput("");
    setEmailInput("");
    setHasSearched(false);
    setSearchError("");
    setActiveBooking(null);
    setResendStatus("");
  };

  const handleResendEmail = () => {
    setResendStatus("sending");
    setTimeout(() => {
      setResendStatus("sent");
      alert(`Confirmation email has been resent to ${activeBooking?.guestEmail}!`);
    }, 800);
  };

  const handleCancelBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeBooking) {
      setActiveBooking({
        ...activeBooking,
        status: "cancelled"
      });
      setShowCancelModal(false);
      setCancelReason("");
      alert("Your booking has been cancelled successfully.");
    }
  };

  const paymentLabels: Record<string, string> = {
    gcash: "Digital Wallet (GCash/Maya)",
    bank: "Bank Transfer",
    "pay-at-hotel": "Pay at Hotel"
  };

  // Timeline step calculations
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
    return -1; // e.g. cancelled
  };

  const currentStepIndex = activeBooking ? getActiveStepIndex(activeBooking.status) : -1;
  const isCancelled = activeBooking?.status === "cancelled";

  return (
    <main className="min-h-screen bg-gray-50 pb-20 font-body text-gray-900">
      <Navbar />

      <section className="mx-auto max-w-4xl px-4 pt-10">
        {!activeBooking ? (
          // Look up Form
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
                Enter your booking reference number and email to check your stay status.
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
                  required
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Email Address
                <input
                  type="email"
                  placeholder="maria@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  required
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                />
              </label>

              {searchError && (
                <p className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-600">
                  {searchError}
                </p>
              )}

              <PrimaryButton type="submit" className="w-full">
                Find My Booking
              </PrimaryButton>
            </form>

            <div className="mt-6 border-t border-gray-100 pt-6 text-center text-xs text-gray-500">
              <p>Demo lookup details:</p>
              <p className="mt-1 font-mono text-gray-700">
                Ref: <span className="font-semibold text-primary">SI-20260612-042</span>
              </p>
              <p className="font-mono text-gray-700">
                Email: <span className="font-semibold text-primary">maria@example.com</span>
              </p>
            </div>
          </motion.div>
        ) : (
          // Found Booking View
          <div className="space-y-6">
            <button
              onClick={handleResetSearch}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              <ArrowLeft size={16} />
              Back to search
            </button>

            {/* Main Header Row */}
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

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2">
                <GhostButton onClick={handleResendEmail} disabled={resendStatus === "sending"}>
                  <Mail size={16} />
                  {resendStatus === "sending" ? "Resending..." : "Resend Email"}
                </GhostButton>
                {(activeBooking.status === "pending" || activeBooking.status === "payment-uploaded") && (
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
              {/* Left Column: Details */}
              <div className="space-y-6">
                {/* Stay Summary Card */}
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

                    <div className="flex gap-3">
                      <User className="mt-0.5 h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase">Lead Guest</p>
                        <p className="mt-1 font-semibold text-gray-900">{activeBooking.guestName}</p>
                        <p className="text-xs text-gray-500">{activeBooking.guestEmail}</p>
                      </div>
                    </div>
                  </div>

                  {activeBooking.specialRequests && (
                    <div className="mt-6 border-t border-gray-100 pt-5">
                      <p className="text-xs font-semibold text-gray-500 uppercase">Special Requests</p>
                      <p className="mt-1 text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{activeBooking.specialRequests}</p>
                    </div>
                  )}
                </div>

                {/* Visual Status Timeline */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-bold text-gray-950 mb-5">Timeline</h2>
                  
                  {isCancelled ? (
                    <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                      <ShieldAlert size={20} className="shrink-0" />
                      <p>This reservation was cancelled. If this is an error, please contact the front desk.</p>
                    </div>
                  ) : (
                    <div className="relative flex flex-col gap-6 md:flex-row md:justify-between md:gap-0">
                      {/* Desktop timeline horizontal connector bar */}
                      <div className="absolute top-4 left-0 hidden h-1 w-full bg-gray-200 md:block" />
                      
                      {timelineSteps.map((step, index) => {
                        const isCompleted = index <= currentStepIndex;
                        const isActive = index === currentStepIndex;

                        return (
                          <div
                            key={step.label}
                            className="relative flex items-start gap-4 md:flex-col md:items-center md:gap-0 md:text-center md:flex-1"
                          >
                            {/* Connector bar (mobile) */}
                            {index > 0 && (
                              <div className="absolute -top-6 left-4 h-6 w-0.5 bg-gray-200 md:hidden" />
                            )}

                            {/* Node Dot */}
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

                            {/* Node labels */}
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

              {/* Right Column: Pricing & Booking details */}
              <div className="space-y-6">
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-bold text-gray-950 mb-4">Pricing & Details</h2>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Room Type</span>
                      <span className="font-semibold text-gray-900">{activeBooking.roomName} (Room {activeBooking.roomNumber})</span>
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

                    <div className="border-t border-gray-100 pt-4 flex justify-between items-end">
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase block">Total Price</span>
                        <span className="text-2xl font-bold text-primary">{formatPrice(activeBooking.totalPrice)}</span>
                      </div>
                      <span className="text-xs text-gray-500">VAT inclusive</span>
                    </div>
                  </div>
                </div>

                {/* Help Banner */}
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

      {/* Cancellation Confirmation Modal */}
      {showCancelModal && activeBooking && (
        <Modal open={showCancelModal} onClose={() => setShowCancelModal(false)} title="Cancel reservation?">
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
                className="min-h-24 w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
              />
            </label>

            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="min-h-11 rounded-lg border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
              >
                No, keep booking
              </button>
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 shadow-sm shadow-red-600/20"
              >
                Yes, cancel reservation
              </button>
            </div>
          </form>
        </Modal>
      )}

      <Footer />
    </main>
  );
}
