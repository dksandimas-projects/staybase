// Per BR-08 (Phase 13 — Breakfast Redesign, decision #238,
// 2026-10-14 — close-out): tripwire tests that pin the
// legacy-shape deletions + the new-shape adoption at the
// shared-types / shared-helpers / build-version level.
//
// Source-text tripwires (mirrors the BR-05 / BR-07 admin-app
// + guest-app pattern): each `it` reads one or two files and
// asserts the absence of a legacy literal or the presence
// of a new-shape literal. No runtime dependency — these
// tests run in milliseconds and gate the close-out PR.
//
// The 13 tripwires below cover:
//   1.  `Booking.hasBreakfast: boolean` field is gone
//   2.  `Booking.breakfastRate: number` field is gone
//   3.  `Booking.breakfastIncludesChildren: boolean` field
//       is gone
//   4.  `BookingRoomCartItem.extraBedBreakfast: boolean`
//       field is gone
//   5.  `PublicRoomSelection` interface is deleted
//   6.  `DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT` const
//       is deleted
//   7.  `calculateBreakfastAddOn` helper is deleted
//   8.  `BreakfastAddOnInput` type is deleted
//   9.  `calculateBreakfastMealsTotal` is the new helper
//   10. `PriceInput` reads `breakfastTotal` (not the legacy
//       pair)
//   11. `bookingFolio` reads `breakfastTotal`
//   12. The reservation fingerprint reads
//       `breakfastSelections`
//   13. `shared/VERSION.ts` is `2.0.0` (the BR-08 release)
//
// The "absence" tripwires use a `NEW BAD-SHAPE WOULD:
// #BR-08 close-out` negation comment so any future
// regression lands with a search-friendly token.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const TYPES_PATH = path.resolve(__dirname, "../types/index.ts");
const CONSTANTS_PATH = path.resolve(__dirname, "../constants/index.ts");
const BOOKING_ADD_ONS_PATH = path.resolve(__dirname, "../utils/bookingAddOns.ts");
const PRICING_PATH = path.resolve(__dirname, "../utils/pricing.ts");
const BOOKING_FOLIO_PATH = path.resolve(__dirname, "../utils/bookingFolio.ts");
const FINGERPRINT_PATH = path.resolve(__dirname, "../utils/reservationFingerprint.ts");
const VERSION_PATH = path.resolve(__dirname, "../VERSION.ts");

function readFileSafe(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

// Strip every JSDoc block (`/** ... */`) + line comment
// (`// ...`) so the tripwires below target only code — the
// `@deprecated` audit-trail references in the JSDoc are
// preserved in source but must NOT count as a regression.
// The strip is regex-based (good enough for the legacy
// patterns we care about); the alternative (using a real
// TS compiler) would require bootstrapping the full TS
// toolchain, which is overkill for these tripwires.
function stripComments(source: string): string {
  return source
    // Block comments — `/* ... */` (greedy enough for our
    // single-line JSDoc tags + any nested `*` lines).
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Line comments — `// ...` to the line end.
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("BR-08 — Close-out tripwires (shared)", () => {
  it("1. Booking.hasBreakfast: boolean field is removed from the Booking interface", () => {
    const source = readFileSafe(TYPES_PATH);
    // The interface declares the field with a trailing
    // `;` (typed field) or optional `?:`. A `Boolean`
    // type annotation uniquely identifies the legacy
    // shape — `hasAnyBreakfast` (the new BR-01 gate)
    // is also a Boolean and we allow it through.
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `hasBreakfast: zod.boolean()` or
    //   `hasBreakfast: boolean`
    const hasBreakfastField = /\bhasBreakfast\s*[\?]?\s*:\s*zod\.boolean\(\)|\bhasBreakfast\s*[\?]?\s*:\s*boolean\b/;
    expect(stripComments(source)).not.toMatch(hasBreakfastField);
  });

  it("2. Booking.breakfastRate: number field is removed from the Booking interface", () => {
    const source = readFileSafe(TYPES_PATH);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `breakfastRate: zod.number()` or
    //   `breakfastRate: number`
    const breakfastRateField = /\bbreakfastRate\s*[\?]?\s*:\s*zod\.number\(\)|\bbreakfastRate\s*[\?]?\s*:\s*number\b/;
    expect(stripComments(source)).not.toMatch(breakfastRateField);
  });

  it("3. Booking.breakfastIncludesChildren: boolean field is removed", () => {
    const source = readFileSafe(TYPES_PATH);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `breakfastIncludesChildren: zod.boolean()` or
    //   `breakfastIncludesChildren: boolean`
    const breakfastIncludesChildrenField = /\bbreakfastIncludesChildren\s*[\?]?\s*:\s*zod\.boolean\(\)|\bbreakfastIncludesChildren\s*[\?]?\s*:\s*boolean\b/;
    expect(stripComments(source)).not.toMatch(breakfastIncludesChildrenField);
  });

  it("4. BookingRoomCartItem.extraBedBreakfast: boolean field is removed from the cart util", () => {
    // The cart util lives in the guest-app, so we grep
    // both the type file (where the per-room shape was
    // declared) AND the source file (where the field
    // was read on URL-round-trip). Either place would
    // be the regression site.
    const types = readFileSafe(TYPES_PATH);
    const cartUtil = fs.readFileSync(
      path.resolve(__dirname, "../../guest-app/src/utils/bookingRoomCart.ts"),
      "utf8"
    );
    const combined = `${types}\n${cartUtil}`;
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `extraBedBreakfast: zod.boolean()` or
    //   `extraBedBreakfast: boolean`
    const extraBedBreakfastField = /\bextraBedBreakfast\s*[\?]?\s*:\s*zod\.boolean\(\)|\bextraBedBreakfast\s*[\?]?\s*:\s*boolean\b/;
    expect(stripComments(combined)).not.toMatch(extraBedBreakfastField);
  });

  it("5. PublicRoomSelection interface is deleted (Step 1 carries no breakfast data)", () => {
    const source = readFileSafe(TYPES_PATH);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `interface PublicRoomSelection`
    expect(source).not.toMatch(/interface\s+PublicRoomSelection\b/);
  });

  it("6. DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT constant is deleted", () => {
    const source = readFileSafe(CONSTANTS_PATH);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT`
    expect(source).not.toMatch(/DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT/);
  });

  it("7. calculateBreakfastAddOn helper is deleted from shared/utils/bookingAddOns.ts", () => {
    const source = readFileSafe(BOOKING_ADD_ONS_PATH);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `export function calculateBreakfastAddOn`
    expect(source).not.toMatch(/export\s+function\s+calculateBreakfastAddOn\b/);
  });

  it("8. BreakfastAddOnInput type is deleted from shared/utils/bookingAddOns.ts", () => {
    const source = readFileSafe(BOOKING_ADD_ONS_PATH);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `export interface BreakfastAddOnInput`
    expect(source).not.toMatch(/export\s+interface\s+BreakfastAddOnInput\b/);
  });

  it("9. calculateBreakfastMealsTotal is the new breakfast-add-on helper", () => {
    const source = readFileSafe(BOOKING_ADD_ONS_PATH);
    // The post-BR-01 helper is exported from the
    // bookingAddOns surface so the legacy import path
    // (the 71 EXB-02 / CHD-10 test sites) still resolves
    // through the same module.
    expect(source).toMatch(/export\s+function\s+calculateBreakfastMealsTotal\b/);
    // And `recomputeBreakfastTotal` lives in its sibling
    // file `breakfastTotal.ts` — the close-out keeps
    // the two helpers in lockstep so the booking-create
    // path can swap one for the other without touching
    // call sites.
    const breakfastTotal = fs.readFileSync(
      path.resolve(__dirname, "../utils/breakfastTotal.ts"),
      "utf8"
    );
    expect(breakfastTotal).toMatch(/export\s+function\s+recomputeBreakfastTotal\b/);
  });

  it("10. shared/utils/pricing.ts reads `breakfastTotal` (not the legacy pair)", () => {
    const source = readFileSafe(PRICING_PATH);
    // The legacy helper read `breakfastRate` + checked
    // the gate via a ternary. The new helper is a single
    // `breakfastTotal` field on the PriceInput. Both
    // name appearances are required: the field literal
    // on the interface + the consumption in the math.
    expect(source).toMatch(/\bbreakfastTotal\?\s*:\s*number\b/);
    expect(source).toMatch(/Number\(input\.breakfastTotal\)/);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `input.breakfastRate` or `input.hasBreakfast`
    //   on the pricing surface
    expect(source).not.toMatch(/input\.breakfastRate\b/);
    expect(source).not.toMatch(/input\.hasBreakfast\b/);
  });

  it("11. shared/utils/bookingFolio.ts reads `breakfastTotal` for the folio split", () => {
    const source = readFileSafe(BOOKING_FOLIO_PATH);
    // Per BR-08 close-out: the folio split uses
    // `booking.breakfastTotal` (the denormalized field
    // the server stamps on every `breakfastSelections`
    // write). The legacy code read `breakfastRate * numGuests`
    // — both literals must be absent from the new helper.
    expect(source).toMatch(/\bbreakfastTotal\b/);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    expect(source).not.toMatch(/b\.breakfastRate\b/);
    expect(source).not.toMatch(/breakfastRate\s*\*\s*numGuests\b/);
  });

  it("12. shared/utils/reservationFingerprint.ts reads `breakfastSelections` (not `hasBreakfast`)", () => {
    const source = readFileSafe(FINGERPRINT_PATH);
    // The fingerprint normalizes the request shape for
    // idempotency. BR-01 switched it from a
    // `hasBreakfast: boolean` boolean pair to a
    // `breakfastSelections: Record<key, entry>` map.
    // Both shapes appear in JSDoc comments — the
    // assertion targets the canonical-name literal so
    // JSDoc references are allowed through.
    expect(source).toMatch(/breakfastSelections/);
    // NEW BAD-SHAPE WOULD: #BR-08 close-out
    //   `hasBreakfast: boolean` literal in the
    //   canonical-name shape (not the JSDoc
    //   `@deprecated` references — comment lines
    //   are stripped via `stripComments`).
    expect(stripComments(source)).not.toMatch(/hasBreakfast:\s*boolean\b/);
    expect(stripComments(source)).not.toMatch(/breakfastIncludesChildren:\s*boolean\b/);
  });

  it("13. shared/VERSION.ts is at or past the 2.0.0 BR-08 close-out release", () => {
    const source = readFileSafe(VERSION_PATH);
    // The post-BR-08 version is `2.0.0` — a MAJOR bump
    // for the data-model change (decision #238: the
    // legacy fields are deleted from the create path;
    // any out-of-tree code carrying the old shape
    // would fail at compile-time + run-time). Husky
    // auto-bumps via Conventional Commits, but BR-08
    // also bumps explicitly to lock the release tag.
    //
    // Asserted as a FLOOR, not an exact pin. This test used to
    // require the literal string "2.0.0", which meant it failed on
    // the very next `feat:`/`fix:`/`refactor:` commit — the
    // commit-msg hook bumps the minor/patch automatically, so an
    // exact-version assertion in a suite that runs on every commit
    // is guaranteed to break sooner or later and teaches everyone
    // to ignore red. What BR-08 actually needs to guarantee is that
    // the MAJOR cutover happened, i.e. the version is 2.x or higher
    // and nothing has rolled the data model back to 1.x.
    const match = source.match(/VERSION\s*=\s*["'](\d+)\.(\d+)\.(\d+)["']/);
    expect(match).not.toBeNull();
    const major = Number(match![1]);
    // The point of the floor: the 2.x MAJOR cutover has happened and
    // has not been rolled back. A deliberate future 3.x still passes.
    expect(major).toBeGreaterThanOrEqual(2);
  });
});
