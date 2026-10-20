// Per OCT-M7 (2026-10-20, decision #296): the in-flow hold must
// follow the guest's CURRENT stay.
//
// The bug: `handleStartInFlowHold` was idempotent by `holdId` and
// returned the existing doc UNCHANGED, so the hold's stamped
// `roomType` / `checkIn` / `checkOut` were never refreshed. A guest
// who changed their dates on Step 2 (MBUX-18's edit sheet widened
// this path) kept a hold describing the stay they had abandoned, and
// the banner kept promising it — "Your room is held for you until
// 8:45 PM" for a room they were no longer booking.
//
// The fix: the hold's stay details are re-stamped against the current
// stay, while the DEADLINE is untouched (so a date change can never
// be used to reset the window the extension cap exists to bound).
//
// This file pins the BEHAVIOUR (runtime assertions against the real
// shared helper) and the WIRING (source-text guards).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inFlowHoldStayMatches } from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const holdHandlerSrc = read("guest-app/server/handlers/in-flow-hold.ts");
const hookSrc = read("guest-app/src/hooks/useInFlowHold.ts");

const STAY = {
  roomType: "standard-double",
  checkIn: "2026-11-02",
  checkOut: "2026-11-04",
  numNights: 2
};

describe("OCT-M7 — the stay comparison (runtime behaviour)", () => {
  it("an unchanged stay matches", () => {
    expect(inFlowHoldStayMatches(STAY, { ...STAY })).toBe(true);
  });

  it("a changed check-in does NOT match", () => {
    expect(
      inFlowHoldStayMatches(STAY, { ...STAY, checkIn: "2026-11-03" })
    ).toBe(false);
  });

  it("a changed check-out does NOT match", () => {
    expect(
      inFlowHoldStayMatches(STAY, { ...STAY, checkOut: "2026-11-05" })
    ).toBe(false);
  });

  it("a changed room type does NOT match", () => {
    expect(
      inFlowHoldStayMatches(STAY, { ...STAY, roomType: "deluxe-twin" })
    ).toBe(false);
  });

  it("a changed night count does NOT match", () => {
    expect(inFlowHoldStayMatches(STAY, { ...STAY, numNights: 3 })).toBe(false);
  });

  it("a missing hold or input is NOT a match — the safe direction is to re-stamp", () => {
    expect(inFlowHoldStayMatches(null, STAY)).toBe(false);
    expect(inFlowHoldStayMatches(STAY, null)).toBe(false);
    expect(inFlowHoldStayMatches(undefined, undefined)).toBe(false);
  });

  it("missing fields on either side are compared as empty / zero", () => {
    expect(
      inFlowHoldStayMatches(
        { roomType: "", checkIn: "", checkOut: "", numNights: 0 },
        { roomType: "", checkIn: "", checkOut: "", numNights: 0 }
      )
    ).toBe(true);
    expect(
      inFlowHoldStayMatches(
        { roomType: "", checkIn: "", checkOut: "", numNights: 0 },
        { roomType: "", checkIn: "", checkOut: "", numNights: 2 }
      )
    ).toBe(false);
  });
});

describe("OCT-M7 — the server re-stamps the hold (wiring)", () => {
  it("the start handler compares the stay details with the shared helper", () => {
    expect(holdHandlerSrc).toMatch(/inFlowHoldStayMatches/);
  });

  it("a matching stay still replays idempotently (a network retry must not re-stamp)", () => {
    expect(holdHandlerSrc).toMatch(/idempotentReplay: true/);
  });

  it("a changed stay is re-stamped instead of replayed", () => {
    expect(holdHandlerSrc).toMatch(/restamped: true/);
  });

  it("the replay branch is GATED on the stay comparison (order matters)", () => {
    // This is the assertion that actually fails if someone neuters
    // the comparison (e.g. `if (true)`), which the loose "the helper
    // is mentioned somewhere" check would sail straight past.
    const gateIdx = holdHandlerSrc.indexOf("if (stayMatches) {");
    const replayIdx = holdHandlerSrc.indexOf("idempotentReplay: true");
    const writeIdx = holdHandlerSrc.indexOf("await ref.set(");
    const restampIdx = holdHandlerSrc.indexOf("restamped: true");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(replayIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(restampIdx).toBeGreaterThan(-1);
    // The gate opens the replay branch...
    expect(replayIdx).toBeGreaterThan(gateIdx);
    // ...and the re-stamp write + its flag come AFTER the gate, i.e.
    // they are on the fall-through path.
    expect(writeIdx).toBeGreaterThan(replayIdx);
    expect(restampIdx).toBeGreaterThan(writeIdx);
  });

  it("the comparison is fed the STORED stay and the INCOMING stay", () => {
    expect(holdHandlerSrc).toMatch(
      /const stayMatches = inFlowHoldStayMatches\(\s*\{\s*roomType: data\.roomType,[\s\S]*?numNights: data\.numNights\s*\},[\s\S]*?\{\s*roomType: input\.roomType,[\s\S]*?numNights: input\.numNights\s*\}/
    );
  });

  it("the re-stamp rewrites the stay details", () => {
    expect(holdHandlerSrc).toMatch(
      /roomType: input\.roomType,\s*checkIn: input\.checkIn,\s*checkOut: input\.checkOut,\s*numNights: input\.numNights/
    );
  });

  it("the re-stamp does NOT reset the deadline — a date change must not extend the window", () => {
    // The write must NOT carry `expiresAt` or `holdMinutes`.
    const writeIdx = holdHandlerSrc.indexOf("await ref.set(");
    expect(writeIdx).toBeGreaterThan(-1);
    const writeBlock = holdHandlerSrc.slice(writeIdx, writeIdx + 500);
    expect(writeBlock).not.toMatch(/expiresAt/);
    expect(writeBlock).not.toMatch(/holdMinutes/);
  });
});

describe("OCT-M7 — the client re-stamps the hold (wiring)", () => {
  it("the hook compares the live hold against the current stay", () => {
    expect(hookSrc).toMatch(/inFlowHoldStayMatches/);
  });

  it("the hook POSTs /api/holds/start again when the hold no longer matches", () => {
    expect(hookSrc).toMatch(/await startHold\(\)/);
    expect(hookSrc).toMatch(/api\/holds\/start/);
  });

  it("the re-read is attempted after the re-stamp", () => {
    expect(hookSrc).toMatch(/const refreshed = await readHold\(\)/);
  });

  it("the effect re-runs when the stay changes (so the mismatch is noticed at all)", () => {
    // The dependency array must include the stay fields — otherwise a
    // date change never re-runs the effect and the stale hold is
    // never detected.
    const depIdx = hookSrc.indexOf("startInput?.checkIn");
    expect(depIdx).toBeGreaterThan(-1);
    const depBlock = hookSrc.slice(depIdx - 400, depIdx + 400);
    expect(depBlock).toMatch(/startInput\?\.checkIn/);
    expect(depBlock).toMatch(/startInput\?\.checkOut/);
  });
});
