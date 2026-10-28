// A LIVE-FIXTURE check: it drives the REAL staging-refresh gate
// (preview + import) over a REAL production export.
//
// The export is a local file under `tmp/` (gitignored, and it holds
// production PII, so it must never be committed). Produce it first:
//
//   npm run qa:export
//
// When it is not there (CI, or a machine without production
// credentials) the check says so and stands down — the fixture-based
// gate coverage in `staging-refresh-f-a6-gate.test.ts` is the
// regression suite, and this file is the proof against the LIVE data.
//
// Firestore is MOCKED here, so nothing is written anywhere: this
// exercises the gate logic, not the database.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CANDIDATES = [
  resolve(process.cwd(), "tmp/qa/prod-export.json"),
  resolve(process.cwd(), "..", "tmp/qa/prod-export.json"),
  resolve(process.cwd(), "../../tmp/qa/prod-export.json"),
];
const EXPORT_FILE = CANDIDATES.find((p) => existsSync(p)) || CANDIDATES[0];
const HAVE_EXPORT = existsSync(EXPORT_FILE);

vi.mock("../../server/lib/firebase-admin.js", () => {
  const docStore: Record<string, any> = {};
  const makeRef = (path: string): any => ({
    path,
    id: path.split("/").pop() || path,
    get: async () => (docStore[path]
      ? { exists: true, id: path.split("/").pop() || path, data: () => docStore[path] }
      : { exists: false, id: path.split("/").pop() || path, data: () => undefined }),
    set: async (data: any) => { docStore[path] = data; },
    update: async (data: any) => { docStore[path] = { ...(docStore[path] || {}), ...data }; },
    delete: async () => { delete docStore[path]; },
    add: async (data: any) => { docStore[`${path}/_${Object.keys(docStore).length}`] = data; return { id: "generated" }; },
    collection: (sub: string) => makeRef(`${path}/${sub}`),
    doc: (id: string) => makeRef(`${path}/${id}`),
  });
  const fakeDb: any = {
    collection: (name: string) => makeRef(name),
    doc: (path: string) => makeRef(path),
    batch: () => ({
      set: (r: any, d: any) => { docStore[r.path] = d; },
      update: (r: any, d: any) => { docStore[r.path] = { ...(docStore[r.path] || {}), ...d }; },
      delete: (r: any) => { delete docStore[r.path]; },
    }),
  };
  return {
    getFirestore: vi.fn(() => fakeDb),
    getAuth: vi.fn(() => ({})),
    adminDb: fakeDb,
    initializeApp: vi.fn(),
    getApps: vi.fn(() => []),
    cert: vi.fn(),
    applicationDefault: vi.fn(),
  };
});

import { handleStagingRefreshPreview, handleStagingRefreshImport } from "../../server/handlers/test-runs.js";

describe("REAL production export through the REAL staging-refresh gate", () => {
  beforeEach(() => {
    // The refresh endpoint only runs on a STAGING project (the
    // one-way gate). Point the handler at the staging project id.
    process.env.FIREBASE_PROJECT_ID = "spark-inn-staging";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-staging";
  });

  it.skipIf(!HAVE_EXPORT)("is accepted, and the payload that would be written is free of production PII", async () => {
    // The refresh endpoint only runs on a STAGING project (the
    // one-way gate). Point the handler at the staging project id.
    process.env.FIREBASE_PROJECT_ID = "spark-inn-staging";
    process.env.STAGING_ALLOWLIST_PROJECT_IDS = "spark-inn-staging";
    expect(existsSync(EXPORT_FILE)).toBe(true);
    const payload = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));

    const res: any = {
      statusCode: 0,
      body: null,
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.body = body; return this; },
    };
    await handleStagingRefreshPreview(
      {
        method: "POST",
        body: { export: payload.export, options: { mode: "sanitized-snapshot" } },
        staff: { uid: "qa-verifier", role: "admin", email: "qa@example.invalid" },
      } as any,
      res
    );

    console.log("GATE STATUS:", res.statusCode);
    console.log("DENYLIST HITS:", (res.body?.data?.denylistHits || []).length);
    console.log("FINANCE:", JSON.stringify(res.body?.data?.financeCheck)); console.log("BODY:", JSON.stringify(res.body).slice(0, 800));

    expect(res.statusCode).toBe(200);
    expect((res.body.data.denylistHits || []).length).toBe(0);

    const written = JSON.stringify(res.body.data.sanitizedExport || res.body.data.sanitized);
    for (const needle of [
      "@gmail.com",
      "frontdeskbot",
      "firebasestorage",
      "PZtxhrdw81NuCRgFnUuJ8qzVcSV2",
    ]) {
      expect(written).not.toContain(needle);
    }
    console.log("WRITTEN PAYLOAD: clean (no gmail address, no storage URL, no staff UID)");
  });

  it.skipIf(!HAVE_EXPORT)("is IMPORTED: the per-booking finance invariant reconciles exactly", async () => {
    expect(existsSync(EXPORT_FILE)).toBe(true);
    const payload = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));

    const previewRes: any = {
      statusCode: 0, body: null,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.body = b; return this; },
    };
    await handleStagingRefreshPreview(
      {
        method: "POST",
        body: { export: payload.export, options: { mode: "sanitized-snapshot" } },
        staff: { uid: "qa-verifier", role: "admin", email: "qa@example.invalid" },
      } as any,
      previewRes
    );
    expect(previewRes.statusCode).toBe(200);
    const previewData = previewRes.body.data;

    const importRes: any = {
      statusCode: 0, body: null,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.body = b; return this; },
    };
    await handleStagingRefreshImport(
      {
        method: "POST",
        body: { snapshotId: previewData.snapshotId, sanitizedExport: previewData.sanitizedExport },
        staff: { uid: "qa-verifier", role: "admin", email: "qa@example.invalid" },
      } as any,
      importRes
    );

    console.log("IMPORT STATUS:", importRes.statusCode);
    console.log("FINANCE:", JSON.stringify(importRes.body?.data?.financeCheck));
    console.log("WRITE SUMMARY:", JSON.stringify(importRes.body?.data?.writeSummary));
    if (importRes.statusCode !== 200) console.log("BODY:", JSON.stringify(importRes.body).slice(0, 600));

    expect(importRes.statusCode).toBe(200);
    expect(importRes.body.data.financeCheck.drift).toBeCloseTo(0, 2);
    expect(importRes.body.data.financeCheck.driftingBookings).toEqual([]);
  });
});
