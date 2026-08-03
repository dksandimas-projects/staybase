import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for RTS-01 / RTS-02 / RTS-04 — Rates matrix save +
// saveRoomTypes failure semantics.
//
// Background (per `plan/project/ROADMAP.md §RTS-01..07`):
//   - RTS-01: `handleSaveRates` used to fire N concurrent `updateRoomType`
//     calls; each one read the same render-time `roomTypes` snapshot and
//     wrote the entire array back via `setDoc(..., { merge: true })`.
//     Merge of an array field replaces it wholesale, so the last write
//     to land won and every other room type's edit was silently dropped.
//     Symptom: "Rates saved" toast + values snap back on the next
//     snapshot echo.
//   - RTS-02: fix is a single batched `saveRoomTypes(next)` call with the
//     fully-computed next array — one write, no race.
//   - RTS-04: the previous `saveRoomTypes` swallowed the failure of
//     `updateSettings` (which catches + toasts + returns `false`) and
//     never rolled back the optimistic `setRoomTypes` call, so a failed
//     write looked successful. The fix throws on failure and rolls back
//     the optimistic state.
//
// These tests are source-text assertions (the 930-test pattern) — they
// pin the contract that PMH-03's behavioural emulator tests will later
// exercise end-to-end. They guard the four most common regressions:
//   1. The fan-out returns. If anyone re-introduces `Promise.all(...map(updateRoomType))`
//      in handleSaveRates, the test fails.
//   2. The call site uses the bulk API.
//   3. saveRoomTypes throws on a failed write.
//   4. saveRoomTypes rolls back the optimistic state on failure.

const ratesPageSrc = readFileSync(
  resolve(__dirname, "../pages/RatesPage.tsx"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

describe("RTS-02 — handleSaveRates writes once, not N times", () => {
  it("does not fan out per-room-type writes", () => {
    // The old shape was: `roomTypes.map(t => updateRoomType(t.value, {...}))`
    // inside a `Promise.all`. The fix computes the full next array and
    // calls `saveRoomTypes` once.
    const handleSaveRates = ratesPageSrc.match(
      /const handleSaveRates = async[\s\S]*?\n  \};\n/
    );
    expect(handleSaveRates, "handleSaveRates must exist").toBeTruthy();
    expect(handleSaveRates![0]).not.toMatch(/Promise\.all\(/);
    expect(handleSaveRates![0]).not.toMatch(/roomTypes\.map\(t\s*=>\s*updateRoomType/);
  });

  it("computes the next array and calls saveRoomTypes once", () => {
    const handleSaveRates = ratesPageSrc.match(
      /const handleSaveRates = async[\s\S]*?\n  \};\n/
    )![0];
    expect(handleSaveRates).toMatch(/const nextRoomTypes = roomTypes\.map/);
    expect(handleSaveRates).toMatch(/await saveRoomTypes\(nextRoomTypes\)/);
  });

  it("destroys saveRoomTypes from the admin context", () => {
    expect(ratesPageSrc).toMatch(/saveRoomTypes,?\s*\n\s*roomTypes,/);
  });
});

describe("RTS-04 — saveRoomTypes throws and rolls back on a failed write", () => {
  it("captures the prior roomTypes before the optimistic setState", () => {
    const saveRoomTypesBody = adminContextSrc.match(
      /const saveRoomTypes = async[\s\S]*?\n  \};\n/
    );
    expect(saveRoomTypesBody, "saveRoomTypes must exist").toBeTruthy();
    expect(saveRoomTypesBody![0]).toMatch(/const previousTypes = roomTypes/);
    expect(saveRoomTypesBody![0]).toMatch(/setRoomTypes\(newTypes\)/);
  });

  it("checks the boolean return of updateSettings and throws on false", () => {
    const saveRoomTypesBody = adminContextSrc.match(
      /const saveRoomTypes = async[\s\S]*?\n  \};\n/
    )![0];
    // Old code: `await updateSettings(...)` with no check.
    // New code: `const success = await updateSettings(...)` followed by
    // a `if (!success)` branch that throws.
    expect(saveRoomTypesBody).toMatch(/const success = await updateSettings\(/);
    expect(saveRoomTypesBody).toMatch(/if \(!success\)/);
    expect(saveRoomTypesBody).toMatch(/throw new Error\(/);
  });

  it("rolls back the optimistic state on the failure path", () => {
    const saveRoomTypesBody = adminContextSrc.match(
      /const saveRoomTypes = async[\s\S]*?\n  \};\n/
    )![0];
    // Both the `if (!success)` branch and the outer `catch` must call
    // `setRoomTypes(previousTypes)`. A single rollback site is fine; the
    // requirement is that any path that throws also restores the prior
    // state.
    const rollbackCount = (saveRoomTypesBody.match(/setRoomTypes\(previousTypes\)/g) || []).length;
    expect(rollbackCount).toBeGreaterThanOrEqual(2);
  });

  it("exposes saveRoomTypes on the context interface and the context value", () => {
    // The fix only works if callers can actually call saveRoomTypes —
    // confirm both the type interface and the value destructure expose it.
    const interfaceMatch = adminContextSrc.match(
      /saveRoomTypes:\s*\(types:\s*RoomTypeEntry\[\]\)\s*=>\s*Promise<void>/
    );
    expect(interfaceMatch, "context interface must declare saveRoomTypes").toBeTruthy();
    // And the value object that ships to consumers must include it.
    const valueAfterDelete = adminContextSrc.match(
      /deleteRoomType,\s*\n\s*saveRoomTypes,/
    );
    expect(valueAfterDelete, "context value must expose saveRoomTypes").toBeTruthy();
  });
});

describe("RTS-01 — no other fan-out sites write the same array field concurrently", () => {
  // Per RTS-07: never fan out per-item writes to a single Firestore array
  // field. Audit the two callers of updateRoomType that previously sat
  // outside the dangerous shape (`uploadRoomTypePhoto` /
  // `removeRoomTypePhoto` / `reorderRoomTypePhotos` are singly-called)
  // and confirm they have not regressed into a Promise.all fan-out.
  it("uploadRoomTypePhoto still calls updateRoomType singly", () => {
    const uploadFn = adminContextSrc.match(
      /const uploadRoomTypePhoto = async[\s\S]*?\n  \};\n/
    );
    expect(uploadFn).toBeTruthy();
    // The call site must be `await updateRoomType(typeValue, { imageUrls: next })`,
    // not wrapped in a `Promise.all`.
    expect(uploadFn![0]).toMatch(/await updateRoomType\(typeValue, \{ imageUrls: next \}\)/);
    expect(uploadFn![0]).not.toMatch(/Promise\.all\([^)]*updateRoomType/);
  });
});
