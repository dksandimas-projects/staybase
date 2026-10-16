import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  CalendarDays,
  Check,
  ChevronDown,
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
  calculateBreakfastMealsTotal,
  getDateKeyInTimezone,
  getNumNights,
  normalizeStayRange,
  staggerChild,
  staggerContainer,
  compressImageFile,
  calculatePercentDiscount,
  calculateVoucherBase,
  // Per B-10 / B-10c / decision #223 (2026-08-19): the
  // upload-timeout helper. Wraps `uploadBytes(...)` on Firebase
  // Storage in a `Promise.race` so a hung connection (mobile
  // 3G with auth-in-flight) doesn't leave the staff/guest
  // staring at a permanent "Uploading..." spinner. See
  // `shared/utils/uploads.ts` for the rationale + the
  // 90s default.
  raceUploadWithTimeout,
  DEFAULT_UPLOAD_TIMEOUT_MS,
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
import { deriveRoomTypeCapacityFit, computeBreakfastCutoffState, recomputeBreakfastTotal, buildBreakfastRateBreakdownLines, type BreakfastSelectionEntry } from "@spark-inn/shared";
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
// In-flow hold (Steps 2 + 3 countdown banner). The
// `generateHoldId` helper is the client-side source
// of the UUIDv4 id the booking flow threads through
// the URL. The `useInFlowHold` hook (consumed by the
// `HoldCountdownBanner` component) calls POST
// /api/holds/start on first read.
import { generateHoldId } from "@spark-inn/shared";
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
import { BookingStickyFooter } from "../components/BookingStickyFooter";
import { RoomCartLines } from "../components/RoomCartLines";
import { RoomCartTray } from "../components/RoomCartTray";
import { StaySummaryStrip } from "../components/StaySummaryStrip";
import { EditStayDetailsSheet } from "../components/EditStayDetailsSheet";
import { BreakfastMenuStrip } from "../components/BreakfastMenuStrip";
import { copyBreakfastDateToRemaining } from "../utils/breakfastCopy";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, getRoomTypeRates, useRoomTypes } from "../hooks/useRoomTypes";
import { useTurnstileToken } from "../hooks/useTurnstileToken";
// In-flow hold (Steps 2 + 3 countdown banner). The
// banner is a thin wrapper around `useInFlowHold` that
// renders the live MM:SS countdown + the "Hold
// expired" red state. See
// `plan/features/BOOKING-FLOW.md §In-flow hold` for
// the UX contract.
import { HoldCountdownBanner } from "../components/HoldCountdownBanner";
// Per SR-01..05 (2026-10-12): the Step 2 special-requests
// block (bed set-up radios + "Show additional preferences"
// accordion with free-text + arrival-time dropdown).
// Replaces the `feat/special-requests-redirect` card in
// SR-05.
import { SpecialRequestsBlock } from "../components/SpecialRequestsBlock";
import { useGuestAuth } from "../context/GuestAuthContext";
// Per feat/special-requests-redirect (2026-08-21): the guest
// booking form no longer collects a free-text special-requests
// field. The redirect copy on the form reads the per-hotel
// contact override from `usePublicSiteContent` (same hook as
// ContactPage + Footer) so the email + phone render through the
// same source-of-truth chain — admin override > `hotel.config.ts`.
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
import {
  parseBookingRoomCart,
  rebalanceGuestDistribution,
  serializeBookingRoomCart,
  type BookingRoomCartItem
} from "../utils/bookingRoomCart";

// Per BR-09 (2026-10-14): the booking flow renders five
// steps instead of four. The breakfast add-on (formerly
// embedded in the old Step 2 "Guest Details") now has
// its own dedicated "Add-ons" step BEFORE the guest
// details step. The label is forward-thinking ("Add-ons"
// not "Breakfast") so future per-stay add-ons (spa,
// parking, etc.) share the same step without a rename.
const steps = ["Select Room", "Add-ons", "Guest Details", "Review & Pay", "Confirmation"];
// Per BR-09: the URL step-key contract. The legacy
// numeric `?step=N` values (1-4 from the pre-BR-09
// flow) are mapped to the new string keys in
// `normalizeStepKey` below so old share-links still
// land in the closest equivalent step. The `5` value
// is the new "confirmation" affordance for pre-BR-09
// links that explicitly numbered the confirmation page.
const STEP_KEYS = {
  selectRoom: "select-room",
  addOns: "add-ons",
  guestDetails: "guest-details",
  review: "review",
  confirmation: "confirmation"
} as const;

// Per BR-09: the soft backward-compat map for
// pre-BR-09 numeric `?step=N` deep-links. The legacy
// contract used `?step=2` for Guest Details, `?step=3`
// for Review, `?step=4` for Confirmation. After the
// refactor those numeric values land in the closest
// equivalent step (1 → rooms, 2 → add-ons,
// 3 → guest details, 4 → review, 5 → confirmation).
// Users typically need to re-do the in-cart data —
// documented in the spec change (BR-09 decision).
function normalizeStepKey(rawStep: string | null): string {
  if (!rawStep) return STEP_KEYS.selectRoom;
  // Legacy numeric shape (?step=1..5).
  if (rawStep === "1") return STEP_KEYS.selectRoom;
  if (rawStep === "2") return STEP_KEYS.addOns;
  if (rawStep === "3") return STEP_KEYS.guestDetails;
  if (rawStep === "4") return STEP_KEYS.review;
  if (rawStep === "5") return STEP_KEYS.confirmation;
  // New string shape (?step=select-room|add-ons|
  // guest-details|review|confirmation) — pass through.
  if (
    rawStep === STEP_KEYS.selectRoom ||
    rawStep === STEP_KEYS.addOns ||
    rawStep === STEP_KEYS.guestDetails ||
    rawStep === STEP_KEYS.review ||
    rawStep === STEP_KEYS.confirmation
  ) {
    return rawStep;
  }
  // Unknown value — fall back to Step 1.
  return STEP_KEYS.selectRoom;
}
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

// Per BR-03 (2026-10-12, decision #232): the
// breakfast-date list for the Step 2 section. N dates
// for N nights (open item #1: a 3-night stay has 3
// breakfasts, on the check-in + middle + check-out-1
// dates). Defensive: returns an empty array when the
// input is malformed (e.g. checkout <= checkin) so
// the Step 2 section renders nothing rather than a
// crash. The `+ 'T00:00:00'` keeps the parse
// timezone-stable for the hotel-local date string.
function enumerateBreakfastDates(checkIn: string, checkOut: string): string[] {
  if (!checkIn || !checkOut) return [];
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end <= start) return [];
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const iso = cursor.toISOString().slice(0, 10);
    dates.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// Per BR-03: the per-guest slot list for the
// breakfast grid. One slot per guest
// (`Guest 1 (Adult)`, `Guest 2 (Adult)`, `Child 1
// (age 7)`, ...). Sourced from the per-room
// `numAdults` + `numChildren` from the cart (per
// MRB-07). The slot id (`guest-0`, `guest-1`, ...)
// is the key suffix for the
// `${date}-${slotId}` selection entry; the server
// uses the same id when it renders the email view
// + receipt PDF.
function enumerateGuestSlots(roomCart: Array<{ numAdults: number; numChildren?: number }>): Array<{ id: string; label: string }> {
  const slots: Array<{ id: string; label: string }> = [];
  let counter = 0;
  for (const room of roomCart) {
    const adults = Math.max(0, Number(room.numAdults) || 0);
    for (let i = 0; i < adults; i += 1) {
      slots.push({ id: `guest-${counter}`, label: `Guest ${counter + 1} (Adult)` });
      counter += 1;
    }
    const children = Math.max(0, Number(room.numChildren) || 0);
    for (let i = 0; i < children; i += 1) {
      slots.push({ id: `guest-${counter}`, label: `Child ${i + 1}` });
      counter += 1;
    }
  }
  return slots;
}

// Per BR-03: the human-readable date label for the
// Step 2 grid ("Oct 14 (Tue) — Order by Oct 13, 8:00 PM").
// The day-of-week is the hotel's locale-configured
// weekday; the formatter is shared with the existing
// `formatStayDate` helper above.
function formatBreakfastDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = new Intl.DateTimeFormat(config.locale, { weekday: "short", timeZone: "UTC" }).format(parsed);
  const monthDay = new Intl.DateTimeFormat(config.locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
  return `${monthDay} (${weekday})`;
}

// Per MBUX-16 (decision #269, 2026-10-16): the cut-off-time
// formatter lives in its own utility module (so it can be
// imported by the test suite directly without an indirection
// through this file's compilation). The import is below the
// existing `formatBreakfastDateLabel` helper; the function
// signature + behaviour are pinned in
// `tests/api/mbux-16-breakfast-cutoff-explanation.test.ts`.
import { formatCutoffTime } from "../utils/formatCutoffTime";

function createPrivateUploadFileName(fileName: string) {
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? "";
  return `${crypto.randomUUID()}${extension}`;
}

export function BookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const { rooms, loading: roomsLoading } = useRooms();
  const { roomTypes, seasonalRateOverrides, bedSetups, bookingPreferences } = useRoomTypes();
  const { memberProfile } = useGuestAuth();
  // Per feat/special-requests-redirect (2026-08-21): the
  // redirect card on the booking form reads the per-hotel
  // contact override (Settings → Hotel Info) with the
  // deploy-time `hotel.config.ts` values as the fallback. Same
  // Per SR-01..05 (2026-10-12): the
  // `feat/special-requests-redirect` contact override
  // read is retired. The contact hook is still used
  // for `hotelCheckInTime` (the arrival-time dropdown).
  // Per MSL-01 (2026-10-15): `maxStayNights` is the admin's
  // stay-length cap (raw; `null` = no field = 30-night default).
  const { hotelCheckInTime, maxStayNights } = usePublicSiteContent();
  const currentStepKey = normalizeStepKey(searchParams.get("step"));
  const isAddOnsStep = currentStepKey === STEP_KEYS.addOns;
  const isGuestDetailsStep = currentStepKey === STEP_KEYS.guestDetails;
  const isReviewStep = currentStepKey === STEP_KEYS.review;
  const isConfirmationStep = currentStepKey === STEP_KEYS.confirmation;

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
  // In-flow hold id (Steps 2 + 3 countdown banner). The
  // id is preallocated client-side and threaded through
  // the URL (`?hold=<id>`) so the Step 1 → Step 2
  // transition preserves it across renders. The
  // `useInFlowHold` hook stamps the server-side doc on
  // first read; the booking transaction consumes the
  // hold best-effort after the booking commits.
  //
  // Per IMT-01 (2026-10-13): the setter is now live. The
  // `onPickNewRoom` callback re-rolls the id so that
  // returning to Step 1 after the hold expires starts a
  // genuinely fresh hold. Previously the id was minted
  // once per page instance and never re-rolled, while
  // `onPickNewRoom` only rewrote `?step=select-room` —
  // so Step 1 re-added the SAME dead id via
  // `continueParams`, `/api/holds/read` answered 200
  // with `status: "expired"` (read-time evaluation), the
  // hook's 404 → `POST /api/holds/start` branch therefore
  // never fired, and the guest landed in a red-banner
  // loop they could only escape with a hard reload.
  //
  // Re-rolling on an EXPLICIT guest action only. The id is
  // deliberately NOT re-rolled on a plain re-entry (e.g.
  // browser Back to Step 1): auto-reviving a dead hold
  // would silently defeat the countdown, since a guest who
  // sits on the expired banner and reloads would otherwise
  // get a new window forever and the timer would stop
  // meaning anything. An expired banner stays red until
  // the guest asks for a new room or extends the hold
  // (IMT-03). See `plan/features/BOOKING-FLOW.md
  // §In-flow Hold` + `plan/project/ROADMAP.md §IMT`.
  const [holdId, setHoldId] = useState(() => generateHoldId());

  // Per MBUX-18 (decision #275, 2026-10-16): the mobile-only
  // bottom sheet that the StaySummaryStrip's Edit pencil opens.
  // Lives at the top of the component (not inside the
  // isSelectRoomStep branch) because React hooks must run in
  // the same order every render. Initial value `false` — the
  // sheet never opens without an explicit Edit tap.
  const [isEditStayDetailsOpen, setIsEditStayDetailsOpen] = useState(false);

  // Dynamic config states loaded from Firestore
  // Per BR-03 (2026-10-12, decision #232) + BR-08 (decision
  // #238, 2026-10-14 — close-out): the local `breakfastConfig`
  // state carries the new rich shape (isEnabled + cutoffTime
  // + cutoffTimezone + defaultMealInstructions + meals[]).
  // The legacy `ratePerPersonPerNight` +
  // `breakfastIncludesChildrenDefault` fields were deleted
  // from the type and from this state in BR-08; the Step 2
  // section renders the per-meal picker instead of a flat-rate
  // toggle. Loaded from `settings/breakfastConfig` via the
  // Firestore doc (the same path the public
  // `GET /api/bookings/breakfast/config` route returns).
  // Defaults are the "breakfast is off" shape so the Step 2
  // section renders nothing before the config loads.
  const [breakfastConfig, setBreakfastConfig] = useState<{
    isEnabled: boolean;
    // Per BR-10 (decision #244 reserved, 2026-10-14 —
    // Phase 14): the cut-off enforcement toggle is
    // optional on the local state (the Firestore
    // snapshot may pre-date BR-10), so a missing /
    // `undefined` field defaults to `true` on every
    // read site (`!== false` pattern). The setting is
    // also forwarded to `computeBreakfastCutoffState`
    // inside `renderBreakfastSection`.
    cutoffsEnabled?: boolean;
    cutoffTime?: string;
    cutoffTimezone?: string;
    defaultMealInstructions?: string;
    meals?: Array<{ id: string; name: string; description?: string; price: number; displayOrder?: number; isActive?: boolean }>;
  }>({
    isEnabled: false,
    cutoffsEnabled: true,
    cutoffTime: "20:00",
    cutoffTimezone: "Asia/Manila",
    defaultMealInstructions: "",
    meals: []
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

  // DR-01 (2026-10-14): seed the range from the URL only through
  // `normalizeStayRange`. Previously the params were trusted raw, so
  // a shared or hand-edited `?checkIn=2026-10-16&checkOut=2026-10-09`
  // opened the flow on an inverted range and the first availability
  // query already used the bad dates.
  const initialStayRange = normalizeStayRange({
    checkIn: searchParams.get("checkIn"),
    checkOut: searchParams.get("checkOut"),
    minCheckIn: getDateKeyInTimezone(config.timezone),
    defaultNights: 1
  });
  const [checkIn, setCheckIn] = useState(initialStayRange.checkIn);
  const [checkOut, setCheckOut] = useState(initialStayRange.checkOut);
  // Per CHD-11.5 (2026-08-05, per decision #196): the picker
  // asks for Adults + Children directly, not Guests (total) +
  // Children. `adults` is the state; `guests` is derived as
  // `adults + numChildren` (used by the server + the cart
  // summary). The URL contract is `?adults=N&children=N`; for
  // backward compat, the URL reader also accepts the historical
  // `?guests=N&children=N` shape and derives `adults = max(1,
  // guests - numChildren)`. The picker enforces the "at least 1
  // adult" rule (per CHD-05) at the Adults min (1) — the submit
  // gate's `numAdults >= 1` check stays as defense in depth.
  const initialAdultsParam = searchParams.get("adults");
  const initialGuestsParam = searchParams.get("guests");
  const initialAdults = initialAdultsParam !== null
    ? Math.max(1, Number(initialAdultsParam) || 1)
    : initialGuestsParam !== null
      ? Math.max(1, Number(initialGuestsParam) - Number(searchParams.get("children") ?? 0))
      : 2;
  const [adults, setAdults] = useState(initialAdults);
  // Per CHD-10 (2026-07-31, per CVQ-01): children (0-11) split out
  // from the total guest count so the breakfast toggle can deduct
  // them from the bill. Seed from the `children` URL param so
  // deep links can pre-fill, then default to 0.
  const [numChildren, setNumChildren] = useState(Number(searchParams.get("children") ?? 0));
  const numAdults = adults;
  const guests = numAdults + numChildren;
  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // legacy `breakfastIncludesChildren: boolean` state is
  // deleted. Children are ordinary meal slots in Step 2
  // (the per-meal picker) — there's no children-included
  // toggle to maintain. The `numChildren` count above is
  // the source of truth for "how many extra meal slots the
  // Step 2 section renders".
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
    // Per feature/booking-autofill-member-name: when the guest is
    // signed in as a Spark Rewards member, pre-fill the Step 2 name
    // + phone from the member profile. We split `fullName` on the
    // first space (first name = first token, last name = the rest)
    // — the same split ProfilePage.tsx uses when it loads the
    // edit form. The URL params keep precedence (the Step 4 →
    // re-book flow pins first/last/phone via the URL) so the member
    // cannot accidentally have a different value pinned by an old
    // link. The name fields are then rendered as readOnly below —
    // see the first/last name inputs for the matching render-time
    // gate. Email is handled by the existing email-only block below;
    // phone stays editable (members may travel on a secondary phone
    // — per the autofill+lock UX decision 2026-08-20).
    firstName:
      searchParams.get("firstName") ??
      (memberProfile?.isMember && memberProfile.fullName
        ? memberProfile.fullName.split(" ")[0] ?? ""
        : ""),
    lastName:
      searchParams.get("lastName") ??
      (memberProfile?.isMember && memberProfile.fullName
        ? memberProfile.fullName.split(" ").slice(1).join(" ") ?? ""
        : ""),
    email:
      searchParams.get("email") ??
      (memberProfile?.isMember && memberProfile.email
        ? memberProfile.email
        : ""),
    phone:
      searchParams.get("phone") ??
      (memberProfile?.isMember && memberProfile.phone
        ? memberProfile.phone
        : ""),
    guestCount: String((Number(searchParams.get("adults")) || (Number(searchParams.get("guests")) || 2)) + Number(searchParams.get("children") ?? 0)),
    // Per feat/special-requests-redirect (2026-08-21): the
    // `requests` field is gone. The guest now sees the redirect
    // card on the form (and again on the confirmation page).
    consent: false,
    _hp: ""
  });

  // Per SR-01..05 (2026-10-12): the Step 2 special-requests
  // state. The bed set-up selection is keyed by the room
  // INDEX in the cart (the `distributedRoomCart` is the
  // source of truth for the order); preferences + free
  // text + arrival time are reservation-level. All four
  // fields are reset whenever the cart changes (Step 1
  // edit) so a stale per-room choice doesn't survive.
  const [bedSelections, setBedSelections] = useState<Record<number, string>>({});
  const [additionalPreferences, setAdditionalPreferences] = useState<string[]>([]);
  const [additionalRequest, setAdditionalRequest] = useState("");
  const [expectedArrivalTime, setExpectedArrivalTime] = useState<string | null>(null);

  // Per fix/booking-autofill-member-profile-race (2026-08-22):
  // the `guestDetails` initializer above runs ONCE on mount.
  // `memberProfile` arrives asynchronously via
  // `onAuthStateChanged` + Firestore `onSnapshot` (typically
  // 200–500ms after mount), so the initializer always sees
  // `memberProfile = null` and every autofill branch falls
  // through to `""`. The form fields stayed empty even for
  // signed-in members.
  //
  // This effect re-applies the autofill when `memberProfile`
  // lands (or changes). It runs only when:
  //   1. `memberProfile?.isMember === true` (non-members never
  //      get an autofill — they don't have a profile to read)
  //   2. The dep array changes (memberProfile fullName / email /
  //      phone / isMember). Each effect run is idempotent
  //      because of the "only fill empty fields" guard below.
  //
  // The "only fill empty fields" guard preserves any value the
  // guest typed in the gap between mount and snapshot landing.
  // Without this guard, a guest who types their first name
  // before the snapshot lands would have it overwritten by
  // the autofill when the effect fires (rare but real).
  //
  // URL params keep precedence — same as the initializer above.
  // If the URL pins firstName / lastName / phone (Step 4
  // re-book flow), the param wins over the autofill.
  useEffect(() => {
    if (!memberProfile?.isMember) return;
    if (!memberProfile.fullName && !memberProfile.email && !memberProfile.phone) return;
    setGuestDetails((prev) => {
      const urlFirst = searchParams.get("firstName");
      const urlLast = searchParams.get("lastName");
      const urlEmail = searchParams.get("email");
      const urlPhone = searchParams.get("phone");
      const derivedFirst = memberProfile.fullName.split(" ")[0] ?? "";
      const derivedLast = memberProfile.fullName.split(" ").slice(1).join(" ") ?? "";
      return {
        ...prev,
        firstName: prev.firstName || urlFirst || derivedFirst,
        lastName: prev.lastName || urlLast || derivedLast,
        email: prev.email || urlEmail || memberProfile.email,
        phone: prev.phone || urlPhone || memberProfile.phone
      };
    });
  }, [
    memberProfile?.isMember,
    memberProfile?.fullName,
    memberProfile?.email,
    memberProfile?.phone,
    searchParams
  ]);

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

  // Per PR #9 fix (2026-10-13): member self-service points redemption
  // at booking creation. The Apply button does NOT call the API
  // — it just stores the desired points amount in local state
  // and shows the discount in the UI preview. On submit,
  // `handleConfirmBooking` passes `pointsToRedeem` to the
  // server's `handleCreateBooking`, which applies the redemption
  // atomically inside the create transaction. The booking is
  // written with the already-discounted totalPrice — no refunds,
  // no credit tracking, no post-payment reconciliation. The
  // client-side toggle gate (`allowMemberPointsRedemption`) is
  // UX, not security — the server's ownership guard inside the
  // create transaction is the real authorization.
  const [selfPointsInput, setSelfPointsInput] = useState("");
  const [pendingPointsToRedeem, setPendingPointsToRedeem] = useState(0);
  const [selfPointsError, setSelfPointsError] = useState("");
  const [selfPointsApplied, setSelfPointsApplied] = useState(false);
  const memberSelfRedeemEnabled = rewardsConfig?.allowMemberPointsRedemption === true;
  const memberAvailablePoints = Number(memberProfile?.rewardsPoints || 0);

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

  // Per BR-03 (2026-10-12, decision #232): the new
  // per-guest × per-date `breakfastSelections` rich
  // shape. Keyed by `${date}-${guestSlot}` (e.g.
  // `2026-10-14-guest-0`). The Step 2 breakfast section
  // populates this map; an empty `{}` means the guest
  // skipped breakfast entirely. The server validates
  // each entry (mealId exists, serviceDate not locked,
  // price non-negative) and recomputes `breakfastTotal`
  // from `recomputeBreakfastTotal(breakfastSelections)`.
  // The create payload sends the map verbatim (the
  // `BreakfastSelectionsEntry` shape is locked per BR-01).
  const [breakfastSelections, setBreakfastSelections] = useState<Record<string, BreakfastSelectionEntry>>({});
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
  // Per NBS-2026-08-08 (F2): the recovery action the
  // sticky footer should render alongside the submit
  // error. The catch block in `handleConfirmBooking`
  // maps the server error to one of three actions:
  //   - "back-to-step-1" → return to the room/date picker
  //   - "retry" → stay on Step 3 with a "Try again" CTA
  //   - "none" → show the message with a generic close
  // The state is reset to "none" on every new submit
  // attempt.
  const [submitErrorAction, setSubmitErrorAction] = useState<"back-to-step-1" | "retry" | "none">("none");
  // Per NBS-2026-08-08 (F11): the auto-redirect timer
  // for the "Room no longer available" path is held on a
  // ref so the user can cancel it by navigating manually
  // (clicking the back CTA or the browser back button)
  // before the 5s elapses. Without the ref the timer
  // would fire after the navigation and clobber the URL
  // the user already moved to. The cleanup effect
  // below cancels any pending timer on unmount.
  const redirectTimerRef = useRef<number | null>(null);
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
  // Per BR-09 (2026-10-14, decision #239): the soft
  // `?step=2` backward-compat (the old numeric shape
  // for "Guest Details") lands on the new "Add-ons"
  // step. If the user arrives with no valid rooms in
  // the cart (a stale share-link), bounce to Step 1 so
  // they start fresh instead of staring at an empty
  // Add-ons step. Same guard mirrors the pre-existing
  // Step 3 / Step 4 fall-through logic.
  useEffect(() => {
    if (!isAddOnsStep) return;
    if (distributedRoomCart.length > 0) return;
    const fallback = new URLSearchParams(searchParams);
    fallback.delete("step");
    setSearchParams(fallback, { replace: true });
  }, [isAddOnsStep, distributedRoomCart, searchParams, setSearchParams]);
  const cartDistributionComplete =
    distributedRoomCart.length > 0
    && cartDistribution.unassignedAdults === 0
    && cartDistribution.unassignedChildren === 0
    && distributedRoomCart.every((room) => room.numAdults >= 1);
  // Per the per-individual discount guard (mirrors the
  // admin-app drawer-edit fix): PWD and senior are
  // per-individual legal entitlements (RA 7277 / RA
  // 9442) — they must be applied to the specific
  // guest's booking, not the whole multi-room cart.
  // The guard below disables the senior / PWD picker
  // options when the cart has >1 room (the per-individual
  // shape is single-room by definition) + auto-reverts
  // the discount type to "none" if the cart grows past
  // 1 while senior / PWD is selected. The single source
  // of truth is the `isPerIndividualDiscount`
  // derivation consumed by the picker disable + the
  // auto-revert useEffect.
  const isPerIndividualDiscount = discountType === "senior" || discountType === "pwd";
  const cartIsMultiRoom = distributedRoomCart.length > 1;
  useEffect(() => {
    if (isPerIndividualDiscount && cartIsMultiRoom) {
      setDiscountType("none");
      clearDiscountIdUpload();
      setDiscountIdUploadError("");
    }
  }, [isPerIndividualDiscount, cartIsMultiRoom, clearDiscountIdUpload]);
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
  // Per MBUX-11 (decision #264, 2026-10-16): the cart-distribution
  // failure message used to be a single generic sentence regardless
  // of the actual cause. Branched into specific causes so the guest
  // sees exactly why their selection doesn't fit. Precedence:
  //   1. no rooms at all → "pick at least one room"
  //   2. more rooms than guests can fill → "each room needs an adult"
  //   3. unassigned adults remain → "...adults aren't assigned..."
  //   4. unassigned children remain → "...children aren't assigned..."
  //   5. legacy fallback (defensive; should not fire in normal use)
  const cartDistributionErrorMessage = (() => {
    if (distributedRoomCart.length === 0) {
      return "Pick at least one room to start your stay.";
    }
    if (distributedRoomCart.length > guests) {
      return `You have ${distributedRoomCart.length} rooms but only ${guests} ${guests === 1 ? "guest" : "guests"} — each room needs at least one adult. Remove a room or add another guest.`;
    }
    if (cartDistribution.unassignedAdults > 0) {
      const n = cartDistribution.unassignedAdults;
      return `${n} ${n === 1 ? "adult is" : "adults are"} not assigned to a room yet — pick a different room or remove a guest.`;
    }
    if (cartDistribution.unassignedChildren > 0) {
      const n = cartDistribution.unassignedChildren;
      return `${n} ${n === 1 ? "child is" : "children are"} not assigned to a room yet — pick a different room or remove a child.`;
    }
    return "Add enough available rooms to fit every guest, with at least one adult assigned to each room.";
  })();
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
  // or child overflow. Find the highest child split supported for
  // the current total rather than silently stopping at `maxChildren`.
  //
  // Per CHD-11.5 (2026-08-05, per decision #196): the picker
  // asks for Adults + Children directly. The historical
  // auto-bump scenario (CHD-11.1) is gone — the effective
  // total is just `adults + N` (the user's chosen adults +
  // candidate child count). The room supports `N` children
  // if the overflow (with the user's `adults` count) fits
  // in `maxExtraBeds`. The derivation is used by the chip's
  // "Up to N can fit" hint.
  const selectedMaxSelectableChildren = useMemo(() => {
    if (!selectedTypeEntry) return Math.max(0, adults - 1);
    let highest = 0;
    for (let children = 0; children <= 10; children += 1) {
      // Per CHD-11.5: no auto-bump. The effective
      // total is `adults + children` (the user's
      // chosen adults + candidate child count).
      // The room supports `N` children if the
      // overflow (with the user's `adults`) fits
      // in `maxExtraBeds`.
      const overflow = requiredExtraBedsFor({
        numAdults: adults,
        numChildren: children,
        maxCapacity: Number(selectedTypeEntry.maxCapacity) || 0,
        maxChildren: Number(selectedTypeEntry.maxChildren) || 0
      });
      if (overflow.requiredExtraBeds <= selectedMaxExtraBeds) highest = children;
    }
    return highest;
  }, [adults, selectedMaxExtraBeds, selectedTypeEntry]);
  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // legacy flat-rate `hasBreakfast: boolean` +
  // `breakfastRate: number` pair is gone. The Step 2
  // breakfast section populates the rich
  // `breakfastSelections` shape; the live preview total
  // sums those snapshots via the BR-01
  // `calculateBreakfastMealsTotal` helper. The cart still
  // carries a `rateChoice` per room ("room-only" vs
  // "room-breakfast") for the meal-picker gating; the
  // legacy `breakfastRate` constant is gone.

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
  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // breakfast total is the sum of the snapshotted prices in
  // `breakfastSelections`. The legacy
  // `breakfastRate × numGuests × numNights` inline math is
  // gone — the per-meal picker stamps each entry's `price`
  // snapshot at capture time, so a later meal-name / price
  // change in the admin Settings catalog never rewrites an
  // in-flight booking.
  const breakfastTotal = useMemo(
    () => calculateBreakfastMealsTotal(breakfastSelections),
    [breakfastSelections]
  );
  // Per BR-08: the effective breakfast occupancy is
  // `breakfastSelections` count ÷ nights — every entry is
  // a meal slot. Exposed for the rate-card per-night label.
  const effectiveBreakfastOccupancy = useMemo(() => {
    const slotCount = Object.values(breakfastSelections || {}).filter(
      (entry) => entry && entry.removedAt == null
    ).length;
    return slotCount > 0 && nights > 0 ? Math.round(slotCount / nights) : guests;
  }, [breakfastSelections, nights, guests]);
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
  // Per PR #9 fix (2026-10-13): the member has queued
  // `pendingPointsToRedeem` points for redemption at booking
  // creation. Mirror the server's `Math.round(validation.value)`
  // math (where `validation.value = (points / 100) *
  // pointsRedemptionRate`) so the displayed total reflects the
  // same number the server will subtract atomically at submit.
  // Byte-equivalent when `pendingPointsToRedeem === 0`:
  // `displayTotal === total`.
  const pendingRedemptionValue = useMemo(() => {
    if (pendingPointsToRedeem <= 0) return 0;
    const rate = Number(rewardsConfig?.pointsRedemptionRate || 0);
    if (rate <= 0) return 0;
    return Math.round((pendingPointsToRedeem * rate) / 100);
  }, [pendingPointsToRedeem, rewardsConfig?.pointsRedemptionRate]);
  const displayTotal = distributedRoomCart.length > 0
    ? Math.max(total - pendingRedemptionValue, 0)
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
      finalTotal: displayTotal,
      // Per PR #9 fix (2026-10-13): surface the pending points
      // redemption as a deductions line so the member sees the
      // breakdown match the queued discount. The server applies
      // it at booking creation via `applyPointsRedemption`.
      pendingRedemptionPoints: pendingPointsToRedeem,
      pendingRedemptionValue
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
    total,
    displayTotal,
    pendingPointsToRedeem,
    pendingRedemptionValue
  ]);

  const continueParams = new URLSearchParams({
    // Per BR-09 (2026-10-14): the Step 1 "Continue"
    // button now routes to the new "Add-ons" step
    // (Step 2 in the 5-step flow). The breakfast
    // add-on was extracted from the old Step 2
    // "Guest Details" and gets its own dedicated step
    // before the guest details form.
    step: STEP_KEYS.addOns,
    checkIn,
    checkOut,
    // Per CHD-11.5: the picker URL is `?adults=N&children=N`
    // (the new contract). The Step 2/3 + confirm URLs use
    // `?guests=N&children=N` (the total) — the confirm page
    // displays "X Guests" and doesn't need the split. The
    // BookingPage URL reader handles both shapes (reads
    // `?adults=N` first, falls back to `?guests=N`).
    guests: String(guests),
    children: String(numChildren),
    roomType: selectedTypeEntry?.value ?? "",
    // Per BR-08 (decision #238, 2026-10-14 — close-out):
    // the legacy "yes/no" breakfast flag in the deep link
    // is replaced by the `breakfastSelections` rich shape
    // sent in the create payload. The deep link's
    // `?breakfast=yes` query is kept (read by
    // `RateChoice` initial value via `parseBookingRoomCart`)
    // for the per-room `rateChoice` gate — the legacy
    // `hasBreakfast` derivation is gone.
    breakfast: rateChoice === "room-breakfast" ? "yes" : "no",
    // In-flow hold id — the Step 2 / Step 3 banner reads
    // this and the `useInFlowHold` hook stamps the
    // server-side doc on first read. Optional in the URL
    // (legacy pre-hold-banner URLs omit it; the banner
    // silently renders nothing in that case).
    hold: holdId
  });
  continueParams.set("rooms", serializeBookingRoomCart(distributedRoomCart));
  // Per BR-09: the Add-ons "Continue" routes to the
  // guest details step. The Step 2 → Step 3 transition
  // is always allowed (the user can skip breakfast and
  // proceed — see the state machine in the spec).
  const guestDetailsParams = new URLSearchParams(continueParams);
  guestDetailsParams.set("step", STEP_KEYS.guestDetails);
  const reviewParams = new URLSearchParams(guestDetailsParams);
  reviewParams.set("step", STEP_KEYS.review);
  reviewParams.set("firstName", guestDetails.firstName);
  reviewParams.set("lastName", guestDetails.lastName);
  reviewParams.set("email", guestDetails.email);
  reviewParams.set("phone", guestDetails.phone);
  // Per feat/special-requests-redirect (2026-08-21): the
  // `requests` URL param is gone with the form field; the
  // redirect is the single source of truth for the guest's
  // special-request path.

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
  // Per MBUX-06: the footer summary names the FIRST outstanding
  // correction instead of the generic "Complete required fields and
  // consent", which told a guest nothing about what to do next. The
  // order matches `focusFirstGuestDetailCorrection` so the summary and
  // the focus target can never disagree.
  const firstGuestDetailCorrectionLabel = (() => {
    if (guestErrors.firstName) return "First name is required";
    if (guestErrors.lastName) return "Last name is required";
    if (guestErrors.email) return "Enter a valid email address";
    if (guestErrors.phone) return "Phone number is required";
    if (guestErrors.guestCount) return "Assign every guest to a room on the previous step";
    if (!guestDetails.consent) return "Accept the privacy and terms consent below";
    return "Complete required fields and consent";
  })();
  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // legacy per-night `breakfastRate × guests` display is gone.
  // The Step 2 breakfast section shows the per-meal picker
  // (the snapshotted `breakfastSelections[key].price` sums),
  // so a flat-rate nightly hint would double-count. The
  // `nightlyTotal` for the room card is just the per-night
  // room rate (the breakfast add-on shows up in the Step 2
  // sidebar separately).
  const nightlyTotal = selectedRoomRates
    ? selectedRoomRates.pricePerNight
    : 0;

  // Per EXB-11.4 (2026-08-06, per decision #197): no auto-init.
  // The user is in full control of the extra-bed count — the
  // cart starts at 0 and the system never silently sets it.
  // The soft floor (per-room overflow derived from
  // `requiredExtraBedsFor`) is still computed below for the
  // over-cap warning text (`softFloor > typeMaxExtraBeds`) and
  // for the submit gate's `cartFitsGroup` check (catches the
  // under-floor case at Step 1 → Step 2 with the "Adjust room"
  // CTA). The pre-EXB-11.4 (EXB-11.2) useEffect that auto-synced
  // the cart to the soft floor was removed — the user can now
  // tick/untick the checkbox freely and decrement the counter
  // below the soft floor if they want (the submit gate catches
  // the under-floor case). See `plan/docs/DECISIONS-FEATURES.md
  // #197` for the full reasoning.

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

  // Per EXB-11.3 (2026-08-04, per decision #191): no
  // default room-type selection on page load. The
  // pre-EXB-11.3 useEffect had an `if (roomCart.length
  // === 0 && availableRoomTypes[0])` branch that
  // auto-picked the first available room type and
  // silently added it to the cart. The operator now
  // thinks this is the wrong default — the system
  // committed the user to a room type before any
  // input. The new pattern: page load = empty cart,
  // empty selection. The user fills both.
  //
  // The sync branch below fires when the cart has rooms
  // but the selection doesn't match (e.g., after a
  // URL-driven pre-fill via `?roomType=` or `?rooms=`,
  // or after the user adds a second room type). The
  // URL-driven pre-fill at `BookingPage.tsx:244` (for
  // `selectedRoomType`) and the cart parser (for
  // `roomCart`) handle the deep-link case — a
  // `/book?roomType=single-room` URL still pre-fills
  // the selection; a `/book?rooms=single-room:1:2:0:0`
  // URL still pre-fills the cart + selection via the
  // sync branch.
  useEffect(() => {
    if (!roomCart.some((room) => room.roomType === selectedRoomType) && roomCart[0]) {
      setSelectedRoomType(roomCart[0].roomType);
      setRateChoice(roomCart[0].rateChoice);
    }
  }, [
    bookingId,
    numAdults,
    numChildren,
    rateChoice,
    roomCart,
    selectedRoomType
  ]);

  function updateDateParams(nextCheckIn = checkIn, nextCheckOut = checkOut, nextAdults = adults) {
    const next = new URLSearchParams(searchParams);
    next.set("checkIn", nextCheckIn);
    next.set("checkOut", nextCheckOut);
    next.set("adults", String(nextAdults));
    if (selectedRoomType) next.set("roomType", selectedRoomType);
    setSearchParams(next, { replace: true });
  }

  // Per CHD-11.5 (2026-08-05, per decision #196): the
  // `updateAdults` and `updateChildren` functions share a
  // `setOccupancy` helper that handles the clamping + URL
  // write. The new shape takes `nextAdults` (the adults
  // count) + `nextChildren` (the children count) — the
  // total `guests` is derived as `adults + numChildren`.
  // The URL contract is `?adults=N&children=N` (replaces
  // `?guests=N&children=N`); for backward compat, the URL
  // reader at line 214 accepts the historical
  // `?guests=N&children=N` shape.
  //
  // The "at least 1 adult" rule (per CHD-05) is enforced
  // at the Adults stepper's min (1) — the picker can't
  // produce an invalid state via the UI. The `safeAdults
  // = Math.min(Math.max(nextAdults, 1), maxGuestCapacity)`
  // clamp stays as defense in depth (deep-links, race
  // conditions). The `safeChildren` clamp chain is
  // `Math.max(0, Math.min(nextChildren, safeAdults))` —
  // children can be up to `safeAdults` (so the picker
  // can't go past the user's chosen adults count). The
  // CHD-11.1 + CHD-11.3 auto-bumps are gone (CHD-11.4);
  // CHD-11.5 replaces the `?guests=N` contract.
  function setOccupancy(nextAdults: number, nextChildren: number) {
    const safeAdults = Math.min(Math.max(nextAdults, 1), maxGuestCapacity);
    const safeChildren = Math.max(
      0,
      Math.min(nextChildren, safeAdults)
    );
    setAdults(safeAdults);
    setNumChildren(safeChildren);
    setGuestDetails((current) => ({
      ...current,
      guestCount: String(safeAdults + safeChildren)
    }));
    const next = new URLSearchParams(searchParams);
    next.set("checkIn", checkIn);
    next.set("checkOut", checkOut);
    next.set("adults", String(safeAdults));
    next.set("children", String(safeChildren));
    if (selectedRoomType) next.set("roomType", selectedRoomType);
    setSearchParams(next, { replace: true });
  }

  function updateAdults(nextAdults: number) {
    // Per CHD-11.5: the Adults stepper is the new
    // primary control. The "at least 1 adult" rule
    // is enforced at the picker min (1), not via
    // auto-bump (CHD-11.4). The helper clamps
    // `safeAdults` to `min(max(nextAdults, 1),
    // maxGuestCapacity)`. No auto-bump; the
    // `numChildren` is preserved.
    setOccupancy(nextAdults, numChildren);
  }

  function updateChildren(nextChildren: number) {
    // Per CHD-11.4: no auto-bump. The picker is a
    // free expression surface. The `desiredChildren`
    // is just `Math.max(nextChildren, 0)` (the floor
    // of 0; the upper bound is the soft 10 on the
    // `+` button). The "at least 1 adult" rule is
    // enforced at the Adults stepper's min (1), not
    // in the children picker. If `numChildren >
    // adults`, the `safeAdults` floor in
    // `setOccupancy` clamps children down to
    // `safeAdults` (so `numAdults = 0` would be
    // possible in theory, but the picker min of 1
    // prevents it).
    const desiredChildren = Math.max(nextChildren, 0);
    setOccupancy(adults, desiredChildren);
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
  function updateRoomQuantity(typeValue: string, nextQuantity: number, maxQuantity: number) {
    const safeQuantity = Math.min(Math.max(Math.floor(nextQuantity), 0), maxQuantity);
    setSelectedRoomType(typeValue);
    setRoomCart((current) => {
      const matching = current.filter((room) => room.roomType === typeValue);
      const other = current.filter((room) => room.roomType !== typeValue);
      const templateChoice = matching[0]?.rateChoice ?? rateChoice;
      // Per EXB-12: preserve the extra-bed breakfast toggle
      // from the first matching room (the user's pick applies
      // to every room of this type — same per-type mirror
      // pattern as `extraBedCount` and `rateChoice`).
      const resized = Array.from({ length: safeQuantity }, (_, index) =>
        matching[index] ?? {
          bookingId: doc(collection(db, "bookings")).id,
          roomType: typeValue,
          rateChoice: templateChoice,
          numAdults: 0,
          numChildren: 0,
          extraBedCount: 0
          // Per BR-08: `extraBedBreakfast` removed from the
          // cart shape (extra-bed occupants are ordinary meal
          // slots in Step 2).
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

  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // legacy EXB-12 `updateExtraBedBreakfast` toggle handler
  // is deleted. Extra-bed occupants are ordinary meal slots
  // in Step 2 (the per-meal picker) — there's no
  // cart-level toggle to maintain. The guest populates
  // meal slots in `breakfastSelections` directly via the
  // Step 2 section. The `updateExtraBedCount` function above
  // stays (the bed count itself is unchanged).

  function updateGuestDetail(field: keyof typeof guestDetails, value: string | boolean) {
    // Per feature/booking-autofill-member-email + member-name:
    // when the guest is signed in as a Spark Rewards member the
    // identity-anchored fields (email + first/last name) are locked
    // to the member's account. The name inputs render `readOnly`
    // below so the standard UI can't change them; this no-op guards
    // the programmatic path (a paste, a dev-tools edit, or any
    // future caller of `updateGuestDetail(...)`) so the server-side
    // validation stays in sync with the UI. Phone is deliberately
    // NOT in this list — members may travel on a secondary phone
    // and need to edit it for a specific booking.
    if (
      memberProfile?.isMember &&
      memberProfile.email &&
      (field === "email" ||
        field === "firstName" ||
        field === "lastName")
    ) {
      return;
    }
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
      // Per CHD-11.5: the Step 2 "Number of guests" field
      // is the TOTAL (adults + children). The user types
      // the total; we convert to `adults = max(1, total -
      // numChildren)` for the Adults state. The picker
      // enforces the "at least 1 adult" rule (Adults min
      // 1) — the clamp `Math.max(1, ...)` mirrors it.
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 1) {
        const newAdults = Math.max(1, parsed - numChildren);
        setAdults(newAdults);
        updateDateParams(checkIn, checkOut, newAdults);
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
        // Per B-10c / decision #223 (2026-08-19): same
        // race-with-timeout protection as the payment-proof
        // upload (line 1354). Without this, a hung mobile
        // connection leaves the "Uploading ID photo..." spinner
        // up indefinitely on the senior/PWD step.
        const uploadResult = await raceUploadWithTimeout(
          uploadBytes(storageRef, compressed.file),
          DEFAULT_UPLOAD_TIMEOUT_MS,
          "Discount ID upload"
        );
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
        // Per B-10 / decision #223 (2026-08-19): race the upload
        // against a 90s timeout. Without this, Firebase Storage
        // direct uploads on a hung mobile connection leave the
        // user staring at "Uploading..." forever (the `finally`
        // block runs but `uploadBytes` never resolves). The
        // timeout throws an Error that the catch below formats
        // into the existing "Receipt upload failed..." UI.
        const uploadResult = await raceUploadWithTimeout(
          uploadBytes(storageRef, compressed.file),
          DEFAULT_UPLOAD_TIMEOUT_MS,
          "Receipt upload"
        );
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
    // Per NBS-2026-08-08 (F2): reset the recovery
    // action so a fresh submit doesn't render a stale
    // CTA from the previous attempt.
    setSubmitErrorAction("none");
    // Per NBS-2026-08-08 (F11): cancel any pending
    // auto-redirect timer from a prior failed submit
    // (e.g. the user clicked Confirm a second time
    // before the 5s redirect fired). Without the
    // cancel, the timer would fire mid-second-submit
    // and clobber the URL.
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }

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
          // In-flow hold (Steps 2 + 3 countdown banner). The
          // server reads the `bookingHolds/{id}` doc,
          // validates it is still "active" + not past
          // `expiresAt`, marks it "consumed" best-effort
          // after the booking transaction commits, and
          // snapshots the `inFlowHoldMinutes` field on the
          // booking doc. Optional — pre-hold-banner callers
          // omit the field and the schema accepts its
          // absence. Read from the URL so a back-navigation
          // to Step 1 + forward again preserves the same
          // hold id (the hook's idempotent start endpoint
          // returns the existing doc unchanged).
          holdId: searchParams.get("hold") || undefined,
          roomType: firstRoomSelection.roomType,
          // Per BAR-02 (2026-08-08, per decision #203): the
          // `roomCount` field is no longer written to the
          // reservation header. Consumers derive it at
          // read time via `deriveReservationCounters`. The
          // field is no longer sent in the create request
          // body — the server reads the children list
          // directly to compute the count.
          roomSelections: distributedRoomCart.map((room, index) => ({
            bookingId: index === 0 ? bookingId : room.bookingId,
            roomType: room.roomType,
            numAdults: room.numAdults,
            numChildren: room.numChildren,
            extraBedCount: room.extraBedCount,
            // Per BR-08 (decision #238, 2026-10-14 — close-out):
            // the legacy EXB-12 `extraBedBreakfast: boolean`
            // toggle is deleted. Extra-bed occupants are
            // ordinary meal slots in Step 2 (the per-meal
            // picker) — the create payload no longer carries
            // a per-room breakfast flag for them. The
            // `breakfastSelections` rich map (sent below at
            // the create body root) is the source of truth.
            bedSetup: bedSelections[index] ?? ""
          })),
          // Per SR-01..05 (2026-10-12): the
          // reservation-level special-requests fields.
          // `additionalPreferences` is the array of
          // admin-configured preference keys; the server
          // cross-references against
          // `settings/hotelConfig.bookingPreferences[].value`.
          // `additionalRequest` is capped server-side at
          // `ADDITIONAL_REQUEST_MAX_LENGTH` (500 chars).
          // `expectedArrivalTime` is `HH:MM` in the hotel
          // timezone, or `null` for "I don't know".
          additionalPreferences,
          additionalRequest: additionalRequest.trim(),
          expectedArrivalTime,
          // Per PR #9 fix (2026-10-13): the member's pending
          // points amount from the Step 3 control. `0` (the
          // default) preserves pre-PR-9 behavior exactly. The
          // server's `handleCreateBooking` applies the
          // redemption atomically inside the create
          // transaction — the booking is written with the
          // already-discounted totalPrice so the member pays
          // the lower amount.
          pointsToRedeem: pendingPointsToRedeem,
          checkIn,
          checkOut,
          // Per BI-09 (booking-intercom audit 2026-07-06): the
          // Step 2 "Number of guests" field is the single source
          // of truth once the guest has touched it. Mirror the
          // corporate page (`CorporateBookingPage.tsx:619`) and
          // prefer the parsed Step 2 value, falling back to the
          // Step 1 stepper for guests who never reached Step 2.
          // The server's createBookingSchema takes `guests`
          // (total) + optional `numAdults` + `numChildren`
          // (split). We send the total from the Step 2 field
          // (or the derived `guests = adults + numChildren`).
          guests: Number(guestDetails.guestCount) || guests,
          // Per BR-03 (2026-10-12, decision #232): the
          // legacy top-level `hasBreakfast` +
          // `breakfastIncludesChildren` fields are NOT
          // sent. The new `breakfastSelections` rich
          // shape (sent below) replaces them. The
          // server still accepts the legacy fields
          // for back-compat (the walkin modal +
          // older clients) but the create-path
          // cleanup pins the new shape as the
          // canonical way to express breakfast
          // intent.
          // Per BR-03 (2026-10-12, decision #232): the
          // new per-guest × per-date `breakfastSelections`
          // rich shape. The Step 2 breakfast section
          // populates this map (one entry per
          // guest × per-date slot, empty string for
          // "skip"). The server validates each entry
          // (mealId exists in the live catalog,
          // serviceDate not locked, price non-negative)
          // and recomputes `breakfastTotal` from
          // `recomputeBreakfastTotal(breakfastSelections)`.
          breakfastSelections,
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
          // Per BR-08 (decision #238, 2026-10-14 — close-out):
          // the legacy EXB-12 `extraBedBreakfast: boolean`
          // toggle is deleted from the create payload. Extra-bed
          // occupants are ordinary meal slots in Step 2 (the
          // per-meal picker). The `breakfastSelections` rich map
          // (sent earlier in this body) is the single source of
          // truth for which meal slots the guest picked, including
          // any extra-bed slots.
          guestDetails: {
            firstName: guestDetails.firstName,
            lastName: guestDetails.lastName,
            email: guestDetails.email,
            phone: guestDetails.phone,
            // Per feat/special-requests-redirect (2026-08-21):
            // the `requests` field is no longer sent on the
            // public /book create wire. The server-side
            // `GuestDetailsSchema.specialRequests` is left
            // untouched (back-compat for any third-party
            // caller that still posts it) but the client
            // doesn't carry the input anymore.
            // Per MBUX-06 (decision #258): `guestDetails.consent`
            // (the Step 3 checkbox) is the single authoritative
            // consent value. The Step 4 duplicate is gone, so the wire
            // field is written from the same source the server
            // validates — `handleCreateBooking` throws a 400 when
            // `guestDetails.consent` is false.
            consent: guestDetails.consent
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
      // Guest clients cannot read `bookings/*` directly. Carry the
      // server-authoritative creation status into the confirmation URL so
      // BookingConfirmPage can gate the early check-in action without a
      // Firestore permission error. The submit endpoint still validates the
      // live status, so this parameter is only a presentation hint.
      confirmParams.set("status", String(result.data?.status ?? ""));
      navigate(`/book/confirm?${confirmParams.toString()}`);
    } catch (err: any) {
      console.error("Confirm booking error:", err);
      resetTurnstile();
      // Per NBS-2026-08-08 (F2, booking-flow audit 2026-08-08):
      // the previous catch only auto-redirected for the
      // "Room no longer available" message; every other 4xx
      // (rate-limit 429, MAX_STAY_NIGHTS, MAX_ADVANCE_DAYS,
      // discount ID missing, etc.) stranded the user on
      // Step 3 with a generic message and no recovery
      // affordance. The spec mandates "every error state has
      // a plain-language message AND a next step" — the fix
      // maps the server error to one of three recovery
      // actions surfaced as a CTA in the sticky footer:
      //   - "back-to-step-1" → return to the room/date picker
      //   - "retry" → keep the user on Step 3 with a
      //     "Try again" button (for transient errors
      //     like the rate-limit)
      //   - "none" → show the message and a generic
      //     close affordance (no forced next step)
      const errorMessage = String(err?.message || "An unexpected error occurred. Please try again.");
      if (err.message === "Room no longer available") {
        setSubmitError("Sorry, no rooms of this type are available for your selected dates. Please go back and pick another room type.");
        setSubmitErrorAction("back-to-step-1");
        // Auto redirect to Step 1 after 5 seconds — guarded
        // by a ref so a user-initiated nav (e.g. clicking
        // the back CTA earlier) cancels the timer.
        redirectTimerRef.current = window.setTimeout(() => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("step");
          nextParams.delete("roomType");
          setSearchParams(nextParams);
          setSubmitError("");
          setSubmitErrorAction("none");
          setIsSubmitting(false);
          redirectTimerRef.current = null;
        }, 5000);
      } else if (/maximum stay length|max.*stay.*night/i.test(errorMessage)) {
        setSubmitError(`${errorMessage} Go back to pick a shorter stay.`);
        setSubmitErrorAction("back-to-step-1");
      } else if (/in advance|advance.*days/i.test(errorMessage)) {
        setSubmitError(`${errorMessage} Go back to pick a closer check-in date.`);
        setSubmitErrorAction("back-to-step-1");
      } else if (/past/i.test(errorMessage) && /check-?in|date/i.test(errorMessage)) {
        setSubmitError(`${errorMessage} Go back to pick a new check-in date.`);
        setSubmitErrorAction("back-to-step-1");
      } else if (/too many|rate.*limit/i.test(errorMessage)) {
        setSubmitError(`${errorMessage} You can try again in a minute.`);
        setSubmitErrorAction("retry");
      } else {
        setSubmitError(errorMessage);
        setSubmitErrorAction("none");
      }
      setIsSubmitting(false);
    }
  }

  // Per NBS-2026-08-08 (F11): the cleanup effect
  // cancels any pending auto-redirect timer on unmount
  // (the user navigated away from Step 3 manually
  // before the 5s elapsed).
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  function markTouched(field: GuestField) {
    setTouchedFields((current) => ({
      ...current,
      [field]: true
    }));
  }

  // Per MBUX-06 (decision #258): when the guest taps Continue with
  // something still missing, identify the FIRST correction, reveal its
  // inline error, and move focus there.
  //
  // The pre-MBUX-06 footer rendered a permanently `disabled` Continue
  // button. A disabled button is unfocusable, so a keyboard or screen
  // reader user could not reach it at all, and a tapping user got a
  // dead control and no explanation — the only feedback was a footer
  // summary line several scroll-heights away. The button now always
  // reads "Continue to review"; when the form is incomplete it becomes
  // an actionable button instead of a dead one.
  //
  // Field order matches visual/DOM order so focus moves to the first
  // thing a sighted guest would fix first. The consent checkbox is
  // last because it sits below the whole form.
  function focusFirstGuestDetailCorrection(): void {
    const candidates: Array<{ field: GuestField; elementId: string }> = [
      { field: "firstName", elementId: "firstName" },
      { field: "lastName", elementId: "lastName" },
      { field: "email", elementId: "email" },
      { field: "phone", elementId: "phone" },
      // `guestCount` has no focusable control on this step — the cart
      // lives on Step 1 — so it is surfaced through the inline guest
      // label instead of by stealing focus.
      { field: "guestCount", elementId: "guest-count-label" }
    ];
    const firstBadField = candidates.find((candidate) => guestErrors[candidate.field]);
    if (firstBadField) {
      markTouched(firstBadField.field);
      const el = document.getElementById(firstBadField.elementId);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
      return;
    }
    // Every field is valid, so the blocker must be consent.
    const consentEl = document.getElementById("consentStep2");
    consentEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    consentEl?.focus({ preventScroll: true });
  }

  const getBackToPath = () => {
    if (isReviewStep) {
      // Per BR-09 (2026-10-14): the back button on the
      // Review step (new Step 4) returns to Guest Details
      // (new Step 3) instead of jumping straight to Step 1.
      return `/book?${guestDetailsParams.toString()}`;
    }
    if (isGuestDetailsStep) {
      // Per BR-09: back from the new Step 3 ("Guest
      // Details") returns to the new Step 2 ("Add-ons").
      return `/book?${continueParams.toString()}`;
    }
    if (isAddOnsStep) {
      // Per BR-09: back from the new Step 2 ("Add-ons")
      // drops the `step=` param so the URL defaults to
      // Step 1 (the room picker).
      const step1Params = new URLSearchParams(continueParams);
      step1Params.delete("step");
      return `/book?${step1Params.toString()}`;
    }
    return "/rooms";
  };

  // Per MBUX-01: the bottom reserve matches the sticky footer's
  // own safe-area padding, so the last interactive element is never
  // hidden behind the fixed bar on a notched iPhone.
  const bookingShell = (content: React.ReactNode) => (
    <main className="min-h-screen bg-gray-50 pb-[calc(8rem+env(safe-area-inset-bottom))] font-body text-gray-900">
      <BookingHeader backTo={getBackToPath()} />
      {/* In-flow hold (Steps 2 + 3 countdown banner). Only
          renders when the user is past Step 1 and the URL
          carries `?hold=<id>`. The hook inside the banner
          stamps the server-side hold doc on first read
          (idempotent) and ticks every second. The "Pick a
          new room" CTA on the expired state routes back
          to Step 1 with a fresh holdId so the cycle
          restarts cleanly. */}
      <HoldCountdownBanner
        holdId={isAddOnsStep || isGuestDetailsStep || isReviewStep ? searchParams.get("hold") : null}
        startInput={{
          reservationId,
          roomType: selectedTypeEntry?.value ?? "",
          checkIn,
          checkOut,
          numNights: nights,
          turnstileToken: turnstileToken || undefined
        }}
        onPickNewRoom={() => {
          // Per IMT-01 (2026-10-13): re-roll the hold id
          // BEFORE rewriting the URL. The id is what
          // `continueParams` reads on the next "Continue to
          // Step 2" (`hold: holdId`), so minting it first
          // means the guest re-enters Step 2 with a fresh id
          // that the hook's 404 → `POST /api/holds/start`
          // branch can stamp — instead of re-reading the
          // expired doc and getting an instantly-red banner.
          setHoldId(generateHoldId());
          const next = new URLSearchParams();
          next.set("step", "select-room");
          setSearchParams(next, { replace: true });
        }}
      />
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

// Per MBUX-05: the confirmation for the copy-to-remaining-days action.
// `null` = nothing to say yet.
//
// REACT HOOKS RULE (this is load-bearing): every useState/useEffect/
// useMemo/useCallback/useRef in BookingPage MUST sit above the
// loading-skeleton early return below. On the first render
// `isScreenLoading` is true and that early return fires, so any hook
// declared AFTER it would only be called on the second render — which
// is exactly the "Rendered more hooks than during the previous render"
// (#310) crash. The `useEffect` that clears this notice on copy
// lives further down but is gated on a render-path that only exists
// past the early return, so it is also declared above.
const [breakfastCopyNotice, setBreakfastCopyNotice] = useState<string>("");

// Per MBUX-05 (decision #257): the number of breakfast SLOTS chosen.
// Step 2 currently has breakfast only — the "other add-ons" the spec
// describes are not implemented in the guest flow yet, so this is
// deliberately derived from breakfast selections alone rather than
// hardcoded to a wider formula that does not exist yet.
const addOnCount = Object.keys(breakfastSelections).length;

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

  const renderBreakfastSection = () => (
    /* Per BR-03 (2026-10-12, decision #232): the
        new "Breakfast" section. Renders ONLY when
        `breakfastConfig.isEnabled === true`. For
        each breakfast date in the stay (N dates for
        N nights) × each guest slot (lead +
        companions + per-room occupancy), shows a
        `<select>` of active meals. Selecting a
        meal populates `breakfastSelections[key]`
        via `recomputeBreakfastTotal`. Locked
        dates render a disabled dropdown +
        a compact "Past cut-off" pill (per
        MBUX-17 + MBUX-17.1, decisions #272 +
        #273). The server is authoritative — a
        clock-mismatched client is still rejected
        at create time (per open item #7). */
    breakfastConfig.isEnabled ? (() => {
      const dates = enumerateBreakfastDates(checkIn, checkOut);
      const slots = enumerateGuestSlots(distributedRoomCart);
      if (dates.length === 0 || slots.length === 0) return null;
      // Per MBUX-05: the menu strip renders the SAME active, ordered
      // catalogue the selectors read, so a photo can never appear for
      // a meal that cannot actually be chosen.
      const activeBreakfastMeals = [...(breakfastConfig.meals || [])]
        .filter((meal) => meal.isActive !== false)
        .sort(
          (a, b) =>
            (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0) ||
            String(a.name || "").localeCompare(String(b.name || ""))
        );
      return (
        <motion.div className="mb-6 rounded-card border border-primary/20 bg-primary/5 p-5" variants={staggerChild}>
          <h2 className="font-heading text-xl text-gray-950">Breakfast</h2>
          {/* Per MBUX-05 (decision #257): ONE short instruction owns the
              first screen. The longer hotel-configured text is kept but
              demoted below the fold of this card — on a phone it was
              pushing the first date card out of view. */}
          <p className="mt-1 text-sm text-gray-600">Choose breakfast for each guest.</p>
          {breakfastConfig.defaultMealInstructions ? (
            <details className="mt-2 group">
              <summary className="min-h-11 cursor-pointer text-xs font-semibold text-primary">
                Breakfast notes
              </summary>
              <p className="mt-1 text-xs leading-5 text-gray-600">
                {breakfastConfig.defaultMealInstructions}
              </p>
            </details>
          ) : null}
          {/* Per MBUX-04 + MBUX-05: the optional meal photos render here,
              ABOVE the selectors, never inside a native <option>. */}
          <BreakfastMenuStrip
            meals={activeBreakfastMeals}
            formatPrice={formatPrice}
          />
          {/* Per MBUX-16 (decision #269, 2026-10-16) + MBUX-17
              (decision #272, 2026-10-16): when at least one date
              in the stay has crossed the cut-off, show a one-line
              help text that names the cut-off TIME so the guest
              doesn't have to guess what "cut-off" means in their
              timezone. The text is amber-700 (the existing cut-off
              / Fits-invalidity accent) and only appears when
              needed — when every date is still open, the "Order
              by 24 Oct, 8:00 PM" per-date headers already carry
              the deadline signal and the help text would be noise.

              The "still editable" suffix is important — without
              it a guest might think the WHOLE breakfast flow is
              locked, when actually only the one past-deadline
              date is. MBUX-17 paired this help text with the
              compact per-date cut-off pill below so the cut-off
              time appears exactly ONCE on the page (here), not
              also inside every locked
              date card. */}
          {dates.some((d) => {
            const c = computeBreakfastCutoffState({
              serviceDate: d,
              now: new Date(),
              cutoffTime: breakfastConfig.cutoffTime || "20:00",
              timezone: breakfastConfig.cutoffTimezone || "Asia/Manila",
              cutoffsEnabled: breakfastConfig.cutoffsEnabled !== false
            });
            return c.isLocked;
          }) ? (
            <p
              className="mt-5 text-xs text-amber-700"
              data-testid="breakfast-cutoff-help"
            >
              {/* Per MBUX-17.2 (decision #274, 2026-10-16): the
                  pre-MBUX-17.2 first-sentence policy + em-dash
                  hedge (a subordinate clause that warned the
                  guest the menu locks per date) is replaced with
                  a second sentence that turns the hedge into a
                  guest-facing ACTION: "If you booked beyond the
                  cut-off time, you may not be able to order —
                  but you can still order breakfast for other
                  days." The first sentence ("Breakfast has a
                  per-day cut-off ({time} the day before)") is
                  preserved verbatim — it carries the cut-off TIME
                  (interpolated via `formatCutoffTime` so the
                  rendered time always matches the admin-configured
                  value) AND tells the guest WHEN the cut-off fires
                  relative to the service date. The em-dash in the
                  second sentence carries the contrast ("can't for
                  this date" → "but can for other dates") more
                  cheaply than the pre-MBUX-17.2 subordinate clause
                  did.

                  Owner's verbatim ask: "kindly enhance" the help
                  text into two sentences — the first is the policy
                  (kept), the second is the consequence the guest
                  can act on (added). The MBUX-17.2 copy is
                  light-edited from the owner's words: typos fixed
                  ("beyonf" → "beyond", "other day's" → "other
                  days'"), a missing modal verb restored ("you CAN
                  still order" rather than "you may still order"),
                  and the comma splice between the consequence and
                  the contrast replaced with an em-dash to match
                  the file's existing em-dash usage. The rendered
                  copy is:

                    Breakfast has a per-day cut-off ({time} the
                    day before). If you booked beyond the cut-off
                    time, you may not be able to order — but you
                    can still order breakfast for other days.

                  Pill (`Past cut-off`, per MBUX-17.1 decision
                  #273) is unchanged — MBUX-17.2 is help-text only.
                  The pill is the per-date state marker; the help
                  text is the policy anchor. */}
              {`Breakfast has a per-day cut-off (${formatCutoffTime(breakfastConfig.cutoffTime || "20:00")} the day before). If you booked beyond the cut-off time, you may not be able to order — but you can still order breakfast for other days.`}
            </p>
          ) : null}

          {/* Per MBUX-17 (decision #272, 2026-10-16): the
              pre-MBUX-17 one-line reassurance above the date cards
              (the line that read like a sentence reminding guests
              that skipping is OK) is REMOVED. The default `<option>`
              on every guest slot is the no-meal choice (the first
              entry in the meal list), so the instruction was
              redundant — a guest who never opens a dropdown already
              gets the no-meal option for that guest/date. Saying it
              again above the date cards added an extra sentence of
              mobile real estate without changing any outcome. The
              mbux-16 help text (above) keeps the `mt-5` slot it
              took; the spacing downstream of it is unchanged. */}
          <div className="mt-4 space-y-4">
            {dates.map((date) => {
              const cutoff = computeBreakfastCutoffState({
                serviceDate: date,
                now: new Date(),
                cutoffTime: breakfastConfig.cutoffTime || "20:00",
                timezone: breakfastConfig.cutoffTimezone || "Asia/Manila",
                // Per BR-10 (2026-10-14, decision #244 reserved —
                // Phase 14): thread the cut-off enforcement toggle
                // through to the helper. When the admin has the
                // toggle off, every date is rendered as open —
                // the meal picker is enabled and the countdown
                // banner collapses.
                cutoffsEnabled: breakfastConfig.cutoffsEnabled !== false
              });
              return (
                <div key={date} className="rounded-lg bg-white p-4 ring-1 ring-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-gray-950">{formatBreakfastDateLabel(date)}</p>
                    {/* Per MBUX-17 (decision #272, 2026-10-16): the
                        pre-MBUX-17 two-line stack (a status title +
                        an amber sub-line that named the cut-off time
                        AND the workarounds) is replaced with a single
                        compact pill — see the
                        `<div className="text-right">` block below. The
                        unlocked-state line stays byte-equivalent
                        ("Order by Oct 24"). The cut-off TIME used to
                        appear here AND in the top-of-section help
                        text, which was the duplication the owner
                        flagged; the pill carries the reason inline
                        and the
                        help text is the single source for the time. */}
                    <div className="text-right">
                      {/* Per MBUX-17 (decision #272, 2026-10-16) +
                          MBUX-17.1 (decision #273, 2026-10-16): the
                          locked-date marker is a single compact pill
                          whose copy reads as a two-word short-form
                          state label instead of the
                          pre-MBUX-17 two-line stack (a status title
                          + an amber sub-line that named the cut-off
                          time AND listed the workarounds). The pill
                          carries the reason inline; the top-of-
                          section help text already names the cut-off
                          time, so duplicating it per-date was
                          noise. MBUX-17.1 shortened the pill text
                          from the pre-MBUX-17.1 four-word copy
                          (which wrapped to two lines on a 375px
                          phone) to a two-word short-form copy that
                          fits one line on every viewport +
                          added `whitespace-nowrap` as a guard so a
                          future copy edit cannot reintroduce the
                          wrap.

                          Style mirrors the in-file "Tight — at the
                          cap" / "Doesn't fit your group" pills (same
                          rounded-full + amber-100 / amber-800 pair)
                          so the cut-off indicator reads as part of
                          the same vocabulary rather than a separate
                          one-off element. Unlocked dates stay
                          byte-equivalent (the "Order by Oct 24"
                          deadline line). */}
                      {cutoff.isLocked ? (
                        <span
                          data-testid="breakfast-cutoff-pill"
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
                        >
                          Past cut-off
                        </span>
                      ) : (
                        <p className="text-xs text-gray-600">
                          {`Order by ${formatStayDate(date)}`}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Per MBUX-05 (decision #257): "Use these choices for
                      all remaining days". A multi-night stay repeats the
                      same guest matrix N times, which is the most tedious
                      thing in the booking flow on a phone.

                      Placement rules:
                      - only on the FIRST date that has at least one
                        explicit selection (a guest who has not chosen
                        anything has nothing to copy);
                      - only when at least one LATER date is still
                        editable (a single-night stay has nothing to
                        copy onto);
                      - the targets exclude locked dates, so a copy can
                        never overwrite a closed cut-off.

                      The helper returns how many dates actually CHANGED
                      (a target that already held the same choices is
                      not counted), so the confirmation never overstates
                      what happened. Copied dates stay fully editable —
                      this writes the same map the selectors write. */}
                  {(() => {
                    const sourceHasChoice = slots.some((slot) =>
                      Boolean(breakfastSelections[`${date}-${slot.id}`])
                    );
                    if (!sourceHasChoice || cutoff.isLocked) return null;
                    const laterEditableDates = dates.filter((later) => {
                      if (later <= date) return false;
                      const laterCutoff = computeBreakfastCutoffState({
                        serviceDate: later,
                        now: new Date(),
                        cutoffTime: breakfastConfig.cutoffTime || "20:00",
                        timezone: breakfastConfig.cutoffTimezone || "Asia/Manila",
                        cutoffsEnabled: breakfastConfig.cutoffsEnabled !== false
                      });
                      return !laterCutoff.isLocked;
                    });
                    if (laterEditableDates.length === 0) return null;
                    return (
                      <button
                        type="button"
                        data-testid={`breakfast-copy-to-remaining-${date}`}
                        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-primary px-3 text-xs font-semibold text-primary hover:bg-primary-light sm:w-auto"
                        onClick={() => {
                          const result = copyBreakfastDateToRemaining({
                            selections: breakfastSelections,
                            sourceDate: date,
                            targetDates: laterEditableDates,
                            slotIds: slots.map((slot) => slot.id),
                            now: new Date().toISOString()
                          });
                          setBreakfastSelections(result.selections);
                          // The guest app has no toast system (per
                          // `FRONTEND.md`), so the confirmation is an
                          // inline `role="status"` message. It reports the
                          // number of dates that ACTUALLY changed, so it
                          // can never overstate what the tap did.
                          setBreakfastCopyNotice(
                            result.updatedDates === 0
                              ? "Those choices are already set on every remaining day."
                              : `Applied these choices to ${result.updatedDates} remaining day${result.updatedDates === 1 ? "" : "s"}.`
                          );
                        }}
                      >
                        Use these choices for all remaining days
                      </button>
                    );
                  })()}
                  {breakfastCopyNotice ? (
                    <p
                      role="status"
                      aria-live="polite"
                      data-testid={`breakfast-copy-notice-${date}`}
                      className="mt-2 text-xs font-medium text-gray-700"
                    >
                      {breakfastCopyNotice}
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {slots.map((slot) => {
                      const key = `${date}-${slot.id}`;
                      const selected = breakfastSelections[key]?.mealId || "";
                      // Per MBUX-05: the pre-MBUX-05 row was a fixed
                      // `min-w-[160px]` label beside a `flex-1` select. At
                      // 360px that left the native select roughly 150px
                      // wide, so the option text truncated and the whole
                      // control read as broken. Stacked on mobile (label
                      // above, full-width select) and side-by-side from
                      // `sm:` up, where there is room for the old shape.
                      return (
                        <div key={key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                          <label className="text-sm text-gray-700 sm:min-w-[160px]" htmlFor={`bf-${key}`}>
                            {slot.label}
                          </label>
                          <select
                            id={`bf-${key}`}
                            data-testid={`breakfast-select-${key}`}
                            className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1"
                            value={selected}
                            disabled={cutoff.isLocked}
                            onChange={(event) => {
                              const mealId = event.target.value;
                              setBreakfastSelections((prev) => {
                                const next = { ...prev };
                                if (!mealId) {
                                  delete next[key];
                                } else {
                                  const meal = (breakfastConfig.meals || []).find((m) => m.id === mealId);
                                  if (!meal) return prev;
                                  // Per BR-01 (2026-10-12, decision
                                  // #231): the `serviceDate` and
                                  // `guestSlot` live in the
                                  // composite KEY (`${date}-${slot.id}`),
                                  // NOT in the entry. The entry
                                  // carries the snapshot
                                  // (`mealId` + `mealName` +
                                  // `price`) + the audit fields.
                                  // The server parses the date +
                                  // slot from the key when it
                                  // validates / recomputes.
                                  const nowIso = new Date().toISOString();
                                  next[key] = {
                                    mealId: meal.id,
                                    mealName: meal.name,
                                    price: meal.price,
                                    addedBy: "guest",
                                    addedAt: nowIso,
                                    lastModifiedAt: nowIso,
                                    lastModifiedBy: "guest",
                                    removedAt: null,
                                    removedBy: null,
                                    overrideCutoff: false,
                                    overrideReason: null
                                  };
                                }
                                return next;
                              });
                            }}
                          >
                            <option value="">No breakfast</option>
                            {(breakfastConfig.meals || []).map((meal) => (
                              <option key={meal.id} value={meal.id}>
                                {meal.name} — {formatPrice(meal.price)}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      );
    })() : null
  );

  // Per BR-09: the muted per-guest label replacing
  // the legacy bold "Number of guests" input. The
  // label reads from the per-room `numAdults` +
  // `numChildren` so the user always sees the
  // current cart shape (no editable input). When
  // the cart is empty the line still renders as a
  // muted hint so the layout doesn't shift. The
  // derived `guestDetails.guestCount` field is
  // still maintained by `setOccupancy` (the create
  // payload uses it) — only the bold input UI is
  // gone.
  const renderGuestCountLabel = () => {
    const totalAdults = distributedRoomCart.reduce(
      (sum, room) => sum + Math.max(0, Number(room.numAdults) || 0),
      0
    );
    const totalChildren = distributedRoomCart.reduce(
      (sum, room) => sum + Math.max(0, Number(room.numChildren) || 0),
      0
    );
    const totalGuests = totalAdults + totalChildren;
    if (totalGuests === 0) {
      return (
        <p className="text-xs text-gray-500" data-testid="guest-count-label">
          Pick a room to see the guest breakdown.
        </p>
      );
    }
    const parts: string[] = [];
    parts.push(`${totalAdults} adult${totalAdults === 1 ? "" : "s"}`);
    if (totalChildren > 0) {
      parts.push(`${totalChildren} child${totalChildren === 1 ? "" : "ren"}`);
    }
    parts.push(`(${totalGuests} total)`);
    const roomsLabel = distributedRoomCart.length === 1
      ? "1 room"
      : `${distributedRoomCart.length} rooms`;
    return (
      <p className="text-xs text-gray-500" data-testid="guest-count-label">
        {roomsLabel} · {parts.join(" · ")}
      </p>
    );
  };

  if (isAddOnsStep) {
    // Per BR-09 (2026-10-14): the new Step 2
    // ("Add-ons"). Hosts the breakfast per-date ×
    // per-guest meal grid extracted from the old
    // Step 2. The step is forward-thinking — the
    // label is "Add-ons" (not "Breakfast") so
    // future per-stay add-ons (spa, parking, etc.)
    // share the same step without a rename. When
    // `breakfastConfig.isEnabled === false`, the
    // section renders a friendly empty card so the
    // step still flows the user to Guest Details.
    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={2} />
          </div>
          <div className="mt-10">
            {/* Per MBUX-01: hidden on mobile because the compact
                stepper now states the position once, in its
                `Step N of 5 · Name` caption. Retained from
                `sm:` up, where the stepper shows every label. */}
            <p className="hidden text-sm font-semibold uppercase tracking-wide text-primary sm:block">Step 2 of 5</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Add-ons</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Optional extras for your stay.
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
            {breakfastConfig.isEnabled ? renderBreakfastSection() : (
              <motion.div className="rounded-card border border-gray-200 bg-gray-50 p-5" variants={staggerChild}>
                <h2 className="font-heading text-xl text-gray-950">No add-ons available</h2>
                <p className="mt-1 text-sm text-gray-600">
                  The hotel hasn&apos;t configured any optional add-ons for this stay. Continue to guest details.
                </p>
              </motion.div>
            )}
          </motion.form>

          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={guests}
            nights={nights}
            // Per BR-08 (decision #238, 2026-10-14 — close-out):
            // the legacy `hasBreakfast` +
            // `breakfastIncludesChildren` +
            // `setBreakfastIncludesChildren` +
            // `breakfastRate` props are gone. The sidebar
            // reads the new `breakfastSelections` rich
            // shape only. The adult/child split
            // (`numAdults` + `numChildren`) stays so the
            // per-room summary can render the split.
            numAdults={numAdults}
            numChildren={numChildren}
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
              // Per BR-08 (decision #238, 2026-10-14 — close-out):
              // the legacy `hasBreakfast: boolean` per-room
              // flag is gone. The per-meal breakdown (rendered
              // below the room summary) shows the meal count for
              // the whole stay.
              breakfastCount: Object.keys(breakfastSelections || {}).length > 0
                ? Math.ceil(Object.keys(breakfastSelections).length / Math.max(distributedRoomCart.length, 1))
                : 0
            }))}
            typeValue={selectedTypeEntry?.value ?? ""}
            typeImageUrls={selectedTypeEntry ? getRoomTypeImages(roomTypes, selectedTypeEntry.value) : []}
            typeRates={selectedRoomRates}
            typeDescription={selectedTypeEntry?.description ?? ""}
            total={total}
            seasonalRateOverrides={seasonalRateOverrides}
            discountPct={discountPct}
            discountType={discountType}
            voucherDiscount={voucherDiscount}
            voucherApplied={voucherApplied}
            memberDiscountPct={memberDiscountPct}
            isMember={!!memberProfile}
            rateBreakdown={rateBreakdown}
            // Per BR-03 (2026-10-12, decision #232):
            // thread the new `breakfastSelections` rich
            // shape into the Step 3 review sidebar
            // (same pattern as the Step 2 sidebar
            // above). The Step 3 page reads the same
            // cart state, so the per-date breakdown
            // is identical.
            breakfastSelections={breakfastSelections}
          />
        </section>

        {/* Per MBUX-01: the shell is standardised. Per MBUX-05 the
            BR-10 dual CTA is consolidated into the one context-aware
            action below. */}
        <BookingStickyFooter
          summary={
            <>
              <p className="text-sm text-gray-600">Add-ons</p>
              <p className="text-lg font-semibold text-gray-950">
                {addOnCount === 0
                  ? "No add-ons selected"
                  : `${addOnCount} breakfast selection${addOnCount === 1 ? "" : "s"} · ${formatPrice(breakfastTotal)}`}
              </p>
            </>
          }
        >
            {/* Per MBUX-05 (decision #257): the BR-10 pair of parallel
                CTAs is RETIRED in favour of ONE context-aware action.
                Both BR-10 buttons advanced to the identical
                `/book?step=guest-details` URL and differed only in
                visual style + label, so the pair told a guest who had
                skipped breakfast that there was a special "skip" button
                — implying the other one would do something different
                with their choices. It would not. One action whose label
                states what will actually happen:

                  - no selections  -> "Continue without add-ons"
                  - any selections -> "Continue with N add-ons · total"

                The count is the number of BREAKFAST SLOTS chosen and the
                figure is `breakfastTotal` — the SAME value the review
                step and the create payload use, so the CTA can never
                quote a total that differs from the bill.

                SCOPE: this is the public `/book` flow only. The
                corporate flow keeps its BR-10 pair until MBUX-09 does
                the parity pass — `br-10-dual-add-ons-buttons.test.ts`
                pins that distinction deliberately. */}
            <PrimaryButton
              to={`/book?${guestDetailsParams.toString()}`}
              className="sm:min-w-56"
              data-testid="booking-addons-continue-primary"
            >
              {addOnCount === 0 ? (
                "Continue without add-ons"
              ) : (
                <>
                  Continue with {addOnCount} add-on{addOnCount === 1 ? "" : "s"} ·{" "}
                  {formatPrice(breakfastTotal)}
                </>
              )}
            </PrimaryButton>
        </BookingStickyFooter>
      </>
    );
  }

  if (isGuestDetailsStep) {
    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={3} />
          </div>
          <div className="mt-10">
            {/* Per MBUX-01: hidden on mobile — the stepper caption states the position. */}
            <p className="hidden text-sm font-semibold uppercase tracking-wide text-primary sm:block">Step 3 of 5</p>
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
            {/* Per BR-09: the per-guest count is now a
                MUTED label (text-xs text-gray-500) instead
                of the legacy bold "Number of guests"
                input. The summary line ("X adults + Y
                children + Z total") is gone — the cart is
                the single source of truth for occupancy
                (changed on Step 1 via the room picker +
                adult/child steppers). The internal
                `guestDetails.guestCount` is still derived
                by `setOccupancy` so the create payload +
                the booking-write validation stay
                unchanged. */}
            {renderGuestCountLabel()}
            <motion.div className="mt-4 grid gap-5 sm:grid-cols-2" variants={staggerChild}>
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
                // Per feature/booking-autofill-member-name: lock the
                // first/last name fields to the member's account
                // name. The identity anchor (email + name triple)
                // stays consistent across bookings. `updateGuestDetail`
                // short-circuits the same fields above, so the
                // readOnly here is belt-and-braces.
                readOnly={!!memberProfile?.isMember}
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
                readOnly={!!memberProfile?.isMember}
              />
            </motion.div>

            <motion.div className="mt-5 grid gap-5 sm:grid-cols-2" variants={staggerChild}>
              {/* Per fix(guest-details-field-alignment): `content-start`
                  keeps the two-cell row packed to the top so the taller
                  Email cell (it carries the helper line) can't stretch the
                  Phone field's label row and offset its input. */}
              <div className="grid content-start gap-2">
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
                  // Per feature/booking-autofill-member-email: lock the
                  // email field to the member's account email so the
                  // booking is always filed under the correct identity.
                  // `updateGuestDetail` short-circuits the same field
                  // above, so the readOnly here is belt-and-braces.
                  readOnly={!!memberProfile?.isMember}
                />
                {memberProfile?.isMember && memberProfile.email ? (
                  <p className="text-xs text-gray-600">
                    Linked to your {config.rewardsName} account.
                  </p>
                ) : null}
              </div>
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

            <motion.div className="mt-5" variants={staggerChild}>
              {/* Per SR-01..05 (2026-10-12): the special-requests
                  block. Replaces the `feat/special-requests-redirect`
                  card (which is retired in SR-05). The block is
                  always rendered on Step 3 — the bed set-up section
                  renders only when the picked room type offers
                  choices; the additional preferences are gated by
                  the (admin-configured) catalog being non-empty. */}
              <SpecialRequestsBlock
                bedSetups={bedSetups}
                bookingPreferences={bookingPreferences}
                selectedRooms={distributedRoomCart
                  .map((room) => roomTypes.find((t) => t.value === room.roomType))
                  .filter((t): t is NonNullable<typeof t> => Boolean(t))}
                bedSelections={bedSelections}
                onSetBedSelections={setBedSelections}
                additionalPreferences={additionalPreferences}
                onSetAdditionalPreferences={setAdditionalPreferences}
                additionalRequest={additionalRequest}
                onSetAdditionalRequest={setAdditionalRequest}
                expectedArrivalTime={expectedArrivalTime}
                onSetExpectedArrivalTime={setExpectedArrivalTime}
                checkInTime={hotelCheckInTime ?? "2:00 PM"}
                locale={config.locale}
              />
              {/* Per SR-01..05 (2026-10-12): the
                  `feat/special-requests-redirect` card
                  (formerly here) is retired. The guest
                  can capture their free-text request +
                  per-room bed set-up + preference
                  checkboxes + arrival time on the
                  `SpecialRequestsBlock` above. */}
            </motion.div>

            {/* Per MBUX-06 (decision #258): this is the SINGLE
                authoritative booking consent control for the whole flow.
                The duplicate Step 4 checkbox is deleted, and the create
                payload + the Confirm gate both read `guestDetails.consent`
                — the same field the server's `guestDetailsSchema`
                validates. Keeping one control means a guest cannot tick
                one box and be silently rejected on the other. */}
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
                  </Link>
                  , and consent to my details being used to process this booking.
                </span>
              </label>
            </motion.div>

            {/* Per MBUX-06: the spec's "large privacy explanation"
                becomes a COMPACT secure-handling line. The consent
                checkbox above now carries the whole obligation in one
                sentence, so a second four-line paragraph repeating it
                was pure weight on a phone. The RA 10173 reference is
                kept — it is the compliance-relevant fact — but the
                layout is a single inline line rather than a boxed
                paragraph. */}
            <motion.div className="mt-4 flex items-center gap-2 text-xs text-gray-600" variants={staggerChild}>
              <ShieldCheck size={14} className="shrink-0 text-primary" aria-hidden />
              <p data-testid="booking-secure-handling-note">
                Details are stored securely under the Data Privacy Act of 2012.
              </p>
            </motion.div>
          </motion.form>

          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={Number(guestDetails.guestCount) || guests}
            nights={nights}
            // Per BR-08 (decision #238, 2026-10-14 — close-out):
            // the legacy `hasBreakfast` +
            // `breakfastIncludesChildren` +
            // `setBreakfastIncludesChildren` +
            // `breakfastRate` props are gone. The sidebar
            // reads the new `breakfastSelections` rich
            // shape only. The adult/child split
            // (`numAdults` + `numChildren`) stays so the
            // per-room summary can render the split.
            numAdults={numAdults}
            numChildren={numChildren}
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
              // Per BR-08 (decision #238, 2026-10-14 — close-out):
              // the legacy `hasBreakfast: boolean` per-room
              // flag is gone. The per-meal breakdown (rendered
              // below the room summary) shows the meal count for
              // the whole stay.
              breakfastCount: Object.keys(breakfastSelections || {}).length > 0
                ? Math.ceil(Object.keys(breakfastSelections).length / Math.max(distributedRoomCart.length, 1))
                : 0
            }))}
            typeValue={selectedTypeEntry?.value ?? ""}
            typeImageUrls={selectedTypeEntry ? getRoomTypeImages(roomTypes, selectedTypeEntry.value) : []}
            typeRates={selectedRoomRates}
            typeDescription={selectedTypeEntry?.description ?? ""}
            total={total}
            seasonalRateOverrides={seasonalRateOverrides}
            discountPct={discountPct}
            discountType={discountType}
            voucherDiscount={voucherDiscount}
            voucherApplied={voucherApplied}
            memberDiscountPct={memberDiscountPct}
            isMember={!!memberProfile}
            rateBreakdown={rateBreakdown}
            // Per BR-03 (2026-10-12, decision #232):
            // thread the new `breakfastSelections` rich
            // shape into the Step 2 sidebar so the
            // per-date breakfast breakdown renders
            // alongside the room subtotal + extra-bed
            // line. The Step 3 page reads the same
            // cart state (separate call site below),
            // so both sidebars render the same shape.
            breakfastSelections={breakfastSelections}
          />
        </section>

        <BookingStickyFooter
          summary={
            <>
              <p className="text-sm text-gray-600">Guest details</p>
              <p className="text-lg font-semibold text-gray-950">
                {canContinueToReview
                  ? "Ready for review and payment"
                  : firstGuestDetailCorrectionLabel}
              </p>
            </>
          }
        >
            {canContinueToReview ? (
              // Per BR-09 (2026-10-14): the step-3 →
              // step-4 transition copy uses the
              // destination step name ("review"), not a
              // numbered "Step N" reference, so the
              // 5-step refactor doesn't leave stale
              // numbering in the CTA.
              <PrimaryButton to={`/book?${reviewParams.toString()}`} className="sm:min-w-56">
                Continue to review
              </PrimaryButton>
            ) : (
              // Per MBUX-06: NOT disabled. An unreachable control that
              // silently does nothing is worse than one that says what
              // is wrong and takes you there.
              <PrimaryButton
                type="button"
                onClick={focusFirstGuestDetailCorrection}
                className="sm:min-w-56"
                data-testid="booking-guest-details-continue"
              >
                Continue to review
              </PrimaryButton>
            )}
        </BookingStickyFooter>
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
    // HISTORY, kept because the trap it describes is still live.
    //
    // NBS-2026-08-08 (F5) found that the server's
    // `guestDetailsSchema` validates `guestDetails.consent`, while
    // the client gate was reading a DIFFERENT checkbox — so ticking
    // the client one passed the UI and still produced a server 400
    // ("Privacy policy consent is required."). The temporary fix
    // was to AND both checkboxes together.
    //
    // MBUX-06 (decision #258) completes the consolidation that
    // comment asked for: the duplicate checkbox is deleted and
    // `guestDetails.consent` — the value the SERVER validates — is
    // the single source of truth for the UI gate, the create payload,
    // and the "confirm your consent" CTA copy.
    //
    // The lesson generalises: whenever the client gates on a value
    // the server does not validate, the gate is decorative. There is
    // now exactly one consent value and the server reads the same one.
    const canConfirm = guestDetails.consent && !isIdUploadRequired && !isPaymentProofRequired && cartIsReady && Boolean(turnstileToken);

    // Per MBUX-07 (decision #259): which optional savings are ACTUALLY
    // applied, so the collapsed disclosure can state them.
    //
    // The disclosure is collapsed by default, and that creates a
    // hazard the spec calls out directly: a guest who applied a
    // voucher must still SEE that it is applied while the section is
    // shut. Hiding that would invite them to apply a second code, or
    // to conclude their discount vanished when they reach payment.
    const appliedSavingsLabels = [
      voucherApplied ? `Voucher ${voucherCode.trim().toUpperCase()}` : "",
      pendingPointsToRedeem > 0 ? `${pendingPointsToRedeem.toLocaleString()} points` : "",
      discountType === "senior" ? "Senior Citizen discount" : "",
      discountType === "pwd" ? "PWD discount" : ""
    ].filter(Boolean);

    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={4} />
          </div>
          <div className="mt-10">
            {/* Per MBUX-01: hidden on mobile — the stepper caption states the position. */}
            <p className="hidden text-sm font-semibold uppercase tracking-wide text-primary sm:block">Step 4 of 5</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Review & Pay</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Review your details, select a discount or enter a voucher, and choose your payment method.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          {/* Per MBUX-07 (decision #259): MOBILE ORDER IS SUMMARY FIRST. The
              sidebar below this column carries the full booking summary, and
              in a single-column grid it used to render AFTER every control —
              so a guest had to scroll past payment, uploads, and optional
              savings to discover what they were paying for.

              CSS `order` is the fix: it applies in a single-column grid
              (mobile) and is overridden at `lg:`, where the two-column
              layout must keep controls on the left and summary on the
              right. No DOM reorder, no duplicate summary component, so the
              desktop sidebar cannot drift from the mobile card. */}
          <div className="order-2 space-y-6 lg:order-1">
            {/* Payment Method Section — dynamic, per
                `plan/features/SETTINGS.md §Payment Methods`. The
                list is sourced from
                `settings/hotelConfig.paymentMethods[]` and filtered
                to `isEnabled`. The "Pay at Hotel" method is just
                another entry — there is no separate global
                `payAtHotelEnabled` flag. If no methods are enabled
                (or the config hasn't loaded), the booking is
                blocked at the Confirm button. */}

            {/* Per MBUX-13 (decision #266, 2026-10-16): the
                optional-savings disclosure moved ABOVE the
                payment method card (was BELOW the payment proof
                upload). On mobile the pre-MBUX-13 order put the
                "Click to upload receipt photo" button BEFORE the
                "Have a voucher, points, or discount?" disclosure,
                so a guest who already sent payment via QR + uploaded
                the receipt had nothing to gain by then opening the
                disclosure. The fix puts the disclosure FIRST so
                the guest sees "you might have a discount / voucher"
                BEFORE they commit to "sending payment". MBUX-07
                (decision #259) still applies: the disclosure stays
                collapsed by default — this slice only reorders
                the placement, not the collapse-vs-expand state. */}
            <details
              // Per MBUX-14 (decision #267, 2026-10-16): the
              // disclosure is now OPEN by default. MBUX-13
              // deferred this state change (it was a placement
              // slice only); MBUX-14 picks up the deferred
              // state flip. Pre-MBUX-14 the guest had to tap
              // "Have a voucher, points, or discount?" to
              // even see the picker; on mobile this hid the
              // Senior/PWD + voucher + points options from
              // guests in a hurry, who would submit their
              // booking without realizing a discount was
              // available. MBUX-07 (decision #259) introduced
              // the collapsed-by-default shape to keep the
              // desktop Step 4 form compact; MBUX-13 reversed
              // the placement to put the disclosure ABOVE the
              // payment method card (so guests see it before
              // committing to a payment path); MBUX-14 flips
              // the default state so the disclosure is visible
              // without an extra tap. The disclosure's outer
              // style, chevron rotation, `appliedSavingsLabels`
              // line, and inner content are unchanged; only
              // the `open` attribute is added.
              //
              // Trade-off accepted: on desktop Step 4 the
              // expanded disclosure makes the form ~3 cards
              // longer. The added length is justified because
              // a missed discount is a worse outcome than a
              // longer form. The disclosure still collapses on
              // tap (chevron rotates back), so a guest who has
              // already applied nothing and doesn't want to
              // can collapse it.
              open
              className="group rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6"
              data-testid="optional-savings-disclosure"
            >
              <summary
                className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold text-gray-950"
                data-testid="optional-savings-summary"
              >
                <span>Have a voucher, points, or discount?</span>
                <ChevronDown size={18} aria-hidden className="transition-transform group-open:rotate-180" />
              </summary>
              {appliedSavingsLabels.length > 0 ? (
                <p
                  className="mt-2 text-sm font-medium text-gray-700"
                  data-testid="optional-savings-applied"
                >
                  Applied: {appliedSavingsLabels.join(", ")}
                </p>
              ) : null}
              <div className="mt-5 space-y-6">
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

            {/* Points Redemption Section (PR #9) — only renders when
                the admin toggle is on AND the signed-in member has a
                positive balance. Same 7 guards run server-side via the
                shared `applyPointsRedemption` helper. */}
            {memberSelfRedeemEnabled && memberAvailablePoints > 0 && (
              <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
                <h3 className="text-lg font-semibold text-gray-950">Apply Your Points</h3>
                <p className="mt-1 text-sm text-gray-600">
                  You have <span className="font-bold text-primary">{memberAvailablePoints.toLocaleString()}</span> points available.
                  {rewardsConfig?.pointsRedemptionRate ? (
                    <> Each 100 points = ₱{Number(rewardsConfig.pointsRedemptionRate).toLocaleString()} off your booking total.</>
                  ) : null}
                </p>

                {selfPointsApplied ? (
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-status-green-bg p-3 text-sm font-medium text-status-green-text">
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 size={16} />
                        {pendingPointsToRedeem.toLocaleString()} points · ₱{pendingRedemptionValue.toLocaleString()} off
                      </span>
                      <span className="ml-6 text-xs font-normal text-status-green-text/80">
                        New total ₱{displayTotal.toLocaleString()} — applied at booking submission
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingPointsToRedeem(0);
                        setSelfPointsInput("");
                        setSelfPointsApplied(false);
                        setSelfPointsError("");
                      }}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Points to apply
                      <input
                        type="number"
                        min={1}
                        max={memberAvailablePoints}
                        value={selfPointsInput}
                        onChange={(e) => {
                          setSelfPointsInput(e.target.value);
                          setSelfPointsError("");
                        }}
                        className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                      />
                      {(() => {
                        const entered = Math.max(0, Math.floor(Number(selfPointsInput) || 0));
                        const rate = Number(rewardsConfig?.pointsRedemptionRate || 0);
                        const value = entered > 0 && rate > 0 ? Math.round((entered * rate) / 100) : 0;
                        if (value <= 0) return null;
                        return (
                          <span className="font-normal text-gray-500">
                            Preview: ₱{value.toLocaleString()} off ·{" "}
                            {rewardsConfig?.minPointsToRedeem && entered < Number(rewardsConfig.minPointsToRedeem)
                              ? `below the ${rewardsConfig.minPointsToRedeem}-point minimum`
                              : `new total ₱${Math.max(0, total - value).toLocaleString()}`}
                          </span>
                        );
                      })()}
                    </label>
                    <button
                      type="button"
                      disabled={
                        !selfPointsInput.trim() ||
                        Number(selfPointsInput) <= 0 ||
                        Number(selfPointsInput) > memberAvailablePoints
                      }
                      onClick={() => {
                        const entered = Math.max(0, Math.floor(Number(selfPointsInput) || 0));
                        if (entered <= 0) {
                          setSelfPointsError("Enter a positive number of points to apply.");
                          return;
                        }
                        if (entered > memberAvailablePoints) {
                          setSelfPointsError(`You only have ${memberAvailablePoints.toLocaleString()} points available.`);
                          return;
                        }
                        setPendingPointsToRedeem(entered);
                        setSelfPointsApplied(true);
                        setSelfPointsError("");
                      }}
                      className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Apply at Booking
                    </button>
                  </div>
                )}

                {selfPointsError && (
                  <div className="mt-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">
                    <Info size={16} className="mt-0.5 shrink-0" />
                    <p>{selfPointsError}</p>
                  </div>
                )}
              </div>
            )}

            {/* Discount Section — rendered only while the online
                Senior/PWD claim path is enabled
                (`settings/hotelConfig.seniorPwdOnlineEnabled`).
                Per owner request 2026-10-13 (decision #231): when
                the toggle is off the whole card is dropped — no
                heading, no selector, and no "claims unavailable"
                note. The discount itself is unaffected: staff
                still apply the 20% at the front desk when an
                eligible guest presents a valid ID (RA 9994 /
                RA 10754). */}
            {seniorPwdOnlineEnabled && <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">
              <h3 className="text-lg font-semibold text-gray-950">Discount Options</h3>
              <p className="mt-1 text-sm text-gray-600">
                Select if you are eligible for government-mandated discounts. A valid ID must be uploaded.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {(["none", "senior", "pwd"] as const).map((type) => {
                  // Per the per-individual discount guard:
                  // the senior / PWD buttons are disabled
                  // when the cart has >1 room. The same
                  // derivation is read by the auto-revert
                  // useEffect above (which clears the
                  // selected type if the cart grows past
                  // 1 while the user is on the page).
                  const isPerIndividualType = type === "senior" || type === "pwd";
                  const disabledByGuard = isPerIndividualType && cartIsMultiRoom;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleDiscountChange(type)}
                      disabled={disabledByGuard}
                      aria-disabled={disabledByGuard}
                      title={
                        disabledByGuard
                          ? "Senior / PWD discounts are per-individual entitlements and apply to a single room. Please book the senior / PWD guest's room separately — you can add additional rooms in a second booking."
                          : undefined
                      }
                      data-testid={`guest-discount-type-${type}`}
                      className={cn(
                        "flex min-h-11 items-center justify-center rounded-lg border text-sm font-semibold transition px-4",
                        disabledByGuard
                          ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 opacity-60"
                          : discountType === type
                            ? "border-primary bg-primary-light text-primary"
                            : "border-gray-200 bg-white text-gray-700 hover:border-primary"
                      )}
                    >
                      {type === "none" ? "None" : type === "senior" ? "Senior Citizen (20%)" : "PWD (20%)"}
                    </button>
                  );
                })}
              </div>
              {cartIsMultiRoom && (
                <p className="mt-3 text-xs text-amber-700">
                  Senior Citizen and PWD discounts are per-individual entitlements and apply to a single room. If you need a senior or PWD discount, please book that guest's room in a separate booking — the additional rooms can be added to the same reservation from the front desk at check-in.
                </p>
              )}

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
            </div>}

              </div>
            </details>

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
                  {/* Per UX-DESK-01 (2026-10-16, decision #270):
                      adaptive columns based on the count of
                      payment methods. The pre-UX-DESK-01 grid
                      was `sm:grid-cols-2 lg:grid-cols-4`
                      (added by BF-10 to fit PayPal as a 4th
                      method). With the typical 2-method
                      config (GCash + Bank Transfer), `lg:grid-cols-4`
                      forced each button into 25% of the
                      container width — in the pre-UX-DESK-01
                      Step 4 sidebar (380px) that worked out to
                      ~80px per button, where "Bank Transfer"
                      wrapped onto three lines and the buttons
                      became visually unreadable. After the
                      Step 4 layout flip (UX-DESK-01) the
                      controls column is ~800px wide, but a
                      4-col grid with only 2 items still
                      leaves 2 dead columns on the right.

                      Rules: 1 method → 1 col (full-width
                      button); 2 methods → 2 cols at sm+; 3
                      methods → 2 cols at sm, 3 cols at lg; 4+
                      methods → 2 cols at sm, 4 cols at lg.
                      Tailwind needs the full class names in
                      source for the JIT to pick them up, so
                      each `lg:grid-cols-N` is gated by an
                      explicit count predicate rather than a
                      dynamic template-literal class. The
                      `sm:grid-cols-2` fallback covers the
                      typical 2-method config without any
                      additional predicate. */}
                  <div
                    className={cn(
                      "mt-4 grid gap-4",
                      availablePaymentMethods.length >= 2 && "sm:grid-cols-2",
                      availablePaymentMethods.length === 3 && "lg:grid-cols-3",
                      availablePaymentMethods.length >= 4 && "lg:grid-cols-4"
                    )}
                  >
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
                                Please send your payment of <span className="font-bold text-gray-800">{formatPrice(displayTotal)}</span> via {currentPaymentMethod.label}. The recipient name is <span className="font-bold text-gray-800">{currentPaymentMethod.accountName || config.legalName}</span>.
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
            {/* Per MBUX-06 (decision #258): the duplicate Step 4 terms
                checkbox is REMOVED. Step 3's `guestDetails.consent` is
                now the single authoritative consent control — see the
                `canConfirm` note above.

                The line this checkbox carried that Step 3 does NOT have
                — "I understand that my booking is subject to the
                cancellation policy selected" — is not silently lost:
                the cancellation-policy disclosure sits directly above
                and is always rendered. The guest READS the policy
                there; they do not tick it a second time.

                Kept intact: the Cloudflare Turnstile challenge below, the
                proof-of-payment upload, and the payment-method panel.
                None of them were part of the consent question. */}

            {/* Cloudflare Turnstile Challenge */}
            <div
              ref={turnstileContainerRef}
              className="mt-6 flex justify-center"
            ></div>

            {submitError && (
              <div className="flex flex-col gap-3 rounded-lg bg-red-50 p-4 text-sm font-medium text-red-700">
                <div className="flex gap-2">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  <p>{submitError}</p>
                </div>
                {/* Per NBS-2026-08-08 (F2): the recovery
                    CTA. The catch block sets
                    `submitErrorAction` to one of
                    "back-to-step-1" / "retry" / "none" —
                    the matching button renders here so
                    the user has an explicit next step
                    instead of a stranded "An error
                    occurred" message. The "back-to-step-1"
                    CTA cancels any pending auto-redirect
                    timer (F11) so the manual nav doesn't
                    race the auto-nav. */}
                {submitErrorAction === "back-to-step-1" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (redirectTimerRef.current !== null) {
                        window.clearTimeout(redirectTimerRef.current);
                        redirectTimerRef.current = null;
                      }
                      const nextParams = new URLSearchParams(searchParams);
                      nextParams.delete("step");
                      nextParams.delete("roomType");
                      setSearchParams(nextParams);
                      setSubmitError("");
                      setSubmitErrorAction("none");
                    }}
                    className="self-start min-h-11 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    Back to room selection
                  </button>
                )}
                {submitErrorAction === "retry" && (
                  <button
                    type="button"
                    onClick={() => {
                      setSubmitError("");
                      setSubmitErrorAction("none");
                      // The guest hits Confirm again —
                      // reset isSubmitting so the sticky
                      // footer CTA re-enables.
                      setIsSubmitting(false);
                    }}
                    className="self-start min-h-11 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    Dismiss and try again
                  </button>
                )}
              </div>
            )}
          </div>

          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={guests}
            nights={nights}
            // Per BR-08 (decision #238, 2026-10-14 — close-out):
            // the legacy `hasBreakfast` +
            // `breakfastIncludesChildren` +
            // `setBreakfastIncludesChildren` +
            // `breakfastRate` props are gone. The sidebar
            // reads the new `breakfastSelections` rich
            // shape only. The adult/child split
            // (`numAdults` + `numChildren`) stays so the
            // per-room summary can render the split.
            numAdults={numAdults}
            numChildren={numChildren}
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
              // Per BR-08 (decision #238, 2026-10-14 — close-out):
              // the legacy `hasBreakfast: boolean` per-room
              // flag is gone. The per-meal breakdown (rendered
              // below the room summary) shows the meal count for
              // the whole stay.
              breakfastCount: Object.keys(breakfastSelections || {}).length > 0
                ? Math.ceil(Object.keys(breakfastSelections).length / Math.max(distributedRoomCart.length, 1))
                : 0
            }))}
            typeValue={selectedTypeEntry?.value ?? ""}
            typeImageUrls={selectedTypeEntry ? getRoomTypeImages(roomTypes, selectedTypeEntry.value) : []}
            typeRates={selectedRoomRates}
            typeDescription={selectedTypeEntry?.description ?? ""}
            total={displayTotal}
            discountPct={discountPct}
            voucherDiscount={voucherDiscount}
            discountType={discountType}
            voucherApplied={voucherApplied}
            memberDiscountPct={memberDiscountPct}
            seasonalRateOverrides={seasonalRateOverrides}
            isMember={!!memberProfile}
            rateBreakdown={rateBreakdown}
            // Per BR-03 (2026-10-12, decision #232):
            // thread the new `breakfastSelections` rich
            // shape into the Step 3 review sidebar
            // (same pattern as the Step 2 sidebar
            // above). The Step 3 page reads the same
            // cart state, so the per-date breakdown
            // is identical.
            breakfastSelections={breakfastSelections}
          />
        </section>

        <BookingStickyFooter
          summary={
            <>
              <p className="text-sm text-gray-600">Total due</p>
              <p className="text-lg font-semibold text-gray-950">
                {isSubmitting
                  ? "Processing booking request..."
                  : uploadingDiscountId
                  ? "Uploading discount ID photo..."
                  : uploadingPaymentProof
                  ? "Uploading payment proof receipt..."
                  // Per NBS-2026-08-08 (F5): surface the
                  // missing Step 2 consent before the
                  // missing Step 3 terms checkbox, so the
                  // guest sees the gate they're about to
                  // trip on the server.
                  : !guestDetails.consent
                  ? "Confirm your guest details consent on the previous step"
                  : isIdUploadRequired
                  ? "Please upload your Senior/PWD ID"
                  : isPaymentProofRequired
                  ? "Please upload proof of payment"
                  : !turnstileToken
                  ? "Running a quick security check..."
                  : `Ready to confirm · ${formatPrice(displayTotal)}`}
              </p>
            </>
          }
        >
          <button
            type="button"
            onClick={handleConfirmBooking}
            disabled={!canConfirm || isSubmitting || uploadingDiscountId || uploadingPaymentProof}
            className="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary text-white font-semibold px-6 hover:bg-primary-dark transition disabled:bg-gray-300 disabled:text-gray-500 sm:min-w-56"
          >
            {/* Per MBUX-07 (decision #259): the action names the amount
                it commits to. A guest confirming a booking should not
                have to travel back up the page to remember the figure.
                It is `displayTotal` — the SAME value the summary card,
                the sidebar, and the create payload use, so the button
                can never quote a total that differs from the bill. */}
            {isSubmitting
              ? "Processing..."
              : `Place booking · ${formatPrice(displayTotal)}`}
          </button>
        </BookingStickyFooter>
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
            {/* Per MBUX-01: hidden on mobile — the stepper caption states the position. */}
            <p className="hidden text-sm font-semibold uppercase tracking-wide text-primary sm:block">Step 1 of 5</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Select your stay</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Choose dates, guests, and a room option. We will show room types available for your stay.
            </p>
          </div>
          {/* Per MBUX-11 (decision #264, 2026-10-16): the
              inline date strip is gone. The mobile-first
              StaySummaryStrip below renders directly under
              the StepIndicator on mobile (the user wanted the
              summary "on top part of the page for mobile" +
              an "Edit" affordance). On `lg:` the strip is
              hidden — the sidebar becomes the primary surface
              and the user already interacts with the picker
              there, so no Edit affordance is needed. The
              `lg:hidden` Tailwind utility on the strip
              prevents duplicate surfaces. */}
          <StaySummaryStrip
            checkIn={checkIn}
            checkOut={checkOut}
            nights={nights}
            guests={guests}
            // Per MBUX-18 (decision #275, 2026-10-16): the
            // Edit pencil opens the mobile bottom sheet
            // instead of smooth-scrolling to the aside. The
            // sheet is rendered just below this strip so the
            // open/close state lives next to the trigger in
            // the source tree.
            onEdit={() => setIsEditStayDetailsOpen(true)}
          />
          {/* Per MBUX-18 (decision #275, 2026-10-16): the
              mobile-only bottom sheet that the StaySummaryStrip's
              Edit pencil opens. The component is `lg:hidden`-
              guarded internally so the parent doesn't need to
              gate the render — on desktop the strip itself is
              hidden, so the sheet never opens. Threads the same
              state + handlers the aside uses so the live
              adults/children/date writes don't fork into a
              separate code path. */}
          <EditStayDetailsSheet
            open={isEditStayDetailsOpen}
            onClose={() => setIsEditStayDetailsOpen(false)}
            checkIn={checkIn}
            checkOut={checkOut}
            maxStayNights={maxStayNights}
            onRangeChange={(nextCheckIn, nextCheckOut) => {
              setCheckIn(nextCheckIn);
              setCheckOut(nextCheckOut);
              updateDateParams(nextCheckIn, nextCheckOut, adults);
            }}
            onCheckInChange={(value) => {
              setCheckIn(value);
              updateDateParams(value, checkOut, adults);
            }}
            onCheckOutChange={(value) => {
              setCheckOut(value);
              updateDateParams(checkIn, value, adults);
            }}
            adults={adults}
            maxGuestCapacity={maxGuestCapacity}
            onAdultsChange={updateAdults}
            numChildren={numChildren}
            onChildrenChange={updateChildren}
          />
        </div>
      </section>

      {/* Per UX-DESK-01 (2026-10-16, decision #270): the lg
          grid template swapped from `[320px_1fr]` to
          `[1fr_320px]`. The pre-UX-DESK-01 template put the
          320px column on column 1 and the 1fr column on
          column 2. Combined with the aside's `lg:order-2`
          (which puts the Stay details aside second → column 2)
          and the room-cards `<div>` (default `order: 0` →
          first → column 1), the room cards ended up in the
          320px column — `md:grid-cols-[280px_1fr]` inside
          each card then reserved 280px for the image and only
          ~40px for the text, so room type names like
          "Standard Room" wrapped to one letter per line and
          the desktop column went visually unreadable.
          Flipping the template makes the aside land in the
          320px column (column 2, RIGHT sidebar) and the room
          cards in the 1fr column (column 1, LEFT main), so
          each card has the full ~800px width the original
          design intended. Mobile behaviour is unchanged:
          below `lg:` the section collapses to a single column
          and the existing `order-1` / default `order: 0`
          stack (room cards first, Stay details below) still
          applies. */}
      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_320px] lg:px-8">
        {/* Per MBUX-07: `order-1` puts the summary above the controls on
            mobile; `lg:order-2` restores the right-hand sidebar.
            Per MBUX-11 (decision #264, 2026-10-16): the `id` is the
            scroll target for the StaySummaryStrip's Edit button on
            mobile (the strip is hidden on `lg:` so the user uses the
            sidebar directly on desktop, no Edit affordance needed).
            Per MBUX-18 (decision #275, 2026-10-16): the Edit pencil
            no longer scrolls here — it opens the EditStayDetailsSheet
            mobile bottom sheet instead. The `id` + `scroll-mt-32`
            remain as a defensive fallback for any deep link that
            jumps straight to the aside (the BookingStickyFooter's
            URL-driven scroll, accessibility tools, etc.) so a future
            regression that drops the id would still surface. */}
        <aside id="booking-stay-details-aside" className="order-1 lg:order-2 lg:sticky lg:top-28 lg:self-start scroll-mt-32">
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-lg font-semibold text-gray-950">Stay details</h2>
            <div className="mt-5 space-y-6">
              <DateRangePicker
                checkIn={checkIn}
                checkOut={checkOut}
                maxStayNights={maxStayNights}
                onRangeChange={(nextCheckIn, nextCheckOut) => {
                  setCheckIn(nextCheckIn);
                  setCheckOut(nextCheckOut);
                  updateDateParams(nextCheckIn, nextCheckOut, adults);
                }}
                onCheckInChange={(value) => {
                  setCheckIn(value);
                  updateDateParams(value, checkOut, adults);
                }}
                onCheckOutChange={(value) => {
                  setCheckOut(value);
                  updateDateParams(checkIn, value, adults);
                }}
              />

              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Adults
                <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
                  <button
                    aria-label="Remove one adult"
                    className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={adults <= 1}
                    type="button"
                    onClick={() => updateAdults(adults - 1)}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    <Users size={16} className="text-primary" />
                    {adults} {adults === 1 ? "adult" : "adults"}
                  </span>
                  <button
                    aria-label="Add one adult"
                    className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={adults >= maxGuestCapacity}
                    type="button"
                    onClick={() => updateAdults(adults + 1)}
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
                  indicator), not at the picker. Per CHD-11.2
                  (decision #193): the soft cap is `10` (a
                  sanity guard, not a domain constraint). Per
                  CHD-11.5 (decision #196): the picker is
                  Adults + Children directly; the children
                  cap of 10 stays (the historical "at least
                  one adult" floor is no longer needed — the
                  Adults stepper's min 1 enforces the rule). */}
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
                  </span>
                  <button
                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    aria-label="Increase children count"
                    onClick={() => updateChildren(numChildren + 1)}
                    // Per CHD-11.2 (2026-08-05, per decision
                    // #193): the cap is the soft 10 (the
                    // CHD-11 sanity guard, not a domain
                    // constraint). The pre-CHD-11.2 shape
                    // capped at the room's
                    // `selectedMaxSelectableChildren` (per
                    // CHD-11.1), which made the picker an
                    // enforcement layer instead of an
                    // exploration layer. The "Fits your
                    // group" chip + the submit gate are the
                    // commit surfaces — the picker is the
                    // exploration surface. The user can pick
                    // any number up to 10; the chip + submit
                    // gate tell them if it works.
                    disabled={numChildren >= 10}
                  >
                    <Plus size={16} />
                  </button>
                </div>
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
                {/* Per MBUX-03: the grouping moved into the shared
                    `<RoomCartLines>` so the desktop sidebar and the new
                    mobile tray cannot drift. The single
                    `deriveRoomTypeCapacityFit` helper still drives both
                    this surface and the room-type card's Fits / Tight /
                    Doesn't fit chip (CHD-11 + CHD-12 composition). */}
                <RoomCartLines
                  rooms={distributedRoomCart}
                  roomTypes={roomTypes}
                  idPrefix="cart-line"
                />
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
            {/* Per MBUX-02: the pre-MBUX-02 hint taught a control that
                no longer exists. The selection action is now on the
                card itself. */}
            <p className="text-sm text-gray-600">
              Choose a room to add it to your stay. Use the stepper on a selected room to change how many you need.
            </p>
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
                // Per BR-08 (decision #238, 2026-10-14 — close-out): the
                // legacy `liveBreakfastRate` flat-rate derivation
                // is gone. The per-meal picker (Step 2) reads
                // each meal's snapshotted `price` from the
                // catalog; the room-card preview shows the
                // room rate only (the breakfast add-on is
                // computed in Step 2 via the rich
                // `breakfastSelections` shape).
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
                // Per BR-08 (decision #238, 2026-10-14 — close-out):
                // the legacy `previewBreakfastOccupancy` derivation
                // + `calculateBreakfastAddOn` flat-rate preview
                // are gone. The Step 1 room-card preview shows
                // the room rate only; the per-meal breakfast
                // total is computed in Step 2 via the rich
                // `breakfastSelections` shape (which the user
                // populates per-date × per-guest).
                const breakfastOptionTotal = roomOnlyTotal;

                return (
                  <motion.article
                    key={type.value}
                    // Per MBUX-02: the selected card gets a primary
                    // border + shadow so the selection state is visible
                    // on the card itself, not only inside the action
                    // block. `aria-current` is deliberately NOT used
                    // here — this is not a navigation position.
                    aria-current={isSelected ? "true" : undefined}
                    className={`overflow-hidden rounded-card bg-white shadow-sm ring-1 ${
                      isSelected ? "ring-primary shadow-md" : "ring-gray-200"
                    }`}
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
                            {/* Per MBUX-02: the type pill is GONE. It
                                rendered the same `type.label` string as
                                the heading directly beneath it, twice in
                                a row, for no added meaning. */}
                            <h2 className="text-2xl font-semibold text-gray-950">{type.label}</h2>
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

                        {/* Per MBUX-02: the CARD is the selection target.
                            Pre-MBUX-02 this card showed two controls for one
                            decision — a "Rooms" quantity stepper AND a
                            "Room Only" `RateOption`. Since BR-03 (decision
                            #232) removed the "Room + Breakfast" alternative,
                            `Room Only` was the only rate option left and so
                            represented no choice at all; the panel merely
                            duplicated the stepper. `Room Only` survives as
                            the INTERNAL `rateChoice` on the cart item
                            (unchanged — API + backward compatibility); only
                            its visible panel is gone.

                            `updateRoomQuantity` is now the single mutation
                            path for add/remove. The pre-MBUX-02
                            `selectRoomType` handler is deleted with the
                            panel: with a single rate option its "untick"
                            branch was reachable only by clicking the same
                            lone panel twice, and its "switch rate in
                            place" branch had become unreachable entirely.

                            Per EXB-11.3 (decision #197) the EXB-11.3
                            invariant survives unchanged: NO room is
                            pre-selected on load. `Select this room` is the
                            user-explicit action that adds the first one. */}
                        <div className="mt-6 grid gap-3">
                          {isSelected ? (
                            <div
                              className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-primary bg-primary-light px-4"
                              data-testid={`room-type-selected-${type.value}`}
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-gray-950">
                                  {typeQuantity} selected
                                </span>
                                <span className="block text-xs text-gray-600">
                                  {formatPrice(roomOnlyTotal)} × {typeQuantity} for {nights}{" "}
                                  {nights === 1 ? "night" : "nights"}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  aria-label={`Remove one ${type.label} room`}
                                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-gray-700 ring-1 ring-gray-200 transition hover:ring-primary"
                                  onClick={() => updateRoomQuantity(type.value, typeQuantity - 1, entry.availableCount)}
                                >
                                  <Minus size={16} />
                                </button>
                                <span
                                  className="min-w-8 text-center text-lg font-semibold text-gray-950"
                                  aria-live="polite"
                                  data-testid={`room-type-quantity-${type.value}`}
                                >
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
                          ) : (
                            <>
                              <p className="text-sm text-gray-600">
                                {formatPrice(roomOnlyTotal)} for {nights} {nights === 1 ? "night" : "nights"} ·
                                up to {typeMaxCapacity} adult{typeMaxCapacity === 1 ? "" : "s"} ·{" "}
                                {entry.availableCount} available
                              </p>
                              <PrimaryButton
                                type="button"
                                onClick={() => updateRoomQuantity(type.value, 1, entry.availableCount)}
                                className="w-full"
                                data-testid={`select-room-${type.value}`}
                              >
                                Select this room
                              </PrimaryButton>
                            </>
                          )}
                        </div>
                          {/* Per BR-03 (2026-10-12, decision
                              #232): the legacy "Room + Breakfast"
                              toggle is GONE. The flat-rate
                              breakfast model is replaced by the
                              per-guest × per-date `breakfastSelections`
                              rich shape — guests pick their meals
                              (or skip) on a per-day grid in Step 2
                              instead of an all-or-nothing toggle
                              here. The Step 2 section also shows
                              the live meal catalog from
                              `usePublicSiteContent().breakfastConfig`
                              so the guest sees the per-meal prices
                              before they get to Step 2. */}
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

                        {/* Per EXB-11 (2026-08-04, per decision
                            #186) + EXB-11.1 (2026-08-04, per decision
                            #189) + EXB-11.4 (2026-08-06, per decision
                            #197): the per-type "Extras" sub-section.
                            Per EXB-11.1: moved to the BOTTOM of the
                            card (after the rate options + mixed-rates
                            panel) and rendered as a binary checkbox
                            when `maxExtraBeds === 1` (the counter is
                            the wrong shape for a yes/no decision; the
                            user can only set 0 or 1, but the counter
                            presents 3 affordances). For
                            `maxExtraBeds >= 2`, the EXB-11 counter
                            shape stays. The data model is unchanged:
                            `room.extraBedCount: number` (0 or 1 for
                            the checkbox case; 0..maxExtraBeds for the
                            counter case). `rebalanceGuestDistribution`
                            clamping unchanged. `updateExtraBedCount`
                            unchanged. Cart URL serialization
                            unchanged. Hidden when `maxExtraBeds === 0`
                            per the EXB-11 "no extra bed" edge case.

                            Per EXB-11.4: the visual reads directly
                            from `userExtraBeds` (the cart value) —
                            no derived floor value, no auto-init
                            useEffect. The user is in full control
                            of the extra-bed count. The cart starts at 0
                            and stays at 0 until the user ticks the
                            checkbox or increments the counter.
                            The checkbox is fully free (`disabled =
                            typeQuantity === 0` — the only disable
                            is "no room to mirror the count onto");
                            the counter's `[−]` is also fully free
                            (`disabled = typeQuantity === 0`); the
                            `[+]` clamps at the cap. The soft floor
                            is still computed for the over-cap
                            warning text (`softFloor >
                            typeMaxExtraBeds`) and for the submit
                            gate's `cartFitsGroup` check (catches
                            the under-floor case at Step 1 → Step 2
                            with the "Adjust room" CTA). The
                            pre-EXB-11.4 (EXB-11.2) auto-init was
                            removed — EXB-11.4 reverses the EXB-11.2 auto-init
                            stance. See
                            `plan/docs/DECISIONS-FEATURES.md #197`
                            for the full reasoning. */}
                        {(() => {
                          const typeMaxExtraBeds = Number(type.maxExtraBeds) || 0;
                          if (typeMaxExtraBeds === 0) return null;
                          // All rooms of this type share the
                          // same per-type count (the toggle is
                          // per-type, not per-room — see the
                          // spec's "per-type vs per-room" edge
                          // case). `updateExtraBedCount` mirrors
                          // the user's pick onto every room.
                          const userExtraBeds = selectedTypeRooms[0]?.extraBedCount ?? 0;
                          const typeExtraBedRate = Number(type.extraBedRate) || 0;
                          // The per-room overflow for this type
                          // against the current group. The soft
                          // floor is `requiredExtraBeds` (the
                          // per-room count the group needs to
                          // fit without over-cap). When the
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
                          // Per EXB-11.4 (2026-08-06, per decision
                          // #197): the visual reads directly from
                          // `userExtraBeds` (the cart value). No
                          // derived floor value, no auto-init
                          // useEffect — the user is in full control.
                          // The soft floor is still computed above
                          // (for the over-cap warning text + the
                          // submit gate) but no longer feeds the
                          // visual. The rate is only meaningful when
                          // the user has at least one room of this
                          // type in the cart (the toggle has nothing
                          // to multiply against when `typeQuantity
                          // === 0`). The disabled-when-zero-rows
                          // state on the
                          // control keeps the UX honest.
                          const stayTotal = userExtraBeds * typeExtraBedRate * nights;
                          // Per EXB-11.1: the checkbox is the
                          // right shape when `maxExtraBeds === 1`
                          // (a binary decision). For N >= 2, the
                          // counter is the right shape (the user
                          // might want exactly 1, not all-or-
                          // nothing). The `data-testid` markers
                          // differ between branches so the test
                          // surface is unambiguous.
                          if (typeMaxExtraBeds === 1) {
                            return (
                              <div
                                className="mt-6 grid gap-2"
                                aria-label={`${type.label} extras`}
                                data-testid={`extras-stepper-${type.value}`}
                              >
                                <label
                                  htmlFor={`extras-checkbox-${type.value}`}
                                  className="flex min-h-14 cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-gray-950">Add an extra bed</span>
                                    <span className="block text-xs text-gray-500">
                                      {typeQuantity > 0
                                        ? `${formatPrice(typeExtraBedRate)} / bed / night`
                                        : "Add at least one room to set extra beds"}
                                    </span>
                                  </span>
                                  <input
                                    type="checkbox"
                                    id={`extras-checkbox-${type.value}`}
                                    data-testid={`extras-checkbox-${type.value}`}
                                    // Per EXB-11.4: read from
                                    // `userExtraBeds` (the cart
                                    // value). The user is in full
                                    // control — the checkbox is
                                    // `checked` when the user has
                                    // ticked it, `unchecked` when
                                    // they haven't. No auto-init,
                                    // no soft-floor forcing.
                                    checked={userExtraBeds === 1}
                                    // Per EXB-11.4: the only
                                    // disable is "no room to
                                    // mirror the count onto"
                                    // (`typeQuantity === 0`). The
                                    // user can tick/untick freely
                                    // — the pre-EXB-11.4
                                    // `|| softFloor >= 1` rule
                                    // forced the checkbox on and
                                    // blocked the user from
                                    // unchecking it. The submit
                                    // gate (`cartFitsGroup`) catches
                                    // the under-floor case at
                                    // Step 1 → Step 2 with the
                                    // "Adjust room" CTA.
                                    disabled={typeQuantity === 0}
                                    onChange={(e) => updateExtraBedCount(type.value, e.target.checked ? 1 : 0, typeMaxExtraBeds)}
                                    // Per EXB-11.4: the
                                    // `aria-describedby` points
                                    // to the soft-floor warning
                                    // only when the warning is
                                    // on screen (i.e., `overCap`).
                                    // The pre-EXB-11.4
                                    // `softFloor >= 1` condition
                                    // pointed to a non-existent
                                    // element in the common case
                                    // (soft floor = 1, not
                                    // over-cap).
                                    aria-describedby={overCap ? `extras-soft-floor-warning-${type.value}` : undefined}
                                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                                  />
                                </label>
                                {/* Per BR-08 (decision #238, 2026-10-14 — close-out):
                                    the legacy EXB-12 extra-bed
                                    breakfast toggle is deleted.
                                    Extra-bed occupants are ordinary
                                    meal slots in Step 2 (the
                                    per-meal picker) — the Step 2
                                    sidebar renders a meal dropdown
                                    for every guest slot, including
                                    any extra-bed slots. The price
                                    hint "+ ₱X / bed / night" is
                                    gone (the per-meal picker shows
                                    the actual price snapshot). */}
                                {/* The legacy `extras-breakfast-toggle`
                                    surface was a stub kept alive for
                                    the BR-05 close-out — the BR-08
                                    close-out removes it entirely. */}
                                {/* Stay total + soft-floor
                                    warning (shared with the
                                    counter branch). The
                                    `userExtraBeds > 0` gate
                                    mirrors the EXB-11.1 spec
                                    (hide "₱0 for 2 nights" —
                                    it's noise). */}
                                {typeQuantity > 0 && userExtraBeds > 0 ? (
                                  <p
                                    className="text-xs text-gray-600"
                                    data-testid={`extras-stay-total-${type.value}`}
                                  >
                                    {formatPrice(stayTotal)} for {nights} {nights === 1 ? "night" : "nights"}
                                  </p>
                                ) : null}
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
                          }
                          // Counter branch (maxExtraBeds >= 2,
                          // EXB-11 unchanged).
                          return (
                            <div
                              className="mt-6 grid gap-2"
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
                                    // Per EXB-11.4: the only
                                    // disable is "no room to
                                    // mirror the count onto"
                                    // (`typeQuantity === 0`). The
                                    // pre-EXB-11.4
                                    // `|| userExtraBeds <= softFloor`
                                    // rule (EXB-11.1) blocked the
                                    // user from going below the
                                    // soft floor; the user is now
                                    // in full control and can go to
                                    // 0 even if the group needs the
                                    // bed. The submit gate catches
                                    // the under-floor case.
                                    disabled={typeQuantity === 0}
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
                              {/* Per BR-08 (decision #238, 2026-10-14 — close-out):
                                  the legacy EXB-12 extra-bed
                                  breakfast toggle is deleted.
                                  Extra-bed occupants are ordinary
                                  meal slots in Step 2 (the
                                  per-meal picker). The price
                                  hint "+ ₱X / bed / night" is
                                  gone (the Step 2 sidebar shows
                                  the per-meal price snapshot for
                                  any extra-bed slots). */}
                              {/* The counter-branch
                                  `extras-breakfast-toggle`
                                  surface was a stub kept alive
                                  for the BR-05 close-out — the
                                  BR-08 close-out removes it
                                  entirely. */}
                              {typeQuantity > 0 && userExtraBeds > 0 ? (
                                <p
                                  className="text-xs text-gray-600"
                                  data-testid={`extras-stay-total-${type.value}`}
                                >
                                  {formatPrice(stayTotal)} for {nights} {nights === 1 ? "night" : "nights"}
                                </p>
                              ) : null}
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

      {/* Per MBUX-03: the mobile multi-room cart tray. Gated to
          `lg:hidden` because from `lg:` up the sticky sidebar already
          renders the full cart — showing both would put the same lines
          on screen twice. Sits directly above the sticky footer: it is
          the only region a thumb reaches and the only region that does
          not scroll away, which is what makes the MBUX-02 card-level
          selection trustworthy on a phone. */}
      <div className="mx-auto max-w-7xl px-4 pb-4 lg:hidden">
        <RoomCartTray
          rooms={distributedRoomCart}
          roomTypes={roomTypes}
          formatTotal={formatPrice}
          aggregateTotal={displayTotal}
          fitComplete={cartDistributionComplete}
        />
      </div>

      <BookingStickyFooter
        summary={
          <>
            <p className="text-sm text-gray-600">
              Total for {distributedRoomCart.length} {distributedRoomCart.length === 1 ? "room" : "rooms"},{" "}
              {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
            </p>
            <p className="text-2xl font-semibold text-gray-950">
              {formatPrice(displayTotal)} <span className="text-sm font-normal text-gray-500">including selected options</span>
            </p>
          </>
}
        detail={
          !cartIsReady ? (
            // Per CHD-11 (2026-08-04, per decision #184):
            // the error message references the type label
            // (matching the CHD-12 cart-style summary) plus
            // a three-action "Adjust room" CTA that scrolls
            // to and highlights the offending room-type
            // card. The legacy "Add enough available rooms..."
            // text stays for the cart-distribution failure
            // case.
            firstFailingType && firstFailingRoom ? (
              <p
                id="step-one-occupancy-error"
                className="mx-auto mt-2 max-w-7xl text-right text-xs font-medium text-amber-700"
                role="alert"
              >
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
              <p
                id="step-one-occupancy-error"
                role="alert"
                className="mx-auto mt-2 max-w-7xl text-right text-xs font-medium text-amber-700"
              >
                {cartDistributionErrorMessage}
              </p>
            )
          ) : null
        }
      >
        {cartIsReady ? (
          // Per BR-09 (2026-10-14): the Step 1 →
          // Step 2 transition copy now uses the
          // destination step name ("add-ons"), not a
          // numbered "Step N" reference. The
          // `continueParams` URL stamp already points
          // at `step=add-ons` (see `continueParams`
          // above).
          <PrimaryButton to={`/book?${continueParams.toString()}`} className="sm:min-w-56">
            Continue to add-ons
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
      </BookingStickyFooter>
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
  // Per PR #9 fix (2026-10-13): the queued points redemption the
  // member applied via the BookingPage control. Surfaces as a
  // deductions line so the breakdown matches the discount the
  // server will subtract at booking creation.
  pendingRedemptionPoints?: number;
  pendingRedemptionValue?: number;
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
  const pendingPts = Number(input.pendingRedemptionPoints || 0);
  const pendingVal = Number(input.pendingRedemptionValue || 0);
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
      : []),
    // Per PR #9 fix (2026-10-13): the queued points redemption
    // line. Same shape as the other deductions — label + amount
    // — so the PriceBreakdown renders it consistently. Only
    // surfaced when the member has actually applied points (both
    // fields > 0); the rateBreakdown useMemo also depends on
    // `pendingPointsToRedeem`, so removing the redemption clears
    // this line.
    ...(pendingPts > 0 && pendingVal > 0
      ? [{
          label: `Spark Rewards points (${pendingPts.toLocaleString()} pts)`,
          amount: pendingVal
        }]
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
  // Per feature/booking-autofill-member-email: when true the input is
  // non-editable but the value still flows through onChange + form
  // submission. We use `readOnly` rather than `disabled` so the email
  // remains part of the Step 2 payload submitted to /api/bookings/create
  // (a disabled input is omitted from form submission).
  readOnly?: boolean;
}

function TextField({
  error,
  icon,
  label,
  onBlur,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
  id,
  name,
  autoComplete,
  readOnly = false
}: TextFieldProps) {
  return (
    // Per fix(guest-details-field-alignment): `content-start` keeps the
    // label's grid rows at their natural size. Without it, the default
    // `align-content: stretch` distributes any extra cell height (e.g. the
    // taller Email cell, which carries the "Linked to your ... account"
    // helper line) into the label row AND the input row — pushing the
    // sibling Phone input down by half the delta. The icon was centred on
    // the wrapper (not the input), so it drifted too.
    <label htmlFor={id} className="grid content-start gap-2 text-sm font-medium text-gray-700">
      {label}
      {required ? <span className="sr-only">required</span> : null}
      <span className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary">{icon}</span>
        <input
          id={id}
          name={name}
          autoComplete={autoComplete}
          className={cn(
            "block min-h-11 w-full rounded-lg border bg-white py-2 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light",
            error ? "border-red-300" : "border-gray-200",
            readOnly ? "cursor-default bg-gray-50 text-gray-700" : null
          )}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          type={type}
          value={value}
          aria-readonly={readOnly ? "true" : undefined}
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
  nights: number;
  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // legacy `breakfastIncludesChildren: boolean` +
  // `setBreakfastIncludesChildren` toggle is deleted. Children
  // are ordinary meal slots in Step 2 (the per-meal picker) —
  // there's no "include children" toggle to thread through to
  // the sidebar. The `numAdults` + `numChildren` props stay so
  // the room-summary line can show the adult/child split.
  numAdults: number;
  numChildren: number;
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
    // Per BR-08 (decision #238, 2026-10-14 — close-out):
    // the per-room `hasBreakfast: boolean` summary line is
    // gone. The per-room summary shows the per-room
    // breakfast count (the length of the rich
    // `breakfastSelections` map) instead.
    breakfastCount?: number;
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
  memberDiscountPct?: number;
  seasonalRateOverrides?: ReturnType<typeof useRoomTypes>["seasonalRateOverrides"];
  isMember?: boolean;
  rateBreakdown?: BookingRateBreakdown | null;
  // Per BR-03 (2026-10-12, decision #232) + BR-08 (decision
  // #238, 2026-10-14 — close-out): the new per-guest ×
  // per-date `breakfastSelections` rich shape. When
  // non-null, the aside renders the per-date breakdown
  // (one line per date) and recomputes the total via
  // `recomputeBreakfastTotal`. The legacy `breakfastRate`
  // prop is gone — the per-meal picker stamps each
  // entry's `price` snapshot at capture time.
  // plan).
  breakfastSelections?: Record<string, BreakfastSelectionEntry> | null;
}

function BookingReviewAside({
  checkIn,
  checkOut,
  guests,
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
  memberDiscountPct = 0,
  seasonalRateOverrides = [],
  isMember = false,
  rateBreakdown = null,
  // Per EXB-01 (2026-07-31).
  extraBedCount,
  extraBedRate,
  // Per BR-03 (2026-10-12, decision #232) + BR-08 (decision
  // #238, 2026-10-14 — close-out): the new per-guest ×
  // per-date `breakfastSelections` rich shape (see
  // `BookingReviewAsideProps`). The legacy `hasBreakfast:
  // boolean` + `breakfastRate: number` +
  // `breakfastIncludesChildren: boolean` props are deleted;
  // the sidebar reads the new shape only.
  breakfastSelections = null
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

  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // sidebar's breakfast math reads the new
  // `breakfastSelections` rich shape. The legacy fallback
  // to `calculateBreakfastAddOn` is gone — the new shape is
  // the single source of truth. A booking with no breakfast
  // selections reads as `breakfastTotal: 0` and renders no
  // per-date lines.
  const perDateBreakfastLines = breakfastSelections
    ? buildBreakfastRateBreakdownLines(breakfastSelections)
    : [];
  const breakfastTotal = breakfastSelections
    ? recomputeBreakfastTotal(breakfastSelections)
    : 0;
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

  // Per UX-DESK-01 (2026-10-16, decision #270): the summary
  // aside gets `order-1 lg:order-2` to mirror the controls
  // column's `order-2 lg:order-1` (per MBUX-07,
  // BOOKING-FLOW.md:356). Without these classes the aside
  // defaulted to `order: 0`, which is LOWER than the
  // controls' `lg:order-1` (= 1) — so the auto-placement rule
  // "lower order → column 1" sent the aside into the 1fr main
  // column and the payment column into the 380px sidebar,
  // inverting the desktop layout the spec calls for. With
  // `order-1 lg:order-2`:
  //
  //   - Mobile (single column): aside (1) FIRST → TOP,
  //     controls (2) SECOND → BELOW. Matches MBUX-07's
  //     "summary first on mobile" rule.
  //   - `lg:` (two-column grid): aside (2) SECOND → column 2
  //     (380px RIGHT sidebar), controls (1) FIRST → column 1
  //     (1fr LEFT main). The controls + payment + upload now
  //     own the wide main column where the guest commits the
  //     booking, and the room summary is the reference
  //     sidebar on the right.
  //
  // The pre-UX-DESK-01 code only had the matching classes on
  // the controls column; the summary aside was missing its
  // half, which is what produced the inverted layout on
  // `/book` Step 4.
  //
  // Safe for Steps 2 + 3 (which render the same aside)
  // because their forms come first in DOM order with default
  // `order: 0`; the aside at order 2 on lg still lands in
  // column 2 the way it did before, and at mobile the aside
  // at order 1 still lands below the form (form-first, not
  // summary-first, on Steps 2 + 3 — matches existing design;
  // only Step 4 needed "summary first on mobile").
  return (
    <aside className="order-1 lg:order-2 lg:sticky lg:top-28 lg:self-start">
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
                    {/* Per BR-08 (decision #238, 2026-10-14 — close-out):
                        the legacy `hasBreakfast: boolean` flag is gone.
                        The per-room summary shows the per-room breakfast
                        count (the length of the rich
                        `breakfastSelections` map) instead. */}
                    {(room.breakfastCount ?? 0) > 0 ? ` · ${room.breakfastCount} meal${room.breakfastCount === 1 ? "" : "s"}` : ""}
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
            {/* Per BR-08 (decision #238, 2026-10-14 — close-out):
                the "Children's room charge" line is gone
                (children are ordinary meal slots in Step 2
                — there's no children-included toggle to
                surface here). The room subtotal already
                reflects the adult/child split per room. */}
	            {rateBreakdown ? (
              <PriceBreakdown breakdown={rateBreakdown} total={total} />
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Room rate</span>
                  <span>{formatPrice(roomTotal)}</span>
                </div>
                {perDateBreakfastLines.length > 0 || breakfastTotal > 0 ? (
                  <>
                    {/* Per BR-03 (2026-10-12, decision
                        #232) + BR-08 (decision #238,
                        2026-10-14 — close-out): the
                        per-date breakfast breakdown
                        from the rich
                        `breakfastSelections` shape.
                        One line per date, aggregated
                        so the sidebar reads naturally
                        for a 3-night stay (3 lines,
                        not N×guest lines). The legacy
                        "include children" toggle is
                        gone — children are ordinary
                        meal slots in Step 2 (the
                        per-meal picker). */}
                    {perDateBreakfastLines.length > 0 ? (
                      perDateBreakfastLines.map((line, index) => (
                        <div key={`bf-${index}`} className="flex justify-between">
                          <span>{line.label}</span>
                          <span>{formatPrice(line.amount)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="flex justify-between">
                        <span>Breakfast add-on</span>
                        <span>{formatPrice(breakfastTotal)}</span>
                      </div>
                    )}
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

