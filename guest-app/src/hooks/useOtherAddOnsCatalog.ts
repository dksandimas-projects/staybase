// Per OCT-M4 (2026-10-20, decision #297): the guest Step 2
// other-add-ons catalog.
//
// The catalog is read from the PUBLIC endpoint
// `GET /api/bookings/addons/config` (the Admin-SDK read path — the
// guest app never touches the `addOns` collection directly, per the
// Firestore rules in `plan/features/OTHER-ADD-ONS.md`).
//
// That endpoint already honours the hotel-wide "Add-ons enabled"
// master switch (OCT-M1, decision #295): when the switch is off it
// returns an EMPTY catalog plus `otherAddOnsEnabled: false`, so the
// Step 2 grid disappears entirely instead of showing add-ons the
// guest cannot buy.

import { useEffect, useState } from "react";
import type { OtherAddOnDraftCatalogRow } from "@spark-inn/shared";

export interface OtherAddOnsCatalogPayload {
  addOns: OtherAddOnDraftCatalogRow[];
  /** The hotel-wide master switch (OCT-M1). `false` = the hotel took other add-ons off sale. */
  otherAddOnsEnabled: boolean;
  /** True when the catalog is the read-only pre-seed row (a fresh install with no admin catalog yet). */
  preSeeded: boolean;
}

export interface UseOtherAddOnsCatalogResult {
  addOns: OtherAddOnDraftCatalogRow[];
  otherAddOnsEnabled: boolean;
  preSeeded: boolean;
  isLoading: boolean;
  error: string | null;
}

const EMPTY: OtherAddOnsCatalogPayload = {
  addOns: [],
  otherAddOnsEnabled: true,
  preSeeded: false
};

export function useOtherAddOnsCatalog(): UseOtherAddOnsCatalogResult {
  const [payload, setPayload] = useState<OtherAddOnsCatalogPayload>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/bookings/addons/config", {
          method: "GET",
          headers: { Accept: "application/json" }
        });
        if (cancelled) return;
        if (!response.ok) {
          setError("We couldn't load the other add-ons. You can still finish your booking without them.");
          setIsLoading(false);
          return;
        }
        const json = await response.json();
        if (cancelled) return;
        const rows = Array.isArray(json?.addOns) ? json.addOns : [];
        setPayload({
          addOns: rows,
          otherAddOnsEnabled: json?.otherAddOnsEnabled !== false,
          preSeeded: json?.preSeeded === true
        });
        setError(null);
      } catch {
        if (cancelled) return;
        setError("We couldn't load the other add-ons. You can still finish your booking without them.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    addOns: payload.addOns,
    otherAddOnsEnabled: payload.otherAddOnsEnabled,
    preSeeded: payload.preSeeded,
    isLoading,
    error
  };
}
