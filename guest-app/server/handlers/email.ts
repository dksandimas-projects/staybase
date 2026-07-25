import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { jsPDF } from "jspdf";
import config from "../../../hotel.config";
import { adminDb } from "../lib/firebase-admin";
import { resend } from "../lib/resend";
import { getServerBaseUrl, getServerAdminBaseUrl } from "../lib/siteUrl";
import { toDateOrNull, getManilaDateInfo, generateLookupToken } from "@spark-inn/shared";
// Per BF-42 (booking-flow audit 2026-06-26): the
// `getManilaDateInfo()` helper was duplicated in 5 server-side
// files. The shared implementation lives in
// `shared/utils/bookingDates.ts`. The cron handler in
// `getTomorrowConfirmedBookings` (below) uses the shared
// helper to anchor "today" in the property's timezone, then
// adds 1 day for the "tomorrow at 00:00 local" range.
import { getManilaDateInfo } from "@spark-inn/shared";

type EmailAction =
  | "booking-submitted"
  | "payment-confirmed"
  | "booking-confirmed"
  // Per CWB-02 / decision #122 (2026-07-23): fired when staff
  // confirm a `payment-uploaded` booking with a positive balance
  // via `/api/bookings/confirm-with-balance`. The template
  // includes the original balance + staff reason so the guest
  // knows what to settle at check-in. Room type only (never
  // room number — booking is not yet `checked-in` per the
  // room-number-visibility rule).
  | "booking-confirmed-with-balance"
  | "checkin-reminder"
  | "booking-cancelled"
  | "corporate-inquiry"
  | "discount-rejected"
  | "early-checkin-request"
  | "booking-rescheduled"
  | "payment-rejected"
  // Per W4.4 / decision #104 / audit-email-extensions: 8 new
  // server-triggered templates. Voucher-issued is admin-driven;
  // store-order-* are guest status updates; staff-* notify the
  // hotel team when they are not logged in.
  | "voucher-issued"
  | "store-order-placed"
  | "store-order-confirmed"
  | "store-order-out-for-delivery"
  | "store-order-delivered"
  | "store-order-cancelled"
  | "staff-new-booking"
  | "staff-new-payment";

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || config.supportEmail;
const ADMIN_EMAIL = process.env.RESEND_ADMIN_EMAIL || config.supportEmail;

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// G-03 (E2E audit 2026-07-17): server-side receipt PDF generator
// for the booking-confirmed email attachment. Uses jsPDF with
// built-in fonts. Does NOT expose private payment-proof or ID URLs.
// Reuses the same formatting and pricing semantics as the admin's
// printBookingReceiptPDF but is server-side authoritative from
// persisted booking data.
function generateReceiptPdf(booking: any): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 20;
  let top = 20;
  const pageWidth = 190;
  const right = left + pageWidth;

  function line(y: number) {
    doc.setDrawColor(200);
    doc.line(left, y, right, y);
  }

  function text(label: string, value: string, y: number) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, right, y, { align: "right" });
  }

  // Header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(config.legalName || config.brandName, left, top);
  top += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`${config.address.street}, ${config.address.city}, ${config.address.region}`, left, top);
  top += 5;
  doc.text(`Tel: ${config.frontDeskPhone} | Email: ${config.supportEmail}`, left, top);
  top += 8;
  line(top);
  top += 6;

  // Title
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Booking Receipt", left, top);
  top += 8;

  // Booking details
  const fmtDate = (v: any) => {
    if (!v) return "—";
    const d = toDate(v);
    return d ? new Intl.DateTimeFormat(config.locale, { month: "short", day: "numeric", year: "numeric", timeZone: config.timezone }).format(d) : "—";
  };
  const fmtMoney = (v: unknown) => {
    const amt = Number(v || 0);
    return new Intl.NumberFormat(config.locale, { style: "currency", currency: config.currency, maximumFractionDigits: 0 }).format(amt);
  };

  text("Booking Ref:", String(booking.bookingRef || "—"), top); top += 6;
  text("Guest:", String(booking.guestName || "—"), top); top += 6;
  // Per the refactor/room-number-visibility change: only the
  // room type is rendered on the PDF receipt. The room number
  // is intentionally omitted so the document doesn't create a
  // stale expectation if the room is reassigned before check-in.
  text("Room Type:", String(booking.roomName || booking.roomType || "—"), top); top += 6;
  text("Check-in:", fmtDate(booking.checkIn), top); top += 6;
  text("Check-out:", fmtDate(booking.checkOut), top); top += 6;
  text("Nights:", String(booking.numNights || 0), top); top += 6;
  text("Guests:", String(booking.numGuests || 1), top); top += 6;
  if (booking.source) { text("Source:", String(booking.source), top); top += 6; }

  top += 2;
  line(top);
  top += 6;

  // Rate breakdown
  if (booking.rateBreakdown) {
    const bd = booking.rateBreakdown;
    if (Array.isArray(bd.roomLines)) {
      bd.roomLines.forEach((line: any) => {
        text(line.label || "Room rate", `${line.nights || 0} night(s) x ${fmtMoney(line.nightlyRate)} = ${fmtMoney(line.subtotal)}`, top);
        top += 5;
      });
    }
    if (Array.isArray(bd.addOns)) {
      bd.addOns.forEach((line: any) => {
        text(line.label || "Add-on", fmtMoney(line.amount), top);
        top += 5;
      });
    }
    if (Array.isArray(bd.deductions)) {
      bd.deductions.forEach((line: any) => {
        text(line.label || "Discount", `-${fmtMoney(line.amount)}`, top);
        top += 5;
      });
    }
  }

  top += 2;
  line(top);
  top += 6;

  // Total
  doc.setFont("helvetica", "bold");
  text("Total Amount Due:", fmtMoney(booking.totalPrice), top);
  top += 8;

  // Payment info
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Payment Method: ${booking.paymentMethod || "—"}`, left, top); top += 5;
  doc.text(`Status: ${booking.status || "—"}`, left, top); top += 8;

  // Footer
  line(top);
  top += 5;
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(`Generated on ${new Date().toLocaleString(config.locale, { timeZone: config.timezone })}`, left, top);
  top += 4;
  doc.text(`Thank you for choosing ${config.brandName}.`, left, top);

  return Buffer.from(doc.output("arraybuffer"));
}

// Per `plan/docs/ENV-SETUP.md` and the env-aware URL fix (2026-07-24):
// these resolve to the right environment's apex host so test emails
// sent from the staging deployment link to staging, and emails from
// production link to production. See `lib/siteUrl.ts` for the
// resolution order (SITE_URL override → VERCEL_ENV → `stg.` default).
function siteUrl(path = "") {
  return `${getServerBaseUrl()}${path}`;
}

function adminUrl(path = "") {
  return `${getServerAdminBaseUrl()}${path}`;
}

// Per H2 (hardening batch 2026-06-26): the public
// lookup deep-link carries the per-booking `lookupToken`
// instead of the raw `guestEmail`. The token is random,
// unguessable, and unique per booking so the email
// magic link can authenticate the recipient without
// leaking PII into URLs / browser history / Vercel
// access logs.
function lookupUrl(booking: any) {
  const ref = encodeURIComponent(booking.bookingRef || "");
  const token = encodeURIComponent(booking.lookupToken || "");
  if (!ref || !token) return siteUrl("/my-booking");
  return siteUrl(`/my-booking?ref=${ref}&token=${token}`);
}

function addressLine() {
  return `${config.address.street}, ${config.address.city}, ${config.address.region}, ${config.address.postalCode}`;
}

function brandLogoUrl() {
  return siteUrl(`/brand/${encodeURIComponent(config.logos.white)}`);
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: any) {
  const date = toDate(value);
  if (!date) return "Not set";
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: config.timezone
  }).format(date);
}

function formatMoney(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: config.currency,
    maximumFractionDigits: 0
  }).format(amount);
}

function row(label: string, value: unknown) {
  return `
    <tr>
      <td class="row-label" style="padding: 10px 0; color: #6b7280; font-size: 14px;">${escapeHtml(label)}</td>
      <td class="row-value" style="padding: 10px 0; color: #111827; font-size: 14px; font-weight: 700; text-align: right;">${escapeHtml(value)}</td>
    </tr>
  `;
}

function rateBreakdownRows(booking: any) {
  const breakdown = booking.rateBreakdown;
  if (!breakdown || !Array.isArray(breakdown.roomLines) || breakdown.roomLines.length === 0) return "";
  const roomRows = breakdown.roomLines.map((line: any) =>
    row(
      line.label || "Room rate",
      `${Number(line.nights || 0)} night(s) x ${formatMoney(line.nightlyRate)} = ${formatMoney(line.subtotal)}`
    )
  ).join("");
  const addOnRows = Array.isArray(breakdown.addOns)
    ? breakdown.addOns.map((line: any) => row(line.label || "Add-on", formatMoney(line.amount))).join("")
    : "";
  const deductionRows = Array.isArray(breakdown.deductions)
    ? breakdown.deductions.map((line: any) => row(line.label || "Discount", `-${formatMoney(line.amount)}`)).join("")
    : "";
  return `
    ${roomRows}
    ${addOnRows}
    ${deductionRows}
  `;
}

function bookingRows(booking: any) {
  // Per the refactor/room-number-visibility change: room
  // number is intentionally omitted from guest emails so
  // the assignment shown at booking time doesn't create a
  // stale expectation if the front desk reshuffles rooms
  // before check-in. The friendly room name (or type code
  // as a fallback) is still surfaced so the email reads
  // "Room: Deluxe Sea View" rather than "Room: —".
  const roomLabel = booking.roomName || booking.roomType || "Not set";

  return `
    ${row("Booking reference", booking.bookingRef)}
    ${row("Guest", booking.guestName)}
    ${row("Room type", roomLabel)}
    ${row("Check-in", `${formatDate(booking.checkIn)} from ${config.checkInTime || "14:00"}`)}
    ${row("Check-out", `${formatDate(booking.checkOut)} by ${config.checkOutTime || "12:00"}`)}
    ${row("Nights", `${booking.numNights || 0} night(s)`)}
    ${rateBreakdownRows(booking)}
    ${row("Total", formatMoney(booking.totalPrice))}
  `;
}

function card(title: string, body: string) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 22px 0; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 14px;">
      <tr>
        <td style="padding: 18px 18px 6px;">
          <h3 style="margin: 0; color: #111827; font-size: 16px; line-height: 1.3;">${escapeHtml(title)}</h3>
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 18px 18px;">
          ${body}
        </td>
      </tr>
    </table>
  `;
}

function callout(tone: "warm" | "green" | "red", title: string, body: string) {
  const tones = {
    warm: { bg: config.colors.primaryLight, border: config.colors.primary, title: config.colors.primaryDark },
    green: { bg: "#ecfdf5", border: "#16a34a", title: "#166534" },
    red: { bg: "#fef2f2", border: "#dc2626", title: "#991b1b" }
  };
  const toneValues = tones[tone];
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 22px 0; background: ${toneValues.bg}; border-left: 4px solid ${toneValues.border}; border-radius: 12px;">
      <tr>
        <td style="padding: 16px 18px;">
          <p style="margin: 0 0 6px; color: ${toneValues.title}; font-weight: 800; font-size: 14px;">${escapeHtml(title)}</p>
          <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${body}</p>
        </td>
      </tr>
    </table>
  `;
}

function emailLayout(options: {
  preheader: string;
  eyebrow: string;
  title: string;
  intro: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const primary = config.colors.primary;
  const sidebar = config.colors.sidebar;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    <style>
      @media only screen and (max-width: 640px) {
        .outer { padding: 16px 10px !important; }
        .container { width: 100% !important; border-radius: 18px !important; }
        .hero { padding: 24px 18px !important; }
        .content { padding: 24px 18px !important; }
        .title { font-size: 26px !important; }
        .row-label, .row-value { display: block !important; width: 100% !important; text-align: left !important; }
        .row-value { padding-top: 0 !important; }
        .button { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; background: #f6f2ec; font-family: Inter, Arial, sans-serif; color: #111827;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(options.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="outer" style="border-collapse: collapse; background: #f6f2ec; padding: 28px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" class="container" style="border-collapse: collapse; width: 640px; max-width: 640px; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 18px 50px rgba(17, 24, 39, 0.10);">
            <tr>
              <td class="hero" style="background: ${sidebar}; padding: 30px 34px;">
                <img src="${brandLogoUrl()}" width="168" alt="${escapeHtml(config.brandName)}" style="display: block; max-width: 168px; height: auto; margin: 0 0 28px;">
                <p style="margin: 0 0 10px; color: ${primary}; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;">${escapeHtml(options.eyebrow)}</p>
                <h1 class="title" style="margin: 0; color: #ffffff; font-size: 34px; line-height: 1.12; letter-spacing: 0; font-weight: 800;">${escapeHtml(options.title)}</h1>
              </td>
            </tr>
            <tr>
              <td class="content" style="padding: 32px 34px 28px;">
                <p style="margin: 0 0 18px; color: #374151; font-size: 16px; line-height: 1.7;">${options.intro}</p>
                ${options.body}
                ${
                  options.ctaLabel && options.ctaUrl
                    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0 10px;">
                        <tr>
                          <td>
                            <a class="button" href="${options.ctaUrl}" style="background: ${primary}; color: #ffffff; text-decoration: none; font-size: 15px; line-height: 1; font-weight: 800; padding: 15px 20px; border-radius: 8px; display: inline-block;">${escapeHtml(options.ctaLabel)}</a>
                          </td>
                        </tr>
                      </table>`
                    : ""
                }
                <p style="margin: 28px 0 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
                  ${escapeHtml(addressLine())}<br>
                  Front desk: <a href="tel:${escapeHtml(config.frontDeskPhone)}" style="color: ${primary}; text-decoration: none;">${escapeHtml(config.frontDeskPhone)}</a><br>
                  Support: <a href="mailto:${escapeHtml(config.supportEmail)}" style="color: ${primary}; text-decoration: none;">${escapeHtml(config.supportEmail)}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendEmail(to: string, subject: string, html: string, attachments?: Array<{ filename: string; content: Buffer }>) {
  // Per Spark Rewards audit 2026-07-18 LOW-7: the send-skip guard
  // covers BOTH the @example.invalid placeholder (used by the
  // early "unverified email" test path) and the @invalid
  // placeholder (used by the RA 10173 erasure path — anonymized
  // bookings get `guestEmail: "erased@invalid"` from
  // `handleEraseMemberAccount` in members.ts). Without this
  // match, a stray email trigger against an erased booking would
  // attempt delivery to `erased@invalid` and bounce at Resend
  // instead of being cleanly skipped. The `@example.invalid`
  // match is preserved for backward compat with any test fixtures
  // that pre-date the audit.
  const trimmed = typeof to === "string" ? to.trim().toLowerCase() : "";
  if (trimmed.endsWith("@example.invalid") || trimmed.endsWith("@invalid")) {
    console.log(`Skipping email send to placeholder address: ${to}`);
    return;
  }
  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
    replyTo: config.supportEmail,
    attachments
  });
}

async function findBooking(req: VercelRequest, options: { requireGuestMatch: boolean }) {
  const { bookingId, bookingRef, guestEmail } = req.body || {};
  let snapshot: any = null;
  const user = (req as any).user || {};

  if (bookingId) {
    const doc = await adminDb.collection("bookings").doc(String(bookingId)).get();
    if (!doc.exists) return null;
    snapshot = doc;
  } else if (bookingRef) {
    let query: any = adminDb.collection("bookings").where("bookingRef", "==", String(bookingRef).trim()).limit(1);
    if (options.requireGuestMatch && !user.uid) {
      if (!guestEmail) {
        throw new Error("Booking reference and guest email are required.");
      }
      query = adminDb
        .collection("bookings")
        .where("bookingRef", "==", String(bookingRef).trim())
        .where("guestEmail", "==", String(guestEmail).trim())
        .limit(1);
    }
    const results = await query.get();
    if (results.empty) return null;
    snapshot = results.docs[0];
  } else {
    throw new Error("Booking ID or booking reference is required.");
  }

  const booking = { id: snapshot.id, ...snapshot.data() };
  if (options.requireGuestMatch && user.uid) {
    // Per Spark Rewards audit 2026-07-18 HIGH-1: the email-claim
    // match in findBooking must require `email_verified === true`.
    // The `memberId` match below is always safe (the attacker
    // would need their own uid, which they already have). This is
    // a defensive second line — the router-level gate in
    // `apiRouter.ts` already rejects unverified users for the
    // early-checkin-request path, but pinning the gate at the call
    // site defends against any future caller that bypasses the
    // router-level check.
    const emailMatches =
      user.email_verified === true &&
      user.email &&
      String((booking as any).guestEmail || "").trim().toLowerCase() === String(user.email).trim().toLowerCase();
    const memberMatches = String((booking as any).memberId || "") === String(user.uid);
    if (!emailMatches && !memberMatches) {
      return null;
    }
  } else if (options.requireGuestMatch && bookingId) {
    if (!guestEmail) {
      throw new Error("Guest email is required.");
    }
    if (String((booking as any).guestEmail || "").toLowerCase() !== String(guestEmail).trim().toLowerCase()) {
      return null;
    }
  }

  return booking;
}

function bookingSubmittedEmail(booking: any) {
  const paymentNote =
    booking.paymentMethod === "pay-at-hotel"
      ? "Your stay request is queued for review. Payment is due upon arrival once your booking is accepted."
      : "Your uploaded payment proof is queued for manual verification. We will send a final confirmation after review.";

  return emailLayout({
    preheader: `We received booking request ${booking.bookingRef}.`,
    eyebrow: "Booking received",
    title: "Your stay request is under review",
    intro: `Dear ${escapeHtml(booking.guestName)}, thank you for choosing <strong>${escapeHtml(config.brandName)}</strong>. We received your booking request and our front desk team is reviewing the details.`,
    body: `
      ${callout("warm", "Manual review in progress", escapeHtml(paymentNote))}
      ${card("Reservation details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
      <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.7;">You can check the latest status any time using your booking reference and email address.</p>
    `,
    ctaLabel: "Check booking status",
    ctaUrl: lookupUrl(booking)
  });
}

// Per ECE-01 (2026-07-24, plan/project/ROADMAP.md §ECE-01): the
// payment-confirmed email may include a "House rules" card sourced
// from `settings.websiteContent.houseRules` so the guest arrives
// knowing the property's expectations. Omitted entirely when the
// setting is blank — no empty card, no fallback copy. Loaded by
// `sendBookingTrigger` from Firestore; the preview handler accepts
// it from the request body so staff can sanity-check the email.
//
// Per ECE-02 (2026-07-26, decision #139): the same card now also
// appends to `booking-confirmed` + `checkin-reminder` so the
// guest sees the rules at every "you're arriving soon" touchpoint
// (payment → confirmed → day-before reminder), not just at
// payment. The card block + render is identical across all three
// templates so the staff-owned copy is single-sourced from
// `settings.websiteContent.houseRules`.
function houseRulesCard(houseRules?: string | null): string {
  const trimmedRules = typeof houseRules === "string" ? houseRules.trim() : "";
  if (!trimmedRules) return "";
  return card(
    "House rules",
    `<p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${escapeHtml(trimmedRules)}</p>`
  );
}

function paymentConfirmedEmail(booking: any, houseRules?: string | null) {
  return emailLayout({
    preheader: `Payment received for booking ${booking.bookingRef}.`,
    eyebrow: "Payment verified",
    title: "Your payment has been confirmed",
    intro: `Dear ${escapeHtml(booking.guestName)}, we have verified the payment for your stay at <strong>${escapeHtml(config.brandName)}</strong>.`,
    body: `
      ${callout("green", "Payment recorded", "Your reservation is one step closer to final confirmation. We will send a separate booking confirmation once the front desk completes the final review.")}
      ${card("Payment and stay summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}${row("Payment method", booking.paymentMethod)}</table>`)}
      ${houseRulesCard(houseRules)}
    `,
    ctaLabel: "View booking",
    ctaUrl: lookupUrl(booking)
  });
}

function bookingConfirmedEmail(booking: any, houseRules?: string | null) {
  return emailLayout({
    preheader: `Booking ${booking.bookingRef} is confirmed.`,
    eyebrow: "Booking confirmed",
    title: "Your room is ready on our calendar",
    intro: `Dear ${escapeHtml(booking.guestName)}, your reservation at <strong>${escapeHtml(config.brandName)}</strong> is now confirmed. We are looking forward to welcoming you.`,
    body: `
      ${callout("green", "See you soon", `Check-in starts at ${escapeHtml(config.checkInTime || "14:00")}. Please bring a valid government ID and your booking reference.`)}
      ${card("Confirmed stay", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
      ${houseRulesCard(houseRules)}
    `,
    ctaLabel: "Review booking details",
    ctaUrl: lookupUrl(booking)
  });
}

// Per CWB-02 / decision #122 (2026-07-23): confirmation email
// variant sent when staff confirm a `payment-uploaded` booking
// with a positive balance. Includes the original balance + the
// staff reason so the guest arrives knowing what to settle at
// check-in. Room number is intentionally omitted (booking is
// not yet `checked-in` per the room-number-visibility rule).
function bookingConfirmedWithBalanceEmail(booking: any, balance: number, reason: string) {
  const safeBalance = Number.isFinite(balance) ? Math.max(Number(balance), 0) : 0;
  const safeReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  const reasonBlock = safeReason
    ? `<p style="margin: 12px 0 0; color: #4b5563; font-size: 14px; line-height: 1.7;"><strong>Reason from our team:</strong> ${escapeHtml(safeReason)}</p>`
    : "";
  return emailLayout({
    preheader: `Booking ${booking.bookingRef} is confirmed. ₱${safeBalance.toLocaleString("en-PH")} to settle at check-in.`,
    eyebrow: "Booking confirmed — balance due",
    title: "Your room is ready on our calendar",
    intro: `Dear ${escapeHtml(booking.guestName)}, your reservation at <strong>${escapeHtml(config.brandName)}</strong> is now confirmed. We are looking forward to welcoming you.`,
    body: `
      ${callout("warm", "Balance to settle at check-in", `A balance of <strong>${escapeHtml(formatMoney(safeBalance))}</strong> remains and will be collected when you arrive.${reasonBlock}`)}
      ${callout("green", "See you soon", `Check-in starts at ${escapeHtml(config.checkInTime || "14:00")}. Please bring a valid government ID and your booking reference.`)}
      ${card("Confirmed stay", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
    `,
    ctaLabel: "Review booking details",
    ctaUrl: lookupUrl(booking)
  });
}

function bookingRescheduledEmail(booking: any) {
  return emailLayout({
    preheader: `Your reservation ${booking.bookingRef} has been updated.`,
    eyebrow: "Reservation updated",
    title: "Your booking dates or room have changed",
    intro: `Dear ${escapeHtml(booking.guestName)}, your reservation at <strong>${escapeHtml(config.brandName)}</strong> has been updated by the front desk.`,
    body: `
      ${callout("green", "Rescheduled details", `Your dates or room have been updated. The details below reflect your active booking.`)}
      ${card("Updated reservation", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
    `,
    ctaLabel: "Review booking details",
    ctaUrl: lookupUrl(booking)
  });
}

function checkinReminderEmail(booking: any, houseRules?: string | null) {
  return emailLayout({
    preheader: `Your ${config.brandName} check-in is coming up.`,
    eyebrow: "Check-in reminder",
    title: "Your stay begins tomorrow",
    intro: `Dear ${escapeHtml(booking.guestName)}, this is a warm reminder that your check-in at <strong>${escapeHtml(config.brandName)}</strong> is coming up.`,
    body: `
      ${callout("warm", "Before you arrive", `Check-in starts at ${escapeHtml(config.checkInTime || "14:00")}. If your arrival time changes, please contact the front desk so we can assist you smoothly.`)}
      ${card("Arrival details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}${row("Hotel address", addressLine())}</table>`)}
      ${houseRulesCard(houseRules)}
    `,
    ctaLabel: "Open booking lookup",
    ctaUrl: lookupUrl(booking)
  });
}

function bookingCancelledEmail(booking: any) {
  return emailLayout({
    preheader: `Booking ${booking.bookingRef} has been cancelled.`,
    eyebrow: "Booking cancelled",
    title: "Your reservation has been cancelled",
    intro: `Dear ${escapeHtml(booking.guestName)}, this confirms that your reservation at <strong>${escapeHtml(config.brandName)}</strong> has been cancelled.`,
    body: `
      ${callout("red", "Cancellation recorded", booking.cancellationReason ? `Reason: ${escapeHtml(booking.cancellationReason)}` : "No cancellation reason was provided.")}
      ${card("Cancelled reservation", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
      <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.7;">If this cancellation was unexpected, please contact our support team right away.</p>
    `,
    ctaLabel: "Contact support",
    ctaUrl: `mailto:${config.supportEmail}`
  });
}

function discountRejectedEmail(booking: any) {
  const discountTypeLabel = booking.discountType === "senior" ? "Senior Citizen" : "PWD";
  const idLabel = booking.discountType === "senior" ? "OSCA Card" : "PWD ID";
  return emailLayout({
    preheader: `Discount verification update for booking ${booking.bookingRef}.`,
    eyebrow: "Discount update",
    title: "We could not verify your discount ID",
    intro: `Dear ${escapeHtml(booking.guestName)}, we reviewed the submitted ID for the ${escapeHtml(discountTypeLabel)} discount on booking <strong>${escapeHtml(booking.bookingRef)}</strong>.`,
    body: `
      ${callout("red", "Discount not verified", booking.discountRejectionReason ? `Reason: ${escapeHtml(booking.discountRejectionReason)}` : `We were unable to verify the submitted ${escapeHtml(idLabel)}.`)}
      <p style="margin: 0 0 18px; color: #4b5563; font-size: 14px; line-height: 1.7;">Your booking remains active. The full rate of <strong>${escapeHtml(formatMoney(booking.totalPrice))}</strong> will be collected upon check-in. You may still present a valid ${escapeHtml(idLabel)} at check-in for manual review.</p>
      ${card("Updated booking summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
    `,
    ctaLabel: "View my booking",
    ctaUrl: lookupUrl(booking)
  });
}

// Per Phase 12 — Dashboard Payment Rejection & Reference
// Verification (2026-07-15): when staff reject a pending
// payment proof from the dashboard, the booking is
// bounced back to `pending` (room stays held) and the
// guest is emailed with the rejection reason so they
// can re-upload a corrected proof. Stale `paymentProofUrl`
// is kept for audit; the re-upload is guest-driven via
// the existing pending UI. Per 2026-07-24
// (refactor/unify-payment-reference-fields): the previous
// top-level `paymentReferenceNumber` was retired; any
// reference on file now lives on the most recent entry in
// the booking's onsitePayments[] ledger. We surface that
// here as "Reference on file" so the guest can re-upload
// with the matching ref if needed.
function paymentRejectedEmail(booking: any) {
  const reason = booking.paymentRejectionReason
    ? `Reason: ${escapeHtml(booking.paymentRejectionReason)}`
    : "We could not verify the uploaded payment proof against our records.";
  const payments = Array.isArray(booking?.onsitePayments) ? booking.onsitePayments : [];
  let refOnFile: string | null = null;
  for (let i = payments.length - 1; i >= 0; i -= 1) {
    const ref = payments[i]?.transactionReference;
    if (ref && String(ref).trim().length > 0) {
      refOnFile = String(ref);
      break;
    }
  }
  return emailLayout({
    preheader: `Action needed: your payment proof for booking ${booking.bookingRef} was rejected.`,
    eyebrow: "Payment needs your attention",
    title: "We couldn't verify your payment proof",
    intro: `Dear ${escapeHtml(booking.guestName)}, we reviewed the payment proof you uploaded for booking <strong>${escapeHtml(booking.bookingRef)}</strong> but couldn't match it to the booking.`,
    body: `
      ${callout("red", "Payment not verified", reason)}
      ${refOnFile ? callout("warm", "Reference on file", `The reference on record is <strong>${escapeHtml(refOnFile)}</strong>. Please double-check this against your bank/GCash record and re-upload a corrected proof if needed.`) : ""}
      <p style="margin: 0 0 18px; color: #4b5563; font-size: 14px; line-height: 1.7;">Your room is still held for you. To confirm your stay, please upload a corrected payment proof from the booking lookup page using the link below — your booking ref <strong>${escapeHtml(booking.bookingRef)}</strong> and email are all you need.</p>
      ${card("Booking summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
    `,
    ctaLabel: "Re-upload payment proof",
    ctaUrl: lookupUrl(booking)
  });
}

function corporateInquiryEmail(inquiry: any) {
  const safeInquiry = {
    companyName: inquiry.companyName || "Not provided",
    contactPerson: inquiry.contactPerson || "Not provided",
    email: inquiry.email || "Not provided",
    phone: inquiry.phone || "Not provided",
    numRooms: inquiry.numRooms || "Not provided",
    preferredDates: inquiry.preferredDates || "Not provided",
    specialRequirements: inquiry.specialRequirements || inquiry.requirements || "None provided"
  };

  return emailLayout({
    preheader: `New corporate inquiry from ${safeInquiry.companyName}.`,
    eyebrow: "Corporate inquiry",
    title: "A new corporate stay inquiry arrived",
    intro: `A company submitted a corporate booking inquiry through the ${escapeHtml(config.brandName)} website. Review it in the admin dashboard and follow up within the service window.`,
    body: `
      ${card("Inquiry details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Company", safeInquiry.companyName)}
        ${row("Contact person", safeInquiry.contactPerson)}
        ${row("Email", safeInquiry.email)}
        ${row("Phone", safeInquiry.phone)}
        ${row("Rooms needed", safeInquiry.numRooms)}
        ${row("Preferred dates", typeof safeInquiry.preferredDates === "string" ? safeInquiry.preferredDates : JSON.stringify(safeInquiry.preferredDates))}
      </table>`)}
      ${callout("warm", "Special requirements", escapeHtml(safeInquiry.specialRequirements))}
    `,
    ctaLabel: "Open corporate inbox",
    ctaUrl: adminUrl("/corporate")
  });
}

export async function sendCorporateInquiryTrigger(inquiry: any) {
  await sendEmail(
    ADMIN_EMAIL,
    `[${config.brandName}] New corporate inquiry: ${inquiry.companyName || "Website inquiry"}`,
    corporateInquiryEmail(inquiry)
  );
}

function corporateInquiryConfirmationEmail(inquiry: any) {
  const safeInquiry = {
    companyName: inquiry.companyName || "Not provided",
    contactPerson: inquiry.contactPerson || "Not provided",
    numRooms: inquiry.numRooms || "Not provided",
    preferredDates: inquiry.preferredDates || "Not provided"
  };

  return emailLayout({
    preheader: `We received your corporate inquiry for ${safeInquiry.companyName}.`,
    eyebrow: "Inquiry received",
    title: "We received your corporate inquiry",
    intro: `Dear ${escapeHtml(safeInquiry.contactPerson)}, thank you for your interest in <strong>${escapeHtml(config.brandName)}</strong>. We have received your corporate booking inquiry and our team will get back to you soon.`,
    body: `
      ${card("Inquiry summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Company", safeInquiry.companyName)}
        ${row("Rooms needed", safeInquiry.numRooms)}
        ${row("Preferred dates", typeof safeInquiry.preferredDates === "string" ? safeInquiry.preferredDates : JSON.stringify(safeInquiry.preferredDates))}
      </table>`)}
    `
  });
}

export async function sendCorporateInquiryConfirmationTrigger(inquiry: any) {
  if (!inquiry.email) return;
  await sendEmail(
    inquiry.email,
    `[${config.brandName}] We received your corporate inquiry`,
    corporateInquiryConfirmationEmail(inquiry)
  );
}

function contactInquiryEmail(inquiry: any) {
  return emailLayout({
    preheader: `Website contact from ${inquiry.name} — ${inquiry.subject}`,
    eyebrow: "Website contact",
    title: "A guest reached out via the contact page",
    intro: `${escapeHtml(inquiry.name)} (${escapeHtml(inquiry.email)}) used the public /contact form. Reply directly to their email to follow up.`,
    body: `
      ${card("Inquiry", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Name", inquiry.name)}
        ${row("Email", inquiry.email)}
        ${row("Subject", inquiry.subject)}
        ${row("Source", inquiry.source || "contact-page")}
      </table>`)}
      ${callout("warm", "Message", escapeHtml(inquiry.message))}
    `,
    ctaLabel: "Open contact inbox",
    ctaUrl: adminUrl("/contact")
  });
}

export async function sendContactInquiryTrigger(inquiry: any) {
  await sendEmail(
    ADMIN_EMAIL,
    `[${config.brandName}] New contact: ${inquiry.subject || "Website message"}`,
    contactInquiryEmail(inquiry)
  );
}

function contactConfirmationEmail(inquiry: any) {
  return emailLayout({
    preheader: `We received your message regarding: ${inquiry.subject || "your contact inquiry"}.`,
    eyebrow: "Message received",
    title: "We received your message",
    intro: `Dear ${escapeHtml(inquiry.name)}, thank you for reaching out to <strong>${escapeHtml(config.brandName)}</strong>. We have received your message and our team will get back to you soon.`,
    body: `
      ${card("Message details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Name", inquiry.name)}
        ${row("Subject", inquiry.subject)}
      </table>`)}
      ${callout("warm", "Your message", escapeHtml(inquiry.message))}
    `
  });
}

export async function sendContactConfirmationTrigger(inquiry: any) {
  if (!inquiry.email) return;
  await sendEmail(
    inquiry.email,
    `[${config.brandName}] We received your message`,
    contactConfirmationEmail(inquiry)
  );
}

function earlyCheckinRequestEmail(booking: any, request: any) {
  const requestedTime = request.requestedCheckInTime || "Not specified";
  const notes = request.notes || "No additional notes";
  return emailLayout({
    preheader: `Early check-in request for ${booking.bookingRef} from ${booking.guestName}.`,
    eyebrow: "Early check-in request",
    title: "A member has requested early check-in",
    intro: `${escapeHtml(booking.guestName)} (${escapeHtml(booking.guestEmail)}) has submitted an early check-in request for their upcoming stay. This is a Spark Rewards perk — subject to availability.`,
    body: `
      ${card("Booking", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Booking ref", booking.bookingRef)}
        ${row("Guest", booking.guestName)}
        ${row("Email", booking.guestEmail)}
        ${row("Phone", booking.guestPhone || "—")}
        ${row("Room", booking.roomNumber || "—")}
        ${row("Scheduled check-in", `${formatDate(booking.checkIn)} from ${config.checkInTime || "14:00"}`)}
        ${row("Requested check-in time", requestedTime)}
      </table>`)}
      ${callout("warm", "Notes from guest", escapeHtml(notes))}
    `,
    ctaLabel: "Review booking",
    ctaUrl: adminUrl(`/bookings?ref=${booking.bookingRef}`)
  });
}

export async function sendEarlyCheckinRequestTrigger(booking: any, request: any) {
  await sendEmail(
    ADMIN_EMAIL,
    `[${config.brandName}] Early check-in request: ${booking.bookingRef}`,
    earlyCheckinRequestEmail(booking, request)
  );
}

function earlyCheckinResolveEmail(booking: any, status: "approved" | "declined", staffNote?: string) {
  const isApproved = status === "approved";
  const eyebrow = isApproved ? "Early check-in approved" : "Early check-in unavailable";
  const title = isApproved ? "Your early check-in request is approved" : "Early check-in request status";
  const intro = isApproved
    ? `Great news! We have approved your early check-in request for booking ${booking.bookingRef}. Your room will be ready for your early arrival.`
    : `We received your early check-in request for booking ${booking.bookingRef}. Unfortunately, we cannot accommodate an early check-in at this time due to room availability.`;

  const timeVal = booking.earlyCheckIn?.confirmedTime || booking.earlyCheckIn?.requestedTime || "Requested time";

  return emailLayout({
    preheader: isApproved 
      ? `Your early check-in request for booking ${booking.bookingRef} is approved.` 
      : `Status update regarding your early check-in request for booking ${booking.bookingRef}.`,
    eyebrow,
    title,
    intro,
    body: `
      ${card("Request Details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Booking ref", booking.bookingRef)}
        ${row("Guest name", booking.guestName)}
        ${row("Check-in date", formatDate(booking.checkIn))}
        ${row("Early check-in time", isApproved ? timeVal : "Standard time (14:00)")}
        ${row("Status", isApproved ? "Approved" : "Declined (Unavailable)")}
      </table>`)}
      ${staffNote ? callout("warm", "Message from front desk", escapeHtml(staffNote)) : ""}
    `,
    ctaLabel: "View your stays",
    ctaUrl: siteUrl("/account/stays")
  });
}

export async function sendEarlyCheckinResolveTrigger(booking: any, status: "approved" | "declined", staffNote?: string) {
  await sendEmail(
    booking.guestEmail,
    `[${config.brandName}] Early check-in status: ${booking.bookingRef}`,
    earlyCheckinResolveEmail(booking, status, staffNote)
  );
}

// ─── W4.4 / decision #104 email extensions ──────────────────────────
// All 8 templates below are server-triggered (no public form posts
// to these endpoints). The recipients are looked up server-side
// from the booking (guest emails) or from
// settings/hotelConfig.staffEmail (staff emails) — clients cannot
// override them. Per the spec, the corresponding booking / store
// records carry `emailNotificationsSent` timestamps for idempotency.

function voucherCodeBlock(code: string) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 22px 0;">
      <tr>
        <td align="center" style="background: ${config.colors.primaryLight}; border: 2px dashed ${config.colors.primary}; border-radius: 12px; padding: 22px 14px;">
          <p style="margin: 0 0 8px; color: ${config.colors.primaryDark}; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 800;">Your promo code</p>
          <p style="margin: 0; color: #111827; font-size: 30px; letter-spacing: 0.18em; font-weight: 800; font-family: 'JetBrains Mono', 'Courier New', monospace;">${escapeHtml(code)}</p>
        </td>
      </tr>
    </table>
  `;
}

function voucherIssuedEmail(voucher: any) {
  const valueLabel = voucher.discountType === "percent"
    ? `${voucher.discountValue}% off`
    : `${formatMoney(voucher.discountValue)} off`;
  const roomTypeLabel = Array.isArray(voucher.applicableRoomTypes) && voucher.applicableRoomTypes.length > 0
    ? voucher.applicableRoomTypes.join(", ")
    : "any room";
  return emailLayout({
    preheader: `Your ${config.brandName} voucher ${voucher.code} is ready.`,
    eyebrow: "Voucher issued",
    title: "A voucher has been added to your account",
    intro: `Dear guest, ${escapeHtml(config.brandName)} has issued a promo voucher for your next stay. Enter the code at checkout to redeem.`,
    body: `
      ${callout("warm", `${valueLabel} on ${escapeHtml(roomTypeLabel)}`, `Use this code when you start a new booking — it will be applied automatically on the review step.`)}
      ${voucherCodeBlock(voucher.code)}
      ${card("Voucher details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Discount", valueLabel)}
        ${row("Expires", voucher.expiresAt ? formatDate(voucher.expiresAt) : "No expiry")}
        ${row("Room types", escapeHtml(roomTypeLabel))}
        ${voucher.usageCap ? row("Usage cap", `${voucher.usageCap} total use${voucher.usageCap === 1 ? "" : "s"}`) : ""}
      </table>`)}
    `,
    ctaLabel: "Start a booking",
    ctaUrl: siteUrl("/rooms")
  });
}

export async function sendVoucherIssuedTrigger(voucher: any) {
  if (!voucher?.guestEmail) return;
  await sendEmail(
    voucher.guestEmail,
    `[${config.brandName}] Your voucher: ${voucher.code}`,
    voucherIssuedEmail(voucher)
  );
}

// ─── Store order lifecycle emails ──────────────────────────────────

function storeOrderItemsTable(items: any[] = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return "<p style='margin: 0; color: #6b7280; font-size: 14px;'>No items.</p>";
  }
  const rows = items.map((item) => `
    <tr>
      <td style="padding: 8px 0; color: #111827; font-size: 14px;">${escapeHtml(item.name || "Item")}</td>
      <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: center;">${Number(item.quantity || 0)}</td>
      <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${formatMoney(item.price || 0)}</td>
      <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 700; text-align: right;">${formatMoney(Number(item.price || 0) * Number(item.quantity || 0))}</td>
    </tr>
  `).join("");
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
      <thead>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <th align="left" style="padding: 8px 0; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;">Item</th>
          <th align="center" style="padding: 8px 0; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;">Qty</th>
          <th align="right" style="padding: 8px 0; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;">Unit</th>
          <th align="right" style="padding: 8px 0; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;">Line</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function storeOrderTotalsRow(total: number, paymentMethod: string) {
  return row("Payment method", paymentMethod) + row("Total", formatMoney(total));
}

function storeOrderBaseLayout(action: EmailAction, order: any) {
  const paymentLabel = order.paymentMethod === "cod" ? "Cash on delivery"
    : order.paymentMethod === "add-to-bill" ? "Add to room bill"
    : order.paymentMethod === "gcash" ? "GCash"
    : "—";
  return {
    order,
    paymentLabel,
    itemsTable: storeOrderItemsTable(order.items),
    totalRow: storeOrderTotalsRow(order.totalAmount || 0, paymentLabel),
    deepLink: `${siteUrl("/intercom")}?room=${encodeURIComponent(order.roomNumber || "")}&order=${encodeURIComponent(order.orderRef || "")}`
  };
}

function storeOrderPlacedEmail(order: any) {
  const { paymentLabel, itemsTable, totalRow, deepLink } = storeOrderBaseLayout("store-order-placed", order);
  return emailLayout({
    preheader: `Order ${order.orderRef} received.`,
    eyebrow: "Order received",
    title: "We have your in-room order",
    intro: `Thank you for ordering from the ${escapeHtml(config.brandName)} in-room store. Your items are being prepared and we'll bring them to your room in about 15 minutes.`,
    body: `
      ${callout("green", "Order received", `We have your order. Watch the Intercom chat for status updates, or check the email inbox for any change.`)}
      ${card("Order details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Order ref", order.orderRef || "—")}
        ${itemsTable}
        <tr><td colspan="4" style="padding-top: 12px; border-top: 1px solid #e5e7eb;"></td></tr>
        ${totalRow}
      </table>`)}
    `,
    ctaLabel: "Open the chat",
    ctaUrl: deepLink
  });
}

function storeOrderConfirmedEmail(order: any) {
  const { itemsTable, totalRow, deepLink } = storeOrderBaseLayout("store-order-confirmed", order);
  return emailLayout({
    preheader: `Order ${order.orderRef} confirmed.`,
    eyebrow: "Order confirmed",
    title: "Your order is confirmed and being prepared",
    intro: `Your order from the ${escapeHtml(config.brandName)} in-room store has been confirmed. Our team is preparing your items now.`,
    body: `
      ${callout("warm", "In the kitchen", "Our team is preparing your items. You'll get another email when your order is on its way.")}
      ${card("Order summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Order ref", order.orderRef || "—")}
        ${itemsTable}
        <tr><td colspan="4" style="padding-top: 12px; border-top: 1px solid #e5e7eb;"></td></tr>
        ${totalRow}
      </table>`)}
    `,
    ctaLabel: "Open the chat",
    ctaUrl: deepLink
  });
}

function storeOrderOutForDeliveryEmail(order: any) {
  const { itemsTable, totalRow, deepLink } = storeOrderBaseLayout("store-order-out-for-delivery", order);
  return emailLayout({
    preheader: `Order ${order.orderRef} is on its way.`,
    eyebrow: "Order on the way",
    title: "Your order is heading to your room",
    intro: `Your order from the ${escapeHtml(config.brandName)} in-room store is on its way. Please keep your door accessible — our team will be there shortly.`,
    body: `
      ${callout("warm", "On the way", "Your order is being delivered to your room. You can track progress in the Intercom chat.")}
      ${card("Order summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Order ref", order.orderRef || "—")}
        ${itemsTable}
        <tr><td colspan="4" style="padding-top: 12px; border-top: 1px solid #e5e7eb;"></td></tr>
        ${totalRow}
      </table>`)}
    `,
    ctaLabel: "Open the chat",
    ctaUrl: deepLink
  });
}

function storeOrderDeliveredEmail(order: any) {
  const { itemsTable, totalRow, deepLink } = storeOrderBaseLayout("store-order-delivered", order);
  return emailLayout({
    preheader: `Order ${order.orderRef} delivered.`,
    eyebrow: "Order delivered",
    title: "Your order has arrived — enjoy!",
    intro: `Your order from the ${escapeHtml(config.brandName)} in-room store has been delivered. We hope you enjoy it.`,
    body: `
      ${callout("green", "Delivered", "Your items are in your room. We would love to hear how it went — please share feedback with the front desk.")}
      ${card("Order summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Order ref", order.orderRef || "—")}
        ${itemsTable}
        <tr><td colspan="4" style="padding-top: 12px; border-top: 1px solid #e5e7eb;"></td></tr>
        ${totalRow}
      </table>`)}
    `,
    ctaLabel: "Send feedback",
    ctaUrl: siteUrl("/contact")
  });
}

function storeOrderCancelledEmail(order: any) {
  const alreadyBilled = order.status === "delivered" && order.paymentMethod === "add-to-bill";
  const refundNote = alreadyBilled
    ? "This order was already added to your room bill — no refund is needed."
    : order.paymentMethod === "gcash"
      ? "If you paid via GCash, the front desk will reach out within 24 hours to coordinate a refund."
      : "No payment was captured for this order.";
  const { itemsTable, totalRow } = storeOrderBaseLayout("store-order-cancelled", order);
  return emailLayout({
    preheader: `Order ${order.orderRef} cancelled.`,
    eyebrow: "Order cancelled",
    title: "Your order has been cancelled",
    intro: `Your order from the ${escapeHtml(config.brandName)} in-room store has been cancelled. ${escapeHtml(refundNote)}`,
    body: `
      ${callout("red", "Cancellation recorded", order.cancellationReason ? `Reason: ${escapeHtml(order.cancellationReason)}` : "No reason was provided.")}
      ${card("Order summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Order ref", order.orderRef || "—")}
        ${itemsTable}
        <tr><td colspan="4" style="padding-top: 12px; border-top: 1px solid #e5e7eb;"></td></tr>
        ${totalRow}
      </table>`)}
    `,
    ctaLabel: "Contact support",
    ctaUrl: `mailto:${config.supportEmail}`
  });
}

export async function sendStoreOrderTrigger(action: EmailAction, order: any) {
  if (!order?.guestEmail) return;
  const map: Partial<Record<EmailAction, { subject: string; html: string }>> = {
    "store-order-placed": {
      subject: `[${config.brandName}] Order placed: ${order.orderRef || "in-room"}`,
      html: storeOrderPlacedEmail(order)
    },
    "store-order-confirmed": {
      subject: `[${config.brandName}] Order confirmed: ${order.orderRef || "in-room"}`,
      html: storeOrderConfirmedEmail(order)
    },
    "store-order-out-for-delivery": {
      subject: `[${config.brandName}] Order on its way: ${order.orderRef || "in-room"}`,
      html: storeOrderOutForDeliveryEmail(order)
    },
    "store-order-delivered": {
      subject: `[${config.brandName}] Order delivered: ${order.orderRef || "in-room"}`,
      html: storeOrderDeliveredEmail(order)
    },
    "store-order-cancelled": {
      subject: `[${config.brandName}] Order cancelled: ${order.orderRef || "in-room"}`,
      html: storeOrderCancelledEmail(order)
    }
  };
  const template = map[action];
  if (!template) {
    throw new Error("Unsupported store order email trigger.");
  }
  await sendEmail(order.guestEmail, template.subject, template.html);
}

// ─── Staff notifications ──────────────────────────────────────────

function staffNewBookingEmail(booking: any) {
  return emailLayout({
    preheader: `New online booking ${booking.bookingRef}.`,
    eyebrow: "New online booking",
    title: "A new online booking just came in",
    intro: `A new online booking was created. Review the details and follow up with the guest as needed.`,
    body: `
      ${callout("warm", "Action needed", "Verify the payment method and any discount / corporate code with the guest. Confirm the booking once verified.")}
      ${card("Booking details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Booking ref", booking.bookingRef)}
        ${row("Guest", booking.guestName)}
        ${row("Email", booking.guestEmail)}
        ${row("Phone", booking.guestPhone || "—")}
        ${row("Room", booking.roomNumber ? `Room ${booking.roomNumber} (${booking.roomType || ""})` : "—")}
        ${row("Check-in", `${formatDate(booking.checkIn)} from ${config.checkInTime || "14:00"}`)}
        ${row("Check-out", `${formatDate(booking.checkOut)} by ${config.checkOutTime || "12:00"}`)}
        ${row("Nights", `${booking.numNights || 0} night(s)`)}
        ${row("Payment method", booking.paymentMethod || "—")}
        ${row("Total", formatMoney(booking.totalPrice))}
        ${row("Source", booking.source || "online")}
        ${booking.specialRequests ? row("Special requests", escapeHtml(booking.specialRequests)) : ""}
      </table>`)}
    `,
    ctaLabel: "Review booking",
    ctaUrl: adminUrl(`/bookings?ref=${encodeURIComponent(booking.bookingRef || "")}`)
  });
}

function staffNewPaymentEmail(booking: any, payment: any) {
  const proofUrl = payment?.paymentProofUrl || booking.paymentProofUrl || "";
  return emailLayout({
    preheader: `New payment proof for ${booking.bookingRef}.`,
    eyebrow: "New payment proof",
    title: "A guest uploaded a payment proof",
    intro: `A guest uploaded a payment proof for an existing booking. Review the screenshot and verify the payment.`,
    body: `
      ${callout("warm", "Verify payment", "Open the payment screenshot, confirm the amount matches the booking total, and update the booking to payment-confirmed once verified.")}
      ${card("Payment and booking", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${row("Booking ref", booking.bookingRef)}
        ${row("Guest", booking.guestName)}
        ${row("Amount", formatMoney(payment?.amount || booking.totalPrice))}
        ${row("Method", payment?.method || booking.paymentMethod || "—")}
        ${row("Note", payment?.note ? escapeHtml(payment.note) : "—")}
        ${row("Total due", formatMoney(booking.totalPrice))}
        ${proofUrl ? row("Screenshot", `<a href="${escapeHtml(proofUrl)}" style="color: ${config.colors.primary}; text-decoration: none;">View screenshot</a>`) : ""}
      </table>`)}
    `,
    ctaLabel: "Review payment",
    ctaUrl: adminUrl(`/bookings?ref=${encodeURIComponent(booking.bookingRef || "")}`)
  });
}

export async function sendStaffNewBookingTrigger(booking: any) {
  await sendEmail(
    ADMIN_EMAIL,
    `[${config.brandName}] New online booking: ${booking.bookingRef}`,
    staffNewBookingEmail(booking)
  );
}

export async function sendStaffNewPaymentTrigger(booking: any, payment: any) {
  await sendEmail(
    ADMIN_EMAIL,
    `[${config.brandName}] New payment proof: ${booking.bookingRef}`,
    staffNewPaymentEmail(booking, payment)
  );
}

async function getTomorrowConfirmedBookings() {
  // Per BF-42 (booking-flow audit 2026-06-26): this is NOT
  // a duplicate of getManilaDateInfo() — it computes a
  // "tomorrow at 00:00 local" range for the cron query. Use
  // the shared helper to anchor "today" in the property's
  // timezone, then add 1 day.
  const { manilaDate } = getManilaDateInfo(config.timezone);
  const start = new Date(manilaDate);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const snapshot = await adminDb
    .collection("bookings")
    .where("status", "==", "confirmed")
    .where("checkIn", ">=", start)
    .where("checkIn", "<", end)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function sendBookingTrigger(action: EmailAction, booking: any) {
  // Per ECE-01 (2026-07-24): payment-confirmed email may include a
  // "House rules" card sourced from `settings.websiteContent.houseRules`.
  // Per ECE-02 (2026-07-26, decision #139): the same card also
  // appends to booking-confirmed + checkin-reminder so the guest
  // sees the rules at every "you're arriving soon" touchpoint.
  // We only read the doc for the three actions that need it — every
  // other template skips the round-trip. The doc is read
  // non-transactionally (settings updates are infrequent, and a stale
  // rules string on a single email is harmless — the next email picks
  // up the latest). Omit block on blank value (no fallback copy).
  const HOUSE_RULES_ACTIONS = new Set<EmailAction>([
    "payment-confirmed",
    "booking-confirmed",
    "checkin-reminder"
  ]);
  let houseRules: string | null = null;
  if (HOUSE_RULES_ACTIONS.has(action)) {
    try {
      const doc = await adminDb.collection("settings").doc("websiteContent").get();
      houseRules = typeof doc.data()?.houseRules === "string" ? doc.data()?.houseRules : null;
    } catch (error) {
      console.warn(`Failed to load websiteContent.houseRules for ${action} email; continuing without it.`, error);
      houseRules = null;
    }
  }

  const templates: Record<string, { subject: string; html: string; attachments?: Array<{ filename: string; content: Buffer }> }> = {
    "booking-submitted": {
      subject: `[${config.brandName}] Booking request received: ${booking.bookingRef}`,
      html: bookingSubmittedEmail(booking)
    },
    "payment-confirmed": {
      subject: `[${config.brandName}] Payment confirmed: ${booking.bookingRef}`,
      html: paymentConfirmedEmail(booking, houseRules)
    },
    "booking-confirmed": {
      subject: `[${config.brandName}] Booking confirmed: ${booking.bookingRef}`,
      html: bookingConfirmedEmail(booking, houseRules),
      // G-03 (E2E audit 2026-07-17): attach the receipt PDF required
      // by Decision #82. Generated server-side from persisted
      // booking/folio data. Does not expose private payment-proof
      // or ID URLs.
      attachments: [{
        filename: `receipt-${String(booking.bookingRef || "booking").replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`,
        content: generateReceiptPdf(booking)
      }]
    },
    "checkin-reminder": {
      subject: `[${config.brandName}] Check-in reminder: ${booking.bookingRef}`,
      html: checkinReminderEmail(booking, houseRules)
    },
    "booking-cancelled": {
      subject: `[${config.brandName}] Booking cancelled: ${booking.bookingRef}`,
      html: bookingCancelledEmail(booking)
    },
    "discount-rejected": {
      subject: `[${config.brandName}] Discount verification update: ${booking.bookingRef}`,
      html: discountRejectedEmail(booking)
    },
    "booking-rescheduled": {
      subject: `[${config.brandName}] Booking updated: ${booking.bookingRef}`,
      html: bookingRescheduledEmail(booking)
    },
    "payment-rejected": {
      subject: `[${config.brandName}] Action needed: payment proof rejected for ${booking.bookingRef}`,
      html: paymentRejectedEmail(booking)
    }
  };

  const template = templates[action];
  if (!template) {
    throw new Error("Unsupported booking email trigger.");
  }

  await sendEmail(booking.guestEmail, template.subject, template.html, template.attachments);
}

// Per CWB-02 / decision #122 (2026-07-23): confirm-with-balance
// is a dedicated trigger because the email body needs the
// original balance and staff reason, not just the booking
// document. Mirrors the dedicated `staffNewBookingEmail` /
// `staffNewPaymentEmail` pattern. Fired from
// `handleConfirmBookingWithBalance` after the transaction
// commits so the booking snapshot reflects the new status
// (`confirmed`) and the four `confirmedWithBalance*` fields.
//
// Room number is intentionally omitted (booking is not yet
// `checked-in` per the room-number-visibility rule). The
// template uses the room type the same way
// `bookingConfirmedEmail` does.
export async function sendBookingConfirmedWithBalanceTrigger(booking: any, balance: number, reason: string) {
  const safeBalance = Number.isFinite(balance) ? Math.max(Number(balance), 0) : 0;
  const safeReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  const subject = `[${config.brandName}] Booking confirmed: ${booking.bookingRef} (₱${safeBalance.toLocaleString("en-PH")} due at check-in)`;
  const html = bookingConfirmedWithBalanceEmail(booking, safeBalance, safeReason);
  // Reuse the same receipt PDF attached to the standard
  // booking-confirmed email — the folio snapshot at confirm
  // time is the same.
  const attachments = [{
    filename: `receipt-${String(booking.bookingRef || "booking").replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`,
    content: generateReceiptPdf(booking)
  }];
  await sendEmail(booking.guestEmail, subject, html, attachments);
}

export async function handleEmailTrigger(req: VercelRequest, res: VercelResponse, action: EmailAction) {
  const isCronReminderRequest = action === "checkin-reminder" && req.method === "GET";

  if (req.method !== "POST" && !isCronReminderRequest) {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  try {
    if (action === "corporate-inquiry") {
      const inquiry = req.body?.inquiry || req.body || {};
      await sendCorporateInquiryTrigger(inquiry);
      return res.status(200).json({ success: true });
    }

    if (action === "early-checkin-request") {
      const hasStaff = Boolean((req as any).staff?.success);
      const booking = await findBooking(req, { requireGuestMatch: !hasStaff });
      if (!booking) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }

      // Enforce status is confirmed
      if (booking.status !== "confirmed") {
        return res.status(400).json({ success: false, error: `Early check-in request is not allowed for bookings with status '${booking.status}'.` });
      }

      // Enforce check-in date has not passed
      const checkInDateObj = toDate(booking.checkIn);
      if (!checkInDateObj) {
        return res.status(400).json({ success: false, error: "Invalid check-in date." });
      }
      const year = checkInDateObj.getFullYear();
      const month = String(checkInDateObj.getMonth() + 1).padStart(2, "0");
      const day = String(checkInDateObj.getDate()).padStart(2, "0");
      const checkInStr = `${year}-${month}-${day}`;

      const { todayStr } = getManilaDateInfo(config.timezone);
      if (checkInStr < todayStr) {
        return res.status(400).json({ success: false, error: "Early check-in request is not allowed as the check-in date has already passed." });
      }

      // Block if already approved
      if (booking.earlyCheckIn?.status === "approved") {
        return res.status(400).json({ success: false, error: "Early check-in has already been approved for this booking." });
      }

      const earlyCheckinRequestSchema = z.object({
        requestedCheckInTime: z.string().trim().min(1).max(20).optional().default("12:00 PM"),
        notes: z.string().trim().max(500).optional().default("")
      });

      const bodyData = req.body?.request || req.body || {};
      const parsed = earlyCheckinRequestSchema.safeParse(bodyData);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: "Please provide a valid requested check-in time (max 20 characters) and notes (max 500 characters)." });
      }
      const request = parsed.data;

      const earlyCheckIn = {
        status: "requested",
        requestedTime: request.requestedCheckInTime,
        notes: request.notes || "",
        requestedAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
        staffNote: null
      };

      await adminDb.collection("bookings").doc(booking.id).update({
        earlyCheckIn
      });

      await sendEarlyCheckinRequestTrigger(booking, request);
      return res.status(200).json({ success: true });
    }

    // Per W4.4 / decision #104: voucher-issued is a staff-triggered
    // re-send path. The normal addVoucher flow fires the email
    // inline from the AdminContext; this endpoint exists for the
    // "Email to guest" action on an existing voucher. The
    // recipient (voucher.guestEmail) is server-controlled from
    // the voucher doc.
    if (action === "voucher-issued") {
      if (!(req as any).staff?.success) {
        return res.status(401).json({ success: false, error: "Staff authentication is required to issue voucher emails." });
      }
      const voucherInput = req.body?.voucher;
      if (!voucherInput?.code || !voucherInput?.guestEmail) {
        return res.status(400).json({ success: false, error: "Voucher code and guestEmail are required." });
      }
      await sendVoucherIssuedTrigger(voucherInput);
      return res.status(200).json({ success: true });
    }

    if (action === "checkin-reminder" && !req.body?.bookingId && !req.body?.bookingRef) {
      const bookings = await getTomorrowConfirmedBookings();
      const pending = bookings.filter((booking: any) => !booking?.reminderSentAt);
      await Promise.all(pending.map((booking: any) => sendBookingTrigger(action, booking)));
      const sentIds = pending.map((booking: any) => booking?.id).filter(Boolean);
      if (sentIds.length > 0) {
        const stamp = new Date();
        await Promise.all(sentIds.map((id: string) =>
          adminDb.collection("bookings").doc(id).update({ reminderSentAt: stamp }).catch(() => null)
        ));
      }
      return res.status(200).json({ success: true, data: { sent: pending.length, skipped: bookings.length - pending.length } });
    }

    const hasStaff = Boolean((req as any).staff?.success);
    const booking = await findBooking(req, { requireGuestMatch: !hasStaff });
    if (!booking) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }

    await sendBookingTrigger(action, booking);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Email trigger failed:", error);
    const message = error instanceof Error ? error.message : "Unable to send email. Please try again.";
    const status = message.includes("required") ? 400 : 500;
    return res.status(status).json({ success: false, error: message });
  }
}

export async function handleEmailPreview(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  // Double check staff auth
  if (!(req as any).staff?.success) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }

  const { template, houseRules } = req.body || {};
  if (!template) {
    return res.status(400).json({ success: false, error: "Template parameter is required." });
  }

  const mockBooking = {
    bookingRef: "BK-2026-MOCK",
    guestName: "Juan Dela Cruz",
    guestEmail: "juan.delacruz@example.com",
    guestPhone: "+63 917 123 4567",
    roomNumber: "201",
    roomName: "Deluxe Ocean View",
    roomType: "deluxe",
    checkIn: new Date(Date.now() + 86400000 * 2), // 2 days from now
    checkOut: new Date(Date.now() + 86400000 * 4), // 4 days from now
    numNights: 2,
    totalPrice: 8500,
    paymentMethod: "gcash",
    status: "confirmed",
    specialRequests: "High floor requested. Anniversary trip.",
    discountType: "senior",
    discountRejectionReason: "ID photo was blurred and expired.",
    cancellationReason: "Flight cancelled due to weather.",
    lookupToken: "mock-lookup-token-xyz"
  };

  const mockInquiry = {
    companyName: "Acme Tech Solutions Inc.",
    contactPerson: "Jane Smith",
    email: "corporate@acme.com",
    phone: "+63 2 8123 4567",
    numRooms: "5 rooms",
    preferredDates: "Oct 12 - Oct 15, 2026",
    specialRequirements: "Requires high-speed Wi-Fi, early breakfast setup, and project room space."
  };

  const mockContactInquiry = {
    name: "Maria Santos",
    email: "maria.santos@example.com",
    phone: "+63 917 555 0123",
    subject: "Airport transfer availability",
    message: "Do you offer airport pickup for two guests arriving in the afternoon?"
  };

  const mockEarlyCheckinRequest = {
    requestedCheckInTime: "10:30 AM",
    notes: "Arriving early from Bohol airport. Hoping to check in early to rest."
  };

  const mockVoucher = {
    code: "SPARKWELCOME10",
    guestEmail: "juan.delacruz@example.com",
    discountType: "percent",
    discountValue: 10,
    applicableRoomTypes: ["deluxe", "executive"],
    expiresAt: new Date(Date.now() + 86400000 * 30), // 30 days from now
    usageCap: 1
  };

  const mockStoreOrder = {
    orderRef: "ORD-2026-MOCK",
    roomNumber: "201",
    guestEmail: "juan.delacruz@example.com",
    paymentMethod: "add-to-bill",
    totalAmount: 450,
    status: "confirmed",
    items: [
      { name: "Pork Silog Extra", quantity: 2, price: 150 },
      { name: "Mineral Water 1L", quantity: 2, price: 75 }
    ],
    cancellationReason: "Decided to dine out instead."
  };

  const mockPaymentProof = {
    amount: 8500,
    method: "gcash",
    note: "GCash reference ID: 123456789",
    paymentProofUrl: "https://example.com/mock-receipt.png"
  };

  try {
    let html = "";
    switch (template) {
      case "booking-submitted":
        html = bookingSubmittedEmail(mockBooking);
        break;
      case "payment-confirmed":
        // ECE-01: pass houseRules from request body so the staff can
        // preview exactly what the guest will see.
        html = paymentConfirmedEmail(mockBooking, typeof houseRules === "string" ? houseRules : null);
        break;
      case "booking-confirmed":
        // ECE-02: pass houseRules from request body so the staff can
        // preview exactly what the guest will see (mirrors the
        // payment-confirmed preview above).
        html = bookingConfirmedEmail(mockBooking, typeof houseRules === "string" ? houseRules : null);
        break;
      case "booking-confirmed-with-balance":
        // Per CWB-02: preview uses mock balance + reason so
        // the design / copy is reviewable from the email
        // preview panel without a real confirm-with-balance
        // flow. The room number is intentionally omitted
        // (booking is not yet `checked-in`).
        html = bookingConfirmedWithBalanceEmail(
          { ...mockBooking, roomNumber: "" },
          2750,
          "Guest paid a 70% deposit; remaining 30% will be collected at check-in."
        );
        break;
      case "checkin-reminder":
        // ECE-02: pass houseRules from request body so the staff can
        // preview exactly what the guest will see (mirrors the
        // payment-confirmed preview above).
        html = checkinReminderEmail(mockBooking, typeof houseRules === "string" ? houseRules : null);
        break;
      case "booking-cancelled":
        html = bookingCancelledEmail(mockBooking);
        break;
      case "discount-rejected":
        html = discountRejectedEmail(mockBooking);
        break;
      case "payment-rejected":
        html = paymentRejectedEmail({
          ...mockBooking,
          // Per 2026-07-24 (refactor/unify-payment-reference-fields):
          // the canonical reference lives on the payment ledger,
          // not on the booking doc. Mock a single onsitePayments
          // entry so the "Reference on file" callout renders in
          // the preview.
          onsitePayments: [{ transactionReference: "1234567890" }],
          paymentRejectionReason: "Reference number does not match the bank record. Please re-upload a corrected proof with the correct reference number."
        });
        break;
      case "corporate-inquiry":
        html = corporateInquiryEmail(mockInquiry);
        break;
      case "corporate-inquiry-confirmation":
        html = corporateInquiryConfirmationEmail(mockInquiry);
        break;
      case "contact-inquiry":
        html = contactInquiryEmail(mockContactInquiry);
        break;
      case "contact-confirmation":
        html = contactConfirmationEmail(mockContactInquiry);
        break;
      case "early-checkin-request":
        html = earlyCheckinRequestEmail(mockBooking, mockEarlyCheckinRequest);
        break;
      case "early-checkin-resolve":
        const bookingForResolve = {
          ...mockBooking,
          earlyCheckIn: {
            status: "approved",
            requestedTime: "10:30 AM",
            confirmedTime: "11:00 AM",
            notes: "Arriving early from Bohol airport. Hoping to check in early to rest."
          }
        };
        html = earlyCheckinResolveEmail(bookingForResolve, "approved", "Room will be ready by 11:00 AM. Safe travels!");
        break;
      case "booking-rescheduled":
        html = bookingRescheduledEmail(mockBooking);
        break;
      case "voucher-issued":
        html = voucherIssuedEmail(mockVoucher);
        break;
      case "store-order-placed":
        html = storeOrderPlacedEmail(mockStoreOrder);
        break;
      case "store-order-confirmed":
        html = storeOrderConfirmedEmail(mockStoreOrder);
        break;
      case "store-order-out-for-delivery":
        html = storeOrderOutForDeliveryEmail(mockStoreOrder);
        break;
      case "store-order-delivered":
        html = storeOrderDeliveredEmail(mockStoreOrder);
        break;
      case "store-order-cancelled":
        html = storeOrderCancelledEmail(mockStoreOrder);
        break;
      case "staff-new-booking":
        html = staffNewBookingEmail(mockBooking);
        break;
      case "staff-new-payment":
        html = staffNewPaymentEmail(mockBooking, mockPaymentProof);
        break;
      default:
        return res.status(400).json({ success: false, error: `Unknown email template: ${template}` });
    }
    
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  } catch (error) {
    console.error("Email preview generation failed:", error);
    const message = error instanceof Error ? error.message : "Unable to generate preview. Please try again.";
    return res.status(500).json({ success: false, error: message });
  }
}
