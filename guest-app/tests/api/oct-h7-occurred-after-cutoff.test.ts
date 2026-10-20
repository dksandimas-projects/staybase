// Per OCT-H7 (2026-10-20, decision #286): `occurredAfterCutoff`
// was never `true` on any override path, so the "Late changes"
// metric was permanently empty.
//
// THE BUG
//
// `auditBreakfastOp` / `auditOtherAddOnOp` overloaded ONE parameter
// (`reasonOrCutoff`) to carry EITHER a free-text reason (a string)
// OR the cut-off flag (a boolean):
//
//   if (typeof reasonOrCutoff === "string")  reason = reasonOrCutoff;
//   else if (typeof reasonOrCutoff === "boolean") occurredAfterCutoff = reasonOrCutoff;
//
// The staff override paths passed the REASON STRING
// (`reasonOrCutoff: isOverride ? reason : false`), so the helper
// set `reason` and left `occurredAfterCutoff` at its `false`
// default. The call site's own comment asserted the flag was
// "already implied" — it was explicitly `false`.
//
// The consequence: `breakfast-kitchen-list.ts` queries
// `collectionGroup("breakfastAudit").where("occurredAfterCutoff",
// "==", true)` → the "Late changes" column was empty for exactly
// the case it exists for (a staff member overriding a locked date
// after the cut-off), and the add-on late-change counter in
// `ReportsPage.tsx` was 0 for the same reason.
//
// THE FIX
//
// The parameter now also accepts an OBJECT carrying both fields, and
// every override path uses it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

const breakfastLibSrc = read("../../server/lib/breakfast-selections.ts");
const otherAddOnLibSrc = read("../../server/lib/otherAddOn-selections.ts");
const staffUpdateSrc = read("../../server/handlers/breakfast-staff-update.ts");
const addonsStaffUpdateSrc = read("../../server/handlers/addons-staff-update.ts");
const addonsManageSaveSrc = read("../../server/handlers/addons-manage-save.ts");

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const breakfastLib = codeOnly(breakfastLibSrc);
const otherAddOnLib = codeOnly(otherAddOnLibSrc);
const staffUpdate = codeOnly(staffUpdateSrc);
const addonsStaffUpdate = codeOnly(addonsStaffUpdateSrc);
const addonsManageSave = codeOnly(addonsManageSaveSrc);

describe("OCT-H7 — the audit helper can carry a reason AND the cut-off flag", () => {
  it("the breakfast helper accepts the object form", () => {
    expect(breakfastLibSrc).toMatch(
      /reasonOrCutoff\?:\s*string\s*\|\s*boolean\s*\|\s*AuditReasonAndCutoff/
    );
    expect(breakfastLib).toMatch(
      /reason\s*=\s*reasonOrCutoff\.reason\s*\?\?\s*null;[\s\S]{0,200}?occurredAfterCutoff\s*=\s*reasonOrCutoff\.occurredAfterCutoff\s*===\s*true/
    );
  });

  it("the other add-on helper accepts the object form", () => {
    expect(otherAddOnLibSrc).toMatch(
      /reasonOrCutoff\?:\s*string\s*\|\s*boolean\s*\|\s*AuditOtherAddOnReasonAndCutoff/
    );
    expect(otherAddOnLib).toMatch(
      /reason\s*=\s*reasonOrCutoff\.reason\s*\?\?\s*null;[\s\S]{0,200}?occurredAfterCutoff\s*=\s*reasonOrCutoff\.occurredAfterCutoff\s*===\s*true/
    );
  });

  it("the legacy string / boolean forms still work", () => {
    // The mark-served path passes a boolean; the un-serve path
    // passes a reason string. Both must keep working.
    expect(breakfastLib).toMatch(
      /typeof reasonOrCutoff === "string"[\s\S]{0,120}?reason = reasonOrCutoff;/
    );
    expect(breakfastLib).toMatch(
      /typeof reasonOrCutoff === "boolean"[\s\S]{0,120}?occurredAfterCutoff = reasonOrCutoff;/
    );
  });
});

describe("OCT-H7 — the override paths now stamp the flag", () => {
  it("the staff breakfast add/change override stamps `occurredAfterCutoff: isOverride`", () => {
    expect(staffUpdate).toMatch(
      /reasonOrCutoff:\s*\{[\s\S]{0,200}?reason:\s*isOverride\s*\?\s*reason\s*:\s*null,[\s\S]{0,200}?occurredAfterCutoff:\s*isOverride/
    );
  });

  it("the staff breakfast remove override stamps `occurredAfterCutoff: isOverride`", () => {
    // The remove path is a SEPARATE audit call — it used to pass
    // the bare reason string, so it could never carry the flag.
    expect(staffUpdate).toMatch(
      /action:\s*isOverride\s*\?\s*"override-remove"\s*:\s*"remove"[\s\S]{0,600}?reasonOrCutoff:\s*\{[\s\S]{0,200}?occurredAfterCutoff:\s*isOverride/
    );
  });

  it("the staff add-on override stamps the flag from the audit entry", () => {
    expect(addonsStaffUpdate).toMatch(
      /reasonOrCutoff:\s*\{[\s\S]{0,200}?reason:\s*a\.reason,[\s\S]{0,200}?occurredAfterCutoff:\s*a\.occurredAfterCutoff/
    );
  });

  it("the guest add-on path passes the flag explicitly (it is always false there)", () => {
    expect(addonsManageSave).toMatch(
      /reasonOrCutoff:\s*\{[\s\S]{0,200}?reason:\s*a\.reason,[\s\S]{0,200}?occurredAfterCutoff:\s*a\.occurredAfterCutoff/
    );
  });

  it("no override path still passes the bare reason string", () => {
    // The regression this pins: `reasonOrCutoff: reason` /
    // `reasonOrCutoff: isOverride ? reason : false` cannot carry
    // the flag, so the flag was always `false`.
    expect(staffUpdate).not.toMatch(/reasonOrCutoff:\s*reason\s*[,}]/);
    expect(staffUpdate).not.toMatch(/reasonOrCutoff:\s*isOverride\s*\?\s*reason\s*:\s*false/);
    expect(addonsStaffUpdate).not.toMatch(/reasonOrCutoff:\s*a\.reason\s*[,}]/);
  });
});
