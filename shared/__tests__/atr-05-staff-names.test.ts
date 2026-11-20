// ATR-05 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the ONE
// staff-UID → display-name resolver.
//
// WHY THIS TEST EXISTS
// --------------------
// Finding 9 in the spec: three of the four working attribution
// surfaces printed a raw 28-character Firebase Auth UID, which tells
// a front-desk user NOTHING. The payments/refunds tables already
// resolved names through a `staffNameMap` built inside `ReportsPage`.
//
// The fix was to lift that resolver into the shared package so every
// surface routes through it. A SECOND resolver is how the three
// surfaces drifted in the first place, so the contract this file
// pins is as much about BEING THE ONLY ONE as about the mapping
// itself.

import { describe, expect, it } from "vitest";
import {
  buildStaffNameMap,
  resolveStaffName,
  staffNameFor,
  type StaffNameSource
} from "@spark-inn/shared";

const STAFF: StaffNameSource[] = [
  { uid: "uid-juan", fullName: "Juan Dela Cruz", email: "juan@sparkinn.com" },
  { uid: "uid-maria", fullName: "", email: "maria@sparkinn.com" },
  { uid: "uid-anon", fullName: "", email: "" }
];

describe("ATR-05 — resolveStaffName", () => {
  it("prefers the full name", () => {
    expect(resolveStaffName(STAFF, "uid-juan")).toBe("Juan Dela Cruz");
  });

  it("falls back to the email when there is no full name", () => {
    expect(resolveStaffName(STAFF, "uid-maria")).toBe("maria@sparkinn.com");
  });

  it("returns null for a staff record with neither name nor email", () => {
    // NOT the uid — a uid tells the desk nothing.
    expect(resolveStaffName(STAFF, "uid-anon")).toBeNull();
  });

  it("returns null for an UNKNOWN uid", () => {
    // A deleted or disabled staff account is not in the list.
    expect(resolveStaffName(STAFF, "uid-gone")).toBeNull();
  });

  it("returns null for an empty uid", () => {
    expect(resolveStaffName(STAFF, "")).toBeNull();
    expect(resolveStaffName(STAFF, null)).toBeNull();
    expect(resolveStaffName(STAFF, undefined)).toBeNull();
  });
});

describe("ATR-05 — buildStaffNameMap", () => {
  it("maps every staff member who has a name", () => {
    const map = buildStaffNameMap(STAFF);
    expect(map.get("uid-juan")).toBe("Juan Dela Cruz");
    expect(map.get("uid-maria")).toBe("maria@sparkinn.com");
  });

  it("OMITS a staff member with neither name nor email", () => {
    // The map is used by surfaces that render one cell per row — an
    // entry that maps to a uid would put the raw uid back on screen.
    const map = buildStaffNameMap(STAFF);
    expect(map.has("uid-anon")).toBe(false);
  });

  it("is empty for an empty staff list", () => {
    expect(buildStaffNameMap([]).size).toBe(0);
  });
});

describe("ATR-05 — staffNameFor", () => {
  const map = buildStaffNameMap(STAFF);

  it("resolves a known uid", () => {
    expect(staffNameFor(map, "uid-juan", "Unknown")).toBe("Juan Dela Cruz");
  });

  it("uses the CALLER's fallback for an unknown uid", () => {
    // The fallback is the surface's own copy, so the surface stays in
    // control of what an unresolvable attribution reads as.
    expect(staffNameFor(map, "uid-gone", "Unknown")).toBe("Unknown");
  });

  it("uses the fallback for an empty uid", () => {
    expect(staffNameFor(map, "", "Unknown")).toBe("Unknown");
    expect(staffNameFor(map, null, "Unknown")).toBe("Unknown");
    expect(staffNameFor(map, undefined, "Unknown")).toBe("Unknown");
  });

  it("an EMPTY fallback is how a surface says 'omit this line'", () => {
    // The inline surfaces use an empty fallback and then treat the
    // empty string as "no attribution" — which is how a legacy
    // record omits the provenance line cleanly.
    expect(staffNameFor(map, "uid-gone", "")).toBe("");
  });
});
