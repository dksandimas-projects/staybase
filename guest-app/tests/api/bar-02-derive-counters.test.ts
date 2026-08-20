// Per BAR-02 (2026-08-08, per decision #203): every
// reservation-header counter write site is removed.
// Consumers that need the counters derive them via
// `deriveReservationCounters` over the children at read
// time. This file pins the new read path at the source
// level so a future refactor cannot silently re-introduce
// the redundant writes (which were the source of the
// "two sources of truth" smell that BAR-01's spec
// identified).
//
// The pre-BAR-02 transactional counter contract
// (per MRB-15-03, 2026-08-03) is replaced by:
//
//   1. NO Firestore write of the 5 counter fields
//      anywhere in the codebase (create / walkin /
//      add-room / cancel / checkin / checkout /
//      FOL-05 sibling-flip / single-cancel / corporate
//      paths all confirmed gone).
//   2. NO `paymentStatus: computeReservationAggregatePaymentStatus(...)`
//      write anywhere in the codebase (the
//      sibling-flip pass computes the value for its
//      own post-update child status array, but
//      never persists it to the header).
//   3. The `deriveReservationCounters` helper exists
//      in `shared/utils/bookingFolio.ts` and is the
//      canonical read path for the 5 counter fields.
//   4. The `computeReservationAggregatePaymentStatus`
//      helper (already shipped in MRB-05) is the
//      canonical read path for `paymentStatus`.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural test
// surface for the derivation lives in
// `shared/__tests__/booking-folio.test.ts` (the helper
// characterization tests). The Firestore round-trip
// tests in `firebase/tests/` cover the
// `transactions` invariants indirectly via the per-child
// status writes (which are unchanged).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const HANDLERS_PATH = join(REPO_ROOT, "guest-app", "server", "handlers", "bookings.ts");
const SHARED_TYPES_PATH = join(REPO_ROOT, "shared", "types", "index.ts");
const SHARED_FOLIO_PATH = join(REPO_ROOT, "shared", "utils", "bookingFolio.ts");

const handlers = readFileSync(HANDLERS_PATH, "utf-8");
const sharedTypes = readFileSync(SHARED_TYPES_PATH, "utf-8");
const sharedFolio = readFileSync(SHARED_FOLIO_PATH, "utf-8");

// Section 1: the type contract — the 5 counter fields
// are no longer required on `Reservation`. The fields
// may appear as optional `?` for back-compat reads of
// pre-BAR-02 reservations, but never as `number` (the
// pre-BAR-02 required shape). `paymentStatus` likewise
// is optional.
describe("BAR-02 — type contract: `Reservation` no longer requires the 5 counter fields or `paymentStatus`", () => {
  it("`roomCount` is optional (`?:`) — not a required `number`", () => {
    // Pre-BAR-02: `roomCount: number;` (required). Post-BAR-02:
    // `roomCount?: number;` (optional, for back-compat
    // reads of pre-BAR-02 Firestore data).
    const reservationInterface = extractReservationInterface(sharedTypes);
    expect(reservationInterface).toMatch(/roomCount\?:\s*number;/);
    expect(reservationInterface).not.toMatch(/^[^?]*roomCount:\s*number;/m);
  });

  it("`activeRoomCount` is optional", () => {
    const reservationInterface = extractReservationInterface(sharedTypes);
    expect(reservationInterface).toMatch(/activeRoomCount\?:\s*number;/);
  });

  it("`cancelledRoomCount` is optional", () => {
    const reservationInterface = extractReservationInterface(sharedTypes);
    expect(reservationInterface).toMatch(/cancelledRoomCount\?:\s*number;/);
  });

  it("`checkedInRoomCount` is optional", () => {
    const reservationInterface = extractReservationInterface(sharedTypes);
    expect(reservationInterface).toMatch(/checkedInRoomCount\?:\s*number;/);
  });

  it("`checkedOutRoomCount` is optional", () => {
    const reservationInterface = extractReservationInterface(sharedTypes);
    expect(reservationInterface).toMatch(/checkedOutRoomCount\?:\s*number;/);
  });

  it("`paymentStatus` is optional", () => {
    // Pre-BAR-02: `paymentStatus: ReservationPaymentStatus;` (required).
    // Post-BAR-02: `paymentStatus?: ReservationPaymentStatus;` (optional).
    const reservationInterface = extractReservationInterface(sharedTypes);
    expect(reservationInterface).toMatch(/paymentStatus\?:\s*ReservationPaymentStatus;/);
  });
});

// Section 2: the create / walkin paths do NOT stamp
// the 5 counter fields. The pre-BAR-02 init
// (`roomCount: assignedRooms.length` / `activeRoomCount: assignedRooms.length`
// / `cancelledRoomCount: 0` / `checkedInRoomCount: 0` /
// `checkedOutRoomCount: 0`) is gone.
describe("BAR-02 — create / walkin paths do NOT write the 5 counter fields", () => {
  it("the public create handler does NOT stamp any of the 5 counter fields", () => {
    // The pre-BAR-02 create-time init is the
    // canonical "five zero-init" pattern. The
    // assertions here scan the entire handlers
    // file for the specific expression that the
    // init would have used (`roomCount:
    // assignedRooms.length,` — the expression
    // MRB-06 / MRB-07 used to introduce
    // counter-proliferation into the public
    // create handler).
    expect(handlers).not.toMatch(/roomCount:\s*assignedRooms\.length,/);
    expect(handlers).not.toMatch(/activeRoomCount:\s*assignedRooms\.length,/);
  });

  it("the walkin handler does NOT stamp any of the 5 counter fields", () => {
    // Same posture for the walkin handler.
    expect(handlers).not.toMatch(/roomCount:\s*walkinRoomCount,/);
    expect(handlers).not.toMatch(/activeRoomCount:\s*walkinRoomCount,/);
    expect(handlers).not.toMatch(
      /checkedInRoomCount:\s*status === "checked-in" \? walkinRoomCount : 0/
    );
  });

  it("the create handler does NOT initialize the lifecycle counters to 0", () => {
    // The pre-BAR-02 init also stamped the
    // lifecycle counters to their create-time
    // zero values. Those writes are gone.
    expect(handlers).not.toMatch(/cancelledRoomCount:\s*0/);
    expect(handlers).not.toMatch(/checkedInRoomCount:\s*0/);
    expect(handlers).not.toMatch(/checkedOutRoomCount:\s*0/);
  });
});

// Section 3: the cancel path does NOT write the
// counter increment / decrement or the `paymentStatus`
// mirror. The pre-BAR-02 cancel logic
// (`newCancelledRoomCount = ... + cancelledCount` +
// `cancelledRoomCount: newCancelledRoomCount` in the
// same transaction; `newActiveRoomCount = Math.max(...
// - cancelledCount, 0)`; `paymentStatus:
// computeReservationAggregatePaymentStatus(postStatuses)`)
// is gone. The per-child CRL-02 cancellation stamps
// are unchanged.
describe("BAR-02 — cancel path does NOT write the counter mirror or `paymentStatus`", () => {
  it("the cancel handler does NOT write `cancelledRoomCount` to the reservation header", () => {
    // Pre-BAR-02: `cancelledRoomCount: newCancelledRoomCount` inside the
    // reservation-scope cancel transaction. The
    // value is now derived at read time.
    expect(handlers).not.toMatch(
      /cancelledRoomCount: newCancelledRoomCount/
    );
    expect(handlers).not.toMatch(
      /newCancelledRoomCount = \(Number\(reservationData\.cancelledRoomCount\) \|\| 0\) \+ cancelledCount/
    );
  });

  it("the cancel handler does NOT write `activeRoomCount` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /newActiveRoomCount = Math\.max\(\s*\(Number\(reservationData\.activeRoomCount\) \|\| 0\) - cancelledCount,\s*0\s*\)/
    );
  });

  it("the cancel handler does NOT write `paymentStatus` to the reservation header", () => {
    // The pre-BAR-02 cancel wrote
    // `paymentStatus: computeReservationAggregatePaymentStatus(postStatuses)`
    // in the same transaction. Gone.
    expect(handlers).not.toMatch(
      /paymentStatus: computeReservationAggregatePaymentStatus\(postStatuses\)/
    );
  });
});

// Section 4: the checkin / checkout paths do NOT
// write `checkedInRoomCount` / `checkedOutRoomCount`
// or the `paymentStatus` mirror.
describe("BAR-02 — checkin / checkout paths do NOT write the counter mirror or `paymentStatus`", () => {
  it("the checkin handler does NOT write `checkedInRoomCount` to the reservation header", () => {
    // Pre-BAR-02: `checkedInRoomCount: newCheckedInCount` in the same
    // transaction. Gone.
    expect(handlers).not.toMatch(
      /checkedInRoomCount: newCheckedInCount,?\s*\n\s*paymentStatus:/
    );
  });

  it("the checkout handler does NOT write `checkedInRoomCount` or `checkedOutRoomCount` to the reservation header", () => {
    expect(handlers).not.toMatch(
      /checkedInRoomCount: newCheckedInCount,?\s*\n\s*checkedOutRoomCount: newCheckedOutCount/
    );
  });

  it("the FOL-05 sibling-flip pass does NOT write `paymentStatus` to the reservation header (verify / add-payment / reject / apply-discount / confirm-with-balance / CWB-rebooking)", () => {
    // The pre-BAR-02 FOL-05 mirror was the
    // biggest source of the "two sources of truth"
    // smell — every payment handler that flipped
    // a sibling also wrote the `paymentStatus`
    // mirror. All six mirror writes are gone:
    // verify / add-payment / reject / apply-discount
    // / confirm-with-balance / CWB-rebooking.
    //
    // The match is broad (`paymentStatus:
    // computeReservationAggregatePaymentStatus(...)`
    // ANYWHERE in the handlers file) — the only
    // acceptable occurrences are the read-time
    // helper calls (inside `postStatuses` or the
    // per-child stamp helpers, which are pure
    // reads, not writes).
    const mirrorWrites = handlers.match(
      /paymentStatus:\s*computeReservationAggregatePaymentStatus\(/g
    );
    expect(
      mirrorWrites,
      "expected zero `paymentStatus: computeReservationAggregatePaymentStatus(...)` writes (pre-BAR-02 had 6)"
    ).toBeNull();
  });
});

// Section 5: the add-room endpoint (MRB-14) does NOT
// write the counter mirror.
describe("BAR-02 — add-room endpoint does NOT write `roomCount` or `activeRoomCount`", () => {
  it("the add-room handler does NOT increment `roomCount` or `activeRoomCount` in the header update", () => {
    // Pre-BAR-02 MRB-14 stamped
    // `roomCount: existingChildren.length + 1,` and
    // `activeRoomCount: existingChildren.length + 1,`
    // in the header update. Gone.
    expect(handlers).not.toMatch(
      /roomCount: existingChildren\.length \+ 1,/
    );
    expect(handlers).not.toMatch(
      /activeRoomCount: existingChildren\.length \+ 1,/
    );
  });
});

// Section 6: the derivation helper exists and is the
// canonical read path. The helper is tested in
// `shared/__tests__/booking-folio.test.ts`; this
// section pins its presence in the source so a future
// refactor cannot accidentally delete the public
// export.
describe("BAR-02 — the derivation helper is the canonical read path", () => {
  it("`deriveReservationCounters` is exported from `shared/utils/bookingFolio.ts`", () => {
    expect(sharedFolio).toMatch(
      /export function deriveReservationCounters\(/
    );
  });

  it("`deriveReservationCounters` accepts a readonly array of `{ status?: string \\| null }`", () => {
    // The minimal input contract — the helper
    // accepts any shape that exposes a `status`
    // field. Both `Booking` (with `status: BookingStatus`)
    // and the in-memory child arrays used by the
    // server-side email view (with `status: string`)
    // satisfy the type.
    expect(sharedFolio).toMatch(
      /children:\s*ReadonlyArray<\{ status\?:\s*string \| null \}>/s
    );
  });

  it("`deriveReservationCounters` returns all 5 fields (`roomCount` / `activeRoomCount` / `cancelledRoomCount` / `checkedInRoomCount` / `checkedOutRoomCount`)", () => {
    // The wire contract — the return type
    // includes all 5 fields. The TypeScript
    // shape is asserted indirectly via the
    // `ReservationCounters` interface + the
    // return statement.
    expect(sharedFolio).toMatch(
      /export interface ReservationCounters \{[\s\S]{0,500}?roomCount:\s*number;[\s\S]{0,200}?activeRoomCount:\s*number;[\s\S]{0,200}?cancelledRoomCount:\s*number;[\s\S]{0,200}?checkedInRoomCount:\s*number;[\s\S]{0,200}?checkedOutRoomCount:\s*number;/
    );
  });
});

// Helper: extract the body of the `Reservation`
// interface from the shared types. Used to scope the
// "is the field required or optional" assertions to
// the interface body so a future `Room` /
// `Booking` field with the same name (a collision
// hazard) cannot false-positive the assertion.
function extractReservationInterface(sharedTypes: string): string {
  const match = sharedTypes.match(
    /export interface Reservation \{([\s\S]*?)\n\}/
  );
  if (!match) {
    throw new Error("could not locate `export interface Reservation` in shared/types/index.ts");
  }
  return match[1];
}
