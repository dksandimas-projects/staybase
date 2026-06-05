# Backend — Firestore & Firebase
> Requires: CLAUDE.md

---

## Firebase Usage

**Auth + Firestore + Storage ONLY.**
No Firebase Hosting. No Cloud Functions. All server-side logic runs in Vercel API routes.
See `plan/docs/API-ROUTES.md` for API layer.

---

## Collections

### `rooms/{roomId}`

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. "Room 202 — Executive" |
| `roomNumber` | string | e.g. "202" |
| `type` | string | Free-form string matching a dynamic room type `value` (defaults defined in `@spark-inn/shared → DEFAULT_ROOM_TYPES`, managed at runtime via Admin UI) e.g. `"single"`, `"deluxe-sea-view"` |
| `description` | string | |
| `maxCapacity` | number | |
| `bedDefinition` | string | e.g. "1 queen size bed" |
| `pricePerNight` | number | Standard rate |
| `weekendRate` | number | |
| `corporateRate` | number | Flat public corporate rate (no code required) |
| `amenities` | string[] | e.g. `["WiFi", "AC", "Hot Shower", "Cable TV"]` |
| `imageUrls` | string[] | Firebase Storage URLs |
| `isActive` | boolean | `false` = hidden from guest site |
| `status` | string | `"available"` \| `"occupied"` \| `"blocked"` |
| `housekeepingStatus` | string | `"clean"` \| `"dirty"` \| `"in-progress"` |
| `blockReason` | string | `"Maintenance"` \| `"Hold"` \| `"Other"` \| `""` |
| `remarks` | string | Internal staff notes |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

### `bookings/{bookingId}`

| Field | Type | Notes |
|---|---|---|
| `bookingRef` | string | e.g. "SI-20260601-001" |
| `roomId` | string | Ref to `rooms/{roomId}` |
| `roomNumber` | string | Denormalized |
| `roomType` | string | Denormalized |
| `guestName` | string | |
| `guestEmail` | string | |
| `guestPhone` | string | |
| `numGuests` | number | |
| `checkIn` | timestamp | |
| `checkOut` | timestamp | |
| `numNights` | number | Computed at booking time |
| `ratePerNight` | number | Rate locked at booking time |
| `totalPrice` | number | Computed at booking time |
| `discountType` | string | `""` \| `"senior"` \| `"pwd"` |
| `discountPct` | number | `0` \| `20` |
| `discountIdPhotoUrl` | string \| null | Firebase Storage URL of OSCA/PWD ID upload — staff-only read |
| `discountVerified` | boolean | `false` until staff marks ID as verified in drawer |
| `discountVerifiedBy` | string \| null | Staff UID who verified the discount ID |
| `discountRejected` | boolean | `true` if staff rejected the discount ID |
| `discountRejectedBy` | string \| null | Staff UID who rejected |
| `discountRejectionReason` | string | Optional reason entered by staff at rejection |
| `originalTotalPrice` | number \| null | Pre-discount total — stored at booking creation if a discount was applied; used to restore `totalPrice` on rejection |
| `voucherCode` | string | Applied promo voucher code (if any) |
| `voucherDiscount` | number | Flat ₱ or % discount from voucher |
| `isCorporate` | boolean | `true` if booked via `/corporate/book` |
| `corporateCode` | string | Access code used (if any) |
| `companyName` | string | Corporate bookings only |
| `specialRequests` | string | |
| `status` | string | `"pending"` \| `"payment-uploaded"` \| `"payment-confirmed"` \| `"confirmed"` \| `"checked-in"` \| `"checked-out"` \| `"cancelled"` |
| `paymentMethod` | string | `"pay-at-hotel"` \| `"gcash"` \| `"paypal"` \| other |
| `paymentProofUrl` | string | Firebase Storage URL |
| `source` | string | `"online"` \| `"walk-in"` \| `"phone"` \| `"facebook"` \| `"corporate"` |
| `notes` | string | Internal staff notes |
| `handledBy` | string | Staff UID |
| `memberId` | string \| null | Firebase Auth UID of member (if booked while logged in or linked post-registration) |
| `pointsRedeemed` | number | Points redeemed by staff against this booking (0 if none) |
| `pointsRedeemedValue` | number | ₱ value of redeemed points deducted from `totalPrice` (0 if none) |
| `pointsRedeemedBy` | string \| null | Staff UID who applied the redemption |
| `pointsRedeemedAt` | timestamp \| null | When redemption was applied |
| `hasBreakfast` | boolean | `true` if breakfast add-on purchased |
| `breakfastRate` | number | Rate per person per night at booking time (locked) |
| `cancellationReason` | string | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

### `bookings/{bookingId}/payments/{paymentId}`

Subcollection — audit trail of all onsite payments recorded by staff. Append-only, never edited or deleted.

| Field | Type | Notes |
|---|---|---|
| `amount` | number | ₱ amount collected |
| `method` | string | `"cash"` \| `"gcash"` \| `"paypal"` \| other method name from `hotelConfig.paymentMethods` |
| `note` | string | Optional context (e.g. "Balance after discount rejection") |
| `recordedBy` | string | Staff UID |
| `recordedAt` | timestamp | |

Outstanding balance = `booking.totalPrice − sum(payments[].amount)` — computed client-side, never stored.

**Security rules:** Staff/Admin read + create; no updates or deletes (immutable audit trail).

---

### `guests/{userId}`

Staff accounts only (Front Desk + Admin). Document ID = Firebase Auth UID.

| Field | Type | Notes |
|---|---|---|
| `fullName` | string | |
| `email` | string | |
| `phone` | string | |
| `nationality` | string | |
| `role` | string | `"front-desk"` \| `"admin"` |
| `createdAt` | timestamp | |

---

### `members/{uid}`

Guest loyalty members. Document ID = Firebase Auth UID. Separate from `guests/` (staff).

| Field | Type | Notes |
|---|---|---|
| `fullName` | string | |
| `email` | string | |
| `phone` | string | |
| `photoUrl` | string | From Google profile or uploaded |
| `authProvider` | string | `"google"` \| `"email"` |
| `memberNumber` | string | e.g. `"SR-00042"` — format: `{config.memberNumberPrefix}-{zero-padded 5 digits}`, generated server-side via `/api/members/register` |
| `isMember` | boolean | `true` once enrolled in Spark Rewards |
| `memberSince` | timestamp | Date of Spark Rewards enrollment |
| `rewardsPoints` | number | Current points balance |
| `tier` | string | `"standard"` — tier system TBD Phase 2 |
| `isActive` | boolean | `false` = account disabled |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

### `members/{uid}/pointsHistory/{entryId}`

Subcollection — audit trail of all points changes.

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"earn"` \| `"redeem"` \| `"manual"` \| `"expire"` |
| `points` | number | Positive = earned, negative = redeemed/deducted |
| `description` | string | e.g. "Stay at Room 202 — June 2026" |
| `reason` | string | Required for manual adjustments |
| `bookingId` | string \| null | Linked booking if applicable |
| `by` | string | Staff UID (manual) or `"system"` |
| `at` | timestamp | |

---

### `settings/hotelConfig`

Single document. See `plan/docs/TYPES.md` for full type.

Key fields: `hotelName`, `address`, `contactEmail`, `contactPhone`, `facebookUrl`, `instagramUrl`, `checkInTime`, `checkOutTime`, `missionStatement`, `visionStatement`, `hotelStory`, `paymentMethods[]`, `payAtHotelEnabled`, `intercomQuickRequests[]`, `notificationSoundUrl`

---

### `settings/websiteContent`

Single document. Stores editable public page content.

Sections: `homepage` (hero, amenities, featuredRoomIds, services, sparkRewards), `about` (heroPhotoUrl), `corporate` (hero, perks)

**`homepage.services`** — array of service cards shown in the Services section:
```
{ title, description, icon, isEnabled }[]
```
Default items: Tour Packages, Car Rentals. CTA always links to `/contact`. Hide section if empty or all disabled.

**`homepage.sparkRewards`** — Spark Rewards promo block:
```
{ heading, description, isEnabled }
```
Hide section entirely if `isEnabled: false`.

Additional legal/policy fields (editable by hotel admin from Settings):
- `privacyPolicyBody` — full privacy policy text (plain text or light markdown)
- `cancellationPolicy` — shown at booking Step 3 and in confirmation emails
- `houseRules` — used in guest registration PDF at check-in

---

### `corporateInquiries/{inquiryId}`

| Field | Type | Notes |
|---|---|---|
| `companyName` | string | |
| `contactPerson` | string | |
| `email` | string | |
| `phone` | string | |
| `numRooms` | number | |
| `preferredDates` | `{from, to}` | |
| `specialRequirements` | string | |
| `status` | string | `"new"` \| `"contacted"` \| `"negotiating"` \| `"converted"` \| `"declined"` |
| `handler` | string | Staff UID |
| `notes` | `{text, by, at}[]` | Timestamped log |
| `accessCodeId` | string | Ref to `corporateCodes` if generated |
| `createdAt` | timestamp | |

---

### `corporateCodes/{code}`

The document ID is the code itself (e.g. `ACME2026`).

| Field | Type | Notes |
|---|---|---|
| `companyName` | string | |
| `ratePerRoomType` | map | `{roomType → ratePerNight}` |
| `expiresAt` | timestamp \| null | `null` = no expiry |
| `usageCap` | number \| null | `null` = unlimited |
| `usageCount` | number | |
| `linkedInquiryId` | string | |
| `createdBy` | string | Staff UID |
| `createdAt` | timestamp | |
| `isActive` | boolean | |

---

### `vouchers/{voucherId}`

| Field | Type | Notes |
|---|---|---|
| `code` | string | Unique promo code |
| `discountType` | string | `"percent"` \| `"flat"` |
| `discountValue` | number | % or ₱ amount |
| `usageCap` | number \| null | `null` = unlimited |
| `usageCount` | number | |
| `expiresAt` | timestamp \| null | `null` = no expiry |
| `applicableRoomTypes` | string[] | Empty array = all room types |
| `isActive` | boolean | |
| `createdBy` | string | Staff UID |
| `createdAt` | timestamp | |

---

### `intercoms/{roomId}/messages/{messageId}`

Subcollection under each room.

| Field | Type | Notes |
|---|---|---|
| `text` | string | |
| `sender` | string | `"guest"` \| `"front-desk"` |
| `guestName` | string | |
| `timestamp` | timestamp | |
| `isRead` | boolean | |
| `isQuickRequest` | boolean | `true` if sent via quick request panel |
| `isStoreOrder` | boolean | `true` if sent by the store order system |

---

### `calls/{roomId}`

WebRTC signaling document for voice calls between guest intercom and front desk. One document per room, overwritten per call.

| Field | Type | Notes |
|---|---|---|
| `offer` | object | `RTCSessionDescriptionInit` — created by guest |
| `answer` | object \| null | `RTCSessionDescriptionInit` — created by front desk on accept |
| `status` | string | `"ringing"` \| `"active"` \| `"ended"` |
| `guestName` | string | From intercom name prompt |
| `startedAt` | timestamp | When guest initiated |
| `endedAt` | timestamp \| null | When call ended |

#### `calls/{roomId}/iceCandidates/{id}`

Subcollection for ICE candidate exchange (both sides write here).

| Field | Type | Notes |
|---|---|---|
| `candidate` | object | `RTCIceCandidateInit` |
| `from` | string | `"guest"` \| `"staff"` |
| `createdAt` | timestamp | |

**Security rules:** open read/write — same as `intercoms` (physical QR gate is the security model). Clean up `iceCandidates` subcollection on call end.

---

### `storeItems/{itemId}`

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. "Toothbrush", "Bottled Water" |
| `description` | string | Optional short description |
| `price` | number | Price in local currency |
| `stock` | number \| null | `null` = unlimited, `0` = out of stock, `n` = n remaining |
| `photoUrl` | string | Firebase Storage URL (optional) |
| `isActive` | boolean | `false` = hidden from guest store |
| `createdBy` | string | Staff UID |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

### `storeOrders/{orderId}`

| Field | Type | Notes |
|---|---|---|
| `orderRef` | string | e.g. `"SO-20260601-001"` — generated server-side |
| `roomId` | string | Ref to `rooms/{roomId}` |
| `roomNumber` | string | Denormalized |
| `bookingId` | string \| null | Linked booking (null if no active booking found) |
| `guestName` | string | From intercom name prompt |
| `items` | `{itemId, name, price, quantity}[]` | Snapshot of items at order time |
| `totalAmount` | number | Computed at order creation |
| `paymentMethod` | string | `"cod"` \| `"add-to-bill"` \| `"gcash"` |
| `paymentProofUrl` | string | Firebase Storage URL (GCash screenshot, if applicable) |
| `status` | string | `"placed"` \| `"confirmed"` \| `"out-for-delivery"` \| `"delivered"` \| `"cancelled"` |
| `isBilled` | boolean | `true` if added to booking bill |
| `billedAt` | timestamp \| null | When billed |
| `cancellationReason` | string | Optional |
| `handledBy` | string | Staff UID |
| `notes` | string | Internal staff notes |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

### `settings/rewardsConfig`

Single document. Managed from Settings → Spark Rewards tab. Admin-only write.

| Field | Type | Notes |
|---|---|---|
| `pointsEnabled` | boolean | Global points earning on/off |
| `earningMode` | string | `"per-booking"` \| `"per-spend"` |
| `pointsPerBooking` | number | Flat points awarded per completed stay (used when `earningMode == "per-booking"`) |
| `pointsPerHundred` | number | Points awarded per ₱100 of booking total (used when `earningMode == "per-spend"`) |
| `memberDiscountEnabled` | boolean | Auto-apply member discount at booking Step 1 |
| `memberDiscountPct` | number | Discount % for members (e.g. `10`) |
| `pointsRedemptionRate` | number | ₱ value per 100 points (e.g. `100` means 100 pts = ₱100; `50` means 100 pts = ₱50) |

---

### `settings/storeConfig`

Single document.

| Field | Type | Notes |
|---|---|---|
| `isEnabled` | boolean | Global store on/off toggle |
| `lowStockThreshold` | number | Default 5 — triggers low stock alert in reports |
| `paymentMethods` | `{method, label, qrUrl, accountInfo, isEnabled}[]` | CoD, Add to Bill, GCash |

---

### `settings/breakfastConfig`

Single document. Managed from Settings → Breakfast tab.

| Field | Type | Notes |
|---|---|---|
| `isEnabled` | boolean | Global breakfast add-on on/off toggle |
| `ratePerPersonPerNight` | number | Set in Rate Management — locked at booking time |
| `silogItems` | `{id, name, isActive}[]` | Fully editable silog menu — e.g. Tapsilog, Longsilog, Tocilog |

---

### `breakfastSelections/{selectionId}`

One document per guest per day. Created by front desk at check-in.

| Field | Type | Notes |
|---|---|---|
| `bookingId` | string | Ref to `bookings/{bookingId}` |
| `roomNumber` | string | Denormalized |
| `date` | string | ISO date of the breakfast morning e.g. `"2026-06-15"` |
| `guestIndex` | number | 0-based — Guest 1 = 0, Guest 2 = 1, etc. |
| `guestName` | string | Entered by front desk |
| `silogId` | string | Ref to item in `settings/breakfastConfig.silogItems` |
| `silogName` | string | Snapshot at entry time |
| `enteredBy` | string | Staff UID |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

## Booking Reference Format

`SI-YYYYMMDD-NNN` — e.g. `SI-20260601-001`

NNN is a zero-padded daily sequence. Generate and validate server-side via API route.

---

## Security Rules Summary

| Collection | Read | Write |
|---|---|---|
| `rooms` | Public | Staff or Admin |
| `bookings` | Owner or Staff/Admin | Create = anyone; Update = Staff/Admin; Delete = Admin |
| `guests` | Owner or Staff/Admin | Owner or Admin |
| `settings` | Public | Admin only |
| `corporateInquiries` | Staff/Admin only | Staff/Admin only |
| `corporateCodes` | Anyone (validation) | Admin only |
| `vouchers` | Anyone (validation) | Staff or Admin |
| `intercoms` | Open (no auth) | Open (no auth) |
| `members` | Owner (self) or Staff/Admin | Create = authenticated guest; Update = owner or Staff/Admin |
| `members/{uid}/pointsHistory` | Owner or Staff/Admin | Create = system/Staff/Admin only |
| `breakfastSelections` | Staff/Admin only | Staff/Admin only |
| `settings/breakfastConfig` | Public (needed for booking flow) | Admin only |
| `storeItems` | Public (guests need to browse) | Staff or Admin |
| `storeOrders` | Open for create (guest orders) | Create = anyone; Update = Staff/Admin |
| `bookings/{id}/payments` | Staff/Admin only | Create = Staff/Admin; no updates or deletes |
| `settings/rewardsConfig` | Authenticated guests (needed for booking discount + My Rewards display) | Admin only |
| `calls` | Open (no auth) — same as intercoms | Open (no auth) |
| `settings/storeConfig` | Public (guests need payment methods) | Admin only |

Full rules live in `firebase/firestore.rules`.

---

## Firebase SDK Usage

- Initialize Firebase once in `firebase/config.ts` per app
- Use `getFirestore()`, `getAuth()`, `getStorage()` — do not re-initialize
- Firestore real-time: `onSnapshot` in custom hooks — always unsubscribe in cleanup
- Firestore one-time: `getDoc` / `getDocs` for non-reactive reads
- Storage: `uploadBytes` + `getDownloadURL` for file uploads
- Auth: `onAuthStateChanged` listener in auth hook — unsubscribe on cleanup

See `plan/docs/GOTCHAS.md` for common Firebase pitfalls.
