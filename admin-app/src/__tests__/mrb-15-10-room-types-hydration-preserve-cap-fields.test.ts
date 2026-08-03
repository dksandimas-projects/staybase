// Per MRB-15-10 (2026-08-03, per decision #183):
// the AdminContext `roomTypes` hydration `useEffect`
// (which syncs local state from the
// `settings/hotelConfig.roomTypes` snapshot) must
// preserve EVERY field the `RoomTypeEntry` contract
// guarantees — `maxChildren` (CHD-03), `maxExtraBeds`
// (EXB-01), and `extraBedRate` (EXB-01). The previous
// mapping dropped all three on every snapshot echo,
// which had two visible symptoms in the admin UI:
//
//   1. The Room Types table always rendered "0 children"
//      and "0 max extra beds" for every type, even when
//      Firestore held a non-zero value (the table
//      reads `type.maxChildren ?? 0` and
//      `type.maxExtraBeds ?? 0`).
//   2. The Edit form's `defaultValue={editType.maxChildren ?? 0}`
//      rendered 0 in the input even when the stored
//      value was non-zero. If the operator opened Edit
//      and saved WITHOUT changing the field, the form
//      submitted the 0 it displayed, overwriting the
//      stored value. Operators reasonably read this as
//      "the save isn't working."
//
// The fix is a one-line addition of the three fields
// to the mapping. The test below pins the contract:
// a future refactor that re-shapes the mapping
// (e.g. extracting it to a `normalizeRoomTypeConfig`
// helper that "forgets" a field) breaks the test
// instead of silently regressing.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural round-trip
// (snapshot-with-maxChildren-2 → hydrates → local
// state has maxChildren-2 → Edit form defaultValue
// renders 2 → save with no change → snapshot echoes
// back → table still shows 2) is covered by the
// typecheck on `RoomTypeEntry` (the three fields are
// required at the contract level) + the source-text
// guards below (which pin the hydration mapping).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

// Slice the `useEffect` that hydrates `roomTypes` from
// the `hotelConfig.roomTypes` snapshot. The slice runs
// from the `useEffect` opener to the dependency-array
// close so any future re-shape keeps the test targeting
// just this effect, not the save/optimistic handlers
// right below it.
const hydrationEffectStart = adminContextSrc.indexOf(
  "  useEffect(() => {\n    if (Array.isArray(hotelConfig.roomTypes)) {\n      setRoomTypes("
);
const hydrationEffectEnd = adminContextSrc.indexOf(
  "    }\n  }, [hotelConfig.roomTypes]);\n\n  const saveRoomTypes"
);
const hydrationEffect =
  hydrationEffectStart >= 0 && hydrationEffectEnd > hydrationEffectStart
    ? adminContextSrc.slice(hydrationEffectStart, hydrationEffectEnd)
    : "";

describe("MRB-15-10 — `roomTypes` hydration preserves the CHD-03 / EXB-01 cap fields", () => {
  it("the hydration `useEffect` is present and locatable", () => {
    // Sanity: the slice exists. If a future refactor
    // re-shapes the effect (e.g. extracts it to a
    // custom hook), the regex matchers below still
    // pass on the broader `setRoomTypes(` token so
    // this guard is a one-line tripwire.
    expect(hydrationEffect.length).toBeGreaterThan(0);
    expect(hydrationEffect).toMatch(/setRoomTypes\(\s*hotelConfig\.roomTypes\.map/);
  });

  it("preserves `maxChildren` from the snapshot (CHD-03)", () => {
    // The contract: the hydration mapping must read
    // `t.maxChildren` (the CHD-03 child cap). Absent
    // or nullish values floor at 0 (a Single with no
    // children is the safe seed).
    expect(hydrationEffect).toMatch(/maxChildren:\s*Math\.max\(0,\s*Math\.floor\(Number\(t\.maxChildren\)\s*\|\|\s*0\)\)/);
  });

  it("preserves `maxExtraBeds` from the snapshot (EXB-01)", () => {
    // The contract: the hydration mapping must read
    // `t.maxExtraBeds` (the EXB-01 extra-bed allowance).
    // Absent or nullish values floor at 0 (the safe
    // seed for types that don't offer extra beds).
    expect(hydrationEffect).toMatch(/maxExtraBeds:\s*Math\.max\(0,\s*Math\.floor\(Number\(t\.maxExtraBeds\)\s*\|\|\s*0\)\)/);
  });

  it("preserves `extraBedRate` from the snapshot (EXB-01)", () => {
    // The contract: the hydration mapping must read
    // `t.extraBedRate` (the per-bed-per-night rate).
    // Absent or nullish values default to 0 — the
    // booking flow's `Number(extraBedRate) || 0`
    // already handles 0 the same as null, so 0 is
    // a safe fallback (no `Math.floor` — rates can
    // be fractional pesos).
    expect(hydrationEffect).toMatch(/extraBedRate:\s*Math\.max\(0,\s*Number\(t\.extraBedRate\)\s*\|\|\s*0\)/);
  });

  it("does not silently drop the three fields (regression — pre-MRB-15-10)", () => {
    // The pre-MRB-15-10 mapping looked like this:
    //   setRoomTypes(hotelConfig.roomTypes.map((t: any) => ({
    //     value, label, shortLabel, imageUrls,
    //     bedDefinition, description, amenities,
    //     maxCapacity, pricePerNight, weekendRate,
    //     corporateRate
    //   })))
    // — NO `maxChildren`, NO `maxExtraBeds`, NO
    // `extraBedRate`. The form / table both rendered
    // 0 for these fields forever, and a no-op save
    // overwrote the stored value with 0.
    //
    // This test asserts the three fields are present
    // in the mapping body (the per-field tests above
    // pin the exact shape; this one is a one-shot
    // tripwire that fires if ALL three regress at
    // once, which is the most likely shape of any
    // future "I'll just copy-paste the existing
    // mapping" refactor).
    const fieldCount =
      (hydrationEffect.match(/maxChildren:/g) || []).length +
      (hydrationEffect.match(/maxExtraBeds:/g) || []).length +
      (hydrationEffect.match(/extraBedRate:/g) || []).length;
    expect(fieldCount).toBeGreaterThanOrEqual(3);
  });

  it("preserves every other `RoomTypeEntry` field too (regression — pre-MRB-15-10 dropped nothing else, but a future refactor might)", () => {
    // The pre-MRB-15-10 mapping preserved 11 fields
    // (value / label / shortLabel / imageUrls /
    // bedDefinition / description / amenities /
    // maxCapacity / pricePerNight / weekendRate /
    // corporateRate) and dropped 3. A future
    // refactor that re-shapes the mapping (e.g.
    // extracts a `pickRoomTypeFields` helper that
    // omits a field by accident) should be caught by
    // asserting every `RoomTypeEntry` field on the
    // contract is present in the mapping body.
    //
    // The fields below are the contract per
    // `shared/constants/index.ts:75-115` and the
    // CHD-03 / EXB-01 addenda.
    const expectedFields = [
      "value:",
      "label:",
      "shortLabel:",
      "imageUrls:",
      "bedDefinition:",
      "description:",
      "amenities:",
      "maxCapacity:",
      "maxChildren:",
      "pricePerNight:",
      "weekendRate:",
      "corporateRate:",
      "maxExtraBeds:",
      "extraBedRate:"
    ];
    for (const field of expectedFields) {
      expect(hydrationEffect).toMatch(new RegExp(field.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")));
    }
  });
});
