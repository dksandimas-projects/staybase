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
  compressImageFile,
  getDateKeyInTimezone,
  getNumNights,
  staggerChild,
  staggerContainer,
  VERSION
} from "@spark-inn/shared";
import { collection, doc, getDoc, getFirestore } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase/config";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { StepIndicator } from "../components/StepIndicator";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, getRoomTypeRates, useRoomTypes } from "../hooks/useRoomTypes";
import { useTurnstileToken } from "../hooks/useTurnstileToken";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
const steps = ["Select Room", "Guest Details", "Review & Pay", "Confirmation"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  const [bookingId] = useState(() => doc(collection(getFirestore(), "bookings")).id);

  // Per BI-01 (booking-intercom audit 2026-07-06): two REAL
  // Turnstile challenges. The gate widget covers
  // /api/validate/corporate-code; the review widget covers
  // /api/bookings/create. Previously the gate hardcoded
  // `"mock_token"` and the create body sent no token at all, so
  // corporate bookings were rejected outside NODE_ENV=test (the
  // Step 3 "Connection Verified" panel was a hardcoded fake).
  const gateTurnstile = useTurnstileToken({ enabled: currentStepKey === "gate" });
  const reviewTurnstile = useTurnstileToken({ enabled: currentStepKey === "review" });

  // Corporate validation state (persisted in sessionStorage)
  const [accessCode, setAccessCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [isValidating, setIsValidating] = useState(false);

  const [companyName, setCompanyName] = useState(() => sessionStorage.getItem("corp_companyName") ?? "");
  const [activeCode, setActiveCode] = useState(() => sessionStorage.getItem("corp_code") ?? "");
  const [, setDiscountPercent] = useState(() => Number(sessionStorage.getItem("corp_discount") ?? "0"));
  const [isFlatRate, setIsFlatRate] = useState(() => sessionStorage.getItem("corp_isFlatRate") === "true");
  // Per audit S4.1 / decision #101: store the negotiated
  // ratePerRoomType map returned by /api/validate/corporate-code so
  // the client picks the negotiated rate for the chosen room type
  // (not the flat `room.corporateRate` fallback).
  const [ratePerRoomType, setRatePerRoomType] = useState<Record<string, number>>(() => {
    try {
      const stored = sessionStorage.getItem("corp_ratePerRoomType");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Booking states
  const [checkIn, setCheckIn] = useState(searchParams.get("checkIn") ?? getDateKeyInTimezone(config.timezone, 1));
  const [checkOut, setCheckOut] = useState(searchParams.get("checkOut") ?? getDateKeyInTimezone(config.timezone, 2));
  const [guests, setGuests] = useState(Number(searchParams.get("guests") ?? 2));
  // Per the room-type booking refactor: Step 1 now shows one card
  // per room type (not per physical room). The guest picks a type;
  // the server auto-assigns a physical room of that type inside
  // the availability transaction.
  const [selectedRoomType, setSelectedRoomType] = useState(searchParams.get("roomType") ?? "");
  const [rateChoice, setRateChoice] = useState<RateChoice>(
    searchParams.get("breakfast") === "yes" ? "room-breakfast" : "room-only"
  );

  // Breakfast config fetched from Firestore
  const [breakfastConfig, setBreakfastConfig] = useState({ isEnabled: false, ratePerPersonPerNight: 250 });

  // Per W4.7 — PII-stripped booked date ranges for the requested
  // window. Mirrors the public booking page so the corporate flow
  // can show "X of Y available for your dates" per type.
  const [bookedRanges, setBookedRanges] = useState<
    Array<{ roomId: string; checkIn: string; checkOut: string; status: string }>
  >([]);

  // Live rooms from Firestore
  const { rooms, loading: roomsLoading } = useRooms();
  const { roomTypes } = useRoomTypes();

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
  // Per BI-05 (booking-intercom audit 2026-07-06): the personal-pay
  // receipt is a real Storage upload under the preallocated booking
  // ID (same pattern as BookingPage). The previous `billingFile`
  // state stored only the picked file's *name* — nothing was ever
  // uploaded, no `paymentProofUrl` was sent, and the booking was
  // recorded as `pay-at-hotel` with no trace of the transfer.
  const [proofUpload, setProofUpload] = useState<{ name: string; url: string } | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("gcash");
  const [termsConsent, setTermsConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Per `plan/features/SETTINGS.md §Payment Methods` — the booking
  // payment list is dynamic. Sourced from
  // `settings/hotelConfig.paymentMethods[]` and filtered to the
  // admin-enabled subset. The corporate page only shows the GCash
  // and Bank Transfer options; the admin can configure their
  // account details from Settings → Payment Methods.
  //
  // Per #111 (per-method surface toggles): each entry also
  // carries a `showInCorporate` flag. Methods where the flag is
  // explicitly `false` are filtered out of the corporate
  // personal-pay selector. The flag defaults to `true` when
  // missing (pre-#111 entries are treated as "visible on all
  // surfaces"), so no migration is required.
  const [paymentMethodsConfig, setPaymentMethodsConfig] = useState<
    Array<{
      method: string;
      label: string;
      accountName: string;
      accountNumber: string;
      qrUrl: string;
      isEnabled: boolean;
      showInCorporate?: boolean;
    }>
  >([]);
  useEffect(() => {
    const db = getFirestore();
    getDoc(doc(db, "settings", "hotelConfig"))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as { paymentMethods?: unknown } | undefined;
        if (Array.isArray(d?.paymentMethods)) {
          setPaymentMethodsConfig(d!.paymentMethods as any);
        }
      })
      .catch(() => undefined);
  }, []);

  // Personal-pay selector source — enabled + corporate-visible
  // online methods only. Hoisted from the Step 3 JSX so the
  // stale-selection fallback below can reuse it.
  const corporatePaymentMethods = useMemo(
    () =>
      paymentMethodsConfig.filter(
        (pm) =>
          pm.isEnabled &&
          pm.showInCorporate !== false &&
          (pm.method === "gcash" || pm.method === "maya" || pm.method === "bank")
      ),
    [paymentMethodsConfig]
  );

  // Per BI-05: the default selection is "gcash", which may be
  // disabled (or hidden from the corporate surface) in Settings.
  // Fall back to the first available method so the submitted
  // `paymentMethod` always matches a method the guest could see.
  useEffect(() => {
    if (corporatePaymentMethods.length === 0) return;
    if (corporatePaymentMethods.some((pm) => pm.method === paymentMethod)) return;
    setPaymentMethod(corporatePaymentMethods[0].method);
  }, [corporatePaymentMethods, paymentMethod]);

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

  // Per the room-type booking refactor: Step 1 shows one card
  // per room type. The corporate flow was previously date-blind
  // (no `bookedRanges` query) — bring it to parity with the public
  // booking page so the "X of Y available" copy is accurate.
  useEffect(() => {
    let cancelled = false;
    async function fetchAvailability() {
      try {
        const params = new URLSearchParams({ checkIn, checkOut });
        const response = await fetch(`/api/rooms/availability?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Availability request failed: ${response.status}`);
        }
        const json = await response.json();
        if (cancelled) return;
        if (json?.success && Array.isArray(json.data?.bookedRanges)) {
          setBookedRanges(json.data.bookedRanges);
        } else {
          setBookedRanges([]);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Corporate room availability fetch error:", err);
        setBookedRanges([]);
      }
    }
    fetchAvailability();
    return () => {
      cancelled = true;
    };
  }, [checkIn, checkOut]);

  const nights = Math.max(getNumNights(checkIn, checkOut), 1);

  // Per the room-type booking refactor: Step 1 shows one card
  // per room type. For each type, count the candidate physical
  // rooms (active, capacity-ok) and subtract the ones with an
  // overlapping active booking.
  const typeAvailability = useMemo(() => {
    const reqStart = new Date(`${checkIn}T00:00:00Z`);
    const reqEnd = new Date(`${checkOut}T00:00:00Z`);
    const isRoomBlockedForStay = (room: { status: string; blockedFrom?: string | Date | null; blockedTo?: string | Date | null }) => {
      if (room.status !== "blocked") return false;
      if (!room.blockedFrom || !room.blockedTo) return true;
      const blockedFrom = new Date(`${String(room.blockedFrom).split("T")[0]}T00:00:00Z`);
      const blockedTo = new Date(`${String(room.blockedTo).split("T")[0]}T00:00:00Z`);
      if (isNaN(blockedFrom.getTime()) || isNaN(blockedTo.getTime())) return true;
      return blockedFrom < reqEnd && blockedTo > reqStart;
    };

    return roomTypes.map((type) => {
      const candidates = rooms.filter(
        (room) => room.type === type.value && room.isActive && !isRoomBlockedForStay(room)
      );
      const bookedRoomIds = new Set(
        bookedRanges
          .filter((range) => {
            const bStart = new Date(`${range.checkIn}T00:00:00Z`);
            const bEnd = new Date(`${range.checkOut}T00:00:00Z`);
            return bStart < reqEnd && bEnd > reqStart;
          })
          .map((range) => range.roomId)
      );
      const availableCount = candidates.filter((room) => !bookedRoomIds.has(room.id)).length;
      return {
        type,
        totalCount: candidates.length,
        availableCount
      };
    });
  }, [rooms, roomTypes, bookedRanges, checkIn, checkOut]);

  const availableRoomTypes = useMemo(
    () =>
      typeAvailability.filter(
        (entry) => entry.type.maxCapacity >= guests && entry.availableCount > 0
      ),
    [typeAvailability, guests]
  );
  const maxGuestCapacity = useMemo(
    () => Math.max(1, ...roomTypes.map((type) => Number(type.maxCapacity) || 0)),
    [roomTypes]
  );

  const selectedTypeEntry = roomTypes.find((type) => type.value === selectedRoomType)
    ?? availableRoomTypes[0]?.type
    ?? null;
  // Per W3.6 — pricing + max occupancy live on the room's type.
  const selectedRoomRates = selectedTypeEntry ? getRoomTypeRates(roomTypes, selectedTypeEntry.value) : null;
  const selectedMaxCapacity = selectedRoomRates?.maxCapacity ?? 0;
  const hasBreakfast = breakfastConfig.isEnabled && rateChoice === "room-breakfast";
  const breakfastRatePerPerson = breakfastConfig.ratePerPersonPerNight;

  // Calculate pricing
  // Per audit S4.1 / decision #101: prefer the negotiated rate for
  // the chosen room type from the corporateCodes/{code} doc. Fall
  // back to the type's flat corporateRate only when the negotiated
  // map has no entry for this room type.
  // Per BI-04 + CORPORATE-BOOKING.md edge case: a missing/zero
  // `corporateRate` falls back to the standard nightly rate —
  // never show (or charge) ₱0. Mirrors the server-side fallback
  // in handleCreateBooking.
  const negotiatedRate = selectedTypeEntry && ratePerRoomType && ratePerRoomType[selectedTypeEntry.value] !== undefined
    ? ratePerRoomType[selectedTypeEntry.value]
    : (selectedRoomRates?.corporateRate || selectedRoomRates?.pricePerNight || 0);
  const baseRate = negotiatedRate;
  const ratePerNight = baseRate;

  const roomTotal = ratePerNight * nights;
  const breakfastTotal = hasBreakfast ? breakfastRatePerPerson * guests * nights : 0;
  const subtotal = roomTotal + breakfastTotal;

  // Calculate total
  // Per BF-08 (booking-flow audit 2026-06-26): pass the
  // pre-computed roomTotal so the calc matches the server's
  // `totalPrice`. Corporate bookings don't apply weekend
  // rates (server's `!isCorporate` guard on the weekend
  // branch), so the flat `ratePerNight * nights` is correct
  // here. Passing it explicitly keeps the calculation in
  // lockstep with the server.
  const total = calculateBookingTotal({
    ratePerNight,
    numNights: nights,
    roomTotal,
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
      Number(guestDetails.guestCount) >= 1 && selectedMaxCapacity > 0 && Number(guestDetails.guestCount) <= selectedMaxCapacity
        ? ""
        : `Guest count must be between 1 and ${selectedMaxCapacity || guests}.`,
    designation: guestDetails.designation.trim() ? "" : "Designation is required.",
    companyAddress: guestDetails.companyAddress.trim() ? "" : "Company address is required."
  };

  const canContinueToReview =
    Object.values(guestErrors).every((error) => !error) &&
    guestDetails.consent &&
    Boolean(selectedTypeEntry) &&
    (isFlatRate ? guestDetails.companyName.trim().length > 0 : true);

  // State transitions
  function updateDateParams(nextCheckIn = checkIn, nextCheckOut = checkOut, nextGuests = guests) {
    const next = new URLSearchParams(searchParams);
    next.set("checkIn", nextCheckIn);
    next.set("checkOut", nextCheckOut);
    next.set("guests", String(nextGuests));
    if (selectedRoomType) next.set("roomType", selectedRoomType);
    setSearchParams(next, { replace: true });
  }

  function updateGuests(nextGuests: number) {
    const safeGuests = Math.min(Math.max(nextGuests, 1), maxGuestCapacity);
    setGuests(safeGuests);
    updateDateParams(checkIn, checkOut, safeGuests);
  }

  function selectRoomType(typeValue: string, nextRateChoice: RateChoice) {
    setSelectedRoomType(typeValue);
    setRateChoice(nextRateChoice);
    const next = new URLSearchParams(searchParams);
    next.set("roomType", typeValue);
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

    // Per BI-01: the endpoint is Turnstile-gated for real now.
    // The widget on this gate auto-resolves for most visitors;
    // if the token hasn't arrived yet, ask for a retry instead
    // of burning a request that will 400.
    if (!gateTurnstile.token) {
      setCodeError("The security check hasn't finished yet. Please wait a moment and try again.");
      return;
    }

    setIsValidating(true);

    try {
      const code = accessCode.trim().toUpperCase();
      const response = await fetch("/api/validate/corporate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, turnstileToken: gateTurnstile.token })
      });
      const result = await response.json();

      if (result.success && result.data) {
        setCompanyName(result.data.companyName);
        setActiveCode(result.data.code);
        setDiscountPercent(0);
        setIsFlatRate(false);
        // Per audit S4.1 / decision #101: capture the negotiated
        // ratePerRoomType map returned by the server. Each room
        // type has its own negotiated rate; falling back to the
        // flat `room.corporateRate` only happens when the map has
        // no entry for the chosen room type.
        const nextRatePerRoomType = result.data.ratePerRoomType || {};
        setRatePerRoomType(nextRatePerRoomType);
        sessionStorage.setItem("corp_companyName", result.data.companyName);
        sessionStorage.setItem("corp_code", result.data.code);
        sessionStorage.setItem("corp_discount", "0");
        sessionStorage.setItem("corp_isFlatRate", "false");
        sessionStorage.setItem("corp_ratePerRoomType", JSON.stringify(nextRatePerRoomType));
      } else {
        setCodeError(result.error || corporateCodeMessages.invalid);
      }
    } catch {
      setCodeError("Unable to validate code. Please check your connection and try again.");
    } finally {
      // Turnstile tokens are single-use — siteverify consumed this
      // one whatever the outcome. Reset so a retry (or a second
      // code attempt) mints a fresh token.
      gateTurnstile.reset();
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
    setRatePerRoomType({});
    setAccessCode("");
    sessionStorage.removeItem("corp_companyName");
    sessionStorage.removeItem("corp_code");
    sessionStorage.removeItem("corp_discount");
    sessionStorage.removeItem("corp_isFlatRate");
    sessionStorage.removeItem("corp_ratePerRoomType");
  }

  // Per BI-05: compress + upload the receipt to the preallocated
  // booking path (staff-read / public-write per storage.rules),
  // exactly like the standard booking flow's payment proof.
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!ACCEPTED_UPLOAD_TYPES.has(file.type)) {
        setSubmitError("Please upload a JPG, PNG, or WEBP image.");
        e.target.value = "";
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setSubmitError("Please upload an image that is 5MB or smaller.");
        e.target.value = "";
        return;
      }
      setUploadingProof(true);
      setSubmitError("");
      try {
        const compressed = await compressImageFile(file);
        const storageRef = ref(storage, `bookings/${bookingId}/payment-proof/${compressed.file.name}`);
        await uploadBytes(storageRef, compressed.file);
        const url = await getDownloadURL(storageRef);
        setProofUpload({ name: file.name, url });
      } catch (err) {
        console.error("Corporate payment proof upload failed:", err);
        alert("Receipt upload failed. Please try again.");
      } finally {
        setUploadingProof(false);
      }
    }
  }

  // Step transitions
  const continueParams = new URLSearchParams({
    step: "guest-details",
    checkIn,
    checkOut,
    guests: String(guests),
    roomType: selectedTypeEntry?.value ?? "",
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
      return `/corporate/book?${continueParams.toString()}`;
    }
    if (currentStepKey === "guest-details") {
      const selectRoomParams = new URLSearchParams(continueParams);
      selectRoomParams.set("step", "select-room");
      return `/corporate/book?${selectRoomParams.toString()}`;
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
      const isPersonalPay = guestDetails.billingArrangement === "personal";
      const body = {
        bookingId,
        roomType: selectedTypeEntry?.value ?? "",
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
        // Per BI-05: personal pay submits the method the guest
        // actually paid with plus the uploaded receipt URL, so the
        // booking lands as `payment-uploaded` and staff can verify
        // the transfer. Chargeback stays `pay-at-hotel` (settled
        // via LOU per decision #99).
        paymentMethod: isPersonalPay ? paymentMethod : "pay-at-hotel",
        paymentProofUrl: isPersonalPay ? proofUpload?.url ?? null : null,
        // Per W1.3 / decision #79 / audit S1.5: the server
        // derives `isCorporate` from the validated `corporateCode`
        // lookup. The client no longer sets it. The booking body's
        // companyName is also overridden by the doc's companyName
        // server-side.
        corporateCode: activeCode || undefined,
        // Per BI-04: the "Continue without code" path — the server
        // resolves the flat corporate rate from its own
        // roomTypes[].corporateRate and flags the booking corporate.
        corporateFlatRate: isFlatRate && !activeCode,
        // Per BI-01: real Turnstile token from the review-step widget.
        turnstileToken: reviewTurnstile.token,
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
        // Per BF-39 (booking-flow audit 2026-06-26): prefer the
        // server-returned `totalPrice` so the confirmation
        // matches what was actually charged. Fall back to the
        // local `total` only if the server response is missing
        // the field.
        const serverTotal = typeof result.data?.totalPrice === "number"
          ? result.data.totalPrice
          : null;
        const params = new URLSearchParams({
          step: "confirm",
          bookingRef: result.data.bookingRef,
          roomType: result.data.roomType || selectedTypeEntry?.value || "",
          roomId: result.data.roomId || "",
          roomNumber: result.data.roomNumber || "",
          checkIn,
          checkOut,
          guests: String(guests),
          companyName: guestDetails.companyName,
          billingArrangement: guestDetails.billingArrangement,
          total: String(serverTotal ?? total),
        });
        setSearchParams(params);
      } else {
        const errorMessage = result.error || "Booking submission failed. Please try again.";
        setSubmitError(errorMessage);
        // Tokens are single-use; mint a fresh one for the retry.
        reviewTurnstile.reset();
        setIsSubmitting(false);

        if (errorMessage.startsWith("Corporate code no longer valid")) {
          handleClearValidation();
          setCodeError(errorMessage);
          const next = new URLSearchParams(searchParams);
          next.delete("step");
          next.delete("roomType");
          setSelectedRoomType("");
          setSearchParams(next);
          return;
        }

        if (errorMessage === "Room no longer available") {
          setSubmitError("Sorry, no rooms of this type are available for your selected dates. Please go back and pick another room type.");
          setTimeout(() => {
            const next = new URLSearchParams(searchParams);
            next.set("step", "select-room");
            next.delete("roomType");
            setSelectedRoomType("");
            setSearchParams(next);
            setSubmitError("");
          }, 5000);
        }
      }
    } catch {
      setSubmitError("Unable to submit booking. Please check your connection and try again.");
      reviewTurnstile.reset();
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
          <div className="min-h-11 min-w-11" />
        </div>
        
        {/* Persistent corporate rate badge — per W2.13 / decision #101 */}
        {(companyName || isFlatRate) && currentStepKey !== "confirm" && (
          <div className="bg-primary/10 border-t border-primary/20 text-center py-1.5 text-xs text-primary font-medium">
            Active Negotiated Pricing: <span className="font-bold underline">{companyName || "Flat Corporate Rate"}</span>
            {activeCode && " — Negotiated rate applied"}
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
                        Code {activeCode} verified. Negotiated rate applied.
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

                {/* Per BI-01: real Turnstile challenge gating
                    /api/validate/corporate-code. */}
                <div ref={gateTurnstile.containerRef} className="flex justify-center" />

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
              </div>
            </div>
          </aside>

          {/* Right panel rooms selection list — per the room-type booking
              refactor, one card per room type. The server auto-assigns
              a physical room of the chosen type at booking creation. */}
          <div>
            <div className="mb-5 flex flex-col gap-3 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-gray-950">
                  {roomsLoading ? "Loading room types..." : `${availableRoomTypes.length} ${availableRoomTypes.length === 1 ? "room type" : "room types"} available`}
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
              {availableRoomTypes.map((entry) => {
                const type = entry.type;
                const isSelected = selectedRoomType === type.value;
                const typeImageUrl = getRoomTypeImages(roomTypes, type.value)[0];
                const typeMaxCapacity = type.maxCapacity ?? 0;

                // Per W3.6 — pricing lives on the type. Apply the
                // negotiated map override first (S4.1 / decision #101).
                // Per BI-04: never render ₱0 when the type has no
                // corporateRate — fall back to the standard rate.
                const baseCorp = (ratePerRoomType && ratePerRoomType[type.value] !== undefined)
                  ? ratePerRoomType[type.value]
                  : (type.corporateRate || type.pricePerNight || 0);

                return (
                  <motion.article
                    key={type.value}
                    className={cn(
                      "overflow-hidden rounded-card bg-white shadow-sm ring-1 transition flex flex-col h-full",
                      isSelected ? "ring-2 ring-primary" : "ring-gray-200"
                    )}
                    variants={staggerChild}
                  >
                    <div className="aspect-[16/10] overflow-hidden bg-section-bg relative">
                      {typeImageUrl ? (
                        <img src={typeImageUrl} alt={type.label} className="h-full w-full object-cover" />
                      ) : null}
                      <div className="absolute top-3 left-3 flex gap-2">
                        <span className="rounded bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary">
                          {type.shortLabel}
                        </span>
                      </div>
                      <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-primary shadow-sm">
                        {entry.availableCount} of {entry.totalCount} available
                      </span>
                    </div>

                    <div className="p-5 flex flex-col flex-1">
                      <h3 className="text-lg font-semibold text-gray-950">{type.label}</h3>
                      <p className="mt-2 text-xs text-gray-500 leading-normal flex-1 line-clamp-2">
                        {type.description || ""}
                      </p>

                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
                        <span className="flex items-center gap-1.5">
                          <Users size={14} className="text-primary" />
                          Capacity: Up to {typeMaxCapacity}
                        </span>
                        <span>{type.bedDefinition || ""}</span>
                      </div>

                      {/* Corporate Rate Display */}
                      <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-150 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-gray-500">Corporate Price</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-lg font-bold text-gray-950">
                              {formatPrice(baseCorp)}
                            </span>
                          </div>
                        </div>
                        {activeCode && (
                          <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded font-semibold border border-green-200">
                            Negotiated rate
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
                          onClick={() => selectRoomType(type.value, "room-only")}
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
                          onClick={() => selectRoomType(type.value, "room-breakfast")}
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
                  and{" "}
                  <Link className="font-semibold text-primary underline" target="_blank" to="/terms">
                    Terms of Service
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
            typeLabel={selectedTypeEntry?.label ?? ""}
            typeImageUrls={selectedTypeEntry ? getRoomTypeImages(roomTypes, selectedTypeEntry.value) : []}
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
    // Per W2.11 / decision #99: LOU is no longer collected in Phase 1
    // (chargeback shows a note; staff tracks receipt via louReceived).
    // Per BI-05: personal pay requires the uploaded receipt before
    // Confirm unlocks. Per BI-01: Confirm also waits for the
    // Turnstile token — submitting without one is a guaranteed 400.
    const canConfirm =
      termsConsent &&
      Boolean(selectedTypeEntry) &&
      Boolean(reviewTurnstile.token) &&
      !uploadingProof &&
      (!isPersonalPay || Boolean(proofUpload));

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
                    {corporatePaymentMethods
                      .map((pm) => {
                        const Icon = pm.method === "gcash" || pm.method === "maya" ? Wallet : Landmark;
                        return (
                          <button
                            key={pm.method}
                            type="button"
                            className={cn(
                              "flex items-center gap-3 rounded-lg border p-4 text-left transition",
                              paymentMethod === pm.method ? "border-primary bg-primary-light/50 ring-1 ring-primary" : "border-gray-200 hover:bg-gray-50"
                            )}
                            onClick={() => setPaymentMethod(pm.method)}
                          >
                            <Icon className="text-primary shrink-0" size={24} />
                            <div>
                              <p className="font-semibold text-gray-950 text-sm">{pm.label}</p>
                              <p className="text-xs text-gray-500">
                                {pm.method === "bank" ? "1-2 hours validation" : "Instant validation"}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                  </div>

                  {(() => {
                    const pm = paymentMethodsConfig.find((m) => m.method === paymentMethod);
                    if (!pm) return null;
                    return (
                      <div className="mt-6 rounded-lg bg-gray-50 p-4 text-xs text-gray-700 space-y-2">
                        <p className="font-semibold text-gray-900">Transfer account details:</p>
                        {pm.accountName && (
                          <p>Account name: <span className="font-bold text-gray-950">{pm.accountName}</span></p>
                        )}
                        {pm.accountNumber && (
                          <p>{pm.method === "paypal" ? "PayPal email" : pm.method === "bank" ? "Account number" : "GCash number"}: <span className="font-bold text-gray-950">{pm.accountNumber}</span></p>
                        )}
                        {pm.qrUrl && (
                          <div className="mt-3 flex justify-center">
                            <img src={pm.qrUrl} alt={`${pm.label} QR code`} className="h-32 w-32 rounded-lg border border-gray-200 bg-white object-contain p-2" />
                          </div>
                        )}
                        {!pm.accountName && !pm.accountNumber && !pm.qrUrl && (
                          <p className="text-gray-500">No payment details configured yet. Please contact the front desk for the deposit slip.</p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Proof upload — per BI-05, a real Storage upload
                      (was: filename-only state, nothing persisted). */}
                  <div className="mt-6">
                    <p className="text-sm font-medium text-gray-700 mb-2">Upload payment receipt screenshot <span className="text-red-500">*</span></p>
                    {proofUpload ? (
                      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={18} className="text-status-green-text" />
                          <span className="text-sm font-medium text-gray-800">{proofUpload.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setProofUpload(null)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center transition hover:bg-gray-50">
                        <UploadCloud size={32} className="text-primary mb-2" />
                        <span className="text-sm font-semibold text-gray-900">
                          {uploadingProof ? "Uploading receipt..." : "Click to upload receipt photo"}
                        </span>
                        <span className="mt-1 text-xs text-gray-500">JPG, PNG, or WEBP up to 5MB</span>
                        <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploadingProof} />
                      </label>
                    )}
                  </div>
                </div>
              ) : (
                /* Company Charge Back (no LOU upload per W2.11 / decision #99) */
                <div>
                  <h3 className="text-lg font-semibold text-gray-950">Company Charge Back Direct Billing</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Your company account has been set to direct bill. The negotiated corporate rate has been applied to your stay.
                  </p>

                  <div className="mt-6 rounded-lg bg-primary-light/50 border border-primary/20 p-4 text-xs text-gray-700 flex gap-2">
                    <Info size={16} className="text-primary shrink-0 mt-0.5" />
                    <p>
                      Our accounts team will email you within 24 hours to request your company's Letter of Undertaking (LOU), Travel Voucher, or approved Purchase Order. You don't need to upload anything here. The reservation will be marked <span className="font-semibold">Pending Verification</span> until authorization is received.
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
                  I declare the travel information is correct. I agree to the hotel check-in/out policies, room guidelines, corporate audit rules, and{" "}
                  <Link className="font-semibold text-primary underline" target="_blank" to="/terms">
                    Terms of Service
                  </Link>
                  .
                </span>
              </label>

              {/* Per BI-01: real Cloudflare Turnstile challenge —
                  replaces the previous hardcoded "Connection
                  Verified" panel that had no widget behind it. */}
              <div ref={reviewTurnstile.containerRef} className="flex justify-center" />
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
            typeLabel={selectedTypeEntry?.label ?? ""}
            typeImageUrls={selectedTypeEntry ? getRoomTypeImages(roomTypes, selectedTypeEntry.value) : []}
            total={total}
            ratePerNight={ratePerNight}
            breakfastRatePerPerson={breakfastConfig.ratePerPersonPerNight}
          />
        </section>

        {/* Footer sticky bar */}
        <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-gray-600">
                {isPersonalPay ? "Personal payment verification" : "Authorization via email after booking"}
              </p>
              <p className="text-sm font-semibold text-gray-950">
                {isPersonalPay && uploadingProof
                  ? "Uploading payment receipt..."
                  : isPersonalPay && !proofUpload
                  ? "Payment receipt upload required"
                  : !termsConsent
                  ? "Agree to the terms to continue"
                  : !reviewTurnstile.token
                  ? "Running a quick security check..."
                  : isPersonalPay
                  ? "Payment receipt uploaded"
                  : "No LOU upload needed — accounts team will email you"}
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
  // Per the room-type booking refactor: the aside shows the chosen
  // type label + (once assigned by the server) the physical room
  // number. Pre-assignment, `assignedRoomNumber` is empty.
  typeLabel: string;
  assignedRoomNumber?: string;
  typeImageUrls?: string[];
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
  typeLabel,
  assignedRoomNumber = "",
  typeImageUrls = [],
  total,
  ratePerNight,
  breakfastRatePerPerson = 250
}: BookingReviewAsideProps) {
  if (!typeLabel) return null;

  const roomTotal = ratePerNight * nights;
  const breakfastTotal = hasBreakfast ? breakfastRatePerPerson * guests * nights : 0;

  return (
    <aside className="lg:sticky lg:top-36 lg:self-start">
      <div className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
        <img src={typeImageUrls[0]} alt={typeLabel} className="h-52 w-full object-cover" />
        <div className="p-5">
          <h2 className="text-xl font-semibold text-gray-950">{typeLabel}</h2>
          {assignedRoomNumber ? (
            <p className="mt-1 text-sm font-medium text-primary">Room {assignedRoomNumber}</p>
          ) : null}
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
