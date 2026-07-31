import { adminAuth, adminDb } from "../lib/firebase-admin";
import { hashToken } from "./test-runs";
import { Timestamp } from "firebase-admin/firestore";
import { sendBookingTrigger, sendBookingConfirmedWithBalanceTrigger, sendStaffNewBookingTrigger, sendStaffNewPaymentTrigger, sendEarlyCheckinResolveTrigger } from "./email";
import { writeNotification } from "../lib/notifications";
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
  WalkinBookingSchema,
  MAX_STAY_NIGHTS,
  MAX_ADVANCE_DAYS
} from "@spark-inn/shared";
import type { BookingRateBreakdown } from "@spark-inn/shared";
import { DEFAULT_TERMS_VERSION } from "@spark-inn/shared";
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

function isExpectedBookingUploadPath(path: string | null | undefined, bookingId: string, folder: "payment-proof" | "discount-id") {
  if (!path) return true;
  const prefix = `bookings/${bookingId}/${folder}/`;
  const fileName = path.slice(prefix.length);
  return path.startsWith(prefix) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(fileName);
}

function sumLedgerAmounts(snapshot: any): number {
  return snapshot.docs.reduce((sum: number, docSnap: any) => sum + Number(docSnap.data()?.amount || 0), 0);
}

// Per NBS-02 (2026-07-31): derive a short, source-accurate note for
// walk-in bookings. The historical shape was the hardcoded
// "Created on-site at Front Desk." which was wrong for any
// non-walk-in source (a phone booking was claiming it was created
// at the desk). The fallback is the historical copy for "walk-in"
// to preserve the existing record shape; everything else gets a
// note that matches the channel.
function deriveSourceNote(source: string): string {
  switch (source) {
    case "walk-in":
      return "Created on-site at Front Desk.";
    case "phone":
      return "Booked via phone call.";
    case "facebook":
      return "Booked via Facebook / Messenger.";
    case "agoda":
      return "Booked via Agoda (OTA).";
    default:
      // Configured sources the server doesn't have a hardcoded
      // note for (admin can add new ones in Settings) get a
      // generic note that still matches the channel.
      return `Booked via ${source}.`;
  }
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

// Per decisions #126 (2026-07-25) + #131 (2026-07-25): the
// multi-booking picker AND the single-booking card both
// surface a masked email instead of the full one. The
// first character of the local part + three asterisks +
// the full domain keeps the row / card readable for the
// legit user ("yes, the search keyed on the email I
// typed") while leaking nothing new — the attacker
// already typed this email.
function maskEmail(email: string): string {
  if (!email) return "";
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***";
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!domain) return "***";
  const first = local.charAt(0) || "";
  return `${first}***@${domain}`;
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
// Per H2 (hardening batch 2026-06-26): the schemas
// accept either `guestEmail` (legacy) OR `token` (the new
// per-booking `lookupToken` random hex). The token path is
// what the email magic link uses — the URL no longer
// carries the raw `guestEmail`, so PII never lands in
// browser history or Vercel access logs.
//
// Per the feat/relax-booking-lookup change: the lookup
// schema now accepts any ONE of `bookingRef`, `guestEmail`,
// or `token` (not all three required). Ref alone enables
// guests who lost their email; email alone enables guests
// who lost their ref. The endpoint is still Turnstile-gated
// and rate-limited (10/min per IP + 3-failure 1-hour
// backoff), and ref-alone enumeration is bounded by the
// `{prefix}-YYYYMMDD-NNN` namespace + Turnstile cost.
// The handler prioritises the most specific key when
// multiple are present: `ref + token` > `ref + email` >
// `ref` > `email` > `token`.
// Per fix/lookup-empty-string-handling: the client
// always sends every key in the payload, so an "email
// alone" submit still carries `bookingRef: ""` (or
// whitespace) and `token: ""`. `.optional()` only matches
// `undefined`, not `""`, so the per-field regex / .email()
// would reject the empty string and return 400 even when
// the user only filled in a different field. The
// top-level `z.preprocess` strips empty / whitespace-only
// strings from the body before validation runs, so the
// schema always sees clean values. The dispatch's truthy
// checks below skip the empty fields and route to the
// right key. This is also defense in depth for any future
// client that submits the same shape.
const lookupSchema = z.preprocess(
  (body) => {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const obj: Record<string, unknown> = { ...body };
      for (const key of ["bookingRef", "guestEmail", "token", "turnstileToken"] as const) {
        const v = obj[key];
        if (typeof v === "string" && v.trim() === "") {
          delete obj[key];
        }
      }
      return obj;
    }
    return body;
  },
  z
    .object({
      bookingRef: z
        .string()
        .trim()
        .max(40)
        .regex(BOOKING_REF_REGEX, "Invalid booking reference format.")
        .optional(),
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
      (data) => Boolean(data.bookingRef) || Boolean(data.guestEmail) || Boolean(data.token),
      "Provide a booking reference, email, or lookup token."
    )
    .refine(
      (data) => !(Boolean(data.guestEmail) && Boolean(data.token)),
      "Provide either an email or a lookup token (not both)."
    )
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
}).strict();

// G-01 (E2E audit 2026-07-17): validate the complete public request
// before any pricing or Firestore work. In particular, `guests` must
// stay a finite positive integer so it cannot create negative breakfast
// lines or NaN totals. Router-consumed bot fields remain part of the
// strict wire contract even though business logic does not persist them.

const storageBucketUrl = process.env.FIREBASE_STORAGE_BUCKET
  ? `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/`
  : null;

const storageUrlRefiner = (val: string | null) => {
  if (val === null) return true;
  if (!storageBucketUrl) return true;
  return val.startsWith(storageBucketUrl);
};

const createBookingSchema = z.object({
  bookingId: z.string().trim().regex(PREALLOCATED_BOOKING_ID_REGEX),
  roomType: z.string().trim().min(1).max(120),
  checkIn: z.string().trim().min(1).max(40),
  checkOut: z.string().trim().min(1).max(40),
  guests: z.number().finite().int().min(1).max(100),
  hasBreakfast: z.boolean(),
  guestDetails: guestDetailsSchema,
  discountType: z.enum(["", "senior", "pwd"]),
  // Per X-01 (E2E audit 2026-07-17): the URL is derived server-side
  // for staff; the guest client only sends the path. Allow the URL
  // field to be omitted entirely so the client doesn't have to
  // include a meaningless `null`.
  discountIdPhotoUrl: z.string().url().max(2048).nullable().optional().default(null).refine(storageUrlRefiner, {
    message: "discount ID photo URL must point to the project's Firebase Storage bucket"
  }),
  discountIdPhotoPath: z.string().trim().max(512).nullable().optional().default(null),
  voucherCode: z.string().trim().max(80).optional().default(""),
  paymentMethod: z.string().trim().min(1).max(80),
  paymentProofUrl: z.string().url().max(2048).nullable().optional().default(null).refine(storageUrlRefiner, {
    message: "payment proof URL must point to the project's Firebase Storage bucket"
  }),
  paymentProofPath: z.string().trim().max(512).nullable().optional().default(null),
  corporateCode: z.string().trim().max(120).optional().default(""),
  corporateFlatRate: z.boolean().optional().default(false),
  linkedInquiryId: z.string().trim().max(160).nullable().optional().default(null),
  testToken: z.string().trim().max(512).optional(),
  turnstileToken: z.string().max(4096).optional(),
  _hp: z.string().max(200).optional().default("")
}).strict();

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

  const parsedBody = createBookingSchema.safeParse(req.body || {});
  if (!parsedBody.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the booking details — a required field is missing or invalid."
    });
  }

  const body = parsedBody.data;

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
    discountIdPhotoPath,
    voucherCode,
    paymentMethod,
    paymentProofUrl,
    paymentProofPath,
    corporateCode,
    corporateFlatRate,
    linkedInquiryId,
    testToken
  } = body;

  const guestDetails: GuestDetails = rawGuestDetails;

  if (
    !isExpectedBookingUploadPath(discountIdPhotoPath, bookingId, "discount-id")
    || !isExpectedBookingUploadPath(paymentProofPath, bookingId, "payment-proof")
  ) {
    return res.status(400).json({ success: false, error: "Invalid booking upload path." });
  }

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

  // G-02 (E2E audit 2026-07-17): enforce maximum stay length and
  // advance-booking window server-side before any Firestore work.
  // Permits same-day bookings (checkIn === manilaToday). Walk-ins
  // are exempt from the advance window.
  if (numNights > MAX_STAY_NIGHTS) {
    return res.status(400).json({
      success: false,
      error: `Maximum stay length is ${MAX_STAY_NIGHTS} nights. Please shorten your stay.`
    });
  }

  const advanceDays = Math.round((checkInDate.getTime() - currentManilaDate.getTime()) / 86400000);
  if (advanceDays > MAX_ADVANCE_DAYS) {
    return res.status(400).json({
      success: false,
      error: `Bookings can be made at most ${MAX_ADVANCE_DAYS} days in advance. Please choose a closer check-in date.`
    });
  }

  // ETR-03: validate test token before entering the transaction
  let validatedTestRunId: string | null = null;
  if (testToken) {
    const hashed = hashToken(testToken);
    const activeRuns = await adminDb
      .collection("testRuns")
      .where("tokenHash", "==", hashed)
      .where("status", "==", "active")
      .get();
    if (activeRuns.empty) {
      return res.status(403).json({
        success: false,
        error: "Invalid or expired test token. Please create a new test run from the admin Settings."
      });
    }
    const run = activeRuns.docs[0].data();
    if (run.expiresAt && new Date(run.expiresAt.toDate?.() || run.expiresAt) < new Date()) {
      return res.status(403).json({
        success: false,
        error: "Test token has expired. Please create a new test run from the admin Settings."
      });
    }
    validatedTestRunId = run.id;
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

      // Per LCE-01 (decision #137, 2026-07-25): stamp the
      // current Terms of Service version on every booking
      // doc so the audit trail has a reliable consent
      // version. We read the version from
      // `settings/websiteContent.termsVersion` inside the
      // same transaction that creates the booking — a
      // concurrent admin save would land in a different
      // transaction and stamp the booking with whichever
      // version was live at the moment this booking's
      // transaction committed. If the field is missing
      // (e.g. a never-saved hotel that ships with the
      // hardcoded fallback), we use `DEFAULT_TERMS_VERSION`
      // (1.0.0) — the page header still falls back to the
      // hardcoded body, and the booking's consent version
      // is "1.0.0 (fallback)" so the audit is honest.
      const websiteContentRef = adminDb.collection("settings").doc("websiteContent");
      const websiteContentDoc = await transaction.get(websiteContentRef);
      const termsConsentVersion =
        websiteContentDoc.exists && typeof websiteContentDoc.data()?.termsVersion === "string"
          ? String(websiteContentDoc.data()!.termsVersion)
          : DEFAULT_TERMS_VERSION;

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

      // Per 2026-07-24 (refactor/unify-payment-reference-fields):
      // the guest no longer provides a payment reference number at
      // booking time. Staff populates `transactionReference` on
      // the relevant payment ledger entry when they confirm the
      // payment. The `requireReferenceNumber` flag is now enforced
      // only on the staff verify/add-payment endpoints below.

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
            expiresAt: toDateOrNull(corpData.expiresAt),
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
      // Per X-01 (E2E audit 2026-07-17): anonymous guest uploads must
      // never mint `getDownloadURL` — that would re-open public reads
      // on the private `bookings/{bookingId}/discount-id/` bucket.
      // The client sends only the randomized object path; the
      // URL is derived server-side from the path for staff
      // (`/api/storage/signed-url`, staff-only). The path itself
      // is sufficient evidence the ID was uploaded: it's already
      // matched against the strict `isExpectedBookingUploadPath`
      // regex above (prefix + 120-bit `bookingId` + randomized
      // filename), and `createBookingSchema` rejects non-bucket
      // URLs.
      let discountPct = 0;
      if (discountType === "senior" || discountType === "pwd") {
        discountPct = 20;
        if (!discountIdPhotoPath) {
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
          // Per BF-500: `expiresAt` is not guaranteed to be a Firestore
          // Timestamp — legacy/imported voucher docs can store it as an ISO
          // string or a plain `{_seconds}` shape, so calling `.toDate()`
          // directly threw "vData.expiresAt.toDate is not a function" and
          // 500'd booking creation. Normalize through the same helper the
          // other voucher-validation sites already use.
          const voucherExpiresAt = toDateOrNull(vData.expiresAt);
          // Per BF-18 (booking-flow audit 2026-06-26): the
          // assigned room's `type` should match the room type
          // the guest selected (the body's `roomType`). If they
          // diverge (legacy data drift), skip the voucher — it's
          // safer to under-apply than to apply against a room
          // type the guest never saw.
          const assignedTypeMatchesChosen = !roomType || roomData.type === roomType;
          const isValid =
            vData.isActive !== false &&
            (!voucherExpiresAt || voucherExpiresAt >= now) &&
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
      if (!Number.isFinite(totalPrice)) {
        throw new Error("Invalid booking total.");
      }

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
        discountIdPhotoPath: discountIdPhotoPath || null,
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
        status: paymentProofPath || paymentProofUrl ? "payment-uploaded" : "pending",
        paymentMethod,
        // Per BF-45 (booking-flow audit 2026-06-26): write
        // `null` (not `""`) when no payment proof is attached.
        // `|| null` coalesces both `""` and `undefined` to
        // `null` so the canonical "absent" value is consistent.
        paymentProofUrl: paymentProofUrl || null,
        paymentProofPath: paymentProofPath || null,
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
        // Per LCE-01 (decision #137, 2026-07-25): stamp the
        // Terms of Service version that was live at
        // booking-create time. The admin's
        // /api/admin/update-terms endpoint auto-bumps the
        // version on save (1.0.0 → 1.0.1), so this field
        // captures the exact version the guest consented
        // to. Bookings created before LCE-01 don't carry
        // the field at all — the per-booking copy on
        // /my-booking renders the fallback gracefully.
        termsConsentVersion,
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
        ...(validatedTestRunId
          ? { isTestData: true, testRunId: validatedTestRunId }
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

    // Per Phase 12 — Notification Center (decision #120):
    // persist a `notifications` doc for the bell panel. Best-effort;
    // a failure here never fails the booking (the helper swallows
    // its own errors internally). The room number + booking ref
    // are denormalized so the panel can render without a second
    // Firestore round-trip.
    //
    // Per NC-01 (post-ship review 2026-07-15): the write is
    // **awaited** so Vercel does not freeze the serverless
    // instance after `res.json()` flushes and drop the doc.
    // Awaiting is safe — the helper never throws.
    await writeNotification({
      type: "booking",
      title: `New booking — ${finalBookingRef} (Room ${assignedRoomNumber})`,
      entityType: "booking",
      entityId: bookingId,
      roomNumber: assignedRoomNumber,
      bookingRef: finalBookingRef
    });

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
    // Per NBS-02 (2026-07-31): the source is now selected by the
    // desk from the configured list. The schema defaults to
    // "walk-in" so every existing caller keeps working; the handler
    // then validates against the configured list and derives the
    // booking `notes` field from it so a phone / Agoda / Facebook
    // booking no longer ships with a note claiming it was created at
    // the desk.
    source: requestedSource,
    status,
    totalPriceOverride,
    discountType: requestedDiscountType,
    voucherCode: requestedVoucherCode,
    linkedInquiryId,
    testRunId: requestedTestRunId
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

  // G-02 (E2E audit 2026-07-17): enforce maximum stay length for
  // walk-ins. Walk-ins are exempt from the advance-booking window
  // since staff may legitimately backfill past stays.
  if (numNights > MAX_STAY_NIGHTS) {
    return res.status(400).json({
      success: false,
      error: `Maximum stay length is ${MAX_STAY_NIGHTS} nights. Please shorten the stay.`
    });
  }

  const { todayStr: todayKey, manilaDate: currentManilaDate } = getManilaDateInfo();
  const currentManilaMinutes = currentManilaDate.getHours() * 60 + currentManilaDate.getMinutes();

  let validatedTestRunId: string | null = null;
  if (requestedTestRunId) {
    const runDoc = await adminDb.collection("testRuns").doc(requestedTestRunId).get();
    if (!runDoc.exists) {
      return res.status(400).json({
        success: false,
        error: "Selected test run does not exist."
      });
    }
    const run = runDoc.data()!;
    if (run.status !== "active") {
      return res.status(400).json({
        success: false,
        error: "Selected test run is not active."
      });
    }
    if (run.expiresAt && new Date(run.expiresAt.toDate?.() || run.expiresAt) < new Date()) {
      return res.status(400).json({
        success: false,
        error: "Selected test run has expired. Please select an active test run."
      });
    }
    validatedTestRunId = run.id;
  }

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

      // Per NBS-02 (2026-07-31): the submitted `source` must match
      // a configured entry. The desk can't forge a system-assigned
      // value (online / walk-in / corporate) — but the schema
      // accepts any string up to 80 chars, so the authoritative
      // gate is the configured list. If the configured list is
      // missing or empty, fall back to the historical seed
      // (`walk-in` is always allowed) so a freshly bootstrapped
      // project doesn't break.
      const bookingSourcesArr: any[] = Array.isArray(hotelConfig.bookingSources) ? hotelConfig.bookingSources : [];
      const validSourceKeys = bookingSourcesArr
        .map((s) => (s && typeof s.source === "string" ? s.source.trim() : ""))
        .filter((s) => s.length > 0);
      const resolvedSource = validSourceKeys.includes(requestedSource) ? requestedSource : "walk-in";
      if (resolvedSource !== requestedSource) {
        // Don't reject outright — `walk-in` is the safe default and
        // a stale/typo source should still let a check-in happen.
        // The desk can re-save the booking later with the right
        // source if needed (booking drawer already exposes the
        // field once NBS-04 lands).
        console.warn(`[handleCreateWalkinBooking] unknown source "${requestedSource}" — falling back to "walk-in"`);
      }

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
        // Per NBS-02 (2026-07-31): source is now selected by the
        // desk from the configured list; the note is derived from
        // it so a phone / Agoda / Facebook booking no longer ships
        // with a note claiming it was created at the desk.
        source: resolvedSource,
        notes: deriveSourceNote(resolvedSource),
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
        ...(validatedTestRunId
          ? { isTestData: true, testRunId: validatedTestRunId }
          : {}),
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

    // Per Phase 12 — Notification Center (decision #120):
    // persist a `notifications` doc for the bell panel so
    // the front desk can see the walk-in booking in the
    // persistent event log. The room number + booking ref
    // are denormalized. The notification type is `booking`
    // for both online + walk-in (status here is `confirmed`
    // or `checked-in`, but the bell surfaces both).
    //
    // Per NC-01 (post-ship review 2026-07-15): awaited
    // before `res.json()` so Vercel does not freeze the
    // instance and drop the doc. Safe — the helper never
    // throws.
    if (newBooking) {
      await writeNotification({
        type: "booking",
        title: `New walk-in booking — ${finalBookingRef} (Room ${newBooking.roomNumber})`,
        entityType: "booking",
        entityId: bookingId,
        roomNumber: newBooking.roomNumber,
        bookingRef: finalBookingRef
      });
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

// Per Phase 12 — Dashboard Payment Rejection & Reference
// Verification (2026-07-15). Staff reject a pending
// payment proof from the dashboard; the booking is
// bounced back to `pending` (room stays held — see
// AVAILABILITY-LOCKING.md, only `cancelled` frees the
// room), `paymentRejectionReason` + `paymentRejectedAt`
// + `paymentRejectedBy` are stamped on the booking, and
// a `payment-rejected` email goes to the guest so they
// can re-upload a corrected proof from the existing
// `pending` UI. Stale `paymentProofUrl` is **kept** for
// audit per the implementation plan. The previous
// `paymentReferenceNumber` field was retired 2026-07-24 —
// its audit value lives in the screenshot itself, and any
// reference staff recorded before rejection still lives on
// the corresponding payment ledger entry's
// `transactionReference`.
const MAX_PAYMENT_REJECTION_REASON_LENGTH = 500;

export async function handleRejectPayment(req: any, res: any) {
  const { bookingId, reason } = req.body || {};
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }
  const safeReason = typeof reason === "string"
    ? reason.trim().slice(0, MAX_PAYMENT_REJECTION_REASON_LENGTH)
    : "";
  if (!safeReason) {
    return res.status(400).json({ success: false, error: "A rejection reason is required so the guest can fix the issue." });
  }

  // Staff UID per the audit-collection PII convention
  // (BF-15). `req.staff.uid` is guaranteed by the
  // dispatcher's `authenticateStaff` guard.
  const paymentRejectedBy = req.staff?.uid || "staff";

  let bookingData: any = null;
  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    const data = bookingDoc.data()!;
    if (data.status !== "payment-uploaded") {
      return res.status(400).json({
        success: false,
        error: `Only a booking in 'payment-uploaded' status can be rejected (current: ${data.status}).`
      });
    }
    bookingData = data;

    const updatedAt = new Date();
    await bookingRef.update({
      status: "pending",
      paymentRejectionReason: safeReason,
      paymentRejectedAt: updatedAt,
      paymentRejectedBy,
      // Per the implementation plan: stale proof state is
      // kept for audit. The re-upload is guest-driven via
      // the existing `pending` UI on the lookup page.
      updatedAt
    });

    return res.status(200).json({
      success: true,
      data: {
        status: "pending",
        paymentRejectionReason: safeReason,
        paymentRejectedAt: updatedAt,
        paymentRejectedBy
      }
    });
  } catch (error: any) {
    console.error("Payment rejection handler error:", error);
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
  const { bookingId, paymentId, amount, method, note, transactionReference } = req.body || {};
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

  // Per PRC-07: method-aware transaction reference validation.
  // Resolve the requirement from server-side config, never from the client.
  const safeTransactionReference = typeof transactionReference === "string"
    ? transactionReference.trim().slice(0, 200) || null
    : null;

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
  const paymentRecord: Record<string, any> = {
    type: "payment",
    amount: numericAmount,
    method,
    note: safeNote,
    transactionReference: safeTransactionReference,
    reason: null,
    approvedBy: null,
    recordedBy: staffUid,
    recordedAt: new Date()
  };
  if (!safeTransactionReference) delete paymentRecord.transactionReference;

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

      // Per PRC-07: method-aware transaction reference requirement.
      // Resolve from server-side config, never trust the client.
      if (method !== "pay-at-hotel" && method !== "add-to-bill") {
        const hotelConfigDoc = await transaction.get(adminDb.collection("settings").doc("hotelConfig"));
        const hotelConfig = hotelConfigDoc.exists ? hotelConfigDoc.data()! : {};
        const paymentMethodsArr: any[] = Array.isArray(hotelConfig.paymentMethods) ? hotelConfig.paymentMethods : [];
        const pmConfig = paymentMethodsArr.find((p: any) => p && p.method === method);
        const isRefRequired = pmConfig ? pmConfig.requireReferenceNumber !== false : true;
        if (isRefRequired && !safeTransactionReference) {
          throw new Error("Transaction reference is required for this payment method.");
        }
      }

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
          && String(existingData.note || "") === safeNote
          && String(existingData.transactionReference || "") === (safeTransactionReference || "");
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
      hadPaymentProof = !!(bookingData.paymentProofPath || bookingData.paymentProofUrl);
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
    if (error.message === "Transaction reference is required for this payment method.") {
      return res.status(400).json({ success: false, error: error.message });
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
        {
          ...paymentRecord,
          paymentProofUrl: bookingDataSnapshot.paymentProofUrl || null,
          paymentProofPath: bookingDataSnapshot.paymentProofPath || null
        }
      );
    }
  } catch (emailErr) {
    console.error("Failed to send payment confirmation email:", emailErr);
  }

  // Per Phase 12 — Notification Center (decision #120):
  // persist a `notifications` doc for the bell panel so the
  // front desk can see the payment + the
  // `payment-confirmed` transition in the persistent log.
  // Best-effort: never fails the call. The
  // `idempotentReplay` short-circuit avoids writing
  // duplicate notifications when the same payment is
  // re-sent with the same id.
  //
  // Per NC-01 (post-ship review 2026-07-15): awaited
  // before `res.json()` so Vercel does not freeze the
  // instance and drop the doc. Safe — the helper never
  // throws.
  if (!idempotentReplay && bookingDataSnapshot) {
    const notifTitle = transitionedToPaymentConfirmed
      ? `Payment received — ${bookingDataSnapshot.bookingRef || bookingId} (full)`
      : `Payment added — ${bookingDataSnapshot.bookingRef || bookingId} (${numericAmount})`;
    await writeNotification({
      type: "payment",
      title: notifTitle,
      entityType: "booking",
      entityId: bookingId,
      roomNumber: bookingDataSnapshot.roomNumber || null,
      bookingRef: bookingDataSnapshot.bookingRef || null
    });
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

export async function handleVerifyAndRecordPayment(req: any, res: any) {
  const { bookingId, paymentId, amount, method, transactionReference, note } = req.body || {};
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }
  if (!paymentId || !PREALLOCATED_PAYMENT_ID_REGEX.test(String(paymentId))) {
    return res.status(400).json({ success: false, error: "A valid payment ID is required." });
  }
  if (!method) {
    return res.status(400).json({ success: false, error: "Payment method is required." });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, error: "Verified amount must be a positive number." });
  }
  if (numericAmount > 1_000_000) {
    return res.status(400).json({ success: false, error: "Verified amount exceeds the 1,000,000 per-transaction limit." });
  }

  const safeTransactionReference = typeof transactionReference === "string"
    ? transactionReference.trim().slice(0, 200) || null
    : null;
  const safeNote = typeof note === "string" ? note.trim().slice(0, 500) : "";
  const paymentNote = safeNote || "Verified payment proof";

  const staffUid = req.staff?.uid || "staff";

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    let bookingData: any = null;
    let totalCollected = 0;
    let totalPrice = 0;
    let fullyPaid = false;
    let idempotentReplay = false;

    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error("BOOKING_NOT_FOUND");
      const data = bookingDoc.data()!;
      bookingData = data;

      const paymentsRef = bookingRef.collection("payments");
      const paymentsSnapshot = await transaction.get(paymentsRef);
      const existingPaid = paymentsSnapshot.docs.reduce((sum: number, docSnap: any) => {
        return sum + Number(docSnap.data().amount || 0);
      }, 0);

      // The client-preallocated document ID is the idempotency key. Matching
      // cash installments remain distinct when they intentionally use
      // different IDs, even if their amount and method are identical.
      const existingPayment = paymentsSnapshot.docs.find((docSnap: any) => docSnap.id === paymentId);
      if (existingPayment) {
        const existingData = existingPayment.data();
        const sameRequest = Number(existingData.amount) === numericAmount
          && String(existingData.method) === String(method)
          && String(existingData.note || "") === paymentNote
          && String(existingData.transactionReference || "") === (safeTransactionReference || "");
        if (!sameRequest) throw new Error("PAYMENT_ID_CONFLICT");
        idempotentReplay = true;
        totalPrice = Number(data.totalPrice || 0);
        totalCollected = existingPaid;
        fullyPaid = totalPrice > 0 && totalCollected >= totalPrice;
        return;
      }

      // Only allow new verify-and-record entries from payment-uploaded/pending.
      // Existing payment IDs are checked first so a committed full-payment
      // retry can replay safely and conflicting reuse cannot hide behind the
      // booking's now-confirmed status.
      if (data.status === "payment-confirmed" || data.status === "confirmed") {
        throw new Error("ALREADY_CONFIRMED");
      }
      if (data.status !== "payment-uploaded" && data.status !== "pending") {
        throw new Error(`INVALID_STATUS:${data.status}`);
      }

      // PRC-07: method-aware reference requirement from server config
      if (method !== "pay-at-hotel" && method !== "add-to-bill") {
        const hotelConfigDoc = await transaction.get(adminDb.collection("settings").doc("hotelConfig"));
        const hotelConfig = hotelConfigDoc.exists ? hotelConfigDoc.data()! : {};
        const paymentMethodsArr: any[] = Array.isArray(hotelConfig.paymentMethods) ? hotelConfig.paymentMethods : [];
        const pmConfig = paymentMethodsArr.find((p: any) => p && p.method === method);
        const isRefRequired = pmConfig ? pmConfig.requireReferenceNumber !== false : true;
        if (isRefRequired && !safeTransactionReference) {
          throw new Error("Transaction reference is required for this payment method.");
        }
      }

      totalPrice = Number(data.totalPrice || 0);
      totalCollected = existingPaid + numericAmount;
      fullyPaid = totalPrice > 0 && totalCollected >= totalPrice;

      const paymentRecord: Record<string, any> = {
        type: "payment",
        amount: numericAmount,
        method,
        note: paymentNote,
        transactionReference: safeTransactionReference,
        reason: null,
        approvedBy: null,
        recordedBy: staffUid,
        recordedAt: new Date()
      };
      if (!safeTransactionReference) delete paymentRecord.transactionReference;

      transaction.create(paymentsRef.doc(paymentId), paymentRecord);

      // Transition to payment-confirmed only when fully paid
      const bookingUpdates: Record<string, any> = {
        updatedAt: new Date()
      };
      if (fullyPaid) {
        bookingUpdates.status = "payment-confirmed";
        bookingUpdates.handledBy = staffUid;
        bookingUpdates.paymentConfirmedAt = new Date();
      }
      transaction.update(bookingRef, bookingUpdates);
      bookingData = { ...data, ...bookingUpdates };
    });

    if (idempotentReplay) {
      return res.status(200).json({
        success: true,
        data: {
          idempotentReplay: true,
          paymentId,
          totalCollected,
          status: bookingData?.status || null,
          fullyPaid
        }
      });
    }

    // Post-transaction side effects (best-effort)
    try {
      if (fullyPaid) {
        await sendBookingTrigger("payment-confirmed", { ...bookingData, status: "payment-confirmed" });
      }
      await writeNotification({
        type: "payment",
        title: fullyPaid
          ? `Payment verified — ${bookingData?.bookingRef || bookingId} (full)`
          : `Partial payment recorded — ${bookingData?.bookingRef || bookingId} (${numericAmount})`,
        entityType: "booking",
        entityId: bookingId,
        roomNumber: bookingData?.roomNumber || null,
        bookingRef: bookingData?.bookingRef || null
      });
    } catch (sideEffectErr) {
      console.error("Verify-and-record side effect error:", sideEffectErr);
    }

    return res.status(200).json({
      success: true,
      data: {
        paymentId,
        amount: numericAmount,
        method,
        transactionReference: safeTransactionReference,
        recordedBy: staffUid,
        totalCollected,
        status: fullyPaid ? "payment-confirmed" : "payment-uploaded",
        fullyPaid
      }
    });
  } catch (error: any) {
    if (error?.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error?.message === "ALREADY_CONFIRMED") {
      return res.status(200).json({
        success: true,
        data: { alreadyConfirmed: true, status: bookingData?.status || "payment-confirmed" }
      });
    }
    if (error?.message?.startsWith("INVALID_STATUS:")) {
      return res.status(400).json({
        success: false,
        error: `Payment cannot be verified because the booking status is ${error.message.split(":")[1]}.`
      });
    }
    if (error?.message?.includes("Transaction reference is required")) {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (error?.message === "PAYMENT_ID_CONFLICT") {
      return res.status(409).json({
        success: false,
        error: "Payment ID has already been used for different payment details."
      });
    }
    console.error("Verify and record payment handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "Unable to verify and record payment." });
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

    // Per Phase 12 — Notification Center (decision #120):
    // persist a `notifications` doc for the bell panel so
    // the front desk sees the booking move to `confirmed`
    // in the persistent log. Distinct from the
    // `payment` notification (payment receipt) so the bell
    // surfaces both events.
    //
    // Per NC-01 (post-ship review 2026-07-15): awaited
    // before `res.json()` so Vercel does not freeze the
    // instance and drop the doc. Safe — the helper never
    // throws.
    await writeNotification({
      type: "booking",
      title: `Booking confirmed — ${bookingData.bookingRef || bookingId} (Room ${bookingData.roomNumber || ""})`.trim(),
      entityType: "booking",
      entityId: bookingId,
      roomNumber: bookingData.roomNumber || null,
      bookingRef: bookingData.bookingRef || null
    });

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

// Per CWB-01 / decision #122 (2026-07-23): staff can confirm
// a `payment-uploaded` booking with a positive balance when
// the rest will be collected at check-in. Reuses the same
// `hotelConfig.unpaidCheckoutApprovalThreshold` (default 5,000)
// as the unpaid-checkout flow — `front-desk` may approve up
// to the threshold, above it requires an authenticated
// `admin` claim. Threshold check is inside the transaction
// so a race between two staff doesn't bypass the gate.
//
// Atomically stamps four new fields + flips `status` to
// `confirmed` + writes `paymentConfirmedAt` + `handledBy`,
// then fires the new `booking-confirmed-with-balance` email
// + a `booking` notification for the bell.
//
// Reason validation mirrors `unpaidCheckoutReason` (≤500
// chars, required) for consistency. Reason is stored on the
// booking (audit trail) AND included in the guest email
// (operational clarity).
const CONFIRM_WITH_BALANCE_REASON_MAX_LENGTH = 500;
export async function handleConfirmBookingWithBalance(req: any, res: any) {
  const { bookingId, reason } = req.body || {};
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  const safeReason = typeof reason === "string" ? reason.trim().slice(0, CONFIRM_WITH_BALANCE_REASON_MAX_LENGTH) : "";
  if (!safeReason) {
    return res.status(400).json({
      success: false,
      error: "A reason is required when confirming a booking with a balance owed."
    });
  }

  const confirmedBy = req.staff?.uid || "staff";
  const staffRole = req.staff?.role || "front-desk";

  // Pre-read hotelConfig outside the transaction so the 403
  // message can include the configured threshold. The
  // transaction re-reads it for the authoritative gate.
  const hotelConfigDoc = await adminDb.collection("settings").doc("hotelConfig").get();
  const hotelConfig = hotelConfigDoc.exists ? hotelConfigDoc.data()! : {};
  const unpaidCheckoutThreshold = Number(hotelConfig.unpaidCheckoutApprovalThreshold) || 5000;

  let bookingData: any = null;
  let balance = 0;
  let needsAdminApproval = false;
  let balanceThreshold = unpaidCheckoutThreshold;

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);

    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("BOOKING_NOT_FOUND");
      }
      const data = bookingDoc.data()!;
      bookingData = data;

      // CWB-01: only `payment-uploaded` bookings are eligible.
      // A `payment-confirmed` booking has no balance and should
      // go through the standard confirm flow. A `pending`
      // booking has not yet provided proof — staff should
      // verify the payment first.
      if (data.status !== "payment-uploaded") {
        throw new Error(`INVALID_STATUS:${data.status}`);
      }

      // Re-read hotelConfig inside the transaction so the
      // threshold gate uses the most recent value. (Same
      // pattern as `handleCheckoutBooking`.)
      const txHotelConfigDoc = await transaction.get(adminDb.collection("settings").doc("hotelConfig"));
      const txHotelConfig = txHotelConfigDoc.exists ? txHotelConfigDoc.data()! : {};
      const txThreshold = Number(txHotelConfig.unpaidCheckoutApprovalThreshold) || 5000;
      balanceThreshold = txThreshold;

      // Compute the charge-inclusive balance inside the
      // transaction so we read the same ledger state we
      // stamp. Mirrors the checkout transaction's helpers.
      const paymentsRef = bookingRef.collection("payments");
      const chargesRef = bookingRef.collection("charges");
      const storeOrdersQuery = adminDb.collection("storeOrders").where("bookingId", "==", bookingId);
      const [paymentsSnapshot, chargesSnapshot, storeOrdersSnapshot] = await Promise.all([
        transaction.get(paymentsRef),
        transaction.get(chargesRef),
        transaction.get(storeOrdersQuery)
      ]);
      const collectedTotal = sumLedgerAmounts(paymentsSnapshot);
      const incidentalTotal = sumLedgerAmounts(chargesSnapshot);
      const addToBillTotal = sumBilledAddToBillOrders(storeOrdersSnapshot);
      const folioTotal = Number(data.totalPrice || 0) + incidentalTotal + addToBillTotal;
      const computedBalance = Math.max(folioTotal - collectedTotal, 0);
      balance = computedBalance;

      // CWB-01: threshold gate — front-desk is capped at the
      // threshold; above it requires `admin`. The reason is
      // not zero-balance exempt: a `payment-uploaded` booking
      // can have a 0 balance if the verified payment exactly
      // covered the folio (e.g. a quick GCash equal to the
      // total). In that case the threshold is irrelevant —
      // staff should use the regular `/api/bookings/confirm`
      // endpoint instead. We don't 400 on zero balance here
      // because the server is authoritative; the booking was
      // `payment-uploaded` so the verify-and-record flow
      // recorded an offline payment but the booking never
      // transitioned to `payment-confirmed` (e.g. the client
      // retry never landed). If balance is 0 we still write
      // the fields so the audit trail reflects the explicit
      // confirm-with-balance action.
      if (computedBalance > txThreshold && staffRole !== "admin") {
        needsAdminApproval = true;
        throw new Error(`THRESHOLD_EXCEEDED:${txThreshold}:${computedBalance}`);
      }

      const now = new Date();
      transaction.update(bookingRef, {
        status: "confirmed",
        // Stamps the original balance at confirm time —
        // never rewritten as the guest settles onsite. The
        // drawer's balance-owed indicator auto-hides when
        // the current balance reaches 0.
        confirmedWithBalance: computedBalance,
        confirmedWithBalanceReason: safeReason,
        confirmedWithBalanceAt: now,
        confirmedWithBalanceBy: confirmedBy,
        // Also stamp the standard confirm fields so the
        // existing `confirmed` email / notification /
        // receipt paths light up uniformly.
        confirmedAt: now,
        paymentConfirmedAt: now,
        handledBy: confirmedBy,
        updatedAt: now
      });
    });

    // Fire the dedicated trigger — it carries the original
    // balance + reason, not just the booking document. Best
    // effort: a failure here does not roll back the
    // transaction (Firestore transactions are not reversible
    // from the client) but is logged + surfaced to the staff
    // via the 200 response so they can manually resend.
    try {
      await sendBookingConfirmedWithBalanceTrigger(
        { ...bookingData, status: "confirmed" },
        balance,
        safeReason
      );
    } catch (emailErr) {
      console.error("Failed to send confirm-with-balance email:", emailErr);
    }

    // Per Phase 12 — Notification Center (decision #120).
    try {
      await writeNotification({
        type: "booking",
        title: `Booking confirmed (balance due) — ${bookingData.bookingRef || bookingId} (Room ${bookingData.roomNumber || ""})`.trim(),
        entityType: "booking",
        entityId: bookingId,
        roomNumber: bookingData.roomNumber || null,
        bookingRef: bookingData.bookingRef || null
      });
    } catch (notifErr) {
      console.error("Failed to write confirm-with-balance notification:", notifErr);
    }

    return res.status(200).json({
      success: true,
      data: {
        status: "confirmed",
        balance,
        confirmedWithBalanceReason: safeReason,
        threshold: balanceThreshold
      }
    });
  } catch (error: any) {
    if (error?.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error?.message?.startsWith("INVALID_STATUS:")) {
      return res.status(400).json({
        success: false,
        error: `Booking cannot be confirmed with balance because its status is ${error.message.split(":")[1]}. Use the standard confirm flow instead.`
      });
    }
    if (error?.message?.startsWith("THRESHOLD_EXCEEDED:")) {
      const parts = error.message.split(":");
      const threshold = Number(parts[1] || balanceThreshold);
      const errorBalance = Number(parts[2] || balance);
      return res.status(403).json({
        success: false,
        error: "Front Desk cannot confirm this booking.",
        thresholdExceeded: true,
        threshold,
        balance: errorBalance,
        message: `The outstanding balance (₱${errorBalance.toFixed(2)}) exceeds the Front Desk approval limit (₱${threshold.toFixed(2)}). An administrator must authorize this confirmation.`
      });
    }
    console.error("Confirm with balance handler error:", error);
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

    // Per Phase 12 — Notification Center (decision #120):
    // persist a `notifications` doc for the bell panel.
    // The transaction above only updated the booking +
    // room; re-read here for the denormalized fields
    // (bookingRef, roomNumber).
    //
    // Per NC-01 (post-ship review 2026-07-15): awaited
    // so Vercel does not freeze the instance after
    // `res.json()` and drop the doc. The outer try/catch
    // still covers a failed re-read so the request can
    // still succeed (just without the notification).
    try {
      const freshSnap = await adminDb.collection("bookings").doc(bookingId).get();
      const fresh = freshSnap.data() || {};
      await writeNotification({
        type: "arrival",
        title: `Guest checked in — ${fresh.bookingRef || bookingId} (Room ${fresh.roomNumber || ""})`.trim(),
        entityType: "booking",
        entityId: bookingId,
        roomNumber: fresh.roomNumber || null,
        bookingRef: fresh.bookingRef || null
      });
    } catch (notifErr) {
      console.error("Failed to fetch booking for arrival notification:", notifErr);
    }

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

const UNPAID_REASON_MAX_LENGTH = 500;
const UNPAID_REASON_SHORTCUTS = [
  "approved company billing",
  "bank transfer pending",
  "payment failure",
  "disputed charge",
  "other"
];

export async function handleCheckoutBooking(req: any, res: any) {
  const { bookingId, unpaidCheckoutReason } = req.body;
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
    const staffRole = req.staff?.role || "front-desk";

    // Pre-read hotelConfig for unpaid checkout threshold (UCO-03)
    const hotelConfigDoc = await adminDb.collection("settings").doc("hotelConfig").get();
    const hotelConfig = hotelConfigDoc.exists ? hotelConfigDoc.data()! : {};
    const unpaidCheckoutThreshold = Number(hotelConfig.unpaidCheckoutApprovalThreshold) || 5000;

    const safeUnpaidReason = typeof unpaidCheckoutReason === "string"
      ? unpaidCheckoutReason.trim().slice(0, UNPAID_REASON_MAX_LENGTH)
      : null;

    let pointsAwarded = 0;
    let eligiblePoints = 0;
    let checkedOutWithBalance = 0;
    let memberId: string | null = bookingData.memberId || null;
    let rewardsConfig: any = null;
    let unpaidCheckoutApprovedBy: string | null = null;

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

      // UCO-02: require reason for unpaid checkout
      if (checkedOutWithBalance > 0 && !safeUnpaidReason) {
        throw new Error("UNPAID_REASON_REQUIRED");
      }

      // UCO-03/UCO-13: threshold enforcement — admin may override, Front Desk is capped
      const needsAdminApproval = checkedOutWithBalance > 0 && checkedOutWithBalance > unpaidCheckoutThreshold;
      if (needsAdminApproval && staffRole !== "admin") {
        throw new Error(`THRESHOLD_EXCEEDED:${unpaidCheckoutThreshold}:${checkedOutWithBalance}`);
      }
      unpaidCheckoutApprovedBy = (checkedOutWithBalance > 0 && staffRole === "admin") ? checkedOutBy : null;

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

      // UCO-06: stamp unpaid departure exception data
      if (checkedOutWithBalance > 0) {
        bookingUpdate.unpaidCheckoutReason = safeUnpaidReason;
        bookingUpdate.unpaidCheckoutApprovalThreshold = unpaidCheckoutThreshold;
        bookingUpdate.unpaidCheckoutApprovedBy = unpaidCheckoutApprovedBy;
        bookingUpdate.unpaidCheckoutApprovedAt = new Date();
        bookingUpdate.unpaidCheckoutSnapshotFolioTotal = checkoutFolioTotal;
        bookingUpdate.unpaidCheckoutSnapshotCollectedTotal = collectedTotal;
        bookingUpdate.unpaidCheckoutSnapshotBalance = checkedOutWithBalance;
      }

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

    // Per Phase 12 — Notification Center (decision #120):
    // persist a `notifications` doc for the bell panel.
    try {
      const freshSnap = await adminDb.collection("bookings").doc(bookingId).get();
      const fresh = freshSnap.data() || {};
      await writeNotification({
        type: "departure",
        title: `Guest checked out — ${fresh.bookingRef || bookingId} (Room ${fresh.roomNumber || ""})`.trim(),
        entityType: "booking",
        entityId: bookingId,
        roomNumber: fresh.roomNumber || null,
        bookingRef: fresh.bookingRef || null
      });
    } catch (notifErr) {
      console.error("Failed to fetch booking for departure notification:", notifErr);
    }

    return res.status(200).json({
      success: true,
      data: {
        status: "checked-out",
        pointsAwarded,
        memberId,
        checkedOutWithBalance,
        unpaidCheckoutReason: safeUnpaidReason,
        unpaidCheckoutApprovedBy
      }
    });
  } catch (error: any) {
    if (error?.message === "UNPAID_REASON_REQUIRED") {
      return res.status(400).json({
        success: false,
        error: "An unpaid checkout reason is required when the folio has a positive balance."
      });
    }
    if (error?.message?.startsWith("THRESHOLD_EXCEEDED:")) {
      const parts = error.message.split(":");
      const threshold = parts[1] || "5000";
      const balance = parts[2] || "0";
      return res.status(403).json({
        success: false,
        error: "Front Desk cannot complete this checkout.",
        thresholdExceeded: true,
        threshold: Number(threshold),
        balance: Number(balance),
        message: `The outstanding balance (₱${Number(balance).toFixed(2)}) exceeds the Front Desk approval limit (₱${Number(threshold).toFixed(2)}). An administrator must authorize this checkout.`
      });
    }
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
      error: "Please provide a valid booking reference, email, or lookup token."
    });
  }

  const { bookingRef: trimmedRef, guestEmail: normalizedEmail, token: lookupToken } = parsed.data;

  try {
    // Per feat/relax-booking-lookup: dispatch on whichever
    // key the guest supplied. Priority is most-specific-first
    // so an attacker can't bypass the token or email check by
    // adding an extra field:
    //   ref + token  → token path (H2, the strictest)
    //   ref + email  → email path (H2 / BF-21, with case-insensitive fallback)
    //   ref alone    → ref-only path (new)
    //   email alone  → most-recent-active-by-email (new)
    //   token alone  → token-only path (new; rare — magic link without a ref)
    if (trimmedRef && lookupToken) {
      // H2 magic-link path — query the indexed compound
      // (bookingRef, lookupToken) directly.
      const snapshot = await adminDb.collection("bookings")
        .where("bookingRef", "==", trimmedRef)
        .where("lookupToken", "==", String(lookupToken).toLowerCase())
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }
      const bookingData: any = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      return await enrichAndRespond(res, bookingData);
    }

    if (trimmedRef && normalizedEmail) {
      // Original BF-21 path — composite (bookingRef, guestEmail)
      // with a case-insensitive fallback in JS.
      const snapshot = await adminDb.collection("bookings")
        .where("bookingRef", "==", trimmedRef)
        .where("guestEmail", "==", normalizedEmail)
        .limit(1)
        .get();

      if (snapshot.empty) {
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

      const bookingData: any = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      return await enrichAndRespond(res, bookingData);
    }

    if (trimmedRef) {
      // Ref-alone path. The booking-ref format is
      // `{prefix}-YYYYMMDD-NNN` (3-digit sequence, ~1000
      // keys per day) — small enough that the existing
      // 10/min rate limit + Turnstile + 3-failure 1-hour
      // backoff are the load-bearing defenses, not the
      // second factor. Refs are globally unique (date +
      // daily sequence), so `limit(1)` is exact.
      const snapshot = await adminDb.collection("bookings")
        .where("bookingRef", "==", trimmedRef)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }
      const bookingDoc = snapshot.docs[0];
      const bookingData: any = { id: bookingDoc.id, ...bookingDoc.data() };
      return await enrichAndRespond(res, bookingData);
    }

    if (normalizedEmail) {
      // Email-alone path. Per MBP / decision #123 (2026-07-24):
      // returns a privacy-preserving list when the email
      // matches more than one booking, capped at 10 displayed
      // + an 11th sentinel that flips `moreExist: true` (no
      // second query). The 1-match case keeps the existing
      // single-booking flow (the same `kind: "single"` shape
      // every other path returns, just from this entry point
      // too). Sort is by `checkIn` desc with `createdAt` desc
      // as the tiebreaker — recent stays first.
      //
      // Privacy contract (RA 10173) — tightened per decision
      // #126 (2026-07-25): the picker never returns
      // `guestName` at all, even when every match is for the
      // same person. The earlier "single-name mode attaches
      // guestName / multi-name mode omits it" still leaked
      // the full name to anyone with access to the email —
      // a spouse, ex-partner, shared family inbox. Now the
      // picker exposes a uniform row shape regardless of how
      // many distinct names are behind the email:
      //   { id, bookingRef, maskedEmail, checkIn, checkOut,
      //     numNights, roomType, status }
      //   • `maskedEmail` is `j***@gmail.com` — first char of
      //     the local part + *** + the full domain. The
      //     attacker already typed the email, so the leak
      //     surface is zero; for the legit user it confirms
      //     "yes, the search keyed on the email I typed".
      //   • `guestName` is dropped from the wire entirely.
      //     The legit user has bookingRef + dates + room +
      //     status to disambiguate, and the single-booking
      //     card (rendered after they pick) still shows the
      //     name behind the existing email-as-second-factor
      //     click.
      // - The list still never reveals folio / balance /
      //   payment method / discount / email existence beyond
      //   what the guest already entered.
      // - "Booking not found." is still the same reply for 0
      //   / 1 / many matches, so this is not an email-
      //   existence oracle.
      //
      // At 14 rooms an email has at most a handful of
      // bookings; the in-memory sort over an 11-row cap is
      // fine. For scale, add a `(guestEmail, createdAt desc)`
      // composite index in `firebase/firestore.indexes.json`
      // and replace the in-memory sort with
      // `orderBy("createdAt", "desc").limit(11)` (FLR-03
      // trigger). The contract is index-compatible.
      const PICKER_LIMIT = 11; // 10 displayed + 1 "more exist" sentinel
      const snapshot = await adminDb.collection("bookings")
        .where("guestEmail", "==", normalizedEmail)
        .limit(PICKER_LIMIT)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }

      const sorted = snapshot.docs
        .map((doc: any) => ({ id: doc.id, data: doc.data() }))
        .sort((a: any, b: any) => {
          // Primary: checkIn desc. Secondary: createdAt desc.
          const aCheckIn = a.data?.checkIn?.toMillis?.() ?? 0;
          const bCheckIn = b.data?.checkIn?.toMillis?.() ?? 0;
          if (aCheckIn !== bCheckIn) return bCheckIn - aCheckIn;
          const aCreated = a.data?.createdAt?.toMillis?.() ?? 0;
          const bCreated = b.data?.createdAt?.toMillis?.() ?? 0;
          return bCreated - aCreated;
        });

      // 1 match: existing single-booking flow. Same enriched
      // shape as every other path, just sourced from the
      // email alone. Per decisions #128 + #131 (2026-07-25),
      // the single-booking response never reflects the guest
      // name back to the caller (the email-alone path has no
      // second factor, and #131 extends the same rule to the
      // strict paths). The `enrichAndRespond` helper now
      // drops `guestName` and adds `maskedEmail` for all
      // callers — no per-path option needed.
      if (sorted.length === 1) {
        const top = sorted[0];
        const bookingData: any = { id: top.id, ...top.data };
        return await enrichAndRespond(res, bookingData);
      }

      // 2+ matches: list response. The 11th row (when present)
      // is the sentinel — never included in entries; its
      // presence flips `moreExist: true` so the client can
      // surface the "contact us for older stays" footer.
      const moreExist = sorted.length > 10;
      const entriesSource = moreExist ? sorted.slice(0, 10) : sorted;

      // Per decision #126 (2026-07-25): row shape is uniform
      // regardless of whether the bookings behind the email
      // are by the same person, different people, or mixed.
      // `guestName` is never attached (it would still be a
      // name-leak for an attacker with email access); only
      // `maskedEmail` is included so the legit user can
      // confirm the search keyed on the email they typed.
      const entries = entriesSource.map(({ id, data }: any) => ({
        id,
        bookingRef: data.bookingRef,
        maskedEmail: maskEmail(String(data.guestEmail || "")),
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        numNights: data.numNights,
        roomType: data.roomType,
        status: data.status
      }));

      return res.status(200).json({
        success: true,
        data: {
          kind: "list",
          bookings: entries,
          moreExist
        }
      });
    }

    if (lookupToken) {
      // Token-alone path (rare — the magic link normally
      // carries the ref in the URL). The token is 32-char
      // hex, globally unique, so `limit(1)` is exact.
      const snapshot = await adminDb.collection("bookings")
        .where("lookupToken", "==", String(lookupToken).toLowerCase())
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }
      const bookingDoc = snapshot.docs[0];
      const bookingData: any = { id: bookingDoc.id, ...bookingDoc.data() };
      return await enrichAndRespond(res, bookingData);
    }

    // Schema's refine guarantees we never reach here.
    return res.status(400).json({
      success: false,
      error: "Please provide a valid booking reference, email, or lookup token."
    });
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

  // Per decisions #128 (2026-07-25) + #131 (2026-07-25):
  // the public /my-booking page NEVER reflects the guest
  // name back to the caller — neither via the email-alone
  // path nor via the strict paths (ref+email, ref+token,
  // ref alone, token alone). The picker (decision #126)
  // already dropped it on the list shape; the single-booking
  // card drops it on every path now. The booking doc still
  // stores `guestName` (every staff-gated reader — drawer,
  // table, PDF, email — still needs it); the public lookup
  // just stops reflecting it back.
  //
  // We also add `maskedEmail` to the response so the card
  // can show the user a low-fidelity echo of the search key
  // without re-exposing the full address. Same format as
  // the picker: first char of local + `***` + full domain.
  return res.status(200).json({
    success: true,
    data: {
      // Per MBP / decision #123: every single-booking
      // response carries `kind: "single"` so the page can
      // branch deterministically. Backward-compatible —
      // older clients that don't read `kind` still get the
      // same fields they always did.
      kind: "single",
      id: bookingData.id,
      bookingRef: bookingData.bookingRef,
      // `guestEmail` is dropped from the wire entirely.
      // The card uses `maskedEmail` for the echo; the
      // cancellation + resend flows use the value the user
      // typed into the form (kept in local state).
      maskedEmail: maskEmail(String(bookingData.guestEmail || "")),
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
