// MBUX-04 — admin-managed breakfast meal photos.
//
// Phase 15 / decision #256. Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Admin Breakfast Meal Photos`.
//
// SCOPE: the contract + admin controls only. The guest-side rendering
// (the Step 2 menu strip and its no-image fallback) is MBUX-05 and is
// deliberately NOT asserted here — a test that pinned guest markup
// before that slice shipped would just be a guess.
//
// The BEHAVIOURAL half of this feature — what the public normalizer
// accepts, drops, and rejects — lives in
// `shared/__tests__/breakfast-meal-image.test.ts`, where it can be
// asserted against real input rather than a regex.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const storageRules = read("firebase/storage.rules");
const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const settingsPageSrc = read("admin-app/src/pages/SettingsPage.tsx");
const bookingSchemaSrc = read("shared/schemas/booking.ts");
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

describe("MBUX-04 — Firebase Storage policy", () => {
  it("scopes the path per meal so a replace cannot hit another meal's object", () => {
    expect(storageRules).toMatch(
      /match \/breakfast-meals\/\{mealId\}\/\{fileName\} \{/
    );
  });

  it("is public-read (the guest menu strip renders it inline)", () => {
    const block = storageRules.slice(
      storageRules.indexOf("match /breakfast-meals/"),
      storageRules.indexOf("match /store-items/")
    );
    expect(block).toMatch(/allow read: if true;/);
  });

  it("is staff-write only (only authorized hotel staff upload or replace)", () => {
    const block = storageRules.slice(
      storageRules.indexOf("match /breakfast-meals/"),
      storageRules.indexOf("match /store-items/")
    );
    expect(block).toMatch(/allow write: if isStaff\(\);/);
    // Never an unauthenticated write.
    expect(block).not.toMatch(/allow write: if true;/);
  });

  it("reuses the shared `isStaff()` helper rather than a bespoke check", () => {
    const block = storageRules.slice(
      storageRules.indexOf("match /breakfast-meals/"),
      storageRules.indexOf("match /store-items/")
    );
    expect(block).toContain("isStaff()");
  });
});

describe("MBUX-04 — admin upload path", () => {
  it("uploads to the predictable per-hotel/per-meal folder", () => {
    expect(adminContextSrc).toMatch(
      /storageRef\(storage, `breakfast-meals\/\$\{mealId\}\/\$\{Date\.now\(\)\}-\$\{safeName\}`\)/
    );
  });

  it("compresses before upload, re-encoding to JPEG at the spec's budget", () => {
    expect(adminContextSrc).toMatch(/compressImageFile\(file, \{\s*maxWidth: 1200,\s*maxHeight: 1200,\s*quality: 0\.82/);
  });

  it("restricts accepted formats to the spec's JPEG / PNG / WebP list", () => {
    expect(adminContextSrc).toMatch(/BREAKFAST_MEAL_IMAGE_ACCEPTED_TYPES\.includes\(file\.type\)/);
  });

  it("enforces a pre-compression size ceiling", () => {
    expect(adminContextSrc).toMatch(/file\.size > MAX_BREAKFAST_MEAL_IMAGE_BYTES/);
  });

  it("does NOT write Firestore itself — the Settings save path owns the catalog row", () => {
    // A second writer for the catalog row could bypass
    // `BreakfastConfigSchema` entirely.
    const fn = adminContextSrc.slice(
      adminContextSrc.indexOf("const uploadBreakfastMealImage = async ("),
      adminContextSrc.indexOf("const removeBreakfastMealImage = async (")
    );
    expect(fn).not.toMatch(/updateSettings\(/);
    expect(fn).not.toMatch(/setDoc\(|updateDoc\(/);
  });

  it("returns the new URL to the caller instead", () => {
    const fn = adminContextSrc.slice(
      adminContextSrc.indexOf("const uploadBreakfastMealImage = async ("),
      adminContextSrc.indexOf("const removeBreakfastMealImage = async (")
    );
    expect(fn).toMatch(/return \{ success: true, url \}/);
  });

  it("swallows a Storage delete failure — an orphan is a nit, not a broken path", () => {
    const fn = adminContextSrc.slice(
      adminContextSrc.indexOf("const removeBreakfastMealImage = async ("),
      adminContextSrc.indexOf("const uploadPaymentMethodQr = async (")
    );
    expect(fn).toMatch(/console\.warn\(/);
  });
});

describe("MBUX-04 — the editor wires upload / preview / replace / remove", () => {
  it("offers all four operations plus per-row upload state", () => {
    expect(settingsPageSrc).toMatch(/data-testid=\{`breakfast-meal-image-\$\{meal\.id\}`\}/);
    expect(settingsPageSrc).toMatch(/uploadingMealImageIds\.has\(meal\.id\)/);
    expect(settingsPageSrc).toMatch(/data-testid=\{`breakfast-meal-image-input-\$\{meal\.id\}`\}/);
    expect(settingsPageSrc).toMatch(/data-testid=\{`breakfast-meal-image-remove-\$\{meal\.id\}`\}/);
  });

  it("restricts the file input's accept list to the supported formats", () => {
    expect(settingsPageSrc).toMatch(/accept="image\/jpeg,image\/png,image\/webp"/);
  });

  it("renders a consistent 4:3 crop for the preview", () => {
    expect(settingsPageSrc).toMatch(/aspectRatio: "4 \/ 3"/);
  });

  it("shows a no-image placeholder instead of a broken <img>", () => {
    expect(settingsPageSrc).toMatch(/No image/);
  });

  it("resets the file input so re-picking the SAME file fires change again", () => {
    // Without this, "replace" silently no-ops when an admin re-selects
    // the identical file after a failed compression step — the input's
    // value never changed, so no change event fires.
    expect(settingsPageSrc).toMatch(/e\.target\.value = "";/);
  });

  it("uploads BEFORE repointing the row, and deletes the old object AFTER", () => {
    // Reversing either step can leave the guest menu strip pointing at a
    // deleted file — a broken image in front of a paying guest.
    const fn = settingsPageSrc.slice(
      settingsPageSrc.indexOf("const handleUploadBreakfastMealImage = async ("),
      settingsPageSrc.indexOf("const handleRemoveBreakfastMealImage = async (")
    );
    const uploadIdx = fn.indexOf("await uploadBreakfastMealImage(");
    const repointIdx = fn.indexOf("handleUpdateBreakfastMeal(mealId, { imageUrl: result.url })");
    const deleteIdx = fn.indexOf("removeBreakfastMealImage(mealId, previousUrl)");
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(repointIdx).toBeGreaterThan(uploadIdx);
    expect(deleteIdx).toBeGreaterThan(repointIdx);
  });

  it("clears the row before deleting the object on remove", () => {
    const fn = settingsPageSrc.slice(
      settingsPageSrc.indexOf("const handleRemoveBreakfastMealImage = async ("),
      settingsPageSrc.indexOf("const handleUpdateBreakfastMeal = (")
    );
    expect(fn.indexOf("handleUpdateBreakfastMeal(mealId, { imageUrl: undefined })")).toBeLessThan(
      fn.indexOf("await removeBreakfastMealImage(")
    );
  });

  it("uploads against the meal id, never the meal name", () => {
    // Names are editable free text; a renamed meal must not orphan or
    // overwrite another meal's images.
    expect(settingsPageSrc).toMatch(/handleUploadBreakfastMealImage\(meal\.id, e\.target\.files\?\.\[0\]\)/);
  });
});

describe("MBUX-04 — write schema and the snapshot invariant", () => {
  it("`BreakfastMealSchema` declares imageUrl — the strip that would silently delete it", () => {
    expect(bookingSchemaSrc).toMatch(/imageUrl: z\.string\(\)\.url\(\)\.max\(2000\)\.optional\(\)/);
  });

  it("the booking selection entry snapshots NO image field", () => {
    const entry = bookingPageSrc.slice(
      bookingPageSrc.indexOf("const nowIso = new Date().toISOString();"),
      bookingPageSrc.indexOf("const nowIso = new Date().toISOString();") + 700
    );
    expect(entry).toMatch(/mealId: meal\.id/);
    expect(entry).toMatch(/mealName: meal\.name/);
    expect(entry).toMatch(/price: meal\.price/);
    // The invariant: a catalog image edit can never rewrite the
    // appearance of a historical booking.
    expect(entry).not.toMatch(/imageUrl/);
  });
});