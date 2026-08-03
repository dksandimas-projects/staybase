// Per `plan/project/ROADMAP.md §ECE-02` and decision #139
// (2026-07-26): ECE-01 shipped the "House rules" card on the
// payment-confirmed email. ECE-02 extends the same card to the
// booking-confirmed + checkin-reminder emails so the guest
// sees the property rules at every "you're arriving soon"
// touchpoint. Same single source of truth
// (`settings.websiteContent.houseRules`), same omit-when-blank
// behavior, same HTML-escape, same preview-endpoint contract.

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

let settingsDocReadCount = 0;
let mockWebsiteContent: Record<string, any> = {};
let forceSettingsDocThrow = false;

vi.mock("../../server/lib/firebase-admin", () => {
  const collectionFn = vi.fn((name: string) => {
    if (name === "settings") {
      return {
        doc: (id: string) => ({
          get: vi.fn(async () => {
            settingsDocReadCount += 1;
            if (forceSettingsDocThrow) {
              throw new Error("Firestore unavailable");
            }
            return { data: () => mockWebsiteContent[id] || {} };
          })
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

vi.mock("../../server/lib/resend", () => ({
  resend: { emails: { send: vi.fn(async () => ({ id: "mock-email-id" })) } }
}));

beforeEach(() => {
  mockWebsiteContent = {};
  settingsDocReadCount = 0;
  forceSettingsDocThrow = false;
  vi.clearAllMocks();
});

describe("ECE-02 — booking-confirmed email includes the House rules card", () => {
  test("includes the card when settings.websiteContent.houseRules is set", async () => {
    mockWebsiteContent = {
      websiteContent: { houseRules: "No smoking. Quiet hours after 10pm." }
    };

    await sendBookingTrigger("booking-confirmed", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      lookupToken: "abc"
    } as any);

    expect(settingsDocReadCount).toBe(1);
  });

  test("omits the card when settings.websiteContent.houseRules is blank", async () => {
    mockWebsiteContent = { websiteContent: { houseRules: "" } };

    await sendBookingTrigger("booking-confirmed", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      lookupToken: "abc"
    } as any);
  });

  test("omits the card when settings.websiteContent.houseRules is whitespace only", async () => {
    mockWebsiteContent = { websiteContent: { houseRules: "   \n  \t" } };

    await sendBookingTrigger("booking-confirmed", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      lookupToken: "abc"
    } as any);
  });

  test("continues without the card if the websiteContent doc read throws", async () => {
    forceSettingsDocThrow = true;

    await expect(
      sendBookingTrigger("booking-confirmed", {
        bookingRef: "BK-2026-0001",
        guestName: "Maria Santos",
        guestEmail: "maria@example.com",
        lookupToken: "abc"
      } as any)
    ).resolves.not.toThrow();
  });
});

describe("ECE-02 — checkin-reminder email includes the House rules card", () => {
  test("includes the card when settings.websiteContent.houseRules is set", async () => {
    mockWebsiteContent = {
      websiteContent: { houseRules: "Check-out by 12:00 noon. Front desk available 24/7." }
    };

    await sendBookingTrigger("checkin-reminder", {
      bookingRef: "BK-2026-0002",
      guestName: "Juan Dela Cruz",
      guestEmail: "juan@example.com",
      lookupToken: "xyz"
    } as any);

    expect(settingsDocReadCount).toBe(1);
  });

  test("omits the card when settings.websiteContent.houseRules is missing", async () => {
    // mockWebsiteContent is empty
    await sendBookingTrigger("checkin-reminder", {
      bookingRef: "BK-2026-0002",
      guestName: "Juan Dela Cruz",
      guestEmail: "juan@example.com",
      lookupToken: "xyz"
    } as any);
  });
});

describe("ECE-02 — non-arrival triggers still skip the websiteContent read", () => {
  test("booking-cancelled does NOT touch the settings/websiteContent doc", async () => {
    await sendBookingTrigger("booking-cancelled", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      cancellationReason: "test",
      lookupToken: "abc"
    } as any);

    expect(settingsDocReadCount).toBe(0);
  });

  test("booking-submitted does NOT touch the settings/websiteContent doc", async () => {
    await sendBookingTrigger("booking-submitted", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      lookupToken: "abc"
    } as any);

    expect(settingsDocReadCount).toBe(0);
  });

  test("discount-rejected does NOT touch the settings/websiteContent doc", async () => {
    await sendBookingTrigger("discount-rejected", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      discountRejectionReason: "ID unreadable",
      lookupToken: "abc"
    } as any);

    expect(settingsDocReadCount).toBe(0);
  });
});

describe("ECE-02 — preview endpoint renders the card for booking-confirmed + checkin-reminder", () => {
  test("booking-confirmed preview renders the House rules card when houseRules is provided", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "booking-confirmed", houseRules: "No smoking indoors. Check-out by 12:00." }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("House rules"));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("No smoking indoors."));
  });

  test("booking-confirmed preview omits the card when houseRules is not provided", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "booking-confirmed" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Your room is ready on our calendar"));
    expect(res.send).not.toHaveBeenCalledWith(expect.stringContaining("House rules"));
  });

  test("booking-confirmed preview HTML-escapes houseRules", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: {
        template: "booking-confirmed",
        houseRules: "<script>alert('xss')</script> legitimate text"
      }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const html = String(res.send.mock.calls[0]?.[0] ?? "");
    expect(html).not.toMatch(/<script>alert\('xss'\)<\/script>/);
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).toMatch(/legitimate text/);
  });

  test("checkin-reminder preview renders the House rules card when houseRules is provided", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "checkin-reminder", houseRules: "Check-out by 12:00 noon. Front desk available 24/7." }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("House rules"));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Check-out by 12:00 noon"));
  });

  test("checkin-reminder preview omits the card when houseRules is an empty string", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "checkin-reminder", houseRules: "" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Your stay begins tomorrow"));
    expect(res.send).not.toHaveBeenCalledWith(expect.stringContaining("House rules"));
  });
});

describe("ECE-02 — source-text regression guards", () => {
  // Pin the source so a future refactor can't silently drop the
  // houseRules arg from the new templates or remove the gated
  // loader.
  test("bookingConfirmedEmail signature accepts the optional houseRules arg", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );

    const fn = src.match(/function bookingConfirmedEmail\([\s\S]*?\n\}/);
    expect(fn, "expected to find bookingConfirmedEmail function").not.toBeNull();
    expect(fn?.[0]).toMatch(/function bookingConfirmedEmail\([^)]*houseRules/);
    // Card is appended to the body — the block name (houseRulesCard)
    // is the shared helper.
    expect(fn?.[0]).toMatch(/houseRulesCard\(houseRules\)/);
  });

  test("checkinReminderEmail signature accepts the optional houseRules arg", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );

    const fn = src.match(/function checkinReminderEmail\([\s\S]*?\n\}/);
    expect(fn, "expected to find checkinReminderEmail function").not.toBeNull();
    expect(fn?.[0]).toMatch(/function checkinReminderEmail\([^)]*houseRules/);
    expect(fn?.[0]).toMatch(/houseRulesCard\(houseRules\)/);
  });

  test("shared houseRulesCard helper trims + omits when blank + escapeHtml on render", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );

    const fn = src.match(/function houseRulesCard\([\s\S]*?\n\}/);
    expect(fn, "expected to find houseRulesCard helper").not.toBeNull();
    expect(fn?.[0]).toMatch(/trim\(\)/);
    expect(fn?.[0]).toMatch(/escapeHtml/);
    // No hardcoded fallback copy.
    expect(fn?.[0]).not.toMatch(/Default house rules|Standard house rules|Our house rules/i);
  });

  test("sendBookingTrigger gates the websiteContent read by a Set containing all 3 ECE actions", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );

    // The loader now uses a Set of actions (HOUSE_RULES_ACTIONS) so
    // any future action that needs houseRules is a one-line add.
    expect(src).toMatch(/const HOUSE_RULES_ACTIONS = new Set<EmailAction>\(\s*\[\s*"payment-confirmed"[\s\S]*?"booking-confirmed"[\s\S]*?"checkin-reminder"[\s\S]*?\]\)/);
    expect(src).toMatch(/HOUSE_RULES_ACTIONS\.has\(action\)/);

    // Each of the 3 action branches passes houseRules through to
    // the template.
    expect(src).toMatch(/paymentConfirmedEmail\(booking,\s*houseRules\)/);
    expect(src).toMatch(/bookingConfirmedEmail\(booking,\s*houseRules\)/);
    expect(src).toMatch(/checkinReminderEmail\(booking,\s*houseRules\)/);
  });

  test("preview handler routes houseRules to booking-confirmed + checkin-reminder", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );

    // Find the preview switch block. All three templates must pass
    // houseRules through (string-typed + null fallback for the
    // omitted case), matching the ECE-01 payment-confirmed pattern.
    expect(src).toMatch(/case "booking-confirmed":[\s\S]*?bookingConfirmedEmail\(mockBooking,\s*typeof houseRules === "string" \? houseRules : null\)/);
    expect(src).toMatch(/case "checkin-reminder":[\s\S]*?checkinReminderEmail\(mockBooking,\s*typeof houseRules === "string" \? houseRules : null\)/);
    // The payment-confirmed preview path is the established pattern.
    expect(src).toMatch(/case "payment-confirmed":[\s\S]*?paymentConfirmedEmail\(mockBooking,\s*typeof houseRules === "string" \? houseRules : null\)/);
  });
});
