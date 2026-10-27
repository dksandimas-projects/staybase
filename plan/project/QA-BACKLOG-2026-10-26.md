## Handoff Backlog — Wave 2–5 defects not covered by the 2026-10-23 QA report (audited 2026-10-26)

> **Why this section exists.** The QA report ([`QA-REPORT-2026-10-23.md`](plan/project/QA-REPORT-2026-10-23.md)) closed as *"no findings remain open"*. That verdict was true **inside the scope of its own scenario catalogue** (`QA-SCENARIOS.md`, 108 ids). But [`HANDOFF-2026-10-23.md`](plan/project/HANDOFF-2026-10-23.md) §6 carried a separate list of **~27 defects confirmed against production** in "Waves 2–5 of please fix all" — and 25 of those ids appear **nowhere** in the QA report. Two of them were **live money-permission holes in the deployed code** and have now been fixed (see the closed table below).
>
> **The process gap this section closes:** a report scoped to its own catalogue will not contain defects tracked under a different id-prefix in a different document, and its closing verdict is scoped exactly as narrowly as its catalogue. Nothing reconciled the two lists. This section is that reconciliation, so the next report starts from the union.

### ✅ Closed since the QA report (verified against live production)

| ID | Defect | Fix | Proof in production |
|---|---|---|---|
| **SEC-3** | Front-desk could redeem rewards points — `POST /api/members/redeem-points` checked only "is this staff?", and `authenticateStaff` admits **both** `admin` and `front-desk`. The admin UI hid the panel; the **server** did not enforce it. | The gate is now on the **server**: `if (authResult.role !== "admin") → 403`. | Front-desk token → **HTTP 403** `"Only admins can apply points redemptions."` · admin token → **HTTP 400** (reaches the handler). Deployed `v2.21.1`. |
| **SEC-4** | No admin gate on the corporate convert path — a front-desk client could create a priced corporate booking and flip the inquiry status. | Same shape, same fix. | Front-desk token → **HTTP 403** `"Only admins can convert corporate inquiries into bookings."` |
| **§3.7 rules** | The Firestore rules still let a staff client write a store order's `status` directly, bypassing the server's tender guard. | `allow update: if isStaff() && !…affectedKeys().hasAny(["status"])`. The other fields stay staff-writable (the desk's "bill to room" is a legitimate client write). | Live ruleset re-read from the Firebase Rules API and compared to the repo file: **byte-identical**, guard present. |
| **H8** | No nightly money reconciliation. | `POST /api/reconciliation/run`, scheduled `30 4 * * *`, `CRON_SECRET`-gated, **read-only** with respect to the money. It recomputes every money figure from the raw documents with its own arithmetic. | The guest project now runs **6 crons** (was 5). Unauthenticated call → **HTTP 401**. |

> **H8 is the standing check.** It is the check that would have caught the settled-state refund (§3.23) and the add-on allocation gap (§3.4) before a guest was affected. It also runs the same 17-check reconciliation the QA pass used, nightly, against production.

### ⬜ Still open — verified live against production on 2026-10-26

Each of these was re-checked against the **live deployment** today, not read off a document.

| ID | Defect | Verified live | Sev |
|---|---|---|---|
| **F-A4** | Two backup rows carry a **negative** "Outstanding Balance". | The reconciliation's own **I08** now finds **3** over-collected bookings (`SI-20261021-00006` −₱200, `-00061` −₱100, `-00060` −₱100). All are QA fixtures, so no real money is wrong — but the backup shows a negative balance. | S3 |
| **F-A6** | The staging-refresh import points at `scripts/export-prod-data.mjs`, which **does not exist** — and the path is quoted in **user-visible UI text** (`SettingsPage.tsx:9434`). | File confirmed absent; the UI still names it. | S3 |
| **F-B3** | Reports → "Daily Kitchen Prep" disagrees with the bookings it summarises — bare `<date>-N` slot keys contribute nothing, it does not filter `removedAt`, and it derives dates from `checkIn + numNights` instead of the slot keys. | Confirmed unchanged: the date loop is still `for (let i = 0; i < b.numNights; i++) { const date = toDate(b.checkIn); … }` (`ReportsPage.tsx:1510`). | S2 |
| **F-B5** | The kitchen list **cannot tell guests apart** — it resolves a name from the booking's `guests[]` array. | **0 of 157** production bookings have a `guests[]` array. (All 157 carry a single top-level `guestName`, so the list falls back to it.) | S2 |
| **F-C3** | The **Low Stock Alerts** panel lists **soft-deleted** items — a retired product still raises a purchasing flag. | **1 retired item, `stock=3`, `isActive=false`** still raises the flag. | S3 |
| **F-C4** | The store report has **no export**, although `plan/features/STORE-MANAGEMENT.md` line 84 is checked `[x] Export store report as CSV`. | No store CSV export in `ReportsPage.tsx`. | S3 |
| **F-D3** | `scripts/finance-integrity-scan.ts` covers the pricing invariants and **none of the ledger ones** — it never scans the `payments` / `refunds` / `charges` collections. | The scanner reads only the pricing side. (Note: the **nightly reconciliation cron** added in this session DOES cover the ledger — I05/I06/I07 all PASS against production. The gap is in this one script only.) | S2 |
| **F-D4** | Bookings where money was taken but the books do not close. | The reconciliation's **I08** (over-collected) and **I14** (cancelled bookings holding money) both still WARN. All are QA fixtures — no real money is wrong — but the arithmetic is. | S3 |
| **RPT-18** | A **₱0 store order can never be delivered** — `handleDeliverStoreOrder` rejects `totalAmount <= 0` with a 409. | Guard still present (`guest-app/server/handlers/store.ts:108`). | S3 |
| **RPT-2** | "Charge after checkout" is **UI-only** — the server does not enforce it. | No `chargeAfterCheckout` reference exists anywhere under `guest-app/server/` — the server never reads the setting. | S2 |
| **RPT-5** | The corporate path writes `paymentMethod:"chargeback"`. | Still there: the schema still `.default("chargeback")` (`corporate-inquiries.ts:76`) and the write still records `billingArrangement: "chargeback"` (`:585`). | S3 |
| — | `booking-confirmed` returns 401 for guests (the email-link path is broken). | Confirmed live: `POST /api/email/booking-confirmed` with no auth → **HTTP 401**, while the public `booking-submitted` → **HTTP 400** (reaches validation). `"booking-confirmed"` is in BOTH `staffOnlyEmailActions` and `publicEmailActions`; staff-only wins. | S2 |
| **NO-ID-A67** | The guest bed-setup choice is only offered for **one** room type. | Confirmed: **1 of 5** live room types has a non-empty `bedSetupValues`. | S3 |
| **NO-ID-A68** | Validation errors raised inside the create/booking transaction surface as **HTTP 500, not 400**. | The **schema** parse is a 400 (`bookings.ts:1725`). The item is about errors raised *inside* the transaction — that path is still unverified. | S2 |
| **NO-ID-A69** | `createBookingSchema` is `.strict()` with no `testRunId`/`isTestData`, so a guest booking cannot be tagged as test data (the walk-in schema can). | Confirmed: the schema still closes with `}).strict();` (`bookings.ts:1669`) and carries no `testRunId`/`isTestData` field. | S3 |

### Wave status at a glance (re-verified 2026-10-26 against the live deployment)

| Wave | Scope | Closed | Still open |
|---|---|---|---|
| **Wave 2** | role gates + payment semantics (8 items) | **SEC-2**, **SEC-3**, **SEC-4**, **RPT-3**, **RPT-6** | RPT-2, RPT-5, `booking-confirmed` |
| **Wave 3** | backup + reporting cluster (15 items) | **F-A2**, **F-A3**, **F-A5**, **F-C1**, **F-C2**, **RPT-19** | F-A4, F-A6, F-B3, F-B5, F-C3, F-C4, F-D3, F-D4, RPT-18 |
| **Wave 4** | data, misc + the nightly cron (5 items) | **H8**, **SR-05** | NO-ID-A67, NO-ID-A68, NO-ID-A69 |
| **Wave 5** | owner-gated / physically impossible (10 items) | — | all 10 — **by design**; they need a real inbox, a physical printer, a real device, or the Firebase Console |

\* **NO-ID-A68** is **partly** fixed: the schema layer now returns 400 (`bookings.ts:1725`); the in-transaction half is still open. **RPT-3**, **RPT-6**, **SR-05**, **F-C1**, **F-C2** and **RPT-19** were re-verified as **already fixed** — the earlier triage had simply not reached a verdict on them.

**Net: 13 of 28 code-verifiable items are closed. 15 remain open. Wave 5 (10 items) is untouched by design.**

The two closed items that were **live money-permission holes** (SEC-3, SEC-4) are the important ones: both are now enforced **on the server**, proven with a real front-desk token (HTTP 403) and a real admin token (reaching validation).

**What is still open is still mostly BACKUP and REPORTING** — 9 of the 15 open items are in Wave 3. The remaining backup items are F-A4 (a negative outstanding balance on 3 QA-fixture bookings) and F-A6 (the staging-refresh import names a script that does not exist). **No open item can lose a guest's money, turn them away, or touch a guest's data** — the last S1 (SEC-2) is now closed and proved live.

### ✅ Closed since the QA report (re-verified 2026-10-26 against the live deployment)

These were already fixed; the earlier triage had simply not reached a verdict. Now confirmed:

| ID | Defect | How it is closed (verified) |
|---|---|---|
| **RPT-6** | `paymentRejectedBy` is always null. | The handler now stamps it: `const paymentRejectedBy = req.staff?.uid \|\| "staff";` (`bookings.ts:7544`) and writes it at `:7655`, `:7689`, `:7712`. |
| **RPT-3** | The room-occupancy gate is not date-scoped — a block covers the whole range. | The gate is now a **date-scoped overlap test** for all three sources — bookings, `roomBlocks` and `staffInventoryHolds` — each testing `bStart < reqEnd && bEnd > reqStart` against the requested window (`guest-app/server/handlers/rooms.ts:130-175`). The Firestore query is also narrowed to `checkIn < reqEnd` so it no longer scans the whole collection. |
| **RPT-19** | Staff store-order **Cancel has no status guard** — cancelling a delivered order returns the stock but leaves the tender in the ledger. | The transition is **server-owned** and the client can no longer write the field: `firebase/firestore.rules` → `allow update: if isStaff() && !request.resource.data.diff(resource.data).affectedKeys().hasAny(["status"])` (`firestore.rules:821-822`). |
| **SR-05** | The `additionalPreferences` allowed-values rule is **inverted** — it rejects every legal value. | Fixed as RPT-03: the catalog resolves through the shared helper with a `DEFAULT_BOOKING_PREFERENCES` fallback, and the rule is now `!bookingPreferencesCatalog.includes(key)` — it rejects only *unknown* keys (`bookings.ts:2484-2493`). |
| **F-C1** | Store revenue does not reconcile with the store tenders. | Reconciliation **I17 PASS**: "store revenue reconciles with the store tenders" — 12 store orders, delivered revenue ₱280.00, tenders ₱180.00, Δ exactly the ₱100.00 add-to-bill total, **0 cancelled orders still hold a tender**. |
| **F-C2** | A cancelled store order **keeps its settlement tender**. | Reconciliation **I17 PASS** — "0 cancelled order(s) still hold a tender", and a direct probe of production confirms **0** cancelled orders carry a tender. |
| **F-A2** | The **Full Backup** omits every store payment tender — the "Store Orders" sheet had no *Paid* column, so the cash at the till was invisible in the backup. | **FIXED.** The export now reads each order's tender at `storeOrders/{id}/payments/delivery-tender` and the "Store Orders" sheet carries **Paid**, **Paid At**, **Paid By** and **Tender Ref**. An add-to-bill order reads `Paid = 0` (its money is on the room folio — reporting the order total there would double-count it). Proven by `admin-app/src/__tests__/f-a2-f-a3-f-a5-full-backup-completeness.test.ts`. |
| **F-A3** | The "full backup" omitted **9 root collections** and the Bookings sheet had no `reservationId` column — so a restore **could not rebuild room inventory**. | **FIXED.** The export now reads `rooms`, `reservations`, `corporateCodes`, `guests`, `addOns`, `roomBlocks`, `settings` and `intercoms` (8 client-readable collections) and carries `testRuns` from the server-only context list, each on its own sheet with the **Doc ID** first. The Bookings sheet now carries **Reservation ID** and **Reservation Ref**. |
| **F-A5** | `revenueAllocation` was not exported — so the MRB-11 violations were **invisible to whoever audits the backup**. | **FIXED.** The Bookings sheet now carries **Revenue Room Net**, **Revenue Breakfast Net**, **Revenue Add-On Net**, **Revenue Deduction Net** and **Revenue Total Net**, so the MRB-11 invariant (roomNet + breakfastNet + addOnNet − deductionNet == totalNet) is checkable from the backup alone. A booking with no allocation exports BLANK, not zero — "no allocation recorded" is a different claim from "earned nothing from rooms". |
| **SEC-2** | A member can claim an **unlinked** booking — the claim path does not verify the booking belongs to the member. | **FIXED** (commit `1055b836`, live in `v2.21.5`). The hole was NOT where the handoff said: `POST /api/members/redeem-points-self` accepted a booking ID and, if that booking carried no `memberId`, quietly wrote the CALLER's uid onto it — adopting a stranger's booking (with its public `lookupToken` cancel credential). The shared guard only fired when `booking.memberId` was ALREADY SET and different, so the comment described the intended behaviour and the code did not implement it. The SELF path now requires an exact match; the STAFF path keeps its documented auto-link behaviour (admin-only at the router, so not member-reachable). **Proved live**: a real member token against a real unlinked pre-check-in booking → **HTTP 400 `"Booking is not linked to this member."`**, and the booking's `memberId` was still unset afterwards. |


### The structural fix — a scope reconciliation gate

The two lists must be diffed **before** a report is allowed to close as "no findings remain open". The report ships with `scripts/qa/verify-matrix.ts`, which already checks its OWN catalogue against its OWN matrix. What it does **not** do is check the sibling backlog's ids. A check that reads `HANDOFF-2026-10-23.md` §6's id column and fails when an id is absent from the report — unless it is explicitly marked out-of-scope with a reason — is the difference between "no findings remain open" meaning what it appears to mean.
