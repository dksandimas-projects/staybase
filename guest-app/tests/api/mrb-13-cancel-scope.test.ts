import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per MRB-13 (2026-08-02, per decision #166): the
// cancellation scope selector. `POST /api/bookings/cancel`
// gains an optional `scope: "room" | "reservation"` (default
// `"room"` for byte-compatible single-child behavior). When
// `scope === "reservation"` AND the booking has a
// `reservationId`, ONE transaction cancels every cancellable
// child, decrements voucher/corporate `usageCount` exactly
// once per shared code (not per child), runs the per-child
// MRB-05 loyalty clawback, and updates the reservation
// header. The admin BookingsPage cancel modal surfaces a
// `This room` / `All N rooms` selector when the selected
// booking is part of a multi-room reservation; the guest
// `/my-booking` page (per MRB-10) always sends
// `scope: "reservation"` for the cancel submit.
//
// These are source-text guards. The end-to-end behaviour
// is the responsibility of MRB-15 (the remaining-tests
// item).

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const adminBookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

const adminConfirmFormSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/ConfirmForm.tsx"),
  "utf8"
);

describe("MRB-13 — guestCancelSchema accepts the optional scope", () => {
  it("declares `scope: z.enum([\"room\", \"reservation\"]).optional().default(\"room\")`", () => {
    // The schema default `"room"` preserves byte-
    // compatible single-child behavior — every
    // existing caller that omits `scope` lands on
    // the legacy per-child branch. The admin modal
    // surface passes `scope` in the body via
    // `updateBookingStatus`; the guest `/my-booking`
    // page (per MRB-10) sends `"reservation"` when
    // the looked-up booking is part of a multi-room
    // reservation.
    expect(handlerSrc).toMatch(
      /scope:\s*z\.enum\(\[\s*"room"\s*,\s*"reservation"\s*\]\)\.optional\(\)\.default\(\s*"room"\s*\)/
    );
  });

  it("the schema is still safe (the legacy `email OR token` refine is unchanged)", () => {
    // The MRB-13 scope addition must NOT relax the
    // legacy authentication gates. The original
    // `email XOR token` refine is still required so
    // a bare `scope: "reservation"` body without a
    // credential cannot reach Firestore.
    expect(handlerSrc).toMatch(
      /\.refine\(\s*\(data\) => Boolean\(data\.guestEmail\) !== Boolean\(data\.token\)/
    );
  });
});

describe("MRB-13 — handleCancelBooking dispatches on the scope selector", () => {
  it("derives `requestedScope` from the body (staff) or from the schema (guest)", () => {
    // The staff path reads `req.body.scope` directly
    // (no schema gate on the staff body); the guest
    // path uses the schema-validated `parsed.data.scope`.
    // The two branches converge on a single
    // `requestedScope: "room" | "reservation"` local.
    expect(handlerSrc).toMatch(
      /const requestedScope:\s*"room"\s*\|\s*"reservation"\s*=\s*isStaffCancellation\s*\?[\s\S]{0,400}parsed\.data\.scope/
    );
  });

  it("honours `scope === \"reservation\"` only when the looked-up booking has a `reservationId`", () => {
    // A legacy pre-MRB-01 booking (no `reservationId`)
    // carrying `scope === "reservation"` silently falls
    // back to the per-child branch — a "reservation" of
    // size 1 is byte-equivalent to the per-child cancel.
    const deriveBlock = handlerSrc.match(
      /const isReservationScope = requestedScope === "reservation" && lookedUpReservationId\.length > 0/
    );
    expect(deriveBlock, "expected the isReservationScope derivation").toBeTruthy();
  });

  it("selects the post-transaction email action based on the branch", () => {
    // The reservation-scope path fires
    // `booking-cancelled-reservation` (the multi-room
    // template MRB-09 added). The per-child path keeps
    // the legacy `booking-cancelled` action (which
    // MRB-09 already taught to render the full
    // reservation view when the booking has a
    // `reservationId`).
    expect(handlerSrc).toMatch(
      /const postTransactionAction:\s*"booking-cancelled"\s*\|\s*"booking-cancelled-reservation"\s*=\s*isReservationScope\s*\?\s*"booking-cancelled-reservation"\s*:\s*"booking-cancelled"/
    );
  });
});

describe("MRB-13 — reservation-scope cancel reads every child in one transaction", () => {
  it("the reservation-scope branch is wrapped in an `if (isReservationScope)` block", () => {
    // The branch lives inside `handleCancelBooking`
    // and is the ONLY path that touches the
    // `reservations/{id}` header. The per-child
    // path stays byte-equivalent to pre-MRB-13
    // (the `else` arm). The wide `{0,4000}` window
    // covers the multi-paragraph comment block
    // that explains the dedup rule between the
    // `if (isReservationScope) {` and the
    // `await adminDb.runTransaction(...)` call.
    const branchOpen = handlerSrc.match(
      /if \(isReservationScope\) \{[\s\S]{0,4000}adminDb\.runTransaction\([\s\S]{0,500}const reservationRef = adminDb\.collection\("reservations"\)\.doc\(lookedUpReservationId\)/
    );
    expect(branchOpen, "expected the reservation-scope runTransaction").toBeTruthy();
  });

  it("the reservation-scope branch reads every child via `where(\"reservationId\", \"==\", lookedUpReservationId)`", () => {
    // The same child-read shape as the MRB-10 lookup
    // helper. The query lives INSIDE the transaction
    // so the read is consistent with the writes
    // (a concurrent create / reschedule cannot add a
    // child between the read and the cancel writes).
    // The `{0,5000}` window covers the comment
    // explaining the read shape between the
    // `if (isReservationScope) {` and the child
    // query.
    expect(handlerSrc).toMatch(
      /if \(isReservationScope\) \{[\s\S]{0,5000}adminDb\.collection\("bookings"\)\.where\(\s*"reservationId",\s*"==",\s*lookedUpReservationId\s*\)/
    );
  });

  it("filters out terminal + source-mismatched children (the cancellable set)", () => {
    // The spec body: "cancels every cancellable child".
    // The filter applies the same terminal-status +
    // source-specific cancellable set the per-child
    // pre-transaction check enforces. Children in
    // `checked-in` / `cancelled` (any source) or
    // outside `GUEST_CANCELLABLE_STATUSES` (guest
    // path) are skipped.
    const cancellableBlock = handlerSrc.match(
      /const cancellableIds = new Set<string>\(\);[\s\S]{0,800}cancellableIds\.add\(child\.id\);/
    );
    expect(cancellableBlock, "expected the cancellable set computation").toBeTruthy();
    expect(cancellableBlock![0]).toMatch(/GUEST_CANCELLABLE_STATUSES/);
  });
});

describe("MRB-13 — reservation-scope cancel deduplicates voucher / corporate decrements", () => {
  it("builds a per-code count map for voucher codes", () => {
    // A voucher shared by N children must decrement
    // `usageCount` by N, not by 1 (per MRB-08
    // decision #167, the create handler incremented
    // by `assignedRooms.length` — N uses for N
    // rooms). The map's count is the number of
    // cancelled children that use the code, not 1.
    // The regex extends past the `set` call so the
    // matched block contains the full
    // `voucherCounts.set(v, … + 1)` expression.
    const voucherMapBlock = handlerSrc.match(
      /const voucherCounts = new Map<string, number>\(\);[\s\S]{0,800}voucherCounts\.set\(v[\s\S]{0,200}\+ 1\)/
    );
    expect(voucherMapBlock, "expected the voucher dedup map").toBeTruthy();
    expect(voucherMapBlock![0]).toMatch(/voucherCounts\.set\(v, \(voucherCounts\.get\(v\) \|\| 0\) \+ 1\)/);
  });

  it("builds a per-code count map for corporate codes (same dedup rule)", () => {
    // The corporate code's `usageCount` was
    // incremented by `assignedRooms.length` at
    // create (per MRB-08). The reservation-scope
    // cancel decrements by the same count so the
    // cap stays accurate. Same dedup shape as the
    // voucher block. The regex ends at the next
    // blank line + comment so the matched block
    // contains the full `corporateCounts.set(cp, …)`
    // call (the `set` call is the LAST line of
    // the dedup loop, so the block needs to
    // extend past the next line).
    const corpMapBlock = handlerSrc.match(
      /const corporateCounts = new Map<string, number>\(\);[\s\S]{0,800}corporateCounts\.set\(cp[\s\S]{0,200}\+ 1\)/
    );
    expect(corpMapBlock, "expected the corporate dedup map").toBeTruthy();
    expect(corpMapBlock![0]).toMatch(/corporateCounts\.set\(cp, \(corporateCounts\.get\(cp\) \|\| 0\) \+ 1\)/);
  });

  it("the per-code decrement uses the count, not the hardcoded `1`", () => {
    // The pre-MRB-13 per-child branch decrements
    // by `1` (one child → one use). The new
    // reservation-scope branch decrements by the
    // deduped count so a shared code (N children
    // using the same code) decrements by N.
    expect(handlerSrc).toMatch(
      /for \(const \[code, count\] of voucherCounts\.entries\(\)\) \{[\s\S]{0,300}usageCount: Math\.max\(\(Number\(vData\.usageCount\) \|\| 0\) - count, 0\)/
    );
    expect(handlerSrc).toMatch(
      /for \(const \[code, count\] of corporateCounts\.entries\(\)\) \{[\s\S]{0,300}usageCount: Math\.max\(\(Number\(cpData\.usageCount\) \|\| 0\) - count, 0\)/
    );
  });
});

describe("MRB-13 — reservation-scope cancel updates the reservation header", () => {
  it("increments `cancelledRoomCount` by the number of children just cancelled (not by N)", () => {
    // A partial cancel (one room cancelled out of
    // three) only bumps the counter for the rooms
    // we actually flipped. The increment is
    // `cancelledCount` (the size of the cancellable
    // set), NOT `children.length`.
    expect(handlerSrc).toMatch(
      /cancelledRoomCount: newCancelledRoomCount/
    );
    const incr = handlerSrc.match(
      /newCancelledRoomCount = \(Number\(reservationData\.cancelledRoomCount\) \|\| 0\) \+ cancelledCount/
    );
    expect(incr, "expected the cancelledRoomCount increment by cancelledCount").toBeTruthy();
  });

  it("decrements `activeRoomCount` by the same count, floored at 0", () => {
    // The activeRoomCount floor at 0 makes the
    // invariant obvious — a partial cancel cannot
    // drive the count negative. The helper itself
    // floors, the explicit `Math.max` is a
    // defensive belt-and-braces for the
    // reservation-scope path.
    expect(handlerSrc).toMatch(
      /newActiveRoomCount = Math\.max\(\s*\(Number\(reservationData\.activeRoomCount\) \|\| 0\) - cancelledCount,\s*0\s*\)/
    );
  });

  it("sets `paymentStatus` from the post-cancellation state of every child (cancelled ones report `\"cancelled\"`)", () => {
    // The aggregate helper takes a string[] of
    // statuses and returns the derived value. The
    // reservation-scope path maps every cancelled
    // child to `"cancelled"` and every surviving
    // child to its current status, so a full
    // cancel returns `"cancelled"` (same as the
    // per-child N=1 case) and a partial cancel
    // returns the aggregate of the survivors.
    const aggregateBlock = handlerSrc.match(
      /const postStatuses = children\.map\([\s\S]{0,500}computeReservationAggregatePaymentStatus\(postStatuses\)/
    );
    expect(aggregateBlock, "expected the post-cancellation aggregate").toBeTruthy();
    expect(aggregateBlock![0]).toMatch(/cancellableIds\.has\(c\.id\) \? "cancelled" : String\(c\.data\.status \|\| ""\)/);
  });
});

describe("MRB-13 — reservation-scope cancel runs the MRB-05 loyalty clawback per cancelled child", () => {
  it("writes a `clawback-${bookingId}` negative `pointsHistory` entry for each cancelled child with `loyaltyAwardStatus === \"awarded\"`", () => {
    // The per-child clawback mirrors MRB-05 PR #2
    // (decision #159). Each cancelled child with a
    // positive `pointsAwarded` and `awarded`
    // loyalty status records a negative ledger
    // entry — the `rewardsPoints` field is NOT
    // decremented in place (the invariant
    // `rewardsPoints == sum(pointsHistory.points)`
    // is preserved). The `points` field uses
    // `clawbackPoints` (the precomputed
    // `-(pointsAwarded)` local) — the regex
    // matches the precomputation, not the literal
    // `-Number(...)` at the call site. The regex
    // extends past the `type: "clawback"` line to
    // the `pointsAwarded: 0` reset on the booking
    // doc so the matched block contains the
    // `points: clawbackPoints` line.
    const clawbackBlock = handlerSrc.match(
      /if \(\s*child\.data\.loyaltyAwardStatus === "awarded"[\s\S]{0,3000}pointsAwarded: 0,\s*\n\s*loyaltyAwardStatus: "clawback-recorded"/
    );
    expect(clawbackBlock, "expected the per-child loyalty clawback").toBeTruthy();
    expect(clawbackBlock![0]).toMatch(/clawbackPoints = -Number\(child\.data\.pointsAwarded \|\| 0\)/);
    expect(clawbackBlock![0]).toMatch(/points: clawbackPoints/);
    expect(clawbackBlock![0]).toMatch(/clawback-\$\{child\.id\}/);
    expect(clawbackBlock![0]).toMatch(/type: "clawback"/);
  });

  it("zeroes the informational `pointsAwarded` field on each clawback-recorded child", () => {
    // The booking's `pointsAwarded` field is reset
    // to 0 and `loyaltyAwardStatus` flips to
    // `"clawback-recorded"` so Reports + the
    // member profile pick up the reversal. The
    // ledger is the source of truth — the field
    // is informational.
    const reset = handlerSrc.match(
      /transaction\.update\(child\.ref, \{\s*pointsAwarded: 0,\s*loyaltyAwardStatus: "clawback-recorded",\s*pointsAwardedAt: null\s*\}/
    );
    expect(reset, "expected the pointsAwarded reset").toBeTruthy();
  });
});

describe("MRB-13 — reservation-scope cancel fires ONE email, not N", () => {
  it("the post-transaction email uses the reservation-scope action when isReservationScope is true", () => {
    // The reservation-scope path sends the
    // multi-room template added in MRB-09. The
    // per-child path keeps the legacy
    // `booking-cancelled` action (which MRB-09
    // already taught to render the reservation
    // view when the booking has a `reservationId`).
    expect(handlerSrc).toMatch(
      /await sendBookingTrigger\(\s*postTransactionAction,/
    );
  });

  it("the reservation-scope email view is loaded from the booking + reservation + siblings", () => {
    // The same `loadReservationEmailView(bookingId)`
    // helper MRB-10 added. The view carries the
    // per-room `cancelledAt` stamps the template
    // uses to split "rooms affected" from "rooms
    // remaining".
    expect(handlerSrc).toMatch(
      /const reservationView = await loadReservationEmailView\(bookingId\);/
    );
  });
});

describe("MRB-13 — per-child cancel path is preserved for `scope === \"room\"` and legacy callers", () => {
  it("the per-child runTransaction lives in the `else` arm of the dispatch", () => {
    // Every existing caller that omits `scope`
    // (default `"room"`) lands here. The
    // pre-MRB-13 per-child cancel logic (status
    // flip + audit + clawback + per-child
    // voucher / corporate decrement by `1`) is
    // unchanged.
    const elseArm = handlerSrc.match(
      /\} else \{[\s\S]{0,100}await adminDb\.runTransaction\(async \(transaction\) => \{[\s\S]{0,200}const freshBookingDoc = await transaction\.get\(bookingDocumentRef\)/
    );
    expect(elseArm, "expected the per-child runTransaction in the else arm").toBeTruthy();
  });

  it("the per-child branch still decrements the voucher / corporate code by 1 (legacy behavior)", () => {
    // The pre-MRB-13 per-child branch is
    // preserved. The dedup lives only in the
    // reservation-scope branch; the per-child
    // branch keeps the N=1 hardcoded `1` so
    // every byte of the legacy wire output is
    // unchanged.
    expect(handlerSrc).toMatch(
      /if \(voucherDoc\?\.exists && voucherRef\) \{[\s\S]{0,300}usageCount: Math\.max\(\(Number\(voucherData\.usageCount\) \|\| 0\) - 1, 0\)/
    );
    expect(handlerSrc).toMatch(
      /if \(corporateCodeDoc\?\.exists && corporateCodeRef\) \{[\s\S]{0,300}usageCount: Math\.max\(\(Number\(corporateCodeData\.usageCount\) \|\| 0\) - 1, 0\)/
    );
  });
});

describe("MRB-13 — AdminContext.updateBookingStatus accepts + forwards `scope`", () => {
  it("the function signature includes an `options?: { scope?: \"room\" | \"reservation\" }` 4th arg", () => {
    // The cancel branch is the only consumer
    // (other status transitions ignore the field).
    // The interface declaration in the context
    // value type matches the function declaration.
    expect(adminContextSrc).toMatch(
      /updateBookingStatus:\s*\(\s*bookingId:\s*string,\s*status:\s*Booking\["status"\][\s\S]{0,500}options\?:\s*\{\s*scope\?:\s*"room"\s*\|\s*"reservation"\s*\}/
    );
  });

  it("the cancel branch forwards `scope` to the API body", () => {
    // The body sets `scope: cancelScope` so the
    // server's Zod schema picks it up. The
    // `cancelScope` local defaults to `"room"`
    // (byte-compatible with pre-MRB-13 callers).
    const cancelBranch = adminContextSrc.match(
      /if \(status === "cancelled"\) \{[\s\S]{0,2000}scope: cancelScope/
    );
    expect(cancelBranch, "expected the cancel branch to forward scope").toBeTruthy();
  });
});

describe("MRB-13 — ConfirmForm exposes the `additionalFields` slot for the scope selector", () => {
  it("declares an optional `additionalFields?: ReactNode` prop", () => {
    // The slot hosts the `This room` / `All N rooms`
    // segmented control. Other callers (order
    // cancel, discount reject) keep the legacy
    // reason-only shape — they omit the prop.
    expect(adminConfirmFormSrc).toMatch(
      /additionalFields\?:\s*ReactNode/
    );
  });

  it("renders `additionalFields` between the reason textarea and the action row", () => {
    // The slot is rendered after the `<label>` for
    // the reason and before the `<div>` that wraps
    // the back / confirm buttons. The placement
    // keeps the reason input + scope selector
    // visually grouped above the action row.
    const slot = adminConfirmFormSrc.match(
      /\{additionalFields && <div className="mt-3">\{additionalFields\}<\/div>\}/
    );
    expect(slot, "expected the additionalFields render slot").toBeTruthy();
  });
});

describe("MRB-13 — BookingsPage cancel modal renders the scope selector when N>1", () => {
  it("the cancel ConfirmForm passes the scope selector as `additionalFields` when `selectedReservationContext` is set", () => {
    // The selector is rendered only when
    // `selectedReservationContext` is truthy (a
    // reservation with N>1 children). Single-room
    // and legacy bookings fall through to the
    // legacy reason-only modal — byte-equivalent
    // to pre-MRB-13.
    const modalBlock = adminBookingsPageSrc.match(
      /showBookingCancelForm \? \([\s\S]{0,4000}additionalFields=\{[\s\S]{0,200}selectedReservationContext \?/
    );
    expect(modalBlock, "expected the conditional additionalFields render").toBeTruthy();
  });

  it("the selector exposes `This room` and `All N rooms` buttons that flip the local scope state", () => {
    // The two buttons call `setBookingCancelScope`
    // with the respective value. The data-testids
    // are the source-text anchor for the test
    // suite's selectors.
    expect(adminBookingsPageSrc).toMatch(
      /data-testid="booking-cancel-scope-room"[\s\S]{0,500}onClick=\{\(\) => setBookingCancelScope\("room"\)\}/
    );
    expect(adminBookingsPageSrc).toMatch(
      /data-testid="booking-cancel-scope-reservation"[\s\S]{0,500}onClick=\{\(\) => setBookingCancelScope\("reservation"\)\}/
    );
  });

  it("the cancel `onConfirm` passes `(reason, scope)` to `handleCancelBooking`", () => {
    // The second arg carries the local
    // `bookingCancelScope` state so the staff's
    // choice flows into `updateBookingStatus`'s
    // 4th arg, which then forwards it to the API
    // body.
    expect(adminBookingsPageSrc).toMatch(
      /onConfirm=\{\(reason\) => void handleCancelBooking\(reason, bookingCancelScope\)\}/
    );
  });

  it("the cancel modal title + confirm label switch with the selected scope", () => {
    // When `bookingCancelScope === "reservation"`,
    // the modal reads "Cancel all N rooms?" + the
    // confirm label "Cancel all N rooms" so the
    // staff sees the action's blast radius. The
    // default `"room"` path keeps the legacy
    // "Cancel this booking?" / "Cancel booking"
    // copy.
    const titleSwitch = adminBookingsPageSrc.match(
      /title=\{[\s\S]{0,200}bookingCancelScope === "reservation"[\s\S]{0,300}Cancel all \$\{selectedReservationContext\.roomCount\} rooms\?/
    );
    expect(titleSwitch, "expected the title switch").toBeTruthy();
    const confirmLabelSwitch = adminBookingsPageSrc.match(
      /confirmLabel=\{[\s\S]{0,200}bookingCancelScope === "reservation"[\s\S]{0,300}Cancel all \$\{selectedReservationContext\.roomCount\} rooms/
    );
    expect(confirmLabelSwitch, "expected the confirm label switch").toBeTruthy();
  });

  it("the cancel form resets `bookingCancelScope` to `\"room\"` on close", () => {
    // A previous session's choice must not bleed
    // into a new session. The default `"room"` is
    // the safer choice — staff must opt into the
    // whole-reservation path every time. The
    // `{0,500}` window covers the multi-line
    // comment between the close + reset calls.
    expect(adminBookingsPageSrc).toMatch(
      /onCancel=\{\(\) => \{[\s\S]{0,500}setShowBookingCancelForm\(false\);[\s\S]{0,500}setBookingCancelScope\("room"\);/
    );
  });
});
