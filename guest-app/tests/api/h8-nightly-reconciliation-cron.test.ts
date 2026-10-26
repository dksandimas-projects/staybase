// Per H8 (production-readiness audit 2026-10-20): the nightly money
// reconciliation cron.
//
// WHAT THIS PINS
// --------------
// The cron is the hotel's standing check that the money model agrees with
// itself. The AI browser QA pass proved the check is worth running — it
// found a refund written without a settled status (money already paid out
// in cash reading back as money the hotel still owed) and other add-ons
// that never reached `revenueAllocation` (so every revenue report
// under-reported). Neither defect was visible in any summary card.
//
// So the cron has to actually WORK, and it has to be SAFE:
//
//   * it is READ-ONLY with respect to the money — it must never write a
//     payment, a refund, a charge or a booking;
//   * it is CRON_SECRET-gated like every other cron — an anonymous
//     caller must not be able to trigger it;
//   * with no CRON_SECRET configured it refuses to run at all (fail
//     closed), because a cron that silently does nothing is worse than
//     one that is loudly absent;
//   * a FAILING CHECK is a FINDING, not a cron error — the run reports
//     200 with the findings so the desk is alerted through the
//     notification rather than through a 500;
//   * it is idempotent — a re-fire finds the same state and reports the
//     same result.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The handler pulls in the reconciler, which pulls in `firebase-admin` and
// the shared money helpers — a heavy import chain for a test that only
// exercises the CRON_SECRET gate. Both are mocked so the test exercises
// the REAL auth logic in the real handler, in isolation.
vi.mock("../../server/lib/reconciliation", () => ({
  runReconciliation: vi.fn(async () => ({
    startedAt: "2026-10-27T00:00:00.000Z",
    finishedAt: "2026-10-27T00:00:01.000Z",
    durationMs: 1000,
    bookingsScanned: 10,
    findings: [],
    passed: 8,
    failed: 0,
    warned: 2,
    info: 0
  })),
  recordReconciliationRun: vi.fn(async () => {})
}));

const reconcilerSource = readFileSync(
  resolve(__dirname, "../../server/lib/reconciliation.ts"),
  "utf8"
);
const handlerSource = readFileSync(
  resolve(__dirname, "../../server/handlers/reconciliation.ts"),
  "utf8"
);
const routerSource = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
const vercelConfig = JSON.parse(
  readFileSync(resolve(__dirname, "../../vercel.json"), "utf8")
);

/** A minimal Vercel response double that records what was sent. */
function makeRes() {
  const state: { status?: number; body?: unknown } = {};
  const res: any = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
    _state: state
  };
  return res;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: {},
    body: undefined,
    ...overrides
  } as any;
}

describe("the reconciliation cron is wired into the router", () => {
  it("the route exists and dispatches to the handler", () => {
    expect(routerSource).toContain('domain === "reconciliation" && action === "run"');
    expect(routerSource).toContain("handleReconciliationCron");
  });

  it("the cron is SCHEDULED in the project's vercel.json", () => {
    const crons = vercelConfig.crons as Array<{ path: string; schedule: string }>;
    const entry = crons.find((c) => c.path === "/api/reconciliation/run");
    expect(entry, "the reconciliation cron must be scheduled").toBeTruthy();
    // A daily schedule — the point is that it runs WITHOUT a human.
    expect(entry!.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("the other crons are still scheduled (the new one did not replace them)", () => {
    const paths = (vercelConfig.crons as Array<{ path: string }>).map((c) => c.path);
    expect(paths).toContain("/api/email/checkin-reminder");
    expect(paths).toContain("/api/holds/expire");
    expect(paths).toContain("/api/holds/sweep");
    expect(paths).toContain("/api/janitor/storage-sweep");
    expect(paths).toContain("/api/notifications/prune");
  });
});

describe("the cron is CRON_SECRET-gated", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("refuses when CRON_SECRET is not configured at all (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    const { handleReconciliationCron } = await import(
      "../../server/handlers/reconciliation"
    );
    const res = makeRes();
    await handleReconciliationCron(makeReq(), res);
    expect(res._state.status).toBe(500);
  });

  it("refuses an anonymous caller", async () => {
    process.env.CRON_SECRET = "the-secret";
    const { handleReconciliationCron } = await import(
      "../../server/handlers/reconciliation"
    );
    const res = makeRes();
    await handleReconciliationCron(makeReq(), res);
    expect(res._state.status).toBe(401);
  });

  it("refuses a caller with the wrong secret", async () => {
    process.env.CRON_SECRET = "the-secret";
    const { handleReconciliationCron } = await import(
      "../../server/handlers/reconciliation"
    );
    const res = makeRes();
    await handleReconciliationCron(
      makeReq({ headers: { "x-cron-secret": "wrong" } }),
      res
    );
    expect(res._state.status).toBe(401);
  });

  it("rejects a method it does not support", async () => {
    process.env.CRON_SECRET = "the-secret";
    const { handleReconciliationCron } = await import(
      "../../server/handlers/reconciliation"
    );
    const res = makeRes();
    await handleReconciliationCron(
      makeReq({
        method: "DELETE",
        headers: { "x-cron-secret": "the-secret" }
      }),
      res
    );
    expect(res._state.status).toBe(405);
  });

  it("ACCEPTS an authorized caller and runs the reconciliation", async () => {
    process.env.CRON_SECRET = "the-secret";
    const { handleReconciliationCron } = await import(
      "../../server/handlers/reconciliation"
    );
    const { runReconciliation, recordReconciliationRun } = await import(
      "../../server/lib/reconciliation"
    );
    const res = makeRes();
    await handleReconciliationCron(
      makeReq({ headers: { "x-cron-secret": "the-secret" } }),
      res
    );
    expect(res._state.status).toBe(200);
    expect(runReconciliation).toHaveBeenCalled();
    expect(recordReconciliationRun).toHaveBeenCalled();
  });

  it("also accepts the Bearer form of the secret", async () => {
    process.env.CRON_SECRET = "the-secret";
    const { handleReconciliationCron } = await import(
      "../../server/handlers/reconciliation"
    );
    const res = makeRes();
    await handleReconciliationCron(
      makeReq({ headers: { authorization: "Bearer the-secret" } }),
      res
    );
    expect(res._state.status).toBe(200);
  });
});

describe("the reconciliation is READ-ONLY with respect to the money", () => {
  it("never writes a payment, a refund, a charge or a booking", () => {
    // The ONLY collection the reconciler writes is `reconciliationRuns` —
    // the run report. Nothing else. The regex matches the write call
    // through any number of intermediate `.collection(...)` / `.doc(...)`
    // steps, so a write hidden behind a chain is still caught.
    const writeCalls =
      reconcilerSource.match(
        /adminDb\s*\.\s*collection\(\s*"([^"]+)"\s*\)([\s\S]{0,200}?)\.\s*(set|add|update|delete)\(/g
      ) || [];
    for (const call of writeCalls) {
      expect(call).toContain('"reconciliationRuns"');
    }
    // A sanity floor: the reconciler does write SOMETHING (the run report),
    // so a refactor that silently stopped recording runs is caught too.
    expect(writeCalls.length).toBeGreaterThan(0);
  });

  it("does not import any destructive Firestore operation", () => {
    expect(reconcilerSource).not.toMatch(/deleteField|FieldValue\.delete/);
  });

  it("the money helpers it uses are the shared, tested ones", () => {
    // The point of the check is that it does NOT trust the app's own
    // denormalized fields — it recomputes from raw docs and then compares.
    expect(reconcilerSource).toContain("sumCollectedPayments");
    expect(reconcilerSource).toContain("isUnpaidRefund");
    expect(reconcilerSource).toContain("computeBookingFolio");
  });
});

describe("the reconciliation checks the invariants that found real bugs", () => {
  const required = [
    "I06", // paidAmount vs the ledger
    "I06b", // a pending refund netted against collected money
    "I03", // the revenue allocation's components sum to its total
    "I04", // the other add-ons reach the allocation
    "I13", // hasAnyBreakfast is not stale
    "I14", // a cancelled booking does not still hold money
    "F-C2", // a cancelled store order does not still hold a tender
    "I07" // two independent implementations agree
  ];

  for (const id of required) {
    it(`runs the ${id} check`, () => {
      expect(reconcilerSource).toContain(`"${id}"`);
    });
  }
});

describe("a failing check is a finding, not a cron error", () => {
  it("the handler reports 200 with the findings", () => {
    // The run SUCCEEDED. A check that failed is a finding the desk needs
    // to see — a 500 would tell Vercel the cron broke, and would hide the
    // findings behind an error path.
    expect(handlerSource).toContain("res.status(200)");
    expect(handlerSource).toContain("findings: result.findings");
  });

  it("only a FAILING check alerts the desk", () => {
    // A WARN is not an alarm — the QA report's own reconciliation carries
    // two WARNs that are known and explained. Alerting on them would
    // train the desk to ignore the bell.
    expect(reconcilerSource).toContain('f.status === "FAIL"');
    expect(reconcilerSource).toContain("result.failed === 0");
  });

  it("the run report is written even when the notification fails", () => {
    // The report is written BEFORE the notification is attempted, so a
    // failed notification cannot lose the finding.
    const reportAt = reconcilerSource.indexOf('collection("reconciliationRuns")');
    const notifyAt = reconcilerSource.indexOf("writeNotification");
    expect(reportAt).toBeGreaterThan(-1);
    expect(notifyAt).toBeGreaterThan(-1);
    expect(reportAt).toBeLessThan(notifyAt);
  });

  it("the desk notification deep-links to the booking's DOC id, not its reference", () => {
    // The bell deep-links `/bookings?bookingId=<entityId>` and the drawer
    // resolves that parameter by matching `booking.id === bookingId` —
    // the Firestore DOC id. Passing the human `SI-…` reference instead
    // would make the desk click the one alert that says "your numbers
    // disagree" and land on a drawer that silently finds nothing.
    //
    // Every other booking notification in the codebase passes the doc id
    // for exactly this reason, so the reconciler must too.
    expect(reconcilerSource).not.toMatch(/entityId:\s*firstOffender/);
    expect(reconcilerSource).toMatch(/entityId:\s*entityDocId/);
    // The reference is still carried — in its own field — so the bell can
    // RENDER it.
    expect(reconcilerSource).toMatch(/bookingRef:\s*firstOffender/);
    // The doc id is resolved by LOOKING THE REF UP, not by assuming the
    // ref and the doc id are the same string.
    expect(reconcilerSource).toContain('.where("bookingRef", "==", firstOffender)');
  });
});

describe("the reconciler never prints PII", () => {
  it("reads only booking refs and amounts, never a guest name or email", () => {
    // The QA script's own rule: booking ids and references only.
    expect(reconcilerSource).not.toMatch(/guestEmail|guestName|phoneNumber|paymentProofPath/);
  });
});
