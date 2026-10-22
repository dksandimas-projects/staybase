import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveApiBaseUrl } from "../utils/apiBaseUrl";

/**
 * P0-ADMIN-API-BASE (2026-10-22)
 *
 * The admin app is a SEPARATE Vercel project from the guest app that
 * serves `/api/*`. The admin project's `vercel.json` ends with
 *
 *     { "source": "/(.*)", "destination": "/index.html" }
 *
 * so EVERY unmatched path on the admin origin returns the SPA shell
 * with HTTP 200 and `content-type: text/html`.
 *
 * Five call sites built their API URL from `window.location.origin`,
 * i.e. the ADMIN origin. They therefore fetched the HTML shell,
 * `res.json()` threw, and the feature silently died:
 *
 *   - the booking drawer's Breakfast tab → "Breakfast is not enabled"
 *   - the booking drawer's Add-Ons tab  → no add-on rows at all
 *   - the walk-in breakfast grid        → "Breakfast not enabled"
 *   - the walk-in other-add-ons grid    → no add-on rows at all
 *   - the refund "Mark as paid" POST    → wrong URL AND no staff token
 *
 * Every staff API call must resolve its base through `getApiBaseUrl()`,
 * which maps the admin hostname to the guest app's origin.
 */

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strips `//` line comments so a comment mentioning the old pattern
 *  does not trip the source pins (the fix's own comments name it). */
function stripLineComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) return "";
      // keep the code before an inline `//` that is not inside a string
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      const quotes = (before.match(/["'`]/g) || []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join("\n");
}

const sourceFiles = walk(SRC);

describe("P0-ADMIN-API-BASE — the admin app never calls /api on its own origin", () => {
  it("finds the admin source tree (guard against a silently empty scan)", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it("no admin source file derives an API URL from window.location.origin", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = stripLineComments(readFileSync(file, "utf8"));
      if (!src.includes("window.location.origin")) continue;
      // `window.location.origin` is only ever legitimate for non-API
      // concerns (a download link, a mailto). Any occurrence inside a
      // template literal that also contains "/api" is an API base.
      if (/window\.location\.origin[\s\S]{0,80}\/api|\/api[\s\S]{0,80}window\.location\.origin/.test(src)) {
        offenders.push(file.replace(SRC, "admin-app/src"));
      }
    }
    expect(offenders, `these files build an API URL from window.location.origin:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("no admin source file reads the never-injected window.__API_BASE_URL global", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = stripLineComments(readFileSync(file, "utf8"));
      if (src.includes("__API_BASE_URL")) offenders.push(file.replace(SRC, "admin-app/src"));
    }
    expect(
      offenders,
      `window.__API_BASE_URL is injected nowhere, so it always fell back to the relative "/api":\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("every file that calls a guest-API path resolves its base through getApiBaseUrl()", () => {
    // File-scoped on purpose: a fetch's base is often computed a few
    // lines ABOVE the call (`const base = getApiBaseUrl()...`), so a
    // window around the `fetch(` token would miss it. The contract is
    // per file: any file that talks to the guest API must resolve its
    // base through the shared helper.
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = stripLineComments(readFileSync(file, "utf8"));
      if (!/["'`]\/api\//.test(src)) continue;
      if (!src.includes("getApiBaseUrl")) {
        offenders.push(file.replace(SRC, "admin-app/src"));
      }
    }
    expect(
      offenders,
      `these files call a guest-API path without resolving the base through getApiBaseUrl():\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

describe("P0-ADMIN-API-BASE — the five dead call sites are wired to the guest origin", () => {
  // Comments are stripped here too: the fix's own comments name the old
  // broken patterns on purpose, and a source pin must judge CODE, not
  // prose.
  const drawer = stripLineComments(readFileSync(join(SRC, "components/BookingDrawerWorkspace.tsx"), "utf8"));
  const walkinBreakfast = stripLineComments(readFileSync(join(SRC, "components/breakfast/WalkinBreakfastGrid.tsx"), "utf8"));
  const walkinAddOns = stripLineComments(readFileSync(join(SRC, "components/otherAddOns/WalkinOtherAddOnGrid.tsx"), "utf8"));

  it("the booking drawer fetches the breakfast catalog from the guest origin", () => {
    expect(drawer).toMatch(/getApiBaseUrl\(\)/);
    expect(drawer).toMatch(/\/api\/bookings\/breakfast\/config/);
  });

  it("the booking drawer fetches the add-on catalog from the guest origin", () => {
    expect(drawer).toMatch(/\/api\/bookings\/addons\/config/);
    expect(drawer).toMatch(/getApiBaseUrl/);
  });

  it("the walk-in breakfast grid fetches the catalog from the guest origin", () => {
    expect(walkinBreakfast).toMatch(/getApiBaseUrl/);
    expect(walkinBreakfast).toMatch(/\/api\/bookings\/breakfast\/config/);
    expect(walkinBreakfast).toMatch(/import \{ getApiBaseUrl \} from "\.\.\/\.\.\/utils\/apiBaseUrl"/);
  });

  it("the walk-in other-add-ons grid fetches the catalog from the guest origin", () => {
    expect(walkinAddOns).toMatch(/getApiBaseUrl/);
    expect(walkinAddOns).toMatch(/\/api\/bookings\/addons\/config/);
    expect(walkinAddOns).toMatch(/import \{ getApiBaseUrl \} from "\.\.\/\.\.\/utils\/apiBaseUrl"/);
  });

  it("the refund mark-paid POST sends the staff Bearer token", () => {
    const fn = drawer.match(/async function postMarkRefundPaid[\s\S]*?\n}\n/);
    expect(fn, "expected the postMarkRefundPaid helper").not.toBeNull();
    expect(fn?.[0]).toMatch(/getApiBaseUrl\(\)/);
    expect(fn?.[0]).toMatch(/\/api\/refunds\/mark-paid/);
    expect(fn?.[0]).toMatch(/Authorization: token \? `Bearer \$\{token\}` : ""/);
    expect(fn?.[0]).toMatch(/getIdToken/);
  });

  it("the refund mark-paid POST does not use credentialed cookies (the guest API sends no Access-Control-Allow-Credentials)", () => {
    const fn = drawer.match(/async function postMarkRefundPaid[\s\S]*?\n}\n/);
    expect(fn?.[0]).not.toMatch(/credentials:\s*"include"/);
  });
});

describe("P0-ADMIN-API-BASE — the resolver can never hand back the admin origin", () => {
  it("maps the production admin host to the guest app origin", () => {
    const base = resolveApiBaseUrl({
      hostname: "admin.sparkinnbohol.com",
      configuredGuestUrl: "https://www.sparkinnbohol.com",
    });
    expect(base).toBe("https://www.sparkinnbohol.com");
    expect(base.startsWith("/")).toBe(false);
  });

  it("maps the staging admin host to the staging guest origin", () => {
    const base = resolveApiBaseUrl({
      hostname: "stg-admin.sparkinnbohol.com",
      configuredGuestUrl: "https://www.sparkinnbohol.com",
    });
    expect(base).toBe("https://stg.sparkinnbohol.com");
    expect(base.startsWith("/")).toBe(false);
  });

  it("never returns a relative path for any non-localhost admin host", () => {
    for (const hostname of [
      "admin.sparkinnbohol.com",
      "staybase-admin.vercel.app",
      "staging-admin.sparkinnbohol.com",
    ]) {
      const base = resolveApiBaseUrl({
        hostname,
        configuredGuestUrl: "https://www.sparkinnbohol.com",
      });
      expect(base.startsWith("/"), `${hostname} resolved to a relative base: ${base}`).toBe(false);
    }
  });
});
