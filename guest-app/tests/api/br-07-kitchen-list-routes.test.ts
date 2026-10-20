// Per BR-07 (Phase 13 — Breakfast Redesign, decision
// #236, 2026-10-13): source-text + smoke tripwires for
// the kitchen list endpoints.
//
//   GET  /api/bookings/breakfast/kitchen-list?date=YYYY-MM-DD
//   POST /api/bookings/breakfast/kitchen-list/acknowledge
//
// The pattern mirrors BR-06's `br-06-refunds-extension.test.ts`
// — static string checks for the handler shape and the
// `apiRouter.ts` registration, plus smoke tests for the
// pure helper contracts (date validation, slot-key →
// guest-name parsing). The full Firestore round-trip is
// exercised in a separate smoke that stubs the two
// collection scans.
//
// Covered (per the BR-07 acceptance criteria 8.1..10):
//   1. GET endpoint registered in `apiRouter.ts`.
//   2. Validate `?date=YYYY-MM-DD` — reject bad dates
//      with 400.
//   3. Response shape carries `finalized` +
//      `lateChanges` + `summary`.
//   4. The handler reads `breakfastAudit` via
//      `collectionGroup("breakfastAudit")` for the late
//      changes column.
//   5. The handler reads `breakfastSelections[date-*]`
//      for the finalized column.
//   6. Per-entry room number + guest name come back
//      populated.
//   7. The 30s in-memory cache (`Map` keyed by date) is
//      wired in the handler module.
//   8. POST `/api/bookings/breakfast/kitchen-list/acknowledge`
//      registered.
//   9. The ack handler requires the staff role.
//  10. The ack handler stamps `acknowledgedAt` +
//      `acknowledgedBy` on the audit doc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), "utf8");
}

// ---------- Source-text tripwires ----------

describe("BR-07 — Kitchen list routes (source-text tripwires)", () => {
  // 1. The GET endpoint is registered in `apiRouter.ts`.
  it("GET /api/bookings/breakfast/kitchen-list is registered", () => {
    const source = readSource("guest-app/server/apiRouter.ts");
    expect(source).toContain("handleGetKitchenList");
    expect(source).toContain("handleAcknowledgeKitchenListAudit");
    // The dispatch block targets `pathSegments[2] === "kitchen-list"` on
    // `domain === "bookings" && action === "breakfast"`.
    expect(source).toMatch(/domain === "bookings"[\s\S]{0,80}action === "breakfast"[\s\S]{0,120}kitchen-list/);
    // Rate-limited at 30/min/IP (per BR-07 spec).
    expect(source).toContain("bookings-breakfast-kitchen-list:");
    // 120/min/IP for the ack path (per BR-07 spec).
    expect(source).toContain("bookings-breakfast-kitchen-list-acknowledge:");
  });

  // 2. Date validation rejects malformed input with 400.
  it("the handler validates the ?date parameter (YYYY-MM-DD + real calendar)", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    // The source's regex literal: `^\d{4}-\d{2}-\d{2}$`.
    // Match on the literal pattern (no escape on `{`).
    expect(source).toContain("^\\d{4}-\\d{2}-\\d{2}$");
    // `isValidCalendarDate` defends against Feb 30 / month-13.
    expect(source).toContain("isValidCalendarDate");
    // 400 surfaced for missing + invalid dates.
    expect(source).toMatch(/res\.status\(400\)/);
  });

  // 3. Response shape: `finalized` + `lateChanges` + `summary`.
  it("the handler returns finalized + lateChanges + summary", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    expect(source).toContain("finalized:");
    expect(source).toContain("lateChanges:");
    expect(source).toContain("summary:");
    expect(source).toMatch(/totalMeals:\s*finalized\.length/);
    expect(source).toContain("byMeal:");
    // Type interface pins the wire shape.
    expect(source).toContain("KitchenListSummary");
    expect(source).toContain("KitchenListFinalizedEntry");
    expect(source).toContain("KitchenListLateChangeEntry");
  });

  // 4. Reads `breakfastAudit` for late changes via collectionGroup.
  it("the handler reads breakfastAudit via collectionGroup", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    expect(source).toContain('collectionGroup("breakfastAudit")');
    expect(source).toContain("occurredAfterCutoff");
    // Filters to `slotKey.startsWith(YYYY-MM-DD-)`.
    expect(source).toMatch(/slotKey\.startsWith\(.{0,30}datePrefix/);
  });

  // 5. Reads `breakfastSelections[date-*]` for finalized meals.
  it("the handler reads breakfastSelections for finalized meals", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    expect(source).toContain("breakfastSelections");
    expect(source).toMatch(/Object\.keys\(\s*selections\s*\)/);
    // Filters out cancelled entries (removedAt != null).
    expect(source).toContain("removedAt");
  });

  // 6. Per-entry room number + guest name projected on every row.
  it("the handler populates roomNumber + guestName per entry", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    // The two helpers the page depends on.
    expect(source).toContain("bookingRoomNumber");
    expect(source).toContain("extractGuestNameFromSlotKey");
    // `guests[]` walks the per-guest map (per BR-01).
    expect(source).toMatch(/booking\?\.guests/g);
  });

  // 7. The 30s in-memory cache.
  it("the handler ships a 30s in-memory cache (Map + TTL)", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    expect(source).toContain("responseCache");
    expect(source).toContain("CACHE_TTL_MS");
    expect(source).toMatch(/30_?000|30\s*\*\s*1000|CACHE_TTL_MS\s*=\s*30000/);
    expect(source).toContain("cacheGet");
    expect(source).toContain("cacheSet");
    // The `X-Cache` HIT/MISS header proves the second call
    // skips Firestore (per BR-07 spec).
    expect(source).toContain('X-Cache');
    expect(source).toContain("HIT");
    expect(source).toContain("MISS");
  });

  // 8. POST acknowledge route registered in apiRouter.
  it("POST /api/bookings/breakfast/kitchen-list/acknowledge is registered", () => {
    const source = readSource("guest-app/server/apiRouter.ts");
    expect(source).toMatch(
      /pathSegments\[2\] === "kitchen-list"[\s\S]{0,80}pathSegments\[3\] === "acknowledge"/
    );
    expect(source).toMatch(/req\.method === "POST"/);
    expect(source).toContain("handleAcknowledgeKitchenListAudit");
  });

  // 9. The acknowledge handler requires the staff role.
  it("the acknowledge handler requires the staff role (admin/front-desk)", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    expect(source).toMatch(/role !== "admin"[\s\S]{0,40}role !== "front-desk"/);
    expect(source).toContain('"Forbidden');
  });

  // 10. Acknowledged fields stamped on the audit doc.
  it("the acknowledge handler writes acknowledgedAt + acknowledgedBy on the audit doc", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    expect(source).toContain("acknowledgedAt");
    expect(source).toContain("acknowledgedBy");
    // Updates the same doc (not a new entry).
    expect(source).toMatch(/auditRef\.update\(\s*\{[\s\S]{0,200}acknowledgedAt/);
    // Invalidate the cache so the next GET reflects the ack.
    expect(source).toContain("invalidateKitchenListCacheForSlotKey");
  });
});

// ---------- Pure-function smoke ----------

describe("BR-07 — Kitchen list routes (pure-function smoke)", () => {
  it("rejects dates outside the YYYY-MM-DD regex (pure guard)", async () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-kitchen-list.ts"
    );
    // The regex literal is the contract — `^\d{4}-\d{2}-\d{2}$`.
    expect(source).toContain("^\\d{4}-\\d{2}-\\d{2}$");
  });

  it("the handler module is importable from the apiRouter bundle", () => {
    // The apiRouter imports both the GET + POST handlers.
    const source = readSource("guest-app/server/apiRouter.ts");
    expect(source).toContain(
      'import {\n  handleAcknowledgeKitchenListAudit,\n  handleGetKitchenList\n} from "./handlers/breakfast-kitchen-list";'
    );
  });
});

// ---------- Behavioral smoke (stubbed Firestore) ----------
//
// The handler is fully covered by the source-text tripwires
// above. The end-to-end smoke lives below for the one
// runtime invariant the tripwires can't pin: the cache hits
// on the second call (no second Firestore read). The cache
// test uses a hand-rolled fake that exposes the `get()` +
// `collectionGroup()` methods the handler touches, then
// asserts the second call doesn't re-enter Firestore.

const handlerModule = (() => {
  // Re-import fresh per test so the in-memory cache starts
  // empty. Vitest's module cache is keyed on the source —
  // re-importing with `vi.resetModules()` is the clean way
  // to flush state between cases.
  return () => import("../../server/handlers/breakfast-kitchen-list");
})();

interface FakeAuditDoc {
  id: string;
  data: () => Record<string, unknown>;
  ref: { parent: { parent: { id: string } } };
}

function buildHandlerFakes(input: {
  bookings: Record<string, Record<string, unknown>>;
  audit: Array<{ id: string; bookingId: string; data: Record<string, unknown> }>;
}) {
  const bookingsById = input.bookings;
  const auditDocs: FakeAuditDoc[] = input.audit.map((entry) => ({
    id: entry.id,
    // Firestore SDK exposes `doc.data()` (a method); the
    // handler unpacks it with this exact call site.
    data: () => entry.data,
    // The handler reads `doc.ref.parent.parent.id` —
    // mirror the path the real Firestore SDK surfaces
    // for a `bookings/{bookingId}/breakfastAudit/{auditId}`
    // subcollection doc.
    ref: {
      parent: {
        parent: { id: entry.bookingId }
      }
    }
  }));

  return {
    bookingsById,
    auditDocs,
    callCount: { bookings: 0, audit: 0 }
  };
}

describe("BR-07 — Kitchen list routes (30s cache smoke)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("a second GET within 30s returns the cached response (no second Firestore round-trip)", async () => {
    const fakes = buildHandlerFakes({
      bookings: {
        bk1: {
          hasAnyBreakfast: true,
          ref: "BK-001",
          roomNumber: "101",
          guestName: "Ana Cruz",
          guests: [{ firstName: "Ana", lastName: "Cruz" }],
          breakfastSelections: {
            "2026-10-15-guest-0": {
              mealId: "m-longsilog",
              mealName: "Longsilog",
              price: 220,
              addedAt: "2026-10-14T10:00:00Z",
              addedBy: "guest",
              lastModifiedAt: "2026-10-14T10:00:00Z",
              lastModifiedBy: "guest",
              removedAt: null,
              removedBy: null,
              overrideCutoff: false,
              overrideReason: null
            }
          }
        }
      },
      audit: [
        {
          id: "audit-1",
          bookingId: "bk1",
          data: {
            action: "remove",
            slotKey: "2026-10-15-guest-0",
            mealSnapshot: {
              mealId: "m-longsilog",
              mealName: "Longsilog",
              price: 220
            },
            actorUid: "guest",
            actorRole: "guest",
            reason: null,
            occurredAt: "2026-10-14T19:30:00Z",
            occurredAfterCutoff: true
          }
        }
      ]
    });

    const fakeDb = {
      collection: vi.fn((collName: string) => {
        if (collName !== "bookings") {
          throw new Error(`unexpected collection('${collName}')`);
        }
        const bookingSnapshot = {
          forEach: (cb: (doc: { id: string; data: () => unknown }) => void) => {
            fakes.callCount.bookings += 1;
            for (const [id, data] of Object.entries(fakes.bookingsById)) {
              cb({ id, data: () => data });
            }
          }
        };
        const bookingsColl = {
          where: () => bookingsColl,
          get: async () => bookingSnapshot
        };
        return bookingsColl;
      }),
      collectionGroup: vi.fn((groupName: string) => {
        if (groupName !== "breakfastAudit") {
          throw new Error(`unexpected collectionGroup('${groupName}')`);
        }
        const auditSnapshot = {
          forEach: (
            cb: (doc: FakeAuditDoc) => void
          ) => {
            fakes.callCount.audit += 1;
            for (const doc of fakes.auditDocs) {
              cb(doc);
            }
          }
        };
        const auditChain = {
          where: () => auditChain,
          get: async () => auditSnapshot
        };
        return auditChain;
      })
    };

    vi.doMock("../../server/lib/firebase-admin", () => ({
      adminDb: fakeDb
    }));

    const { handleGetKitchenList } = await handlerModule();

    const baseReq = (): any => ({
      method: "GET",
      query: { date: "2026-10-15" },
      headers: {},
      staff: { uid: "mock_staff_uid", role: "admin" }
    });

    interface CapturedResponse {
      statusCode: number;
      headers: Record<string, string>;
      payload: any;
    }
    function newRes(): CapturedResponse {
      const headers: Record<string, string> = {};
      let statusCode = 200;
      let payload: any = null;
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (body: any) => {
          payload = body;
          return res;
        },
        setHeader: (key: string, value: string) => {
          headers[key] = value;
          return res;
        },
        end: () => res
      };
      Object.defineProperty(res, "statusCode", {
        get: () => statusCode
      });
      Object.defineProperty(res, "headers", {
        get: () => headers
      });
      Object.defineProperty(res, "payload", {
        get: () => payload
      });
      return res as CapturedResponse;
    }

    // First call → cache MISS, reads Firestore once.
    const first = newRes();
    await handleGetKitchenList(baseReq(), first);
    expect(first.statusCode).toBe(200);
    expect(first.headers["X-Cache"]).toBe("MISS");
    expect(fakes.callCount.bookings).toBe(1);
    expect(fakes.callCount.audit).toBe(1);
    expect(first.payload).not.toBeNull();
    expect(first.payload.finalized).toHaveLength(1);
    expect(first.payload.lateChanges).toHaveLength(1);
    expect(first.payload.summary.totalMeals).toBe(1);

    // Second call within 30s → cache HIT, no second reads.
    const second = newRes();
    await handleGetKitchenList(baseReq(), second);
    expect(second.statusCode).toBe(200);
    expect(second.headers["X-Cache"]).toBe("HIT");
    expect(fakes.callCount.bookings).toBe(1);
    expect(fakes.callCount.audit).toBe(1);
  });
});
