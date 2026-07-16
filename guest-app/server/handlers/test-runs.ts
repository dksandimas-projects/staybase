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
    if (runData.status !== "closed") {
      return res.status(400).json({
        success: false,
        error: "Only closed test runs can be cleaned up. Close the run first."
      });
    }

    await runRef.set({ status: "cleanup-in-progress" }, { merge: true });

    let bookingCount = 0;
    let storeOrderCount = 0;
    let failedItems: string[] = [];

    const batchSize = 20;

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
    const now = new Date();
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

async function collectStagingManifest(): Promise<{
  bookings: number;
  storeOrders: number;
  notifications: number;
  intercomStays: number;
  testRuns: number;
  affectedRooms: string[];
  affectedStockItems: string[];
}> {
  const [bookingsSnap, storeSnap, notifSnap, intercomSnap, testRunSnap] = await Promise.all([
    adminDb.collection("bookings").get(),
    adminDb.collection("storeOrders").get(),
    adminDb.collection("notifications").get(),
    adminDb.collection("intercoms").get(),
    adminDb.collection("testRuns").get()
  ]);

  const affectedRooms = new Set<string>();
  const affectedStockItems = new Set<string>();

  bookingsSnap.docs.forEach(d => {
    const room = d.data().roomNumber;
    if (room) affectedRooms.add(room);
  });
  storeSnap.docs.forEach(d => {
    (d.data().items || []).forEach((i: any) => {
      if (i.itemId) affectedStockItems.add(i.itemId);
    });
  });

  return {
    bookings: bookingsSnap.docs.length,
    storeOrders: storeSnap.docs.length,
    notifications: notifSnap.docs.length,
    intercomStays: intercomSnap.docs.length,
    testRuns: testRunSnap.docs.length,
    affectedRooms: [...affectedRooms].filter(Boolean),
    affectedStockItems: [...affectedStockItems].filter(Boolean)
  };
}

const stagingResetConfirmSchema = z.object({
  confirmation: z.literal("RESET STAGING"),
  projectName: z.string().trim().min(1).max(120)
}).strict();

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
    const manifest = await collectStagingManifest();

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        isStaging: true,
        manifest,
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
      error: "Type RESET STAGING and provide the project name to confirm."
    });
  }

  const { confirmation, projectName } = parsed.data;
  const currentProject = process.env.FIREBASE_PROJECT_ID || "";

  if (projectName !== currentProject) {
    return res.status(400).json({
      success: false,
      error: `Project name mismatch. Expected "${currentProject}".`
    });
  }

  try {
    const manifestBefore = await collectStagingManifest();
    const startedAt = new Date();
    let bookingCount = 0;
    let storeOrderCount = 0;
    let notifCount = 0;
    let intercomCount = 0;
    let testRunCount = 0;
    const failedItems: string[] = [];
    const batchSize = 20;

    // Delete all bookings with subcollections
    let lastDoc: any = null;
    while (true) {
      let q: any = adminDb.collection("bookings").limit(batchSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      for (const doc of snap.docs) {
        try {
          for (const sub of ["payments", "incidentalCharges", "notifications", "audit"]) {
            const subSnap = await adminDb.collection("bookings").doc(doc.id).collection(sub).get();
            await Promise.all(subSnap.docs.map(sd => sd.ref.delete()));
          }
          await doc.ref.delete();
          bookingCount++;
        } catch { failedItems.push(`booking/${doc.id}`); }
      }
    }

    // Delete all store orders with tenders
    lastDoc = null;
    while (true) {
      let q: any = adminDb.collection("storeOrders").limit(batchSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      for (const doc of snap.docs) {
        try {
          const tenderSnap = await adminDb.collection("storeOrders").doc(doc.id).collection("tenders").get();
          await Promise.all(tenderSnap.docs.map(td => td.ref.delete()));
          await doc.ref.delete();
          storeOrderCount++;
        } catch { failedItems.push(`storeOrder/${doc.id}`); }
      }
    }

    // Delete all notifications
    lastDoc = null;
    while (true) {
      let q: any = adminDb.collection("notifications").limit(batchSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      for (const doc of snap.docs) {
        try { await doc.ref.delete(); notifCount++; }
        catch { failedItems.push(`notification/${doc.id}`); }
      }
    }

    // Delete all intercom stays with messages
    lastDoc = null;
    while (true) {
      let q: any = adminDb.collection("intercoms").limit(batchSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      for (const doc of snap.docs) {
        try {
          const msgSnap = await adminDb.collection("intercoms").doc(doc.id).collection("messages").get();
          await Promise.all(msgSnap.docs.map(md => md.ref.delete()));
          await doc.ref.delete();
          intercomCount++;
        } catch { failedItems.push(`intercom/${doc.id}`); }
      }
    }

    // Delete all test runs
    lastDoc = null;
    while (true) {
      let q: any = adminDb.collection("testRuns").limit(batchSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      for (const doc of snap.docs) {
        try { await doc.ref.delete(); testRunCount++; }
        catch { failedItems.push(`testRun/${doc.id}`); }
      }
    }

    // Restore rooms to baseline
    for (const roomNumber of manifestBefore.affectedRooms) {
      if (!roomNumber) continue;
      const roomsSnap = await adminDb.collection("rooms").where("roomNumber", "==", roomNumber).get();
      for (const doc of roomsSnap.docs) {
        await doc.ref.set({
          status: "available",
          housekeepingStatus: "clean"
        }, { merge: true });
      }
    }

    // Audit trail
    const completedAt = new Date();
    const auditResult = {
      type: "staging-reset",
      bookingsDeleted: bookingCount,
      storeOrdersDeleted: storeOrderCount,
      notificationsDeleted: notifCount,
      intercomStaysDeleted: intercomCount,
      testRunsDeleted: testRunCount,
      failedItems,
      manifestBefore: {
        bookings: manifestBefore.bookings,
        storeOrders: manifestBefore.storeOrders,
        notifications: manifestBefore.notifications,
        intercomStays: manifestBefore.intercomStays,
        testRuns: manifestBefore.testRuns
      },
      startedAt,
      completedAt,
      completedBy: staff.email || "",
      projectId: currentProject
    };
    await adminDb.collection("janitor").doc("cleanups").collection("history").add(auditResult);

    return res.status(200).json({
      success: true,
      data: {
        projectId: currentProject,
        bookingsDeleted: bookingCount,
        storeOrdersDeleted: storeOrderCount,
        notificationsDeleted: notifCount,
        intercomStaysDeleted: intercomCount,
        testRunsDeleted: testRunCount,
        roomsRestored: manifestBefore.affectedRooms.length,
        failedItems: failedItems.length
      }
    });
  } catch (error: any) {
    console.error("Staging reset execution failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to execute staging reset."
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
