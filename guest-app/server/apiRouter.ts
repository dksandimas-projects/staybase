import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminAuth, adminDb } from "./lib/firebase-admin";
import { sendBookingTrigger } from "./handlers/email";
import { writeNotification } from "./lib/notifications";
import { getConfiguredBookingRefPrefix, handleAddPayment, handleAddRefund, handleAddRoomToReservation, handleApplyBookingDiscount, handleCancelBooking, handleCancelPreview, handleCheckinBooking, handleCheckoutBooking, handleConfirmBooking, handleConfirmBookingWithBalance, handleCreateBooking, handleCreateWalkin, handleGetCancellationLiability, handleLookupBooking, handleMarkPaymentConfirmed, handleRecordCancellationException, handleRejectDiscount, handleRejectPayment, handleRescheduleBooking, handleResolveEarlyCheckin, handleSetLouReceived, handleVerifyAndRecordPayment } from "./handlers/bookings";
import { handleRoomAvailability } from "./handlers/rooms";
import { handleCancelRoomBlock, handleCreateRoomBlock, handleUpdateRoomBlock } from "./handlers/room-blocks";
import { handleValidateVoucher } from "./handlers/vouchers";
import { handleValidateCorporateCode } from "./handlers/corporate-codes";
import { handleConvertInquiryToBooking, handleCreateCorporateInquiry } from "./handlers/corporate-inquiries";
import { handleCreateContactInquiry } from "./handlers/contact";
import { handleGenerateReference } from "./handlers/reference";
import { handleEraseMemberAccount, handleLinkBookingToMember, handleListMemberStays, handleManualAdjustPoints, handleRedeemMemberPoints, handleRegisterMember, handleSetMemberActive, handleUndoMemberPointsRedemption } from "./handlers/members";
import { handleUpdateTerms } from "./handlers/legal";
import { handleCreateStaff, handleDisableStaff, handleUpdateStaff } from "./handlers/admin";
import { handleCancelStoreOrder, handleCreateStoreOrder, handleDeliverStoreOrder, handleGetStoreOrderStatus } from "./handlers/store";
import { handleVerifyIntercomGuest, handleSendGuestMessage } from "./handlers/intercom";
import { handleEmailTrigger, handleEmailPreview } from "./handlers/email";
import { handleH2BackfillStatus, handleH2LookupTokenBackfill, handleJanitorStats, handleJanitorStorageSweep } from "./handlers/janitor";
import { handlePublishSeo } from "./handlers/seo";
import { handleNotificationsPrune } from "./handlers/notifications-prune";
import { handleHoldExpiryCron } from "./handlers/hold-expiry";
import { handleGetPrivateStorageUrl } from "./handlers/storage";
import { handleCreateTestRun, handleCloseTestRun, handleDeleteTestRun, handleListTestRuns, handleStagingRefreshPreview, handleStagingResetPreview, handleStagingResetExecute } from "./handlers/test-runs";
import config from "../../hotel.config";

const staffOnlyEmailActions = new Set([
  "payment-confirmed",
  "booking-confirmed",
  // Per CWB-02 / decision #122 (2026-07-23): confirm-with-balance
  // is a server-triggered email fired from
  // `handleConfirmBookingWithBalance` after the transaction
  // commits. Listed here so the email preview endpoint can
  // render it; never reachable as a public POST.
  "booking-confirmed-with-balance",
  "discount-rejected",
  "corporate-inquiry",
  // Per W4.4 / decision #104: the 8 new templates are
  // server-triggered from authenticated mutations; the public
  // /api/email/* endpoint only re-sends for guest-driven actions.
  // voucher-issued + store-order-* + staff-* are not in
  // publicEmailActions below — they bypass the endpoint and are
  // fired directly from the handler.
  "voucher-issued",
  "store-order-placed",
  "store-order-confirmed",
  "store-order-out-for-delivery",
  "store-order-delivered",
  "store-order-cancelled",
  "staff-new-booking",
  "staff-new-payment"
]);
const publicEmailActions = new Set([
  "booking-submitted",
  "payment-confirmed",
  "booking-confirmed",
  "checkin-reminder",
  "booking-cancelled",
  "discount-rejected",
  "early-checkin-request"
]);

const configuredGuestHost = config.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
const configuredAdminHost = config.adminDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
const PRODUCTION_GUEST_HOSTS = new Set([
  configuredGuestHost,
  `www.${configuredGuestHost}`.replace(/^www\.www\./, "www.")
]);

// Non-production surfaces (Vercel Preview = staging on the `dev` branch) serve
// the admin/guest apps from staging subdomains that are NOT the production
// `config.domain`/`config.adminDomain`. Because the admin app calls the guest
// API cross-origin, those staging origins must be in the CORS allow-list or
// every staff action (confirm, checkout, payment, …) is blocked by the browser
// preflight. Derive them from the base guest domain using the documented
// `stg.` / `stg-admin.` convention (see plan/project/PROD-CUTOVER-RUNBOOK.md),
// only when this deployment is not production.
const isProductionDeploy = process.env.VERCEL_ENV === "production";
const stagingOrigins = isProductionDeploy
  ? []
  : [
      `https://stg.${configuredGuestHost}`,
      `https://stg-admin.${configuredGuestHost}`
    ];

// White-label / per-client escape hatch: comma-separated absolute origins
// (e.g. "https://staging.acme.com,https://admin-staging.acme.com") set in the
// deployment's env for any host that doesn't follow the derivation above.
const extraAllowedOrigins = (process.env.EXTRA_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set<string>([
  `https://${configuredGuestHost}`,
  `https://www.${configuredGuestHost}`.replace(/^https:\/\/www\.www\./, "https://www."),
  `https://${configuredAdminHost}`,
  ...stagingOrigins,
  ...extraAllowedOrigins,
  "http://localhost:5173", // guest-app dev (Vite)
  "http://localhost:5174", // admin-app dev (Vite)
  "http://localhost:3000", // generic CRA / Next.js dev
]);

function resolveAllowedOrigin(originHeader: string | string[] | undefined): string {
  const requestOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!requestOrigin) return "";

  try {
    const parsedOrigin = new URL(requestOrigin).origin;
    return ALLOWED_ORIGINS.has(parsedOrigin) ? parsedOrigin : "";
  } catch (parseErr) {
    console.debug("CORS origin parse failed:", parseErr);
    return "";
  }
}

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const allowOrigin = resolveAllowedOrigin(req.headers.origin);
  if (allowOrigin) res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Cron-Secret"
  );
}

function getJwtAudience(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
    const decodedPayload = JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8")) as { aud?: unknown };
    return typeof decodedPayload.aud === "string" ? decodedPayload.aud : undefined;
  } catch {
    return undefined;
  }
}

function getTokenVerificationFailureMessage(token: string) {
  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;
  const tokenAudience = getJwtAudience(token);

  if (expectedProjectId && tokenAudience && tokenAudience !== expectedProjectId) {
    console.error("Firebase token project mismatch:", {
      expectedProjectId,
      tokenAudience
    });
    return "Unauthorized: Signed in to the wrong Firebase project. Please sign out and sign in again.";
  }

  return "Unauthorized: Invalid or expired token.";
}



async function authenticateStaff(req: VercelRequest): Promise<{ success: boolean; uid?: string; email?: string; role?: string; error?: string }> {
  if (process.env.NODE_ENV === "test") {
    return {
      success: true,
      uid: "mock_staff_uid",
      email: "mock_staff@sparkinn.com",
      role: "admin"
    };
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { success: false, error: "Unauthorized: Missing or invalid authorization token." };
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (decodedToken.role !== "admin" && decodedToken.role !== "front-desk") {
      return { success: false, error: "Forbidden: Access restricted to staff members." };
    }
    return {
      success: true,
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: decodedToken.role
    };
  } catch (err: any) {
    console.error("Token verification failed:", err);
    return { success: false, error: `Unauthorized: Token verification failed: ${err.message || err}` };
  }
}

async function authenticateUser(req: VercelRequest): Promise<{ success: boolean; uid?: string; email?: string; email_verified?: boolean; name?: string; picture?: string; error?: string }> {
  if (process.env.NODE_ENV === "test") {
    return {
      success: true,
      uid: "mock_member_uid",
      email: "member@sparkinn.com",
      // Per Spark Rewards audit 2026-07-18 HIGH-1: tests assume the
      // mock user has a verified email so the email-based booking
      // matchers still work (the gate is enforced at the call site
      // with the same `email_verified` shape).
      email_verified: true,
      name: "Mock Member"
    };
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { success: false, error: "Unauthorized: Missing or invalid authorization token." };
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    return {
      success: true,
      uid: decodedToken.uid,
      email: decodedToken.email,
      // Per Spark Rewards audit 2026-07-18 HIGH-1: surface
      // `email_verified` so the email-based booking matchers
      // (registration linkage, /api/members/stays, early check-in
      // request) can gate on it. Without this, an attacker who
      // signs up with a victim's email could read and cancel the
      // victim's anonymous bookings (the `lookupToken` leak in
      // /api/members/stays is the cancel credential). Google
      // sign-in tokens always carry `email_verified: true`.
      email_verified: decodedToken.email_verified === true,
      name: decodedToken.name,
      picture: decodedToken.picture
    };
  } catch (err) {
    console.error("Token verification failed:", err);
    return { success: false, error: getTokenVerificationFailureMessage(token) };
  }
}

// Per Spark Rewards audit 2026-07-18 HIGH-1: every member-scoped
// booking match that keys off the ID token's `email` claim must
// first require `email_verified === true`. The `uid`-only match
// (`booking.memberId == token.uid`) is always safe — the attacker
// would need their own uid, which they already have. Returns a
// structured 403 response the client recognizes (`code:
// "EMAIL_NOT_VERIFIED"`) so it can render a "Verify your email"
// prompt instead of a generic auth error.
//
// `actionLabel` is the human-readable next step rendered in the
// error copy (e.g. "see your past stays").
function emailClaimGuardResponse(user: { email?: string; email_verified?: boolean }, actionLabel: string) {
  if (user.email && user.email_verified === true) return null;
  return {
    status: 403,
    body: {
      success: false,
      code: "EMAIL_NOT_VERIFIED",
      error: `Please verify your email address to ${actionLabel}. Check your inbox for the verification link, or resend it from your profile.`
    }
  };
}


// Simple in-memory IP cache for rate limiting
const rateLimitCache = new Map<string, { count: number; resetTime: number }>();

function isRateLimited(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitCache.get(ip);

  if (!record) {
    rateLimitCache.set(ip, { count: 1, resetTime: now + windowMs });
    return false;
  }

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
    return false;
  }

  record.count++;
  return record.count > limit;
}

// Per S2 (soft batch 2026-06-26): the booking-lookup
// endpoint is a ref+token oracle. Turnstile (H1) raises
// the per-attempt cost, and the 10/min rate limit caps
// throughput, but a determined attacker with a residential
// proxy pool can still iterate the 99,999-key daily
// namespace. We add a second layer: after 3 consecutive
// 404s from the same IP, the IP is parked in a 1-hour
// backoff bucket. A single successful lookup resets the
// counter. This drops the per-IP PoR from ~14%/day
// (14,400 attempts / 99,999 keys) to ~0.07%/day
// (3 attempts / IP / hour × 24 = 72 attempts/day/IP).
//
// The state lives in module memory (same as the
// per-minute rate-limit cache). Keep it local to avoid
// loading workspace packages before CORS preflight can run.
const lookupFailures = (() => {
  const failures = new Map<string, { count: number; resetTime: number }>();

  return {
    isInBackoff(key: string, threshold: number): boolean {
      const now = Date.now();
      const record = failures.get(key);
      if (!record) return false;

      if (now > record.resetTime) {
        failures.delete(key);
        return false;
      }

      return record.count >= threshold;
    },
    record(key: string, windowMs: number): void {
      const now = Date.now();
      const record = failures.get(key);
      if (!record || now > record.resetTime) {
        failures.set(key, { count: 1, resetTime: now + windowMs });
        return;
      }

      record.count++;
      record.resetTime = now + windowMs;
    },
    clear(key: string): void {
      failures.delete(key);
    }
  };
})();
const LOOKUP_FAILURE_THRESHOLD = 3;
const LOOKUP_FAILURE_WINDOW_MS = 3600000;

async function verifyTurnstile(token: string | undefined, req?: VercelRequest): Promise<{ success: boolean; error?: string }> {
  // Per BI-02 (booking-intercom audit 2026-07-06): the bypass is
  // gated on NODE_ENV === "test" ONLY. The previous version also
  // short-circuited on the literal tokens "mock_token" and the
  // Cloudflare sentinel keys — in every environment, including
  // production. Since every guest-app caller shipped a
  // `|| "mock_token"` fallback in its bundle, any bot could read
  // it and bypass Turnstile on all gated endpoints. Local dev /
  // vercel dev does not need a sentinel: non-production origins
  // fall through to the Cloudflare always-pass test secret below,
  // which verifies any token the dev-sitekey widget issues.
  if (process.env.NODE_ENV === "test") {
    return { success: true };
  }

  if (!token) {
    return { success: false, error: "Bot verification token is missing." };
  }

  // Per LR-H1: production is determined from trusted server
  // environment, never client-controlled Origin/Referer. A request
  // that omits Origin must still verify against the real secret in
  // production.
  const isProduction = process.env.VERCEL_ENV === "production";
  const requestOrigin = (req?.headers.origin || req?.headers.referer || "") as string;
  let originAllowed = !isProduction;
  try {
    if (requestOrigin) {
      const originHost = new URL(requestOrigin).hostname;
      if (PRODUCTION_GUEST_HOSTS.has(originHost)) {
        originAllowed = true;
      }
    }
  } catch (parseErr) {
    console.debug("Turnstile origin parse failed:", parseErr);
  }

  if (isProduction && requestOrigin && !originAllowed) {
    return { success: false, error: "Bot verification failed. Please try again." };
  }

  const secret = isProduction
    ? process.env.TURNSTILE_SECRET_KEY
    : "1x0000000000000000000000000000000AA";

  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is required for production bot verification.");
    return { success: false, error: "Bot verification is not configured. Please try again later." };
  }

  try {
    const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`
    });

    const verifyData = (await verifyResponse.json()) as { success: boolean; "error-codes"?: string[] };
    if (!verifyData.success) {
      return { success: false, error: "Bot verification failed. Please try again." };
    }

    return { success: true };
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return { success: false, error: "Turnstile connection failed. Please try again." };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Per S2 (soft batch 2026-06-26): wrap `res.status` once
  // so the post-handler hooks (e.g. the lookup
  // 404-backoff counter) can read the final status code.
  // The wrapper is transparent: it returns `res` so the
  // existing `res.status(200).json(...)` call sites work
  // unchanged. We only wrap when `res.status` is the real
  // Vercel response (not a vi.fn spy) so existing unit
  // tests that mock the response object keep working.
  const existingStatus = (res as any).status;
  if (typeof existingStatus === "function" && !existingStatus.mock) {
    const originalStatus = existingStatus.bind(res);
    (res as any)._lastStatusCode = 200;
    (res as any).status = (code: number) => {
      (res as any)._lastStatusCode = code;
      return originalStatus(code);
    };
  } else {
    (res as any)._lastStatusCode = 200;
  }

  // 1. Enforce CORS
  // Per W4.6 / W1.13 / decision #106 / #86: explicit allowlist from config + dev origins.
  // `Access-Control-Allow-Credentials` is removed — Firebase ID tokens ride in the
  // Authorization header, not cookies, so credentials are not needed.
  // (Closes SEV-1 #2 cross-cutting + 1.7 SEV-1 from the audit.)
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 2. Parse Path Segments
  const parsedUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const rewrittenRoute = (req.query as any)?.route ?? parsedUrl.searchParams.get("route");
  const routePath = Array.isArray(rewrittenRoute)
    ? rewrittenRoute.join("/")
    : typeof rewrittenRoute === "string"
      ? rewrittenRoute
      : parsedUrl.pathname.replace(/^\/api\//, "");
  const pathSegments = routePath
    .split("/")
    .filter(Boolean);

  const [domain, action] = pathSegments;

  // 3. Rate Limiting based on IP
  const rawIp = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
  const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(",")[0].trim();

  // Route Dispatch and Middlewares
  if (domain === "bookings" && action === "create" && req.method === "POST") {
    // 5 requests / IP / minute
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-create:${ip}`, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many booking requests. Please try again in a minute." });
    }

    // Honeypot Bot Check
    if (req.body && typeof req.body === "object" && req.body._hp) {
      console.log("Honeypot triggered, silently ignoring write.");
      // Per BF-44 (booking-flow audit 2026-06-26): the previous
      // echo included `req.body.bookingId` if the bot supplied
      // one — a real preallocated ID was leaked back to the bot
      // as part of the fake success. Always return a fresh fake
      // ID; never reflect the bot's input.
      return res.status(200).json({
        success: true,
        data: {
          bookingId: "hp_" + Math.random().toString(36).substring(2, 9),
          bookingRef: `${getConfiguredBookingRefPrefix()}-${new Date().getFullYear()}0608-00099`
        }
      });
    }

    // Turnstile Bot Check
    const verification = await verifyTurnstile(req.body?.turnstileToken, req);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    
    return await handleCreateBooking(req, res);
  }

  if (domain === "bookings" && action === "create-walkin" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleCreateWalkin(req, res);
  }

  if (domain === "storage" && action === "signed-url" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleGetPrivateStorageUrl(req, res);
  }

  if (domain === "bookings" && action === "add-payment" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleAddPayment(req, res);
  }

  if (domain === "bookings" && action === "add-refund" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleAddRefund(req, res);
  }

  // Per CRL-07 (2026-08-03, per decision #173): the
  // admin-only exception endpoint. The handler
  // re-checks the admin role (front-desk staff are
  // rejected with 403) — the apiRouter-level
  // `authenticateStaff` only verifies the staff
  // credential, not the role. Same pattern as
  // `add-refund` (the handler is the source of
  // truth for the admin role check). Rate-limited
  // at 30/min — an exception is a deliberate
  // admin mutation, not a tap-and-confirm action.
  if (domain === "bookings" && action === "cancellation-exception" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-cancellation-exception:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many exception requests. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleRecordCancellationException(req, res);
  }

  // Per CRL-07 (2026-08-03, per decision #173):
  // the read-only liability projection endpoint.
  // The admin UI + future Reports (CRL-08) call
  // this to render the live state without
  // computing the cumulative processed refund
  // client-side. Authenticated-staff (any role)
  // — the data is non-sensitive (no PII, just
  // money-state numbers) and the admin UI uses
  // it for the drawer panel.
  if (domain === "bookings" && action === "cancellation-liability" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleGetCancellationLiability(req, res);
  }

  if (domain === "bookings" && action === "verify-and-record-payment" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleVerifyAndRecordPayment(req, res);
  }

  if (domain === "bookings" && action === "mark-payment-confirmed" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleMarkPaymentConfirmed(req, res);
  }

  if (domain === "bookings" && action === "reject-discount" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleRejectDiscount(req, res);
  }

  // Per Phase 12 — Dashboard Payment Rejection & Reference
  // Verification (2026-07-15): staff can reject a pending
  // payment proof from the dashboard pending-payments
  // alerts. The booking bounces back to `pending` (room
  // stays held), the reason is stamped on the booking +
  // emailed to the guest so they can re-upload a corrected
  // proof. Rate-limited at the same 30/min as the other
  // staff confirm/checkout routes since this is a fast
  // tap-and-confirm action.
  if (domain === "bookings" && action === "reject-payment" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-reject-payment:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many reject requests. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    // Capture the booking snapshot before the handler
    // bounces the status to `pending` so the post-response
    // email + notification have the original
    // `paymentProofUrl` (and any `transactionReference` on
    // the booking's onsitePayments[] ledger) to surface to
    // the guest. Per 2026-07-24
    // (refactor/unify-payment-reference-fields): the previous
    // top-level `paymentReferenceNumber` is retired.
    const bookingId = String((req.body || {}).bookingId || "").trim();
    let preRejectSnapshot: any = null;
    if (bookingId) {
      const snap = await adminDb.collection("bookings").doc(bookingId).get();
      if (snap.exists) preRejectSnapshot = snap.data() || null;
    }

    // Only fire side effects when the handler actually
    // bounces the booking (the handler updates the doc
    // only when the status was `payment-uploaded`).
    const wasEligible = preRejectSnapshot?.status === "payment-uploaded";

    const result = await handleRejectPayment(req, res);

    if (wasEligible) {
      try {
        const emailBooking = {
          ...preRejectSnapshot,
          status: "pending",
          paymentRejectionReason: (req.body || {}).reason
        };
        await sendBookingTrigger("payment-rejected", emailBooking);
      } catch (emailErr) {
        console.error("Failed to send payment-rejected email:", emailErr);
      }
      try {
        await writeNotification({
          type: "payment",
          title: `Payment proof rejected — ${preRejectSnapshot.bookingRef || bookingId} (Room ${preRejectSnapshot.roomNumber || ""})`.trim(),
          entityType: "booking",
          entityId: bookingId,
          roomNumber: preRejectSnapshot.roomNumber || null,
          bookingRef: preRejectSnapshot.bookingRef || null
        });
      } catch (notifErr) {
        console.error("Failed to write payment-rejection notification:", notifErr);
      }
    }

    return result;
  }

  if (domain === "bookings" && action === "apply-discount" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleApplyBookingDiscount(req, res);
  }

  // Per LOW-1 (reports audit 2026-08-10) +
  // `DECISIONS-FEATURES.md #99` (LOU workflow):
  // the staff-toggled LOU (Letter of Undertaking) flag
  // for corporate chargeback bookings. Staff-only
  // (mirrors the auth posture of `apply-discount` +
  // `reject-discount` + `reject-payment`). Rate-limited
  // at 30/min/IP — same bucket as the other staff
  // tap-and-confirm booking mutations.
  if (domain === "bookings" && action === "set-lou-received" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-set-lou:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many LOU updates. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleSetLouReceived(req, res);
  }

  if (domain === "bookings" && action === "confirm" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-confirm:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many confirm requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleConfirmBooking(req, res);
  }

  // Per CWB-01 / decision #122 (2026-07-23): staff can confirm
  // a `payment-uploaded` booking with a positive balance when
  // the rest will be collected at check-in. Rate-limited at
  // the same 30/min/IP as the standard confirm + checkin +
  // checkout routes since this is a fast tap-and-confirm
  // action. Staff-auth required; admin role enforced inside
  // the handler when balance > threshold.
  if (domain === "bookings" && action === "confirm-with-balance" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-confirm-with-balance:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many confirm-with-balance requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleConfirmBookingWithBalance(req, res);
  }

  if (domain === "bookings" && action === "early-checkin-resolve" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-early-checkin-resolve:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    
    return await handleResolveEarlyCheckin(req, res);
  }

  if (domain === "bookings" && action === "reschedule" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-reschedule:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many reschedule requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleRescheduleBooking(req, res);
  }

  // Per MRB-14 (2026-08-03, per decision #180 — proposed):
  // the add-room surface. Staff adds a room to an
  // existing pre-arrival reservation using the
  // header's current dates. Same auth posture as the
  // reschedule surface (staff-only, 401/403 split).
  // The rate limit shares the bookings-reschedule
  // bucket — both are staff-driven, deliberate
  // mutations that the desk performs a handful of
  // times per session. A separate bucket would just
  // starve one path at the expense of the other.
  if (domain === "bookings" && action === "add-room" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-reschedule:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many reschedule requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleAddRoomToReservation(req, res);
  }

  if (domain === "room-blocks" && ["create", "update", "cancel"].includes(action) && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`room-blocks-${action}:${ip}`, 60, 60000)) {
      return res.status(429).json({ success: false, error: "Too many room block requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    if (action === "create") return await handleCreateRoomBlock(req, res);
    if (action === "update") return await handleUpdateRoomBlock(req, res);
    return await handleCancelRoomBlock(req, res);
  }

  if (domain === "bookings" && action === "checkout" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-checkout:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many checkout requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    
    return await handleCheckoutBooking(req, res);
  }

  if (domain === "bookings" && action === "checkin" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-checkin:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many check-in requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleCheckinBooking(req, res);
  }

  if (domain === "bookings" && action === "cancel" && req.method === "POST") {
    let authResult: { success: boolean; uid?: string; email?: string } = { success: false };
    if (req.headers.authorization) {
      const staffAuth = await authenticateStaff(req);
      if (staffAuth.success) {
        authResult = staffAuth;
      }
    }
    (req as any).staff = authResult.success ? authResult : null;

    // Per H1 (hardening batch 2026-06-26): gate the
    // guest-self-service cancel path behind Turnstile so
    // a bot can't iterate bookingRef guesses. Staff
    // requests bypass (they're already authenticated).
    if (!(req as any).staff) {
      const verification = await verifyTurnstile(req.body?.turnstileToken, req);
      if (!verification.success) {
        return res.status(400).json({ success: false, error: verification.error });
      }
    }


    return await handleCancelBooking(req, res);
  }

  // Per CRL-06 (2026-08-02): the cancellation preview.
  // The URL is `POST /api/bookings/cancel-preview` (the
  // apiRouter splits on `/` and uses `[domain, action]`
  // — a slash-separated path would drop the second
  // segment, so the action name uses the same hyphen-
  // separated shape as `add-payment` / `create-walkin` /
  // `confirm-with-balance`). The preview is rate-limited
  // independently of the cancel bucket (10/min/IP) so
  // a flood of previews cannot starve a legitimate
  // cancel attempt. The handler is read-only — no
  // Turnstile, no `runTransaction`, no writes to
  // Firestore. The same `ref + (email | token)` credential
  // as the destructive cancel is the guest gate; the
  // staff path bypasses (already authenticated).
  if (domain === "bookings" && action === "cancel-preview" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-cancel-preview:${ip}`, 10, 60000)) {
      return res.status(429).json({
        success: false,
        error: "Too many cancellation previews. Please try again in a minute."
      });
    }
    let authResult: { success: boolean; uid?: string; email?: string } = { success: false };
    if (req.headers.authorization) {
      const staffAuth = await authenticateStaff(req);
      if (staffAuth.success) {
        authResult = staffAuth;
      }
    }
    (req as any).staff = authResult.success ? authResult : null;
    return await handleCancelPreview(req, res);
  }

  if (domain === "bookings" && action === "lookup" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`bookings-lookup:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many lookup attempts. Please try again in a minute." });
    }

    // Per S2 (soft batch 2026-06-26): an IP that has
    // burned through 3 consecutive 404s on this endpoint
    // is parked in a 1-hour backoff. The bucket is keyed
    // independently of the per-minute limit so a slow
    // trickle of attempts still trips it.
    if (process.env.NODE_ENV !== "test" && lookupFailures.isInBackoff(`bookings-lookup-fail:${ip}`, LOOKUP_FAILURE_THRESHOLD)) {
      return res.status(429).json({
        success: false,
        error: "Too many failed lookups. Please contact the front desk for help finding your booking."
      });
    }

    // Per H1 (hardening batch 2026-06-26): the lookup
    // endpoint is a ref+email oracle — without Turnstile,
    // a bot can probe the 99,999-key daily namespace
    // (5-digit post-H3) within the 10/min rate limit and
    // learn which refs are real via the 200 vs 404 timing
    // channel. Turnstile closes that.
    const verification = await verifyTurnstile(req.body?.turnstileToken, req);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    
    const lookupResult = await handleLookupBooking(req, res);

    // S2: a 404 increments the per-IP failure counter; a
    // 2xx clears it. We can't read the response status
    // directly here (the handler has already called
    // `res.status(...)`), so we wrap `res.status` once
    // to capture the most recent code, then read it
    // after the handler returns.
    if (process.env.NODE_ENV !== "test") {
      const statusCode = (res as any)._lastStatusCode;
      if (statusCode === 200) {
        lookupFailures.clear(`bookings-lookup-fail:${ip}`);
      } else if (statusCode === 404) {
        lookupFailures.record(`bookings-lookup-fail:${ip}`, LOOKUP_FAILURE_WINDOW_MS);
      }
    }

    return lookupResult;
  }

  if (domain === "rooms" && action === "availability" && req.method === "GET") {
    // Per W4.7: public guest-side availability query, PII-stripped. Bumped
    // above the per-IP booking limit so browsing dates on the booking page
    // does not collide with the booking-create limit.
    if (process.env.NODE_ENV !== "test" && isRateLimited(`rooms-availability:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many availability requests. Please try again in a minute." });
    }
    
    return await handleRoomAvailability(req, res);
  }

  if (domain === "validate" && action === "voucher" && req.method === "POST") {
    // 20 requests / IP / minute
    if (process.env.NODE_ENV !== "test" && isRateLimited(`validate-voucher:${ip}`, 20, 60000)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again later." });
    }

    // Turnstile Bot Check
    const verification = await verifyTurnstile(req.body?.turnstileToken, req);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    
    return await handleValidateVoucher(req, res);
  }

  if (domain === "validate" && action === "corporate-code" && req.method === "POST") {
    // 10 requests / IP / minute
    if (process.env.NODE_ENV !== "test" && isRateLimited(`validate-corporate-code:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again later." });
    }

    // Turnstile Bot Check
    const verification = await verifyTurnstile(req.body?.turnstileToken, req);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    
    return await handleValidateCorporateCode(req, res);
  }

  if (domain === "corporate" && action === "inquiry" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`corporate-inquiry:${ip}`, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many inquiry requests. Please try again in a minute." });
    }

    if (req.body && typeof req.body === "object" && req.body._hp) {
      return res.status(200).json({
        success: true,
        data: { inquiryId: "hp_" + Math.random().toString(36).substring(2, 9) }
      });
    }

    const verification = await verifyTurnstile(req.body?.turnstileToken, req);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    
    return await handleCreateCorporateInquiry(req, res);
  }

  if (domain === "contact" && action === "inquiry" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`contact-inquiry:${ip}`, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many contact requests. Please try again in a minute." });
    }

    if (req.body && typeof req.body === "object" && req.body._hp) {
      return res.status(200).json({
        success: true,
        data: { inquiryId: "hp_" + Math.random().toString(36).substring(2, 9) }
      });
    }

    const verification = await verifyTurnstile(req.body?.turnstileToken, req);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    
    return await handleCreateContactInquiry(req, res);
  }

  // Per W2.14 / decision #102 / audit S4.2: staff can convert a
  // corporate inquiry into a real bookings document. The new
  // booking is pre-filled from the inquiry (company, contact,
  // preferred dates, numRooms), linked back via linkedInquiryId,
  // and the inquiry status flips to "converted" + a note + the
  // back-link is persisted. The booking source is "corporate" per
  // W2.15 / decision #103.
  if (domain === "corporate" && action === "convert-inquiry" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    
    return await handleConvertInquiryToBooking(req, res);
  }

  if (domain === "reference" && action === "generate" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    
    return await handleGenerateReference(req, res);
  }

  if (domain === "members" && action === "register" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`members-register:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many rewards registration requests. Please try again in a minute." });
    }

    const authResult = await authenticateUser(req);
    if (!authResult.success) {
      return res.status(401).json({ success: false, error: authResult.error });
    }
    (req as any).user = authResult;
    
    return await handleRegisterMember(req, res);
  }

  if (domain === "members" && action === "stays" && req.method === "GET") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`members-stays:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many stay lookup requests. Please try again in a minute." });
    }

    const authResult = await authenticateUser(req);
    if (!authResult.success) {
      return res.status(401).json({ success: false, error: authResult.error });
    }
    (req as any).user = authResult;

    return await handleListMemberStays(req, res);
  }

  if (domain === "members" && action === "redeem-points" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    
    return await handleRedeemMemberPoints(req, res);
  }

  if (domain === "members" && action === "undo-redemption" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can undo points redemption." });
    }
    (req as any).staff = authResult;
    
    return await handleUndoMemberPointsRedemption(req, res);
  }

  if (domain === "members" && action === "set-active" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`members-set-active:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many member account update requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can suspend or activate member accounts." });
    }
    (req as any).staff = authResult;
    return await handleSetMemberActive(req, res);
  }

  // Per Spark Rewards audit 2026-07-18 MED-1: manual points
  // adjustment now lives server-side (Admin SDK) so the
  // `rewardsPoints` + `pointsHistory` write is in one transaction
  // and the Firestore rule can drop `rewardsPoints` from the
  // staff update allowlist. The handler enforces admin-only and
  // returns 403 for front-desk (mirrors the client UI guard at
  // MembersPage.tsx). Rate-limited to 10/min/IP — the same
  // budget as `set-active`.
  if (domain === "members" && action === "manual-adjust" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`members-manual-adjust:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many points adjustment requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can adjust member points." });
    }
    (req as any).staff = authResult;
    return await handleManualAdjustPoints(req, res);
  }

  // Per Spark Rewards audit 2026-07-18 MED-3 (decision #135):
  // manual link of an existing booking to a member, used when the
  // member's account email differs from the email on an earlier
  // anonymous booking. Admin-only (front-desk 403), rate-limited to
  // 10/min/IP — the same posture as the other staff-mediated
  // member mutations. The handler refuses cancelled / test-run
  // bookings and refuses re-linking to a different member
  // (no unlink from this surface; the booking-drawer memberId edit
  // is the work-around for that).
  if (domain === "members" && action === "link-booking" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`members-link-booking:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many booking-link requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can link bookings to a member." });
    }
    (req as any).staff = authResult;
    return await handleLinkBookingToMember(req, res);
  }

  if (domain === "members" && action === "delete-account" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`members-delete-account:${ip}`, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many account deletion requests. Please try again in a minute." });
    }

    const authResult = await authenticateUser(req);
    if (!authResult.success) {
      return res.status(401).json({ success: false, error: authResult.error });
    }
    (req as any).user = authResult;
    
    return await handleEraseMemberAccount(req, res);
  }

  if (domain === "admin" && action === "email-config" && req.method === "GET") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    return res.status(200).json({
      success: true,
      fromEmail: process.env.RESEND_FROM_EMAIL || config.supportEmail,
      adminEmail: process.env.RESEND_ADMIN_EMAIL || config.supportEmail
    });
  }

  // Per LCE-01 (decision #137, 2026-07-25): admin-only endpoint
  // that overwrites `settings/websiteContent.termsBody` and
  // auto-bumps the patch version. Mirrors the existing
  // `set-active` route's role gate + rate limit posture; the
  // admin-only role is the gate (front-desk 403). No new
  // Vercel function — this reuses the existing catch-all
  // pattern per `plan/docs/VERCEL-FUNCTION-LIMIT.md`.
  if (domain === "admin" && action === "update-terms" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`admin-update-terms:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many terms updates. Please wait a minute and try again." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can update terms." });
    }
    (req as any).staff = authResult;
    return await handleUpdateTerms(req, res);
  }

  if (domain === "admin" && action === "publish-seo" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`admin-publish-seo:${ip}`, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many publish requests. Please wait a minute and try again." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can publish SEO changes." });
    }
    (req as any).staff = authResult;
    return await handlePublishSeo(req, res);
  }

  if (domain === "admin" && action === "create-staff" && req.method === "POST") {
    // Per S4 (soft batch 2026-06-26): rate-limit the
    // staff-creation endpoint. An attacker with admin
    // access could otherwise iterate the email
    // already-exists oracle at high speed.
    if (process.env.NODE_ENV !== "test" && isRateLimited(`admin-create-staff:${ip}`, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many staff-creation requests. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can create staff accounts." });
    }
    (req as any).staff = authResult;
    
    return await handleCreateStaff(req, res);
  }

  if (domain === "admin" && action === "disable-staff" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`admin-disable-staff:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many disable-staff requests. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can disable staff accounts." });
    }
    (req as any).staff = authResult;
    
    return await handleDisableStaff(req, res);
  }

  if (domain === "admin" && action === "update-staff" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`admin-update-staff:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many update-staff requests. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can update staff accounts." });
    }
    (req as any).staff = authResult;
    
    return await handleUpdateStaff(req, res);
  }

  if (domain === "store" && action === "create-order" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`store:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many store order requests. Please try again in a minute." });
    }

    
    return await handleCreateStoreOrder(req, res);
  }

  if (domain === "store" && action === "cancel-order" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`store-cancel:${ip}`, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many store cancellation requests. Please try again in a minute." });
    }

    
    return await handleCancelStoreOrder(req, res);
  }

  if (domain === "store" && action === "order-status" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`store-status:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many store status requests. Please try again in a minute." });
    }

    
    return await handleGetStoreOrderStatus(req, res);
  }

  if (domain === "store" && action === "deliver-order" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleDeliverStoreOrder(req, res);
  }

  if (domain === "intercom" && action === "verify-guest" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`intercom-verify:${ip}`, 20, 60000)) {
      return res.status(429).json({ success: false, error: "Too many verification attempts. Please try again in a minute." });
    }

    return await handleVerifyIntercomGuest(req, res);
  }

  // G-04 (E2E audit 2026-07-17): guest intercom messages routed
  // through the API instead of direct Firestore writes. Rate-limited
  // at 30/room/10min (enforced in the handler with an IP/room key).
  if (domain === "intercom" && action === "send-message" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`intercom-send:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many message requests. Please try again in a minute." });
    }
    return await handleSendGuestMessage(req, res);
  }

  if (domain === "email" && action === "preview" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`email-preview:${ip}`, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again later." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    return await handleEmailPreview(req, res);
  }

  const isCronEmailMethod = action === "checkin-reminder" && req.method === "GET";

  const isKnownEmailAction = publicEmailActions.has(action) || staffOnlyEmailActions.has(action);
  if (domain === "email" && isKnownEmailAction && (req.method === "POST" || isCronEmailMethod)) {
    const rateLimitKey = req.body?.bookingRef || req.body?.bookingId || req.body?.inquiry?.email || req.body?.email || ip;
    if (process.env.NODE_ENV !== "test" && isRateLimited(`email:${action}:${rateLimitKey}`, 3, 3600000)) {
      return res.status(429).json({ success: false, error: "Too many email requests. Please try again later." });
    }

    const cronSecret = req.headers["x-cron-secret"];
    const authHeader = req.headers.authorization;
    const bearerSecret =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.split("Bearer ")[1]
        : "";
    const isCronRequest =
      action === "checkin-reminder" &&
      process.env.CRON_SECRET &&
      ((typeof cronSecret === "string" && cronSecret === process.env.CRON_SECRET) ||
        bearerSecret === process.env.CRON_SECRET);

    if (staffOnlyEmailActions.has(action) || (action === "checkin-reminder" && !isCronRequest)) {
      const authResult = await authenticateStaff(req);
      if (!authResult.success) {
        return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
      }
      (req as any).staff = authResult;
    } else if (action === "early-checkin-request") {
      const authResult = await authenticateStaff(req);
      if (!authResult.success) {
        const userAuth = await authenticateUser(req);
        if (!userAuth.success) {
          return res.status(401).json({ success: false, error: "Authentication required." });
        }
        // Per Spark Rewards audit 2026-07-18 HIGH-1: gate the
        // email-claim match in findBooking on `email_verified`. A
        // staff caller bypasses this gate (their role token is
        // verified and they don't key off the email claim). The
        // member-side `emailMatches` branch in findBooking would
        // otherwise let an unverified email/password signup fire
        // an early check-in write against a stranger's booking.
        if (userAuth.email_verified !== true) {
          return res.status(403).json({
            success: false,
            code: "EMAIL_NOT_VERIFIED",
            error: "Please verify your email to request early check-in. Check your inbox for the verification link, or resend it from your profile."
          });
        }
        (req as any).user = userAuth;
      } else {
        (req as any).staff = authResult;
      }
    } else if (req.headers.authorization) {
      const authResult = await authenticateStaff(req);
      if (!authResult.success) {
        return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
      } else {
        (req as any).staff = authResult;
      }
    }

    
    return await handleEmailTrigger(req, res, action as any);
  }

  // Per BF-50 (booking-flow audit 2026-06-26): Vercel
  // Cron-driven janitor that deletes orphaned
  // `bookings/{id}/` Storage subfolders where the matching
  // Firestore doc was never written (user abandoned the
  // form). Auth-gated by `CRON_SECRET`.
  if (domain === "janitor" && action === "storage-sweep" && (req.method === "POST" || req.method === "GET")) {
    
    return await handleJanitorStorageSweep(req, res);
  }

  // Per H5 (hardening batch 2026-06-26): ops endpoint that
  // returns the in-memory sweep history (last 50 runs).
  // Same CRON_SECRET auth as the sweep itself.
  if (domain === "janitor" && action === "stats" && req.method === "GET") {
    
    return await handleJanitorStats(req, res);
  }

  // Per S1 (soft batch 2026-06-26): one-time backfill that
  // adds `lookupToken` to every legacy booking doc so the
  // H2 deep-link works for the whole catalogue, not just
  // post-H2 bookings. Resumable (cursor persisted in
  // Firestore). CRON_SECRET-gated.
  if (domain === "janitor" && action === "h2-backfill" && (req.method === "POST" || req.method === "GET")) {

    return await handleH2LookupTokenBackfill(req, res);
  }
  if (domain === "janitor" && action === "h2-status" && req.method === "GET") {

    return await handleH2BackfillStatus(req, res);
  }

  // Per Phase 12 — Notification Center (decision #120):
  // daily retention job that prunes `notifications` docs
  // older than 30 days. Wired into `vercel.json` (see the
  // `crons` array). CRON_SECRET-gated like the existing
  // janitor sweep + check-in reminder.
  if (domain === "notifications" && action === "prune" && (req.method === "POST" || req.method === "GET")) {

    return await handleNotificationsPrune(req, res);
  }

  // Per PEX-06 (2026-08-01, per decision #147): the daily
  // cleanup cron for expired `pending` payment holds. Same
  // CRON_SECRET auth as the other Vercel cron handlers;
  // registered in `guest-app/vercel.json` so the
  // project-local cron config (not the monorepo-root
  // `vercel.json`) owns the schedule. Idempotent — re-fires
  // of the same cron tick find zero matches.
  if (domain === "holds" && action === "expire" && (req.method === "POST" || req.method === "GET")) {

    return await handleHoldExpiryCron(req, res);
  }

  // ── Test Runs (ETR) ──────────────────────────────────────
  if (domain === "test-runs" && action === "create" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`test-runs-create:${ip}`, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can manage test runs." });
    }
    (req as any).staff = authResult;
    return await handleCreateTestRun(req, res);
  }

  if (domain === "test-runs" && action === "close" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can manage test runs." });
    }
    (req as any).staff = authResult;
    return await handleCloseTestRun(req, res);
  }

  if (domain === "test-runs" && action === "delete" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can manage test runs." });
    }
    (req as any).staff = authResult;
    return await handleDeleteTestRun(req, res);
  }

  if (domain === "test-runs" && action === "list" && req.method === "GET") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can list test runs." });
    }
    (req as any).staff = authResult;
    return await handleListTestRuns(req, res);
  }

  // ── Staging Reset (ETR-S) ─────────────────────────────────
  if (domain === "test-runs" && action === "staging-reset-preview" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can preview staging reset." });
    }
    (req as any).staff = authResult;
    return await handleStagingResetPreview(req, res);
  }

  if (domain === "test-runs" && action === "staging-reset-execute" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`staging-reset:${ip}`, 2, 60000)) {
      return res.status(429).json({ success: false, error: "Too many reset requests. Please try again in a minute." });
    }
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can execute staging reset." });
    }
    (req as any).staff = authResult;
    return await handleStagingResetExecute(req, res);
  }

  // ETR-R01 / ETR-R04 / ETR-R10 (foundation) — production-to-
  // staging refresh preview. Accepts a JSON export of the production
  // collections and returns the sanitized version + an audit row.
  // See `handleStagingRefreshPreview` for the full contract.
  if (domain === "test-runs" && action === "staging-refresh-preview" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`staging-refresh-preview:${ip}`, 3, 60000)) {
      return res.status(429).json({ success: false, error: "Too many refresh requests. Please try again in a minute." });
    }

    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    if (authResult.role !== "admin") {
      return res.status(403).json({ success: false, error: "Only admins can refresh staging from production." });
    }
    (req as any).staff = authResult;
    return await handleStagingRefreshPreview(req, res);
  }

  // Fallback 404
  return res.status(404).json({ success: false, error: `Endpoint /api/${domain}/${action} not found.` });
}
