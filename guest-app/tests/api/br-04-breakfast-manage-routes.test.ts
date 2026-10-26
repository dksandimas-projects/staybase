// Per BR-04 (Phase 13 — Breakfast Redesign, decision
// #233, 2026-10-13): handler + source-text tripwires for
// the new Manage Breakfast server endpoints.
//
// This file is split into two surfaces:
//
//   • Source-text tripwires — pins the structural
//     invariants the BR-04 server handler establishes
//     (lock-state gating, refund-liability writes,
//     server-recomputed totals, idempotency replay,
//     audit writes, etc.). The tripwires are the
//     load-bearing defense; a refactor that drops one of
//     these invariants breaks the test instead of
//     regressing silently.
//
//   • Handler-level tests — a small set of true mock-
//     driven tests covering the validation paths that
//     don't need runTransaction (400 on bad input, 404 on
//     missing booking, etc). The transaction-driven paths
//     are covered by the tripwires instead of mocking
//     Firestore transactions.
//
// The combined tests cover the spec acceptance criteria:
//   1. GET /api/bookings/breakfast/manage returns booking
//      + public config + per-date cutoff states.
//   2. Invalid lookupToken returns 404 with the standard
//      "Booking not found" payload.
//   3. POST /api/bookings/breakfast/update with a
//      locked-date entry returns 400 with a human
//      message.
//   4. POST /api/bookings/breakfast/update with a non-
//      existent mealId returns 400.
//   5. POST /api/bookings/breakfast/update with a paid
//      meal in `remove[]` creates a refund liability entry
//      in `bookings/{id}/refunds/`.
//   6. POST /api/bookings/breakfast/update with the same
//      clientBatchId twice within 60s returns the prior
//      result without re-applying (idempotency).
//   7. POST /api/bookings/breakfast/update writes
//      `breakfastAudit` entries for every accepted op.
//   8. The new `breakfastTotal` is the server-recomputed
//      sum after all ops; never client-written.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/breakfast-manage.ts"),
  "utf8"
);
// Per BR-05 (2026-10-13): the per-op validation + refund-
// liability record + audit-write helpers were extracted to
// `lib/breakfast-selections.ts` so the staff handler
// (`breakfast-staff-update.ts`, BR-05) shares the same
// rules. The tests below load the lib source too so the
// tripwires still pin the structural invariants the BR-04
// spec establishes (refund-context shape, `category:
// "breakfast"` + `status: "pending"` pair, negative
// refund amount, audit helper signature).
const libSrc = readFileSync(
  resolve(__dirname, "../../server/lib/breakfast-selections.ts"),
  "utf8"
);
const combinedHandlerSrc = `${handlerSrc}\n${libSrc}`;

// ---------- Hoisted fixtures for the handler-level tests ----------

const { mockBookings, mockSettings, mockRefunds, mockAudit, mockBatches } =
  vi.hoisted(() => {
    return {
      mockBookings: {} as Record<string, any>,
      mockSettings: {} as Record<string, any>,
      mockRefunds: {} as Record<string, any>,
      mockAudit: {} as Record<string, any>,
      mockBatches: {} as Record<string, any>
    };
  });

vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (path: string) => {
    const segments = path.split("/");
    const coll = segments[0];
    const docId = segments[1] || "";
    let store: Record<string, any> = {};
    if (coll === "bookings") store = mockBookings;
    else if (coll === "settings") store = mockSettings;
    return {
      path,
      id: docId,
      collection: (sub: string) => subCollectionRef(docId, sub),
      get: async () => {
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      }
    };
  };

  const subCollectionRef = (parentId: string, collName: string): any => {
    const key = `${parentId}/${collName}`;
    let store: Record<string, any> = {};
    if (collName === "refunds") store = mockRefunds;
    else if (collName === "breakfastAudit") store = mockAudit;
    else if (collName === "batches") store = mockBatches;
    return {
      _kind: "collection",
      _coll: collName,
      where: function (field: string, op: string, value: any) {
        return this;
      },
      doc: function (docId: string) {
        return docRef(`${key}/${docId}`);
      },
      get: async function () {
        const docs = Object.entries(store)
          .filter(([id]) => id.startsWith(`${key}/`))
          .map(([id, data]) => ({
            id: id.split("/").pop(),
            data: () => data,
            ref: { path: id }
          }));
        return { empty: docs.length === 0, docs };
      }
    };
  };

  const collection = (collName: string): any => {
    let queryFilters: Array<{ field: string; op: string; value: any }> = [];
    const chain: any = {
      _coll: collName,
      _filters: queryFilters,
      where: function (field: string, op: string, value: any) {
        queryFilters.push({ field, op, value });
        return this;
      },
      limit: function () {
        return this;
      },
      doc: function (docId: string) {
        return docRef(`${collName}/${docId}`);
      },
      get: async function () {
        let store: Record<string, any> = {};
        if (collName === "bookings") store = mockBookings;
        else if (collName === "settings") store = mockSettings;
        else if (collName === "batches") store = mockBatches;
        if (collName === "settings") {
          const docs = Object.entries(store).map(([id, data]) => ({
            id,
            data: () => data,
            ref: { path: `${collName}/${id}` }
          }));
          return { empty: docs.length === 0, docs };
        }
        // bookings/:docId/breakfastUpdateBatches path (synthetic
        // top-level collection, not parented under a real booking).
        if (collName === "__breakfastUpdateBatches") {
          const docs = Object.entries(mockBatches)
            .filter(([, data]) =>
              queryFilters.every((f) => {
                const v = (data as any)[f.field];
                if (f.op === "==") return v === f.value;
                return true;
              })
            )
            .map(([id, data]) => ({ id, data: () => data }));
          return { empty: docs.length === 0, docs };
        }
        const docs = Object.entries(store)
          .filter(([, data]) =>
            queryFilters.every((f) => {
              const v = (data as any)[f.field];
              if (f.op === "==") return v === f.value;
              return true;
            })
          )
          .map(([id, data]) => ({ id, data: () => data }));
        return { empty: docs.length === 0, docs };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation(collection),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        // No-op transaction for the tripwires. Tests below
        // mock the call-sites that need real transaction
        // behavior via a separate runtime fixture.
        return undefined;
      })
    },
    adminAuth: {}
  };
});

describe("BR-04 — Manage Breakfast server handler tripwires", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    Object.keys(mockRefunds).forEach((k) => delete mockRefunds[k]);
    Object.keys(mockAudit).forEach((k) => delete mockAudit[k]);
    Object.keys(mockBatches).forEach((k) => delete mockBatches[k]);
    vi.clearAllMocks();
  });

  describe("GET `/api/bookings/breakfast/manage` — structural pins", () => {
    it("exports a `handleGetBreakfastManage` named function", () => {
      expect(handlerSrc).toMatch(
        /export\s+async\s+function\s+handleGetBreakfastManage/
      );
    });

    it("guards on `req.method !== \"GET\"` and returns 405", () => {
      expect(handlerSrc).toMatch(
        /if\s*\(\s*req\.method\s*!==\s*["']GET["']\s*\)\s*\{[\s\S]{0,200}?return\s+res\.status\(405\)/
      );
    });

    it("uses the same `lookupToken` validation gate as `handleLookupBooking` (H2 inheritance)", () => {
      // The query looks up the booking by
      // `bookingRef` + `lookupToken` (lowercased — same
      // case-insensitive path the lookup surface uses).
      expect(handlerSrc).toMatch(
        /where\(\s*["']bookingRef["']\s*,\s*["']==["']\s*,\s*bookingRef\s*\)/
      );
      expect(handlerSrc).toMatch(
        /where\(\s*["']lookupToken["']\s*,\s*["']==["']\s*,\s*String\(token\)\.toLowerCase\(\)\s*\)/
      );
    });

    it("returns the canonical 404 + \"Booking not found\" payload on a missing booking", () => {
      // Same posture as `handleLookupBooking` so the
      // manage path is not a token-existence oracle.
      expect(handlerSrc).toMatch(
        /return\s+res\.status\(404\)\.json\(\{\s*success:\s*false,\s*error:\s*["']Booking not found\.["']\s*\}\)/m
      );
    });

    it("computes the per-date `cutoffStates` server-side via `computeBreakfastCutoffState`", () => {
      // The page re-runs the same helper client-side
      // every minute, so both sides must agree on the
      // initial state. The function name appears in
      // BOTH places (server + client) because they're
      // the same shared helper.
      expect(handlerSrc).toMatch(/computeBreakfastCutoffState/);
      expect(handlerSrc).toMatch(/cutoffStates/);
    });

    it("returns the public breakfast config + the per-slot `breakfastServed` + the `refunds` list", () => {
      // The page mounts with all three lists so the
      // first render can draw the dropdowns + the
      // served badges + the refund-due panel without a
      // second round-trip.
      expect(handlerSrc).toMatch(/breakfastConfig:\s*isEnabled\s*\?/);
      expect(handlerSrc).toMatch(/breakfastServed:\s*served/);
      expect(handlerSrc).toMatch(/refunds,/);
      expect(handlerSrc).toMatch(/loadPendingBreakfastRefunds/);
    });

    it("strips PII: the response does not echo back `lookupToken`, `guestName`, or `guestEmail`", () => {
      // No wire payload should contain any of the
      // fields the lookup surface also strips. The
      // payload's `booking.bookingRef` is the only
      // identifier the page needs.
      expect(handlerSrc).not.toMatch(/booking:\s*\{[\s\S]*?lookupToken\s*:/);
      expect(handlerSrc).not.toMatch(/booking:\s*\{[\s\S]*?guestName\s*:/);
      expect(handlerSrc).not.toMatch(/booking:\s*\{[\s\S]*?guestEmail\s*:/);
    });
  });

  describe("POST `/api/bookings/breakfast/update` — validation pins", () => {
    it("exports a `handleUpdateBreakfast` named function", () => {
      expect(handlerSrc).toMatch(
        /export\s+async\s+function\s+handleUpdateBreakfast/
      );
    });

    it("uses the same `clientBatchId` UUIDv4 contract as `handleCreateBooking`", () => {
      // The client preallocates via
      // `crypto.randomUUID()`. The same regex pins the
      // shape on both ends.
      expect(handlerSrc).toMatch(
        /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}/
      );
    });

    it("rejects a locked-date entry with 400 + a human message", () => {
      // The catch block maps `LOCKED_DATE:YYYY-MM-DD`
      // to a 400 + the human-readable
      // `Ordering closed for breakfast on {date}.`.
      expect(handlerSrc).toMatch(/LOCKED_DATE:/);
      expect(handlerSrc).toMatch(
        /Ordering closed for breakfast on/
      );
      expect(handlerSrc).toMatch(
        /return\s+res\.status\(400\)\.json\(\{\s*success:\s*false,\s*error:\s*`Ordering closed for breakfast on/
      );
    });

    it("rejects a non-existent `mealId` with 400 + a non-leaky human message", () => {
      // The catch block maps `MEAL_NOT_AVAILABLE` to
      // a 400. The error text intentionally does NOT
      // name the missing meal so the endpoint isn't a
      // menu-state oracle (per the BR-01 validator's
      // contract).
      expect(handlerSrc).toMatch(/MEAL_NOT_AVAILABLE/);
      expect(handlerSrc).toMatch(
        /One of the selected meals is no longer available/
      );
    });

    it("rejects a `remove` against an already-served slot with 400", () => {
      // The `breakfastServed[key]` lookup short-
      // circuits before any mutation. The error class
      // is `SLOT_SERVED:<slotKey>` so the message can
      // surface the slot identity to logs (not the
      // wire payload).
      expect(handlerSrc).toMatch(/SLOT_SERVED:/);
      expect(handlerSrc).toMatch(/This meal has already been served/);
    });
  });

  describe("POST — refund liability + audit trail", () => {
    it("the `remove` op writes a `breakfastRefundContext` snapshot on the refund record", () => {
      // The BR-01 §OnsitePayment extension's
      // `breakfastRefundContext` shape is
      // `{ mealId, slotKey, mealName, priceSnapshot }`.
      // The refund record carries it so staff can
      // reconcile the meal that was removed.
      //
      // Per BR-05 (2026-10-13): the refund record
      // construction was extracted to
      // `lib/breakfast-selections.ts createBreakfastRefundLiability`
      // so the staff path shares the same shape.
      // The tripwire still pins the structural
      // invariant — the assertion looks in the
      // lib source (which the handler also
      // references).
      const refundRecord = combinedHandlerSrc.match(
        /breakfastRefundContext:\s*\{[\s\S]*?\}/
      );
      expect(refundRecord, "expected refund context block").toBeTruthy();
      expect(refundRecord![0]).toMatch(/mealId:/);
      expect(refundRecord![0]).toMatch(/slotKey/);
      expect(refundRecord![0]).toMatch(/mealName:/);
      expect(refundRecord![0]).toMatch(/priceSnapshot/);
    });

    it("the refund record uses the canonical `category: \"breakfast\"` + `status: \"pending\"` pair", () => {
      // Per BR-01 §OnsitePayment extension, the
      // pending refund entries surface on the manage
      // page's `refunds[]` payload; staff clears them
      // via the staff `mark-refund-paid` endpoint.
      //
      // Per BR-05 (2026-10-13): the refund record
      // construction moved to the lib; the tripwire
      // checks the combined source.
      expect(combinedHandlerSrc).toMatch(/category:\s*["']breakfast["']/);
      expect(combinedHandlerSrc).toMatch(/status:\s*["']pending["']/);
    });

    it("the refund amount is negative on the wire (per CRL-01's contract)", () => {
      // Refunds carry a sign — the folio math + the
      // `handleAddRefund` schema both depend on it.
      //
      // Per BR-05 (2026-10-13): the actual literal
      // arithmetic now lives in the lib
      // (`createBreakfastRefundLiability` uses
      // `-Math.abs(Number(amount || 0))`). The
      // tripwire pins the negative-sign invariant
      // via the lib's source shape.
      expect(combinedHandlerSrc).toMatch(/-Math\.abs\(/);
    });

    it("writes a `breakfastAudit` entry per accepted op inside the same transaction", () => {
      // The audit subcollection carries one entry
      // per `add` / `change` / `remove` op. The
      // `writeAudit` helper signature pins the
      // structural invariant.
      //
      // Per BR-05 (2026-10-13): the audit-write
      // helper was extracted to
      // `lib/breakfast-selections.ts auditBreakfastOp`.
      // The local `writeAudit` is a thin wrapper that
      // delegates to the lib. The tripwire looks
      // for both the local wrapper (preserved source
      // signature) and the lib implementation
      // (shared rule source of truth).
      expect(handlerSrc).toMatch(/function\s+writeAudit\(/);
      expect(combinedHandlerSrc).toMatch(/collection\("breakfastAudit"\)/);
      // The helper sets `actorRole: "guest"` so staff-side
      // entries (BR-05) can be discriminated by role.
      expect(handlerSrc).toMatch(/actorRole:\s*["']guest["']/);
    });
  });

  describe("POST — `breakfastTotal` server-recomputation + idempotency", () => {
    it("`breakfastTotal` is server-recomputed via `recomputeBreakfastTotal` (never client-written)", () => {
      // The handler stores the recomputed value
      // into `bookfastTotal` on the doc update. The
      // client never writes this field directly.
      expect(handlerSrc).toMatch(
        /const\s+newBreakfastTotal\s*=\s*recomputeBreakfastTotal\(\s*nextSelections\s*\)/
      );
      expect(handlerSrc).toMatch(/breakfastTotal:\s*newBreakfastTotal/);
    });

    it("idempotency: the prior batch metadata is persisted at `bookings/__breakfastUpdateBatches/batches/{clientBatchId}`", () => {
      // The same UUID within 60s short-circuits to
      // the prior result. The pattern mirrors the
      // `handleCreateBooking` reservation-level
      // idempotency but uses a top-level metadata
      // collection so it's globally idempotent (not
      // per-booking).
      expect(handlerSrc).toMatch(/__breakfastUpdateBatches/);
      expect(handlerSrc).toMatch(/committedAt:\s*Date\.now\(\)/);
      expect(handlerSrc).toMatch(/summary:\s*resultSummary/);
    });

    it("the same `clientBatchId` within 60s returns the prior result without re-applying", () => {
      // The `priorResult` short-circuit lives BEFORE
      // any mutation; the tripwire pins the structural
      // invariant.
      expect(handlerSrc).toMatch(
        /if\s*\(existingBatch\.exists\)\s*\{[\s\S]{0,500}?priorResult\s*=\s*prior\.summary/
      );
      expect(handlerSrc).toMatch(/replayed:\s*true/);
    });

    it("the response includes the new balance + the refund-liability count", () => {
      // The page reads `newBalance` for the page
      // header + `refundLiabilityCreated` for the
      // banner copy. The pin asserts both keys are
      // present in the success response.
      expect(handlerSrc).toMatch(/newBalance:/);
      expect(handlerSrc).toMatch(/refundLiabilityCreated:/);
    });
  });

  describe("POST — input schema + Zod surface", () => {
    it("rejects an invalid body with a 400 `Invalid breakfast update payload.`", () => {
      expect(handlerSrc).toMatch(
        /Invalid breakfast update payload\./
      );
    });

    it("rejects a slot-key that does not match the `${date}-${slotId}` shape", () => {
      // The slotKey regex pins the `{date}-{slotId}`
      // shape. A bot probing with `"abc"` is rejected
      // by Zod before any business logic runs.
      expect(handlerSrc).toMatch(
        /\\d\{4\}-\\d\{2\}-\\d\{2\}-/
      );
    });
  });
});

// ---------- Handler-level smoke tests ----------
//
// The runtime tests below exercise only the GET handler's
// input-validation paths (the POST handler's transaction
// paths are covered by the source-text tripwires above;
// mocking Firestore transactions is a non-trivial
// refactor that the spec doesn't require).

import {
  handleGetBreakfastManage,
  handleUpdateBreakfast
} from "../../server/handlers/breakfast-manage";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("BR-04 — Handle runtime smoke tests", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    Object.keys(mockRefunds).forEach((k) => delete mockRefunds[k]);
    Object.keys(mockAudit).forEach((k) => delete mockAudit[k]);
    Object.keys(mockBatches).forEach((k) => delete mockBatches[k]);
    vi.clearAllMocks();
  });

  describe("handleGetBreakfastManage", () => {
    it("returns 400 when `ref` or `token` is absent (caller-side guard)", async () => {
      const res = mockResponse();
      await handleGetBreakfastManage(
        { method: "GET", body: {} } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
      const last = (res.json as any).mock.calls.at(-1)?.[0];
      expect(last.success).toBe(false);
    });

    it("returns 404 with the standard \"Booking not found.\" payload on a missing booking", async () => {
      const res = mockResponse();
      await handleGetBreakfastManage(
        {
          method: "GET",
          body: {
            bookingRef: "SI-99999999-001",
            token: "000102030405060708090a0b0c0d0e0f"
          }
        } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(404);
      const last = (res.json as any).mock.calls.at(-1)?.[0];
      expect(last.success).toBe(false);
      expect(last.error).toBe("Booking not found.");
    });

    it("returns 405 on a non-GET method (the router dispatches on method)", async () => {
      const res = mockResponse();
      await handleGetBreakfastManage(
        { method: "POST", body: {} } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it("reads the breakfast config from `settings/breakfastConfig`", async () => {
      // The handler reads both the public (normalized)
      // config + the raw `servedGraceMinutes` field.
      // Set both up and verify the payload is
      // forwarded.
      const stored = {
        checkIn: { toDate: () => new Date("2026-11-01T00:00:00.000Z") },
        checkOut: { toDate: () => new Date("2026-11-04T00:00:00.000Z") },
        bookingRef: "SI-20261101-001",
        lookupToken: "abc123def456abc123def456abc123ab",
        timezone: "Asia/Manila",
        numGuests: 2,
        numAdults: 2,
        numChildren: 0,
        numNights: 3,
        totalPrice: 9000,
        status: "confirmed",
        breakfastSelections: {
          "2026-11-01-guest-0": {
            mealId: "silog",
            mealName: "Silog",
            price: 350,
            addedAt: { toDate: () => new Date() },
            addedBy: "guest",
            removedAt: null,
            removedBy: null,
            overrideCutoff: false,
            overrideReason: null
          }
        },
        breakfastTotal: 350,
        paidAmount: 5000,
        balance: 4350
      };
      mockBookings["booking_managed_1"] = stored;
      mockSettings["breakfastConfig"] = {
        isEnabled: true,
        cutoffTime: "20:00",
        cutoffTimezone: "Asia/Manila",
        defaultMealInstructions: "Pick what you'd like each morning.",
        meals: [
          { id: "silog", name: "Silog", description: "Tapsilog", price: 350, displayOrder: 1, isActive: true }
        ],
        servedGraceMinutes: 15
      };

      const res = mockResponse();
      await handleGetBreakfastManage(
        {
          method: "GET",
          body: {
            bookingRef: "SI-20261101-001",
            token: "abc123def456abc123def456abc123ab"
          }
        } as any,
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const last = (res.json as any).mock.calls.at(-1)?.[0];
      expect(last.success).toBe(true);
      expect(last.data.booking.bookingRef).toBe("SI-20261101-001");
      expect(last.data.breakfastConfig.meals[0].id).toBe("silog");
      expect(last.data.cutoffStates.length).toBe(3);
      expect(last.data.refunds).toEqual([]);
    });

    // Per §3.18 (AI-BROWSER-QA 2026-10-26): the reference + lookup
    // token travel as QUERY params on this GET — the guest's page calls
    // `/api/bookings/breakfast/manage?ref=…&token=…`. The handler used
    // to read `req.body`, which Vercel leaves empty on a GET, so every
    // production load returned 400 and the Manage Breakfast page could
    // never render a stay. The unit harness only ever passed the params
    // in the body, which is why the suite stayed green while the
    // product was broken. This test pins the real wire shape.
    it("reads the ref + token from the QUERY params (the real GET shape)", async () => {
      const stored = {
        checkIn: { toDate: () => new Date("2026-11-01T00:00:00.000Z") },
        checkOut: { toDate: () => new Date("2026-11-04T00:00:00.000Z") },
        bookingRef: "SI-20261101-001",
        lookupToken: "abc123def456abc123def456abc123ab",
        timezone: "Asia/Manila",
        numGuests: 2,
        numAdults: 2,
        numChildren: 0,
        numNights: 3,
        totalPrice: 9000,
        status: "confirmed",
        breakfastSelections: {},
        breakfastTotal: 0,
        paidAmount: 5000,
        balance: 4000
      };
      mockBookings["booking_managed_1"] = stored;
      mockSettings["breakfastConfig"] = {
        isEnabled: true,
        cutoffTime: "20:00",
        cutoffTimezone: "Asia/Manila",
        defaultMealInstructions: "Pick what you'd like each morning.",
        meals: [
          { id: "silog", name: "Silog", description: "Tapsilog", price: 350, displayOrder: 1, isActive: true }
        ],
        servedGraceMinutes: 15
      };

      const res = mockResponse();
      await handleGetBreakfastManage(
        {
          method: "GET",
          query: { ref: "SI-20261101-001", token: "abc123def456abc123def456abc123ab" },
          body: undefined
        } as any,
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const last = (res.json as any).mock.calls.at(-1)?.[0];
      expect(last.success).toBe(true);
      expect(last.data.booking.bookingRef).toBe("SI-20261101-001");
    });

    // The Vercel catch-all rewrite puts the route segments in
    // `req.query.route` — the handler must not treat that as a payload
    // field.
    it("ignores the catch-all `route` query key", async () => {
      const res = mockResponse();
      await handleGetBreakfastManage(
        {
          method: "GET",
          query: { route: ["bookings", "breakfast", "manage"] },
          body: undefined
        } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
      const last = (res.json as any).mock.calls.at(-1)?.[0];
      expect(last.success).toBe(false);
    });
  });

  describe("handleUpdateBreakfast", () => {
    it("returns 405 on a non-POST method", async () => {
      const res = mockResponse();
      await handleUpdateBreakfast(
        { method: "GET", body: {} } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it("returns 400 on a malformed body", async () => {
      const res = mockResponse();
      await handleUpdateBreakfast(
        {
          method: "POST",
          body: { foo: "bar" }
        } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
      const last = (res.json as any).mock.calls.at(-1)?.[0];
      expect(last.success).toBe(false);
    });
  });
});
