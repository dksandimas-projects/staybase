# Spark Essentials — Guest Store
> App: guest-app
> Phase: Phase 8 — Intercom (Spark Essentials)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, features/INTERCOM-GUEST.md
> Design ref: spark-inn-design-spec.md §Spark Essentials

## Overview

"Spark Essentials" is the Spark Inn deployment name for the in-room shop feature. The display name shown to guests in the UI is always `config.storeName` — never hardcoded. For Spark Inn: "Spark Essentials". For other hotel deployments: whatever is set in their `hotel.config.ts`.

The store is accessible from the guest intercom page via QR scan. Guests browse available items and place orders for delivery to their room. Only accessible via QR — not from the public website directly. Orders are linked to the guest's room and active booking.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Back navigation never loses user input
- [ ] Confirmation/success state feels celebratory, not just "OK"

---

## UI Checklist

- [x] "Shop" tab or panel within the intercom page — alongside the chat interface
- [x] Item grid — name, photo (optional), short description, price, stock badge (Available / Out of Stock)
- [x] Items with `stock: null` (unlimited) show no stock count — just "Available"
- [x] Items with `stock: 0` show "Out of Stock" and are not orderable
- [x] Cart — add/remove items, quantity selector per item, running total
- [x] Checkout panel:
  - [x] Order summary (items, quantities, total)
  - [x] Payment method selector — options sourced from `getEffectiveStorePaymentMethods(storeConfig, hotelConfig.paymentMethods)` in `shared/utils/storePaymentMethods.ts`. When the admin's `useBookingPaymentMethods` toggle is OFF (default), the 3 hardcoded methods (`cod`, `add-to-bill`, `gcash`) are shown. When ON, the list is the union of the 2 store-specific methods + the enabled booking methods (excluding `pay-at-hotel`).
  - [x] CoD: no extra input needed
  - [x] Add to Bill: note "This will be added to your room bill — payment collected at checkout"
  - [x] Any non-`cod`/non-`add-to-bill` method (GCash from the legacy 3-method set, or any inherited booking method): show the configured QR + account name + account number + screenshot upload field. The same generic UI renders for every "online" method.
- [x] Place Order button (primary color)
- [x] Order confirmation — order reference number, estimated delivery note, "Track your order" link
- [x] Order status tracker — shows current status of most recent order (Placed → Confirmed → Out for Delivery → Delivered)
- [x] Cancel order button — shown only when status is `"placed"`
- [x] Order sends a styled badge message in the intercom chat thread (visually distinct — like quick requests)

## Data & Logic Checklist

- [x] Room ID from URL param `:roomId` — same as intercom
- [x] Active booking lookup: query `bookings` where `roomNumber` matches room and `status` is in `["confirmed", "checked-in"]` — link order to this booking if found
- [x] Fetch `storeItems` where `isActive: true` — real-time via `onSnapshot`
- [x] Cart state managed in React state (not persisted — clears on page refresh)
- [x] Order creation: API route writes to `storeOrders` — includes `roomId`, `roomNumber`, `bookingId` (if found), `items[]`, `totalAmount`, `paymentMethod`, `status: "placed"`
- [x] **Payment proof screenshot** (required for any non-`cod`/non-`add-to-bill` method, not just GCash — see §Store Payment Methods): upload to Firebase Storage under `store-orders/{roomId}/payment-proof/`, store URL in order document
- [x] Order confirmation message: `addDoc` to `intercoms/{roomId}/messages` with `isStoreOrder: true`, styled summary of items ordered
- [x] Cancel order: API route sets status to `"cancelled"` — only allowed when `status === "placed"` and room/order ref match
- [x] Order status refresh: API route returns guest-safe `status` only when room/order ref match; intercom tracker polls while order is active
- [x] Payment methods for store fetched from `getEffectiveStorePaymentMethods(storeConfig, hotelConfig.paymentMethods)` — see `shared/utils/storePaymentMethods.ts` and `plan/features/SETTINGS.md §11 Store → §Store Payment Methods`. The helper also filters by the per-method `showInStore` flag (per #111) — methods where the admin has explicitly set `showInStore: false` are excluded from the store checkout. Pre-#111 methods are treated as `showInStore: true` (permissive read).

## Edge Cases & States

- [x] No active booking found for room — allow order but `bookingId` is null; front desk handles manually
- [x] Item goes out of stock between page load and order submission — server-side stock check at order creation; return stock error
- [x] All store items inactive/out of stock — show "The shop is currently unavailable" empty state
- [x] Store disabled entirely (`settings/storeConfig.isEnabled: false`) — hide Shop tab, show "Coming soon" or nothing
- [x] GCash screenshot upload fails — show error, do not submit order without it if GCash selected
- [x] Cart empty on checkout attempt — disable Place Order button
- [x] Order already cancelled — hide cancel button, show cancelled badge

## Manual QA

- [ ] Shop tab visible on intercom page after QR scan
- [ ] Items load correctly with prices and stock status
- [ ] Out of stock items cannot be added to cart
- [ ] Full checkout flow: add items → select payment → place order
- [ ] Order appears in admin Store Management immediately
- [ ] Order confirmation badge appears in intercom chat thread
- [ ] GCash flow: screenshot upload required, viewable in admin
- [ ] Add to Bill flow: order linked to correct booking in admin
- [ ] Cancel order works when status is "placed"
- [ ] Cancel button hidden after order is confirmed

## References

- Admin order management: `plan/features/STORE-MANAGEMENT.md`
- Intercom chat integration: `plan/features/INTERCOM-GUEST.md`
- Store schema: `plan/docs/BACKEND.md §storeItems`, `plan/docs/BACKEND.md §storeOrders`
- Store settings: `plan/features/SETTINGS.md §Store`
- Storage upload: `plan/features/EMAIL-PDF-STORAGE.md`
