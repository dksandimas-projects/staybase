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

Public routes (voucher validation, corporate code validation, booking creation) do not require auth but may perform rate limiting.

---

## Route Surface

### Email Routes (`/api/email/*`)

| Route | Trigger | Recipient |
|---|---|---|
| `/api/email/booking-submitted` | Guest submits booking | Guest |
| `/api/email/payment-confirmed` | Staff confirms payment | Guest |
| `/api/email/booking-confirmed` | Booking fully confirmed | Guest |
| `/api/email/checkin-reminder` | 1 day before check-in | Guest |
| `/api/email/booking-cancelled` | Booking cancelled | Guest |
| `/api/email/corporate-inquiry` | New corporate inquiry submitted | Staff (admin email) |

All email routes use Resend. Templates are defined server-side. See `plan/features/EMAIL-PDF-STORAGE.md` for full email flow details.

---

### Booking Routes (`/api/bookings/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/bookings/create` | POST | None | Create booking with Firestore transaction (availability lock) |
| `/api/bookings/create-walkin` | POST | Staff | Create walk-in/manual booking with staff auth and the same Firestore transaction conflict checks |
| `/api/bookings/cancel` | POST | None (owner by ref+email) | Cancel booking if status allows |
| `/api/bookings/reject-discount` | POST | Staff | Reject Senior/PWD discount ID — restores `totalPrice`, sets rejection fields, triggers discount-rejected email |

Booking creation MUST use a Firestore transaction to prevent double-booking. Public online and corporate bookings use `/api/bookings/create`; staff walk-in/manual bookings use `/api/bookings/create-walkin`. Both routes must perform room active/blocked checks, overlapping booking checks, and booking reference generation inside the transaction. See `plan/features/AVAILABILITY-LOCKING.md`.

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

## Bot Prevention

All public-facing routes (booking creation, voucher/code validation) apply a two-layer bot check before any business logic runs. See `plan/docs/SECURITY.md §Bot & Spam Prevention` for full rationale.

### Cloudflare Turnstile Verification

1. Client submits a Turnstile token alongside the request body (`turnstileToken` field)
2. API route POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret` + `response` (the token)
3. Cloudflare returns `{ success: true/false }`
4. If `success: false` → return `400 { success: false, error: "Bot verification failed" }` immediately
5. Never proceed to business logic without a valid Turnstile response

**Applies to:** `/api/bookings/create`, `/api/validate/voucher`, `/api/validate/corporate-code`

### Honeypot Check

API route checks for a `_hp` field in the request body (the honeypot field name).
- If `_hp` has any value → silently return `200 { success: true }` (do not create booking, do not tip off bot)
- If `_hp` is empty or absent → proceed normally

**Applies to:** `/api/bookings/create`, corporate inquiry submission

### Rate Limiting

| Endpoint | Limit |
|---|---|
| `/api/bookings/create` | 5 requests / IP / minute |
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
