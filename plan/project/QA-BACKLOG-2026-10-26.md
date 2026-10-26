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
| **F-A2** | The **Full Backup** omits every store payment tender — the "Store Orders" sheet has no *Paid* column, so the cash at the till is invisible in the backup. | **2 tender docs, ₱180.00** exist in production and are **not** exported. | S2 |
| **F-A3** | The "full backup" omits **9 root collections** (`rooms`, `reservations`, `corporateCodes`, `guests`, `addOns`, `roomBlocks`, `testRuns`, `settings`, `intercoms`) and the Bookings sheet has no `reservationId` column — so a restore **cannot rebuild room inventory**. | The export reads a subset of collections only. | S2 |
| **F-A5** | `revenueAllocation` is not exported — so the MRB-11 violations are **invisible to whoever audits the backup**. | Not in the export. | S2 |
| **F-A6** | The staging-refresh import points at `scripts/export-prod-data.mjs`, which **does not exist** — and the path is quoted in **user-visible UI text** (`SettingsPage.tsx:9434`). | File absent; the UI still names it. | S3 |
| **F-B3** | Reports → "Daily Kitchen Prep" disagrees with the bookings it summarises — bare `<date>-N` slot keys contribute nothing, it does not filter `removedAt`, and it derives dates from `checkIn + numNights` instead of the slot keys. | Logic unchanged. | S2 |
| **F-B5** | The kitchen list **cannot tell guests apart** — it resolves a name from the booking's `guests[]` array, and **0 of 157** production bookings carry one. (All 157 carry a single top-level `guestName`, so the list falls back to it.) | **0 of 157** have `guests[]`. | S2 |
| **F-C3** | The **Low Stock Alerts** panel lists **soft-deleted** items — a retired product still raises a purchasing flag. | **1 retired item, `stock=3`, `isActive=false`** still raises the flag. | S3 |
| **F-C4** | The store report has **no export**, although `plan/features/STORE-MANAGEMENT.md` line 84 is checked `[x] Export store report as CSV`. | No store CSV export in `ReportsPage.tsx`. | S3 |
| **F-D3** | `scripts/finance-integrity-scan.ts` covers the pricing invariants and **none of the ledger ones** — it never scans the `payments` / `refunds` / `charges` collections. | It reads `bookings` + `storeOrders` + the store tender only. | S2 |
| **F-D4** | Bookings where money was taken but the books do not close. | **5 bookings** are paid more than billed. All are QA fixtures, so the money is not real — but the arithmetic is wrong. | S3 |
| **RPT-18** | A **₱0 store order can never be delivered** — `handleDeliverStoreOrder` rejects `totalAmount <= 0` with a 409. | Guard still present (`guest-app/server/handlers/store.ts:108`). | S3 |
| **SEC-2** | A member can claim an **unlinked** booking — the claim path does not verify the booking belongs to the member. | Not yet re-verified. | S1 |
| **RPT-2** | "Charge after checkout" is **UI-only** — the server does not enforce it. | Not yet re-verified. | S2 |
| **RPT-3** | The room-occupancy gate is not date-scoped — a block covers the whole range. | Not yet re-verified. | S3 |
| **RPT-5** | The corporate path writes `paymentMethod:"chargeback"`. | Not yet re-verified. | S3 |
| **RPT-6** | `paymentRejectedBy` is always null. | Not yet re-verified. | S3 |
| — | `booking-confirmed` returns 401 for guests (the email-link path is broken). | Not yet re-verified. | S2 |
| **NO-ID-A67** | The guest bed-setup choice is only offered for **one** room type. | Not yet re-verified. | S3 |
| **NO-ID-A68** | Validation errors raised inside the create/booking transaction surface as **HTTP 500, not 400**. | Not yet re-verified. | S2 |
| **NO-ID-A69** | `createBookingSchema` is `.strict()` with no `testRunId`/`isTestData`, so a guest booking cannot be tagged as test data (the walk-in schema can). | Not yet re-verified. | S3 |
| **SR-05** | The `additionalPreferences` allowed-values rule is **inverted** — it rejects every legal value. (Shipped as RPT-03 in the item-#3 release; verify before re-filing.) | Not yet re-verified. | S2 |

> **"Not yet re-verified"** means the 2026-10-26 triage did not reach a live verdict on it. It is **not** a claim that the defect is present. Each needs the same treatment the closed rows above got: read the deployed code, probe production, then fix or close.

### The structural fix — a scope reconciliation gate

The two lists must be diffed **before** a report is allowed to close as "no findings remain open". The report ships with `scripts/qa/verify-matrix.ts`, which already checks its OWN catalogue against its OWN matrix. What it does **not** do is check the sibling backlog's ids. A check that reads `HANDOFF-2026-10-23.md` §6's id column and fails when an id is absent from the report — unless it is explicitly marked out-of-scope with a reason — is the difference between "no findings remain open" meaning what it appears to mean.
