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

| Trigger | API Route | Recipient | When |
|---|---|---|---|
| Booking submitted | `/api/email/booking-submitted` | Guest | Immediately after booking creation |
| Payment confirmed | `/api/email/payment-confirmed` | Guest | When staff confirms payment |
| Booking confirmed | `/api/email/booking-confirmed` | Guest | When status set to `confirmed` |
| Check-in reminder | `/api/email/checkin-reminder` | Guest | 1 day before `checkIn` date |
| Booking cancelled | `/api/email/booking-cancelled` | Guest | When booking cancelled (by guest or staff) |
| New corporate inquiry | `/api/email/corporate-inquiry` | Staff (admin email) | When inquiry form submitted on guest site |
| Discount rejected | `/api/email/discount-rejected` | Guest | When staff rejects Senior/PWD discount ID |

### Email Content Checklist

- [ ] All emails include: spark inn logo, hotel name, address, contact
- [ ] Booking submitted: acts as an acknowledgment/receipt submission, warning the guest that their booking and payment are under review and a final confirmation email will follow after manual verification; includes booking ref, room, dates, payment instructions, link to `/my-booking`
- [ ] Payment confirmed: receipt of payment, full booking summary
- [ ] Booking confirmed: final confirmation, check-in time, check-in instructions
- [ ] Check-in reminder: room details, check-in time, hotel address, contact
- [ ] Booking cancelled: cancellation confirmation, reason (if provided)
- [ ] Corporate inquiry: inquiry details (company, contact, dates, requirements), link to admin dashboard
- [ ] Discount rejected: see §Discount Rejected Email below

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
- [ ] Triggered server-side via `/api/email/discount-rejected` (staff-auth required)
- [ ] Restored `totalPrice` fetched from booking document at send time — never computed client-side
- [ ] `discountRejectionReason` included in email only if non-empty
- [ ] Discount type label: "Senior Citizen" if `discountType == "senior"`, "PWD" if `discountType == "pwd"`
- [ ] ID label: "OSCA Card" if senior, "PWD ID" if pwd

---

### Email Logic Checklist

- [ ] All email routes validate Firebase ID token (staff routes) or accept booking ref + email for guest-triggered resend
- [ ] Check-in reminder: implement via a scheduled Vercel cron job or trigger on booking confirmation — checks all `confirmed` bookings where `checkIn = tomorrow`
- [ ] Resend client initialized once in `api/lib/resend.ts`
- [ ] Email templates defined server-side as HTML strings or React Email components
- [ ] On Resend API error: log error server-side, return error response — do not silently fail

---

## PDF Generation (jsPDF)

### Booking Confirmation Receipt

Used in: Bookings Management (print/download), email attachment option.

**Receipt contents:**
- spark inn logo
- Hotel name + address + contact
- Document title: "Booking Confirmation Receipt"
- Booking reference + confirmation date/time
- Guest name, room type + room number
- Check-in / check-out dates + number of nights
- Number of guests, rate per night, total amount
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
- [ ] Apollo and Inter fonts embedded as base64 — see `plan/docs/GOTCHAS.md §jsPDF`
- [ ] spark inn logo embedded as base64 image
- [ ] PDF generated client-side in `admin-app` — no server round-trip needed
- [ ] Print from browser option (opens print dialog)
- [ ] Download as PDF option (`jsPDF.save()`)
- [ ] Email receipt: send PDF as attachment via `/api/email/booking-confirmed`

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
- [ ] PDF pre-filled from booking data where available (name, room, dates, guest registration fields)
- [ ] Guest ID photo fetched from `booking.guestIdPhotoUrl` and embedded as base64 image in PDF — fetch via `XMLHttpRequest` or `fetch` before PDF generation, convert to base64, pass to `jsPDF.addImage()`
- [ ] If `guestIdPhotoUrl` is null/empty — render blank "Attach ID here" placeholder box instead
- [ ] ID image constrained to max width of half the page, aspect ratio preserved — never overflow page margins
- [ ] Breakfast section rendered dynamically based on `hasBreakfast` and number of nights × guests
- [ ] Silog items listed as checkboxes or options per cell — guest circles/checks their choice
- [ ] Printable — front desk prints and guest fills/signs physical copy
- [ ] Same font embedding requirements as receipt

---

## Firebase Storage Upload Patterns

Used for: room photos, payment proof screenshots, QR notification sounds, website content photos, store item photos, and guest/staff ID images.

### Checklist

- [ ] Always use `uploadBytes(ref, file)` + `getDownloadURL(ref)` pattern
- [ ] All image uploads must run through shared client compression before upload: `compressImageFile()` from `shared/utils/images.ts`
- [ ] Default compression target: max `1600x1600`, JPEG/WebP quality around `0.82`; feature screens may use smaller dimensions for thumbnails/catalog images
- [ ] Storage paths:
  - Room photos: `rooms/{roomId}/{filename}`
  - Payment proof: `bookings/{bookingId}/payment-proof/{filename}`
  - Guest ID photo: `bookings/{bookingId}/guest-id/{filename}` — staff-only read, same rule as payment proof
  - Discount ID photo: `bookings/{bookingId}/discount-id/{filename}` — staff-only read; uploaded by guest at booking Step 3 when Senior/PWD discount is selected
  - Store item photos: `store-items/{itemId}/{filename}`
  - Website photos: `settings/website-content/{section}/{filename}`
  - Notification sound: `settings/notification-sound/{filename}`
  - Logo/brand assets: `assets/branding/{filename}`
- [ ] Always store `getDownloadURL` result in Firestore — never reconstruct Storage URLs manually
- [ ] File type validation before upload (images: jpg/png/webp; audio: mp3/wav)
- [ ] File size limit enforced client-side before compression and upload (source images: 5MB, audio: 2MB)
- [ ] Store the compressed `File` in Storage; never upload the original full-size image unless the feature explicitly requires archival quality
- [ ] Upload progress indicator for user-facing uploads
- [ ] Firebase Storage CORS must be configured — see `plan/docs/GOTCHAS.md`

---

## Manual QA

- [ ] Complete a booking — booking submitted email received by guest within 30 seconds
- [ ] Confirm payment in admin — payment confirmed email received by guest
- [ ] Cancel a booking — cancellation email received
- [ ] Check-in reminder arrives 1 day before check-in
- [ ] Generate receipt PDF in admin — opens with correct data, correct fonts, logo visible
- [ ] Print receipt from browser — print dialog opens with correct layout
- [ ] Download receipt PDF — file downloads and opens correctly
- [ ] Upload room photo — photo appears on guest rooms page
- [ ] Upload payment proof — viewable in booking detail drawer in admin

## References

- API routes: `plan/docs/API-ROUTES.md`
- Booking schema: `plan/docs/BACKEND.md §bookings`
- Storage CORS gotcha: `plan/docs/GOTCHAS.md §Firebase`
- Font embedding gotcha: `plan/docs/GOTCHAS.md §jsPDF`
- Receipt trigger in admin: `plan/features/BOOKINGS-MANAGEMENT.md`
- Payment proof upload in guest flow: `plan/features/BOOKING-FLOW.md §Step 3`
