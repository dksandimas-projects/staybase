// Per QA-2026-10-23 §3.2 (2026-10-25): the CLIENT half of the
// hotel-wide bot-protection mode.
//
// THE PROBLEM
// -----------
// The server honours `settings/hotelConfig.botProtectionMode` (the
// guest-app server reads it through
// `guest-app/server/lib/botProtection-settings.ts` and skips the
// Cloudflare Turnstile gate when the mode is "disabled"). The guest
// CLIENT did not: every browser flow still gated on the token, so with
// the switch off the guest could not apply a voucher, look up a
// booking, cancel a stay, submit an inquiry or send a contact message —
// the server would have accepted the request, the browser never sent
// it.
//
// THE FIX
// -------
// The mode travels in the PUBLIC projection of the hotel config
// (`GET /api/public/hotel-config`) because the raw
// `settings/hotelConfig` document is not readable by an anonymous
// client. This hook is the ONE place the guest app resolves it.
//
// FAIL CLOSED
// -----------
// The mode is resolved through the SHARED normaliser
// (`normalizeBotProtectionMode`), the same one the server uses, so the
// two sides can never disagree about what "off" means. A config that
// cannot be read, a missing field, a malformed value or an
// unrecognised mode all resolve to "turnstile" — the token stays
// required. A bot-protection switch that fails open is not a
// bot-protection switch.
//
// While the mode is still loading the hook reports "turnstile"
// (the gate is ON), so the widget mounts and the gates hold until the
// hotel's setting is known.

import { useEffect, useState } from "react";
import {
  BOT_PROTECTION_MODE_DEFAULT,
  normalizeBotProtectionMode,
  type BotProtectionMode
} from "@spark-inn/shared";
import { fetchPublicHotelConfig } from "./usePublicHotelConfig";

export interface UseBotProtectionModeResult {
  /**
   * `true` ONLY when the hotel's mode is exactly "disabled" — i.e. the
   * bot gate is OFF and the Turnstile token is NOT required.
   */
  isBotProtectionDisabled: boolean;
  /** `true` until the mode has been resolved from the public projection. */
  isLoading: boolean;
}

/**
 * Resolve the hotel-wide bot-protection mode for the guest app.
 *
 * @returns the resolved mode. `isBotProtectionDisabled` is `false`
 *   (the gate is ON) until — and unless — the public projection
 *   explicitly says "disabled".
 */
export function useBotProtectionMode(): UseBotProtectionModeResult {
  const [mode, setMode] = useState<BotProtectionMode>(BOT_PROTECTION_MODE_DEFAULT);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void fetchPublicHotelConfig()
      .then((config) => {
        if (cancelled) return;
        // FAIL CLOSED: a missing config / a missing field / a malformed
        // value all normalise to "turnstile" — the gate stays ON.
        setMode(normalizeBotProtectionMode(config?.botProtectionMode));
      })
      .catch(() => {
        // FAIL CLOSED: keep the default mode ("turnstile").
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    isBotProtectionDisabled: mode === "disabled",
    isLoading
  };
}
