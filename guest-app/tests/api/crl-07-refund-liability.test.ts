// Per CRL-07 (2026-08-03, per decision #173):
// source-text + state-helper source-text guards for
// the durable refund-liability snapshot + the
// admin workflow. The five-state machine +
// `computeCancellationLiabilityState` helper is
// pinned by the unit tests in
// `shared/__tests__/crl-07-liability-state.test.ts`;
// this file pins the server-side + client-side
// shape — the destructive cancel stamps the
// snapshot in the same transaction as the status
// flip, the admin-only exception endpoint
// mutates the snapshot, the read-only projection
// endpoint serves the live state to the panel,
// and the admin UI surface (the new
// `CancellationLiabilityPanel` + the exception
// modal) wires the actions.
//
// These are source-text guards — the test reads
// the source files + greps for the expected
// patterns. End-to-end coverage (book → collect
// → cancel outside/inside cutoff → partial
// refund → complete refund → exception → full
// refund) ships with CRL-09 alongside the
// staging rehearsal.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

const sharedCancellationSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/cancellation.ts"),
  "utf8"
);

const adminBookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

const adminLiabilityPanelSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/CancellationLiabilityPanel.tsx"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

describe("CRL-07 — `CancellationLiability` type lives in shared/types", () => {
  it("declares the `CancellationLiability` interface with policyResult + approvedAmount + exception", () => {
    expect(sharedTypesSrc).toMatch(/export interface CancellationLiability \{/);
    expect(sharedTypesSrc).toMatch(/policyResult:\s*CancellationPolicyResult/);
    expect(sharedTypesSrc).toMatch(/approvedAmount:\s*number/);
    expect(sharedTypesSrc).toMatch(/exception:\s*CancellationExceptionAudit\s*\|\s*null/);
  });

  it("declares the immutable `CancellationPolicyResult` shape (no setter / no update flow)", () => {
    expect(sharedTypesSrc).toMatch(/export interface CancellationPolicyResult \{/);
    expect(sharedTypesSrc).toMatch(/refundPct:\s*number/);
    expect(sharedTypesSrc).toMatch(/policyRefund:\s*number/);
    expect(sharedTypesSrc).toMatch(/netCollected:\s*number/);
    expect(sharedTypesSrc).toMatch(/retainedAmount:\s*number/);
    expect(sharedTypesSrc).toMatch(/cutoffHours:\s*number/);
    expect(sharedTypesSrc).toMatch(/snapshottedAt:\s*Date/);
  });

  it("declares the `CancellationLiabilityState` union of five states", () => {
    expect(sharedTypesSrc).toMatch(/export type CancellationLiabilityState\s*=\s*([^]*?)"not-required"([^]*?)"retained"([^]*?)"pending-processing"([^]*?)"partially-processed"([^]*?)"processed"/);
  });

  it("declares the `CancellationExceptionAudit` shape (approvedAmount + reason + approvedBy + approvedAt)", () => {
    expect(sharedTypesSrc).toMatch(/export interface CancellationExceptionAudit \{/);
    expect(sharedTypesSrc).toMatch(/approvedAmount:\s*number/);
    expect(sharedTypesSrc).toMatch(/reason:\s*string/);
    expect(sharedTypesSrc).toMatch(/approvedBy:\s*string/);
    expect(sharedTypesSrc).toMatch(/approvedAt:\s*Date/);
  });

  it("mounts `cancellationLiability` on the `Reservation` and `Booking` interfaces", () => {
    // Reservation header: stamped on reservation-scope cancels.
    expect(sharedTypesSrc).toMatch(/export interface Reservation \{[^]*?cancellationLiability\?:\s*CancellationLiability\s*\|\s*null[^]*?^\}/m);
    // Booking: stamped on per-child + legacy cancels.
    expect(sharedTypesSrc).toMatch(/export interface Booking \{[^]*?cancellationLiability\?:\s*CancellationLiability\s*\|\s*null[^]*?^\s*\}/m);
  });
});

describe("CRL-07 — `computeCancellationLiabilityState` + `buildCancellationLiabilitySnapshot` in shared/utils/cancellation", () => {
  it("exports the state machine helper with the documented return shape", () => {
    expect(sharedCancellationSrc).toMatch(/export function computeCancellationLiabilityState\(/);
    // The return shape includes state, liability, processedAmount,
    // outstandingAmount, retentionAmount, stateLabel.
    expect(sharedCancellationSrc).toMatch(/state:\s*CancellationLiabilityState/);
    expect(sharedCancellationSrc).toMatch(/outstandingAmount:\s*number/);
    expect(sharedCancellationSrc).toMatch(/retentionAmount:\s*number/);
    expect(sharedCancellationSrc).toMatch(/stateLabel:\s*string/);
  });

  it("exports the snapshot builder", () => {
    expect(sharedCancellationSrc).toMatch(/export function buildCancellationLiabilitySnapshot\(/);
  });

  it("the state machine prefers the exception flag over the processed-vs-pending check", () => {
    // The state order matters: `approvedAmount <
    // policyRefund` (retained) takes precedence over
    // `processed === 0` (pending-processing). The
    // comment in the source must explain this so a
    // future refactor cannot silently swap the order.
    const computeFnBody = sharedCancellationSrc.slice(
      sharedCancellationSrc.indexOf("export function computeCancellationLiabilityState"),
      sharedCancellationSrc.indexOf("// Per CRL-07 (2026-08-03", sharedCancellationSrc.indexOf("export function computeCancellationLiabilityState"))
    );
    expect(computeFnBody).toMatch(/approvedAmount\s*<\s*policyRefund/);
    expect(computeFnBody).toMatch(/processedAmount\s*===\s*0/);
  });
});

describe("CRL-07 — destructive cancel handler materialises the liability snapshot in-transaction", () => {
  it("imports `buildCancellationLiabilitySnapshot` from `@spark-inn/shared`", () => {
    expect(bookingsHandlerSrc).toMatch(/import\s*\{[^}]*buildCancellationLiabilitySnapshot[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
  });

  it("defines a `computeCancellationLiabilityInTransaction` helper used by both cancel branches", () => {
    expect(bookingsHandlerSrc).toMatch(/async function computeCancellationLiabilityInTransaction\(/);
  });

  it("the helper reads the reservation folio via the dual-read pattern (payments + refunds)", () => {
    // The helper's body reads both
    // `reservations/{id}/payments` and
    // `reservations/{id}/refunds` (or
    // `bookings/{id}/payments` for legacy) and sums
    // them sign-aware. The signature-aware sum is the
    // CRL-01 / MRB-04 Phase 2.x contract.
    const helperBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("async function computeCancellationLiabilityInTransaction"),
      bookingsHandlerSrc.indexOf("\n}\n", bookingsHandlerSrc.indexOf("async function computeCancellationLiabilityInTransaction"))
    );
    expect(helperBody).toMatch(/reservationRefundsSnap/);
    expect(helperBody).toMatch(/reservationPaymentsSnap/);
    expect(helperBody).toMatch(/legacyFolioSnap/);
  });

  it("the helper returns `null` for a no-refund cancel (the absence-of-field is the signal)", () => {
    const helperBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("async function computeCancellationLiabilityInTransaction"),
      bookingsHandlerSrc.indexOf("\n}\n", bookingsHandlerSrc.indexOf("async function computeCancellationLiabilityInTransaction"))
    );
    expect(helperBody).toMatch(/preview\.policyRefund\s*<=\s*0/);
    expect(helperBody).toMatch(/return null/);
  });

  it("the reservation-scope cancel branch writes the snapshot to the reservation header", () => {
    // The if-branch (`isReservationScope`) must
    // include `cancellationLiability` in the
    // `transaction.update(reservationRef, ...)`
    // call when the helper produced a snapshot.
    const resScopeBranch = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("if (isReservationScope)"),
      bookingsHandlerSrc.indexOf("} else {", bookingsHandlerSrc.indexOf("if (isReservationScope)"))
    );
    expect(resScopeBranch).toMatch(/liabilitySnapshot/);
    expect(resScopeBranch).toMatch(/reservationHeaderUpdate\.cancellationLiability/);
  });

  it("the per-child cancel branch writes the snapshot to the cancelled booking doc", () => {
    // The else-branch (per-child path) must include
    // the snapshot in the `transaction.update(bookingDocumentRef, ...)`
    // call. The snapshot lives on the booking doc
    // for per-child cancels + legacy null-reservation
    // bookings; the reservation header is NOT
    // touched for the per-child liability (the
    // header's `paymentStatus` is the only mirror).
    const perChildBranch = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("} else {", bookingsHandlerSrc.indexOf("if (isReservationScope)")),
      bookingsHandlerSrc.indexOf("});\n    }", bookingsHandlerSrc.indexOf("} else {", bookingsHandlerSrc.indexOf("if (isReservationScope)"))) + 5
    );
    expect(perChildBranch).toMatch(/bookingUpdate\.cancellationLiability/);
  });
});

describe("CRL-07 — admin-only exception endpoint + read-only projection endpoint", () => {
  it("declares `handleRecordCancellationException` (admin-only, requires reason + approvedAmount ≤ policyRefund)", () => {
    expect(bookingsHandlerSrc).toMatch(/export async function handleRecordCancellationException\(/);
    // Admin-only gate.
    const handlerBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleRecordCancellationException"),
      bookingsHandlerSrc.indexOf("export async function handleGetCancellationLiability")
    );
    expect(handlerBody).toMatch(/req\.staff\?\.role\s*!==\s*["']admin["']/);
    // Reason + approvedAmount validation.
    expect(handlerBody).toMatch(/A reason is required/);
    expect(handlerBody).toMatch(/Approved amount cannot exceed the policy refund/);
    // Idempotency check (same amount + reason replays).
    expect(handlerBody).toMatch(/idempotentReplay/);
  });

  it("declares `handleGetCancellationLiability` (read-only projection)", () => {
    expect(bookingsHandlerSrc).toMatch(/export async function handleGetCancellationLiability\(/);
    // Reads the refunds subcollection (new path) or
    // filters `bookings/{id}/payments` for negative
    // entries (legacy path).
    const handlerBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleGetCancellationLiability"),
      bookingsHandlerSrc.indexOf("export async function handleMarkPaymentConfirmed")
    );
    expect(handlerBody).toMatch(/targetRef\.collection\(["']refunds["']\)/);
    expect(handlerBody).toMatch(/Number\(d\.data\(\)\?\.amount\)\s*<\s*0/);
  });

  it("registers both routes in the apiRouter with admin-only + staff auth gates", () => {
    expect(apiRouterSrc).toMatch(/domain === ["']bookings["']\s*&&\s*action === ["']cancellation-exception["']/);
    expect(apiRouterSrc).toMatch(/domain === ["']bookings["']\s*&&\s*action === ["']cancellation-liability["']/);
    // The exception route uses the standard
    // `authenticateStaff` flow (the handler is the
    // source of truth for the admin role check,
    // mirroring `add-refund`).
    const exceptionBlock = apiRouterSrc.slice(
      apiRouterSrc.indexOf('action === "cancellation-exception"'),
      apiRouterSrc.indexOf('action === "cancellation-liability"')
    );
    expect(exceptionBlock).toMatch(/authenticateStaff\(req\)/);
    expect(exceptionBlock).toMatch(/handleRecordCancellationException/);
  });
});

describe("CRL-07 — admin UI: panel + exception modal + type hydration", () => {
  it("the `CancellationLiabilityPanel` + `CancellationExceptionModal` components exist", () => {
    expect(adminLiabilityPanelSrc).toMatch(/export function CancellationLiabilityPanel\(/);
    expect(adminLiabilityPanelSrc).toMatch(/export function CancellationExceptionModal\(/);
  });

  it("the panel calls `/api/bookings/cancellation-liability` (the read-only projection endpoint)", () => {
    expect(adminLiabilityPanelSrc).toMatch(/\/api\/bookings\/cancellation-liability/);
  });

  it("the panel gates the action buttons on `isAdmin` (front-desk staff see the breakdown but no buttons)", () => {
    expect(adminLiabilityPanelSrc).toMatch(/isAdmin\s*&&/);
    expect(adminLiabilityPanelSrc).toMatch(/data-testid="liab-open-refund"/);
    expect(adminLiabilityPanelSrc).toMatch(/data-testid="liab-open-exception"/);
  });

  it("the exception modal calls `/api/bookings/cancellation-exception` and bounds the amount to `policyRefund`", () => {
    expect(adminLiabilityPanelSrc).toMatch(/\/api\/bookings\/cancellation-exception/);
    expect(adminLiabilityPanelSrc).toMatch(/max=\{policyRefund\}/);
    // Required reason + the "can only reduce, never increase" copy.
    expect(adminLiabilityPanelSrc).toMatch(/A reason is required for the exception/);
    expect(adminLiabilityPanelSrc).toMatch(/exception can only reduce/);
  });

  it("the BookingsPage mounts the panel inside the drawer when the booking is cancelled", () => {
    expect(adminBookingsPageSrc).toMatch(/selectedBooking\.status === ["']cancelled["']/);
    expect(adminBookingsPageSrc).toMatch(/<CancellationLiabilityPanel/);
    expect(adminBookingsPageSrc).toMatch(/<CancellationExceptionModal/);
  });

  it("the BookingsPage bumps the panel's `refreshKey` after a successful refund OR exception", () => {
    // After `handleRefundSubmit` succeeds, the parent
    // bumps the key so the panel re-projects the live
    // `processedAmount` without waiting for the
    // Firestore onSnapshot. Same after the exception
    // modal's onSuccess.
    const refundSection = adminBookingsPageSrc.slice(
      adminBookingsPageSrc.indexOf("setRefundError(null)"),
      adminBookingsPageSrc.indexOf("} finally {", adminBookingsPageSrc.indexOf("setRefundError(null)"))
    );
    expect(refundSection).toMatch(/setLiabilitySnapshotKey/);
    expect(adminBookingsPageSrc).toMatch(/onSuccess=\{\(\) => \{[^}]*setLiabilitySnapshotKey/m);
  });

  it("the admin `Booking` type hydrates `cancellationLiability` from the Firestore snapshot", () => {
    expect(adminContextSrc).toMatch(/cancellationLiability\?:\s*import\(["']@spark-inn\/shared["']\)\.CancellationLiability\s*\|\s*null/);
    // The hydration reads the field off the raw
    // `data` object (Firestore's onSnapshot payload).
    const hydration = adminContextSrc.slice(
      adminContextSrc.indexOf("cancellationSource: data.cancellationSource"),
      adminContextSrc.indexOf("createdAt: parseDateTimeString(data.createdAt)")
    );
    expect(hydration).toMatch(/cancellationLiability:\s*data\.cancellationLiability\s*\|\|\s*null/);
  });
});
