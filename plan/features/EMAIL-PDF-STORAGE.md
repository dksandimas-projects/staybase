# Email, PDF & Storage
> App: both
> Phase: Phase 6 — Email System
> Requires: CLAUDE.md, docs/BACKEND.md, docs/API-ROUTES.md
> Design ref: N/A — backend + utility logic

## Overview

Covers three related concerns: Resend email flows via Vercel API routes, jsPDF receipt and registration form generation, and Firebase Storage upload patterns. These are shared utilities used across multiple features.

---

## Email Flows (Resend via Vercel API)

All email sent through Vercel API routes. From address: `sparkinn.dev@gmail.com` via Resend.

**All links inside emails (CTAs, my-booking magic links, intercom deep links, store-order chat cards, brand assets) are env-aware** (2026-07-24 fix) — they route through `siteUrl()` / `adminUrl()` in `guest-app/server/handlers/email.ts`, which resolve via `getServerBaseUrl()` / `getServerAdminBaseUrl()` in `guest-app/server/lib/siteUrl.ts`. On `VERCEL_ENV=production` → `https://www.${config.domain}`; on `VERCEL_ENV=preview|development` (the Vercel Preview deploy of `dev`) or unset → `https://stg.${config.domain}`. `SITE_URL` / `ADMIN_SITE_URL` env vars override for white-label clients whose staging host doesn't follow the `stg.` convention. See `plan/docs/ENV-SETUP.md` for the env var reference. SEO canonical URLs and OG image URLs stay hardcoded to production — they must always be the real public URL.

| Trigger | API Route | Recipient | When |
|---|---|---|---|
| Booking submitted | `/api/email/booking-submitted` | Guest | Immediately after booking creation |
| Payment confirmed | `/api/email/payment-confirmed` | Guest | When staff confirms payment |
| Payment rejected | *(inline booking trigger)* | Guest | When staff rejects an uploaded payment proof |
| Booking confirmed | `/api/email/booking-confirmed` | Guest | When status set to `confirmed` |
| Booking confirmed with balance *(CWB-02, decision #122)* | *(inline booking trigger)* | Guest | When staff confirms a `payment-uploaded` booking with a positive balance via `POST /api/bookings/confirm-with-balance`; balance + reason included in the body so the guest knows what to settle at check-in. Room type only (never room number — booking is not yet `checked-in`). |
| Booking rescheduled | *(inline booking trigger)* | Guest | When staff changes the assigned room or stay dates |
| Check-in reminder | `/api/email/checkin-reminder` | Guest | 1 day before `checkIn` date |
| Booking cancelled | `/api/email/booking-cancelled` | Guest | When booking cancelled (by guest or staff) |
| New corporate inquiry | `/api/email/corporate-inquiry` | Staff (admin email) | When inquiry form submitted on guest site |
| Corporate inquiry confirmation | *(inline trigger)* | Submitter (guest email) | Sent to submitter immediately after corporate inquiry submission |
| Contact inquiry | *(inline trigger)* | Staff (admin email) | Sent when the public contact form is submitted |
| Contact inquiry confirmation | *(inline trigger)* | Submitter (guest email) | Sent to submitter immediately after contact form submission |
| Discount rejected | `/api/email/discount-rejected` | Guest | When staff rejects Senior/PWD discount ID |
| Early check-in request | `/api/email/early-checkin-request` | Staff (admin email) | When Spark Rewards member requests early check-in for an upcoming booking |
| Early check-in resolution | *(inline trigger)* | Guest | When staff approves or declines an early check-in request |
| Voucher issued *(per `DECISIONS-FEATURES.md #104` — implemented in Phase 11.6 Batch 10)* | `/api/email/voucher-issued` | Guest | When admin creates a voucher with a non-empty `guestEmail` |
| Store order placed | `/api/email/store-order-placed` | Guest | When guest places a store order via Intercom Shop |
| Store order confirmed | `/api/email/store-order-confirmed` | Guest | When staff confirms the order (status: placed → confirmed) |
| Store order out for delivery | `/api/email/store-order-out-for-delivery` | Guest | When staff marks the order as out for delivery |
| Store order delivered | `/api/email/store-order-delivered` | Guest | When staff marks the order as delivered |
| Store order cancelled | `/api/email/store-order-cancelled` | Guest | When order is cancelled (by guest or staff) |
| New online booking | `/api/email/staff-new-booking` | Staff (`settings/hotelConfig.staffEmail`) | When a new online booking is created |
| New payment proof | `/api/email/staff-new-payment` | Staff (`settings/hotelConfig.staffEmail`) | When guest uploads GCash/bank payment proof |

### Email Content Checklist

- [x] All emails include: spark inn logo, hotel name, address, contact
- [x] **Bugfix — wrong logo variant on the dark email header** (owner request 2026-07-09): `guest-app/server/handlers/email.ts`'s `brandLogoUrl()` (~line 76-78) returns `config.logos.white` when rendering in a dark sidebar background.
- [x] Booking submitted: acts as an acknowledgment/receipt submission, warning the guest that their booking and payment are under review and a final confirmation email will follow after manual verification; includes booking ref, room, dates, payment instructions, link to `/my-booking`
- [x] Payment confirmed: receipt of payment, full booking summary
- [x] **Payment confirmed: optional House rules card** (ECE-01, 2026-07-24) — when `settings.websiteContent.houseRules` is non-blank, the payment-confirmed email appends a "House rules" card sourced from that setting so the guest arrives already knowing the property's expectations. Loaded non-transactionally by `sendBookingTrigger` (only for this template — other triggers skip the Firestore read); omitted entirely when the setting is blank or whitespace-only; HTML-escaped on render to prevent injection. Preview endpoint accepts `houseRules` in the request body so staff can sanity-check the card before saving the setting.
- [x] **Booking confirmed + check-in reminder: same House rules card** (ECE-02, 2026-07-26, decision #139) — extends ECE-01 so the same `settings.websiteContent.houseRules` card also appends to `booking-confirmed` + `checkin-reminder` (the two "you're arriving soon" touchpoints). The card-build logic is now a shared `houseRulesCard(houseRules)` helper inside `email.ts` so the three templates (`paymentConfirmedEmail` / `bookingConfirmedEmail` / `checkinReminderEmail`) all read from the same single-sourced string. `sendBookingTrigger` loads the setting via a `HOUSE_RULES_ACTIONS` Set (the three actions) so the doc read is still scoped — every other template still skips the Firestore round-trip. Omit-on-blank + HTML-escape contracts are unchanged. Preview endpoint accepts `houseRules` for the two new templates (mirrors the payment-confirmed preview contract). Tests: 19 new tests in `guest-app/tests/api/email-house-rules-ece02.test.ts` (live send + preview for both new templates, omit-when-blank for all three, no-roundtrip for non-arrival triggers, source-text guards on the helper + the gated Set + the preview routing). 1 existing ECE-01 source-text guard updated to pin the new `houseRulesCard(houseRules)` call instead of the prior inlined `houseRulesBlock` pattern.
- [x] Booking confirmed: final confirmation, check-in time, check-in instructions
- [x] Check-in reminder: room details, check-in time, hotel address, contact
- [x] Booking cancelled: cancellation confirmation, reason (if provided)
- [x] Corporate inquiry: inquiry details (company, contact, dates, requirements), link to admin dashboard
- [x] Corporate inquiry confirmation: warm acknowledgement, echoes back company name, rooms needed, and preferred dates; guest-facing only (no admin links)
- [x] Contact inquiry confirmation: warm acknowledgement, echoes back name, subject, and message; guest-facing only (no admin links)
- [x] Discount rejected: see §Discount Rejected Email below

### Discount Rejected Email

Triggered by `/api/email/discount-rejected` when staff rejects a Senior Citizen or PWD discount ID.

**Subject:** `Your discount request for Booking {bookingRef} could not be verified`

**Email contents:**
- Greeting: "Dear {guestName},"
- Opening: "Thank you for your booking at Spark Inn. We have reviewed your submitted ID for the {Senior Citizen / PWD} discount on Booking {bookingRef}."
- Rejection notice: "Unfortunately, we were unable to verify your {discount type} ID."
- Reason (if provided by staff): "Reason: {discountRejectionReason}" — omit this line if no reason was entered
- Payment notice: "Your booking remains confirmed. The full rate of **₱{restoredTotalPrice}** will be collected upon check-in. Please note that we still welcome you to present a valid {OSCA Card / PWD ID} at check-in for our team's manual review."
- Booking summary: booking ref, room, check-in date, check-out date, updated total
- CTA button: "View My Booking" → `/my-booking`
- Closing: "If you believe this is an error, please contact us at {config.contactEmail} or call {config.contactPhone}."
- Hotel contact block + footer

**Checklist:**
- [x] Triggered server-side via `/api/email/discount-rejected` (staff-auth required)
- [x] Restored `totalPrice` fetched from booking document at send time — never computed client-side
- [x] `discountRejectionReason` included in email only if non-empty
- [x] Discount type label: "Senior Citizen" if `discountType == "senior"`, "PWD" if `discountType == "pwd"`
- [x] ID label: "OSCA Card" if senior, "PWD ID" if pwd

---

### Email Logic Checklist

- [x] All email routes validate Firebase ID token (staff routes) or accept booking ref + email for guest-triggered resend
- [x] Check-in reminder: implement via Vercel Cron — checks all `confirmed` bookings where `checkIn = tomorrow`
- [x] Resend client initialized once in `api/lib/resend.ts`
- [x] Email templates defined server-side as HTML strings or React Email components
- [x] On Resend API error: log error server-side, return error response — do not silently fail

### Check-In Reminder Scheduling Decision

Use Vercel Cron for check-in reminders. The cron job runs once daily against `/api/email/checkin-reminder`; when the route receives a cron-authenticated request with no booking body, it queries confirmed bookings whose `checkIn` is tomorrow in `config.timezone` and sends one reminder email per matching booking.

`vercel.json` cron entry spec:
- Path: `/api/email/checkin-reminder`
- Schedule: daily at `0 0 * * *` UTC, which runs at 08:00 in Asia/Manila
- Auth: Vercel sends `Authorization: Bearer {CRON_SECRET}`; `CRON_SECRET` must be configured in Vercel and must not use a `VITE_` prefix
- Method: Vercel invokes cron paths with `GET`; the route also keeps staff-triggered `POST` support for manual resend/testing
- Idempotency: **required** *(Per `DECISIONS-FEATURES.md #83`)*. The cron sender writes `reminderSentAt: Timestamp` to the booking in the same transaction that sends the email, and the cron query filters `where("reminderSentAt", "==", null)`. Retries do not double-send.

---

## PDF Generation (jsPDF)

### Booking Confirmation Receipt

Used in: Bookings Management (print/download), email attachment option.

**Receipt contents:**
- spark inn logo
- Hotel name + address + contact
- Document title: "Booking Confirmation Receipt"
- Booking reference + confirmation date/time
- Guest name, room type *(room number intentionally omitted — see `refactor/room-number-visibility` change; the front desk assigns the physical room at check-in, and any pre-check-in number in the receipt would create a stale expectation if the assignment shifts)*
- Check-in / check-out dates + number of nights
- Number of guests, rate per night, total amount
- **Rate breakdown** — if `Booking.rateBreakdown` exists:
  - Room lines grouped by regular, weekend, seasonal/holiday, corporate, or manual source
  - Breakfast/add-on lines when present
  - Discount, voucher, Spark Rewards member discount, and points redemption deductions when present
  - Final total matching `booking.totalPrice`
- If `Booking.rateBreakdown` is missing — fall back to the legacy summary using locked `ratePerNight`, `numNights`, discounts/vouchers, and `totalPrice`
- Applied discount (type + %)
- Applied voucher code + discount (if any)
- Spark Rewards redemption — if `pointsRedeemed > 0`: "Spark Rewards: {X} pts redeemed = −₱{Y}" line item
- Special requests / notes
- **Payment breakdown** — if `bookings/{bookingId}/payments` subcollection has entries:
  - Section heading: "Payments Collected"
  - One row per payment: method, amount, date recorded
  - Total Collected: ₱{sum}
  - Outstanding Balance: ₱{totalPrice − totalCollected} — shown as ₱0 if fully settled, or outstanding amount in bold if not
- If no payments recorded — show "Payment Method: {paymentMethod}" and "Amount Due: ₱{totalPrice}" as before
- Footer: "This is a booking confirmation only. An official BIR receipt will be issued upon payment at the property."

**PDF checklist:**
- [x] PDF font handling is stable in browsers: use jsPDF built-in fonts unless known-good base64 TTF assets are added and verified. Do not reference missing font files or embed OTF files that jsPDF cannot encode reliably.
- [x] spark inn logo embedded as base64 image
- [x] PDF generated client-side in `admin-app` — no server round-trip needed
- [x] PDF actions open a tab synchronously when previewing generated PDFs and fall back to `jsPDF.save()` if popups are blocked.
- [x] Email receipt: send PDF as attachment via `/api/email/booking-confirmed`

### Guest Registration Form (PDF)

Used at check-in by front desk. Generated from booking data.

**Form contents:**
- Full name, nationality, address, DOB, gender, valid ID type + number
- Number of guests, room number, check-in date/time
- House rules agreement text
- Signature line
- **Guest ID photo** — if `booking.guestIdPhotoUrl` exists, embed as a scaled image below the signature line with label "Government-Issued ID" (RA 11862 compliance); if not yet uploaded, render a blank bordered box labeled "Attach ID here"
- **Breakfast section (shown only if `booking.hasBreakfast: true`):**
  - One row per guest, one column per night of stay
  - Each cell has a blank line or checkbox list of silog options for the guest to fill in
  - Silog options pulled from `settings/breakfastConfig.silogItems` at PDF generation time

**Checklist:**
- [x] Wireframe data capture exists in admin booking drawer for guest registry fields, ID photo preview, and breakfast choices
- [x] PDF pre-filled from booking data where available (name, room, dates, guest registration fields)
- [x] Guest ID photo fetched from `booking.guestIdPhotoUrl` and embedded as base64 image in PDF — fetch before PDF generation, convert to base64, detect MIME type, pass to `jsPDF.addImage()`
- [x] If `guestIdPhotoUrl` is null/empty — render blank "Attach ID here" placeholder box instead
- [x] ID image constrained to max width of half the page, aspect ratio preserved — never overflow page margins
- [x] Breakfast section rendered dynamically based on `hasBreakfast` and number of nights × guests
- [x] Silog items listed as checkboxes or options per cell — guest circles/checks their choice
- [x] Printable — front desk prints and guest fills/signs physical copy
- [x] Same stable jsPDF font fallback requirements as receipt

---

## Firebase Storage Upload Patterns

Used for: room photos, payment proof screenshots, QR notification sounds, website content photos, store item photos, and guest/staff ID images.

### Checklist

- [x] Always use `uploadBytes(ref, file)` + `getDownloadURL(ref)` pattern
- [x] All image uploads must run through shared client compression before upload: `compressImageFile()` from `shared/utils/images.ts`
- [x] Default compression target: max `1600x1600`, JPEG/WebP quality around `0.82`; feature screens may use smaller dimensions for thumbnails/catalog images
- [x] Storage paths:
  - Room photos: `rooms/{roomId}/{filename}`
  - Payment proof: `bookings/{bookingId}/payment-proof/{filename}`
  - Guest ID photo: `bookings/{bookingId}/guest-id/{filename}` — staff-only read, same rule as payment proof
  - Discount ID photo: `bookings/{bookingId}/discount-id/{filename}` — staff-only read; uploaded by guest at booking Step 3 when Senior/PWD discount is selected
  - Store item photos: `store-items/{itemId}/{filename}`
  - Website photos: `settings/website-content/{section}/{filename}`
  - Notification sound: `settings/notification-sound/{filename}`
  - Logo/brand assets: `assets/branding/{filename}`
- [x] Always store `getDownloadURL` result in Firestore — never reconstruct Storage URLs manually
- [x] File type validation before upload (images: jpg/png/webp; audio: mp3/wav)
- [x] File size limit enforced client-side before compression and upload (source images: 5MB, audio: 2MB)
- [x] Store the compressed `File` in Storage; never upload the original full-size image unless the feature explicitly requires archival quality
- [x] Upload progress indicator for user-facing uploads
- [x] Firebase Storage CORS must be configured — see `plan/docs/GOTCHAS.md`

---

## Manual QA

- [x] Complete a booking — booking submitted email received by guest within 30 seconds
- [x] Confirm payment in admin — payment confirmed email received by guest
- [x] Cancel a booking — cancellation email received
- [x] Check-in reminder arrives 1 day before check-in
- [x] Generate receipt PDF in admin — opens with correct data, correct fonts, logo visible
- [x] Print receipt from browser — print dialog opens with correct layout
- [x] Download receipt PDF — file downloads and opens correctly
- [x] Upload room photo — photo appears on guest rooms page
- [x] Upload payment proof — viewable in booking detail drawer in admin

## References

- API routes: `plan/docs/API-ROUTES.md`
- Booking schema: `plan/docs/BACKEND.md §bookings`
- Storage CORS gotcha: `plan/docs/GOTCHAS.md §Firebase`
- Font embedding gotcha: `plan/docs/GOTCHAS.md §jsPDF`
- Receipt trigger in admin: `plan/features/BOOKINGS-MANAGEMENT.md`
- Payment proof upload in guest flow: `plan/features/BOOKING-FLOW.md §Step 3`
