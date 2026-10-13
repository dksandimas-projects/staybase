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
    // Per owner request 2026-10-13 (decision #231): when the
    // online Senior/PWD path is off, the WHOLE "Discount
    // Options" card is dropped — heading, selector, upload,
    // and the old "claims unavailable" note. The heading must
    // therefore render only inside the flag gate.
    expect(bookingPage).toMatch(
      /\{seniorPwdOnlineEnabled && <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6">\s*<h3 className="text-lg font-semibold text-gray-950">Discount Options<\/h3>/
    );
    // Negative guards: the disabled-state note copy must not
    // come back (it told guests to claim at check-in; the
    // front-desk path still honors RA 9994, so the guest-facing
    // flow simply says nothing).
    expect(bookingPage).not.toMatch(/online claims are currently unavailable/);
    expect(bookingPage).not.toMatch(/Eligible guests may present a valid ID at check-in/);
  });
});
