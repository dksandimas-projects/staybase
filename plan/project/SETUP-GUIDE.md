# Project Setup Guide
> Follow this once per deployment (Spark Inn or any new hotel client).
> Last updated: June 8, 2026

---

## Prerequisites

- [ ] Node.js 18+ installed
- [ ] Git installed
- [ ] GitHub account
- [ ] Firebase account (free)
- [ ] Vercel account (free)
- [ ] Cloudflare account (free) — for Turnstile
- [ ] Resend account (free) — for email

---

## Step 1 — Clone & Install

```bash
git clone https://github.com/your-username/spark-inn.git
cd spark-inn

# Install all workspace dependencies in one command from the repo root
npm install
```

This installs dependencies for `guest-app`, `admin-app`, and `shared` all at once via npm workspaces. Never run `npm install` inside individual app folders.

---

## Step 2 — Firebase Setup

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it `spark-inn` → create
3. In the project, enable:
   - **Authentication** → Sign-in method → Email/Password → Enable
   - **Firestore Database** → Create database → Start in production mode → choose `asia-southeast1` (Singapore, closest to PH)
   - **Storage** → Get started → production mode

4. Get your Firebase config:
   - Project Settings → General → Your apps → Add app → Web
   - Copy the config object — you'll need it for `.env` files

5. Get your Firebase Admin SDK credentials:
   - Project Settings → Service accounts → Generate new private key
   - Download the JSON file — keep it safe, never commit it
   - You'll need: `project_id`, `client_email`, `private_key` from this file

6. Restrict your Firebase API key:
   - Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
   - Click your Firebase API key → Application restrictions → HTTP referrers
   - Add: `www.sparkinnbohol.com/*` and `admin.sparkinnbohol.com/*` and `localhost:*`

---

## Step 3 — Firebase Rules & CORS

### Firestore Rules
- Go to Firestore → Rules tab
- Paste the rules from `firebase/firestore.rules`
- Click Publish

### Storage Rules
- Go to Storage → Rules tab
- Paste the rules from `firebase/storage.rules`
- Click Publish

### Storage CORS
Create a file `cors.json` in the repo root:
```json
[
  {
    "origin": ["https://www.sparkinnbohol.com", "https://admin.sparkinnbohol.com", "http://localhost:3000", "http://localhost:5173"],
    "method": ["GET", "POST", "PUT", "DELETE"],
    "maxAgeSeconds": 3600
  }
]
```
Then run:
```bash
gsutil cors set cors.json gs://your-firebase-storage-bucket
```
(Install `gsutil` via Google Cloud SDK if not already installed)

---

## Step 4 — Seed Firestore

Create the initial documents manually in the Firebase Console → Firestore:

### `settings/hotelConfig`
Fill in hotel name, address, contact, check-in/out times, etc. (see `plan/docs/BACKEND.md §settings/hotelConfig` for all fields)

### `settings/websiteContent`
Fill in homepage hero, amenities, about page content, corporate page content, privacy policy body, cancellation policy, house rules.

### `rooms` collection
Create one document per room. Use the `value` keys from `hotel.config.ts → roomTypes[]` for the `type` field.

---

## Step 5 — Cloudflare Turnstile

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Turnstile (left sidebar)
2. Click **Add widget**
   - Name: `spark-inn`
   - Hostname: `sparkinnbohol.com`
   - Widget type: **Managed** (invisible to users)
3. Copy the **Site Key** → goes in `VITE_TURNSTILE_SITE_KEY`
4. Copy the **Secret Key** → goes in `TURNSTILE_SECRET_KEY`

---

## Step 6 — Resend

1. Go to [resend.com](https://resend.com) → Sign up
2. Add a domain → follow DNS verification steps for `sparkinnbohol.com`
3. API Keys → Create API key → copy it → goes in `RESEND_API_KEY`
4. Verified sending address: `sparkinn.dev@gmail.com`

---

## Step 7 — Environment Variables

### `guest-app/.env`
Create this file (copy from `guest-app/.env.example`):
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_TURNSTILE_SITE_KEY=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
RESEND_API_KEY=
RESEND_FROM_EMAIL=sparkinn.dev@gmail.com
ADMIN_NOTIFICATION_EMAIL=sparkinn.dev@gmail.com
TURNSTILE_SECRET_KEY=
```

### `admin-app/.env`
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GUEST_APP_URL=https://www.sparkinnbohol.com
```

> **Note on `FIREBASE_PRIVATE_KEY`:** The private key contains newlines. Wrap the entire value in double quotes in the `.env` file exactly as shown above.

---

## Step 8 — Run Locally

```bash
# Terminal 1 — Guest app + API
cd guest-app
vercel dev
# Runs on localhost:3000

# Terminal 2 — Admin app
cd admin-app
npm run dev
# Runs on localhost:5173
```

> Install Vercel CLI first if needed: `npm i -g vercel`
> Run `vercel login` and `vercel link` inside `guest-app/` before first use.

---

## Step 9 — Push to GitHub

```bash
git add .
git commit -m "feat: initial project setup"
git push origin dev
```

---

## Step 10 — Vercel Deployment

### Guest App + API
1. Go to [vercel.com](https://vercel.com) → Add New → Project
2. Import your `spark-inn` GitHub repo
3. Configuration:
   - **Project Name:** `spark-inn-guest`
   - **Root Directory:** `guest-app` ← click Edit to set this
   - **Framework Preset:** Vite (auto-detected)
4. Add environment variables — copy everything from `guest-app/.env`
5. Click **Deploy**

### Admin App
1. Vercel → Add New → Project
2. Import the **same** `spark-inn` GitHub repo
3. Configuration:
   - **Project Name:** `spark-inn-admin`
   - **Root Directory:** `admin-app` ← click Edit to set this
   - **Framework Preset:** Vite (auto-detected)
4. Add environment variables — copy everything from `admin-app/.env`
5. Click **Deploy**

---

## Step 11 — Custom Domains

### Guest App
1. Vercel → `spark-inn-guest` project → Settings → Domains
2. Add `www.sparkinnbohol.com`
3. Add the DNS records Vercel shows you in your domain registrar

### Admin App
1. Vercel → `spark-inn-admin` project → Settings → Domains
2. Add `admin.sparkinnbohol.com`
3. Add the DNS records in your domain registrar

> DNS changes can take up to 24 hours to propagate, but usually under 1 hour.

---

## Step 12 — Create First Admin Account

1. Go to Firebase Console → Authentication → Users → Add user
2. Email: hotel owner's email, set a temporary password
3. In Firestore → `guests` collection → create a document for this user with `role: "admin"`
4. Set Firebase Auth custom claim via Firebase Admin SDK (or a one-time script):
   ```
   admin.auth().setCustomUserClaims(uid, { role: 'admin' })
   ```
5. Share credentials with hotel owner — instruct them to change password on first login

---

## Step 13 — Verify Everything

- [ ] Guest site loads at `www.sparkinnbohol.com` with correct branding
- [ ] Admin site loads at `admin.sparkinnbohol.com` — login works
- [ ] Rooms display on guest site
- [ ] Complete a test booking end-to-end
- [ ] Confirmation email received
- [ ] Booking appears in admin dashboard
- [ ] Payment proof upload works
- [ ] Intercom QR scan opens chat

---

## Redeploying for a New Hotel Client

Follow the same steps but:
- Create a new Firebase project
- Create a new GitHub repo (fork or copy this one)
- Update `hotel.config.ts` with client brand
- Replace `public/brand/` assets in both apps
- Set up new Vercel projects pointing to the new repo
- Seed Firestore with client's room inventory and settings

See `plan/docs/WHITE-LABEL.md` for the full client deployment checklist.

---

*Setup Guide — Spark Inn v1.0 — June 8, 2026*
