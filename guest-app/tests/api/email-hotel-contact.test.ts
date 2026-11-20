// Per HC-01 (decision #328, 2026-11-20): the guest EMAILS must show
// the hotel's CONTACT details from the ONE source of truth —
// `settings/hotelConfig`, the document the admin edits in
// Settings → Hotel Info.
//
// THE DEFECT
// ----------
// `email.ts` imported `hotel.config.ts` directly and rendered the
// deploy-time address / front-desk phone / support email in the
// footer of EVERY guest email (plus the receipt-PDF header and the
// Resend `replyTo`). The guest SITE already read the runtime
// document. So the site and the email disagreed: the hotel fixed its
// phone number in the admin app, the website showed the new number,
// and the confirmation email still showed the old one.
//
// THIS SUITE PINS
//   1. the email footer renders the RUNTIME values;
//   2. the `replyTo` is the runtime support email;
//   3. the deploy-time config is the FALLBACK (a missing / empty
//      runtime document must not blank the footer);
//   4. a Firestore read failure must not break the email;
//   5. `email.ts` no longer reads the contact fields off
//      `hotel.config.ts` directly (a source-text guard, so a future
//      refactor cannot re-introduce the split).

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

/** The runtime document — what production actually holds. */
const RUNTIME_HOTEL_CONFIG = {
  address: "J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300",
  frontDeskPhone: "09619863021",
  supportEmail: "sparkinn.reservations@gmail.com",
  dpoEmail: ""
};

/** The deploy-time placeholders that used to leak into every email. */
const STALE_DEPLOY_TIME = {
  address: "J. Borja St, Tagbilaran City, Bohol, 6300",
  frontDeskPhone: "+63-38-000-0000",
  supportEmail: "sparkinn.dev@gmail.com"
};

let mockSettings: Record<string, any> = {};
let forceSettingsThrow = false;
let sentEmails: Array<{ to: string; subject: string; html: string; replyTo?: string }> = [];

vi.mock("../../server/lib/firebase-admin", () => {
  const collectionFn = vi.fn((name: string) => {
    if (name === "settings") {
      return {
        doc: (id: string) => ({
          get: vi.fn(async () => {
            if (forceSettingsThrow) throw new Error("Firestore unavailable");
            return { exists: !!mockSettings[id], data: () => mockSettings[id] || {} };
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
  mockSettings = {};
  forceSettingsThrow = false;
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

describe("HC-01 — the guest email footer shows the RUNTIME contact details", () => {
  it("renders the runtime address, front-desk phone and support email", async () => {
    mockSettings = { hotelConfig: RUNTIME_HOTEL_CONFIG };

    const email = await sendBookingConfirmed();

    expect(email.html).toContain("J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300");
    expect(email.html).toContain("09619863021");
    expect(email.html).toContain("sparkinn.reservations@gmail.com");
  });

  it("does NOT render the deploy-time placeholders", async () => {
    mockSettings = { hotelConfig: RUNTIME_HOTEL_CONFIG };

    const email = await sendBookingConfirmed();

    expect(email.html).not.toContain(STALE_DEPLOY_TIME.frontDeskPhone);
    expect(email.html).not.toContain(STALE_DEPLOY_TIME.supportEmail);
  });

  it("sets the Resend replyTo to the runtime support email", async () => {
    mockSettings = { hotelConfig: RUNTIME_HOTEL_CONFIG };

    const email = await sendBookingConfirmed();

    expect(email.replyTo).toBe("sparkinn.reservations@gmail.com");
  });
});

describe("HC-01 — the deploy-time config is the FALLBACK", () => {
  it("falls back to hotel.config.ts when the runtime document is missing", async () => {
    mockSettings = {};

    const email = await sendBookingConfirmed();

    // The deploy-time config still carries the OLD placeholder — which
    // is exactly why the runtime document has to be the source of
    // truth. The fallback keeps the email renderable; it is NOT where
    // the real numbers come from.
    expect(email.html).toContain(STALE_DEPLOY_TIME.frontDeskPhone);
    expect(email.html).toContain(STALE_DEPLOY_TIME.supportEmail);
  });

  it("falls back per field when the runtime document has a blank value", async () => {
    mockSettings = {
      hotelConfig: { ...RUNTIME_HOTEL_CONFIG, frontDeskPhone: "" }
    };

    const email = await sendBookingConfirmed();

    // The runtime address still wins; the blank phone falls back.
    expect(email.html).toContain("J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300");
    expect(email.html).toContain(STALE_DEPLOY_TIME.frontDeskPhone);
  });

  it("does not break the email when the Firestore read fails", async () => {
    forceSettingsThrow = true;

    await expect(sendBookingConfirmed()).resolves.not.toThrow();
    expect(sentEmails.length).toBe(1);
  });
});

describe("HC-01 — the email preview renders the same contact details", () => {
  it("shows the runtime address / phone / support email in the preview", async () => {
    mockSettings = { hotelConfig: RUNTIME_HOTEL_CONFIG };

    const req: any = {
      method: "POST",
      staff: { success: true },
      body: { template: "booking-confirmed" }
    };
    const res = mockResponse();
    await handleEmailPreview(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const html = String(res.send.mock.calls[0]?.[0] ?? "");
    expect(html).toContain("J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300");
    expect(html).toContain("09619863021");
    expect(html).not.toContain("+63-38-000-0000");
  });
});

describe("HC-01 — source-text guards", () => {
  const emailSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/email.ts"),
    "utf8"
  );
  const loaderSrc = readFileSync(
    resolve(__dirname, "../../server/lib/hotelContact.ts"),
    "utf8"
  );

  it("the email handler reads the contact through the shared loader, not hotel.config.ts", () => {
    expect(emailSrc).toContain('from "../lib/hotelContact"');
    expect(emailSrc).not.toMatch(/config\.frontDeskPhone/);
    expect(emailSrc).not.toMatch(/config\.dpoEmail/);
    expect(emailSrc).not.toMatch(/config\.address\b/);
    // `config.supportEmail` may survive in EXACTLY two places: the
    // Resend SENDER identity (`FROM_ADDRESS`) and the staff-alert
    // recipient (`ADMIN_EMAIL`). Both are env-driven DEPLOY-TIME
    // IDENTITIES, not the guest-visible contact details — they are
    // `RESEND_FROM_EMAIL` / `RESEND_ADMIN_EMAIL` in production.
    const supportEmailReads = emailSrc.match(/config\.supportEmail/g) || [];
    expect(supportEmailReads.length).toBe(2);
    expect(emailSrc).toMatch(/const FROM_ADDRESS = process\.env\.RESEND_FROM_EMAIL \|\| config\.supportEmail;/);
    expect(emailSrc).toMatch(/const ADMIN_EMAIL = process\.env\.RESEND_ADMIN_EMAIL \|\| config\.supportEmail;/);
  });

  it("the loader reads settings/hotelConfig and resolves through the shared resolver", () => {
    expect(loaderSrc).toContain('collection("settings").doc("hotelConfig")');
    expect(loaderSrc).toContain("resolveHotelContact");
    // The legacy fields must never be read.
    expect(loaderSrc).not.toMatch(/contactEmail|contactPhone/);
  });

  it("every email trigger resolves the contact before it renders", () => {
    const triggers = emailSrc.match(
      /export async function send\w+Trigger\([\s\S]*?\n\}/g
    ) || [];
    expect(triggers.length).toBeGreaterThan(8);
    for (const trigger of triggers) {
      // Each trigger either loads the contact itself or delegates to a
      // trigger that does. The three that only forward to another
      // trigger are exempt.
      if (/sendBookingTrigger|sendBookingConfirmedWithBalanceTrigger/.test(trigger)) continue;
      expect(
        trigger,
        "an email trigger must resolve the hotel contact before rendering"
      ).toMatch(/loadHotelContact\(\)/);
    }
  });
});
