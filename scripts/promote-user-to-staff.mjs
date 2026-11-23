// Promote an EXISTING guest account to a staff account.
//
// Per AUTH-01 (2026-11-23): a guest who signs up during booking already
// owns a Firebase Auth account, so "Create Staff Account" in the admin
// app used to fail with "A staff account with this email already
// exists." The admin app now converts the account (see
// `guest-app/server/handlers/admin.ts` → `promoteExistingAuthUserToStaff`).
// This script does the same thing from the command line, for the case
// where the account has to be fixed before the fix is deployed.
//
// Usage:
//   node scripts/promote-user-to-staff.mjs <email> <front-desk|admin> [options]
//
//   --env <path>        env file to load   (default: guest-app/.env.spark-inn-prod)
//   --full-name <name>  display name to set (default: the account's current name)
//   --password <pw>     password to set    (default: a generated temporary one)
//   --apply             actually write (without it the script only reports)
//
// DRY RUN BY DEFAULT — nothing is written without `--apply`.
//
// Reads: guest-app/.env.spark-inn-prod  (prod service account)

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(path) {
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
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
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    if (key === "apply") {
      flags.apply = true;
      continue;
    }
    flags[key] = argv[++i];
  } else {
    positional.push(arg);
  }
}

const email = (positional[0] || "").trim().toLowerCase();
const role = (positional[1] || "").trim();

if (!email || !role) {
  console.error(
    "\nUsage: node scripts/promote-user-to-staff.mjs <email> <front-desk|admin> [--apply]\n"
  );
  process.exit(1);
}

if (role !== "front-desk" && role !== "admin") {
  console.error(`\n❌ Role must be "front-desk" or "admin" (got "${role}").\n`);
  process.exit(1);
}

const envPath = flags.env || "guest-app/.env.spark-inn-prod";
const env = loadEnv(envPath);

if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
  console.error(`❌ Missing Firebase Admin env vars in ${envPath}.`);
  process.exit(1);
}

const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});

const auth = getAuth(app);
const db = getFirestore(app);

function generatePassword() {
  // 16 chars, unambiguous alphabet, so it survives being read aloud
  // across a front-desk counter.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return `Spark-${out}`;
}

async function run() {
  console.log(`\nproject:  ${env.FIREBASE_PROJECT_ID}`);
  console.log(`env file: ${envPath}`);
  console.log(`email:    ${email}`);
  console.log(`role:     ${role}`);

  let existing;
  try {
    existing = await auth.getUserByEmail(email);
  } catch (error) {
    console.error(`\n❌ No Firebase Auth account for ${email}.`);
    console.error(`   (${error?.code || error?.message || "unknown error"})`);
    console.error(`   A NEW staff account can be created from the admin app instead.\n`);
    process.exit(1);
  }

  const staffRef = db.collection("guests").doc(existing.uid);
  const profileSnap = await staffRef.get();
  const profile = profileSnap.exists ? profileSnap.data() : null;

  console.log(`uid:      ${existing.uid}`);
  console.log(`current claims:  ${JSON.stringify(existing.customClaims || {})}`);
  console.log(`email verified:  ${existing.emailVerified === true}`);
  console.log(`disabled:        ${existing.disabled === true}`);
  console.log(`staff profile:   ${profile ? JSON.stringify(profile) : "(none)"}`);

  const existingRole = (existing.customClaims || {}).role;
  if (existingRole === "admin" || existingRole === "front-desk") {
    console.error(`\n❌ This email is already a ${existingRole} staff account. Nothing to do.\n`);
    process.exit(1);
  }

  if (profile && (profile.role === "admin" || profile.role === "front-desk")) {
    console.error(
      `\n❌ The staff profile already marks this account as ${profile.role}. Edit it in the admin app instead.\n`
    );
    process.exit(1);
  }

  const fullName = (flags["full-name"] || existing.displayName || "").trim();
  const password = flags.password || generatePassword();

  console.log("\n---");
  console.log(`full name: ${fullName || "(unchanged)"}`);
  console.log(`password:  ${flags.password ? "(the one you passed)" : "(generated temporary password)"}`);
  console.log(`would set the role claim to: ${role}`);
  console.log(`would write the staff profile: guests/${existing.uid}`);

  if (!flags.apply) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to apply it.\n");
    return;
  }

  const now = new Date();
  const nextClaims = { ...(existing.customClaims || {}), role };

  await auth.updateUser(existing.uid, {
    displayName: fullName || existing.displayName || undefined,
    password,
    disabled: false
  });
  await auth.setCustomUserClaims(existing.uid, nextClaims);
  await staffRef.set(
    {
      fullName,
      email,
      phone: profile?.phone || "",
      nationality: profile?.nationality || "",
      role,
      isActive: true,
      createdBy: profile?.createdBy || "",
      createdAt: profile?.createdAt || now,
      updatedAt: now
    },
    { merge: true }
  );

  console.log("\n✔ Promoted.");
  console.log(`  role claim: ${JSON.stringify(nextClaims)}`);
  console.log(`  staff profile: guests/${existing.uid}`);
  console.log(`\n🔑 Temporary password: ${password}`);
  console.log(
    "   This is the password for BOTH the staff sign-in and the guest sign-in"
  );
  console.log("   (same Firebase Auth account). Share it securely.\n");
}

run().catch((error) => {
  console.error("\n❌ Promotion failed:", error?.message || error);
  process.exit(1);
});
