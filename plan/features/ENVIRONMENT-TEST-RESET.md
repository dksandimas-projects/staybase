# Environment Test Runs & Controlled Data Reset
> Requires: CLAUDE.md, plan/docs/BACKEND.md, plan/docs/API-ROUTES.md
> Status: Phase 1 core shipped (ETR-01..14, ETR-S01..S15) · Production refresh / restricted mode / pre-live reset are open spec
> Moved from `plan/project/ROADMAP.md §Environment Test Runs & Controlled Data Reset` (2026-07-17); the original roadmap text is archived in `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md`.

---

## Overview

Production receives final end-to-end testing before real hotel operations begin. A permanent Settings button that deletes every booking/order is too dangerous, while identifying tests from names or emails is unreliable. The environment provides explicit server-authoritative test classification, run-scoped cleanup, a reusable staging-only clean-slate reset, and one carefully controlled pre-live production reset — permanently disabled after owner go-live sign-off.

**Goal:** Allow realistic production smoke testing and deterministic cleanup without risking untagged live data. Keep broad/destructive testing in staging, limit production to authorized test runs, and permanently disable full production reset after owner go-live sign-off.

---

## Shipped behavior (Phase 1 core — current contract)

### Environment Testing settings surface

- ✅ **ETR-01 — Admin-only Environment Testing section.** Settings tab (FlaskConical icon) with create/close/cleanup UI, active run warning banner, and run history. Front Desk sees an "Admin only" lockout notice; Admin sees full controls.
- ✅ **ETR-02 — Start and close a test run.** `POST /api/test-runs/create` and `POST /api/test-runs/close` with Zod validation, admin auth, single-active-production-run enforcement, opaque run ID (CSPRNG hex), token hash, and Firestore persistence.
- ✅ **ETR-03 — Temporary public-flow access.** The token is validated in `POST /api/bookings/create`: when a `testToken` is present in the body, the server hashes it, looks up the matching active test run, checks expiry, and stamps `isTestData: true` + `testRunId` on the booking document. Invalid/expired tokens return 403 with a clear message. `hashToken` exported from `test-runs.ts` for reuse.
- ✅ **ETR-04 — Server-side test run creation.** Admin creates a named run through the authenticated server route; the returned token is server-owned. Walk-in/other staff-side test records can be associated server-side via the active run.
- ✅ **ETR-05 — Persistent visual distinction.** **TEST DATA** badges on booking/order rows (desktop + mobile), booking drawer header, and store order drawer header. Active run warning banner on BookingsPage.

### Canonical classification and propagation

- ✅ **ETR-06 — Server-owned root metadata.** `TestRun` shared type with `id`, `name`, `environment`, `createdByUid`, `status`, `tokenHash`. Booking/StoreOrder types carry `isTestData` and `testRunId` fields.
- ✅ **ETR-07 — Inherit classification automatically.** Walk-in bookings accept an optional `testRunId`: the server validates the run is active/not expired and stamps `isTestData: true` + `testRunId`. Admin walk-in modal has a test-run selector (shown when active runs exist). Subcollection cleanup (payments, charges) is handled by recursive deletion.
- ✅ **ETR-08 — Live-by-default safety.** Classification lives on the root `testRuns` doc and individual booking/order docs. Missing metadata = live/no test status.
- ✅ **ETR-09 — Reference integrity.** Cleanup preserves reference counters (`counters/` collection is never touched).

### Test-run review and scoped cleanup

- ✅ **ETR-10 — Review before deletion.** `POST /api/test-runs/close` collects a manifest (bookings, store orders, affected rooms/stock). The Settings UI shows the manifest in the cleanup confirmation modal before proceeding.
- ✅ **ETR-11 — Delete by verified run ID only.** `POST /api/test-runs/delete` accepts one closed `testRunId`, validates it server-side, requires `closed` status, uses Admin SDK recursive deletion for subcollections. No browser-side delete loop.
- ✅ **ETR-12 — Recover operational state.** After tagged data deletion, affected rooms are reset to `available`/`clean`. Intercom stays tagged with `testRunId` are deleted.
- ✅ **ETR-13 — Durable cleanup audit.** Persists `{ type, runId, bookingsDeleted, storeOrdersDeleted, failedItems, completedAt, completedBy }` to `janitor/cleanups/history`.
- ✅ **ETR-14 — Safe job execution.** Firestore transaction for atomic lock acquisition; stale-lock recovery after timeout allows retry of interrupted cleanups (refreshed 30-minute lease per AUD-06); periodic progress checkpointing (`cleanupCursor`) enables resumability. Status `cleanup-in-progress` is accepted for retry when the lock is stale; `cleaned` runs are rejected.

### Permanent staging-only Reset operational data (ETR-S01..S15)

> Owner requirement (2026-07-16): staging needs a reusable clean-slate control for repeated end-to-end testing — distinct from production test-run cleanup and from the temporary one-time production pre-live reset.

- ✅ **ETR-S01 — Staging authorization is server-owned.** `POST /api/test-runs/staging-reset-preview` and `POST /api/test-runs/staging-reset-execute` check `STAGING_ALLOWLIST_PROJECT_IDS` env var. Only explicitly allowlisted project IDs can execute; non-allowlisted projects receive a 403. Client environment variables/hostnames never authorize.
- ✅ **ETR-S02 — Admin-only Settings control.** Reset Operational Data section under Environment Testing tab, gated by `isAdmin`; the server endpoint re-validates the role server-side.
- ✅ **ETR-S02a — Environment-aware Admin routing.** Canonical staging Admin hosts route all server actions to the staging guest/API host even when a production fallback URL is present. Production Settings shows staging reset as unavailable and links to staging instead.
- ✅ **ETR-S03 — Preview and typed confirmation.** Modal shows project ID, collection counts, preservation list. Requires typing `RESET STAGING` + the project name; button disabled until both match.
- ✅ **ETR-S04 — Default operational reset scope.** Deletes all bookings (with payments/charges/notifications/audit subcollections), store orders (with tenders), notifications, intercom stays (with messages), and test runs using paginated Admin SDK deletion.
- ✅ **ETR-S05 — Preserve configuration and identity.** Staff Auth/guests, settings docs, rooms/room types, rates, payment methods, store catalog, vouchers/corporate codes, and `counters/` reference sequences are never touched.
- ✅ **ETR-S06 — Restore staging baselines.** Affected rooms reset to `available`/`clean`. Inventory restoration is explicit (preserve current stock rather than infer).
- ✅ **ETR-S07 — Completion and audit.** Persists full manifest/counters/audit record to `janitor/cleanups/history`.
- ✅ **ETR-S08 — Production denial coverage.** 9 tests in `tests/api/test-runs-staging-deny.test.ts` verify preview/execute 403 for non-allowlisted projects, happy path, and rejection of non-admin staff, wrong confirmation phrase, and project-name mismatch.
- ✅ **ETR-S09 — Single reset job and safe recovery.** Atomic project-scoped lock, duplicate/concurrent requests return the existing job, phase checkpoints persisted outside cleared collections, bounded stale-lock recovery, idempotent resume.
- ✅ **ETR-S10 — Preview-bound execution.** Short-lived preview manifest ID/hash (project, scope, counts, affected rooms, preservation decisions); execute rejects expired, mismatched, or materially drifted previews.
- ✅ **ETR-S11 — Fail-closed completion semantics.** Any failure marks the job `incomplete`/`failed`, returns non-success, suppresses the completion toast, retains failure detail/checkpoints, exposes retry/resume. `200 success` only after deletion and integrity verification both pass.
- ✅ **ETR-S12 — Complete scope and baseline recovery.** Every operational root and child collection (calls/ICE candidates, room blocks, Daily Close records, corporate inquiries, audit/notification records, ledgers, tenders, messages) explicitly marked delete-or-preserve in preview. Rooms restored through verified IDs/numbers; unresolved rooms fail verification.
- ✅ **ETR-S13 — Post-reset integrity scan.** Verifies targeted roots/children empty, no orphans, rooms available/clean, counters unchanged, protected data present. Persists result and terminal `complete | incomplete | failed` state.
- ✅ **ETR-S14 — Destructive-job integration coverage.** Emulator/integration tests for concurrency, duplicate execute, timeout/resume, stale lock, deletion failure, preview expiry/drift, room restoration, preservation rules, counter invariance, orphan detection, success only after integrity pass.
- ✅ **ETR-S15 — Deployment and first-use gate.** `STAGING_ALLOWLIST_PROJECT_IDS` configured only on the isolated guest/API Vercel Preview environment; authenticated preview, controlled fixture reset, injected-failure/resume drill, and manual Settings QA performed; production preview/execute denial reconfirmed.

> **Execution gate (carried from the roadmap):** Do not run the destructive staging reset until the deployed API bundle is confirmed current. The gate was re-opened 2026-07-16 (AUD-01: stale committed bundle); AUD-01 has since shipped and the 2026-07-16 roadmap note records "staging reset hardening and ETR-S15 first-use drill completed" — confirm the deployed bundle before any run.

---

## Open spec — Production-to-staging refresh and sanitization (ETR-R)

> Owner requirement added 2026-07-16 (revised same day): Admin needs a way to refresh staging from production and may need exact source values to reproduce a defect. The UI therefore includes a default-on sanitization checkbox. Turning it off does not create an ordinary refresh: it automatically activates the restricted diagnostic controls and automatic destruction defined below.

- ⬜ **ETR-R01 — One-way refresh only.** Add an Admin-only **Refresh staging from production** workflow authorized by server-owned project/environment allowlists. Data may flow production → staging only; no UI, route, or job may promote staging operational data into production.
- ⬜ **ETR-R02 — Refresh modes and sanitization toggle.** Offer **Configuration only** and **Operational snapshot**. Operational snapshot displays **Sanitize personal and payment data**, checked by default. When checked, apply the irreversible transformations below. When unchecked, immediately change the workflow label/state to **Restricted Diagnostic Mode** and require every ETR-D gate before preview or import.
- ⬜ **ETR-R03 — Reviewable operational preservation.** In sanitized mode, allow separate choices to preserve operational dates, financial values, and statuses for workflow/reconciliation testing without passing PII/payment evidence. In restricted mode, preserve exact values only for the explicitly selected diagnostic scope so staff can follow the actual reproduction steps; never interpret unchecked sanitization as permission to clone the entire production dataset by default.
- ⬜ **ETR-R04 — Irreversible identity replacement.** Replace guest names, emails, phones, addresses, emergency contacts, government-ID values, payment references, and other direct identifiers with deterministic synthetic values scoped to the snapshot. The same production subject maps consistently within one snapshot without writing the source-to-synthetic mapping into staging.
- ⬜ **ETR-R05 — Sanitized-mode content and files.** When sanitization is on, remove or synthesize guest/internal free-text content, intercom messages, ID images, signatures, payment proofs, and private production Storage URLs. Public brand/catalog assets may be copied through an approved asset path; sensitive-file test cases use known synthetic fixtures rather than production uploads.
- ⬜ **ETR-R06 — Preserve relational and finance integrity.** Preserve booking/order relationships, room/type links, stay duration, lifecycle state, price/rate breakdowns, discounts, vouchers, points, payments, refunds, incidentals, store quantities/tenders, balances, and report reconciliation totals. Sanitized mode maps production staff UIDs to staging-safe actors and replaces booking/order references while retaining stable joins; restricted mode retains exact approved values needed by the reproduction manifest.
- ⬜ **ETR-R07 — Staging isolation.** Preserve staging Auth/staff and environment-specific secrets/configuration. Force-disable guest email delivery, payment callbacks, production notifications, and other outbound side effects during and after import. Imported documents carry snapshot ID/source/import timestamp metadata and a visible badge matching the mode: **SANITIZED PRODUCTION SNAPSHOT** or **REAL PRODUCTION DATA — RESTRICTED**.
- ⬜ **ETR-R08 — Mode-appropriate scan before import.** Build snapshots in an isolated job and never log source PII. Sanitized mode runs denylist/schema scans for production emails, phones, IDs, payment references, private notes/messages, and production Storage URLs, then fails closed if any remain. Restricted mode verifies that every included record/file belongs to the approved narrow manifest and rejects scope expansion or unapproved sensitive-file classes.
- ⬜ **ETR-R09 — Controlled replacement.** Back up the current staging dataset, generate source/transformation manifests, run the staging operational reset, import only the verified snapshot, restore staging-specific configuration/baselines, and execute orphan plus finance-invariant checks. A partial import remains visibly failed/resumable and cannot be treated as a valid refreshed environment.
- ⬜ **ETR-R10 — Refresh audit and retention.** Persist snapshot source time, mode, transformation version, counts, exclusions, scan/integrity results, initiating/completing Admin UIDs, and backup reference without storing original PII. Support deletion/replacement of prior imported snapshots through the staging reset workflow.

---

## Open spec — Restricted Diagnostic Mode through the sanitization toggle (ETR-D)

> Turning off **Sanitize personal and payment data** is supported for exact reproduction, but it changes staging into a temporary restricted environment. The toggle cannot bypass or weaken the gates below.

- ⬜ **ETR-D01 — Toggle-to-restricted transition.** Allow Admin to uncheck sanitization only after a warning explains that real production data will enter staging. Require recent reauthentication, written diagnostic purpose/issue reference, requested lifetime, owner/DPO approval record, typed staging project confirmation, and explicit acknowledgement before generating the preview.
- ⬜ **ETR-D02 — Lock everyday staging.** Before import, switch the allowlisted staging project into Restricted Diagnostic Mode: block public guest access and Front Desk access, permit only explicitly allowlisted Admin accounts, review Firestore/Storage/network/logging/export controls to production-equivalent standards, and prevent concurrent ordinary staging/test-run activity.
- ⬜ **ETR-D03 — Minimize scope despite approval.** Select only the collections/documents/date range required for the defect. Exclude Firebase Auth accounts by default and require separate explicit approval for government IDs, signatures, payment proofs, private messages, or other sensitive files even when the structured dataset is otherwise unsanitized.
- ⬜ **ETR-D04 — Separate sensitive-file opt-in.** Keep **Include payment proofs, IDs, signatures, and private uploads** unchecked by default even when sanitization is off. Enabling it requires a second explicit approval and narrows copied Storage objects to the approved manifest; private production URLs must never remain usable after diagnostic cleanup.
- ⬜ **ETR-D05 — Disable side effects.** Force-disable guest/staff transactional emails, payment callbacks, webhooks, production notifications, scheduled jobs, and public access. Display a persistent **REAL PRODUCTION DATA — RESTRICTED** banner across staging and prevent the snapshot from being mistaken for ordinary test data.
- ⬜ **ETR-D06 — Short TTL and destruction.** Default to a maximum 24-hour lifetime unless a shorter approved window is selected. Automatically lock and destroy the diagnostic snapshot at expiry; provide **Destroy diagnostic snapshot now** and require verification that Firestore data, copied Storage objects, temporary exports, keys, and caches are gone.
- ⬜ **ETR-D07 — Restore ordinary staging.** Capture the prior staging snapshot/configuration before restricted import. After verified destruction, restore the approved sanitized/empty staging state, normal staging access policy, and ordinary test controls; keep outbound suppression until the restoration integrity scan succeeds.
- ⬜ **ETR-D08 — Access and destruction audit.** Record toggle change, approval, purpose, included scope, authorized users, access timestamps where available, exports, expiry, early-destroy action, completion/failures, restoration, and destruction verification in a protected production audit location without duplicating copied PII.
- ⬜ **ETR-D09 — Fail-safe behavior.** If approval, staging access lock, side-effect suppression, scope manifest, TTL scheduling, prior-state capture, or destruction/restoration verification cannot be proven, refuse the unsanitized import. Expiry/destruction failure triggers immediate access lock and a visible security incident requiring manual completion.
- ⬜ **ETR-D10 — Privacy/security coverage.** Test source-to-staging one-way enforcement, default-on toggle behavior, toggle permission denial, exact selected-scope reproduction, scope-expansion rejection, sensitive-file second opt-in, outbound suppression, Admin-only staging lock, finance invariants, TTL destruction, restoration, and post-destruction absence.

---

## Open spec — One-time pre-live production reset (ETR-15..20)

- ⬜ **ETR-15 — Temporary production authorization.** Full operational reset is unavailable by default and requires an explicit server-side pre-live authorization enabled only for the scheduled cutover window. The client cannot enable it. Remove the authorization immediately after owner sign-off rather than leaving a hidden permanent capability.
- ⬜ **ETR-16 — Strong confirmation gates.** Require Admin authentication, recent reauthentication, maintenance mode, displayed environment/project identifiers, typed environment name and confirmation phrase, server-generated deletion manifest, and a verified backup/export reference before a production full reset can begin.
- ⬜ **ETR-17 — Explicit reset scope.** The manifest separately lists bookings and their payments/charges, store orders/tenders, booking/store notifications, stay-scoped intercom history, operational audit records, and optional Daily Close records. Preserve hotel settings/branding, rooms and room types, staff accounts, rates/seasonal pricing, payment methods, store catalog, vouchers/corporate configuration, and reference counters by default.
- ⬜ **ETR-18 — Baseline restoration and integrity scan.** Reset rooms to the owner-approved availability/housekeeping baseline, restore inventory only from an approved captured baseline, verify no orphaned ledgers/orders/intercom stays remain, confirm dashboards/reports show the clean dataset, and record the final integrity result.
- ⬜ **ETR-19 — Final tagged smoke test.** After the reset, execute the minimum production path—booking, proof verification/payment ledger, confirmation, check-in, store order, later payment if required, checkout, email, notification, and report visibility—inside a new tagged run. Delete that run through scoped cleanup, re-run integrity checks, then obtain owner go-live sign-off.
- ⬜ **ETR-20 — Post-launch lockout.** After sign-off, full reset remains disabled in production. Broad/destructive testing stays in staging. Any necessary production smoke test uses an authorized tagged run and may delete only that run; real untagged operational data is never bulk-deleted from Settings.

---

## Verification and acceptance criteria (open)

- ⬜ **ETR-21 — Security and regression coverage.** Test forged/expired/closed/wrong-environment tokens, client classification tampering, Front Desk permission denial, dependent-record inheritance, missing-tag live fallback, concurrent writes during cleanup, partial/resumed cleanup, inventory/room restoration, counter preservation, manifest accuracy, and post-launch full-reset denial.
- ⬜ Production test data can be enumerated and removed deterministically by `testRunId` without using names, emails, dates, or other heuristics.
- ⬜ An Admin can repeatedly reset the complete operational dataset in an allowlisted staging project from Settings while preserving configuration, identity, catalog, and reference counters.
- ⬜ The staging reset endpoint denies both preview and execution against production regardless of client behavior, hostname, or authenticated Admin role.
- ⬜ An Admin can refresh staging with production configuration or an irreversibly sanitized operational snapshot while preserving relational and financial behavior and preventing all production outbound side effects.
- ⬜ Admin can turn sanitization off to reproduce an issue with exact approved source values, but the toggle cannot proceed until staging enters Restricted Diagnostic Mode and all authorization/scope/TTL gates pass.
- ⬜ Sensitive production files remain excluded from an unsanitized snapshot unless the separate file opt-in is explicitly approved for the diagnostic manifest.
- ⬜ Any unsanitized staging snapshot is minimally scoped, approval-bound, Admin-only, access-audited, automatically time-limited, verifiably destroyed, and followed by restoration of ordinary staging.
- ⬜ No untagged booking, order, ledger entry, notification, message, audit record, room state, inventory value, or Daily Close record can be deleted by scoped test cleanup.
- ⬜ The one-time pre-live reset cannot run without maintenance mode, recent Admin reauthentication, an approved manifest, and a verified backup reference.
- ⬜ A failed or timed-out cleanup remains resumable and visibly incomplete; it never silently unlocks the environment or reports a clean slate.
- ⬜ Full production reset is demonstrably unavailable after owner go-live sign-off, while staging reset and run-scoped production cleanup remain appropriately controlled.
- ⬜ API/admin typecheck, committed API bundle verification, security/rules tests, cleanup integration tests, cutover-runbook dry run, and manual Settings/mobile QA pass before this item is marked complete.

---

## References

- Roadmap status line: `plan/project/ROADMAP.md §Phase 12`
- Cutover procedure: `plan/project/PROD-CUTOVER-RUNBOOK.md`
- Post-merge audit that hardened the shipped core: `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md §Post-merge Audit — 2026-07-15/16`
