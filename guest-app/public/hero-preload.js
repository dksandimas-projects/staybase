// Hero-image early-preload: reads the publicSiteContent localStorage
// cache synchronously (same envelope written by usePublicSiteContent)
// and injects <link rel="preload"> tags for every hero URL before the
// JS bundle even starts parsing. On a returning visitor this shaves
// the entire React-mount + Firestore round-trip delay off LCP.
// Externalized (rather than an inline <script>) so it runs under the
// guest-app CSP's script-src, which only allows 'self' + the explicit
// third-party allowlist — no 'unsafe-inline'.
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
    var urls = [
      content.homepage  && content.homepage.heroPhotoUrl,
      content.about     && content.about.heroPhotoUrl,
      content.corporate && content.corporate.heroPhotoUrl,
      content.rewards   && content.rewards.heroPhotoUrl
    ];
    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      if (typeof url !== "string" || url.length === 0) continue;
      var link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = url;
      link.setAttribute("fetchpriority", "high");
      link.dataset.heroEarlyPreload = "true";
      document.head.appendChild(link);
    }
  } catch (e) { /* best-effort — storage disabled or JSON malformed */ }
})();
