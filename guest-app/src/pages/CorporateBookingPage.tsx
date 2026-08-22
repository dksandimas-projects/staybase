import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";

import { useGuestAuth } from "../context/GuestAuthContext";

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
  // Per EXB-07 (2026-08-01, per decision #155): the
  // capacity overflow rule (per decision #153) is the
  // single source of truth for whether the requested
  // occupancy fits the room type. The corporate /book
  // page uses the helper client-side to render the
  // "blocked by cap → add an extra bed" contextual
  // message before the user reaches the review step.
  requiredExtraBedsFor,
  staggerChild,
  staggerContainer,
  VERSION,
  // Per MRB-02.x corporate (2026-08-02, per decision
  // #164): the reservation-level idempotency key.
  // Preallocated client-side so a
  // retry-after-uncertain-response uses the same
  // `reservationId`; the server's transaction reads it
  // first and either replays the original commit (same
  // `requestFingerprint`) or returns a 409 (different
  // `requestFingerprint`). Same pattern as the public
  // `/book` flow (`BookingPage.tsx`).
  generateReservationId
} from "@spark-inn/shared";
// Per MRB-08 (2026-08-02, per decision #167): the
// corporate `/corporate/book` page mirrors
// `BookingPage`'s room cart (MRB-06) so a corporate
// group can book a block of rooms. The same shared
// `rebalanceGuestDistribution` helper distributes the
// page-level `numAdults` + `numChildren` totals across
// the cart's per-stay occupancy, and the same
// `serializeBookingRoomCart` / `parseBookingRoomCart`
// helpers round-trip the cart through the `?rooms=`
// URL param so a refresh keeps the user's selection.
import {
  parseBookingRoomCart,
  rebalanceGuestDistribution,
  serializeBookingRoomCart,
  type BookingRoomCartItem
} from "../utils/bookingRoomCart";
import { collection, doc, getDoc, getFirestore } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
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
  // Per feature/booking-autofill-member-email-corporate: mirrors
  // the public /book flow (BookingPage.tsx). When a member is signed
  // in we autofill + lock the corporate Step 2 email field to the
  // member's account email so the booking is always filed under the
  // correct identity.
  const { memberProfile } = useGuestAuth();
  const currentStepKey = searchParams.get("step") ?? "gate";
  const [bookingId] = useState(() => doc(collection(getFirestore(), "bookings")).id);
  // Per MRB-02.x corporate (2026-08-02, per decision
  // #164): the reservation-level idempotency key,
  // preallocated client-side for the same reason as
  // `bookingId`. Held in a `useState` lazy init so the
  // same id survives across renders and
  // retry-after-uncertain-response. Generated via the
  // shared `generateReservationId` helper so the id
  // shape is guaranteed to pass `RESERVATION_ID_REGEX`
  // validation on the server.
  const [reservationId] = useState(() => generateReservationId());

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
  // Per NBS-2026-08-08 (F10, booking-flow audit 2026-08-08):
  // the previous `useState(searchParams.get("checkIn") ?? ...)`
  // accepted any URL value verbatim — a direct hit to
  // `/corporate/book?checkIn=invalid` seeded the form with
  // `checkIn: "invalid"`, the date picker showed a blank,
  // and the submit hit the server's 400 "Invalid check-in
  // or check-out date." with no clear back-to-Step-1
  // affordance (see F2). The fix: parse the URL value
  // through the YYYY-MM-DD shape; an invalid or missing
  // value falls back to today's Manila date. The same
  // pattern guards `checkOut` (a missing URL value
  // previously landed as `null` → empty date input).
  const initialCheckInParam = searchParams.get("checkIn");
  const initialCheckOutParam = searchParams.get("checkOut");
  const isValidDateKey = (value: string | null) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const [checkIn, setCheckIn] = useState(
    isValidDateKey(initialCheckInParam)
      ? initialCheckInParam!
      : getDateKeyInTimezone(config.timezone, 1)
  );
  const [checkOut, setCheckOut] = useState(
    isValidDateKey(initialCheckOutParam)
      ? initialCheckOutParam!
      : getDateKeyInTimezone(config.timezone, 2)
  );
  // Per EXB-07 (2026-08-01, per decision #155): the
  // corporate /book page gains the same adult/child split
  // + extra bed count the guest /book page already has.
  // The single `guests` stepper is replaced by 3 steppers
  // (adults >= 1, children >= 0, extra beds >= 0). The
  // `guests` value (the persisted `numGuests` total) is
  // derived from the adult + child sum, matching the
  // server's CHD-04 derivation. Legacy callers that
  // still pass `?guests=N` in the URL hydrate the sum
  // into `numAdults = N, numChildren = 0` (the historical
  // "all guests are adults" shape, preserved for
  // back-compat with existing marketing links).
  //
  // Per MRB-08 (2026-08-02, per decision #167): the
  // adults + children totals are still page-level. They
  // are the guest's stated "we are N adults and M
  // children" — the page distributes them across the
  // room cart's per-stay occupancy via
  // `rebalanceGuestDistribution` (same helper the public
  // `/book` page uses per MRB-06). `extraBedCount` is no
  // longer a per-page field; the rebalance helper
  // derives the per-stay count from the room type's
  // `maxExtraBeds` + the leftover guests after capacity
  // allocation, and the server (per EXB-03) validates
  // the result against the EXB-10 reservation-atomic
  // inventory check.
  const initialGuests = Number(searchParams.get("guests") ?? 2);
  const [numAdults, setNumAdults] = useState(initialGuests);
  const [numChildren, setNumChildren] = useState(0);
  // Per EXB-07 (2026-08-01, per decision #155): a
  // per-page "extra beds" stepper. This is the
  // single-room UX — for N=1 the rebalance helper
  // applies the count to the only stay. For N>1
  // (per MRB-08) the per-stay extra bed count is
  // derived by the rebalance helper from the
  // room type's `maxExtraBeds` + leftover guests, so
  // the page-level stepper is hidden in the cart
  // (the per-stay count is authoritative).
  const [extraBedCount, setExtraBedCount] = useState(0);
  const guests = numAdults + numChildren;
  // Per MRB-08 (2026-08-02, per decision #167): the
  // room cart. Each entry is one room stay. Mirrors
  // the public `/book` flow's `BookingPage.tsx` cart.
  // Hydrated from `?rooms=` (round-tripped via
  // `parseBookingRoomCart` / `serializeBookingRoomCart`)
  // so a refresh keeps the user's selection. When the
  // URL carries no `?rooms=` and no `?roomType=`, the
  // cart starts empty and is auto-seeded with the first
  // available type by the effect below — preserving
  // the pre-MRB-08 "one stay of the first type"
  // default when a corporate guest lands on Step 1 with
  // no pre-selected type.
  const [roomCart, setRoomCart] = useState<BookingRoomCartItem[]>(() => {
    const fromUrl = parseBookingRoomCart(searchParams.get("rooms"));
    return fromUrl.length > 0 ? fromUrl : [];
  });
  // The `selectedRoomType` page-level state from the
  // pre-MRB-08 single-room flow is now derived from
  // the cart: the first cart entry's type is the
  // "primary" type for back-compat (the `?roomType=`
  // URL param, the gate redirect, the single-room
  // legacy read sites). Setting it from outside
  // mutates the first cart entry — preserves the
  // existing `selectRoomType` flow used by the
  // Step 1 room-type cards.
  const selectedRoomType = roomCart[0]?.roomType ?? "";
  const setSelectedRoomType = (next: string) => {
    setRoomCart((current) => {
      if (current.length === 0) return current;
      const [first, ...rest] = current;
      return [{ ...first, roomType: next }, ...rest];
    });
  };
  // Per MRB-08: the whole reservation shares one
  // breakfast choice (every stay in the cart uses
  // the same `rateChoice`). The per-stay pricing the
  // server writes (MRB-04) mirrors this — every
  // child booking doc has the same `hasBreakfast`
  // flag. The page-level `rateChoice` is unchanged
  // from the pre-MRB-08 implementation; the cart
  // hydrates each stay with the same value on add.
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
    // Per feature/booking-autofill-member-name-corporate: mirror the
    // public /book flow (BookingPage.tsx). When the guest is signed
    // in as a Spark Rewards member, pre-fill the Step 2 name + phone
    // from the member profile. The same `fullName.split(" ")` shape
    // ProfilePage.tsx uses applies. URL params keep precedence so the
    // corporate re-book flow can still pin first/last/phone via the
    // URL. The name fields are then rendered as readOnly below — see
    // the first/last <TextField>s for the matching render-time gate.
    // Email is handled by the existing email-only block below; phone
    // stays editable (members may travel on a secondary phone — per
    // the autofill+lock UX decision 2026-08-20).
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
    // Per feature/booking-autofill-member-email-corporate: same
    // contract as BookingPage.tsx. The URL `?email=` keeps precedence
    // (the corporate "personal-pay" path can pass a billing-email
    // override) so the member cannot accidentally have a different
    // value pinned by an old link. The field is rendered readOnly
    // below when `memberProfile?.isMember` is true.
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
    guestCount: String(Number(searchParams.get("guests") ?? 2)),
    designation: searchParams.get("designation") ?? "",
    companyName: companyName || (searchParams.get("companyName") ?? ""),
    companyAddress: searchParams.get("companyAddress") ?? "",
    purposeOfStay: searchParams.get("purposeOfStay") ?? "Business Travel",
    billingArrangement: (searchParams.get("billingArrangement") as "personal" | "chargeback") ?? "personal",
    requests: searchParams.get("requests") ?? "",
    consent: false,
    _hp: ""
  });

  // Per fix/booking-autofill-member-profile-race (2026-08-22):
  // the `guestDetails` initializer above runs ONCE on mount.
  // `memberProfile` arrives asynchronously via
  // `onAuthStateChanged` + Firestore `onSnapshot` (typically
  // 200–500ms after mount), so the initializer always sees
  // `memberProfile = null` and every autofill branch falls
  // through to `""`. The form fields stayed empty even for
  // signed-in members on the corporate flow.
  //
  // This effect re-applies the autofill when `memberProfile`
  // lands (or changes). Mirrors the BookingPage.tsx fix exactly.
  // URL params keep precedence (the corporate re-book flow
  // can pin first/last/phone via the URL), the "only fill
  // empty fields" guard preserves user edits typed in the
  // gap between mount and snapshot.
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
  const [proofUpload, setProofUpload] = useState<{ name: string; path: string } | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("gcash");
  const [paymentProofError, setPaymentProofError] = useState("");
  const [termsConsent, setTermsConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Per NBS-2026-08-08 (F2): the recovery action the
  // sticky footer's error CTA should render alongside
  // the submit error. The catch block in the create
  // handler maps the server error to one of three
  // actions — "back-to-step-1" / "retry" / "none" — so
  // the user has an explicit next step instead of a
  // stranded message. The discriminator mirrors the
  // public `/book` flow's shape.
  const [submitErrorAction, setSubmitErrorAction] = useState<"back-to-step-1" | "retry" | "none">("none");
  // Per NBS-2026-08-08 (F11): the auto-redirect timer
  // for the "Room no longer available" path is held on
  // a ref so the user can cancel it by navigating
  // manually (clicking the back CTA or the browser back
  // button) before the 5s elapses. The cleanup effect
  // below cancels any pending timer on unmount.
  //
  // Per L-06 (corporate audit 2026-08-10): the effect
  // also runs on `currentStepKey` change so a
  // navigation away from review (e.g. the user clicks
  // back to Step 1 or 2) does not fire the stale
  // redirect. The pre-L-06 effect only ran on unmount,
  // which a same-page nav (URL searchParam change) does
  // not trigger — the timer would still fire and
  // override the user's manual nav.
  const redirectTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, [currentStepKey]);

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
      requireReferenceNumber?: boolean;
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

  // Per MRB-08 (2026-08-02, per decision #167): the
  // auto-seed effect. When the cart is empty AND the
  // page-level occupancy is set, seed the cart with a
  // single stay of the URL-supplied `?roomType=` (or
  // the first available type if none). Mirrors the
  // pre-MRB-08 "one stay of the selected type" default
  // so a guest landing on `/corporate/book?step=select-room`
  // with no `?rooms=` still sees a populated cart.
  // The effect is gated on the room types having
  // loaded (no `roomsLoading` flicker) and on the
  // cart being empty (no-op after the user has
  // added rooms).
  //
  // Per M-04 (corporate booking audit 2026-08-10):
  // the URL `?roomType=` value is validated against
  // the room type catalog before the seed runs. A
  // direct hit to `/corporate/book?roomType=does-not-exist`
  // used to seed the cart with an unknown type — the
  // guest picked dates + occupancy, then hit a 400 on
  // submit from the server's strict `publicRoomSelectionSchema`.
  // The fix falls back to the first available type on
  // miss (same shape as the F10 date URL fallback at
  // `CorporateBookingPage.tsx:172-185`). A missing URL
  // value still falls back to the first available type.
  useEffect(() => {
    if (roomCart.length > 0) return;
    if (roomsLoading || roomTypes.length === 0) return;
    const fromQuery = searchParams.get("roomType");
    const fromQueryIsValid = fromQuery
      ? roomTypes.some((type) => type.value === fromQuery)
      : false;
    const candidate = fromQueryIsValid
      ? roomTypes.find((type) => type.value === fromQuery)
      : availableRoomTypes[0]?.type;
    if (!candidate) return;
    setRoomCart([{
      bookingId: doc(collection(getFirestore(), "bookings")).id,
      roomType: candidate.value,
      rateChoice,
      numAdults: 0,
      numChildren: 0,
      extraBedCount: 0
    }]);
    // `rateChoice` is intentionally captured in the
    // initial seed only — the user can toggle the
    // breakfast choice later; that toggle re-stamps
    // every stay via `setRateChoice` + a follow-up
    // effect (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsLoading, roomTypes, availableRoomTypes, searchParams]);

  // Per MRB-08: re-stamp the `rateChoice` field on
  // every cart stay when the page-level toggle
  // changes. A shared breakfast choice across the
  // whole reservation (every stay with the same
  // flag) is the minimum viable scope; per-stay
  // breakfast selection is a future iteration.
  useEffect(() => {
    setRoomCart((current) => current.map((stay) => ({ ...stay, rateChoice })));
  }, [rateChoice]);

  // Per MRB-08: the distributed room cart. The
  // shared `rebalanceGuestDistribution` helper
  // distributes the page-level `numAdults` +
  // `numChildren` totals across the cart's per-stay
  // occupancy, respecting each room type's
  // `maxCapacity` + `maxChildren` + `maxExtraBeds`.
  // For N=1 the result is byte-equivalent to the
  // pre-MRB-08 single-room path (1 adult + the rest
  // of the adults, all the children, extra beds
  // applied to the only stay). The result is the
  // source of truth for the per-stay pricing and
  // the submit body.
  const cartDistribution = useMemo(
    () => rebalanceGuestDistribution(
      roomCart.length > 0 ? roomCart : [{
        bookingId: doc(collection(getFirestore(), "bookings")).id,
        roomType: roomTypes[0]?.value ?? "",
        rateChoice,
        numAdults: 0,
        numChildren: 0,
        extraBedCount: 0
      }],
      roomTypes,
      numAdults,
      numChildren
    ),
    [roomCart, roomTypes, numAdults, numChildren, rateChoice]
  );
  const distributedRoomCart = cartDistribution.rooms;
  const unassignedAdults = cartDistribution.unassignedAdults;
  const unassignedChildren = cartDistribution.unassignedChildren;

  // Per MRB-08: cart mutation helpers. Each one
  // is a one-line setState — kept named (not
  // inlined) so the JSX stays readable and the
  // single-room pre-MRB-08 read sites that
  // referenced `selectedRoomType` continue to
  // work through the derived `selectedRoomType`
  // above.
  function addRoomToCart(typeValue: string) {
    setRoomCart((current) => {
      const next = [...current];
      // Find a type with the requested value;
      // fall back to the first available type
      // when the requested value isn't recognised
      // (a stale URL can carry a deleted type).
      const safeType = roomTypes.find((type) => type.value === typeValue)
        ?? availableRoomTypes[0]?.type
        ?? null;
      if (!safeType) return current;
      // The new stay's occupancy is left at 0
      // adults + 0 children; the rebalance
      // helper on the next render distributes the
      // page totals. This keeps the helper as
      // the single source of truth for "where
      // do the guests go".
      next.push({
        bookingId: doc(collection(getFirestore(), "bookings")).id,
        roomType: safeType.value,
        rateChoice,
        numAdults: 0,
        numChildren: 0,
        extraBedCount: 0
      });
      return next;
    });
  }
  function removeRoomFromCart(index: number) {
    setRoomCart((current) => current.length <= 1 ? current : current.filter((_, idx) => idx !== index));
  }
  function setRoomTypeAt(index: number, typeValue: string) {
    setRoomCart((current) => current.map((stay, idx) => idx === index ? { ...stay, roomType: typeValue } : stay));
  }

  const selectedTypeEntry = roomTypes.find((type) => type.value === selectedRoomType)
    ?? availableRoomTypes[0]?.type
    ?? null;
  // Per W3.6 — pricing + max occupancy live on the room's type.
  const selectedRoomRates = selectedTypeEntry ? getRoomTypeRates(roomTypes, selectedTypeEntry.value) : null;
  const selectedMaxCapacity = selectedRoomRates?.maxCapacity ?? 0;
  const hasBreakfast = breakfastConfig.isEnabled && rateChoice === "room-breakfast";
  const breakfastRatePerPerson = breakfastConfig.ratePerPersonPerNight;

  // Per MRB-08 (2026-08-02, per decision #167): the
  // per-stay negotiated rate. Each stay's rate is
  // resolved independently from the
  // `corporateCodes/{code}.ratePerRoomType` map
  // (then the stay type's flat `corporateRate`, then
  // the standard `pricePerNight`). The pre-MRB-08
  // single-rate fallback chain (negotiated for the
  // primary type only) would silently over- or
  // under-charge a mixed-type corporate block. The
  // server's `handleCreateBooking` mirrors the same
  // per-stay chain (see `roomStayPricing` derivation
  // in `guest-app/server/handlers/bookings.ts`); the
  // client preview and the server invoice are
  // byte-equivalent as a result.
  const perStayPricing = useMemo(() => {
    return distributedRoomCart.map((stay) => {
      const stayType = roomTypes.find((type) => type.value === stay.roomType);
      const baseRate = Number(stayType?.pricePerNight) || 0;
      const typeCorp = Number(stayType?.corporateRate) || 0;
      const negotiated = ratePerRoomType && ratePerRoomType[stay.roomType] !== undefined
        ? ratePerRoomType[stay.roomType]
        : null;
      const stayHasBreakfast = breakfastConfig.isEnabled && stay.rateChoice === "room-breakfast";
      const stayRate = (ratePerRoomType || isFlatRate)
        ? (negotiated !== null
            ? negotiated
            : (typeCorp > 0 ? typeCorp : baseRate))
        : baseRate;
      const stayRoomSubtotal = stayRate * nights;
      const stayBreakfastSubtotal = stayHasBreakfast
        ? breakfastRatePerPerson * (stay.numAdults + stay.numChildren) * nights
        : 0;
      const stayExtraBedRate = Number(stayType?.extraBedRate) || 0;
      const stayExtraBedSubtotal = stayHasBreakfast ? 0 : stay.extraBedCount * stayExtraBedRate * nights;
      // Per EXB-01 (2026-07-31): the extra-bed
      // total is added to the room subtotal (not
      // the breakfast subtotal). The server
      // mirrors this in `roomStayPricing`.
      return {
        stay,
        stayRate,
        stayRoomSubtotal,
        stayBreakfastSubtotal,
        stayExtraBedSubtotal,
        staySubtotal: stayRoomSubtotal + stayBreakfastSubtotal + stayExtraBedSubtotal
      };
    });
  }, [distributedRoomCart, roomTypes, ratePerRoomType, isFlatRate, breakfastConfig, breakfastRatePerPerson, nights]);

  // Per MRB-08: the aggregate totals. Each is the
  // sum over the distributed room cart's per-stay
  // lines, byte-equivalent to the server's
  // `subtotal` / `breakfastTotal` / `extraBedTotal`
  // / `totalPrice` derivation in `roomStayPricing`.
  // The sticky footer + the Step 3 review card
  // render these so the user sees one number for
  // the whole reservation, with the per-stay
  // breakdown available in the cart itself.
  const roomTotal = perStayPricing.reduce((sum, line) => sum + line.stayRoomSubtotal, 0);
  const breakfastTotal = perStayPricing.reduce((sum, line) => sum + line.stayBreakfastSubtotal, 0);
  const extraBedTotal = perStayPricing.reduce((sum, line) => sum + line.stayExtraBedSubtotal, 0);
  const subtotal = roomTotal + breakfastTotal + extraBedTotal;
  // Per MRB-08: the legacy `ratePerNight` is still the
  // primary type's rate (used by the legacy single-room
  // UI on the sticky footer + the Step 3 review).
  // `hasBreakfast` is declared above (it's the page-level
  // flag the rest of the file already reads).
  const negotiatedRate = selectedTypeEntry && ratePerRoomType && ratePerRoomType[selectedTypeEntry.value] !== undefined
    ? ratePerRoomType[selectedTypeEntry.value]
    : (selectedRoomRates?.corporateRate || selectedRoomRates?.pricePerNight || 0);
  const baseRate = negotiatedRate;
  const ratePerNight = baseRate;

  // Calculate total
  // Per BF-08 (booking-flow audit 2026-06-26) +
  // per MRB-08 (2026-08-02, per decision #167):
  // for N=1 the total is the pre-MRB-08 single-room
  // sum (the legacy `calculateBookingTotal` derivation,
  // which is byte-equivalent to the server's
  // `subtotal` for a corporate flat or negotiated
  // rate). For N>1 the total is the sum of the
  // per-stay `staySubtotal` values from
  // `perStayPricing` (the per-stay room + breakfast
  // + extra bed lines) — which is also byte-equivalent
  // to the server's `subtotal` for the whole
  // reservation. The two paths produce the same
  // number when the cart has a single stay.
  const total = distributedRoomCart.length <= 1
    ? calculateBookingTotal({
        ratePerNight,
        numNights: nights,
        roomTotal,
        numGuests: guests,
        breakfastRate: breakfastRatePerPerson,
        hasBreakfast,
        discountPct: 0, // discounts already applied to ratePerNight
        voucherDiscount: 0 // corporate flow doesn't use standard vouchers
      })
    : perStayPricing.reduce((sum, line) => sum + line.staySubtotal, 0);

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

  // Per EXB-07 (2026-08-01, per decision #155): the
  // 3 occupancy steppers on the corporate /book page.
  // Each stepper has a `safeX` guard so the value
  // stays in the per-stepper range. Updating any
  // stepper persists the values to the URL params
  // (parallel to the legacy `?guests=N` for back-compat)
  // so a refresh keeps the user's choice.
  function setAdults(next: number) {
    const safe = Math.max(1, Math.floor(Number(next) || 1));
    setNumAdults(safe);
  }
  function setChildren(next: number) {
    const safe = Math.max(0, Math.floor(Number(next) || 0));
    setNumChildren(safe);
  }
  function setExtraBeds(next: number) {
    const max = Number(selectedTypeEntry?.maxExtraBeds) || 0;
    const safe = Math.max(0, Math.min(Math.floor(Number(next) || 0), max));
    setExtraBedCount(safe);
  }
  // Per EXB-07: the EXB-03 overflow rule (per decision
  // #153) is the single source of truth for whether the
  // requested occupancy fits the room type. The
  // `requiredExtraBedsFor` helper is the same one the
  // server uses, so the client-side preview is
  // byte-equivalent to the server's `handleCreateBooking`
  // check. When `requiredExtraBeds > extraBedCount`, the
  // contextual hint below the steppers offers the path
  // through (add an extra bed) instead of letting the
  // guest hit a dead-end server error.
  const corpOverflow = selectedTypeEntry
    ? requiredExtraBedsFor({
        numAdults,
        numChildren,
        maxCapacity: Number(selectedTypeEntry.maxCapacity) || 0,
        maxChildren: Number(selectedTypeEntry.maxChildren) || 0
      })
    : { overflowAdults: 0, overflowChildren: 0, requiredExtraBeds: 0 };
  const corpExtraBedsAllowed = Number(selectedTypeEntry?.maxExtraBeds) || 0;
  // Per MRB-08 (2026-08-02, per decision #167): the
  // EXB-07 overflow hint is single-room only. For
  // N>1 the rebalance helper handles overflow per
  // stay; the cart UI surfaces the result. The
  // page-level hint is therefore suppressed when the
  // cart has more than one stay — it would be
  // misleading (a hint about the primary type's
  // capacity when the user is distributing the
  // overflow across multiple rooms).
  const corpShowOverflowHint =
    distributedRoomCart.length <= 1
      && selectedTypeEntry
      && corpOverflow.requiredExtraBeds > extraBedCount;

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
    // Per feature/booking-autofill-member-email-corporate + name:
    // when the guest is signed in as a Spark Rewards member the
    // identity-anchored fields (email + first/last name) are locked
    // to the member's account. The <TextField>s render `readOnly`
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
        setPaymentProofError("Please upload a JPG, PNG, or WEBP image.");
        e.target.value = "";
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setPaymentProofError("Please upload an image that is 5MB or smaller.");
        e.target.value = "";
        return;
      }
      setUploadingProof(true);
      setPaymentProofError("");
      try {
        const compressed = await compressImageFile(file);
        const extension = compressed.file.name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? "";
        const storageRef = ref(storage, `bookings/${bookingId}/payment-proof/${crypto.randomUUID()}${extension}`);
        const uploadResult = await uploadBytes(storageRef, compressed.file);
        setProofUpload({ name: file.name, path: uploadResult.ref.fullPath });
      } catch (err) {
        console.error("Corporate payment proof upload failed:", err);
        setPaymentProofError("Receipt upload failed. Please try again.");
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
    breakfast: hasBreakfast ? "yes" : "no",
    // Per MRB-08 (2026-08-02, per decision #167):
    // round-trip the room cart through the `?rooms=`
    // URL param so a Step 1 → Step 2 → back to
    // Step 1 navigation preserves the cart. Same
    // pattern as the public `/book` flow (per
    // MRB-06). A refresh / share-link re-uses
    // the same cart via `parseBookingRoomCart`.
    rooms: serializeBookingRoomCart(distributedRoomCart.length > 0 ? distributedRoomCart : roomCart)
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
    // Per NBS-2026-08-08 (F2): reset the recovery
    // action so a fresh submit doesn't render a stale
    // CTA from the previous attempt.
    setSubmitErrorAction("none");
    // Per NBS-2026-08-08 (F11): cancel any pending
    // auto-redirect timer from a prior failed submit.
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }

    // Per 2026-07-24 (refactor/unify-payment-reference-fields):
    // guests no longer enter a payment reference number at booking
    // time, even on the corporate personal-pay path. Staff
    // populates `transactionReference` on the relevant payment
    // ledger entry when they confirm the payment.

    // Per BI-05: personal pay submits the method the guest
    // actually paid with plus the uploaded receipt URL, so the
    // booking lands as `payment-uploaded` and staff can verify
    // the transfer. Chargeback stays `pay-at-hotel` (settled
    // via LOU per decision #99).
    const isPersonalPay = guestDetails.billingArrangement === "personal";

    try {
      // Per MRB-08 (2026-08-02, per decision #167):
      // the multi-room submit body. The cart's
      // distributed occupancy (page-level totals
      // rebalanced per-stay via
      // `rebalanceGuestDistribution`) is the source
      // of truth. `roomSelections[]` carries one
      // entry per stay, the `roomCount` mirrors the
      // cart's length, and the legacy single-room
      // fields (`roomType` / `numAdults` /
      // `numChildren` / `extraBedCount`) carry the
      // first stay's values for back-compat with
      // the server's existing schema validation +
      // the requestFingerprint shape (decision
      // #164, which includes the legacy single-room
      // fields for idempotency replay matching).
      // The server's `handleCreateBooking` already
      // accepts both shapes (per MRB-06 + MRB-07);
      // the corporate `?roomSelections=...` round-trip
      // is the same one the public `/book` flow uses.
      const firstStay = distributedRoomCart[0] ?? {
        roomType: selectedTypeEntry?.value ?? "",
        numAdults,
        numChildren,
        extraBedCount
      };
      const body = {
        bookingId,
        roomType: firstStay.roomType,
        // Per MRB-08: the room count + per-stay
        // selections. When the cart has a single
        // stay, the server's pre-MRB-06 single-room
        // path is byte-equivalent (the server
        // auto-derives one selection from
        // `roomType` + `numAdults` + `numChildren`
        // + `extraBedCount` when `roomSelections`
        // is absent, per the `createBookingSchema` +
        // `roomCount` default of 1). Per BAR-02 (2026-08-08,
        // per decision #203): the `roomCount` field is no
        // longer written to the reservation header.
        // Consumers derive it at read time via
        // `deriveReservationCounters`. The field is no
        // longer sent in the create request body —
        // the server reads the children list directly
        // to compute the count.
        roomSelections: distributedRoomCart.map((stay, index) => ({
          bookingId: index === 0 ? bookingId : stay.bookingId,
          roomType: stay.roomType,
          numAdults: stay.numAdults,
          numChildren: stay.numChildren,
          extraBedCount: stay.extraBedCount,
          hasBreakfast,
          // Per CHD-10 (2026-07-31, per CVQ-01):
          // the per-booking override for "include
          // children in the breakfast charge".
          // Shared across the whole corporate
          // reservation (every stay uses the same
          // breakfast config) — the server
          // snapshots the value per-booking-doc
          // for back-compat with the existing
          // schema.
          breakfastIncludesChildren: false
        })),
        checkIn,
        checkOut,
        // Per EXB-07 (2026-08-01, per decision #155):
        // the corporate /book page now carries the
        // adult/child split + the extra bed count.
        // The server (per CHD-04 + EXB-03) validates
        // `numAdults + numChildren === guests` and
        // applies the EXB-03 overflow rule via
        // `requiredExtraBedsFor`. The `guests` field
        // is kept for back-compat with the server's
        // derivation (it equals `numAdults + numChildren`
        // on the wire).
        guests: Number(guestDetails.guestCount) || guests,
        numAdults: firstStay.numAdults,
        numChildren: firstStay.numChildren,
        extraBedCount: firstStay.extraBedCount,
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
        paymentProofUrl: null,
        paymentProofPath: isPersonalPay ? proofUpload?.path ?? null : null,
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
        // Per MRB-02.x corporate (2026-08-02, per
        // decision #164): the client-preallocated
        // reservation id. The server's transaction
        // uses it as the canonical idempotency key
        // for the create (same as the public
        // `/book` flow's `reservationId`). The
        // server auto-mints when absent; the
        // preallocation lets a
        // retry-after-uncertain-response reuse the
        // same id so the server replays the original
        // commit (same `requestFingerprint`) or
        // returns a 409 (different
        // `requestFingerprint`).
        reservationId,
        _hp: guestDetails._hp || "",
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
        // Per NBS-2026-08-08 (F2): the recovery action for
        // the sticky footer's error CTA. Mirrors the public
        // `/book` flow's three-way discriminator
        // ("back-to-step-1" / "retry" / "none").
        setSubmitErrorAction("none");
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
          setSubmitErrorAction("back-to-step-1");
          // Per NBS-2026-08-08 (F11): the auto-redirect
          // timer is held on a ref so the user can cancel
          // it by navigating manually (clicking the back
          // CTA) before the 5s elapses.
          redirectTimerRef.current = window.setTimeout(() => {
            const next = new URLSearchParams(searchParams);
            next.set("step", "select-room");
            next.delete("roomType");
            setSelectedRoomType("");
            setSearchParams(next);
            setSubmitError("");
            setSubmitErrorAction("none");
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
        }
      }
    } catch {
      setSubmitError("Unable to submit booking. Please check your connection and try again.");
      setSubmitErrorAction("retry");
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
        
        {/* Persistent corporate rate badge — per W2.13 / decision #101.
            Per L-01 (corporate audit 2026-08-10): the wording is now
            aligned with the spec — "Corporate Rate — [Company Name or
            Flat Rate]". The pre-L-01 label ("Active Negotiated Pricing")
            drifted from the spec and used "Flat Corporate Rate" on the
            flat-rate path. */}
        {(companyName || isFlatRate) && currentStepKey !== "confirm" && (
          <div className="bg-primary/10 border-t border-primary/20 text-center py-1.5 text-xs text-primary font-medium">
            Corporate Rate — <span className="font-bold underline">{companyName || "Flat Rate"}</span>
            {activeCode && " (Negotiated rate applied)"}
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

                {/* Per EXB-07 (2026-08-01, per decision #155):
                    the corporate /book occupancy block.
                    Three steppers (adults >= 1, children >= 0,
                    extra beds >= 0 capped at the selected
                    type's `maxExtraBeds`, hidden entirely
                    when the type allows 0). The total
                    `guests` is derived from the adult + child
                    sum, matching the server's CHD-04
                    derivation. The contextual overflow hint
                    renders when the requested split exceeds
                    the type's caps — strongest UX: tell the
                    guest exactly how many extra beds to add
                    instead of letting the server reject. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <span>Occupancy</span>
                    <span className="text-gray-400 normal-case font-normal">
                      {guests} guest{guests === 1 ? "" : "s"} total
                    </span>
                  </div>
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                    <span>Adults</span>
                    <div className="flex items-center gap-2">
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        type="button"
                        aria-label="Decrease adults"
                        onClick={() => setAdults(numAdults - 1)}
                        disabled={numAdults <= 1}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center tabular-nums">{numAdults}</span>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        type="button"
                        aria-label="Increase adults"
                        onClick={() => setAdults(numAdults + 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                    <span>Children (0–11, free of room rate)</span>
                    <div className="flex items-center gap-2">
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        type="button"
                        aria-label="Decrease children"
                        onClick={() => setChildren(numChildren - 1)}
                        disabled={numChildren <= 0}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center tabular-nums">{numChildren}</span>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        type="button"
                        aria-label="Increase children"
                        // Cap children at (guests - 1) so at
                        // least one adult stays — matches
                        // the guest /book picker's invariant.
                        onClick={() => setChildren(numChildren + 1)}
                        disabled={numChildren >= Math.max(0, guests - 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </label>
                  {/* Per MRB-08 (2026-08-02, per decision #167):
                      the per-page "Extra beds" stepper is
                      single-room only. When the cart has
                      more than one room, the per-stay
                      extra-bed count is derived by
                      `rebalanceGuestDistribution` from the
                      room type's `maxExtraBeds` + the
                      leftover guests after capacity
                      allocation (the cart renders the
                      resulting per-stay count). The
                      page-level stepper would be
                      misleading for N>1 — hide it. */}
                  {corpExtraBedsAllowed > 0 && distributedRoomCart.length <= 1 ? (
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                      <span>Extra beds</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                          type="button"
                          aria-label="Decrease extra beds"
                          onClick={() => setExtraBeds(extraBedCount - 1)}
                          disabled={extraBedCount <= 0}
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center tabular-nums">{extraBedCount}</span>
                        <button
                          className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                          type="button"
                          aria-label="Increase extra beds"
                          onClick={() => setExtraBeds(extraBedCount + 1)}
                          disabled={extraBedCount >= corpExtraBedsAllowed}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </label>
                  ) : null}
                  {corpShowOverflowHint && selectedTypeEntry ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                      {corpExtraBedsAllowed > 0 ? (
                        <>
                          This room type allows up to {Number(selectedTypeEntry.maxCapacity) || 0} adult{Number(selectedTypeEntry.maxCapacity) === 1 ? "" : "s"} + {Number(selectedTypeEntry.maxChildren) || 0} child{Number(selectedTypeEntry.maxChildren) === 1 ? "" : "ren"} (or {Number(selectedTypeEntry.maxCapacity) + corpExtraBedsAllowed}/{Number(selectedTypeEntry.maxChildren) + corpExtraBedsAllowed} with {corpExtraBedsAllowed} extra bed{corpExtraBedsAllowed === 1 ? "" : "s"}). Add {corpOverflow.requiredExtraBeds} extra bed{corpOverflow.requiredExtraBeds === 1 ? "" : "s"} to fit your group, or pick a different room.
                        </>
                      ) : (
                        <>
                          This room type allows up to {Number(selectedTypeEntry.maxCapacity) || 0} adult{Number(selectedTypeEntry.maxCapacity) === 1 ? "" : "s"} + {Number(selectedTypeEntry.maxChildren) || 0} child{Number(selectedTypeEntry.maxChildren) === 1 ? "" : "ren"} and does not allow extra beds. Pick a different room type to fit your group.
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
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

            {/* Per MRB-08 (2026-08-02, per decision #167):
                the room cart. Renders above the room-type
                card grid so the user sees their selection
                before scrolling. Each cart row shows the
                room type, the per-stay negotiated or flat
                rate, the per-stay occupancy (auto-distributed
                by `rebalanceGuestDistribution` from the
                page-level `numAdults` + `numChildren` totals
                in the left panel), and a remove button. A
                "+ Add another room" dropdown at the bottom
                appends a new stay of the chosen type. The
                server mirrors the per-stay breakdown in the
                rate breakdown + the receipt PDF. */}
            {roomCart.length > 0 && !roomsLoading ? (
              <div className="mb-6 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                    Your block ({distributedRoomCart.length} {distributedRoomCart.length === 1 ? "room" : "rooms"})
                  </h2>
                  <span className="text-xs text-gray-500">
                    {unassignedAdults + unassignedChildren > 0
                      ? `${unassignedAdults + unassignedChildren} guest${unassignedAdults + unassignedChildren === 1 ? "" : "s"} overflow`
                      : "All guests fit"}
                  </span>
                </div>
                <div className="space-y-3">
                  {distributedRoomCart.map((stay, index) => {
                    const stayType = roomTypes.find((type) => type.value === stay.roomType);
                    const stayPricing = perStayPricing[index];
                    const stayNegotiated = ratePerRoomType && ratePerRoomType[stay.roomType] !== undefined
                      ? ratePerRoomType[stay.roomType]
                      : null;
                    const stayCorp = Number(stayType?.corporateRate) || 0;
                    const stayBase = Number(stayType?.pricePerNight) || 0;
                    const stayRate = stayNegotiated !== null
                      ? stayNegotiated
                      : (stayCorp > 0 ? stayCorp : stayBase);
                    return (
                      <div
                        key={stay.bookingId}
                        className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <BedDouble size={16} className="text-primary" />
                            <span className="font-semibold text-gray-950">
                              Room {index + 1} · {stayType?.label ?? stay.roomType}
                            </span>
                            {activeCode && stayNegotiated !== null ? (
                              <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-semibold border border-green-200">
                                Negotiated
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {stay.numAdults} adult{stay.numAdults === 1 ? "" : "s"}
                            {stay.numChildren > 0 ? `, ${stay.numChildren} child${stay.numChildren === 1 ? "" : "ren"}` : ""}
                            {stay.extraBedCount > 0 ? `, ${stay.extraBedCount} extra bed${stay.extraBedCount === 1 ? "" : "s"}` : ""}
                            {" · "}
                            {formatPrice(stayRate)}/night
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-gray-950">
                            {formatPrice(stayPricing?.staySubtotal ?? 0)}
                          </span>
                          {distributedRoomCart.length > 1 ? (
                            <button
                              type="button"
                              aria-label={`Remove room ${index + 1}`}
                              className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => removeRoomFromCart(index)}
                            >
                              <Minus size={14} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Per MRB-08: the "Add another room" picker.
                    Lists every available room type; the user
                    picks the type for the new stay. The
                    server auto-assigns a physical room of
                    that type at booking creation. The
                    add button is disabled when no types
                    have availability. */}
                {availableRoomTypes.length > 0 ? (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-gray-500">Add another room:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {availableRoomTypes.map((entry) => (
                        <button
                          key={entry.type.value}
                          type="button"
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:border-primary hover:text-primary"
                          onClick={() => addRoomToCart(entry.type.value)}
                        >
                          + {entry.type.shortLabel || entry.type.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

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
                {/* Per MRB-08 (2026-08-02, per decision #167):
                    the sticky footer copy switches to a
                    multi-room shape when the cart has
                    more than one stay. The N=1 wording
                    is preserved byte-equivalent. */}
                {distributedRoomCart.length > 1
                  ? `Corporate block of ${distributedRoomCart.length} rooms · ${nights} ${nights === 1 ? "night" : "nights"} · ${guests} guest${guests === 1 ? "" : "s"} total${hasBreakfast ? " (Breakfast included)" : ""}`
                  : `Corporate rate for ${nights} ${nights === 1 ? "night" : "nights"}, ${guests} ${guests === 1 ? "guest" : "guests"}${hasBreakfast ? " (Breakfast included)" : ""}`}
              </p>
              <p className="text-xl font-bold text-gray-950">
                {formatPrice(total)} <span className="text-xs font-normal text-gray-500">{distributedRoomCart.length > 1 ? "negotiated total" : "negotiated total"}</span>
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
                id="firstName"
                name="firstName"
                autoComplete="given-name"
                // Per feature/booking-autofill-member-name-corporate:
                // lock the first/last name fields to the member's
                // account name. The identity anchor (email + name
                // triple) stays consistent across bookings.
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
              <div className="grid gap-2">
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
                  id="email"
                  name="email"
                  autoComplete="email"
                  // Per feature/booking-autofill-member-email-corporate:
                  // lock the email field to the member's account email
                  // so the booking is always filed under the correct
                  // identity. `updateGuestDetail` short-circuits the
                  // same field above, so the readOnly here is
                  // belt-and-braces.
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

            {/* Corporate Specific Fields */}
            <h3 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-2 mt-8">Business References</h3>

            <motion.div className="grid gap-5 sm:grid-cols-2 mt-4" variants={staggerChild}>
              {/* Company Name */}
              <label htmlFor="companyName" className="grid gap-2 text-sm font-medium text-gray-700">
                Company Name
                <span className="relative block">
                  <Building size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                  <input
                    id="companyName"
                    name="companyName"
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
                id="designation"
                name="designation"
              />
            </motion.div>

            <motion.div className="mt-5 grid gap-5 sm:grid-cols-2" variants={staggerChild}>
              {/* Purpose of Stay */}
              <label htmlFor="purposeOfStay" className="grid gap-2 text-sm font-medium text-gray-700">
                Purpose of Stay
                <select
                  id="purposeOfStay"
                  name="purposeOfStay"
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
              <label htmlFor="billingArrangement" className="grid gap-2 text-sm font-medium text-gray-700">
                Billing Arrangement
                <select
                  id="billingArrangement"
                  name="billingArrangement"
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
              <label htmlFor="companyAddress" className="grid gap-2 text-sm font-medium text-gray-700">
                Company Address
                <span className="relative block">
                  <Building size={17} className="absolute left-3 top-4 text-primary" />
                  <textarea
                    id="companyAddress"
                    name="companyAddress"
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
                  // Per EXB-07 (2026-08-01, per decision #155):
                  // the Step 2 "Guests count" form field
                  // is a confirmation input — it overrides
                  // the Step 1 stepper when the user edits
                  // it. We treat the typed value as a total
                  // count and update `numAdults` to match
                  // (preserving `numChildren`); the EXB-03
                  // overflow check fires on submit.
                  updateGuestDetail("guestCount", value);
                  const next = Math.max(1, Number(value) || 1);
                  setAdults(Math.max(next, numChildren));
                }}
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
                    className="min-h-24 w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    onChange={(event) => updateGuestDetail("requests", event.target.value)}
                    placeholder="Late arrival notes, dietary options, quiet room request..."
                    value={guestDetails.requests}
                  />
                </span>
              </label>
            </motion.div>

            <motion.div className="mt-6 rounded-card bg-primary-light p-4" variants={staggerChild}>
              <label htmlFor="corporateConsent" className="flex items-start gap-3 text-sm leading-6 text-gray-700 cursor-pointer">
                <input
                  id="corporateConsent"
                  name="corporateConsent"
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
                  {paymentProofError && (
                    <p className="mt-2 text-xs font-semibold text-red-600">{paymentProofError}</p>
                  )}

                  {/* Reference Number Input — removed 2026-07-24 (refactor/unify-payment-reference-fields).
                      Staff populates `transactionReference` on the relevant payment ledger entry
                      when confirming payment. The guest no longer enters a reference at booking time. */}
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
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="flex flex-col gap-3 rounded-card bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                <div className="flex gap-2">
                  <Info size={18} className="shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
                {/* Per NBS-2026-08-08 (F2): the recovery
                    CTA mirrors the public `/book` flow's
                    three-way discriminator. The
                    "back-to-step-1" CTA cancels any
                    pending auto-redirect timer (F11) so
                    the manual nav doesn't race the
                    auto-nav. */}
                {submitErrorAction === "back-to-step-1" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (redirectTimerRef.current !== null) {
                        window.clearTimeout(redirectTimerRef.current);
                        redirectTimerRef.current = null;
                      }
                      const next = new URLSearchParams(searchParams);
                      next.set("step", "select-room");
                      next.delete("roomType");
                      setSelectedRoomType("");
                      setSearchParams(next);
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
  id?: string;
  name?: string;
  autoComplete?: string;
  // Per feature/booking-autofill-member-email-corporate: same
  // contract as BookingPage.tsx. `readOnly` keeps the field in the
  // submitted payload (a disabled input would be dropped).
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
