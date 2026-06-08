# Environment Variables
> Requires: CLAUDE.md

---

## Overview

Two `.env` files — one per app. All are gitignored. Never commit env files.

`api/` lives inside `guest-app/` — its server-side env vars are in `guest-app/.env` alongside the client vars. Vercel exposes all env vars to both the frontend build and the serverless functions in the same deployment.

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

# Firebase Admin SDK (server-side only — never prefix with VITE_)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Resend (server-side only)
RESEND_API_KEY=

# Email
RESEND_FROM_EMAIL=sparkinn.dev@gmail.com
ADMIN_NOTIFICATION_EMAIL=sparkinn.dev@gmail.com

# Cloudflare Turnstile (secret key — server-side only)
TURNSTILE_SECRET_KEY=
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

# Guest app URL (for linking to booking pages from admin)
VITE_GUEST_APP_URL=https://www.sparkinnbohol.com
```

---

## Notes

- `VITE_` prefix is required by Vite for client-side exposure — never prefix server-only secrets with `VITE_`
- `FIREBASE_PRIVATE_KEY` contains newlines — wrap in quotes in `.env` and use `.replace(/\\n/g, '\n')` when initializing the Admin SDK
- In Vercel dashboard, set all env vars once — they apply to both the frontend build and the API functions in the same deployment
- `FIREBASE_PROJECT_ID` appears twice (once as `VITE_FIREBASE_PROJECT_ID` for client, once as `FIREBASE_PROJECT_ID` for Admin SDK) — both are needed

---

## Local Development

Each app runs on its own dev server:
- `guest-app` + `api/`: `vercel dev` inside `guest-app/` — runs Vite + serverless functions together on `localhost:3000`
- `admin-app`: `vite` inside `admin-app/` — runs on `localhost:5173`

Copy `.env.example` files (to be created) for each app to get started.
