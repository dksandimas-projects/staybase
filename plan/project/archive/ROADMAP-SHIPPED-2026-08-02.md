# HISTORICAL ARCHIVE — Shipped Roadmap Item Detail (2026-08-02)

> **HISTORICAL ARCHIVE** — Verbatim shipped-item specifications lifted out of [`plan/project/ROADMAP.md`](../ROADMAP.md) once each item landed, per `plan/docs/CONTRIBUTING.md` §Documentation Budgets & Lifecycle ("items ship → move the detail to the archive and leave a one-line ✅ pointer"). Do not read routinely for active tasks. Open follow-ups were deliberately NOT archived with their parent block and remain in the roadmap.

---

## CRL-05 — Structured, snapshotted cancellation policy

- ✅ **CRL-05 — Structured, snapshotted cancellation policy (WITH MRB-01/02)** — add runtime-editable cutoff + before/after refund percentages beside the human-readable policy. Snapshot the structured rule, rendered wording/version, scheduled check-in time, and policy source onto the reservation at creation; support an explicit corporate override. The server never parses prose to decide money. Legacy null-snapshot bookings use the current rule and carry a visible legacy-fallback source. One pure shared evaluator owns cutoff/timezone/rounding behavior and is characterized at the exact cutoff, one minute either side, DST/locale-independent timestamp inputs, partial percentages, and malformed legacy settings. (v0.230.0, merge `babf238`, 2026-08-02)

---

## MRB-06 — Guest `/book` flow: quantity per room type

- ✅ **MRB-06 — Guest `/book` flow: quantity per room type** — Shipped 2026-08-02. Step 1 has an availability-capped room cart, running aggregate total, and automatic adult/child/extra-bed distribution across room stays. Steps 2–4 retain one lead guest and one reservation payment; confirmation lists every assigned room.

---

## MRB-07 — Admin New Booking modal: multi-room

- ✅ **MRB-07 — Admin New Booking modal: multi-room** — the modal builds a reservation from a list of room stays (own type + own vacant room + own adults/children/extra beds per stay, mixed types allowed), with claimed rooms filtered out of the picker and submission blocked until every stay is creatable. `/api/bookings/create-walkin` takes an optional `rooms[]`, prices each stay against its own type, charges breakfast per guest across the reservation, allocates a reservation-level manual override and the once-per-reservation voucher across stays (remainder on room 1, reservation total defined as the sum of stored allocations per MRB-11), writes one booking doc per stay with its own `bookingRef` + lookup token + `reservationPosition`, and aborts the whole transaction if any room is unavailable. The Bookings list renders one collapsible reservation row (ref, room count, aggregate total, balance due, Mixed status) with nested room stays; the four operational quick views stay room rows. The drawer gains a reservation strip with sibling-room navigation, every action is labelled `This room` / `All rooms`, and deep links resolve `bookingId`, `reservationId`, and `reservationRef`. Also fixed: the admin client was dropping the desk's `numAdults` / `numChildren` / `extraBedCount` from the create-walkin body, so every staff-created booking was priced as all-adults with no extra beds. (2026-08-02)
