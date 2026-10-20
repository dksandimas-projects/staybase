# Settings
> Requires: CLAUDE.md, plan/docs/FRONTEND.md, plan/docs/BACKEND.md, plan/admin-app/CLAUDE.md

## Overview

Admin-only configuration hub at `/settings`. Organized into tabs covering hotel information, payment methods, booking sources, email configuration, staff accounts, discount scope rules, intercom quick requests, and website content editing.

---

## Tabs & Configuration Areas

### 0. Sidebar grouping (SET-SBG-01, 2026-10-12)

The settings hub grew to **19 tabs** by v2.3.0 (Hotel Info + Payment Methods + Booking Sources + Discounts + Staff Accounts + Email & Notifications + Intercom + Website Content & Room Types + Loyalty Rewards + Breakfast & Dining + Other Add-Ons + In-Room Store + SEO & Search + Legal Content + Environment Testing + Booking Preferences + Branding + Booking & Holds). The 19 flat tabs exceed the scan-without-thinking threshold, so the desktop sidebar collapses them into **5 stakeholder-oriented groups**:

| Group | Tabs | Why |
|---|---|---|
| **Property** | Hotel Settings, Room Types, Branding | Identity & inventory. "What you are" + "what you sell." Branding sits here because it's tied to the hotel identity, not marketing. |
| **Bookings & Revenue** | Booking Preferences, Booking Sources, Booking & Holds, Payment Methods, Discounts | The booking engine end-to-end — rules → sources → holds → money in → discounts. The section hotel staff touch daily. |
| **Guest Experience** | Loyalty Rewards, Breakfast & Dining, Other Add-Ons, In-Room Store, Intercom | What a guest *uses during their stay*. Distinct from "how they got here." |
| **Marketing & Reach** | Website Content, SEO & Search, Email Config | What brings them in pre-stay — website copy, discoverability, transactional emails. |
| **Admin** | Staff Accounts, Legal Content, Environment Testing | Back-of-house — who works here, compliance text, the staging/QA tool. |

**UI behavior (desktop `lg+`):** each group renders as a **collapsible section header** with chevron + `[N]` count badge. Click toggles expand/collapse. Persisted choice lives in `localStorage["settings.sidebar.collapsedGroups.v1"]`. The active group is always force-expanded — visibility of "where you are in the app" wins over the user's collapsing choice. The active group's collapse toggle is a no-op so the operator can't lose their place.

**UI behavior (mobile `< lg`):** the existing horizontally scrollable pill bar keeps the flat 18-pill row but inserts a vertical divider between each group's pills (visual continuity with the desktop groups). The active pill is auto-scrolled into view by the existing `tabBarRef` `useEffect`.

**Why stakeholder-oriented, not frequency-oriented:** the groups answer "who is this for" rather than "settings I touch daily." That scales as more tabs get added — each new tab has an obvious home instead of relitigating whether it's weekly or monthly.

**Environment Testing placement:** kept under `Admin` for now. Long-term, it should move out of `/settings` entirely to a separate `Admin → Tools → Test Runner` path gated behind a "show developer tools" env flag (decision pending).

**Contract enforcement:** `admin-app/src/__tests__/set-sbg-01-settings-sidebar-grouping.test.ts` (source-text guards per `CONTRIBUTING.md §Testing`) pins the group inventory, the union-of-tabs invariant (every `TabId` covered exactly once), the localStorage key, the active-group auto-expand, the `aria-expanded` + `role="group"` desktop wiring, and the mobile pill divider shape.

Per OCT-M6 (2026-10-20, decision #293) the tripwire now PARSES `VALID_TAB_IDS`, `SETTINGS_GROUPS` and the flat `tabs` metadata out of the source instead of comparing a hardcoded copy of the group tabs with itself — so it can actually detect a source-side omission (which is how the `addons` tab shipped invisible in the sidebar once already). The tab count is derived, not pinned.

### Other Add-Ons — the hotel-wide master switch (OCT-M1, 2026-10-20, decision #295)

The Other Add-Ons tab carries two levels of control:

| Control | Scope | Stored where | Effect |
|---|---|---|---|
| **"Add-ons enabled"** (top of the tab) | The whole category | `settings/hotelConfig.otherAddOnsEnabled` | OFF → the public catalog endpoint returns an EMPTY catalog, the guest Step 2 grid disappears, the guest Manage page shows no add-ons, and the guest save path refuses an order with a 400. The staff path stays open (front-desk override). |
| **Status** (per row in the catalog table) | One add-on | `addOns/{addOnId}.isEnabled` | OFF → that one add-on is off sale; its cut-off state becomes `addons-disabled` (every date locked). |

Before OCT-M1 the hotel-wide switch was a bare `useState(true)` — no Firestore read, no write, no localStorage mirror — while the copy under it told the admin it emptied every `getEnabledAddOnsByHotel` call. An admin who flipped it believed other add-ons were off sale while guests kept buying the airport transfer. It now persists, and the copy matches the behaviour.

**Only an explicit `false` disables the category.** A settings doc written before OCT-M1 has no `otherAddOnsEnabled` field and hydrates to `true` — a hotel's revenue stream is never silently switched off by a missing field. The shared normalizer is `normalizeOtherAddOnsEnabled` (`shared/utils/addOns.ts`); the single server-side reader is `guest-app/server/lib/otherAddOns-settings.ts`.

**The switch re-syncs from the snapshot.** `useState`'s lazy initializer only runs on the FIRST render — before the Firestore snapshot lands — so a direct load of `/settings` would show the pre-snapshot default. The switch therefore re-syncs when the SOURCE value changes (the same pattern the Booking & Holds inputs use), so a snapshot arriving mid-toggle cannot clobber an in-progress change. A failed write reverts the switch, so it never shows a value that is not stored.

### 1. Hotel Info
- Address, support email, front-desk phone, DPO email, and social media URLs (Facebook, Instagram, X).
- Check-in and check-out times.
- Source: `settings/hotelConfig` and `settings/websiteContent.contact`.

### 2. Payment Methods
- Dynamic CRUD for booking, store, and corporate payment methods (`settings/hotelConfig.paymentMethods[]`).
- **Surface Pills:** Independent toggles for `Booking` (`isEnabled`), `Store` (`showInStore`), and `Corporate` (`showInCorporate`).
- **Protected Methods:** `pay-at-hotel` and `add-to-bill` are protected from deletion (`PROTECTED_PAYMENT_METHODS`).
- **Reference Guard:** `requireReferenceNumber` forces required reference input at Step 3.
- **QR Uploads:** Stores images in Firebase Storage at `assets/payment-methods/{method}/{filename}`.

### 3. Booking Sources (NBS-04)
- Dynamic CRUD for acquisition sources (`settings/hotelConfig.bookingSources[]`).
- Protected system keys (`online`, `walk-in`, `corporate`) cannot be deleted or set as front-desk-selectable.

### 4. Discounts (DSC-01..05 & PEX-01)
- **Discount Scope Matrix:** 3×3 toggle matrix governing charge components (room, breakfast, extra bed) per discount class (Senior/PWD, Voucher, Member).
- **Statutory Guardrails:** Senior/PWD scope is Admin-only, defaults to broad scope (all components), and displays an OSCA/RA 9994 compliance advisory.
- **Payment Hold Window:** Configurable `paymentHoldWindowHours` (1..72h, default 24h) for auto-expiry of unpaid pending bookings.
- **In-Flow Hold Window (IFH-01.2):** Configurable `inFlowHoldMinutes` (5..30 min, default 15) for the public booking flow's Steps 2 + 3 countdown banner. Per-hotel source of truth: `settings/hotelConfig.inFlowHoldMinutes`. Snapshotted onto the `bookingHolds/{id}` doc as `holdMinutes` at start time — a later Settings change never shortens or lengthens an existing guest's promise. Bounded via `normalizeInFlowHoldMinutes` in `shared/utils/bookingInFlowHold.ts`. **IFH-01.3 follow-up:** the Settings tab editor (Settings → Booking & Holds, admin-only) is now shipped. Two number inputs (payment hold 1..72h, in-flow hold 5..30 min) with inline validation via the shared `clampIntegerInRange` helper. Save is disabled when either value is out of range, hand-typed, or non-finite. The server-side normalize helpers remain the authoritative gate.
- **Maximum Stay Length (MSL-01):** Admin-only numeric cap on how long a single stay may run, for public bookings, walk-ins, AND reschedules. Persists to `settings/hotelConfig.maxStayNights`. **`0` means no limit**; an ABSENT field means the 30-night default — the two are deliberately different, because `0` is the operator's explicit choice while absence means they have never touched the setting. Range `0..365` (anything past the booking horizon is unreachable, so the horizon is the honest upper bound). Read through `resolveMaxStayNights` (`shared/utils/stayRange.ts`), which maps `0` → `Infinity` for the clamp arithmetic and fails CLOSED on garbage rather than to unlimited. Unlike the two hold windows above, this value is **not snapshotted** — it applies to every booking from the moment it is saved, including stays already checked in. Cannot reuse `clampIntegerInRange` (its `min` is `>= 1`); the editor uses an inline validator that admits `0`. Admin-only because it is a public-site promise. No new Vercel function.
- **Tax (VAT) Toggle (VAT-01):** Admin-only single boolean that gates the 12% BIR VAT breakdown across every product surface (Reports + XLSX export, admin booking drawer, admin print-to-PDF receipt, guest `/book` live preview, guest confirmation + lookup). Persists to `settings/hotelConfig.vatConfig = { enabled: boolean }` (default `{ enabled: true }` — BIR-compliant state; byte-equivalent hydration for legacy settings via `normalizeVatConfig` in `AdminContext`'s `onSnapshot` merge). When OFF, the entire VAT block disappears (no zero-line state) — the operator's published rate is the guest's net amount. The toggle is a permanent control whose state depends on the hotel's VAT-registration status (Philippine threshold: ₱3M annual gross sales); it is NOT time-bound (no "first year" logic). Surfaced to the guest app via `usePublicSiteContent().vatConfig` so the live preview reads the same source of truth. Admin-only (same RA 9994-style guardrail as the discount-scope row); front-desk staff cannot reach the toggle. No new Vercel function. Full spec in `plan/docs/DECISIONS-FEATURES.md` (entry VAT-01).

### 5. Staff Accounts
- Staff account management (name, email, role, date created).
- Account creation & updates via authenticated API routes (`/api/admin/create-staff`, `/api/admin/update-staff`).
- Password reset and account disable/enable toggles.

### 6. Email & Notifications
- From address & notification emails.
- Preview catalog for all 22 transactional email templates.

### 7. Intercom Quick Requests & Operations
- Configurable quick request items for in-room QR chat (`/intercom/{roomId}`).
- Admin-only — Front Desk records guest selections
- Admin-only — Front Desk processes store orders

### 8. Website Content & Room Types
- Editable text for Homepage, About Us, Corporate Stays, and legal pages.
- **Room Type Photos:** Managed under rates/room types with `imageUrls` (Maximum 10 photos per type).

---

## Room Type Photo Gallery — Atomic Array Mutations (MRB-15-11)
> Proposed 2026-08-04, per decision #188. Spec-only — no code yet. Files: `admin-app/src/context/AdminContext.tsx:4978-5034` (the three photo-gallery functions: `uploadRoomTypePhoto`, `removeRoomTypePhoto`, `reorderRoomTypePhotos`). Follows the MRB-15-10 hydration-fix pattern — operator-facing UX bug, source-text test to lock the contract at the read-modify-write layer.

### The problem

The Settings → Room Types editor's photo gallery (`admin-app/src/pages/SettingsPage.tsx:5566-5599`) opens a `<input type="file" accept="image/*" multiple>`; the operator can select N photos at once and the handler `for`-loops over them, calling `uploadRoomTypePhoto(typeValue, file)` for each. **When the operator selects more than 1 photo, only the LAST image survives — the previous ones are silently replaced.** Operator-facing UX bug, 2026-08-04: "in the admin settings, upload photos for room types, when I select more than 1 image for upload, it only uploads 1 image at a time and replaces the previously uploaded image. Instead of uploading for example 5, I only get the last or the 5th image selected."

The user can upload photos one-at-a-time and the gallery works fine; the failure is specific to the **batched** upload path.

### Root cause — the read-modify-write race

`uploadRoomTypePhoto` at `admin-app/src/context/AdminContext.tsx:4978-5002`:

```ts
const type = roomTypes.find((t) => t.value === typeValue);   // ← reads IN-MEMORY state
// ... upload to Storage, get url ...
const next = [...type.imageUrls, url];                         // ← builds from IN-MEMORY state
await updateRoomType(typeValue, { imageUrls: next });          // ← writes full array
```

The handler loops and `await`s each call, so the calls are sequential. But each call:

1. Reads `type.imageUrls` from the **in-memory** `roomTypes` state (the React-side cache of the Firestore snapshot)
2. Appends the new URL
3. Calls `updateRoomType` → `saveRoomTypes(updated)` → `updateSettings("hotelConfig", { roomTypes: newTypes, ... })` (a full-document write of the entire `roomTypes` array)

The in-memory `roomTypes` state is only updated when the Firestore subscription fires locally with the new snapshot. **Between the N sequential `await uploadRoomTypePhoto` calls, the subscription may not have fired yet** — so the (N+1)th call reads the **stale** in-memory state (still the pre-first-upload value) and overwrites the array with a single-element array `[url(N+1)]`.

Five uploads → five overwrites of a single-element array → only the last URL survives. The same race applies to `removeRoomTypePhoto` (a `filter` + write on stale in-memory state) and to a lesser extent to `reorderRoomTypePhotos` (a full-array write of the new order — single-user action, low race surface, but still on stale in-memory state).

### The pattern — atomic read-modify-write inside a Firestore transaction

The pre-MRB-15-11 code reads the React-side cache and writes the whole array. The fix reads the Firestore document inside a `runTransaction` and writes the patched array back. Firestore's transaction guarantees serialized execution — every transaction sees the latest committed state, so the (N+1)th append sees the (N)th's write.

```ts
const hotelConfigRef = doc(db, "settings", "hotelConfig");
const url = await uploadToStorageAndGetUrl(file, typeValue);  // slow part, stays outside the tx
await runTransaction(async (tx) => {
  const snap = await tx.get(hotelConfigRef);
  const data = snap.data();
  const roomTypes = data?.roomTypes ?? [];
  const idx = roomTypes.findIndex((t) => t.value === typeValue);
  if (idx < 0) throw new Error("Room type not found");
  const type = roomTypes[idx];
  if (type.imageUrls.length >= MAX_ROOM_TYPE_PHOTOS) {
    // Best-effort: clean up the orphan Storage object so the
    // cap reject doesn't leave a dangling file.
    await deleteObject(storageRef(storage, urlPath)).catch(() => undefined);
    throw new Error(`Maximum ${MAX_ROOM_TYPE_PHOTOS} photos per room type.`);
  }
  const newRoomTypes = [...roomTypes];
  newRoomTypes[idx] = { ...type, imageUrls: [...type.imageUrls, url] };
  tx.update(hotelConfigRef, {
    roomTypes: newRoomTypes,
    updatedAt: serverTimestamp()
  });
});
```

The Storage upload stays OUTSIDE the transaction (Storage ops can't be in a Firestore transaction). The transaction wraps only the **find → cap-check → append → write** cycle on the Firestore document. The `MAX_ROOM_TYPE_PHOTOS` cap check moves INSIDE the transaction (atomic with the write — a parallel admin's append can't slip past the cap).

### What changes

  (1) **`uploadRoomTypePhoto`** — wraps the read-modify-write in `runTransaction`; cap check + Storage cleanup on reject move into the transaction path; the local `roomTypes` state is updated by the existing Firestore subscription (no manual `setRoomTypes` call needed inside the function — the snapshot fires on commit and the in-memory cache re-syncs).

  (2) **`removeRoomTypePhoto`** — same pattern: `runTransaction` with a `findIndex` + `filter` + `tx.update`. The existing best-effort `deleteObject` for the Storage file stays outside the transaction (Storage isn't transactional with Firestore anyway).

  (3) **`reorderRoomTypePhotos`** — same pattern: `runTransaction` with a `findIndex` + array reorder + `tx.update`. Drag-and-drop is a single-user action so the race surface is small, but using the same pattern keeps the contract consistent and gets the same atomicity guarantee.

  (4) **The client-side `if (type.imageUrls.length >= MAX_ROOM_TYPE_PHOTOS)` check at `SettingsPage.tsx:5548`** becomes a UX hint only (disable the upload button) — the server-side transaction is the source of truth for the cap.

  (5) **The `updateRoomType` helper at `AdminContext.tsx:4930-4953` is unchanged** — the photo functions bypass it (they write the whole `roomTypes` array inside a transaction, not the per-type patch shape the helper supports). The Edit-form callers (label, price, capacity, etc.) keep using `updateRoomType` as before; no data-model or helper-surface change.

  (6) **The `useEffect` race-guard at `AdminContext.tsx:1947-1953` (the `photoTarget` re-sync from the live snapshot) is unchanged** — it stays correct. The fix is at the write layer, not the read layer.

### What this does NOT change

  - The data model is unchanged. `roomTypes[i].imageUrls: string[]` stays; the array is still written as a whole in the same document; no new sub-collection, no new field. The MRB-15-10 hydration contract (every field preserved) is unaffected — `imageUrls` was always in the preserved set.
  - The Storage path shape (`room-types/{typeValue}/{timestamp}-{filename}`) is unchanged.
  - The toast UX (`SettingsPage.tsx:5571-5573` "Some photos skipped" when `files.length > remaining` + `SettingsPage.tsx:5594-5597` "Photos added: N uploaded" / "Upload failed: No photos could be uploaded") is unchanged — the per-file error handling inside the loop is still surfaced.
  - The `imageUrls.length` display in the gallery header (`SettingsPage.tsx:5602`) is unchanged.
  - The drag-to-reorder / delete-each / hero-image semantics are unchanged.

### Edge cases

  - **`files.length > MAX_ROOM_TYPE_PHOTOS - current`** — the existing `SettingsPage.tsx:5570-5575` slice + toast stays. The transaction-side cap is the source of truth; the client-side slice is a UX hint.
  - **Parallel admin + guest uploader** — the transaction serializes correctly. If two admins each upload 1 photo at the same time, one transaction commits first, the other reads the updated state inside the transaction (sees the first admin's URL) and appends its own. Both photos land. No lost writes.
  - **A failed Storage upload (network down, file too large, etc.)** — caught by the existing `try/catch` at `SettingsPage.tsx:5588-5590`; the loop continues to the next file. The `successCount` accounting at `SettingsPage.tsx:5578 + 5587 + 5594` is unchanged.
  - **`typeValue` doesn't exist in the document** (e.g. type was deleted while the photo modal is open) — the `findIndex < 0` check throws; the error surfaces as a "Failed to upload photo" toast. The existing modal-close-on-`photoTarget = null` flow handles the type-deletion case at `SettingsPage.tsx:1947-1953`.
  - **The Firestore transaction aborts on a Firestore contention error** (the default retry policy retries up to 5x) — the photo appears in the gallery once the retry commits. No special handling needed.
  - **The `runTransaction` wraps a `tx.update` that targets a field inside an array element** — Firestore's `tx.update` supports the full document shape, so writing `roomTypes: newRoomTypes` is the same write shape `saveRoomTypes` already uses. No nested-field-path gymnastics.

### Tests

  New `admin-app/src/__tests__/mrb-15-11-photo-gallery-atomic-mutations.test.ts` (source-text guards per `plan/docs/CONTRIBUTING.md §Testing` — cheap, deterministic, <5s). The behavioural emulator round-trip (5 photos uploaded in a batch, gallery shows all 5) is deferred to the local environment that has the Java emulator (mirrors the MRB-11 / MRB-14 / MRB-15-08 precedent).

  Source-text guards (one tripwire per contract point):
    - `uploadRoomTypePhoto` calls `runTransaction` (not the plain `updateDoc` / `saveRoomTypes` path)
    - The `runTransaction` body reads `tx.get(hotelConfigRef)` (Firestore, not in-memory `roomTypes`)
    - The transaction body `findIndex` on `roomType.value`
    - The transaction body's cap check (`type.imageUrls.length >= MAX_ROOM_TYPE_PHOTOS`) is inside the transaction
    - The transaction body writes `tx.update(hotelConfigRef, { roomTypes: newRoomTypes, updatedAt: serverTimestamp() })` (full-array write, not a nested-field path)
    - The Storage `deleteObject` cleanup on cap-reject is best-effort (`.catch(() => undefined)`)
    - `removeRoomTypePhoto` calls `runTransaction` with the same shape
    - `reorderRoomTypePhotos` calls `runTransaction` with the same shape
    - `updateRoomType` helper is unchanged (regression guard against accidentally funnelling photo writes through it)
    - The pre-MRB-15-11 read-modify-write pattern (`const next = [...type.imageUrls, url]`) is gone from the photo functions

  Re-verify the existing `admin-app/src/__tests__/mrb-15-10-room-types-hydration-preserve-cap-fields.test.ts` (the hydration contract is unchanged) and `admin-app/src/__tests__/mrb-15-09-admin-reservations-token-refresh.test.ts` (unrelated).

### Rejected alternatives

  - **Use `FieldValue.arrayUnion(url)` on a nested field path `roomTypes.{idx}.imageUrls`** — the arrayUnion primitive is atomic on its own field, but the `idx` has to be resolved against the live document (the same read the transaction does); solving the index-stability problem pushes the code back to the read-modify-write shape. `runTransaction` is cleaner because it handles the index lookup + append + write in one atomic step.
  - **Pre-allocate the photo index in a separate `photoSlots: number[]` field** — adds a new field, a new invariant (slot is reserved or free), and a new write path; the data-model is unchanged here on purpose.
  - **Sub-collection per photo (`roomTypes/{type}/photos/{photoId}`)** — cleanest from a NoSQL perspective (one doc per photo, no array mutations), but changes the public surface (`getRoomTypeImages` at `admin-app/src/hooks/useRoomTypes.ts` reads `imageUrls[]` and is consumed by both admin and guest apps; converting to a sub-collection ripples into the read path, the cart UI, the rooms page, the booking page, and the corporate page). Out of scope for a "fix the race" PR.
  - **Disable the multi-select on the file input** (`accept="image/*"` no `multiple`) — solves the symptom, breaks the workflow. The operator's intent ("upload 5 photos at once") is the right intent; the implementation just needs to honor it.
  - **Show a per-file progress + lock the gallery while uploading** — solves a different problem (perceived responsiveness); the underlying race is a correctness bug, not a UX bug.
  - **Move the photo operations to a server-side Cloud Function** — moves the race off the client (the function has no in-memory state to race against), but the function still does the same read-modify-write against Firestore and needs the same `runTransaction` to be correct. The transaction shape is the right fix regardless of where the code runs.

### Gates

  - **MRB-15-10** — the hydration contract (every `RoomTypeEntry` field preserved) is unchanged; the photo gallery is a write path, not a read path.
  - **MRB-15-09** — the staff-gated listener pattern is unrelated; the photo functions are operator-initiated writes, not subscription handlers.
  - **`saveRoomTypes` (the underlying full-document write)** — unchanged contract; the photo functions stop calling it (they go through the transaction directly) but the helper stays for the Edit-form callers.
  - **The `useEffect` at `AdminContext.tsx:1947-1953`** — unchanged; the local `photoTarget` re-sync from the live snapshot still works because the transaction's commit fires the subscription, which re-syncs the in-memory state, which the effect picks up.

### Phase 2 (deferred, NOT in MRB-15-11)

  - **Sub-collection per photo** — the right long-term shape, but a refactor of every read site (admin + guest + corporate). Filed as a future `MRB-15-11b` if the photo gallery grows beyond a per-type 10-photo cap.
  - **Per-photo metadata** (caption, alt text, focal point) — needs the sub-collection shape first; out of scope for the race fix.
  - **Bulk re-tagging (apply a label / season to N photos at once)** — same sub-collection prerequisite.
  - **A "set as hero" drag-to-front interaction** — currently the hero is implicit ("the first photo in the array"); an explicit drag-to-front is a real UX item, out of scope.

