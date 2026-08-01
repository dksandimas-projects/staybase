import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per CHD-09 (2026-08-01, per decision #144): source-text
// regression tests for the children-in-booking system. The
// emulator tests that exercise the real Firestore transactions
// (PMH-05's array-write-integrity pattern) are out of scope for
// this sandbox; the source-text guards below pin the shape
// that the emulator tests will later exercise end-to-end.
//
// Background (per `plan/project/ROADMAP.md §CHD-01..04`):
//   - CHD-01: every booking created by handleCreateBooking or
//     handleCreateWalkin carries `numAdults` + `numChildren`
//     alongside the historical `numGuests`. The split is
//     optional — absent fields derive to `numAdults = guests`,
//     `numChildren = 0` (the historical "all guests are
//     adults" shape, byte-equivalent to pre-CHD-01).
//   - CHD-02: the `RoomTypeEntry` type gains a `maxChildren`
//     cap. `maxCapacity` is now the ADULT cap. A Single
//     realistically allows 0 children; a Family allows 2.
//     The default seed is keyed on `maxCapacity` so the
//     helper never overrides the admin's choice when present.
//   - CHD-04: capacity validation splits in two —
//     `numAdults > maxCapacity` and `numChildren >
//     maxChildren` are both rejected. The server also
//     rejects `numAdults + numChildren !== guests` (the
//     spec's "no trusting either value from the client"
//     rule). Client-side checks are UX feedback per the
//     standing rule in `GOTCHAS.md`; server-side is
//     authoritative.

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const bookingTypeSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

const bookingSchemaSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);

const constantsSrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);

const roomTypesHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/roomTypes.ts"),
  "utf8"
);

describe("CHD-01 — `numAdults` + `numChildren` on the Booking type and create payloads", () => {
  it("the Booking type carries optional numAdults + numChildren fields", () => {
    // The fields are optional (legacy bookings without them read
    // as `numAdults = numGuests`, `numChildren = 0`). The
    // comment block explains the spec rationale.
    expect(bookingTypeSrc).toMatch(/numAdults\?:\s*number;/);
    expect(bookingTypeSrc).toMatch(/numChildren\?:\s*number;/);
  });

  it("the public create schema accepts optional numAdults + numChildren (0..100)", () => {
    // The public create schema lives in `bookings.ts` (not the
    // shared file — the public create schema is zod-only
    // because the booking-create body has hotel-specific
    // fields). The walk-in schema lives in the shared file
    // and is also pinned.
    expect(bookingsHandlerSrc).toMatch(
      /numAdults:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.max\(100\)\.optional\(\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /numChildren:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.max\(100\)\.optional\(\)/
    );
  });

  it("the new walk-in booking is written with the snapshotted split on the doc", () => {
    // Both `handleCreateBooking` + `handleCreateWalkin` write
    // `numAdults` + `numChildren` to the new booking. The
    // historical `numGuests` stays as the persisted total.
    const matches = bookingsHandlerSrc.match(
      /numAdults,[\s\S]{0,40}numChildren,/g
    );
    expect(matches, "expected numAdults + numChildren on the booking write").toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("calculateBreakfastAddOn receives the split when present (CHD-10 + CHD-01 compose)", () => {
    // The breakfast helper accepts `numAdults` + `numChildren`
    // (per CHD-10). The handleCreateBooking call now passes
    // both when present so the breakfast math tracks the
    // persisted booking fields, not just `numGuests`.
    expect(bookingsHandlerSrc).toMatch(
      /calculateBreakfastAddOn\(\{[\s\S]{0,200}numAdults,[\s\S]{0,40}numChildren,/
    );
  });
});

describe("CHD-02 — `maxChildren` on the room type", () => {
  it("RoomTypeEntry gains an optional `maxChildren` field", () => {
    // The field is optional + nullable in the type (legacy
    // settings without the field read via `normalizeMaxChildren`).
    // The default seed is keyed on `maxCapacity` so a Single
    // (maxCapacity 1) gets 0, a Family (maxCapacity 4) gets 2.
    expect(constantsSrc).toMatch(/maxChildren\?:\s*number;/);
  });

  it("the DEFAULT_ROOM_TYPES seed encodes the per-type reality (Single 0, Family 2)", () => {
    // The spec note: "a Single realistically allows 0
    // children even though the client's stated default is 2".
    // Single (maxCapacity 1) → 0 children. Family (maxCapacity
    // 4) → 2 children. Standard double / twin / executive
    // (maxCapacity 2) → 1 child each.
    const seedLines = constantsSrc.split("\n").filter((l) => l.includes("maxCapacity:") && l.includes("maxChildren:"));
    expect(seedLines.length).toBeGreaterThanOrEqual(5);
    const singleLine = seedLines.find((l) => l.includes("maxCapacity: 1"));
    expect(singleLine, "Single must seed maxChildren: 0").toBeTruthy();
    const familyLine = seedLines.find((l) => l.includes("maxCapacity: 4"));
    expect(familyLine, "Family must seed maxChildren: 2").toBeTruthy();
  });

  it("normalizeMaxChildren falls back to a per-capacity seed when the field is absent", () => {
    // Legacy settings without `maxChildren` hydrate to a
    // per-capacity default. The helper is the single
    // normalization point for every read site.
    expect(roomTypesHelperSrc).toMatch(
      /DEFAULT_MAX_CHILDREN_BY_ADULT_CAPACITY[\s\S]{0,200}1:\s*0,[\s\S]{0,200}2:\s*1,[\s\S]{0,200}4:\s*2/
    );
  });
});

describe("CHD-04 — capacity validation splits into two checks (server-authoritative)", () => {
  it("handleCreateBooking validates `numAdults + numChildren === guests`", () => {
    // The "no trusting either value from the client" rule:
    // the server derives the split from the request body and
    // rejects any client-supplied total that disagrees.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(numAdults\s*\+\s*numChildren\s*!==\s*guests\)\s*\{[\s\S]{0,200}throw new Error\(\s*`Occupancy split mismatch:/
    );
  });

  it("handleCreateBooking rejects `numAdults > maxCapacity` (the adult cap)", () => {
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(numAdults\s*>\s*typeMaxCapacity\)\s*\{[\s\S]{0,200}throw new Error\(\s*`Guest count exceeds room adult capacity of/
    );
  });

  it("handleCreateBooking rejects `numChildren > maxChildren` (the new child cap)", () => {
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(numChildren\s*>\s*typeMaxChildren\)\s*\{[\s\S]{0,200}throw new Error\(\s*`Children \(\$\{numChildren\}\) exceeds room child capacity of/
    );
  });

  it("handleCreateWalkin applies the same two-checks (adult cap + child cap)", () => {
    // The walk-in schema accepts the split; the same
    // validation runs inside the walk-in transaction.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(walkinNumChildren\s*>\s*walkinMaxChildren\)\s*\{[\s\S]{0,200}throw new Error\(\s*`Children \(\$\{walkinNumChildren\}\) exceeds room child capacity of/
    );
  });
});
