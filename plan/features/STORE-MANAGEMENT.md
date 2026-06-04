# Spark Essentials — Store Management
> App: admin-app
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Store Management

## Overview

The admin-side of the in-room store feature (named "Spark Essentials" for Spark Inn — display name is always `config.storeName`). Front desk staff manage the product catalog, view and process orders, update order statuses, and handle store billing at checkout. Reports cover sales, revenue, and stock. Accessible to both Front Desk and Admin roles.

---

## Catalog Management (within Settings → Store tab)

### UI Checklist
- [ ] Item list — name, price, stock (count or "Unlimited"), status badge (Active/Inactive), edit + delete buttons
- [ ] Add item form — name, description (optional), price, stock quantity (number or toggle for unlimited), photo upload (optional), active toggle
- [ ] Edit item — same fields as add
- [ ] Delete item — confirmation modal ("Orders referencing this item will not be affected")
- [ ] Enable/disable store globally — toggle at top of Store settings tab
- [ ] Store payment methods — enable/disable CoD, Add to Bill, GCash (with QR upload and account info) — separate from booking payment methods

### Data & Logic Checklist
- [ ] `addDoc` / `updateDoc` / `deleteDoc` on `storeItems` collection
- [ ] Stock: `null` = unlimited, `0` = out of stock, `n` = n remaining
- [ ] Deleting an item: soft-delete (`isActive: false`) if it has existing orders — never hard delete referenced items
- [ ] Store config saved to `settings/storeConfig` — `isEnabled`, `paymentMethods[]`
- [ ] Item photo: upload to Firebase Storage at `store-items/{itemId}/{filename}`

---

## Order Management (new dashboard page or section within Bookings)

### UI Checklist
- [ ] Orders list — order ref, room number, guest name (if booking found), items summary, total, payment method, status badge, timestamp
- [ ] Filter by status, by payment method, by date range
- [ ] Order detail drawer — full item list, quantities, total, payment method, GCash proof (if applicable), linked booking ref, room number, notes
- [ ] Status action buttons — context-aware:
  - `placed` → Confirm, Cancel
  - `confirmed` → Mark Out for Delivery, Cancel
  - `out-for-delivery` → Mark Delivered
  - `delivered` → no further actions
  - `cancelled` → no further actions
- [ ] "Add to Booking Bill" action — available on delivered or confirmed orders with `paymentMethod: "add-to-bill"`; links order to booking, marks as billed
- [ ] Cancel order modal — optional reason input
- [ ] GCash screenshot viewable in drawer

### Data & Logic Checklist
- [ ] `onSnapshot` on `storeOrders` — real-time updates
- [ ] Status update: `updateDoc` on `storeOrders/{orderId}` — update `status` + `updatedAt` + `handledBy`
- [ ] Stock decrement: when order status moves to `confirmed`, decrement `storeItems/{itemId}.stock` for each item (skip if stock is null/unlimited) — use Firestore transaction to prevent overselling
- [ ] Stock restored if order is cancelled before `confirmed` — add back quantities
- [ ] "Add to Booking Bill": `updateDoc` on order `isBilled: true`, `billedAt: timestamp`; optionally `updateDoc` on `bookings/{bookingId}` to append to a `storeCharges[]` array for checkout reference
- [ ] Order notification: intercom badge message already sent by guest — admin sees it in intercom thread
- [ ] New order sound notification — same Web Audio API pattern as intercom (play on new `placed` order if not on store orders page)

---

## Store Reports (within Reports page)

### UI Checklist
- [ ] Sales by item — bar chart, most ordered items in selected period
- [ ] Store revenue — total revenue from store per month (Recharts)
- [ ] Orders by payment method — pie chart (CoD, Add to Bill, GCash)
- [ ] Orders by status — count of delivered vs cancelled vs pending
- [ ] Low stock alert — list of items with stock ≤ threshold (configurable, default 5) or out of stock
- [ ] Export store report as PDF or CSV

### Data & Logic Checklist
- [ ] Query `storeOrders` for selected date range — exclude `cancelled` orders for revenue
- [ ] Revenue: sum of `totalAmount` for `delivered` orders in period
- [ ] Low stock: query `storeItems` where `stock <= threshold` AND `stock != null`
- [ ] All aggregation client-side from Firestore results

---

## Edge Cases & States

- [ ] Order placed for item that has since been deleted — show item name from order snapshot, not live catalog
- [ ] Stock goes to 0 after order confirmed — show "Out of Stock" on guest store, do not block already-placed orders
- [ ] No orders in selected report period — show empty chart, not an error
- [ ] Booking not found for an order — show "No booking linked" in drawer, allow manual handling

## Manual QA

- [ ] Add item with stock 5 — appears in guest store with correct stock
- [ ] Place 5 orders for that item — 6th attempt blocked (out of stock)
- [ ] Cancel order after placed — stock restored correctly
- [ ] Confirm order — stock decremented
- [ ] Status transitions work correctly through full flow
- [ ] GCash screenshot viewable in order drawer
- [ ] "Add to Booking Bill" links order to correct booking
- [ ] Store disabled in settings — Shop tab hidden on guest intercom page
- [ ] Store reports show correct revenue and item counts
- [ ] Low stock alert shows items at or below threshold

## References

- Guest store ordering: `plan/features/STORE-GUEST.md`
- Store schema: `plan/docs/BACKEND.md §storeItems`, `plan/docs/BACKEND.md §storeOrders`
- Store settings: `plan/features/SETTINGS.md §Store`
- Reports page: `plan/features/REPORTS.md`
- Intercom order notification: `plan/features/INTERCOM-INBOX.md`
- Booking bill integration: `plan/features/BOOKINGS-MANAGEMENT.md`
