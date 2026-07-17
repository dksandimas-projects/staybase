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
| `name` | string | e.g. "Room 202 — Executive" — may vary per room (e.g. "Deluxe — Sea View"); defaults to the type label on create |
| `roomNumber` | string | e.g. "202" — must be unique across the collection (case-insensitive trim compare, enforced in `AdminContext.createRoom`) |
| `type` | string | Free-form string matching a dynamic room type `value` (defaults defined in `@spark-inn/shared → DEFAULT_ROOM_TYPES`, managed at runtime via Admin UI) e.g. `"single"`, `"deluxe-sea-view"` |
| `isActive` | boolean | `false` = hidden from guest site |
| `status` | string | `"available"` \| `"occupied"` \| `"blocked"` |
| `housekeepingStatus` | string | `"clean"` \| `"dirty"` \| `"in-progress"` |
| `blockedFrom` | timestamp \| null | Optional date-range block (per `DECISIONS-FEATURES.md #78`) |
| `blockedTo` | timestamp \| null | Optional date-range block (per `DECISIONS-FEATURES.md #78`) |
| `qrToken` | string | Optional regenerated QR route token; fallback QR value uses the room document ID |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

> **Staff-only room notes are not stored on `rooms`.** Internal `remarks` and `blockReason` live in `roomPrivate/{roomId}` so the public guest app can continue reading active room documents without exposing operational notes. `AdminContext` merges the private doc for staff views and lazily migrates any legacy public `remarks` / `blockReason` values into `roomPrivate`, then deletes them from the public room doc.

> **Photos, pricing, capacity, bed description, and amenities are NOT stored on individual rooms.** They all live on the **room type** — see `settings/hotelConfig.roomTypes[]` below. The guest site (room cards, room detail, booking flow, homepage featured rooms) and admin app join `roomType` on `Room.type` at query time. The Settings → Room Types table is the single edit surface: rates, photos, bed setup, description, and amenities all flow from there. Upload path for type photos: Firebase Storage `room-types/{typeValue}/{filename}` (public read, staff write — see `firebase/storage.rules`).

> **Migration note (W3.6 + W3.7):** prior to Phase 11.9 each room also carried its own `maxCapacity`, `pricePerNight`, `weekendRate`, `corporateRate` (W3.6), `bedDefinition`, `description`, and `amenities` (W3.7). All of those fields are no longer read by the app. If the Firestore docs still contain them they are inert — the canonical values now live on the type. A one-off backfill to seed each `settings/hotelConfig.roomTypes[].{maxCapacity, pricePerNight, weekendRate, corporateRate, bedDefinition, description, amenities}` from a representative room of the same type is required if the property was running on the prior schema. See `plan/features/RATE-MANAGEMENT.md §W3.6` and `plan/features/ROOM-MANAGEMENT.md §W3.7` for the procedures.

**Lifecycle:** Rooms are created via the admin `/rooms` page (`AdminContext.createRoom`, validated by `CreateRoomSchema` in `@spark-inn/shared/schemas/room`) and deleted via the same page (`AdminContext.deleteRoom`). Deletion is **admin-only** at the Firestore rules layer and is blocked client-side when any active booking (status in `pending`, `payment-uploaded`, `payment-confirmed`, `confirmed`, `checked-in`) still references the room. The required delete reason is written to `roomDeletionAudit/{auditId}` before the hard delete. On delete, the cascade cleans up: Storage photos under `rooms/{roomId}/*`, `intercoms/{roomNumber}` + messages subcollection, and `calls/{roomNumber}` + `iceCandidates` subcollection. Historical bookings retain their denormalized `roomNumber` / `roomType` so receipts and audit logs remain readable; only the live `roomId` pointer is removed.

**Auto-assignment (per `feature/booking-by-room-type`):** The public booking flow's Step 1 shows one card per room type. Clients post `roomType`; the `/api/bookings/create` transaction reads all active physical rooms of that type, sorts by `roomNumber`, picks the first non-conflicting room, and stores its `roomId` + `roomNumber` on the new booking document. The `Booking.roomId` schema is unchanged — it still points at a real `rooms/{id}` document — and `Booking.roomType` is the type value the guest selected. Staff see the assigned room in the bookings management table exactly as before.

---

### `roomPrivate/{roomId}`

Staff-only extension document for room fields that must never be public. Document IDs match `rooms/{roomId}`.

| Field | Type | Notes |
|---|---|---|
| `remarks` | string | Internal staff notes |
| `blockReason` | string | `"Maintenance"` \| `"Hold"` \| `"Other"` \| custom staff note \| `""` |
| `createdAt` | timestamp | Optional; set on first private doc creation |
| `updatedAt` | timestamp | Updated whenever staff notes or block reason change |

Firestore rules: read/create/update require `isStaff()`, delete requires `isAdmin()`. The guest app must not read this collection.

---

### `roomBlocks/{blockId}`

Calendar-managed room blocks. This is the canonical multi-range blocking model for the booking calendar; legacy `rooms/{roomId}.blockedFrom/blockedTo` is still read for backwards compatibility but should not be used for new calendar blocks.

| Field | Type | Notes |
|---|---|---|
| `roomId` | string | Ref to `rooms/{roomId}` |
| `roomNumber` | string | Denormalized for calendar display |
| `roomType` | string | Denormalized |
| `startDate` | timestamp | Inclusive check-in-style date |
| `endDate` | timestamp | Exclusive check-out-style date |
| `reason` | string | Short reason shown in the admin calendar |
| `notes` | string | Optional staff note |
| `status` | string | `"active"` \| `"cancelled"` |
| `createdBy` | string | Staff UID/email |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |
| `cancelledAt` | timestamp \| null | |
| `cancelledBy` | string \| null | |

Room block create/update/cancel goes through `/api/room-blocks/*` so overlapping bookings and overlapping active blocks are rejected server-side. Booking creation and rescheduling also check active `roomBlocks` inside the transaction.

---

### `bookings/{bookingId}`

`bookingId` is the Firestore document ID. Guest and corporate booking flows preallocate this ID before payment-proof or discount-ID uploads so Firebase Storage paths can be created before the booking document exists. `/api/bookings/create` must create the booking document at this supplied ID inside the availability-locking transaction. The guest-facing `bookingRef` is generated separately inside the transaction.

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
| `rateBreakdown` | object \| null | Locked itemized price explanation for mixed regular/weekend/seasonal rates, add-ons, and deductions. New bookings should persist it; later money mutations such as points redeem/undo rebuild it atomically with `totalPrice`. Legacy bookings may be null and fall back to `ratePerNight × numNights`. |
| `totalPrice` | number | Computed at booking time |
| `discountType` | string | `""` \| `"senior"` \| `"pwd"` |
| `discountPct` | number | `0` \| `20` |
| `discountIdPhotoUrl` | string \| null | Firebase Storage URL of OSCA/PWD ID upload — staff-only read |
| `discountIdPhotoPath` | string \| null | Private Storage object path for new uploads; resolved to a short-lived signed URL only for authenticated staff |
| `discountVerified` | boolean | `false` until staff marks ID as verified in drawer |
| `discountVerifiedBy` | string \| null | Staff UID who verified the discount ID |
| `discountRejected` | boolean | `true` if staff rejected the discount ID |
| `discountRejectedBy` | string \| null | Staff UID who rejected |
| `discountRejectionReason` | string | Optional reason entered by staff at rejection |
| `originalTotalPrice` | number \| null | Canonical pre-discount room/add-on subtotal — always stored by current create, reschedule, and discount writers; `null` is legacy-only |
| `voucherCode` | string | Applied promo voucher code (if any) |
| `voucherDiscount` | number | Flat ₱ or % discount from voucher |
| `isCorporate` | boolean | `true` if booked via `/corporate/book` |
| `corporateCode` | string | Access code used (if any) |
| `companyName` | string | Corporate bookings only |
| `corporate` | object \| absent | Per BI-11 (booking-intercom audit 2026-07-06): persisted only when the booking is corporate. Shape: `{ designation: string, companyAddress: string, purposeOfStay: string, billingArrangement: "personal" \| "chargeback" }`. `chargeback` triggers the LOU workflow (`DECISIONS-FEATURES.md #99`); `personal` requires a payment proof. Standard online bookings omit the field entirely. |
| `specialRequests` | string | |
| `status` | string | `"pending"` \| `"payment-uploaded"` \| `"payment-confirmed"` \| `"confirmed"` \| `"checked-in"` \| `"checked-out"` \| `"cancelled"` |
| `paymentMethod` | string | `"pay-at-hotel"` \| `"gcash"` \| `"paypal"` \| other |
| `paymentProofUrl` | string \| null | Firebase Storage URL. `null` is the canonical "no proof" value (not `""`) per BF-45. |
| `paymentProofPath` | string \| null | Private Storage object path for new uploads; preferred over the legacy URL field |
| `paymentReferenceNumber` | string \| null | Guest-entered reference (GCash/bank ref #) for staff cross-check. Displayed in the dashboard pending payment alerts. Per Phase 12 — Dashboard Payment Rejection & Reference Verification (2026-07-15). |
| `paymentRejectionReason` | string \| null | Staff reason when a pending payment proof is rejected from the dashboard. Bounces the booking back to `pending` (room stays held) and emails the guest with the reason. Per Phase 12 — Dashboard Payment Rejection & Reference Verification (2026-07-15). |
| `paymentRejectedAt` | timestamp \| null | Server timestamp set by `/api/bookings/reject-payment`. |
| `paymentRejectedBy` | string \| null | Staff UID who rejected. |
| `source` | string | `"online"` \| `"walk-in"` \| `"phone"` \| `"facebook"` \| `"corporate"` |
| `notes` | string | Internal staff notes |
| `handledBy` | string | Staff UID |
| `memberId` | string \| null | Firebase Auth UID of member (if booked while logged in or linked post-registration) |
| `memberDiscountPct` | number | Spark Rewards member discount percent applied at booking creation (0 if none); used when recomputing totals after discount rejection |
| `pointsRedeemed` | number | Points redeemed by staff against this booking (0 if none) |
| `pointsRedeemedValue` | number | ₱ value of redeemed points deducted from `totalPrice` (0 if none) |
| `pointsRedeemedBy` | string \| null | Staff UID who applied the redemption |
| `pointsRedeemedAt` | timestamp \| null | When redemption was applied |
| `pointsAwarded` | number | Checkout points actually credited to the member; `0` while a qualifying award is pending payment |
| `pendingLoyaltyPoints` | number | Locked checkout award waiting for final folio settlement; cleared atomically when awarded |
| `loyaltyAwardStatus` | string | `pending-payment`, `awarded`, or `ineligible`; transaction/idempotency state for checkout earnings |
| `pointsAwardedAt` | timestamp \| null | When checkout earnings were credited; null while pending/ineligible |
| `checkedOutWithBalance` | number | Immutable charge-inclusive outstanding balance stamped at checkout; remains the audit record even after later settlement |
| `checkedOutFolioTotal` | number | Checkout snapshot of booking total + net incidentals + delivered billed-to-room store orders |
| `checkedOutCollectedTotal` | number | Net payment-ledger total at checkout, including refunds |
| `earlyCheckoutOriginalCheckOut` | timestamp \| null | Original departure timestamp retained when early checkout shortens the operational stay |
| `hasBreakfast` | boolean | `true` if breakfast add-on purchased |
| `breakfastRate` | number | Rate per person per night at booking time (locked) |
| `guestIdPhotoUrl` | string \| null | Firebase Storage URL of government ID photo uploaded by front desk at check-in |
| `guestRegistration` | object | Physical check-in registry data: nationality, address, DOB, gender, ID type/number, emergency contact, vehicle plate, signature status |
| `breakfastSelections` | map | Canonical silog selection store. Wire format `yyyy-mm-dd-guest-n` → selected silog item name; updated by staff in the admin booking drawer and exported by Reports. |
| `cancellationReason` | string | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

When an appended payment brings a `pending` or `payment-uploaded` booking to
its locked `totalPrice`, the payment record and `payment-confirmed` status are
written in the same server transaction. The committed status transition is
the idempotency guard for the guest payment-confirmed email. Staff may then
transition `payment-confirmed` to `confirmed`, or check in directly when the
registration gate is otherwise complete.

A staff member verifying an uploaded online payment uses
`POST /api/bookings/mark-payment-confirmed`. That route transactionally permits
only `payment-uploaded` → `payment-confirmed`, stamps `handledBy` and
`paymentConfirmedAt`, treats an already-confirmed booking as an idempotent
retry, and sends the guest email only after a new transition commits. Firestore
client rules do not allow direct status updates.

Checkout does not hard-block an unsettled folio. It records the charge-inclusive
balance for audit/receivables and defers any eligible Spark Rewards award until
the final payment. Points are based only on net `totalPrice` (room/breakfast),
not incidentals or store orders. Early departure retains the contracted total
and adds a guest-visible retained-total line to the rebuilt rate breakdown.

> **Store charges are not denormalized onto the booking document.** The checkout folio in `admin-app/src/pages/BookingsPage.tsx` (`getBookingStoreCharges`) derives the billed store orders for a booking at read time by filtering the `storeOrders` collection on `bookingId === booking.id && paymentMethod === "add-to-bill" && status === "delivered" && isBilled === true`. This avoids denormalization drift between the booking and store order lifecycles. `storeOrders.isBilled` and `storeOrders.billedAt` are the source of truth (set by the front desk "Add to Booking Bill" action in the admin Bookings drawer).

> **Manual walk-in pricing is durable across room/date moves.** A walk-in created with a manual override stores a `manual` room line in its locked rate breakdown. Rescheduling derives the exact nightly basis from that line's subtotal and nights, rescales it for the new stay length, and does not replace it with the target room's live standard/seasonal rate or add a separate breakfast line. Non-manual bookings continue to recalculate against the target room/date pricing basis.

> **Fixed 2026-07-02: `GET /api/rooms/availability` was 500ing in production** with a Firestore `FAILED_PRECONDITION: The query requires an index` error on the composite `status` (ASC) + `checkIn` (ASC) query. All 5 composite indexes defined in `firebase/firestore.indexes.json` (4 on `bookings`, 1 on `rooms`) existed in source control but had never actually been deployed to the live project — confirmed via `firestore_list_indexes` that zero indexes existed before the fix. Resolved by creating all 5 directly against the live project (`spark-inn-stg-7a7ad`); all now `READY` and `/api/rooms/availability` returns `200`. **Lesson: `firebase/firestore.indexes.json` being present and correct in the repo does not mean it's deployed** — there is no CI step or pre-deploy hook that runs `firebase deploy --only firestore:indexes` automatically. If a new query needs a composite index, add it to `firestore.indexes.json` **and** deploy it (via `firebase deploy --only firestore:indexes` or the Firebase MCP `firestore_create_index` tool) — don't assume the JSON file alone is sufficient. Separately still worth confirming with whoever owns the Firebase project config: the live `FIREBASE_PROJECT_ID` used by both the Preview and Production Vercel environments is `spark-inn-stg-7a7ad` (a "stg"-named project serving production traffic) — may be intentional (single project, historically named), but flagging since it reads like a staging/production mixup.


---

### `bookings/{bookingId}/payments/{paymentId}`

Subcollection — audit trail of all onsite payments, uploaded-payment verifications, and refunds. Append-only, never edited or deleted. Payment clients preallocate `paymentId`; the server creates that exact document so matching retries are idempotent. Equal-amount reference-free installments remain distinct when they intentionally use different IDs, and reusing an existing ID with different details is rejected. All writes use authenticated server routes; Firestore client creation is denied.

| Field | Type | Notes |
|---|---|---|
| `type` | string | `payment` or `refund`; legacy positive entries default to `payment` |
| `amount` | number | Positive amount collected or negative refund outflow |
| `method` | string | `"cash"` \| `"gcash"` \| `"paypal"` \| other method name from `hotelConfig.paymentMethods` |
| `note` | string | Optional context (e.g. "Balance after discount rejection") |
| `reason` | string \| null | Required refund reason; null for payments |
| `approvedBy` | string \| null | Admin UID for refunds; null for payments |
| `recordedBy` | string | Staff UID |
| `recordedAt` | timestamp | |

Outstanding balance = `booking.totalPrice + billed store orders + sum(charges[].amount) − sum(payments[].amount)` — computed client-side, never stored.

**Security rules:** Staff/Admin read; client create/update/delete denied. Server-authoritative payment/refund routes append entries with Admin SDK.

---

### `bookings/{bookingId}/charges/{chargeId}`

Append-only incidental folio ledger. Positive entries add an amount owed; voiding creates a negative reversal with `voidOf` pointing to the original entry. Existing records are never edited or deleted.

| Field | Type | Notes |
|---|---|---|
| `label` | string | Staff-facing description shown on the folio and receipt |
| `amount` | number | Positive charge or negative reversal; absolute value capped at 1,000,000 |
| `category` | string | `late-checkout`, `early-checkin`, `extra-person`, `damage`, `laundry`, or `other` |
| `note` | string | Optional context; required as the void reason on reversals |
| `addedBy` | string | Staff UID |
| `addedAt` | timestamp | Server timestamp |
| `voidOf` | string \| null | Original charge ID for reversal entries; reversal document ID must be `void-{voidOf}` |

Folio total = `booking.totalPrice + delivered billed-to-room store orders + sum(charges[].amount)`. Outstanding balance subtracts the append-only payments ledger from that total.

**Security rules:** Staff/Admin read + create; no updates or deletes. Rules enforce the absolute amount cap and deterministic reversal ID, which makes each original charge voidable only once.

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
| `isActive` | boolean | `false` when disabled through `/api/admin/disable-staff` |
| `createdBy` | string | Admin UID that created the account |
| `disabledAt` | timestamp \| null | Set when disabled |
| `disabledBy` | string | Admin UID that disabled the account |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

### `members/{uid}`

Guest loyalty members. Document ID = Firebase Auth UID. Separate from `guests/` (staff). Public member enrollment goes through `/api/members/register` so `memberNumber` is generated server-side; guest clients must not create this document directly.

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

Key fields (per Phase 11.8 PR 3, all admin-editable from Settings → Hotel Info): `address`, `frontDeskPhone`, `supportEmail`, `dpoEmail`, `facebookUrl`, `instagramUrl`, `twitterHandle`, `checkInTime`, `checkOutTime`, `paymentMethods[]`, `intercomQuickRequests[]`, `notificationSoundUrl`, `roomTypes[]`, `seasonalRateOverrides[]`, `seniorPwdOnlineEnabled`. Brand identity remains deploy-time in `hotel.config.ts`. Missing fields fall back to deploy-time config; `seniorPwdOnlineEnabled` defaults on unless explicitly `false`. Explicitly blank social fields hide their public icons. Legacy `hotelName`, `contactEmail`, `contactPhone`, `missionStatement`, `visionStatement`, and `hotelStory` values may remain on old documents but are ignored; their canonical replacements are `hotel.config.ts`, `supportEmail`, `frontDeskPhone`, and `settings/websiteContent.about.*`.

> **`paymentMethods[]`** — fully dynamic payment list, edited from Settings → Payment Methods. Each entry owns its `method` key, `label`, `accountName`, `accountNumber`, `qrUrl`, `isEnabled`, `showInStore`, and `showInCorporate` flags. `isEnabled` controls the regular booking flow; `showInStore` controls the in-room store; `showInCorporate` controls corporate personal-pay. "Pay at Hotel" is just another entry (`method: "pay-at-hotel"`, `isEnabled: true/false`) — there is no separate `payAtHotelEnabled` field. `cod` and `add-to-bill` are store-only entries in this same list. QR images are stored at `assets/payment-methods/{method}/{filename}` in Firebase Storage (public read, staff write). See `firebase/storage.rules` `match /assets/payment-methods/{method}/{fileName}` and `plan/features/SETTINGS.md §Payment Methods` for the full edit surface.

> **`roomTypes[]`** — array of `RoomTypeEntry` records. Each entry owns its photos, occupancy cap, rate matrix, bed description, and amenities; rooms reference the type via the `type` field and inherit these properties. See `plan/docs/TYPES.md §RoomType` for the full shape. Photos are uploaded to Firebase Storage at `room-types/{value}/{filename}`. Maximum 10 photos per type (per `MAX_ROOM_TYPE_PHOTOS` in `shared/constants`). The full edit surface is the Settings → Room Types table; see `plan/features/SETTINGS.md §Room Types` for the add / edit / photos / delete flow.

> **`seasonalRateOverrides[]`** — array of active/inactive date-range nightly rate overrides managed from Rates → Seasonal Rate Overrides. Shape: `{ id, name, startDate, endDate, rate, roomTypeValues[], isActive }`. Empty `roomTypeValues[]` means all room types. Overrides apply only to new standard and staff walk-in bookings, beat weekend rates for matching nights, and do not override negotiated or flat corporate rates. Existing bookings keep their locked `totalPrice`.

---

### `settings/seo`

Single public-readable, admin-write document for controlled SEO publishing. `draft` contains the editable default description, relative price band, and social preview image URL. Social images are uploaded from the admin app to Firebase Storage under `assets/seo/og-image/`; the draft stores the resulting public HTTPS URL. `published` is a validated snapshot that also includes the current Hotel Settings address, front-desk phone, Facebook/Instagram URLs, X handle, and check-in/out times. `sourceChangesPending` persists the reminder that canonical Hotel Settings differ from the last published snapshot; it clears only after the deploy hook accepts a publish request. The guest build reads only `published`; when absent or unavailable it falls back to `hotel.config.ts`. `publishedAt` and `publishedBy` record the latest publish request.

### `settings/websiteContent`

Single document. Stores editable public page content.

Sections: `homepage` (hero, amenities, featuredTypeValues, services, sparkRewards), `about` (hero, missionStatement, visionStatement, hotelStory), `corporate` (heroEyebrow, heroHeading, heroSubtext, heroPhotoUrl, perks), `rewards` (heroEyebrow, heroHeading, heroSubtext, heroPhotoUrl), `branding` (logoNavbar, logoNavbarOnDark, logoFooter)

**`homepage.services`** — array of service cards shown in the Services section:
```
{ title, description, icon, isEnabled }[]
```
Default items: Tour Packages, Car Rentals. CTA always links to `/contact`. Hide section if empty or all disabled.

**`homepage.sparkRewards`** — Spark Rewards promo block:
```
{ heading, description, perks, isEnabled }
```
`perks` uses the same editable card shape as services: `{ title, description, icon, isEnabled }[]`. Hide section entirely if `isEnabled: false`; hide disabled perks within the section.

**`about` body copy** — About Us page content below the hero. The editable fields are `missionStatement`, `visionStatement`, and `hotelStory`. Settings → Website Content is their only edit surface and `settings/websiteContent.about.*` is the single runtime source of truth. Empty fields fall back directly to deploy-time public-site copy. `hotelStory` is plain text; blank lines split into paragraphs on `/about`.

**Per-page hero fields** (homepage / about / corporate / rewards) — every page with a hero has the same four-string shape: `heroEyebrow`, `heroHeading`, `heroSubtext`, `heroPhotoUrl`. All default to empty string. The guest app falls back to `data/homepage.ts` constants when the field is empty:

| Section | Field | Fallback constant in `guest-app/src/data/homepage.ts` |
|---|---|---|
| `homepage` | `heroEyebrow` | `config.tagline` (per Phase 11.8 PR 1 — admin-editable from Settings → Branding; falls back to the deploy-time `config.tagline` when empty) |
| `homepage` | `heroHeading` / `heroSubtext` | "Your sanctuary in Bohol" / "A warm, minimalist stay..." (defined in `usePublicSiteContent.ts`) |
| `homepage` | `heroPhotoUrl` | `homepageHeroImage` |
| `about` | `heroEyebrow` | "Our Story" (per Phase 11.8 PR 1 — admin-editable from Settings → Branding; falls back to the page's hard-coded pill when empty) |
| `about` | `heroHeading` | `aboutHeroHeading` ("about us") |
| `about` | `heroSubtext` | "Discover the vision and heart behind {config.brandName}..." (per Phase 11.8 PR 1 — admin-editable; falls back to the deploy-time subtext when empty) |
| `about` | `heroPhotoUrl` | `aboutHeroImage` |
| `corporate` | `heroEyebrow` | `corporateHeroEyebrow` |
| `corporate` | `heroPhotoUrl` | `corporateHeroImage` |
| `rewards` | `heroEyebrow` | `rewardsHeroEyebrowSuffix` ("Loyalty Program") — rendered as `"{config.rewardsName} {rewards.heroEyebrow}"` |
| `rewards` | `heroPhotoUrl` | `rewardsHeroImage` |

**`branding`** — runtime logo overrides (set by the admin from Settings → Branding). All default to empty string. The guest app falls back to `hotel.config.ts → logos.*` via `resolveLogo()`:

```
branding: {
  logoNavbar: string         // colored version — used in scrolled/solid state and on non-hero pages
  logoNavbarOnDark: string   // light/white version — used over the dark hero (transparent navbar state)
  logoFooter: string         // white version for the dark sidebar footer
}
```

Logo selection in the Navbar is contextual: when `solid === true` (scrolled, non-hero page) use `logoNavbar`; when `solid === false` (over hero, transparent) use `logoNavbarOnDark`. If only one variant has been uploaded by the admin it is mirrored across both states. Uploads go to Firebase Storage at `assets/branding/branding/{fieldName}/{filename}`; download URL is written to `settings/websiteContent.branding.{fieldName}`. Public read + staff write — see `firebase/storage.rules` `match /assets/branding/{fileName}`.

**Cross-tab cache invalidation** (per Phase 11.8 PR 1) — the public site caches `settings/websiteContent` + `settings/hotelConfig` in localStorage for `PUBLIC_SITE_CONTENT_CACHE_TTL_MS` (5 minutes) so returning visitors render instantly. The admin app writes the current timestamp to `localStorage["publicSiteContent:bust"]` on every successful `settings/websiteContent` or `settings/hotelConfig` save (via `bustPublicSiteContentCache` in `shared/utils/publicSiteCache.ts`); the guest hook subscribes to the `storage` event for that key and refetches + drops its in-memory + localStorage cache on the next tick. Same-browser demos reflect admin edits in real time; cross-device (admin on desktop, guest on phone) still falls back to the 5-minute TTL.

Additional legal/policy fields (editable by hotel admin from Settings):
- `privacyPolicyBody` — full privacy policy text (plain text or light markdown)
- `cancellationPolicy` — shown at booking Step 3 and in confirmation emails
- `houseRules` — used in guest registration PDF at check-in

---

### `corporateInvoices/{invoiceId}`

Minimal accounts-receivable invoice register for corporate charge-back balances.

| Field | Type | Notes |
|---|---|---|
| `companyName` | string | Corporate account label |
| `bookingIds` | string[] | Bookings covered by the invoice |
| `bookingRefs` | string[] | Denormalized references for reporting/export |
| `amount` | number | Outstanding amount at issue time |
| `status` | string | `issued` or `paid` |
| `issuedAt` | timestamp | Server timestamp |
| `issuedBy` | string | Staff UID |
| `paidAt` | timestamp \| null | Set when marked paid |
| `paidBy` | string \| null | Staff UID |

Staff can create and update invoice status; deletion is forbidden so the register retains its audit history. Invoice status does not create a payment entry automatically—the actual receipt must still be recorded in the booking payment ledger.

---

### `corporateInquiries/{inquiryId}`

| Field | Type | Notes |
|---|---|---|
| `companyName` | string | |
| `contactPerson` | string | |
| `email` | string | |
| `phone` | string | |
| `numRooms` | number | |
| `preferredDates` | string | Free-text preferred month or date range from the public inquiry form |
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

### `intercoms/{roomId}`

Room-level conversation metadata for inbox filtering and resolution state.

| Field | Type | Notes |
|---|---|---|
| `roomId` | string | Document ID / room number used by QR route |
| `roomNumber` | string | Display room number |
| `guestName` | string | Latest guest name from intercom prompt |
| `resolved` | boolean | `true` when front desk archives the conversation |
| `updatedAt` | timestamp | Latest conversation metadata update |
| `resolvedAt` | timestamp \| null | Set when the conversation is resolved |

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
| `orderRef` | string | Optional store order reference |
| `isEarlyCheckInRequest` | boolean | Optional Spark Rewards early check-in request flag |

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
| `paymentMethod` | string | Open key from `settings/hotelConfig.paymentMethods[]` where `showInStore !== false`; `pay-at-hotel` excluded |
| `paymentProofUrl` | string | Firebase Storage URL (required for any non-`cod`/non-`add-to-bill` method) |
| `paymentProofPath` | string | Private Storage object path for new guest uploads; required for online methods unless reading a legacy record |
| `status` | string | `"placed"` \| `"confirmed"` \| `"out-for-delivery"` \| `"delivered"` \| `"cancelled"` |
| `stockRestoredAt` | timestamp \| null | Set once when reserved stock is restored after a placed order cancellation |
| `deliveredAt` | timestamp \| null | Set by the staff delivery API; revenue-recognition and direct-tender timestamp |
| `isBilled` | boolean | `true` if added to booking bill |
| `billedAt` | timestamp \| null | When billed |
| `cancellationReason` | string | Optional |
| `handledBy` | string | Staff UID |
| `notes` | string | Internal staff notes |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

Direct-paid orders carry an append-only `payments/delivery-tender` record created atomically with the delivery transition. Its shape matches the shared payment ledger and adds store source metadata (`source`, source/order identifiers, room, and guest display fields). COD is normalized to the Cash tender. Add to Bill does not create this record because settlement occurs through the linked booking folio. The deterministic document ID makes retries idempotent, and keeping the tender under the order prevents it from reducing the booking's room balance.

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
| `paymentMethods` | `{method, label, qrUrl, accountInfo, isEnabled}[]` | Legacy only — ignored by checkout; canonical methods live on `settings/hotelConfig.paymentMethods[]` |
| `useBookingPaymentMethods` | boolean | Legacy only — ignored by checkout |

---

### `settings/breakfastConfig`

Single document. Managed from Settings → Breakfast tab.

| Field | Type | Notes |
|---|---|---|
| `isEnabled` | boolean | Global breakfast add-on on/off toggle |
| `ratePerPersonPerNight` | number | Set in Rate Management — locked at booking time |
| `silogItems` | `{id, name, isActive}[]` | Fully editable silog menu — e.g. Tapsilog, Longsilog, Tocilog |

---

Breakfast selections are intentionally stored on `bookings/{bookingId}.breakfastSelections`
instead of a separate collection. This keeps the drawer, kitchen-prep
report, and full backup export on one canonical source. The map key is
`yyyy-mm-dd-guest-n`; the value is the selected silog item name.

---

## Notifications (Phase 12 — Notification Center, decision #120)

One `notifications` doc per operational event, written **server-side
via the Admin SDK** from the existing API routes. The bell + panel in
the admin app subscribe to this collection via `onSnapshot`, bounded
to the most recent 50 docs (`orderBy("createdAt", "desc").limit(50)`).
Guest chat messages are **not** persisted here — they remain
live-derived from the `intercoms` listener (B1, per spec).

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"booking"` \| `"payment"` \| `"message"` \| `"arrival"` \| `"departure"` \| `"store-order"` |
| `title` | string | Plain-language summary, e.g. `"New booking — SI-20260715-00001 (Room 202)"`. Capped at 160 chars server-side. |
| `entityType` | string | `"booking"` \| `"storeOrder"` \| `"intercom"` — what the deep link targets |
| `entityId` | string | Booking ID / store order ID / room number |
| `roomNumber` | string \| null | Denormalized for display. Capped at 12 chars. **Never store guest email or payment data (Hard Rule: no PII).** |
| `bookingRef` | string \| null | e.g. `"SI-20260715-00001"`. Capped at 40 chars. |
| `readBy` | `Record<uid, timestamp>` | Per-staff read trail. Absence of my UID = unread for me. The Firestore rule restricts client updates to this field only. |
| `createdBy` | `"system"` | Always `"system"` (Admin SDK); never a guest |
| `createdAt` | timestamp | Server timestamp via `Timestamp.now()`; the panel orders by this desc |

**Retention** — a daily Vercel Cron (`vercel.json` → `/api/notifications/prune`, `0 3 * * *`)
hard-deletes docs older than 30 days. Without this, the collection
grows linearly forever on Blaze (the FLR-03 trap). The cron is
`CRON_SECRET`-gated like the existing janitor sweep + check-in
reminder. Bounded query (default `batchSize = 500`) so a single run
cannot OOM. Owner can run the prune manually by POSTing to
`/api/notifications/prune` with `x-cron-secret` + (optionally) a
shorter `maxAgeMs` for testing.

**Deep links** — clicking a notification row navigates by `entityType`:
- `booking` → `/bookings?bookingId={entityId}` (opens the booking drawer)
- `storeOrder` → `/bookings?tab=store&orderId={entityId}` (opens the order drawer on the Store tab; the Store tab lives inside the Bookings page)
- `intercom` → `/intercom?room={entityId}` (open the thread)

Click also stamps my UID into `readBy` (per-staff read trail).
"Mark all as read" stamps my UID into every currently-loaded unread
doc. Read state is durable across reloads + follows the staff member
across devices — the whole point of Option B (per spec).

---

## Booking Reference Format

`SI-YYYYMMDD-NNN` — e.g. `SI-20260601-001`

NNN is a zero-padded daily sequence. Generate and validate server-side via API route.

---

## Security Rules Summary

| Collection | Read | Write |
|---|---|---|
| `rooms` | Public | Create/Update = Staff; Delete = Admin |
| `roomDeletionAudit` | Staff/Admin only | Create = Admin only; immutable |
| `bookings` | Staff/Admin in Firestore client rules; guest lookup via API/ref+email only | Create = API/Admin SDK only; Update = Staff/Admin operational updates; Delete = Admin |
| `financeIntegrityRepairs` | Admin only | Admin SDK only; immutable audit records created by the approved FLR-01 repair workflow |
| `guests` | Owner or Staff/Admin | Create/disable via Admin SDK routes; profile update = Owner or Admin |
| `settings` | Public | Admin only |
| `corporateInquiries` | Staff/Admin only | Staff/Admin only; public guest submissions use `/api/corporate/inquiry` |
| `corporateCodes` | Staff/Admin only; public validation uses `/api/corporate/validate-code` | Staff/Admin only |
| `vouchers` | Staff/Admin only; public validation uses `/api/validate/voucher` | Staff or Admin |
| `intercoms` | Open (no auth) | Open with field validation on messages; guest UI throttles message sends; staff can moderate |
| `members` | Owner (self) or Staff/Admin | Create = API/Admin SDK only via `/api/members/register`; Update = owner or Staff/Admin |
| `members/{uid}/pointsHistory` | Owner or Staff/Admin | Create = system/Staff/Admin only |
| `settings/breakfastConfig` | Public (needed for booking flow) | Admin only |
| `storeItems` | Public (guests need to browse) | Staff or Admin |
| `storeOrders` | Staff/Admin only in Firestore client rules; guest status lookup via API room/order ref only | Create = API/Admin SDK only; ordinary updates = Staff/Admin; delivery + direct tender = staff API; guest cancellation via API only |
| `bookings/{id}/payments` | Staff/Admin only | Create = Staff/Admin via `/api/bookings/add-payment` using a client-preallocated document ID for idempotency; no updates or deletes |
| `storeOrders/{id}/payments` | Staff/Admin only through the collection-group read rule | Create = Admin SDK via `/api/store/deliver-order`; no updates or deletes |
| `settings/rewardsConfig` | Public via `settings/{documentId}` rule; non-sensitive booking/member display config | Admin only |
| `notifications` | Staff/Admin only (bell + persistent panel in admin app) | Create = Admin SDK only, written from the existing API routes (booking create / add-payment / confirm / check-in / check-out / store order placed); Update = Staff/Admin but **only the `readBy` field** (per-staff read trail); Delete = Admin SDK only (retention cron hard-deletes docs > 30 days old). See `plan/features/NOTIFICATION-CENTER.md` and decision #120. |
| `calls` | Open (no auth) — same as intercoms | Open (no auth) |
| `settings/storeConfig` | Public (guests need payment methods) | Admin only |

Full rules live in `firebase/firestore.rules`.

The one-off FLR-01 workflow lives at `scripts/finance-integrity-scan.ts`. Its
default mode is read-only and writes a local review CSV with every row set to
`approved=NO`. Apply mode requires staff to change individual rows to
`approved=YES` and supply the exact confirmation phrase; it transactionally
revalidates current source data, appends missing store tenders rather than
editing ledger history, and records each applied action in
`financeIntegrityRepairs`.

---

## Firebase SDK Usage

- Initialize Firebase once in `firebase/config.ts` per app
- Use `getFirestore()`, `getAuth()`, `getStorage()` — do not re-initialize
- Firestore real-time: `onSnapshot` in custom hooks — always unsubscribe in cleanup
- Firestore one-time: `getDoc` / `getDocs` for non-reactive reads
- Storage: compress image files with shared `compressImageFile()` before `uploadBytes`, then store the `getDownloadURL` result in Firestore
- Auth: `onAuthStateChanged` listener in auth hook — unsubscribe on cleanup

See `plan/docs/GOTCHAS.md` for common Firebase pitfalls.
