# Reports
> App: admin-app
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Reports

## Overview

The `/reports` page gives staff visibility into hotel performance and sales over time. Organized into two tabs: **Performance** (occupancy, bookings by source) and **Sales** (all revenue streams consolidated). Both tabs are exportable as PDF and XLSX. Accessible to both Front Desk and Admin roles.

---

## Tab 1 — Performance Report

Occupancy and booking patterns. Not revenue-focused.

### UI Checklist
- [ ] Date range selector — preset ranges (This Month, Last Month, Last 3 Months, Last 6 Months, Custom)
- [ ] Occupancy rate chart — bar or line chart, occupancy % per month (overall + breakdown by room type)
- [ ] Bookings by source chart — pie or bar chart: Online, Walk-in, Phone, Facebook, Corporate
- [ ] Summary stat cards — total bookings, avg occupancy %, busiest room type for selected period
- [ ] Recharts tooltips — hover shows exact value per data point
- [ ] Responsive charts — readable on tablet (768px min)
- [ ] Export PDF button — performance report (charts + stat cards) via jsPDF

### Data & Logic Checklist
- [ ] Query `bookings` where `status` is in `["confirmed", "checked-in", "checked-out"]` for selected date range
- [ ] Occupancy rate: (occupied room-nights / total available room-nights) × 100 per month
- [ ] Total available room-nights: total active room count × days in month — query room count from Firestore, never hardcode
- [ ] Bookings by source: count grouped by `source` field
- [ ] All aggregation done client-side — no server-side aggregation needed at this scale

### Manual QA
- [ ] Occupancy chart reflects correct data for the current month
- [ ] Bookings by source chart matches source breakdown in Bookings table
- [ ] Date range change updates all charts simultaneously
- [ ] PDF export includes all charts legibly
- [ ] Charts render correctly at 768px (tablet)

---

## Tab 2 — Sales Report

Consolidated revenue across all payment streams: room bookings, breakfast add-ons, and Spark Essentials store orders. This is the primary financial report for the hotel owner.

### UI Checklist

#### Summary Cards (top of tab)
- [ ] **Total Revenue** — combined across all streams for the selected period
- [ ] **Room Revenue** — sum of booking `totalPrice` (includes any discounts/vouchers applied)
- [ ] **Breakfast Revenue** — sum of `breakfastRate × numGuests × numNights` for bookings with `hasBreakfast: true`
- [ ] **Store Revenue** — sum of `storeOrder.totalAmount` for `delivered` store orders
- [ ] **Total Transactions** — count of bookings + delivered store orders combined

#### Charts
- [ ] **Revenue by stream (stacked bar chart)** — one bar per month, stacked by Room / Breakfast / Store — shows contribution of each stream at a glance
- [ ] **Revenue trend line** — total combined revenue per month over the selected period
- [ ] **Store: top-selling items** — horizontal bar chart, top 10 items by revenue for the period
- [ ] **Payment method breakdown** — pie chart across all streams (GCash, Pay at Hotel, CoD, Add to Bill) — combined from bookings + store orders

#### Sales Detail Table
- [ ] Tabbed sub-view inside Sales tab: **Bookings** | **Breakfast** | **Store Orders**
- [ ] **Bookings sub-table** — Booking Ref, Guest, Room, Check-In, Check-Out, Nights, Room Rate, Breakfast, Discount, Voucher, Total, Payment Method, Status
- [ ] **Breakfast sub-table** — Booking Ref, Guest, Room, Check-In, Nights, Guests, Breakfast Rate/person, Total Breakfast Revenue
- [ ] **Store Orders sub-table** — Order Ref, Room, Item(s), Qty, Unit Price, Total, Payment Method, Status, Date
- [ ] All sub-tables are paginated (20 rows default), searchable by ref or name
- [ ] All sub-tables filterable by payment method and status

#### Export Controls
- [ ] **Print Sales Report** button — opens a clean printable PDF (see §Sales Report PDF below)
- [ ] **Export XLSX** button — multi-sheet Excel file (see §Sales XLSX Export below)

### Data & Logic Checklist
- [ ] Bookings query: `status` in `["confirmed", "checked-in", "checked-out"]`, `checkIn` within date range
- [ ] Room revenue: sum of `totalPrice` per booking (already net of discounts/vouchers)
- [ ] Breakfast revenue: `breakfastRate × numGuests × numNights` computed per booking where `hasBreakfast: true` — NOT a separate collection, derived from booking documents
- [ ] Store revenue: query `storeOrders` where `status == "delivered"` and `createdAt` within date range, sum `totalAmount`
- [ ] "Add to Bill" store orders: counted in store revenue (amount noted for front desk to collect — see `docs/DECISIONS-FEATURES.md #35`)
- [ ] Combined total: room revenue + breakfast revenue + store revenue
- [ ] Payment method breakdown: merge payment method counts from `bookings.paymentMethod` + `storeOrders.paymentMethod`
- [ ] All aggregation client-side

### Edge Cases & States
- [ ] Loading state — skeleton cards and charts while all three queries resolve in parallel
- [ ] No store orders for period — Store card shows ₱0, store charts hidden with "No store data" message
- [ ] Breakfast disabled globally — Breakfast card shows ₱0, no breakfast sub-table
- [ ] Partial month selected — all stats reflect only the selected range, not the full month
- [ ] "Add to Bill" orders: clearly labeled in payment breakdown — front desk knows these are uncollected

---

## Sales Report PDF (Printable)

Generated via jsPDF. Clean, branded layout intended for printing or sharing with the hotel owner.

### Layout
1. **Header** — Spark Inn logo + hotel name + address + "Sales Report" title + date range
2. **Summary section** — 4 revenue cards in a 2×2 grid: Total Revenue, Room Revenue, Breakfast Revenue, Store Revenue
3. **Revenue by stream bar chart** — Recharts SVG captured via html2canvas
4. **Revenue trend line chart** — Recharts SVG captured via html2canvas
5. **Bookings table** — all bookings for the period (truncated to fit; continued on next page if needed)
6. **Store Orders table** — all delivered store orders for the period
7. **Footer** — "Generated on {date} by {staffName}" + "Spark Inn Hotel Corp"

### PDF Checklist
- [ ] Apollo + Inter fonts embedded as base64
- [ ] Logo embedded as base64
- [ ] Charts captured via html2canvas before PDF generation — call `html2canvas(chartRef.current)` on each Recharts wrapper div
- [ ] Tables paginate across PDF pages — jsPDF `autoTable` plugin handles this
- [ ] Currency formatted as `₱{amount.toLocaleString('en-PH')}` throughout
- [ ] Dates formatted as `MMM D, YYYY` throughout
- [ ] Filename: `spark-inn-sales-report-{startDate}-to-{endDate}.pdf`
- [ ] Print button triggers `window.print()` as fallback for browser printing

---

## Sales XLSX Export (Multi-sheet)

One XLSX file with 4 sheets covering all revenue data.

### Sheets
| Sheet | Contents |
|---|---|
| **Summary** | Revenue totals by stream + payment method breakdown for the period |
| **Bookings** | All booking records (same columns as §Data Backup) |
| **Breakfast** | Per-booking breakfast breakdown (ref, room, nights, guests, rate, total) |
| **Store Orders** | All delivered store order records (ref, room, items, qty, price, total, payment, date) |

### Summary Sheet Columns
| Row | Value |
|---|---|
| Date Range | `{startDate} to {endDate}` |
| Total Revenue | combined ₱ |
| Room Revenue | ₱ |
| Breakfast Revenue | ₱ |
| Store Revenue | ₱ |
| Total Bookings | count |
| Total Store Orders | count |
| (blank row) | |
| Payment Method Breakdown | one row per method with count + total ₱ |

### XLSX Checklist
- [ ] Use SheetJS (`xlsx` npm package)
- [ ] Generate entirely client-side — no API route needed
- [ ] Filename: `spark-inn-sales-{YYYY-MM-DD}.xlsx`
- [ ] Header rows bold in all sheets
- [ ] Currency columns formatted as number (no ₱ symbol — Excel handles formatting)
- [ ] Dates as readable strings (YYYY-MM-DD), not Excel serial numbers
- [ ] Empty Breakfast sheet with header row only if no breakfast bookings in period
- [ ] Empty Store Orders sheet with header row only if no store orders in period

---

---

## Breakfast Reports (Kitchen Operations)

Separate from the Sales tab — this is an operational tool for kitchen prep, not a revenue report.

- [ ] **Daily kitchen prep report** — date picker (default: tomorrow) → shows total count of each silog needed for that morning
  - e.g. "Tapsilog × 4, Longsilog × 2, Tocilog × 3"
  - Grouped by silog name, sorted by count descending
  - Only counts `breakfastSelections` entries for that date where `bookingId` links to a `confirmed` or `checked-in` booking
- [ ] Print/export kitchen prep report — simple printable list for kitchen staff (window.print() or jsPDF)
- [ ] Unentered selections warning — if a breakfast booking is checking in today but silog selections are not yet entered, show alert

> Breakfast **revenue** figures live in the Sales Report tab, not here.

### Data & Logic Checklist
- [ ] Kitchen prep: query `breakfastSelections` where `date == selectedDate`, join to active bookings

---

## Spark Essentials — Low Stock Alerts

Operational view for store inventory — separate from Sales tab revenue figures.

- [ ] Low stock alert list — items at or below `settings/storeConfig.lowStockThreshold` or out of stock
- [ ] Orders by status — delivered vs cancelled vs pending count for today

> Store **revenue** figures, top-selling items chart, and order history live in the Sales Report tab.

See `features/STORE-MANAGEMENT.md §Store Reports` for the full store management checklist.

---

## Manual QA — Sales Report

- [ ] Total Revenue card matches sum of all three stream totals
- [ ] Room Revenue matches sum of `totalPrice` across confirmed/checked-in/checked-out bookings for the period
- [ ] Breakfast Revenue matches manual calculation: `breakfastRate × numGuests × numNights` per breakfast booking
- [ ] Store Revenue matches sum of `totalAmount` across delivered store orders for the period
- [ ] Stacked bar chart shows correct monthly breakdown per stream
- [ ] Bookings sub-table rows match booking count in Bookings Management for same period
- [ ] Store sub-table rows match delivered order count in Store Management for same period
- [ ] Payment method pie chart totals equal total transaction count
- [ ] PDF generates with logo, correct date range, all sections present, tables paginate correctly
- [ ] XLSX has all 4 sheets with correct headers and data
- [ ] Changing date range updates all cards, charts, and tables simultaneously

---

## Data Backup (Full Excel Export)

Client-requested feature: one-click full data backup to a single multi-sheet Excel file. Admin-only. Covers all operational data — not filtered by date range.

### UI
- [ ] **"Download Full Backup"** button — in Reports page, clearly separated from the filtered chart exports; admin-only (front desk cannot see this button)
- [ ] Confirmation prompt before export: "This will export all hotel data. This may take a moment." with Cancel / Download buttons
- [ ] Loading state while all Firestore queries resolve — disable button, show spinner + "Preparing backup..."
- [ ] On complete: file auto-downloads; show success toast "Backup downloaded successfully"

### Sheets

| Sheet | Source collection | What's included |
|---|---|---|
| **Bookings** | `bookings` | All bookings, all time, all statuses |
| **Payments** | `bookings/{id}/payments` | All onsite payment entries, joined to booking ref |
| **Members** | `members` | All registered loyalty members |
| **Store Orders** | `storeOrders` | All store orders, all statuses |
| **Store Catalog** | `storeItems` | All store items including inactive |
| **Breakfast Selections** | `breakfastSelections` | All silog selections entered by front desk |
| **Vouchers** | `vouchers` | All promo vouchers including expired/inactive |
| **Corporate Inquiries** | `corporateInquiries` | All inquiry pipeline entries |

---

### Sheet: Bookings

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

### Sheet: Payments

| Column | Source |
|---|---|
| Booking Ref | joined from `bookings` |
| Amount | `amount` |
| Method | `method` |
| Note | `note` |
| Recorded By | `recordedBy` (staff UID) |
| Recorded At | `recordedAt` (YYYY-MM-DD HH:mm) |

---

### Sheet: Members

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

### Sheet: Store Orders

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

### Sheet: Store Catalog

| Column | Source |
|---|---|
| Item Name | `name` |
| Description | `description` |
| Price | `price` |
| Stock | `stock` (blank = unlimited) |
| Is Active | `isActive` |
| Created At | `createdAt` (YYYY-MM-DD) |

---

### Sheet: Breakfast Selections

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

### Sheet: Vouchers

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

### Sheet: Corporate Inquiries

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

### Implementation Notes
- [ ] Use SheetJS (`xlsx` npm package) — client-side, no API route needed
- [ ] All 8 Firestore queries run in parallel via `Promise.all()` — do not run sequentially
- [ ] Payments sheet: fetch `payments` subcollection for each booking via `Promise.all(bookings.map(...))` — join `bookingRef` by bookingId
- [ ] Filename: `spark-inn-full-backup-{YYYY-MM-DD}.xlsx`
- [ ] Sheet tab names match the names in the Sheets table above exactly
- [ ] First row of each sheet is a bold header row
- [ ] Empty sheets still included with header row — e.g. if no store orders yet, sheet exists with headers only
- [ ] Dates as readable strings (YYYY-MM-DD), not Excel serial numbers
- [ ] Boolean fields exported as "Yes" / "No" — not TRUE/FALSE
- [ ] Admin-only: verify role before rendering the button; API is not needed since this is read-only Firestore, but check role client-side

---

## Manual QA — Data Backup

- [ ] "Download Full Backup" button only visible to admin role — hidden for front desk
- [ ] Confirmation prompt appears before download begins
- [ ] All 8 sheets present in downloaded file with correct tab names
- [ ] Bookings sheet row count matches total bookings in Bookings Management
- [ ] Members sheet row count matches total members in Member Management
- [ ] Payments sheet rows correctly joined to booking refs
- [ ] Empty sheets still present with header rows (e.g. if no corporate inquiries yet)
- [ ] Boolean columns show "Yes"/"No" not TRUE/FALSE
- [ ] Dates readable as strings — not numeric Excel serial values
- [ ] File opens correctly in Microsoft Excel and LibreOffice Calc

---

## References

- Booking schema (source, status, totalPrice): `docs/BACKEND.md §bookings`
- jsPDF usage: `features/EMAIL-PDF-STORAGE.md`
- Recharts: already in stack — `docs/DECISIONS.md`
- Status values for revenue queries: `docs/TYPES.md §BookingStatus`
