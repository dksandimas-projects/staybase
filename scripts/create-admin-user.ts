/**
 * Create Admin User Script
 * Creates a staff account in Firebase Auth, sets the admin custom claim, and adds the guest document in Firestore.
 *
 * Run: npx tsx scripts/create-admin-user.ts <email> <password> <displayName>
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resolve } from "path";
import { config as dotenv } from "dotenv";

// Load env from guest-app/.env
dotenv({ path: resolve(process.cwd(), "guest-app/.env") });

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error("❌ Missing Firebase Admin env vars. Check guest-app/.env");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("\nUsage: npx tsx scripts/create-admin-user.ts <email> <password> [displayName]\n");
  process.exit(1);
}

const email = args[0];
const password = args[1];
const displayName = args[2] || "Hotel Admin";

if (password.length < 6) {
  console.error("❌ Password must be at least 6 characters long.");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const auth = getAuth();
const db = getFirestore();

async function run() {
  console.log(`\nCreating admin user: ${email}...`);

  try {
    // 1. Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
    });

    console.log(`✔ Created Firebase Auth account with UID: ${userRecord.uid}`);

    // 2. Set custom claim for admin role
    await auth.setCustomUserClaims(userRecord.uid, { role: "admin" });
    console.log(`✔ Set custom claim { role: "admin" }`);

    // 3. Create guest document in Firestore
    await db.collection("guests").doc(userRecord.uid).set({
      fullName: displayName,
      email,
      phone: "",
      nationality: "",
      role: "admin",
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`✔ Created Firestore document in guests/${userRecord.uid}`);
    console.log(`\n🎉 Success! You can now log into the admin panel at http://localhost:5173 using this email and password.\n`);

  } catch (error: any) {
    console.error("❌ Failed to create admin user:", error.message || error);
    process.exit(1);
  }
}

run();
