import { adminAuth, adminDb } from "../lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { sendBookingTrigger, sendStaffNewBookingTrigger, sendStaffNewPaymentTrigger, sendEarlyCheckinResolveTrigger } from "./email";
import {
  calculateSeasonalAwareRoomBreakdown,
  calculateVoucherDiscount,
  getCheckInReadiness,
  normalizeSeasonalRateOverrides,
  toDateOrNull,
  validateCorporateCode,
  getManilaDateInfo,
  BOOKING_REF_REGEX,
  generateLookupToken,
  DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT,
  getLockedManualNightlyRate,
  WalkinBookingSchema
} from "@spark-inn/shared";
import type { BookingRateBreakdown } from "@spark-inn/shared";
import { z } from "zod";
import config from "../../../hotel.config";
import { buildRateBreakdown, rebuildEarlyCheckoutRateBreakdown, rebuildRateBreakdown } from "../lib/rate-breakdown";

export function getConfiguredBookingRefPrefix() {
  return config.bookingRefPrefix || "SI";
}

const ROOM_OCCUPYING_STATUSES = ["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"];
const ROOM_NOT_READY_PREVIOUS_GUEST_ERROR = "Room not ready — previous guest has not checked out yet.";
const PREALLOCATED_BOOKING_ID_REGEX = /^[A-Za-z0-9]{10,32}$/;
const PREALLOCATED_PAYMENT_ID_REGEX = /^[A-Za-z0-9]{10,32}$/;
const RESCHEDULABLE_STATUSES = ["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"];

function sumLedgerAmounts(snapshot: any): number {
  return snapshot.docs.reduce((sum: number, docSnap: any) => sum + Number(docSnap.data()?.amount || 0), 0);
}

function sumBilledAddToBillOrders(snapshot: any): number {
  return snapshot.docs.reduce((sum: number, docSnap: any) => {
    const order = docSnap.data() || {};
    return order.paymentMethod === "add-to-bill" && order.status === "delivered" && order.isBilled
      ? sum + Number(order.totalAmount || 0)
      : sum;
  }, 0);
}

function calculateCheckoutPoints(totalPrice: number, rewardsConfig: any): number {
  if (!rewardsConfig || rewardsConfig.pointsEnabled === false) return 0;
  if ((rewardsConfig.earningMode || "per-spend") === "per-booking") {
    return Math.max(Math.floor(Number(rewardsConfig.pointsPerBooking || 0)), 0);
  }
  const pointsPerHundred = Math.max(Number(rewardsConfig.pointsPerHundred || 0), 0);
  return Math.max(Math.floor((Math.max(totalPrice, 0) / 100) * pointsPerHundred), 0);
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseCheckoutTimeToMinutes(timeValue: unknown, fallback = config.checkOutTime || "12:00") {
  const raw = String(timeValue || fallback).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) {
    return fallback === "12:00" ? 720 : parseCheckoutTimeToMinutes(fallback, "12:00");
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
    return fallback === "12:00" ? 720 : parseCheckoutTimeToMinutes(fallback, "12:00");
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) return fallback === "12:00" ? 720 : parseCheckoutTimeToMinutes(fallback, "12:00");
    if (meridiem === "PM" && hours !== 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
  }
  if (hours < 0 || hours > 23) return fallback === "12:00" ? 720 : parseCheckoutTimeToMinutes(fallback, "12:00");
  return hours * 60 + minutes;
}

function hasLingeringCheckedInConflict(input: {
  status: unknown;
  existingCheckOut: Date;
  requestedCheckInKey: string;
  todayKey: string;
  currentMinutes: number;
  checkoutMinutes: number;
}) {
  const existingCheckOutKey = dateKeyFromDate(input.existingCheckOut);
  return input.status === "checked-in"
    && input.requestedCheckInKey === input.todayKey
    && (
      existingCheckOutKey < input.todayKey
      || (existingCheckOutKey === input.todayKey && input.currentMinutes >= input.checkoutMinutes)
    );
}

function getOccupancyConflictReason(input: {
  bookingData: any;
  requestedCheckIn: Date;
  requestedCheckOut: Date;
  requestedCheckInKey: string;
  todayKey: string;
  currentMinutes: number;
  checkOutTime: unknown;
}) {
  const existingCheckIn = toDateOrNull(input.bookingData.checkIn);
  const existingCheckOut = toDateOrNull(input.bookingData.checkOut);
  if (!existingCheckIn || !existingCheckOut) return null;
  if (rangesOverlap(existingCheckIn, existingCheckOut, input.requestedCheckIn, input.requestedCheckOut)) {
    return "overlap";
  }
  if (hasLingeringCheckedInConflict({
    status: input.bookingData.status,
    existingCheckOut,
    requestedCheckInKey: input.requestedCheckInKey,
    todayKey: input.todayKey,
    currentMinutes: input.currentMinutes,
    checkoutMinutes: parseCheckoutTimeToMinutes(input.checkOutTime)
  })) {
    return "lingering-checked-in";
  }
  return null;
}

async function hasActiveRoomBlockConflict(
  transaction: FirebaseFirestore.Transaction,
  roomId: string,
  checkInDate: Date,
  checkOutDate: Date
) {
  const blocksQuery = adminDb.collection("roomBlocks")
    .where("roomId", "==", roomId)
    .where("status", "==", "active");
  const blocksSnapshot = await transaction.get(blocksQuery);
  return blocksSnapshot.docs.some((doc) => {
    const data = doc.data();
    const start = toDateOrNull(data.startDate);
    const end = toDateOrNull(data.endDate);
    return Boolean(start && end && rangesOverlap(start, end, checkInDate, checkOutDate));
  });
}

// Per BF-21 (booking-flow audit 2026-06-26): the public
// self-service endpoints (`/api/bookings/lookup`,
// `/api/bookings/cancel`) accept a bookingRef + guestEmail
// pair to look up and act on a booking without auth. The
// previous validation was just `!bookingRef || !guestEmail`,
// so a 100KB body, `""`, or `"notanemail"` would all hit
// Firestore. These schemas short-circuit malformed input
// with a 400 before the query runs.
//
// Per H2 (hardening batch 2026-06-26): the schemas now
// accept either `guestEmail` (legacy) OR `token` (the new
// per-booking `lookupToken` random hex). Exactly one of
// the two is required. The token path is what the email
// magic link uses — the URL no longer carries the raw
// `guestEmail`, so PII never lands in browser history or
// Vercel access logs.
const lookupSchema = z
  .object({
    bookingRef: z
      .string()
      .trim()
      .max(40)
      .regex(BOOKING_REF_REGEX, "Invalid booking reference format."),
    guestEmail: z.string().trim().toLowerCase().email().max(160).optional(),
    token: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-f0-9]{32}$/i, "Invalid lookup token format.")
      .optional(),
    turnstileToken: z.string().max(2000).optional()
  })
  .refine(
    (data) => Boolean(data.guestEmail) !== Boolean(data.token),
    "Provide either an email or a lookup token (not both)."
  );

const guestCancelSchema = z
  .object({
    bookingRef: z
      .string()
      .trim()
      .max(40)
      .regex(BOOKING_REF_REGEX, "Invalid booking reference format."),
    guestEmail: z.string().trim().toLowerCase().email().max(160).optional(),
    token: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-f0-9]{32}$/i, "Invalid lookup token format.")
      .optional(),
    reason: z.string().trim().max(500).optional().default("")
  })
  .refine(
    (data) => Boolean(data.guestEmail) !== Boolean(data.token),
    "Provide either an email or a lookup token (not both)."
  );

interface GuestDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  requests?: string;
  consent: boolean;
  companyName?: string;
  designation?: string;
  companyAddress?: string;
  numRooms?: number;
  purposeOfStay?: string;
  preferredBillingArrangement?: string;
}

// Per BI-11 (booking-intercom audit 2026-07-06): the
// corporate flow collects and requires `designation`,
// `companyAddress`, `purposeOfStay`, and
// `preferredBillingArrangement` at Step 2, plus a
// guest-entered `companyName` on the flat-rate path. The
// `Consent` + base contact fields below are always present
// for every booking; the corporate fields are optional on
// the wire (the Zod schema marks them `.optional()` with
// safe defaults) and persisted on the booking doc only when
// the booking is corporate. Standard online bookings send
// empty strings and the conditional `corporate` block on
// the booking doc is omitted entirely so a non-corporate
// booking never carries spurious `""` fields. The Zod
// treatment also closes BI-16 (input validation) — strings
// are trimmed + length-capped, email is normalized to
// lowercase, and a 100KB `requests` blob can no longer land
// in Firestore.
const guestDetailsSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z.string().trim().min(7).max(32),
  requests: z.string().trim().max(1000).optional().default(""),
  consent: z.boolean(),
  // Corporate fields — all optional with safe defaults so
  // non-corporate bookings validate cleanly. The handler
  // drops them from the doc unless the booking is
  // corporate.
  companyName: z.string().trim().max(160).optional().default(""),
  designation: z.string().trim().max(120).optional().default(""),
  companyAddress: z.string().trim().max(300).optional().default(""),
  numRooms: z.coerce.number().int().min(1).max(50).optional(),
  purposeOfStay: z.string().trim().max(120).optional().default(""),
  preferredBillingArrangement: z
    .string()
    .trim()
    .max(40)
    .optional()
    .default("")
});

interface CreateBookingBody {
  bookingId: string;
  // Per the room-type booking refactor: clients send the chosen
  // `roomType` instead of a specific `roomId`. The transaction
  // below picks the first non-conflicting physical room of that
  // type and stores its `roomId` + `roomNumber` on the booking doc.
  // Schema is unchanged — the booking still references a real
  // `rooms/<id>` document.
  roomType: string;
  checkIn: string; // Yyyy-MM-DD
  checkOut: string; // Yyyy-MM-DD
  guests: number;
  hasBreakfast: boolean;
  guestDetails: GuestDetails;
  discountType: "" | "senior" | "pwd";
  discountIdPhotoUrl: string | null;
  voucherCode?: string;
  paymentMethod: string;
  paymentProofUrl?: string | null;
  paymentReferenceNumber?: string | null;
  // Per W1.3 / decision #79 / audit S1.5: the client no longer
  // sets `isCorporate` directly. The server derives it from a
  // validated `corporateCode` lookup. The `companyName` on the
  // booking is sourced from the `corporateCodes` document for
  // the validated code, never from `guestDetails.companyName`.
  corporateCode?: string;
  // Per BI-04 (booking-intercom audit 2026-07-06): the corporate
  // booking route's "Continue without code" path. The flag only
  // expresses *intent* — the rate itself is always read from the
  // server-side `roomTypes[].corporateRate` (public flat corporate
  // pricing per CORPORATE-BOOKING.md), never from the client. The
  // guest-entered `companyName` is stored as unverified contact
  // metadata. A validated `corporateCode` always wins over this flag.
  corporateFlatRate?: boolean;
  // Per W2.14 / decision #102: set when this booking is created from a
  // converted corporate inquiry. The convert-to-booking UI (per audit
  // 1.4 SEV-1 #2) populates this field; normal bookings send null.
  linkedInquiryId?: string | null;
}

// Per BF-42 (booking-flow audit 2026-06-26): the
// `getManilaDateInfo()` helper was duplicated here twice
// (and in `store.ts`, `corporate-inquiries.ts`, `email.ts`,
// `reference.ts`). The shared implementation lives in
// `shared/utils/bookingDates.ts` and is imported as
// `getManilaDateInfo` above. Local definitions removed BF-42.

export async function handleCreateBooking(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = req.body as CreateBookingBody;
  if (!body) {
    return res.status(400).json({ success: false, error: "Invalid request body." });
  }

  const {
    bookingId,
    roomType,
    checkIn,
    checkOut,
    guests,
    hasBreakfast,
    guestDetails: rawGuestDetails,
    discountType,
    discountIdPhotoUrl,
    voucherCode,
    paymentMethod,
    paymentProofUrl,
    paymentReferenceNumber,
    corporateCode,
    corporateFlatRate,
    linkedInquiryId
  } = body;

  // Basic Input Validation
  if (!bookingId || !roomType || !checkIn || !checkOut || !guests || !rawGuestDetails) {
    return res.status(400).json({ success: false, error: "Missing required booking fields." });
  }
  if (!PREALLOCATED_BOOKING_ID_REGEX.test(String(bookingId))) {
    return res.status(400).json({ success: false, error: "Invalid booking ID format." });
  }

  // Per BI-11 (booking-intercom audit 2026-07-06): validate +
  // normalize guest details before any Firestore work. The
  // parsed object replaces the raw body copy so every
  // downstream read gets trimmed, length-capped, lowercase
  // email, and a typed shape for the corporate metadata
  // fields the handler will later persist conditionally.
  // This also closes BI-16 (input validation): a garbage
  // email or a 100KB `requests` blob never reaches Firestore.
  const parsedGuest = guestDetailsSchema.safeParse(rawGuestDetails);
  if (!parsedGuest.success) {
    return res.status(400).json({
      success: false,
      error: "Please check your guest details — a required field is missing or invalid."
    });
  }
  const guestDetails: GuestDetails = parsedGuest.data;

  if (!guestDetails.consent) {
    return res.status(400).json({ success: false, error: "Privacy policy consent is required." });
  }

  const checkInDate = new Date(`${checkIn}T00:00:00Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00Z`);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, error: "Invalid check-in or check-out date." });
  }

  // Per BI-12 (booking-intercom audit 2026-07-06): reject
  // stays that start in the past (Manila calendar). The
  // client blocks past dates in its date picker, but the
  // corporate page's URL-seeded defaults proved that
  // server-side enforcement is the only reliable guard.
  // Same-day check-in is allowed (a guest checking in today
  // is valid). Walk-ins (`handleCreateWalkin`) are exempt —
  // staff may legitimately backfill past stays for guests
  // who forgot to register.
  const { todayStr: manilaToday, manilaDate: currentManilaDate } = getManilaDateInfo();
  const currentManilaMinutes = currentManilaDate.getHours() * 60 + currentManilaDate.getMinutes();
  if (checkIn < manilaToday) {
    return res.status(400).json({
      success: false,
      error: "Check-in date cannot be in the past. Please choose a new date."
    });
  }

  // Calculate nights
  const startMs = checkInDate.getTime();
  const endMs = checkOutDate.getTime();
  const numNights = Math.max(Math.round((endMs - startMs) / 86400000), 0);
  if (numNights < 1) {
    return res.status(400).json({ success: false, error: "Stay must be at least 1 night." });
  }

  try {
    let finalBookingRef = "";
    let finalTotalPrice = 0;
    let finalRateBreakdown: BookingRateBreakdown | null = null;
    let computedData: any = {};
    let alreadyExistingBookingResponse: any = null;
    // Captured inside the transaction so the response payload
    // can surface the auto-assigned physical room.
    let assignedRoomId = "";
    let assignedRoomNumber = "";

    // Detect Spark Rewards member via the request's ID token.
    // Per W2.2 / decision #90: server is authoritative for member discount.
    // The client cannot supply a memberDiscount or memberDiscountPct field;
    // we look up the member by authUser.uid and apply the 3rd stacking
    // step (DECISIONS-FEATURES.md #13b). The Authorization header is
    // optional — anonymous bookings get no member discount.
    let detectedMemberId: string | null = null;
    let detectedMemberDoc: any = null;
    let memberTokenError: Error | null = null;
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.split("Bearer ")[1];
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        const memberRef = adminDb.collection("members").doc(decoded.uid);
        const memberSnap = await memberRef.get();
        if (memberSnap.exists) {
          const m = memberSnap.data()!;
          if (m.isMember !== false && m.isActive !== false) {
            detectedMemberId = memberSnap.id;
            detectedMemberDoc = m;
          }
        }
      } catch (err) {
        // Per BF-32 (booking-flow audit 2026-06-26): the previous
        // handler silently swallowed every token-verify error
        // and downgraded to an anonymous booking. A transient
        // Firebase Auth error (quota, network) would silently
        // lose a member's discount. We now:
        //   1. log at warn level so the issue is visible
        //   2. distinguish "infra" errors (Firebase unavailable,
        //      network, quota) from auth-style errors (invalid or
        //      expired token). Infra errors fail the request with
        //      503 so the client can retry. Auth-style errors
        //      fall through to anonymous booking.
        memberTokenError = err as Error;
        const code = (err as any)?.code || "";
        // Only rethrow for known Firebase infra codes. Anything
        // else (including plain `Error` from test mocks or a
        // thrown string from upstream) is an auth-style failure
        // and falls through to anonymous.
        const isInfraError = typeof code === "string" && (
          code.includes("UNAVAILABLE")
          || code.includes("DEADLINE_EXCEEDED")
          || code.includes("RESOURCE_EXHAUSTED")
          || code.includes("INTERNAL")
          || code.includes("ECONNRESET")
          || code.includes("ETIMEDOUT")
        );
        if (isInfraError) {
          throw err;
        }
        // Auth-style error: fall through to anonymous booking.
      }
    }
    if (memberTokenError) {
      console.warn("ID token verify failed; continuing as anonymous booking:", memberTokenError.message);
    }

    // Run Firestore Transaction
    await adminDb.runTransaction(async (transaction) => {
      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      const existingBooking = await transaction.get(bookingDocRef);
      if (existingBooking.exists) {
        const existing = existingBooking.data() || {};
        finalBookingRef = String(existing.bookingRef || "");
        finalTotalPrice = Number(existing.totalPrice || 0);
        finalRateBreakdown = existing.rateBreakdown || null;
        assignedRoomId = String(existing.roomId || "");
        assignedRoomNumber = String(existing.roomNumber || "");
        alreadyExistingBookingResponse = {
          bookingId,
          bookingRef: finalBookingRef,
          totalPrice: finalTotalPrice,
          roomId: assignedRoomId,
          roomNumber: assignedRoomNumber,
          roomType: String(existing.roomType || roomType),
          rateBreakdown: finalRateBreakdown,
          alreadyExists: true
        };
        return;
      }

      // 1. Load the room type entry from `settings/hotelConfig`.
      // Per W3.6 + W3.7, rate matrix + max capacity live on the
      // type, not on individual room docs. Reading the type here
      // is the canonical source for the booking pricing and the
      // candidate-room filter (max capacity, type label).
      const hotelConfigRef = adminDb.collection("settings").doc("hotelConfig");
      const hotelConfigDoc = await transaction.get(hotelConfigRef);
      if (!hotelConfigDoc.exists) {
        throw new Error("Room type catalog is not configured.");
      }
      const hotelConfig = hotelConfigDoc.data()!;

      if ((discountType === "senior" || discountType === "pwd") && hotelConfig.seniorPwdOnlineEnabled === false) {
        throw new Error("Senior/PWD online claims are currently disabled. Please claim the discount at the front desk with a valid ID.");
      }

      // Validate payment reference number if required
      if (paymentMethod !== "pay-at-hotel") {
        const paymentMethodsArr: any[] = Array.isArray(hotelConfig.paymentMethods) ? hotelConfig.paymentMethods : [];
        const pmConfig = paymentMethodsArr.find((p) => p && p.method === paymentMethod);
        const isRefRequired = pmConfig ? pmConfig.requireReferenceNumber !== false : true;
        if (isRefRequired && (!paymentReferenceNumber || !String(paymentReferenceNumber).trim())) {
          throw new Error("Payment reference number is required.");
        }
      }

      const roomTypesArr: any[] = Array.isArray(hotelConfig.roomTypes) ? hotelConfig.roomTypes : [];
      const typeEntry = roomTypesArr.find((entry) => entry && entry.value === roomType);
      if (!typeEntry) {
        throw new Error("Selected room type is not available.");
      }
      const typeMaxCapacity = Number(typeEntry.maxCapacity) || 0;
      const typeBaseRate = Number(typeEntry.pricePerNight) || 0;
      const typeWeekendRate = Number(typeEntry.weekendRate) || 0;
      const typeCorporateRate = Number(typeEntry.corporateRate) || 0;
      const seasonalRateOverrides = normalizeSeasonalRateOverrides(hotelConfig.seasonalRateOverrides);

      if (guests > typeMaxCapacity) {
        throw new Error(`Guest count exceeds room capacity of ${typeMaxCapacity}.`);
      }

      // 2. Find an available physical room of this type. Sort
      // candidates by `roomNumber` for deterministic assignment
      // so two concurrent requests can't fight over the same room.
      const candidatesQuery = adminDb.collection("rooms")
        .where("type", "==", roomType)
        .where("isActive", "==", true);
      const candidatesSnapshot = await transaction.get(candidatesQuery);
      // Per BF-33 (booking-flow audit 2026-06-26): the previous
      // post-filter `.filter((c) => c.data && c.data.isActive !== false)`
      // was redundant with the `where("isActive", "==", true)` on
      // the query. The query is the single source of truth; drop
      // the post-filter to avoid the two filters drifting out of
      // sync. Defensive null-check on `data` remains in case a
      // doc exists with no fields.
      const candidates = candidatesSnapshot.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter((c) => c.data)
        .sort((a, b) => {
          const an = String(a.data.roomNumber || a.id);
          const bn = String(b.data.roomNumber || b.id);
          return an.localeCompare(bn, undefined, { numeric: true });
        });

      if (candidates.length === 0) {
        throw new Error("Room no longer available");
      }

      let assignedRoom: { id: string; data: any } | null = null;
      let sawLingeringCheckedInConflict = false;
      for (const candidate of candidates) {
        const cData = candidate.data;
        // Per-room blocked window check
        if (cData.status === "blocked") {
          const blockedFrom = toDateOrNull(cData.blockedFrom);
          const blockedTo = toDateOrNull(cData.blockedTo);
          const windowActive = blockedFrom && blockedTo
            ? checkInDate < blockedTo && checkOutDate > blockedFrom
            : true;
          if (windowActive) {
            continue;
          }
        }
        // Overlapping booking check for this candidate
        const overlapQuery = adminDb.collection("bookings")
          .where("roomId", "==", candidate.id)
          .where("status", "in", ROOM_OCCUPYING_STATUSES);
        const overlapSnapshot = await transaction.get(overlapQuery);
        const conflictReason = overlapSnapshot.docs
          .map((doc) => getOccupancyConflictReason({
            bookingData: doc.data(),
            requestedCheckIn: checkInDate,
            requestedCheckOut: checkOutDate,
            requestedCheckInKey: checkIn,
            todayKey: manilaToday,
            currentMinutes: currentManilaMinutes,
            checkOutTime: hotelConfig.checkOutTime
          }))
          .find(Boolean);
        if (conflictReason === "lingering-checked-in") {
          sawLingeringCheckedInConflict = true;
        }
        const hasConflict = Boolean(conflictReason);
        if (hasConflict) {
          continue;
        }
        const hasBlockConflict = await hasActiveRoomBlockConflict(transaction, candidate.id, checkInDate, checkOutDate);
        if (hasBlockConflict) {
          continue;
        }
        assignedRoom = candidate;
        break;
      }

      if (!assignedRoom) {
        throw new Error(sawLingeringCheckedInConflict ? ROOM_NOT_READY_PREVIOUS_GUEST_ERROR : "Room no longer available");
      }

      const roomId = assignedRoom.id;
      const roomData = assignedRoom.data;
      assignedRoomId = roomId;
      assignedRoomNumber = String(roomData.roomNumber || "");

      // 3. Fetch Breakfast Settings
      const breakfastConfigRef = adminDb.collection("settings").doc("breakfastConfig");
      const breakfastConfigDoc = await transaction.get(breakfastConfigRef);
      const breakfastConfig = breakfastConfigDoc.exists ? breakfastConfigDoc.data()! : { isEnabled: false, ratePerPersonPerNight: DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT };
      const actualBreakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT) : 0;

      // 4. Handle Corporate Code validation. Per W1.3 / decision #79 /
      // audit S1.5: the server is the only source of truth for
      // `isCorporate` and `companyName`. A client posting
      // `isCorporate: true, corporateCode: "INVALID"` no longer
      // gets the corporate rate — the server independently looks
      // up the code, validates it (active + not expired + under
      // cap), and sets these fields from the corporateCodes doc.
      //
      // Per BI-10 (booking-intercom audit 2026-07-06): the previous
      // implementation silently downgraded to the standard rate if
      // the code failed re-validation inside the transaction. The
      // guest confirmed a negotiated total and got charged the
      // full rate with no error and no explanation. The fix:
      //   (a) Add the `code`-field fallback for codes whose doc ID
      //       differs from their `code` field (mirrors
      //       `handleValidateCorporateCode`).
      //   (b) If the code fails re-validation (expired / cap
      //       reached / deactivated between gate and confirm),
      //       abort the transaction with a distinct
      //       `Corporate code no longer valid` error so the client
      //       can send the guest back to the gate.
      //
      // Per BI-07: on a successful re-validation the handler now
      // increments `usageCount` in the same transaction (the
      // voucher branch already does this for `vouchers.usageCount`).
      // Without this write, capped codes never advance and a
      // capped code is effectively unlimited.
      let activeRoomRate = typeBaseRate;
      let corporateDetails: any = { isCorporate: false, corporateCode: "", companyName: "" };
      let corporateCodeRef: any = null;
      let corporateCodeUsageUpdate: { ref: any; data: any } | null = null;

      if (corporateCode) {
        // (a) `code`-field fallback: try the doc-ID lookup first
        // (the common case), then fall back to a `where("code")`
        // query for codes whose Firestore doc ID differs from
        // their public `code` field. Doing the fallback inside
        // the same transaction means a code that was valid at
        // the gate and is now deactivated between gate and
        // confirm is caught by the re-validation below.
        const formattedCorpCode = String(corporateCode).trim().toUpperCase();
        corporateCodeRef = adminDb.collection("corporateCodes").doc(formattedCorpCode);
        let corpCodeDoc = await transaction.get(corporateCodeRef);
        if (!corpCodeDoc.exists) {
          const corpCodeQuery = adminDb
            .collection("corporateCodes")
            .where("code", "==", formattedCorpCode)
            .limit(1);
          const corpCodeQuerySnap = await transaction.get(corpCodeQuery);
          if (!corpCodeQuerySnap.empty) {
            corpCodeDoc = corpCodeQuerySnap.docs[0];
            corporateCodeRef = corpCodeDoc.ref;
          }
        }
        if (corpCodeDoc.exists) {
          const corpData = corpCodeDoc.data()!;
          const corpValidation = validateCorporateCode({
            isActive: corpData.isActive !== false,
            expiresAt: corpData.expiresAt ? corpData.expiresAt.toDate() : null,
            usageCap: corpData.usageCap ?? null,
            usageCount: corpData.usageCount || 0
          });
          if (corpValidation.valid) {
            corporateDetails.isCorporate = true;
            corporateDetails.corporateCode = formattedCorpCode;
            // The doc's companyName is the source of truth — the
            // body's guestDetails.companyName is informational only.
            corporateDetails.companyName = corpData.companyName || "";
            if (corpData.ratePerRoomType && corpData.ratePerRoomType[roomType] !== undefined) {
              activeRoomRate = corpData.ratePerRoomType[roomType];
            } else if (typeCorporateRate) {
              activeRoomRate = typeCorporateRate;
            }
            // BI-07 / BR-01: increment usageCount inside the same
            // transaction, but defer the write until after every
            // transaction read has completed. The Firestore Admin
            // SDK rejects reads after queued writes.
            corporateCodeUsageUpdate = {
              ref: corporateCodeRef,
              data: {
                usageCount: (corpData.usageCount || 0) + 1,
                updatedAt: new Date()
              }
            };
          } else {
            // (b) Failed re-validation inside the transaction
            // (expired / cap reached / deactivated between gate
            // and confirm). The spec requires a clear error,
            // not a silent downgrade. The catch block below
            // maps this message to a 409 with a user-friendly
            // copy.
            throw new Error(
              `Corporate code no longer valid: ${corpValidation.error} Please re-enter your access code or continue without a code.`
            );
          }
        } else {
          // Code not found in DB at all — the gate should have
          // caught this, but defend in depth.
          throw new Error(
            "Corporate code no longer valid: code not recognized. Please re-enter your access code or continue without a code."
          );
        }
      }
      // Per BI-04 (booking-intercom audit 2026-07-06): the
      // "Continue without code" corporate path. Previously the
      // server ignored it entirely: the booking was priced at the
      // standard rate with `isCorporate: false` / `source: "online"`
      // while the corporate UI quoted `roomTypes[].corporateRate`
      // on every step. The flag is client intent only — the rate
      // comes from the server-side type entry (the flat corporate
      // rate is public pricing per CORPORATE-BOOKING.md), and the
      // guest-entered companyName is stored as unverified metadata.
      // A validated corporateCode above always takes precedence.
      // Per the CORPORATE-BOOKING.md edge case, a missing/zero
      // `corporateRate` falls back to the standard rate (never ₱0)
      // — the booking is still flagged corporate.
      if (!corporateDetails.isCorporate && corporateFlatRate === true) {
        corporateDetails.isCorporate = true;
        corporateDetails.corporateCode = "";
        corporateDetails.companyName = String(guestDetails.companyName || "").trim().slice(0, 160);
        activeRoomRate = typeCorporateRate > 0 ? typeCorporateRate : typeBaseRate;
      }
      // No corporateCode and no flat-rate flag → activeRoomRate
      // stays as typeBaseRate, isCorporate stays false.

      // 5. Calculate Nightly Rate Total. Seasonal overrides apply to
      // standard bookings only; negotiated and flat corporate rates
      // intentionally keep their contract pricing.
      const roomBreakdown = corporateDetails.isCorporate
        ? {
            roomSubtotal: activeRoomRate * numNights,
            roomLines: [{
              source: "corporate" as const,
              label: corporateDetails.corporateCode ? "Corporate negotiated rate" : "Corporate flat rate",
              startDate: checkIn,
              endDate: checkOut,
              nights: numNights,
              nightlyRate: activeRoomRate,
              subtotal: activeRoomRate * numNights
            }]
          }
        : calculateSeasonalAwareRoomBreakdown({
            checkIn: checkInDate,
            checkOut: checkOutDate,
            roomType,
            baseRate: activeRoomRate,
            weekendRate: typeWeekendRate,
            seasonalRateOverrides
          });
      const roomTotal = roomBreakdown.roomSubtotal;

      // 6. Calculate Breakfast Add-on
      const finalHasBreakfast = breakfastConfig.isEnabled && hasBreakfast;
      const breakfastTotal = finalHasBreakfast ? actualBreakfastRate * guests * numNights : 0;
      const subtotal = roomTotal + breakfastTotal;

      // 7a. Government Discount Validation
      let discountPct = 0;
      if (discountType === "senior" || discountType === "pwd") {
        discountPct = 20;
        // Verify discount ID is provided client-side
        if (!discountIdPhotoUrl) {
          throw new Error("Government-mandated discount requires verification ID photo.");
        }
      }

      // 7b. Voucher Validation
      // Per W2.12 / decision #100: corporate bookings never accept
      // promo vouchers. Silently zero out the discount + clear the
      // code so the booking doc reflects `voucherDiscount: 0` even
      // if a guest types a code into the corporate booking form.
      let voucherDiscount = 0;
      let appliedVoucherCode = "";
      let voucherUsageUpdate: { ref: any; data: any } | null = null;
      if (voucherCode && !corporateDetails.isCorporate) {
        const formattedCode = voucherCode.trim().toUpperCase();
        // Per BI-10 (booking-intercom audit 2026-07-06): the
        // create-time voucher lookup was `vouchers.doc(code)` only,
        // while `handleValidateVoucher` also falls back to a
        // `where("code", "==", code)` query for docs whose ID
        // differs from their `code` field. A voucher that validated
        // at the gate could therefore silently lose its discount
        // at creation. Apply the same `code`-field fallback here
        // so the create-time lookup matches the validate-time
        // lookup (read inside the transaction so a recently
        // deactivated voucher is caught by the re-validation
        // below).
        let voucherRef = adminDb.collection("vouchers").doc(formattedCode);
        let voucherDoc = await transaction.get(voucherRef);
        if (!voucherDoc.exists) {
          const voucherQuery = adminDb
            .collection("vouchers")
            .where("code", "==", formattedCode)
            .limit(1);
          const voucherQuerySnap = await transaction.get(voucherQuery);
          if (!voucherQuerySnap.empty) {
            voucherDoc = voucherQuerySnap.docs[0];
            voucherRef = voucherDoc.ref;
          }
        }
        if (voucherDoc.exists) {
          const vData = voucherDoc.data()!;
          const now = new Date();
          // Per BF-18 (booking-flow audit 2026-06-26): the
          // assigned room's `type` should match the room type
          // the guest selected (the body's `roomType`). If they
          // diverge (legacy data drift), skip the voucher — it's
          // safer to under-apply than to apply against a room
          // type the guest never saw.
          const assignedTypeMatchesChosen = !roomType || roomData.type === roomType;
          const isValid =
            vData.isActive !== false &&
            (!vData.expiresAt || vData.expiresAt.toDate() >= now) &&
            (vData.usageCap === null || (vData.usageCount || 0) < vData.usageCap) &&
            // Per BF-19 (booking-flow audit 2026-06-26): the
            // empty-or-undefined case is covered by the optional
            // chaining below; drop the redundant `!vData.applicableRoomTypes`
            // short-circuit. The `length === 0` covers both the
            // "empty array" and "falsy" cases via `?.length ?? 0`.
            ((vData.applicableRoomTypes?.length ?? 0) === 0 || vData.applicableRoomTypes.includes(roomData.type)) &&
            assignedTypeMatchesChosen;

          if (isValid) {
            appliedVoucherCode = formattedCode;
            const seniorPwdDiscountForVoucher = Math.round(subtotal * (discountPct / 100));
            const voucherBase = Math.max(subtotal - seniorPwdDiscountForVoucher, 0);
            voucherDiscount = Math.round(calculateVoucherDiscount({
              discountType: vData.discountType === "percent" ? "percent" : "flat",
              discountValue: Number(vData.discountValue) || 0
            }, voucherBase));

            // BR-01: defer the usage write until after the read
            // phase so valid voucher bookings do not trip
            // Firestore's read-after-write transaction guard.
            voucherUsageUpdate = {
              ref: voucherRef,
              data: {
                usageCount: (vData.usageCount || 0) + 1,
                updatedAt: new Date()
              }
            };
          } else {
            throw new Error("Voucher no longer valid");
          }
        } else {
          throw new Error("Voucher no longer valid");
        }
      }

      // 8b. Spark Rewards member discount (3rd stacking step per
      // DECISIONS-FEATURES.md #13b). Read settings/rewardsConfig inside
      // the transaction. Applied to the post-voucher subtotal.
      // Per BF-20 (booking-flow audit 2026-06-26): the local
      // var was named `memberDiscountPct` which collides with
      // the doc field of the same name. Rename to
      // `appliedMemberDiscountPct` so the doc-write is clearly
      // distinct from the in-scope variable.
      let appliedMemberDiscountPct = 0;
      if (detectedMemberId) {
        const rewardsRef = adminDb.doc("settings/rewardsConfig");
        const rewardsDoc = await transaction.get(rewardsRef);
        if (rewardsDoc.exists) {
          const rc = rewardsDoc.data()!;
          if (rc.memberDiscountEnabled !== false) {
            const pct = Number(rc.memberDiscountPct) || 0;
            if (pct > 0) appliedMemberDiscountPct = pct;
          }
        }
      }

      // Stacking order (per DECISIONS-FEATURES.md #13b):
      //   1. Senior/PWD on subtotal
      //   2. Voucher (flat or percent) on post–Senior/PWD subtotal
      //   3. Member discount (percent) on post-voucher subtotal
      const seniorPwdDiscount = Math.round(subtotal * (discountPct / 100));
      const afterSeniorPwd = subtotal - seniorPwdDiscount;
      const afterVoucher = afterSeniorPwd - voucherDiscount;
      const memberDiscount = Math.round(afterVoucher * (appliedMemberDiscountPct / 100));
      const totalPrice = Math.max(afterVoucher - memberDiscount, 0);

      // Canonical pre-discount pricing basis. Always stored, even when no
      // discount is present, so every downstream reader has one convention.
      // Per BF-05 (booking-flow audit 2026-06-26): the value
      // stored must be the full pre-Senior/PWD subtotal so a
      // rejection restores the price the guest would have paid
      // without any discount applied. The previous formula
      // `subtotal - voucherDiscount` was correct only when a
      // voucher was also applied; without a voucher it stored
      // `null` and the reject-discount handler 500'd. The
      // handler now uses `originalTotalPrice - voucherDiscount`
      // to apply the voucher if one was also applied.
      const originalTotalPrice = subtotal;
      const rateBreakdown = buildRateBreakdown({
        roomLines: roomBreakdown.roomLines,
        roomSubtotal: roomTotal,
        breakfastTotal,
        discountType,
        discountPct,
        voucherDiscount,
        memberDiscountPct: appliedMemberDiscountPct,
        finalTotal: totalPrice
      });

      // 9. Generate Reference Number
      const { todayStr, todayCompact } = getManilaDateInfo();
      const counterRef = adminDb.collection("counters").doc(`bookings-${todayStr}`);
      const counterDoc = await transaction.get(counterRef);
      let sequence = 1;
      if (counterDoc.exists) {
        sequence = (counterDoc.data()?.count || 0) + 1;
      }

      // Per H3 (hardening batch 2026-06-26): sequence
      // width is now 5 digits. Mirrors the shared
      // `generateBookingRef` helper; the inline form is
      // kept here so the counter transaction + the ref
      // share the same scope.
      const bookingRef = `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence).padStart(5, "0")}`;

      // Save output for outer scope
      finalBookingRef = bookingRef;
      finalTotalPrice = totalPrice;
      finalRateBreakdown = rateBreakdown;

      if (corporateCodeUsageUpdate) {
        transaction.update(corporateCodeUsageUpdate.ref, corporateCodeUsageUpdate.data);
      }
      if (voucherUsageUpdate) {
        transaction.update(voucherUsageUpdate.ref, voucherUsageUpdate.data);
      }
      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence });
      } else {
        transaction.set(counterRef, { count: 1 });
      }

      // 10. Prepare Document Fields
      const guestName = `${guestDetails.firstName.trim()} ${guestDetails.lastName.trim()}`;
      
      const newBooking = {
        bookingRef,
        roomId,
        roomNumber: roomData.roomNumber,
        roomType,
        guestName,
        guestEmail: guestDetails.email.trim().toLowerCase(),
        guestPhone: guestDetails.phone.trim(),
        numGuests: guests,
        checkIn: Timestamp.fromDate(checkInDate),
        checkOut: Timestamp.fromDate(checkOutDate),
        numNights,
        ratePerNight: activeRoomRate,
        // Per H2 (hardening batch 2026-06-26): random
        // 32-char hex token used by the email magic link
        // to authenticate the lookup / cancel endpoints
        // without leaking the raw `guestEmail` in URLs.
        lookupToken: generateLookupToken(),
        totalPrice,
        rateBreakdown,
        originalTotalPrice,
        discountType: discountType || "",
        discountPct,
        discountIdPhotoUrl: discountIdPhotoUrl || null,
        discountVerified: false,
        discountVerifiedBy: null,
        discountRejected: false,
        discountRejectedBy: null,
        discountRejectionReason: "",
        voucherCode: appliedVoucherCode,
        voucherDiscount,
        isCorporate: corporateDetails.isCorporate,
        corporateCode: corporateDetails.corporateCode,
        companyName: corporateDetails.companyName,
        specialRequests: guestDetails.requests || "",
        status: paymentProofUrl ? "payment-uploaded" : "pending",
        paymentMethod,
        // Per BF-45 (booking-flow audit 2026-06-26): write
        // `null` (not `""`) when no payment proof is attached.
        // `|| null` coalesces both `""` and `undefined` to
        // `null` so the canonical "absent" value is consistent.
        paymentProofUrl: paymentProofUrl || null,
        paymentReferenceNumber: paymentReferenceNumber || null,
        source: corporateDetails.isCorporate ? "corporate" : "online",
        notes: "",
        handledBy: "",
        // Server-detected Spark Rewards member (per W2.2 / decision #90).
        // Set from the Authorization Bearer token detected above.
        memberId: detectedMemberId,
        memberDiscountPct: appliedMemberDiscountPct,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast: finalHasBreakfast,
        breakfastRate: finalHasBreakfast ? actualBreakfastRate : 0,
        guestIdPhotoUrl: null,
        guestRegistration: null,
        breakfastSelections: {},
        cancellationReason: "",
        // Per W2.14 / decision #102: linkedInquiryId is set when a booking
        // is created from a converted corporate inquiry. The body field
        // is null for normal bookings; the convert-to-booking UI (per
        // audit 1.4 SEV-1 #2) will populate it.
        linkedInquiryId: linkedInquiryId || null,
        // Per BI-11 (booking-intercom audit 2026-07-06): the
        // corporate flow collects `designation`,
        // `companyAddress`, `purposeOfStay`, and
        // `preferredBillingArrangement` at Step 2, plus the
        // flat-rate `companyName`. None of this was persisted
        // server-side, so staff could not tell a chargeback
        // booking (LOU workflow per `DECISIONS-FEATURES.md #99`)
        // from a personal-pay one and flat-rate bookings had
        // no company at all. Persist the metadata as a nested
        // `corporate` block **only when** the booking is
        // corporate — non-corporate bookings never carry the
        // field so the schema doesn't drift with empty
        // strings. `preferredBillingArrangement` is normalized
        // to `"personal"` or `"chargeback"`; an unrecognized
        // value falls back to `"chargeback"` since
        // `isCorporate: true` defaults to direct-billing
        // semantics and the staff LOU workflow assumes
        // chargeback.
        ...(corporateDetails.isCorporate
          ? {
              corporate: {
                designation: String(guestDetails.designation || "").trim().slice(0, 120),
                companyAddress: String(guestDetails.companyAddress || "").trim().slice(0, 300),
                purposeOfStay: String(guestDetails.purposeOfStay || "").trim().slice(0, 120),
                billingArrangement:
                  guestDetails.preferredBillingArrangement === "personal"
                    ? "personal"
                    : "chargeback"
              }
            }
          : {}),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      transaction.set(bookingDocRef, newBooking);

      computedData = {
        guestName,
        email: guestDetails.email.trim().toLowerCase(),
        roomName: roomData.name,
        roomNumber: roomData.roomNumber,
        checkIn,
        checkOut,
        numNights,
        totalPrice,
        rateBreakdown,
        source: corporateDetails.isCorporate ? "corporate" : "online"
      };
    });

    // Capture the assigned room outside the transaction scope so
    // the response can hand the roomId/roomNumber to the client for
    // the confirmation page. The booking doc also stores both.
    // (assignedRoomId / assignedRoomNumber were captured inside the
    // transaction above.)
    if (alreadyExistingBookingResponse) {
      return res.status(200).json({
        success: true,
        data: alreadyExistingBookingResponse
      });
    }

    // Send acknowledgment email outside the transaction via Resend
    try {
      await sendBookingTrigger("booking-submitted", {
        ...computedData,
        bookingRef: finalBookingRef,
        guestEmail: computedData.email,
        paymentMethod
      });
    } catch (emailErr) {
      // Log email error, but do not fail the request since booking document is already written successfully
      console.error("Failed to send acknowledgment email:", emailErr);
    }

    // Per W4.4 / decision #104: also notify the staff team of the
    // new booking. Corporate bookings also use this public create path.
    // Persist a timestamp on the booking so a re-fire via the
    // /api/email/staff-new-booking endpoint won't double-send.
    //
    // Per BF-04 (booking-flow audit 2026-06-26): the previous
    // guard read `computedData.emailNotificationsSent?.staffNewBooking`
    // from the in-memory `computedData` object, which is never
    // populated with that field — so the email always fired
    // (and a client retry between send and timestamp write would
    // fire a duplicate). The fix reads the fresh booking doc
    // after commit so the dedup works against real persisted
    // state.
    try {
      const freshBookingSnap = await adminDb.collection("bookings").doc(bookingId).get();
      const alreadySent = freshBookingSnap.exists
        && (freshBookingSnap.data() as any)?.emailNotificationsSent?.staffNewBooking;
      if (!alreadySent) {
        await sendStaffNewBookingTrigger({
          ...computedData,
          bookingRef: finalBookingRef,
          guestEmail: computedData.email,
          paymentMethod,
          source: computedData.source || "online"
        });
        await adminDb.collection("bookings").doc(bookingId).update({
          "emailNotificationsSent.staffNewBooking": new Date()
        });
      }
    } catch (staffEmailErr) {
      console.error("Failed to send staff-new-booking email:", staffEmailErr);
    }

    return res.status(200).json({
      success: true,
      data: {
        bookingId,
        bookingRef: finalBookingRef,
        // Per BF-39 (booking-flow audit 2026-06-26): surface the
        // server-computed `totalPrice` so the confirmation page
        // (and the corporate confirmation step) can display what
        // was actually charged, not the client's local
        // `calculateBookingTotal` (which still carries the
        // weekend-rate override but is otherwise prone to drift).
        totalPrice: finalTotalPrice,
        rateBreakdown: finalRateBreakdown,
        roomId: assignedRoomId,
        roomNumber: assignedRoomNumber,
        roomType
      }
    });

  } catch (error: any) {
    console.error("Booking creation failed:", error);
    // Per BF-32 (booking-flow audit 2026-06-26): surface 503
    // for upstream infrastructure errors (Firebase Auth
    // quota, network) so the client can retry, instead of
    // collapsing them into a generic 500.
    const code = (error as any)?.code || "";
    const isInfraError = typeof code === "string" && (
      code.includes("UNAVAILABLE")
      || code.includes("DEADLINE_EXCEEDED")
      || code.includes("RESOURCE_EXHAUSTED")
      || code.includes("INTERNAL")
    );
    let status: number;
    if (error.message === "Room no longer available" || error.message === ROOM_NOT_READY_PREVIOUS_GUEST_ERROR) {
      status = 409;
    } else if (error.message === "Voucher no longer valid") {
      status = 409;
    } else if (
      // Per BI-10 (booking-intercom audit 2026-07-06): a
      // corporate code that failed re-validation between the
      // gate and the create transaction is a 409 — the code
      // was valid when the guest confirmed, but the server
      // cannot honor the negotiated rate anymore. The client
      // shows the error and sends the guest back to the gate.
      typeof error.message === "string"
      && error.message.startsWith("Corporate code no longer valid")
    ) {
      status = 409;
    } else if (isInfraError) {
      status = 503;
    } else {
      status = 500;
    }
    return res.status(status).json({
      success: false,
      error: error.message || "An unexpected error occurred during booking creation."
    });
  }
}

export async function handleCreateWalkin(req: any, res: any) {
  const parsedWalkin = WalkinBookingSchema.safeParse(req.body || {});
  if (!parsedWalkin.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the walk-in details — a required field is missing or invalid."
    });
  }

  const {
    bookingId,
    roomId,
    checkIn,
    checkOut,
    guests,
    hasBreakfast,
    guestDetails,
    paymentMethod,
    paymentReferenceNumber,
    status,
    totalPriceOverride,
    discountType: requestedDiscountType,
    voucherCode: requestedVoucherCode,
    linkedInquiryId
  } = parsedWalkin.data;

  const checkInDate = new Date(`${checkIn}T00:00:00Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00Z`);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, error: "Invalid check-in or check-out date." });
  }

  const startMs = checkInDate.getTime();
  const endMs = checkOutDate.getTime();
  const numNights = Math.max(Math.round((endMs - startMs) / 86400000), 0);
  if (numNights < 1) {
    return res.status(400).json({ success: false, error: "Stay must be at least 1 night." });
  }

  const { todayStr: todayKey, manilaDate: currentManilaDate } = getManilaDateInfo();
  const currentManilaMinutes = currentManilaDate.getHours() * 60 + currentManilaDate.getMinutes();

  try {
    let finalBookingRef = "";
    let finalTotalPrice = 0;
    let newBooking: Record<string, any> | null = null;

    await adminDb.runTransaction(async (transaction) => {
      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      // Per LR-C1: Firestore requires all transaction reads before
      // writes. Keep the idempotency read with the rest of the read
      // phase so immediate-check-in walkins can safely update the room.
      const existingWalkin = await transaction.get(bookingDocRef);
      if (existingWalkin.exists) {
        throw new Error("Booking already exists");
      }

      // 1. Fetch Room Details
      const roomRef = adminDb.collection("rooms").doc(roomId);
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) {
        throw new Error("Room not found");
      }
      const roomData = roomDoc.data()!;
      if (!roomData.isActive) {
        throw new Error("Room is inactive");
      }
      if (roomData.status === "blocked") {
        const blockedFrom = toDateOrNull(roomData.blockedFrom);
        const blockedTo = toDateOrNull(roomData.blockedTo);
        const windowActive = blockedFrom && blockedTo
          ? checkInDate < blockedTo && checkOutDate > blockedFrom
          : true;
        if (windowActive) {
          throw new Error("Room no longer available");
        }
      }

      // 1b. Per W3.6 + W3.7: pricing + max capacity live on the
      // room type, not on individual room docs. Read the type
      // entry from settings/hotelConfig.roomTypes[] and use those
      // values for the capacity check + pricing. The room-doc
      // fields are no longer authoritative (per TYPES.md §Room).
      const hotelConfigRef = adminDb.collection("settings").doc("hotelConfig");
      const hotelConfigDoc = await transaction.get(hotelConfigRef);
      if (!hotelConfigDoc.exists) {
        throw new Error("Room type catalog is not configured.");
      }
      const hotelConfig = hotelConfigDoc.data()!;
      const roomTypesArr: any[] = Array.isArray(hotelConfig.roomTypes) ? hotelConfig.roomTypes : [];
      const typeEntry = roomTypesArr.find((entry) => entry && entry.value === roomData.type);
      if (!typeEntry) {
        throw new Error("Room type is not available.");
      }
      const typeMaxCapacity = Number(typeEntry.maxCapacity) || 0;
      const typeBaseRate = Number(typeEntry.pricePerNight) || 0;
      const typeWeekendRate = Number(typeEntry.weekendRate) || 0;
      const seasonalRateOverrides = normalizeSeasonalRateOverrides(hotelConfig.seasonalRateOverrides);

      if (guests > typeMaxCapacity) {
        throw new Error(`Guest count exceeds room capacity of ${typeMaxCapacity}.`);
      }

      // 2. Overlapping Booking Check
      const bookingsQuery = adminDb.collection("bookings")
        .where("roomId", "==", roomId)
        .where("status", "in", ROOM_OCCUPYING_STATUSES);
      const bookingsSnapshot = await transaction.get(bookingsQuery);
      
      const conflictReason = bookingsSnapshot.docs
        .map((doc) => getOccupancyConflictReason({
          bookingData: doc.data(),
          requestedCheckIn: checkInDate,
          requestedCheckOut: checkOutDate,
          requestedCheckInKey: checkIn,
          todayKey,
          currentMinutes: currentManilaMinutes,
          checkOutTime: hotelConfig.checkOutTime
        }))
        .find(Boolean);
      const hasConflict = Boolean(conflictReason);

      if (hasConflict) {
        throw new Error(conflictReason === "lingering-checked-in" ? ROOM_NOT_READY_PREVIOUS_GUEST_ERROR : "Room no longer available");
      }
      const hasBlockConflict = await hasActiveRoomBlockConflict(transaction, roomId, checkInDate, checkOutDate);
      if (hasBlockConflict) {
        throw new Error("Room no longer available");
      }

      // 3. Fetch Breakfast Settings
      const breakfastConfigRef = adminDb.collection("settings").doc("breakfastConfig");
      const breakfastConfigDoc = await transaction.get(breakfastConfigRef);
      const breakfastConfig = breakfastConfigDoc.exists ? breakfastConfigDoc.data()! : { isEnabled: false, ratePerPersonPerNight: DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT };
      const actualBreakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT) : 0;

      // 4. Calculate Nightly Rate Total. Seasonal overrides beat
      // weekend rates for walk-ins unless staff enters a manual
      // total override below.
      const roomBreakdown = calculateSeasonalAwareRoomBreakdown({
        checkIn: checkInDate,
        checkOut: checkOutDate,
        roomType: roomData.type,
        baseRate: typeBaseRate,
        weekendRate: typeWeekendRate,
        seasonalRateOverrides
      });
      const roomTotal = roomBreakdown.roomSubtotal;

      // 5. Calculate Breakfast Add-on
      const finalHasBreakfast = breakfastConfig.isEnabled && hasBreakfast;
      const breakfastTotal = finalHasBreakfast ? actualBreakfastRate * guests * numNights : 0;
      const subtotal = roomTotal + breakfastTotal;

      const discountType = requestedDiscountType === "senior" || requestedDiscountType === "pwd"
        ? requestedDiscountType
        : "";
      const discountPct = discountType ? 20 : 0;
      const pricingSubtotal = totalPriceOverride !== undefined && totalPriceOverride !== null
        ? Number(totalPriceOverride)
        : subtotal;
      const seniorPwdDiscount = Math.round(pricingSubtotal * (discountPct / 100));
      const voucherBase = Math.max(pricingSubtotal - seniorPwdDiscount, 0);
      let voucherCode = "";
      let voucherDiscount = 0;
      let voucherUsageUpdate: { ref: any; data: any } | null = null;

      if (requestedVoucherCode) {
        const formattedCode = String(requestedVoucherCode).trim().toUpperCase();
        let voucherRef = adminDb.collection("vouchers").doc(formattedCode);
        let voucherDoc = await transaction.get(voucherRef);
        if (!voucherDoc.exists) {
          const voucherQuery = adminDb.collection("vouchers").where("code", "==", formattedCode).limit(1);
          const voucherQuerySnap = await transaction.get(voucherQuery);
          if (!voucherQuerySnap.empty) {
            voucherDoc = voucherQuerySnap.docs[0];
            voucherRef = voucherDoc.ref;
          }
        }
        if (!voucherDoc.exists) throw new Error("Voucher is invalid or no longer available.");
        const voucherData = voucherDoc.data()!;
        const expiresAt = toDateOrNull(voucherData.expiresAt);
        const voucherIsValid = voucherData.isActive !== false
          && (!expiresAt || expiresAt >= new Date())
          && (voucherData.usageCap == null || Number(voucherData.usageCount || 0) < Number(voucherData.usageCap))
          && ((voucherData.applicableRoomTypes?.length ?? 0) === 0 || voucherData.applicableRoomTypes.includes(roomData.type));
        if (!voucherIsValid) throw new Error("Voucher is invalid or no longer available.");
        voucherCode = formattedCode;
        voucherDiscount = Math.round(calculateVoucherDiscount({
          discountType: voucherData.discountType === "percent" ? "percent" : "flat",
          discountValue: Number(voucherData.discountValue) || 0
        }, voucherBase));
        voucherUsageUpdate = {
          ref: voucherRef,
          data: { usageCount: Number(voucherData.usageCount || 0) + 1, updatedAt: new Date() }
        };
      }

      // Pricing Overrides: Use staff override if provided, otherwise standard computed
      finalTotalPrice = Math.max(voucherBase - voucherDiscount, 0);
      const rateBreakdown = buildRateBreakdown({
        roomLines: totalPriceOverride !== undefined && totalPriceOverride !== null
          ? [{
              source: "manual",
              label: "Manual front-desk rate",
              startDate: checkIn,
              endDate: checkOut,
              nights: numNights,
              nightlyRate: numNights > 0 ? Math.round(pricingSubtotal / numNights) : pricingSubtotal,
              subtotal: pricingSubtotal
            }]
          : roomBreakdown.roomLines,
        roomSubtotal: totalPriceOverride !== undefined && totalPriceOverride !== null ? pricingSubtotal : roomTotal,
        breakfastTotal: totalPriceOverride !== undefined && totalPriceOverride !== null ? 0 : breakfastTotal,
        discountType,
        discountPct,
        voucherDiscount,
        memberDiscountPct: 0,
        finalTotal: finalTotalPrice
      });

      // 6. Generate Reference Number
      const { todayStr, todayCompact } = getManilaDateInfo();
      const counterRef = adminDb.collection("counters").doc(`bookings-${todayStr}`);
      const counterDoc = await transaction.get(counterRef);
      let sequence = 1;
      if (counterDoc.exists) {
        sequence = (counterDoc.data()?.count || 0) + 1;
      }

      // Per H3 (hardening batch 2026-06-26): sequence
      // width is now 5 digits. Mirrors the shared
      // `generateBookingRef` helper; the inline form is
      // kept here so the counter transaction + the ref
      // share the same scope.
      const bookingRef = `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence).padStart(5, "0")}`;
      finalBookingRef = bookingRef;

      // 7. Prepare Document Fields
      const guestName = `${guestDetails.firstName.trim()} ${guestDetails.lastName.trim()}`;
      
      newBooking = {
        bookingRef,
        roomId,
        roomNumber: roomData.roomNumber,
        roomType: roomData.type,
        guestName,
        guestEmail: guestDetails.email.trim().toLowerCase(),
        guestPhone: guestDetails.phone.trim(),
        numGuests: guests,
        checkIn: Timestamp.fromDate(checkInDate),
        checkOut: Timestamp.fromDate(checkOutDate),
        numNights,
        ratePerNight: typeBaseRate,
        totalPrice: finalTotalPrice,
        rateBreakdown,
        originalTotalPrice: pricingSubtotal,
        // Per H2 (hardening batch 2026-06-26): see the
        // matching field in `handleCreateBooking`. The
        // walkin flow writes a token too so the email
        // magic link works the same way for walkins
        // (reception sends it manually to the guest's
        // email).
        lookupToken: generateLookupToken(),
        discountType,
        discountPct,
        discountIdPhotoUrl: null,
        discountVerified: Boolean(discountType),
        discountVerifiedBy: discountType ? (req.staff.uid || "staff") : null,
        discountRejected: false,
        discountRejectedBy: null,
        discountRejectionReason: "",
        voucherCode,
        voucherDiscount,
        isCorporate: false,
        corporateCode: "",
        companyName: "",
        specialRequests: guestDetails.requests || "",
        status: status || "confirmed",
        paymentMethod,
        // Per BF-45 (booking-flow audit 2026-06-26): walkin
        // bookings start without a payment proof; write `null`
        // (not `""`) so the canonical "absent" value is
        // consistent with the online flow.
        paymentProofUrl: null,
        paymentReferenceNumber: paymentReferenceNumber || null,
        source: "walk-in",
        notes: "Created on-site at Front Desk.",
        handledBy: req.staff.uid || "staff",
        memberId: null,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast: finalHasBreakfast,
        breakfastRate: finalHasBreakfast ? actualBreakfastRate : 0,
        guestIdPhotoUrl: null,
        guestRegistration: null,
        breakfastSelections: {},
        cancellationReason: "",
        linkedInquiryId: linkedInquiryId || null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Auto update room status if immediate check-in
      if (status === "checked-in") {
        transaction.update(roomRef, { status: "occupied" });
      }

      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence });
      } else {
        transaction.set(counterRef, { count: 1 });
      }
      if (voucherUsageUpdate) transaction.update(voucherUsageUpdate.ref, voucherUsageUpdate.data);
      transaction.set(bookingDocRef, newBooking);
    });

    const resolvedStatus = status || "confirmed";
    if (resolvedStatus === "confirmed" && newBooking) {
      try {
        await sendBookingTrigger("booking-confirmed", { ...newBooking, status: "confirmed" });
      } catch (emailErr) {
        console.error("Failed to send walk-in booking confirmation email:", emailErr);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        bookingId,
        bookingRef: finalBookingRef,
        totalPrice: finalTotalPrice,
        rateBreakdown: newBooking?.rateBreakdown ?? null
      }
    });

  } catch (error: any) {
    console.error("Walk-in booking creation failed:", error);
    const status = error.message === "Room no longer available" || error.message === ROOM_NOT_READY_PREVIOUS_GUEST_ERROR ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || "An unexpected error occurred during walk-in booking creation."
    });
  }
}

export async function handleApplyBookingDiscount(req: any, res: any) {
  const bookingId = String(req.body?.bookingId || "").trim();
  const requestedDiscountType = req.body?.discountType;
  const requestedVoucherCode = String(req.body?.voucherCode || "").trim().toUpperCase();
  if (!bookingId || !requestedDiscountType && !requestedVoucherCode) {
    return res.status(400).json({ success: false, error: "Choose a government discount or enter a voucher code." });
  }
  if (requestedDiscountType && requestedDiscountType !== "senior" && requestedDiscountType !== "pwd") {
    return res.status(400).json({ success: false, error: "Invalid government discount type." });
  }

  try {
    let result: Record<string, any> = {};
    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) throw new Error("Booking not found.");
      const booking = bookingSnap.data()!;
      if (!["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"].includes(booking.status)) {
        throw new Error("Discounts and vouchers cannot be applied after checkout or cancellation.");
      }
      if (booking.discountType || booking.voucherCode) {
        throw new Error("This booking already has a discount or voucher. Existing grants cannot be replaced from this action.");
      }

      const breakdown = booking.rateBreakdown as BookingRateBreakdown | undefined;
      const storedOriginalTotal = Number(booking.originalTotalPrice);
      const breakdownSubtotal = Number(breakdown?.roomSubtotal || 0)
        + (breakdown?.addOns || []).reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const storedTotalPrice = Number(booking.totalPrice);
      const subtotal = booking.originalTotalPrice !== null
        && booking.originalTotalPrice !== undefined
        && Number.isFinite(storedOriginalTotal)
        && storedOriginalTotal >= 0
        ? storedOriginalTotal
        : breakdown && Number.isFinite(breakdownSubtotal) && breakdownSubtotal > 0
          ? breakdownSubtotal
          : storedTotalPrice;
      if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error("Booking pricing data is incomplete.");

      const discountType = requestedDiscountType === "senior" || requestedDiscountType === "pwd" ? requestedDiscountType : "";
      const discountPct = discountType ? 20 : 0;
      const seniorPwdDiscount = Math.round(subtotal * (discountPct / 100));
      const voucherBase = Math.max(subtotal - seniorPwdDiscount, 0);
      let voucherDiscount = 0;
      let voucherCode = "";
      let voucherRef: FirebaseFirestore.DocumentReference | null = null;
      let voucherUsageCount = 0;

      if (requestedVoucherCode) {
        voucherRef = adminDb.collection("vouchers").doc(requestedVoucherCode);
        let voucherSnap = await transaction.get(voucherRef);
        if (!voucherSnap.exists) {
          const querySnap = await transaction.get(adminDb.collection("vouchers").where("code", "==", requestedVoucherCode).limit(1));
          if (!querySnap.empty) {
            voucherSnap = querySnap.docs[0];
            voucherRef = voucherSnap.ref;
          }
        }
        if (!voucherSnap.exists) throw new Error("Voucher is invalid or no longer available.");
        const voucher = voucherSnap.data()!;
        const expiresAt = toDateOrNull(voucher.expiresAt);
        const valid = voucher.isActive !== false
          && (!expiresAt || expiresAt >= new Date())
          && (voucher.usageCap == null || Number(voucher.usageCount || 0) < Number(voucher.usageCap))
          && ((voucher.applicableRoomTypes?.length ?? 0) === 0 || voucher.applicableRoomTypes.includes(booking.roomType));
        if (!valid) throw new Error("Voucher is invalid or no longer available.");
        voucherCode = requestedVoucherCode;
        voucherUsageCount = Number(voucher.usageCount || 0) + 1;
        voucherDiscount = Math.round(calculateVoucherDiscount({
          discountType: voucher.discountType === "percent" ? "percent" : "flat",
          discountValue: Number(voucher.discountValue) || 0
        }, voucherBase));
      }

      const afterVoucher = Math.max(voucherBase - voucherDiscount, 0);
      const memberDiscountPct = Number(booking.memberDiscountPct || 0);
      const memberDiscount = Math.round(afterVoucher * (memberDiscountPct / 100));
      const pointsValue = Number(booking.pointsRedeemedValue || 0);
      const totalPrice = Math.max(afterVoucher - memberDiscount - pointsValue, 0);
      const rateBreakdown = buildRateBreakdown({
        roomLines: breakdown?.roomLines || [],
        roomSubtotal: Number(breakdown?.roomSubtotal || subtotal),
        breakfastTotal: (breakdown?.addOns || []).reduce((sum, line) => sum + Number(line.amount || 0), 0),
        discountType,
        discountPct,
        voucherDiscount,
        memberDiscountPct,
        pointsRedeemedValue: pointsValue,
        finalTotal: totalPrice
      });
      const staffUid = req.staff?.uid || "staff";
      const updates = {
        originalTotalPrice: subtotal,
        discountType,
        discountPct,
        discountVerified: Boolean(discountType),
        discountVerifiedBy: discountType ? staffUid : null,
        discountRejected: false,
        discountRejectedBy: null,
        discountRejectionReason: "",
        voucherCode,
        voucherDiscount,
        totalPrice,
        rateBreakdown,
        updatedAt: new Date()
      };
      if (voucherRef) transaction.update(voucherRef, { usageCount: voucherUsageCount, updatedAt: new Date() });
      transaction.update(bookingRef, updates);
      result = updates;
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    const message = error.message || "Unable to apply the discount or voucher.";
    const status = message === "Booking not found." ? 404 : 400;
    return res.status(status).json({ success: false, error: message });
  }
}

export async function handleRejectDiscount(req: any, res: any) {
  const { bookingId, reason } = req.body;
  if (!bookingId) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }

    const bookingData = bookingDoc.data()!;
    if (!bookingData.discountType) {
      return res.status(400).json({ success: false, error: "Booking does not have an active government discount request." });
    }

    const originalTotalPrice = bookingData.originalTotalPrice;
    if (originalTotalPrice === null || originalTotalPrice === undefined) {
      return res.status(500).json({ success: false, error: "Original total price not stored on booking." });
    }

    // Per LR-L2: preserve the booking's existing workflow status
    // and re-apply the Spark Rewards member discount after removing
    // only the rejected Senior/PWD discount. Stacking remains:
    // subtotal -> voucher -> member discount -> redeemed points.
    const voucherDiscount = Number(bookingData.voucherDiscount || 0);
    const afterVoucher = Math.max(originalTotalPrice - voucherDiscount, 0);
    const memberDiscountPct = Number(bookingData.memberDiscountPct || 0);
    const memberDiscount = Math.round(afterVoucher * (memberDiscountPct / 100));
    const rawPointsRedeemedValue = Number(bookingData.pointsRedeemedValue || 0);
    const pointsRedeemedValue = Number.isFinite(rawPointsRedeemedValue)
      ? Math.max(rawPointsRedeemedValue, 0)
      : 0;
    const restoredTotalPrice = Math.max(afterVoucher - memberDiscount - pointsRedeemedValue, 0);
    const rateBreakdown = rebuildRateBreakdown({
      ...bookingData,
      discountType: "",
      discountPct: 0,
      pointsRedeemedValue,
      totalPrice: restoredTotalPrice
    }, {
      pointsRedeemedValue,
      finalTotal: restoredTotalPrice
    });

    // Per BF-15 (booking-flow audit 2026-06-26): the
    // `discountRejectedBy` field is a staff UID per the
    // BACKEND.md schema, not the staff email. Audit logs flow
    // through the `bookings/audit/records` collection which is
    // PII-sensitive; writing the email leaks the staff member's
    // contact info. Use the UID from the auth result.
    const discountRejectedBy = req.staff?.uid || "staff";

    const updates = {
      discountRejected: true,
      discountRejectedBy,
      discountRejectionReason: reason || "",
      discountPct: 0,
      totalPrice: restoredTotalPrice,
      ...(rateBreakdown ? { rateBreakdown } : {}),
      updatedAt: new Date()
    };

    await bookingRef.update(updates);

    try {
      await sendBookingTrigger("discount-rejected", {
        ...bookingData,
        discountRejectionReason: reason || "",
        totalPrice: restoredTotalPrice
      });
    } catch (emailErr) {
      console.error("Failed to send discount rejection email:", emailErr);
    }

    return res.status(200).json({ success: true, data: updates });
  } catch (error: any) {
    console.error("Discount rejection handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleCancelBooking(req: any, res: any) {
  const { bookingId, bookingRef, guestEmail, reason } = req.body;

  // Per BF-21 (booking-flow audit 2026-06-26): normalise
  // `reason` once here so the staff + guest paths share the
  // same downstream binding. Staff passes a free-form string;
  // guests go through `guestCancelSchema` which trims +
  // caps to 500 chars.
  let validReason = typeof reason === "string" ? reason.slice(0, 500) : "";

  try {
    let bookingDocumentRef: any;
    let bookingData: any;

    if (req.staff) {
      if (bookingId) {
        bookingDocumentRef = adminDb.collection("bookings").doc(bookingId);
      } else if (bookingRef) {
        const query = adminDb.collection("bookings").where("bookingRef", "==", bookingRef).limit(1);
        const snapshot = await query.get();
        if (snapshot.empty) {
          return res.status(404).json({ success: false, error: "Booking not found." });
        }
        bookingDocumentRef = snapshot.docs[0].ref;
      } else {
        return res.status(400).json({ success: false, error: "Booking ID or Reference is required." });
      }

      const doc = await bookingDocumentRef.get();
      if (!doc.exists) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }
      bookingData = doc.data();
    } else {
      // Per BF-21 (booking-flow audit 2026-06-26): validate
      // the guest-self-service cancel input with the same
      // schema as lookup so a 100KB body / malformed email
      // never reaches Firestore.
      //
      // Per H2 (hardening batch 2026-06-26): the schema
      // accepts either `guestEmail` (legacy) OR `token`
      // (the per-booking `lookupToken`). The query below
      // branches on which was supplied.
      const parsed = guestCancelSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: "Please provide a valid booking reference and email or lookup token."
        });
      }
      validReason = parsed.data.reason;

      const compositeFilter = parsed.data.token
        ? { field: "lookupToken", value: String(parsed.data.token).toLowerCase() }
        : { field: "guestEmail", value: parsed.data.guestEmail };

      const query = adminDb.collection("bookings")
        .where("bookingRef", "==", parsed.data.bookingRef)
        .where(compositeFilter.field, "==", compositeFilter.value)
        .limit(1);

      const snapshot = await query.get();
      if (snapshot.empty) {
        return res.status(404).json({
          success: false,
          error: parsed.data.token
            ? "Booking not found with matching token."
            : "Booking not found with matching email."
        });
      }

      bookingDocumentRef = snapshot.docs[0].ref;
      bookingData = snapshot.docs[0].data();
    }

    // Per BF-16 (booking-flow audit 2026-06-26): the previous
    // block list also rejected `confirmed` and `payment-confirmed`
    // bookings, forcing paid guests to call the front desk. The
    // self-service path is the more useful default; the only
    // statuses that genuinely cannot be cancelled online are the
    // terminal ones (`checked-in` has the guest on-property,
    // `checked-out` is past, `cancelled` is already terminal). A
    // confirmed or payment-confirmed booking has no business
    // reason to be undeleteable — staff can reverse charges out
    // of band if needed.
    if (
      bookingData.status === "checked-in"
      || bookingData.status === "checked-out"
      || bookingData.status === "cancelled"
    ) {
      return res.status(400).json({
        success: false,
        error: `Booking cannot be cancelled because its status is already ${bookingData.status}. Please contact the front desk.`
      });
    }

    await adminDb.runTransaction(async (transaction) => {
      const freshBookingDoc = await transaction.get(bookingDocumentRef);
      if (!freshBookingDoc.exists) {
        throw new Error("Booking not found.");
      }
      const freshBooking = freshBookingDoc.data() || {};
      if (
        freshBooking.status === "checked-in"
        || freshBooking.status === "checked-out"
        || freshBooking.status === "cancelled"
      ) {
        throw new Error(`Booking cannot be cancelled because its status is already ${freshBooking.status}. Please contact the front desk.`);
      }

      const appliedVoucherCode = String(freshBooking.voucherCode || "").trim().toUpperCase();
      const appliedCorporateCode = String(freshBooking.corporateCode || "").trim().toUpperCase();
      let voucherRef: any = null;
      let voucherDoc: any = null;
      if (appliedVoucherCode) {
        voucherRef = adminDb.collection("vouchers").doc(appliedVoucherCode);
        voucherDoc = await transaction.get(voucherRef);
        if (!voucherDoc.exists) {
          const voucherQuery = adminDb.collection("vouchers")
            .where("code", "==", appliedVoucherCode)
            .limit(1);
          const voucherQuerySnap = await transaction.get(voucherQuery);
          if (!voucherQuerySnap.empty) {
            voucherDoc = voucherQuerySnap.docs[0];
            voucherRef = voucherDoc.ref;
          }
        }
      }
      let corporateCodeRef: any = null;
      let corporateCodeDoc: any = null;
      if (appliedCorporateCode) {
        corporateCodeRef = adminDb.collection("corporateCodes").doc(appliedCorporateCode);
        corporateCodeDoc = await transaction.get(corporateCodeRef);
        if (!corporateCodeDoc.exists) {
          const corporateCodeQuery = adminDb.collection("corporateCodes")
            .where("code", "==", appliedCorporateCode)
            .limit(1);
          const corporateCodeQuerySnap = await transaction.get(corporateCodeQuery);
          if (!corporateCodeQuerySnap.empty) {
            corporateCodeDoc = corporateCodeQuerySnap.docs[0];
            corporateCodeRef = corporateCodeDoc.ref;
          }
        }
      }

      transaction.update(bookingDocumentRef, {
        status: "cancelled",
        cancellationReason: validReason,
        updatedAt: new Date()
      });

      if (voucherDoc?.exists && voucherRef) {
        const voucherData = voucherDoc.data() || {};
        transaction.update(voucherRef, {
          usageCount: Math.max((Number(voucherData.usageCount) || 0) - 1, 0),
          updatedAt: new Date()
        });
      }
      if (corporateCodeDoc?.exists && corporateCodeRef) {
        const corporateCodeData = corporateCodeDoc.data() || {};
        transaction.update(corporateCodeRef, {
          usageCount: Math.max((Number(corporateCodeData.usageCount) || 0) - 1, 0),
          updatedAt: new Date()
        });
      }
    });

    try {
      await sendBookingTrigger("booking-cancelled", {
        ...bookingData,
        cancellationReason: validReason
      });
    } catch (emailErr) {
      console.error("Failed to send cancellation email:", emailErr);
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Booking cancellation handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleAddPayment(req: any, res: any) {
  const { bookingId, paymentId, amount, method, note } = req.body || {};
  if (!bookingId || !paymentId || amount === undefined || !method) {
    return res.status(400).json({ success: false, error: "Booking ID, payment ID, amount, and payment method are required." });
  }
  if (!PREALLOCATED_PAYMENT_ID_REGEX.test(String(paymentId))) {
    return res.status(400).json({ success: false, error: "Invalid payment ID format." });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, error: "Payment amount must be a positive number." });
  }

  // Per S4 (soft batch 2026-06-26): a 1B-peso typo would
  // otherwise land in the payments subcollection + inflate
  // the running total past `totalPrice` and skew the audit
  // trail. Cap at 1,000,000 PHP — the largest realistic
  // single payment for a hotel room.
  if (numericAmount > 1_000_000) {
    return res.status(400).json({ success: false, error: "Payment amount exceeds the 1,000,000 per-transaction limit." });
  }

  // Trim + cap the free-form note. A 100KB note used to
  // land in the payments subcollection as-is.
  const safeNote = typeof note === "string" ? note.trim().slice(0, 500) : "";

  // Per BF-14 (booking-flow audit 2026-06-26): the previous
  // implementation wrote the new payment, then re-read the
  // entire `bookings/{id}/payments` subcollection to compute
  // the running total. Two staff adding payments in parallel
  // could each see the other's write missing and either
  // (a) both decide `fullyPaid === false` and miss the
  // `payment-confirmed` trigger, or (b) both decide
  // `fullyPaid === true` and send duplicate `payment-confirmed`
  // emails. The fix appends the payment + re-sums + decides
  // the staff-new-payment dedup inside a Firestore transaction,
  // then defers the email sends to a single follow-up read.
  const staffUid = req.staff?.uid || "staff";
  const paymentRecord = {
    type: "payment",
    amount: numericAmount,
    method,
    note: safeNote,
    reason: null,
    approvedBy: null,
    recordedBy: staffUid,
    recordedAt: new Date()
  };

  // Result of the transaction — used to decide which emails to
  // fire after the transaction commits.
  let totalPaid = 0;
  let totalPrice = 0;
  let isConfirmableStatus = false;
  let fullyPaid = false;
  let transitionedToPaymentConfirmed = false;
  let hadPaymentProof = false;
  let staffPaymentMarkerMissing = true;
  let bookingDataSnapshot: any = null;
  let loyaltyPointsAwarded = 0;
  let idempotentReplay = false;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking not found");
      }
      const bookingData = bookingDoc.data()!;
      bookingDataSnapshot = bookingData;
      transitionedToPaymentConfirmed = false;

      const paymentsRef = bookingRef.collection("payments");
      // Read existing payments before queuing writes. Firestore
      // transactions reject reads after writes, and the final
      // total is the current sum plus this new payment.
      const paymentsSnapshot = await transaction.get(paymentsRef);
      const existingPaid = paymentsSnapshot.docs.reduce((sum, docSnap) => {
        const data = docSnap.data() as { amount?: number };
        return sum + Number(data.amount || 0);
      }, 0);
      const existingPayment = paymentsSnapshot.docs.find((docSnap: any) => docSnap.id === paymentId);
      if (existingPayment) {
        const existingData = existingPayment.data();
        const sameRequest = Number(existingData.amount) === numericAmount
          && String(existingData.method) === String(method)
          && String(existingData.note || "") === safeNote;
        if (!sameRequest) throw new Error("Payment ID has already been used for a different payment.");
        idempotentReplay = true;
        totalPaid = existingPaid;
        totalPrice = Number(bookingData.totalPrice || 0);
        fullyPaid = totalPrice > 0 && totalPaid >= totalPrice;
        staffPaymentMarkerMissing = false;
        return;
      }
      totalPaid = existingPaid + numericAmount;

      totalPrice = Number(bookingData.totalPrice || 0);
      fullyPaid = totalPrice > 0 && totalPaid >= totalPrice;
      isConfirmableStatus = bookingData.status === "pending"
        || bookingData.status === "payment-uploaded";
      hadPaymentProof = !!bookingData.paymentProofUrl;
      staffPaymentMarkerMissing = !bookingData.emailNotificationsSent?.staffNewPayment;

      const pendingLoyaltyPoints = Math.max(Number(bookingData.pendingLoyaltyPoints || 0), 0);
      const settlesCheckedOutFolio = bookingData.status === "checked-out"
        && bookingData.loyaltyAwardStatus === "pending-payment"
        && pendingLoyaltyPoints > 0
        && totalPaid >= Number(bookingData.checkedOutFolioTotal || 0);
      const loyaltyMemberRef = settlesCheckedOutFolio && bookingData.memberId
        ? adminDb.collection("members").doc(String(bookingData.memberId))
        : null;
      const loyaltyMemberDoc = loyaltyMemberRef
        ? await transaction.get(loyaltyMemberRef)
        : null;

      const bookingUpdates: Record<string, any> = {};

      // Mark the staff-new-payment dedup inside the transaction so a
      // concurrent addPayment call doesn't re-fire the staff alert.
      if (hadPaymentProof && staffPaymentMarkerMissing) {
        bookingUpdates["emailNotificationsSent.staffNewPayment"] = new Date();
      }

      // Per Decision #77 / FL-04, reaching the locked booking total is the
      // authoritative transition to payment-confirmed. Keeping this write in
      // the same transaction as the payment append makes the status itself
      // the guest-email idempotency guard under concurrent submissions.
      if (fullyPaid && isConfirmableStatus) {
        const updatedAt = new Date();
        Object.assign(bookingUpdates, {
          status: "payment-confirmed",
          handledBy: staffUid,
          updatedAt
        });
        transitionedToPaymentConfirmed = true;
        bookingDataSnapshot = {
          ...bookingData,
          ...bookingUpdates
        };
      }

      if (settlesCheckedOutFolio && loyaltyMemberRef && loyaltyMemberDoc?.exists) {
        loyaltyPointsAwarded = pendingLoyaltyPoints;
        const awardedAt = new Date();
        Object.assign(bookingUpdates, {
          pointsAwarded: loyaltyPointsAwarded,
          pendingLoyaltyPoints: 0,
          loyaltyAwardStatus: "awarded",
          pointsAwardedAt: awardedAt,
          updatedAt: awardedAt
        });
        transaction.update(loyaltyMemberRef, {
          rewardsPoints: Number(loyaltyMemberDoc.data()?.rewardsPoints || 0) + loyaltyPointsAwarded,
          updatedAt: awardedAt
        });
        const historyRef = loyaltyMemberRef.collection("pointsHistory").doc(`earn-${bookingId}`);
        transaction.set(historyRef, {
          type: "earn",
          points: loyaltyPointsAwarded,
          bookingId,
          bookingRef: bookingData.bookingRef,
          description: `Settled Stay Earnings (${bookingData.bookingRef})`,
          by: staffUid,
          createdAt: awardedAt
        });
      }

      if (Object.keys(bookingUpdates).length > 0) {
        transaction.update(bookingRef, bookingUpdates);
      }

      // Append the payment record inside the transaction after
      // all reads have completed.
      const newPaymentRef = paymentsRef.doc(paymentId);
      transaction.create(newPaymentRef, paymentRecord);
    });
  } catch (error: any) {
    if (error.message === "Booking not found") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error.message === "Payment ID has already been used for a different payment.") {
      return res.status(409).json({ success: false, error: error.message });
    }
    console.error("Add payment handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }

  // Email sends stay outside the transaction (Resend calls are
  // external and slow) but the dedup marker is now written
  // transactionally so the duplicate-fire race is closed.
  try {
    if (transitionedToPaymentConfirmed) {
      await sendBookingTrigger("payment-confirmed", bookingDataSnapshot);
    }
    // Per W4.4 / decision #104: notify staff when a guest
    // uploads a payment proof. Idempotent via the
    // `emailNotificationsSent.staffNewPayment` timestamp.
    if (hadPaymentProof && staffPaymentMarkerMissing) {
      await sendStaffNewPaymentTrigger(
        { ...bookingDataSnapshot, bookingRef: bookingDataSnapshot.bookingRef },
        { ...paymentRecord, paymentProofUrl: bookingDataSnapshot.paymentProofUrl }
      );
    }
  } catch (emailErr) {
    console.error("Failed to send payment confirmation email:", emailErr);
  }

  return res.status(200).json({
    success: true,
    data: {
      ...paymentRecord,
      totalPaid,
      status: bookingDataSnapshot?.status || null,
      loyaltyPointsAwarded,
      idempotentReplay
    }
  });
}

export async function handleAddRefund(req: any, res: any) {
  if (req.staff?.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only an administrator can approve refunds." });
  }
  const { bookingId, amount, method, reason } = req.body || {};
  const numericAmount = Number(amount);
  const safeReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  const safeMethod = typeof method === "string" ? method.trim().slice(0, 80) : "";
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000) {
    return res.status(400).json({ success: false, error: "Refund amount must be between 0.01 and 1,000,000." });
  }
  if (!safeMethod || !safeReason) {
    return res.status(400).json({ success: false, error: "Refund method and reason are required." });
  }

  try {
    let refundRecord: Record<string, any> = {};
    let netCollected = 0;
    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error("Booking not found");
      const paymentsRef = bookingRef.collection("payments");
      const paymentsSnapshot = await transaction.get(paymentsRef);
      netCollected = paymentsSnapshot.docs.reduce((sum, paymentDoc) => sum + Number(paymentDoc.data().amount || 0), 0);
      if (numericAmount > netCollected) {
        throw new Error(`Refund exceeds the net collected amount of ${netCollected}.`);
      }
      const approvedBy = req.staff.uid || "admin";
      refundRecord = {
        type: "refund",
        amount: -numericAmount,
        method: safeMethod,
        note: safeReason,
        reason: safeReason,
        approvedBy,
        recordedBy: approvedBy,
        recordedAt: new Date()
      };
      transaction.set(paymentsRef.doc(), refundRecord);
    });
    return res.status(200).json({ success: true, data: { ...refundRecord, netCollected: netCollected - numericAmount } });
  } catch (error: any) {
    if (error.message === "Booking not found") return res.status(404).json({ success: false, error: "Booking not found." });
    const status = String(error.message || "").startsWith("Refund exceeds") ? 400 : 500;
    return res.status(status).json({ success: false, error: error.message || "Unable to record refund." });
  }
}

export async function handleMarkPaymentConfirmed(req: any, res: any) {
  const { bookingId } = req.body || {};
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const handledBy = req.staff?.uid || "staff";
    let bookingData: any = null;
    let alreadyConfirmed = false;

    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error("BOOKING_NOT_FOUND");
      const data = bookingDoc.data()!;
      bookingData = data;

      if (data.status === "payment-confirmed") {
        alreadyConfirmed = true;
        return;
      }
      if (data.status !== "payment-uploaded") {
        throw new Error(`INVALID_STATUS:${data.status}`);
      }

      transaction.update(bookingRef, {
        status: "payment-confirmed",
        handledBy,
        paymentConfirmedAt: new Date(),
        updatedAt: new Date()
      });
    });

    if (alreadyConfirmed) {
      return res.status(200).json({ success: true, data: { status: "payment-confirmed", alreadyConfirmed: true } });
    }

    try {
      await sendBookingTrigger("payment-confirmed", { ...bookingData, status: "payment-confirmed" });
    } catch (emailErr) {
      console.error("Failed to send payment-confirmed email:", emailErr);
    }

    return res.status(200).json({ success: true, data: { status: "payment-confirmed" } });
  } catch (error: any) {
    if (error?.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error?.message?.startsWith("INVALID_STATUS:")) {
      return res.status(400).json({
        success: false,
        error: `Payment cannot be confirmed because the booking status is already ${error.message.split(":")[1]}.`
      });
    }
    console.error("Mark payment confirmed handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "Unable to confirm payment." });
  }
}

export async function handleConfirmBooking(req: any, res: any) {
  const { bookingId } = req.body || {};
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const confirmedBy = req.staff?.uid || "staff";
    let bookingData: any = null;
    let alreadyConfirmed = false;

    // Per S4 (soft batch 2026-06-26): wrap the
    // read + status check + write in a transaction so two
    // staff confirming the same booking in parallel
    // don't both fire the `booking-confirmed` email. The
    // transaction's first reader sees `pending`; the
    // second sees the new `confirmed` status and
    // short-circuits.
    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("BOOKING_NOT_FOUND");
      }
      const data = bookingDoc.data()!;
      bookingData = data;

      if (data.status === "confirmed") {
        // Idempotent: already confirmed by another staff
        // member. Return success without re-firing the
        // email.
        alreadyConfirmed = true;
        return;
      }

      const allowedStatuses = ["pending", "payment-uploaded", "payment-confirmed"];
      if (!allowedStatuses.includes(data.status)) {
        throw new Error(`INVALID_STATUS:${data.status}`);
      }

      transaction.update(bookingRef, {
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedBy,
        updatedAt: new Date()
      });
    });

    if (alreadyConfirmed) {
      return res.status(200).json({ success: true, data: { status: "confirmed", alreadyConfirmed: true } });
    }

    // Per BF-15 (booking-flow audit 2026-06-26): the
    // `confirmedBy` field is a staff UID per the BACKEND.md
    // schema, not the staff email. The audit collection
    // (`bookings/audit/records/{id}`) reads these fields and
    // is PII-sensitive; storing emails leaks the staff member's
    // contact info. Use the UID from the auth result (the
    // dispatcher's `authenticateStaff` guarantees presence).
    try {
      await sendBookingTrigger("booking-confirmed", { ...bookingData, status: "confirmed" });
    } catch (emailErr) {
      console.error("Failed to send booking confirmation email:", emailErr);
    }

    return res.status(200).json({ success: true, data: { status: "confirmed" } });
  } catch (error: any) {
    if (error?.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error?.message?.startsWith("INVALID_STATUS:")) {
      return res.status(400).json({
        success: false,
        error: `Booking cannot be confirmed because its status is already ${error.message.split(":")[1]}.`
      });
    }
    console.error("Confirm booking handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleCheckinBooking(req: any, res: any) {
  const { bookingId } = req.body;
  if (!bookingId) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const checkedInBy = req.staff?.uid || "staff";

    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking not found.");
      }
      const bookingData = bookingDoc.data() || {};
      const readiness = getCheckInReadiness({
        status: bookingData.status,
        guestIdPhotoUrl: bookingData.guestIdPhotoUrl,
        guestRegistration: bookingData.guestRegistration
      });
      if (!readiness.ready) {
        throw new Error(`Booking is not ready for check-in. Missing: ${readiness.missingItems.join(", ")}.`);
      }
      if (!bookingData.roomId) {
        throw new Error("Booking has no assigned room.");
      }

      const roomRef = adminDb.collection("rooms").doc(String(bookingData.roomId));
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) {
        throw new Error("Assigned room not found.");
      }
      const roomData = roomDoc.data() || {};
      if (roomData.status === "blocked") {
        throw new Error("Assigned room is blocked and cannot be checked in.");
      }

      const activeCheckinQuery = adminDb.collection("bookings")
        .where("roomId", "==", String(bookingData.roomId))
        .where("status", "==", "checked-in")
        .limit(1);
      const activeCheckinSnap = await transaction.get(activeCheckinQuery);
      const occupiedByOtherBooking = activeCheckinSnap.docs.some((doc: any) => doc.id !== bookingId);
      if (occupiedByOtherBooking) {
        throw new Error("Assigned room is already occupied by another checked-in booking.");
      }

      transaction.update(bookingRef, {
        status: "checked-in",
        checkedInAt: new Date(),
        checkedInBy,
        updatedAt: new Date()
      });
      transaction.update(roomRef, {
        status: "occupied",
        updatedAt: new Date()
      });
    });

    return res.status(200).json({ success: true, data: { status: "checked-in" } });
  } catch (error: any) {
    if (
      error?.message?.startsWith("Booking is not ready for check-in.") ||
      error?.message?.startsWith("Assigned room") ||
      error?.message === "Booking not found." ||
      error?.message === "Booking has no assigned room."
    ) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error("Check-in booking handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleCheckoutBooking(req: any, res: any) {
  const { bookingId } = req.body;
  if (!bookingId) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }

    const bookingData = bookingDoc.data()!;
    if (bookingData.status !== "checked-in") {
      return res.status(400).json({
        success: false,
        error: `Booking can only be checked out from 'checked-in' status (current: ${bookingData.status}).`
      });
    }

    // Per BF-15 (booking-flow audit 2026-06-26): store the staff
    // UID (not email) on `checkedOutBy` + `resolvedBy`. These
    // fields flow into the `bookings/audit/records` collection
    // and are PII-sensitive.
    const checkedOutBy = req.staff?.uid || "staff";

    let pointsAwarded = 0;
    let eligiblePoints = 0;
    let checkedOutWithBalance = 0;
    let memberId: string | null = bookingData.memberId || null;
    let rewardsConfig: any = null;

    // Try to find member either by memberId (if booking is already linked) or by guestEmail
    let memberDoc: any = null;
    if (memberId) {
      memberDoc = await adminDb.collection("members").doc(memberId).get();
    }
    if (!memberDoc?.exists && bookingData.guestEmail) {
      const guestEmail = String(bookingData.guestEmail).toLowerCase();
      const membersSnap = await adminDb.collection("members")
        .where("email", "==", guestEmail)
        .limit(1)
        .get();
      if (!membersSnap.empty) {
        memberDoc = membersSnap.docs[0];
        memberId = memberDoc.id;
      }
    }

    if (memberDoc?.exists) {
      const rewardsDoc = await adminDb.collection("settings").doc("rewardsConfig").get();
      rewardsConfig = rewardsDoc.exists ? rewardsDoc.data() : null;
    }

    await adminDb.runTransaction(async (transaction) => {
      const freshBookingDoc = await transaction.get(bookingRef);
      if (!freshBookingDoc.exists) {
        throw new Error("Booking not found.");
      }
      const freshBookingData = freshBookingDoc.data()!;
      if (freshBookingData.status !== "checked-in") {
        throw new Error(`Booking can only be checked out from 'checked-in' status (current: ${freshBookingData.status}).`);
      }

      const paymentsRef = bookingRef.collection("payments");
      const chargesRef = bookingRef.collection("charges");
      const storeOrdersQuery = adminDb.collection("storeOrders").where("bookingId", "==", bookingId);
      const paymentsSnapshot = await transaction.get(paymentsRef);
      const chargesSnapshot = await transaction.get(chargesRef);
      const storeOrdersSnapshot = await transaction.get(storeOrdersQuery);
      const collectedTotal = sumLedgerAmounts(paymentsSnapshot);
      const incidentalTotal = sumLedgerAmounts(chargesSnapshot);
      const addToBillTotal = sumBilledAddToBillOrders(storeOrdersSnapshot);
      const checkoutFolioTotal = Number(freshBookingData.totalPrice || 0) + incidentalTotal + addToBillTotal;
      checkedOutWithBalance = Math.max(checkoutFolioTotal - collectedTotal, 0);
      eligiblePoints = memberId
        ? calculateCheckoutPoints(Number(freshBookingData.totalPrice || 0), rewardsConfig)
        : 0;

      const memberRef = memberId && eligiblePoints > 0
        ? adminDb.collection("members").doc(memberId)
        : null;
      const memberDocInTransaction = memberRef
        ? await transaction.get(memberRef)
        : null;
      const { todayStr } = getManilaDateInfo();
      const checkoutDate = new Date(`${todayStr}T00:00:00Z`);
      const originalCheckIn = toDateOrNull(freshBookingData.checkIn);
      const originalCheckOut = toDateOrNull(freshBookingData.checkOut);
      const shouldTruncateStay = originalCheckIn
        && originalCheckOut
        && checkoutDate > originalCheckIn
        && checkoutDate < originalCheckOut;

      const bookingUpdate: Record<string, any> = {
        status: "checked-out",
        checkedOutAt: new Date(),
        checkedOutBy,
        checkedOutWithBalance,
        checkedOutFolioTotal: checkoutFolioTotal,
        checkedOutCollectedTotal: collectedTotal,
        updatedAt: new Date()
      };
      if (memberId && freshBookingData.memberId !== memberId) {
        bookingUpdate.memberId = memberId;
      }
      if (shouldTruncateStay && originalCheckIn) {
        const truncatedNights = Math.max(Math.round((checkoutDate.getTime() - originalCheckIn.getTime()) / 86400000), 1);
        bookingUpdate.checkOut = Timestamp.fromDate(checkoutDate);
        bookingUpdate.numNights = truncatedNights;
        bookingUpdate.earlyCheckoutOriginalCheckOut = freshBookingData.checkOut;
        bookingUpdate.rateBreakdown = rebuildEarlyCheckoutRateBreakdown(freshBookingData, truncatedNights);
      }

      const canAwardPoints = Boolean(memberId && eligiblePoints > 0 && memberRef && memberDocInTransaction?.exists);
      const awardNow = canAwardPoints && checkedOutWithBalance <= 0;
      pointsAwarded = awardNow ? eligiblePoints : 0;
      Object.assign(bookingUpdate, {
        pointsAwarded,
        pendingLoyaltyPoints: canAwardPoints && !awardNow ? eligiblePoints : 0,
        loyaltyAwardStatus: canAwardPoints ? (awardNow ? "awarded" : "pending-payment") : "ineligible",
        pointsAwardedAt: awardNow ? new Date() : null
      });

      transaction.update(bookingRef, bookingUpdate);

      if (bookingData.roomId) {
        const roomRef = adminDb.collection("rooms").doc(String(bookingData.roomId));
        transaction.update(roomRef, {
          status: "available",
          housekeepingStatus: "dirty",
          updatedAt: new Date()
        });
      }

      // Per W2.7 / decision #95: auto-archive the intercom thread on
      // checkout. Sets `intercoms/{roomNumber}.resolved = true` so the
      // thread moves out of the active inbox tab. Staff can reopen from
      // the admin Inbox by toggling resolved: false.
      const roomNumber = String(bookingData.roomNumber || "");
      if (roomNumber) {
        const intercomRef = adminDb.collection("intercoms").doc(roomNumber);
        transaction.set(
          intercomRef,
          { resolved: true, resolvedAt: new Date(), resolvedBy: checkedOutBy, roomNumber, updatedAt: new Date() },
          { merge: true }
        );
      }

      if (awardNow && memberId && memberRef && memberDocInTransaction?.exists) {
        const currentPoints = Number(memberDocInTransaction.data()?.rewardsPoints || 0);
        transaction.update(memberRef, {
          rewardsPoints: currentPoints + pointsAwarded,
          updatedAt: new Date()
        });

        const historyRef = adminDb.collection("members").doc(memberId).collection("pointsHistory").doc(`earn-${bookingId}`);
        transaction.set(historyRef, {
          type: "earn",
          points: pointsAwarded,
          bookingId,
          bookingRef: bookingData.bookingRef,
          description: `Stay Checkout Earnings (${bookingData.bookingRef})`,
          by: checkedOutBy,
          createdAt: new Date()
        });
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        status: "checked-out",
        pointsAwarded,
        memberId,
        checkedOutWithBalance
      }
    });
  } catch (error: any) {
    console.error("Checkout booking handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleLookupBooking(req: any, res: any) {
  const parsed = lookupSchema.safeParse(req.body || {});
  if (!parsed.success) {
    // Per BF-21 (booking-flow audit 2026-06-26): return 400
    // (not 404) on malformed input so the caller can
    // distinguish "bad input" from "no match". The error
    // message is intentionally generic so the validator
    // does not become an oracle for the booking-ref shape.
    return res.status(400).json({
      success: false,
      error: "Please provide a valid booking reference and email or lookup token."
    });
  }

  const { bookingRef: trimmedRef, guestEmail: normalizedEmail, token: lookupToken } = parsed.data;

  try {
    // Per H2 (hardening batch 2026-06-26): the token
    // path queries by `bookingRef + lookupToken` (an
    // indexed compound — both fields are part of the
    // existing composite index), bypassing `guestEmail`
    // entirely. The email path is unchanged.
    const compositeFilter = lookupToken
      ? { field: "lookupToken", value: String(lookupToken).toLowerCase() }
      : { field: "guestEmail", value: normalizedEmail };

    const snapshot = await adminDb.collection("bookings")
      .where("bookingRef", "==", trimmedRef)
      .where(compositeFilter.field, "==", compositeFilter.value)
      .limit(1)
      .get();

    if (snapshot.empty) {
      // The composite index on (bookingRef, guestEmail)
      // is the original lookup path. If the email-mode
      // query returns no rows, retry with a fallback
      // (limit 5) by bookingRef and re-filter in JS in
      // case the stored email differs in case / whitespace.
      // The token-mode query has no equivalent fallback
      // (tokens are generated server-side and never
      // re-cased by the user).
      if (lookupToken) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }

      const fallbackSnapshot = await adminDb.collection("bookings")
        .where("bookingRef", "==", trimmedRef)
        .limit(5)
        .get();

      const matched = fallbackSnapshot.docs.find((doc: any) => {
        const data = doc.data();
        return String(data.guestEmail || "").trim().toLowerCase() === normalizedEmail;
      });

      if (!matched) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }

      const bookingData: any = { id: matched.id, ...matched.data() };
      return await enrichAndRespond(res, bookingData);
    }

    const bookingDoc = snapshot.docs[0];
    const bookingData: any = { id: bookingDoc.id, ...bookingDoc.data() };
    return await enrichAndRespond(res, bookingData);
  } catch (error: any) {
    console.error("Booking lookup failed:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to look up booking. Please try again." });
  }
}

async function enrichAndRespond(res: any, bookingData: any) {
  let roomData: any = null;
  if (bookingData.roomId) {
    try {
      const roomDoc = await adminDb.collection("rooms").doc(String(bookingData.roomId)).get();
      if (roomDoc.exists) {
        roomData = roomDoc.data();
      }
    } catch (roomErr) {
      console.error("Failed to enrich booking with room data:", roomErr);
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      id: bookingData.id,
      bookingRef: bookingData.bookingRef,
      guestName: bookingData.guestName,
      guestEmail: bookingData.guestEmail,
      guestPhone: bookingData.guestPhone,
      roomId: bookingData.roomId,
      roomNumber: bookingData.roomNumber,
      roomName: roomData?.name || bookingData.roomType || "",
      roomType: bookingData.roomType,
      checkIn: bookingData.checkIn,
      checkOut: bookingData.checkOut,
      numNights: bookingData.numNights,
      numGuests: bookingData.numGuests,
      ratePerNight: bookingData.ratePerNight,
      totalPrice: bookingData.totalPrice,
      rateBreakdown: bookingData.rateBreakdown || null,
      paymentMethod: bookingData.paymentMethod,
      status: bookingData.status,
      hasBreakfast: bookingData.hasBreakfast,
      specialRequests: bookingData.specialRequests || ""
    }
  });
}

const resolveEarlyCheckinSchema = z.object({
  bookingId: z.string().trim().min(1).max(80),
  status: z.enum(["approved", "declined"]),
  staffNote: z.string().trim().max(500).optional().default(""),
  // An empty string means "no override" (the admin form sends "" when the
  // guest's requested time could not seed the dropdown) — treat it as absent
  // so the approve path falls back to requestedTime instead of failing.
  confirmedTime: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().regex(/^(0[1-9]|1[0-2]):[0-5][0-9]\s(AM|PM)$/).optional()
  )
});

export async function handleResolveEarlyCheckin(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const parsed = resolveEarlyCheckinSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Invalid resolution request details." });
  }

  const { bookingId, status, staffNote, confirmedTime } = parsed.data;

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const resolvedBy = req.staff?.name || req.staff?.email || "Staff Member";
    let bookingData: any = null;

    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("BOOKING_NOT_FOUND");
      }
      const data = bookingDoc.data()!;
      if (!data.earlyCheckIn) {
        throw new Error("NO_REQUEST_FOUND");
      }
      
      const updatedEarlyCheckIn = {
        ...data.earlyCheckIn,
        status,
        resolvedAt: new Date().toISOString(),
        resolvedBy,
        staffNote: staffNote || "",
        confirmedTime: status === "approved" ? (confirmedTime || data.earlyCheckIn.requestedTime) : null
      };

      bookingData = { id: bookingDoc.id, ...data, earlyCheckIn: updatedEarlyCheckIn };

      transaction.update(bookingRef, {
        earlyCheckIn: updatedEarlyCheckIn,
        updatedAt: new Date()
      });
    });

    // Send resolve email trigger to the guest
    try {
      await sendEarlyCheckinResolveTrigger(bookingData, status, staffNote);
    } catch (emailErr) {
      console.error("Failed to send early check-in resolve email:", emailErr);
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    if (error?.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error?.message === "NO_REQUEST_FOUND") {
      return res.status(400).json({ success: false, error: "No early check-in request exists for this booking." });
    }
    console.error("Resolve early check-in handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleRescheduleBooking(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const { bookingId, roomId, checkIn, checkOut, reason } = req.body || {};
  if (!bookingId || !roomId || !checkIn || !checkOut) {
    return res.status(400).json({ success: false, error: "Booking, room, check-in, and check-out are required." });
  }

  const checkInDate = new Date(`${checkIn}T00:00:00Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, error: "Invalid check-in or check-out date." });
  }
  const numNights = Math.max(Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86400000), 0);
  if (numNights < 1) {
    return res.status(400).json({ success: false, error: "Stay must be at least 1 night." });
  }

  const { todayStr: todayKey, manilaDate: currentManilaDate } = getManilaDateInfo();
  const currentManilaMinutes = currentManilaDate.getHours() * 60 + currentManilaDate.getMinutes();

  try {
    let updatedBooking: any = null;
    let fullBookingForEmail: any = null;

    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(String(bookingId));
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error("Booking not found.");
      const booking = bookingDoc.data() || {};
      if (!RESCHEDULABLE_STATUSES.includes(String(booking.status))) {
        throw new Error(`Booking cannot be moved while status is ${booking.status}.`);
      }

      const roomRef = adminDb.collection("rooms").doc(String(roomId));
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) throw new Error("Room not found.");
      const room = roomDoc.data() || {};
      if (room.isActive === false) throw new Error("Target room is inactive.");
      if (room.status === "blocked") {
        const blockedFrom = toDateOrNull(room.blockedFrom);
        const blockedTo = toDateOrNull(room.blockedTo);
        const windowActive = blockedFrom && blockedTo
          ? rangesOverlap(blockedFrom, blockedTo, checkInDate, checkOutDate)
          : true;
        if (windowActive) throw new Error("Target room is blocked for those dates.");
      }

      // Load Hotel Config before occupancy checks because runtime
      // checkout time controls when today's departures become overdue.
      const hotelConfigDoc = await transaction.get(adminDb.collection("settings").doc("hotelConfig"));
      const hotelConfig = hotelConfigDoc.data() || {};
      const roomTypesArr: any[] = Array.isArray(hotelConfig.roomTypes) ? hotelConfig.roomTypes : [];

      const overlapQuery = adminDb.collection("bookings")
        .where("roomId", "==", String(roomId))
        .where("status", "in", ROOM_OCCUPYING_STATUSES);
      const overlapSnapshot = await transaction.get(overlapQuery);
      const conflictReason = overlapSnapshot.docs
        .filter((doc) => doc.id !== String(bookingId))
        .map((doc) => getOccupancyConflictReason({
          bookingData: doc.data(),
          requestedCheckIn: checkInDate,
          requestedCheckOut: checkOutDate,
          requestedCheckInKey: checkIn,
          todayKey,
          currentMinutes: currentManilaMinutes,
          checkOutTime: hotelConfig.checkOutTime
        }))
        .find(Boolean);
      if (conflictReason) {
        throw new Error(conflictReason === "lingering-checked-in"
          ? "Target room is not ready because the previous guest has not checked out yet."
          : "Target room already has a booking in that date range.");
      }

      const hasBlockConflict = await hasActiveRoomBlockConflict(transaction, String(roomId), checkInDate, checkOutDate);
      if (hasBlockConflict) throw new Error("Target room is blocked for that date range.");

      // Load Breakfast Config (source of truth for the live rate). Read
      // here alongside the other transaction reads, before any writes.
      const breakfastConfigDoc = await transaction.get(adminDb.collection("settings").doc("breakfastConfig"));
      const breakfastConfig = breakfastConfigDoc.data() || {};
      const typeEntry = roomTypesArr.find((entry) => entry && entry.value === room.type);
      if (!typeEntry) throw new Error("Room type configuration not found.");

      // PF-03: Capacity check
      if (typeof typeEntry.maxCapacity === "number" && (booking.numGuests || 0) > typeEntry.maxCapacity) {
        throw new Error(`Target room type capacity is exceeded. Maximum allowed guests: ${typeEntry.maxCapacity}.`);
      }

      // PF-03: Pricing recalculation
      const manualNightlyRate = getLockedManualNightlyRate(
        booking.rateBreakdown as BookingRateBreakdown | null | undefined
      );
      let activeRoomRate = typeEntry.pricePerNight || 0;
      if (booking.isCorporate) {
        let typeCorporateRate = typeEntry.corporateRate || 0;
        activeRoomRate = typeCorporateRate > 0 ? typeCorporateRate : activeRoomRate;

        if (booking.corporateCode) {
          const corpRef = adminDb.collection("corporateCodes").doc(booking.corporateCode);
          const corpDoc = await transaction.get(corpRef);
          if (corpDoc.exists) {
            const corpData = corpDoc.data() || {};
            if (corpData.ratePerRoomType?.[room.type]) {
              activeRoomRate = corpData.ratePerRoomType[room.type];
            }
          }
        }
      }

      const seasonalRateOverrides = normalizeSeasonalRateOverrides(hotelConfig.seasonalRateOverrides);
      const roomBreakdown = manualNightlyRate !== null
        ? {
            roomSubtotal: Math.round(manualNightlyRate * numNights),
            roomLines: [{
              source: "manual" as const,
              label: "Manual front-desk rate",
              startDate: checkIn,
              endDate: checkOut,
              nights: numNights,
              nightlyRate: manualNightlyRate,
              subtotal: Math.round(manualNightlyRate * numNights)
            }]
          }
        : booking.isCorporate
        ? {
            roomSubtotal: activeRoomRate * numNights,
            roomLines: [{
              source: "corporate" as const,
              label: booking.corporateCode ? "Corporate negotiated rate" : "Corporate flat rate",
              startDate: checkIn,
              endDate: checkOut,
              nights: numNights,
              nightlyRate: activeRoomRate,
              subtotal: activeRoomRate * numNights
            }]
          }
        : calculateSeasonalAwareRoomBreakdown({
            checkIn: checkInDate,
            checkOut: checkOutDate,
            roomType: room.type,
            baseRate: activeRoomRate,
            weekendRate: typeEntry.weekendRate || typeEntry.pricePerNight || 0,
            seasonalRateOverrides
          });
      const roomTotal = roomBreakdown.roomSubtotal;

      const breakfastRate = booking.breakfastRate || breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT;
      // A walk-in manual override is the complete staff-agreed pricing basis;
      // its original breakdown intentionally carries no separate breakfast
      // line. Preserve that convention instead of adding breakfast on move.
      const breakfastTotal = manualNightlyRate === null && booking.hasBreakfast
        ? breakfastRate * (booking.numGuests || 1) * numNights
        : 0;
      const subtotal = roomTotal + breakfastTotal;

      let discountPct = 0;
      if (booking.discountType === "senior" || booking.discountType === "pwd") {
        discountPct = 20;
      }

      let voucherDiscount = 0;
      if (booking.voucherCode) {
        const voucherRef = adminDb.collection("vouchers").doc(booking.voucherCode);
        const voucherDoc = await transaction.get(voucherRef);
        if (voucherDoc.exists) {
          const vData = voucherDoc.data() || {};
          const seniorPwdDiscountForVoucher = Math.round(subtotal * (discountPct / 100));
          const voucherBase = Math.max(subtotal - seniorPwdDiscountForVoucher, 0);
          voucherDiscount = Math.round(calculateVoucherDiscount({
            discountType: vData.discountType === "percent" ? "percent" : "flat",
            discountValue: Number(vData.discountValue) || 0
          }, voucherBase));
        } else {
          voucherDiscount = booking.voucherDiscount || 0;
        }
      }

      let appliedMemberDiscountPct = 0;
      if (booking.memberId) {
        const rewardsRef = adminDb.doc("settings/rewardsConfig");
        const rewardsDoc = await transaction.get(rewardsRef);
        if (rewardsDoc.exists) {
          const rc = rewardsDoc.data()!;
          if (rc.memberDiscountEnabled !== false) {
            const pct = Number(rc.memberDiscountPct) || 0;
            if (pct > 0) appliedMemberDiscountPct = pct;
          }
        }
      }

      const seniorPwdDiscount = Math.round(subtotal * (discountPct / 100));
      const afterSeniorPwd = subtotal - seniorPwdDiscount;
      const afterVoucher = afterSeniorPwd - voucherDiscount;
      const memberDiscount = Math.round(afterVoucher * (appliedMemberDiscountPct / 100));
      const totalPrice = Math.max(afterVoucher - memberDiscount, 0);
      const finalTotalPrice = Math.max(totalPrice - (booking.pointsRedeemedValue || 0), 0);
      const originalTotalPrice = subtotal;
      const rateBreakdown = buildRateBreakdown({
        roomLines: roomBreakdown.roomLines,
        roomSubtotal: roomTotal,
        breakfastTotal,
        discountType: booking.discountType || "",
        discountPct,
        voucherDiscount,
        memberDiscountPct: appliedMemberDiscountPct,
        pointsRedeemedValue: booking.pointsRedeemedValue || 0,
        finalTotal: finalTotalPrice
      });

      const rescheduleEntry = {
        fromRoomId: booking.roomId || "",
        fromRoomNumber: booking.roomNumber || "",
        fromCheckIn: toDateOrNull(booking.checkIn)?.toISOString() || "",
        fromCheckOut: toDateOrNull(booking.checkOut)?.toISOString() || "",
        toRoomId: String(roomId),
        toRoomNumber: String(room.roomNumber || ""),
        toCheckIn: checkIn,
        toCheckOut: checkOut,
        reason: typeof reason === "string" ? reason.slice(0, 500) : "",
        by: req.staff?.uid || req.staff?.email || "staff",
        at: new Date().toISOString(),
        pricingBasis: manualNightlyRate !== null ? "manual" : "recalculated",
        deltaTotalPrice: finalTotalPrice - (booking.totalPrice || 0)
      };

      updatedBooking = {
        roomId: String(roomId),
        roomNumber: String(room.roomNumber || ""),
        roomType: String(room.type || booking.roomType || ""),
        checkIn: Timestamp.fromDate(checkInDate),
        checkOut: Timestamp.fromDate(checkOutDate),
        numNights,
        ratePerNight: manualNightlyRate ?? activeRoomRate,
        totalPrice: finalTotalPrice,
        rateBreakdown,
        originalTotalPrice,
        voucherDiscount,
        rescheduleHistory: [...(Array.isArray(booking.rescheduleHistory) ? booking.rescheduleHistory : []), rescheduleEntry],
        updatedAt: new Date()
      };

      fullBookingForEmail = {
        ...booking,
        ...updatedBooking,
        id: bookingId
      };

      // If the guest is in-house (checked-in), sync room statuses
      if (booking.status === "checked-in") {
        const oldRoomRef = adminDb.collection("rooms").doc(booking.roomId);
        transaction.update(oldRoomRef, { status: "available" });
        transaction.update(roomRef, { status: "occupied" });
      }

      transaction.update(bookingRef, updatedBooking);
    });

    // Send email to guest
    if (fullBookingForEmail) {
      try {
        await sendBookingTrigger("booking-rescheduled", fullBookingForEmail);
      } catch (emailErr) {
        console.error("Failed to send reschedule email:", emailErr);
      }
    }

    return res.status(200).json({ success: true, data: updatedBooking });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message || "Failed to move booking." });
  }
}
