import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { environmentBanner, environmentBannerFromBooking } from "../../server/handlers/email-banner";

// ETR-22: regression tests for the environment banner helpers.
// The banner fires on two paths:
//   1. Staging deployment — every email is bannered. The check
//      reads `isStagingProject()` against the
//      `FIREBASE_PROJECT_ID` + `STAGING_ALLOWLIST_PROJECT_IDS`
//      env vars. We mutate `process.env` per-test to drive each
//      branch deterministically.
//   2. Test-run booking — every email whose source booking has
//      `isTestData: true` is bannered with the run's `name` +
//      `environment`. The run metadata is stamped onto the
//      booking doc at create time (see `handleCreateBooking` +
//      `handleCreateWalkin`) and surfaced on the email view.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.STAGING_ALLOWLIST_PROJECT_IDS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("environmentBanner — staging-only", () => {
  it("renders the staging banner when the project is in the staging allowlist", () => {
    process.env.FIREBASE_PROJECT_ID = "staging-spark-inn";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn,staging-mirror";
    const html = environmentBanner({});
    expect(html).toContain("Staging environment email");
    expect(html).toContain("No real action is required");
    expect(html).not.toContain("Test run email");
  });

  it("renders no banner when the project is production and no test-run state", () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
    const html = environmentBanner({});
    expect(html).toBe("");
  });

  it("renders no banner when FIREBASE_PROJECT_ID is missing entirely", () => {
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
    const html = environmentBanner({});
    expect(html).toBe("");
  });
});

describe("environmentBanner — test-run only", () => {
  beforeEach(() => {
    // Force production-like project so the staging banner does
    // NOT contaminate the assert.
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
  });

  it("renders the test-run banner with name + environment when both are present", () => {
    const html = environmentBanner({
      isTestData: true,
      testRunName: "Q3 smoke 2026",
      testRunEnvironment: "production"
    });
    expect(html).toContain("Test run email");
    expect(html).toContain("Q3 smoke 2026");
    expect(html).toContain("on production");
    expect(html).toContain("No real action is required");
    expect(html).not.toContain("Staging environment email");
  });

  it("renders the test-run banner with name only when environment is missing", () => {
    const html = environmentBanner({
      isTestData: true,
      testRunName: "Q3 smoke 2026"
    });
    expect(html).toContain("Test run email");
    expect(html).toContain("Q3 smoke 2026");
    expect(html).not.toContain(" on staging");
    expect(html).not.toContain(" on production");
  });

  it("falls back to 'active test run' when neither name nor environment", () => {
    const html = environmentBanner({ isTestData: true });
    expect(html).toContain("Test run email");
    expect(html).toContain("active test run");
  });

  it("escapes HTML in the run name to avoid injection", () => {
    const html = environmentBanner({
      isTestData: true,
      testRunName: '<script>alert("xss")</script>',
      testRunEnvironment: "production"
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not render when isTestData is missing or falsy", () => {
    expect(environmentBanner({ testRunName: "should not render" })).toBe("");
    expect(environmentBanner({ isTestData: false, testRunName: "should not render" })).toBe("");
    expect(environmentBanner({ isTestData: false })).toBe("");
  });

  it("ignores unknown environment values and falls back to name-only", () => {
    const html = environmentBanner({
      isTestData: true,
      testRunName: "Weird env",
      // cast through unknown so the test mirrors runtime shapes
      testRunEnvironment: "garbage" as unknown as "staging"
    });
    expect(html).toContain("test run");
    expect(html).not.toContain("on garbage");
    expect(html).not.toContain("on staging");
  });
});

describe("environmentBanner — both banners stacked", () => {
  it("renders both banners in the right order (test-run first) when on a staging test-run", () => {
    process.env.FIREBASE_PROJECT_ID = "staging-spark-inn";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
    const html = environmentBanner({
      isTestData: true,
      testRunName: "Staging smoke",
      testRunEnvironment: "staging"
    });
    const testRunIdx = html.indexOf("Test run email");
    const stagingIdx = html.indexOf("Staging environment email");
    expect(testRunIdx).toBeGreaterThanOrEqual(0);
    expect(stagingIdx).toBeGreaterThan(testRunIdx);
  });
});

describe("environmentBannerFromBooking", () => {
  beforeEach(() => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
  });

  it("reads test-run fields off a typed booking view", () => {
    const html = environmentBannerFromBooking({
      isTestData: true,
      testRunName: "MRB-09 regression",
      testRunEnvironment: "production"
    });
    expect(html).toContain("MRB-09 regression");
    expect(html).toContain("on production");
  });

  it("renders nothing for a normal production booking", () => {
    const html = environmentBannerFromBooking({
      bookingRef: "SI-9F2K3",
      guestName: "Real Guest",
      totalPrice: 4500
    });
    expect(html).toBe("");
  });

  it("renders nothing for null/undefined booking input", () => {
    expect(environmentBannerFromBooking(null)).toBe("");
    expect(environmentBannerFromBooking(undefined)).toBe("");
  });

  it("does not crash on legacy bookings without the new fields", () => {
    // Legacy bookings created before ETR-22 have no
    // `isTestData` / `testRunName` / `testRunEnvironment`
    // fields. The banner must stay off.
    const html = environmentBannerFromBooking({
      bookingRef: "SI-LEGACY",
      guestName: "Old Guest"
    });
    expect(html).toBe("");
  });
});

// ─── Source-text regression tests ─────────────────────────────────
//
// The unit tests above cover the helpers themselves. The
// tests below prove the call sites are correctly wired:
// every emailLayout({...}) call carries bannerHtml, and
// the booking write paths stamp the test-run banner
// metadata. A regression in any of these surfaces as a
// failed source-text assertion rather than a runtime
// missed banner.

describe("environmentBanner — source-text wiring", () => {
  const emailSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email.ts"),
    "utf8"
  );
  const bookingsSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/bookings.ts"),
    "utf8"
  );
  const testRunsSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/test-runs.ts"),
    "utf8"
  );
  const bannerSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email-banner.ts"),
    "utf8"
  );

  it("exports isStagingProject from test-runs.ts so the email layer can reuse it", () => {
    expect(testRunsSrc).toMatch(/export function isStagingProject\(/);
  });

  it("defines the standalone banner helpers in email-banner.ts", () => {
    expect(bannerSrc).toMatch(/export function environmentBanner\(/);
    expect(bannerSrc).toMatch(/export function environmentBannerFromBooking\(/);
    expect(bannerSrc).toContain("isStagingProject");
  });

  it("imports the banner helpers from the standalone module", () => {
    expect(emailSrc).toMatch(/import \{[\s\S]*environmentBanner[\s\S]*\} from ["']\.\/email-banner["']/);
  });

  it("stamps testRunName + testRunEnvironment on the public create booking doc", () => {
    const matches = bookingsSrc.match(
      /isTestData:\s*true,\s*testRunId:\s*validatedTestRunId,\s*testRunName:\s*validatedTestRunName,\s*testRunEnvironment:\s*validatedTestRunEnvironment/g
    );
    expect(matches, "expected 2 stamping sites (public create + walk-in create)").not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("threads test-run banner fields through buildCreateEmailView's args", () => {
    // The args type + the call site both surface testRunName + testRunEnvironment
    expect(bookingsSrc).toMatch(/isTestData\?:\s*boolean/);
    expect(bookingsSrc).toMatch(/testRunName\?:\s*string/);
    expect(bookingsSrc).toMatch(/testRunEnvironment\?:\s*["']staging["']\s*\|\s*["']production["']/);
  });

  it("surfaces test-run banner fields on the buildReservationEmailView return value", () => {
    expect(emailSrc).toMatch(/isTestData:\s*first\.isTestData === true \|\| reservation\.isTestData === true/);
    expect(emailSrc).toMatch(/testRunName:\s*String\(first\.testRunName \|\| reservation\.testRunName \|\| ""\)/);
    expect(emailSrc).toMatch(/testRunEnvironment:/);
  });

  it("passes bannerHtml on every emailLayout call (booking + store + staff + non-booking)", () => {
    // Count `emailLayout({...})` calls (top-level — the body
    // is a template literal inside the call so its nested
    // `{`/`}` don't close the call) vs `bannerHtml:`
    // occurrences. The type-def `bannerHtml?: string` also
    // matches `bannerHtml:`, so the expected shape is
    // `callCount + 1` — banner per call + the option
    // declaration. The runtime `${options.bannerHtml || ""}`
    // substitution has no colon and is not counted.
    //
    // Note: `callCount` counts 26 `return emailLayout({` + 1
    // `html: emailLayout({` (inside the refund-state helper)
    // = 27. We deliberately count BOTH shapes so a regression
    // that drops the html-keyed helper's banner fails this
    // assertion.
    const callCount = (emailSrc.match(/\breturn\s+emailLayout\(\{/g) || []).length
      + (emailSrc.match(/html:\s+emailLayout\(\{/g) || []).length;
    const bannerOccurrences = (emailSrc.match(/\bbannerHtml:/g) || []).length;
    expect(callCount).toBeGreaterThanOrEqual(20);
    // N assignments + 1 type-def = N + 1
    expect(bannerOccurrences).toBe(callCount + 1);
  });

  it("the emailLayout option shape accepts bannerHtml?", () => {
    expect(emailSrc).toMatch(/bannerHtml\?:\s*string/);
  });

  it("renders the bannerHtml at the top of the content cell, before the intro paragraph", () => {
    // The `${options.bannerHtml || ""}` substitution must
    // come before `${options.intro}` inside the content cell.
    const bannerIdx = emailSrc.indexOf("${options.bannerHtml || \"\"}");
    const introIdx = emailSrc.indexOf("${options.intro}");
    expect(bannerIdx).toBeGreaterThan(0);
    expect(introIdx).toBeGreaterThan(0);
    expect(bannerIdx).toBeLessThan(introIdx);
  });
});
