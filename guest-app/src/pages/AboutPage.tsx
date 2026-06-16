import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, Award, Heart, CheckCircle2 } from "lucide-react";
import config from "@config";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { fadeUp, staggerContainer, scaleIn } from "@spark-inn/shared";
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";

export function AboutPage() {
  const shouldReduceMotion = useReducedMotion();
  const transitionProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-40px" }
      };

  const { about } = usePublicSiteContent();
  const aboutHeroImage = about.heroPhotoUrl;
  const missionText = about.missionStatement;
  const visionText = about.visionStatement;
  const storyParagraphs = about.hotelStory
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return (
    <main className="min-h-screen bg-white font-body text-gray-900 flex flex-col justify-between">
      <div>
        <Navbar overHero />

        {/* Hero Section */}
        <section className="relative -mt-20 flex h-[45vh] min-h-[320px] items-center justify-center overflow-hidden px-4 pt-20 text-center">
          <img
            src={aboutHeroImage}
            alt="Boutique hotel pool and lobby facade in Bohol"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gray-950/45 backdrop-blur-[1px]" />
          
          <div className="relative z-10 space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
              <Sparkles size={12} className="text-primary" />
              Our Story
            </span>
            <h1 className="font-heading text-5xl sm:text-6xl text-white tracking-wide lowercase">
              about us
            </h1>
            <p className="mx-auto max-w-lg text-sm sm:text-base text-gray-200 font-medium">
              Discover the vision and heart behind {config.brandName}'s intentional hospitality in Bohol.
            </p>
          </div>
        </section>

        {/* Brand Promise Banner */}
        <section className="bg-section-bg py-8 border-b border-gray-150">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-xs uppercase tracking-widest font-semibold text-gray-400">Our Promise</p>
            <p className="mt-2 text-lg sm:text-xl font-medium text-gray-800 italic max-w-3xl mx-auto">
              "{config.brandPromise}"
            </p>
          </div>
        </section>

        {/* Mission & Vision Section */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 md:grid-cols-2">
              
              {/* Mission Box */}
              <motion.div
                {...transitionProps}
                variants={fadeUp}
                className="rounded-card bg-white p-8 shadow-sm ring-1 ring-gray-200 border-t-4 border-primary flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center text-primary">
                    <Heart size={20} />
                  </div>
                  <h2 className="font-heading text-2xl lowercase tracking-tight text-gray-950">
                    our mission
                  </h2>
                  <p className="text-sm leading-relaxed text-gray-650">
                    {missionText}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 text-xs font-bold text-primary">
                  <CheckCircle2 size={16} />
                  Intentional Care & Consistency
                </div>
              </motion.div>

              {/* Vision Box */}
              <motion.div
                {...transitionProps}
                variants={fadeUp}
                className="rounded-card bg-white p-8 shadow-sm ring-1 ring-gray-200 border-t-4 border-primary flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center text-primary">
                    <Award size={20} />
                  </div>
                  <h2 className="font-heading text-2xl lowercase tracking-tight text-gray-950">
                    our vision
                  </h2>
                  <p className="text-sm leading-relaxed text-gray-650">
                    {visionText}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 text-xs font-bold text-primary">
                  <CheckCircle2 size={16} />
                  A Premium Sanctuary in Bohol
                </div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* Hotel Story Section */}
        <section className="bg-section-bg py-16 sm:py-24 border-t border-gray-150">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="space-y-6 text-center mb-10">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Heritage & Growth</span>
              <h2 className="font-heading text-3xl sm:text-4xl text-gray-950 lowercase">The Spark of Hospitality</h2>
            </div>

            <motion.div
              {...transitionProps}
              variants={fadeUp}
              className="prose prose-sm text-gray-650 leading-relaxed space-y-6 text-justify"
            >
              {storyParagraphs.length > 0 ? (
                storyParagraphs.map((paragraph, idx) => <p key={idx}>{paragraph}</p>)
              ) : (
                <p>
                  {`Founded in the heart of Tagbilaran City, Bohol, ${config.brandName} was born out of a desire to redefine the boutique hotel experience.`}
                </p>
              )}
            </motion.div>
          </div>
        </section>
      </div>

      <Footer />
    </main>
  );
}
