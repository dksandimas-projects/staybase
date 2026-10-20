// Per OCT-L4 + OCT-L7 (2026-10-20, decision #299): the two
// server-side closeout fixes.
//
// **OCT-L4 — a guest remove-op on a MISSING add-on returned 500.**
// `assertSelectionForChange` throws `SELECTION_NOT_ORDERED` when the
// selection is missing or already removed. In the guest handler that
// call was UNWRAPPED, so the throw escaped the transaction and the
// outer catch answered 500 "Failed to save add-on changes." — a
// client error dressed up as a server fault. The staff handler
// already wrapped the same call and answered 400; the guest path now
// agrees.
//
// **OCT-L7 — calendar-impossible dates were accepted by three
// endpoints.** `new Date("2026-02-31T00:00:00Z")` ROLLS OVER to Mar 3
// rather than producing an Invalid Date, so the `isNaN(getTime())`
// guard never fired and the walk-in / reschedule / corporate-convert
// paths stored a day the caller never sent. The guest CREATE endpoint
// already used the shared `isValidIsoDate`; the other three did not.
//
// This file pins the WIRING (source-text guards — the handlers cannot
// be mounted here because the repo has no jsdom/RTL harness) and the
// BEHAVIOUR of the shared date helper that backs them.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidIsoDate } from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingsSrc = read("guest-app/server/handlers/bookings.ts");
const manageSaveSrc = read("guest-app/server/handlers/addons-manage-save.ts");
const corporateSrc = read("guest-app/server/handlers/corporate-inquiries.ts");

/**
 * Strip JS comments. LINE comments first — a `//` comment may contain
 * `/*`, and stripping blocks first would treat it as a block opener.
 */
function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

const bookingsCode = stripComments(bookingsSrc);
const manageSaveCode = stripComments(manageSaveSrc);
const corporateCode = stripComments(corporateSrc);

describe("OCT-L4 — the guest remove-op answers 400, not 500", () => {
  it("the remove op WRAPS `assertSelectionForChange` in a try/catch", () => {
    // The unwrapped shape was:
    //   assertSelectionForChange(next, op.selectionKey);
    // The fix wraps it and converts the throw into an op code, which
    // the handler turns into a 400.
    expect(manageSaveCode).toMatch(
      /try\s*\{\s*assertSelectionForChange\(next, op\.selectionKey\);\s*\}\s*catch\s*\(err: any\)\s*\{\s*opCode = String\(err\?\.message \|\| OTHER_ADDON_OP_ERROR\.SELECTION_NOT_ORDERED\);/
    );
  });

  it("EVERY `assertSelectionForChange` call in the guest handler is wrapped", () => {
    // The count is the point: the change op was already wrapped; the
    // remove op was not. An unwrapped call is a 500 waiting to happen.
    const calls = manageSaveCode.match(/assertSelectionForChange\(next, op\.selectionKey\);/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const wrapped = manageSaveCode.match(/try\s*\{\s*assertSelectionForChange\(next, op\.selectionKey\);\s*\}/g) || [];
    expect(wrapped.length).toBe(calls.length);
  });

  it("the outer catch is still a 500 for a GENUINE server fault", () => {
    // Wrapping the client-error path must not turn real faults into
    // 400s — the catch stays, it just no longer swallows the
    // client-error throw.
    expect(manageSaveCode).toMatch(
      /catch\s*\(err: any\)\s*\{\s*return res\.status\(500\)\.json\(\{\s*success: false,\s*error: "Failed to save add-on changes\."/
    );
  });

  it("the op code becomes a 400 response", () => {
    expect(manageSaveCode).toMatch(/if \(opCode\)\s*\{\s*return res\.status\(400\)\.json\(\{\s*success: false,\s*error: opErrorToMessage\(opCode\)/);
  });
});

describe("OCT-L7 — calendar-impossible dates are rejected at every date boundary", () => {
  it("the shared helper rejects the rollover dates", () => {
    // The trap, pinned directly: `Date` rolls these over silently.
    expect(new Date("2026-02-31T00:00:00Z").toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    // ...and accepts the real ones.
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-10-20")).toBe(true);
  });

  it("the WALK-IN create path validates with `isValidIsoDate`", () => {
    expect(bookingsCode).toMatch(
      /isValidIsoDate\(checkIn\) \|\| !isValidIsoDate\(checkOut\)[\s\S]{0,300}Invalid check-in or check-out date\./
    );
  });

  it("the RESCHEDULE path validates with `isValidIsoDate`", () => {
    expect(bookingsCode).toMatch(
      /isValidIsoDate\(checkIn\) \|\| !isValidIsoDate\(checkOut\)[\s\S]{0,300}Invalid check-in or check-out date\./
    );
  });

  it("the CORPORATE inquiry-to-booking conversion validates with `isValidIsoDate`", () => {
    expect(corporateCode).toMatch(
      /isValidIsoDate\(checkIn\) \|\| !isValidIsoDate\(checkOut\)[\s\S]{0,300}Invalid check-in or check-out date\./
    );
  });

  it("no date-accepting endpoint relies on `isNaN(getTime())` ALONE", () => {
    // Every `new Date(`${checkIn}T00:00:00Z`)` site must be preceded
    // by an `isValidIsoDate` guard. The `isNaN` check alone cannot
    // see a rollover.
    const rawDateSites = bookingsCode.match(/new Date\(`\$\{checkIn\}T00:00:00Z`\)/g) || [];
    expect(rawDateSites.length).toBeGreaterThanOrEqual(3);
    const guards = bookingsCode.match(/isValidIsoDate\(checkIn\) \|\| !isValidIsoDate\(checkOut\)/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
  });
});
