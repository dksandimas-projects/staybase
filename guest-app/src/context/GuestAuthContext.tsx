import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile,
  type User
} from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
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
}

interface GuestAuthContextValue {
  user: User | null;
  memberProfile: MemberProfile | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, firstName: string, lastName: string, phone: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  refreshMemberProfile: () => Promise<void>;
}

const GuestAuthContext = createContext<GuestAuthContextValue | null>(null);

export function useGuestAuth(): GuestAuthContextValue {
  const ctx = useContext(GuestAuthContext);
  if (!ctx) throw new Error("useGuestAuth must be used within GuestAuthProvider");
  return ctx;
}

async function registerMember(idToken: string): Promise<void> {
  const res = await fetch("/api/members/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    }
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || !result?.success) {
    console.error("Member registration failed:", result?.error);
  }
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
          authProvider: data.authProvider || ""
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
        authProvider: data.authProvider || ""
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

      const idToken = await credential.user.getIdToken();
      await registerMember(idToken);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);

      // Auto-register as member if not already enrolled
      const idToken = await credential.user.getIdToken();
      await registerMember(idToken);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setMemberProfile(null);
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
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
        signOut,
        sendPasswordReset,
        refreshMemberProfile
      }}
    >
      {children}
    </GuestAuthContext.Provider>
  );
}
