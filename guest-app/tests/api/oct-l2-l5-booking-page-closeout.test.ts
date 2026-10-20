// Per OCT-L2 + OCT-L5 (2026-10-20, decision #299): the two
// BookingPage closeout fixes.
//
// **OCT-L2 — `setSearchParams` inside a `setRoomCart` updater.** A
// state updater runs during React's RENDER phase, so dispatching a
// router update from one is a render-phase side effect: React 19
// warns about it, and the app runs `<React.StrictMode>`, which
// double-invokes the updater in dev. The write is idempotent, so
// nothing corrupted — but it sat on the hot quantity-change path.
//
// **OCT-L5 — the `breakfastConfig` type omitted `imageUrl`.** The
// local state declared its own inline shape and that shape had no
// `imageUrl`, even though `BreakfastMenuStrip` renders the MBUX-04
// meal thumbnail from it. The field survived only because the
// Firestore snapshot was read with `bSnap.data() as any` — one type
// edit away from silently dropping every meal photo on the booking
// flow, and the compiler could not see it.
//
// This file pins the BEHAVIOUR (runtime assertions against the real
// normalizer) and the WIRING (source-text guards — the page cannot be
// mounted here because the repo has no jsdom/RTL harness).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_BOOKING_BREAKFAST_CONFIG,
  normalizeBreakfastConfig
} from "../../src/utils/breakfastConfig";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

/**
 * Strip JS comments so an assertion about CODE cannot be tripped by
 * prose in a doc comment.
 *
 * LINE comments are stripped FIRST: a `//` comment may contain `/*`
 * (the booking page has one — "Guest clients cannot read `bookings/*`
 * directly"). Stripping blocks first treated that as a block opener
 * and swallowed ~170 lines of REAL code, making every source-text pin
 * inside that window silently vacuous.
 */
function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

const bookingPageCode = stripComments(bookingPageSrc);

describe("OCT-L2 — the router write never happens inside a state updater", () => {
  it("no `setSearchParams` call sits inside a `setRoomCart` updater", () => {
    // The shape that used to be there:
    //   setRoomCart((current) => { ...; setSearchParams(nextParams); return next; })
    //
    // The pin walks the file for every `setRoomCart(` call site and,
    // for the ones that use the UPDATER form, asserts the region up
    // to the next call site contains no router write.
    const starts = [...bookingPageCode.matchAll(/setRoomCart\(/g)].map((m) => m.index ?? 0);
    expect(starts.length).toBeGreaterThan(0);
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : bookingPageCode.length;
      const region = bookingPageCode.slice(start, end);
      const usesUpdater = /\(\w+\)\s*=>/.test(region.slice(0, 60));
      if (usesUpdater) {
        expect(region).not.toMatch(/setSearchParams/);
      }
    }
  });

  it("the pin is not vacuous — the URL write still exists", () => {
    // A negative pin that passes because the feature was deleted is
    // worse than no pin at all.
    expect(bookingPageCode).toMatch(/setSearchParams\(nextParams, \{ replace: true \}\)/);
  });

  it("the quantity handler writes the cart and the URL from the event handler", () => {
    // The cart is now derived from the CURRENT `roomCart` value and
    // both writes happen in the handler, in that order.
    expect(bookingPageCode).toMatch(
      /function updateRoomQuantity\([\s\S]*?const next = \[\.\.\.other, \.\.\.resized\];\s*setRoomCart\(next\);[\s\S]*?setSearchParams\(nextParams, \{ replace: true \}\);/
    );
  });

  it("the extra-bed handler does the same", () => {
    expect(bookingPageCode).toMatch(
      /function updateExtraBedCount\([\s\S]*?setRoomCart\(next\);\s*const nextParams = new URLSearchParams\(searchParams\);[\s\S]*?setSearchParams\(nextParams, \{ replace: true \}\);/
    );
  });
});

describe("OCT-L5 — the breakfast config read path is typed and normalized", () => {
  it("the `as any` cast on the Firestore snapshot is GONE", () => {
    // The cast is what let `imageUrl` exist outside the type.
    expect(bookingPageCode).not.toMatch(/setBreakfastConfig\(bSnap\.data\(\) as any\)/);
    expect(bookingPageCode).not.toMatch(/setBreakfastConfig\([^)]*as any\)/);
  });

  it("the snapshot is normalized through the shared helper", () => {
    expect(bookingPageCode).toMatch(/setBreakfastConfig\(normalizeBreakfastConfig\(bSnap\.data\(\)\)\)/);
  });

  it("the state is typed with the shared shape, not an inline one", () => {
    expect(bookingPageCode).toMatch(/useState<BookingBreakfastConfig>\(/);
    expect(bookingPageCode).toMatch(/DEFAULT_BOOKING_BREAKFAST_CONFIG/);
  });
});

describe("OCT-L5 — normalizeBreakfastConfig", () => {
  it("carries `imageUrl` through (the MBUX-04 thumbnail)", () => {
    const raw = {
      isEnabled: true,
      meals: [{ id: "silog", name: "Silog", price: 350, imageUrl: "https://x.test/silog.jpg" }]
    };
    const config = normalizeBreakfastConfig(raw);
    expect(config.meals?.[0].imageUrl).toBe("https://x.test/silog.jpg");
  });

  it("treats an empty `imageUrl` as ABSENT, not as an empty string", () => {
    // MBUX-04: "no image" must be unambiguous — the strip tests it
    // with a single truthy check.
    const config = normalizeBreakfastConfig({
      isEnabled: true,
      meals: [{ id: "silog", name: "Silog", price: 350, imageUrl: "" }]
    });
    expect(config.meals?.[0].imageUrl).toBeUndefined();
  });

  it("defaults the cut-off fields the way the read sites already did", () => {
    const config = normalizeBreakfastConfig({ isEnabled: true });
    expect(config.cutoffsEnabled).toBe(true);
    expect(config.cutoffTime).toBe("20:00");
    expect(config.cutoffTimezone).toBe("Asia/Manila");
    expect(config.defaultMealInstructions).toBe("");
    expect(config.meals).toEqual([]);
  });

  it("keeps an explicit `cutoffsEnabled: false`", () => {
    const config = normalizeBreakfastConfig({ isEnabled: true, cutoffsEnabled: false });
    expect(config.cutoffsEnabled).toBe(false);
  });

  it("keeps `isEnabled` on truthiness semantics", () => {
    expect(normalizeBreakfastConfig({ isEnabled: true }).isEnabled).toBe(true);
    expect(normalizeBreakfastConfig({ isEnabled: false }).isEnabled).toBe(false);
    expect(normalizeBreakfastConfig({}).isEnabled).toBe(false);
    expect(normalizeBreakfastConfig({ isEnabled: 1 }).isEnabled).toBe(true);
  });

  it("keeps `isActive` on the `!== false` semantics the meal filter used", () => {
    const config = normalizeBreakfastConfig({
      isEnabled: true,
      meals: [
        { id: "a", name: "A", price: 100 },
        { id: "b", name: "B", price: 100, isActive: false }
      ]
    });
    expect(config.meals?.[0].isActive).toBe(true);
    expect(config.meals?.[1].isActive).toBe(false);
  });

  it("never lets a junk price become NaN", () => {
    // The read sites multiply and format `price`; an absent price
    // previously rendered ₱NaN.
    const config = normalizeBreakfastConfig({
      isEnabled: true,
      meals: [{ id: "a", name: "A" }]
    });
    expect(config.meals?.[0].price).toBe(0);
  });

  it("survives a null / non-object input", () => {
    expect(normalizeBreakfastConfig(null).isEnabled).toBe(false);
    expect(normalizeBreakfastConfig(undefined).isEnabled).toBe(false);
    expect(normalizeBreakfastConfig("nope").isEnabled).toBe(false);
  });

  it("the default config is the 'breakfast is off' shape", () => {
    expect(DEFAULT_BOOKING_BREAKFAST_CONFIG.isEnabled).toBe(false);
    expect(DEFAULT_BOOKING_BREAKFAST_CONFIG.meals).toEqual([]);
  });
});
