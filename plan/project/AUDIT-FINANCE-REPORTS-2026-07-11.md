# Finance & Reports Audit — 2026-07-11

> Finance/audit-perspective review of the Reports & Metrics feature set:
> does the system contain everything needed to properly account for
> booking income, and what is missing for the finances to be fully
> tracked? Read-only at audit time — no code changes made.
>
> Workspace: staybase
> Audited: 2026-07-11 (branch `dev`, HEAD `cfa6084`)
> Method: read-only — reviewed `plan/features/REPORTS.md`,
> `plan/features/BOOKINGS-MANAGEMENT.md` (payments/folio flow),
> `admin-app/src/pages/ReportsPage.tsx` (full implementation),
> `shared/types/index.ts` (Booking model), and
> `shared/constants/index.ts` (statuses).
>
> **Convention:** findings are numbered `FIN-<n>`. Severity matches prior
> audits (`SEV-1` critical → `SEV-4` nit). Status is `Open` until the
> remediation branch updates this doc with the fix and verification.

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 0 | **0** |
| **SEV-2 (major)** | 0 | 4 | **4** |
| **SEV-3 (minor)** | 2 | 4 | **6** |
| **SEV-4 (nit / polish)** | 4 | 0 | **4** |
| **Total** | **6** | **8** | **14** |

Two further gaps were reviewed and deliberately **scoped out** rather than
opened as findings — see §Scope boundaries (expenses/P&L, day-locking).

**Verdict:** the system tracks **billed revenue** (accrual side) well, but
it barely tracks **money actually received** (cash side). Everything on
the Sales tab derives from `booking.totalPrice`, while the record of real
cash movement — the `bookings/{id}/payments` subcollection — is only ever
read by the admin-only Full Backup export, never by any report. A finance
person today cannot answer *"how much did we actually collect this month,
by method?"* from the Reports page.

No SEV-1s: nothing computes a *wrong* billed-revenue number for the data
it claims to report. The SEV-2s are structural blind spots — whole
categories of financial activity (collections, receivables, refunds) that
exist in operations but are invisible to every report.

### What's already solid

- Revenue consolidated across all three streams (rooms, breakfast, store)
  with a stacked monthly view and consistent period filtering.
- Cancelled bookings and undelivered store orders correctly excluded from
  revenue; "Add to Bill" store orders flagged as uncollected in the
  payment-method chart.
- Per-booking onsite payments carry an audit trail (`amount`, `method`,
  `note`, `recordedBy`, `recordedAt`); checkout folio computes balance
  due and warns on unsettled checkout.
- Full Backup includes Total Collected Onsite + Outstanding Balance per
  booking, and a dedicated Payments sheet.
- **Payment records are append-only at the rules level**
  (`firebase/firestore.rules:48-51` — `allow update, delete: if false`
  on `bookings/{id}/payments`): nobody can edit or erase a recorded
  payment after the fact. This is the single most important integrity
  control for cash monitoring, and it is already in place. FIN-03's
  refund design must preserve it (refunds are new signed entries, never
  edits to existing ones).
- Custom date ranges and CSV / Sales XLSX / print exports all read from
  the same `periodStart`/`periodEnd`, so figures agree across surfaces.

### Fix order

1. FIN-01 + FIN-02 (collections report — one feature closes both)
2. FIN-04 (receivables / AR view, incl. corporate charge-back)
3. FIN-03 (refund model)
4. FIN-05 (gross-to-net discounts report)
5. FIN-06 (BIR/VAT decision — needs owner input, log in DECISIONS-FEATURES.md)
6. FIN-07 + FIN-13 (daily close incl. drawer variance — build together;
   falls out of the FIN-01 collections work)
7. FIN-14 (incidental charge ledger — before or with FIN-01, so the
   "billed" side of the reconciliation is complete)
8. FIN-08..FIN-12 (SEV-3/4 batch — export columns, recognition quirks, KPIs)

---

## SEV-2 — Major

### FIN-01 — No collections (cash-basis) report · `Fixed 2026-07-11`

**Where:**
- `admin-app/src/pages/ReportsPage.tsx` (Sales tab — all KPIs derive from `totalPrice`)
- `bookings/{id}/payments` subcollection (read only by Full Backup, `ReportsPage.tsx` `runFullBackupExport`)

Every figure on the Sales tab is billed/accrual revenue: sum of
`booking.totalPrice` for confirmed/checked-in/checked-out bookings whose
`checkIn` falls in the period. What was *actually received* lives in the
`bookings/{id}/payments` subcollection — amount, method, note,
`recordedBy`, `recordedAt` — and no report reads it. A guest who booked
"pay at hotel," checked out, and never settled still counts as full
revenue with zero visibility that the money is missing.

**Impact:** finance cannot reconcile revenue against bank/GCash/cash
receipts for any period; the primary financial report overstates money
in hand.

**Fix:** new "Collections" section or sub-tab in Sales: query payment
entries with `recordedAt` in the period, group by day / method / staff,
and show a "billed vs collected vs outstanding" reconciliation line
against the existing revenue totals.

---

### FIN-02 — Payment-method breakdown reports billed totals, not payments · `Fixed 2026-07-11`

**Where:** `admin-app/src/pages/ReportsPage.tsx:234` (`combinedPaymentMethods`)

The payment-method pie attributes each booking's **entire `totalPrice`**
to the single `booking.paymentMethod` chosen at booking time. A guest who
selected GCash but actually paid in two cash installments at the desk —
or never paid at all — still shows as "GCash: ₱X." The chart reads like a
cash-by-method report but is a booking-preference report.

**Impact:** "GCash: ₱X" in the report is not the amount received via
GCash; method-level reconciliation against GCash/bank statements is
impossible.

**Fix:** drive the breakdown from actual payment entries (per FIN-01).
Keep the booking-preference view if useful, but label it as such. Split
"Add to Bill" into collected vs. not-yet-collected using folio settlement.

---

### FIN-03 — Refunds are not modeled anywhere · `Fixed 2026-07-11`

**Where:**
- `shared/types/index.ts` (no refund type; payments have no sign/type convention)
- `admin-app/src/pages/ReportsPage.tsx:143` (`revenueBookings` excludes `cancelled` entirely)
- `plan/features/BOOKINGS-MANAGEMENT.md:212,220` (reschedule notes "guest is due a ₱X refund" with no record)

A cancelled booking disappears from revenue even if a GCash deposit was
already collected — money came in and no report has a line for it.
Reschedule downgrades explicitly surface "guest is due a ₱X refund" but
nothing records whether it was paid back. There is no refund record type,
no negative-payment convention, and no approval trail.

**Impact:** collected-then-cancelled money is untracked (audit exposure);
refund liabilities are invisible; staff refunds have no paper trail.

**Fix:** add a refund entry (signed amount or `type: "refund"` on the
payments subcollection) with `reason` + `approvedBy`; surface refunds in
the booking drawer and the FIN-01 collections report; add a "cancelled
bookings with money collected" view.

---

### FIN-04 — No accounts-receivable view; corporate charge-back has no invoicing · `Fixed 2026-07-11`

**Where:**
- Outstanding balance exists only per-booking (drawer) and in Full Backup (`ReportsPage.tsx` `runFullBackupExport`)
- `storeOrders.isBilled` (add-to-bill) has no aging/uncollected report
- Corporate charge-back bookings (`isCorporate`, `companyName`) have no invoice or AR record at all

There is no report listing checked-out bookings with unpaid balances,
uncollected "Add to Bill" store charges, or amounts owed by corporate
clients under charge-back arrangements. For a hotel actively courting
corporate accounts, receivables from companies are a real income stream
with zero tracking.

**Impact:** uncollected income silently ages out; no one is prompted to
chase balances; corporate billing is entirely manual and unrecorded.

**Fix:** "Receivables" report: (a) checked-out/no-show bookings with
`totalPrice − sum(payments) > 0`, aged; (b) delivered add-to-bill store
orders not yet settled through a folio; (c) a minimal corporate invoice
record (company, bookings covered, amount, issued/paid dates) for
charge-back bookings.

---

## SEV-3 — Minor

### FIN-05 — No gross-to-net discounts & adjustments report · `Fixed 2026-07-11`

**Where:** per-booking fields exist (`originalTotalPrice`, `discountType`,
`discountPct`, `voucherDiscount`, `pointsRedeemed`, `pointsRedeemedValue`
— `shared/types/index.ts:186-227`) but are never aggregated.

No report answers: total senior/PWD discounts granted (needed at tax time
— RA 9994 / RA 10754 allow claiming these as deductions), total voucher
cost, total points redeemed as payment, or the outstanding-points
liability across members.

**Fix:** "Discounts & Adjustments" section: gross revenue → senior/PWD →
vouchers → points → net bridge for the period; plus an
outstanding-points-liability stat (sum of `members.rewardsPoints` ×
redemption rate).

---

### FIN-06 — No tax/BIR layer; the scope decision is unrecorded · `Fixed 2026-07-11`

**Where:** no VAT/tax fields anywhere in `shared/types/index.ts`; no
mention in `plan/docs/DECISIONS-FEATURES.md`; jsPDF receipts are not
sequential official receipts.

There is no VAT computation, no VAT-exempt sales tracking (senior/PWD
sales are VAT-exempt in PH), and no OR numbering. This may be a
deliberate "out of scope — hotel handles BIR manually" decision, but it
is not written down anywhere.

**Fix:** decide with the owner and log the decision in
`plan/docs/DECISIONS-FEATURES.md`. If in scope: add VAT-able vs. exempt
tagging per transaction, a VAT summary on the Sales report, and
sequential receipt numbering.

---

### FIN-07 — No daily close / shift reconciliation report · `Open`

**Where:** payment entries already store `recordedAt`, `method`,
`recordedBy` — no surface aggregates them per day/shift.

Front desk has no end-of-day view of "payments recorded today, by method
and by staff member" to reconcile against the cash drawer and GCash
account before handover.

**Fix:** a "Daily Close" view (date picker, default today): payments by
method and by `recordedBy`, plus refunds (once FIN-03 lands). Falls out
almost for free from the FIN-01 collections query.

---

### FIN-08 — Export column gaps and inconsistencies · `Fixed 2026-07-11`

**Where:**
- Sales XLSX Bookings sheet (`ReportsPage.tsx:600-612`) omits the Breakfast, Discount, and Voucher columns the spec requires (`plan/features/REPORTS.md §Bookings sub-table`)
- Neither the ranged CSV nor the Sales XLSX includes Total Collected / Outstanding Balance — those exist only in the admin-only Full Backup
- The on-screen Bookings sub-table (`ReportsPage.tsx:1513-1521`) is thinner still: no payment method, discount, or voucher columns

**Impact:** the date-ranged exports — the finance person's main working
files — cannot reconcile billing vs. collections or discounts without
pulling the all-time Full Backup.

**Fix:** add Discount, Voucher, Breakfast, Total Collected, and
Outstanding Balance columns to the Sales XLSX Bookings sheet (collected
figures require the FIN-01 payments query); align the CSV and on-screen
table with the spec's column list.

---

### FIN-13 — Daily Close has no physical drawer count / cash variance entry · `Open`

**Where:** extension of FIN-07 (no drawer-count surface exists anywhere;
payment entries record what staff *typed*, not what was *counted*)

The FIN-07 Daily Close shows payments *recorded* per method and staff
member, but there is nowhere to enter what was physically counted in the
cash drawer (and confirmed in the GCash account) at shift end. Without a
counted-amount entry, over/short conditions are undetectable — recorded
₱5,000 cash with ₱4,700 in the drawer looks identical to a clean day.

**Impact:** the daily reconciliation loop cannot be closed; cash leakage
(errors or theft) is invisible until it is large enough to notice by
accident.

**Fix:** build with FIN-07, not after it: add a per-method "counted
amount" input to the Daily Close view (cash drawer count, GCash balance
check), persist it as a daily close record (`date`, per-method expected
vs counted, variance, `closedBy`, optional note), and show the variance
line prominently. Keep the close record append-only like payments —
corrections are a new entry, not an edit.

---

### FIN-14 — No incidental / ad-hoc charge ledger on the folio · `Fixed 2026-07-11`

**Where:**
- `admin-app/src/pages/BookingsPage.tsx:1659` (`getBookingFolio` — folio = `booking.totalPrice` + add-to-bill store orders, nothing else)
- `guest-app/server/handlers/bookings.ts:132` (`rateBreakdown.addOns` only ever holds the breakfast line — display breakdown, not an open ledger)

The folio is a closed list: room + breakfast (locked at creation) plus
delivered add-to-bill store orders. There is no mechanism to charge
anything else — late checkout, early check-in fee, extra person/bed,
damages, lost key, laundry. The only in-system workaround is abusing the
store (a fake "Damage Fee" catalog item), which pollutes store revenue,
top-selling-items, and inventory reporting; the realistic outcome is
staff collecting incidentals outside the system entirely.

**Impact:** the mirror image of the at-desk discount gap — there,
billed > collected looked normal; here, collected > billed is invisible.
Incidental income is understated or untracked, and once FIN-01/FIN-13
land, every off-book incidental collection shows up as an unexplained
cash *overage*.

**Fix:** `bookings/{id}/charges` subcollection mirroring the payments
pattern — `{ label, amount, category, note, addedBy, addedAt }`,
append-only at the rules level (void = reversal entry, never delete),
"Add charge" form in the drawer folio section, folio `grandTotal`
extended to include it. Full wiring checklist (folio, receipts, reports,
exports, FIN-01/03/04 integration):
`plan/features/BOOKINGS-MANAGEMENT.md §Implementation Plan — Incidental
Charges (Folio Charge Ledger)`.

---

## SEV-4 — Nit / Polish

### FIN-09 — Revenue recognition quirks · `Open`

**Where:** `ReportsPage.tsx:150-153` (`rangeBookings` filter), `:211-219` (`monthlyRevenue`)

(a) A booking's entire total is attributed to its check-in month —
multi-month stays are not prorated (minor at this property's typical stay
length, worth a note on the report). (b) A custom range extending into
the future counts `confirmed` not-yet-stayed bookings as revenue —
unearned income mixed with earned. Consider labeling future-dated
check-ins as "upcoming/unearned" or excluding them with a toggle.

---

### FIN-10 — Occupancy % counts nights outside the selected range · `Open`

**Where:** `ReportsPage.tsx:651-657` (`totalRoomNights` / `avgOccupancyPct`)

The numerator sums each in-range booking's full `numNights` even when
nights fall outside the range, and misses stays that began before the
range but overlap it. The denominator uses range days. Occupancy % is
therefore skewed in both directions — and will distort RevPAR if FIN-11
is built on the same numbers. Fix: clip each booking's nights to the
selected range and include bookings overlapping (not just starting in)
the range.

---

### FIN-11 — Missing standard hotel finance KPIs (ADR, RevPAR, revenue by room type) · `Open`

**Where:** `ReportsPage.tsx` Performance/Sales tabs

All derivable from existing data: ADR = room revenue ÷ occupied
room-nights; RevPAR = room revenue ÷ available room-nights; revenue
split by `roomType`. Cheap to add once FIN-10's night-clipping is fixed.

---

### FIN-12 — No prior-period comparison · `Open`

**Where:** `ReportsPage.tsx` (all KPI cards)

KPI cards show absolutes only — no vs-previous-period or vs-same-period-
last-year deltas, so trends require manual export diffing. Add a
"vs previous period" delta line to the revenue KPI cards (previous window
of equal length immediately before `periodStart`).

---

## Scope boundaries — reviewed and deliberately NOT opened as findings

Raised during the 2026-07-11 review of whether the FIN list is enough to
monitor daily financial operations. Verdict: **with FIN-01..FIN-13 built,
the system is sufficient for daily *income* operations monitoring; the
two items below are consciously left outside the system.** Recorded here
so the decision isn't re-litigated from scratch later.

### Expenses & P&L — out of scope (external bookkeeping)

The system tracks zero expenses — no payroll, utilities, supplies, or
commissions — so it can never report *profit*, only income. This is
intentional: it is a booking/PMS system, not accounting software. The
supported pattern is the exports (Sales XLSX, Full Backup, and the
FIN-01 collections report once built) feeding an external accountant or
bookkeeping tool monthly; BIR filing needs proper books anyway. Building
expense tracking into the admin app would be significant scope for
something better handled outside it. Revisit only if the owner
explicitly asks for in-app P&L.

### Day-locking / night audit — deferred at current scale

Bookings remain staff-editable after the fact
(`firebase/firestore.rules` — `allow update: if isStaff()` on
`bookings/{id}`), so a historical day's *billed revenue* figure can
shift if someone edits an old booking. Payments being append-only
mitigates the cash side, which is what matters most for daily controls.
A classic night-audit day-lock (nightly immutable snapshot of the day's
figures) is overkill for a 14-room property today. Trigger to revisit:
the owner suspects historical figures are drifting, or staff headcount
grows beyond a trusted-few. The cheap version when needed: a nightly
snapshot document per day (billed, collected, by stream/method) written
once and never updated.

---

## Recommended feature list (mapped to findings)

| # | Feature | Closes | Effort |
|---|---|---|---|
| 1 | **Collections report** — payments by day/method/staff + billed-vs-collected reconciliation | FIN-01, FIN-02, most of FIN-07 | M |
| 2 | **Receivables report** — unpaid checked-out balances (aged), add-to-bill aging, corporate invoice record | FIN-04 | M |
| 3 | **Refund model** — refund entry with reason + approvedBy, surfaced in drawer + collections | FIN-03 | S–M |
| 4 | **Discounts & adjustments report** — gross→net bridge, points liability | FIN-05 | S |
| 5 | **BIR/VAT decision** logged in DECISIONS-FEATURES.md (+ fields if in scope) | FIN-06 | Decision + M if in scope |
| 6 | **Daily Close view incl. drawer count + variance** | FIN-07, FIN-13 | S–M (after #1) |
| 7 | **Incidental charge ledger** — `bookings/{id}/charges` subcollection, drawer form, folio/receipt/report/export wiring | FIN-14 | M |
| 8 | **Export/table column alignment** — Collected/Outstanding/Discount/Voucher/Breakfast columns | FIN-08 | S |
| 9 | **KPI pack** — ADR, RevPAR, revenue by room type, prior-period deltas, occupancy night-clipping | FIN-09..FIN-12 | S |

Out of scope by decision (see §Scope boundaries): expenses/P&L (external
bookkeeping), night-audit day-locking (deferred at current scale).

---

## References

- Reports spec: `plan/features/REPORTS.md`
- Payments/folio flow: `plan/features/BOOKINGS-MANAGEMENT.md §Additional Payments / §Checkout folio`
- Booking model: `plan/docs/TYPES.md` / `shared/types/index.ts`
- Roadmap entry: `plan/project/ROADMAP.md §Finance & Reports Audit — 2026-07-11`
