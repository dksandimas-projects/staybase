// Per F-B5 (2026-10-27): resolve the kitchen list's guest label.
//
// THE DEFECT
// ----------
//   The kitchen list resolved a slot's guest name from the booking's
//   `guests[]` array and fell back to the booking's single top-level
//   `guestName`. But **0 of 157** production bookings carry a
//   `guests[]` array, while **141** of them have `numGuests > 1`.
//
//   So EVERY slot of a multi-guest booking fell through to the same
//   top-level name. A 2-guest booking showed the SAME name on both
//   rows — the kitchen read "one person who wants two meals" instead
//   of "two people, one each".
//
// THE RULE
// --------
//   * The slot's OWN guest, when the booking has a `guests[]` array and
//     the slot's index resolves inside it. Unchanged.
//   * Otherwise the booking knows exactly ONE name, and it belongs to
//     the LEAD guest (the booking is named for them). The lead slot
//     keeps that real name; the other slots are labelled by their
//     POSITION — the only thing the system actually knows.
//
//   "Guest 2" is a label the kitchen can act on. The lead's name
//   repeated on every row is not: it misstates who is staying.
//
// This lives in `shared/` because it is pure presentation logic with no
// server dependency, and because the report surfaces and the kitchen
// list must agree on it.

export interface KitchenGuestName {
  /** The 0-based guest index the slot denotes. */
  guestIndex: number;
  /** The label to show for that guest. */
  guestName: string;
}

function namedGuest(guest: any): string {
  if (!guest || typeof guest !== "object") return "";
  const first = typeof guest.firstName === "string" ? guest.firstName : "";
  const last = typeof guest.lastName === "string" ? guest.lastName : "";
  const combined = `${first} ${last}`.trim();
  if (combined.length > 0) return combined;
  if (typeof guest.name === "string" && guest.name.trim().length > 0) {
    return guest.name.trim();
  }
  return "";
}

/**
 * Resolve the kitchen list's label for one breakfast slot.
 *
 * @param booking  The booking document (or any object with `guests` /
 *                 `guestName`).
 * @param guestIndex  The ALREADY-RESOLVED 0-based guest index. It is
 *        NOT re-derived from the key string here — three key forms
 *        exist in the wild (canonical `guest-0`, legacy bare `-0`,
 *        legacy 1-based `guest-1`) and only the shared normaliser
 *        knows which index each one denotes.
 */
export function resolveKitchenGuestName(
  booking: any,
  guestIndex: number
): KitchenGuestName {
  const index = Number.isFinite(Number(guestIndex)) ? Math.max(0, Math.floor(Number(guestIndex))) : 0;
  const guests = Array.isArray(booking?.guests) ? booking.guests : [];

  // 1. The slot's own guest, when the booking carries a `guests[]`
  //    array and the index resolves inside it.
  const own = namedGuest(guests[index]);
  if (own) return { guestIndex: index, guestName: own };

  // 2. No per-guest array (or the index is past its end). The booking
  //    knows ONE name and it belongs to the lead guest.
  const lead =
    namedGuest(guests[0]) ||
    (typeof booking?.guestName === "string" ? booking.guestName.trim() : "");

  if (index === 0) return { guestIndex: index, guestName: lead || "Guest" };

  // 3. The other slots are labelled by position — repeating the lead's
  //    name would misstate who is staying.
  return { guestIndex: index, guestName: `Guest ${index + 1}` };
}
