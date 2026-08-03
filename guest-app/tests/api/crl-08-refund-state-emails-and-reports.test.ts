// Per CRL-08 (2026-08-03, per decision #174):
// source-text guards for the refund-state email
// + persistent staff notifications + Reports
// liability queue. The five-state machine +
// `computeCancellationLiabilityState` helper are
// pinned by the unit tests in
// `shared/__tests__/crl-07-liability-state.test.ts`;
// this file pins the wiring (the destructive
// cancel sends a staff notification when it
// stamps a non-null liability, `handleAddRefund`
// fires the new `booking-refund-processed` email
// when the state actually changes, the admin
// Reports page mounts the new "Liability" tab,
// and the admin NotificationBell renders the
// new `cancellation-refund` type).
//
// These are source-text guards — the test reads
// the source files + greps for the expected
// patterns. End-to-end coverage (book → collect →
// cancel → partial refund → complete refund →
// exception → full refund) follows in CRL-09.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

const adminReportsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/ReportsPage.tsx"),
  "utf8"
);

const adminLiabilityTabSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/LiabilityTab.tsx"),
  "utf8"
);

const adminNotificationBellSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/NotificationBell.tsx"),
  "utf8"
);

describe("CRL-08 — `cancellation-refund` notification type lives in shared/types", () => {
  it("extends `NotificationType` with `cancellation-refund`", () => {
    expect(sharedTypesSrc).toMatch(/export type NotificationType\s*=\s*([^]*?)\|\s*"cancellation-refund"/);
  });
});

describe("CRL-08 — cancellation email renders the financial breakdown", () => {
  it("the `bookingCancelledEmail` template reads `liabilityProjection` for the breakdown", () => {
    // The new copy tailors the "what happens
    // next" callout to the actual numbers when
    // the projection is present; the legacy
    // generic copy stays for pre-CRL-07 cancels.
    expect(emailHandlerSrc).toMatch(/function bookingCancelledEmail\(booking: any\)/);
    expect(emailHandlerSrc).toMatch(/booking\.liabilityProjection/);
  });

  it("the `bookingCancelledReservationEmail` template reads `liabilityProjection` for the breakdown", () => {
    expect(emailHandlerSrc).toMatch(/function bookingCancelledReservationEmail\(booking: any\)/);
    // Same breakdown-aware callout. The
    // reservation-scope path also renders the
    // breakdown card.
    expect(emailHandlerSrc).toMatch(/liabilityBreakdownCard\(projection\)/);
  });

  it("a shared `liabilityBreakdownCard` helper renders the policy / approved / processed / outstanding rows", () => {
    // The helper is the single source of truth
    // for the breakdown card — both the
    // per-child + reservation-scope templates
    // render it.
    expect(emailHandlerSrc).toMatch(/function liabilityBreakdownCard\(projection: any\)/);
    expect(emailHandlerSrc).toMatch(/row\(\"Net collected at cancel\"/);
    expect(emailHandlerSrc).toMatch(/row\(`Policy refund \(/);
    expect(emailHandlerSrc).toMatch(/row\(\"Approved refund\"/);
    expect(emailHandlerSrc).toMatch(/row\(\"Processed so far\"/);
    expect(emailHandlerSrc).toMatch(/row\(\"Outstanding\"/);
  });

  it("the `loadReservationEmailView` helper attaches the liability projection to the view", () => {
    // The view loader calls
    // `loadLiabilityProjectionForEmail` and
    // attaches the result to `view.liabilityProjection`
    // so the templates can read it.
    const viewLoaderBlock = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("async function loadReservationEmailView"),
      bookingsHandlerSrc.indexOf("async function isExpiredPendingHold")
    );
    expect(viewLoaderBlock).toMatch(/loadLiabilityProjectionForEmail/);
    expect(viewLoaderBlock).toMatch(/view\.liabilityProjection/);
  });

  it("the per-child + legacy path of `handleCancelBooking` also loads the projection (for the bare-booking view)", () => {
    // The reservation-scope + per-child-with-
    // reservationId path goes through
    // `loadReservationEmailView` (which loads
    // the projection internally). The legacy
    // null-`reservationId` path passes
    // `bookingData` directly, so the handler
    // must also load the projection for that
    // branch.
    const cancelBlock = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("const reservationView = await loadReservationEmailView"),
      bookingsHandlerSrc.indexOf("on email failure", cancelHint(cancelHint ? 0 : 0) + 1)
    );
    expect(cancelBlock).toMatch(/reservationView\s*\?\s*reservationView\.liabilityProjection\s*:\s*await loadLiabilityProjectionForEmail/);
  });
});

describe("CRL-08 — new `booking-refund-processed` email action", () => {
  it("extends `EmailAction` with `booking-refund-processed`", () => {
    expect(emailHandlerSrc).toMatch(/type EmailAction\s*=\s*([^]*?)\|\s*"booking-refund-processed"/);
  });

  it("declares `bookingRefundProcessedEmail` template that renders the latest refund + state", () => {
    expect(emailHandlerSrc).toMatch(/function bookingRefundProcessedEmail\(booking: any\)/);
    // The template tailors the copy to the
    // new state — "Your refund is in progress",
    // "Your refund is now complete", etc.
    expect(emailHandlerSrc).toMatch(/projection\?\.state === "processed"/);
    expect(emailHandlerSrc).toMatch(/projection\?\.state === "partially-processed"/);
  });

  it("the `sendBookingTrigger` templates map includes the new action", () => {
    // The template function returns the full
    // `{ subject, html }` because the subject
    // depends on the liability projection
    // (the "Refund update: <ref>" subject).
    const mapBlock = emailHandlerSrc.slice(
      emailHandlerSrc.indexOf("const templates: Record<string"),
      emailHandlerSrc.indexOf("const template = templates[action]")
    );
    expect(mapBlock).toMatch(/"booking-refund-processed":\s*bookingRefundProcessedEmail\(booking\)/);
  });
});

describe("CRL-08 — `handleAddRefund` fires the new email + notification on state change", () => {
  it("computes the prior + new liability state inside the transaction (the gate)", () => {
    // The state-change gate lives in the
    // transaction so the prior + new states
    // are read against the same refund write.
    // The closure-scoped `priorStateRef` +
    // `newStateRef` carry the values to the
    // post-commit side-effect.
    const handlerBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAddRefund"),
      bookingsHandlerSrc.indexOf("} catch (error: any) {", bookingsHandlerSrc.indexOf("export async function handleAddRefund"))
    );
    expect(handlerBody).toMatch(/priorStateRef\s*=/);
    expect(handlerBody).toMatch(/newStateRef\s*=/);
    expect(handlerBody).toMatch(/computeCancellationLiabilityState/);
  });

  it("calls the post-commit `fireRefundStateEmailAndNotification` helper when the state changed", () => {
    const handlerBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAddRefund"),
      bookingsHandlerSrc.indexOf("} catch (error: any) {", bookingsHandlerSrc.indexOf("export async function handleAddRefund"))
    );
    expect(handlerBody).toMatch(/fireRefundStateEmailAndNotification/);
    // The state-change gate is the explicit
    // check: `priorStateRef !== newStateRef`.
    expect(handlerBody).toMatch(/priorStateRef\s*!==\s*newStateRef/);
    // The idempotent-replay path skips the
    // email + notification (no state change).
    expect(handlerBody).toMatch(/!idempotentReplay/);
  });

  it("declares `fireRefundStateEmailAndNotification` helper that fires the email + writes a notification", () => {
    // The helper lives just above
    // `handleAddRefund` and is best-effort
    // (errors logged + swallowed).
    const helperBlock = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("async function fireRefundStateEmailAndNotification"),
      bookingsHandlerSrc.indexOf("export async function handleAddRefund")
    );
    expect(helperBlock).toMatch(/sendBookingTrigger\(["']booking-refund-processed["']/);
    expect(helperBlock).toMatch(/writeNotification/);
    expect(helperBlock).toMatch(/type: ["']cancellation-refund["']/);
  });
});

describe("CRL-08 — `handleCancelBooking` writes a staff notification when the liability is non-null", () => {
  it("calls `writeNotification` with the `cancellation-refund` type after the cancel commit", () => {
    const handlerBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleCancelBooking"),
      bookingsHandlerSrc.indexOf("} catch (error: any) {", bookingsHandlerSrc.indexOf("export async function handleCancelBooking"))
    );
    expect(handlerBody).toMatch(/writeNotification/);
    expect(handlerBody).toMatch(/type: ["']cancellation-refund["']/);
  });

  it("reads the just-stamped liability from the same location the cancel wrote to (reservation header OR booking doc)", () => {
    const handlerBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleCancelBooking"),
      bookingsHandlerSrc.indexOf("} catch (error: any) {", bookingsHandlerSrc.indexOf("export async function handleCancelBooking"))
    );
    // The dual-source read: reservation header
    // for new reservations, booking doc for
    // legacy null-`reservationId`.
    expect(handlerBody).toMatch(/liabilityTargetRef\s*=\s*lookedUpReservationId/);
    expect(handlerBody).toMatch(/cancellationLiability/);
  });

  it("skips the notification when no liability was stamped (no-refund cancel)", () => {
    const handlerBody = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleCancelBooking"),
      bookingsHandlerSrc.indexOf("} catch (error: any) {", bookingsHandlerSrc.indexOf("export async function handleCancelBooking"))
    );
    expect(handlerBody).toMatch(/if \(liability && liability\.policyResult\)/);
  });
});

describe("CRL-08 — Reports liability queue", () => {
  it("extends `ReportTab` with the `liability` value", () => {
    expect(adminReportsPageSrc).toMatch(/type ReportTab\s*=\s*"performance"\s*\|\s*"sales"\s*\|\s*"daily-close"\s*\|\s*"liability"/);
  });

  it("renders the new tab button + the `LiabilityTab` component when active", () => {
    expect(adminReportsPageSrc).toMatch(/data-testid="report-tab-liability"/);
    expect(adminReportsPageSrc).toMatch(/<LiabilityTab/);
    expect(adminReportsPageSrc).toMatch(/activeTab === "liability" &&/);
  });

  it("the `LiabilityTab` component reads reservation + booking data + computes the metrics", () => {
    // The component does the dual-source
    // read (reservation header for new
    // reservations, booking doc for legacy
    // null-`reservationId`).
    expect(adminLiabilityTabSrc).toMatch(/getDocs\(collection\(db, "reservations"\)\)/);
    expect(adminLiabilityTabSrc).toMatch(/getDocs\(collectionGroup\(db, "refunds"\)\)/);
    // The state helper is the same one CRL-07
    // pinned.
    expect(adminLiabilityTabSrc).toMatch(/computeCancellationLiabilityState/);
    // The headline metrics are surfaced.
    expect(adminLiabilityTabSrc).toMatch(/data-testid="liability-headline-metrics"/);
    expect(adminLiabilityTabSrc).toMatch(/data-testid="liability-age-buckets"/);
    expect(adminLiabilityTabSrc).toMatch(/data-testid="liability-pending-list"/);
    expect(adminLiabilityTabSrc).toMatch(/data-testid="liability-all-table"/);
  });
});

describe("CRL-08 — admin NotificationBell renders the new type", () => {
  it("`NOTIFICATION_TYPE_META` includes a `cancellation-refund` entry", () => {
    expect(adminNotificationBellSrc).toMatch(/"cancellation-refund":\s*\{\s*label:/);
  });
});

// Tiny helper so the test above's `cancelHint`
// token can resolve (the lookahead regex
// captures everything up to the first `} catch`
// in the handler).
function cancelHint(_v: number) { return 0; }
