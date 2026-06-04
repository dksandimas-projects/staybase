# TypeScript Types
> Requires: CLAUDE.md, docs/BACKEND.md

---

## Overview

All shared TypeScript types live in `shared/types/`. Both apps import from here via `@shared/types`.

Never redefine these types in app-level files. Never duplicate type definitions across apps.

Types are derived from Zod schemas where validation is needed — use `z.infer<typeof Schema>` to get the TypeScript type.

---

## Room

```
// RoomType is NOT a fixed enum — it is a free-form string matching a value
// in hotel.config.ts → roomTypes[].value
// e.g. "single", "deluxe-sea-view", "garden-suite"
// Use config.roomTypes[] to populate dropdowns and filters — never hardcode type values

RoomType = string   // matches hotel.config.ts → roomTypes[].value

RoomStatus = "available" | "occupied" | "blocked"
HousekeepingStatus = "clean" | "dirty" | "in-progress"

Room {
  id: string
  name: string
  roomNumber: string
  type: RoomType
  description: string
  maxCapacity: number
  bedDefinition: string
  pricePerNight: number
  weekendRate: number
  corporateRate: number
  amenities: string[]
  imageUrls: string[]
  isActive: boolean
  status: RoomStatus
  housekeepingStatus: HousekeepingStatus
  blockReason: string
  remarks: string
  createdAt: Date
  updatedAt: Date
}
```

---

## Booking

```
BookingStatus =
  "pending" | "payment-uploaded" | "payment-confirmed" |
  "confirmed" | "checked-in" | "checked-out" | "cancelled"

BookingSource = "online" | "walk-in" | "phone" | "facebook" | "corporate"

DiscountType = "" | "senior" | "pwd"

PaymentMethod = "pay-at-hotel" | "gcash" | "paypal" | string

Booking {
  id: string
  bookingRef: string
  roomId: string
  roomNumber: string
  roomType: RoomType
  guestName: string
  guestEmail: string
  guestPhone: string
  numGuests: number
  checkIn: Date
  checkOut: Date
  numNights: number
  ratePerNight: number
  totalPrice: number
  originalTotalPrice: number | null   // pre-discount total; set when discount applied; used to restore on rejection
  discountType: DiscountType
  discountPct: number
  discountIdPhotoUrl: string | null   // OSCA/PWD ID uploaded by guest at Step 3
  discountVerified: boolean           // staff marked ID as valid
  discountVerifiedBy: string | null   // staff UID
  discountRejected: boolean           // staff rejected the ID
  discountRejectedBy: string | null   // staff UID
  discountRejectionReason: string     // optional reason entered by staff
  voucherCode: string
  voucherDiscount: number
  isCorporate: boolean
  corporateCode: string
  companyName: string
  specialRequests: string
  status: BookingStatus
  paymentMethod: PaymentMethod
  paymentProofUrl: string
  source: BookingSource
  notes: string
  memberId: string | null
  pointsRedeemed: number              // points redeemed by staff (0 if none)
  pointsRedeemedValue: number         // ₱ value deducted from totalPrice (0 if none)
  pointsRedeemedBy: string | null     // staff UID who applied redemption
  pointsRedeemedAt: Date | null
  hasBreakfast: boolean
  breakfastRate: number
  guestIdPhotoUrl: string | null      // guest ID photo uploaded by front desk at check-in
  handledBy: string
  cancellationReason: string
  createdAt: Date
  updatedAt: Date
}

OnsitePayment {
  id: string
  amount: number
  method: PaymentMethod
  note: string
  recordedBy: string   // staff UID
  recordedAt: Date
}
```

---

## Staff (guests collection)

```
StaffRole = "front-desk" | "admin"

Staff {
  id: string
  fullName: string
  email: string
  phone: string
  nationality: string
  role: StaffRole
  createdAt: Date
}
```

---

## Member (Spark Rewards)

```
MemberTier = "standard"  // Phase 2: add Silver, Gold, etc.
MemberAuthProvider = "google" | "email"
PointsEntryType = "earn" | "redeem" | "manual" | "expire"

Member {
  id: string             // Firebase Auth UID
  memberNumber: string   // e.g. "SR-00042" — sequential, generated server-side on registration
  fullName: string
  email: string
  phone: string
  photoUrl: string
  authProvider: MemberAuthProvider
  isMember: boolean
  memberSince: Date
  rewardsPoints: number
  tier: MemberTier
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

PointsHistoryEntry {
  id: string
  type: PointsEntryType
  points: number
  description: string
  reason: string
  bookingId: string | null
  by: string
  at: Date
}
```

---

## Voucher

```
DiscountKind = "percent" | "flat"

Voucher {
  id: string
  code: string
  discountType: DiscountKind
  discountValue: number
  usageCap: number | null
  usageCount: number
  expiresAt: Date | null
  applicableRoomTypes: RoomType[]
  isActive: boolean
  createdBy: string
  createdAt: Date
}
```

---

## Corporate Code

```
CorporateCode {
  code: string
  companyName: string
  ratePerRoomType: Record<string, number>  // keys match hotel.config.ts → roomTypes[].value
  expiresAt: Date | null
  usageCap: number | null
  usageCount: number
  linkedInquiryId: string
  createdBy: string
  createdAt: Date
  isActive: boolean
}
```

---

## Corporate Inquiry

```
InquiryStatus = "new" | "contacted" | "negotiating" | "converted" | "declined"

InquiryNote {
  text: string
  by: string
  at: Date
}

CorporateInquiry {
  id: string
  companyName: string
  contactPerson: string
  email: string
  phone: string
  numRooms: number
  preferredDates: { from: Date; to: Date }
  specialRequirements: string
  status: InquiryStatus
  handler: string
  notes: InquiryNote[]
  accessCodeId: string
  createdAt: Date
}
```

---

## Settings

```
PaymentMethodConfig {
  method: string
  qrUrl: string
  accountInfo: string
  isEnabled: boolean
}

HotelConfig {
  hotelName: string
  address: string         // display string for UI
  contactEmail: string
  contactPhone: string
  frontDeskPhone: string  // used as tel: fallback in WebRTC intercom call
  facebookUrl: string
  instagramUrl: string
  checkInTime: string
  checkOutTime: string
  missionStatement: string
  visionStatement: string
  hotelStory: string
  paymentMethods: PaymentMethodConfig[]
  payAtHotelEnabled: boolean
  intercomQuickRequests: string[]
  notificationSoundUrl: string
}

// HotelConfig additions (in hotel.config.ts)
// memberNumberPrefix: string  — e.g. "SR" → "SR-00042"
// storeName: string           — e.g. "Spark Essentials"

RewardsEarningMode = "per-booking" | "per-spend"

RewardsConfig {
  pointsEnabled: boolean
  earningMode: RewardsEarningMode
  pointsPerBooking: number       // flat pts per completed stay (earningMode = "per-booking")
  pointsPerHundred: number       // pts per ₱100 of totalPrice (earningMode = "per-spend")
  memberDiscountEnabled: boolean
  memberDiscountPct: number
  pointsRedemptionRate: number   // ₱ value per 100 points (e.g. 100 = 100pts → ₱100)
}

WebsiteContentItem {
  title: string
  description: string
  icon: string
}

SparkRewardsPromo {
  heading: string
  description: string
  isEnabled: boolean
}

WebsiteContent {
  homepage: {
    heroHeading: string
    heroSubtext: string
    heroPhotoUrl: string
    amenities: WebsiteContentItem[]
    featuredRoomIds: string[]
    services: (WebsiteContentItem & { isEnabled: boolean })[]
    sparkRewards: SparkRewardsPromo
  }
  about: {
    heroPhotoUrl: string
  }
  corporate: {
    heroHeading: string
    heroSubtext: string
    heroPhotoUrl: string
    perks: WebsiteContentItem[]
  }
  privacyPolicyBody: string
  cancellationPolicy: string
  houseRules: string
}
```

---

## Intercom Message

```
SilogItem {
  id: string
  name: string          // e.g. "Tapsilog", "Longsilog", "Tocilog"
  isActive: boolean
}

BreakfastConfig {
  isEnabled: boolean
  ratePerPersonPerNight: number
  silogItems: SilogItem[]
}

BreakfastSelection {
  id: string
  bookingId: string
  roomNumber: string
  date: string          // ISO date "YYYY-MM-DD" — the breakfast morning
  guestIndex: number    // 0-based
  guestName: string
  silogId: string
  silogName: string     // snapshot
  enteredBy: string     // staff UID
  createdAt: Date
  updatedAt: Date
}
```

---

## Intercom Message

```
IntercomSender = "guest" | "front-desk"

IntercomMessage {
  id: string
  text: string
  sender: IntercomSender
  guestName: string
  timestamp: Date
  isRead: boolean
  isQuickRequest: boolean
  isStoreOrder: boolean
}
```

---

## Store

```
StoreItem {
  id: string
  name: string
  description: string
  price: number
  stock: number | null       // null = unlimited
  photoUrl: string
  isActive: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

StoreOrderItem {
  itemId: string
  name: string               // snapshot at order time
  price: number              // snapshot at order time
  quantity: number
}

StoreOrderStatus = "placed" | "confirmed" | "out-for-delivery" | "delivered" | "cancelled"
StorePaymentMethod = "cod" | "add-to-bill" | "gcash"

StoreOrder {
  id: string
  orderRef: string
  roomId: string
  roomNumber: string
  bookingId: string | null
  guestName: string
  items: StoreOrderItem[]
  totalAmount: number
  paymentMethod: StorePaymentMethod
  paymentProofUrl: string
  status: StoreOrderStatus
  isBilled: boolean
  billedAt: Date | null
  cancellationReason: string
  handledBy: string
  notes: string
  createdAt: Date
  updatedAt: Date
}

StorePaymentMethodConfig {
  method: StorePaymentMethod
  label: string
  qrUrl: string
  accountInfo: string
  isEnabled: boolean
}

StoreConfig {
  isEnabled: boolean
  lowStockThreshold: number
  paymentMethods: StorePaymentMethodConfig[]
}
```

---

## WebRTC Voice Call

```
WebRTCCallStatus = "ringing" | "active" | "ended"

WebRTCCall {
  roomId: string            // document ID = roomId
  offer: RTCSessionDescriptionInit
  answer: RTCSessionDescriptionInit | null
  status: WebRTCCallStatus
  guestName: string
  startedAt: Date
  endedAt: Date | null
}

IceCandidate {
  id: string
  candidate: RTCIceCandidateInit
  from: "guest" | "staff"
  createdAt: Date
}
```

---

## API Response

```
ApiSuccess<T> {
  success: true
  data: T
}

ApiError {
  success: false
  error: string
}

ApiResponse<T> = ApiSuccess<T> | ApiError
```

---

## Booking Form (Zod — Step by Step)

Zod schemas for the 4-step booking form live in `shared/schemas/booking.ts`. TypeScript types are derived via `z.infer`. See `plan/features/BOOKING-FLOW.md` for field-level validation rules.
