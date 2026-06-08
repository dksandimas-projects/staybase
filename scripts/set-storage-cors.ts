/**
 * Set Firebase Storage CORS Configuration
 * Uses Firebase Admin SDK credentials from guest-app/.env to configure CORS on the storage bucket.
 *
 * Run: npx tsx scripts/set-storage-cors.ts
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config as dotenv } from "dotenv";

// Load env from guest-app/.env
dotenv({ path: resolve(process.cwd(), "guest-app/.env") });

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, VITE_FIREBASE_STORAGE_BUCKET } = process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY || !VITE_FIREBASE_STORAGE_BUCKET) {
  console.error("❌ Missing Firebase Admin env vars. Check guest-app/.env");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    storageBucket: VITE_FIREBASE_STORAGE_BUCKET,
  });
}

const bucket = getStorage().bucket();

async function run() {
  const corsPath = resolve(process.cwd(), "firebase/cors.json");
  console.log(`Reading CORS rules from: ${corsPath}`);
  
  try {
    const corsConfig = JSON.parse(readFileSync(corsPath, "utf8"));
    
    console.log(`Applying CORS configuration on bucket: ${VITE_FIREBASE_STORAGE_BUCKET}...`);
    await bucket.setCorsConfiguration(corsConfig);
    console.log("🎉 CORS configuration successfully applied!");
    
  } catch (error: any) {
    console.error("❌ Failed to set CORS:", error.message || error);
    process.exit(1);
  }
}

run();
