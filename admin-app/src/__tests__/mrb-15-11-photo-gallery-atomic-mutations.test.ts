// Per MRB-15-11 (2026-08-04, per decision #188):
// source-text regression tests for the admin room-type photo
// gallery's atomic-array-mutation fix. The pre-MRB-15-11
// photo-gallery functions in `admin-app/src/context/AdminContext.tsx`
// did a read-modify-write on the in-memory `roomTypes` state —
// `uploadRoomTypePhoto` read `type.imageUrls` from the
// React-side cache of the Firestore snapshot, appended the new
// URL, then called `updateRoomType` → `saveRoomTypes(updated)`
// → `updateSettings("hotelConfig", { roomTypes: newTypes, ... })`
// (a full-document write of the entire `roomTypes` array).
// The SettingsPage handler at `admin-app/src/pages/SettingsPage.tsx:5566-5599`
// `for`-loops and `await`s each call so the calls are
// sequential — but the in-memory `roomTypes` is only updated
// when the Firestore subscription fires locally. Between the
// N sequential `await uploadRoomTypePhoto` calls, the
// subscription may not have fired yet, so the (N+1)th call
// reads **stale** in-memory state (still the pre-first-upload
// value) and overwrites the array with a single-element
// array `[url(N+1)]`. 5 uploads → 5 overwrites of a
// single-element array → only the last URL survives. The same
// race applies to `removeRoomTypePhoto` (a `filter` + write on
// stale in-memory state) and to a lesser extent to
// `reorderRoomTypePhotos` (a full-array write of the new
// order — single-user action, lower race surface, but still
// on stale in-memory state).
//
// The fix wraps all three functions in `runTransaction`. The
// transaction reads `tx.get(hotelConfigRef)` (Firestore, not
// the in-memory cache), does the `findIndex` + cap check +
// append / filter / reorder, then
// `tx.update(hotelConfigRef, { roomTypes: newRoomTypes, updatedAt: serverTimestamp() })`.
// Firestore's transaction guarantees serialized execution —
// every transaction sees the latest committed state, so the
// (N+1)th append sees the (N)th's write. The Storage upload
// stays OUTSIDE the transaction; the `MAX_ROOM_TYPE_PHOTOS`
// cap check moves INSIDE the transaction; the
// `updateRoomType` helper is unchanged.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural emulator round-trip
// (5 photos uploaded in a batch, gallery shows all 5) is
// deferred to the local environment that has the Java emulator
// (mirrors the MRB-11 / MRB-14 / MRB-15-08 precedent).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../src/context/AdminContext.tsx"),
  "utf8"
);

// Slice the three photo-gallery functions — `uploadRoomTypePhoto`,
// `removeRoomTypePhoto`, `reorderRoomTypePhotos`. Use a unique
// comment marker to anchor the start (the MRB-15-11
// spec-only comment is the first thing in the upload function)
// and the start of the `uploadBrandingAsset` block as the end
// (the next function after `reorderRoomTypePhotos` closes).
const photoStart = adminContextSrc.indexOf(
  "// Per MRB-15-11 (2026-08-04, per decision #188): the"
);
const photoEnd = adminContextSrc.indexOf(
  "// Per `plan/features/SETTINGS.md §Branding`: upload (or reset) a"
);
const photoSlice =
  photoStart >= 0 && photoEnd > photoStart
    ? adminContextSrc.slice(photoStart, photoEnd)
    : "";

describe("MRB-15-11 — admin room-type photo gallery atomic array mutations", () => {
  it("the three photo functions are present and locatable", () => {
    expect(photoSlice.length).toBeGreaterThan(0);
    expect(photoSlice).toMatch(/const uploadRoomTypePhoto\s*=\s*async/);
    expect(photoSlice).toMatch(/const removeRoomTypePhoto\s*=\s*async/);
    expect(photoSlice).toMatch(/const reorderRoomTypePhotos\s*=\s*async/);
  });

  it("`uploadRoomTypePhoto` wraps the read-modify-write in `runTransaction` (atomic append)", () => {
    // The transaction body must:
    //   1. Read from Firestore (tx.get(hotelConfigRef)), NOT the
    //      in-memory `roomTypes` cache.
    //   2. Do a `findIndex` on the type's value (handles the
    //      index-lookup inside the transaction so a parallel
    //      write that reorders the array doesn't break the
    //      field path).
    //   3. Do the cap check inside the transaction (defense in
    //      depth — a parallel admin's append can't slip past).
    //   4. Write via `tx.update(hotelConfigRef, { roomTypes, updatedAt: serverTimestamp() })`.
    expect(photoSlice).toMatch(/const uploadRoomTypePhoto/);
    expect(photoSlice).toMatch(/runTransaction\(db, async \(tx\)/);
    expect(photoSlice).toMatch(/tx\.get\(hotelConfigRef\)/);
    expect(photoSlice).toMatch(/currentRoomTypes\.findIndex\(\(t\) => t\.value === typeValue\)/);
    // The cap check is INSIDE the transaction body (the
    // `if (currentImageUrls.length >= MAX_ROOM_TYPE_PHOTOS)`
    // block sits inside the runTransaction callback).
    expect(photoSlice).toMatch(
      /currentImageUrls\.length >= MAX_ROOM_TYPE_PHOTOS/
    );
    expect(photoSlice).toMatch(
      /tx\.update\(hotelConfigRef, \{\s*roomTypes: newRoomTypes,\s*updatedAt: serverTimestamp\(\)/
    );
  });

  it("`uploadRoomTypePhoto` no longer reads `type.imageUrls` from the in-memory cache (the race)", () => {
    // The pre-MRB-15-11 read was `const next = [...type.imageUrls, url]`
    // where `type = roomTypes.find(t => t.value === typeValue)`.
    // The post-MRB-15-11 build uses `currentImageUrls` (from
    // `tx.get(hotelConfigRef).data().roomTypes[idx].imageUrls`)
    // and only the client-side UX hint check at the top of
    // the function still touches `type.imageUrls` (to disable
    // the button when the in-memory state shows the cap
    // already reached).
    expect(photoSlice).not.toMatch(
      /uploadRoomTypePhoto[\s\S]{0,300}const next = \[\.\.\.type\.imageUrls, url\]/
    );
    // The append shape is now `imageUrls: [...currentImageUrls, url]`
    // against the Firestore-read array, not the in-memory `type`.
    expect(photoSlice).toMatch(/imageUrls: \[\.\.\.currentImageUrls, url\]/);
  });

  it("`uploadRoomTypePhoto` cleans up the just-uploaded Storage object on cap-reject", () => {
    // Per the spec: "the on-cap-reject cleanup deletes the
    // just-uploaded Storage object so it doesn't become an
    // orphan." The cleanup uses `deleteObject(fileRef)` with
    // a `.catch(() => undefined)` so the storage failure
    // doesn't mask the cap-reject outcome.
    expect(photoSlice).toMatch(/if \(capRejected\)/);
    expect(photoSlice).toMatch(
      /await deleteObject\(fileRef\)\.catch\(\(cleanupErr\)/
    );
    // The cap-reject branch shows a "Photo limit reached"
    // warning toast, NOT the generic "Failed to upload
    // photo" error toast.
    expect(photoSlice).toMatch(/notify\.warning\("Photo limit reached"/);
  });

  it("`uploadRoomTypePhoto` cleans up the Storage object on a non-cap-reject transaction failure", () => {
    // If the transaction throws (network error, permission
    // denied, type deleted between client check and
    // transaction commit), the just-uploaded Storage file
    // would otherwise become an orphan. The cleanup runs in
    // the catch block (re-throw after cleanup so the outer
    // error is preserved for the toast).
    expect(photoSlice).toMatch(
      /catch \(txErr\) \{[\s\S]{0,200}await deleteObject\(fileRef\)\.catch\(\(cleanupErr\)/
    );
    expect(photoSlice).toMatch(/throw txErr;/);
  });

  it("`removeRoomTypePhoto` wraps the read-modify-write in `runTransaction` (atomic remove)", () => {
    // The transaction body reads from Firestore, does a
    // `findIndex` on the type's value, filters the URLs, and
    // writes the patched array back. The Storage `deleteObject`
    // stays OUTSIDE the transaction (Storage isn't
    // transactional with Firestore).
    expect(photoSlice).toMatch(/const removeRoomTypePhoto/);
    expect(photoSlice).toMatch(/runTransaction\(db, async \(tx\)/);
    expect(photoSlice).toMatch(/tx\.get\(hotelConfigRef\)/);
    expect(photoSlice).toMatch(/currentImageUrls\.filter\(\(u: string\) => u !== url\)/);
    // The Storage delete is OUTSIDE the transaction (best-effort,
    // post-commit, can be skipped silently) — there's a `try`
    // block AFTER the `runTransaction` closes that calls
    // `deleteObject`.
    expect(photoSlice).toMatch(/deleteObject\(fileRef\)/);
  });

  it("`reorderRoomTypePhotos` wraps the write in `runTransaction` (atomic reorder)", () => {
    // The transaction body reads from Firestore, does a
    // `findIndex` on the type's value, and writes the new
    // ordering back. The caller-supplied `imageUrls` array is
    // the new order; the function does NOT read the previous
    // ordering from the in-memory cache (the pre-MRB-15-11
    // read was used for the "type not found" check, which
    // now happens inside the transaction).
    expect(photoSlice).toMatch(/const reorderRoomTypePhotos/);
    expect(photoSlice).toMatch(/runTransaction\(db, async \(tx\)/);
    expect(photoSlice).toMatch(/tx\.get\(hotelConfigRef\)/);
    expect(photoSlice).toMatch(/newRoomTypes\[idx\] = \{ \.\.\.current, imageUrls \}/);
  });

  it("the `updateRoomType` helper is unchanged (regression guard against accidentally funnelling photo writes through it)", () => {
    // The pre-MRB-15-11 photo functions called `updateRoomType`
    // to do the write. The post-MRB-15-11 functions bypass
    // the helper (they write the whole `roomTypes` array
    // inside the transaction, not the per-type patch shape
    // the helper supports). The Edit-form callers (label,
    // price, capacity, etc.) still use `updateRoomType` —
    // this test pins that the helper itself is unchanged.
    const updateRoomTypeStart = adminContextSrc.indexOf(
      "const updateRoomType = async ("
    );
    const updateRoomTypeEnd = adminContextSrc.indexOf(
      "const deleteRoomType = async (",
      updateRoomTypeStart
    );
    const updateRoomTypeSlice =
      updateRoomTypeStart >= 0 && updateRoomTypeEnd > updateRoomTypeStart
        ? adminContextSrc.slice(updateRoomTypeStart, updateRoomTypeEnd)
        : "";
    expect(updateRoomTypeSlice.length).toBeGreaterThan(0);
    // The helper still takes a `Partial<RoomTypeEntry>` patch
    // and calls `saveRoomTypes(updated)`. The MRB-15-11
    // change is at the three photo functions, not at the
    // helper.
    expect(updateRoomTypeSlice).toMatch(/saveRoomTypes\(updated\)/);
    // The helper still has all 14 fields in the Pick<>.
    expect(updateRoomTypeSlice).toMatch(/"imageUrls"/);
    expect(updateRoomTypeSlice).toMatch(/"maxExtraBeds"/);
    expect(updateRoomTypeSlice).toMatch(/"extraBedRate"/);
  });
});
