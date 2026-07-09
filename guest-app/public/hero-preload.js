// Hero-image early-preload: reads the publicSiteContent localStorage
// cache synchronously (same envelope written by usePublicSiteContent)
// and injects a <link rel="preload"> tag for the *current page's* hero
// URL before the JS bundle even starts parsing. On a returning visitor
// this shaves the entire React-mount + Firestore round-trip delay off
// LCP. Externalized (rather than an inline <script>) so it runs under
// the guest-app CSP's script-src, which only allows 'self' + the
// explicit third-party allowlist — no 'unsafe-inline'.
// Only ONE preload tag is ever injected here (matching the current
// pathname) — see src/utils/heroPrefetch.ts, which documents the same
// one-preload-at-a-time contract for the static-fallback case. This
// mirrors that route-prefix mapping so the two mechanisms don't
// disagree, and so the browser doesn't warn about the other three
// hero images being preloaded but never used on this page.
// The script is intentionally tiny and wrapped in try/catch so any
// storage error (private mode, quota exceeded, malformed JSON) is
// silently ignored — the runtime HeroImage preload fires as the
// fallback.
(function () {
  try {
    var raw = localStorage.getItem("publicSiteContent:v3");
    if (!raw) return;
    var envelope = JSON.parse(raw);
    var content = envelope && envelope.value;
    if (!content) return;

    var path = window.location.pathname;
    var routeHeroMap = [
      { prefix: "/about",     section: "about"     },
      { prefix: "/corporate", section: "corporate" },
      { prefix: "/rewards",   section: "rewards"   },
      { prefix: "/",          section: "homepage"  } // must be last (catch-all)
    ];
    var section;
    for (var i = 0; i < routeHeroMap.length; i++) {
      var isMatch = routeHeroMap[i].prefix === "/" 
        ? path === "/" 
        : path.indexOf(routeHeroMap[i].prefix) === 0;
      if (isMatch) {
        section = routeHeroMap[i].section;
        break;
      }
    }
    if (!section) return;

    var url = content[section] && content[section].heroPhotoUrl;
    if (typeof url !== "string" || url.length === 0) return;

    var link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    link.setAttribute("fetchpriority", "high");
    link.dataset.heroEarlyPreload = "true";
    document.head.appendChild(link);
  } catch (e) { /* best-effort — storage disabled or JSON malformed */ }
})();
