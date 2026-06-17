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
    await adminAuth.updateUser(uid, { disabled: true });
    await staffRef.set({
      isActive: false,
      disabledAt: now,
      disabledBy: staff.uid || "",
      updatedAt: now
    }, { merge: true });

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
