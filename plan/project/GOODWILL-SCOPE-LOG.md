# Goodwill Scope Log — Features Delivered Beyond Schedule A

> Record of functionality built and delivered at no additional charge that is
> **not** listed in Schedule A Parts 1–3 of the Software Development Agreement
> (signed June 23, 2026). Under Part 4 of Schedule A, every item below would
> qualify as a change request requiring a separate written agreement and
> additional fees. They were delivered inside the fixed project fee as goodwill.
>
> Created: July 12, 2026 · Last updated: July 12, 2026 (FIN-05..FIN-13 moved
> from Queued to §1 Shipped — full finance audit queue delivered 07-11/07-12)
> · Maintained alongside `ROADMAP.md`
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
| ✅ | FIN-05 — Discounts & adjustments report | Gross→net revenue bridge (Senior/PWD, vouchers, points) + outstanding-points liability (shipped 2026-07-11) |
| ✅ | FIN-06 — VAT breakdown in reports & exports | 12% VAT / VATable / VAT-exempt (Senior/PWD) calculated client-side for the accountant's filings; no OR/invoice printing — decision #115 in `DECISIONS-FEATURES.md` (2026-07-11) |
| ✅ | FIN-07 — Daily Close view | Payments recorded today by method and staff for drawer/GCash handover reconciliation (shipped 2026-07-12) |
| ✅ | FIN-13 — Cash drawer count & variance | Per-method counted-amount entry vs. recorded payments, persisted as append-only daily close record (shipped 2026-07-12) |
| ✅ | FIN-09 — Revenue proration | Overlap-prorated revenue recognition; unpaid future bookings excluded (shipped 2026-07-12) |
| ✅ | FIN-10 — Occupancy night-clipping fix | Occupancy nights clipped to range boundaries incl. overlapping stays (shipped 2026-07-12) |
| ✅ | FIN-11 — Hotel finance KPIs | ADR, RevPAR, revenue-by-room-type split (shipped 2026-07-12) |
| ✅ | FIN-12 — Prior-period comparison | Vs-previous-period delta badges on revenue and booking KPI cards (shipped 2026-07-12) |

> FIN-08 (export column alignment, shipped 2026-07-11) is deliberately **not**
> listed here: the missing Breakfast/Discount/Voucher columns were a Schedule A
> §2.8 conformance fix (contracted scope); only the added Collected/Outstanding
> columns ride along as goodwill.

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

**Currently empty** (as of July 12, 2026). The entire FIN-05..FIN-13 queue
from the finance audit was subsequently built and delivered as goodwill on
July 11–12, 2026 — it is now recorded in §1 above. That absorption happened
before this log's rules took effect; from here on, any newly identified
out-of-scope item lands in this table first and per Part 4 must be **scoped,
quoted, and approved in writing** — or explicitly promoted to §1–§6 as
goodwill by a deliberate decision, not by default.

| Status | Item | Source |
|---|---|---|
| — | *(none)* | |

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
