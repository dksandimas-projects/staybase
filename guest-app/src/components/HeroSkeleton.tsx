// Neutral skeleton used in place of the static hero fallback
// while `usePublicSiteContent` is loading from Firestore. Keeps
// the page from flashing the deploy-time fallback image (e.g.
// Unsplash) before the admin's custom upload appears — see
// `fix/no-hero-fallback-flash`.
//
// Uses `bg-section-bg` (the brand's warm-neutral section color)
// and a gentle `animate-pulse`. The `<img>` slot is wrapped in a
// container of the same dimensions as the real photo so the
// layout doesn't shift when the image loads.

import type { ReactElement } from "react";

interface HeroSkeletonProps {
  className?: string;
}

export function HeroSkeleton({ className = "absolute inset-0 bg-section-bg animate-pulse" }: HeroSkeletonProps): ReactElement {
  return <div aria-hidden="true" className={className} />;
}
