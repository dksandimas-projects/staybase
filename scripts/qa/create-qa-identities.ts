// AI-BROWSER-QA (2026-10-28) — create (or repair) the three QA
// identities the automated lane needs.
//
// WHY THIS EXISTS
// ---------------
// The handover cleanup removed every QA identity from the PRODUCTION
// tenant, so the hotel inherits a user list with no test accounts in
// it — which is the point. But the automated QA lane needs three
// identities to run against production:
//
//   adminbot@gmail.com        role=admin        (the admin E2E spec)
//   frontdeskbot@gmail.com    role=front-desk   (the staff write specs)
//   memberbot@gmail.com        role=(none)       (the member specs)
//
// This script brings them back. It is DELIBERATE: it only ever writes
// the three QA identities, it never touches a real account, and it
// prints nothing secret.
//
// THE PASSWORDS
// -------------
// The passwords are NOT in the repo. They live in the gitignored
// `e2e/.qa.env.local` (QA_ADMIN_PASSWORD, QA_FRONTDESK_PASSWORD,
// QA_MEMBER_PASSWORD), exactly like every other QA credential. If a
// variable is missing the script refuses to run rather than inventing a
// weak one.
//
//   npm run qa:identities            create or update the three
//   npm run qa:identities -- --list  show what exists, write nothing
//
// USAGE AT HANDOVER
// ------------------
// The hotel should NOT have QA accounts. If the team wants the lane to
// keep running afterwards, run this once, and treat the three
// identities as a shared team credential — or delete them again with
// the same cleanup script used for the handover.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const prod = loadEnv("guest-app/.env.spark-inn-prod");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: prod.FIREBASE_PROJECT_ID,
      clientEmail: prod.FIREBASE_CLIENT_EMAIL,
      privateKey: String(prod.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n")
    })
  });
}
const auth = getAuth();
const db = getFirestore();

const IDENTITIES = [
  { emailKey: "QA_ADMIN_EMAIL", passwordKey: "QA_ADMIN_PASSWORD", role: "admin", name: "QA Admin" },
  { emailKey: "QA_FRONTDESK_EMAIL", passwordKey: "QA_FRONTDESK_PASSWORD", role: "front-desk", name: "QA Front Desk" },
  { emailKey: "QA_MEMBER_EMAIL", passwordKey: "QA_MEMBER_PASSWORD", role: "", name: "QA Member" }
];

const qaEnv = loadEnv("e2e/.qa.env.local");

async function findByEmail(email: string) {
  try {
    return await auth.getUserByEmail(email);
  } catch (err: any) {
    if (err?.code === "auth/user-not-found") return null;
    throw err;
  }
}

const listOnly = process.argv.includes("--list");

console.log("=== the QA identities ===\n");
for (const id of IDENTITIES) {
  const email = qaEnv[id.emailKey];
  if (!email) {
    console.log(`  ${id.emailKey.padEnd(24)} NOT SET in e2e/.qa.env.local — skipped`);
    continue;
  }
  const existing = await findByEmail(email);

  if (listOnly) {
    console.log(
      `  ${email.padEnd(30)} ${existing ? `exists  role=${(existing.customClaims as any)?.role || "(none)"}  disabled=${existing.disabled}` : "absent"}`
    );
    continue;
  }

  const password = qaEnv[id.passwordKey];
  if (!password) {
    console.error(`  ${email}: ${id.passwordKey} is missing — refusing to invent a password`);
    process.exitCode = 2;
    continue;
  }

  let uid = existing?.uid;
  if (!existing) {
    const created = await auth.createUser({ email, password, emailVerified: true, displayName: id.name });
    uid = created.uid;
    console.log(`  created ${email} (uid ${uid.slice(0, 12)}...)`);
  } else {
    await auth.updateUser(existing.uid, { password, emailVerified: true, displayName: id.name, disabled: false });
    console.log(`  updated ${email} (uid ${existing.uid.slice(0, 12)}...)`);
  }
  if (!uid) {
    console.error(`  ${email}: no uid after create/update — refusing to continue`);
    process.exitCode = 2;
    continue;
  }

  // The role claim is what `authenticateStaff` reads.
  await auth.setCustomUserClaims(uid, id.role ? { role: id.role } : {});
  console.log(`      role claim: ${id.role || "(none)"}`);

  // The desk's staff list is the `guests` collection.
  const g = await db.collection("guests").where("email", "==", email).get();
  if (g.empty) {
    await db.collection("guests").add({
      fullName: id.name,
      email,
      phone: "",
      nationality: "",
      role: id.role || "member",
      isActive: true,
      createdAt: new Date()
    });
    console.log("      guest record created");
  }
}

if (listOnly) console.log("\n  (list only — nothing was written)");
else console.log("\n  done. The QA lane can run against production again.");
