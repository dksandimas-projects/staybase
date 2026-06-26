import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
  throw new Error("Missing Firebase Admin Environment Variables");
}

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });

export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);
// Per BF-50 (booking-flow audit 2026-06-26): exposes the
// Admin Storage service so the janitor handler can list +
// delete orphaned `bookings/{id}/` subfolders. The default
// bucket is taken from `FIREBASE_STORAGE_BUCKET` (Firebase
// deploys set it automatically).
export const adminStorage = getStorage(app);
export { app as firebaseAdminApp };
