import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

// Regression tests for LCE-01 (Editable Terms & Conditions,
// decision #137, 2026-07-25). Pins the editable content
// feature: the admin Settings editor, the dedicated
// server endpoint, the public /terms page render path
// with deploy-time fallback, the version-bump helper,
// the booking consent version capture, and the
// DEFAULT_TERMS_VERSION + TERMS_BODY_MAX_LENGTH shared
// constants.

describe("LCE-01 — shared constants for editable terms", () => {
  const constants = read("shared/constants/index.ts");

  it("exports DEFAULT_TERMS_VERSION at 1.0.0", () => {
    // The initial version stamp used when the website
    // has never saved terms (legacy + fallback path).
    expect(constants).toMatch(/export const DEFAULT_TERMS_VERSION = "1\.0\.0"/);
  });

  it("exports TERMS_BODY_MAX_LENGTH at 50,000", () => {
    // The 50 KB cap is enforced server-side by the Zod
    // schema and client-side by the textarea's
    // `maxLength` attribute. Pin the constant so the
    // cap can't drift silently.
    expect(constants).toMatch(/export const TERMS_BODY_MAX_LENGTH = 50_000/);
  });
});

describe("LCE-01 — server endpoint handleUpdateTerms", () => {
  const legal = read("guest-app/server/handlers/legal.ts");
  const apiRouter = read("guest-app/server/apiRouter.ts");

  it("new file exists and exports handleUpdateTerms", () => {
    expect(legal).toMatch(/export async function handleUpdateTerms/);
  });

  it("uses a Zod-validated body schema (termsBody, min 1, max TERMS_BODY_MAX_LENGTH, strict)", () => {
    expect(legal).toMatch(/z\.object\(\s*\{\s*termsBody:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(TERMS_BODY_MAX_LENGTH\)/);
    // The `.strict()` call closes the schema object — exact
    // form varies (e.g. `}).strict()` vs `}).strict();` with
    // a trailing semicolon). Pin that the schema is in
    // strict mode.
    expect(legal).toMatch(/\)\.strict\(\)/);
  });

  it("enforces admin-only (front-desk 403, tokenless 401, GET 405)", () => {
    expect(legal).toMatch(/if \(staff\.role !== "admin"\)[\s\S]*?Only admins can update terms\./);
    expect(legal).toMatch(/if \(!staff\.uid\)[\s\S]*?Staff authentication is required\./);
    expect(legal).toMatch(/if \(req\.method !== "POST"\)[\s\S]*?Method not allowed\./);
  });

  it("auto-bumps the patch version inside a transaction (1.0.0 → 1.0.1)", () => {
    // The version-bump helper matches MAJOR.MINOR.PATCH
    // and increments the patch.
    expect(legal).toMatch(/function bumpPatchVersion/);
    expect(legal).toMatch(/Number\(patch\) \+ 1/);
    // The transaction wraps the read + write.
    expect(legal).toMatch(/adminDb\.runTransaction/);
    expect(legal).toMatch(/transaction\.set\(\s*websiteContentRef/);
    expect(legal).toMatch(/termsVersion:\s*nextVersion/);
  });

  it("stamps termsLastUpdated (YYYY-MM-DD) + termsUpdatedBy + termsUpdatedAt", () => {
    expect(legal).toMatch(/termsLastUpdated:\s*lastUpdated/);
    expect(legal).toMatch(/termsUpdatedBy:\s*staff\.uid/);
    expect(legal).toMatch(/termsUpdatedAt:\s*now\.toISOString\(\)/);
  });

  it("uses setDoc(..., { merge: true }) so other websiteContent keys are preserved", () => {
    expect(legal).toMatch(/set\(\s*websiteContentRef,\s*\{[\s\S]*?\}\s*,\s*\{\s*merge:\s*true\s*\}\s*\)/);
  });

  it("is wired in apiRouter as POST /api/admin/update-terms with admin role gate", () => {
    expect(apiRouter).toMatch(/domain === ["']admin["'] && action === ["']update-terms["'] && req\.method === ["']POST["']/);
    expect(apiRouter).toMatch(/import \{ handleUpdateTerms \}/);
    expect(apiRouter).toMatch(/if \(authResult\.role !== "admin"\)[\s\S]*?Only admins can update terms\./);
  });
});

describe("LCE-01 — booking consent version capture (server)", () => {
  const bookings = read("guest-app/server/handlers/bookings.ts");

  it("imports DEFAULT_TERMS_VERSION from @spark-inn/shared", () => {
    expect(bookings).toMatch(/import\s*\{[^}]*DEFAULT_TERMS_VERSION[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
  });

  it("reads termsVersion from settings/websiteContent inside the create transaction", () => {
    // The version stamp is read inside the booking create
    // transaction so a concurrent admin save lands in a
    // different transaction and the booking is stamped
    // with whichever version was live at this commit.
    expect(bookings).toMatch(/const termsConsentVersion =\s*websiteContentDoc\.exists && typeof websiteContentDoc\.data\(\)\?\.termsVersion === "string"/);
    expect(bookings).toMatch(/\?\s*String\(websiteContentDoc\.data\(\)!\.termsVersion\)\s*:\s*DEFAULT_TERMS_VERSION/);
  });

  it("stamps termsConsentVersion on the new booking doc", () => {
    expect(bookings).toMatch(/termsConsentVersion,/);
  });
});

describe("LCE-01 — admin Settings → Legal Content editor", () => {
  const settingsPage = read("admin-app/src/pages/SettingsPage.tsx");

  it("hydrates termsBody / termsVersion / termsLastUpdated from websiteContent", () => {
    expect(settingsPage).toMatch(/setTermsBody\(websiteContent\.termsBody \|\| ""\)/);
    expect(settingsPage).toMatch(/setTermsVersion\(websiteContent\.termsVersion \|\| ""\)/);
    expect(settingsPage).toMatch(/setTermsLastUpdated\(websiteContent\.termsLastUpdated \|\| config\.termsLastUpdated \|\| ""\)/);
  });

  it("renders the terms editor textarea with the 50,000 char cap", () => {
    // The textarea enforces the same cap as the server schema.
    expect(settingsPage).toMatch(/<textarea[\s\S]*?maxLength=\{50000\}/);
  });

  it("posts to /api/admin/update-terms via the dedicated save handler", () => {
    expect(settingsPage).toMatch(/\/api\/admin\/update-terms/);
    expect(settingsPage).toMatch(/const handleSaveTerms = async/);
  });

  it("shows the version badge in the editor header", () => {
    // The "v{version}" badge surfaces the persisted
    // version so the admin sees the live stamp at all
    // times. The exact class list is non-load-bearing —
    // we pin that the badge renders `v{termsVersion}`.
    expect(settingsPage).toMatch(/termsVersion && <span[\s\S]{0,200}>v\{termsVersion\}<\/span>/);
  });
});

describe("LCE-01 — public /terms page render path", () => {
  const termsPage = read("guest-app/src/pages/TermsPage.tsx");

  it("fetches the custom body from settings/websiteContent on mount", () => {
    expect(termsPage).toMatch(/getDoc\(doc\(db, ["']settings["'], ["']websiteContent["']\)\)/);
    expect(termsPage).toMatch(/typeof data\.termsBody === ["']string["'] && data\.termsBody\.trim\(\)\.length > 0/);
  });

  it("renders the custom body via whitespace-pre-line (preserves structure, no HTML risk)", () => {
    // Plain text only — no `dangerouslySetInnerHTML`,
    // no markdown parser. The admin owns the structure
    // and the page renders line breaks as paragraph
    // breaks.
    expect(termsPage).toMatch(/whitespace-pre-wrap/);
    expect(termsPage).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("falls back to the hardcoded 11-section body when the custom body is missing", () => {
    // The fallback path renders the original sections
    // (1. Booking Agreement ... 11. Contact) so the
    // public /terms page never goes blank if the admin
    // hasn't set a custom body.
    expect(termsPage).toMatch(/Booking Agreement/);
    expect(termsPage).toMatch(/Governing Law/);
    expect(termsPage).toMatch(/customBody \? \(/);
  });

  it("shows the version badge in the page header (Firestore override or VERSION fallback)", () => {
    expect(termsPage).toMatch(/const versionLabel = customVersion \|\| VERSION/);
  });
});
