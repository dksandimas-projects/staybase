# Audit Open Questions — Decision Triage
> Generated 2026-06-15 from `plan/project/AUDIT-E2E-2026-06-15.md`
> Purpose: batch-resolve the 51 spec-clarification questions raised by the audit. Each gets a proposed default. Approve all defaults, or override specific ones. Approved decisions are copied to `plan/docs/DECISIONS-FEATURES.md` as new rows.

## How to use this doc

Each row is one question. Three actions:
- ✅ **Approve default** — the proposed default becomes a decision row
- 🔄 **Override** — write a different answer; becomes the decision row
- ⏸️ **Punt to Phase 12** — explicitly out of scope for current audit closure work

The "Blocks" column lists which audit findings are blocked on this question.

---

## Wave 1 — Blocking SEV-1 fixes (do these first)

These 15 questions block day-one launch fixes. The "default" is the safest interpretation of the spec; approving all of them is the path of least resistance.

| # | Source | Question | Default (proposed) | Blocks | Your call |
|---|---|---|---|---|---|
| W1.1 | 1.1 | Should `payment-confirmed` be a real state set automatically when `addOnsitePayment` makes the total ≥ `totalPrice`? | **Yes** — set `status: "payment-confirmed"` in the same transaction that records the full payment, then admin "Confirm" button flips to `confirmed`. Aligns with `DECISIONS-FEATURES.md #11` state machine. | 1.1 SEV-2 #3, 1.1 SEV-3 #2 | ✅ (decision 2026-06-15) |
| W1.2 | 1.1 | Room block date range semantics — store `blockedFrom` / `blockedTo` as Timestamp fields, or keep as string in `blockReason`? | **Structured fields** — `blockedFrom: Timestamp`, `blockedTo: Timestamp`, `blockReason: string`. Transaction iterates active block ranges and rejects overlaps. Migrate existing `blockReason` strings. | 1.1 SEV-2 #11, 1.4 SEV-3 #7/8 | ✅ (decision 2026-06-15) |
| W1.3 | 1.1 | `isCorporate` server validation contract — what server-side mechanism correlates the booking with a valid corporate code? | **Server is authoritative** — client sends `corporateCode` only (no `isCorporate` / `companyName`). Server looks up `corporateCodes/{code}`, applies `ratePerRoomType` if active+not-expired+under-cap, sets `isCorporate: true` + `companyName` server-side. | 1.1 SEV-1 #5, 1.4 SEV-1 #1, 1.4 SEV-2 #2 | ✅ (decision 2026-06-15) |
| W1.4 | 1.2 | Erasure scope for `memberId` on bookings — wipe all PII or retain for 6-month RA 11862 window? | **T&C consent + immediate full wipe on user request + anonymized audit record** — no auto-wipe cron. (a) Update T&C to add consent section covering RA 11862 retention. (b) New API route `/api/members/delete-account` runs an Admin SDK transaction: wipe `members/{uid}` PII, set `isErased: true`, anonymize linked bookings (`memberId: null`, `guestName: "Erased"`, `guestEmail: "erased@invalid"`, `guestPhone: ""`), recursive-delete `pointsHistory`, `adminAuth.deleteUser(uid)`. (c) Create anonymized `bookings/audit/{id}` records (no PII: `bookingRef`, `checkIn`, `checkOut`, `totalPrice`, `status`, `roomType`) for RA 11862 + accounting. (d) New Firestore rule: `bookings/audit/{id}` staff-read, server-write only. (e) Update `LEGAL.md`, `SECURITY.md`, `DECISIONS-FEATURES.md #49`. **Implementation deferred to Phase 1.** | 1.2 SEV-1 #3, RA 10173/11862 compliance | ✅ (decision 2026-06-15, implementation Phase 1) |
| W1.5 | 1.3 | Stock decrement on `placed` vs `confirmed`? Spec DECISIONS #37 says confirmed, STORE-MANAGEMENT.md says create. | **On confirmed** — change `handleCreateStoreOrder` to NOT decrement stock; add new `handleConfirmStoreOrder` that decrements inside a transaction. Cancel only restores stock that was decremented at confirmation. Backfill existing `placed` orders. | 1.3 SEV-2 #2a | ✅ (decision 2026-06-15) |
| W1.6 | 1.5 | Settings tab list count — Vouchers in Rates vs Settings? | **Vouchers stays in Rates** (per current implementation). Rates page is admin+front-desk accessible; Settings is admin-only. Vouchers need front-desk access (per spec) so they belong in Rates. | 1.5 SEV-2 (Settings tabs) | ✅ (decision 2026-06-15) |
| W1.7 | 1.5 | `includedInRoomRate` field on `breakfastConfig` — Phase 2 or dropped? | **Option 1: dropped** — only the add-on pricing model is supported. Booking flow's "Room Only" / "Room + Breakfast" toggle already covers the use case. The field was hypothetical — never seeded, never read, never documented in RATE-MANAGEMENT.md or SETTINGS.md. If a future hotel client needs "breakfast always included" as a differentiator, add it then as a scoped feature. See `DECISIONS-FEATURES.md #75`. | 1.5 (open Q) | ✅ (decision 2026-06-15) |
| W1.8 | 1.6 | ContactPage form — wire to `/api/contact` or remove? | **Option C: wire to a real `/api/contact` endpoint** — match the corporate inquiry pattern (Zod schema + honeypot + Turnstile + rate-limit). New `contactInquiries/{id}` collection, new `contactInquiryEmail` template, new API route, new `handleCreateContactInquiry` handler. Full spec in `plan/features/CONTACT-INQUIRIES.md`. **Documentation first, build in Phase 1.** | 1.6 SEV-2 (Contact), 2.1 SEV-2 #6 | ✅ (decision 2026-06-15, build deferred to Phase 1) |
| W1.9 | 1.7 | Booking Confirmation Receipt PDF — Phase 10B or dropped? | **Implement now** — it's a Phase 6 deliverable per `EMAIL-PDF-STORAGE.md` and blocks the `booking-confirmed` email's PDF attachment path. Add `printBookingReceiptPDF(booking)` next to `printRegistrationPDF`. | 1.7 SEV-1 #1 | ✅ (decision 2026-06-15) |
| W1.10 | 1.7 | Check-in reminder cron idempotency marker — schedule for production? | **Yes — add `reminderSentAt: Timestamp` to booking, skip if already set for `checkIn`'s date.** Add to the cron transaction. Close the at-least-once duplicate risk. | 1.7 SEV-3 #1 | ✅ (decision 2026-06-15) |
| W1.11 | Phase 2 | Firestore Timestamp vs JS Date policy for `bookings.checkIn` / `checkOut`? | **Always `Timestamp.fromDate()` on write, `data.checkIn.toDate()` on read.** Pick one format. Remove the dead ternary at `bookings.ts:281` and the `parseDateString` helpers. | 2.1 SEV-1 #2 | ✅ (decision 2026-06-15) |
| W1.12 | Phase 2 | `useState<Member[]>` mock in `AdminContext` — replace with real listener? | **Yes — replace.** Add `onSnapshot(collection(db, "members"), …)` matching the bookings/vouchers pattern. Removes the "Spark Rewards" cross-feature gap. | 1.2 SEV-1 #5, 1.3 SEV-2 #2d, 1.5 SEV-1 (Members) | ✅ (decision 2026-06-15) |
| W1.13 | Phase 2 | Developer's personal name "Daniel Sandimas" hardcoded as default GCash account holder — remove? | **Yes — remove immediately.** Replace with `config.legalName + " — " + config.supportEmail` or empty string. Hard rule violation. | 2.4 SEV-2 (hardcoded strings) | ✅ (decision 2026-06-15) |
| W1.14 | Phase 2 | Honeypot outside `<form>` on `CorporateStaysPage` — fix? | **Yes — move inside the form, hide via CSS** (off-screen absolute position, opacity 0). Match the booking-flow pattern. | 2.6 SEV-3 (honeypot pattern) | ✅ (decision 2026-06-15) |
| W1.15 | 1.5 | Housekeeping cycle order — spec or code is canonical? | **Spec** — `clean → dirty → in-progress → clean`. Current code is `clean → in-progress → dirty → clean` (wrong middle state). Fix in `AdminContext.tsx:452-459`. Update dashboard UI to show all 3 states. | 1.5 SEV-3 (housekeeping) | ✅ (decision 2026-06-15) |

---

## Wave 2 — Spec gaps that block polish work (15 questions)

These block SEV-2/3 fixes that need a spec answer to proceed.

| # | Source | Question | Default (proposed) | Blocks | Your call |
|---|---|---|---|---|---|
| W2.1 | 1.1 | Email re-use on overlapping bookings — disallowed or allowed? | **Allowed** — repeat guests can book multiple rooms in overlapping date ranges. The room conflict check prevents the same room from being double-booked. | 1.1 SEV-3 #9 | ✅ (decision 2026-06-15) |
| W2.2 | 1.1 | Member discount delivery for anonymous online bookings — ID token vs request body? | **ID token in `Authorization` header** — matches the existing staff-token pattern in the same handler. If header missing, `memberId` is null and no member discount. Reject any client-supplied `memberDiscountPct` field. | 1.1 SEV-1 #2, 1.2 SEV-1 #1, 1.4 SEV-2 #1, 1.7 SEV-2 #3 | ✅ (decision 2026-06-15) |
| W2.3 | 1.2 | Past-booking linkage beyond email — in-scope or Phase 2? | **Phase 2** — `linkBookingsByEmail` runs on registration only. A future "claim past stays" UI lets the member manually add past bookings not caught by email match. | 1.2 SEV-2 (linkage) | ✅ (decision 2026-06-15, implementation deferred to Phase 2) |
| W2.4 | 1.2 | Early check-in UX when no active booking — which booking to pick? | **First upcoming confirmed/checked-in booking** — if multiple, show a small picker modal. If none, error "no upcoming booking — book a stay first". | 1.2 SEV-2 (early check-in) | ✅ (decision 2026-06-15) |
| W2.5 | 1.2 | Member registration welcome email — intentional omission? | **Yes, intentional for Phase 1** — no welcome email. The "Welcome Gift" promise in `RewardsLandingPage` is a marketing promise, not a transactional email. Remove the gift copy or implement in Phase 2. | 1.2 (open Q) | ✅ (decision 2026-06-15) |
| W2.6 | 1.3 | Multiple concurrent calls in admin inbox — second wins, or queued? | **Second wins** — accepting a new call ends the previous one. Update `AdminContext.acceptCall` to write `status: "ended"` to the old call doc if it was active. | 1.3 SEV-2 #2b | ✅ (decision 2026-06-15) |
| W2.7 | 1.3 | Auto-archive intercom thread on checkout — clear or set resolved? | **Set `resolved: true`** on `intercoms/{roomNumber}` when `handleCheckoutBooking` runs. Manual reopen from admin. | 1.3 (open Q) | ✅ (decision 2026-06-15) |
| W2.8 | 1.3 | Cancellation message as a third visual state — keep or drop? | **Keep** — render a greyed "Cancelled" badge on the order card in both guest and admin views. Spec implies this distinction. | 1.3 SEV-2 #2c | ✅ (decision 2026-06-15) |
| W2.9 | 1.3 | Notification sound mute — localStorage or per-staff Firestore? | **localStorage** — simpler, no extra Firestore rules, instant. Add a `Bell` / `BellOff` toggle in the inbox header. | 1.3 SEV-3 (sound) | ✅ (decision 2026-06-15) |
| W2.10 | 1.3 | `calls/{roomId}` retention — delete after grace or accumulate? | **Delete after 30s grace** — both sides have observed "ended" status. Issue `deleteDoc` from a setTimeout. Prevents the `calls` collection from growing unboundedly. | 1.3 SEV-4 (call docs) | ✅ (decision 2026-06-15) |
| W2.11 | 1.4 | "Add to Bill" / "LOU" semantics for corporate bookings — first-class document? | **No — ignore LOU uploads for Phase 1** — `corporateBooking.chargeback` works without the LOU attachment. The uploaded file is replaced with a UI note ("accounts team will email you for the LOU") and an `louReceived: boolean` toggle on the admin booking drawer. Staff manually request the LOU by email out-of-band. *(Implementation deferred — fake-upload pattern closes in Phase 1 launch-readiness sprint.)* | 1.4 (open Q) | ✅ (decision 2026-06-15) |
| W2.12 | 1.4 | Should corporate booking flow support vouchers? | **No** — corporate bookings never get promo vouchers. Negotiated rates are already a discount. | 1.4 (open Q) | ✅ (decision 2026-06-15) |
| W2.13 | 1.4 | "Negotiated custom rate" UI label — flat rate or additional %? | **Flat rate per room type** — `ratePerRoomType: { roomType: rate }`. Drop the `(X% additional discount applied)` wording from the UI. The header just says "Negotiated rate applied". | 1.4 SEV-1 #1 | ✅ (decision 2026-06-15) |
| W2.14 | 1.4 | `linkedInquiryId` location — on booking, inquiry, or both? | **On the booking** — add `linkedInquiryId?: string` to the `Booking` type. Set it when a booking is created from a converted inquiry. Inquiry's `convertedBookingId` is the back-reference. | 1.4 SEV-1 #2 | ✅ (decision 2026-06-15) |
| W2.15 | 1.4 | Booking source for converted inquiry — `corporate` or `walk-in`? | **`corporate`** — the channel is what matters for reporting. Add to the `Booking.source` enum: `walk-in` | `online` | `corporate` | `converted-inquiry`. | 1.4 (open Q) | ✅ (decision 2026-06-15) |

---

## Wave 3 — UI/UX spec gaps (12 questions)

These mostly affect cosmetic/polish work, but some are launch-visible (404 version display, spec wording mismatches).

| # | Source | Question | Default (proposed) | Blocks | Your call |
|---|---|---|---|---|---|
| W3.1 | 1.5 | Booking payment methods — in Settings or Rates? | **Rates** — current implementation is correct. Update `SETTINGS.md` to reference "Booking payment methods are managed in Rates". | 1.5 (open Q) | ✅ (decision 2026-06-15) |
| W3.2 | 1.5 | Spark Rewards tab visibility — admin-only? | **Admin-only** — the Settings page itself is admin-only, so the tab inherits the restriction. Add an explicit role guard inside the tab. | 1.5 (open Q) | ✅ (decision 2026-06-15) |
| W3.3 | 1.5 | Room Types tab — spec or out-of-spec side feature? | **Keep as a Settings tab** — but migrate from localStorage to `settings/hotelConfig.roomTypes` (Firestore). Aligns with the rest of settings. | 1.5 SEV-3 (room types) | ✅ (decision 2026-06-15) |
| W3.4 | 1.5 | Reports owner vs role access — guard in page or layout? | **Page-level** — the "Download Full Backup" button has its own `isAdmin` check, while the rest of the page is staff-accessible. Easier to maintain than layout-level. | 1.5 (open Q) | ✅ (decision 2026-06-15) |
| W3.5 | 1.5 | Reports "Average stay length" — intentional or replace with avg occupancy? | **Replace with avg occupancy** — matches `REPORTS.md` spec exactly. Add `busiestRoomType` card too. | 1.5 SEV-3 (performance cards) | ✅ (decision 2026-06-15) |
| W3.6 | 1.6 | AboutPage Brand Promise banner — keep + update spec or remove? | **Keep, update spec** — it's a small, on-brand section. Add a row to `STATIC-PAGES.md §About`. | 1.6 (open Q) | ✅ (decision 2026-06-15) |
| W3.7 | 1.6 | CorporateStaysPage extra sections — keep + update spec or remove? | **Keep, update spec** — Integration Process and Retreat CTA are on-brand and not harmful. Update `STATIC-PAGES.md §Corporate`. | 1.6 (open Q) | ✅ (decision 2026-06-15) |
| W3.8 | 1.6 | PrivacyPage / TermsPage chrome — include Navbar? | **Include Navbar** — currently mixes global Footer with custom thin header. Add `<Navbar />` for consistency. Drop the custom thin header. | 1.6 SEV-3 (chrome) | ✅ (decision 2026-06-15) |
| W3.9 | 1.6 | Section title wording — "How Long We Keep It" or "Data Retention Policy"? | **"How Long We Keep It"** — matches `STATIC-PAGES.md` spec wording exactly. Spec is the source of truth. | 1.6 SEV-3 (wording) | ✅ (decision 2026-06-15) |
| W3.10 | 1.6 | Rewards program brand name — add `config.rewardsName`? | **Yes** — add `config.rewardsName: "Spark Rewards"` to `hotel.config.ts`. Sweep all "Spark Rewards" literals into `{config.rewardsName}`. | 1.6 SEV-3 (white-label) | ✅ (decision 2026-06-15) |
| W3.11 | 1.6 | Terms "Last Updated" — separate config field or reuse? | **Add `config.termsLastUpdated`** — separate from privacy. | 1.6 SEV-3 (terms) | ✅ (decision 2026-06-15) |
| W3.12 | 1.6 | 404 version display — all pages or none? | **Add a tiny `<p>v{VERSION}</p>` to the 404 card** so the version still shows. Resolve the spec contradiction by amending FRONTEND.md to allow this carve-out. | 1.6 SEV-3 (404) | ✅ (decision 2026-06-15) |

---

## Wave 4 — Infrastructure/Build/Schema (9 questions)

| # | Source | Question | Default (proposed) | Blocks | Your call |
|---|---|---|---|---|---|
| W4.1 | 1.4 | `roomTypes` configuration for non-standard types — how do they pick up corporate rates? | **Fail-soft** — if `ratePerRoomType[type]` is undefined, fall back to `room.corporateRate`. Log a warning to the admin console. Spec is implicit on this. | 1.4 (open Q) | ✅ (decision 2026-06-15) |
| W4.2 | 1.6 | `index.html` static OG meta — how to template for white-label? | **Vite build-time transform** — use a small `transformIndexHtml` plugin that substitutes `config.brandName`, `config.domain`, `config.ogImage` into the static meta tags. | 1.6 SEV-3 (OG) | ✅ (decision 2026-06-15) |
| W4.3 | 1.6 | WHITE-LABEL.md schema — missing fields from actual `hotel.config.ts`? | **Update WHITE-LABEL.md** to include the actual fields used in `hotel.config.ts`. Spec drift in the other direction. | 1.6 (open Q) | ✅ (decision 2026-06-15) |
| W4.4 | 1.7 | Voucher-issued / store-order-* / staff-* emails — in scope? | **Option C: add all 7** — `voucher-issued`, `store-order-placed`, `store-order-confirmed`, `store-order-out-for-delivery`, `store-order-delivered`, `store-order-cancelled`, `staff-new-booking`, `staff-new-payment`. Closes the gap where guests who close the intercom tab miss order status updates and where staff can miss new bookings when logged out. Full spec in `plan/features/EMAIL-AUDIT-EXTENSIONS.md`. **Documentation only — build deferred to Phase 1.5.** | 1.7 (open Q) | ✅ (decision 2026-06-15) |
| W4.5 | 1.7 | `store-orders/{roomNumber}/payment-proof/` rule — client path or rule needs change? | **Rule uses `roomNumber`** — matches the current client code. Add the storage rule. | 1.3 SEV-1 #1, 1.7 SEV-3 #4 | ✅ (decision 2026-06-15) |
| W4.6 | 1.7 | CORS `Allow-Credentials: true` — anything actually relies on cookies? | **No — remove `Allow-Credentials: true` and `*` in favor of explicit allowlist** from `config.domain` + `config.adminDomain` + localhost. Firebase ID tokens ride in `Authorization` header, not cookies. | 1.7 SEV-1 #2, Phase 2 SEV-1 | ✅ (decision 2026-06-15) |
| W4.7 | Phase 2 | `prompt("Enter cancellation reason:")` — replace with modal or keep? | **Replace with modal** — `prompt()` is brittle and inconsistent with the inquiry "Add Note" pattern. Add a small "Reason" input in the existing drawer. | 2.2 (alert/confirm/prompt) | ✅ (decision 2026-06-15) |
| W4.8 | Phase 2 | `Philippines` / `Tagbilaran City` in Privacy/Terms — keep or config-drive? | **Keep as hardcoded copy** in the legally-relevant sections (governing law, venue) but expose `config.applicableLaw` for the rest. The "Republic of the Philippines" in the venue clause is correct and not white-label-able. | 2.4 (hardcoded) | ✅ (decision 2026-06-15) |
| W4.9 | Phase 2 | `Spark Inn Hotel Corp` hardcoded as `accountName` fallback — use `config.legalName`? | **Yes — use `config.legalName`** as the fallback. | 2.4 (hardcoded) | ✅ (decision 2026-06-15) |

---

## Approval template

To approve all defaults in a wave, reply: **"Approve Wave N"**
To override specific ones, list the question ID + your answer.
To punt to Phase 12, list the question ID + "punt".

After approval, the decisions get copied to `plan/docs/DECISIONS-FEATURES.md` as new rows.

---

*Status: 51 of 51 approved (W1.1–W4.9 — all waves complete, 2026-06-15).*

*Total: 51 questions in 4 waves. Wave 1 (15) is launch-blocking. Wave 2 (15) blocks SEV-2 polish. Wave 3 (12) is UI/UX. Wave 4 (9) is infrastructure.*
