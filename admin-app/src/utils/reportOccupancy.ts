interface ReportOccupancyInput {
  numGuests?: unknown;
  numAdults?: unknown;
  numChildren?: unknown;
}

export interface ReportOccupancySplit {
  guests: number;
  adults: number;
  children: number;
}

/**
 * Keeps the historical total-guest column stable while exposing the newer
 * adult/child split. Legacy or inconsistent records retain their original
 * meaning: every recorded guest is reported as an adult.
 */
export function getReportOccupancySplit(booking: ReportOccupancyInput): ReportOccupancySplit {
  const rawGuests = Number(booking.numGuests);
  const guests = Number.isFinite(rawGuests) && rawGuests >= 0
    ? Math.floor(rawGuests)
    : 0;
  const adults = Number(booking.numAdults);
  const children = Number(booking.numChildren);
  const hasValidSplit = Number.isInteger(adults)
    && adults >= 0
    && Number.isInteger(children)
    && children >= 0
    && adults + children === guests;

  return hasValidSplit
    ? { guests, adults, children }
    : { guests, adults: guests, children: 0 };
}
