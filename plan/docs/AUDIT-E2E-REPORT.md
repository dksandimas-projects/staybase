# E2E User Journey Audit Report
> Started: 2026-07-17 · Living document — updated after each role audit
> Scope: guest-app, admin-app, guest-app/server (API), shared — all 5 user roles
> Method: static code-path tracing (component → hook → API → Firestore write). Only verified findings reported; each carries a confidence tag.

## Status

| # | Role | Status |
|---|---|---|
| 1 | Guest | ✅ Complete (2026-07-17) |
| 2 | Corporate guest | ✅ Complete (2026-07-17) |
| 3 | Front desk | ⬜ Pending |
| 4 | Admin (incl. reports data accuracy) | ⬜ Pending |
| 5 | Cross-cutting | ⬜ Pending |

---

## Executive Summary

The guest journey (browse → availability → 4-step booking with voucher → consent gate → email → `/my-booking` lookup → intercom → Spark Rewards) is structurally sound: booking creation runs entirely inside a Firestore Admin SDK transaction with per-candidate conflict reads, vouchers and corporate codes are validated server-side and re-validated inside the create transaction, consent is enforced both client-side and server-side, the lookup endpoint requires ref+email (or ref+token) and returns a strict field allowlist that excludes payment-proof URLs, and Spark Rewards registration is token-authenticated with server-generated member numbers. The years of prior audit hardening (BF-*, BI-*, W*, H*) clearly show. However, the audit found one HIGH input-validation gap: the top-level `guests` count on `/api/bookings/create` is never validated as a positive integer, letting an unauthenticated caller submit negative or non-numeric values that reduce `totalPrice` via a negative breakfast line or poison it to `NaN` — directly corrupting the revenue numbers the owner relies on. Three MEDs (uncapped stay length enabling inventory denial, the unimplemented receipt-PDF email attachment from Decision #82, and client-side-only intercom rate limiting) and one LOW round out the guest pass.

The corporate journey (role 2) confirmed the public `/corporate/book` path is server-authoritative end-to-end — dual live Turnstile gates, code validation returning only the rate map, in-transaction re-validation with usage-count increments, a powerless flat-rate intent flag, and vouchers correctly blocked. The staff-side **convert-inquiry** path is the weak link: it still reads `pricePerNight` / `corporateRate` / `maxCapacity` off room documents, but those fields moved to the RoomType entry in W3.6/W3.7 — so a conversion without a manual rate override or attached access-code rate creates a **confirmed booking at ₱0/night** and its capacity check is dead code (C-01, HIGH). Its blocked-room check also parses the free-text `preferredDates` string instead of the requested dates (C-02, MED), and the inquiry pipeline UI shows blank dates for every guest-submitted inquiry due to a string-vs-struct schema drift (C-03, MED).

**Provisional verdict (2 of 5 roles audited): NO-GO until G-01 and C-01 are fixed** — both are small fixes that prevent revenue-data corruption (unauthenticated `NaN`/discounted totals; staff-triggered ₱0 confirmed bookings). Everything else found so far is shippable-with-known-issues.

---

## Findings

Severity order: CRITICAL → HIGH → MED → LOW. Confidence: HIGH = code path fully verified; MED = verified but impact depends on runtime config; LOW = plausible, not fully traceable statically.

### HIGH

**G-01 · Guest · `guest-app/server/handlers/bookings.ts:345,562,807` — top-level `guests` count is not validated; negative/non-numeric values manipulate `totalPrice`** *(Confidence: HIGH)*
`/api/bookings/create` Zod-validates only `guestDetails` (`bookings.ts:239-262`). The top-level `guests` field passes only a truthiness check (`:345`) and an upper-bound capacity check (`:562`). A request with `guests: -5` and `hasBreakfast: true` produces `breakfastTotal = rate × -5 × nights` (`:807`), a **negative** add-on that reduces the room subtotal — unauthenticated price manipulation (Turnstile is passable by a human). A non-numeric value (`guests: "abc"`) propagates `NaN` into `totalPrice`, which Firestore stores, and which then poisons any report that sums revenue. The stored `numGuests` also feeds the registration PDF and breakfast prep counts. Walk-in creation (`:1383`) has the same shape but is staff-authenticated (lower risk).
**Fix:** validate the whole create body with Zod — `guests: z.coerce.number().int().min(1)` (and same for the walk-in handler); reject non-finite computed totals as a backstop. **Effort:** <30 min.

**C-01 · Corporate · `guest-app/server/handlers/corporate-inquiries.ts:183,217,229,253-257` — convert-inquiry prices bookings from dead room-document fields; ₱0 confirmed bookings and a dead capacity check** *(Confidence: HIGH)*
`handleConvertInquiryToBooking` resolves the nightly rate as `roomData.pricePerNight` with fallbacks to `roomData.corporateRate`, and checks `guests > roomData.maxCapacity`. All three fields were **moved off room documents onto the RoomType entry** in W3.6/W3.7 (`shared/types/index.ts:96-105`), so on any room created since (including the clean-slate production DB per Decision #119) they are `undefined`. Result: converting an inquiry with no attached access-code rate map and no manually typed rate override (the admin modal defaults the override to empty — `CorporateInquiriesPage.tsx:171,199-201`) creates a **`confirmed` booking with `ratePerNight: 0` and `totalPrice: 0`** (plus breakfast if selected), which flows straight into revenue reports; and the capacity guard never fires (`guests > undefined` is `false`). The public corporate create path is unaffected (it correctly reads the type entry — `bookings.ts:551-559`).
**Fix:** inside the conversion transaction, resolve the type entry from `settings/hotelConfig.roomTypes[]` (same pattern as `handleCreateBooking`) for capacity, base rate, and corporate rate; reject a resolved rate of 0 without an explicit override. **Effort:** 1–2 h.

### MED

**C-02 · Corporate · `guest-app/server/handlers/corporate-inquiries.ts:171-182` — convert-inquiry blocked-room check parses free-text `preferredDates` instead of the requested dates; `roomBlocks` never checked** *(Confidence: HIGH)*
Inside the block-window check, local `checkInDate`/`checkOutDate` consts **shadow** the function's parsed dates and are built from `inquiryData.preferredDates.split(" to ")` — a free-text string ("flexible, mid-August…"). Unparseable text yields `NaN` comparisons, `windowActive` evaluates `false`, and a blocked room with a defined window converts into a confirmed booking inside its block. The path also skips the `roomBlocks` collection check that `handleCreateBooking` runs (`hasActiveRoomBlockConflict`). Partially mitigated by the admin room picker filtering `status === "blocked"` rooms — but that snapshot can be stale. **Fix:** delete the shadowed re-parse (use the function's `checkInDate`/`checkOutDate`) and add the shared `roomBlocks` conflict check. **Effort:** <30 min.

**C-03 · Corporate · guest/admin `preferredDates` schema drift — pipeline shows blank dates for every guest inquiry** *(Confidence: HIGH)*
The guest inquiry form submits `preferredDates` as a free-text string (`CorporateStaysPage.tsx:73,257`; server schema `corporate-inquiries.ts:14` agrees). The admin app types it as `{ from, to }` (`AdminContext.tsx:292,1889`) and renders `preferredDates.from / .to` in the pipeline table, drawer, and convert-modal prefill (`CorporateInquiriesPage.tsx:166-167,241,409`) — all `undefined` on a string, so staff see "N rooms ( to )" and empty prefills for every real inquiry. The server's C-02 check assumes the string shape, deepening the split. **Fix:** pick one shape (structured `{from,to}` via two date inputs on the guest form is cleanest), normalize at read time for legacy docs. **Effort:** ~2 h.

**G-02 · Guest · `guest-app/server/handlers/bookings.ts:401-404` — no maximum stay length or advance-booking window; anonymous pending bookings occupy inventory** *(Confidence: HIGH)*
`numNights` has only a `>= 1` lower bound; check-in only needs to be today-or-later. Availability (`rooms.ts:15`) and the create transaction both treat `pending` bookings as room-occupying. An anonymous pay-at-hotel booking spanning years (or many long bookings at 5/IP/min) blocks room types until staff notice and cancel each one. **Fix:** cap `numNights` (e.g. 30) and the advance window (e.g. 365 days) server-side; mirror in the date picker. **Effort:** <30 min.

**G-03 · Guest · `guest-app/server/handlers/email.ts:1024-1030` — booking-confirmed email does not attach the receipt PDF required by Decision #82** *(Confidence: HIGH — absence verified: zero `attachments` usage in the server email pipeline)*
Decision #82 (DECISIONS-FEATURES.md) says the booking receipt PDF is "reused as email attachment in the `booking-confirmed` email template." `printBookingReceiptPDF` exists in `admin-app/src/pages/BookingsPage.tsx` (client-side jsPDF), but no email carries an attachment — guests never receive a PDF receipt, and there is no guest-side PDF generation on Step 4 or `/my-booking` either. The HTML email does contain the full breakdown, so the operational impact is limited. **Fix:** either implement a server-side PDF attachment (jsPDF runs in Node) or formally amend Decision #82 to "front-desk print only" and update BOOKING-FLOW/EMAIL-PDF-STORAGE. **Effort:** 0.5–2 days (implement) or 15 min (docs decision).

**G-04 · Guest · `guest-app/src/pages/IntercomPage.tsx:599-613` + `firebase/firestore.rules:213-219` — intercom message rate limit is client-side only** *(Confidence: HIGH)*
SECURITY.md §Intercom Abuse Mitigation specifies ~30 messages/room/10 min. The only enforcement is `canSendGuestMessage()` reading `localStorage` — trivially bypassed since Firestore rules allow unauthenticated `create` on `intercoms/{roomId}/messages` (key-allowlisted, but unlimited volume). A script can flood the staff inbox, which plays a notification sound per message. The verify-guest gate (last name + active booking) raises the bar for the chat UI but does not gate raw Firestore writes. **Fix:** route guest sends through a rate-limited API endpoint, or accept and document the residual risk (physical-QR + name-gate model already accepts openness). **Effort:** ~0.5 day.

### LOW

**C-04 · Corporate · `guest-app/src/pages/CorporateBookingPage.tsx:701` — honeypot layer is decorative on `/corporate/book`** *(Confidence: HIGH)*
The create payload hardcodes `_hp: ""` and the page renders no hidden honeypot input (the "Terms and honeypot" block at `:1653` contains only the consent checkbox and Turnstile). Bots on this route are never honeypot-caught; Turnstile + 5/min rate limit still apply. **Fix:** render the same CSS-hidden input as `BookingPage.tsx:1483-1491` and bind it. **Effort:** <30 min.

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

## Verified-Good (Corporate role)

- **Public corporate create path is server-authoritative** — the `corporateFlatRate` flag carries no pricing power (rate resolved from the server's type entry, `bookings.ts:770-775`); a validated code always wins; failed in-transaction re-validation aborts with a clear 409 instead of a silent downgrade (BI-10); `usageCount` increments in the create transaction and decrements on cancel; vouchers zeroed on corporate bookings (Decision #100).
- **`/api/validate/corporate-code`** returns only `code`, `companyName`, `ratePerRoomType` (`corporate-codes.ts:102-109`), Turnstile-gated, 10/IP/min; `corporateCodes` collection reads are staff-only in Firestore rules (BI-08).
- **Both corporate steps run live Turnstile widgets** via `useTurnstileToken` with per-step `enabled` gates (`CorporateBookingPage.tsx:90-91`) — no decorative "verified" panel.
- **Consent enforced** with Privacy/Terms links at Step 2 (`:1398-1419`) plus the server-side consent check shared with the standard flow.
- **Conversion is atomic** — `linkedInquiryId` on the booking and `convertedBookingId` + status flip on the inquiry are written in the same transaction (`corporate-inquiries.ts:365,399-405`), booking lands as `source: "corporate"` (Decision #103); double-conversion rejected.
- **Public inquiry endpoint** (`/api/corporate/inquiry`) has strict Zod, silent-success honeypot, Turnstile, and 5/IP/min rate limit (router:775-794).

---

## Quick Wins (<30 min each)

1. **G-01** — Zod-validate the full `/api/bookings/create` body (`guests` int ≥ 1); add a `Number.isFinite(totalPrice)` backstop before the doc write.
2. **G-02** — cap `numNights` and advance-booking window server-side.
3. **G-05** — prefix-allowlist `paymentProofUrl` / `discountIdPhotoUrl` against the Firebase Storage bucket URL.
4. **C-02** — remove the shadowed `preferredDates` re-parse in the convert-inquiry block check; use the requested dates and add the `roomBlocks` conflict check.
5. **C-04** — render + bind a real honeypot input on `/corporate/book`.

---

## Go / No-Go

**Provisional: NO-GO** pending **G-01** (unauthenticated revenue-data corruption, <30 min fix) and **C-01** (staff-triggered ₱0 confirmed bookings, 1–2 h fix). After those two, the guest and corporate journeys are **GO** (C-02/C-03 recommended before staff onboarding). Verdict will be revised as roles 3–5 complete.

---

## Docs Updated

- `plan/features/BOOKING-FLOW.md` — added `## Known Issues (Audit 2026-07-17)` (G-01, G-02)
- `plan/features/CORPORATE-INQUIRIES.md` — added `## Known Issues (Audit 2026-07-17)` (C-01, C-02, C-03)
- `plan/docs/GOTCHAS.md` — appended never-do rules: validate full API body (G-01); never read pricing/capacity fields off room documents (C-01)
- `plan/project/ROADMAP.md` — appended dated section "E2E User Journey Audit (2026-07-17)" with CRITICAL/HIGH tasks per role
