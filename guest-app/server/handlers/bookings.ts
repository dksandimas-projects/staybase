import { adminAuth, adminDb } from "../lib/firebase-admin";
import { hashToken } from "./test-runs";
import { Timestamp } from "firebase-admin/firestore";
import { sendBookingTrigger, sendBookingConfirmedWithBalanceTrigger, sendStaffNewBookingTrigger, sendStaffNewPaymentTrigger, sendEarlyCheckinResolveTrigger, buildReservationEmailView } from "./email";
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
  AddRoomBookingSchema,
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
  createCancellationPolicySnapshot,
  computeReservationAggregatePaymentStatus
} from "@spark-inn/shared";
// Per CRL-06 (2026-08-02): the preview helper
// (per-scope breakdown). The preview
// handler reads the same `ref + (email | token)`
// credential as the destructive cancel, but
// precomputes the financial effect WITHOUT mutating
// anything. The guest + admin modals render the
// breakdown before the user taps confirm. Imports
// live in a separate block (not appended to the
// MRB-05 import list above) so the existing
// `mrb-05-aggregate-and-handler-mirror.test.ts`
// source-text pattern — which asserts the
// `computeReservationAggregatePaymentStatus,?`
// entry is the last in the import block — still
// matches.
import {
  evaluateCancelPreview,
  buildCancellationLiabilitySnapshot,
  assertBookingRevenueAllocationInvariant
} from "@spark-inn/shared";
import type { BookingRateBreakdown } from "@spark-inn/shared";
import { DEFAULT_TERMS_VERSION } from "@spark-inn/shared";
// Per BAR-03 (2026-08-08, per decision #204): the
// shared FOL-05 sibling-flip helper. The pre-BAR-03
// `handleVerifyAndRecordPayment` + `handleAddPayment`
// + `handleRejectPayment` each open-coded the same
// sibling-flip pass. The helper collapses the three
// copies into one; each handler passes a per-handler
// `rule.decide` callback + the shared `now`.
import {
  preReadSiblingChildren,
  applyReservationScopePaymentTransition,
  type SiblingFlipDecision
} from "./reservationScopeTransition";
// Per MRB-11 (2026-08-03, per decision #177): the
// optional revenue allocation input. Per the 2026-08-03
// design call, the server always recomputes this before
// the write — the input is accepted but the server's
// `computeBookingRevenueAllocation` is the only value
// written to the doc. Pre-MRB-11 callers omit it.
import { BookingRevenueAllocationSchema } from "@spark-inn/shared/schemas/booking";
// Per PMH-02 (2026-07-31): the server's inline folio math (used
// by the create / confirm-with-balance / post-checkout transactions)
// now routes through the shared `computeServerFolioTotals` helper
// so MRB-04 edits one function instead of three.
import { computeServerFolioTotals, calculateBreakfastAddOn, computeReservationActualDateRange, generateBookingRef } from "@spark-inn/shared";
import { z } from "zod";
import config from "../../../hotel.config";
import { buildRateBreakdown, rebuildEarlyCheckoutRateBreakdown, rebuildRateBreakdown } from "../lib/rate-breakdown";

export function getConfiguredBookingRefPrefix() {
  return config.bookingRefPrefix || "SI";
}

// Per CRL-07 (2026-08-03, per decision #173): the
// in-transaction liability snapshot helper. Called by
// both cancel branches (the per-child path and the
// reservation-scope path) inside the same `runTransaction`
// as the status flip, so the snapshot is atomic with
// the audit stamps. Returns `null` when the policy
// refunds nothing (`policyRefund === 0`) — the absence
// of the `cancellationLiability` field on the cancelled
// entity is the "no liability work to do" signal the
// admin UI + Reports use to skip the panel.
//
// The function is read-only within the transaction
// (no writes), so the caller is responsible for
// including the returned snapshot in the appropriate
// `transaction.update` call. The shape matches
// `CancellationLiability` in `shared/types` so the
// server + client + Reports all agree on the same
// field structure.
async function computeCancellationLiabilityInTransaction(
  transaction: FirebaseFirestore.Transaction,
  params: {
    now: Date;
    scope: "room" | "reservation";
    lookedUpBooking: {
      id: string;
      bookingRef: string;
      status: string;
      roomType: string;
      totalPrice: number;
      reservationPosition: number | null;
      cancellationPolicySnapshot: any;
    };
    reservation: {
      id: string;
      reservationRef: string;
      totalPrice: number;
    } | null;
    cancellableChildren: Array<{
      id: string;
      bookingRef: string;
      status: string;
      roomType: string;
      totalPrice: number;
      reservationPosition: number | null;
      cancellationPolicySnapshot: any;
    }>;
  }
): Promise<import("@spark-inn/shared").CancellationLiability | null> {
  // Read the reservation folio (new path) or the
  // legacy booking payments subcollection. The
  // sign-aware sum (refunds are negative per CRL-01)
  // is the same shape the preview handler uses
  // (mirrors `getReservationFolioSummary`'s internal
  // math). For the legacy path the booking's own
  // payments subcollection carries BOTH positive
  // payments + negative refund entries (CRL-01's
  // historical convention).
  let reservationNetCollected = 0;
  if (params.reservation) {
    const reservationRef = adminDb.collection("reservations").doc(params.reservation.id);
    const [reservationPaymentsSnap, reservationRefundsSnap] = await Promise.all([
      transaction.get(reservationRef.collection("payments")),
      transaction.get(reservationRef.collection("refunds"))
    ]);
    reservationNetCollected =
      reservationPaymentsSnap.docs.reduce(
        (sum: number, d: any) => sum + (Number(d.data()?.amount) || 0),
        0
      ) +
      reservationRefundsSnap.docs.reduce(
        (sum: number, d: any) => sum + (Number(d.data()?.amount) || 0),
        0
      );
  } else {
    const legacyFolioSnap = await transaction.get(
      adminDb.collection("bookings").doc(params.lookedUpBooking.id).collection("payments")
    );
    reservationNetCollected = legacyFolioSnap.docs.reduce(
      (sum: number, d: any) => sum + (Number(d.data()?.amount) || 0),
      0
    );
  }
  // The `allocationSubtotal` for the snapshot uses
  // the cancellable subtotal — the same rule CRL-06
  // applies to the preview (a room-scope preview on
  // a multi-room reservation uses every currently
  // cancellable sibling as the denominator, never
  // attributes the whole reservation payment to one
  // room). The cancellation mirrors the preview so
  // the snapshot matches what the user saw on the
  // modal.
  const cancellableSubtotal = params.cancellableChildren.reduce(
    (sum, c) => sum + Math.max(Number(c.totalPrice) || 0, 0),
    0
  );
  const allocationSubtotal = params.scope === "reservation"
    ? cancellableSubtotal
    : Math.max(cancellableSubtotal, Math.max(Number(params.lookedUpBooking.totalPrice) || 0, 0));
  const preview = evaluateCancelPreview({
    scope: params.scope,
    now: params.now,
    lookedUpBooking: params.lookedUpBooking,
    reservation: params.reservation,
    cancellableChildren: params.cancellableChildren,
    reservationNetCollected,
    allocationSubtotal
  });
  // `policyRefund === 0` is the "no liability work to
  // do" exit. The destructive cancel never auto-refunds
  // (CRL-04), so a no-refund cancel doesn't need a
  // snapshot — the absence of the field on the
  // cancelled entity is the same signal a `not-required`
  // state would give the UI.
  if (preview.policyRefund <= 0) {
    return null;
  }
  return buildCancellationLiabilitySnapshot({
    now: params.now,
    policyRefund: preview.policyRefund,
    netCollected: preview.netCollected,
    retainedAmount: preview.retainedAmount,
    refundPct: preview.refundPct,
    cutoffHours: preview.cutoffHours,
    source: preview.policySource
  });
}

// Per MRB-09 (2026-08-02, per decision #168): the
// reservation-scope email view builder. Synthesises
// the reservation header + N child docs from the
// captured create-transaction data and hands them
// to `buildReservationEmailView`. The returned view
// is what the create/confirm/payment-confirmed/
// reschedule/checkin-reminder handlers pass to
// `sendBookingTrigger` instead of the per-first-child
// `computedData` shape the pre-MRB-09 code used.
//
// For N=1 the helper still produces a view with
// `rooms: [{ position: 1, ... }]` — the email
// templates' `bookingRows` recognises the array and
// renders the single-room table shape (visually the
// same as the legacy `bookingRows` output; the
// subject still uses the per-room ref for the N=1
// path, byte-equivalent to pre-MRB-09).
//
// For legacy single-room bookings without a
// `reservationId` (pre-MRB-01), the helper returns
// `null` and the caller falls through to the
// pre-MRB-09 single-room path.
function buildCreateEmailView(args: {
  reservationId: string;
  reservationRef: string;
  finalBookingRefs: string[];
  finalLookupTokens: string[];
  finalRooms: Array<{
    bookingId: string;
    roomId: string;
    roomNumber: string;
    roomType: string;
    reservationPosition: number;
    numAdults: number;
    numChildren: number;
    extraBedCount: number;
    hasBreakfast: boolean;
    totalPrice: number;
  }>;
  childPricing: Array<{
    rateBreakdown: any;
    activeRoomRate: number;
    finalHasBreakfast: boolean;
  }>;
  roomTypes: any[];
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  totalPrice: number;
  numNights: number;
  paymentMethod: string;
  paymentStatus: string;
  source: string;
  isCorporate: boolean;
  corporateCode: string;
  companyName: string;
}): any | null {
  if (!args.reservationId || !args.reservationRef) return null;
  if (!Array.isArray(args.finalRooms) || args.finalRooms.length === 0) return null;
  // Build the synthetic reservation header (the
  // values the email templates read).
  const reservation = {
    id: args.reservationId,
    reservationRef: args.reservationRef,
    leadGuestName: args.guestName,
    leadGuestEmail: args.guestEmail,
    leadGuestPhone: args.guestPhone,
    checkIn: null,
    checkOut: null,
    numNights: args.numNights,
    totalPrice: args.totalPrice,
    source: args.source,
    isCorporate: args.isCorporate,
    corporateCode: args.corporateCode,
    companyName: args.companyName,
    paymentMethod: args.paymentMethod,
    paymentStatus: args.paymentStatus
    // Per BAR-02 (2026-08-08, per decision #203):
    // the `activeRoomCount` and `cancelledRoomCount`
    // are not stamped onto the synthetic reservation
    // object either. The downstream email view
    // (and the page that renders it) derives
    // the count from the in-memory `children` array.
    // Pre-BAR-02 the synthetic object's
    // `activeRoomCount: args.finalRooms.length` was
    // a stub for the same value the helper now
    // computes directly.
  };
  // Build the synthetic child docs (the values
  // `buildReservationEmailView` reads for each
  // child). The `roomName` is the room type's
  // friendly label (or the type code as a
  // fallback) — matches the legacy single-room
  // `roomName` derivation.
  const children = args.finalRooms.map((room, index) => {
    const typeEntry = args.roomTypes.find((type: any) => type && type.value === room.roomType);
    const roomName = typeEntry?.label || typeEntry?.shortLabel || room.roomType;
    const pricing = args.childPricing[index] || { rateBreakdown: null, activeRoomRate: 0, finalHasBreakfast: false };
    return {
      id: room.bookingId,
      bookingRef: args.finalBookingRefs[index] || "",
      lookupToken: args.finalLookupTokens[index] || "",
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      roomName,
      numAdults: room.numAdults,
      numChildren: room.numChildren,
      extraBedCount: room.extraBedCount,
      hasBreakfast: pricing.finalHasBreakfast,
      ratePerNight: pricing.activeRoomRate,
      totalPrice: room.totalPrice,
      rateBreakdown: pricing.rateBreakdown,
      source: args.source,
      isCorporate: args.isCorporate,
      corporateCode: args.corporateCode,
      companyName: args.companyName,
      paymentMethod: args.paymentMethod,
      status: args.paymentStatus
    };
  });
  return buildReservationEmailView(reservation, children);
}

// Per MRB-09 (2026-08-02, per decision #168): the
// reservation-scope email view loader. Reads a
// single booking doc + (when it has a
// `reservationId`) the reservation header + every
// sibling child, then returns the
// `buildReservationEmailView` view. Returns `null`
// for legacy single-room bookings (pre-MRB-01,
// no `reservationId`) so the caller falls through
// to the pre-MRB-09 single-room path. The caller
// never has to know the difference — it just hands
// the result to `sendBookingTrigger`.
//
// Read in two queries (booking + reservation/siblings)
// because the email path is already off the critical
// write path. The booking doc + the reservation +
// children are read in parallel (one `Promise.all`)
// so the latency is the slower of the two, not the
// sum. The lookup is non-transactional — the email
// is informational, a stale room state on a single
// email is harmless, and the next email picks up the
// latest snapshot.
async function loadReservationEmailView(bookingId: string): Promise<any | null> {
  if (!bookingId) return null;
  const bookingRef = adminDb.collection("bookings").doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) return null;
  const booking = bookingSnap.data() || {};
  const reservationId = String(booking.reservationId || "").trim();
  if (!reservationId) return null;
  const reservationRef = adminDb.collection("reservations").doc(reservationId);
  const [reservationSnap, childrenSnap] = await Promise.all([
    reservationRef.get(),
    adminDb.collection("bookings")
      .where("reservationId", "==", reservationId)
      .get()
  ]);
  if (!reservationSnap.exists) return null;
  const children = childrenSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  const view = buildReservationEmailView({ id: reservationId, ...reservationSnap.data() }, children);
  if (!view) return null;
  // Per CRL-08 (2026-08-03, per decision #174): the
  // cancellation + refund-processed email templates
  // render the live liability state. Read the
  // stored snapshot + the cumulative
  // `processedAmount` from the refunds subcollection
  // and attach the projection. The view builder
  // itself stays pure (the projection is best-effort
  // and falls through to `null` when the snapshot
  // is absent — a pre-CRL-07 cancel or a no-refund
  // cancel). The dual-source read (reservation
  // header → booking doc fallthrough) is the same
  // shape `handleAddRefund` + the CRL-07
  // `handleGetCancellationLiability` use.
  const { loadLiabilityProjectionForEmail } = await import("./email");
  view.liabilityProjection = await loadLiabilityProjectionForEmail({
    reservationId,
    bookingId
  });
  return view;
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
      for (const key of ["bookingRef", "guestEmail", "token", "reservationRef", "turnstileToken"] as const) {
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
      // Per MRB-10 (2026-08-02, per decision #169): a
      // direct reservation-scope lookup. The MRB-09
      // reservation-scope emails carry a
      // `reservationRef` link (e.g. `/my-booking?reservationRef=…&email=…`)
      // so the guest can deep-link straight to the
      // reservation without first landing on a
      // per-child booking. The credential is unchanged
      // — `email` is the second factor; the auth gate
      // verifies the reservation's lead guest owns
      // the email.
      reservationRef: z
        .string()
        .trim()
        .max(40)
        .regex(/^R-\d{8}-\d{5}$/, "Invalid reservation reference format.")
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
      (data) => Boolean(data.bookingRef) || Boolean(data.reservationRef) || Boolean(data.guestEmail) || Boolean(data.token),
      "Provide a booking reference, reservation reference, email, or lookup token."
    )
    .refine(
      (data) => !(Boolean(data.guestEmail) && Boolean(data.token)),
      "Provide either an email or a lookup token (not both)."
    )
);

// Per MRB-13 (2026-08-02, per decision #166): the
// guest cancel schema gains an optional `scope`
// (`"room"` | `"reservation"`). Default `"room"`
// preserves byte-compatible single-child behavior —
// every existing caller that omits `scope` lands on
// the legacy per-child branch. The guest lookup page
// (per MRB-10) sends `"reservation"` when the looked-
// up booking is part of a multi-room reservation, and
// the admin BookingsPage cancel modal surfaces a
// `This room` / `All N rooms` selector when the
// selected booking has `reservationRoomCount > 1`.
// When `"reservation"` is set, the server cancels
// every cancellable child in one transaction (see
// `handleCancelBooking`) — the dedup rule (one
// decrement per shared voucher / corporate code) and
// the per-child loyalty clawback (MRB-05) are owned
// by that branch, not by the schema.
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
    reason: z.string().trim().max(500).optional().default(""),
    scope: z.enum(["room", "reservation"]).optional().default("room")
  })
  .refine(
    (data) => Boolean(data.guestEmail) !== Boolean(data.token),
    "Provide either an email or a lookup token (not both)."
  );

// Per CRL-06 (2026-08-02): the cancellation preview
// schema. Same `ref + (email | token)` credential as
// the destructive cancel, plus the optional `scope`
// selector. The schema deliberately has no
// `turnstileToken` requirement (the destructive
// cancel does — H1 hardening); the preview is a
// read-only endpoint gated by the same credential as
// the cancel, and the apiRouter applies a 10/min/IP
// rate limit so a brute-force probe is bounded
// independently of the cancel bucket. The `reason`
// field is intentionally absent — the preview is
// non-mutating, the reason is captured at confirm
// time.
const guestCancelPreviewSchema = z
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
    scope: z.enum(["room", "reservation"]).optional().default("room")
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

// Exported for the EXB-12 strict-schema regression test
// (see `tests/api/exb-12-strict-schema-acceptance.test.ts`).
// The schema is a pure Zod object — no Firebase dependency at
// parse time — so importing it from a unit test is safe and
// catches the entire class of "client sends a new field but
// the strict server schema rejects it" regressions that the
// regex-only test surface would miss.
export const publicRoomSelectionSchema = z.object({
  bookingId: z.string().trim().regex(PREALLOCATED_BOOKING_ID_REGEX).optional(),
  roomType: z.string().trim().min(1).max(120),
  numAdults: z.coerce.number().int().min(0).max(100),
  numChildren: z.coerce.number().int().min(0).max(100),
  extraBedCount: z.coerce.number().int().min(0).max(20).optional().default(0),
  hasBreakfast: z.boolean(),
  breakfastIncludesChildren: z.boolean().optional(),
  // Per EXB-12 (2026-08-06, per decision #199): the
  // per-room opt-in for breakfast on the extra-bed
  // occupant(s). The client sends this from the
  // per-type toggle in the Extras sub-section (or
  // always, even when false — the strict schema
  // would otherwise reject every booking because
  // EXB-12's body always includes the field).
  // The server enforces the invariant
  // `extraBedBreakfast implies extraBedCount > 0`
  // in the `validatedRoomStays` loop below.
  extraBedBreakfast: z.boolean().optional()
}).strict().superRefine((selection, ctx) => {
  if (selection.numAdults + selection.numChildren < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each room must have at least one guest."
    });
  }
});

function allocateRoundedAmount(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) {
    return safeWeights.map((_, index) => index === 0 ? safeTotal : 0);
  }
  const allocations = safeWeights.map((weight) => Math.floor((safeTotal * weight) / weightTotal));
  let remainder = safeTotal - allocations.reduce((sum, amount) => sum + amount, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % allocations.length) {
    allocations[index] += 1;
    remainder -= 1;
  }
  return allocations;
}

// Exported for the EXB-12 strict-schema regression test
// (see `tests/api/exb-12-strict-schema-acceptance.test.ts`).
// The schema is a pure Zod object — no Firebase dependency at
// parse time — so importing it from a unit test is safe and
// catches the entire class of "client sends a new field but
// the strict server schema rejects it" regressions that the
// regex-only test surface would miss.
export const createBookingSchema = z.object({
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
  // Per EXB-12 (2026-08-06, per decision #199): the
  // top-level extra-bed breakfast toggle. The client
  // always sends it (defaults to `false` from
  // `bookingRoomCart.ts:63`), so the strict schema
  // must accept the field. The server-side
  // authoritative value lives on each
  // `roomSelections[i].extraBedBreakfast` (per-room
  // pricing + invariant enforcement); this top-level
  // field is accepted for wire back-compat with the
  // EXB-12 client shape and otherwise unused.
  extraBedBreakfast: z.boolean().optional(),
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
  // MRB-06 Phase 3: the guest cart sends one explicit entry per
  // room stay so mixed room types and uneven guest distribution
  // remain unambiguous. Legacy callers may omit this array and
  // continue using roomType + roomCount + the top-level occupancy.
  roomSelections: z.array(publicRoomSelectionSchema).min(1).max(50).optional(),
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
  // Per MRB-11 (2026-08-03, per decision #177): the
  // optional revenue allocation. Per the 2026-08-03
  // design call, the server always computes this before
  // the write — the input is accepted but the server
  // recomputes via the same pricing chain and asserts
  // the `totalNet === booking.totalPrice` invariant at
  // the write boundary. Pre-MRB-11 callers omit it; the
  // server fills it in.
  revenueAllocation: BookingRevenueAllocationSchema.optional(),
  // Per LOW-1 (reports audit 2026-08-10) + DECISIONS-FEATURES.md #99:
  // the LOU (Letter of Undertaking) flag for corporate
  // chargeback bookings. The guest never sets this — the
  // field is staff-toggled post-creation via
  // `/api/bookings/set-lou-received` once the LOU arrives.
  // The schema accepts `true` (the rare case where the
  // corporate client supplied the LOU up-front and the
  // staff walks it in pre-marked) and `false` (the common
  // case — the booking is `pending` until the LOU workflow
  // resolves it). The field defaults to `false` so a
  // missing value matches the "LOU not yet received"
  // state.
  louReceived: z.boolean().optional().default(false),
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
    roomSelections: requestedRoomSelections,
    testToken
  } = body;

  const guestDetails: GuestDetails = rawGuestDetails;

  const normalizedRoomSelections = requestedRoomSelections?.length
    ? requestedRoomSelections.map((selection, index) => ({
        bookingId: index === 0
          ? bookingId
          : (selection.bookingId || adminDb.collection("bookings").doc().id),
        roomType: selection.roomType,
        numAdults: selection.numAdults,
        numChildren: selection.numChildren,
        extraBedCount: selection.extraBedCount || 0,
        hasBreakfast: selection.hasBreakfast,
        breakfastIncludesChildren: selection.breakfastIncludesChildren
      }))
    : Array.from({ length: roomCount }, (_, index) => ({
        bookingId: index === 0 ? bookingId : adminDb.collection("bookings").doc().id,
        roomType,
        numAdults: Math.max(0, Math.floor(Number(requestedNumAdults ?? guests) || 0)),
        numChildren: Math.max(0, Math.floor(Number(requestedNumChildren ?? 0) || 0)),
        extraBedCount: Math.max(0, Math.floor(Number(requestedExtraBedCount ?? 0) || 0)),
        hasBreakfast,
        breakfastIncludesChildren: requestedBreakfastIncludesChildren
      }));
  const requestedRoomCount = normalizedRoomSelections.length;
  const requestedGuestCount = normalizedRoomSelections.reduce(
    (sum, selection) => sum + selection.numAdults + selection.numChildren,
    0
  );
  if (requestedRoomSelections?.length && requestedGuestCount !== guests) {
    return res.status(400).json({
      success: false,
      error: `Guest distribution mismatch: the room assignments contain ${requestedGuestCount} guests, but the reservation total is ${guests}.`
    });
  }

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
    roomLines: normalizedRoomSelections.map((selection) => ({
      type: String(selection.roomType || "").trim(),
      quantity: 1,
      adults: selection.numAdults,
      children: selection.numChildren,
      extraBeds: selection.extraBedCount,
      hasBreakfast: selection.hasBreakfast,
      breakfastIncludesChildren: selection.breakfastIncludesChildren
    })),
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
    // Per MRB-09 (2026-08-02, per decision #168): the
    // per-room lookup tokens, captured inside the
    // transaction so the post-transaction reservation
    // email view can carry them in `rooms[].lookupToken`.
    // The first room's token equals
    // `finalBookingRef`'s associated token (the legacy
    // single-room `lookupToken` field, which the
    // receipt PDF + email lookup URL still use for the
    // N=1 path). N>1 populates the array with N
    // independent tokens.
    let finalLookupTokens: string[] = [];
    // Per MRB-02 (2026-08-02, per decision #164): the public
    // reservation ref (e.g. `R-20260802-00001`) is minted inside
    // the transaction (so it shares the same `now` + counter
    // transaction as the booking ref) and read in the
    // post-transaction success response. Same `finalX`
    // capture pattern as `finalBookingRef` /
    // `finalTotalPrice` / `finalRateBreakdown`.
    let finalReservationRef = "";
    let finalRooms: Array<{
      bookingId: string;
      roomId: string;
      roomNumber: string;
      roomType: string;
      reservationPosition: number;
      numAdults: number;
      numChildren: number;
      extraBedCount: number;
      hasBreakfast: boolean;
      totalPrice: number;
    }> = [];
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
            totalPrice: Number(existingData.totalPrice || existingChild.totalPrice || 0),
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
      const resolvedRoomSelections = normalizedRoomSelections.map((selection) => {
        const rawSelectionType = roomTypesArr.find(
          (entry) => entry && entry.value === selection.roomType
        );
        if (!rawSelectionType) {
          throw new Error(requestedRoomSelections?.length
            ? `Selected room type is not available: ${selection.roomType}.`
            : "Selected room type is not available.");
        }
        return {
          ...selection,
          typeEntry: applyRoomTypeDefaults(rawSelectionType)
        };
      });
      const primaryRoomType = resolvedRoomSelections[0]?.roomType || roomType;
      const rawTypeEntry = roomTypesArr.find((entry) => entry && entry.value === primaryRoomType);
      if (!rawTypeEntry) {
        throw new Error("Selected room type is not available.");
      }
      const typeEntry = applyRoomTypeDefaults(rawTypeEntry);
      const typeMaxCapacity = Number(typeEntry.maxCapacity) || 0;
      const typeBaseRate = Number(typeEntry.pricePerNight) || 0;
      const typeWeekendRate = Number(typeEntry.weekendRate) || 0;
      const typeCorporateRate = Number(typeEntry.corporateRate) || 0;
      const seasonalRateOverrides = normalizeSeasonalRateOverrides(hotelConfig.seasonalRateOverrides);

      // 2. Load the active physical-room candidates for every type
      // represented in the cart. All candidate reads stay inside the
      // create transaction; assignment below consumes each physical
      // room at most once.
      const candidatesByType = new Map<string, Array<{ id: string; data: any }>>();
      for (const typeValue of [...new Set(resolvedRoomSelections.map((selection) => selection.roomType))]) {
        const candidatesQuery = adminDb.collection("rooms")
          .where("type", "==", typeValue)
          .where("isActive", "==", true);
        const candidatesSnapshot = await transaction.get(candidatesQuery);
        const candidates = candidatesSnapshot.docs
          .map((d) => ({ id: d.id, data: d.data() }))
          .filter((candidate) => candidate.data)
          .sort((a, b) => {
            const an = String(a.data.roomNumber || a.id);
            const bn = String(b.data.roomNumber || b.id);
            return an.localeCompare(bn, undefined, { numeric: true });
          });
        candidatesByType.set(typeValue, candidates);
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
      const assignedRooms: Array<{
        id: string;
        data: any;
        selection: typeof resolvedRoomSelections[number];
      }> = [];
      const assignedRoomIds: string[] = [];
      for (const selection of resolvedRoomSelections) {
        const candidates = candidatesByType.get(selection.roomType) || [];
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
        assignedRooms.push({ ...foundThisRound, selection });
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
      const validatedRoomStays = assignedRooms.map((assignedRoom, index) => {
        const selection = assignedRoom.selection;
        const selectionType = selection.typeEntry;
        const numAdults = selection.numAdults;
        const numChildren = selection.numChildren;
        const extraBedCount = selection.extraBedCount;
        if (
          !requestedRoomSelections?.length
          && index === 0
          && numAdults + numChildren !== guests
        ) {
          throw new Error(
            `Occupancy split mismatch: numAdults (${numAdults}) + numChildren (${numChildren}) must equal guests (${guests}).`
          );
        }
        if (numAdults < 1) {
          throw new Error(`Room ${index + 1} must include at least one adult.`);
        }
        const maxCapacity = Math.max(0, Number(selectionType.maxCapacity) || 0);
        const maxChildren = Math.max(0, Number(selectionType.maxChildren) || 0);
        const maxExtraBeds = Math.max(0, Number(selectionType.maxExtraBeds) || 0);
        if (extraBedCount > maxExtraBeds) {
          throw new Error(
            `Extra bed count (${extraBedCount}) exceeds ${selectionType.label || selection.roomType}'s allowance (${maxExtraBeds}).`
          );
        }
        const overflow = requiredExtraBedsFor({
          numAdults,
          numChildren,
          maxCapacity,
          maxChildren
        });
        if (overflow.requiredExtraBeds > extraBedCount) {
          throw new Error(requestedRoomSelections?.length
            ? `Room ${index + 1} needs ${overflow.requiredExtraBeds} extra bed(s), but only ${extraBedCount} selected.`
            : `Not enough extra beds: ${overflow.overflowAdults} overflow adult(s) + ${overflow.overflowChildren} overflow child(ren) = ${overflow.requiredExtraBeds} extra bed(s) needed, but only ${extraBedCount} extra bed(s) selected. The room type allows up to ${maxExtraBeds} extra bed(s).`
          );
        }
        // Per EXB-12 (2026-08-06, per decision #199): the
        // extra-bed breakfast toggle. The user opts in to
        // breakfast for the extra-bed occupant(s). The server
        // validates the invariant: `extraBedBreakfast`
        // can only be `true` when `extraBedCount > 0`. A
        // `true` toggle with 0 extra beds is a client bug
        // (or a stale URL); we force it off here so the
        // breakfast total isn't inflated by phantom beds.
        const extraBedBreakfast = selection.extraBedBreakfast === true && extraBedCount > 0;
        return {
          ...assignedRoom,
          numAdults,
          numChildren,
          numGuests: numAdults + numChildren,
          extraBedCount,
          extraBedRate: extraBedCount > 0
            ? Math.max(0, Number(selectionType.extraBedRate) || 0)
            : 0,
          // Per EXB-12: snapshot the breakfast-for-extra-beds
          // toggle onto the validated stay. The pricing loop
          // reads this to count the extra beds toward the
          // breakfast total (same rate as adult breakfast).
          extraBedBreakfast,
          breakfastIncludesChildren: selection.breakfastIncludesChildren !== undefined
            ? selection.breakfastIncludesChildren
            : breakfastIncludesChildrenDefault
        };
      });
      const numAdults = validatedRoomStays[0].numAdults;
      const numChildren = validatedRoomStays[0].numChildren;
      const extraBedCount = validatedRoomStays[0].extraBedCount;
      const extraBedRate = validatedRoomStays[0].extraBedRate;
      const totalExtraBeds = validatedRoomStays.reduce(
        (sum, stay) => sum + stay.extraBedCount,
        0
      );

      // EXB-10 remains reservation-atomic: the inventory request is
      // the sum of all room stays, not a per-room check that could
      // pass independently and over-consume the hotel's stock.
      if (totalExtraBeds > 0) {
        const extraBedOverlapQuery = adminDb.collection("bookings")
          .where("status", "in", ROOM_OCCUPYING_STATUSES);
        const extraBedOverlapSnapshot = await transaction.get(extraBedOverlapQuery);
        const extraBedInUse = countExtraBedsInUse(
          extraBedOverlapSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
          checkInDate,
          checkOutDate
        );
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
      let corpCodeDoc: any = null;
      // Per MRB-08 (2026-08-02, per decision #167): the
      // negotiated-rate lookup is now per-stay, not
      // per-primary-type. A mixed-type corporate block (e.g.
      // 2× Standard + 1× Deluxe) used to charge every stay
      // the primary type's negotiated rate, silently
      // overcharging a Deluxe stay or undercharging a Standard
      // stay. We precompute a `Record<roomType, number>` from
      // `corpData.ratePerRoomType` so the per-stay branch
      // below can resolve the correct negotiated rate without
      // re-reading the doc.
      let perStayNegotiatedRate: Record<string, number> | null = null;

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
        corpCodeDoc = await transaction.get(corporateCodeRef);
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
          // Per MRB-08 (2026-08-02, per decision #167): the
          // cap check inside the create transaction must
          // account for the N rooms the reservation will
          // consume in one go. A 5-room block against a cap
          // of 6 with `usageCount: 4` is fine
          // (`4 + 5 ≤ 6`); a 5-room block against the same
          // cap with `usageCount: 2` is not
          // (`2 + 5 > 6`). The pre-MRB-08 cap check
          // (`usageCount >= usageCap`) would have allowed
          // the over-cap reservation to slip through and
          // silently push the cap past its limit.
          const corpValidation = validateCorporateCode({
            isActive: corpData.isActive !== false,
            expiresAt: toDateOrNull(corpData.expiresAt),
            usageCap: corpData.usageCap ?? null,
            usageCount: corpData.usageCount || 0
          }, { requestedUses: assignedRooms.length });
          if (corpValidation.valid) {
            corporateDetails.isCorporate = true;
            corporateDetails.corporateCode = formattedCorpCode;
            // The doc's companyName is the source of truth — the
            // body's guestDetails.companyName is informational only.
            corporateDetails.companyName = corpData.companyName || "";
            // Per MRB-08: capture the entire negotiated
            // `ratePerRoomType` map. The per-stay branch
            // below resolves the rate for each stay's
            // `roomType` from this map (then falls back to
            // the stay type's flat `corporateRate`, then the
            // standard `pricePerNight`). The pre-MRB-08 code
            // resolved only the primary `roomType`'s rate
            // and re-used it for every stay, which priced a
            // mixed-type block incorrectly.
            if (corpData.ratePerRoomType && typeof corpData.ratePerRoomType === "object") {
              perStayNegotiatedRate = { ...corpData.ratePerRoomType };
              // Back-compat: the primary type's rate
              // is still surfaced as `activeRoomRate` so
              // the single-room legacy read sites (the
              // booking doc's top-level `ratePerNight`
              // when N=1) continue to match the per-stay
              // write.
              if (perStayNegotiatedRate[roomType] !== undefined) {
                activeRoomRate = perStayNegotiatedRate[roomType];
              } else if (typeCorporateRate) {
                activeRoomRate = typeCorporateRate;
              }
            } else if (typeCorporateRate) {
              activeRoomRate = typeCorporateRate;
            }
            // BI-07 / BR-01: increment usageCount inside the same
            // transaction, but defer the write until after every
            // transaction read has completed. The Firestore Admin
            // SDK rejects reads after queued writes.
            // Per MRB-08 (2026-08-02, per decision #167):
            // N rooms = N uses. The pre-MRB-08 code added
            // exactly 1, which turned a `usageCap: 5` code
            // into effectively unlimited when each
            // reservation carried 2+ rooms. The
            // `assignedRooms.length` here is the count of
            // rooms the transaction has successfully claimed
            // — at this point it equals
            // `resolvedRoomSelections.length` (the loop
            // aborts the transaction on the first
            // unavailable room) so the increment can never
            // exceed the requested N.
            corporateCodeUsageUpdate = {
              ref: corporateCodeRef,
              data: {
                usageCount: (corpData.usageCount || 0) + assignedRooms.length,
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
      const roomStayPricing = validatedRoomStays.map((stay, index) => {
        const stayType = stay.selection.typeEntry;
        const baseRate = Number(stayType.pricePerNight) || 0;
        const stayCorporateRate = Number(stayType.corporateRate) || 0;
        // Per MRB-08 (2026-08-02, per decision #167): the
        // negotiated rate is now resolved PER STAY, not
        // per primary type. The fallback chain is
        //   1. `perStayNegotiatedRate[stay.roomType]`
        //      (the corporateCodes doc's per-type map
        //      entry for THIS stay's type)
        //   2. the stay type's flat `corporateRate`
        //   3. the stay type's standard `pricePerNight`
        // The pre-MRB-08 code (`index === 0 ?
        // activeRoomRate : (stayCorporateRate > 0 ?
        // stayCorporateRate : baseRate)`) priced every
        // non-primary stay with the flat type's
        // corporateRate, silently overcharging a mixed
        // block whose non-primary types lack a flat rate
        // (fell through to the standard rate) and
        // undercharging one whose non-primary types have
        // a higher flat rate than the negotiated rate.
        const negotiatedForThisStay = perStayNegotiatedRate
          ? perStayNegotiatedRate[stayType.value]
          : undefined;
        const stayActiveRate = corporateDetails.isCorporate
          ? (negotiatedForThisStay !== undefined
              ? negotiatedForThisStay
              : (stayCorporateRate > 0 ? stayCorporateRate : baseRate))
          : baseRate;
        const stayRoomBreakdown = corporateDetails.isCorporate
          ? {
              roomSubtotal: stayActiveRate * numNights,
              roomLines: [{
                source: "corporate" as const,
                label: corporateDetails.corporateCode ? "Corporate negotiated rate" : "Corporate flat rate",
                startDate: checkIn,
                endDate: checkOut,
                nights: numNights,
                nightlyRate: stayActiveRate,
                subtotal: stayActiveRate * numNights
              }]
            }
          : calculateSeasonalAwareRoomBreakdown({
              checkIn: checkInDate,
              checkOut: checkOutDate,
              roomType: stay.selection.roomType,
              baseRate: stayActiveRate,
              weekendRate: Number(stayType.weekendRate) || 0,
              seasonalRateOverrides
            });
        const stayHasBreakfast = breakfastConfig.isEnabled && stay.selection.hasBreakfast;
        const stayBreakfastTotal = calculateBreakfastAddOn({
          hasBreakfast: stayHasBreakfast,
          breakfastRate: actualBreakfastRate,
          numGuests: stay.numGuests,
          numAdults: stay.numAdults,
          numChildren: stay.numChildren,
          numNights,
          breakfastIncludesChildren: stay.breakfastIncludesChildren,
          // Per EXB-12 (2026-08-06, per decision #199):
          // when the guest opts in to breakfast for the
          // extra-bed occupant(s), the helper counts
          // `extraBedCount` toward the breakfast total
          // (priced as `breakfastRate × extraBedCount ×
          // numNights`). The toggle is per-type, snapshotted
          // onto the validated stay above. The invariant
          // `extraBedBreakfast implies extraBedCount > 0`
          // is enforced above.
          extraBedCount: stay.extraBedCount,
          extraBedBreakfast: stay.extraBedBreakfast === true
        });
        const stayExtraBedTotal = calculateExtraBedAddOn({
          extraBedCount: stay.extraBedCount,
          extraBedRate: stay.extraBedRate,
          numNights
        });
        return {
          ...stay,
          activeRoomRate: stayActiveRate,
          roomBreakdown: stayRoomBreakdown,
          roomTotal: stayRoomBreakdown.roomSubtotal,
          finalHasBreakfast: stayHasBreakfast,
          breakfastTotal: stayBreakfastTotal,
          extraBedTotal: stayExtraBedTotal,
          subtotal: stayRoomBreakdown.roomSubtotal + stayBreakfastTotal + stayExtraBedTotal
        };
      });
      const roomBreakdown = {
        roomSubtotal: roomStayPricing.reduce((sum, stay) => sum + stay.roomTotal, 0),
        roomLines: roomStayPricing.flatMap((stay, index) =>
          stay.roomBreakdown.roomLines.map((line) => ({
            ...line,
            label: requestedRoomCount > 1
              ? `${stay.selection.typeEntry.label || stay.selection.roomType} ${index + 1} — ${line.label}`
              : line.label
          }))
        )
      };
      const roomTotal = roomBreakdown.roomSubtotal;
      const breakfastTotal = roomStayPricing.reduce((sum, stay) => sum + stay.breakfastTotal, 0);
      const extraBedTotal = roomStayPricing.reduce((sum, stay) => sum + stay.extraBedTotal, 0);
      const subtotal = roomTotal + breakfastTotal + extraBedTotal;
      const finalHasBreakfast = roomStayPricing[0].finalHasBreakfast;

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
          const assignedTypesMatchChosen = assignedRooms.every(
            (assignedRoom) => assignedRoom.data.type === assignedRoom.selection.roomType
          );
          const applicableTypes = Array.isArray(vData.applicableRoomTypes)
            ? vData.applicableRoomTypes
            : [];
          const allSelectedTypesApplicable = applicableTypes.length === 0
            || resolvedRoomSelections.every((selection) => applicableTypes.includes(selection.roomType));
          const isValid =
            vData.isActive !== false &&
            (!voucherExpiresAt || voucherExpiresAt >= now) &&
            (vData.usageCap === null || (vData.usageCount || 0) < vData.usageCap) &&
            // Per BF-19 (booking-flow audit 2026-06-26): the
            // empty-or-undefined case is covered by the optional
            // chaining below; drop the redundant `!vData.applicableRoomTypes`
            // short-circuit. The `length === 0` covers both the
            // "empty array" and "falsy" cases via `?.length ?? 0`.
            allSelectedTypesApplicable &&
            assignedTypesMatchChosen;

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
      const roomStayWeights = roomStayPricing.map((stay) => stay.subtotal);
      const allocatedChildTotals = allocateRoundedAmount(totalPrice, roomStayWeights);
      const allocatedVoucherDiscounts = allocateRoundedAmount(voucherDiscount, roomStayWeights);
      const allocatedDeductions = rateBreakdown.deductions.map((deduction) => ({
        label: deduction.label,
        amounts: allocateRoundedAmount(deduction.amount, roomStayWeights)
      }));
      const childPricing = roomStayPricing.map((stay, index) => ({
        ...stay,
        totalPrice: allocatedChildTotals[index],
        voucherDiscount: allocatedVoucherDiscounts[index],
        rateBreakdown: {
          roomSubtotal: stay.roomTotal,
          roomLines: stay.roomBreakdown.roomLines,
          addOns: [
            ...(stay.breakfastTotal > 0
              ? [{ label: "Breakfast add-on", amount: stay.breakfastTotal }]
              : []),
            ...(stay.extraBedTotal > 0
              ? [{
                  label: stay.extraBedCount > 1
                    ? `Extra bed add-on (${stay.extraBedCount} beds × ${numNights} ${numNights === 1 ? "night" : "nights"})`
                    : "Extra bed add-on",
                  amount: stay.extraBedTotal
                }]
              : [])
          ],
          deductions: allocatedDeductions.flatMap((deduction) =>
            deduction.amounts[index] > 0
              ? [{ label: deduction.label, amount: deduction.amounts[index] }]
              : []
          ),
          finalTotal: allocatedChildTotals[index]
        } as BookingRateBreakdown
      }));

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
      // Per MRB-06 Phase 2 follow-up (2026-08-02, per decision #159):
      // every room stay is its own booking with its own guest-facing
      // reference, so the reservation consumes N consecutive sequence
      // numbers. Sharing one ref across the N rooms made the ref
      // ambiguous — `plan/features/BOOKING-LOOKUP.md`'s "ref + email"
      // contract assumes a ref identifies exactly one room stay, so a
      // lookup against a shared ref could not say which room it meant.
      // For N=1 this is the single ref the pre-MRB-06 code minted.
      // Mirrors `handleCreateWalkin`'s `walkinBookingRefs`.
      const childBookingRefs = assignedRooms.map(
        (_, roomIdx) => `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence + roomIdx).padStart(5, "0")}`
      );
      const bookingRef = childBookingRefs[0];

      // Save output for outer scope
      finalBookingRef = bookingRef;
      finalTotalPrice = totalPrice;
      finalRateBreakdown = rateBreakdown;
      // Per MRB-03 (2026-08-02, per decision #159): the
      // public reservation ref (`R-YYYYMMDD-NNNNN`) uses
      // the SAME counter as the booking refs, taking the
      // FIRST of the N sequence numbers this reservation
      // consumed. Sharing the counter with the booking refs
      // means a reservation and its rooms have adjacent seq
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
      // Per MRB-06 Phase 2 follow-up (2026-08-02, per decision #159):
      // the counter advances past every sequence number this
      // reservation consumed, so the next booking of the day cannot
      // reuse a ref already issued to one of these rooms. For N=1 this
      // is the pre-MRB-06 single increment.
      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence + assignedRooms.length - 1 });
      } else {
        transaction.set(counterRef, { count: assignedRooms.length });
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
        // Per LOW-1 (reports audit 2026-08-10) + DECISIONS-FEATURES.md #99:
        // the LOU (Letter of Undertaking) flag for corporate
        // chargeback bookings. Stamped from the request body
        // (rare — the LOU usually arrives later and the desk
        // toggles via `/api/bookings/set-lou-received`). Default
        // `false`. The field exists on every booking doc; the
        // `corporate.flat-rate / with-code` paths that arrive
        // via the public flow set it to the body value, the
        // walkin + convert-inquiry paths leave it at `false`
        // (chargeback doesn't apply to those surfaces).
        louReceived: body.louReceived === true,
        // Per BI-11 (booking-intercom audit 2026-07-06): the
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
      // Per CRL-05 (2026-08-02): compile the cancellation policy snapshot
      const websiteContent = websiteContentDoc.exists ? websiteContentDoc.data()! : {};
      const corpCodeData = corporateDetails.isCorporate && corpCodeDoc && corpCodeDoc.exists
        ? corpCodeDoc.data()
        : null;
      const cancellationPolicySnapshot = createCancellationPolicySnapshot({
        websiteContent,
        hotelConfig,
        checkInDateKey: checkIn,
        corporateCodeData: corpCodeData
      });

      const newReservation = {
        id: effectiveReservationId,
        reservationRef: finalReservationRef,
        leadGuestName: guestName,
        cancellationPolicySnapshot,
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
        originalSubtotal: subtotal,
        discountScopeSnapshot: snapshottedDiscountScope,
        subtotal,
        totalPrice,
        // Per MRB-11 (2026-08-03, per decision #177):
        // the aggregate of every child booking's
        // `revenueAllocation`. Reports reads this for
        // fast reservation-level revenue stream totals.
        // The invariant
        // `aggregateRoomNet + aggregateBreakfastNet + aggregateAddOnNet - aggregateDeductionNet === aggregateTotalNet`
        // holds by construction (the aggregate is the
        // sum of children, each of which already passes
        // the invariant). The totalPrice match is exact.
        aggregateRevenueAllocation: assertBookingRevenueAllocationInvariant(
          {
            roomNet: childPricing.reduce(
              (sum, pricing) => sum + (Number(pricing.roomTotal) || 0),
              0
            ),
            breakfastNet: childPricing.reduce(
              (sum, pricing) => sum + (Number(pricing.breakfastTotal) || 0),
              0
            ),
            addOnNet: childPricing.reduce(
              (sum, pricing) => sum + (Number(pricing.extraBedTotal) || 0),
              0
            ),
            deductionNet: allocatedDeductions.reduce(
              (sum, deduction) =>
                sum +
                deduction.amounts.reduce(
                  (deductionSum, amount) => deductionSum + (Number(amount) || 0),
                  0
                ),
              0
            ),
            totalNet: totalPrice
          },
          totalPrice
        ),
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
        // Per BAR-02 (2026-08-08, per decision #203): the
        // five aggregate counter fields are no longer
        // written to the reservation header. Consumers
        // derive them via `deriveReservationCounters` at
        // read time. Pre-BAR-02 these were the
        // create-time init for the header's denormalized
        // counter mirror.
        holdExpiresAt: (newBooking as any).holdExpiresAt
          ? (newBooking as any).holdExpiresAt
          : null,
        requestFingerprint: reservationRequestFingerprint,
        // Per MRB-14 (2026-08-03, per decision #180 —
        // proposed): the actual range snapshot. At create
        // time every child shares the header's dates, so
        // `isDivergent` is `false` by construction. The
        // helper is overkill here; the reschedule +
        // add-room paths use it. Pre-MRB-14 reservations
        // keep `actualDateRange: null` and fall back to
        // reading the children's per-child dates directly.
        actualDateRange: {
          earliestCheckIn: checkInDate,
          latestCheckOut: checkOutDate,
          isDivergent: false
        },
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
        const pricingForRoom = childPricing[bookingIdx];
        const bookingIdForThisRoom = assignedRoomForBooking.selection.bookingId;
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
            // Per MRB-06 Phase 2 follow-up (2026-08-02, per decision
            // #159): each room stay carries its OWN guest-facing
            // reference. Without this override every room in the
            // reservation inherited the spread `newBooking.bookingRef`,
            // which made a "ref + email" lookup ambiguous across the
            // group.
            bookingRef: childBookingRefs[bookingIdx],
            roomId: assignedRoomForBooking.id,
            roomNumber: String(assignedRoomForBooking.data.roomNumber || ""),
            roomType: assignedRoomForBooking.selection.roomType,
            numGuests: pricingForRoom.numGuests,
            numAdults: pricingForRoom.numAdults,
            numChildren: pricingForRoom.numChildren,
            ratePerNight: pricingForRoom.activeRoomRate,
            totalPrice: pricingForRoom.totalPrice,
            originalTotalPrice: pricingForRoom.subtotal,
            rateBreakdown: pricingForRoom.rateBreakdown,
            voucherDiscount: pricingForRoom.voucherDiscount,
            hasBreakfast: pricingForRoom.finalHasBreakfast,
            breakfastRate: pricingForRoom.finalHasBreakfast ? actualBreakfastRate : 0,
            breakfastIncludesChildren: pricingForRoom.finalHasBreakfast
              ? pricingForRoom.breakfastIncludesChildren
              : false,
            extraBedCount: pricingForRoom.extraBedCount,
            extraBedRate: pricingForRoom.extraBedRate,
            // Per EXB-12 (2026-08-06, per decision #199):
            // snapshot the extra-bed breakfast toggle onto
            // the booking doc. The invariant
            // `extraBedBreakfast implies extraBedCount > 0`
            // is enforced in the validatedRoomStays loop
            // above. Absent → `false` (no breakfast for extra
            // beds) for back-compat with older booking docs.
            extraBedBreakfast: pricingForRoom.extraBedBreakfast === true,
            // Per MRB-11 (2026-08-03, per decision #177):
            // the per-child revenue allocation snapshot.
            // The per-stream values are the GROSS amounts
            // (room rate × nights, breakfast rate × guests ×
            // nights, extra-bed subtotal); `deductionNet` is
            // the sum of the allocated per-deduction amounts
            // for this child. `totalNet` is the allocated
            // child total. The invariant
            // `roomNet + breakfastNet + addOnNet - deductionNet === totalNet`
            // holds by construction (the allocations are
            // derived from the same `calculateDiscountChain`
            // call that produced the aggregate). The assert
            // below catches any rounding drift that would
            // surface to Reports.
            revenueAllocation: assertBookingRevenueAllocationInvariant(
              {
                roomNet: pricingForRoom.roomTotal,
                breakfastNet: pricingForRoom.breakfastTotal,
                addOnNet: pricingForRoom.extraBedTotal,
                deductionNet: allocatedDeductions.reduce(
                  (sum, deduction) => sum + (Number(deduction.amounts[bookingIdx]) || 0),
                  0
                ),
                totalNet: pricingForRoom.totalPrice
              },
              pricingForRoom.totalPrice
            ),
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
            //
            // Per MRB-09 (2026-08-02, per decision
            // #168): the token is generated into
            // `finalLookupTokens[bookingIdx]` so
            // the post-transaction reservation
            // email view can carry it in
            // `rooms[].lookupToken` for N>1.
            lookupToken: (finalLookupTokens[bookingIdx] = generateLookupToken())
          }
        });
      }
      for (const { ref: writeRef, data: writeData } of bookingWriteRefs) {
        transaction.set(writeRef, writeData);
      }
      finalRooms = bookingWriteRefs.map((write, index) => {
        const assigned = assignedRooms[index];
        const pricing = childPricing[index];
        return {
          bookingId: write.ref.id,
          roomId: assigned.id,
          roomNumber: String(assigned.data.roomNumber || ""),
          roomType: assigned.selection.roomType,
          reservationPosition: index + 1,
          numAdults: pricing.numAdults,
          numChildren: pricing.numChildren,
          extraBedCount: pricing.extraBedCount,
          hasBreakfast: pricing.finalHasBreakfast,
          totalPrice: pricing.totalPrice
        };
      });
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
      // Per MRB-09 (2026-08-02, per decision #168): the
      // reservation-scope email view. Build the view
      // from the captured create-transaction data
      // (finalReservationRef, finalRooms, childPricing,
      // etc.) so the email lists every room when N>1
      // and stays byte-equivalent to the single-room
      // path for N=1. The pre-MRB-09 single-room
      // fallback (`computedData` shape) is preserved
      // for legacy callers that pre-date MRB-01
      // (no `reservationId` on the response).
      const emailView = buildCreateEmailView({
        reservationId: finalReservationId || "",
        reservationRef: finalReservationRef || "",
        finalBookingRefs: childBookingRefs,
        finalLookupTokens: childLookupTokens,
        finalRooms,
        childPricing: childPricing as any,
        roomTypes: resolvedRoomSelections.map((s: any) => s.typeEntry) as any,
        guestName,
        guestEmail: guestDetails.email.trim().toLowerCase(),
        guestPhone: guestDetails.phone.trim(),
        totalPrice: finalTotalPrice,
        numNights,
        paymentMethod,
        paymentStatus: paymentProofPath || paymentProofUrl ? "payment-uploaded" : "pending",
        source: corporateDetails.isCorporate ? "corporate" : "online",
        isCorporate: corporateDetails.isCorporate === true,
        corporateCode: corporateDetails.corporateCode || "",
        companyName: corporateDetails.companyName || ""
      });
      await sendBookingTrigger("booking-submitted", emailView ?? {
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
        rooms: finalRooms,
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
    // Per MRB-07 (2026-08-02, per decision #159): the optional
    // N-room room list. Absent for every pre-MRB-07 caller — the
    // server then derives a single line from the top-level fields,
    // which keeps the single-room walk-in byte-equivalent.
    rooms: requestedRooms,
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

  // Per MRB-07 (2026-08-02, per decision #159): resolve the canonical
  // room lines. Absent `rooms` → one line derived from the top-level
  // fields (the historical single-room shape, byte-equivalent). Present
  // `rooms` → the array is canonical, and the top-level `roomId` +
  // `guests` must agree with it. The agreement checks exist because the
  // body carries the same facts in two places; per the "never trust a
  // client-supplied total" rule the server refuses rather than picking
  // a winner.
  const walkinRoomLines: Array<{ roomId: string; numAdults: number; numChildren: number; extraBedCount: number }> =
    Array.isArray(requestedRooms) && requestedRooms.length > 0
      ? requestedRooms.map((line) => ({
          roomId: String(line.roomId).trim(),
          numAdults: Math.max(0, Math.floor(Number(line.numAdults) || 0)),
          numChildren: Math.max(0, Math.floor(Number(line.numChildren) || 0)),
          extraBedCount: Math.max(0, Math.floor(Number(line.extraBedCount) || 0))
        }))
      : [{
          roomId,
          numAdults: Number.isFinite(Number(requestedNumAdults))
            ? Math.max(0, Math.floor(Number(requestedNumAdults)))
            : guests,
          numChildren: Number.isFinite(Number(requestedNumChildren))
            ? Math.max(0, Math.floor(Number(requestedNumChildren)))
            : 0,
          extraBedCount: Math.max(0, Math.floor(Number(requestedExtraBedCount) || 0))
        }];

  if (Array.isArray(requestedRooms) && requestedRooms.length > 0) {
    if (walkinRoomLines[0].roomId !== roomId) {
      return res.status(400).json({
        success: false,
        error: "The first room in the reservation must match the primary room."
      });
    }
    const lineGuestTotal = walkinRoomLines.reduce((sum, line) => sum + line.numAdults + line.numChildren, 0);
    if (lineGuestTotal !== guests) {
      return res.status(400).json({
        success: false,
        error: `Occupancy split mismatch: the rooms hold ${lineGuestTotal} guest(s) but the reservation says ${guests}.`
      });
    }
    if (walkinRoomLines.some((line) => line.numAdults + line.numChildren < 1)) {
      return res.status(400).json({
        success: false,
        error: "Every room in the reservation must have at least one guest."
      });
    }
    // The same room cannot be sold twice inside one reservation.
    // Rejected before the transaction so the desk gets an actionable
    // message instead of an availability conflict against its own
    // booking.
    const distinctWalkinRoomIds = new Set(walkinRoomLines.map((line) => line.roomId));
    if (distinctWalkinRoomIds.size !== walkinRoomLines.length) {
      return res.status(400).json({
        success: false,
        error: "The same room was selected more than once. Each room in a reservation must be distinct."
      });
    }
  }

  const walkinRoomCount = walkinRoomLines.length;

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
      // Per MRB-07 (2026-08-02, per decision #159): read EVERY room in
      // the reservation, not just the primary one. Each room runs the
      // same "exists / active / not blocked in this window" gates the
      // single-room path ran; a failure on any room aborts the whole
      // transaction, so a multi-room walk-in is all-or-nothing (no
      // partially-created reservation). For a single-line reservation
      // this loop runs once and is byte-equivalent to the pre-MRB-07
      // read.
      const walkinAssignedRooms: Array<{
        roomId: string;
        ref: FirebaseFirestore.DocumentReference;
        data: any;
        numAdults: number;
        numChildren: number;
        extraBedCount: number;
      }> = [];
      for (const line of walkinRoomLines) {
        const lineRoomRef = adminDb.collection("rooms").doc(line.roomId);
        const lineRoomDoc = await transaction.get(lineRoomRef);
        if (!lineRoomDoc.exists) {
          throw new Error("Room not found");
        }
        const lineRoomData = lineRoomDoc.data()!;
        if (!lineRoomData.isActive) {
          throw new Error("Room is inactive");
        }
        if (lineRoomData.status === "blocked") {
          const blockedFrom = toDateOrNull(lineRoomData.blockedFrom);
          const blockedTo = toDateOrNull(lineRoomData.blockedTo);
          const windowActive = blockedFrom && blockedTo
            ? checkInDate < blockedTo && checkOutDate > blockedFrom
            : true;
          if (windowActive) {
            throw new Error("Room no longer available");
          }
        }
        walkinAssignedRooms.push({
          roomId: line.roomId,
          ref: lineRoomRef,
          data: lineRoomData,
          numAdults: line.numAdults,
          numChildren: line.numChildren,
          extraBedCount: line.extraBedCount
        });
      }
      // The primary room stays exposed under the historical names so
      // the downstream single-room code (fingerprint, response payload,
      // confirmation email) keeps reading the first room.
      const roomRef = walkinAssignedRooms[0].ref;
      const roomData = walkinAssignedRooms[0].data;
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
      //
      // Per MRB-07 (2026-08-02, per decision #159): the canonical
      // fingerprint room lines are now one entry per room stay
      // (`quantity: 1` each), carrying that room's own type and
      // occupancy. For a single-room walk-in this produces exactly
      // the one-entry array the pre-MRB-07 code built, so an
      // in-flight single-room replay still matches its stored
      // fingerprint. The builder is hoisted here so the idempotency
      // check below and the reservation header write further down
      // cannot drift apart.
      const walkinFingerprintRoomLines = walkinAssignedRooms.map((assigned) => ({
        type: String(assigned.data.type || "").trim(),
        quantity: 1,
        adults: assigned.numAdults,
        children: assigned.numChildren,
        extraBeds: assigned.extraBedCount
      }));
      // The walk-in fingerprint is the same canonical shape as the
      // public path — same byte-equivalence rules, same placeholder
      // for `discountScope` (the server-resolved DSC-01 scope is the
      // MRB-04 generalization; the walk-in snapshot reads the same
      // `normalizeDiscountScope(null)` shape so a replay is
      // byte-equivalent).
      const buildWalkinFingerprint = (leadGuestName: string) => computeRequestFingerprint({
        reservationId: effectiveReservationId,
        roomLines: walkinFingerprintRoomLines,
        checkIn: String(checkIn || "").trim(),
        checkOut: String(checkOut || "").trim(),
        leadGuestName,
        leadGuestEmail: String((guestDetails as any).email || "").trim().toLowerCase(),
        leadGuestPhone: String((guestDetails as any).phone || "").trim(),
        source: "walk-in",
        isCorporate: false,
        corporateCode: "",
        companyName: "",
        voucherCode: String(requestedVoucherCode || "").trim().toUpperCase(),
        memberDiscountPct: 0,
        discountScope: normalizeDiscountScope(null),
        termsVersion: DEFAULT_TERMS_VERSION,
        privacyVersion: DEFAULT_TERMS_VERSION
      });

      const existingReservationSnap = await transaction.get(reservationDocRef);
      if (existingReservationSnap.exists) {
        const existingData = existingReservationSnap.data() || {};
        const walkinFingerprint = buildWalkinFingerprint(
          `${String((guestDetails as any).firstName || "").trim()} ${String((guestDetails as any).lastName || "").trim()}`
        );
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
      const websiteContentRef = adminDb.collection("settings").doc("websiteContent");
      const websiteContentDoc = await transaction.get(websiteContentRef);
      const websiteContent = websiteContentDoc.exists ? websiteContentDoc.data()! : {};
      const roomTypesArr: any[] = Array.isArray(hotelConfig.roomTypes) ? hotelConfig.roomTypes : [];
      // Per MRB-07 (2026-08-02, per decision #159): every room in the
      // reservation resolves its OWN type entry, so a reservation can
      // mix room types and each stay is capped and priced against the
      // type it actually is. `typeEntry` below stays the primary room's
      // entry for the downstream single-room code.
      const resolveWalkinTypeEntry = (typeValue: string) => {
        const rawTypeEntry = roomTypesArr.find((entry) => entry && entry.value === typeValue);
        if (!rawTypeEntry) {
          throw new Error("Room type is not available.");
        }
        return applyRoomTypeDefaults(rawTypeEntry);
      };
      const walkinTypeEntries = walkinAssignedRooms.map((assigned) => resolveWalkinTypeEntry(assigned.data.type));
      const typeEntry = walkinTypeEntries[0];

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
      // Per MRB-07 (2026-08-02, per decision #159): the split is now
      // validated per room stay. `walkinRoomLines` already agrees with
      // `guests` in aggregate (checked before the transaction); each
      // line's own split is checked against ITS room type below, so a
      // reservation may mix types (2 adults in a suite + 1 adult and 2
      // children in a family room) and each room is capped by its own
      // entry. The primary room's numbers stay exposed under the
      // historical names for the downstream single-room code.
      const walkinNumAdults = walkinRoomLines[0].numAdults;
      const walkinNumChildren = walkinRoomLines[0].numChildren;
      const walkinTotalOccupancy = walkinRoomLines.reduce(
        (sum, line) => sum + line.numAdults + line.numChildren,
        0
      );
      if (walkinTotalOccupancy !== guests) {
        // A single-room reservation keeps the historical wording — the
        // desk sees the same message it has always seen for the common
        // case, and only a genuinely multi-room mismatch gets the
        // reservation-level phrasing.
        throw new Error(
          walkinRoomCount === 1
            ? `Occupancy split mismatch: numAdults (${walkinNumAdults}) + numChildren (${walkinNumChildren}) must equal guests (${guests}).`
            : `Occupancy split mismatch: the room stays hold ${walkinTotalOccupancy} guest(s) but the reservation says ${guests}.`
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
      // Per MRB-07 (2026-08-02, per decision #159): every room in the
      // reservation is checked, and the first conflict aborts the
      // transaction — a multi-room walk-in never half-commits with one
      // room double-sold. For a single-line reservation this loop runs
      // once and is byte-equivalent to the pre-MRB-07 check.
      const now = new Date();
      for (const assigned of walkinAssignedRooms) {
        const bookingsQuery = adminDb.collection("bookings")
          .where("roomId", "==", assigned.roomId)
          .where("status", "in", ROOM_OCCUPYING_STATUSES);
        const bookingsSnapshot = await transaction.get(bookingsQuery);
        // Per PEX-02 + PEX-03 (2026-08-01, per decision #147):
        // same pattern as handleCreateBooking — split each
        // conflicting doc into "active conflict" vs "expired
        // `pending` hold to retire". A walk-in that displaces a
        // stale expired hold is a real-world case the cron may
        // not have caught yet (e.g. a `payment-hold-expired`
        // hold from yesterday that nobody's cron has processed).
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
        if (sawConflict) {
          throw new Error(sawLingering ? ROOM_NOT_READY_PREVIOUS_GUEST_ERROR : "Room no longer available");
        }
        const hasBlockConflict = await hasActiveRoomBlockConflict(transaction, assigned.roomId, checkInDate, checkOutDate);
        if (hasBlockConflict) {
          throw new Error("Room no longer available");
        }
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
      //
      // Per MRB-07 (2026-08-02, per decision #159): the allowance and
      // the EXB-03 overflow rule are evaluated per room stay, against
      // that stay's OWN type entry. A reservation that mixes types is
      // therefore capped correctly room by room instead of measuring
      // every room against the primary room's type.
      const walkinPerRoomExtraBeds = walkinAssignedRooms.map((assigned, lineIdx) => {
        const lineTypeEntry = walkinTypeEntries[lineIdx];
        const lineExtraBedCount = assigned.extraBedCount;
        const lineMaxExtraBeds = Math.max(0, Number(lineTypeEntry.maxExtraBeds) || 0);
        const lineExtraBedRate = Math.max(0, Number(lineTypeEntry.extraBedRate) || 0);
        if (lineExtraBedCount > lineMaxExtraBeds) {
          throw new Error(
            `Extra bed count (${lineExtraBedCount}) exceeds the room type's allowance (${lineMaxExtraBeds}).`
          );
        }
        // Per EXB-03 (2026-08-01, per decision #145): the
        // overflow rule. Same shape as handleCreateBooking.
        // `requiredExtraBedsFor` returns the number of
        // extra people beyond the per-type cap, split into
        // adult and child overflows. The check rejects
        // when the required overflow exceeds the selected
        // extra bed count. When the count is 0 the helper
        // reduces to the two hard caps (CHD-04's original
        // shape); when > 0, the rule allows overflow up to
        // the extra bed count. See the JSDoc on
        // `requiredExtraBedsFor` in `shared/utils/roomTypes.ts`.
        const lineOverflow = requiredExtraBedsFor({
          numAdults: assigned.numAdults,
          numChildren: assigned.numChildren,
          maxCapacity: Number(lineTypeEntry.maxCapacity) || 0,
          maxChildren: Math.max(0, Number(lineTypeEntry.maxChildren) || 0)
        });
        if (lineOverflow.requiredExtraBeds > lineExtraBedCount) {
          throw new Error(
            `Not enough extra beds: ${lineOverflow.overflowAdults} overflow adult(s) + ${lineOverflow.overflowChildren} overflow child(ren) = ${lineOverflow.requiredExtraBeds} extra bed(s) needed, but only ${lineExtraBedCount} extra bed(s) selected. The room type allows up to ${lineMaxExtraBeds} extra bed(s).`
          );
        }
        return {
          extraBedCount: lineExtraBedCount,
          extraBedRate: lineExtraBedCount > 0 ? lineExtraBedRate : 0
        };
      });
      // The primary room's snapshot stays under the historical names;
      // the reservation-wide count is what the hotel-wide inventory
      // check below must reserve against.
      const walkinExtraBedRate = walkinPerRoomExtraBeds[0].extraBedRate;
      const walkinExtraBedCount = walkinPerRoomExtraBeds.reduce((sum, line) => sum + line.extraBedCount, 0);

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

      // 4. + 5. Per-room-stay pricing.
      // Per MRB-07 (2026-08-02, per decision #159): each room stay is
      // priced against its own type (seasonal overrides beat weekend
      // rates, unless staff enters a manual total override below) and
      // its own occupancy. The reservation's room / breakfast /
      // extra-bed terms are the sums of the per-room allocations, so
      // every reservation total can be reconstructed exactly from the
      // stored per-room lines (the MRB-11 reporting requirement) rather
      // than divided back out heuristically. For a single-line
      // reservation each sum has one term and the math is
      // byte-equivalent to the pre-MRB-07 single-room pricing.
      const finalHasBreakfast = breakfastConfig.isEnabled && hasBreakfast;
      const walkinRoomStayPricing = walkinAssignedRooms.map((assigned, lineIdx) => {
        const lineTypeEntry = walkinTypeEntries[lineIdx];
        const lineRoomBreakdown = calculateSeasonalAwareRoomBreakdown({
          checkIn: checkInDate,
          checkOut: checkOutDate,
          roomType: assigned.data.type,
          baseRate: Number(lineTypeEntry.pricePerNight) || 0,
          weekendRate: Number(lineTypeEntry.weekendRate) || 0,
          seasonalRateOverrides
        });
        // Per CHD-10 (2026-07-31, per CVQ-01): the inline
        // `actualBreakfastRate * guests * numNights` pattern
        // routes through the shared `calculateBreakfastAddOn`
        // helper. The walk-in path snapshots the admin default
        // (no per-booking override on this surface —
        // staff-created). The guest count is this room's own
        // occupancy, so breakfast is charged once per guest
        // across the reservation, never once per guest per room.
        const lineBreakfastTotal = calculateBreakfastAddOn({
          hasBreakfast: finalHasBreakfast,
          breakfastRate: actualBreakfastRate,
          numGuests: assigned.numAdults + assigned.numChildren,
          numNights,
          breakfastIncludesChildren
        });
        // Per EXB-01 (2026-07-31): the extra-bed add-on term.
        // Same shape as the online-create path.
        const lineExtraBedTotal = calculateExtraBedAddOn({
          extraBedCount: walkinPerRoomExtraBeds[lineIdx].extraBedCount,
          extraBedRate: walkinPerRoomExtraBeds[lineIdx].extraBedRate,
          numNights
        });
        return {
          roomBreakdown: lineRoomBreakdown,
          roomTotal: lineRoomBreakdown.roomSubtotal,
          breakfastTotal: lineBreakfastTotal,
          extraBedTotal: lineExtraBedTotal,
          extraBedCount: walkinPerRoomExtraBeds[lineIdx].extraBedCount,
          extraBedRate: walkinPerRoomExtraBeds[lineIdx].extraBedRate,
          subtotal: lineRoomBreakdown.roomSubtotal + lineBreakfastTotal + lineExtraBedTotal
        };
      });
      const roomBreakdown = walkinRoomStayPricing[0].roomBreakdown;
      const roomTotal = walkinRoomStayPricing.reduce((sum, line) => sum + line.roomTotal, 0);
      const breakfastTotal = walkinRoomStayPricing.reduce((sum, line) => sum + line.breakfastTotal, 0);
      const walkinExtraBedTotal = walkinRoomStayPricing.reduce((sum, line) => sum + line.extraBedTotal, 0);
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
          // Per MRB-07 (2026-08-02, per decision #159): a
          // room-type-restricted voucher must cover EVERY room type in
          // the reservation. The voucher is applied once at reservation
          // level (per MRB-09), so accepting it while one room is
          // ineligible would silently discount a room the promo never
          // covered. For a single-room reservation this is the same
          // check as before.
          && ((voucherData.applicableRoomTypes?.length ?? 0) === 0
            || walkinAssignedRooms.every((assigned) => voucherData.applicableRoomTypes.includes(assigned.data.type)));
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
      // senior + voucher chain routes through the shared
      // `calculateDiscountChain` helper. For the broad default
      // scope, the helper's `total` is byte-equivalent to
      // `max(voucherBase − voucherDiscount, 0)`. When a manual
      // `totalPriceOverride` is in play, the override is passed
      // as the room term (breakfast + extra-bed = 0) so the
      // chain sees the override as the discountable base.
      const hasManualOverride = totalPriceOverride !== undefined && totalPriceOverride !== null;

      // Per MRB-07 (2026-08-02, per decision #159): allocate the
      // reservation-level money terms back onto the individual room
      // stays, then price each stay with the shared chain. Two terms
      // need allocating because they are reservation-scoped by
      // definition:
      //   - a manual `totalPriceOverride` is a price for the whole
      //     reservation, not for one room;
      //   - a voucher applies once per reservation (per MRB-09), not
      //     once per room.
      // Both are split in proportion to each stay's own subtotal, with
      // the rounding remainder landing on the first room so the room
      // allocations always re-sum to the reservation figure exactly —
      // no reconstructed report can drift from the stored total. The
      // reservation `totalPrice` is then defined AS the sum of the room
      // allocations rather than computed independently, which makes the
      // invariant structural instead of coincidental.
      const walkinAllocationBasis = walkinRoomStayPricing.reduce((sum, line) => sum + line.subtotal, 0);
      const allocateAcrossRoomStays = (amount: number): number[] => {
        if (walkinRoomCount === 1) return [amount];
        if (walkinAllocationBasis <= 0) {
          // Degenerate basis (an all-zero reservation): put the whole
          // amount on the first room rather than dividing by zero.
          return walkinRoomStayPricing.map((_, idx) => (idx === 0 ? amount : 0));
        }
        const shares = walkinRoomStayPricing.map((line) =>
          Math.floor((amount * line.subtotal) / walkinAllocationBasis)
        );
        const allocated = shares.reduce((sum, share) => sum + share, 0);
        shares[0] += amount - allocated;
        return shares;
      };
      const walkinOverrideShares = hasManualOverride
        ? allocateAcrossRoomStays(Number(totalPriceOverride))
        : null;
      const walkinVoucherShares = allocateAcrossRoomStays(voucherDiscount);

      // Per DSC-01..05 (2026-08-01, per CVQ-06) + EXB-08 (2026-08-01,
      // per decision #156): each room stay runs the same chain and
      // builds the same rate breakdown the single-room walk-in built.
      // When a manual override is in play the room term collapses to
      // the allocated override and the breakfast / extra-bed add-on
      // lines are 0 (the historical manual-rate shape).
      const walkinRoomStayFinancials = walkinRoomStayPricing.map((line, lineIdx) => {
        const linePricingSubtotal = walkinOverrideShares ? walkinOverrideShares[lineIdx] : line.subtotal;
        const lineVoucherDiscount = walkinVoucherShares[lineIdx];
        const lineChainInput = hasManualOverride
          ? {
              roomTotal: linePricingSubtotal,
              breakfastTotal: 0,
              extraBedTotal: 0,
              seniorPct: discountPct,
              voucherAmount: lineVoucherDiscount,
              memberPct: 0,
              scope: snapshottedDiscountScope,
              round: true
            }
          : {
              roomTotal: line.roomTotal,
              breakfastTotal: line.breakfastTotal,
              extraBedTotal: line.extraBedTotal,
              seniorPct: discountPct,
              voucherAmount: lineVoucherDiscount,
              memberPct: 0,
              scope: snapshottedDiscountScope,
              round: true
            };
        const lineChainResult = calculateDiscountChain(lineChainInput);
        const lineTotal = lineChainResult.total;
        return {
          ...line,
          pricingSubtotal: linePricingSubtotal,
          voucherDiscount: lineVoucherDiscount,
          totalPrice: lineTotal,
          // Per MRB-11 (2026-08-03, per decision #177):
          // the per-line revenue allocation. Walk-in has
          // no member step (`memberPct: 0`), so the
          // deduction sum is `seniorDeduction + voucherDeduction`.
          // The per-stream values are GROSS (pre-deduction);
          // the invariant holds by construction.
          revenueAllocation: assertBookingRevenueAllocationInvariant(
            {
              roomNet: hasManualOverride ? linePricingSubtotal : line.roomTotal,
              breakfastNet: hasManualOverride ? 0 : line.breakfastTotal,
              addOnNet: hasManualOverride ? 0 : line.extraBedTotal,
              deductionNet: lineChainResult.seniorDeduction + lineChainResult.voucherDeduction,
              totalNet: lineTotal
            },
            lineTotal
          ),
          rateBreakdown: buildRateBreakdown({
            roomLines: hasManualOverride
              ? [{
                  source: "manual",
                  label: "Manual front-desk rate",
                  startDate: checkIn,
                  endDate: checkOut,
                  nights: numNights,
                  nightlyRate: numNights > 0 ? Math.round(linePricingSubtotal / numNights) : linePricingSubtotal,
                  subtotal: linePricingSubtotal
                }]
              : line.roomBreakdown.roomLines,
            roomSubtotal: hasManualOverride ? linePricingSubtotal : line.roomTotal,
            breakfastTotal: hasManualOverride ? 0 : line.breakfastTotal,
            extraBedTotal: hasManualOverride ? 0 : line.extraBedTotal,
            extraBedCount: line.extraBedCount,
            extraBedRate: line.extraBedRate,
            discountType,
            discountPct,
            voucherDiscount: lineVoucherDiscount,
            memberDiscountPct: 0,
            finalTotal: lineTotal
          })
        };
      });

      finalTotalPrice = walkinRoomStayFinancials.reduce((sum, line) => sum + line.totalPrice, 0);
      // The primary room's breakdown stays under the historical name
      // for the downstream single-room code (response payload +
      // confirmation email); the write loop below stamps each room's
      // own breakdown onto its own booking doc.
      const rateBreakdown = walkinRoomStayFinancials[0].rateBreakdown;

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
      // Per MRB-07 (2026-08-02, per decision #159): every room stay is
      // its own booking with its own guest-facing reference, so the
      // daily counter advances by N and the reservation consumes N
      // consecutive sequence numbers. Reusing one ref across the N
      // rooms would make the guest-facing ref ambiguous and break the
      // "booking ref + email" lookup contract, which assumes a ref
      // identifies exactly one room stay. For N=1 the counter advances
      // by one, byte-equivalent to the pre-MRB-07 behavior.
      const walkinBookingRefs = walkinAssignedRooms.map(
        (_, lineIdx) => `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence + lineIdx).padStart(5, "0")}`
      );
      const bookingRef = walkinBookingRefs[0];
      finalBookingRef = bookingRef;
      // Per MRB-02.x (2026-08-02, per decision #164): mint
      // the public reservation ref (`R-YYYYMMDD-NNNNN`) in
      // the same transaction so it shares the same `now` +
      // counter transaction as the booking ref. The
      // reservation ref uses the FIRST sequence number the
      // reservation consumed (the counter is global, not
      // per-reservation). Captured at function scope so the
      // post-transaction success response can echo it back.
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
      // Per CRL-05 (2026-08-02): compile the cancellation policy snapshot
      const cancellationPolicySnapshot = createCancellationPolicySnapshot({
        websiteContent,
        hotelConfig,
        checkInDateKey: checkIn,
        corporateCodeData: null
      });

      const newReservation = {
        id: effectiveReservationId,
        reservationRef: finalReservationRef,
        leadGuestName: guestName,
        cancellationPolicySnapshot,
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
        // Per MRB-11 (2026-08-03, per decision #177):
        // the aggregate revenue allocation (sum of
        // the N per-line allocations). Reports reads
        // this for fast reservation-level revenue
        // stream totals; the invariant
        // `aggregateRoomNet + aggregateBreakfastNet + aggregateAddOnNet - aggregateDeductionNet === aggregateTotalNet`
        // holds by construction (each line already
        // passed the invariant at the per-line map).
        aggregateRevenueAllocation: assertBookingRevenueAllocationInvariant(
          {
            roomNet: walkinRoomStayFinancials.reduce(
              (sum, line) =>
                sum +
                (Number((line.revenueAllocation as any)?.roomNet) || 0),
              0
            ),
            breakfastNet: walkinRoomStayFinancials.reduce(
              (sum, line) =>
                sum +
                (Number((line.revenueAllocation as any)?.breakfastNet) || 0),
              0
            ),
            addOnNet: walkinRoomStayFinancials.reduce(
              (sum, line) =>
                sum +
                (Number((line.revenueAllocation as any)?.addOnNet) || 0),
              0
            ),
            deductionNet: walkinRoomStayFinancials.reduce(
              (sum, line) =>
                sum +
                (Number((line.revenueAllocation as any)?.deductionNet) || 0),
              0
            ),
            totalNet: finalTotalPrice
          },
          finalTotalPrice
        ),
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
        // Per BAR-02 (2026-08-08, per decision #203): the
        // five aggregate counter fields are no longer
        // written to the reservation header. Consumers
        // derive them via `deriveReservationCounters` at
        // read time. Pre-BAR-02 the walkin path mirrored
        // the public create path's init (the "all
        // checked-in" branch was the historical quirk
        // for instant-walkin check-in).
        // Walk-ins have no auto-expiry hold (the staff is
        // creating the booking, not waiting on a guest
        // action) — `null` mirrors the public path's
        // `payment-uploaded` case.
        holdExpiresAt: null,
        // Per MRB-07 (2026-08-02, per decision #159): the stored
        // fingerprint is built by the same hoisted builder the
        // idempotency check above used, so a replay of an N-room
        // walk-in compares like for like.
        requestFingerprint: buildWalkinFingerprint(guestName),
        // Per MRB-14 (2026-08-03, per decision #180 —
        // proposed): the actual range snapshot. Walk-ins
        // create all N children in the same transaction
        // with the same dates, so `isDivergent` is
        // `false` by construction. The reschedule +
        // add-room paths use `computeReservationActualDateRange`
        // to recompute on every child mutation.
        actualDateRange: {
          earliestCheckIn: checkInDate,
          latestCheckOut: checkOutDate,
          isDivergent: false
        },
        createdAt: now,
        updatedAt: now,
        createdBy: "staff"
      };
      transaction.set(reservationDocRef, newReservation);

      // Auto update room status if immediate check-in.
      // Per MRB-07 (2026-08-02, per decision #159): every room in the
      // reservation is occupied by an immediate check-in, not just the
      // primary one.
      if (status === "checked-in") {
        for (const assigned of walkinAssignedRooms) {
          transaction.update(assigned.ref, { status: "occupied" });
        }
      }

      // Per MRB-07 (2026-08-02, per decision #159): the counter
      // advances past every sequence number this reservation consumed.
      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence + walkinRoomCount - 1 });
      } else {
        transaction.set(counterRef, { count: walkinRoomCount });
      }
      if (voucherUsageUpdate) transaction.update(voucherUsageUpdate.ref, voucherUsageUpdate.data);
      // Per MRB-07 (2026-08-02, per decision #159): write one
      // `bookings/{id}` doc per room stay. The first room uses the
      // client's preallocated `bookingId` (the historical contract);
      // rooms 2..N auto-mint fresh ids. Each doc carries its own room,
      // occupancy, extra-bed snapshot, rate breakdown, money
      // allocation, reference, lookup token, and 1-indexed
      // `reservationPosition`; everything else is shared reservation
      // context spread from `newBooking`. For N=1 the loop runs once
      // and writes exactly the doc the pre-MRB-07 code wrote.
      for (let lineIdx = 0; lineIdx < walkinRoomCount; lineIdx++) {
        const assigned = walkinAssignedRooms[lineIdx];
        const lineFinancials = walkinRoomStayFinancials[lineIdx];
        const perRoomBookingDocRef = lineIdx === 0
          ? bookingDocRef
          : adminDb.collection("bookings").doc();
        transaction.set(perRoomBookingDocRef, {
          ...newBooking,
          bookingRef: walkinBookingRefs[lineIdx],
          roomId: assigned.roomId,
          roomNumber: assigned.data.roomNumber,
          roomType: assigned.data.type,
          numGuests: assigned.numAdults + assigned.numChildren,
          numAdults: assigned.numAdults,
          numChildren: assigned.numChildren,
          extraBedCount: lineFinancials.extraBedCount,
          extraBedRate: lineFinancials.extraBedRate,
          ratePerNight: Number(walkinTypeEntries[lineIdx].pricePerNight) || 0,
          totalPrice: lineFinancials.totalPrice,
          originalTotalPrice: lineFinancials.pricingSubtotal,
          rateBreakdown: lineFinancials.rateBreakdown,
          // Per MRB-11 (2026-08-03, per decision #177):
          // the per-line revenue allocation. Computed
          // above in the `walkinRoomStayFinancials` map;
          // the invariant `room + breakfast + addOn - deduction === total`
          // was already asserted when the value was
          // built, so the write here is straight-through.
          revenueAllocation: lineFinancials.revenueAllocation,
          reservationPosition: lineIdx + 1,
          reservationRoomCount: walkinRoomCount,
          // Each room stay gets its own lookup token so its magic link
          // resolves to that room independently.
          lookupToken: lineIdx === 0 ? (newBooking as any).lookupToken : generateLookupToken()
        });
      }
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

// Per LOW-1 (reports audit 2026-08-10) +
// `DECISIONS-FEATURES.md #99` (LOU workflow):
// the staff-toggled LOU (Letter of Undertaking) flag
// for corporate chargeback bookings. A corporate
// chargeback lands as `status: "pending" +
// paymentMethod: "pay-at-hotel" + isCorporate: true`
// and stays pending until the company's LOU arrives
// by email (per `plan/features/CORPORATE-BOOKING.md`
// §LOU). The desk previously had no way to mark the
// LOU as received — `louReceived` was declared in
// `TYPES.md` but never written or read by any code
// path, so the receivables widget's "Corporate AR"
// card was perpetually inflated by chargeback rows
// that had already been resolved out-of-band.
//
// The toggle is a strict staff-only mutation (matches
// the auth posture of `apply-discount` +
// `reject-discount` + `reject-payment`): the
// `authenticateStaff` middleware at the apiRouter
// level gates the call. The `louReceivedAt` +
// `louReceivedBy` companion fields are stamped on
// the same write so the audit trail matches the
// existing staff-mutation fields (`handledBy`,
// `discountVerifiedBy`, `cancelledBy`, etc.).
//
// The endpoint accepts the same `true` / `false`
// payload as the schema; a `null` / missing value is
// rejected at the schema level (the desk must be
// explicit). To UN-mark an LOU (the rare "we marked
// it received but the company withdrew" case), the
// desk can call this endpoint with `louReceived:
// false`; the `louReceivedAt` / `louReceivedBy`
// companions are cleared in the same write.
export async function handleSetLouReceived(req: any, res: any) {
  const { bookingId, louReceived } = req.body || {};
  if (!bookingId) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }
  if (typeof louReceived !== "boolean") {
    return res.status(400).json({ success: false, error: "louReceived must be a boolean (true or false)." });
  }

  try {
    let result: Record<string, any> = {};
    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(String(bookingId).trim());
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new Error("Booking not found.");
      }
      const booking = bookingSnap.data()!;
      // Per DECISIONS-FEATURES.md #99: LOU only applies
      // to corporate chargeback bookings. A non-corporate
      // booking (personal pay, walk-in, online) cannot
      // have a chargeback. The guard prevents the desk
      // from accidentally toggling the flag on the
      // wrong booking shape.
      if (booking.isCorporate !== true) {
        throw new Error("LOU flag only applies to corporate chargeback bookings (isCorporate: true).");
      }
      // Per DECISIONS-FEATURES.md #99: the LOU is the
      // settlement trigger for chargebacks
      // (`paymentMethod === "pay-at-hotel"`). A corporate
      // personal-pay booking never has an LOU — even if
      // the desk toggles the flag, the math consumers
      // (Reports) only use it on chargeback rows. We
      // allow the toggle here for forward-compat but the
      // guard above is the corporate-true check.
      if (booking.paymentMethod !== "pay-at-hotel") {
        throw new Error("LOU flag only applies to chargeback bookings (paymentMethod: 'pay-at-hotel').");
      }
      const staffUid = req.staff?.uid || "staff";
      const now = new Date();
      // Per the unwired-spec fix: the LOU toggle is a
      // single-stamp field write. We do NOT change
      // `status` here — the booking stays `pending`
      // (or whatever status the desk has flipped it to)
      // and the LOU flag is a parallel signal. The
      // receivables widget's filter (per MED-1) now
      // reads the LOU flag AND the status to decide
      // whether to count a chargeback row; the
      // combined rule is: `isCorporate + paymentMethod
      // === 'pay-at-hotel' + louReceived !== true` is
      // still AR (LOU not yet received). Once
      // `louReceived === true` the row is excluded
      // from the corporate AR widget (the receivable
      // was settled via LOU, not a payment).
      //
      // Wait — looking at the MED-1 fix above, the
      // receivables filter does NOT check
      // `louReceived`. So a "LOU received" row is
      // STILL in the receivables list (status is
      // still `pending`, the desk hasn't flipped the
      // status). That's by-design for now: the LOU
      // is "we have the paperwork" but the actual
      // payment is still pending. A future fix can
      // also auto-flip the status to `confirmed` when
      // the LOU arrives (the staff has accepted the
      // chargeback terms). For this round the LOU
      // field is a signal + audit stamp; the status
      // stays in the desk's hands.
      const updates: Record<string, any> = {
        louReceived,
        ...(louReceived
          ? {
              louReceivedAt: now,
              louReceivedBy: staffUid
            }
          : {
              louReceivedAt: null,
              louReceivedBy: null
            }),
        updatedAt: now
      };
      transaction.update(bookingRef, updates);
      result = updates;
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    const message = error.message || "An unexpected error occurred while updating the LOU flag.";
    const status = message === "Booking not found." ? 404 : 400;
    console.error("Set LOU handler error:", error);
    return res.status(status).json({ success: false, error: message });
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
  // Per FOL-05 (2026-08-07, per decision #201): the
  // count of sibling children that just transitioned
  // from `payment-uploaded` back to `pending` inside
  // this reject transaction. Symmetric with
  // `handleVerifyAndRecordPayment`'s `siblingFlippedCount`
  // — the staff sees "X rooms rejected" in the bell
  // panel + the response. Zero for the N=1 case
  // (no siblings) or for legacy null-`reservationId`
  // bookings.
  let siblingRejectedCount = 0;
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
      // ---- READS — all reads first, per FOL-03 ----
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking not found.");
      }
      const data = bookingDoc.data()!;
      // Per FOL-05 (2026-08-07, per decision #201):
      // relaxed target check. The pre-FOL-05 handler
      // threw INVALID_STATUS when the target was not
      // `payment-uploaded`. For N>1 we want to allow
      // a reservation-scope reject even when the lead
      // booking is already `payment-confirmed` (e.g. a
      // partial-verify edge case the staff wants to
      // walk back) — the lead's own status update is
      // skipped, but the still-`payment-uploaded`
      // siblings flip back to `pending`. The
      // `hasRejectableSiblings` pre-read below is the
      // decision input. checked-in / checked-out /
      // cancelled remain rejected.
      const isTargetInPaymentUploaded = data.status === "payment-uploaded";
      const bookingReservationId = String((data as any).reservationId || "").trim();

      // Per FOL-05 (2026-08-07, per decision #201):
      // pre-read sibling children for the sibling-flip
      // pass. Same pattern as
      // `handleVerifyAndRecordPayment` + `handleAddPayment`.
      //
      // Per BAR-03 (2026-08-08, per decision #204):
      // the pre-read is the shared
      // `preReadSiblingChildren` helper. The
      // `bookingReservationId.length === 0` guard
      // (inside the helper) skips the pre-read for
      // legacy null-`reservationId` bookings — the
      // pre-FOL-05 single-child-only path stays
      // byte-equivalent.
      const siblingChildBookings = await preReadSiblingChildren(
        transaction,
        adminDb,
        bookingReservationId,
        (d) => ({
          id: d.id,
          status: String((d.data() || {}).status || "")
        })
      );
      const hasRejectableSiblings = siblingChildBookings.some(
        (c) => c.id !== bookingId && c.status === "payment-uploaded"
      );

      if (!isTargetInPaymentUploaded && !hasRejectableSiblings) {
        throw new Error(`Only a booking in 'payment-uploaded' status can be rejected (current: ${data.status}).`);
      }

      bookingData = data;

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

      // Per FOL-05 (2026-08-07, per decision #201):
      // compute the post-update child statuses. Every
      // child currently in `payment-uploaded` flips to
      // `pending` (the lead + every rejectable sibling).
      // For legacy N=1 the array has one element (the
      // target) and the rule is byte-equivalent to the
      // pre-FOL-05 single-child update.
      //
      // Per BAR-03 (2026-08-08, per decision #204): the
      // sibling-flip pass is the shared
      // `applyReservationScopePaymentTransition` helper.
      // The handler passes a per-handler `rule.decide`
      // callback (the per-child rejection rule + the
      // write payload); the helper handles the
      // per-sibling `transaction.update` + the
      // post-update statuses array + the reservation
      // header heartbeat.
      const { postUpdateChildStatuses, siblingFlippedCount: helperSiblingRejectedCount } =
        applyReservationScopePaymentTransition(
          transaction,
          adminDb,
          bookingReservationId,
          bookingId,
          siblingChildBookings,
          (child) => {
            if (child.status === "payment-uploaded") {
              const decision: SiblingFlipDecision = {
                write: {
                  status: "pending",
                  paymentRejectionReason: safeReason,
                  paymentRejectedAt: updatedAt,
                  paymentRejectedBy,
                  holdExpiresAt: newDeadline ? Timestamp.fromDate(newDeadline) : null,
                  updatedAt
                },
                newStatus: "pending"
              };
              return decision;
            }
            return null;
          },
          updatedAt
        );
      siblingRejectedCount = helperSiblingRejectedCount;

      // ---- WRITES — all writes after every `get()`, per FOL-03 ----

      // 1. Update the target booking (only if it was
      // actually in `payment-uploaded`).
      if (isTargetInPaymentUploaded) {
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
      }

      // 2. Per BAR-03 (2026-08-08, per decision #204):
      // the per-sibling `transaction.update` calls + the
      // reservation header heartbeat are queued by the
      // shared `applyReservationScopePaymentTransition`
      // helper above (called from the post-update status
      // computation step). The target's own status
      // update was already queued at step 1.
    });

    return res.status(200).json({
      success: true,
      data: {
        status: "pending",
        paymentRejectionReason,
        paymentRejectedAt,
        paymentRejectedBy,
        holdExpiresAt: freshHoldExpiresAt,
        // Per FOL-05 (2026-08-07, per decision #201):
        // the sibling-rejection count for symmetry with
        // `handleVerifyAndRecordPayment`. Zero for the
        // N=1 case or when no flippable siblings.
        siblingRejectedCount
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
    //   (b) Source-specific authorisation — CRL-06 expands guest
    //       self-service to every pre-arrival status after adding
    //       the policy-derived financial preview. The staff path
    //       also covers every pre-arrival status. The split is enforced
    //       server-side so a client cannot POST a crafted body to
    //       bypass the guest restriction; the apiRouter's
    //       `authenticateStaff` check is the source of truth for
    //       the boolean.
    //
    //   Paid guest cancellations remain non-automatic financially:
    //   the cancellation commits, while any policy refund is left
    //   for staff processing (CRL-04/06).
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

    // Per MRB-13 (2026-08-02, per decision #166): the
    // scope selector. The schema default (`"room"`)
    // preserves byte-compatible single-child behavior for
    // every existing caller. The admin BookingsPage cancel
    // modal passes `scope` via `updateBookingStatus`; the
    // guest `/my-booking` page (per MRB-10) sends
    // `"reservation"` when the looked-up booking is part of
    // a multi-room reservation. The dispatch below honours
    // `scope === "reservation"` only when the looked-up
    // booking has a `reservationId` — a legacy pre-MRB-01
    // booking (no `reservationId`) carrying
    // `scope === "reservation"` silently falls back to the
    // per-child branch (a "reservation" of size 1 is
    // byte-equivalent to the per-child cancel).
    const requestedScope: "room" | "reservation" = isStaffCancellation
      ? (String((req.body || {}).scope || "").trim().toLowerCase() === "reservation"
        ? "reservation"
        : "room")
      : parsed.data.scope;
    const lookedUpReservationId = String(bookingData.reservationId || "").trim();
    const isReservationScope = requestedScope === "reservation" && lookedUpReservationId.length > 0;
    // Per MRB-13: the post-transaction email action depends
    // on the branch. The reservation-scope path fires the
    // `booking-cancelled-reservation` action (the
    // multi-room template added in MRB-09). The per-child
    // path keeps the legacy `booking-cancelled` action
    // (which MRB-09 already taught to render the full
    // reservation view when the booking has a
    // `reservationId`).
    const postTransactionAction: "booking-cancelled" | "booking-cancelled-reservation" = isReservationScope
      ? "booking-cancelled-reservation"
      : "booking-cancelled";

    if (isReservationScope) {
      // Per MRB-13 (2026-08-02, per decision #166):
      // the reservation-scope cancel. One transaction
      // cancels every cancellable child of the
      // reservation, decrements voucher + corporate
      // code `usageCount` exactly once per shared code
      // (deduped by the number of children that use
      // each code), runs the per-child MRB-05 loyalty
      // clawback for each cancelled child, and updates
      // the reservation header
      // (`cancelledRoomCount`, `activeRoomCount`, and
      // `paymentStatus` from the post-cancellation
      // state of every child). Children that are
      // already terminal (`checked-in` /
      // `cancelled`) or that fall outside the source-
      // specific cancellable set (guest path) are
      // skipped — "cancels every cancellable child"
      // per the spec body. The first-created child has
      // no special financial consequence because the
      // reservation folio (`reservations/{id}/payments`
      // and `refunds/`) is the source of truth, not
      // any individual booking doc.
      await adminDb.runTransaction(async (transaction) => {
        const reservationRef = adminDb.collection("reservations").doc(lookedUpReservationId);
        const reservationDoc = await transaction.get(reservationRef);
        if (!reservationDoc.exists) {
          throw new Error("Reservation not found.");
        }
        const reservationData = reservationDoc.data() || {};

        // Per MRB-13: read every child of the
        // reservation in one query. The query is
        // ordered by `reservationPosition` (the 1-
        // indexed position the create handler stamps
        // per MRB-01) so the surviving order matches
        // the on-reservation layout. Same shape as the
        // MRB-10 lookup child read.
        const childrenSnap = await transaction.get(
          adminDb.collection("bookings").where("reservationId", "==", lookedUpReservationId)
        );
        const children: Array<{ id: string; ref: any; data: any }> = childrenSnap.docs.map((d: any) => ({
          id: d.id,
          ref: d.ref,
          data: d.data() || {}
        }));

        // Per MRB-13: split the children into
        // cancellable + skipped. The terminal-status
        // set is universal; the source-specific
        // cancellable set mirrors the per-child
        // pre-transaction reject above. The same
        // `checked-out` exclusion that MRB-05 PR #2
        // added to the per-child path applies here
        // — a settled stay is still cancellable for
        // the clawback scenario, the reservation
        // remains the audit/financial record.
        const cancellableIds = new Set<string>();
        for (const child of children) {
          const status = String(child.data.status || "");
          if (status === "checked-in" || status === "cancelled") continue;
          if (
            !isStaffCancellation
            && !(GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(status)
          ) {
            continue;
          }
          cancellableIds.add(child.id);
        }
        const cancelledCount = cancellableIds.size;

        // Per CRL-07 (2026-08-03, per decision #173):
        // the reservation-scope liability snapshot.
        // Computed in the same transaction as the
        // status flip so the snapshot is atomic with
        // the audit stamps. The helper reads the
        // reservation folio (the same dual-read
        // pattern the cancel-preview uses — sign-aware
        // sum of `payments/` + `refunds/`) + runs
        // `evaluateCancelPreview` with the
        // cancellable-children set. The returned
        // snapshot is `null` when `policyRefund === 0`
        // (no liability work to do) and the field is
        // simply absent from the header update.
        const cancellableChildren = children
          .filter((c) => cancellableIds.has(c.id))
          .map((c) => ({
            id: c.id,
            bookingRef: String(c.data.bookingRef || ""),
            status: String(c.data.status || ""),
            roomType: String(c.data.roomType || ""),
            totalPrice: Number(c.data.totalPrice) || 0,
            reservationPosition: Number(c.data.reservationPosition) || null,
            cancellationPolicySnapshot: c.data.cancellationPolicySnapshot || null
          }));
        const liabilitySnapshot = await computeCancellationLiabilityInTransaction(
          transaction,
          {
            now,
            scope: "reservation",
            lookedUpBooking: cancellableChildren[0] || {
              id: bookingDocumentRef.id,
              bookingRef: String(bookingData.bookingRef || ""),
              status: String(bookingData.status || ""),
              roomType: String(bookingData.roomType || ""),
              totalPrice: Number(bookingData.totalPrice) || 0,
              reservationPosition: Number(bookingData.reservationPosition) || null,
              cancellationPolicySnapshot: bookingData.cancellationPolicySnapshot || null
            },
            reservation: {
              id: lookedUpReservationId,
              reservationRef: String(reservationData.reservationRef || ""),
              totalPrice: Number(reservationData.totalPrice) || 0
            },
            cancellableChildren
          }
        );

        // Per MRB-13: dedup the voucher + corporate
        // code decrements. Each cancelled child
        // contributes its `voucherCode` (if any) and
        // `corporateCode` (if any). A code shared
        // across N children decrements `usageCount`
        // by N (the per-child `usageCount` was
        // incremented by N at create per MRB-08
        // decision #167). The dedup map's count is
        // the number of cancelled children using
        // that code, not 1. Same shape as the per-
        // child decrement (lines ~5240) but
        // deduped + scaled.
        const voucherCounts = new Map<string, number>();
        const corporateCounts = new Map<string, number>();
        for (const child of children) {
          if (!cancellableIds.has(child.id)) continue;
          const v = String(child.data.voucherCode || "").trim().toUpperCase();
          if (v) voucherCounts.set(v, (voucherCounts.get(v) || 0) + 1);
          const cp = String(child.data.corporateCode || "").trim().toUpperCase();
          if (cp) corporateCounts.set(cp, (corporateCounts.get(cp) || 0) + 1);
        }

        // Per MRB-13: per-child status flip + audit
        // stamps + loyalty clawback. The audit
        // metadata is the same shape the per-child
        // branch stamps (CRL-02 decision #159):
        // `cancelledAt`, `cancelledBy`,
        // `cancellationSource`, and `updatedAt`
        // share the `now` value captured at the
        // top of the handler. The loyalty clawback
        // mirrors MRB-05's per-child pattern: a
        // negative `pointsHistory` entry keyed
        // `clawback-${bookingId}` for each cancelled
        // child with `loyaltyAwardStatus ===
        // "awarded"` and a positive `pointsAwarded`.
        // The `rewardsPoints` field is NOT
        // decremented in place; the negative ledger
        // entry preserves the invariant
        // `rewardsPoints == sum(pointsHistory.points)`.
        for (const child of children) {
          if (!cancellableIds.has(child.id)) continue;
          transaction.update(child.ref, {
            status: "cancelled",
            cancellationReason: validReason,
            cancelledAt: now,
            cancelledBy,
            cancellationSource,
            updatedAt: now
          });
          if (
            child.data.loyaltyAwardStatus === "awarded"
            && Number(child.data.pointsAwarded || 0) > 0
          ) {
            const memberId = String(child.data.memberId || "").trim();
            if (memberId) {
              const memberRef = adminDb.collection("members").doc(memberId);
              const memberDoc = await transaction.get(memberRef);
              if (memberDoc.exists) {
                const clawbackPoints = -Number(child.data.pointsAwarded || 0);
                const clawbackHistoryRef = memberRef.collection("pointsHistory").doc(`clawback-${child.id}`);
                transaction.set(clawbackHistoryRef, {
                  type: "clawback",
                  points: clawbackPoints,
                  bookingId: child.id,
                  bookingRef: child.data.bookingRef,
                  description: `Cancellation clawback for cancelled stay (${child.data.bookingRef})`,
                  by: cancelledBy,
                  createdAt: now
                });
                transaction.update(child.ref, {
                  pointsAwarded: 0,
                  loyaltyAwardStatus: "clawback-recorded",
                  pointsAwardedAt: null
                });
              }
            }
          }
        }

        // Per MRB-13: deduped voucher decrements.
        // One `transaction.update` per unique
        // voucher code, decremented by the count
        // of cancelled children that used it.
        for (const [code, count] of voucherCounts.entries()) {
          const vRef = adminDb.collection("vouchers").doc(code);
          const vDoc = await transaction.get(vRef);
          if (vDoc.exists) {
            const vData = vDoc.data() || {};
            transaction.update(vRef, {
              usageCount: Math.max((Number(vData.usageCount) || 0) - count, 0),
              updatedAt: now
            });
          }
        }
        for (const [code, count] of corporateCounts.entries()) {
          const cpRef = adminDb.collection("corporateCodes").doc(code);
          const cpDoc = await transaction.get(cpRef);
          if (cpDoc.exists) {
            const cpData = cpDoc.data() || {};
            transaction.update(cpRef, {
              usageCount: Math.max((Number(cpData.usageCount) || 0) - count, 0),
              updatedAt: now
            });
          }
        }

        // Per BAR-02 (2026-08-08, per decision #203):
        // the five aggregate counter fields +
        // `paymentStatus` are no longer written to the
        // reservation header on cancel. Consumers
        // derive them via `deriveReservationCounters` +
        // `computeReservationAggregatePaymentStatus`
        // over the children at read time. The
        // per-child cancellation stamps (CRL-02) and
        // the liability snapshot (CRL-07) are still
        // written — those are real denormalized
        // values, not pure projections.
        // Per CRL-07 (2026-08-03, per decision #173):
        // the liability snapshot is stamped onto the
        // reservation header (the source of truth for
        // the reservation-scope cancel) only when
        // `policyRefund > 0` (the helper returns `null`
        // for no-refund cancels). The header field
        // shares the same `now` as the cancellation
        // stamp — no clock skew between the two.
        const reservationHeaderUpdate: Record<string, any> = {
          updatedAt: now
        };
        if (liabilitySnapshot) {
          reservationHeaderUpdate.cancellationLiability = liabilitySnapshot;
        }
        transaction.update(reservationRef, reservationHeaderUpdate);
      });
    } else {
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

      // Per CRL-07 (2026-08-03, per decision #173):
      // the per-child liability snapshot. Computed in
      // the same transaction as the status flip so
      // the snapshot is atomic with the audit
      // stamps. The helper is the same
      // `computeCancellationLiabilityInTransaction`
      // the reservation-scope branch uses — the only
      // difference is the `scope: "room"` flag and
      // the cancellable-children set is just this one
      // booking (per-child path). For new
      // reservations the snapshot lives on the
      // booking doc; for legacy null-`reservationId`
      // bookings the booking IS the reservation and
      // the snapshot lives here too. The header
      // mirror below (per MRB-05) updates the
      // reservation's `paymentStatus` but does NOT
      // touch the header's `cancellationLiability`
      // (the header has no liability field on a
      // per-child cancel — the cancelled child
      // carries the snapshot).
      const bookingReservationIdForLiability = String(freshBooking.reservationId || "").trim();
      const liabilitySnapshot = await computeCancellationLiabilityInTransaction(
        transaction,
        {
          now,
          scope: "room",
          lookedUpBooking: {
            id: bookingDocumentRef.id,
            bookingRef: String(freshBooking.bookingRef || ""),
            status: String(freshBooking.status || ""),
            roomType: String(freshBooking.roomType || ""),
            totalPrice: Number(freshBooking.totalPrice) || 0,
            reservationPosition: Number(freshBooking.reservationPosition) || null,
            cancellationPolicySnapshot: freshBooking.cancellationPolicySnapshot || null
          },
          // For per-child cancel, the helper needs
          // the reservation context (the folio read
          // uses the new subcollections when a
          // reservationId is present). For legacy
          // null-`reservationId` bookings the helper
          // falls through to the legacy per-booking
          // payments read.
          reservation: bookingReservationIdForLiability.length > 0
            ? {
              id: bookingReservationIdForLiability,
              reservationRef: String((freshBooking as any).reservationRef || ""),
              totalPrice: Number(freshBooking.totalPrice) || 0
            }
            : null,
          cancellableChildren: [{
            id: bookingDocumentRef.id,
            bookingRef: String(freshBooking.bookingRef || ""),
            status: String(freshBooking.status || ""),
            roomType: String(freshBooking.roomType || ""),
            totalPrice: Number(freshBooking.totalPrice) || 0,
            reservationPosition: Number(freshBooking.reservationPosition) || null,
            cancellationPolicySnapshot: freshBooking.cancellationPolicySnapshot || null
          }]
        }
      );

      // Per CRL-07: the booking doc update now also
      // carries the liability snapshot (when one was
      // produced). The status flip + audit stamps +
      // snapshot share a single `transaction.update`
      // call so a partial failure cannot leave a
      // half-stamped cancellation.
      const bookingUpdate: Record<string, any> = {
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
      };
      if (liabilitySnapshot) {
        bookingUpdate.cancellationLiability = liabilitySnapshot;
      }
      transaction.update(bookingDocumentRef, bookingUpdate);

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
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written to the reservation header on a
      // single-cancel. Consumers derive it at read
      // time (an all-cancelled N=1 reservation
      // surfaces the `"cancelled"` aggregate
      // automatically). The per-child cancellation
      // stamps (CRL-02) + the liability snapshot
      // (CRL-07) on the booking doc are unchanged —
      // those are real denormalized values.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
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
    }

    try {
      // Per MRB-09 (2026-08-02, per decision #168) +
      // MRB-13 (2026-08-02, per decision #166): the
      // reservation-scope email view. The pre-MRB-09
      // per-child path stayed correct (one email per
      // cancelled child), but the body rendered only
      // the single room. The view loader reads the
      // reservation header + sibling children and
      // hands the multi-room view to the template.
      // The reservation-scope path fires
      // `booking-cancelled-reservation` (the
      // `rooms[]`-aware template added in MRB-09);
      // the per-child path keeps `booking-cancelled`
      // (which MRB-09 already taught to render the
      // full reservation view when the booking has a
      // `reservationId`).
      //
      // Per CRL-08 (2026-08-03, per decision #174):
      // the cancellation template renders the
      // financial breakdown. The projection comes
      // from `loadLiabilityProjectionForEmail`
      // (the same shape `handleAddRefund` + the
      // CRL-07 projection endpoint use). The
      // reservation-scope path's projection is
      // already attached by `loadReservationEmailView`
      // (which calls the helper internally); the
      // legacy null-`reservationId` path loads it
      // here so the bare-booking view also carries
      // the breakdown. The projection is `null`
      // when no liability was stamped (a pre-CRL-07
      // cancel or a no-refund cancel) — the template
      // falls through to the legacy
      // "no refund is issued automatically" copy.
      const { loadLiabilityProjectionForEmail } = await import("./email");
      const reservationView = await loadReservationEmailView(bookingId);
      const liabilityProjection = reservationView
        ? reservationView.liabilityProjection
        : await loadLiabilityProjectionForEmail({ bookingId });
      const cancellationSourceForEmail: "guest" | "staff" | "system" = cancelledBy === "guest"
        ? "guest"
        : (cancelledBy === "system" ? "system" : "staff");
      await sendBookingTrigger(
        postTransactionAction,
        reservationView
          ? {
              ...reservationView,
              cancellationReason: validReason,
              cancellationSource: cancellationSourceForEmail,
              liabilityProjection
            }
          : { ...bookingData, cancellationReason: validReason, liabilityProjection }
      );
    } catch (emailErr) {
      console.error("Failed to send cancellation email:", emailErr);
    }

    // Per CRL-08 (2026-08-03, per decision #174):
    // the staff notification. Fires when the
    // destructive cancel stamps a non-null
    // `cancellationLiability` (the desk sees a
    // "money to process" alert in the bell
    // panel). For a no-refund cancel the
    // snapshot is `null` and the notification is
    // skipped (the absence means "no liability
    // work to do" per CRL-07). The title
    // includes the policy refund + the new state
    // so the desk knows the magnitude + the
    // lifecycle position without opening the
    // booking drawer. Best-effort (the
    // best-effort pattern #120 establishes — a
    // failed notification must never fail the
    // cancel it describes).
    try {
      const { writeNotification } = await import("../lib/notifications");
      // The snapshot the cancel just stamped
      // lives on the reservation header (for
      // reservation-scope cancels + new-path N=1)
      // OR the booking doc (per-child + legacy
      // null-`reservationId`). Read the
      // post-cancel snapshot from the same
      // location the cancel wrote to.
      const liabilityTargetRef = lookedUpReservationId
        ? adminDb.collection("reservations").doc(lookedUpReservationId)
        : adminDb.collection("bookings").doc(bookingDocumentRef.id);
      const liabilityDoc = await liabilityTargetRef.get();
      const liability = liabilityDoc.exists
        ? (liabilityDoc.data() as any)?.cancellationLiability
        : null;
      if (liability && liability.policyResult) {
        const policyRefund = Number(liability.policyResult?.policyRefund || 0);
        const { computeCancellationLiabilityState } = await import("@spark-inn/shared");
        const projection = computeCancellationLiabilityState({ liability, processedAmount: 0 });
        const stateLabel = projection.stateLabel || "Pending refund";
        const notifTitle = policyRefund > 0
          ? `Cancellation refund pending — ${bookingData.bookingRef || bookingId} (${stateLabel}, ₱${policyRefund.toLocaleString("en-PH")})`
          : `Cancellation recorded — ${bookingData.bookingRef || bookingId} (no refund owed)`;
        await writeNotification({
          type: "cancellation-refund",
          title: notifTitle,
          entityType: "booking",
          entityId: bookingId,
          roomNumber: bookingData.roomNumber || null,
          bookingRef: bookingData.bookingRef || null
        });
      }
    } catch (notifErr) {
      console.error("[cancel-booking] Staff notification failed; continuing:", notifErr);
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

// Per CRL-06 (2026-08-02): the cancellation preview
// handler. Returns the financial effect of a cancel
// WITHOUT mutating anything — the guest + admin
// modals call this on open (and on scope flip in the
// admin modal) and render the breakdown before the
// user taps confirm. The destructive cancel never
// auto-refunds (CRL-04); the preview makes that
// explicit by surfacing `staffProcessingRequired`
// when the policy refunds money AND the guest has
// paid.
//
// Auth is the same as the destructive cancel: staff
// requests bypass the body schema and look up by
// `bookingId` / `bookingRef`; guest requests go
// through `guestCancelPreviewSchema` and require the
// `bookingRef + (email | token)` credential. The
// apiRouter applies a 10/min/IP rate limit so a
// flood of previews is bounded independently of the
// cancel bucket. The handler is read-only — no
// `runTransaction`, no writes to Firestore.
export async function handleCancelPreview(req: any, res: any) {
  const { bookingId, bookingRef } = req.body || {};

  // Derive the scope selector the same way the cancel
  // handler does (see `handleCancelBooking`): the staff
  // path reads `req.body.scope` directly (no schema
  // gate on the staff body), the guest path uses the
  // schema-validated value. Default `"room"` keeps
  // the legacy single-child behavior for every
  // existing caller that omits the field.
  let requestedScope: "room" | "reservation" = req.staff
    ? (String((req.body || {}).scope || "").trim().toLowerCase() === "reservation"
      ? "reservation"
      : "room")
    : "room";

  try {
    let bookingDocumentRef: any;
    let bookingData: any;

    if (req.staff) {
      // Per CRL-06: staff preview bypasses the
      // guest credential (the staff is already
      // authenticated). Same resolution shape as
      // the cancel handler — `bookingId` preferred,
      // `bookingRef` as a fallback.
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
      // Per CRL-06: the guest preview goes through
      // `guestCancelPreviewSchema` (the credential
      // gate) and reads the booking the same way the
      // cancel handler does. No Turnstile (the
      // preview is read-only, the credential is the
      // gate, the apiRouter rate limit is the
      // secondary defence).
      const parsed = guestCancelPreviewSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: "Please provide a valid booking reference and email or lookup token."
        });
      }
      requestedScope = parsed.data.scope;
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

    // The reservation-scope path needs the looked-up
    // booking's `reservationId` to read the siblings
    // + the reservation header. The per-child path
    // (scope === "room" OR legacy null-
    // `reservationId`) skips the sibling read.
    const lookedUpReservationId = String(bookingData.reservationId || "").trim();
    const hasReservation = lookedUpReservationId.length > 0;
    const isReservationScope = requestedScope === "reservation" && lookedUpReservationId.length > 0;

    // Per CRL-06: the canonical `now` for the
    // policy evaluation. Captured here (not inside
    // the helper) so the previews triggered by the
    // same modal open stay consistent — a re-render
    // on scope flip uses a fresh `now` (the policy
    // cutoff can move between renders).
    const now = new Date();

    // Per CRL-06: read the reservation header + N
    // children (when reservation-scope) or the single
    // looked-up booking (per-child). The same shape
    // the cancel handler uses for the reservation-
    // scope branch.
    let reservation: { id: string; reservationRef: string; totalPrice: number } | null = null;
    let cancellableChildren: Array<{
      id: string;
      bookingRef: string;
      status: string;
      roomType: string;
      totalPrice: number;
      reservationPosition: number | null;
      cancellationPolicySnapshot: any;
    }> = [];
    let allocationSubtotal = Math.max(Number(bookingData.totalPrice) || 0, 0);

    if (hasReservation) {
      const reservationRef = adminDb.collection("reservations").doc(lookedUpReservationId);
      const [reservationDoc, childrenSnap] = await Promise.all([
        reservationRef.get(),
        adminDb.collection("bookings")
          .where("reservationId", "==", lookedUpReservationId)
          .get()
      ]);
      if (!reservationDoc.exists) {
        return res.status(404).json({ success: false, error: "Reservation not found." });
      }
      const reservationSnapshot = reservationDoc.data() || {};
      reservation = {
        id: lookedUpReservationId,
        reservationRef: String(reservationSnapshot.reservationRef || ""),
        totalPrice: Number(reservationSnapshot.totalPrice) || 0
      };
      const eligibleChildren = childrenSnap.docs
        .map((d: any) => {
          const data = d.data() || {};
          // The preview's cancellable set mirrors the
          // cancel handler's filter: terminal
          // (`checked-in` / `cancelled`) + source-
          // mismatched statuses are skipped. The
          // guest preview is always the guest path
          // (the staff preview uses the staff
          // source). For the source-specific filter:
          // - guest path: only `GUEST_CANCELLABLE_STATUSES`
          //   (per CRL-03)
          // - staff path: every pre-arrival status
          //   (the cancel handler covers all of them)
          const status = String(data.status || "");
          if (status === "checked-in" || status === "cancelled") return null;
          if (
            !req.staff
            && !(GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(status)
          ) {
            return null;
          }
          return {
            id: d.id,
            bookingRef: String(data.bookingRef || ""),
            status,
            roomType: String(data.roomType || ""),
            totalPrice: Number(data.totalPrice) || 0,
            reservationPosition: Number(data.reservationPosition) || null,
            cancellationPolicySnapshot: data.cancellationPolicySnapshot || null
          };
        })
        .filter(Boolean) as typeof cancellableChildren;
      allocationSubtotal = eligibleChildren.reduce(
        (sum, child) => sum + Math.max(Number(child.totalPrice) || 0, 0),
        0
      );
      cancellableChildren = isReservationScope
        ? eligibleChildren
        : eligibleChildren.filter((child) => child.id === bookingDocumentRef.id);
    } else {
      // The per-child path is byte-equivalent to the
      // destructive cancel's per-child branch — a
      // single child with the looked-up booking's
      // own snapshot. The legacy null-`reservationId`
      // path is the same shape (no sibling read).
      cancellableChildren = [{
        id: bookingDocumentRef.id,
        bookingRef: String(bookingData.bookingRef || ""),
        status: String(bookingData.status || ""),
        roomType: String(bookingData.roomType || ""),
        totalPrice: Number(bookingData.totalPrice) || 0,
        reservationPosition: Number(bookingData.reservationPosition) || null,
        cancellationPolicySnapshot: bookingData.cancellationPolicySnapshot || null
      }];
    }

    // Per CRL-06: read the reservation folio (or
    // the legacy per-booking folio) to compute the
    // net-collected total. The reservation case
    // reads `reservations/{id}/payments` +
    // `reservations/{id}/refunds`; the legacy case
    // reads `bookings/{id}/payments` +
    // `bookings/{id}/refunds`. The sign-aware sum
    // (refunds are negative on the wire, per CRL-01)
    // is the same shape `getReservationFolioSummary`
    // uses internally — we inline the math here so
    // the preview stays a single read pass with no
    // extra helper overhead.
    let reservationNetCollected = 0;
    if (hasReservation && reservation) {
      const [reservationPaymentsSnap, reservationRefundsSnap] = await Promise.all([
        adminDb.collection("reservations").doc(reservation.id).collection("payments").get(),
        adminDb.collection("reservations").doc(reservation.id).collection("refunds").get()
      ]);
      reservationNetCollected =
        reservationPaymentsSnap.docs.reduce(
          (sum: number, d: any) => sum + (Number(d.data()?.amount) || 0),
          0
        ) +
        reservationRefundsSnap.docs.reduce(
          (sum: number, d: any) => sum + (Number(d.data()?.amount) || 0),
          0
        );
    } else {
      // Legacy per-booking path. The bookings/{id}/
      // payments subcollection carries both payments
      // (positive) and refunds (negative, per CRL-01)
      // in the legacy adapter — the sign-aware sum
      // gives the net collected.
      const legacyFolioSnap = await adminDb.collection("bookings")
        .doc(bookingDocumentRef.id)
        .collection("payments")
        .get();
      reservationNetCollected = legacyFolioSnap.docs.reduce(
        (sum: number, d: any) => sum + (Number(d.data()?.amount) || 0),
        0
      );
    }

    // Per CRL-06: shape the looked-up booking for the
    // helper. The `lookedUpBooking` is the room the
    // guest opened the preview on (the anchor); the
    // `cancellableChildren` is the full set the
    // policy applies to (a single child for `"room"`
    // scope, N children for `"reservation"` scope).
    const lookedUpBookingForHelper = {
      id: bookingDocumentRef.id,
      bookingRef: String(bookingData.bookingRef || ""),
      status: String(bookingData.status || ""),
      roomType: String(bookingData.roomType || ""),
      totalPrice: Number(bookingData.totalPrice) || 0,
      reservationPosition: Number(bookingData.reservationPosition) || null,
      cancellationPolicySnapshot: bookingData.cancellationPolicySnapshot || null
    };

    const preview = evaluateCancelPreview({
      scope: requestedScope,
      now,
      lookedUpBooking: lookedUpBookingForHelper,
      reservation,
      cancellableChildren,
      reservationNetCollected,
      allocationSubtotal
    });

    return res.status(200).json({ success: true, preview });
  } catch (error: any) {
    console.error("Booking cancellation preview error:", error);
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
  // Per FOL-05 (2026-08-07, per decision #201): the
  // count of sibling children that just transitioned to
  // `payment-confirmed` inside this add-payment
  // transaction. Surfaced in the post-transaction response
  // for symmetry with `handleVerifyAndRecordPayment`'s
  // `siblingFlippedCount`. Zero for the N=1 case.
  let siblingFlippedCount = 0;

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

      // Per FOL-05 (2026-08-07, per decision #201): the
      // Per FOL-05 (2026-08-07, per decision #201):
      // sibling-flip pre-read. Same pattern as
      // `handleVerifyAndRecordPayment` — pre-read every
      // child of the reservation BEFORE any writes
      // (FOL-03 "reads before writes") so the
      // sibling-flip pass can compute the post-update
      // child statuses in a single deterministic array.
      //
      // Per BAR-03 (2026-08-08, per decision #204):
      // the pre-read is the shared
      // `preReadSiblingChildren` helper. The
      // `bookingReservationId.length === 0` guard
      // (inside the helper) skips the pre-read for
      // legacy null-`reservationId` bookings — the
      // pre-FOL-05 single-child-only path stays
      // byte-equivalent.
      const siblingChildBookings = await preReadSiblingChildren(
        transaction,
        adminDb,
        bookingReservationId,
        (d) => {
          const childData = d.data() || {};
          return {
            id: d.id,
            status: String(childData.status || ""),
            totalPrice: Number(childData.totalPrice || 0)
          };
        }
      );

      totalPrice = Number(bookingData.totalPrice || 0);
      fullyPaid = totalPrice > 0 && totalPaid >= totalPrice;
      isConfirmableStatus = bookingData.status === "pending"
        || bookingData.status === "payment-uploaded";
      hadPaymentProof = !!(bookingData.paymentProofPath || bookingData.paymentProofUrl);
      staffPaymentMarkerMissing = !bookingData.emailNotificationsSent?.staffNewPayment;

      // Per FOL-05 (2026-08-07, per decision #201): the
      // post-update child status computation. Same rule
      // as `handleVerifyAndRecordPayment` — for each
      // child, the post-update status is
      // `payment-confirmed` if the new cumulative
      // reservation payments cover that child's
      // `totalPrice` AND the child's current status is
      // `pending` or `payment-uploaded`. Otherwise no
      // change. For legacy N=1 the array has one
      // element and the rule is byte-equivalent to the
      // pre-FOL-05 `fullyPaid` flag.
      //
      // Per BAR-03 (2026-08-08, per decision #204): the
      // sibling-flip pass is the shared
      // `applyReservationScopePaymentTransition` helper.
      // The handler passes a per-handler `rule.decide`
      // callback (the per-child coverage check + the
      // write payload); the helper handles the
      // per-sibling `transaction.update` + the
      // post-update statuses array + the reservation
      // header heartbeat.
      const { siblingFlippedCount: helperSiblingFlippedCount } =
        applyReservationScopePaymentTransition(
          transaction,
          adminDb,
          bookingReservationId,
          bookingId,
          siblingChildBookings,
          (child) => {
            const coversChild = child.totalPrice > 0 && totalPaid >= child.totalPrice;
            const isFlippableStatus = child.status === "pending" || child.status === "payment-uploaded";
            if (isFlippableStatus && coversChild) {
              const decision: SiblingFlipDecision = {
                write: {
                  status: "payment-confirmed",
                  paymentConfirmedAt: now,
                  handledBy: staffUid,
                  updatedAt: now
                },
                newStatus: "payment-confirmed"
              };
              return decision;
            }
            return null;
          },
          now
        );
      siblingFlippedCount = helperSiblingFlippedCount;

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
          paymentConfirmedAt: now,
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

      // ---- ALL WRITES BELOW — no `transaction.get()` calls from this
      // point forward. Per FOL-03. ----

      if (Object.keys(bookingUpdates).length > 0) {
        transaction.update(bookingRef, bookingUpdates);
      }

      // Per BAR-03 (2026-08-08, per decision #204):
      // the per-sibling `transaction.update` calls + the
      // reservation header heartbeat are queued by the
      // shared `applyReservationScopePaymentTransition`
      // helper above (called from the post-update status
      // computation step). The target's own status
      // update was already queued by the
      // `transitionedToPaymentConfirmed` block above.

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
    // Per FOL-05 (2026-08-07, per decision #201): the
    // sibling-flip bell notification. Same shape as
    // `handleVerifyAndRecordPayment`'s sibling-flips
    // notification. Fires only when the add-payment
    // pass cleared at least one sibling room (zero
    // for the N=1 case). The notification is keyed
    // to the target booking (the lead) so the bell
    // panel surfaces it under the same reservation
    // row the staff added the payment against.
    if (siblingFlippedCount > 0) {
      await writeNotification({
        type: "payment",
        title: `${siblingFlippedCount} more room${siblingFlippedCount === 1 ? "" : "s"} cleared — ${bookingDataSnapshot.bookingRef || bookingId}`,
        entityType: "booking",
        entityId: bookingId,
        roomNumber: bookingDataSnapshot.roomNumber || null,
        bookingRef: bookingDataSnapshot.bookingRef || null
      });
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      ...paymentRecord,
      totalPaid,
      status: bookingDataSnapshot?.status || null,
      loyaltyPointsAwarded,
      idempotentReplay,
      // Per FOL-05 (2026-08-07, per decision #201):
      // the sibling-flip count for symmetry with
      // `handleVerifyAndRecordPayment`. Zero for the
      // N=1 case.
      siblingFlippedCount
    }
  });
}

// Per CRL-08 (2026-08-03, per decision #174): the
// post-commit side effect for a successful refund
// that changed the liability state. The helper
// fires the refund-state email + writes a
// persistent staff notification (the bell panel
// trail). Best-effort: errors are logged +
// swallowed — a failed side effect must never
// fail the refund it describes. Mirrors the
// best-effort pattern `writeNotification` + the
// email-send helpers follow.
async function fireRefundStateEmailAndNotification(params: {
  targetBookingId: string;
  targetReservationId: string | null;
  priorState: string;
  newState: string;
  refundRecord: Record<string, any>;
  numericAmount: number;
  safeMethod: string;
  safeReason: string;
  safeTransactionReference: string | null;
  liability: any;
}) {
  // Load the booking doc the email needs
  // (`guestEmail` + `guestName` + `reservationRef`).
  // Non-fatal if the read fails (the email handler
  // throws on a missing email, the staff
  // notification falls back to a generic title).
  const bookingDoc = await adminDb.collection("bookings").doc(params.targetBookingId).get();
  const bookingData = bookingDoc.exists ? (bookingDoc.data() || {}) : {};
  const guestEmail = String(bookingData.guestEmail || "").trim();
  // The liability projection for the email. The
  // refund subcollection is now `prior
  // processedAmount + numericAmount`; the state
  // was just computed inside the transaction
  // (closed over `newStateRef`). The projection
  // is the full breakdown the template renders.
  let liabilityProjection: any = null;
  try {
    const { loadLiabilityProjectionForEmail } = await import("./email");
    liabilityProjection = await loadLiabilityProjectionForEmail({
      reservationId: params.targetReservationId,
      bookingId: params.targetBookingId
    });
  } catch (projErr) {
    console.warn("[add-refund] Liability projection failed; email fires with the basic breakdown:", projErr);
  }
  // The "latest refund" view the email renders
  // in the dedicated card. The just-committed
  // entry's amount is negative on the wire
  // (CRL-01 negative-amount convention); the
  // template reads the absolute value.
  const latestRefund = {
    amount: -Math.abs(params.numericAmount),
    method: params.safeMethod,
    reason: params.safeReason,
    transactionReference: params.safeTransactionReference,
    recordedAt: params.refundRecord?.recordedAt || new Date()
  };
  // Fire the refund-state email. The subject
  // and body are template-driven (per
  // `bookingRefundProcessedEmail`); the handler
  // is the source of truth for the gate. The
  // email is only sent when the guest email
  // exists (defensive guard — a missing email
  // is not a refund-blocker).
  if (guestEmail) {
    try {
      const { sendBookingTrigger } = await import("./email");
      const emailView: any = {
        ...bookingData,
        id: params.targetBookingId,
        reservationId: params.targetReservationId,
        liabilityProjection,
        latestRefund
      };
      await sendBookingTrigger("booking-refund-processed", emailView);
    } catch (emailErr) {
      console.error("[add-refund] Refund-state email failed; continuing:", emailErr);
    }
  }
  // The persistent staff notification. Title
  // tells the desk which booking + which state
  // transition (e.g. "Refund processed —
  // SI-…: pending → partial"). The bell panel
  // picks it up via the existing `onSnapshot`
  // listener (decision #120).
  const stateLabel = liabilityProjection?.stateLabel || params.newState;
  const bookingRefForTitle = String(bookingData.bookingRef || params.targetBookingId).trim();
  const notifTitle = `Refund ${stateLabel.toLowerCase()} — ${bookingRefForTitle} (${params.priorState} → ${params.newState})`;
  try {
    const { writeNotification } = await import("../lib/notifications");
    await writeNotification({
      type: "cancellation-refund",
      title: notifTitle,
      entityType: "booking",
      entityId: params.targetBookingId,
      roomNumber: bookingData.roomNumber || null,
      bookingRef: bookingData.bookingRef || null
    });
  } catch (notifErr) {
    console.error("[add-refund] Staff notification failed; continuing:", notifErr);
  }
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
    // Per CRL-08 (2026-08-03, per decision #174):
    // the state-change gate. The transaction
    // closure sets these when a liability exists;
    // the post-commit side-effect reads them.
    // Closure-scoped locals (not a return value)
    // keep the existing transaction shape
    // unchanged.
    let priorStateRef: string | null = null;
    let newStateRef: string | null = null;
    let priorLiabilityRef: any = null;
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

      // Per CRL-08 (2026-08-03, per decision #174):
      // the state-change gate for the refund-state
      // email. The handler computes the prior state
      // from the stored liability + the CURRENT
      // `processedAmount` (BEFORE this refund), then
      // re-computes the new state after the commit
      // (with the new `processedAmount = prior +
      // numericAmount`). A state change is the
      // trigger — an idempotent replay or a
      // sub-state partial does not re-send. The
      // fields are read in the same transaction so
      // the gate is atomic with the refund write.
      //
      // The `cancellationLiability` lives on the
      // cancelled entity (reservation header for
      // new reservations, booking doc for legacy
      // null-`reservationId` bookings + per-child
      // cancels in a multi-room reservation). The
      // refund writer reads from the same location
      // the snapshot was stamped on (the dual-source
      // read MRB-04 Phase 2.x established).
      const liabilityDoc = bookingReservationId.length > 0
        ? adminDb.collection("reservations").doc(bookingReservationId)
        : bookingRef;
      const liabilityData = (await transaction.get(liabilityDoc)).data() || {};
      const liability = (liabilityData as any).cancellationLiability || null;
      priorLiabilityRef = liability;
      if (liability && liability.policyResult) {
        const { computeCancellationLiabilityState } = await import("@spark-inn/shared");
        // The `processedAmount` for the prior
        // state is the absolute sum of existing
        // refund entries (refunds are negative on
        // the wire, per CRL-01).
        const priorProcessedAmount = refundsSnapshot.docs.reduce(
          (sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)),
          0
        );
        const priorProjection = computeCancellationLiabilityState({
          liability,
          processedAmount: priorProcessedAmount
        });
        // Capture the prior state + the new state in
        // closure-scoped locals (the post-commit
        // side-effect reads them after the
        // transaction returns).
        priorStateRef = priorProjection.state;
        // The new state uses the same liability
        // (the writer does not mutate
        // `cancellationLiability`; only the
        // refunds subcollection grows) with the
        // new `processedAmount`.
        const newProjection = computeCancellationLiabilityState({
          liability,
          processedAmount: priorProcessedAmount + numericAmount
        });
        newStateRef = newProjection.state;
      }

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
    // Per CRL-08 (2026-08-03, per decision #174):
    // post-commit side effects. The refund-state
    // email fires when the state actually
    // changed; the staff notification fires for
    // the same gate (the persistent bell trail).
    // Both are best-effort (the same pattern the
    // email + notification helpers follow — a
    // failed side effect must never fail the
    // refund). The idempotent-replay path skips
    // both (no state change, no notification, no
    // email). When `priorState` is `null` (no
    // liability exists — a pre-CRL-07 cancel, or
    // a refund on a non-cancelled booking), the
    // gate is also off.
    if (
      !idempotentReplay
      && priorStateRef
      && newStateRef
      && priorStateRef !== newStateRef
      && priorLiabilityRef
    ) {
      try {
        await fireRefundStateEmailAndNotification({
          targetBookingId: bookingId,
          targetReservationId: bookingReservationId.length > 0 ? bookingReservationId : null,
          priorState: priorStateRef,
          newState: newStateRef,
          refundRecord,
          numericAmount,
          safeMethod,
          safeReason,
          safeTransactionReference,
          liability: priorLiabilityRef
        });
      } catch (sideEffectErr) {
        // Per the best-effort pattern (decision
        // #120): log + swallow. A failed
        // email/notification must never fail the
        // refund it describes.
        console.error("[add-refund] Post-commit side effect failed:", sideEffectErr);
      }
    }
    return res.status(200).json({
      success: true,
      data: {
        ...refundRecord,
        netCollected: netCollected - numericAmount,
        idempotentReplay,
        // Echo the prior + new state so the
        // client UI can update the panel without
        // a re-fetch (the read-only projection
        // endpoint stays the source of truth).
        stateTransition: priorStateRef && newStateRef && priorStateRef !== newStateRef
          ? { from: priorStateRef, to: newStateRef }
          : null
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

// Per CRL-07 (2026-08-03, per decision #173): the
// admin-only endpoint to apply a discretionary
// exception to a cancelled booking's (or
// reservation's) refund liability. The exception
// reduces `approvedAmount` below the policy
// result's `policyRefund`; it NEVER increases it
// (the "exception can only retain, never refund
// more than the policy says" invariant). The
// policy result itself is read-only — the
// endpoint mutates `approvedAmount` + the
// `exception` audit field only.
//
// Auth is admin-only (mirroring `handleAddRefund`);
// front-desk staff cannot record exceptions. The
// caller must supply a non-empty `reason` (capped
// at 500 chars to match CRL-02's `cancellationReason`
// cap + the existing free-form string cap) and an
// `approvedAmount` that is `0 ≤ amount ≤
// liability.policyResult.policyRefund`. The
// endpoint reads the `cancellationLiability` field
// in the same transaction that writes the new
// value, so a concurrent refund write cannot
// race the exception read (Firestore transactions
// serialise reads + writes atomically).
//
// Idempotency: the same `approvedAmount` + `reason`
// from a retry-after-uncertain-response replays
// the original commit (returns 200 with the
// current snapshot, no double-write). A different
// `approvedAmount` or `reason` with the same
// booking/reservation ID is a fresh mutation
// (the previous `exception` field is overwritten
// in the new audit row).
//
// Lives at:
//   - `reservations/{id}.cancellationLiability` when
//     the booking has a `reservationId` AND the
//     reservation was cancelled reservation-scope
//     (CRL-07 stamps the header for reservation-
//     scope cancels).
//   - `bookings/{id}.cancellationLiability` for
//     per-child cancels + legacy null-`reservationId`
//     bookings.
export async function handleRecordCancellationException(req: any, res: any) {
  // Per CRL-07: the spec body says "only Admin may
  // approve an exception" — admin-only. The check
  // mirrors `handleAddRefund`'s gate. A non-admin
  // staff role is rejected with 403 (a different
  // 401/403 mix from the credential gate, but the
  // apiRouter's `authenticateStaff` already returned
  // 401/403 for unauthenticated requests, so the
  // 403 here is the "authenticated, but not
  // allowed" signal).
  if (req.staff?.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only an administrator can approve a cancellation exception." });
  }
  // The body accepts either a `reservationId` (for
  // reservation-scope cancels) or a `bookingId`
  // (for per-child cancels + legacy bookings). One
  // is required; the server picks the right
  // document based on which is present. A body
  // with both is rejected (the storage path is
  // unambiguous on the cancellation type, not a
  // client choice).
  const { reservationId, bookingId, approvedAmount, reason } = req.body || {};
  const safeReservationId = typeof reservationId === "string" ? reservationId.trim() : "";
  const safeBookingId = typeof bookingId === "string" ? bookingId.trim() : "";
  if (!safeReservationId && !safeBookingId) {
    return res.status(400).json({ success: false, error: "Either reservationId or bookingId is required." });
  }
  if (safeReservationId && safeBookingId) {
    return res.status(400).json({ success: false, error: "Provide exactly one of reservationId or bookingId, not both." });
  }
  const numericApproved = Number(approvedAmount);
  if (!Number.isFinite(numericApproved) || numericApproved < 0 || numericApproved > 1_000_000) {
    return res.status(400).json({ success: false, error: "Approved amount must be between 0 and 1,000,000." });
  }
  const safeReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (!safeReason) {
    return res.status(400).json({ success: false, error: "A reason is required for a cancellation exception." });
  }
  // The admin's UID is the audit's `approvedBy`.
  // Same pattern as `handleAddRefund.approvedBy` —
  // the staff UID is the source of truth (no
  // client-supplied UID).
  const adminUid = req.staff.uid || "admin";
  try {
    let liabilityFieldPath: "cancellationLiability" = "cancellationLiability";
    let snapshotAfter: any = null;
    let idempotentReplay = false;
    await adminDb.runTransaction(async (transaction) => {
      // Pick the right document. The reservation
      // path is the source of truth for
      // reservation-scope cancels; the booking
      // path is the source of truth for per-child
      // + legacy cancels. The endpoint never
      // "promotes" a per-child liability to the
      // header — it writes to wherever the
      // cancellation stamped the snapshot.
      const targetRef = safeReservationId
        ? adminDb.collection("reservations").doc(safeReservationId)
        : adminDb.collection("bookings").doc(safeBookingId);
      const targetDoc = await transaction.get(targetRef);
      if (!targetDoc.exists) {
        throw new Error("Target not found");
      }
      const targetData = targetDoc.data() || {};
      const liability = (targetData as any)[liabilityFieldPath];
      if (!liability || !liability.policyResult) {
        throw new Error("No cancellation liability recorded for this target.");
      }
      const policyRefund = Math.max(Number(liability.policyResult.policyRefund) || 0, 0);
      // The exception can only reduce. A client-
      // supplied `approvedAmount` that exceeds the
      // policy result is rejected (400) — the UI
      // should never let this happen, but the
      // server is the source of truth. The
      // exception endpoint never increases the
      // approved refund.
      if (numericApproved > policyRefund) {
        throw new Error("Approved amount cannot exceed the policy refund.");
      }
      const approvedRounded = Math.round(numericApproved * 100) / 100;
      const now = new Date();
      // Idempotency check: a re-submit with the
      // same `approvedAmount` + `reason` replays
      // the original commit. A different value
      // overwrites the `exception` field (the
      // audit row is the latest — the historical
      // trail is the admin notifications
      // collection CRL-08 adds). The numeric
      // `approvedAmount` on the liability is
      // updated to match the latest exception —
      // the field is the current snapshot, not a
      // history array.
      const existingException = liability.exception;
      if (
        existingException
        && Math.abs(Number(existingException.approvedAmount) || 0) === approvedRounded
        && String(existingException.reason || "") === safeReason
      ) {
        snapshotAfter = liability;
        idempotentReplay = true;
        return;
      }
      const newException = {
        approvedAmount: approvedRounded,
        reason: safeReason,
        approvedBy: adminUid,
        approvedAt: now
      };
      const newLiability = {
        ...liability,
        approvedAmount: approvedRounded,
        exception: newException
      };
      transaction.update(targetRef, {
        [liabilityFieldPath]: newLiability,
        updatedAt: now
      });
      snapshotAfter = newLiability;
    });
    return res.status(200).json({
      success: true,
      data: {
        cancellationLiability: snapshotAfter,
        idempotentReplay
      }
    });
  } catch (error: any) {
    if (error.message === "Target not found") {
      return res.status(404).json({ success: false, error: safeReservationId ? "Reservation not found." : "Booking not found." });
    }
    if (error.message === "No cancellation liability recorded for this target.") {
      return res.status(400).json({ success: false, error: "This booking or reservation has no cancellation liability to apply an exception to." });
    }
    if (String(error.message || "").startsWith("Approved amount cannot exceed")) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error("Record cancellation exception handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "Unable to record cancellation exception." });
  }
}

// Per CRL-07 (2026-08-03, per decision #173): the
// read-only helper the admin UI + Reports call to
// project the live liability state for a
// reservation or booking. Pure function that
// reads the stored liability + the current
// `processedAmount` (sum of the refunds
// subcollection) and returns the
// `CancellationLiabilityStateOutput` the UI
// renders. The reservation path reads
// `reservations/{id}/refunds/` (the canonical
// source for new reservations per MRB-04 Phase
// 2.x); the legacy path reads
// `bookings/{id}/payments/` filtered for
// negative-amount entries (the CRL-01 historical
// convention).
export async function handleGetCancellationLiability(req: any, res: any) {
  const { reservationId, bookingId } = req.body || {};
  const safeReservationId = typeof reservationId === "string" ? reservationId.trim() : "";
  const safeBookingId = typeof bookingId === "string" ? bookingId.trim() : "";
  if (!safeReservationId && !safeBookingId) {
    return res.status(400).json({ success: false, error: "Either reservationId or bookingId is required." });
  }
  if (safeReservationId && safeBookingId) {
    return res.status(400).json({ success: false, error: "Provide exactly one of reservationId or bookingId, not both." });
  }
  try {
    const isReservation = safeReservationId.length > 0;
    const targetId = isReservation ? safeReservationId : safeBookingId;
    const targetCollection = isReservation ? "reservations" : "bookings";
    const targetRef = adminDb.collection(targetCollection).doc(targetId);
    const targetDoc = await targetRef.get();
    if (!targetDoc.exists) {
      return res.status(404).json({ success: false, error: isReservation ? "Reservation not found." : "Booking not found." });
    }
    const targetData = targetDoc.data() || {};
    const liability = (targetData as any).cancellationLiability || null;
    // The `processedAmount` is the cumulative of
    // the refunds subcollection. For new
    // reservations the canonical source is
    // `reservations/{id}/refunds/` (the writer
    // for new reservations per MRB-04 Phase 2.x);
    // for legacy null-`reservationId` bookings
    // the refunds are negative-amount entries on
    // `bookings/{id}/payments/` (the CRL-01
    // historical convention — the
    // `getReservationFolioSummary` helper sums
    // both subcollections for new reservations
    // as belt-and-suspenders). The state helper
    // takes the absolute value (per the spec:
    // "derived from immutable ledger entries",
    // the cumulative is the absolute sum of the
    // refund entries).
    let processedAmount = 0;
    if (isReservation) {
      const refundsSnap = await targetRef.collection("refunds").get();
      processedAmount = refundsSnap.docs.reduce(
        (sum, d) => sum + Math.abs(Number(d.data()?.amount) || 0),
        0
      );
    } else {
      const paymentsSnap = await targetRef.collection("payments").get();
      // Legacy filter: negative-amount entries are
      // the refunds (per CRL-01's historical
      // convention on `bookings/{id}/payments`).
      processedAmount = paymentsSnap.docs
        .filter((d) => Number(d.data()?.amount) < 0)
        .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount) || 0), 0);
    }
    // Defer the import to avoid a circular
    // dependency at module load time. The
    // `computeCancellationLiabilityState` helper
    // is a pure function in the shared package
    // (no Firestore calls), so the dynamic
    // import is cheap.
    const { computeCancellationLiabilityState } = await import("@spark-inn/shared");
    const projection = computeCancellationLiabilityState({ liability, processedAmount });
    return res.status(200).json({ success: true, data: projection });
  } catch (error: any) {
    console.error("Get cancellation liability handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "Unable to load cancellation liability." });
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
    // Per FOL-05 (2026-08-07, per decision #201): the
    // count of sibling children that just transitioned to
    // `payment-confirmed` inside this verify transaction.
    // Surfaced to the post-transaction side effects so the
    // bell panel can emit a `rooms cleared` notification
    // distinct from the per-target `Payment verified` one.
    // The target's own flip is NOT counted here — it's
    // covered by the `fullyPaid` flag.
    let siblingFlippedCount = 0;

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
      // ---- READS — all reads first, per FOL-03 ----

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

      // Per FOL-05 (2026-08-07, per decision #201): the
      // sibling-flip pre-read. For new reservations (post-MRB-01)
      // we pre-read every child of the reservation BEFORE any
      // writes (FOL-03 "reads before writes" rule) so the
      // sibling-flip pass can compute the post-update child
      // Per FOL-05 (2026-08-07, per decision #201):
      // pre-read every child of the reservation BEFORE
      // any writes (FOL-03 "reads before writes") so the
      // sibling-flip pass can compute the post-update
      // child statuses in a single deterministic array.
      // Per BAR-03 (2026-08-08, per decision #204):
      // the pre-read is the shared
      // `preReadSiblingChildren` helper. The
      // `bookingReservationId.length === 0` guard
      // (inside the helper) skips the pre-read for
      // legacy null-`reservationId` bookings — the
      // pre-FOL-05 single-child-only path stays
      // byte-equivalent.
      const siblingChildBookings = await preReadSiblingChildren(
        transaction,
        adminDb,
        bookingReservationId,
        (d) => {
          const childData = d.data() || {};
          return {
            id: d.id,
            status: String(childData.status || ""),
            totalPrice: Number(childData.totalPrice || 0)
          };
        }
      );

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

      // Per FOL-05 (2026-08-07, per decision #201): the
      // status check is now reservation-aware. N=1 (no
      // flippable siblings) keeps the pre-FOL-05 contract:
      // a target already past the money gate throws
      // ALREADY_CONFIRMED (the 200 OK with
      // `alreadyConfirmed: true` the catch handler emits).
      // N>1 (at least one flippable sibling in
      // `pending` / `payment-uploaded`) RELAXES the check:
      // a target already past the money gate proceeds so
      // the sibling-flip pass can run — the target's own
      // status update is skipped (its post-update status
      // equals its pre-update status), but every covered
      // sibling still flips in the same transaction. The
      // PRC-13 email + bell notification are gated on the
      // target-flip flag (a target that's already verified
      // doesn't re-fire `payment-confirmed`). checked-in /
      // checked-out / cancelled remain INVALID_STATUS.
      const hasFlippableSiblings = siblingChildBookings.some(
        (c) => c.id !== bookingId && (c.status === "pending" || c.status === "payment-uploaded")
      );
      const targetAlreadyPastMoneyGate =
        data.status === "payment-confirmed" || data.status === "confirmed";
      if (!hasFlippableSiblings && targetAlreadyPastMoneyGate) {
        throw new Error("ALREADY_CONFIRMED");
      }
      if (
        !targetAlreadyPastMoneyGate &&
        data.status !== "payment-uploaded" &&
        data.status !== "pending"
      ) {
        throw new Error(`INVALID_STATUS:${data.status}`);
      }

      // PRC-07: method-aware reference requirement from server config.
      // Skipped when the target is already past the money gate (the
      // reference is per-payment, not per-verify-action; a second
      // verify on an already-confirmed target is the sibling-flip
      // path described above and the staff is recording a
      // supplementary payment, not verifying fresh proof).
      if (!targetAlreadyPastMoneyGate && method !== "pay-at-hotel" && method !== "add-to-bill") {
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

      // Per FOL-05 (2026-08-07, per decision #201): the
      // post-update child status computation. For each child
      // of the reservation, the post-update status is
      // `payment-confirmed` if the new cumulative reservation
      // payments cover that child's `totalPrice` AND the
      // child's current status is `pending` or
      // `payment-uploaded`. Otherwise no change. For legacy
      // N=1 the array has one element (the target) and the
      // rule is byte-equivalent to the pre-FOL-05 `fullyPaid`
      // flag.
      //
      // Per BAR-03 (2026-08-08, per decision #204): the
      // sibling-flip pass is the shared
      // `applyReservationScopePaymentTransition` helper. The
      // handler passes a per-handler `rule.decide` callback
      // (the per-child coverage check + the write payload);
      // the helper handles the per-sibling
      // `transaction.update` + the post-update statuses
      // array + the reservation header heartbeat.
      const { postUpdateChildStatuses, siblingFlippedCount: helperSiblingFlippedCount } =
        applyReservationScopePaymentTransition(
          transaction,
          adminDb,
          bookingReservationId,
          bookingId,
          siblingChildBookings,
          (child) => {
            const coversChild = child.totalPrice > 0 && totalCollected >= child.totalPrice;
            const isFlippableStatus = child.status === "pending" || child.status === "payment-uploaded";
            if (isFlippableStatus && coversChild) {
              const decision: SiblingFlipDecision = {
                write: {
                  status: "payment-confirmed",
                  paymentConfirmedAt: now,
                  handledBy: staffUid,
                  updatedAt: now
                },
                newStatus: "payment-confirmed"
              };
              return decision;
            }
            return null;
          },
          now
        );
      siblingFlippedCount = helperSiblingFlippedCount;
      // The target booking's "fullyPaid" flag = its own
      // post-update status is `payment-confirmed`. Used for
      // the PRC-13 email + the bell notification's "full"
      // variant. A target that's already past the money gate
      // is NOT counted as `fullyPaid` here (the gate was
      // crossed in a prior call; this call is the
      // sibling-flip pass).
      const targetPostStatus = siblingChildBookings.length > 0
        ? postUpdateChildStatuses[siblingChildBookings.findIndex((c) => c.id === bookingId)]
        : (totalCollected >= totalPrice && totalPrice > 0 ? "payment-confirmed" : data.status);
      fullyPaid = targetPostStatus === "payment-confirmed" && !targetAlreadyPastMoneyGate;

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

      // ---- WRITES — all writes after every `get()`, per FOL-03 ----

      // 1. Create the payment record (reservation-owned for new
      // reservations, booking-owned for legacy).
      transaction.create(paymentsRef.doc(paymentId), recordWithReservation);

      // 2. Update the target booking. The status transition fires
      // only when the target's post-update status differs from its
      // pre-update status (the FOL-05 sibling-flip pass may decide
      // the target is already past the money gate — its `fullyPaid`
      // check is "no change" and we skip the status fields). The
      // `updatedAt` stamp is unconditional so the snapshot listener
      // always sees a fresh write.
      const bookingUpdates: Record<string, any> = {
        updatedAt: now
      };
      if (targetPostStatus !== data.status) {
        bookingUpdates.status = targetPostStatus;
        bookingUpdates.handledBy = staffUid;
        bookingUpdates.paymentConfirmedAt = now;
      }
      if (Object.keys(bookingUpdates).length > 0) {
        transaction.update(bookingRef, bookingUpdates);
      }
      bookingData = { ...data, ...bookingUpdates };

      // 3. Per BAR-03 (2026-08-08, per decision #204):
      // the per-sibling `transaction.update` calls + the
      // reservation header heartbeat are queued by the
      // shared `applyReservationScopePaymentTransition`
      // helper above (called from the post-update status
      // computation step). The target's own status
      // update was already queued at step 2.
    });

    if (idempotentReplay) {
      return res.status(200).json({
        success: true,
        data: {
          idempotentReplay: true,
          paymentId,
          totalCollected,
          status: bookingData?.status || null,
          fullyPaid,
          siblingFlippedCount
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
      // Per FOL-05 (2026-08-07, per decision #201): the
      // sibling-flip bell notification. Fires when the
      // verify pass cleared at least one sibling room
      // (the FOL-05 "one click = whole reservation" semantic
      // — the desk sees both the target's full-payment
      // notification AND the per-sibling "rooms cleared"
      // breadcrumb). The notification is keyed to the
      // target booking (the lead) so the bell panel
      // surfaces it under the same reservation row the
      // staff clicked Verify on. The PRC-13 email is
      // intentionally NOT re-fired here — the original
      // `payment-confirmed` email already covered the
      // money event when the FIRST room flipped (which
      // for a full-reservation payment is the first
      // verify call's target); the sibling flips are
      // metadata for the staff, not a new guest-facing
      // event.
      if (siblingFlippedCount > 0) {
        await writeNotification({
          type: "payment",
          title: `${siblingFlippedCount} more room${siblingFlippedCount === 1 ? "" : "s"} cleared — ${bookingData?.bookingRef || bookingId}`,
          entityType: "booking",
          entityId: bookingId,
          roomNumber: bookingData?.roomNumber || null,
          bookingRef: bookingData?.bookingRef || null
        });
      }
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
        fullyPaid,
        // Per FOL-05 (2026-08-07, per decision #201):
        // the sibling-flip count surfaces to the admin UI
        // so the post-verify success modal can show a
        // "X rooms cleared" breadcrumb alongside the
        // per-target `isFullPayment` math. Zero for the
        // N=1 case (the single child either flipped via
        // the target path or didn't flip at all).
        siblingFlippedCount
      }
    });
  } catch (error: any) {
    if (error?.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error?.message === "ALREADY_CONFIRMED") {
      return res.status(200).json({
        success: true,
        data: { alreadyConfirmed: true, status: bookingData?.status || "payment-confirmed", siblingFlippedCount: 0 }
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
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written to the reservation header on
      // confirm-with-balance. Consumers derive it at
      // read time. The per-child status transition
      // (the `transaction.update` of the target
      // booking + the FOL-03 sibling
      // pre-checked-in flip) is unchanged — that is
      // the real state mutation. The
      // `bookingReservationId.length > 0` guard skips
      // the write for legacy null-`reservationId`
      // bookings — byte-equivalent to pre-Phase 5
      // behavior for legacy records. The same `now`
      // is used for the booking update AND the
      // header touch — no clock skew between the two.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
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
      // Per MRB-09 (2026-08-02, per decision #168): the
      // reservation-scope email view. The pre-MRB-09
      // per-child path stayed correct (one email per
      // confirmed child), but the body rendered only
      // the single room. The view loader reads the
      // reservation header + sibling children and
      // hands the multi-room view to the template.
      // Legacy pre-MRB-01 bookings (no `reservationId`)
      // fall through to the per-child view.
      const reservationView = await loadReservationEmailView(bookingId);
      await sendBookingTrigger(
        "booking-confirmed",
        reservationView ?? { ...bookingData, status: "confirmed" }
      );
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
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written to the reservation header on
      // confirm-with-balance-rebooking. Consumers
      // derive it at read time. The per-child status
      // transition is unchanged. The
      // `bookingReservationId.length > 0` guard skips
      // the write for legacy null-`reservationId`
      // bookings — byte-equivalent to pre-Phase 5
      // behavior for legacy records. The same `now`
      // is used for the booking update AND the
      // header touch.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
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

      // Per FOL-03 (2026-08-07, per decision #199):
      // Firestore `runTransaction` requires all `get()`
      // calls to complete BEFORE any `update()` /
      // `set()` / `create()` calls — the SDK throws
      // "Firestore transactions require all reads to
      // be executed before all writes" if the contract
      // is violated. The pre-FOL-03 handler did the
      // childrenForCount `get()` AFTER the booking +
      // room `update()` calls (a leftover from the
      // MRB-15-03 work that recomputed
      // `checkedInRoomCount` from the post-update
      // child statuses). The read-after-write pattern
      // surfaces in production as a 500 from
      // `/api/bookings/checkin` for any booking with a
      // `reservationId` — the listener throws before
      // the `transaction.update(reservationRef, ...)`
      // call ever runs, so the reservation header's
      // mirror is never written either.
      //
      // The fix: do ALL reads first (booking doc + room
      // doc + active-checkin query + children query),
      // then do ALL writes. To preserve the MRB-15-03
      // semantic ("the count includes the
      // just-checked-in booking"), we pre-read the
      // children statuses and then REPLACE the
      // current booking's status in the array with the
      // post-update value (`"checked-in"`) before
      // computing the count + the aggregate. The
      // resulting `childStatuses` array is what every
      // child's status WILL be after the writes
      // commit, so the count and the aggregate are
      // correct for the post-update state.
      //
      // The pattern is the same as
      // `handleCheckoutBooking`'s (per FOL-03) and is
      // the standard Firestore "all reads before all
      // writes" idiom — see the
      // `plan/docs/GOTCHAS.md` "Firestore transaction"
      // entry for the broader pattern.
      let postUpdateChildStatuses: string[] = [];
      if (bookingReservationId.length > 0) {
        const childrenForCount = await transaction.get(
          adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)
        );
        postUpdateChildStatuses = childrenForCount.docs.map((d: any) =>
          d.id === bookingId
            ? "checked-in" // post-update status for the just-checked-in booking
            : String(d.data()?.status || "")
        );
      }

      // ALL WRITES BELOW — no `transaction.get()` calls
      // from this point forward. Per FOL-03.

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
      //
      // Per MRB-15-03 (2026-08-03): the same
      // transaction also recomputes
      // `checkedInRoomCount` from every child's
      // status. Per FOL-03, the count reads from the
      // pre-computed `postUpdateChildStatuses` (the
      // pre-update read + the just-checked-in booking's
      // status replaced with `"checked-in"`) so the
      // `get()` happens BEFORE the writes. The
      // header's `activeRoomCount` /
      // `cancelledRoomCount` / `roomCount` are NOT
      // Per BAR-02 (2026-08-08, per decision #203):
      // `checkedInRoomCount` and `paymentStatus` are
      // no longer written to the reservation header on
      // check-in. Consumers derive them at read time.
      // The per-child status transition (the
      // `transaction.update` of the target booking +
      // any FOL-03 sibling pre-checked-in flip) is
      // unchanged — that is the real state mutation.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
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

      // Per FOL-03 (2026-08-07, per decision #199):
      // pre-compute the post-update child statuses
      // BEFORE the writes. Same read-before-writes
      // contract as `handleCheckinBooking` (per
      // FOL-03) — Firestore `runTransaction` requires
      // all `get()` calls to complete before any
      // `update()` / `set()` / `create()` calls.
      // The pre-update `get()` of the children lets us
      // know every child's current status; we then
      // REPLACE the current booking's status with
      // `"checked-out"` (the post-update value) so
      // the count + aggregate match the post-update
      // state. The pre-FOL-03 handler did the
      // childrenForCount `get()` AFTER the booking +
      // room + intercom updates — a Firestore
      // transaction violation that surfaces as a
      // 500 for any checkout with a `reservationId`.
      let postUpdateChildStatuses: string[] = [];
      if (bookingReservationId.length > 0) {
        const childrenForCount = await transaction.get(
          adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)
        );
        postUpdateChildStatuses = childrenForCount.docs.map((d: any) =>
          d.id === bookingId
            ? "checked-out" // post-update status for the just-checked-out booking
            : String(d.data()?.status || "")
        );
      }

      // ALL WRITES BELOW — no `transaction.get()` calls
      // from this point forward. Per FOL-03.

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
      //
      // Per MRB-15-03 (2026-08-03): the same
      // transaction also recomputes
      // `checkedInRoomCount` (decrement) +
      // `checkedOutRoomCount` (increment) from every
      // child's status. Per FOL-03, the counts read
      // from the pre-computed
      // `postUpdateChildStatuses` (the pre-update
      // read + the just-checked-out booking's status
      // replaced with `"checked-out"`) so the `get()`
      // happens BEFORE the writes. The header's
      // `activeRoomCount` / `cancelledRoomCount` /
      // `roomCount` are NOT touched here — those are
      // owned by the create / add-room / cancel paths
      // only (per the JSDoc on `Reservation` in
      // `shared/types/index.ts`). The
      // `paymentStatus` aggregate reads every
      // Per BAR-02 (2026-08-08, per decision #203):
      // `checkedInRoomCount` / `checkedOutRoomCount`
      // and `paymentStatus` are no longer written to
      // the reservation header on check-out. Consumers
      // derive them at read time. The per-child status
      // transition (the `transaction.update` of the
      // target booking + the FOL-03 sibling
      // pre-checked-in flip) is unchanged — that is
      // the real state mutation.
      if (bookingReservationId.length > 0) {
        const reservationRef = adminDb.collection("reservations").doc(bookingReservationId);
        transaction.update(reservationRef, {
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

  const { bookingRef: trimmedRef, guestEmail: normalizedEmail, token: lookupToken, reservationRef: trimmedReservationRef } = parsed.data;

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

    if (trimmedReservationRef) {
      // Per MRB-10 (2026-08-02, per decision #169) +
      // #209 (RFO-01, 2026-08-10): the direct
      // reservation-scope lookup. The MRB-09
      // reservation-scope emails carry a
      // `reservationRef` link so the guest can
      // deep-link straight to the reservation
      // without first landing on a per-child
      // booking.
      //
      // Three input shapes are accepted (priority
      // is most-specific-first, mirroring the
      // per-child dispatch above):
      //   R- + email   → email-second-factor gate
      //                   against `reservation.leadGuestEmail`
      //   R- + token   → token gate against the
      //                   first child's `lookupToken`
      //                   (the per-child magic link
      //                   path)
      //   R- alone     → no credential gate; the
      //                   defense is the same
      //                   Turnstile + 10/min/IP rate
      //                   limit + 3-failure 1-hour
      //                   backoff as the
      //                   `ref`-alone path
      //                   (`plan/docs/SECURITY.md
      //                   §Booking Lookup Security`).
      //                   The R- ref is the
      //                   reservation's public
      //                   identifier (subject line,
      //                   body header, receipt PDF
      //                   filename) — the form copy
      //                   on `/my-booking` reads
      //                   "Enter your booking
      //                   reference or the email you
      //                   used to book", so the
      //                   guest expects the R- to
      //                   work without a second
      //                   factor. The 99,999-key
      //                   per-day namespace
      //                   (5-digit sequence per
      //                   `RESERVATION_REF_REGEX`)
      //                   has the same enumeration
      //                   risk as the SI- ref-alone
      //                   path; the same defenses
      //                   apply.
      const reservationSnap = await adminDb.collection("reservations")
        .where("reservationRef", "==", trimmedReservationRef)
        .limit(1)
        .get();
      if (reservationSnap.empty) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }
      const reservation = { id: reservationSnap.docs[0].id, ...reservationSnap.docs[0].data() };
      // Resolve the credential when one was
      // supplied. The reservation's `leadGuestEmail`
      // is the canonical email for the
      // email-second-factor path; the magic-link
      // path is per-child (the first child's
      // `lookupToken` is what the email footer
      // carries).
      if (normalizedEmail) {
        const leadEmail = String(reservation.leadGuestEmail || "").trim().toLowerCase();
        if (leadEmail !== normalizedEmail) {
          return res.status(404).json({ success: false, error: "Booking not found." });
        }
      } else if (lookupToken) {
        // The reservation's first child carries the
        // email footer's lookup token. Find it by
        // sorting the children by `reservationPosition`.
        const childrenSnap = await adminDb.collection("bookings")
          .where("reservationId", "==", reservation.id)
          .get();
        const sorted = childrenSnap.docs
          .map((doc: any) => ({ id: doc.id, ...doc.data() }))
          .sort((a: any, b: any) => Number(a.reservationPosition || 0) - Number(b.reservationPosition || 0));
        const match = sorted.find((c: any) => String(c.lookupToken || "").toLowerCase() === String(lookupToken).toLowerCase());
        if (!match) {
          return res.status(404).json({ success: false, error: "Booking not found." });
        }
        // Fall through to enrichAndRespond with the
        // matched child so the existing single-booking
        // paths can detect the reservationId + return
        // the reservation view.
        return await enrichAndRespond(res, { id: match.id, ...match });
      }
      // R- alone (no credential) OR credential
      // matched. Find the first child by
      // `reservationPosition` and hand to
      // `enrichAndRespond` which detects the
      // `reservationId` and returns the
      // reservation view (N>1 → `kind:
      // "reservation"`; N=1 → `kind: "single"`,
      // byte-equivalent to the per-child view).
      const firstChildSnap = await adminDb.collection("bookings")
        .where("reservationId", "==", reservation.id)
        .orderBy("reservationPosition", "asc")
        .limit(1)
        .get();
      if (firstChildSnap.empty) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }
      const firstChild = { id: firstChildSnap.docs[0].id, ...firstChildSnap.docs[0].data() };
      return await enrichAndRespond(res, firstChild);
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

  // Per MRB-10 (2026-08-02, per decision #169): the
  // reservation-scope lookup. When the looked-up
  // booking has a `reservationId` AND the reservation
  // has N>1 children (i.e. `reservationRoomCount > 1`),
  // the page renders a single card with every room
  // nested inside. N=1 falls through to the legacy
  // `kind: "single"` path (the reservation view is
  // byte-equivalent to the per-child view for N=1).
  // Legacy pre-MRB-01 bookings (no `reservationId`)
  // also fall through to `kind: "single"`.
  const reservationId = String(bookingData.reservationId || "").trim();
  if (reservationId) {
    const reservationRef = adminDb.collection("reservations").doc(reservationId);
    const reservationSnap = await reservationRef.get();
    if (reservationSnap.exists) {
      const reservation = { id: reservationId, ...reservationSnap.data() };
      const childrenSnap = await adminDb.collection("bookings")
        .where("reservationId", "==", reservationId)
        .get();
      const children = childrenSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      if (children.length > 1) {
        return res.status(200).json({
          success: true,
          data: buildReservationLookupView(reservation, children, roomData, bookingData)
        });
      }
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

// Per MRB-10 (2026-08-02, per decision #169): the
// reservation-scope lookup view. Mirrors the
// MRB-09 email view's privacy posture (no `guestName`,
// `maskedEmail` instead of `guestEmail`) + the
// per-room projection shape (position + ref + type +
// occupancy + per-stay total). The view is what the
// `/my-booking` page renders when a looked-up booking
// has a `reservationId` AND the reservation has N>1
// children. Cancel + resend act on the reservation
// (the server resolves the first child for the
// credential, then `scope: "reservation"` for the
// cancel — per MRB-13).
function buildReservationLookupView(reservation: any, children: any[], anchorRoomData: any | null, anchorBooking: any) {
  // Sort the children by `reservationPosition`
  // (1..N) so the page renders them in the same
  // order they were created. Children without a
  // `reservationPosition` (legacy) fall to the end
  // and keep their natural order.
  const sortedChildren = [...children].sort((a: any, b: any) => {
    const ap = Number(a.reservationPosition || 0);
    const bp = Number(b.reservationPosition || 0);
    return ap - bp;
  });
  // For each child, fetch the room data so the page
  // can show the friendly room name. The reads run
  // in parallel — the per-room fetches are independent.
  // (The `anchorRoomData` is the first room's data,
  // already fetched by `enrichAndRespond` — reuse
  // it for the first child to skip one round trip.)
  const rooms = sortedChildren.map((child: any, index: number) => {
    // The room data isn't fetched here — the page
    // falls back to `roomType` when `roomName` is
    // missing (matches the legacy `roomName` /
    // `roomType` fallback in the single-booking
    // card). The anchor child reuses the already-
    // fetched room data; other children surface
    // only their type until the page deep-links
    // into a specific child (MRB-15 follow-up).
    const childRoomData = index === 0 ? anchorRoomData : null;
    return {
      id: child.id,
      position: child.reservationPosition || index + 1,
      bookingRef: child.bookingRef,
      maskedEmail: maskEmail(String(child.guestEmail || "")),
      roomId: child.roomId,
      roomName: childRoomData?.name || child.roomType || "",
      roomNumber: child.roomNumber || "",
      roomType: child.roomType,
      checkIn: child.checkIn,
      checkOut: child.checkOut,
      numNights: Number(child.numNights || 0),
      numGuests: Number(child.numGuests || 0),
      numAdults: Number(child.numAdults || 0),
      numChildren: Number(child.numChildren || 0),
      extraBedCount: Number(child.extraBedCount || 0),
      hasBreakfast: Boolean(child.hasBreakfast),
      ratePerNight: Number(child.ratePerNight || 0),
      totalPrice: Number(child.totalPrice || 0),
      status: child.status,
      // Per-child rate breakdown (snapshotted at
      // create time per MRB-04) for the receipt
      // PDF and the receipt card. The page renders
      // the per-stay lines when the guest expands
      // a row.
      rateBreakdown: child.rateBreakdown || null
    };
  });
  return {
    kind: "reservation",
    // The reservation header fields the page reads
    // to render the card (reservation ref + dates +
    // aggregate total + payment status). The legacy
    // `id` field is the reservation doc id (NOT a
    // booking id) so the cancel + resend paths can
    // pass it to the server without confusing it
    // with a single-booking id.
    id: reservation.id,
    reservationRef: reservation.reservationRef,
    maskedEmail: maskEmail(String(anchorBooking.guestEmail || "")),
    guestPhone: anchorBooking.guestPhone,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    numNights: Number(reservation.numNights || 0),
    // Per MRB-04 (2026-08-02, per decision #159): the
    // reservation header is the source of truth for
    // the aggregate total. The per-room values are
    // the source of truth for the per-stay lines.
    // The page renders the aggregate + the per-stay
    // values for the receipt card.
    totalPrice: Number(reservation.totalPrice || 0),
    paymentMethod: reservation.paymentMethod,
    // Per MRB-04: the reservation header's
    // `paymentStatus` is the aggregate mirror. The
    // page renders the per-child status badges for
    // each room and the aggregate status for the
    // header.
    status: reservation.paymentStatus || "pending",
    // Per BAR-02 (2026-08-08, per decision #203): the
    // three counter fields are no longer read from the
    // reservation header. They are always derived from
    // the `rooms` array (already in memory at this
    // point). Pre-BAR-02 the header mirror was
    // maintained transactionally; the new code is
    // byte-equivalent for both pre- and post-BAR-02
    // reservations because the derivation is the same
    // calculation the pre-BAR-02 write performed.
    roomCount: rooms.length,
    activeRoomCount: Math.max(
      rooms.length - rooms.filter((r) => r.status === "cancelled").length,
      0
    ),
    cancelledRoomCount: rooms.filter((r) => r.status === "cancelled").length,
    rooms,
    // The "active room" data is what the cancel +
    // resend flows use as the server credential. The
    // server resolves the reservation from the
    // booking, so any child's `bookingId` + `ref` is
    // valid; we use the first child for consistency
    // with the legacy single-booking card.
    primaryBookingId: anchorBooking.id,
    primaryBookingRef: anchorBooking.bookingRef
  };
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
      // Per EXB-12 (2026-08-06, per decision #199): the
      // reschedule must pass the snapshotted
      // `extraBedCount` + `extraBedBreakfast` to the helper
      // so the recomputed `breakfastTotal` matches the
      // create-time total. Pre-v0.264.8 the reschedule
      // dropped these two fields, silently losing the
      // extra-bed breakfast charge on every reschedule
      // of a booking that opted in to breakfast for the
      // extra beds. `undefined` on legacy bookings
      // (pre-EXB-12) reads as `false` via the helper's
      // defensive coercion — back-compat with the
      // historical "no extra-bed breakfast" default.
      const preservedExtraBedBreakfast = booking.extraBedBreakfast === true;
      const breakfastTotal = manualNightlyRate === null
        ? calculateBreakfastAddOn({
            hasBreakfast: booking.hasBreakfast,
            breakfastRate,
            numGuests: booking.numGuests,
            numNights,
            breakfastIncludesChildren: booking.breakfastIncludesChildren,
            extraBedCount: preservedExtraBedCount,
            extraBedBreakfast: preservedExtraBedBreakfast
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
        // Per EXB-08 (2026-08-01, per decision #156):
        // the addOns array must include the "Extra bed
        // add-on" line on reschedule so the receipt PDF
        // + email + admin drawer surfaces render the
        // term. Pre-v0.264.8 the reschedule dropped these
        // three fields, leaving the addOns array with
        // only the breakfast line — the extra bed was
        // invisible on every downstream surface even
        // though the `extraBedTotal` was correctly
        // computed by `calculateExtraBedAddOn` two
        // blocks above. Same shape as the create +
        // walkin + add-room `buildRateBreakdown` calls.
        extraBedTotal,
        extraBedCount: preservedExtraBedCount,
        extraBedRate: preservedExtraBedRate,
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
        // Per MRB-11 (2026-08-03, per decision #177):
        // the rescheduled revenue allocation. The
        // per-stream values are the GROSS amounts for
        // the new dates; `deductionNet` includes the
        // chain's senior + voucher + member deductions
        // AND the snapshotted `pointsRedeemedValue`
        // (a separate deduction layer the chain does
        // not see — see `finalTotalPrice = totalPrice
        // - pointsRedeemedValue`). The invariant
        // `room + breakfast + addOn - deduction === finalTotalPrice`
        // holds by construction. Reschedule is the
        // only path that re-snapshots a `revenueAllocation`
        // because the dates (and therefore the gross
        // amounts) have changed.
        revenueAllocation: assertBookingRevenueAllocationInvariant(
          {
            roomNet: roomTotal,
            breakfastNet: breakfastTotal,
            addOnNet: extraBedTotal,
            deductionNet:
              rescheduleChain.seniorDeduction +
              rescheduleChain.voucherDeduction +
              rescheduleChain.memberDeduction +
              (Number(booking.pointsRedeemedValue) || 0),
            totalNet: finalTotalPrice
          },
          finalTotalPrice
        ),
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
        // Per MRB-14 (2026-08-03, per decision #180 —
        // proposed): the `actualDateRange` recompute. The
        // header's original `checkIn` / `checkOut` stay
        // immutable (the previous block of code no longer
        // updates them); we read every child via
        // `where("reservationId", "==", id)` inside the
        // transaction and pass their current dates to
        // `computeReservationActualDateRange`. The
        // just-rescheduled child is represented by its
        // NEW dates (the `updatedBooking` we just
        // built); every other child contributes its
        // current dates as-is. Pre-MRB-14 reservations
        // have no `actualDateRange` — for those the
        // helper falls through to writing
        // `isDivergent: true` + a fallback range when
        // the children's dates differ from the
        // header's (legacy stays byte-equivalent
        // because the admin surfaces + email continue
        // to read the children's per-child dates for
        // pre-MRB-14 rows).
        const rescheduleChildrenQuery = adminDb
          .collection("bookings")
          .where("reservationId", "==", bookingReservationId as string);
        const rescheduleChildrenSnap = await transaction.get(rescheduleChildrenQuery);
        const rescheduleChildrenDates = rescheduleChildrenSnap.docs.map((docSnap) => {
          const childData = docSnap.data() as any;
          if (docSnap.id === String(bookingId)) {
            // The just-rescheduled child — use the
            // new dates from `updatedBooking` (the
            // post-write state, not the pre-write
            // snapshot).
            return {
              checkIn: checkInDate,
              checkOut: checkOutDate
            };
          }
          return {
            checkIn: childData.checkIn,
            checkOut: childData.checkOut
          };
        });
        const rescheduleActualDateRange = computeReservationActualDateRange(
          existingReservationData.checkIn,
          existingReservationData.checkOut,
          rescheduleChildrenDates
        );
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
          // Per MRB-14 (2026-08-03, per decision #180
          // — proposed): the header's `checkIn` /
          // `checkOut` / `numNights` are the ORIGINAL
          // shared-dates snapshot from create time
          // and are now IMMUTABLE. A reschedule of
          // one child no longer mutates the header's
          // "shared" range — every other surface
          // (email subject, receipt PDF, dashboard
          // date filter, checkin reminder cron)
          // reads the header's original dates, not
          // the rescheduled child's new dates. The
          // child's new dates are its own
          // `bookings/{id}.checkIn` / `checkOut` /
          // `numNights`. The header's
          // `actualDateRange` (denormalized) tracks
          // the per-child spread + an `isDivergent`
          // flag for the UI + email surface to switch
          // between "one shared range" and "per-child
          // dates" without re-fetching the children.
          // (Removed lines: `checkIn`,
          // `checkOut`, `numNights` — pre-MRB-14 the
          // reschedule updated them to the new
          // child's dates, which silently leaked the
          // rescheduled child's range into every
          // other surface's "shared" view.)
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
          // Per MRB-11 (2026-08-03, per decision #177):
          // the reschedule's per-stream aggregate. For
          // the single-room reschedule (the current
          // scope of the handler — the reschedule
          // path is per-child, not per-reservation),
          // the aggregate equals the per-child
          // allocation. The N>1 case is a pre-existing
          // limitation: the aggregate (and the
          // reservation `totalPrice`) is stale for a
          // multi-child reschedule; Reports falls
          // back to summing children via
          // `getReservationRevenueStreams(reservation, children)`,
          // which is always correct.
          aggregateRevenueAllocation: updatedBooking.revenueAllocation,
          // The fingerprint is INTENTIONALLY allowed
          // to change on reschedule — the reschedule
          // IS the legitimate request to change the
          // fingerprint (the dates + room changed).
          // Replaying the same `reservationId` with a
          // different fingerprint is the natural
          // reschedule flow, not a conflict.
          requestFingerprint: rescheduleFingerprint,
          // Per MRB-14 (2026-08-03, per decision #180
          // — proposed): the recomputed
          // `actualDateRange`. Built by the helper
          // above from every child's post-write
          // dates. `isDivergent: true` ⇔ the
          // just-rescheduled child (or any other
          // child) now has dates that differ from
          // the header's original. The admin surface
          // + email switch to per-child dates when
          // this flag flips. Null when the helper
          // returned null (no children, which is a
          // never-true invariant — the transaction
          // never lands with 0 children).
          actualDateRange: rescheduleActualDateRange,
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

// Per MRB-14 (2026-08-03, per decision #180 — proposed):
// the add-room surface. Staff adds a room to an existing
// pre-arrival reservation using the header's current
// dates — the dates are NEVER in the body (the server
// reads them from the header). The new child is created
// with the same `reservationId` / `reservationRef` as the
// existing children; the public ref for the new room is
// a fresh `SI-YYYYMMDD-NNN`. The header is updated in the
// same transaction: `roomCount += 1`,
// `activeRoomCount += 1`, the totals + aggregate allocation
// + `actualDateRange` (recomputed, but `isDivergent` stays
// `false` because the new child shares the header's
// dates). Corporate `usageCount` increments by 1 if the
// reservation is corporate; voucher `usageCount` increments
// by 1 if a `voucherCode` is applied to the new child
// (per MRB-08's "N rooms = N uses" rule for the corporate
// path + the per-child voucher rule). One
// `booking-rescheduled` email fires after the commit (the
// reservation-scope view carries the new room).
export async function handleAddRoomToReservation(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  const parsedAddRoom = AddRoomBookingSchema.safeParse(req.body || {});
  if (!parsedAddRoom.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the add-room details — a required field is missing or invalid."
    });
  }
  const {
    reservationId,
    roomId,
    numAdults,
    numChildren,
    extraBedCount,
    discountType: requestedDiscountType,
    voucherCode: requestedVoucherCode,
    totalPriceOverride
  } = parsedAddRoom.data;

  try {
    let newBookingId: string | null = null;
    let newBookingRef: string | null = null;
    let updatedHeader: any = null;
    let fullBookingForEmail: any = null;

    await adminDb.runTransaction(async (transaction) => {
      // 1. Read the reservation header. The header
      // carries the dates the new child inherits (per
      // MRB-14: the header's `checkIn` / `checkOut` are
      // the ORIGINAL shared-dates snapshot from create
      // time and are now IMMUTABLE — add-room does NOT
      // re-anchor the header's range).
      const reservationRef = adminDb.collection("reservations").doc(reservationId);
      const reservationSnap = await transaction.get(reservationRef);
      if (!reservationSnap.exists) {
        throw new Error("RESERVATION_NOT_FOUND");
      }
      const reservation = reservationSnap.data() || {};
      const headerCheckIn = toDateOrNull(reservation.checkIn);
      const headerCheckOut = toDateOrNull(reservation.checkOut);
      if (!headerCheckIn || !headerCheckOut) {
        throw new Error("Reservation header is missing dates.");
      }
      const headerNumNights = Number(reservation.numNights) || 0;
      if (headerNumNights < 1) {
        throw new Error("Reservation header has invalid numNights.");
      }
      const headerDateString = (() => {
        const y = headerCheckIn.getUTCFullYear();
        const m = String(headerCheckIn.getUTCMonth() + 1).padStart(2, "0");
        const d = String(headerCheckIn.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      })();
      const headerCheckOutString = (() => {
        const y = headerCheckOut.getUTCFullYear();
        const m = String(headerCheckOut.getUTCMonth() + 1).padStart(2, "0");
        const d = String(headerCheckOut.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      })();

      // 2. Read the target room. Validate availability
      // + the room type's capacity / extra-bed caps.
      const targetRoomRef = adminDb.collection("rooms").doc(roomId);
      const targetRoomSnap = await transaction.get(targetRoomRef);
      if (!targetRoomSnap.exists) {
        throw new Error("Target room not found.");
      }
      const targetRoom = targetRoomSnap.data() || {};
      if (targetRoom.isActive === false) {
        throw new Error("Target room is inactive.");
      }
      if (targetRoom.status === "blocked") {
        const blockedFrom = toDateOrNull(targetRoom.blockedFrom);
        const blockedTo = toDateOrNull(targetRoom.blockedTo);
        const windowActive = blockedFrom && blockedTo
          ? rangesOverlap(blockedFrom, blockedTo, headerCheckIn, headerCheckOut)
          : true;
        if (windowActive) {
          throw new Error("Target room is blocked for those dates.");
        }
      }
      // Per CHD-04 + EXB-01: the target room's type
      // caps + the requested occupancy. Same
      // `requiredExtraBedsFor` math the walkin handler
      // uses.
      const targetRoomType = String(targetRoom.type || "").trim();
      if (!targetRoomType) {
        throw new Error("Target room is missing a type.");
      }
      const requiredExtraBeds = requiredExtraBedsFor({
        numAdults,
        numChildren,
        maxCapacity: Number(targetRoom.maxCapacity) || 0,
        maxChildren: Number(targetRoom.maxChildren) || 0
      });
      if (requiredExtraBeds.requiredExtraBeds > extraBedCount) {
        throw new Error(
          `Target room needs ${requiredExtraBeds.requiredExtraBeds} extra bed(s) for ${numAdults} adult(s) + ${numChildren} child(ren), but only ${extraBedCount} provided.`
        );
      }
      if (Number(targetRoom.maxExtraBeds) >= 0 && extraBedCount > Number(targetRoom.maxExtraBeds)) {
        throw new Error(`Target room allows at most ${targetRoom.maxExtraBeds} extra bed(s).`);
      }

      // 3. Read the existing children. Per MRB-07: the
      // new child's `reservationPosition` is the next
      // consecutive integer. Per the filter-scope
      // contract: a child whose `checkIn` / `checkOut`
      // matches the header is `isDivergent: false`;
      // add-room always matches the header so the
      // recomputed `actualDateRange` stays
      // `isDivergent: false`. Per sibling-claim guard:
      // the new roomId must NOT be claimed by another
      // child in the same reservation.
      const existingChildrenQuery = adminDb
        .collection("bookings")
        .where("reservationId", "==", reservationId);
      const existingChildrenSnap = await transaction.get(existingChildrenQuery);
      const existingChildren = existingChildrenSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data() || {}
      }));
      const siblingClaimedRoom = existingChildren.find(
        (child) => String(child.data.roomId || "") === String(roomId)
      );
      if (siblingClaimedRoom) {
        throw new Error("Target room is already claimed by another stay in this reservation.");
      }
      // Pre-arrival guard: the reservation has at
      // least one child in a non-pre-arrival state
      // (`checked-in` or `cancelled`) ⇒ reject. The
      // add-room surface is pre-arrival only — the
      // in-stay path is the reschedule handler. The
      // `RESCHEDULABLE_STATUSES` set is the pre-arrival
      // + `checked-in` set per the existing reschedule
      // contract; we tighten it to "no checked-in or
      // cancelled children anywhere in the
      // reservation" by inspecting the children's
      // statuses (the header's `activeRoomCount` is
      // the canonical counter — `activeRoomCount ===
      // roomCount` is the "all pre-arrival" invariant).
      const cancelledCount = existingChildren.filter(
        (child) => String(child.data.status || "") === "cancelled"
      ).length;
      const checkedInCount = existingChildren.filter(
        (child) => String(child.data.status || "") === "checked-in"
      ).length;
      if (cancelledCount > 0) {
        throw new Error("Reservation has cancelled rooms — staff must clear those before adding a new room.");
      }
      if (checkedInCount > 0) {
        throw new Error("Reservation has a checked-in room — the in-stay reschedule path applies to date changes for an existing room.");
      }
      // The new child's `reservationPosition` is the
      // current max + 1. The header's existing
      // children carry the sequence (the create
      // path writes them as 1..N); the new child
      // is N+1.
      const maxPosition = existingChildren.reduce(
        (max, child) => Math.max(max, Number(child.data.reservationPosition) || 0),
        0
      );
      const newPosition = maxPosition + 1;

      // 4. Read hotel config (for the rate lookup +
      // payment hold window) + the room-type entry.
      const hotelConfigDoc = await transaction.get(adminDb.collection("settings").doc("hotelConfig"));
      const hotelConfig = hotelConfigDoc.exists ? hotelConfigDoc.data() || {} : {};
      const roomTypesConfig: any[] = Array.isArray((hotelConfig as any).roomTypes)
        ? (hotelConfig as any).roomTypes
        : DEFAULT_ROOM_TYPES;
      const targetTypeEntry = roomTypesConfig.find(
        (entry: any) => String(entry.value) === targetRoomType
      );
      if (!targetTypeEntry) {
        throw new Error("Target room type is not configured.");
      }
      const typeBaseRate = Number(targetTypeEntry.pricePerNight) || 0;
      const typeWeekendRate = Number(targetTypeEntry.weekendRate) || typeBaseRate;

      // Per EXB-10 (2026-08-01, per decision #157): the
      // hotel-wide rollaway-bed inventory check. Same
      // shape as the create / walkin / reschedule paths.
      // The candidate query reads every `ROOM_OCCUPYING_STATUSES`
      // booking with `extraBedCount > 0` (the in-memory
      // date-overlap filter is in the helper) and the
      // in-use sum includes the reservation's existing
      // children (they're already in the bookings
      // collection, their beds are already consumed, and
      // the new child shares the header's dates so the
      // overlap is automatic). The new child is NOT yet
      // a doc — it's being created in this transaction
      // — so no `excludeBookingId` is needed. `0
      // inventory` short-circuits to `ok: true` so the
      // historical "any number" behavior is preserved
      // when the field is absent (legacy / freshly
      // bootstrapped projects). Pre-v0.264.8 the
      // add-room path silently skipped this check —
      // the desk could add a room with extra beds that
      // exceeded the hotel's rollaway inventory.
      if (extraBedCount > 0) {
        const addRoomExtraBedOverlapQuery = adminDb.collection("bookings")
          .where("status", "in", ROOM_OCCUPYING_STATUSES);
        const addRoomExtraBedOverlapSnapshot = await transaction.get(addRoomExtraBedOverlapQuery);
        const addRoomExtraBedInUse = countExtraBedsInUse(
          addRoomExtraBedOverlapSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
          headerCheckIn,
          headerCheckOut
        );
        const addRoomInventoryResult = checkExtraBedInventory(
          Math.max(0, Number(hotelConfig.extraBedInventory) || 0),
          addRoomExtraBedInUse,
          extraBedCount
        );
        if (!addRoomInventoryResult.ok) {
          throw new Error(
            `Not enough extra beds: ${addRoomExtraBedInUse} already booked across overlapping stays + ${extraBedCount} requested = ${addRoomExtraBedInUse + extraBedCount}, but the hotel only has ${hotelConfig.extraBedInventory} rollaway bed(s) in inventory.`
          );
        }
      }

      // 5. Compute the per-line pricing for the new
      // child. Per MRB-08: corporate rates apply at
      // the room-type level (the negotiated rate or
      // the standard `corporateRate` fallback). Per
      // the public create + walkin surfaces.
      const isCorporateReservation = Boolean(reservation.isCorporate);
      const corporateCode = String(reservation.corporateCode || "").trim().toUpperCase();
      const perRoomTypeCorporateRate = (() => {
        if (!isCorporateReservation) return 0;
        const negotiatedRate = corporateCode && Array.isArray((targetTypeEntry as any).corporateRateByCode)
          ? Number((targetTypeEntry as any).corporateRateByCode[corporateCode]) || 0
          : 0;
        return negotiatedRate > 0
          ? negotiatedRate
          : Number(targetTypeEntry.corporateRate) || 0;
      })();
      const activeBaseRate = perRoomTypeCorporateRate > 0
        ? perRoomTypeCorporateRate
        : typeBaseRate;
      const activeWeekendRate = perRoomTypeCorporateRate > 0
        ? perRoomTypeCorporateRate
        : typeWeekendRate;

      // Per H-01 (corporate booking audit 2026-08-10):
      // the previous add-room path derived the corporate
      // code's `usageCount` delta from the reservation
      // header's `corporateUsageCount` — a field that
      // does not exist on the reservation doc. The real
      // counter lives on `corporateCodes/{code}`. The
      // buggy shape silently wrote `usageCount: 1` to
      // the corporateCodes doc on every add-room,
      // resetting the real counter and breaking the
      // cap check on the create path. The fix reads
      // the corporateCodes doc HERE (before the writes
      // begin at step 9, per FOL-03's reads-before-
      // writes rule) and stashes the snapshot for the
      // deferred `corporateUsageUpdate` write below.
      let corporateCodeDocForUpdate: any = null;
      if (isCorporateReservation && corporateCode) {
        const corpRef = adminDb.collection("corporateCodes").doc(corporateCode);
        corporateCodeDocForUpdate = await transaction.get(corpRef);
      }

      const seasonalRateOverrides = normalizeSeasonalRateOverrides((hotelConfig as any).seasonalRateOverrides || []);
      const roomBreakdown = calculateSeasonalAwareRoomBreakdown({
        checkIn: headerCheckIn,
        checkOut: headerCheckOut,
        roomType: targetRoomType,
        baseRate: activeBaseRate,
        weekendRate: activeWeekendRate,
        seasonalRateOverrides
      });
      const roomTotal = roomBreakdown.roomSubtotal;

      // Per CHD-10 + EXB-01: breakfast + extra-bed
      // totals follow the same rules as create /
      // walkin. The new child's `hasBreakfast` is
      // snapshotted from the header's
      // `mealPreference` (the reservation-level
      // default — the new room inherits the
      // guest's existing breakfast choice; the
      // per-room override is out of scope for
      // MRB-14 v1).
      const breakfastConfigDoc = await transaction.get(adminDb.collection("settings").doc("breakfastConfig"));
      const breakfastConfig = breakfastConfigDoc.exists ? breakfastConfigDoc.data() || {} : {};
      const breakfastRate = Number((breakfastConfig as any).ratePerPersonPerNight) || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT;
      const hasBreakfast = Boolean((reservation as any).hasBreakfast ?? false);
      const breakfastIncludesChildren = (reservation as any).breakfastIncludesChildren ?? true;
      const breakfastTotal = hasBreakfast
        ? calculateBreakfastAddOn({
            hasBreakfast: true,
            breakfastRate,
            numGuests: numAdults + numChildren,
            numNights: headerNumNights,
            breakfastIncludesChildren
          })
        : 0;
      const extraBedRate = Number(targetTypeEntry.extraBedRate) || 0;
      const extraBedTotal = extraBedCount > 0
        ? extraBedCount * extraBedRate * headerNumNights
        : 0;
      const subtotal = roomTotal + breakfastTotal + extraBedTotal;

      // 6. Apply the discount chain. Per DSC-01..05 +
      // CVQ-06: the chain routes through the shared
      // `calculateDiscountChain` helper. Per-child
      // senior + voucher; the corporate code is the
      // reservation-level path (it already
      // discounted the per-room rate via the
      // `perRoomTypeCorporateRate` selection above).
      const discountType = requestedDiscountType || "";
      const discountPct = discountType === "senior" || discountType === "pwd" ? 20 : 0;
      const seniorPwdDiscount = Math.round(
        calculatePercentDiscount(subtotal, discountPct)
      );
      const afterSeniorPwd = subtotal - seniorPwdDiscount;
      const voucherBase = calculateVoucherBase(subtotal, seniorPwdDiscount);

      let voucherDiscount = 0;
      let voucherUsageUpdate: { ref: any; data: any } | null = null;
      const formattedVoucherCode = String(requestedVoucherCode || "").trim().toUpperCase();
      if (formattedVoucherCode) {
        const voucherRef = adminDb.collection("vouchers").doc(formattedVoucherCode);
        const voucherDoc = await transaction.get(voucherRef);
        if (!voucherDoc.exists) {
          throw new Error("Voucher not found.");
        }
        const vData = voucherDoc.data() || {};
        if (!vData.isActive) {
          throw new Error("Voucher is inactive.");
        }
        // Per MRB-09: a percentage voucher applies
        // once per eligible line. A flat voucher
        // applies once per reservation (capped at the
        // remaining subtotal). For add-room v1, a
        // voucher applied to the new child is treated
        // as a per-line flat-equivalent (a single
        // share of the flat value, since the new
        // child is a single line). Per-child
        // percentage vouchers apply to the new
        // child's eligible subtotal.
        if (vData.discountType === "percent") {
          const applicable = (vData.applicableRoomTypes?.length ?? 0) === 0
            || (vData.applicableRoomTypes || []).includes(targetRoomType);
          if (!applicable) {
            throw new Error("Voucher is not applicable to the target room type.");
          }
          voucherDiscount = Math.round(
            calculateVoucherDiscount({
              discountType: "percent",
              discountValue: Number(vData.discountValue) || 0
            }, voucherBase)
          );
        } else {
          // Flat voucher: per MRB-09 the voucher
          // applies once per reservation. If the
          // header already had the same voucher
          // applied, this is a second application
          // (the new child is a new line). For
          // MRB-14 v1 the desk can apply a flat
          // voucher to the new child only by
          // re-submitting the original code; we
          // accept a single share (the full flat
          // value) here for the new child. The
          // per-child share is the simpler v1
          // contract — a future MRB-14.1 can
          // distribute across children.
          voucherDiscount = Math.min(
            Math.round(calculateVoucherDiscount({
              discountType: "flat",
              discountValue: Number(vData.discountValue) || 0
            }, voucherBase)),
            afterSeniorPwd
          );
        }
        const capOk = vData.usageCap == null
          || Number(vData.usageCount || 0) + 1 <= Number(vData.usageCap);
        if (!capOk) {
          throw new Error("Voucher is at its usage cap.");
        }
        voucherUsageUpdate = {
          ref: voucherRef,
          data: { usageCount: Number(vData.usageCount || 0) + 1, updatedAt: new Date() }
        };
      }

      // 7. The optional `totalPriceOverride` (manual
      // front-desk rate). When present, the new
      // child's `subtotal` is overridden; the
      // `deductionNet` collapses to 0 (manual rate
      // means no senior/voucher chain — the
      // override IS the total).
      const hasManualOverride = totalPriceOverride !== undefined && totalPriceOverride !== null;
      const manualSubtotal = hasManualOverride ? Math.round(Number(totalPriceOverride)) : 0;
      const finalSubtotal = hasManualOverride ? manualSubtotal : subtotal;
      const finalVoucherDiscount = hasManualOverride ? 0 : voucherDiscount;
      const finalSeniorDiscount = hasManualOverride ? 0 : seniorPwdDiscount;
      const finalTotalPrice = Math.max(0, finalSubtotal - finalSeniorDiscount - finalVoucherDiscount);

      // 8. Per MRB-11 (2026-08-03, per decision #177):
      // the stored per-stream revenue allocation.
      // Per-stream values are GROSS (pre-deduction);
      // `deductionNet` is the single line for senior
      // + voucher deductions. The invariant
      // `room + breakfast + addOn - deduction === finalTotalPrice`
      // holds by construction.
      const newChildRevenueAllocation = assertBookingRevenueAllocationInvariant(
        {
          roomNet: hasManualOverride ? finalSubtotal : roomTotal,
          breakfastNet: hasManualOverride ? 0 : breakfastTotal,
          addOnNet: hasManualOverride ? 0 : extraBedTotal,
          deductionNet: hasManualOverride ? 0 : (seniorPwdDiscount + voucherDiscount),
          totalNet: finalTotalPrice
        },
        finalTotalPrice
      );

      // 9. Mint the booking ref. Per H3 (hardening
      // batch 2026-06-26): sequence width is 5
      // digits. Per MRB-06 Phase 2: every room stay
      // is its own booking with its own guest-facing
      // reference. The counter is per-day.
      const { todayStr: counterDay, todayCompact } = getManilaDateInfo();
      const counterRef = adminDb.collection("counters").doc(`bookings-${counterDay}`);
      const counterDoc = await transaction.get(counterRef);
      const nextSequence = counterDoc.exists ? (counterDoc.data()?.count || 0) + 1 : 1;
      transaction.set(counterRef, { count: nextSequence, updatedAt: new Date() }, { merge: true });
      const bookingId = parsedAddRoom.data.requestFingerprint
        ? `add-room-${reservationId}-${roomId}-${String(parsedAddRoom.data.requestFingerprint).slice(0, 16)}`
        : `add-room-${reservationId}-${roomId}-${nextSequence}-${Date.now()}`;
      const newBookingRefValue = generateBookingRef("SI", headerCheckIn, nextSequence);

      // 10. Compose the new booking doc. Mirrors the
      // per-child write in the create + walkin paths.
      const newBookingDoc = {
        id: bookingId,
        bookingRef: newBookingRefValue,
        reservationId,
        reservationRef: String(reservation.reservationRef || ""),
        reservationPosition: newPosition,
        reservationRoomCount: existingChildren.length + 1,
        roomId: String(roomId),
        roomNumber: String(targetRoom.roomNumber || ""),
        roomType: targetRoomType,
        guestName: String(reservation.leadGuestName || "").trim(),
        guestEmail: String(reservation.leadGuestEmail || "").trim().toLowerCase(),
        guestPhone: String(reservation.leadGuestPhone || "").trim(),
        numGuests: numAdults + numChildren,
        numAdults,
        numChildren,
        extraBedCount,
        extraBedRate,
        extraBedTotal,
        // Per CHD-10 (2026-07-31, per CVQ-01): the
        // snapshotted `breakfastIncludesChildren`
        // value the new child inherits from the
        // header (the per-room override is out of
        // scope for MRB-14 v1). `true` is the safe
        // default for legacy reservations that
        // pre-date the CHD-10 snapshot — matches the
        // historical "children pay the full rate"
        // math. The create + walkin paths write the
        // same field; the add-room path pre-v0.264.8
        // silently dropped it (silent data loss for
        // any future read site that checks
        // `booking.breakfastIncludesChildren === true`).
        breakfastIncludesChildren: Boolean((reservation as any).breakfastIncludesChildren ?? true),
        // Per EXB-12 (2026-08-06, per decision #199):
        // the snapshotted `extraBedBreakfast` toggle
        // the new child inherits. The current
        // add-room admin UI doesn't expose the
        // toggle yet (consistent with the walkin
        // admin surface per the EXB-12 spec — a
        // future UX work item), so the value is
        // `false` for every new child created via
        // add-room until the UI is updated. The
        // create + walkin paths write the same
        // field; the add-room path pre-v0.264.8
        // silently dropped it.
        extraBedBreakfast: false,
        checkIn: Timestamp.fromDate(headerCheckIn),
        checkOut: Timestamp.fromDate(headerCheckOut),
        numNights: headerNumNights,
        ratePerNight: headerNumNights > 0 ? Math.round((hasManualOverride ? finalSubtotal : roomTotal) / headerNumNights) : (hasManualOverride ? finalSubtotal : roomTotal),
        totalPrice: finalTotalPrice,
        originalTotalPrice: subtotal,
        discountType,
        discountPct,
        discountIdPhotoUrl: null,
        discountIdPhotoPath: null,
        discountVerified: Boolean(discountType),
        discountVerifiedBy: discountType ? (req.staff?.uid || "staff") : null,
        discountRejected: false,
        discountRejectedBy: null,
        discountRejectionReason: "",
        voucherCode: formattedVoucherCode,
        voucherDiscount: finalVoucherDiscount,
        isCorporate: isCorporateReservation,
        corporateCode,
        companyName: String(reservation.companyName || "").trim(),
        specialRequests: "",
        status: "confirmed",
        paymentMethod: String(reservation.paymentMethod || "pay-at-hotel").trim(),
        paymentProofUrl: reservation.paymentProofUrl ?? null,
        paymentProofPath: reservation.paymentProofPath ?? null,
        lookupToken: generateLookupToken(),
        source: String(reservation.source || "online").trim(),
        notes: "Room added via staff add-room action.",
        memberId: reservation.memberId ?? null,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast,
        breakfastRate,
        breakfastTotal,
        reminderSentAt: null,
        guestIdPhotoUrl: null,
        handledBy: req.staff?.uid || "staff",
        cancellationReason: "",
        cancelledAt: null,
        cancelledBy: null,
        cancellationSource: null,
        cancellationLiability: null,
        createdAt: new Date(),
        breakfastSelections: {},
        breakfastServed: {},
        rateBreakdown: buildRateBreakdown({
          roomLines: roomBreakdown.roomLines,
          roomSubtotal: hasManualOverride ? finalSubtotal : roomTotal,
          breakfastTotal: hasManualOverride ? 0 : breakfastTotal,
          extraBedTotal: hasManualOverride ? 0 : extraBedTotal,
          extraBedCount,
          extraBedRate,
          discountType,
          discountPct,
          voucherDiscount: finalVoucherDiscount,
          memberDiscountPct: 0,
          finalTotal: finalTotalPrice
        }),
        revenueAllocation: newChildRevenueAllocation,
        holdExpiresAt: reservation.holdExpiresAt ?? null,
        updatedAt: new Date()
      };
      const newBookingRefDoc = adminDb.collection("bookings").doc(bookingId);
      transaction.set(newBookingRefDoc, newBookingDoc);
      newBookingId = bookingId;
      newBookingRef = newBookingRefValue;
      fullBookingForEmail = {
        ...newBookingDoc,
        id: bookingId,
        bookingId
      };

      // 11. Update the reservation header. Counters
      // + totals + aggregate allocation +
      // `actualDateRange` (recomputed, but
      // `isDivergent` stays `false` because the new
      // child shares the header's dates — the
      // recompute is still done because the children
      // set changed and the admin surfaces read
      // `actualDateRange.earliestCheckIn` /
      // `latestCheckOut` to render the dates).
      const newSubtotal = Number(reservation.subtotal || 0) + subtotal;
      const newTotalPrice = Number(reservation.totalPrice || 0) + finalTotalPrice;
      const newAggregateRevenueAllocation = (() => {
        const existingAlloc = (reservation as any).aggregateRevenueAllocation;
        if (!existingAlloc) {
          return newChildRevenueAllocation;
        }
        return assertBookingRevenueAllocationInvariant(
          {
            roomNet: Number(existingAlloc.roomNet || 0) + newChildRevenueAllocation.roomNet,
            breakfastNet: Number(existingAlloc.breakfastNet || 0) + newChildRevenueAllocation.breakfastNet,
            addOnNet: Number(existingAlloc.addOnNet || 0) + newChildRevenueAllocation.addOnNet,
            deductionNet: Number(existingAlloc.deductionNet || 0) + newChildRevenueAllocation.deductionNet,
            totalNet: Number(existingAlloc.totalNet || 0) + newChildRevenueAllocation.totalNet
          },
          Number(existingAlloc.totalNet || 0) + newChildRevenueAllocation.totalNet
        );
      })();
      const newChildrenDates = [
        ...existingChildren.map((child) => ({
          checkIn: child.data.checkIn,
          checkOut: child.data.checkOut
        })),
        { checkIn: headerCheckIn, checkOut: headerCheckOut }
      ];
      const newActualDateRange = computeReservationActualDateRange(
        headerCheckIn,
        headerCheckOut,
        newChildrenDates
      );
      // Per MRB-08: corporate `usageCount` is per
      // reservation, but the cap arithmetic counts
      // N rooms = N uses. Adding a room increments
      // by 1. Vouchers are per-child (the new
      // child's `voucherUsageUpdate` already
      // handled the increment above).
      //
      // Per H-01 (corporate booking audit 2026-08-10):
      // the corporateCodes doc snapshot was read earlier
      // in this transaction (step 5, before any writes,
      // per FOL-03). The increment reads from that
      // snapshot, NOT from the reservation header (which
      // has no `corporateUsageCount` field) — mirrors
      // the create-path pattern at `bookings.ts:2271-2277`
      // and the cancel-path pattern at
      // `bookings.ts:5788-5792`. If the corporateCodes
      // doc was deleted between create and now, we no-op
      // (mirror the cancel path's `cpDoc.exists` guard).
      const corporateUsageUpdate: { ref: any; data: any } | null = (() => {
        if (!isCorporateReservation || !corporateCode) return null;
        if (!corporateCodeDocForUpdate || !corporateCodeDocForUpdate.exists) return null;
        const corpData = corporateCodeDocForUpdate.data() || {};
        const corpRef = adminDb.collection("corporateCodes").doc(corporateCode);
        return {
          ref: corpRef,
          data: {
            usageCount: (Number(corpData.usageCount) || 0) + 1,
            updatedAt: new Date()
          }
        };
      })();
      // Per BAR-02 (2026-08-08, per decision #203):
      // `roomCount` and `activeRoomCount` are no
      // longer written to the reservation header on
      // add-room. Consumers derive them at read time.
      // The real denormalized header values
      // (`subtotal` / `totalPrice` /
      // `aggregateRevenueAllocation` /
      // `actualDateRange`) stay — those are not pure
      // projections.
      updatedHeader = {
        subtotal: newSubtotal,
        totalPrice: newTotalPrice,
        aggregateRevenueAllocation: newAggregateRevenueAllocation,
        actualDateRange: newActualDateRange,
        updatedAt: new Date()
      };
      transaction.update(reservationRef, updatedHeader);
      if (voucherUsageUpdate) {
        transaction.update(voucherUsageUpdate.ref, voucherUsageUpdate.data);
      }
      if (corporateUsageUpdate) {
        transaction.update(corporateUsageUpdate.ref, corporateUsageUpdate.data);
      }
    });

    // 12. Email — `booking-rescheduled` action fires
    // after the commit. The reservation-scope view
    // carries the new room; the subject reads
    // "Reservation updated: R-… (N rooms)" via the
    // existing template.
    if (fullBookingForEmail) {
      try {
        await sendBookingTrigger("booking-rescheduled", fullBookingForEmail);
      } catch (emailErr) {
        console.error("Failed to send add-room email:", emailErr);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        bookingId: newBookingId,
        bookingRef: newBookingRef,
        reservationId,
        reservationRef: updatedHeader?.reservationRef || null
      }
    });
  } catch (error: any) {
    if (error?.message === "RESERVATION_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Reservation not found." });
    }
    return res.status(400).json({ success: false, error: error?.message || "Failed to add room." });
  }
}
