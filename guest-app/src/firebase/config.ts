import { getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

// Per Spark Rewards audit 2026-07-18 LOW-2: pin the auth
// persistence to `browserLocalPersistence` (IndexedDB) so the
// guest stays signed in across page refreshes and tab
// restarts. The Firebase Web SDK defaults to local persistence
// today, but the contract is implicit — an SDK default change
// or a future refactor could silently regress "stay signed in."
// The admin app sets `browserSessionPersistence` explicitly
// (`admin-app/src/context/AdminContext.tsx`); the guest app now
// mirrors the documented intent from
// `plan/docs/SECURITY.md §Session Management`. Per the auth
// SDK contract, `setPersistence` must be called before the first
// auth state change, so it runs synchronously at module-load
// time (Vite tree-shakes the import, so this only fires when
// the guest app actually mounts).
void setPersistence(auth, browserLocalPersistence).catch((err) => {
  // Non-fatal: the SDK falls back to its default behavior
  // (which is local persistence on web today), so a failure
  // here is a UX regression at worst, not a security issue.
  console.warn("Failed to set browserLocalPersistence on guest auth:", err);
});
