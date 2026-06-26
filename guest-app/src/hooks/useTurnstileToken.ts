// Per H1 (hardening batch 2026-06-26): shared Turnstile
// widget hook so any page that posts to a Turnstile-gated
// endpoint can render the challenge with a one-liner. The
// previous pattern (inlined in BookingPage) was 60+ lines
// of imperative script-loading + widget rendering; copying
// it to the lookup + cancel flows was a maintenance
// hazard.
//
// The hook lazily injects the Cloudflare script once per
// page-load, renders the widget into a `div` ref, and
// reports the latest token via `token`. When the token
// expires (default 2 min) the Cloudflare callback fires
// and the hook resets the token to `""` so the next submit
// forces a fresh challenge.

import { useEffect, useRef, useState } from "react";
import config from "@config";

interface UseTurnstileTokenOptions {
  /** Optional override for the container ref. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** Skip rendering entirely (e.g. when the form is not shown). */
  enabled?: boolean;
}

interface UseTurnstileTokenResult {
  token: string;
  reset: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const SCRIPT_ID = "turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

function ensureScript(): void {
  if (document.getElementById(SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = SCRIPT_SRC;
  script.async = true;
  script.defer = true;
  document.body.appendChild(script);
}

function getSiteKey(): string {
  const isProductionDomain =
    typeof window !== "undefined" &&
    (window.location.hostname === config.domain ||
      window.location.hostname === `www.${config.domain}`);
  if (isProductionDomain) {
    const fromEnv = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY;
    if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  }
  // Cloudflare's "always passes" sentinel key for dev + tests.
  return "1x00000000000000000000AA";
}

export function useTurnstileToken(
  options: UseTurnstileTokenOptions = {}
): UseTurnstileTokenResult {
  const { enabled = true } = options;
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = options.containerRef ?? internalRef;
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    let pollHandle: ReturnType<typeof setTimeout> | null = null;

    const renderWidget = () => {
      if (cancelled || !window.turnstile || !container.isConnected) return;
      const id = window.turnstile.render(container, {
        sitekey: getSiteKey(),
        callback: (nextToken: string) => setToken(nextToken),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken("")
      });
      widgetIdRef.current = id;
    };

    const tryRender = () => {
      if (cancelled) return;
      if (window.turnstile) {
        renderWidget();
      } else {
        pollHandle = setTimeout(tryRender, 100);
      }
    };

    ensureScript();
    tryRender();

    return () => {
      cancelled = true;
      if (pollHandle !== null) clearTimeout(pollHandle);
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          // Widget may already be gone. Safe to ignore.
        }
      }
      widgetIdRef.current = null;
    };
  }, [enabled, containerRef]);

  const reset = () => {
    setToken("");
    const id = widgetIdRef.current;
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id);
      } catch {
        // ignore
      }
    }
  };

  return { token, reset, containerRef };
}
