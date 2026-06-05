import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Compass, Home } from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { scaleIn } from "@spark-inn/shared";
import { PrimaryButton } from "../components/PrimaryButton";

export function NotFoundPage() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <main className="min-h-screen bg-section-bg font-body text-gray-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background blurs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary-light/50 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[45%] h-[45%] bg-primary/5 rounded-full blur-[90px] pointer-events-none -z-10" />

      {/* 404 Container Card */}
      <motion.div
        className="w-full max-w-md bg-white rounded-card-lg shadow-xl border border-gray-150 p-8 sm:p-12 text-center relative z-10 space-y-8"
        initial={shouldReduceMotion ? false : "hidden"}
        animate="visible"
        variants={scaleIn}
      >
        {/* Brand logo */}
        <div className="flex justify-center">
          <Link to="/">
            <img
              src={brandAsset(config.logos.standard)}
              alt={config.brandName}
              className="h-10 w-auto object-contain"
            />
          </Link>
        </div>

        {/* Decorative Compass Animation */}
        <div className="flex justify-center">
          <div className="h-24 w-24 rounded-full bg-primary-light flex items-center justify-center text-primary shadow-sm relative">
            <motion.div
              animate={shouldReduceMotion ? {} : { rotate: 360 }}
              transition={{ repeat: Infinity, duration: 10, ease: "linear" }}
            >
              <Compass size={48} />
            </motion.div>
          </div>
        </div>

        {/* Messaging */}
        <div className="space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Error 404</span>
          <h1 className="font-heading text-3xl lowercase tracking-tight">
            lost in bohol?
          </h1>
          <p className="text-xs text-gray-650 leading-relaxed max-w-sm mx-auto">
            We couldn't find the page you were looking for. Let's get you back on track to your comfortable stay.
          </p>
        </div>

        {/* Primary CTA */}
        <div className="pt-2">
          <Link
            to="/"
            className="min-h-[44px] w-full px-6 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary-dark active:scale-[0.98] transition-all shadow-sm"
          >
            <Home size={16} />
            Back to Homepage
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
