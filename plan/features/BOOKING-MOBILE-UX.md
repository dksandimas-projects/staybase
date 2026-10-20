# Guest Booking Mobile UX Refresh (MBUX)
> Requires: `CLAUDE.md`, `plan/docs/FRONTEND.md`, `plan/features/BOOKING-FLOW.md`, `plan/features/BREAKFAST.md`, `plan/features/OTHER-ADD-ONS.md`, `plan/features/CORPORATE-BOOKING.md`
>
> **Status:** Shipped 2026-10-16. Owner-approved design direction; **MBUX-01 shipped** (shared booking shell, #254), **MBUX-02 + MBUX-03 shipped** (Step 1 room cards + mobile cart tray, #255), and **MBUX-04 shipped** (admin-managed breakfast meal photos — contract + normalization + storage policy + admin controls, #256) and **MBUX-05 shipped** (Step 2 for phone widths, #257) and **MBUX-06 shipped** (Step 3 essential details — single consent control, compact secure-handling line, first-correction focus, #258) and **MBUX-07 shipped** (Step 4 summary-first + payment-first, optional savings collapsed below payment, #259) and **MBUX-08 shipped** (Step 5 confirmation hierarchy — payment proof never presented as payment verification, copyable reference, explicit next step, primary pair = add to calendar + manage booking, #260). and **MBUX-09 shipped** (corporate parity — vestigial rate control and summary order fixed; the corporate audit declaration and the vacuum add-on step deliberately left alone; the corporate confirmation gap recorded, #261) and **MBUX-10 shipped** (close-out — cross-surface contract test pinned, two production bugs found and fixed in the close-out pass: a React #310 on `/book` from a hook declared after the loading-skeleton early return, and a CSP block on the Google auth iframe; the browser-QA matrix at 320/375/390/430/tablet/desktop is honestly deferred, #262) and **MBUX-11 shipped** (mobile-UX review fixes — `App.tsx ScrollToTop` no longer scrolls on every cart mutation; new mobile-first `StaySummaryStrip` mounts at the top with an Edit pencil that smooth-scrolls to the existing stay-details aside; the cart-distribution failure message branches on the actual cause — no rooms / more rooms than guests / unassigned adults / unassigned children — with the legacy single-sentence text kept as a defensive fallback; the warning `<p>` now also carries `role="alert"` so screen readers announce the failure immediately, #264) and **MBUX-12 shipped** (breakfast menu responsive grid on mobile — the pre-MBUX-12 horizontal-scroll carousel put 2.5 cards visible on a 375px phone and cut the third meal in half; the fix is a responsive CSS grid: 2 cols on mobile, 3 cols on `sm:`, 4 cols on `lg:`, with the per-card `w-32 sm:w-40` replaced by `w-full`, #265) and **MBUX-13 shipped** (Step 4 disclosure reorder — the pre-MBUX-13 layout put the "Click to upload receipt photo" button BEFORE the "Have a voucher, points, or discount?" disclosure so a guest who already sent payment + uploaded the receipt had nothing to gain by then opening the disclosure; the fix moves the disclosure ABOVE the payment method card on Step 4 so guests see the discount / voucher option before they commit to a payment path, with the collapse-by-default state from MBUX-07 preserved, #266) and **MBUX-14 shipped** (Step 4 disclosure expanded by default — the deferred state flip from MBUX-13; the disclosure's `<details>` opening tag now carries an `open` attribute so guests see the voucher / points / Senior-PWD options before committing to a payment path, with the collapse-on-tap wiring from MBUX-07 + the placement from MBUX-13 preserved, #267) and **MBUX-15 shipped** (hold-expired banner stacks vertically on mobile — the pre-MBUX-15 desktop-only inline layout leaked onto mobile and squeezed the text + narrowed the buttons on a 375px phone; the fix changes the outer container + buttons container to `flex-col sm:flex-row`, with each button going `w-full sm:w-auto` so the buttons fill the row on mobile and restore auto width on `sm:`+, with the IMT-03 primary/secondary emphasis + `role="alert"` + `min-w-0 flex-1` text-block anchor preserved, #268) and **MBUX-16 shipped** (breakfast cut-off gets a visible, in-context explainer on Step 2 — the pre-MBUX-16 state locked per-date breakfast cards with no in-page reason and forced guests to guess "is this site broken?"; the fix adds a new `formatCutoffTime` helper at `guest-app/src/utils/formatCutoffTime.ts` that maps "HH:MM" 24h to "H:MM AM/PM" with a raw-input fallback for malformed values, a per-date `text-xs text-amber-700` sub-line on locked cards reading "Cut-off was 8:00 PM the day before — skip this day or contact the front desk." with the time interpolated via `formatCutoffTime`, and a one-line section-level help text "Some dates are past the cut-off. You can still book the stay — just skip breakfast for those nights." that appears when ANY night is locked; open dates stay clean; #269) and **MBUX-17 shipped** (breakfast cut-off pill replaces the MBUX-16 per-date sub-line + the redundant "Skipping a day is fine" reassurance is dropped — the pre-MBUX-17 two-line stack on locked dates (a status title + an amber-700 sub-line that named the cut-off time AND listed the workarounds) was visibly duplicated with the top-of-section help text, which was the owner-flagged "too text-y and tight for mobile" complaint; the fix collapses the per-date stack into a single compact pill reading "Ordering closed due to cut-off" using the in-file `inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800` vocabulary that matches the existing "Tight — at the cap" / "Fits your group" pills, the top-of-section help text becomes the single source for the cut-off TIME (was duplicated per-date), and the pre-MBUX-17 "Skipping a day is fine — leave any slot as 'No breakfast'" reassurance line above the date cards is removed because the default `<option value="">No breakfast</option>` on every guest slot already implies it; unlocked dates keep the byte-equivalent `Order by Oct 24` deadline line; #272) and **MBUX-17.1 shipped** (cut-off pill copy shortened to a 2-word short-form label that fits one line on every viewport — the pre-MBUX-17.1 four-word pill copy "Ordering closed due to cut-off" wrapped to "cut-/off" on a 375px phone, which the owner flagged with a screenshot ("maybe we can reword it since the pill is too long for mobile"); the fix replaces it with the 11-char label "Past cut-off" (one line on every viewport, no wrap, no overflow) and adds `whitespace-nowrap` to the pill's className as a belt-and-braces guard so a future copy edit cannot reintroduce the wrap; #273) and **MBUX-17.2 shipped** (the breakfast cut-off help text on Step 2 is enhanced into a guest-facing two-sentence action statement — the pre-MBUX-17.2 first-sentence policy + em-dash hedge ("Breakfast has a per-day cut-off (8:00 PM the day before) — when it passes, that day's menu locks but the rest of the stay is still editable.") was informative but did not tell the guest what they COULD or COULD NOT do once the cut-off fired; the new copy keeps the first sentence verbatim (it still carries the cut-off TIME interpolated via `formatCutoffTime`, so the rendered time always matches the admin-configured value, and the "per-day" prefix that makes the cut-off shape clear) and ADDS a second sentence that turns the hedge into an explicit consequence: "If you booked beyond the cut-off time, you may not be able to order — but you can still order breakfast for other days." The em-dash carries the contrast ("can't for this date" → "but can for other dates") more cheaply than the pre-MBUX-17.2 subordinate clause did; the pill (`Past cut-off`, per MBUX-17.1 decision #273) is unchanged — MBUX-17.2 is help-text only; #274) and **MBUX-18 shipped** (Edit pencil on the mobile `StaySummaryStrip` opens a mobile bottom sheet with the same `<DateRangePicker>` + Adults/Children steppers the sidebar renders inline — the pre-MBUX-18 scroll-to-aside + ring + `setTimeout` behaviour put a long room-card list between the strip and the aside, so a guest on mobile had to scroll to the bottom of the room list and lose context for the few seconds they fiddled with dates; the new `EditStayDetailsSheet` ships the spec's anticipated alternative ("expandable area or sheet", BOOKING-MOBILE-UX.md:137) as a `fixed inset-x-0 bottom-0` mobile sheet with `slideInBottom` + `overscroll-contain` + `max-h-[calc(100dvh-4rem)]` + `rounded-t-card` (mirroring the in-picker calendar's mobile sheet at `DateRangePicker.tsx:418`) + a brand-orange full-width Done button in the thumb zone + a labelled X close + a `role="dialog"` + `aria-modal="true"` + `aria-labelledby` surface; the sheet threads the same `updateAdults` / `updateChildren` / `onRangeChange` writers the sidebar uses so URL params stay in sync without a separate save step; the MBUX-11 source-text tripwire is updated to pin the new `onEdit?: () => void` prop + invert the `scrollIntoView` / `classList` / `setTimeout` assertions to negative-space pins; the BookingPage `<aside>` keeps its `id="booking-stay-details-aside"` + `scroll-mt-32` as a defensive deep-link fallback for the BookingStickyFooter's URL-driven scroll + accessibility tools; desktop is unchanged because the strip is `lg:hidden` so the sheet never mounts there — sidebar remains the edit surface on desktop; #275) and **MBUX-19 shipped** (the BookingPage aside's three editable blocks — `<DateRangePicker>` + Adults stepper + Children stepper — are wrapped in `<div className="hidden lg:contents">` so on mobile the aside shows only the cart (read-only) + info card (static help text) + the "Stay details" heading; on `lg:` the wrapper dissolves into the parent's `space-y-6` stacking context (`lg:contents` removes the wrapper entirely, NOT `lg:block` which would add an extra anonymous box and double the gap between the picker and the stepper below); the cart + info card stay visible on mobile because they're read-only and don't duplicate the sheet; the MBUX-11 + MBUX-18 source-text tripwires still pass (the aside's `id` + `scroll-mt-32` defensive deep-link target is unchanged); new source-text regression net `tests/api/mbux-19-hide-aside-edit-controls.test.ts` (11 guards) pins the wrapper's exact `<div className="hidden lg:contents">` opening tag (a future refactor that adds an extra class fails the equality check and forces an updated decision entry), the three editable blocks inside (DateRangePicker + Adults + Children), the cart + info card outside (siblings, not children), the absence of `lg:block` (which would break `space-y-6`), the rationale comment that references the BOOKING-MOBILE-UX.md duplicate-summary rule, and the unchanged `aside#booking-stay-details-aside` + `scroll-mt-*` defensive fallback; #276). Phase 15 closed at 10/10 on 2026-10-16 (MBUX-01..10); MBUX-11 closed the Step 1 mobile review on 2026-10-16; MBUX-12 closed the Step 2 mobile review on 2026-10-16; MBUX-13 closed the Step 4 mobile review (placement) on 2026-10-16; MBUX-14 closed the Step 4 mobile review (state) on 2026-10-16; MBUX-15 closed the hold-expired banner mobile review on 2026-10-16; MBUX-16 closed the breakfast cut-off explainer on 2026-10-16; MBUX-17 closed the MBUX-16 cut-off duplication on 2026-10-16; MBUX-17.1 closed the MBUX-17 pill wrap on 2026-10-16; MBUX-17.2 closed the MBUX-16/17 help-text enhancement on 2026-10-16; MBUX-18 closed the Step 1 mobile-UX review follow-up (Edit affordance) on 2026-10-16; MBUX-19 closed the MBUX-18 duplicate-aside-edit-controls follow-up on 2026-10-16. **The MBUX-10 browser-QA matrix at 320/375/390/430px + tablet + desktop remains outstanding** — owner to pick the staging or local env to drive the pass against. **Numbering note:** this plan originally reserved decision **#253**, but MSL-01 shipped the same day and consumed it; the reservation was stale, so the MBUX implementation record is **#254**.

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

`Edit` opens the existing range calendar and occupancy controls in a mobile-appropriate expandable area or sheet. Per MBUX-18 (decision #275, 2026-10-16), the sheet is a mobile bottom sheet (`EditStayDetailsSheet` at `guest-app/src/components/EditStayDetailsSheet.tsx`) anchored to the bottom edge with `fixed inset-x-0 bottom-0 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-t-card`, animating in via the shared `slideInBottom` variant (FRONTEND.md §Modals + BOOKING-FLOW.md:74 / DR-03). It carries the same `<DateRangePicker>` + Adults/Children steppers the sidebar renders inline (so the normalization, horizon, stay-length cap, and selection rules in DR-03 + MSL-01 stay in force without a second implementation), plus a labelled X close + a full-width brand-orange `Done` button in the thumb zone + a `role="dialog"` + `aria-modal="true"` + `aria-labelledby="edit-stay-details-title"` surface. **Per OCT-H11 (2026-10-20, decision #289) the sheet now OWNS the focus + scroll contract the `aria-modal` declaration implies:** it traps Tab focus inside the sheet, closes on `Escape`, restores focus to the element that had it when the sheet opened, and locks the body scroll while it is open (dragging the dimmed backdrop no longer scrolls the page behind the sheet — the sheet's own `overscroll-contain` only contains the scroll WITHIN the sheet). The primitive is `guest-app/src/utils/useFocusTrap.ts` (the guest-app port of the admin app's `admin-app/src/utils/useFocusTrap.ts` from decision #107); it is deliberately NOT in `@spark-inn/shared`, because that package is imported by the server bundle (which has no React and no DOM). The sheet is `lg:hidden`-guarded so it cannot open on desktop (the strip itself is `lg:hidden`, so the Edit pencil never mounts there); on desktop the right-hand sidebar remains the edit surface. The sheet writes URL params live through the same `updateDateParams` + `updateAdults` + `updateChildren` writers the sidebar uses, so no separate save step is required. The BookingPage `<aside id="booking-stay-details-aside">` keeps its id as a defensive fallback for deep links that jump straight to the aside (the BookingStickyFooter's URL-driven scroll, accessibility tools); the Edit pencil does NOT scroll to it.

The page does not repeat the same stay summary in both a header card and sidebar card. Per MBUX-19 (decision #276, 2026-10-16), the BookingPage aside's three editable blocks (`<DateRangePicker>` + Adults/Children steppers) are wrapped in `<div className="hidden lg:contents">` so on mobile the aside renders only the cart + info card + the "Stay details" heading; on `lg:` the wrapper dissolves (`lg:contents` removes the wrapper from the layout, NOT `lg:block` which would add an extra anonymous box and double the gap between the picker and the stepper below) and the three controls slot back into the parent's `space-y-6` stacking context. The MBUX-18 sheet is the only edit surface on mobile; the MBUX-07 aside is the only edit surface on `lg:`. The cart + info card stay visible on both surfaces because they are read-only and do not duplicate the sheet.

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

> **Implementation note (2026-10-20, decision #299 — OCT-L1):** the tray uses the **"as part of the action area"** branch. It originally rendered as the last element of the Step 1 page body while the footer is `fixed`, so the tray scrolled away and the footer stayed pinned — on a phone with 4+ room types the guest tapped "+" and got no aggregate feedback near the thumb. It now renders inside `BookingStickyFooter`'s `aboveAction` slot, so it is pinned with the footer. The expanded lines are capped at `40vh` with an internal scroll (inside a fixed bar an uncapped list grows the footer until it swallows the screen), and Step 1's `<main>` bottom reserve grew from `8rem` to `13rem` so the taller footer never covers the last room card.

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

**The confirmation (OCT-M8, 2026-10-20, decision #294).** The confirmation is an inline `role="status"` / `aria-live="polite"` line that:

- **Renders exactly ONCE.** It carries the DATE it belongs to, so it renders inside the card the guest acted on — not once per date. Before this, the notice was a bare string rendered inside the per-date map, so a 3-night stay printed "Applied these choices to 2 remaining days." three times, in three different cards.
- **Clears itself after 8 seconds** (`BREAKFAST_COPY_NOTICE_TIMEOUT_MS`). It was never cleared before — its own source comment claimed a clearing effect existed "further down", and it did not.
- **Clears the moment the guest edits a meal.** Leaving it up after an edit falsely implied the copy was still in effect for the other days.
- **Reports only real changes.** "Those choices are already set on every remaining day." when nothing changed, instead of claiming a copy that did not happen.

### Other add-ons

**Superseded by OCT-M4 (2026-10-20, decision #297).** This section originally described compact expandable cards with a single "Add / toggle" control, and the configuration (quantity, service date) appearing only after selection. The shipped grid follows `plan/features/OTHER-ADD-ONS.md` instead — the **per-day quantity input** shape — because the BR-12 data model is per day × per add-on (`otherAddOnSelections[date][].quantity`, 0..guest count), and a single toggle per card has no way to express "2 guests on Nov 2, 1 guest on Nov 3".

The grid renders below the breakfast section, one card per enabled add-on:

- Name.
- Short description.
- Price and unit.
- One row per service date of the stay, each with a **44px-tall number input** (0..guest count) and the row's line total.
- A cut-off pill ("Ordering closed") when the add-on's cut-off has passed — anchored on the BOOKING's check-in (OCT-M5, decision #292), so the lock is per add-on, not per date.
- The whole section renders NOTHING when the catalog is empty or the hotel has taken other add-ons off sale (OCT-M1, decision #295) — an empty grid under a heading reads as a broken page.

Breakfast remains a specialized per-date/per-guest interface and is not forced into the generic quantity model. The two grids sit side by side but keep their own shapes.

One line under the section heading tells the guest that other add-ons are charged separately from the room rate and settled at the hotel — they are NOT inside `totalPrice` (they are added on top of it for the balance; see `plan/features/OTHER-ADD-ONS.md` decision 2), so the guest should not expect to see them on the online room bill.

### Live summary and action

The step shows a concise live selection summary, including breakfast count, other-add-on count when applicable, and add-on total.

There is one context-aware primary action:

- No selection: `Continue without add-ons`.
- Any selection: `Continue with N add-ons · total`.

**Per OCT-M4 (decision #297) the count and the total cover the UNION** of breakfast AND other add-ons — the count is the breakfast slots + the other-add-on rows, the figure is `breakfastTotal + otherAddOnTotal`. The BR-10 pattern was never scoped to breakfast alone, so the "without add-ons" branch means "without add-ons of ANY kind".

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

**Per OCT-H5 + OCT-H10 (2026-10-20, decision #288) the image controls are a working round-trip, and the removal is safe:**

- **Upload / replace / remove PERSIST immediately.** The pre-fix behaviour only mutated local state and toasted "Meal image uploaded" — the guest-facing catalog still had no photo until the admin separately pressed Save, and navigating away orphaned the Storage object so the upload appeared lost. The photo action now persists the `meals` array through the same `BreakfastMealSchema` validation the Save button uses, and the success toast fires only AFTER the row is safely in Firestore.
- **Removing an image cannot break the rest of the Dining tab.** The pre-fix removal wrote `imageUrl: undefined` into the meal object, and the Firestore SDK rejects an `undefined` field value outright (`Unsupported field value: undefined` — the admin app never sets `ignoreUndefinedProperties`). Because the offending key sat inside one element of the `meals` array, EVERY subsequent write of that section failed: the admin could not save the cut-off time, the breakfast toggle, a meal name or a price until they reloaded the page. A cleared optional field is now REMOVED from the object (the key is absent, not `undefined`), and every settings write strips `undefined`-valued keys as a safety net.
- **The Storage object is deleted only AFTER the row no longer references it**, so the guest menu can never point at a deleted file.
- Only the `meals` array is written by a photo action; the rest of the Dining form keeps its own Save semantics, so an unsaved cut-off-time edit is never committed as a side effect of a photo action.

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
