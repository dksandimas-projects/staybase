# Product Owner Decisions — 2026-08-15

Two roadmap items opened during the 2026-08-14 audit pass need a decision from the product owner before any work begins. Both are **doc-only** entries in `plan/project/ROADMAP.md` (VOU-03 + DSC-04). This note summarizes the trade-offs for each so the owner can decide in one read.

## Decision needed #1 — VOU-03: Voucher mixed-type UX gap

### What

Vouchers declare an `applicableRoomTypes` array (e.g., a "Weekend-Only" voucher is configured for `["standard-double"]` only). The current behavior in `handleApplyBookingDiscount` (guest-app/server/handlers/bookings.ts) is **all-or-none per booking**: if the booking contains ANY room of a non-applicable type, the discount is rejected outright with a 400. There is no per-room partial discount — the whole booking is either accepted or rejected.

### The user-facing problem

A guest with a mixed-type reservation (e.g., 1 standard-double + 1 deluxe-suite) cannot use a voucher that only applies to standard-double. They see "Voucher not applicable to this booking" with no path forward, even though the voucher is legitimately applicable to part of their stay.

### Three options for the owner

**(a) Keep current behavior — all-or-none.**
The voucher applies to the whole booking OR not at all. Simplest semantics; matches how most hotel chains (Marriott, Hilton) handle "member rate" vouchers.
- **Pro:** No code change. Consistent with industry norm.
- **Con:** Guests with mixed-type bookings lose the voucher's value entirely.

**(b) Per-room partial application (split the discount across applicable rooms only).**
If the voucher applies to 1 of 2 rooms, discount 50% of the rooms' subtotal.
- **Pro:** Maximizes voucher utility for guests.
- **Con:** Requires changes to the rate breakdown builder (`guest-app/server/lib/rate-breakdown.ts:52-184` — the `RebuildableBooking` type doesn't include `voucherCode` for a reason), the discount chain helper, the receipt rendering, and the voucher's `usageCount` semantics (does a partial-application count as a "use"?). Roughly 200-400 lines of handler + test changes.

**(c) Show an inline error explaining the conflict + suggest splitting the booking.**
Detect the conflict during the booking flow and either reject early with a helpful message OR auto-split the booking into 2 separate bookings.
- **Pro:** Surfaces the issue before the guest invests 10 minutes in filling out the form.
- **Con:** Auto-split is a major UX change; the helpful-error variant is small but might still lose the guest.

### Recommend: (a) or (c-helpful-error). (b) is too large for the gain.

## Decision needed #2 — DSC-04: `applyReservationDiscount` atomicity

### What

The current `handleApplyBookingDiscount` operates on **per-child** bookings: a guest with a 2-room reservation applies a discount to each room in a loop (admin-app/src/pages/BookingsPage.tsx:7880-7900). This works but has 2 failure modes:

1. **Partial failure** — if room 1 succeeds and room 2 fails (e.g., voucher cap hit on room 2's subtotal), the guest is left with a half-discounted reservation. The transaction at the booking level is missing.

2. **Race condition** — 2 staff members applying a discount simultaneously could double-decrement the voucher's `usageCount` (caught by FOL-03 transaction reads-before-writes, but the discount itself could still be applied twice to the same room if the staff UI doesn't lock).

### The proposed future endpoint

`handleApplyReservationDiscount` (sibling to `handleRemoveVoucher`) would take a single reservation ID + voucher code and atomically apply the discount to all rooms in the reservation in **one Firestore runTransaction**. The transaction reads the reservation, computes the per-room breakdown, validates the voucher cap, writes the discount to all rooms + the reservation header, and decrements `usageCount` exactly once.

### Three options for the owner

**(a) Ship it now (estimated 300 lines + 150 lines of tests).**
Add the new endpoint + admin UI button. Keep the existing per-child path for backward compatibility; mark it deprecated.
- **Pro:** Closes the partial-failure + race window. Aligns with the per-reservation scope the rest of the system uses (corporate booking, voucher cancel, etc.).
- **Con:** Adds a new code path that needs to be maintained alongside the old one for 1-2 deprecation cycles.

**(b) Defer until a customer hits the bug.**
Document the partial-failure case in GOTCHAS + add a runtime warning when the admin UI detects a mid-loop failure. Reopen the discussion when it actually happens.
- **Pro:** No code churn now. Reactive to real demand.
- **Con:** A guest will eventually get a half-discounted reservation and need manual cleanup.

**(c) Just fix the partial-failure path (cheaper subset of (a)).**
Wrap the existing per-child loop in a `runTransaction` with rollback semantics. Keep the per-child structure; just guarantee atomicity.
- **Pro:** Smaller change (~80 lines + 80 lines of tests). Closes the failure mode without adding a new endpoint.
- **Con:** Doesn't close the race window as cleanly as (a). The 2-staff-simultaneous-apply case still exists.

### Recommend: (c) — defer (a) until the per-child loop shape is deprecated, but (c) is cheap insurance against partial failure.

## What the owner needs to do

Reply to this issue (or to whoever forwarded it) with one of:
- "VOU-03: option (a/b/c), DSC-04: option (a/b/c)"
- OR a brief rationale for a custom option

Then the agent will open implementation branches with the chosen semantics.

## Source-of-truth references

- VOU-03 roadmap entry: `plan/project/ROADMAP.md` (search "VOU-03")
- DSC-04 roadmap entry: `plan/project/ROADMAP.md` (search "DSC-04")
- VOU-03 spec context: `plan/features/VOUCHERS.md:30-50` (the `applicableRoomTypes` definition)
- DSC-04 spec context: `plan/features/VOUCHERS.md:65-85` (the per-reservation vs per-child discount scope)
- Audit pass that opened both: commit `a6f82f4` (docs/audit-session-summary-2026-08-14) — see "Open items needing owner decision" section

## Why this is in the repo (not Slack/email)

The two roadmap entries already live in `plan/project/ROADMAP.md` (committed). The trade-off summary is more discoverable when it's next to the spec — future agents running audits will see it without needing to reconstruct the conversation context. Once the owner decides, this file can be moved to `plan/project/archive/` alongside the resolved roadmap entries.
