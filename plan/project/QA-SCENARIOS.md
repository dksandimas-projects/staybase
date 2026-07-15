# Manual QA — Real-Life Test Scenarios
> Audience: manual QA testers (no codebase knowledge required)
> Requires: none — this document is self-contained; spec references are provided per section for deeper detail
> Last updated: 2026-07-15

End-to-end scenarios written as real guest/staff stories. Each scenario lists the actor, setup, steps, and expected results. Run them against staging (or production during a supervised pass) using a test email inbox you control.

**Conventions**

- "Guest site" = `www.sparkinnbohol.com` · "Dashboard" = `admin.sparkinnbohol.com`
- Use test guest emails you can open (e.g. a Gmail with `+` aliases). Never use real guest PII.
- After every scenario that creates or changes a booking, verify the change appears in the Dashboard in real time (no refresh needed).
- Statuses referenced: `pending → payment-uploaded → payment-confirmed → confirmed → checked-in → checked-out`, plus `cancelled`.

---

## 1. Standard Booking Flow

Spec: `plan/features/BOOKING-FLOW.md`

### BF-01 — Family books a weekend stay, pays at hotel
**Actor:** Guest (anonymous)
**Setup:** Pick dates that include a Saturday or Sunday night.
1. From the homepage availability checker, pick check-in Friday / check-out Sunday, 2 guests → continue to `/book`.
2. Step 1: room type cards show "X of Y available"; the total shows separate lines for regular vs weekend nights.
3. Step 2: fill guest details. Confirm the **Next button stays disabled until the privacy/terms consent checkbox is ticked**.
4. Step 3: select **Pay at Hotel**. No screenshot upload should appear. Tick terms, confirm.
5. Step 4: booking reference shown (`SI-YYYYMMDD-NNN` format), price breakdown matches Step 3, "payment due upon arrival" copy, Add to Calendar works.

**Expected:** Booking appears in Dashboard with status `pending` (pay-at-hotel may show `confirmed` per current rules — verify against dev), source `online`. Guest receives the "booking submitted" acknowledgment email. Weekend nights priced at the weekend rate; the emailed total, Step 4 total, and Dashboard total all match.

### BF-02 — Guest pays via GCash with screenshot + reference number
**Actor:** Guest
1. Book any room; at Step 3 choose **GCash**.
2. Confirm the GCash QR/account info displays, and both a **screenshot upload** and a **reference number field** appear (reference field only if the method requires it — check Settings → Payment Methods).
3. Try to confirm without the screenshot → Confirm must stay disabled.
4. Upload a screenshot (any image ≤ 5MB), enter a reference number, confirm.

**Expected:** Booking lands as `payment-uploaded`. It appears in the Dashboard's **Pending Payments** alert section. Step 4 shows "payment under review" copy. Payment proof image and reference number visible to staff in the booking drawer — and **never** visible anywhere on the guest site.

### BF-03 — Breakfast add-on changes with guest count
**Actor:** Guest
1. Step 1: pick a room type with the **Room + Breakfast** option; note the nightly rate.
2. Change guest count from 2 to 3 → breakfast-inclusive rate must increase by one more breakfast per night.
3. Complete the booking with breakfast.

**Expected:** Step 3 shows breakfast as its own line (guests × nights × rate). At check-in, staff can enter per-guest silog selections in the booking drawer; those appear in the Dashboard's "Today's Breakfast" section on the stay dates.

### BF-04 — Two guests race for the last room (double-booking prevention)
**Actor:** Two guests (two browsers/devices)
**Setup:** A room type with exactly 1 room left for the chosen dates.
1. In both browsers, walk the same dates/room type to Step 3.
2. Confirm booking in browser A → success.
3. Confirm booking in browser B.

**Expected:** Browser B gets a clear "no longer available" conflict error and is sent back to Step 1 — **no** second booking is created. Only one booking exists in the Dashboard.

### BF-05 — Guest abandons and returns mid-flow
1. Fill Step 2, go to Step 3, then press Back to Step 2 and Step 1.
2. Return forward.

**Expected:** All entered data preserved in both directions; nothing resets.

---

## 2. Senior Citizen / PWD Discount

Spec: `plan/features/BOOKING-FLOW.md §Step 3`, `plan/features/BOOKINGS-MANAGEMENT.md §Discount ID`

### SD-01 — Senior citizen books online with OSCA card
**Actor:** Guest (senior citizen)
1. Book a room; at Step 3 select discount **Senior Citizen (20%)**.
2. An **"Upload your OSCA Card"** field must appear immediately; Confirm stays disabled until an ID photo is uploaded.
3. Upload the ID (jpg/png/webp ≤ 5MB) → thumbnail preview shows. Total drops 20%.
4. Complete the booking.

**Expected:** Booking total reflects the 20% discount. In the Dashboard drawer the ID photo shows with a yellow **"Pending ID Verification"** badge, labeled "OSCA Card".

### SD-02 — Guest switches discount back to "None"
1. At Step 3 select PWD, upload an ID, then switch the selector back to **None**.

**Expected:** Upload field disappears, uploaded photo is cleared, total returns to full price. Booking created with no discount.

### SD-03 — Staff verifies the discount ID
**Actor:** Front desk
1. Open SD-01's booking drawer → discount panel shows the ID thumbnail + "View Full Size".
2. Click **Verified**.

**Expected:** Green "ID Verified" badge; discount stands; total unchanged.

### SD-04 — Staff rejects an invalid discount ID
**Actor:** Front desk
**Setup:** A booking with a Senior/PWD discount claimed (use a blurry/wrong image).
1. In the drawer, choose **Rejected** → confirmation modal appears with an optional reason (e.g. "ID expired").
2. Confirm rejection.

**Expected:** Red "Discount Rejected" badge. **Total price restored to the pre-discount amount** — but any voucher/member/points deductions on the same booking stay applied. Guest receives a rejection email including the reason. The discount cannot be re-applied from the drawer afterwards.

### SD-05 — Walk-in senior presents a valid ID at the front desk
**Actor:** Front desk
**Setup:** An existing booking with **no** discount, status `confirmed` (or any pre-checkout status).
1. Open the drawer → **Apply discount / voucher** → select Senior, optionally photograph the ID.
2. Apply.

**Expected:** Total re-priced with 20% off in the correct stacking order (Senior/PWD first, then voucher, then member discount). If payments already collected exceed the new total, the drawer surfaces "guest is owed ₱X". Updated receipt PDF reflects the new total. This must work regardless of whether the online Senior/PWD toggle is enabled.

---

## 3. Vouchers

Spec: `plan/features/VOUCHERS.md`

**Setup for all:** Admin creates vouchers under Rates → Vouchers: (a) `SAVE20` — 20%, usage cap 5, no expiry; (b) `FLAT500` — ₱500, restricted to one room type; (c) `EXPIRED1` — any value, expiry date in the past; (d) `OFFNOW` — active, will be disabled mid-test.

### VC-01 — Valid percent voucher
1. Book to Step 3, enter `SAVE20`, Apply.

**Expected:** "Code applied: -20%" style success, total updates. After booking completes, the voucher's used count increments in admin (increments on **booking creation**, not on Apply). `voucherCode`/discount visible on the booking in the drawer.

### VC-02 — Voucher + senior discount stack
1. Select Senior Citizen (20%) at Step 3, upload ID, then apply `SAVE20`.

**Expected:** Senior discount applies first, voucher percent applies to the already-discounted total. Both show as separate negative lines. Final total never below ₱0.

### VC-03 — Flat voucher on the wrong room type
1. Book a room type **not** covered by `FLAT500`, enter the code.

**Expected:** Clear "not applicable to this room type" error; total unchanged.

### VC-04 — Expired voucher
1. Enter `EXPIRED1` at Step 3.

**Expected:** "Expired" error message; no discount.

### VC-05 — Usage cap exhausted
**Setup:** `SAVE20` already used 5 times (complete 5 bookings or have admin set the cap to a used-up value).
1. Attempt to apply it a 6th time.

**Expected:** "Usage limit reached" error.

### VC-06 — Voucher disabled while guest is mid-booking
1. Guest applies `OFFNOW` at Step 3 (success). Before they confirm, admin toggles the voucher off.
2. Guest confirms the booking.

**Expected:** Server re-validates at creation and rejects with a clear error — booking is not created with the dead voucher.

### VC-07 — Cancelling a voucher booking releases the cap slot
1. Complete a booking with a capped voucher; note the used count.
2. Cancel the booking (guest via `/my-booking` while still `pending`/`payment-uploaded`, or staff via drawer).

**Expected:** Voucher used count decrements by 1 (never below 0).

### VC-08 — Front desk role cannot manage voucher campaigns
**Actor:** Front desk account

**Expected:** Voucher creation/editing is not accessible to Front Desk; Admin account can create, disable, and edit. Front Desk can still see an applied voucher's outcome on a booking.

---

## 4. Corporate

Spec: `plan/features/CORPORATE-BOOKING.md`, `plan/features/CORPORATE-INQUIRIES.md`

### CO-01 — New corporate inquiry from the guest site
**Actor:** Company HR officer
1. On the Corporate Stays marketing page, submit the inquiry form (company, contact, rooms, dates).

**Expected:** Success confirmation on the site. Inquiry appears in the Dashboard's **New corporate inquiries** section and in the `/corporate` pipeline **New** column, in real time. Staff notification email arrives.

### CO-02 — Staff works the inquiry pipeline
**Actor:** Staff
1. Open CO-01's inquiry → move through Contacted → Negotiating; add a note at each stage.

**Expected:** Notes appear newest-first with staff name + timestamp. Status buttons are context-aware (only valid next stages shown). Declined inquiries become view-only.

### CO-03 — Generate an access code and use it to book
**Actor:** Staff, then corporate guest
1. At Negotiating stage, open **Generate Access Code**: custom code (e.g. `ACME2026`), per-room-type rates, Generate.
2. As a guest, go to `/corporate/book`, enter the code, Validate.
3. Complete a booking.

**Expected:** Validation shows the company name and unlocked rates; Step 1 cards show the negotiated rates (labeled "Negotiated rate applied") instead of standard/weekend rates. "Corporate Rate — [Company]" badge persists across all 4 steps. Step 2 requires the corporate fields (company name etc.). Booking shows `isCorporate: true`, source `corporate`, the code stored, and the code's usage count increments. **No voucher input** anywhere in the corporate flow.

### CO-04 — Corporate booking without a code (flat rate)
1. At `/corporate/book`, choose **Continue without code**.
2. Complete a booking.

**Expected:** Flat corporate rate from settings applies (never ₱0 — falls back to standard rate if unset). Booking is `isCorporate: true` with no code stored; company name saved as entered.

### CO-05 — Expired / invalid access code
1. Enter a nonsense code, then an expired one (ask dev to expire a test code).

**Expected:** Friendly error each time; guest can still continue without a code — the flow is never dead-ended.

### CO-06 — Chargeback vs personal-pay
1. Book corporate with **Charge Back** billing → note about the LOU email appears; no payment upload required; booking is pay-at-hotel.
2. Book corporate with personal GCash payment → receipt upload is required; Confirm disabled until upload completes; booking lands `payment-uploaded`.

### CO-07 — Convert an inquiry into a booking
**Actor:** Staff
1. From the inquiry drawer, **Convert to booking**; the form is pre-filled from the inquiry.
2. Submit for available dates → booking created; inquiry moves to Converted.
3. Repeat with dates that conflict with an existing booking.

**Expected:** Conflict attempt shows the availability error and creates nothing. Successful conversion links the booking and inquiry to each other.

---

## 5. Contact Us

Spec: `plan/features/CONTACT-INQUIRIES.md`

### CT-01 — Guest sends a message
1. On `/contact`, fill name/email/subject/message, submit.

**Expected:** "Sending…" state, then green "Thanks! We received your message…" banner (auto-dismisses ~5s). Hotel support inbox gets a notification email within ~30s; the sender gets a "we received your message" confirmation email. Inquiry stored with status `new`.

### CT-02 — Validation and limits
1. Submit empty → inline errors per field, no request sent.
2. Bad email format → inline error.
3. Paste a >2000-char message → counter turns red, submit disabled.

### CT-03 — Spam burst
1. Submit 6 valid messages within one minute from the same connection.

**Expected:** 6th attempt shows "Too many requests, please try again in a minute."

### CT-04 — Mobile + accessibility spot-check
1. On a phone (375px width): single-column form, all touch targets ≥ 44px, no horizontal scroll.
2. Keyboard-only: Tab through all fields, submit with Enter.

---

## 6. Booking Lookup & Guest Cancellation

Spec: `plan/features/BOOKING-LOOKUP.md`

### LK-01 — Guest checks their booking status
1. At `/my-booking`, enter a valid booking ref + the booking email.

**Expected:** Booking card with status timeline matching the Dashboard status exactly.

### LK-02 — Wrong email never leaks a booking
1. Enter a valid ref with a **different** email.

**Expected:** Generic "couldn't find a booking" message — never confirms the ref exists.

### LK-03 — Guest cancels a pending booking
**Setup:** Booking in `pending` or `payment-uploaded`.
1. Look up the booking → Cancel button visible → confirm in the modal (optionally give a reason).

**Expected:** Status flips to `cancelled` everywhere immediately; cancellation email arrives; the room becomes bookable again for those dates. Cancel button must be **hidden** for `confirmed`, `checked-in`, and `checked-out` bookings.

### LK-04 — Resend confirmation email
1. On a found booking, click Resend.
2. Click it again immediately.

**Expected:** First send arrives; immediate retry is blocked with a cooldown message.

---

## 7. Guest Intercom

Spec: `plan/features/INTERCOM-GUEST.md`

### IC-01 — Checked-in guest scans the room QR
**Actor:** Guest checked into Room 202 (create + check in a test booking first)
1. Scan the room QR (or open `/intercom/:roomId` on a phone).
2. Enter the **last name used on the booking** at the verification prompt.

**Expected:** Verification passes (case/punctuation-insensitive — "DE LA CRUZ" matches "De la Cruz"); greeting uses the last name; chat opens showing "Room 202 — You're connected to the front desk". Refreshing the page skips the prompt for the rest of the stay.

### IC-02 — Wrong last name / vacant room
1. Enter a last name that doesn't match the booking.
2. Separately, open the intercom URL for a room that is **not** checked in.

**Expected:** (1) Calm "couldn't verify" message with the front desk phone as fallback — the real name is never revealed. (2) "This room isn't currently checked in" screen; no chat, no name prompt.

### IC-03 — Chat + quick requests
1. Send a typed message; tap a quick-request chip (e.g. Extra Towels).
2. Have staff reply from the Dashboard's Intercom Inbox.

**Expected:** Guest message and quick-request badge appear instantly in the admin inbox (badge visually distinct from typed text). Staff reply appears in the guest thread in real time without refresh. Unread badge counts update on the admin sidebar.

### IC-04 — Previous guest can't see the new guest's chat
**Setup:** Guest A checked out of Room 202; Guest B has since checked in. Guest A still has the intercom tab/bookmark.
1. As Guest A, reopen the intercom link.

**Expected:** Guest A is re-prompted for verification and their old last name no longer passes (booking no longer current). Guest B, once verified, sees only messages from their own stay — no leftover conversation from Guest A.

### IC-05 — Voice call to front desk
1. In the chat header, tap **Call Front Desk**; grant mic permission.
2. Staff accepts the incoming call in the Intercom Inbox.
3. Test mute, then hang up. Also test: deny mic permission; and let a call ring unanswered.

**Expected:** Two-way audio connects; mute works; hang-up by either side closes both ends. Denied mic → falls back to a tappable phone number. Unanswered → auto-cancels after ~30s with "No answer. Try again or send a message."

### IC-06 — Invalid QR
1. Open `/intercom/not-a-real-room`.

**Expected:** "This QR code is not valid. Please contact the front desk."

---

## 8. Spark Essentials (In-Room Store)

Spec: `plan/features/STORE-GUEST.md`, `plan/features/STORE-MANAGEMENT.md`

### ST-01 — Guest orders snacks, cash on delivery
**Actor:** Checked-in guest, via the intercom **Shop** tab
1. Add 2–3 items to the cart, adjust quantities, check the running total.
2. Checkout with **Cash on Delivery** → place order.

**Expected:** Order confirmation with reference number; a styled order badge posts into the chat thread; order appears in admin Store Management immediately with status `placed`; the status tracker on the guest side follows Placed → Confirmed → Out for Delivery → Delivered as staff advances it.

### ST-02 — Add to Bill folio charge
**Setup:** Room has an active booking (`confirmed`/`checked-in`).
1. Order with **Add to Bill**.

**Expected:** Note about the charge being added to the room bill; order linked to the correct booking in admin. At checkout, the delivered order's amount appears in the booking's folio (see FD-07).

### ST-03 — Online payment with screenshot
1. Order with GCash (or any online method) → QR/account info shows; screenshot upload is **required** before Place Order.

**Expected:** Order lands with the proof viewable in admin; upload failure shows an error and blocks submission.

### ST-04 — Stock rules
1. Confirm an out-of-stock item shows "Out of Stock" and cannot be added to the cart.
2. Ask admin to zero an item's stock while it's already in your cart, then place the order.

**Expected:** Server rejects with a stock error; no order created.

### ST-05 — Cancel an order
1. Place an order; cancel while status is still `placed` → succeeds, cancelled badge shows.
2. Place another; have staff confirm it first, then look for the cancel button.

**Expected:** Cancel button hidden once the order is past `placed`.

### ST-06 — Store disabled
**Setup:** Admin disables the store in Settings.

**Expected:** Shop tab disappears from the intercom entirely.

---

## 9. Front Desk Operations (Payments, Check-in, Checkout, Overstay)

Spec: `plan/features/BOOKINGS-MANAGEMENT.md`, `plan/features/DASHBOARD-OVERVIEW.md`

### FD-01 — Confirm an uploaded payment
**Setup:** Booking from BF-02 (`payment-uploaded`).
1. On the Dashboard, the booking shows in **Pending Payments**. View the proof image; cross-check the reference number against the (test) payment record.
2. Confirm Payment.

**Expected:** Status advances to `payment-confirmed` and the guest gets the payment-confirmed email — exactly once, even if the button is retried. Then advance to `confirmed` from the drawer; guest gets the confirmation email.

### FD-02 — Reject a payment proof that doesn't match
**Setup:** A `payment-uploaded` booking (BF-02) whose reference number doesn't match the (test) payment record.
1. On the Dashboard's pending-payment card, confirm the guest's **reference number** is displayed next to the proof.
2. Click **Reject** → a modal opens with canned reason presets plus a free-text field. Try submitting with the reason empty → blocked.
3. Pick or type a reason (e.g. "reference doesn't match") and confirm.

**Expected:** Booking returns to `pending` — the room **stays held** for the guest (verify the dates are still blocked for new bookings). Guest receives a payment-rejected email stating the reason with a prompt to re-upload a corrected proof. At `/my-booking` the guest sees the rejection reason as a red banner on their pending booking. The old proof image and reference number remain visible to staff in the drawer (kept for audit). A notification appears on the admin bell badge. The guest can then upload a fresh proof, putting the booking back to `payment-uploaded` for another review (loop back to FD-01). Rejecting is only possible from `payment-uploaded` — the button must not appear on other statuses.

### FD-03 — Walk-in booking
1. Bookings page → **New Booking** → fill walk-in details for tonight; optionally tick immediate check-in.
2. Also attempt a walk-in for a room/date that's already booked.

**Expected:** Walk-in created with source `walk-in`, status `confirmed` (or `checked-in` if immediate). The conflicting attempt shows a clear conflict error and creates nothing.

### FD-04 — Check-in gate (no payment required, but registration is)
**Setup:** A `confirmed` pay-at-hotel booking — i.e. **no payment collected yet**.
1. Open the drawer; try to check in with no guest ID photo and empty registration.
2. Fill registration (nationality, address, DOB, gender, ID type + number, emergency contact, signature toggled) but skip the ID photo → still blocked.
3. Upload the guest ID photo → check in.

**Expected:** The check-in button stays disabled with a plain-language checklist of exactly what's missing at each step. Check-in succeeds **without any payment** — an unpaid guest can check in (payment gates checkout, not check-in). Room flips to `occupied` on the Dashboard grid.

### FD-05 — Record onsite payments toward the balance
**Setup:** FD-04's checked-in unpaid booking.
1. In the drawer's "Payments Collected Onsite" panel, record a partial cash payment → Outstanding Balance (red) drops.
2. Record the remainder via GCash → balance ₱0, green **"Fully Settled"** badge.
3. Try recording ₱0 → blocked. Record an extra ₱200 on another booking → amber "Overpaid by ₱200", no error.

**Expected:** Every payment row shows amount, method, note, recorded-by, timestamp — and is **not editable or deletable** once saved.

### FD-06 — Checkout with unpaid balance (allowed, but flagged)
**Setup:** A checked-in booking with balance still due.
1. Click checkout → the folio review shows the balance due and a warning.
2. Proceed anyway.

**Expected:** Warning names the unpaid amount; checkout still completes after the staff confirms; the booking is flagged as checked out with a balance for audit. Room returns to `available`.

### FD-07 — Normal checkout with store charges + incidentals
**Setup:** Checked-in booking with a delivered add-to-bill store order (ST-02) and one incidental charge.
1. In the drawer's folio section, **Add charge** — e.g. category "Late checkout", label "Late checkout 2 PM", amount.
2. Review the folio: room + breakfast, store charges, incidental charges, payments collected, balance.
3. Collect the balance, then check out.

**Expected:** Grand total = room total + store orders + charges; balance math correct; receipt PDF itemizes all of it. Voiding a charge (single confirmation, reason required) adds a visible reversal — the original line is never deleted. A charge cannot be added after checkout.

### FD-08 — Overstay: guest doesn't leave on checkout day
**Setup:** A booking whose checkout date is today, still `checked-in`, and the hotel's checkout time has passed (or a booking with checkout date yesterday).
1. Open the Dashboard.

**Expected:** The **Overdue Check-outs** warning section appears (it's hidden entirely when there are none), listing guest, room, and how overdue; clicking the row opens the booking drawer for checkout. Handle it either way and verify:
- **Guest leaves late:** add a "Late checkout" incidental charge (FD-07), collect, check out.
- **Guest extends:** move/extend the booking's dates from the Calendar drawer's move form — blocked with a conflict error if the room is booked next; on success the guest gets the rescheduled email and the new total reflects the added nights.

### FD-09 — Early departure
**Setup:** Checked-in guest leaving 1 night early on a 3-night booking.
1. Check the guest out today.

**Expected:** The contracted total is **retained** (no automatic refund for the unused night); the receipt shows an explicit retained-total adjustment; the room frees up for the remaining dates.

### FD-10 — Refund (admin only)
**Setup:** A booking with collected payments; e.g. after SD-05 re-pricing left the guest overpaid.
1. As **Admin**, add a refund entry with method + reason.
2. Try refunding more than the net amount collected.

**Expected:** Refund shows in red in the ledger and receipt, immutable. Over-refund is rejected by the server. Front Desk role should not see the refund form.

### FD-11 — Room transfer / upgrade mid-stay
1. From the **Calendar** page, open a checked-in booking's drawer → Move booking → pick a room of a higher type.

**Expected:** Move blocked if the target room has conflicts or the guest count exceeds its capacity. On success: booking re-priced (price delta recorded), guest receives the rescheduled email. **Known gap:** the room grid's occupied/available markers may go stale after a mid-stay move — note it, don't file as new.

### FD-12 — Housekeeping toggle
1. On the Dashboard room grid, tap a room's housekeeping badge repeatedly.

**Expected:** Cycles Clean → Dirty → In Progress → Clean, saving instantly; a second staff session sees each change in real time.

---

## 10. Spark Rewards

Spec: `plan/features/SPARK-REWARDS.md`

### RW-01 — Guest joins after booking
1. Complete a booking while logged out → Step 4 shows the "Join Spark Rewards" prompt.
2. Sign up with email via `/signup` (consent checkbox required).

**Expected:** Member number issued (`SR-XXXXX`); the just-made booking (and any past bookings on the same email) appear under **My Stays**. Logged-in members should **not** see the Step 4 join prompt on their next booking.

### RW-02 — Member discount on a booking
**Setup:** Member discount enabled in rewards settings.
1. Book while signed in as a member.

**Expected:** Member discount appears as its own deduction line, stacking after Senior/PWD and voucher deductions; server-side total matches.

### RW-03 — Points redemption at the desk (admin)
**Setup:** Member with a points balance and a `confirmed` booking.
1. In the booking drawer's redemption panel, enter points → live ₱ preview → Apply (admin role).
2. Verify only one redemption is possible per booking; test **Undo** (admin, only while still `confirmed`).

**Expected:** Total drops by the computed value; points deducted from the member and logged in their history; undo restores both.

### RW-04 — Account self-service
1. As a member: edit profile, change password, view the rewards card, then test **Delete account** (confirmation required).

**Expected:** Deletion erases the account per the privacy policy; the member can no longer sign in.

---

## 11. Cross-Cutting Sanity Checks

Run once per release pass:

- **PII stays private:** payment proof URLs, discount IDs, guest registration data, and room "remarks" never appear anywhere on the guest site or in guest API responses.
- **Roles:** Front Desk cannot reach Settings, staff account management, rate/voucher management, refunds, or points-redemption apply/undo; Admin can.
- **Real-time everywhere:** every admin list (bookings, inbox, pipeline, orders, room grid) updates without a manual refresh.
- **Mobile:** guest booking flow and the admin dashboard both work at 375px width — no horizontal scroll, all tap targets ≥ 44px.
- **Emails:** each transactional email (submitted, confirmed, payment-confirmed, cancelled, discount-rejected, rescheduled, contact notifications) arrives once — not zero times, not twice. The Resend panel in the booking drawer can re-send them manually.
- **Version footer:** the current version number displays in the footer of both apps.
- **Bot gates:** the Turnstile widget renders on booking Step 3, the corporate code gate, and the contact form; submitting twice in a row doesn't fail with a stale-token error.
