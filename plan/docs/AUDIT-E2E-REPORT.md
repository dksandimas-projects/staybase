# E2E User Journey Audit Report
> Started: 2026-07-17 · Living document — updated after each role audit
> Scope: guest-app, admin-app, guest-app/server (API), shared — all 5 user roles
> Method: static code-path tracing (component → hook → API → Firestore write). Only verified findings reported; each carries a confidence tag.

## Status

| # | Role | Status |
|---|---|---|
| 1 | Guest | ✅ Complete (2026-07-17) |
| 2 | Corporate guest | ⬜ Pending |
| 3 | Front desk | ⬜ Pending |
| 4 | Admin (incl. reports data accuracy) | ⬜ Pending |
| 5 | Cross-cutting | ⬜ Pending |

---

## Executive Summary

The guest journey (browse → availability → 4-step booking with voucher → consent gate → email → `/my-booking` lookup → intercom → Spark Rewards) is structurally sound: booking creation runs entirely inside a Firestore Admin SDK transaction with per-candidate conflict reads, vouchers and corporate codes are validated server-side and re-validated inside the create transaction, consent is enforced both client-side and server-side, the lookup endpoint requires ref+email (or ref+token) and returns a strict field allowlist that excludes payment-proof URLs, and Spark Rewards registration is token-authenticated with server-generated member numbers. The years of prior audit hardening (BF-*, BI-*, W*, H*) clearly show. However, the audit found one HIGH input-validation gap: the top-level `guests` count on `/api/bookings/create` is never validated as a positive integer, letting an unauthenticated caller submit negative or non-numeric values that reduce `totalPrice` via a negative breakfast line or poison it to `NaN` — directly corrupting the revenue numbers the owner relies on. Three MEDs (uncapped stay length enabling inventory denial, the unimplemented receipt-PDF email attachment from Decision #82, and client-side-only intercom rate limiting) and one LOW round out the guest pass.

**Provisional verdict (1 of 5 roles audited): NO-GO until G-01 is fixed** — it is a <30-minute fix on an unauthenticated endpoint that can distort booking revenue data. Everything else found so far is shippable-with-known-issues.

---

## Findings

Severity order: CRITICAL → HIGH → MED → LOW. Confidence: HIGH = code path fully verified; MED = verified but impact depends on runtime config; LOW = plausible, not fully traceable statically.

### HIGH

**G-01 · Guest · `guest-app/server/handlers/bookings.ts:345,562,807` — top-level `guests` count is not validated; negative/non-numeric values manipulate `totalPrice`** *(Confidence: HIGH)*
`/api/bookings/create` Zod-validates only `guestDetails` (`bookings.ts:239-262`). The top-level `guests` field passes only a truthiness check (`:345`) and an upper-bound capacity check (`:562`). A request with `guests: -5` and `hasBreakfast: true` produces `breakfastTotal = rate × -5 × nights` (`:807`), a **negative** add-on that reduces the room subtotal — unauthenticated price manipulation (Turnstile is passable by a human). A non-numeric value (`guests: "abc"`) propagates `NaN` into `totalPrice`, which Firestore stores, and which then poisons any report that sums revenue. The stored `numGuests` also feeds the registration PDF and breakfast prep counts. Walk-in creation (`:1383`) has the same shape but is staff-authenticated (lower risk).
**Fix:** validate the whole create body with Zod — `guests: z.coerce.number().int().min(1)` (and same for the walk-in handler); reject non-finite computed totals as a backstop. **Effort:** <30 min.

### MED

**G-02 · Guest · `guest-app/server/handlers/bookings.ts:401-404` — no maximum stay length or advance-booking window; anonymous pending bookings occupy inventory** *(Confidence: HIGH)*
`numNights` has only a `>= 1` lower bound; check-in only needs to be today-or-later. Availability (`rooms.ts:15`) and the create transaction both treat `pending` bookings as room-occupying. An anonymous pay-at-hotel booking spanning years (or many long bookings at 5/IP/min) blocks room types until staff notice and cancel each one. **Fix:** cap `numNights` (e.g. 30) and the advance window (e.g. 365 days) server-side; mirror in the date picker. **Effort:** <30 min.

**G-03 · Guest · `guest-app/server/handlers/email.ts:1024-1030` — booking-confirmed email does not attach the receipt PDF required by Decision #82** *(Confidence: HIGH — absence verified: zero `attachments` usage in the server email pipeline)*
Decision #82 (DECISIONS-FEATURES.md) says the booking receipt PDF is "reused as email attachment in the `booking-confirmed` email template." `printBookingReceiptPDF` exists in `admin-app/src/pages/BookingsPage.tsx` (client-side jsPDF), but no email carries an attachment — guests never receive a PDF receipt, and there is no guest-side PDF generation on Step 4 or `/my-booking` either. The HTML email does contain the full breakdown, so the operational impact is limited. **Fix:** either implement a server-side PDF attachment (jsPDF runs in Node) or formally amend Decision #82 to "front-desk print only" and update BOOKING-FLOW/EMAIL-PDF-STORAGE. **Effort:** 0.5–2 days (implement) or 15 min (docs decision).

**G-04 · Guest · `guest-app/src/pages/IntercomPage.tsx:599-613` + `firebase/firestore.rules:213-219` — intercom message rate limit is client-side only** *(Confidence: HIGH)*
SECURITY.md §Intercom Abuse Mitigation specifies ~30 messages/room/10 min. The only enforcement is `canSendGuestMessage()` reading `localStorage` — trivially bypassed since Firestore rules allow unauthenticated `create` on `intercoms/{roomId}/messages` (key-allowlisted, but unlimited volume). A script can flood the staff inbox, which plays a notification sound per message. The verify-guest gate (last name + active booking) raises the bar for the chat UI but does not gate raw Firestore writes. **Fix:** route guest sends through a rate-limited API endpoint, or accept and document the residual risk (physical-QR + name-gate model already accepts openness). **Effort:** ~0.5 day.

### LOW

**G-05 · Guest · `guest-app/server/handlers/bookings.ts:1023,1041` — client-supplied `paymentProofUrl` / `discountIdPhotoUrl` stored without URL validation, rendered in admin** *(Confidence: HIGH on absence of validation; MED on impact)*
Both fields are arbitrary strings persisted verbatim and rendered in the admin drawer as an `<img src>` preview and an `<a href target="_blank">` link (`admin-app/src/pages/BookingsPage.tsx:3370,5012`). An attacker can point staff browsers at an external tracking/phishing URL. **Fix:** server-side allowlist — require the URLs to start with the project's Firebase Storage bucket prefix. **Effort:** <30 min.

---

## Verified-Good (Guest role)

- **Booking creation is fully transactional** — all reads (hotel config, candidate rooms, per-room overlap queries, blocks, voucher, corporate code, counter) happen via `transaction.get` inside `adminDb.runTransaction` (`bookings.ts:502-1117`); writes are deferred until after the read phase; the booking ref counter increments in the same transaction. No read-then-write path exists. Idempotent re-submit returns the existing booking (`:504-523`).
- **Vouchers validated server-side twice** — `/api/validate/voucher` (Turnstile + 20/min rate limit) for UX, then re-validated inside the create transaction with usage-count increment (`bookings.ts:828-908`) and decrement on cancel (`:2086-2092`).
- **Consent gate enforced in three places** — Step 2 continue gate (`BookingPage.tsx:468`), Step 3 confirm gate (`:1117`), and server-side rejection (`bookings.ts:369-371`).
- **`/my-booking` lookup is enumeration-safe** — requires bookingRef + email (or server-generated `lookupToken`), Turnstile-gated, 10/IP/min, and the response allowlist (`bookings.ts:3254-3278`) excludes `paymentProofUrl`, `discountIdPhotoUrl`, `lookupToken`, and staff notes.
- **Bot layers correct** — honeypot inside the form, hidden via `absolute opacity-0 pointer-events-none` (`BookingPage.tsx:1483-1491`), silent 200 on trip (router:414); Turnstile verified server-side with `NODE_ENV === "test"`-only bypass; rate limits on create (5/min), lookup (10/min), voucher (20/min), email (3/ref/hour).
- **Spark Rewards is server-authoritative** — registration requires a verified Firebase ID token; email is taken from the token, never the body; `memberNumber` generated in a counter transaction; past-booking linkage only where `guestEmail` matches the verified email (`members.ts:52-91,185-260`); member discount detected from the Authorization header, never the body (`bookings.ts:442-499,918-929`).
- **Room `remarks` cannot leak to guests** — staff notes live in the staff-only `roomPrivate` collection (`firestore.rules:26-29`); guest `useRooms` never maps them.
- **Availability endpoint is PII-stripped** — returns only `{roomId, checkIn, checkOut, status}` (`rooms.ts:93-131`), rate-limited 30/min.
- **Intercom listeners cleaned up** — every `onSnapshot` in `IntercomPage.tsx` returns its unsubscribe in effect cleanup (`:438,:490` etc.); guest access is gated by last-name verification against the active booking (`/api/intercom/verify-guest`, 20/min).

---

## Quick Wins (<30 min each)

1. **G-01** — Zod-validate the full `/api/bookings/create` body (`guests` int ≥ 1); add a `Number.isFinite(totalPrice)` backstop before the doc write.
2. **G-02** — cap `numNights` and advance-booking window server-side.
3. **G-05** — prefix-allowlist `paymentProofUrl` / `discountIdPhotoUrl` against the Firebase Storage bucket URL.

---

## Go / No-Go

**Provisional: NO-GO** pending the G-01 fix (unauthenticated revenue-data corruption vector, trivial to fix). After G-01 (and ideally G-02/G-05, both quick wins), the guest journey is **GO**. Verdict will be revised as roles 2–5 complete.

---

## Docs Updated

- `plan/features/BOOKING-FLOW.md` — added `## Known Issues (Audit 2026-07-17)` (G-01, G-02)
- `plan/docs/GOTCHAS.md` — appended never-do rule on validating full API body, not just nested objects
- `plan/project/ROADMAP.md` — appended dated section "E2E User Journey Audit (2026-07-17)" with CRITICAL/HIGH tasks
