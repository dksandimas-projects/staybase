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

- ⬜ **Active/future bookings carry-over.** History stays in staging by
  design, but guests with upcoming or in-house stays must exist in
  production at flip time. Choose: **(a)** one-off migration script that
  copies bookings with status `confirmed` / `payment-confirmed` /
  `checked-in` and `checkOut >= cutover date` (including their
  `payments`/`charges` subcollections and linked members), tested against
  staging first; or **(b)** front-desk manual re-entry if the count is
  small. Record the choice in `DECISIONS-FEATURES.md`.

---

## PC-01 — Repo configuration split

- [ ] `.firebaserc`: add `"production": "spark-inn-prod"` alias; keep
  `"default"` pointing at **staging** so a bare `firebase deploy` can
  never hit production.
- [ ] `firebase.json`: the `storage[0].bucket` is hardcoded to the staging
  bucket — convert to deploy targets
  (`firebase target:apply storage staging spark-inn-stg-7a7ad.firebasestorage.app`
  / `... production spark-inn-prod.firebasestorage.app`) so storage rules
  deploy to the right bucket per `--project`.
- [ ] `scripts/set-storage-cors.ts` + `scripts/seed-firestore.ts` +
  `scripts/create-admin-user.ts`: confirm each selects its target project
  from credentials/env (not a hardcoded project id); parameterize if not.
- [ ] `plan/docs/ENV-SETUP.md`: document the two-project / three-environment
  matrix and the Vercel Production-vs-Preview scoping rule.

## PC-02 — Provision `spark-inn-prod`

- [x] Project created, web app registered *(done 2026-07-14 — config above)*
- [x] Service account key generated *(done 2026-07-14)*
- [ ] Blaze plan enabled + **budget alert** configured
- [ ] Region confirmed to match staging (check `spark-inn-stg-7a7ad`
  Firestore location before creating the prod database)
- [ ] Auth enabled: Email/Password **and Google** provider (console toggle
  — same open item as the staging roadmap entry)
- [ ] Firestore + Storage enabled
- [ ] Auth **authorized domains**: `www.sparkinnbohol.com`,
  `admin.sparkinnbohol.com`
- [ ] Browser API key restricted to the production domains (do it from day
  one — open roadmap item on staging, don't repeat the gap)
- [ ] Deploy rules + indexes:
  `npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes,storage --project spark-inn-prod`
- [ ] **Verify deployed rules match the repo** (fetch live rules and diff —
  per the 2026-07-14 stale-rules lesson) and confirm all **6 composite
  indexes** finish building (booking lookup endpoints fail without them)
- [ ] Storage CORS applied to the prod bucket (`set-storage-cors.ts`)
- [ ] **Scheduled backups / PITR enabled on Firestore** — non-negotiable
  for the production finance ledger; staging never had it

## PC-03 — Seed production data

- [ ] Seed the 5 settings docs + rooms (`seed-firestore.ts` with prod
  credentials), then overlay real config from staging: room types + rate
  matrix, website content, payment methods, store catalog, breakfast +
  rewards config
- [ ] **Preserve room doc IDs and `qrToken`s** — copy room docs verbatim
  from staging so the printed in-room QR codes keep working (fresh IDs =
  reprint every room QR)
- [ ] **Re-upload every Storage-hosted asset** through the admin UI (or
  copy objects + rewrite URLs): branding images, payment-method QR images,
  room-type photos, SEO/OG image. No Firestore doc may carry a
  `spark-inn-stg-7a7ad.firebasestorage.app` URL — those break the day
  staging is ever cleaned up.
- [ ] Recreate staff accounts with role claims (`create-admin-user.ts` /
  `/api/admin/create-staff`) — custom claims don't transfer between
  projects
- [ ] Run `scripts/finance-integrity-scan.ts` against prod (expect zero
  findings on a clean slate)

## PC-04 — Vercel environment split

- [ ] **Production scope** (both Vercel projects): the six
  `VITE_FIREBASE_*` values above; `FIREBASE_PROJECT_ID` /
  `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` from the prod service
  account key; `VITE_GUEST_APP_URL=https://www.sparkinnbohol.com` (admin
  app). Keep `RESEND_*`, `TURNSTILE_*`, `CRON_SECRET`,
  `VERCEL_DEPLOY_HOOK_URL` production values here.
  ⚠️ Do **not** redeploy production after saving these until the PC-06
  flip step — saved-but-undeployed vars are inert; a redeploy activates
  them.
- [ ] **Preview scope**: today's staging Firebase values (client + admin
  SDK), `VITE_GUEST_APP_URL=https://stg.sparkinnbohol.com`, so `dev`
  deploys and PR previews can never touch production data
- [ ] Assign `stg.sparkinnbohol.com` → guest project `dev` branch and
  `stg-admin.sparkinnbohol.com` → admin project `dev` branch (DNS records
  + Vercel domain-to-branch assignment)
- [ ] Staging Firebase (`spark-inn-stg-7a7ad`) Auth authorized domains:
  add `stg.sparkinnbohol.com`, `stg-admin.sparkinnbohol.com`
- [ ] Turnstile: add `stg.sparkinnbohol.com` to the widget's allowed
  domains (or issue separate staging keys in the Preview scope)
- [ ] **Email isolation:** Preview-scope `RESEND_FROM_EMAIL` /
  `ADMIN_NOTIFICATION_EMAIL` point at an internal/staging address so a
  staging booking can never email a real guest
- [ ] Note: Vercel **cron fires on Production deployments only** — the
  check-in reminder will run against prod only; staging never exercises
  it (expected)
- [ ] Verify staging end-to-end at the `stg.` domains against the current
  database **before** the cutover (this also satisfies the FLR-05
  isolated-staging walkthrough environment requirement)

## PC-05 — Archive + data carry-over *(blocked on the open decision)*

- [ ] Full Backup XLSX export (Reports → Full Backup, admin login)
- [ ] `gcloud firestore export` of `spark-inn-stg-7a7ad` to a GCS bucket
  (point-in-time archive of the pre-split history)
- [ ] Execute the chosen carry-over path (migration script tested on
  staging first, or manual re-entry list prepared by front desk)
- [ ] Decision + outcome recorded in `DECISIONS-FEATURES.md`

## PC-06 — Cutover + smoke test

- [ ] Announce a short freeze window (no new bookings taken at the desk)
- [ ] Run carry-over (PC-05) for anything created since the archive
- [ ] Redeploy both Vercel projects on Production (activates the prod env
  vars saved in PC-04)
- [ ] `node scripts/preflight.mjs` green
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
