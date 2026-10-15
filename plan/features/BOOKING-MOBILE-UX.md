# Guest Booking Mobile UX Refresh (MBUX)
> Requires: `CLAUDE.md`, `plan/docs/FRONTEND.md`, `plan/features/BOOKING-FLOW.md`, `plan/features/BREAKFAST.md`, `plan/features/OTHER-ADD-ONS.md`, `plan/features/CORPORATE-BOOKING.md`
>
> **Status:** In progress 2026-10-15. Owner-approved design direction; **MBUX-01 shipped** (shared booking shell, #254), **MBUX-02 + MBUX-03 shipped** (Step 1 room cards + mobile cart tray, #255), and **MBUX-04 shipped** (admin-managed breakfast meal photos — contract + normalization + Storage policy + admin controls, #256) and **MBUX-05 shipped** (Step 2 for phone widths, #257) and **MBUX-06 shipped** (Step 3 essential details — single consent control, compact secure-handling line, first-correction focus, #258) and **MBUX-07 shipped** (Step 4 summary-first + payment-first, optional savings collapsed below payment, #259) and **MBUX-08 shipped** (Step 5 confirmation hierarchy — payment proof never presented as payment verification, copyable reference, explicit next step, primary pair = add to calendar + manage booking, #260). and **MBUX-09 shipped** (corporate parity — vestigial rate control and summary order fixed; the corporate audit declaration and the vacuum add-on step deliberately left alone; the corporate confirmation gap recorded, #261). MBUX-10 not started. Roadmap owner: `plan/project/ROADMAP.md §Phase 15`. **Numbering note:** this plan originally reserved decision **#253**, but MSL-01 shipped the same day and consumed it; the reservation was stale, so the MBUX implementation record is **#254**.

---

## Objective

Make the five-step guest booking flow intentionally mobile-first: easier to scan, faster to complete one-handed, less repetitive, and free of horizontal overflow, while preserving multi-room booking, per-guest/per-date breakfast choices, availability enforcement, price accuracy, booking holds, and the existing server contracts.

The refresh covers:

- The shared five-step progress indicator.
- Step 1 room discovery and multi-room selection.
- Step 2 breakfast and other add-ons.
- Step 3 guest details and consent.
- Step 4 review and payment.
- Step 5 confirmation.
- Admin-managed breakfast meal photos.
- Public and corporate booking parity where the underlying business rules match.

This is a presentation and interaction redesign. It does not change authoritative availability, pricing, discount, cutoff, payment, or booking-creation rules.

---

## Confirmed Findings

### The mobile progress indicator wraps because every step always keeps its label

`guest-app/src/components/StepIndicator.tsx` currently renders all five labels inside a wrapping flex row. At phone widths, the result becomes a tall two- or three-row block before the page content. The current step is also repeated by the separate `Step N of 5` eyebrow and page heading.

### The breakfast grid overflows on mobile

`guest-app/src/pages/BookingPage.tsx` currently renders every breakfast slot as one horizontal row with a fixed-width guest label beside a native select. Long native option text establishes a large intrinsic width in iOS Safari, so the select and nested cards exceed the viewport.

### Step 1 has two controls for one room-selection decision

Each room-type card currently contains both a room-quantity stepper and a selectable `Room Only` rate panel. The `Room + Breakfast` choice was correctly removed by BR-03, leaving `Room Only` as the sole visible rate choice. It no longer represents a decision and now duplicates the quantity control.

### Multi-room selection must stay prominent

The flow supports several rooms of one type and mixed room types in one reservation. Any simplified card must continue to expose quantity, selected count, cart composition, guest fit, per-type extra beds, and the aggregate room total.

### Breakfast meals do not currently carry images

`BreakfastMeal` and `PublicBreakfastMeal` currently expose name, description, price, active state, and display order only. A guest-facing menu strip therefore requires an optional admin-managed image reference plus a safe no-image fallback.

### The Add-ons footer presents two actions with the same destination

BR-10 added `Continue to guest details` and `No add-ons, continue`, but both advance to the same step. The second action does not clear already-selected add-ons, so the labels imply different behavior while the navigation is identical.

### Review & Pay front-loads optional controls before the core payment decision

Voucher, rewards, government discount, payment, uploads, policies, consent, and the booking summary render as several large cards. On mobile, the summary appears after the main column, and the fixed footer can obscure the active requirement.

---

## Decisions Locked

1. The mobile stepper shows all five positions in one row but only the current step name.
2. Completed steps use checks, the current step keeps its number, and future steps remain numbered; checks alone are not sufficient to communicate the current position.
3. Desktop may retain full step labels.
4. The visible `Room Only` rate option is removed; the existing internal room-only value may remain for API and backward compatibility.
5. A room card is selected with one clear action, which then becomes the room-quantity control.
6. Multi-room and mixed-room-type booking remain first-class behavior.
7. Breakfast photos appear once in a menu strip above the selectors and never inside native dropdown options.
8. Breakfast thumbnail taps are informational only; they do not choose a guest/date meal slot.
9. Breakfast meal photos are optional and admin-managed.
10. Image references are not copied into booking snapshots; bookings continue to snapshot meal ID, meal name, price, and audit metadata only.
11. Breakfast guest labels stack above full-width selects on mobile.
12. A completed breakfast date can be copied to remaining editable dates; locked dates are never overwritten.
13. The Add-ons step has one context-aware primary action, not two parallel links to the same destination.
14. Extra beds remain associated with Step 1 because they affect room capacity, but their controls are revealed only after the room type is selected.
15. Guest Details has one consent source for the flow; Review & Pay does not ask for the same privacy/terms agreement again.
16. Optional requests, savings controls, and policies use progressive disclosure on mobile.
17. Every sticky footer has one primary action, a compact summary, and iOS safe-area padding.
18. Back navigation and Edit links preserve every already-entered choice.

---

## Shared Mobile Booking Shell

### Compact progress indicator

Mobile renders five evenly distributed circles joined by connector lines.

- Completed: primary-filled circle with a check.
- Current: primary-filled circle with the step number.
- Upcoming: white or page-background circle with a gray outline and step number.
- Current caption: `Step N of 5 · Current step name`.
- The separate uppercase `Step N of 5` eyebrow is removed on mobile.
- The page heading remains the semantic page title.

Accessibility requirements:

- Keep ordered-list semantics.
- Give every step an accessible name even when its visible label is hidden.
- Mark the current item with `aria-current="step"`.
- Do not use color alone to communicate state.
- Connector animation is optional and must respect reduced motion.

### Hold countdown

Steps protected by the in-flow hold use a compact state line on mobile, for example `Room held · 13:21 remaining`.

- The complete explanation moves behind an information affordance.
- Warning and expired states retain explicit next actions.
- The hold remains a soft UX signal; the booking transaction remains authoritative.

### Sticky action footer

Every step footer:

- Contains one primary action.
- Shows only the summary necessary for the current decision.
- Uses a minimum 44px action target.
- Includes bottom safe-area padding.
- Never covers the last interactive element; page content reserves matching bottom space.
- Places blocking guidance next to the field or selection that needs attention rather than relying on footer prose.

---

## Step 1 — Select Rooms

### Compact stay summary

On mobile, dates and occupancy collapse into one summary after a valid stay range exists.

The summary includes:

- Check-in and check-out.
- Number of nights.
- Adults and children.
- An `Edit` action.

`Edit` opens the existing range calendar and occupancy controls in a mobile-appropriate expandable area or sheet. The same underlying values, normalization, horizon, and range-selection rules remain in force.

The page does not repeat the same stay summary in both a header card and sidebar card.

### Room-card hierarchy

An unselected mobile room card shows, in order:

1. Primary room image.
2. Recommended badge when applicable.
3. Room-type name.
4. Nightly price.
5. Guest-fit status.
6. Essential bed/capacity facts.
7. Short availability message such as `3 rooms left`.
8. Exact room total for the current stay.
9. One full-width `Select this room` action.

The card removes:

- The duplicate type pill plus identical heading.
- The instructional `Click a rate` copy.
- The visible `Room Only` rate panel.
- Nonessential facts from the default collapsed view.

Long descriptions are clamped on mobile and available through `View room details`. The full detail view may include the image gallery, complete description, and amenities.

### Selection and quantity

Selecting a room adds one unit of that type. The selection action then becomes the room quantity control.

Selected cards show:

- A primary selection border.
- A checked selected state.
- A clear count such as `2 selected`.
- Decrement, quantity, and increment controls.
- The total for that room type across its selected quantity and stay length.

Decrementing to zero restores the unselected state. The room count remains bounded by live availability.

### Multi-room cart tray

Once at least one room is selected, mobile displays a compact cart tray above the footer or as part of the action area.

The tray shows:

- Total number of rooms selected.
- Lines grouped by room type, such as `2 × Deluxe Room`.
- Aggregate adults and children.
- Fit status.
- Aggregate room total.
- A `View` or expand action.

Expanding the tray reveals each selected room type without switching to meaningless positional names such as `Room 1`, `Room 2`, and `Room 3`. Tapping a line returns focus to the matching room card.

The existing distribution logic remains the source of truth. The cart may contain:

- One room.
- Multiple rooms of one type.
- Multiple room types.
- Extra beds per selected type where supported.

### Fit and recovery states

The UI must say what action is required, not merely disable Continue.

Examples of actionable states:

- One guest still needs a room.
- Add one more room of this type.
- This room type cannot fit the current group.
- Each selected room must include at least one adult.

The existing authoritative capacity and distribution checks remain unchanged.

### Extra beds

Extra-bed controls appear only after a room of that type is selected.

- One allowed extra bed uses a toggle.
- More than one uses a quantity control.
- If the value is mirrored across every selected room of that type, the label says `Extra beds per room`.
- Show rate per bed per night and the resulting stay total.
- Keep over-cap and required-bed guidance adjacent to the control.

### Step 1 footer

The mobile footer shows:

- Selected-room count.
- Night count.
- Aggregate room total, explicitly labeled as the room total before optional add-ons.
- `Continue to add-ons` when the cart is ready.

When the cart is not ready, the page displays the specific correction beside the cart and keeps the action disabled.

---

## Step 2 — Add-ons

### Header and copy

The mobile heading uses one brief instruction, such as `Choose breakfast for each guest.` Longer hotel-configured instructions remain available but do not dominate the initial viewport.

### Breakfast menu strip

A single `Breakfast menu` strip renders above every date card.

Each active meal card contains:

- Optional 4:3 thumbnail.
- Meal name.
- Current price.

Mobile behavior:

- Horizontal scrolling with overscroll containment.
- The next card is partially visible as a scroll cue.
- Images lazy-load.
- Loading skeleton matches the card shape.
- Missing or failed images use a branded-neutral fallback.
- The row follows meal display order.

Thumbnail interaction may open a lightweight preview containing the larger image and meal description. It never fills a meal slot.

### Per-date and per-guest selectors

Each breakfast date card shows:

- Service date.
- Cutoff state or concise cutoff time.
- One slot per guest, child, and extra-bed occupant.

On mobile, each slot uses a stacked label and full-width native select. The empty option reads `No breakfast`. The longer explanation that skipping is allowed appears once above the grid, not inside every option.

For multi-room reservations, labels include enough room context to distinguish guest slots without turning each label into a paragraph.

Locked dates remain visible and clearly read-only. The server continues to enforce cutoff authority.

### Copy first completed date to remaining dates

When the stay has multiple breakfast dates and the current date has at least one explicit selection, offer `Use these choices for all remaining days`.

The action:

- Copies the active date's guest-slot choices to later editable dates.
- Preserves `No breakfast` choices as empty slots.
- Never overwrites locked dates.
- Allows every copied date to be edited afterward.
- Confirms how many dates were updated.

### Other add-ons

Existing other add-ons render as compact expandable cards below breakfast.

Each card shows:

- Name.
- Short description.
- Price and unit.
- Optional thumbnail when the catalog later supports one.
- A 44px Add or toggle control.

Quantity, service date, pickup information, or other configuration appears only after selection. Breakfast remains a specialized per-date/per-guest interface and is not forced into the generic quantity model.

### Live summary and action

The step shows a concise live selection summary, including breakfast count, other-add-on count when applicable, and add-on total.

There is one context-aware primary action:

- No selection: `Continue without add-ons`.
- Any selection: `Continue with N add-ons · total`.

The BR-10 pair of parallel actions is retired. A skip label never silently preserves selections while implying that it cleared them.

---

## Admin Breakfast Meal Photos

### Optional meal image

Each breakfast meal gains an optional image reference. Existing meals without an image remain valid.

The public breakfast configuration exposes only the guest-safe image information needed to render the thumbnail. Admin-only storage metadata is not exposed.

### Admin controls

Each meal editor in Settings supports:

- Upload image.
- Preview image.
- Replace image.
- Remove image.
- Upload progress.
- Friendly validation and failure states.

Accepted formats are JPEG, PNG, and WebP. Images are compressed before upload and displayed with a consistent 4:3 crop.

### Storage and access

- Use a predictable per-hotel/per-meal Firebase Storage path following the existing compressed-image upload conventions.
- Only authorized staff can upload, replace, or remove files.
- Guest reads receive the rendered image reference only.
- Replacing an image cleans up the superseded object when safe.
- Removing an image immediately returns the guest UI to the fallback thumbnail.

### Snapshot invariant

Booking breakfast selections do not snapshot image references. Historical bookings continue to rely on the immutable meal name and price snapshots. Changing or deleting a catalog image never mutates an existing booking or financial record.

---

## Step 3 — Guest Details

### Essential form first

The page asks one direct question: who should the hotel contact about the booking?

The primary fields are:

- First name.
- Last name.
- Email.
- Phone number.

Mobile uses one column, suitable keyboard types, browser autocomplete, and inline validation. Signed-in member values remain prefilled and clearly identified.

### Optional requests

Special requests and preferences are collapsed by default under an explicitly optional control. Expanding it reveals only applicable bed setup, arrival, configured preference, and additional-request fields.

### Consent

Guest Details owns the single booking consent control. It links to Privacy Policy and Terms of Service and blocks continuation until accepted.

The separate large privacy explanation becomes a compact secure-handling statement. Review & Pay does not request the same consent again.

### Step 3 footer

The footer provides `Continue to review`. Incomplete states identify the first required correction inline and move focus there when the guest attempts to continue.

---

## Step 4 — Review & Pay

### Mobile information order

The mobile order is:

1. Booking summary.
2. Total due.
3. Payment method.
4. Required proof or eligibility upload.
5. Optional voucher, points, or government discount controls.
6. Collapsed cancellation policy.
7. Place booking action.

### Editable booking summary

The summary includes compact groups for:

- Stay dates and nights.
- Rooms and quantities.
- Guests.
- Breakfast and other add-ons.
- Contact person.
- Current price breakdown.

Each applicable group has an Edit link to its owning step. Returning to a prior step preserves all other state.

### Optional savings

Voucher, rewards points, and Senior/PWD controls sit under a collapsed `Have a voucher, points, or discount?` section.

- Only eligible controls render.
- Applied states remain visible while the section is collapsed.
- Long eligibility guidance appears only when the related option is selected or unavailable for a specific reason.
- Upload requests appear adjacent to the chosen discount.

### Payment

- Payment methods remain large touch-friendly choices.
- Only the selected method's instructions expand.
- The exact amount, recipient, and account details are visually prioritized.
- QR images remain legible at phone width.
- Proof upload supports camera/photo-library use, preview, replace, and remove.
- Upload progress and failure recovery are inline.

### Terms and policies

The cancellation policy stays collapsed. The duplicate Review-step privacy/terms checkbox is removed; the required Guest Details consent remains authoritative.

### Step 4 footer

The footer shows total and one `Place booking · total` action. Blocking messages point to the relevant field. Processing and upload states remain explicit without replacing the entire footer with several lines of prose.

---

## Step 5 — Confirmation

### Primary reassurance

The first viewport answers:

- Was the request received?
- What is the booking reference?
- What happens next?

The booking reference has a Copy action.

### Truthful status language

The page clearly distinguishes:

- Booking received and payment verification pending.
- Payment confirmed.
- Booking confirmed.

Uploading proof never implies that staff have already verified payment.

### Information hierarchy

Essential content appears first:

- Booking reference.
- Stay dates.
- Rooms.
- Guests.
- Total.
- Payment status.
- Email delivery status.

Primary follow-up actions are Add to calendar and View/manage booking. Price detail, contact options, early check-in, rewards promotion, policies, and other secondary content sit below or inside disclosure panels.

---

## Corporate Booking Parity

The shared mobile progress indicator, spacing, sticky-footer, Guest Details, Review, and Confirmation principles apply to the corporate flow.

Corporate-specific pricing, access-code, employee, and billing rules remain unchanged. Breakfast and other add-on catalog surfaces render only when that corporate flow supports them. A placeholder Add-ons step must not pretend add-ons are selectable when the corporate contract excludes them.

---

## Responsive and Accessibility Acceptance Criteria

The booking flow must be manually verified at 320px, 375px, 390px, 430px, tablet, and desktop widths.

Blocking acceptance criteria:

- No horizontal page scrolling.
- No clipped native select.
- Long room and meal names wrap or truncate safely.
- All interactive controls are at least 44px in both axes where applicable.
- Sticky footers respect safe areas and do not obscure content.
- Step state, selected-room count, guest-fit state, cutoff state, and payment state are not communicated by color alone.
- Quantity and price changes are announced without creating noisy per-second live regions.
- Keyboard focus order follows the visual order.
- Focus returns predictably after sheets and previews close.
- Image alternatives use the meal or room name; decorative fallbacks do not duplicate nearby text.
- Animations respect reduced motion.
- Back navigation preserves state.

---

## Required Scenarios

### Step 1

- One room.
- Several rooms of one type.
- Mixed room types.
- Quantity reduced back to zero.
- Group fits.
- Group is short one or more rooms.
- Extra bed optional.
- Extra bed required for the chosen configuration.
- Availability changes after dates change.
- No room type available.

### Step 2

- One guest and one breakfast date.
- Several guests and dates.
- Multi-room guest slots.
- No meals selected.
- Different meals per guest.
- Copy choices to editable remaining dates.
- Locked date excluded from copy.
- No photo, loading photo, and failed photo.
- Long meal name and large localized price.
- Breakfast plus an existing other add-on.

### Steps 3–5

- Anonymous and signed-in member forms.
- Optional requests left closed and completed.
- Consent missing and accepted.
- Voucher, rewards, and Senior/PWD paths.
- Pay-at-hotel and online payment paths.
- Payment proof upload failure and recovery.
- Hold expiration before submission.
- Payment-pending and confirmed confirmation states.
- Multi-room confirmation summary.

---

## Implementation Sequence

1. Shared stepper and booking-shell spacing.
2. Optional breakfast meal image contract, public normalization, Storage policy, and admin upload controls.
3. Step 1 compact stay controls, room-card selection, selected quantity, and multi-room cart tray.
4. Step 2 responsive selectors, menu thumbnails, copy-to-remaining-days action, and single CTA.
5. Step 3 progressive disclosure and single consent source.
6. Step 4 summary-first ordering, optional-savings disclosure, payment cleanup, and one footer CTA.
7. Step 5 confirmation hierarchy and truthful status copy.
8. Corporate-flow parity where business rules match.
9. Focused tests, browser QA, documentation sync, and staging review.

---

## Files Expected to Change During Implementation

Primary surfaces:

- `guest-app/src/components/StepIndicator.tsx`
- `guest-app/src/pages/BookingPage.tsx`
- `guest-app/src/pages/CorporateBookingPage.tsx`
- `guest-app/src/pages/BookingConfirmPage.tsx`
- `guest-app/src/components/BookingSummaryCard.tsx`
- `guest-app/src/components/HoldCountdownBanner.tsx`
- `admin-app/src/pages/SettingsPage.tsx`
- Shared breakfast types, schemas, and public normalizer
- Firebase Storage rules for the new meal-image path
- Focused guest/admin/shared test files

Exact extraction boundaries are implementation decisions. Large reusable UI pieces should be extracted from `BookingPage.tsx` rather than making the page harder to maintain.

---

## Documentation Sync Required When Implemented

- Record decision #254 in `plan/docs/DECISIONS-FEATURES.md` (#254, renumbered from the stale #253 reservation — see the numbering note above).
- Update `plan/features/BREAKFAST.md` for the optional meal image contract.
- Update `plan/features/BOOKING-FLOW.md` for the shipped mobile step behavior.
- Update `plan/features/CORPORATE-BOOKING.md` for parity decisions.
- Update `plan/docs/BACKEND.md` and `plan/docs/TYPES.md` if the stored breakfast meal shape changes.
- Update `plan/docs/SECURITY.md` and Storage rules for the upload/read path.
- Mark the Phase 15 roadmap items shipped and archive the detailed block when complete.

---

## Explicit Non-Goals

- Removing multi-room booking.
- Putting images inside native select options.
- Selecting a meal by tapping the menu thumbnail.
- Copying image URLs into booking records.
- Changing room, breakfast, discount, or add-on price calculations.
- Changing booking availability or transaction guarantees.
- Removing occupancy validation.
- Making breakfast mandatory.
- Building new add-on products as part of this refresh.
- Replacing the native mobile select with a custom meal-picker sheet in this phase.

---

## Rejected Alternatives

### Keep `Room Only` and merely rename it

Rejected because a single choice is not a choice. Renaming it to `Room rate` would still leave two controls that add the same room and would preserve the confusing toggle behavior.

### Remove the room quantity control and make every card single-select

Rejected because it breaks multi-room and mixed-room-type booking, a shipped core capability.

### Show only checked and unchecked step circles

Rejected because the current step becomes ambiguous. The active numbered circle distinguishes completed, current, and future states.

### Repeat breakfast photos inside every guest/date row

Rejected because it multiplies vertical height, image loading, and visual noise. One menu strip supplies the needed reference.

### Put photos inside the native dropdown

Rejected because mobile browsers do not render image-rich native options consistently and the user explicitly does not need photos inside the dropdown.

### Let `No add-ons, continue` share the same behavior as Continue

Rejected because the label implies clearing or skipping while the existing navigation preserves selections. One context-aware action is honest and simpler.

### Move extra beds entirely to Step 2

Rejected for this phase because extra beds affect room capacity and the Step 1 fit gate. Progressive disclosure inside the selected room card keeps capacity decisions in the correct step.
