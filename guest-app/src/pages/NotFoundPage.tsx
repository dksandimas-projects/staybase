import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Compass, Home } from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import { scaleIn, VERSION } from "@spark-inn/shared";
import { PrimaryButton } from "../components/PrimaryButton";

export function NotFoundPage() {
  const shouldReduceMotion = useReducedMotion();
  const { notFound } = usePublicSiteContent();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-section-bg p-4 font-body text-gray-900">
      <div className="absolute inset-x-0 top-0 h-2 bg-primary" />
      <motion.div
        className="relative z-10 w-full max-w-md rounded-card-lg border border-gray-200 bg-white p-8 text-center shadow-xl sm:p-12"
        initial={shouldReduceMotion ? false : "hidden"}
        animate="visible"
        variants={scaleIn}
      >
        <div className="flex justify-center">
          <Link to="/">
            <img
              src={brandAsset(config.logos.standard)}
              alt={config.brandName}
              className="h-10 w-auto object-contain"
            />
          </Link>
        </div>

        <div className="mt-8 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-card-lg bg-primary-light text-primary shadow-sm">
            <Compass size={42} />
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            {notFound?.heroEyebrow || "Page not found"}
          </p>
          <h1 className="font-heading text-3xl lowercase text-gray-950">
            {notFound?.heroHeading || "lost in bohol?"}
          </h1>
          <p className="mx-auto max-w-sm text-sm leading-6 text-gray-600">
            {notFound?.heroSubtext || "We couldn't find the page you were looking for. Let's get you back on track to your comfortable stay."}
          </p>
        </div>

        <div className="mt-8">
          <PrimaryButton to="/" className="w-full">
            <Home size={16} />
            Back to Homepage
          </PrimaryButton>
        </div>

        {/* Per W3.12: tiny version badge to resolve the spec contradiction. */}
        <p className="mt-4 text-[10px] font-mono text-gray-400">v{VERSION}</p>
      </motion.div>
    </main>
  );
}
