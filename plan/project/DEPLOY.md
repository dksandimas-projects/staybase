# Production Launch Guide
> Spark Inn reference deployment — staging + production cutover procedure
> Last updated: June 15, 2026

This guide covers the full pre-launch → staging → production cutover flow for the Spark Inn deployment. The same steps apply to any white-label client of this codebase, with `sparkinnbohol.com` and `spark-inn-stg-7a7ad` substituted per client.

---

## 1. Pre-launch checklist (code-side)

Before tagging the staging release, run these checks from the repo root.

```bash
# 1. All tests pass
npm test                # shared + guest-app
npm run build:guest
npm run build:admin

# 2. Typecheck
npm run typecheck

# 3. Verify ROADMAP Phase 0–10B closed
# (manual — review plan/project/ROADMAP.md progress table)

# 4. Verify env files match .env.example templates
diff guest-app/.env.example guest-app/.env   # local only — .env is gitignored
diff admin-app/.env.example admin-app/.env

# 5. Confirm vercel.json cron + CSP headers
cat vercel.json
```

Expected: `npm test` → 90+ tests passing; both builds succeed; typecheck clean; Phase 0–10B shows 0 remaining; `vercel.json` has the checkin-reminder cron entry and the security headers.

---

## 2. Firebase project state

| Resource | Value | Notes |
|---|---|---|
| Firebase project ID (staging) | `spark-inn-stg-7a7ad` | used in all `.env` files |
| Firebase project ID (production) | TBD at promotion | create new project for prod |
| Firestore rules | `firebase/firestore.rules` | covers all 14 collections |
| Storage rules | `firebase/storage.rules` | payment-proof / discount-id / guest-id staff-only |
| Auth providers | Email/Password + Google | Google must be enabled in Console |
| Authorized domains | localhost, Vercel preview, `www.sparkinnbohol.com`, `admin.sparkinnbohol.com` | add per Vercel deployment |

**Google Sign-In provider**: must be enabled in Firebase Console → Authentication → Sign-in method → Google. Use the project's public-facing OAuth client ID and secret. Add `support@sparkinnbohol.com` as the project support email.

**Authorized domains**: Firebase Console → Authentication → Settings → Authorized domains. Add:
- `localhost`
- Vercel-generated preview URLs (`*-git-dev-<team>.vercel.app`)
- `www.sparkinnbohol.com` (prod guest)
- `admin.sparkinnbohol.com` (prod admin)
- `staging.sparkinnbohol.com` (staging guest, if used)
- `staging-admin.sparkinnbohol.com` (staging admin, if used)

---

## 3. Environment variables

`guest-app/.env.example` and `admin-app/.env.example` are the source of truth for required variables. Each variable must be set in Vercel project settings for both apps.

### guest-app
| Variable | Staging value | Production value | Visibility |
|---|---|---|---|
| `VITE_FIREBASE_API_KEY` | (Firebase web API key) | (production web API key) | Public (browser) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `spark-inn-stg-7a7ad.firebaseapp.com` | `<prod>.firebaseapp.com` | Public |
| `VITE_FIREBASE_PROJECT_ID` | `spark-inn-stg-7a7ad` | (production project ID) | Public |
| `VITE_FIREBASE_STORAGE_BUCKET` | (staging bucket) | (production bucket) | Public |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | (staging sender ID) | (production sender ID) | Public |
| `VITE_FIREBASE_APP_ID` | (staging app ID) | (production app ID) | Public |
| `VITE_TURNSTILE_SITE_KEY` | (Cloudflare public site key) | (production site key) | Public |
| `FIREBASE_PROJECT_ID` | (staging) | (production) | Server only |
| `FIREBASE_CLIENT_EMAIL` | (staging service account) | (production service account) | Server only |
| `FIREBASE_PRIVATE_KEY` | (staging service account private key) | (production private key) | Server only |
| `RESEND_API_KEY` | (Resend API key) | (production Resend key) | Server only |
| `RESEND_FROM_EMAIL` | (verified sender) | (production verified sender) | Server only |
| `ADMIN_NOTIFICATION_EMAIL` | (staff notification email) | (production staff email) | Server only |
| `TURNSTILE_SECRET_KEY` | (Cloudflare secret) | (production Cloudflare secret) | Server only |
| `CRON_SECRET` | (Vercel cron secret) | (production cron secret) | Server only |

### admin-app
| Variable | Notes |
|---|---|
| `VITE_FIREBASE_*` (same as guest) | uses same Firebase project |
| `VITE_GUEST_APP_URL` | `https://www.sparkinnbohol.com` (links from admin to booking pages) |

---

## 4. Vercel deployment

### Two Vercel projects
Deploy `guest-app/` and `admin-app/` as two separate Vercel projects from the same monorepo. Each project must set its own root directory so Vercel detects the correct app, build output, and project-local `vercel.json`.

### Project settings
- **Root directory (guest-app project)**: `guest-app` (critical: this is where the public site and `api/` functions live)
- **Root directory (admin-app project)**: `admin-app`
- **Build command**: leave default; Vercel uses the respective `package.json` build script
- **Output directory**: leave default (`dist`)

Do not leave the root directory unset. If the guest project is deployed from the monorepo root instead of `guest-app`, Vercel can serve the SPA for `/api/*` instead of invoking the serverless function.

### Custom domains
- `www.sparkinnbohol.com` → `guest-app` production
- `admin.sparkinnbohol.com` → `admin-app` production
- Vercel auto-issues TLS via Let's Encrypt.

### Headers and cron
Each Vercel project reads the `vercel.json` in its configured root directory:
- `guest-app/vercel.json` configures the guest/API project headers, SPA fallback, and daily checkin-reminder cron at `0 0 * * *` (midnight UTC) → `/api/email/checkin-reminder` with `CRON_SECRET` auth
- `admin-app/vercel.json` configures the admin dashboard headers and SPA fallback

---

## 5. Domain & DNS

| Domain | Registrar | DNS | Notes |
|---|---|---|---|
| `sparkinnbohol.com` | TBD (e.g. Cloudflare Registrar) | A record → Vercel IPs; CNAME for `www` and `admin` | Primary domain |
| `www.sparkinnbohol.com` | (apex) | CNAME → Vercel app | Guest app |
| `admin.sparkinnbohol.com` | (apex) | CNAME → Vercel app | Admin app |

DNS records propagate in 5 min (Cloudflare) to 48 h (other registrars). Verify with `dig` or `nslookup` before cutting over.

---

## 6. Initial data seeding

Before opening the booking engine to the public, seed Firestore with the canonical data.

### Hotel config
`settings/hotelConfig` document — fields per `plan/docs/BACKEND.md §settings/hotelConfig`:
- `hotelName`, `legalName`, `tagline`
- `address.*` (used for JSON-LD structured data)
- `contactEmail`, `contactPhone`, `frontDeskPhone`
- `checkInTime`, `checkOutTime`
- `facebookUrl`, `instagramUrl`
- `intercomQuickRequests[]` (default: ["Extra Towels", "Bottled Water", "Room Cleaning", "Do Not Disturb"])
- `notificationSoundUrl` (audio file URL in Firebase Storage)

### Website content
`settings/websiteContent` document:
- `homepage.heroHeading`, `heroSubtext`, `heroPhotoUrl`
- `homepage.amenities[]`
- `homepage.featuredRoomIds[]` (3 selected rooms)
- `homepage.sparkRewards.heading`, `description`, `isEnabled`
- `about.heroPhotoUrl`, `missionStatement`, `visionStatement`, `hotelStory`
- `corporate.heroHeading`, `heroSubtext`, `heroPhotoUrl`, `perks[]`
- `services[]` (tour packages, car rentals)
- `privacyPolicyBody`, `cancellationPolicy`, `houseRules`, `privacyPolicyLastUpdated`

### Rewards config
`settings/rewardsConfig`:
- `pointsEnabled`, `earningMode` ("per-booking" | "per-spend")
- `pointsPerBooking`, `pointsPerHundred`
- `memberDiscountEnabled`, `memberDiscountPct`
- `pointsRedemptionRate`

### Breakfast config
`settings/breakfastConfig`:
- `isEnabled`, `ratePerPersonPerNight`
- `silogItems[]` (with `isActive` toggle per item)

### Store config
`settings/storeConfig`:
- `isEnabled`, `lowStockThreshold`
- `paymentMethods[]` (CoD, Add-to-Bill, GCash with QR URL + account info)

### Rooms
`rooms` collection — 14 documents, one per physical room. Each:
- `roomNumber`, `name`, `type` (matches `DEFAULT_ROOM_TYPES` in `shared/constants/index.ts`)
- `maxCapacity`, `bedDefinition`
- `pricePerNight`, `weekendRate`, `corporateRate`
- `amenities[]`, `imageUrls[]` (3-5 high-quality photos)
- `isActive`, `status` ("available" | "occupied" | "blocked"), `housekeepingStatus`, `blockReason`
- `remarks`, `qrToken` (unique UUID for QR code generation)

### Vouchers
`vouchers` collection — optional initial promo codes (e.g. `WELCOME10` for 10% off first stay).

---

## 7. Staging release (25% payment milestone)

### Step 7.1 — Tag staging
```bash
git checkout main
git pull origin main
git merge --ff-only dev    # or merge commit if dev has diverged
git tag -a v0.9.0 -m "Staging release — client review"
git push origin main --tags
```

Vercel auto-deploys the `main` branch to the production domains. For staging-only deployment, use a `staging` branch and Vercel preview deployments.

### Step 7.2 — Share with client
- Send staging URL: `https://www-staging.sparkinnbohol.com` (or Vercel preview URL)
- Share admin credentials (created in step 7.4)
- Provide test booking reference + intercom test script

### Step 7.3 — Client review session
Walk through:
- Homepage, rooms page, booking flow (Step 1 → 4)
- Booking lookup (`/my-booking`)
- Intercom chat from a test room
- Admin dashboard, bookings management, folio, registration PDF
- Spark Rewards sign-up + member portal
- Reports, settings
- Store orders (Spark Essentials)

### Step 7.4 — Create the hotel owner admin account
The first admin is created via the Firebase Admin SDK. Run once during staging setup:

```bash
# Use the API route /api/admin/create-staff
curl -X POST https://<guest-app-staging-url>/api/admin/create-staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <existing-admin-id-token>" \
  -d '{
    "email": "owner@sparkinnbohol.com",
    "password": "<strong-password>",
    "displayName": "Hotel Owner",
    "role": "admin",
    "phone": "+63 ..."
  }'
```

This creates:
- Firebase Auth user with `role: admin` custom claim
- `guests/{uid}` profile mirror with `isActive: true`
- Allows sign-in at `admin.sparkinnbohol.com/login`

### Step 7.5 — Collect and address feedback
Use a shared feedback doc (e.g. `plan/project/FEEDBACK-staging.md`) for client notes. Address critical issues, defer non-critical to post-launch.

---

## 8. Production launch

### Step 8.1 — Create production Firebase project
1. Firebase Console → Add project → name "Spark Inn Prod"
2. Enable Authentication, Firestore, Storage
3. Copy web app config + service account JSON
4. Update production `.env` values
5. Deploy rules: `firebase deploy --only firestore:rules,storage --project <prod>`

### Step 8.2 — Seed production Firestore
1. Open admin app at production URL
2. Use the hotel owner admin account created in staging (or create a new one in production)
3. Navigate to Settings → Hotel Info, Website Content, etc. — populate all fields
4. Navigate to Room Management — add the 14 rooms with real photos
5. Navigate to Breakfast, Store, Rewards — verify all configs

### Step 8.3 — Promote to v1.0.0
```bash
git checkout main
git pull origin main
# Bump version to 1.0.0
npm version major    # or: edit shared/VERSION.ts directly
git add shared/VERSION.ts
git commit -m "release: v1.0.0 — production launch"
git tag -a v1.0.0 -m "Production launch"
git push origin main --tags
```

The `release:` commit prefix triggers Husky's auto-version (major bump from 0.x to 1.0.0).

### Step 8.4 — Configure custom domains
In Vercel project settings → Domains:
1. Add `sparkinnbohol.com` (apex) — Vercel will provide A records
2. Add `www.sparkinnbohol.com` (guest app) — CNAME to Vercel
3. Add `admin.sparkinnbohol.com` (admin app) — CNAME to Vercel

Update DNS at registrar per the records Vercel shows. Wait for propagation, then verify in Vercel dashboard that domains show "Valid Configuration".

### Step 8.5 — Set Firebase API key restrictions
Firebase Console → Project settings → API keys → your web API key → Application restrictions:
- **HTTP referrers** (web): add `sparkinnbohol.com`, `*.sparkinnbohol.com`, `localhost` (for dev), Vercel preview domains
- This blocks API key abuse from unauthorized domains

### Step 8.6 — Verify production deployment
- [ ] `https://www.sparkinnbohol.com` loads, returns 200
- [ ] `https://admin.sparkinnbohol.com` loads, login works
- [ ] TLS certificate valid (green padlock)
- [ ] CSP headers present (DevTools → Network → Response Headers → `content-security-policy`)
- [ ] Test booking end-to-end (Step 1 → 4 → admin confirm)
- [ ] Test intercom from a real room QR
- [ ] Test email delivery (booking submitted, payment confirmed, etc.)
- [ ] Verify cron at midnight UTC sends check-in reminders

### Step 8.7 — Client handoff
Schedule a 1-2 hour training session covering:
- Daily booking management (search, filter, confirm, cancel)
- Walk-in booking creation
- Folio view + on-site payment recording
- Discount verification (Senior/PWD)
- Intercom inbox (chat, store orders, voice calls)
- Spark Rewards member management
- Settings (hotel info, breakfast, store, rewards, legal content)
- Reports (revenue, occupancy, payment breakdown)
- Guest Registration PDF (check-in flow)
- Store order lifecycle (placed → delivered → billed)
- Account creation for additional staff (front-desk role)

---

## 9. Post-launch monitoring (first 30 days)

| Metric | Tool | Frequency |
|---|---|---|
| Booking conversion rate | Admin Reports → Performance | Weekly |
| Email delivery success | Resend dashboard | Daily |
| API error rate | Vercel Functions logs | Daily |
| Page load time (guest) | Vercel Speed Insights | Weekly |
| Firestore read/write quota | Firebase Console → Usage | Weekly |
| Storage egress | Firebase Console → Usage | Weekly |
| Intercom message volume | Admin Inbox | Daily |
| Spark Rewards signups | Admin Members page | Weekly |

Set up alerts:
- Resend: bounce rate > 5%
- Firebase: budget alert at 50% / 80% / 100% of Blaze plan
- Vercel: function execution errors > 1%

---

## 10. Rollback procedure

If a critical bug is found in production:

1. **Identify the bad commit**:
   ```bash
   git log --oneline -20
   ```
2. **Revert on main** (preferred for clean history):
   ```bash
   git checkout main
   git revert <bad-sha>
   git push origin main
   ```
3. **Force-rollback** (only for emergencies):
   ```bash
   git checkout main
   git reset --hard <good-sha>
   git push --force-with-lease origin main
   ```
4. **Roll back Firestore data** (if needed) — export from Firebase Console → Firestore → Import/Export before any destructive change. Use Firebase CLI to restore from a JSON export.

Vercel keeps all deployments in the dashboard; one-click rollback to any previous deployment is available at the project level.

---

## 11. References

- `plan/project/ROADMAP.md` — full feature checklist
- `plan/docs/BACKEND.md` — Firestore schema for all 14 collections
- `plan/docs/API-ROUTES.md` — API surface and rate limits
- `plan/docs/SECURITY.md` — security policy summary
- `firebase/firestore.rules` + `firebase/storage.rules` — production rules
- `CONTRIBUTING.md` — branch retention and Conventional Commits rules
- `vercel.json` — security headers and cron config
