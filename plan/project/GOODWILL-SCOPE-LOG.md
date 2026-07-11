# Goodwill Scope Log — Features Delivered Beyond Schedule A

> Record of functionality built and delivered at no additional charge that is
> **not** listed in Schedule A Parts 1–3 of the Software Development Agreement
> (signed June 23, 2026). Under Part 4 of Schedule A, every item below would
> qualify as a change request requiring a separate written agreement and
> additional fees. They were delivered inside the fixed project fee as goodwill.
>
> Created: July 12, 2026 · Maintained alongside `ROADMAP.md`
> Status key: ✅ Shipped | 🔄 In Progress | ⬜ Queued (not yet started)

---

## Purpose of this document

1. **Acceptance protection** — at Final Delivery review, this log separates
   contracted scope (Schedule A) from voluntary extras, so unfinished *extras*
   can never be held against the final ₱15,000 milestone.
2. **Client-relations record** — a concrete, itemized statement of value
   delivered beyond the ₱60,000 engagement, usable as an annex when presenting
   the Final Delivery package.
3. **Phase 2 pricing basis** — queued items (see §Queued) should be scoped and
   quoted as paid change requests per Part 4, not silently absorbed.

**Contract references:**
- Schedule A Part 4: *"Any feature not described in Parts 1, 2, and 3 of this
  Schedule"* is out of scope; requests for unlisted items require a separate
  written agreement and additional fees.
- Agreement §2 (Timeline): the MVP launch target is contingent on *"no scope
  additions introduced after Milestone 1 without a written timeline
  adjustment"* — goodwill items consume that protection.

---

## 1. Finance & Accounting Suite

Schedule A §2.8 requires only: occupancy chart, bookings-by-source chart,
summary stat cards, a Sales tab (Total / Room / Breakfast / Store revenue,
Total Transactions), PDF export, and a bookings XLSX export. Everything below
is bookkeeping infrastructure beyond that — and Part 4 explicitly excludes
accounting-software territory.

| Status | Item | Notes |
|---|---|---|
| ✅ | FIN-01 — Collections (cash-basis) report | Billed vs. collected vs. outstanding reconciliation from actual payment entries (shipped 2026-07-11) |
| ✅ | FIN-02 — Payment-method breakdown from actual payments | Replaces booking-time attribution; splits Add-to-Bill collected vs. uncollected (2026-07-11) |
| ✅ | FIN-03 — Refund ledger | Append-only, admin-approved refund entries with reason + approver; cancelled-with-money-collected view (2026-07-11) |
| ✅ | FIN-04 — Receivables & aging report | Aged unpaid balances + corporate charge-back invoice register (2026-07-11) |
| ✅ | FIN-14 — Incidental charge ledger | Append-only folio charges (late checkout, damage, laundry, …) wired through folio, receipts, reports, exports *(owner request 2026-07-11)* |
| ✅ | Payments subcollection & recording workflow | Per-booking payment entries with method/staff stamps — prerequisite for all of the above; not in Schedule A |

## 2. Front-Desk Operations

| Status | Item | Notes |
|---|---|---|
| ✅ | Early check-in request & approval workflow | Request persisted on booking, approve/decline from drawer, guest emails, My Stays status |
| ✅ | Check-in gate | Enforced guest ID photo, registration fields, and signature before check-in — Schedule A has no registration/signature capture; Part 4 lists guest ID verification as out of scope |
| ✅ | Room transfer / upgrade & reschedule | Server-authoritative re-pricing, room status sync, price delta display |
| ✅ | Post-booking discount & voucher application | Staff apply Senior/PWD or voucher at/before check-in; walk-in modal discount fields *(owner request 2026-07-11; supports RA 9994 / RA 10754 compliance)* |
| ✅ | Senior/PWD online-booking toggle | Admin control over the online self-service discount path *(owner request 2026-07-11)* |
| ✅ | OSCA/PWD discount ID upload | Schedule A requires only an eligibility-confirmation checkbox |
| ✅ | Itemized rate breakdown snapshots | Per-night regular/weekend/holiday lines across guest UI, emails, drawer, receipt PDFs |

## 3. Rates & Calendar

Schedule A §2.5 covers base, weekend, flat corporate, and breakfast rates only.

| Status | Item | Notes |
|---|---|---|
| ✅ | Seasonal / holiday rate overrides | Date-ranged rate exceptions per room type |
| ✅ | Rate Calendar | Month-based room-type × date grid with multi-select seasonal editing and holiday labels |
| ✅ | Bookings calendar view | Visual room × date grid (`/calendar` page) with date-ranged room blocks |

## 4. Intercom Voice Calls

Schedule A §1.6 / §2.9 specify text chat and quick-request chips only.

| Status | Item | Notes |
|---|---|---|
| ✅ | Two-way voice calling | Guest-to-front-desk calls with accept / decline / end |
| ✅ | Ringtones & admin-wide call popups | Synthesized ringtone, call/message popups on every admin page |
| ✅ | Call log retention | Server-side call record cleanup |

## 5. Email & Notifications

Schedule A §3.1 requires 5 automated emails (booking submitted / payment
confirmed / booking confirmed / cancellation / corporate inquiry).

| Status | Item | Notes |
|---|---|---|
| ✅ | ~8 additional email templates | Check-in reminder, discount-rejected, reschedule, early check-in pair, voucher-issued, store-order status set, staff new-booking/new-payment alerts |
| ✅ | Email preview interface | Authenticated server-rendered previews of all templates in Settings |
| ✅ | Real-time audio alerts | Web Audio notifications for new bookings, pending payments, messages, arrivals, departures |

## 6. Marketing, Content & Misc.

| Status | Item | Notes |
|---|---|---|
| ✅ | SEO & Open Graph package | robots, sitemap, per-route meta, JSON-LD, OG image, link-preview cards (Phase 11.9) — absent from Schedule A |
| ✅ | Terms of Service page | Schedule A lists only the Privacy Policy |
| ✅ | Guest account self-deletion | RA 10173 erasure flow (legally prudent, but not a Schedule A line item) |
| ✅ | Dashboard intercom widget & unread stats | Live thread preview + unread metric card |
| ✅ | Breakfast menu (silog) CRUD | Menu item management in Settings |
| ✅ | Store stock tracking | Stock decrement on confirmed orders — borderline vs. Part 4's inventory-management exclusion |
| ✅ | Image preview modals | Receipts / guest IDs in booking flow and admin drawer |
| ✅ | Full backup XLSX export | Admin-only all-collections workbook |
| ✅ | Offline fallback page | Workbox offline navigation fallback beyond the PWA baseline |

---

## Queued — do NOT absorb silently

These are identified but unbuilt. Per Part 4 they should be **scoped, quoted,
and approved in writing** (or explicitly logged here as further goodwill by a
deliberate decision, not by default):

| Status | Item | Source |
|---|---|---|
| ⬜ | FIN-05 — Discounts & adjustments report (gross→net bridge, points liability) | Finance audit 2026-07-11 |
| ⬜ | FIN-06 — BIR/VAT scope decision (+ fields if in scope) | Finance audit 2026-07-11 |
| ⬜ | FIN-07 — Daily Close view | Finance audit 2026-07-11 |
| ⬜ | FIN-08 — Export column alignment | Finance audit 2026-07-11 — *note: partially a Schedule A §2.8 conformance item (missing spec'd Breakfast/Discount/Voucher columns); the column fix is contracted scope, the collected/outstanding additions are not* |
| ⬜ | FIN-09..FIN-13 — revenue recognition, occupancy clipping, ADR/RevPAR KPIs, prior-period deltas, drawer variance | Finance audit 2026-07-11 |

---

## Rules for maintaining this log

- Add an entry **before** starting any feature not traceable to a Schedule A
  Part 1–3 line item; note the source (owner request / developer initiative /
  audit finding) and date.
- If an owner request arrives, decide explicitly: goodwill (log it here) or
  change request (scope + quote per Part 4). Silence defaults to *neither* —
  the request waits.
- Compliance-driven work (RA 9994 / RA 10754 / RA 10173) may be delivered as
  goodwill by default, but still gets logged.
- This log is internal by default. Share the shipped-items tables (§1–§6) with
  the Client at Final Delivery as a value annex; the §Queued table is the
  Phase 2 proposal seed.
