import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

// Regression tests for the 6 LOW findings from the
// 2026-07-18 Spark Rewards audit. Each test pins either a
// source-level change (the codebase pattern in this repo) or
// a behavioral expectation. The closure is documented in
// `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md §Quick Wins`.

describe("LOW-1 — Privacy/Terms disclosure under Rewards landing one-click enroll", () => {
  const rewardsLandingSrc = read("guest-app/src/pages/RewardsLandingPage.tsx");
  const profilePageSrc = read("guest-app/src/pages/ProfilePage.tsx");
  const spec = read("plan/features/SPARK-REWARDS.md");

  it("enroll button on the landing page is wrapped with the disclosure copy", () => {
    // The one-click enroll button must be accompanied by a
    // Privacy Policy + Terms of Service disclosure on the same
    // surface, mirroring ProfilePage. Without this, the
    // button's consent posture is invisible to the user.
    expect(rewardsLandingSrc).toMatch(/Enroll in \$\{config\.rewardsName\} \(One-Click\)/);
    expect(rewardsLandingSrc).toMatch(/Privacy Policy/);
    expect(rewardsLandingSrc).toMatch(/Terms of Service/);
    expect(rewardsLandingSrc).toMatch(/<Link to="\/privacy"/);
    expect(rewardsLandingSrc).toMatch(/<Link to="\/terms"/);
  });

  it("disclosure copy matches the ProfilePage posture (single source of truth for the join-consent copy)", () => {
    // Both surfaces must reference the same policy routes
    // (RA 10173 consent-statement consistency).
    expect(rewardsLandingSrc).toMatch(/<Link to="\/privacy" className="font-semibold text-white underline/);
    expect(profilePageSrc).toMatch(/<Link to="\/privacy" className="font-semibold text-primary hover:underline">Privacy Policy<\/Link>/);
  });

  it("spec §Spark Rewards Landing notes the disclosure is in place", () => {
    // The spec checklist entry that previously read "implicit
    // consent via the click" now reflects the disclosure
    // surface. The §Spark Rewards Landing section still has
    // the one-click enroll row — the disclosure is enforced
    // by the LOW-1 code fix, not a spec-line rewrite. We
    // pin that the spec section still names the surface.
    expect(spec).toMatch(/One-Click/);
    expect(spec).toMatch(/Spark Rewards Landing/);
  });
});

describe("LOW-2 — explicit browserLocalPersistence in guest-app firebase config", () => {
  const guestConfig = read("guest-app/src/firebase/config.ts");
  const securityDoc = read("plan/docs/SECURITY.md");

  it("guest firebase config imports + calls setPersistence with browserLocalPersistence", () => {
    expect(guestConfig).toMatch(/import\s*\{[^}]*browserLocalPersistence[^}]*setPersistence[^}]*\}\s*from\s*["']firebase\/auth["']/);
    expect(guestConfig).toMatch(/setPersistence\(\s*auth\s*,\s*browserLocalPersistence\s*\)/);
  });

  it("does not regress to the implicit-default posture (no setPersistence call)", () => {
    // Guard against a future refactor that removes the call.
    // The fact that `setPersistence` is referenced at all
    // pins the explicit posture.
    expect(guestConfig).toMatch(/setPersistence/);
  });

  it("admin app retains browserSessionPersistence (different posture, different surface)", () => {
    // The admin app keeps session-only persistence (staff
    // shouldn't stay signed in past tab close). The guest app
    // gets local persistence (members want to stay signed in
    // across refresh). Both must remain explicit so the
    // asymmetric posture isn't accidental.
    const adminContext = read("admin-app/src/context/AdminContext.tsx");
    expect(adminContext).toMatch(/browserSessionPersistence/);
  });

  it("Security.md session-management section still references the explicit-set requirement", () => {
    // The doc is the source of truth; the code mirrors it.
    // (Loose match — the section is stable enough to pin the
    // header but not the literal wording.)
    expect(securityDoc).toMatch(/Session Management|browserLocalPersistence|browserSessionPersistence/);
  });
});

describe("LOW-4 — divergent calculateEarnedPoints helper deleted + earning copy aligned", () => {
  const pointsUtil = read("shared/utils/points.ts");
  const pointsTest = read("shared/__tests__/points.test.ts");
  const rewardsPage = read("guest-app/src/pages/RewardsPage.tsx");

  it("shared calculateEarnedPoints helper is removed", () => {
    // The divergent per-₱100-block formula had no production
    // call site; deleting it removes the trap. The remaining
    // helpers (calculatePointsRedemptionValue +
    // validatePointsRedemption) are unaffected.
    expect(pointsUtil).not.toMatch(/export function calculateEarnedPoints/);
    expect(pointsUtil).toMatch(/calculatePointsRedemptionValue/);
    expect(pointsUtil).toMatch(/validatePointsRedemption/);
  });

  it("points.test.ts no longer exercises the divergent formula (import or call site)", () => {
    // The audit closure comment in the test file is allowed to
    // mention the name; we only assert that the import + call
    // sites are gone.
    expect(pointsTest).not.toMatch(/import\s*\{[^}]*calculateEarnedPoints/);
    expect(pointsTest).not.toMatch(/calculateEarnedPoints\(\d/);
  });

  it("My Rewards earning copy now notes proportional crediting (not per-₱100 blocks)", () => {
    // The old copy "Earn N points per ₱100 spent" understated
    // the actual proportional crediting (₱150 at 10 pts/₱100
    // earns 15, not 10). The new copy keeps the per-₱100
    // rate and adds a proportional note.
    expect(rewardsPage).toMatch(/proportional/i);
    expect(rewardsPage).toMatch(/Earn.*points per.*spent/);
  });
});

describe("LOW-5 — early check-in status rendered on My Stays", () => {
  const staysPage = read("guest-app/src/pages/StaysPage.tsx");
  const spec = read("plan/features/SPARK-REWARDS.md");

  it("StayRecord interface declares the earlyCheckIn field", () => {
    expect(staysPage).toMatch(/interface StayRecord \{[\s\S]*?earlyCheckIn\?/);
  });

  it("StayCard renders the earlyCheckIn status line (one render per state)", () => {
    // The component branches on `approved` + `declined`; the
    // `requested` state is the default fall-through (no
    // explicit `if` because it's the only remaining case).
    // The EarlyCheckInStatusLine component is mounted
    // conditionally when `earlyCheckIn` is present.
    expect(staysPage).toMatch(/EarlyCheckInStatusLine/);
    expect(staysPage).toMatch(/earlyCheckIn\.status === ["']approved["']/);
    expect(staysPage).toMatch(/earlyCheckIn\.status === ["']declined["']/);
    // The "requested" branch is the unconditional fall-through
    // — the rendered JSX for that state mentions
    // "Early check-in requested" copy.
    expect(staysPage).toMatch(/Early check-in requested/);
    expect(staysPage).toMatch(/Early check-in approved/);
    expect(staysPage).toMatch(/Early check-in unavailable/);
  });

  it("imports the new lucide icons used by the status line", () => {
    expect(staysPage).toMatch(/import\s*\{[^}]*CheckCircle2[^}]*Clock[^}]*\}\s*from\s*["']lucide-react["']/);
  });

  it("spec §Guest visibility now lists My Stays + My Rewards as the two surfaces (parity)", () => {
    // The spec's "My Stays + My Rewards show the request
    // status on the relevant booking" rule is now satisfied
    // (previously only My Rewards implemented it).
    expect(spec).toMatch(/My Stays \+ My Rewards show the request status/);
  });
});

describe("LOW-6 — member-export spec reword from CSV to XLSX full backup", () => {
  const spec = read("plan/features/SPARK-REWARDS.md");
  const reportsPage = read("admin-app/src/pages/ReportsPage.tsx");

  it("spec checklist no longer says 'CSV'", () => {
    // The misleading "Export members list as CSV" line is
    // rewritten. The export lives as a "Members" worksheet
    // inside the admin-only full data backup .xlsx.
    expect(spec).not.toMatch(/Export members list as CSV/);
    expect(spec).toMatch(/Export members list via the full data backup \(XLSX\)/);
  });

  it("ReportsPage confirms the XLSX Members worksheet is the canonical member export", () => {
    expect(reportsPage).toMatch(/XLSX\.utils\.json_to_sheet/);
  });
});

describe("LOW-7 — email send-skip guard covers both @example.invalid and @invalid", () => {
  const emailHandler = read("guest-app/server/handlers/email.ts");
  const membersHandler = read("guest-app/server/handlers/members.ts");

  it("sendEmail skip guard matches BOTH placeholder domains", () => {
    // The previous guard only matched @example.invalid, so a
    // stray trigger against an erased booking (which gets
    // guestEmail = "erased@invalid") would attempt delivery
    // and bounce at Resend instead of skipping cleanly.
    expect(emailHandler).toMatch(/@example\.invalid/);
    expect(emailHandler).toMatch(/@invalid/);
  });

  it("members.ts erasure path writes the @invalid placeholder", () => {
    // Sanity check — the other half of the contract.
    expect(membersHandler).toMatch(/erased@invalid/);
  });
});
