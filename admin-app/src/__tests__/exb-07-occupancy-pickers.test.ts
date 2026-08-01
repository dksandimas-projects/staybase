import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per EXB-07 (2026-08-01, per decision #155): source-text
// regression tests for the booking-flow occupancy pickers
// on the admin walk-in modal + the corporate /book page.
// The emulator tests that would exercise the server's
// per-surface overflow check end-to-end are out of scope
// for this sandbox (Java not installed; PMH-03). The
// source-text guards below pin the contract that the
// emulator tests will later exercise.
//
// Background (per `plan/project/ROADMAP.md §EXB-07`):
//   - The "offer the bed at the right moment" UX: a
//     guest (or staff) blocked by the occupancy cap
//     should be offered the extra bed as the way
//     through, not shown a dead end. Per EXB-01, the
//     guest /book page already has the adult/child
//     split + extra bed steppers. EXB-07 extends the
//     same UX to the admin walk-in modal + the
//     corporate /book page.
//   - All three surfaces must:
//     (a) render the adult/child split steppers
//     (b) render the extra bed stepper when the
//         selected type has `maxExtraBeds > 0`
//     (c) derive the total `numGuests` from
//         `numAdults + numChildren` (per CHD-04)
//     (d) send the 3 fields + the total in the
//         create payload
//     (e) render the contextual "blocked by cap →
//         add an extra bed" hint when the EXB-03
//         overflow helper reports the requested
//         split exceeds the type's caps
//   - The server's `requiredExtraBedsFor` helper
//     (per decision #153) is the single source of
//     truth for the overflow check; the client-side
//     hint must use the same helper so the preview
//     is byte-equivalent to the server's check.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const corporateBookingSrc = readFileSync(
  resolve(
    __dirname,
    "../../../guest-app/src/pages/CorporateBookingPage.tsx"
  ),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

const roomTypesHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/roomTypes.ts"),
  "utf8"
);

describe("EXB-07 — admin walk-in modal: adult/child split + extra bed steppers + overflow UX", () => {
  it("the walk-in modal carries the 3 new state variables + derives numGuests from the sum", () => {
    // Per CHD-04: `numGuests` is the persisted total and
    // is derived server-side from `numAdults + numChildren`.
    // The walk-in modal mirrors that derivation locally so
    // the price preview stays in lockstep.
    expect(bookingsPageSrc).toMatch(/const \[walkinNumAdults/);
    expect(bookingsPageSrc).toMatch(/const \[walkinNumChildren/);
    expect(bookingsPageSrc).toMatch(/const \[walkinExtraBedCount/);
    expect(bookingsPageSrc).toMatch(
      /const numGuests = walkinNumAdults \+ walkinNumChildren/
    );
  });

  it("the walk-in payload sends the 3 fields to the server", () => {
    // The server's WalkinBookingSchema (per CHD-01 +
    // EXB-01 + EXB-03) accepts the 3 fields as optional.
    // The walk-in handler validates `numAdults + numChildren
    // === numGuests` (per CHD-04) and applies the EXB-03
    // overflow rule. The payload must include all 3.
    const handleWalkinSubmit = bookingsPageSrc.match(
      /const handleWalkinSubmit = async[\s\S]*?await addWalkinBooking\(\{[\s\S]*?\}\);/
    );
    expect(handleWalkinSubmit, "handleWalkinSubmit must exist").toBeTruthy();
    expect(handleWalkinSubmit![0]).toMatch(
      /numAdults:\s*walkinNumAdults/
    );
    expect(handleWalkinSubmit![0]).toMatch(
      /numChildren:\s*walkinNumChildren/
    );
    expect(handleWalkinSubmit![0]).toMatch(
      /extraBedCount:\s*walkinExtraBedCount/
    );
  });

  it("the walk-in modal renders 3 steppers (adults, children, extra beds)", () => {
    // The steppers are the same shape as the guest
    // /book pickers (Plus + Minus buttons + tabular
    // numeric display). The extra bed stepper is
    // gated on `walkinTypeMaxExtraBeds > 0` so a type
    // that doesn't allow extra beds doesn't render
    // a dead control.
    expect(bookingsPageSrc).toMatch(/aria-label="Decrease adults"/);
    expect(bookingsPageSrc).toMatch(/aria-label="Increase adults"/);
    expect(bookingsPageSrc).toMatch(/aria-label="Decrease children"/);
    expect(bookingsPageSrc).toMatch(/aria-label="Increase children"/);
    expect(bookingsPageSrc).toMatch(
      /walkinTypeMaxExtraBeds > 0[\s\S]{0,2000}aria-label="Decrease extra beds"/
    );
    expect(bookingsPageSrc).toMatch(/aria-label="Decrease extra beds"/);
    expect(bookingsPageSrc).toMatch(/aria-label="Increase extra beds"/);
  });

  it("the walk-in modal renders the 'blocked by cap → add extra bed' contextual hint", () => {
    // The hint is gated on `walkinShowOverflowHint` —
    // when the EXB-03 overflow exceeds the selected
    // extra bed count, the desk sees exactly how many
    // extra beds to add (or that the type doesn't allow
    // any, in which case the hint points to a different
    // room type). The hint uses the per-type `maxCapacity`
    // + `maxChildren` + `maxExtraBeds` so the desk can
    // see the actual cap they're working with. We assert
    // each piece independently because the JSX block
    // can be large (200K+ chars).
    expect(bookingsPageSrc).toMatch(/walkinShowOverflowHint/);
    expect(bookingsPageSrc).toMatch(
      /Add\s+\{walkinOverflow\.requiredExtraBeds\} extra bed/
    );
    expect(bookingsPageSrc).toMatch(
      /This room type allows up to\s+\{walkinTypeMaxCapacity\} adult/
    );
    expect(bookingsPageSrc).toMatch(
      /does not allow extra beds[\s\S]{0,2000}Pick a different room type/
    );
  });

  it("the walk-in uses the same `requiredExtraBedsFor` helper the server uses (per decision #153)", () => {
    // The client-side preview must use the same helper
    // so the UX is byte-equivalent to the server's
    // `handleCreateWalkin` check. A drift between the
    // client preview and the server check would produce
    // a confusing UX (the desk sees "OK" locally and
    // then a 400 from the server).
    expect(bookingsPageSrc).toMatch(
      /requiredExtraBedsFor\(\{[\s\S]{0,200}numAdults:\s*walkinNumAdults,[\s\S]{0,200}numChildren:\s*walkinNumChildren,[\s\S]{0,200}maxCapacity:\s*walkinTypeMaxCapacity,[\s\S]{0,200}maxChildren:\s*walkinTypeMaxChildren/
    );
    expect(bookingsPageSrc).toMatch(
      /walkinOverflow\.requiredExtraBeds > walkinExtraBedCount/
    );
  });

  it("the local admin Booking interface carries the 3 EXB-07 fields", () => {
    // AdminContext.tsx has a local `Booking` interface
    // (parallel to the shared one). The 3 fields
    // (`numAdults?` + `numChildren?` + `extraBedCount?`)
    // must be present so the typecheck accepts the
    // walk-in payload.
    const bookingIface = adminContextSrc.match(
      /export interface Booking \{[\s\S]*?\}/
    );
    expect(bookingIface, "local Booking interface must exist").toBeTruthy();
    expect(bookingIface![0]).toMatch(/numAdults\?:\s*number/);
    expect(bookingIface![0]).toMatch(/numChildren\?:\s*number/);
    expect(bookingIface![0]).toMatch(/extraBedCount\?:\s*number/);
  });

  it("the walk-in resets the 3 new fields to defaults on submit success", () => {
    // The reset block must include the 3 new fields so
    // the next walk-in starts from the 1-adult /
    // 0-children / 0-extra-bed state. A stale
    // `walkinExtraBedCount > 0` on the next walk-in
    // would charge a guest for a bed they didn't book.
    const resetBlock = bookingsPageSrc.match(
      /if \(result\.success\) \{[\s\S]*?setIsModalOpen\(false\);/
    );
    expect(resetBlock).toBeTruthy();
    expect(resetBlock![0]).toMatch(/setWalkinNumAdults\(1\)/);
    expect(resetBlock![0]).toMatch(/setWalkinNumChildren\(0\)/);
    expect(resetBlock![0]).toMatch(/setWalkinExtraBedCount\(0\)/);
  });
});

describe("EXB-07 — corporate /book page: adult/child split + extra bed steppers + overflow UX", () => {
  it("the corporate /book carries the 3 new state variables + derives guests from the sum", () => {
    // Same pattern as the walk-in modal: the legacy
    // single `guests` stepper is replaced by 3 steppers;
    // `guests` is derived from `numAdults + numChildren`.
    // Legacy URL callers (`?guests=N`) hydrate to
    // `numAdults = N, numChildren = 0` (the historical
    // "all guests are adults" shape, preserved for
    // back-compat with existing marketing links).
    expect(corporateBookingSrc).toMatch(/const \[numAdults/);
    expect(corporateBookingSrc).toMatch(/const \[numChildren/);
    expect(corporateBookingSrc).toMatch(/const \[extraBedCount/);
    expect(corporateBookingSrc).toMatch(
      /const guests = numAdults \+ numChildren/
    );
  });

  it("the corporate /book payload sends the 3 fields to the server", () => {
    // The /api/bookings/create handler accepts the 3
    // fields (per CHD-01 + EXB-01 + EXB-03). The
    // corporate body must include all 3 alongside the
    // existing `guests` total.
    const bodyBlock = corporateBookingSrc.match(
      /const body = \{[\s\S]*?hasBreakfast:/
    );
    expect(bodyBlock, "create body must exist").toBeTruthy();
    expect(bodyBlock![0]).toMatch(/numAdults,/);
    expect(bodyBlock![0]).toMatch(/numChildren,/);
    expect(bodyBlock![0]).toMatch(/extraBedCount,/);
    expect(bodyBlock![0]).toMatch(/guests:\s*Number\(guestDetails\.guestCount\)/);
  });

  it("the corporate /book renders 3 steppers (adults, children, extra beds)", () => {
    // Same shape as the walk-in modal. The extra
    // bed stepper is gated on `corpExtraBedsAllowed > 0`
    // so a corporate contract on a Single (which
    // typically has 0 extra beds) doesn't render
    // a dead control.
    expect(corporateBookingSrc).toMatch(/aria-label="Decrease adults"/);
    expect(corporateBookingSrc).toMatch(/aria-label="Increase adults"/);
    expect(corporateBookingSrc).toMatch(/aria-label="Decrease children"/);
    expect(corporateBookingSrc).toMatch(/aria-label="Increase children"/);
    expect(corporateBookingSrc).toMatch(
      /corpExtraBedsAllowed > 0[\s\S]{0,2000}aria-label="Decrease extra beds"/
    );
    expect(corporateBookingSrc).toMatch(/aria-label="Decrease extra beds"/);
    expect(corporateBookingSrc).toMatch(/aria-label="Increase extra beds"/);
  });

  it("the corporate /book renders the 'blocked by cap → add extra bed' contextual hint", () => {
    // Same shape as the walk-in modal — the hint
    // points to the path through (add an extra bed
    // or pick a different room type). When the type
    // allows 0 extra beds, the hint recommends a
    // different room type. Each piece is asserted
    // independently because the JSX block can be
    // large.
    expect(corporateBookingSrc).toMatch(/corpShowOverflowHint/);
    expect(corporateBookingSrc).toMatch(
      /Add\s+\{corpOverflow\.requiredExtraBeds\} extra bed/
    );
    expect(corporateBookingSrc).toMatch(
      /This room type allows up to\s+\{Number\(selectedTypeEntry\.maxCapacity\) \|\| 0\} adult/
    );
    expect(corporateBookingSrc).toMatch(
      /does not allow extra beds[\s\S]{0,2000}Pick a different room type/
    );
  });

  it("the corporate /book uses the same `requiredExtraBedsFor` helper the server uses (per decision #153)", () => {
    // Same invariant as the walk-in modal: the
    // client-side preview must use the same helper
    // so the corporate /book UX is byte-equivalent
    // to the server's `handleCreateBooking` check.
    expect(corporateBookingSrc).toMatch(
      /requiredExtraBedsFor\(\{[\s\S]{0,200}numAdults,[\s\S]{0,200}numChildren,[\s\S]{0,200}maxCapacity:\s*Number\(selectedTypeEntry\.maxCapacity\) \|\| 0,[\s\S]{0,200}maxChildren:\s*Number\(selectedTypeEntry\.maxChildren\) \|\| 0/
    );
    expect(corporateBookingSrc).toMatch(
      /corpOverflow\.requiredExtraBeds > extraBedCount/
    );
  });

  it("the corporate /book Step 2 'Guests count' form field updates `numAdults` (not the legacy `setGuests`)", () => {
    // The Step 2 confirmation input is an override
    // of the Step 1 stepper. When the user types a
    // number, we update `numAdults` (preserving
    // `numChildren`). The legacy `setGuests` was
    // removed because `guests` is now derived.
    expect(corporateBookingSrc).toMatch(
      /updateGuestDetail\("guestCount", value\)[\s\S]{0,200}setAdults\(Math\.max\(next, numChildren\)\)/
    );
    expect(corporateBookingSrc).not.toMatch(/setGuests\(Number\(value\)/);
  });
});

describe("EXB-07 — helper presence", () => {
  it("`requiredExtraBedsFor` is exported from the shared barrel", () => {
    // The helper is the single source of truth for
    // the overflow check. Both the walk-in modal
    // and the corporate /book import it from
    // `@spark-inn/shared` — pinning the export
    // shape ensures a barrel rename surfaces in
    // the test.
    expect(roomTypesHelperSrc).toMatch(
      /export function requiredExtraBedsFor\(/
    );
  });
});
