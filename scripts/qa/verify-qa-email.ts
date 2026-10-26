// Per AI-BROWSER-QA (2026-10-26): produce the REAL email-verification
// link for a QA identity.
//
// WHY THIS EXISTS
// The Spark Rewards signup (RW-01) sends a verification email through
// Resend. This pass has no inbox, so the guest cannot click the link in
// the mail by hand. This script generates the SAME link the server
// generates (`/api/members/send-verification-email` →
// `generateEmailVerificationLink` with `handleCodeInApp: true`), so the
// browser test can click the real thing and the app's own code path
// runs.
//
// `--email <addr>`   print the verification link (the click path)
// `--force-verify`   set `emailVerified` directly (the diagnostic
//                    fallback — it skips the app's code handling, so it
//                    does NOT prove the product's own path works)
//
// SCOPE
// One QA identity, by address. The address must be on the QA alias
// domain (`+sparkinn.dev@gmail.com`) or an explicitly-listed QA
// account — the script refuses anything else, so it can never be
// pointed at a real guest's address.

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const vars = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
const qaVars = loadEnv("e2e/.qa.env.local");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: vars.FIREBASE_PROJECT_ID,
      clientEmail: vars.FIREBASE_CLIENT_EMAIL,
      privateKey: vars.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}
const adminAuth = getAuth();

const emailIndex = process.argv.indexOf("--email");
const email = emailIndex === -1 ? "" : String(process.argv[emailIndex + 1] || "").trim().toLowerCase();
const forceVerify = process.argv.includes("--force-verify");

const QA_ALIAS_SUFFIX = "+sparkinn.dev@gmail.com";
const QA_ACCOUNTS = ["adminbot@gmail.com", "frontdeskbot@gmail.com", "memberbot@gmail.com"];

if (!email) {
  console.error("no --email given.");
  process.exit(1);
}
if (!email.endsWith(QA_ALIAS_SUFFIX) && !QA_ACCOUNTS.includes(email)) {
  console.error("refusing to touch a non-QA address.");
  process.exit(1);
}

const user = await adminAuth.getUserByEmail(email);

if (forceVerify) {
  if (user.emailVerified) {
    console.log(`already verified: ${email}`);
    process.exit(0);
  }
  await adminAuth.updateUser(user.uid, { emailVerified: true });
  console.log(`verified: ${email}`);
  process.exit(0);
}

// The link — identical to the one the server sends.
const baseUrl = String(qaVars.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com").replace(/\/$/, "");
const actionCodeSettings = {
  url: `${baseUrl}/account/profile?emailVerified=true`,
  handleCodeInApp: true
};
const link = await adminAuth.generateEmailVerificationLink(email, actionCodeSettings);
console.log(link);
