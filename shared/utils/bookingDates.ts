export type DateLike = Date | { toDate: () => unknown } | { _seconds: number; _nanoseconds: number } | string | number | null | undefined;

export function toDateOrNow(value: DateLike): Date {
  const d = toDateOrNull(value);
  return d ?? new Date();
}

export function toDateOrNull(value: DateLike): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    const result = (value as { toDate: () => unknown }).toDate();
    if (result instanceof Date) return new Date(result.getTime());
    if (result && typeof (result as { toDate?: unknown }).toDate === "function") {
      const nested = (result as { toDate: () => unknown }).toDate();
      if (nested instanceof Date) return new Date(nested.getTime());
    }
    if (typeof value === "object" && value !== null) {
      const obj = value as { _seconds?: number; _nanoseconds?: number };
      if (typeof obj._seconds === "number") {
        const ms = obj._seconds * 1000 + Math.floor((obj._nanoseconds ?? 0) / 1_000_000);
        return new Date(ms);
      }
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as { _seconds?: number; _nanoseconds?: number };
    if (typeof obj._seconds === "number") {
      const ms = obj._seconds * 1000 + Math.floor((obj._nanoseconds ?? 0) / 1_000_000);
      return new Date(ms);
    }
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
