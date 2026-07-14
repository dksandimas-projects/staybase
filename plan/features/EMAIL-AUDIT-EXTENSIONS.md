# Email Audit Extensions (Wave 4 #4)
> Requires: `plan/features/EMAIL-PDF-STORAGE.md`, `plan/docs/DECISIONS-FEATURES.md #104`
> Audit reference: `plan/project/AUDIT-E2E-2026-06-15.md` §1.7 open question W4.4

Extends the transactional email system with 7 new templates, raising the total from 8 to 15. Closes the "guest misses order update after closing the intercom tab" gap and the "staff miss new booking when logged out" gap.

> **Status: Completed and implemented in Phase 11.6 Batch 10.**

---

## Context

The current `EmailAction` union in `guest-app/api/handlers/email.ts` has 8 templates — all of which are spec'd in `EMAIL-PDF-STORAGE.md §Email Flows`. The audit found 7 additional events where email would be useful, even though the spec is silent on them:

| Gap | What's missing | Impact |
|---|---|---|
| Voucher issued | Guest gets no email when admin creates a voucher for them | Guest never knows about a voucher unless they happen to enter the code at booking |
| Store order status | Guest gets an intercom message but no email | Guest who closes the intercom tab loses the tracker |
| Staff notifications | Staff only sees updates when logged into the admin | Mobile / after-hours staff miss new bookings |

The audit's W4.4 default was "not in scope" but DK chose **Option C (add all 7)** as a feature add. Each template is small and follows the existing pattern; combined effort is **M (2-3 days)**.

---

## New email templates (7)

### 1. `voucher-issued`

| Field | Value |
|---|---|
| Trigger | `addVoucher` in `RatesPage` when a voucher is created with a non-empty `guestEmail` field (or when admin clicks "Email to guest" on an existing voucher) |
| Recipient | Guest (`voucher.guestEmail`) |
| Subject | `[${config.brandName}] Your voucher: ${voucher.code}` |
| Body essentials | Voucher code (large, monospace), type (% or flat), value, expiry date, applicable room types, min nights (if any), terms link, CTA to start booking with the code pre-filled |
| Reply-to | `config.supportEmail` |
| Audit-trigger | `vouchers/{code}.issuedAt: Timestamp` + `vouchers/{code}.issuedToUid: string` (if member is signed in at issue time) |

**Schema addition** (`shared/types/index.ts §Voucher`):
```ts
interface Voucher {
  // existing fields...
  guestEmail: string | null;        // set when issued to a specific guest
  issuedAt: Timestamp | null;
  issuedToUid: string | null;       // member uid if signed in at issue time
}
```

### 2. `store-order-placed`

| Field | Value |
|---|---|
| Trigger | `handleCreateStoreOrder` in `guest-app/api/handlers/store.ts` after the transaction commits |
| Recipient | Guest (lookup `bookingId → bookings/{id}.guestEmail`) |
| Subject | `[${config.brandName}] Order placed: ${order.orderRef}` |
| Body essentials | Order ref, items table (name, qty, unit price, line total), grand total, payment method chosen, expected prep time ("we'll bring it to your room in ~15 min"), link to intercom chat (deep link to Shop tab) |
| Reply-to | `config.supportEmail` |

### 3. `store-order-confirmed`

| Field | Value |
|---|---|
| Trigger | `handleConfirmStoreOrder` (the new handler per `DECISIONS-FEATURES.md #80`) when stock is decremented |
| Recipient | Guest |
| Subject | `[${config.brandName}] Order confirmed: ${order.orderRef}` |
| Body essentials | "Your order is confirmed and being prepared", items recap, ETA, link to chat |

### 4. `store-order-out-for-delivery`

| Field | Value |
|---|---|
| Trigger | `updateStoreOrderStatus` when status flips to `out-for-delivery` |
| Recipient | Guest |
| Subject | `[${config.brandName}] Order on its way: ${order.orderRef}` |
| Body essentials | "Your order is on its way to your room", items recap, link to chat |

### 5. `store-order-delivered`

| Field | Value |
|---|---|
| Trigger | `updateStoreOrderStatus` when status flips to `delivered` |
| Recipient | Guest |
| Subject | `[${config.brandName}] Order delivered: ${order.orderRef}` |
| Body essentials | "Your order has been delivered. Enjoy!", items recap, feedback link (Phase 2 — place a placeholder link to `/contact`) |

### 6. `store-order-cancelled`

| Field | Value |
|---|---|
| Trigger | `handleCancelStoreOrder` (guest-initiated) OR `updateStoreOrderStatus` when admin cancels |
| Recipient | Guest |
| Subject | `[${config.brandName}] Order cancelled: ${order.orderRef}` |
| Body essentials | "Your order has been cancelled", items recap, reason (if provided), refund note ("if you paid via GCash, the staff will reach out within 24 hours to coordinate a refund") |
| Conditional | If payment was `add-to-bill` and order is `delivered` already → "this order was already on your bill; no refund needed" |

### 7. `staff-new-booking`

| Field | Value |
|---|---|
| Trigger | `handleCreateBooking` (not walk-in) after the transaction commits |
| Recipient | `settings/hotelConfig.staffEmail` (default: `config.supportEmail` if not set) |
| Subject | `[${config.brandName}] New online booking: ${booking.bookingRef}` |
| Body essentials | Guest name, email, phone, room, dates, nights, total, payment method, source, "view in admin" deep link to `/bookings?ref={bookingRef}` |
| Rate-limit | None (server-triggered, not user-triggered) |

**Schema addition** (`settings/hotelConfig`):
```ts
{
  staffEmail: string;  // existing field, already in settings; this email confirms usage
  // (no new fields needed)
}
```

### 8. `staff-new-payment`

| Field | Value |
|---|---|
| Trigger | `handleAddPayment` in `guest-app/api/handlers/bookings.ts` (only when `paymentMethod === "gcash" | "bank"` and `paymentProofUrl` is set) |
| Recipient | `settings/hotelConfig.staffEmail` |
| Subject | `[${config.brandName}] New payment proof: ${booking.bookingRef}` |
| Body essentials | Booking ref, guest, amount, payment method, screenshot URL (signed link), "review payment" deep link to `/bookings?ref={bookingRef}` |

---

## Updated `EmailAction` union

```ts
type EmailAction =
  // existing 8
  | "booking-submitted"
  | "payment-confirmed"
  | "booking-confirmed"
  | "checkin-reminder"
  | "booking-cancelled"
  | "corporate-inquiry"
  | "discount-rejected"
  | "early-checkin-request"
  // new 7 (Phase 1.5)
  | "voucher-issued"
  | "store-order-placed"
  | "store-order-confirmed"
  | "store-order-out-for-delivery"
  | "store-order-delivered"
  | "store-order-cancelled"
  | "staff-new-booking"
  | "staff-new-payment";
```

Total: **15 templates**.

---

## Schema additions

```ts
// shared/types/index.ts §Voucher
interface Voucher {
  // existing fields...
  guestEmail: string | null;        // set when issued to a specific guest
  issuedAt: Timestamp | null;
  issuedToUid: string | null;
}

// shared/types/index.ts §StoreOrder
interface StoreOrder {
  // existing fields...
  emailNotificationsSent: {
    placed: Timestamp | null;
    confirmed: Timestamp | null;
    outForDelivery: Timestamp | null;
    delivered: Timestamp | null;
    cancelled: Timestamp | null;
  };
  // Per W2.10 decision — calls/{roomId} retention deletes after 30s;
  // same pattern: status changes fire the email once and the timestamp
  // is recorded. Re-sends via /api/email/{action} check the timestamp
  // to avoid duplicates if a staff member double-clicks "Confirm".
}

// shared/types/index.ts §Booking
interface Booking {
  // existing fields...
  emailNotificationsSent: {
    staffNewBooking: Timestamp | null;
    staffNewPayment: Timestamp | null;
  };
}
```

The per-record timestamp fields prevent duplicate emails on status churn (e.g. admin flips `placed → cancelled → placed` in quick succession — the second `placed` email is suppressed if the first one was sent < 5 min ago).

---

## Bot / spam prevention

- **All 7 templates are server-triggered.** No public form posts to these endpoints. No honeypot / Turnstile needed.
- **Rate limiting**: not applicable (no user-driven path).
- **Recipient verification**: for guest emails, the recipient is looked up server-side from the booking (`booking.guestEmail`). The client cannot specify the recipient. For staff emails, the recipient is from `settings/hotelConfig.staffEmail` — server-controlled.
- **Idempotency**: the `emailNotificationsSent` per-record timestamp fields prevent duplicate sends.

---

## Build plan (Phase 1.5)

1. **`guest-app/api/handlers/email.ts`** — add 7 new template functions (`voucherIssuedEmail`, `storeOrderPlacedEmail`, etc.) + 7 new trigger exports + 7 new entries in `EmailAction` dispatch table
2. **`shared/types/index.ts`** — add `guestEmail/issuedAt/issuedToUid` to `Voucher`; add `emailNotificationsSent` to `StoreOrder` and `Booking`
3. **`guest-app/api/handlers/vouchers.ts`** — when `addVoucher` is called with a `guestEmail`, fire `voucher-issued` after the write
4. **`guest-app/api/handlers/store.ts`** — fire the right `store-order-*` email after each status transition in the transaction
5. **`guest-app/api/handlers/bookings.ts`** — fire `staff-new-booking` after `handleCreateBooking`; fire `staff-new-payment` after `handleAddPayment` when `paymentProofUrl` is set
6. **`firebase/firestore.rules`** — no changes needed (templates are server-only)
7. **`guest-app/api/__tests__/email-extensions.test.ts`** *(new)* — 12-14 tests:
   - Voucher issued with guestEmail → email sent with code + value
   - Voucher issued without guestEmail → no email sent
   - Store order placed → email sent
   - Store order status change → correct email sent
   - Duplicate trigger (e.g. status flip-flop within 5 min) → second email suppressed
   - Staff-new-booking → email to staffEmail with ref + deep link
   - Staff-new-payment → email only when paymentProofUrl is set
   - Recipient is server-controlled, not client-supplied
8. **Doc updates**:
   - `EMAIL-PDF-STORAGE.md` §Email Flows — add the 7 rows to the table
   - `plan/project/AUDIT-E2E-2026-06-15.md` — annotate W4.4 as resolved with build commit hash
   - `DECISIONS-FEATURES.md #104` — already added; cite the build commit

---

## Effort estimate

- **M (2-3 days)**:
  - 7 templates × ~30 min each = 3-4 hours
  - 7 trigger wiring points × ~30 min each = 3-4 hours
  - Schema additions + migration = 1-2 hours
  - 12-14 tests = 4-6 hours
  - Doc updates = 1 hour
  - Code review, refactor, edge cases = 2-3 hours

## Dependencies

- **W2.10 (calls/{roomId} retention)** — independent, can ship separately
- **W1.4 (RA 10173 erasure)** — voucher-issued emails reference member uid; if member is later erased, the email has already been sent (no PII retention concern; emails are deliverable artifacts)
- **W1.13 (dev PII removal)** — staff-new-booking and staff-new-payment recipients are server-controlled; no client-supplied recipient; no PII concern
- **DECISIONS-FEATURES.md #80 (store stock on confirmed)** — store-order-confirmed email is the user-facing notification for that transition; ships together

## Reference

- Existing template pattern: `guest-app/api/handlers/email.ts:256-385`
- Existing trigger pattern: `guest-app/api/handlers/email.ts:448-478`
- Spec for current 7 emails: `EMAIL-PDF-STORAGE.md §Email Flows`
- Decision row: `DECISIONS-FEATURES.md #104`
- W4.4 in triage doc: `AUDIT-OPEN-QUESTIONS-2026-06-15.md`

## Manual QA (for the build)

- [x] Create a voucher with a `guestEmail` → email arrives at that address with the code in large monospace
- [x] Create a voucher without `guestEmail` → no email sent (only visible in the admin)
- [x] Place a store order → `store-order-placed` email arrives within 30s
- [x] Flip status `placed → cancelled` within 5 min of order → only `placed` email; cancellation email not sent (or vice versa, per implementation)
- [x] Flip status `placed → out-for-delivery` → `store-order-out-for-delivery` email arrives
- [x] Create an online booking → `staff-new-booking` email arrives at `staffEmail` within 30s
- [x] Upload a payment proof → `staff-new-payment` email arrives
- [x] Trigger the same event twice (e.g. re-call the API) → second send suppressed by `emailNotificationsSent` timestamp
