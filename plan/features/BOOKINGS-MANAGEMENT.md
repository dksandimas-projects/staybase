# Bookings Management
> App: admin-app
> Phase: Phase 5 — Admin Bookings Management (extended through Phase 12: drawer IA refactor, unpaid checkout, payment reference semantics, filtering — all shipped 2026-07-16)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Bookings Management
> Pre-compaction snapshot (original implementation plans + prior-state narratives): `plan/project/archive/BOOKINGS-MANAGEMENT-ARCHIVE-2026-07-17.md`

## Overview

The primary operational tool for front desk staff at `/bookings`. Displays all bookings in a filterable, sortable table. Staff view and work bookings in a status-aware four-section drawer workspace, advance booking status, manage the folio (payments, refunds, discounts, incidental charges, store charges), generate receipts, log cancellations, and create walk-in or manual bookings directly from the dashboard.

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

## Booking Drawer Workspace (BDUX contract, shipped 2026-07-16)

The drawer is a status-aware workspace, not a continuous stack of forms. These rules constrain any future drawer change:

- **Sticky header** — compact booking context (guest, room, stay, status, source), lifecycle indicator, Total/Paid/Balance summary, and actionable alerts (payment proof awaiting verification, early check-in request, check-in readiness). Guest contact + payment method/reference context stay above the section tabs.
- **Four task-based sections** — **Overview** (guest info, room/dates, breakfast inclusion, compact payment status, financial summary), **Check-in** (readiness checklist, registration, signature, guest ID, discount verification, breakfast selections), **Folio** (all money: ledgers, discounts, receipts), **Activity & More** (email actions/history, move/upgrade/reschedule, audit detail, cancellation). Panels stay mounted while hidden so switching sections never discards form input.
- **Sticky status-aware footer** — one primary action for the current status plus a **More actions** menu. Cancellation lives in More, never beside the normal workflow.
- **Progressive disclosure** — completed registration collapses to a summary card with Edit; nightly rate breakdown is collapsible; payment/refund history and incidental charges auto-collapse at 4+ entries; email actions sit behind a disclosure.
- **Focused task modals** — apply discount/voucher, record payment, record refund, add/void charge, and cancel booking each open one bounded responsive modal (full-screen sheet on mobile) with only that task's fields, validation, financial context, and confirm/cancel. No always-open inline data-entry forms.
- **Folio read-first rules** — Folio opens with Total / Paid / Balance and a visible category breakdown (booking/add-ons, billed-to-room store, incidentals) before any line items; detailed nightly rates stay behind a disclosure. Desktop uses independent columns (ledger/history main, sticky financial summary side); mobile stacks the same content. **Collect** is the only primary action while an eligible booking has a balance, rendered through the sticky footer — no duplicate inline Collect rows.
- **Payment proof lives in Folio** — full proof-review card (image, method, reference, upload time, **Verify & Record Payment** action) is canonical in Folio; Overview shows only a compact status badge; the sticky header shows a pending-verification alert that navigates to Folio. After verification/rejection the card collapses to a compact immutable evidence row with a **View proof** button.
- Unresolved operational items get emphasis; completed/historical information is quiet and collapsible. Existing status eligibility, server-authoritative pricing, check-in/checkout gates, role restrictions, PII protections, and append-only ledger behavior never change through UI refactors.
- Components: `BookingDrawerWorkspace.tsx` (header/tabs/readiness/footer), `BookingRegistrationForm.tsx`, `BookingEmailActions.tsx`, `IncidentalChargeList.tsx`.
- Remaining verification: manual/visual QA matrix — tracked in `plan/project/ROADMAP.md §Phase 12 →Booking Drawer UX Refactor`.

---

## Table Filtering & Search (FSO contract, Phase 1 shipped 2026-07-16)

Applies to both the Bookings tab and the Store Orders tab; each holds independent filter state.

- **Two-level controls** — toolbar with search, count-bearing quick-view chips, result count (`n of total`), and **Clear all**. Advanced filter panel (grouped controls, Apply/Cancel) opens via a **Filters** button showing the active-filter count. (Mobile advanced sheet is Phase 2 — see ROADMAP.)
- **Visible active state** — every active quick view, search query, and status filter renders as a removable chip; **Clear all** resets everything.
- **Canonical URL state** — search (`bq`/`sq`), quick view (`bqv`/`sqv`), status (`bs`/`ss`), and main tab (`tab`) live in normalized URL params; refresh, Back/Forward, and deep links restore the view. Legacy `?filter=` and `?orderRef=` auto-migrate on load.
- **AND composition** — search, status filter, and quick view combine with AND semantics; results default to attention-needed first, then check-in date.
- **Booking quick views** — Needs attention, Arrivals today, Departures today, In house, Upcoming, Balance due, Cancelled, All bookings. **Needs attention** = `payment-uploaded`, overdue confirmed/pending arrivals, unresolved early check-in request, overdue in-house departures, checked-out receivable with positive balance — computed with the same `getBookingFolio` helper as the drawer alerts.
- **Store quick views** — Needs action (placed awaiting confirmation + unverified payment proof), Placed, Preparing, Out for delivery, Delivered today, Add to room bill, Payment pending, Cancelled, All orders.
- **Search coverage** — bookings: guest name, ref, room, email, phone, original booking-payment reference, payment-ledger transaction references. Store: guest name, order ref, room, booking ID, notes, item names.
- **Performance** — `filteredRows`/`filteredOrders` are `useMemo`-wrapped; quick-view counts use inline predicates.

---

## UI Checklist

- [x] Booking table — columns: Booking Ref, Guest Name, Room, Check-in, Check-out, Source, Payment Method, Status badge, Actions; mobile card view via `renderMobileCard` (`plan/features/ADMIN-MOBILE.md`)
- [x] Booking detail drawer — opens on row click into the four-section workspace above
- [x] Discount ID photo — shown in Check-in section when `booking.discountType != ""`:
  - [x] Thumbnail with "View Full Size" link (opens Firebase Storage URL in new tab)
  - [x] Label: "OSCA Card" or "PWD ID" depending on `discountType`
  - [x] Three-state verification control — **Pending** (yellow badge, default) / **Verified** (green; stores `discountVerified: true`, `discountVerifiedBy`) / **Rejected** (red; discount removed, rejection email sent — see `plan/features/EMAIL-PDF-STORAGE.md §Discount Rejected`; stores `discountRejected: true`, `discountRejectedBy`, `discountRejectionReason`)
  - [x] Reject opens a confirmation modal with optional reason input — reason stored and included in the rejection email
  - [x] On rejection: `totalPrice` restored to pre-discount amount (only the Senior/PWD deduction is removed; voucher/member/points deductions and the rate breakdown are preserved and rebuilt server-side); guest pays full amount at check-in
  - [x] Once rejected, discount cannot be re-applied from the drawer
- [x] **Folio — Payments Collected Onsite** — shown for `confirmed` / `checked-in` / `checked-out`
  - [x] Ledger rows: amount (₱), method, transaction reference, internal note, recorded by, timestamp; **Total Collected** and **Outstanding Balance** (charge-inclusive) in the sticky summary
  - [x] **Record Payment** button opens the focused modal — amount (defaults to outstanding balance, editable for partial payments), method selector, **Transaction reference** + **Internal note** as separate fields (see §Payment Reference Semantics)
  - [x] Payments are immutable once saved — no editing, no deletion (audit trail)
  - [x] "Fully Settled" badge at ₱0 balance; walk-in Pay-at-Hotel cash confirmation happens through this panel
- [x] **Refund workflow (FIN-03)** — Admin-only focused modal appends `type: "refund"` with negative amount, required method/reason, `approvedBy`, timestamp via authenticated `/api/bookings/add-refund`; server rejects refunds above current net collected; refund entries immutable, rendered in red
- [x] Status action buttons — context-aware in the sticky footer, only valid next transitions
- [x] Notes field — staff internal notes saved to booking
- [x] Receipt button — printable/downloadable PDF (jsPDF), consumes the authoritative Folio summary
- [x] Resend Transactional Email panel (Activity & More, behind a disclosure) — Booking Submitted, Booking Confirmed, Payment Confirmed, Check-in Reminder, Booking Cancelled, Discount Rejected; recommends templates based on booking/discount status
- [x] Check-in registration workstation — Check-in section for `confirmed` / `checked-in`: registry fields (nationality, address, DOB, gender, ID type + number, emergency contact, vehicle plate), signature status toggle, registration PDF action; check-in disabled until required fields + guest ID photo are saved
- [x] Breakfast selections panel — only if `booking.hasBreakfast: true`; dates × guests grid of active silog items from `settings/breakfastConfig.silogItems`; saved to `breakfastSelections` map; collapsible with recorded-count badge
- [x] Guest ID upload — `confirmed` / `checked-in`; jpg/png/webp via shared `compressImageFile()`; thumbnail preview; re-upload overwrites; `guestIdPhotoUrl` staff-only, stored at `bookings/{bookingId}/guest-id/{filename}`
- [x] **Spark Rewards — Points Redemption panel** (Folio) — when status is `confirmed`/`checked-in`/`checked-out` AND `booking.memberId` set: member row (name, `memberNumber`, balance); redeem form with live ₱ preview from `settings/rewardsConfig.pointsRedemptionRate`; one redemption per booking; undo is admin-only and only on `confirmed`
- [x] Cancellation — confirmation modal with reason input, isolated in **More actions**
- [x] Checkout folio review — room/add-ons, incidental charges, billed store charges, payments collected, balance state — single authoritative summary (no duplicated checkout-review block)
- [x] Walk-in / manual booking — "New Booking" CTA opens full-screen-on-mobile modal; standard walk-in fields, discount-type + voucher-code fields, optional test-run selector, immediate check-in option
- [x] Calendar view — `/calendar` renders a live room × date grid; click ranges to block or book; booked ranges open a booking drawer with move/reschedule; blocked ranges open a block drawer; active `roomBlocks` render with strikethrough
- [x] No pagination — all active bookings loaded in one real-time snapshot (fits property size)
- [x] Loading skeleton on initial data fetch

## Data & Logic Checklist

- [x] `onSnapshot` on `bookings` collection — real-time updates
- [x] Status transition rules:
  - `pending` → `payment-uploaded` (auto on screenshot), `confirmed` (pay-at-hotel), `cancelled`
  - `payment-uploaded` → `payment-confirmed`, `cancelled`
  - `payment-confirmed` → `confirmed`
  - `confirmed` → `checked-in`, `cancelled`
  - `checked-in` → `checked-out`
  - `checked-out` / `cancelled` → no further transitions
- [x] Check-in gate: `/api/bookings/checkin` rejects check-in unless status is `confirmed` or `payment-confirmed`, `guestIdPhotoUrl` is present, required `guestRegistration` fields are saved (nationality, address, DOB, gender, ID type + number, emergency contact), and signature status is `signed`; vehicle plate optional. The drawer mirrors the same rule via the shared readiness helper — disabled CTA + plain-language missing-items checklist. Direct check-in from `payment-confirmed` is a documented supported path.
- [x] Status updates are server-authoritative: cancellation, uploaded-payment verification, confirmation, check-in, and checkout use authenticated `/api/bookings/*` routes; Firestore client rules exclude `status` from the staff update allowlist
- [x] Uploaded-payment verification: **Verify & Record Payment** (Folio proof card + Dashboard) → `handleVerifyAndRecordPayment` atomically creates the payment ledger entry and transitions `payment-uploaded` → `payment-confirmed` in one transaction (see §Payment Reference Semantics); legacy `/api/bookings/mark-payment-confirmed` is kept only for in-flight backward compatibility and is unreachable from the UI. `/api/bookings/confirm` owns the confirmed transition and email
- [x] Cancellation: POST `/api/bookings/cancel` — owner/staff authorization, status validation, `cancellationReason`, cancellation email all server-side
- [x] Walk-in creation: POST authenticated `/api/bookings/create-walkin` — strict full-body Zod validation before the availability-locking transaction, finite manual override capped at 1,000,000, `source: "walk-in"`, defaults to `confirmed` unless immediate check-in, `handledBy` from the verified staff token; booking ref generated inside the same transaction
- [x] Points redemption: POST `/api/members/redeem-points` — validates balance, computes value from `settings/rewardsConfig.pointsRedemptionRate` (never hardcoded), updates booking + member, logs to `pointsHistory`; undo via `/api/members/undo-redemption` (admin, `confirmed` only) — both rebuild the locked rate breakdown server-side
- [x] Receipt PDF generated client-side with jsPDF — see `plan/features/EMAIL-PDF-STORAGE.md`
- [x] Additional payments: POST `/api/bookings/add-payment` with client-preallocated `paymentId` — API creates that exact immutable document, safely replays exact retries, rejects conflicting ID reuse, and atomically advances `pending`/`payment-uploaded` to `payment-confirmed` when the running total reaches `totalPrice`; the committed transition gates the one-time guest email
- [x] `onSnapshot` on `bookings/{bookingId}/payments` in drawer; balance computed from the charge-inclusive folio (`getBookingFolio`)
- [x] Discount verification/rejection: verify via `updateDoc` (`discountVerified` + `discountVerifiedBy`); rejection via POST `/api/bookings/reject-discount` — staff role required, removes only the rejected deduction, rebuilds the breakdown, triggers the rejection email

## Payment Reference Semantics (PRC contract, shipped 2026-07-16)

- **`Booking.paymentReferenceNumber` is narrow:** only the reference submitted with the *original* booking payment intent/proof (guest-entered GCash ref, bank trace). It is labeled **"Original booking payment reference"** in the drawer, is treated as immutable submission evidence once submitted, and is **never** the canonical reference for later deposits, partial payments, onsite collection, or post-checkout settlement. It is never auto-copied into new ledger entries. The empty-reference UI is hidden for Pay-at-Hotel bookings.
- **Every payment ledger entry carries its own `transactionReference`** (structured, immutable) plus a separate optional `note` (internal context). Schema: `plan/docs/BACKEND.md §bookings — payments subcollection`. Whether a reference is *required* is method-aware, resolved server-side from `settings/hotelConfig.paymentMethods[].requireReferenceNumber` — cash may omit it; digital/bank methods enforce it client- and server-side. Idempotency compares amount + method + transaction reference + note.
- **Verify & Record Payment** (uploaded-proof verification): the modal shows proof, booking total, collected, outstanding, submitted method, and original reference; defaults amount = outstanding balance, method = submitted method, reference = original reference — staff may correct amount/reference when evidence differs. The server transaction re-reads booking + ledger, validates against payment-method config, creates one immutable idempotent payment record (client-preallocated ID), and transitions to `payment-confirmed` only when collected total satisfies the booking total; a partial verified payment is recorded without falsely marking the booking paid. No separate confirm-then-record double entry, no duplicate emails/notifications on retries.
- **Display:** ledger rows, Reports Collections, Daily Close, and export sheets show transaction reference separately from internal note. Legacy entries with only `note` render unchanged — no inference or migration.
- Payment rejection (bounce → `pending`, room held) stays available from Dashboard pending-payment cards: `/api/bookings/reject-payment` stamps `paymentRejectionReason`/`paymentRejectedAt`/`paymentRejectedBy`, keeps stale proof for audit, emails the guest.

## Unpaid Checkout & Post-Stay Settlement (UCO contract, shipped 2026-07-16)

- Only `checked-in` bookings can check out. Zero/overpaid balance → normal confirmation; a **positive server-calculated folio balance** enters the controlled unpaid-checkout flow — it is no longer a warning staff can click through.
- The confirmation form shows Total/Paid/Balance and requires a reason (max 500 chars; shortcuts: company billing, bank transfer pending, payment failure, disputed charge, other) plus an editable audit note.
- **Approval threshold:** admin-configurable `hotelConfig.unpaidCheckoutApprovalThreshold` (default 5,000). Front Desk may approve up to it; above it requires an authenticated `admin` claim — enforced server-side inside the checkout transaction (client mirrors for guidance only). Blocked checkouts stay `checked-in` with an explanation of amount, limit, and next step.
- The checkout API recalculates the balance at commit time (booking + payments + charges + delivered Add-to-Bill orders + settings, all inside the transaction) and stamps: normalized reason, departure balance, folio total, collected total, threshold snapshot, elevated-approval flag, approving/checking-out staff UIDs, timestamp. Room release, housekeeping-dirty, intercom resolution, and loyalty award stay in the same transaction; concurrent payments retry against the new ledger state.
- **Post-checkout collection:** a checked-out booking with balance shows a **Balance due** alert (sticky header + Folio); Record Payment defaults to the outstanding amount, appends to the immutable ledger, booking stays `checked-out`. At zero balance the alert becomes **Settled after checkout**; the original departure snapshot/reason/approver is retained; loyalty points award exactly once via the final-payment transaction. The booking stays in Receivables until settled; later payments hit Collections/Daily Close on actual receipt date, never backdated.
- **Early-departure policy:** retain the contracted total, shorten the operational stay, preserve the original checkout timestamp, rebuild the receipt with an explicit retained-total adjustment.

## Staff Discount / Voucher Application (shipped 2026-07-11)

- **"Apply discount / voucher"** drawer action — available for `pending` / `payment-*` / `confirmed` / `checked-in`; blocked after checkout; hidden once a voucher is applied (compact read-only summary shown instead).
- **Senior/PWD path:** staff sights the physical ID (optional photo into `discountIdPhotoUrl`); a server route snapshots `originalTotalPrice`, re-prices with the canonical stacking order (Senior/PWD → voucher → member), stamps `discountVerified` + `discountVerifiedBy`. **Never gated by `seniorPwdOnlineEnabled`** — the front-desk path is the legally mandated one (RA 9994 / RA 10754).
- **Voucher path:** server validates the same rules as online (active, expiry, usage cap, room-type scope) and increments `usageCount` atomically in the re-pricing transaction. Never trust the client.
- Walk-in modal carries the same discount/voucher fields through the same server logic. If collected payments exceed the new total, surface "guest is owed ₱X" (refund entry per FIN-03); reports need no changes — `discountPct`/`voucherDiscount`/`originalTotalPrice` are already what exports and the FIN-05 bridge read.

## Incidental Charges — Folio Charge Ledger (FIN-14, shipped 2026-07-11)

- Schema (canonical: `plan/docs/BACKEND.md §bookings`): `bookings/{bookingId}/charges/{chargeId}` mirrors the payments pattern — `label`, `amount` (positive; reversal negative), `category` (`late-checkout | early-checkin | extra-person | damage | laundry | other`), optional `note`, `addedBy`, `addedAt`, `voidOf`.
- **Append-only at the rules level** (`allow read, create: if isStaff(); update/delete: false`); amounts capped at 1,000,000 absolute; voiding requires the deterministic document ID `void-{voidOf}` so rules enforce exactly one reversal per charge. Never edit or delete — corrections stay auditable.
- **Add charge** (focused modal from Folio): category, label, amount, optional note; available from `checked-in` (and `confirmed` for pre-arrival fees); blocked after checkout. **Void** per row with required-reason confirmation (reason → reversal `note`).
- Charges flow through every money surface: `getBookingFolio` grand total/balance, checkout gate, receipt PDF (itemized, voided pairs netted), Reports Sales tab (4th revenue stream + Incidentals sub-table), Sales XLSX + Full Backup "Charges" sheets, FIN-01 billed-side reconciliation, FIN-04 receivables. A voided charge is a charge-ledger reversal, not a payment refund — the two ledgers stay separate (charges = what's owed, payments = what moved).

## Room Move / Upgrade (current behavior + open considerations)

Current behavior (verified in code 2026-07-17):

- **Move / Upgrade Room workstation** exists in both the `/bookings` drawer (Activity & More) and the `/calendar` drawer. Staff pick any room of any type (labelled), with new dates.
- `POST /api/bookings/reschedule` runs in a Firestore transaction: capacity check against the target RoomType entry, conflict + `roomBlocks` checks, re-pricing (standard/corporate recompute; locked manual walk-in rates preserved and rescaled by night count, with the manual basis identified in the form), `deltaTotalPrice` + `pricingBasis` recorded in `rescheduleHistory`, and the `booking-rescheduled` email sent after commit.
- A live **price-delta estimate** renders in the move form before confirming.
- **In-house moves (`checked-in`) sync room statuses in the transaction** — vacated room → `available`, target room → `occupied`.

Open considerations (small, not blocking):

- ⬜ The vacated room's `housekeepingStatus` is not set to `dirty` on an in-house move — staff must toggle it manually on the Dashboard grid.
- ⬜ No prompt walks staff from the shown price delta into Record Payment / refund; staff act on the new balance via the Folio manually.
- ⬜ No dedicated guest-initiated "request room change" flow — a quick-request chip is admin-configurable in Settings → Intercom, but there's no structured handling beyond the chat thread.

## Edge Cases & States

- [x] Empty state (no bookings matching filters) — "No bookings found" with reset filters option
- [x] Booking updated by another session while drawer is open — refresh data, notify staff
- [x] Walk-in date conflict — show conflict error returned by `/api/bookings/create-walkin`
- [x] Receipt generation fails — show error, allow retry
- [x] ₱0 payment prevented by validation; overpayment shows "Overpaid by ₱X" in amber (staff handles manually)
- [x] Focused modals: submit disabled while saving; server errors shown inside the modal with retry; close only on confirmed success or explicit cancel

## Manual QA

- [x] All bookings appear with correct data; filters, quick views, and search return correct results; URL state survives refresh/back
- [x] Drawer opens with complete information; payment proof loads; status buttons show only valid next states; changes reflect in real time
- [x] Status change emails sent for confirmed/payment-confirmed transitions; cancellation email sent with reason
- [x] Receipt PDF generates with correct booking data
- [x] Walk-in created with source "walk-in"; onsite cash payment appears in ledger and updates balance
- [x] Record payment after discount rejection — balance to ₱0, "Fully Settled" shown
- [x] Verify & Record Payment: full and partial verification, idempotent retry, no duplicate email
- [x] Unpaid checkout: reason required; Front Desk blocked above threshold; post-checkout payment settles the receivable
- [ ] Full drawer visual QA matrix across statuses/breakpoints — tracked in `plan/project/ROADMAP.md §Phase 12 →Booking Drawer UX Refactor`

## References

- Booking schema, payments/charges subcollections, status flow: `plan/docs/BACKEND.md §bookings`
- Receipt generation + email triggers: `plan/features/EMAIL-PDF-STORAGE.md`
- Availability locking for walk-in creation: `plan/features/AVAILABILITY-LOCKING.md`
- Mobile drawer/table building blocks: `plan/features/ADMIN-MOBILE.md`
- Status badge colors: `plan/docs/FRONTEND.md §Status Badge Colors`
- Full shipped BDUX/UCO/PRC/FSO item lists: `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md §Phase 12`
