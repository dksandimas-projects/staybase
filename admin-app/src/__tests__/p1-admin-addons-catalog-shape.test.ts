import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * P1-ADDON-CATALOG-SHAPE (2026-10-22)
 *
 * Two defects the owner found in the live admin app on 2026-10-22:
 *
 * 1. **The add-on catalog rendered as empty even though the endpoint was
 *    serving rows.** The public catalog endpoint
 *    (`GET /api/bookings/addons/config`) answers
 *
 *        { success: true, addOns: [...], otherAddOnsEnabled, preSeeded }
 *
 *    — the rows live under `addOns`. The BREAKFAST config endpoint
 *    answers `{ success: true, data: { ... } }` instead, and the admin
 *    app's two add-on consumers were written against the BREAKFAST shape:
 *    they read `data.data`, which is always `undefined` on the add-ons
 *    endpoint. The catalog therefore stayed `null` and the drawer rendered
 *    "The add-on catalog is empty. Add a row in Settings → Other Add-Ons
 *    to start selling add-ons." — the exact opposite of the truth.
 *
 *    The rows must be used AS-IS: the endpoint already applied the
 *    per-row `isEnabled` filter and the hotel-wide master switch, and the
 *    public payload carries no `isEnabled` field at all — re-running
 *    `getEnabledAddOnsByHotel` client-side would drop EVERY row.
 *
 * 2. **A source comment was painted as UI text.** A bare `//` line inside
 *    JSX children is not a comment: JSX parses it as literal text and the
 *    browser renders it. The booking drawer's overview summary carried a
 *    BR-08 note written that way, so the staff saw the whole comment
 *    above the "4 meals" figure.
 */

const SRC = join(__dirname, "..");
const APP_SRC = join(SRC, "..", "..", "guest-app", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === "dist") continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const drawer = readFileSync(join(SRC, "components/BookingDrawerWorkspace.tsx"), "utf8");
const walkinGrid = readFileSync(join(SRC, "components/otherAddOns/WalkinOtherAddOnGrid.tsx"), "utf8");

describe("P1-ADDON-CATALOG-SHAPE — the admin app reads the public catalog payload", () => {
  it("the booking drawer reads the rows from `addOns`, not from `data`", () => {
    expect(drawer).toMatch(/Array\.isArray\(data\?\.addOns\)/);
    expect(drawer).not.toMatch(/Array\.isArray\(data\?\.data\)/);
  });

  it("the walk-in other-add-ons grid reads the rows from `addOns`, not from `data`", () => {
    expect(walkinGrid).toMatch(/Array\.isArray\(data\?\.addOns\)/);
    expect(walkinGrid).not.toMatch(/Array\.isArray\(data\?\.data\)/);
  });

  it("neither consumer re-filters the public payload (it carries no isEnabled)", () => {
    // The endpoint already applied the per-row filter + the master
    // switch, and the public payload has no `isEnabled` field — so a
    // client-side `getEnabledAddOnsByHotel` would drop every row.
    expect(drawer).not.toMatch(/getEnabledAddOnsByHotel\s*\(/);
    expect(walkinGrid).not.toMatch(/getEnabledAddOnsByHotel\s*\(/);
  });

  it("the drawer's empty state tells the two empty reasons apart", () => {
    // "the hotel turned add-ons off" and "the hotel has no add-ons"
    // are different states and need different copy — the endpoint
    // echoes `otherAddOnsEnabled` precisely so a client can tell them
    // apart (OCT-M1, decision #295).
    expect(drawer).toMatch(/setCatalogEnabled\(data\?\.otherAddOnsEnabled !== false\)/);
    expect(drawer).toMatch(/switched off for the hotel/);
    expect(drawer).toMatch(/The add-on catalog is empty/);
  });
});

describe("P1-JSX-COMMENT-LEAK — no source comment is painted as UI text", () => {
  function leakedJsxComments(root: string): string[] {
    const found: string[] = [];
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) {
          const raw = node.getText(sf);
          if (/^\s*\/\//.test(raw)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            found.push(`${file}:${line + 1} ${raw.replace(/\s+/g, " ").trim().slice(0, 80)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return found;
  }

  it("finds no `//` comment rendered as JSX text in the admin app", () => {
    expect(leakedJsxComments(SRC)).toEqual([]);
  });

  it("finds no `//` comment rendered as JSX text in the guest app", () => {
    expect(leakedJsxComments(APP_SRC)).toEqual([]);
  });

  it("the scanner actually inspects a non-trivial number of files", () => {
    // Guard against a silently empty scan.
    expect(walk(SRC).length).toBeGreaterThan(20);
    expect(walk(APP_SRC).length).toBeGreaterThan(20);
  });
});
