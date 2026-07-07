import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, User, Phone } from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { cn } from "../utils/cn";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { scaleIn } from "@spark-inn/shared";
import { useGuestAuth } from "../context/GuestAuthContext";

export function SignUpPage() {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const { signUpWithEmail, signInWithGoogle, registerCurrentMember, loading } = useGuestAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consent, setConsent] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!firstName || !lastName || !email || !phone || !password || !confirmPassword) {
      setErrorMsg("Please fill out all required fields.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }

    if (!consent) {
      setErrorMsg("You must agree to the Privacy Policy to create an account.");
      return;
    }

    setIsLoading(true);
    try {
      await signUpWithEmail(email, password, firstName, lastName, phone);
      navigate("/account/profile");
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/email-already-in-use") {
        setErrorMsg("An account with this email already exists. Try signing in instead.");
      } else if (code === "auth/invalid-email") {
        setErrorMsg("Please enter a valid email address.");
      } else if (code === "auth/weak-password") {
        setErrorMsg("Password must be at least 6 characters long.");
      } else {
        setErrorMsg("We couldn't create your account. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg("");
    if (!consent) {
      setErrorMsg("You must agree to the Privacy Policy and Terms of Service before joining Spark Rewards with Google.");
      return;
    }
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle();
      await registerCurrentMember();
      navigate("/account/profile");
    } catch (err: any) {
      if (err?.code !== "auth/popup-closed-by-user") {
        setErrorMsg(err?.message || "Google sign-in failed. Please try again.");
      }
    } finally {
      setIsGoogleLoading(false);
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
          <h1 className="font-heading text-3xl text-gray-950">Create your account</h1>
          <p className="mt-2 text-sm text-gray-600">
            Join Spark Rewards and earn points on every stay at {config.brandName}.
          </p>
        </div>

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
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
              First Name
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Maria"
                  required
                  disabled={isLoading || isGoogleLoading}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60"
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
                  placeholder="Santos"
                  required
                  disabled={isLoading || isGoogleLoading}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60"
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maria@example.com"
                required
                disabled={isLoading || isGoogleLoading}
                className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60"
              />
            </div>
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
                minLength={6}
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

          <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
            Confirm Password
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                disabled={isLoading || isGoogleLoading}
                className={cn(
                  "min-h-[44px] w-full rounded-lg border bg-white pl-10 pr-10 text-sm text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60",
                  confirmPassword && password !== confirmPassword ? "border-red-300" : "border-gray-200"
                )}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {confirmPassword && password !== confirmPassword && (
              <span className="text-[10px] text-red-500 font-medium">Passwords do not match</span>
            )}
          </label>

          {/* Privacy Consent */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={isLoading || isGoogleLoading}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
            />
            <span className="text-xs text-gray-600 leading-relaxed">
              I agree to the{" "}
              <Link to="/privacy" target="_blank" className="font-semibold text-primary hover:underline">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link to="/terms" target="_blank" className="font-semibold text-primary hover:underline">
                Terms of Service
              </Link>
              .
            </span>
          </label>

          <PrimaryButton type="submit" className="w-full" disabled={isLoading || isGoogleLoading}>
            {isLoading ? "Creating account..." : "Create Account"}
          </PrimaryButton>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Already have an account?{" "}
          <Link to="/signin" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
