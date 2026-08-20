// Per #11 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §Open Operator-Reported Bugs → #11
// row`): the third spec deliverable is the admin
// "FailedEmailsBanner" — a visual surface for the
// `failed_emails` Firestore DLQ. The banner reads
// "N emails failed to send" + a click-through to
// a list of `{ recipient, subject, error,
// lastAttemptAt, retryCount }` rows. Admin-only —
// front-desk staff can't see failed emails (they
// can't resolve them without Resend credentials).
//
// Test-first (per `plan/docs/CONTRIBUTING.md
// §Testing`): source-text guards (cheap, deterministic,
// <5s). The runtime contract (the listener subscription
// shape, the FailedEmail parsing, the load-time
// isAdmin() guard) is pinned by these guards so a
// future refactor that drops the wire-up breaks here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const dashboardPageSrc = read("admin-app/src/pages/DashboardPage.tsx");
const bannerSrc = read("admin-app/src/components/FailedEmailsBanner.tsx");
const sharedTypesSrc = read("shared/types/index.ts");

describe("#11 — FailedEmailsBanner wire-up (source-text + contract)", () => {
  describe("shared/types/index.ts — FailedEmail contract", () => {
    it("declares the canonical FailedEmail interface with the 5 DLQ fields", () => {
      // The DLQ fields are the contract: any
      // future cron / banner / debug page that
      // reads `failed_emails/` must use this
      // shape. The fields are the minimum the
      // operator's audit trail needs (recipient,
      // subject, error, lastAttemptAt, retryCount).
      expect(sharedTypesSrc).toMatch(
        /export interface FailedEmail \{[\s\S]*?id: string;[\s\S]*?recipient: string;[\s\S]*?subject: string;[\s\S]*?error: string;[\s\S]*?lastAttemptAt: Date;[\s\S]*?retryCount: number;[\s\S]*?\}/m
      );
    });
  });

  describe("admin-app/src/context/AdminContext.tsx — listener", () => {
    it("imports FailedEmail from @spark-inn/shared", () => {
      // The AdminContext listener parses the
      // Firestore docs into `FailedEmail[]` —
      // the shared type is the canonical
      // contract.
      expect(adminContextSrc).toMatch(
        /FailedEmail,?\s*\n\s*PaymentMethodConfig,/
      );
    });

    it("declares a `failedEmails` state + a `failedEmailsLoading` state", () => {
      // The listener manages its own
      // state — admin-app component code
      // reads from this state via
      // `useAdmin()`. The pattern matches
      // the existing `notifications` +
      // `notificationsLoading` pair at the
      // top of the same useEffect block.
      // The two useState lines are at the
      // top of the listener (before the
      // useEffect body), so a small
      // distance allowance (1500 chars)
      // covers any comment lines between
      // them.
      expect(adminContextSrc).toMatch(
        /useState<FailedEmail\[\]>\(\[\]\)/
      );
      expect(adminContextSrc).toMatch(
        /const \[failedEmailsLoading, setFailedEmailsLoading\] = useState\(true\);/
      );
    });

    it("the listener short-circuits on non-admin roles (front-desk staff never see the banner)", () => {
      // The `failed_emails` collection is
      // `isAdmin()`-gated per the firestore.rules
      // write. The listener mirrors the rule:
      // a non-admin role resets the state to
      // empty (so a previous admin's failures
      // don't linger in a non-admin session)
      // and never attaches a snapshot
      // listener (the rules would deny it
      // anyway, but skipping the attachment
      // saves a wasted network round-trip +
      // avoids the `Missing or insufficient
      // permissions` error in the console).
      expect(adminContextSrc).toMatch(
        /if \(!currentUser \|\| currentUser\.role !== "admin"\) \{[\s\S]*?setFailedEmails\(\[\]\);/
      );
    });

    it("the listener uses the MRB-15-09 force-refresh pattern (await getIdToken(true) before onSnapshot)", () => {
      // The `role` custom claim is read
      // by the firestore rules. A stale
      // token → the listener attaches
      // with a stale role claim → the
      // server denies read access → the
      // banner silently empties. The
      // force-refresh pattern is the
      // existing mitigation (same shape
      // as the `notifications` listener
      // immediately above).
      expect(adminContextSrc).toMatch(
        /void auth\.currentUser\?\.getIdToken\(true\)\.then\(\(\) => \{[\s\S]*?if \(cancelled\) return;[\s\S]*?const failedRef = collection\(db, "failed_emails"\);/
      );
    });

    it("the listener queries with orderBy(lastAttemptAt desc) + limit(100) (bounded shape)", () => {
      // The orderBy + limit pins the
      // listener to a bounded shape.
      // Firestore requires an `orderBy` on
      // any range/limit query. 100 is
      // enough for the desk to scan the
      // last few days of failures.
      expect(adminContextSrc).toMatch(
        /orderBy\("lastAttemptAt", "desc"\),\s*limit\(100\)/
      );
    });

    it("the listener maps each doc to the FailedEmail shape (defensive coercion)", () => {
      // The DLQ is server-side + admin-SDK,
      // so the shape is canonical. The
      // defensive coercion handles any
      // future shape-drift (operator
      // manual write, retention cron, etc.).
      expect(adminContextSrc).toMatch(
        /String\(data\.recipient \|\| ""\)/
      );
      expect(adminContextSrc).toMatch(
        /String\(data\.subject \|\| ""\)/
      );
      expect(adminContextSrc).toMatch(
        /String\(data\.error \|\| ""\)/
      );
      expect(adminContextSrc).toMatch(
        /Number\(data\.retryCount \|\| 0\)/
      );
    });

    it("the AdminContextType interface declares failedEmails + failedEmailsLoading", () => {
      // The dashboard's FailedEmailsBanner
      // reads these two fields via
      // `useAdmin()`. Without them the
      // TypeScript compile fails (the
      // component would not have access to
      // the DLQ state).
      expect(adminContextSrc).toMatch(
        /failedEmails: FailedEmail\[\];[\s\S]{0,200}?failedEmailsLoading: boolean;/
      );
    });
  });

  describe("admin-app/src/components/FailedEmailsBanner.tsx — component", () => {
    it("the component reads failedEmails + failedEmailsLoading + currentUser from useAdmin()", () => {
      // The contract: the banner is a thin
      // view layer over the AdminContext
      // state. The actual subscription lives
      // in AdminContext (the MRB-15-09
      // force-refresh pattern is the
      // source-of-truth).
      expect(bannerSrc).toMatch(/const \{ failedEmails, failedEmailsLoading, currentUser \} = useAdmin\(\)/);
    });

    it("the component gates the render on `currentUser.role === \"admin\"` (front-desk never sees the banner)", () => {
      expect(bannerSrc).toMatch(/currentUser\?\.role !== "admin"\) return null/);
    });

    it("the component returns null when there are no failures (no persistent \"all good\" banner)", () => {
      // A persistent "all good" banner
      // would be noise. The banner is a
      // "bad news only" surface.
      expect(bannerSrc).toMatch(/if \(failedEmails\.length === 0\) return null/);
    });

    it("the component shows a loading state on first dashboard load", () => {
      // A silent empty state on first
      // load could be mistaken for "no
      // failures". The loading state
      // surfaces the data-on-its-way
      // signal so the desk knows.
      expect(bannerSrc).toMatch(/data-testid="failed-emails-banner-loading"/);
    });

    it("the banner header has a data-testid + aria-expanded (e2e-locatable + a11y)", () => {
      expect(bannerSrc).toMatch(/data-testid="failed-emails-banner"/);
      expect(bannerSrc).toMatch(/data-testid="failed-emails-banner-header"/);
      expect(bannerSrc).toMatch(/aria-expanded=\{expanded\}/);
    });
  });

  describe("admin-app/src/pages/DashboardPage.tsx — render", () => {
    it("imports + renders <FailedEmailsBanner /> at the top of the dashboard content", () => {
      // The banner sits ABOVE the stats
      // cards (per the spec — "see on every
      // dashboard load" + the IDG alert
      // card is the immediate neighbor) so
      // the desk sees it on first paint.
      expect(dashboardPageSrc).toMatch(
        /import \{ FailedEmailsBanner \} from "\.\.\/components\/FailedEmailsBanner"/
      );
      const bannerIdx = dashboardPageSrc.indexOf("<FailedEmailsBanner />");
      const statsCardIdx = dashboardPageSrc.indexOf("<StatsCard");
      expect(bannerIdx, "expected <FailedEmailsBanner /> to be present").toBeGreaterThan(-1);
      expect(statsCardIdx, "expected <StatsCard to be present").toBeGreaterThan(-1);
      expect(bannerIdx).toBeLessThan(statsCardIdx);
    });
  });
});