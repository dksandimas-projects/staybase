import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getStorage, type Storage } from "firebase-admin/storage";

let firebaseAdminApp: App | undefined;

function normalizePrivateKey(privateKey: string) {
  return privateKey
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^'|'$/g, "")
    .replace(/\\n/g, "\n");
}

function getFirebaseAdminApp() {
  if (firebaseAdminApp) return firebaseAdminApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin Environment Variables");
  }

  firebaseAdminApp = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: normalizePrivateKey(privateKey),
        }),
      });

  return firebaseAdminApp;
}

function lazyService<T extends object>(getService: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const service = getService() as any;
      const value = service[prop];
      return typeof value === "function" ? value.bind(service) : value;
    }
  });
}

export const adminDb = lazyService<Firestore>(() => getFirestore(getFirebaseAdminApp()));
export const adminAuth = lazyService<Auth>(() => getAuth(getFirebaseAdminApp()));
// Per BF-50 (booking-flow audit 2026-06-26): exposes the
// Admin Storage service so the janitor handler can list +
// delete orphaned `bookings/{id}/` subfolders. The default
// bucket is taken from `FIREBASE_STORAGE_BUCKET` (Firebase
// deploys set it automatically).
export const adminStorage = lazyService<Storage>(() => getStorage(getFirebaseAdminApp()));
export { getFirebaseAdminApp as firebaseAdminApp };
