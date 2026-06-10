import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BedDouble,
  Building,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Coins,
  CreditCard,
  FileText,
  Info,
  Landmark,
  Mail,
  MessageSquareText,
  Minus,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  User,
  UserRound,
  Users,
  Wallet
} from "lucide-react";
import {
  calculateBookingTotal,
  getNumNights,
  staggerChild,
  staggerContainer,
  DEFAULT_ROOM_TYPES,
  VERSION,
  type Room
} from "@spark-inn/shared";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { StepIndicator } from "../components/StepIndicator";
import { useRooms } from "../hooks/useRooms";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
const steps = ["Select Room", "Guest Details", "Review & Pay", "Confirmation"];

type RateChoice = "room-only" | "room-breakfast";
type GuestField = "firstName" | "lastName" | "email" | "phone" | "guestCount" | "designation" | "companyAddress";
type CorporateCodeIssue = "expired" | "usage-cap" | "inactive" | "invalid";

const corporateCodeMessages: Record<CorporateCodeIssue, string> = {
  expired: "This corporate access code has expired. You can still continue with the flat corporate rate.",
  "usage-cap": "This code has reached its usage cap. Please ask your account manager for a refreshed code.",
  inactive: "This code is currently inactive. Please contact the company travel admin before using it.",
  invalid: "That code is not recognized. Check the code, or continue without a code."
};

function formatStayDate(value: string) {
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export function CorporateBookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const currentStepKey = searchParams.get("step") ?? "gate";

  // Corporate validation state (persisted in sessionStorage)
  const [accessCode, setAccessCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  
  const [companyName, setCompanyName] = useState(() => sessionStorage.getItem("corp_companyName") ?? "");
  const [activeCode, setActiveCode] = useState(() => sessionStorage.getItem("corp_code") ?? "");
  const [discountPercent, setDiscountPercent] = useState(() => Number(sessionStorage.getItem("corp_discount") ?? "0"));
  const [isFlatRate, setIsFlatRate] = useState(() => sessionStorage.getItem("corp_isFlatRate") === "true");

  // Booking states
  const [checkIn, setCheckIn] = useState(searchParams.get("checkIn") ?? "2026-06-12");
  const [checkOut, setCheckOut] = useState(searchParams.get("checkOut") ?? "2026-06-14");
  const [guests, setGuests] = useState(Number(searchParams.get("guests") ?? 2));
  const [selectedType, setSelectedType] = useState("all");
  const [selectedRoomId, setSelectedRoomId] = useState(searchParams.get("roomId") ?? "");
  const [rateChoice, setRateChoice] = useState<RateChoice>(
    searchParams.get("breakfast") === "yes" ? "room-breakfast" : "room-only"
  );

  // Breakfast config fetched from Firestore
  const [breakfastConfig, setBreakfastConfig] = useState({ isEnabled: false, ratePerPersonPerNight: 250 });

  // Live rooms from Firestore
  const { rooms, loading: roomsLoading } = useRooms();

  // Corporate specific details
  const [guestDetails, setGuestDetails] = useState({
    firstName: searchParams.get("firstName") ?? "",
    lastName: searchParams.get("lastName") ?? "",
    email: searchParams.get("email") ?? "",
    phone: searchParams.get("phone") ?? "",
    guestCount: String(Number(searchParams.get("guests") ?? 2)),
    designation: searchParams.get("designation") ?? "",
    companyName: companyName || (searchParams.get("companyName") ?? ""),
    companyAddress: searchParams.get("companyAddress") ?? "",
    purposeOfStay: searchParams.get("purposeOfStay") ?? "Business Travel",
    billingArrangement: (searchParams.get("billingArrangement") as "personal" | "chargeback") ?? "personal",
    requests: searchParams.get("requests") ?? "",
    consent: false
  });

  const [touchedFields, setTouchedFields] = useState<Record<GuestField, boolean>>({
    firstName: false,
    lastName: false,
    email: false,
    phone: false,
    guestCount: false,
    designation: false,
    companyAddress: false
  });

  // Step 3 State
  const [billingFile, setBillingFile] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "bank">("gcash");
  const [termsConsent, setTermsConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync companyName from state when it validates
  useEffect(() => {
    if (companyName) {
      setGuestDetails(prev => ({ ...prev, companyName }));
    }
  }, [companyName]);

  // Gate Security Check: Redirect to gate if navigating directly to steps without code validation
  useEffect(() => {
    if (currentStepKey !== "gate" && !companyName && !isFlatRate) {
      // Clear step parameter to send back to gate
      const next = new URLSearchParams(searchParams);
      next.delete("step");
      setSearchParams(next, { replace: true });
    }
  }, [currentStepKey, companyName, isFlatRate, searchParams, setSearchParams]);

  // Fetch breakfast config from Firestore on mount
  useEffect(() => {
    const db = getFirestore();
    getDoc(doc(db, "settings", "breakfastConfig")).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        setBreakfastConfig({
          isEnabled: d.isEnabled !== false,
          ratePerPersonPerNight: d.ratePerPersonPerNight || 250,
        });
      }
    }).catch(() => {
      // Keep defaults on error
    });
  }, []);

  const nights = Math.max(getNumNights(checkIn, checkOut), 1);

  // Rooms list
  const availableRooms = useMemo(
    () =>
      rooms.filter((room) => {
        const typeMatches = selectedType === "all" || room.type === selectedType;
        return room.isActive && room.maxCapacity >= guests && typeMatches;
      }),
    [guests, selectedType]
  );

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0];
  const hasBreakfast = breakfastConfig.isEnabled && rateChoice === "room-breakfast";
  const breakfastRatePerPerson = breakfastConfig.ratePerPersonPerNight;

  // Calculate pricing
  const baseRate = selectedRoom ? selectedRoom.corporateRate : 0;
  // Apply additional code discount if active
  const ratePerNight = Math.round(baseRate * (1 - discountPercent / 100));

  const roomTotal = ratePerNight * nights;
  const breakfastTotal = hasBreakfast ? breakfastRatePerPerson * guests * nights : 0;
  const subtotal = roomTotal + breakfastTotal;

  // Calculate total
  const total = calculateBookingTotal({
    ratePerNight,
    numNights: nights,
    numGuests: guests,
    breakfastRate: breakfastRatePerPerson,
    hasBreakfast,
    discountPct: 0, // discounts already applied to ratePerNight
    voucherDiscount: 0 // corporate flow doesn't use standard vouchers
  });

  const stepIndicatorIndex = useMemo(() => {
    switch (currentStepKey) {
      case "select-room": return 1;
      case "guest-details": return 2;
      case "review": return 3;
      case "confirm": return 4;
      default: return 0;
    }
  }, [currentStepKey]);

  // Validations for Step 2
  const guestErrors = {
    firstName: guestDetails.firstName.trim() ? "" : "First name is required.",
    lastName: guestDetails.lastName.trim() ? "" : "Last name is required.",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestDetails.email) ? "" : "Enter a valid email address.",
    phone: guestDetails.phone.trim().length >= 8 ? "" : "Phone number is required.",
    guestCount:
      Number(guestDetails.guestCount) >= 1 && selectedRoom && Number(guestDetails.guestCount) <= selectedRoom.maxCapacity
        ? ""
        : `Guest count must be between 1 and ${selectedRoom?.maxCapacity ?? guests}.`,
    designation: guestDetails.designation.trim() ? "" : "Designation is required.",
    companyAddress: guestDetails.companyAddress.trim() ? "" : "Company address is required."
  };

  const canContinueToReview =
    Object.values(guestErrors).every((error) => !error) &&
    guestDetails.consent &&
    Boolean(selectedRoom) &&
    (isFlatRate ? guestDetails.companyName.trim().length > 0 : true);

  // State transitions
  function updateDateParams(nextCheckIn = checkIn, nextCheckOut = checkOut, nextGuests = guests) {
    const next = new URLSearchParams(searchParams);
    next.set("checkIn", nextCheckIn);
    next.set("checkOut", nextCheckOut);
    next.set("guests", String(nextGuests));
    if (selectedRoomId) next.set("roomId", selectedRoomId);
    setSearchParams(next, { replace: true });
  }

  function updateGuests(nextGuests: number) {
    const safeGuests = Math.min(Math.max(nextGuests, 1), 6);
    setGuests(safeGuests);
    updateDateParams(checkIn, checkOut, safeGuests);
  }

  function selectRoom(roomId: string, nextRateChoice: RateChoice) {
    setSelectedRoomId(roomId);
    setRateChoice(nextRateChoice);
    const next = new URLSearchParams(searchParams);
    next.set("roomId", roomId);
    next.set("checkIn", checkIn);
    next.set("checkOut", checkOut);
    next.set("guests", String(guests));
    setSearchParams(next, { replace: true });
  }

  function updateGuestDetail(field: keyof typeof guestDetails, value: string | boolean) {
    setGuestDetails((current) => ({
      ...current,
      [field]: value
    }));
  }

  function markTouched(field: GuestField) {
    setTouchedFields((current) => ({
      ...current,
      [field]: true
    }));
  }

  // Code validation logic
  async function handleValidateCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeError("");
    setIsValidating(true);

    try {
      const code = accessCode.trim().toUpperCase();
      const response = await fetch("/api/validate/corporate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, turnstileToken: "mock_token" })
      });
      const result = await response.json();

      if (result.success && result.data) {
        setCompanyName(result.data.companyName);
        setActiveCode(result.data.code);
        setDiscountPercent(0);
        setIsFlatRate(false);
        sessionStorage.setItem("corp_companyName", result.data.companyName);
        sessionStorage.setItem("corp_code", result.data.code);
        sessionStorage.setItem("corp_discount", "0");
        sessionStorage.setItem("corp_isFlatRate", "false");
      } else {
        setCodeError(result.error || corporateCodeMessages.invalid);
      }
    } catch {
      setCodeError("Unable to validate code. Please check your connection and try again.");
    } finally {
      setIsValidating(false);
    }
  }

  function handleContinueFlatRate() {
    setCompanyName("");
    setActiveCode("");
    setDiscountPercent(0);
    setIsFlatRate(true);
    sessionStorage.setItem("corp_companyName", "");
    sessionStorage.setItem("corp_code", "");
    sessionStorage.setItem("corp_discount", "0");
    sessionStorage.setItem("corp_isFlatRate", "true");

    // Advance to room selection
    const next = new URLSearchParams(searchParams);
    next.set("step", "select-room");
    setSearchParams(next);
  }

  function handleClearValidation() {
    setCompanyName("");
    setActiveCode("");
    setDiscountPercent(0);
    setIsFlatRate(false);
    setAccessCode("");
    sessionStorage.removeItem("corp_companyName");
    sessionStorage.removeItem("corp_code");
    sessionStorage.removeItem("corp_discount");
    sessionStorage.removeItem("corp_isFlatRate");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      setBillingFile(e.target.files[0].name);
    }
  }

  // Step transitions
  const continueParams = new URLSearchParams({
    step: "guest-details",
    checkIn,
    checkOut,
    guests: String(guests),
    roomId: selectedRoom?.id ?? "",
    breakfast: hasBreakfast ? "yes" : "no"
  });

  const reviewParams = new URLSearchParams(continueParams);
  reviewParams.set("step", "review");
  reviewParams.set("firstName", guestDetails.firstName);
  reviewParams.set("lastName", guestDetails.lastName);
  reviewParams.set("email", guestDetails.email);
  reviewParams.set("phone", guestDetails.phone);
  reviewParams.set("designation", guestDetails.designation);
  reviewParams.set("companyName", guestDetails.companyName);
  reviewParams.set("companyAddress", guestDetails.companyAddress);
  reviewParams.set("purposeOfStay", guestDetails.purposeOfStay);
  reviewParams.set("billingArrangement", guestDetails.billingArrangement);
  reviewParams.set("requests", guestDetails.requests);

  const [bookingResponse, setBookingResponse] = useState<{ ref: string } | null>(null);
  const [submitError, setSubmitError] = useState("");

  function getBackToPath() {
    if (currentStepKey === "confirm") return "/corporate";
    if (currentStepKey === "review") {
      return `/corporate/book?step=guest-details&${continueParams.toString()}`;
    }
    if (currentStepKey === "guest-details") {
      return `/corporate/book?step=select-room&${continueParams.toString()}`;
    }
    if (currentStepKey === "select-room") {
      return "/corporate/book";
    }
    return "/corporate";
  }

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError("");

    try {
      const body = {
        bookingId: `corp-${Date.now()}`,
        roomId: selectedRoom?.id ?? "",
        checkIn,
        checkOut,
        guests: Number(guestDetails.guestCount) || guests,
        hasBreakfast: hasBreakfast,
        guestDetails: {
          firstName: guestDetails.firstName,
          lastName: guestDetails.lastName,
          email: guestDetails.email,
          phone: guestDetails.phone,
          requests: guestDetails.requests,
          consent: guestDetails.consent,
          companyName: guestDetails.companyName,
          designation: guestDetails.designation,
          companyAddress: guestDetails.companyAddress,
          purposeOfStay: guestDetails.purposeOfStay,
          preferredBillingArrangement: guestDetails.billingArrangement === "personal" ? "personal" : "chargeback",
        },
        discountType: "" as const,
        discountIdPhotoUrl: null,
        paymentMethod: "pay-at-hotel",
        isCorporate: true,
        corporateCode: activeCode || undefined,
        _hp: "",
      };

      const response = await fetch("/api/bookings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();

      if (result.success && result.data) {
        setBookingResponse({ ref: result.data.bookingRef });
        const params = new URLSearchParams({
          step: "confirm",
          bookingRef: result.data.bookingRef,
          roomId: selectedRoom?.id ?? "",
          checkIn,
          checkOut,
          guests: String(guests),
          companyName: guestDetails.companyName,
          billingArrangement: guestDetails.billingArrangement,
          total: String(total || result.data.totalPrice || 0),
        });
        setSearchParams(params);
      } else {
        setSubmitError(result.error || "Booking submission failed. Please try again.");
        setIsSubmitting(false);
      }
    } catch {
      setSubmitError("Unable to submit booking. Please check your connection and try again.");
      setIsSubmitting(false);
    }
  };

  const bookingShell = (content: React.ReactNode) => (
    <main className="min-h-screen bg-gray-50 pb-32 font-body text-gray-900">
      {/* Dark Corporate Header */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950 px-4 py-4 shadow-sm backdrop-blur sm:px-6 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link
            aria-label="Back"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-300 hover:bg-gray-900 hover:text-white"
            to={getBackToPath()}
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/" aria-label={config.brandName} className="flex items-center justify-center">
              <img src={`/brand/${config.logos.white}`} alt={config.brandName} className="h-10 w-auto" />
            </Link>
            <div className="h-5 w-px bg-gray-800 hidden sm:block" />
            <span className="rounded bg-primary px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white hidden sm:inline-block">
              Corporate Booking Portal
            </span>
          </div>
          <span className="min-h-11 min-w-11" />
        </div>
        
        {/* Persistent corporate rate badge */}
        {(companyName || isFlatRate) && currentStepKey !== "confirm" && (
          <div className="bg-primary/10 border-t border-primary/20 text-center py-1.5 text-xs text-primary font-medium">
            Active Negotiated Pricing: <span className="font-bold underline">{companyName || "Flat Corporate Rate"}</span>
            {activeCode && ` (${discountPercent}% additional discount applied)`}
          </div>
        )}
      </header>
      {content}
    </main>
  );

  // ==================== GATE / LANDING VIEW ====================
  if (currentStepKey === "gate") {
    return (
      <main className="min-h-screen bg-gray-950 text-white font-body overflow-x-hidden flex flex-col">
        {/* Header */}
        <header className="px-6 py-6 max-w-7xl mx-auto w-full flex items-center justify-between">
          <Link to="/corporate" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition">
            <ArrowLeft size={16} /> Back to Corporate
          </Link>
          <Link to="/">
            <img src={`/brand/${config.logos.white}`} alt={config.brandName} className="h-10 w-auto" />
          </Link>
        </header>

        {/* Content Panel */}
        <div className="flex-1 flex items-center justify-center px-4 py-12 relative">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <img
              src="https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80"
              alt="Lounge"
              className="w-full h-full object-cover"
            />
          </div>

          <motion.div 
            className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-card-lg p-8 shadow-2xl relative z-10"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="text-center mb-8">
              <span className="text-[10px] uppercase font-bold tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full">
                Negotiated Rates Gate
              </span>
              <h1 className="mt-4 font-heading text-2xl text-white">Corporate Booking</h1>
              <p className="mt-2 text-sm text-gray-400">
                Validate a negotiated access code, or continue with the flat corporate rate for business stays.
              </p>
            </div>

            {companyName ? (
              /* Already validated state */
              <div className="space-y-6">
                <div className="rounded-lg bg-green-950/40 border border-green-800/60 p-4 text-sm text-green-300">
                  <div className="flex gap-2.5">
                    <CheckCircle2 size={20} className="shrink-0 text-green-400" />
                    <div>
                      <p className="font-semibold text-green-200">Verified: {companyName}</p>
                      <p className="mt-1 text-xs text-green-400">
                        Code {activeCode} unlocked an extra {discountPercent}% discount.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <PrimaryButton 
                    to="/corporate/book?step=select-room"
                    className="w-full h-11"
                  >
                    Begin Booking <ChevronRight size={16} />
                  </PrimaryButton>
                  <GhostButton
                    type="button"
                    onClick={handleClearValidation}
                    className="w-full border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white"
                  >
                    Use Different Code
                  </GhostButton>
                </div>
              </div>
            ) : (
              /* Form State */
              <form onSubmit={handleValidateCode} className="space-y-6">
                {codeError && (
                  <div className="rounded-lg bg-red-950/40 border border-red-800/60 p-4 text-sm text-red-400 flex gap-2">
                    <Info size={18} className="shrink-0 mt-0.5" />
                    <span>{codeError}</span>
                  </div>
                )}

                <label className="grid gap-2 text-sm font-medium text-gray-300">
                  Access Code
                  <input
                    type="text"
                    className="min-h-11 rounded-lg border border-gray-800 bg-gray-950 px-3.5 text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder-gray-600"
                    placeholder="e.g. ACME123"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    required
                  />
                  <span className="text-xs leading-5 text-gray-500">
                    Enter the access code provided by your company.
                  </span>
                </label>

                <div className="flex flex-col gap-4">
                  <PrimaryButton
                    type="submit"
                    className="w-full h-11 text-base font-semibold"
                    disabled={isValidating}
                  >
                    {isValidating ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Validating...
                      </span>
                    ) : (
                      "Validate Access Code"
                    )}
                  </PrimaryButton>

                  <button
                    type="button"
                    onClick={handleContinueFlatRate}
                    className="text-sm font-semibold text-primary hover:text-primary-light transition text-center underline decoration-2 py-2"
                  >
                    Continue without code
                  </button>
                </div>
              </form>
            )}

            <div className="mt-8 border-t border-gray-800 pt-6 text-center text-xs text-gray-500">
              Need corporate rate codes?{" "}
              <Link to="/corporate" className="text-gray-400 hover:text-white underline">
                Inquire here
              </Link>
            </div>
          </motion.div>
        </div>
        <div className="text-center py-6 text-xs text-gray-600 border-t border-gray-900 bg-gray-950">
          {config.brandName} Corporate Booking Flow. v{VERSION}
        </div>
      </main>
    );
  }

  // ==================== STEP 1: SELECT ROOM ====================
  if (currentStepKey === "select-room") {
    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={1} />
          </div>
          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 1 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Select Corporate Room</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Browse negotiated configurations and availability. Room rates shown are corporate rates matching your contract agreement.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
          {/* Left panel filter */}
          <aside className="hidden lg:sticky lg:top-36 lg:block lg:self-start">
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <h2 className="text-lg font-semibold text-gray-950 mb-5">Configure stay</h2>
              
              <div className="space-y-6">
                <DateRangePicker
                  checkIn={checkIn}
                  checkOut={checkOut}
                  onCheckInChange={(value) => {
                    setCheckIn(value);
                    updateDateParams(value, checkOut, guests);
                  }}
                  onCheckOutChange={(value) => {
                    setCheckOut(value);
                    updateDateParams(checkIn, value, guests);
                  }}
                />

                <label className="grid gap-2 text-sm font-medium text-gray-700">
                  Guests
                  <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                      type="button"
                      onClick={() => updateGuests(guests - 1)}
                    >
                      -
                    </button>
                    <span className="flex items-center gap-2 text-sm text-gray-700">
                      <Users size={16} className="text-primary" />
                      {guests} {guests === 1 ? "guest" : "guests"}
                    </span>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                      type="button"
                      onClick={() => updateGuests(guests + 1)}
                    >
                      +
                    </button>
                  </div>
                </label>

                <div>
                  <p className="text-sm font-medium text-gray-700">Room type filter</p>
                  <div className="mt-3 grid gap-2">
                    {[{ value: "all", label: "All Types" }, ...DEFAULT_ROOM_TYPES].map((type) => (
                      <button
                        key={type.value}
                        className={cn(
                          "flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm font-medium transition",
                          selectedType === type.value
                            ? "border-primary bg-primary-light text-primary"
                            : "border-gray-200 bg-white text-gray-700 hover:border-primary"
                        )}
                        type="button"
                        onClick={() => setSelectedType(type.value)}
                      >
                        {type.label}
                        {selectedType === type.value ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Right panel rooms selection list */}
          <div>
            <div className="mb-5 flex flex-col gap-3 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-gray-950">
                  {roomsLoading ? "Loading rooms..." : `${availableRooms.length} corporate options found`}
                </p>
                <p className="text-xs text-gray-600">Locked to company contract terms.</p>
              </div>
            </div>

            {roomsLoading ? (
              <div className="grid gap-6 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-card bg-white shadow-sm ring-1 ring-gray-200 overflow-hidden animate-pulse">
                    <div className="aspect-[16/10] bg-gray-200" />
                    <div className="p-5 space-y-3">
                      <div className="h-5 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                      <div className="h-8 bg-gray-100 rounded w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <motion.div
              className="grid gap-6 md:grid-cols-2"
              variants={staggerContainer}
              initial={shouldReduceMotion ? false : "hidden"}
              animate="visible"
            >
              {availableRooms.map((room) => {
                const isSelected = selectedRoomId === room.id;
                const typeLabel = DEFAULT_ROOM_TYPES.find((t) => t.value === room.type)?.shortLabel ?? room.type;
                
                // Price calculations
                const baseCorp = room.corporateRate;
                const discountedCorp = Math.round(baseCorp * (1 - discountPercent / 100));

                return (
                  <motion.article
                    key={room.id}
                    className={cn(
                      "overflow-hidden rounded-card bg-white shadow-sm ring-1 transition flex flex-col h-full",
                      isSelected ? "ring-2 ring-primary" : "ring-gray-200"
                    )}
                    variants={staggerChild}
                  >
                    <div className="aspect-[16/10] overflow-hidden bg-section-bg relative">
                      <img src={room.imageUrls[0]} alt={room.name} className="h-full w-full object-cover" />
                      <div className="absolute top-3 left-3 flex gap-2">
                        <span className="rounded bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary">
                          {typeLabel}
                        </span>
                      </div>
                    </div>

                    <div className="p-5 flex flex-col flex-1">
                      <h3 className="text-lg font-semibold text-gray-950">{room.name}</h3>
                      <p className="mt-2 text-xs text-gray-500 leading-normal flex-1 line-clamp-2">
                        {room.description}
                      </p>

                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
                        <span className="flex items-center gap-1.5">
                          <Users size={14} className="text-primary" />
                          Capacity: Up to {room.maxCapacity}
                        </span>
                        <span>{room.bedDefinition}</span>
                      </div>

                      {/* Corporate Rate Display */}
                      <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-150 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-gray-500">Corporate Price</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-lg font-bold text-gray-950">
                              {formatPrice(discountedCorp)}
                            </span>
                            {activeCode && (
                              <span className="text-xs text-gray-400 line-through">
                                {formatPrice(baseCorp)}
                              </span>
                            )}
                          </div>
                        </div>
                        {activeCode && (
                          <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded font-semibold border border-green-200">
                            -{discountPercent}% Code
                          </span>
                        )}
                      </div>

                      {/* Select Toggle */}
                      <div className="mt-5 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className={cn(
                            "h-10 rounded-lg text-xs font-semibold border transition flex items-center justify-center",
                            rateChoice === "room-only" && isSelected
                              ? "bg-primary-light border-primary text-primary"
                              : "border-gray-200 hover:border-gray-300 text-gray-700"
                          )}
                          onClick={() => selectRoom(room.id, "room-only")}
                        >
                          Room Only
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "h-10 rounded-lg text-xs font-semibold border transition flex items-center justify-center",
                            rateChoice === "room-breakfast" && isSelected
                              ? "bg-primary-light border-primary text-primary"
                              : "border-gray-200 hover:border-gray-300 text-gray-700"
                          )}
                          onClick={() => selectRoom(room.id, "room-breakfast")}
                        >
                          Room + Breakfast
                        </button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
            )}
          </div>
        </section>

        {/* Footer sticky bar */}
        <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-gray-500">
                Corporate rate for {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
                {hasBreakfast && " (Breakfast included)"}
              </p>
              <p className="text-xl font-bold text-gray-950">
                {formatPrice(total)} <span className="text-xs font-normal text-gray-500">negotiated total</span>
              </p>
            </div>
            <PrimaryButton to={`/corporate/book?${continueParams.toString()}`} className="sm:min-w-56">
              Continue to Step 2
            </PrimaryButton>
          </div>
        </div>
      </>
    );
  }

  // ==================== STEP 2: GUEST DETAILS ====================
  if (currentStepKey === "guest-details") {
    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={2} />
          </div>
          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 2 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Corporate details</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Provide employee guest details along with company references and billing arrangements.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <motion.form
            animate="visible"
            className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6"
            initial={shouldReduceMotion ? false : "hidden"}
            variants={staggerContainer}
            onSubmit={(e) => e.preventDefault()}
          >
            {/* Primary Guest Fields */}
            <h3 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-2">Employee Information</h3>
            
            <motion.div className="grid gap-5 sm:grid-cols-2 mt-4" variants={staggerChild}>
              <TextField
                error={touchedFields.firstName ? guestErrors.firstName : ""}
                icon={<UserRound size={17} />}
                label="First name"
                onBlur={() => markTouched("firstName")}
                onChange={(value) => updateGuestDetail("firstName", value)}
                placeholder="Maria"
                required
                value={guestDetails.firstName}
              />
              <TextField
                error={touchedFields.lastName ? guestErrors.lastName : ""}
                icon={<UserRound size={17} />}
                label="Last name"
                onBlur={() => markTouched("lastName")}
                onChange={(value) => updateGuestDetail("lastName", value)}
                placeholder="Santos"
                required
                value={guestDetails.lastName}
              />
            </motion.div>

            <motion.div className="mt-5 grid gap-5 sm:grid-cols-2" variants={staggerChild}>
              <TextField
                error={touchedFields.email ? guestErrors.email : ""}
                icon={<Mail size={17} />}
                label="Corporate Email"
                onBlur={() => markTouched("email")}
                onChange={(value) => updateGuestDetail("email", value)}
                placeholder="maria@company.com"
                required
                type="email"
                value={guestDetails.email}
              />
              <TextField
                error={touchedFields.phone ? guestErrors.phone : ""}
                icon={<Phone size={17} />}
                label="Phone number"
                onBlur={() => markTouched("phone")}
                onChange={(value) => updateGuestDetail("phone", value)}
                placeholder={`${config.phoneCountryCode} 917 000 0000`}
                required
                type="tel"
                value={guestDetails.phone}
              />
            </motion.div>

            {/* Corporate Specific Fields */}
            <h3 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-2 mt-8">Business References</h3>

            <motion.div className="grid gap-5 sm:grid-cols-2 mt-4" variants={staggerChild}>
              {/* Company Name */}
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Company Name
                <span className="relative">
                  <Building size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                  <input
                    className={cn(
                      "min-h-11 w-full rounded-lg border py-2 pl-10 pr-3 text-gray-950 outline-none transition",
                      isFlatRate ? "border-gray-200 bg-white focus:border-primary focus:ring-2 focus:ring-primary-light" : "border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed"
                    )}
                    type="text"
                    disabled={!isFlatRate}
                    placeholder="e.g. Acme Corp"
                    value={guestDetails.companyName}
                    onChange={(e) => updateGuestDetail("companyName", e.target.value)}
                    required
                  />
                </span>
                {!isFlatRate && <span className="text-[10px] text-gray-400">Locked by Access Code</span>}
              </label>

              {/* Designation */}
              <TextField
                error={touchedFields.designation ? guestErrors.designation : ""}
                icon={<FileText size={17} />}
                label="Job Title / Designation"
                onBlur={() => markTouched("designation")}
                onChange={(value) => updateGuestDetail("designation", value)}
                placeholder="e.g. Regional Manager"
                required
                value={guestDetails.designation}
              />
            </motion.div>

            <motion.div className="mt-5 grid gap-5 sm:grid-cols-2" variants={staggerChild}>
              {/* Purpose of Stay */}
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Purpose of Stay
                <select
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  value={guestDetails.purposeOfStay}
                  onChange={(e) => updateGuestDetail("purposeOfStay", e.target.value)}
                >
                  <option value="Business Travel">Business Travel</option>
                  <option value="Team Retreat">Team Retreat</option>
                  <option value="Project Deployment">Project Deployment</option>
                  <option value="Client Meeting">Client Meeting</option>
                </select>
              </label>

              {/* Billing Arrangement */}
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Billing Arrangement
                <select
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  value={guestDetails.billingArrangement}
                  onChange={(e) => updateGuestDetail("billingArrangement", e.target.value)}
                >
                  <option value="personal">Personal Payment (Audit Proof Upload)</option>
                  <option value="chargeback">Company Charge Back (LOU Required)</option>
                </select>
              </label>
            </motion.div>

            <motion.div className="mt-5" variants={staggerChild}>
              {/* Company Address */}
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Company Address
                <span className="relative">
                  <Building size={17} className="absolute left-3 top-4 text-primary" />
                  <textarea
                    rows={2}
                    className={cn(
                      "w-full rounded-lg border bg-white py-3 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light",
                      touchedFields.companyAddress && guestErrors.companyAddress ? "border-red-300" : "border-gray-200"
                    )}
                    onBlur={() => markTouched("companyAddress")}
                    onChange={(e) => updateGuestDetail("companyAddress", e.target.value)}
                    placeholder="e.g. 15F Tower B, Ayala Avenue, Makati City"
                    required
                    value={guestDetails.companyAddress}
                  />
                </span>
                {touchedFields.companyAddress && guestErrors.companyAddress && (
                  <span className="text-xs font-medium text-red-600">{guestErrors.companyAddress}</span>
                )}
              </label>
            </motion.div>

            {/* General Fields */}
            <motion.div className="mt-5 grid gap-5 sm:grid-cols-[160px_1fr]" variants={staggerChild}>
              <TextField
                error={touchedFields.guestCount ? guestErrors.guestCount : ""}
                icon={<Users size={17} />}
                label="Guests count"
                onBlur={() => markTouched("guestCount")}
                onChange={(value) => {
                  updateGuestDetail("guestCount", value);
                  setGuests(Number(value) || 1);
                }}
                placeholder="2"
                required
                type="number"
                value={guestDetails.guestCount}
              />
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Special requests
                <span className="relative">
                  <MessageSquareText size={17} className="absolute left-3 top-3 text-primary" />
                  <textarea
                    className="min-h-24 w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    onChange={(event) => updateGuestDetail("requests", event.target.value)}
                    placeholder="Late arrival notes, dietary options, quiet room request..."
                    value={guestDetails.requests}
                  />
                </span>
              </label>
            </motion.div>

            <motion.div className="mt-6 rounded-card bg-primary-light p-4" variants={staggerChild}>
              <label className="flex items-start gap-3 text-sm leading-6 text-gray-700">
                <input
                  checked={guestDetails.consent}
                  className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  onChange={(event) => updateGuestDetail("consent", event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I agree to the{" "}
                  <Link className="font-semibold text-primary underline" target="_blank" to="/privacy">
                    Privacy Policy
                  </Link>{" "}
                  and consent to corporate accounts audit guidelines under {config.applicableLaw}.
                </span>
              </label>
            </motion.div>
          </motion.form>

          {/* Right side review aside */}
          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={Number(guestDetails.guestCount) || guests}
            hasBreakfast={hasBreakfast}
            nights={nights}
            room={selectedRoom}
            total={total}
            ratePerNight={ratePerNight}
            breakfastRatePerPerson={breakfastConfig.ratePerPersonPerNight}
          />
        </section>

        {/* Footer sticky bar */}
        <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-gray-600">Company Billing Registration</p>
              <p className="text-base font-semibold text-gray-950">
                {canContinueToReview ? "Details verified" : "Fill details, complete consent"}
              </p>
            </div>
            {canContinueToReview ? (
              <PrimaryButton to={`/corporate/book?${reviewParams.toString()}`} className="sm:min-w-56">
                Continue to Step 3
              </PrimaryButton>
            ) : (
              <PrimaryButton disabled type="button" className="sm:min-w-56">
                Continue to Step 3
              </PrimaryButton>
            )}
          </div>
        </div>
      </>
    );
  }

  // ==================== STEP 3: REVIEW & PAY ====================
  if (currentStepKey === "review") {
    const isPersonalPay = guestDetails.billingArrangement === "personal";
    const isFileUploaded = Boolean(billingFile);
    const canConfirm = termsConsent && isFileUploaded && Boolean(selectedRoom);

    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={3} />
          </div>
          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 3 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Review & pay</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Confirm your corporate profile details and upload the required verification files to complete the request.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <div className="space-y-6">
            
            {/* Info review block */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              <h3 className="text-base font-bold text-gray-900 mb-4">Verification Overview</h3>
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs text-gray-500">Employee Traveler</p>
                  <p className="font-semibold text-gray-900">{guestDetails.firstName} {guestDetails.lastName}</p>
                  <p className="text-xs text-gray-600">{guestDetails.designation}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Corporate Member</p>
                  <p className="font-semibold text-gray-900">{guestDetails.companyName}</p>
                  <p className="text-xs text-gray-600">{guestDetails.companyAddress}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Billing Setup</p>
                  <p className="font-semibold text-primary">
                    {isPersonalPay ? "Personal Payment (Claim Reimbursement)" : "Company Direct Charge Back"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Purpose of Stay</p>
                  <p className="font-semibold text-gray-900">{guestDetails.purposeOfStay}</p>
                </div>
              </div>
            </div>

            {/* Payment / LOU File Upload Section */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              {isPersonalPay ? (
                /* Personal Payment Proof Upload */
                <div>
                  <h3 className="text-lg font-semibold text-gray-950">Personal Payment Method</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Pay using GCash or Bank Transfer, then upload the receipt screenshot below for our accounts audit.
                  </p>
                  
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-4 text-left transition",
                        paymentMethod === "gcash" ? "border-primary bg-primary-light/50 ring-1 ring-primary" : "border-gray-200 hover:bg-gray-50"
                      )}
                      onClick={() => setPaymentMethod("gcash")}
                    >
                      <Wallet className="text-primary shrink-0" size={24} />
                      <div>
                        <p className="font-semibold text-gray-950 text-sm">GCash Transfer</p>
                        <p className="text-xs text-gray-500">Instant validation</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-4 text-left transition",
                        paymentMethod === "bank" ? "border-primary bg-primary-light/50 ring-1 ring-primary" : "border-gray-200 hover:bg-gray-50"
                      )}
                      onClick={() => setPaymentMethod("bank")}
                    >
                      <Landmark className="text-primary shrink-0" size={24} />
                      <div>
                        <p className="font-semibold text-gray-950 text-sm">Bank Deposit (BDO)</p>
                        <p className="text-xs text-gray-500">1-2 hours validation</p>
                      </div>
                    </button>
                  </div>

                  <div className="mt-6 rounded-lg bg-gray-50 p-4 text-xs text-gray-700 space-y-2">
                    <p className="font-semibold text-gray-900">Transfer accounts details:</p>
                    {paymentMethod === "gcash" ? (
                      <p>GCash Account: <span className="font-bold text-gray-950">0917-000-0000</span> ({config.legalName})</p>
                    ) : (
                      <p>BDO Account Number: <span className="font-bold text-gray-950">1234-5678-9012</span> Account Name: <span className="font-bold text-gray-950">{config.legalName}</span></p>
                    )}
                  </div>

                  {/* Proof upload */}
                  <div className="mt-6">
                    <p className="text-sm font-medium text-gray-700 mb-2">Upload payment receipt screenshot <span className="text-red-500">*</span></p>
                    <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center transition hover:bg-gray-50">
                      <UploadCloud size={32} className="text-primary mb-2" />
                      <span className="text-sm font-semibold text-gray-900">
                        {billingFile ? `File Selected: ${billingFile}` : "Click to select or drop file"}
                      </span>
                      <span className="mt-1 text-xs text-gray-500">JPG, PNG, or PDF up to 5MB</span>
                      <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileChange} />
                    </label>
                  </div>
                </div>
              ) : (
                /* Company Charge Back LOU Upload */
                <div>
                  <h3 className="text-lg font-semibold text-gray-950">Company Charge Back Direct Billing</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Your company account has been set to direct bill. Please upload your Letter of Undertaking (LOU), Travel Voucher, or approved Purchase Order to authorize this reservation.
                  </p>

                  <div className="mt-6">
                    <p className="text-sm font-medium text-gray-700 mb-2">Upload Authorization / LOU Document <span className="text-red-500">*</span></p>
                    <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center transition hover:bg-gray-50">
                      <UploadCloud size={32} className="text-primary mb-2" />
                      <span className="text-sm font-semibold text-gray-900">
                        {billingFile ? `Document Loaded: ${billingFile}` : "Upload LOU / Authorization PDF"}
                      </span>
                      <span className="mt-1 text-xs text-gray-500">PDF, DOCX, or Image up to 5MB</span>
                      <input type="file" className="hidden" accept=".pdf,.doc,.docx,image/*" onChange={handleFileChange} />
                    </label>
                  </div>

                  <div className="mt-5 rounded-lg bg-primary-light/50 border border-primary/20 p-4 text-xs text-gray-700 flex gap-2">
                    <Info size={16} className="text-primary shrink-0 mt-0.5" />
                    <p>
                      Your company travel administrator will review and sign off the direct billing arrangements. The reservation remains in <span className="font-semibold">Pending Verification</span> state until authorization document is audited.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Terms and honeypot */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6 space-y-4">
              <label className="flex items-start gap-3 text-sm leading-6 text-gray-700">
                <input
                  checked={termsConsent}
                  className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  onChange={(event) => setTermsConsent(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I declare the travel information is correct. I agree to the hotel check-in/out policies, room guidelines, and corporate audit rules.
                </span>
              </label>

              {/* Turnstile simulated widget */}
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-green-500" />
                  <span className="text-xs font-semibold text-gray-800">Connection Verified (Turnstile)</span>
                </div>
                <span className="text-[10px] text-gray-400 font-bold uppercase">Cloudflare</span>
              </div>
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="rounded-card bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex gap-2">
                <Info size={18} className="shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}
          </div>

          {/* Right side review aside */}
          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={Number(guestDetails.guestCount) || guests}
            hasBreakfast={hasBreakfast}
            nights={nights}
            room={selectedRoom}
            total={total}
            ratePerNight={ratePerNight}
            breakfastRatePerPerson={breakfastConfig.ratePerPersonPerNight}
          />
        </section>

        {/* Footer sticky bar */}
        <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-gray-600">Verification file upload check</p>
              <p className="text-sm font-semibold text-gray-950">
                {isFileUploaded ? "Verification file uploaded" : "File upload required"}
              </p>
            </div>
            {canConfirm ? (
              <PrimaryButton 
                type="button" 
                className="sm:min-w-56" 
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Processing booking...
                  </span>
                ) : (
                  "Confirm Corporate Booking"
                )}
              </PrimaryButton>
            ) : (
              <PrimaryButton disabled type="button" className="sm:min-w-56">
                Confirm Corporate Booking
              </PrimaryButton>
            )}
          </div>
        </div>
      </>
    );
  }

  // ==================== STEP 4: CONFIRMATION ====================
  if (currentStepKey === "confirm") {
    const isPersonalPay = searchParams.get("billingArrangement") === "personal";
    const refCode = searchParams.get("bookingRef") ?? (bookingResponse?.ref || "Pending");
    const validatedCompany = searchParams.get("companyName") ?? companyName;
    const finalCost = Number(searchParams.get("total") ?? total);

    return bookingShell(
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <motion.div 
          className="rounded-card bg-white p-8 md:p-12 shadow-sm ring-1 ring-gray-200 text-center"
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
            <CheckCircle2 size={36} />
          </div>
          
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-primary">Booking Submitted</p>
          <h1 className="mt-2 font-heading text-3xl text-gray-950 sm:text-4xl">Booking Pending Verification</h1>
          
          <div className="mt-8 border-y border-gray-150 py-6 max-w-md mx-auto text-left text-sm space-y-4">
            <div className="flex justify-between">
              <span className="text-gray-500">Corporate Reference</span>
              <span className="font-bold text-gray-900">{refCode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Traveler Guest</span>
              <span className="font-semibold text-gray-900">{guestDetails.firstName} {guestDetails.lastName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Company Account</span>
              <span className="font-semibold text-gray-900">{validatedCompany || "Flat Corporate Client"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Billing Setup</span>
              <span className="font-semibold text-primary capitalize">{guestDetails.billingArrangement} Payment</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-gray-200 pt-3">
              <span className="text-gray-500 font-medium">Negotiated Total</span>
              <span className="font-bold text-gray-900 text-base">{formatPrice(finalCost)}</span>
            </div>
          </div>

          <div className="mt-8 max-w-lg mx-auto bg-gray-50 rounded-lg p-5 border border-gray-200 text-left text-xs text-gray-600 leading-relaxed">
            <h3 className="font-bold text-gray-900 mb-2">Next Verification Steps:</h3>
            {isPersonalPay ? (
              <p>
                We have received your corporate booking request and the uploaded payment receipt. Our reservations audit desk will review the transfer and send your verified booking confirmation email to <span className="font-semibold text-gray-800">{guestDetails.email}</span> within 2 hours.
              </p>
            ) : (
              <p>
                Your direct-billing Letter of Undertaking (LOU) has been queued for verification. A corporate accounts manager will coordinate with your company's designated billing contact to sign off the direct charge. A booking confirmation email will be dispatched to <span className="font-semibold text-gray-800">{guestDetails.email}</span> once approved.
              </p>
            )}
          </div>

          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
            <GhostButton 
              type="button" 
              onClick={() => window.print()}
              className="text-xs h-11"
            >
              Print Receipt Info
            </GhostButton>
            <PrimaryButton 
              to="/corporate" 
              className="text-xs h-11"
            >
              Return to Corporate Page
            </PrimaryButton>
          </div>
        </motion.div>
      </section>
    );
  }

  return null;
}

// ==================== HELPERS ====================

interface TextFieldProps {
  error?: string;
  icon: React.ReactNode;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  type?: string;
  value: string;
}

function TextField({ error, icon, label, onBlur, onChange, placeholder, required, type = "text", value }: TextFieldProps) {
  return (
    <label className="grid gap-2 text-sm font-medium text-gray-700">
      {label}
      {required ? <span className="sr-only">required</span> : null}
      <span className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary">{icon}</span>
        <input
          className={cn(
            "min-h-11 w-full rounded-lg border bg-white py-2 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light",
            error ? "border-red-300" : "border-gray-200"
          )}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
      </span>
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
    </label>
  );
}

interface SummaryCellProps {
  label: string;
  value: string;
  alignEnd?: boolean;
}

function SummaryCell({ label, value, alignEnd = false }: SummaryCellProps) {
  return (
    <div className={alignEnd ? "text-right" : "text-left"}>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 font-semibold text-gray-950">{value}</p>
    </div>
  );
}

interface BookingReviewAsideProps {
  checkIn: string;
  checkOut: string;
  guests: number;
  hasBreakfast: boolean;
  nights: number;
  room: Room | undefined;
  total: number;
  ratePerNight: number;
  breakfastRatePerPerson?: number;
}

function BookingReviewAside({
  checkIn,
  checkOut,
  guests,
  hasBreakfast,
  nights,
  room,
  total,
  ratePerNight,
  breakfastRatePerPerson = 250
}: BookingReviewAsideProps) {
  if (!room) return null;

  const roomTotal = ratePerNight * nights;
  const breakfastTotal = hasBreakfast ? breakfastRatePerPerson * guests * nights : 0;

  return (
    <aside className="lg:sticky lg:top-36 lg:self-start">
      <div className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
        <img src={room.imageUrls[0]} alt={room.name} className="h-52 w-full object-cover" />
        <div className="p-5">
          <h2 className="text-xl font-semibold text-gray-950">{room.name}</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 border-y border-gray-200 py-4 text-sm">
            <SummaryCell label="Check-in" value={formatStayDate(checkIn)} />
            <SummaryCell alignEnd label="Check-out" value={formatStayDate(checkOut)} />
            <SummaryCell label="Guests" value={`${guests} ${guests === 1 ? "guest" : "guests"}`} />
            <SummaryCell alignEnd label="Duration" value={`${nights} ${nights === 1 ? "night" : "nights"}`} />
          </div>
          <div className="mt-5 space-y-3 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Corporate Rate</span>
              <span>{formatPrice(roomTotal)}</span>
            </div>
            {hasBreakfast ? (
              <div className="flex justify-between">
                <span>Breakfast Add-on</span>
                <span>{formatPrice(breakfastTotal)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-dashed border-gray-200 pt-3 text-lg font-semibold text-gray-950">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
