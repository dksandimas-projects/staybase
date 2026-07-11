import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handler = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const router = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
const bookingPage = readFileSync(resolve(__dirname, "../../src/pages/BookingPage.tsx"), "utf8");

describe("discount controls", () => {
  it("enforces the online Senior/PWD setting on the server", () => {
    expect(handler).toMatch(/hotelConfig\.seniorPwdOnlineEnabled === false/);
    expect(handler).toMatch(/Please claim the discount at the front desk/);
  });

  it("keeps staff repricing authenticated and transactional", () => {
    expect(router).toMatch(/action === "apply-discount"[\s\S]+?authenticateStaff/);
    expect(handler).toMatch(/handleApplyBookingDiscount[\s\S]+?runTransaction/);
    expect(handler).toMatch(/transaction\.update\(voucherRef, \{ usageCount:/);
    expect(handler).toMatch(/discountVerifiedBy: discountType \? staffUid : null/);
  });

  it("hides and clears online claims when disabled", () => {
    expect(bookingPage).toMatch(/seniorPwdOnlineEnabled = hotelConfig\?\.seniorPwdOnlineEnabled !== false/);
    expect(bookingPage).toMatch(/setDiscountType\("none"\)/);
    expect(bookingPage).toMatch(/Eligible guests may present a valid ID at check-in/);
  });
});
