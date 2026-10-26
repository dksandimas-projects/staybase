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
  applyActionCode,
  type User
} from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import config from "@config";
import { auth, db } from "../firebase/config";
// Per Phase 2 of the Spark Rewards tier system (2026-10-12,
// decision pending): the `MemberProfile` shape gains two new
// fields — `completedStays` (counter, default 0) and
// `currentLevel` (cached `LevelDef` snapshot, default null).
// Both are optional on the `Member` server-side doc so a
// legacy pre-Phase-2 member still parses through the snapshot
// listener without a schema migration.
import type { LevelDef } from "@spark-inn/shared";

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
  // Phase 2 additions (both optional — legacy docs are valid):
  completedStays?: number;
  currentLevel?: LevelDef | null;
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

/**
 * Per §3.20 (AI-BROWSER-QA 2026-10-26): set when the guest completes
 * the email verification on a device that has NO session (the link is
 * on their phone, the session is on their laptop). The next sign-in
 * with a verified address consumes it and re-runs the registration, so
 * the past bookings get linked.
 */
const PENDING_VERIFICATION_KEY = "sparkinn.pendingEmailVerification";

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
  /**
   * Bumped when the app applies an email-verification action code, so the
   * effect that finishes the verification re-reads the session. The
   * Firebase SDK restores the session asynchronously and mutates the user
   * object in place, so a state change is the only reliable nudge.
   */
  const [verificationNonce, setVerificationNonce] = useState(0);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Per §3.21 (AI-BROWSER-QA 2026-10-26): complete the email
  // verification the guest clicks.
  //
  // The server generates the verification link with
  // `generateEmailVerificationLink` + `handleCodeInApp: true`
  // (`guest-app/server/handlers/members.ts`). The link that actually
  // reaches the guest is
  // `https://<project>.firebaseapp.com/__/auth/action?…&oobCode=…&continueUrl=…`
  // — Firebase's OWN action handler, which performs the verification and
  // then redirects to the `continueUrl` the server configured:
  // `/account/profile?emailVerified=true`.
  //
  // So the guest lands back on the app with EITHER of two shapes, and both
  // have to work:
  //
  //   a) `?emailVerified=true` (no `oobCode`) — Firebase's handler already
  //      verified the address. The app only has to notice the marker.
  //   b) `?oobCode=…` — a `handleCodeInApp` link that carried the action
  //      code onto the app's own origin. The app has to finish the action
  //      itself with `applyActionCode`.
  //
  // Before this, NEITHER shape was handled: the guest clicked the link,
  // their email was still unverified in the app, the "Verify your email"
  // banner never cleared, and (see §3.20) the past bookings were never
  // linked, so "My Stays" stayed empty for every email/password member.
  //
  // THIS effect only recognises the landing and remembers it. The refresh
  // and the re-registration live in the effect below, because the Firebase
  // SDK restores the session ASYNCHRONOUSLY: on the first render
  // `auth.currentUser` is still null, so a refresh attempted here would
  // silently do nothing — and the cached id token would keep claiming
  // `email_verified: false`, which is what makes `/api/members/stays`
  // answer 403 EMAIL_NOT_VERIFIED.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oobCode = params.get("oobCode");
    const justVerified = params.get("emailVerified") === "true";
    if (!oobCode && !justVerified) return;

    // Remember the verification SYNCHRONOUSLY — the effect below must see
    // it whether the session is already restored or not.
    try {
      window.localStorage.setItem(PENDING_VERIFICATION_KEY, "1");
    } catch {
      // A blocked storage API must not break the landing.
    }

    let cancelled = false;
    (async () => {
      try {
        // (b) The app owns the action code — finish it here.
        if (oobCode) {
          await applyActionCode(auth, oobCode);
        }
        // Take the markers out of the URL so a reload does not replay them.
        window.history.replaceState({}, document.title, window.location.pathname);
        if (cancelled) return;
        // Nudge the effect below: the action code has just been applied,
        // so the session must be re-read now.
        setVerificationNonce((n) => n + 1);
      } catch (err) {
        console.error("Email verification could not be completed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Per the exhaustive-deps rule this must run once, on mount — the
    // code is in the URL, not in React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per §3.20 (cross-device half): the verification link usually lands
  // in a DIFFERENT browser than the one the guest signed up on — the
  // mail is on their phone, the session is on their laptop. That landing
  // has no session, so the registration cannot run there; the guest then
  // signs in later and the past bookings are STILL not linked (nothing
  // re-runs `/api/members/register` for an already-enrolled member).
  //
  // This effect is the ONE place that finishes the verification. It runs
  // when the session arrives (`user`) and when the action code has just
  // been applied (`verificationNonce`), because:
  //
  //   - the Firebase SDK restores the session asynchronously, so on the
  //     first render there is no `user` at all;
  //   - the RESTORED session carries the CACHED id token, which still
  //     claims `email_verified: false`. The token has to be force-refreshed
  //     before the API will accept it — that is what turns
  //     `/api/members/stays` from 403 EMAIL_NOT_VERIFIED into the stay.
  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(PENDING_VERIFICATION_KEY) !== "1") return;

    let cancelled = false;
    (async () => {
      try {
        const current = auth.currentUser;
        if (!current) return;
        // The cached token is stale — force a refresh so the next request
        // carries the verified state.
        await current.getIdToken(true);
        if (cancelled) return;
        // `reload()` re-reads the user record; the SDK mutates the object
        // in place, so the next render sees the verified flag.
        await current.reload();
        if (cancelled) return;
        setUser(auth.currentUser);
        if (auth.currentUser?.emailVerified !== true) return;
        // Per §3.20: the registration endpoint only links the guest's past
        // bookings when the email is verified ("Once verified, re-calling
        // `/api/members/register` re-runs the link"). The signup call ran
        // while the email was still unverified, so this is the call that
        // actually links them.
        window.localStorage.removeItem(PENDING_VERIFICATION_KEY);
        await registerCurrentMember();
      } catch (err) {
        console.error("The past stays could not be linked after the verification:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Per the exhaustive-deps rule this must run once per user change —
    // the flag is in localStorage, not in React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, verificationNonce]);

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
