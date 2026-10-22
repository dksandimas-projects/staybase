// Per P0-9 (2026-10-22): the shared decision for "what should the
// other-add-ons catalog surface show right now?".
//
// The owner reported, in the live admin app, that the booking drawer's
// Add-Ons tab said:
//
//   "The add-on catalog is empty. Add a row in Settings → Other Add-Ons
//    to start selling add-ons."
//
// while the hotel's add-ons were ON and the endpoint was serving a row.
//
// The copy was wrong for TWO different reasons, and the old code could
// not tell them apart:
//
//   1. A FAILED read (network error, non-200, unparseable body) left
//      the catalog `null`, which fell through to the empty branch — so
//      the staff were told to go create an add-on in Settings when the
//      real problem was that the REQUEST failed.
//   2. The catalog really CAN be empty for two opposite reasons: the
//      hotel took other add-ons off sale (a state staff can change), or
//      the hotel has no other add-ons at all (a fact). Those need
//      different copy (OCT-M1, decision #295).
//
// This resolver is PURE, so the rule is unit-testable instead of only
// observable in a running browser. The invariant it encodes:
//
//   **a failed read is never rendered as an empty catalog.**

import type { OtherAddOnsCatalogRow } from "@spark-inn/shared";

/** The message every admin surface shows when the catalog read fails. */
export const ADDONS_CATALOG_LOAD_ERROR =
  "We couldn't load the other add-ons catalog.";

/** Why the catalog is empty. The two reasons need different copy. */
export type AddOnsCatalogEmptyReason = "switched-off" | "no-rows";

export type AddOnsCatalogView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty"; reason: AddOnsCatalogEmptyReason }
  | { kind: "rows"; rows: OtherAddOnsCatalogRow[] };

export interface ResolveAddOnsCatalogViewInput {
  /** A read is in flight. */
  loading: boolean;
  /** The failure message, or `null` when the last read succeeded. */
  error: string | null;
  /** The rows from the last successful read (`null` = never read successfully). */
  catalog: OtherAddOnsCatalogRow[] | null | undefined;
  /** The hotel-wide master switch, echoed by the endpoint. */
  enabled: boolean;
}

/**
 * Resolve the catalog surface state.
 *
 * The ORDER matters: `error` is checked BEFORE the empty branch, so a
 * failed read can never be rendered as "the catalog is empty".
 */
export function resolveAddOnsCatalogView(
  input: ResolveAddOnsCatalogViewInput
): AddOnsCatalogView {
  if (input.loading) return { kind: "loading" };
  if (input.error) return { kind: "error", message: input.error };

  const rows = input.catalog || [];
  if (rows.length === 0) {
    return {
      kind: "empty",
      reason: input.enabled === false ? "switched-off" : "no-rows"
    };
  }
  return { kind: "rows", rows };
}
