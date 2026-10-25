// Per P0-STAFF-TURNSTILE (2026-10-24): six STAFF mutations were dead
// in production.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The staff breakfast and other-add-on write endpoints authenticate the
// caller FIRST — `authenticateStaff` verifies the Firebase ID token's
// signature (`adminAuth.verifyIdToken`) and then requires the `role`
// claim to be `admin` or `front-desk` — and only THEN ran the
// Cloudflare Turnstile gate.
//
// The admin app ships no Turnstile widget and sent
// `turnstileToken: undefined`, so every one of those six endpoints
// answered:
//
//   HTTP 400  { success: false, error: "Bot verification token is missing." }
//
// The staff features were dead: "Mark served", "record a breakfast
// refund", "add / remove an other add-on", and their refund
// equivalents. Verified live in production on 2026-10-23 (QA report
// §3.1).
//
// THE FIX
// -------
// An AUTHENTICATED staff write does not need a bot token. A bot token
// defends against ANONYMOUS callers; a staff write is already behind a
// signature-verified ID token with a role claim, which is a strictly
// stronger control. This is the posture `bookings/cancel` has used
// since 2026-06-26 ("Staff requests bypass (they're already
// authenticated)"), now applied through one shared helper.
//
// WHAT MUST STAY TRUE
// -------------------
//   * an anonymous caller with no token is still refused
//   * the GUEST write paths (booking create, breakfast update, add-ons
//     update, lookup, extend-stay, voucher, corporate code, inquiry,
//     contact) are still Turnstile-gated
//   * the staff endpoints still require a valid staff token — the gate
//     is skipped, the AUTHENTICATION is not

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { enforceBotGate } from "../../server/apiRouter";

/** A minimal Vercel response double that records what was sent. */
function makeRes() {
  const state: { status?: number; body?: unknown } = {};
  const res: any = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    end() {
      return res;
    }
  };
  return { res, state };
}

const ORIGINAL_ENV = process.env.NODE_ENV;

beforeEach(() => {
  // `verifyTurnstile` short-circuits to `success: true` when
  // `NODE_ENV === "test"`, which would make the gate indistinguishable
  // from the staff bypass. Force the production code path so the test
  // actually exercises the refusal.
  process.env.NODE_ENV = "production";
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("P0-STAFF-TURNSTILE — an authenticated staff write skips the bot gate", () => {
  it("lets an authenticated staff request through with no bot token", async () => {
    const { res, state } = makeRes();
    const req: any = {
      method: "POST",
      headers: { authorization: "Bearer a-real-id-token" },
      body: {},
      // `authenticateStaff` sets this before the gate runs.
      staff: { success: true, uid: "staff-uid", role: "admin" }
    };

    const denied = await enforceBotGate(req, res);

    expect(denied, "an authenticated staff write must not be refused by the bot gate").toBeNull();
    expect(state.status, "the gate must not have written a response").toBeUndefined();
  });

  it("still refuses an ANONYMOUS caller with no bot token", async () => {
    const { res, state } = makeRes();
    const req: any = {
      method: "POST",
      headers: {},
      body: {},
      staff: null
    };

    const denied = await enforceBotGate(req, res);

    expect(denied, "an anonymous write must still be refused").not.toBeNull();
    expect(state.status).toBe(400);
    expect((state.body as any)?.error).toMatch(/Bot verification token is missing/i);
  });

  it("does not skip the gate for a request whose staff auth FAILED", async () => {
    // `authenticateStaff` sets `staff` to the result object only on
    // success; a failed authentication never reaches the gate at all
    // (the route returns 401/403 first). This pins that the gate does
    // not treat a falsy-but-present value as "staff".
    const { res, state } = makeRes();
    const req: any = {
      method: "POST",
      headers: {},
      body: {},
      staff: undefined
    };

    const denied = await enforceBotGate(req, res);

    expect(denied).not.toBeNull();
    expect(state.status).toBe(400);
  });
});

describe("P0-STAFF-TURNSTILE — the route wiring (tripwire)", () => {
  const routerSrc = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
  const adminContextSrc = readFileSync(
    resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
    "utf8"
  );

  /** The six staff endpoints that were dead. */
  const STAFF_ROUTES = [
    "bookings/breakfast/staff-update",
    "bookings/breakfast/mark-served",
    "bookings/breakfast/mark-refund-paid",
    "bookings/addons/staff-update",
    "bookings/addons/mark-served",
    "bookings/addons/mark-refund-paid"
  ];

  it("the six staff endpoints use the staff-aware gate", () => {
    const gated = routerSrc.match(/enforceBotGate\(req, res\)/g) || [];
    expect(
      gated.length,
      "every staff write endpoint must call `enforceBotGate`"
    ).toBe(STAFF_ROUTES.length);
  });

  it("the guest and anonymous write paths are STILL Turnstile-gated", () => {
    // `verifyTurnstile` is called directly on every path that serves an
    // anonymous or self-service caller. The count must not shrink: the
    // six staff endpoints were ADDED to the bypass, not moved out of
    // the gate entirely.
    const strict = routerSrc.match(/verifyTurnstile\(req\.body\?\.turnstileToken, req\)/g) || [];
    // bookings/create, bookings/cancel (staff-aware), extend-stay,
    // lookup, breakfast/update, addons/update, validate/voucher,
    // validate/corporate-code, corporate/inquiry, contact/create.
    expect(strict.length, "the anonymous / guest gate call sites").toBeGreaterThanOrEqual(10);
  });

  it("the admin client no longer sends a placeholder Turnstile token", () => {
    // The Turnstile echo header was never read by the server, and the
    // placeholder body field is what made every staff mutation fail.
    // Neither may come back. The tripwires match the CODE shapes — a
    // quoted header key and a property assignment — so the explanatory
    // comments that name them do not trip the test.
    expect(adminContextSrc).not.toMatch(/"X-Spark-Inn-Turnstile"\s*:/);
    expect(adminContextSrc).not.toMatch(/turnstileToken:\s*undefined\s*[,}]/);
  });

  it("the admin client still sends the staff Authorization header on every staff mutation", () => {
    const staffCalls = adminContextSrc.match(
      /\/api\/bookings\/(breakfast|addons)\/[a-z-]+/g
    ) || [];
    expect(staffCalls.length, "the admin must call the staff breakfast/add-on endpoints").toBeGreaterThanOrEqual(6);
    const bearer = adminContextSrc.match(/"Authorization":\s*token\s*\?\s*`Bearer \$\{token\}`\s*:\s*""/g) || [];
    expect(bearer.length, "every staff call must carry the Bearer token").toBeGreaterThanOrEqual(6);
  });
});
