// ATR-04 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the
// server-side staff display-name resolver.
//
// WHY THIS EXISTS
// ---------------
// The check-in / check-out / walk-in handlers stamp the acting staff
// member's UID on the booking (`checkedInBy`, `checkedOutBy`,
// `createdBy`). A UID is a 28-character Firebase Auth string — it
// tells a front-desk user NOTHING, which is the whole problem
// ATR-04 / ATR-05 exist to solve.
//
// The admin app resolves a UID to a name on the client, through the
// shared `staffNameMap` resolver (`shared/utils/staffNames.ts`), built
// from the `guests` collection the `AdminContext` already subscribes
// to. The SERVER has no such subscription — `authenticateStaff`
// (`apiRouter.ts`) returns only `{ uid, email, role }` from the
// verified token, and a Firebase ID token does not carry the
// `displayName` of the staff account.
//
// So the server resolves the name ITSELF, from the same `guests`
// document the admin app reads. One collection, one source of truth
// for the staff display name.
//
// WHY IT NEVER THROWS
// -------------------
// A missing name must never fail a check-in. The resolver returns ""
// on any failure, and the caller writes an empty string — the
// attribution is then omitted by the inline surface rather than
// blocking the desk's work.

import { adminDb } from "./firebase-admin";

/**
 * The display name of a staff member, from the `guests` document.
 *
 * Returns "" when the uid is unknown, the document is missing, or the
 * read fails. Never throws — a check-in must not fail because a
 * name could not be looked up.
 */
export async function resolveStaffDisplayName(
  uid: string | null | undefined
): Promise<string> {
  if (!uid) return "";
  try {
    const snap = await adminDb.collection("guests").doc(uid).get();
    if (!snap.exists) return "";
    const data = snap.data() || {};
    // `fullName` is what the staff-provisioning handler writes
    // (`admin.ts` — `createStaff` / `updateStaff`). `displayName` and
    // `email` are the fallbacks for a staff record written before it.
    return (
      (typeof data.fullName === "string" && data.fullName.trim()) ||
      (typeof data.displayName === "string" && data.displayName.trim()) ||
      (typeof data.email === "string" && data.email.trim()) ||
      ""
    );
  } catch {
    // A name lookup is best-effort. The UID stamp is the durable
    // attribution; the name is a convenience for the reader.
    return "";
  }
}
