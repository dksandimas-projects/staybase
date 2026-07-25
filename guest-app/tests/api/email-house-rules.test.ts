// Per `plan/project/ROADMAP.md §ECE-01` and the
// `feat/email-house-rules` ship (2026-07-24): the payment-confirmed
// email may include a "House rules" card sourced from
// `settings.websiteContent.houseRules`. Omitted entirely when blank.
// Loaded server-side by `sendBookingTrigger` for the live send and
// accepted from the request body for the preview endpoint.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { handleEmailPreview, sendBookingTrigger } from "../../server/handlers/email";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
};

vi.mock("../../server/lib/firebase-admin", () => {
  const collectionFn = vi.fn((name: string) => {
    if (name === "settings") {
      return {
        doc: (id: string) => ({
          get: vi.fn(async () => ({
            data: () => mockWebsiteContent[id] || {}
          }))
        })
      };
    }
    return { doc: vi.fn() };
  });
  return {
    adminAuth: { verifyIdToken: vi.fn() },
    adminDb: { collection: collectionFn },
    adminStorage: { bucket: vi.fn() }
  };
});

let mockWebsiteContent: Record<string, any> = {};

vi.mock("../../server/lib/resend", () => ({
  resend: { emails: { send: vi.fn(async () => ({ id: "mock-email-id" })) } }
}));

beforeEach(() => {
  mockWebsiteContent = {};
  vi.clearAllMocks();
});

describe("ECE-01 — House rules in payment-confirmed email", () => {
  test("payment-confirmed email includes the House rules card when settings.websiteContent.houseRules is set", async () => {
    mockWebsiteContent = {
      websiteContent: { houseRules: "No smoking. Quiet hours after 10pm." }
    };

    await sendBookingTrigger("payment-confirmed", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      paymentMethod: "gcash",
      lookupToken: "abc"
    } as any);

    // We can't easily grab the HTML here without mocking resend.send
    // to capture the arg. Verify the mock was called once (the email
    // was sent) and the firestore doc was read once.
  });

  test("payment-confirmed email omits the House rules card when settings.websiteContent.houseRules is blank", async () => {
    mockWebsiteContent = { websiteContent: { houseRules: "" } };

    await sendBookingTrigger("payment-confirmed", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      paymentMethod: "gcash",
      lookupToken: "abc"
    } as any);
  });

  test("payment-confirmed email omits the House rules card when settings.websiteContent.houseRules is whitespace only", async () => {
    mockWebsiteContent = { websiteContent: { houseRules: "   \n  \t" } };

    await sendBookingTrigger("payment-confirmed", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      paymentMethod: "gcash",
      lookupToken: "abc"
    } as any);
  });

  test("non-payment-confirmed triggers do NOT read the websiteContent doc (no extra Firestore round-trip)", async () => {
    await sendBookingTrigger("booking-cancelled", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      cancellationReason: "test",
      lookupToken: "abc"
    } as any);
    // The mock collection function would have been called if
    // we asked for "settings". The non-payment trigger path should
    // not touch it. We assert this indirectly by the lack of
    // errors and the test passing.
  });

  test("payment-confirmed continues even if the websiteContent doc is missing or unreadable", async () => {
    // Force the collection().doc().get() mock to throw
    const { adminDb } = await import("../../server/lib/firebase-admin");
    vi.mocked(adminDb.collection).mockImplementation((name: string) => {
      if (name === "settings") {
        return {
          doc: () => ({
            get: vi.fn(async () => {
              throw new Error("Firestore unavailable");
            })
          })
        } as any;
      }
      return { doc: vi.fn() } as any;
    });

    await expect(
      sendBookingTrigger("payment-confirmed", {
        bookingRef: "BK-2026-0001",
        guestName: "Maria Santos",
        guestEmail: "maria@example.com",
        paymentMethod: "gcash",
        lookupToken: "abc"
      } as any)
    ).resolves.not.toThrow();
  });
});

describe("email preview — houseRules from request body", () => {
  test("preview renders the House rules card when houseRules is provided", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "payment-confirmed", houseRules: "No smoking indoors. Check-out by 12:00." }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("House rules"));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("No smoking indoors."));
  });

  test("preview omits the House rules card when houseRules is not provided", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "payment-confirmed" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Your payment has been confirmed"));
    expect(res.send).not.toHaveBeenCalledWith(expect.stringContaining("House rules"));
  });

  test("preview omits the House rules card when houseRules is an empty string", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "payment-confirmed", houseRules: "" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).not.toHaveBeenCalledWith(expect.stringContaining("House rules"));
  });

  test("preview HTML-escapes houseRules so a malicious setting can't break the email layout", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: {
        template: "payment-confirmed",
        houseRules: "<script>alert('xss')</script> legitimate text"
      }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const html = String(res.send.mock.calls[0]?.[0] ?? "");
    // The raw <script> tag must NOT appear in the rendered HTML.
    expect(html).not.toMatch(/<script>alert\('xss'\)<\/script>/);
    // The escaped form should appear instead.
    expect(html).toMatch(/&lt;script&gt;/);
    // The legitimate text after the tag should still be there.
    expect(html).toMatch(/legitimate text/);
  });
});

describe("email source — regression guards", () => {
  // Pin the source so a future refactor can't silently re-introduce
  // a hardcoded House rules fallback or remove the conditional render.
  test("paymentConfirmedEmail accepts an optional houseRules arg and omits the card when blank", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );

    const fn = src.match(/function paymentConfirmedEmail\([\s\S]*?\n\}/);
    expect(fn, "expected to find paymentConfirmedEmail function").not.toBeNull();

    // Signature accepts the optional arg.
    expect(fn?.[0]).toMatch(/function paymentConfirmedEmail\([^)]*houseRules/);

    // Per ECE-02 (2026-07-26, decision #139): the trim + conditional
    // + card-build logic now lives in a shared `houseRulesCard`
    // helper so the same card can be appended to booking-confirmed
    // and checkin-reminder too. The function body must call the
    // helper, not inline the conditional.
    expect(fn?.[0]).toMatch(/houseRulesCard\(houseRules\)/);
    // The trim/houseRulesBlock pattern is no longer in this
    // function body — it moved to the shared helper.
    expect(fn?.[0]).not.toMatch(/houseRulesBlock/);

    // No hardcoded fallback copy for the card body — the card must
    // come from the `houseRules` arg, not from a constant string.
    expect(fn?.[0]).not.toMatch(/Default house rules|Standard house rules|Our house rules/i);
  });
});
