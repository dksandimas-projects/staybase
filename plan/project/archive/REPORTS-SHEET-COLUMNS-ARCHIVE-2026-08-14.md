# HISTORICAL ARCHIVE — REPORTS.md Per-Sheet Column Reference (2026-08-14)

> **HISTORICAL ARCHIVE** — This document contains the verbatim per-sheet column reference for the Sales XLSX + Full Backup XLSX exports. The active spec file `plan/features/REPORTS.md` has been compacted to a "columns match the live SheetBuilder helpers" pointer per CONTRIBUTING.md §Move out rule. The column lists here are the canonical references for anyone debugging an export-format mismatch. The full-detail sheets (Sales XLSX spec, Full Backup XLSX spec) were the largest contributor to REPORTS.md's bloat.

For the active spec, see [`plan/features/REPORTS.md`](../features/REPORTS.md). For the live implementation, see `admin-app/src/utils/` (the export-sheet helpers the column lists below implement).

---

## Sales XLSX — Sheet: Bookings

> **Original location:** `plan/features/REPORTS.md §Sales XLSX Export (Multi-sheet) §Sheet: Bookings`.

| Column | Source |
|---|---|
| Booking Ref | `bookingRef` |
| Guest Name | `guestName` |
| Guest Email | `guestEmail` |
| Guest Phone | `guestPhone` |
| Room Number | `roomNumber` |
| Room Type | `roomType` |
| Check-In | `checkIn` (YYYY-MM-DD) |
| Check-Out | `checkOut` (YYYY-MM-DD) |
| Nights | computed |
| Guests | `numGuests` |
| Adults | `numAdults` when the stored split is valid; otherwise `numGuests` |
| Children | `numChildren` when the stored split is valid; otherwise `0` |
| Has Breakfast | `hasBreakfast` |
| Rate/Night | `ratePerNight` |
| Breakfast Rate | `breakfastRate` |
| Discount Type | `discountType` |
| Discount % | `discountPct` |
| Discount Verified | `discountVerified` |
| Voucher Code | `voucherCode` |
| Voucher Discount | `voucherDiscount` |
| Points Redeemed | `pointsRedeemed` |
| Points Value | `pointsRedeemedValue` |
| Total Price | `totalPrice` |
| Total Collected Onsite | sum of `payments[]` subcollection |
| Outstanding Balance | `totalPrice − totalCollected` |
| Payment Method | `paymentMethod` |
| Reference Number | Latest `transactionReference` on the booking's `onsitePayments[]` ledger (per 2026-07-24 `refactor/unify-payment-reference-fields`; see `plan/features/BOOKINGS-MANAGEMENT.md §Payment Reference Semantics`) |
| Source | `source` |
| Status | `status` |
| Is Corporate | `isCorporate` |
| Corporate Code | `corporateCode` |
| Company Name | `companyName` |
| Member ID | `memberId` |
| Notes | `notes` |
| Created At | `createdAt` (YYYY-MM-DD HH:mm) |
| Updated At | `updatedAt` (YYYY-MM-DD HH:mm) |

---

## Sales XLSX — Sheet: Payments

> **Original location:** `plan/features/REPORTS.md §Sales XLSX Export (Multi-sheet) §Sheet: Payments`.

| Column | Source |
|---|---|
| Booking Ref | joined from `bookings` |
| Amount | `amount` |
| Method | `method` |
| Note | `note` |
| Recorded By | `recordedBy` (staff UID) |
| Recorded At | `recordedAt` (YYYY-MM-DD HH:mm) |

---

## Full Backup XLSX — Sheet: Members

| Column | Source |
|---|---|
| Member Number | `memberNumber` |
| Full Name | `fullName` |
| Email | `email` |
| Phone | `phone` |
| Auth Provider | `authProvider` |
| Member Since | `memberSince` (YYYY-MM-DD) |
| Points Balance | `rewardsPoints` |
| Tier | `tier` |
| Is Active | `isActive` |
| Created At | `createdAt` (YYYY-MM-DD) |

---

## Full Backup XLSX — Sheet: Store Orders

| Column | Source |
|---|---|
| Order Ref | `orderRef` |
| Room Number | `roomNumber` |
| Booking ID | `bookingId` |
| Guest Name | `guestName` |
| Items | `items[].name × qty` joined as comma-separated string |
| Total Amount | `totalAmount` |
| Payment Method | `paymentMethod` |
| Status | `status` |
| Is Billed | `isBilled` |
| Notes | `notes` |
| Created At | `createdAt` (YYYY-MM-DD HH:mm) |

---

## Full Backup XLSX — Sheet: Store Catalog

| Column | Source |
|---|---|
| Item Name | `name` |
| Description | `description` |
| Price | `price` |
| Stock | `stock` (blank = unlimited) |
| Is Active | `isActive` |
| Created At | `createdAt` (YYYY-MM-DD) |

---

## Full Backup XLSX — Sheet: Breakfast Selections

| Column | Source |
|---|---|
| Booking Ref | joined from `bookings` |
| Room Number | `roomNumber` |
| Date | `date` |
| Guest Index | `guestIndex` |
| Guest Name | `guestName` |
| Silog | `silogName` |
| Entered By | `enteredBy` (staff UID) |
| Created At | `createdAt` (YYYY-MM-DD HH:mm) |

---

## Full Backup XLSX — Sheet: Vouchers

| Column | Source |
|---|---|
| Code | `code` |
| Discount Type | `discountType` |
| Discount Value | `discountValue` |
| Usage Cap | `usageCap` (blank = unlimited) |
| Usage Count | `usageCount` |
| Expires At | `expiresAt` (YYYY-MM-DD, blank = no expiry) |
| Applicable Room Types | `applicableRoomTypes` joined comma-separated (blank = all) |
| Is Active | `isActive` |
| Created At | `createdAt` (YYYY-MM-DD) |

---

## Full Backup XLSX — Sheet: Corporate Inquiries

| Column | Source |
|---|---|
| Company Name | `companyName` |
| Contact Person | `contactPerson` |
| Email | `email` |
| Phone | `phone` |
| Rooms | `numRooms` |
| Preferred From | `preferredDates.from` (YYYY-MM-DD) |
| Preferred To | `preferredDates.to` (YYYY-MM-DD) |
| Requirements | `specialRequirements` |
| Status | `status` |
| Access Code ID | `accessCodeId` |
| Created At | `createdAt` (YYYY-MM-DD HH:mm) |

---

## Re-activation rule

If a future audit needs to add a column to a sheet (e.g. a new `paymentProvider` field for the Payment Method column), update the active spec's "column lists match the live SheetBuilder helpers" pointer to reflect the new column, then update the matching sheet helper in `admin-app/src/utils/`. The live SheetBuilder is the canonical source going forward — the README is for quick reference only.
