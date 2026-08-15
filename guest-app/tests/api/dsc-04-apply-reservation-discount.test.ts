// DSC-04 (2026-08-15, switched from (c) to (a) per owner decision
// 2026-08-15): the per-room `handleApplyBookingDiscount` is
// already atomic per-booking (runTransaction at line 4963), but
// the admin client's reservation-scope apply loops
// `for (const targetId of targetIds) { fetch(...apply-discount
// ... bookingId: targetId) }` over each room. If room 1 succeeds
// and room 2 fails, the desk sees an error but room 1 is already
// discounted — partial-failure UX + manual correction needed.
//
// Owner decision 2026-08-15: option (a) — full atomic server
// endpoint. Add `handleApplyReservationDiscount` that opens one
// runTransaction, reads every child booking + the voucher
// (queries are NOT transaction-supported, so the child IDs are
// gathered OUTSIDE the transaction via the same
// `bookings.where("reservationId", "==", ...)` pattern used at
// line 471), validates the voucher cap once against the SUM of
// planned writes (usageCount + N ≤ usageCap), and writes the
// discount to every child in the same transaction. Any failure
// aborts the whole transaction — no partial state.
//
// Test discipline (per v0.264.9 retrofit + VOU-02 fix shape):
// source-text regex guards pin the contract shape at the source
// level; runtime assertions reproduce the row-builder logic
// against representative fixtures (N=3 reservation with all
// children eligible; N=3 reservation with 1 child already
// discounted; voucher cap exceeded; staff-auth gate).

import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Source-text guards: pin the contract shape at the source
// level. Pre-DSC-04, these tests fail because the handler +
// route don't exist.

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const router = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);

describe("DSC-04 — handleApplyReservationDiscount (atomic reservation-scope apply)", () => {
  test("exports the handler", () => {
    expect(handlers).toMatch(/export async function handleApplyReservationDiscount/);
  });

  test("handler signature accepts reservationId + discountType + voucherCode", () => {
    expect(handlers).toMatch(
      /export async function handleApplyReservationDiscount\(req: any, res: any\)[\s\S]{0,200}?reservationId = String\(req\.body\?\.reservationId \|\| ""\)\.trim\(\)/
    );
    expect(handlers).toMatch(
      /const requestedDiscountType = req\.body\?\.discountType[\s\S]{0,100}?requestedVoucherCode = String\(req\.body\?\.voucherCode \|\| ""\)\.trim\(\)\.toUpperCase\(\)/
    );
  });

  test("validates at least one discount type or voucher code", () => {
    expect(handlers).toMatch(
      /handleApplyReservationDiscount[\s\S]{0,800}?if \(!requestedDiscountType && !requestedVoucherCode\)[\s\S]{0,200}?Choose a government discount or enter a voucher code/
    );
  });

  test("wraps the entire apply in one runTransaction", () => {
    expect(handlers).toMatch(
      /handleApplyReservationDiscount[\s\S]{0,2000}?await adminDb\.runTransaction\(/
    );
  });

  test("queries children OUTSIDE the transaction (transactions don't support .where().get())", () => {
    // The child ID discovery must happen before the transaction
    // opens (queries are not transaction-supported in Firestore).
    // The handler reads children via a pre-transaction .get() on
    // bookings.where("reservationId", "==", reservationId), then
    // re-reads each child with transaction.get inside the
    // transaction.
    expect(handlers).toMatch(
      /handleApplyReservationDiscount[\s\S]{0,3000}?adminDb\.collection\("bookings"\)\s*\.where\("reservationId", "==", reservationId\)\s*\.get\(\)/
    );
  });

  test("re-reads every child with transaction.get inside the transaction", () => {
    expect(handlers).toMatch(
      /handleApplyReservationDiscount[\s\S]{0,4000}?for \(const ref of childRefs\)[\s\S]{0,300}?transaction\.get\(ref\)/
    );
  });

  test("validates voucher cap against SUM of planned writes (usageCount + N <= usageCap)", () => {
    // The cap check must use the SUM across all children —
    // applying N increments across N children in one transaction
    // means the cap is "usageCount + N <= usageCap", not
    // "usageCount + 1 <= usageCap" per child.
    expect(handlers).toMatch(
      /handleApplyReservationDiscount[\s\S]{0,5500}?Number\(voucherData\.usageCount \|\| 0\) \+ eligible\.length[\s\S]{0,100}?usageCap/
    );
  });

  test("writes discount to every child in the same transaction", () => {
    expect(handlers).toMatch(
      /handleApplyReservationDiscount[\s\S]{0,6500}?for \(const child of eligible\)[\s\S]{0,3500}?transaction\.update\(child\.ref, updates\)/
    );
  });

  test("increments vouchers.usageCount once (by eligible.length), not once per child", () => {
    // The cap-validated increment must be a single write — the
    // voucher doc gets ONE update with usageCount +
    // eligible.length. Pre-DSC-04 the loop called apply-discount
    // N times → N increments, which is correct for the counter
    // (spec says per-child per VOU-01 + MRB-15) — this guard
    // exists to keep the new endpoint consistent with that
    // per-child semantics.
    expect(handlers).toMatch(
      /voucherUsageCount = Number\(voucherData\.usageCount \|\| 0\) \+ eligible\.length[\s\S]{0,100}?transaction\.update\(voucherRef, \{ usageCount: voucherUsageCount/
    );
  });

  test("returns the per-child results (appliedTo + skipped) so the admin client can sync state", () => {
    expect(handlers).toMatch(
      /handleApplyReservationDiscount[\s\S]{0,5000}?appliedTo[\s\S]{0,200}?skipped/
    );
  });

  test("router exposes the endpoint under action === apply-reservation-discount and authenticates staff", () => {
    expect(router).toMatch(
      /action === "apply-reservation-discount"[\s\S]{0,300}?authenticateStaff[\s\S]{0,500}?handleApplyReservationDiscount/
    );
  });
});

// ── Runtime tests: exercise the handler against representative
// fixtures to verify the N>1 atomicity guarantee. These tests
// fail in the pre-DSC-04 state because the handler doesn't exist.

let mockRooms: Record<string, any> = {};
let mockSettings: Record<string, any> = {};
let mockVouchers: Record<string, any> = {};
let mockMembers: Record<string, any> = {};
let mockBookings: Record<string, any> = {};
let mockReservations: Record<string, any> = {};
let setCalls: any[] = [];
let updateCalls: any[] = [];
let transactionGetLog: string[] = [];
let transactionShouldFail: { reason: string } | null = null;

vi.mock("../../server/lib/resend", () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: "mock_email_id" }) } }
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const createDocRef = (path: string) => {
    const [coll, ...rest] = path.split("/");
    const docId = rest.join("/");
    return {
      id: docId,
      path,
      firestore: { valueType: true },
      get: async () => {
        transactionGetLog.push(path);
        if (coll === "rooms" && mockRooms[docId]) {
          return { exists: true, id: docId, data: () => mockRooms[docId] };
        }
        if (coll === "settings" && mockSettings[docId]) {
          return { exists: true, id: docId, data: () => mockSettings[docId] };
        }
        if (coll === "vouchers" && mockVouchers[docId]) {
          return { exists: true, id: docId, data: () => mockVouchers[docId] };
        }
        if (coll === "members" && mockMembers[docId]) {
          return { exists: true, id: docId, data: () => mockMembers[docId] };
        }
        if (coll === "bookings" && mockBookings[docId]) {
          return { exists: true, id: docId, data: () => mockBookings[docId] };
        }
        if (coll === "reservations" && mockReservations[docId]) {
          return { exists: true, id: docId, data: () => mockReservations[docId] };
        }
        return { exists: false };
      },
      collection: (sub: string) => ({
        add: async (data: any) => {
          setCalls.push({ path: `${path}/${sub}`, data });
          return { id: `mock_${sub}_id` };
        }
      })
    };
  };

  return {
    adminDb: {
      collection: (coll: string) => ({
        doc: (id: string) => createDocRef(`${coll}/${id}`),
        where: (_field: string, _op: string, value: any) => ({
          get: async () => {
            if (coll === "bookings") {
              const docs = Object.entries(mockBookings)
                .filter(([_, b]) => b.reservationId === value)
                .map(([id, data]) => ({
                  id,
                  ref: createDocRef(`bookings/${id}`),
                  data: () => data
                }));
              return { empty: docs.length === 0, docs };
            }
            return { empty: true, docs: [] };
          }
        })
      }),
      runTransaction: async (fn: any) => {
        transactionGetLog = [];
        const transaction = {
          get: async (ref: any) => {
            transactionGetLog.push(ref.path);
            const result = await ref.get();
            if (transactionShouldFail && transactionGetLog.length > 1) {
              throw new Error(transactionShouldFail.reason);
            }
            return result;
          },
          update: (ref: any, data: any) => {
            if (transactionShouldFail) {
              throw new Error(transactionShouldFail.reason);
            }
            updateCalls.push({ path: ref.path, data });
            // Mirror the write into the mock so the next get sees it
            const [coll, docId] = ref.path.split("/");
            if (coll === "bookings" && mockBookings[docId]) {
              mockBookings[docId] = { ...mockBookings[docId], ...data };
            } else if (coll === "vouchers" && mockVouchers[docId]) {
              mockVouchers[docId] = { ...mockVouchers[docId], ...data };
            }
          },
          set: (ref: any, data: any) => {
            updateCalls.push({ path: ref.path, data, op: "set" });
          }
        };
        return fn(transaction);
      }
    },
    adminAuth: {
      verifyIdToken: async () => ({ uid: "staff_uid", admin: true })
    }
  };
});

const seedFixtures = () => {
  mockRooms = {
    "room_101": { id: "room_101", roomType: "standard-double", maxCapacity: 2 },
    "room_102": { id: "room_102", roomType: "standard-double", maxCapacity: 2 }
  };
  mockSettings = {
    hotelConfig: {
      roomTypes: [
        {
          value: "standard-double",
          pricePerNight: 2000,
          weekendRate: 2500,
          corporateRate: 1800,
          applicableRoomTypes: ["standard-double"]
        }
      ],
      seniorPwdOnlineEnabled: true
    }
  };
  mockVouchers = {
    "WELCOME10": {
      code: "WELCOME10",
      isActive: true,
      usageCount: 5,
      usageCap: 100,
      applicableRoomTypes: [],
      discountType: "percent",
      discountValue: 10
    }
  };
  mockMembers = {};
  mockReservations = {
    "res_001": {
      id: "res_001",
      reservationRef: "SI-20260815-00001",
      createdAt: new Date()
    }
  };
  mockBookings = {
    "bk_001": {
      id: "bk_001",
      bookingRef: "SI-20260815-00001",
      reservationId: "res_001",
      reservationRef: "SI-20260815-00001",
      reservationPosition: 1,
      roomId: "room_101",
      roomType: "standard-double",
      checkIn: "2026-08-20",
      checkOut: "2026-08-22",
      guests: 2,
      status: "confirmed",
      originalTotalPrice: 4000,
      totalPrice: 4000,
      memberDiscountPct: 0,
      pointsRedeemedValue: 0,
      rateBreakdown: {
        roomLines: [{ source: "regular", label: "Regular nights", startDate: "2026-08-20", endDate: "2026-08-21", nights: 2, nightlyRate: 2000, subtotal: 4000 }],
        roomSubtotal: 4000,
        addOns: []
      }
    },
    "bk_002": {
      id: "bk_002",
      bookingRef: "SI-20260815-00001",
      reservationId: "res_001",
      reservationRef: "SI-20260815-00001",
      reservationPosition: 2,
      roomId: "room_102",
      roomType: "standard-double",
      checkIn: "2026-08-20",
      checkOut: "2026-08-22",
      guests: 2,
      status: "confirmed",
      originalTotalPrice: 4000,
      totalPrice: 4000,
      memberDiscountPct: 0,
      pointsRedeemedValue: 0,
      rateBreakdown: {
        roomLines: [{ source: "regular", label: "Regular nights", startDate: "2026-08-20", endDate: "2026-08-21", nights: 2, nightlyRate: 2000, subtotal: 4000 }],
        roomSubtotal: 4000,
        addOns: []
      }
    },
    "bk_003": {
      id: "bk_003",
      bookingRef: "SI-20260815-00001",
      reservationId: "res_001",
      reservationRef: "SI-20260815-00001",
      reservationPosition: 3,
      roomId: "room_101",
      roomType: "standard-double",
      checkIn: "2026-08-20",
      checkOut: "2026-08-22",
      guests: 2,
      status: "confirmed",
      originalTotalPrice: 4000,
      totalPrice: 4000,
      memberDiscountPct: 0,
      pointsRedeemedValue: 0,
      discountType: "senior", // already discounted — should be skipped
      voucherCode: "",
      rateBreakdown: {
        roomLines: [{ source: "regular", label: "Regular nights", startDate: "2026-08-20", endDate: "2026-08-21", nights: 2, nightlyRate: 2000, subtotal: 4000 }],
        roomSubtotal: 4000,
        addOns: []
      }
    }
  };
  setCalls = [];
  updateCalls = [];
  transactionGetLog = [];
  transactionShouldFail = null;
};

// The handler is imported lazily so the test can fail clearly
// when the handler does not exist yet (TDD).
async function getHandler(): Promise<any> {
  try {
    const mod = await import("../../server/handlers/bookings");
    return (mod as any).handleApplyReservationDiscount;
  } catch (e: any) {
    throw new Error(`handleApplyReservationDiscount import failed: ${e.message}`);
  }
}

async function callHandler(body: any, mockResponse: any) {
  const handler = await getHandler();
  const req = {
    method: "POST",
    body,
    staff: { uid: "staff_uid" }
  };
  const res = mockResponse();
  await handler(req, res);
  return res;
}

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
};

describe("DSC-04 — handleApplyReservationDiscount runtime", () => {
  beforeEach(() => {
    seedFixtures();
    vi.clearAllMocks();
  });

  test("applies a voucher to all eligible children atomically (N=3, 2 eligible)", async () => {
    // 3 children in res_001; bk_003 already has discountType
    // set (ineligible). The endpoint must apply to bk_001 +
    // bk_002 (2 children) and report bk_003 in the `skipped`
    // list. Voucher usageCount goes from 5 to 7 (5 + 2).
    const res = await callHandler(
      { reservationId: "res_001", voucherCode: "WELCOME10" },
      mockResponse
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.appliedTo.sort()).toEqual(["bk_001", "bk_002"]);
    expect(payload.data.skipped).toContain("bk_003");

    // Voucher increment: 5 + 2 = 7
    const voucherWrite = updateCalls.find((c) => c.path === "vouchers/WELCOME10");
    expect(voucherWrite).toBeDefined();
    expect(voucherWrite.data.usageCount).toBe(7);

    // Both eligible children updated
    const childWrites = updateCalls.filter((c) => c.path.startsWith("bookings/bk_00"));
    expect(childWrites.map((c) => c.path).sort()).toEqual([
      "bookings/bk_001",
      "bookings/bk_002"
    ]);
  });

  test("rolls back the entire transaction when one child fails validation", async () => {
    // Force the transaction to fail after the first child
    // read. The reservation doc was read first (success), then
    // a child read triggers the throw. No writes should land.
    // We use a non-404 message ("Booking pricing data is
    // incomplete.") so the catch block returns 400 — the
    // semantic meaning is the same (the transaction was
    // aborted, no writes landed) regardless of which error
    // triggered the rollback.
    transactionShouldFail = { reason: "Booking pricing data is incomplete." };
    const res = await callHandler(
      { reservationId: "res_001", voucherCode: "WELCOME10" },
      mockResponse
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    // No writes landed
    expect(updateCalls).toHaveLength(0);
  });

  test("rejects when the voucher cap would be exceeded by N children", async () => {
    // Pre-set usageCount = 99, usageCap = 100. 2 eligible
    // children would push usageCount to 101 (exceeds cap).
    mockVouchers["WELCOME10"].usageCount = 99;
    const res = await callHandler(
      { reservationId: "res_001", voucherCode: "WELCOME10" },
      mockResponse
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    // No child writes landed
    expect(updateCalls.filter((c) => c.path.startsWith("bookings/"))).toHaveLength(0);
  });

  test("N=1 reservation behaves byte-equivalent to the existing apply-discount endpoint", async () => {
    // Spin up a 1-child reservation and apply. The result
    // shape should be the same as a successful
    // apply-discount (single bookingRef in appliedTo, usageCount
    // incremented by 1).
    mockReservations["res_solo"] = { id: "res_solo", reservationRef: "SI-SOLO-001" };
    mockBookings["bk_solo"] = {
      ...mockBookings["bk_001"],
      id: "bk_solo",
      reservationId: "res_solo",
      reservationPosition: 1
    };
    delete mockBookings["bk_002"];
    delete mockBookings["bk_003"];
    mockVouchers["WELCOME10"].usageCount = 5;

    const res = await callHandler(
      { reservationId: "res_solo", voucherCode: "WELCOME10" },
      mockResponse
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.appliedTo).toEqual(["bk_solo"]);
    expect(payload.data.skipped).toEqual([]);

    const voucherWrite = updateCalls.find((c) => c.path === "vouchers/WELCOME10");
    expect(voucherWrite.data.usageCount).toBe(6); // 5 + 1
  });

  test("rejects when no reservationId is provided", async () => {
    const res = await callHandler(
      { voucherCode: "WELCOME10" },
      mockResponse
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/reservation/i);
  });

  test("rejects when neither discountType nor voucherCode is provided", async () => {
    const res = await callHandler(
      { reservationId: "res_001" },
      mockResponse
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/Choose a government discount or enter a voucher code/);
  });
});
