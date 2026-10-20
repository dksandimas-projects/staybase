// Per OCT-M5 (2026-10-20, decision #292): the other-add-on cut-off
// is anchored on the BOOKING's check-in, and the anchor is a
// REQUIRED argument.
//
// The bug: `assertNotLocked` accepted an optional `checkInDate` and
// fell back to the selection's own service date
// (`const date = checkInDate || parsed.date;`). NO CALLER EVER PASSED
// IT, so the lock slid forward one day per service date — a guest
// with an Oct 20 check-in and a 24h lead got a policy lock of Oct 19
// for the Oct 20 row, Oct 20 for the Oct 21 row, and so on. The same
// wrong anchor was in the DISPLAY paths, so the Manage page showed
// the SAME wrong lock state.
//
// The fix makes `checkInDate` REQUIRED and deletes the fallback, so
// the compiler forces every caller to pass the booking's check-in.
//
// This file pins the BEHAVIOUR (the shared UTC date-key helper) and
// the WIRING (the required argument + every caller).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toUtcDateKey } from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const selectionsLibSrc = read("guest-app/server/lib/otherAddOn-selections.ts");
const manageSaveSrc = read("guest-app/server/handlers/addons-manage-save.ts");
const staffUpdateSrc = read("guest-app/server/handlers/addons-staff-update.ts");
const manageSrc = read("guest-app/server/handlers/addons-manage.ts");
const drawerSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const bookingDatesSrc = read("shared/utils/bookingDates.ts");

describe("OCT-M5 — the UTC date-key helper (runtime behaviour)", () => {
  it("a Date becomes a UTC yyyy-mm-dd key", () => {
    expect(toUtcDateKey(new Date("2026-10-20T00:00:00.000Z"))).toBe("2026-10-20");
  });

  it("the key is UTC, not local — a late-evening UTC instant stays on its UTC day", () => {
    // 2026-10-20T23:30Z is already Oct 21 in Manila (+08:00). The
    // helper is UTC-anchored, so it returns the UTC day.
    expect(toUtcDateKey(new Date("2026-10-20T23:30:00.000Z"))).toBe("2026-10-20");
  });

  it("an ISO string is accepted", () => {
    expect(toUtcDateKey("2026-10-20T00:00:00.000Z")).toBe("2026-10-20");
  });
});

describe("OCT-M5 — the anchor is required (wiring)", () => {
  it("the `checkInDate` argument is REQUIRED on the lock assertion", () => {
    expect(selectionsLibSrc).toMatch(
      /interface AssertNotLockedInput \{[\s\S]*?checkInDate:\s*string;/
    );
  });

  it("the service-date fallback is DELETED, not merely unused", () => {
    // Leaving `checkInDate || parsed.date` in place would let the
    // next caller silently reintroduce the bug.
    //
    // Comments are stripped first — the file's own JSDoc QUOTES the
    // old fallback to explain why it was removed, and a raw
    // substring scan would read that explanation as the bug.
    const code = selectionsLibSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/checkInDate\s*\|\|\s*parsed\.date/);
    expect(code).not.toMatch(/parsed\.date\s*\|\|\s*checkInDate/);
  });

  it("the helper is exported from shared", () => {
    expect(bookingDatesSrc).toMatch(/export function toUtcDateKey/);
  });

  it("the guest save path passes the booking's check-in", () => {
    expect(manageSaveSrc).toMatch(/checkInDate/);
    // The guest path derives it from the booking, not from the
    // selection's own service date.
    expect(manageSaveSrc).toMatch(/liveCheckInDate/);
  });

  it("the staff path passes the booking's check-in", () => {
    expect(staffUpdateSrc).toMatch(/checkInDate/);
  });

  it("the Manage page's DISPLAY path uses the booking's check-in too", () => {
    // The page showed the SAME wrong lock state as the write path.
    expect(manageSrc).toMatch(
      /computeOtherAddOnCutoffState\(\{\s*checkInDate,/
    );
  });

  it("the admin drawer uses the booking's check-in", () => {
    expect(drawerSrc).toMatch(
      /computeOtherAddOnCutoffState\(\{\s*checkInDate:/
    );
  });

  it("a booking with no usable check-in is refused, not silently defaulted", () => {
    // The server refuses rather than falling back to the service
    // date — a fallback would reproduce the original bug.
    expect(manageSaveSrc).toMatch(/BOOKING_CHECK_IN_MISSING/);
    expect(staffUpdateSrc).toMatch(/BOOKING_CHECK_IN_MISSING/);
  });
});
