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
import { ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase/config";
import {
  calculateBookingTotal,
  calculateSeasonalAwareRoomBreakdown,
  calculateSeasonalAwareRoomTotal,
  calculateVatBreakdown,
  getDateKeyInTimezone,
  getNumNights,
  staggerChild,
  staggerContainer,
  compressImageFile,
  calculatePercentDiscount,
  calculateVoucherBase,
  calculateBreakfastAddOn,
  calculateExtraBedAddOn,
  requiredExtraBedsFor
} from "@spark-inn/shared";
// Per CHD-11 (2026-08-04, per decision #184): the per-type
// capacity-fit indicator derivation. The helper is the
// single derivation point for both the Fits / Tight / Doesn't
// fit chip on the room-type card AND (per CHD-12) the small
// capacity chip on each line of the cart summary. Imported
// in a separate block to keep the CHD-05 import-ordering guard
// (which requires `calculateExtraBedAddOn` + `requiredExtraBedsFor`
// to be adjacent in the same import) intact.
import { deriveRoomTypeCapacityFit } from "@spark-inn/shared";
// Per MRB-02 (2026-08-02, per decision #164): the
// reservation-level idempotency key, imported separately to
// keep the CHD-05 import-ordering guard (which requires
// `calculateExtraBedAddOn` + `requiredExtraBedsFor` to be
// adjacent in the same import) intact. Preallocated
// client-side so a retry-after-uncertain-response uses the
// same `reservationId`; the server's transaction reads it
// first and either replays the original commit (same
// `requestFingerprint`) or returns a 409 (different
// `requestFingerprint`).
import { generateReservationId } from "@spark-inn/shared";
import type { BookingRateBreakdown, BookingRateLine } from "@spark-inn/shared";
// Per BF-29 (booking-flow audit 2026-06-26): replace the
// inline email regex with Zod's `z.string().email()` so the
// validation matches the server-side schema (RFC-ish checks,
// consistent error formatting) and stays in sync with the
// rest of the form-validation surface.
import { z } from "zod";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { Modal } from "../components/Modal";
import { PrimaryButton } from "../components/PrimaryButton";
import { PriceBreakdown } from "../components/PriceBreakdown";
import { StepIndicator } from "../components/StepIndicator";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, getRoomTypeRates, useRoomTypes } from "../hooks/useRoomTypes";
import { useTurnstileToken } from "../hooks/useTurnstileToken";
import { useGuestAuth } from "../context/GuestAuthContext";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
import {
  parseBookingRoomCart,
  rebalanceGuestDistribution,
  serializeBookingRoomCart,
  type BookingRoomCartItem
} from "../utils/bookingRoomCart";

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

function createPrivateUploadFileName(fileName: string) {
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? "";
  return `${crypto.randomUUID()}${extension}`;
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
  // Per MRB-02 (2026-08-02, per decision #164): the
  // reservation-level idempotency key, preallocated client-side
  // for the same reason as `bookingId`. Held in a `useState`
  // lazy init so the same id survives across renders and
  // retry-after-uncertain-response (the user re-tries without
  // reloading the page; the id is reused so the server's
  // reservation transaction either replays the original commit
  // — same `requestFingerprint` — or returns a 409 conflict
  // for a different `requestFingerprint`). Generated via the
  // shared `generateReservationId` helper so the id shape is
  // guaranteed to pass `RESERVATION_ID_REGEX` validation.
  const [reservationId] = useState(() => generateReservationId());

  // Dynamic config states loaded from Firestore
  const [breakfastConfig, setBreakfastConfig] = useState({
    isEnabled: false,
    ratePerPersonPerNight: 250,
    // Per CHD-10 (2026-07-31, per CVQ-01): hotel-wide default for
    // "include children in the breakfast charge". The booking-page
    // toggle inherits this on first paint; the guest can override
    // for the current booking. `true` is the historical default.
    breakfastIncludesChildrenDefault: true
  });
  const [rewardsConfig, setRewardsConfig] = useState<any>(null);
  const [hotelConfig, setHotelConfig] = useState<any>(null);
  const seniorPwdOnlineEnabled = hotelConfig?.seniorPwdOnlineEnabled !== false;

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
  // Per CHD-10 (2026-07-31, per CVQ-01): children (0-11) split out
  // from the total guest count so the breakfast toggle can deduct
  // them from the bill. `numAdults` is derived as `guests - numChildren`
  // (validated to stay ≥ 1). Seed from the `children` URL param so
  // deep links can pre-fill, then default to 0.
  const [numChildren, setNumChildren] = useState(Number(searchParams.get("children") ?? 0));
  const numAdults = Math.max(0, guests - numChildren);
  // The per-booking override for "include children in the breakfast
  // charge". Defaults to the admin default from
  // `settings/breakfastConfig.breakfastIncludesChildrenDefault`.
  // The server snapshots this onto the booking doc — a later admin
  // change does not rewrite existing bills.
  const [breakfastIncludesChildren, setBreakfastIncludesChildren] = useState(
    breakfastConfig.breakfastIncludesChildrenDefault !== false
  );
  // Per EXB-11 (2026-08-04, per decision #186): extra beds
  // are now a per-type user-set value, not a single global
  // counter. The user toggles the count on each room-type
  // card; the cart's per-room `extraBedCount` is the source
  // of truth (mirrored to the URL via `serializeBookingRoomCart`).
  // The single-state shape that this replaces was the old
  // EXB-01 flow that auto-computed the bed count from the
  // overflow rule and silently overrode the user choice.
  // The downstream `selectedTypeExtraBeds` derivation below
  // (and the `totalExtraBeds` sum) replace every read site.
  // Per the room-type booking refactor: Step 1 now shows one card
  // per room type (not per physical room). The guest picks a type;
  // the server auto-assigns a physical room of that type inside
  // the availability transaction.
  const [selectedRoomType, setSelectedRoomType] = useState(searchParams.get("roomType") ?? "");
  const [roomCart, setRoomCart] = useState<BookingRoomCartItem[]>(() => {
    const fromUrl = parseBookingRoomCart(searchParams.get("rooms"));
    return fromUrl.length > 0 ? fromUrl : [];
  });
  
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
  // record so the name, private object path, and local-only preview
  // cannot desync. Anonymous uploads never mint download URLs.
  const [discountIdUpload, setDiscountIdUpload] = useState<{ name: string; path: string; previewUrl: string } | null>(null);
  const [uploadingDiscountId, setUploadingDiscountId] = useState(false);
  const [discountIdUploadError, setDiscountIdUploadError] = useState("");
  const discountIdInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!seniorPwdOnlineEnabled && discountType !== "none") {
      setDiscountType("none");
      clearDiscountIdUpload();
      setDiscountIdUploadError("");
    }
  }, [seniorPwdOnlineEnabled, discountType]);

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
  const [paymentProofUpload, setPaymentProofUpload] = useState<{ name: string; path: string; previewUrl: string } | null>(null);
  const [uploadingPaymentProof, setUploadingPaymentProof] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ title: string; url: string } | null>(null);
  const [paymentProofError, setPaymentProofError] = useState("");

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

  // Per CHD-05 + EXB-03: occupancy is two-dimensional. `maxCapacity`
  // is the adult cap and `maxChildren` is the child cap; a configured
  // extra bed can cover one overflow adult OR child. Filtering by
  // `maxCapacity >= guests` treated every child as an adult and hid
  // valid family configurations.
  const availableRoomTypes = useMemo(
    () =>
      typeAvailability.filter(
        (entry) => entry.availableCount > 0
      ),
    [typeAvailability]
  );
  const maxGuestCapacity = useMemo(
    () =>
      Math.max(1, typeAvailability.reduce(
        (sum, entry) => sum + entry.availableCount * (
          (Number(entry.type.maxCapacity) || 0)
          + (Number(entry.type.maxChildren) || 0)
          + (Number(entry.type.maxExtraBeds) || 0)
        ),
        0
      )),
    [typeAvailability]
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
  const cartDistribution = useMemo(
    () => rebalanceGuestDistribution(roomCart, roomTypes, numAdults, numChildren),
    [roomCart, roomTypes, numAdults, numChildren]
  );
  const distributedRoomCart = cartDistribution.rooms;
  const cartQuantityByType = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const room of distributedRoomCart) {
      quantities.set(room.roomType, (quantities.get(room.roomType) || 0) + 1);
    }
    return quantities;
  }, [distributedRoomCart]);
  const cartHasAvailability = typeAvailability.every((entry) => {
    const quantity = cartQuantityByType.get(entry.type.value) || 0;
    return quantity <= entry.availableCount;
  });
  // Per EXB-11 (2026-08-04, per decision #186): the total
  // extra-bed count across the cart. Replaces the old single
  // `extraBedCount` state — the user now toggles the count
  // per type on the room-type card, and the cart is the
  // source of truth. Used by the Step 2 / Step 3 aside for
  // the price breakdown.
  const totalExtraBeds = useMemo(
    () => distributedRoomCart.reduce((sum, room) => sum + (room.extraBedCount || 0), 0),
    [distributedRoomCart]
  );
  const cartDistributionComplete =
    distributedRoomCart.length > 0
    && cartDistribution.unassignedAdults === 0
    && cartDistribution.unassignedChildren === 0
    && distributedRoomCart.every((room) => room.numAdults >= 1);
  // Per CHD-11 (2026-08-04, per decision #184): the
  // per-room cap is enforced at the submit gate, not the
  // picker. Every room in the cart must fit its per-type cap
  // (with the type's `maxExtraBeds` covering any overflow).
  // The first failing room drives the error message + the
  // "Adjust room" CTA — the CTA scrolls to and highlights
  // the offending room-type card on the right-hand side.
  const cartFitsGroup = distributedRoomCart.every((room) => {
    const type = roomTypes.find((t) => t.value === room.roomType);
    if (!type) return false;
    const overflow = requiredExtraBedsFor({
      numAdults: room.numAdults,
      numChildren: room.numChildren,
      maxCapacity: Number(type.maxCapacity) || 0,
      maxChildren: Number(type.maxChildren) || 0
    });
    return overflow.requiredExtraBeds <= (Number(type.maxExtraBeds) || 0);
  });
  const firstFailingRoom = cartFitsGroup
    ? null
    : distributedRoomCart.find((room) => {
      const type = roomTypes.find((t) => t.value === room.roomType);
      if (!type) return true;
      const overflow = requiredExtraBedsFor({
        numAdults: room.numAdults,
        numChildren: room.numChildren,
        maxCapacity: Number(type.maxCapacity) || 0,
        maxChildren: Number(type.maxChildren) || 0
      });
      return overflow.requiredExtraBeds > (Number(type.maxExtraBeds) || 0);
    });
  const firstFailingType = firstFailingRoom
    ? roomTypes.find((t) => t.value === firstFailingRoom.roomType)
    : null;
  const cartIsReady = cartHasAvailability && cartDistributionComplete && cartFitsGroup;
  const selectedTypeIsAvailable = Boolean(
    selectedTypeEntry
    && availableRoomTypes.some((entry) => entry.type.value === selectedTypeEntry.value)
  );
  // Per W3.6 — pricing + max occupancy live on the room's type.
  const selectedRoomRates = selectedTypeEntry
    ? getRoomTypeRates(roomTypes, selectedTypeEntry.value)
    : null;
  const selectedMaxCapacity = selectedRoomRates?.maxCapacity ?? 0;
  const selectedMaxChildren = Number(selectedTypeEntry?.maxChildren) || 0;
  const selectedMaxExtraBeds = Number(selectedTypeEntry?.maxExtraBeds) || 0;
  const selectedOccupancyOverflow = requiredExtraBedsFor({
    numAdults,
    numChildren,
    maxCapacity: selectedMaxCapacity,
    maxChildren: selectedMaxChildren
  });
  // Per EXB-11 (2026-08-04, per decision #186): the
  // per-type extra-bed count for the currently-selected
  // type, summed across the cart. Used by the aside +
  // `missingExtraBeds` helper. The user-set per-type value
  // lives on each cart room; we sum it for the selected
  // type. (The `missingExtraBeds` value itself is a
  // defensive read; no current call site depends on it —
  // the EXB-11 spec surfaces the constraint through the
  // soft-floor warning on the room-type card and the
  // CHD-11 submit-gate, not through this variable.)
  const selectedTypeExtraBeds = useMemo(() => {
    if (!selectedTypeEntry) return 0;
    return distributedRoomCart
      .filter((room) => room.roomType === selectedTypeEntry.value)
      .reduce((sum, room) => sum + (room.extraBedCount || 0), 0);
  }, [distributedRoomCart, selectedTypeEntry]);
  const missingExtraBeds = Math.max(
    selectedOccupancyOverflow.requiredExtraBeds - selectedTypeExtraBeds,
    0
  );
  // The selected type may use its rollaway-bed allowance for adult
  // or child overflow. Find the highest child split supported for the
  // current total rather than silently stopping at `maxChildren`.
  const selectedMaxSelectableChildren = useMemo(() => {
    if (!selectedTypeEntry) return Math.max(0, guests - 1);
    let highest = 0;
    for (let children = 0; children <= Math.max(0, guests - 1); children += 1) {
      const overflow = requiredExtraBedsFor({
        numAdults: guests - children,
        numChildren: children,
        maxCapacity: Number(selectedTypeEntry.maxCapacity) || 0,
        maxChildren: Number(selectedTypeEntry.maxChildren) || 0
      });
      if (overflow.requiredExtraBeds <= selectedMaxExtraBeds) highest = children;
    }
    return highest;
  }, [guests, selectedMaxExtraBeds, selectedTypeEntry]);
  const hasBreakfast = breakfastConfig.isEnabled && rateChoice === "room-breakfast";
  const breakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || 250) : 0;

  // Calculate room total client-side, incorporating weekend rates (Saturdays and Sundays)
  const roomTotal = useMemo(() => {
    return distributedRoomCart.reduce((sum, room) => {
      const type = roomTypes.find((entry) => entry.value === room.roomType);
      if (!type) return sum;
      return sum + calculateSeasonalAwareRoomTotal({
        checkIn: `${checkIn}T00:00:00Z`,
        checkOut: `${checkOut}T00:00:00Z`,
        roomType: type.value,
        baseRate: Number(type.pricePerNight) || 0,
        weekendRate: Number(type.weekendRate) || 0,
        seasonalRateOverrides
      });
    }, 0);
  }, [distributedRoomCart, roomTypes, checkIn, checkOut, seasonalRateOverrides]);

  const discountPct = discountType === "none" ? 0 : 20;
  // Per CHD-10 (2026-07-31, per CVQ-01): the inline
  // `breakfastRate * guests * nights` pattern now routes through the
  // shared `calculateBreakfastAddOn` helper. When the guest has
  // children and the toggle is off, the helper uses `numAdults`
  // (the cheaper line). The `breakfastIncludesChildren` default
  // (true) matches the historical "children pay the full rate" math.
  const breakfastTotal = distributedRoomCart.reduce((sum, room) => sum + calculateBreakfastAddOn({
    hasBreakfast: breakfastConfig.isEnabled && room.rateChoice === "room-breakfast",
    breakfastRate,
    numGuests: room.numAdults + room.numChildren,
    numAdults: room.numAdults,
    numChildren: room.numChildren,
    numNights: nights,
    breakfastIncludesChildren
  }), 0);
  // Per CHD-10: the effective breakfast occupancy, exposed for
  // the rate-card per-night label. When the toggle is on, this
  // equals `guests`; when off, it equals `numAdults`. Matches
  // the helper's internal `effectiveOccupancy` derivation.
  const effectiveBreakfastOccupancy = numChildren > 0 && !breakfastIncludesChildren
    ? numAdults
    : guests;
  // Per EXB-01 (2026-07-31): the extra-bed add-on term. Reads the
  // rate from the selected room type; nullish / 0 inputs
  // short-circuit to 0 via the helper.
  const extraBedRate = selectedTypeEntry ? Number(selectedTypeEntry.extraBedRate) || 0 : 0;
  const extraBedTotal = distributedRoomCart.reduce((sum, room) => {
    const type = roomTypes.find((entry) => entry.value === room.roomType);
    return sum + calculateExtraBedAddOn({
      extraBedCount: room.extraBedCount,
      extraBedRate: Number(type?.extraBedRate) || 0,
      numNights: nights
    });
  }, 0);
  const subtotal = roomTotal + breakfastTotal + extraBedTotal;

  const voucherDiscount = useMemo(() => {
    if (!voucherApplied) return 0;
    // Per DSC (2026-07-31): the percentage step and the clamped
    // `subtotal − senior` subtraction now route through the shared
    // `calculatePercentDiscount` + `calculateVoucherBase` helpers.
    // Byte-equivalent output: same `Math.round` wrap, same clamp.
    const seniorPwdDiscount = Math.round(calculatePercentDiscount(subtotal, discountPct));
    const voucherBase = calculateVoucherBase(subtotal, seniorPwdDiscount);
    if (voucherDiscountType === "percent") {
      return Math.round(voucherBase * (voucherDiscountValue / 100));
    }
    return Math.min(voucherDiscountValue, voucherBase);
  }, [voucherApplied, voucherDiscountType, voucherDiscountValue, subtotal, discountPct]);

  const seniorPwdDiscount = Math.round(calculatePercentDiscount(subtotal, discountPct));
  const afterSeniorPwd = calculateVoucherBase(subtotal, seniorPwdDiscount);
  const afterVoucher = calculateVoucherBase(afterSeniorPwd, voucherDiscount);
  const memberDiscount = Math.round(calculatePercentDiscount(afterVoucher, memberDiscountPct));
  const total = distributedRoomCart.length > 0
    ? Math.max(afterVoucher - memberDiscount, 0)
    : 0;

  const rateBreakdown = useMemo(() => {
    if (distributedRoomCart.length === 0) return null;
    const cartRoomLines = distributedRoomCart.flatMap((room, index) => {
      const type = roomTypes.find((entry) => entry.value === room.roomType);
      if (!type) return [];
      return calculateTypeRoomBreakdown(type, checkIn, checkOut, seasonalRateOverrides).roomLines.map((line) => ({
        ...line,
        label: distributedRoomCart.length > 1
          ? `${type.label} ${index + 1} — ${line.label}`
          : line.label
      }));
    });
    return buildGuestRateBreakdown({
      roomLines: cartRoomLines,
      roomSubtotal: roomTotal,
      breakfastTotal,
      extraBedTotal,
      discountType,
      discountPct,
      voucherApplied,
      voucherDiscount,
      memberDiscountPct,
      finalTotal: total
    });
  }, [
    distributedRoomCart,
    roomTypes,
    checkIn,
    checkOut,
    seasonalRateOverrides,
    roomTotal,
    breakfastTotal,
    extraBedTotal,
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
    children: String(numChildren),
    roomType: selectedTypeEntry?.value ?? "",
    breakfast: hasBreakfast ? "yes" : "no"
  });
  continueParams.set("rooms", serializeBookingRoomCart(distributedRoomCart));
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
      Number(guestDetails.guestCount) >= 1
      && numAdults >= 1
      && cartIsReady
        ? ""
        : "Choose enough rooms to assign every adult and child, with at least one adult in each room."
  };
  const canContinueToReview =
    Object.values(guestErrors).every((error) => !error) && guestDetails.consent && cartIsReady;
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
    if (roomCart.length === 0 && availableRoomTypes[0]) {
      const defaultType = availableRoomTypes[0].type.value;
      setSelectedRoomType(defaultType);
      setRoomCart([{
        bookingId,
        roomType: defaultType,
        rateChoice,
        numAdults,
        numChildren,
        extraBedCount: 0
      }]);
      return;
    }

    if (!roomCart.some((room) => room.roomType === selectedRoomType) && roomCart[0]) {
      setSelectedRoomType(roomCart[0].roomType);
      setRateChoice(roomCart[0].rateChoice);
    }
  }, [
    availableRoomTypes,
    bookingId,
    numAdults,
    numChildren,
    rateChoice,
    roomCart,
    selectedRoomType
  ]);

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
    const safeChildren = Math.min(numChildren, Math.max(0, safeGuests - 1));
    setGuests(safeGuests);
    setNumChildren(safeChildren);
    setGuestDetails((current) => ({
      ...current,
      guestCount: String(safeGuests)
    }));
    const next = new URLSearchParams(searchParams);
    next.set("checkIn", checkIn);
    next.set("checkOut", checkOut);
    next.set("guests", String(safeGuests));
    next.set("children", String(safeChildren));
    if (selectedRoomType) next.set("roomType", selectedRoomType);
    setSearchParams(next, { replace: true });
  }

  function updateChildren(nextChildren: number) {
    const safeChildren = Math.min(
      Math.max(nextChildren, 0),
      selectedMaxSelectableChildren,
      Math.max(0, guests - 1)
    );
    setNumChildren(safeChildren);
    const next = new URLSearchParams(searchParams);
    next.set("children", String(safeChildren));
    next.set("guests", String(guests));
    setSearchParams(next, { replace: true });
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

  function clearDiscountIdUpload() {
    setDiscountIdUpload((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }

  function clearPaymentProofUpload() {
    setPaymentProofUpload((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }

  function selectRoomType(typeValue: string, nextRateChoice: RateChoice) {
    setSelectedRoomType(typeValue);
    setRateChoice(nextRateChoice);
    setRoomCart((current) => {
      const hasType = current.some((room) => room.roomType === typeValue);
      const next = hasType
        ? current.map((room) => room.roomType === typeValue
            ? { ...room, rateChoice: nextRateChoice }
            : room)
        : [
            ...current,
            {
              bookingId: doc(collection(db, "bookings")).id,
              roomType: typeValue,
              rateChoice: nextRateChoice,
              numAdults: 0,
              numChildren: 0,
              extraBedCount: 0
            }
          ];
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("rooms", serializeBookingRoomCart(next));
      setSearchParams(nextParams, { replace: true });
      return next;
    });
  }

  function updateRoomQuantity(typeValue: string, nextQuantity: number, maxQuantity: number) {
    const safeQuantity = Math.min(Math.max(Math.floor(nextQuantity), 0), maxQuantity);
    setSelectedRoomType(typeValue);
    setRoomCart((current) => {
      const matching = current.filter((room) => room.roomType === typeValue);
      const other = current.filter((room) => room.roomType !== typeValue);
      const templateChoice = matching[0]?.rateChoice ?? rateChoice;
      const resized = Array.from({ length: safeQuantity }, (_, index) =>
        matching[index] ?? {
          bookingId: doc(collection(db, "bookings")).id,
          roomType: typeValue,
          rateChoice: templateChoice,
          numAdults: 0,
          numChildren: 0,
          extraBedCount: 0
        }
      );
      const next = [...other, ...resized];
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("rooms", serializeBookingRoomCart(next));
      nextParams.set("roomType", typeValue);
      setSearchParams(nextParams, { replace: true });
      return next;
    });
  }

  // Per EXB-11 (2026-08-04, per decision #186): the per-type
  // extra-bed counter. Mirrors the user's pick onto every
  // room of that type in the cart. The cap is the type's
  // `maxExtraBeds`; the soft floor is `max(0, requiredExtraBeds)`
  // (the per-room overflow required to fit the group) — the
  // caller is responsible for disabling the `[−]` button at
  // the soft floor (the soft floor is exposed via
  // `requiredExtraBedsFor` on the caller side). The function
  // only enforces the type cap here, not the soft floor, so
  // the caller can keep a "tried to go below the soft floor"
  // affordance without this function silently ignoring the
  // user's intent. URL state rides on the cart (via
  // `serializeBookingRoomCart`), so the per-room count is
  // already in `rooms=` — no separate `extraBeds=` URL param
  // is needed.
  function updateExtraBedCount(typeValue: string, nextCount: number, maxCount: number) {
    const safeCount = Math.min(Math.max(Math.floor(nextCount), 0), Math.max(0, Math.floor(maxCount)));
    setRoomCart((current) => {
      if (!current.some((room) => room.roomType === typeValue)) return current;
      const next = current.map((room) =>
        room.roomType === typeValue
          ? { ...room, extraBedCount: safeCount }
          : room
      );
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("rooms", serializeBookingRoomCart(next));
      setSearchParams(nextParams, { replace: true });
      return next;
    });
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
      clearDiscountIdUpload();
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
        const safeFileName = createPrivateUploadFileName(compressed.file.name);
        const storageRef = ref(storage, `bookings/${bookingId}/discount-id/${safeFileName}`);
        const uploadResult = await uploadBytes(storageRef, compressed.file);
        const previewUrl = URL.createObjectURL(compressed.file);
        // Per BF-30: single state record so the name + url
        // are always written together (no desync race).
        setDiscountIdUpload({ name: file.name, path: uploadResult.ref.fullPath, previewUrl });
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
        setPaymentProofError(validationError);
        e.target.value = "";
        return;
      }
      setUploadingPaymentProof(true);
      setPaymentProofError("");
      try {
        const compressed = await compressImageFile(file);
        const safeFileName = createPrivateUploadFileName(compressed.file.name);
        const storageRef = ref(storage, `bookings/${bookingId}/payment-proof/${safeFileName}`);
        const uploadResult = await uploadBytes(storageRef, compressed.file);
        const previewUrl = URL.createObjectURL(compressed.file);
        // Per BF-30: single state record.
        setPaymentProofUpload({ name: file.name, path: uploadResult.ref.fullPath, previewUrl });
      } catch (err) {
        console.error("Payment proof upload failed:", err);
        setPaymentProofError("Receipt upload failed. Please check your connection and try again.");
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

    // Per 2026-07-24 (refactor/unify-payment-reference-fields):
    // guests no longer enter a payment reference number at booking
    // time. Staff populates `transactionReference` on the relevant
    // payment ledger entry (via Record Payment / Verify & Record
    // Payment) when they confirm the payment. The
    // `requireReferenceNumber` flag on each payment method is now
    // enforced only on the staff verify endpoint.

    try {
      const firstRoomSelection = distributedRoomCart[0];
      if (!firstRoomSelection || !cartIsReady) {
        throw new Error("Please return to Step 1 and assign every guest to an available room.");
      }
      const response = await fetch("/api/bookings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          // Per MRB-02 (2026-08-02, per decision #164): the
          // client-preallocated reservation id. The server
          // uses this as the canonical idempotency key for
          // the create transaction (read the reservation
          // header first; same id + same request fingerprint
          // → replay; same id + different request → 409).
          // When absent (legacy callers) the server
          // auto-mints a UUIDv4 — see
          // `handleCreateBooking` in
          // `guest-app/server/handlers/bookings.ts`.
          reservationId,
          roomType: firstRoomSelection.roomType,
          roomCount: distributedRoomCart.length,
          roomSelections: distributedRoomCart.map((room, index) => ({
            bookingId: index === 0 ? bookingId : room.bookingId,
            roomType: room.roomType,
            numAdults: room.numAdults,
            numChildren: room.numChildren,
            extraBedCount: room.extraBedCount,
            hasBreakfast: breakfastConfig.isEnabled && room.rateChoice === "room-breakfast",
            breakfastIncludesChildren
          })),
          checkIn,
          checkOut,
          // Per BI-09 (booking-intercom audit 2026-07-06): the
          // Step 2 "Number of guests" field is the single source
          // of truth once the guest has touched it. Mirror the
          // corporate page (`CorporateBookingPage.tsx:619`) and
          // prefer the parsed Step 2 value, falling back to the
          // Step 1 stepper for guests who never reached Step 2.
          guests: Number(guestDetails.guestCount) || guests,
          hasBreakfast: breakfastConfig.isEnabled && firstRoomSelection.rateChoice === "room-breakfast",
          // Per CHD-10 (2026-07-31, per CVQ-01): the per-booking
          // override for "include children in the breakfast
          // charge". The server snapshots this onto the booking
          // doc; when undefined (older clients), the admin default
          // from `settings/breakfastConfig.breakfastIncludesChildrenDefault`
          // applies.
          breakfastIncludesChildren,
          // Per CHD-10: the adult/child split. `numAdults` is
          // derived from `guests - numChildren` in the client.
          // The server uses these to compute the breakfast total
          // when the toggle is off; otherwise it falls back to
          // `numGuests` (the historical path).
          numAdults: firstRoomSelection.numAdults,
          numChildren: firstRoomSelection.numChildren,
          // Per EXB-01 (2026-07-31): extra-bed count. The server
          // validates against the room type's `maxExtraBeds` and
          // snapshots the rate onto the booking doc.
          extraBedCount: firstRoomSelection.extraBedCount,
          guestDetails: {
            firstName: guestDetails.firstName,
            lastName: guestDetails.lastName,
            email: guestDetails.email,
            phone: guestDetails.phone,
            requests: guestDetails.requests,
            consent: termsConsent
          },
          discountType: discountType === "none" ? "" : discountType,
          discountIdPhotoUrl: null,
          discountIdPhotoPath: discountIdUpload?.path ?? null,
          voucherCode: voucherApplied ? voucherCode : "",
          paymentMethod,
          paymentProofUrl: null,
          paymentProofPath: paymentProofUpload?.path ?? null,
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
        bookingRef: result.data.reservationRef || result.data.bookingRef,
        roomType: result.data.roomType || selectedTypeEntry?.value || "",
        roomId: result.data.roomId || "",
        roomNumber: result.data.roomNumber || "",
        checkIn,
        checkOut,
        guests: String(confirmedGuests),
        paymentMethod,
        total: String(serverTotal ?? total)
      });
      if (Array.isArray(result.data?.rooms)) {
        confirmParams.set("rooms", encodeURIComponent(JSON.stringify(result.data.rooms)));
      }
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
      return `/book?${continueParams.toString()}`;
    }
    if (isGuestDetailsStep) {
      const step1Params = new URLSearchParams(continueParams);
      step1Params.delete("step");
      return `/book?${step1Params.toString()}`;
    }
    return "/rooms";
  };

  const bookingShell = (content: React.ReactNode) => (
    <main className="min-h-screen bg-gray-50 pb-32 font-body text-gray-900">
      <BookingHeader backTo={getBackToPath()} />
      {content}
      <Modal
        title={imagePreview?.title ?? "Image preview"}
        open={!!imagePreview}
        onClose={() => setImagePreview(null)}
        className="max-w-3xl"
      >
        {imagePreview ? (
          <img
            src={imagePreview.url}
            alt={imagePreview.title}
            className="max-h-[72vh] w-full rounded-lg object-contain"
          />
        ) : null}
      </Modal>
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
                id="firstName"
                name="firstName"
                autoComplete="given-name"
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
                id="lastName"
                name="lastName"
                autoComplete="family-name"
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
                id="email"
                name="email"
                autoComplete="email"
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
                id="phone"
                name="phone"
                autoComplete="tel"
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
                id="guestCount"
                name="guestCount"
              />
              <label htmlFor="requests" className="grid gap-2 text-sm font-medium text-gray-700">
                Special requests
                <span className="relative block">
                  <MessageSquareText size={17} className="absolute left-3 top-3 text-primary" />
                  <textarea
                    id="requests"
                    name="requests"
                    className="min-h-28 w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    onChange={(event) => updateGuestDetail("requests", event.target.value)}
                    placeholder="Late check-in, dietary notes, room preferences..."
                    value={guestDetails.requests}
                  />
                </span>
              </label>
            </motion.div>

            <motion.div className="mt-6 rounded-card bg-primary-light p-4" variants={staggerChild}>
              <label htmlFor="consentStep2" className="flex items-start gap-3 text-sm leading-6 text-gray-700 cursor-pointer">
                <input
                  id="consentStep2"
                  name="consentStep2"
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
            // Per CHD-10 (2026-07-31, per CVQ-01): the adult/child
            // split and the "include children" toggle thread
            // through to the aside.
            numAdults={numAdults}
            numChildren={numChildren}
            breakfastIncludesChildren={breakfastIncludesChildren}
            setBreakfastIncludesChildren={setBreakfastIncludesChildren}
            // Per EXB-11 (2026-08-04, per decision #186): the
            // per-cart total extra-bed count (sum of each
            // room's `extraBedCount`). Replaces the old single
            // `extraBedCount` state — the user now toggles the
            // count per type on the room-type card, and the
            // cart is the source of truth.
            extraBedCount={totalExtraBeds}
            extraBedRate={extraBedRate}
            typeLabel={distributedRoomCart.length > 1 ? `${distributedRoomCart.length} rooms` : (selectedTypeEntry?.label ?? "")}
            roomSummary={distributedRoomCart.map((room, index) => ({
              label: roomTypes.find((type) => type.value === room.roomType)?.label || room.roomType,
              position: index + 1,
              numAdults: room.numAdults,
              numChildren: room.numChildren,
              extraBedCount: room.extraBedCount,
              hasBreakfast: breakfastConfig.isEnabled && room.rateChoice === "room-breakfast"
            }))}
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
    const canConfirm = termsConsent && !isIdUploadRequired && !isPaymentProofRequired && cartIsReady && Boolean(turnstileToken);

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
                  id="voucherCode"
                  name="voucherCode"
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
              <p className="mt-1 text-sm text-gray-600">
                {seniorPwdOnlineEnabled
                  ? "Select if you are eligible for government-mandated discounts. A valid ID must be uploaded."
                  : "Senior/PWD online claims are currently unavailable. Eligible guests may present a valid ID at check-in to receive the mandated discount."}
              </p>
              
              {seniorPwdOnlineEnabled && <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
              </div>}

              {seniorPwdOnlineEnabled && discountType !== "none" && (
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
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setImagePreview({ title: discountIdUpload.name, url: discountIdUpload.previewUrl })}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              clearDiscountIdUpload();
                              setDiscountIdUploadError("");
                              resetDiscountIdInput();
                            }}
                            className="text-xs font-semibold text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center hover:bg-gray-100 transition-colors">
                        <UploadCloud size={28} className="text-gray-400" />
                        <span className="mt-2 text-sm font-semibold text-gray-700">
                          {uploadingDiscountId ? "Uploading ID Card..." : "Click to upload ID photo"}
                        </span>
                        <span className="mt-0.5 text-xs text-gray-500">Supports JPG, PNG, WEBP up to 5MB</span>
                        <input
                          id="discountIdFile"
                          name="discountIdFile"
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
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setImagePreview({ title: paymentProofUpload.name, url: paymentProofUpload.previewUrl })}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              clearPaymentProofUpload();
                            }}
                            className="text-xs font-semibold text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center hover:bg-gray-100 transition-colors">
                        <UploadCloud size={28} className="text-gray-400" />
                        <span className="mt-2 text-sm font-semibold text-gray-700">
                          {uploadingPaymentProof ? "Uploading Receipt..." : "Click to upload receipt photo"}
                        </span>
                        <span className="mt-0.5 text-xs text-gray-500">Supports JPEG, PNG, WEBP up to 5MB</span>
                        <input
                          id="paymentProofFile"
                          name="paymentProofFile"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handlePaymentProofChange}
                          className="sr-only"
                          disabled={uploadingPaymentProof}
                        />
                      </label>
                    )}
                  </div>
                  {paymentProofError && (
                    <p className="mt-2 text-xs font-semibold text-red-600">{paymentProofError}</p>
                  )}
                </div>
              )}

            {/* Reference Number Input — removed 2026-07-24 (refactor/unify-payment-reference-fields).
                Staff populates `transactionReference` on the relevant payment ledger entry
                when confirming payment. The guest no longer enters a reference at booking time. */}

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
              <label htmlFor="termsConsent" className="flex items-start gap-3 cursor-pointer text-sm leading-6 text-gray-700">
                <input
                  id="termsConsent"
                  name="termsConsent"
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
            // Per CHD-10 (2026-07-31, per CVQ-01): the adult/child
            // split and the "include children" toggle thread
            // through to the aside.
            numAdults={numAdults}
            numChildren={numChildren}
            breakfastIncludesChildren={breakfastIncludesChildren}
            setBreakfastIncludesChildren={setBreakfastIncludesChildren}
            // Per EXB-11 (2026-08-04, per decision #186): the
            // per-cart total extra-bed count (sum of each
            // room's `extraBedCount`). Replaces the old single
            // `extraBedCount` state — the user now toggles the
            // count per type on the room-type card, and the
            // cart is the source of truth.
            extraBedCount={totalExtraBeds}
            extraBedRate={extraBedRate}
            typeLabel={distributedRoomCart.length > 1 ? `${distributedRoomCart.length} rooms` : (selectedTypeEntry?.label ?? "")}
            roomSummary={distributedRoomCart.map((room, index) => ({
              label: roomTypes.find((type) => type.value === room.roomType)?.label || room.roomType,
              position: index + 1,
              numAdults: room.numAdults,
              numChildren: room.numChildren,
              extraBedCount: room.extraBedCount,
              hasBreakfast: breakfastConfig.isEnabled && room.rateChoice === "room-breakfast"
            }))}
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
                    aria-label="Remove one guest"
                    className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={guests <= 1}
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
                    aria-label="Add one guest"
                    className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={guests >= maxGuestCapacity}
                    type="button"
                    onClick={() => updateGuests(guests + 1)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </label>

              {/* Per CHD-11 (2026-08-04, per decision #184): the
                  children picker is no longer bounded by the
                  per-type `maxChildren` cap. The hard cap was a
                  dead-end at the exploration stage — the guest
                  is still choosing room type and/or quantity,
                  and the cap belongs at the commit surface
                  (the Step 1 → Step 2 submit gate + the
                  room-type card's Fits/Tight/Doesn't fit
                  indicator), not at the picker. Soft cap is
                  `MIN(10, guests - 1)` — a sanity guard, not a
                  domain constraint. The `guests - 1` floor
                  preserves the existing "at least one adult"
                  invariant. */}
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Children (0–11)
                <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
                  <button
                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    aria-label="Decrease children count"
                    onClick={() => updateChildren(numChildren - 1)}
                    disabled={numChildren <= 0}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    {numChildren} {numChildren === 1 ? "child" : "children"}
                    <span className="text-xs text-gray-500">({numAdults} adult{numAdults === 1 ? "" : "s"})</span>
                  </span>
                  <button
                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    aria-label="Increase children count"
                    aria-describedby="children-cap-help"
                    onClick={() => updateChildren(numChildren + 1)}
                    // Soft cap: MIN(10, guests - 1). The 10 is a
                    // "stop the + at 100" sanity guard, not a
                    // capacity rule. The `guests - 1` floor is
                    // the existing "at least one adult"
                    // invariant (preserved from the pre-CHD-11
                    // shape).
                    disabled={numChildren >= Math.min(10, Math.max(0, guests - 1))}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <span
                  id="children-cap-help"
                  className="text-xs font-normal leading-relaxed text-gray-500"
                  aria-live="polite"
                >
                  {selectedTypeEntry ? (
                    <>
                      This room includes space for {selectedMaxChildren} child{selectedMaxChildren === 1 ? "" : "ren"}.
                      {" "}Children stay free of the room charge.
                      {selectedMaxSelectableChildren > selectedMaxChildren
                        ? ` Up to ${selectedMaxSelectableChildren} can fit when extra beds cover the overflow.`
                        : ""}
                      {/* Per CHD-11: replace the dead-end
                          "you have reached this room type's
                          limit" tail with a forward-looking
                          nudge. The cap belongs at the submit
                          gate + the room-type card, not here. */}
                      {numChildren >= Math.min(10, Math.max(0, guests - 1))
                        ? " Pick a room type that fits your group, or add a second room."
                        : ""}
                    </>
                  ) : (
                    <>Choose a room type to see its child limit. Children stay free of the room charge.</>
                  )}
                </span>
              </label>

              {/* Per CHD-12 (2026-08-04, per decision #185):
                  cart-style summary that lists one line per
                  distinct room type, with the per-type
                  occupancy inline. Replaces the legacy
                  per-room "Guest distribution" list whose
                  "Room 1 / Room 2 / Room N" naming was
                  positional and meaningless, and whose
                  per-room occupancy was an auto-rebalance
                  result (the user didn't choose it). The
                  cart summary is the read surface; the
                  room-type card is the action surface — the
                  per-type Fits / Tight / Doesn't fit chip
                  (per CHD-11) is wired below on each card. */}
              <div className="rounded-card border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-950">Your cart</p>
                {distributedRoomCart.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {(() => {
                      // Group distributedRoomCart by roomType.
                      // Per-type: quantity + sum(numAdults) +
                      // sum(numChildren) + sum(extraBedCount).
                      // Re-derives the per-type capacity
                      // indicator from the same helper the
                      // room-type card uses (per CHD-11 +
                      // CHD-12 composition).
                      const byType = new Map<string, { quantity: number; adults: number; children: number; extraBeds: number; label: string }>();
                      for (const room of distributedRoomCart) {
                        const entry = byType.get(room.roomType) || { quantity: 0, adults: 0, children: 0, extraBeds: 0, label: "" };
                        const type = roomTypes.find((t) => t.value === room.roomType);
                        entry.quantity += 1;
                        entry.adults += room.numAdults;
                        entry.children += room.numChildren;
                        entry.extraBeds += room.extraBedCount || 0;
                        if (!entry.label && type) entry.label = type.label;
                        byType.set(room.roomType, entry);
                      }
                      return Array.from(byType.entries()).map(([roomType, agg]) => {
                        const fit = deriveRoomTypeCapacityFit({
                          type: roomTypes.find((t) => t.value === roomType) || { maxCapacity: 0, maxChildren: 0, maxExtraBeds: 0 },
                          numAdults: agg.adults,
                          numChildren: agg.children,
                          currentCartCount: agg.quantity
                        });
                        const fitChip =
                          fit.state === "fits"
                            ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Fits</span>
                            : fit.state === "tight"
                              ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Tight</span>
                              : <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">Doesn't fit</span>;
                        return (
                          <div key={roomType} className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
                            <span className="flex-1">
                              <span className="block font-semibold text-gray-900">
                                {agg.quantity}× {agg.label || roomType} {fitChip}
                              </span>
                              {agg.adults} adult{agg.adults === 1 ? "" : "s"}{agg.children > 0 ? ` · ${agg.children} child${agg.children === 1 ? "" : "ren"}` : ""}
                            </span>
                            {agg.extraBeds > 0 ? (
                              <span className="rounded-full bg-primary-light px-2 py-1 font-semibold text-primary">
                                {agg.extraBeds} extra bed{agg.extraBeds === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">Add at least one room to begin.</p>
                )}
                {!cartDistributionComplete ? (
                  <p className="mt-3 text-xs font-medium text-amber-700" role="status" aria-live="polite">
                    Add enough rooms to place every guest. Each room must include at least one adult.
                  </p>
                ) : null}
              </div>

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
                const typeQuantity = cartQuantityByType.get(type.value) || 0;
                const selectedTypeRooms = distributedRoomCart.filter((room) => room.roomType === type.value);
                const isSelected = typeQuantity > 0;
                const selectedTypeRateChoice = selectedTypeRooms[0]?.rateChoice ?? rateChoice;
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
                const roomLines = typeRoomBreakdown.roomLines;
                // Per WRV-01 (2026-08-01): the rate panel must show whenever
                // any line is non-regular, not only when there is more than
                // one line. A Saturday→Sunday weekend-only stay produces a
                // single line, and that single line is the one the headline
                // "From {base rate}" silently misleads the guest about.
                const isSingleSource = roomLines.length === 1;
                const hasNonRegularRate = roomLines.some((line) => line.source !== "regular");
                const isMultiSource = roomLines.length > 1;
                // Per WRV-02: option labels show the actual nightly amount
                // for a one-source stay, and prefix "From" for a multi-source
                // stay so the option price matches the breakdown + exact
                // total. Fully regular stays fall through with no prefix
                // (the existing "no From" path stays correct for them).
                const singleSourceRate = isSingleSource ? roomLines[0].nightlyRate : null;
                const optionNightlyRate = singleSourceRate ?? typePricePerNight;
                const optionRatePrefix = isMultiSource ? "From " : "";
                const roomOnlyTotal = calculateBookingTotal({
                  ratePerNight: typePricePerNight,
                  numNights: nights,
                  roomTotal: typeRoomBreakdown.roomSubtotal
                });
                const previewChildren = selectedTypeRooms[0]?.numChildren
                  ?? Math.min(numChildren, type.maxChildren ?? 0, Math.max(typeMaxCapacity - 1, 0));
                const previewAdults = selectedTypeRooms[0]?.numAdults
                  ?? Math.min(Math.max(numAdults, 1), Math.max(typeMaxCapacity - previewChildren, 1));
                const previewBreakfastOccupancy = breakfastIncludesChildren
                  ? previewAdults + previewChildren
                  : previewAdults;
                const breakfastOptionTotal = roomOnlyTotal + calculateBreakfastAddOn({
                  hasBreakfast: true,
                  breakfastRate: liveBreakfastRate,
                  numGuests: previewAdults + previewChildren,
                  numAdults: previewAdults,
                  numChildren: previewChildren,
                  numNights: nights,
                  breakfastIncludesChildren
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
	                            Up to {typeMaxCapacity} adult{typeMaxCapacity === 1 ? "" : "s"} +{" "}
	                            {Number(type.maxChildren) || 0} child{(Number(type.maxChildren) || 0) === 1 ? "" : "ren"}
	                          </span>
	                          {Number(type.maxExtraBeds) > 0 ? (
	                            <span className="flex items-center gap-2">
	                              <Plus size={16} className="text-primary" />
	                              Up to {type.maxExtraBeds} extra bed{Number(type.maxExtraBeds) === 1 ? "" : "s"}
	                            </span>
	                          ) : null}
                          <span className="flex items-center gap-2">
                            <CalendarDays size={16} className="text-primary" />
                            {nights} {nights === 1 ? "night" : "nights"}
                          </span>
                        </div>

                        {/* Per CHD-11 (2026-08-04, per decision #184):
                            the per-type Fits / Tight / Doesn't fit
                            capacity indicator. Drives off
                            `deriveRoomTypeCapacityFit` against
                            the current group size + the current
                            cart count of this type. The card stays
                            clickable in all three states — the
                            indicator is a derived view, not a
                            gating control. The same derivation
                            powers the cart-line chip in the CHD-12
                            cart summary above (single helper,
                            two surfaces). The "You'd need N of
                            [type]" callout fires when the cart is
                            short (roomsNeeded > currentCartCount),
                            the natural nudge for the user to add a
                            room of this type. */}
                        {(() => {
                          const fit = deriveRoomTypeCapacityFit({
                            type,
                            numAdults,
                            numChildren,
                            currentCartCount: typeQuantity
                          });
                          const chip =
                            fit.state === "fits"
                              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700" data-testid={`room-type-fit-${type.value}`}>Fits your group</span>
                              : fit.state === "tight"
                                ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700" data-testid={`room-type-fit-${type.value}`}>Tight — at the cap</span>
                                : <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700" data-testid={`room-type-fit-${type.value}`}>Doesn't fit your group</span>;
                          const needMore = fit.roomsNeeded > typeQuantity;
                          return (
                            <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
                              {chip}
                              {needMore ? (
                                <span className="text-xs font-medium text-amber-700" data-testid={`room-type-rooms-needed-${type.value}`}>
                                  You&apos;d need {fit.roomsNeeded} of {type.label} for your group.
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}

                        {/* Per EXB-11 (2026-08-04, per decision
                            #186): the per-type "Extras" sub-section.
                            Surfaces the extra-bed count as a
                            user-controlled 0..maxExtraBeds counter
                            on each room-type card, with the
                            per-bed-per-night rate + stay total
                            inline, and a soft-floor warning when
                            the type's `maxExtraBeds` cap is below
                            the per-room overflow the group needs.
                            The user is in control — the soft floor
                            is enforced via the `[−]` button being
                            disabled (not by auto-setting the
                            count), and the submit gate (per CHD-11)
                            catches the over-cap case at Step 1 →
                            Step 2. Hidden entirely when
                            `maxExtraBeds === 0` per the spec's
                            "no extra bed" edge case. */}
                        {(() => {
                          const typeMaxExtraBeds = Number(type.maxExtraBeds) || 0;
                          if (typeMaxExtraBeds === 0) return null;
                          // All rooms of this type share the
                          // same per-type count (the toggle
                          // is per-type, not per-room — see the
                          // spec's "per-type vs per-room" edge
                          // case). `updateExtraBedCount` mirrors
                          // the user's pick onto every room.
                          const userExtraBeds = selectedTypeRooms[0]?.extraBedCount ?? 0;
                          const typeExtraBedRate = Number(type.extraBedRate) || 0;
                          // The per-room overflow for this type
                          // against the current group. The
                          // soft floor is `requiredExtraBeds`
                          // (the per-room count the group needs
                          // to fit without over-cap). When the
                          // type's `maxExtraBeds` is below this,
                          // the type cannot satisfy the group
                          // and the warning fires.
                          const perTypeOverflow = requiredExtraBedsFor({
                            numAdults,
                            numChildren,
                            maxCapacity: Number(type.maxCapacity) || 0,
                            maxChildren: Number(type.maxChildren) || 0
                          });
                          const softFloor = Math.max(0, perTypeOverflow.requiredExtraBeds);
                          const overCap = softFloor > typeMaxExtraBeds;
                          // The rate is only meaningful when the
                          // user has at least one room of this
                          // type in the cart (the counter has
                          // nothing to multiply against when
                          // `typeQuantity === 0`). The
                          // disabled-when-zero-rows state on the
                          // counter buttons keeps the UX honest.
                          const stayTotal = userExtraBeds * typeExtraBedRate * nights;
                          return (
                            <div
                              className="mt-4 grid gap-2"
                              aria-label={`${type.label} extras`}
                              data-testid={`extras-stepper-${type.value}`}
                            >
                              <div className="flex min-h-14 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4">
                                <span>
                                  <span className="block text-sm font-semibold text-gray-950">Extra beds</span>
                                  <span className="block text-xs text-gray-500">
                                    {typeQuantity > 0
                                      ? `${formatPrice(typeExtraBedRate)} / bed / night`
                                      : "Add at least one room to set extra beds"}
                                  </span>
                                </span>
                                <span className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    aria-label={`Remove one extra bed from ${type.label}`}
                                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-gray-700 ring-1 ring-gray-200 transition hover:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                                    // Disabled at the soft floor
                                    // (`userExtraBeds <= softFloor`)
                                    // and when there are no rooms
                                    // of this type to mirror the
                                    // count onto.
                                    disabled={typeQuantity === 0 || userExtraBeds <= softFloor}
                                    onClick={() => updateExtraBedCount(type.value, userExtraBeds - 1, typeMaxExtraBeds)}
                                  >
                                    <Minus size={16} />
                                  </button>
                                  <span
                                    className="min-w-8 text-center text-lg font-semibold text-gray-950"
                                    aria-live="polite"
                                    data-testid={`extras-count-${type.value}`}
                                  >
                                    {userExtraBeds}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`Add one extra bed to ${type.label}`}
                                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-gray-700 ring-1 ring-gray-200 transition hover:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                                    disabled={typeQuantity === 0 || userExtraBeds >= typeMaxExtraBeds}
                                    onClick={() => updateExtraBedCount(type.value, userExtraBeds + 1, typeMaxExtraBeds)}
                                  >
                                    <Plus size={16} />
                                  </button>
                                </span>
                              </div>
                              {/* Stay total: hidden when the
                                  count is 0 (no noise) per the
                                  spec's "What the toggle shows"
                                  section. */}
                              {typeQuantity > 0 && userExtraBeds > 0 ? (
                                <p
                                  className="text-xs text-gray-600"
                                  data-testid={`extras-stay-total-${type.value}`}
                                >
                                  {formatPrice(stayTotal)} for {nights} {nights === 1 ? "night" : "nights"}
                                </p>
                              ) : null}
                              {/* Soft-floor warning: fires when
                                  the type's `maxExtraBeds` cap
                                  cannot cover the per-room
                                  overflow. The submit gate
                                  (per CHD-11) catches the
                                  over-cap case at Step 1 → Step
                                  2; this warning is the inline
                                  nudge. Per the spec, the
                                  message is "Room needs N extra
                                  beds to fit your group. You can
                                  add up to N here." (the second
                                  N is the cap, the first is the
                                  soft floor). */}
                              {typeQuantity > 0 && overCap ? (
                                <p
                                  className="rounded-lg bg-amber-50 p-3 text-xs font-medium text-amber-700"
                                  data-testid={`extras-soft-floor-warning-${type.value}`}
                                  role="status"
                                >
                                  {type.label} needs {softFloor} extra bed{softFloor === 1 ? "" : "s"} to fit your group. You can add up to {typeMaxExtraBeds} here.
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}

                        <div className="mt-6 grid gap-3">
                          <div className="flex min-h-14 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4">
                            <span>
                              <span className="block text-sm font-semibold text-gray-950">Rooms</span>
                              <span className="block text-xs text-gray-500">Up to {entry.availableCount} available</span>
                            </span>
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Remove one ${type.label} room`}
                                className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-gray-700 ring-1 ring-gray-200 transition hover:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={typeQuantity === 0}
                                onClick={() => updateRoomQuantity(type.value, typeQuantity - 1, entry.availableCount)}
                              >
                                <Minus size={16} />
                              </button>
                              <span className="min-w-8 text-center text-lg font-semibold text-gray-950" aria-live="polite">
                                {typeQuantity}
                              </span>
                              <button
                                type="button"
                                aria-label={`Add one ${type.label} room`}
                                className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-gray-700 ring-1 ring-gray-200 transition hover:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={typeQuantity >= entry.availableCount}
                                onClick={() => updateRoomQuantity(type.value, typeQuantity + 1, entry.availableCount)}
                              >
                                <Plus size={16} />
                              </button>
                            </span>
                          </div>
                          <RateOption
                            active={isSelected && selectedTypeRateChoice === "room-only"}
                            label="Room Only"
                            helper="Simple stay, flexible payment at the hotel"
                            // Per WRV-02: the option price matches the
                            // selected stay — the single source's nightly
                            // amount for a one-source stay, or a "From"
                            // prefix for a multi-source stay.
                            priceLabel={`${optionRatePrefix}${formatPrice(optionNightlyRate)} / night`}
                            totalLabel={`${formatPrice(roomOnlyTotal)} total`}
                            onSelect={() => selectRoomType(type.value, "room-only")}
                          />
                          {breakfastConfig.isEnabled ? (
                            <RateOption
                              active={isSelected && selectedTypeRateChoice === "room-breakfast"}
                              label="Room + Breakfast"
                              helper={
                                numChildren > 0 && !breakfastIncludesChildren
                                  ? `Includes daily local breakfast for ${numAdults} adult${numAdults === 1 ? "" : "s"} (children excluded)`
                                  : "Includes daily local breakfast for selected guests"
                              }
                              // Per BF-26: live rate + (per-CHD-10) the
                              // effective breakfast occupancy. Per WRV-02:
                              // option price tracks the selected stay.
                              priceLabel={`${optionRatePrefix}${formatPrice(optionNightlyRate + liveBreakfastRate * previewBreakfastOccupancy)} / night`}
                              totalLabel={`${formatPrice(breakfastOptionTotal)} per room`}
                              onSelect={() => selectRoomType(type.value, "room-breakfast")}
                            />
                          ) : null}
                        </div>
                        {hasNonRegularRate ? (
                          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                            {isSingleSource ? (
                              // Per WRV-01: a single-source stay (e.g.
                              // Saturday→Sunday weekend-only) renders a
                              // single line — no "mixed nightly rates"
                              // claim would be true here. The line item
                              // is the panel.
                              <div key={`${type.value}-${roomLines[0].source}-0`} className="flex justify-between gap-3">
                                <span className="font-semibold text-gray-800">{roomLines[0].label}: {roomLines[0].nights} x {formatPrice(roomLines[0].nightlyRate)}</span>
                                <span className="font-semibold text-gray-900">{formatPrice(roomLines[0].subtotal)}</span>
                              </div>
                            ) : (
                              <>
                                <p className="font-semibold text-gray-800">This stay uses mixed nightly rates.</p>
                                <div className="mt-2 space-y-1">
                                  {roomLines.map((line, lineIndex) => (
                                    <div key={`${type.value}-${line.source}-${lineIndex}`} className="flex justify-between gap-3">
                                      <span>{line.label}: {line.nights} x {formatPrice(line.nightlyRate)}</span>
                                      <span className="font-semibold text-gray-900">{formatPrice(line.subtotal)}</span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
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
              Total for {distributedRoomCart.length} {distributedRoomCart.length === 1 ? "room" : "rooms"},{" "}
              {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
            </p>
            <p className="text-2xl font-semibold text-gray-950">
              {formatPrice(total)} <span className="text-sm font-normal text-gray-500">including selected options</span>
            </p>
          </div>
	          {cartIsReady ? (
	            <PrimaryButton to={`/book?${continueParams.toString()}`} className="sm:min-w-56">
	              Continue to Step 2
	            </PrimaryButton>
	          ) : (
	            <PrimaryButton
	              type="button"
	              disabled
	              aria-describedby="step-one-occupancy-error"
	              className="sm:min-w-56"
	            >
	              {!cartFitsGroup
	                ? "Adjust room"
	                : distributedRoomCart.length > 0
	                  ? "Assign every guest"
	                  : "Add at least one room"}
	            </PrimaryButton>
	          )}
	        </div>
	        {!cartIsReady ? (
          // Per CHD-11 (2026-08-04, per decision #184):
          // the error message references the type label
          // (matching the CHD-12 cart-style summary) plus
          // a three-action "Adjust room" CTA that scrolls
          // to and highlights the offending room-type
          // card. The legacy "Add enough available rooms..."
          // text stays for the cart-distribution failure
          // case.
          firstFailingType && firstFailingRoom ? (
            <p id="step-one-occupancy-error" className="mx-auto mt-2 max-w-7xl text-right text-xs font-medium text-amber-700" role="alert">
              {firstFailingType.label} maxes at {firstFailingType.maxChildren} child{firstFailingType.maxChildren === 1 ? "" : "ren"}.{" "}
              <button
                type="button"
                className="underline hover:text-amber-900"
                data-testid="adjust-room-cta"
                onClick={() => {
                  const el = document.querySelector(
                    `[data-testid="room-type-fit-${firstFailingType.value}"]`
                  );
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  el?.classList.add("ring-2", "ring-amber-400");
                  setTimeout(() => el?.classList.remove("ring-2", "ring-amber-400"), 2000);
                }}
              >
                Adjust room
              </button>
              {" "}or pick a different room type, or remove a guest.
            </p>
          ) : (
            <p id="step-one-occupancy-error" className="mx-auto mt-2 max-w-7xl text-right text-xs font-medium text-amber-700">
              Add enough available rooms to fit every guest, with at least one adult assigned to each room.
            </p>
          )
	        ) : null}
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
  extraBedTotal: number;
  discountType: "none" | "senior" | "pwd";
  discountPct: number;
  voucherApplied: boolean;
  voucherDiscount: number;
  memberDiscountPct: number;
  finalTotal: number;
}): BookingRateBreakdown {
  const addOns = [
    ...(input.breakfastTotal > 0
      ? [{ label: "Breakfast add-on", amount: input.breakfastTotal }]
      : []),
    ...(input.extraBedTotal > 0
      ? [{ label: "Extra bed add-on", amount: input.extraBedTotal }]
      : [])
  ];
  const subtotal = input.roomSubtotal + input.breakfastTotal + input.extraBedTotal;
  // Per DSC (2026-07-31): the two percentage steps now route through
  // the shared `calculatePercentDiscount` helper. The afterVoucher
  // step is intentionally NOT clamped (matches the original pattern).
  // Byte-equivalent output: same `Math.round` wrap, same chain order.
  const seniorPwdDiscount = Math.round(calculatePercentDiscount(subtotal, input.discountPct));
  const afterSeniorPwd = subtotal - seniorPwdDiscount;
  const afterVoucher = afterSeniorPwd - input.voucherDiscount;
  const memberDiscount = Math.round(calculatePercentDiscount(afterVoucher, input.memberDiscountPct));
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
        <div className="min-h-11 min-w-11" />
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
  id?: string;
  name?: string;
  autoComplete?: string;
}

function TextField({ error, icon, label, onBlur, onChange, placeholder, required, type = "text", value, id, name, autoComplete }: TextFieldProps) {
  return (
    <label htmlFor={id} className="grid gap-2 text-sm font-medium text-gray-700">
      {label}
      {required ? <span className="sr-only">required</span> : null}
      <span className="relative block">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary">{icon}</span>
        <input
          id={id}
          name={name}
          autoComplete={autoComplete}
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
  // Per CHD-10 (2026-07-31, per CVQ-01): the adult/child split
  // and the "include children" toggle, threaded through so the
  // aside can show the toggle and recompute the breakfast total
  // when it changes.
  numAdults: number;
  numChildren: number;
  breakfastIncludesChildren: boolean;
  setBreakfastIncludesChildren: (value: boolean) => void;
  // Per EXB-01 (2026-07-31): the extra-bed count + rate, threaded
  // through so the aside can show the add-on line.
  extraBedCount: number;
  extraBedRate: number;
  // Per the room-type booking refactor: the aside shows the chosen
  // type label + (once assigned by the server) the physical room
  // number. Pre-assignment, `assignedRoomNumber` is empty.
  typeLabel: string;
  roomSummary?: Array<{
    label: string;
    position: number;
    numAdults: number;
    numChildren: number;
    extraBedCount: number;
    hasBreakfast: boolean;
  }>;
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
  roomSummary = [],
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
  rateBreakdown = null,
  numAdults,
  numChildren,
  breakfastIncludesChildren,
  setBreakfastIncludesChildren,
  // Per EXB-01 (2026-07-31).
  extraBedCount,
  extraBedRate
}: BookingReviewAsideProps) {
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

  if (!typeLabel) return null;

  const activeBreakfastRate = breakfastRate ?? 350;
  // Per CHD-10 (2026-07-31, per CVQ-01): the inline
  // `activeBreakfastRate * guests * nights` pattern now routes
  // through the shared `calculateBreakfastAddOn` helper. When
  // children are present and the toggle is off, the helper uses
  // `numAdults` (the cheaper line). When the toggle is on or
  // there are no children, it falls back to `numGuests` —
  // byte-equivalent to the historical shape.
  const breakfastTotal = calculateBreakfastAddOn({
    hasBreakfast,
    breakfastRate: activeBreakfastRate,
    numGuests: guests,
    numAdults,
    numChildren,
    numNights: nights,
    breakfastIncludesChildren
  });
  // Per EXB-01 (2026-07-31): the extra-bed add-on term in the
  // summary panel. Reads the rate from the type entry; nullish
  // / 0 inputs short-circuit to 0 via the helper.
  const extraBedTotal = calculateExtraBedAddOn({
    extraBedCount,
    extraBedRate: extraBedRate ?? 0,
    numNights: nights
  });
  const subtotal = roomTotal + breakfastTotal + extraBedTotal;
  // Per DSC (2026-07-31): the percentage steps now route through the
  // shared `calculatePercentDiscount` helper. Byte-equivalent output:
  // the helper returns the same raw product, no rounding (this is the
  // guest-side display — the booking write goes through pricing.ts's
  // unrounded path). The afterVoucher step here is intentionally NOT
  // clamped (the surrounding `Math.max(afterVoucher - memberDiscount, 0)`
  // is the only clamp), so the inline subtraction stays verbatim.
  const discountAmount = calculatePercentDiscount(subtotal, discountPct);
  const afterSeniorPwd = subtotal - discountAmount;
  const afterVoucher = afterSeniorPwd - voucherDiscount;
  const memberDiscountAmount = calculatePercentDiscount(afterVoucher, memberDiscountPct);

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
          {roomSummary.length > 1 ? (
            <div className="mt-4 space-y-2">
              {roomSummary.map((room) => (
                <div key={room.position} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <span className="font-semibold text-gray-900">Room {room.position} · {room.label}</span>
                  <span className="mt-1 block">
                    {room.numAdults} adult{room.numAdults === 1 ? "" : "s"} ·{" "}
                    {room.numChildren} child{room.numChildren === 1 ? "" : "ren"}
                    {room.extraBedCount > 0 ? ` · ${room.extraBedCount} extra bed${room.extraBedCount === 1 ? "" : "s"}` : ""}
                    {room.hasBreakfast ? " · Breakfast" : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-5 grid grid-cols-2 gap-3 border-y border-gray-200 py-4 text-sm">
            <SummaryCell label="Check-in" value={formatStayDate(checkIn)} />
            <SummaryCell alignEnd label="Check-out" value={formatStayDate(checkOut)} />
            <SummaryCell label="Guests" value={`${guests} ${guests === 1 ? "guest" : "guests"}`} />
            <SummaryCell alignEnd label="Duration" value={`${nights} ${nights === 1 ? "night" : "nights"}`} />
          </div>
	          <div className="mt-5 space-y-3 text-sm text-gray-600">
	            {numChildren > 0 ? (
	              <div className="flex items-start justify-between gap-4 rounded-lg bg-status-green-bg px-3 py-2 text-status-green-text">
	                <span>
	                  Children’s room charge
	                  <span className="block text-xs font-normal">Included at no extra room cost</span>
	                </span>
	                <span className="font-semibold">{formatPrice(0)}</span>
	              </div>
	            ) : null}
	            {rateBreakdown ? (
              <PriceBreakdown breakdown={rateBreakdown} total={total} />
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Room rate</span>
                  <span>{formatPrice(roomTotal)}</span>
                </div>
                {hasBreakfast ? (
                  <>
                    <div className="flex justify-between">
                      <span>Breakfast add-on</span>
                      <span>{formatPrice(breakfastTotal)}</span>
                    </div>
                    {/* Per CHD-10 (2026-07-31, per CVQ-01): the
                        "include children" toggle. Only shown when
                        the guest has at least one child (otherwise
                        the toggle has no effect). Server snapshots
                        this onto the booking doc on create. */}
                    {numChildren > 0 ? (
                      <label className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 cursor-pointer">
                        <span>
                          Include {numChildren} {numChildren === 1 ? "child" : "children"} in breakfast
                          <span className="block text-[11px] text-gray-500">
                            {breakfastIncludesChildren
                              ? `+${formatPrice((breakfastRate ?? 0) * numChildren * nights)} added for children`
                              : "Children stay free of the breakfast charge"}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setBreakfastIncludesChildren(!breakfastIncludesChildren)}
                          aria-pressed={breakfastIncludesChildren}
                          aria-label="Include children in the breakfast charge"
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                            breakfastIncludesChildren ? "bg-primary" : "bg-gray-300"
                          }`}
                        >
                          <div className={`h-4 w-4 rounded-full bg-white transition shadow-sm transform ${
                            breakfastIncludesChildren ? "translate-x-4" : "translate-x-0"
                          }`} />
                        </button>
                      </label>
                    ) : null}
                  </>
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
                {/* Per DSC-07 (2026-08-01, per #115): the 12% VAT
                    breakdown sub-block. The senior discount
                    (RA 9994) is the VAT-exempt portion when
                    the booking carried one. Mirrors the same
                    three lines on the receipt PDF + XLSX
                    export + admin booking drawer. */}
                {(() => {
                  const vat = calculateVatBreakdown({
                    totalPrice: total,
                    seniorDiscountAmount: discountPct > 0 ? discountAmount : 0
                  });
                  return (
                    <div className="mt-2 space-y-1 border-t border-dashed border-gray-200 pt-2 text-[11px] text-gray-500">
                      <div className="flex justify-between">
                        <span>VATable Sales (VAT-exclusive)</span>
                        <span className="font-mono">{formatPrice(vat.vatExclusiveSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>VAT-Exempt Sales (RA 9994 Senior/PWD)</span>
                        <span className="font-mono">{formatPrice(vat.vatExemptSales)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-gray-700">
                        <span>VAT Amount (12% × VATable)</span>
                        <span className="font-mono">{formatPrice(vat.vatAmount)}</span>
                      </div>
                    </div>
                  );
                })()}
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
