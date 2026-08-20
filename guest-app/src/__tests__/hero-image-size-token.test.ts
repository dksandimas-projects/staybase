import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for #1 (bug verification 2026-08-19):
// the Google image-serving `=wN` size token was missing from
// the static-fallback URLs in `guest-app/src/data/homepage.ts`,
// causing the `buildHeroSrcSet` helper in
// `guest-app/src/components/HeroImage.tsx:65` to bail out (the
// regex `=[sw]\d+$` returned false on URLs without a size
// token) and the responsive `srcset` to never be emitted —
// every viewport downloaded the full-size original.

describe("homepage.ts — Google image-serving URLs end with =wN (decision #222, bug #1)", () => {
  const homepage = readFileSync(
    resolve(__dirname, "../../src/data/homepage.ts"),
    "utf8"
  );

  it("homepageHeroImage URL ends with =w1920", () => {
    // The regex `=[sw]\d+$` is what `buildHeroSrcSet` uses (line
    // 65 of HeroImage.tsx). If this assertion breaks, the srcset
    // is gone and the browser downloads the full-size image on
    // every viewport — the user-visible "background images load
    // with visible delay" bug.
    const m = homepage.match(/homepageHeroImage\s*=\s*["']([^"']+)["']/);
    expect(m).not.toBeNull();
    const url = m![1];
    expect(url).toMatch(/=w\d+$/);
  });

  it("rewardsHeroImage URL ends with =w1920", () => {
    // Same reasoning as above for the rewards hero page.
    const m = homepage.match(/rewardsHeroImage\s*=\s*["']([^"']+)["']/);
    expect(m).not.toBeNull();
    const url = m![1];
    expect(url).toMatch(/=w\d+$/);
  });

  it("aboutHeroImage + corporateHeroImage (Unsplash) already carry w= params", () => {
    // The Unsplash URLs ship with `w=1600` baked in (the operator-
    // facing convention is "use Unsplash with explicit w"). The
    // existing `buildHeroSrcSet` Unsplash branch
    // (`HeroImage.tsx:48-52`) strips that param before emitting
    // the responsive set — so these two were never broken.
    // Pin so a future refactor that drops the `w=` param is
    // caught at the source-text level.
    expect(homepage).toMatch(
      /aboutHeroImage\s*=\s*["'][^"']*images\.unsplash\.com[^"']*w=\d+/
    );
    expect(homepage).toMatch(
      /corporateHeroImage\s*=\s*["'][^"']*images\.unsplash\.com[^"']*w=\d+/
    );
  });
});

describe("HeroImage.tsx — buildHeroSrcSet guards (no client regression on the regex)", () => {
  // The srcset helper REQUIRES the URL base to end with `=[sw]\d+$`.
  // If a future refactor relaxes that guard (e.g. drops the
  // token-presence check), the homepage + rewards fallbacks will
  // get appended `=w640` / `=w1080` / `=w1920` against an AI-generated
  // content URL that returns 404 for those transforms. Pin the
  // bail-out behaviour so any loosening is intentional.
  const heroImage = readFileSync(
    resolve(__dirname, "../../src/components/HeroImage.tsx"),
    "utf8"
  );

  it("buildHeroSrcSet bails out when the googleusercontent.com base has no size token", () => {
    // The exact regex the helper uses is `/=[sw]\\d+$/`. If this
    // disappears, the homepage/rewards fallbacks 404 in Chrome.
    expect(heroImage).toMatch(/\/=\[sw\]\\d\+\$\//);
  });
});
