import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  sendEmailVerification as firebaseSendEmailVerification,
  updateProfile,
  type User
} from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import config from "@config";
import { auth, db } from "../firebase/config";

export interface MemberProfile {
  uid: string;
  email: string;
  fullName: string;
  phone: string;
  memberNumber: string;
  isMember: boolean;
  isActive: boolean;
  rewardsPoints: number;
  tier: string;
  memberSince: string;
  authProvider: string;
  photoUrl: string;
}

interface GuestAuthContextValue {
  user: User | null;
  memberProfile: MemberProfile | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, firstName: string, lastName: string, phone: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  registerCurrentMember: () => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  /**
   * Per Spark Rewards audit 2026-07-18 HIGH-1: re-sends the
   * Firebase email-verification email for the currently signed-in
   * email/password user. The user object is then `reload()`-ed so
   * `user.emailVerified` reflects the new state. Google sign-in
   * users never need this — their tokens are always verified.
   */
  resendVerification: () => Promise<void>;
  /** Refreshes the Firebase user (re-reads `emailVerified` from the server). */
  refreshAuthUser: () => Promise<void>;
  refreshMemberProfile: () => Promise<void>;
}

const GuestAuthContext = createContext<GuestAuthContextValue | null>(null);

export function useGuestAuth(): GuestAuthContextValue {
  const ctx = useContext(GuestAuthContext);
  if (!ctx) throw new Error("useGuestAuth must be used within GuestAuthProvider");
  return ctx;
}

async function registerMember(idToken: string, payload: any) {
  const res = await fetch("/api/members/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

/**
 * Sends the branded verification email via the custom API
 * (`/api/members/send-verification-email`), which generates
 * a Firebase `generateEmailVerificationLink` server-side and
 * dispatches a styled Resend email. Returns `false` only if a
 * network failure prevented the request from reaching the
 * server AND the SDK fallback succeeded.
 *
 * Important (2026-08-20 bug fix): we do NOT swallow the
 * API's HTTP error responses (4xx/5xx) just to attempt a
 * Firebase SDK fallback. The SDK fallback produces an
 * unbranded email through a different code path and — more
 * importantly — its own per-user throttle throws
 * `auth/too-many-requests`, which previously propagated out
 * of this helper as a misleading "wait a minute" message
 * triggered by the API's 429, not the SDK's.
 *
 * The SDK fallback is reserved for the case where the
 * network call itself failed (offline / DNS / CORS) — in
 * that case we let the SDK surface its own error and the
 * banner's `auth/too-many-requests` mapping still applies.
 */
async function sendCustomVerificationEmail(user: User): Promise<boolean> {
  let res: Response;
  try {
    const idToken = await user.getIdToken();
    res = await fetch("/api/members/send-verification-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Be" + "arer " + idToken,
      }
    });
  } catch (networkErr) {
    // The request never reached the server. Fall back to the
    // SDK so the user still gets an email. Any SDK error
    // (e.g. `auth/too-many-requests`) propagates to the
    // caller so the banner can surface it accurately.
    console.warn("Custom verification email API unreachable, falling back to Firebase SDK:", networkErr);
    await firebaseSendEmailVerification(user);
    return false;
  }

  if (!res.ok) {
    // The API responded with an error (e.g. 429 rate limit,
    // 500 server error). Surface that exact error to the
    // banner — do NOT swallow it with a SDK fallback that
    // would throw a different, misleading error.
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return true;
}

export function GuestAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Listen to member profile when user changes
  useEffect(() => {
    if (!user) {
      setMemberProfile(null);
      return;
    }

    const memberRef = doc(db, "members", user.uid);
    const unsubscribe = onSnapshot(memberRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setMemberProfile({
          uid: snap.id,
          email: data.email || user.email || "",
          fullName: data.fullName || user.displayName || "",
          phone: data.phone || "",
          memberNumber: data.memberNumber || "",
          isMember: data.isMember || false,
          isActive: data.isActive !== false,
          rewardsPoints: data.rewardsPoints || 0,
          tier: data.tier || "standard",
          memberSince: data.memberSince || "",
          authProvider: data.authProvider || "",
          photoUrl: data.photoUrl || user.photoURL || ""
        });
      } else {
        setMemberProfile(null);
      }
    });

    return unsubscribe;
  }, [user]);

  const refreshMemberProfile = async () => {
    if (!user) return;
    const snap = await getDoc(doc(db, "members", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      setMemberProfile({
        uid: snap.id,
        email: data.email || user.email || "",
        fullName: data.fullName || user.displayName || "",
        phone: data.phone || "",
        memberNumber: data.memberNumber || "",
        isMember: data.isMember || false,
        isActive: data.isActive !== false,
        rewardsPoints: data.rewardsPoints || 0,
        tier: data.tier || "standard",
        memberSince: data.memberSince || "",
        authProvider: data.authProvider || "",
        photoUrl: data.photoUrl || user.photoURL || ""
      });
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } finally {
      setLoading(false);
    }
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    phone: string
  ) => {
    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, {
        displayName: `${firstName.trim()} ${lastName.trim()}`
      });

      // Per Spark Rewards audit 2026-07-18 HIGH-1: send the
      // verification email right after signup so the
      // email/password user can be promoted to
      // `email_verified === true` (the server gate that protects
      // email-based booking matches). We call custom Resend email
      // API with Firebase SDK fallback.
      void sendCustomVerificationEmail(credential.user).catch((err) => {
        console.error("sendCustomVerificationEmail failed (non-blocking):", err);
      });

      const idToken = await credential.user.getIdToken();
      await registerMember(idToken, {
        fullName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        phone: phone.trim(),
        authProvider: "email"
      });
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } finally {
      setLoading(false);
    }
  };

  const registerCurrentMember = async () => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error(`Please sign in before joining ${config.rewardsName}.`);
    }
    const providerId = current.providerData.some((provider) => provider.providerId === "google.com")
      ? "google"
      : "email";
    const idToken = await current.getIdToken();
    await registerMember(idToken, {
      fullName: current.displayName || "",
      phone: current.phoneNumber || "",
      photoUrl: current.photoURL || "",
      authProvider: providerId
    });
    await refreshMemberProfile();
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setMemberProfile(null);
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  // Per Spark Rewards audit 2026-07-18 HIGH-1: re-sends the
  // verification email + reloads the user so `user.emailVerified`
  // reflects the latest server state. Throttle guard: Firebase
  // rate-limits verification sends; the toast surfaces a friendly
  // "try again in a minute" on the SDK's `too-many-requests` error.
  const resendVerification = async () => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error("Please sign in before resending the verification email.");
    }
    await sendCustomVerificationEmail(current);
    await current.reload();
    setUser(auth.currentUser);
  };

  // Refreshes the Firebase user from the server (re-reads
  // `emailVerified`, `displayName`, etc.). Call after a page-focus
  // event so a user who clicked the verification link in another
  // tab sees the verified state without a manual sign-out.
  const refreshAuthUser = async () => {
    const current = auth.currentUser;
    if (!current) return;
    await current.reload();
    setUser(auth.currentUser);
  };

  return (
    <GuestAuthContext.Provider
      value={{
        user,
        memberProfile,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        registerCurrentMember,
        signOut,
        sendPasswordReset,
        resendVerification,
        refreshAuthUser,
        refreshMemberProfile
      }}
    >
      {children}
    </GuestAuthContext.Provider>
  );
}
