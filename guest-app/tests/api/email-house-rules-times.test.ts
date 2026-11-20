// Per HC-02 (decision #329, 2026-11-20): the guest EMAILS render the
// hotel's check-in / check-out times from the ONE source of truth —
// `settings/hotelConfig` — not from prose the admin typed by hand.
//
// THE DEFECT
// ----------
// `settings/websiteContent.houseRules` is free text the admin edits
// in Settings → Legal. It said *"Check-in time is 2:00 PM. Check-out
// time is 12:00 PM."* while the live `settings/hotelConfig` said
// `checkInTime: "14:00"` / `checkOutTime: "11:00"`. The email told
// the guest 12:00 PM; the booking Step 2 arrival-time dropdown (which
// reads `hotelConfig.checkInTime`) told them 11:00. Two sources for
// one fact, already disagreeing.
//
// THE FIX
// -------
// The rules may now carry the tokens `{{checkInTime}}` /
// `{{checkOutTime}}`. Every surface that renders the rules resolves
// them against the live values BEFORE rendering.
//
// THIS SUITE PINS
//   1. the live email renders the RESOLVED time, not the token;
//   2. the staff preview renders the same resolved time (the preview
//      is what the admin reads to sanity-check the email);
//   3. a rules text with no token is left alone (the admin's plain
//      prose still renders verbatim).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleEmailPreview, sendBookingTrigger } from "../../server/handlers/email";
import { resetHotelContactCache } from "../../server/lib/hotelContact";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
};

/** The live hotel config — the single source of the times. */
const RUNTIME_HOTEL_CONFIG = {
  address: "J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300",
  frontDeskPhone: "09619863021",
  supportEmail: "sparkinn.reservations@gmail.com",
  checkInTime: "14:00",
  checkOutTime: "11:00"
};

/** The rules with the time TOKENS in them. */
const HOUSE_RULES_WITH_TOKENS =
  "Check-in time is {{checkInTime}}. Check-out time is {{checkOutTime}}. No smoking inside rooms.";

let mockSettings: Record<string, any> = {};
let sentEmails: Array<{ html: string }> = [];

vi.mock("../../server/lib/firebase-admin", () => {
  const collectionFn = vi.fn((name: string) => {
    if (name === "settings") {
      return {
        doc: (id: string) => ({
          get: vi.fn(async () => ({
            exists: !!mockSettings[id],
            data: () => mockSettings[id] || {}
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

vi.mock("../../server/lib/resend", () => ({
  resend: {
    emails: {
      send: vi.fn(async (payload: any) => {
        sentEmails.push(payload);
        return { id: "mock-email-id" };
      })
    }
  }
}));

beforeEach(() => {
  mockSettings = {
    hotelConfig: RUNTIME_HOTEL_CONFIG,
    websiteContent: { houseRules: HOUSE_RULES_WITH_TOKENS }
  };
  sentEmails = [];
  resetHotelContactCache();
  vi.clearAllMocks();
});

async function sendBookingConfirmed() {
  await sendBookingTrigger("booking-confirmed", {
    bookingRef: "BK-2026-0001",
    guestName: "Maria Santos",
    guestEmail: "maria@example.com",
    lookupToken: "abc"
  } as any);
  return sentEmails[sentEmails.length - 1];
}

describe("HC-02 — the guest email resolves the check-in / check-out times", () => {
  it("renders the live times, not the tokens", async () => {
    const email = await sendBookingConfirmed();

    expect(email.html).toContain("Check-in time is 2:00 PM.");
    expect(email.html).toContain("Check-out time is 11:00 AM.");
    expect(email.html).not.toContain("{{checkInTime}}");
    expect(email.html).not.toContain("{{checkOutTime}}");
  });

  it("keeps the rest of the admin's prose verbatim", async () => {
    const email = await sendBookingConfirmed();

    expect(email.html).toContain("No smoking inside rooms.");
  });

  it("renders a rules text with no token unchanged", async () => {
    mockSettings = {
      ...mockSettings,
      websiteContent: { houseRules: "No smoking inside rooms. Pets are not allowed." }
    };

    const email = await sendBookingConfirmed();

    expect(email.html).toContain("No smoking inside rooms. Pets are not allowed.");
  });

  it("does not render the House rules card for a non-house-rules action", async () => {
    await sendBookingTrigger("booking-cancelled", {
      bookingRef: "BK-2026-0001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      cancellationReason: "test",
      lookupToken: "abc"
    } as any);
    const email = sentEmails[sentEmails.length - 1];

    expect(email.html).not.toContain("House rules");
  });
});

describe("HC-02 — the staff preview resolves the times the same way", () => {
  it("shows the resolved time in the preview", async () => {
    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "booking-confirmed", houseRules: HOUSE_RULES_WITH_TOKENS }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const html = String(res.send.mock.calls[0]?.[0] ?? "");
    expect(html).toContain("2:00 PM");
    expect(html).toContain("11:00 AM");
    expect(html).not.toContain("{{checkInTime}}");
  });
});

describe("HC-02 — source-text guards", () => {
  const emailSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email.ts"),
    "utf8"
  );
  const loaderSrc = readFileSync(
    resolve(__dirname, "../../server/lib/hotelContact.ts"),
    "utf8"
  );

  it("the email layer resolves the house-rules times through the shared helper", () => {
    expect(emailSrc).toContain("interpolateHotelTimes");
    expect(emailSrc).toContain("resolveHouseRulesTimes");
    // Both the live send path and the preview path must go through it.
    expect(emailSrc).toMatch(/houseRules = await resolveHouseRulesTimes\(houseRules\);/);
  });

  it("the loader resolves the times from the same settings/hotelConfig document", () => {
    expect(loaderSrc).toContain('collection("settings").doc("hotelConfig")');
    expect(loaderSrc).toContain("resolveHotelTimes");
    expect(loaderSrc).toContain("loadHotelTimes");
  });
});
