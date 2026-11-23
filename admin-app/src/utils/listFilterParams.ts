// Per FSO-13 (2026-11-23): the ONE place that knows which URL
// parameters are FILTERS on the admin Bookings list.
//
// Why this module exists
// ----------------------
// The Bookings page keeps every filter in the URL (`?bs=checked-in&bq=…`)
// so a filtered view can be shared or reloaded. `writeParams` builds the
// next query string from the `searchParams` captured in the CURRENT
// render, and `setSearchParams` REPLACES the whole query string — so N
// calls inside ONE handler each start from the SAME stale snapshot and
// the last call wins. The "Clear all" button used to call one setter per
// filter, which meant it cleared exactly ONE of them (the last one in
// the chain) and left the rest untouched.
//
// The fix is one `writeParams` call with every filter key set to null.
// The key lists below are the contract: they are the single source of
// truth for "what is a filter on this page", and the test asserts that
// every parameter the page reads is reachable from one of them — so a
// NEW filter cannot be added without also becoming clearable.
//
// NOT filters (deliberately excluded — they are navigation, not state):
//   tab, filter (legacy), orderRef, orderId, bookingId, reservationId,
//   reservationRef, staffHoldId, roomIds, checkIn, checkOut, newBooking,
//   holdExpiresAt.

/** Every booking-list filter parameter (the toolbar's "Clear all"). */
export const BOOKING_FILTER_PARAM_KEYS = [
  "bq",   // search text
  "bqv",  // quick view
  "bs",   // lifecycle status (pending → checked-out → cancelled)
  "bdb",  // date basis (stay / arrival / departure / created)
  "bps",  // payment state
  "bpm",  // payment method
  "br",   // room
  "brt",  // room type
  "bsrc", // booking source / channel
  "bc",   // corporate
  "bd",   // discount / voucher
  "bdf",  // date from
  "bdt",  // date to
] as const;

/** The booking filters the ADVANCED PANEL owns (its own "Clear all"). */
export const BOOKING_ADVANCED_FILTER_PARAM_KEYS = [
  "bs",
  "bps",
  "bpm",
  "br",
  "brt",
  "bsrc",
  "bc",
  "bd",
  "bdf",
  "bdt",
] as const;

/** Every store-order filter parameter (the toolbar's "Clear all"). */
export const STORE_FILTER_PARAM_KEYS = [
  "sq",   // search text
  "sqv",  // quick view
  "ss",   // order status
  "sr",   // room
  "spm",  // payment method
  "sbl",  // billing type
  "sbd",  // billed state
  "spp",  // payment proof
  "sdf",  // date from
  "sdt",  // date to
] as const;

/** The store filters the ADVANCED PANEL owns. */
export const STORE_ADVANCED_FILTER_PARAM_KEYS = [
  "ss",
  "sr",
  "spm",
  "sbl",
  "sbd",
  "spp",
  "sdf",
  "sdt",
] as const;

/**
 * Build the ONE `writeParams` payload that clears every key in `keys`.
 * A null value means "delete this parameter" in `writeParams`.
 */
export function clearFilterParams(
  keys: readonly string[]
): Record<string, string | null> {
  const payload: Record<string, string | null> = {};
  for (const key of keys) payload[key] = null;
  return payload;
}
