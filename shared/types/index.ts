import type {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  HOUSEKEEPING_STATUSES,
  ROOM_STATUSES
} from "../constants";

export type RoomType = string;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type BookingSource = (typeof BOOKING_SOURCES)[number];
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
//     checkout (`/intercom/:roomId` Shop tab). Only effective when
//     `storeConfig.useBookingPaymentMethods === true`; when the
//     store uses its own 3 hardcoded methods (`cod`, `add-to-bill`,
//     `gcash`) this flag is ignored for those three but applies to
//     any other method that might leak in. Defaults to `true`.
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
}

// Per-method configuration for the in-room store ("Spark Essentials"
// for Spark Inn — display name is always `config.storeName`). The
// admin manages the 3 hardcoded methods (`cod`, `add-to-bill`,
// `gcash`) from Settings → Store when `useBookingPaymentMethods` is
// `false`. When that flag is `true`, the store inherits the enabled
// methods from the booking payment list (see
// `getEffectiveStorePaymentMethods` in
// `shared/utils/storePaymentMethods.ts`) — only the `cod` and
// `add-to-bill` labels remain admin-customizable. The `gcash` QR +
// account info come from the booking method's `qrUrl` /
// `accountName` / `accountNumber` when the toggle is on; the
// store-side `qrUrl` / `accountInfo` fields on the legacy
// `gcash` entry are ignored in that mode. The `method` key is a
// plain `string` to match the open-schema policy of
// `PaymentMethodConfig`; the helper enforces the 3-key policy at
// read time.
export interface StorePaymentMethodConfig {
  method: string;
  label: string;
  isEnabled: boolean;
  qrUrl?: string;
  accountInfo?: string;
}

// Runtime-editable configuration for the in-room store, stored at
// `settings/storeConfig`. Mirrors the Firestore document — the
// `useBookingPaymentMethods` flag is the new toggle that switches
// the store's payment-method source between the hardcoded list
// (default) and the dynamic booking payment list. See
// `plan/features/SETTINGS.md §11 Store` and
// `plan/features/STORE-MANAGEMENT.md §Catalog Management` for the
// full UX spec.
export interface StoreConfig {
  isEnabled: boolean;
  lowStockThreshold: number;
  paymentMethods: StorePaymentMethodConfig[];
  // When `true`, the store inherits the enabled methods from
  // `settings/hotelConfig.paymentMethods[]` (filtered to
  // `isEnabled === true`, excluding `pay-at-hotel` — that key
  // is for booking check-in, not in-room delivery; the store's
  // `add-to-bill` already covers the "I'll pay at checkout" case
  // for store orders). The 2 store-specific methods (`cod` +
  // `add-to-bill`) are always appended regardless of toggle, with
  // their labels read from `storeConfig.paymentMethods[]`. The
  // de-duped, source-tagged list is computed at read time by
  // `getEffectiveStorePaymentMethods` in
  // `shared/utils/storePaymentMethods.ts` — no denormalization,
  // no migration risk when toggling on/off. Default: `false`
  // (preserves the legacy 3-method UX exactly).
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
  originalTotalPrice: number | null;
  discountType: DiscountType;
  discountPct: number;
  discountIdPhotoUrl: string | null;
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
  hasBreakfast: boolean;
  breakfastRate: number;
  reminderSentAt: string | null;
  guestIdPhotoUrl: string | null;
  handledBy: string;
  cancellationReason: string;
  createdAt: Date;
  updatedAt: Date;
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
}
