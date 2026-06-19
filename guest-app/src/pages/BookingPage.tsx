import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
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
  UserRound,
  Users,
  Wallet
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase/config";
import {
  calculateBookingTotal,
  getNumNights,
  staggerChild,
  staggerContainer,
  DEFAULT_ROOM_TYPES,
  Room,
  compressImageFile
} from "@spark-inn/shared";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { PrimaryButton } from "../components/PrimaryButton";
import { StepIndicator } from "../components/StepIndicator";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, useRoomTypes } from "../hooks/useRoomTypes";
import { useGuestAuth } from "../context/GuestAuthContext";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";

const steps = ["Select Room", "Guest Details", "Review & Pay", "Confirmation"];
const breakfastRatePerPerson = 350;
const breakfastEnabled = true;

type RateChoice = "room-only" | "room-breakfast";
type GuestField = "firstName" | "lastName" | "email" | "phone" | "guestCount";
type VoucherIssue = "expired" | "usage-limit" | "room-mismatch" | "invalid";

const voucherMessages: Record<VoucherIssue, string> = {
  expired: "This voucher expired already. You can remove it or try another code.",
  "usage-limit": "This voucher has reached its usage limit. Please choose another code.",
  "room-mismatch": "This voucher is not valid for the selected room type.",
  invalid: "We could not find that voucher. Check the code and try again."
};

function formatStayDate(value: string) {
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

const getTodayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getTomorrowIso = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export function BookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const { rooms, loading: roomsLoading } = useRooms();
  const { roomTypes } = useRoomTypes();
  const { memberProfile } = useGuestAuth();
  const currentStepKey = searchParams.get("step") ?? "select-room";
  const isGuestDetailsStep = currentStepKey === "guest-details";
  const isReviewStep = currentStepKey === "review";

  // Spark Rewards member discount: the value is read from settings/rewardsConfig
  // and applied server-side in handleCreateBooking (per W2.2 / decision #90).
  // We mirror it client-side for the price summary display only; the server
  // is authoritative on the actual charge.
  // (Definition moved below the useState declarations; see memberDiscountPct
  // derived after rewardsConfig is loaded.)

  // Persistent unique booking ID pre-generated client-side
  const [bookingId] = useState(() => doc(collection(db, "bookings")).id);

  // Dynamic config states loaded from Firestore
  const [breakfastConfig, setBreakfastConfig] = useState({ isEnabled: false, ratePerPersonPerNight: 250 });
  const [rewardsConfig, setRewardsConfig] = useState<any>(null);
  const [hotelConfig, setHotelConfig] = useState<any>(null);
  const [websiteContent, setWebsiteContent] = useState<any>(null);
  const [allBookings, setAllBookings] = useState<any[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // Spark Rewards member discount (client-side display mirror).
  // The actual charge is computed server-side in handleCreateBooking
  // (per W2.2 / decision #90) using the same value from rewardsConfig.
  const memberDiscountPct = rewardsConfig?.memberDiscountEnabled !== false
    && memberProfile
    ? Number(rewardsConfig?.memberDiscountPct) || 0
    : 0;

  const [checkIn, setCheckIn] = useState(() => searchParams.get("checkIn") ?? getTodayIso());
  const [checkOut, setCheckOut] = useState(() => searchParams.get("checkOut") ?? getTomorrowIso());
  const [guests, setGuests] = useState(Number(searchParams.get("guests") ?? 2));
  const [selectedType, setSelectedType] = useState("all");
  const [selectedRoomId, setSelectedRoomId] = useState(searchParams.get("roomId") ?? "");
  
  // RateChoice initially set based on query search params
  const [rateChoice, setRateChoice] = useState<RateChoice>(() =>
    searchParams.get("breakfast") === "yes" ? "room-breakfast" : "room-only"
  );

  const [guestDetails, setGuestDetails] = useState({
    firstName: searchParams.get("firstName") ?? "",
    lastName: searchParams.get("lastName") ?? "",
    email: searchParams.get("email") ?? "",
    phone: searchParams.get("phone") ?? "",
    guestCount: String(Number(searchParams.get("guests") ?? 2)),
    requests: searchParams.get("requests") ?? "",
    consent: false,
    _hp: ""
  });

  const [touchedFields, setTouchedFields] = useState<Record<GuestField, boolean>>({
    firstName: false,
    lastName: false,
    email: false,
    phone: false,
    guestCount: false
  });

  // Step 3 States
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherApplied, setVoucherApplied] = useState(false);
  const [voucherDiscountValue, setVoucherDiscountValue] = useState(0);
  const [voucherDiscountType, setVoucherDiscountType] = useState<"percent" | "flat">("flat");
  const [voucherError, setVoucherError] = useState("");
  const [isValidatingVoucher, setIsValidatingVoucher] = useState(false);

  const [discountType, setDiscountType] = useState<"none" | "senior" | "pwd">("none");
  const [discountIdFile, setDiscountIdFile] = useState<string | null>(null);
  const [discountIdUrl, setDiscountIdUrl] = useState<string | null>(null);
  const [uploadingDiscountId, setUploadingDiscountId] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "bank" | "pay-at-hotel">("gcash");
  const [paymentProofFile, setPaymentProofFile] = useState<string | null>(null);
  const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null);
  const [uploadingPaymentProof, setUploadingPaymentProof] = useState(false);

  const [termsConsent, setTermsConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const navigate = useNavigate();

  const nights = Math.max(getNumNights(checkIn, checkOut), 1);

  // Filter available rooms dynamically by checking active date overlaps client-side
  const availableRooms = useMemo(() => {
    const reqStart = new Date(`${checkIn}T00:00:00Z`);
    const reqEnd = new Date(`${checkOut}T00:00:00Z`);

    return rooms.filter((room) => {
      const typeMatches = selectedType === "all" || room.type === selectedType;
      if (!room.isActive || room.status === "blocked" || room.maxCapacity < guests || !typeMatches) {
        return false;
      }

      // Check if there is an overlapping active booking
      const hasOverlap = allBookings.some((booking) => {
        if (booking.roomId !== room.id) return false;
        const bStart = booking.checkIn;
        const bEnd = booking.checkOut;
        return bStart < reqEnd && bEnd > reqStart;
      });

      return !hasOverlap;
    });
  }, [rooms, allBookings, checkIn, checkOut, guests, selectedType]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0];
  const hasBreakfast = breakfastConfig.isEnabled && rateChoice === "room-breakfast";
  const breakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || 250) : 0;

  // Calculate room total client-side, incorporating weekend rates (Saturdays and Sundays)
  const roomTotal = useMemo(() => {
    if (!selectedRoom) return 0;
    let totalRate = 0;
    const start = new Date(`${checkIn}T00:00:00Z`);
    for (let i = 0; i < nights; i++) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + i);
      const day = date.getUTCDay(); // 0 = Sun, 6 = Sat
      const isWeekend = day === 0 || day === 6;
      if (isWeekend && selectedRoom.weekendRate) {
        totalRate += selectedRoom.weekendRate;
      } else {
        totalRate += selectedRoom.pricePerNight;
      }
    }
    return totalRate;
  }, [selectedRoom, checkIn, nights]);

  const discountPct = discountType === "none" ? 0 : 20;
  const breakfastTotal = hasBreakfast ? breakfastRate * guests * nights : 0;
  const subtotal = roomTotal + breakfastTotal;

  const voucherDiscount = useMemo(() => {
    if (!voucherApplied) return 0;
    if (voucherDiscountType === "percent") {
      return Math.round(subtotal * (voucherDiscountValue / 100));
    }
    return voucherDiscountValue;
  }, [voucherApplied, voucherDiscountType, voucherDiscountValue, subtotal]);

  const total = selectedRoom
    ? calculateBookingTotal({
        ratePerNight: selectedRoom.pricePerNight,
        numNights: nights,
        numGuests: guests,
        breakfastRate: breakfastRate,
        hasBreakfast,
        discountPct,
        voucherDiscount,
        memberDiscountPct
      })
    : 0;

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
  reviewParams.set("requests", guestDetails.requests);

  const guestErrors = {
    firstName: guestDetails.firstName.trim() ? "" : "First name is required.",
    lastName: guestDetails.lastName.trim() ? "" : "Last name is required.",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestDetails.email) ? "" : "Enter a valid email address.",
    phone: guestDetails.phone.trim().length >= 8 ? "" : "Phone number is required.",
    guestCount:
      Number(guestDetails.guestCount) >= 1 && selectedRoom && Number(guestDetails.guestCount) <= selectedRoom.maxCapacity
        ? ""
        : `Guest count must be between 1 and ${selectedRoom?.maxCapacity ?? guests}.`
  };
  const canContinueToReview =
    Object.values(guestErrors).every((error) => !error) && guestDetails.consent && Boolean(selectedRoom);
  const nightlyTotal = selectedRoom ? selectedRoom.pricePerNight + (hasBreakfast ? breakfastRate * guests : 0) : 0;

  // Real-time Firestore Listeners and Config Fetches
  useEffect(() => {
    async function fetchConfigs() {
      try {
        const bSnap = await getDoc(doc(db, "settings", "breakfastConfig"));
        if (bSnap.exists()) {
          setBreakfastConfig(bSnap.data() as any);
        }
        const rSnap = await getDoc(doc(db, "settings", "rewardsConfig"));
        if (rSnap.exists()) {
          setRewardsConfig(rSnap.data());
        }
        const hSnap = await getDoc(doc(db, "settings", "hotelConfig"));
        if (hSnap.exists()) {
          setHotelConfig(hSnap.data());
        }
        const wSnap = await getDoc(doc(db, "settings", "websiteContent"));
        if (wSnap.exists()) {
          setWebsiteContent(wSnap.data());
        }
      } catch (err) {
        console.error("Error fetching configs:", err);
      } finally {
        setSettingsLoading(false);
      }
    }

    fetchConfigs();

    // Subscribe to bookings to track real-time occupancy and prevent client-side double booking selection
    const q = query(
      collection(db, "bookings"),
      where("status", "!=", "cancelled")
    );
    const unsubscribeBookings = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        checkIn: (d.data().checkIn as any)?.toDate(),
        checkOut: (d.data().checkOut as any)?.toDate()
      }));
      setAllBookings(list);
    }, (err) => {
      console.error("Bookings subscription error:", err);
    });

    return unsubscribeBookings;
  }, []);

  // Inject Turnstile script and register token callback
  useEffect(() => {
    const scriptId = "turnstile-script";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }

    (window as any).onTurnstileSuccess = (token: string) => {
      setTurnstileToken(token);
    };

    return () => {
      delete (window as any).onTurnstileSuccess;
    };
  }, []);

  useEffect(() => {
    if (!selectedRoomId && availableRooms[0]) {
      setSelectedRoomId(availableRooms[0].id);
      return;
    }

    if (selectedRoomId && !availableRooms.some((room) => room.id === selectedRoomId) && availableRooms[0]) {
      setSelectedRoomId(availableRooms[0].id);
    }
  }, [availableRooms, selectedRoomId]);

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

  // Real API calls for Voucher validation
  async function handleApplyVoucher(e: React.FormEvent) {
    e.preventDefault();
    const code = voucherCode.trim();
    if (!code) {
      setVoucherError("Please enter a code.");
      return;
    }

    setIsValidatingVoucher(true);
    setVoucherError("");

    try {
      const response = await fetch("/api/validate/voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          roomType: selectedRoom?.type,
          turnstileToken: turnstileToken || "mock_token"
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Invalid voucher code.");
      }

      setVoucherApplied(true);
      setVoucherDiscountValue(result.data.discountValue);
      setVoucherDiscountType(result.data.discountType);
      setVoucherError("");
    } catch (err: any) {
      console.error("Voucher error:", err);
      setVoucherError(err.message || "We could not find that voucher. Check the code and try again.");
      setVoucherApplied(false);
    } finally {
      setIsValidatingVoucher(false);
    }
  }

  function handleRemoveVoucher() {
    setVoucherApplied(false);
    setVoucherCode("");
    setVoucherDiscountValue(0);
  }

  function handleDiscountChange(type: "none" | "senior" | "pwd") {
    setDiscountType(type);
    if (type === "none") {
      setDiscountIdFile(null);
      setDiscountIdUrl(null);
    }
  }

  // Image upload handlers with compression
  async function handleDiscountIdChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadingDiscountId(true);
      try {
        const compressed = await compressImageFile(file);
        const storageRef = ref(storage, `bookings/${bookingId}/discount-id/${compressed.file.name}`);
        await uploadBytes(storageRef, compressed.file);
        const url = await getDownloadURL(storageRef);
        setDiscountIdUrl(url);
        setDiscountIdFile(file.name);
      } catch (err) {
        console.error("Discount ID upload failed:", err);
        alert("Image upload failed. Please try again.");
      } finally {
        setUploadingDiscountId(false);
      }
    }
  }

  async function handlePaymentProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadingPaymentProof(true);
      try {
        const compressed = await compressImageFile(file);
        const storageRef = ref(storage, `bookings/${bookingId}/payment-proof/${compressed.file.name}`);
        await uploadBytes(storageRef, compressed.file);
        const url = await getDownloadURL(storageRef);
        setPaymentProofUrl(url);
        setPaymentProofFile(file.name);
      } catch (err) {
        console.error("Payment proof upload failed:", err);
        alert("Receipt upload failed. Please try again.");
      } finally {
        setUploadingPaymentProof(false);
      }
    }
  }

  // Confirm booking API request
  async function handleConfirmBooking() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError("");

    try {
      const response = await fetch("/api/bookings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          roomId: selectedRoom?.id,
          checkIn,
          checkOut,
          guests,
          hasBreakfast,
          guestDetails: {
            firstName: guestDetails.firstName,
            lastName: guestDetails.lastName,
            email: guestDetails.email,
            phone: guestDetails.phone,
            requests: guestDetails.requests,
            consent: guestDetails.consent
          },
          discountType: discountType === "none" ? "" : discountType,
          discountIdPhotoUrl: discountIdUrl,
          voucherCode: voucherApplied ? voucherCode : "",
          paymentMethod,
          paymentProofUrl: paymentProofUrl,
          // Per W1.3 / decision #79 / audit S1.5: the standard
          // online booking flow is never corporate. The server
          // derives `isCorporate` only from a validated
          // `corporateCode` lookup, so this field is omitted.
          turnstileToken: turnstileToken || "mock_token",
          _hp: guestDetails._hp || ""
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to confirm booking.");
      }

      // Successful creation, redirect to confirmation page
      const confirmParams = new URLSearchParams({
        bookingRef: result.data.bookingRef,
        roomId: selectedRoom?.id || "",
        checkIn,
        checkOut,
        guests: String(guests),
        paymentMethod,
        total: String(total)
      });
      navigate(`/book/confirm?${confirmParams.toString()}`);
    } catch (err: any) {
      console.error("Confirm booking error:", err);
      if (err.message === "Room no longer available") {
        setSubmitError("Sorry, this room is no longer available for your selected dates. Please go back and choose another room.");
        // Auto redirect to Step 1 after 5 seconds
        setTimeout(() => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("step");
          nextParams.delete("roomId");
          setSearchParams(nextParams);
          setSubmitError("");
          setIsSubmitting(false);
        }, 5000);
      } else {
        setSubmitError(err.message || "An unexpected error occurred. Please try again.");
        setIsSubmitting(false);
      }
    }
  }

  function markTouched(field: GuestField) {
    setTouchedFields((current) => ({
      ...current,
      [field]: true
    }));
  }

  const getBackToPath = () => {
    if (isReviewStep) {
      return `/book?step=guest-details&${continueParams.toString()}`;
    }
    if (isGuestDetailsStep) {
      return `/book?${continueParams.toString()}`;
    }
    return "/rooms";
  };

  const bookingShell = (content: React.ReactNode) => (
    <main className="min-h-screen bg-gray-50 pb-32 font-body text-gray-900">
      <BookingHeader backTo={getBackToPath()} />
      {content}
    </main>
  );

  const isScreenLoading = roomsLoading || settingsLoading;

  if (isScreenLoading) {
    return bookingShell(
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary-light" />
          <p className="text-sm font-semibold text-gray-500">Checking room availability...</p>
        </div>
      </div>
    );
  }

  if (isGuestDetailsStep) {
    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={2} />
          </div>
          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 2 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Guest details</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Add the guest information for this stay. Required fields show inline validation once touched.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <motion.form
            animate="visible"
            className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6"
            initial={shouldReduceMotion ? false : "hidden"}
            variants={staggerContainer}
          >
            <motion.div className="grid gap-5 sm:grid-cols-2" variants={staggerChild}>
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
                label="Email"
                onBlur={() => markTouched("email")}
                onChange={(value) => updateGuestDetail("email", value)}
                placeholder="maria@example.com"
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

            <motion.div className="mt-5 grid gap-5 sm:grid-cols-[220px_1fr]" variants={staggerChild}>
              <TextField
                error={touchedFields.guestCount ? guestErrors.guestCount : ""}
                icon={<Users size={17} />}
                label="Number of guests"
                onBlur={() => markTouched("guestCount")}
                onChange={(value) => updateGuestDetail("guestCount", value)}
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
                    className="min-h-28 w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    onChange={(event) => updateGuestDetail("requests", event.target.value)}
                    placeholder="Late check-in, dietary notes, room preferences..."
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
                  and{" "}
                  <Link className="font-semibold text-primary underline" target="_blank" to="/terms">
                    Terms of Service
                  </Link>{" "}
                  and consent to the collection of my personal data for booking purposes.
                </span>
              </label>
            </motion.div>

            <motion.div className="mt-6 flex gap-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700" variants={staggerChild}>
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
              <p>Your personal details are collected securely in accordance with the Data Privacy Act of 2012.</p>
            </motion.div>
          </motion.form>

          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={Number(guestDetails.guestCount) || guests}
            hasBreakfast={hasBreakfast}
            nights={nights}
            room={selectedRoom}
            typeImageUrls={selectedRoom ? getRoomTypeImages(roomTypes, selectedRoom.type) : []}
            total={total}
            breakfastRate={breakfastRate}
            discountPct={discountPct}
            discountType={discountType}
            voucherDiscount={voucherDiscount}
            voucherApplied={voucherApplied}
            memberDiscountPct={memberDiscountPct}
            isMember={!!memberProfile}
          />
        </section>

        <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-600">Guest details</p>
              <p className="text-lg font-semibold text-gray-950">
                {canContinueToReview ? "Ready for review and payment" : "Complete required fields and consent"}
              </p>
            </div>
            {canContinueToReview ? (
              <PrimaryButton to={`/book?${reviewParams.toString()}`} className="sm:min-w-56">
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

  if (isReviewStep) {
    const isIdUploadRequired = discountType !== "none" && !discountIdUrl;
    const isPaymentProofRequired = paymentMethod !== "pay-at-hotel" && !paymentProofUrl;
    const canConfirm = termsConsent && !isIdUploadRequired && !isPaymentProofRequired && Boolean(selectedRoom);

    // Retrieve active payment method details from hotelConfig
    const activePaymentConfig = hotelConfig?.paymentMethods?.find((p: any) => p.method === paymentMethod);

    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={3} />
          </div>
          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 3 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Review & Pay</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Review your details, select a discount or enter a voucher, and choose your payment method.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <div className="space-y-6">
            {/* Voucher Section */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              <h3 className="text-lg font-semibold text-gray-950">Voucher or Promo Code</h3>
              <p className="mt-1 text-sm text-gray-600">
                Apply a promo code to get discounts on your stay.
              </p>
              
              <form onSubmit={handleApplyVoucher} className="mt-4 flex gap-3">
                <input
                  type="text"
                  placeholder="Enter code"
                  value={voucherCode}
                  onChange={(e) => {
                    setVoucherCode(e.target.value);
                    setVoucherError("");
                  }}
                  disabled={voucherApplied || isValidatingVoucher}
                  className="min-h-11 flex-grow rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-gray-50 disabled:text-gray-500"
                />
                {voucherApplied ? (
                  <button
                    type="button"
                    onClick={handleRemoveVoucher}
                    className="min-h-11 rounded-lg border border-red-200 px-5 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isValidatingVoucher || !voucherCode.trim()}
                    className="min-h-11 rounded-lg border border-primary px-6 text-sm font-semibold text-primary transition hover:bg-primary-light focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  >
                    {isValidatingVoucher ? "Applying..." : "Apply"}
                  </button>
                )}
              </form>
              
              {voucherApplied && (
                <p className="mt-3 text-sm font-medium text-status-green-text flex items-center gap-1.5">
                  <CheckCircle2 size={16} />
                  Promo code {voucherCode.toUpperCase()} applied successfully! ({voucherDiscountType === "percent" ? `${voucherDiscountValue}%` : formatPrice(voucherDiscountValue)} discount)
                </p>
              )}
              {voucherError && (
                <div className="mt-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  <p>{voucherError}</p>
                </div>
              )}
            </div>

            {/* Discount Section */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              <h3 className="text-lg font-semibold text-gray-950">Discount Options</h3>
              <p className="mt-1 text-sm text-gray-600">Select if you are eligible for government-mandated discounts. A valid ID must be uploaded.</p>
              
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {(["none", "senior", "pwd"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleDiscountChange(type)}
                    className={cn(
                      "flex min-h-11 items-center justify-center rounded-lg border text-sm font-semibold transition px-4",
                      discountType === type
                        ? "border-primary bg-primary-light text-primary"
                        : "border-gray-200 bg-white text-gray-700 hover:border-primary"
                    )}
                  >
                    {type === "none" ? "None" : type === "senior" ? "Senior Citizen (20%)" : "PWD (20%)"}
                  </button>
                ))}
              </div>

              {discountType !== "none" && (
                <div className="mt-5">
                  <p className="text-sm font-semibold text-gray-700">
                    {discountType === "senior" ? "Upload OSCA Card Photo" : "Upload PWD ID Card Photo"} <span className="text-red-500">*</span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Please upload a photo of your valid ID card. Our front desk will verify it upon check-in.</p>
                  
                  <div className="mt-3">
                    {discountIdFile ? (
                      <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 bg-gray-50">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={18} className="text-status-green-text" />
                          <span className="text-sm font-medium text-gray-800">{discountIdFile}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDiscountIdFile(null);
                            setDiscountIdUrl(null);
                          }}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center hover:bg-gray-100 transition-colors">
                        <UploadCloud size={28} className="text-gray-400" />
                        <span className="mt-2 text-sm font-semibold text-gray-700">
                          {uploadingDiscountId ? "Uploading ID Card..." : "Click to upload ID photo"}
                        </span>
                        <span className="mt-0.5 text-xs text-gray-500">Supports JPG, PNG, WEBP up to 5MB</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleDiscountIdChange}
                          className="sr-only"
                          disabled={uploadingDiscountId}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Payment Method Section */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              <h3 className="text-lg font-semibold text-gray-950">Payment Method</h3>
              <p className="mt-1 text-sm text-gray-600">Select how you would like to pay for your reservation.</p>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {/* GCash */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("gcash")}
                  className={cn(
                    "flex flex-col items-start p-4 rounded-lg border text-left transition",
                    paymentMethod === "gcash"
                      ? "border-primary bg-primary-light ring-1 ring-primary"
                      : "border-gray-200 bg-white hover:border-primary"
                  )}
                >
                  <Wallet size={20} className={paymentMethod === "gcash" ? "text-primary" : "text-gray-500"} />
                  <span className="mt-3 block text-sm font-bold text-gray-900">Digital Wallet</span>
                  <span className="mt-0.5 block text-xs text-gray-500">GCash or Maya</span>
                </button>

                {/* Bank Transfer */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("bank")}
                  className={cn(
                    "flex flex-col items-start p-4 rounded-lg border text-left transition",
                    paymentMethod === "bank"
                      ? "border-primary bg-primary-light ring-1 ring-primary"
                      : "border-gray-200 bg-white hover:border-primary"
                  )}
                >
                  <Landmark size={20} className={paymentMethod === "bank" ? "text-primary" : "text-gray-500"} />
                  <span className="mt-3 block text-sm font-bold text-gray-900">Bank Transfer</span>
                  <span className="mt-0.5 block text-xs text-gray-500">Direct Deposit</span>
                </button>

                {/* Pay at Hotel */}
                {(!hotelConfig || hotelConfig.payAtHotelEnabled) && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("pay-at-hotel")}
                    className={cn(
                      "flex flex-col items-start p-4 rounded-lg border text-left transition",
                      paymentMethod === "pay-at-hotel"
                        ? "border-primary bg-primary-light ring-1 ring-primary"
                        : "border-gray-200 bg-white hover:border-primary"
                    )}
                  >
                    <CreditCard size={20} className={paymentMethod === "pay-at-hotel" ? "text-primary" : "text-gray-500"} />
                    <span className="mt-3 block text-sm font-bold text-gray-900">Pay at Hotel</span>
                    <span className="mt-0.5 block text-xs text-gray-500">Upon arrival</span>
                  </button>
                )}
              </div>

              {/* Conditional Instructions Panel */}
              <div className="mt-6 rounded-xl border border-primary-light bg-section-bg overflow-hidden">
                {paymentMethod === "gcash" && (
                  <div className="grid sm:grid-cols-5">
                    <div className="sm:col-span-2 min-h-48 overflow-hidden bg-gray-100 flex items-center justify-center p-4">
                      <img
                        src={activePaymentConfig?.qrUrl || "https://lh3.googleusercontent.com/aida-public/AB6AXuCYBsw9jHiKwa9uZlbY7gkxyAiWy9iO8lZGoL0XHN7xvIgaNO7vtr3QzTuUUpa_zti6o6V77lVXpUrBfIxdcwCku-9V2_zJ34vuxteegFyGZ4gCaqLUNSjPW4oFlX7juZojMJzOFBtLH0-TtD5RZlk-kS5FqRBZopVFBvPkfjSRUQofx5VzpEkkdwPiIa0kQXNQw7VhHMmE_HC0DE8lIDCX5aSWJF_3v0N07C1i8nr2Giua6iOdTxTVWNr1aZZhfSvTeu9kbaXNA1xb"}
                        alt="GCash / Maya QR Code"
                        className="h-40 w-40 object-contain rounded"
                      />
                    </div>
                    <div className="sm:col-span-3 p-5 flex flex-col justify-center">
                      <h4 className="font-semibold text-primary text-base">Scan to Pay</h4>
                      <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                        Please use your digital wallet (GCash or Maya) to scan the QR code. Ensure the recipient name is <span className="font-bold text-gray-800">{activePaymentConfig?.accountName || "spark inn Bohol"}</span>.
                      </p>
                      <p className="mt-1 text-xs font-semibold text-gray-800">
                        Number: {activePaymentConfig?.accountNumber || "0917-000-0000"}
                      </p>
                      <ul className="mt-3 space-y-1.5 text-xs text-gray-500">
                        <li className="flex items-center gap-1.5">
                          <Info size={14} className="text-primary" />
                          Your booking is held for 30 minutes.
                        </li>
                        <li className="flex items-center gap-1.5">
                          <ShieldCheck size={14} className="text-primary" />
                          Secure transaction via local digital wallets.
                        </li>
                      </ul>
                    </div>
                  </div>
                )}

                {paymentMethod === "bank" && (
                  <div className="p-5">
                    <h4 className="font-semibold text-primary text-base">Direct Bank Deposit Details</h4>
                    <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-3">
                      <div>
                        <p className="font-bold text-gray-500 uppercase tracking-wide">Bank Name</p>
                        <p className="mt-1 font-semibold text-gray-800 text-sm">{activePaymentConfig?.label || "BPI"}</p>
                      </div>
                      <div>
                        <p className="font-bold text-gray-500 uppercase tracking-wide">Account Name</p>
                        <p className="mt-1 font-semibold text-gray-800 text-sm">{activePaymentConfig?.accountName || "Spark Inn Hotel Corp"}</p>
                      </div>
                      <div>
                        <p className="font-bold text-gray-500 uppercase tracking-wide">Account Number</p>
                        <p className="mt-1 font-semibold text-gray-800 text-sm">{activePaymentConfig?.accountNumber || "1234-5678-90"}</p>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-1.5 text-xs text-gray-500">
                      <li className="flex items-center gap-1.5">
                        <Info size={14} className="text-primary" />
                        Please complete transfer within 30 minutes to hold room.
                      </li>
                    </ul>
                  </div>
                )}

                {paymentMethod === "pay-at-hotel" && (
                  <div className="p-5 flex items-start gap-3">
                    <Info size={20} className="text-primary shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-primary text-base">Pay upon Check-in</h4>
                      <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                        Present your booking reference at the front desk upon arrival. We accept cash, major credit cards, and digital wallet payments.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Proof of Payment Upload box */}
              {paymentMethod !== "pay-at-hotel" && (
                <div className="mt-5">
                  <p className="text-sm font-semibold text-gray-700">
                    Upload Proof of Payment <span className="text-red-500">*</span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Upload a screenshot or photo of your successful digital wallet payment or bank transfer receipt.</p>
                  
                  <div className="mt-3">
                    {paymentProofFile ? (
                      <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 bg-gray-50">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={18} className="text-status-green-text" />
                          <span className="text-sm font-medium text-gray-800">{paymentProofFile}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentProofFile(null);
                            setPaymentProofUrl(null);
                          }}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center hover:bg-gray-100 transition-colors">
                        <UploadCloud size={28} className="text-gray-400" />
                        <span className="mt-2 text-sm font-semibold text-gray-700">
                          {uploadingPaymentProof ? "Uploading Receipt..." : "Click to upload receipt photo"}
                        </span>
                        <span className="mt-0.5 text-xs text-gray-500">Supports JPEG, PNG, WEBP up to 5MB</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePaymentProofChange}
                          className="sr-only"
                          disabled={uploadingPaymentProof}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Honeypot field (hidden from user) */}
            <input
              type="text"
              name="_hp"
              value={guestDetails._hp || ""}
              onChange={(e) => updateGuestDetail("_hp", e.target.value)}
              className="absolute opacity-0 pointer-events-none"
              tabIndex={-1}
              autoComplete="off"
            />

            {/* Cancellation Policy */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              <details className="group">
                <summary className="flex cursor-pointer items-center justify-between font-semibold text-gray-950 list-none">
                  <span>Cancellation Policy</span>
                  <span className="transition group-open:rotate-180">
                    <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </summary>
                <div className="mt-3 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                  {websiteContent?.cancellationPolicy || "Cancellations made 48 hours or more before check-in are eligible for a full refund. Cancellations within 48 hours of check-in are non-refundable. No-shows will be charged the full booking amount."}
                </div>
              </details>
            </div>

            {/* Terms and conditions */}
            <div className="mt-6">
              <label className="flex items-start gap-3 cursor-pointer text-sm leading-6 text-gray-700">
                <input
                  type="checkbox"
                  checked={termsConsent}
                  onChange={(e) => setTermsConsent(e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span>
                  I have read and agree to {config.brandName}'s{" "}
                  <Link to="/privacy" target="_blank" className="font-semibold text-primary underline">
                    Privacy Policy
                  </Link>{" "}
                  and{" "}
                  <Link to="/terms" target="_blank" className="font-semibold text-primary underline">
                    Terms of Service
                  </Link>
                  . I understand that my booking is subject to the cancellation policy selected.
                </span>
              </label>
            </div>

            {/* Cloudflare Turnstile Challenge */}
            <div
              className="cf-turnstile mt-6 flex justify-center"
              data-sitekey={import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA"}
              data-callback="onTurnstileSuccess"
            ></div>

            {submitError && (
              <div className="flex gap-2 rounded-lg bg-red-50 p-4 text-sm font-medium text-red-700">
                <Info size={16} className="mt-0.5 shrink-0" />
                <p>{submitError}</p>
              </div>
            )}
          </div>

          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={guests}
            hasBreakfast={hasBreakfast}
            nights={nights}
            room={selectedRoom}
            typeImageUrls={selectedRoom ? getRoomTypeImages(roomTypes, selectedRoom.type) : []}
            total={total}
            discountPct={discountPct}
            voucherDiscount={voucherDiscount}
            discountType={discountType}
            voucherApplied={voucherApplied}
            memberDiscountPct={memberDiscountPct}
            isMember={!!memberProfile}
          />
        </section>

        <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-600">Review & Pay</p>
              <p className="text-lg font-semibold text-gray-950">
                {isSubmitting
                  ? "Processing booking request..."
                  : uploadingDiscountId
                  ? "Uploading discount ID photo..."
                  : uploadingPaymentProof
                  ? "Uploading payment proof receipt..."
                  : !termsConsent
                  ? "Agree to terms and conditions"
                  : isIdUploadRequired
                  ? "Please upload your Senior/PWD ID"
                  : isPaymentProofRequired
                  ? "Please upload proof of payment"
                  : "Ready to confirm booking"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleConfirmBooking}
              disabled={!canConfirm || isSubmitting || uploadingDiscountId || uploadingPaymentProof}
              className="flex min-h-11 items-center justify-center rounded-lg bg-primary text-white font-semibold px-6 hover:bg-primary-dark transition disabled:bg-gray-300 disabled:text-gray-500 sm:min-w-56"
            >
              {isSubmitting ? "Processing..." : "Confirm Booking"}
            </button>
          </div>
        </div>
      </>
    );
  }

  return bookingShell(
    <>
      <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <StepIndicator steps={steps} currentStep={1} />
        </div>
        <div className="mt-10 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 1 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Select your stay</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Choose dates, guests, and a room option. This is static wireframe data shaped for the future booking context.
            </p>
          </div>
          <div className="rounded-card bg-white p-4 text-sm shadow-sm ring-1 ring-gray-200">
            <p className="font-semibold text-gray-950">{formatStayDate(checkIn)} - {formatStayDate(checkOut)}</p>
            <p className="mt-1 text-gray-600">
              {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[320px_1fr] lg:px-8">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-lg font-semibold text-gray-950">Stay details</h2>
            <div className="mt-5 space-y-6">
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
                    <Minus size={16} />
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
                    <Plus size={16} />
                  </button>
                </div>
              </label>

              <div>
                <p className="text-sm font-medium text-gray-700">Room type</p>
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

              <div className="flex gap-3 rounded-lg bg-primary-light p-4 text-sm text-gray-700">
                <Info size={18} className="mt-0.5 shrink-0 text-primary" />
                <p>Prices are based on selected dates. Breakfast is a static add-on for this wireframe pass.</p>
              </div>
            </div>
          </div>
        </aside>

        <div>
          <div className="mb-5 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <p className="font-semibold text-gray-950">{availableRooms.length} available rooms</p>
            <p className="text-sm text-gray-600">Select Room Only or Room + Breakfast to lock the Step 1 summary.</p>
          </div>

          {availableRooms.length > 0 ? (
            <motion.div
              animate="visible"
              className="grid gap-6"
              initial={shouldReduceMotion ? false : "hidden"}
              variants={staggerContainer}
            >
              {availableRooms.map((room, index) => {
                const isSelected = room.id === selectedRoom?.id;
                const roomOnlyTotal = calculateBookingTotal({
                  ratePerNight: room.pricePerNight,
                  numNights: nights
                });
                const breakfastTotal = calculateBookingTotal({
                  ratePerNight: room.pricePerNight,
                  numNights: nights,
                  numGuests: guests,
                  breakfastRate: breakfastRatePerPerson,
                  hasBreakfast: true
                });
                const typeLabel = DEFAULT_ROOM_TYPES.find((type) => type.value === room.type)?.label ?? room.type;

                return (
                  <motion.article
                    key={room.id}
                    className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200"
                    variants={staggerChild}
                    whileHover={shouldReduceMotion ? undefined : { y: -4 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <div className="grid md:grid-cols-[280px_1fr]">
                      <div className="relative min-h-64 overflow-hidden bg-section-bg">
                        <img src={getRoomTypeImages(roomTypes, room.type)[0]} alt={room.name} className="h-full w-full object-cover" />
                        {index === 0 ? (
                          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary shadow-sm">
                            Recommended
                          </span>
                        ) : null}
                      </div>
                      <div className="p-5 sm:p-6">
                        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                          <div>
                            <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
                              {typeLabel}
                            </span>
                            <h2 className="mt-3 text-2xl font-semibold text-gray-950">{room.name}</h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-gray-600">{room.description}</p>
                          </div>
                          <div className="sm:text-right">
                            <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
                            <p className="text-2xl font-semibold text-gray-950">{formatPrice(room.pricePerNight)}</p>
                            <p className="text-sm text-gray-500">per night</p>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-2">
                            <BedDouble size={16} className="text-primary" />
                            {room.bedDefinition}
                          </span>
                          <span className="flex items-center gap-2">
                            <Users size={16} className="text-primary" />
                            Up to {room.maxCapacity}
                          </span>
                          <span className="flex items-center gap-2">
                            <CalendarDays size={16} className="text-primary" />
                            {nights} {nights === 1 ? "night" : "nights"}
                          </span>
                        </div>

                        <div className="mt-6 grid gap-3">
                          <RateOption
                            active={isSelected && rateChoice === "room-only"}
                            label="Room Only"
                            helper="Simple stay, flexible payment at the hotel"
                            priceLabel={`${formatPrice(room.pricePerNight)} / night`}
                            totalLabel={`${formatPrice(roomOnlyTotal)} total`}
                            onSelect={() => selectRoom(room.id, "room-only")}
                          />
                          {breakfastEnabled ? (
                            <RateOption
                              active={isSelected && rateChoice === "room-breakfast"}
                              label="Room + Breakfast"
                              helper="Includes daily local breakfast for selected guests"
                              priceLabel={`${formatPrice(room.pricePerNight + breakfastRatePerPerson * guests)} / night`}
                              totalLabel={`${formatPrice(breakfastTotal)} total`}
                              onSelect={() => selectRoom(room.id, "room-breakfast")}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
          ) : (
            <div className="rounded-card bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
              <h2 className="text-xl font-semibold text-gray-950">No available rooms match this stay</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
                Try fewer guests or choose all room types to continue the wireframe flow.
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-gray-600">
              Total for {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
            </p>
            <p className="text-2xl font-semibold text-gray-950">
              {formatPrice(total)} <span className="text-sm font-normal text-gray-500">including selected options</span>
            </p>
          </div>
          <PrimaryButton to={`/book?${continueParams.toString()}`} className="sm:min-w-56">
            Continue to Step 2
          </PrimaryButton>
        </div>
      </div>
    </>
  );
}

function BookingHeader({ backTo }: { backTo: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 px-4 py-4 shadow-sm backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link
          aria-label="Back"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          to={backTo}
        >
          <ArrowLeft size={20} />
        </Link>
        <Link to="/" aria-label={config.brandName} className="flex items-center justify-center">
          <img src={`/brand/${config.logos.navbar}`} alt={config.brandName} className="h-10 w-auto" />
        </Link>
        <span className="min-h-11 min-w-11" />
      </div>
    </header>
  );
}

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

interface BookingReviewAsideProps {
  checkIn: string;
  checkOut: string;
  guests: number;
  hasBreakfast: boolean;
  nights: number;
  room: Room | undefined;
  typeImageUrls?: string[];
  total: number;
  discountPct?: number;
  voucherDiscount?: number;
  discountType?: "none" | "senior" | "pwd";
  voucherApplied?: boolean;
  breakfastRate?: number;
  memberDiscountPct?: number;
  isMember?: boolean;
}

function BookingReviewAside({
  checkIn,
  checkOut,
  guests,
  hasBreakfast,
  nights,
  room,
  typeImageUrls = [],
  total,
  discountPct = 0,
  voucherDiscount = 0,
  discountType = "none",
  voucherApplied = false,
  breakfastRate,
  memberDiscountPct = 0,
  isMember = false
}: BookingReviewAsideProps) {
  if (!room) return null;

  const roomTotal = useMemo(() => {
    let totalRate = 0;
    const start = new Date(`${checkIn}T00:00:00Z`);
    for (let i = 0; i < nights; i++) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + i);
      const day = date.getUTCDay(); // 0 = Sun, 6 = Sat
      const isWeekend = day === 0 || day === 6;
      if (isWeekend && room.weekendRate) {
        totalRate += room.weekendRate;
      } else {
        totalRate += room.pricePerNight;
      }
    }
    return totalRate;
  }, [room, checkIn, nights]);

  const activeBreakfastRate = breakfastRate ?? 350;
  const breakfastTotal = hasBreakfast ? activeBreakfastRate * guests * nights : 0;
  const subtotal = roomTotal + breakfastTotal;
  const discountAmount = subtotal * (discountPct / 100);
  const afterSeniorPwd = subtotal - discountAmount;
  const afterVoucher = afterSeniorPwd - voucherDiscount;
  const memberDiscountAmount = afterVoucher * (memberDiscountPct / 100);

  return (
    <aside className="lg:sticky lg:top-28 lg:self-start">
      <div className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
        <img src={typeImageUrls[0]} alt={room.name} className="h-52 w-full object-cover" />
        <div className="p-5">
          <h2 className="text-xl font-semibold text-gray-950">{room.name}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{room.description}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 border-y border-gray-200 py-4 text-sm">
            <SummaryCell label="Check-in" value={formatStayDate(checkIn)} />
            <SummaryCell alignEnd label="Check-out" value={formatStayDate(checkOut)} />
            <SummaryCell label="Guests" value={`${guests} ${guests === 1 ? "guest" : "guests"}`} />
            <SummaryCell alignEnd label="Duration" value={`${nights} ${nights === 1 ? "night" : "nights"}`} />
          </div>
          <div className="mt-5 space-y-3 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Room rate</span>
              <span>{formatPrice(roomTotal)}</span>
            </div>
            {hasBreakfast ? (
              <div className="flex justify-between">
                <span>Breakfast add-on</span>
                <span>{formatPrice(breakfastTotal)}</span>
              </div>
            ) : null}
            {discountPct > 0 ? (
              <div className="flex justify-between text-status-green-text bg-status-green-bg px-2 py-1 rounded">
                <span>{discountType === "senior" ? "Senior Citizen" : "PWD"} Discount (20%)</span>
                <span>-{formatPrice(discountAmount)}</span>
              </div>
            ) : null}
            {voucherApplied ? (
              <div className="flex justify-between text-status-green-text bg-status-green-bg px-2 py-1 rounded">
                <span>Voucher Discount</span>
                <span>-{formatPrice(voucherDiscount)}</span>
              </div>
            ) : null}
            {isMember && memberDiscountPct > 0 ? (
              <div className="flex justify-between text-status-green-text bg-status-green-bg px-2 py-1 rounded">
                <span className="flex items-center gap-1.5">
                  <Sparkles size={12} />
                  Spark Rewards Member Rate ({memberDiscountPct}%)
                </span>
                <span>-{formatPrice(memberDiscountAmount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-dashed border-gray-200 pt-3 text-lg font-semibold text-gray-950">
              <span>Total</span>
              <span className="text-primary">{formatPrice(total)}</span>
            </div>
          </div>
          <div className="mt-5 flex gap-3 rounded-lg bg-primary-light p-4 text-sm text-gray-700">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
            <p>Best rate guarantee. No hidden booking fees for direct reservations.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SummaryCell({ alignEnd, label, value }: { alignEnd?: boolean; label: string; value: string }) {
  return (
    <div className={alignEnd ? "text-right" : undefined}>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 font-medium text-gray-950">{value}</p>
    </div>
  );
}

interface RateOptionProps {
  active: boolean;
  label: string;
  helper: string;
  priceLabel: string;
  totalLabel: string;
  onSelect: () => void;
}

function RateOption({ active, label, helper, priceLabel, totalLabel, onSelect }: RateOptionProps) {
  return (
    <button
      className={cn(
        "flex min-h-20 w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition",
        active ? "border-primary bg-primary-light ring-1 ring-primary" : "border-gray-200 bg-white hover:border-primary"
      )}
      type="button"
      onClick={onSelect}
    >
      <span className="flex gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            active ? "border-primary bg-primary text-white" : "border-gray-300"
          )}
        >
          {active ? <Check size={13} /> : null}
        </span>
        <span>
          <span className="block text-sm font-semibold text-gray-950">{label}</span>
          <span className="mt-1 block text-sm text-gray-600">{helper}</span>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold text-gray-950">{priceLabel}</span>
        <span className="mt-1 block text-xs text-gray-500">{totalLabel}</span>
      </span>
    </button>
  );
}
