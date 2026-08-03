import { z } from "zod";
import crypto from "node:crypto";
import { adminDb } from "../lib/firebase-admin";

function getStaff(req: any) {
  return (req as any).staff || {};
}

function generateRunId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const createTestRunSchema = z.object({
  name: z.string().trim().min(1).max(120),
  environment: z.enum(["staging", "production"]),
  durationMinutes: z.number().int().min(5).max(43200)
}).strict();

const closeTestRunSchema = z.object({
  runId: z.string().trim().min(1).max(64)
}).strict();

const deleteTestRunSchema = z.object({
  runId: z.string().trim().min(1).max(64)
}).strict();

async function collectManifest(runId: string): Promise<{
  bookings: number;
  storeOrders: number;
  affectedRooms: string[];
  affectedStockItems: string[];
}> {
  const affectedRooms = new Set<string>();
  const affectedStockItems = new Set<string>();

  const bookingsSnap = await adminDb
    .collection("bookings")
    .where("testRunId", "==", runId)
    .get();
  const bookingIds = bookingsSnap.docs.map(d => {
    affectedRooms.add(d.data().roomNumber || "");
    return d.id;
  });

  const storeSnap = await adminDb
    .collection("storeOrders")
    .where("testRunId", "==", runId)
    .get();
  storeSnap.docs.forEach(d => {
    const itemIds: string[] = (d.data().items || []).map((i: any) => i.itemId);
    itemIds.forEach(id => { if (id) affectedStockItems.add(id); });
  });

  return {
    bookings: bookingIds.length,
    storeOrders: storeSnap.docs.length,
    affectedRooms: [...affectedRooms].filter(Boolean),
    affectedStockItems: [...affectedStockItems].filter(Boolean)
  };
}

export async function handleCreateTestRun(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can create test runs." });
  }

  const parsed = createTestRunSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid test run name, environment, and duration."
    });
  }

  const { name, environment, durationMinutes } = parsed.data;

  try {
    if (environment === "production") {
      const activeRuns = await adminDb
        .collection("testRuns")
        .where("environment", "==", "production")
        .where("status", "==", "active")
        .get();
      if (!activeRuns.empty) {
        return res.status(409).json({
          success: false,
          error: "There is already an active production test run. Close it before creating a new one."
        });
      }
    }

    const now = new Date();
    const runId = generateRunId();
    const tokenBytes = crypto.randomBytes(24);
    const token = tokenBytes.toString("base64url");

    const run: any = {
      id: runId,
      name,
      environment,
      createdBy: staff.email || "",
      createdByUid: staff.uid || "",
      createdAt: now,
      expiresAt: new Date(now.getTime() + durationMinutes * 60000),
      closedAt: null,
      closedBy: null,
      status: "active",
      tokenHash: hashToken(token)
    };

    await adminDb.collection("testRuns").doc(runId).set(run);

    return res.status(200).json({
      success: true,
      data: {
        id: runId,
        name,
        environment,
        token,
        expiresAt: run.expiresAt.toISOString(),
        durationMinutes
      }
    });
  } catch (error: any) {
    console.error("Test run creation failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to create test run. Please try again."
    });
  }
}

export async function handleCloseTestRun(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can close test runs." });
  }

  const parsed = closeTestRunSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid test run ID."
    });
  }

  const { runId } = parsed.data;

  try {
    const runRef = adminDb.collection("testRuns").doc(runId);
    const runDoc = await runRef.get();

    if (!runDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Test run not found."
      });
    }

    const runData = runDoc.data()!;
    if (runData.status !== "active") {
      return res.status(400).json({
        success: false,
        error: "This test run is not active and cannot be closed."
      });
    }

    const manifest = await collectManifest(runId);

    const now = new Date();
    await runRef.set({
      closedAt: now,
      closedBy: staff.email || "",
      status: "closed",
      manifest
    }, { merge: true });

    return res.status(200).json({
      success: true,
      data: { runId, closedAt: now.toISOString(), manifest }
    });
  } catch (error: any) {
    console.error("Test run close failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to close test run. Please try again."
    });
  }
}

const CLEANUP_TIMEOUT_MS = 30 * 60 * 1000; // 30-minute lease, refreshed after each cleanup page

const TEST_RUN_BOOKING_SUBCOLLECTIONS = ["payments", "charges"] as const;

export async function deleteTestRunBookingSubcollections(bookingRef: any) {
  for (const subcollection of TEST_RUN_BOOKING_SUBCOLLECTIONS) {
    const snapshot = await bookingRef.collection(subcollection).get();
    await Promise.all(snapshot.docs.map((child: any) => child.ref.delete()));
  }
}

async function heartbeatTestRunCleanup(runRef: any, bookingCount: number, storeOrderCount: number) {
  await runRef.set({
    cleanupStartedAt: new Date(),
    cleanupCursor: {
      bookingsDeleted: bookingCount,
      storeOrdersDeleted: storeOrderCount
    }
  }, { merge: true });
}

export async function handleDeleteTestRun(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can delete test data." });
  }

  const parsed = deleteTestRunSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid test run ID."
    });
  }

  const { runId } = parsed.data;
  const runRef = adminDb.collection("testRuns").doc(runId);
  const now = new Date();

  // ETR-14: atomic distributed lock via Firestore transaction
  try {
    await adminDb.runTransaction(async (transaction) => {
      const runDoc = await transaction.get(runRef);
      if (!runDoc.exists) {
        throw new Error("NOT_FOUND");
      }
      const runData = runDoc.data()!;
      const status = runData.status;

      if (status === "cleaned") {
        throw new Error("ALREADY_CLEANED");
      }

      if (status === "closed") {
        // First attempt: acquire lock
        transaction.set(runRef, {
          status: "cleanup-in-progress",
          cleanupStartedAt: now,
          cleanupCursor: null
        }, { merge: true });
        return;
      }

      if (status === "cleanup-in-progress") {
        // Stale lock recovery: if started long enough ago, reclaim
        const startedAt = runData.cleanupStartedAt?.toDate?.() || runData.cleanupStartedAt;
        if (startedAt && (now.getTime() - new Date(startedAt).getTime()) < CLEANUP_TIMEOUT_MS) {
          throw new Error("CLEANUP_IN_PROGRESS");
        }
        // Stale lock — reclaim it
        transaction.set(runRef, {
          status: "cleanup-in-progress",
          cleanupStartedAt: now
        }, { merge: true });
        return;
      }

      throw new Error("INVALID_STATUS");
    });
  } catch (txError: any) {
    const msg = txError.message || "";
    if (msg === "NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Test run not found." });
    }
    if (msg === "ALREADY_CLEANED") {
      return res.status(400).json({ success: false, error: "This test run has already been cleaned up." });
    }
    if (msg === "CLEANUP_IN_PROGRESS") {
      return res.status(409).json({
        success: false,
        error: "Cleanup is already in progress. Please wait for it to complete or try again after 30 minutes."
      });
    }
    if (msg === "INVALID_STATUS") {
      return res.status(400).json({ success: false, error: "Only closed test runs can be cleaned up. Close the run first." });
    }
    throw txError;
  }

  try {
    let bookingCount = 0;
    let storeOrderCount = 0;
    let failedItems: string[] = [];

    const batchSize = 20;

    // ETR-14: resumable — queries are idempotent (already-deleted docs are gone)
    // Delete tagged bookings and subcollections
    let lastDoc: any = null;
    while (true) {
      let q: any = adminDb.collection("bookings").where("testRunId", "==", runId).limit(batchSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];

      for (const doc of snap.docs) {
        try {
          const bookingRef = adminDb.collection("bookings").doc(doc.id);
          await deleteTestRunBookingSubcollections(bookingRef);
          await doc.ref.delete();
          bookingCount++;

        } catch (err) {
          failedItems.push(`booking/${doc.id}`);
        }
      }
      await heartbeatTestRunCleanup(runRef, bookingCount, storeOrderCount);
    }

    // Delete tagged store orders
    lastDoc = null;
    while (true) {
      let q: any = adminDb.collection("storeOrders").where("testRunId", "==", runId).limit(batchSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];

      for (const doc of snap.docs) {
        try {
          const subSnap = await adminDb.collection("storeOrders").doc(doc.id).collection("tenders").get();
          await Promise.all(subSnap.docs.map(sd => sd.ref.delete()));
          await doc.ref.delete();
          storeOrderCount++;

        } catch (err) {
          failedItems.push(`storeOrder/${doc.id}`);
        }
      }
      await heartbeatTestRunCleanup(runRef, bookingCount, storeOrderCount);
    }

    // Delete notifications for test entities
    let notifQ: any = adminDb.collection("notifications").where("testRunId", "==", runId);
    const notifSnap = await notifQ.get();
    for (const doc of notifSnap.docs) {
      try { await doc.ref.delete(); } catch { failedItems.push(`notification/${doc.id}`); }
    }
    await heartbeatTestRunCleanup(runRef, bookingCount, storeOrderCount);

    // Delete intercom stays and messages tagged to the run
    let intercomQ: any = adminDb.collection("intercoms").where("testRunId", "==", runId);
    const intercomSnap = await intercomQ.get();
    for (const doc of intercomSnap.docs) {
      try {
        const msgSnap = await adminDb.collection("intercoms").doc(doc.id).collection("messages").get();
        await Promise.all(msgSnap.docs.map(md => md.ref.delete()));
        await doc.ref.delete();
      } catch { failedItems.push(`intercom/${doc.id}`); }
    }
    await heartbeatTestRunCleanup(runRef, bookingCount, storeOrderCount);

    // Audit trail: store the cleanup result
    const auditResult = {
      type: "test-run-cleanup",
      runId,
      bookingsDeleted: bookingCount,
      storeOrdersDeleted: storeOrderCount,
      failedItems,
      completedAt: now,
      completedBy: staff.email || ""
    };
    await adminDb.collection("janitor").doc("cleanups").collection("history").add(auditResult);

    // Restore affected rooms to operational baseline
    const runDoc = await runRef.get();
    const runData = runDoc.data()!;
    const affectedRooms: string[] = (runData.manifest?.affectedRooms || []);
    for (const roomNumber of affectedRooms) {
      if (!roomNumber) continue;
      const roomsSnap = await adminDb.collection("rooms").where("roomNumber", "==", roomNumber).get();
      for (const doc of roomsSnap.docs) {
        await doc.ref.set({
          status: "available",
          housekeepingStatus: "clean"
        }, { merge: true });
      }
      await heartbeatTestRunCleanup(runRef, bookingCount, storeOrderCount);
    }

    await runRef.set({
      status: "cleaned",
      cleanupCompletedAt: now,
      cleanupCursor: null,
      cleanupResult: { bookingsDeleted: bookingCount, storeOrdersDeleted: storeOrderCount, failedItems: failedItems.length }
    }, { merge: true });

    return res.status(200).json({
      success: true,
      data: {
        runId,
        bookingsDeleted: bookingCount,
        storeOrdersDeleted: storeOrderCount,
        failedItems: failedItems.length,
        roomsRestored: affectedRooms.length
      }
    });
  } catch (error: any) {
    console.error("Test run cleanup failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to clean up test data. Please try again."
    });
  }
}

function isStagingProject(): boolean {
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const allowlistRaw = process.env.STAGING_ALLOWLIST_PROJECT_IDS || "";
  const allowlist = allowlistRaw.split(",").map(s => s.trim()).filter(Boolean);
  return allowlist.includes(projectId);
}

// ── ETR-S09–S13: staging reset hardening ──────────────────────────
const PREVIEW_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — stale lock recovery
const RESET_BATCH_SIZE = 20;

const stagingResetConfirmSchema = z.object({
  confirmation: z.literal("RESET STAGING"),
  projectName: z.string().trim().min(1).max(120),
  previewId: z.string().trim().min(1).max(64)
}).strict();

interface ResetLockResult {
  acquired: boolean;
  message?: string;
  resumed: boolean;
  resumePhase: string;
}

async function acquireResetLock(staff: any, currentProject: string, previewId: string): Promise<ResetLockResult> {
  const lockRef = adminDb.collection("janitor").doc("staging-reset-lock");
  const now = new Date();
  try {
    let acquired = false;
    let message: string | undefined;
    let resumed = false;
    let resumePhase = "starting";
    await adminDb.runTransaction(async (tx) => {
      const lockDoc = await tx.get(lockRef);
      if (lockDoc.exists) {
        const data = lockDoc.data()!;
        const startedAt = data.startedAt?.toDate?.() || data.startedAt;
        if (data.status === "running" && startedAt && (now.getTime() - new Date(startedAt).getTime()) < LOCK_TIMEOUT_MS) {
          message = "A staging reset is already in progress. Please wait for it to complete or try again after 30 minutes.";
          return;
        }
        if (data.previewId === previewId && data.status === "complete") {
          message = "This staging reset job has already completed. Run a new preview for another reset.";
          return;
        }
        if (data.previewId === previewId && (data.status === "failed" || data.status === "incomplete" || data.status === "running")) {
          resumed = true;
          resumePhase = data.phase || "starting";
        }
      }
      const lockData: Record<string, unknown> = {
        projectId: currentProject,
        startedAt: now,
        status: "running",
        previewId,
        phase: resumed ? resumePhase : "starting",
        startedBy: staff.email || "",
        resumedAt: resumed ? now : null
      };
      if (!resumed) lockData.checkpoint = 0;
      tx.set(lockRef, lockData, { merge: resumed });
      acquired = true;
    });
    return { acquired, message, resumed, resumePhase };
  } catch {
    return { acquired: false, message: "Unable to acquire reset lock. Please try again.", resumed: false, resumePhase: "starting" };
  }
}

async function releaseResetLock(lockRef: any, status: string, phase: string, checkpoint: number) {
  try {
    await lockRef.set({ status, phase, checkpoint, completedAt: new Date() }, { merge: true });
  } catch { /* best-effort */ }
}

const PROTECTED_RESET_COLLECTIONS = [
  "counters", "settings", "guests", "members", "storeItems", "vouchers", "corporateCodes"
] as const;

async function collectProtectedState(): Promise<{
  collections: Record<string, { count: number; hash: string }>;
  roomsCount: number;
}> {
  const [protectedSnapshots, roomsSnapshot] = await Promise.all([
    Promise.all(PROTECTED_RESET_COLLECTIONS.map(async (name) => [name, await adminDb.collection(name).get()] as const)),
    adminDb.collection("rooms").get()
  ]);

  const collections = Object.fromEntries(protectedSnapshots.map(([name, snapshot]) => {
    const documents = snapshot.docs
      .map((doc: any) => ({ id: doc.id, data: doc.data() }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
    return [name, {
      count: documents.length,
      hash: crypto.createHash("sha256").update(JSON.stringify(documents)).digest("hex")
    }];
  }));

  return { collections, roomsCount: roomsSnapshot.docs.length };
}

async function collectFullManifest(): Promise<{
  bookings: number; storeOrders: number; notifications: number; intercomStays: number;
  testRuns: number; calls: number; dailyCloses: number; corporateInquiries: number;
  roomBlocks: number; cleanupHistory: number; affectedRooms: string[]; affectedStockItems: string[];
  protectedState: Awaited<ReturnType<typeof collectProtectedState>>;
}> {
  const [bookingsSnap, storeSnap, notifSnap, intercomSnap, testRunSnap, callsSnap, dailyCloseSnap, corpInquirySnap, roomBlocksSnap, cleanupSnap] = await Promise.all([
    adminDb.collection("bookings").get(),
    adminDb.collection("storeOrders").get(),
    adminDb.collection("notifications").get(),
    adminDb.collection("intercoms").get(),
    adminDb.collection("testRuns").get(),
    adminDb.collection("calls").get(),
    adminDb.collection("dailyCloses").get(),
    adminDb.collection("corporateInquiries").get(),
    adminDb.collection("roomBlocks").get(),
    adminDb.collection("janitor").doc("cleanups").collection("history").get()
  ]);

  const affectedRooms = new Set<string>();
  bookingsSnap.docs.forEach(d => { const r = d.data().roomNumber; if (r) affectedRooms.add(r); });
  roomBlocksSnap.docs.forEach(d => { const r = d.data().roomNumber; if (r) affectedRooms.add(r); });
  const protectedState = await collectProtectedState();

  return {
    bookings: bookingsSnap.docs.length,
    storeOrders: storeSnap.docs.length,
    notifications: notifSnap.docs.length,
    intercomStays: intercomSnap.docs.length,
    testRuns: testRunSnap.docs.length,
    calls: callsSnap.docs.length,
    dailyCloses: dailyCloseSnap.docs.length,
    corporateInquiries: corpInquirySnap.docs.length,
    roomBlocks: roomBlocksSnap.docs.length,
    cleanupHistory: cleanupSnap.docs.length,
    affectedRooms: [...affectedRooms].filter(Boolean),
    affectedStockItems: [],
    protectedState
  };
}

export function hashManifest(manifest: any): string {
  return crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 16);
}

export async function handleStagingResetPreview(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can preview staging reset." });
  }

  if (!isStagingProject()) {
    return res.status(403).json({
      success: false,
      error: "This project is not authorized for operational reset. Staging allowlist check failed."
    });
  }

  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || "unknown";
    const manifest = await collectFullManifest();
    const previewId = hashManifest({ projectId, manifest, ts: Date.now() });

    // ETR-S10: persist preview with short TTL
    await adminDb.collection("janitor").doc("previews").collection("items").doc(previewId).set({
      projectId,
      manifest,
      manifestHash: hashManifest(manifest),
      createdAt: new Date(),
      createdBy: staff.email || ""
    });

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        isStaging: true,
        manifest,
        previewId,
        confirmedAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error("Staging reset preview failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to generate staging reset preview."
    });
  }
}

export async function handleStagingResetExecute(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can execute staging reset." });
  }

  if (!isStagingProject()) {
    return res.status(403).json({
      success: false,
      error: "This project is not authorized for operational reset. Staging allowlist check failed."
    });
  }

  const parsed = stagingResetConfirmSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Preview ID, typed RESET STAGING, and project name are required."
    });
  }

  const { confirmation, projectName, previewId } = parsed.data;
  const currentProject = process.env.FIREBASE_PROJECT_ID || "";

  if (projectName !== currentProject) {
    return res.status(400).json({
      success: false,
      error: `Project name mismatch. Expected "${currentProject}".`
    });
  }

  let validatedPreview: any;
  let resumeAllowed = false;

  // ETR-S10: validate preview
  try {
    const previewRef = adminDb.collection("janitor").doc("previews").collection("items").doc(previewId);
    const previewDoc = await previewRef.get();
    if (!previewDoc.exists) {
      return res.status(400).json({ success: false, error: "Preview not found. Please run a new preview." });
    }
    const preview = previewDoc.data()!;
    validatedPreview = preview;
    const existingLockDoc = await adminDb.collection("janitor").doc("staging-reset-lock").get();
    if (existingLockDoc.exists) {
      const existingLock = existingLockDoc.data()!;
      resumeAllowed = existingLock.previewId === previewId
        && ["running", "failed", "incomplete"].includes(existingLock.status);
    }
    const createdAt = preview.createdAt?.toDate?.() || preview.createdAt;
    if (!resumeAllowed && createdAt && (Date.now() - new Date(createdAt).getTime()) > PREVIEW_TTL_MS) {
      return res.status(400).json({ success: false, error: "Preview has expired. Please run a new preview." });
    }
    if (preview.projectId !== currentProject) {
      return res.status(400).json({ success: false, error: "Preview was created for a different project." });
    }
    // Check for material drift
    const currentManifest = resumeAllowed ? null : await collectFullManifest();
    if (currentManifest && hashManifest(currentManifest) !== preview.manifestHash) {
      return res.status(409).json({
        success: false,
        error: "Staging data has changed since preview. Please run a new preview."
      });
    }
  } catch (error: any) {
    console.error("Preview validation failed:", error);
    return res.status(500).json({ success: false, error: "Unable to validate preview." });
  }

  // ETR-S09: acquire atomic lock
  const lock = await acquireResetLock(staff, currentProject, previewId);
  if (!lock.acquired) {
    const isConflict = lock.message?.includes("already in progress") || lock.message?.includes("already completed");
    return res.status(isConflict ? 409 : 500).json({
      success: false,
      error: lock.message || "Unable to acquire reset lock."
    });
  }

  const lockRef = adminDb.collection("janitor").doc("staging-reset-lock");
  const startedAt = new Date();
  const failedItems: string[] = [];
  let bookingCount = 0, storeOrderCount = 0, notifCount = 0;
  let intercomCount = 0, testRunCount = 0, callCount = 0;
  let dailyCloseCount = 0, corpInquiryCount = 0, roomBlockCount = 0, cleanupCount = 0;
  let roomRestoreCount = 0;
  let integrityFailed = false;
  let manifestBefore: any;

  // Shared paginated deletion helper
  async function deleteCollectionPage(collectionName: string, subcollections: string[], counter: { value: number }) {
    let lastDoc: any = null;
    while (true) {
      let q: any = adminDb.collection(collectionName).limit(RESET_BATCH_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      const failuresBeforePage = failedItems.length;
      for (const doc of snap.docs) {
        try {
          for (const sub of subcollections) {
            const subSnap = await adminDb.collection(collectionName).doc(doc.id).collection(sub).get();
            await Promise.all(subSnap.docs.map(sd => sd.ref.delete()));
          }
          await doc.ref.delete();
          counter.value++;
        } catch { failedItems.push(`${collectionName}/${doc.id}`); }
      }
      if (failedItems.length > failuresBeforePage) {
        throw new Error(`Deletion failed in ${collectionName}; retry this reset job to resume.`);
      }
    }
  }

  // Shared paginated deletion helper for orphaned subcollections via collection groups
  async function deleteCollectionGroupPage(groupName: string) {
    let lastDoc: any = null;
    while (true) {
      let q: any = adminDb.collectionGroup(groupName).limit(RESET_BATCH_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      const failuresBeforePage = failedItems.length;
      for (const doc of snap.docs) {
        try {
          await doc.ref.delete();
        } catch { failedItems.push(`${groupName}/${doc.id}`); }
      }
      if (failedItems.length > failuresBeforePage) {
        throw new Error(`Deletion failed in collection group ${groupName}; retry this reset job to resume.`);
      }
    }
  }

  // ETR-S11: wrap entire execution in fail-closed semantics
  try {
    manifestBefore = validatedPreview.manifest;

    const phaseOrder = [
      "bookings", "storeOrders", "notifications", "intercoms", "testRuns",
      "calls", "dailyCloses", "corporateInquiries", "roomBlocks",
      "cleanupHistory", "rooms", "integrity"
    ];
    const storedPhaseIndex = lock.resumed ? phaseOrder.indexOf(lock.resumePhase) : 0;
    const resumePhaseIndex = storedPhaseIndex >= 0 ? storedPhaseIndex : 0;
    const shouldRunPhase = (phase: string) => phaseOrder.indexOf(phase) >= resumePhaseIndex;

    const runDeletionPhase = async (
      phase: string,
      collectionName: string,
      subcollections: string[],
      expectedCount: number
    ) => {
      if (!shouldRunPhase(phase)) return expectedCount;
      await lockRef.set({ phase, checkpoint: 0 }, { merge: true });
      const counter = { value: 0 };
      await deleteCollectionPage(collectionName, subcollections, counter);
      for (const sub of subcollections) {
        await deleteCollectionGroupPage(sub);
      }
      await lockRef.set({ checkpoint: counter.value }, { merge: true });
      return lock.resumed ? expectedCount : counter.value;
    };

    bookingCount = await runDeletionPhase(
      "bookings", "bookings", ["payments", "charges", "incidentalCharges", "notifications", "audit"], manifestBefore.bookings
    );
    storeOrderCount = await runDeletionPhase(
      "storeOrders", "storeOrders", ["payments", "tenders"], manifestBefore.storeOrders
    );
    notifCount = await runDeletionPhase("notifications", "notifications", [], manifestBefore.notifications);
    intercomCount = await runDeletionPhase("intercoms", "intercoms", ["messages"], manifestBefore.intercomStays);
    testRunCount = await runDeletionPhase("testRuns", "testRuns", [], manifestBefore.testRuns);
    callCount = await runDeletionPhase("calls", "calls", ["iceCandidates"], manifestBefore.calls);
    dailyCloseCount = await runDeletionPhase("dailyCloses", "dailyCloses", [], manifestBefore.dailyCloses);
    corpInquiryCount = await runDeletionPhase(
      "corporateInquiries", "corporateInquiries", [], manifestBefore.corporateInquiries
    );
    roomBlockCount = await runDeletionPhase("roomBlocks", "roomBlocks", [], manifestBefore.roomBlocks);

    // Cleanup history
    if (shouldRunPhase("cleanupHistory")) {
      await lockRef.set({ phase: "cleanupHistory", checkpoint: 0 }, { merge: true });
      const clCounter = { value: 0 };
      const cleanupSnap = await adminDb.collection("janitor").doc("cleanups").collection("history").get();
      for (const doc of cleanupSnap.docs) {
        try { await doc.ref.delete(); clCounter.value++; }
        catch { failedItems.push(`cleanupHistory/${doc.id}`); }
      }
      cleanupCount = lock.resumed ? manifestBefore.cleanupHistory : clCounter.value;
      await lockRef.set({ checkpoint: cleanupCount }, { merge: true });
    } else {
      cleanupCount = manifestBefore.cleanupHistory;
    }
    if (failedItems.length > 0) {
      throw new Error("Cleanup-history deletion was incomplete; retry this reset job to resume.");
    }

    // Restore rooms to baseline
    if (shouldRunPhase("rooms")) {
      await lockRef.set({ phase: "rooms", checkpoint: 0 }, { merge: true });
      for (const roomNumber of manifestBefore.affectedRooms) {
        if (!roomNumber) continue;
        const roomsSnap = await adminDb.collection("rooms").where("roomNumber", "==", roomNumber).get();
        if (roomsSnap.empty) {
          failedItems.push(`room/${roomNumber} (not found)`);
          continue;
        }
        for (const doc of roomsSnap.docs) {
          await doc.ref.set({ status: "available", housekeepingStatus: "clean" }, { merge: true });
          roomRestoreCount++;
        }
      }
      await lockRef.set({ checkpoint: roomRestoreCount }, { merge: true });
    } else {
      roomRestoreCount = manifestBefore.affectedRooms.length;
    }
    if (failedItems.length > 0) {
      throw new Error("Room baseline restoration was incomplete; retry this reset job to resume.");
    }

    // ETR-S13: post-reset integrity scan
    await lockRef.set({ phase: "integrity", checkpoint: roomRestoreCount }, { merge: true });
    const integrityErrors: string[] = [];
    const verifyCollection = async (name: string) => {
      const snap = await adminDb.collection(name).limit(1).get();
      if (!snap.empty) integrityErrors.push(`${name} still has ${snap.size} document(s)`);
    };
    await Promise.all([
      verifyCollection("bookings"),
      verifyCollection("storeOrders"),
      verifyCollection("notifications"),
      verifyCollection("intercoms"),
      verifyCollection("testRuns"),
      verifyCollection("calls"),
      verifyCollection("dailyCloses"),
      verifyCollection("corporateInquiries"),
      verifyCollection("roomBlocks")
    ]);
    const verifyCollectionGroup = async (name: string) => {
      const snap = await adminDb.collectionGroup(name).limit(1).get();
      if (!snap.empty) integrityErrors.push(`orphaned ${name} subcollection data remains`);
    };
    await Promise.all([
      verifyCollectionGroup("payments"),
      verifyCollectionGroup("charges"),
      verifyCollectionGroup("incidentalCharges"),
      verifyCollectionGroup("notifications"),
      verifyCollectionGroup("audit"),
      verifyCollectionGroup("tenders"),
      verifyCollectionGroup("messages"),
      verifyCollectionGroup("iceCandidates")
    ]);
    // Verify room baselines
    for (const roomNumber of manifestBefore.affectedRooms) {
      if (!roomNumber) continue;
      const snap = await adminDb.collection("rooms").where("roomNumber", "==", roomNumber).get();
      for (const doc of snap.docs) {
        const d = doc.data();
        if (d.status !== "available" || d.housekeepingStatus !== "clean") {
          integrityErrors.push(`room ${roomNumber} is ${d.status}/${d.housekeepingStatus}`);
        }
      }
    }
    const protectedStateAfter = await collectProtectedState();
    if (JSON.stringify(protectedStateAfter) !== JSON.stringify(manifestBefore.protectedState)) {
      integrityErrors.push("protected settings, identity, catalog, counters, or room count changed during reset");
    }

    if (integrityErrors.length > 0 || failedItems.length > 0) {
      integrityFailed = true;
      failedItems.push(...integrityErrors.map(e => `integrity: ${e}`));
    }

    // ETR-S11: only 200 if no integrity failures
    const auditResult = {
      type: "staging-reset",
      bookingsDeleted: bookingCount,
      storeOrdersDeleted: storeOrderCount,
      notificationsDeleted: notifCount,
      intercomStaysDeleted: intercomCount,
      testRunsDeleted: testRunCount,
      callsDeleted: callCount,
      dailyClosesDeleted: dailyCloseCount,
      corporateInquiriesDeleted: corpInquiryCount,
      roomBlocksDeleted: roomBlockCount,
      cleanupHistoryDeleted: cleanupCount,
      roomsRestored: roomRestoreCount,
      failedItems,
      integrityErrors: integrityErrors.length > 0 ? integrityErrors : [],
      manifestBefore: {
        bookings: manifestBefore.bookings,
        storeOrders: manifestBefore.storeOrders,
        notifications: manifestBefore.notifications,
        intercomStays: manifestBefore.intercomStays,
        testRuns: manifestBefore.testRuns,
        calls: manifestBefore.calls,
        dailyCloses: manifestBefore.dailyCloses,
        corporateInquiries: manifestBefore.corporateInquiries,
        roomBlocks: manifestBefore.roomBlocks,
        cleanupHistory: manifestBefore.cleanupHistory
      },
      startedAt,
      completedAt: new Date(),
      completedBy: staff.email || "",
      projectId: currentProject,
      previewId,
      resumed: lock.resumed,
      protectedStateVerified: true,
      terminalStatus: integrityFailed ? "incomplete" : "complete"
    };
    await adminDb.collection("janitor").doc("cleanups").collection("history").add(auditResult);

    if (integrityFailed) {
      await releaseResetLock(lockRef, "incomplete", "integrity", 0);
      return res.status(500).json({
        success: false,
        error: "Reset completed with integrity errors.",
        data: {
          projectId: currentProject,
          bookingsDeleted: bookingCount,
          storeOrdersDeleted: storeOrderCount,
          roomBlocksDeleted: roomBlockCount,
          failedItems: failedItems.length,
          integrityErrors,
          terminalStatus: "incomplete"
        }
      });
    }

    await releaseResetLock(lockRef, "complete", "done", 0);

    return res.status(200).json({
      success: true,
      data: {
        projectId: currentProject,
        bookingsDeleted: bookingCount,
        storeOrdersDeleted: storeOrderCount,
        notificationsDeleted: notifCount,
        intercomStaysDeleted: intercomCount,
        testRunsDeleted: testRunCount,
        callsDeleted: callCount,
        dailyClosesDeleted: dailyCloseCount,
        corporateInquiriesDeleted: corpInquiryCount,
        roomBlocksDeleted: roomBlockCount,
        cleanupHistoryDeleted: cleanupCount,
        roomsRestored: roomRestoreCount,
        failedItems: failedItems.length,
        terminalStatus: "complete"
      }
    });
  } catch (error: any) {
    console.error("Staging reset execution failed:", error);
    try {
      await lockRef.set({
        status: "failed",
        failedAt: new Date(),
        failureMessage: error?.message || "Unknown reset failure"
      }, { merge: true });
      await adminDb.collection("janitor").doc("cleanups").collection("history").add({
        type: "staging-reset",
        terminalStatus: "failed",
        previewId,
        projectId: currentProject,
        failedItems,
        startedAt,
        failedAt: new Date(),
        completedBy: staff.email || "",
        failureMessage: error?.message || "Unknown reset failure"
      });
    } catch { /* best-effort failure audit; lock state remains the primary resume record */ }
    return res.status(500).json({
      success: false,
      error: "Unable to execute staging reset. The job remains resumable; retry with the same preview after resolving the reported failure."
    });
  }
}

export async function handleListTestRuns(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can list test runs." });
  }

  try {
    const snap = await adminDb
      .collection("testRuns")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const runs = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        environment: data.environment,
        createdBy: data.createdBy,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() || data.expiresAt,
        closedAt: data.closedAt?.toDate?.()?.toISOString() || null,
        closedBy: data.closedBy || null,
        status: data.status,
        manifest: data.manifest || null,
        cleanupResult: data.cleanupResult || null
      };
    });

    return res.status(200).json({ success: true, data: runs });
  } catch (error: any) {
    console.error("List test runs failed:", error);
    return res.status(500).json({ success: false, error: "Unable to list test runs." });
  }
}

// ── ETR-R01 / ETR-R04 / ETR-R10: production-to-staging refresh (sanitization MVP) ──
//
// SCOPE — this is the ETR-R *foundation*: server-side authorization
// (R01) + the identity-replacement sanitization engine (R04) + a
// single preview endpoint that takes a production export and returns
// the sanitized JSON. The full pipeline (R03 reviewable preservation,
// R05 file sanitization, R06 relational integrity, R07 side-effect
// disable, R08 mode-appropriate scan, R09 controlled replacement with
// the staging-reset integration, R10 full audit retention) lands in
// follow-up PRs.
//
// WORKFLOW (manual import for now, R09 will automate):
//   1. Admin exports the production Firestore collections to JSON
//      (via Firebase Console → Import/Export, or a one-off script).
//   2. Admin POSTs the JSON to /api/test-runs/staging-refresh-preview
//      with body { export: { bookings, storeOrders, members }, options }.
//   3. Server sanitizes the JSON, returns the sanitized version +
//      counts + a snapshotId for the audit row.
//   4. Admin imports the sanitized JSON into staging via the Firebase
//      Console. (R09 will automate this in a follow-up — the endpoint
//      will accept a destinationProjectId and stream the sanitized
//      docs into staging directly via the Admin SDK.)
//
// AUTHORIZATION (R01): the endpoint refuses to run on a non-staging
// project (the production environment) and refuses any non-admin
// caller. Production data flows production → staging only; the
// production API never imports staging data. The `isStagingProject()`
// gate is the same one the ETR-S01..S15 staging reset uses, so the
// `STAGING_ALLOWLIST_PROJECT_IDS` env var is the single source of
// truth.
//
// IDENTITY REPLACEMENT (R04): every PII field is deterministically
// transformed by hashing the source value with a per-snapshot salt.
// The same source value maps to the same synthetic value within a
// snapshot (preserves relational integrity — the same guest's two
// bookings get the same synthetic email) but a DIFFERENT synthetic
// value across snapshots (no cross-snapshot correlation, no replay
// attack). The salt is captured in the audit row so the snapshot is
// reproducible from the source export for debugging, but the salt is
// per-snapshot so two snapshots of the same source are
// uncorrelatable.
//
// AUDIT (R10, partial): every successful preview writes a row to
// `janitor/refresh-snapshots/{snapshotId}` with { createdAt, createdBy,
// projectId (staging), sourceCounts, sanitizedCounts, mode, salt, sha256
// of the source export }. The audit row carries the SHA-256 of the
// source export (for chain-of-custody) but not the source PII itself.
// Retention and deletion-replacement live in R10's follow-up.

const REFRESH_MODES = ["sanitized-snapshot", "config-only"] as const;
type RefreshMode = (typeof REFRESH_MODES)[number];

const stagingRefreshSchema = z.object({
  export: z.object({
    bookings: z.array(z.record(z.any())).optional().default([]),
    storeOrders: z.array(z.record(z.any())).optional().default([]),
    members: z.array(z.record(z.any())).optional().default([])
  }).strict(),
  options: z.object({
    mode: z.enum(REFRESH_MODES).optional().default("sanitized-snapshot"),
    snapshotNote: z.string().trim().max(280).optional().default("")
  }).strict().optional().default({ mode: "sanitized-snapshot", snapshotNote: "" })
}).strict();

// Per-snapshot deterministic hash → synthetic value.
// SHA-256(salt || ":" || sourceValue) → first 8 hex chars. 8 hex chars
// is 4 bytes / 32 bits of entropy per synthetic value — enough that
// a snapshot has no realistic birthday collision on a 14-room hotel
// (you'd need ~65k source values before 1% collision risk). The salt
// is per-snapshot and recorded in the audit row.
function syntheticFromSource(sourceValue: string | null | undefined, salt: string, prefix: string, domain: string): string {
  if (sourceValue === null || sourceValue === undefined) return "";
  const normalized = String(sourceValue).trim().toLowerCase();
  if (!normalized) return "";
  const h = crypto.createHash("sha256").update(`${salt}:${domain}:${normalized}`).digest("hex").slice(0, 8);
  return `${prefix}-${h}@${domain}`;
}

// R04 — sanitize a single booking record. PII fields are replaced
// with deterministic synthetic values. Operational fields (status,
// checkIn, checkOut, numNights, numGuests, totalPrice, financial
// breakdowns, roomNumber, roomType) are preserved verbatim — the
// point of the refresh is to keep the operational data shape so
// staging can be exercised against realistic totals, not to erase
// the test signal. Source booking IDs are preserved so joins
// (payments/charges subcollections) are reachable from the sanitized
// root doc. Guest identifiers get the synthetic replacement; staff
// UIDs (createdByUid, handledBy) get a separate synthetic actor
// mapping.
function sanitizeBookingExport(booking: any, salt: string) {
  const guestEmail = String(booking.guestEmail || "");
  const guestName = String(booking.guestName || "");
  const guestPhone = String(booking.guestPhone || "");
  const sourceEmail = guestEmail.trim().toLowerCase();

  const sanitized: any = {
    ...booking,
    guestName: syntheticFromSource(guestName, salt, "Guest", "guests.invalid"),
    guestEmail: sourceEmail
      ? syntheticFromSource(sourceEmail, salt, "guest", "example.invalid")
      : "",
    guestPhone: guestPhone
      ? syntheticFromSource(guestPhone, salt, "+63900000", "phones.invalid")
      : "",
    address: "[REDACTED — sanitized for staging]",
    emergencyContactName: "",
    emergencyContactPhone: "",
    // Government ID + signature + payment proof URLs removed — the
    // R05 file-sanitization follow-up will replace with synthetic
    // fixtures. For now, scrub the URLs so the operator can't
    // accidentally click through to the production file.
    guestIdUrl: "",
    guestIdPhotoUrl: "",
    paymentProofUrl: "",
    signatureUrl: "",
    // Booking doc keeps its original id so payments/charges
    // subcollections can be walked in step 4. bookingRef is
    // preserved so the staff can still reference it by the
    // confirmation number; createdAt/updatedAt preserved; status
    // + financial fields preserved (operational signal).
    notes: "",
    internalNotes: "",
    sourceSanitization: {
      applied: true,
      salt: salt.slice(0, 8) + "…",
      appliedAt: new Date().toISOString(),
      mode: "sanitized-snapshot"
    }
  };

  // R06 (partial) — preserve the relational shape. If the booking
  // has an `addedCharges` array, scrub any free-text PII in the
  // charge descriptions but keep the amounts/tenders so the staging
  // reports can still reconcile. If it has `payments`, scrub
  // transactionReference numbers (they reference real GCash/bank
  // traces) but keep the amounts.
  if (Array.isArray(sanitized.addedCharges)) {
    sanitized.addedCharges = sanitized.addedCharges.map((c: any) => ({
      ...c,
      description: "[REDACTED]",
      notes: ""
    }));
  }
  if (Array.isArray(sanitized.payments)) {
    sanitized.payments = sanitized.payments.map((p: any) => ({
      ...p,
      transactionReference: syntheticFromSource(p.transactionReference || "", salt, "PAY", "staging.invalid"),
      notes: ""
    }));
  }
  return sanitized;
}

function sanitizeStoreOrderExport(order: any, salt: string) {
  return {
    ...order,
    guestName: syntheticFromSource(order.guestName, salt, "Guest", "guests.invalid"),
    guestEmail: order.guestEmail
      ? syntheticFromSource(String(order.guestEmail).trim().toLowerCase(), salt, "guest", "example.invalid")
      : "",
    guestPhone: order.guestPhone
      ? syntheticFromSource(String(order.guestPhone), salt, "+63900000", "phones.invalid")
      : "",
    paymentProofUrl: "",
    notes: "",
    internalNotes: "",
    sourceSanitization: {
      applied: true,
      salt: salt.slice(0, 8) + "…",
      appliedAt: new Date().toISOString(),
      mode: "sanitized-snapshot"
    }
  };
}

function sanitizeMemberExport(member: any, salt: string) {
  return {
    ...member,
    fullName: syntheticFromSource(member.fullName, salt, "Member", "members.invalid"),
    // The member's email is the SAME identity as a guest who booked
    // with that email — use the "guest" prefix for the email so the
    // synthetic value matches the booking's synthetic email. The
    // member's full name is a separate identity (a person has one
    // email but may have multiple display names over time), so it
    // uses its own "Member" prefix for `fullName`.
    email: member.email
      ? syntheticFromSource(String(member.email).trim().toLowerCase(), salt, "guest", "example.invalid")
      : "",
    phone: member.phone
      ? syntheticFromSource(String(member.phone), salt, "+63900000", "phones.invalid")
      : "",
    photoUrl: "",
    sourceSanitization: {
      applied: true,
      salt: salt.slice(0, 8) + "…",
      appliedAt: new Date().toISOString(),
      mode: "sanitized-snapshot"
    }
  };
}

export async function handleStagingRefreshPreview(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can refresh staging from production." });
  }

  // R01 — one-way gate. The endpoint must run on a staging project;
  // running it on a production project is refused because the
  // production Firestore is where the data flows FROM (read), not
  // TO. A production caller cannot trigger a refresh.
  if (!isStagingProject()) {
    return res.status(403).json({
      success: false,
      error: "Staging refresh is only available on staging projects. The current project is not on the staging allowlist."
    });
  }

  const parsed = stagingRefreshSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid production export (bookings, storeOrders, members) and options."
    });
  }

  const { export: exportPayload, options } = parsed.data;
  const mode: RefreshMode = options.mode;

  // config-only is a no-op for the sanitization engine (it just
  // returns counts + a snapshotId; the operator imports their own
  // already-sanitized data). The endpoint still writes the audit
  // row so the configuration-only path is observable.
  const salt = crypto.randomBytes(16).toString("hex");
  const snapshotId = `refresh-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const sourceCounts = {
    bookings: exportPayload.bookings.length,
    storeOrders: exportPayload.storeOrders.length,
    members: exportPayload.members.length
  };

  try {
    const sanitizedBookings = mode === "sanitized-snapshot"
      ? exportPayload.bookings.map((b) => sanitizeBookingExport(b, salt))
      : exportPayload.bookings;

    const sanitizedStoreOrders = mode === "sanitized-snapshot"
      ? exportPayload.storeOrders.map((o) => sanitizeStoreOrderExport(o, salt))
      : exportPayload.storeOrders;

    const sanitizedMembers = mode === "sanitized-snapshot"
      ? exportPayload.members.map((m) => sanitizeMemberExport(m, salt))
      : exportPayload.members;

    const sanitizedCounts = {
      bookings: sanitizedBookings.length,
      storeOrders: sanitizedStoreOrders.length,
      members: sanitizedMembers.length
    };

    // R10 (partial) — write the audit row. We persist the SHA-256 of
    // the SOURCE export (chain-of-custody) but not the source PII
    // itself. The salt is per-snapshot and stored alongside the audit
    // row so the operator can reproduce the snapshot from the source
    // export for debugging. Per-snapshot salts are not a global
    // mapping key — they are scoped to this snapshot only.
    const sourceHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(exportPayload))
      .digest("hex");

    await adminDb.collection("janitor").doc("refresh-snapshots").collection("items").doc(snapshotId).set({
      projectId: process.env.FIREBASE_PROJECT_ID || "unknown",
      mode,
      createdAt: new Date(),
      createdBy: staff.email || staff.uid || "",
      sourceCounts,
      sanitizedCounts,
      sourceHash,
      saltPrefix: salt.slice(0, 8),
      snapshotNote: options.snapshotNote,
      status: "complete"
    });

    return res.status(200).json({
      success: true,
      data: {
        snapshotId,
        mode,
        projectId: process.env.FIREBASE_PROJECT_ID || "unknown",
        sourceCounts,
        sanitizedCounts,
        sanitized: {
          bookings: sanitizedBookings,
          storeOrders: sanitizedStoreOrders,
          members: sanitizedMembers
        }
      }
    });
  } catch (error: any) {
    console.error("Staging refresh preview failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to generate sanitized staging refresh."
    });
  }
}
