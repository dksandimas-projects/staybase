# Legal & Licensing
> Requires: CLAUDE.md

This file covers IP ownership, guest terms of service, GDPR awareness, accessibility commitment, and white-label licensing. Designed for a solo developer or small team — practical and lean, not enterprise legal.

---

## IP Ownership

**Who owns the codebase:** DK (Daniel Kenneth Sandimas) retains full intellectual property rights over the Spark Inn codebase, architecture, and white-label system.

**What the client gets:** A perpetual, non-transferable license to use the deployed instance of the system for Spark Inn Hotel Corp's operations. The client does not own the source code and may not resell, sublicense, or redistribute it.

**White-label rights:** DK retains the right to deploy the same codebase for other hotel clients under a separate license. Client-specific assets (logos, brand colors, photos) remain the property of the respective client and are not reused across deployments.

**This should be documented in the signed project contract between DK and Spark Inn Hotel Corp.** If not already in the contract, add a clause before launch.

---

## Guest Terms of Service (Summary)

A Terms of Service page is required alongside the Privacy Policy. Minimum required clauses:

| Clause | Summary |
|---|---|
| Booking agreement | A booking is confirmed only after payment is verified by staff; the hotel may cancel unverified bookings after 24 hours |
| Cancellation policy | Guest may cancel up to 48 hours before check-in for a full refund; cancellations within 48 hours are non-refundable (exact terms set by hotel in Settings) |
| Discount eligibility | Senior/PWD discounts require valid OSCA or PWD ID; providing false ID is a violation of RA 9994 and RA 10754 |
| Guest conduct | The hotel reserves the right to refuse service or terminate a stay for conduct that violates house rules |
| Accuracy of information | Guest is responsible for the accuracy of all booking details; errors in dates, names, or contact info are the guest's responsibility |
| Limitation of liability | The hotel is not liable for theft, loss, or damage to personal property; guests are responsible for securing their belongings |
| Governing law | All disputes are governed by the laws of the Republic of the Philippines, venue in Tagbilaran City, Bohol |

**Implementation:** Add a `/terms` page to the guest site. Link it from the footer and the booking Step 2 consent checkbox alongside `/privacy`.

---

## GDPR Awareness

Spark Inn is a Philippine business and is primarily governed by RA 10173 (Data Privacy Act), not GDPR. However, GDPR applies to any EU citizen whose data is processed — regardless of where the business is located.

**Practical approach for a small boutique hotel:**
- Bohol receives foreign tourists, including some from the EU. The volume is low but non-zero.
- No additional GDPR-specific features are needed for Phase 1. RA 10173 compliance already covers the core requirements (consent, access, erasure, data minimization).
- Firebase and Vercel are GDPR-compliant infrastructure providers with Data Processing Agreements (DPAs) available — these cover the infrastructure layer.
- If an EU guest submits a GDPR erasure request, handle it the same way as an RA 10173 erasure request — same process, same outcome.

**Watch for Phase 2:** if the hotel markets to EU guests directly (e.g. paid Google Ads targeting EU countries), a GDPR compliance review becomes more important.

---

## Accessibility Commitment

Spark Inn targets **WCAG 2.1 AA** compliance across all public-facing pages. This is both an ethical commitment and a practical one — the app explicitly serves PWD (Persons with Disability) guests who receive a government-mandated 20% discount.

Minimum commitment:
- All new screens checked against the 10-item accessibility checklist in `plan/docs/FRONTEND.md §Accessibility` before phase sign-off
- Keyboard navigation functional on all forms and booking flow
- Color contrast meets 4.5:1 ratio for body text throughout

No formal accessibility audit is required for Phase 1 (solo dev budget). AI-assisted checks during build are the practical approach. A third-party audit can be commissioned if the business scales.

---

## White-Label Licensing Model

When deploying the Spark Inn codebase for a new hotel client:

| Item | Details |
|---|---|
| Setup fee | One-time fee for customization, deployment, and client training (quoted per client based on scope) |
| Maintenance retainer | Optional monthly retainer for bug fixes, updates, and support |
| License fee | DK charges a recurring license fee for use of the white-label system (amount TBD per client) |
| What's included | Custom hotel.config.ts, brand asset swap, Vercel + Firebase setup, domain configuration, 30-day post-launch support |
| What's not included | Content creation, photography, ongoing marketing, third-party service fees (Resend, Vercel, Firebase) |
| Client data | Each client's data is isolated in its own Firebase project — no shared database |

**Client agreement:** Each white-label client signs the same IP clause — DK retains codebase rights, client gets a use license.

---

## Post-Launch Support

DK's default support terms after launch:

| Type | Response time | Examples |
|---|---|---|
| Critical bug | Within 24 hours | Booking flow broken, payments not working, data loss |
| Minor bug | Within 5 business days | UI glitch, incorrect label, non-blocking error |
| New feature request | Quoted separately | New page, new integration, scope change |
| Hosting/infrastructure issues | Best effort — Vercel/Firebase handle uptime | Domain expiry, env var issues |

**Maintenance retainer:** DK offers a monthly retainer covering minor bug fixes, dependency updates (`npm audit`), and one minor change request per month. Recommended for clients without technical staff.

Without a retainer, support is billed at DK's hourly rate per incident.

---

## References

- Privacy Policy page: `plan/features/STATIC-PAGES.md §Privacy Policy`
- Data privacy compliance: `plan/docs/SECURITY.md §RA 10173`
- Accessibility checklist: `plan/docs/FRONTEND.md §Accessibility`
- White-label deployment: `plan/docs/WHITE-LABEL.md`
- Post-launch decisions: `plan/docs/DECISIONS-ARCH.md #57`
