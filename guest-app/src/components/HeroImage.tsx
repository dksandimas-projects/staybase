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

function injectPreload(src: string): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = src;
  link.setAttribute("fetchpriority", "high");
  link.dataset.heroImagePreload = "true";
  document.head.appendChild(link);
  return link;
}

function removePreload() {
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
  srcSet,
  sizes,
  priority = true
}: HeroImageProps): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Tracks the last `src` we injected a preload tag for, so we can
  // remove the stale tag when the URL changes (e.g. admin swaps the
  // hero photo) without thrashing the head on every render.
  const preloadedSrcRef = useRef<string>("");

  useEffect(() => {
    if (!priority || !src) return;
    if (preloadedSrcRef.current === src) return;
    removePreload();
    injectPreload(src);
    preloadedSrcRef.current = src;
    return () => {
      if (preloadedSrcRef.current === src) {
        removePreload();
        preloadedSrcRef.current = "";
      }
    };
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
        srcSet={srcSet}
        sizes={sizes}
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

