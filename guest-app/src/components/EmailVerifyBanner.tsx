import { useState } from "react";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";
import { useGuestAuth } from "../context/GuestAuthContext";

// Per Spark Rewards audit 2026-07-18 HIGH-1: a guest who signs up
// with email/password (or any email/password user whose token
// carries `email_verified: false`) sees this banner on every
// /account/* page. The banner explains why their past-booking
// link is paused, surfaces a "Resend" button, and disappears the
// moment they verify (the next auth-state tick from
// `onAuthStateChanged` after they click the link in the
// verification email will surface `user.emailVerified === true`).
//
// Google sign-in users never see this — Firebase verifies
// `email_verified` server-side for the Google provider.

interface EmailVerifyBannerProps {
  /** Why the banner is showing — used in the helper copy. */
  reason?: "past-stays" | "early-checkin" | "registration";
}

const REASON_COPY: Record<NonNullable<EmailVerifyBannerProps["reason"]>, string> = {
  "past-stays":
    "Verify your email to see your past stays and link your booking history. Check your inbox for the verification link.",
  "early-checkin":
    "Verify your email before requesting early check-in — we use the verified address to confirm your booking.",
  "registration":
    "We sent a verification link to your inbox. Click it to unlock your past bookings and member perks."
};

export function EmailVerifyBanner({ reason = "past-stays" }: EmailVerifyBannerProps) {
  const { user, resendVerification, refreshAuthUser } = useGuestAuth();
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Defensive: caller should only mount this when
  // `user.emailVerified === false`, but bail if not.
  if (!user || user.emailVerified !== false) return null;

  // Only email/password users can have an unverified email —
  // Google sign-in is verified by Firebase at the provider level.
  const isEmailProvider = user.providerData.some((p) => p.providerId === "password");
  if (!isEmailProvider) return null;

  const handleResend = async () => {
    setResendState("sending");
    setErrorMessage("");
    try {
      await resendVerification();
      setResendState("sent");
    } catch (err: any) {
      setResendState("error");
      // Firebase throws `auth/too-many-requests` when the rate
      // limit is hit. Surface a friendly next step instead of the
      // raw error code (per `plan/docs/GOTCHAS.md`).
      if (err?.code === "auth/too-many-requests") {
        setErrorMessage("Please wait a minute before resending.");
      } else {
        setErrorMessage(err?.message || "Could not resend the verification email.");
      }
    }
  };

  // The user may have clicked the verification link in another
  // tab and not refreshed. The "I verified it" button re-reads
  // the Firebase user from the server and dismisses the banner
  // (the next render will short-circuit on the emailVerified
  // check above).
  const handleRefresh = async () => {
    await refreshAuthUser();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-card border border-amber-200 bg-amber-50 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <Mail size={20} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">Verify your email to continue</p>
          <p className="mt-1 text-xs text-amber-800 leading-relaxed">
            {REASON_COPY[reason]}
          </p>
          <p className="mt-2 break-words text-xs text-amber-700">
            Sent to <span className="break-all font-semibold">{user.email}</span>.
          </p>

          {resendState === "sent" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={14} aria-hidden="true" />
              Verification email resent — check your inbox.
            </p>
          )}
          {resendState === "error" && errorMessage && (
            <p className="mt-2 text-xs text-red-700">{errorMessage}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === "sending" || resendState === "sent"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resendState === "sending" && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
              {resendState === "sent" ? "Sent" : "Resend verification email"}
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-50"
            >
              I already verified
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
