export function brandAsset(fileName: string) {
  return `/brand/${fileName}`;
}

// Returns the brand-aware logo URL. When the admin has uploaded a
// custom override (non-empty string from
// `settings/websiteContent.branding.*`), it wins; otherwise we fall
// back to the deploy-time static file shipped in `public/brand/` via
// `hotel.config.ts`. Used by the Navbar (over-hero vs scrolled) and
// the Footer. Keeps the white-label pattern intact: clients that
// never touch Branding keep their deploy-time logos.
export function resolveLogo(overrideUrl: string | undefined, fallbackFileName: string) {
  if (overrideUrl && overrideUrl.length > 0) return overrideUrl;
  return brandAsset(fallbackFileName);
}
