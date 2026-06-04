# Corporate Booking Flow
> App: guest-app
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, features/BOOKING-FLOW.md, guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Corporate Booking

## Overview

A dedicated booking route at `/corporate/book` for corporate clients. Reuses all 4-step booking flow components but applies a corporate skin, adds company-specific fields, and supports two rate modes: a public flat corporate rate (no code needed) and a negotiated custom rate unlocked via an access code. The route is easy to remember and share with clients.

---

## UI Checklist

- [ ] Landing section before Step 1 — dark header treatment, "Corporate Rate" heading, brief intro copy
- [ ] Access code input field + Validate button — shown on landing before entering the flow
- [ ] "Continue without code" option — proceeds with flat corporate rate
- [ ] Code validation feedback — valid (show company name + unlocked rate), expired, usage cap reached, inactive, invalid
- [ ] Persistent "Corporate Rate — [Company Name or Flat Rate]" badge throughout all 4 steps
- [ ] Dark header/hero treatment maintained across all steps (distinct from standard booking flow)
- [ ] Step 2 — Guest Details: additional corporate fields (see `features/BOOKING-FLOW.md §Step 2`)
- [ ] All other steps inherit from standard booking flow with no changes
- [ ] Back button on landing returns to `/corporate` marketing page

## Data & Logic Checklist

- [ ] Access code validation calls `/api/validate/corporate-code` — server-side only
- [ ] Valid code response returns: `companyName`, `ratePerRoomType` map
- [ ] Rate applied to room cards in Step 1 — overrides standard and weekend rates
- [ ] Flat corporate rate (no code) pulled from `room.corporateRate` field
- [ ] `isCorporate: true` always set on bookings from this route — set server-side
- [ ] `corporateCode` stored on booking only if a code was used — set server-side
- [ ] `companyName` stored on booking — sourced from code validation response or entered by guest
- [ ] `usageCount` on `corporateCodes` document incremented server-side on successful booking
- [ ] Corporate booking source: `source = "corporate"`

## Edge Cases & States

- [ ] No access code entered — proceed with flat corporate rate, no `corporateCode` on booking
- [ ] Code valid but all rooms unavailable for selected dates — show availability error after entering flow
- [ ] Code expires between validation and booking creation — re-validate server-side at creation, return clear error
- [ ] Code usage cap reached between validation and booking — same as above
- [ ] `corporateRate` not set on room (0 or null) — fall back to standard rate, do not show ₱0
- [ ] Guest navigates directly to `/corporate/book/step-2` — redirect to landing first

## Manual QA

- [ ] Valid access code unlocks correct company name and rates
- [ ] Rates in Step 1 reflect corporate pricing (not standard rates)
- [ ] "Corporate Rate — [Company]" badge visible on all 4 steps
- [ ] Corporate fields appear in Step 2 and are required
- [ ] Completed booking shows `isCorporate: true` in admin dashboard
- [ ] Flat rate (no code) booking works correctly
- [ ] Expired/invalid code shows friendly error, does not block flow entry (can continue without code)
- [ ] Usage count increments on `corporateCodes` document after successful booking

## References

- Standard booking flow steps: `features/BOOKING-FLOW.md`
- Corporate code schema: `docs/BACKEND.md §corporateCodes`
- Access code generation (admin side): `features/CORPORATE-INQUIRIES.md`
- Validation API route: `docs/API-ROUTES.md §validate`
- Corporate marketing page CTA: `features/STATIC-PAGES.md`
