# Static Pages
> App: guest-app
> Phase: Phase 1 — Guest App Shell & Static Pages
> Requires: CLAUDE.md, docs/FRONTEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §About, §Corporate, §Contact, §404

## Overview

Core content-light pages: About Us, Corporate Stays (marketing), Contact Us, Privacy Policy, Terms of Service, and 404. About and Corporate hero/content are editable from admin Settings → Branding (photos + copy) — the Website Content tab links into the Branding tab. Contact details are shared with `settings/hotelConfig`.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Single primary action is obvious — user knows what to do next without reading
- [x] Loading state uses skeleton, not spinner
- [x] Validation is inline (on blur), not on submit
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Back navigation never loses user input
- [x] Confirmation/success state feels celebratory, not just "OK"

---

## About Us (`/about`)

### UI Checklist
- [x] Hero section — banner photo + heading, both editable from Settings → Branding
- [x] Mission statement section
- [x] Vision statement section
- [x] Hotel story section — multi-paragraph text
- [x] No team/owner section — intentional, do not add
- [x] Footer

### Data & Logic Checklist
- [x] Fetch `settings/websiteContent.about` for `missionStatement`, `visionStatement`, `hotelStory` (via `usePublicSiteContent` — lives under website content, not `hotelConfig`)
- [x] Fetch `settings/websiteContent.about` for `heroPhotoUrl` and `heroHeading` (both editable from Settings → Branding)
- [x] Hero heading falls back to `data/homepage.ts → aboutHeroHeading` ("about us") when `about.heroHeading` is empty
- [x] Hero photo falls back to `data/homepage.ts → aboutHeroImage` (Unsplash) when `about.heroPhotoUrl` is empty

---

## Corporate Stays (`/corporate`) — Marketing Page

### UI Checklist
- [x] Dark hero section — eyebrow, background photo, Apollo heading, subtext — all editable from Settings → Branding
- [x] Perks section — grid of perk items (title, description, icon) — editable from Settings → Website Content → Corporate page → Perks
- [x] Rooms overview — eyebrow + heading + subtext editable from Settings → Website Content → Corporate page → Rooms Overview; **one card per room type sourced from `useRoomTypes()` filtered to types that have at least one active room** (per `feat/fix-corporate-accommodation-types-dynamic` — previously derived from a hardcoded `data/rooms.ts` fallback which silently missed admin-added types)
- [x] Retreat CTA banner — heading + description + button label editable from Settings → Website Content → Corporate page → Retreat CTA Banner
- [x] Corporate inquiry form — company name, contact person, email, phone, number of rooms, preferred dates, special requirements, Submit button
- [x] CTA to corporate booking: "Have a negotiated rate? Book directly at `/corporate/book`" — Spark Orange button
- [x] Footer

### Data & Logic Checklist
- [x] Fetch `settings/websiteContent.corporate` for `heroEyebrow`, `heroHeading`, `heroSubtext`, `heroPhotoUrl`, `perks[]`, `roomsOverview{Eyebrow,Heading,Description}`, and `retreat{Heading,Description,CtaLabel}` — all editable from Settings
- [x] Hero eyebrow falls back to `data/homepage.ts → corporateHeroEyebrow` when `corporate.heroEyebrow` is empty
- [x] Hero photo falls back to `data/homepage.ts → corporateHeroImage` (Unsplash) when `corporate.heroPhotoUrl` is empty
- [x] Rooms overview + retreat CTA copy falls back to `DEFAULT_CORPORATE_PAGE_CONTENT` from `@spark-inn/shared` when the corresponding `corporate.*` field is empty
- [x] Default perks list is the `DEFAULT_CORPORATE_PERKS` constant from `@spark-inn/shared` (6 entries: Negotiated Rates, Group Bookings, Dedicated Support, High-Speed Wi-Fi, Premium Security, Flexible Bookings) — seeded by `AdminContext.mergeWebsiteContent` when the Firestore doc has no `corporate.perks[]`
- [x] **Auto-population** — `DEFAULT_CORPORATE_PAGE_CONTENT` is the single source of truth for the hero text, rooms overview copy, and retreat CTA copy (the `hero.photoUrl` field in the constant is a reference value only — see `shared/constants/index.ts`). The admin editor's state is hydrated from this constant when the Firestore value is empty (admin sees the current text in the inputs without having to retype), AND a one-time backfill in `AdminContext` writes any empty `corporate.*` text field to `settings/websiteContent.corporate` the first time an admin loads the dashboard. Idempotent — subsequent loads short-circuit. `corporate.heroPhotoUrl` is intentionally NOT backfilled: the guest app's `pickString` falls back to the static `corporateHeroImage` in `data/homepage.ts` when the field is empty, so the Firestore value is left `""` until the admin explicitly uploads a custom image
- [x] Fetch all active rooms for the rooms overview section
- [x] Inquiry form submission: POST `/api/corporate/inquiry`; API creates `corporateInquiries/{id}` with `status: "new"`
- [x] No corporate rates displayed anywhere on this page
- [x] Cloudflare Turnstile widget on inquiry form — invisible, token submitted with form
- [x] Honeypot field on inquiry form — hidden via CSS
- [x] Form success: show confirmation message, clear form — do not redirect

### Edge Cases & States
- [x] Form submission loading state — disable Submit button, show spinner
- [x] Form submission error — show error message, preserve form data
- [x] No perks configured in Settings — hide perks section entirely

---

## Contact Us (`/contact`)

### UI Checklist
- [x] Hotel address
- [x] Phone number
- [x] Email address (tap-to-email on mobile)
- [x] Google Maps embed (same as homepage map)
- [x] Facebook link
- [x] Instagram link
- [x] Footer
- [x] **Contact form** (right column) — Name, Email, Subject, Message inputs, Submit button, success/error banners, honeypot, accessibility labels. Wired to `POST /api/contact/inquiry`. Full spec: `plan/features/CONTACT-INQUIRIES.md` *(Per `DECISIONS-FEATURES.md #76`)*

### Data & Logic Checklist
- [x] Fetch `settings/hotelConfig` for address, phone, email, facebookUrl, instagramUrl, twitterHandle; hide social icons whose saved value is empty
- [x] All contact info sourced from Settings — never hardcoded
- [x] **Form submission** calls `POST /api/contact/inquiry` — see `CONTACT-INQUIRIES.md` for endpoint spec, schema, bot controls, email template, and Firestore rules

---

## 404 (`*`)

### UI Checklist
- [x] Friendly, on-brand message — warm tone, not clinical "404 Not Found"
- [x] spark inn logo
- [x] Brief copy: e.g. "We couldn't find that page. Let's get you back on track."
- [x] CTA back to Homepage (Spark Orange button)
- [x] No navbar or footer needed — standalone page

---

## Spark Rewards Landing (`/rewards`)

### UI Checklist
- [x] Hero — program name, tagline, key benefits (points, discounts, early check-in, perks)
- [x] How it works — simple 3-step: Book → Join → Earn
- [x] Perks overview — what members get (Phase 2 details TBD, show placeholders)
- [x] Sign up CTA — Google Sign-In button + "Sign up with email" link
- [x] Already a member? Sign in link
- [x] For logged-in non-members — "Join Spark Rewards" enroll button (one click)

### Data & Logic Checklist
- [x] If already logged in and already a member — redirect to `/account/rewards`
- [x] If logged in but not a member — show enroll button, POST `/api/members/register`; API sets `isMember: true` and generates `memberNumber`

---

## Privacy Policy (`/privacy`)

### UI Checklist
- [x] Standalone page — no hero, clean readable layout (white background, Inter body text)
- [x] Sections: Who We Are, What We Collect & Why, How Long We Keep It, Who We Share With, Your Rights (RA 10173), How to Contact the DPO, Last Updated date
- [x] DPO contact email — clickable mailto link
- [x] Link back to homepage
- [x] Footer with version

### Data & Logic Checklist
- [x] Body sourced from `settings/websiteContent.privacyPolicyBody` when set (admin-editable via Settings → Legal Content, per AUDIT-25); falls back to deployment-configured static content when blank
- [x] DPO email sourced from config — consistent across the page
- [x] "Last Updated" date — `websiteContent.privacyPolicyLastUpdated` (auto-set from admin Settings → Legal Content), falling back to `config.privacyPolicyLastUpdated`

### Notes
- Legal copy must be reviewed and finalized by hotel owner
- Plain language — avoid legalese where possible, RA 10173 encourages plain language notices
- See `plan/docs/SECURITY.md` for minimum required content

---

## Terms of Service (`/terms`)

### UI Checklist
- [x] Standalone page — no hero, clean readable layout (white background, Inter body text)
- [x] Sections: Booking Agreement, Accuracy of Information, Payment and Verification, Cancellation Policy, Senior/PWD Discount Eligibility, Guest Conduct, Personal Property and Liability, Privacy, Governing Law, Contact
- [x] Support email — clickable mailto link
- [x] Link back to homepage
- [x] Footer with version

### Data & Logic Checklist
- [x] Static content — no Firestore fetch needed in Phase 1
- [x] Hotel legal name, brand name, support email, and applicable law sourced from `hotel.config.ts`
- [x] Booking Step 2 consent checkbox links to `/terms` alongside `/privacy`
- [x] Footer links to `/terms`
- [x] "Last Updated" date updated manually when terms change

### Notes
- Legal copy must be reviewed and finalized by hotel owner
- Minimum clauses defined in `plan/docs/LEGAL.md §Guest Terms of Service`
- Plain language — avoid legalese where possible

---

## Edge Cases & States (All Static Pages)

- [x] Loading state — skeleton for hero photo
- [x] Missing hero photo — falls back to the static per-page fallback image in `data/homepage.ts` (or `HeroSkeleton` while loading) per `plan/features/HOMEPAGE.md §Hero Image Loading`
- [x] Settings fetch fails — show page with placeholder content, no crash

## Manual QA

- [x] About page: mission, vision, story display correctly — no team/owner section present
- [x] Corporate page: dark hero, perks grid, rooms overview (no prices), inquiry form all render
- [x] Corporate inquiry form submits and appears in admin Corporate Inquiries pipeline
- [x] Contact page: all details match `settings/hotelConfig`
- [x] Terms page: booking, cancellation, discount eligibility, liability, and governing law sections render correctly
- [x] CTA to `/corporate/book` present and working on corporate page
- [x] 404 page appears for any unmatched route
- [x] All pages load in under 3s on 4G mobile

## References

- Corporate inquiry pipeline (admin side): `plan/features/CORPORATE-INQUIRIES.md`
- Website content editing: `plan/features/SETTINGS.md §Website Content`
- Contact info source: `plan/docs/BACKEND.md §settings/hotelConfig`
- Corporate booking flow: `plan/features/CORPORATE-BOOKING.md`
