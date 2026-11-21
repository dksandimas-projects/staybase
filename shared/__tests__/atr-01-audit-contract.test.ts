// ATR-01 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the shared
// audit contract — schema, closed action vocabulary, PII redaction
// list, and the `buildAuditEntry` helper.
//
// These are the tripwires for the two failure modes the spec calls
// out by name:
//
//   1. "An unknown action is a test failure rather than a
//      silently-dropped row" (the `NBS-08` failure mode applied to
//      the audit log). Pinned by the closed-vocabulary tests below.
//
//   2. "A redacted field is recorded in `changedFields` by name only —
//      never in before/after" (finding 4 — PII must never enter a
//      second collection with different retention). Pinned by the
//      redaction tests below.
//
//   3. "The audit write never rolls back the primary mutation" —
//      that is the CALLER's contract, so the helper must never throw
//      on a redaction concern. Pinned by the "redaction cannot throw"
//      test.
//
//   4. "Rules, indexes and writers ship in ONE commit" (finding 1 —
//      a collection without its rules block loses every write
//      silently). The rules file repeats the vocabulary because
//      Firestore rules cannot import from `shared/`, so the two
//      lists must agree — pinned by the drift test at the bottom.

import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_REDACTED_FIELDS,
  AUDIT_TARGET_COLLECTIONS,
  AuditActionSchema,
  AuditLogEntrySchema,
  buildAuditEntry,
  isAuditAction,
  isAuditRedactedField,
  redactAuditValues,
} from "@spark-inn/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../");
const firestoreRulesSrc = readFileSync(
  resolve(repoRoot, "firebase/firestore.rules"),
  "utf8"
);

describe("ATR-01 — the audit action vocabulary is a CLOSED set", () => {
  it("exposes the vocabulary the spec lists", () => {
    // The spec's §Action vocabulary. Every one of these must be
    // present — a missing action means a writer cannot record the
    // event it exists for.
    for (const action of [
      "bookings.create-walkin",
      "bookings.checkin",
      "bookings.checkout",
      "bookings.confirm",
      "bookings.cancel",
      "bookings.reschedule",
      "bookings.room-reassign",
      "bookings.payment-add",
      "bookings.payment-verify",
      "bookings.payment-reject",
      "bookings.refund",
      "bookings.discount-verify",
      "bookings.discount-reject",
      "bookings.update",
      "rooms.create",
      "rooms.update",
      "rooms.delete",
      "rooms.status-change",
      "rooms.housekeeping",
      "rooms.block",
      "addons.create",
      "addons.update",
      "addons.delete",
      "settings.update",
      "rates.update",
      "vouchers.create",
      "vouchers.update",
      "staff.create",
      "staff.disable",
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });

  it("rejects an action outside the vocabulary", () => {
    // The `NBS-08` failure mode: an unknown source was silently
    // dropped by Reports. An unknown AUDIT ACTION must be a hard
    // failure, not a silent no-op.
    expect(isAuditAction("bookings.teleport")).toBe(false);
    expect(isAuditAction("rooms.somethingNew")).toBe(false);
    expect(isAuditAction("")).toBe(false);
    expect(isAuditAction(undefined)).toBe(false);
    expect(isAuditAction(null)).toBe(false);
    // A non-string must not blow up the guard.
    expect(isAuditAction(42)).toBe(false);
    expect(isAuditAction({})).toBe(false);
  });

  it("accepts every vocabulary member through the Zod enum", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AuditActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("the Zod enum rejects an unknown action", () => {
    expect(AuditActionSchema.safeParse("bookings.teleport").success).toBe(false);
  });

  it("the vocabulary has no duplicates", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("every action is namespaced as <domain>.<verb>", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action, `${action} must be "<domain>.<verb>"`).toMatch(
        /^[a-z]+\.[a-z-]+$/
      );
    }
  });
});

describe("ATR-01 — the PII redaction list", () => {
  it("covers every field the spec names", () => {
    for (const field of [
      "guestName",
      "guestEmail",
      "guestPhone",
      "guestRegistration",
      "guestIdPhotoUrl",
      "paymentProofUrl",
      "paymentProofPath",
      "discountIdPhotoUrl",
      "lookupToken",
      "qrToken",
      "remarks",
    ]) {
      expect(AUDIT_REDACTED_FIELDS).toContain(field);
      expect(isAuditRedactedField(field)).toBe(true);
    }
  });

  it("covers the members/* personal fields", () => {
    for (const field of [
      "memberEmail",
      "memberPhone",
      "memberFullName",
      "memberIdUrl",
    ]) {
      expect(isAuditRedactedField(field)).toBe(true);
    }
  });

  it("covers the booking documents' ACTUAL guest-identity field names (the `leadGuest*` family)", () => {
    // Per ATR-02 (2026-11-21): the spec's redaction list names
    // `guestName` / `guestEmail` / `guestPhone`, but the booking
    // documents carry the guest's identity under `leadGuestName` /
    // `leadGuestEmail` / `leadGuestPhone` (plus a nested
    // `leadGuestDetails` / `guestDetails` object). The list as
    // shipped did not cover the names the real documents use, so a
    // writer that snapshotted a booking doc would have copied the
    // guest's personal data into `auditLogs` — a SECOND copy, under
    // a different retention.
    for (const field of [
      "leadGuestName",
      "leadGuestEmail",
      "leadGuestPhone",
      "leadGuestDetails",
      "guestDetails",
      "discountIdPhotoPath",
    ]) {
      expect(isAuditRedactedField(field), `${field} must be redacted`).toBe(true);
    }
    // The redaction must not over-match the neighbouring field names
    // the trail legitimately needs.
    expect(isAuditRedactedField("leadGuest")).toBe(false);
    expect(isAuditRedactedField("guest")).toBe(false);
  });

  it("does NOT over-match — a longer field name is not redacted", () => {
    // An over-broad match would silently drop legitimate audit
    // values, so the match is EXACT.
    expect(isAuditRedactedField("guestEmailAddress")).toBe(false);
    expect(isAuditRedactedField("remark")).toBe(false);
    expect(isAuditRedactedField("roomNumber")).toBe(false);
    expect(isAuditRedactedField("totalPrice")).toBe(false);
  });

  it("redactAuditValues strips the redacted fields and keeps the rest", () => {
    const safe = redactAuditValues({
      guestName: "Juan Dela Cruz",
      guestEmail: "juan@example.com",
      roomNumber: "202",
      totalPrice: 4500,
      remarks: "guest was drunk",
      lookupToken: "abc123"
    });
    expect(safe).toEqual({ roomNumber: "202", totalPrice: 4500 });
  });

  it("redactAuditValues handles null and undefined", () => {
    expect(redactAuditValues(null)).toBeNull();
    expect(redactAuditValues(undefined)).toBeNull();
  });
});

describe("ATR-01 — buildAuditEntry", () => {
  const base = {
    action: "rooms.update" as const,
    targetCollection: "rooms" as const,
    targetId: "room-202",
    actor: "staff-uid-1",
    actorName: "Jun",
    source: "client" as const
  };

  it("builds a valid row", () => {
    const entry = buildAuditEntry({
      ...base,
      before: { roomNumber: "202" },
      after: { roomNumber: "203" }
    });
    expect(entry.action).toBe("rooms.update");
    expect(entry.targetCollection).toBe("rooms");
    expect(entry.targetId).toBe("room-202");
    expect(entry.actor).toBe("staff-uid-1");
    expect(entry.actorName).toBe("Jun");
    expect(entry.source).toBe("client");
  });

  it("records ONLY the fields that actually changed", () => {
    // The log answers "what changed", not "what was written".
    const entry = buildAuditEntry({
      ...base,
      before: { roomNumber: "202", name: "Ocean Suite", isActive: true },
      after: { roomNumber: "203", name: "Ocean Suite", isActive: true }
    });
    expect(entry.changedFields).toEqual(["roomNumber"]);
  });

  it("records a field that was added", () => {
    const entry = buildAuditEntry({
      ...base,
      before: { roomNumber: "202" },
      after: { roomNumber: "202", type: "deluxe" }
    });
    expect(entry.changedFields).toEqual(["type"]);
  });

  it("records a field that was removed", () => {
    const entry = buildAuditEntry({
      ...base,
      before: { roomNumber: "202", type: "deluxe" },
      after: { roomNumber: "202" }
    });
    expect(entry.changedFields).toEqual(["type"]);
  });

  it("records a REDACTED field by NAME ONLY — never its value", () => {
    // The core PII guarantee (finding 4).
    const entry = buildAuditEntry({
      ...base,
      action: "bookings.update" as const,
      targetCollection: "bookings" as const,
      before: { guestName: "Juan Dela Cruz", status: "pending" },
      after: { guestName: "Juan Dela Cruz Jr", status: "confirmed" }
    });

    // The field NAME is recorded — that is how a reader knows the
    // guest's name changed without learning what it changed to.
    expect(entry.changedFields).toContain("guestName");
    // But the VALUE never appears in before/after.
    expect(JSON.stringify(entry)).not.toContain("Juan Dela Cruz");
    expect(entry.before?.guestName).toBeUndefined();
    expect(entry.after?.guestName).toBeUndefined();
    // The non-redacted sibling still carries its value.
    expect(entry.after?.status).toBe("confirmed");
  });

  it("redacts every PII field in one row", () => {
    const entry = buildAuditEntry({
      ...base,
      action: "bookings.update" as const,
      targetCollection: "bookings" as const,
      before: {
        guestEmail: "juan@example.com",
        guestPhone: "+639171234567",
        paymentProofUrl: "https://example.com/proof.jpg",
        guestRegistration: "reg-abc",
        lookupToken: "tok-123"
      },
      after: {
        guestEmail: "juan2@example.com",
        guestPhone: "+639179999999",
        paymentProofUrl: "https://example.com/proof2.jpg",
        guestRegistration: "reg-xyz",
        lookupToken: "tok-456"
      }
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("juan@example.com");
    expect(serialized).not.toContain("+639171234567");
    expect(serialized).not.toContain("proof.jpg");
    expect(serialized).not.toContain("reg-abc");
    expect(serialized).not.toContain("tok-123");
    // All five names are still recorded.
    expect(entry.changedFields).toEqual(
      expect.arrayContaining([
        "guestEmail",
        "guestPhone",
        "paymentProofUrl",
        "guestRegistration",
        "lookupToken"
      ])
    );
  });

  it("never throws on a redaction concern — the audit write must not roll back the primary mutation", () => {
    // The writer swallows failures by design; the HELPER must never
    // be the thing that throws over a PII field. A redacted field is
    // dropped silently, not rejected.
    expect(() =>
      buildAuditEntry({
        ...base,
        before: { guestName: "Secret" },
        after: { guestName: "Secret2" }
      })
    ).not.toThrow();
  });

  it("throws on an action outside the vocabulary", () => {
    expect(() =>
      buildAuditEntry({
        ...base,
        // @ts-expect-error — deliberately outside the closed set.
        action: "bookings.teleport"
      })
    ).toThrow();
  });

  it("accepts a caller-supplied changedFields list", () => {
    const entry = buildAuditEntry({
      ...base,
      changedFields: ["status", "statusChangedBy"],
      before: null,
      after: { status: "blocked" }
    });
    expect(entry.changedFields).toEqual(["status", "statusChangedBy"]);
  });

  it("leaves the timestamp to the caller (the clock is the writer's)", () => {
    // The client writer passes `serverTimestamp()`; the server writer
    // passes the transaction's `now`. The helper must not invent one.
    const entry = buildAuditEntry({ ...base, before: null, after: null });
    expect(entry.timestamp).toBeUndefined();
  });

  it("validates against the row schema", () => {
    const entry = buildAuditEntry({ ...base, before: null, after: null });
    expect(AuditLogEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("rejects a row whose targetCollection is outside the vocabulary", () => {
    expect(() =>
      buildAuditEntry({
        ...base,
        // @ts-expect-error — deliberately outside the closed set.
        targetCollection: "secrets"
      })
    ).toThrow();
  });
});

describe("ATR-01 — the rules file and the shared vocabulary agree", () => {
  it("the rules file validates `action` against the SAME closed set", () => {
    // Finding 1 in reverse: the rules file repeats the vocabulary
    // because Firestore rules cannot import from `shared/`. If the
    // two drift, a writer can produce a row the rules reject — and a
    // rejected audit write is a SILENTLY LOST audit write, the exact
    // BR-12.1 failure.
    expect(firestoreRulesSrc).toContain("function isAuditAction()");
    for (const action of AUDIT_ACTIONS) {
      expect(
        firestoreRulesSrc,
        `the rules file must list "${action}" in isAuditAction()`
      ).toContain(`"${action}"`);
    }
  });

  it("the rules file pins the target collections the shared schema pins", () => {
    for (const collection of AUDIT_TARGET_COLLECTIONS) {
      expect(
        firestoreRulesSrc,
        `the rules file must list "${collection}" as a target collection`
      ).toContain(`"${collection}"`);
    }
  });

  it("the rules file constrains `actor` to the caller's own uid", () => {
    // A client row cannot name someone else (the spec's §Rules).
    expect(firestoreRulesSrc).toContain(
      "request.resource.data.actor == request.auth.uid"
    );
  });

  it("the rules file pins the timestamp to the request time", () => {
    expect(firestoreRulesSrc).toContain(
      "request.resource.data.timestamp == request.time"
    );
  });
});
