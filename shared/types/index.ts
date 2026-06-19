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

export interface Room {
  id: string;
  name: string;
  roomNumber: string;
  type: RoomType;
  description: string;
  maxCapacity: number;
  bedDefinition: string;
  pricePerNight: number;
  weekendRate: number;
  corporateRate: number;
  amenities: string[];
  isActive: boolean;
  status: RoomStatus;
  housekeepingStatus: HousekeepingStatus;
  blockReason: string;
  remarks: string;
  qrToken?: string;
  createdAt: Date;
  updatedAt: Date;
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
  paymentProofUrl: string;
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
