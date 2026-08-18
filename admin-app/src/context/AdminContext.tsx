import React, { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback, useMemo } from "react";
import {
  browserSessionPersistence,
  getIdTokenResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from "firebase/auth";
import {
  ACTIVE_BOOKING_STATUSES,
  BROAD_DISCOUNT_SCOPE,
  CreateRoomInput,
  DEFAULT_BOOKING_SOURCES,
  DEFAULT_CORPORATE_PERKS,
  DEFAULT_CORPORATE_PAGE_CONTENT,
  DEFAULT_ROOM_TYPES,
  MAX_PAYMENT_METHOD_QR_BYTES,
  MAX_ROOM_TYPE_PHOTOS,
  Notification,
  type NotificationType,
  PaymentMethodConfig,
  PROTECTED_BOOKING_SOURCES,
  PROTECTED_PAYMENT_METHODS,
  StoreConfig,
  bustPublicSiteContentCache,
  compressImageFile,
  // Per NBS-2026-08-08 (F1, booking-flow audit 2026-08-08):
  // the optional client-preallocated `reservationId` for
  // walk-in create requests. When the call site supplies
  // one, the server's transactional create replays the
  // original commit on a retry-after-uncertain-response
  // (same `reservationId` + same `requestFingerprint` →
  // idempotent replay; different `requestFingerprint` →
  // 409). When absent (the historical default), the server
  // auto-mints a UUIDv4 — same pattern as the public
  // `/api/bookings/create` path. Walk-in callers should
  // always preallocate so a double-click on Confirm
  // doesn't create a duplicate booking.
  generateReservationId,
  normalizeDiscountScope,
  normalizePaymentHoldWindowHours,
  normalizeSeasonalRateOverrides,
  DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT,
  type BookingRateBreakdown,
  type BookingSourceConfig,
  type DiscountScope,
  type ProtectedBookingSource,
  type ProtectedPaymentMethod,
  type Reservation,
  type RoomBlock,
  type RoomTypeEntry,
  type SeasonalRateOverride,
  type TestRun,
  type TestRunStatus
} from "@spark-inn/shared";
import config from "@config";
import { auth } from "../firebase/auth";
import { arrayUnion, collection, collectionGroup, deleteField, doc, getDocs, limit, onSnapshot, updateDoc, addDoc, deleteDoc, setDoc, Timestamp, serverTimestamp, orderBy, query, runTransaction, where } from "firebase/firestore";
import { deleteObject, getDownloadURL, listAll, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase/config";
import { notify } from "../components/Toast";
import { getApiBaseUrl } from "../utils/apiBaseUrl";
import { useAudioRouting, type AudioSurface } from "../hooks/useAudioRouting";
import { setSinkIdSafe } from "../utils/audioOutputDevices";
import { renderRingtoneWav } from "../utils/renderRingtoneWav";
import type { AudioRouting as AudioRoutingShape } from "@spark-inn/shared";

type StaffRole = "front-desk" | "admin";

const rtcConfiguration: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const privateStorageUrlCache = new Map<string, { url: string; refreshAfter: number }>();

async function resolvePrivateStorageUrl(path: string): Promise<string> {
  const cached = privateStorageUrlCache.get(path);
  if (cached && cached.refreshAfter > Date.now()) return cached.url;

  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return "";
    const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/storage/signed-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ path })
    });
    const result = await response.json();
    if (!response.ok || !result?.success || typeof result.data?.url !== "string") return "";

    privateStorageUrlCache.set(path, {
      url: result.data.url,
      refreshAfter: Date.now() + 50 * 60 * 1000
    });
    return result.data.url;
  } catch {
    return "";
  }
}

interface AdminUser {
  uid: string;
  email: string;
  role: StaffRole;
}

export interface StaffMember {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  nationality: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  disabledAt: string | null;
  createdBy: string;
  disabledBy: string;
}

// Interfaces aligning with plan/docs/TYPES.md
export interface Room {
  id: string;
  name: string;
  roomNumber: string;
  type: string;
  isActive: boolean;
  status: "available" | "occupied" | "blocked";
  housekeepingStatus: "clean" | "dirty" | "in-progress";
  blockReason: string;
  blockedFrom: string | null;
  blockedTo: string | null;
  remarks: string;
  qrToken: string;
  // `bedDefinition`, `description`, `amenities`, `maxCapacity`, and the
  // rate fields (`pricePerNight` / `weekendRate` / `corporateRate`) are
  // intentionally absent — they now live on the RoomType entry. See
  // `plan/features/RATE-MANAGEMENT.md §W3.6` and the W3.7 notes in
  // `plan/features/SETTINGS.md §Room Types`.
}

export interface OnsitePayment {
  id: string;
  type: "payment" | "refund";
  amount: number;
  method: string;
  note: string;
  transactionReference?: string | null;
  reason: string | null;
  approvedBy: string | null;
  recordedBy: string;
  recordedAt: string;
}

export type IncidentalChargeCategory = "late-checkout" | "early-checkin" | "extra-person" | "damage" | "laundry" | "other";

export interface IncidentalCharge {
  id: string;
  label: string;
  amount: number;
  category: IncidentalChargeCategory;
  note: string;
  addedBy: string;
  addedAt: string;
  voidOf: string | null;
  bookingId?: string | null;
  ledgerOwner?: "booking" | "reservation";
  ledgerOwnerId?: string;
}

export interface Booking {
  id: string;
  bookingRef: string;
  roomId: string;
  roomNumber: string;
  roomType: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  numGuests: number;
  // Per CHD-01 (2026-08-01, per decision #144) +
  // EXB-01 (per decision #147) + EXB-07 (per decision #155):
  // the admin-side Booking view carries the adult/child split
  // + the extra bed count, matching the shared `Booking`
  // type. `numGuests` is the persisted total; the split is
  // optional so legacy bookings without these fields still
  // read. The walk-in form (per EXB-07) populates all three
  // on the create payload; the new-booking drawer reads them
  // back for the occupancy display.
  numAdults?: number;
  numChildren?: number;
  extraBedCount?: number;
  checkIn: string;
  checkOut: string;
  numNights: number;
  ratePerNight: number;
  totalPrice: number;
  rateBreakdown?: BookingRateBreakdown | null;
  /** Pre-discount room/add-on subtotal. New writers always set it; null is legacy-only. */
  originalTotalPrice: number | null;
  discountType: string;
  discountPct: number;
  discountIdPhotoUrl: string | null;
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
  status: "pending" | "payment-uploaded" | "payment-confirmed" | "confirmed" | "checked-in" | "checked-out" | "cancelled";
  paymentMethod: string;
  // Per BF-45 (booking-flow audit 2026-06-26): canonical
  // "no payment proof" is `null` (not `""`).
  paymentProofUrl: string | null;
  paymentProofPath?: string | null;
  // Per H2 (hardening batch 2026-06-26): the email magic
  // link carries this token (not the raw email) in the
  // URL. See `shared/types/index.ts`.
  lookupToken: string;
  // Per NBS-03 (2026-07-31): widened from the historical union to
  // `string` so configured entries (e.g. "agoda" per CVQ-08) flow
  // through without a schema change. Mirrors the shared
  // `BookingSource` type — the duplicate inline definition is gone.
  source: string;
  notes: string;
  memberId: string | null;
  memberDiscountPct?: number;
  pointsRedeemed: number;
  pointsRedeemedValue: number;
  pointsRedeemedBy: string | null;
  pointsRedeemedAt: string | null;
  pointsAwarded?: number;
  pendingLoyaltyPoints?: number;
  loyaltyAwardStatus?: "pending-payment" | "awarded" | "ineligible";
  pointsAwardedAt?: string | null;
  checkedOutWithBalance?: number;
  checkedOutFolioTotal?: number;
  checkedOutCollectedTotal?: number;
  earlyCheckoutOriginalCheckOut?: string | null;
  // Per CWB (decision #122, 2026-07-23): four fields
  // stamped by `/api/bookings/confirm-with-balance` when
  // staff transition a `payment-uploaded` booking to
  // `confirmed` with a positive balance that will be
  // collected at check-in. Nullable; existing bookings
  // have all four as `null` (no migration).
  /** Original charge-inclusive balance at the moment the booking was confirmed with money owed. Never rewritten. */
  confirmedWithBalance?: number | null;
  /** Required staff reason (≤500 chars) for confirming with an outstanding balance. */
  confirmedWithBalanceReason?: string | null;
  /** Server timestamp set by the confirm-with-balance transaction. */
  confirmedWithBalanceAt?: string | null;
  /** Staff UID who approved the confirm-with-balance transition. */
  confirmedWithBalanceBy?: string | null;
  unpaidCheckoutReason?: string | null;
  unpaidCheckoutApprovedBy?: string | null;
  hasBreakfast: boolean;
  breakfastRate: number;
  // Per Phase 12 — Dashboard Payment Rejection & Reference
  // Verification (2026-07-15): stamped by the
  // `/api/bookings/reject-payment` handler.
  // The previous top-level `paymentReferenceNumber` was retired
  // 2026-07-24; the canonical reference now lives on each
  // payment ledger entry's `transactionReference` (see
  // `Booking.onsitePayments[]`).
  paymentRejectionReason?: string | null;
  paymentRejectedAt?: string | null;
  paymentRejectedBy?: string | null;
  // Per FOL-01 (2026-08-06, decision #197): the durable
  // "payment was verified" signal. ISO string (the
  // `parseDateTimeString` convention) — server writes a `Date`,
  // the admin mapper hydrates it to ISO. See the shared
  // `Booking.paymentConfirmedAt` doc for the full contract.
  // The shared `isPaymentVerified()` helper is the only
  // authoritative read; per-render `status === "payment-confirmed"`
  // checks are the bug this field fixes.
  paymentConfirmedAt?: string | null;
  rescheduleHistory?: any[];
  reminderSentAt: string | null;
  guestIdPhotoUrl: string | null;
  handledBy: string;
  cancellationReason: string;
  // Per CRL-02 (2026-08-02): mirror the shared `Booking.cancelledAt`
  // / `cancelledBy` / `cancellationSource` fields on the admin
  // view. Hydrated by the bookings mapper (see line 1281+).
  // Legacy null-`cancelledAt` bookings keep today's self-contained
  // behavior — pre-live TEST DATA is reset, not migrated. All
  // three are optional so the existing call sites that build a
  // `Booking` literal without them (walk-in / corporate
  // create flows) keep typing.
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancellationSource?: "guest" | "staff" | "system" | null;
  // Per CRL-07 (2026-08-03, per decision #173):
  // the durable refund-liability snapshot. Mirrors
  // `shared/types.Booking.cancellationLiability`.
  // The destructive cancel stamps this field on
  // the booking doc (per-child cancels) or on
  // the reservation header (reservation-scope
  // cancels — read separately via
  // `selectedReservationContext.cancellationLiability`).
  // Absence / `null` / `undefined` means "no
  // liability work to do" — typically because
  // `policyRefund === 0` or the booking was
  // cancelled before CRL-07 shipped.
  cancellationLiability?: import("@spark-inn/shared").CancellationLiability | null;
  // Per MRB-01 (2026-08-02, per decision #159): the reservation
  // header linkage. Mirror the shared `Booking.reservationId`
  // / `reservationRef` / `reservationPosition` /
  // `reservationRoomCount` so the admin view can render the
  // group ref / position badge on the bookings table. Legacy
  // null-`reservationId` bookings keep today's self-contained
  // behavior. MRB-02 now exposes `reservationId` +
  // `reservationRef` on the `/api/bookings/create` response
  // payload, so any code that hydrates fresh bookings from
  // create needs these fields on the local type. All four
  // are optional to match the shared type's `| null` shape
  // and keep existing literal builders typing.
  reservationId?: string | null;
  reservationRef?: string | null;
  reservationPosition?: number | null;
  reservationRoomCount?: number | null;
  createdAt: string;
  onsitePayments?: OnsitePayment[];
  guestRegistration?: {
    nationality: string;
    address: string;
    dateOfBirth: string;
    gender: string;
    // Per Decision #121 (2026-07-23): purpose of stay defaults to
    // "Leisure" at the front-desk form. Free-text `otherPurpose`
    // captures the actual reason when the staff picks "Other".
    purposeOfStay?: string;
    otherPurpose?: string;
    idType: string;
    idNumber: string;
    emergencyContact: string;
    vehiclePlate: string;
    signatureStatus: "pending" | "signed";
  };
  isTestData?: boolean;
  testRunId?: string | null;
  breakfastSelections?: Record<string, string>;
  breakfastServed?: Record<string, boolean>;
  earlyCheckIn?: {
    status: "requested" | "approved" | "declined";
    requestedTime: string;
    notes: string;
    requestedAt: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    staffNote: string | null;
  } | null;
}

export type { RoomBlock };

export interface PointsLog {
  id: string;
  type: "earn" | "redeem" | "manual" | "expire";
  points: number;
  description: string;
  reason: string;
  bookingId: string | null;
  by: string;
  at: string;
}

export interface Member {
  id: string;
  memberNumber: string;
  fullName: string;
  email: string;
  phone: string;
  photoUrl: string;
  authProvider: "google" | "email";
  isMember: boolean;
  memberSince: string;
  rewardsPoints: number;
  tier: "standard" | "silver" | "gold";
  isActive: boolean;
  pointsHistory: PointsLog[];
}

export interface Voucher {
  id: string;
  code: string;
  discountType: "percent" | "flat";
  discountValue: number;
  usageCap: number | null;
  usageCount: number;
  expiresAt: string | null;
  applicableRoomTypes: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  // Per W4.4 / decision #104: when a voucher is issued to a
  // specific guest, their email is captured here and the
  // voucher-issued email is fired (server-rendered, with the
  // code in a large monospace block).
  guestEmail: string | null;
}

export interface CorporateCode {
  code: string;
  companyName: string;
  ratePerRoomType: Record<string, number>;
  expiresAt: string | null;
  usageCap: number | null;
  usageCount: number;
  linkedInquiryId: string;
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

export interface InquiryNote {
  text: string;
  by: string;
  at: string;
}

export interface CorporateInquiry {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  numRooms: number;
  preferredDates: { from: string; to: string };
  specialRequirements: string;
  status: "new" | "contacted" | "negotiating" | "converted" | "declined";
  handler: string;
  notes: InquiryNote[];
  accessCodeId: string;
  createdAt: string;
}

export interface IntercomMessage {
  id: string;
  text: string;
  sender: "guest" | "front-desk";
  guestName: string;
  timestamp: string;
  isRead: boolean;
  isQuickRequest: boolean;
  isStoreOrder: boolean;
  orderRef?: string;
  isEarlyCheckInRequest?: boolean;
  currentStayId?: string;
}

export interface IntercomThread {
  roomId: string;
  roomNumber: string;
  guestName: string;
  resolved: boolean;
  updatedAt: string;
  currentStayId?: string;
}

export interface IncomingCall {
  roomId: string;
  guestName: string;
  status: "ringing" | "active" | "ended";
  offer?: RTCSessionDescriptionInit;
}

export interface StoreOrderItem {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface StoreItem {
  id: string;
  name: string;
  category: "drinks" | "snacks" | "toiletries" | "rentals" | "other";
  description: string;
  price: number;
  stock: number | null;
  imageUrl: string;
  isActive: boolean;
  createdAt: string;
}

type StoreItemInput = Omit<StoreItem, "id" | "createdAt"> & {
  imageFile?: File | null;
};

export interface StoreOrder {
  id: string;
  orderRef: string;
  roomId: string;
  roomNumber: string;
  bookingId: string | null;
  guestName: string;
  items: StoreOrderItem[];
  totalAmount: number;
  paymentMethod: "cod" | "add-to-bill" | "gcash";
  paymentProofUrl: string;
  paymentProofPath?: string;
  status: "placed" | "confirmed" | "out-for-delivery" | "delivered" | "cancelled";
  stockRestoredAt: string | null;
  stockDecrementedAt: string | null;
  deliveredAt: string | null;
  isBilled: boolean;
  billedAt: string | null;
  isTestData?: boolean;
  testRunId?: string | null;
  cancellationReason: string;
  handledBy: string;
  notes: string;
  createdAt: string;
}

export interface AdminContextType {
  // Authentication
  authLoading: boolean;
  dashboardLoading: boolean;
  roomsLoading: boolean;
  ratesLoading: boolean;
  settingsLoading: boolean;
  currentUser: AdminUser | null;
  sendPasswordReset: (email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;

  // Rooms
  rooms: Room[];
  toggleHousekeepingStatus: (roomId: string) => void | Promise<void>;
  updateRoomConfig: (roomId: string, updates: Partial<Room>) => void | Promise<void>;
  addRoomBlock: (roomId: string, dates: { from: string; to: string }, reason: string) => void | Promise<void>;
  createRoom: (input: CreateRoomInput) => Promise<{ success: boolean; error?: string; roomId?: string }>;
  deleteRoom: (roomId: string) => Promise<{ success: boolean; error?: string; blockedByActiveBookings?: number }>;
  hasActiveBookings: (roomId: string) => number;

  // Bookings
  bookings: Booking[];
  // Per MRB-12 (2026-08-03, per decision #179 — proposed):
  // reservation headers + the reservation-scope paid-amount
  // aggregate. Hydrated by the AdminContext listener so the
  // Bookings table row can render the reservation-scope
  // total + balance without re-summing the filtered in-memory
  // children.
  reservations: Reservation[];
  reservationPaidAmount: Record<string, number>;
  updateBookingStatus: (
    bookingId: string,
    status: Booking["status"],
    details?: Partial<Booking>,
    // Per MRB-13 (2026-08-02, per decision #166):
    // optional request options. The cancel flow
    // uses `options.scope` to forward the
    // reservation-scope selector to the server.
    // Other status transitions ignore the field.
    options?: { scope?: "room" | "reservation" }
  ) => void | Promise<void>;
  resolveEarlyCheckin: (bookingId: string, status: "approved" | "declined", staffNote?: string, confirmedTime?: string) => Promise<{ success: boolean; error?: string }>;
  rescheduleBooking: (input: { bookingId: string; roomId: string; checkIn: string; checkOut: string; reason?: string }) => Promise<{ success: boolean; error?: string; data?: Partial<Booking> }>;
  addOnsitePayment: (bookingId: string, paymentId: string, amount: number, method: string, note: string, transactionReference?: string) => Promise<{ success: boolean; error?: string }>;
  // Per fix/walkin-split-name (2026-07-25): the walk-in modal
  // mirrors the guest `/book` page and collects `firstName` +
  // `lastName` as separate fields. The server combines them
  // into `Booking.guestName` for storage (matches the guest
  // page's wire shape). No more split-on-space kludge on the
  // client — single-name guests, compound names, and
  // non-Western name orders all round-trip cleanly.
  addWalkinBooking: (
    input: Omit<Booking, "id" | "bookingRef" | "createdAt" | "guestName"> & {
      firstName: string;
      lastName: string;
      totalPriceOverride?: number;
      // Per MRB-07 (2026-08-02, per decision #159): the reservation's
      // room stays, when the desk booked more than one room.
      rooms?: Array<{
        roomId: string;
        numAdults: number;
        numChildren: number;
        extraBedCount: number;
      }>;
      // Per NBS-2026-08-08 (F1, booking-flow audit 2026-08-08):
      // the optional client-preallocated `bookingId` +
      // `reservationId`. See the implementation JSDoc for
      // the retry-after-uncertain-response contract.
      preallocatedBookingId?: string;
      preallocatedReservationId?: string;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  resendBookingEmail: (bookingId: string, action: string) => Promise<{ success: boolean; error?: string }>;
  // Per Phase 12 — Dashboard Payment Rejection & Reference
  // Verification (2026-07-15). Bounces a `payment-uploaded`
  // booking back to `pending` (room stays held), emails
  // the guest with the reason, and writes a `payment`
  // notification for the bell.
  verifyAndRecordPayment: (bookingId: string, paymentId: string, amount: number, method: string, transactionReference?: string, note?: string) => Promise<{ success: boolean; error?: string; siblingFlippedCount?: number }>;
  rejectPayment: (bookingId: string, reason: string) => Promise<{ success: boolean; error?: string; siblingRejectedCount?: number }>;
  // Per LOW-1 (reports audit 2026-08-10) + DECISIONS-FEATURES.md #99:
  // staff-toggled LOU (Letter of Undertaking) flag for
  // corporate chargeback bookings.
  setLouReceived: (bookingId: string, louReceived: boolean) => Promise<{ success: boolean; error?: string }>;
  // Per CWB (decision #122, 2026-07-23): staff-triggered
  // transition from `payment-uploaded` to `confirmed` when
  // a positive balance will be collected at check-in. Server
  // enforces the same `unpaidCheckoutApprovalThreshold` /
  // admin gate as the unpaid-checkout flow and returns a
  // structured 403 with `thresholdExceeded: true` when the
  // balance is over the limit and the operator is
  // `front-desk` — the form handles the copy in that case.
  confirmBookingWithBalance: (bookingId: string, reason: string) => Promise<{ success: boolean; error?: string; thresholdExceeded?: boolean; threshold?: number; balance?: number }>;
  roomBlocks: RoomBlock[];
  createRoomBlock: (input: { roomId: string; startDate: string; endDate: string; reason: string; notes?: string }) => Promise<{ success: boolean; error?: string; blockId?: string }>;
  updateRoomBlock: (input: { blockId: string; startDate: string; endDate: string; reason: string; notes?: string }) => Promise<{ success: boolean; error?: string }>;
  cancelRoomBlock: (blockId: string) => Promise<{ success: boolean; error?: string }>;

  // Vouchers & Corporate Rates
  vouchers: Voucher[];
  addVoucher: (voucher: Omit<Voucher, "id" | "createdAt" | "usageCount">) => Promise<{ success: boolean; error?: string }>;
  updateVoucher: (voucherId: string, voucher: Omit<Voucher, "id" | "code" | "createdAt" | "createdBy" | "usageCount">) => Promise<{ success: boolean; error?: string }>;
  toggleVoucherActive: (voucherId: string) => void;
  corporateCodes: CorporateCode[];
  addCorporateCode: (code: CorporateCode) => Promise<{ success: boolean; error?: string }>;
  updateCorporateCode: (code: string, updates: Omit<CorporateCode, "code" | "createdAt" | "createdBy" | "usageCount" | "linkedInquiryId">) => Promise<{ success: boolean; error?: string }>;
  toggleCorporateCodeActive: (code: string) => void;
  deleteCorporateCode: (code: string) => void;

  // Corporate Inquiries
  corporateInquiries: CorporateInquiry[];
  updateInquiryStatus: (inquiryId: string, status: CorporateInquiry["status"]) => Promise<void>;
  addInquiryNote: (inquiryId: string, text: string) => Promise<void>;
  convertInquiryToBooking: (input: {
    inquiryId: string;
    roomId: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    hasBreakfast: boolean;
    paymentMethod: string;
    ratePerNightOverride?: number | null;
  }) => Promise<{ success: boolean; error?: string; bookingId?: string; bookingRef?: string; totalPrice?: number }>;

  // Members
  members: Member[];
  updateMemberPoints: (memberId: string, amount: number, type: PointsLog["type"], reason: string) => Promise<{ success: boolean; error?: string }>;
  toggleMemberActive: (memberId: string, isActive: boolean) => Promise<{ success: boolean; error?: string }>;
  linkBookingToMember: (memberUid: string, bookingId: string, reason: string) => Promise<{ success: boolean; error?: string; alreadyLinked?: boolean; bookingRef?: string }>;

  // Intercom Inbox
  intercoms: Record<string, IntercomMessage[]>;
  intercomThreads: Record<string, IntercomThread>;
  sendIntercomMessage: (roomId: string, text: string, sender?: "guest" | "front-desk") => void;
  markChatAsRead: (roomId: string) => void;
  setIntercomResolved: (roomId: string, resolved: boolean) => void | Promise<void>;
  incomingCall: IncomingCall | null;
  triggerIncomingCall: (roomId: string, guestName: string) => void | Promise<void>;
  acceptCall: () => void | Promise<void>;
  declineCall: () => void | Promise<void>;

  // Per-staff intercom audio routing (see `plan/features/INTERCOM-AUDIO-ROUTING.md`).
  // The hook lives in `AdminProvider` so every consumer (call audio,
  // notification sound, Audio Settings page) sees the same live value.
  audioRouting: AudioRoutingShape;
  audioRoutingLoading: boolean;
  audioRoutingError: string | null;
  applyAudioSink: (el: HTMLMediaElement | null | undefined, surface: AudioSurface) => Promise<boolean>;
  updateAudioRouting: (next: Partial<AudioRoutingShape>) => Promise<void>;
  resetAudioRouting: () => Promise<void>;

  // Store Orders
  storeOrders: StoreOrder[];
  updateStoreOrderStatus: (orderId: string, status: StoreOrder["status"], cancellationReason?: string) => void | Promise<void>;
  billStoreOrder: (orderId: string) => void | Promise<void>;
  storeItems: StoreItem[];
  addStoreItem: (item: StoreItemInput) => Promise<void>;
  updateStoreItem: (itemId: string, updates: Partial<StoreItemInput>) => Promise<void>;
  deleteStoreItem: (itemId: string) => Promise<void>;

  // Configurations
  hotelConfig: any;
  seasonalRateOverrides: SeasonalRateOverride[];
  websiteContent: any;
  rewardsConfig: any;
  breakfastConfig: any;
  storeConfig: StoreConfig;
  // `true` until the first `settings/websiteContent` snapshot
  // arrives from Firestore. The Branding tab's asset previews
  // need this to avoid flashing the static fallback logo /
  // placeholder photo before the admin's custom upload is known
  // — see `usePublicSiteContent` for the same pattern in the
  // guest app's empty initial state. Set to `false` the first
  // time the `websiteContent` case fires in the settings
  // `onSnapshot` listener below.
  websiteContentLoading: boolean;
  seoSettings: import("@spark-inn/shared").SeoSettings;
  updateSettings: (section: "hotelConfig" | "websiteContent" | "rewardsConfig" | "breakfastConfig" | "storeConfig" | "seo", data: any) => Promise<boolean>;

  // Staff Accounts
  staff: StaffMember[];
  createStaff: (input: { fullName: string; email: string; password: string; phone?: string; nationality?: string; role: StaffRole }) => Promise<{ success: boolean; error?: string }>;
  disableStaff: (uid: string) => Promise<{ success: boolean; error?: string }>;
  updateStaff: (input: { uid: string; fullName: string; email: string; phone?: string; nationality?: string; role: StaffRole; password?: string }) => Promise<{ success: boolean; error?: string }>;

  // Room Types Config
  roomTypes: RoomTypeEntry[];
  addRoomType: (
    rt: {
      value: string;
      label: string;
      shortLabel: string;
      imageUrls?: string[];
      bedDefinition: string;
      description: string;
      amenities: string[];
      maxCapacity: number;
      // Per CHD-02 (2026-08-01, per decision #144): per-room-type
      // child cap. `maxCapacity` is now the ADULT cap (the
      // semantic shift is safe because every existing booking has
      // `numChildren = 0`). The default seed is keyed on
      // `maxCapacity` (a Single allows 0, a Family allows 2). Admins
      // can tune via the Room Types editor (CHD-03). Absent fields
      // normalize via `normalizeMaxChildren` so legacy settings hydrate.
      maxChildren?: number;
      pricePerNight: number;
      weekendRate: number;
      corporateRate: number;
      // Per EXB-01 (2026-07-31): extra-bed allowance + rate.
      // `maxExtraBeds` is 0 by default (no separate `allowsExtraBed`
      // boolean per the spec). Absent fields normalize to 0.
      maxExtraBeds?: number;
      extraBedRate?: number;
    }
  ) => Promise<void>;
  updateRoomType: (
    value: string,
    updates: Partial<
      Pick<
        RoomTypeEntry,
        | "label"
        | "shortLabel"
        | "imageUrls"
        | "bedDefinition"
        | "description"
        | "amenities"
        | "maxCapacity"
        | "maxChildren"
        | "pricePerNight"
        | "weekendRate"
        | "corporateRate"
        | "maxExtraBeds"
        | "extraBedRate"
      >
    >
  ) => Promise<void>;
  deleteRoomType: (value: string) => Promise<void>;
  // Bulk-replace the room types array in a single Firestore write.
  // Used by the Rates matrix save, where N concurrent single-type
  // writes would race on the shared array field (RTS-01 — see
  // `plan/project/ROADMAP.md §RTS-02`). Throws if the write fails;
  // rolls back the optimistic state on failure.
  saveRoomTypes: (types: RoomTypeEntry[]) => Promise<void>;
  uploadRoomTypePhoto: (typeValue: string, file: File) => Promise<{ success: boolean; error?: string; url?: string }>;
  removeRoomTypePhoto: (typeValue: string, url: string) => Promise<{ success: boolean; error?: string }>;
  reorderRoomTypePhotos: (typeValue: string, imageUrls: string[]) => Promise<{ success: boolean; error?: string }>;

  // Branding assets (per-page hero photos + logo overrides). The
  // `key` is a dot-path inside `settings/websiteContent`, e.g.
  // "homepage.heroPhotoUrl" or "branding.logoNavbarOnDark". Each
  // upload overwrites the Firestore URL; `resetBrandingAsset` clears
  // it back to the empty default (so the guest app falls back to
  // the deploy-time `public/brand/` asset or the static fallback in
  // `guest-app/src/data/homepage.ts`).
  uploadBrandingAsset: (
    key: string,
    file: File
  ) => Promise<{ success: boolean; error?: string; url?: string }>;
  resetBrandingAsset: (key: string) => Promise<{ success: boolean; error?: string }>;

  // Payment Methods — dynamic CRUD + per-method QR upload. See
  // `plan/features/SETTINGS.md §Payment Methods` for the UX spec.
  paymentMethods: PaymentMethodConfig[];
  addPaymentMethod: (config: PaymentMethodConfig) => Promise<void>;
  updatePaymentMethod: (method: string, updates: Partial<PaymentMethodConfig>) => Promise<void>;
  reorderPaymentMethods: (next: PaymentMethodConfig[]) => Promise<void>;
  deletePaymentMethod: (method: string) => Promise<void>;
  // Per NBS-04 (2026-07-31): booking sources are admin-editable in
  // Settings. See `plan/features/SETTINGS.md §Booking Sources` for
  // the UX spec. Same shape as payment methods (add / update / delete
  // / reorder) with delete-protection for system-assigned sources
  // (`online` / `walk-in` / `corporate` per NBS-05).
  bookingSources: BookingSourceConfig[];
  addBookingSource: (config: BookingSourceConfig) => Promise<void>;
  updateBookingSource: (source: string, updates: Partial<Omit<BookingSourceConfig, "source">>) => Promise<void>;
  reorderBookingSources: (next: BookingSourceConfig[]) => Promise<void>;
  deleteBookingSource: (source: string) => Promise<void>;
  uploadPaymentMethodQr: (
    method: string,
    file: File
  ) => Promise<{ success: boolean; error?: string; url?: string }>;
  resetPaymentMethodQr: (method: string) => Promise<{ success: boolean; error?: string }>;

  // Audio Notifications & Intercom Counts
  unreadIntercomCount: number;
  soundsEnabled: boolean;
  setSoundsEnabled: (enabled: boolean) => void;
  playSynthNotification: (type: "booking" | "payment" | "message" | "arrival" | "departure") => void;

  // Notification Center (Phase 12 — decision #120)
  notifications: Notification[];
  notificationsLoading: boolean;
  unreadNotificationCount: number;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;

  // Environment Test Runs (ETR)
  testRuns: TestRun[];
  testRunsLoading: boolean;
  createTestRun: (input: { name: string; environment: "staging" | "production"; durationMinutes: number }) => Promise<{ success: boolean; error?: string; token?: string }>;
  closeTestRun: (runId: string) => Promise<{ success: boolean; error?: string; manifest?: any }>;
  deleteTestRun: (runId: string) => Promise<{ success: boolean; error?: string }>;
  refreshTestRuns: () => Promise<void>;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);
const ADMIN_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

function isStaffRole(role: unknown): role is StaffRole {
  return role === "admin" || role === "front-desk";
}

// FD-01 (E2E audit 2026-07-17): export the idle timeout constant
// so tests can reference it. AdminProvider accepts an optional
// idleTimeoutMs prop so the duration is injectable for testing
// without waiting 8 hours.
export const DEFAULT_ADMIN_IDLE_TIMEOUT_MS = ADMIN_IDLE_TIMEOUT_MS;

export function AdminProvider({ children, idleTimeoutMs }: { children: ReactNode; idleTimeoutMs?: number }) {
  // Auth State
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<AdminContextType["currentUser"]>(null);

  // Per-staff intercom audio routing (see `plan/features/INTERCOM-AUDIO-ROUTING.md`).
  // Subscribed once at the provider level so every consumer — the
  // Audio Settings page, the IntercomInboxPage notification sound,
  // and the WebRTC remote stream created in `acceptCall` — sees the
  // same live value without each opening its own Firestore listener.
  const audioRoutingState = useAudioRouting(currentUser?.uid ?? null);

  useEffect(() => {
    void setPersistence(auth, browserSessionPersistence).catch(() => undefined);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setCurrentUser(null);
        setAuthLoading(false);
        return;
      }

      try {
        const tokenResult = await getIdTokenResult(firebaseUser, true);
        if (!isStaffRole(tokenResult.claims.role)) {
          await firebaseSignOut(auth);
          setCurrentUser(null);
          return;
        }
        const role = tokenResult.claims.role;

        setCurrentUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? "",
          role
        });
      } catch {
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        void firebaseSignOut(auth).finally(() => {
          setCurrentUser(null);
        });
      }, idleTimeoutMs ?? ADMIN_IDLE_TIMEOUT_MS);
    };

    const events = ["click", "keydown", "mousemove", "scroll", "touchstart", "visibilitychange"];
    events.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer));
    };
  }, [currentUser, idleTimeoutMs]);

  const signIn = async (email: string, password: string) => {
    setAuthLoading(true);
    try {
      await setPersistence(auth, browserSessionPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const tokenResult = await getIdTokenResult(credential.user, true);
      if (!isStaffRole(tokenResult.claims.role)) {
        await firebaseSignOut(auth);
        setCurrentUser(null);
        throw new Error("This account is not authorized for the admin dashboard.");
      }
      const role = tokenResult.claims.role;

      setCurrentUser({
        uid: credential.user.uid,
        email: credential.user.email ?? email,
        role
      });
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setCurrentUser(null);
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  // Rooms Data State
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setRooms([]);
      setRoomsLoading(true);
      return;
    }
    setRoomsLoading(true);
    const roomsRef = collection(db, "rooms");
    const roomPrivateRef = collection(db, "roomPrivate");
    let latestRooms: Array<Room & { legacyRemarks?: string; legacyBlockReason?: string }> = [];
    let latestPrivate = new Map<string, { remarks: string; blockReason: string }>();

    const publishRooms = () => {
      const merged = latestRooms.map((room) => {
        const privateData = latestPrivate.get(room.id);
        return {
          ...room,
          remarks: privateData?.remarks ?? room.legacyRemarks ?? "",
          blockReason: privateData?.blockReason ?? room.legacyBlockReason ?? ""
        };
      });
      merged.sort((a, b) =>
        a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
      );
      setRooms(merged);
      setRoomsLoading(false);
    };

    const migrateLegacyPrivateFields = (roomId: string, data: any) => {
      const hasLegacyRemarks = typeof data.remarks === "string" && data.remarks.length > 0;
      const hasLegacyBlockReason = typeof data.blockReason === "string" && data.blockReason.length > 0;
      if (!hasLegacyRemarks && !hasLegacyBlockReason) return;

      void setDoc(doc(db, "roomPrivate", roomId), {
        ...(hasLegacyRemarks ? { remarks: data.remarks } : {}),
        ...(hasLegacyBlockReason ? { blockReason: data.blockReason } : {}),
        updatedAt: serverTimestamp()
      }, { merge: true }).then(() => updateDoc(doc(db, "rooms", roomId), {
        ...(hasLegacyRemarks ? { remarks: deleteField() } : {}),
        ...(hasLegacyBlockReason ? { blockReason: deleteField() } : {}),
        updatedAt: serverTimestamp()
      })).catch((error) => {
        console.error("Error migrating room private fields:", error);
      });
    };

    const unsubscribeRooms = onSnapshot(
      roomsRef,
      (snapshot) => {
        const roomsData: Array<Room & { legacyRemarks?: string; legacyBlockReason?: string }> = [];
        const parseDateString = (val: any) => {
          if (!val) return null;
          if (typeof val.toDate === "function") {
            return val.toDate().toISOString().split("T")[0];
          }
          if (val instanceof Date) {
            return val.toISOString().split("T")[0];
          }
          if (typeof val === "string") {
            return val.split("T")[0];
          }
          return null;
        };
        snapshot.forEach((doc) => {
          const data = doc.data();
          migrateLegacyPrivateFields(doc.id, data);
          roomsData.push({
            id: doc.id,
            name: data.name || "",
            roomNumber: data.roomNumber || "",
            type: data.type || "",
            isActive: data.isActive !== false,
            status: data.status || "available",
            housekeepingStatus: data.housekeepingStatus || "clean",
            blockedFrom: parseDateString(data.blockedFrom),
            blockedTo: parseDateString(data.blockedTo),
            blockReason: "",
            remarks: "",
            legacyBlockReason: data.blockReason || "",
            legacyRemarks: data.remarks || "",
            qrToken: data.qrToken || ""
          });
        });

        latestRooms = roomsData;
        publishRooms();
      },
      (error) => {
        console.error("Error listening to rooms collection:", error);
        setRoomsLoading(false);
      }
    );

    const unsubscribePrivate = onSnapshot(
      roomPrivateRef,
      (snapshot) => {
        latestPrivate = new Map(
          snapshot.docs.map((privateDoc) => {
            const data = privateDoc.data();
            return [privateDoc.id, {
              remarks: data.remarks || "",
              blockReason: data.blockReason || ""
            }];
          })
        );
        publishRooms();
      },
      (error) => {
        console.error("Error listening to roomPrivate collection:", error);
      }
    );

    return () => {
      unsubscribeRooms();
      unsubscribePrivate();
    };
  }, [currentUser]);

  const toggleHousekeepingStatus = async (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    // Per W1.15 / decision #88 / DASHBOARD-OVERVIEW.md: cycle order is
    // clean -> dirty -> in-progress -> clean (a room is cleaned, gets
    // used and goes dirty, is then taken for cleaning which is in-progress,
    // and returns to clean when done).
    let nextHK: Room["housekeepingStatus"] = "clean";
    if (room.housekeepingStatus === "clean") {
      nextHK = "dirty";
    } else if (room.housekeepingStatus === "dirty") {
      nextHK = "in-progress";
    } else {
      nextHK = "clean";
    }

    try {
      const roomRef = doc(db, "rooms", roomId);
      await updateDoc(roomRef, {
        housekeepingStatus: nextHK,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating housekeeping status in Firestore:", error);
    }
  };

  const updateRoomConfig = async (roomId: string, updates: Partial<Room>) => {
    try {
      const roomRef = doc(db, "rooms", roomId);
      const privateUpdates: Record<string, any> = {};
      if ("remarks" in updates) {
        privateUpdates.remarks = updates.remarks || "";
      }
      if ("blockReason" in updates) {
        privateUpdates.blockReason = updates.blockReason || "";
      }
      const dataToUpdate: Record<string, any> = {
        ...updates,
        updatedAt: serverTimestamp()
      };
      delete dataToUpdate.id; // Exclude ID from updates payload
      delete dataToUpdate.remarks;
      delete dataToUpdate.blockReason;

      await updateDoc(roomRef, dataToUpdate);
      if (Object.keys(privateUpdates).length > 0) {
        await setDoc(doc(db, "roomPrivate", roomId), {
          ...privateUpdates,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    } catch (error) {
      console.error("Error updating room config in Firestore:", error);
    }
  };

  const addRoomBlock = async (roomId: string, dates: { from: string; to: string }, reason: string) => {
    try {
      const roomRef = doc(db, "rooms", roomId);
      const fromDate = new Date(`${dates.from}T00:00:00`);
      const toDate = new Date(`${dates.to}T23:59:59`);
      await updateDoc(roomRef, {
        status: "blocked",
        blockedFrom: Timestamp.fromDate(fromDate),
        blockedTo: Timestamp.fromDate(toDate),
        updatedAt: serverTimestamp()
      });
      await setDoc(doc(db, "roomPrivate", roomId), {
        blockReason: reason,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Error adding room block in Firestore:", error);
    }
  };

  // Per `plan/features/ROOM-MANAGEMENT.md §Create`. The room id is the
  // auto-generated Firestore document id; the modal is responsible for
  // surfacing the success/failure result to the staff member.
  const createRoom = async (input: CreateRoomInput): Promise<{ success: boolean; error?: string; roomId?: string }> => {
    try {
      const normalizedNumber = input.roomNumber.trim();
      const existing = rooms.find(
        (r) => r.roomNumber.trim().toLowerCase() === normalizedNumber.toLowerCase()
      );
      if (existing) {
        const error = `Room number ${normalizedNumber} is already in use.`;
        notify.error("Cannot create room", error);
        return { success: false, error };
      }

      const docRef = await addDoc(collection(db, "rooms"), {
        name: input.name.trim(),
        roomNumber: normalizedNumber,
        type: input.type,
        isActive: input.isActive,
        status: input.status,
        housekeepingStatus: input.housekeepingStatus,
        blockedFrom: null,
        blockedTo: null,
        qrToken: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      if (input.remarks || (input.status === "blocked" && input.blockReason)) {
        await setDoc(doc(db, "roomPrivate", docRef.id), {
          remarks: input.remarks || "",
          blockReason: input.status === "blocked" ? (input.blockReason || "") : "",
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      return { success: true, roomId: docRef.id };
    } catch (error) {
      console.error("Error creating room in Firestore:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to create room", message);
      return { success: false, error: message };
    }
  };

  // Per `plan/features/ROOM-MANAGEMENT.md §Delete`. Hard delete with
  // cascade cleanup of: room photos in Storage (`rooms/{roomId}/*`),
  // intercom thread + messages (`intercoms/{roomNumber}/{document=**}`),
  // and call signaling doc + ICE candidates (`calls/{roomNumber}/{document=**}`).
  // The function is gated by `hasActiveBookings` — staff must first
  // cancel or check out any pending/confirmed/checked-in bookings
  // before a room can be removed. Historical bookings keep their
  // denormalized roomNumber/roomType so receipts and audit logs
  // remain readable; only the live `roomId` pointer is removed.
  const hasActiveBookings = (roomId: string): number => {
    return bookings.filter(
      (b) => b.roomId === roomId && (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(b.status)
    ).length;
  };

  async function deleteSubcollection(parentPath: string) {
    const snap = await getDocs(collection(db, parentPath));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  const deleteRoom = async (roomId: string, reason = ""): Promise<{ success: boolean; error?: string; blockedByActiveBookings?: number }> => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) {
      const error = "Room not found.";
      notify.error("Cannot delete room", error);
      return { success: false, error };
    }

    const activeCount = hasActiveBookings(roomId);
    if (activeCount > 0) {
      const error = `Room ${room.roomNumber} has ${activeCount} active booking${activeCount === 1 ? "" : "s"}. Cancel or check them out first.`;
      notify.warning("Cannot delete room", error);
      return { success: false, error, blockedByActiveBookings: activeCount };
    }

    try {
      // 1) Room photos in Storage — best-effort (don't fail the whole
      //    delete on Storage errors; the room is being removed anyway).
      try {
        const folderRef = storageRef(storage, `rooms/${roomId}`);
        const listed = await listAll(folderRef);
        await Promise.all(listed.items.map((item) => deleteObject(item).catch(() => undefined)));
      } catch (storageErr) {
        console.warn(`Storage cleanup for room ${roomId} skipped:`, storageErr);
      }

      // 2) Intercom thread + messages (keyed by roomNumber).
      if (room.roomNumber) {
        try {
          await deleteSubcollection(`intercoms/${room.roomNumber}/messages`);
        } catch (intercomErr) {
          console.warn(`Intercom messages cleanup for room ${room.roomNumber} skipped:`, intercomErr);
        }
        try {
          await deleteDoc(doc(db, "intercoms", room.roomNumber));
        } catch (intercomDocErr) {
          console.warn(`Intercom thread doc cleanup for room ${room.roomNumber} skipped:`, intercomDocErr);
        }

        // 3) Call signaling doc + ICE candidates.
        try {
          await deleteSubcollection(`calls/${room.roomNumber}/iceCandidates`);
        } catch (callErr) {
          console.warn(`Call ICE cleanup for room ${room.roomNumber} skipped:`, callErr);
        }
        try {
          await deleteDoc(doc(db, "calls", room.roomNumber));
        } catch (callDocErr) {
          console.warn(`Call doc cleanup for room ${room.roomNumber} skipped:`, callDocErr);
        }
      }

      await addDoc(collection(db, "roomDeletionAudit"), {
        roomId,
        roomNumber: room.roomNumber,
        roomType: room.type,
        reason: reason.trim(),
        deletedBy: currentUser?.uid || currentUser?.email || "staff",
        deletedAt: serverTimestamp()
      });

      // 4) Staff-only private room notes.
      try {
        await deleteDoc(doc(db, "roomPrivate", roomId));
      } catch (privateErr) {
        console.warn(`Private room notes cleanup for room ${roomId} skipped:`, privateErr);
      }

      // 5) Finally, the room document itself.
      await deleteDoc(doc(db, "rooms", roomId));

      return { success: true };
    } catch (error) {
      console.error("Error deleting room in Firestore:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to delete room", message);
      return { success: false, error: message };
    }
  };

  // Bookings Data State
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);

  // Per MRB-12 (2026-08-03, per decision #179 — proposed): the
  // reservation headers are hydrated into memory so the Bookings
  // table row can read the reservation-scope aggregate
  // (`totalPrice`, `paymentStatus`, denormalized counters,
  // `aggregateRevenueAllocation`, `cancellationLiability`) WITHOUT
  // summing the filtered in-memory children. The old behaviour
  // (`admin-app/src/pages/BookingsPage.tsx:1701-1705`, summing
  // `child.totalPrice` and `getBookingFolio(child).balance`)
  // silently dropped any child hidden by an active filter —
  // a real bug at any scale where the desk filters by room type
  // or status. The header doesn't filter, so the bug is
  // impossible by construction. The listener is full-collection
  // (no query) because the reservation count is bounded (~14
  // active at this hotel) and the alternative — per-reservation
  // subcollection reads — would re-introduce the filter
  // dependence.
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // Per MRB-12 (2026-08-03, per decision #179 — proposed):
  // the reservation-scope `paidAmount` aggregate. Computed
  // from a single `collectionGroup("payments")` listener that
  // filters in JS to the reservation subcollection paths
  // (`reservations/{id}/payments/{paymentId}`). Legacy
  // `bookings/{id}/payments/{paymentId}` entries do NOT match
  // the path regex and are excluded — they belong to the
  // per-child legacy adapter. With ~14 active reservations
  // and a few years of payment history, the collectionGroup
  // load is hundreds of small docs, well under any scale
  // concern. The `paidAmount` is the sum of positive-amount
  // entries (sign-aware: refunds are negative per CRL-01 and
  // reduce the paid total), matching the `paymentsTotal`
  // semantics `getReservationFolioSummary` exposes. Used by
  // the Bookings table reservation row for `listReservationBalance`.
  const [reservationPaidAmount, setReservationPaidAmount] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!currentUser) {
      setBookings([]);
      setBookingsLoading(true);
      return;
    }
    let active = true;
    setBookingsLoading(true);
    const bookingsRef = collection(db, "bookings");
    const unsubscribe = onSnapshot(
      bookingsRef,
      async (snapshot) => {
        const bookingsData: Booking[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          
          const parseDateString = (val: any) => {
            if (!val) return "";
            if (typeof val.toDate === "function") {
              return val.toDate().toISOString().split("T")[0];
            }
            if (val instanceof Date) {
              return val.toISOString().split("T")[0];
            }
            if (typeof val === "string") {
              return val.split("T")[0];
            }
            return "";
          };

          const parseDateTimeString = (val: any) => {
            if (!val) return "";
            if (typeof val.toDate === "function") {
              return val.toDate().toISOString();
            }
            if (val instanceof Date) {
              return val.toISOString();
            }
            if (typeof val === "string") {
              return val;
            }
            return "";
          };

          bookingsData.push({
            id: docSnap.id,
            bookingRef: data.bookingRef || "",
            roomId: data.roomId || "",
            roomNumber: data.roomNumber || "",
            roomType: data.roomType || "",
            guestName: data.guestName || "",
            guestEmail: data.guestEmail || "",
            guestPhone: data.guestPhone || "",
            numGuests: data.numGuests || 0,
            checkIn: parseDateString(data.checkIn),
            checkOut: parseDateString(data.checkOut),
            numNights: data.numNights || 0,
            ratePerNight: data.ratePerNight || 0,
            totalPrice: data.totalPrice || 0,
            originalTotalPrice: data.originalTotalPrice !== undefined ? data.originalTotalPrice : null,
            discountType: data.discountType || "",
            discountPct: data.discountPct || 0,
            discountIdPhotoUrl: data.discountIdPhotoUrl || null,
            discountIdPhotoPath: data.discountIdPhotoPath || null,
            discountVerified: !!data.discountVerified,
            discountVerifiedBy: data.discountVerifiedBy || null,
            discountRejected: !!data.discountRejected,
            discountRejectedBy: data.discountRejectedBy || null,
            discountRejectionReason: data.discountRejectionReason || "",
            voucherCode: data.voucherCode || "",
            voucherDiscount: data.voucherDiscount || 0,
            isCorporate: !!data.isCorporate,
            corporateCode: data.corporateCode || "",
            companyName: data.companyName || "",
            specialRequests: data.specialRequests || "",
            status: data.status || "pending",
            paymentMethod: data.paymentMethod || "",
            // Per BF-45 (booking-flow audit 2026-06-26):
            // canonical "absent" is `null`, not `""`.
            paymentProofUrl: data.paymentProofUrl || null,
            paymentProofPath: data.paymentProofPath || null,
            // Per FOL-01 (2026-08-06, decision #197): the
            // durable "payment was verified" signal. Hydrate
            // from the Firestore doc (server writes a `Date`;
            // admin convention is ISO string via
            // `parseDateTimeString`). `null` for legacy
            // bookings and any booking whose payment has not
            // been staff-verified. The shared
            // `isPaymentVerified()` helper is the only
            // authoritative read; the per-render `status ===
            // "payment-confirmed"` checks at BookingsPage.tsx
            // 4803-4811 + 5195-5208 are the bug this hydration
            // (and the helper) fixes. The other two rejection
            // fields (`paymentRejectionReason` / `paymentRejectedAt`)
            // are not hydrated here — they're populated via
            // the explicit reject-payment flow only and are
            // not needed for the verified-state read.
            paymentConfirmedAt: data.paymentConfirmedAt
              ? parseDateTimeString(data.paymentConfirmedAt)
              : null,
            // Per Phase 12 — Dashboard Payment Rejection & Reference
            // Verification (2026-07-15): the reject-payment handler
            // stamps these three fields on the booking doc. The
            // admin `Booking` type already declares them but the
            // pre-FOL-02 mapper silently dropped all three on every
            // snapshot echo — same shape of bug as MRB-15-10 and
            // FOL-01 (the type declares a field, the mapper forgets
            // to read it from the snapshot). The dashboard's
            // reject-payment card reads `paymentRejectionReason`
            // from this hydrated field; the Folio's "Rejected"
            // badge reads the same field. `paymentRejectedAt` /
            // `paymentRejectedBy` are audit metadata for the
            // rejected-proof trail. Default to `null` / `""` so a
            // legacy booking without these fields reads as
            // "no rejection happened" (the type already declares
            // them nullable).
            paymentRejectionReason: data.paymentRejectionReason || null,
            paymentRejectedAt: data.paymentRejectedAt
              ? parseDateTimeString(data.paymentRejectedAt)
              : null,
            paymentRejectedBy: data.paymentRejectedBy || null,
            // Per H2 (hardening batch 2026-06-26): the
            // server generates this on create. The admin
            // app just hydrates the field for display /
            // re-issue flows.
            lookupToken: data.lookupToken || "",
            source: data.source || "online",
            notes: data.notes || "",
            memberId: data.memberId || null,
            pointsRedeemed: data.pointsRedeemed || 0,
            pointsRedeemedValue: data.pointsRedeemedValue || 0,
            pointsRedeemedBy: data.pointsRedeemedBy || null,
            pointsRedeemedAt: data.pointsRedeemedAt || null,
            hasBreakfast: !!data.hasBreakfast,
            breakfastRate: data.breakfastRate || 0,
            reminderSentAt: data.reminderSentAt ? parseDateTimeString(data.reminderSentAt) : null,
            guestIdPhotoUrl: data.guestIdPhotoUrl || null,
            handledBy: data.handledBy || "",
            cancellationReason: data.cancellationReason || "",
            // Per CRL-02 (2026-08-02): hydrate the full
            // cancellation audit metadata. `cancelledAt` is the
            // server-time stamp; `cancelledBy` is the staff UID
            // (for "staff" source) or the literal "guest" /
            // "system" (for the matching sources); `cancellationSource`
            // is the parallel discriminator. Legacy bookings
            // without these fields read as `null` (the type
            // already declares them as nullable). The hydration
            // is the read path that powers the booking drawer's
            // audit row in a follow-up CRL-09 UI pass.
            cancelledAt: data.cancelledAt ? parseDateTimeString(data.cancelledAt) : null,
            cancelledBy: data.cancelledBy || null,
            cancellationSource: data.cancellationSource || null,
            // Per CRL-07 (2026-08-03, per decision #173):
            // hydrate the liability snapshot from the
            // booking doc. The destructive cancel
            // stamps this field on the cancelled
            // entity; reservation-scope cancels stamp
            // it on the reservation header instead
            // (read separately via the header's own
            // hydration — the admin UI surfaces the
            // reservation's liability when the
            // selected booking is part of a
            // multi-room reservation). Absence reads
            // as `null` (the type already declares it
            // nullable).
            cancellationLiability: data.cancellationLiability || null,
            // Per MRB-01 (2026-08-02, per decision #159): the
            // reservation header linkage. The pre-FOL-02 mapper
            // silently dropped all four fields on every snapshot
            // echo — same shape of bug as MRB-15-10 and FOL-01
            // (the type declares a field, the mapper forgets
            // to read it from the snapshot). The downstream
            // consequences are visible in two places:
            //   1. The booking drawer's payments listener at
            //      `BookingsPage.tsx:1164-1224` gates on
            //      `selectedBooking.reservationId` to decide
            //      whether to subscribe to the post-MRB-01
            //      canonical path `reservations/{id}/payments/`
            //      OR the legacy `bookings/{id}/payments/`. With
            //      the field dropped, every booking fell through
            //      to the legacy path — so a verified payment
            //      written to the canonical subcollection was
            //      invisible to the Folio's "Payment history",
            //      and the "Collect <balance>" CTA stayed on
            //      screen even after the staff verified the
            //      full amount. The Folio summary read
            //      `paymentsTotal = 0` and "balance = grandTotal"
            //      even though `paymentConfirmedAt` was set and
            //      the verified record existed in the
            //      subcollection.
            //   2. The booking drawer's reservation strip, the
            //      Bookings table's group-row collapse, the
            //      MRB-12 reservation-scope payment-status pill,
            //      and the deep-link `?reservationId=` resolution
            //      all read these four fields. With the fields
            //      dropped, those surfaces silently fell through
            //      to the legacy null-reservationId shape.
            // Hydrating from the snapshot (with `String().trim()`
            // for the id / ref and `Number()` for the position /
            // count) matches the post-MRB-01 contract. Legacy
            // null-`reservationId` bookings have all four as
            // `null` (no migration; pre-live TEST DATA is reset,
            // not migrated).
            reservationId: data.reservationId ? String(data.reservationId).trim() || null : null,
            reservationRef: data.reservationRef ? String(data.reservationRef).trim() || null : null,
            reservationPosition: Number.isFinite(Number(data.reservationPosition))
              ? Number(data.reservationPosition)
              : null,
            reservationRoomCount: Number.isFinite(Number(data.reservationRoomCount))
              ? Number(data.reservationRoomCount)
              : null,
            // Per 2026-07-24 (refactor/unify-payment-reference-fields):
            // the canonical payment reference lives on each entry
            // in the booking's `onsitePayments[]` ledger as
            // `transactionReference`. The previous top-level
            // `Booking.paymentReferenceNumber` is retired. The
            // shared `getLatestPaymentReference()` reads from
            // this array; the Folio summary + the booking
            // table's "PAID" pill + the report exports + the
            // dashboard's pending-payment card all consume it.
            //
            // The pre-FOL-02 mapper declared the field on the
            // admin `Booking` type but never read it from the
            // snapshot, so the array was always `undefined` in
            // React state. The downstream consequences:
            //   1. The header's "Reference" line
            //      (`BookingDrawerWorkspace.tsx:170`) renders
            //      "Pending verification" forever for every
            //      booking — the helper returns `null` because
            //      the array is empty, and the staff sees
            //      "Pending verification" even after a verified
            //      payment. The fix is the same as FOL-01's
            //      paymentConfirmedAt: hydrate from the
            //      snapshot. (A complementary fix wires the
            //      live listener's results into the reference
            //      read at the call site — see the
            //      `getSelectedBookingLatestReference` helper
            //      below + the `BookingDrawerWorkspaceHeader`
            //      `latestPaymentReference` prop.)
            //   2. The Folio's "gcash · <reference>" line on
            //      the proof card shows "No reference" for the
            //      same reason.
            //   3. The Bookings table's "PAID" pill computes
            //      paid = `(row.onsitePayments ?? []).reduce(...)`
            //      (line 2074) — every row reads as ₱0 paid.
            //   4. The advanced filter's "Reference" search
            //      (line 1759) matches against the empty
            //      array — staff can't filter by reference.
            //
            // Defensive default: the field is always present
            // on the Firestore doc (server writes an empty
            // array on create), but legacy bookings from
            // before 2026-07-24 may have no `onsitePayments`
            // field at all — fall back to `[]` so the read is
            // never undefined.
            onsitePayments: Array.isArray(data.onsitePayments)
              ? data.onsitePayments.map((p: any) => ({
                  id: String(p.id || ""),
                  type: p.type === "refund" ? "refund" : "payment",
                  amount: Number(p.amount || 0),
                  method: String(p.method || ""),
                  note: String(p.note || ""),
                  transactionReference: p.transactionReference
                    ? String(p.transactionReference)
                    : null,
                  reason: p.reason ? String(p.reason) : null,
                  approvedBy: p.approvedBy ? String(p.approvedBy) : null,
                  recordedBy: String(p.recordedBy || "staff"),
                  recordedAt: p.recordedAt
                    ? (typeof p.recordedAt.toDate === "function"
                        ? p.recordedAt.toDate().toISOString()
                        : (p.recordedAt instanceof Date
                            ? p.recordedAt.toISOString()
                            : String(p.recordedAt)))
                    : ""
                }))
              : [],
            createdAt: parseDateTimeString(data.createdAt),
            guestRegistration: data.guestRegistration || null,
            breakfastSelections: data.breakfastSelections || {},
            // Per BSP-01 (fix/breakfast-served-persistence, 2026-07-25):
            // hydrate `breakfastServed` from the snapshot so the dashboard's
            // "Mark Served" toggle survives real-time refresh and is visible
            // to other signed-in staff sessions. Previously the mapper only
            // hydrated `breakfastSelections`; the served map was written
            // successfully to Firestore (and the security rule allows it)
            // but read back as `undefined`, so the dashboard re-rendered the
            // row as unserved after every snapshot update.
            breakfastServed: data.breakfastServed || {},
          });
        });

        await Promise.all(bookingsData.map(async (booking) => {
          if (booking.discountIdPhotoPath) {
            booking.discountIdPhotoUrl = await resolvePrivateStorageUrl(booking.discountIdPhotoPath) || null;
          }
          if (booking.paymentProofPath) {
            booking.paymentProofUrl = await resolvePrivateStorageUrl(booking.paymentProofPath) || null;
          }
        }));
        if (!active) return;

        // Natural sort by createdAt descending
        bookingsData.sort((a, b) => {
          const aTime = a.createdAt || "";
          const bTime = b.createdAt || "";
          if (aTime !== bTime) {
            return bTime.localeCompare(aTime);
          }
          return b.bookingRef.localeCompare(a.bookingRef);
        });

        setBookings((prev) => {
          if (isLoadedRef.current) {
            const prevIds = new Set(prev.map((b) => b.id));
            const prevStatusMap = new Map(prev.map((b) => [b.id, b.status]));

            let hasNewBooking = false;
            let hasPaymentPending = false;
            let hasNewArrival = false;
            let hasNewDeparture = false;

            bookingsData.forEach((b) => {
              const prevStatus = prevStatusMap.get(b.id);
              if (!prevIds.has(b.id)) {
                hasNewBooking = true;
                if (b.status === "pending") {
                  hasPaymentPending = true;
                }
              } else if (prevStatus !== b.status) {
                if (b.status === "pending") {
                  hasPaymentPending = true;
                }
                if (b.status === "checked-in") {
                  hasNewArrival = true;
                }
                if (b.status === "checked-out") {
                  hasNewDeparture = true;
                }
              }
            });

            if (hasNewBooking) {
              playSynthNotification("booking");
            } else if (hasPaymentPending) {
              playSynthNotification("payment");
            } else if (hasNewArrival) {
              playSynthNotification("arrival");
            } else if (hasNewDeparture) {
              playSynthNotification("departure");
            }
          }
          return bookingsData;
        });
        setBookingsLoading(false);
      },
      (error) => {
        console.error("Error listening to bookings collection:", error);
        setBookingsLoading(false);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUser]);

  // Per MRB-12 (2026-08-03, per decision #179 — proposed):
  // subscribe to the `reservations` collection and hydrate
  // the headers into memory. The listener runs alongside
  // the bookings listener (same `currentUser` gate) and
  // has no `orderBy` because the Bookings table consumes
  // the data as a `Record<reservationId, Reservation>`
  // (the row is keyed by the booking's `reservationId`).
  // The full collection is cheap at this scale (~14 active
  // reservations at the hotel's current size; the cap is
  // bounded by room inventory, not bookings volume).
  //
  // Per MRB-15-09 (2026-08-03, per decision #182): the
  // `isStaff()` rule on `/reservations/{id}` requires the
  // current ID token to carry the `role` custom claim.
  // The auth gate above (`onAuthStateChanged` at L809)
  // calls `getIdTokenResult(firebaseUser, true)` to
  // validate the role, but the Firestore SDK uses its own
  // cached ID token for the listener handshake — if the
  // SDK's cache is one refresh behind the `currentUser`
  // state (e.g. the staff claim was just minted server-side
  // and the cached token still lacks it), the listener
  // attaches with the stale token and the server replies
  // `Missing or insufficient permissions` on the first
  // query. The fix is to force a token refresh inside this
  // effect, BEFORE `onSnapshot` is called, so the SDK
  // issues the listener request with the up-to-date claims.
  // The async IIFE is the same shape the bookings listener
  // uses; the `cancelled` flag protects against the
  // unmount-mid-refresh race (a stale refresh resolving
  // after cleanup must NOT re-attach the listener).
  useEffect(() => {
    if (!currentUser) {
      setReservations([]);
      return;
    }

    const parseDateOrNull = (val: any): Date | null => {
      if (!val) return null;
      if (typeof val?.toDate === "function") return val.toDate();
      if (val instanceof Date) return val;
      if (typeof val === "string") return new Date(val);
      if (typeof val === "object" && typeof val.seconds === "number") return new Date(val.seconds * 1000);
      return null;
    };
    // Coerce to a `Date` with epoch fallback for the
    // required fields (`checkIn`, `checkOut`, `createdAt`,
    // `updatedAt` are all `Date` in the `Reservation`
    // type — see `shared/types/index.ts:238`). The epoch
    // fallback satisfies the type; the row summary
    // (MRB-12-01) only reads `totalPrice`, so a bogus
    // date is harmless.
    const parseDateOrEpoch = (val: any): Date => parseDateOrNull(val) ?? new Date(0);

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Force-refresh the ID token so the listener's
    // handshake carries the staff `role` custom claim.
    // `getIdToken(true)` is idempotent — if the cached
    // token is already fresh, the SDK returns it without
    // a network round-trip; if it's stale, the SDK
    // exchanges the refresh token for a fresh ID token
    // with the up-to-date claims. The await is what
    // makes the listener attach after the refresh.
    void auth.currentUser?.getIdToken(true).then(() => {
      if (cancelled) return;

      unsubscribe = onSnapshot(
        collection(db, "reservations"),
        (snapshot) => {
          const list: Reservation[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data() as any;
            return {
              id: docSnap.id,
              reservationRef: data.reservationRef || "",
              leadGuestName: data.leadGuestName || "",
              leadGuestEmail: data.leadGuestEmail || "",
              leadGuestPhone: data.leadGuestPhone || "",
              memberId: data.memberId ?? null,
              checkIn: parseDateOrEpoch(data.checkIn),
              checkOut: parseDateOrEpoch(data.checkOut),
              numNights: Number(data.numNights) || 0,
              originalSubtotal: Number(data.originalSubtotal) || 0,
              discountScopeSnapshot: data.discountScopeSnapshot ?? null,
              subtotal: Number(data.subtotal) || 0,
              totalPrice: Number(data.totalPrice) || 0,
              source: data.source || "online",
              isCorporate: !!data.isCorporate,
              corporateCode: data.corporateCode || "",
              companyName: data.companyName || "",
              voucherCode: data.voucherCode || "",
              memberDiscountPct: Number(data.memberDiscountPct) || 0,
              paymentMethod: data.paymentMethod || "",
              paymentProofUrl: data.paymentProofUrl ?? null,
              paymentProofPath: data.paymentProofPath ?? null,
              termsAccepted: !!data.termsAccepted,
              termsAcceptedAt: parseDateOrNull(data.termsAcceptedAt),
              termsVersion: data.termsVersion || "",
              privacyAccepted: !!data.privacyAccepted,
              privacyAcceptedAt: parseDateOrNull(data.privacyAcceptedAt),
              privacyVersion: data.privacyVersion || "",
              cancellationPolicySnapshot: data.cancellationPolicySnapshot ?? null,
              holdExpiresAt: parseDateOrNull(data.holdExpiresAt),
              requestFingerprint: data.requestFingerprint || "",
              createdAt: parseDateOrEpoch(data.createdAt),
              updatedAt: parseDateOrEpoch(data.updatedAt),
              createdBy: data.createdBy || "guest",
              cancellationLiability: data.cancellationLiability ?? null,
              aggregateRevenueAllocation: data.aggregateRevenueAllocation ?? null,
              // Per BAR-02 (2026-08-08, per decision #203):
              // the five aggregate counter fields +
              // `paymentStatus` are no longer written to
              // the reservation header. Consumers derive
              // them via `deriveReservationCounters` +
              // `computeReservationAggregatePaymentStatus`
              // over the children at read time. The
              // back-compat reads below surface `undefined`
              // for post-BAR-02 reservations (the fields
              // are absent) and the historical values for
              // pre-BAR-02 reservations that still carry
              // them in Firestore. The pre-BAR-02
              // byte-equivalence at the read boundary is
              // preserved (consumers that haven't migrated
              // to the derivation helpers still see the
              // same values).
              paymentStatus: data.paymentStatus,
              roomCount: data.roomCount,
              activeRoomCount: data.activeRoomCount,
              cancelledRoomCount: data.cancelledRoomCount,
              checkedInRoomCount: data.checkedInRoomCount,
              checkedOutRoomCount: data.checkedOutRoomCount,
              // Per MRB-14 (2026-08-03, per decision #180
              // — proposed): the `actualDateRange` field.
              // Pre-MRB-14 reservations have no field
              // (`undefined` falls through to the legacy
              // per-child read in the UI + email).
              // Post-MRB-14 reservations always carry
              // the field. The admin surfaces + email
              // switch to per-child dates when
              // `isDivergent: true`.
              actualDateRange: (() => {
                const raw = (data as any).actualDateRange;
                if (!raw || typeof raw !== "object") return null;
                const earliestCheckIn = parseDateOrNull(raw.earliestCheckIn);
                const latestCheckOut = parseDateOrNull(raw.latestCheckOut);
                if (!earliestCheckIn || !latestCheckOut) return null;
                return {
                  earliestCheckIn,
                  latestCheckOut,
                  isDivergent: Boolean(raw.isDivergent)
                };
              })()
            } satisfies Reservation;
          });
          setReservations(list);
        },
        (error) => {
          console.error("Error listening to reservations collection:", error);
        }
      );
    }).catch((refreshError) => {
      // If the refresh itself fails (e.g. network down or
      // refresh token revoked), surface it — the listener
      // never attached, so the UI just stays on its last
      // known state. A future refresh + sign-in will retry.
      if (cancelled) return;
      console.error("Error refreshing auth token before reservations listener:", refreshError);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [currentUser]);

  // Per MRB-12 (2026-08-03, per decision #179 — proposed):
  // the reservation-scope `paidAmount` aggregate. A single
  // `collectionGroup("payments")` listener scans the
  // reservation payment subcollection paths and sums positive
  // amounts (refunds are negative per CRL-01 and reduce the
  // paid total — sign-aware sum, same as
  // `getReservationFolioSummary` does in the helper). The
  // listener does NOT include `bookings/{id}/payments/...`
  // (the legacy adapter) — those belong to the per-child
  // legacy flow and stay summed from the in-memory
  // `bookings` array. Used by the Bookings table reservation
  // row so `listReservationBalance` is independent of the
  // active filter (MRB-12-01).
  useEffect(() => {
    if (!currentUser) {
      setReservationPaidAmount({});
      return;
    }

    const unsubscribe = onSnapshot(
      collectionGroup(db, "payments"),
      (snapshot) => {
        const paidByReservation: Record<string, number> = {};
        for (const paymentDoc of snapshot.docs) {
          // The path is `reservations/{reservationId}/payments/{paymentId}`
          // for new reservations. Legacy `bookings/{id}/payments/{...}`
          // entries do NOT match — they are excluded.
          const match = paymentDoc.ref.path.match(/^reservations\/([^/]+)\/payments\//);
          if (!match) continue;
          const reservationId = match[1];
          const amount = Number(paymentDoc.data()?.amount || 0);
          if (!Number.isFinite(amount)) continue;
          paidByReservation[reservationId] = (paidByReservation[reservationId] || 0) + amount;
        }
        setReservationPaidAmount(paidByReservation);
      },
      (error) => {
        console.error("Error listening to reservation payments collectionGroup:", error);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const [roomBlocks, setRoomBlocks] = useState<RoomBlock[]>([]);

  useEffect(() => {
    if (!currentUser) {
      setRoomBlocks([]);
      return;
    }

    const parseDateString = (val: any) => {
      if (!val) return "";
      if (typeof val.toDate === "function") return val.toDate().toISOString().split("T")[0];
      if (val instanceof Date) return val.toISOString().split("T")[0];
      if (typeof val === "string") return val.split("T")[0];
      return "";
    };
    const parseDateTimeString = (val: any) => {
      if (!val) return "";
      if (typeof val.toDate === "function") return val.toDate().toISOString();
      if (val instanceof Date) return val.toISOString();
      if (typeof val === "string") return val;
      return "";
    };

    const unsubscribe = onSnapshot(
      collection(db, "roomBlocks"),
      (snapshot) => {
        const blocks = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            roomId: data.roomId || "",
            roomNumber: data.roomNumber || "",
            roomType: data.roomType || "",
            startDate: parseDateString(data.startDate),
            endDate: parseDateString(data.endDate),
            reason: data.reason || "",
            notes: data.notes || "",
            status: data.status === "cancelled" ? "cancelled" : "active",
            createdBy: data.createdBy || "",
            createdAt: parseDateTimeString(data.createdAt),
            updatedAt: parseDateTimeString(data.updatedAt),
            cancelledAt: data.cancelledAt ? parseDateTimeString(data.cancelledAt) : null,
            cancelledBy: data.cancelledBy || null
          } satisfies RoomBlock;
        });
        setRoomBlocks(blocks);
      },
      (error) => {
        console.error("Error listening to roomBlocks collection:", error);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const resolveEarlyCheckin = async (bookingId: string, status: "approved" | "declined", staffNote?: string, confirmedTime?: string) => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/early-checkin-resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId, status, staffNote, confirmedTime })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to resolve early check-in." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("resolveEarlyCheckin failed:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  const rescheduleBooking = async (input: { bookingId: string; roomId: string; checkIn: string; checkOut: string; reason?: string }) => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/reschedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify(input)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to move booking." };
      }
      return { success: true, data: data.data };
    } catch (err: any) {
      console.error("rescheduleBooking failed:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  const createRoomBlock = async (input: { roomId: string; startDate: string; endDate: string; reason: string; notes?: string }) => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/room-blocks/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify(input)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to block dates." };
      }
      return { success: true, blockId: data.blockId as string | undefined };
    } catch (err: any) {
      console.error("createRoomBlock failed:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  const updateRoomBlock = async (input: { blockId: string; startDate: string; endDate: string; reason: string; notes?: string }) => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/room-blocks/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify(input)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to update block." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("updateRoomBlock failed:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  const cancelRoomBlock = async (blockId: string) => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/room-blocks/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ blockId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to unblock dates." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("cancelRoomBlock failed:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  const updateBookingStatus = async (
    bookingId: string,
    status: Booking["status"],
    details?: Partial<Booking>,
    // Per MRB-13 (2026-08-02, per decision #166): the
    // cancel scope. The admin BookingsPage cancel
    // modal surfaces a `This room` / `All N rooms`
    // selector when the selected booking is part of
    // a multi-room reservation. The default `"room"`
    // preserves byte-compatible single-child behavior
    // — the server's Zod schema also defaults
    // `scope` to `"room"` (see
    // `guestCancelSchema` in `bookings.ts`), so a
    // caller that omits `options.scope` lands on the
    // legacy per-child branch. Only the `"cancelled"`
    // status honours `options.scope`; other status
    // transitions ignore it (the field is silently
    // dropped on the wire).
    options?: { scope?: "room" | "reservation" }
  ) => {
    try {
      const currentBooking = bookings.find((b) => b.id === bookingId);
      const isStatusChanging = currentBooking ? currentBooking.status !== status : true;
      const bookingDocRef = doc(db, "bookings", bookingId);

      if (!isStatusChanging) {
        await updateDoc(bookingDocRef, {
          ...details,
          updatedAt: serverTimestamp(),
          handledBy: currentUser?.uid || currentUser?.email || "staff"
        });
        return;
      }

      if (status === "cancelled") {
        const token = await auth.currentUser?.getIdToken(true);
        // Per MRB-13: forward the scope to the server.
        // Default to `"room"` (the schema default) so a
        // caller that never opts in still cancels a
        // single child — byte-equivalent to pre-MRB-13.
        const cancelScope: "room" | "reservation" = options?.scope === "reservation" ? "reservation" : "room";
        const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/cancel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({
            bookingId,
            reason: details?.cancellationReason || "",
            scope: cancelScope
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to cancel booking via server API.");
        }
      } else if (status === "confirmed") {
        const token = await auth.currentUser?.getIdToken(true);
        const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/confirm`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({ bookingId })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to confirm booking via server API.");
        }
      } else if (status === "payment-confirmed") {
        const token = await auth.currentUser?.getIdToken(true);
        const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/mark-payment-confirmed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({ bookingId })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to confirm payment via server API.");
        }
      } else if (status === "checked-out") {
        const token = await auth.currentUser?.getIdToken(true);
        const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({
            bookingId,
            unpaidCheckoutReason: details?.unpaidCheckoutReason || null
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          if (data.thresholdExceeded) {
            throw new Error(data.message || data.error);
          }
          throw new Error(data.error || "Failed to checkout booking via server API.");
        }
      } else if (status === "checked-in") {
        const token = await auth.currentUser?.getIdToken(true);
        const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/checkin`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({ bookingId })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to check in booking via server API.");
        }
      } else {
        throw new Error(`Unsupported client-side booking status transition: ${status}`);
      }
    } catch (error) {
      console.error("Error updating booking status:", error);
      notify.error("Failed to update booking status", error instanceof Error ? error.message : String(error));
    }
  };

  const addOnsitePayment = async (bookingId: string, paymentId: string, amount: number, method: string, note: string, transactionReference?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/add-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          bookingId,
          paymentId,
          amount,
          method,
          note,
          transactionReference
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to record payment" };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error recording onsite payment:", err);
      return { success: false, error: err.message };
    }
  };

  const addWalkinBooking = async (
    input: Omit<Booking, "id" | "bookingRef" | "createdAt" | "guestName"> & {
      firstName: string;
      lastName: string;
      totalPriceOverride?: number;
      // Per MRB-07 (2026-08-02, per decision #159): the reservation's
      // room stays, when the desk booked more than one room.
      rooms?: Array<{
        roomId: string;
        numAdults: number;
        numChildren: number;
        extraBedCount: number;
      }>;
      // Per NBS-2026-08-08 (F1, booking-flow audit 2026-08-08):
      // the optional client-preallocated `bookingId` and
      // `reservationId`. The historical auto-mint path
      // (both fields freshly generated on every submit)
      // silently created a duplicate booking on a
      // retry-after-uncertain-response — the user clicks
      // Confirm, the request times out, the user clicks
      // again, the server's auto-mint gives each call a
      // new id, and the second submit lands as a separate
      // booking against the same guest. The preallocation
      // contract matches the public `/api/bookings/create`
      // path (MRB-02): the call site preallocates both
      // ids in a `useState` lazy init, reuses them across
      // retries inside the same modal session, and resets
      // them after the success toast. When absent, the
      // server auto-mints (back-compat with the existing
      // caller that does not preallocate).
      preallocatedBookingId?: string;
      preallocatedReservationId?: string;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      // Per NBS-2026-08-08 (F1): the call site may preallocate
      // both ids; when absent, we auto-mint (legacy behavior).
      // The preallocation is what makes a retry-after-uncertain-
      // response safe — the server's transaction reads the
      // reservation header first and either replays the
      // original commit (same `reservationId` + same
      // `requestFingerprint`) or returns a 409 (different
      // `requestFingerprint`). Without preallocation each
      // retry races the auto-mint and produces a duplicate.
      const bookingId = input.preallocatedBookingId || doc(collection(db, "bookings")).id;
      const reservationId = input.preallocatedReservationId || generateReservationId();

      // Per fix/walkin-split-name (2026-07-25): the walk-in
      // modal now collects `firstName` + `lastName` separately
      // (matching the guest `/book` page). The previous
      // on-the-wire name-split (a single combined string split
      // on the first space) silently produced a generic
      // placeholder for single-name guests, mangled compound
      // names, and reversed "Last, First" inputs. The server
      // combines firstName + lastName into `Booking.guestName`
      // for storage; both fields are sent over the wire
      // as-collected.
      const trimmedFirst = String(input.firstName || "").trim();
      const trimmedLast = String(input.lastName || "").trim();
      if (!trimmedFirst || !trimmedLast) {
        return { success: false, error: "First name and last name are required." };
      }

      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/create-walkin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          bookingId,
          // Per NBS-2026-08-08 (F1): the optional
          // client-preallocated `reservationId` for
          // reservation-level idempotency. The server's
          // `WalkinBookingSchema` already accepts the
          // field (decision #164 / MRB-02.x); the
          // auto-mint path stays as the back-compat
          // default for any caller that does not
          // preallocate.
          ...(reservationId ? { reservationId } : {}),
          roomId: input.roomId,
          // Per MRB-07 (2026-08-02, per decision #159): the New Booking
          // modal can create a reservation covering N rooms. When
          // present this is the canonical room list — the server prices
          // each room against its own type and writes one booking doc
          // per room under one reservation header. Omitted for a
          // single-room booking, which keeps the historical body shape.
          ...(input.rooms && input.rooms.length > 1 ? { rooms: input.rooms } : {}),
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          guests: input.numGuests,
          // Per CHD-01 + EXB-01: the desk's adult/child split and
          // extra-bed count. These were collected by the modal but not
          // forwarded, so the server fell back to "all adults, no extra
          // beds" and priced every staff-created booking without them.
          numAdults: input.numAdults,
          numChildren: input.numChildren,
          extraBedCount: input.extraBedCount,
          hasBreakfast: input.hasBreakfast,
          guestDetails: {
            firstName: trimmedFirst,
            lastName: trimmedLast,
            email: input.guestEmail,
            phone: input.guestPhone,
            requests: input.specialRequests
          },
          paymentMethod: input.paymentMethod,
          status: input.status,
          totalPriceOverride: input.totalPriceOverride,
          discountType: input.discountType,
          voucherCode: input.voucherCode,
          testRunId: (input as any).testRunId || null
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to create walk-in booking." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error creating walkin booking:", err);
      return { success: false, error: err.message };
    }
  };

  const resendBookingEmail = async (bookingId: string, action: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/email/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || `Failed to resend email trigger ${action}.` };
      }
      return { success: true };
    } catch (err: any) {
      console.error(`Error resending email trigger ${action}:`, err);
      return { success: false, error: err.message };
    }
  };

  // Per Phase 12 — Dashboard Payment Rejection & Reference
  // Verification (2026-07-15). Bounces a `payment-uploaded`
  // booking back to `pending` via
  // `/api/bookings/reject-payment`. The server emails the
  // guest + writes a `payment` notification; the local
  // `bookings` snapshot updates via the existing
  // `onSnapshot` listener so the dashboard card flips to
  // `pending` on the next frame.
  const verifyAndRecordPayment = async (
    bookingId: string,
    paymentId: string,
    amount: number,
    method: string,
    transactionReference?: string,
    note?: string
  ): Promise<{ success: boolean; error?: string; siblingFlippedCount?: number }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/verify-and-record-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId, paymentId, amount, method, transactionReference, note })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to verify and record payment." };
      }
      // Per FOL-05 (2026-08-07, per decision #201): surface
      // the server-computed sibling-flip count to the admin
      // UI so the dashboard's per-room coverage preview can
      // mirror what the server actually cleared. Falls back
      // to 0 when the server is pre-FOL-05 (no field) so the
      // admin app stays forward-compatible.
      const siblingFlippedCount = typeof data?.data?.siblingFlippedCount === "number"
        ? data.data.siblingFlippedCount
        : 0;
      return { success: true, siblingFlippedCount };
    } catch (err: any) {
      console.error("Error verifying and recording payment:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  const rejectPayment = async (bookingId: string, reason: string): Promise<{ success: boolean; error?: string; siblingRejectedCount?: number }> => {
    const safeReason = String(reason || "").trim().slice(0, 500);
    if (!safeReason) {
      return { success: false, error: "A rejection reason is required so the guest can fix the issue." };
    }
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/reject-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId, reason: safeReason })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to reject payment." };
      }
      // Per FOL-05 (2026-08-07, per decision #201): surface
      // the server-computed sibling-rejection count to the
      // admin UI for symmetry with the verify path. Falls
      // back to 0 when the server is pre-FOL-05 (no field).
      const siblingRejectedCount = typeof data?.data?.siblingRejectedCount === "number"
        ? data.data.siblingRejectedCount
        : 0;
      return { success: true, siblingRejectedCount };
    } catch (err: any) {
      console.error("Error rejecting payment:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  // Per LOW-1 (reports audit 2026-08-10) +
  // `DECISIONS-FEATURES.md #99` (LOU workflow):
  // the staff-toggled LOU (Letter of Undertaking) flag
  // for corporate chargeback bookings. The desk calls
  // this when the company's LOU arrives by email
  // (per `plan/features/CORPORATE-BOOKING.md` §LOU).
  // The server stamps `louReceived` +
  // `louReceivedAt` + `louReceivedBy` on the booking
  // doc and the receivables widget picks up the
  // change via the standard onSnapshot subscription.
  // Un-marking is supported (pass `false`) so the
  // rare "we marked it but the company withdrew"
  // case is reversible.
  const setLouReceived = async (bookingId: string, louReceived: boolean): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/set-lou-received`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId, louReceived })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to update the LOU flag." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error setting LOU flag:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  // Per CWB-01 / decision #122 (2026-07-23): staff-triggered
  // confirm-with-balance transition. Server is the source of
  // truth for the threshold + role check; on 403 the response
  // carries `thresholdExceeded: true` so the form can surface
  // the structured message without re-deriving it.
  const confirmBookingWithBalance = async (bookingId: string, reason: string): Promise<{ success: boolean; error?: string; thresholdExceeded?: boolean; threshold?: number; balance?: number }> => {
    const safeReason = String(reason || "").trim().slice(0, 500);
    if (!safeReason) {
      return { success: false, error: "A reason is required when confirming a booking with a balance owed." };
    }
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/confirm-with-balance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId, reason: safeReason })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return {
          success: false,
          error: data.error || "Failed to confirm with balance.",
          thresholdExceeded: Boolean(data.thresholdExceeded),
          threshold: typeof data.threshold === "number" ? data.threshold : undefined,
          balance: typeof data.balance === "number" ? data.balance : undefined
        };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error confirming with balance:", err);
      return { success: false, error: err.message || "An unexpected error occurred." };
    }
  };

  // Vouchers — live from Firestore
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [vouchersLoading, setVouchersLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setVouchers([]);
      setVouchersLoading(true);
      return;
    }
    setVouchersLoading(true);
    const vouchersRef = collection(db, "vouchers");
    const unsubscribe = onSnapshot(
      vouchersRef,
      (snapshot) => {
        const voucherData: Voucher[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          voucherData.push({
            id: docSnap.id,
            code: data.code || "",
            discountType: data.discountType || "flat",
            discountValue: data.discountValue || 0,
            usageCap: data.usageCap ?? null,
            usageCount: data.usageCount || 0,
            expiresAt: data.expiresAt ? (typeof data.expiresAt.toDate === "function" ? data.expiresAt.toDate().toISOString() : String(data.expiresAt)) : null,
            applicableRoomTypes: data.applicableRoomTypes || [],
            isActive: data.isActive !== false,
            createdBy: data.createdBy || "",
            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : "",
            guestEmail: data.guestEmail || null,
          });
        });

        voucherData.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setVouchers(voucherData);
        setVouchersLoading(false);
      },
      (error) => {
        console.error("Error listening to vouchers collection:", error);
        setVouchersLoading(false);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const addVoucher = async (voucher: Omit<Voucher, "id" | "createdAt" | "usageCount">): Promise<{ success: boolean; error?: string }> => {
    try {
      const staff = currentUser;
      const voucherCode = voucher.code.trim().toUpperCase();
      const legacyDuplicate = await getDocs(query(collection(db, "vouchers"), where("code", "==", voucherCode)));
      if (!legacyDuplicate.empty) {
        return { success: false, error: "Voucher code already exists. Choose a different code." };
      }
      const voucherRef = doc(db, "vouchers", voucherCode);
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(voucherRef);
        if (existing.exists()) {
          throw new Error("Voucher code already exists. Choose a different code.");
        }
        transaction.set(voucherRef, {
          ...voucher,
          code: voucherCode,
          usageCount: 0,
          createdBy: staff?.uid || "unknown",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      // Per W4.4 / decision #104: when a voucher is issued with
      // a non-empty guestEmail, fire the voucher-issued email so
      // the guest knows the code. The server validates the email
      // + room types and renders the template; the client cannot
      // override the recipient.
      if (voucher.guestEmail && voucher.guestEmail.trim()) {
        try {
          const token = await auth.currentUser?.getIdToken(true);
          await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/email/voucher-issued`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": token ? `Bearer ${token}` : ""
            },
            body: JSON.stringify({
              voucher: {
                code: voucherCode,
                discountType: voucher.discountType,
                discountValue: voucher.discountValue,
                expiresAt: voucher.expiresAt,
                applicableRoomTypes: voucher.applicableRoomTypes || [],
                guestEmail: voucher.guestEmail
              }
            })
          });
        } catch (emailErr) {
          console.error("Failed to send voucher-issued email:", emailErr);
        }
      }
      return { success: true };
    } catch (error) {
      console.error("Error adding voucher:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to add voucher." };
    }
  };

  const toggleVoucherActive = async (voucherId: string) => {
    try {
      const vchRef = doc(db, "vouchers", voucherId);
      const vch = vouchers.find(v => v.id === voucherId);
      if (vch) {
        await updateDoc(vchRef, { isActive: !vch.isActive, updatedAt: serverTimestamp() });
      }
    } catch (error) {
      console.error("Error toggling voucher active:", error);
    }
  };

  const updateVoucher = async (
    voucherId: string,
    voucher: Omit<Voucher, "id" | "code" | "createdAt" | "createdBy" | "usageCount">
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await updateDoc(doc(db, "vouchers", voucherId), {
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        usageCap: voucher.usageCap,
        expiresAt: voucher.expiresAt,
        applicableRoomTypes: voucher.applicableRoomTypes,
        isActive: voucher.isActive,
        guestEmail: voucher.guestEmail,
        updatedAt: serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      console.error("Error updating voucher:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to update voucher." };
    }
  };

  // Corporate Codes — live from Firestore
  const [corporateCodes, setCorporateCodes] = useState<CorporateCode[]>([]);

  useEffect(() => {
    if (!currentUser) return;
    const corpCodesRef = collection(db, "corporateCodes");
    const unsubscribe = onSnapshot(
      corpCodesRef,
      (snapshot) => {
        const codes: CorporateCode[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          codes.push({
            code: docSnap.id,
            companyName: data.companyName || "",
            ratePerRoomType: data.ratePerRoomType || {},
            expiresAt: data.expiresAt ? (typeof data.expiresAt.toDate === "function" ? data.expiresAt.toDate().toISOString() : String(data.expiresAt)) : null,
            usageCap: data.usageCap ?? null,
            usageCount: data.usageCount || 0,
            linkedInquiryId: data.linkedInquiryId || "",
            createdBy: data.createdBy || "",
            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : "",
            isActive: data.isActive !== false,
          });
        });

        codes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setCorporateCodes(codes);
      },
      (error) => {
        console.error("Error listening to corporateCodes collection:", error);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const addCorporateCode = async (code: CorporateCode): Promise<{ success: boolean; error?: string }> => {
    try {
      const { code: codeValue, ...rest } = code;
      const codeRef = doc(db, "corporateCodes", codeValue);
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(codeRef);
        if (existing.exists()) {
          throw new Error("Corporate code already exists. Choose a different code.");
        }
        transaction.set(codeRef, {
          ...rest,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      return { success: true };
    } catch (error) {
      console.error("Error adding corporate code:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to add corporate code." };
    }
  };

  const toggleCorporateCodeActive = async (code: string) => {
    try {
      const codeRef = doc(db, "corporateCodes", code);
      const existing = corporateCodes.find(c => c.code === code);
      if (existing) {
        await updateDoc(codeRef, { isActive: !existing.isActive, updatedAt: serverTimestamp() });
      }
    } catch (error) {
      console.error("Error toggling corporate code active:", error);
    }
  };

  const updateCorporateCode = async (
    code: string,
    updates: Omit<CorporateCode, "code" | "createdAt" | "createdBy" | "usageCount" | "linkedInquiryId">
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await updateDoc(doc(db, "corporateCodes", code), {
        companyName: updates.companyName,
        ratePerRoomType: updates.ratePerRoomType,
        expiresAt: updates.expiresAt,
        usageCap: updates.usageCap,
        isActive: updates.isActive,
        updatedAt: serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      console.error("Error updating corporate code:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to update corporate code." };
    }
  };

  const deleteCorporateCode = async (code: string) => {
    try {
      await deleteDoc(doc(db, "corporateCodes", code));
    } catch (error) {
      console.error("Error deleting corporate code:", error);
    }
  };

  // Corporate Inquiries — live from Firestore
  const [corporateInquiries, setCorporateInquiries] = useState<CorporateInquiry[]>([]);

  useEffect(() => {
    if (!currentUser) return;
    const inquiriesRef = collection(db, "corporateInquiries");
    const unsubscribe = onSnapshot(
      inquiriesRef,
      (snapshot) => {
        const inquiries: CorporateInquiry[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          inquiries.push({
            id: docSnap.id,
            companyName: data.companyName || "",
            contactPerson: data.contactPerson || "",
            email: data.email || "",
            phone: data.phone || "",
            numRooms: data.numRooms || 0,
            // C-03 (E2E audit 2026-07-17): normalize legacy string
            // records and nulls to structured { from, to } shape.
            preferredDates: !data.preferredDates
              ? { from: "", to: "" }
              : typeof data.preferredDates === "string"
                ? (() => {
                    const parts = data.preferredDates.split(" to ");
                    return { from: parts[0] || data.preferredDates, to: parts[1] || "" };
                  })()
                : data.preferredDates,
            specialRequirements: data.specialRequirements || "",
            status: data.status || "new",
            handler: data.handler || "",
            notes: data.notes || [],
            accessCodeId: data.accessCodeId || "",
            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : "",
          });
        });

        inquiries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setCorporateInquiries(inquiries);
      },
      (error) => {
        console.error("Error listening to corporateInquiries collection:", error);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const updateInquiryStatus = async (inquiryId: string, status: CorporateInquiry["status"]) => {
    try {
      await updateDoc(doc(db, "corporateInquiries", inquiryId), {
        status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating inquiry status:", error);
    }
  };

  const addInquiryNote = async (inquiryId: string, text: string) => {
    try {
      const inquiryRef = doc(db, "corporateInquiries", inquiryId);
      const staffLabel = staff.find((member) => member.uid === currentUser?.uid)?.fullName
        || currentUser?.email?.split("@")[0]
        || "Staff";
      const newNote = { text, by: staffLabel, at: new Date().toISOString() };
      await updateDoc(inquiryRef, {
        notes: arrayUnion(newNote),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error adding inquiry note:", error);
    }
  };

  // Per W2.14 / decision #102 / audit S4.2: convert a corporate
  // inquiry into a real bookings document via the server-side
  // /api/corporate/convert-inquiry route. The handler is
  // staff-only, transactionally creates the booking with
  // linkedInquiryId + isCorporate (server-derived) + source:
  // "corporate", flips the inquiry status to "converted", and
  // appends a back-link note. We pre-allocate the bookingId
  // here so the booking is at a known doc id.
  const convertInquiryToBooking = async (input: {
    inquiryId: string;
    roomId: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    hasBreakfast: boolean;
    paymentMethod: string;
    ratePerNightOverride?: number | null;
  }): Promise<{ success: boolean; error?: string; bookingId?: string; bookingRef?: string; totalPrice?: number }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const bookingId = doc(collection(db, "bookings")).id;
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/corporate/convert-inquiry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          inquiryId: input.inquiryId,
          bookingId,
          roomId: input.roomId,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          guests: input.guests,
          hasBreakfast: input.hasBreakfast,
          paymentMethod: input.paymentMethod,
          ratePerNightOverride: input.ratePerNightOverride ?? null
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        return { success: false, error: data?.error || "Failed to convert inquiry into a booking." };
      }
      return {
        success: true,
        bookingId: data.data?.bookingId || bookingId,
        bookingRef: data.data?.bookingRef,
        totalPrice: data.data?.totalPrice
      };
    } catch (err: any) {
      console.error("Convert inquiry failed:", err);
      return { success: false, error: err?.message || "Failed to convert inquiry into a booking." };
    }
  };

  // Members Data State
  // Per W1.12 / decision #85: real `onSnapshot` listener on the `members`
  // collection. Replaces the hardcoded `useState<Member[]>([fake entry])`
  // mock that hid all real members from the admin UI. Cleanup on unmount.
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    if (!currentUser) return;
    const membersRef = collection(db, "members");
    const unsubscribe = onSnapshot(
      membersRef,
      (snapshot) => {
        const membersData: Member[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          membersData.push({
            id: doc.id,
            memberNumber: data.memberNumber || "",
            fullName: data.fullName || "",
            email: data.email || "",
            phone: data.phone || "",
            photoUrl: data.photoUrl || "",
            authProvider: data.authProvider || "email",
            isMember: data.isMember !== false,
            memberSince: data.memberSince || "",
            rewardsPoints: data.rewardsPoints || 0,
            tier: data.tier || "standard",
            isActive: data.isActive !== false,
            pointsHistory: data.pointsHistory || []
          });
        });
        // Sort by member number for stable display
        membersData.sort((a, b) => a.memberNumber.localeCompare(b.memberNumber));
        setMembers(membersData);
      },
      (error) => {
        console.error("Error listening to members collection:", error);
      }
    );
    return unsubscribe;
  }, [currentUser]);

  const updateMemberPoints = async (
    memberId: string,
    amount: number,
    type: PointsLog["type"],
    reason: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser) {
      return { success: false, error: "Sign in before adjusting member points." };
    }
    if (!Number.isFinite(amount) || amount === 0) {
      return { success: false, error: "Enter a non-zero points adjustment." };
    }
    if (!reason.trim()) {
      return { success: false, error: "A reason is required for points adjustments." };
    }
    // Per Spark Rewards audit 2026-07-18 MED-1: manual points
    // adjustment now lives server-side (Admin SDK). The server
    // `runTransaction` couples the `rewardsPoints` write with a
    // `pointsHistory` entry in a single commit, and the Firestore
    // rule drops `rewardsPoints` from the staff update allowlist
    // so the only way to mutate a member's balance is through the
    // /api/members/* endpoint set. The `type` parameter is kept
    // on the client for backward-compat with the existing UI but
    // the server hardcodes `type: "manual"` (no client can inject
    // an "earn" / "redeem" row through this path).
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/members/manual-adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ memberId, amount, reason })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        return { success: false, error: data?.error || "Failed to adjust member points." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error adjusting member points:", err);
      return { success: false, error: err?.message || "Failed to adjust member points." };
    }
  };

  const toggleMemberActive = async (memberId: string, isActive: boolean): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/members/set-active`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ uid: memberId, isActive })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to update member account status." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error updating member account status:", err);
      return { success: false, error: err?.message || "Failed to update member account status." };
    }
  };

  // Per Spark Rewards audit 2026-07-18 MED-3 (decision #135):
  // front-desk manual link of an existing booking to a member when
  // the member's account email differs from the email on an earlier
  // anonymous booking. Admin-only on the server (the rate limit +
  // role gate are server-enforced; this client just forwards the
  // ID token). Returns `alreadyLinked: true` when the booking is
  // already linked to this member (idempotent re-link) so the UI
  // can show a softer "already linked" message instead of a
  // success toast that looks like a new action.
  const linkBookingToMember = async (
    memberUid: string,
    bookingId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string; alreadyLinked?: boolean; bookingRef?: string }> => {
    if (!currentUser) {
      return { success: false, error: "Sign in before linking a booking to a member." };
    }
    if (!memberUid?.trim() || !bookingId?.trim()) {
      return { success: false, error: "Both a member and a booking are required." };
    }
    if (!reason.trim()) {
      return { success: false, error: "A reason is required for booking links." };
    }
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/members/link-booking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ memberUid, bookingId, reason })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        return { success: false, error: data?.error || "Failed to link booking to member." };
      }
      return {
        success: true,
        alreadyLinked: Boolean(data?.data?.alreadyLinked),
        bookingRef: data?.data?.bookingRef
      };
    } catch (err: any) {
      console.error("Error linking booking to member:", err);
      return { success: false, error: err?.message || "Failed to link booking to member." };
    }
  };

  // Intercom log (inbox) state — live from Firestore, keyed by room number
  const [intercoms, setIntercoms] = useState<Record<string, IntercomMessage[]>>({});
  const [intercomThreads, setIntercomThreads] = useState<Record<string, IntercomThread>>({});

  // Audio Notifications State
  const [soundsEnabled, setSoundsEnabledState] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("staybase_admin_sounds_enabled") !== "false";
    }
    return true;
  });
  const soundsEnabledRef = useRef(soundsEnabled);
  useEffect(() => {
    soundsEnabledRef.current = soundsEnabled;
  }, [soundsEnabled]);

  const setSoundsEnabled = useCallback((enabled: boolean) => {
    setSoundsEnabledState(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem("staybase_admin_sounds_enabled", String(enabled));
    }
  }, []);

  const isLoadedRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      isLoadedRef.current = true;
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlockAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === "suspended") {
        void audioContextRef.current.resume();
      }
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  const playSynthNotification = useCallback((type: "booking" | "payment" | "message" | "arrival" | "departure") => {
    if (!soundsEnabledRef.current) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const now = ctx.currentTime;

      if (type === "message") {
        const notes = [1567.98, 2093.00, 1567.98, 2093.00];
        notes.forEach((freq, index) => {
          const start = now + index * 0.14;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.09, start);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.12);
        });
      } else if (type === "booking") {
        const notes = [261.63, 329.63, 392.00, 523.25];
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, now + index * 0.12);
          gain.gain.setValueAtTime(0.1, now + index * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + index * 0.12);
          osc.stop(now + index * 0.12 + 0.3);
        });
      } else if (type === "payment") {
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(659.25, now);
        gain1.gain.setValueAtTime(0.1, now);
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.25);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(440.00, now + 0.15);
        gain2.gain.setValueAtTime(0.1, now + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.15 + 0.35);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.15 + 0.35);
      } else if (type === "arrival") {
        const notes = [698.46, 880.00];
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + index * 0.1);
          gain.gain.setValueAtTime(0.08, now + index * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.1 + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + index * 0.1);
          osc.stop(now + index * 0.1 + 0.25);
        });
      } else if (type === "departure") {
        const notes = [880.00, 698.46];
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + index * 0.1);
          gain.gain.setValueAtTime(0.08, now + index * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.1 + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + index * 0.1);
          osc.stop(now + index * 0.1 + 0.25);
        });
      }
    } catch (e) {
      console.warn("Failed to play synth notification audio:", e);
    }
  }, []);

  const unreadIntercomCount = useMemo(() => {
    return Object.values(intercoms).reduce((count, messages) => {
      const guestUnread = messages.filter((m) => m.sender === "guest" && !m.isRead);
      return count + guestUnread.length;
    }, 0);
  }, [intercoms]);

  const formatIntercomTimestamp = (value: any) => {
    if (!value) return "";
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(config.locale, { hour: "2-digit", minute: "2-digit" });
  };

  useEffect(() => {
    if (!currentUser) {
      setIntercomThreads({});
      return;
    }
    const unsubscribe = onSnapshot(
      collection(db, "intercoms"),
      (snapshot) => {
        const threads: Record<string, IntercomThread> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const roomNumber = data.roomNumber || docSnap.id;
          threads[roomNumber] = {
            roomId: data.roomId || docSnap.id,
            roomNumber,
            guestName: data.guestName || "",
            resolved: !!data.resolved,
            updatedAt: formatIntercomTimestamp(data.updatedAt),
            currentStayId: data.currentStayId || undefined
          };
        });
        setIntercomThreads(threads);
      },
      (error) => {
        console.error("Error listening to intercom thread metadata:", error);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setIntercoms({});
      return;
    }
    const roomNumbers = rooms.map((room) => room.roomNumber).filter(Boolean);
    if (roomNumbers.length === 0) {
      setIntercoms({});
      return;
    }

    const unsubscribes = roomNumbers.map((roomNumber) => {
      const messagesQuery = query(
        collection(db, "intercoms", roomNumber, "messages"),
        orderBy("timestamp", "asc")
      );

      return onSnapshot(
        messagesQuery,
        (snapshot) => {
          const messages: IntercomMessage[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              text: data.text || "",
              sender: data.sender || "guest",
              guestName: data.guestName || "",
              timestamp: formatIntercomTimestamp(data.timestamp),
              isRead: !!data.isRead,
              isQuickRequest: !!data.isQuickRequest,
              isStoreOrder: !!data.isStoreOrder,
              orderRef: data.orderRef || undefined,
              isEarlyCheckInRequest: !!data.isEarlyCheckInRequest,
              currentStayId: data.currentStayId || undefined
            };
          });

          setIntercoms((prev) => {
            if (isLoadedRef.current) {
              const prevMsgs = prev[roomNumber] || [];
              const prevIds = new Set(prevMsgs.map((m) => m.id));
              const hasNewGuestMsg = messages.some((m) => 
                m.sender === "guest" && !m.isRead && !prevIds.has(m.id)
              );
              if (hasNewGuestMsg) {
                playSynthNotification("message");
              }
            }

            if (messages.length === 0) {
              const { [roomNumber]: _removed, ...rest } = prev;
              return rest;
            }
            return { ...prev, [roomNumber]: messages };
          });
        },
        (error) => {
          console.error(`Error listening to intercom messages for room ${roomNumber}:`, error);
        }
      );
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [rooms, currentUser]);

  const sendIntercomMessage = async (roomId: string, text: string, sender: "guest" | "front-desk" = "front-desk") => {
    try {
      await setDoc(doc(db, "intercoms", roomId), {
        roomId,
        roomNumber: roomId,
        currentStayId: intercomThreads[roomId]?.currentStayId || null,
        resolved: false,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await addDoc(collection(db, "intercoms", roomId, "messages"), {
        text,
        sender,
        guestName: sender === "guest" ? "Guest" : "Front Desk",
        timestamp: serverTimestamp(),
        isRead: sender === "front-desk",
        isQuickRequest: false,
        isStoreOrder: false,
        isEarlyCheckInRequest: false,
        currentStayId: intercomThreads[roomId]?.currentStayId || null
      });
    } catch (error) {
      console.error("Error sending intercom message:", error);
    }
  };

  const markChatAsRead = async (roomId: string) => {
    const unreadGuestMessages = (intercoms[roomId] || []).filter((message) => message.sender === "guest" && !message.isRead);
    if (unreadGuestMessages.length === 0) return;

    try {
      await Promise.all(
        unreadGuestMessages.map((message) =>
          updateDoc(doc(db, "intercoms", roomId, "messages", message.id), {
            isRead: true
          })
        )
      );
    } catch (error) {
      console.error("Error marking intercom messages as read:", error);
    }
  };

  const setIntercomResolved = async (roomId: string, resolved: boolean) => {
    if (!roomId) return;

    try {
      await setDoc(doc(db, "intercoms", roomId), {
        roomId,
        roomNumber: roomId,
        resolved,
        resolvedAt: resolved ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Error updating intercom resolved status:", error);
    }
  };

  // Call Signaling state — live from Firestore calls/{roomId}
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const ringtoneIntervalIdRef = useRef<any>(null);
  // Per `plan/features/INTERCOM-AUDIO-ROUTING.md`: the call ringtone
  // (the looping double trill before the staff answers) is rendered
  // once to a WAV Blob and played through a hidden `<audio>` element
  // so the staff's `ringtoneOutputDeviceId` (typically the built-in
  // speaker) is honoured via `setSinkId`. Pre-rendering once and
  // re-seeking on each interval is cheaper than rebuilding the
  // oscillator graph every 3 s and routes the same sound that the
  // previous Web Audio API tree produced.
  const ringtoneAudioUrlRef = useRef<string | null>(null);
  const ringtoneAudioElRef = useRef<HTMLAudioElement | null>(null);

  const stopCallRingtone = useCallback(() => {
    if (ringtoneIntervalIdRef.current) {
      clearInterval(ringtoneIntervalIdRef.current);
      ringtoneIntervalIdRef.current = null;
    }
    const audio = ringtoneAudioElRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const playCallRingtone = useCallback(async () => {
    if (!soundsEnabledRef.current) return;
    try {
      const url = await renderRingtoneWav();
      if (!url) return;
      let audio = ringtoneAudioElRef.current;
      if (!audio) {
        audio = new Audio(url);
        audio.preload = "auto";
        ringtoneAudioElRef.current = audio;
        // Pin to the staff's chosen ringtone output device. No-op when
        // routing is disabled or the runtime doesn't support setSinkId.
        void audioRoutingState.applyToElement(audio, "ringtone").catch(() => undefined);
      }
      try {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      } catch {
        // Some browsers throw when the source isn't fully buffered yet;
        // the next interval tick will retry with the same element.
      }
    } catch (e) {
      console.warn("Failed to play ringtone audio:", e);
    }
  }, [renderRingtoneWav, audioRoutingState]);

  // Re-route the call ringtone element when the routing preference
  // changes (e.g. operator picks a new ringtone device).
  useEffect(() => {
    const audio = ringtoneAudioElRef.current;
    if (!audio) return;
    void audioRoutingState.applyToElement(audio, "ringtone").catch(() => undefined);
  }, [audioRoutingState.routing, audioRoutingState]);

  useEffect(() => {
    const isRinging = incomingCall?.status === "ringing";
    if (isRinging && soundsEnabled) {
      if (!ringtoneIntervalIdRef.current) {
        void playCallRingtone();
        ringtoneIntervalIdRef.current = setInterval(() => {
          void playCallRingtone();
        }, 3000);
      }
    } else {
      stopCallRingtone();
    }

    return () => {
      stopCallRingtone();
    };
  }, [incomingCall?.status, soundsEnabled, playCallRingtone, stopCallRingtone]);

  const adminPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const adminMediaStreamRef = useRef<MediaStream | null>(null);
  const adminRemoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const adminIceUnsubscribeRef = useRef<(() => void) | null>(null);
  const adminProcessedIceIdsRef = useRef<Set<string>>(new Set());
  const adminPreviousCallRoomIdRef = useRef<string | null>(null);

  const cleanupAdminCall = () => {
    adminIceUnsubscribeRef.current?.();
    adminIceUnsubscribeRef.current = null;
    adminProcessedIceIdsRef.current.clear();
    adminPeerConnectionRef.current?.close();
    adminPeerConnectionRef.current = null;
    adminMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    adminMediaStreamRef.current = null;
    if (adminRemoteAudioRef.current) {
      adminRemoteAudioRef.current.pause();
      adminRemoteAudioRef.current.srcObject = null;
      adminRemoteAudioRef.current = null;
    }
  };

  useEffect(() => {
    if (!currentUser) {
      setIncomingCall(null);
      cleanupAdminCall();
      adminPreviousCallRoomIdRef.current = null;
      return;
    }
    const unsubscribe = onSnapshot(
      collection(db, "calls"),
      (snapshot) => {
        const activeCalls = snapshot.docs
          .map((docSnap): IncomingCall & { startedAt: number } => {
            const data = docSnap.data();
            return {
              roomId: docSnap.id,
              guestName: data.guestName || "Guest",
              status: data.status || "ended",
              offer: data.offer || undefined,
              startedAt: data.startedAt?.toMillis ? data.startedAt.toMillis() : 0
            };
          })
          .filter((call) =>
            (call.status === "ringing" || call.status === "active") && !!call.roomId
          )
          .sort((a, b) => b.startedAt - a.startedAt);

        const nextCall = activeCalls[0] || null;
        // Per W2.6 / decision #94: "second wins" — if a new active
        // call arrives while a previous one was being shown, write
        // status: "ended" to the old call doc so the previous guest's
        // UI sees the call end via its snapshot listener. The new
        // call is the only one shown in the inbox.
        const previousRoomId = adminPreviousCallRoomIdRef.current;
        if (nextCall && previousRoomId && nextCall.roomId !== previousRoomId) {
          void updateDoc(doc(db, "calls", previousRoomId), {
            status: "ended",
            endedAt: serverTimestamp(),
            endedReason: "superseded-by-other-call"
          }).catch((err) => {
            console.error("Error ending superseded call:", err);
          });
          cleanupAdminCall();
        }
        adminPreviousCallRoomIdRef.current = nextCall?.roomId ?? null;
        setIncomingCall(nextCall);
        if (!nextCall) {
          cleanupAdminCall();
          adminPreviousCallRoomIdRef.current = null;
        }
      },
      (error) => {
        console.error("Error listening to WebRTC calls:", error);
      }
    );

    return () => {
      unsubscribe();
      cleanupAdminCall();
    };
  }, [currentUser]);

  const triggerIncomingCall = async (roomId: string, guestName: string) => {
    if (!roomId) return;
    await setDoc(doc(db, "calls", roomId), {
      answer: null,
      status: "ringing",
      guestName,
      startedAt: serverTimestamp(),
      endedAt: null
    }, { merge: true });
  };

  const acceptCall = async () => {
    if (!incomingCall) return;

    try {
      const callRef = doc(db, "calls", incomingCall.roomId);

      if (!incomingCall.offer) {
        await updateDoc(callRef, {
          status: "active",
          endedAt: null
        });
        return;
      }

      cleanupAdminCall();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      adminMediaStreamRef.current = stream;

      const peerConnection = new RTCPeerConnection(rtcConfiguration);
      adminPeerConnectionRef.current = peerConnection;
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate) return;
        void addDoc(collection(db, "calls", incomingCall.roomId, "iceCandidates"), {
          candidate: event.candidate.toJSON(),
          from: "staff",
          createdAt: serverTimestamp()
        });
      };
      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        const remoteAudio = adminRemoteAudioRef.current ?? new Audio();
        remoteAudio.autoplay = true;
        remoteAudio.srcObject = remoteStream;
        adminRemoteAudioRef.current = remoteAudio;
        // Pin the remote stream to the staff's chosen call output device
        // (typically a USB headset). `applyAudioSink` is a no-op when
        // audio routing is disabled or the runtime doesn't support
        // setSinkId, so the call still works on the default output.
        void audioRoutingState.applyToElement(remoteAudio, "call").catch(() => undefined);
        void remoteAudio.play().catch(() => {
          // Browser autoplay policy can still require staff interaction.
        });
      };

      await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      adminIceUnsubscribeRef.current = onSnapshot(
        collection(db, "calls", incomingCall.roomId, "iceCandidates"),
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const data = change.doc.data();
            if (data.from !== "guest" || adminProcessedIceIdsRef.current.has(change.doc.id)) return;
            adminProcessedIceIdsRef.current.add(change.doc.id);
            if (data.candidate) {
              void peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
          });
        }
      );

      await updateDoc(callRef, {
        answer: {
          type: answer.type,
          sdp: answer.sdp
        },
        status: "active",
        endedAt: null
      });
    } catch (error) {
      console.error("Error accepting WebRTC call:", error);
      cleanupAdminCall();
      await updateDoc(doc(db, "calls", incomingCall.roomId), {
        status: "ended",
        endedAt: serverTimestamp()
      });
    }
  };

  const declineCall = async () => {
    if (!incomingCall) return;
    cleanupAdminCall();
    await updateDoc(doc(db, "calls", incomingCall.roomId), {
      status: "ended",
      endedAt: serverTimestamp()
    });
  };

  // ── Notification Center (Phase 12 — decision #120) ──────────
  // Live `onSnapshot` on `notifications`, bounded to the most
  // recent 50 docs. Merges with the existing live-derived
  // unread guest-message count from the `intercoms` listener
  // (B1) so the bell badge sums both sources. The retention
  // cron (`/api/notifications/prune`) hard-deletes docs
  // older than 30 days so the collection stays bounded.
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      setNotificationsLoading(true);
      return;
    }
    setNotificationsLoading(true);
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Per MRB-15-09 (force-refresh pattern for staff-gated
    // listeners): the `notifications` collection is
    // `isStaff()`-gated, which reads the `role` custom
    // claim. The Firestore SDK uses its OWN cached ID
    // token for the listener handshake — if the cache is
    // one refresh behind the auth-state callback's
    // token (a long-idle session, a fresh tab, or a
    // just-minted role claim), the listener attaches with
    // a stale token and `Missing or insufficient
    // permissions` silently empties the bell badge.
    // `getIdToken(true)` is idempotent — returns the
    // cached token if fresh, exchanges the refresh token
    // if stale. The `await` (via `.then`) makes the
    // listener attach AFTER the refresh. The `cancelled`
    // flag handles the unmount-mid-refresh race.
    void auth.currentUser?.getIdToken(true).then(() => {
      if (cancelled) return;
      // Bounded query — never the whole collection. Firestore
      // requires an `orderBy` on the same field as any range
      // filter; the retention cron reads with a range filter
      // and orders ascending (see guest-app/server/lib/
      // notifications.ts). The composite index `(createdAt
      // desc)` is the only one this listener needs.
      const notifRef = collection(db, "notifications");
      const notifQuery = query(notifRef, orderBy("createdAt", "desc"), limit(50));
      unsubscribe = onSnapshot(
        notifQuery,
        (snapshot) => {
          const docs: Notification[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            const readBy: Record<string, Date | null> = {};
            if (data.readBy && typeof data.readBy === "object") {
              Object.entries(data.readBy).forEach(([uid, ts]) => {
                if (ts && typeof (ts as any).toDate === "function") {
                  readBy[uid] = (ts as any).toDate();
                } else if (ts instanceof Date) {
                  readBy[uid] = ts;
                } else if (ts === null) {
                  readBy[uid] = null;
                } else {
                  readBy[uid] = null;
                }
              });
            }
            return {
              id: docSnap.id,
              type: (data.type as NotificationType) || "booking",
              title: String(data.title || ""),
              entityType: data.entityType || "booking",
              entityId: String(data.entityId || ""),
              roomNumber: data.roomNumber || null,
              bookingRef: data.bookingRef || null,
              readBy,
              createdBy: "system",
              createdAt: data.createdAt && typeof (data.createdAt as any).toDate === "function"
                ? (data.createdAt as any).toDate()
                : new Date(0)
            };
          });
          setNotifications(docs);
          setNotificationsLoading(false);
        },
        (error) => {
          console.error("Error listening to notifications collection:", error);
          setNotificationsLoading(false);
        }
      );
    }).catch((refreshErr) => {
      // The refresh itself failed (e.g. network down or
      // refresh-token revoked). Don't block the operator
      // from seeing the rest of the dashboard — just log
      // and let the next user interaction retry.
      console.error("Failed to force-refresh ID token for notifications listener:", refreshErr);
      setNotificationsLoading(false);
    });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser]);

  const unreadNotificationCount = useMemo(() => {
    if (!currentUser) return 0;
    const myUid = currentUser.uid;
    return notifications.reduce((count, n) => {
      return !n.readBy[myUid] ? count + 1 : count;
    }, 0);
  }, [notifications, currentUser]);

  // Per Phase 12 — Notification Center (decision #120):
  // best-effort client-side mark-read. The Firestore rule
  // restricts updates to the `readBy` field only, so a
  // single-field `updateDoc` is the only legal write from
  // the client. Failures are logged + swallowed — the bell
  // re-renders on the next snapshot, so a missed write just
  // shows the entry as unread for one more tick.
  const markNotificationRead = useCallback(async (notificationId: string) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, "notifications", notificationId), {
        [`readBy.${currentUser.uid}`]: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to mark notification read:", err);
    }
  }, [currentUser]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!currentUser) return;
    const myUid = currentUser.uid;
    const unread = notifications.filter((n) => !n.readBy[myUid]);
    if (unread.length === 0) return;
    try {
      await Promise.all(unread.map((n) =>
        updateDoc(doc(db, "notifications", n.id), {
          [`readBy.${myUid}`]: serverTimestamp()
        })
      ));
    } catch (err) {
      console.error("Failed to mark all notifications read:", err);
    }
  }, [notifications, currentUser]);

  // Store Orders State — live from Firestore
  const [storeOrders, setStoreOrders] = useState<StoreOrder[]>([]);

  const formatStoreDate = (value: any) => {
    if (!value) return "";
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  };

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    const storeOrdersQuery = query(collection(db, "storeOrders"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      storeOrdersQuery,
      async (snapshot) => {
        const nextOrders = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            orderRef: data.orderRef || "",
            roomId: data.roomId || "",
            roomNumber: data.roomNumber || "",
            bookingId: data.bookingId || null,
            guestName: data.guestName || "",
            items: Array.isArray(data.items) ? data.items : [],
            totalAmount: Number(data.totalAmount || 0),
            paymentMethod: data.paymentMethod || "cod",
            paymentProofUrl: data.paymentProofUrl || "",
            paymentProofPath: data.paymentProofPath || "",
            status: data.status || "placed",
            stockRestoredAt: data.stockRestoredAt ? formatStoreDate(data.stockRestoredAt) : null,
            stockDecrementedAt: data.stockDecrementedAt ? formatStoreDate(data.stockDecrementedAt) : null,
            deliveredAt: data.deliveredAt ? formatStoreDate(data.deliveredAt) : null,
            isBilled: !!data.isBilled,
            billedAt: data.billedAt ? formatStoreDate(data.billedAt) : null,
            cancellationReason: data.cancellationReason || "",
            handledBy: data.handledBy || "",
            notes: data.notes || "",
            createdAt: formatStoreDate(data.createdAt)
          } satisfies StoreOrder;
        });
        await Promise.all(nextOrders.map(async (order) => {
          if (order.paymentProofPath) {
            order.paymentProofUrl = await resolvePrivateStorageUrl(order.paymentProofPath);
          }
        }));
        if (active) setStoreOrders(nextOrders);
      },
      (error) => {
        console.error("Error listening to store orders:", error);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUser]);

  const updateStoreOrderStatus = async (orderId: string, status: StoreOrder["status"], cancellationReason = "") => {
    if (status === "delivered") {
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/store/deliver-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ orderId })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to mark store order delivered.");
      }
      return;
    }

    if (status === "cancelled" || status === "confirmed") {
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, "storeOrders", orderId);
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error("Store order not found");
        }

        const orderData = orderSnap.data();
        const orderItems = Array.isArray(orderData.items) ? orderData.items : [];

        if (status === "cancelled") {
          const shouldRestoreStock = !!orderData.stockDecrementedAt && !orderData.stockRestoredAt;
          const itemRefs = shouldRestoreStock
            ? orderItems.map((item: any) => doc(db, "storeItems", item.itemId))
            : [];
          const itemSnaps = await Promise.all(itemRefs.map((itemRef) => transaction.get(itemRef)));

          itemSnaps.forEach((itemSnap, index) => {
            if (!itemSnap.exists()) return;
            const itemData = itemSnap.data();
            const stock = itemData.stock ?? null;
            if (stock !== null) {
              transaction.update(itemRefs[index], {
                stock: Number(stock || 0) + Number(orderItems[index].quantity || 0),
                updatedAt: serverTimestamp()
              });
            }
          });

          transaction.update(orderRef, {
            status,
            cancellationReason,
            stockRestoredAt: shouldRestoreStock ? serverTimestamp() : orderData.stockRestoredAt || null,
            updatedAt: serverTimestamp(),
            handledBy: currentUser?.uid || currentUser?.email || ""
          });
          return;
        }

        // status === "confirmed": decrement stock exactly once on placed -> confirmed transition
        if (orderData.status === "placed" && !orderData.stockDecrementedAt) {
          const itemRefs = orderItems.map((item: any) => doc(db, "storeItems", item.itemId));
          const itemSnaps = await Promise.all(itemRefs.map((itemRef) => transaction.get(itemRef)));
          itemSnaps.forEach((itemSnap, index) => {
            if (!itemSnap.exists()) return;
            const itemData = itemSnap.data();
            const stock = itemData.stock ?? null;
            if (stock !== null) {
              const remaining = Number(stock || 0) - Number(orderItems[index].quantity || 0);
              if (remaining < 0) {
                throw new Error("INSUFFICIENT_STOCK");
              }
              transaction.update(itemRefs[index], {
                stock: remaining,
                updatedAt: serverTimestamp()
              });
            }
          });
          transaction.update(orderRef, {
            status,
            stockDecrementedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            handledBy: currentUser?.uid || currentUser?.email || ""
          });
          return;
        }

        transaction.update(orderRef, {
          status,
          updatedAt: serverTimestamp(),
          handledBy: currentUser?.uid || currentUser?.email || ""
        });
      });
      return;
    }

    await updateDoc(doc(db, "storeOrders", orderId), {
      status,
      updatedAt: serverTimestamp(),
      handledBy: currentUser?.uid || currentUser?.email || ""
    });
  };

  const billStoreOrder = async (orderId: string) => {
    await updateDoc(doc(db, "storeOrders", orderId), {
      isBilled: true,
      billedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      handledBy: currentUser?.uid || currentUser?.email || ""
    });
  };

  // Store Catalog State — live from Firestore
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);

  const normalizeStoreCategory = (category: unknown): StoreItem["category"] => {
    return ["drinks", "snacks", "toiletries", "rentals", "other"].includes(String(category))
      ? String(category) as StoreItem["category"]
      : "other";
  };

  const uploadStoreItemImage = async (itemId: string, file: File) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileRef = storageRef(storage, `store-items/${itemId}/${Date.now()}-${safeName}`);
    await uploadBytes(fileRef, file);
    return getDownloadURL(fileRef);
  };

  useEffect(() => {
    if (!currentUser) return;
    const storeItemsQuery = query(collection(db, "storeItems"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      storeItemsQuery,
      (snapshot) => {
        setStoreItems(snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data.name || "Store item",
            category: normalizeStoreCategory(data.category),
            description: data.description || "",
            price: Number(data.price || 0),
            stock: data.stock === null ? null : Math.max(0, Number(data.stock || 0)),
            imageUrl: data.imageUrl || "",
            isActive: data.isActive !== false,
            createdAt: formatStoreDate(data.createdAt)
          } satisfies StoreItem;
        }));
      },
      (error) => {
        console.error("Error listening to store items:", error);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const migratedStoreItemPhotoIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentUser || storeItems.length === 0) return;
    storeItems.forEach((item) => {
      if (!item.imageUrl.startsWith("data:image/")) return;
      if (migratedStoreItemPhotoIdsRef.current.has(item.id)) return;
      migratedStoreItemPhotoIdsRef.current.add(item.id);
      void (async () => {
        try {
          const response = await fetch(item.imageUrl);
          const blob = await response.blob();
          const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
          const file = new File([blob], `migrated-store-item.${ext}`, { type: blob.type || "image/jpeg" });
          const url = await uploadStoreItemImage(item.id, file);
          await updateDoc(doc(db, "storeItems", item.id), {
            imageUrl: url,
            migratedImageUrlFromDataUrlAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid || currentUser.email || ""
          });
        } catch (error) {
          console.error("Error migrating store item image to Storage:", error);
        }
      })();
    });
  }, [currentUser, storeItems]);

  const addStoreItem = async (item: StoreItemInput) => {
    try {
      const { imageFile, ...itemFields } = item;
      const itemRef = doc(collection(db, "storeItems"));
      const imageUrl = imageFile ? await uploadStoreItemImage(itemRef.id, imageFile) : itemFields.imageUrl;
      await setDoc(itemRef, {
        ...itemFields,
        imageUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser?.uid || currentUser?.email || ""
      });
    } catch (error) {
      console.error("Error adding store item:", error);
      notify.error("Failed to add store item", error instanceof Error ? error.message : "Unknown error");
    }
  };

  const updateStoreItem = async (itemId: string, updates: Partial<StoreItemInput>) => {
    try {
      const { imageFile, ...updateFields } = updates;
      const imageUrl = imageFile ? await uploadStoreItemImage(itemId, imageFile) : updateFields.imageUrl;
      await updateDoc(doc(db, "storeItems", itemId), {
        ...updateFields,
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || currentUser?.email || ""
      });
    } catch (error) {
      console.error("Error updating store item:", error);
      notify.error("Failed to update store item", error instanceof Error ? error.message : "Unknown error");
    }
  };

  const deleteStoreItem = async (itemId: string) => {
    try {
      await updateDoc(doc(db, "storeItems", itemId), {
        isActive: false,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || currentUser?.email || ""
      });
    } catch (error) {
      console.error("Error disabling store item:", error);
      notify.error("Failed to disable store item", error instanceof Error ? error.message : "Unknown error");
    }
  };

  // Settings Mock States
  const [hotelConfig, setHotelConfig] = useState({
    address: `${config.address.street}, ${config.address.city}, ${config.address.region}`,
    frontDeskPhone: config.frontDeskPhone,
    facebookUrl: `https://facebook.com/${config.brandName}`,
    instagramUrl: `https://instagram.com/${config.brandName}`,
    twitterHandle: config.twitterHandle,
    checkInTime: "2:00 PM",
    checkOutTime: "12:00 PM",
    intercomQuickRequests: ["Extra Towels", "Bottled Water", "Room Cleaning", "Do Not Disturb"],
    notificationSoundUrl: "",
    roomTypes: [...DEFAULT_ROOM_TYPES],
    seasonalRateOverrides: [],
    // Per DSC-01..05 (2026-08-01, per CVQ-06): per-class discount
    // scope. Defaults to the broad scope (all classes apply to
    // room + breakfast + extra bed) so the live preview / server
    // math is byte-equivalent to the pre-DSC-01 behavior. The
    // Settings → Discounts tab exposes a 3×3 checkbox editor
    // (senior row admin-only per DSC-03). Legacy settings without
    // the field read as the broad default via `normalizeDiscountScope`.
    discountScope: BROAD_DISCOUNT_SCOPE,
    // Per PEX-01 (2026-08-01, per CVQ-12 + decision #147): the
    // window (in hours) a `pending` booking holds its room before
    // the hold auto-expires. Snapshotted onto each booking at
    // create time — a later Settings change never shortens or
    // lengthens an existing guest's promise. Default 24h per the
    // decision. The admin can shorten for large groups via the
    // Settings UI; the per-booking `holdExpiresAt` is the only
    // field the rest of the system reads.
    paymentHoldWindowHours: 24,
    // Per EXB-10 (2026-08-01, per decision #157): the
    // hotel-wide rollaway-bed inventory. The server-side
    // `handleCreateBooking` / `handleCreateWalkin` /
    // `handleRescheduleBooking` transactions read this
    // field and reject bookings that would push the
    // overlapping-stay total above the configured cap.
    // `0` = "no constraint" (the historical "any number"
    // behavior) so legacy settings without the field and
    // freshly bootstrapped projects get the
    // pre-EXB-10 semantics for free. A positive integer
    // is the count of rollaway beds the hotel physically
    // owns; the create / walkin / reschedule
    // transactions enforce
    // `inUseAcrossOverlappingStays + requestedCount <=
    // extraBedInventory` inside the same Firestore
    // transaction that assigns the room. The Settings
    // UI exposes a numeric input (deferred to a future
    // PR — out of EXB-10's scope, which is the server
    // invariant).
    extraBedInventory: 0
  });

  // Tracks whether the first `settings/websiteContent` snapshot
  // has been delivered. Used by the Branding tab to render a
  // skeleton for the asset previews instead of the static
  // fallback logo / "no asset yet" placeholder, which would
  // otherwise flash before the admin's custom upload is known
  // (more pronounced on mobile where the snapshot delivery
  // is slower). Set to `false` inside the `onSnapshot` callback
  // the first time the `websiteContent` case fires.
  const [websiteContentLoading, setWebsiteContentLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const [websiteContent, setWebsiteContent] = useState({
    homepage: {
      heroHeading: "Boutique Comfort in Bohol",
      heroSubtext: "Peaceful stays near tourist landmarks.",
      heroPhotoUrl: "",
      amenities: [
        { title: "Consistent comfort", description: "Quiet rooms, crisp linens, and the essentials guests expect every time.", icon: "bed", isEnabled: true },
        { title: "Easy city access", description: "A practical Tagbilaran base for tours, meetings, errands, and onward travel.", icon: "map", isEnabled: true },
        { title: "Warm front desk care", description: "Helpful support for arrivals, local questions, and small travel details.", icon: "users", isEnabled: true }
      ],
      featuredTypeValues: ["executive", "standard-double", "family"],
      services: [
        { title: "Tour Packages", description: "Ask our team for help arranging Bohol countryside tours, island plans, and local experiences.", icon: "palmtree", isEnabled: true },
        { title: "Car Rentals", description: "Coordinate simple transportation support for business trips, family errands, or day tours.", icon: "car", isEnabled: true }
      ],
      sparkRewards: {
        isEnabled: true,
        heading: "Stay often, feel known",
        description: "Join the loyalty program built for repeat guests, corporate travelers, and anyone who wants a smoother next stay.",
        perks: [
          { title: "Earn points on completed stays", description: "", icon: "sparkles", isEnabled: true },
          { title: "Member-only stay offers", description: "", icon: "tag", isEnabled: true },
          { title: "Request early check-in", description: "", icon: "clock", isEnabled: true }
        ]
      },
      sectionHeaders: {
        roomsEyebrow: "",
        roomsHeading: "",
        roomsSubtext: "",
        amenitiesEyebrow: "",
        amenitiesHeading: "",
        amenitiesSubtext: "",
        servicesEyebrow: "",
        servicesHeading: "",
        servicesSubtext: ""
      }
    },
    about: {
      heroHeading: "about us",
      heroPhotoUrl: "",
      missionStatement: "",
      visionStatement: "",
      hotelStory: ""
    },
    roomsCatalog: {
      heroEyebrow: "",
      heroHeading: "",
      heroSubtext: "",
      heroPhotoUrl: ""
    },
    contact: {
      heroEyebrow: "",
      heroHeading: "",
      heroSubtext: "",
      heroPhotoUrl: ""
    },
    notFound: {
      heroEyebrow: "",
      heroHeading: "",
      heroSubtext: "",
      heroPhotoUrl: ""
    },
    corporate: {
      heroEyebrow: "Curated hospitality for executive comfort",
      heroHeading: "Corporate Boardrooms",
      heroSubtext: "Flexible spaces.",
      heroPhotoUrl: "",
      perks: [
        { title: "Negotiated Rates", description: "Discounted room charges.", icon: "coins", isEnabled: true }
      ],
      // Rooms overview + retreat CTA copy. Empty strings in
      // the initial useState shape mean "use the shared
      // `DEFAULT_CORPORATE_PAGE_CONTENT` fallback" — populated
      // by the Settings editor on mount and by the one-time
      // Firestore backfill below.
      roomsOverviewEyebrow: "",
      roomsOverviewHeading: "",
      roomsOverviewDescription: "",
      retreatHeading: "",
      retreatDescription: "",
      retreatCtaLabel: ""
    },
    rewards: {
      heroEyebrow: "Loyalty Program",
      heroHeading: "Earn Every Stay",
      heroSubtext:
        "Join Spark Rewards and unlock a world of exclusive benefits and heartfelt hospitality. Experience the pinnacle of boutique comfort with personalized rewards tailored just for you.",
      heroPhotoUrl: ""
    },
    branding: {
      logoNavbar: "",
      logoNavbarOnDark: "",
      logoFooter: ""
    }
  });

  // Normalize a websiteContent snapshot from Firestore into the
  // complete shape consumers expect. Older documents that pre-date
  // the Branding feature (no `rewards` / `branding` / `about.heroHeading`
  // / `corporate.heroEyebrow` sub-objects) would otherwise replace
  // the full state with a partial object and crash every consumer
  // that reaches into `websiteContent.rewards.heroEyebrow`. Each
  // missing sub-object falls back to the seed value used above so
  // the Settings page renders and the guest app keeps its fallbacks.
  function mergeWebsiteContent(raw: Record<string, unknown> | null | undefined) {
    const seed = {
      homepage: {
        heroHeading: "Boutique Comfort in Bohol",
        heroSubtext: "Peaceful stays near tourist landmarks.",
        heroPhotoUrl: "",
        amenities: [
          { title: "Consistent comfort", description: "Quiet rooms, crisp linens, and the essentials guests expect every time.", icon: "bed", isEnabled: true },
          { title: "Easy city access", description: "A practical Tagbilaran base for tours, meetings, errands, and onward travel.", icon: "map", isEnabled: true },
          { title: "Warm front desk care", description: "Helpful support for arrivals, local questions, and small travel details.", icon: "users", isEnabled: true }
        ],
      featuredTypeValues: ["executive", "standard-double", "family"],
        services: [
          { title: "Tour Packages", description: "Ask our team for help arranging Bohol countryside tours, island plans, and local experiences.", icon: "palmtree", isEnabled: true },
          { title: "Car Rentals", description: "Coordinate simple transportation support for business trips, family errands, or day tours.", icon: "car", isEnabled: true }
        ],
        sparkRewards: {
          isEnabled: true,
          heading: "Stay often, feel known",
          description: "Join the loyalty program built for repeat guests, corporate travelers, and anyone who wants a smoother next stay.",
          perks: [
            { title: "Earn points on completed stays", description: "", icon: "sparkles", isEnabled: true },
            { title: "Member-only stay offers", description: "", icon: "tag", isEnabled: true },
            { title: "Request early check-in", description: "", icon: "clock", isEnabled: true }
          ]
        },
        sectionHeaders: {
          roomsEyebrow: "",
          roomsHeading: "",
          roomsSubtext: "",
          amenitiesEyebrow: "",
          amenitiesHeading: "",
          amenitiesSubtext: "",
          servicesEyebrow: "",
          servicesHeading: "",
          servicesSubtext: ""
        }
      },
      about: {
        heroHeading: "about us",
        heroPhotoUrl: "",
        missionStatement: "",
        visionStatement: "",
        hotelStory: ""
      },
      roomsCatalog: {
        heroEyebrow: "",
        heroHeading: "",
        heroSubtext: "",
        heroPhotoUrl: ""
      },
      contact: {
        heroEyebrow: "",
        heroHeading: "",
        heroSubtext: "",
        heroPhotoUrl: ""
      },
      notFound: {
        heroEyebrow: "",
        heroHeading: "",
        heroSubtext: "",
        heroPhotoUrl: ""
      },
    corporate: {
      heroEyebrow: "Curated hospitality for executive comfort",
      heroHeading: "Corporate Boardrooms",
      heroSubtext: "Flexible spaces.",
      heroPhotoUrl: "",
      // Seed the full set of perks (sourced from the shared
      // `DEFAULT_CORPORATE_PERKS` constant) so the Website
      // Content → Corporate page editor shows the same set
      // guests see on a fresh deploy. If a Firestore doc
      // already carries a `corporate.perks[]` it overrides
      // this seed below in the merge.
      perks: DEFAULT_CORPORATE_PERKS.map((p) => ({
        title: p.title,
        description: p.description,
        icon: p.icon,
        isEnabled: p.isEnabled !== false
      })),
      // Rooms overview + retreat CTA copy. Empty strings in
      // the initial useState shape mean "use the shared
      // `DEFAULT_CORPORATE_PAGE_CONTENT` fallback" — populated
      // by the Settings editor on mount and by the one-time
      // Firestore backfill below.
      roomsOverviewEyebrow: "",
      roomsOverviewHeading: "",
      roomsOverviewDescription: "",
      retreatHeading: "",
      retreatDescription: "",
      retreatCtaLabel: ""
    },
      rewards: {
        heroEyebrow: "Loyalty Program",
        heroHeading: "Earn Every Stay",
        heroSubtext:
          "Join Spark Rewards and unlock a world of exclusive benefits and heartfelt hospitality. Experience the pinnacle of boutique comfort with personalized rewards tailored just for you.",
        heroPhotoUrl: ""
      },
      branding: {
        logoNavbar: "",
        logoNavbarOnDark: "",
        logoFooter: ""
      }
    };
    if (!raw || typeof raw !== "object") return seed;
    const r = raw as Record<string, Record<string, unknown>>;
    const homepageRaw = (r.homepage as Record<string, unknown>) || {};
    const sparkRewardsRaw =
      homepageRaw.sparkRewards && typeof homepageRaw.sparkRewards === "object"
        ? (homepageRaw.sparkRewards as Record<string, unknown>)
        : null;
    return {
      homepage: {
        ...seed.homepage,
        ...homepageRaw,
        amenities: Array.isArray(homepageRaw.amenities)
          ? (homepageRaw.amenities as typeof seed.homepage.amenities)
          : seed.homepage.amenities,
        services: Array.isArray(homepageRaw.services)
          ? (homepageRaw.services as typeof seed.homepage.services)
          : seed.homepage.services,
        featuredTypeValues: (() => {
          // Prefer the new `featuredTypeValues` field. If absent
          // and the doc still carries the legacy
          // `featuredRoomIds` (pre-migration), map each id to its
          // room type via the `roomTypes` already loaded into
          // context, dedupe, and seed the new field. This is a
          // one-time migration — the next admin save writes the
          // new field and the old one is dropped.
          if (Array.isArray(homepageRaw.featuredTypeValues)) {
            return homepageRaw.featuredTypeValues as string[];
          }
          if (Array.isArray(homepageRaw.featuredRoomIds) && roomTypes.length > 0) {
            const typeByValue = new Map(roomTypes.map((t) => [t.value, t.value]));
            const derived: string[] = [];
            for (const id of homepageRaw.featuredRoomIds as unknown[]) {
              if (typeof id !== "string") continue;
              const matched = rooms.find((r) => r.id === id);
              if (!matched) continue;
              const typeValue = typeByValue.get(matched.type);
              if (typeValue && !derived.includes(typeValue)) {
                derived.push(typeValue);
              }
            }
            if (derived.length > 0) return derived;
          }
          return seed.homepage.featuredTypeValues;
        })(),
        sectionHeaders: {
          ...seed.homepage.sectionHeaders,
          ...((homepageRaw.sectionHeaders as Record<string, unknown>) || {})
        },
        sparkRewards: {
          ...seed.homepage.sparkRewards,
          ...(sparkRewardsRaw || {}),
          perks: Array.isArray(sparkRewardsRaw?.perks)
            ? (sparkRewardsRaw!.perks as typeof seed.homepage.sparkRewards.perks)
            : seed.homepage.sparkRewards.perks
        }
      },
      about: { ...seed.about, ...(r.about || {}) },
      roomsCatalog: { ...seed.roomsCatalog, ...(r.roomsCatalog || {}) },
      contact: { ...seed.contact, ...(r.contact || {}) },
      notFound: { ...seed.notFound, ...(r.notFound || {}) },
      corporate: {
        ...seed.corporate,
        ...(r.corporate || {}),
        perks: Array.isArray(r.corporate?.perks) ? r.corporate!.perks : seed.corporate.perks
      },
      rewards: { ...seed.rewards, ...(r.rewards || {}) },
      branding: { ...seed.branding, ...(r.branding || {}) }
    };
  }

  const [rewardsConfig, setRewardsConfig] = useState({
    pointsEnabled: true,
    earningMode: "per-spend",
    pointsPerBooking: 50,
    pointsPerHundred: 10,
    memberDiscountEnabled: true,
    memberDiscountPct: 10,
    pointsRedemptionRate: 100
  });

  const [breakfastConfig, setBreakfastConfig] = useState({
    isEnabled: true,
    ratePerPersonPerNight: DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT,
    // Per CHD-10 (2026-07-31, per CVQ-01): hotel-wide default for
    // "include children in the breakfast charge". The server
    // snapshots this onto every new booking whose client did not
    // send a per-booking override. `true` is the historical
    // default (children pay the full rate) and the safe one —
    // narrowing is a one-line change, unwinding under-charged
    // bills is not.
    breakfastIncludesChildrenDefault: true,
    silogItems: [
      { id: "sl-1", name: "Tapsilog", isActive: true },
      { id: "sl-2", name: "Longsilog", isActive: true },
      { id: "sl-3", name: "Tocilog", isActive: true }
    ]
  });

  const [storeConfig, setStoreConfig] = useState<StoreConfig>({
    isEnabled: true,
    lowStockThreshold: 3,
    paymentMethods: [
      { method: "cod", label: "Cash on Delivery", isEnabled: true },
      { method: "add-to-bill", label: "Room Bill", isEnabled: true },
      { method: "gcash", label: "GCash Wallet", isEnabled: true, qrUrl: "", accountInfo: "" }
    ],
    useBookingPaymentMethods: false
  });

  const [seoSettings, setSeoSettings] = useState<import("@spark-inn/shared").SeoSettings>({
    draft: {
      metaDescription: config.metaDescription,
      priceRange: config.priceRange,
      ogImage: config.ogImage
    }
  });

  // Subscribe to all settings documents from Firestore
  useEffect(() => {
    if (!currentUser) {
      setSettingsLoading(true);
      setWebsiteContentLoading(true);
      return;
    }
    setSettingsLoading(true);
    setWebsiteContentLoading(true);
    const settingsRef = collection(db, "settings");
    const unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => {
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const docId = docSnap.id;
          switch (docId) {
            case "hotelConfig":
              setHotelConfig((prev) => ({ ...prev, ...(data as Partial<typeof hotelConfig>), discountScope: normalizeDiscountScope((data as Partial<typeof hotelConfig>)?.discountScope), paymentHoldWindowHours: normalizePaymentHoldWindowHours((data as Partial<typeof hotelConfig>)?.paymentHoldWindowHours) })); // Per DSC-01..05 (2026-08-01, per CVQ-06): always normalize the incoming scope so legacy settings without the field (or a partial scope object) hydrate to the broad default. The Settings tab is the only editor; the source of truth is `settings/hotelConfig.discountScope`. // Per PEX-01 (2026-08-01): always normalize the incoming window so legacy settings (or values outside the admin-allowed 1..72h range) hydrate to the 24h default. The per-booking `holdExpiresAt` is the only field the rest of the system reads; the Settings window is just the input.
              break;
            case "websiteContent":
              setWebsiteContent(mergeWebsiteContent(data as Record<string, unknown>));
              setWebsiteContentLoading(false);
              break;
            case "rewardsConfig":
              // Legacy source-shape note: case "rewardsConfig": setRewardsConfig(data as typeof rewardsConfig)
              setRewardsConfig((prev) => ({ ...prev, ...(data as Partial<typeof rewardsConfig>) }));
              break;
            case "breakfastConfig":
              setBreakfastConfig((prev) => ({ ...prev, ...(data as Partial<typeof breakfastConfig>) }));
              break;
            case "storeConfig":
              setStoreConfig((prev) => ({ ...prev, ...(data as Partial<typeof storeConfig>) }));
              break;
            case "seo":
              setSeoSettings((prev) => ({ ...prev, ...(data as import("@spark-inn/shared").SeoSettings) }));
              break;
          }
        });
        setSettingsLoading(false);
        setWebsiteContentLoading(false);
      },
      (error) => {
        console.error("Error listening to settings collection:", error);
        setSettingsLoading(false);
        setWebsiteContentLoading(false);
      }
    );
    return unsubscribe;
  }, [currentUser]);

  const updateSettings = async (section: string, data: any) => {
    try {
      const docRef = doc(db, "settings", section);
      await setDoc(docRef, data, { merge: true });
      // The public site caches `settings/websiteContent` +
      // `settings/hotelConfig` for 5 minutes per returning visitor.
      // Bump the cross-tab invalidation key so a parallel guest tab
      // refetches the new value immediately (see
      // `bustPublicSiteContentCache` in `shared/utils/publicSiteCache.ts`).
      if (section === "websiteContent" || section === "hotelConfig") {
        bustPublicSiteContentCache();
      }
      return true;
    } catch (error) {
      console.error(`Error updating ${section}:`, error);
      notify.error("Failed to save settings", error instanceof Error ? error.message : "Unknown error");
      return false;
    }
  };

  // One-time corporate backfill. Runs once per admin session
  // (gated by a ref) after the initial Firestore snapshot delivers
  // `websiteContent`. For each of the 9 corporate text fields that
  // is empty (`""` or missing), write the corresponding value from
  // `DEFAULT_CORPORATE_PAGE_CONTENT` to
  // `settings/websiteContent.corporate` via the existing
  // `updateSettings` (which uses `setDoc(..., { merge: true })`).
  //
  // Why: the new text fields added in `feat/corporate-content-editable`
  // would otherwise rely on the guest app's `||` fallback forever.
  // Backfilling once on first admin load locks the page to the
  // same copy the deploy-time fallback provides, so the admin
  // editor and the guest site agree without a manual save.
  // Idempotent — subsequent loads see the backfilled values and
  // the `if (!corporate.X)` check short-circuits, so no extra
  // writes happen. The ref prevents re-runs when `websiteContent`
  // updates for unrelated reasons (e.g. any other settings doc
  // changes).
  //
  // `corporate.heroPhotoUrl` is intentionally NOT backfilled.
  // Unlike text, the photo URL has a binary "no custom upload"
  // semantic: the guest app's `pickString` falls back to the
  // static `corporateHeroImage` in `data/homepage.ts` when the
  // Firestore value is empty. Persisting the default URL into
  // Firestore would (a) undo the admin's Reset action on the
  // very next dashboard load, and (b) freeze the hero image
  // to whatever URL was in `DEFAULT_CORPORATE_PAGE_CONTENT.hero
  // .photoUrl` at the moment of first load — preventing future
  // edits to the static `corporateHeroImage` from ever reaching
  // the public site. The admin editor's pre-population still
  // works because `mergeWebsiteContent` keeps the in-editor
  // `heroPhotoUrl` field empty when no custom upload exists.
  const hasBackfilledCorporateRef = useRef(false);
  useEffect(() => {
    if (!currentUser || currentUser.role !== "admin") return;
    if (hasBackfilledCorporateRef.current) return;
    // Wait until the initial Firestore snapshot has delivered
    // `websiteContent` with at least the homepage sub-object
    // (the seed guarantees this is always present).
    if (!websiteContent || !websiteContent.homepage) return;
    const corporate = websiteContent.corporate;
    if (!corporate) {
      hasBackfilledCorporateRef.current = true;
      return;
    }
    const updates: Record<string, string> = {};
    if (!corporate.heroEyebrow) updates.heroEyebrow = DEFAULT_CORPORATE_PAGE_CONTENT.hero.eyebrow;
    if (!corporate.heroHeading) updates.heroHeading = DEFAULT_CORPORATE_PAGE_CONTENT.hero.heading;
    if (!corporate.heroSubtext) updates.heroSubtext = DEFAULT_CORPORATE_PAGE_CONTENT.hero.subtext;
    if (!corporate.roomsOverviewEyebrow) updates.roomsOverviewEyebrow = DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.eyebrow;
    if (!corporate.roomsOverviewHeading) updates.roomsOverviewHeading = DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.heading;
    if (!corporate.roomsOverviewDescription) updates.roomsOverviewDescription = DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.description;
    if (!corporate.retreatHeading) updates.retreatHeading = DEFAULT_CORPORATE_PAGE_CONTENT.retreat.heading;
    if (!corporate.retreatDescription) updates.retreatDescription = DEFAULT_CORPORATE_PAGE_CONTENT.retreat.description;
    if (!corporate.retreatCtaLabel) updates.retreatCtaLabel = DEFAULT_CORPORATE_PAGE_CONTENT.retreat.ctaLabel;
    hasBackfilledCorporateRef.current = true;
    if (Object.keys(updates).length > 0) {
      void updateSettings("websiteContent", { corporate: updates });
    }
  }, [websiteContent, updateSettings, currentUser]);

  // Payment Methods State — sourced from
  // `settings/hotelConfig.paymentMethods[]`. Per
  // `plan/features/SETTINGS.md §Payment Methods` the booking payment
  // list is a fully dynamic admin-managed array. The admin can add,
  // remove, reorder, enable/disable, and edit any method — including
  // "Pay at Hotel" which is just another method (no separate global
  // `payAtHotelEnabled` flag anymore). QR images live in Firebase
  // Storage at `assets/payment-methods/{method}/{fileName}` (public
  // read, staff write — see `firebase/storage.rules`).
  //
  // One-time read migration: if the doc carries the legacy
  // `bookingPaymentMethods` key (the pre-feature field name) and no
  // `paymentMethods` key, the entries are reshaped in place:
  //   - `accountInfo` (single free-text field) → split into
  //     `accountName` (first line) + `accountNumber` (the rest, or
  //     empty when only one line). If the new field is already
  //     present on the entry, the legacy value is dropped (avoids
  //     silent data loss when the admin typed one and the code split
  //     it the other way).
  //   - default `label` to the method key when missing
  //   - default `qrUrl` to "" when missing
  //   - default `isEnabled` to true when missing
  // The reshaped array is then written back via
  // `setDoc(..., { paymentMethods: reshaped }, { merge: true })`.
  // The legacy `bookingPaymentMethods` key is left in place on the
  // doc — Firestore `merge: true` cannot remove fields, and the
  // few KB of dead data are harmless. The migration is gated by a
  // ref so it runs at most once per session and is idempotent.
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>(() => [
    { method: "gcash", label: "GCash", accountName: "Spark Inn Hotel Corp", accountNumber: "0917-000-0000", qrUrl: "", isEnabled: true, showInStore: true, showInCorporate: true },
    { method: "bank", label: "Bank Transfer", accountName: "BDO", accountNumber: "00-000-000", qrUrl: "", isEnabled: true, showInStore: true, showInCorporate: true },
    { method: "paypal", label: "PayPal", accountName: "paypal@sparkinn.com", accountNumber: "", qrUrl: "", isEnabled: true, showInStore: true, showInCorporate: false },
    { method: "pay-at-hotel", label: "Pay at Hotel", accountName: "", accountNumber: "", qrUrl: "", isEnabled: true, showInStore: false, showInCorporate: false },
    { method: "cod", label: "Cash on Delivery", accountName: "", accountNumber: "", qrUrl: "", isEnabled: false, showInStore: true, showInCorporate: false },
    { method: "add-to-bill", label: "Add to Room Bill", accountName: "", accountNumber: "", qrUrl: "", isEnabled: false, showInStore: true, showInCorporate: false }
  ]);

  // Per NBS-04 (2026-07-31): booking sources are admin-editable in
  // Settings. The seed list is `DEFAULT_BOOKING_SOURCES` (the existing
  // 5 + "agoda" per CVQ-08). `online` / `walk-in` / `corporate` are
  // system-assigned (`selectableAtFrontDesk: false`) and never appear
  // in the New Booking modal's source selector. The first-time loader
  // mirrors the paymentMethods pattern: a one-time backfill appends
  // any missing seed entries to the persisted list and re-writes the
  // array (idempotent, gated by a `useRef`).
  const [bookingSources, setBookingSources] = useState<BookingSourceConfig[]>(() => DEFAULT_BOOKING_SOURCES);

  const hasMigratedPaymentMethodsRef = useRef(false);
  const hasMigratedBookingSourcesRef = useRef(false);

  const normalizePaymentMethodConfig = (entry: any): PaymentMethodConfig => {
    const method = typeof entry?.method === "string" ? entry.method.trim() : "";
    const label = typeof entry?.label === "string" && entry.label.trim() ? entry.label.trim() : method;
    const accountInfo = typeof entry?.accountInfo === "string" ? entry.accountInfo : "";
    const explicitName = typeof entry?.accountName === "string" ? entry.accountName : "";
    const explicitNumber = typeof entry?.accountNumber === "string" ? entry.accountNumber : "";
    let accountName = explicitName;
    let accountNumber = explicitNumber;
    if (!explicitName && !explicitNumber && accountInfo) {
      const [firstLine, ...rest] = accountInfo.split("\n");
      accountName = (firstLine || "").trim();
      accountNumber = rest.join("\n").trim();
    }
    return {
      method,
      label,
      accountName,
      accountNumber,
      qrUrl: typeof entry?.qrUrl === "string" ? entry.qrUrl : "",
      isEnabled: entry?.isEnabled !== false,
      showInStore: typeof entry?.showInStore === "boolean"
        ? entry.showInStore
        : method === "pay-at-hotel"
          ? false
          : method === "cod" || method === "add-to-bill"
            ? true
            : undefined,
      showInCorporate: typeof entry?.showInCorporate === "boolean"
        ? entry.showInCorporate
        : method === "pay-at-hotel" || method === "cod" || method === "add-to-bill"
          ? false
          : undefined,
      requireReferenceNumber: typeof entry?.requireReferenceNumber === "boolean"
        ? entry.requireReferenceNumber
        : true
    };
  };

  useEffect(() => {
    if (!currentUser) return;
    if (hasMigratedPaymentMethodsRef.current) return;
    const raw = (hotelConfig as Record<string, unknown>) || {};
    const next = raw.paymentMethods;
    const legacy = raw.bookingPaymentMethods;
    if (!Array.isArray(next) && Array.isArray(legacy)) {
      const reshaped: PaymentMethodConfig[] = (legacy as any[]).map(normalizePaymentMethodConfig);
      hasMigratedPaymentMethodsRef.current = true;
      setPaymentMethods(reshaped);
      // Write the new shape. The legacy `bookingPaymentMethods` key
      // is intentionally left in place — see the comment above.
      void updateSettings("hotelConfig", { paymentMethods: reshaped });
      return;
    }
    if (Array.isArray(next)) {
      setPaymentMethods((next as any[]).map(normalizePaymentMethodConfig));
      hasMigratedPaymentMethodsRef.current = true;
    }
  }, [hotelConfig, currentUser, updateSettings]);

  // One-shot backfill for protected payment methods. Deployments
  // that configured their `paymentMethods[]` before "Pay at Hotel"
  // was added to the default seed (per the 2026-07-01 `feature/
  // payment-methods` rollout) do not have a `pay-at-hotel` entry
  // and would silently lose the walk-in default on the next
  // admin load. This effect appends the default entry to any
  // existing array that is missing it, then persists via merged
  // `setDoc`. Gated by `hasBackfilledProtectedPaymentMethodsRef`
  // so it runs at most once per session and is idempotent.
  //
  // IMPORTANT — depends on `hotelConfig`, NOT on the
  // `paymentMethods` state. The `paymentMethods` state is seeded
  // with the legacy 4-method default (which already includes
  // `pay-at-hotel`), so a useEffect that reads from it would
  // see "nothing missing" on the very first render and close
  // the ref gate BEFORE the Firestore snapshot arrives. By the
  // time the snapshot replaces the state with the actual
  // Firestore data (e.g. `[gcash, paypal]` for a deployment
  // that was configured before `pay-at-hotel` existed), the ref
  // is already `true` and the backfill never runs. Reading
  // `hotelConfig.paymentMethods` directly avoids the seed
  // pollution — the effect only fires once the real Firestore
  // data has loaded.
  //
  // Only `pay-at-hotel` is backfilled — `maya` and `bank` are
  // NOT, so an admin who previously removed them keeps their
  // decision. To add more backfill entries, add to the
  // `PROTECTED_PAYMENT_METHODS` array in `shared/constants` AND
  // extend the `BACKFILL_DEFAULTS` map below.
  const hasBackfilledProtectedPaymentMethodsRef = useRef(false);
  const BACKFILL_DEFAULTS: Record<ProtectedPaymentMethod, PaymentMethodConfig> = {
    "pay-at-hotel": {
      method: "pay-at-hotel",
      label: "Pay at Hotel",
      accountName: "",
      accountNumber: "",
      qrUrl: "",
      isEnabled: true,
      showInStore: false,
      showInCorporate: false
    },
    "add-to-bill": {
      method: "add-to-bill",
      label: "Add to Room Bill",
      accountName: "",
      accountNumber: "",
      qrUrl: "",
      isEnabled: false,
      showInStore: true,
      showInCorporate: false
    }
  };
  const STORE_PAYMENT_BACKFILL_DEFAULTS: Record<string, PaymentMethodConfig> = {
    cod: {
      method: "cod",
      label: "Cash on Delivery",
      accountName: "",
      accountNumber: "",
      qrUrl: "",
      isEnabled: false,
      showInStore: true,
      showInCorporate: false
    }
  };
  // Per WPM-04 (2026-07-31): the walk-in modal used to hardcode `card`
  // as one of three options. After WPM-01 it sources the list from
  // `settings/hotelConfig.paymentMethods[]`. The hotel takes cards
  // (CVQ-07), so the `card` method must exist under Settings or the
  // desk silently loses the option on the day WPM lands. This is NOT
  // a protected method (the admin can delete it) and NOT store-only —
  // it is a staff-onsite tender, which is its own backfill category.
  // Existing records are safe either way: the legacy labels render
  // historical `card` bookings as "Credit Card" without this backfill.
  const STAFF_ONSITE_TENDER_BACKFILL_DEFAULTS: Record<string, PaymentMethodConfig> = {
    card: {
      method: "card",
      label: "Credit Card",
      accountName: "",
      accountNumber: "",
      qrUrl: "",
      isEnabled: true,
      showInStore: false,
      showInCorporate: false
    }
  };
  useEffect(() => {
    if (!currentUser) return;
    if (hasBackfilledProtectedPaymentMethodsRef.current) return;
    const raw = (hotelConfig as Record<string, unknown>) || {};
    const persisted = raw.paymentMethods;
    if (!Array.isArray(persisted)) return; // wait for the Firestore snapshot
    const missingProtected = PROTECTED_PAYMENT_METHODS.filter(
      (key) => !persisted.some((p: unknown) => typeof (p as { method?: unknown })?.method === "string" && (p as { method: string }).method === key)
    );
    const missingStore = Object.keys(STORE_PAYMENT_BACKFILL_DEFAULTS).filter(
      (key) => !persisted.some((p: unknown) => typeof (p as { method?: unknown })?.method === "string" && (p as { method: string }).method === key)
    );
    const missingStaffOnsite = Object.keys(STAFF_ONSITE_TENDER_BACKFILL_DEFAULTS).filter(
      (key) => !persisted.some((p: unknown) => typeof (p as { method?: unknown })?.method === "string" && (p as { method: string }).method === key)
    );
    if (missingProtected.length === 0 && missingStore.length === 0 && missingStaffOnsite.length === 0) {
      hasBackfilledProtectedPaymentMethodsRef.current = true;
      return;
    }
    const next = [
      ...persisted,
      ...missingProtected.map((key) => BACKFILL_DEFAULTS[key]),
      ...missingStore.map((key) => STORE_PAYMENT_BACKFILL_DEFAULTS[key]),
      ...missingStaffOnsite.map((key) => STAFF_ONSITE_TENDER_BACKFILL_DEFAULTS[key])
    ];
    hasBackfilledProtectedPaymentMethodsRef.current = true;
    setPaymentMethods((next as any[]).map(normalizePaymentMethodConfig));
    void updateSettings("hotelConfig", { paymentMethods: next });
  }, [hotelConfig, currentUser, updateSettings]);

  // Per NBS-04 (2026-07-31): booking sources backfill. On first admin
  // load, if `settings/hotelConfig.bookingSources[]` is missing or
  // shorter than the seed list, append the missing seed entries and
  // re-write the array. Idempotent, gated by a `useRef` so it runs
  // at most once per session. Does NOT downgrade entries an admin
  // already removed — append-only.
  useEffect(() => {
    if (!currentUser) return;
    if (hasMigratedBookingSourcesRef.current) return;
    const raw = (hotelConfig as Record<string, unknown>) || {};
    const persisted = raw.bookingSources;
    if (!Array.isArray(persisted)) return; // wait for the Firestore snapshot
    const missing = DEFAULT_BOOKING_SOURCES.filter(
      (seed) => !persisted.some((p: unknown) => typeof (p as { source?: unknown })?.source === "string" && (p as { source: string }).source === seed.source)
    );
    if (missing.length === 0) {
      hasMigratedBookingSourcesRef.current = true;
      return;
    }
    const next = [...persisted, ...missing];
    hasMigratedBookingSourcesRef.current = true;
    setBookingSources(next.map((entry: any) => normalizeBookingSourceConfig(entry)));
    void updateSettings("hotelConfig", { bookingSources: next });
  }, [hotelConfig, currentUser, updateSettings]);

  const normalizeBookingSourceConfig = (entry: any): BookingSourceConfig => {
    const source = typeof entry?.source === "string" ? entry.source.trim() : "";
    const label = typeof entry?.label === "string" && entry.label.trim() ? entry.label.trim() : source;
    const isEnabled = typeof entry?.isEnabled === "boolean" ? entry.isEnabled : true;
    const selectableAtFrontDesk = typeof entry?.selectableAtFrontDesk === "boolean"
      ? entry.selectableAtFrontDesk
      : !PROTECTED_BOOKING_SOURCES.includes(source as ProtectedBookingSource);
    return { source, label, isEnabled, selectableAtFrontDesk };
  };

  const persistBookingSources = async (next: BookingSourceConfig[]) => {
    const previous = bookingSources;
    setBookingSources(next);
    try {
      const success = await updateSettings("hotelConfig", {
        bookingSources: next,
        updatedAt: serverTimestamp()
      });
      if (!success) throw new Error("The booking source changes were not saved.");
    } catch (error) {
      setBookingSources(previous);
      throw error;
    }
  };

  const addBookingSource = async (config: BookingSourceConfig) => {
    const normalized = normalizeBookingSourceConfig(config);
    if (bookingSources.some((s) => s.source === normalized.source)) {
      throw new Error(`A booking source with key "${normalized.source}" already exists.`);
    }
    await persistBookingSources([...bookingSources, normalized]);
  };

  const updateBookingSource = async (source: string, updates: Partial<Omit<BookingSourceConfig, "source">>) => {
    const next = bookingSources.map((s) =>
      s.source === source ? { ...s, ...updates, source: s.source } : s
    );
    await persistBookingSources(next);
  };

  const reorderBookingSources = async (next: BookingSourceConfig[]) => {
    // Same shape as `reorderPaymentMethods` — caller passes the new
    // full array in the desired order; we just persist. The Settings
    // UI is responsible for enforcing the "up arrow disabled on first
    // row, down arrow disabled on last row" rule.
    await persistBookingSources(next);
  };

  const deleteBookingSource = async (source: string) => {
    // Per NBS-05: protected sources cannot be deleted. `online` /
    // `walk-in` / `corporate` are written by server code paths and
    // deleting any of them breaks booking creation outright.
    if (PROTECTED_BOOKING_SOURCES.includes(source as ProtectedBookingSource)) {
      throw new Error(`"${source}" is a protected booking source and cannot be deleted.`);
    }
    // Also block deletion if any booking uses the source (second
    // line of defense, same posture as `deletePaymentMethod`).
    const attached = bookings.filter((b) => b.source === source);
    if (attached.length > 0) {
      throw new Error(
        `${attached.length} booking${attached.length === 1 ? "" : "s"} reference this source. Reassign those bookings or disable this source instead.`
      );
    }
    await persistBookingSources(bookingSources.filter((s) => s.source !== source));
  };

  const persistPaymentMethods = async (next: PaymentMethodConfig[]) => {
    const sanitized = next.map((method) => {
      const clean: PaymentMethodConfig = {
        method: method.method,
        label: method.label,
        accountName: method.accountName,
        accountNumber: method.accountNumber,
        qrUrl: method.qrUrl,
        isEnabled: method.isEnabled
      };
      if (typeof method.showInStore === "boolean") clean.showInStore = method.showInStore;
      if (typeof method.showInCorporate === "boolean") clean.showInCorporate = method.showInCorporate;
      if (typeof method.requireReferenceNumber === "boolean") clean.requireReferenceNumber = method.requireReferenceNumber;
      return clean;
    });
    setPaymentMethods(sanitized);
    try {
      await updateSettings("hotelConfig", { paymentMethods: sanitized });
    } catch (error) {
      console.error("Failed to save payment methods:", error);
      notify.error("Failed to save payment methods", error instanceof Error ? error.message : "Unknown error");
    }
  };

  const addPaymentMethod = async (config: PaymentMethodConfig) => {
    const normalized: PaymentMethodConfig = {
      method: config.method.trim(),
      label: config.label.trim(),
      accountName: config.accountName.trim(),
      accountNumber: config.accountNumber.trim(),
      qrUrl: config.qrUrl,
      isEnabled: config.isEnabled,
      showInStore: config.showInStore,
      showInCorporate: config.showInCorporate,
      requireReferenceNumber: config.requireReferenceNumber
    };
    if (!normalized.method) {
      notify.error("Cannot add payment method", "Method key is required.");
      return;
    }
    if (paymentMethods.some((p) => p.method === normalized.method)) {
      notify.error("Method key already exists", `A payment method with key "${normalized.method}" is already configured.`);
      return;
    }
    await persistPaymentMethods([...paymentMethods, normalized]);
  };

  const updatePaymentMethod = async (method: string, updates: Partial<PaymentMethodConfig>) => {
    const next = paymentMethods.map((p) => (p.method === method ? { ...p, ...updates, method: p.method } : p));
    await persistPaymentMethods(next);
  };

  const reorderPaymentMethods = async (next: PaymentMethodConfig[]) => {
    await persistPaymentMethods(next);
  };

  // Count bookings that reference a given payment method key so
  // the admin UI can block deletion with a clear message. One-shot
  // `getDocs` — not subscribed, since the count is only read when
  // the admin clicks Delete.
  const countBookingsUsingPaymentMethod = async (method: string): Promise<number> => {
    try {
      const match = query(collection(db, "bookings"), where("paymentMethod", "==", method));
      const snap = await getDocs(match);
      return snap.size;
    } catch (error) {
      console.error("Failed to count bookings for payment method:", error);
      return 0;
    }
  };

  // Best-effort Storage cleanup of the QR for a given method. The
  // listing catches every file under
  // `assets/payment-methods/{method}/`. Failures are non-fatal —
  // the file just becomes orphaned.
  const deletePaymentMethodQrStorage = async (method: string) => {
    try {
      const folderRef = storageRef(storage, `assets/payment-methods/${method}`);
      const listed = await listAll(folderRef);
      await Promise.all(listed.items.map((item) => deleteObject(item).catch(() => undefined)));
    } catch (storageErr) {
      console.warn(`Storage cleanup for payment method ${method} QR skipped:`, storageErr);
    }
  };

  const deletePaymentMethod = async (method: string) => {
    // Defense-in-depth: protected methods (currently `pay-at-hotel`)
    // cannot be deleted at all, regardless of how many bookings
    // reference them. The UI hides the Delete button for these
    // methods; this guard catches any future code path that calls
    // `deletePaymentMethod` directly (e.g. a bulk import, a
    // devtools session, etc.). See `PROTECTED_PAYMENT_METHODS` in
    // `shared/constants` for the full list and rationale.
    if ((PROTECTED_PAYMENT_METHODS as readonly string[]).includes(method)) {
      notify.error(
        "Cannot delete payment method",
        `"${method}" is required and cannot be removed. Use the on/off toggle to hide it from guests.`
      );
      return;
    }
    const bookingCount = await countBookingsUsingPaymentMethod(method);
    if (bookingCount > 0) {
      notify.error(
        "Cannot delete payment method",
        `${bookingCount} ${bookingCount === 1 ? "booking references" : "bookings reference"} "${method}". Reassign or close those bookings first.`
      );
      return;
    }
    await deletePaymentMethodQrStorage(method);
    await persistPaymentMethods(paymentMethods.filter((p) => p.method !== method));
  };

  // Per `plan/features/SETTINGS.md §Payment Methods` — upload (or
  // replace) a QR code image for a single payment method. Compresses
  // client-side via `compressImageFile` (PNG, max 800x800, quality
  // 0.9 — QR codes are sharp monochrome and JPEG artifacts destroy
  // scannability, so the default JPEG path is explicitly overridden).
  // The download URL is written into
  // `settings/hotelConfig.paymentMethods[i].qrUrl` via merged
  // `setDoc`. The previous QR is best-effort deleted from Storage.
  const uploadPaymentMethodQr = async (
    method: string,
    file: File
  ): Promise<{ success: boolean; error?: string; url?: string }> => {
    const target = paymentMethods.find((p) => p.method === method);
    if (!target) {
      const err = `Unknown payment method: ${method}`;
      notify.error("Upload failed", err);
      return { success: false, error: err };
    }
    if (!file.type.startsWith("image/")) {
      const err = "Please choose an image file.";
      notify.error("Upload failed", err);
      return { success: false, error: err };
    }
    if (file.size > MAX_PAYMENT_METHOD_QR_BYTES) {
      const err = `Image must be smaller than ${Math.round(MAX_PAYMENT_METHOD_QR_BYTES / 1024 / 1024)} MB.`;
      notify.error("File too large", err);
      return { success: false, error: err };
    }
    const previousUrl = target.qrUrl;
    try {
      const compressed = await compressImageFile(file, {
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.9,
        mimeType: "image/png"
      });
      const safeName = compressed.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `assets/payment-methods/${method}/${Date.now()}-${safeName}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, compressed.file);
      const url = await getDownloadURL(fileRef);
      await updatePaymentMethod(method, { qrUrl: url });
      if (previousUrl) {
        try {
          await deleteObject(storageRef(storage, previousUrl));
        } catch (storageErr) {
          console.warn(`Storage delete for previous QR ${previousUrl} skipped:`, storageErr);
        }
      }
      notify.success("QR uploaded", `${target.label} QR code updated.`);
      return { success: true, url };
    } catch (error) {
      console.error("Error uploading payment method QR:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to upload QR", message);
      return { success: false, error: message };
    }
  };

  // Reset the QR for a given method — clear the URL in Firestore and
  // best-effort delete the previous Storage object. Mirrors
  // `resetBrandingAsset` semantics. The guest booking page falls
  // back to the per-method `accountName` / `accountNumber` text
  // (and the global `config.legalName` / `config.frontDeskPhone`
  // fallbacks) when the QR is empty.
  const resetPaymentMethodQr = async (method: string): Promise<{ success: boolean; error?: string }> => {
    const target = paymentMethods.find((p) => p.method === method);
    if (!target) {
      const err = `Unknown payment method: ${method}`;
      notify.error("Reset failed", err);
      return { success: false, error: err };
    }
    const previousUrl = target.qrUrl;
    try {
      await updatePaymentMethod(method, { qrUrl: "" });
      if (previousUrl) {
        try {
          await deleteObject(storageRef(storage, previousUrl));
        } catch (storageErr) {
          console.warn(`Storage delete for QR ${previousUrl} skipped:`, storageErr);
        }
      }
      notify.success("QR cleared", `${target.label} QR code removed.`);
      return { success: true };
    } catch (error) {
      console.error("Error resetting payment method QR:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to clear QR", message);
      return { success: false, error: message };
    }
  };

  // Room Types State — sourced from settings/hotelConfig.roomTypes
  // (per W3.3). The hotelConfig onSnapshot writes to the local
  // state when the field is present; the admin save handler below
  // persists back to Firestore. Each entry carries its own
  // `imageUrls[]` (per W3.5) AND the type-level pricing + capacity
  // model (per W3.6) so all rooms of a type share the same gallery,
  // occupancy cap, and rate matrix.
  const [roomTypes, setRoomTypes] = useState<RoomTypeEntry[]>(() => {
    return DEFAULT_ROOM_TYPES.map((t) => ({ ...t, imageUrls: [...t.imageUrls] }));
  });
  // Per RTS-06 (2026-08-01): distinguish "not loaded yet" from "loaded
  // and legitimately empty". The previous `roomTypes.length > 0` guard
  // meant that a hotel which had deleted every room type would, on the
  // next page load, see the snapshot's `[]` value, skip the effect, and
  // fall back to the DEFAULT_ROOM_TYPES initializer — silently resurrecting
  // all 8 deleted types. The flag flips to `true` after the first sync
  // (whatever the length), and from then on the effect always syncs.
  const [roomTypesLoaded, setRoomTypesLoaded] = useState(false);

  useEffect(() => {
    if (Array.isArray(hotelConfig.roomTypes)) {
      setRoomTypes(
        hotelConfig.roomTypes.map((t: any) => ({
          value: t.value,
          label: t.label || t.value,
          shortLabel: t.shortLabel || t.label || t.value,
          imageUrls: Array.isArray(t.imageUrls) ? t.imageUrls : [],
          bedDefinition: t.bedDefinition || "",
          description: t.description || "",
          amenities: Array.isArray(t.amenities) ? t.amenities : [],
          maxCapacity: Number(t.maxCapacity) || 1,
          pricePerNight: Number(t.pricePerNight) || 0,
          weekendRate: Number(t.weekendRate) || 0,
          corporateRate: Number(t.corporateRate) || 0,
          // Per MRB-15-10 (2026-08-03, per decision #183):
          // the previous hydration mapping dropped the
          // three CHD-03 / EXB-01 fields below, which
          // silently reset them to `?? 0` on every snapshot
          // echo. The Edit form's `defaultValue={editType
          // .maxChildren ?? 0}` then rendered 0 in the
          // input even when Firestore held a non-zero
          // value, the table's `{type.maxChildren ?? 0}`
          // always showed 0 children, and a save that
          // DIDN'T touch the field would overwrite the
          // stored value with the form's 0. Preserve
          // every field the type's contract guarantees.
          maxChildren: Math.max(0, Math.floor(Number(t.maxChildren) || 0)),
          maxExtraBeds: Math.max(0, Math.floor(Number(t.maxExtraBeds) || 0)),
          extraBedRate: Math.max(0, Number(t.extraBedRate) || 0)
        }))
      );
      setRoomTypesLoaded(true);
    }
  }, [hotelConfig.roomTypes]);

  const saveRoomTypes = async (newTypes: RoomTypeEntry[]) => {
    // Capture the prior state so we can roll back on a failed write.
    // Previously the optimistic `setRoomTypes(newTypes)` ran before
    // the Firestore write and was never rolled back — a failed write
    // would leave the UI showing a delete/add/update that never
    // persisted, and the row would silently come back on the next
    // snapshot. That swallowed failures is RTS-04.
    const previousTypes = roomTypes;
    setRoomTypes(newTypes);
    try {
      // Fresh-project safe replacement for the old updateDoc(doc(db, "settings", "hotelConfig")) write.
      const success = await updateSettings("hotelConfig", {
        roomTypes: newTypes,
        updatedAt: serverTimestamp()
      });
      if (!success) {
        // `updateSettings` caught its own error, fired the toast, and
        // returned `false` — roll back and surface the failure so the
        // caller can react (e.g. the Settings delete handler shows its
        // own error and keeps the row armed).
        setRoomTypes(previousTypes);
        throw new Error("Failed to persist room types to settings.");
      }
    } catch (error) {
      setRoomTypes(previousTypes);
      console.error("Failed to save room types to Firestore:", error);
      throw error;
    }
  };

  const addRoomType = async (
    rt: {
      value: string;
      label: string;
      shortLabel: string;
      imageUrls?: string[];
      bedDefinition: string;
      description: string;
      amenities: string[];
      maxCapacity: number;
      // Per CHD-02 (2026-08-01, per decision #144): per-type child
      // cap. `maxCapacity` is the ADULT cap. `maxChildren` is the
      // CHILD cap (0 = no children allowed, e.g. a Single).
      maxChildren?: number;
      pricePerNight: number;
      weekendRate: number;
      corporateRate: number;
      // Per EXB-01 (2026-07-31): extra-bed allowance + rate.
      maxExtraBeds?: number;
      extraBedRate?: number;
    }
  ) => {
    const newType: RoomTypeEntry = {
      value: rt.value,
      label: rt.label,
      shortLabel: rt.shortLabel,
      imageUrls: Array.isArray(rt.imageUrls) ? rt.imageUrls : [],
      bedDefinition: rt.bedDefinition.trim(),
      description: rt.description || "",
      amenities: Array.isArray(rt.amenities) ? rt.amenities.filter((a) => a && a.trim()) : [],
      maxCapacity: Math.max(1, Math.floor(rt.maxCapacity)),
      // Per CHD-02: child cap. The seed (0/1/1/1/2) lives in
      // `DEFAULT_ROOM_TYPES` for the initial population; the
      // admin can tune per-type here. The Add form's default
      // reads from the type's existing record when editing.
      maxChildren: Math.max(0, Math.floor(Number(rt.maxChildren) || 0)),
      pricePerNight: Math.max(0, rt.pricePerNight),
      weekendRate: Math.max(0, rt.weekendRate),
      corporateRate: Math.max(0, rt.corporateRate),
      // Per EXB-01 (2026-07-31): extra-bed allowance + rate.
      // `maxExtraBeds` of 0 means the type does not allow extra
      // beds (no separate `allowsExtraBed` boolean per the spec).
      maxExtraBeds: Math.max(0, Math.floor(Number(rt.maxExtraBeds) || 0)),
      extraBedRate: Math.max(0, Number(rt.extraBedRate) || 0)
    };
    const updated = [...roomTypes, newType];
    await saveRoomTypes(updated);
  };

  const updateRoomType = async (
    value: string,
    updates: Partial<
      Pick<
        RoomTypeEntry,
        | "label"
        | "shortLabel"
        | "imageUrls"
        | "bedDefinition"
        | "description"
        | "amenities"
        | "maxCapacity"
        | "maxChildren"
        | "pricePerNight"
        | "weekendRate"
        | "corporateRate"
        | "maxExtraBeds"
        | "extraBedRate"
      >
    >
  ) => {
    const updated = roomTypes.map((t) => (t.value === value ? { ...t, ...updates } : t));
    await saveRoomTypes(updated);
  };

  const deleteRoomType = async (value: string) => {
    const attachedRooms = rooms.filter((room) => room.type === value);
    if (attachedRooms.length > 0) {
      const message = `${attachedRooms.length} room${attachedRooms.length === 1 ? "" : "s"} still use this type. Reassign those rooms before deleting the type.`;
      notify.error("Cannot delete room type", message);
      throw new Error(message);
    }
    // Best-effort cleanup of the type's photos in Storage. The room
    // type may already be detached from any room; orphaned files
    // do not block the type deletion.
    try {
      const folderRef = storageRef(storage, `room-types/${value}`);
      const listed = await listAll(folderRef);
      await Promise.all(listed.items.map((item) => deleteObject(item).catch(() => undefined)));
    } catch (storageErr) {
      console.warn(`Storage cleanup for room type ${value} skipped:`, storageErr);
    }
    const updated = roomTypes.filter((t) => t.value !== value);
    await saveRoomTypes(updated);
  };

  // Per `plan/features/SETTINGS.md §Room Types` — upload a single
  // photo for a room type, append its download URL to the type's
  // `imageUrls[]`, and persist. Enforces `MAX_ROOM_TYPE_PHOTOS`.
  // Per MRB-15-11 (2026-08-04, per decision #188): the
  // read-modify-write is wrapped in `runTransaction` so the
  // multi-photo upload race is eliminated. The pre-MRB-15-11
  // shape read from the in-memory `roomTypes` cache (a
  // React-side copy of the Firestore snapshot) and wrote the
  // full array via `updateRoomType` → `saveRoomTypes`; a
  // `for (const file of accepted) { await uploadRoomTypePhoto(...) }`
  // loop in the SettingsPage handler would read stale
  // in-memory state between iterations because the
  // subscription hadn't fired the previous write locally yet,
  // so the (N+1)th call would overwrite the array with a
  // single-element array `[url(N+1)]`. The transaction reads
  // from Firestore (`tx.get(hotelConfigRef)`) so every call
  // sees the latest committed state. The Storage upload
  // stays OUTSIDE the transaction (Storage ops can't be in a
  // Firestore tx); the cap check moves INSIDE the transaction
  // so a parallel admin's append can't slip past the cap;
  // the on-cap-reject cleanup deletes the just-uploaded
  // Storage object so it doesn't become an orphan.
  const uploadRoomTypePhoto = async (typeValue: string, file: File): Promise<{ success: boolean; error?: string; url?: string }> => {
    // Client-side UX hint: disable the upload button when
    // the in-memory state already shows the cap reached.
    // The transaction-side cap check is the source of truth.
    const type = roomTypes.find((t) => t.value === typeValue);
    if (!type) return { success: false, error: "Room type not found." };
    if (type.imageUrls.length >= MAX_ROOM_TYPE_PHOTOS) {
      const error = `Maximum ${MAX_ROOM_TYPE_PHOTOS} photos per room type.`;
      notify.warning("Photo limit reached", error);
      return { success: false, error };
    }
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `room-types/${typeValue}/${Date.now()}-${safeName}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      const hotelConfigRef = doc(db, "settings", "hotelConfig");
      // Set by the transaction body when the cap is exceeded
      // (a parallel admin landed between the client-side
      // check and the transaction commit). The transaction
      // returns normally without writing when this fires, so
      // no Firestore retries are spent on a terminal reject.
      let capRejected = false;
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(hotelConfigRef);
          const data = snap.data();
          const currentRoomTypes = Array.isArray(data?.roomTypes) ? data.roomTypes : [];
          const idx = currentRoomTypes.findIndex((t) => t.value === typeValue);
          if (idx < 0) {
            // The type was deleted between the client check
            // and the transaction. Treat as a cap-reject
            // path (cleanup + return false) — the user can
            // refresh and re-pick.
            throw new Error("Room type not found in settings document.");
          }
          const current = currentRoomTypes[idx];
          const currentImageUrls = Array.isArray(current.imageUrls) ? current.imageUrls : [];
          if (currentImageUrls.length >= MAX_ROOM_TYPE_PHOTOS) {
            capRejected = true;
            // Don't write — return normally so the
            // transaction commits a no-op.
            return;
          }
          const newRoomTypes = [...currentRoomTypes];
          newRoomTypes[idx] = { ...current, imageUrls: [...currentImageUrls, url] };
          tx.update(hotelConfigRef, {
            roomTypes: newRoomTypes,
            updatedAt: serverTimestamp()
          });
        });
      } catch (txErr) {
        // Non-cap-reject failure (type deleted, network,
        // permission). Best-effort cleanup of the
        // just-uploaded Storage object.
        await deleteObject(fileRef).catch((cleanupErr) => {
          console.warn(`Storage cleanup for failed upload ${path} skipped:`, cleanupErr);
        });
        throw txErr;
      }
      if (capRejected) {
        await deleteObject(fileRef).catch((cleanupErr) => {
          console.warn(`Storage cleanup for capped upload ${path} skipped:`, cleanupErr);
        });
        const error = `Maximum ${MAX_ROOM_TYPE_PHOTOS} photos per room type.`;
        notify.warning("Photo limit reached", error);
        return { success: false, error };
      }
      return { success: true, url };
    } catch (error) {
      console.error("Error uploading room type photo:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to upload photo", message);
      return { success: false, error: message };
    }
  };

  // Remove a single photo: drop the URL from the type's array and
  // best-effort delete the underlying Storage object. The list
  // update always runs even if the Storage delete fails (the file
  // becomes orphaned but the type stays consistent).
  // Per MRB-15-11: same `runTransaction` wrap as upload — the
  // pre-MRB-15-11 read-modify-write on the in-memory
  // `roomTypes` cache had the same race as the upload path
  // (the SettingsPage handler at `SettingsPage.tsx:5660`
  // triggers this on the per-photo delete click; a
  // concurrent reorder or upload could clobber the in-memory
  // read).
  const removeRoomTypePhoto = async (typeValue: string, url: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const hotelConfigRef = doc(db, "settings", "hotelConfig");
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(hotelConfigRef);
        const data = snap.data();
        const currentRoomTypes = Array.isArray(data?.roomTypes) ? data.roomTypes : [];
        const idx = currentRoomTypes.findIndex((t) => t.value === typeValue);
        if (idx < 0) {
          throw new Error("Room type not found in settings document.");
        }
        const current = currentRoomTypes[idx];
        const currentImageUrls: string[] = Array.isArray(current.imageUrls) ? current.imageUrls : [];
        const newImageUrls = currentImageUrls.filter((u: string) => u !== url);
        const newRoomTypes = [...currentRoomTypes];
        newRoomTypes[idx] = { ...current, imageUrls: newImageUrls };
        tx.update(hotelConfigRef, {
          roomTypes: newRoomTypes,
          updatedAt: serverTimestamp()
        });
      });
      // Best-effort Storage cleanup after the Firestore write
      // commits. The list update always runs even if the
      // Storage delete fails (the file becomes orphaned but
      // the type stays consistent).
      try {
        const fileRef = storageRef(storage, url);
        await deleteObject(fileRef);
      } catch (storageErr) {
        console.warn(`Storage delete for ${url} skipped:`, storageErr);
      }
      return { success: true };
    } catch (error) {
      console.error("Error removing room type photo:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to remove photo", message);
      return { success: false, error: message };
    }
  };

  // Persist a new ordering of `imageUrls[]` for a room type.
  // Per MRB-15-11: same `runTransaction` wrap as upload +
  // remove — the pre-MRB-15-11 read-modify-write on the
  // in-memory `roomTypes` cache had the same race (drag-to-
  // reorder is a single-user action, lower race surface, but
  // using the same pattern keeps the contract consistent and
  // gets the same atomicity guarantee).
  const reorderRoomTypePhotos = async (typeValue: string, imageUrls: string[]): Promise<{ success: boolean; error?: string }> => {
    try {
      const hotelConfigRef = doc(db, "settings", "hotelConfig");
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(hotelConfigRef);
        const data = snap.data();
        const currentRoomTypes = Array.isArray(data?.roomTypes) ? data.roomTypes : [];
        const idx = currentRoomTypes.findIndex((t) => t.value === typeValue);
        if (idx < 0) {
          throw new Error("Room type not found in settings document.");
        }
        const current = currentRoomTypes[idx];
        const newRoomTypes = [...currentRoomTypes];
        newRoomTypes[idx] = { ...current, imageUrls };
        tx.update(hotelConfigRef, {
          roomTypes: newRoomTypes,
          updatedAt: serverTimestamp()
        });
      });
      return { success: true };
    } catch (error) {
      console.error("Error reordering room type photos:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to save photo order", message);
      return { success: false, error: message };
    }
  };

  // Per `plan/features/SETTINGS.md §Branding`: upload (or reset) a
  // single branding asset (per-page hero photo or logo override).
  // The `key` is a dot-path inside `settings/websiteContent` — e.g.
  // "homepage.heroPhotoUrl", "about.heroPhotoUrl",
  // "corporate.heroPhotoUrl", "rewards.heroPhotoUrl",
  // "branding.logoNavbar", "branding.logoNavbarOnDark",
  // "branding.logoFooter". Uploaded to Firebase Storage at
  // `assets/branding/{key-as-path}/{timestamp}-{safeName}` (the
  // `match /assets/branding/{fileName}` rule already exists with
  // public read + staff write — see `firebase/storage.rules`).
  // The download URL is written back to Firestore via a merged
  // `setDoc` on the `settings/websiteContent` document so the
  // existing `onSnapshot` listener updates the admin UI in place.
  const BRANDING_KEY_RE = /^(homepage|about|corporate|rewards)\.hero(PhotoUrl|Heading|Subtext|Eyebrow)$|^branding\.(logoNavbar|logoNavbarOnDark|logoFooter)$/;

  function parseBrandingKey(key: string): { section: string; field: string } | null {
    if (!BRANDING_KEY_RE.test(key)) return null;
    const [section, ...rest] = key.split(".");
    return { section, field: rest.join(".") };
  }

  const uploadBrandingAsset = async (
    key: string,
    file: File
  ): Promise<{ success: boolean; error?: string; url?: string }> => {
    const parsed = parseBrandingKey(key);
    if (!parsed) {
      const err = `Invalid branding key: ${key}`;
      notify.error("Upload failed", err);
      return { success: false, error: err };
    }
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      // `key` is safe (BRANDING_KEY_RE restricts it to known paths) so
      // it can be embedded directly in the storage path.
      const path = `assets/branding/${key.replace(/\./g, "/")}/${Date.now()}-${safeName}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      await setDoc(
        doc(db, "settings", "websiteContent"),
        { [parsed.section]: { [parsed.field]: url } },
        { merge: true }
      );
      notify.success("Uploaded", `${key} updated.`);
      return { success: true, url };
    } catch (error) {
      console.error(`Error uploading branding asset ${key}:`, error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to upload", message);
      return { success: false, error: message };
    }
  };

  // Reset a branding asset: write an empty string so the guest app
  // falls back to the deploy-time static logo (from
  // `hotel.config.ts → logos.*`) or the static image fallback in
  // `guest-app/src/data/homepage.ts`. Best-effort deletes the
  // underlying Storage object — failures here are non-fatal since
  // the URL is no longer referenced.
  const resetBrandingAsset = async (key: string): Promise<{ success: boolean; error?: string }> => {
    const parsed = parseBrandingKey(key);
    if (!parsed) {
      const err = `Invalid branding key: ${key}`;
      notify.error("Reset failed", err);
      return { success: false, error: err };
    }
    try {
      const current = (websiteContent as Record<string, unknown>)?.[parsed.section] as
        | Record<string, unknown>
        | undefined;
      const previousUrl = typeof current?.[parsed.field] === "string" ? (current?.[parsed.field] as string) : "";
      await setDoc(
        doc(db, "settings", "websiteContent"),
        { [parsed.section]: { [parsed.field]: "" } },
        { merge: true }
      );
      if (previousUrl) {
        try {
          const fileRef = storageRef(storage, previousUrl);
          await deleteObject(fileRef);
        } catch (storageErr) {
          console.warn(`Storage delete for ${previousUrl} skipped:`, storageErr);
        }
      }
      notify.success("Reset", `${key} reverted to default.`);
      return { success: true };
    } catch (error) {
      console.error(`Error resetting branding asset ${key}:`, error);
      const message = error instanceof Error ? error.message : "Unknown error";
      notify.error("Failed to reset", message);
      return { success: false, error: message };
    }
  };

  // Staff Accounts — live from `guests/{uid}` where role is staff (front-desk | admin).
  // Per SETTINGS.md §4 + audit S5.2: this is the source of truth for the Staff
  // Accounts tab. The /api/admin/create-staff and /api/admin/disable-staff
  // handlers write here transactionally; Firestore listeners refresh the UI.
  const [staff, setStaff] = useState<StaffMember[]>([]);

  // Test Runs (ETR)
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [testRunsLoading, setTestRunsLoading] = useState(false);

  const refreshTestRuns = useCallback(async () => {
    if (!currentUser) return;
    try {
      setTestRunsLoading(true);
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/list`, {
        method: "GET",
        headers: {
          "Authorization": token ? `Bearer ${token}` : ""
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestRuns(data.data || []);
      }
    } catch (err: any) {
      console.error("Error fetching test runs:", err);
    } finally {
      setTestRunsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      refreshTestRuns();
      const interval = setInterval(refreshTestRuns, 30000);
      return () => clearInterval(interval);
    }
  }, [currentUser, refreshTestRuns]);

  const createTestRun = async (input: {
    name: string;
    environment: "staging" | "production";
    durationMinutes: number;
  }): Promise<{ success: boolean; error?: string; token?: string }> => {
    try {
      setTestRunsLoading(true);
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify(input)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to create test run." };
      }
      await refreshTestRuns();
      return { success: true, token: data.data?.token };
    } catch (err: any) {
      console.error("Error creating test run:", err);
      return { success: false, error: err?.message || "Failed to create test run." };
    } finally {
      setTestRunsLoading(false);
    }
  };

  const closeTestRun = async (runId: string): Promise<{ success: boolean; error?: string; manifest?: any }> => {
    try {
      setTestRunsLoading(true);
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ runId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to close test run." };
      }
      await refreshTestRuns();
      return { success: true, manifest: data.data?.manifest };
    } catch (err: any) {
      console.error("Error closing test run:", err);
      return { success: false, error: err?.message || "Failed to close test run." };
    } finally {
      setTestRunsLoading(false);
    }
  };

  const deleteTestRun = async (runId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setTestRunsLoading(true);
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ runId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to delete test run data." };
      }
      await refreshTestRuns();
      return { success: true };
    } catch (err: any) {
      console.error("Error deleting test run data:", err);
      return { success: false, error: err?.message || "Failed to delete test run data." };
    } finally {
      setTestRunsLoading(false);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    const staffRef = query(
      collection(db, "guests"),
      where("role", "in", ["front-desk", "admin"])
    );
    const unsubscribe = onSnapshot(
      staffRef,
      (snapshot) => {
        const staffData: StaffMember[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const createdAt = data.createdAt
            ? (typeof data.createdAt.toDate === "function"
                ? data.createdAt.toDate().toISOString()
                : String(data.createdAt))
            : "";
          const disabledAt = data.disabledAt
            ? (typeof data.disabledAt.toDate === "function"
                ? data.disabledAt.toDate().toISOString()
                : String(data.disabledAt))
            : null;
          staffData.push({
            uid: docSnap.id,
            fullName: data.fullName || "",
            email: data.email || "",
            phone: data.phone || "",
            nationality: data.nationality || "",
            role: data.role === "admin" ? "admin" : "front-desk",
            isActive: data.isActive !== false,
            createdAt,
            disabledAt,
            createdBy: data.createdBy || "",
            disabledBy: data.disabledBy || ""
          });
        });

        staffData.sort((a, b) => {
          if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
          return a.email.localeCompare(b.email);
        });
        setStaff(staffData);
      },
      (error) => {
        console.error("Error listening to staff collection:", error);
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const createStaff = async (input: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    nationality?: string;
    role: StaffRole;
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/admin/create-staff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          fullName: input.fullName,
          email: input.email,
          password: input.password,
          phone: input.phone || "",
          nationality: input.nationality || "",
          role: input.role
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to create staff account." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error creating staff account:", err);
      return { success: false, error: err?.message || "Failed to create staff account." };
    }
  };

  const disableStaff = async (uid: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/admin/disable-staff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ uid })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to disable staff account." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error disabling staff account:", err);
      return { success: false, error: err?.message || "Failed to disable staff account." };
    }
  };

  const updateStaff = async (input: {
    uid: string;
    fullName: string;
    email: string;
    phone?: string;
    nationality?: string;
    role: StaffRole;
    password?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/admin/update-staff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          uid: input.uid,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone || "",
          nationality: input.nationality || "",
          role: input.role,
          password: input.password || ""
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to update staff account." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error updating staff account:", err);
      return { success: false, error: err?.message || "Failed to update staff account." };
    }
  };

  const seasonalRateOverrides = normalizeSeasonalRateOverrides(hotelConfig.seasonalRateOverrides);

  return (
    <AdminContext.Provider
      value={{
        currentUser,
        authLoading,
        dashboardLoading: roomsLoading || bookingsLoading,
        roomsLoading,
        ratesLoading: settingsLoading || vouchersLoading,
        settingsLoading,
        sendPasswordReset,
        signIn,
        signOut,
        rooms,
        toggleHousekeepingStatus,
        updateRoomConfig,
        addRoomBlock,
        createRoom,
        deleteRoom,
        hasActiveBookings,
        bookings,
        reservations,
        reservationPaidAmount,
        updateBookingStatus,
        resolveEarlyCheckin,
        rescheduleBooking,
        addOnsitePayment,
        addWalkinBooking,
        resendBookingEmail,
        verifyAndRecordPayment,
        rejectPayment,
        setLouReceived,
        confirmBookingWithBalance,
        roomBlocks,
        createRoomBlock,
        updateRoomBlock,
        cancelRoomBlock,
        vouchers,
        addVoucher,
        updateVoucher,
        toggleVoucherActive,
        corporateCodes,
        addCorporateCode,
        updateCorporateCode,
        toggleCorporateCodeActive,
        deleteCorporateCode,
        corporateInquiries,
        updateInquiryStatus,
        addInquiryNote,
        convertInquiryToBooking,
        members,
        updateMemberPoints,
        toggleMemberActive,
        linkBookingToMember,
        intercoms,
        intercomThreads,
        sendIntercomMessage,
        markChatAsRead,
        setIntercomResolved,
        incomingCall,
        triggerIncomingCall,
        acceptCall,
        declineCall,
        audioRouting: audioRoutingState.routing,
        audioRoutingLoading: audioRoutingState.loading,
        audioRoutingError: audioRoutingState.error,
        applyAudioSink: audioRoutingState.applyToElement,
        updateAudioRouting: audioRoutingState.updateRouting,
        resetAudioRouting: audioRoutingState.resetToDefault,
        storeOrders,
        updateStoreOrderStatus,
        billStoreOrder,
        storeItems,
        addStoreItem,
        updateStoreItem,
        deleteStoreItem,
        hotelConfig,
        seasonalRateOverrides,
        websiteContent,
        websiteContentLoading,
        rewardsConfig,
        breakfastConfig,
        storeConfig,
        seoSettings,
        updateSettings,
        roomTypes,
        addRoomType,
        updateRoomType,
        deleteRoomType,
        saveRoomTypes,
        uploadRoomTypePhoto,
        removeRoomTypePhoto,
        reorderRoomTypePhotos,
        uploadBrandingAsset,
        resetBrandingAsset,
        paymentMethods,
        addPaymentMethod,
        updatePaymentMethod,
        reorderPaymentMethods,
        deletePaymentMethod,
        uploadPaymentMethodQr,
        resetPaymentMethodQr,
        bookingSources,
        addBookingSource,
        updateBookingSource,
        reorderBookingSources,
        deleteBookingSource,
        staff,
        createStaff,
        disableStaff,
        updateStaff,
        unreadIntercomCount,
        soundsEnabled,
        setSoundsEnabled,
        playSynthNotification,
        notifications,
        notificationsLoading,
        unreadNotificationCount,
        markNotificationRead,
        markAllNotificationsRead,
        testRuns,
        testRunsLoading,
        createTestRun,
        closeTestRun,
        deleteTestRun,
        refreshTestRuns
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
}
