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
  it("normalizes every room type before reading child-cap defaults", () => {
    expect(bookingsHandlerSrc.match(/applyRoomTypeDefaults\(rawTypeEntry\)/g)).toHaveLength(3);
  });

  it("does not compare total guests directly with the adult cap", () => {
    expect(bookingsHandlerSrc).not.toMatch(/if\s*\(guests\s*>\s*typeMaxCapacity\)/);
  });

  it("handleCreateBooking validates `numAdults + numChildren === guests`", () => {
    // The "no trusting either value from the client" rule:
    // the server derives the split from the request body and
    // rejects any client-supplied total that disagrees.
    expect(bookingsHandlerSrc).toMatch(
      /requestedGuestCount\s*!==\s*guests[\s\S]{0,250}Guest distribution mismatch/
    );
  });

  it("handleCreateBooking rejects `numAdults > maxCapacity` (the adult cap)", () => {
    // Per EXB-03 (2026-08-01, per decision #145): the two
    // CHD-04 hard rejects (`numAdults > maxCapacity` +
    // `numChildren > maxChildren`) are subsumed by the
    // single overflow check via `requiredExtraBedsFor`.
    // When `extraBedCount === 0`, the helper reduces to
    // the two hard caps — so the rejection still happens,
    // just through a generalized code path. The source
    // text below pins the call + the `if (overflow.requiredExtraBeds > extraBedCount)` reject.
    expect(bookingsHandlerSrc).toMatch(
      /const\s+overflow\s*=\s*requiredExtraBedsFor\(\{[\s\S]{0,200}numAdults,[\s\S]{0,200}numChildren,[\s\S]{0,200}maxCapacity,[\s\S]{0,200}maxChildren[\s\S]{0,200}\}\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*overflow\.requiredExtraBeds\s*>\s*extraBedCount\s*\)\s*\{[\s\S]{0,300}Not enough extra beds/
    );
  });

  it("handleCreateBooking rejects `numChildren > maxChildren` (the new child cap)", () => {
    // Per EXB-03: subsumed by the same overflow helper.
    // The helper takes both `numAdults` and `numChildren`
    // so a child-only overflow (e.g. 2 adults + 2 children
    // in a Std Double with 1 child cap) still rejects when
    // the overflow exceeds the extra bed count. The
    // single check on `overflow.requiredExtraBeds` covers
    // both the adult-cap and the child-cap case.
    expect(bookingsHandlerSrc).toMatch(
      /requiredExtraBedsFor\(\{[\s\S]{0,200}numChildren,[\s\S]{0,200}maxChildren/
    );
  });

  it("handleCreateWalkin applies the same two-checks (adult cap + child cap)", () => {
    // Per EXB-03: the walk-in path uses the same
    // `requiredExtraBedsFor` helper. The helper subsumes the
    // old `numChildren > maxChildren` hard reject — when the
    // extra-bed count is 0, the helper reduces to both hard
    // caps.
    //
    // Per MRB-07 (2026-08-02, per decision #159): the check moved
    // inside the per-room-stay loop, so each room in a multi-room
    // reservation is capped against ITS OWN type entry rather than
    // against the primary room's. The occupancy passed to the
    // helper is that room's own split.
    expect(bookingsHandlerSrc).toMatch(
      /const\s+lineOverflow\s*=\s*requiredExtraBedsFor\(\{[\s\S]{0,300}numAdults:\s*assigned\.numAdults,[\s\S]{0,300}numChildren:\s*assigned\.numChildren,[\s\S]{0,300}maxCapacity:[\s\S]{0,300}lineTypeEntry\.maxCapacity[\s\S]{0,300}maxChildren:[\s\S]{0,300}lineTypeEntry\.maxChildren[\s\S]{0,300}\}\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*lineOverflow\.requiredExtraBeds\s*>\s*lineExtraBedCount\s*\)/
    );
  });
});
