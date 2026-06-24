import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { cn } from "../utils/cn";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { scaleIn } from "@spark-inn/shared";
import { useGuestAuth } from "../context/GuestAuthContext";

export function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const { signInWithEmail, signInWithGoogle, sendPasswordReset, loading } = useGuestAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isResetLoading, setIsResetLoading] = useState(false);

  const showRegisteredSuccess = searchParams.get("registered") === "true";

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setInfoMessage("");

    if (!email || !password) {
      setErrorMsg("Please enter your email and password.");
      return;
    }

    setIsLoading(true);
    try {
      await signInWithEmail(email, password);
      navigate("/account/profile");
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setErrorMsg("Incorrect email or password. Please try again.");
      } else if (code === "auth/too-many-requests") {
        setErrorMsg("Too many sign-in attempts. Please wait a moment and try again.");
      } else {
        setErrorMsg("We couldn't sign you in. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg("");
    setInfoMessage("");
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle();
      navigate("/account/profile");
    } catch (err: any) {
      if (err?.code !== "auth/popup-closed-by-user") {
        setErrorMsg("Google sign-in failed. Please try again.");
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) {
      setErrorMsg("Please enter your email address.");
      return;
    }
    setIsResetLoading(true);
    setErrorMsg("");
    setInfoMessage("");
    try {
      await sendPasswordReset(resetEmail);
      setInfoMessage(`Password reset email sent to ${resetEmail}. Check your inbox.`);
      setShowForgotPassword(false);
    } catch (err: any) {
      if (err?.code === "auth/user-not-found") {
        setErrorMsg("No account found with this email address.");
      } else {
        setErrorMsg("We couldn't send the reset email. Please try again.");
      }
    } finally {
      setIsResetLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col justify-center items-center px-4 py-12 font-body">
      <motion.div
        variants={scaleIn}
        initial={shouldReduceMotion ? false : "hidden"}
        animate="visible"
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="text-center mb-8">
          <img
            src={brandAsset(config.logos.navbar)}
            alt={config.brandName}
            className="mx-auto h-10 w-auto mb-4"
          />
          <h1 className="font-heading text-3xl text-gray-950">Welcome back</h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign in to your {config.brandName} account to access your rewards.
          </p>
        </div>

        {showRegisteredSuccess && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-800 flex items-start gap-2 mb-6">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <span>Account created successfully! Sign in to continue.</span>
          </div>
        )}

        {infoMessage && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-800 flex items-start gap-2 mb-6">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <span>{infoMessage}</span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2 mb-6">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Google Sign-In */}
        <GhostButton
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading || isLoading}
          className="w-full flex items-center justify-center gap-2 mb-6"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          {isGoogleLoading ? "Connecting..." : "Continue with Google"}
        </GhostButton>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Email/Password Form */}
        {!showForgotPassword ? (
          <form onSubmit={handleSignIn} className="space-y-4">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
              Email Address
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  disabled={isLoading || isGoogleLoading}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60"
                />
              </div>
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
              Password
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={isLoading || isGoogleLoading}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-10 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { setShowForgotPassword(true); setResetEmail(email); setErrorMsg(""); setInfoMessage(""); }}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Forgot password?
              </button>
            </div>

            <PrimaryButton type="submit" className="w-full" disabled={isLoading || isGoogleLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </PrimaryButton>
          </form>
        ) : (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <h2 className="text-sm font-bold text-gray-900 mb-1">Reset your password</h2>
              <p className="text-xs text-gray-500">Enter your email and we'll send you a reset link.</p>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
              Email Address
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  disabled={isResetLoading}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60"
                />
              </div>
            </label>
            <PrimaryButton type="submit" className="w-full" disabled={isResetLoading}>
              {isResetLoading ? "Sending..." : "Send Reset Link"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setShowForgotPassword(false)}
              className="w-full text-center text-xs font-semibold text-gray-500 hover:text-gray-800"
            >
              Back to sign in
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-gray-500">
          Don't have an account?{" "}
          <Link to="/signup" className="font-semibold text-primary hover:underline">
            Create one
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
