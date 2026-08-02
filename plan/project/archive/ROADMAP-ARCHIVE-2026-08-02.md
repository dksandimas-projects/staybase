# HISTORICAL ARCHIVE — Spark Inn Roadmap Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical roadmap detail, shipped feature checklists, and completed batch logs up to August 2, 2026. Do not read routinely for active tasks. For active roadmap status, see [`plan/project/ROADMAP.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/project/ROADMAP.md).

---

## Completed Phases (Phases 0 – 11.7)

### Phase 0 — Foundation
- ✅ Project repository structure initialized (guest-app, admin-app, shared)
- ✅ Firebase Authentication & Firestore configuration initialized
- ✅ Tailwind CSS design token system & typography configured
- ✅ White-label configuration system (`hotel.config.ts`) established
- ✅ Husky git hooks & Conventional Commits configured

### Phase 0.5 — Wireframes
- ✅ 60 wireframe screens designed & reviewed via Stitch workflow
- ✅ UI component conventions & responsive breakpoints established
- ✅ Canonical design tokens documented in `plan/stitch/design.md`

### Phase 1 — Guest App Shell & Pages
- ✅ Homepage (hero, availability bar, featured rooms, amenities, location map)
- ✅ Rooms Catalog (`/rooms`, filterable grid, detail modals)
- ✅ Corporate Stays marketing & booking lookup (`/my-booking`)
- ✅ Static pages (About Us, Contact Us with Turnstile/honeypot protection, 404, Privacy, Terms)

### Phase 2 — Admin App Shell & Auth
- ✅ Firebase Email/Password auth & role-based route guards (`admin`, `front-desk`)
- ✅ Admin Layout (collapsible responsive sidebar, header, version display)
- ✅ Staff account creation API & permissions

### Phase 3 — Rooms Management
- ✅ Room grid, photo uploads to Firebase Storage
- ✅ Room status toggles (`available`, `occupied`, `blocked`)
- ✅ Housekeeping status lifecycle (`clean` → `dirty` → `in-progress`)

### Phase 4 — Guest Booking Flow
- ✅ 4-Step Booking Flow: Step 1 (Room & dates selection) → Step 2 (Guest details & TOS consent) → Step 3 (Payment proof upload / Voucher input / OSCA PWD ID upload) → Step 4 (Confirmation & receipt generation)
- ✅ Double-booking prevention via Firestore transactions
- ✅ Email confirmation notifications via Resend API

### Phase 5 — Admin Bookings Management
- ✅ Filterable/sortable bookings data table with status quick filters
- ✅ 4-section drawer workspace (Overview, Check-in, Folio, Activity)
- ✅ Onsite payment recording, refund workflow, and discount verification/rejection
- ✅ Guest ID photo upload & PDF registration form generator

### Phase 6 — Transactional Email System
- ✅ Resend email templates integration for all 15 transactional triggers
- ✅ Booking submitted, payment confirmed, booking confirmed, check-in reminder, cancellation, and store order updates

### Phase 7 — Corporate Bookings & Promo Vouchers
- ✅ Corporate booking portal (`/corporate/book`) with flat-rate & access code validation
- ✅ Admin promo voucher management (percentage & flat discounts, usage caps, expiration dates)

### Phase 8 — Intercom & QR Systems
- ✅ QR code generation per room (`/intercom/{roomId}`)
- ✅ Live browser chat between guest room and admin Inbox
- ✅ WebRTC audio call support & quick request badges

### Phase 9 — Static Content & Legal Compliance
- ✅ Editable legal pages (Privacy Policy, Terms of Service, House Rules)
- ✅ RA 10173 (Data Privacy Act of 2012) compliance rules & PII protection
- ✅ Full Data Backup export (multi-sheet XLSX covering all 8 collections)

### Phase 11.5 / 11.6 — Audit Fixes & Pre-Launch Polish
- ✅ 50 audit items across 20 batches shipped (security rule hardening, date parsing fixes, payment proof security)

### Phase 11.7 — Admin Mobile UX (Shipped 2026-06-18 v0.90.0)
- ✅ 30 mobile layout items shipped across all 11 admin screens (<768px responsive layout, bottom-sheet drawers, card views, sticky headers)

---

## Shipped Phase 12 Enhancement Blocks (Detailed Implementation Narratives)

### Room Type & Rates Save Defects (RTS)
- ✅ **RTS-01 — CONFIRMED: `handleSaveRates` races itself; only one room type's rates survive** — `RatesPage.tsx` built `roomTypes.map(t => updateRoomType(t.value, {...}))` and fired them all through one `Promise.all`. `updateRoomType` in `AdminContext.tsx` did `const updated = roomTypes.map(...)` — reading `roomTypes` from its render-time closure — then `saveRoomTypes(updated)` wrote the entire array via `setDoc(..., { merge: true })`. A merge write replaces an array field wholesale, so N concurrent calls each computed "the original array with exactly one type changed" from the same stale snapshot, and the last write to land won. Every other room type's edit was silently discarded. Fixed in 1f07946.
- ✅ **RTS-02 — Fix: one batched array write, not N racing ones** — added a bulk `saveRoomTypes(types: RoomTypeEntry[]) => Promise<void>` API to `AdminContext` (exposed on the context interface + value destructure); `handleSaveRates` computes the whole matrix once and calls it once. Fixed in 1f07946.
- ✅ **RTS-03 — Room type deletion fails on staging** — reproduced same day on staging — the deletion "didn't work" symptom was RTS-04 (silent failure swallow).
- ✅ **RTS-04 — `saveRoomTypes` swallowed `updateSettings` failures and never rolled back optimistic state** — `updateSettings` catches its own errors, fires a "Failed to save settings" toast, and returns `false` rather than throwing — so `saveRoomTypes`'s own `try/catch` was dead code and its callers never learned the write failed. `saveRoomTypes` now captures `previousTypes`, applies the optimistic update, checks the boolean return of `updateSettings`, and throws + rolls back the optimistic state on every failure path.
- ✅ **RTS-05 — Proper delete confirm via `Modal + ConfirmForm`** — Shipped 2026-08-01 on `fix/rts-05-06-confirm-empty-rehydrate` (v0.200.1). The 3-second auto-disarm `useEffect` on `pendingDeleteRoomType` is removed. `pendingDeleteRoomType` is now `RoomTypeEntry | null`. Both Delete buttons call `setPendingDeleteRoomType(type)` and a new Modal opens containing a `ConfirmForm` with `variant="danger"` + `reasonRequired: true`.
- ✅ **RTS-06 — `roomTypesLoaded` flag re-hydrates empty snapshots** — Shipped 2026-08-01 on `fix/rts-05-06-confirm-empty-rehydrate` (v0.200.1). A `roomTypesLoaded: boolean` flag is added to `AdminContext`. The `length > 0` guard on the snapshot sync effect is dropped — any array value syncs, and the flag tracks "the snapshot has been observed at least once".
- ✅ **RTS-07 — Tests + MD sync** — Added 8 source-text guards in `admin-app/src/__tests__/rts-01-rates-save.test.ts`.

### Pre-MRB Hardening (PMH)
- ✅ **PMH-02 — Extract folio math into ONE shared, behavior-frozen function** — Shipped 2026-07-31 at v0.194.1 (commit `f2fa62b`): two helpers in `shared/utils/bookingFolio.ts` — `computeBookingFolio(input)` for the per-booking folio and `computeServerFolioTotals(input)` for the server's inline `folioTotal` / `computedBalance` math. Pinned by 10 characterization tests in `shared/__tests__/booking-folio.test.ts`.
- ✅ **PMH-03 — Wire the existing emulator harness into `npm test` and extend it to behavioral tests** — Shipped 2026-07-31 at v0.192.0 (commit `f9814dd`): root `npm test` runs full chain including emulator. `firebase/tests/room-types-array-write.emulator.test.ts` pins the RTS-01 fix at the Firestore layer.

### Extra Bed Configuration (EXB)
- ✅ **EXB-10 — Hotel-wide rollaway-bed inventory** — Shipped 2026-08-01 at v0.207.0 (commit `aa0bdf8`). New `settings/hotelConfig.extraBedInventory` field stores the hotel-wide count of rollaway beds (`0` = no constraint). Server transactions read inventory + query overlapping occupying bookings + call `checkExtraBedInventory` inside `runTransaction`. 11 helper unit tests + 16 source-text guards pin the contract.

### Shipped Feature Blocks (GCR, CWB, LCE, ECE, GSD, BSP, MBP, WSN, HSD, MBZ, WRV, WPM, NBS, PEX, DSC, MRB, CRL)
- ✅ **GCR** — Guest check-in registration purpose of stay (#121, 2026-07-24): Required purpose of stay selector added to physical check-in registration form.
- ✅ **CWB** — Confirm with balance for partial-payment bookings (#122, 2026-07-24): Allows staff to confirm pending bookings with a remaining balance while logging explicit audit notes.
- ✅ **LCE** — Editable Terms & Conditions & consent versioning (#137, 2026-07-25): Admin-editable TOS text in Settings; booking Step 2 captures exact snapshotted terms version.
- ✅ **ECE** — House Rules in confirmation emails (#139, 2026-07-24/26): Embeds hotel House Rules and key policy callouts in transactional confirmation emails.
- ✅ **GSD** — Guest store search & category browsing (#138, 2026-07-25): Real-time search input and category filter chips added to guest room shop (`/intercom/{roomId}`).
- ✅ **BSP** — Breakfast served persistence (#132, 2026-07-25): Staff daily silog breakfast-served toggle state persisted to Firestore booking documents.
- ✅ **MBP** — Multi-booking picker & privacy protection (#126/#128/#131, 2026-07-24/25): Lookup page returns masked list when multiple bookings match same email/phone; masks email to `g***@domain.com`.
- ✅ **WSN** — Walk-in first/last name split (#127, 2026-07-25): Splits single guest name field in walk-in modal into explicit `firstName` and `lastName` fields.
- ✅ **HSD** — HEIC support via `heic-to` (#125, 2026-07-24): Client-side conversion of Apple HEIC photos to JPEG before Firebase Storage upload.
- ✅ **MBZ** — Modal/drawer backdrop z-index two-tier model (2026-07-24): Standardized z-index stacking layers for nested admin modals and drawers.
- ✅ **WRV** — Weekend Rate Visibility (#151, 2026-08-01): Surfacing weekend surcharge rates and seasonal multipliers on room type catalog cards.
- ✅ **WPM** — Walk-in Payment Method from Settings (#141, 2026-07-31): Walk-in modal dynamically populates payment methods from `settings/hotelConfig.paymentMethods[]`.
- ✅ **NBS** — New Booking & Customizable Booking Sources (#142, 2026-07-31/08-01): Dynamic CRUD for acquisition sources (`settings/hotelConfig.bookingSources[]`) with protected system keys (`online`, `walk-in`, `corporate`).
- ✅ **PEX** — Pending Booking Expiry & Hold Window (#147, 2026-08-01): Configurable `paymentHoldWindowHours` (default 24h) with automated cron-based hold expiration (`/api/holds/expire`).
- ✅ **DSC** — Discount Scope Configuration & VAT Breakdown (#146/#148/#149/#150, 2026-07-31/08-01): 3x3 toggle matrix governing room/breakfast/extra-bed discount eligibility per class, statutory Senior/PWD guardrails, and itemized VAT breakdown on receipts.
- ✅ **CRL (Phase 1)** — Cancellation & Refund Lifecycle foundation (2026-08-01/02): Refund idempotency (`refundId`, CRL-01), immutable audit stamps (`cancelledAt`/`cancelledBy`/`cancellationSource`, CRL-02), server status matrix dual gate (CRL-03), and truthful copy ("No refund is automatic", CRL-04).
- ✅ **MRB (Phase 1)** — Multi-Room Bookings foundation (2026-08-02): `reservations/{id}` header, public reservationRef (`R-YYYYMMDD-NNNNN`), transactional create & idempotency for single-room, walk-in, reschedule, corporate, and N-booking assignment (MRB-01..05).
