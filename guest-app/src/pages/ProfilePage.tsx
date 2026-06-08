import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Mail, Phone, Calendar, Trash2, Shield, Award, Sparkles, CheckCircle2, Upload } from "lucide-react";
import config from "@config";
import { AccountLayout } from "../components/AccountLayout";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { Modal } from "../components/Modal";
import { brandAsset } from "../utils/brand";

export function ProfilePage() {
  const navigate = useNavigate();

  // Form State
  const [firstName, setFirstName] = useState("Alex");
  const [lastName, setLastName] = useState("Mercer");
  const [email, setEmail] = useState("member@sparkinn.com");
  const [phone, setPhone] = useState("+63 912 345 6789");
  
  // Profile Photo State
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Status indicators
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Mock static data
  const memberNumber = `${config.memberNumberPrefix}-00042`;
  const memberSince = "June 2, 2026";
  const pointsBalance = "2,480";
  const tierName = "Standard Member";

  const handleSaveChanges = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setShowSuccessAlert(false);

    setTimeout(() => {
      setIsSaving(false);
      setShowSuccessAlert(true);
      // Auto-hide alert after 3 seconds
      setTimeout(() => setShowSuccessAlert(false), 3000);
    }, 1000);
  };

  const handleMockPhotoUpload = () => {
    // Simulate updating photo by using a high-quality free unsplash avatar
    setAvatarUrl("https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256&h=256");
    setShowSuccessAlert(true);
    setTimeout(() => setShowSuccessAlert(false), 3000);
  };

  const handleDeleteAccountConfirm = () => {
    setShowDeleteModal(false);
    sessionStorage.removeItem("sim_auth_state");
    alert("Account deleted. All personal records have been permanently erased in compliance with RA 10173.");
    navigate("/signin");
  };

  return (
    <AccountLayout
      activeTab="profile"
      title="Member Profile"
      subtitle={`Manage your personal information and view your ${config.brandName} loyalty credentials.`}
    >
      <div className="space-y-8">
        {/* Success Alert Banner */}
        {showSuccessAlert && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-xs font-medium text-green-700 flex gap-2.5 items-start">
            <CheckCircle2 size={16} className="shrink-0 text-green-600 mt-0.5" />
            <div>
              <p className="font-bold">Profile Updated Successfully</p>
              <p className="mt-0.5">Your changes have been saved (simulated).</p>
            </div>
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-[1fr_340px]">
          {/* Form Area */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-lg font-heading text-gray-950 mb-6 flex items-center gap-2">
              <User className="text-primary" size={18} />
              Personal Details
            </h2>

            <form onSubmit={handleSaveChanges} className="space-y-6">
              {/* Profile Photo Upload section */}
              <div className="flex flex-col sm:flex-row items-center gap-4 pb-6 border-b border-gray-100">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-gray-100 ring-2 ring-primary-light flex items-center justify-center">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-primary font-heading lowercase tracking-tight">
                      {firstName.substring(0, 1)}
                      {lastName.substring(0, 1)}
                    </span>
                  )}
                </div>
                <div className="text-center sm:text-left space-y-1">
                  <p className="text-sm font-semibold text-gray-900">Profile Picture</p>
                  <p className="text-xs text-gray-500">Google accounts automatically sync their photos.</p>
                  <div className="pt-1.5 flex gap-2 flex-wrap justify-center sm:justify-start">
                    <button
                      type="button"
                      onClick={handleMockPhotoUpload}
                      className="min-h-[36px] px-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.98] transition-all"
                    >
                      <Upload size={14} />
                      Upload Photo
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarUrl(null)}
                        className="min-h-[36px] px-3 inline-flex items-center rounded-lg bg-red-50 text-xs font-semibold text-red-600 hover:bg-red-100 transition-all"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Name fields row */}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold text-gray-700">
                  First Name
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 px-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                  />
                </label>

                <label className="grid gap-2 text-xs font-semibold text-gray-700">
                  Last Name
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 px-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                  />
                </label>
              </div>

              {/* Contact fields row */}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold text-gray-700">
                  Email Address
                  <span className="relative block">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 pl-10 pr-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    />
                  </span>
                </label>

                <label className="grid gap-2 text-xs font-semibold text-gray-700">
                  Phone Number
                  <span className="relative block">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Phone size={16} />
                    </span>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 pl-10 pr-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    />
                  </span>
                </label>
              </div>

              {/* Save Button */}
              <div className="pt-2">
                <PrimaryButton type="submit" disabled={isSaving} className="w-full sm:w-auto min-w-[150px]">
                  {isSaving ? "Saving..." : "Save Changes"}
                </PrimaryButton>
              </div>
            </form>
          </div>

          {/* Cards Column */}
          <div className="space-y-6">
            {/* Spark Rewards Member Card */}
            <div className="relative overflow-hidden rounded-card bg-gradient-to-br from-gray-900 to-gray-850 p-6 text-white shadow-lg ring-1 ring-white/10 select-none aspect-[1.586/1] flex flex-col justify-between">
              {/* Card Background Branding Decor */}
              <div className="absolute right-[-20%] bottom-[-20%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[40px] pointer-events-none" />
              <div className="absolute left-[-10%] top-[-10%] w-[40%] h-[40%] bg-white/5 rounded-full blur-[20px] pointer-events-none" />

              {/* Top Row: Logo & Member Program */}
              <div className="flex justify-between items-start">
                <div className="space-y-0.5">
                  <h3 className="font-heading text-lg lowercase tracking-tight text-primary">
                    {config.brandName}
                  </h3>
                  <p className="text-[9px] uppercase tracking-wider font-semibold text-gray-400">
                    Spark Rewards
                  </p>
                </div>
                <img
                  src={brandAsset(config.logos.white)}
                  alt={config.brandName}
                  className="h-7 w-auto object-contain opacity-90"
                />
              </div>

              {/* Middle Row: Member ID and Since Info */}
              <div className="my-4">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-400">
                  Member Number
                </p>
                <p className="font-mono text-xl tracking-wider font-medium text-white mt-0.5">
                  {memberNumber}
                </p>
              </div>

              {/* Bottom Row: Name and Points */}
              <div className="flex justify-between items-end border-t border-white/10 pt-4">
                <div>
                  <p className="text-[9px] uppercase tracking-widest font-semibold text-gray-400">
                    Cardholder
                  </p>
                  <p className="text-sm font-semibold text-white truncate max-w-[140px] mt-0.5">
                    {firstName} {lastName}
                  </p>
                </div>

                <div className="text-right">
                  <div className="inline-flex items-center gap-1 bg-primary px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-white mb-1">
                    <Award size={10} />
                    {tierName}
                  </div>
                  <p className="text-xs text-gray-400">Points Balance</p>
                  <p className="text-base font-semibold text-white mt-0.5">
                    {pointsBalance} <span className="text-xs font-normal text-gray-400">pts</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Account Metadata / Security details */}
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 space-y-4">
              <div className="flex items-center gap-3">
                <Shield className="text-primary shrink-0" size={18} />
                <div>
                  <p className="text-xs font-semibold text-gray-500">Security & Account</p>
                  <p className="text-sm font-bold text-gray-900">Member since {memberSince}</p>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => alert("Simulation: Reset password link sent to " + email)}
                  className="w-full min-h-[40px] inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-all"
                >
                  Reset Password
                </button>
                
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(true)}
                  className="w-full min-h-[40px] inline-flex items-center justify-center rounded-lg bg-red-50 text-xs font-semibold text-red-600 hover:bg-red-100 transition-all"
                >
                  <Trash2 size={14} className="mr-1.5" />
                  Delete My Account
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account Warning Modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Rewards Account"
      >
        <div className="space-y-4 font-body">
          <p className="text-sm text-gray-600 leading-relaxed">
            Are you sure you want to delete your rewards account? This action is <span className="font-semibold text-red-600">permanent</span> and cannot be undone.
          </p>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-800 space-y-1.5">
            <p className="font-bold flex items-center gap-1.5">
              <Shield size={14} />
              Compliance Note (RA 10173)
            </p>
            <p>
              Under the Philippine Data Privacy Act, deleting your account initiates the immediate right to erasure. Your loyalty history, accumulated points ({pointsBalance} pts), profile information, and synced check-in records will be wiped from our databases.
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Note: Active booking records, if any, will be anonymized to maintain financial audits without referencing your personal identifying information (PII).
          </p>
          <div className="flex gap-3 pt-2 justify-end">
            <GhostButton onClick={() => setShowDeleteModal(false)} className="text-sm font-semibold border-gray-200 text-gray-700">
              Cancel
            </GhostButton>
            <button
              onClick={handleDeleteAccountConfirm}
              className="min-h-[44px] px-4 rounded-lg bg-red-600 font-semibold text-sm text-white hover:bg-red-700 active:scale-[0.98] transition-all flex items-center gap-1.5"
            >
              <Trash2 size={16} />
              Wipe and Delete Account
            </button>
          </div>
        </div>
      </Modal>
    </AccountLayout>
  );
}
