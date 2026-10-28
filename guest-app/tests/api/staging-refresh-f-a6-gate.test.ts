import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── F-A6: the staging-refresh gate must ACCEPT a genuine production
// export and REJECT a tampered one ─────────────────────────────────────
//
// WHY THIS SUITE EXISTS
// ----------------------
// The staging-refresh import names `scripts/export-prod-data.mjs`, which
// does not exist — so the whole refresh workflow was a dead end. The
// exporter now exists (scripts/qa/export-prod-data.ts) and it faithfully
// reads the production money ledger out of the Firestore SUBCOLLECTIONS
// (reservations/{rid}/payments, .../refunds, .../charges), which means
// the payload it produces looks NOTHING like the shape the gate used to
// expect:
//
//   * the money rides in `onsitePayments[]` / `addedCharges[]`, not in
//     embedded `payments[]`;
//   * `balanceDue` is COMPUTED by the shared canonical folio helper
//     (totalPrice + otherAddOnTotal + charges + store − collected), and
//     a refund that has not been paid out is a LIABILITY, so it does not
//     reduce the collected total;
//   * 0 of 157 production bookings carry a `balanceDue` field at all.
//
// The old gate compared `sum(balanceDue || totalPrice)` against
// `sum(payments) - sum(refunds)` — two GLOBAL sums. For a real export
// that is not merely wrong, it is unsatisfiable: the global sums cannot
// see a per-booking error that two bookings cancel out, and the
// comparison rejects a payload whose per-booking money is perfect.
//
// These tests pin the corrected semantics:
//
//   1. a GENUINE production-shaped export is ACCEPTED (the gate does
//      not reject a correct payload);
//   2. a TAMPERED export is REJECTED — a payment amount edited in the
//      payload no longer reconciles with the declared `balanceDue`;
//   3. the check is PER BOOKING, so a compensating error in one booking
//      cannot be masked by another;
//   4. a PENDING refund does not reduce collected money (the liability
//      rule), a PAID one does;
//   5. the denylist scan runs on the payload that is actually WRITTEN
//      (the sanitized one), so a genuine export — whose SOURCE fields
//      legitimately contain real gmail addresses and phones — is not
//      rejected, while a leak in the sanitizer is still caught.
//
// The server is mocked to keep the test pure-JS.

const { mockGet, mockCollection, mockSet, mockSetSnapshots, mockUpdate } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockCollection = vi.fn();
  const mockSet = vi.fn();
  const mockSetSnapshots = vi.fn();
  const mockUpdate = vi.fn();
  return { mockGet, mockCollection, mockSet, mockSetSnapshots, mockUpdate };
});

let lastSnapshotSet: { ref: any; data: any } | null = null;
let lastSnapshotUpdate: { ref: any; data: any } | null = null;

function installDefaultMock() {
  const makeDoc = (collectionName: string, docId: string) => {
    const path = `${collectionName}/${docId}`;
    const ref = { id: docId, path };
    return {
      ...ref,
      get: mockGet,
      set: (...args: any[]) => {
        if (path.includes("refresh-snapshots")) {
          lastSnapshotSet = { ref, data: args[0] };
          mockSetSnapshots(...args);
        } else {
          mockSet(...args);
        }
        return Promise.resolve();
      },
      update: (...args: any[]) => {
        if (path.includes("refresh-snapshots")) {
          lastSnapshotUpdate = { ref, data: args[0] };
          mockUpdate(...args);
        }
        return Promise.resolve();
      },
      delete: vi.fn(),
      collection: (sub: string) => ({
        doc: (subId: string) => makeDoc(path, subId)
      })
    };
  };

  mockCollection.mockImplementation((collectionName: string) => ({
    get: mockGet,
    doc: (docId: string) => makeDoc(collectionName, docId),
    where: () => ({ get: mockGet, limit: () => ({ get: mockGet }) }),
    limit: () => ({ get: mockGet, startAfter: () => ({ get: mockGet }) })
  }));
}

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: mockCollection,
    collectionGroup: mockCollection,
    runTransaction: async (fn: any) => fn({ get: mockGet, set: vi.fn(), update: vi.fn(), delete: vi.fn() })
  },
  adminAuth: {},
  adminStorage: {}
}));

let currentProjectId = "spark-inn-stg-7a7ad";
let stagingAllowlist = "spark-inn-stg-7a7ad,spark-inn-staging-preview";
vi.stubEnv("FIREBASE_PROJECT_ID", currentProjectId);
vi.stubEnv("STAGING_ALLOWLIST_PROJECT_IDS", stagingAllowlist);

import { handleStagingRefreshPreview, handleStagingRefreshImport } from "../../server/handlers/test-runs";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const adminReq = (overrides: any = {}) => ({
  method: "POST",
  staff: { uid: "admin_1", email: "admin@sparkinn.com", role: "admin" },
  body: {
    export: {
      bookings: [],
      storeOrders: [],
      members: []
    },
    options: { mode: "sanitized-snapshot", snapshotNote: "F-A6 acceptance" },
    ...(overrides.body || {})
  }
});

/**
 * A production-shaped export: the money rides in the subcollection-
 * derived `onsitePayments` / `addedCharges` arrays, `balanceDue` is
 * computed, and the SOURCE fields carry the real PII that production
 * genuinely has (a gmail address, a PH phone, a production storage URL).
 */
function genuineExport(overrides: any = {}) {
  return {
    bookings: [
      {
        id: "A2FD10Walkin0001",
        bookingRef: "SI-20261021-00042",
        guestName: "Real Guest",
        guestEmail: "realguest@gmail.com",
        guestPhone: "09171234567",
        guestIdPhotoUrl: "https://firebasestorage.googleapis.com/v0/b/x/guest.jpg",
        paymentProofUrl: "https://firebasestorage.googleapis.com/v0/b/x/proof.jpg",
        status: "checked-out",
        totalPrice: 5400,
        otherAddOnTotal: 0,
        // The canonical folio balance: 5400 bill − 5400 collected = 0.
        balanceDue: 0,
        // The ledger, read out of reservations/{rid}/payments.
        onsitePayments: [
          {
            id: "A2FD10PayGcash01",
            type: "payment",
            amount: 5400,
            method: "gcash",
            status: "",
            recordedAt: "2026-10-21T04:12:00.000Z",
            category: ""
          }
        ],
        addedCharges: []
      },
      {
        id: "A2FD11Walkin0001",
        bookingRef: "SI-20261021-00043",
        guestName: "Other Guest",
        guestEmail: "otherguest@yahoo.com",
        guestPhone: "09181234567",
        status: "checked-out",
        totalPrice: 5000,
        otherAddOnTotal: 0,
        // 5000 bill, 5000 collected, PLUS a 300 charge that is still
        // owed → 300 outstanding.
        balanceDue: 300,
        onsitePayments: [
          {
            id: "A2FD11PayCash01",
            type: "payment",
            amount: 5000,
            method: "cash",
            status: "",
            recordedAt: "2026-10-21T05:00:00.000Z",
            category: ""
          }
        ],
        addedCharges: [
          {
            id: "A2FD11Charge01",
            label: "Late checkout fee",
            amount: 300,
            category: "late-checkout"
          }
        ]
      }
    ],
    storeOrders: [],
    members: [],
    ...overrides
  };
}

describe("/api/test-runs/staging-refresh (F-A6 — the gate accepts a genuine production export)", () => {
  beforeEach(() => {
    installDefaultMock();
    lastSnapshotSet = null;
    lastSnapshotUpdate = null;
    mockGet.mockReset();
    mockSet.mockReset();
    mockSetSnapshots.mockReset();
    mockUpdate.mockReset();
    currentProjectId = "spark-inn-stg-7a7ad";
    stagingAllowlist = "spark-inn-stg-7a7ad,spark-inn-staging-preview";
    process.env.FIREBASE_PROJECT_ID = currentProjectId;
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = stagingAllowlist;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a genuine production-shaped export whose SOURCE fields carry real PII (the source is scrubbed, not rejected)", async () => {
    // The old gate ran the denylist scan on the SOURCE payload, so a
    // real production export — 155 real gmail addresses in production —
    // was ALWAYS rejected before the sanitizer ever ran. The scan must
    // run on what is actually written.
    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: genuineExport(), options: { mode: "sanitized-snapshot" } } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    // The source PII is replaced, not carried through.
    const sanitized = payload.data.sanitized.bookings[0];
    expect(sanitized.guestEmail).not.toBe("realguest@gmail.com");
    expect(sanitized.guestEmail).toMatch(/^guest-[0-9a-f]{8}@example\.invalid$/);
    expect(sanitized.guestPhone).not.toContain("09171234567");
  });

  it("keeps the money intact through sanitization — the balanceDue and the ledger survive", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: genuineExport(), options: { mode: "sanitized-snapshot" } } }),
      res
    );

    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const b1 = sanitized.bookings[0];
    expect(b1.balanceDue).toBe(0);
    expect(b1.totalPrice).toBe(5400);
    expect(b1.onsitePayments).toHaveLength(1);
    expect(b1.onsitePayments[0].amount).toBe(5400);
    // The second booking: a charge that is still owed.
    const b2 = sanitized.bookings[1];
    expect(b2.balanceDue).toBe(300);
    expect(b2.addedCharges).toHaveLength(1);
    expect(b2.addedCharges[0].amount).toBe(300);
  });

  it("does not let a free-text PII field survive the sanitizer into the payload that gets written", async () => {
    // The sanitizer must scrub every free-text field the ledger carries,
    // including the ones a real export has: `notes` on a booking and
    // `note` on a payment row. A Gmail address in `notes` survives as
    // `notes: ""` (the field is cleared); the point is that the written
    // payload carries no production PII at all.
    const exportPayload = genuineExport();
    exportPayload.bookings[0].notes = "guest said realguest@gmail.com";
    exportPayload.bookings[0].onsitePayments[0].note = "verified by realguest@gmail.com";

    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: exportPayload, options: { mode: "sanitized-snapshot" } } }),
      res
    );

    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const written = JSON.stringify(sanitized);
    expect(written).not.toContain("realguest@gmail.com");
    expect(written).not.toContain("otherguest@yahoo.com");
    expect(written).not.toContain("09171234567");
    expect(written).not.toContain("firebasestorage.googleapis.com");
  });

  it("scrubs the staff-identity fields (a staff Gmail address must not land in staging)", async () => {
    // `discountVerifiedBy` in production holds a real Gmail address
    // (frontdeskbot@gmail.com) on 1 booking, and `handledBy` holds a
    // real staff UID on 74. ETR-R06 says the sanitized mode maps
    // production staff UIDs to staging-safe actors. The old sanitizer
    // mapped none of them.
    const exportPayload = genuineExport();
    exportPayload.bookings[0].discountVerifiedBy = "frontdeskbot@gmail.com";
    exportPayload.bookings[0].handledBy = "PZtxhrdw81NuCRgFnUuJ8qzVcSV2";
    exportPayload.bookings[0].createdByUid = "PZtxhrdw81NuCRgFnUuJ8qzVcSV2";

    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: exportPayload, options: { mode: "sanitized-snapshot" } } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const written = JSON.stringify(sanitized);
    expect(written).not.toContain("frontdeskbot@gmail.com");
    expect(written).not.toContain("PZtxhrdw81NuCRgFnUuJ8qzVcSV2");
  });

  it("scrubs the staff identity where it hides in NESTED structures", async () => {
    // The identity is not only in the top-level fields. Production
    // carries it at `breakfastSelections.<slot>.addedBy` /
    // `.lastModifiedBy` / `.removedBy`, `breakfastServed.<slot>.servedBy`,
    // `otherAddOnSelections.<date>[].addedBy` and
    // `rescheduleHistory[].by` — a fixed list of top-level fields left
    // every one of those in place.
    const exportPayload = genuineExport();
    exportPayload.bookings[0].breakfastSelections = {
      "2026-10-22-0": { mealId: "tapsilog", addedBy: "PZtxhrdw81NuCRgFnUuJ8qzVcSV2", lastModifiedBy: "PZtxhrdw81NuCRgFnUuJ8qzVcSV2" }
    };
    exportPayload.bookings[0].breakfastServed = {
      "2026-10-22-0": { servedBy: "PZtxhrdw81NuCRgFnUuJ8qzVcSV2" }
    };
    exportPayload.bookings[0].rescheduleHistory = [
      { by: "PZtxhrdw81NuCRgFnUuJ8qzVcSV2", from: "2026-10-20", to: "2026-10-21" }
    ];

    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: exportPayload, options: { mode: "sanitized-snapshot" } } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const written = JSON.stringify(sanitized);
    expect(written).not.toContain("PZtxhrdw81NuCRgFnUuJ8qzVcSV2");
  });

  it("keeps a staff ROLE (a sentinel, not a person) so the operational reports still work", async () => {
    // `cancelledBy: "system"` names a role, not a person. Blanking it
    // would break the cancellation-reason reports in staging, so the
    // sentinel is preserved.
    const exportPayload = genuineExport();
    exportPayload.bookings[0].cancelledBy = "system";
    exportPayload.bookings[0].status = "cancelled";

    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: exportPayload, options: { mode: "sanitized-snapshot" } } }),
      res
    );

    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    expect(sanitized.bookings[0].cancelledBy).toBe("system");
  });

  it("scrubs the NESTED guest identity (guestDetails) — the old sanitizer only touched the top-level copy", async () => {
    // Production carries a `guestDetails` sub-object on all 157
    // bookings: the SAME guest email and phone as the top-level
    // fields. The old sanitizer left the nested copy verbatim — 155
    // gmail addresses and 154 phone numbers that the old (top-level
    // only) denylist scan never even looked at.
    const exportPayload = genuineExport();
    exportPayload.bookings[0].guestDetails = {
      firstName: "Real",
      lastName: "Guest",
      email: "realguest@gmail.com",
      phone: "09171234567"
    };

    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: exportPayload, options: { mode: "sanitized-snapshot" } } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const written = JSON.stringify(sanitized);
    expect(written).not.toContain("realguest@gmail.com");
    expect(written).not.toContain("09171234567");
    // The guest still reads as ONE guest: the nested email maps to the
    // SAME synthetic email as the top-level one.
    const b = sanitized.bookings[0];
    expect(b.guestDetails.email).toBe(b.guestEmail);
    expect(b.guestDetails.phone).toBe(b.guestPhone);
  });

  it("scrubs the guest REGISTRATION identity (address, emergency contact, government ID)", async () => {
    const exportPayload = genuineExport();
    exportPayload.bookings[0].guestRegistration = {
      nationality: "Filipino",
      address: "Real address, Bohol",
      dateOfBirth: "1990-01-15",
      gender: "female",
      purposeOfStay: "leisure",
      idType: "passport",
      idNumber: "REAL-PASSPORT-1234",
      emergencyContact: "QA contact 09170000000",
      vehiclePlate: "ABC-123"
    };

    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: exportPayload, options: { mode: "sanitized-snapshot" } } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const registration = sanitized.bookings[0].guestRegistration;
    expect(registration.address).toBe("[REDACTED — sanitized for staging]");
    expect(registration.emergencyContact).toBe("");
    expect(registration.idNumber).not.toBe("REAL-PASSPORT-1234");
    expect(registration.vehiclePlate).toBe("");
    // The categorical fields are operational signal and are kept.
    expect(registration.nationality).toBe("Filipino");
    expect(registration.purposeOfStay).toBe("leisure");
  });

  it("returns the fields the Admin UI reads (sourceHash + sanitizationVersion + the sanitized export under the name it posts back)", async () => {
    // The UI reads `refreshPreview.sanitizedExport` and POSTS that same
    // key back to the import endpoint, but the server returned the
    // payload under `sanitized` — so the import always received
    // `undefined` and 400'd. The preview response must carry the
    // payload under the key the UI actually uses.
    const res = mockResponse();
    await handleStagingRefreshPreview(
      adminReq({ body: { export: genuineExport(), options: { mode: "sanitized-snapshot" } } }),
      res
    );

    const data = (res.json as any).mock.calls[0][0].data;
    expect(data.sanitizedExport).toBeDefined();
    expect(data.sanitizedExport.bookings).toHaveLength(2);
    expect(data.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof data.sanitizationVersion).toBe("string");
    expect(data.sanitizationVersion.length).toBeGreaterThan(0);
    // The counts the UI renders.
    expect(data.sanitizedCounts).toEqual({ bookings: 2, storeOrders: 0, members: 0 });
  });
});

describe("/api/test-runs/staging-refresh-import (F-A6 — tampering is still detectable)", () => {
  beforeEach(() => {
    installDefaultMock();
    lastSnapshotSet = null;
    lastSnapshotUpdate = null;
    mockGet.mockReset();
    mockSet.mockReset();
    mockSetSnapshots.mockReset();
    mockUpdate.mockReset();
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg-7a7ad";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-stg-7a7ad,spark-inn-staging-preview";
    // The import handler reads the snapshot row back with `.get()`.
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        projectId: "spark-inn-stg-7a7ad",
        mode: "sanitized-snapshot",
        createdAt: new Date(),
        sourceCounts: { bookings: 2, storeOrders: 0, members: 0 },
        sanitizedCounts: { bookings: 2, storeOrders: 0, members: 0 },
        sourceHash: "a".repeat(64),
        saltPrefix: "deadbeef",
        status: "complete"
      })
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an import whose payment amount was edited in transit (the balance no longer reconciles)", async () => {
    // The tamper case: somebody edits a payment amount in the pasted
    // JSON. The per-booking invariant catches it — the declared
    // balanceDue (0) no longer matches the recomputed one (−5400).
    const tampered = genuineExport();
    tampered.bookings[0].onsitePayments[0].amount = 1;

    const res = mockResponse();
    await handleStagingRefreshImport(
      {
        ...adminReq(),
        body: { snapshotId: "refresh-1-aabbccdd", sanitizedExport: tampered }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(422);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/drift|invariant|inconsistent/i);
    // The snapshot is marked incomplete, NOT complete — the operator can
    // retry, and a failed import never reads as a clean refresh.
    expect(lastSnapshotUpdate).not.toBeNull();
    expect(lastSnapshotUpdate!.data.status).toBe("incomplete");
  });

  it("rejects an import whose declared balanceDue was edited in transit", async () => {
    const tampered = genuineExport();
    tampered.bookings[0].balanceDue = -5400;

    const res = mockResponse();
    await handleStagingRefreshImport(
      { ...adminReq(), body: { snapshotId: "refresh-1-aabbccdd", sanitizedExport: tampered } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect((res.json as any).mock.calls[0][0].success).toBe(false);
  });

  it("catches a compensating error between two bookings (a GLOBAL sum would have missed it)", async () => {
    // Booking A loses 100, booking B gains 100. The two global sums
    // cancel — the old gate saw drift 0. The per-booking check does
    // not.
    const compensating = genuineExport();
    compensating.bookings[0].onsitePayments[0].amount = 5300; // A is short 100
    compensating.bookings[1].onsitePayments[0].amount = 5100; // B is over 100

    const res = mockResponse();
    await handleStagingRefreshImport(
      { ...adminReq(), body: { snapshotId: "refresh-1-aabbccdd", sanitizedExport: compensating } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect((res.json as any).mock.calls[0][0].success).toBe(false);
  });

  it("accepts a genuine export — the per-booking money reconciles", async () => {
    const res = mockResponse();
    await handleStagingRefreshImport(
      { ...adminReq(), body: { snapshotId: "refresh-1-aabbccdd", sanitizedExport: genuineExport() } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("complete");
    // The import actually wrote the docs.
    expect(mockSet).toHaveBeenCalled();
    expect(lastSnapshotUpdate).not.toBeNull();
    expect(lastSnapshotUpdate!.data.status).toBe("complete");
  });

  it("treats a PENDING refund as a liability (it does not reduce the collected money) and a PAID refund as money that left", async () => {
    // 5000 bill, 5000 collected, a 100 refund that has NOT been paid
    // out. The hotel still holds the money and owes it back, so the
    // balance is still 0 — the pending refund is not collected money.
    const pending = genuineExport();
    pending.bookings = [
      {
        id: "B1",
        guestName: "Guest",
        guestEmail: "g@gmail.com",
        guestPhone: "09171234567",
        totalPrice: 5000,
        otherAddOnTotal: 0,
        balanceDue: 0,
        onsitePayments: [
          { id: "p1", type: "payment", amount: 5000, method: "cash", status: "", recordedAt: "2026-10-21T05:00:00.000Z", category: "" },
          { id: "r1", type: "refund", amount: -100, method: "pending", status: "pending", recordedAt: "2026-10-21T06:00:00.000Z", category: "breakfast" }
        ],
        addedCharges: []
      }
    ];
    const res = mockResponse();
    await handleStagingRefreshImport(
      { ...adminReq(), body: { snapshotId: "refresh-1-aabbccdd", sanitizedExport: pending } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);

    // The same refund, PAID: the money really left the till, so the
    // guest is owed 100 and the balance is 100.
    const paid = JSON.parse(JSON.stringify(pending));
    paid.bookings[0].onsitePayments[1].status = "paid";
    paid.bookings[0].balanceDue = 100;
    const res2 = mockResponse();
    await handleStagingRefreshImport(
      { ...adminReq(), body: { snapshotId: "refresh-1-aabbccdd", sanitizedExport: paid } },
      res2
    );
    expect(res2.status).toHaveBeenCalledWith(200);
  });

  it("rejects an import whose refund was flipped from pending to paid without the balance being updated", async () => {
    const flipped = genuineExport();
    flipped.bookings = [
      {
        id: "B1",
        guestName: "Guest",
        guestEmail: "g@gmail.com",
        guestPhone: "09171234567",
        totalPrice: 5000,
        otherAddOnTotal: 0,
        balanceDue: 0,
        onsitePayments: [
          { id: "p1", type: "payment", amount: 5000, method: "cash", status: "", recordedAt: "2026-10-21T05:00:00.000Z", category: "" },
          { id: "r1", type: "refund", amount: -100, method: "pending", status: "paid", recordedAt: "2026-10-21T06:00:00.000Z", category: "breakfast" }
        ],
        addedCharges: []
      }
    ];
    const res = mockResponse();
    await handleStagingRefreshImport(
      { ...adminReq(), body: { snapshotId: "refresh-1-aabbccdd", sanitizedExport: flipped } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
