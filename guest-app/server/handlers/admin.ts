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

const STAFF_ROLES = ["front-desk", "admin"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  "front-desk": "Front Desk",
  admin: "Admin"
};

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
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

/**
 * Convert an EXISTING (guest) Firebase Auth account into a staff account.
 *
 * Per AUTH-01 (2026-11-23): a guest who signs up during booking already
 * owns a Firebase Auth account, so `createUser` fails with
 * `auth/email-already-exists` and the admin is stuck on "A staff account
 * with this email already exists" even though NO staff account exists.
 * The conversion keeps the SAME uid, so the guest's booking history,
 * member record and rewards points stay attached to the same identity.
 *
 * The conversion:
 *   - mints the `role` custom claim, MERGED with any claim the account
 *     already carries (`setCustomUserClaims` REPLACES the whole map, so
 *     a bare `{ role }` would silently drop a guest's other claims),
 *   - writes the staff profile into `guests/{uid}` with `merge: true`,
 *     so a pre-existing profile (a legacy member mirror, a phone number
 *     the guest already gave us) is never wiped,
 *   - applies the admin-supplied password, so the credential the admin
 *     hands over is the one that works. The guest sign-in uses the SAME
 *     account, so that password becomes the guest password too — the
 *     admin UI says so before the admin submits.
 */
async function promoteExistingAuthUserToStaff(params: {
  existingUser: any;
  fullName: string;
  email: string;
  phone: string;
  nationality: string;
  role: StaffRole;
  password: string;
  createdBy: string;
}): Promise<
  | { ok: true; uid: string }
  | { ok: false; status: number; error: string }
> {
  const { existingUser, fullName, email, phone, nationality, role, password, createdBy } = params;
  const uid = existingUser.uid;
  const existingClaims = existingUser.customClaims || {};
  const existingRole = existingClaims.role;

  // Guard 1 — the claims already carry a staff role. This is a staff
  // account, not a guest account: refuse rather than silently resetting
  // somebody's admin credentials.
  if (isStaffRole(existingRole)) {
    return {
      ok: false,
      status: 409,
      error: `This email already belongs to the existing ${STAFF_ROLE_LABELS[existingRole]} staff account. Edit that account instead of creating a new one.`
    };
  }

  // Guard 2 — the Firestore profile already marks them as staff. If the
  // requested role differs, refuse: the create path must never silently
  // demote an admin. The edit path is the way to change a role.
  const staffRef = adminDb.collection("guests").doc(uid);
  const staffDoc = await staffRef.get();
  const existingProfile = (staffDoc.exists ? staffDoc.data() : null) || {};

  if (isStaffRole(existingProfile.role) && existingProfile.role !== role) {
    return {
      ok: false,
      status: 409,
      error: `This email already belongs to the existing ${STAFF_ROLE_LABELS[existingProfile.role]} staff account. Edit that account to change their role.`
    };
  }

  const now = new Date();
  const nextClaims = { ...existingClaims, role };
  const profilePatch = {
    fullName,
    email: email.toLowerCase(),
    // An empty admin-supplied field must not wipe what is already on the
    // profile — the guest may already have given us a phone number.
    phone: phone || existingProfile.phone || "",
    nationality: nationality || existingProfile.nationality || "",
    role,
    isActive: true,
    createdBy: existingProfile.createdBy || createdBy,
    createdAt: existingProfile.createdAt || now,
    updatedAt: now
  };

  try {
    await adminAuth.updateUser(uid, {
      displayName: fullName,
      password,
      disabled: false
    });
    await adminAuth.setCustomUserClaims(uid, nextClaims);
    await staffRef.set(profilePatch, { merge: true });
  } catch (syncErr) {
    // Best-effort rollback. The PASSWORD cannot be restored — Firebase
    // never exposes it — so the admin has to retry the conversion to put
    // the credential they handed over back in place. The display name,
    // the enabled flag and the role claim CAN be restored, so the guest
    // account keeps working as a guest account.
    console.error("Staff promotion sync failed, rolling back auth details:", syncErr);
    try {
      await adminAuth.updateUser(uid, {
        displayName: existingUser.displayName || null,
        disabled: existingUser.disabled === true
      });
      await adminAuth.setCustomUserClaims(uid, existingClaims);
    } catch (rollbackErr) {
      console.error("Failed to roll back auth details during staff promotion failure:", rollbackErr);
    }
    throw syncErr;
  }

  return { ok: true, uid };
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
    const normalizedEmail = email.toLowerCase();

    let user: { uid: string };
    try {
      user = await adminAuth.createUser({
        email: normalizedEmail,
        password,
        displayName: fullName,
        disabled: false
      });
    } catch (createError: any) {
      if (createError?.code !== "auth/email-already-exists") throw createError;

      // The email already owns a Firebase Auth account — most often a
      // guest who signed up during booking. Convert that account into a
      // staff account instead of creating a second one (AUTH-01).
      const existingUser = await adminAuth.getUserByEmail(normalizedEmail);
      const promotion = await promoteExistingAuthUserToStaff({
        existingUser,
        fullName,
        email: normalizedEmail,
        phone,
        nationality,
        role,
        password,
        createdBy: staff.uid || ""
      });

      if (!promotion.ok) {
        return res.status(promotion.status).json({ success: false, error: promotion.error });
      }

      return res.status(200).json({
        success: true,
        data: {
          uid: promotion.uid,
          email: normalizedEmail,
          role,
          converted: true
        }
      });
    }

    try {
      await adminAuth.setCustomUserClaims(user.uid, { role });
      await adminDb.collection("guests").doc(user.uid).set({
        fullName,
        email: normalizedEmail,
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
        email: normalizedEmail,
        role
      }
    });
  } catch (error: any) {
    if (error?.code === "auth/email-already-exists") {
      return res.status(409).json({
        success: false,
        error: "A staff account with this email already exists. Edit that account instead of creating a new one."
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
