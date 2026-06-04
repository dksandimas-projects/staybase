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
