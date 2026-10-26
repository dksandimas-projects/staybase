// AI-BROWSER-QA (2026-10-26) — probe where the REAL verification link
// lands.
//
// §3.22 follow-up. The link the guest receives comes from the Admin SDK
// (`generateEmailVerificationLink`, `handleCodeInApp: true`), so it is
// `https://<project>.firebaseapp.com/__/auth/action?...&oobCode=…&continueUrl=…`
// — NOT a link that carries the `oobCode` onto the app's own origin.
//
// This probe follows the link WITHOUT following the final redirect, so
// the `Location` header shows exactly where the guest is sent.
//
// Usage: node probe-verification-redirect.mjs <qa-alias-email>

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

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

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email.endsWith("+sparkinn.dev@gmail.com")) {
  console.error("refusing to touch a non-QA address.");
  process.exit(1);
}

const baseUrl = String(qaVars.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com").replace(/\/$/, "");

// The address may not exist yet — create it (an unverified QA throwaway).
let user;
try {
  user = await adminAuth.getUserByEmail(email);
} catch {
  user = await adminAuth.createUser({ email, password: `Qa!${Math.random().toString(36).slice(2)}Aa1` });
  console.log(`created the throwaway account: ${user.uid}`);
}

const link = await adminAuth.generateEmailVerificationLink(email, {
  url: `${baseUrl}/account/profile?emailVerified=true`,
  handleCodeInApp: true
});

console.log(`link host: ${new URL(link).host}`);
console.log(`link path: ${new URL(link).pathname}`);
console.log(`link query keys: ${Array.from(new URL(link).searchParams.keys()).join(", ")}`);

const res = await fetch(link, { redirect: "manual" });
console.log(`status: ${res.status}`);
console.log(`location: ${res.headers.get("location")}`);
const body = await res.text();
console.log(`body (first 1200 chars):\n${body.slice(0, 1200)}`);

const after = await adminAuth.getUserByEmail(email);
console.log(`emailVerified after the click: ${after.emailVerified}`);
