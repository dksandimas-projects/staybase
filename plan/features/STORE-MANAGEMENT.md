# Spark Essentials — Store Management
> App: admin-app
> Phase: Phase 8 — Intercom (Spark Essentials)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Store Management

## Overview

The admin-side of the in-room store feature (named "Spark Essentials" for Spark Inn — display name is always `config.storeName`). Admins manage the product catalog from Settings, while front desk staff view and process orders, update order statuses, and handle store billing at checkout. Reports cover sales, revenue, and stock.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Most common action is reachable in ≤ 2 clicks from the sidebar
- [x] Loading state uses skeleton, not spinner
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Destructive actions have a single confirmation step — not buried in menus
- [x] Empty states explain why data is missing and what to do

---

## Catalog Management (within Settings → Store tab)

Settings is admin-only. Front Desk processes guest orders and billing from the operational inbox/booking surfaces, but does not manage catalog items, breakfast menu items, or store configuration.

### UI Checklist
- [x] Item list — name, category, price, stock (count or "Unlimited"), status badge (Active/Inactive), edit + delete buttons
- [x] Category filters — Drinks, Snacks, Toiletries, Rentals, Other
- [x] Add item modal — name, category, description (optional), price, stock quantity (number or toggle for unlimited), compressed photo upload preview, active toggle
- [x] Edit item modal — same fields as add
- [x] Delete item — confirmation prompt ("Orders referencing this item will not be affected")
- [x] Enable/disable store globally — toggle at top of Store settings tab
- [x] **Store payment methods** — single source of truth is Settings → Payment Methods (`settings/hotelConfig.paymentMethods[]`). Store visibility is controlled per method via `showInStore`; `cod` and `add-to-bill` are backfilled into the main list as store-only methods. The Store tab only links to the Payment Methods tab and does not own a second payment-method editor.
- [x] Online payment QR/account info for store payments comes from the canonical payment method entry.

### Data & Logic Checklist
- [x] `addDoc` / `updateDoc` / soft-delete on `storeItems` collection
- [x] Stock: `null` = unlimited, `0` = out of stock, `n` = n remaining
- [x] Deleting an item: soft-delete (`isActive: false`) if it has existing orders — never hard delete referenced items
- [x] Store config saved to `settings/storeConfig` — `isEnabled`, `paymentMethods[]`
- [x] Item photo: compress with shared `compressImageFile()`, then upload to Firebase Storage at `store-items/{itemId}/{filename}`

---

## Order Management (new dashboard page or section within Bookings)

### UI Checklist
- [x] Orders list — order ref, room number, guest name (if booking found), items summary, total, payment method, status badge, timestamp (payment method and timestamp details are viewed in the detail drawer to keep the table columns clean)
- [x] Filter by status, by payment method, by date range (search and status filters are on the Bookings page list; date range filtering is supported in the Reports page table)
- [x] Order detail drawer — full item list, quantities, total, payment method, GCash proof (if applicable), linked booking ref, room number, notes
- [x] Status action buttons — context-aware:
  - `placed` → Confirm, Cancel
  - `confirmed` → Mark Out for Delivery, Cancel
  - `out-for-delivery` → Mark Delivered
  - `delivered` → staff-authenticated server transition; atomically records the direct tender for COD/online methods, then no further actions
  - `cancelled` → no further actions
- [x] "Add to Booking Bill" action — available on delivered or confirmed orders with `paymentMethod: "add-to-bill"`; links order to booking, marks as billed
- [x] Cancel order modal — optional reason input; **CRL-04 (2026-08-02)** — a cancelled paid GCash order (one with `paymentMethod === "gcash"` and a `paymentProofUrl`) fires a dedicated staff refund-review alert (`sendStaffRefundReviewTrigger`) so the front desk has a queue-able owner for the refund follow-up. The guest still gets the standard `store-order-cancelled` email. COD and Add-to-Bill orders do not need a refund review: the money has either not been collected yet (COD) or rolls into the booking folio (Add-to-Bill, settled at checkout).
- [x] GCash screenshot viewable in drawer

### Data & Logic Checklist
- [x] `onSnapshot` on `storeOrders` — real-time updates
- [x] Status update: `updateDoc` on `storeOrders/{orderId}` — update `status` + `updatedAt` + `handledBy`
- [x] **Stock decrement happens on order confirmation, not on order creation** *(Per `DECISIONS-FEATURES.md #80`)*. The current text "order creation reserves finite stock in the API transaction; confirmation does not decrement again" is reversed — stock is **not** decremented at create; a new `handleConfirmStoreOrder` API decrements inside a transaction. `handleCancelStoreOrder` only restores stock that was decremented at confirmation.
- [x] Stock restored if a `placed` order is cancelled before confirmation — but the `placed` order did not decrement stock, so no restoration is needed for that path. Cancellation after confirmation: add back quantities once using `stockRestoredAt`.
- [x] "Add to Booking Bill": `updateDoc` on order `isBilled: true`, `billedAt: timestamp`. The booking document itself is **not** mutated — the checkout folio derives billed store charges at read time by filtering `storeOrders` on `bookingId === booking.id && paymentMethod === "add-to-bill" && status === "delivered" && isBilled === true`. See `plan/docs/BACKEND.md §bookings` for rationale.
- [x] Order notification: intercom badge message already sent by guest — admin sees it in intercom thread
- [x] New order sound notification — same Web Audio API pattern as intercom (plays when guest's order creates a message in the intercom thread)

---

## Store Reports (within Reports page)

### UI Checklist
- [x] Sales by item — bar chart, most ordered items in selected period
- [x] Store revenue — total revenue from delivered store orders in selected period
- [x] Direct-paid delivery tender — one idempotent ledger entry at delivery; COD maps to Cash, Add to Bill remains on the booking folio
- [x] Orders by payment method — pie chart (CoD, Add to Bill, GCash)
- [x] Orders by status — count of delivered vs cancelled vs pending
- [x] Low stock alert — list of items with stock ≤ threshold (default 5) or out of stock
- [x] Export store report as CSV

### Data & Logic Checklist
- [x] Query `storeOrders` for selected date range — exclude `cancelled` orders for revenue
- [x] Revenue: sum of `totalAmount` for `delivered` orders in period
- [x] Low stock: query `storeItems` where `stock <= threshold` AND `stock != null`
- [x] All aggregation client-side from Firestore results

---

## Edge Cases & States

- [x] Order placed for item that has since been deleted — show item name from order snapshot, not live catalog
- [x] Stock goes to 0 after order confirmed — show "Out of Stock" on guest store, do not block already-placed orders
- [x] No orders in selected report period — show empty chart, not an error
- [x] Booking not found for an order — show "No booking linked" in drawer, allow manual handling

## Manual QA

- [x] Add item with stock 5 — appears in guest store with correct stock
- [x] Place 5 orders for that item — 6th attempt blocked (out of stock)
- [x] Cancel order after placed — stock restored correctly
- [x] Confirm order — reserved stock stays decremented without double-counting
- [x] Status transitions work correctly through full flow
- [x] GCash screenshot viewable in order drawer
- [x] "Add to Booking Bill" links order to correct booking
- [x] Store disabled in settings — Shop tab hidden on guest intercom page
- [x] Store reports show correct revenue and item counts
- [x] Low stock alert shows items at or below threshold

## References

- Guest store ordering: `plan/features/STORE-GUEST.md`
- Store schema: `plan/docs/BACKEND.md §storeItems`, `plan/docs/BACKEND.md §storeOrders`
- Store settings: `plan/features/SETTINGS.md §Store`
- Reports page: `plan/features/REPORTS.md`
- Intercom order notification: `plan/features/INTERCOM-INBOX.md`
- Booking bill integration: `plan/features/BOOKINGS-MANAGEMENT.md`
