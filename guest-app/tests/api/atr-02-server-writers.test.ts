// Per ATR-02 (2026-11-21, `plan/features/AUDIT-TRAIL.md`): the
// server-side audit WRITER tests.
//
// WHAT THIS FILE GUARDS
// ---------------------
// ATR-01 shipped the row SHAPE (the closed action vocabulary + the
// PII redaction list + `buildAuditEntry`). ATR-02 ships the WRITER:
// every authenticated staff mutation records a row through it, with
// `source: "server"`.
//
// The three failure classes this file closes:
//
//   1. A staff mutation with NO audit row (the trail silently goes
//      dark). Guarded by the per-action-family contract test — every
//      one of the 13 `bookings.*` actions must have a writer.
//   2. A row that carries guest PII (the trail becomes a SECOND copy
//      of the guest's personal data, under a different retention).
//      Guarded by the redaction runtime assertions + the PII-field
//      guard.
//   3. A failed audit write that rolls back the staff member's actual
//      work (GOTCHAS §Security & PII). Guarded by the never-throws
//      assertion on `buildServerAuditEntry`.
//
// WHY A SOURCE-TEXT CONTRACT TEST FOR THE COVERAGE
// -------------------------------------------------
// The coverage guard (every action family has a writer) is a
// SOURCE-TEXT assertion on purpose: it must FAIL when a handler
// silently loses its writer, and it must see the writer even when
// the handler's runtime path is too large to mock faithfully. The
// runtime assertions below then prove the writer's actual BEHAVIOR
// (redaction, `source: "server"`, never-throws) and prove that a
// real handler really lands a row in `auditLogs`.
//
// Reference IDs: ATR-02-001..0xx.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_ACTIONS } from "@spark-inn/shared";

const { mockBookings, mockGuests, mockAuditRows, mockWrites } = vi.hoisted(() => ({
  mockBookings: {} as Record<string, any>,
  mockGuests: {} as Record<string, any>,
  mockAuditRows: [] as Array<Record<string, any>>,
  mockWrites: [] as Array<{ type: string; path: string; data: any }>
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (path: string) => {
    const segments = path.split("/");
    const coll = segments[0];
    const docId = segments[1] || "";
    return {
      path,
      id: docId,
      get: async () => {
        let store: Record<string, any> = {};
        if (coll === "bookings") store = mockBookings;
        else if (coll === "guests") store = mockGuests;
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      },
      collection: (sub: string) => ({
        path: `${path}/${sub}`,
        doc: (subDocId?: string) => docRef(`${path}/${sub}/${subDocId || "auto_id"}`),
        get: async () => ({ docs: [] })
      }),
      update: async (data: any) => {
        if (coll === "bookings" && mockBookings[docId]) {
          Object.assign(mockBookings[docId], data);
        }
        mockWrites.push({ type: "update", path, data });
      },
      set: async (data: any) => {
        mockWrites.push({ type: "set", path, data });
      }
    };
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => ({
        _coll: collName,
        doc: (docId?: string) => docRef(`${collName}/${docId || "auto_id"}`),
        add: async (data: any) => {
          mockAuditRows.push(data);
          return { id: `audit_${mockAuditRows.length}` };
        },
        get: async () => ({ docs: [], empty: true }),
        where: () => ({ limit: () => ({ get: async () => ({ docs: [], empty: true }) }), get: async () => ({ docs: [], empty: true }) })
      })),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref && typeof ref.get === "function") return ref.get();
            return { exists: false };
          }),
          set: vi.fn().mockImplementation((ref: any, data: any) => {
            const path = ref.path;
            const segments = path.split("/");
            const coll = segments[0];
            const docId = segments[1] || "";
            if (coll === "auditLogs") {
              mockAuditRows.push(data);
            } else if (coll === "bookings" && mockBookings[docId]) {
              Object.assign(mockBookings[docId], data);
            }
            mockWrites.push({ type: "set", path, data });
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            const path = ref.path;
            const segments = path.split("/");
            const coll = segments[0];
            const docId = segments[1] || "";
            if (coll === "bookings" && mockBookings[docId]) {
              Object.assign(mockBookings[docId], data);
            }
            mockWrites.push({ type: "update", path, data });
          })
        });
      })
    },
    adminAuth: {}
  };
});

import {
  buildServerAuditEntry,
  serverAuditActor,
  stageServerAuditRow
} from "../../server/lib/audit-writer";
import { handleSetLouReceived } from "../../server/handlers/bookings";

const HANDLERS_SOURCE = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const WRITER_SOURCE = readFileSync(
  resolve(__dirname, "../../server/lib/audit-writer.ts"),
  "utf8"
);

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

/**
 * Read the body of the object literal whose opening brace is at
 * `openBraceIndex` — a brace-matched slice, so a nested object does
 * not run the scan past the end of its map.
 */
function extractBalancedObject(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, i);
    }
  }
  return "";
}

const staffReq = (overrides: Record<string, any> = {}) => ({
  method: "POST",
  staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
  body: { bookingId: "booking_1", ...overrides }
});

// ---------------------------------------------------------------------------
// ATR-02-001..010 — the writer helper's runtime behavior
// ---------------------------------------------------------------------------

describe("ATR-02 — the server audit writer", () => {
  beforeEach(() => {
    mockAuditRows.length = 0;
    mockWrites.length = 0;
    for (const key of Object.keys(mockBookings)) delete mockBookings[key];
    for (const key of Object.keys(mockGuests)) delete mockGuests[key];
  });

  it("ATR-02-001: every row is stamped `source: \"server\"`", () => {
    const entry = buildServerAuditEntry({
      actor: { uid: "staff_1", name: "Maria", role: "front-desk" },
      action: "bookings.checkin",
      targetId: "booking_1",
      timestamp: new Date("2026-11-21T00:00:00.000Z")
    });
    expect(entry).not.toBeNull();
    expect(entry!.source).toBe("server");
  });

  it("ATR-02-002: the actor comes from the verified token, not the request body", () => {
    const actor = serverAuditActor(
      { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "admin" },
      "Maria Santos"
    );
    expect(actor.uid).toBe("staff_1");
    expect(actor.role).toBe("admin");
    expect(actor.name).toBe("Maria Santos");
  });

  it("ATR-02-003: a non-admin role maps to `front-desk`; an unknown role does not become `admin`", () => {
    expect(serverAuditActor({ uid: "u", role: "front-desk" }, "Jun").role).toBe("front-desk");
    expect(serverAuditActor({ uid: "u", role: "something-else" }, "Jun").role).toBe("front-desk");
    expect(serverAuditActor(undefined, "").role).toBe("front-desk");
  });

  it("ATR-02-004: an action outside the closed vocabulary returns null and NEVER throws", () => {
    const entry = buildServerAuditEntry({
      actor: { uid: "staff_1", name: "Maria", role: "front-desk" },
      action: "bookings.teleport" as any,
      targetId: "booking_1",
      timestamp: new Date()
    });
    expect(entry).toBeNull();
  });

  it("ATR-02-005: a redacted field is recorded BY NAME in `changedFields` but its VALUE never leaves", () => {
    const entry = buildServerAuditEntry({
      actor: { uid: "staff_1", name: "Maria", role: "front-desk" },
      action: "bookings.update",
      targetId: "booking_1",
      before: { guestName: "Juan Dela Cruz", status: "pending" },
      after: { guestName: "Juan Dela Cruz Jr", status: "confirmed" },
      timestamp: new Date()
    });
    expect(entry).not.toBeNull();
    // The NAME is recorded...
    expect(entry!.changedFields).toContain("guestName");
    // ...the VALUE is not.
    expect(JSON.stringify(entry!.before)).not.toContain("Juan");
    expect(JSON.stringify(entry!.after)).not.toContain("Juan");
    expect(entry!.before).toEqual({ status: "pending" });
  });

  it("ATR-02-006: `leadGuestName` / `leadGuestEmail` / `leadGuestPhone` / `guestDetails` are on the redaction list", () => {
    // The booking docs carry the guest's identity under `leadGuest*`
    // names, NOT under `guestName` / `guestEmail`. Before ATR-02's
    // writer landed, a whole-document snapshot would have copied the
    // guest's name, email and phone straight into `auditLogs` — a
    // SECOND copy of the guest's personal data under a different
    // retention. The redaction list now covers the real field names.
    const entry = buildServerAuditEntry({
      actor: { uid: "staff_1", name: "Maria", role: "front-desk" },
      action: "bookings.create-walkin",
      targetId: "booking_1",
      before: {
        leadGuestName: "Juan Dela Cruz",
        leadGuestEmail: "juan@example.com",
        leadGuestPhone: "+63 917 000 0000",
        guestDetails: { firstName: "Juan", lastName: "Dela Cruz" }
      },
      after: {
        leadGuestName: "Juan Dela Cruz Jr",
        leadGuestEmail: "juan.jr@example.com",
        leadGuestPhone: "+63 917 111 0000",
        guestDetails: { firstName: "Juan Jr", lastName: "Dela Cruz" }
      },
      timestamp: new Date()
    });
    expect(entry).not.toBeNull();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("Juan");
    expect(serialized).not.toContain("juan@example.com");
    expect(serialized).not.toContain("917 000 0000");
    // The names are still recorded, so the trail shows THAT they
    // were part of the change.
    expect(entry!.changedFields).toContain("leadGuestName");
    expect(entry!.changedFields).toContain("guestDetails");
  });

  it("ATR-02-007: a free-text field is recorded by NAME only (explicit `changedFields`, no value)", () => {
    const entry = buildServerAuditEntry({
      actor: { uid: "staff_1", name: "Maria", role: "front-desk" },
      action: "bookings.update",
      targetId: "booking_1",
      before: null,
      after: null,
      changedFields: ["specialRequests", "specialRequestsUpdatedAt"],
      timestamp: new Date()
    });
    expect(entry).not.toBeNull();
    expect(entry!.changedFields).toEqual(["specialRequests", "specialRequestsUpdatedAt"]);
    expect(entry!.before).toBeNull();
    expect(entry!.after).toBeNull();
  });

  it("ATR-02-008: `stageServerAuditRow` writes into `auditLogs` through the caller's transaction", () => {
    const entry = buildServerAuditEntry({
      actor: { uid: "staff_1", name: "Maria", role: "front-desk" },
      action: "bookings.checkin",
      targetId: "booking_1",
      timestamp: new Date()
    });
    const set = vi.fn();
    stageServerAuditRow({ set } as any, entry!);
    expect(set).toHaveBeenCalledTimes(1);
    const [ref, data] = set.mock.calls[0];
    expect(ref.path.startsWith("auditLogs/")).toBe(true);
    expect(data.action).toBe("bookings.checkin");
    expect(data.source).toBe("server");
  });

  it("ATR-02-009: the helper's own source routes every row through `buildAuditEntry`", () => {
    // `buildAuditEntry` is the ONLY sanctioned way to build a row —
    // it is what applies the redaction list. A writer that hand-builds
    // a row bypasses the list.
    expect(WRITER_SOURCE).toContain("buildAuditEntry(");
    expect(WRITER_SOURCE).not.toMatch(/auditLogs[^\n]*\.add\(\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// ATR-02-020..030 — a real handler really lands a row
// ---------------------------------------------------------------------------

describe("ATR-02 — a staff mutation really lands an audit row", () => {
  beforeEach(() => {
    mockAuditRows.length = 0;
    mockWrites.length = 0;
    for (const key of Object.keys(mockBookings)) delete mockBookings[key];
    for (const key of Object.keys(mockGuests)) delete mockGuests[key];
    mockGuests.staff_1 = { fullName: "Maria Santos" };
  });

  it("ATR-02-020: the LOU toggle writes a `bookings.update` row with the resolved staff name", async () => {
    mockBookings.booking_1 = {
      bookingRef: "SI-20261121-00001",
      status: "pending",
      isCorporate: true,
      paymentMethod: "pay-at-hotel",
      louReceived: false
    };

    const res = mockResponse();
    await handleSetLouReceived(staffReq({ louReceived: true }), res);

    expect(mockAuditRows).toHaveLength(1);
    const row = mockAuditRows[0];
    expect(row.action).toBe("bookings.update");
    expect(row.source).toBe("server");
    expect(row.targetCollection).toBe("bookings");
    expect(row.targetId).toBe("booking_1");
    expect(row.targetLabel).toBe("SI-20261121-00001");
    expect(row.actor).toBe("staff_1");
    expect(row.actorName).toBe("Maria Santos");
    expect(row.actorRole).toBe("front-desk");
    expect(row.before).toEqual({ louReceived: false });
    expect(row.after).toEqual({ louReceived: true });
    expect(row.changedFields).toContain("louReceived");
  });

  it("ATR-02-021: the row commits with the mutation — the booking AND the row are written", async () => {
    mockBookings.booking_1 = {
      bookingRef: "SI-20261121-00002",
      status: "pending",
      isCorporate: true,
      paymentMethod: "pay-at-hotel",
      louReceived: false
    };

    const res = mockResponse();
    await handleSetLouReceived(staffReq({ louReceived: true }), res);

    // The booking changed...
    expect(mockBookings.booking_1.louReceived).toBe(true);
    // ...and the audit row is in the SAME transaction (the mock's
    // `transaction.set` is the only path that can put a row in
    // `auditLogs`), so it commits atomically with the change.
    const auditWrite = mockWrites.find((w) => w.path.startsWith("auditLogs/"));
    expect(auditWrite).toBeTruthy();
    expect(auditWrite!.data.source).toBe("server");
  });

  it("ATR-02-022: a rejected mutation writes NO row (the trail records what happened, not what was attempted)", async () => {
    // A non-corporate booking cannot have an LOU — the handler
    // throws before any write.
    mockBookings.booking_1 = {
      bookingRef: "SI-20261121-00003",
      status: "pending",
      isCorporate: false,
      paymentMethod: "pay-at-hotel"
    };

    const res = mockResponse();
    await handleSetLouReceived(staffReq({ louReceived: true }), res);

    expect(mockAuditRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ATR-02-040..060 — the coverage contract (source text)
// ---------------------------------------------------------------------------

describe("ATR-02 — every action family has a server writer", () => {
  // The 13 `bookings.*` actions ATR-02 names. Each MUST have a
  // `buildServerAuditEntry` call site with that action, or the trail
  // silently goes dark for that whole mutation family.
  const REQUIRED_BOOKING_ACTIONS = [
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
    "bookings.discount-reject"
  ];

  for (const action of REQUIRED_BOOKING_ACTIONS) {
    it(`ATR-02-040: ${action} has a server writer`, () => {
      expect(
        HANDLERS_SOURCE.includes(`action: "${action}"`),
        `No audit writer records "${action}". The trail would silently go dark for that mutation family.`
      ).toBe(true);
      expect(AUDIT_ACTIONS).toContain(action);
    });
  }

  it("ATR-02-041: the generic `bookings.update` family is written too", () => {
    // The LOU toggle, the special-requests edit, the early check-in
    // resolution, the add-room action + the cancellation exception.
    expect(HANDLERS_SOURCE).toContain('action: "bookings.update"');
  });

  it("ATR-02-042: every `buildServerAuditEntry` call site names an action from the closed vocabulary", () => {
    // The scan is limited to the audit action NAMESPACE — the file
    // has other `action:` keys (a notification's `action: "remove"`),
    // and those are not audit rows.
    const actions = [
      ...HANDLERS_SOURCE.matchAll(
        /action:\s*"((?:bookings|rooms|addons|settings|rates|vouchers|staff)\.[a-z-]+)"/g
      )
    ].map((m) => m[1]);
    expect(actions.length).toBeGreaterThanOrEqual(REQUIRED_BOOKING_ACTIONS.length);
    for (const action of actions) {
      expect(
        (AUDIT_ACTIONS as readonly string[]).includes(action),
        `"${action}" is not in the closed action vocabulary.`
      ).toBe(true);
    }
  });

  it("ATR-02-043: every writer call site routes the row into `auditLogs` through the helper", () => {
    // No handler may hand-build an `auditLogs` row — every row goes
    // through `buildServerAuditEntry` + `stageServerAuditRow` /
    // `writeServerAuditRow`.
    const buildCalls = HANDLERS_SOURCE.match(/buildServerAuditEntry\(/g) || [];
    const stageCalls = HANDLERS_SOURCE.match(/stageServerAuditRow\(/g) || [];
    const writeCalls = HANDLERS_SOURCE.match(/writeServerAuditRow\(/g) || [];
    expect(buildCalls.length).toBeGreaterThan(0);
    // Every staged/written row is guarded by a build (the call site
    // pattern is `if (entry) stageServerAuditRow(transaction, entry)`),
    // so the two counts must agree (minus the import site).
    expect(stageCalls.length + writeCalls.length).toBeGreaterThanOrEqual(buildCalls.length);
  });

  it("ATR-02-044: no audit row copies a guest PII field as a VALUE", () => {
    // The booking docs carry the guest's identity under `leadGuest*`
    // names + a nested `guestDetails` object. A row that copied them
    // would create a SECOND copy of the guest's personal data under
    // a different retention — the exact thing the redaction list
    // exists to prevent.
    //
    // The guard scans every `before: {` / `after: {` MAP in the
    // handlers file (brace-matched, so a nested object does not run
    // the scan past the end of its map). A PII KEY inside one is a
    // leak. The `changedFields` array may name them — that is the
    // point of the list — only the VALUE maps are scanned.
    const maps = [...HANDLERS_SOURCE.matchAll(/(?:before|after):\s*\{/g)];
    expect(maps.length).toBeGreaterThan(0);
    for (const match of maps) {
      const body = extractBalancedObject(HANDLERS_SOURCE, match.index + match[0].length - 1);
      for (const piiField of [
        "leadGuestName",
        "leadGuestEmail",
        "leadGuestPhone",
        "leadGuestDetails",
        "guestDetails",
        "guestName",
        "guestEmail",
        "guestPhone",
        "guestRegistration",
        "guestIdPhotoUrl",
        "paymentProofUrl",
        "paymentProofPath",
        "discountIdPhotoUrl",
        "discountIdPhotoPath",
        "lookupToken",
        "qrToken",
        "remarks",
        "notes",
        "specialRequests"
      ]) {
        expect(
          !new RegExp(`\\b${piiField}\\s*:`).test(body),
          `An audit row's value map carries the PII field "${piiField}". Record it BY NAME ONLY.`
        ).toBe(true);
      }
    }
  });

  it("ATR-02-045: the staff display name is resolved BEFORE every transaction (FOL-03 / MRB-15-09)", () => {
    // The name lookup is a READ. A Firestore transaction rejects a
    // read after a write, and a resolution INSIDE a transaction body
    // would also read outside the transaction's snapshot — so every
    // resolution must sit at handler scope, before the transaction
    // opens.
    //
    // "Handler scope" = after the enclosing `export async function
    // handle…` and BEFORE the enclosing `runTransaction(`.
    const resolutions = [
      ...HANDLERS_SOURCE.matchAll(
        /await (?:resolveStaffDisplayName|resolveServerAuditActor)\(/g
      )
    ];
    expect(resolutions.length).toBeGreaterThanOrEqual(REQUIRED_BOOKING_ACTIONS.length);
    for (const resolution of resolutions) {
      const before = HANDLERS_SOURCE.slice(0, resolution.index);
      const lastTransaction = before.lastIndexOf("runTransaction(");
      const lastHandler = before.lastIndexOf("export async function handle");
      expect(
        lastTransaction < lastHandler,
        "A staff-name resolution sits inside a transaction body — it is a READ, and Firestore rejects reads after writes (FOL-03)."
      ).toBe(true);
    }
  });

  it("ATR-02-046: no handler writes a raw `auditLogs` document outside the writer helper", () => {
    // `adminDb.collection("auditLogs")` may only appear inside the
    // writer helper, never in a handler — a handler that writes the
    // collection directly would bypass `buildAuditEntry` (and with it
    // the redaction list).
    const handlerAuditCollections = [...HANDLERS_SOURCE.matchAll(/collection\(\s*"auditLogs"\s*\)/g)];
    expect(handlerAuditCollections).toHaveLength(0);
    expect(WRITER_SOURCE).toContain('collection("auditLogs")');
  });
});
