import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, FileText, Scale, Mail } from "lucide-react";
import { VERSION } from "@spark-inn/shared";
import config from "@config";
import { Footer } from "../components/Footer";

export function TermsPage() {
  return (
    <main className="flex min-h-screen flex-col justify-between bg-white font-body text-gray-900 select-text">
      <div>
        <header className="border-b border-gray-150 py-4">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 sm:px-6">
            <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">
              <ArrowLeft size={16} />
              Return to Homepage
            </Link>
            <span className="text-xs font-semibold text-gray-400">Guest terms</span>
          </div>
        </header>

        <article className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <header className="mb-10 space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Scale size={24} />
              <span className="text-xs font-bold uppercase tracking-widest">Terms of service</span>
            </div>
            <h1 className="font-heading text-4xl lowercase text-gray-950">terms of service</h1>

            <div className="flex flex-wrap items-center gap-4 border-y border-gray-100 py-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5 font-medium">
                <Calendar size={14} />
                Last Updated: June 13, 2026
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <FileText size={14} />
                Version {VERSION}
              </span>
            </div>
          </header>

          <div className="space-y-8 text-justify text-sm leading-relaxed text-gray-650">
            <section className="space-y-3">
              <p>
                These Terms of Service explain the booking, payment, stay, and cancellation conditions for guests of{" "}
                <strong>{config.legalName}</strong>, operating as <strong>{config.brandName}</strong>. By submitting a booking request, uploading payment proof, checking in, or using our guest services, you agree to these terms.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">1. Booking Agreement</h2>
              <p>
                A booking request is not fully confirmed until hotel staff verifies payment or confirms a valid pay-at-hotel arrangement. We may cancel or release unverified bookings after 24 hours if we cannot confirm payment, reach the guest, or validate required booking details.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">2. Accuracy of Information</h2>
              <p>
                Guests are responsible for entering accurate dates, room choices, names, contact details, guest count, discount information, and special requests. Please contact us immediately if you notice an error so staff can review whether the booking can still be corrected.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">3. Payment and Verification</h2>
              <p>
                Payment proof uploads are reviewed manually by hotel staff. A submitted screenshot or reference number does not guarantee confirmation until staff verifies that the payment was received and matched to the booking.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">4. Cancellation Policy</h2>
              <p>
                Unless a different written policy applies to your rate or corporate account, guests may cancel up to 48 hours before check-in for a full refund. Cancellations within 48 hours of check-in, no-shows, and early departures may be non-refundable. The final cancellation policy shown during booking applies to your stay.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">5. Senior and PWD Discounts</h2>
              <p>
                Senior Citizen and PWD discounts require a valid OSCA card or PWD ID and must comply with RA 9994, RA 10754, and applicable Philippine rules. Staff may verify the physical ID at check-in. False, expired, mismatched, or invalid discount documents may result in discount rejection and adjustment to the full booking total.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">6. Guest Conduct and House Rules</h2>
              <p>
                Guests must follow hotel house rules, front desk instructions, safety requirements, and local law. The hotel may refuse service, end a stay, or contact authorities if guest conduct threatens staff, other guests, hotel property, or lawful operations.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">7. Personal Property and Liability</h2>
              <p>
                Guests are responsible for securing their belongings. To the extent allowed by law, the hotel is not liable for theft, loss, or damage to personal property unless directly caused by proven hotel negligence.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">8. Privacy</h2>
              <p>
                We process guest information according to our{" "}
                <Link to="/privacy" className="font-semibold text-primary underline">
                  Privacy Policy
                </Link>{" "}
                and the {config.applicableLaw}. Booking, check-in, payment, rewards, and guest service records are used only for legitimate hotel operations, legal compliance, and guest support.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">9. Data Retention and Erasure</h2>
              <p>
                Per RA 10173 (Data Privacy Act of 2012) you may request erasure of your personal data at any time through your online account or by contacting the hotel. Erasure scrubs your name, email, phone, profile photo, and points history from the booking system. Booking records are anonymized for internal accounting — the booking reference, dates, room type, and total are kept without your identifying details.
              </p>
              <p>
                Guest registry records (nationality, ID type, ID number) collected at physical check-in are required by law to be retained for a minimum of 6 months under RA 11862 (Expanded Anti-Trafficking in Persons Act) and cannot be erased within that window. After 6 months, those records are also deleted.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">10. Governing Law</h2>
              <p>
                These terms are governed by the laws of the Republic of the Philippines. Any dispute related to a booking, stay, or guest service will be handled in the proper venue in Tagbilaran City, Bohol, unless applicable law requires otherwise.
              </p>
            </section>

            <section className="space-y-3.5">
              <h2 className="border-l-2 border-primary pl-2.5 text-base font-bold text-gray-950">11. Contact</h2>
              <p>
                For booking concerns, cancellation requests, or questions about these terms, contact the hotel directly.
              </p>
              <div className="space-y-2.5 rounded-card border border-gray-200 bg-gray-50 p-5">
                <p className="text-sm font-semibold text-gray-900">{config.legalName}</p>
                <p className="flex items-center gap-2 text-xs text-gray-600">
                  <Mail size={16} className="text-primary" />
                  <a href={`mailto:${config.supportEmail}`} className="font-bold text-primary hover:underline">
                    {config.supportEmail}
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
