export type IntercomTab = "chat" | "shop";

/**
 * The query param the in-room QR encodes.
 *
 * The Spark Essentials (store) QR points at
 * `/intercom/{roomId}?tab=shop` (see `plan/features/QR-MANAGEMENT.md`),
 * so a guest who scans a "scan to order" card must land on the STORE
 * tab — not on the default chat tab. The chat QR encodes no param at
 * all, and the panel then opens on Chat.
 */
export const INTERCOM_TAB_PARAM = "tab";
export const INTERCOM_TAB_SHOP = "shop";

/**
 * Resolve the intercom tab from a URL search string.
 *
 * Anything that is not exactly `tab=shop` resolves to `chat` — an
 * unknown or malformed param must never leave the guest on a blank
 * panel, and the chat tab is the safe default.
 */
export function resolveIntercomTab(search: string | URLSearchParams): IntercomTab {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get(INTERCOM_TAB_PARAM) === INTERCOM_TAB_SHOP ? "shop" : "chat";
}

/**
 * Build the search string for a tab, preserving any other query params
 * the URL already carries. The chat tab carries no param (the plain QR
 * URL stays plain); the shop tab carries `tab=shop`.
 */
export function withIntercomTab(search: string, tab: IntercomTab): string {
  const params = new URLSearchParams(search);
  if (tab === "shop") {
    params.set(INTERCOM_TAB_PARAM, INTERCOM_TAB_SHOP);
  } else {
    params.delete(INTERCOM_TAB_PARAM);
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}
