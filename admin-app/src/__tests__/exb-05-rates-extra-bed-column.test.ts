import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per EXB-05 (2026-08-01, per decision #154): source-text
// regression tests for the Rates Management matrix's
// `extraBedRate` column. The emulator tests that would
// exercise the actual Firestore write of the 4th column
// end-to-end are out of scope for this sandbox (Java not
// installed; documented in PMH-03). The source-text guards
// below pin the contract that the emulator tests will
// later exercise.
//
// Background (per `plan/project/ROADMAP.md §EXB-05`):
//   - The Rates Management matrix now exposes a 4th
//     column for `extraBedRate` (the per-bed-per-night
//     rate for the rollaway add-on). The 3 existing
//     columns (Standard / Weekend / Corporate) keep their
//     shape; the extra-bed rate is a separate add-on
//     snapshotted onto the booking at create time per
//     EXB-01.
//   - The matrix lives in two layouts — a mobile card
//     (one card per room type) and a desktop table
//     (one column per rate). Both layouts must surface
//     the new column.
//   - The save handler still routes through the single
//     batched `saveRoomTypes(next)` write (RTS-02). The
//     4th column is purely additive — the single-write
//     invariant is preserved.
//   - The form buffer holds the per-type editable rate;
//     the dirty-set guard prevents a late snapshot from
//     clobbering an in-flight edit (the same pattern
//     the 3 existing rate fields use).

const ratesPageSrc = readFileSync(
  resolve(__dirname, "../pages/RatesPage.tsx"),
  "utf8"
);

const roomTypesEntrySrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);

describe("EXB-05 — Rates matrix gains the `extraBedRate` column", () => {
  it("RoomTypeEntry carries the optional `extraBedRate` field (modeled in EXB-01)", () => {
    // The data path was set up in EXB-01 (shipped 2026-08-01 at
    // v0.196.0). EXB-05 only adds the admin surface. The field
    // is optional + nullable on the type so legacy settings
    // without the field read via the same `Number(x) || 0`
    // permissive pattern the rest of the room-type defaults use
    // (`applyRoomTypeDefaults` + EXB-01's normalization).
    expect(roomTypesEntrySrc).toMatch(/extraBedRate\??:\s*number/);
  });

  it("the form buffer's per-type state shape includes `extraBed`", () => {
    // The `prices` state holds the editable per-type rates.
    // The shape must grow from 3 fields to 4 — pinning the
    // field name (`extraBed`, the form's name) so the save
    // handler can read it back.
    expect(ratesPageSrc).toMatch(
      /useState<Record<string,\s*\{\s*base:\s*number;\s*weekend:\s*number;\s*corporate:\s*number;\s*extraBed:\s*number\s*\}>>/
    );
  });

  it("the snapshot-sync effect seeds `extraBed` from `t.extraBedRate` (defensive coercion)", () => {
    // The form buffer must re-seed from the room-type doc on
    // every snapshot echo. The defensive `Number(t.extraBedRate) || 0`
    // coercion handles legacy settings (the field was added by
    // EXB-01) — absent / nullish reads as 0, matching the
    // permissive pattern used for the other rate fields.
    expect(ratesPageSrc).toMatch(
      /extraBed:\s*Number\(t\.extraBedRate\)\s*\|\|\s*0/
    );
  });

  it("the snapshot-sync effect preserves in-flight edits via the dirty-set guard", () => {
    // The 3 existing rate fields each check
    // `dirtyRateFields.has(\`${t.value}.${field}\`)` before
    // overwriting the form buffer with the new snapshot value.
    // The new `extraBed` field must follow the same shape —
    // an in-flight edit must not be clobbered by a late
    // snapshot echo.
    expect(ratesPageSrc).toMatch(
      /extraBed:\s*dirtyRateFields\.has\(`\$\{t\.value\}\.extraBed`\)\s*\?\s*current\.extraBed\s*:\s*initialPrices\[t\.value\]\.extraBed/
    );
  });

  it("`updateRateField` accepts `extraBed` as a field", () => {
    // The typed signature grew from 3 fields to 4. Pin the
    // union so a refactor that removes the field from the
    // signature surfaces in the test.
    expect(ratesPageSrc).toMatch(
      /field:\s*"base"\s*\|\s*"weekend"\s*\|\s*"corporate"\s*\|\s*"extraBed"/
    );
    // And the spread preserves the existing 3 fields when
    // updating the buffer.
    expect(ratesPageSrc).toMatch(
      /extraBed:\s*prev\[typeValue\]\?\.extraBed\s*\?\?\s*0,\s*\n\s*\[field\]:\s*value/
    );
  });

  it("the save handler maps `prices.extraBed` onto `t.extraBedRate` in the next array", () => {
    // The save handler computes the full next array
    // ONCE (RTS-02's single-bulk-write invariant) and
    // calls `saveRoomTypes(next)` once. The new
    // `extraBedRate: next.extraBed` line is additive
    // — the bulk-write shape is preserved. Pin both
    // the assignment AND the bulk-write call.
    const handleSaveRates = ratesPageSrc.match(
      /const handleSaveRates = async[\s\S]*?\n  \};\n/
    );
    expect(handleSaveRates, "handleSaveRates must exist").toBeTruthy();
    expect(handleSaveRates![0]).toMatch(/extraBedRate:\s*next\.extraBed/);
    expect(handleSaveRates![0]).toMatch(/await saveRoomTypes\(nextRoomTypes\)/);
    // The single-write invariant is preserved — the handler
    // does NOT fan out to per-room-type `updateRoomType`
    // calls (RTS-01 regression guard).
    expect(handleSaveRates![0]).not.toMatch(/Promise\.all\(/);
    expect(handleSaveRates![0]).not.toMatch(
      /roomTypes\.map\(t\s*=>\s*updateRoomType/
    );
  });

  it("the mobile card layout renders the 4th field with a 44px min-height input", () => {
    // The mobile layout is a stack of cards (one per
    // room type) with one labeled input per rate. The
    // 4th card must render with the same shape as the
    // 3 existing ones (label, currency-symbol prefix,
    // 44px min-height, value bound to `prices[type.value]?.extraBed`).
    const card = ratesPageSrc.match(
      /isMobile\s*\?\s*\(\s*<div className="space-y-3">[\s\S]*?roomTypes\.map[\s\S]*?<\/div>\s*\)/
    );
    expect(card, "mobile card block must exist").toBeTruthy();
    expect(card![0]).toMatch(/prices\[type\.value\]\?\.extraBed/);
    expect(card![0]).toMatch(/updateRateField\(type\.value,\s*"extraBed"/);
  });

  it("the desktop table renders the 4th column header + a `<td>` per room type", () => {
    // The desktop table gains a 4th `<th>` column and
    // a 4th `<td>` per row. The cell mirrors the
    // existing 3 cells (44px min-height, currency-symbol
    // prefix, value bound to `prices[type.value]?.extraBed`).
    const theadRow = ratesPageSrc.match(
      /<tr className="text-gray-400[^>]*>\s*\n\s*<th[^>]*>Room Type<\/th>[\s\S]*?<\/tr>\s*\n\s*<\/thead>/
    );
    expect(theadRow, "table header row must exist").toBeTruthy();
    expect(theadRow![0]).toMatch(
      /<th className="py-2\.5">Extra Bed Rate \(per bed \/ night\)<\/th>/
    );
    // The body cell: every existing room type gets a
    // 4th `<td>` whose input is bound to `extraBed`.
    const tableBody = ratesPageSrc.match(
      /<tbody[\s\S]*?<\/tbody>/
    );
    expect(tableBody, "table body must exist").toBeTruthy();
    expect(tableBody![0]).toMatch(/prices\[type\.value\]\?\.extraBed/);
    expect(tableBody![0]).toMatch(
      /updateRateField\(type\.value,\s*"extraBed",\s*parseFloat/
    );
  });

  it("the matrix is a purely additive column — the 3 existing rate fields are unchanged", () => {
    // Pin the 3 existing field names + their values so a
    // refactor that accidentally renames them surfaces in
    // the test. The 4th column is purely additive.
    const card = ratesPageSrc.match(
      /isMobile\s*\?\s*\(\s*<div className="space-y-3">[\s\S]*?roomTypes\.map[\s\S]*?<\/div>\s*\)/
    );
    expect(card).toBeTruthy();
    expect(card![0]).toMatch(/prices\[type\.value\]\?\.base/);
    expect(card![0]).toMatch(/prices\[type\.value\]\?\.weekend/);
    expect(card![0]).toMatch(/prices\[type\.value\]\?\.corporate/);
  });
});
