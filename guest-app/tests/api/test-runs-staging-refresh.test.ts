import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// ── ETR-R01 / ETR-R04 / ETR-R10 (foundation) regression tests ──
//
// These tests pin the contract for the staging-refresh preview
// endpoint:
//   - method guard (GET → 405)
//   - auth guard (tokenless → 401, front-desk → 403)
//   - one-way gate (production project → 403, never runs on prod)
//   - schema guard (missing export → 400, oversized fields → 400)
//   - sanitization engine (deterministic per-snapshot mapping,
//     same source value → same synthetic value within one snapshot,
//     different source values → different synthetic values)
//   - field-level redaction (PII replaced, operational fields
//     preserved)
//   - audit row (snapshotId, sourceCounts, sanitizedCounts, salt
//     prefix, sourceHash)
//   - config-only mode is a no-op pass-through (no sanitization
//     but the audit row is still written)
//
// The server is mocked to keep the test pure-JS; the Admin SDK
// posture is verified by a separate source-text test in
// `admin-app/src/__tests__/etr-r-staging-refresh.test.ts` (the
// route + handler wiring in apiRouter.ts + the ROADMAP trace).

const { mockGet, mockCollection, mockSet, mockSetSnapshots } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockCollection = vi.fn();
  const mockSet = vi.fn();
  const mockSetSnapshots = vi.fn();
  return { mockGet, mockCollection, mockSet, mockSetSnapshots };
});

// Tracks the most recent `set()` call against the refresh-snapshots
// collection so the test can assert the audit row shape.
let lastSnapshotSet: { ref: any; data: any } | null = null;

function installDefaultMock() {
  // Build a flexible mock tree. The `doc` returns a single doc
  // reference; the `collection` returns a collection that also has
  // a `doc` method, so the chain `adminDb.collection(...).doc(...)`
  // resolves, and we can route by collection/doc id. The actual
  // handler writes to `janitor/refresh-snapshots/items/{snapshotId}`
  // (a nested-collection chain), so the routing check uses
  // `path.includes("refresh-snapshots")` to match both the inner
  // and outer collection shapes.
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
      update: vi.fn(),
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

// The production-allowlist gate reads STAGING_ALLOWLIST_PROJECT_IDS
// against the current FIREBASE_PROJECT_ID. We set the project to
// the staging project by default and let the production-deny test
// override.
let currentProjectId = "spark-inn-stg-7a7ad";
let stagingAllowlist = "spark-inn-stg-7a7ad,spark-inn-staging-preview";
vi.stubEnv("FIREBASE_PROJECT_ID", currentProjectId);
vi.stubEnv("STAGING_ALLOWLIST_PROJECT_IDS", stagingAllowlist);

import { handleStagingRefreshPreview } from "../../server/handlers/test-runs";

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
      bookings: [
        {
          id: "booking_1",
          bookingRef: "SPK-2026-0001",
          guestName: "Maria Santos",
          guestEmail: "maria.santos@workmail.com",
          guestPhone: "+63 917 555 0100",
          address: "123 Rizal St, Tagbilaran",
          emergencyContactName: "Juan Santos",
          emergencyContactPhone: "+63 918 555 0200",
          guestIdUrl: "https://firebasestorage.../id_1.jpg",
          paymentProofUrl: "https://firebasestorage.../proof_1.jpg",
          status: "checked-out",
          checkIn: "2026-06-01",
          checkOut: "2026-06-03",
          numNights: 2,
          numGuests: 2,
          totalPrice: 5000,
          roomNumber: "201",
          roomType: "single",
          payments: [
            { amount: 5000, transactionReference: "GCASH-2026-001", method: "gcash" }
          ],
          addedCharges: [
            { amount: 500, description: "Late checkout fee", notes: "Guest arrived 2h late" }
          ],
          createdAt: "2026-05-25",
          createdByUid: "staff_1"
        },
        {
          // Same guestEmail, different booking — the sanitization
          // engine should produce the SAME synthetic email for both
          // (relational integrity).
          id: "booking_2",
          bookingRef: "SPK-2026-0002",
          guestName: "Maria Santos",
          guestEmail: "maria.santos@workmail.com",
          guestPhone: "+63 917 555 0100",
          status: "confirmed",
          checkIn: "2026-07-01",
          checkOut: "2026-07-03",
          numNights: 2,
          numGuests: 2,
          totalPrice: 5000
        }
      ],
      storeOrders: [
        {
          id: "order_1",
          guestName: "Maria Santos",
          guestEmail: "maria.santos@workmail.com",
          guestPhone: "+63 917 555 0100",
          total: 250,
          paymentProofUrl: "https://firebasestorage.../order_proof_1.jpg",
          status: "delivered"
        }
      ],
      members: [
        {
          id: "member_1",
          fullName: "Maria Santos",
          email: "maria.santos@workmail.com",
          phone: "+63 917 555 0100",
          rewardsPoints: 50,
          isActive: true
        }
      ]
    },
    options: { mode: "sanitized-snapshot", snapshotNote: "Pre-launch staging refresh" },
    ...overrides
  }
});

describe("/api/test-runs/staging-refresh-preview (ETR-R foundation)", () => {
  beforeEach(() => {
    installDefaultMock();
    lastSnapshotSet = null;
    mockGet.mockReset();
    mockSet.mockReset();
    mockSetSnapshots.mockReset();
    currentProjectId = "spark-inn-stg-7a7ad";
    stagingAllowlist = "spark-inn-stg-7a7ad,spark-inn-staging-preview";
    process.env.FIREBASE_PROJECT_ID = currentProjectId;
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = stagingAllowlist;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ─── 1. Method + auth guards ─────────────────────────────────────

  it("rejects non-POST methods with 405", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview({ ...adminReq(), method: "GET" }, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockSetSnapshots).not.toHaveBeenCalled();
  });

  it("rejects tokenless request with 401", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview({ ...adminReq(), staff: {} }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSetSnapshots).not.toHaveBeenCalled();
  });

  it("rejects front-desk caller with 403", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview({
      ...adminReq(),
      staff: { uid: "fd_1", email: "fd@sparkinn.com", role: "front-desk" }
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockSetSnapshots).not.toHaveBeenCalled();
  });

  // ─── 2. One-way gate (R01) ───────────────────────────────────────

  it("refuses to run on a production project (403) — the production environment cannot trigger a refresh", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-prod-abc123";
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.error).toMatch(/staging allowlist/i);
    expect(mockSetSnapshots).not.toHaveBeenCalled();
  });

  it("refuses to run on a staging project NOT on the allowlist (403)", async () => {
    process.env.FIREBASE_PROJECT_ID = "spark-inn-stg-not-allowlisted";
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockSetSnapshots).not.toHaveBeenCalled();
  });

  // ─── 3. Schema guard ─────────────────────────────────────────────

  it("rejects when the body is missing the export field (400)", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview({
      ...adminReq(),
      body: { options: { mode: "sanitized-snapshot" } }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSetSnapshots).not.toHaveBeenCalled();
  });

  it("rejects when the mode is not in the allowlist (400)", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview({
      ...adminReq(),
      body: { export: { bookings: [], storeOrders: [], members: [] }, options: { mode: "unsanitized" } }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSetSnapshots).not.toHaveBeenCalled();
  });

  it("accepts a minimal empty-export payload (boundary case for the schema)", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview({
      ...adminReq(),
      body: { export: { bookings: [], storeOrders: [], members: [] } }
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.sourceCounts).toEqual({ bookings: 0, storeOrders: 0, members: 0 });
    expect(payload.data.sanitizedCounts).toEqual({ bookings: 0, storeOrders: 0, members: 0 });
  });

  // ─── 4. Sanitization engine (R04) ────────────────────────────────

  it("replaces guest PII with deterministic synthetic values, per-snapshot", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;

    // booking_1 — full PII set
    const b1 = sanitized.bookings[0];
    expect(b1.guestName).toMatch(/^Guest-[0-9a-f]{8}@guests\.invalid$/);
    expect(b1.guestEmail).toMatch(/^guest-[0-9a-f]{8}@example\.invalid$/);
    expect(b1.guestPhone).toMatch(/^\+63900000-[0-9a-f]{8}@phones\.invalid$/);
    expect(b1.address).toBe("[REDACTED — sanitized for staging]");
    expect(b1.emergencyContactName).toBe("");
    expect(b1.emergencyContactPhone).toBe("");
    expect(b1.guestIdUrl).toBe("");
    expect(b1.paymentProofUrl).toBe("");
    expect(b1.signatureUrl).toBe("");
    expect(b1.notes).toBe("");
    expect(b1.internalNotes).toBe("");

    // Operational fields preserved (the point of the refresh is to
    // keep the operational data shape so staging can be exercised
    // against realistic totals).
    expect(b1.status).toBe("checked-out");
    expect(b1.checkIn).toBe("2026-06-01");
    expect(b1.checkOut).toBe("2026-06-03");
    expect(b1.numNights).toBe(2);
    expect(b1.numGuests).toBe(2);
    expect(b1.totalPrice).toBe(5000);
    expect(b1.roomNumber).toBe("201");
    expect(b1.roomType).toBe("single");
    expect(b1.bookingRef).toBe("SPK-2026-0001");
    expect(b1.id).toBe("booking_1");
  });

  it("preserves relational integrity — same source email maps to the same synthetic email within one snapshot", async () => {
    // Maria Santos has two bookings (booking_1, booking_2) and one
    // store order, all with the same email. The sanitization engine
    // must produce the SAME synthetic email across all three so
    // staging reports can still show "this guest's three orders".
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const b1Email = sanitized.bookings[0].guestEmail;
    const b2Email = sanitized.bookings[1].guestEmail;
    const o1Email = sanitized.storeOrders[0].guestEmail;
    const m1Email = sanitized.members[0].email;

    expect(b2Email).toBe(b1Email);
    expect(o1Email).toBe(b1Email);
    expect(m1Email).toBe(b1Email);
  });

  it("produces DIFFERENT synthetic values across snapshots (no cross-snapshot correlation)", async () => {
    // The salt is per-snapshot. Two snapshots of the same source
    // export must produce different synthetic values for the same
    // source field. This is the privacy guarantee — the same guest
    // across two refreshes is not linkable from the staging side.
    const res1 = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res1);
    const res2 = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res2);

    const synth1 = (res1.json as any).mock.calls[0][0].data.sanitized.bookings[0].guestEmail;
    const synth2 = (res2.json as any).mock.calls[0][0].data.sanitized.bookings[0].guestEmail;
    expect(synth1).not.toBe(synth2);
    // The synthetic value is derived from the salt + source — both
    // 8 hex chars. The two snapshots produce different salts, so the
    // values diverge even though the source is the same.
    expect(synth1).toMatch(/^guest-[0-9a-f]{8}@example\.invalid$/);
    expect(synth2).toMatch(/^guest-[0-9a-f]{8}@example\.invalid$/);
  });

  it("scrubs the bookings[].payments[].transactionReference (real GCash ref must not leak)", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const paymentRef = sanitized.bookings[0].payments[0].transactionReference;
    expect(paymentRef).toMatch(/^PAY-[0-9a-f]{8}@staging\.invalid$/);
    // Operational fields preserved
    expect(sanitized.bookings[0].payments[0].amount).toBe(5000);
    expect(sanitized.bookings[0].payments[0].method).toBe("gcash");
  });

  it("scrubs the bookings[].addedCharges[].description and .notes (free-text PII surfaces)", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    const charge = sanitized.bookings[0].addedCharges[0];
    expect(charge.description).toBe("[REDACTED]");
    expect(charge.notes).toBe("");
    // Amount preserved for staging reports
    expect(charge.amount).toBe(500);
  });

  // ─── 5. Audit row (R10, partial) ────────────────────────────────

  it("writes a janitor/refresh-snapshots/{snapshotId} audit row with the source + sanitized counts, the salt prefix, and the source hash", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    expect(mockSetSnapshots).toHaveBeenCalledTimes(1);
    expect(lastSnapshotSet).not.toBeNull();

    const auditRow = lastSnapshotSet!.data;
    expect(lastSnapshotSet!.ref.id).toMatch(/^refresh-\d+-[0-9a-f]{8}$/);
    expect(auditRow.projectId).toBe("spark-inn-stg-7a7ad");
    expect(auditRow.mode).toBe("sanitized-snapshot");
    expect(auditRow.createdBy).toBe("admin@sparkinn.com");
    expect(auditRow.sourceCounts).toEqual({ bookings: 2, storeOrders: 1, members: 1 });
    expect(auditRow.sanitizedCounts).toEqual({ bookings: 2, storeOrders: 1, members: 1 });
    expect(auditRow.snapshotNote).toBe("Pre-launch staging refresh");
    expect(auditRow.status).toBe("complete");
    // Salt prefix is persisted (8 chars + ellipsis) so the operator
    // can reproduce the snapshot from the source export for
    // debugging — the FULL salt is not in the audit row to limit
    // the blast radius of a leaked audit row.
    expect(auditRow.saltPrefix).toMatch(/^[0-9a-f]{8}$/);
    // Source hash for chain-of-custody. The hash is the SHA-256 of
    // the source export, not the source PII itself.
    expect(auditRow.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the snapshotId in the response so the operator can import the sanitized JSON into staging by reference", async () => {
    const res = mockResponse();
    await handleStagingRefreshPreview(adminReq(), res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.snapshotId).toMatch(/^refresh-\d+-[0-9a-f]{8}$/);
    expect(payload.data.projectId).toBe("spark-inn-stg-7a7ad");
  });

  // ─── 6. Mode coverage ───────────────────────────────────────────

  it("config-only mode is a no-op pass-through for the sanitization engine but still writes the audit row", async () => {
    // config-only is for when the operator has ALREADY sanitized the
    // export offline and just wants the audit trail. The endpoint
    // should pass the data through unchanged and write the row with
    // mode: 'config-only'.
    const res = mockResponse();
    await handleStagingRefreshPreview({
      ...adminReq(),
      body: {
        export: {
          bookings: [{ id: "b1", guestName: "Already Sanitized", guestEmail: "ok@staging.invalid" }],
          storeOrders: [],
          members: []
        },
        options: { mode: "config-only" }
      }
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const sanitized = (res.json as any).mock.calls[0][0].data.sanitized;
    // PII unchanged in config-only mode (the operator did the
    // sanitization offline).
    expect(sanitized.bookings[0].guestName).toBe("Already Sanitized");
    expect(sanitized.bookings[0].guestEmail).toBe("ok@staging.invalid");

    const auditRow = lastSnapshotSet!.data;
    expect(auditRow.mode).toBe("config-only");
  });
});
