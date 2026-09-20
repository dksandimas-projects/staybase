import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  environmentBanner,
  environmentBannerFromBooking,
  subjectPrefix,
  subjectPrefixFromBooking
} from "../../server/handlers/email-banner";

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

// ─── ETR-22.b — handleEmailPreview auto-detect ─────────────────────
//
// The preview handler enriches `mockBooking` with test-run banner
// metadata so the rendered template matches what the guest would
// actually see. Two paths:
//   1. Body opt-in:  `{ isTestData: true, testRunName, testRunEnvironment }`
//   2. Auto-detect:  query `testRuns` for the most recent active run
//                    in the current deployment environment
// Fallback: no banner (preview never breaks on a failed read).

describe("ETR-22.b — handleEmailPreview banner source", () => {
  beforeEach(() => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
  });

  // Source-text guards for the ETR-22.b wiring. The
  // email.ts handle reads from the request body + auto-detects
  // an active test run; we pin both paths.
  const emailSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email.ts"),
    "utf8"
  );

  it("reads isTestData + testRunName + testRunEnvironment from the request body when provided", () => {
    // Source-text: the override branch reads three fields from
    // `req.body`. We pin the wiring so a future refactor
    // doesn't drop the opt-in.
    expect(emailSrc).toMatch(/body\.isTestData\s*===\s*true/);
    expect(emailSrc).toMatch(/body\.testRunName/);
    expect(emailSrc).toMatch(/body\.testRunEnvironment/);
  });

  it("queries testRuns for active runs in the current environment when no body override is set", () => {
    // The auto-detect path: scoped query (status + environment)
    // ordered by createdAt desc, limit 1.
    expect(emailSrc).toMatch(/collection\(["']testRuns["']\)/);
    expect(emailSrc).toMatch(/["']status["']\s*,\s*["']==["']\s*,\s*["']active["']/);
    expect(emailSrc).toMatch(/["']environment["']\s*,\s*["']==["']\s*,\s*currentEnv/);
    expect(emailSrc).toMatch(/orderBy\(["']createdAt["']\s*,\s*["']desc["']\)/);
  });

  it("uses enrichedMockBooking in every booking template case (not the raw mockBooking)", () => {
    // The 14 switch cases that previously used `mockBooking`
    // (booking templates + staff templates) now use
    // `enrichedMockBooking`. The non-booking cases
    // (corporate/contact/voucher/store/spark-rewards) keep
    // their typed mocks — those templates don't read booking
    // metadata so the test-run banner can't fire there.
    const bookingCases = [
      "booking-submitted",
      "payment-confirmed",
      "booking-confirmed",
      "booking-confirmed-with-balance",
      "checkin-reminder",
      "booking-cancelled",
      "booking-cancelled-reservation",
      "discount-rejected",
      "payment-rejected",
      "early-checkin-request",
      "early-checkin-resolve",
      "booking-rescheduled",
      "staff-new-booking",
      "staff-new-payment"
    ];
    for (const c of bookingCases) {
      const caseStart = emailSrc.indexOf(`case "${c}":`);
      expect(caseStart, `case "${c}": not found`).toBeGreaterThan(0);
      // Look at the next 30 lines — none of them should call
      // the raw `mockBooking` (only `enrichedMockBooking`).
      const snippet = emailSrc.slice(caseStart, caseStart + 1500);
      // The literal `mockBooking` (not the enriched variant)
      // should NOT appear inside the case body.
      const rawUses = (snippet.match(/\bmockBooking\b/g) || []).filter(s => s === "mockBooking");
      expect(
        rawUses,
        `case "${c}" still references raw mockBooking (should be enrichedMockBooking)`
      ).toEqual([]);
    }
  });

  it("falls back to no test-run banner when the auto-detect read fails", () => {
    // The try/catch around the auto-detect must log + swallow
    // so the preview never breaks on a Firestore read failure.
    expect(emailSrc).toMatch(/Failed to enrich preview with active test run/);
    // No re-throw — the outer try/catch wraps the switch,
    // so a re-thrown error would surface as 500.
    expect(emailSrc).toMatch(/catch \(previewRunErr\)/);
  });
});

// ─── ETR-22.10 — subject-line environment prefix ───────────────────
//
// The prefix mirrors the body banner's state machine:
//   Production, no test-run   → (no prefix)
//   Production, test-run      → `[PROD TEST] `
//   Staging, no test-run      → `[STG] `
//   Staging, test-run         → `[STG TEST] `
//
// Auto-detection for staging uses the same
// `isStagingProject()` allowlist as the body banner.

describe("subjectPrefix — production, no test-run", () => {
  beforeEach(() => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
  });

  it("returns no prefix when neither staging nor test-run", () => {
    expect(subjectPrefix({ isTestData: false })).toBe("");
    expect(subjectPrefix({})).toBe("");
    expect(subjectPrefix({ isTestData: undefined })).toBe("");
  });

  it("returns `[PROD TEST] ` for a production test-run", () => {
    expect(subjectPrefix({ isTestData: true })).toBe("[PROD TEST] ");
  });
});

describe("subjectPrefix — staging", () => {
  beforeEach(() => {
    process.env.FIREBASE_PROJECT_ID = "staging-spark-inn";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
  });

  it("returns `[STG] ` for staging with no test-run", () => {
    expect(subjectPrefix({})).toBe("[STG] ");
    expect(subjectPrefix({ isTestData: false })).toBe("[STG] ");
  });

  it("returns `[STG TEST] ` for staging test-run (test-run appended, not duplicated)", () => {
    expect(subjectPrefix({ isTestData: true })).toBe("[STG TEST] ");
  });

  it("orders `[STG]` before `[TEST]` so the more specific test-run tag appears last", () => {
    // `[STG TEST]` order matters — STG identifies the deployment,
    // TEST identifies the run context. Reverse order would read
    // confusingly as "test-run, on staging".
    const prefix = subjectPrefix({ isTestData: true });
    const stgIdx = prefix.indexOf("STG");
    const testIdx = prefix.indexOf("TEST");
    expect(stgIdx).toBeLessThan(testIdx);
  });
});

describe("subjectPrefix — production, multi-project staging allowlist", () => {
  it("returns no prefix when project is staging-mirror but allowlist excludes it", () => {
    process.env.FIREBASE_PROJECT_ID = "staging-mirror";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
    expect(subjectPrefix({})).toBe("");
  });

  it("returns the staging prefix when both projects are in the allowlist", () => {
    process.env.FIREBASE_PROJECT_ID = "staging-mirror";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn,staging-mirror";
    expect(subjectPrefix({})).toBe("[STG] ");
  });
});

describe("subjectPrefixFromBooking", () => {
  beforeEach(() => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "staging-spark-inn";
  });

  it("reads isTestData off the booking view", () => {
    expect(subjectPrefixFromBooking({ isTestData: true })).toBe("[PROD TEST] ");
    expect(subjectPrefixFromBooking({ isTestData: false })).toBe("");
    expect(subjectPrefixFromBooking({})).toBe("");
  });

  it("is null/undefined safe", () => {
    expect(subjectPrefixFromBooking(null)).toBe("");
    expect(subjectPrefixFromBooking(undefined)).toBe("");
  });
});

describe("subjectPrefix — sendEmail wiring", () => {
  // Source-text guards for the ETR-22.10 wiring. Pin the
  // contract so a future refactor that drops the prefix from
  // the subject line fails here rather than as a missed
  // inbox marker in production.
  const emailSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email.ts"),
    "utf8"
  );

  it("sendEmail accepts a 5th `banner` param and prepends the prefix to the subject", () => {
    // Function signature — the 5th param is `banner?:`. The
    // nested braces in `attachments?: Array<{ ... }>` make a
    // greedy regex brittle, so we anchor on the unique tokens.
    expect(emailSrc).toMatch(/async function sendEmail\(/);
    expect(emailSrc).toMatch(/attachments\?:\s*Array<\{[^}]*\}>/);
    expect(emailSrc).toMatch(/,\s*\/\/[^\n]*ETR-22\.10:[\s\S]*?banner\?:\s*\{/);
    // Prefix computation
    expect(emailSrc).toMatch(/const prefix = subjectPrefix\(\{/);
    // Prepended to subject
    expect(emailSrc).toMatch(/subject:\s*finalSubject/);
    // DLQ entry uses the prefixed subject so a failed send
    // stays consistent with what would have been delivered.
    expect(emailSrc).toMatch(/subject:\s*finalSubject[\s\S]*?failed_emails/);
  });

  it("every booking trigger that has a booking view passes the banner state to sendEmail", () => {
    // The 6 trigger functions that read a booking view must
    // construct a `banner` object and pass it as the 5th arg.
    // Some triggers pass `banner` via a literal at the call
    // site (`sendEmail(..., undefined, banner)`); we accept
    // either shape. We do NOT accept `sendBookingTrigger`'s
    // body before its `await sendEmail(...)` call missing a
    // banner construction — that would be a regression.
    const bookingTriggers = [
      "sendBookingTrigger",
      "sendBookingConfirmedWithBalanceTrigger",
      "sendStaffNewBookingTrigger",
      "sendStaffNewPaymentTrigger",
      "sendEarlyCheckinRequestTrigger",
      "sendEarlyCheckinResolveTrigger"
    ];
    for (const triggerName of bookingTriggers) {
      const exportIdx = emailSrc.indexOf(`export async function ${triggerName}(`);
      expect(exportIdx, `${triggerName} not found`).toBeGreaterThan(0);
      // `sendBookingTrigger` is the longest function here
      // (~6.9KB) because of the per-action subject map. Read
      // a generous window so the assertion reaches the
      // `await sendEmail(...)` call at the bottom.
      const body = emailSrc.slice(exportIdx, exportIdx + 10000);
      expect(
        body,
        `${triggerName} does not construct a banner object for sendEmail`
      ).toMatch(/const banner\s*=\s*\{/);
      expect(
        body,
        `${triggerName} does not pass banner to sendEmail as the 5th arg`
      ).toMatch(/sendEmail\([\s\S]{0,2000}?banner\s*\)/);
    }
  });
});
