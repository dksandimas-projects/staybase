// Per HC-02 (decision #329, 2026-11-20): the hotel's CHECK-IN /
// CHECK-OUT TIMES have ONE source of truth — `settings/hotelConfig`.
//
// The house rules (Settings → Legal) are free prose the admin typed.
// They quoted the times by hand, which meant the guest email and the
// registration PDF could quote a time the booking flow contradicted.
//
// This suite pins the ADMIN side of that fix:
//   1. the email-preview request sends the house rules, so the
//      preview is not missing the card the guest actually receives;
//   2. the registration PDF resolves the time tokens;
//   3. the Legal-tab helper explains the tokens and shows their live
//      values.
//
// Source-pattern test — locks the wiring so it cannot silently
// regress.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);
const bookingsSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

describe("HC-02 — the admin sends the house rules with the email preview", () => {
  it("the preview request body carries houseRules", () => {
    // Without this the preview renders an email that is MISSING the
    // House rules card, while the real email carries it.
    expect(settingsSrc).toMatch(
      /body:\s*JSON\.stringify\(\{\s*template:\s*action,\s*houseRules:/
    );
    expect(settingsSrc).toContain("websiteContent?.houseRules");
  });

  it("the preview sends the SAVED house rules, not the unsaved textarea state", () => {
    // The preview must reflect what is persisted (what the guest will
    // actually receive), not a half-typed draft. Scope the match to the
    // preview request so it cannot latch onto another JSON.stringify.
    const previewBlock =
      settingsSrc.match(
        /\/api\/email\/preview[\s\S]{0,1200}?body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/,
      )?.[1] || "";
    expect(previewBlock).not.toBe("");
    expect(previewBlock).toMatch(/houseRules:\s*websiteContent\?\.houseRules/);
    // The bare `houseRules` state is the unsaved textarea draft.
    expect(previewBlock).not.toMatch(/houseRules:\s*houseRules\b/);
    expect(previewBlock).not.toMatch(/houseRules\s*,/);
  });
});

describe("HC-02 — the registration PDF resolves the time tokens", () => {
  it("the PDF house rules go through the shared interpolation", () => {
    expect(bookingsSrc).toContain("interpolateHotelTimes");
    expect(bookingsSrc).toContain("resolveHotelTimes");
  });

  it("the PDF resolves the times from the live hotelConfig", () => {
    expect(bookingsSrc).toMatch(
      /interpolateHotelTimes\(\s*websiteContent\?\.houseRules \|\| "",\s*resolveHotelTimes\(hotelConfig, config, config\.locale\)\s*\)/
    );
  });
});

describe("HC-02 — the Legal tab explains the tokens", () => {
  it("the helper mentions both tokens", () => {
    expect(settingsSrc).toContain("{{checkInTime}}");
    expect(settingsSrc).toContain("{{checkOutTime}}");
  });

  it("the helper shows the LIVE resolved values", () => {
    expect(settingsSrc).toContain("resolveHotelTimes");
    expect(settingsSrc).toMatch(/houseRulesTimes\.checkInTime/);
    expect(settingsSrc).toMatch(/houseRulesTimes\.checkOutTime/);
  });

  it("the helper no longer claims the rules are only for the printed form", () => {
    // The stale copy said "Used in the guest registration PDF at
    // check-in" — the rules have ridden in every guest email since
    // ECE-01 / ECE-02.
    expect(settingsSrc).not.toMatch(
      /Used in the guest registration PDF at check-in\. If left blank, the field is omitted from the printed form\./
    );
  });
});
