// heroPrefetch — module-level hero image pre-warmer
//
// The hero photo on every public page is the LCP element. The browser
// can't start downloading it until `usePublicSiteContent` resolves the
// URL from Firestore — which means the download starts hundreds of
// milliseconds after the page is visible (even later on a cold visit
// with an empty localStorage cache).
//
// This module eliminates that delay for the static-fallback case by
// injecting a `<link rel="preload" as="image">` for the *current page's*
// static fallback hero URL at **module evaluation time** — i.e., the
// moment the JS bundle is parsed, before React renders a single element.
//
// When Firestore later resolves:
//   • No custom upload → static fallback is already warm in the browser
//     cache; `HeroImage` renders it instantly.
//   • Admin has a custom URL → `swapHeroPreload()` replaces the static
//     preload tag with one for the real image, so the browser starts
//     fetching the right asset as early as possible.
//
// Only ONE preload tag is ever active (matching the current pathname),
// so we never accidentally preload all four hero images on a single page.

import {
  homepageHeroImage,
  aboutHeroImage,
  corporateHeroImage,
  rewardsHeroImage
} from "../data/homepage";
import { buildHeroSrcSet, injectPreload, removePreload } from "../components/HeroImage";

// Map each public route prefix to its static fallback URL.
const ROUTE_HERO_MAP: Array<{ prefix: string; url: string }> = [
  { prefix: "/about",     url: aboutHeroImage     },
  { prefix: "/corporate", url: corporateHeroImage  },
  { prefix: "/rewards",   url: rewardsHeroImage    },
  { prefix: "/",          url: homepageHeroImage   } // must be last (catch-all)
];

function currentHero(): { url: string } | undefined {
  if (typeof window === "undefined") return undefined;
  const path = window.location.pathname;
  return ROUTE_HERO_MAP.find((entry) => path.startsWith(entry.prefix));
}

// ─── Module initializer ──────────────────────────────────────────────────────
// Runs once when this module is first imported (i.e. before React mounts).
// Injects a preload for the static fallback so the browser queues the
// download in parallel with the Firestore fetch.
const initialHero = currentHero();
if (initialHero) {
  const srcSet = buildHeroSrcSet(initialHero.url);
  injectPreload(initialHero.url, srcSet);
}

// ─── swapHeroPreload ──────────────────────────────────────────────────────────
// Called by `usePublicSiteContent` once Firestore resolves. If the admin
// has set a custom hero URL that differs from the static fallback, we
// replace the existing preload tag so the browser fetches the right image.
//
// If the URL hasn't changed (no custom upload), the existing tag is
// correct and we leave it untouched.
export function swapHeroPreload(resolvedUrl: string): void {
  if (typeof document === "undefined") return;
  const hero = currentHero();
  if (!hero) return;
  // Nothing to swap if the resolved URL matches the static fallback
  // we already preloaded at module init time.
  if (resolvedUrl === hero.url) return;
  // Replace the stale static preload with one for the custom URL.
  removePreload();
  const srcSet = buildHeroSrcSet(resolvedUrl);
  injectPreload(resolvedUrl, srcSet);
}
