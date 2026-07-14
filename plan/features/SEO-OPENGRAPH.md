# SEO & Open Graph — Feature Spec

> Status: 🔄 Spec — not yet implemented (base client-side meta exists; social/crawler layer missing)
> Owner MD for: search indexability (Google / Bing / Yahoo) + link-preview cards (Facebook / Messenger / WhatsApp / Viber / X / LinkedIn / iMessage)
> Read bundle: this file + `plan/docs/FRONTEND.md` + `plan/docs/WHITE-LABEL.md` + `plan/docs/GOTCHAS.md`

---

## Goal

1. **Searchable** — Google, Bing, and Yahoo can discover, crawl, and index every public guest-app page, with correct per-page titles/descriptions and a machine-readable business profile.
2. **Shareable** — a pasted link to any public page renders a rich preview card (title, description, 1200×630 image) in Facebook, Messenger, WhatsApp, Viber, X, LinkedIn, Slack, and iMessage.

Guest app only. The admin app (`admin.sparkinnbohol.com`) must stay **fully `noindex`** — it is staff-only.

---

## Current state (what already exists)

| Piece | Where | Status |
|---|---|---|
| Base `<meta>` (description, OG, Twitter card) | `guest-app/index.html` | ✅ present |
| Build-time meta transform from config | `guest-app/vite.config.ts` (`indexHtmlTransformPlugin`) | ✅ substitutes `brandName` / `domain` / `ogImage` |
| Per-route dynamic meta (title, desc, canonical, robots, OG, Twitter) | `guest-app/src/components/PageMeta.tsx` + `App.tsx` `WithMeta` | ✅ client-side (`useEffect`) |
| Config knobs (`domain`, `ogImage`, `address`, `locale`, social URLs) | `hotel.config.ts` | ✅ present |
| Validated SEO editor + controlled publish | `admin-app` Settings → SEO & Search | ✅ runtime draft + build-time published snapshot |

Published SEO values use a hybrid source model: stable white-label identity and domain fields stay in `hotel.config.ts`; SEO copy and operational hotel details are stored as a validated `settings/seo.published` snapshot. The social preview image is uploaded with a live preview from Settings, compressed to fit within 1200×630, and stored publicly under `assets/seo/og-image/`. Publishing is admin-only and triggers a guest deployment through the existing catch-all API. The Vite build reads the snapshot through Firestore REST and falls back to config when it is absent or unavailable. Raw JSON-LD is never directly editable.

**Why this is not enough:** `PageMeta` mutates the DOM with JavaScript. Social scrapers (Facebook, Messenger, WhatsApp, Viber) and Bing/Yahoo **do not execute JS** — they read the raw `index.html` only. Result: every shared URL yields the **same generic homepage card**, and the per-route meta is never seen. Google renders JS and largely copes, but relies on the missing sitemap/robots to discover routes efficiently.

---

## Gaps to close

- **🔴 G1 — Social/Bing previews are static-only.** Non-JS crawlers see only `index.html`. Need a way to serve **per-route** meta in the initial HTML response.
- **🔴 G2 — OG image is missing.** `config.ogImage = "og-image.png"` resolves to a 404 (no such file in `public/`); static fallback points at a logo PNG, not a social card.
- **🔴 G3 — No `robots.txt`.**
- **🔴 G4 — No `sitemap.xml`.**
- **🟡 G5 — No JSON-LD structured data** (`schema.org/Hotel`).
- **🟡 G6 — OG polish missing:** `og:image:width` / `og:image:height` / `og:image:alt`, `og:locale`, `twitter:site`.

---

## Approach — G1 (the critical one)

Pick **one** of these to make per-route meta visible to non-JS crawlers. Decision required before build (see Open Questions).

### Option A — Static prerender at build (recommended)
Prerender the small set of public routes to static HTML at build time, each with its own baked-in `<title>` / meta / OG / JSON-LD, then let React hydrate.

- Tooling: `vite-plugin-prerender` / `vite-react-ssg` / `react-snap` — evaluate against Vite 6 + React 19 + `vite-plugin-pwa` compatibility.
- Public routes are few and mostly static (`/`, `/rooms`, `/about`, `/corporate`, `/contact`, `/book`, `/my-booking`). Detail content that varies (e.g. a specific room) can fall back to route-level defaults.
- **Pros:** zero runtime cost, no extra Vercel function, works for all crawlers, plays well with the existing SPA + PWA.
- **Cons:** dynamic/param routes get generic (per-route, not per-record) cards — acceptable for launch.
- **Guardrail:** must not break the PWA service worker or the `hero-preload.js` early-preload path.

### Option B — Vercel Edge Middleware meta injection
Detect known crawler user-agents at the edge and stream an `index.html` variant with per-route OG tags injected server-side; humans still get the SPA.

- **Pros:** truly per-URL, supports dynamic records.
- **Cons:** UA sniffing is brittle; **counts against the 12-function Hobby cap** — must confirm middleware does *not* count as a function, or budget for it (`plan/docs/VERCEL-FUNCTION-LIMIT.md`).

> **Decision (2026-07-09): Option A — build-time prerender.** Chosen for launch: no extra Vercel function against the Hobby 12-function cap, no user-agent sniffing, and robust for all crawlers. Per-record share cards (Option B) are explicitly deferred — revisit only if sharing a specific room/booking with its own photo becomes a real requirement post-launch.

---

## Deliverables

### 1. Robots (G3)
- `guest-app/public/robots.txt` — `Allow: /`, disallow nothing sensitive, `Sitemap: https://{domain}/sitemap.xml`.
- Admin app: `admin-app/public/robots.txt` → `Disallow: /` (belt-and-suspenders with `noindex`).

### 2. Sitemap (G4)
- `sitemap.xml` listing all **indexable** public routes (exclude the `noIndex` routes: `/privacy`, `/terms`, `/my-booking` if it exposes refs, 404).
- Generate at build from the same route list used by prerender so it can't drift. White-label: URLs derive from `config.domain`.

### 3. OG image (G2)
- Create a real **1200×630** `og-image.png` (brand colors `#EA8A1A`, logo + tagline) and place at `guest-app/public/og-image.png` (matches `config.ogImage`).
- White-label: each client ships their own `og-image.png`; documented in `plan/docs/WHITE-LABEL.md` asset checklist.

### 4. Per-route meta in initial HTML (G1)
- Implement Option A (or B). Each public route ships correct `<title>`, `description`, canonical, OG (`title`/`description`/`image`/`url`/`type`), Twitter card in the **served** HTML.
- Keep `PageMeta.tsx` for client-side nav (SPA route changes) — the two layers coexist.

### 5. Structured data — JSON-LD (G5)
- Inject `schema.org/Hotel` (or `LodgingBusiness`) JSON-LD on the homepage: `name` (`brandName`/`legalName`), `address` (from `config.address`), `telephone`, `image`, `url`, `priceRange` (from new `config.priceRange`, relative band e.g. `₱₱` — see Q4), `sameAs` (`facebookUrl`, `instagramUrl`, `twitterHandle` URL when set), `checkinTime`/`checkoutTime`.
- All values sourced from `hotel.config.ts` — no hardcoded strings (white-label rule).

### 6. OG polish (G6)
- Add `og:image:width` (1200), `og:image:height` (630), `og:image:alt` (`brandName`), `og:locale` (from `config.locale`), and `twitter:site` from the new `config.twitterHandle` (rendered only when non-empty — see Q3).

### 7. Admin app stays out
- Confirm `admin-app/index.html` carries `<meta name="robots" content="noindex, nofollow">` and ships the disallow `robots.txt`.

---

## White-label rules (hard)

- Every string/URL derives from `hotel.config.ts` (`brandName`, `legalName`, `domain`, `ogImage`, `address`, `locale`, `facebookUrl`, `instagramUrl`, `checkInTime`, `checkOutTime`, plus two new fields: `twitterHandle` and `priceRange`). **No hardcoded "spark inn" / "sparkinnbohol.com".**
- `og-image.png` is a per-client asset → add to the `plan/docs/WHITE-LABEL.md` asset checklist.
- `robots.txt` + `sitemap.xml` must template off `config.domain`.

---

## Acceptance criteria

- [x] `https://{domain}/robots.txt` returns 200 and points to the sitemap.
- [x] `https://{domain}/sitemap.xml` returns 200 and lists all indexable routes (no `noIndex` routes).
- [x] `https://{domain}/og-image.png` returns 200, is 1200×630.
- [x] Facebook Sharing Debugger, WhatsApp, and Viber render a correct card for **at least 3 different** public URLs (home, rooms, about) — each with the right title/description (per-route, not all identical) once G1 ships.
- [x] X (Twitter) Card Validator shows `summary_large_image`.
- [x] Google Rich Results Test validates the Hotel JSON-LD with no errors.
- [x] `admin.{domain}` is `noindex` and disallowed.
- [x] Google Search Console + Bing Webmaster Tools: sitemap submitted, no coverage errors (post-deploy manual step).

---

## Out of scope (defer)

- Per-record dynamic share cards (specific room/booking) — needs Option B; revisit post-launch.
- Dynamically generated per-page OG images (OG image API) — Phase 2.
- Multi-language / hreflang — single-locale (`en-PH`) at launch.
- Blog / content SEO — no blog exists.

---

## Open questions (close with owner before build)

- ~~**Q1.** Approve Option A (build-time prerender) vs Option B (edge middleware)?~~ ✅ **Resolved 2026-07-09 — Option A (build-time prerender).** See `§Approach — Option A`.
- **Q2.** Provide/approve the 1200×630 OG card design (logo + tagline on brand orange)?
- ~~**Q3.** Is there an X/Twitter handle for `twitter:site`?~~ ✅ **Resolved 2026-07-09 — support X/Twitter.** Add a `twitterHandle` field to `hotel.config.ts` and emit `twitter:site` from it; render the tag only when the field is non-empty (Spark Inn's handle value still to be supplied by owner — tag is omitted until then, card still works via `twitter:image`).
- ~~**Q4.** `priceRange` value for JSON-LD?~~ ✅ **Resolved 2026-07-09 — relative band `₱₱`.** Store as a `priceRange` field in `hotel.config.ts`. Chosen over an explicit numeric range because Option A bakes JSON-LD at build time and live rates (seasonal/weekend overrides) would drift; the band never goes stale. A precise version (emitting `Offer`/`priceSpecification` from live rate data) is deferred post-launch.
