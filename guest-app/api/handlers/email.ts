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
  | "discount-rejected"
  | "early-checkin-request"
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
        ${row("Room", order.roomNumber ? `Room ${order.roomNumber}` : "—")}
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
      const request = req.body?.request || {
        requestedCheckInTime: req.body?.requestedCheckInTime,
        notes: req.body?.notes
      };
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
