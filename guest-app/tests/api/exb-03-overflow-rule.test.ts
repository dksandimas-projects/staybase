import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per EXB-03 (2026-08-01, per decision #145): source-text
// regression tests for the capacity-overflow rule. The
// emulator tests that exercise the real Firestore
// transactions (the PMH-05 generalisation) are out of
// scope for this sandbox (Java not installed); the
// source-text guards below pin the shape that the
// emulator tests will later exercise end-to-end.
//
// Background (per `plan/project/ROADMAP.md §EXB-03`):
//   - Extra beds grant additional occupant slots usable
//     by an adult **or** a child. The validation is
//     **not** simply a higher cap on each — it's the
//     overflow rule:
//       max(0, adults − maxCapacity)
//       + max(0, children − maxChildren)
//       ≤ extraBedCount
//   - The two independent CHD-04 hard rejects
//     (`numAdults > maxCapacity` +
//     `numChildren > maxChildren`) are subsumed by this
//     single check. When `extraBedCount === 0`, the rule
//     reduces to the two hard caps. When
//     `extraBedCount > 0`, the rule allows overflow up
//     to the extra bed count.
//   - The rule applies at all three server capacity
//     checks (online create, walk-in create,
//     move/reschedule) per CHD-04.
//
// Helper lives in `shared/utils/roomTypes.ts` as
// `requiredExtraBedsFor({ numAdults, numChildren,
// maxCapacity, maxChildren })` returning
// `{ overflowAdults, overflowChildren,
// requiredExtraBeds }`. Unit tests for the helper
// itself are in `shared/__tests__/room-types.test.ts`
// (the 6 EXB-03 cases there). This file pins the
// three call sites in the server.

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const roomTypesHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/roomTypes.ts"),
  "utf8"
);

const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);

describe("EXB-03 — capacity overflow rule (helper + three call sites)", () => {
  it("the helper is exported from `shared/utils/roomTypes.ts`", () => {
    // The helper is the single source of truth. Every
    // call site routes through it. Pin the export + the
    // return shape so a refactor that renames or moves
    // it forces a test update.
    expect(roomTypesHelperSrc).toMatch(
      /export function requiredExtraBedsFor[\s\S]*?overflowAdults:\s*number;[\s\S]*?overflowChildren:\s*number;[\s\S]*?requiredExtraBeds:\s*number/
    );
  });

  it("the helper is re-exported from the shared package barrel", () => {
    // The guest-app imports it as `import { requiredExtraBedsFor } from "@spark-inn/shared"`.
    // The barrel re-export keeps that import surface stable
    // as the helper moves within the shared tree.
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/roomTypes"/);
  });

  it("handleCreateBooking calls the helper and rejects when overflow exceeds extraBedCount", () => {
    // The check lives in handleCreateBooking, after the
    // per-type `extraBedCount` cap is read. The error
    // message includes both the adult + child overflow
    // split so the desk / guest can see exactly which
    // axis is over.
    expect(bookingsHandlerSrc).toMatch(
      /const\s+overflow\s*=\s*requiredExtraBedsFor\(\{[\s\S]{0,200}numAdults,[\s\S]{0,200}numChildren,[\s\S]{0,200}maxCapacity,[\s\S]{0,200}maxChildren[\s\S]{0,200}\}\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*overflow\.requiredExtraBeds\s*>\s*extraBedCount\s*\)\s*\{[\s\S]{0,700}Not enough extra beds:[\s\S]{0,200}overflow adult\(s\) \+[\s\S]{0,200}overflow child\(ren\)/m
    );
  });

  it("handleCreateWalkin calls the helper with the walkin-scoped variables", () => {
    // The walk-in path uses the same helper, scoped to
    // `walkinNumAdults` + `walkinNumChildren` +
    // `walkinExtraBedCount` (the walkin transaction
    // already validated `walkinNumAdults +
    // walkinNumChildren === guests` + the per-type
    // `maxExtraBeds` cap, so the overflow check is the
    // last gate before the booking write).
    expect(bookingsHandlerSrc).toMatch(
      /const\s+walkinOverflow\s*=\s*requiredExtraBedsFor\(\{[\s\S]{0,200}walkinNumAdults,[\s\S]{0,200}walkinNumChildren,[\s\S]{0,200}maxCapacity:\s*typeMaxCapacity,[\s\S]{0,200}maxChildren:\s*walkinMaxChildren[\s\S]{0,200}\}\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*walkinOverflow\.requiredExtraBeds\s*>\s*walkinExtraBedCount\s*\)\s*\{[\s\S]{0,300}Not enough extra beds:/m
    );
  });

  it("handleRescheduleBooking validates the existing booking against the NEW room type's caps", () => {
    // Per CHD-04 + EXB-03: the reschedule transaction
    // was missing the adult/child split validation
    // (deferred from the CHD PR per the CHD roadmap
    // entry "the reschedule transaction (line 4683)
    // gets the same split validation in a follow-up").
    // EXB-03 closes both gaps at once. The new check
    // uses the existing snapshotted `extraBedCount`
    // (the reschedule body does not let staff change
    // the extra bed count; the count is part of the
    // booking, not the reschedule).
    expect(bookingsHandlerSrc).toMatch(
      /const\s+rescheduleOverflow\s*=\s*requiredExtraBedsFor\(\{[\s\S]{0,200}numAdults:\s*rescheduleNumAdults,[\s\S]{0,200}numChildren:\s*rescheduleNumChildren,[\s\S]{0,200}maxCapacity:\s*rescheduleMaxCapacity,[\s\S]{0,200}maxChildren:\s*rescheduleMaxChildren[\s\S]{0,200}\}\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*rescheduleOverflow\.requiredExtraBeds\s*>\s*rescheduleExtraBedCount\s*\)\s*\{[\s\S]{0,300}Booking does not fit the target room type:/m
    );
  });

  it("handleCreateBooking's per-type cap on `extraBedCount` is preserved (the overflow is the second gate)", () => {
    // The overflow check is layered ON TOP of the
    // existing per-type cap (`extraBedCount ≤
    // maxExtraBeds`). The cap is the room type's hard
    // limit; the overflow is the occupancy-vs-extra-bed
    // accounting. Both must reject, in that order.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*extraBedCount\s*>\s*maxExtraBeds\s*\)\s*\{[\s\S]{0,200}Extra bed count \(\$\{extraBedCount\}\) exceeds \$\{selectionType\.label \|\| selection\.roomType\}'s allowance/
    );
  });

  it("handleCreateWalkin's per-type cap on `extraBedCount` is preserved", () => {
    // Same layered pattern as handleCreateBooking —
    // the per-type cap fires first, then the overflow
    // check. Walkin derives `walkinTypeMaxExtraBeds`
    // from the room type.
    expect(bookingsHandlerSrc).toMatch(
      /if\s*\(\s*walkinExtraBedCount\s*>\s*walkinTypeMaxExtraBeds\s*\)\s*\{[\s\S]{0,200}Extra bed count \(\$\{walkinExtraBedCount\}\) exceeds the room type's allowance/
    );
  });

  it("the legacy PF-03 combined-cap check in handleRescheduleBooking is gone (subsumed by the overflow helper)", () => {
    // The PF-03 check rejected any booking whose
    // `numGuests > maxCapacity` — but it could not
    // express the overflow case (a booking with extra
    // beds fits a larger occupancy than the type's
    // `maxCapacity`). The overflow helper subsumes it
    // and adds the child-overflow axis. A test that
    // pins the OLD check would regress the overflow
    // feature.
    expect(bookingsHandlerSrc).not.toMatch(
      /Target room type capacity is exceeded\.\s*Maximum allowed guests:/
    );
  });

  it("the CHD-04 hard rejects `numAdults > maxCapacity` + `numChildren > maxChildren` are gone from create", () => {
    // The two original hard rejects were
    // intentionally removed in EXB-03 — the overflow
    // helper subsumes them. Pin the removal so a
    // future refactor that re-adds them as redundant
    // double-checks (instead of routing through the
    // helper) is caught.
    expect(bookingsHandlerSrc).not.toMatch(
      /if\s*\(\s*numAdults\s*>\s*typeMaxCapacity\s*\)\s*\{[\s\S]{0,200}Guest count exceeds room adult capacity of/
    );
    expect(bookingsHandlerSrc).not.toMatch(
      /if\s*\(\s*numChildren\s*>\s*typeMaxChildren\s*\)\s*\{[\s\S]{0,200}Children \(\$\{numChildren\}\) exceeds room child capacity of/
    );
  });

  it("the CHD-04 hard reject `walkinNumChildren > walkinMaxChildren` is gone from walkin", () => {
    // Same subsumption pattern as the create path.
    expect(bookingsHandlerSrc).not.toMatch(
      /if\s*\(\s*walkinNumChildren\s*>\s*walkinMaxChildren\s*\)\s*\{[\s\S]{0,200}Children \(\$\{walkinNumChildren\}\) exceeds room child capacity of/
    );
  });

  it("the helper is imported in the guest-app server handler", () => {
    // The import line in `bookings.ts` is the
    // contract — pin the symbol so a rename in the
    // shared barrel surfaces here. The symbol must
    // appear inside an `import { ... } from
    // "@spark-inn/shared"` block. The block is
    // multi-line (per the PEX-02 + EXB-03 + EXB-10
    // comment padding), so the regex anchors on the
    // symbol + the closing `} from
    // "@spark-inn/shared"`. The 5000-char upper
    // bound accommodates the growing doc-block
    // padding (EXB-10 added 25 lines of JSDoc to
    // the same import block); the contract is
    // "imported from @spark-inn/shared", not a
    // specific distance.
    expect(bookingsHandlerSrc).toMatch(
      /requiredExtraBedsFor[\s\S]{0,5000}\}\s*from\s*"@spark-inn\/shared"/
    );
  });
});
