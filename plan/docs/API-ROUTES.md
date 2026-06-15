# API Routes — Vercel
> Requires: CLAUDE.md, docs/BACKEND.md

---

## Overview

All server-side logic lives in a single Vercel catch-all API route at `guest-app/api/[...route].ts`. The `api/` folder is co-located inside `guest-app/` — Vercel picks it up automatically when the root directory is set to `guest-app/`.

No Firebase Cloud Functions. No separate Vercel project for the API. No separate backend service.

---

## Pattern

All routes follow the path: `/api/[domain]/[action]`

The catch-all handler reads the path segments and dispatches to the appropriate handler function.

---

## Authentication

All admin/staff routes require a valid Firebase ID token in the request header:

```
Authorization: Bearer <firebaseIdToken>
```

The API route verifies the token server-side using the Firebase Admin SDK before processing any request. Never trust role claims from the client.

Public routes (voucher validation, corporate code validation, booking creation, corporate inquiry submission) do not require auth but may perform rate limiting.

Guest member routes require a valid Firebase ID token for the signed-in guest. They are authenticated but not staff-only.

---

## Route Surface

### Email Routes (`/api/email/*`)

| Route | Trigger | Recipient |
|---|---|---|
| `/api/email/booking-submitted` | Guest submits booking | Guest |
| `/api/email/payment-confirmed` | Staff payment brings running total to ≥ `totalPrice` (covers `pending` and `payment-uploaded`; idempotent if already `confirmed`) | Guest |
| `/api/email/booking-confirmed` | Staff confirms via `/api/bookings/confirm`, or walk-in creation resolves to `confirmed` (suppressed for `checked-in`) | Guest |
| `/api/email/checkin-reminder` | 1 day before check-in | Guest |
| `/api/email/booking-cancelled` | Booking cancelled | Guest |
| `/api/email/discount-rejected` | Staff rejects Senior/PWD discount ID | Guest |
| `/api/email/corporate-inquiry` | New corporate inquiry submitted | Staff (admin email) |
| `/api/email/early-checkin-request` | *(Phase 10B — planned)* Guest requests early check-in via Intercom | Staff (admin email) |

All email routes use Resend. Templates are defined server-side. See `plan/features/EMAIL-PDF-STORAGE.md` for full email flow details.

`/api/email/checkin-reminder` accepts staff-authenticated `POST` requests for manual sends and Vercel Cron `GET` requests for daily scheduled sends. Cron requests must use `Authorization: Bearer {CRON_SECRET}` and an empty body so the route sends reminders for all confirmed bookings checking in tomorrow.

---

### Booking Routes (`/api/bookings/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/bookings/create` | POST | None | Create booking with Firestore transaction (availability lock) |
| `/api/bookings/create-walkin` | POST | Staff | Create walk-in/manual booking with staff auth and the same Firestore transaction conflict checks |
| `/api/bookings/cancel` | POST | None (owner by ref+email) | Cancel booking if status allows |
| `/api/bookings/add-payment` | POST | Staff | Append onsite payment audit record to `bookings/{bookingId}/payments`; fires `payment-confirmed` email when running total reaches `totalPrice` |
| `/api/bookings/confirm` | POST | Staff | Flip `pending`/`payment-uploaded` → `confirmed`; fires `booking-confirmed` email |
| `/api/bookings/reject-discount` | POST | Staff | Reject Senior/PWD discount ID — restores `totalPrice`, sets rejection fields, triggers discount-rejected email |

Booking creation MUST use a Firestore transaction to prevent double-booking. Public online and corporate bookings use `/api/bookings/create`; staff walk-in/manual bookings use `/api/bookings/create-walkin`. Both routes must perform room active/blocked checks, overlapping booking checks, and booking reference generation inside the transaction. Public online and corporate clients preallocate the Firestore booking document ID before Storage uploads and pass that ID to `/api/bookings/create`; the API creates the document at that exact ID while generating only the guest-facing booking reference inside the transaction. See `plan/features/AVAILABILITY-LOCKING.md`.

Existing booking documents may still receive authenticated staff/admin operational updates directly from the admin app where Firestore rules allow it. Use booking API routes when the mutation creates a booking, appends audit/payment records, sends email, validates guest ownership, or changes money/member balances.

---

### Corporate Routes (`/api/corporate/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/corporate/inquiry` | POST | None | Submit the public corporate inquiry form; API verifies Turnstile, checks honeypot, creates `corporateInquiries/{id}` with `status: "new"`, and sends the staff notification email |

Guest-facing code must not create `corporateInquiries` directly with the Firestore client SDK. This route is the only public write path so bot checks and validation stay server-side.

---

### Validation Routes (`/api/validate/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/validate/voucher` | POST | None | Check voucher code: valid, expired, usage cap, room type |
| `/api/validate/corporate-code` | POST | None | Check corporate access code: valid, expired, usage cap, active |

Both routes return the discount/rate details on success. Never expose full voucher or code documents to the client.

---

### Store Routes (`/api/store/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/store/create-order` | POST | None | Create store order with server-side stock check, stock decrement, active booking lookup, and order ref generation |
| `/api/store/cancel-order` | POST | None (room + order ref match) | Cancel a placed store order from the guest intercom and restore reserved stock once |
| `/api/store/order-status` | POST | None (room + order ref match) | Return the latest guest-safe order status for the intercom tracker |

Store order creation MUST use a Firestore transaction to prevent overselling.
Store order cancellation MUST only allow `placed` orders and MUST use a transaction so stock restore is idempotent.
Store order status MUST return only guest-safe metadata (`status`, `updatedAt`) and never expose `paymentProofUrl`, internal notes, or full order records.

---

### Reference Routes (`/api/reference/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/reference/generate` | POST | Staff | Generate next booking reference number (SI-YYYYMMDD-NNN) |

---

### Admin Routes (`/api/admin/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/create-staff` | POST | Admin | Create a staff Firebase Auth user, set the `role` custom claim, and mirror the profile in `guests/{uid}` |
| `/api/admin/disable-staff` | POST | Admin | Disable a staff Firebase Auth user and mark `guests/{uid}.isActive` false; self-disable and last-active-admin disable are rejected |

Staff accounts must be created and disabled through these Admin SDK routes. Never expose staff registration in client code, and never let client-side writes set Firebase Auth custom claims.

---

### Member Routes (`/api/members/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/members/register` | POST | Signed-in guest | Enroll the authenticated guest in Spark Rewards, generate the sequential `memberNumber`, create or update `members/{uid}`, and link past bookings by email |
| `/api/members/redeem-points` | POST | Staff | Redeem member points against a booking; transactionally deducts member balance, lowers `booking.totalPrice`, stores redemption fields, and appends a `pointsHistory` entry |
| `/api/members/undo-redemption` | POST | Admin | Undo a points redemption while the booking is still `confirmed`; transactionally restores booking total, returns member points, clears redemption fields, and logs the reversal |

Member registration must be server-side because `memberNumber` is sequential and cannot be trusted to client code. Guest apps may update editable profile fields after enrollment where Firestore rules allow it, but they must not create member documents or assign `memberNumber` directly.
Points redemption routes are server-side because they change booking money fields and member balances together. Never update those documents independently from client code.

---

## Bot Prevention

All public-facing routes (booking creation, voucher/code validation) apply a two-layer bot check before any business logic runs. See `plan/docs/SECURITY.md §Bot & Spam Prevention` for full rationale.

### Cloudflare Turnstile Verification

1. Client submits a Turnstile token alongside the request body (`turnstileToken` field)
2. API route POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret` + `response` (the token)
3. Cloudflare returns `{ success: true/false }`
4. If `success: false` → return `400 { success: false, error: "Bot verification failed" }` immediately
5. Never proceed to business logic without a valid Turnstile response

**Applies to:** `/api/bookings/create`, `/api/corporate/inquiry`, `/api/validate/voucher`, `/api/validate/corporate-code`

### Honeypot Check

API route checks for a `_hp` field in the request body (the honeypot field name).
- If `_hp` has any value → silently return `200 { success: true }` (do not create booking, do not tip off bot)
- If `_hp` is empty or absent → proceed normally

**Applies to:** `/api/bookings/create`, `/api/corporate/inquiry`

### Rate Limiting

| Endpoint | Limit |
|---|---|
| `/api/bookings/create` | 5 requests / IP / minute |
| `/api/corporate/inquiry` | 5 requests / IP / minute |
| `/api/validate/voucher` | 20 requests / IP / minute |
| `/api/validate/corporate-code` | 10 requests / IP / minute |
| `/api/email/*` | 3 requests / booking ref / hour |

Use Vercel Edge middleware for IP-based rate limiting. Simple in-memory map is sufficient for Phase 1 at this traffic scale.

---

## Request / Response Shape

**Standard success response:**
```
{ success: true, data: { ... } }
```

**Standard error response:**
```
{ success: false, error: "Human-readable message" }
```

Always return appropriate HTTP status codes: `200`, `400`, `401`, `403`, `404`, `500`.

---

## Environment Variables

See `plan/docs/ENV-SETUP.md` for all required API environment variables including `RESEND_API_KEY` and Firebase Admin SDK credentials.
