// ATR-08 follow-up (2026-11-21): the booking drawer's HISTORY tab.
//
// WHY THIS TEST EXISTS
// --------------------
// The History tab merges FOUR differently-shaped sources into one
// reverse-chronological timeline:
//
//   1. `breakfastAudit` rows   (server-written, BR-01)
//   2. `otherAddOnAudit` rows  (server-written, BR-12)
//   3. `charges` rows          (client-written, rules-pinned actor)
//   4. the booking's own milestone stamps (created / check-in / …)
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
