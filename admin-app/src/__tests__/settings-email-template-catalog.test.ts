import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsSrc = readFileSync(resolve(__dirname, "../pages/SettingsPage.tsx"), "utf8");
const emailHandlerSrc = readFileSync(resolve(__dirname, "../../../guest-app/server/handlers/email.ts"), "utf8");

const expectedTemplates = [
  "booking-submitted",
  "payment-confirmed",
  "payment-rejected",
  "booking-confirmed",
  "checkin-reminder",
  "booking-rescheduled",
  "booking-cancelled",
  "discount-rejected",
  "corporate-inquiry",
  "corporate-inquiry-confirmation",
  "contact-inquiry",
  "contact-confirmation",
  "early-checkin-request",
  "early-checkin-resolve",
  "voucher-issued",
  "store-order-placed",
  "store-order-confirmed",
  "store-order-out-for-delivery",
  "store-order-delivered",
  "store-order-cancelled",
  "staff-new-booking",
  "staff-new-payment"
];

describe("Settings email-template catalog", () => {
  it("lists every server-side email template in Email Configuration", () => {
    for (const template of expectedTemplates) {
      expect(settingsSrc, `missing Settings catalog entry for ${template}`).toContain(`action: "${template}"`);
      expect(emailHandlerSrc, `missing preview handler for ${template}`).toContain(`case "${template}"`);
    }
  });

  it("groups the expanded catalog and keeps preview controls touch accessible", () => {
    expect(settingsSrc).toContain("Bookings & payments");
    expect(settingsSrc).toContain("Requests & promotions");
    expect(settingsSrc).toContain("In-room store");
    expect(settingsSrc).toContain("Staff alerts");
    expect(settingsSrc).toMatch(/h-11 w-11[\s\S]{0,500}aria-label=\{`Preview/);
  });
});
