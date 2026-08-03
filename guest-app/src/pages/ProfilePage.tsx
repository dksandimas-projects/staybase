import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { User, Mail, Phone, Calendar, Trash2, Shield, Award, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import config from "@config";
import { AccountLayout } from "../components/AccountLayout";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { Modal } from "../components/Modal";
import { EmailVerifyBanner } from "../components/EmailVerifyBanner";
import { brandAsset } from "../utils/brand";
import { useGuestAuth } from "../context/GuestAuthContext";
import { doc, updateDoc } from "firebase/firestore";
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth, db } from "../firebase/config";

export function ProfilePage() {
  const { user, memberProfile, refreshMemberProfile, registerCurrentMember } = useGuestAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  // Initialize from member profile
  useEffect(() => {
    if (memberProfile) {
      const parts = memberProfile.fullName.split(" ");
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
      setPhone(memberProfile.phone || "");
    } else if (user?.displayName) {
      const parts = user.displayName.split(" ");
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
    }
  }, [memberProfile, user]);

  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    setShowSuccessAlert(false);
    setProfileError("");

    try {
      if (!memberProfile) {
        throw new Error(`Join ${config.rewardsName} first so we can save your member profile details.`);
      }
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

      // Update Firebase Auth profile
      await updateProfile(user, { displayName: fullName });

      // Update Firestore member doc
      await updateDoc(doc(db, "members", user.uid), {
        fullName,
        phone: phone.trim(),
        updatedAt: new Date()
      });

      await refreshMemberProfile();
      setShowSuccessAlert(true);
      setTimeout(() => setShowSuccessAlert(false), 3000);
    } catch (err) {
      console.error("Profile update failed:", err);
      setProfileError(err instanceof Error ? err.message : "We couldn't update your profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleJoinRewards = async () => {
    setIsEnrolling(true);
    setProfileError("");
    try {
      await registerCurrentMember();
      setShowSuccessAlert(true);
      setTimeout(() => setShowSuccessAlert(false), 3000);
    } catch (err) {
      console.error("Member enrollment failed:", err);
      setProfileError(err instanceof Error ? err.message : `We could not join ${config.rewardsName} right now. Please try again.`);
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    setPasswordError("");
    setPasswordSuccess("");

    if (!currentPassword || !newPassword) {
      setPasswordError("Please fill in both fields.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setPasswordSuccess("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setShowPasswordChange(false);
    } catch (err: any) {
      if (err?.code === "auth/wrong-password") {
        setPasswordError("Current password is incorrect.");
      } else {
        setPasswordError("We couldn't update your password. Please try again.");
      }
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeleting(true);
    setDeleteError("");

    try {
      // Per W1.4 / decision #49 / audit S2.3: account deletion goes
      // through the server-side /api/members/delete-account route so
      // every linked booking is anonymized, the pointsHistory
      // subcollection is wiped, the member doc is deleted, and the
      // Firebase Auth user is removed — all in one transaction with
      // a staff-readable audit record. We do not touch Firestore or
      // Firebase Auth directly from the client.
      const token = await auth.currentUser?.getIdToken();
      const baseUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? window.location.origin
        : import.meta.env.VITE_GUEST_APP_URL || "";
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/members/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ confirmation: "erase-my-account" })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const message = data?.error || "We couldn't delete your account. Please try again.";
        if (message.toLowerCase().includes("recent login") || message.toLowerCase().includes("sign in again")) {
          setDeleteError("Please sign in again before deleting your account.");
        } else {
          setDeleteError(message);
        }
        setIsDeleting(false);
        return;
      }
      // Auth state change will redirect the user; the success path is
      // handled by GuestAuthContext listening to onAuthStateChanged.
    } catch (err: any) {
      console.error("Account deletion failed:", err);
      setDeleteError("We couldn't delete your account. Please try again.");
      setIsDeleting(false);
    }
  };

  const isEmailProvider = user?.providerData?.some((p) => p.providerId === "password");

  return (
    <AccountLayout activeTab="profile" title="My Profile" subtitle={`Manage your ${config.rewardsName} account details.`}>
      <div className="space-y-8">
        {/*
          Per Spark Rewards audit 2026-07-18 HIGH-1: an
          unverified email/password user lands here right
          after signup. Surface the verification prompt first
          so they see it before the rewards card or the
          delete-account form. The banner also shows up on
          every subsequent visit until the email is verified.
        */}
        {user?.emailVerified === false && (
          <EmailVerifyBanner reason="registration" />
        )}
        {/* Spark Rewards Card */}
        {user && !memberProfile && (
          <div className="rounded-card bg-primary-light p-5 ring-1 ring-primary/20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-primary-dark">Finish joining {config.rewardsName}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                  Create your member profile to save account details, link eligible stays, and use rewards features. By joining, you agree to the{" "}
                  <Link to="/privacy" className="font-semibold text-primary hover:underline">Privacy Policy</Link>{" "}
                  and{" "}
                  <Link to="/terms" className="font-semibold text-primary hover:underline">Terms of Service</Link>.
                </p>
              </div>
              <PrimaryButton type="button" onClick={handleJoinRewards} disabled={isEnrolling} className="shrink-0">
                {isEnrolling ? "Joining..." : "Join Rewards"}
              </PrimaryButton>
            </div>
          </div>
        )}

        {memberProfile?.isMember && (
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ background: `linear-gradient(135deg, ${config.colors.sidebar}, ${config.colors.sidebar}ee)` }}>
            <div className="p-6 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <img src={brandAsset(config.logos.white)} alt={config.brandName} className="h-8 w-auto mb-4 opacity-90" />
                  <p className="text-xl font-heading tracking-wide">{memberProfile.fullName || "Member"}</p>
                  <p className="text-sm opacity-80 mt-1 font-mono">{memberProfile.memberNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest opacity-60 font-bold">Points Balance</p>
                  <p className="text-3xl font-heading mt-1" style={{ color: config.colors.primary }}>
                    {memberProfile.rewardsPoints?.toLocaleString() || "0"}
                  </p>
                  <p className="text-xs opacity-60 mt-1">Standard Member</p>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-white/20 flex items-center gap-4 text-xs opacity-70">
                <span className="flex items-center gap-1.5">
                  <Calendar size={12} />
                  Member since {memberProfile.memberSince ? new Date(memberProfile.memberSince).toLocaleDateString(config.locale, { month: "short", year: "numeric" }) : "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Profile Form */}
        <form onSubmit={handleSaveChanges} className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-6">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Account Details</h2>
            <p className="text-[10px] text-gray-500 mt-0.5">Update your name and contact information.</p>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
            {memberProfile?.photoUrl || user?.photoURL ? (
              <img
                src={memberProfile?.photoUrl || user?.photoURL || ""}
                alt=""
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                {(memberProfile?.fullName || user?.displayName || user?.email || "M").charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <p className="text-xs font-bold text-gray-900">Profile photo</p>
              <p className="text-[10px] text-gray-500">Shown from your sign-in provider when available.</p>
            </div>
          </div>

          {showSuccessAlert && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-800 flex items-start gap-2">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <span>Profile updated successfully.</span>
            </div>
          )}

          {profileError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{profileError}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
              First Name
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                />
              </div>
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
              Last Name
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                />
              </div>
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
            Email Address
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                value={user?.email || ""}
                disabled
                className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-3 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>
            <span className="text-[10px] text-gray-400">Email cannot be changed.</span>
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
            Phone Number
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={`${config.phoneCountryCode} 917 000 0000`}
                className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
              />
            </div>
          </label>

          <div className="pt-2 border-t border-gray-150 flex justify-end">
            <PrimaryButton type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </PrimaryButton>
          </div>
        </form>

        {/* Change Password */}
        {isEmailProvider && (
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <div>
              <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Change Password</h2>
              <p className="text-[10px] text-gray-500 mt-0.5">Update your account password.</p>
            </div>

            {passwordError && (
              <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="rounded-lg bg-green-50 p-3 text-xs text-green-800">{passwordSuccess}</p>
            )}

            {!showPasswordChange ? (
              <GhostButton onClick={() => setShowPasswordChange(true)}>
                <Shield size={16} />
                Change Password
              </GhostButton>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                  Current Password
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                  New Password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  />
                </label>
                <div className="flex gap-2">
                  <PrimaryButton type="submit">Update Password</PrimaryButton>
                  <button type="button" onClick={() => { setShowPasswordChange(false); setPasswordError(""); setCurrentPassword(""); setNewPassword(""); }} className="text-xs text-gray-500 hover:text-gray-800">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Delete Account */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-red-100 space-y-4">
          <div>
            <h2 className="text-base font-heading text-red-700 lowercase tracking-tight flex items-center gap-2">
              <Trash2 size={18} />
              Delete Account
            </h2>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Permanently delete your account and all associated data. This action cannot be undone. Compliant with RA 10173 (Data Privacy Act) right to erasure.
            </p>
          </div>
          <GhostButton onClick={() => setShowDeleteModal(true)} className="border-red-200 text-red-600 hover:bg-red-50">
            <Trash2 size={16} />
            Delete My Account
          </GhostButton>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <Modal open={showDeleteModal} onClose={() => !isDeleting && setShowDeleteModal(false)} title="Delete your account?">
            <div className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                This will permanently delete your {config.rewardsName} account, including your points balance ({memberProfile?.rewardsPoints || 0} pts), points history, and your personal data (name, email, phone, profile photo).
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                Your booking history will be anonymized: the system will keep the booking reference, dates, room type, and total for our internal accounting and RA 11862 recordkeeping, but your name, email, and phone will be removed from each booking.
              </p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Guest registry records (nationality, ID type/number) collected at physical check-in are retained for a minimum of 6 months per RA 11862 and are not part of this online account deletion.
              </p>
              <p className="text-xs text-red-600 font-semibold">This action cannot be undone.</p>

              {deleteError && (
                <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{deleteError}</p>
              )}

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="min-h-11 rounded-lg border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                  className="min-h-11 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 shadow-sm shadow-red-600/20 disabled:opacity-60"
                >
                  {isDeleting ? "Deleting..." : "Yes, delete my account"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AccountLayout>
  );
}
