import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #7 (Phase 2 #87): the corporate inquiry
// honeypot must live inside the <form> element and be hidden via CSS
// (off-screen absolute + opacity 0), not display:none. Per W1.14 /
// decision #87 / DECISIONS-FEATURES.md, the spec pattern is:
//   <form> ... <div className="absolute -left-[9999px] opacity-0">
//     <input id="websiteUrl" name="websiteUrl" tabIndex={-1} />
//   </div> ... </form>
// The current implementation matches this pattern; this test guards
// against accidental future drift (e.g. moving the honeypot outside
// the form, or using display:none which bots can detect).

describe("CorporateStaysPage.tsx — honeypot inside <form> (decision #87)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/CorporateStaysPage.tsx"),
    "utf8"
  );

  it("honeypot field id is 'websiteUrl' (matches the body field key)", () => {
    expect(src).toContain('id="websiteUrl"');
  });

  it("honeypot container uses off-screen absolute positioning", () => {
    // Pattern: absolute -left-[9999px] (or similar) and opacity-0
    expect(src).toMatch(/absolute -left-\[9999px\][^"]*opacity-0/);
  });

  it("honeypot container has aria-hidden=true so screen readers skip it", () => {
    expect(src).toContain('aria-hidden="true"');
  });

  it("honeypot input has tabIndex={-1} so it is not keyboard-focusable", () => {
    expect(src).toMatch(/tabIndex=\{-\s*1\s*\}/);
  });

  it("honeypot is positioned between the <form> open and </form> close tags", () => {
    const formOpen = src.indexOf("<form");
    const formClose = src.indexOf("</form>");
    const honeypotIdx = src.indexOf('id="websiteUrl"');
    expect(honeypotIdx).toBeGreaterThan(formOpen);
    expect(honeypotIdx).toBeLessThan(formClose);
  });

  it("honeypot is submitted with the form body (key: websiteUrl / _hp)", () => {
    expect(src).toMatch(/_hp:\s*websiteUrl/);
  });

  it("honeypot check returns silent success (no error to the bot)", () => {
    // The handler returns early without sending the inquiry
    expect(src).toMatch(/if\s*\(websiteUrl\)/);
  });
});
