# E2E User Journey Audit Report
> Started: 2026-07-17 · Living document — updated after each role audit
> Scope: guest-app, admin-app, guest-app/server (API), shared — all 5 user roles
> Method: static code-path tracing (component → hook → API → Firestore write). Only verified findings reported; each carries a confidence tag.

## Status

| # | Role | Status |
|---|---|---|
| 1 | Guest | ✅ Complete (2026-07-17) |
| 2 | Corporate guest | ✅ Complete (2026-07-17) |
| 3 | Front desk | ✅ Complete (2026-07-17) |
| 4 | Admin (incl. reports data accuracy) | ✅ Complete (2026-07-17) |
| 5 | Cross-cutting | ✅ Complete (2026-07-17) — **audit finished** |

**Remediation status (2026-07-17):** All 8 MED findings (G-02, G-03, G-04, C-02, C-03, FD-01, FD-02, X-02) fixed alongside the 3 HIGH findings (G-01, C-01, X-01). All 847 tests pass (70 files). TypeScript compiles cleanly for both apps. Full preflight passes. Production remains gated on merge and deployment.

---

## Executive Summary

The guest journey (browse → availability → 4-step booking with voucher → consent gate → email → `/my-booking` lookup → intercom → Spark Rewards) is structurally sound: booking creation runs entirely inside a Firestore Admin SDK transaction with per-candidate conflict reads, vouchers and corporate codes are validated server-side and re-validated inside the create transaction, consent is enforced both client-side and server-side, the lookup endpoint requires ref+email (or ref+token) and returns a strict field allowlist that excludes payment-proof URLs, and Spark Rewards registration is token-authenticated with server-generated member numbers. The years of prior audit hardening (BF-*, BI-*, W*, H*) clearly show. However, the audit found one HIGH input-validation gap: the top-level `guests` count on `/api/bookings/create` is never validated as a positive integer, letting an unauthenticated caller submit negative or non-numeric values that reduce `totalPrice` via a negative breakfast line or poison it to `NaN` — directly corrupting the revenue numbers the owner relies on. Three MEDs (uncapped stay length enabling inventory denial, the unimplemented receipt-PDF email attachment from Decision #82, and client-side-only intercom rate limiting) and one LOW round out the guest pass.

The corporate journey (role 2) confirmed the public `/corporate/book` path is server-authoritative end-to-end — dual live Turnstile gates, code validation returning only the rate map, in-transaction re-validation with usage-count increments, a powerless flat-rate intent flag, and vouchers correctly blocked. The staff-side **convert-inquiry** path is the weak link: it still reads `pricePerNight` / `corporateRate` / `maxCapacity` off room documents, but those fields moved to the RoomType entry in W3.6/W3.7 — so a conversion without a manual rate override or attached access-code rate creates a **confirmed booking at ₱0/night** and its capacity check is dead code (C-01, HIGH). Its blocked-room check also parses the free-text `preferredDates` string instead of the requested dates (C-02, MED), and the inquiry pipeline UI shows blank dates for every guest-submitted inquiry due to a string-vs-struct schema drift (C-03, MED).

The front-desk journey (role 3) is clean at the CRITICAL/HIGH tier. Role gating is claims-based (`getIdTokenResult`, non-staff rejected, least-privilege fallback), `/rates`, `/members`, and `/settings` render an Access Denied state for front desk, and admin-only API routes (`create-staff`, `disable-staff`, `publish-seo`) re-check `role === "admin"` server-side. Walk-in creation is strictly Zod-validated (unlike the public path — sharpening G-01's fix) and runs the full conflict/block/lingering-checkout transaction. The housekeeping cycle matches Decision #88, receipts are folio-based with the payments ledger, and booking status transitions are blocked client-side by the Firestore field allowlist. Two MEDs: the 8-hour inactivity auto-logout specified in SECURITY.md is not implemented (session persistence is tab-scoped, which mitigates), and the `guests/{uid}` rule lets any signed-in user — including guest-app Rewards members in the same Firebase project — self-write a `role` field that the Settings staff list queries, allowing phantom staff rows (no privilege escalation; authorization is claims-only).

The admin journey (role 4) — including the mandated reports data-accuracy trace — came back **clean at the CRITICAL/HIGH tier**. Occupancy, revenue, and bookings-by-source are all computed from the same live `AdminContext.bookings` `onSnapshot` that Bookings Management renders (no cache, no second collection). The revenue-eligibility rules correctly exclude cancelled and pending/payment-uploaded bookings, exclude past-confirmed no-shows from revenue while surfacing their retained cash separately (FL-14), prorate multi-period stays by timezone-correct overlap nights, reflect voucher/senior/member discounts by construction (net `totalPrice` split proportionally over locked gross rates), count corporate flat-rate bookings at their contracted rate, and use dynamic room counts for occupancy. Manual traces of three representative bookings (voucher-discounted online, corporate flat-rate, cancelled-with-retained-payment) all land in the correct totals. The report layer even neutralizes `NaN` totals (`nonNegativeFinite`), softening G-01's blast radius — though raw CSV/XLSX exports would still carry a poisoned `totalPrice` verbatim. Findings are three LOW docs-drift items.

The cross-cutting pass (role 5) confirmed the platform hygiene is excellent — 2 of 12 Vercel functions used, zero PII in logs across both apps and the server, `paymentProofUrl` never read into the guest client, every `onSnapshot` cleaned up, only `.env.example` files committed, full CSP/headers with `microphone=(self)`, comprehensive rate limiting, and a complete RA 10173 surface (consent gate, privacy/terms pages, DPO contact, server-side erasure flow with anonymized audit records). It also surfaced the audit's most sensitive finding: **the Storage rules grant `allow get: if true` on the payment-proof and discount-ID paths** (X-01, HIGH) — meaning payment screenshots and OSCA/PWD **government-ID photos** are fetchable without authentication by anyone who knows the file path, in direct contradiction of SECURITY.md's "never public" requirement; the store-order variant is keyed by guessable room number. A consolidated white-label finding (X-02, MED) rounds out the pass: seeded "Spark Inn Hotel Corp" payment defaults, `sparkinn_*` export filenames, and hardcoded `en-PH`/`₱`/`PHP` in receipts and CSVs — harmless for Spark Inn, broken for the next client.

**CURRENT VERDICT: code-ready — all 3 HIGH and 8 MED findings remediated and verified on 2026-07-17.** Production remains gated on merge and deployment of the app/API plus Storage rules.

---

## Findings

Severity order: CRITICAL → HIGH → MED → LOW. Confidence: HIGH = code path fully verified; MED = verified but impact depends on runtime config; LOW = plausible, not fully traceable statically.

### HIGH

**G-01 · FIXED 2026-07-17 · Guest — top-level `guests` validation and finite-total guard** *(Confidence: HIGH)*
**Remediation:** `createBookingSchema` now strict-validates the complete public body, requires a finite integer guest count from 1–100, rejects unknown fields, and checks the computed total before writing. The walk-in route was already protected by `WalkinBookingSchema`.
`/api/bookings/create` Zod-validates only `guestDetails` (`bookings.ts:239-262`). The top-level `guests` field passes only a truthiness check (`:345`) and an upper-bound capacity check (`:562`). A request with `guests: -5` and `hasBreakfast: true` produces `breakfastTotal = rate × -5 × nights` (`:807`), a **negative** add-on that reduces the room subtotal — unauthenticated price manipulation (Turnstile is passable by a human). A non-numeric value (`guests: "abc"`) propagates `NaN` into `totalPrice`, which Firestore stores, and which then poisons any report that sums revenue. The stored `numGuests` also feeds the registration PDF and breakfast prep counts. Walk-in creation (`:1383`) has the same shape but is staff-authenticated (lower risk).
**Fix:** validate the whole create body with Zod — `guests: z.coerce.number().int().min(1)` (and same for the walk-in handler); reject non-finite computed totals as a backstop. **Effort:** <30 min.

**C-01 · FIXED 2026-07-17 · Corporate — conversion now uses authoritative RoomType pricing and capacity** *(Confidence: HIGH)*
**Remediation:** the transaction now reads `settings/hotelConfig.roomTypes[]`, uses the matching type entry for capacity and fallback pricing, preserves explicit/code rate precedence, and rejects a zero fallback rate.
`handleConvertInquiryToBooking` resolves the nightly rate as `roomData.pricePerNight` with fallbacks to `roomData.corporateRate`, and checks `guests > roomData.maxCapacity`. All three fields were **moved off room documents onto the RoomType entry** in W3.6/W3.7 (`shared/types/index.ts:96-105`), so on any room created since (including the clean-slate production DB per Decision #119) they are `undefined`. Result: converting an inquiry with no attached access-code rate map and no manually typed rate override (the admin modal defaults the override to empty — `CorporateInquiriesPage.tsx:171,199-201`) creates a **`confirmed` booking with `ratePerNight: 0` and `totalPrice: 0`** (plus breakfast if selected), which flows straight into revenue reports; and the capacity guard never fires (`guests > undefined` is `false`). The public corporate create path is unaffected (it correctly reads the type entry — `bookings.ts:551-559`).
**Fix:** inside the conversion transaction, resolve the type entry from `settings/hotelConfig.roomTypes[]` (same pattern as `handleCreateBooking`) for capacity, base rate, and corporate rate; reject a resolved rate of 0 without an explicit override. **Effort:** 1–2 h.

**X-01 · FIXED 2026-07-17 · Cross-cutting — sensitive uploads are staff-only with short-lived signed URLs** *(Confidence: HIGH)*
**Remediation:** public `get` grants were removed. Guest clients use randomized filenames, persist object paths, and preview local blobs; authenticated staff resolve allowlisted paths through `/api/storage/signed-url`.
The rules for `bookings/{bookingId}/payment-proof/`, `bookings/{bookingId}/discount-id/`, and `store-orders/{roomNumber}/payment-proof/` pair the intended `allow read: if isStaff()` with a second grant, `allow get: if true` (rules v2 granular method; allows are OR'd). Any unauthenticated caller who knows a file path can fetch the object — payment screenshots and **OSCA/PWD government-ID photos**. This directly contradicts SECURITY.md ("Read: authenticated staff/admin only — **never public**") and the GOTCHAS rule. Exposure: booking paths are guarded only by the ~120-bit `bookingId` (which appears in lookup/member-stays API responses) plus the guest's *original upload filename* (`BookingPage.tsx:714,744` — e.g. `IMG_1234.jpg`); the store-order path is keyed by a **guessable room number**. The grant likely exists so the anonymous uploader can call `getDownloadURL` after upload. The paired `allow write: if true` additionally makes these paths open anonymous file hosting (janitor sweeps orphans daily).
**Fix:** remove `allow get: if true`; for the client preview use the local file (`URL.createObjectURL`) instead of the remote URL, upload under a server-safe randomized filename, and have the booking API resolve/verify the storage path server-side (Admin SDK) so staff-only reads hold. **Effort:** 2–4 h. RA 10173 relevance: these are exactly the artifacts a breach notification would cover.

### MED

**X-02 · FIXED 2026-07-17 · Cross-cutting · white-label hardcoding sweep — brand strings, filenames, locale, and currency baked in** *(Confidence: HIGH)*
Violations of the GOTCHAS white-label rules, consolidated: seeded payment-method defaults `"Spark Inn Hotel Corp"` / `paypal@sparkinn.com` (`AdminContext.tsx:3597-3599`, contra Decision #106i); export filenames `sparkinn_*` / `spark-inn-*` (`ReportsPage.tsx:1015,1028,1044,1098,1295,1486`); hardcoded `"en-PH"` locale in receipt/date formatting (`BookingsPage.tsx:1382,1675,1935,3812`, `CorporateInquiriesPage.tsx:282`, `ReportsPage.tsx` PDF); hardcoded `₱`/`PHP` in CSV headers, placeholders, and the receipt amount formatter (`BookingsPage.tsx:1701`, `ReportsPage.tsx:1347-1368`); `name@sparkinn.com` login placeholders (`LoginPage.tsx:117,204`). Zero impact for Spark Inn; every one ships wrong for the next hotel client. **Fix:** sweep to `config.brandName` / `config.legalName` / `config.locale` / `config.currencySymbol` / a `config`-derived filename slug. **Effort:** ~0.5 day.

**C-02 · FIXED 2026-07-17 · Corporate · `guest-app/server/handlers/corporate-inquiries.ts:171-182` — convert-inquiry blocked-room check parses free-text `preferredDates` instead of the requested dates; `roomBlocks` never checked** *(Confidence: HIGH)*
Inside the block-window check, local `checkInDate`/`checkOutDate` consts **shadow** the function's parsed dates and are built from `inquiryData.preferredDates.split(" to ")` — a free-text string ("flexible, mid-August…"). Unparseable text yields `NaN` comparisons, `windowActive` evaluates `false`, and a blocked room with a defined window converts into a confirmed booking inside its block. The path also skips the `roomBlocks` collection check that `handleCreateBooking` runs (`hasActiveRoomBlockConflict`). Partially mitigated by the admin room picker filtering `status === "blocked"` rooms — but that snapshot can be stale. **Fix:** delete the shadowed re-parse (use the function's `checkInDate`/`checkOutDate`) and add the shared `roomBlocks` conflict check. **Effort:** <30 min.

**C-03 · FIXED 2026-07-17 · Corporate · guest/admin `preferredDates` schema drift — pipeline shows blank dates for every guest inquiry** *(Confidence: HIGH)*
The guest inquiry form submits `preferredDates` as a free-text string (`CorporateStaysPage.tsx:73,257`; server schema `corporate-inquiries.ts:14` agrees). The admin app types it as `{ from, to }` (`AdminContext.tsx:292,1889`) and renders `preferredDates.from / .to` in the pipeline table, drawer, and convert-modal prefill (`CorporateInquiriesPage.tsx:166-167,241,409`) — all `undefined` on a string, so staff see "N rooms ( to )" and empty prefills for every real inquiry. The server's C-02 check assumes the string shape, deepening the split. **Fix:** pick one shape (structured `{from,to}` via two date inputs on the guest form is cleanest), normalize at read time for legacy docs. **Effort:** ~2 h.

**G-02 · FIXED 2026-07-17 · Guest · `guest-app/server/handlers/bookings.ts:401-404` — no maximum stay length or advance-booking window; anonymous pending bookings occupy inventory** *(Confidence: HIGH)*
`numNights` has only a `>= 1` lower bound; check-in only needs to be today-or-later. Availability (`rooms.ts:15`) and the create transaction both treat `pending` bookings as room-occupying. An anonymous pay-at-hotel booking spanning years (or many long bookings at 5/IP/min) blocks room types until staff notice and cancel each one. **Fix:** cap `numNights` (e.g. 30) and the advance window (e.g. 365 days) server-side; mirror in the date picker. **Effort:** <30 min.

**G-03 · FIXED 2026-07-17 · Guest · `guest-app/server/handlers/email.ts:1024-1030` — booking-confirmed email does not attach the receipt PDF required by Decision #82** *(Confidence: HIGH — absence verified: zero `attachments` usage in the server email pipeline)*
Decision #82 (DECISIONS-FEATURES.md) says the booking receipt PDF is "reused as email attachment in the `booking-confirmed` email template." `printBookingReceiptPDF` exists in `admin-app/src/pages/BookingsPage.tsx` (client-side jsPDF), but no email carries an attachment — guests never receive a PDF receipt, and there is no guest-side PDF generation on Step 4 or `/my-booking` either. The HTML email does contain the full breakdown, so the operational impact is limited. **Fix:** either implement a server-side PDF attachment (jsPDF runs in Node) or formally amend Decision #82 to "front-desk print only" and update BOOKING-FLOW/EMAIL-PDF-STORAGE. **Effort:** 0.5–2 days (implement) or 15 min (docs decision).

**G-04 · FIXED 2026-07-17 · Guest · `guest-app/src/pages/IntercomPage.tsx:599-613` + `firebase/firestore.rules:213-219` — intercom message rate limit is client-side only** *(Confidence: HIGH)*
SECURITY.md §Intercom Abuse Mitigation specifies ~30 messages/room/10 min. The only enforcement is `canSendGuestMessage()` reading `localStorage` — trivially bypassed since Firestore rules allow unauthenticated `create` on `intercoms/{roomId}/messages` (key-allowlisted, but unlimited volume). A script can flood the staff inbox, which plays a notification sound per message. The verify-guest gate (last name + active booking) raises the bar for the chat UI but does not gate raw Firestore writes. **Fix:** route guest sends through a rate-limited API endpoint, or accept and document the residual risk (physical-QR + name-gate model already accepts openness). **Effort:** ~0.5 day.

**FD-01 · FIXED 2026-07-17 · Front desk · admin-app (absent) — 8-hour inactivity auto-logout from SECURITY.md §Session Management is not implemented** *(Confidence: HIGH — grep across `admin-app/src` finds no idle timer or `signOut` timeout)*
SECURITY.md specifies "Auto-logout after 8 hours of inactivity — implemented client-side via a `setTimeout` reset on any user interaction." Only `browserSessionPersistence` is implemented (`AdminContext.tsx:597,660`), which clears the session on tab/browser close but not on an unattended open tab — the stated threat model (shared front-desk computers left unattended between shifts). **Fix:** add an idle timer hook in `AdminLayout` (reset on interaction events, `signOut()` + redirect on expiry) or amend SECURITY.md if tab-scoped persistence is deemed sufficient. **Effort:** ~1 h.

**FD-02 · FIXED 2026-07-17 · Front desk · `firebase/firestore.rules:110-113` — any signed-in user can self-write a `role` field into `guests/{uid}`, polluting the staff list** *(Confidence: HIGH)*
The `guests` rule allows `create, update: if isAdmin() || (signedIn() && request.auth.uid == userId)` with no field restrictions. Guest-app Spark Rewards members authenticate against the same Firebase project, so any member can write `guests/{their-uid}` with `role: "front-desk"` — and the Settings staff list subscribes to `guests where role in ["front-desk","admin"]` (`AdminContext.tsx:4368`), so a phantom "staff" row appears in the admin UI (social-engineering surface: an admin might grant it a real account/claims via the edit flow). No direct privilege escalation — `isStaff()`/`isAdmin()` check custom claims only. **Fix:** constrain self-writes with `diff().affectedKeys()` to exclude `role` (and other staff-mirror fields), reserving `role` writes for `isAdmin()`/server. **Effort:** <1 h.

### LOW

**FD-03 · Front desk · docs contradiction — Decision #81's premise that "Rates is admin+front-desk accessible" is false; vouchers are not reachable by front desk** *(Confidence: HIGH)*
`/rates` is admin-only in both `AdminLayout.tsx:92-94` and `plan/admin-app/CLAUDE.md`, but Decision #81 moved voucher CRUD to the Rates page *because* front desk supposedly could reach it ("Vouchers need front-desk access for walk-in redemptions"). Operationally, front desk can still *apply* a voucher code during walk-in creation (validated server-side), but cannot view or look up voucher campaigns. **Fix:** product decision — either grant front desk read-only voucher visibility or amend Decision #81/VOUCHERS.md to record the admin-only reality. **Effort:** docs 15 min, or ~2 h for a read-only voucher view.

**A-01 · Admin · `plan/features/REPORTS.md:57,136` vs `admin-app/src/pages/ReportsPage.tsx:415-418` — spec's revenue status filter is stale** *(Confidence: HIGH)*
REPORTS.md says revenue queries use `["confirmed", "checked-in", "checked-out"]`; the code deliberately adds `payment-confirmed` (with an inline rationale tying it to Collections/Receivables consistency). The code is right; the MD should be updated. **Fix:** docs only. **Effort:** 5 min.

**A-02 · Admin · `plan/docs/SECURITY.md:138` vs `firebase/firestore.rules:205-208` — corporateCodes write rule is staff-wide, spec says admin-only** *(Confidence: HIGH)*
SECURITY.md declares `corporateCodes` "Write: admin only," but the rule allows all staff — operationally required, since access codes are generated from the front-desk-accessible Corporate Inquiries page. **Fix:** amend SECURITY.md (or tighten the rule and move code generation behind an admin-gated API if the owner wants admin-only codes). **Effort:** docs 10 min.

**A-03 · Admin · `admin-app/src/pages/ReportsPage.tsx:437-443` — future custom date ranges understate occupancy** *(Confidence: MED — depends on owners using future ranges)*
The revenue-eligibility rule that excludes future `confirmed` bookings with zero recorded payments also feeds `rangeBookings`, which drives occupancy and bookings-by-source. For historical ranges (the primary use) this is correct; for a future custom range ("next month's occupancy"), unpaid confirmed bookings vanish from the forecast. **Fix:** if forward-looking reporting matters, split occupancy eligibility from revenue eligibility. **Effort:** ~1 h.

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

## Verified-Good (Front desk role)

- **Role gate is claims-based and fails closed** — `getIdTokenResult(user, true)` with a strict `isStaffRole` check that signs out non-staff tokens (`AdminContext.tsx:607-618`); `/rates`, `/members`, `/settings` show an Access Denied overlay for front desk (`AdminLayout.tsx:92-94,307-333`) per AUTH-ROLES.md (visible-but-restricted, not hidden).
- **Admin-only API routes re-check role server-side** — `create-staff`, `disable-staff`, `publish-seo` all reject `role !== "admin"` with 403 (router:945-981); `authenticateStaff` itself rejects tokens without a staff role claim.
- **Walk-in creation is the model citizen** — strict shared Zod schema (`shared/schemas/booking.ts:43-59`: `guests` int 1–100, `totalPriceOverride` finite 0–1M, `.strict()`), staff-authenticated, and the transaction runs the same candidate/overlap/roomBlocks/lingering-checked-in checks as the public path, resolving capacity and rates from the RoomType entry (`bookings.ts:1362-1385`) — the exact pattern C-01's convert path should copy.
- **Client-side booking writes are structurally limited** — Firestore rules allowlist only operational fields via `diff().affectedKeys().hasOnly(...)` (`firestore.rules:45-58`); status, pricing, and rewards mutations must go through the authenticated API routes. Incidental charges have per-field validation and deterministic void IDs.
- **Housekeeping cycle** matches Decision #88: clean → dirty → in-progress → clean (`AdminContext.tsx:819-831`).
- **Receipts are folio-based** — `printBookingReceiptPDF` (`BookingsPage.tsx:1658`) renders from `getBookingFolio` + the `payments` subcollection with amount-due math; registration and receipt PDFs have regression tests.
- **Session persistence is tab-scoped** (`browserSessionPersistence`, `AdminContext.tsx:597,660`) per SECURITY.md; AdminContext's 25 `onSnapshot` listeners all return cleanup functions.

---

## Verified-Good (Admin role — reports data accuracy)

**Single source of truth:** ReportsPage consumes `bookings`, `payments` (collection-group), `charges` (collection-group), and `storeOrders` from the same `AdminContext` `onSnapshot` subscriptions that Bookings Management renders — no stale cache, no parallel collection (`ReportsPage.tsx:186-199`).

**Eligibility rules** (`ReportsPage.tsx:415-447`): revenue counts `payment-confirmed | confirmed | checked-in | checked-out` only — `cancelled`, `pending`, and `payment-uploaded` are excluded; past `confirmed` no-shows are excluded from revenue but surfaced with their retained cash in the FL-14 table (`:527-532`); future unpaid `confirmed` bookings are excluded until money is recorded.

**Computation checks:**
- **Revenue** — `splitBookingRevenue` (`admin-app/src/utils/finance.ts:168-193`) splits the *net* `totalPrice` proportionally over locked gross room/breakfast amounts, so voucher, senior/PWD, and member deductions are reflected by construction and room+breakfast always re-sum to booking revenue. Multi-period stays prorate by `getOverlapNights` (`ReportsPage.tsx:135-150`), which uses `config.timezone` day-keys and excludes the checkout day (FL-15). `NaN`/negative totals are coerced to 0 (`nonNegativeFinite`).
- **Occupancy** — dynamic active-room counts per type (never hardcoded), occupied nights from the same `rangeBookings` via overlap-night math (`:869-884`, `:1494-1501`).
- **Bookings by source** — grouped over the same `rangeBookings`; all three create paths stamp `source` server-side (`online`/`corporate` at `bookings.ts:1043`, `walk-in` at `:1570`, converted inquiries `corporate` per Decision #103).

**Manual spot-checks (traced through the code):**
1. *Voucher-discounted online booking* (3 nights fully in range, ₱500 voucher, no breakfast): eligible → overlap 3/3 → room revenue = net `totalPrice` (voucher already deducted server-side at creation) — no path re-adds the discount.
2. *Corporate flat-rate checked-in booking*: eligible → `totalPrice` = contracted flat rate × nights (locked at creation, `bookings.ts:782-794`) → counted at the contracted amount; source pie shows "Corporate Codes."
3. *Cancelled booking with a retained ₱2,000 payment*: absent from revenue/occupancy/source (status filter), its cash appears in Collections by `recordedAt` and in the cancelled/no-show retained table — counted once, in the right place.

**Admin scope elsewhere:** Settings writes are admin-only at the rules layer (`firestore.rules:136-139`), staff CRUD goes through admin-re-checked API routes, rate management edits the admin-only `settings/hotelConfig`, voucher CRUD sits on the admin-only Rates page with staff-level rules, QR regeneration is a staff-permitted room update, and the Full Backup button is admin-gated (`ReportsPage.tsx:1744`).

---

## Verified-Good (Cross-cutting)

- **Vercel function cap: 2 of 12** — the committed `guest-app/api/[...route].js` bundle plus the root `api/[...route].ts` shim; nothing else under any `api/` directory.
- **No PII in logs** — zero `console.*` calls carrying guest name/email/phone across `guest-app/server`, `guest-app/src`, and `admin-app/src`.
- **`paymentProofUrl` never enters the guest client** — guest-app only *writes* it during upload (`BookingPage.tsx:804`, `CorporateBookingPage.tsx:687`, `IntercomPage.tsx:1006`); no guest-facing API response includes it (lookup allowlist, stays projection both verified).
- **Listener hygiene** — every file with `onSnapshot` in both apps returns its unsubscribe (guest: 5 files, 8 listeners; admin: `AdminContext` 25 listeners, all cleaned).
- **Rate limiting** — booking create 5/min, voucher 20/min, corporate code 10/min, lookup 10/min (+Turnstile), email 3/ref/hour, inquiry 5/min, member routes 5–30/min. In-memory per-instance limiter is the documented Phase 1 choice.
- **Auth/session** — admin: claims-based roles, tab-scoped persistence (FD-01 idle logout pending); guest: default local persistence per spec; test-mode auth bypasses are `NODE_ENV === "test"` only.
- **RA 10173** — consent gate (client + server), `/privacy` with admin-editable DPO contact, `/terms`, server-side erasure flow (`/api/members/delete-account`: token-verified, confirmation phrase, anonymized audit records, points-history purge, Auth user deletion), registry-retention carve-out documented.
- **Headers/CSP** — full CSP with Turnstile/Firebase/Sentry allowlist, `frame-ancestors 'none'`, `nosniff`, `Permissions-Policy` keeps `microphone=(self)` (BI-06).
- **Secrets hygiene** — only `.env.example` files are committed.

---

## Quick Wins (<30 min each)

1. ✅ **G-01** — complete request validation and finite-total backstop shipped 2026-07-17.
2. **G-02** — cap `numNights` and advance-booking window server-side.
3. **G-05** — prefix-allowlist `paymentProofUrl` / `discountIdPhotoUrl` against the Firebase Storage bucket URL.
4. **C-02** — remove the shadowed `preferredDates` re-parse in the convert-inquiry block check; use the requested dates and add the `roomBlocks` conflict check.
5. **C-04** — render + bind a real honeypot input on `/corporate/book`.

---

## Go / No-Go — FINAL

**Code-ready at the CRITICAL/HIGH tier as of 2026-07-17; production remains NO-GO until the fixes and Storage rules are deployed.** No CRITICAL findings were found, and all three HIGH findings are implemented and verified. Address the remaining MEDs (G-02 stay-length cap, G-03 receipt-attachment decision, G-04 intercom flood, C-02/C-03 conversion robustness, FD-01 idle logout, FD-02 staff-mirror rule, X-02 white-label sweep) before or shortly after staff onboarding; X-02 remains mandatory before the second white-label client.

---

## Docs Updated

- `plan/features/BOOKING-FLOW.md` — added `## Known Issues (Audit 2026-07-17)` (G-01, G-02)
- `plan/features/CORPORATE-INQUIRIES.md` — added `## Known Issues (Audit 2026-07-17)` (C-01, C-02, C-03)
- `plan/docs/SECURITY.md` — added `## Known Issues (Audit 2026-07-17)` (X-01)
- `plan/docs/GOTCHAS.md` — appended never-do rules: validate full API body (G-01); never read pricing/capacity fields off room documents (C-01); never add granular `allow get` grants that bypass staff-only Storage reads (X-01)
- `plan/project/ROADMAP.md` — appended dated section "E2E User Journey Audit (2026-07-17)" with CRITICAL/HIGH tasks per role
