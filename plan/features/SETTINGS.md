# Settings
> Requires: CLAUDE.md, plan/docs/FRONTEND.md, plan/docs/BACKEND.md, plan/admin-app/CLAUDE.md

## Overview

Admin-only configuration hub at `/settings`. Organized into tabs covering hotel information, payment methods, booking sources, email configuration, staff accounts, discount scope rules, intercom quick requests, and website content editing.

---

## Tabs & Configuration Areas

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

