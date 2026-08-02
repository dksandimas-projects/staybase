import { adminAuth, adminDb } from "../lib/firebase-admin";
import { hashToken } from "./test-runs";
import { Timestamp } from "firebase-admin/firestore";
import { sendBookingTrigger, sendBookingConfirmedWithBalanceTrigger, sendStaffNewBookingTrigger, sendStaffNewPaymentTrigger, sendEarlyCheckinResolveTrigger } from "./email";
import { writeNotification } from "../lib/notifications";
import {
  calculateSeasonalAwareRoomBreakdown,
  calculateVoucherDiscount,
  calculatePercentDiscount,
  calculateVoucherBase,
  calculateDiscountChain,
  normalizeDiscountScope,
  calculateBreakfastAddOn,
  calculateExtraBedAddOn,
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
  RescheduleBookingSchema,
  MAX_STAY_NIGHTS,
  MAX_ADVANCE_DAYS,
  // Per PEX-02 (2026-08-01, per decision #147): the shared
  // occupancy rule — one place that decides whether a booking
  // holds the room. Uses the snapshotted `holdExpiresAt` so
  // an expired `pending` hold does not block a later booking
  // (the in-transaction retirement at the create / walkin /
  // reschedule sites marks the expired hold `cancelled`).
  BOOKING_OCCUPYING_STATUSES,
  isBookingOccupyingRoom,
  computeHoldExpiresAt,
  normalizePaymentHoldWindowHours,
  EXPIRED_HOLD_CANCELLATION_REASON,
  // Per CRL-02 (2026-08-02): every cancellation writes a
  // `cancellationSource` of "guest" | "staff" | "system" alongside
  // the existing `cancellationReason`. The source is the parallel
  // discriminator — emails + Reports + future refund-liability (CRL-07)
  // can switch on either field. Source list is pinned by the
  // CANCELLATION_SOURCES constant so a typo in any stamping path
  // breaks the type instead of silently corrupting the audit.
  CANCELLATION_SOURCES,
  // Per CRL-03 (2026-08-02): the server-side status matrix that
  // authorises a cancellation. The handler picks the right set
  // from the `isStaffCancellation` boolean and rejects every
  // other status with a 400. The terminal-status set is the
  // universal "no path can cancel" list.
  GUEST_CANCELLABLE_STATUSES,
  STAFF_CANCELLABLE_STATUSES,
  TERMINAL_CANCELLATION_STATUSES,
  // Per MRB-02 (2026-08-02, per decision #159): the
  // reservation header linkage. The client may preallocate
  // a `reservationId` (UUIDv4) to enable idempotency on
  // retry-after-uncertain-response; the server auto-generates
  // one when the field is absent (no retry guarantee, but
  // the legacy null-reservationId path still works). The
  // regex is the same one `RESERVATION_ID_REGEX` pins in
  // `shared/utils/references.ts`; the server validates +
  // auto-mints via the same helpers. The server computes
  // a `requestFingerprint` (SHA-256 of a canonicalized JSON
  // payload, same byte-equivalence rules as the client's
  // preallocation) and uses it for the in-transaction
  // idempotency replay / 409 conflict matrix.
  RESERVATION_ID_REGEX,
  generateReservationId,
  computeRequestFingerprint,
  type FingerprintableReservationRequest,
  // Per EXB-03 (2026-08-01, per decision #145): the
  // capacity overflow rule. Replaces the two CHD-04 hard
  // rejects (`numAdults > maxCapacity` +
  // `numChildren > maxChildren`) with one generalized
  // check: extra beds grant additional occupant slots
  // usable by an adult OR a child. Used by
  // handleCreateBooking / handleCreateWalkin /
  // handleRescheduleBooking. See the JSDoc on the
  // function in `shared/utils/roomTypes.ts` for the
  // exact rule + the edge cases the test pins.
  requiredExtraBedsFor,
  applyRoomTypeDefaults,
  // Per EXB-10 (2026-08-01, per decision #157): the
  // hotel-wide rollaway-bed inventory check. The
  // inventory is configured in
  // `settings/hotelConfig.extraBedInventory` (a positive
  // integer = the count of rollaway beds the hotel
  // physically owns; 0 or absent = the historical "any
  // number" behavior, no constraint). The check runs
  // INSIDE the same Firestore transaction that assigns
  // the room — a read-then-write check outside the
  // transaction would race exactly like RTS-01 (two
  // concurrent bookings both see "1 bed free" and both
  // take it). `countExtraBedsInUse` takes a pre-fetched
  // list of candidate bookings (no Firestore dependency)
  // so the helper is unit-testable; the query lives at
  // each of the 3 call sites (handleCreateBooking +
  // handleCreateWalkin + handleRescheduleBooking).
  // `checkExtraBedInventory` is the pure cap check —
  // `0 inventory` short-circuits to `ok: true` so legacy
  // + freshly bootstrapped projects get the historical
  // semantics for free. See the JSDoc on the helpers in
  // `shared/utils/extraBedInventory.ts` for the exact
  // rule + the edge cases the test pins.
  countExtraBedsInUse,
  checkExtraBedInventory,
  // Per MRB-04 Phase 3 (2026-08-02, per decision #159): the
  // N=1 mapping helper that closes the money-state-mirror
  // rule. The reservation header's `paymentStatus` MUST
  // match the per-room money state. The 3 payment write
  // paths (`handleAddPayment` + `handleVerifyAndRecordPayment`
  // + `handleRejectPayment`) call this helper inside the
  // same `runTransaction` as the booking update, so the
  // header's `paymentStatus` is always in sync with the
  // child booking's `status` for new reservations.
  mapBookingStatusToReservationPaymentStatus,
  // Per MRB-05 (2026-08-02, per decision #159): the N>1
  // aggregate reader that computes the reservation
  // header's `paymentStatus` from the N child
  // `Booking.status` values. For N=1 (today's entire
  // active surface — every reservation has exactly one
  // child booking) the aggregate is the same as the
  // single mapped status from
  // `mapBookingStatusToReservationPaymentStatus`. The 5
  // lifecycle handlers (`handleConfirmBooking` +
  // `handleConfirmBookingWithBalance` +
  // `handleCheckinBooking` + `handleCheckoutBooking` +
  // `handleCancelBooking`) call this helper inside the
  // same `runTransaction` as the booking status flip.
  computeReservationAggregatePaymentStatus
} from "@spark-inn/shared";
import type { BookingRateBreakdown } from "@spark-inn/shared";
import { DEFAULT_TERMS_VERSION } from "@spark-inn/shared";
// Per PMH-02 (2026-07-31): the server's inline folio math (used
// by the create / confirm-with-balance / post-checkout transactions)
// now routes through the shared `computeServerFolioTotals` helper
// so MRB-04 edits one function instead of three.
import { computeServerFolioTotals, calculateBreakfastAddOn } from "@spark-inn/shared";
import { z } from "zod";
import config from "../../../hotel.config";
import { buildRateBreakdown, rebuildEarlyCheckoutRateBreakdown, rebuildRateBreakdown } from "../lib/rate-breakdown";

export function getConfiguredBookingRefPrefix() {
  return config.bookingRefPrefix || "SI";
}

const ROOM_OCCUPYING_STATUSES = BOOKING_OCCUPYING_STATUSES;
const ROOM_NOT_READY_PREVIOUS_GUEST_ERROR = "Room not ready — previous guest has not checked out yet.";
const PREALLOCATED_BOOKING_ID_REGEX = /^[A-Za-z0-9]{10,32}$/;
const PREALLOCATED_PAYMENT_ID_REGEX = /^[A-Za-z0-9]{10,32}$/;
const RESCHEDULABLE_STATUSES = ["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"];

// Per PEX-03 (2026-08-01, per decision #147): a `pending` hold is
// "expired" when its snapshotted deadline is in the past. The
// helper is a thin wrapper over `isBookingOccupyingRoom` to keep
// the candidate loop readable. Shared by handleCreateBooking +
// handleCreateWalkin + handleRescheduleBooking.
function isExpiredPendingHold(bookingData: any, now: Date): boolean {
  if (!bookingData) return false;
  if (bookingData.status !== "pending") return false;
  return !isBookingOccupyingRoom({
    status: bookingData.status,
    holdExpiresAt: bookingData.holdExpiresAt
  }, now);
}

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

interface TransactionalFolioSnapshot {
  reservationId: string;
  totalPrice: number;
  collectedTotal: number;
  incidentalTotal: number;
  addToBillTotal: number;
  folioTotal: number;
  computedBalance: number;
  source: "reservation-subcollection" | "booking-subcollection-legacy";
}

/**
 * MRB-04 Phase 4: resolve the authoritative folio inside the caller's
 * Firestore transaction.
 *
 * New reservations read the reservation-owned payments/refunds/charges
 * plus every child room's transitional booking-owned ledgers. The latter
 * preserves entries created between MRB-01 and the admin folio migration;
 * no money disappears merely because a reservation header now exists.
 * Add-to-bill store orders retain their room bookingId, so they are summed
 * across every child room. Legacy null-reservationId bookings keep the
 * historical single-booking paths byte-for-byte.
 */
async function readTransactionalFolioSnapshot(input: {
  transaction: any;
  bookingRef: any;
  bookingId: string;
  bookingData: any;
}): Promise<TransactionalFolioSnapshot> {
  const { transaction, bookingRef, bookingId, bookingData } = input;
  const bookingReservationId = String((bookingData as any).reservationId || "").trim();

  if (!bookingReservationId) {
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
    const totals = computeServerFolioTotals({
      totalPrice: Number(bookingData.totalPrice) || 0,
      incidentalTotal,
      addToBillTotal,
      collectedTotal
    });
    return {
      reservationId: "",
      totalPrice: Number(bookingData.totalPrice) || 0,
      collectedTotal,
      incidentalTotal,
      addToBillTotal,
      ...totals,
      source: "booking-subcollection-legacy"
    };
  }

  const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
  const reservationPaymentsRef = reservationRef.collection("payments");
  const reservationRefundsRef = reservationRef.collection("refunds");
  const reservationChargesRef = reservationRef.collection("charges");
  const childBookingsQuery = adminDb.collection("bookings").where("reservationId", "==", bookingReservationId);
  const [
    reservationDoc,
    reservationPaymentsSnapshot,
    reservationRefundsSnapshot,
    reservationChargesSnapshot,
    childBookingsSnapshot
  ] = await Promise.all([
    transaction.get(reservationRef),
    transaction.get(reservationPaymentsRef),
    transaction.get(reservationRefundsRef),
    transaction.get(reservationChargesRef),
    transaction.get(childBookingsQuery)
  ]);

  if (!reservationDoc.exists) {
    throw new Error("RESERVATION_HEADER_WITHOUT_CHILD");
  }

  const childBookingIds = new Set<string>([bookingId]);
  childBookingsSnapshot.docs.forEach((docSnap: any) => childBookingIds.add(String(docSnap.id)));

  // Transitional compatibility: before the admin folio surface moves to
  // reservation-owned charges, reservation-linked child bookings may still
  // carry payment/charge entries. Read them without copying or rewriting.
  const childLedgerSnapshots = await Promise.all(
    Array.from(childBookingIds).map(async (childBookingId) => {
      const childRef = adminDb.collection("bookings").doc(childBookingId);
      const storeOrdersQuery = adminDb.collection("storeOrders").where("bookingId", "==", childBookingId);
      const [paymentsSnapshot, chargesSnapshot, storeOrdersSnapshot] = await Promise.all([
        transaction.get(childRef.collection("payments")),
        transaction.get(childRef.collection("charges")),
        transaction.get(storeOrdersQuery)
      ]);
      return { paymentsSnapshot, chargesSnapshot, storeOrdersSnapshot };
    })
  );

  const transitionalCollectedTotal = childLedgerSnapshots.reduce(
    (sum, snapshots) => sum + sumLedgerAmounts(snapshots.paymentsSnapshot),
    0
  );
  const transitionalIncidentalTotal = childLedgerSnapshots.reduce(
    (sum, snapshots) => sum + sumLedgerAmounts(snapshots.chargesSnapshot),
    0
  );
  const addToBillTotal = childLedgerSnapshots.reduce(
    (sum, snapshots) => sum + sumBilledAddToBillOrders(snapshots.storeOrdersSnapshot),
    0
  );
  const collectedTotal =
    sumLedgerAmounts(reservationPaymentsSnapshot)
    + sumLedgerAmounts(reservationRefundsSnapshot)
    + transitionalCollectedTotal;
  const incidentalTotal =
    sumLedgerAmounts(reservationChargesSnapshot)
    + transitionalIncidentalTotal;
  const totalPrice = Number(reservationDoc.data()?.totalPrice) || 0;
  const totals = computeServerFolioTotals({
    totalPrice,
    incidentalTotal,
    addToBillTotal,
    collectedTotal
  });

  return {
    reservationId: bookingReservationId,
    totalPrice,
    collectedTotal,
    incidentalTotal,
    addToBillTotal,
    ...totals,
    source: "reservation-subcollection"
  };
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
  now: Date;
}) {
  // Per PEX-02 (2026-08-01, per decision #147): the shared
  // occupancy rule is the only authority. An expired `pending`
  // hold (or a `pending` hold for which the cron has already
  // retired — should never happen in the same transaction,
  // but the read is cheap) does not block the room. The candidate
  // loop in handleCreateBooking / handleCreateWalkin /
  // handleRescheduleBooking retires these in the same transaction.
  if (!isBookingOccupyingRoom({
    status: input.bookingData.status,
    holdExpiresAt: input.bookingData.holdExpiresAt
  }, input.now)) {
    return null;
  }
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
  // Per CHD-10 (2026-07-31, per CVQ-01): optional — when absent,
  // the server snapshots the admin default from
  // `settings/breakfastConfig.breakfastIncludesChildrenDefault`
  // and writes the result to the booking doc alongside
  // `hasBreakfast`. `true` is the safe default (matches the
  // historical "children pay the full rate" math).
  breakfastIncludesChildren: z.boolean().optional(),
  // Per CHD-01 (2026-08-01, per decision #144): the
  // adults/children split. Both optional — when absent,
  // the server derives `numAdults = guests`, `numChildren
  // = 0` (the historical "all guests are adults" shape,
  // byte-equivalent to pre-CHD-01 read sites). When
  // present, the server validates
  // `numAdults + numChildren === guests` (the spec's
  // "no trusting either value from the client" rule).
  numAdults: z.coerce.number().int().min(0).max(100).optional(),
  numChildren: z.coerce.number().int().min(0).max(100).optional(),
  // Per EXB-01 (2026-07-31): extra-bed count. Optional — when
  // absent, the server treats it as 0. Bounded server-side by the
  // room type's `maxExtraBeds` (a booking with
  // `extraBedCount > maxExtraBeds` is rejected). The server
  // snapshots the room type's `extraBedRate` onto the booking doc
  // alongside this field.
  extraBedCount: z.coerce.number().int().min(0).max(20).optional(),
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
  // Per MRB-06 (2026-08-02, per decision #159): the N>1
  // generalization. The client requests N rooms of the
  // same `roomType`; the server assigns N DISTINCT
  // physical rooms in one transaction (same-room-twice
  // guard — every assigned room is unique within the
  // reservation). The fingerprint's `roomLines[0].quantity`
  // matches this count so the idempotency check is
  // N-aware. Default 1 (the historical single-room
  // case — byte-equivalent to pre-MRB-06 for callers
  // that don't supply the field). Bounded at 50 to
  // match the existing `guests` upper bound (a 50-room
  // reservation is the largest party size the
  // occupancy check is designed for; larger would
  // stress the transaction's read set).
  roomCount: z.coerce.number().int().min(1).max(50).optional().default(1),
  testToken: z.string().trim().max(512).optional(),
  turnstileToken: z.string().max(4096).optional(),
  // Per MRB-02 (2026-08-02, per decision #159): optional client
  // preallocation of the reservationId. When present, the
  // server's transactional create uses the same room for the
  // idempotency replay / 409 conflict matrix. When absent,
  // the server auto-mints a UUIDv4 (no retry guarantee; the
  // legacy null-reservationId path still works for callers
  // that have not been updated to preallocate). Validated
  // against the same `RESERVATION_ID_REGEX` from
  // `shared/utils/references.ts`.
  reservationId: z.string().trim().regex(RESERVATION_ID_REGEX).optional(),
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
    // Per CHD-01 (2026-08-01, per decision #144): the
    // adults/children split. Both optional — when absent,
    // the server derives `numAdults = guests`, `numChildren
    // = 0` (the historical "all guests are adults" shape,
    // byte-equivalent to pre-CHD-01 read sites). When
    // present, the server validates
    // `numAdults + numChildren === guests` and rejects any
    // client-supplied total that disagrees. The booking doc
    // stores both fields so the rate breakdown + the
    // booking drawer + the receipt PDF can render the split
    // (CHD-07 follow-up).
    numAdults: requestedNumAdults,
    numChildren: requestedNumChildren,
    // Per CHD-10 (2026-07-31, per CVQ-01): the optional per-booking
    // override for "include children in the breakfast charge". When
    // undefined, the server snapshots the admin default from
    // `settings/breakfastConfig.breakfastIncludesChildrenDefault`
    // inside the create transaction. Storing the result on the
    // booking doc means a later policy change never rewrites an
    // existing bill.
    breakfastIncludesChildren: requestedBreakfastIncludesChildren,
    // Per EXB-01 (2026-07-31): extra-bed count. Optional — when
    // absent, treated as 0. Bounded server-side by the room type's
    // `maxExtraBeds` (a booking with `extraBedCount > maxExtraBeds`
    // is rejected with a 400). The server snapshots the room type's
    // `extraBedRate` onto the booking doc alongside this field.
    extraBedCount: requestedExtraBedCount,
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
    // Per MRB-06 (2026-08-02, per decision #159): the N>1
    // generalization. Defaults to 1 (the historical
    // single-room case) so existing callers don't need
    // to send the field.
    roomCount,
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

  // Per MRB-02 (2026-08-02, per decision #159): the
  // reservation header linkage. The client may preallocate a
  // `reservationId` (UUIDv4) to enable idempotency on a
  // retry-after-uncertain-response; the server auto-mints one
  // when the field is absent (no retry guarantee, but the
  // legacy null-reservationId path still works for callers
  // that have not been updated). The `requestFingerprint` is
  // computed from the same canonical payload the client's
  // preallocation helper uses; the in-transaction check is
  // the idempotency replay / 409 conflict matrix. The
  // single-room case is `roomLines: [{ type: roomType,
  // quantity: 1, adults: ..., children: ..., extraBeds: ... }]`
  // — the helper is designed for the N>1 case that MRB-06
  // will exercise.
  //
  // Per MRB-02.x corporate (2026-08-02, per decision #164):
  // the fingerprint's `isCorporate` + `source` + `companyName`
  // must match the server-validated `corporateDetails` the
  // transaction stamps on the booking + reservation header.
  // The server sets `isCorporate: true` for BOTH the
  // "with code" path (validated `corporateCode`) AND the
  // "Continue without code" path (the `corporateFlatRate:
  // true` intent flag). Pre-fix, the fingerprint used
  // `Boolean(corporateCode)` for `isCorporate` + `source`,
  // which gave `false` / `"online"` for the "Continue
  // without code" path -- a mismatch with the stamped
  // `true` / `"corporate"`. The fix threads the intent
  // flag through so the fingerprint's source +
  // isCorporate + companyName match the stamped values
  // for both corporate paths.
  const isCorporateIntent = Boolean(corporateCode) || corporateFlatRate === true;
  const guestNameForFingerprint = `${rawGuestDetails.firstName.trim()} ${rawGuestDetails.lastName.trim()}`;
  const reservationRequestFingerprint = computeRequestFingerprint({
    reservationId: String(body.reservationId || "").trim(),
    roomLines: [{
      type: String(roomType || "").trim(),
      // Per MRB-06 (2026-08-02, per decision #159): the
      // N>1 generalization. `quantity` is the number of
      // rooms of this type the client requested. The
      // fingerprint is N-aware — a retry with a
      // different `roomCount` is a different request
      // (409 conflict), a retry with the same
      // `roomCount` is the same request (replay). The
      // `roomLines` array can grow in MRB-06's N>1 +
      // multi-type generalization (a follow-up lifts
      // the single-type constraint and accepts multiple
      // lines, one per type with its own `quantity`).
      quantity: Math.max(1, Math.floor(Number(roomCount) || 1)),
      adults: Math.max(0, Math.floor(Number(requestedNumAdults ?? guests) || 0)),
      children: Math.max(0, Math.floor(Number(requestedNumChildren ?? 0) || 0)),
      extraBeds: Math.max(0, Math.floor(Number(requestedExtraBedCount ?? 0) || 0))
    }],
    checkIn: String(checkIn || "").trim(),
    checkOut: String(checkOut || "").trim(),
    leadGuestName: guestNameForFingerprint,
    leadGuestEmail: String(rawGuestDetails.email || "").trim().toLowerCase(),
    leadGuestPhone: String(rawGuestDetails.phone || "").trim(),
    source: isCorporateIntent ? "corporate" : "online",
    isCorporate: isCorporateIntent,
    corporateCode: String(corporateCode || "").trim().toUpperCase(),
    // `companyName` is the body-entered name (the guest's
    // stated company). For the "Continue without code"
    // path the server stamps this same body-entered
    // name; for the "with code" path the server stamps
    // the doc's `companyName` (the "enforced" name from
    // the corporateCodes doc, which may differ). The
    // fingerprint's purpose is "client intent" -- the
    // guest's stated name IS the intent -- so using the
    // body value here is correct (a retry with a
    // different stated name is a different intent,
    // 409; a retry with the same stated name is the
    // same intent, replay).
    companyName: isCorporateIntent
      ? String(rawGuestDetails.companyName || "").trim()
      : "",
    voucherCode: String(voucherCode || "").trim().toUpperCase(),
    memberDiscountPct: 0,  // public path has no member discount; MRB-06's signed-in path resolves this from the verified email token
    discountScope: normalizeDiscountScope(null),  // server-resolved DSC-01 scope lands in MRB-04
    termsVersion: DEFAULT_TERMS_VERSION,
    privacyVersion: DEFAULT_TERMS_VERSION
  });

  try {
    let finalBookingRef = "";
    let finalTotalPrice = 0;
    let finalRateBreakdown: BookingRateBreakdown | null = null;
    // Per MRB-02 (2026-08-02, per decision #164): the public
    // reservation ref (e.g. `R-20260802-00001`) is minted inside
    // the transaction (so it shares the same `now` + counter
    // transaction as the booking ref) and read in the
    // post-transaction success response. Same `finalX`
    // capture pattern as `finalBookingRef` /
    // `finalTotalPrice` / `finalRateBreakdown`.
    let finalReservationRef = "";
    let computedData: any = {};
    let alreadyExistingBookingResponse: any = null;
    // Per PEX-05 (2026-08-01, per decision #147): the snapshotted
    // `holdExpiresAt` is captured inside the transaction (so it
    // matches the `now` used for the retirement pass) and read
    // after the transaction commits for the response payload +
    // the booking-submitted email send. `null` for
    // `payment-uploaded` bookings (no auto-expiry) and for
    // legacy callers that omit `paymentHoldWindowHours`.
    let bookingHoldExpiresAt: Date | null = null;
    // Captured inside the transaction so the response payload
    // can surface the auto-assigned physical room.
    let assignedRoomId = "";
    let assignedRoomNumber = "";
    // Per PEX-03 (2026-08-01, per decision #147): the list of
    // `pending` holds retired by THIS create transaction is
    // collected inside the transaction (so the retirement is
    // atomic with the new booking) and read after the transaction
    // commits (so the per-hold `booking-expired` email is sent
    // from the post-transaction path, never from inside the
    // transaction).
    const expiredHoldRetirements: Array<{ ref: FirebaseFirestore.DocumentReference; previousData: any; bookingRef: string; guestEmail: string; holdExpiresAt: Date | null }> = [];

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

    // Per MRB-02 (2026-08-02, per decision #164): the canonical
    // reservation id for this create. Client may have
    // preallocated a `reservationId` (UUIDv4); when absent the
    // server auto-mints one (preserves the legacy
    // null-reservationId path for callers that have not been
    // updated). The first read inside the transaction below is
    // the idempotency check: same `reservationId` + same
    // `requestFingerprint` replays the original commit (returns
    // the existing booking's response shape); same
    // `reservationId` + different `requestFingerprint` is a 409
    // conflict. The header is then created (or re-verified)
    // inside the same transaction as the child booking so a
    // partial failure cannot leave a reservation header without
    // its child or vice versa.
    //
    // Declared at function scope (not inside the transaction
    // callback) so the post-transaction success response can
    // echo it back to the client — see the `res.status(200)`
    // payload at the end of the handler.
    const effectiveReservationId: string = (body.reservationId && RESERVATION_ID_REGEX.test(body.reservationId))
      ? body.reservationId
      : generateReservationId();
    const reservationDocRef = adminDb.collection("reservations").doc(effectiveReservationId);

    // Run Firestore Transaction
    await adminDb.runTransaction(async (transaction) => {
      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      // Per PEX-01 + PEX-03 (2026-08-01, per decision #147):
      // a single `now` is captured at the top of the transaction
      // and threaded into every occupancy + retirement check so
      // a later Settings change (window length) or a concurrent
      // cron tick cannot race the deadline read. The retirement
      // list collects `pending` holds that have passed their
      // snapshotted deadline AND overlap with this new booking's
      // date range — the spec's "every conflicting expired hold"
      // rule. The retirements are written in this same
      // transaction (no separate write) so a partial failure
      // cannot leave the expired hold in the booking's room.
      const now = new Date();

      // Per MRB-02 (2026-08-02, per decision #164): the
      // idempotency check on the reservation header. Both
      // `effectiveReservationId` + `reservationDocRef` are
      // declared at function scope (just above the
      // `runTransaction` call) so the post-transaction
      // success response can echo the id back to the client.
      // Inside the transaction, the first read is the
      // idempotency check: same `reservationId` + same
      // `requestFingerprint` replays the original commit
      // (returns the existing booking's response shape);
      // same `reservationId` + different `requestFingerprint`
      // is a 409 conflict. The header is then created (or
      // re-verified) inside the same transaction as the child
      // booking so a partial failure cannot leave a
      // reservation header without its child or vice versa.
      const existingReservationSnap = await transaction.get(reservationDocRef);
      if (existingReservationSnap.exists) {
        const existingData = existingReservationSnap.data() || {};
        const sameRequest = String(existingData.requestFingerprint || "") === reservationRequestFingerprint;
        if (!sameRequest) {
          throw new Error("RESERVATION_ID_FINGERPRINT_CONFLICT");
        }
        // Idempotent replay: the existing reservation header
        // already carries the canonical fields; just reuse it.
        // The child booking's `reservationId` /
        // `reservationRef` / `reservationPosition` /
        // `reservationRoomCount` were stamped at the original
        // create, so no per-child recompute is needed. The
        // response is built from the existing reservation +
        // the existing booking doc (re-read below the inner
        // conflict short-circuits if the booking exists). For
        // the public `/api/bookings/create` path the
        // `bookingId` is also client-preallocated, so the
        // same `bookingId` + same `reservationId` is the
        // canonical idempotency key.
        const existingChildSnap = await transaction.get(bookingDocRef);
        if (existingChildSnap.exists) {
          const existingChild = existingChildSnap.data() || {};
          alreadyExistingBookingResponse = {
            success: true,
            idempotentReplay: true,
            bookingId,
            reservationId: String(existingData.id || effectiveReservationId),
            reservationRef: String(existingData.reservationRef || ""),
            roomId: String(existingChild.roomId || ""),
            roomNumber: String(existingChild.roomNumber || ""),
            totalPrice: Number(existingChild.totalPrice || 0),
            bookingRef: String(existingChild.bookingRef || ""),
            rateBreakdown: existingChild.rateBreakdown || null,
            holdExpiresAt: (existingChild as any).holdExpiresAt
              ? ((existingChild as any).holdExpiresAt.toDate
                ? (existingChild as any).holdExpiresAt.toDate()
                : (existingChild as any).holdExpiresAt)
              : null
          };
          // Skip the rest of the create transaction — the
          // existing reservation + booking are the
          // canonical answer.
          return;
        }
        // The reservation header exists but the child booking
        // does not — a partially-applied create. Refuse rather
        // than risk a half-stamped booking; the client retries
        // the same `reservationId` and we recover the state.
        throw new Error("RESERVATION_HEADER_WITHOUT_CHILD");
      }
      // Per PEX-01 + PEX-04 (2026-08-01, per decision #147): a
      // late payment proof or a late walk-in with `holdExpiresAt`
      // still in the past must not be allowed to occupy the
      // room. The shared rule is the only authority.

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
          // Per MRB-02 (2026-08-02, per decision #164): echo
          // the reservation linkage from the existing booking
          // doc so the client gets a consistent payload shape
          // across the fresh create, the reservation-level
          // replay, and the legacy booking-level replay. The
          // `idempotentReplay` flag discriminates the two
          // replay paths.
          reservationId: String(existing.reservationId || ""),
          reservationRef: String(existing.reservationRef || ""),
          idempotentReplay: true,
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

      // Per DSC-01..05 (2026-08-01, per CVQ-06): snapshot the admin's
      // per-class discount scope (`settings/hotelConfig.discountScope`)
      // at booking time so a later scope change never rewrites an
      // existing bill. `normalizeDiscountScope` fills in the broad
      // default for legacy settings without the field. The snapshot
      // is written to `booking.discountScopeSnapshot` and re-read on
      // reschedule / discount rejection so the math always uses the
      // scope that was live at create time.
      const snapshottedDiscountScope = normalizeDiscountScope(hotelConfig.discountScope);

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
      const rawTypeEntry = roomTypesArr.find((entry) => entry && entry.value === roomType);
      if (!rawTypeEntry) {
        throw new Error("Selected room type is not available.");
      }
      const typeEntry = applyRoomTypeDefaults(rawTypeEntry);
      const typeMaxCapacity = Number(typeEntry.maxCapacity) || 0;
      const typeBaseRate = Number(typeEntry.pricePerNight) || 0;
      const typeWeekendRate = Number(typeEntry.weekendRate) || 0;
      const typeCorporateRate = Number(typeEntry.corporateRate) || 0;
      const seasonalRateOverrides = normalizeSeasonalRateOverrides(hotelConfig.seasonalRateOverrides);

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

      let sawLingeringCheckedInConflict = false;
      // Per MRB-06 (2026-08-02, per decision #159): the
      // outer loop iterates `roomCount` times to assign
      // N distinct rooms of the requested `roomType`.
      // The inner loop walks the candidates in
      // `roomNumber` order and picks the first
      // non-conflicting one. After each successful
      // assignment the room id is added to
      // `assignedRoomIds` so the next outer iteration
      // skips it (the same-room-twice guard). If the
      // inner loop runs out of non-conflicting
      // candidates before `roomCount` is satisfied,
      // the entire transaction aborts — no partial
      // write. For N=1 (the default) the outer loop
      // runs once, byte-equivalent to the pre-MRB-06
      // behavior.
      const assignedRooms: Array<{ id: string; data: any }> = [];
      const assignedRoomIds: string[] = [];
      for (let outerIdx = 0; outerIdx < Math.max(1, Math.floor(Number(roomCount) || 1)); outerIdx++) {
        let foundThisRound: { id: string; data: any } | null = null;
        for (const candidate of candidates) {
          if (assignedRoomIds.includes(candidate.id)) {
            continue;  // same-room-twice guard
          }
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
          // Per PEX-03 (2026-08-01, per decision #147):
          // for each conflicting doc, decide whether
          // it's an active conflict (overlap with a
          // still-occupying booking) or an expired
          // `pending` hold we can retire in this same
          // transaction. A non-overlapping `pending`
          // hold (wrong dates entirely) is also ignored
          // — it does not block this room, and the
          // daily cron (PEX-06) retires it
          // independently.
          let sawOverlap = false;
          for (const doc of overlapSnapshot.docs) {
            const bookingData = doc.data();
            if (isExpiredPendingHold(bookingData)) {
              const existingCheckIn = toDateOrNull(bookingData.checkIn);
              const existingCheckOut = toDateOrNull(bookingData.checkOut);
              const dateOverlaps = existingCheckIn && existingCheckOut
                ? rangesOverlap(existingCheckIn, existingCheckOut, checkInDate, checkOutDate)
                : false;
              if (dateOverlaps) {
                expiredHoldRetirements.push({
                  ref: doc.ref,
                  previousData: bookingData,
                  bookingRef: String(bookingData.bookingRef || doc.id),
                  guestEmail: String(bookingData.guestEmail || ""),
                  holdExpiresAt: toDateOrNull(bookingData.holdExpiresAt)
                });
              }
              // either way: this doc does not block the new booking
              continue;
            }
            const reason = getOccupancyConflictReason({
              bookingData,
              requestedCheckIn: checkInDate,
              requestedCheckOut: checkOutDate,
              requestedCheckInKey: checkIn,
              todayKey: manilaToday,
              currentMinutes: currentManilaMinutes,
              checkOutTime: hotelConfig.checkOutTime,
              now
            });
            if (reason === "overlap" || reason === "lingering-checked-in") {
              if (reason === "lingering-checked-in") {
                sawLingeringCheckedInConflict = true;
              }
              sawOverlap = true;
              break;
            }
          }
          if (sawOverlap) {
            continue;
          }
          const hasBlockConflict = await hasActiveRoomBlockConflict(transaction, candidate.id, checkInDate, checkOutDate);
          if (hasBlockConflict) {
            continue;
          }
          foundThisRound = candidate;
          break;
        }
        if (!foundThisRound) {
          throw new Error(sawLingeringCheckedInConflict ? ROOM_NOT_READY_PREVIOUS_GUEST_ERROR : "Room no longer available");
        }
        assignedRooms.push(foundThisRound);
        assignedRoomIds.push(foundThisRound.id);
      }

      if (assignedRooms.length === 0) {
        throw new Error(sawLingeringCheckedInConflict ? ROOM_NOT_READY_PREVIOUS_GUEST_ERROR : "Room no longer available");
      }

      // For backward compat with the single-room
      // post-transaction code (response payload + the
      // booking-submitted email), expose the FIRST
      // assigned room as `roomId` + `roomData`. The
      // N>1 path writes N booking docs in a loop
      // (below) — each doc carries its own
      // `roomId` + `roomNumber` + `reservationPosition`.
      // The success response echoes the FIRST
      // assignment (the historical shape); MRB-09 +
      // the admin booking drawer follow-up render
      // the group view from the reservation header
      // (which has `roomCount` + `reservationRoomCount`).
      const roomId = assignedRooms[0].id;
      const roomData = assignedRooms[0].data;
      assignedRoomId = roomId;
      assignedRoomNumber = String(roomData.roomNumber || "");

      // 3. Fetch Breakfast Settings
      const breakfastConfigRef = adminDb.collection("settings").doc("breakfastConfig");
      const breakfastConfigDoc = await transaction.get(breakfastConfigRef);
      const breakfastConfig = breakfastConfigDoc.exists ? breakfastConfigDoc.data()! : { isEnabled: false, ratePerPersonPerNight: DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT };
      const actualBreakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT) : 0;
      // Per CHD-10 (2026-07-31, per CVQ-01): snapshot the admin
      // default for "include children in breakfast" onto the new
      // booking doc. The per-booking override (if sent) takes
      // precedence; otherwise the admin default applies; otherwise
      // `true` (the historical "children pay the full rate" default).
      const breakfastIncludesChildrenDefault = breakfastConfig.breakfastIncludesChildrenDefault !== false;
      const breakfastIncludesChildren = requestedBreakfastIncludesChildren !== undefined
        ? requestedBreakfastIncludesChildren
        : breakfastIncludesChildrenDefault;

      // Per CHD-01 + CHD-04 (2026-08-01, per decision #144):
      // validate the adults/children split against the room
      // type's `maxCapacity` (adults) + `maxChildren` (children).
      // The split is optional — absent fields derive to
      // `numAdults = guests`, `numChildren = 0` (the historical
      // "all guests are adults" shape). When present, the
      // server validates `numAdults + numChildren === guests`
      // and rejects any client-supplied total that disagrees
      // (the spec's "no trusting either value from the client"
      // rule). The typeEntry carries `maxCapacity` (adult cap)
      // and `maxChildren` (per-CHD-02, normalized via
      // `normalizeMaxChildren` on the legacy settings path).
      const numAdults = Number.isFinite(Number(requestedNumAdults))
        ? Math.max(0, Math.floor(Number(requestedNumAdults)))
        : guests;
      const numChildren = Number.isFinite(Number(requestedNumChildren))
        ? Math.max(0, Math.floor(Number(requestedNumChildren)))
        : 0;
      if (numAdults + numChildren !== guests) {
        throw new Error(
          `Occupancy split mismatch: numAdults (${numAdults}) + numChildren (${numChildren}) must equal guests (${guests}).`
        );
      }
      const typeMaxChildren = Math.max(0, Number(typeEntry.maxChildren) || 0);
      // Per EXB-03 (2026-08-01, per decision #145): the
      // overflow rule replaces the two independent hard
      // rejects (the original CHD-04 shape) with one
      // generalized check. Extra beds grant additional
      // occupant slots usable by an adult OR a child, so
      // the rule is:
      //   max(0, adults − maxCapacity) + max(0, children − maxChildren)
      //   ≤ extraBedCount
      // When `extraBedCount === 0`, the rule reduces to
      // the two hard caps (CHD-04's original shape). When
      // `extraBedCount > 0`, the rule allows overflow up to
      // the extra bed count. The helper is the only
      // authority; every create / walkin / reschedule
      // transaction routes through it.
      // Compute the overflow AFTER reading the extra-bed
      // count (which is read below at line ~1009); we
      // hoist it so the overflow check + the per-type
      // cap check are in the same scope.
      // (See `requiredExtraBedsFor` in `shared/utils/roomTypes.ts`.)

      // Per EXB-01 (2026-07-31): validate `extraBedCount` against
      // the room type's `maxExtraBeds`, then snapshot the rate
      // onto the booking doc. `maxExtraBeds === 0` means the room
      // type does not allow extra beds (a count > 0 is rejected
      // with a 400). Absent fields on the room type normalize to 0
      // — the same permissive pattern used for the #111 surface
      // flags and CHD.
      const extraBedCount = Math.max(0, Number(requestedExtraBedCount) || 0);
      const typeMaxExtraBeds = Math.max(0, Number(typeEntry.maxExtraBeds) || 0);
      const typeExtraBedRate = Math.max(0, Number(typeEntry.extraBedRate) || 0);
      if (extraBedCount > typeMaxExtraBeds) {
        throw new Error(
          `Extra bed count (${extraBedCount}) exceeds the room type's allowance (${typeMaxExtraBeds}).`
        );
      }
      const extraBedRate = extraBedCount > 0 ? typeExtraBedRate : 0;
      // Per EXB-03 (2026-08-01, per decision #145): the
      // overflow rule. See the doc block above for the
      // rationale. Computed after the per-type cap is read
      // so both checks are in the same scope. The helper
      // is the only authority; the two hard rejects that
      // CHD-04 wrote (`numAdults > typeMaxCapacity` +
      // `numChildren > typeMaxChildren`) are subsumed —
      // when `extraBedCount === 0`, the rule naturally
      // enforces both hard caps.
      const overflow = requiredExtraBedsFor({
        numAdults,
        numChildren,
        maxCapacity: typeMaxCapacity,
        maxChildren: typeMaxChildren
      });
      if (overflow.requiredExtraBeds > extraBedCount) {
        throw new Error(
          `Not enough extra beds: ${overflow.overflowAdults} overflow adult(s) + ${overflow.overflowChildren} overflow child(ren) = ${overflow.requiredExtraBeds} extra bed(s) needed, but only ${extraBedCount} extra bed(s) selected. The room type allows up to ${typeMaxExtraBeds} extra bed(s).`
        );
      }

      // Per EXB-10 (2026-08-01, per decision #157): the
      // hotel-wide rollaway-bed inventory check. Runs
      // INSIDE the same Firestore transaction that
      // assigns the room — a read-then-write check
      // outside the transaction would race exactly like
      // RTS-01 (two concurrent bookings both see "1 bed
      // free" and both take it). The query is a single
      // `where("status", "in", BOOKING_OCCUPYING_STATUSES)`
      // (the candidate set is bounded by the hotel's
      // active-booking count — typically dozens, not
      // thousands) + an in-memory date-overlap filter
      // inside the helper. No composite index needed;
      // the existing `(status, checkIn)` index covers
      // the status filter, and the helper's
      // `Number(extraBedCount) || 0` defensive coercion
      // handles zero/absent counts for free. The
      // helper is pure: it takes the pre-fetched docs
      // + the requested range and returns the in-use
      // count; the cap check is a single
      // `checkExtraBedInventory` call. `0 inventory`
      // short-circuits to `ok: true` so legacy +
      // freshly bootstrapped projects get the
      // historical "any number" behavior for free. The
      // query skips the "current booking" exclusion —
      // `handleCreateBooking` is a new booking, so
      // there is no prior `extraBedCount` to subtract.
      if (extraBedCount > 0) {
        const extraBedOverlapQuery = adminDb.collection("bookings")
          .where("status", "in", ROOM_OCCUPYING_STATUSES);
        const extraBedOverlapSnapshot = await transaction.get(extraBedOverlapQuery);
        const extraBedInUse = countExtraBedsInUse(
          extraBedOverlapSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
          checkInDate,
          checkOutDate
        );
        // Per MRB-06 Phase 2 (2026-08-02, per decision
        // #159): the N>1 extra-bed inventory check. The
        // per-room `extraBedCount` is the count per
        // room; for N=1 (the default) the total
        // `extraBedCount * 1` is byte-equivalent to
        // pre-MRB-06. For N>1 the reservation uses
        // `extraBedCount * assignedRooms.length` extra
        // beds in total (e.g. N=2 rooms with
        // extraBedCount=1 per room = 2 extra beds).
        const totalExtraBeds = extraBedCount * assignedRooms.length;
        const inventoryResult = checkExtraBedInventory(
          Math.max(0, Number(hotelConfig.extraBedInventory) || 0),
          extraBedInUse,
          totalExtraBeds
        );
        if (!inventoryResult.ok) {
          throw new Error(
            `Not enough extra beds: ${extraBedInUse} already booked across overlapping stays + ${totalExtraBeds} requested = ${extraBedInUse + totalExtraBeds}, but the hotel only has ${hotelConfig.extraBedInventory} rollaway bed(s) in inventory.`
          );
        }
      }

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
      // Per CHD-10 (2026-07-31, per CVQ-01): the inline
      // `actualBreakfastRate * guests * numNights` pattern now
      // routes through the shared `calculateBreakfastAddOn` helper.
      // The helper falls back to `numGuests` when the adult/child
      // split is not provided (the historical path, byte-equivalent);
      // when the split is provided (CHD-01), the helper uses
      // `(numAdults + (flag ? numChildren : 0))`. Both shapes
      // are covered; we always pass the split when present so
      // the breakfast math tracks the persisted booking fields.
      const breakfastTotal = calculateBreakfastAddOn({
        hasBreakfast: finalHasBreakfast,
        breakfastRate: actualBreakfastRate,
        numGuests: guests,
        numAdults,
        numChildren,
        numNights,
        breakfastIncludesChildren
      });
      // Per EXB-01 (2026-07-31): the extra-bed add-on term.
      // `extraBedCount × extraBedRate × numNights` via the shared
      // `calculateExtraBedAddOn` helper. The rate was snapshotted
      // above from the room type, so a later rate change never
      // rewrites an existing bill. Per EXB-04: the extra occupant
      // is NOT counted toward breakfast — the extra bed is a
      // separate add-on line, not a breakfast multiplier.
      const extraBedTotal = calculateExtraBedAddOn({
        extraBedCount,
        extraBedRate,
        numNights
      });
      const subtotal = roomTotal + breakfastTotal + extraBedTotal;

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
            // Per DSC (2026-07-31): the percentage step and the clamped
            // `subtotal − senior` subtraction now route through the shared
            // `calculatePercentDiscount` + `calculateVoucherBase` helpers.
            // Byte-equivalent output: same `Math.round` wrap, same
            // `Math.max(..., 0)` clamp.
            const seniorPwdDiscountForVoucher = Math.round(calculatePercentDiscount(subtotal, discountPct));
            const voucherBase = calculateVoucherBase(subtotal, seniorPwdDiscountForVoucher);
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
      // Per DSC-01..05 (2026-08-01, per CVQ-06): the whole chain
      // now routes through the shared `calculateDiscountChain` helper
      // with the snapshotted per-class scope. The chain respects
      // the scope's per-class breakdown (room · breakfast · extra
      // bed) so the senior percentage, voucher cap, and member
      // percentage each see only the components their scope allows.
      // For the broad default scope (all-true) the chain is
      // byte-equivalent to the previous inline math. `round: true`
      // preserves the server's per-step `Math.round(...)` wrap.
      const { total: totalPrice } = calculateDiscountChain({
        roomTotal,
        breakfastTotal,
        extraBedTotal,
        seniorPct: discountPct,
        voucherAmount: voucherDiscount,
        memberPct: appliedMemberDiscountPct,
        scope: snapshottedDiscountScope,
        round: true
      });
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
        // Per EXB-08 (2026-08-01, per decision #156):
        // the extra-bed add-on term. The `addOns[]`
        // now includes both the breakfast line and
        // the extra-bed line, so the receipt PDF +
        // PriceBreakdown + email surfaces all
        // display the term. The label includes the
        // count when > 1 for natural reading on
        // multi-bed stays.
        extraBedTotal,
        extraBedCount: extraBedCount,
        extraBedRate: extraBedRate,
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
      // Per MRB-03 (2026-08-02, per decision #159): the
      // public reservation ref (`R-YYYYMMDD-NNNNN`) uses
      // the SAME counter as the booking ref — one counter
      // increment per create transaction, regardless of
      // how many rooms (N=1 today; the same pattern holds
      // for N>1 in MRB-06 Phase 2's booking write loop).
      // Sharing the counter with the booking ref means a
      // reservation and its booking have adjacent seq
      // numbers (a small "they belong together" affordance
      // for staff skimming the admin list) AND avoids a
      // second counter doc that would need the same
      // atomic-increment machinery. The 5-digit pad matches
      // the booking-ref widening from the H3 hardening
      // batch — same per-day namespace, same brute-force
      // ceiling. Captured at function scope so the
      // post-transaction success response can echo it
      // back. Same `finalReservationRef` pattern as the
      // walk-in path (line 3155) — both surfaces share the
      // counter, both mint in the same transaction, both
      // capture the value for the response.
      finalReservationRef = `R-${todayCompact}-${String(sequence).padStart(5, "0")}`;

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
        // Per CHD-01 (2026-08-01, per decision #144):
        // adults/children split. Server-validated
        // `numAdults + numChildren === guests` (CHD-04). The
        // booking stores both fields so the rate breakdown,
        // the booking drawer, the receipt PDF, and the
        // confirmation email can render the split (CHD-07
        // follow-up). `numGuests` is the persisted total
        // and remains the source of truth for every existing
        // read site — adding the split is additive.
        numAdults,
        numChildren,
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
        // Per PEX-01 (2026-08-01, per decision #147): the
        // snapshotted deadline. Computed from the admin's
        // `paymentHoldWindowHours` setting at the same `now`
        // captured at the top of the transaction, so the
        // deadline is byte-equivalent to whatever the cron
        // would later compute. `null` for `payment-uploaded`
        // bookings (staff-review state — never auto-expired,
        // per PEX-04) and for legacy callers that omit the
        // config. The cron + the create / walkin / reschedule
        // transactions all read this single field via
        // `isBookingOccupyingRoom`.
        holdExpiresAt: (paymentProofPath || paymentProofUrl)
          ? null
          : (computeHoldExpiresAt(hotelConfig.paymentHoldWindowHours, now)
            ? Timestamp.fromDate(computeHoldExpiresAt(hotelConfig.paymentHoldWindowHours, now) as Date)
            : null),
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
        // Per CHD-10 (2026-07-31, per CVQ-01): the snapshotted
        // "include children in breakfast" flag. Written to the
        // booking doc so a later policy change never rewrites an
        // existing bill. Math consumers (the helper, the receipt
        // PDF, the rate breakdown) read this field.
        breakfastIncludesChildren: finalHasBreakfast ? breakfastIncludesChildren : false,
        // Per EXB-01 (2026-07-31): the snapshotted extra-bed
        // count + rate. `extraBedRate` is the room-type rate
        // snapshotted at booking time so a later rate change never
        // rewrites an existing bill. Absent fields normalize to 0
        // on read.
        extraBedCount,
        extraBedRate,
        // Per DSC-01..05 (2026-08-01, per CVQ-06): the snapshotted
        // per-class discount scope at create time. Re-read on
        // reschedule / discount rejection so a later admin scope
        // change never rewrites an existing bill. The scope is
        // always written (the helper fills in the broad default
        // for legacy settings), so the field is never `undefined`
        // for bookings created after this change.
        discountScopeSnapshot: snapshottedDiscountScope,
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
        // Per MRB-02 (2026-08-02, per decision #159): the
        // reservation header linkage. `reservationId` is
        // the pre-allocated (or server-minted) UUID; the three
        // compatibility copies are denormalized projections
        // for fast admin search/display (per the decision
        // table "Mint one public `reservationRef` per
        // reservation and denormalize it onto child bookings
        // for existing admin search/display compatibility").
        // Per MRB-06 (2026-08-02, per decision #159): the
        // N>1 generalization. `reservationPosition: 1`
        // is this specific room's position in the
        // assigned-rooms list (the first room, 1 of N);
        // `reservationRoomCount` is the total number of
        // rooms in the reservation. The N booking docs
        // are written in a loop below — each carries
        // its own position (1..N). For N=1 (the default)
        // this is byte-equivalent to the pre-MRB-06
        // `reservationRoomCount: 1`.
        reservationId: effectiveReservationId,
        reservationRef: finalReservationRef,
        reservationPosition: 1,
        reservationRoomCount: assignedRooms.length,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Per MRB-02 (2026-08-02, per decision #159): create
      // the reservation header in the SAME transaction as the
      // child booking. The header owns the public ref + the
      // lead booker + the source/corporate context + the
      // payment proof/state + the consent + the group totals
      // + the snapshotted discount scope + the unified PEX
      // hold + the canonical request fingerprint. Group
      // totals are populated by the child write below; the
      // MRB-04 folio migration is a follow-up. The header's
      // `paymentStatus` is derived from the child's status
      // ("awaiting-payment" while the child is `pending` or
      // `payment-uploaded`).
      const newReservation = {
        id: effectiveReservationId,
        reservationRef: finalReservationRef,
        leadGuestName: guestName,
        leadGuestEmail: guestDetails.email.trim().toLowerCase(),
        leadGuestPhone: guestDetails.phone.trim(),
        memberId: detectedMemberId || null,
        checkIn: Timestamp.fromDate(checkInDate),
        checkOut: Timestamp.fromDate(checkOutDate),
        numNights,
        // Per MRB-06 Phase 2 (2026-08-02, per decision
        // #159): the N>1 group totals. For N=1 (the
        // default) `assignedRooms.length` is 1, so the
        // header's `totalPrice` + `originalSubtotal` +
        // `subtotal` are byte-equivalent to the
        // pre-MRB-06 single-room values. For N>1 the
        // header aggregates the N per-room totals
        // (the per-type math is the same for every
        // room of the same `roomType` + same dates +
        // same guest inputs, so the sum is
        // `roomCount * per-room value`).
        originalSubtotal: totalPrice * assignedRooms.length,  // MRB-04: the proper originalSubtotal computation
        discountScopeSnapshot: snapshottedDiscountScope,
        subtotal: totalPrice * assignedRooms.length,          // MRB-04: the proper subtotal after add-on math
        totalPrice: totalPrice * assignedRooms.length,
        source: corporateDetails.isCorporate ? "corporate" : "online",
        isCorporate: corporateDetails.isCorporate,
        corporateCode: corporateDetails.corporateCode,
        companyName: corporateDetails.companyName,
        voucherCode: appliedVoucherCode,
        memberDiscountPct: appliedMemberDiscountPct,
        paymentStatus: (paymentProofPath || paymentProofUrl) ? "payment-uploaded" : "awaiting-payment",
        paymentMethod,
        paymentProofUrl: paymentProofUrl || null,
        paymentProofPath: paymentProofPath || null,
        termsAccepted: true,
        termsAcceptedAt: now,
        termsVersion: termsConsentVersion,
        privacyAccepted: true,
        privacyAcceptedAt: now,
        privacyVersion: termsConsentVersion,
        roomCount: 1,                  // MRB-06: matches the room-line count for N>1
        activeRoomCount: 1,
        cancelledRoomCount: 0,
        checkedInRoomCount: 0,
        checkedOutRoomCount: 0,
        holdExpiresAt: (newBooking as any).holdExpiresAt
          ? (newBooking as any).holdExpiresAt
          : null,
        requestFingerprint: reservationRequestFingerprint,
        createdAt: now,
        updatedAt: now,
        createdBy: "guest"
      };
      transaction.set(reservationDocRef, newReservation);
      // Per MRB-06 Phase 2 (2026-08-02, per decision #159):
      // the N>1 booking write loop. For each assigned
      // room, write a `bookings/{id}` doc with per-room
      // `roomId` + `roomNumber` + `reservationPosition`
      // (1..N). The first room uses the client's
      // preallocated `bookingId`; the other N-1 rooms
      // auto-mint fresh ids (the `adminDb.collection("bookings").doc().id`
      // pattern — same shape as the walk-in path's
      // `generateReservationId` auto-mint, but the
      // client doesn't preallocate the booking ids for
      // the additional rooms in this iteration; a
      // follow-up can switch the client to
      // preallocating N ids once the N>1 client
      // surface lands). The per-type fields
      // (totalPrice, rateBreakdown, holdExpiresAt,
      // etc.) are the SAME for all rooms of the
      // same `roomType` + same dates + same guest
      // inputs — the spread of `newBooking` carries
      // the per-type fields, and the per-room fields
      // are overridden in the loop body. For N=1
      // (the default) the loop runs once with
      // `i = 0`, byte-equivalent to the pre-MRB-06
      // single write to `bookingDocRef = newBooking`.
      const bookingWriteRefs: Array<{ ref: FirebaseFirestore.DocumentReference; data: any }> = [];
      for (let bookingIdx = 0; bookingIdx < assignedRooms.length; bookingIdx++) {
        const assignedRoomForBooking = assignedRooms[bookingIdx];
        // Auto-mint the booking id for rooms 2..N.
        // The first room uses the client's preallocated
        // id (the historical contract). When the client
        // upgrades to preallocating N ids (a follow-up
        // for the N>1 client surface), this becomes a
        // `body.bookingIds[bookingIdx]` lookup.
        const bookingIdForThisRoom = bookingIdx === 0
          ? bookingId
          : adminDb.collection("bookings").doc().id;
        const perRoomBookingDocRef = adminDb.collection("bookings").doc(bookingIdForThisRoom);
        bookingWriteRefs.push({
          ref: perRoomBookingDocRef,
          data: {
            ...newBooking,
            // Per-room fields. `roomId` + `roomNumber`
            // are the assigned room's data; the
            // `reservationPosition` is the 1-indexed
            // position in the assigned-rooms list;
            // `reservationRoomCount` is the total N
            // (same for every booking doc in the
            // reservation — the room count is a
            // reservation-level aggregate, not a
            // per-room field).
            roomId: assignedRoomForBooking.id,
            roomNumber: String(assignedRoomForBooking.data.roomNumber || ""),
            reservationPosition: bookingIdx + 1,
            reservationRoomCount: assignedRooms.length,
            // Per-booking lookup token. The
            // pre-MRB-02 code generated a single
            // token per booking; for N>1 each
            // booking doc gets its own token (so
            // each magic link works independently).
            // A future MRB-04 follow-up can
            // refactor to a per-reservation token
            // (one magic link for the whole group,
            // resolving to the reservation header
            // first).
            lookupToken: generateLookupToken()
          }
        });
      }
      for (const { ref: writeRef, data: writeData } of bookingWriteRefs) {
        transaction.set(writeRef, writeData);
      }
      // Per PEX-05 (2026-08-01, per decision #147): capture
      // the snapshotted deadline for the post-transaction
      // response payload + the booking-submitted email. The
      // field is a Timestamp on the doc; we convert to a Date
      // for the wire (the create handler already does this for
      // `checkIn` / `checkOut`).
      if (newBooking && (newBooking as any).holdExpiresAt) {
        const he = (newBooking as any).holdExpiresAt;
        bookingHoldExpiresAt = he instanceof Date ? he : (he.toDate ? he.toDate() : null);
      }
      // Per PEX-03 (2026-08-01, per decision #147): atomically
      // retire every expired `pending` hold that overlapped with
      // the new booking's date range. The retirement is part of
      // the same Firestore transaction so a partial failure
      // cannot leave an expired hold in the booking's room. The
      // expiry email (PEX-05) is sent from the post-transaction
      // path below — the same loop that writes the success
      // email also queues the per-expired-hold `booking-expired`
      // notification.
      for (const retirement of expiredHoldRetirements) {
        transaction.update(retirement.ref, {
          status: "cancelled",
          cancellationReason: EXPIRED_HOLD_CANCELLATION_REASON,
          // Per CRL-02 (2026-08-02): the in-transaction retirement
          // is a server-initiated cancellation, so the audit
          // metadata is `cancelledBy: "system"` +
          // `cancellationSource: "system"`. The canonical
          // EXPIRED_HOLD_CANCELLATION_REASON stays as the reason
          // string — CRL-02 adds the parallel discriminator, it
          // does not replace the existing one. Reports + emails
          // can switch on either field.
          cancelledBy: "system",
          cancellationSource: "system",
          cancelledAt: now,
          updatedAt: now
        });
      }

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
        paymentMethod,
        // Per PEX-05 (2026-08-01, per decision #147): the email
        // template renders "Held until X (hotel-local time)" from
        // this field. `null` for `payment-uploaded` bookings
        // (staff-review state — no auto-expiry).
        holdExpiresAt: bookingHoldExpiresAt
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

    // Per PEX-05 (2026-08-01, per decision #147): fire a
    // `booking-expired` email for each `pending` hold this
    // create transaction retired in-transaction. Best-effort,
    // outside the transaction (a failed email never rolls back
    // the retirement). The email template reuses the same
    // `booking-cancelled` template the existing
    // `handleCancelBooking` flow uses; the difference is the
    // `cancellationReason` field, which carries the
    // `payment-hold-expired` reason string so the guest sees
    // a rebook path.
    for (const retirement of expiredHoldRetirements) {
      if (!retirement.guestEmail) continue;
      try {
        await sendBookingTrigger("booking-cancelled", {
          bookingRef: retirement.bookingRef,
          guestEmail: retirement.guestEmail,
          // The staff-readable "Expired hold — rebook at /book"
          // copy comes from the email template; the
          // `cancellationReason` is the discriminator the
          // template uses to switch the headline.
          source: "online",
          notes: "Held until " + (retirement.holdExpiresAt ? retirement.holdExpiresAt.toISOString() : "unknown")
            + " — your reservation has been released. Please rebook at /book to choose new dates."
        });
      } catch (expiredEmailErr) {
        console.error("Failed to send booking-expired email for", retirement.bookingRef, expiredEmailErr);
      }
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
        // Per MRB-02 (2026-08-02, per decision #164): the
        // canonical reservation id (client-preallocated or
        // auto-minted) and the public reservation ref.
        // Surfaced so the confirmation page can deep-link to
        // `/manage?reservation=<id>` and the corporate
        // confirmation step can render the group ref
        // alongside the child booking ref. The shape mirrors
        // `alreadyExistingBookingResponse` so the client
        // gets the same fields whether the call is a fresh
        // create or a reservation-level replay.
        reservationId: effectiveReservationId,
        reservationRef: finalReservationRef,
        idempotentReplay: false,
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
        roomType,
        // Per MRB-06 Phase 2 (2026-08-02, per decision
        // #159): the N>1 response shape. The first
        // room's id + number are echoed in the legacy
        // fields (`roomId` + `roomNumber`) for
        // backward compat with the N=1 confirmation
        // page. The `rooms` array carries ALL N
        // assignments (id + number + position per
        // room) so the N>1 confirmation can render
        // the full group view. For N=1 (the default)
        // `rooms` is a single-element array —
        // byte-equivalent to the pre-MRB-06 single
        // fields.
        rooms: (typeof bookingWriteRefs === "undefined" ? [] : bookingWriteRefs).map((w, idx) => {
          const r = assignedRooms[idx];
          return {
            bookingId: w.ref.id,
            roomId: r.id,
            roomNumber: String(r.data.roomNumber || ""),
            reservationPosition: idx + 1
          };
        }),
        // Per PEX-05 (2026-08-01, per decision #147): the
        // snapshotted deadline. `null` for `payment-uploaded`
        // bookings (no auto-expiry, staff-review state). The
        // confirmation page renders "Held until X" so the
        // guest knows the exact local time the hold lapses.
        holdExpiresAt: bookingHoldExpiresAt
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
      // Per MRB-02 (2026-08-02, per decision #164): the client
      // preallocated a `reservationId` that already carries a
      // *different* request fingerprint. The reservation header
      // is canonical for idempotency, so a re-use of the same id
      // with a different request is a conflict — the client
      // surfaces it as "duplicate reservation id with different
      // request, please generate a new one". 409 keeps the
      // booking from being retried with the stale id.
      error.message === "RESERVATION_ID_FINGERPRINT_CONFLICT"
    ) {
      status = 409;
    } else if (
      // Per MRB-02 (2026-08-02, per decision #164): the
      // reservation header exists but the child booking does
      // not — a partially-applied create. We refuse to recover
      // it from this request (a half-stamped booking would
      // break audit invariants). 500 surfaces the bug to staff
      // and signals the client to abandon the reservation id.
      error.message === "RESERVATION_HEADER_WITHOUT_CHILD"
    ) {
      status = 500;
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
    // Per CHD-10: walk-ins are staff-created. The breakfast toggle
    // is snapshotted from the admin default (no per-booking override
    // on the walk-in surface).
    breakfastIncludesChildren: requestedBreakfastIncludesChildren,
    // Per EXB-01: extra-bed count. Optional — walk-in defaults to
    // 0 when absent. Bounded by the room type's `maxExtraBeds`.
    extraBedCount: requestedExtraBedCount,
    // Per CHD-01 (2026-08-01, per decision #144): same
    // adult/child split on the walk-in surface as on the
    // public create. The schema defaults to absent →
    // all adults. Server derives the split + validates the
    // derived total against `guests` (CHD-04).
    numAdults: requestedNumAdults,
    numChildren: requestedNumChildren,
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
    testRunId: requestedTestRunId,
    // Per MRB-02.x (2026-08-02, per decision #164): the
    // optional client-preallocated `reservationId`. Walk-in
    // callers don't currently preallocate, so the server
    // auto-mints a UUIDv4 via `generateReservationId()` —
    // the same pattern as the public `/api/bookings/create`
    // path. When present, the server uses it as the
    // canonical idempotency key for the create transaction.
    reservationId: requestedReservationId
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

  // Per PEX-01 + PEX-03 (2026-08-01, per decision #147): the
  // same retirement list pattern as handleCreateBooking.
  // Walk-ins are exempt from the guest-side hold window
  // (the staff is creating the booking, not waiting on a
  // guest action), so the new walk-in booking has no
  // `holdExpiresAt` — the only retirements that can happen
  // here are for stale expired holds on the same room
  // (a guest abandoned booking that was never cleaned up
  // by the cron and the front desk now needs the room).
  const expiredHoldRetirements: Array<{ ref: FirebaseFirestore.DocumentReference; previousData: any; bookingRef: string; guestEmail: string; holdExpiresAt: Date | null }> = [];

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
    // Per MRB-02.x (2026-08-02, per decision #164): the
    // canonical reservation id for this walk-in create.
    // The walk-in modal doesn't currently preallocate a
    // `reservationId`, so the server auto-mints one (same
    // pattern as the public `/api/bookings/create` path).
    // The walk-in flow gets the same idempotency matrix
    // (replay / 409 / 500) on the same `reservationId` +
    // `requestFingerprint` anchor; for walk-in the
    // replay is rarely hit (staff re-submits generate a
    // fresh `bookingId`, so the auto-mint `reservationId`
    // also changes), but the contract is symmetric with
    // the public path.
    const effectiveReservationId: string = (requestedReservationId && RESERVATION_ID_REGEX.test(requestedReservationId))
      ? requestedReservationId
      : generateReservationId();
    const reservationDocRef = adminDb.collection("reservations").doc(effectiveReservationId);
    let finalReservationRef = "";
    let newBooking: Record<string, any> | null = null;

    await adminDb.runTransaction(async (transaction) => {
      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      // 1. Fetch Room Details. Read FIRST (before the
      // reservation read) so the walk-in fingerprint has
      // `roomData.type` available — the fingerprint's
      // `type` field is the room's type label, not the
      // roomId. The room doc also enforces the standard
      // "is active" + "is blocked" gates the public
      // create uses; failures here throw the canonical
      // errors the catch block already maps.
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
      // 2. Per MRB-02.x (2026-08-02, per decision #164):
      // the reservation-level idempotency check runs
      // after the room read (so the fingerprint has the
      // room type) and before the booking doc read (so
      // the canonical idempotency anchor is the
      // reservation, not the booking). Walk-in callers
      // don't currently preallocate `reservationId`, so
      // the auto-mint means each request gets a fresh
      // id — the conflict path is theoretically
      // unreachable from the desk UI, but the contract
      // is symmetric with the public path so a future
      // walk-in client that does preallocate rides the
      // same idempotency.
      const existingReservationSnap = await transaction.get(reservationDocRef);
      if (existingReservationSnap.exists) {
        const existingData = existingReservationSnap.data() || {};
        // Compute the per-walk-in fingerprint from the
        // room's type + the body inputs. The walk-in
        // fingerprint is the same canonical shape as the
        // public path — same byte-equivalence rules, same
        // placeholder for `discountScope` (the
        // server-resolved DSC-01 scope is the MRB-04
        // generalization; the walk-in snapshot reads the
        // same `normalizeDiscountScope(null)` shape so a
        // replay is byte-equivalent).
        const walkinFingerprint = computeRequestFingerprint({
          reservationId: effectiveReservationId,
          roomLines: [{
            type: String(roomData.type || "").trim(),
            quantity: 1,
            adults: Math.max(0, Math.floor(Number(requestedNumAdults ?? guests) || 0)),
            children: Math.max(0, Math.floor(Number(requestedNumChildren ?? 0) || 0)),
            extraBeds: Math.max(0, Math.floor(Number(requestedExtraBedCount ?? 0) || 0))
          }],
          checkIn: String(checkIn || "").trim(),
          checkOut: String(checkOut || "").trim(),
          leadGuestName: `${String((guestDetails as any).firstName || "").trim()} ${String((guestDetails as any).lastName || "").trim()}`,
          leadGuestEmail: String((guestDetails as any).email || "").trim().toLowerCase(),
          leadGuestPhone: String((guestDetails as any).phone || "").trim(),
          source: "walk-in",
          isCorporate: false,
          corporateCode: "",
          companyName: "",
          voucherCode: String(requestedVoucherCode || "").trim().toUpperCase(),
          memberDiscountPct: 0,
          discountScope: normalizeDiscountScope(null),  // server-resolved DSC-01 scope lands in MRB-04
          termsVersion: DEFAULT_TERMS_VERSION,
          privacyVersion: DEFAULT_TERMS_VERSION
        });
        const sameRequest = String(existingData.requestFingerprint || "") === walkinFingerprint;
        if (!sameRequest) {
          throw new Error("RESERVATION_ID_FINGERPRINT_CONFLICT");
        }
        // Idempotent replay: same id + same fingerprint +
        // child exists. Build a response shape from the
        // existing docs and short-circuit. The walk-in
        // caller doesn't need the full fresh-create
        // payload (room assignment + rate breakdown); the
        // legacy fields + the reservation linkage are
        // sufficient.
        const existingChildSnap = await transaction.get(bookingDocRef);
        if (existingChildSnap.exists) {
          const existingChild = existingChildSnap.data() || {};
          newBooking = {
            ...(existingChild as any),
            bookingId,
            reservationId: String(existingData.id || effectiveReservationId),
            reservationRef: String(existingData.reservationRef || ""),
            idempotentReplay: true
          };
          finalBookingRef = String(existingChild.bookingRef || "");
          finalTotalPrice = Number(existingChild.totalPrice || 0);
          finalReservationRef = String(existingData.reservationRef || "");
          return;
        }
        throw new Error("RESERVATION_HEADER_WITHOUT_CHILD");
      }
      // 3. Per LR-C1: Firestore requires all transaction
      // reads before writes. The booking doc read is the
      // legacy "Booking already exists" guard — defensive
      // only. Walk-in callers don't currently preallocate
      // `reservationId`, so a collision here is effectively
      // impossible (each request gets a fresh
      // auto-minted id), but the guard stays so a future
      // caller that preallocates a stable `bookingId` AND
      // a fresh `reservationId` doesn't accidentally
      // double-write.
      const existingWalkin = await transaction.get(bookingDocRef);
      if (existingWalkin.exists) {
        throw new Error("Booking already exists");
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
      const rawTypeEntry = roomTypesArr.find((entry) => entry && entry.value === roomData.type);
      if (!rawTypeEntry) {
        throw new Error("Room type is not available.");
      }
      const typeEntry = applyRoomTypeDefaults(rawTypeEntry);

      // Per DSC-01..05 (2026-08-01, per CVQ-06): snapshot the admin's
      // per-class discount scope at booking time (same pattern as
      // `handleCreateBooking`). Legacy settings without the field
      // read as the broad default via `normalizeDiscountScope`.
      const snapshottedDiscountScope = normalizeDiscountScope(hotelConfig.discountScope);
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

      // Per CHD-01 + CHD-04 (2026-08-01, per decision #144):
      // walk-ins are staff-created, so the adult/child split
      // is staff-supplied (or absent → all adults). Same
      // validation as handleCreateBooking: derive
      // `numAdults + numChildren === guests`, then check
      // each against the room type's `maxCapacity` (adult)
      // and `maxChildren` (per-CHD-02). The new walk-in
      // booking stores both fields on the doc.
      const walkinNumAdults = Number.isFinite(Number(requestedNumAdults))
        ? Math.max(0, Math.floor(Number(requestedNumAdults)))
        : guests;
      const walkinNumChildren = Number.isFinite(Number(requestedNumChildren))
        ? Math.max(0, Math.floor(Number(requestedNumChildren)))
        : 0;
      if (walkinNumAdults + walkinNumChildren !== guests) {
        throw new Error(
          `Occupancy split mismatch: numAdults (${walkinNumAdults}) + numChildren (${walkinNumChildren}) must equal guests (${guests}).`
        );
      }
      const walkinMaxChildren = Math.max(0, Number(typeEntry.maxChildren) || 0);
      // Per EXB-03 (2026-08-01, per decision #145): the
      // two independent hard rejects that CHD-04 wrote
      // (`numChildren > maxChildren` + the implicit
      // `numAdults > maxCapacity`) are subsumed by the
      // single overflow check below. When
      // `walkinExtraBedCount === 0`, the rule naturally
      // enforces both hard caps. When
      // `walkinExtraBedCount > 0`, the rule allows
      // overflow up to the extra bed count (each extra
      // bed can serve 1 extra person — adult or child).
      // The check is hoisted to right after the
      // `walkinExtraBedCount` validation so both reads
      // are in the same scope.

      // 2. Overlapping Booking Check
      const bookingsQuery = adminDb.collection("bookings")
        .where("roomId", "==", roomId)
        .where("status", "in", ROOM_OCCUPYING_STATUSES);
      const bookingsSnapshot = await transaction.get(bookingsQuery);
      // Per PEX-02 + PEX-03 (2026-08-01, per decision #147):
      // same pattern as handleCreateBooking — split each
      // conflicting doc into "active conflict" vs "expired
      // `pending` hold to retire". A walk-in that displaces a
      // stale expired hold is a real-world case the cron may
      // not have caught yet (e.g. a `payment-hold-expired`
      // hold from yesterday that nobody's cron has processed).
      const now = new Date();
      let sawConflict = false;
      let sawLingering = false;
      for (const doc of bookingsSnapshot.docs) {
        const bookingData = doc.data();
        if (isExpiredPendingHold(bookingData, now)) {
          const existingCheckIn = toDateOrNull(bookingData.checkIn);
          const existingCheckOut = toDateOrNull(bookingData.checkOut);
          const dateOverlaps = existingCheckIn && existingCheckOut
            ? rangesOverlap(existingCheckIn, existingCheckOut, checkInDate, checkOutDate)
            : false;
          if (dateOverlaps) {
            expiredHoldRetirements.push({
              ref: doc.ref,
              previousData: bookingData,
              bookingRef: String(bookingData.bookingRef || doc.id),
              guestEmail: String(bookingData.guestEmail || ""),
              holdExpiresAt: toDateOrNull(bookingData.holdExpiresAt)
            });
          }
          continue;
        }
        const reason = getOccupancyConflictReason({
          bookingData,
          requestedCheckIn: checkInDate,
          requestedCheckOut: checkOutDate,
          requestedCheckInKey: checkIn,
          todayKey,
          currentMinutes: currentManilaMinutes,
          checkOutTime: hotelConfig.checkOutTime,
          now
        });
        if (reason === "overlap" || reason === "lingering-checked-in") {
          if (reason === "lingering-checked-in") sawLingering = true;
          sawConflict = true;
          break;
        }
      }
      const hasConflict = sawConflict;

      if (hasConflict) {
        throw new Error(sawLingering ? ROOM_NOT_READY_PREVIOUS_GUEST_ERROR : "Room no longer available");
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
      // Per CHD-10 (2026-07-31, per CVQ-01): walk-ins are
      // staff-created, so the per-booking override is not
      // surfaced on the UI; the admin default from
      // `settings/breakfastConfig.breakfastIncludesChildrenDefault`
      // applies. `true` is the safe fallback. (Walk-in also covers
      // the corporate inquiry conversion — same staff surface.)
      const breakfastIncludesChildrenDefault = breakfastConfig.breakfastIncludesChildrenDefault !== false;
      const breakfastIncludesChildren = breakfastIncludesChildrenDefault;

      // Per EXB-01 (2026-07-31): extra-bed count + rate for the
      // walk-in (which also covers the corporate inquiry
      // conversion — same staff surface). Staff-created, so the
      // extra-bed count comes from the body (validated against
      // the room type's `maxExtraBeds`). The rate is snapshotted.
      const walkinExtraBedCount = Math.max(0, Number(requestedExtraBedCount) || 0);
      const walkinTypeMaxExtraBeds = Math.max(0, Number(typeEntry.maxExtraBeds) || 0);
      const walkinTypeExtraBedRate = Math.max(0, Number(typeEntry.extraBedRate) || 0);
      if (walkinExtraBedCount > walkinTypeMaxExtraBeds) {
        throw new Error(
          `Extra bed count (${walkinExtraBedCount}) exceeds the room type's allowance (${walkinTypeMaxExtraBeds}).`
        );
      }
      const walkinExtraBedRate = walkinExtraBedCount > 0 ? walkinTypeExtraBedRate : 0;
      // Per EXB-03 (2026-08-01, per decision #145): the
      // overflow rule. Same shape as handleCreateBooking.
      // `requiredExtraBedsFor` returns the number of
      // extra people beyond the per-type cap, split into
      // adult and child overflows. The check rejects
      // when the required overflow exceeds the selected
      // extra bed count. When
      // `walkinExtraBedCount === 0`, the helper reduces
      // to the two hard caps (CHD-04's original shape);
      // when `> 0`, the rule allows overflow up to the
      // extra bed count. See the JSDoc on
      // `requiredExtraBedsFor` in `shared/utils/roomTypes.ts`.
      const walkinOverflow = requiredExtraBedsFor({
        numAdults: walkinNumAdults,
        numChildren: walkinNumChildren,
        maxCapacity: typeMaxCapacity,
        maxChildren: walkinMaxChildren
      });
      if (walkinOverflow.requiredExtraBeds > walkinExtraBedCount) {
        throw new Error(
          `Not enough extra beds: ${walkinOverflow.overflowAdults} overflow adult(s) + ${walkinOverflow.overflowChildren} overflow child(ren) = ${walkinOverflow.requiredExtraBeds} extra bed(s) needed, but only ${walkinExtraBedCount} extra bed(s) selected. The room type allows up to ${walkinTypeMaxExtraBeds} extra bed(s).`
        );
      }

      // Per EXB-10 (2026-08-01, per decision #157): the
      // hotel-wide rollaway-bed inventory check. Same
      // shape as `handleCreateBooking` — the query is a
      // single `where("status", "in", ...)` filtered
      // in-memory by the helper, the cap check is a
      // single `checkExtraBedInventory` call. `0
      // inventory` short-circuits to `ok: true` so
      // legacy + freshly bootstrapped projects get the
      // historical "any number" behavior for free. The
      // query skips the "current booking" exclusion —
      // `handleCreateWalkin` is a new booking, so there
      // is no prior `extraBedCount` to subtract.
      if (walkinExtraBedCount > 0) {
        const walkinExtraBedOverlapQuery = adminDb.collection("bookings")
          .where("status", "in", ROOM_OCCUPYING_STATUSES);
        const walkinExtraBedOverlapSnapshot = await transaction.get(walkinExtraBedOverlapQuery);
        const walkinExtraBedInUse = countExtraBedsInUse(
          walkinExtraBedOverlapSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
          checkInDate,
          checkOutDate
        );
        const walkinInventoryResult = checkExtraBedInventory(
          Math.max(0, Number(hotelConfig.extraBedInventory) || 0),
          walkinExtraBedInUse,
          walkinExtraBedCount
        );
        if (!walkinInventoryResult.ok) {
          throw new Error(
            `Not enough extra beds: ${walkinExtraBedInUse} already booked across overlapping stays + ${walkinExtraBedCount} requested = ${walkinExtraBedInUse + walkinExtraBedCount}, but the hotel only has ${hotelConfig.extraBedInventory} rollaway bed(s) in inventory.`
          );
        }
      }

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
      // Per CHD-10 (2026-07-31, per CVQ-01): the inline
      // `actualBreakfastRate * guests * numNights` pattern now
      // routes through the shared `calculateBreakfastAddOn` helper.
      // The walk-in path snapshots the admin default (no
      // per-booking override on this surface — staff-created).
      const breakfastTotal = calculateBreakfastAddOn({
        hasBreakfast: finalHasBreakfast,
        breakfastRate: actualBreakfastRate,
        numGuests: guests,
        numNights,
        breakfastIncludesChildren
      });
      // Per EXB-01 (2026-07-31): the extra-bed add-on term for the
      // walk-in. Same shape as the online-create path.
      const walkinExtraBedTotal = calculateExtraBedAddOn({
        extraBedCount: walkinExtraBedCount,
        extraBedRate: walkinExtraBedRate,
        numNights
      });
      const subtotal = roomTotal + breakfastTotal + walkinExtraBedTotal;

      const discountType = requestedDiscountType === "senior" || requestedDiscountType === "pwd"
        ? requestedDiscountType
        : "";
      const discountPct = discountType ? 20 : 0;
      const pricingSubtotal = totalPriceOverride !== undefined && totalPriceOverride !== null
        ? Number(totalPriceOverride)
        : subtotal;
      // Per DSC-01..05 (2026-08-01, per CVQ-06): the voucher's
      // base now routes through the shared `calculateVoucherBase`
      // helper. The chain math (senior + voucher) below also
      // routes through the shared `calculateDiscountChain` helper
      // so the walk-in respects the snapshotted scope. The
      // walk-in has no member step (staff-created, no auth token),
      // so `memberPct: 0` and the chain's `memberDeduction` is
      // always 0 — byte-equivalent to the previous inline `finalTotal
      // = max(voucherBase − voucherDiscount, 0)`. When a manual
      // `totalPriceOverride` is set, the override collapses the
      // room/breakfast/extra-bed breakdown into a single
      // `pricingSubtotal`; the chain treats it as the room term
      // with breakfast + extra-bed = 0, so a broad scope sees
      // the full pricingSubtotal as the discountable base (matching
      // the previous behavior). `round: true` preserves the
      // server's per-step `Math.round(...)` wrap.
      const seniorPwdDiscount = Math.round(calculatePercentDiscount(pricingSubtotal, discountPct));
      const voucherBase = calculateVoucherBase(pricingSubtotal, seniorPwdDiscount);
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

      // Pricing Overrides: Use staff override if provided, otherwise standard computed.
      // Per DSC-01..05 (2026-08-01, per CVQ-06): the walk-in's
      // senior + voucher chain now routes through the shared
      // `calculateDiscountChain` helper. For the broad default
      // scope, the helper's `total` is byte-equivalent to
      // `max(voucherBase − voucherDiscount, 0)`. When a manual
      // `totalPriceOverride` is in play, we pass the override
      // as the room term (breakfast + extra-bed = 0) so the
      // chain sees the override as the discountable base.
      const walkinChainInput = totalPriceOverride !== undefined && totalPriceOverride !== null
        ? {
            roomTotal: pricingSubtotal,
            breakfastTotal: 0,
            extraBedTotal: 0,
            seniorPct: discountPct,
            voucherAmount: voucherDiscount,
            memberPct: 0,
            scope: snapshottedDiscountScope,
            round: true
          }
        : {
            roomTotal,
            breakfastTotal,
            extraBedTotal: walkinExtraBedTotal,
            seniorPct: discountPct,
            voucherAmount: voucherDiscount,
            memberPct: 0,
            scope: snapshottedDiscountScope,
            round: true
          };
      finalTotalPrice = calculateDiscountChain(walkinChainInput).total;
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
        // Per EXB-08 (2026-08-01, per decision #156):
        // the walk-in also surfaces the extra-bed
        // add-on term. When `totalPriceOverride` is
        // set, the manual rate collapses the extra
        // bed into the room subtotal (the historical
        // manual-rate shape) — so the add-on line is
        // 0 in that path. When no override is set,
        // the per-type `walkinExtraBedTotal` flows
        // through to `addOns[]` exactly like the
        // online create path.
        extraBedTotal: totalPriceOverride !== undefined && totalPriceOverride !== null ? 0 : walkinExtraBedTotal,
        extraBedCount: walkinExtraBedCount,
        extraBedRate: walkinExtraBedRate,
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
      // Per MRB-02.x (2026-08-02, per decision #164): mint
      // the public reservation ref (`R-YYYYMMDD-NNNNN`) in
      // the same transaction so it shares the same `now` +
      // counter transaction as the booking ref. The walk-in
      // is always `position: 1` / `roomCount: 1` (single
      // room), so the per-day seq is whatever the counter
      // produced (the counter is global, not per-reservation).
      // Captured at function scope so the post-transaction
      // success response can echo it back.
      finalReservationRef = `R-${todayCompact}-${String(sequence).padStart(5, "0")}`;

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
        // Per CHD-01 (2026-08-01, per decision #144):
        // walk-in staff-created split. The schema accepts
        // the fields (validated inside the transaction to
        // `numAdults + numChildren === guests`), and the
        // booking doc stores both. The room type's
        // `maxChildren` is enforced inside the transaction
        // (CHD-04).
        numAdults: walkinNumAdults,
        numChildren: walkinNumChildren,
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
        // Per CHD-10 (2026-07-31, per CVQ-01): the snapshotted
        // "include children in breakfast" flag. Same shape as
        // the online-create path; walk-in + corporate inquiry
        // surfaces don't expose a per-booking override.
        breakfastIncludesChildren: finalHasBreakfast ? breakfastIncludesChildren : false,
        // Per EXB-01 (2026-07-31): the snapshotted extra-bed
        // count + rate for the walk-in (which also covers the
        // corporate inquiry conversion). Same shape as the
        // online-create path.
        extraBedCount: walkinExtraBedCount,
        extraBedRate: walkinExtraBedRate,
        // Per DSC-01..05 (2026-08-01, per CVQ-06): the snapshotted
        // per-class discount scope. Same shape as the online-create
        // path; legacy walk-ins without the field read as the broad
        // default on reschedule / discount rejection.
        discountScopeSnapshot: snapshottedDiscountScope,
        guestIdPhotoUrl: null,
        guestRegistration: null,
        breakfastSelections: {},
        cancellationReason: "",
        linkedInquiryId: linkedInquiryId || null,
        ...(validatedTestRunId
          ? { isTestData: true, testRunId: validatedTestRunId }
          : {}),
        // Per MRB-02.x (2026-08-02, per decision #164): the
        // reservation header linkage. Same shape as the
        // public path — `reservationId` is the
        // (auto-minted or preallocated) UUID, the three
        // compatibility copies are denormalized
        // projections for fast admin search/display. The
        // single-room walk-in case is `position: 1` /
        // `roomCount: 1`; MRB-06's N>1 generalization
        // will assign sequential positions.
        reservationId: effectiveReservationId,
        reservationRef: finalReservationRef,
        reservationPosition: 1,
        reservationRoomCount: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Per MRB-02.x (2026-08-02, per decision #164):
      // create the reservation header in the SAME
      // transaction as the child booking. The header owns
      // the public ref + the lead booker + the
      // source / corporate context + the money state (the
      // walk-in has no `pending` → `confirmed` flip — it
      // lands on `confirmed` or `checked-in` directly) +
      // the snapshotted discount scope + the request
      // fingerprint. The header's `paymentStatus`
      // reflects the child status at commit time
      // (`awaiting-payment` for `pending`, the resolved
      // status otherwise). Walk-in callers don't have a
      // member-from-Authorization-token path, so
      // `memberId: null` + `memberDiscountPct: 0` (same
      // shape as the public path's anonymous branch).
      const newReservation = {
        id: effectiveReservationId,
        reservationRef: finalReservationRef,
        leadGuestName: guestName,
        leadGuestEmail: guestDetails.email.trim().toLowerCase(),
        leadGuestPhone: guestDetails.phone.trim(),
        memberId: null,
        checkIn: Timestamp.fromDate(checkInDate),
        checkOut: Timestamp.fromDate(checkOutDate),
        numNights,
        originalSubtotal: pricingSubtotal,
        discountScopeSnapshot: snapshottedDiscountScope,
        subtotal: pricingSubtotal,
        totalPrice: finalTotalPrice,
        source: "walk-in",
        isCorporate: false,
        corporateCode: "",
        companyName: "",
        voucherCode,
        memberDiscountPct: 0,
        // Walk-in lands on `confirmed` or `checked-in`
        // directly (no `pending` hold). The header
        // mirrors the child's resolved status so a
        // future read doesn't have to fan out to every
        // child to derive the reservation-level money
        // state. `awaiting-payment` is reserved for the
        // `pending` child status the public create uses
        // — the walk-in never lands on that state, so
        // the header carries the resolved label
        // directly.
        paymentStatus: (status === "checked-in" ? "in-house" : "confirmed"),
        paymentMethod,
        paymentProofUrl: null,
        paymentProofPath: null,
        termsAccepted: true,
        termsAcceptedAt: now,
        termsVersion: DEFAULT_TERMS_VERSION,
        privacyAccepted: true,
        privacyAcceptedAt: now,
        privacyVersion: DEFAULT_TERMS_VERSION,
        roomCount: 1,
        activeRoomCount: 1,
        cancelledRoomCount: 0,
        checkedInRoomCount: status === "checked-in" ? 1 : 0,
        checkedOutRoomCount: status === "checked-out" ? 1 : 0,
        // Walk-ins have no auto-expiry hold (the staff is
        // creating the booking, not waiting on a guest
        // action) — `null` mirrors the public path's
        // `payment-uploaded` case.
        holdExpiresAt: null,
        requestFingerprint: computeRequestFingerprint({
          reservationId: effectiveReservationId,
          roomLines: [{
            type: String(roomData.type || "").trim(),
            quantity: 1,
            adults: Math.max(0, Math.floor(Number(requestedNumAdults ?? guests) || 0)),
            children: Math.max(0, Math.floor(Number(requestedNumChildren ?? 0) || 0)),
            extraBeds: Math.max(0, Math.floor(Number(requestedExtraBedCount ?? 0) || 0))
          }],
          checkIn: String(checkIn || "").trim(),
          checkOut: String(checkOut || "").trim(),
          leadGuestName: guestName,
          leadGuestEmail: guestDetails.email.trim().toLowerCase(),
          leadGuestPhone: guestDetails.phone.trim(),
          source: "walk-in",
          isCorporate: false,
          corporateCode: "",
          companyName: "",
          voucherCode: String(requestedVoucherCode || "").trim().toUpperCase(),
          memberDiscountPct: 0,
          discountScope: normalizeDiscountScope(null),
          termsVersion: DEFAULT_TERMS_VERSION,
          privacyVersion: DEFAULT_TERMS_VERSION
        }),
        createdAt: now,
        updatedAt: now,
        createdBy: "staff"
      };
      transaction.set(reservationDocRef, newReservation);

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
      // Per PEX-03 (2026-08-01, per decision #147): same
      // in-transaction retirement as handleCreateBooking. The
      // walk-in covers a corner case the cron may not have
      // processed yet (a stale expired hold from yesterday),
      // so the walk-in handler can move first.
      for (const retirement of expiredHoldRetirements) {
        transaction.update(retirement.ref, {
          status: "cancelled",
          cancellationReason: EXPIRED_HOLD_CANCELLATION_REASON,
          // Per CRL-02 (2026-08-02): the in-transaction retirement
          // is a server-initiated cancellation, so the audit
          // metadata is `cancelledBy: "system"` +
          // `cancellationSource: "system"`. The canonical
          // EXPIRED_HOLD_CANCELLATION_REASON stays as the reason
          // string — CRL-02 adds the parallel discriminator, it
          // does not replace the existing one. Reports + emails
          // can switch on either field.
          cancelledBy: "system",
          cancellationSource: "system",
          cancelledAt: now,
          updatedAt: now
        });
      }
    });

    const resolvedStatus = status || "confirmed";
    if (resolvedStatus === "confirmed" && newBooking) {
      try {
        await sendBookingTrigger("booking-confirmed", { ...newBooking, status: "confirmed" });
      } catch (emailErr) {
        console.error("Failed to send walk-in booking confirmation email:", emailErr);
      }
    }

    // Per PEX-05 (2026-08-01, per decision #147): same
    // per-retirement email send as handleCreateBooking. Best-effort,
    // outside the transaction. A walk-in that displaces a stale
    // expired hold should still email the original guest so they
    // know the hold lapsed (the email carries the rebook path).
    for (const retirement of expiredHoldRetirements) {
      if (!retirement.guestEmail) continue;
      try {
        await sendBookingTrigger("booking-cancelled", {
          bookingRef: retirement.bookingRef,
          guestEmail: retirement.guestEmail,
          source: "online",
          notes: "Held until " + (retirement.holdExpiresAt ? retirement.holdExpiresAt.toISOString() : "unknown")
            + " — your reservation has been released. Please rebook at /book to choose new dates."
        });
      } catch (expiredEmailErr) {
        console.error("Failed to send walk-in retired-hold email for", retirement.bookingRef, expiredEmailErr);
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
        // Per MRB-02.x (2026-08-02, per decision #164):
        // echo the reservation linkage in the walk-in
        // success payload. Symmetric with the public
        // path so a future walk-in modal that wants to
        // display the group ref / open the booking in
        // the admin view can deep-link to
        // `/manage?reservation=<id>`. The replay path
        // (set inside the transaction) carries
        // `idempotentReplay: true`; the fresh create
        // path stamps `false`.
        reservationId: effectiveReservationId,
        reservationRef: finalReservationRef,
        idempotentReplay: Boolean((newBooking as any)?.idempotentReplay),
        totalPrice: finalTotalPrice,
        rateBreakdown: newBooking?.rateBreakdown ?? null
      }
    });

  } catch (error: any) {
    console.error("Walk-in booking creation failed:", error);
    // Per MRB-02.x (2026-08-02, per decision #164):
    // symmetric with `handleCreateBooking` — the same
    // reservation-level error mappings. The walk-in's
    // conflict path is theoretically unreachable from
    // the desk UI (walk-in callers don't currently
    // preallocate `reservationId`, so each request
    // auto-mints a fresh id), but the contract is
    // symmetric with the public path so a future
    // walk-in client that does preallocate rides the
    // same idempotency.
    const errorMessage = typeof error?.message === "string" ? error.message : "";
    let status: number;
    if (
      errorMessage === "Room no longer available"
      || errorMessage === ROOM_NOT_READY_PREVIOUS_GUEST_ERROR
    ) {
      status = 409;
    } else if (errorMessage === "RESERVATION_ID_FINGERPRINT_CONFLICT") {
      status = 409;
    } else if (errorMessage === "RESERVATION_HEADER_WITHOUT_CHILD") {
      status = 500;
    } else {
      status = 500;
    }
    return res.status(status).json({
      success: false,
      error: errorMessage || "An unexpected error occurred during walk-in booking creation."
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
      // Per DSC (2026-07-31): the percentage step and the clamped
      // `subtotal − senior` subtraction now route through the shared
      // `calculatePercentDiscount` + `calculateVoucherBase` helpers.
      // Byte-equivalent output: same `Math.round` wrap, same clamp.
      const seniorPwdDiscount = Math.round(calculatePercentDiscount(subtotal, discountPct));
      const voucherBase = calculateVoucherBase(subtotal, seniorPwdDiscount);
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

      // Per DSC (2026-07-31): the post-voucher clamp and the member-step
      // percentage now route through the shared `calculateVoucherBase` +
      // `calculatePercentDiscount` helpers. Byte-equivalent output: same
      // `Math.max(..., 0)` clamp, same `Math.round` wrap.
      const afterVoucher = calculateVoucherBase(voucherBase, voucherDiscount);
      const memberDiscountPct = Number(booking.memberDiscountPct || 0);
      const memberDiscount = Math.round(calculatePercentDiscount(afterVoucher, memberDiscountPct));
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
    // Per DSC-01..05 (2026-08-01, per CVQ-06): the post-senior
    // chain (voucher + member) now routes through the shared
    // `calculateDiscountChain` helper with `seniorPct: 0` so the
    // rejection re-applies the chain with the snapshotted scope.
    // Legacy bookings without the snapshot read as the broad
    // default via `normalizeDiscountScope`. The originalTotalPrice
    // (the pre-senior subtotal) is the only component available
    // here, so we pass it as the room term; with a broad scope
    // this collapses to the previous `subtotal → voucher → member`
    // math. For narrow scopes (e.g. voucher scoped to room only)
    // the chain applies the scope to the voucher's base and the
    // member's base. The points-redemption deduction is applied
    // separately below (preserved as-is). `round: true` keeps
    // the per-step `Math.round(...)` wrap.
    const voucherDiscount = Number(bookingData.voucherDiscount || 0);
    const memberDiscountPct = Number(bookingData.memberDiscountPct || 0);
    const rawPointsRedeemedValue = Number(bookingData.pointsRedeemedValue || 0);
    const pointsRedeemedValue = Number.isFinite(rawPointsRedeemedValue)
      ? Math.max(rawPointsRedeemedValue, 0)
      : 0;
    const rejectChain = calculateDiscountChain({
      roomTotal: Number(originalTotalPrice) || 0,
      breakfastTotal: 0,
      extraBedTotal: 0,
      seniorPct: 0,
      voucherAmount: voucherDiscount,
      memberPct: memberDiscountPct,
      scope: normalizeDiscountScope(bookingData.discountScopeSnapshot),
      round: true
    });
    const restoredTotalPrice = Math.max(rejectChain.total - pointsRedeemedValue, 0);
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
    // Per PEX-04 (2026-08-01, per decision #147): stamping a
    // fresh `holdExpiresAt` from `paymentRejectedAt` requires
    // reading `settings/hotelConfig.paymentHoldWindowHours` in
    // the same write. The previous non-transactional read+update
    // would have raced the Settings change (a parallel admin
    // shortening the window could land between the read and
    // the update). The transaction guarantees the window we
    // read is the window we snapshot. Same shape as
    // handleCreateBooking's read of `paymentHoldWindowHours`.
    const updatedAt = new Date();
    let paymentRejectionReason: string | null = null;
    let paymentRejectedAt: Date | null = null;
    let paymentRejectedBy: string | null = null;
    let freshHoldExpiresAt: Date | null = null;
    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking not found.");
      }
      const data = bookingDoc.data()!;
      if (data.status !== "payment-uploaded") {
        throw new Error(`Only a booking in 'payment-uploaded' status can be rejected (current: ${data.status}).`);
      }
      bookingData = data;

      // Per MRB-04 Phase 3 (2026-08-02, per decision #159):
      // the canonical `reservationId` derivation for the
      // reservation header mirror. Same pattern as
      // `handleAddPayment` + `handleVerifyAndRecordPayment` —
      // `String((data as any).reservationId || "").trim()`
      // collapses legacy null / undefined / whitespace to
      // `""` so the legacy adapter (booking without a
      // reservation header) is a clean `length === 0` skip
      // below.
      const bookingReservationId = String((data as any).reservationId || "").trim();

      const hotelConfigDoc = await transaction.get(adminDb.collection("settings").doc("hotelConfig"));
      const hotelConfig = hotelConfigDoc.exists ? hotelConfigDoc.data()! : {};
      // `normalizePaymentHoldWindowHours` clamps legacy or
      // out-of-range values to the safe default (24h) so the
      // fresh deadline is never shorter than the documented
      // minimum and never longer than the documented maximum.
      const holdWindowHours = normalizePaymentHoldWindowHours(
        (hotelConfig as any).paymentHoldWindowHours
      );
      const newDeadline = computeHoldExpiresAt(holdWindowHours, updatedAt);

      paymentRejectionReason = safeReason;
      paymentRejectedAt = updatedAt;
      paymentRejectedBy = paymentRejectedBy;
      freshHoldExpiresAt = newDeadline;

      transaction.update(bookingRef, {
        status: "pending",
        paymentRejectionReason: safeReason,
        paymentRejectedAt: updatedAt,
        paymentRejectedBy,
        // Per PEX-04 (2026-08-01, per decision #147): a fresh
        // snapshotted deadline. The retained `paymentProofPath` /
        // legacy `paymentProofUrl` are audit evidence only and
        // do NOT exempt this booking — the `holdExpiresAt` is
        // the only expiry authority. If the guest does not
        // re-upload, the daily cron (PEX-06) retires the booking
        // at this deadline.
        holdExpiresAt: newDeadline ? Timestamp.fromDate(newDeadline) : null,
        // Per the implementation plan: stale proof state is
        // kept for audit. The re-upload is guest-driven via
        // the existing `pending` UI on the lookup page.
        updatedAt
      });

      // Per MRB-04 Phase 3 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus` mirror.
      // The booking just transitioned from `payment-uploaded`
      // back to `pending` (the check at the top of the
      // transaction guarantees this is the only possible
      // transition), so the mirror value is
      // `mapBookingStatusToReservationPaymentStatus("pending")`
      // = `"awaiting-payment"`. The
      // `bookingReservationId.length > 0` guard skips the
      // write for legacy null-`reservationId` bookings
      // (pre-MRB-01) — byte-equivalent to pre-Phase 3
      // behavior for legacy records. The same `updatedAt`
      // is used for the booking update AND the header
      // mirror — no clock skew between the two.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: mapBookingStatusToReservationPaymentStatus("pending"),
          updatedAt
        });
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        status: "pending",
        paymentRejectionReason,
        paymentRejectedAt,
        paymentRejectedBy,
        holdExpiresAt: freshHoldExpiresAt
      }
    });
  } catch (error: any) {
    console.error("Payment rejection handler error:", error);
    const message = error.message || "An unexpected error occurred.";
    // The transaction's `throw new Error(...)` for status
    // mismatches is a 400, not a 500.
    if (message.startsWith("Only a booking in 'payment-uploaded' status")) {
      return res.status(400).json({ success: false, error: message });
    }
    return res.status(500).json({ success: false, error: message });
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

  // Per CRL-02 (2026-08-02): derive the audit metadata at
  // the entry point so every downstream branch (the staff
  // and the guest paths) shares the same contract. The
  // apiRouter only sets `req.staff` when `authenticateStaff`
  // succeeds, so the boolean check is the source-of-truth
  // (no client-supplied `source` field — the server is
  // authoritative). `cancelledBy` for the guest path is the
  // literal `"guest"` (no PII — the lookupToken / email are
  // not stored on the booking); for the staff path it is
  // the staff UID so the audit row is traceable to the
  // operator who performed the action.
  const isStaffCancellation = Boolean(req.staff?.uid);
  const cancellationSource: typeof CANCELLATION_SOURCES[number] = isStaffCancellation ? "staff" : "guest";
  const cancelledBy = isStaffCancellation
    ? String(req.staff.uid)
    : "guest";

  try {
    let bookingDocumentRef: any;
    let bookingData: any;

    // Per MRB-05 (2026-08-02, per decision #159): the
    // canonical `now` for the cancellation write + the
    // reservation header mirror. Captured at the top
    // of the try block (BEFORE the runTransaction) so
    // it's stable across transaction retries. The two
    // existing `new Date()` calls (one in `cancelledAt`,
    // one in `updatedAt`) are replaced with references
    // to this single `now` — no clock skew between
    // the cancellation stamp and the reservation
    // mirror. The voucher + corporate code `updatedAt`
    // writes also use this `now`.
    const now = new Date();

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

    // Per CRL-03 (2026-08-02): the server-side status matrix
    // replaces the BF-16 "block terminal, allow everything else"
    // approach. Two checks in order:
    //
    //   (a) Universal terminal-status reject — no path can cancel
    //       a checked-in, checked-out, or already-cancelled
    //       booking. Cancellation is irreversible, so once the
    //       guest is on-property or past checkout, the status
    //       cannot flip back. Same 400 the BF-16 block produced.
    //
    //   (b) Source-specific authorisation — the guest self-service
    //       path is restricted to `pending` / `payment-uploaded`
    //       (no money may have been collected). The staff path
    //       covers every pre-arrival status. The split is enforced
    //       server-side so a client cannot POST a crafted body to
    //       bypass the guest restriction; the apiRouter's
    //       `authenticateStaff` check is the source of truth for
    //       the boolean.
    //
    //   CRL-06 (secure cancellation preview) will deliberately
    //   expand `GUEST_CANCELLABLE_STATUSES` after the guest sees
    //   a policy-derived financial preview first. Until then, any
    //   guest attempting to cancel a paid booking is funnelled to
    //   the front desk — the safer default for the "no refund
    //   issued automatically" rule (CRL-04).
    if (
      // Per MRB-05 PR #2 (2026-08-02, per decision #159):
      // the terminal-status reject now excludes
      // `checked-out`. The MRB-05 spec body says
      // "A production cancellation never deletes the
      // reservation; an all-cancelled reservation
      // remains the audit/financial record." The
      // post-settlement cancellation path (cancel a
      // stayed booking) is the clawback scenario for
      // the loyalty points — the reservation is the
      // audit record, not deleted; the booking's
      // `status` flips to `cancelled` and a negative
      // `pointsHistory` entry is recorded (the
      // `rewardsPoints` field is unchanged, the
      // invariant `rewardsPoints == sum(pointsHistory.points)`
      // is preserved). The `checked-in` and
      // `cancelled` cases remain rejected (in-house
      // cancellation is a separate flow; idempotent
      // rejection of an already-cancelled booking).
      bookingData.status === "checked-in"
      || bookingData.status === "cancelled"
    ) {
      return res.status(400).json({
        success: false,
        error: `Booking cannot be cancelled because its status is already ${bookingData.status}. Please contact the front desk.`
      });
    }
    if (
      !isStaffCancellation
      && !(GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(String(bookingData.status || ""))
    ) {
      return res.status(400).json({
        success: false,
        error: "Your booking is past the self-service cancellation window. Please contact the front desk so a staff member can assist you with cancellation and any applicable refund."
      });
    }

    await adminDb.runTransaction(async (transaction) => {
      const freshBookingDoc = await transaction.get(bookingDocumentRef);
      if (!freshBookingDoc.exists) {
        throw new Error("Booking not found.");
      }
      const freshBooking = freshBookingDoc.data() || {};
      // Per CRL-03: mirror the pre-transaction check inside the
      // transaction so a concurrent status flip between the two
      // reads is caught. The terminal-status reject is universal;
      // the source-specific authorisation uses the same boolean
      // the handler captured at entry (req.staff) — a `req.staff`
      // value cannot change mid-handler, so capturing once is safe.
      if (
        // Per MRB-05 PR #2 (2026-08-02, per decision #159):
        // the in-transaction terminal-status reject
        // mirrors the pre-transaction check above —
        // excludes `checked-out` (allowed for the
        // clawback scenario) and still rejects
        // `checked-in` (in-house cancellation is a
        // separate flow) + `cancelled` (idempotent
        // rejection).
        freshBooking.status === "checked-in"
        || freshBooking.status === "cancelled"
      ) {
        throw new Error(`Booking cannot be cancelled because its status is already ${freshBooking.status}. Please contact the front desk.`);
      }
      if (
        !isStaffCancellation
        && !(GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(String(freshBooking.status || ""))
      ) {
        throw new Error("GUEST_PAST_SELF_SERVICE_WINDOW");
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
        // Per CRL-02 (2026-08-02): the audit metadata is
        // stamped in the same transaction as the status
        // flip. `cancelledAt` uses the same `now` value
        // the `now` constant at the top of the try block
        // captured (BEFORE the runTransaction so it's
        // stable across transaction retries). A
        // sub-millisecond skew between `cancelledAt` and
        // `updatedAt` is acceptable for an audit field.
        // `cancelledBy` is the staff UID or the literal
        // "guest"; `cancellationSource` is the parallel
        // discriminator (one of CANCELLATION_SOURCES). A
        // partial failure cannot leave a half-stamped
        // cancellation — the four writes share a single
        // `transaction.update` call.
        cancelledAt: now,
        cancelledBy,
        cancellationSource,
        updatedAt: now
      });

      // Per MRB-05 (2026-08-02, per decision #159):
      // the canonical `reservationId` derivation for
      // the reservation header mirror. Same
      // defensive coercion as the other Phase 3/5
      // handlers. The mirror is intentionally the
      // SAME `now` used for the cancellation stamp
      // (no clock skew between the two).
      const bookingReservationId = String((freshBooking as any).reservationId || "").trim();

      // Per MRB-05 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus`
      // mirror. The booking just transitioned to
      // `cancelled` (the only possible new status for
      // this handler — the terminal-status reject
      // guarantees the prior status was anything
      // but `checked-in` / `checked-out` /
      // `cancelled`). The mirror value comes from
      // the N>1 aggregate helper. The
      // `bookingReservationId.length > 0` guard skips
      // the write for legacy null-`reservationId`
      // bookings (pre-MRB-01) — byte-equivalent to
      // pre-Phase 5 behavior for legacy records.
      //
      // Note: the loyalty clawback (MRB open-question
      // Q1) — recompute the points the new settled
      // total would have earned + record a negative
      // `pointsHistory` entry when a room is cancelled
      // post-settlement — ships in THIS PR
      // (MRB-05 PR #2). The clawback code is below
      // (after the reservation header mirror). The
      // terminal-status reject above was also updated
      // to exclude `checked-out` (per the spec body
      // "A production cancellation never deletes the
      // reservation; an all-cancelled reservation
      // remains the audit/financial record").
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: computeReservationAggregatePaymentStatus(["cancelled"]),
          updatedAt: now
        });
      }

      // Per MRB-05 PR #2 (2026-08-02, per decision
      // #159, MRB open-question Q1): the loyalty
      // clawback. When a `checked-out` booking with
      // `loyaltyAwardStatus === "awarded"` and a
      // positive `pointsAwarded` is cancelled, the
      // member's `pointsHistory` receives a new
      // negative entry of `-(pointsAwarded)` (the
      // booking's settled total is now 0, so the
      // recomputed eligible points are 0, the delta
      // is the full awarded amount). The
      // `rewardsPoints` field is NOT decremented in
      // place — the negative ledger entry offsets
      // the original award so the invariant
      // `rewardsPoints == sum(pointsHistory.points)`
      // is preserved (a future change to the rewards
      // invariant that DECREMENTED the field would
      // be a silent corruption; the negative ledger
      // entry is the only correct mechanism). The
      // `pointsHistory` doc id uses the same
      // `clawback-${bookingId}` shape as the existing
      // `earn-${bookingId}` so the two entries are
      // paired + auditable. The transaction's read
      // happened BEFORE the booking's status flip,
      // so `freshBooking.loyaltyAwardStatus` and
      // `freshBooking.pointsAwarded` are the
      // pre-cancellation values.
      //
      // For the N=1 case (today's entire active
      // surface) the clawback zeroes the
      // `pointsAwarded`. For the N>1 case (future,
      // when MRB-06 lands + the per-reservation award
      // refactor lands) the recompute reads the
      // reservation's net settled total (NOT the
      // cancelled booking's) and computes the
      // delta against the per-reservation award. PR
      // #2 ships only the N=1 case — the N>1 case
      // is the same shape, scaled to read N child
      // bookings' settled totals instead of 1.
      if (
        freshBooking.loyaltyAwardStatus === "awarded"
        && Number(freshBooking.pointsAwarded || 0) > 0
      ) {
        const memberIdForClawback = String(freshBooking.memberId || "").trim();
        if (memberIdForClawback) {
          const clawbackMemberRef = adminDb.collection("members").doc(memberIdForClawback);
          const clawbackMemberDoc = await transaction.get(clawbackMemberRef);
          if (clawbackMemberDoc.exists) {
            const clawbackPoints = -Number(freshBooking.pointsAwarded || 0);
            const clawbackHistoryRef = clawbackMemberRef.collection("pointsHistory").doc(`clawback-${bookingId}`);
            transaction.set(clawbackHistoryRef, {
              type: "clawback",
              points: clawbackPoints,
              bookingId,
              bookingRef: freshBooking.bookingRef,
              description: `Cancellation clawback for cancelled stay (${freshBooking.bookingRef})`,
              by: cancelledBy,
              createdAt: now
            });
            // Per the invariant: rewardsPoints is NOT
            // decremented in place. The negative
            // ledger entry is the only mechanism.
            // The member's `rewardsPoints` field is
            // unchanged.
            //
            // The booking's `pointsAwarded` field is
            // ALSO reset to 0 on the cancellation
            // (the original award has been "reversed"
            // via the negative ledger entry). This
            // is informational (the field is a
            // derived snapshot of the ledger sum);
            // the ledger is the source of truth.
            bookingUpdate.pointsAwarded = 0;
            bookingUpdate.loyaltyAwardStatus = "clawback-recorded";
            bookingUpdate.pointsAwardedAt = null;
            // Apply the post-cancellation stamp
            // atomically with the cancellation status
            // flip. The earlier
            // `transaction.update(bookingDocumentRef, ...)`
            // call at the top of this block already
            // fired — this is a SECOND write to the
            // same doc in the same transaction
            // (Firestore transactions allow multiple
            // writes to the same doc; the final write
            // wins). The stamp marks the booking as
            // clawback-recorded + zeroes the
            // informational `pointsAwarded` field (the
            // ledger is the source of truth).
            transaction.update(bookingDocumentRef, {
              pointsAwarded: 0,
              loyaltyAwardStatus: "clawback-recorded",
              pointsAwardedAt: null
            });
          }
        }
      }

      if (voucherDoc?.exists && voucherRef) {
        const voucherData = voucherDoc.data() || {};
        transaction.update(voucherRef, {
          usageCount: Math.max((Number(voucherData.usageCount) || 0) - 1, 0),
          updatedAt: now
        });
      }
      if (corporateCodeDoc?.exists && corporateCodeRef) {
        const corporateCodeData = corporateCodeDoc.data() || {};
        transaction.update(corporateCodeRef, {
          usageCount: Math.max((Number(corporateCodeData.usageCount) || 0) - 1, 0),
          updatedAt: now
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
    // Per CRL-03: the in-transaction check raises
    // `GUEST_PAST_SELF_SERVICE_WINDOW` when a concurrent status
    // flip moved the booking past the guest-cancellable set
    // between the handler's pre-transaction read and the
    // transaction's re-read. Map to a 400 with the same message
    // the pre-transaction check surfaces so the client UX is
    // consistent regardless of which check caught it.
    if (error?.message === "GUEST_PAST_SELF_SERVICE_WINDOW") {
      return res.status(400).json({
        success: false,
        error: "Your booking is past the self-service cancellation window. Please contact the front desk so a staff member can assist you with cancellation and any applicable refund."
      });
    }
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

  // Per MRB-04 Phase 3 (2026-08-02, per decision #159): the
  // canonical `now` for both the booking update AND the
  // reservation header mirror. Captured OUTSIDE the
  // `runTransaction` so it's stable across transaction
  // retries (Firestore may re-run a transaction up to a few
  // times; capturing `now` inside the closure would produce a
  // new Date on every retry and skew the `updatedAt` audit
  // trail). Used in the booking update + the reservation
  // header mirror — one Date per request, no second `new Date()`
  // call inside the transaction.
  const now = new Date();

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

      // Per MRB-04 Phase 2 (2026-08-02, per decision
      // #159): the reservation-owned payment subcollection
      // path. For new reservations (post-MRB-01, i.e.
      // `bookingData.reservationId` is non-null), the
      // payment record lives at
      // `reservations/{reservationId}/payments/{paymentId}`
      // (the reservation header is the canonical money
      // source). For legacy null-`reservationId` bookings
      // (pre-MRB-01), the payment record stays at
      // `bookings/{bookingId}/payments/{paymentId}` (the
      // historical contract). The status transitions on the
      // booking doc (`payment-confirmed` + the loyalty
      // award) stay the same for both paths — only the
      // payment RECORD moves to the new subcollection.
      const bookingReservationId = String((bookingData as any).reservationId || "").trim();
      const paymentsRef = bookingReservationId.length > 0
        ? adminDb.collection("reservations").doc(bookingReservationId).collection("payments")
        : bookingRef.collection("payments");
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
        // Per MRB-04 Phase 3 (2026-08-02, per decision #159):
        // the same `now` is used for the booking update +
        // the reservation header mirror (no second `new Date()`
        // call inside the transaction — captured at the top
        // of the try block, stable across transaction retries).
        const updatedAt = now;
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

      // Per MRB-04 Phase 3 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus` mirror.
      // Only fires when the booking just transitioned to
      // `payment-confirmed` (the `transitionedToPaymentConfirmed`
      // guard prevents touching the header on idempotent
      // replays or partial-payment writes that didn't change
      // the status). The mirror value comes from
      // `mapBookingStatusToReservationPaymentStatus` (the
      // N=1 mapping helper in `shared/utils/bookingFolio.ts`).
      // The `bookingReservationId.length > 0` guard skips the
      // write for legacy null-`reservationId` bookings (pre-MRB-01)
      // — byte-equivalent to pre-Phase 3 behavior for legacy
      // records. The same `now` is used for the booking update
      // AND the header mirror — no clock skew between the two.
      if (transitionedToPaymentConfirmed && bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: mapBookingStatusToReservationPaymentStatus(bookingDataSnapshot.status),
          updatedAt: now
        });
      }

      // Append the payment record inside the transaction after
      // all reads have completed. Per MRB-04 Phase 2: for
      // new reservations the record carries `reservationId`
      // (canonical linkage to the parent reservation) +
      // `bookingId` (per-room attribution — `null` for
      // reservation-level payments; non-null when the staff
      // ties a payment to a specific room's add-on). For
      // legacy null-`reservationId` bookings the record
      // shape is byte-equivalent to the historical
      // `OnsitePayment` shape (no `reservationId` field).
      const newPaymentRef = paymentsRef.doc(paymentId);
      const recordWithReservation = bookingReservationId.length > 0
        ? { ...paymentRecord, reservationId: bookingReservationId, bookingId: bookingId }
        : paymentRecord;
      transaction.create(newPaymentRef, recordWithReservation);
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
  // Per CRL-01 (Cancellation & Refund Lifecycle, 2026-08-01):
  // the client preallocates the refundId so a retry-after-uncertain-response
  // (network blip, the staff tab being closed mid-submit) cannot append a
  // second refund entry. Mirrors the handleAddPayment contract (refundId
  // validated against the same preallocated-ID regex). Exact replay with the
  // same amount/method/reason/reference returns the existing record; same
  // ID with different fields is a 409 conflict. The append-only ledger is
  // preserved (server-authoritative create, no client-side rules allowlist).
  const { bookingId, refundId, amount, method, reason, transactionReference } = req.body || {};
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }
  if (!refundId || !PREALLOCATED_PAYMENT_ID_REGEX.test(String(refundId))) {
    return res.status(400).json({ success: false, error: "A valid refund ID is required." });
  }
  const numericAmount = Number(amount);
  const safeReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  const safeMethod = typeof method === "string" ? method.trim().slice(0, 80) : "";
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000) {
    return res.status(400).json({ success: false, error: "Refund amount must be between 0.01 and 1,000,000." });
  }
  if (!safeMethod || !safeReason) {
    return res.status(400).json({ success: false, error: "Refund method and reason are required." });
  }
  // Optional per-tender reference (mirrors the handleAddPayment shape; the
  // current UI does not collect one but the field is reserved for CRL-07's
  // "Record processed refund" rename). Null/empty coerces to absent so the
  // conflict check stays byte-equivalent to a UI that does not send it.
  const safeTransactionReference = typeof transactionReference === "string"
    ? transactionReference.trim().slice(0, 200) || null
    : null;

  try {
    let refundRecord: Record<string, any> = {};
    let netCollected = 0;
    let idempotentReplay = false;
    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error("Booking not found");
      const bookingData = bookingDoc.data()!;

      // Per MRB-04 Phase 2.x (2026-08-02, per decision #159):
      // the canonical refund source moves to the reservation
      // subcollection for new reservations. The dual-read
      // pattern (Belt-and-suspenders): for new reservations
      // (post-MRB-01, `bookingData.reservationId` is non-null),
      // the refund record lives at
      // `reservations/{reservationId}/refunds/{refundId}` (the
      // canonical source). Net collected is computed from the
      // reservation's `payments/` (positive) + `refunds/`
      // (negative) subcollections — the same sign-aware sum
      // the helper `getReservationFolioSummary` uses. For
      // legacy null-`reservationId` bookings (pre-MRB-01), the
      // refund record stays at
      // `bookings/{bookingId}/payments/{refundId}` (the
      // historical CRL-01 contract — refunds are
      // negative-amount entries on the booking's payments
      // subcollection). Net collected is the historical sum
      // of the booking's payments (which includes the
      // negative-amount refund entries for legacy).
      const bookingReservationId = String((bookingData as any).reservationId || "").trim();
      const refundsRef = bookingReservationId.length > 0
        ? adminDb.collection("reservations").doc(bookingReservationId).collection("refunds")
        : bookingRef.collection("payments");
      // Read existing refunds (new path) or payments (legacy
      // path) before queuing writes. Firestore transactions
      // reject reads after writes, and the net collected is
      // the current sum plus this new refund. The new path
      // also reads the reservation's payments subcollection
      // so the net collected reflects BOTH `payments/` and
      // `refunds/` (the dual-read pattern).
      const refundsSnapshot = await transaction.get(refundsRef);
      let netPositivePayments = 0;
      if (bookingReservationId.length > 0) {
        const paymentsRef = adminDb.collection("reservations").doc(bookingReservationId).collection("payments");
        const paymentsSnapshot = await transaction.get(paymentsRef);
        netPositivePayments = paymentsSnapshot.docs.reduce(
          (sum, paymentDoc) => sum + Number(paymentDoc.data().amount || 0),
          0
        );
      }
      const netRefunds = refundsSnapshot.docs.reduce(
        (sum, refundDoc) => sum + Number(refundDoc.data().amount || 0),
        0
      );
      // For new reservations, the "refunds" subcollection
      // contains only negative-amount entries (per the
      // writer's contract); for legacy, the "refunds" alias
      // is the booking's payments subcollection which mixes
      // positive payments + negative refunds. Either way,
      // the sum is the net collected — sign-aware.
      netCollected = netPositivePayments + netRefunds;

      // Idempotency check: a refund with this exact refundId
      // already exists. Same amount/method/reason/reference
      // (or no-reference on both sides) replays the original
      // commit. A mismatch on any field is a 409 — the client
      // reused an ID it had already committed for a different
      // refund, which would be a staff typo or a
      // duplicate-form bug we want loud, not silent.
      //
      // For new reservations: search the reservation's
      // `refunds/` subcollection (the canonical source).
      // For legacy: search the booking's `payments/`
      // subcollection (the historical source).
      const existingRefund = refundsSnapshot.docs.find((docSnap: any) => docSnap.id === refundId);
      if (existingRefund) {
        const existingData = existingRefund.data();
        const sameRequest = Math.abs(Number(existingData.amount || 0)) === numericAmount
          && String(existingData.method || "") === safeMethod
          && String(existingData.note || "") === safeReason
          && (existingData.transactionReference || null) === safeTransactionReference;
        if (!sameRequest) {
          throw new Error("Refund ID has already been used for a different refund.");
        }
        // Idempotent replay: re-read the cumulative net so the response
        // reflects the post-refund balance (which is unchanged from the
        // original commit but is the most truthful figure to surface).
        refundRecord = existingData;
        idempotentReplay = true;
        return;
      }

      if (numericAmount > netCollected) {
        throw new Error(`Refund exceeds the net collected amount of ${netCollected}.`);
      }
      const approvedBy = req.staff.uid || "admin";
      const newRecord: Record<string, any> = {
        type: "refund",
        amount: -numericAmount,
        method: safeMethod,
        note: safeReason,
        reason: safeReason,
        approvedBy,
        recordedBy: approvedBy,
        recordedAt: new Date()
      };
      if (safeTransactionReference) newRecord.transactionReference = safeTransactionReference;
      // Per MRB-04 Phase 2.x: for new reservations, stamp
      // the `reservationId` + `bookingId` on the record so
      // the new subcollection is self-describing (per-room
      // attribution possible via `bookingId`; canonical
      // reservation linkage via `reservationId`).
      if (bookingReservationId.length > 0) {
        newRecord.reservationId = bookingReservationId;
        newRecord.bookingId = bookingId;
      }
      refundRecord = newRecord;
      // transaction.create (not set) so a server-side race that lost the
      // existingRefund lookup still throws a clean ALREADY_EXISTS rather
      // than overwriting the original ledger entry. The `refundsRef.doc(refundId)`
      // resolves to `reservations/{id}/refunds/{refundId}` for new reservations
      // and `bookings/{id}/payments/{refundId}` for legacy.
      transaction.create(refundsRef.doc(refundId), newRecord);
    });
    return res.status(200).json({
      success: true,
      data: {
        ...refundRecord,
        netCollected: netCollected - numericAmount,
        idempotentReplay
      }
    });
  } catch (error: any) {
    if (error.message === "Booking not found") return res.status(404).json({ success: false, error: "Booking not found." });
    if (error.message === "Refund ID has already been used for a different refund.") {
      return res.status(409).json({ success: false, error: error.message });
    }
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

    // Per MRB-04 Phase 3 (2026-08-02, per decision #159):
    // the canonical `now` for both the booking update AND
    // the reservation header mirror. Captured at the top
    // of the try block (BEFORE the runTransaction) so it's
    // stable across transaction retries. The existing two
    // `new Date()` calls (one in `bookingUpdates.updatedAt`,
    // one in `bookingUpdates.paymentConfirmedAt`) are
    // replaced with references to this single `now` — no
    // clock skew between the booking update and the
    // reservation mirror, and no second Date allocation
    // inside the transaction.
    const now = new Date();

    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error("BOOKING_NOT_FOUND");
      const data = bookingDoc.data()!;
      bookingData = data;

      // Per MRB-04 Phase 2.x (2026-08-02, per decision
      // #159): the reservation-owned payment subcollection
      // path. For new reservations (post-MRB-01, i.e.
      // `data.reservationId` is non-null), the verified
      // payment record lives at
      // `reservations/{reservationId}/payments/{paymentId}`
      // (the reservation header is the canonical money
      // source). For legacy null-`reservationId` bookings
      // (pre-MRB-01), the verified payment record stays at
      // `bookings/{bookingId}/payments/{paymentId}` (the
      // historical contract). The status transition on the
      // booking doc (`payment-confirmed` when fully paid) +
      // the notification write stay the same for both paths
      // — only the payment RECORD moves to the new
      // subcollection. Same pattern as the Phase 2
      // `handleAddPayment` refactor; the new subcollection
      // path preserves the CRL-01 idempotency contract
      // (same `paymentId` + same fingerprint →
      // `idempotentReplay: true`; same `paymentId` with
      // different fields → 409 PAYMENT_ID_CONFLICT).
      const bookingReservationId = String((data as any).reservationId || "").trim();
      const paymentsRef = bookingReservationId.length > 0
        ? adminDb.collection("reservations").doc(bookingReservationId).collection("payments")
        : bookingRef.collection("payments");
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
      // Per MRB-04 Phase 2.x: for new reservations, stamp
      // the `reservationId` + `bookingId` on the record so
      // the new subcollection is self-describing (per-room
      // attribution possible via `bookingId`; canonical
      // reservation linkage via `reservationId`). For
      // legacy null-`reservationId` bookings the record
      // stays byte-equivalent to pre-MRB-04 — no
      // `reservationId` field on the record.
      const recordWithReservation = bookingReservationId.length > 0
        ? { ...paymentRecord, reservationId: bookingReservationId, bookingId: bookingId }
        : paymentRecord;

      transaction.create(paymentsRef.doc(paymentId), recordWithReservation);

      // Transition to payment-confirmed only when fully paid
      const bookingUpdates: Record<string, any> = {
        updatedAt: now
      };
      if (fullyPaid) {
        bookingUpdates.status = "payment-confirmed";
        bookingUpdates.handledBy = staffUid;
        bookingUpdates.paymentConfirmedAt = now;
      }
      transaction.update(bookingRef, bookingUpdates);
      bookingData = { ...data, ...bookingUpdates };

      // Per MRB-04 Phase 3 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus` mirror.
      // Only fires when the booking just transitioned to
      // `payment-confirmed` (the `fullyPaid` guard prevents
      // touching the header on partial payments that didn't
      // change the status). The mirror value comes from
      // `mapBookingStatusToReservationPaymentStatus` (the
      // N=1 mapping helper in `shared/utils/bookingFolio.ts`).
      // The `bookingReservationId.length > 0` guard skips the
      // write for legacy null-`reservationId` bookings
      // (pre-MRB-01) — byte-equivalent to pre-Phase 3
      // behavior for legacy records. The same `now` is used
      // for the booking update AND the header mirror — no
      // clock skew between the two.
      if (fullyPaid && bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: mapBookingStatusToReservationPaymentStatus(bookingUpdates.status),
          updatedAt: now
        });
      }
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

    // Per MRB-05 (2026-08-02, per decision #159): the
    // canonical `now` for the booking update AND the
    // reservation header mirror. Captured at the top
    // of the try block (BEFORE the runTransaction) so
    // it's stable across transaction retries. The two
    // existing `new Date()` calls (one in `confirmedAt`,
    // one in `updatedAt`) are replaced with references
    // to this single `now` — no clock skew between the
    // booking update and the reservation mirror.
    const now = new Date();

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

      // Per MRB-05 (2026-08-02, per decision #159):
      // the canonical `reservationId` derivation for
      // the reservation header mirror. Same
      // defensive coercion as the other Phase 3/5
      // handlers — `String(...).trim()` collapses
      // legacy null / undefined / whitespace to `""`
      // so the legacy-skip guard below is a clean
      // `length === 0` check.
      const bookingReservationId = String((data as any).reservationId || "").trim();

      transaction.update(bookingRef, {
        status: "confirmed",
        confirmedAt: now,
        confirmedBy,
        updatedAt: now
      });

      // Per MRB-05 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus`
      // mirror. The booking just transitioned to
      // `confirmed` (the only possible new status for
      // this handler — the `allowedStatuses` check
      // above guarantees the prior status was
      // `pending` / `payment-uploaded` / `payment-confirmed`,
      // and the new status is always `confirmed`).
      // The mirror value comes from the N>1 aggregate
      // helper — for the N=1 case (today's entire
      // active surface) the aggregate is the same as
      // the single mapped status. The
      // `bookingReservationId.length > 0` guard skips
      // the write for legacy null-`reservationId`
      // bookings (pre-MRB-01) — byte-equivalent to
      // pre-Phase 5 behavior for legacy records. The
      // same `now` is used for the booking update AND
      // the header mirror — no clock skew between the
      // two.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: computeReservationAggregatePaymentStatus(["confirmed"]),
          updatedAt: now
        });
      }
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

    // Per MRB-05 (2026-08-02, per decision #159): the
    // canonical `now` for the booking update AND the
    // reservation header mirror. Captured at the top
    // of the try block (BEFORE the runTransaction) so
    // it's stable across transaction retries. The
    // `new Date()` call inside the transaction is
    // removed — the booking update uses this single
    // `now` (no clock skew between the booking update
    // and the reservation mirror).
    const now = new Date();

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

      // MRB-04 Phase 4: the balance gate resolves the reservation
      // folio for new reservations and the historical booking folio
      // for legacy null-reservationId bookings. The resolver runs
      // inside this transaction so the threshold decision and the
      // confirmedWithBalance snapshot observe the same ledger state.
      const folioSnapshot = await readTransactionalFolioSnapshot({
        transaction,
        bookingRef,
        bookingId,
        bookingData: data
      });
      const computedBalance = folioSnapshot.computedBalance;
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

      // Per MRB-05 (2026-08-02, per decision #159):
      // the canonical `reservationId` derivation for
      // the reservation header mirror. Same
      // defensive coercion as the other Phase 3/5
      // handlers.
      const bookingReservationId = String((data as any).reservationId || "").trim();

      // Per MRB-05 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus`
      // mirror. The booking just transitioned to
      // `confirmed` (the only possible new status
      // for this handler — the CWB-01 status check
      // guarantees the prior status was
      // `payment-uploaded`, and the new status is
      // always `confirmed`). The mirror value comes
      // from the N>1 aggregate helper. The
      // `bookingReservationId.length > 0` guard skips
      // the write for legacy null-`reservationId`
      // bookings (pre-MRB-01) — byte-equivalent to
      // pre-Phase 5 behavior for legacy records. The
      // same `now` is used for the booking update AND
      // the header mirror.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: computeReservationAggregatePaymentStatus(["confirmed"]),
          updatedAt: now
        });
      }

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

    // Per MRB-05 (2026-08-02, per decision #159): the
    // canonical `now` for the booking update + the
    // room update + the reservation header mirror.
    // Captured at the top of the try block (BEFORE
    // the runTransaction) so it's stable across
    // transaction retries. The two existing
    // `new Date()` calls (one in `checkedInAt`, one in
    // `updatedAt`, the third in the room update) are
    // replaced with references to this single `now`.
    const now = new Date();

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

      // Per MRB-05 (2026-08-02, per decision #159):
      // the canonical `reservationId` derivation for
      // the reservation header mirror. Same
      // defensive coercion as the other Phase 3/5
      // handlers.
      const bookingReservationId = String((bookingData as any).reservationId || "").trim();

      transaction.update(bookingRef, {
        status: "checked-in",
        checkedInAt: now,
        checkedInBy,
        updatedAt: now
      });
      transaction.update(roomRef, {
        status: "occupied",
        updatedAt: now
      });

      // Per MRB-05 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus`
      // mirror. The booking just transitioned to
      // `checked-in` (the readiness + room gates
      // guarantee this is the only possible new
      // status). The mirror value comes from the
      // N>1 aggregate helper — for the N=1 case
      // (today's entire active surface) the aggregate
      // is `computeReservationAggregatePaymentStatus(["checked-in"])`
      // = `"in-house"`. The
      // `bookingReservationId.length > 0` guard skips
      // the write for legacy null-`reservationId`
      // bookings (pre-MRB-01) — byte-equivalent to
      // pre-Phase 5 behavior for legacy records. The
      // same `now` is used for the booking update +
      // the room update + the header mirror.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: computeReservationAggregatePaymentStatus(["checked-in"]),
          updatedAt: now
        });
      }
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

    // Per MRB-05 (2026-08-02, per decision #159): the
    // canonical `now` for the booking update + the
    // room update + the intercom archive + the
    // reservation header mirror. Captured at the top
    // of the try block (BEFORE the runTransaction) so
    // it's stable across transaction retries. The
    // existing `new Date()` calls inside the
    // transaction (`checkedOutAt`, `updatedAt`,
    // `unpaidCheckoutApprovedAt`, `pointsAwardedAt`,
    // room `updatedAt`, intercom `resolvedAt` /
    // `updatedAt`) are replaced with references to
    // this single `now` — no clock skew between the
    // booking update, the room update, the intercom
    // archive, and the reservation mirror.
    const now = new Date();

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

      // MRB-04 Phase 4: a room may check out only against the
      // authoritative reservation balance. For new reservations
      // this includes payments/refunds/charges and add-to-bill store
      // orders across every child room. Legacy bookings retain their
      // historical single-booking folio path.
      const folioSnapshot = await readTransactionalFolioSnapshot({
        transaction,
        bookingRef,
        bookingId,
        bookingData: freshBookingData
      });
      const collectedTotal = folioSnapshot.collectedTotal;
      const checkoutFolioTotal = folioSnapshot.folioTotal;
      checkedOutWithBalance = folioSnapshot.computedBalance;
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
        checkedOutAt: now,
        checkedOutBy,
        checkedOutWithBalance,
        checkedOutFolioTotal: checkoutFolioTotal,
        checkedOutCollectedTotal: collectedTotal,
        updatedAt: now
      };

      // UCO-06: stamp unpaid departure exception data
      if (checkedOutWithBalance > 0) {
        bookingUpdate.unpaidCheckoutReason = safeUnpaidReason;
        bookingUpdate.unpaidCheckoutApprovalThreshold = unpaidCheckoutThreshold;
        bookingUpdate.unpaidCheckoutApprovedBy = unpaidCheckoutApprovedBy;
        bookingUpdate.unpaidCheckoutApprovedAt = now;
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
        pointsAwardedAt: awardNow ? now : null
      });

      // Per MRB-05 (2026-08-02, per decision #159):
      // the canonical `reservationId` derivation for
      // the reservation header mirror. Same
      // defensive coercion as the other Phase 3/5
      // handlers.
      const bookingReservationId = String((freshBookingData as any).reservationId || "").trim();

      transaction.update(bookingRef, bookingUpdate);

      if (bookingData.roomId) {
        const roomRef = adminDb.collection("rooms").doc(String(bookingData.roomId));
        transaction.update(roomRef, {
          status: "available",
          housekeepingStatus: "dirty",
          updatedAt: now
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
          { resolved: true, resolvedAt: now, resolvedBy: checkedOutBy, roomNumber, updatedAt: now },
          { merge: true }
        );
      }

      // Per MRB-05 (2026-08-02, per decision #159):
      // the reservation header's `paymentStatus`
      // mirror. The booking just transitioned to
      // `checked-out` (the only possible new status
      // for this handler — the pre-transaction check
      // guarantees the prior status was `checked-in`).
      // The mirror value comes from the N>1 aggregate
      // helper — for the N=1 case (today's entire
      // active surface) the aggregate is
      // `computeReservationAggregatePaymentStatus(["checked-out"])`
      // = `"completed"`. The
      // `bookingReservationId.length > 0` guard skips
      // the write for legacy null-`reservationId`
      // bookings (pre-MRB-01) — byte-equivalent to
      // pre-Phase 5 behavior for legacy records. The
      // same `now` is used for the booking update +
      // the room update + the intercom archive + the
      // header mirror.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
          paymentStatus: computeReservationAggregatePaymentStatus(["checked-out"]),
          updatedAt: now
        });
      }

      if (awardNow && memberId && memberRef && memberDocInTransaction?.exists) {
        const currentPoints = Number(memberDocInTransaction.data()?.rewardsPoints || 0);
        transaction.update(memberRef, {
          rewardsPoints: currentPoints + pointsAwarded,
          updatedAt: now
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

  // Per MRB-02.x (2026-08-02, per decision #164): strict-Zod
  // validates the reschedule body. The schema accepts an
  // optional `reservationId` (the staff modal doesn't
  // preallocate, but a future migration tool that wants
  // to bulk-reschedule and retry the same call rides the
  // same contract). The schema is `strict()` so a client
  // can't add unexpected fields (same posture as the
  // create + walkin schemas).
  const parsedReschedule = RescheduleBookingSchema.safeParse(req.body || {});
  if (!parsedReschedule.success) {
    return res.status(400).json({
      success: false,
      error: "Booking, room, check-in, and check-out are required."
    });
  }
  const { bookingId, roomId, checkIn, checkOut, reason, reservationId: requestedReservationId } = parsedReschedule.data;

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
    // Per PEX-03 (2026-08-01, per decision #147): same retirement
    // list pattern as handleCreateBooking / handleCreateWalkin.
    // The reschedule transaction may displace an expired `pending`
    // hold on the target room (or the same room, for a dates-only
    // move); the retirement is atomic with the move.
    const expiredHoldRetirements: Array<{ ref: FirebaseFirestore.DocumentReference; previousData: any; bookingRef: string; guestEmail: string; holdExpiresAt: Date | null }> = [];

    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(String(bookingId));
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error("Booking not found.");
      const booking = bookingDoc.data() || {};
      // Per MRB-02.x (2026-08-02, per decision #164): the
      // canonical reservation id for this reschedule. The
      // reschedule re-uses the existing booking's
      // `reservationId` (the reschedule is a modification of
      // the same reservation group, not a new reservation).
      // A `body.reservationId` is accepted but only honored
      // when the booking's stored `reservationId` is null
      // (a defensive migration path for a future bulk
      // reschedule tool that wants to attach a fresh id);
      // when the booking already has a `reservationId`, the
      // body's value is ignored (the booking's id is the
      // canonical anchor). Legacy null-`reservationId`
      // bookings (pre-MRB-02) keep today's self-contained
      // behavior: the reschedule updates the booking but
      // does NOT touch a reservation header (the booking's
      // own rate breakdown + status matrix remain the
      // single source of truth for those legacy records).
      const bookingReservationId: string | null = (() => {
        const stored = String((booking as any).reservationId || "").trim();
        if (stored.length > 0) return stored;
        if (requestedReservationId && RESERVATION_ID_REGEX.test(requestedReservationId)) {
          return requestedReservationId;
        }
        return null;
      })();
      // The reservation doc ref is built only when the
      // booking has a `reservationId` — legacy bookings
      // stay on the self-contained path.
      const reservationDocRef = bookingReservationId
        ? adminDb.collection("reservations").doc(bookingReservationId)
        : null;
      // Read the reservation header early so the
      // half-stamped guard fires BEFORE the pricing math
      // (a missing header means the booking is in an
      // inconsistent state; we don't want to recompute
      // the rate breakdown just to throw 500 on the
      // commit). When the booking has a `reservationId`
      // but the header is missing, the state is
      // unrecoverable by this request — staff must
      // investigate, then either restore the header or
      // migrate the booking to a fresh one.
      let existingReservationData: any = null;
      if (reservationDocRef) {
        const existingReservationSnap = await transaction.get(reservationDocRef);
        if (existingReservationSnap.exists) {
          existingReservationData = existingReservationSnap.data() || {};
        } else {
          throw new Error("RESERVATION_HEADER_WITHOUT_CHILD");
        }
      }
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
      const now = new Date();
      let sawConflict = false;
      let sawLingering = false;
      for (const doc of overlapSnapshot.docs) {
        if (doc.id === String(bookingId)) continue;
        const docData = doc.data();
        if (isExpiredPendingHold(docData, now)) {
          const existingCheckIn = toDateOrNull(docData.checkIn);
          const existingCheckOut = toDateOrNull(docData.checkOut);
          const dateOverlaps = existingCheckIn && existingCheckOut
            ? rangesOverlap(existingCheckIn, existingCheckOut, checkInDate, checkOutDate)
            : false;
          if (dateOverlaps) {
            expiredHoldRetirements.push({
              ref: doc.ref,
              previousData: docData,
              bookingRef: String(docData.bookingRef || doc.id),
              guestEmail: String(docData.guestEmail || ""),
              holdExpiresAt: toDateOrNull(docData.holdExpiresAt)
            });
          }
          continue;
        }
        const reason = getOccupancyConflictReason({
          bookingData: docData,
          requestedCheckIn: checkInDate,
          requestedCheckOut: checkOutDate,
          requestedCheckInKey: checkIn,
          todayKey,
          currentMinutes: currentManilaMinutes,
          checkOutTime: hotelConfig.checkOutTime,
          now
        });
        if (reason === "overlap" || reason === "lingering-checked-in") {
          if (reason === "lingering-checked-in") sawLingering = true;
          sawConflict = true;
          break;
        }
      }
      if (sawConflict) {
        throw new Error(sawLingering
          ? "Target room is not ready because the previous guest has not checked out yet."
          : "Target room already has a booking in that date range.");
      }

      const hasBlockConflict = await hasActiveRoomBlockConflict(transaction, String(roomId), checkInDate, checkOutDate);
      if (hasBlockConflict) throw new Error("Target room is blocked for that date range.");

      // Load Breakfast Config (source of truth for the live rate). Read
      // here alongside the other transaction reads, before any writes.
      const breakfastConfigDoc = await transaction.get(adminDb.collection("settings").doc("breakfastConfig"));
      const breakfastConfig = breakfastConfigDoc.data() || {};
      const rawTypeEntry = roomTypesArr.find((entry) => entry && entry.value === room.type);
      if (!rawTypeEntry) throw new Error("Room type configuration not found.");
      const typeEntry = applyRoomTypeDefaults(rawTypeEntry);

      // Per CHD-04 + EXB-03 (2026-08-01, per decision #144
      // + #145): the reschedule transaction validates the
      // existing booking's adult/child occupancy against
      // the NEW room type's caps, using the existing
      // snapshotted `extraBedCount` (the reschedule body
      // does not let staff change the extra bed count;
      // the count is part of the booking, not the
      // reschedule). The booking doc already has
      // `numAdults` + `numChildren` (validated at create /
      // walkin time per CHD-04) — for legacy pre-CHD
      // bookings the fields are absent, so we derive
      // `numAdults = numGuests, numChildren = 0` (the
      // historical "all guests are adults" shape).
      //
      // This subsumes the previous PF-03 combined-cap
      // check (`numGuests > maxCapacity`), which could
      // not express the overflow case: a booking with
      // extra beds fits a larger occupancy than the
      // type's `maxCapacity`. The EXB-03 helper is the
      // single authority — when `extraBedCount === 0` it
      // reduces to the two hard caps (PF-03's shape +
      // CHD-04's `numChildren > maxChildren`); when
      // `> 0` it allows overflow up to the extra bed
      // count. See `requiredExtraBedsFor` in
      // `shared/utils/roomTypes.ts`.
      const rescheduleNumAdults = Number.isFinite(Number(booking.numAdults))
        ? Math.max(0, Math.floor(Number(booking.numAdults)))
        : Math.max(0, Math.floor(Number(booking.numGuests) || 0));
      const rescheduleNumChildren = Math.max(0, Math.floor(Number(booking.numChildren) || 0));
      const rescheduleMaxCapacity = Math.max(0, Number(typeEntry.maxCapacity) || 0);
      const rescheduleMaxChildren = Math.max(0, Number(typeEntry.maxChildren) || 0);
      const rescheduleExtraBedCount = Math.max(0, Number(booking.extraBedCount) || 0);
      const rescheduleMaxExtraBeds = Math.max(0, Number(typeEntry.maxExtraBeds) || 0);
      const rescheduleOverflow = requiredExtraBedsFor({
        numAdults: rescheduleNumAdults,
        numChildren: rescheduleNumChildren,
        maxCapacity: rescheduleMaxCapacity,
        maxChildren: rescheduleMaxChildren
      });
      if (rescheduleOverflow.requiredExtraBeds > rescheduleExtraBedCount) {
        throw new Error(
          `Booking does not fit the target room type: ${rescheduleOverflow.overflowAdults} overflow adult(s) + ${rescheduleOverflow.overflowChildren} overflow child(ren) = ${rescheduleOverflow.requiredExtraBeds} extra bed(s) needed, but the booking has ${rescheduleExtraBedCount} extra bed(s) snapshotted. The target room type allows up to ${rescheduleMaxExtraBeds} extra bed(s).`
        );
      }

      // Per EXB-10 (2026-08-01, per decision #157): the
      // hotel-wide rollaway-bed inventory check. Same
      // shape as the create / walkin paths, with the
      // critical `excludeBookingId: bookingId` so the
      // booking's own snapshotted `extraBedCount` is
      // NOT counted against itself — without the
      // exclusion, every reschedule would always "use"
      // its own bed and reject the new configuration
      // when the inventory is tight. The helper is pure:
      // the same `countExtraBedsInUse` + the same
      // `checkExtraBedInventory` call as the other 2
      // transactions. `0 inventory` short-circuits to
      // `ok: true` so the historical "any number"
      // behavior is preserved when the field is absent
      // (legacy / freshly bootstrapped projects).
      if (rescheduleExtraBedCount > 0) {
        const rescheduleExtraBedOverlapQuery = adminDb.collection("bookings")
          .where("status", "in", ROOM_OCCUPYING_STATUSES);
        const rescheduleExtraBedOverlapSnapshot = await transaction.get(rescheduleExtraBedOverlapQuery);
        const rescheduleExtraBedInUse = countExtraBedsInUse(
          rescheduleExtraBedOverlapSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
          checkInDate,
          checkOutDate,
          bookingId
        );
        const rescheduleInventoryResult = checkExtraBedInventory(
          Math.max(0, Number(hotelConfig.extraBedInventory) || 0),
          rescheduleExtraBedInUse,
          rescheduleExtraBedCount
        );
        if (!rescheduleInventoryResult.ok) {
          throw new Error(
            `Not enough extra beds: ${rescheduleExtraBedInUse} already booked across overlapping stays + ${rescheduleExtraBedCount} requested = ${rescheduleExtraBedInUse + rescheduleExtraBedCount}, but the hotel only has ${hotelConfig.extraBedInventory} rollaway bed(s) in inventory.`
          );
        }
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
      // Per EXB-02 (2026-07-31): the inline `breakfastRate * (numGuests || 1) * numNights`
      // now routes through the shared `calculateBreakfastAddOn` helper
      // (byte-equivalent output; the `manualNightlyRate === null` guard
      // becomes `hasBreakfast: false` here, which the helper short-circuits
      // to 0).
      // Per CHD-10 (2026-07-31, per CVQ-01): the existing snapshotted
      // `breakfastIncludesChildren` flag is preserved on reschedule —
      // `undefined` on legacy bookings reads as `true` (the historical
      // default) via the helper's defensive coercion.
      // Per EXB-01 (2026-07-31): the existing snapshotted extra-bed
      // count + rate are preserved on reschedule. Legacy bookings
      // without the field read as 0 via the helper's defensive
      // coercion.
      const preservedExtraBedCount = Number(booking.extraBedCount) || 0;
      const preservedExtraBedRate = Number(booking.extraBedRate) || 0;
      const breakfastTotal = manualNightlyRate === null
        ? calculateBreakfastAddOn({
            hasBreakfast: booking.hasBreakfast,
            breakfastRate,
            numGuests: booking.numGuests,
            numNights,
            breakfastIncludesChildren: booking.breakfastIncludesChildren
          })
        : 0;
      const extraBedTotal = manualNightlyRate === null
        ? calculateExtraBedAddOn({
            extraBedCount: preservedExtraBedCount,
            extraBedRate: preservedExtraBedRate,
            numNights
          })
        : 0;
      const subtotal = roomTotal + breakfastTotal + extraBedTotal;

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
          // Per DSC (2026-07-31): the percentage step and the clamped
          // `subtotal − senior` subtraction now route through the shared
          // `calculatePercentDiscount` + `calculateVoucherBase` helpers.
          // Byte-equivalent output: same `Math.round` wrap, same clamp.
          const seniorPwdDiscountForVoucher = Math.round(calculatePercentDiscount(subtotal, discountPct));
          const voucherBase = calculateVoucherBase(subtotal, seniorPwdDiscountForVoucher);
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

      // Per DSC-01..05 (2026-08-01, per CVQ-06): the chain now
      // routes through the shared `calculateDiscountChain` helper
      // with the booking's snapshotted per-class scope. Legacy
      // bookings without the field read as the broad default
      // via `normalizeDiscountScope`. The chain is byte-equivalent
      // to the previous inline math for the broad default
      // scope; for narrow scopes it applies the scope to the
      // senior + voucher + member steps. `round: true` preserves
      // the server's per-step `Math.round(...)` wrap. The chain
      // returns the post-discount total; the points-redemption
      // deduction is applied separately below (preserved as-is).
      const rescheduleChain = calculateDiscountChain({
        roomTotal,
        breakfastTotal,
        extraBedTotal,
        seniorPct: discountPct,
        voucherAmount: voucherDiscount,
        memberPct: appliedMemberDiscountPct,
        scope: normalizeDiscountScope(booking.discountScopeSnapshot),
        round: true
      });
      const totalPrice = rescheduleChain.total;
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
      // Per MRB-02.x (2026-08-02, per decision #164):
      // update the reservation header in the SAME
      // transaction as the booking update. The header's
      // date range + totals + `requestFingerprint` reflect
      // the new state. The fingerprint computation
      // re-uses the existing booking's source / corporate
      // / member context (the reschedule doesn't change
      // those — only the dates/room/rate change) + the
      // NEW checkIn/checkOut + the NEW room's type. The
      // fingerprint's `roomLines[0].type` uses the NEW
      // room's type (the same field the create + walkin
      // paths use); the adults/children/extraBeds mirror
      // the existing booking's snapshotted occupancy
      // (the reschedule doesn't change occupancy — only
      // dates + room). When the booking is legacy
      // (no `reservationId`), this block is skipped
      // entirely — the booking's own fields remain the
      // source of truth.
      if (reservationDocRef && existingReservationData) {
        const rescheduleFingerprint = computeRequestFingerprint({
          reservationId: bookingReservationId as string,
          roomLines: [{
            type: String(room.type || "").trim(),
            quantity: 1,
            adults: Math.max(0, Math.floor(Number(booking.numAdults ?? booking.numGuests) || 0)),
            children: Math.max(0, Math.floor(Number(booking.numChildren) || 0)),
            extraBeds: Math.max(0, Math.floor(Number(booking.extraBedCount) || 0))
          }],
          checkIn: String(checkIn || "").trim(),
          checkOut: String(checkOut || "").trim(),
          leadGuestName: String(booking.guestName || "").trim(),
          leadGuestEmail: String(booking.guestEmail || "").trim().toLowerCase(),
          leadGuestPhone: String(booking.guestPhone || "").trim(),
          source: String(booking.source || (booking.isCorporate ? "corporate" : "online")).trim(),
          isCorporate: Boolean(booking.isCorporate),
          corporateCode: String(booking.corporateCode || "").trim().toUpperCase(),
          companyName: String(booking.companyName || "").trim(),
          voucherCode: String(booking.voucherCode || "").trim().toUpperCase(),
          memberDiscountPct: Math.max(0, Math.floor(Number(booking.memberDiscountPct) || 0)),
          discountScope: normalizeDiscountScope(booking.discountScopeSnapshot),
          termsVersion: String(existingReservationData.termsVersion || DEFAULT_TERMS_VERSION),
          privacyVersion: String(existingReservationData.privacyVersion || DEFAULT_TERMS_VERSION)
        });
        transaction.update(reservationDocRef, {
          checkIn: Timestamp.fromDate(checkInDate),
          checkOut: Timestamp.fromDate(checkOutDate),
          numNights,
          // The reservation-level totals track the
          // child booking's `totalPrice` for the
          // single-room case (the reschedule
          // re-derives the child's total from the new
          // dates/room). The MRB-04 generalization
          // sums across children for the N>1 case —
          // single-room here so the simple assignment
          // is byte-equivalent.
          totalPrice: finalTotalPrice,
          subtotal: originalTotalPrice,
          originalSubtotal: originalTotalPrice,
          // The fingerprint is INTENTIONALLY allowed
          // to change on reschedule — the reschedule
          // IS the legitimate request to change the
          // fingerprint (the dates + room changed).
          // Replaying the same `reservationId` with a
          // different fingerprint is the natural
          // reschedule flow, not a conflict.
          requestFingerprint: rescheduleFingerprint,
          updatedAt: now
        });
      }
      // Per PEX-03 (2026-08-01, per decision #147): same
      // in-transaction retirement as handleCreateBooking /
      // handleCreateWalkin. The reschedule transaction may
      // displace an expired `pending` hold on the target room
      // (or the same room, for a dates-only move).
      for (const retirement of expiredHoldRetirements) {
        transaction.update(retirement.ref, {
          status: "cancelled",
          cancellationReason: EXPIRED_HOLD_CANCELLATION_REASON,
          // Per CRL-02 (2026-08-02): the in-transaction retirement
          // is a server-initiated cancellation, so the audit
          // metadata is `cancelledBy: "system"` +
          // `cancellationSource: "system"`. The canonical
          // EXPIRED_HOLD_CANCELLATION_REASON stays as the reason
          // string — CRL-02 adds the parallel discriminator, it
          // does not replace the existing one. Reports + emails
          // can switch on either field.
          cancelledBy: "system",
          cancellationSource: "system",
          cancelledAt: now,
          updatedAt: now
        });
      }
    });

    // Send email to guest
    if (fullBookingForEmail) {
      try {
        await sendBookingTrigger("booking-rescheduled", fullBookingForEmail);
      } catch (emailErr) {
        console.error("Failed to send reschedule email:", emailErr);
      }
    }

    // Per PEX-05 (2026-08-01, per decision #147): same
    // per-retirement email send as handleCreateBooking /
    // handleCreateWalkin. Best-effort, outside the transaction.
    for (const retirement of expiredHoldRetirements) {
      if (!retirement.guestEmail) continue;
      try {
        await sendBookingTrigger("booking-cancelled", {
          bookingRef: retirement.bookingRef,
          guestEmail: retirement.guestEmail,
          source: "online",
          notes: "Held until " + (retirement.holdExpiresAt ? retirement.holdExpiresAt.toISOString() : "unknown")
            + " — your reservation has been released. Please rebook at /book to choose new dates."
        });
      } catch (expiredEmailErr) {
        console.error("Failed to send reschedule retired-hold email for", retirement.bookingRef, expiredEmailErr);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        // Per MRB-02.x (2026-08-02, per decision #164):
        // echo the reservation linkage in the reschedule
        // success payload. The booking update + the
        // reservation header update both committed in the
        // same transaction, so the response carries both
        // ids. For legacy null-`reservationId` bookings
        // the `reservationId` + `reservationRef` are
        // empty strings (the booking was created before
        // MRB-02, so it has no header to echo).
        ...updatedBooking,
        reservationId: bookingReservationId || "",
        reservationRef: String((existingReservationData as any)?.reservationRef || "")
      }
    });
  } catch (error: any) {
    // Per MRB-02.x (2026-08-02, per decision #164): the
    // half-stamped state (booking has `reservationId`
    // but the corresponding `reservations/{id}` header
    // is missing) is a 500 — the state is
    // unrecoverable by the request and must be flagged
    // to staff. The pre-existing 400 path handles every
    // other error (validation, occupancy, rate
    // recalc) — those stay 400 because the staff can
    // fix them by adjusting the input.
    if (error?.message === "RESERVATION_HEADER_WITHOUT_CHILD") {
      return res.status(500).json({
        success: false,
        error: "Booking has a reservation id but the reservation header is missing — please contact support."
      });
    }
    return res.status(400).json({ success: false, error: error.message || "Failed to move booking." });
  }
}
