/**
 * QA test-run fixtures vs real guest money.
 *
 * WHY THIS EXISTS
 * ---------------
 * The desk's money surfaces (the dashboard's "Pending refunds" card and
 * the Reports → Liability tab) count money the hotel still owes. On
 * 2026-10-27 a live check found that **100%** of the "Breakfast refunds
 * pending" headline — 3 pending refunds worth ₱300.00 — belonged to the
 * owner's own rehearsal run, and **not one peso** was real guest money.
 *
 * The number was not wrong; it was just unreadable. The desk could not
 * tell a rehearsal entry from a guest who was actually waiting for a
 * refund, so the card was either ignored or chased.
 *
 * WHAT THIS DOES
 * --------------
 * It lets a surface SPLIT a count into the part that is real guest money
 * and the part that is a test fixture, and show the real part as the
 * headline while still saying how much is fixture data.
 *
 * THE RULE
 * --------
 * Nothing is ever hidden. A fixture is reported as a fixture, not
 * dropped. And the default is SAFE: a booking we cannot identify is
 * treated as REAL guest money, because under-reporting a liability is
 * far worse than over-reporting one.
 */

/** The minimal shape a caller needs to build the fixture lookup. */
export interface FixtureBookingLike {
  id: string;
  isTestData?: boolean | null;
}

/**
 * The set of booking ids that belong to a QA test run.
 *
 * `isTestData === true` and nothing else counts — a missing or
 * non-boolean flag means "not known to be a fixture", which is REAL.
 */
export function buildFixtureBookingIds(bookings: FixtureBookingLike[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(bookings)) return ids;
  for (const booking of bookings) {
    if (!booking) continue;
    if (booking.isTestData === true && booking.id) ids.add(booking.id);
  }
  return ids;
}

/**
 * The booking id a refund document belongs to.
 *
 * The refund document carries `bookingId`; the path is the fallback for
 * a legacy document written before the field existed. A refund under a
 * `reservations/{id}/` parent with no `bookingId` cannot be attributed
 * to a booking, so it returns `null` — and `null` is treated as REAL.
 */
export function refundBookingId(
  doc: { id?: string; ref?: { path?: string }; data?: () => any } | null | undefined
): string | null {
  const data = (() => {
    try {
      return doc?.data?.() || {};
    } catch {
      return {};
    }
  })();
  const explicit = data.bookingId;
  if (typeof explicit === "string" && explicit) return explicit;
  const path = doc?.ref?.path || "";
  const match = path.match(/^bookings\/([^/]+)\//);
  if (match) return match[1];
  return null;
}

/**
 * Is this refund a QA test-run fixture rather than real guest money?
 *
 * A refund whose booking cannot be identified is NOT a fixture — it is
 * treated as real guest money, on purpose.
 */
export function isFixtureRefund(
  doc: { id?: string; ref?: { path?: string }; data?: () => any } | null | undefined,
  fixtureBookingIds: Set<string>
): boolean {
  const bookingId = refundBookingId(doc);
  if (!bookingId) return false;
  return fixtureBookingIds.has(bookingId);
}

/**
 * Split a set of refund docs into the real ones and the fixture ones.
 */
export function splitFixtureRefunds<T extends { id?: string; ref?: { path?: string }; data?: () => any }>(
  docs: T[] | null | undefined,
  fixtureBookingIds: Set<string>
): { real: T[]; fixtures: T[] } {
  const real: T[] = [];
  const fixtures: T[] = [];
  for (const doc of docs || []) {
    if (isFixtureRefund(doc, fixtureBookingIds)) fixtures.push(doc);
    else real.push(doc);
  }
  return { real, fixtures };
}

/**
 * A short, plain sentence for a card's context line.
 *
 * "3 QA test fixtures (₱300.00) — rehearsal data, not guest money"
 */
export function fixtureNote(fixtureCount: number, fixtureAmount: number): string {
  if (fixtureCount <= 0) return "";
  const peso = `₱${fixtureAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${fixtureCount} QA test fixture${fixtureCount === 1 ? "" : "s"} (${peso}) — rehearsal data, not guest money`;
}
