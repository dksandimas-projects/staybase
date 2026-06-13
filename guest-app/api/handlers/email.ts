import type { VercelRequest, VercelResponse } from "@vercel/node";
import config from "../../../hotel.config";
import { adminDb } from "../lib/firebase-admin";
import { resend } from "../lib/resend";

type EmailAction =
  | "booking-submitted"
  | "payment-confirmed"
  | "booking-confirmed"
  | "checkin-reminder"
  | "booking-cancelled"
  | "corporate-inquiry"
  | "discount-rejected";

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

function siteUrl(path = "") {
  return `https://www.${config.domain}${path}`;
}

function adminUrl(path = "") {
  return `https://${config.adminDomain}${path}`;
}

function addressLine() {
  return `${config.address.street}, ${config.address.city}, ${config.address.region}, ${config.address.postalCode}`;
}

function brandLogoUrl() {
  return siteUrl(`/brand/${encodeURIComponent(config.logos.navbar)}`);
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

function bookingRows(booking: any) {
  const roomLabel = [
    booking.roomNumber ? `Room ${booking.roomNumber}` : "",
    booking.roomName || booking.roomType || ""
  ].filter(Boolean).join(" - ");

  return `
    ${row("Booking reference", booking.bookingRef)}
    ${row("Guest", booking.guestName)}
    ${row("Room", roomLabel || "Not set")}
    ${row("Check-in", `${formatDate(booking.checkIn)} from ${config.checkInTime || "14:00"}`)}
    ${row("Check-out", `${formatDate(booking.checkOut)} by ${config.checkOutTime || "12:00"}`)}
    ${row("Nights", `${booking.numNights || 0} night(s)`)}
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

async function sendEmail(to: string, subject: string, html: string) {
  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html
  });
}

async function findBooking(req: VercelRequest, options: { requireGuestMatch: boolean }) {
  const { bookingId, bookingRef, guestEmail } = req.body || {};
  let snapshot: any = null;

  if (bookingId) {
    const doc = await adminDb.collection("bookings").doc(String(bookingId)).get();
    if (!doc.exists) return null;
    snapshot = doc;
  } else if (bookingRef) {
    let query: any = adminDb.collection("bookings").where("bookingRef", "==", String(bookingRef).trim()).limit(1);
    if (options.requireGuestMatch) {
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
  if (options.requireGuestMatch && bookingId) {
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
    ctaUrl: siteUrl("/my-booking")
  });
}

function paymentConfirmedEmail(booking: any) {
  return emailLayout({
    preheader: `Payment received for booking ${booking.bookingRef}.`,
    eyebrow: "Payment verified",
    title: "Your payment has been confirmed",
    intro: `Dear ${escapeHtml(booking.guestName)}, we have verified the payment for your stay at <strong>${escapeHtml(config.brandName)}</strong>.`,
    body: `
      ${callout("green", "Payment recorded", "Your reservation is one step closer to final confirmation. We will send a separate booking confirmation once the front desk completes the final review.")}
      ${card("Payment and stay summary", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}${row("Payment method", booking.paymentMethod)}</table>`)}
    `,
    ctaLabel: "View booking",
    ctaUrl: siteUrl("/my-booking")
  });
}

function bookingConfirmedEmail(booking: any) {
  return emailLayout({
    preheader: `Booking ${booking.bookingRef} is confirmed.`,
    eyebrow: "Booking confirmed",
    title: "Your room is ready on our calendar",
    intro: `Dear ${escapeHtml(booking.guestName)}, your reservation at <strong>${escapeHtml(config.brandName)}</strong> is now confirmed. We are looking forward to welcoming you.`,
    body: `
      ${callout("green", "See you soon", `Check-in starts at ${escapeHtml(config.checkInTime || "14:00")}. Please bring a valid government ID and your booking reference.`)}
      ${card("Confirmed stay", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}</table>`)}
    `,
    ctaLabel: "Review booking details",
    ctaUrl: siteUrl("/my-booking")
  });
}

function checkinReminderEmail(booking: any) {
  return emailLayout({
    preheader: `Your ${config.brandName} check-in is coming up.`,
    eyebrow: "Check-in reminder",
    title: "Your stay begins tomorrow",
    intro: `Dear ${escapeHtml(booking.guestName)}, this is a warm reminder that your check-in at <strong>${escapeHtml(config.brandName)}</strong> is coming up.`,
    body: `
      ${callout("warm", "Before you arrive", `Check-in starts at ${escapeHtml(config.checkInTime || "14:00")}. If your arrival time changes, please contact the front desk so we can assist you smoothly.`)}
      ${card("Arrival details", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${bookingRows(booking)}${row("Hotel address", addressLine())}</table>`)}
    `,
    ctaLabel: "Open booking lookup",
    ctaUrl: siteUrl("/my-booking")
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
    ctaUrl: siteUrl("/my-booking")
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

async function getTomorrowConfirmedBookings() {
  const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: config.timezone }));
  const start = new Date(nowLocal);
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
  const templates: Record<string, { subject: string; html: string }> = {
    "booking-submitted": {
      subject: `[${config.brandName}] Booking request received: ${booking.bookingRef}`,
      html: bookingSubmittedEmail(booking)
    },
    "payment-confirmed": {
      subject: `[${config.brandName}] Payment confirmed: ${booking.bookingRef}`,
      html: paymentConfirmedEmail(booking)
    },
    "booking-confirmed": {
      subject: `[${config.brandName}] Booking confirmed: ${booking.bookingRef}`,
      html: bookingConfirmedEmail(booking)
    },
    "checkin-reminder": {
      subject: `[${config.brandName}] Check-in reminder: ${booking.bookingRef}`,
      html: checkinReminderEmail(booking)
    },
    "booking-cancelled": {
      subject: `[${config.brandName}] Booking cancelled: ${booking.bookingRef}`,
      html: bookingCancelledEmail(booking)
    },
    "discount-rejected": {
      subject: `[${config.brandName}] Discount verification update: ${booking.bookingRef}`,
      html: discountRejectedEmail(booking)
    }
  };

  const template = templates[action];
  if (!template) {
    throw new Error("Unsupported booking email trigger.");
  }

  await sendEmail(booking.guestEmail, template.subject, template.html);
}

export async function handleEmailTrigger(req: VercelRequest, res: VercelResponse, action: EmailAction) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  try {
    if (action === "corporate-inquiry") {
      const inquiry = req.body?.inquiry || req.body || {};
      await sendCorporateInquiryTrigger(inquiry);
      return res.status(200).json({ success: true });
    }

    if (action === "checkin-reminder" && !req.body?.bookingId && !req.body?.bookingRef) {
      const bookings = await getTomorrowConfirmedBookings();
      await Promise.all(bookings.map((booking) => sendBookingTrigger(action, booking)));
      return res.status(200).json({ success: true, data: { sent: bookings.length } });
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
