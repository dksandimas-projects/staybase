# Static Pages
> App: guest-app
> Requires: CLAUDE.md, docs/FRONTEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §About, §Corporate, §Contact, §404

## Overview

Four content-light pages: About Us, Corporate Stays (marketing), Contact Us, and 404. About and Corporate hero/content are editable from admin Settings → Website Content. Contact details are shared with `settings/hotelConfig`.

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
- [ ] Inquiry form submission: `addDoc` to `corporateInquiries` with `status: "new"`
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

### Data & Logic Checklist
- [ ] Fetch `settings/hotelConfig` for address, phone, email, facebookUrl, instagramUrl
- [ ] All contact info sourced from Settings — never hardcoded

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
- [ ] If logged in but not a member — show enroll button, `updateDoc` on `members/{uid}` sets `isMember: true`

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

## Edge Cases & States (All Static Pages)

- [ ] Loading state — skeleton for hero photo
- [ ] Missing hero photo — brand color gradient fallback
- [ ] Settings fetch fails — show page with placeholder content, no crash

## Manual QA

- [ ] About page: mission, vision, story display correctly — no team/owner section present
- [ ] Corporate page: dark hero, perks grid, rooms overview (no prices), inquiry form all render
- [ ] Corporate inquiry form submits and appears in admin Corporate Inquiries pipeline
- [ ] Contact page: all details match `settings/hotelConfig`
- [ ] CTA to `/corporate/book` present and working on corporate page
- [ ] 404 page appears for any unmatched route
- [ ] All pages load in under 3s on 4G mobile

## References

- Corporate inquiry pipeline (admin side): `plan/features/CORPORATE-INQUIRIES.md`
- Website content editing: `plan/features/SETTINGS.md §Website Content`
- Contact info source: `plan/docs/BACKEND.md §settings/hotelConfig`
- Corporate booking flow: `plan/features/CORPORATE-BOOKING.md`
