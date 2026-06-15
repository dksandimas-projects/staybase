# Static Pages
> App: guest-app
> Phase: Phase 1 — Guest App Shell & Static Pages
> Requires: CLAUDE.md, docs/FRONTEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §About, §Corporate, §Contact, §404

## Overview

Core content-light pages: About Us, Corporate Stays (marketing), Contact Us, Privacy Policy, Terms of Service, and 404. About and Corporate hero/content are editable from admin Settings → Website Content. Contact details are shared with `settings/hotelConfig`.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Back navigation never loses user input
- [ ] Confirmation/success state feels celebratory, not just "OK"

---

## About Us (`/about`)

### UI Checklist
- [ ] Hero section — banner photo (editable from Settings), Apollo heading "about us"
- [ ] Mission statement section
- [ ] Vision statement section
- [ ] Hotel story section — multi-paragraph text
- [ ] No team/owner section — intentional, do not add
- [ ] Footer

### Data & Logic Checklist
- [ ] Fetch `settings/hotelConfig` for `missionStatement`, `visionStatement`, `hotelStory`
- [ ] Fetch `settings/websiteContent.about` for `heroPhotoUrl`

---

## Corporate Stays (`/corporate`) — Marketing Page

### UI Checklist
- [ ] Dark hero section — background photo (editable from Settings), Apollo heading, subtext
- [ ] Perks section — grid of perk items (title, description, icon) — editable from Settings
- [ ] Rooms overview — room type cards with photos, bed definition, capacity — NO prices shown
- [ ] Corporate inquiry form — company name, contact person, email, phone, number of rooms, preferred dates, special requirements, Submit button
- [ ] CTA to corporate booking: "Have a negotiated rate? Book directly at `/corporate/book`" — Spark Orange button
- [ ] Footer

### Data & Logic Checklist
- [ ] Fetch `settings/websiteContent.corporate` for hero content and perks
- [ ] Fetch all active rooms for the rooms overview section
- [ ] Inquiry form submission: POST `/api/corporate/inquiry`; API creates `corporateInquiries/{id}` with `status: "new"`
- [ ] No corporate rates displayed anywhere on this page
- [ ] Cloudflare Turnstile widget on inquiry form — invisible, token submitted with form
- [ ] Honeypot field on inquiry form — hidden via CSS
- [ ] Form success: show confirmation message, clear form — do not redirect

### Edge Cases & States
- [ ] Form submission loading state — disable Submit button, show spinner
- [ ] Form submission error — show error message, preserve form data
- [ ] No perks configured in Settings — hide perks section entirely

---

## Contact Us (`/contact`)

### UI Checklist
- [ ] Hotel address
- [ ] Phone number
- [ ] Email address (tap-to-email on mobile)
- [ ] Google Maps embed (same as homepage map)
- [ ] Facebook link
- [ ] Instagram link
- [ ] Footer
- [ ] **Contact form** (right column) — Name, Email, Subject, Message inputs, Submit button, success/error banners, honeypot, accessibility labels. Wired to `POST /api/contact`. Full spec: `plan/features/CONTACT-INQUIRIES.md` *(Per `DECISIONS-FEATURES.md #76`)*

### Data & Logic Checklist
- [ ] Fetch `settings/hotelConfig` for address, phone, email, facebookUrl, instagramUrl
- [ ] All contact info sourced from Settings — never hardcoded
- [ ] **Form submission** calls `POST /api/contact` — see `CONTACT-INQUIRIES.md` for endpoint spec, schema, bot controls, email template, and Firestore rules

---

## 404 (`*`)

### UI Checklist
- [ ] Friendly, on-brand message — warm tone, not clinical "404 Not Found"
- [ ] spark inn logo
- [ ] Brief copy: e.g. "We couldn't find that page. Let's get you back on track."
- [ ] CTA back to Homepage (Spark Orange button)
- [ ] No navbar or footer needed — standalone page

---

## Spark Rewards Landing (`/rewards`)

### UI Checklist
- [ ] Hero — program name, tagline, key benefits (points, discounts, early check-in, perks)
- [ ] How it works — simple 3-step: Book → Join → Earn
- [ ] Perks overview — what members get (Phase 2 details TBD, show placeholders)
- [ ] Sign up CTA — Google Sign-In button + "Sign up with email" link
- [ ] Already a member? Sign in link
- [ ] For logged-in non-members — "Join Spark Rewards" enroll button (one click)

### Data & Logic Checklist
- [ ] If already logged in and already a member — redirect to `/account/rewards`
- [ ] If logged in but not a member — show enroll button, POST `/api/members/register`; API sets `isMember: true` and generates `memberNumber`

---

## Privacy Policy (`/privacy`)

### UI Checklist
- [ ] Standalone page — no hero, clean readable layout (white background, Inter body text)
- [ ] Sections: Who We Are, What We Collect & Why, How Long We Keep It, Who We Share With, Your Rights (RA 10173), How to Contact the DPO, Last Updated date
- [ ] DPO contact email — clickable mailto link
- [ ] Link back to homepage
- [ ] Footer with version

### Data & Logic Checklist
- [ ] Static content — no Firestore fetch needed
- [ ] DPO email sourced from `settings/hotelConfig.contactEmail` or hardcoded — choose one and be consistent
- [ ] "Last Updated" date updated manually when policy changes

### Notes
- Legal copy must be reviewed and finalized by hotel owner
- Plain language — avoid legalese where possible, RA 10173 encourages plain language notices
- See `plan/docs/SECURITY.md` for minimum required content

---

## Terms of Service (`/terms`)

### UI Checklist
- [ ] Standalone page — no hero, clean readable layout (white background, Inter body text)
- [ ] Sections: Booking Agreement, Accuracy of Information, Payment and Verification, Cancellation Policy, Senior/PWD Discount Eligibility, Guest Conduct, Personal Property and Liability, Privacy, Governing Law, Contact
- [ ] Support email — clickable mailto link
- [ ] Link back to homepage
- [ ] Footer with version

### Data & Logic Checklist
- [ ] Static content — no Firestore fetch needed in Phase 1
- [ ] Hotel legal name, brand name, support email, and applicable law sourced from `hotel.config.ts`
- [ ] Booking Step 2 consent checkbox links to `/terms` alongside `/privacy`
- [ ] Footer links to `/terms`
- [ ] "Last Updated" date updated manually when terms change

### Notes
- Legal copy must be reviewed and finalized by hotel owner
- Minimum clauses defined in `plan/docs/LEGAL.md §Guest Terms of Service`
- Plain language — avoid legalese where possible

---

## Edge Cases & States (All Static Pages)

- [ ] Loading state — skeleton for hero photo
- [ ] Missing hero photo — brand color gradient fallback
- [ ] Settings fetch fails — show page with placeholder content, no crash

## Manual QA

- [ ] About page: mission, vision, story display correctly — no team/owner section present
- [ ] Corporate page: dark hero, perks grid, rooms overview (no prices), inquiry form all render
- [ ] Corporate inquiry form submits and appears in admin Corporate Inquiries pipeline
- [ ] Contact page: all details match `settings/hotelConfig`
- [ ] Terms page: booking, cancellation, discount eligibility, liability, and governing law sections render correctly
- [ ] CTA to `/corporate/book` present and working on corporate page
- [ ] 404 page appears for any unmatched route
- [ ] All pages load in under 3s on 4G mobile

## References

- Corporate inquiry pipeline (admin side): `plan/features/CORPORATE-INQUIRIES.md`
- Website content editing: `plan/features/SETTINGS.md §Website Content`
- Contact info source: `plan/docs/BACKEND.md §settings/hotelConfig`
- Corporate booking flow: `plan/features/CORPORATE-BOOKING.md`
