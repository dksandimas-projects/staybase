import type { VercelRequest, VercelResponse } from "@vercel/node";
import { 
  handleCreateBooking, 
  handleCreateWalkin, 
  handleAddPayment, 
  handleRejectDiscount, 
  handleCancelBooking 
} from "./handlers/bookings";
import { handleValidateVoucher } from "./handlers/vouchers";
import { handleValidateCorporateCode } from "./handlers/corporate-codes";
import { adminAuth } from "./lib/firebase-admin";

async function authenticateStaff(req: VercelRequest): Promise<{ success: boolean; uid?: string; email?: string; error?: string }> {
  if (process.env.NODE_ENV === "test") {
    return {
      success: true,
      uid: "mock_staff_uid",
      email: "mock_staff@sparkinn.com"
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
      email: decodedToken.email
    };
  } catch (err) {
    console.error("Token verification failed:", err);
    return { success: false, error: "Unauthorized: Invalid or expired token." };
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

async function verifyTurnstile(token: string | undefined): Promise<{ success: boolean; error?: string }> {
  // Cloudflare test keys: always verify successfully
  // Bypassed if NODE_ENV is "test"
  if (
    process.env.NODE_ENV === "test" ||
    token === "1x00000000000000000000AA" ||
    token === "1x00000000000000000000000000000000" ||
    token === "mock_token"
  ) {
    return { success: true };
  }

  if (!token) {
    return { success: false, error: "Bot verification token is missing." };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("⚠️ Missing TURNSTILE_SECRET_KEY in server environment.");
    return { success: true }; // Allow through if key is unconfigured locally
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
  // 1. Enforce CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 2. Parse Path Segments
  const parsedUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const pathSegments = parsedUrl.pathname
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean);

  const [domain, action] = pathSegments;

  // 3. Rate Limiting based on IP
  const rawIp = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
  const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(",")[0].trim();

  // Route Dispatch and Middlewares
  if (domain === "bookings" && action === "create" && req.method === "POST") {
    // 5 requests / IP / minute
    if (process.env.NODE_ENV !== "test" && isRateLimited(ip, 5, 60000)) {
      return res.status(429).json({ success: false, error: "Too many booking requests. Please try again in a minute." });
    }

    // Honeypot Bot Check
    if (req.body && typeof req.body === "object" && req.body._hp) {
      console.log("Honeypot triggered, silently ignoring write.");
      return res.status(200).json({
        success: true,
        data: {
          bookingId: req.body.bookingId || "hp_" + Math.random().toString(36).substring(2, 9),
          bookingRef: `SI-${new Date().getFullYear()}0608-099`
        }
      });
    }

    // Turnstile Bot Check
    const verification = await verifyTurnstile(req.body?.turnstileToken);
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

  if (domain === "bookings" && action === "cancel" && req.method === "POST") {
    let authResult = { success: false, uid: "", email: "" };
    if (req.headers.authorization) {
      const staffAuth = await authenticateStaff(req);
      if (staffAuth.success) {
        authResult = staffAuth;
      }
    }
    (req as any).staff = authResult.success ? authResult : null;
    return await handleCancelBooking(req, res);
  }

  if (domain === "validate" && action === "voucher" && req.method === "POST") {
    // 20 requests / IP / minute
    if (process.env.NODE_ENV !== "test" && isRateLimited(ip, 20, 60000)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again later." });
    }

    // Turnstile Bot Check
    const verification = await verifyTurnstile(req.body?.turnstileToken);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    return await handleValidateVoucher(req, res);
  }

  if (domain === "validate" && action === "corporate-code" && req.method === "POST") {
    // 10 requests / IP / minute
    if (process.env.NODE_ENV !== "test" && isRateLimited(ip, 10, 60000)) {
      return res.status(429).json({ success: false, error: "Too many requests. Please try again later." });
    }

    // Turnstile Bot Check
    const verification = await verifyTurnstile(req.body?.turnstileToken);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    return await handleValidateCorporateCode(req, res);
  }

  // Fallback 404
  return res.status(404).json({ success: false, error: `Endpoint /api/${domain}/${action} not found.` });
}
