import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("WRV — weekend rate visibility on Step 1 room cards", () => {
  it("replaces the roomLines.length > 1 gate with a non-regular-line gate so a single-source weekend stay renders the panel", () => {
    // The historical bug: a Saturday→Sunday weekend-only stay produces a
    // single rate line, and the old gate `roomLines.length > 1` hid the
    // panel — exactly the case the headline "From {base rate}" misled the
    // guest about. WRV-01 changes the gate to "any non-regular line".
    expect(bookingPageSrc).not.toMatch(/const hasMixedRates\s*=\s*typeRoomBreakdown\.roomLines\.length\s*>\s*1/);
    expect(bookingPageSrc).toMatch(/const hasNonRegularRate\s*=\s*roomLines\.some\(\s*\(line\)\s*=>\s*line\.source\s*!==\s*"regular"\s*\)/);
  });

  it("renders a single-line rate panel (no 'mixed nightly rates' heading) when every night uses the same non-regular source", () => {
    // The old "mixed nightly rates" heading was false for a single-source
    // stay. The single line item itself is the panel — it carries the
    // source label, nights × rate, and the subtotal, so the headline rate
    // stops being unexplained.
    expect(bookingPageSrc).toMatch(/isSingleSource\s*\?\s*\(/);
    expect(bookingPageSrc).toMatch(/roomLines\[0\]\.label\}:\s*\{roomLines\[0\]\.nights\}\s*x\s*\{formatPrice\(roomLines\[0\]\.nightlyRate\)\}/);
    expect(bookingPageSrc).toMatch(/\{formatPrice\(roomLines\[0\]\.subtotal\)\}/);
  });

  it("keeps the existing 'mixed nightly rates' heading + per-source line list for multi-source stays", () => {
    // Mixed stays (regular + weekend, weekend + seasonal, etc.) are
    // unaffected by WRV-01 — the panel still shows the existing heading
    // and the line list.
    expect(bookingPageSrc).toMatch(/This stay uses mixed nightly rates\./);
    expect(bookingPageSrc).toMatch(/\{roomLines\.map\(\(line, lineIndex\)\s*=>\s*\(/);
  });

  it("gates the entire panel on hasNonRegularRate, so a fully regular stay renders nothing", () => {
    // Fully regular stays have no non-regular line — the panel must not
    // render at all. The "From" headline hedges that case, and the option
    // labels show the base rate with no "From" prefix.
    expect(bookingPageSrc).toMatch(/\{hasNonRegularRate\s*\?\s*\(/);
  });

  it("WRV-02 — single-source stays show the source's nightly amount on Room Only (no 'From' prefix)", () => {
    // The single source's nightly rate replaces the base rate, so the
    // option price matches the line item and the total. No "From" prefix
    // for a one-source stay.
    expect(bookingPageSrc).toMatch(/const singleSourceRate\s*=\s*isSingleSource\s*\?\s*roomLines\[0\]\.nightlyRate\s*:\s*null/);
    expect(bookingPageSrc).toMatch(/const optionNightlyRate\s*=\s*singleSourceRate\s*\?\?\s*typePricePerNight/);
    expect(bookingPageSrc).toMatch(/const optionRatePrefix\s*=\s*isMultiSource\s*\?\s*"From "\s*:\s*""/);
    expect(bookingPageSrc).toMatch(/priceLabel=\{`\$\{optionRatePrefix\}\$\{formatPrice\(optionNightlyRate\)\} \/ night`\}/);
  });

  it("WRV-02 — Room + Breakfast also uses the single source's nightly amount when applicable", () => {
    // The breakfast option's nightly amount is room rate + breakfast
    // contribution. The room rate portion follows the WRV-02 rule.
    expect(bookingPageSrc).toMatch(/priceLabel=\{`\$\{optionRatePrefix\}\$\{formatPrice\(optionNightlyRate\s*\+\s*liveBreakfastRate\s*\*\s*effectiveBreakfastOccupancy\)\} \/ night`\}/);
  });

  it("WRV-02 — multi-source stays prefix the option price with 'From' (the headline hedges; the breakdown + total reconcile)", () => {
    // The `optionRatePrefix` is "From " iff `isMultiSource` (i.e. the
    // breakdown splits into > 1 line). The option price for a multi-source
    // stay reads as a floor; the breakdown below it shows the actual mix.
    expect(bookingPageSrc).toMatch(/optionRatePrefix\}\$\{formatPrice\(optionNightlyRate\)/);
  });
});
