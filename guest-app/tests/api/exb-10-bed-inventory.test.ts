import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per EXB-10 (2026-08-01, per decision #157): source-text
// regression tests for the hotel-wide rollaway-bed
// inventory check. The emulator tests that would exercise
// the real Firestore transactions (read inventory → query
// overlapping bookings → enforce cap) are out of scope for
// this sandbox (Java not installed; PMH-03). The source-text
// guards below pin the contract that the emulator tests
// will later exercise end-to-end.
//
// Background (per `plan/project/ROADMAP.md §EXB-10`):
//   - `settings/hotelConfig.extraBedInventory` is the
//     hotel-wide count of rollaway beds. `0` or absent =
//     the historical "any number" behavior (no constraint).
//     A positive integer enforces
//     `inUseAcrossOverlappingStays + requestedCount <=
//     extraBedInventory`.
//   - The check runs INSIDE the same Firestore transaction
//     that assigns the room — a read-then-write check
//     outside the transaction would race exactly like
//     RTS-01 (two concurrent bookings both see "1 bed free"
//     and both take it).
//   - The helper is pure: it takes a pre-fetched list of
//     candidate bookings + the requested range and returns
//     the in-use count; the cap check is a single
//     `checkExtraBedInventory` call. Unit tests for the
//     helper itself are in
//     `shared/__tests__/extra-bed-inventory.test.ts` (the
//     11 EXB-10 cases there: empty list, non-overlapping,
//     multiple overlapping, cancelled excluded,
//     expired-hold pending excluded, excludeBookingId,
//     half-open overlap, defensive coercion, 0 inventory =
//     no constraint, fits exactly, exceeds cap).
//   - `excludeBookingId` is the reschedule case: the
//     current booking's own extra-bed count must be
//     excluded from the in-use sum, otherwise every
//     reschedule would always "use" its own bed and
//     reject the new configuration.
//   - The three server call sites are `handleCreateBooking`
//     + `handleCreateWalkin` (new booking, no exclusion) +
//     `handleRescheduleBooking` (existing booking, must
//     pass `excludeBookingId: bookingId`).

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const extraBedInventoryHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/extraBedInventory.ts"),
  "utf8"
);

const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

describe("EXB-10 — hotel-wide rollaway-bed inventory (helper + 3 server call sites)", () => {
  it("the helper is exported from `shared/utils/extraBedInventory.ts` with the documented signature", () => {
    // The helper is the single source of truth for the
    // in-use math. Every call site routes through it.
    // Pin the export + the function signatures so a
    // refactor that renames or moves either function
    // forces a test update.
    expect(extraBedInventoryHelperSrc).toMatch(
      /export\s+function\s+countExtraBedsInUse\(\s*bookings:\s*InventoryBooking\[\][\s\S]{0,200}rangeStart:\s*Date[\s\S]{0,200}rangeEnd:\s*Date[\s\S]{0,200}excludeBookingId\?:\s*string/
    );
    expect(extraBedInventoryHelperSrc).toMatch(
      /export\s+function\s+checkExtraBedInventory\(\s*inventory:\s*number[\s\S]{0,200}inUse:\s*number[\s\S]{0,200}requestedCount:\s*number/
    );
  });

  it("the helper returns `{ inUse, available, ok }` from `checkExtraBedInventory`", () => {
    // The return shape is the contract for every call
    // site — the `!ok` gate is the rejection. Pin the
    // literal so a future helper that returns a `boolean`
    // or a `string` error surfaces here.
    expect(extraBedInventoryHelperSrc).toMatch(
      /return\s*\{\s*inUse:[\s\S]{0,200}available:[\s\S]{0,200}ok:/
    );
  });

  it("`0 inventory` short-circuits to `ok: true` (no constraint = legacy behavior)", () => {
    // The "0 = no constraint" semantics is the load-bearing
    // back-compat guarantee. Without it, legacy settings
    // without the field would suddenly start rejecting
    // bookings that previously succeeded. Pin the short
    // circuit so a future helper that treats 0 as "0
    // available" surfaces here.
    expect(extraBedInventoryHelperSrc).toMatch(
      /if\s*\(\s*safeInventory\s*<=\s*0\s*\)\s*\{[\s\S]{0,200}ok:\s*true/
    );
  });

  it("the helper is re-exported from the shared package barrel", () => {
    // The guest-app imports it as
    // `import { countExtraBedsInUse, checkExtraBedInventory } from "@spark-inn/shared"`.
    // The barrel re-export keeps that import surface
    // stable as the helper moves within the shared tree.
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/extraBedInventory"/);
  });

  it("the two helpers are imported in the guest-app server handler from @spark-inn/shared", () => {
    // The import line in `bookings.ts` is the contract
    // — pin the symbols so a rename in the shared
    // barrel surfaces here. The block is multi-line (per
    // the EXB-03 + EXB-10 comment padding), so the regex
    // anchors on the symbol + the closing `} from
    // "@spark-inn/shared"`.
    expect(bookingsHandlerSrc).toMatch(
      /countExtraBedsInUse[\s\S]{0,800}checkExtraBedInventory[\s\S]{0,500}\}\s*from\s*"@spark-inn\/shared"/
    );
  });

  it("handleCreateBooking calls `checkExtraBedInventory` and rejects when over capacity", () => {
    // The new check lives in handleCreateBooking, after
    // the EXB-03 overflow check, inside the same
    // `runTransaction` block (the `transaction.get(...)`
    // call is the in-transaction read that prevents the
    // RTS-01 race). The error message includes the
    // in-use + requested + total counts so the desk /
    // guest can see exactly what the inventory ceiling
    // is blocking.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*!inventoryResult\.ok\s*\)\s*\{[\s\S]{0,400}Not enough extra beds:[\s\S]{0,200}already booked across overlapping stays[\s\S]{0,200}rollaway bed\(s\) in inventory/m
    );
  });

  it("handleCreateBooking's inventory check is INSIDE `runTransaction` (the in-transaction read)", () => {
    // The RTS-01 lesson: a read-then-write check outside
    // the transaction would race. The `transaction.get`
    // call is the in-transaction read; the helper's
    // result feeds the `if (!ok) throw` rejection. Pin
    // the local query name + the transaction read so a
    // future refactor that moves the read out of the
    // transaction (e.g. to a `Promise.all` before the
    // transaction) surfaces here.
    expect(bookingsHandlerSrc).toMatch(
      /const\s+extraBedOverlapQuery\s*=\s*adminDb\.collection\("bookings"\)[\s\S]{0,300}\.where\("status",\s*"in",\s*ROOM_OCCUPYING_STATUSES\)[\s\S]{0,200}\)/m
    );
    expect(bookingsHandlerSrc).toMatch(
      /const\s+extraBedOverlapSnapshot\s*=\s*await\s+transaction\.get\(extraBedOverlapQuery\)/
    );
  });

  it("handleCreateBooking's inventory check is gated on `extraBedCount > 0` (the no-extra-bed fast path)", () => {
    // The inventory check is a no-op when the booking
    // requests 0 extra beds — the early `if` skips the
    // query + the helper call. Pin the gate so a
    // refactor that always runs the query (e.g. "for
    // symmetry") doesn't add a per-booking Firestore
    // read for the 99% case where the booking has no
    // extra bed.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*extraBedCount\s*>\s*0\s*\)\s*\{[\s\S]{0,200}extraBedOverlapQuery/m
    );
  });

  it("handleCreateWalkin calls `checkExtraBedInventory` with the walkin-scoped variables", () => {
    // The walk-in path uses the same helper, scoped to
    // `walkinExtraBedCount` (the walkin transaction
    // already validated the per-type cap). The
    // inventory check is the last gate before the
    // booking write.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*!walkinInventoryResult\.ok\s*\)\s*\{[\s\S]{0,400}Not enough extra beds:[\s\S]{0,200}already booked across overlapping stays/m
    );
    expect(bookingsHandlerSrc).toMatch(
      /checkExtraBedInventory\([\s\S]{0,200}walkinExtraBedCount\s*\)/
    );
  });

  it("handleCreateWalkin's inventory check is INSIDE `runTransaction` (mirrors the create path)", () => {
    // Same RTS-01 race protection as handleCreateBooking.
    // Pin the local query name + the transaction read so
    // a future refactor that moves the read out of the
    // transaction surfaces here.
    expect(bookingsHandlerSrc).toMatch(
      /const\s+walkinExtraBedOverlapSnapshot\s*=\s*await\s+transaction\.get\(walkinExtraBedOverlapQuery\)/
    );
  });

  it("handleCreateWalkin's inventory check is gated on `walkinExtraBedCount > 0` (the no-extra-bed fast path)", () => {
    // Same fast-path gate as the create path. Walkin
    // derives the count from the request body.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*walkinExtraBedCount\s*>\s*0\s*\)\s*\{[\s\S]{0,200}walkinExtraBedOverlapQuery/m
    );
  });

  it("handleRescheduleBooking passes `excludeBookingId: bookingId` (the critical reschedule exclusion)", () => {
    // The reschedule case is the load-bearing reason
    // `excludeBookingId` exists in the helper: without
    // it, the booking's own snapshotted `extraBedCount`
    // would always count as "in use" and reject the
    // new configuration. Pin the 4th arg so a refactor
    // that drops the exclusion (e.g. "we'll just inline
    // the subtraction in the call site") surfaces here.
    expect(bookingsHandlerSrc).toMatch(
      /countExtraBedsInUse\([\s\S]{0,400}checkInDate,[\s\S]{0,200}checkOutDate,[\s\S]{0,200}bookingId/
    );
  });

  it("handleRescheduleBooking calls `checkExtraBedInventory` and rejects when over capacity", () => {
    // Same shape as the create + walkin rejections.
    // The error message includes the same
    // "already booked across overlapping stays" prefix
    // so the desk sees a consistent message across all
    // 3 surfaces.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*!rescheduleInventoryResult\.ok\s*\)\s*\{[\s\S]{0,400}Not enough extra beds:[\s\S]{0,200}already booked across overlapping stays/m
    );
  });

  it("handleRescheduleBooking's inventory check is INSIDE `runTransaction` and gated on `rescheduleExtraBedCount > 0`", () => {
    // Same RTS-01 race protection as the other 2 paths.
    // The fast-path gate uses `rescheduleExtraBedCount`
    // (the snapshotted value from the existing booking,
    // not the request body — the reschedule body does
    // not let staff change the extra bed count).
    expect(bookingsHandlerSrc).toMatch(
      /const\s+rescheduleExtraBedOverlapSnapshot\s*=\s*await\s+transaction\.get\(rescheduleExtraBedOverlapQuery\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*rescheduleExtraBedCount\s*>\s*0\s*\)\s*\{[\s\S]{0,200}rescheduleExtraBedOverlapQuery/m
    );
  });

  it("all 3 inventory checks read `hotelConfig.extraBedInventory` (the single config source)", () => {
    // The 3 cap checks all source the inventory from
    // the same `hotelConfig.extraBedInventory` field
    // (read once at the top of the transaction). The
    // `?? 0` defensive coercion is in the helper, so
    // the call sites pass the raw `Number(...) || 0`.
    // Pin the 3 `checkExtraBedInventory` invocations so
    // a refactor that reads the inventory from a
    // different doc (e.g. a per-room-type field) is
    // caught.
    const checkCalls = bookingsHandlerSrc.match(/checkExtraBedInventory\(/g) || [];
    expect(checkCalls.length).toBeGreaterThanOrEqual(3);
    expect(bookingsHandlerSrc).toMatch(
      /checkExtraBedInventory\(\s*Math\.max\(0,\s*Number\(hotelConfig\.extraBedInventory\)\s*\|\|\s*0\)/
    );
  });

  it("the AdminContext backfill defaults `extraBedInventory: 0` (legacy / freshly bootstrapped = no constraint)", () => {
    // The Settings → Hotel context backfill writes the
    // default `extraBedInventory: 0` into the in-memory
    // `hotelConfig` snapshot the admin pages read. `0`
    // is the "no constraint" sentinel so the admin
    // surface renders the pre-EXB-10 "any number"
    // behavior by default. Pin the literal so a refactor
    // that drops the field (and the Settings UI loses
    // the row) surfaces here.
    expect(adminContextSrc).toMatch(/extraBedInventory:\s*0/);
  });
});
