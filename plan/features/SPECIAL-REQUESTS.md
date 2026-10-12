# Guest Booking Special Requests (SR) — Feature Spec

> Requires: `CLAUDE.md`, `plan/docs/FRONTEND.md`, `plan/docs/BACKEND.md`, `plan/docs/TYPES.md`, `plan/features/BOOKING-FLOW.md`, `plan/features/BOOKING-UNIFIED.md`, `plan/features/ROOM-MANAGEMENT.md`, `plan/features/SETTINGS.md`, `plan/features/BOOKINGS-MANAGEMENT.md`

## Why

The public booking Step 2 + the corporate Step 2 collected no in-flow preferences before this PR. The `Booking.specialRequests` free-text field was retired from the public form on `feat/special-requests-redirect` (2026-08-21) — the guest now sees a "Need something special? Reach out" redirect card pointing at the hotel email / phone. That worked for the staff-captured free-text path but left a real gap: guests have structured preferences (twin vs large bed, high-floor, quiet room, airport transfer) that the front desk cares about, and there's no booking-time surface to capture them. Owner-requested 2026-11-12 (concurrent with the dev cutover); implemented on `feature/special-requests-bed-setup`, v1.7.2 → v1.8.0.

## Decisions

1. **Bed set-up selection is per-room and always visible when applicable** — not a hidden accordion. Twin and Double room types can offer a guest choice between a large bed and twin beds (the classic hotel-flow example). Each room type carries a per-type `bedSetupValues: string[]` subset of the global `bedSetups` catalog; the section renders only when the subset is non-empty. Empty subset = "this type doesn't offer a choice" (Single + Family in the seed data).
2. **Additional preferences are a hidden accordion** ("Show additional preferences" toggle, default collapsed). Inside: a 2-column checkbox grid + a free-text "additional request" box + an "expected arrival time" dropdown. Mirrors the screenshot from the owner request (2026-11-12).
3. **Bed set-ups + additional preferences are admin-configurable catalogs** in Settings → Booking Preferences. Bed set-ups is global (one list per hotel); additional preferences is also global (one list per hotel). Room types carry only the per-type subset.
4. **Smoking/non-smoking is out of scope** — owner explicitly excluded it on 2026-11-12 ("no need for smoking/nonsmoking"). It's not part of the seed preferences.
5. **Free-text "additional request" re-introduces the guest-captured path** — the redirect card is retired. The `Booking.specialRequests` staff-captured field stays for post-booking email/phone follow-ups (`feat/staff-special-requests-capture`, 2026-08-21). The two surfaces are independent and live side-by-side in the booking drawer.
6. **Arrival time dropdown = 24h window from `hotelConfig.checkInTime`, not admin-configurable**. Owner decision on 2026-11-12 ("keep it fixed"). Times earlier than check-in are NOT offered (the existing `earlyCheckIn` Step 4 flow covers that). "I don't know" is the canonical first option and maps to `expectedArrivalTime: null` on the wire.
7. **Scope = both `/book` (public) AND `/corporate/book`**. Corporate's per-request flat-rate booking carries the same fields; the corporate cart is single-room-group so `bedSetup` is set on the first (and only) room.
8. **Admin read surfaces (per artifact list)**:
   - Booking drawer — new "Guest special requests" block above the staff `BookingSpecialRequestsEditor`
   - Calendar grid amber dot — gates on per-room `bedSetup` in addition to staff `specialRequests`
   - Staff new-booking email — adds a `Bed set-up` row (reservation-level `additionalPreferences` / `additionalRequest` / `expectedArrivalTime` surface via the booking drawer, not the per-booking email)

## Data shape

### Settings (`settings/hotelConfig`)

```ts
bedSetups: { value: string; label: string; icon?: string }[];
bookingPreferences: { value: string; label: string; icon?: string, surchargeNote?: string }[];
```

Both default-seeded from `shared/constants/index.ts → DEFAULT_BED_SETUPS` + `DEFAULT_BOOKING_PREFERENCES`. The 9 seeded preferences match the screenshot; the 2 seeded bed set-ups match the screenshot.

### Per room type (`settings/hotelConfig.roomTypes[]`)

```ts
roomTypes[i].bedSetupValues: string[];   // subset of bedSetups[].value; empty = no choice
```

The seed encodes the per-type reality (Twin and Double offer a choice; Single and Family don't).

### Wire (`POST /api/bookings/create` body)

```ts
roomSelections[i].bedSetup?: string;     // per-room; "" / absent = no preference
additionalPreferences?: string[];       // reservation-level; validated against bookingPreferences catalog
additionalRequest?: string;              // ≤500 chars per ADDITIONAL_REQUEST_MAX_LENGTH
expectedArrivalTime?: string | null;     // "HH:MM" in hotel timezone; null = "I don't know"
```

The corporate booking page sends `bedSetup` at the top level (single-room-group cart); the server mirrors it onto every child booking.

### Storage (on the booking / reservation doc)

- `Booking.bedSetup: string | null` — per-room snapshot, server-validated
- `Reservation.additionalPreferences: string[]` — reservation-level, deduped + intersected against the live catalog at create time (a stale preference that was later removed by the admin is filtered out)
- `Reservation.additionalRequest: string` — free-text snapshot
- `Reservation.expectedArrivalTime: string | null` — `HH:MM` snapshot or `null` for "I don't know"

## Server validation

The create handler cross-references every field against the live `settings/hotelConfig` in a Firestore transaction:

1. `roomSelections[i].bedSetup` must be one of `roomTypes[i].bedSetupValues` (or empty / absent → `null`). Invalid → `400` with message `Selected bed set-up "${value}" is not offered for room type ${type}.`
2. Every key in `additionalPreferences` must be in `bookingPreferences[].value`. Invalid → `400` with the offending keys listed.
3. `expectedArrivalTime` must be one of the options `buildArrivalTimeOptions(hotelConfig.checkInTime)` produces (the same helper the guest dropdown uses — they can never drift apart). `null` is always accepted. Invalid → `400`.

## Step 2 UI (guest + corporate)

A single shared `<SpecialRequestsBlock />` component renders:

1. **Bed set-up radios** — one radio group per unique picked room type; choice broadcasts to every room of that type on change (the "edit one room, mirror to all" pattern used for extra-bed count). Hidden entirely when no picked room type has a non-empty subset.
2. **"Show additional preferences" accordion** — collapsed by default. Inside: 2-column checkbox grid (preferences), free-text textarea with a 500-char counter, "Expected arrival time" dropdown with `I don't know` first followed by the 24h options derived from `hotelConfig.checkInTime`. The 24h options are derived server-side too (`shared/utils/bookingPreferences.ts → buildArrivalTimeOptions`), so client + server can never disagree on the option set.

## Admin read surfaces

- **Booking drawer** — new `<GuestSpecialRequestsBlock />` (read-only) above the staff `<BookingSpecialRequestsEditor />`. Shows bed setup per room (one row per booking doc that has a non-empty choice), preference chips (with the catalog's `surchargeNote` if set), the free-text payload quoted, and the formatted arrival time. Hidden when the reservation has none of the new fields (pre-SR legacy reservations stay non-silent via the staff editor alone).
- **Calendar grid amber dot** — `hasSpecialRequest || hasBedSetupPreference` triggers the icon. Tooltip mirrors the staff `specialRequests` text when present, else "Bed set-up: ${value}".
- **Staff new-booking email** — adds a `Bed set-up` row to the booking summary table when `Booking.bedSetup` is non-empty.

## SR-01..05 commit breakdown

| Commit | Surface | Files |
|---|---|---|
| **SR-01** | Admin: Booking Preferences tab + Room Types bedSetupValues editor | `shared/constants/index.ts`, `shared/schemas/bookingPreferences.ts`, `admin-app/src/context/AdminContext.tsx`, `admin-app/src/pages/SettingsPage.tsx` |
| **SR-02** | Guest + corporate Step 2 UI | `guest-app/src/components/SpecialRequestsBlock.tsx`, `guest-app/src/hooks/useRoomTypes.ts`, `guest-app/src/hooks/usePublicSiteContent.ts`, `shared/utils/bookingPreferences.ts`, `shared/index.ts`, `guest-app/src/pages/BookingPage.tsx`, `guest-app/src/pages/CorporateBookingPage.tsx` |
| **SR-03** | Wire + server validation + storage | `guest-app/server/handlers/bookings.ts` |
| **SR-04** | Admin read surfaces | `admin-app/src/pages/CalendarPage.tsx`, `admin-app/src/pages/BookingsPage.tsx`, `admin-app/src/components/GuestSpecialRequestsBlock.tsx`, `admin-app/src/context/AdminContext.tsx`, `shared/types/index.ts`, `guest-app/server/handlers/email.ts` |
| **SR-05** | Retire redirect card + Stripe fields cleanup | `guest-app/src/pages/BookingPage.tsx`, `guest-app/src/pages/BookingConfirmPage.tsx`, `guest-app/src/pages/CorporateBookingPage.tsx` |

## Edge cases

- **Pre-SR reservations** (no new fields stored) — the drawer hides the guest block entirely; the staff `BookingSpecialRequestsEditor` stays. The calendar amber dot still triggers on the staff `specialRequests` text. The guest preferences lookup by `value` on a legacy reservation with no new fields returns empty defaults.
- **Multi-room booking** — the per-room `bedSetup` is preserved on each child booking. A 3-rider room booking picks two distinct bed set-ups (Twin + Double) → both surfaces in the drawer.
- **Admin deletes a bed-set-up option that was used by an existing reservation** — the booking's `Booking.bedSetup` still carries the old `value` (the snapshot is immutable). The drawer renders the value as-is; the catalog lookup falls back to `option?.label ?? booking.bedSetup` so the raw key is shown when no catalog match exists.
- **Admin deletes a preference that was selected on an existing reservation** — the reservation's `additionalPreferences` is the immutable snapshot. The drawer chips render via the same `option?.label ?? key` fallback.
- **Hotel-config `checkInTime` is empty** — the dropdown defaults to "2:00 PM" (the deploy-time fallback). Both client and server use `parseCheckInTimeToPair("2:00 PM")` so they agree.
- **Step 1 → Step 2 transition** — the new Step 2 fields reset whenever the cart changes (the existing `bedSelections` / `additionalPreferences` / `additionalRequest` / `expectedArrivalTime` state is reset to its defaults on a fresh mount).
- **In-flow hold expires** — the same SR fields are preserved in `state` while the hold is active, same as the existing `guestDetails` state. Re-clicking Step 2 after a hold expiry restores them from a `useEffect` keyed on the cart.

## Out of scope

- **Per-preference surcharges** — `surchargeNote` is informational only. A future per-preference price tag (e.g. "baby cot + ₱500/night") would need its own wire field + booking total update + admin price calculator. Logged for a future feature (probably `SPECIAL-REQUESTS-2`).
- **Admin editing of guest SR fields** — guest-set fields are immutable on the booking doc (the snapshot is the legal record). Staff follow-up edits go into the existing `Booking.specialRequests` staff-captured field.
- **Multi-language preference labels** — the seed English labels match the existing tone. A future `i18n` feature (Folia? See `plan/features/STORE-GUEST.md` for a similar precedent) would localize the rest of the booking form too.
- **24h arrival window per-hotel admin override** — the `ARRIVAL_WINDOW_HOURS = 24` is a hardcoded constant per owner decision 2026-11-12.

## Verified

- `npx tsc --noEmit` in `admin-app/` + `guest-app/` clean.
- The existing `feat/special-requests-redirect` redirect card is retired on `BookingPage.tsx` + `BookingConfirmPage.tsx` (no more "Forgot something?" prompt). The corporate flow had no redirect card to retire; the legacy `Special requests` textarea is replaced by the `SpecialRequestsBlock`.
- The `BookingSpecialRequestsEditor` (staff-captured) is unchanged — post-booking follow-ups from email / phone still have a home.
- The booking drawer's `<GuestSpecialRequestsBlock />` hidden when the reservation has none of the new fields, so pre-SR legacy reservations render without a silent empty card.