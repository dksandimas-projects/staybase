// Per BR-07 P0/P1/P2 (2026-10-22): REGRESSION tests for the
// three kitchen-list defects that shipped.
//
//   P0 — the kitchen list was permanently empty in production.
//        The handler filtered on `where("hasAnyBreakfast",
//        "==", true)`, but the walk-in write path never wrote
//        that flag, so the query matched ZERO bookings and the
//        chef's sheet was empty on every service date.
//
//   P1 — the slot keys. The guest app wrote `<date>-guest-0`
//        (0-based) while every admin read path looked up
//        `<date>-guest-1` (1-based). The kitchen list also had
//        to read the two legacy key forms that live in
//        production (the bare `<date>-N` form and the legacy
//        1-based `<date>-guest-N` form).
//
//   P2 — the kitchen list hard-coded the DEFAULT cut-off time
//        + timezone while the guest view and the staff view
//        read the CONFIGURED ones.
//
// The fake Firestore below EMULATES the real query semantics
// (`where(field, "==", value)` really filters), so a handler
// that filters on a denormalized flag it should not depend on
// genuinely returns zero rows — which is exactly how the
// feature shipped broken.

import { describe, it, expect, vi, beforeEach } from "vitest";

const handlerModule = () => import("../../server/handlers/breakfast-kitchen-list");

interface FakeBooking {
  id: string;
  data: Record<string, unknown>;
}

function mealEntry(mealId: string, mealName: string) {
  return {
    mealId,
    mealName,
    price: 100,
    addedAt: "2026-11-01T00:00:00.000Z",
    addedBy: "guest",
    lastModifiedAt: "2026-11-01T00:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: null,
    removedBy: null,
    overrideCutoff: false,
    overrideReason: null
  };
}

function removedMealEntry(mealId: string, mealName: string) {
  return {
    ...mealEntry(mealId, mealName),
    removedAt: "2026-10-21T10:37:48.226Z",
    removedBy: "staff"
  };
}

/**
 * Build a fake `adminDb` whose `where()` really filters — so a
 * handler that reads a denormalized flag gets the same empty
 * result production gave it.
 */
function buildFakeDb(input: {
  bookings: FakeBooking[];
  audit?: Array<{ id: string; bookingId: string; data: Record<string, unknown> }>;
  settings?: Record<string, unknown> | null;
}) {
  const callCount = { bookings: 0, audit: 0, settings: 0 };

  const bookingsColl: any = {
    where: (field: string, _op: string, value: unknown) => ({
      where: bookingsColl.where,
      get: async () => {
        callCount.bookings += 1;
        const matched = input.bookings.filter(
          (b) => (b.data as any)[field] === value
        );
        return {
          forEach: (cb: (doc: { id: string; data: () => unknown }) => void) => {
            for (const b of matched) cb({ id: b.id, data: () => b.data });
          }
        };
      }
    }),
    get: async () => {
      callCount.bookings += 1;
      return {
        forEach: (cb: (doc: { id: string; data: () => unknown }) => void) => {
          for (const b of input.bookings) cb({ id: b.id, data: () => b.data });
        }
      };
    }
  };

  const settingsColl: any = {
    doc: (_docId: string) => ({
      get: async () => {
        callCount.settings += 1;
        return {
          exists: input.settings !== undefined && input.settings !== null,
          data: () => input.settings ?? null
        };
      }
    })
  };

  const auditDocs = (input.audit ?? []).map((entry) => ({
    id: entry.id,
    data: () => entry.data,
    ref: { parent: { parent: { id: entry.bookingId } } }
  }));

  const auditChain: any = {
    where: () => auditChain,
    get: async () => {
      callCount.audit += 1;
      return {
        forEach: (cb: (doc: any) => void) => {
          for (const doc of auditDocs) cb(doc);
        }
      };
    }
  };

  const fakeDb = {
    collection: (name: string) => {
      if (name === "bookings") return bookingsColl;
      if (name === "settings") return settingsColl;
      throw new Error(`unexpected collection('${name}')`);
    },
    collectionGroup: (name: string) => {
      if (name !== "breakfastAudit") {
        throw new Error(`unexpected collectionGroup('${name}')`);
      }
      return auditChain;
    }
  };

  return { fakeDb, callCount };
}

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
  Object.defineProperty(res, "statusCode", { get: () => statusCode });
  Object.defineProperty(res, "headers", { get: () => headers });
  Object.defineProperty(res, "payload", { get: () => payload });
  return res as CapturedResponse;
}

function staffReq(date: string): any {
  return {
    method: "GET",
    query: { date },
    headers: {},
    staff: { uid: "mock_staff_uid", role: "admin" }
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function runKitchenList(
  input: Parameters<typeof buildFakeDb>[0],
  date: string
): Promise<CapturedResponse> {
  const { fakeDb } = buildFakeDb(input);
  vi.doMock("../../server/lib/firebase-admin", () => ({ adminDb: fakeDb }));
  const { handleGetKitchenList } = await handlerModule();
  const res = newRes();
  await handleGetKitchenList(staffReq(date), res);
  return res;
}

// ---------------------------------------------------------------------------
// P0 — the kitchen list must not depend on the denormalized flag
// ---------------------------------------------------------------------------

describe("BR-07 P0 — the kitchen list returns meals for a walk-in-shaped booking", () => {
  it("returns the meals when the booking has NO `hasAnyBreakfast` flag (the walk-in shape)", async () => {
    // The walk-in write path (`guest-app/server/handlers/bookings.ts`)
    // persists `breakfastSelections` + `breakfastTotal` and — before
    // this fix — NOTHING else. The fixture below is byte-for-byte that
    // shape: no `hasAnyBreakfast` key at all.
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-walkin-1",
            data: {
              ref: "BK-001",
              roomNumber: "101",
              guestName: "Ana Cruz",
              numGuests: 1,
              guests: [{ firstName: "Ana", lastName: "Cruz" }],
              // NOTE: no `hasAnyBreakfast` — exactly what the
              // walk-in path writes.
              breakfastTotal: 100,
              breakfastSelections: {
                "2026-11-05-0": mealEntry("tapsilog", "Tapsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-11-05"
    );

    expect(res.statusCode).toBe(200);
    expect(res.payload.finalized).toHaveLength(1);
    expect(res.payload.finalized[0].mealName).toBe("Tapsilog");
    expect(res.payload.finalized[0].bookingId).toBe("bk-walkin-1");
    expect(res.payload.summary.totalMeals).toBe(1);
    expect(res.payload.summary.byMeal).toEqual({ Tapsilog: 1 });
  });

  it("returns the meals when the booking carries `hasAnyBreakfast: false`", async () => {
    // The flag is NOT authoritative — the per-slot `removedAt` is.
    // A booking whose flag says "no breakfast" but whose slot was
    // never removed still has a meal to cook.
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-flag-false",
            data: {
              ref: "BK-002",
              roomNumber: "102",
              guestName: "Bea Reyes",
              numGuests: 1,
              guests: [{ firstName: "Bea", lastName: "Reyes" }],
              hasAnyBreakfast: false,
              breakfastTotal: 100,
              breakfastSelections: {
                "2026-11-05-0": mealEntry("longsilog", "Longsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-11-05"
    );

    expect(res.payload.finalized).toHaveLength(1);
    expect(res.payload.summary.totalMeals).toBe(1);
  });

  it("returns every meal across every service date (the production shape)", async () => {
    // Production: 4 bookings carry live breakfast selections across
    // 6 service dates (11 meals). All four lack the flag.
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-a",
            data: {
              ref: "BK-A",
              roomNumber: "201",
              guestName: "Ana Cruz",
              numGuests: 2,
              guests: [],
              breakfastTotal: 400,
              breakfastSelections: {
                "2026-11-03-guest-1": mealEntry("tapsilog", "Tapsilog"),
                "2026-11-03-guest-2": mealEntry("tapsilog", "Tapsilog"),
                "2026-11-04-guest-1": mealEntry("tapsilog", "Tapsilog"),
                "2026-11-04-guest-2": mealEntry("tapsilog", "Tapsilog")
              }
            }
          },
          {
            id: "bk-b",
            data: {
              ref: "BK-B",
              roomNumber: "202",
              guestName: "Bea Reyes",
              numGuests: 2,
              guests: [],
              breakfastTotal: 400,
              breakfastSelections: {
                "2026-11-05-0": mealEntry("tapsilog", "Tapsilog"),
                "2026-11-05-1": mealEntry("longsilog", "Longsilog"),
                "2026-11-06-0": mealEntry("cornsilog", "Cornsilog"),
                "2026-11-06-1": mealEntry("hotsilog", "Hotsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-11-03"
    );

    expect(res.payload.finalized).toHaveLength(2);
    expect(res.payload.summary.totalMeals).toBe(2);
    expect(res.payload.summary.byMeal).toEqual({ Tapsilog: 2 });
  });
});

// ---------------------------------------------------------------------------
// P0 — a CANCELLED booking's meals must NOT reappear
// ---------------------------------------------------------------------------

describe("BR-07 P0 — a cancelled booking's meals do not come back", () => {
  it("skips a booking whose slots were removed (the cancel path)", async () => {
    // The cancel path writes `hasAnyBreakfast: false` +
    // `breakfastTotal: 0` and marks every slot `removedAt`.
    // Production has three such bookings (2026-10-22 / 2026-10-23).
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-cancelled",
            data: {
              ref: "BK-CANCEL",
              roomNumber: "303",
              guestName: "Cai Santos",
              status: "cancelled",
              numGuests: 2,
              guests: [],
              hasAnyBreakfast: false,
              breakfastTotal: 0,
              breakfastSelections: {
                "2026-10-22-0": removedMealEntry("tapsilog", "Tapsilog"),
                "2026-10-22-1": removedMealEntry("longsilog", "Longsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-10-22"
    );

    expect(res.payload.finalized).toHaveLength(0);
    expect(res.payload.summary.totalMeals).toBe(0);
    expect(res.payload.summary.byMeal).toEqual({});
  });

  it("shows the live booking's meal and NOT the cancelled booking's meal on the same date", async () => {
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-live",
            data: {
              ref: "BK-LIVE",
              roomNumber: "101",
              guestName: "Ana Cruz",
              numGuests: 1,
              guests: [],
              breakfastTotal: 100,
              breakfastSelections: {
                "2026-10-22-0": mealEntry("tapsilog", "Tapsilog")
              }
            }
          },
          {
            id: "bk-cancelled",
            data: {
              ref: "BK-CANCEL",
              roomNumber: "303",
              guestName: "Cai Santos",
              status: "cancelled",
              numGuests: 1,
              guests: [],
              hasAnyBreakfast: false,
              breakfastTotal: 0,
              breakfastSelections: {
                "2026-10-22-0": removedMealEntry("longsilog", "Longsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-10-22"
    );

    expect(res.payload.finalized).toHaveLength(1);
    expect(res.payload.finalized[0].bookingId).toBe("bk-live");
    expect(res.payload.summary.totalMeals).toBe(1);
    expect(res.payload.summary.byMeal).toEqual({ Tapsilog: 1 });
  });
});

// ---------------------------------------------------------------------------
// P1 — the slot keys resolve to the right guest
// ---------------------------------------------------------------------------

describe("BR-07 P1 — the kitchen list resolves every slot-key form", () => {
  it("reads the legacy bare `<date>-N` form and attributes it to the right guest", async () => {
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-bare",
            data: {
              ref: "BK-BARE",
              roomNumber: "404",
              guestName: "Dee Lim",
              numGuests: 2,
              guests: [
                { firstName: "Dee", lastName: "Lim" },
                { firstName: "Eve", lastName: "Lim" }
              ],
              breakfastTotal: 200,
              breakfastSelections: {
                "2026-11-05-0": mealEntry("tapsilog", "Tapsilog"),
                "2026-11-05-1": mealEntry("longsilog", "Longsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-11-05"
    );

    expect(res.payload.finalized).toHaveLength(2);
    const byIndex = [...res.payload.finalized].sort(
      (a: any, b: any) => a.guestIndex - b.guestIndex
    );
    // The bare form is 0-based → `-0` is the FIRST guest.
    expect(byIndex[0].guestIndex).toBe(0);
    expect(byIndex[0].guestName).toBe("Dee Lim");
    expect(byIndex[0].mealName).toBe("Tapsilog");
    expect(byIndex[1].guestIndex).toBe(1);
    expect(byIndex[1].guestName).toBe("Eve Lim");
    expect(byIndex[1].mealName).toBe("Longsilog");
  });

  it("reads the legacy 1-based `<date>-guest-N` form and shifts it down", async () => {
    // The pre-fix admin app wrote `guest-1` … `guest-n`. Production
    // has one such booking (`A1FI02Addon00001`, numGuests=2).
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-legacy-1based",
            data: {
              ref: "BK-LEGACY",
              roomNumber: "505",
              guestName: "Fay Tan",
              numGuests: 2,
              guests: [
                { firstName: "Fay", lastName: "Tan" },
                { firstName: "Gus", lastName: "Tan" }
              ],
              breakfastTotal: 200,
              breakfastSelections: {
                "2026-11-06-guest-1": mealEntry("tapsilog", "Tapsilog"),
                "2026-11-06-guest-2": mealEntry("longsilog", "Longsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-11-06"
    );

    expect(res.payload.finalized).toHaveLength(2);
    const byIndex = [...res.payload.finalized].sort(
      (a: any, b: any) => a.guestIndex - b.guestIndex
    );
    expect(byIndex[0].guestIndex).toBe(0);
    expect(byIndex[0].guestName).toBe("Fay Tan");
    expect(byIndex[1].guestIndex).toBe(1);
    expect(byIndex[1].guestName).toBe("Gus Tan");
  });

  it("does NOT count the same guest twice when a booking mixes the two forms", async () => {
    const res = await runKitchenList(
      {
        bookings: [
          {
            id: "bk-mixed",
            data: {
              ref: "BK-MIXED",
              roomNumber: "606",
              guestName: "Hal Uy",
              numGuests: 1,
              guests: [],
              breakfastTotal: 100,
              breakfastSelections: {
                "2026-11-07-0": mealEntry("tapsilog", "Tapsilog"),
                "2026-11-07-guest-0": mealEntry("longsilog", "Longsilog")
              }
            }
          }
        ],
        settings: { cutoffsEnabled: true, cutoffTime: "20:00", cutoffTimezone: "Asia/Manila" }
      },
      "2026-11-07"
    );

    expect(res.payload.finalized).toHaveLength(1);
    expect(res.payload.summary.totalMeals).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P2 — the CONFIGURED cut-off
// ---------------------------------------------------------------------------

describe("BR-07 P2 — the kitchen list uses the CONFIGURED cut-off", () => {
  it("computes the cut-off from the configured TIME, not the built-in default", async () => {
    const res = await runKitchenList(
      {
        bookings: [],
        settings: {
          cutoffsEnabled: true,
          cutoffTime: "18:00",
          cutoffTimezone: "Asia/Manila"
        }
      },
      "2026-11-05"
    );

    // Cut-off = (serviceDate − 1 day) at the configured time in the
    // configured zone → 2026-11-04 18:00 Manila = 2026-11-04 10:00 UTC.
    // The built-in default (20:00 Manila) would give 12:00 UTC.
    expect(res.payload.cutoffAt).toBe("2026-11-04T10:00:00.000Z");
  });

  it("computes the cut-off from the configured TIMEZONE, not the built-in default", async () => {
    const res = await runKitchenList(
      {
        bookings: [],
        settings: {
          cutoffsEnabled: true,
          cutoffTime: "20:00",
          cutoffTimezone: "Asia/Tokyo"
        }
      },
      "2026-11-05"
    );

    // 20:00 Asia/Tokyo (UTC+9) = 11:00 UTC. The default zone
    // (Asia/Manila, UTC+8) would give 12:00 UTC.
    expect(res.payload.cutoffAt).toBe("2026-11-04T11:00:00.000Z");
  });

  it("falls back to the built-in default when the settings doc is missing", async () => {
    const res = await runKitchenList(
      { bookings: [], settings: null },
      "2026-11-05"
    );

    // 20:00 Asia/Manila = 12:00 UTC.
    expect(res.payload.cutoffAt).toBe("2026-11-04T12:00:00.000Z");
  });

  it("honours the configured `cutoffsEnabled: false` toggle", async () => {
    const res = await runKitchenList(
      {
        bookings: [],
        settings: {
          cutoffsEnabled: false,
          cutoffTime: "18:00",
          cutoffTimezone: "Asia/Manila"
        }
      },
      "2026-11-05"
    );

    expect(res.payload.cutoffPassed).toBe(false);
    // The cut-off instant is still computed from the CONFIGURED time.
    expect(res.payload.cutoffAt).toBe("2026-11-04T10:00:00.000Z");
  });
});
