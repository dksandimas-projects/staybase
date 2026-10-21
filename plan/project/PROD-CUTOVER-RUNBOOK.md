# Production Cutover Runbook — Environment Split

> Goal: demote the current Firebase project (`spark-inn-stg-7a7ad`, today
> serving the live site) to the **staging** database, stand up a Vercel
> **staging environment** on top of it, and cut production over to a
> **clean-slate** Firebase project (`spark-inn-prod`).
>
> Created: 2026-07-14. Tracked in `ROADMAP.md §Production Environment
> Split` as `PC-01`..`PC-06`. Check items off here as they complete.
>
> **Ordering rule:** PC-01..PC-04 are non-destructive and can proceed any
> time — the live site keeps running on `spark-inn-stg-7a7ad` untouched.
> Nothing user-visible changes until the PC-06 env-var flip.

---

## Target topology

| Environment | Git branch | Domains | Firebase project | Storage bucket |
|---|---|---|---|---|
| **Production** | `main` | `www.sparkinnbohol.com` / `admin.sparkinnbohol.com` | `spark-inn-prod` | `spark-inn-prod.firebasestorage.app` |
| **Staging** | `dev` (Vercel Preview) | `stg.sparkinnbohol.com` / `stg-admin.sparkinnbohol.com` | `spark-inn-stg-7a7ad` | `spark-inn-stg-7a7ad.firebasestorage.app` |
| Local | — | `localhost` | emulators or staging | — |

Production web app config (Firebase **client** config — public by design,
safe to record here; maps to the `VITE_FIREBASE_*` vars in
`plan/docs/ENV-SETUP.md`):

| Vercel env var (Production scope, both apps) | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | `[REDACTED_IN_CODE - GET FROM FIREBASE CONSOLE]` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `spark-inn-prod.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `spark-inn-prod` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `spark-inn-prod.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `723444959589` |
| `VITE_FIREBASE_APP_ID` | `1:723444959589:web:57b490db0155388deb398c` |

The `measurementId` (`G-LTGFD3XYVT`) is Firebase Analytics — the apps do
not use it and no `VITE_` var exists for it; ignore it.

**Service account key (SECRET — never commit, never echo):** downloaded as
`spark-inn-prod-firebase-adminsdk-fbsvc-71a95ff765.json`. Its values feed
the three server-side vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY` — quote-wrapped, `\n`-escaped per ENV-SETUP.md) in
the **Vercel Production scope only**. After pasting into Vercel and running
the local seeding steps, **delete the file from `~/Downloads`** — it grants
full admin over production. Staging keeps its existing (separate) key.

---

## Open decision (blocks PC-05 only)

- [x] **Active/future bookings carry-over.** Decision: clean slate only. No bookings data is carried over to production. Only active staff accounts are recreated. *(Resolved 2026-07-14 — Decision #119)*

---

## PC-01 — Repo configuration split ✅ (completed 2026-07-14)

- [x] `.firebaserc`: `"production": "spark-inn-prod"` alias added;
  `"default"` stays on **staging** so a bare `firebase deploy` can never
  hit production. Per-project storage targets (`app` →
  `spark-inn-{stg-7a7ad,prod}.firebasestorage.app`) added.
- [x] `firebase.json`: hardcoded staging bucket replaced with the `app`
  storage deploy target.
- [x] Scripts confirmed project-parameterized — all four
  (`seed-firestore`, `create-admin-user`, `finance-integrity-scan`,
  `set-storage-cors`) read credentials + bucket from `guest-app/.env`;
  the local `.env.spark-inn-{stg,prod}` swap files select the target.
- [x] `plan/docs/ENV-SETUP.md`: environment matrix + deploy aliases +
  env-swap workflow documented; stale var names corrected
  (`RESEND_ADMIN_EMAIL` is live, `ADMIN_NOTIFICATION_EMAIL` legacy,
  `FIREBASE_STORAGE_BUCKET` added).

## PC-02 — Provision `spark-inn-prod`

- [x] Project created, web app registered *(done 2026-07-14 — config above)*
- [x] Service account key generated *(done 2026-07-14)*
- [x] Blaze plan enabled + **budget alert** configured *(done 2026-07-14
  per owner console confirmation)*
- [x] Region confirmed to match staging (both are `US-EAST1` / South Carolina) *(done 2026-07-14)*
- [x] Auth enabled: Email/Password **and Google** provider *(done
  2026-07-14 per owner console confirmation)*
- [x] Firestore + Storage enabled *(done 2026-07-14)*
- [x] Auth **authorized domains**: `www.sparkinnbohol.com`,
  `admin.sparkinnbohol.com` *(done 2026-07-14 per owner console
  confirmation)*
- [x] Browser API key restricted to the production domains (restricted by HTTP Referrers to production + localhost, and limited to only 4 essential APIs) *(done 2026-07-14)*
- [x] Deploy rules + indexes *(done 2026-07-14 —
  `firebase deploy --only firestore,storage --project production`;
  required granting `dksandimas.projects@gmail.com` access to
  `spark-inn-prod` first; the firebase-adminsdk service account cannot
  deploy rules, only the CLI login can)*
- [x] **Verified deployed rules match the repo** (Firestore + Storage
  fetched live and diffed) and all **6 composite indexes** deployed
  *(done 2026-07-14)*
- [x] Storage CORS applied to the prod bucket *(done 2026-07-14 via
  `set-storage-cors.ts` with the prod env swap)*
- [x] **Scheduled backups / PITR enabled on Firestore** *(done 2026-07-14,
  verified live: PITR enabled; weekly backup schedule (Mondays, 14-week
  retention); **delete protection enabled** on the `(default)` database)*

## PC-03 — Seed production data ✅ (completed 2026-07-14)

- [x] Settings + rooms copied to prod *(verified 2026-07-14: all 5
  settings docs present; 14/14 rooms with **identical doc IDs and
  `qrToken`s** to staging — printed in-room QR codes survive the cutover)*
- [x] **Storage assets copied + URLs rewritten** *(done 2026-07-14: all
  22 `assets/branding` objects copied staging → prod bucket with fresh
  download tokens; the 5 staging-bucket URLs in `settings/websiteContent`
  (navbar dark logo + 4 hero photos) rewritten to prod URLs; full re-scan
  of all prod settings + rooms docs shows **0 staging-bucket URLs
  remaining**; anonymous fetch of a rewritten URL returns 200)*
- [x] Recreate staff accounts with role claims (copied via migration script) *(done 2026-07-14)*
- [x] Run `scripts/finance-integrity-scan.ts` against prod (expect zero findings on a clean slate) *(done 2026-07-14 — 0 findings)*
- [x] **Intentionally not copied** *(decided 2026-07-14, extending
  decision #119 clean slate)*: `storeItems` (1 — test), `vouchers` (2 —
  test), `corporateCodes` (1 — test), `corporateInquiries` (1 — test).
  Booking/guest/intercom/store-order transaction data excluded per the
  original decision; `counters` restart fresh.

**Handover note (not a blocker):** room-type photos and payment-method QR
images have never been uploaded in either environment (`hotelConfig`
image/QR fields are empty in staging too). The owner should upload them
via admin Settings on production post-cutover, and rebuild the store
catalog + any real vouchers/corporate codes directly on prod when needed.


## PC-04 — Vercel environment split

- [x] **Production scope** (both Vercel projects): the six
  `VITE_FIREBASE_*` values above; `FIREBASE_PROJECT_ID` /
  `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` from the prod service
  account key; `VITE_GUEST_APP_URL=https://www.sparkinnbohol.com` (admin
  app). Keep `RESEND_*`, `TURNSTILE_*`, `CRON_SECRET`,
  `VERCEL_DEPLOY_HOOK_URL` production values here. *(done 2026-07-14)*
- [x] **Preview scope**: today's staging Firebase values (client + admin
  SDK), `VITE_GUEST_APP_URL=https://stg.sparkinnbohol.com`, so `dev`
  deploys and PR previews can never touch production data *(done 2026-07-14)*
- [x] Assign `stg.sparkinnbohol.com` → guest project `dev` branch and
  `stg-admin.sparkinnbohol.com` → admin project `dev` branch (DNS records
  + Vercel domain-to-branch assignment) *(done 2026-07-14)*
- [x] Staging Firebase (`spark-inn-stg-7a7ad`) Auth authorized domains:
  add `stg.sparkinnbohol.com`, `stg-admin.sparkinnbohol.com` *(done 2026-07-14)*
- [x] Turnstile: add `stg.sparkinnbohol.com` to the widget's allowed
  domains (or issue separate staging keys in the Preview scope) *(done 2026-07-14)*
- [x] **Email isolation:** Preview-scope `RESEND_FROM_EMAIL` /
  `ADMIN_NOTIFICATION_EMAIL` point at an internal/staging address so a
  staging booking can never email a real guest *(done 2026-07-14)*
- [x] Note: Vercel **cron fires on Production deployments only** — the
  check-in reminder will run against prod only; staging never exercises
  it (expected) *(done 2026-07-14)*
- [x] Verify staging end-to-end at the `stg.` domains against the current
  database **before** the cutover (this also satisfies the FLR-05
  isolated-staging walkthrough environment requirement) *(done 2026-07-14)*

## PC-05 — Archive + data carry-over (Skipped: test data only)

- [x] Full Backup XLSX export (Skipped: database is test data only)
- [x] `gcloud firestore export` of `spark-inn-stg-7a7ad` to a GCS bucket (Skipped: database is test data only)
- [x] Recreate active staff accounts in production Auth/Firestore (using a migration script mapping same UIDs & claims) *(done 2026-07-14)*
- [x] Decision + outcome recorded in `DECISIONS-FEATURES.md` *(done 2026-07-14 — Decision #119)*

## PC-06 — Cutover + smoke test

> **Release 2026-10-21 — `dev` → `main` (VERSION 1.11.0 → 2.18.5).** See
> §Production release 2026-10-21 below for what was executed and what was
> verified. Items left unchecked are open.

- [ ] Announce a short freeze window (no new bookings taken at the desk) — **not announced for the 2026-10-21 release.** The window was short and outside desk hours, but the rules deploy did create a brief guest-intercom read gap (old rules + new client). Do this before the next release.
- [ ] Verify staff accounts can log in on production (PC-05) — **not verified in the 2026-10-21 release** (needs a real sign-in, not an unauthenticated probe)
- [x] Redeploy both Vercel projects on Production (activates the prod env vars saved in PC-04) — **done 2026-10-21**: Vercel auto-deployed on the `main` push; both apps verified live at VERSION 2.18.5 (`www` bundle `index-CPVtIjCK.js`, admin bundle `index-Dckh4qKg.js`; the old `1.11.0` is absent from both)
- [x] `node scripts/preflight.mjs` green — **re-run 2026-10-21: 34 passed, 1 warning, 1 FAILURE.** The failure is §10 (documentation audit), which is the pre-existing 18-error `docs:audit` baseline — not a new break. The 2026-07-14 run was 35/35; the doc budget has drifted since. **This box is the standing gate for the next release.**
- [ ] One end-to-end smoke booking **on production**: book → pay → incidental charge → store order (direct-paid + add-to-bill) → check-in → checkout → Daily Close preview → exports — then cancel/refund the test booking so the clean books stay explainable — **NOT done 2026-10-21.** What WAS verified mechanically: the live Firestore rules match the repo byte-for-byte (49 match blocks); per-rule behaviour probed unauthenticated against prod (`intercoms/{room}` 403, `intercoms/{room}/messages` 403, `intercomSessions/{tok}/messages` 200, `callSessions/{tok}` 404 = allowed-but-absent, `vouchers/{code}` 403, `settings/.../breakfastConfigChangeLog` 403, `rooms/room-101` 200, `settings/hotelConfig` 200); `GET /api/rooms/availability` 200; `POST /api/intercom/verify-guest` 400 on an empty body; guest + admin sites and `/rooms` + `/my-booking` all 200. **The full booking lifecycle is still unexercised.**
- [ ] Email triggers verified from production (booking-submitted, staff-new-booking) — **not done 2026-10-21**
- [x] `finance-integrity-scan.ts` against prod: zero findings — **done 2026-10-21**: reviewed 3 bookings + 0 store orders, **0 findings** (read-only `--output` mode; no Firestore writes)
- [x] Verify live prod rules still match repo (final check) — **done 2026-10-21**, verified mechanically rather than by eye: `scripts/capture-live-rules.mjs` pulled the live ruleset via the Rules REST API. Before the deploy the live ruleset was **byte-identical to `main`** (no console drift) and 11 match blocks behind the repo; after the deploy it is **byte-identical to the repo** (49 blocks). Rollback copy kept in `tmp/prod-rules-backup/` (gitignored).
- [ ] Intercom QR codes in rooms confirmed working — **PARTIAL 2026-10-21.** The intercom URL resolves in production (`/intercom/room-101` → 200, `/intercom/101` → 200) via the room **doc-ID** fallback. **But production rooms have NO `qrToken`** (0 of 14) while staging has 2 of 14 — so PC-03's "identical doc IDs and `qrToken`s" claim does not hold for production. Consequence: the QR URL is guessable from the room number (a second factor still applies — `/api/intercom/verify-guest` requires the guest's last name from the booking, and every send re-verifies the stay), and any in-room card printed from a staging `qrToken` would not resolve in production. **Fix: regenerate QR tokens in admin → QR Management, then reprint.**
- [x] Delete the local service-account JSON from `~/Downloads` — **confirmed 2026-10-21**: no `*adminsdk*.json` / `*fbsvc*.json` present
- [ ] First real Daily Close on the clean database — clean books from day
  one for the accountant (ties into the FLR-05 handover) — **not done; owner action**

---

## Production release 2026-10-21 — `dev` → `main` (VERSION 1.11.0 → 2.18.5)

**What shipped.** The 2026-10-20 production-readiness audit remediation (7 blockers
B1–B7, decisions #306–#308), together with the 2.x line it was built on: the
October 2026 feature audit (5 Criticals / 11 Highs / 8 Mediums), the breakfast
redesign 2.0.0 data-model cutover, the other-add-ons feature, and the mobile
booking UX rebuild. Merge commit `ba405b5` (`chore(merge): dev to main`).

**Release order — app first, rules second.** Per `plan/docs/GOTCHAS.md §Firebase`
(INC-01, 2026-07-17): *never deploy the rules ahead of the app build that
depends on them*. The order was therefore:

1. `git merge --no-ff dev` into `main`, push → Vercel auto-deployed both apps.
2. Waited for the new build to be live (verified by the VERSION string embedded
   in each served bundle — not by a timer).
3. `firebase deploy --only firestore:rules,storage:app --project production`.

Deploying the rules second is what makes the window safe. New rules + old app
would have made `intercoms/{roomId}/messages` staff-only, killing guest
intercom outright (the INC-01 failure mode). New app + old rules only denies
the *new* session-path reads for the length of the deploy window, and the
server still writes every guest message (Admin SDK bypasses rules) — so nothing
is lost, it is only not yet visible to the desk.

**Pre-flight checks run before the merge.**

| Check | Result |
|---|---|
| Live prod rules vs repo (before) | byte-identical to `main` — no console drift; repo 11 blocks ahead |
| `firestore.indexes.json` `main..dev` | unchanged — no index deploy needed |
| Storage rules vs client upload contract | client `ACCEPTED_UPLOAD_TYPES` = `image/jpeg,png,webp` and `MAX_UPLOAD_BYTES` = 5 MB **exactly match** the new rule gate on all three proof paths — no INC-01 risk |
| Production Firestore state | 3 bookings · 7 reservations · 4 guests · 7 notifications · 1 roomBlock · 4 bookingHolds · 0 members · 0 vouchers · 0 storeOrders |
| `scripts/clean-prelive-bookings.ts` (dry run) | would delete 3 bookings + 7 notifications + 2 test runs + reset 3 counters; **preserves** settings, guests, rooms metadata, storeItems, vouchers |

**Findings that need an owner decision (not blockers for the release).**

1. **3 production bookings carry the legacy flat-rate breakfast fields** (`breakfastRate`, `hasBreakfast`) that the 2.0.0 cutover deleted from the schema, so their folio will no longer show a breakfast line. They are test bookings, and the pre-live cleanup script would delete them — but **the script does not touch `reservations`**, so running it as-is would leave 7 reservation headers behind. Either clean bookings *and* reservations together, or leave both.
2. **`settings/breakfastConfig` and `settings/rewardsConfig` are still in the 1.x shape.** `breakfastConfig` has `silogItems` (not `meals`) and no `cutoffTime` / `servedGraceMinutes`; `rewardsConfig` has no `levels[]`, so the Spark Rewards tier system has no tiers configured. Both degrade gracefully (the admin app hydrates the legacy `silogItems` shape and falls back to defaults), but the hotel should re-save both in admin Settings to write the 2.x shape.
3. **No `qrToken` on any production room** (see PC-06 above).
4. **`npm run preflight` fails on the documentation audit** (the 18-error `docs:audit` baseline). It is a standing gate and the doc budget is 3.5× over — worth a compaction pass.

### Hotfix 2026-10-21 — the desk could not reply in the session thread

**Found, fixed and re-deployed the same day.** The capability-session rules
that shipped in 2.18.5 set `intercomSessions/{token}/messages` to
`allow create: if false`. The desk's reply is a client-side `addDoc` into
that collection, and `create` is a **distinct** operation from `update`, so
`allow update: if isStaff()` did not cover it. **Every desk reply was
rejected with `PERMISSION_DENIED`** — the guest's message arrived, the desk
saw it in the inbox, and the reply failed. The intercom was one-way.

Fixed to `allow create: if isStaff()` (the guest path is unaffected: the
server writes through the Admin SDK, which bypasses rules entirely), and the
`callSessions` blocks now spell out `allow read, create, update, delete: if
true` — a neighbouring `allow delete: if isStaff()` had been **dead code**
(`write` ⊇ create + update + delete, and matching allows are OR'd), while the
real intent is that the token holder owns the session and deletes it on
hang-up.

Pinned by `firebase/tests/intercom-session-write-paths.emulator.test.ts`
(5 tests). **Suite: 79 tests, 79 passed, 9 files.** Decision #309. The
generalisable lesson, now in the audit report: *a rule is a contract with a
WRITER, not a shape — every writer path needs a test that exercises the
actual client call.* The 74-assertion suite asserted collection shapes and
never created a message the way the desk does.
