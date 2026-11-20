/**
 * ATR-07 — the Staff Audit Trail rules contract.
 *
 * WHAT THIS TEST PINS
 * -------------------
 * The `auditLogs` collection shipped in BR-12.1 with NO rule block, so
 * Firestore's default-deny rejected every row for months while the
 * writer swallowed the rejection by design (`console.warn`, never roll
 * back the primary write) — months of add-on history lost with no
 * error anywhere. That is finding 1 in
 * `plan/features/AUDIT-TRAIL.md`.
 *
 * The rule block now exists, but a rule block alone is not enough: a
 * rule that only says `create: if isStaff()` accepts a row that names
 * another staff member as the actor, carries an action outside the
 * closed vocabulary, or claims a timestamp that is not the moment it
 * was written. Those rows are STORED as if they were true, and the
 * whole point of the trail is that a row can be believed.
 *
 * So the rules now carry field validation, and this file pins it:
 *
 *   1. a VALID row is accepted (the rule must not break the writers);
 *   2. `actor` spoofing is denied (a client row cannot name someone
 *      else);
 *   3. an action outside the closed vocabulary is denied;
 *   4. a row claiming a timestamp other than the request time is
 *      denied;
 *   5. the trail is APPEND-ONLY — nobody may rewrite or delete a row;
 *   6. Front Desk CANNOT read `auditLogs` (CVQ-ATR-02: inline
 *      attribution for the desk, the full log for the owner only);
 *   7. the three EXISTING client-writable booking attribution fields
 *      (`discountVerifiedBy`, `specialRequestsUpdatedBy`,
 *      `handledBy`) are pinned to the CALLER's own uid — the
 *      forgeable-attribution defect from finding 7;
 *   8. the denormalized ROOM attribution fields are pinned the same
 *      way.
 *
 * The `roomAttributionOwnedByCaller()` / `bookingActorFieldsOwnedByCaller()`
 * helpers mirror the pattern the `charges` block already used
 * (`addedBy == request.auth.uid`, `addedAt == request.time`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  deleteDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const BOOKING_ID = "BK-ATR-00001";
const ROOM_ID = "RM-ATR-0001";

/**
 * A row exactly as `buildAuditEntry()` (shared/schemas/audit.ts)
 * produces it, plus the caller's `serverTimestamp()`.
 */
const validAuditRow = (actor: string) => ({
  action: "rooms.update",
  targetCollection: "rooms",
  targetId: ROOM_ID,
  changedFields: ["status"],
  before: { status: "available" },
  after: { status: "blocked" },
  actor,
  actorName: "Front Desk",
  source: "client",
  timestamp: serverTimestamp()
});

describe("ATR-07 — the auditLogs rules contract", () => {
  let env: RulesTestEnvironment;

  // `isStaff()` reads the `role` CLAIM, so an authenticated context
  // without it is not staff.
  const staffCtx = (role: "admin" | "front-desk", uid = `${role}-uid`) =>
    env.authenticatedContext(uid, { role });

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT_ID });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "bookings", BOOKING_ID), {
        bookingRef: "SI-ATR-00001",
        status: "confirmed",
        discountVerified: false,
        discountVerifiedBy: null,
        specialRequestsUpdatedBy: null,
        handledBy: ""
      });
      await setDoc(doc(fs, "rooms", ROOM_ID), {
        roomNumber: "202",
        type: "deluxe",
        status: "available",
        updatedBy: null,
        statusChangedBy: null,
        housekeepingUpdatedBy: null
      });
      // One existing audit row, so the append-only cases have a
      // target that was written under the rules.
      await setDoc(doc(fs, "auditLogs", "existing-row"), validAuditRow("admin-uid"));
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  // ── the trail accepts a well-formed row ────────────────────────
  it("accepts a valid row from staff", async () => {
    const db = staffCtx("front-desk").firestore();
    await setDoc(doc(db, "auditLogs", "good-row"), validAuditRow("front-desk-uid"));
    // The desk may WRITE a row but not READ the trail (CVQ-ATR-02),
    // so the row is read back through an admin context.
    const written = await getDoc(doc(staffCtx("admin").firestore(), "auditLogs", "good-row"));
    expect(written.exists()).toBe(true);
    expect(written.data()?.actor).toBe("front-desk-uid");
  });

  it("accepts a valid row from an admin", async () => {
    const db = staffCtx("admin").firestore();
    await setDoc(doc(db, "auditLogs", "admin-row"), validAuditRow("admin-uid"));
    const written = await getDoc(doc(db, "auditLogs", "admin-row"));
    expect(written.exists()).toBe(true);
  });

  it("refuses an anonymous client", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await expect(
      setDoc(doc(anon, "auditLogs", "anon-row"), validAuditRow("front-desk-uid"))
    ).rejects.toThrow();
  });

  // ── actor spoofing ─────────────────────────────────────────────
  it("refuses a row that names ANOTHER staff member as the actor", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      setDoc(doc(db, "auditLogs", "spoofed-row"), validAuditRow("admin-uid"))
    ).rejects.toThrow();
  });

  // ── the closed vocabulary ──────────────────────────────────────
  it("refuses an action outside the closed vocabulary", async () => {
    const db = staffCtx("admin").firestore();
    await expect(
      setDoc(doc(db, "auditLogs", "unknown-action"), {
        ...validAuditRow("admin-uid"),
        action: "bookings.teleport"
      })
    ).rejects.toThrow();
  });

  it("refuses a target collection outside the closed vocabulary", async () => {
    const db = staffCtx("admin").firestore();
    await expect(
      setDoc(doc(db, "auditLogs", "unknown-target"), {
        ...validAuditRow("admin-uid"),
        targetCollection: "secrets"
      })
    ).rejects.toThrow();
  });

  // ── the timestamp ───────────────────────────────────────────────
  it("refuses a row that claims a timestamp other than the request time", async () => {
    const db = staffCtx("admin").firestore();
    await expect(
      setDoc(doc(db, "auditLogs", "backdated-row"), {
        ...validAuditRow("admin-uid"),
        timestamp: new Date("2020-01-01T00:00:00Z")
      })
    ).rejects.toThrow();
  });

  // ── append-only ─────────────────────────────────────────────────
  it("refuses to rewrite a row", async () => {
    const db = staffCtx("admin").firestore();
    await expect(
      updateDoc(doc(db, "auditLogs", "existing-row"), {
        actorName: "Rewritten"
      })
    ).rejects.toThrow();
  });

  it("refuses to delete a row", async () => {
    const db = staffCtx("admin").firestore();
    await expect(deleteDoc(doc(db, "auditLogs", "existing-row"))).rejects.toThrow();
  });

  // ── who may READ the trail (CVQ-ATR-02) ────────────────────────
  it("refuses a Front Desk READ of the trail", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(getDoc(doc(db, "auditLogs", "existing-row"))).rejects.toThrow();
  });

  it("lets an ADMIN read the trail", async () => {
    const db = staffCtx("admin").firestore();
    await expect(getDoc(doc(db, "auditLogs", "existing-row"))).resolves.toBeTruthy();
  });

  // ── the three forgeable booking attribution fields (finding 7) ─
  it("refuses a booking write that claims ANOTHER staff member in `discountVerifiedBy`", async () => {
    // This is the money defect: a front-desk client approving a 20%
    // senior/PWD discount and stamping a colleague's UID as the
    // approver.
    const db = staffCtx("front-desk").firestore();
    await expect(
      updateDoc(doc(db, "bookings", BOOKING_ID), {
        discountVerified: true,
        discountVerifiedBy: "admin-uid",
        updatedAt: serverTimestamp()
      })
    ).rejects.toThrow();
  });

  it("refuses a booking write that claims ANOTHER staff member in `handledBy`", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      updateDoc(doc(db, "bookings", BOOKING_ID), {
        handledBy: "admin-uid",
        updatedAt: serverTimestamp()
      })
    ).rejects.toThrow();
  });

  it("refuses a booking write that claims ANOTHER staff member in `specialRequestsUpdatedBy`", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      updateDoc(doc(db, "bookings", BOOKING_ID), {
        specialRequestsUpdatedBy: "admin-uid",
        updatedAt: serverTimestamp()
      })
    ).rejects.toThrow();
  });

  it("still allows the desk to write the three fields with its OWN uid", async () => {
    // The rule must not break the legitimate workflow — the desk
    // approves discounts and edits special requests all day.
    const db = staffCtx("front-desk").firestore();
    await updateDoc(doc(db, "bookings", BOOKING_ID), {
      discountVerified: true,
      discountVerifiedBy: "front-desk-uid",
      handledBy: "front-desk-uid",
      specialRequestsUpdatedBy: "front-desk-uid",
      updatedAt: serverTimestamp()
    });
    const written = await getDoc(doc(db, "bookings", BOOKING_ID));
    expect(written.data()?.discountVerifiedBy).toBe("front-desk-uid");
  });

  it("still allows an unrelated booking write that touches none of the three", async () => {
    const db = staffCtx("front-desk").firestore();
    await updateDoc(doc(db, "bookings", BOOKING_ID), {
      notes: "Guest called about a late check-out.",
      updatedAt: serverTimestamp()
    });
    const written = await getDoc(doc(db, "bookings", BOOKING_ID));
    expect(written.data()?.notes).toContain("late check-out");
  });

  // ── the denormalized room attribution (ATR-03) ─────────────────
  it("refuses a room write that claims ANOTHER staff member in `updatedBy`", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      updateDoc(doc(db, "rooms", ROOM_ID), {
        updatedBy: "admin-uid",
        updatedAt: serverTimestamp()
      })
    ).rejects.toThrow();
  });

  it("refuses a room write that claims ANOTHER staff member in `housekeepingUpdatedBy`", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      updateDoc(doc(db, "rooms", ROOM_ID), {
        housekeepingUpdatedBy: "admin-uid",
        updatedAt: serverTimestamp()
      })
    ).rejects.toThrow();
  });

  it("still allows a room write that stamps its OWN uid", async () => {
    const db = staffCtx("front-desk").firestore();
    await updateDoc(doc(db, "rooms", ROOM_ID), {
      updatedBy: "front-desk-uid",
      statusChangedBy: "front-desk-uid",
      updatedAt: serverTimestamp()
    });
    const written = await getDoc(doc(db, "rooms", ROOM_ID));
    expect(written.data()?.updatedBy).toBe("front-desk-uid");
  });

  it("refuses to create a room that claims ANOTHER staff member as its creator", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      setDoc(doc(db, "rooms", "RM-ATR-0002"), {
        roomNumber: "203",
        type: "deluxe",
        isActive: true,
        createdBy: "admin-uid"
      })
    ).rejects.toThrow();
  });

  it("still allows creating a room with its OWN uid as the creator", async () => {
    const db = staffCtx("front-desk").firestore();
    await setDoc(doc(db, "rooms", "RM-ATR-0003"), {
      roomNumber: "204",
      type: "deluxe",
      isActive: true,
      createdBy: "front-desk-uid"
    });
    const written = await getDoc(doc(db, "rooms", "RM-ATR-0003"));
    expect(written.data()?.createdBy).toBe("front-desk-uid");
  });
});
