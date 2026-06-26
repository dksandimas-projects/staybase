function pad(value: number, length: number) {
  return String(value).padStart(length, "0");
}

function compactDate(value: Date) {
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1, 2);
  const day = pad(value.getDate(), 2);
  return `${year}${month}${day}`;
}

export function generateBookingRef(prefix: string, date: Date, sequence: number) {
  return `${prefix}-${compactDate(date)}-${pad(sequence, 3)}`;
}

export function generateMemberNumber(prefix: string, sequence: number) {
  return `${prefix}-${pad(sequence, 5)}`;
}

export function generateStoreOrderRef(date: Date, sequence: number) {
  return `SO-${compactDate(date)}-${pad(sequence, 3)}`;
}

export function nextSequence(currentHighestSequence: number | null | undefined) {
  return (currentHighestSequence ?? 0) + 1;
}

// Per BF-21 (booking-flow audit 2026-06-26): the
// canonical booking-ref shape is `<prefix>-YYYYMMDD-<seq>`
// where `<prefix>` is 1–4 uppercase letters (e.g. "SI",
// "INQ" — corporate), `<seq>` is 3–5 digits. Exported as
// a regex + helper so server-side validation can short-
// circuit malformed input before hitting Firestore.
export const BOOKING_REF_REGEX = /^[A-Z]{1,4}-\d{8}-\d{3,5}$/;

export function isValidBookingRef(value: unknown): value is string {
  return typeof value === "string" && BOOKING_REF_REGEX.test(value.trim());
}
