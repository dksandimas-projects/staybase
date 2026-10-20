// Per OCT-H5 (2026-10-20, decision #283): the deep strip of
// `undefined`-valued keys for Firestore writes.
//
// THE BUG
//
// The Firestore Web SDK's default `ignoreUndefinedProperties` is
// `false` and the admin app never sets it, so `parseScalarValue`
// THROWS on any `undefined`:
//
//   Unsupported field value: undefined
//
// Object spread copies own enumerable keys INCLUDING undefined-valued
// ones, so `{ ...meal, imageUrl: undefined }` produced an object
// that OWNED the `imageUrl` key with the value `undefined`. Zod's
// `.optional()` accepts that shape (it validates the VALUE, not the
// key's presence), so the bad payload passed schema validation and
// blew up at the SDK boundary.
//
// The failure mode was not scoped to the field that caused it: the
// offending key sat inside one element of the
// `breakfastConfig.meals` array, so EVERY subsequent write of that
// section failed. The admin could not save the cut-off time, the
// breakfast toggle, a meal name or a price — until they reloaded
// the page.

import { describe, expect, it } from "vitest";
import { stripUndefinedValues } from "../utils/firestorePayload";

describe("OCT-H5 — `stripUndefinedValues`", () => {
  it("removes an undefined-valued key", () => {
    const result = stripUndefinedValues({ a: 1, b: undefined, c: 3 });
    expect(result).toEqual({ a: 1, c: 3 });
    expect("b" in result).toBe(false);
  });

  it("preserves null — it is a legal Firestore value", () => {
    const result = stripUndefinedValues({ a: null });
    expect(result).toEqual({ a: null });
    expect("a" in result).toBe(true);
  });

  it("preserves 0, an empty string and false", () => {
    const result = stripUndefinedValues({ zero: 0, empty: "", no: false });
    expect(result).toEqual({ zero: 0, empty: "", no: false });
  });

  it("recurses into nested objects", () => {
    const result = stripUndefinedValues({
      outer: { keep: 1, drop: undefined },
      list: [{ keep: 2, drop: undefined }]
    });
    expect(result).toEqual({ outer: { keep: 1 }, list: [{ keep: 2 }] });
  });

  it("recurses into array elements (the meal-array case)", () => {
    // The exact OCT-H5 shape: one meal with a removed photo.
    const meals = [
      { id: "meal-1", name: "Continental", imageUrl: undefined },
      { id: "meal-2", name: "Filipino", imageUrl: "https://x/y.png" }
    ];
    const result = stripUndefinedValues({ meals });
    expect(result.meals[0]).toEqual({ id: "meal-1", name: "Continental" });
    expect("imageUrl" in result.meals[0]).toBe(false);
    expect(result.meals[1]).toEqual({
      id: "meal-2",
      name: "Filipino",
      imageUrl: "https://x/y.png"
    });
  });

  it("keeps array indices stable (an emptied element stays an element)", () => {
    const result = stripUndefinedValues([{ a: undefined }, { b: 2 }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({});
    expect(result[1]).toEqual({ b: 2 });
  });

  it("leaves a leaf value untouched", () => {
    const date = new Date("2026-10-20T00:00:00.000Z");
    const result = stripUndefinedValues({ date });
    expect(result.date).toBe(date);
  });

  it("does not walk into a class instance (a Firestore sentinel)", () => {
    // `deleteField()` / `serverTimestamp()` are class instances —
    // they are leaf values to Firestore and must survive intact.
    class Sentinel {
      readonly type = "sentinel";
      readonly value = 1;
    }
    const sentinel = new Sentinel();
    const result = stripUndefinedValues({ sentinel });
    expect(result.sentinel).toBe(sentinel);
  });

  it("handles a top-level undefined without throwing", () => {
    expect(stripUndefinedValues(undefined)).toBeUndefined();
  });

  it("handles a null-prototype object", () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.keep = 1;
    input.drop = undefined;
    const result = stripUndefinedValues(input);
    expect(result.keep).toBe(1);
    expect("drop" in result).toBe(false);
  });

  it("does not mutate the input", () => {
    const input = { a: 1, b: undefined };
    stripUndefinedValues(input);
    expect("b" in input).toBe(true);
  });
});
