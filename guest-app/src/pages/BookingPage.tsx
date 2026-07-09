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
  Wallet,
  Banknote
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { collection, doc, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase/config";
import {
  calculateBookingTotal,
  calculateSeasonalAwareRoomBreakdown,
  calculateSeasonalAwareRoomTotal,
  getDateKeyInTimezone,
  getNumNights,
  staggerChild,
  staggerContainer,
  compressImageFile
} from "@spark-inn/shared";
import type { BookingRateBreakdown, BookingRateLine } from "@spark-inn/shared";
// Per BF-29 (booking-flow audit 2026-06-26): replace the
// inline email regex with Zod's `z.string().email()` so the
// validation matches the server-side schema (RFC-ish checks,
// consistent error formatting) and stays in sync with the
// rest of the form-validation surface.
import { z } from "zod";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { PrimaryButton } from "../components/PrimaryButton";
import { PriceBreakdown } from "../components/PriceBreakdown";
import { StepIndicator } from "../components/StepIndicator";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, getRoomTypeRates, useRoomTypes } from "../hooks/useRoomTypes";
import { useTurnstileToken } from "../hooks/useTurnstileToken";
import { useGuestAuth } from "../context/GuestAuthContext";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";

const steps = ["Select Room", "Guest Details", "Review & Pay", "Confirmation"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DISCOUNT_ID_COMPRESSION_OPTIONS = {
  maxWidth: 2200,
  maxHeight: 2200,
  quality: 0.94,
  mimeType: "image/jpeg" as const
};
// Per BF-26 (booking-flow audit 2026-06-26): the previous module-level
// constants ignored the live `breakfastConfig` (rate + on/off toggle).
// The Step 1 card price + the Room + Breakfast option therefore
// disagreed with the server whenever admin configured a different
// rate or disabled breakfast. Both values are now read from the
// `breakfastConfig` state loaded from Firestore (see fetchConfigs
// below) — these constants are gone.

type RateChoice = "room-only" | "room-breakfast";
type GuestField = "firstName" | "lastName" | "email" | "phone" | "guestCount";
type VoucherIssue = "expired" | "usage-limit" | "room-mismatch" | "inactive" | "invalid";

// Per BF-07 (booking-flow audit 2026-06-26): the previous
// `voucherMessages` map was defined but never read — the
// handler surfaced raw server error strings like
// "Voucher has expired." which read awkwardly to guests. The
// map is now used by `mapVoucherError()` to translate the
// server message into one of the friendly strings below. The
// `inactive` case was added for vouchers with `isActive: false`.
const voucherMessages: Record<VoucherIssue, string> = {
  expired: "This voucher expired already. You can remove it or try another code.",
  "usage-limit": "This voucher has reached its usage limit. Please choose another code.",
  "room-mismatch": "This voucher is not valid for the selected room type.",
  inactive: "This voucher is currently inactive. Please contact the front desk for a fresh code.",
  invalid: "We could not find that voucher. Check the code and try again."
};

// Per BF-07: map the server's raw voucher error text to a
// friendly message. Falls back to the `invalid` message when
// the server text doesn't match any known error.
function mapVoucherError(serverMessage: string): string {
  const lower = serverMessage.toLowerCase();
  if (lower.includes("expired")) return voucherMessages.expired;
  if (lower.includes("usage") || lower.includes("limit")) return voucherMessages["usage-limit"];
  if (lower.includes("room type") || lower.includes("applicable")) return voucherMessages["room-mismatch"];
  if (lower.includes("inactive")) return voucherMessages.inactive;
  return voucherMessages.invalid;
}

function formatStayDate(value: string) {
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function sanitizeUploadFileName(fileName: string) {
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? "";
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${Date.now()}-${baseName || "upload"}${extension}`;
}

export function BookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const { rooms, loading: roomsLoading } = useRooms();
  const { roomTypes, seasonalRateOverrides } = useRoomTypes();
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
  const [bookedRanges, setBookedRanges] = useState<
    Array<{ roomId: string; checkIn: string; checkOut: string; status: string }>
  >([]);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // Spark Rewards member discount (client-side display mirror).
  // The actual charge is computed server-side in handleCreateBooking
  // (per W2.2 / decision #90) using the same value from rewardsConfig.
  const memberDiscountPct = rewardsConfig?.memberDiscountEnabled !== false
    && memberProfile
    ? Number(rewardsConfig?.memberDiscountPct) || 0
    : 0;

  const [checkIn, setCheckIn] = useState(() => searchParams.get("checkIn") ?? getDateKeyInTimezone(config.timezone, 1));
  const [checkOut, setCheckOut] = useState(() => searchParams.get("checkOut") ?? getDateKeyInTimezone(config.timezone, 2));
  const [guests, setGuests] = useState(Number(searchParams.get("guests") ?? 2));
  // Per the room-type booking refactor: Step 1 now shows one card
  // per room type (not per physical room). The guest picks a type;
  // the server auto-assigns a physical room of that type inside
  // the availability transaction.
  const [selectedRoomType, setSelectedRoomType] = useState(searchParams.get("roomType") ?? "");
  
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
  // Per BF-30 (booking-flow audit 2026-06-26): the previous
  // shape was two parallel state vars (`discountIdFile` +
  // `discountIdUrl`) that could desync. Collapse to a single
  // record `{ name, url } | null` so the file name and
  // download URL are always written together. Same for the
  // payment proof.
  const [discountIdUpload, setDiscountIdUpload] = useState<{ name: string; url: string } | null>(null);
  const [uploadingDiscountId, setUploadingDiscountId] = useState(false);
  const [discountIdUploadError, setDiscountIdUploadError] = useState("");
  const discountIdInputRef = useRef<HTMLInputElement | null>(null);

  // The payment method list is dynamic — managed from Settings →
  // Payment Methods in the admin app (per `plan/features/SETTINGS.md
  // §Payment Methods`). The admin can add, remove, reorder, and
  // toggle any method. We default to the first enabled method's
  // `method` key, falling back to "gcash" if the config hasn't
  // loaded yet or no methods are enabled. The actual current
  // selection is re-validated in the render below so a method that
  // gets disabled (or the config that gets updated) while the page
  // is open cannot leave the user with an unselectable option.
  const [paymentMethod, setPaymentMethod] = useState<string>("gcash");
  const [paymentProofUpload, setPaymentProofUpload] = useState<{ name: string; url: string } | null>(null);
  const [uploadingPaymentProof, setUploadingPaymentProof] = useState(false);

  const [termsConsent, setTermsConsent] = useState(false);
  // Per BI-03 (booking-intercom audit 2026-07-06): the widget is
  // rendered through the shared `useTurnstileToken` hook, gated on
  // the review step (the only step whose JSX contains the
  // container). The previous inline effect ran once on mount with
  // `[]` deps and bailed when the container was null — the first
  // render is always the loading skeleton or Step 1, so the widget
  // never mounted and every submit fell back to `"mock_token"`
  // (which the server no longer accepts — see BI-02).
  const {
    token: turnstileToken,
    containerRef: turnstileContainerRef,
    reset: resetTurnstile
  } = useTurnstileToken({
    enabled: isReviewStep
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const navigate = useNavigate();

  const nights = Math.max(getNumNights(checkIn, checkOut), 1);

  // Per the room-type booking refactor: Step 1 shows one card
  // per room type. For each type, count the candidate physical
  // rooms (active, capacity-ok) and subtract the ones with an
  // overlapping active booking. The result drives the
  // "X of Y available for your dates" copy on each card.
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

  // Types shown in Step 1 — only those that can fit the guest count
  // and still have at least one free physical room for the window.
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

  // Per `plan/features/SETTINGS.md §Payment Methods` — the booking
  // payment list is dynamic. Sourced from
  // `settings/hotelConfig.paymentMethods[]` and filtered to the
  // admin-enabled subset. "Pay at Hotel" is just another entry
  // here (no separate global `payAtHotelEnabled` flag).
  const availablePaymentMethods = useMemo(() => {
    const raw = hotelConfig?.paymentMethods;
    if (!Array.isArray(raw)) return [] as Array<{ method: string; label: string; accountName: string; accountNumber: string; qrUrl: string; isEnabled: boolean }>;
    return raw.filter((p: any) => p && p.isEnabled !== false);
  }, [hotelConfig?.paymentMethods]);

  const currentPaymentMethod = useMemo(
    () => availablePaymentMethods.find((p) => p.method === paymentMethod) ?? null,
    [availablePaymentMethods, paymentMethod]
  );

  const isPayAtHotel = currentPaymentMethod?.method === "pay-at-hotel";

  // Re-validate the current selection: if the admin disabled the
  // chosen method (or the config just loaded) while the page is
  // open, fall back to the first available. The default
  // `paymentMethod` is "gcash" which may not be enabled.
  useEffect(() => {
    if (availablePaymentMethods.length === 0) return;
    if (currentPaymentMethod) return;
    setPaymentMethod(availablePaymentMethods[0].method);
  }, [availablePaymentMethods, currentPaymentMethod, setPaymentMethod]);

  const selectedTypeEntry = roomTypes.find((type) => type.value === selectedRoomType)
    ?? availableRoomTypes[0]?.type
    ?? null;
  // Per W3.6 — pricing + max occupancy live on the room's type.
  const selectedRoomRates = selectedTypeEntry
    ? getRoomTypeRates(roomTypes, selectedTypeEntry.value)
    : null;
  const selectedMaxCapacity = selectedRoomRates?.maxCapacity ?? 0;
  const hasBreakfast = breakfastConfig.isEnabled && rateChoice === "room-breakfast";
  const breakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || 250) : 0;

  // Calculate room total client-side, incorporating weekend rates (Saturdays and Sundays)
  const roomTotal = useMemo(() => {
    if (!selectedTypeEntry || !selectedRoomRates) return 0;
    return calculateSeasonalAwareRoomTotal({
      checkIn: `${checkIn}T00:00:00Z`,
      checkOut: `${checkOut}T00:00:00Z`,
      roomType: selectedTypeEntry.value,
      baseRate: selectedRoomRates.pricePerNight,
      weekendRate: selectedRoomRates.weekendRate,
      seasonalRateOverrides
    });
  }, [selectedTypeEntry, selectedRoomRates, checkIn, checkOut, seasonalRateOverrides]);

  const discountPct = discountType === "none" ? 0 : 20;
  const breakfastTotal = hasBreakfast ? breakfastRate * guests * nights : 0;
  const subtotal = roomTotal + breakfastTotal;

  const voucherDiscount = useMemo(() => {
    if (!voucherApplied) return 0;
    const seniorPwdDiscount = Math.round(subtotal * (discountPct / 100));
    const voucherBase = Math.max(subtotal - seniorPwdDiscount, 0);
    if (voucherDiscountType === "percent") {
      return Math.round(voucherBase * (voucherDiscountValue / 100));
    }
    return Math.min(voucherDiscountValue, voucherBase);
  }, [voucherApplied, voucherDiscountType, voucherDiscountValue, subtotal, discountPct]);

  const total = selectedTypeEntry && selectedRoomRates
    ? calculateBookingTotal({
        ratePerNight: selectedRoomRates.pricePerNight,
        numNights: nights,
        // Per BF-08 (booking-flow audit 2026-06-26): pass the
        // weekend-aware per-night breakdown so the displayed
        // total matches the server's `totalPrice` (the server
        // walks each night and substitutes the weekend rate).
        roomTotal,
        numGuests: guests,
        breakfastRate,
        hasBreakfast,
        discountPct,
        voucherDiscount,
        memberDiscountPct
      })
    : 0;

  const rateBreakdown = useMemo(() => {
    if (!selectedTypeEntry || !selectedRoomRates) return null;
    return buildGuestRateBreakdown({
      roomLines: calculateTypeRoomBreakdown(selectedTypeEntry, checkIn, checkOut, seasonalRateOverrides).roomLines,
      roomSubtotal: roomTotal,
      breakfastTotal,
      discountType,
      discountPct,
      voucherApplied,
      voucherDiscount,
      memberDiscountPct,
      finalTotal: total
    });
  }, [
    selectedTypeEntry,
    selectedRoomRates,
    checkIn,
    checkOut,
    seasonalRateOverrides,
    roomTotal,
    breakfastTotal,
    discountType,
    discountPct,
    voucherApplied,
    voucherDiscount,
    memberDiscountPct,
    total
  ]);

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
  reviewParams.set("requests", guestDetails.requests);

  // Per BF-29: Zod-based email validation. Compile once at
  // module scope so the regex doesn't re-compile on every
  // render. Zod's `.email()` matches the server's
  // `GuestDetailsSchema` (shared/schemas/booking.ts).
  const emailSchema = z.string().email("Enter a valid email address.");

  const guestErrors = {
    firstName: guestDetails.firstName.trim() ? "" : "First name is required.",
    lastName: guestDetails.lastName.trim() ? "" : "Last name is required.",
    email: guestDetails.email.trim() && emailSchema.safeParse(guestDetails.email).success
      ? ""
      : "Enter a valid email address.",
    phone: guestDetails.phone.trim().length >= 8 ? "" : "Phone number is required.",
    guestCount:
      Number(guestDetails.guestCount) >= 1 && selectedMaxCapacity > 0 && Number(guestDetails.guestCount) <= selectedMaxCapacity
        ? ""
        : `Guest count must be between 1 and ${selectedMaxCapacity || guests}.`
  };
  const canContinueToReview =
    Object.values(guestErrors).every((error) => !error) && guestDetails.consent && Boolean(selectedTypeEntry);
  const nightlyTotal = selectedRoomRates
    ? selectedRoomRates.pricePerNight + (hasBreakfast ? breakfastRate * guests : 0)
    : 0;

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
  }, []);

  // Per W4.7: fetch PII-stripped booked date ranges for the requested
  // window from the public availability endpoint. Firestore rules deny
  // guest reads on `bookings`, so the client cannot subscribe directly.
  // The server transaction in `/api/bookings/create` is the authoritative
  // double-booking safety net — this fetch is purely for UX filtering.
  useEffect(() => {
    let cancelled = false;
    async function fetchAvailability() {
      try {
        const params = new URLSearchParams({ checkIn, checkOut });
        const url = `/api/rooms/availability?${params.toString()}`;
        const response = await fetch(url);
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(`Availability request failed: ${response.status} ${response.statusText} (${url})`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          // Common in dev when `vercel dev` is not running — the SPA shell
          // is returned for unknown routes and the response is HTML, not JSON.
          throw new Error(
            `Availability endpoint did not return JSON (content-type: "${contentType}", status: ${response.status}). ` +
              `Is the API function running? Start it with "vercel dev" (npm run dev:guest).`
          );
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
        console.error("Room availability fetch error:", err);
        setBookedRanges([]);
      }
    }
    fetchAvailability();
    return () => {
      cancelled = true;
    };
  }, [checkIn, checkOut]);

  useEffect(() => {
    if (!selectedRoomType && availableRoomTypes[0]) {
      setSelectedRoomType(availableRoomTypes[0].type.value);
      return;
    }

    if (
      selectedRoomType
      && !availableRoomTypes.some((entry) => entry.type.value === selectedRoomType)
      && availableRoomTypes[0]
    ) {
      setSelectedRoomType(availableRoomTypes[0].type.value);
    }
  }, [availableRoomTypes, selectedRoomType]);

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

  function validateUploadFile(file: File) {
    if (!ACCEPTED_UPLOAD_TYPES.has(file.type)) {
      return "Please upload a JPG, PNG, or WEBP image.";
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return "Please upload an image that is 5MB or smaller.";
    }
    return "";
  }

  function resetDiscountIdInput() {
    if (discountIdInputRef.current) {
      discountIdInputRef.current.value = "";
    }
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
    // Per BI-09 (booking-intercom audit 2026-07-06): the Step 2
    // "Number of guests" field used to write only to
    // `guestDetails.guestCount`, while the create body, the
    // breakfast total, and the member/voucher math all used the
    // separate `guests` state seeded from the Step 1 URL param.
    // Editing the field changed what the guest *saw* without
    // changing what was *booked or charged*. The corporate page
    // wires it correctly (`CorporateBookingPage.tsx:1285-1288`):
    // a Step 2 edit also updates `guests`. Mirror that here so
    // the Step 2 value is the single source of truth that flows
    // into the submitted body + downstream totals.
    if (field === "guestCount") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 1) {
        setGuests(parsed);
        updateDateParams(checkIn, checkOut, parsed);
      }
    }
  }

  // Real API calls for Voucher validation
  async function handleApplyVoucher(e: React.FormEvent) {
    e.preventDefault();
    const code = voucherCode.trim();
    if (!code) {
      setVoucherError("Please enter a code.");
      return;
    }
    if (!turnstileToken) {
      setVoucherError("Security check is still loading. Please wait a moment, then apply the voucher again.");
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
          roomType: selectedTypeEntry?.value,
          // Per BI-02/BI-03: real token only — the server no longer
          // accepts the "mock_token" sentinel outside unit tests.
          turnstileToken
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Invalid voucher code.");
      }

      setVoucherApplied(true);
      setVoucherCode(result.data.code || code);
      setVoucherDiscountValue(result.data.discountValue);
      setVoucherDiscountType(result.data.discountType);
      setVoucherError("");
    } catch (err: any) {
      console.error("Voucher error:", err);
      // Per BF-07 (booking-flow audit 2026-06-26): map the
      // server's raw error text to one of the friendly
      // `voucherMessages`. Fall back to the `invalid` message
      // when the server text doesn't match.
      const friendly = err?.message ? mapVoucherError(err.message) : voucherMessages.invalid;
      setVoucherError(friendly);
      setVoucherApplied(false);
    } finally {
      resetTurnstile();
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
    setDiscountIdUploadError("");
    if (type === "none" || type !== discountType) {
      setDiscountIdUpload(null);
      resetDiscountIdInput();
    }
  }

  // Image upload handlers with compression
  async function handleDiscountIdChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validationError = validateUploadFile(file);
      if (validationError) {
        setDiscountIdUploadError(validationError);
        e.target.value = "";
        return;
      }
      setUploadingDiscountId(true);
      setDiscountIdUploadError("");
      setSubmitError("");
      try {
        const compressed = await compressImageFile(file, DISCOUNT_ID_COMPRESSION_OPTIONS);
        const safeFileName = sanitizeUploadFileName(compressed.file.name);
        const storageRef = ref(storage, `bookings/${bookingId}/discount-id/${safeFileName}`);
        await uploadBytes(storageRef, compressed.file);
        const url = await getDownloadURL(storageRef);
        // Per BF-30: single state record so the name + url
        // are always written together (no desync race).
        setDiscountIdUpload({ name: file.name, url });
        e.target.value = "";
      } catch (err) {
        console.error("Discount ID upload failed:", err);
        setDiscountIdUploadError("ID upload failed. Please check your connection and try again.");
        e.target.value = "";
      } finally {
        setUploadingDiscountId(false);
      }
    }
  }

  async function handlePaymentProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validationError = validateUploadFile(file);
      if (validationError) {
        setSubmitError(validationError);
        e.target.value = "";
        return;
      }
      setUploadingPaymentProof(true);
      setSubmitError("");
      try {
        const compressed = await compressImageFile(file);
        const storageRef = ref(storage, `bookings/${bookingId}/payment-proof/${compressed.file.name}`);
        await uploadBytes(storageRef, compressed.file);
        const url = await getDownloadURL(storageRef);
        // Per BF-30: single state record.
        setPaymentProofUpload({ name: file.name, url });
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
          roomType: selectedTypeEntry?.value,
          checkIn,
          checkOut,
          // Per BI-09 (booking-intercom audit 2026-07-06): the
          // Step 2 "Number of guests" field is the single source
          // of truth once the guest has touched it. Mirror the
          // corporate page (`CorporateBookingPage.tsx:619`) and
          // prefer the parsed Step 2 value, falling back to the
          // Step 1 stepper for guests who never reached Step 2.
          guests: Number(guestDetails.guestCount) || guests,
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
          discountIdPhotoUrl: discountIdUpload?.url ?? null,
          voucherCode: voucherApplied ? voucherCode : "",
          paymentMethod,
          paymentProofUrl: paymentProofUpload?.url ?? null,
          // Per W1.3 / decision #79 / audit S1.5: the standard
          // online booking flow is never corporate. The server
          // derives `isCorporate` only from a validated
          // `corporateCode` lookup, so this field is omitted.
          turnstileToken,
          _hp: guestDetails._hp || ""
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to confirm booking.");
      }

      // Successful creation, redirect to confirmation page
      // Per BF-39 (booking-flow audit 2026-06-26): prefer the
      // server-returned `totalPrice` so the confirmation page
      // displays what was actually charged. Fall back to the
      // local `total` only if the server response is missing it
      // (legacy / future-proof).
      const serverTotal = typeof result.data?.totalPrice === "number"
        ? result.data.totalPrice
        : null;
      const confirmedGuests = Number(guestDetails.guestCount) || guests;
      const confirmParams = new URLSearchParams({
        bookingRef: result.data.bookingRef,
        roomType: result.data.roomType || selectedTypeEntry?.value || "",
        roomId: result.data.roomId || "",
        roomNumber: result.data.roomNumber || "",
        checkIn,
        checkOut,
        guests: String(confirmedGuests),
        paymentMethod,
        total: String(serverTotal ?? total)
      });
      const confirmedBreakdown = result.data?.rateBreakdown || rateBreakdown;
      if (confirmedBreakdown) {
        confirmParams.set("rateBreakdown", encodeURIComponent(JSON.stringify(confirmedBreakdown)));
      }
      navigate(`/book/confirm?${confirmParams.toString()}`);
    } catch (err: any) {
      console.error("Confirm booking error:", err);
      resetTurnstile();
      if (err.message === "Room no longer available") {
        setSubmitError("Sorry, no rooms of this type are available for your selected dates. Please go back and pick another room type.");
        // Auto redirect to Step 1 after 5 seconds
        setTimeout(() => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("step");
          nextParams.delete("roomType");
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
            typeLabel={selectedTypeEntry?.label ?? ""}
            typeValue={selectedTypeEntry?.value ?? ""}
            typeImageUrls={selectedTypeEntry ? getRoomTypeImages(roomTypes, selectedTypeEntry.value) : []}
            typeRates={selectedRoomRates}
            typeDescription={selectedTypeEntry?.description ?? ""}
            total={total}
            breakfastRate={breakfastRate}
            seasonalRateOverrides={seasonalRateOverrides}
            discountPct={discountPct}
            discountType={discountType}
            voucherDiscount={voucherDiscount}
            voucherApplied={voucherApplied}
            memberDiscountPct={memberDiscountPct}
            isMember={!!memberProfile}
            rateBreakdown={rateBreakdown}
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
  const isIdUploadRequired = discountType !== "none" && !discountIdUpload;
  const isPaymentProofRequired = paymentMethod !== "pay-at-hotel" && !paymentProofUpload;
    // Per BI-03 + BOOKING-FLOW.md §Step 3: Confirm stays disabled
    // until the Turnstile token has been received — submitting
    // without one is a guaranteed 400 now that the server bypass
    // is gone (BI-02).
    const canConfirm = termsConsent && !isIdUploadRequired && !isPaymentProofRequired && Boolean(selectedTypeEntry) && Boolean(turnstileToken);

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
                    setVoucherApplied(false);
                    setVoucherDiscountValue(0);
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
                    disabled={isValidatingVoucher || !voucherCode.trim() || !turnstileToken}
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
                    {discountIdUpload ? (
                      <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 bg-gray-50">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={18} className="text-status-green-text" />
                          <span className="text-sm font-medium text-gray-800">{discountIdUpload.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDiscountIdUpload(null);
                            setDiscountIdUploadError("");
                            resetDiscountIdInput();
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
                          ref={discountIdInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handleDiscountIdChange}
                          className="sr-only"
                          disabled={uploadingDiscountId}
                        />
                      </label>
                    )}
                    {discountIdUploadError ? (
                      <p className="mt-2 text-sm font-medium text-red-600" role="alert">
                        {discountIdUploadError}
                      </p>
                    ) : null}
                  </div>
                  </div>
                )}
            </div>

            {/* Payment Method Section — dynamic, per
                `plan/features/SETTINGS.md §Payment Methods`. The
                list is sourced from
                `settings/hotelConfig.paymentMethods[]` and filtered
                to `isEnabled`. The "Pay at Hotel" method is just
                another entry — there is no separate global
                `payAtHotelEnabled` flag. If no methods are enabled
                (or the config hasn't loaded), the booking is
                blocked at the Confirm button. */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              <h3 className="text-lg font-semibold text-gray-950">Payment Method</h3>
              <p className="mt-1 text-sm text-gray-600">Select how you would like to pay for your reservation.</p>

              {availablePaymentMethods.length === 0 ? (
                <div className="mt-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center">
                  <p className="text-sm font-semibold text-gray-700">No payment methods available</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Please contact the front desk to complete your reservation.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {availablePaymentMethods.map((pm) => {
                      const Icon =
                        pm.method === "gcash" || pm.method === "maya"
                          ? Wallet
                          : pm.method === "bank"
                          ? Landmark
                          : pm.method === "pay-at-hotel"
                          ? Banknote
                          : CreditCard;
                      return (
                        <button
                          key={pm.method}
                          type="button"
                          onClick={() => setPaymentMethod(pm.method)}
                          className={cn(
                            "flex flex-col items-start p-4 rounded-lg border text-left transition",
                            paymentMethod === pm.method
                              ? "border-primary bg-primary-light ring-1 ring-primary"
                              : "border-gray-200 bg-white hover:border-primary"
                          )}
                        >
                          <Icon size={20} className={paymentMethod === pm.method ? "text-primary" : "text-gray-500"} />
                          <span className="mt-3 block text-sm font-bold text-gray-900">{pm.label}</span>
                          <span className="mt-0.5 block text-xs text-gray-500">
                            {pm.method === "gcash"
                              ? "Digital wallet"
                              : pm.method === "maya"
                              ? "Digital wallet"
                              : pm.method === "bank"
                              ? "Direct deposit"
                              : pm.method === "paypal"
                              ? "International card / PayPal balance"
                              : pm.method === "pay-at-hotel"
                              ? "Upon arrival"
                              : "Online payment"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Conditional instructions panel — one unified
                      layout for every online method. "Pay at Hotel"
                      gets a separate, simpler panel. */}
                  <div className="mt-6 rounded-xl border border-primary-light bg-section-bg overflow-hidden">
                    {isPayAtHotel ? (
                      <div className="p-5 flex items-start gap-3">
                        <Info size={20} className="text-primary shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-primary text-base">Pay upon Check-in</h4>
                          <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                            Present your booking reference at the front desk upon arrival. We accept cash, major credit cards, and digital wallet payments.
                          </p>
                        </div>
                      </div>
                    ) : currentPaymentMethod ? (
                      <div className="grid sm:grid-cols-5">
                        <div className="sm:col-span-2 min-h-48 overflow-hidden bg-gray-100 flex items-center justify-center p-4">
                          {currentPaymentMethod.qrUrl ? (
                            <img
                              src={currentPaymentMethod.qrUrl}
                              alt={`${currentPaymentMethod.label} QR code`}
                              className="h-40 w-40 object-contain rounded"
                            />
                          ) : (
                            <p className="text-xs text-gray-500 text-center px-4">
                              QR code not yet configured. Please contact the front desk for payment details.
                            </p>
                          )}
                        </div>
                        <div className="sm:col-span-3 p-5 flex flex-col justify-center">
                          <h4 className="font-semibold text-primary text-base">{currentPaymentMethod.label} Payment Details</h4>
                              <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                                Please send your payment of <span className="font-bold text-gray-800">{formatPrice(total)}</span> via {currentPaymentMethod.label}. The recipient name is <span className="font-bold text-gray-800">{currentPaymentMethod.accountName || config.legalName}</span>.
                              </p>
                          {currentPaymentMethod.accountNumber && (
                            <p className="mt-1 text-xs font-semibold text-gray-800">
                              {currentPaymentMethod.method === "paypal" ? "PayPal email" : "Account number"}: {currentPaymentMethod.accountNumber}
                            </p>
                          )}
                          <ul className="mt-3 space-y-1.5 text-xs text-gray-500">
                            <li className="flex items-center gap-1.5">
                              <Info size={14} className="text-primary" />
                              Your booking is held for 30 minutes.
                            </li>
                            <li className="flex items-center gap-1.5">
                              <ShieldCheck size={14} className="text-primary" />
                              Secure transaction via {currentPaymentMethod.label}.
                            </li>
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
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
                    {paymentProofUpload ? (
                      <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 bg-gray-50">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={18} className="text-status-green-text" />
                          <span className="text-sm font-medium text-gray-800">{paymentProofUpload.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentProofUpload(null);
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
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handlePaymentProofChange}
                          className="sr-only"
                          disabled={uploadingPaymentProof}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}

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
              ref={turnstileContainerRef}
              className="mt-6 flex justify-center"
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
            typeLabel={selectedTypeEntry?.label ?? ""}
            typeValue={selectedTypeEntry?.value ?? ""}
            typeImageUrls={selectedTypeEntry ? getRoomTypeImages(roomTypes, selectedTypeEntry.value) : []}
            typeRates={selectedRoomRates}
            typeDescription={selectedTypeEntry?.description ?? ""}
            total={total}
            discountPct={discountPct}
            voucherDiscount={voucherDiscount}
            discountType={discountType}
            voucherApplied={voucherApplied}
            breakfastRate={breakfastRate}
            memberDiscountPct={memberDiscountPct}
            seasonalRateOverrides={seasonalRateOverrides}
            isMember={!!memberProfile}
            rateBreakdown={rateBreakdown}
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
                  : !turnstileToken
                  ? "Running a quick security check..."
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
              Choose dates, guests, and a room option. We will show room types available for your stay.
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

              <div className="flex gap-3 rounded-lg bg-primary-light p-4 text-sm text-gray-700">
                <Info size={18} className="mt-0.5 shrink-0 text-primary" />
                <p>Pick a room type and we'll assign a specific room on confirmation. Prices are based on selected dates.</p>
              </div>
            </div>
          </div>
        </aside>

        <div>
          <div className="mb-5 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <p className="font-semibold text-gray-950">
              {availableRoomTypes.length} {availableRoomTypes.length === 1 ? "room type" : "room types"} available
            </p>
            <p className="text-sm text-gray-600">Select Room Only or Room + Breakfast to lock the Step 1 summary.</p>
          </div>

          {availableRoomTypes.length > 0 ? (
            <motion.div
              animate="visible"
              className="grid gap-6"
              initial={shouldReduceMotion ? false : "hidden"}
              variants={staggerContainer}
            >
              {availableRoomTypes.map((entry, index) => {
                const type = entry.type;
                const isSelected = type.value === selectedRoomType;
                // Per W3.6 — pricing + max capacity live on the type.
                const typePricePerNight = type.pricePerNight ?? 0;
                const typeMaxCapacity = type.maxCapacity ?? 0;
                const typeImageUrl = getRoomTypeImages(roomTypes, type.value)[0];
                // Per BF-26: read the live breakfast rate from
                // `breakfastConfig` (loaded from Firestore). The
                // previous module-level constant `350` ignored
                // the admin's configured rate.
                const liveBreakfastRate = breakfastConfig.isEnabled
                  ? (breakfastConfig.ratePerPersonPerNight || 0)
                  : 0;
                const typeRoomBreakdown = calculateTypeRoomBreakdown(type, checkIn, checkOut, seasonalRateOverrides);
                const hasMixedRates = typeRoomBreakdown.roomLines.length > 1;
                const roomOnlyTotal = calculateBookingTotal({
                  ratePerNight: typePricePerNight,
                  numNights: nights,
                  roomTotal: typeRoomBreakdown.roomSubtotal
                });
                const breakfastTotal = calculateBookingTotal({
                  ratePerNight: typePricePerNight,
                  numNights: nights,
                  roomTotal: typeRoomBreakdown.roomSubtotal,
                  numGuests: guests,
                  breakfastRate: liveBreakfastRate,
                  hasBreakfast: true
                });

                return (
                  <motion.article
                    key={type.value}
                    className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200"
                    variants={staggerChild}
                    whileHover={shouldReduceMotion ? undefined : { y: -4 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <div className="grid md:grid-cols-[280px_1fr]">
                      <div className="relative min-h-64 overflow-hidden bg-section-bg">
                        {typeImageUrl ? (
                          <img src={typeImageUrl} alt={type.label} className="h-full w-full object-cover" />
                        ) : null}
                        {index === 0 ? (
                          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary shadow-sm">
                            Recommended
                          </span>
                        ) : null}
                        <span className="absolute bottom-4 left-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary shadow-sm">
                          {entry.availableCount} of {entry.totalCount} available for your dates
                        </span>
                      </div>
                      <div className="p-5 sm:p-6">
                        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                          <div>
                            <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
                              {type.label}
                            </span>
                            <h2 className="mt-3 text-2xl font-semibold text-gray-950">{type.label}</h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-gray-600">{type.description || ""}</p>
                          </div>
                          <div className="sm:text-right">
                            <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
                            <p className="text-2xl font-semibold text-gray-950">{formatPrice(typePricePerNight)}</p>
                            <p className="text-sm text-gray-500">per night</p>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-2">
                            <BedDouble size={16} className="text-primary" />
                            {type.bedDefinition || ""}
                          </span>
                          <span className="flex items-center gap-2">
                            <Users size={16} className="text-primary" />
                            Up to {typeMaxCapacity}
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
                            priceLabel={`${formatPrice(typePricePerNight)} / night`}
                            totalLabel={`${formatPrice(roomOnlyTotal)} total`}
                            onSelect={() => selectRoomType(type.value, "room-only")}
                          />
                          {breakfastConfig.isEnabled ? (
                            <RateOption
                              active={isSelected && rateChoice === "room-breakfast"}
                              label="Room + Breakfast"
                              helper="Includes daily local breakfast for selected guests"
                              // Per BF-26: live rate + guest count.
                              priceLabel={`${formatPrice(typePricePerNight + liveBreakfastRate * guests)} / night`}
                              totalLabel={`${formatPrice(breakfastTotal)} total`}
                              onSelect={() => selectRoomType(type.value, "room-breakfast")}
                            />
                          ) : null}
                        </div>
                        {hasMixedRates ? (
                          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                            <p className="font-semibold text-gray-800">This stay uses mixed nightly rates.</p>
                            <div className="mt-2 space-y-1">
                              {typeRoomBreakdown.roomLines.map((line, lineIndex) => (
                                <div key={`${type.value}-${line.source}-${lineIndex}`} className="flex justify-between gap-3">
                                  <span>{line.label}: {line.nights} x {formatPrice(line.nightlyRate)}</span>
                                  <span className="font-semibold text-gray-900">{formatPrice(line.subtotal)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
          ) : (
            <div className="rounded-card bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
              <h2 className="text-xl font-semibold text-gray-950">No room types available for these dates</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
                Try fewer guests or different dates to see what's open.
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

function calculateTypeRoomBreakdown(
  type: { value: string; pricePerNight?: number; weekendRate?: number },
  checkIn: string,
  checkOut: string,
  seasonalRateOverrides: ReturnType<typeof useRoomTypes>["seasonalRateOverrides"]
) {
  return calculateSeasonalAwareRoomBreakdown({
    checkIn: `${checkIn}T00:00:00Z`,
    checkOut: `${checkOut}T00:00:00Z`,
    roomType: type.value,
    baseRate: Number(type.pricePerNight) || 0,
    weekendRate: Number(type.weekendRate) || 0,
    seasonalRateOverrides
  });
}

function buildGuestRateBreakdown(input: {
  roomLines: BookingRateLine[];
  roomSubtotal: number;
  breakfastTotal: number;
  discountType: "none" | "senior" | "pwd";
  discountPct: number;
  voucherApplied: boolean;
  voucherDiscount: number;
  memberDiscountPct: number;
  finalTotal: number;
}): BookingRateBreakdown {
  const addOns = input.breakfastTotal > 0
    ? [{ label: "Breakfast add-on", amount: input.breakfastTotal }]
    : [];
  const subtotal = input.roomSubtotal + input.breakfastTotal;
  const seniorPwdDiscount = Math.round(subtotal * (input.discountPct / 100));
  const afterSeniorPwd = subtotal - seniorPwdDiscount;
  const afterVoucher = afterSeniorPwd - input.voucherDiscount;
  const memberDiscount = Math.round(afterVoucher * (input.memberDiscountPct / 100));
  const deductions = [
    ...(seniorPwdDiscount > 0
      ? [{
          label: `${input.discountType === "senior" ? "Senior Citizen" : "PWD"} discount (${input.discountPct}%)`,
          amount: seniorPwdDiscount
        }]
      : []),
    ...(input.voucherApplied && input.voucherDiscount > 0
      ? [{ label: "Voucher discount", amount: input.voucherDiscount }]
      : []),
    ...(memberDiscount > 0
      ? [{ label: `Spark Rewards member discount (${input.memberDiscountPct}%)`, amount: memberDiscount }]
      : [])
  ];

  return {
    roomSubtotal: input.roomSubtotal,
    roomLines: input.roomLines,
    addOns,
    deductions,
    finalTotal: input.finalTotal
  };
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
  // Per the room-type booking refactor: the aside shows the chosen
  // type label + (once assigned by the server) the physical room
  // number. Pre-assignment, `assignedRoomNumber` is empty.
  typeLabel: string;
  typeValue: string;
  assignedRoomNumber?: string;
  typeImageUrls?: string[];
  // Per W3.6 — pricing lives on the type.
  typeRates?: { maxCapacity: number; pricePerNight: number; weekendRate: number; corporateRate: number } | null;
  // Per W3.7 — description lives on the type.
  typeDescription?: string;
  total: number;
  discountPct?: number;
  voucherDiscount?: number;
  discountType?: "none" | "senior" | "pwd";
  voucherApplied?: boolean;
  breakfastRate?: number;
  memberDiscountPct?: number;
  seasonalRateOverrides?: ReturnType<typeof useRoomTypes>["seasonalRateOverrides"];
  isMember?: boolean;
  rateBreakdown?: BookingRateBreakdown | null;
}

function BookingReviewAside({
  checkIn,
  checkOut,
  guests,
  hasBreakfast,
  nights,
  typeLabel,
  typeValue,
  assignedRoomNumber = "",
  typeImageUrls = [],
  typeRates,
  typeDescription = "",
  total,
  discountPct = 0,
  voucherDiscount = 0,
  discountType = "none",
  voucherApplied = false,
  breakfastRate,
  memberDiscountPct = 0,
  seasonalRateOverrides = [],
  isMember = false,
  rateBreakdown = null
}: BookingReviewAsideProps) {
  if (!typeLabel) return null;

  const roomTotal = useMemo(() => {
    if (!typeRates || !typeValue) return 0;
    return calculateSeasonalAwareRoomTotal({
      checkIn: `${checkIn}T00:00:00Z`,
      checkOut: `${checkOut}T00:00:00Z`,
      roomType: typeValue,
      baseRate: typeRates.pricePerNight,
      weekendRate: typeRates.weekendRate,
      seasonalRateOverrides
    });
  }, [typeRates, typeValue, checkIn, checkOut, seasonalRateOverrides]);

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
        <img src={typeImageUrls[0]} alt={typeLabel} className="h-52 w-full object-cover" />
        <div className="p-5">
          <h2 className="text-xl font-semibold text-gray-950">{typeLabel}</h2>
          {assignedRoomNumber ? (
            <p className="mt-1 text-sm font-medium text-primary">Room {assignedRoomNumber}</p>
          ) : null}
          <p className="mt-2 text-sm leading-6 text-gray-600">{typeDescription}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 border-y border-gray-200 py-4 text-sm">
            <SummaryCell label="Check-in" value={formatStayDate(checkIn)} />
            <SummaryCell alignEnd label="Check-out" value={formatStayDate(checkOut)} />
            <SummaryCell label="Guests" value={`${guests} ${guests === 1 ? "guest" : "guests"}`} />
            <SummaryCell alignEnd label="Duration" value={`${nights} ${nights === 1 ? "night" : "nights"}`} />
          </div>
          <div className="mt-5 space-y-3 text-sm text-gray-600">
            {rateBreakdown ? (
              <PriceBreakdown breakdown={rateBreakdown} total={total} />
            ) : (
              <>
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
              </>
            )}
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
