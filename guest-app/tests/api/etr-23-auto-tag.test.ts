// Per ETR-23 / ETR-24 (2026-11-19): the auto-tag contract.
//
// THE DEFECT THIS PINS
// --------------------
// A production test run was open on 2026-11-19. Of the eleven
// bookings created during it, exactly ONE carried the TEST badge.
//
// The reason was not a badge bug — it was that the tagging never
// happened:
//
//   - the GUEST path (`POST /api/bookings/create`) could only be
//     tagged through a secret `testToken` in the request body, and
//     the only thing in the repo that ever sent one was the
//     Playwright QA harness (it injects the token at the network
//     layer). A human booking through the public site during the
//     run came out UNTAGGED;
//   - the STAFF walk-in path had a "Mark as Test Data" dropdown
//     whose default was "Live data (not a test)", so a walk-in was
//     untagged unless the operator remembered to switch it.
//
// An untagged booking is not cosmetic: the run's close manifest
// queries `bookings.where("testRunId" == runId)`, so the untagged
// records were invisible to the run's cleanup AND counted as real
// money in the reports.
//
// THE RULE THIS FILE PINS
// -----------------------
// While a test run is active, EVERY booking and store order created
// in the deployment is tagged test data — decided by the SERVER,
// not the client. The desk keeps exactly one escape hatch (the
// walk-in "Live data (not a test)" sentinel).
//
// Runtime contract: the `resolveActiveTestRun()` unit tests below.
// Wiring contract: the source-text guards (per
// `plan/docs/CONTRIBUTING.md §Testing` — cheap, deterministic,
// <5s) pin the call sites so a future refactor that drops the
// auto-tag breaks here instead of silently shipping live-looking
// test bookings again.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const testRunsSrc = read("guest-app/server/handlers/test-runs.ts");
const bookingsSrc = read("guest-app/server/handlers/bookings.ts");
const storeSrc = read("guest-app/server/handlers/store.ts");
const bookingsPageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const settingsPageSrc = read("admin-app/src/pages/SettingsPage.tsx");
const constantsSrc = read("shared/constants/index.ts");

// ── Mock Firebase Admin ────────────────────────────────────────────
const { mockGet, mockCollection, mockRunTransaction } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockCollection = vi.fn();
  const mockRunTransaction = vi.fn();
  return { mockGet, mockCollection, mockRunTransaction };
});

function installDefaultMock() {
  const baseDoc = {
    get: mockGet,
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    collection: () => baseColl
  };
  const baseColl = {
    get: mockGet,
    limit: vi.fn(() => ({ get: mockGet, startAfter: vi.fn(() => ({ get: mockGet })) })),
    startAfter: vi.fn(() => ({ get: mockGet })),
    doc: () => baseDoc,
    where: () => ({
      get: mockGet,
      limit: vi.fn(() => ({ get: mockGet, startAfter: vi.fn(() => ({ get: mockGet })) })),
      startAfter: vi.fn(() => ({ get: mockGet }))
    }),
    add: vi.fn()
  };
  mockCollection.mockReturnValue(baseColl);
  mockRunTransaction.mockImplementation(async (fn: any) => {
    const tx = { get: mockGet, set: vi.fn(), update: vi.fn(), delete: vi.fn() };
    return fn(tx);
  });
}

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: mockCollection,
    collectionGroup: mockCollection,
    runTransaction: (fn: any) => mockRunTransaction(fn)
  },
  adminAuth: {},
  adminStorage: {}
}));

// Imported after the mock declaration — `vi.mock` is hoisted above
// the imports by vitest's transform, so the module still sees the
// mocked `firebase-admin`.
import { resolveActiveTestRun } from "../../server/handlers/test-runs";

describe("ETR-23 — the active-run resolver (runtime)", () => {
  const HOUR = 60 * 60 * 1000;

  beforeEach(() => {
    vi.restoreAllMocks();
    installDefaultMock();
    mockGet.mockReset();
  });

  function docsFor(runs: any[]) {
    return {
      docs: runs.map((run) => ({ id: run.id || "run_1", data: () => run }))
    };
  }

  it("returns null when there is no active run", async () => {
    mockGet.mockResolvedValue(docsFor([]));
    await expect(resolveActiveTestRun()).resolves.toBeNull();
  });

  it("returns the active run's id, name and environment", async () => {
    mockGet.mockResolvedValue(
      docsFor([
        {
          id: "abc123",
          name: "Prod smoke 2026-11-19",
          environment: "production",
          status: "active",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + HOUR)
        }
      ])
    );

    const resolved = await resolveActiveTestRun();
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe("abc123");
    expect(resolved!.name).toBe("Prod smoke 2026-11-19");
    expect(resolved!.environment).toBe("production");
  });

  it("picks the NEWEST active run when several are open", async () => {
    mockGet.mockResolvedValue(
      docsFor([
        {
          id: "older",
          name: "older",
          environment: "production",
          status: "active",
          createdAt: new Date(Date.now() - 2 * HOUR),
          expiresAt: new Date(Date.now() + HOUR)
        },
        {
          id: "newer",
          name: "newer",
          environment: "production",
          status: "active",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + HOUR)
        }
      ])
    );

    const resolved = await resolveActiveTestRun();
    expect(resolved!.id).toBe("newer");
  });

  it("ignores an EXPIRED run even when its status is still 'active'", async () => {
    // The admin's duration elapsed but the run was never closed —
    // the booking must not be tagged by a run nobody is watching.
    mockGet.mockResolvedValue(
      docsFor([
        {
          id: "stale",
          name: "stale run",
          environment: "production",
          status: "active",
          createdAt: new Date(Date.now() - 3 * HOUR),
          expiresAt: new Date(Date.now() - HOUR)
        }
      ])
    );

    await expect(resolveActiveTestRun()).resolves.toBeNull();
  });

  it("ignores a run whose status is not 'active'", async () => {
    mockGet.mockResolvedValue(
      docsFor([
        {
          id: "closed",
          name: "closed run",
          environment: "production",
          status: "closed",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + HOUR)
        }
      ])
    );

    await expect(resolveActiveTestRun()).resolves.toBeNull();
  });

  it("treats a missing expiresAt as still valid (mirrors the walk-in validation)", async () => {
    mockGet.mockResolvedValue(
      docsFor([
        {
          id: "no_expiry",
          name: "no expiry",
          environment: "production",
          status: "active",
          createdAt: new Date()
        }
      ])
    );

    const resolved = await resolveActiveTestRun();
    expect(resolved!.id).toBe("no_expiry");
  });

  it("returns null (and logs) when the read fails — an unreachable read must not tag or block a booking", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockGet.mockRejectedValue(new Error("firestore unavailable"));

    await expect(resolveActiveTestRun()).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("ETR-23 — auto-tag wiring (source-text)", () => {
  it("the resolver queries the testRuns collection for active runs", () => {
    expect(testRunsSrc).toMatch(
      /collection\("testRuns"\)[\s\S]{0,120}?where\("status", "==", "active"\)/
    );
  });

  it("the guest create path auto-tags when NO test token was sent", () => {
    // The `else` branch of the token check is the whole point: a
    // guest booking with no token during an active run must still
    // be stamped.
    expect(bookingsSrc).toMatch(
      /if \(testToken\) \{[\s\S]{0,6000}?\} else \{[\s\S]{0,2000}?resolveActiveTestRun\(\)/
    );
  });

  it("the guest path still validates a supplied token (an invalid token is a 403, never a silent downgrade)", () => {
    expect(bookingsSrc).toMatch(
      /if \(testToken\) \{[\s\S]{0,3000}?Invalid or expired test token/
    );
  });

  it("the walk-in path auto-tags when the desk did not pick a run", () => {
    expect(bookingsSrc).toMatch(
      /if \(requestedTestRunId === TEST_RUN_LIVE_OPT_OUT\)[\s\S]{0,4000}?\} else \{[\s\S]{0,2000}?resolveActiveTestRun\(\)/
    );
  });

  it("the walk-in path honours the explicit 'live' opt-out", () => {
    expect(bookingsSrc).toMatch(/requestedTestRunId === TEST_RUN_LIVE_OPT_OUT/);
    expect(constantsSrc).toMatch(/export const TEST_RUN_LIVE_OPT_OUT = "live"/);
  });

  it("the store order path stamps the test-run fields too", () => {
    // The admin app renders a TEST badge on store-order rows, but
    // no write path ever stamped the fields — so that badge could
    // never appear and a test order survived the run's cleanup.
    expect(storeSrc).toMatch(/resolveActiveTestRun\(\)/);
    expect(storeSrc).toMatch(
      /activeTestRun[\s\S]{0,400}?isTestData: true[\s\S]{0,200}?testRunId: activeTestRun\.id/
    );
  });

  it("the booking doc + reservation header both carry the stamp", () => {
    // Both write sites stamp through the same `validatedTestRunId`
    // spread — the child booking doc AND the reservation header.
    // (The global flag matters: a non-global `match` returns only
    // the FIRST hit, which would silently under-count.)
    const stamp = /validatedTestRunId\s*\n?\s*\? \{ isTestData: true, testRunId: validatedTestRunId/g;
    expect((bookingsSrc.match(stamp) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("the RESERVATION HEADER is stamped too — otherwise the cleanup orphans it", () => {
    // The run's cleanup deletes the tagged CHILD bookings. If the
    // header were unstamped it would survive as an orphan
    // reservation — and its canonical `reservations/{id}/payments`
    // ledger with it (orphan money records with no booking under
    // them). Both create paths must stamp the header.
    //
    // The stamp sits BEFORE `createdBy` on purpose: the MRB-14
    // guard pins the header's literal shape
    // (`actualDateRange` → `createdBy` → `};`), so the new field
    // moved rather than the guard.
    const headerStamp = /\.\.\.\(validatedTestRunId\s*\n?\s*\? \{ isTestData: true, testRunId: validatedTestRunId[\s\S]{0,400}?createdBy: "(guest|staff)"/g;
    expect((bookingsSrc.match(headerStamp) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("the add-room child INHERITS the reservation's classification", () => {
    // The add-room path builds the child doc field by field, so
    // without the inheritance an added room under a tagged
    // reservation would be unstamped — invisible to the cleanup,
    // visible as a live booking, and counted as revenue.
    expect(bookingsSrc).toMatch(
      /reservation\.isTestData === true[\s\S]{0,400}?testRunId: reservation\.testRunId/
    );
  });

  it("the cleanup deletes the tagged reservation headers + their canonical ledger", () => {
    // Without this the run's "Clean up" leaves the reservation
    // headers AND the money records under them behind.
    expect(testRunsSrc).toMatch(
      /collection\("reservations"\)\.where\("testRunId", "==", runId\)/
    );
    expect(testRunsSrc).toMatch(
      /deleteTestRunBookingSubcollections\(reservationRef\)[\s\S]{0,200}?doc\.ref\.delete\(\)/
    );
  });

  it("the close manifest counts the reservation headers it will delete", () => {
    expect(testRunsSrc).toMatch(/reservations: reservationsSnap\.docs\.length/);
  });
});

describe("ETR-23 — admin UI wiring (source-text)", () => {
  it("the walk-in dropdown defaults to AUTO (the active run), not to live", () => {
    // The pre-fix dropdown's first option was "Live data (not a
    // test)" — the exact reason the 2026-11-19 run tagged one
    // booking out of eleven.
    expect(bookingsPageSrc).toMatch(/<option value="">\s*Auto — tag with active run/);
  });

  it("the walk-in dropdown offers the explicit live opt-out", () => {
    expect(bookingsPageSrc).toMatch(/<option value=\{TEST_RUN_LIVE_OPT_OUT\}>/);
  });

  it("the active-run banner states that tagging is automatic", () => {
    expect(bookingsPageSrc).toMatch(
      /tagged\{\s*"\s*"\s*\}[\s\S]{0,120}?<strong>TEST DATA<\/strong>[\s\S]{0,40}?automatically/
    );
  });
});

describe("ETR-24 — the run token is no longer discarded (source-text)", () => {
  it("handleCreateRun keeps the token instead of dropping it", () => {
    // Pre-fix: `createTestRun` returned `{ token }` and
    // `handleCreateRun` ignored it — the credential the QA harness
    // injects was unreachable from the UI.
    expect(settingsPageSrc).toMatch(/setCreatedRunToken\(/);
    expect(settingsPageSrc).toMatch(/result\.token\s*\?/);
  });

  it("the Settings UI renders the token with a copy affordance", () => {
    expect(settingsPageSrc).toMatch(/Copy token/);
  });
});
