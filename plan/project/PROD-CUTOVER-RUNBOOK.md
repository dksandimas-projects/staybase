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

- [ ] Announce a short freeze window (no new bookings taken at the desk)
- [ ] Verify staff accounts can log in on production (PC-05)
- [ ] Redeploy both Vercel projects on Production (activates the prod env vars saved in PC-04)
- [x] `node scripts/preflight.mjs` green *(done 2026-07-14 — 35/35 passed)*
- [ ] One end-to-end smoke booking **on production**: book → pay →
  incidental charge → store order (direct-paid + add-to-bill) → check-in →
  checkout → Daily Close preview → exports — then cancel/refund the test
  booking so the clean books stay explainable
- [ ] Email triggers verified from production (booking-submitted,
  staff-new-booking)
- [ ] `finance-integrity-scan.ts` against prod: zero findings
- [ ] Verify live prod rules still match repo (final check)
- [ ] Intercom QR codes in rooms confirmed working (they should, if room
  doc IDs were preserved in PC-03)
- [ ] Delete the local service-account JSON from `~/Downloads`
- [ ] First real Daily Close on the clean database — clean books from day
  one for the accountant (ties into the FLR-05 handover)
