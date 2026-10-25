/**
 * AI-BROWSER-QA (2026-10-25) — the guest write paths, re-opened by the
 * hotel-wide bot-protection switch.
 *
 * These are API-level scenarios (the catalogue writes them as `curl`).
 * They live in the Playwright suite because the thing under test is the
 * DEPLOYED server: before the switch the bot gate refused every caller
 * before the handler ran, so the specific contracts below could not be
 * observed at all — they were BLOCKED, not passing.
 *
 * Every call here is either REFUSED by design (SEC-10 / SEC-11) or a
 * pure VALIDATION (VC-01 / VC-03 / VC-04 / CO-05). None of them creates
 * a record, so the suite is safe to run against production.
 *
 * The switch is fail-closed: `settings/hotelConfig.botProtectionMode`
 * must be EXACTLY "disabled" for the gate to be skipped, and any read
 * error keeps the gate on. If the hotel turns the switch back off, these
 * tests will fail with "Bot verification token is missing." — which is
 * the correct signal that the gate is back.
 */

import { test, expect } from "../support/qa";

const GUEST_BASE = process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com";

/** The gate is off for these cases; if it is on, the body says so. */
async function postJson(
  request: any,
  path: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: any; text: string }> {
  const res = await request.post(`${GUEST_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    data: payload
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status(), body, text };
}

test.describe("Guest write paths (bot protection off)", () => {
  // The email endpoint is rate limited to 20 requests/hour per IP (and
  // 3/hour per target) — see `apiRouter.ts`. These two cases are
  // API-level, so they run on ONE project only (the result is identical
  // on both), and they SKIP with an explicit reason when the limiter is
  // active rather than failing.
  test("SEC-10 · the reservation-ref email path requires the guest credential", async ({
    request
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "the email endpoint's rate limiter (20/hour per IP) is a shared budget — " +
        "this API-level case runs on the desktop project only"
    );

    const { status, body, text } = await postJson(request, "/api/email/booking-submitted", {
      bookingRef: "R-20261021-99999"
    });

    if (status === 429) {
      test.skip(
        true,
        "the email endpoint's rate limiter is active for this IP right now — the " +
          "credential contract was verified live on 2026-10-25 (HTTP 400 " +
          "\"Booking reference and guest email are required.\"); re-run after the window"
      );
    }

    expect(text, "the response must be the credential refusal, not a routing error").not.toMatch(
      /\/undefined|Endpoint /
    );
    expect(status).toBe(400);
    expect(body?.error).toBe("Booking reference and guest email are required.");
  });

  test("SEC-11 · a wrong guest email is a 404, not an email", async ({ request }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "the email endpoint's rate limiter (20/hour per IP) is a shared budget — " +
        "this API-level case runs on the desktop project only"
    );

    const { status, body } = await postJson(request, "/api/email/booking-submitted", {
      bookingRef: "SI-20261021-00001",
      guestEmail: "not-the-guest@example.com"
    });

    if (status === 429) {
      test.skip(
        true,
        "the email endpoint's rate limiter is active for this IP right now — the " +
          "404 contract was verified live on 2026-10-25 (HTTP 404 \"Booking not found.\")"
      );
    }

    expect(status).toBe(404);
    expect(body?.error).toBe("Booking not found.");
    expect(body?.success).toBe(false);
  });

  test("VC-01 · a valid percent voucher validates", async ({ request }) => {
    // `OFFNOW` is 15 % and used twice in production, so it is below its
    // cap. (`SAVE20` is AT its cap — see VC-05 — so it is refused with
    // "Voucher usage limit reached.", which is the correct answer for
    // that code.)
    const { status, body } = await postJson(request, "/api/validate/voucher", {
      code: "OFFNOW",
      roomType: "standard-double"
    });

    expect(status).toBe(200);
    expect(body?.success).toBe(true);
    expect(body?.data?.code).toBe("OFFNOW");
    expect(body?.data?.discountType).toBe("percent");
    expect(body?.data?.discountValue).toBe(15);
  });

  test("VC-03 · a flat voucher on the wrong room type is refused", async ({ request }) => {
    const { status, body } = await postJson(request, "/api/validate/voucher", {
      code: "FLAT500",
      roomType: "standard-twin"
    });

    expect(status).toBe(400);
    expect(body?.error).toMatch(/does not apply to this room type/i);
  });

  test("VC-04 · an expired voucher is refused", async ({ request }) => {
    const { status, body } = await postJson(request, "/api/validate/voucher", {
      code: "EXPIRED1",
      roomType: "standard-double"
    });

    expect(status).toBe(400);
    expect(body?.error).toMatch(/expired/i);
  });

  test("CO-05 · an unrecognised corporate access code is refused kindly", async ({ request }) => {
    const { status, body } = await postJson(request, "/api/validate/corporate-code", {
      code: "NONSENSE-XYZ"
    });

    expect(status).toBe(400);
    // The scenario's requirement: "Friendly error each time; the guest
    // can still continue without a code - the flow is never dead-ended."
    expect(body?.error).toMatch(/not recognized|not recognised/i);
    expect(body?.error).toMatch(/continue without a code/i);
  });
});
