# Security & Privacy
> Requires: CLAUDE.md, docs/BACKEND.md, docs/API-ROUTES.md

---

## Overview

Spark Inn collects and processes guest Personal Identifiable Information (PII) including names, email addresses, phone numbers, and payment screenshots. As a Philippine-based business, the system must comply with the **Data Privacy Act of 2012 (RA 10173)** enforced by the National Privacy Commission (NPC). This document defines all security rules, PII handling policies, and compliance requirements.

---

## Data Privacy Act of 2012 (RA 10173) Compliance

### What We Collect & Why

| Data | Purpose | Legal Basis |
|---|---|---|
| Guest name, email, phone | Booking management, communication | Contractual necessity |
| Number of guests | Room capacity compliance | Contractual necessity |
| Payment method + proof screenshot | Payment verification | Contractual necessity |
| Special requests | Service delivery | Consent |
| Corporate company name, contact details | Corporate booking management | Contractual necessity |
| Intercom chat messages | Guest service | Legitimate interest |
| Nationality | Guest registration form (check-in) | Legal obligation (Hotel Code + RA 11862) |
| Valid ID type + ID number | Guest registration form (check-in) | Legal obligation (Hotel Code + RA 11862) |
| Guest ID photo (scan/photo of physical ID) | Uploaded by front desk at check-in, embedded in registration PDF | Legal obligation (RA 11862) |
| OSCA Card / PWD ID photo | Uploaded by guest at booking Step 3 when Senior/PWD discount selected — staff verifies before confirming discount | Legal basis for discount claim (RA 9994 / RA 10754) |
| Date of birth, gender, home address | Guest registration form (check-in) | Legal obligation (Hotel Code) |

### Data Subject Rights

Guests have the following rights under RA 10173. The hotel must be able to fulfill these upon request:

- **Right to be informed** — covered by the Privacy Policy page (`/privacy`) and consent checkbox at booking
- **Right to access** — guest can request a copy of their booking data via email to the hotel
- **Right to correction** — guest can request correction of inaccurate data
- **Right to erasure** — guest can request deletion of their data through `My Profile → Delete Account` (calls `/api/members/delete-account`, per W1.4 / decision #49 / audit S2.3) or by emailing the DPO. Hotel complies unless data is needed for legal/regulatory purposes (e.g. RA 11862 guest registry records within their 6-month retention window)
- **Right to object** — guest can object to processing for non-essential purposes
- **Right to data portability** — provide data in a readable format upon request

### Member Account Erasure Flow

Online account deletion (Spark Rewards) flows through the server-side `/api/members/delete-account` route. The handler runs an Admin SDK transaction and post-transaction cleanup in this order:

1. Verify Firebase ID token — UID of caller must match the member being erased
2. Body must include `{ confirmation: "erase-my-account" }` to prevent accidental POSTs
3. Transaction: for every booking with `memberId == uid`, write an anonymized audit record to `bookings/audit/records/{bookingId}` (contains `bookingRef`, `roomId`/`roomNumber`/`roomType`, `checkIn`/`checkOut`, `numNights`, `numGuests`, `totalPrice`, `status`, `source`, `createdAt`, `erasedAt`, `erasedByUid` — no PII) and then scrub the booking of `memberId`, `guestName`, `guestEmail`, `guestPhone`. Mark the member doc `isErased: true`, blank `fullName` / `email` / `phone` / `photoUrl`, zero `rewardsPoints`, and set `isActive: false`.
4. After the transaction commits, read every `members/{uid}/pointsHistory` doc and delete in a batch (Firestore transactions cannot list collections).
5. Delete the `members/{uid}` document outright.
6. Delete the Firebase Auth user via `adminAuth.deleteUser(uid)`. Treat `auth/user-not-found` as success (already gone).

Firestore rule for the new audit collection (`bookings/audit/records/{id}`): `allow read: if isStaff(); allow write: if false;`. Server-only writes, staff-only reads.

Guest registry records collected at physical check-in (nationality, ID type, ID number) are out of scope for this online erasure flow — they are retained for a minimum of 6 months per RA 11862. The deletion confirmation modal links to this policy so guests are not surprised.

### Data Protection Officer (DPO)

- The hotel owner/admin serves as DPO for this small operation
- DPO contact email must be listed on the Privacy Policy page
- DPO is responsible for handling data subject requests and NPC breach notifications

### Data Breach Protocol

If a breach occurs affecting guest PII:
1. Assess scope within 24 hours
2. Notify NPC within **72 hours** via `https://www.privacy.gov.ph`
3. Notify affected guests by email if breach poses serious harm
4. Document the incident in an internal breach log

### Data Retention

- Booking and guest data retained **indefinitely** for operational and historical records
- **Guest registry records (name, nationality, ID number) must be retained for a minimum of 6 months** per RA 11862 (Expanded Anti-Trafficking in Persons Act) — hotel cannot delete these within that window even upon erasure request
- Guests may request erasure of non-legally-required data — hotel evaluates on a case-by-case basis
- Payment proof screenshots retained for the duration of the booking + 1 year
- Intercom messages retained indefinitely (operational record)
- Staff accounts deleted when staff leave — data anonymized, not erased

### Privacy Notice

- Full Privacy Policy at `/privacy` on the guest site
- Terms of Service at `/terms` on the guest site
- Consent checkbox required at Step 2 (Guest Details) of booking flow
- Privacy Policy and Terms of Service links in footer of all public pages
- Privacy Policy link in all guest-facing booking confirmation emails

---

## Firestore Security Rules

Full rules in `firebase/firestore.rules`. Summary and intent:

### `rooms`
- Read: public (guests need to browse rooms)
- Write: authenticated staff or admin only
- Never expose `remarks` (internal notes) to guest-facing queries — filter server-side

### `bookings`
- Read: staff/admin only in Firestore client rules; guest lookup is server-side by booking ref + email
- Create: denied in Firestore client rules; all booking document creation is server-side via API route transaction
- Update: staff/admin only for the explicit operational field allowlist enforced with `diff().affectedKeys().hasOnly(...)`; status, pricing, rewards, and other finance fields are excluded
- Delete: admin only
- **Critical:** Direct client booking creation is NOT allowed. Public/corporate booking creation uses `/api/bookings/create`; staff walk-in/manual creation uses `/api/bookings/create-walkin`. Both routes use Admin SDK transactions and bypass Firestore client rules.
- **Guest-side availability UX query (per W4.7):** Firestore rules deny guest reads on `bookings`, so the booking page cannot subscribe to active bookings directly. The public endpoint `GET /api/rooms/availability?checkIn=...&checkOut=...` returns a PII-stripped list of overlapping active booked date ranges (`{ roomId, checkIn, checkOut, status }` only — no guest name, email, phone, or payment fields). Rate-limited to 30/IP/min. The actual double-booking prevention is the Firestore transaction in `/api/bookings/create`; this endpoint is a UX optimization only. **Never weaken Firestore rules to allow guest reads on `bookings` — the endpoint is the only sanctioned path.**
- **Staff operational updates:** Authenticated staff/admin may directly update only `guestIdPhotoUrl`, `guestRegistration`, `breakfastSelections`, `breakfastServed`, `discountVerified`, `discountVerifiedBy`, `discountRejected`, `notes`, `specialRequests`, `specialRequestsUpdatedAt`, `specialRequestsUpdatedBy`, `handledBy`, and `updatedAt`. The `specialRequests` field is a **staff-only closed-loop** write per `feat/staff-special-requests-capture` (2026-08-21) — the public `/book` form does not collect it (redirect to email/phone per `feat/special-requests-redirect`, commit 78a79f7); the front desk captures the request from email or phone through the booking drawer editor (in `BookingDrawerWorkspace.tsx`), the walk-in modal, or the calendar-create modal. The two metadata fields (`UpdatedAt` + `UpdatedBy`) are stamped by the server endpoint `/api/bookings/set-special-requests` in the same transaction. The intercom amber banner (`IntercomChatPanel.tsx`) and the calendar cell icon + tooltip are read-only displays — they show the stored value but do not write to it. (Per 2026-07-24 `refactor/unify-payment-reference-fields`: the previous `paymentReferenceNumber` allowlist entry was removed — staff no longer write a top-level reference; the canonical reference lives on each `bookings/{id}/payments/{paymentId}` entry's `transactionReference`, which is append-only at the rules level.)
- **Reservation linkage is server-only (MRB-01, 2026-08-02):** the four `reservation*` fields on a booking (`reservationId` + `reservationRef` + `reservationPosition` + `reservationRoomCount`) are server-assigned projections of the parent `reservations/{id}` document. The `affectedKeys().hasOnly([...])` allowlist above does NOT list them, so any client write that touches them is implicitly denied by omission. The pin test in `firebase/tests/reservation-rules.emulator.test.ts` (lands with MRB-02's emulator coverage per the PMH-05 framing) asserts the contract — a future refactor that accidentally widens the allowlist breaks the test. The `reservations/{id}` collection itself is server-authoritative (`allow read: if isStaff(); allow write: if false;`); guests never have direct access (the public lookup resolves a reservation via the pre-allocated `reservationId` + the verified email / token credential, gated by `/api/bookings/lookup` and `/api/bookings/cancel`). The `payments` and `charges` subcollections mirror the booking's money-shape rules (server-only create for `payments`, staff direct write with per-creator + bounds + void semantics for `charges`) so MRB-04's folio migration and MRB-07's refund state machine can land without a second rules change.
- **Server-only booking mutations:** Use API routes for every status transition and for operations that require transactions, guest identity checks, audit records, emails, pricing changes, or member-balance changes. Payment-proof verification uses `/api/bookings/mark-payment-confirmed`; direct client writes cannot change `status`, `totalPrice`, rate breakdowns, or rewards fields.
- **Incidental charge invariants:** Staff-created `bookings/{id}/charges` entries are append-only, capped at an absolute 1,000,000, and negative reversals must use the deterministic document ID `void-{voidOf}`. This enforces at most one reversal for each original charge.
- **Refund ledger invariants (CRL-01, 2026-08-01):** Refund entries live in the same `bookings/{id}/payments/{paymentId}` subcollection as payments and are admin-only (role gate at the route, not the rules). The client preallocates `refundId` (a Firestore-generated `bookings/{id}/payments/` doc ID) and the server creates the exact document via `transaction.create` so a server-side race that lost the existing-ID lookup still throws `ALREADY_EXISTS` rather than overwriting. An exact retry (same `refundId` + same amount/method/reason/transactionReference) replays the original commit; a same-ID-different-fields retry is a 409 conflict. The append-only rules shape (`allow create: if false` on the `payments/{paymentId}` match) is unchanged — no client can write a refund ledger entry directly. The preallocated `refundId` is therefore the canonical idempotency key, not a defense against client-side forgery.
- **Cancellation audit metadata (CRL-02, 2026-08-02):** Every cancellation path (`/api/bookings/cancel` for the staff + guest self-service flows; the 3 PEX-03 in-transaction retirement sites in `handleCreateBooking` / `handleCreateWalkin` / `handleRescheduleBooking`; the PEX-06 daily cron at `/api/holds/expire`) stamps `cancelledAt` + `cancelledBy` + `cancellationSource` in the same Firestore transaction as the `status: "cancelled"` flip. The fields are server-authoritative: the route derives `cancellationSource` from the auth check (`req.staff` truthy → `"staff"`, else `"guest"`), so a client cannot forge `"system"` or another operator's UID. `cancelledBy` for the guest path is the literal `"guest"` (no PII — the lookupToken / email are not stored on the booking); for staff it is the staff UID; for system (PEX auto-expiry) it is the literal `"system"`. Cancellation records are permanent: the existing `allow create: if false` + `allow update, delete: if false` rules shape for `bookings/{id}/payments/{paymentId}` does not extend to `bookings/{id}` updates, but every cancellation transaction is a write to the existing booking doc (status flip + audit stamps), not a delete, and no cancellation path clears the `cancellationReason` or the collected-money entries. The audit row is therefore immutable-by-convention and append-only.
- **Cancellation exception authorization (CRL-07, 2026-08-03, per decision #173):** The new `/api/bookings/cancellation-exception` endpoint is admin-only at the route — `req.staff?.role !== "admin"` returns 403, no other role (front desk, housekeeping, etc.) can apply an exception. The endpoint reduces `approvedAmount` below the stored `policyResult.policyRefund`; the `policyResult` is read-only (the exception never rewrites the policy result). The endpoint requires a non-empty reason (≤500 chars) and an `approvedAmount` that is `0 ≤ amount ≤ policyRefund` (a client-supplied amount above the policy is rejected 400). Rate-limited at 30/min/IP — a deliberate admin mutation, not a tap-and-confirm action. The `approvedBy` field is the staff UID, server-derived from the auth check (no client-supplied UID), so a non-admin cannot impersonate. The read-only `/api/bookings/cancellation-liability` projection is open to any authenticated-staff (the data is non-sensitive — no PII, just money-state numbers) so the admin drawer's panel can read the live state without re-deriving the cumulative `processedAmount` from the refunds subcollection client-side. The destructive cancel handler (which stamps the snapshot in the same transaction as the status flip) is unchanged in authorization — any staff role (not just admin) can cancel; only admins can record the processed refund or apply the exception, mirroring the existing `add-refund` admin-only gate.

### `guests`
- Read: owner (matching UID) or staff/admin
- Write: owner or admin only
- **Self-write allowlist (per `features/INTERCOM-AUDIO-ROUTING.md`):** the owner's `update` branch may only touch `fullName`, `displayName`, `phone`, `photoUrl`, `address`, `dateOfBirth`, `emergencyContact`, `preferences`, `audioRouting`, `audioRoutingUpdatedAt`, and `updatedAt`. `role`, `isActive`, `email`, and the staff-audit fields are reserved for admin / server. A non-admin user writing a missing `audioRouting` field is permitted; writing to anything else in the same call fails.

### `settings/hotelConfig` + `settings/websiteContent`
- Read: public (needed for guest site content)
- Write: admin only
- **Note:** `intercomQuickRequests` and `notificationSoundUrl` are in `hotelConfig` — public read is acceptable as these are non-sensitive
- **Note:** `websiteContent.{homepage,about,corporate,rewards,branding}` carry hero copy + photo URLs + logo URLs. Public read is acceptable — all data is non-sensitive marketing material. The `branding` sub-object enables the navbar logo override and the fix for the dark-on-dark logo visibility bug; URLs are public-read anyway because the guest site already serves them via `usePublicSiteContent`.

### Client-side cache for `settings/websiteContent` (localStorage)
- A non-sensitive snapshot of the resolved public site content is cached in `localStorage` (key `publicSiteContent:v1`, 5-minute TTL) so returning visitors get an instant render of the admin's custom hero images / logos / perks — no static-fallback flash while Firestore loads. Cached value is the **resolved** shape (custom URL or static fallback already applied) so the page can render directly from cache.
- TTL bounds staleness: an admin upload made while a public tab is open takes effect within 5 minutes (or on next page load). For instant cross-tab updates the admin tab writes directly to Firestore; the public tab will pick up the new value on the next mount or cache expiry.
- Cache writes and reads are no-ops on the server (no `window`), in private mode (`SecurityError`), and on quota errors — the public site is best-effort and still works without the cache.
- Implementation: `shared/utils/cache.ts` (`readCacheWithTtl`, `writeCache`, `clearCache`) + `PUBLIC_SITE_CONTENT_CACHE_KEY` / `PUBLIC_SITE_CONTENT_CACHE_TTL_MS` in `shared/constants/index.ts`.

### `corporateInquiries`
- Read/Write: staff/admin only
- Contains contact PII — never expose to guest-facing app
- Public guest submissions go through `/api/corporate/inquiry`; Firestore client-side creates are not allowed

### `corporateCodes`
- Read: staff/admin only — the prior `allow read: if true;` rule
  was tightened per BI-08 (booking-intercom audit 2026-07-06) so
  anonymous visitors can no longer dump every access code, company
  name, and negotiated `ratePerRoomType` via a collection query.
- Validation endpoint `/api/validate/corporate-code` is the only
   sanctioned path for the public — it returns only the rate map and
   the public code label, never the full document.
- Write: staff/admin

### `vouchers`
- Read: staff/admin only — same BI-08 tightening as
  `corporateCodes`. The public booking flow never reads the
  collection client-side; validation is via
  `/api/validate/voucher` (returns only discount type/value).
- Write: staff/admin

### `intercoms`
- Read/Write: open (no auth — anonymous QR chat)
- Mitigation: room ID required in URL (physical QR gate), no sensitive PII should be stored here

### `calls`
- Read/Write: open (`allow read, write: if true;` — same trust model as `intercoms`; the guest's SDP offer + the staff's SDP answer + ICE candidates all need public write so the peer-to-peer handshake can complete without auth)
- The `acceptedBy` field (decision #214, 2026-08-19) is staff-attribution data written by the `runTransaction` claim in `AdminContext.acceptCall` — currently any caller can write any `acceptedBy` payload. **Future hardening (filed in decision #214's "Security rule gap" paragraph):** narrow writes to `isStaff()` after the consent checkbox + per-room occupancy gate lands, while keeping reads public for the guest-side SDP handshake. Until then, the audit-trail value (knowing which staff took a call) is honoured by the chat thread's `call-answered` system message with `callAnsweredByName` — the rule layer is not the gate.
- Staff trained not to share PII (booking refs, payment details) via intercom chat

---

## Firebase Storage Security Rules

Full rules in `firebase/storage.rules`. Intent:

### Room photos (`rooms/{roomId}/{filename}`)
- Read: public
- Write: authenticated staff/admin only

### Payment proof (`bookings/{bookingId}/payment-proof/{filename}`)
- Read: authenticated staff/admin only — **never public**
- Write: anyone (guests upload during booking flow — use a time-limited upload token approach or validate booking context)
- Randomized object paths are stored in `paymentProofPath`; anonymous clients use local blob previews and never mint permanent download URLs
- Admin UI resolves the path through staff-authenticated `/api/storage/signed-url`, which returns a one-hour signed URL
- `bookingId` is preallocated by the booking flow before upload, then passed to `/api/bookings/create`; the API creates the booking document at that exact ID inside the transaction

### Discount ID photos (`bookings/{bookingId}/discount-id/{filename}`)
- Read: authenticated staff/admin only — **never public**
- Write: anyone (guests upload during booking flow before booking creation)
- Randomized object paths are stored in `discountIdPhotoPath` and use the same staff-authenticated signed-URL flow
- `bookingId` follows the same preallocated-ID contract as payment proof uploads

### Website content photos (`settings/website-content/**`)
- Read: public
- Write: admin only

### Notification sound (`settings/notification-sound/**`)
- Read: authenticated staff only
- Write: admin only

### Brand assets (`assets/branding/**`)
- Read: public
- Write: admin only

---

## API Route Security

### Authentication
- All staff API routes verify Firebase ID token via Admin SDK — see `plan/docs/API-ROUTES.md §Authentication`
- Never trust role, `isCorporate`, or `corporateCode` from client request body — always derive from verified token or server-side lookup

### Input Validation
- All API route inputs validated with Zod before processing
- Reject requests with unexpected fields (strict Zod schemas)
- Sanitize all string inputs — strip HTML/script tags

### Rate Limiting
- Implement rate limiting on public endpoints to prevent abuse:
  - `/api/bookings/create` — max 5 requests per IP per minute
  - `/api/corporate/inquiry` — max 5 requests per IP per minute
  - `/api/validate/voucher` — max 20 requests per IP per minute
  - `/api/validate/corporate-code` — max 10 requests per IP per minute
  - `/api/email/*` — max 3 requests per booking ref per hour
- Use Vercel Edge middleware or a simple in-memory rate limiter for Phase 1

### Booking Lookup Security
- `/my-booking` accepts ANY ONE of: booking ref, guest email, or per-booking lookup token. A truly empty body is rejected with 400.
- The endpoint is gated by Cloudflare Turnstile (per-attempt cost), a 10-req/min per-IP rate limit, and a 3-failure 1-hour backoff bucket. These are the load-bearing defenses against enumeration, not the second-factor.
- Refs are globally unique (`{prefix}-YYYYMMDD-NNN`, ~1000 keys per day) so an attacker would need to clear Turnstile + the rate limit per attempt, capping a single IP at ~72 attempts/day on a clean budget.
- Email-alone lookups return the most recent booking under that email. The error message ("Booking not found.") is identical whether the email doesn't exist or has no bookings, so the endpoint is not an email-existence oracle. Shared/aliased emails do not enumerate other guests' stays — the response shape is the same single-booking payload as the ref+email path.
- Token-alone and ref+token paths use the 32-char hex `lookupToken` (per H2, generated server-side at booking time). The token is never returned in lookup responses and is single-purpose for booking access.
- Cancel remains stricter: `ref + (email OR token)` is still required server-side, so a destructive action always needs a second factor. See `plan/features/BOOKING-LOOKUP.md §Data & Logic Checklist`.

---

## Intercom Security Model

The guest intercom is intentionally open (no login). Security is provided by:

1. **Physical gate** — QR code is in the physical room; guest must be present to scan it
2. **Room identification** — room number known from URL param at all times; staff always know which room is chatting
3. **Name prompt** — guest provides name before chatting (stored in local state, also sent with first message)
4. **No sensitive data in chat** — staff must not share booking refs, payment details, or PII via intercom; use the booking system for that

### Abuse Mitigation
- Rate limit messages per room per hour (e.g. max 30 messages per room per 10 minutes) — prevents chat spam
- Staff can mark a conversation resolved to deprioritize it
- Future: add block/mute per room if abuse becomes an issue (Phase 2)

---

## PII Handling Rules for Agents

- **Never log PII** — no `console.log(guestEmail)` or similar in any environment
- **Never expose booking documents directly** to guest-facing queries — always filter sensitive fields server-side
- **Payment proof URLs are private** — never render in guest-app, only in authenticated admin-app
- **Booking ref is not a secret** but email must match for lookup — do not display booking refs publicly
- **Intercom messages are not encrypted at rest** — staff should treat chat as internal, not share externally
- **`remarks` field on rooms** is internal — never include in guest-app API responses

---

## Bot & Spam Prevention

Three-layer approach — all free, no paid services required.

### Layer 1 — Cloudflare Turnstile (primary)

Cloudflare's invisible CAPTCHA replacement. Free with no usage limits. Real users see nothing — bots are blocked silently. Requires a free Cloudflare account.

**How it works:**
1. Turnstile widget renders invisibly on the booking form (Step 3) and corporate inquiry form
2. On form submit, Turnstile provides a one-time token client-side
3. API route verifies the token with Cloudflare's verification endpoint before processing the request
4. Invalid or missing token → request rejected with `400`

**Where to apply:**
- `/api/bookings/create` — booking creation (highest risk)
- `/api/corporate/inquiry` — corporate inquiry submission
- `/api/validate/voucher` — voucher validation
- `/api/validate/corporate-code` — corporate code validation

**Environment variables needed:**
- `TURNSTILE_SITE_KEY` — public, used in guest-app
- `TURNSTILE_SECRET_KEY` — private, used in api/ only (never expose client-side)

### Layer 2 — Honeypot Fields

Hidden form fields invisible to real users but filled by bots. Zero UX cost. Added to the booking form and corporate inquiry form.

**Implementation:**
- Add a hidden input field with a plausible name (e.g. `website`, `phone2`) — hidden via CSS, not `display:none` (bots see through `display:none`)
- If the field has any value on submission → reject silently (return `200` to not tip off the bot, but do not create booking)
- Check honeypot server-side in the API route before processing

### Layer 3 — Rate Limiting (already planned)

See `plan/docs/API-ROUTES.md §Rate Limiting`. Rate limiting is the final layer against brute-force and high-volume attacks that bypass Turnstile.

### What This Covers

| Threat | Turnstile | Honeypot | Rate Limiting |
|---|---|---|---|
| Automated form bots | ✅ | ✅ | ✅ |
| Headless browser bots | ✅ | — | ✅ |
| Manual spam (human) | — | — | ✅ |
| Brute-force validation | ✅ | — | ✅ |
| Fake corporate inquiries | ✅ | ✅ | — |

---

## Session Management

### Admin App
- Firebase Auth persistence set to `browserSessionPersistence` — session clears when the tab or browser closes; staff must re-login each shift
- Auto-logout after **8 hours of inactivity** — implemented client-side via a `setTimeout` reset on any user interaction; on timeout, call `signOut()` and redirect to `/login`
- Rationale: front desk computers may be shared or left unattended; session-scoped auth prevents unauthorized access between shifts

### Guest App (Spark Rewards)
- Firebase Auth persistence set to `browserLocalPersistence` — guests stay logged in across sessions for convenience
- No auto-logout — guests expect to stay signed in like any consumer app

### Brute Force Protection
- Firebase Auth enforces native rate limiting on sign-in attempts — no additional configuration required
- After repeated failed attempts, Firebase temporarily blocks the IP
- No custom lockout implementation needed for Phase 1

---

## Content Security Policy (CSP)

Configured in `vercel.json` for both apps. Purpose: prevent XSS by restricting which scripts can execute.

Key directives:
- `script-src 'self'` + explicit allowlist: Firebase SDK CDN, Cloudflare Turnstile, Sentry
- `frame-ancestors 'none'` — prevents clickjacking
- `media-src 'self' blob: data:` — required by the admin app's per-staff audio routing (Test tone + call ringtone). Both code paths build a `Blob` from a generated WAV `ArrayBuffer` and assign the URL to an `<audio>` element via `URL.createObjectURL`. Without an explicit `media-src`, the CSP falls back to `default-src 'self'`, which rejects `blob:` URLs with `Refused to load media from 'blob:...' because it violates the directive: "default-src 'self'"`. Regression test pinned in `admin-app/src/__tests__/feature-intercom-audio-routing.test.ts`.
- `X-Frame-Options: DENY` — legacy browser support
- `X-Content-Type-Options: nosniff` — prevents MIME-type sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`

Note: Framer Motion and all app JS are bundled at build time — no external script tags needed beyond the allowlist above.

---

## HTTPS & Infrastructure

- **Vercel** handles HTTPS for all deployments automatically — no configuration needed
- **Firebase** connections are TLS-encrypted by default
- **Environment variables** containing secrets never committed to git — see `plan/docs/ENV-SETUP.md`
- **Firebase API keys** in `guest-app` and `admin-app` are client-safe (Firestore rules are the real security layer) — but restrict API key usage in Firebase Console to specific domains

---

## Privacy Policy Page (`/privacy`)

Minimum required content (legal copy — DK or client to finalize with a lawyer if needed):

- Who we are (Spark Inn Hotel Corp, address, DPO contact email)
- What personal data we collect and why
- How long we keep it (indefinitely for bookings; guests may request deletion)
- Who we share it with (Resend for email delivery; Vercel/Firebase for infrastructure; no third-party marketing)
- Guest rights under RA 10173 and how to exercise them
- How to contact the DPO for requests or complaints
- Date of last update

See `plan/features/STATIC-PAGES.md §Privacy Policy` for UI implementation.

## Terms of Service Page (`/terms`)

Minimum required content is defined in `plan/docs/LEGAL.md §Guest Terms of Service`.

See `plan/features/STATIC-PAGES.md §Terms of Service` for UI implementation.

---

## Audit Remediation (2026-07-17)

- **X-01 (HIGH, fixed):** removed all public granular `get` grants from the three sensitive upload paths. Guest clients now upload to randomized filenames, retain only object paths, use local blob previews, and never call `getDownloadURL`; staff previews use the authenticated one-hour Admin SDK signed-URL route.

---

## References

- Firestore rules: `firebase/firestore.rules`
- Storage rules: `firebase/storage.rules`
- API authentication: `plan/docs/API-ROUTES.md §Authentication`
- Intercom guest experience: `plan/features/INTERCOM-GUEST.md`
- Privacy Policy page: `plan/features/STATIC-PAGES.md §Privacy Policy`
- Booking consent checkbox: `plan/features/BOOKING-FLOW.md §Step 2`
- PII gotchas: `plan/docs/GOTCHAS.md §Security`

---

## Legacy `kind: "single"` Lookup Branch (MRB-15-04, MRB-15-08)
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-04 + MRB-15-08 sub-items, shipped v0.251.0 + v0.255.0). The guest lookup endpoint `/api/bookings/lookup` returns `kind: "single"` for two distinct cases that share the same privacy posture: (a) N=1 reservations (a multi-room reservation of size 1 falls through to the per-child view — byte-equivalent to a single booking); (b) legacy pre-MRB-01 bookings (no `reservationId` — the historical single-booking path).

### Why the fall-through is privacy-positive

The reservation-scope branch (`kind: "reservation"`) is gated on BOTH conditions: `lookedUpReservationId.length > 0` (the booking has a header) AND `children.length > 1` (the reservation has more than one room). When either condition fails, the response falls through to `kind: "single"`, which carries only the per-child fields the pre-MRB-09 single-booking page already renders. A guest looking up a pre-MRB-01 booking never sees a `kind: "reservation"` shape — they see the exact same shape they saw pre-MRB-01 (byte-equivalent). The privacy posture is unchanged: no `guestName` reflected, `maskedEmail` instead of `guestEmail`, "Booking not found." for every zero-match case.

### Test coverage

`guest-app/tests/api/mrb-15-04-single-room-header-path.test.ts` (16 tests) + `mrb-15-08-legacy-fallback.test.ts` (19 tests) — 35 source-text tests pin the N=1 + legacy fall-through + the privacy posture on the lookup endpoint.
