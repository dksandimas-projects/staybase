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

- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar
- [ ] Loading state uses skeleton, not spinner
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Destructive actions have a single confirmation step — not buried in menus
- [ ] Empty states explain why data is missing and what to do

---

## UI Checklist

- [ ] Pipeline view — kanban-style columns or tabbed view: New / Contacted / Negotiating / Converted / Declined
- [ ] Inquiry card — company name, contact person, email, phone, number of rooms, preferred dates, date submitted
- [ ] Inquiry detail drawer — full inquiry details + notes log + status action buttons + Generate Access Code button
- [ ] Notes log — timestamped entries (text, staff name, timestamp), newest first
- [ ] Add note input — text field + Add Note button in drawer
- [ ] Status action buttons — "Move to Contacted", "Move to Negotiating", "Mark Converted", "Decline" — context-aware per current status
- [ ] Convert to booking button — opens booking creation form pre-filled with inquiry data
- [ ] Generate Access Code section — shown at Negotiating or Converted stage only
  - [ ] Code input (auto-generated or custom, e.g. `ACME2026`)
  - [ ] Rate per room type — one input per type
  - [ ] Expiry date (optional)
  - [ ] Usage cap (optional)
  - [ ] Generate button
- [ ] Generated code display — show code prominently for staff to copy and share manually
- [ ] Notification badge on sidebar nav — count of New inquiries

## Data & Logic Checklist

- [ ] `onSnapshot` on `corporateInquiries` collection — real-time pipeline updates
- [ ] Stage move: `updateDoc` status field + `updatedAt`
- [ ] Add note: `updateDoc` to append to `notes[]` array with `{text, by: staffUID, at: timestamp}`
- [ ] Convert to booking: `addDoc` to `bookings` with pre-filled data, `source: "corporate"`, `status: "confirmed"`, link inquiry via `linkedInquiryId` if needed; update inquiry `status: "converted"`
- [ ] Generate Access Code:
  - [ ] `setDoc` on `corporateCodes/{code}` — document ID is the code string
  - [ ] Store `companyName`, `ratePerRoomType`, `expiresAt`, `usageCap`, `usageCount: 0`, `linkedInquiryId`, `createdBy`, `isActive: true`
  - [ ] Update `corporateInquiries/{id}.accessCodeId` with generated code
- [ ] Code must be unique — check if document exists before creating
- [ ] New inquiry submitted from guest site: `status: "new"`, notification appears on this page

## Edge Cases & States

- [ ] Loading state — skeleton per pipeline column
- [ ] Empty pipeline column — show empty state per column
- [ ] Duplicate code conflict — show error, suggest a different code
- [ ] Inquiry already has an access code — show existing code, allow deactivating and generating a new one
- [ ] Convert to booking: date conflict — show availability error
- [ ] Declined inquiry — moved to Declined column, no further actions except view

## Manual QA

- [ ] Submit inquiry from guest Corporate page — appears in New column
- [ ] Move inquiry through all stages
- [ ] Add timestamped note — appears in notes log with correct staff name and time
- [ ] Generate access code with custom rates — code document created in Firestore
- [ ] Generated code works on `/corporate/book` guest flow
- [ ] Convert inquiry to booking — booking appears in Bookings Management
- [ ] New inquiry badge count updates in sidebar

## References

- Corporate code schema: `plan/docs/BACKEND.md §corporateCodes`
- Inquiry schema: `plan/docs/BACKEND.md §corporateInquiries`
- Corporate booking guest flow: `plan/features/CORPORATE-BOOKING.md`
- Corporate inquiry form (guest side): `plan/features/STATIC-PAGES.md §Corporate Stays`
- New corporate inquiry email: `plan/features/EMAIL-PDF-STORAGE.md`
