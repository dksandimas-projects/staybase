# Admin App Features & Functionality Audit — 2026-07-07
> **📁 HISTORICAL AUDIT — non-canonical, do not load during normal implementation tasks.** Findings were triaged into `plan/project/ROADMAP.md`; anything still open is tracked there, everything closed is recorded in `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md`. Canonical specs may have evolved since this audit ran.

> Full wiring audit of every admin-app page and the shared `AdminContext`
> against the feature specs. Read-only at audit time — no fixes applied.
> Successor scope to `plan/project/AUDIT-BOOKING-INTERCOM-2026-07-06.md`
> (which covered the intercom inbox + call flow in depth; those areas were
> only spot-rechecked here and remain healthy).
>
> Workspace: staybase
> Audited: 2026-07-07 (branch `dev`, HEAD `4c43cfa`)
> Method: read-only — read the full admin read bundle
> (`plan/admin-app/CLAUDE.md`, `plan/features/{AUTH-ROLES, DASHBOARD-OVERVIEW,
> BOOKINGS-MANAGEMENT, ROOM-MANAGEMENT, RATE-MANAGEMENT, VOUCHERS,
> CORPORATE-INQUIRIES, REPORTS, QR-MANAGEMENT, SETTINGS, SPARK-REWARDS,
> STORE-MANAGEMENT, ADMIN-MOBILE}.md`, `plan/docs/{BACKEND,GOTCHAS}.md`);
> traced every code path in `admin-app/src/pages/*.tsx`,
> `admin-app/src/context/AdminContext.tsx`, `admin-app/src/components/
> {AdminLayout,Sidebar}.tsx`; cross-checked `firebase/firestore.rules`,
> `guest-app/server/apiRouter.ts`, `guest-app/server/handlers/
> {bookings,admin}.ts`, `shared/utils/dates.ts`, `hotel.config.ts`.
> Baseline: typecheck clean, 34 test files / 580 tests green on `dev`
> @ `4c43cfa` — none of the findings below are covered by existing tests.
>
> **Convention:** findings are numbered `AA-<n>` (Admin App). Severity
> matches prior audits (`SEV-1` critical → `SEV-4` nit / doc drift).
> Status is `Open` until a commit references the fix in this doc.

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 3 | **3** |
| **SEV-2 (major)** | 0 | 6 | **6** |
| **SEV-3 (minor)** | 0 | 12 | **12** |
| **SEV-4 (nit / doc drift)** | 0 | 11 | **11** |
| **Total** | **0** | **32** | **32** |

> **Fix update — 2026-07-07:** The three SEV-1 findings were fixed in
> `9627f8a` (`fix: address critical admin audit bugs`), merged to `dev`
> in `e79cc9d` (`fix: merge critical admin audit fixes`), with the
> post-merge version recorded in `e79d82d` (`v0.119.12`). Regression
> coverage was added in
> `admin-app/src/__tests__/audit-admin-critical-2026-07-07.test.ts`.
> The original audit narrative below is retained for context; SEV-1
> findings AA-01, AA-02, and AA-03 are now fixed. Cross-referenced
> non-SEV-1 follow-ups such as AA-19 remain open until their own status
> entries are updated.
>
> **Fix update — 2026-07-07:** The six SEV-2 findings were fixed on
> `fix/audit-aa-sev2`: guest ID and store item uploads now use Storage
> URLs, Rates form hydration tracks dirty fields before re-syncing live
> settings, corporate-code creation is transactional/unique and available
> to staff, corporate inquiry conversion persists the generated access
> code with dynamic room-type rates, and the Dashboard now exposes pending
> payments, arrivals, departures, and recent bookings. Regression coverage
> was added in
> `admin-app/src/__tests__/audit-admin-sev2-2026-07-07.test.ts`.
>
> **Fix update — 2026-07-07:** The twelve SEV-3 findings were fixed on
> `fix/audit-aa-sev3`: restricted route normalization, mobile sign-out,
> hotel-local booking dates, full backup export, report print/PDF action,
> room edit/delete safeguards, room-type delete guard, voucher/corporate
> create integrity, `payment-confirmed` flow, rewards redemption, white-
> label chart/PDF colors, settings snapshot merge safety, API URL fallback,
> dashboard metric cleanup, weekend labels, identity literals, and auth-
> gated listeners. Regression coverage was added in
> `admin-app/src/__tests__/audit-admin-sev3-2026-07-07.test.ts`.
>
> **Fix update — 2026-07-07:** The eleven SEV-4 findings were fixed on
> `fix/audit-aa-sev4`: breakfast-selection docs/rules now match the
> booking-map implementation, corporate inquiry notes/status/code issuance
> were corrected, already-closed dashboard/rate/identity/listener drift was
> verified, PDF generation now registers bundled brand fonts and uses stored
> discount totals, Dashboard/Rooms/Rates/Settings render first-load
> skeletons, and admin docs were synced to the actual components and
> admin-only voucher/settings surfaces. Regression coverage was added in
> `admin-app/src/__tests__/audit-admin-sev4-2026-07-07.test.ts`.

The admin shell (auth, routing, responsive layout, focus traps, toasts,
DataTable), the QR management page, the intercom inbox, store order
processing, room create/delete with cascade, payment-methods CRUD, and the
walk-in/cancel/checkout/add-payment server integrations are all in good
shape. The critical problems cluster in three places:

1. **Spark Rewards member management is decorative.** Points adjustments
   and account suspension only mutate local React state — nothing is
   written to Firestore or Firebase Auth, but staff sees a success toast
   (AA-01). The redemption panel specced for the booking drawer was never
   built even though the server endpoints exist (AA-19).
2. **Payment verification is blind and silent.** The booking drawer never
   shows the guest's uploaded payment proof and the store-order drawer
   renders a hardcoded "Mock receipt confirmation verified" placeholder
   (AA-03) — and when staff does confirm, the existing
   `/api/bookings/confirm` endpoint (which sends the guest's
   booking-confirmed email) is bypassed by a raw `updateDoc`, so guests
   are never notified (AA-02).
3. **Two data-integrity time bombs.** Base64 images are stored inside
   Firestore documents (guest IDs on bookings, product photos on publicly
   readable `storeItems`) instead of Storage (AA-04, AA-05), and the Rates
   page seeds its form from deploy-time defaults and never re-syncs, so
   Save can silently overwrite live configured rates (AA-06).

### Top 5 to fix first

| # | ID | Why | File:line | Status |
|---|---|---|---|---|
| 1 | **AA-01** | Member points adjustments + suspensions vanish on refresh; success toast lies to staff | `admin-app/src/context/AdminContext.tsx:1368-1394`, `admin-app/src/pages/MembersPage.tsx:33-72` | Fixed in `9627f8a` |
| 2 | **AA-02** | Staff confirmation never sends the guest a booking-confirmed email — the server endpoint exists and is never called | `admin-app/src/context/AdminContext.tsx:939-957`, `guest-app/server/handlers/bookings.ts:1593` | Fixed in `9627f8a` |
| 3 | **AA-03** | Payment proofs are unviewable (booking drawer) or faked ("Mock receipt confirmation verified" panel) — staff verifies real money blind | `admin-app/src/pages/BookingsPage.tsx:2219-2228` (mock), drawer (missing proof section) | Fixed in `9627f8a` |
| 4 | **AA-06** | Rates page displays stale default rates and Save writes them over live rates | `admin-app/src/pages/RatesPage.tsx:67-115` | Fixed on `fix/audit-aa-sev2` |
| 5 | **AA-07** | Inquiry-generated corporate codes write the rate map key `executivo` (typo) — negotiated executive rates never apply; and non-admin staff get a success toast on a write Firestore rejects | `admin-app/src/pages/CorporateInquiriesPage.tsx:85-114` | Fixed on `fix/audit-aa-sev2` |

---

## SEV-1 — Critical (3)

### AA-01 — Member points adjustment and suspend/activate are local-state mocks
**Status:** Fixed in `9627f8a` (merged to `dev` in `e79cc9d`)
**File:** `admin-app/src/context/AdminContext.tsx:1368-1394` (`updateMemberPoints`, `toggleMemberActive`), `admin-app/src/pages/MembersPage.tsx:33-72`

`updateMemberPoints` and `toggleMemberActive` only call `setMembers(...)` —
no `updateDoc` on `members/{uid}`, no `addDoc` to
`members/{uid}/pointsHistory`, no API call. `MembersPage` then shows
"Points balance updated" / flips the Suspend badge. The next `onSnapshot`
tick (or a refresh) silently reverts everything: the member's real balance
is untouched, and a "suspended" member can still sign in because Firebase
Auth `disableUser` is never invoked. Firestore rules already permit the
staff write (`members` update: `isStaff()`), and the spec
(`SPARK-REWARDS.md §Admin`) requires the `updateDoc` + `pointsHistory`
audit entry + an Admin SDK disable via API route.

Related: the drawer's "Transaction History Ledger" reads
`data.pointsHistory` as an **array field on the member doc**, but the real
history lives in the `members/{uid}/pointsHistory` **subcollection**
(`BACKEND.md`, `plan/admin-app/CLAUDE.md`), so genuine history (earn on
checkout, redemptions) never displays either.

**Fix:** persist the adjustment in a transaction (`rewardsPoints` +
`pointsHistory` entry with `{type, points, reason, by: staffUID, at}`),
subscribe to the `pointsHistory` subcollection for the drawer, and route
suspension through a new admin API (`disableUser` + `isActive: false`),
mirroring `/api/admin/disable-staff`.

**Fixed:** `updateMemberPoints` now persists balance changes and
`pointsHistory` entries in a Firestore transaction, `MembersPage` now
subscribes to `members/{uid}/pointsHistory` while the drawer is open, and
member suspension/activation now routes through authenticated
`/api/members/set-active`, which updates both `members/{uid}.isActive`
and Firebase Auth disabled state. Success toasts are only shown after the
write/API call succeeds.

### AA-02 — Booking confirmation bypasses `/api/bookings/confirm` — guest never emailed
**Status:** Fixed in `9627f8a` (merged to `dev` in `e79cc9d`)
**File:** `admin-app/src/context/AdminContext.tsx:896-962` (`updateBookingStatus`), `admin-app/src/pages/BookingsPage.tsx:2070-2077`; server: `guest-app/server/apiRouter.ts:460-471`, `guest-app/server/handlers/bookings.ts:1593-1660`

`updateBookingStatus` routes `cancelled` and `checked-out` through the
server APIs (correct), but `confirmed` — the transition staff performs
after verifying a GCash/Maya payment screenshot, i.e. the **main online
booking flow** — is a raw client `updateDoc`. The server already exposes
`POST /api/bookings/confirm` (`handleConfirmBooking`), which sends the
guest the `booking-confirmed` email with dedup handling. It is never
called from anywhere in the admin app, so no staff-confirmed booking ever
produces a confirmation email, violating `BOOKINGS-MANAGEMENT.md`
("`confirmed` and `payment-confirmed` status changes trigger corresponding
emails") and `EMAIL-PDF-STORAGE.md`. The `payment-confirmed` intermediate
state is entirely unreachable from the UI (see AA-18).

**Fix:** call `/api/bookings/confirm` for the confirmed transition (same
token/base-URL pattern as cancel/checkout) and surface its error in the
drawer.

**Fixed:** the `confirmed` transition in `updateBookingStatus` now calls
`POST /api/bookings/confirm` with the staff ID token, so the existing
server-side status validation and booking-confirmed email dedup logic
run for staff confirmations.

### AA-03 — Payment proofs unviewable in booking drawer; store drawer shows a fake "verified" receipt
**Status:** Fixed in `9627f8a` (merged to `dev` in `e79cc9d`)
**File:** `admin-app/src/pages/BookingsPage.tsx` (drawer, `paymentProofUrl` never rendered), `:2219-2228` (store GCash mock)

The booking detail drawer renders guest info, registration, discounts,
payments ledger, and folio — but **never** `booking.paymentProofUrl`. For
a `payment-uploaded` booking the entire point of the staff action is to
look at the uploaded screenshot before confirming; the drawer gives staff
nothing to look at (the field is hydrated in `AdminContext` and unused).
Worse, the store-order drawer's "GCash Proof of Remittance" section is a
hardcoded placeholder box labeled "RECEIPT SCREENSHOT" with the caption
"Mock receipt confirmation verified" — `order.paymentProofUrl` (a real
Storage URL uploaded by the guest, required server-side for online store
payments) is never displayed. Staff either confirms unverified payments or
falsely believes something was verified.

**Fix:** render `paymentProofUrl` (thumbnail + open-in-new-tab, same
pattern as the discount-ID image) in both drawers for
`payment-uploaded`/pending bookings and for online-paid store orders;
delete the mock panel.

**Fixed:** the booking drawer now renders `booking.paymentProofUrl` as a
thumbnail with an open-full-size link, and the store-order drawer now
renders `order.paymentProofUrl` for GCash orders. The hardcoded
"RECEIPT SCREENSHOT" / "Mock receipt confirmation verified" panel was
removed.

---

## SEV-2 — Major (6)

### AA-04 — Guest ID photos stored as base64 data URLs inside the booking document
**Status:** Fixed on `fix/audit-aa-sev2`
**File:** `admin-app/src/pages/BookingsPage.tsx:1174-1185` (`handleGuestIdUpload`)

The guest-ID upload compresses to 1400×1400 q0.84 and then writes
`image.dataUrl` straight into `bookings/{id}.guestIdPhotoUrl`. GOTCHAS is
explicit: "Never store raw file blobs in Firestore — 1MB document size
limit"; the spec requires Storage at `bookings/{bookingId}/guest-id/…` with
a staff-only read rule. Consequences: a large ID photo can push the doc
past 1MB and make the write (and all later updates) fail; every admin
session's `bookings` collection listener re-downloads every embedded ID
image on every snapshot; the registration PDF then re-fetches the data URL.

**Fix:** upload via `uploadBytes` to `bookings/{bookingId}/guest-id/`
(staff-read Storage rule already exists for booking paths), store the
download URL.

**Fixed:** `handleGuestIdUpload` now compresses the selected ID image,
uploads it to `bookings/{bookingId}/guest-id/{timestamp}-{filename}` in
Firebase Storage, stores only the download URL on the booking, and keeps
the booking drawer deep-linkable via `?bookingId=`.

### AA-05 — Store item photos stored as base64 in publicly readable `storeItems` docs
**Status:** Fixed on `fix/audit-aa-sev2`
**File:** `admin-app/src/pages/SettingsPage.tsx:1473-1515` (`handleStorePhotoUpload` → `imageUrl: storeItemPhotoDataUrl`)

Same class as AA-04 but worse exposure: `storeItems` has
`allow read: if true` and is subscribed by every guest opening the
intercom Shop tab, so megabyte-scale base64 blobs ship to every guest on
every catalog snapshot. `STORE-MANAGEMENT.md` specifies compression +
Storage at `store-items/{itemId}/{filename}`.

**Fix:** upload the compressed file to Storage, store the URL; one-off
migration for existing data-URL items.

**Fixed:** store item create/update now passes the compressed `File` to
`AdminContext`, uploads it under `store-items/{itemId}/...`, and writes a
Storage URL to Firestore. `AdminContext` also migrates existing
`data:image/...` catalog photos to Storage once they appear in the admin
snapshot.

### AA-06 — Rates page form seeded from defaults and never re-synced — Save can clobber live rates
**Status:** Fixed on `fix/audit-aa-sev2`
**File:** `admin-app/src/pages/RatesPage.tsx:67-115` (`prices`, `roomRates`, `bfRate` seeding + sync effect)

`prices` / `roomRates` are seeded in `useState` initializers from whatever
`roomTypes` holds at mount — on first paint that is `DEFAULT_ROOM_TYPES`
(deploy-time defaults), because the Firestore `settings/hotelConfig`
snapshot has not arrived yet. The sync effect only fills **missing** keys
(`if (!updated[t.value])`), so when the real rates arrive the form still
shows the defaults. `bfRate` has no sync effect at all. The admin therefore
(a) sees wrong rates on `/rates`, and (b) clicking "Save Rates Matrix" or
"Update Breakfast Rate" persists the stale defaults over the hotel's real
configured rates — a silent, hard-to-notice revenue bug.

**Fix:** re-sync existing keys from the snapshot while the field is not
dirty (track a `dirty` set, or key the form state off a
`hotelConfigLoaded` gate and hydrate once real data arrives).

**Fixed:** Rates now builds its local form buffers from live `roomTypes`
and `breakfastConfig` snapshots, tracks dirty room-rate/corporate-rate/
breakfast fields, and only preserves local edits while re-syncing all
clean fields from Firestore. Saving clears the dirty markers after the
write succeeds.

### AA-07 — Inquiry code generation: `executivo` typo, hardcoded type keys, unpersisted `accessCodeId`, false success for non-admins
**Status:** Fixed on `fix/audit-aa-sev2`
**File:** `admin-app/src/pages/CorporateInquiriesPage.tsx:85-114` (`handleGenerateCode`), `admin-app/src/context/AdminContext.tsx:1174-1184` (`addCorporateCode`)

Four defects in one flow:
1. The rate map is written as `{ "standard-double": …, executivo: … }` —
   the key for executive rooms is misspelled, so the negotiated executive
   rate is never found and the server falls back to the public
   `corporateRate`. Companies get quoted one price and charged another.
2. Only two hardcoded type keys exist at all (white-label hard rule:
   never hardcode room type strings) — any other type gets no negotiated
   rate. Default seeds `2880`/`4050` are also hardcoded.
3. Spec requires `corporateInquiries/{id}.accessCodeId` to be updated —
   only local drawer state is set; after reopening the drawer the code
   association is gone.
4. `/corporate` is a Front-Desk page but `corporateCodes` writes are
   `isAdmin()` in Firestore rules. `addCorporateCode` swallows the
   permission error (console only) while the page unconditionally toasts
   "Corporate code issued … now active" and flips the inquiry to
   converted — a front-desk user is guaranteed a false success.

**Fix:** build the rate inputs dynamically from `roomTypes` (one input per
type), await + propagate the write result before toasting/converting,
persist `accessCodeId`, and either relax the rule to `isStaff()` or hide
generation from front desk (pick per spec — `CORPORATE-INQUIRIES.md`
implies front desk can generate).

**Fixed:** inquiry code generation now renders one negotiated-rate input
per configured room type, writes `ratePerRoomType` using those dynamic
type keys, awaits `addCorporateCode`, persists
`corporateInquiries/{id}.accessCodeId`, and only converts/toasts after
the write succeeds. Firestore rules now allow staff/admin writes to
`corporateCodes`.

### AA-08 — Corporate code create/overwrite without uniqueness check
**Status:** Fixed on `fix/audit-aa-sev2`
**File:** `admin-app/src/context/AdminContext.tsx:1174-1184`, callers `RatesPage.tsx:155-180`, `CorporateInquiriesPage.tsx:85-114`

`addCorporateCode` is a blind `setDoc(doc(db, "corporateCodes", code))`.
Re-using an existing code (easy: the inquiry page pre-fills
`{COMPANY-PREFIX}100`) silently **overwrites** another company's document —
its negotiated `ratePerRoomType`, `usageCount`, `linkedInquiryId` are all
destroyed, and `usageCount` resets to 0 (defeats caps). Spec: "Code must
be unique — check if document exists before creating; duplicate code
conflict — show error, suggest a different code." The vouchers path has
the same gap (see AA-17) but with `addDoc` the blast radius is duplicate
codes rather than overwritten ones.

**Fix:** check existence (transaction or `getDoc`) and reject with a
distinct error the UI can display.

**Fixed:** `addCorporateCode` now uses a Firestore transaction against
`corporateCodes/{code}`, rejects duplicates with a distinct error, and
returns a `{success, error}` result that Rates and Corporate Inquiries
surface before closing or converting.

### AA-09 — Dashboard is missing its operational core (pending-payment alerts, arrivals/departures, recent bookings)
**Status:** Fixed on `fix/audit-aa-sev2`
**File:** `admin-app/src/pages/DashboardPage.tsx` (whole page vs `DASHBOARD-OVERVIEW.md`)

The dashboard ships the room grid + housekeeping toggle + a weekly chart,
but none of the specced operational sections exist: no **pending payment
alerts** (list of `payment-uploaded` bookings with a Confirm Payment CTA —
the primary "guest paid, act now" signal; combined with AA-03 there is no
surface anywhere that pushes staff to verify payments), no today's
check-ins list, no today's check-outs list, no recent-bookings table, and
the stat cards deviate from spec (no Revenue, no Pending Payments count).
The "+8% from last week" trend on the occupancy card is a hardcoded
fabrication. The bottom tab bar covers arrivals/departures on **mobile
only**; desktop staff have no equivalent.

**Fix:** add the pending-payments section (with proof thumbnail per AA-03
and confirm via AA-02's endpoint), arrivals/departures lists, and a real
(or no) trend value.

**Fixed:** Dashboard now shows pending payment alerts with proof links and
a Confirm Payment CTA, today's arrivals, today's departures, recent
bookings, real monthly revenue and pending-payment stats, and no longer
shows the fabricated "+8% from last week" trend.

---

## SEV-3 — Minor (12)

### AA-10 — Restricted-route overlay bypassed by trailing slash / casing; UI-only guard
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/components/AdminLayout.tsx:52-54`

`restrictedPaths.includes(location.pathname)` is an exact string match.
React Router matches `/settings/` and `/Settings` to the same route
(trailing slash tolerated, `caseSensitive` defaults false), but neither
string is in the array, so a front-desk user who types `/settings/` gets
the full Settings UI instead of the access-denied state. Firestore rules
(`settings` write `isAdmin()`) stop actual damage, so this is an exposure
+ confusing-error problem, not privilege escalation. Normalize the
pathname (strip trailing slash, lowercase) before checking.

### AA-11 — No sign-out on mobile
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/components/AdminLayout.tsx:111-119`

The mobile header's account button (`aria-label="Account and sign out"`)
has no `onClick` — it does nothing. Sign Out only renders on tablet+, and
the sidebar drawer has no sign-out entry, so on a phone there is no way to
sign out at all. Session persistence is `browserSessionPersistence`
(closing the tab ends it), which softens but does not excuse this on
shared front-desk devices.

### AA-12 — "Today" computed in UTC, not the hotel timezone
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/BookingsPage.tsx:245` (`today`), `:116-121` (walk-in default dates)

`new Date().toISOString().split("T")[0]` is the UTC date. The hotel runs
at UTC+8, so between midnight and 08:00 local the Arrivals/Departures
filters show **yesterday's** movements and the walk-in modal defaults to
yesterday's check-in date. `DashboardPage` already has a correct
`config.timezone`-aware day-key helper — reuse it (move to
`shared/utils/dates.ts`).

### AA-13 — Full Backup export is a 2-sheet stub of the 8-sheet spec
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/ReportsPage.tsx:347-381` (`handleExportFullBackup`)

Spec (`REPORTS.md §Data Backup`) requires 8 sheets (Bookings with ~33
columns, Payments, Members, Store Orders, Store Catalog, Breakfast
Selections, Vouchers, Corporate Inquiries), a confirmation prompt, a
loading state, Yes/No booleans, and the `spark-inn-full-backup-…`
filename. Shipped: 2 sheets (Bookings with 11 columns, StoreOrders with
6), no members (despite `members` being available in context), no
confirmation, no loading state. This is a client-requested feature —
either build it out or re-scope the spec.

### AA-14 — Reports ignore the configured low-stock threshold; no PDF exports
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/ReportsPage.tsx:266-271` (hardcoded `stock <= 5`)

The low-stock alert hardcodes 5 while Settings → Store persists an
admin-editable `storeConfig.lowStockThreshold` (context default 3) —
`SettingsPage` itself uses the configured value for its stock pills, so
the two surfaces disagree. Separately, all specced PDF outputs are missing:
Performance "Export PDF", the branded Sales Report PDF (jsPDF +
html2canvas), and the kitchen-prep print view.

### AA-15 — Room editing far thinner than spec; no way to deactivate a room after creation
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/RoomsPage.tsx:298-390` (edit drawer)

The edit drawer only edits `status` (plus the date-range block form). Per
`ROOM-MANAGEMENT.md` it should edit name, type, remarks, and expose the
**active/inactive toggle** — `isActive` is settable only at creation, so
staff cannot hide a live room from the guest site without deleting it.
Also: selecting status "Blocked" in the dropdown saves without a required
`blockReason` (spec: do not allow save without it; harmless for
availability because the server treats a blocked room with no window as
fully blocked, but the grid shows a blocked room with no reason), and the
required delete "reason for the audit log" is only interpolated into a
toast — never persisted anywhere.

### AA-16 — Room type delete has no in-use guard
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/SettingsPage.tsx:3136-3155`, `admin-app/src/context/AdminContext.tsx:2811-2824` (`deleteRoomType`)

Two-click confirm, then the type is removed even when live rooms still
reference it. Orphaned rooms render "Untyped" with `₱0` base rate, no
capacity, no bed definition — and the guest site loses the card content
for those rooms. Mirror the room-delete pattern: block deletion while
`rooms.some(r => r.type === value)` and show the count.

### AA-17 — Voucher/corporate creation gaps: duplicate codes, hardcoded expiry, hardcoded `createdBy`
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/RatesPage.tsx:131-180`, `admin-app/src/context/AdminContext.tsx:1079-1124`

(a) Voucher creation never checks for an existing code (spec: "show error
'Code already exists'") — duplicates make server-side code-field fallback
lookups ambiguous. (b) The corporate-code modal hardcodes
`expiresAt: "2027-12-31"` with no expiry or usage-cap inputs (spec has
both). (c) Both flows write `createdBy: "admin"` instead of the actual
staff UID — the audit trail is fiction. (d) Voucher `expiresAt` is stored
as a date string while the admin table renders it raw; cosmetic but
inconsistent with Timestamp-based fields elsewhere.

### AA-18 — Booking status model drift: `payment-confirmed` unreachable, `pending → confirmed` skips the payment flow
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/BookingsPage.tsx:2068-2105` (transition buttons), `:1403-1415` (filter options)

The drawer offers `pending|payment-uploaded → confirmed` in one jump —
the specced `payment-uploaded → payment-confirmed → confirmed` chain (and
its dedicated email) cannot be exercised, and the status filter dropdown
omits `payment-confirmed` entirely. Either collapse the model in
`BACKEND.md`/`BOOKINGS-MANAGEMENT.md` (and remove the dead status) or add
the intermediate transition. Also missing vs spec: date-range / source /
room-type filters, sort controls, and table pagination (every booking
renders on one page — degrades as history grows).

### AA-19 — Points Redemption panel unbuilt though server endpoints exist
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/BookingsPage.tsx` (drawer — no member/redemption UI); server: `guest-app/server/apiRouter.ts:688-706`

`BOOKINGS-MANAGEMENT.md` specs a full "Spark Rewards — Points Redemption"
drawer panel (member info row, redeem form with live ₱ preview, one
redemption per booking, admin-only undo). `POST /api/members/redeem-points`
and `/api/members/undo-redemption` are implemented and routed — nothing in
the admin app calls them, and the drawer doesn't even indicate that a
booking belongs to a member (`memberId` unused). Members currently have no
way to spend points. Same page also omits the specced staff notes editor,
"Email receipt" action, and the RA 11862 unaccompanied-minor banner.

### AA-20 — White-label violations: hardcoded hex in every chart, brand RGB in PDFs, hardcoded city copy, hardcoded type keys
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/pages/DashboardPage.tsx:196-210`, `admin-app/src/pages/ReportsPage.tsx:694-923` (+ more), `admin-app/src/pages/BookingsPage.tsx:527,712,742,862,1013` (jsPDF `setDrawColor(241,101,34)` etc.), `admin-app/src/pages/RatesPage.tsx:279,357`

Recharts fills/strokes hardcode `#EA8A1A`, `#111827`, `#3B82F6`,
`#10B981` even though a `chartColors` array built from `config.colors`
exists in the same file; the jsPDF receipts hardcode the brand orange as
RGB literals; DashboardPage ships "Tagbilaran City" benchmark copy and a
75%-target paragraph as static text; RatesPage renders corporate rate
columns only for the hardcoded `standard-double` / `executive` keys
(other types' rates invisible). All violate the "never hardcode hex /
brand-specific copy / room type strings" hard rules and will ship wrong
for every other hotel client. (`AdminContext`'s seeded
`facebookUrl: "https://facebook.com/spark inn"` default is the same class.)

### AA-21 — Settings snapshots replace state wholesale; room-type save fails on missing doc
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/context/AdminContext.tsx:2212-2246` (settings listener), `:2745-2755` (`saveRoomTypes`)

`setHotelConfig(data as typeof hotelConfig)` (and rewards/breakfast/store
equivalents) replace the seeded state with the raw doc — a partial doc
(fresh deploy, manual edit) drops keys like `intercomQuickRequests` or
`roomTypes` that consumers dereference; only `websiteContent` gets the
defensive `mergeWebsiteContent` treatment. And `saveRoomTypes` uses
`updateDoc`, which throws if `settings/hotelConfig` doesn't exist yet
(everything else uses merged `setDoc`) — on a fresh project, room type
edits fail with only a console error.

### AA-22 — API base URL fallback inconsistent across the six server-call sites
**Status:** Fixed on `fix/audit-aa-sev3`
**File:** `admin-app/src/context/AdminContext.tsx:902-904, 923-925, 967-969, 997-999, 1097-1099, 1289-1291` vs `:3046-3053` (`getApiBaseUrl`)

`getApiBaseUrl()` correctly falls back to `https://www.${config.domain}`
when `VITE_GUEST_APP_URL` is unset, but five earlier inline copies (cancel,
checkout, add-payment, walk-in, voucher-email, convert-inquiry) and
`BookingsPage`'s reject-discount/folio-preview fall back to `""` — which
resolves relative to the **admin** origin where no `/api` exists. If the
admin deployment ever misses that env var, cancellation/checkout/walk-in
all 404 while staff creation keeps working — a confusing partial outage.
Use `getApiBaseUrl()` everywhere.

---

## SEV-4 — Nits & doc drift (11)

### AA-23 — Breakfast selections stored on the booking doc, not the `breakfastSelections` collection
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/pages/BookingsPage.tsx:1205-1212`; docs `plan/docs/BACKEND.md §breakfastSelections`, `plan/admin-app/CLAUDE.md` (Firebase usage table)

The drawer writes a `breakfastSelections` map onto `bookings/{id}` and the
kitchen-prep report reads the same map — internally consistent, so the
feature works, but `BACKEND.md`, the Firestore rules, and the admin
CLAUDE table all describe a dedicated collection with `enteredBy` audit
fields that nothing uses. Pick one model and update docs/rules (the
Reports "Breakfast Selections" backup sheet spec also assumes the
collection).

### AA-24 — Inquiry notes: read-modify-write race, oldest-first ordering, author drift
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/context/AdminContext.tsx:1254-1267`, `admin-app/src/pages/CorporateInquiriesPage.tsx:63-83, 460`

`addInquiryNote` rebuilds `notes` from context state and overwrites the
array — two staff adding notes concurrently lose one (use `arrayUnion`).
The log renders oldest-first (spec: newest first). The optimistic local
entry uses `by: "admin-staff"` while the real write uses the email —
brief author flicker; spec asks for staff name.

### AA-25 — Inquiry status updates skip `updatedAt`; code generation allowed at any stage and force-converts
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/context/AdminContext.tsx:1246-1252`, `admin-app/src/pages/CorporateInquiriesPage.tsx:372, 105-111`

Spec: stage move writes `status` + `updatedAt` (only `status` is written);
Generate Access Code should appear at Negotiating/Converted only (it shows
for every non-converted stage, including Declined) and generation itself
should not flip the pipeline to converted.

### AA-26 — Dashboard metrics fudge: pending bookings count as occupancy; "Checked In Today" is all in-house; in-progress shows as "Clean"
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/pages/DashboardPage.tsx:21-69, 156-177`

The weekly occupancy chart counts any non-cancelled booking (including
`pending` bot/abandoned ones) as an occupied night; the "Checked In Today"
card counts every currently checked-in guest regardless of check-in date;
and the housekeeping button renders only Clean/Dirty — a room mid-cycle in
`in-progress` displays as green "Clean", misleading housekeeping (the
cycle itself is correct per decision #88; the button just hides the third
state).

### AA-27 — Weekend rate mislabeled "Fri/Sat" — server charges Sat/Sun nights
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/pages/RatesPage.tsx:408, 457` vs `guest-app/server/handlers/bookings.ts:578, 1090` (`day === 0 || day === 6`)

The rate matrix headers say "Weekend Rate (Fri/Sat)" but the pricing
engine applies the weekend rate to Saturday and Sunday nights
(`RATE-MANAGEMENT.md` agrees with the engine). An admin pricing "Friday
peak" is configuring the wrong nights. Relabel (and consider whether the
hotel actually wants Fri/Sat — if so the engine and spec change together).

### AA-28 — Identity literals: staff email as intercom `guestName`, `walkin@guest.com`, `handledBy: "frontdesk-staff"`
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/context/AdminContext.tsx:1496`, `admin-app/src/pages/BookingsPage.tsx:1250, 1295`

Front-desk intercom replies store the staff member's email in the
world-readable `intercoms/**` collection (use a display label); walk-ins
without an email default to the fake-but-real domain `walkin@guest.com`
(confirmation emails bounce to guest.com's owner — use an obviously
internal sentinel or skip the email); walk-in `handledBy` is the literal
`"frontdesk-staff"` instead of the staff UID the spec requires (the server
overwrites it from the verified token, so this is dead-but-misleading
client code).

### AA-29 — `corporateCodes` / intercom / calls listeners run before sign-in
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/context/AdminContext.tsx:1141-1172, 1407-1431, 1565-1618`

Most listeners gate on `currentUser`, but these three have `[]` /
`[rooms]` deps. `intercoms`/`calls` are world-readable so they merely
churn on the login screen, but `corporateCodes` is staff-only-read since
BI-08 — every logged-out visit to `/login` fires a permission-denied
console error, and the subscriptions don't detach on sign-out. Gate all
three on `currentUser` for consistency.

### AA-30 — Receipt/registration PDFs: default fonts, client-recomputed discount math
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/pages/BookingsPage.tsx:503-836 (registration), 838-1135 (receipt)`

GOTCHAS/`EMAIL-PDF-STORAGE.md` require Apollo + Inter embedded as base64
in jsPDF output — both PDFs use default Helvetica (brand drift, and the
₱ glyph renders only because `formatPrice` output is being normalized).
The receipt's "Pricing Breakdown" recomputes the senior/PWD discount as
`subtotal × pct` client-side, which can disagree with the server's
authoritative stacking order (senior/PWD → voucher → member, decision
#13b) — display lines may not sum to the stored `totalPrice`. Derive the
breakdown from stored fields (`originalTotalPrice`, `voucherDiscount`,
`pointsRedeemedValue`) instead.

### AA-31 — Loading skeletons missing on Dashboard, Rooms, Rates, and Settings tabs
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/pages/{DashboardPage,RoomsPage,RatesPage,SettingsPage}.tsx`

The UX checklist in every feature MD requires skeletons; `DataTable`
provides them for table pages, but the dashboard grid, rooms card grid,
rates form, and settings tabs render empty/default content until the first
snapshot arrives (which is also what makes AA-06 dangerous).

### AA-32 — Doc drift: `plan/admin-app/CLAUDE.md` component/collection table vs reality
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `plan/admin-app/CLAUDE.md`

Accumulated drift worth one sync pass: Sidebar is described as "role-aware
nav links" (it renders all links for all roles — which `AUTH-ROLES.md`
actually prescribes; align the two docs), the Firebase-usage table lists
`members/{uid}/pointsHistory` and `breakfastSelections` subscriptions that
don't exist (AA-01/AA-23), lists `BookingTable.tsx`/`RoomForm.tsx`/
`OccupancyChart.tsx` components that were never built (their roles are
filled by `DataTable`/inline forms), and `VOUCHERS.md`/`SETTINGS.md` place
voucher management "within Settings" with front-desk access while it lives
on the admin-only Rates page (see AA-33).

### AA-33 — Role-surface drift: front desk locked out of vouchers, breakfast menu, and store catalog
**Status:** Fixed on `fix/audit-aa-sev4`
**File:** `admin-app/src/components/AdminLayout.tsx:52` (restricted paths), `admin-app/src/pages/RatesPage.tsx` (vouchers location)

Specs grant Front Desk: voucher management (`VOUCHERS.md` "Both Admin and
Front Desk"), silog menu management (`SETTINGS.md §10`), and the Store tab
(`SETTINGS.md §11`, `STORE-MANAGEMENT.md` "Accessible to both roles" for
catalog). All three live on admin-only pages (`/rates`, `/settings`), so
front desk cannot perform specced duties even though Firestore rules
(`vouchers`, `storeItems` write `isStaff()`) already permit them. Decide:
move the surfaces / open the tabs to front desk, or update the specs to
admin-only.

---

## What was verified as correctly wired

- **Auth shell:** login with friendly error mapping, forgot-password view,
  session persistence (`browserSessionPersistence`), `onAuthStateChanged`
  with role from custom claims and least-privilege `front-desk` fallback,
  redirect-to-origin after login, access-denied state for role-restricted
  routes (modulo AA-10), sign-out on tablet+/desktop.
- **Responsive layout (Phase 11.7):** three-mode sidebar with focus trap,
  body scroll lock, route-change auto-close; sticky header with
  safe-area insets; bottom tab bar with unread alert count; Drawer/Modal
  sheet behavior; `useBreakpoint` used consistently (no raw `matchMedia`
  in pages); no `alert()`/`confirm()`/`prompt()` anywhere; ConfirmForm +
  two-click confirms on destructive actions; 580/580 tests green.
- **Bookings server integrations:** cancel and checkout go through the
  authenticated server APIs (owner/staff auth, emails, room status);
  onsite payments post to `/api/bookings/add-payment` with a live
  payments-subcollection listener, folio math (room + billed store
  charges − payments) and the balance-due checkout guard; walk-in creation
  posts to `/api/bookings/create-walkin` (availability transaction,
  server-side ref + lookupToken, `source: "walk-in"`, immediate check-in
  option, price override); reject-discount posts to the server route with
  reason + email; discount verify writes `discountVerified` +
  `discountVerifiedBy` + `updatedAt` with a two-click confirm.
- **Room lifecycle:** Zod-validated create with duplicate-room-number
  check, admin-gated delete (Firestore rule + UI) with active-booking
  guard and best-effort cascade (Storage photos, intercom thread +
  messages, call doc + ICE); date-range blocks write real
  `blockedFrom/blockedTo` Timestamps; the server treats a blocked room
  with no window as fully blocked, so status-only blocks are safe.
- **Store management:** catalog CRUD with soft-delete, stock
  decrement-on-confirm / restore-on-cancel inside a transaction with
  `stockDecrementedAt`/`stockRestoredAt` guards (per decision #80),
  `INSUFFICIENT_STOCK` abort, add-to-bill folio derivation at read time
  (order docs, not booking mutation), status flow with context-aware
  buttons.
- **Payment methods (Settings §2):** dynamic CRUD with protected-method
  defense-in-depth, booking-reference delete guard, one-time legacy
  migration + protected/store backfills (correctly reading
  `hotelConfig` rather than seeded state), QR upload with PNG-preserving
  compression + 2MB cap + previous-QR cleanup, per-surface pills.
- **Settings:** branding uploads compress per-spec dimensions before
  upload; corporate content backfill is ref-gated, idempotent, and
  correctly skips `heroPhotoUrl`; room type add validates duplicates +
  required bed definition; room-type photo modal enforces
  `MAX_ROOM_TYPE_PHOTOS`; staff creation/disable via authenticated admin
  API with server-side last-admin + self-disable protection; legal
  content (privacy/cancellation/house rules) editable with auto
  "last updated" date; house rules flow into the registration PDF.
- **QR management:** fully config-driven (domain, logos, colors), token
  regeneration with confirmation, 4-up A4 print with popup-blocked
  handling, PNG download; guest-route token fallback semantics match
  `QR-MANAGEMENT.md §Behavior notes`.
- **Reports:** revenue streams (room/breakfast/store) computed per spec
  status sets, combined payment-method breakdown with "Uncollected"
  add-to-bill labeling, top-items chart, sales XLSX with the four specced
  sheets, kitchen-prep aggregation consistent with where selections are
  actually stored.
- **Intercom inbox:** unchanged since the 2026-07-06 audit (all BI-*
  fixes present: `markChatAsRead`, resolve/reopen, notification sound
  gating, second-call-wins, `microphone=(self)` headers).
- **Firestore rules** for admin surfaces are sane: bookings staff-only
  read + no client create, payments append-only, settings admin-write,
  vouchers staff-write, corporateCodes staff-read/write, rooms
  delete admin-only.

---

## Suggested fix batches

| Batch | Findings | Theme | Status |
|---|---|---|---|
| 1 (`fix/admin-critical-audit-2026-07-07`) | AA-01, AA-02, AA-03 | Real member writes, confirm-email endpoint, payment proof visibility | Fixed in `9627f8a`; merged to `dev` in `e79cc9d` |
| 2 (`fix/audit-aa-sev2`) | AA-04, AA-05, AA-06, AA-07, AA-08, AA-09 | Storage migration for embedded images, rates form hydration, corporate code integrity, dashboard operational sections | Fixed on `fix/audit-aa-sev2` |
| 3 (`fix/audit-aa-sev3`) | AA-10 … AA-22 | Route guard normalization, mobile sign-out, timezone, exports, room/type editing, status model, redemption panel, white-label, API base URL | Fixed on `fix/audit-aa-sev3` |
| 4 (`fix/audit-aa-sev4`) | AA-23 … AA-33 | Nits, doc sync, role-surface decisions | Fixed on `fix/audit-aa-sev4` |

**Fix-order notes:**
- AA-10 through AA-22 are fixed on `fix/audit-aa-sev3`; AA-18 now exposes
  the `payment-confirmed` intermediate state instead of bypassing it.
- AA-03 and AA-09 are fixed; the dashboard now reuses proof links for
  pending-payment verification.
- AA-04/AA-05 are fixed; store item data-URL migration is handled by
  `AdminContext`, while guest ID uploads are Storage-only going forward.
- AA-07(4) is fixed by allowing staff/admin corporate-code writes; AA-33
  is resolved by documenting voucher/settings management as admin-only.

## Status legend
- **Open** — no fix landed; the finding is reproducible on `dev` @ `4c43cfa`.
- **Fixed in `<hash>`** — a commit referencing this doc closes the finding.
- **Verified** — re-checked and found already correct (none yet).
