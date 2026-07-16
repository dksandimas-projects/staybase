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

const CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — if cleanupStartedAt is older, allow retry

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
        error: "Cleanup is already in progress. Please wait for it to complete or try again after a few minutes."
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
          const subcollections = ["payments", "incidentalCharges", "notifications", "audit"];
          for (const sub of subcollections) {
            const subSnap = await adminDb.collection("bookings").doc(doc.id).collection(sub).get();
            const deletes = subSnap.docs.map(sd => sd.ref.delete());
            await Promise.all(deletes);
          }
          await doc.ref.delete();
          bookingCount++;

          // Periodically checkpoint progress for resumability
          if (bookingCount % 20 === 0) {
            await runRef.set({ cleanupCursor: { bookingsDeleted: bookingCount, storeOrdersDeleted: storeOrderCount } }, { merge: true }).catch(() => {});
          }
        } catch (err) {
          failedItems.push(`booking/${doc.id}`);
        }
      }
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

          if (storeOrderCount % 20 === 0) {
            await runRef.set({ cleanupCursor: { bookingsDeleted: bookingCount, storeOrdersDeleted: storeOrderCount } }, { merge: true }).catch(() => {});
          }
        } catch (err) {
          failedItems.push(`storeOrder/${doc.id}`);
        }
      }
    }

    // Delete notifications for test entities
    let notifQ: any = adminDb.collection("notifications").where("testRunId", "==", runId);
    const notifSnap = await notifQ.get();
    for (const doc of notifSnap.docs) {
      try { await doc.ref.delete(); } catch { failedItems.push(`notification/${doc.id}`); }
    }

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

async function acquireResetLock(staff: any, currentProject: string): Promise<{ acquired: boolean; message?: string }> {
  const lockRef = adminDb.collection("janitor").doc("staging-reset-lock");
  const now = new Date();
  try {
    let acquired = false;
    let message: string | undefined;
    await adminDb.runTransaction(async (tx) => {
      const lockDoc = await tx.get(lockRef);
      if (lockDoc.exists) {
        const data = lockDoc.data()!;
        const startedAt = data.startedAt?.toDate?.() || data.startedAt;
        if (data.status === "running" && startedAt && (now.getTime() - new Date(startedAt).getTime()) < LOCK_TIMEOUT_MS) {
          message = "A staging reset is already in progress. Please wait for it to complete or try again after 30 minutes.";
          return;
        }
      }
      tx.set(lockRef, {
        projectId: currentProject,
        startedAt: now,
        status: "running",
        phase: "starting",
        checkpoint: 0,
        startedBy: staff.email || ""
      });
      acquired = true;
    });
    return { acquired, message };
  } catch {
    return { acquired: false, message: "Unable to acquire reset lock. Please try again." };
  }
}

async function releaseResetLock(lockRef: any, status: string, phase: string, checkpoint: number) {
  try {
    await lockRef.set({ status, phase, checkpoint, completedAt: new Date() }, { merge: true });
  } catch { /* best-effort */ }
}

async function collectFullManifest(): Promise<{
  bookings: number; storeOrders: number; notifications: number; intercomStays: number;
  testRuns: number; calls: number; dailyCloses: number; corporateInquiries: number;
  roomBlocks: number; cleanupHistory: number; affectedRooms: string[]; affectedStockItems: string[];
}> {
  const [bookingsSnap, storeSnap, notifSnap, intercomSnap, testRunSnap, callsSnap, dailyCloseSnap, corpInquirySnap, roomBlocksSnap, cleanupSnap] = await Promise.all([
    adminDb.collection("bookings").get(),
    adminDb.collection("storeOrders").get(),
    adminDb.collection("notifications").get(),
    adminDb.collection("intercoms").get(),
    adminDb.collection("testRuns").get(),
    adminDb.collection("calls").get(),
    adminDb.collection("dailyClose").get(),
    adminDb.collection("corporateInquiries").get(),
    adminDb.collection("roomBlocks").get(),
    adminDb.collection("janitor").doc("cleanups").collection("history").get()
  ]);

  const affectedRooms = new Set<string>();
  bookingsSnap.docs.forEach(d => { const r = d.data().roomNumber; if (r) affectedRooms.add(r); });
  roomBlocksSnap.docs.forEach(d => { const r = d.data().roomNumber; if (r) affectedRooms.add(r); });

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
    affectedStockItems: []
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

  // ETR-S10: validate preview
  try {
    const previewRef = adminDb.collection("janitor").doc("previews").collection("items").doc(previewId);
    const previewDoc = await previewRef.get();
    if (!previewDoc.exists) {
      return res.status(400).json({ success: false, error: "Preview not found. Please run a new preview." });
    }
    const preview = previewDoc.data()!;
    const createdAt = preview.createdAt?.toDate?.() || preview.createdAt;
    if (createdAt && (Date.now() - new Date(createdAt).getTime()) > PREVIEW_TTL_MS) {
      return res.status(400).json({ success: false, error: "Preview has expired. Please run a new preview." });
    }
    if (preview.projectId !== currentProject) {
      return res.status(400).json({ success: false, error: "Preview was created for a different project." });
    }
    // Check for material drift
    const currentManifest = await collectFullManifest();
    if (hashManifest(currentManifest) !== preview.manifestHash) {
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
  const lock = await acquireResetLock(staff, currentProject);
  if (!lock.acquired) {
    return res.status(lock.message?.includes("already in progress") ? 409 : 500).json({
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
    }
  }

  // ETR-S11: wrap entire execution in fail-closed semantics
  try {
    manifestBefore = await collectFullManifest();

    // Phase: bookings
    await lockRef.set({ phase: "bookings", checkpoint: 0 }, { merge: true });
    const bCounter = { value: 0 };
    await deleteCollectionPage("bookings", ["payments", "incidentalCharges", "notifications", "audit"], bCounter);
    bookingCount = bCounter.value;

    // Phase: store orders
    await lockRef.set({ phase: "storeOrders", checkpoint: bookingCount }, { merge: true });
    const sCounter = { value: 0 };
    await deleteCollectionPage("storeOrders", ["tenders"], sCounter);
    storeOrderCount = sCounter.value;

    // Phase: notifications
    await lockRef.set({ phase: "notifications", checkpoint: storeOrderCount }, { merge: true });
    const nCounter = { value: 0 };
    await deleteCollectionPage("notifications", [], nCounter);
    notifCount = nCounter.value;

    // Phase: intercom stays
    await lockRef.set({ phase: "intercoms", checkpoint: notifCount }, { merge: true });
    const iCounter = { value: 0 };
    await deleteCollectionPage("intercoms", ["messages"], iCounter);
    intercomCount = iCounter.value;

    // Phase: test runs
    await lockRef.set({ phase: "testRuns", checkpoint: intercomCount }, { merge: true });
    const tCounter = { value: 0 };
    await deleteCollectionPage("testRuns", [], tCounter);
    testRunCount = tCounter.value;

    // ETR-S12: additional collections
    // Calls + ICE candidates
    await lockRef.set({ phase: "calls", checkpoint: testRunCount }, { merge: true });
    const cCounter = { value: 0 };
    await deleteCollectionPage("calls", [], cCounter);
    callCount = cCounter.value;

    // Daily Close records
    await lockRef.set({ phase: "dailyClose", checkpoint: callCount }, { merge: true });
    const dCounter = { value: 0 };
    await deleteCollectionPage("dailyClose", [], dCounter);
    dailyCloseCount = dCounter.value;

    // Corporate inquiries
    await lockRef.set({ phase: "corporateInquiries", checkpoint: dailyCloseCount }, { merge: true });
    const ciCounter = { value: 0 };
    await deleteCollectionPage("corporateInquiries", [], ciCounter);
    corpInquiryCount = ciCounter.value;

    // Room blocks
    await lockRef.set({ phase: "roomBlocks", checkpoint: corpInquiryCount }, { merge: true });
    const rbCounter = { value: 0 };
    await deleteCollectionPage("roomBlocks", [], rbCounter);
    roomBlockCount = rbCounter.value;

    // Cleanup history
    await lockRef.set({ phase: "cleanupHistory", checkpoint: roomBlockCount }, { merge: true });
    const clCounter = { value: 0 };
    const cleanupSnap = await adminDb.collection("janitor").doc("cleanups").collection("history").get();
    for (const doc of cleanupSnap.docs) {
      try { await doc.ref.delete(); clCounter.value++; }
      catch { failedItems.push(`cleanupHistory/${doc.id}`); }
    }
    cleanupCount = clCounter.value;

    // Restore rooms to baseline
    await lockRef.set({ phase: "rooms", checkpoint: cleanupCount }, { merge: true });
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
      verifyCollection("dailyClose"),
      verifyCollection("corporateInquiries"),
      verifyCollection("roomBlocks")
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

    if (integrityErrors.length > 0) {
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
      integrityErrors: integrityErrors.length > 0 ? integrityErrors : undefined,
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
      terminalStatus: integrityFailed ? "incomplete" : "complete"
    };
    await adminDb.collection("janitor").doc("cleanups").collection("history").add(auditResult);

    if (integrityFailed) {
      await releaseResetLock(lockRef, "failed", "integrity", 0);
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
    await releaseResetLock(lockRef, "failed", "error", 0);
    return res.status(500).json({
      success: false,
      error: "Unable to execute staging reset. The reset lock has been released and you can retry after a moment."
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
