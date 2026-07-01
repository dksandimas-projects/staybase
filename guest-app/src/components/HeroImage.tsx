// Reusable hero image wrapper used by every public page (home, about,
// corporate, rewards). The hero is the LCP element on these pages, so
// the wrapper:
//
//   1. injects a `<link rel="preload" as="image">` tag in `<head>` as
//      soon as the resolved URL is known, so the browser starts the
//      download in parallel with the JS bundle and CSS — not after
//      the React tree has mounted. Removed on unmount or src change.
//   2. marks the `<img>` with `loading="eager"`, `decoding="async"`,
//      and `fetchPriority="high"` so the browser treats it as the
//      page's priority image. `decoding="async"` keeps the decode
//      step off the main thread.
//   3. shows a tiny LQIP (low-quality image placeholder) underneath
//      the real image — a base64 data URL blurred via CSS — so the
//      photo "develops" into focus instead of popping in. The LQIP
//      also holds the layout steady (no shift) while the real image
//      loads.
//   4. fades the real image in on `onLoad` so the transition feels
//      intentional, not a flash.
//
// When `priority={false}` is passed, the wrapper drops out of LCP
// mode (no preload tag, `loading="lazy"`, `fetchPriority="auto"`)
// and can be reused for below-the-fold marketing imagery later.

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";

// ---------------------------------------------------------------------------
// CDN-aware srcset builder
// ---------------------------------------------------------------------------
// Auto-detects the image host from the URL and returns a `srcset` string
// that lets the browser pick the smallest image that fills the viewport.
//
//   • Unsplash  (images.unsplash.com)       — append `&w=N` query param
//   • Google/Firebase (*.googleusercontent.com | firebasestorage.googleapis.com)
//                                           — insert `=wN` suffix before `?`
//   • Everything else                       — returns undefined (no srcset)
//
// Widths 640 / 1080 / 1920 cover mobile, tablet, and full desktop.
// The caller always passes the original `src` as the 1920w candidate so
// an unsupported CDN still has a valid single-src fallback.
export function buildHeroSrcSet(src: string): string | undefined {
  if (!src) return undefined;
  const WIDTHS = [640, 1080, 1920];
  try {
    // ── Unsplash ────────────────────────────────────────────────────────────
    // Strip any existing `w=` param before appending so we don't produce
    // duplicate params (e.g. `?w=1600&w=640`).
    if (src.includes("images.unsplash.com")) {
      const base = src.replace(/[&?]w=\d+/, "");
      const sep = base.includes("?") ? "&" : "?";
      return WIDTHS.map((w) => `${base}${sep}w=${w} ${w}w`).join(", ");
    }
    // ── Google image-serving (lh3.googleusercontent.com, etc.) ─────────────
    // The `=sN` / `=wN` URL suffix is ONLY supported by Google's image-
    // serving infrastructure for standard Google Photos / Drive / Storage
    // thumbnails. AI-generated content URLs (aida-public, etc.) and raw
    // Firebase Storage download URLs do NOT support this transform — so
    // we only apply it when the URL already carries a recognised size
    // token, which confirms the host is using the image-serving stack.
    if (src.includes("googleusercontent.com")) {
      const [base, qs] = src.split("?");
      const suffix = qs ? `?${qs}` : "";
      // Bail out if there's no existing size token; appending =wN to an
      // unsupported URL returns a 404 and breaks the image entirely.
      if (!/=[sw]\d+$/.test(base)) return undefined;
      const stripped = base.replace(/=[sw]\d+$/, "");
      return WIDTHS.map((w) => `${stripped}=w${w}${suffix} ${w}w`).join(", ");
    }
    // ── Firebase Storage ────────────────────────────────────────────────────
    // Firebase Storage (firebasestorage.googleapis.com) uses signed download
    // URLs with `?alt=media&token=...`. It does NOT natively support
    // URL-based image resizing — that requires the Resize Images extension.
    // We deliberately skip it to avoid generating broken srcset candidates.
  } catch {
    // URL parsing failure — fall back to no srcset.
  }
  return undefined;
}



export interface HeroImageProps {
  src: string;
  alt: string;
  className?: string;
  // Tiny base64 / data URL preview shown underneath the real image.
  // Should be the same aspect ratio as `src` so the layout doesn't
  // shift when the image swaps in. Recommended: a few-KB blurred
  // JPEG or an inline SVG. Optional — when omitted, the LQIP layer
  // is skipped and only the fade-in plays.
  placeholder?: string;
  // Optional responsive hints. When provided, the wrapper emits
  // `srcSet` and `sizes` on the `<img>`. The CDN must support the
  // URL pattern used (Unsplash `?w=`, Firebase Storage `=w`, etc.).
  srcSet?: string;
  sizes?: string;
  // `true` (default) — this is the LCP image. Eager-load, high
  // priority, inject `<link rel=preload>`.
  // `false` — lazy-load, normal priority, no preload. For reuse on
  // non-LCP imagery.
  priority?: boolean;
}

export function injectPreload(src: string, resolvedSrcSet?: string): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = src;
  link.setAttribute("fetchpriority", "high");
  // Responsive preload: tell the browser which srcset variant to
  // download at this viewport width so it matches what the `<img>`
  // will request. Without this the browser preloads the full `src`
  // even when a smaller srcset candidate would be used.
  if (resolvedSrcSet) {
    link.setAttribute("imagesrcset", resolvedSrcSet);
    link.setAttribute("imagesizes", "100vw");
  }
  link.dataset.heroImagePreload = "true";
  document.head.appendChild(link);
  return link;
}

export function removePreload() {
  if (typeof document === "undefined") return;
  const existing = document.querySelectorAll<HTMLLinkElement>(
    `link[data-hero-image-preload="true"]`
  );
  existing.forEach((node) => node.remove());
}

export function HeroImage({
  src,
  alt,
  className = "absolute inset-0 h-full w-full object-cover",
  placeholder,
  srcSet: srcSetProp,
  sizes: sizesProp,
  priority = true
}: HeroImageProps): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Tracks the last `src` we injected a preload tag for, so we can
  // remove the stale tag when the URL changes (e.g. admin swaps the
  // hero photo) without thrashing the head on every render.
  const preloadedSrcRef = useRef<string>("");

  // Auto-build a responsive srcset from the CDN URL when the caller
  // has not provided one. Falls back to undefined for unrecognised
  // hosts, in which case the browser fetches `src` as-is.
  const resolvedSrcSet = srcSetProp ?? buildHeroSrcSet(src);
  // Hero images always span 100vw. The caller can override for
  // narrower usages (e.g. split-panel layouts).
  const resolvedSizes = sizesProp ?? (resolvedSrcSet ? "100vw" : undefined);

  useEffect(() => {
    if (!priority || !src) return;
    if (preloadedSrcRef.current === src) return;
    removePreload();
    injectPreload(src, resolvedSrcSet);
    preloadedSrcRef.current = src;
    return () => {
      if (preloadedSrcRef.current === src) {
        removePreload();
        preloadedSrcRef.current = "";
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priority, src]);

  // Check if image is already complete when mounting or when src changes,
  // otherwise reset loaded state so the fade-in plays.
  useEffect(() => {
    if (imgRef.current?.complete) {
      setLoaded(true);
    } else {
      setLoaded(false);
    }
  }, [src]);

  const handleRef = (node: HTMLImageElement | null) => {
    imgRef.current = node;
    if (node?.complete) {
      setLoaded(true);
    }
  };

  const lqipStyle: CSSProperties | undefined = placeholder
    ? {
        backgroundImage: `url("${placeholder}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        filter: "blur(24px)",
        transform: "scale(1.1)"
      }
    : undefined;

  return (
    <>
      {placeholder ? (
        <div aria-hidden="true" className={className} style={lqipStyle} />
      ) : null}
      <img
        ref={handleRef}
        src={src}
        srcSet={resolvedSrcSet}
        sizes={resolvedSizes}
        alt={alt}
        // LCP images must be eager + high priority; the preload tag
        // in <head> (see useEffect above) does the heavy lifting.
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => setLoaded(true)}
        className={className}
        style={{
          opacity: loaded ? 1 : 0,
          transition: "opacity 420ms ease-out"
        }}
      />
    </>
  );
}

