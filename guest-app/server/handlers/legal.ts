import { z } from "zod";
import { adminDb } from "../lib/firebase-admin";
import { DEFAULT_TERMS_VERSION, TERMS_BODY_MAX_LENGTH } from "@spark-inn/shared";

// Per LCE-01 (decision #137, 2026-07-25): admin-only endpoint
// that overwrites `settings/websiteContent.termsBody` and
// auto-bumps the patch version (e.g. 1.0.0 → 1.0.1). The
// `termsLastUpdated` is set to the current ISO date. Returns
// the new version + last-updated so the admin editor can
// surface the new value without a second round-trip.
//
// The body is plain text only (no HTML) — the public Terms
// page renders with `whitespace-pre-line` so the admin keeps
// their paragraph + list structure. No sanitization needed
// for plain text; rejecting HTML-like angle brackets in the
// schema would surprise admins who paste terms with `&`,
// `<=`, `>=`, etc., so we leave the validation to the
// `maxLength` cap + the Zod-typed `string` shape.
//
// Caller is admin-only (mirror the existing `set-active`
// route's role gate). Front-desk is a 403. The endpoint
// re-reads the current `termsVersion` inside a transaction so
// two concurrent admin saves don't both stamp the same patch
// level — the transaction re-reads + increments + writes in
// one Firestore commit (Admin SDK bypasses the rules allowlist
// + the staff update allowlist, so this path doesn't depend
// on rules-layer cooperation).
const updateTermsSchema = z.object({
  termsBody: z.string().trim().min(1).max(TERMS_BODY_MAX_LENGTH)
}).strict();

export async function handleUpdateTerms(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = (req as any).staff || {};
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }
  if (staff.role !== "admin") {
    // Front-desk cannot edit the public terms. The legal
    // surface is owner-controlled; admin role is the gate.
    return res.status(403).json({ success: false, error: "Only admins can update terms." });
  }

  const parsed = updateTermsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: `Terms body is required and must be 1-${TERMS_BODY_MAX_LENGTH.toLocaleString()} characters.`
    });
  }

  const { termsBody } = parsed.data;
  const now = new Date();
  const lastUpdated = now.toISOString().slice(0, 10); // YYYY-MM-DD

  let responseData: any = {};
  try {
    await adminDb.runTransaction(async (transaction: any) => {
      const websiteContentRef = adminDb.collection("settings").doc("websiteContent");
      const websiteContentDoc = await transaction.get(websiteContentRef);
      const existingVersion =
        websiteContentDoc.exists && typeof websiteContentDoc.data()?.termsVersion === "string"
          ? (websiteContentDoc.data()!.termsVersion as string)
          : DEFAULT_TERMS_VERSION;
      const nextVersion = bumpPatchVersion(existingVersion);

      // Use `setDoc(..., { merge: true })` semantics via the
      // transaction's `set` with a partial object — the
      // transaction writes the three updated fields and
      // preserves the rest of the websiteContent document
      // (homepage hero, about story, contact, etc.).
      transaction.set(
        websiteContentRef,
        {
          termsBody,
          termsVersion: nextVersion,
          termsLastUpdated: lastUpdated,
          termsUpdatedBy: staff.uid,
          termsUpdatedAt: now.toISOString()
        },
        { merge: true }
      );

      responseData = {
        termsBody,
        termsVersion: nextVersion,
        termsLastUpdated: lastUpdated
      };
    });

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    console.error("Update terms failed:", error);
    return res.status(500).json({
      success: false,
      error: "We could not save the terms. Please try again."
    });
  }
}

// Bumps the patch level of a semver-like string. Accepts
// `1.0.0`, `1.0.0-something`, malformed input → falls back to
// the default version + a patch bump. The major + minor
// levels are preserved (the admin can't change them via this
// endpoint — the audit only requires version *progression*,
// not semantic versioning per se).
function bumpPatchVersion(current: string): string {
  const defaultBumped = bumpPatchVersionFromString(DEFAULT_TERMS_VERSION);
  if (typeof current !== "string" || current.length === 0) return defaultBumped;
  const result = bumpPatchVersionFromString(current);
  return result || defaultBumped;
}

function bumpPatchVersionFromString(version: string): string {
  // Matches `MAJOR.MINOR.PATCH` with optional pre-release
  // suffix. The pre-release suffix (e.g. `-draft`, `-rc1`) is
  // preserved verbatim — admin saves during a draft cycle
  // keep the same suffix.
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) return "";
  const [, major, minor, patch, suffix] = match;
  return `${major}.${minor}.${Number(patch) + 1}${suffix}`;
}
