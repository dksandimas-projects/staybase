export type DateInput = Date | string | number;

function toDate(value: DateInput) {
  return value instanceof Date ? new Date(value) : new Date(value);
}

export function startOfDayUtc(value: DateInput) {
  const date = toDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getNumNights(checkIn: DateInput, checkOut: DateInput) {
  const start = startOfDayUtc(checkIn).getTime();
  const end = startOfDayUtc(checkOut).getTime();
  return Math.max(Math.round((end - start) / 86_400_000), 0);
}

export function datesOverlap(
  firstCheckIn: DateInput,
  firstCheckOut: DateInput,
  secondCheckIn: DateInput,
  secondCheckOut: DateInput
) {
  return toDate(firstCheckIn) < toDate(secondCheckOut) && toDate(firstCheckOut) > toDate(secondCheckIn);
}

export function eachStayNight(checkIn: DateInput, checkOut: DateInput) {
  const nights = getNumNights(checkIn, checkOut);
  const cursor = startOfDayUtc(checkIn);

  return Array.from({ length: nights }, (_, index) => {
    const date = new Date(cursor);
    date.setUTCDate(cursor.getUTCDate() + index);
    return date;
  });
}

export function isWeekendNight(value: DateInput) {
  const day = startOfDayUtc(value).getUTCDay();
  return day === 0 || day === 6;
}

export function getWeekendNightCount(checkIn: DateInput, checkOut: DateInput) {
  return eachStayNight(checkIn, checkOut).filter(isWeekendNight).length;
}
