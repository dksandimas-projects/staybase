import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

// Per MSL-01 / decision #253 (2026-10-15): the maximum stay length
// moved from a compile-time constant to
// `settings/hotelConfig.maxStayNights` (0 = no limit, absent = the
// 30-night default), editable in Settings -> Booking & Holds.
//
// This is a source-text tripwire suite, in the same shape as the other
// admin settings suites. It pins:
//
//   1. The editor exists, is admin-gated, and writes the INTEGER the
//      admin typed (never `Infinity` — Firestore cannot store it and
//      the reader would mis-parse it)
//   2. `0` is accepted as valid, so the field must NOT reuse
//      `clampIntegerInRange` (whose `min` is >= 1 for every other
//      field in this form)
//   3. `AdminContext` normalizes on hydrate via `resolveMaxStayNights`
//      so a legacy doc or a hand-edited value can never put a raw `0`
//      into admin state
//   4. All THREE server write paths enforce the cap. The reschedule
//      guard is the one that was genuinely missing before MSL-01.
//   5. The server fails CLOSED — a read error resolves to the default
//      cap, never to unlimited.
//
// A regression that re-hardcodes the cap, lets a literal `0` reach the
// clamp arithmetic, or drops a write path fails one of these.

const settingsPage = read("admin-app/src/pages/SettingsPage.tsx");
const adminContext = read("admin-app/src/context/AdminContext.tsx");
const bookingsHandler = read("guest-app/server/handlers/bookings.ts");
const stayRange = read("shared/utils/stayRange.ts");

describe("MSL-01 — the stay cap is a setting, not a constant", () => {
  test("the editor writes the admin's integer, never `Infinity`", () => {
    // `0` must survive the round trip as the literal `0`, because
    // `resolveMaxStayNights` on the read side is what turns it into
    // `Infinity` for the clamp arithmetic.
    expect(settingsPage).toMatch(/maxStayNights: maxStayNightsValid!/);
    expect(settingsPage).not.toMatch(/maxStayNights: Infinity/);
    expect(settingsPage).not.toMatch(/maxStayNights: Number\.isFinite\([^)]*\)\s*\?\s*[^:]*:\s*Infinity/);
  });

  test("`0` is a legal value, so the field cannot reuse clampIntegerInRange", () => {
    // The two hold windows next to it DO use `clampIntegerInRange`.
    // Reusing it here would make `min = 1` and silently forbid the
    // exact value the feature exists to express.
    expect(settingsPage).toMatch(/min=\{0\}/);
    expect(settingsPage).toMatch(/max=\{MAX_MAX_STAY_NIGHTS\}/);
    // The bespoke validator admits 0 and rejects negatives.
    expect(settingsPage).toMatch(/if \(value < 0 \|\| value > MAX_MAX_STAY_NIGHTS\) return null;/);
  });

  test("the input carries the 44px touch-target minimum", () => {
    expect(settingsPage).toMatch(/id="maxStayNights"[\s\S]{0,700}?min-h-11/);
  });

  test("AdminContext normalizes on hydrate via the shared resolver", () => {
    expect(adminContext).toMatch(
      /maxStayNights: resolveMaxStayNights\(\(data as Partial<typeof hotelConfig>\)\?\.maxStayNights\)/
    );
    expect(adminContext).toMatch(/maxStayNights: DEFAULT_MAX_STAY_NIGHTS,/);
  });
});

describe("MSL-01 — all three server write paths enforce the cap", () => {
  test("create, walk-in, and reschedule each resolve and refuse", () => {
    const resolutions = bookingsHandler.match(/await loadMaxStayNights\(\)/g) || [];
    // Three: handleCreateBooking, handleCreateWalkin,
    // handleRescheduleBooking. The reschedule guard is the one that was
    // MISSING before MSL-01 — a front-desk user could stretch a legal
    // 2-night booking to 200 nights and bypass the cap entirely.
    expect(resolutions.length).toBe(3);

    const refusals = bookingsHandler.match(/buildMaxStayNightsError\(res, maxStayNights\)/g) || [];
    expect(refusals.length).toBe(3);
  });

  test("the loader is module scope, not nested in a handler", () => {
    // A nested declaration typechecks fine but throws
    // `ReferenceError` at runtime from every other handler — which is
    // exactly how this shipped once already.
    expect(bookingsHandler).toMatch(/^async function loadMaxStayNights\(\): Promise<number> \{/m);
  });

  test("the server fails CLOSED — a read error is the default, not unlimited", () => {
    const loader = bookingsHandler.slice(
      bookingsHandler.indexOf("async function loadMaxStayNights"),
      bookingsHandler.indexOf("function buildMaxStayNightsError")
    );
    expect(loader).toMatch(/catch \{/);
    expect(loader).toMatch(/return resolveMaxStayNights\(undefined\);/);
    // No catch arm may resolve to an unlimited cap.
    expect(loader).not.toMatch(/catch[^{]*\{[^}]*resolveMaxStayNights\(0\)/);
  });
});

describe("MSL-01 — the resolver owns the raw-value mapping", () => {
  test("absent, 0, fractional, and garbage are four distinct answers", () => {
    expect(stayRange).toMatch(/if \(raw === undefined \|\| raw === null \|\| raw === ""\) return DEFAULT_MAX_STAY_NIGHTS;/);
    expect(stayRange).toMatch(/if \(!Number\.isFinite\(value\) \|\| value < 0\) return DEFAULT_MAX_STAY_NIGHTS;/);
    expect(stayRange).toMatch(/if \(value === 0\) return Infinity;/);
    // Floors AFTER the zero test, then guards — otherwise `0.5` floors
    // to `0` and re-enters as unlimited.
    expect(stayRange).toMatch(/const floored = Math\.floor\(value\);/);
    expect(stayRange).toMatch(/if \(floored < MIN_MAX_STAY_NIGHTS\) return MIN_MAX_STAY_NIGHTS;/);
  });

  test("guest copy quotes the shared describer so the 400 matches the banner", () => {
    // The picker banner and the server 400 must name the same live
    // number the admin just set.
    expect(stayRange).toMatch(/return Number\.isFinite\(maxNights\) \? `\$\{maxNights\} nights` : "no maximum";/);
  });
});