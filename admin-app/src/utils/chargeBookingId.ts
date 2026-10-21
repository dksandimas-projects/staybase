// Per RPT-13 (QA pass 2026-10-21): the Reports page attributed every
// incidental charge to the RESERVATION instead of the booking.
//
// THE DEFECT
// ----------
// Incidental charges live at ONE of two paths:
//
//   reservations/{reservationId}/charges/{chargeId}   (canonical)
//   bookings/{bookingId}/charges/{chargeId}           (legacy)
//
// The Reports page's LIVE listener resolved the booking with
// `chargeDoc.ref.parent.parent?.id`:
//
//   bookings/{id}/charges/{cid}      -> parent.parent = {id}      ✓
//   reservations/{rid}/charges/{cid}  -> parent.parent = {rid}     ✗
//
// The canonical path's parent is the RESERVATION, so the resolved
// `bookingId` was a reservation id that matches **no** booking. Every
// downstream join — `charges.filter((charge) => charge.bookingId ===
// booking.id)` — therefore matched nothing, and **every incidental
// charge dropped out of the receivables report entirely**.
//
// Measured against production on 2026-10-21: all 5 charges live under a
// reservation, all 5 carry a correct `data.bookingId`, and all 5 were
// invisible in the report — ₱1,350 of incidental revenue missing from
// the receivables table.
//
// The XLSX export path in the same file already resolved this correctly
// (it prefers the stamped `data.bookingId` for a reservation-scope
// charge). So the page had TWO resolvers, one right and one wrong. This
// module is the single resolver both now use.

/**
 * Resolve the booking a charge belongs to.
 *
 * @param path  The Firestore doc path of the charge.
 * @param data  The charge doc's data.
 * @returns The booking id, or `""` when the charge cannot be attributed.
 */
export function resolveChargeBookingId(
  path: string,
  data: Record<string, unknown> | null | undefined
): string {
  const stamped = typeof data?.bookingId === "string" ? data.bookingId.trim() : "";
  if (stamped) return stamped;

  // Fall back to the path. `bookings/{id}/charges/{cid}` gives the
  // booking id directly; `reservations/{rid}/charges/{cid}` gives the
  // reservation id, which is NOT a booking id — so a reservation-scope
  // charge with no stamped `bookingId` cannot be attributed at all.
  const match = /^(bookings)\/([^/]+)\/charges\//.exec(path);
  return match ? match[2] : "";
}

/**
 * Is this charge doc a reservation-scope charge? (The canonical path.)
 */
export function isReservationScopedCharge(path: string): boolean {
  return path.startsWith("reservations/");
}
