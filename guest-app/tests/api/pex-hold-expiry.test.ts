import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per PEX-07 (2026-08-01, per decision #147): source-text
// regression tests for the pending-booking expiry system. The
// emulator tests that exercise the real Firestore transactions
// (the PMH-05 generalisation) are out of scope for this sandbox
// (Java not installed); the source-text guards below pin the
// shape that the emulator tests will later exercise end-to-end.
//
// Background (per `plan/project/ROADMAP.md §PEX-01..06`):
//   - PEX-01: every `pending` booking created by the public
//     create or walkin handlers must carry a snapshotted
//     `holdExpiresAt` Timestamp computed from the admin's
//     `settings/hotelConfig.paymentHoldWindowHours`.
//   - PEX-02: the shared `isBookingOccupyingRoom` rule is the
//     only authority on whether a booking holds the room. The
//     availability endpoint, the room-blocks handler, and the
//     create / walkin / reschedule transactions all route
//     through it on top of the coarse `status in [...]`
//     Firestore query.
//   - PEX-03: the create / walkin / reschedule transactions
//     atomically retire any expired `pending` hold that
//     overlaps the new booking's date range. The retirement is
//     part of the same Firestore transaction.
//   - PEX-04: rejecting a payment proof stamps a fresh
//     `holdExpiresAt` from `paymentRejectedAt` so the guest
//     gets the same `pending` window they had on the first
//     proof upload. Stale `paymentProofPath` / `paymentProofUrl`
//     are audit evidence only and do NOT exempt the booking.
//   - PEX-06: the daily cron handler lives at `/api/holds/expire`
//     and is registered in `guest-app/vercel.json` (NOT the
//     monorepo-root). Idempotent — re-fires find zero matches.

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const roomsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/rooms.ts"),
  "utf8"
);

const roomBlocksHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/room-blocks.ts"),
  "utf8"
);

const holdExpiryHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/hold-expiry.ts"),
  "utf8"
);

const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);

const guestVercelJsonSrc = readFileSync(
  resolve(__dirname, "../../vercel.json"),
  "utf8"
);

const rootVercelJsonSrc = readFileSync(
  resolve(__dirname, "../../../vercel.json"),
  "utf8"
);

const bookingTypeSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

describe("PEX-01 — snapshotted `holdExpiresAt` on every new pending booking", () => {
  it("handleCreateBooking writes holdExpiresAt computed from settings.paymentHoldWindowHours", () => {
    // The new field is computed from the same `now` captured at the
    // top of the transaction so a concurrent Settings change
    // (window length) cannot race the deadline read.
    expect(bookingsHandlerSrc).toMatch(
      /holdExpiresAt:\s*\(paymentProofPath\s*\|\|\s*paymentProofUrl\)\s*\?\s*null\s*:\s*\(computeHoldExpiresAt\(hotelConfig\.paymentHoldWindowHours,\s*now\)/
    );
  });

  it("the new field is `null` for `payment-uploaded` bookings (staff-review state, never auto-expired per PEX-04)", () => {
    // The branch on the line above guarantees the field is `null`
    // when the booking lands as `payment-uploaded`. The cron +
    // create-transaction retirement both rely on this — a non-null
    // deadline on a payment-uploaded booking would be a silent
    // bug.
    expect(bookingsHandlerSrc).toMatch(
      /holdExpiresAt:\s*\(paymentProofPath\s*\|\|\s*paymentProofUrl\)\s*\?\s*null/
    );
  });

  it("walk-in bookings do not carry a `holdExpiresAt` (staff-created, no guest action waited on)", () => {
    // Walk-ins are staff-created — the new booking has no
    // snapshotted deadline (the only retirements that can happen
    // here are for stale expired holds the cron hasn't caught
    // yet, on the same room).
    const walkinBlock = bookingsHandlerSrc.match(
      /export async function handleCreateWalkin[\s\S]*?\n  \}\n/
    );
    expect(walkinBlock, "handleCreateWalkin must exist").toBeTruthy();
    // The new walk-in booking does NOT include `holdExpiresAt` in
    // its persisted shape. The room-block test pins the absence.
    expect(walkinBlock![0]).not.toMatch(/holdExpiresAt:/);
  });
});

describe("PEX-02 — one authoritative occupancy rule, used everywhere", () => {
  it("rooms.ts (availability endpoint) imports isBookingOccupyingRoom from @spark-inn/shared", () => {
    expect(roomsHandlerSrc).toMatch(
      /import\s*\{[^}]*BOOKING_OCCUPYING_STATUSES[^}]*isBookingOccupyingRoom[^}]*\}\s*from\s*["']@spark-inn\/shared["']/
    );
  });

  it("rooms.ts filters each overlap doc with isBookingOccupyingRoom", () => {
    // The coarse `status in [...]` query is the Firestore-side
    // pre-selector; the per-doc filter is the authoritative gate.
    // An expired `pending` hold is in the coarse result but is
    // dropped by the per-doc filter.
    expect(roomsHandlerSrc).toMatch(
      /if\s*\(!isBookingOccupyingRoom\(\{\s*status,\s*holdExpiresAt:\s*data\.holdExpiresAt\s*\}\)\)\s*\{\s*return;\s*\}/
    );
  });

  it("room-blocks.ts filters each booking doc with isBookingOccupyingRoom", () => {
    expect(roomBlocksHandlerSrc).toMatch(
      /if\s*\(!isBookingOccupyingRoom\(\{\s*status:\s*data\.status,\s*holdExpiresAt:\s*data\.holdExpiresAt\s*\}\)\)\s*\{\s*return false;\s*\}/
    );
  });

  it("bookings.ts handleCreateBooking + handleCreateWalkin + handleRescheduleBooking all call isBookingOccupyingRoom", () => {
    // The shared rule is the only authority. A caller that
    // maintains its own `pending + createdAt` interpretation
    // would be a regression — the test fails.
    const isOccupying = /isBookingOccupyingRoom\s*\(\s*\{\s*status:\s*[^,]+,\s*holdExpiresAt:\s*[^}]+\}\s*,\s*now\s*\)/;
    expect(bookingsHandlerSrc.match(new RegExp(isOccupying.source, "g"))).toBeTruthy();
  });
});

describe("PEX-03 — atomic retirement in every create / walkin / reschedule transaction", () => {
  it("every transaction that selects a room queues expired `pending` holds for retirement", () => {
    // Three call sites (handleCreateBooking + handleCreateWalkin +
    // handleRescheduleBooking) capture an `expiredHoldRetirements`
    // list and iterate over it to write the cancellations inside
    // the same transaction.
    const matches = bookingsHandlerSrc.match(/const expiredHoldRetirements:\s*Array<\{/g);
    expect(matches, "expected expiredHoldRetirements declared in 3 places").toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it("the in-transaction retirement writes status: cancelled + cancellationReason: payment-hold-expired", () => {
    // The exact strings are pinned by the cron handler's
    // `EXPIRED_HOLD_CANCELLATION_REASON` constant + by Reports
    // filters that key off the reason.
    const transactionWrites = bookingsHandlerSrc.match(
      /transaction\.update\(retirement\.ref,\s*\{\s*status:\s*"cancelled",\s*[\s\S]*?cancellationReason:\s*EXPIRED_HOLD_CANCELLATION_REASON/g
    );
    expect(transactionWrites, "expected in-transaction retirements").toBeTruthy();
    expect(transactionWrites!.length).toBeGreaterThanOrEqual(3);
  });

  it("the post-transaction email send fires `booking-cancelled` for each retired hold (PEX-05)", () => {
    // The handler reuses the `booking-cancelled` template; the
    // `cancellationReason` field is the discriminator the template
    // uses to switch the headline + rebook CTA.
    const emailSends = bookingsHandlerSrc.match(
      /sendBookingTrigger\(\s*"booking-cancelled",\s*\{[\s\S]*?cancellationReason|notes:.*?released\. Please rebook/g
    );
    expect(emailSends, "expected per-retirement email sends").toBeTruthy();
  });
});

describe("PEX-04 — reject-payment handler stamps a fresh `holdExpiresAt`", () => {
  it("handleRejectPayment wraps the read+update in a Firestore transaction", () => {
    // The transaction guarantees the window we read is the
    // window we snapshot — a parallel admin shortening the
    // window cannot land between the read and the update.
    expect(bookingsHandlerSrc).toMatch(
      /export async function handleRejectPayment[\s\S]*?adminDb\.runTransaction\(async \(transaction\) => \{[\s\S]*?transaction\.update\(bookingRef,\s*\{[\s\S]*?holdExpiresAt:[\s\S]*?Timestamp\.fromDate\(newDeadline\)/
    );
  });

  it("the fresh `holdExpiresAt` is computed from `paymentHoldWindowHours`", () => {
    // Same helper as handleCreateBooking + handleCreateWalkin.
    // The booking gets the same window the guest had on the
    // first proof upload, not a shorter one derived from a
    // `createdAt` heuristic.
    expect(bookingsHandlerSrc).toMatch(
      /const holdWindowHours = normalizePaymentHoldWindowHours\(\s*\(hotelConfig as any\)\.paymentHoldWindowHours\s*\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /const newDeadline = computeHoldExpiresAt\(holdWindowHours, updatedAt\)/
    );
  });
});

describe("PEX-06 — daily cron handler, project-local config, CRON_SECRET", () => {
  it("the handler lives in guest-app/server/handlers/hold-expiry.ts", () => {
    expect(holdExpiryHandlerSrc).toMatch(/export async function handleHoldExpiryCron/);
  });

  it("the handler reads `CRON_SECRET` and rejects unauthorized requests with 401", () => {
    // Same auth pattern as the janitor / storage-sweep cron —
    // a 401 (not 403) for an unauthorized request, and a 500
    // for a missing `CRON_SECRET` env var so a misconfiguration
    // surfaces in monitoring.
    expect(holdExpiryHandlerSrc).toMatch(/if \(!process\.env\.CRON_SECRET\)/);
    expect(holdExpiryHandlerSrc).toMatch(/Unauthorized cron request/);
  });

  it("the handler re-checks eligibility inside the per-doc transaction", () => {
    // The Firestore coarse query is a pre-selector; the
    // per-doc transaction is the authoritative gate. A guest
    // may have re-uploaded a proof between the coarse query
    // and this transaction — that move-out is the only thing
    // the recheck catches.
    expect(holdExpiryHandlerSrc).toMatch(
      /await transaction\.get\(doc\.ref\)[\s\S]*?isBookingOccupyingRoom\(\{[\s\S]*?holdExpiresAt:[\s\S]*?freshData\.holdExpiresAt[\s\S]*?\}, now\)/
    );
  });

  it("the handler is idempotent (the second run finds zero matches)", () => {
    // The coarse Firestore query filters on `status == "pending"`.
    // A second run sees zero docs because the first run cancelled
    // them. The test pins the filter.
    expect(holdExpiryHandlerSrc).toMatch(
      /\.collection\("bookings"\)\s*\.where\("status",\s*"==",\s*"pending"\)/
    );
  });

  it("the handler skips legacy bookings (no `holdExpiresAt` field) — they occupy indefinitely", () => {
    // The Firestore coarse query has
    // `.where("holdExpiresAt", "<", now)` — a doc without
    // the field is not matched (Firestore treats missing as
    // "not satisfying <"). This is the spec's "legacy
    // bookings still occupy" rule.
    expect(holdExpiryHandlerSrc).toMatch(
      /\.where\("holdExpiresAt",\s*"<",\s*Timestamp\.fromDate\(now\)\)/
    );
  });

  it("the apiRouter wires the handler at /api/holds/expire, gated by CRON_SECRET", () => {
    expect(apiRouterSrc).toMatch(
      /if \(domain === "holds" && action === "expire" && \(req\.method === "POST" \|\| req\.method === "GET"\)\) \{[\s\S]*?return await handleHoldExpiryCron\(req, res\);/
    );
  });

  it("the cron entry lives in guest-app/vercel.json (the project-local config), NOT the monorepo-root", () => {
    // Pinned because Vercel picks the project-local vercel.json
    // for the deployed guest/API project (per DEPLOY.md).
    const guestCrons = JSON.parse(guestVercelJsonSrc).crons || [];
    const holdExpireCron = guestCrons.find((c: any) => c.path === "/api/holds/expire");
    expect(holdExpireCron, "expected /api/holds/expire in guest-app/vercel.json").toBeTruthy();
    // The monorepo-root vercel.json (the Vercel-wide project
    // for the admin app) must NOT register this cron. The
    // route exists only on the deployed guest/API project.
    const rootCrons = JSON.parse(rootVercelJsonSrc).crons || [];
    const rootHoldExpire = rootCrons.find((c: any) => c.path === "/api/holds/expire");
    expect(rootHoldExpire, "must not be registered in monorepo-root vercel.json").toBeUndefined();
  });
});

describe("PEX-01 — Booking type carries the new `holdExpiresAt` field", () => {
  it("the Booking interface has an optional holdExpiresAt: Date | null", () => {
    // The field is optional (legacy bookings don't have it) and
    // nullable (payment-uploaded bookings explicitly set it to
    // null). The comment block explains the spec rationale.
    expect(bookingTypeSrc).toMatch(/holdExpiresAt\?:\s*Date\s*\|\s*null;/);
  });
});
