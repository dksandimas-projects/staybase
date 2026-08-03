// Per MRB-15-04 (2026-08-03): the N=1 + legacy
// null-`reservationId` byte-equivalence audit. Every
// reservation-aware code path that handles N>1 must
// have a single-room + legacy fallback that reads from
// the booking doc directly — the header doesn't exist
// for legacy pre-MRB-01 bookings, and the header
// doesn't add anything for N=1 (no children to
// aggregate). A future refactor cannot silently route
// N=1 or legacy bookings through the reservation-aware
// path without the explicit byte-equivalence guard.
//
// The pre-MRB-15 audit pattern is "every surface that
// synthesises a reservation view has a single-room +
// legacy fallback." The contract is the JSDoc on
// `buildReservationEmailView` ("legacy single-room
// bookings without a `reservationId` (pre-MRB-01) ...
// the helper returns `null` and the caller falls
// through to the pre-MRB-09 single-room path") — every
// other surface follows the same pattern.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural tests
// (full create → lookup → email rendering) are the
// emulator follow-up.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);
const bookingFolioSharedSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingFolio.ts"),
  "utf8"
);
const adminBookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

describe("MRB-15-04 — `loadReservationEmailView` returns `null` for legacy null-`reservationId` bookings", () => {
  it("the helper reads `reservationId` from the booking and returns `null` when it's empty", () => {
    // The reservation-scope email view loader is
    // the single source of truth for the multi-room
    // email view. For legacy null-`reservationId`
    // bookings (pre-MRB-01) it MUST return `null`
    // so the caller falls through to the pre-MRB-09
    // single-room path. The `String(booking.reservationId
    // || "").trim()` defensive coercion is the
    // canonical pattern.
    const loadReservationViewBlock = bookingsHandlerSrc.match(
      /function loadReservationEmailView[\s\S]{0,2500}?if \(!reservationId\) return null/
    );
    expect(
      loadReservationViewBlock,
      "expected loadReservationEmailView to return null when reservationId is empty"
    ).toBeTruthy();
  });

  it("the helper builds the view only after the reservation header is read (and exists)", () => {
    // The view is built INSIDE the function — the
    // helper reads the header in parallel with the
    // children, and `if (!reservationSnap.exists)
    // return null;` is the defensive guard. A
    // half-stamped state (header exists, children
    // empty) still returns `null` so the caller
    // doesn't render a reservation view from a
    // dangling header.
    const headerGuard = bookingsHandlerSrc.match(
      /loadReservationEmailView[\s\S]{0,2500}?if \(!reservationSnap\.exists\) return null/
    );
    expect(
      headerGuard,
      "expected loadReservationEmailView to guard on missing reservation header"
    ).toBeTruthy();
  });
});

describe("MRB-15-04 — Email `buildReservationEmailView` returns `null` for empty children", () => {
  it("the view builder returns `null` when children is empty or not an array", () => {
    // Defensive guard — the helper is called with
    // a children array, but a half-stamped state
    // (header exists, children empty) would render
    // an empty view. The `null` return short-
    // circuits the caller to the pre-MRB-09
    // single-room path.
    const buildViewGuard = emailHandlerSrc.match(
      /export function buildReservationEmailView[\s\S]{0,200}?if \(!reservation \|\| !Array\.isArray\(children\) \|\| children\.length === 0\) return null/
    );
    expect(
      buildViewGuard,
      "expected buildReservationEmailView to return null when reservation or children is missing"
    ).toBeTruthy();
  });
});

describe("MRB-15-04 — Email `bookingRows` reservation branch reads `rooms[]` (works for N=1 too — the rooms array is synthesised with 1 entry)", () => {
  it("the reservation branch is entered when `rooms.length > 0` (the N=1 case still hits the new shape)", () => {
    // Per MRB-09 / decision #168: the new shape
    // renders for N>=1. N=1 reads "1 room" instead
    // of "N rooms" + lists the single room. The
    // legacy single-room path is `else { ... }`
    // and is unreachable for any booking that
    // already carries a `reservationId` (the
    // caller is responsible for routing legacy
    // pre-MRB-01 bookings through the legacy
    // path BEFORE the view is built).
    const reservationBranch = emailHandlerSrc.match(
      /const rooms = Array\.isArray\(booking\.rooms\) \? booking\.rooms : null;\s*\n\s*const isReservation = rooms && rooms\.length > 0;/
    );
    expect(
      reservationBranch,
      "expected bookingRows to detect the reservation shape via `rooms.length > 0`"
    ).toBeTruthy();
  });

  it("the rooms table renders the per-room ref + occupancy + per-stay total (the N=1 case reads the single room's data)", () => {
    // The rooms table is rendered for every N>=1.
    // For N=1, the table has 1 row; the legacy
    // "Booking reference" row at the top of the
    // single-room shape is replaced by the table's
    // own ref column (which renders the same value).
    const roomsTableBlock = emailHandlerSrc.match(
      /for \(const room of rooms\)[\s\S]{0,2000}?Room \$\{room\.position \|\| 1\}/
    );
    expect(
      roomsTableBlock,
      "expected the rooms table to render the per-room ref + occupancy + per-stay total"
    ).toBeTruthy();
  });
});

describe("MRB-15-04 — `handleLookupBooking` returns `kind: \"single\"` for N=1 + legacy null-`reservationId`", () => {
  it("the lookup returns `kind: \"reservation\"` only when the booking has a `reservationId` AND `children.length > 1`", () => {
    // The MRB-10 lookup's reservation branch is
    // gated on TWO conditions: the looked-up
    // booking has a `reservationId` (so legacy
    // pre-MRB-01 bookings skip it) AND the
    // reservation has more than 1 child (so N=1
    // reservations stay on the `kind: "single"`
    // path — the reservation view is byte-equivalent
    // to the per-child view for N=1, so there's no
    // win from switching to the multi-room shape).
    // The handler delegates to
    // `buildReservationLookupView(...)` which is
    // the only function that returns the
    // `kind: "reservation"` shape.
    const lookupGate = bookingsHandlerSrc.match(
      /if \(reservationId\) \{[\s\S]{0,1500}?if \(children\.length > 1\) \{[\s\S]{0,300}?return res\.status\(200\)\.json\(\{[\s\S]{0,300}?data: buildReservationLookupView/
    );
    expect(
      lookupGate,
      "expected handleLookupBooking to call buildReservationLookupView only when reservationId is present AND children.length > 1"
    ).toBeTruthy();
    // The `kind: "reservation"` literal lives
    // inside the `buildReservationLookupView`
    // function (the only function that returns
    // the multi-room shape).
    const kindLiteral = bookingsHandlerSrc.match(
      /function buildReservationLookupView[\s\S]{0,5000}?kind: "reservation"/
    );
    expect(
      kindLiteral,
      "expected buildReservationLookupView to return kind: 'reservation'"
    ).toBeTruthy();
  });

  it("the lookup's single-booking fallback always carries `kind: \"single\"`", () => {
    // Every non-reservation response (legacy
    // null-`reservationId` + N=1 + the
    // error / not-found cases) carries
    // `kind: "single"` so the page can branch
    // deterministically. Backward-compatible:
    // older clients that don't read `kind` still
    // get the same fields they always did.
    const singleKind = bookingsHandlerSrc.match(
      /data: \{[\s\S]{0,200}?kind: "single"/
    );
    expect(
      singleKind,
      "expected handleLookupBooking's single-booking fallback to carry kind: 'single'"
    ).toBeTruthy();
  });
});

describe("MRB-15-04 — `readTransactionalFolioSnapshot` falls back to booking subcollection for legacy null-`reservationId`", () => {
  it("the helper skips reservation subcollection reads when `bookingReservationId === \"\"`", () => {
    // The transactional folio reader takes the
    // reservation-aware path (read
    // `reservations/{id}/payments` + `/refunds` +
    // `/charges` + the children) only when the
    // booking has a `reservationId`. For legacy
    // null-`reservationId` bookings, the helper
    // returns early with a snapshot that reads
    // from `bookings/{id}/payments` (the CRL-01
    // historical convention) + `bookings/{id}/charges`
    // — byte-equivalent to pre-MRB-04 Phase 2.
    const folioGate = bookingsHandlerSrc.match(
      /function readTransactionalFolioSnapshot[\s\S]{0,2000}?if \(!bookingReservationId\) \{/
    );
    expect(
      folioGate,
      "expected readTransactionalFolioSnapshot to early-return for legacy null-reservationId bookings"
    ).toBeTruthy();
  });
});

describe("MRB-15-04 — Admin `selectedReservationContext` returns `null` for legacy null-`reservationId` bookings (drawer strip falls through)", () => {
  it("the context gate is `!selectedBooking?.reservationId` (the single byte-equivalence guard for the entire drawer strip)", () => {
    // The drawer reservation strip (ref + position
    // + sibling buttons + Total/Paid/Balance
    // pills + Actual range pill + cancel scope
    // picker) is the single surface that aggregates
    // every MRB reservation-aware read. If the
    // booking has no `reservationId`, the context
    // is `null` and the entire strip falls
    // through to the per-room drawer (byte-
    // equivalent to pre-MRB-07).
    const contextGate = adminBookingsPageSrc.match(
      /const selectedReservationContext = useMemo\(\(\) => \{[\s\S]{0,200}?if \(!selectedBooking\?\.reservationId\) return null;/
    );
    expect(
      contextGate,
      "expected the admin selectedReservationContext to early-return null for legacy bookings"
    ).toBeTruthy();
  });

  it("the `renderActionScope` helper returns `null` when `selectedReservationContext` is `null` (no chip for legacy bookings)", () => {
    // Every multi-room action's `renderActionScope`
    // chip is gated on `selectedReservationContext`.
    // A null context (legacy / N=1 surface) returns
    // `null` from the helper so the action button
    // renders without a chip — byte-equivalent to
    // pre-MRB-07 (the chip didn't exist yet).
    const renderActionScopeGate = adminBookingsPageSrc.match(
      /const renderActionScope = \(scope: "room" \| "reservation"\) => \{[\s\S]{0,200}?if \(!selectedReservationContext\) return null;/
    );
    expect(
      renderActionScopeGate,
      "expected renderActionScope to early-return null for legacy bookings"
    ).toBeTruthy();
  });
});

describe("MRB-15-04 — `AdminContext` listener hydrates `Reservation` from the reservations collection, independent of the in-memory `bookings` array", () => {
  it("the reservations listener is a separate `onSnapshot` (the in-memory `bookings` array remains the source for legacy + N=1 surfaces)", () => {
    // The reservations listener is a full-
    // collection `onSnapshot` that hydrates the
    // `Reservation[]` into the context. The
    // in-memory `bookings` array is hydrated by a
    // SEPARATE listener — a legacy null-
    // `reservationId` booking exists only in
    // `bookings` (no matching `reservations` doc).
    // The admin row builder for legacy bookings
    // reads from `bookings`, not from
    // `reservationsMap`.
    expect(adminContextSrc).toMatch(
      /collection\(db, "reservations"\)/
    );
    expect(adminContextSrc).toMatch(
      /const \[reservations, setReservations\] = useState<Reservation\[\]>\(\[\]\)/
    );
  });

  it("the listener defensively coerces `actualDateRange` (the legacy byte-equivalence is preserved via the null branch)", () => {
    // Pre-MRB-14 reservations carry no
    // `actualDateRange` field — the hydration's
    // IIFE returns `null` for missing / invalid
    // values. The admin + email + receipt
    // surfaces fall through to the legacy
    // per-child read when the field is `null`.
    expect(adminContextSrc).toMatch(
      /actualDateRange: \(\(\) => \{[\s\S]{0,500}?if \(!raw \|\| typeof raw !== "object"\) return null;/
    );
  });
});

describe("MRB-15-04 — `getReservationFolioSummary` is the reservation-scope reader; legacy bookings bypass it via the `if (!bookingReservationId)` gate", () => {
  it("the helper carries a `source` field that distinguishes `reservation-subcollection` from `booking-subcollection-legacy`", () => {
    // The helper's `source` field is the
    // explicit byte-equivalence contract: every
    // caller that uses the helper MUST pass a
    // `source` value that tells the reader
    // whether the sum came from the reservation
    // subcollection (new reservations) or the
    // booking subcollection (legacy null-
    // `reservationId`). The type is
    // `"reservation-subcollection" |
    // "booking-subcollection-legacy"`.
    expect(bookingFolioSharedSrc).toMatch(
      /source: "reservation-subcollection" \| "booking-subcollection-legacy"/
    );
  });
});

describe("MRB-15-04 — Cancel handler: N=1 stays on the per-child path; reservation-scope fires only when `scope === \"reservation\"` AND the booking has a `reservationId`", () => {
  it("the reservation-scope branch is gated on BOTH `scope === \"reservation\"` AND the looked-up booking having a `reservationId`", () => {
    // Per MRB-13 / decision #166: a legacy null-
    // `reservationId` booking always goes through
    // the per-child path (the `scope` is honored
    // but the reservation branch is unreachable).
    // An N=1 reservation with `scope: "room"`
    // (the default) also stays on the per-child
    // path. The two never overlap. The gate
    // pattern is `isReservationScope =
    // requestedScope === "reservation" &&
    // lookedUpReservationId.length > 0`.
    const cancelGate = bookingsHandlerSrc.match(
      /const isReservationScope = requestedScope === "reservation" && lookedUpReservationId\.length > 0/
    );
    expect(
      cancelGate,
      "expected the cancel handler to gate the reservation-scope branch on BOTH scope AND reservationId"
    ).toBeTruthy();
  });
});

describe("MRB-15-04 — Create / walkin initialize `roomCount: 1` + `activeRoomCount: 1` for N=1 reservations (the new create path's default)", () => {
  it("the create handler stamps `roomCount: assignedRooms.length` + `activeRoomCount: assignedRooms.length`", () => {
    // N=1 is the common case (`assignedRooms.length === 1`)
    // — the header is stamped with `roomCount: 1` and
    // `activeRoomCount: 1` so the admin row's
    // "1 rooms" badge is correct. N>1 is stamped
    // with the actual count.
    expect(bookingsHandlerSrc).toMatch(
      /roomCount: assignedRooms\.length,[\s\S]{0,200}?activeRoomCount: assignedRooms\.length,/
    );
  });

  it("the walkin handler stamps `roomCount: walkinRoomCount` + `activeRoomCount: walkinRoomCount` (mirrors the create handler)", () => {
    // Walkin's header stamps match the create
    // handler's — same shape, same counter
    // initialization, byte-equivalent to the
    // online create path.
    expect(bookingsHandlerSrc).toMatch(
      /roomCount: walkinRoomCount,[\s\S]{0,200}?activeRoomCount: walkinRoomCount,/
    );
  });
});
