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
 * WHERE the in-room panel lands, per IFS-01 follow-up (2026-11-21,
 * decision #336).
 *
 * The panel has two tabs — Chat and the Spark Essentials shop — and the
 * hotel can switch the CHAT off while leaving the store on. The chat QR
 * used to land the guest on the "chat is unavailable" card: a dead end
 * for a guest whose only working surface was the shop. When the chat is
 * off and the store is on, the guest lands on the STORE instead — the
 * one surface that still works. The Chat tab stays one tap away, so a
 * guest who wants to read why the chat is gone still can.
 *
 * The rules, in order:
 *
 *   requested "shop"          → "shop" while the store is on; "chat"
 *                               when the store is off as well (the
 *                               store-off fallback owns that case in
 *                               the panel).
 *   requested "chat", chat ON  → "chat" — the chat works.
 *   requested "chat", chat OFF → "shop" when the store is on (the chat
 *                               is switched off, the store is not);
 *                               "chat" when the store is off too — the
 *                               chat tab then carries the "Call Desk"
 *                               card (call ON) or the whole-panel
 *                               fallback card (everything off).
 *
 * Pure, so the landing rule is unit-testable on its own and the panel
 * can never disagree with itself about where it opens.
 */
export function resolveIntercomLandingTab(
  requestedTab: IntercomTab,
  chatEnabled: boolean,
  storeEnabled: boolean
): IntercomTab {
  if (requestedTab === "shop") return storeEnabled ? "shop" : "chat";
  if (chatEnabled) return "chat";
  return storeEnabled ? "shop" : "chat";
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
