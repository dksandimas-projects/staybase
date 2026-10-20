// Per OCT-H5 (2026-10-20, decision #283): a deep strip of
// `undefined`-valued keys for Firestore writes.
//
// WHY THIS EXISTS
//
// The Firestore Web SDK's default `ignoreUndefinedProperties` is
// `false`, and the admin app never sets it (0 hits repo-wide). That
// means `parseScalarValue` THROWS on any `undefined` it encounters:
//
//   Unsupported field value: undefined
//
// Object spread copies own enumerable keys INCLUDING undefined-valued
// ones, so `{ ...meal, imageUrl: undefined }` produces an object that
// OWNS the `imageUrl` key with the value `undefined`. Zod's
// `.optional()` accepts that shape (it validates the VALUE, not the
// key's presence), so the bad payload sailed through schema
// validation and blew up at the SDK boundary instead.
//
// The failure mode is nasty because it is not scoped to the field
// that caused it: the offending key sits inside a larger payload
// (here, one element of the `breakfastConfig.meals` array), so EVERY
// subsequent write of that section fails — the admin could not save
// the cut-off time, the breakfast toggle, a meal name or a price
// until they reloaded the page.
//
// WHAT THIS DOES
//
// Recursively removes keys whose value is `undefined` from plain
// objects and arrays. Firestore cannot represent `undefined` at all,
// so stripping it can only turn a hard write failure into a
// successful write — it never changes the meaning of a valid
// payload.
//
// IMPORTANT: stripping is NOT the same as deleting. If a field must
// be REMOVED from an existing document, use Firestore's
// `deleteField()` sentinel (or, for an array element, omit the key
// from the element itself and rewrite the whole array) — a stripped
// `undefined` leaves the previously-stored value in place.
//
// `null` is PRESERVED. `null` is a legitimate Firestore value and is
// meaningful to several settings fields (e.g. an explicitly cleared
// description); only `undefined` — which has no Firestore
// representation at all — is removed.

/**
 * Recursively drop `undefined`-valued keys from a Firestore payload.
 *
 * - Plain objects: keys whose value is `undefined` are removed.
 * - Arrays: elements are mapped through the same rules. An element
 *   that becomes an empty object is kept as `{}` (not dropped), so
 *   array indices never shift.
 * - `null`, `0`, `""` and `false` are preserved verbatim.
 * - Non-plain values (Date, File/Blob, GeoPoint, DocumentReference,
 *   `deleteField()` / `serverTimestamp()` sentinels, class instances)
 *   are returned AS-IS — they are leaf values to Firestore, and
 *   walking into them would corrupt them.
 *
 * @param value The payload to clean.
 * @returns A structurally-equal payload with no `undefined`-valued keys.
 */
export function stripUndefinedValues<T>(value: T): T {
  return stripValue(value) as T;
}

function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripValue(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = stripValue(item);
    }
    return out;
  }

  // Leaf value (or a Firestore sentinel / class instance) — return
  // it untouched. Only `undefined` is a problem for the SDK, and
  // `undefined` at the top level of an object/array is already
  // handled by the branches above.
  return value;
}

/**
 * `true` for a plain `{}`-style object (or a null-prototype object).
 * Class instances, `Date`s and Firestore sentinels are excluded so
 * they are never walked into.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
