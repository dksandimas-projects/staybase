// Per ETR-01a (2026-11-10): the Settings → Environment Testing
// surface must offer a COMBINED "Close & Delete" action on an
// active test run, so the operator does not have to click "Close",
// wait for the row to move to the `closed` state, then hunt for
// the "Clean up" button.
//
// The important property of this feature is that the combined
// action does NOT skip the review gate: it closes first (which is
// what collects the manifest), then opens the SAME confirmation
// modal, and the delete only fires after the operator confirms.
// ETR-10 ("review before deletion") still holds.
//
// These tests are source-text guards that pin the spec. A future
// refactor that removes or drifts from the spec breaks the test.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const settingsSrc = read("admin-app/src/pages/SettingsPage.tsx");

describe("ETR-01a — combined Close & Delete action", () => {
  it("the run history has a 'Close & Delete' button on active runs", () => {
    expect(settingsSrc).toMatch(/Close &amp; Delete|Close & Delete/);
  });

  it("the combined action is rendered inside the active-run branch", () => {
    // The button must live in the `run.status === "active"` branch
    // — a closed run already has its own "Clean up" button, and a
    // cleaned run has neither.
    const activeBranch = settingsSrc.slice(
      settingsSrc.indexOf('run.status === "active" && ('),
      settingsSrc.indexOf('run.status === "closed" && (')
    );
    expect(activeBranch).toMatch(/handleCloseAndDeleteRun/);
  });

  it("the combined handler closes the run BEFORE it opens the confirm modal", () => {
    // The close call is what produces the manifest. If the modal
    // opened without a manifest, the operator would be asked to
    // approve a deletion whose scope they cannot see.
    const handler = settingsSrc.slice(
      settingsSrc.indexOf("const handleCloseAndDeleteRun"),
      settingsSrc.indexOf("// Staging Reset handlers (ETR-S)")
    );
    const closeAt = handler.indexOf("closeTestRun(");
    const modalAt = handler.indexOf("setConfirmDeleteRun(");
    expect(closeAt).toBeGreaterThan(-1);
    expect(modalAt).toBeGreaterThan(-1);
    expect(closeAt).toBeLessThan(modalAt);
  });

  it("the combined handler carries the manifest onto the pending run", () => {
    const handler = settingsSrc.slice(
      settingsSrc.indexOf("const handleCloseAndDeleteRun"),
      settingsSrc.indexOf("// Staging Reset handlers (ETR-S)")
    );
    expect(handler).toMatch(/manifest: result\.manifest/);
  });

  it("the combined handler marks the pending run as closed (so the delete endpoint accepts it)", () => {
    // `POST /api/test-runs/delete` rejects anything that is not
    // `closed` — the server is the authority, and the UI has to
    // agree with it or the delete 400s with "Only closed test runs
    // can be cleaned up."
    const handler = settingsSrc.slice(
      settingsSrc.indexOf("const handleCloseAndDeleteRun"),
      settingsSrc.indexOf("// Staging Reset handlers (ETR-S)")
    );
    expect(handler).toMatch(/status: "closed"/);
  });

  it("the confirmation modal still shows the manifest before deleting", () => {
    // ETR-10 is unchanged: the manifest counts are rendered in the
    // modal, and the delete is the confirm button.
    expect(settingsSrc).toMatch(/Manifest: \{confirmDeleteRun\.manifest\.bookings\} bookings/);
    expect(settingsSrc).toMatch(/onClick=\{handleConfirmCleanup\}/);
  });

  it("the modal copy tells the operator that cancelling leaves the run closed", () => {
    // Without this the operator cannot tell whether cancelling
    // aborted the whole thing or only the delete. The run IS closed
    // by then (that is how the manifest was built), so the copy has
    // to be honest about it.
    expect(settingsSrc).toMatch(/Cancelling leaves the run closed/);
  });

  it("the modal title and confirm label change for the combined path", () => {
    expect(settingsSrc).toMatch(/Close and delete test data\?/);
    expect(settingsSrc).toMatch(/Close & delete data/);
  });

  it("the plain 'Clean up' path resets the modal back to cleanup mode", () => {
    // Otherwise the combined mode's title/copy would leak into the
    // next plain cleanup.
    expect(settingsSrc).toMatch(/setConfirmDeleteMode\("cleanup"\)/);
  });

  it("the plain 'Close' button is still there (the combined action is additive)", () => {
    expect(settingsSrc).toMatch(/handleCloseRun\(run\.id\)/);
  });

  it("the run row stacks on mobile so the third button cannot overflow the viewport", () => {
    // The row was a single non-wrapping `flex items-center justify-between`
    // row. Adding a third button to that cluster pushes the right-hand
    // side past the 375px viewport width (ADMIN-MOBILE.md: "Layout works
    // at 375px width without horizontal page scroll"). The row now
    // stacks on mobile and returns to the inline layout at `sm:`.
    const row = settingsSrc.slice(
      settingsSrc.indexOf("{testRuns.map(run => ("),
      settingsSrc.indexOf("run.status === \"active\" && (")
    );
    expect(row).toMatch(/flex-col/);
    expect(row).toMatch(/sm:flex-row/);
    expect(row).toMatch(/flex-wrap/);
  });

  it("the run row's buttons meet the 44px touch target minimum", () => {
    // CLAUDE.md hard rule: "All form fields minimum 44px touch height".
    // The three buttons in this row are the ones the operator taps
    // from a phone.
    const row = settingsSrc.slice(
      settingsSrc.indexOf("{testRuns.map(run => ("),
      settingsSrc.indexOf("{!testRunsLoading && testRuns.length === 0 && (")
    );
    const buttons = row.match(/min-h-\[44px\]/g) || [];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });
});
