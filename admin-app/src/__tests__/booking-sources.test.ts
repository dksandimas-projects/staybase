import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for NBS-01..09 (2026-07-31): booking sources move
// from hardcoded union to admin-editable list in Settings.
//
// Background
// ----------
// The walk-in modal used to hardcode `BookingSource = "online" | "walk-in"
// | "phone" | "facebook" | "corporate"` and a source list of the same
// five. After NBS-01..09:
//   - `BookingSource` widens to `string` (NBS-03).
//   - The walk-in modal is renamed "New Booking" and exposes a
//     Source dropdown that maps the configured, front-desk-selectable,
//     enabled entries (NBS-07).
//   - The Bookings table filter reads the same configured list
//     (NBS-09) and the active-filter chip renders the configured
//     label, not the raw key.
//   - Reports (the NBS-08 regression guard) reads the configured
//     list, never a hardcoded array. An unconfigured source still
//     surfaces as a "Unconfigured: <raw-key>" slice — the silent-
//     drop class of bug is loud, not silent.
//   - Server schema accepts an optional `source` with a "walk-in"
//     default; the note is source-derived (no more "Created on-site
//     at Front Desk." on a phone booking).
//   - `online` / `walk-in` / `corporate` are system-assigned (per
//     NBS-06) and must never appear in the desk's source selector.
//   - `PROTECTED_BOOKING_SOURCES` exists as a delete-protection
//     guard mirroring `PROTECTED_PAYMENT_METHODS` (NBS-05).
//
// The behavioral emulator test for the array-write hazard on
// `bookingSources[]` is `firebase/tests/booking-sources-array-write.emulator.test.ts`
// (PMH-05 generalization, same shape as the roomTypes / paymentMethods
// tests).

const sharedConstantsSrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

const sharedSchemasBookingSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);

const serverBookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const reportsPageSrc = readFileSync(
  resolve(__dirname, "../pages/ReportsPage.tsx"),
  "utf8"
);

const walkinModalScrollabilitySrc = readFileSync(
  resolve(__dirname, "./walkin-modal-scrollability.test.ts"),
  "utf8"
);

describe("NBS-01 — modal renamed to 'New Booking' / 'Create New Booking'", () => {
  it("BookingsPage button label is 'New Booking' (not 'New Walk-in Booking')", () => {
    expect(bookingsPageSrc).toMatch(/New Booking\s*<\/button>/);
    expect(bookingsPageSrc).not.toMatch(/New Walk-in Booking/);
  });

  it("BookingsPage Modal title is 'Create New Booking'", () => {
    expect(bookingsPageSrc).toMatch(/title="Create New Booking"/);
    expect(bookingsPageSrc).not.toMatch(/title="Create Walk-in Booking"/);
  });

  it("walkin-modal-scrollability test was updated in lockstep (per NBS-01)", () => {
    // The pre-existing test pinned the old title inside a regex. The
    // fix updated it to the new title in the same commit so CI stays
    // green — the spec calls this out as a test break.
    expect(walkinModalScrollabilitySrc).toMatch(/title="Create New Booking"/);
    expect(walkinModalScrollabilitySrc).not.toMatch(/title="Create Walk-in Booking"/);
  });
});

describe("NBS-03 — BookingSource widens to string, no inline duplicate in AdminContext", () => {
  it("shared BookingSource type is `string`", () => {
    expect(sharedTypesSrc).toMatch(/export type BookingSource = string;/);
  });

  it("shared constants still expose BOOKING_SOURCES as the seed/default array", () => {
    expect(sharedConstantsSrc).toMatch(
      /export const BOOKING_SOURCES = \["online", "walk-in", "phone", "facebook", "corporate"\] as const;/
    );
  });

  it("AdminContext no longer duplicates the source union inline (per NBS-03 second edit site)", () => {
    expect(adminContextSrc).not.toMatch(/source: "online" \| "walk-in" \| "phone" \| "facebook" \| "corporate"/);
    // The Booking shape in the context uses the shared string type.
    expect(adminContextSrc).toMatch(/source: string;/);
  });
});

describe("NBS-04 — Settings → Booking Sources tab (data model)", () => {
  it("BookingSourceConfig type + DEFAULT_BOOKING_SOURCES seed exist in shared constants", () => {
    expect(sharedConstantsSrc).toMatch(/export type BookingSourceConfig = \{/);
    expect(sharedConstantsSrc).toMatch(/export const DEFAULT_BOOKING_SOURCES: BookingSourceConfig\[\]/);
  });

  it("the seed list includes 'agoda' (CVQ-08: hotel is planning for Agoda)", () => {
    expect(sharedConstantsSrc).toMatch(/\{\s*source:\s*"agoda"[\s\S]*?OTA/);
  });

  it("AdminContext exposes bookingSources state + the four CRUD functions on the interface and value", () => {
    expect(adminContextSrc).toMatch(/bookingSources: BookingSourceConfig\[\];/);
    expect(adminContextSrc).toMatch(/addBookingSource: \(config: BookingSourceConfig\) => Promise<void>;/);
    expect(adminContextSrc).toMatch(/updateBookingSource:/);
    expect(adminContextSrc).toMatch(/reorderBookingSources:/);
    expect(adminContextSrc).toMatch(/deleteBookingSource:/);
  });

  it("AdminContext wires a one-time backfill (DEFAULT_BOOKING_SOURCES) into an idempotent useEffect", () => {
    expect(adminContextSrc).toMatch(/hasMigratedBookingSourcesRef = useRef\(false\)/);
    expect(adminContextSrc).toMatch(/DEFAULT_BOOKING_SOURCES\.filter\(/);
    expect(adminContextSrc).toMatch(/hasMigratedBookingSourcesRef\.current = true;/);
  });
});

describe("NBS-05 — protected booking sources mirror PROTECTED_PAYMENT_METHODS", () => {
  it("PROTECTED_BOOKING_SOURCES contains the three system keys", () => {
    expect(sharedConstantsSrc).toMatch(
      /export const PROTECTED_BOOKING_SOURCES = \["online", "walk-in", "corporate"\] as const;/
    );
  });

  it("AdminContext's deleteBookingSource refuses to delete a protected source", () => {
    expect(adminContextSrc).toMatch(/deleteBookingSource[\s\S]*?PROTECTED_BOOKING_SOURCES\.includes\(source as ProtectedBookingSource\)/);
    expect(adminContextSrc).toMatch(/deleteBookingSource[\s\S]*?throw new Error\(`"\$\{source\}" is a protected booking source and cannot be deleted\.`\)/);
  });
});

describe("NBS-06 — system-assigned sources have selectableAtFrontDesk: false", () => {
  it("DEFAULT_BOOKING_SOURCES marks online / walk-in / corporate as NOT selectable at the front desk", () => {
    // For each system-assigned source, the seed entry must have
    // `selectableAtFrontDesk: false`. The other three (phone /
    // facebook / agoda) must have `true`.
    const seedBlock = sharedConstantsSrc.match(
      /export const DEFAULT_BOOKING_SOURCES: BookingSourceConfig\[\] = \[([\s\S]*?)\];/
    );
    expect(seedBlock, "DEFAULT_BOOKING_SOURCES must be defined").toBeTruthy();
    const block = seedBlock![1];
    // Each of the 3 system sources: source: "<key>", ..., selectableAtFrontDesk: false
    expect(block).toMatch(/\{\s*source:\s*"online"[\s\S]*?selectableAtFrontDesk:\s*false/);
    expect(block).toMatch(/\{\s*source:\s*"walk-in"[\s\S]*?selectableAtFrontDesk:\s*false/);
    expect(block).toMatch(/\{\s*source:\s*"corporate"[\s\S]*?selectableAtFrontDesk:\s*false/);
  });
});

describe("NBS-07 — New Booking modal source selector maps the configured list (selectable + enabled only)", () => {
  it("BookingsPage destructures `bookingSources` from useAdmin", () => {
    expect(bookingsPageSrc).toMatch(/bookingSources,/);
  });

  it("BookingsPage builds a `selectableBookingSources` memo filtering on isEnabled + selectableAtFrontDesk", () => {
    expect(bookingsPageSrc).toMatch(/selectableBookingSources\s*=\s*useMemo<BookingSourceConfig\[\]>/);
    // Match the filter expression with some flexibility around whitespace
    // and the inner `(s) =>` shape.
    expect(bookingsPageSrc).toMatch(/s\.isEnabled\s*&&\s*s\.selectableAtFrontDesk/);
  });

  it("the modal renders the source dropdown mapping selectableBookingSources (not a hardcoded list)", () => {
    // The dropdown is anchored on the <select value={walkinSource} onChange={...} setWalkinSource
    // block — uniquely identified by the onChange handler. The map
    // source is the configured list, NOT literal <option value="phone">.
    const sourceDropdown = bookingsPageSrc.match(
      /<select\s+value=\{walkinSource\}[\s\S]*?<\/select>/
    );
    expect(sourceDropdown, "source dropdown must exist").toBeTruthy();
    expect(sourceDropdown![0]).not.toMatch(/<option value="phone">/);
    expect(sourceDropdown![0]).not.toMatch(/<option value="walk-in">/);
    expect(sourceDropdown![0]).toMatch(/selectableBookingSources\.map\(/);
  });
});

describe("NBS-08 — Reports acquisition chart reads the configured list, NOT a hardcoded array (the regression guard)", () => {
  it("ReportsPage destructures `bookingSources` from useAdmin (renamed locally to avoid shadow)", () => {
    expect(reportsPageSrc).toMatch(/bookingSources:\s*configuredBookingSources/);
  });

  it("the bookingSources memo filters on `isEnabled` and maps labels from the configured list (no hardcoded ['online', 'walk-in', ...])", () => {
    // The old shape was `const sources = ["online", "walk-in", "corporate", "phone", "facebook"]`
    // — pin the bug class as gone.
    expect(reportsPageSrc).not.toMatch(/const sources = \["online", "walk-in", "corporate", "phone", "facebook"\]/);
    // The new shape reads from the configured list and maps labels.
    expect(reportsPageSrc).toMatch(/configured\s*=\s*\(?configuredBookingSources\b/);
    expect(reportsPageSrc).toMatch(/s\.isEnabled/);
  });

  it("the acquisition chart surfaces an 'Unconfigured: <raw-key>' slice for any source not in the configured list", () => {
    // The silent-drop class of bug is loud, not silent: orphan
    // sources get a labeled slice, not a count of 0 / missing slice.
    expect(reportsPageSrc).toMatch(/Unconfigured: \$\{s\}/);
  });

  it("the bookingSources memo's dependency array includes `configuredBookingSources` (not just the bookings)", () => {
    expect(reportsPageSrc).toMatch(/}, \[occupancyBookings, configuredBookingSources, chartColors\]\);/);
  });
});

describe("NBS-09 — Bookings table source filter reads the configured list and the chip renders the label", () => {
  it("the source filter <select> maps the configured list (no hardcoded <option value='phone'>)", () => {
    // Anchored on the bSource select block (uniquely identified by
    // value={bSource}).
    const sourceFilter = bookingsPageSrc.match(
      /<select\s+value=\{bSource\}[\s\S]*?<\/select>/
    );
    expect(sourceFilter, "source filter must exist").toBeTruthy();
    expect(sourceFilter![0]).not.toMatch(/<option value="phone">/);
    expect(sourceFilter![0]).not.toMatch(/<option value="walk-in">/);
    // The map source is the configured list (bookingSources), NOT a
    // hardcoded array of literal options.
    expect(sourceFilter![0]).toMatch(/\(?bookingSources\b[\s\S]*?\.map\(/);
  });

  it("the active-filter chip renders the configured label, not the raw key", () => {
    // Before NBS-09: `Source: ${bSource}` (raw key). After: looks up
    // the label from the configured list and falls back to the raw
    // key if the source is no longer in the list.
    expect(bookingsPageSrc).toMatch(/s\.source\s*===\s*bSource\)\?\.label\s*\|\|\s*bSource/);
  });
});

describe("NBS-02 — server schema accepts source with default 'walk-in' and derives note", () => {
  it("WalkinBookingSchema adds `source: z.string().trim().min(1).max(80).optional().default('walk-in')`", () => {
    expect(sharedSchemasBookingSrc).toMatch(/source: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(80\)\.optional\(\)\.default\("walk-in"\)/);
  });

  it("the server derives the note from the resolved source (no hardcoded 'Created on-site at Front Desk.')", () => {
    // The historical hardcoded shape is gone; the server now
    // calls deriveSourceNote(source).
    expect(serverBookingsSrc).not.toMatch(/notes: "Created on-site at Front Desk\."/);
    expect(serverBookingsSrc).toMatch(/notes: deriveSourceNote\(resolvedSource\)/);
  });

  it("deriveSourceNote returns a source-accurate note for each known channel", () => {
    expect(serverBookingsSrc).toMatch(/function deriveSourceNote\(source: string\): string/);
    expect(serverBookingsSrc).toMatch(/case "walk-in":\s*return "Created on-site at Front Desk\.";/);
    expect(serverBookingsSrc).toMatch(/case "phone":\s*return "Booked via phone call\.";/);
    expect(serverBookingsSrc).toMatch(/case "facebook":\s*return "Booked via Facebook \/ Messenger\.";/);
    expect(serverBookingsSrc).toMatch(/case "agoda":\s*return "Booked via Agoda \(OTA\)\.";/);
  });

  it("the server validates the submitted source against the configured list and falls back to 'walk-in'", () => {
    expect(serverBookingsSrc).toMatch(/validSourceKeys\.includes\(requestedSource\) \? requestedSource : "walk-in"/);
  });
});
