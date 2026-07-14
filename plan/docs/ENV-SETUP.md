# Environment Variables
> Requires: CLAUDE.md

---

## Overview

Two `.env` files — one per app. All are gitignored. Never commit env files.

`api/` lives inside `guest-app/` — its server-side env vars are in `guest-app/.env` alongside the client vars. Vercel exposes all env vars to both the frontend build and the serverless functions in the same deployment.

---

## Environments (two Firebase projects, three surfaces)

| Environment | Git branch | Domains | Firebase project | Vercel env scope |
|---|---|---|---|---|
| Production | `main` | `www.` / `admin.sparkinnbohol.com` | `spark-inn-prod` | Production |
| Staging | `dev` | `stg.` / `stg-admin.sparkinnbohol.com` | `spark-inn-stg-7a7ad` | Preview |
| Local | — | `localhost` | staging (or emulators) | — |

- `.firebaserc` defines the `staging` (default) and `production` aliases plus
  per-project storage-bucket targets; deploy with
  `firebase deploy --only firestore,storage --project production|staging`.
  A bare `firebase deploy` hits **staging** on purpose.
- Local env switching: `guest-app/.env.spark-inn-prod` / `.env.spark-inn-stg`
  (and the `admin-app/` equivalents) are local-only, gitignored variants —
  `cp` the one you need onto `.env`. They deliberately avoid Vite's magic
  `.env.production` name, which `vite build` would auto-load.
- Admin-SDK scripts (`seed-firestore`, `create-admin-user`,
  `finance-integrity-scan`, `set-storage-cors`) read `guest-app/.env` —
  whichever variant is active is the project they act on.
- Full cutover sequencing: `plan/project/PROD-CUTOVER-RUNBOOK.md`.

---

## `guest-app/.env`

Contains both client-side (`VITE_` prefix) and server-side (no prefix) vars — all in one file.

```
# Firebase client SDK (same project as admin-app)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Cloudflare Turnstile (public key — safe to expose to browser)
VITE_TURNSTILE_SITE_KEY=

# Sentry browser error reporting (public DSN — safe to expose to browser)
VITE_SENTRY_DSN=

# Firebase Admin SDK (server-side only — never prefix with VITE_)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_STORAGE_BUCKET=

# Vercel Deploy Hook (server-side only; guest production deployment)
VERCEL_DEPLOY_HOOK_URL=

# Resend (server-side only)
RESEND_API_KEY=

# Email (RESEND_ADMIN_EMAIL is the address staff notifications go to;
# ADMIN_NOTIFICATION_EMAIL is a legacy alias no code reads anymore)
RESEND_FROM_EMAIL=sparkinn.dev@gmail.com
RESEND_ADMIN_EMAIL=sparkinn.dev@gmail.com

# Cloudflare Turnstile (secret key — server-side only)
TURNSTILE_SECRET_KEY=

# Vercel Cron (server-side only — never prefix with VITE_)
CRON_SECRET=
```

---

## `admin-app/.env`

```
# Firebase client SDK (same project as guest-app)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Sentry browser error reporting (public DSN — safe to expose to browser)
VITE_SENTRY_DSN=

# Guest app URL (for linking to booking pages from admin)
VITE_GUEST_APP_URL=https://www.sparkinnbohol.com
```

---

## Notes

- `VITE_` prefix is required by Vite for client-side exposure — never prefix server-only secrets with `VITE_`
- `FIREBASE_PRIVATE_KEY` contains newlines — wrap in quotes in `.env` and use `.replace(/\\n/g, '\n')` when initializing the Admin SDK
- In Vercel dashboard, set all env vars once — they apply to both the frontend build and the API functions in the same deployment
- `FIREBASE_PROJECT_ID` appears twice (once as `VITE_FIREBASE_PROJECT_ID` for client, once as `FIREBASE_PROJECT_ID` for Admin SDK) — both are needed
- `CRON_SECRET` protects scheduled Vercel Cron email jobs and must match the bearer token expected by `/api/email/checkin-reminder`
- `VERCEL_DEPLOY_HOOK_URL` is called only by the authenticated admin SEO publish endpoint. Never prefix it with `VITE_` or expose it to browser code.

---

## Local Development

Each app runs on its own dev server:
- `guest-app` + `api/`: `vercel dev` inside `guest-app/` — runs Vite + serverless functions together on `localhost:3000`
- `admin-app`: `vite` inside `admin-app/` — runs on `localhost:5173`

Copy `.env.example` files (to be created) for each app to get started.
