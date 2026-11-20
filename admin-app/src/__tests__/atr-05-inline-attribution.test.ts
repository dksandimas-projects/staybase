// ATR-05 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the inline
// "who did this" surfaces + the `staffNameMap` retrofit.
//
// WHY THIS TEST EXISTS
// --------------------
// Finding 9 in the spec: three of the four working attribution
// surfaces printed a raw 28-character Firebase Auth UID, which tells
// a front-desk user NOTHING, and the drawer's discount block fell
// back to the literal "Staff". The payments/refunds tables already
// resolved names through a `staffNameMap` built inside `ReportsPage`.
//
// ATR-05 standardises on ONE shared resolver (`shared/utils/
// staffNames.ts`) and retrofits the three surfaces onto it. The
// inline surfaces (booking drawer, room modal, dashboard housekeeping
// chip) make the same denormalized attribution readable at the desk.
//
// These are SOURCE-TEXT assertions, matching the admin app's
// established test pattern (there is no React testing library in this
// workspace — see `admin-app/package.json`). What they pin is the
// CONTRACT:
//
//   1. every surface resolves a uid through the SHARED resolver;
//   2. NO surface renders a raw uid (or a raw-email fallback);
//   3. the inline surfaces OMIT cleanly on a legacy record that
//      carries no attribution — no empty line, no row of em-dashes;
//   4. there is only ONE resolver — a second one is how the three
//      surfaces drifted in the first place.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../");

const read = (relativePath: string): string =>
  readFileSync(resolve(repoRoot, relativePath), "utf8");

const reportsPage = read("admin-app/src/pages/ReportsPage.tsx");
const membersPage = read("admin-app/src/pages/MembersPage.tsx");
const bookingsPage = read("admin-app/src/pages/BookingsPage.tsx");
const roomsPage = read("admin-app/src/pages/RoomsPage.tsx");
const dashboardPage = read("admin-app/src/pages/DashboardPage.tsx");
const drawerWorkspace = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const provenanceLine = read("admin-app/src/components/BookingProvenanceLine.tsx");
const roomAttributionNote = read("admin-app/src/components/RoomAttributionNote.tsx");
const sharedStaffNames = read("shared/utils/staffNames.ts");

describe("ATR-05 — ONE resolver, in shared/", () => {
  it("the resolver lives in shared/utils/staffNames.ts", () => {
    expect(sharedStaffNames).toContain("export function buildStaffNameMap");
    expect(sharedStaffNames).toContain("export function resolveStaffName");
    expect(sharedStaffNames).toContain("export function staffNameFor");
  });

  it("the reports page builds its map with the SHARED builder", () => {
    // The map used to be built inline in the page — which is exactly
    // why the three other surfaces grew their own ad-hoc lookups.
    expect(reportsPage).toContain("buildStaffNameMap(staff)");
    // ...and the inline construction is GONE.
    expect(reportsPage).not.toMatch(/staff\.forEach\(\s*\(s\)\s*=>\s*map\.set/);
  });

  it("no page builds its OWN staff-name map", () => {
    // A second resolver is how the three surfaces drifted in the
    // first place. Every surface goes through the shared one.
    for (const [name, src] of Object.entries({
      reportsPage,
      membersPage,
      bookingsPage,
      roomsPage,
      dashboardPage,
      drawerWorkspace
    })) {
      expect(src, `${name} must not build its own staff-name map`).not.toMatch(
        /new Map<string, string>\(\)[\s\S]{0,200}?\.uid/
      );
    }
  });
});

describe("ATR-05 — the retrofit: no surface prints a raw uid", () => {
  it("the incidental charges table resolves `charge.addedBy`", () => {
    expect(reportsPage).toContain(
      'staffNameFor(staffNameMap, charge.addedBy, "Unknown")'
    );
    // The raw uid must not be rendered anywhere in the charges table.
    expect(reportsPage).not.toMatch(/\{charge\.addedBy\}/);
  });

  it("BOTH charges CSV exports resolve `charge.addedBy`", () => {
    // The XLSX export ("Added By" column) and the CSV export (row
    // array) each used to carry the raw uid.
    const matches = reportsPage.match(
      /staffNameFor\(staffNameMap, charge\.addedBy, "Unknown"\)/g
    );
    expect(matches).not.toBeNull();
    // Three call sites: the mobile card, the desktop table cell, and
    // the two exports (4 render/serialisation sites in total).
    expect(matches!.length).toBeGreaterThanOrEqual(4);
    expect(reportsPage).not.toMatch(/"Added By":\s*charge\.addedBy/);
  });

  it("the member points history resolves `log.by`", () => {
    expect(membersPage).toContain("pointsActorLabel(log.by)");
    expect(membersPage).not.toMatch(/By \{log\.by\}/);
  });

  it("the points ledger handles the non-staff `by` values", () => {
    // A member's OWN redemption writes `self:<uid>`, and the
    // welcome-credit row carries no `by` at all.
    expect(membersPage).toContain('by.startsWith("self:")');
    expect(membersPage).toContain('if (!by) return "System"');
  });

  it("the drawer's discount block resolves `discountVerifiedBy`", () => {
    expect(bookingsPage).toContain(
      'staffNameFor(staffNameMap, selectedBooking.discountVerifiedBy, "Staff")'
    );
    expect(bookingsPage).not.toMatch(
      /\{selectedBooking\.discountVerifiedBy \|\| "Staff"\}/
    );
  });

  it("the drawer's special-requests line resolves `specialRequestsUpdatedBy`", () => {
    expect(drawerWorkspace).toContain(
      'staffNameFor(staffNameMap, booking.specialRequestsUpdatedBy, "staff")'
    );
    expect(drawerWorkspace).not.toMatch(
      /\{booking\.specialRequestsUpdatedBy \?\? "staff"\}/
    );
  });

  it("the calendar's special-requests line resolves it too", () => {
    expect(
      read("admin-app/src/pages/CalendarPage.tsx")
    ).toContain(
      'staffNameFor(staffNameMap, selectedBooking.specialRequestsUpdatedBy, "staff")'
    );
  });
});

describe("ATR-05 — the booking drawer's provenance line", () => {
  it("exists as its own component", () => {
    expect(provenanceLine).toContain("export function BookingProvenanceLine");
  });

  it("renders the creator, the check-in and the check-out attribution", () => {
    expect(provenanceLine).toContain("Created by");
    expect(provenanceLine).toContain("Checked in by");
    expect(provenanceLine).toContain("Checked out by");
    expect(provenanceLine).toContain("booking.createdByName");
    expect(provenanceLine).toContain("booking.checkedInByName");
    expect(provenanceLine).toContain("booking.checkedOutByName");
  });

  it("reads the uids too, so a record with only the uid still renders", () => {
    expect(provenanceLine).toContain("booking.createdBy");
    expect(provenanceLine).toContain("booking.checkedInBy");
    expect(provenanceLine).toContain("booking.checkedOutBy");
  });

  it("OMITS CLEANLY on a legacy record with no attribution", () => {
    // The whole point of "omit cleanly": a booking written before
    // ATR-04 carries none of these fields, and the drawer must not
    // render an empty line or a row of em-dashes.
    expect(provenanceLine).toContain("if (segments.length === 0) return null;");
    // A segment with no attributable actor is dropped, not rendered
    // as an empty value.
    expect(provenanceLine).toContain(
      ".filter((segment): segment is { key: string; label: string; value: string } =>"
    );
  });

  it("resolves through the shared resolver", () => {
    expect(provenanceLine).toContain("buildStaffNameMap(staff)");
    expect(provenanceLine).toContain("staffNameFor(staffNameMap");
  });

  it("is mounted in the drawer header", () => {
    expect(drawerWorkspace).toContain(
      'import { BookingProvenanceLine } from "./BookingProvenanceLine"'
    );
    expect(drawerWorkspace).toContain("<BookingProvenanceLine booking={booking} />");
  });
});

describe("ATR-05 — the room modal's attribution note", () => {
  it("exists as its own component", () => {
    expect(roomAttributionNote).toContain("export function RoomAttributionNote");
  });

  it("renders the three room attribution triples", () => {
    expect(roomAttributionNote).toContain("Last updated by");
    expect(roomAttributionNote).toContain("Status changed by");
    expect(roomAttributionNote).toContain("Housekeeping by");
    expect(roomAttributionNote).toContain("room.updatedByName");
    expect(roomAttributionNote).toContain("room.statusChangedByName");
    expect(roomAttributionNote).toContain("room.housekeepingUpdatedByName");
  });

  it("OMITS CLEANLY on a legacy room with no attribution", () => {
    expect(roomAttributionNote).toContain("if (segments.length === 0) return null;");
  });

  it("is mounted in the room drawer", () => {
    expect(roomsPage).toContain(
      'import { RoomAttributionNote } from "../components/RoomAttributionNote"'
    );
    expect(roomsPage).toContain("<RoomAttributionNote room={selectedRoom} />");
  });
});

describe("ATR-05 — the dashboard housekeeping chip", () => {
  it("says WHO last set the housekeeping status", () => {
    expect(dashboardPage).toContain("room.housekeepingUpdatedByName");
    expect(dashboardPage).toContain("by {room.housekeepingUpdatedByName}");
  });

  it("omits the attribution on a legacy room", () => {
    // The chip renders the name only when the room carries one.
    expect(dashboardPage).toMatch(
      /\{room\.housekeepingUpdatedByName && \([\s\S]{0,200}?by \{room\.housekeepingUpdatedByName\}/
    );
  });
});

describe("ATR-05 — the surfaces never render a raw uid", () => {
  it("every surface that reads a staff uid imports the shared resolver", () => {
    // A surface that reads a uid but does NOT import the resolver is
    // a surface that renders the uid.
    for (const [name, src] of Object.entries({
      reportsPage,
      membersPage,
      bookingsPage,
      drawerWorkspace
    })) {
      expect(
        src,
        `${name} must import the shared staff resolver`
      ).toContain("staffNameFor(staffNameMap");
    }
  });

  it("the drawer's provenance line and the room note resolve every uid they read", () => {
    // Both read three uid fields each; every one of them is passed
    // through the resolver, never rendered directly.
    for (const src of [provenanceLine, roomAttributionNote]) {
      expect(src).toContain("staffNameFor(staffNameMap");
      expect(src).not.toMatch(/\.uid\b/);
    }
  });
});
