import { z } from "zod";
import { adminAuth, adminDb } from "../lib/firebase-admin";

const staffRoleSchema = z.enum(["front-desk", "admin"]);

const createStaffSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(128),
  phone: z.string().trim().max(40).optional().default(""),
  nationality: z.string().trim().max(80).optional().default(""),
  role: staffRoleSchema
}).strict();

const disableStaffSchema = z.object({
  uid: z.string().trim().min(1).max(160)
}).strict();

const updateStaffSchema = z.object({
  uid: z.string().trim().min(1).max(160),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional().default(""),
  nationality: z.string().trim().max(80).optional().default(""),
  role: staffRoleSchema,
  password: z.string().min(8).max(128).optional().or(z.literal(""))
}).strict();

function getStaff(req: any) {
  return (req as any).staff || {};
}

async function hasAnotherActiveAdmin(uidToDisable: string) {
  const adminSnapshot = await adminDb
    .collection("guests")
    .where("role", "==", "admin")
    .get();

  return adminSnapshot.docs.some((doc: any) => {
    if (doc.id === uidToDisable) return false;
    const data = doc.data();
    return data.isActive !== false;
  });
}

export async function handleCreateStaff(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can create staff accounts." });
  }

  const parsed = createStaffSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the staff account details and try again."
    });
  }

  const { fullName, email, password, phone, nationality, role } = parsed.data;

  try {
    const now = new Date();
    const user = await adminAuth.createUser({
      email: email.toLowerCase(),
      password,
      displayName: fullName,
      disabled: false
    });

    try {
      await adminAuth.setCustomUserClaims(user.uid, { role });
      await adminDb.collection("guests").doc(user.uid).set({
        fullName,
        email: email.toLowerCase(),
        phone,
        nationality,
        role,
        isActive: true,
        createdBy: staff.uid || "",
        createdAt: now,
        updatedAt: now
      });
    } catch (postCreateErr) {
      // Per S4 (soft batch 2026-06-26): the
      // `adminAuth.createUser` + `setCustomUserClaims` +
      // Firestore `set` sequence is not atomic. If the
      // claims write or the Firestore set fails, the
      // auth user is left in an inconsistent state —
      // they exist in Firebase Auth but have no
      // role / profile. A retry of the create with the
      // same email then 409s on `email-already-exists`
      // and the operator is stuck. The fix rolls back
      // the auth user on any post-create failure.
      console.error("Staff post-create sync failed, rolling back auth user:", postCreateErr);
      try {
        await adminAuth.deleteUser(user.uid);
      } catch (rollbackErr) {
        console.error("Failed to roll back orphaned auth user:", rollbackErr);
      }
      throw postCreateErr;
    }

    return res.status(200).json({
      success: true,
      data: {
        uid: user.uid,
        email: email.toLowerCase(),
        role
      }
    });
  } catch (error: any) {
    if (error?.code === "auth/email-already-exists") {
      return res.status(409).json({
        success: false,
        error: "A staff account with this email already exists."
      });
    }

    console.error("Staff account creation failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to create staff account. Please try again."
    });
  }
}

export async function handleDisableStaff(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can disable staff accounts." });
  }

  const parsed = disableStaffSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please choose a staff account to disable."
    });
  }

  const { uid } = parsed.data;
  if (uid === staff.uid) {
    return res.status(400).json({
      success: false,
      error: "You cannot disable your own admin account."
    });
  }

  try {
    const staffRef = adminDb.collection("guests").doc(uid);
    const staffDoc = await staffRef.get();
    if (!staffDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Staff account was not found."
      });
    }

    const targetStaff = staffDoc.data();
    if (targetStaff?.role === "admin") {
      const anotherActiveAdmin = await hasAnotherActiveAdmin(uid);
      if (!anotherActiveAdmin) {
        return res.status(400).json({
          success: false,
          error: "You must keep at least one active admin account."
        });
      }
    }

    const now = new Date();
    // Per S4 (soft batch 2026-06-26): the previous code
    // called `adminAuth.updateUser({ disabled: true })`
    // first, then wrote the Firestore `isActive: false`
    // flag. If the Firestore write failed, the auth
    // account was disabled but the Firestore doc still
    // said `isActive: true` — the staff member couldn't
    // log in but the admin app UI thought they were
    // active, producing a ghost account. The fix writes
    // Firestore first (the source of truth for the
    // admin app), then disables the auth account, with
    // a rollback on partial failure.
    try {
      await staffRef.set({
        isActive: false,
        disabledAt: now,
        disabledBy: staff.uid || "",
        updatedAt: now
      }, { merge: true });
      await adminAuth.updateUser(uid, { disabled: true });
    } catch (syncErr) {
      // If the auth disable fails, roll back the
      // Firestore write so the doc + auth stay aligned.
      console.error("Staff disable sync failed, rolling back Firestore:", syncErr);
      try {
        await staffRef.set({
          isActive: targetStaff?.isActive !== false,
          disabledAt: null,
          disabledBy: null,
          updatedAt: new Date()
        }, { merge: true });
      } catch (rollbackErr) {
        console.error("Failed to roll back Firestore disable:", rollbackErr);
      }
      throw syncErr;
    }

    return res.status(200).json({
      success: true,
      data: { uid }
    });
  } catch (error: any) {
    if (error?.code === "auth/user-not-found") {
      return res.status(404).json({
        success: false,
        error: "Staff account was not found."
      });
    }

    console.error("Staff account disable failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to disable staff account. Please try again."
    });
  }
}

export async function handleUpdateStaff(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can update staff accounts." });
  }

  const parsed = updateStaffSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the staff account details and try again."
    });
  }

  const { uid, fullName, email, phone, nationality, role, password } = parsed.data;

  try {
    const docRef = adminDb.collection("guests").doc(uid);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        error: "Staff account was not found."
      });
    }

    const targetStaff = docSnap.data();
    if (targetStaff?.role !== "admin" && targetStaff?.role !== "front-desk") {
      return res.status(400).json({
        success: false,
        error: "Target account is not a staff member."
      });
    }

    if (targetStaff?.role === "admin" && role !== "admin") {
      if (uid === staff.uid) {
        return res.status(400).json({
          success: false,
          error: "You cannot change your own admin role."
        });
      }
      const anotherActiveAdmin = await hasAnotherActiveAdmin(uid);
      if (!anotherActiveAdmin) {
        return res.status(400).json({
          success: false,
          error: "You must keep at least one active admin account."
        });
      }
    }

    const originalAuthUser = await adminAuth.getUser(uid);
    const authUpdates: any = {
      email: email.toLowerCase(),
      displayName: fullName
    };
    if (password && password.trim().length >= 8) {
      authUpdates.password = password;
    }

    try {
      await adminAuth.updateUser(uid, authUpdates);
      if (targetStaff?.role !== role) {
        await adminAuth.setCustomUserClaims(uid, { role });
      }

      const now = new Date();
      await docRef.set({
        fullName,
        email: email.toLowerCase(),
        phone,
        nationality,
        role,
        updatedAt: now
      }, { merge: true });
    } catch (syncErr) {
      console.error("Staff update sync failed, rolling back Auth details:", syncErr);
      try {
        const rollbackParams: any = {
          email: originalAuthUser.email,
          displayName: originalAuthUser.displayName
        };
        await adminAuth.updateUser(uid, rollbackParams);
        if (targetStaff?.role !== role) {
          await adminAuth.setCustomUserClaims(uid, { role: targetStaff?.role });
        }
      } catch (rollbackErr) {
        console.error("Failed to roll back Auth user details during update failure:", rollbackErr);
      }
      throw syncErr;
    }

    return res.status(200).json({
      success: true,
      data: {
        uid,
        email: email.toLowerCase(),
        role
      }
    });
  } catch (error: any) {
    if (error?.code === "auth/email-already-exists") {
      return res.status(409).json({
        success: false,
        error: "A staff account with this email already exists."
      });
    }

    console.error("Staff account update failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to update staff account. Please try again."
    });
  }
}
