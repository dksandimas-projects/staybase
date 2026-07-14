# Corporate Inquiries
> App: admin-app
> Phase: Phase 7 — Corporate, Vouchers & Breakfast
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Corporate Inquiries

## Overview

The `/corporate` dashboard page manages the corporate inquiry pipeline from initial contact through to a converted booking or declined inquiry. Staff can move inquiries through stages, log timestamped notes, convert to a booking, and generate access codes for negotiated rates at the Negotiating or Converted stage.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Most common action is reachable in ≤ 2 clicks from the sidebar
- [x] Loading state uses skeleton, not spinner
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Destructive actions have a single confirmation step — not buried in menus
- [x] Empty states explain why data is missing and what to do

---

## UI Checklist

- [x] Pipeline view — kanban-style columns or tabbed view: New / Contacted / Negotiating / Converted / Declined
- [x] Inquiry card — company name, contact person, email, phone, number of rooms, preferred dates, date submitted
- [x] Inquiry detail drawer — full inquiry details + notes log + status action buttons + Generate Access Code button
- [x] Notes log — timestamped entries (text, staff name, timestamp), newest first
- [x] Add note input — text field + Add Note button in drawer
- [x] Status action buttons — "Move to Contacted", "Move to Negotiating", "Mark Converted", "Decline" — context-aware per current status
- [x] Convert to booking button — opens booking creation form pre-filled with inquiry data
- [x] Generate Access Code section — shown at Negotiating or Converted stage only
  - [x] Code input (auto-generated or custom, e.g. `ACME2026`)
  - [x] Rate per room type — one input per type
  - [x] Expiry date — not exposed as a UI input; codes are created with a far-future default (`expiresAt: "2027-12-31"`); server-side expiry validation still applies
  - [x] Usage cap — not exposed as a UI input; codes are created uncapped (`usageCap: null`); `usageCount` still increments server-side per booking
  - [x] Generate button
- [x] Generated code display — show code prominently for staff to copy and share manually
- [x] New-inquiry alerting — surfaced as the "New corporate inquiries" section on the Dashboard (see `plan/features/DASHBOARD-OVERVIEW.md`) rather than a sidebar badge; the sidebar badge is intercom-only

## Data & Logic Checklist

- [x] `onSnapshot` on `corporateInquiries` collection — real-time pipeline updates
- [x] Stage move: `updateDoc` status field + `updatedAt`
- [x] Add note: `updateDoc` to append to `notes[]` array with `{text, by: staffUID, at: timestamp}`
- [x] Convert to booking: POST the pre-filled booking data to the dedicated transaction-based `/api/corporate/convert-inquiry` route (staff-authenticated), with `isCorporate: true`, `source: "corporate"`, and `linkedInquiryId` metadata; the inquiry's `convertedBookingId` is set in the same transaction. The API uses a Firestore transaction (per `plan/features/AVAILABILITY-LOCKING.md`) to atomically check room availability, lock dates, and create the booking document. Never `addDoc` directly to `bookings` from this UI — always go through the API so the availability check is enforced. On API success, update inquiry `status: "converted"`.
- [x] Generate Access Code:
  - [x] `setDoc` on `corporateCodes/{code}` — document ID is the code string
  - [x] Store `companyName`, `ratePerRoomType`, `expiresAt`, `usageCap`, `usageCount: 0`, `linkedInquiryId`, `createdBy`, `isActive: true`
  - [x] Update `corporateInquiries/{id}.accessCodeId` with generated code
- [x] Code must be unique — check if document exists before creating
- [x] New inquiry submitted from guest site through `/api/corporate/inquiry`: `status: "new"`, notification appears on this page

## Edge Cases & States

- [x] Loading state — skeleton per pipeline column
- [x] Empty pipeline column — show empty state per column
- [x] Duplicate code conflict — show error, suggest a different code
- [x] Inquiry already has an access code — show existing code, allow deactivating and generating a new one
- [x] Convert to booking: date conflict — show availability error returned by the transaction-based booking API
- [x] Declined inquiry — moved to Declined column, no further actions except view

## Manual QA

- [x] Submit inquiry from guest Corporate page — appears in New column
- [x] Move inquiry through all stages
- [x] Add timestamped note — appears in notes log with correct staff name and time
- [x] Generate access code with custom rates — code document created in Firestore
- [x] Generated code works on `/corporate/book` guest flow
- [x] Convert inquiry to booking — booking appears in Bookings Management
- [x] New inquiry alerting on Dashboard (sidebar badge is intercom-only per design decision)

## References

- Corporate code schema: `plan/docs/BACKEND.md §corporateCodes`
- Inquiry schema: `plan/docs/BACKEND.md §corporateInquiries`
- Corporate booking guest flow: `plan/features/CORPORATE-BOOKING.md`
- Corporate inquiry form (guest side): `plan/features/STATIC-PAGES.md §Corporate Stays`
- New corporate inquiry email: `plan/features/EMAIL-PDF-STORAGE.md`
