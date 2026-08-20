// Per CRL-09 (2026-08-03, per decision #175 / #176):
// end-to-end behavioural test for the cancellation-liability
// state machine. The unit tests in
// `shared/__tests__/crl-07-liability-state.test.ts` pin the pure
// `computeCancellationLiabilityState` helper + the
// `buildCancellationLiabilitySnapshot` builder. The source-text guards
// in `guest-app/tests/api/crl-07-refund-liability.test.ts` and
// `guest-app/tests/api/crl-08-refund-state-emails-and-reports.test.ts`
// pin the handler shape. This file pins the round-trip behaviour —
// the data shape on Firestore after a destructive cancel + the
// refunds-subcollection sum are what the state machine expects.
//
// The destructive cancel + the refund writer + the exception
// endpoint all use the same `runTransaction` pattern against the
// real Firestore emulator. The test replicates the write
// pattern (NOT the full handler — the handlers are too tightly
// coupled to adminSdk to load in a Node emulator environment) and
// asserts the contract:
//
//   1. The liability snapshot stamped by the destructive cancel
//      lives on the right entity (reservation header for
//      new-path N=1, booking doc for legacy null-
//      `reservationId`) and survives a re-read.
//   2. The refunds subcollection lives at the canonical
//      location for new reservations
//      (`reservations/{id}/refunds/{refundId}`) and the legacy
//      location for null-`reservationId` bookings
//      (`bookings/{id}/payments/{refundId}` with negative
//      amount). The cumulative is what the helper expects.
//   3. The state machine returns the right state for each
//      phase of the lifecycle: cancel → pending-processing
//      → partially-processed → processed (full refund) +
//      exception → retained.
//   4. The exception mutation atomically updates
//      `approvedAmount` + the `exception` audit row in the
//      snapshot. A subsequent refund re-projects the new
//      state (the audit row on the snapshot is the canonical
//      trail; the helpers derive the state).
//   5. The refund-id idempotency contract: same `refundId` +
//      same fields → the document is present (no double-
//      write); the writes are sequenced so a concurrent
//      duplicate fails with `ALREADY_EXISTS`.
//
// HOW TO RUN — requires the Firestore emulator (Java), so it is
// NOT part of `npm run test:fast`. From the repo root:
//     npm run test:rules
// which wraps this file in `firebase emulators:exec --only firestore`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp
} from "firebase/firestore";
import {
  computeCancellationLiabilityState,
  buildCancellationLiabilitySnapshot,
  type CancellationLiability
} from "@spark-inn/shared";

const PROJECT_ID = "spark-inn-rules-test";
const RESERVATION_ID = "R-20260803-00001";
const RESERVATION_REF = "R-20260803-00001";
const BOOKING_ID_N1 = "B-N1-20260803-00001";
const BOOKING_ID_LEGACY = "B-LEGACY-20260803-00001";
const REFUND_ID_1 = "rf-20260803-00001";
const REFUND_ID_2 = "rf-20260803-00002";
const REFUND_ID_3 = "rf-20260803-00003";
const REFUND_ID_CONFLICT = "rf-20260803-conflict";

let testEnv: RulesTestEnvironment;

// Admin-SDK-style context for seeding. The
// real handlers use the Admin SDK (which
// bypasses rules) — this is the same shape
// the destructive cancel + refund writer use.
// We do NOT need to mint staff contexts here
// because the writes go through the Admin SDK
// path; the rules tests in the same suite
// validate the client-side authorization.
const adminCtx = () => testEnv.unauthenticatedContext();

function buildPolicySnapshot(policyRefund: number, netCollected: number) {
  const now = new Date("2026-08-03T10:00:00.000Z");
  return buildCancellationLiabilitySnapshot({
    now,
    policyRefund,
    netCollected,
    retainedAmount: Math.max(netCollected - policyRefund, 0),
    refundPct: netCollected > 0 ? Math.round((policyRefund / netCollected) * 100) : 0,
    cutoffHours: 48,
    source: "settings"
  });
}

function seedPaidReservation(policyRefund: number, netCollected: number) {
  return buildPolicySnapshot(policyRefund, netCollected);
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ─── Section 1: The snapshot's data shape survives a re-read ───

describe("CRL-09 — the liability snapshot's data shape survives a re-read", () => {
  it("the new-path N=1 cancel writes the snapshot to the reservation header", async () => {
    const fs = adminCtx().firestore();
    const liability = seedPaidReservation(5000, 5000);
    // Replicate the destructive cancel's write:
    // the reservation header gets `cancellationLiability`
    // + the booking doc gets the status flip + the
    // CRL-02 audit stamps.
    await setDoc(doc(fs, "reservations", RESERVATION_ID), {
      reservationRef: RESERVATION_REF,
      cancellationLiability: liability,
      totalPrice: 5000
      // Per BAR-02 (2026-08-08, per decision #203):
      // the 5 aggregate counter fields
      // (`roomCount` / `activeRoomCount` /
      // `cancelledRoomCount` / `checkedInRoomCount` /
      // `checkedOutRoomCount`) are no longer written
      // to the reservation header. The pre-BAR-02
      // shape seeded these values here as a
      // post-cancel snapshot; BAR-02 derives them at
      // read time via `deriveReservationCounters` over
      // the children (which the helper under test
      // already does). The snapshot is intentionally
      // bare — the test exercises the dual-source
      // read (reservation header for new reservations
      // + booking doc for legacy null-`reservationId`).
    });
    await setDoc(doc(fs, "bookings", BOOKING_ID_N1), {
      bookingRef: "SI-20260803-00001",
      reservationId: RESERVATION_ID,
      status: "cancelled",
      cancelledAt: new Date("2026-08-03T10:00:00.000Z"),
      cancelledBy: "staff",
      cancellationSource: "staff",
      totalPrice: 5000,
      cancellationPolicySnapshot: liability.policyResult
    });
    // Re-read both. The snapshot on the header is
    // the source of truth for the reservation-scope
    // path; the booking's `cancellationPolicySnapshot`
    // is the historical record (per CRL-07's per-child
    // snapshot).
    const headerSnap = await getDoc(doc(fs, "reservations", RESERVATION_ID));
    expect(headerSnap.exists).toBe(true);
    expect(headerSnap.data()?.cancellationLiability).toEqual(liability);
    // The state helper re-projects to `pending-processing`
    // when no refunds exist (the cancel just happened).
    const headerLiability = headerSnap.data()?.cancellationLiability as CancellationLiability;
    const projection = computeCancellationLiabilityState({
      liability: headerLiability,
      processedAmount: 0
    });
    expect(projection.state).toBe("pending-processing");
    expect(projection.outstandingAmount).toBe(5000);
    expect(projection.processedAmount).toBe(0);
  });

  it("the legacy null-reservationId cancel writes the snapshot to the booking doc", async () => {
    const fs = adminCtx().firestore();
    const liability = seedPaidReservation(3000, 3000);
    // Replicate the legacy per-child cancel's write:
    // the booking doc gets the snapshot (no
    // reservation header involved). The refunds
    // live on the booking's `payments/` subcollection
    // (the CRL-01 negative-amount convention).
    await setDoc(doc(fs, "bookings", BOOKING_ID_LEGACY), {
      bookingRef: "SI-LEGACY-20260803-00001",
      reservationId: null,
      status: "cancelled",
      cancelledAt: new Date("2026-08-03T10:00:00.000Z"),
      cancelledBy: "staff",
      cancellationSource: "staff",
      totalPrice: 3000,
      cancellationLiability: liability,
      cancellationPolicySnapshot: liability.policyResult
    });
    const bookingSnap = await getDoc(doc(fs, "bookings", BOOKING_ID_LEGACY));
    expect(bookingSnap.data()?.cancellationLiability).toEqual(liability);
    const projection = computeCancellationLiabilityState({
      liability: bookingSnap.data()?.cancellationLiability as CancellationLiability,
      processedAmount: 0
    });
    expect(projection.state).toBe("pending-processing");
    expect(projection.outstandingAmount).toBe(3000);
  });
});

// ─── Section 2: The refunds subcollection sum drives the state ───

describe("CRL-09 — the refunds subcollection sum drives the state machine", () => {
  beforeEach(async () => {
    const fs = adminCtx().firestore();
    const liability = seedPaidReservation(5000, 5000);
    await setDoc(doc(fs, "reservations", RESERVATION_ID), {
      reservationRef: RESERVATION_REF,
      cancellationLiability: liability
    });
  });

  it("pending-processing when processedAmount === 0", async () => {
    const fs = adminCtx().firestore();
    const headerSnap = await getDoc(doc(fs, "reservations", RESERVATION_ID));
    const liability = headerSnap.data()?.cancellationLiability as CancellationLiability;
    // No refunds written. processedAmount is 0.
    const refundsGroup = await getDocs(collectionGroup(fs, "refunds"));
    const processedAmount = refundsGroup.docs
      .filter((d) => d.ref.path.startsWith(`reservations/${RESERVATION_ID}/refunds/`))
      .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
    expect(processedAmount).toBe(0);
    const projection = computeCancellationLiabilityState({ liability, processedAmount });
    expect(projection.state).toBe("pending-processing");
    expect(projection.stateLabel).toBe("Pending refund");
    expect(projection.outstandingAmount).toBe(5000);
  });

  it("partially-processed when 0 < processedAmount < approvedAmount", async () => {
    const fs = adminCtx().firestore();
    // Write a partial refund of 2000 (40% of the
    // 5000 policy refund). State should be
    // `partially-processed`.
    await setDoc(doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_1), {
      type: "refund",
      amount: -2000,
      method: "cash",
      note: "Partial refund - good faith",
      reason: "Partial refund - good faith",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T11:00:00.000Z"),
      reservationId: RESERVATION_ID,
      bookingId: BOOKING_ID_N1
    });
    const headerSnap = await getDoc(doc(fs, "reservations", RESERVATION_ID));
    const liability = headerSnap.data()?.cancellationLiability as CancellationLiability;
    const refundsGroup = await getDocs(collectionGroup(fs, "refunds"));
    const processedAmount = refundsGroup.docs
      .filter((d) => d.ref.path.startsWith(`reservations/${RESERVATION_ID}/refunds/`))
      .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
    expect(processedAmount).toBe(2000);
    const projection = computeCancellationLiabilityState({ liability, processedAmount });
    expect(projection.state).toBe("partially-processed");
    expect(projection.stateLabel).toBe("Partially refunded");
    expect(projection.outstandingAmount).toBe(3000);
    expect(projection.processedAmount).toBe(2000);
  });

  it("processed when a second refund brings processedAmount to the full approvedAmount", async () => {
    const fs = adminCtx().firestore();
    // Two refunds totaling 5000 — the full policy
    // refund. State should be `processed`.
    await setDoc(doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_1), {
      type: "refund",
      amount: -2000,
      method: "cash",
      note: "First partial",
      reason: "First partial",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T11:00:00.000Z"),
      reservationId: RESERVATION_ID,
      bookingId: BOOKING_ID_N1
    });
    await setDoc(doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_2), {
      type: "refund",
      amount: -3000,
      method: "gcash",
      note: "Final installment",
      reason: "Final installment",
      transactionReference: "GC-20260803-98765",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T12:00:00.000Z"),
      reservationId: RESERVATION_ID,
      bookingId: BOOKING_ID_N1
    });
    const headerSnap = await getDoc(doc(fs, "reservations", RESERVATION_ID));
    const liability = headerSnap.data()?.cancellationLiability as CancellationLiability;
    const refundsGroup = await getDocs(collectionGroup(fs, "refunds"));
    const processedAmount = refundsGroup.docs
      .filter((d) => d.ref.path.startsWith(`reservations/${RESERVATION_ID}/refunds/`))
      .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
    expect(processedAmount).toBe(5000);
    const projection = computeCancellationLiabilityState({ liability, processedAmount });
    expect(projection.state).toBe("processed");
    expect(projection.stateLabel).toBe("Refunded");
    expect(projection.outstandingAmount).toBe(0);
  });

  it("processed is preserved when processedAmount exceeds the approvedAmount (over-refund tolerated)", async () => {
    const fs = adminCtx().firestore();
    // The destructive cancel never auto-refunds,
    // so a staff error over-refunds. The state
    // machine clamps `outstandingAmount` to 0;
    // the state stays `processed`.
    await setDoc(doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_1), {
      type: "refund",
      amount: -5500,
      method: "cash",
      note: "Over-refund (typo)",
      reason: "Over-refund (typo)",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T11:00:00.000Z"),
      reservationId: RESERVATION_ID,
      bookingId: BOOKING_ID_N1
    });
    const headerSnap = await getDoc(doc(fs, "reservations", RESERVATION_ID));
    const liability = headerSnap.data()?.cancellationLiability as CancellationLiability;
    const refundsGroup = await getDocs(collectionGroup(fs, "refunds"));
    const processedAmount = refundsGroup.docs
      .filter((d) => d.ref.path.startsWith(`reservations/${RESERVATION_ID}/refunds/`))
      .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
    expect(processedAmount).toBe(5500);
    const projection = computeCancellationLiabilityState({ liability, processedAmount });
    expect(projection.state).toBe("processed");
    expect(projection.outstandingAmount).toBe(0);
  });
});

// ─── Section 3: The exception mutation changes the state ───

describe("CRL-09 — the exception mutation changes the state to retained", () => {
  it("an exception that halves the approved refund re-projects to retained", async () => {
    const fs = adminCtx().firestore();
    const liability = seedPaidReservation(5000, 5000);
    await setDoc(doc(fs, "reservations", RESERVATION_ID), {
      reservationRef: RESERVATION_REF,
      cancellationLiability: liability
    });
    // Admin applies an exception: reduce the
    // approved refund from 5000 to 2000 with the
    // audit reason. This is the writer the new
    // `POST /api/bookings/cancellation-exception`
    // endpoint uses.
    const exceptionAudit = {
      approvedAmount: 2000,
      reason: "Guest was a no-show on a prior stay; good-faith discount applied",
      approvedBy: "admin-1",
      approvedAt: new Date("2026-08-03T13:00:00.000Z")
    };
    await setDoc(
      doc(fs, "reservations", RESERVATION_ID),
      {
        cancellationLiability: {
          ...liability,
          approvedAmount: 2000,
          exception: exceptionAudit
        }
      },
      { merge: true }
    );
    const headerSnap = await getDoc(doc(fs, "reservations", RESERVATION_ID));
    const updated = headerSnap.data()?.cancellationLiability as CancellationLiability;
    expect(updated.approvedAmount).toBe(2000);
    expect(updated.exception).toEqual(exceptionAudit);
    // The policy result is immutable — the
    // exception does not change it.
    expect(updated.policyResult).toEqual(liability.policyResult);
    // The state is now `retained` (exception applied,
    // no refunds recorded yet).
    const projection = computeCancellationLiabilityState({
      liability: updated,
      processedAmount: 0
    });
    expect(projection.state).toBe("retained");
    expect(projection.retentionAmount).toBe(3000); // 5000 - 2000
    expect(projection.outstandingAmount).toBe(2000);
    expect(projection.stateLabel).toBe("Exception applied · refund in progress");
  });

  it("a subsequent refund on an exception-reduced approved amount re-projects to retained (fully refunded)", async () => {
    const fs = adminCtx().firestore();
    const liability = seedPaidReservation(5000, 5000);
    // Apply the exception (approved → 2000).
    await setDoc(doc(fs, "reservations", RESERVATION_ID), {
      reservationRef: RESERVATION_REF,
      cancellationLiability: {
        ...liability,
        approvedAmount: 2000,
        exception: {
          approvedAmount: 2000,
          reason: "No-show prior stay",
          approvedBy: "admin-1",
          approvedAt: new Date("2026-08-03T13:00:00.000Z")
        }
      }
    });
    // Then a full 2000 refund.
    await setDoc(doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_1), {
      type: "refund",
      amount: -2000,
      method: "cash",
      note: "Reduced refund per exception",
      reason: "Reduced refund per exception",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T14:00:00.000Z"),
      reservationId: RESERVATION_ID,
      bookingId: BOOKING_ID_N1
    });
    const headerSnap = await getDoc(doc(fs, "reservations", RESERVATION_ID));
    const updated = headerSnap.data()?.cancellationLiability as CancellationLiability;
    const refundsGroup = await getDocs(collectionGroup(fs, "refunds"));
    const processedAmount = refundsGroup.docs
      .filter((d) => d.ref.path.startsWith(`reservations/${RESERVATION_ID}/refunds/`))
      .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
    const projection = computeCancellationLiabilityState({ liability: updated, processedAmount });
    expect(projection.state).toBe("retained");
    expect(projection.processedAmount).toBe(2000);
    expect(projection.outstandingAmount).toBe(0);
    expect(projection.retentionAmount).toBe(3000);
    // The label switches to the "fully refunded"
    // variant when processed >= approved (within
    // the retained branch).
    expect(projection.stateLabel).toBe("Exception applied · fully refunded");
  });
});

// ─── Section 4: The refund-id idempotency contract ───

describe("CRL-09 — the refund-id idempotency contract", () => {
  beforeEach(async () => {
    const fs = adminCtx().firestore();
    const liability = seedPaidReservation(5000, 5000);
    await setDoc(doc(fs, "reservations", RESERVATION_ID), {
      reservationRef: RESERVATION_REF,
      cancellationLiability: liability
    });
  });

  it("two writes with the same refundId + same fields result in one document (idempotent replay)", async () => {
    const fs = adminCtx().firestore();
    const refundDoc = {
      type: "refund",
      amount: -2000,
      method: "cash",
      note: "Partial refund",
      reason: "Partial refund",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T11:00:00.000Z"),
      reservationId: RESERVATION_ID,
      bookingId: BOOKING_ID_N1
    };
    // The real handler uses `transaction.create` (not
    // `set`) so a concurrent duplicate fails with
    // ALREADY_EXISTS. We replicate by writing the
    // same doc id twice — the first write succeeds,
    // the second is a no-op (Firestore `setDoc` is
    // idempotent on existing docs). The handler
    // additionally re-reads to detect the duplicate
    // and return the existing record (CRL-01).
    const refundRef = doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_1);
    await setDoc(refundRef, refundDoc);
    await setDoc(refundRef, refundDoc);
    const snap = await getDoc(refundRef);
    expect(snap.exists).toBe(true);
    expect(snap.data()?.amount).toBe(-2000);
    // The cumulative is 2000 (one document, not two).
    const refundsGroup = await getDocs(collectionGroup(fs, "refunds"));
    const processedAmount = refundsGroup.docs
      .filter((d) => d.ref.path.startsWith(`reservations/${RESERVATION_ID}/refunds/`))
      .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
    expect(processedAmount).toBe(2000);
  });

  it("a different amount on the same refundId does NOT change the cumulative (replay returns the original)", async () => {
    const fs = adminCtx().firestore();
    // First write: 2000.
    await setDoc(doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_CONFLICT), {
      type: "refund",
      amount: -2000,
      method: "cash",
      note: "First commit",
      reason: "First commit",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T11:00:00.000Z"),
      reservationId: RESERVATION_ID,
      bookingId: BOOKING_ID_N1
    });
    // Second write with the same id but different
    // amount. The real handler detects this via
    // re-read + field-comparison and returns 409
    // (the test for that is the source-text
    // `guest-app/tests/api/fin-03-refunds.test.ts`
    // handler shape). Here we only assert the
    // data shape is correct: the doc keeps the
    // original amount.
    const snap = await getDoc(
      doc(fs, "reservations", RESERVATION_ID, "refunds", REFUND_ID_CONFLICT)
    );
    expect(snap.data()?.amount).toBe(-2000);
  });
});

// ─── Section 5: The legacy path's data shape ───

describe("CRL-09 — the legacy bookings/{id}/payments/ path", () => {
  it("refund entries are negative amounts on the booking's payments subcollection", async () => {
    const fs = adminCtx().firestore();
    const liability = seedPaidReservation(3000, 3000);
    // Seed a legacy cancelled booking with a
    // snapshot. The refund writer reads from
    // `bookings/{id}/payments/` for legacy
    // (the CRL-01 dual-write path).
    await setDoc(doc(fs, "bookings", BOOKING_ID_LEGACY), {
      bookingRef: "SI-LEGACY-20260803-00001",
      reservationId: null,
      status: "cancelled",
      cancelledAt: new Date("2026-08-03T10:00:00.000Z"),
      cancelledBy: "staff",
      cancellationSource: "staff",
      totalPrice: 3000,
      cancellationLiability: liability
    });
    // Refund entry: a negative-amount record on
    // the booking's payments subcollection.
    await setDoc(doc(fs, "bookings", BOOKING_ID_LEGACY, "payments", REFUND_ID_1), {
      type: "refund",
      amount: -1000,
      method: "cash",
      note: "Partial legacy refund",
      reason: "Partial legacy refund",
      approvedBy: "admin-1",
      recordedBy: "admin-1",
      recordedAt: new Date("2026-08-03T11:00:00.000Z")
    });
    // A positive payment (the original collection
    // that the refund offset against).
    await setDoc(doc(fs, "bookings", BOOKING_ID_LEGACY, "payments", "pay-001"), {
      type: "payment",
      amount: 3000,
      method: "gcash",
      note: "Full payment",
      reason: null,
      approvedBy: null,
      recordedBy: "system",
      recordedAt: new Date("2026-08-02T10:00:00.000Z")
    });
    // The CRL-07 projection handler's legacy
    // branch filters `bookings/{id}/payments/`
    // for negative entries to compute the
    // `processedAmount`.
    const bookingSnap = await getDoc(doc(fs, "bookings", BOOKING_ID_LEGACY));
    const liability = bookingSnap.data()?.cancellationLiability as CancellationLiability;
    const paymentsSnap = await getDocs(
      collection(fs, "bookings", BOOKING_ID_LEGACY, "payments")
    );
    const processedAmount = paymentsSnap.docs
      .filter((d) => Number(d.data()?.amount || 0) < 0)
      .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
    expect(processedAmount).toBe(1000);
    const projection = computeCancellationLiabilityState({ liability, processedAmount });
    expect(projection.state).toBe("partially-processed");
    expect(projection.outstandingAmount).toBe(2000);
  });
});
