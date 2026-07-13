# Finance Lifecycle Audit — 2026-07-12

> End-to-end audit of the money path: booking creation (online / corporate /
> walk-in) → payments & refunds → discounts, vouchers, points → check-in →
> incidental charges & store billing → checkout → Reports (KPIs, Collections
> Reconciliation, Receivables, Daily Close) and exports. Read-only at audit
> time — no code changes made.
>
> Workspace: staybase
> Audited: 2026-07-12 (branch `dev`, HEAD `0812fdf`)
> Method: read-only — reviewed `guest-app/server/handlers/bookings.ts` (full),
> `guest-app/server/handlers/members.ts` (points redemption/undo),
> `guest-app/server/handlers/store.ts` + `AdminContext.tsx` store lifecycle,
> `admin-app/src/pages/ReportsPage.tsx` (full), `admin-app/src/pages/BookingsPage.tsx`
> (folio, charges, receipt, status transitions), `admin-app/src/pages/DashboardPage.tsx`,
> `admin-app/src/utils/finance.ts`, `shared/utils/pricing.ts`, `shared/utils/checkin.ts`,
> `firebase/firestore.rules`, and `plan/features/REPORTS.md`.
>
> **Convention:** findings are numbered `FL-<n>` (Finance Lifecycle — the
> `FIN-` and `FR-` namespaces are closed). Severity matches prior audits
> (`SEV-1` critical → `SEV-4` nit). Status is `Open` until the remediation
> branch updates this doc with the fix and verification.

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 2 | **2** |
| **SEV-2 (major)** | 0 | 5 | **5** |
| **SEV-3 (minor)** | 5 | 3 | **8** |
| **SEV-4 (nit / polish)** | 5 | 0 | **5** |
| **Total** | **10** | **10** | **20** |

**Verdict:** the FIN-01..FIN-14 + FR-01..FR-05 work gave the system a real
cash side (collections, refunds, receivables, daily close) and the core
plumbing is sound — server-authoritative pricing inside Firestore
transactions, append-only payment/charge ledgers enforced at the rules
level, collection-group rules present, refunds admin-gated and capped at
net collected. What this pass found is different in kind: **arithmetic and
state-transition defects inside that plumbing.** At audit time, the headline
Total Revenue KPI double-counted breakfast (FL-01), and two server paths
could write a wrong `totalPrice` to the booking doc (FL-02, FL-03); all three
were fixed in the first remediation batch on 2026-07-13. The booking status
pipeline and Dashboard revenue basis were aligned in the status-consistency
batch later that day (FL-04, FL-09, FL-12). The direct-paid store blind spot
was closed on 2026-07-13: delivery now atomically records a store-scoped tender,
so billed store revenue,
Collections Reconciliation, and Daily Close share the same settlement event
without reducing the linked booking folio (FL-05).
The final SEV-2 batch then made negotiated walk-in rates durable across
reschedules and moved strict request validation ahead of every walk-in
transaction (FL-06, FL-07). All Finance Lifecycle SEV-1 and SEV-2 findings
are now closed.

### What's already solid

- Availability + pricing run in a single Firestore transaction with the
  room-type entry from `settings/hotelConfig` as the only rate source; the
  client can never supply a price on the online path (BF-39 surfaces the
  server total back to the UI).
- Voucher / corporate-code usage counts increment transactionally on
  create and decrement on cancel; failed re-validation aborts with a 409
  instead of silently downgrading (BI-10).
- `bookings/{id}/payments` and `bookings/{id}/charges` are append-only at
  the rules level; voids are negative reversal entries with `voidOf`
  magnitude-checked in the rules; refunds require the admin role and are
  capped at net collected.
- All finance endpoints (`add-payment`, `add-refund`, `create-walkin`,
  `checkin`, `checkout`, `apply-discount`, `redeem-points`) are
  staff-authenticated in `apiRouter.ts`.
- Receivables math is correct per booking (booking total + net charges +
  billed add-to-bill orders − payments, all-time) and the Daily Close is
  locked once submitted.
- `dateKeyInTimeZone` keeps Collections-by-day and Daily Close agreeing on
  the Manila business day (FR-01).

### Fix order

1. ✅ **FL-01 + FL-02 + FL-03** — wrong-number batch shipped 2026-07-13
   with unit/API regressions and synchronized reporting/booking docs.
2. ✅ **FL-04 + FL-09 + FL-12** — status-consistency batch shipped
   2026-07-13: atomic full-payment transition, working
   `payment-confirmed → confirmed`, and aligned Dashboard revenue.
3. 🔄 **FL-08 + FL-10** — shared `rebuildRateBreakdown(booking)` helper
   shipped with FL-08 on 2026-07-13 and now serves points redeem/undo plus
   reject-discount. FL-10 early-checkout integration remains policy-blocked.
4. ✅ **FL-05** — direct-paid store tenders join the shared ledger on
   delivery; COD maps to Cash, Add to Bill remains a folio charge, and the
   decision is recorded in `DECISIONS-FEATURES.md`.
5. ✅ **FL-06 + FL-07** — walk-in/reschedule hardening shipped: preserve
   manual rates on move and strict-Zod validate the full walk-in request,
   including the capped finite `totalPriceOverride`, before Firestore work.
6. **FL-11 (policy) + FL-13 + FL-14 + FL-15** — remaining SEV-3 batch;
   FL-10/FL-11 policy questions (early-checkout refunds, points on unpaid
   folio) need owner input — log outcomes in `DECISIONS-FEATURES.md`.
7. **FL-16..FL-20** — SEV-4 polish batch.

---

## SEV-1 — Critical

### FL-01 — Total Revenue double-counts breakfast · `Fixed 2026-07-13`

**Where:**
- `admin-app/src/pages/ReportsPage.tsx:451` (`roomRevenue` — prorated `b.totalPrice`)
- `admin-app/src/pages/ReportsPage.tsx:464` (`breakfastRevenue` — gross re-add)
- `admin-app/src/pages/ReportsPage.tsx:486` (`totalRevenue = roomRevenue + breakfastRevenue + storeRevenue + incidentalRevenue`)
- `admin-app/src/pages/ReportsPage.tsx:771-779` (`monthlyRevenue` stacked chart — same pattern)
- ADR / RevPAR (FIN-11 KPIs) use the breakfast-inclusive `roomRevenue` numerator
- Spec root cause: `plan/features/REPORTS.md §Summary Cards` defines Room
  Revenue as "sum of booking `totalPrice`" *and* Total Revenue as
  "combined across all streams" — the spec itself embeds the double count.

`totalPrice` is built server-side as **room + breakfast − discounts**
(`bookings.ts:791` `subtotal = roomTotal + breakfastTotal`). Reports then
computes `roomRevenue` from prorated `totalPrice` (breakfast already
inside, net of discounts) and *adds* `breakfastRevenue` again (gross —
`breakfastRate × numGuests × overlapNights`, no discount applied). Every
booking with breakfast is counted ~twice for its breakfast component in
Total Revenue and in the monthly stacked chart, and the "Room" series/label
silently includes breakfast. Note the *reconciliation* side
(`billedTotal`, line 495) does **not** double-count — so Total Revenue and
Billed Total structurally disagree even on clean data.

**Impact:** the headline financial KPI the owner reads is overstated on
every breakfast booking; Sales XLSX Summary sheet exports the same wrong
figure; ADR/RevPAR are inflated; Total Revenue can never tie out against
Billed/Collected.

**Fix:** make the streams disjoint. Either (a) subtract the breakfast
component from the room series (`roomRevenue − breakfastRevenue` with the
discount treatment made explicit), or (b) compute room revenue from
`rateBreakdown.roomSubtotal` minus room-share of deductions. Update
`REPORTS.md` definitions so Room + Breakfast + Store + Incidentals sum to
Total by construction, and add a unit test that a breakfast booking is
counted exactly once.

**Remediation:** added a pure booking-revenue splitter that proportionally
allocates the net booking total across its locked gross room and breakfast
bases. Current-period, previous-period, monthly chart, room-type revenue, ADR,
RevPAR, and export inputs now use the disjoint net streams. Legacy bookings without a usable
room basis stay entirely in Room Revenue instead of guessing. Unit coverage
proves that Room + Breakfast equals the booking total with and without
discounts.

---

### FL-02 — Rejecting a Senior/PWD discount drops redeemed points from the price · `Fixed 2026-07-13`

**Where:** `guest-app/server/handlers/bookings.ts:1691-1723` (`handleRejectDiscount`)

The restore formula is `originalTotalPrice − voucherDiscount − memberDiscount`
— it never subtracts `pointsRedeemedValue`. A booking that had points
redeemed (`members.ts` reduces `totalPrice` directly and stamps
`pointsRedeemed`/`pointsRedeemedValue`) and then has its Senior/PWD claim
rejected gets a restored `totalPrice` that **re-charges the guest for the
points they already spent** — the points remain deducted from the member's
balance while the peso value disappears from the booking. The handler also
never rebuilds `rateBreakdown`, so the stored breakdown still shows the
rejected discount line and no longer sums to `totalPrice` (receipt PDF and
guest lookup render from it).

**Impact:** guest overcharged by `pointsRedeemedValue`; member's points
neither honored nor restored; receipts show line items that don't add up
to the total. Compare `handleApplyBookingDiscount` (line 1633), which
*does* subtract `pointsRedeemedValue` — the two staff actions disagree.

**Fix:** subtract `pointsRedeemedValue` in the restore formula and rebuild
`rateBreakdown` (shared helper per FL-08 fix-order note). Add a regression
test: redeem points → reject discount → totalPrice reflects both.

**Remediation:** discount rejection now reapplies voucher, member, and
redeemed-points deductions after removing only the Senior/PWD deduction. If
a locked breakdown exists, it is rebuilt with the corrected deductions and
final total. The regression test covers member discount plus redeemed points
and verifies that the breakdown sums to the restored total.

---

## SEV-2 — Major

### FL-03 — Staff apply-discount can zero out a legacy booking's price · `Fixed 2026-07-13`

**Where:** `guest-app/server/handlers/bookings.ts:1587-1592` (`handleApplyBookingDiscount`)

```
const subtotal = Number(booking.originalTotalPrice ?? (
  Number(breakdown?.roomSubtotal || 0)
  + (breakdown?.addOns || []).reduce(...)
) ?? booking.totalPrice);
```

The final `?? booking.totalPrice` fallback is **unreachable** — the middle
expression is a number and never nullish. A booking with no
`originalTotalPrice` (online bookings only set it when a discount was
claimed) **and** no `rateBreakdown` (legacy docs predating the breakdown
field) computes `subtotal = 0`, sails through the
`Number.isFinite(subtotal) && subtotal >= 0` guard, and writes
`totalPrice ≈ 0` plus `originalTotalPrice = 0` to the booking. All reports
then count the stay as (near-)free revenue.

**Impact:** applying a front-desk discount/voucher to any pre-breakdown
booking silently destroys its price; the overwritten `originalTotalPrice`
makes the damage hard to reverse.

**Fix:** restructure so `booking.totalPrice` is the real fallback (compute
the breakdown-derived subtotal first, use it only when > 0 / breakdown
exists), and reject with a clear error when no pricing basis can be
established. Unit-test the legacy-doc shape.

**Remediation:** the pricing basis now resolves in explicit order:
`originalTotalPrice`, a positive locked-breakdown subtotal, then the stored
`totalPrice`. Missing or non-finite pricing is rejected instead of becoming
zero. Regression coverage verifies both a valid legacy fallback and the
no-pricing rejection path.

---

### FL-04 — Full payment fires the "payment confirmed" email but never advances status · `Fixed 2026-07-13`

**Where:**
- `guest-app/server/handlers/bookings.ts:2004-2046` (`handleAddPayment` — `fullyPaid` → `sendBookingTrigger("payment-confirmed", …)`, no status write)
- `admin-app/src/context/AdminContext.tsx:1364-1383` (manual `payment-confirmed` transition sends the same email again)
- `admin-app/src/pages/ReportsPage.tsx:404-409` (`revenueBookings` excludes `pending`/`payment-uploaded`)

When recorded payments reach `totalPrice` on a `pending`/`payment-uploaded`
booking, the guest receives the *"payment confirmed"* email but the booking
stays in its old status. Three consequences:

1. **Reconciliation skew** — the payment counts in `collectedTotal` while
   the still-`pending` booking is excluded from `billedTotal` → phantom
   "over-collected". FR-04 fixed exactly this class of bug for
   `payment-confirmed`; `pending`/`payment-uploaded` bookings with
   payments re-open it.
2. **Duplicate guest email** — when staff later manually mark
   payment-confirmed, `AdminContext` fires the same template again.
3. **Check-in friction** — the check-in gate requires
   `confirmed`/`payment-confirmed` (`shared/utils/checkin.ts:1`), so a
   fully-paid booking still reads "not ready" until a manual transition.

**Impact:** guest-visible state contradicts the booking record; period
reconciliation shows over-collection that isn't real; extra manual step on
every fully-paid booking.

**Fix:** inside the existing `handleAddPayment` transaction, when
`fullyPaid && isConfirmableStatus`, also update `status:
"payment-confirmed"` (+ `updatedAt`), keeping the email dedup marker
pattern. Alternatively gate the email on the status write succeeding.

**Remediation:** the payment append and `payment-confirmed` status update
now commit in the same Firestore transaction. Only the transaction that
actually transitions `pending`/`payment-uploaded` sends the guest email, so
the committed status is the concurrency-safe idempotency guard. The update
also stamps the existing `handledBy`/`updatedAt` audit fields. Tests cover
partial payment, both eligible source statuses, and no re-fire after the
status has already advanced.

---

### FL-05 — Store orders paid directly (GCash / COD cash) never enter any payment ledger · `Fixed 2026-07-13`

**Where:**
- `admin-app/src/context/AdminContext.tsx:2638-2721` (`updateStoreOrderStatus` — no tender recording on any transition)
- `admin-app/src/pages/ReportsPage.tsx:495` (`billedTotal` includes **all** delivered store revenue)
- `admin-app/src/pages/ReportsPage.tsx:498-511` (`collectedTotal` reads only `bookings/{id}/payments`)
- Daily Close (`ReportsPage.tsx:3279-3314`) sums only booking-folio payments

Only `add-to-bill` store orders reconcile (their value lands on the folio
and is settled by a booking payment entry). A delivered order paid
directly — GCash at order time, or cash on delivery — is real collected
money with **no tender record anywhere**: it inflates `billedTotal`
permanently (phantom Outstanding that no receivable row explains, since
receivables only count `add-to-bill` orders), and the cash never appears
in the Daily Close expected drawer, so **any day with store cash sales
shows a guaranteed positive cash variance**.

**Impact:** the Collections Reconciliation and Daily Close — the two
FIN-01/FIN-13 flagship reports — are structurally wrong on every
direct-paid store order; staff get trained to expect/explain fake drawer
variances, which defeats the variance control.

**Fix (decision needed, log in `DECISIONS-FEATURES.md`):** either
(a) record a payment-ledger entry when a direct-paid order is delivered
(store tenders join the same reconciliation universe — preferred), or
(b) exclude direct-paid store orders from `billedTotal` and report store
cash as its own reconciliation line. Half-measures (fixing only the KPI)
leave the Daily Close wrong.

**Remediation:** decision #116 adopts option (a). The admin delivery action
now calls a staff-authenticated server route that atomically writes
`deliveredAt` and one deterministic `delivery-tender` record beneath the
store order. COD is normalized to Cash; configured direct methods retain
their tender key; Add to Bill creates no tender. Reports consumes these
records through the existing payments collection-group listener, while a
store-specific source identity keeps them out of booking-folio settlement.
Store revenue uses the delivery timestamp (falling back to creation time for
legacy rows). Handler tests cover direct methods, Add to Bill, invalid state,
and idempotent retries; report wiring tests cover authentication, shared-ledger
inclusion, folio isolation, and delivery-date recognition.

---

### FL-06 — Rescheduling wipes a walk-in's manual price · `Fixed 2026-07-13`

**Where:** `guest-app/server/handlers/bookings.ts:2712-2810` (`handleRescheduleBooking` pricing recalculation)

The reschedule handler always reprices from current standard/seasonal/
corporate rates. A walk-in created with `totalPriceOverride` (stored as a
`"manual"`-source `rateBreakdown` line, "Manual front-desk rate") loses
the negotiated total the moment staff move it to another room or date —
the manual line is replaced by computed rates with no warning beyond the
generic `deltaTotalPrice` in `rescheduleHistory`.

**Impact:** silently re-bills a guest a price staff never agreed to;
front-desk negotiated rates are not durable across the commonest folio
operation (room move, QA-18 flow).

**Fix:** when the existing breakdown's room lines contain a
`source: "manual"` line, preserve the manual nightly rate across the move
(rescale by new `numNights`) or require an explicit new override; surface
a confirmation in the Move Room form when the price basis changes.

**Remediation:** added one shared helper that derives the exact locked manual
nightly basis from the original room-line subtotal and night count. Both the
server reschedule transaction and admin move preview use it. The new manual
room line is rescaled only for the requested night count, retains its manual
source, suppresses a duplicate breakfast add-on, and records `pricingBasis`
in reschedule history. The move form explicitly explains the preserved rate,
and the drawer applies the authoritative server breakdown after success.

---

### FL-07 — Walk-in creation trusts unvalidated input (`totalPriceOverride`, `guestDetails`) · `Fixed 2026-07-13`

**Where:** `guest-app/server/handlers/bookings.ts:1209-1253, 1372-1374, 1453` (`handleCreateWalkin`)

Unlike the public create path (Zod `guestDetailsSchema`), the staff walk-in
handler destructures the raw body. `totalPriceOverride` goes through
`Number(...)` with no NaN / negative / upper-bound guard — a non-numeric
value produces `NaN`, which survives `Math.max(NaN, 0)` (`NaN`) and is
**written to `totalPrice`**, after which every report sum that touches the
booking becomes `NaN`. Missing `guestDetails.firstName` throws a raw 500.
Payments are capped at ₱1,000,000 (S4); the walk-in override is uncapped.

**Impact:** one malformed staff request poisons every revenue figure on
the Reports page; no server-side sanity cap on manual pricing.

**Fix:** Zod-validate the walk-in body (mirror `guestDetailsSchema`;
`totalPriceOverride: z.coerce.number().finite().min(0).max(1_000_000).optional()`),
and reject NaN before the transaction.

**Remediation:** `WalkinBookingSchema` now strictly validates the complete
top-level request plus strict nested guest details before any transaction is
opened. It normalizes strings/email, coerces guest count and the optional
override, rejects unknown fields, and enforces finite, non-negative manual
pricing capped at 1,000,000. Schema regressions cover valid normalization,
NaN/non-numeric input, negative and oversized overrides, malformed guest
details, and unknown fields; handler ordering coverage proves validation runs
before Firestore.

---

## SEV-3 — Minor

### FL-08 — Points redemption doesn't rebuild `rateBreakdown` · `Fixed 2026-07-13`

**Where:** `guest-app/server/handlers/members.ts:348-356` (redeem), `:444-451` (undo)

Redeeming points updates `totalPrice` but leaves `rateBreakdown` untouched
(`buildRateBreakdown` already supports a `pointsRedeemedValue` deduction
line — it's just never called here). The receipt PDF renders breakdown
lines when present (`BookingsPage.tsx:1511-1523`); the points-redeemed row
only exists in the no-breakdown fallback branch (`:1549`). So for every
modern booking with redeemed points, the printed line items don't sum to
the printed Booking Total. Undo has the mirror-image problem.

**Impact:** receipts/folio previews — financial documents — show
internally inconsistent math; staff can't explain the gap to a guest.

**Fix:** rebuild the breakdown in both transactions (shared helper — see
Fix order #3).

**Remediation:** extracted shared server-side breakdown build/rebuild
helpers. Points redemption now adds the points deduction and corrected final
total inside the existing booking/member/history transaction; undo removes
that deduction and restores the final total in the same transaction. The
helper preserves locked room lines and all add-on labels, rebuilds every
deduction in canonical order, and leaves legacy no-breakdown bookings on
their documented fallback path. Transaction and pure-helper regressions
cover redeem, undo, discount stacking, and legacy behavior.

### FL-09 — Dead "Confirm Booking" button at `payment-confirmed` · `Fixed 2026-07-13`

**Where:** `admin-app/src/pages/BookingsPage.tsx:3542-3548` (button) vs `guest-app/server/handlers/bookings.ts:2144` (`allowedStatuses = ["pending", "payment-uploaded"]`)

The drawer offers `payment-confirmed → confirmed`, but the confirm API
only accepts `pending`/`payment-uploaded`, so the button always returns
*"Booking cannot be confirmed because its status is already
payment-confirmed."* Check-in works directly from `payment-confirmed`, so
the flow isn't blocked — but the advertised transition in the finance
status pipeline errors 100% of the time.

**Fix:** either add `payment-confirmed` to the server allow list (and skip
the duplicate booking-confirmed email if undesired) or remove the button.

**Remediation:** added `payment-confirmed` to the transactional confirmation
allow-list, matching the existing drawer action and documented state machine.
The transition fires the distinct booking-confirmed email once; direct
check-in from `payment-confirmed` remains supported.

### FL-10 — Early checkout truncates the stay but keeps the full price · `Open`

**Where:** `guest-app/server/handlers/bookings.ts:2346-2369` (`handleCheckoutBooking` truncation block)

Checking out mid-stay rewrites `checkOut`/`numNights` (preserving the
original in `earlyCheckoutOriginalCheckOut`) but leaves `totalPrice` and
`rateBreakdown` unchanged. If "no refund on early departure" is the
intended policy, that's defensible — but it's undocumented, and the side
effects are real: ADR/RevPAR retroactively inflate (same revenue over
fewer nights), the room-revenue proration basis changes, and the receipt
breakdown still describes the original date range with no marker.

**Fix:** record the policy in `DECISIONS-FEATURES.md` (owner input).
Regardless of policy outcome, rebuild `rateBreakdown` to reflect the
truncated stay (with an explicit "early checkout — original total
retained" adjustment line if the no-refund policy stands).

### FL-11 — Checkout awards loyalty points regardless of payment; balance gate is client-only · `Open`

**Where:** `guest-app/server/handlers/bookings.ts:2291-2327` (points calc), `admin-app/src/pages/BookingsPage.tsx:3590-3604` (two-click balance confirm)

Points are computed on `totalPrice` at checkout even when the folio
balance is fully outstanding, and the "balance still due" gate is a
client-side two-click confirm — the checkout API itself has no balance
awareness and leaves no record that a booking was checked out unpaid
(beyond the derived receivables row). Points also exclude incidental/store
spend — likely intended ("per-spend" on the room bill) but unconfirmed.

**Fix:** owner decision (points on unpaid folio? points on incidentals?)
→ `DECISIONS-FEATURES.md`; at minimum stamp `checkedOutWithBalance:
<amount>` on the booking during checkout so the audit trail is explicit.

### FL-12 — Dashboard revenue and Reports disagree on `payment-confirmed` · `Fixed 2026-07-13`

**Where:** `admin-app/src/pages/DashboardPage.tsx:98-100` vs `admin-app/src/pages/ReportsPage.tsx:404-409`

Dashboard monthly revenue counts `confirmed/checked-in/checked-out`;
Reports (post-FR-04) also counts `payment-confirmed`. A paid-but-not-yet-
confirmed booking checking in this month appears in one surface and not
the other. The dashboard help text documents its own basis, but the two
numbers won't tie out.

**Fix:** include `payment-confirmed` in the dashboard filter (align with
FR-04) and update the help text.

**Remediation:** Dashboard monthly revenue and its help text now include
`payment-confirmed`, matching the Reports revenue-eligible status basis.
Source-level regression coverage locks the filter and explanation together.

### FL-13 — Billed vs Collected use different period bases · `Open`

**Where:** `admin-app/src/pages/ReportsPage.tsx:494-511`

`billedTotal` counts the **full** `totalPrice` of any booking overlapping
the range (no proration — unlike `roomRevenue`), while `collectedTotal`
counts only payments **recorded inside** the range. A deposit taken before
`periodStart`, or a stay straddling a boundary, distorts the Outstanding /
Over-collected KPIs. The all-time Receivables table is computed correctly;
the period KPI is an unlabeled approximation.

**Fix:** either compute period Outstanding from the receivables engine
(billed-to-date − collected-to-date for bookings in range) or label the
KPI as period cash-flow ("billed in period vs received in period") — and
say which in `REPORTS.md`.

### FL-14 — No-shows with collected money are invisible · `Open`

**Where:** `admin-app/src/pages/ReportsPage.tsx:421-434` (past `confirmed` exclusion) vs `:513-532` (`cancelledWithCollections`)

Past-dated `confirmed` bookings (no-shows) are excluded from revenue, but
their payments still count in collections. Cancelled bookings got a
"retained payments" table (FIN-03); no-shows with deposits have no
equivalent surface — the money shows up only as unexplained
over-collection.

**Fix:** extend the cancelled-with-collections view to include no-show
bookings (past `confirmed`, never checked in, payments > 0), or fold
no-shows into an explicit status.

### FL-15 — Reports period boundaries use the browser's timezone · `Open`

**Where:** `admin-app/src/pages/ReportsPage.tsx:370-397` (`periodStart`/`periodEnd`/`isWithinSelectedRange`)

FR-01 fixed day-*grouping* to Manila, but the period window itself is
still built from browser-local midnight. An admin reviewing from another
timezone gets different booking/payment membership at the range edges than
the Manila-keyed Daily Close.

**Fix:** derive `periodStart`/`periodEnd` from Manila calendar days
(reuse `dateKeyInTimeZone`/`getManilaDateInfo`).

---

## SEV-4 — Nit / Polish

### FL-16 — `originalTotalPrice` semantics are inconsistent across writers · `Open`

**Where:** `bookings.ts:927` (online: `null` unless discount), `:1470` (walk-in: always set), `:1647` (apply-discount: overwritten)

Three writers, three conventions. Downstream readers each re-derive a
fallback (`ReportsPage.tsx:665`, receipt `:1537`), which works today but
is fragile — FL-03 is the first bug this ambiguity produced.

**Fix:** document one convention in `TYPES.md` (recommend: always set at
create = pre-discount subtotal) and backfill on write paths.

### FL-17 — Rules allow duplicate void reversals for one charge · `Open`

**Where:** `firebase/firestore.rules:54-77`

The reversal rule checks magnitude against the target charge but nothing
prevents a *second* reversal doc (different auto-id) voiding the same
charge. The client is safe (deterministic `void-{id}` doc id,
`BookingsPage.tsx:1969`), but the rules don't enforce it.

**Fix:** require the reversal doc id to equal `void-` + `voidOf` in the
rules so create-once semantics hold at the enforcement layer.

### FL-18 — Incidental charges have no upper bound · `Open`

**Where:** `firebase/firestore.rules:61-62` (`amount != 0` only), `BookingsPage.tsx:1938-1942`

Payments are capped at ₱1M server-side (S4); a fat-fingered ₱1B incidental
charge is accepted and skews receivables/billed totals.

**Fix:** mirror the 1M cap in the rules (`amount <= 1000000`) and the form.

### FL-19 — `add-payment` has no idempotency key · `Open`

**Where:** `guest-app/server/handlers/bookings.ts:1925-2055`

A double-submit / retried request records two identical payments (the
booking-create path solved this with pre-allocated doc ids). Client button
state mitigates but doesn't prevent network-level retries.

**Fix:** accept a client-generated payment id (mirror
`PREALLOCATED_BOOKING_ID_REGEX` pattern) and `create()` instead of
`set()` on a fresh doc.

### FL-20 — Receipt fallback folds the member discount into the Senior/PWD line · `Open`

**Where:** `admin-app/src/pages/BookingsPage.tsx:1537-1541`

The no-breakdown fallback computes the Senior/PWD amount as
`originalTotalPrice − totalPrice − voucher − points`, which silently
includes any member discount in the government-discount line — wrong
attribution on a document a guest may use for RA 9994/10754 purposes.

**Fix:** compute the Senior/PWD amount as `round(base × discountPct/100)`
and let any residual show as a separate "Member discount" line.

---

## Scope boundaries (reviewed, not opened as findings)

- **Early-checkin approval fee** — approving an early check-in does not
  auto-create an `early-checkin` incidental charge; staff add it manually
  from the folio form. Acceptable at current scale; revisit only if staff
  forget in practice.
- **Payments on cancelled/checked-out bookings** — `add-payment` allows
  them deliberately (receivables are settled after checkout); not a defect.
- **Server-side checkout without balance enforcement** — retained as a
  front-desk judgment call (see FL-11 for the audit-trail ask); hard
  server blocks would strand guests at the desk.
