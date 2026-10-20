// Per OCT-C3 (2026-10-20, audit
// `plan/project/AUDIT-OCTOBER-2026.md`): the Firestore rules
// must cover the collections the admin app writes from the
// BROWSER.
//
// The BR-12 other add-on catalog (`addOns`) and the BR-12.1
// settings audit trail (`auditLogs`) both shipped WITHOUT a
// rule block. Firestore denies unmatched paths by default, so
// every admin read + write failed with PERMISSION_DENIED — and
// because each error was swallowed, the Settings tab rendered
// its "No add-ons yet" empty state instead of an error. The
// hotel could not see, price, enable, create or delete any
// other add-on, while the guest path (server side, Admin SDK)
// kept selling the read-only pre-seed.
//
// This file is the tripwire that was missing: it pins the rule
// blocks so a future collection cannot ship without one.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rules = readFileSync(
  resolve(__dirname, "../../../firebase/firestore.rules"),
  "utf8"
);

const settingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);

function ruleBlockFor(path: string): string {
  const marker = `match /${path}`;
  const start = rules.indexOf(marker);
  expect(start, `firestore.rules has no match block for /${path}/`).toBeGreaterThan(-1);
  // Start the brace scan AFTER the marker so the path's own
  // braces (`{addOnId}`) are not counted as the block's.
  const open = rules.indexOf("{", start + marker.length);
  expect(open, `firestore.rules has no block body for /${path}/`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    else if (rules[i] === "}") {
      depth--;
      if (depth === 0) return rules.slice(start, i + 1);
    }
  }
  return "";
}

describe("OCT-C3 — Firestore rules cover the admin-app browser writes", () => {
  describe("the addOns catalog (BR-12 / BR-12.1)", () => {
    const block = ruleBlockFor("addOns/{addOnId}");

    it("exists", () => {
      expect(block).not.toBe("");
    });

    it("lets staff read the catalog", () => {
      expect(block).toMatch(/allow\s+read:\s*if\s+isStaff\(\)/);
    });

    it("lets an admin write the catalog", () => {
      expect(block).toMatch(/allow\s+create,\s*update,\s*delete:\s*if\s+isAdmin\(\)/);
    });

    it("does NOT expose the catalog to the public", () => {
      // The guest never reads this collection directly — the
      // public catalog goes through `GET /api/bookings/addons/
      // config` (Admin SDK, rules not applied). A public read
      // here would be an unnecessary exposure.
      expect(block).not.toMatch(/allow\s+read:\s*if\s+true/);
    });
  });

  describe("the auditLogs trail (BR-12.1)", () => {
    const block = ruleBlockFor("auditLogs/{auditId}");

    it("exists", () => {
      expect(block).not.toBe("");
    });

    it("lets staff record a row", () => {
      expect(block).toMatch(/allow\s+create:\s*if\s+isStaff\(\)/);
    });

    it("lets an admin read the trail", () => {
      expect(block).toMatch(/allow\s+read:\s*if\s+isAdmin\(\)/);
    });

    it("is append-only — nobody may rewrite or delete a row", () => {
      expect(block).toMatch(/allow\s+update,\s*delete:\s*if\s+false/);
    });
  });

  describe("the BR-01 / BR-12 audit subcollections (OCT-H6)", () => {
    it("has a collectionGroup rule for breakfastAudit", () => {
      // The Reports "Late changes" metric reads
      // `collectionGroup(db, "breakfastAudit")`. Firestore
      // requires an EXPLICIT collectionGroup rule for that —
      // the same trap the `refunds` group rule documents.
      expect(rules).toMatch(/match\s+\/\{path=\*\*\}\/breakfastAudit\/\{auditId\}/);
    });

    it("has a collectionGroup rule for otherAddOnAudit", () => {
      expect(rules).toMatch(/match\s+\/\{path=\*\*\}\/otherAddOnAudit\/\{auditId\}/);
    });

    it("lets staff read both audit groups", () => {
      const groupBlocks = rules.match(
        /match\s+\/\{path=\*\*\}\/(breakfastAudit|otherAddOnAudit)\/\{auditId\}\s*\{[\s\S]*?\n\s*\}/g
      );
      expect(groupBlocks).not.toBeNull();
      for (const block of groupBlocks!) {
        expect(block).toMatch(/allow\s+read:\s*if\s+isStaff\(\)/);
      }
    });
  });

  describe("the admin app surfaces a failed catalog read", () => {
    it("keeps an error state instead of rendering the empty catalog", () => {
      // The misleading "No add-ons yet" panel was the visible
      // symptom of the swallowed PERMISSION_DENIED.
      expect(settingsSrc).toMatch(/addOnsCatalogError/);
      expect(settingsSrc).toMatch(/data-testid="addons-catalog-error"/);
    });

    it("does not swallow the onSnapshot error", () => {
      expect(settingsSrc).not.toMatch(
        /onSnapshot\(\s*\n?\s*q,\s*\n?\s*\(snap\) => \{[\s\S]{0,4000}?\}\s*,\s*\n?\s*\(\)\s*=>\s*\{\s*\n?\s*setAddOnsCatalogLoading\(false\);/
      );
    });
  });

  it("every collection the admin app writes from the browser has a rule block", () => {
    // The structural tripwire: any collection the admin app
    // touches from the BROWSER (i.e. through the Firestore
    // client SDK, so the rules apply) must have a `match`
    // block. A new collection without one is denied by default
    // and fails silently.
    const browserWritten = [
      "addOns",
      "auditLogs",
      "roomBlocks",
      "staffInventoryHolds",
      "roomDeletionAudit"
    ];
    for (const coll of browserWritten) {
      expect(rules, `firestore.rules has no match block for /${coll}/`).toMatch(
        new RegExp(`match\\s+/${coll.replace(/[{}]/g, "\\$&")}/`)
      );
    }
  });
});
