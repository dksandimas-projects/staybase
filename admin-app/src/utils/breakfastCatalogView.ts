// Per P0-9 (2026-10-22): the shared decision for the admin app's two
// CATALOG SURFACES (the booking drawer's Breakfast tab + Add-Ons tab,
// and the walk-in grids).
//
// The rule, learned the hard way in production:
//
//   **a failed read is never rendered as an empty catalog.**
//
// A network error / non-200 / unparseable body used to leave the
// catalog `null`, which fell through to the "the hotel has this
// switched off" branch. The staff were then told to go and change a
// setting that was already correct, and — because the surface fetched
// once on mount and never again — the wrong message stuck until the
// whole page was reloaded.
//
// This resolver is the BREAKFAST sibling of
// `addOnsCatalogView.ts` (the add-on surfaces). It is PURE so the rule
// is unit-tested instead of only observable in a running browser.
//
// Both resolvers share the same four states and the same ordering
// discipline:
//
//   loading  ->  error  ->  empty  ->  ready
//
// with `error` checked BEFORE `empty`. That ordering is the invariant:
// a failed read can never be rendered as an empty catalog.

export type BreakfastCatalogView<TConfig> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "disabled" }
  | { kind: "ready"; config: TConfig };

/** The message the drawer shows when the breakfast catalog read fails. */
export const BREAKFAST_CATALOG_LOAD_ERROR =
  "We couldn't load the breakfast catalog.";

/**
 * The envelope the public breakfast-config endpoint answers:
 * `{ success, data: { isEnabled, meals, ... } }`.
 *
 * The config lives under `data` — this is the endpoint whose shape the
 * ADD-ONS consumers used to read by mistake (they read `data.data` on
 * an endpoint that answers `{ success, addOns: [...] }`; decision #313).
 * The two envelopes are deliberately different and both are now pinned
 * by a shared type so neither app can drift onto the other's shape.
 */
export interface PublicBreakfastConfigResponse<TConfig> {
  success: boolean;
  data: TConfig | null;
}

export interface ResolveBreakfastCatalogViewInput<TConfig> {
  /** A read is in flight. */
  loading: boolean;
  /** The failure message, or `null` when the last read succeeded. */
  error: string | null;
  /**
   * The server's answer, or `null` when there is none.
   *
   * `null` WITH a successful read means the endpoint answered without
   * the expected `data` envelope — that is a failed read, not an
   * empty catalog, so it resolves to `error`.
   */
  config: TConfig | null;
}

/**
 * Resolve the breakfast catalog surface state.
 *
 * The ORDER matters: `error` is checked BEFORE the disabled branch, so
 * a failed read can never be rendered as "breakfast is switched off".
 */
export function resolveBreakfastCatalogView<TConfig extends { isEnabled?: boolean }>(
  input: ResolveBreakfastCatalogViewInput<TConfig>
): BreakfastCatalogView<TConfig> {
  if (input.loading) return { kind: "loading" };
  if (input.error) return { kind: "error", message: input.error };
  if (!input.config) {
    // The read "succeeded" but the payload had no config. Treat it as a
    // failed read — it is not evidence that breakfast is switched off.
    return { kind: "error", message: BREAKFAST_CATALOG_LOAD_ERROR };
  }
  if (input.config.isEnabled === false) return { kind: "disabled" };
  return { kind: "ready", config: input.config };
}
