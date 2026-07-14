# Contact Inquiries (`/contact` form)
> Requires: CLAUDE.md, `plan/features/STATIC-PAGES.md §Contact Us`, `plan/docs/DECISIONS-FEATURES.md #76`, `plan/docs/SECURITY.md §Bot & Spam Prevention`, `plan/docs/API-ROUTES.md`
> Audit reference: AUDIT-E2E-2026-06-15.md §1.6 SEV-2 (Contact), Phase 2 SEV-2 #6

Guests can send a custom message to the hotel from the `/contact` page. The form is backed by a real `/api/contact` endpoint with the same bot/spam controls as the corporate inquiry form (honeypot + Turnstile + rate-limit). The hotel is notified by email and the inquiry is stored for staff moderation.

> **Status: Completed and implemented in Phase 11.6 Batch 16.**

---

## UX Checklist

### Form layout (right column of the contact grid on `ContactPage`)
- [x] **Name** input — required, 1-120 chars, trimmed
- [x] **Email** input — required, valid format, trimmed, max 160 chars
- [x] **Subject** input — required, 1-160 chars, trimmed
- [x] **Message** textarea — required, 1-2000 chars, trimmed
- [x] **Submit** button — primary, disabled when form invalid or `isSubmitting === true`
- [x] **Loading state** — button label changes to "Sending..." with spinner (no `<Loader2>` mid-page; inline button label is fine)
- [x] **Success state** — green banner: "Thanks! We received your message and will reply within 24 hours." — auto-dismiss after 5s
- [x] **Error state** — red banner above the form with the server's error message, form values preserved

### Honeypot
- [x] Hidden `<input id="websiteUrl" name="websiteUrl">` inside the form, `position: absolute; opacity: 0; pointer-events: none; tabIndex={-1}` — matches the corporate inquiry pattern at `CorporateStaysPage.tsx:567-578`

### Empty/edge states
- [x] All fields empty on submit → inline red messages on each field
- [x] Email format invalid → inline red on email field
- [x] Subject > 160 chars → counter shows red, submit disabled
- [x] Message > 2000 chars → counter shows red, submit disabled
- [x] Honeypot filled (bot) → silent success after 1.2s delay (no real submission)
- [x] Turnstile challenge expired → server returns 400, client re-renders the widget
- [x] Rate-limited (>5 in 1 min) → server returns 429, client shows "Too many requests, please try again in a minute"

### Left column (unchanged)
- [x] Address card, phone card, email card, map embed, social links — all already implemented per `STATIC-PAGES.md §Contact Us §UI Checklist`

### Accessibility
- [x] All inputs have associated `<label>` (not just placeholder) with `htmlFor` linking to input `id`
- [x] `aria-invalid={Boolean(fieldError)}` and `aria-describedby={fieldError ? `${id}-error` : undefined}` on each input
- [x] Success/error banners have `role="status"` and `aria-live="polite"`
- [x] Submit button has visible focus ring (existing `focus:ring-2 focus:ring-primary` pattern)
- [x] Honeypot input has `aria-hidden="true"` and `tabIndex={-1}`
- [x] Character counters have `aria-live="polite"` so screen readers announce remaining chars

---

## Data & Logic Checklist

### API surface
- [x] `POST /api/contact` — public, body validated with Zod, no staff auth required
- [x] Returns `{ success: true, data: { inquiryId } }` on success
- [x] Returns `{ success: false, error: string }` on validation failure (400), bot detection silent-success (200), Turnstile failure (400), rate limit (429), or server error (500)

### Request schema (Zod, strict mode)
```ts
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2000),
}).strict();
```

Strict mode rejects any unexpected field (defense in depth per `SECURITY.md §Input Validation`).

### Bot/spam prevention
- [x] **Rate limit**: 5 requests per IP per 60 seconds (matches `/api/corporate/inquiry` at `[...route].ts:320`)
- [x] **Honeypot**: `_hp` field in body; if present and non-empty, return silent 200 success (matches `GOTCHAS.md` pattern)
- [x] **Turnstile**: server-side verification via shared `verifyTurnstile` helper (already exists at `[...route].ts:121-160`)

### Firestore write
- [x] New collection: `contactInquiries/{id}` — fields:
  - `name: string` (trimmed)
  - `email: string` (trimmed)
  - `subject: string` (trimmed)
  - `message: string` (trimmed)
  - `status: "new" | "read" | "replied" | "archived"` — default `"new"`
  - `createdAt: Timestamp`
  - `updatedAt: Timestamp`
  - `ipHash: string` — SHA-256 of the request IP (for rate-limit forensics, never store raw IP per `GOTCHAS.md §PII`)
  - `userAgent: string` — truncated to 200 chars

### Email notification
- [x] New template `contactInquiryEmail` in `guest-app/api/handlers/email.ts` — sent to `settings/hotelConfig.supportEmail`
- [x] New trigger `sendContactInquiryTrigger(inquiry)` exported from `email.ts`
- [x] Subject: `[${config.brandName}] New contact inquiry: ${inquiry.subject}`
- [x] Body: name, email (clickable mailto), subject, message (preserved line breaks), submitted timestamp, link to admin inquiries page
- [x] Email send failure is logged but does not break the API response (matches corporate inquiry pattern at `corporate-inquiries.ts:42-46`)
- [x] Submitter confirmation email template `contactConfirmationEmail` and trigger `sendContactConfirmationTrigger(inquiry)` sent to submitter's email address. Subject: `[${config.brandName}] We received your message`. Warm acknowledgement tone echoing name, subject, and message. Email send failure is caught, logged, and does not break the response.

### Firestore rules
- [x] Add `match /contactInquiries/{inquiryId}`:
  - `allow read: if isStaff()` — only staff can view inquiries
  - `allow create: if false` — API-only creation
  - `allow update, delete: if isStaff()` — staff can mark as replied/archived
- [x] Update `firebase/firestore.rules` accordingly

---

## UI Checklist (admin)
*(No admin UI in Phase 1. Staff checks email + reads `contactInquiries` via Firestore console. A future admin page can be added if volume grows.)*

---

## Edge Cases & States

- [x] **Email send fails** — API still returns 200 with the inquiry stored. `console.error` logs the failure. Hotel can still read the inquiry directly in Firestore.
- [x] **Firestore write fails** — API returns 500, client shows "We could not send your message right now. Please try again or email us directly at {supportEmail}."
- [x] **Guest uses a + alias email** (e.g. `maria+travel@gmail.com`) — accepted; we don't normalize.
- [x] **Guest pastes a 5000-char message** — client-side counter blocks at 2000; server also rejects (`max(2000)` in Zod schema).
- [x] **Spam burst from one IP** — rate limit kicks in at the 6th request per minute; subsequent requests get 429.
- [x] **Spam with valid Turnstile** (solved CAPTCHA) — still rate-limited; long-term we need either a Turnstile enterprise key with rate-aware scoring or a manual ban list. Out of scope for Phase 1.
- [x] **Support email not configured in `settings/hotelConfig`** — fall back to `config.supportEmail` (always set in `hotel.config.ts`). Log a warning.

---

## Manual QA

- [x] Desktop Chrome — fill all 4 fields → submit → green "Thanks!" banner → email arrives at `supportEmail` within 30s → inquiry visible in Firestore console
- [x] Desktop Chrome — empty submit → inline errors on each field, no API call
- [x] Desktop Chrome — invalid email format → inline error on email, no API call
- [x] Desktop Chrome — bot fills honeypot → 1.2s loading then green success, no Firestore write
- [x] Desktop Chrome — submit 6 times in 1 minute → 6th gets "Too many requests" error
- [x] iOS Safari (375px) — form is single-column, touch targets ≥ 44px, no horizontal scroll
- [x] Android Chrome (375px) — same
- [x] Screen reader (VoiceOver) — success/error announcements are heard
- [x] Keyboard only — Tab through all fields, submit via Enter
- [x] Slow network — loading state visible, no double-submit
- [x] Email send failure (simulate by disabling SendGrid key) — inquiry still stored, API still returns 200, error logged

---

## File-by-file build plan (for Phase 1)

1. **`guest-app/api/handlers/contact.ts`** *(new)* — `handleCreateContactInquiry` per the corporate-inquiry pattern
2. **`guest-app/api/handlers/email.ts`** — add `contactInquiryEmail` template + `sendContactInquiryTrigger` export, add `"contact-inquiry"` to `EmailAction` union
3. **`guest-app/api/[...route].ts`** — add `handleCreateContactInquiry` import, dispatch block for `/api/contact` (rate-limit + honeypot + Turnstile + handler)
4. **`guest-app/src/pages/ContactPage.tsx`** — replace `setTimeout` fake with `fetch("/api/contact", { method: "POST", body: JSON.stringify({ name, email, subject, message, _hp, turnstileToken }) })`
5. **`firebase/firestore.rules`** — add `match /contactInquiries/{inquiryId}` block
6. **`guest-app/api/__tests__/contact.test.ts`** *(new)* — 6-8 tests covering: valid submission, missing fields, invalid email, honeypot silent success, rate limit, Turnstile failure, email-send-failure fallback
7. **`plan/docs/API-ROUTES.md`** — add `/api/contact` row to the table
8. **`plan/project/AUDIT-E2E-2026-06-15.md`** — annotate SEV-2 #6 as fixed in the build commit

---

## Effort estimate

- **S** (1 day): one new handler, one email template, one route dispatch, ContactPage wiring, 1 new Firestore rule, 6-8 tests, doc updates.

## Dependencies

- Blocks: nothing
- Blocked by: nothing
- Parallelizable with: other Phase 1 SEV-1 fixes (storage rule, CORS, member-discount server-side, email-case, members-page real listener)

## Reference

- Pattern: `guest-app/api/handlers/corporate-inquiries.ts:1-59`
- Pattern: `guest-app/api/handlers/email.ts:corporateInquiryEmail` template
- Spec: `STATIC-PAGES.md §Contact Us`
- Decisions: `DECISIONS-FEATURES.md #76`
- Security: `SECURITY.md §Bot & Spam Prevention`, `§Input Validation`
