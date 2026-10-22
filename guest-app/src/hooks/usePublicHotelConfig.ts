// Per F09 / SEC-6 (2026-10-22, P2 revenue leak): the guest app's read
// path for the hotel's public configuration.
//
// Before this hook the guest app read `settings/hotelConfig` straight
// from Firestore. The rules allowed `allow read: if true` on
// `settings/{documentId}`, so the document — which holds the hotel's
// negotiated corporate rate ladder (`roomTypes[].corporateRate`) and
// the bank details of the payment methods — was world-readable from
// any browser.
//
// The rules now close that read (staff read / admin write) and the
// guest app reads the PUBLIC PROJECTION instead:
//
//   GET /api/public/hotel-config
//     → { success: true, data: PublicHotelConfig }
//
// The projection is built server-side by
// `guest-app/server/lib/publicHotelConfig.ts` from an explicit
// allow-list. It contains NO `corporateRate` and NO `accountNumber`
// for a payment method the admin hid from the corporate surface.
//
// This hook is the ONLY way the guest app reads the hotel config, so
// there is exactly one place to audit.

import { useEffect, useState } from "react";
import type { PublicHotelConfig } from "@spark-inn/shared";
import { subscribeToPublicSiteContentBust } from "@spark-inn/shared";

const ENDPOINT = "/api/public/hotel-config";

let cachedPromise: Promise<PublicHotelConfig | null> | null = null;

/**
 * Fetch the public hotel configuration. The promise is module-scoped
 * so several components mounting in the same tick share ONE request.
 */
export function fetchPublicHotelConfig(): Promise<PublicHotelConfig | null> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const response = await fetch(ENDPOINT, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) return null;
      const json = await response.json();
      if (!json?.success || !json?.data) return null;
      return json.data as PublicHotelConfig;
    } catch {
      return null;
    }
  })();
  return cachedPromise;
}

/** Drop the module-scoped cache so the next read hits the network. */
export function resetPublicHotelConfigCache(): void {
  cachedPromise = null;
}

export interface UsePublicHotelConfigResult {
  config: PublicHotelConfig | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Read the public hotel configuration. Refetches when the admin app
 * busts the public-site cache from another tab (the admin writes
 * `settings/hotelConfig` from Settings → Hotel Info).
 */
export function usePublicHotelConfig(): UsePublicHotelConfigResult {
  const [config, setConfig] = useState<PublicHotelConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const loaded = await fetchPublicHotelConfig();
        if (cancelled) return;
        setConfig(loaded);
        setError(
          loaded
            ? null
            : "We couldn't load the hotel details. Please refresh the page."
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();

    const unsubscribe = subscribeToPublicSiteContentBust(() => {
      resetPublicHotelConfigCache();
      void load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { config, isLoading, error };
}
