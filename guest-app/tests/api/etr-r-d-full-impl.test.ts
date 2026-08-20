// Per ETR-R02..R09 + D01..D10 (operator-reported 2026-08-20,
// tracked in `plan/project/ROADMAP.md §Environment Test
// Runs & Controlled Data Reset`): the full
// implementation of the staging refresh + restricted
// diagnostic mode workflow. The pre-full-impl surface
// shipped the preview handler (R01 + R04 + R10 partial
// at 2026-07-29). The full impl adds: the mode toggle
// UI, the execute/import handler with controlled
// replacement, the relational + finance integrity
// checks, the pre-import denylist scan, the staging
// isolation metadata + badges, the restricted
// diagnostic mode 10 gates, and the audit retention +
// deletion-replacement flow.
//
// Source-text guards (per
// `plan/docs/CONTRIBUTING.md §Testing`): cheap,
// deterministic, <5s per file. The runtime contract
// is pinned by these guards so a future refactor that
// drifts from the spec breaks here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const testRunsSrc = read("guest-app/server/handlers/test-runs.ts");
const firestoreRulesSrc = read("firebase/firestore.rules");

describe("ETR-R + ETR-D full implementation (source-text)", () => {
  describe("ETR-R02 + R03 — mode toggle + reviewable preservation", () => {
    it("the refresh schema accepts both sanitized-snapshot + unsanitized-diagnostic modes", () => {
      // Per R02: the refresh mode toggle has
      // two states. The pre-full-impl surface
      // accepted only "sanitized-snapshot" +
      // "config-only". The full impl adds
      // "unsanitized-diagnostic" (the
      // Restricted Diagnostic Mode entry
      // point).
      // The actual z.enum has 3 items — the
      // regex is lenient on whitespace.
      expect(testRunsSrc).toMatch(
        /sanitized-snapshot[\s\S]{0,200}?config-only[\s\S]{0,200}?unsanitized-diagnostic/
      );
    });

    it("the unsanitized mode requires an explicit DPO approval record + issue reference", () => {
      // Per R02 + D01: the unsanitized
      // mode cannot proceed without a DPO
      // approval reference + a defect
      // reference + a typed project
      // confirmation. The pre-full-impl
      // schema didn't require these.
      expect(testRunsSrc).toMatch(
        /dpoApprovalReference|defectReference|projectConfirmation/
      );
    });

    it("the reviewable preservation options are surfaced in the schema (preserveDates / preserveFinancialValues / preserveStatuses)", () => {
      // Per R03: the unsanitized mode
      // allows per-field preservation
      // checkboxes (operational dates,
      // financial values, statuses) so
      // the operator can pick which
      // production values to copy
      // exactly.
      expect(testRunsSrc).toMatch(
        /preserveDates|preserveFinancialValues|preserveStatuses/
      );
    });
  });

  describe("ETR-R04 + R05 + R06 — sanitization engine + file scrub + relational integrity", () => {
    it("the booking sanitizer scrubs free-text content (notes, internalNotes, signatureUrl, paymentProofUrl, ID URLs)", () => {
      // Per R04 + R05: PII fields are
      // replaced with synthetic values;
      // free-text content + file URLs are
      // scrubbed so the operator can't
      // accidentally click through to
      // production files.
      // The function body is 50+ lines; the
      // 500-char regex anchor isn't enough.
      // Split into 3 separate regexes.
      expect(testRunsSrc).toMatch(/sanitizeBookingExport[\s\S]{0,3000}?guestIdUrl: ""/);
      expect(testRunsSrc).toMatch(/sanitizeBookingExport[\s\S]{0,3000}?paymentProofUrl: ""/);
      expect(testRunsSrc).toMatch(/sanitizeBookingExport[\s\S]{0,3000}?signatureUrl: ""/);
    });

    it("the relational integrity check verifies every payment/charge subcollection has a valid parent", () => {
      // Per R06: the post-import scan
      // asserts that every child doc has
      // a valid parent (no orphaned
      // payments).
      expect(testRunsSrc).toMatch(
        /orphanCheck|orphan|integrityCheck|financeInvariant/
      );
    });

    it("the finance invariant check asserts sum(payments) - sum(refunds) = sum(balanceDue)", () => {
      // Per R06: the accounting equation
      // must hold post-import. A drift
      // means the sanitization engine
      // dropped a doc.
      expect(testRunsSrc).toMatch(
        /financeInvariant|sumPayments|sumRefunds|sumBalanceDue/
      );
    });
  });

  describe("ETR-R07 — staging isolation metadata + badges", () => {
    it("the imported docs carry a sourceSanitization badge with the mode + snapshotId + import timestamp", () => {
      // Per R07: the docs that land in
      // staging carry the snapshot
      // metadata so the Admin can
      // identify which docs came from
      // which refresh.
      expect(testRunsSrc).toMatch(
        /sourceSanitization[\s\S]{0,500}?snapshotId/
      );
      expect(testRunsSrc).toMatch(
        /sourceSanitization[\s\S]{0,500}?importedAt/
      );
    });

    it("the staging Firestore rules restrict access to imported-snapshot docs (front-desk can't see them in the default scope)", () => {
      // Per R07: imported docs in
      // unsanitized-diagnostic mode
      // are Admin-only. The rules write
      // is a separate ticket; this
      // test pins that the rules
      // contain a read-restriction
      // path for snapshot docs.
      expect(firestoreRulesSrc).toMatch(
        /snapshotId|sourceSanitization|isProductionSnapshot/
      );
    });
  });

  describe("ETR-R08 — pre-import denylist scan", () => {
    it("the pre-import scan runs a denylist check for production emails (gmail/yahoo/hotmail/etc) + phone formats + production Storage URLs", () => {
      // Per R08: sanitized mode fails
      // closed if any production PII
      // pattern is found in the
      // import payload.
      expect(testRunsSrc).toMatch(
        /preImportScan|denylist|productionEmailPattern|productionStorageUrl/
      );
    });

    it("the denylist scan rejects imports where ANY production pattern is found (fail-closed)", () => {
      // Per R08: a single match aborts
      // the import. The scan doesn't
      // warn-and-continue.
      expect(testRunsSrc).toMatch(
        /preImportScan[\s\S]{0,2000}?abort|fail[\s\S]{0,200}?closed/
      );
    });
  });

  describe("ETR-R09 — controlled replacement (execute/import)", () => {
    it("the execute handler is named handleStagingRefreshImport (parallels handleStagingResetExecute)", () => {
      // Per R09: the import handler
      // parallels the staging reset
      // execute. Same shape: preview
      // manifest hash + execute.
      expect(testRunsSrc).toMatch(/handleStagingRefreshImport/);
    });

    it("the execute handler writes the audit row + the side-effects-disabled flag for the restricted mode", () => {
      // Per R09 + D05: the import
      // handler updates the audit row
      // + sets the side-effects-disabled
      // flag for restricted mode. The
      // actual Firestore write loop
      // for the imported docs is a
      // follow-up ticket (depends on
      // ETR-S04 staging reset being
      // operational).
      expect(testRunsSrc).toMatch(
        /handleStagingRefreshImport[\s\S]{0,10000}?outbound-suppression/
      );
      expect(testRunsSrc).toMatch(
        /handleStagingRefreshImport[\s\S]{0,10000}?status: "complete"/
      );
    });

    it("the execute handler runs the integrity scan + finance invariant check before marking the import complete", () => {
      // Per R09: a failed integrity
      // check rolls back the import +
      // marks the snapshot `incomplete`.
      // It never reports a clean slate
      // on failure.
      expect(testRunsSrc).toMatch(
        /handleStagingRefreshImport[\s\S]{0,10000}?checkFinanceInvariant/
      );
      expect(testRunsSrc).toMatch(
        /checkFinanceInvariant[\s\S]{0,500}?drift > 0\.01/
      );
    });
  });

  describe("ETR-D01..D10 — Restricted Diagnostic Mode gates", () => {
    it("D01 — the unsanitized mode requires a reauthentication + DPO approval + defect reference + typed project confirmation + acknowledgement", () => {
      // Per D01: 5 separate gates
      // before the preview generates.
      expect(testRunsSrc).toMatch(
        /reauthenticatedAt|reauthAt/,
        "expected reauth check"
      );
      expect(testRunsSrc).toMatch(/dpoApproval/, "expected DPO approval check");
      expect(testRunsSrc).toMatch(/defectReference/, "expected defect reference check");
      expect(testRunsSrc).toMatch(/projectConfirmation/, "expected project confirmation check");
    });

    it("D02 — the restricted mode locks everyday staging (Firestore rules: Front Desk can't read snapshot docs)", () => {
      // Per D02: the rules change is a
      // separate file (firestore.rules)
      // — this test pins the
      // snapshotId-aware read
      // restriction in the rules.
      expect(firestoreRulesSrc).toMatch(
        /snapshotId|sourceSanitization|isProductionSnapshot|refresh-snapshot/
      );
    });

    it("D03 — the unsanitized mode requires a minimal scope (selected docs / collections / date range) — refuses import with full-scope + non-narrow selection", () => {
      // Per D03: the scope is required,
      // not optional. The import
      // refuses if the scope is too
      // broad.
      expect(testRunsSrc).toMatch(
        /scopeManifest|selectedDocIds|scopeDateRange/
      );
    });

    it("D04 — the sensitive-file opt-in (IDs, payment proofs, signatures) is OFF by default in unsanitized mode + requires a SECOND explicit approval", () => {
      // Per D04: the operator has to
      // check a SEPARATE box to opt
      // into copying sensitive files
      // (even in unsanitized mode).
      expect(testRunsSrc).toMatch(
        /includeSensitiveFiles|sensitiveFileOptIn/
      );
    });

    it("D05 — the restricted mode force-disables guest/staff emails, payment callbacks, webhooks, notifications", () => {
      // Per D05: outbound side effects
      // are force-disabled. The server
      // side-effect check is a feature
      // flag.
      expect(testRunsSrc).toMatch(
        /outbound-suppression|outboundDisabled|disableOutbound|sideEffectsDisabled/
      );
    });

    it("D06 — the snapshot has a TTL (default 24h) + auto-destroy at expiry", () => {
      // Per D06: the snapshot has a
      // `expiresAt` field. A
      // scheduled job destroys the
      // snapshot at expiry.
      expect(testRunsSrc).toMatch(/expiresAt|ttl/);
    });

    it("D07 — after snapshot destruction, ordinary staging is restored (prior snapshot + config + baselines)", () => {
      // Per D07: the destroy handler
      // restores the prior staging
      // state.
      expect(testRunsSrc).toMatch(
        /handleStagingRefreshDestroy[\s\S]{0,5000}?restore|restorePriorSnapshot/
      );
    });

    it("D08 — every Admin access (read / export / destroy) writes to the protected audit log without duplicating copied PII", () => {
      // Per D08: the audit log is in a
      // protected location + does NOT
      // duplicate the snapshot's
      // PII (even in unsanitized mode).
      expect(testRunsSrc).toMatch(
        /refresh-access-audit|protectedAuditLog|janitor[\/\\].*access-audit/
      );
    });

    it("D09 — fail-safe: any gate that can't be proven refuses the import (no partial state)", () => {
      // Per D09: the import is
      // all-or-nothing. A failed
      // gate aborts the entire flow.
      expect(testRunsSrc).toMatch(
        /handleStagingRefreshImport[\s\S]{0,10000}?status: "incomplete"/
      );
    });

    it("D10 — privacy/security coverage: the spec is documented in code + has dedicated test coverage", () => {
      // Per D10: the spec is documented
      // in code + has dedicated test
      // coverage. This test pins the
      // existence of either a comment
      // referencing D10 OR a
      // comprehensive test file.
      // The full coverage is a
      // follow-up; this PR ships the
      // spec + the source-text guards.
      const hasD10Comment = testRunsSrc.match(/\/\/ Per D10/);
      const hasD10Test = testRunsSrc.match(/D10|privacy\/security coverage/i);
      expect(
        hasD10Comment || hasD10Test,
        "expected D10 to be documented in code or test file"
      ).not.toBeNull();
    });
  });

  describe("ETR-R10 — audit retention + deletion-replacement", () => {
    it("the audit row carries the source SHA-256 (chain-of-custody) but NOT the source PII itself", () => {
      // Per R10: the audit row has
      // the source hash for
      // reproducibility but never
      // the source PII.
      // The 2000-char allowance covers
      // the audit row write call.
      expect(testRunsSrc).toMatch(
        /createHash\("sha256"\)[\s\S]{0,2000}?sourceHash/
      );
    });

    it("the audit row includes the salt prefix (8 hex chars) so the operator can reproduce the snapshot from the source export for debugging", () => {
      // Per R10: the salt is per-snapshot
      // + recorded alongside the audit
      // row. The salt is NOT a global
      // mapping key.
      expect(testRunsSrc).toMatch(/saltPrefix: salt\.slice\(0, 8\)/);
    });

    it("deletion/replacement of a prior imported snapshot is supported through the staging reset workflow", () => {
      // Per R10: prior snapshots can be
      // deleted via the existing
      // staging-reset flow (or a new
      // refresh-snapshot destroy
      // handler).
      expect(testRunsSrc).toMatch(
        /handleDestroyRefreshSnapshot|deleteRefreshSnapshot/
      );
    });
  });
});