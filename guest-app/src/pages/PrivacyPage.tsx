import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Shield, Mail, ArrowLeft, Calendar, FileText } from "lucide-react";
import { VERSION } from "@spark-inn/shared";
import { doc, getDoc } from "firebase/firestore";
import config from "@config";
import { db } from "../firebase/config";
import { Footer } from "../components/Footer";

export function PrivacyPage() {
  const [customBody, setCustomBody] = useState<string | null>(null);
  const [customLastUpdated, setCustomLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", "websiteContent"));
        if (!cancelled && snap.exists()) {
          const data = snap.data() as Record<string, any>;
          if (typeof data.privacyPolicyBody === "string" && data.privacyPolicyBody.trim().length > 0) {
            setCustomBody(data.privacyPolicyBody);
          }
          if (typeof data.privacyPolicyLastUpdated === "string" && data.privacyPolicyLastUpdated.trim().length > 0) {
            setCustomLastUpdated(data.privacyPolicyLastUpdated);
          }
        }
      } catch {
        // Fallback to config-driven content (already rendered below)
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const lastUpdated = customLastUpdated || config.privacyPolicyLastUpdated;
  const brandTitle = config.brandName;

  if (customBody) {
    return (
      <main className="min-h-screen bg-white font-body text-gray-900 flex flex-col justify-between select-text">
        <div>
          <header className="border-b border-gray-150 py-4">
            <div className="mx-auto max-w-4xl px-4 sm:px-6 flex justify-between items-center">
              <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">
                <ArrowLeft size={16} />
                Return to Homepage
              </Link>
              <span className="text-xs font-semibold text-gray-400">{config.applicableLaw}</span>
            </div>
          </header>
          <article className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <header className="mb-10 space-y-3">
              <div className="flex items-center gap-2 text-primary">
                <Shield size={24} />
                <span className="text-xs uppercase font-bold tracking-widest">Privacy notice</span>
              </div>
              <h1 className="font-heading text-4xl text-gray-950 lowercase">privacy policy</h1>
              <div className="flex items-center gap-4 text-xs text-gray-500 pt-1.5 border-y border-gray-100 py-3">
                <span className="flex items-center gap-1.5 font-medium">
                  <Calendar size={14} />
                  Last Updated: {lastUpdated}
                </span>
                <span className="flex items-center gap-1.5 font-medium">
                  <FileText size={14} />
                  Version {VERSION}
                </span>
              </div>
            </header>
            <div className="prose prose-sm text-gray-650 leading-relaxed space-y-8 text-justify whitespace-pre-wrap">
              {customBody}
            </div>
          </article>
        </div>
        <Footer />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white font-body text-gray-900 flex flex-col justify-between select-text">
      <div>
        {/* Navigation Bar Header */}
        <header className="border-b border-gray-150 py-4">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 flex justify-between items-center">
            <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">
              <ArrowLeft size={16} />
              Return to Homepage
            </Link>
            <span className="text-xs font-semibold text-gray-400">
              {config.applicableLaw}
            </span>
          </div>
        </header>

        {/* Content Area */}
        <article className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <header className="mb-10 space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Shield size={24} />
              <span className="text-xs uppercase font-bold tracking-widest">Privacy notice</span>
            </div>
            <h1 className="font-heading text-4xl text-gray-950 lowercase">
              privacy policy
            </h1>
            
            <div className="flex items-center gap-4 text-xs text-gray-500 pt-1.5 border-y border-gray-100 py-3">
              <span className="flex items-center gap-1.5 font-medium">
                <Calendar size={14} />
                Last Updated: {config.privacyPolicyLastUpdated}
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <FileText size={14} />
                Version {VERSION}
              </span>
            </div>
          </header>

          <div className="prose prose-sm text-gray-650 leading-relaxed space-y-8 text-justify">
            {/* Intro */}
            <section className="space-y-3">
              <p>
                At <strong>{config.legalName}</strong> (operating as <strong>{config.brandName}</strong>), we respect your right to privacy and are committed to protecting the personal data you share with us. This Privacy Policy details how we collect, process, secure, and erase your personal information when you book a room, register as a member of Spark Rewards, or use our in-room guest services in accordance with the <strong>{config.applicableLaw}</strong>.
              </p>
            </section>

            {/* Who We Are */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-gray-950 border-l-2 border-primary pl-2.5">1. Who We Are</h2>
              <p>
                {config.legalName} is a registered hospitality corporation in the Philippines, operating a boutique lodging facility located at {config.address.street}, {config.address.city}, {config.address.region}. For the purpose of data processing, we act as the Personal Information Controller (PIC).
              </p>
            </section>

            {/* What We Collect & Why */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-gray-950 border-l-2 border-primary pl-2.5">2. What We Collect & Why</h2>
              <p>
                To provide you with our reservation and hotel management services, we collect and process the following categories of personal data:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong>Booking Information</strong>: Full name, home address, contact telephone, email address, nationality, government-issued identification number, and special requests (dietary, medical needs, or arrival logs).
                </li>
                <li>
                  <strong>Rewards Membership Information</strong>: Sign-up credentials (synced via Google Sign-In or manual email registration), loyalty transactions, accumulated points ledger, and check-in history.
                </li>
                <li>
                  <strong>In-Room Orders & Chat Logs</strong>: Conversation transcripts via our room intercom, requests submitted, item order histories, and GCash transaction reference snapshots.
                </li>
              </ul>
              <p>
                We process this information to fulfill our accommodation contracts, verify identity, manage points adjustments, facilitate payment transactions, and comply with tourism and municipal registration mandates in Tagbilaran.
              </p>
            </section>

            {/* How Long We Keep It */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-gray-950 border-l-2 border-primary pl-2.5">3. Data Retention Policy</h2>
              <p>
                We retain your personal data only as long as necessary to achieve reservation and audit obligations:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Guest check-in profiles are retained for a period of five (5) years following check-out to satisfy local municipal tax audits.</li>
                <li>Loyalty profiles are kept active until you request account closure or voluntary data erasure.</li>
                <li>GCash transaction snapshots and intercom chat histories are purged six (6) months after your stay checkout date.</li>
              </ul>
            </section>

            {/* Who We Share With */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-gray-950 border-l-2 border-primary pl-2.5">4. Who We Share With</h2>
              <p>
                {brandTitle} does not rent, sell, or trade your personal data to third parties. Your data is shared only with verified service processors assisting our operations under strict confidentiality bounds:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Payment gateway providers (GCash and Maya processing systems).</li>
                <li>Cloud database hosts (Google Cloud Platform and Firebase database architectures).</li>
                <li>Regulatory agencies, local government tourism bureaus, or tax auditors where mandated by law.</li>
              </ul>
            </section>

            {/* Your Rights (RA 10173) */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-gray-950 border-l-2 border-primary pl-2.5">5. Your Data Rights (RA 10173)</h2>
              <p>
                Under the Data Privacy Act of 2012, you are entitled to exercise the following statutory rights regarding your personal data:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li><strong>Right to be Informed</strong>: You have the right to know how your data is processed.</li>
                <li><strong>Right to Access & Rectify</strong>: You can request copies of your data or rectify mistakes.</li>
                <li><strong>Right to Erasure (Blocking)</strong>: You can ask to delete or withdraw your profile, which we facilitate instantly for Spark Rewards accounts via our portal.</li>
                <li><strong>Right to Portability</strong>: You can request to export your digital files.</li>
              </ul>
            </section>

            {/* Contact the DPO */}
            <section className="space-y-3.5">
              <h2 className="text-base font-bold text-gray-950 border-l-2 border-primary pl-2.5">6. How to Contact the DPO</h2>
              <p>
                If you have concerns about your data, want to request access or erasure, or wish to file a correction, please contact our designated Data Protection Officer (DPO) directly at:
              </p>
              <div className="rounded-card bg-gray-50 border border-gray-200 p-5 space-y-2.5">
                <p className="text-sm font-semibold text-gray-900">{config.legalName} DPO Office</p>
                <p className="text-xs text-gray-600 flex items-center gap-2">
                  <Mail size={16} className="text-primary" />
                  <a href={`mailto:${config.dpoEmail}`} className="font-bold text-primary hover:underline">
                    {config.dpoEmail}
                  </a>
                </p>
              </div>
            </section>
          </div>
        </article>
      </div>

      <Footer />
    </main>
  );
}
