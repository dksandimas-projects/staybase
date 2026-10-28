// AI-BROWSER-QA (2026-10-26) — unit tests for the scope reconciliation gate.
//
// The gate is only worth anything if it can FAIL. These tests prove both
// directions: an id that IS accounted for passes, and an id that is NOT
// accounted for fails the gate. A test suite that only proved the first
// direction would be worthless.
//
// No network, no Firestore, no filesystem — the decision logic is pure.
//
//   npx vitest run scripts/qa/__tests__/verify-scope.test.ts

import { describe, it, expect } from "vitest";
import {
  checkScopeReconciliation,
  extractReconciliationRows,
  extractSiblingIds,
  hasReason,
  isDefectId,
  reportMentionsId,
} from "../verify-scope";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** A handoff with a §6 sibling backlog, mirroring the real document. */
const HANDOFF = [
  "# Handoff — 2026-10-23 QA fix batch",
  "",
  "## 4. OPEN — something from an earlier section",
  "",
  "| ID | Finding |",
  "|---|---|",
  "| SEC-9 | This id is NOT in §6 and must not be picked up. |",
  "",
  "## 6. Still to do — Waves 2–5 of \"please fix all\"",
  "",
  "### Wave 2 — role gates and payment-semantics (high)",
  "",
  "| ID | Finding |",
  "|---|---|",
  "| SEC-2 | A member can claim an **unlinked** booking. |",
  "| SEC-3 | Front-desk can redeem rewards points. |",
  "| SEC-4 | No admin gate on the corporate convert path. |",
  "| RPT-2 | \"Charge after checkout\" is UI-only. |",
  "| — | `booking-confirmed` returns 401 for guests. |",
  "",
  "### Wave 3 — backup and reporting cluster",
  "",
  "| ID | Finding |",
  "|---|---|",
  "| F-A6 | The staging-refresh import points at a script that does not exist. |",
  "| §3.7 rules | Not an id — it is a rules paragraph reference. |",
  "| F-B3 | Reports \"Daily Kitchen Prep\" disagrees with the bookings. |",
  "| NO-ID-A67 | The guest bed-setup choice is only offered for one room type. |",
  "| SR-05 | The `additionalPreferences` allowed-values rule is inverted. |",
  "| H8 | The nightly reconciliation cron is not scheduled. |",
  "",
  "### Wave 5 — owner-gated / physically impossible for an agent",
  "",
  "- [ ] Confirm the ~12 email templates in a real inbox.",
  "- [ ] Physical QR scan.",
  "",
  "## 7. Decisions the owner still has to make",
  "",
  "| ID | Finding |",
  "|---|---|",
  "| SEC-77 | This id is AFTER §6 and must not be picked up. |",
].join("\n");

/** A reconciliation document with bold ids in the first cell. */
const RECONCILIATION = [
  "## Handoff Backlog — Wave 2–5 defects not covered by the 2026-10-23 QA report",
  "",
  "| ID | Defect | Fix | Proof in production |",
  "|---|---|---|---|",
  "| **SEC-3** | Front-desk could redeem rewards points. | The gate is now on the server. | HTTP 403. |",
  "| **SEC-4** | No admin gate on the corporate convert path. | Same shape, same fix. | HTTP 403. |",
  "| **F-A6** | The staging-refresh import names a script that does not exist. | File confirmed absent. | S3 |",
  "| **RPT-2** | \"Charge after checkout\" is UI-only. | No server-side reference exists. | S2 |",
  "| **F-B3** | Reports \"Daily Kitchen Prep\" disagrees with the bookings. | Confirmed unchanged. | S2 |",
  "| **NO-ID-A67** | The guest bed-setup choice is offered for one room type only. | 1 of 5 room types. | S3 |",
  "| **SR-05** | The allowed-values rule is inverted. | Fixed as RPT-03. | Verified. |",
  "| **H8** | No nightly money reconciliation. | Scheduled `30 4 * * *`. | HTTP 401 unauthenticated. |",
  "| **SEC-2** | A member can claim an unlinked booking. | FIXED. | Proved live: HTTP 400. |",
].join("\n");

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

describe("extractSiblingIds", () => {
  it("reads the id column of HANDOFF §6 only", () => {
    const ids = extractSiblingIds(HANDOFF);
    expect(ids).toContain("SEC-2");
    expect(ids).toContain("H8");
    // §4 and §7 are outside §6 and must not be harvested.
    expect(ids).not.toContain("SEC-9");
    expect(ids).not.toContain("SEC-77");
  });

  it("ignores first cells that are not defect ids", () => {
    const ids = extractSiblingIds(HANDOFF);
    expect(ids).not.toContain("—");
    expect(ids).not.toContain("§3.7 rules");
    expect(ids).not.toContain("booking-confirmed");
    expect(ids).not.toContain("Wave 5");
    // The Wave-5 checklist bullets are not table rows at all.
    expect(ids).not.toContain("Confirm the ~12 email templates in a real inbox.");
  });

  it("keeps the real ids, deduped, in first-seen order", () => {
    expect(extractSiblingIds(HANDOFF)).toEqual([
      "SEC-2",
      "SEC-3",
      "SEC-4",
      "RPT-2",
      "F-A6",
      "F-B3",
      "NO-ID-A67",
      "SR-05",
      "H8",
    ]);
  });

  it("returns nothing when §6 is absent", () => {
    expect(extractSiblingIds("# Only a title\n\nNo sections here.\n")).toEqual([]);
  });
});

describe("isDefectId", () => {
  it("accepts the real id shapes", () => {
    for (const id of ["SEC-2", "RPT-18", "F-A6", "F-C3", "NO-ID-A67", "SR-05", "H8"]) {
      expect(isDefectId(id)).toBe(true);
    }
  });

  it("rejects the non-id first cells", () => {
    for (const cell of ["—", "§3.7 rules", "booking-confirmed", "Wave 2", "ID", "Finding"]) {
      expect(isDefectId(cell)).toBe(false);
    }
  });

  it("rejects prose and filenames that merely look id-ish", () => {
    expect(isDefectId("HANDOFF-2026-10-23.md")).toBe(false);
    expect(isDefectId("QA-REPORT-2026-10-23.md")).toBe(false);
    expect(isDefectId("the nightly cron is not scheduled")).toBe(false);
  });

  it("strips surrounding emphasis before testing", () => {
    expect(isDefectId("**SEC-3**")).toBe(true);
    expect(isDefectId("  SEC-3  ")).toBe(true);
  });
});

describe("extractReconciliationRows", () => {
  it("reads the bold id column and the reason cell", () => {
    const rows = extractReconciliationRows(RECONCILIATION);
    const byId = new Map(rows.map((r) => [r.id, r.reason]));
    expect(byId.get("SEC-3")).toContain("Front-desk could redeem rewards points");
    expect(byId.get("H8")).toContain("nightly money reconciliation");
  });

  it("does not invent ids out of the prose", () => {
    const rows = extractReconciliationRows(RECONCILIATION);
    expect(rows.map((r) => r.id)).not.toContain("§3.7 rules");
    expect(rows.map((r) => r.id)).not.toContain("—");
  });

  it("keeps a row whose reason cell is empty, with an empty reason", () => {
    const rows = extractReconciliationRows(
      "| ID | Defect | Fix |\n|---|---|---|\n| **SEC-2** |  | FIXED. |"
    );
    expect(rows).toEqual([{ id: "SEC-2", reason: "" }]);
  });
});

describe("hasReason", () => {
  it("treats an empty (or dash-only) reason as no reason", () => {
    expect(hasReason("")).toBe(false);
    expect(hasReason("   ")).toBe(false);
    expect(hasReason("—")).toBe(false);
    expect(hasReason("**FIXED**")).toBe(true);
    expect(hasReason("out of scope: owner-gated")).toBe(true);
  });
});

describe("reportMentionsId", () => {
  it("matches whole words only, case-insensitively", () => {
    expect(reportMentionsId("the finding SEC-2 is open", "SEC-2")).toBe(true);
    expect(reportMentionsId("the finding sec-2 is open", "SEC-2")).toBe(true);
    expect(reportMentionsId("the finding SEC-2x is open", "SEC-2")).toBe(false);
    expect(reportMentionsId("SEC-20 and SEC-21", "SEC-2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE GATE — both directions
// ---------------------------------------------------------------------------

describe("checkScopeReconciliation", () => {
  it("DIRECTION 1 — an id present in the report is accounted for", () => {
    const result = checkScopeReconciliation({
      reportText: "## 7. Findings\n\n| SEC-2 | member can claim an unlinked booking | FAIL |\n",
      siblingIds: ["SEC-2"],
      reconciliationRows: [],
    });
    expect(result.accounted).toEqual(["SEC-2"]);
    expect(result.missing).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.detail[0].status).toBe("accounted-by-report");
  });

  it("DIRECTION 2 — an id absent from the report but reconciled WITH a reason is accounted for", () => {
    const result = checkScopeReconciliation({
      reportText: "## 7. Findings\n\nNothing about the kitchen prep here.\n",
      siblingIds: ["F-B3"],
      reconciliationRows: [{ id: "F-B3", reason: "Confirmed unchanged: the date loop is still broken." }],
    });
    expect(result.accounted).toEqual(["F-B3"]);
    expect(result.missing).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.detail[0].status).toBe("accounted-by-reconciliation");
  });

  it("DIRECTION 3 — an id absent from BOTH the report and the reconciliation is MISSING (the gate fails)", () => {
    const result = checkScopeReconciliation({
      reportText: "## 7. Findings\n\nNothing relevant here.\n",
      siblingIds: ["NO-ID-A69"],
      reconciliationRows: [{ id: "SEC-3", reason: "Closed since the QA report." }],
    });
    expect(result.missing).toEqual(["NO-ID-A69"]);
    expect(result.accounted).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("NO-ID-A69");
    expect(result.detail[0].status).toBe("missing");
  });

  it("DIRECTION 4 — an id with an EMPTY reason cell is MISSING (the gate fails)", () => {
    const result = checkScopeReconciliation({
      reportText: "## 7. Findings\n\nNothing relevant here.\n",
      siblingIds: ["F-A6"],
      reconciliationRows: [{ id: "F-A6", reason: "" }],
    });
    expect(result.missing).toEqual(["F-A6"]);
    expect(result.accounted).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.detail[0].status).toBe("missing");
    expect(result.detail[0].note).toContain("EMPTY reason cell");
  });

  it("DIRECTION 4b — a whitespace-only reason cell is still MISSING", () => {
    const result = checkScopeReconciliation({
      reportText: "",
      siblingIds: ["F-A6"],
      reconciliationRows: [{ id: "F-A6", reason: "   " }],
    });
    expect(result.missing).toEqual(["F-A6"]);
  });

  it("a mixed batch accounts for what it can and fails on the rest", () => {
    const result = checkScopeReconciliation({
      reportText: "The report covers SEC-2 and H8.",
      siblingIds: ["SEC-2", "H8", "RPT-2", "F-D4"],
      reconciliationRows: [{ id: "RPT-2", reason: "Still open — the server never reads the setting." }],
    });
    expect(result.accounted).toEqual(["SEC-2", "H8", "RPT-2"]);
    expect(result.missing).toEqual(["F-D4"]);
    expect(result.detail.map((d) => d.status)).toEqual([
      "accounted-by-report",
      "accounted-by-report",
      "accounted-by-reconciliation",
      "missing",
    ]);
  });

  it("warns when the sibling list is empty — the gate must not pass vacuously", () => {
    const result = checkScopeReconciliation({
      reportText: "",
      siblingIds: [],
      reconciliationRows: [],
    });
    expect(result.missing).toEqual([]);
    expect(result.advisories.join(" ")).toContain("vacuous");
  });
});

// ---------------------------------------------------------------------------
// end-to-end over the real documents' shapes
// ---------------------------------------------------------------------------

describe("end-to-end over the extracted fixture documents", () => {
  it("reconciles every sibling id that is accounted for, and fails on the rest", () => {
    const siblingIds = extractSiblingIds(HANDOFF);
    const reconciliationRows = extractReconciliationRows(RECONCILIATION);

    const passing = checkScopeReconciliation({
      reportText: "SEC-3 and SEC-4 are closed; H8 is scheduled.",
      siblingIds,
      reconciliationRows,
    });
    // SEC-3, SEC-4 and H8 come from the report; the rest from the reconciliation.
    expect(passing.missing).toEqual([]);
    expect(passing.accounted).toHaveLength(siblingIds.length);

    const failing = checkScopeReconciliation({
      reportText: "Nothing at all.",
      siblingIds,
      reconciliationRows: reconciliationRows.filter((r) => r.id !== "SEC-2"),
    });
    expect(failing.missing).toEqual(["SEC-2"]);
  });
});
