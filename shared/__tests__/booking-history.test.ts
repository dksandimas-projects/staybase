// ATR-08 follow-up (2026-11-21): the booking drawer's HISTORY tab.
//
// WHY THIS TEST EXISTS
// --------------------
// The History tab merges FIVE differently-shaped sources into one
// reverse-chronological timeline:
//
//   1. `breakfastAudit` rows   (server-written, BR-01)
//   2. `otherAddOnAudit` rows  (server-written, BR-12)
//   3. `charges` rows          (client-written, rules-pinned actor)
//   4. the booking's own milestone stamps (created / check-in / …)
//   5. the booking's own `rescheduleHistory[]` (the ROOM CHANGE trail)
//
// The admin app has NO component-test harness (no
// @testing-library/react), so the admin-side test can only assert on
// source text. That would leave the MERGING RULES — which action maps
// to which sentence, which timestamp field is authoritative, what
// happens to an undated row, and who an actor renders as — untested.
//
// So the rules live in `shared/utils/bookingHistory.ts` and are tested
// HERE, for real. This file is the contract that a second copy of the
// mapping (the exact failure ATR-05 finding 9 documented) would break.

import { describe, expect, it } from "vitest";
import {
  breakfastAuditEvent,
  bookingHistoryActorLabel,
  bookingMilestoneEvents,
  incidentalChargeEvent,
  mergeBookingHistoryEvents,
  otherAddOnAuditEvent,
  rescheduleHistoryEvent,
  rescheduleHistoryEvents,
  toIsoTimestamp,
  type BookingHistoryEvent
} from "@spark-inn/shared";

// A Firestore `Timestamp` stand-in: the SDK's object exposes
// `toDate()` and nothing else the SDK cares about.
const timestamp = (iso: string) => ({
  toDate: () => new Date(iso)
});

describe("bookingHistory — toIsoTimestamp", () => {
  it("normalizes a Firestore Timestamp", () => {
    expect(toIsoTimestamp(timestamp("2026-11-20T10:00:00.000Z"))).toBe(
      "2026-11-20T10:00:00.000Z"
    );
  });

  it("normalizes a Date and an ISO string to the same value", () => {
    expect(toIsoTimestamp(new Date("2026-11-20T10:00:00.000Z"))).toBe(
      "2026-11-20T10:00:00.000Z"
    );
    expect(toIsoTimestamp("2026-11-20T10:00:00.000Z")).toBe(
      "2026-11-20T10:00:00.000Z"
    );
  });

  it("returns null for an unusable value rather than inventing a time", () => {
    expect(toIsoTimestamp(null)).toBeNull();
    expect(toIsoTimestamp(undefined)).toBeNull();
    expect(toIsoTimestamp("")).toBeNull();
    expect(toIsoTimestamp("not a date")).toBeNull();
    expect(toIsoTimestamp({})).toBeNull();
  });
});

describe("bookingHistory — breakfastAuditEvent", () => {
  const base = {
    action: "add",
    slotKey: "2026-11-20-guest-1",
    mealSnapshot: { mealId: "m1", mealName: "American Breakfast", price: 350 },
    actorUid: "uid-juan",
    actorRole: "front-desk",
    reason: null,
    occurredAt: timestamp("2026-11-20T02:14:00.000Z"),
    occurredAfterCutoff: false
  };

  it("maps each action to a readable summary", () => {
    expect(breakfastAuditEvent({ ...base, action: "add" })?.summary).toBe(
      "Added breakfast"
    );
    expect(breakfastAuditEvent({ ...base, action: "change" })?.summary).toBe(
      "Changed breakfast"
    );
    expect(breakfastAuditEvent({ ...base, action: "remove" })?.summary).toBe(
      "Removed breakfast"
    );
    expect(breakfastAuditEvent({ ...base, action: "serve" })?.summary).toBe(
      "Marked breakfast served"
    );
    expect(breakfastAuditEvent({ ...base, action: "unserve" })?.summary).toBe(
      "Marked breakfast not served"
    );
  });

  it("reads the slot key into the service date and the guest index", () => {
    const event = breakfastAuditEvent(base);
    expect(event?.serviceDate).toBe("2026-11-20");
    expect(event?.guestIndex).toBe(1);
    expect(event?.subject).toBe("American Breakfast");
  });

  it("marks an override as a late change", () => {
    const event = breakfastAuditEvent({ ...base, action: "override-add" });
    expect(event?.summary).toBe("Added breakfast (late change)");
    expect(event?.lateChange).toBe(true);
  });

  it("keeps the guest's own actor role — the trail answers 'guest or desk?'", () => {
    const event = breakfastAuditEvent({
      ...base,
      actorUid: "guest",
      actorRole: "guest"
    });
    expect(event?.actorRole).toBe("guest");
    expect(event?.actorUid).toBe("guest");
  });

  it("ignores an unknown action instead of inventing a summary", () => {
    expect(breakfastAuditEvent({ ...base, action: "exploded" })).toBeNull();
    expect(breakfastAuditEvent(null)).toBeNull();
    expect(breakfastAuditEvent("nope")).toBeNull();
  });
});

describe("bookingHistory — otherAddOnAuditEvent", () => {
  const base = {
    action: "add",
    selectionKey: "2026-11-20-airport-transfer-v1",
    addOnSnapshot: { addOnId: "airport-transfer-v1", name: "Airport Transfer", price: 800, quantity: 2 },
    actorUid: "uid-maria",
    actorRole: "admin",
    reason: "Guest asked for the later pickup",
    occurredAt: timestamp("2026-11-20T03:00:00.000Z"),
    occurredAfterCutoff: false
  };

  it("maps each action to a readable summary", () => {
    expect(otherAddOnAuditEvent({ ...base, action: "add" })?.summary).toBe(
      "Added add-on"
    );
    expect(otherAddOnAuditEvent({ ...base, action: "mark-served" })?.summary).toBe(
      "Marked add-on served"
    );
  });

  it("reads the date out of the selection key without breaking on a dashed add-on id", () => {
    const event = otherAddOnAuditEvent(base);
    expect(event?.serviceDate).toBe("2026-11-20");
    expect(event?.subject).toBe("Airport Transfer");
    expect(event?.quantity).toBe(2);
  });

  it("keeps the writer's reason", () => {
    expect(otherAddOnAuditEvent(base)?.reason).toBe("Guest asked for the later pickup");
  });
});

describe("bookingHistory — incidentalChargeEvent", () => {
  it("describes a charge and carries its amount", () => {
    const event = incidentalChargeEvent({
      id: "c1",
      label: "Late checkout",
      amount: 500,
      category: "late-checkout",
      note: "Guest left at 3pm",
      addedBy: "uid-juan",
      addedAt: "2026-11-20T04:00:00.000Z"
    });
    expect(event?.summary).toBe("Added an incidental charge");
    expect(event?.subject).toBe("Late checkout");
    expect(event?.amount).toBe(500);
    expect(event?.actorUid).toBe("uid-juan");
  });

  it("describes a void row as a reversal", () => {
    const event = incidentalChargeEvent({
      id: "c2",
      label: "Late checkout",
      amount: -500,
      voidOf: "c1",
      addedBy: "uid-juan",
      addedAt: "2026-11-20T05:00:00.000Z"
    });
    expect(event?.summary).toBe("Reversed a charge");
  });
});

describe("bookingHistory — bookingMilestoneEvents", () => {
  it("drops a milestone with no timestamp rather than dating it wrongly", () => {
    const events = bookingMilestoneEvents({
      createdBy: "uid-juan",
      createdByName: "Juan Dela Cruz"
    });
    expect(events).toHaveLength(0);
  });

  it("reads the dated milestones", () => {
    const events = bookingMilestoneEvents({
      createdAt: "2026-11-20T01:00:00.000Z",
      createdBy: "uid-juan",
      createdByName: "Juan Dela Cruz",
      checkedInAt: "2026-11-21T02:00:00.000Z",
      checkedInBy: "uid-maria",
      checkedOutAt: "2026-11-22T03:00:00.000Z",
      checkedOutBy: "uid-juan"
    });
    expect(events.map((event) => event.kind)).toEqual([
      "checked-out",
      "checked-in",
      "created"
    ]);
  });

  it("marks a guest-created booking as the guest", () => {
    const events = bookingMilestoneEvents({
      createdAt: "2026-11-20T01:00:00.000Z",
      createdBy: "guest"
    });
    expect(events[0]?.actorRole).toBe("guest");
  });
});

// Per ATR-09 (2026-11-21): the desk's Activity history showed a bare
// "Staff" on every row whose actor could not be resolved. The two
// milestones that were affected:
//
//   1. "Payment verified" — the milestone carried NO actor at all, so
//      it ALWAYS rendered the generic fallback. It now resolves the
//      verifier from `paymentConfirmedBy` (the stamp the server writes
//      in the same write as `paymentConfirmedAt`).
//   2. "Booking created" — a LEGACY desk booking (written before
//      ATR-04) has no `createdBy` stamp, so its creator was
//      unrecoverable. It now falls back to `handledBy`.
describe("bookingHistory — ATR-09 the milestone actors resolve to a NAME", () => {
  const staffNameMap = new Map([
    ["uid-juan", "Juan Dela Cruz"],
    ["uid-maria", "Maria Santos"]
  ]);

  const milestone = (events: BookingHistoryEvent[], kind: string) =>
    events.find((event) => event.kind === kind);

  it("attributes the payment verification to the verifier", () => {
    const events = bookingMilestoneEvents({
      paymentConfirmedAt: "2026-11-19T08:14:00.000Z",
      paymentConfirmedBy: "uid-maria",
      paymentConfirmedByName: "Maria Santos",
      handledBy: "uid-juan"
    });
    const event = milestone(events, "payment-confirmed");
    expect(event?.actorUid).toBe("uid-maria");
    expect(event?.actorName).toBe("Maria Santos");
    expect(bookingHistoryActorLabel(event!, staffNameMap)).toBe("Maria Santos");
  });

  it("prefers the verifier over `handledBy` (which is overwritten by later actions)", () => {
    // `handledBy` names the LAST staff member who touched the booking.
    // It must not win over the dedicated verifier stamp.
    const events = bookingMilestoneEvents({
      paymentConfirmedAt: "2026-11-19T08:14:00.000Z",
      paymentConfirmedBy: "uid-maria",
      handledBy: "uid-juan"
    });
    expect(milestone(events, "payment-confirmed")?.actorUid).toBe("uid-maria");
  });

  it("falls back to `handledBy` for a payment verified before ATR-09", () => {
    const events = bookingMilestoneEvents({
      paymentConfirmedAt: "2026-11-19T08:14:00.000Z",
      handledBy: "uid-juan"
    });
    const event = milestone(events, "payment-confirmed");
    expect(event?.actorUid).toBe("uid-juan");
    expect(bookingHistoryActorLabel(event!, staffNameMap)).toBe("Juan Dela Cruz");
  });

  it("attributes a desk-created booking to its creator", () => {
    const events = bookingMilestoneEvents({
      createdAt: "2026-11-19T08:14:00.000Z",
      createdBy: "uid-juan",
      createdByName: "Juan Dela Cruz"
    });
    const event = milestone(events, "created");
    expect(event?.actorUid).toBe("uid-juan");
    expect(bookingHistoryActorLabel(event!, staffNameMap)).toBe("Juan Dela Cruz");
  });

  it("falls back to `handledBy` for a legacy desk booking with no `createdBy` stamp", () => {
    // A booking written before ATR-04 carries no `createdBy` at all.
    const events = bookingMilestoneEvents({
      createdAt: "2026-11-19T08:14:00.000Z",
      handledBy: "uid-juan"
    });
    const event = milestone(events, "created");
    expect(event?.actorUid).toBe("uid-juan");
    expect(bookingHistoryActorLabel(event!, staffNameMap)).toBe("Juan Dela Cruz");
  });

  it("never treats a reserved literal as a staff uid", () => {
    // "guest" / "system" / "staff" are NOT uids — passing one to the
    // resolver would look up a staff member that does not exist.
    const events = bookingMilestoneEvents({
      createdAt: "2026-11-19T08:14:00.000Z",
      createdBy: "staff",
      paymentConfirmedAt: "2026-11-19T08:14:00.000Z",
      paymentConfirmedBy: "system",
      handledBy: ""
    });
    expect(milestone(events, "created")?.actorUid).toBeNull();
    expect(milestone(events, "payment-confirmed")?.actorUid).toBeNull();
  });

  it("keeps a guest-created booking on the guest role and off the staff map", () => {
    const events = bookingMilestoneEvents({
      createdAt: "2026-11-19T08:14:00.000Z",
      createdBy: "guest",
      createdByName: "Guest",
      handledBy: "uid-juan"
    });
    const event = milestone(events, "created");
    expect(event?.actorRole).toBe("guest");
    expect(event?.actorUid).toBeNull();
    expect(bookingHistoryActorLabel(event!, staffNameMap)).toBe("Guest");
  });
});

describe("bookingHistory — mergeBookingHistoryEvents", () => {
  const at = (iso: string): BookingHistoryEvent => ({
    id: iso,
    kind: "charge",
    at: iso,
    actorUid: null,
    actorRole: null,
    actorName: null,
    summary: "event",
    subject: null,
    serviceDate: null,
    guestIndex: null,
    reason: null,
    note: null,
    amount: null,
    quantity: null,
    lateChange: false
  });

  it("merges groups newest-first", () => {
    const merged = mergeBookingHistoryEvents(
      [at("2026-11-20T01:00:00.000Z")],
      [at("2026-11-22T01:00:00.000Z"), at("2026-11-21T01:00:00.000Z")]
    );
    expect(merged.map((event) => event.at)).toEqual([
      "2026-11-22T01:00:00.000Z",
      "2026-11-21T01:00:00.000Z",
      "2026-11-20T01:00:00.000Z"
    ]);
  });

  it("sorts an undated event LAST — never at the top as 'most recent'", () => {
    const merged = mergeBookingHistoryEvents([
      { ...at("undated"), at: null },
      at("2026-11-20T01:00:00.000Z")
    ]);
    expect(merged[0]?.at).toBe("2026-11-20T01:00:00.000Z");
    expect(merged[1]?.at).toBeNull();
  });
});

describe("bookingHistory — bookingHistoryActorLabel", () => {
  const staffNameMap = new Map([["uid-juan", "Juan Dela Cruz"]]);

  const event = (overrides: Partial<BookingHistoryEvent>): BookingHistoryEvent => ({
    id: "e1",
    kind: "charge",
    at: "2026-11-20T01:00:00.000Z",
    actorUid: null,
    actorRole: null,
    actorName: null,
    summary: "event",
    subject: null,
    serviceDate: null,
    guestIndex: null,
    reason: null,
    note: null,
    amount: null,
    quantity: null,
    lateChange: false,
    ...overrides
  });

  it("renders a guest and a system actor by role", () => {
    expect(
      bookingHistoryActorLabel(event({ actorRole: "guest", actorUid: "guest" }), staffNameMap)
    ).toBe("Guest");
    expect(
      bookingHistoryActorLabel(event({ actorRole: "system", actorUid: "system" }), staffNameMap)
    ).toBe("System");
  });

  it("prefers the write-time name snapshot", () => {
    expect(
      bookingHistoryActorLabel(
        event({ actorName: "Maria (left)", actorUid: "uid-maria" }),
        staffNameMap
      )
    ).toBe("Maria (left)");
  });

  it("resolves the uid through the ONE shared resolver", () => {
    expect(
      bookingHistoryActorLabel(event({ actorUid: "uid-juan" }), staffNameMap)
    ).toBe("Juan Dela Cruz");
  });

  it("never leaks a raw uid for an unknown actor", () => {
    const label = bookingHistoryActorLabel(
      event({ actorUid: "uid-deleted-account" }),
      staffNameMap
    );
    expect(label).toBe("Staff");
    expect(label).not.toContain("uid-deleted-account");
  });
});

// Per ATR-10 (2026-11-21): the ROOM CHANGE trail.
//
// The desk reported "I did a room change for the booking, it was not
// tracked in the history in the booking drawer". The server ALWAYS
// appended the change to `booking.rescheduleHistory[]` — inside the
// same transaction that moved the room — so the write was never the
// bug. The drawer's History tab simply merged four sources and never
// read the fifth, and the admin mapper never hydrated the field.
//
// These tests pin the mapping that makes the change visible.
describe("bookingHistory — rescheduleHistoryEvents (the room-change trail)", () => {
  // The exact shape `handleAssignBookingRoom` writes (RAR-01).
  const ROOM_OVERRIDE = {
    kind: "room",
    fromRoomId: "room-a",
    fromRoomNumber: "201",
    fromCheckIn: "2026-11-20",
    fromCheckOut: "2026-11-22",
    toRoomId: "room-b",
    toRoomNumber: "202",
    toCheckIn: "2026-11-20",
    toCheckOut: "2026-11-22",
    reason: "Guest requested a quieter room",
    by: "uid-juan",
    at: "2026-11-21T04:30:00.000Z",
    pricingBasis: "preserved",
    deltaTotalPrice: 0
  };

  it("maps a room override to a `room-change` event", () => {
    const event = rescheduleHistoryEvent(ROOM_OVERRIDE, "0");
    expect(event?.kind).toBe("room-change");
    expect(event?.summary).toBe("Changed room");
    expect(event?.subject).toBe("Room 201 → Room 202");
    expect(event?.at).toBe("2026-11-21T04:30:00.000Z");
    expect(event?.reason).toBe("Guest requested a quieter room");
    expect(event?.actorUid).toBe("uid-juan");
  });

  it("shows NO money badge for a room override (its delta is always 0)", () => {
    // A room override preserves the money by construction
    // (`pricingBasis: "preserved"`, `deltaTotalPrice: 0`). Rendering
    // "₱0" would read as a money movement that did not happen.
    expect(rescheduleHistoryEvent(ROOM_OVERRIDE, "0")?.amount).toBeNull();
  });

  it("maps a move to a `room-change` event WITH its date change and price delta", () => {
    const event = rescheduleHistoryEvent(
      {
        kind: "move",
        fromRoomNumber: "201",
        toRoomNumber: "302",
        fromCheckIn: "2026-11-20T00:00:00.000Z",
        fromCheckOut: "2026-11-22T00:00:00.000Z",
        toCheckIn: "2026-11-21",
        toCheckOut: "2026-11-24",
        by: "uid-maria",
        at: "2026-11-21T05:00:00.000Z",
        pricingBasis: "recalculated",
        deltaTotalPrice: 2400
      },
      "0"
    );
    expect(event?.summary).toBe("Moved to another room");
    expect(event?.subject).toBe("Room 201 → Room 302");
    // A move RE-DATES the stay — that is half of what happened.
    expect(event?.note).toContain("Check-in 2026-11-20 → 2026-11-21");
    expect(event?.note).toContain("Check-out 2026-11-22 → 2026-11-24");
    expect(event?.amount).toBe(2400);
  });

  it("maps an extend to a `room-change` event showing the check-out move", () => {
    const event = rescheduleHistoryEvent(
      {
        kind: "extend",
        fromRoomNumber: "201",
        toRoomNumber: "201",
        fromCheckOut: "2026-11-22T00:00:00.000Z",
        toCheckOut: "2026-11-24",
        by: "guest",
        at: "2026-11-21T06:00:00.000Z",
        deltaTotalPrice: 1800
      },
      "0"
    );
    expect(event?.summary).toBe("Extended stay");
    expect(event?.subject).toBe("Check-out 2026-11-22 → 2026-11-24");
    expect(event?.amount).toBe(1800);
  });

  it("never turns an EMAIL actor into a uid (an address is PII, not an identity)", () => {
    // The server writes `req.staff?.uid || req.staff?.email`. The
    // email branch is NOT a uid and must never reach the screen.
    const event = rescheduleHistoryEvent({ ...ROOM_OVERRIDE, by: "juan@sparkinn.com" }, "0");
    expect(event?.actorUid).toBeNull();
    expect(bookingHistoryActorLabel(event!, new Map())).toBe("Staff");
  });

  it("treats the reserved literals as no actor", () => {
    expect(rescheduleHistoryEvent({ ...ROOM_OVERRIDE, by: "staff" }, "0")?.actorUid).toBeNull();
    expect(rescheduleHistoryEvent({ ...ROOM_OVERRIDE, by: "system" }, "0")?.actorUid).toBeNull();
    expect(rescheduleHistoryEvent({ ...ROOM_OVERRIDE, by: "" }, "0")?.actorUid).toBeNull();
  });

  it("resolves the room-change actor to a NAME through the ONE shared resolver", () => {
    const event = rescheduleHistoryEvent(ROOM_OVERRIDE, "0")!;
    const label = bookingHistoryActorLabel(event, new Map([["uid-juan", "Juan Dela Cruz"]]));
    expect(label).toBe("Juan Dela Cruz");
    expect(label).not.toContain("uid-juan");
  });

  it("reads the trail off the booking document", () => {
    const events = rescheduleHistoryEvents({ rescheduleHistory: [ROOM_OVERRIDE] });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("room-change");
  });

  it("returns an empty list for a booking with no room change", () => {
    expect(rescheduleHistoryEvents({ id: "BK-1" })).toEqual([]);
    expect(rescheduleHistoryEvents(null)).toEqual([]);
    expect(rescheduleHistoryEvents({ rescheduleHistory: "not-an-array" })).toEqual([]);
  });

  it("drops a malformed entry instead of throwing", () => {
    expect(rescheduleHistoryEvent(null, "0")).toBeNull();
    expect(rescheduleHistoryEvent("nope", "0")).toBeNull();
  });

  it("keeps EVERY change in the trail (the array is append-only)", () => {
    const events = rescheduleHistoryEvents({
      rescheduleHistory: [
        ROOM_OVERRIDE,
        { ...ROOM_OVERRIDE, toRoomNumber: "203", at: "2026-11-21T09:00:00.000Z" }
      ]
    });
    expect(events).toHaveLength(2);
    // Newest-first — the same order the merged timeline uses.
    expect(events.map((event) => event.subject)).toEqual([
      "Room 201 → Room 203",
      "Room 201 → Room 202"
    ]);
  });

  it("lands the room change in the merged timeline at its own moment", () => {
    const merged = mergeBookingHistoryEvents(
      rescheduleHistoryEvents({ rescheduleHistory: [ROOM_OVERRIDE] }),
      bookingMilestoneEvents({ createdAt: "2026-11-19T06:00:00.000Z", createdBy: "uid-juan" })
    );
    expect(merged[0]?.kind).toBe("room-change");
    expect(merged[0]?.at).toBe("2026-11-21T04:30:00.000Z");
    expect(merged[1]?.kind).toBe("created");
  });
});
