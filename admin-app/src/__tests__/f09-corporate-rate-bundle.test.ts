// F09 / SEC-5 / SEC-6 (2026-10-22, P2 revenue leak): the corporate
// rate ladder must not ship to a browser.
//
// TWO leaks, one scanner:
//
//   1. SEC-6 — `settings/hotelConfig` was anonymously readable
//      (`allow read: if true` on `settings/{documentId}`), so the
//      NEGOTIATED corporate rate ladder
//      (`roomTypes[].corporateRate`) and the payment methods' bank
//      details were world-readable straight from Firestore.
//
//   2. SEC-5 — the ladder was ALSO hardcoded in
//      `shared/constants/index.ts` (`DEFAULT_ROOM_TYPES[].corporateRate`),
//      a module the guest app imports through the `@spark-inn/shared`
//      barrel. The negotiated prices were therefore compiled into the
//      JavaScript every guest downloaded — closing the Firestore read
//      alone did NOT close the leak.
//
// This file walks the GUEST-REACHABLE module graph (the guest app's
// own sources + every shared module they import, transitively) and
// asserts that no corporate rate is ever assigned a non-zero literal
// in it. It also asserts that the ladder's new home is a SERVER-ONLY
// module no guest entry point can reach, and that the staff /
// corporate path still resolves the rate (the fix must not have
// deleted the feature).
//
// The scan follows the same source-text style as
// `p1-admin-addons-catalog-shape.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const GUEST_SRC = join(ROOT, "guest-app", "src");
const GUEST_SERVER = join(ROOT, "guest-app", "server");
const SHARED = join(ROOT, "shared");
const LADDER_MODULE = join(GUEST_SERVER, "lib", "corporateRates.ts");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function tryModule(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Resolve a module specifier to a file inside the repo, or null. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier === "@spark-inn/shared") return join(SHARED, "index.ts");
  if (specifier.startsWith("@spark-inn/shared/")) {
    return tryModule(join(SHARED, specifier.slice("@spark-inn/shared/".length)));
  }
  if (specifier.startsWith("@shared/")) {
    return tryModule(join(SHARED, specifier.slice("@shared/".length)));
  }
  if (specifier === "@config") return join(ROOT, "hotel.config.ts");
  if (specifier.startsWith(".")) {
    return tryModule(resolve(dirname(fromFile), specifier));
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s+["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/**
 * Every module the GUEST BUNDLE can reach: the guest app's own
 * sources plus every shared module they pull in (transitively).
 */
function guestReachableModules(): string[] {
  const seen = new Set<string>();
  const queue: string[] = walk(GUEST_SRC);
  for (const file of queue) seen.add(file);

  while (queue.length > 0) {
    const file = queue.pop()!;
    const source = readFileSync(file, "utf8");
    const specifiers: string[] = [];
    for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) specifiers.push(match[1]);
    }
    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(specifier, file);
      if (!resolved) continue;
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      queue.push(resolved);
    }
  }
  return [...seen];
}

const REACHABLE = guestReachableModules();
const REACHABLE_RELATIVE = REACHABLE.map((file) =>
  relative(ROOT, file).split(/[\\/]/).join("/")
);

describe("F09 / SEC-5 — no corporate rate reaches the guest bundle", () => {
  it("the scan actually reaches a non-trivial module graph", () => {
    // Guard against a silently empty scan (the failure mode of every
    // "nothing found" source scanner).
    expect(REACHABLE.length).toBeGreaterThan(20);
    expect(REACHABLE_RELATIVE).toContain("shared/constants/index.ts");
  });

  it("no guest-reachable module assigns a non-zero corporateRate", () => {
    const offenders: string[] = [];
    for (const file of REACHABLE) {
      const source = readFileSync(file, "utf8");
      const matches = source.matchAll(/corporateRate\s*:\s*(-?\d[\d_]*)/g);
      for (const match of matches) {
        if (Number(match[1]) !== 0) {
          offenders.push(
            `${relative(ROOT, file)} → corporateRate: ${match[1]}`
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no guest-reachable module carries the negotiated rate ladder", () => {
    // The ladder is a per-room-type rate map. Assert that no
    // guest-reachable module pairs a room-type value with one of the
    // negotiated rates.
    const LADDER = [1600, 2200, 2300, 2678, 2800, 3900];
    const offenders: string[] = [];
    for (const file of REACHABLE) {
      const source = readFileSync(file, "utf8");
      for (const rate of LADDER) {
        const pattern = new RegExp(
          `corporate[^\\n]{0,120}\\b${rate}\\b|\\b${rate}\\b[^\\n]{0,120}corporate`,
          "i"
        );
        if (pattern.test(source)) {
          offenders.push(`${relative(ROOT, file)} → ${rate}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shared seed no longer carries a corporate rate", () => {
    const constantsSrc = readFileSync(join(SHARED, "constants", "index.ts"), "utf8");
    const matches = [...constantsSrc.matchAll(/corporateRate\s*:\s*(-?\d[\d_]*)/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(Number(match[1])).toBe(0);
    }
  });

  it("the ladder lives in a SERVER-ONLY module the guest cannot reach", () => {
    // The ladder must still EXIST (the fix must not have deleted the
    // corporate pricing feature) — but in a module the browser build
    // can never pull in.
    expect(existsSync(LADDER_MODULE)).toBe(true);
    const ladderSrc = readFileSync(LADDER_MODULE, "utf8");
    expect(ladderSrc).toContain("DEFAULT_CORPORATE_RATES");
    expect(ladderSrc).toMatch(/1600/);
    expect(ladderSrc).toMatch(/2200/);

    // Not reachable from the guest graph.
    expect(REACHABLE_RELATIVE).not.toContain(
      relative(ROOT, LADDER_MODULE).split(/[\\/]/).join("/")
    );
    // And no guest-reachable module imports it.
    const importers = REACHABLE.filter((file) =>
      /from\s+["'][^"']*corporateRates["']/.test(readFileSync(file, "utf8"))
    );
    expect(importers).toEqual([]);
  });

  it("no guest-reachable module lives under guest-app/server/", () => {
    const serverModules = REACHABLE.filter((file) =>
      file.startsWith(GUEST_SERVER + "/")
    );
    expect(serverModules).toEqual([]);
  });
});

describe("F09 — the staff + corporate path still resolves the corporate rate", () => {
  it("the corporate rate ladder module resolves a rate per room type", async () => {
    const { buildCorporateRateCard, resolveCorporateRate } = await import(
      "../../../guest-app/server/lib/corporateRates"
    );
    // The stored (admin-edited) rate wins.
    expect(resolveCorporateRate({ corporateRate: 2450 }, "standard-double")).toBe(2450);
    // The seed ladder is the fallback.
    expect(resolveCorporateRate({}, "standard-double")).toBe(2200);
    // Unknown type with no stored rate → 0 (never ₱0 on an invoice).
    expect(resolveCorporateRate({}, "not-a-type")).toBe(0);

    const card = buildCorporateRateCard({
      roomTypes: [
        { value: "single", corporateRate: 1650 },
        { value: "standard-double", corporateRate: 2250 },
        { value: "no-rate" }
      ]
    });
    expect(card).toEqual({ single: 1650, "standard-double": 2250 });
  });

  it("the admin rate calendar still reads the corporate rate off the room type", () => {
    const ratesSrc = readFileSync(join(ROOT, "admin-app", "src", "pages", "RatesPage.tsx"), "utf8");
    expect(ratesSrc).toMatch(/corporateRate/);
    // The calendar publishes the flat corporate rate card for the
    // staff surface.
    expect(ratesSrc).toMatch(/corporate:/);
  });

  it("the admin app still reads settings/hotelConfig (staff-only read)", () => {
    const adminCtxSrc = readFileSync(
      join(ROOT, "admin-app", "src", "context", "AdminContext.tsx"),
      "utf8"
    );
    expect(adminCtxSrc).toMatch(/"settings"/);
    expect(adminCtxSrc).toMatch(/hotelConfig/);
  });

  it("the booking server still prices a corporate booking from the stored rate", () => {
    const bookingsSrc = readFileSync(
      join(ROOT, "guest-app", "server", "handlers", "bookings.ts"),
      "utf8"
    );
    // The server resolves the corporate rate from the STORED room type
    // (the authoritative source) — the fix moved the CLIENT off it,
    // not the server.
    expect(bookingsSrc).toMatch(/corporateRate/);
    expect(bookingsSrc).toMatch(/corporateFlatRate/);
  });
});
