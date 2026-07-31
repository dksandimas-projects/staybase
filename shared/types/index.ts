import type {
  BOOKING_STATUSES,
  HOUSEKEEPING_STATUSES,
  ROOM_STATUSES
} from "../constants";

export type RoomType = string;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
// Per NBS-03 (2026-07-31): widened from the historical union
// ("online" | "walk-in" | "phone" | "facebook" | "corporate") to
// `string` so new configured entries (e.g. "agoda" per CVQ-08) flow
// through without a schema change. The `BOOKING_SOURCES` constant
// stays as the seed/default array. Server-side validation against the
// configured list (`settings/hotelConfig.bookingSources[]`) is the
// authoritative gate; the union is no longer the source of truth.
export type BookingSource = string;
export type DiscountType = "" | "senior" | "pwd";
export type PaymentMethod = "pay-at-hotel" | "gcash" | "paypal" | string;

// Per-method configuration for the dynamic booking payment list
// managed from Settings → Payment Methods. The admin can add, remove,
// reorder, enable/disable, and edit any method — including "Pay at
// Hotel" which is just another method (no separate global toggle).
// QR codes are uploaded to `assets/payment-methods/{method}/{fileName}`
// in Firebase Storage. The Zod schema lives in
// `shared/schemas/paymentMethod.ts`; derive the TS type from there
// for any new code, but keep this interface in sync — the two
// declarations are mirrored (TypeScript cannot `z.infer` across the
// shared/admin boundary without a workspace import).
//
// Per #111 (per-method surface toggles): each method owns three
// independent surface toggles so the admin can hide a method from
// one surface without removing it from the others:
//   - `isEnabled` — controls visibility on the **regular booking**
//     flow (`/book` Step 3). The original master toggle.
//   - `showInStore` — controls visibility on the **in-room store**
//     checkout (`/intercom/:roomId` Shop tab). Defaults to `true`
//     for legacy custom methods; built-in methods are normalized
//     by `AdminContext`.
//   - `showInCorporate` — controls visibility on the **corporate
//     booking** personal-pay selector. The company charge-back path
//     is unaffected (it doesn't show a method picker). Defaults
//     to `true`.
export interface PaymentMethodConfig {
  method: string;
  label: string;
  accountName: string;
  accountNumber: string;
  qrUrl: string;
  isEnabled: boolean;
  showInStore?: boolean;
  showInCorporate?: boolean;
  requireReferenceNumber?: boolean;
}

// Legacy per-method configuration for the in-room store. These
// fields may still exist on older `settings/storeConfig` documents,
// but new code uses `settings/hotelConfig.paymentMethods[]` plus
// each method's `showInStore` flag as the single source of truth.
export interface StorePaymentMethodConfig {
  method: string;
  label: string;
  isEnabled: boolean;
  qrUrl?: string;
  accountInfo?: string;
}

// Runtime-editable configuration for the in-room store, stored at
// `settings/storeConfig`. Payment methods are intentionally not
// configured here anymore; the store checkout reads
// `settings/hotelConfig.paymentMethods[]` and filters by
// `showInStore !== false`.
export interface StoreConfig {
  isEnabled: boolean;
  lowStockThreshold: number;
  // Legacy fields retained for old Firestore documents. The admin
  // UI no longer writes them and the guest/server checkout ignores
  // them.
  paymentMethods: StorePaymentMethodConfig[];
  useBookingPaymentMethods: boolean;
}

export interface Room {
  id: string;
  name: string;
  roomNumber: string;
  type: RoomType;
  isActive: boolean;
  status: RoomStatus;
  housekeepingStatus: HousekeepingStatus;
  blockReason: string;
  remarks: string;
  blockedFrom?: string | Date | null;
  blockedTo?: string | Date | null;
  qrToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

// `bedDefinition`, `description`, `amenities`, `maxCapacity`,
// `pricePerNight`, `weekendRate`, and `corporateRate` were moved off the
// Room document and onto the RoomType entry (see `RoomTypeEntry` in
// `shared/constants/index.ts`) across W3.6 and W3.7. All rooms of a
// type now share the same bed, description, amenities, occupancy cap,
// and rate matrix. The Rates tab is the canonical edit surface for
// the rate matrix; the Room Types section of Settings (with its new
// Edit modal as of W3.7) is the canonical edit surface for the rest.
// Consumers join the type by `Room.type` at read time via `useRoomTypes`
// + the `getRoomTypeImages` / `getRoomTypeRates` helpers.

export interface EarlyCheckInDetails {
  status: "requested" | "approved" | "declined";
  requestedTime: string;
  notes: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  staffNote: string | null;
  confirmedTime?: string | null;
}

export interface SeasonalRateOverride {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  rate: number;
  roomTypeValues: string[];
  isActive: boolean;
}

export type BookingRateLineSource = "regular" | "weekend" | "seasonal" | "corporate" | "manual";

export interface BookingRateLine {
  source: BookingRateLineSource;
  label: string;
  startDate: string;
  endDate: string;
  nights: number;
  nightlyRate: number;
  subtotal: number;
}

export interface BookingRateAdjustmentLine {
  label: string;
  amount: number;
}

export interface BookingRateBreakdown {
  roomSubtotal: number;
  roomLines: BookingRateLine[];
  addOns: BookingRateAdjustmentLine[];
  deductions: BookingRateAdjustmentLine[];
  finalTotal: number;
}

export interface RoomBlock {
  id: string;
  roomId: string;
  roomNumber: string;
  roomType: string;
  startDate: string;
  endDate: string;
  reason: string;
  notes: string;
  status: "active" | "cancelled";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export interface Booking {
  id: string;
  bookingRef: string;
  roomId: string;
  roomNumber: string;
  roomType: RoomType;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  numGuests: number;
  checkIn: Date;
  checkOut: Date;
  numNights: number;
  ratePerNight: number;
  totalPrice: number;
  rateBreakdown?: BookingRateBreakdown | null;
  /** Pre-discount room/add-on subtotal. New writers always set it; null is legacy-only. */
  originalTotalPrice: number | null;
  discountType: DiscountType;
  discountPct: number;
  memberDiscountPct?: number;
  discountIdPhotoUrl: string | null;
  /** Private Firebase Storage object path; staff resolves a short-lived signed URL. */
  discountIdPhotoPath?: string | null;
  discountVerified: boolean;
  discountVerifiedBy: string | null;
  discountRejected: boolean;
  discountRejectedBy: string | null;
  discountRejectionReason: string;
  voucherCode: string;
  voucherDiscount: number;
  isCorporate: boolean;
  corporateCode: string;
  companyName: string;
  specialRequests: string;
  status: BookingStatus;
  paymentMethod: PaymentMethod;
  // Per BF-45 (booking-flow audit 2026-06-26): the
  // canonical "no payment proof" value is `null` (not
  // `""`). Writes coalesce `""` to `null` so all read
  // sites can rely on `!!booking.paymentProofUrl` /
  // `paymentProofUrl === null` checks without a string
  // comparison.
  paymentProofUrl: string | null;
  /** Private Firebase Storage object path; staff resolves a short-lived signed URL. */
  paymentProofPath?: string | null;
  // Per Phase 12 — Dashboard Payment Rejection & Reference
  // Verification (2026-07-15): staff can reject a pending
  // payment proof from the dashboard, bouncing the
  // booking back to `pending` with a required reason.
  // The guest is emailed + sees the reason in the lookup
  // page. `paymentProofUrl` is intentionally **kept**
  // (not cleared) for audit trail — the re-upload flow
  // is guest-driven via the existing pending UI. The
  // payment reference number (e.g. GCash ref / bank
  // trace) lives on each entry in the
  // `bookings/{id}/payments/` ledger as `transactionReference`;
  // it is no longer carried on the booking itself.
  paymentRejectionReason?: string | null;
  paymentRejectedAt?: Date | null;
  paymentRejectedBy?: string | null;
  rescheduleHistory?: any[];
  // Per H2 (hardening batch 2026-06-26): 32-char hex
  // random token generated at booking-create time. The
  // email magic link carries `?ref={bookingRef}&token={
  // lookupToken}` instead of `?ref={...}&email={...}` so
  // PII (the guest's email) never appears in URLs /
  // browser history / Vercel access logs. The lookup +
  // cancel endpoints accept either `{ bookingRef,
  // guestEmail }` (legacy) or `{ bookingRef, token }`
  // (new). See `server/handlers/bookings.ts`.
  lookupToken: string;
  source: BookingSource;
  notes: string;
  memberId: string | null;
  pointsRedeemed: number;
  pointsRedeemedValue: number;
  pointsRedeemedBy: string | null;
  pointsRedeemedAt: Date | null;
  pointsAwarded?: number;
  pendingLoyaltyPoints?: number;
  loyaltyAwardStatus?: "pending-payment" | "awarded" | "ineligible";
  pointsAwardedAt?: Date | null;
  checkedOutWithBalance?: number;
  checkedOutFolioTotal?: number;
  checkedOutCollectedTotal?: number;
  earlyCheckoutOriginalCheckOut?: Date | null;
  // Per CWB (decision #122, 2026-07-23): staff can confirm a
  // `payment-uploaded` booking with a positive balance when the
  // outstanding amount will be collected at check-in. The four
  // fields below are stamped atomically by
  // `POST /api/bookings/confirm-with-balance`. All are nullable —
  // existing bookings have all four as `null` (no migration).
  // The balance-owed indicator renders only when
  // `confirmedWithBalance != null && getCurrentBalance() > 0`.
  /** Original charge-inclusive balance at the moment the booking was confirmed with money owed. Never rewritten. */
  confirmedWithBalance?: number | null;
  /** Required staff reason (≤500 chars) for confirming with an outstanding balance. */
  confirmedWithBalanceReason?: string | null;
  /** Server timestamp set by the confirm-with-balance transaction. */
  confirmedWithBalanceAt?: Date | null;
  /** Staff UID who approved the confirm-with-balance transition. */
  confirmedWithBalanceBy?: string | null;
  hasBreakfast: boolean;
  breakfastRate: number;
  /**
   * Per CHD-10 (2026-07-31, per CVQ-01): whether children are included
   * in the breakfast charge. Snapshotted from the admin default
   * (`settings/breakfastConfig.breakfastIncludesChildrenDefault`) at
   * booking time so a later policy change never rewrites an existing
   * bill. `undefined` on legacy bookings reads as `true` for back-compat
   * (the historical "children pay the full rate" default).
   */
  breakfastIncludesChildren?: boolean | null;
  breakfastSelections?: Record<string, string>;
  breakfastServed?: Record<string, boolean>;
  reminderSentAt: string | null;
  guestIdPhotoUrl: string | null;
  handledBy: string;
  cancellationReason: string;
  earlyCheckIn?: EarlyCheckInDetails | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IncidentalChargeCategory =
  | "late-checkout"
  | "early-checkin"
  | "extra-person"
  | "damage"
  | "laundry"
  | "other";

export interface IncidentalCharge {
  id: string;
  bookingId?: string;
  bookingRef?: string;
  roomNumber?: string;
  label: string;
  amount: number;
  category: IncidentalChargeCategory;
  note: string;
  addedBy: string;
  addedAt: Date;
  voidOf: string | null;
}

export interface PaymentEntry {
  id: string;
  type: "payment" | "refund";
  amount: number;
  method: string;
  note: string;
  /** Tender-specific identifier for this individual ledger entry
   *  (e.g. GCash ref, bank trace). This is the canonical payment
   *  reference for the booking — the previous top-level
   *  `Booking.paymentReferenceNumber` (guest-entered at booking
   *  time) was retired in 2026-07-24; the reference is now
   *  exclusively staff-populated on the relevant payment ledger
   *  entry (via Record Payment / Verify & Record Payment). Not
   *  set for cash or legacy entries. */
  transactionReference?: string | null;
  reason: string | null;
  approvedBy: string | null;
  recordedBy: string;
  recordedAt: Date;
}

export interface CorporateInvoice {
  id: string;
  companyName: string;
  bookingIds: string[];
  bookingRefs: string[];
  amount: number;
  status: "issued" | "paid";
  issuedAt: Date;
  issuedBy: string;
  paidAt: Date | null;
  paidBy: string | null;
}

export type IntercomSender = "guest" | "front-desk";

export interface IntercomMessage {
  id: string;
  text: string;
  sender: IntercomSender;
  guestName: string;
  timestamp: Date;
  isRead: boolean;
  isQuickRequest: boolean;
  isStoreOrder: boolean;
  orderRef?: string;
  isEarlyCheckInRequest?: boolean;
}

export interface IntercomThread {
  roomId: string;
  roomNumber: string;
  guestName: string;
  resolved: boolean;
  updatedAt: Date;
  resolvedAt?: Date | null;
  currentStayId?: string;
}

// Per Phase 12 — Notification Center (decision #120):
// persisted operational alerts for staff. One document per
// event, written **server-side via the Admin SDK** from the
// existing API routes (booking create / add-payment / confirm
// / check-in / check-out / store order placed) — guests never
// create these directly. Live-derived from the `intercoms`
// listener (B1) for chat alerts; the persisted collection
// only covers actionable operational events.
//
// `readBy` is a map keyed by staff UID; the absence of my UID
// = unread for me. The retention cron prunes docs older than
// 30 days so the collection doesn't grow unbounded on Blaze
// (the FLR-03 trap).
export type NotificationType =
  | "booking"
  | "payment"
  | "message"
  | "arrival"
  | "departure"
  | "store-order";

export type NotificationEntityType = "booking" | "storeOrder" | "intercom";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  entityType: NotificationEntityType;
  entityId: string;
  roomNumber: string | null;
  bookingRef: string | null;
  readBy: Record<string, Date | null>;
  createdBy: "system";
  createdAt: Date;
}

export type TestRunStatus = "active" | "closed" | "cleanup-in-progress" | "cleaned";

export interface TestRunManifest {
  bookings: number;
  storeOrders: number;
  affectedRooms: string[];
  affectedStockItems: string[];
}

export interface TestRunCleanupResult {
  bookingsDeleted: number;
  storeOrdersDeleted: number;
  failedItems: number;
}

export interface TestRun {
  id: string;
  name: string;
  environment: "staging" | "production";
  createdBy: string;
  createdByUid: string;
  createdAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  status: TestRunStatus;
  tokenHash: string;
  manifest?: TestRunManifest | null;
  cleanupResult?: TestRunCleanupResult | null;
}

