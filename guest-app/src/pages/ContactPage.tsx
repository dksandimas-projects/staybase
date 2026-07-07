import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Mail, Phone, MapPin, Send, MessageSquare, CheckCircle2, AlertCircle, Share2, Facebook, Instagram } from "lucide-react";
import config from "@config";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { PrimaryButton } from "../components/PrimaryButton";
import { fadeUp } from "@spark-inn/shared";
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import { useTurnstileToken } from "../hooks/useTurnstileToken";

export function ContactPage() {
  const shouldReduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  // Per Phase 11.8 PR 3: address / phone / email / socials are
  // admin-editable from Settings → Hotel Info. The hook value
  // wins when set; the deploy-time `hotel.config.ts` value is
  // the safe fallback. Mirrors the Footer change.
  const { contact } = usePublicSiteContent();
  const addressString = contact?.address || `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`;
  const phone = contact?.frontDeskPhone || config.frontDeskPhone;
  const supportEmail = contact?.supportEmail || config.supportEmail;
  const facebook = contact?.facebookUrl || config.facebookUrl;
  const instagram = contact?.instagramUrl || config.instagramUrl;
  const mapQuery = encodeURIComponent(addressString);
  const showDisabledMemberMessage = searchParams.get("member") === "disabled";

  // Contact Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const turnstile = useTurnstileToken();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstile.token) {
      setSubmitError("Please complete the verification check, then send your message again.");
      return;
    }
    setIsSubmitting(true);
    setShowSuccess(false);
    setSubmitError("");

    try {
      const res = await fetch("/api/contact/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
          turnstileToken: turnstile.token,
          _hp: honeypot
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "We could not send your message. Please try again in a moment.");
      }
      setShowSuccess(true);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      setHoneypot("");
      setTimeout(() => setShowSuccess(false), 5000);
    } catch (error: any) {
      setSubmitError(error?.message || "We could not send your message. Please try again in a moment.");
    } finally {
      turnstile.reset();
      setIsSubmitting(false);
    }
  };

  const transitionProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-40px" }
      };

  return (
    <main className="min-h-screen bg-white font-body text-gray-900 flex flex-col justify-between">
      <div>
        <Navbar />

        {/* Page Header */}
        <section className="bg-section-bg py-12 border-b border-gray-150">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Get in Touch</span>
            <h1 className="font-heading text-4xl sm:text-5xl text-gray-950 lowercase">
              contact us
            </h1>
            <p className="mx-auto max-w-lg text-sm text-gray-650">
              Have a question about reservations, amenities, or negotiated corporate rates? Our team is here to assist.
            </p>
            {showDisabledMemberMessage && (
              <div className="mx-auto mt-4 flex max-w-lg items-start gap-2 rounded-lg border border-primary/20 bg-white p-3 text-left text-xs text-gray-700">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>Your account has been disabled. Please contact us so our team can help.</span>
              </div>
            )}
          </div>
        </section>

        {/* Contact Info & Form Grid */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[400px_1fr]">
              
              {/* Left Column: Direct Info Cards */}
              <div className="space-y-6">
                <h2 className="text-lg font-heading text-gray-950 lowercase tracking-tight">
                  direct channels
                </h2>

                <div className="divide-y divide-gray-150 rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
                  {/* Address */}
                  <div className="flex gap-4 items-start pt-2">
                    <div className="h-9 w-9 rounded-lg bg-primary-light flex items-center justify-center text-primary shrink-0">
                      <MapPin size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Our Address</p>
                      <p className="text-sm font-medium text-gray-900 mt-1">{addressString}</p>
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="flex gap-4 items-start pt-4">
                    <div className="h-9 w-9 rounded-lg bg-primary-light flex items-center justify-center text-primary shrink-0">
                      <Phone size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Phone Number</p>
                      <a
                        href={`tel:${phone}`}
                        className="block text-sm font-medium text-gray-900 mt-1 hover:text-primary hover:underline transition-all"
                      >
                        {phone}
                      </a>
                      <p className="text-[10px] text-gray-400 mt-0.5">Available 24/7 for guest services</p>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="flex gap-4 items-start pt-4">
                    <div className="h-9 w-9 rounded-lg bg-primary-light flex items-center justify-center text-primary shrink-0">
                      <Mail size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Email Address</p>
                      <a
                        href={`mailto:${supportEmail}`}
                        className="block text-sm font-medium text-gray-900 mt-1 hover:text-primary hover:underline transition-all"
                      >
                        {supportEmail}
                      </a>
                      <p className="text-[10px] text-gray-400 mt-0.5">Response within 24 hours</p>
                    </div>
                  </div>

                  {/* Socials */}
                  <div className="flex gap-4 items-start pt-4">
                    <div className="h-9 w-9 rounded-lg bg-primary-light flex items-center justify-center text-primary shrink-0">
                      <Share2 size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Follow Us</p>
                      <div className="flex gap-3 mt-2">
                        <a
                          aria-label={`${config.brandName} on Facebook`}
                          href={facebook}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 w-8 rounded-full border border-gray-250 hover:border-primary hover:text-primary flex items-center justify-center text-gray-600 transition"
                        >
                          <Facebook size={14} />
                        </a>
                        <a
                          aria-label={`${config.brandName} on Instagram`}
                          href={instagram}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 w-8 rounded-full border border-gray-250 hover:border-primary hover:text-primary flex items-center justify-center text-gray-600 transition"
                        >
                          <Instagram size={14} />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* FAQ Help box */}
                <div className="rounded-card bg-gray-50 p-5 border border-gray-200">
                  <p className="text-xs font-bold text-gray-800">Booking modifications?</p>
                  <p className="text-[11px] text-gray-600 leading-relaxed mt-1">
                    If you are an active member, you can self-manage, cancel, or check reward status in your dashboard. Visit the <Link to="/account/stays" className="text-primary hover:underline font-semibold">My Stays</Link> panel.
                  </p>
                </div>
              </div>

              {/* Right Column: Interactive Form */}
              <div className="space-y-6">
                <h2 className="text-lg font-heading text-gray-950 lowercase tracking-tight">
                  send a message
                </h2>

                <div className="rounded-card bg-white p-6 sm:p-8 shadow-sm ring-1 ring-gray-200">
                  {showSuccess && (
                    <div className="mb-6 rounded-lg bg-green-50 border border-green-200 p-4 text-xs font-medium text-green-700 flex gap-2.5 items-start" role="status">
                      <CheckCircle2 size={16} className="shrink-0 text-green-600 mt-0.5" />
                      <div>
                        <p className="font-bold">Message Sent Successfully</p>
                        <p className="mt-0.5">Thank you for writing. Our front desk agent will reach out via email shortly.</p>
                      </div>
                    </div>
                  )}

                  {submitError && (
                    <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 text-xs font-medium text-red-700 flex gap-2.5 items-start" role="alert">
                      <AlertCircle size={16} className="shrink-0 text-red-600 mt-0.5" />
                      <div>
                        <p className="font-bold">We could not send your message.</p>
                        <p className="mt-0.5">{submitError}</p>
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-5">
                    <label
                      className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none"
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      Website
                      <input
                        type="text"
                        name="_hp"
                        value={honeypot}
                        onChange={(e) => setHoneypot(e.target.value)}
                        tabIndex={-1}
                        autoComplete="off"
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="grid gap-2 text-xs font-semibold text-gray-700">
                        Full Name
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g. Maria Santos"
                          className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm font-medium text-gray-950 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-light"
                        />
                      </label>

                      <label className="grid gap-2 text-xs font-semibold text-gray-700">
                        Email Address
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="maria@example.com"
                          className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm font-medium text-gray-950 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-light"
                        />
                      </label>
                    </div>

                    <label className="grid gap-2 text-xs font-semibold text-gray-700">
                      Subject
                      <input
                        type="text"
                        required
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Inquiry regarding corporate events, rooms..."
                        className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm font-medium text-gray-950 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-light"
                      />
                    </label>

                    <label className="grid gap-2 text-xs font-semibold text-gray-700">
                      Message Body
                      <textarea
                        required
                        rows={4}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Write your detailed questions here..."
                        className="w-full rounded-lg border border-gray-250 bg-gray-50/50 py-3 px-3.5 text-sm font-medium text-gray-950 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-light resize-y min-h-[100px]"
                      />
                    </label>

                    <div className="pt-1">
                      <div ref={turnstile.containerRef} />
                    </div>

                    <div className="pt-2">
                      <PrimaryButton 
                        type="submit" 
                        disabled={isSubmitting || !turnstile.token}
                        className="w-full sm:w-auto min-w-[150px]"
                      >
                        {isSubmitting ? "Sending message..." : "Send Message"}
                      </PrimaryButton>
                    </div>
                  </form>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Map Embed Section */}
        <section className="bg-section-bg py-16 sm:py-20 border-t border-gray-150">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="text-center">
              <h2 className="font-heading text-3xl text-gray-950 lowercase">find our resort</h2>
              <p className="text-xs text-gray-500 mt-2">Located strategically in {config.address.city}, {config.address.region}</p>
            </div>

            <motion.div
              {...transitionProps}
              variants={fadeUp}
              className="overflow-hidden rounded-card bg-gray-100 shadow-sm ring-1 ring-gray-200"
            >
              <iframe
                title={`${config.brandName} map`}
                src={`https://www.google.com/maps?q=${mapQuery}&output=embed`}
                className="h-96 w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </motion.div>
          </div>
        </section>
      </div>

      <Footer />
    </main>
  );
}
