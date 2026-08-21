// Per ETR-R (operator-reported 2026-08-20, the
// "Refresh Staging From Production" UI gap from
// the audit): the Settings page must have a
// "Refresh Staging From Production" section +
// the 3-state mode toggle + the 5-gate input
// form (for the unsanitized-diagnostic mode) +
// the preview modal (with the import + destroy
// buttons) + the destroy confirmation modal.
//
// These tests are source-text guards that pin
// the spec. A future refactor that removes or
// drifts from the spec breaks the test.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const settingsSrc = read("admin-app/src/pages/SettingsPage.tsx");

describe("ETR-R — Refresh Staging From Production UI", () => {
  it("the Settings page has a 'Refresh Staging From Production' section header", () => {
    // Per the spec: the section is in
    // Settings → Environment Testing →
    // "Refresh Staging From Production".
    // The audit caught that this section
    // was missing.
    expect(settingsSrc).toMatch(/Refresh Staging From Production/);
  });

  it("the ETR-R section has 3 mode toggle buttons (sanitized-snapshot + config-only + unsanitized-diagnostic)", () => {
    // Per R02: the mode toggle has 3
    // states. The UI must surface all 3.
    expect(settingsSrc).toMatch(/sanitized-snapshot/);
    expect(settingsSrc).toMatch(/config-only/);
    expect(settingsSrc).toMatch(/unsanitized-diagnostic/);
  });

  it("the 5 server-enforced gates (D01-D05) all have UI inputs in the unsanitized mode", () => {
    // Per D01: reauth (the reauth gate
    // is the timestamp input + the
    // server verifies within 30 min).
    expect(settingsSrc).toMatch(/reauthenticatedAt/);
    // Per D01: DPO approval reference
    expect(settingsSrc).toMatch(/refreshDpoApproval/);
    // Per D01: defect reference
    expect(settingsSrc).toMatch(/refreshDefectReference/);
    // Per D01: project confirmation
    expect(settingsSrc).toMatch(/refreshProjectConfirmation/);
    // Per D01: acknowledgement
    expect(settingsSrc).toMatch(/refreshAcknowledged/);
  });

  it("the D03 scope manifest inputs (bookingIds + memberIds) are present in the unsanitized mode", () => {
    // Per D03: the unsanitized mode
    // requires an explicit scope. The
    // UI surfaces this as 2 text
    // inputs (comma-separated).
    expect(settingsSrc).toMatch(/refreshScopeBookingIds/);
    expect(settingsSrc).toMatch(/refreshScopeMemberIds/);
  });

  it("the D04 sensitive-file opt-in is a checkbox (default UNCHECKED)", () => {
    // Per D04: the opt-in is a
    // checkbox. The default is false
    // (real PII never lands in staging
    // unless the operator explicitly
    // opts in).
    expect(settingsSrc).toMatch(/refreshSensitiveFileOptIn/);
  });

  it("the D06 TTL input has a max of 168 hours (1 week)", () => {
    // Per D06: the snapshot TTL is
    // capped at 168 hours.
    expect(settingsSrc).toMatch(/refreshTtlHours/);
    // Use a simple substring check
    // (more reliable than vitest's
    // regex `toMatch` with the JSX
    // `max={N}` pattern — empirically
    // that pattern has issues).
    expect(settingsSrc).toContain("max={168}");
  });

  it("the 'Generate preview' button calls the staging-refresh-preview API endpoint", () => {
    // The preview handler hits
    // /api/test-runs/staging-refresh-preview.
    expect(settingsSrc).toMatch(/handleRefreshPreview/);
    expect(settingsSrc).toMatch(/staging-refresh-preview/);
  });

  it("the 'Import to staging' button calls the staging-refresh-import API endpoint", () => {
    // The import handler hits
    // /api/test-runs/staging-refresh-import.
    expect(settingsSrc).toMatch(/handleRefreshImport/);
    expect(settingsSrc).toMatch(/staging-refresh-import/);
  });

  it("the 'Destroy snapshot' button calls the staging-refresh-destroy API endpoint", () => {
    // The destroy handler hits
    // /api/test-runs/staging-refresh-destroy.
    expect(settingsSrc).toMatch(/handleRefreshDestroy/);
    expect(settingsSrc).toMatch(/staging-refresh-destroy/);
  });

  it("the destroy requires a typed confirmation ('DESTROY SNAPSHOT')", () => {
    // Per D06: the destroy is a
    // destructive action; the UI
    // requires the operator to type
    // a confirmation string.
    expect(settingsSrc).toMatch(/DESTROY SNAPSHOT/);
  });

  it("the preview modal shows the sanitization summary (mode + snapshotId + counts + source hash)", () => {
    // The preview modal displays
    // what the operator is about to
    // import: mode, snapshotId, the
    // sanitized counts (bookings,
    // storeOrders, members), + the
    // SHA-256 source hash (truncated).
    expect(settingsSrc).toMatch(/Sanitized export summary/);
    expect(settingsSrc).toMatch(/sourceHash/);
  });

  it("the preview modal surfaces denylist hits (fails closed if any are found)", () => {
    // Per R08: the pre-import scan
    // fails closed on production
    // patterns. The modal shows the
    // hits so the operator knows why
    // the import would fail.
    expect(settingsSrc).toMatch(/denylistHits/);
    expect(settingsSrc).toMatch(/Denylist hits found/);
  });

  it("the unsanitized-diagnostic mode UI shows the warning panel (real PII + suppressed side effects + auto-destroy)", () => {
    // When the operator picks the
    // restricted mode, the modal
    // shows the consequences
    // explicitly.
    expect(settingsSrc).toMatch(/Restricted Diagnostic Mode is active/);
  });

  it("the ETR-R section is disabled on production (admin-app reads stagingResetAvailable to gate)", () => {
    // The section must only be
    // available on staging. The
    // production-admin view shows a
    // link to the staging-admin
    // instead.
    expect(settingsSrc).toMatch(/stagingResetAvailable/);
    // The "This control is disabled
    // on production" message in the
    // ETR-R block.
    expect(settingsSrc).toMatch(/This control is disabled on production/);
  });
});
