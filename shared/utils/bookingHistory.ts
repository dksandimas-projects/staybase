// Per CRL-08 (2026-08-11, per decision #213):
// the "Originally for" + "Booked on" helpers. The
// "Booked on" is the date the booking was created
// (`bookings/{id}.createdAt`). The "Originally for"
// is the create-time scheduled check-in — i.e. the
// date the booking was originally for, before any
// reschedule. For post-MRB-01 reservations the
// header's `checkIn` is the immutable original
// (per MRB-14 / decision #180 — the reschedule no
// longer mutates the header's shared range). For
// pre-MRB-01 legacy bookings the booking doc's
// own `rescheduleHistory[0].fromCheckIn` is the
// original; if the history is empty, the booking's
// own `checkIn` IS the original (it was never
// rescheduled).
//
// The helper returns `null` when the booking has
// never been rescheduled AND the original equals
// the current check-in — the caller is expected
// to suppress the "Originally for" UI in that
// case so the surface stays clean. A `null`
// "Booked on" is a defensive coerce (the field is
// always stamped at create time, but legacy
// pre-CRL-05 bookings may lack it).

import { toDateOrNull, type DateLike } from "./bookingDates";

export interface OriginallyForInput {
  booking: {
    checkIn?: DateLike;
    rescheduleHistory?: Array<{ fromCheckIn?: DateLike }> | null;
  } | null | undefined;
  reservation?: {
    checkIn?: DateLike;
  } | null | undefined;
}

export function getOriginallyForCheckIn(input: OriginallyForInput): Date | null {
  // Post-MRB-01: the reservation header's `checkIn` is
  // the create-time original (MRB-14 makes it immutable
  // for shared-range reschedules). The booking's own
  // `checkIn` may have moved to the rescheduled date.
  const reservationOriginal = toDateOrNull(input.reservation?.checkIn);
  if (reservationOriginal) {
    return reservationOriginal;
  }
  // Legacy pre-MRB-01 (no reservation header). The
  // booking's own `rescheduleHistory` records the
  // pre-reschedule `fromCheckIn` — the first entry is
  // the create-time original. An empty history means
  // the booking was never rescheduled, in which case
  // the booking's own `checkIn` IS the original.
  const history = Array.isArray(input.booking?.rescheduleHistory)
    ? input.booking!.rescheduleHistory!
    : [];
  if (history.length > 0) {
    const first = history[0];
    const original = toDateOrNull(first?.fromCheckIn);
    if (original) return original;
  }
  return toDateOrNull(input.booking?.checkIn);
}

export interface BookedOnInput {
  booking?: { createdAt?: DateLike } | null | undefined;
  reservation?: { createdAt?: DateLike } | null | undefined;
}

export function getBookedOnDate(input: BookedOnInput): Date | null {
  // For a post-MRB-01 reservation the header's
  // `createdAt` is the reservation-level creation time.
  // For a single-booking lookup (N=1 + legacy) the
  // booking's own `createdAt` is the creation time.
  return toDateOrNull(input.reservation?.createdAt)
    ?? toDateOrNull(input.booking?.createdAt);
}
