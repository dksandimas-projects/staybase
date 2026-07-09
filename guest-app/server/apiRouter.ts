import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminAuth } from "./lib/firebase-admin";
import { getConfiguredBookingRefPrefix, handleAddPayment, handleCancelBooking, handleCheckinBooking, handleCheckoutBooking, handleConfirmBooking, handleCreateBooking, handleCreateWalkin, handleLookupBooking, handleRejectDiscount, handleRescheduleBooking, handleResolveEarlyCheckin } from "./handlers/bookings";
import { handleRoomAvailability } from "./handlers/rooms";
import { handleCancelRoomBlock, handleCreateRoomBlock, handleUpdateRoomBlock } from "./handlers/room-blocks";
import { handleValidateVoucher } from "./handlers/vouchers";
import { handleValidateCorporateCode } from "./handlers/corporate-codes";
import { handleConvertInquiryToBooking, handleCreateCorporateInquiry } from "./handlers/corporate-inquiries";
import { handleCreateContactInquiry } from "./handlers/contact";
import { handleGenerateReference } from "./handlers/reference";
import { handleEraseMemberAccount, handleListMemberStays, handleRedeemMemberPoints, handleRegisterMember, handleSetMemberActive, handleUndoMemberPointsRedemption } from "./handlers/members";
import { handleCreateStaff, handleDisableStaff, handleUpdateStaff } from "./handlers/admin";
import { handleCancelStoreOrder, handleCreateStoreOrder, handleGetStoreOrderStatus } from "./handlers/store";
import { handleVerifyIntercomGuest } from "./handlers/intercom";
import { handleEmailTrigger, handleEmailPreview } from "./handlers/email";
import { handleH2BackfillStatus, handleH2LookupTokenBackfill, handleJanitorStats, handleJanitorStorageSweep } from "./handlers/janitor";
import config from "../../hotel.config";

const staffOnlyEmailActions = new Set([
  "payment-confirmed",
  "booking-confirmed",
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
const ALLOWED_ORIGINS = new Set<string>([
  `https://${configuredGuestHost}`,
  `https://www.${configuredGuestHost}`.replace(/^https:\/\/www\.www\./, "https://www."),
  `https://${configuredAdminHost}`,
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

async function authenticateUser(req: VercelRequest): Promise<{ success: boolean; uid?: string; email?: string; name?: string; picture?: string; error?: string }> {
  if (process.env.NODE_ENV === "test") {
    return {
      success: true,
      uid: "mock_member_uid",
      email: "member@sparkinn.com",
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
      name: decodedToken.name,
      picture: decodedToken.picture
    };
  } catch (err) {
    console.error("Token verification failed:", err);
    return { success: false, error: getTokenVerificationFailureMessage(token) };
  }
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

  if (domain === "bookings" && action === "add-payment" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;

    return await handleAddPayment(req, res);
  }

  if (domain === "bookings" && action === "reject-discount" && req.method === "POST") {
    const authResult = await authenticateStaff(req);
    if (!authResult.success) {
      return res.status(authResult.error?.includes("Forbidden") ? 403 : 401).json({ success: false, error: authResult.error });
    }
    (req as any).staff = authResult;
    
    return await handleRejectDiscount(req, res);
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

  if (domain === "intercom" && action === "verify-guest" && req.method === "POST") {
    if (process.env.NODE_ENV !== "test" && isRateLimited(`intercom-verify:${ip}`, 20, 60000)) {
      return res.status(429).json({ success: false, error: "Too many verification attempts. Please try again in a minute." });
    }

    return await handleVerifyIntercomGuest(req, res);
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

  // Fallback 404
  return res.status(404).json({ success: false, error: `Endpoint /api/${domain}/${action} not found.` });
}
