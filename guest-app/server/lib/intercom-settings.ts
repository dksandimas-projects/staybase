// Per IFS-01 (2026-11-20, decision #318): the server-side reader for
// the hotel-wide in-room intercom CHAT switch
// (`settings/hotelConfig.intercomChatEnabled`).
//
// The guest's chat messages are written by the SERVER (the client has
// no Firestore write path for them since PR-AUDIT-B3/B6), which makes
// this the ONE place where "the hotel switched the chat off" can be
// enforced for real. Hiding the composer in the browser alone would
// be cosmetic — a guest with a cached session token could keep
// posting.
//
// The Spark Essentials store is NOT gated here: the store's own
// order endpoint already refuses orders when
// `settings/storeConfig.isEnabled === false`, and the store badge
// message that follows an order is a STORE message, not a chat
// message (see `handleSendGuestMessage`).
//
// FAIL-OPEN: a transient Firestore error returns `true` (the chat
// stays available) rather than taking the hotel's guest chat
// offline because of an infrastructure blip. The error is logged so
// it is never silent. This mirrors `otherAddOns-settings.ts`.

import { adminDb } from "./firebase-admin";
import { normalizeIntercomChatEnabled } from "@spark-inn/shared";

/**
 * Read the hotel-wide intercom chat switch.
 *
 * @returns `false` only when the settings doc explicitly says the
 *   chat is off. A missing doc, a missing field, or a read failure
 *   all resolve to `true` (the pre-IFS-01 behaviour).
 */
export async function loadIntercomChatEnabled(): Promise<boolean> {
  try {
    const snap = await adminDb
      .collection("settings")
      .doc("hotelConfig")
      .get();
    if (!snap.exists) return true;
    return normalizeIntercomChatEnabled(snap.data()?.intercomChatEnabled);
  } catch (err) {
    console.error(
      "Failed to read settings/hotelConfig.intercomChatEnabled; treating the intercom chat as enabled:",
      err
    );
    return true;
  }
}

/** The message the guest sees when the hotel has switched the chat off. */
export const INTERCOM_CHAT_UNAVAILABLE_ERROR =
  "Chat is currently unavailable. Please call the front desk.";
