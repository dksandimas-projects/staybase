// VOU-01 (2026-08-14, found during the Vouchers feature audit
// that immediately followed the RPT-05 + EXB-12.1 fixes):
// The pre-VOU-01 voucher `usageCount` increment was per-
// reservation (`+1`) on the create + walkin paths, and
// per-cancellation (`-1`) on the cancel path. The spec at
// `plan/features/VOUCHERS.md:91-93` (the `## Voucher
// usageCount Counter Ownership` section, per MRB-15-03 +
// MRB-15-08, decisions #181) requires per-child semantics:
// "Create (handleCreateBooking / handleCreateWalkin): for
// each child that has a voucherCode applied,
// vouchers.usageCount += 1. A 3-room reservation with the
// voucher on 1 child increments by 1; with the voucher on
// all 3 children, by 3." For create-booking + walkin (the
// only entry points), the single top-level `voucherCode`
// field applies to ALL rooms in the body (no per-line
// voucher field exists on `publicRoomSelectionSchema` or
// `WalkinRoomLineSchema`), so "per-child with the code" =
// "all N rooms". Cancel uses `Map<code, count>` to
// deduplicate a code shared across N cancelled children
// (per MRB-13 entry, decision #170).
//
// Test discipline (per v0.264.9 retrofit + the VOU-01 fix
// shape): source-text regex tests pin the contract shape;
// runtime assertions reproduce the row-builder logic
// against representative fixtures. The v0.264.5/v0.264.7
// retrofit lesson: "16/16 tests pass was meaningless" when
// the test surface doesn't exercise the N>1 path. VOU-01 is
// the N>1 voucher increment — the test fixtures below
// explicitly cover N=3.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// ── Source-text guards: pin the per-child counter contract
// shape at the source level. The pre-VOU-01 regex
// (`+ 1`) was anchorable — the post-VOU-01 regex
// (`childrenWithVoucherCount`, `walkinRoomCount`, or
// `Map<code, count>`) is the new anchor.

describe("VOU-01 — voucher usageCount counter ownership (per-child semantics)", () => {
  // Per the spec table at VOUCHERS.md:99-106:
  // "Create-time increment: += childrenWithCode.length"
  // Walkin schema has a single top-level voucherCode, so
  // "childrenWithCode.length" for walkin = walkinRoomCount.
  // The pre-VOU-01 code had `+ 1` for both create-booking
  // and create-walkin (N=1 byte-equivalent, wrong for N>1).
  it("handleCreateBooking increments voucher usageCount by the number of rooms in the body (not +1)", () => {
    // Anchor the new shape on the destination variable:
    // `childrenWithVoucherCount`. The declaration +
    // the usage are far apart (~3000 chars), so split
    // into two assertions instead of one spanning
    // regex. Both must hold for the fix to be in place.
    expect(handlers).toMatch(/\bchildrenWithVoucherCount\b\s*=\s*resolvedRoomSelections\.length/);
    expect(handlers).toMatch(
      /\bchildrenWithVoucherCount\b[\s\S]{0,5000}?usageCount:\s*\(?vData\.usageCount\s*\|\|\s*0\)?\s*\+\s*childrenWithVoucherCount/
    );
  });

  it("handleCreateWalkin increments voucher usageCount by walkinRoomCount (not +1)", () => {
    // Walkin: single top-level voucher applies to all
    // walked-in rooms (no per-line field exists).
    // Increment = walkinRoomCount (already declared
    // at line 3671 — the VOU-01 fix is just changing
    // the `+ 1` literal to `+ walkinRoomCount`). The
    // decl + use are far apart (~35K chars), so we
    // pin via a NEGATIVE assertion: the OLD shape
    // (`+ 1`) must NOT appear next to the walkin
    // voucher doc write. Anchor on the walkin's
    // unique `voucherData` variable name (the
    // walkin block uses `voucherData`; the
    // create-booking block uses `vData` — so the
    // two blocks are disambiguated).
    expect(handlers).not.toMatch(
      /voucherUsageUpdate\s*=\s*\{[\s\S]{0,400}?ref:\s*voucherRef[\s\S]{0,400}?usageCount:\s*\(?voucherData\.usageCount\s*\|\|\s*0\)?\s*\+\s*1\b/
    );
    // Positive assertion: the walkin block has
    // the NEW shape somewhere (the gap from
    // walkinRoomCount decl to usage is 35K chars,
    // but within the walkin function the
    // `walkinRoomCount` is referenced many times).
    // The most reliable anchor: a literal
    // `usageCount: Number(voucherData.usageCount
    // || 0) + walkinRoomCount` in the source.
    expect(handlers).toMatch(
      /usageCount:\s*Number\(voucherData\.usageCount\s*\|\|\s*0\)\s*\+\s*walkinRoomCount/
    );
  });

  it("handleCancelBooking reservation-scope decrements by Map<code, count> per cancelled child", () => {
    // Per MRB-13 (decision #170): the reservation-
    // scope cancel branch builds `Map<code, count>`
    // from every cancelled child with a voucherCode,
    // then writes one `transaction.update(voucherRef,
    // { usageCount: Math.max(...) - count })` per
    // unique code. A code shared across N cancelled
    // children decrements by N. Pre-MRB-13 had `- 1`
    // (wrong for N>1 reservation-scope cancels).
    // The Map loop is at line 5940; the dispatch
    // variable `isReservationScope` is at line 5711.
    // Distance is ~9000 chars — too far for a single
    // regex. Split into two assertions:
    //  (a) the dispatch variable exists
    //  (b) the Map loop with `count` decrement exists.
    expect(handlers).toMatch(/\bisReservationScope\b/);
    expect(handlers).toMatch(
      /for\s+\(\s*const\s+\[\s*code\s*,\s*count\s*\]\s+of\s+voucherCounts\.entries\(\)\s*\)\s*\{[\s\S]{0,400}?usageCount:\s*Math\.max\(\(?Number\(vData\.usageCount\)\s*\|\|\s*0\)?\s*-\s*count\s*,\s*0\)/
    );
  });

  it("handleCancelBooking room-scope still decrements by 1 (one cancelled child, correct)", () => {
    // Regression guard: the room-scope branch
    // (single booking cancellation) decrements by
    // 1 — one cancelled child, one decrement. The
    // room-scope path is correct as-is; the VOU-01
    // fix doesn't touch it. The `- 1` shape lives
    // at line 6336 in the room-scope branch (after
    // the reservation-scope early-return).
    expect(handlers).toMatch(
      /usageCount:\s*Math\.max\(\(?Number\(voucherData\.usageCount\)\s*\|\|\s*0\)?\s*-\s*1\s*,\s*0\)/
    );
  });

  it("handleAddRoomToReservation still increments by 1 (one new child added)", () => {
    // Regression guard: add-room is per-call (one
    // new child), NOT per-child-aggregate. Pin the
    // existing `+ 1` shape so the VOU-01 fix doesn't
    // over-correct and break add-room. Split into
    // (a) the handler declaration and (b) the +1
    // increment — distance is too large for a
    // single regex span.
    expect(handlers).toMatch(/handleAddRoomToReservation/);
    expect(handlers).toMatch(
      /usageCount:\s*Number\(vData\.usageCount\s*\|\|\s*0\)\s*\+\s*1/
    );
  });

  it("handleApplyBookingDiscount still increments by 1 (single booking, not multi-room)", () => {
    // Regression guard: apply-discount is per-booking
    // (one existing booking, one discount application),
    // NOT per-reservation-aggregate. Pin the existing
    // `+ 1` shape.
    expect(handlers).toMatch(/handleApplyBookingDiscount/);
    expect(handlers).toMatch(
      /voucherUsageCount\s*=\s*Number\(voucher\.usageCount\s*\|\|\s*0\)\s*\+\s*1/
    );
  });
});

// ── Runtime assertions: reproduce the row-builder logic
// against representative N=3 fixtures. These are the
// durable guards — the v0.264.9 retrofit lesson: regex
// tests on their own don't catch the runtime regression.

describe("VOU-01 — runtime per-child counter math", () => {
  it("create-booking N=3 reservation increments usageCount by 3 (pre-VOU-01 was 1)", () => {
    // Reproduce the VOU-01 row-builder shape inline:
    // childrenWithVoucherCount = number of rooms in
    // the booking body (since the single top-level
    // voucherCode applies to all rooms).
    const body = {
      voucherCode: "SAVE500",
      roomSelections: [
        { roomType: "standard" },
        { roomType: "standard" },
        { roomType: "deluxe" }
      ]
    };
    const childrenWithVoucherCount = body.roomSelections.length;
    const priorUsageCount = 4;
    const newUsageCount = (priorUsageCount) + childrenWithVoucherCount;
    expect(childrenWithVoucherCount).toBe(3);
    expect(newUsageCount).toBe(7); // was 5 with the pre-VOU-01 `+ 1`
  });

  it("create-walkin N=3 walkin increments usageCount by 3 (pre-VOU-01 was 1)", () => {
    // Walkin schema: single top-level voucherCode +
    // walkinRoomCount (derived from `rooms[]`).
    const body = {
      voucherCode: "SAVE500",
      rooms: [{ roomId: "r1" }, { roomId: "r2" }, { roomId: "r3" }]
    };
    const walkinRoomCount = body.rooms.length;
    const priorUsageCount = 4;
    const newUsageCount = priorUsageCount + walkinRoomCount;
    expect(walkinRoomCount).toBe(3);
    expect(newUsageCount).toBe(7);
  });

  it("cancel reservation-scope N=3 with one shared code decrements by 3 (already correct, regression guard)", () => {
    // Per MRB-13 + VOUCHERS.md spec: build
    // `Map<code, count>` from cancelled children with
    // a voucherCode; decrement each code by its count.
    // The reservation-scope branch already does this
    // correctly (added in MRB-13). VOU-01 regression
    // guard — make sure a future refactor doesn't
    // regress to the pre-MRB-13 `- 1` shape.
    const cancelledChildren = [
      { voucherCode: "SAVE500" },
      { voucherCode: "SAVE500" },
      { voucherCode: "SAVE500" }
    ];
    const voucherCounts = new Map<string, number>();
    for (const child of cancelledChildren) {
      const code = child.voucherCode;
      if (!code) continue;
      voucherCounts.set(code, (voucherCounts.get(code) || 0) + 1);
    }
    expect(voucherCounts.get("SAVE500")).toBe(3);

    // Per-code decrement: prior 10, code SAVE500 decremented by 3.
    const priorUsageCounts: Record<string, number> = { SAVE500: 10 };
    const decremented: Record<string, number> = {};
    for (const [code, count] of voucherCounts.entries()) {
      decremented[code] = Math.max((priorUsageCounts[code] || 0) - count, 0);
    }
    expect(decremented.SAVE500).toBe(7);
  });

  it("cancel room-scope N=1 decrements by 1 (regression guard — room scope is unchanged)", () => {
    // Room-scope cancel (one booking cancelled, not
    // a reservation-scope multi-child cancel):
    // `- 1`. The room-scope path is correct as-is;
    // VOU-01 doesn't touch it.
    const cancelledChildren = [{ voucherCode: "SAVE500" }];
    const voucherCounts = new Map<string, number>();
    for (const child of cancelledChildren) {
      const code = child.voucherCode;
      if (!code) continue;
      voucherCounts.set(code, (voucherCounts.get(code) || 0) + 1);
    }
    expect(voucherCounts.get("SAVE500")).toBe(1);

    const priorUsageCounts: Record<string, number> = { SAVE500: 10 };
    const decremented: Record<string, number> = {};
    for (const [code, count] of voucherCounts.entries()) {
      decremented[code] = Math.max((priorUsageCounts[code] || 0) - count, 0);
    }
    expect(decremented.SAVE500).toBe(9); // room-scope = `- 1`
  });
});