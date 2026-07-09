import type { BookingRateLine, SeasonalRateOverride } from "../types";
import { eachStayNight, isWeekendNight, startOfDayUtc, type DateInput } from "./dates";

function dateKey(value: DateInput) {
  return startOfDayUtc(value).toISOString().slice(0, 10);
}

function appliesToRoomType(override: SeasonalRateOverride, roomType: string) {
  return override.roomTypeValues.length === 0 || override.roomTypeValues.includes(roomType);
}

export function normalizeSeasonalRateOverride(raw: unknown): SeasonalRateOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = String(entry.id ?? "").trim();
  const name = String(entry.name ?? "").trim();
  const startDate = String(entry.startDate ?? "").trim();
  const endDate = String(entry.endDate ?? "").trim();
  const rate = Number(entry.rate);
  if (!id || !name || !startDate || !endDate || !Number.isFinite(rate) || rate < 0) return null;

  return {
    id,
    name,
    startDate,
    endDate,
    rate,
    roomTypeValues: Array.isArray(entry.roomTypeValues)
      ? entry.roomTypeValues.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [],
    isActive: entry.isActive !== false
  };
}

export function normalizeSeasonalRateOverrides(raw: unknown): SeasonalRateOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeSeasonalRateOverride)
    .filter((entry): entry is SeasonalRateOverride => Boolean(entry));
}

export function getSeasonalRateForNight(
  night: DateInput,
  roomType: string,
  overrides: SeasonalRateOverride[]
): SeasonalRateOverride | null {
  const key = dateKey(night);
  const matches = overrides.filter((override) =>
    override.isActive &&
    key >= override.startDate &&
    key <= override.endDate &&
    appliesToRoomType(override, roomType)
  );
  if (matches.length === 0) return null;

  return matches.sort((a, b) => {
    const specificity = Number(b.roomTypeValues.length > 0) - Number(a.roomTypeValues.length > 0);
    if (specificity !== 0) return specificity;
    if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
    return b.id.localeCompare(a.id);
  })[0];
}

export function calculateSeasonalAwareRoomTotal(input: {
  checkIn: DateInput;
  checkOut: DateInput;
  roomType: string;
  baseRate: number;
  weekendRate?: number;
  seasonalRateOverrides?: SeasonalRateOverride[];
}) {
  return calculateSeasonalAwareRoomBreakdown(input).roomSubtotal;
}

export function calculateSeasonalAwareRoomBreakdown(input: {
  checkIn: DateInput;
  checkOut: DateInput;
  roomType: string;
  baseRate: number;
  weekendRate?: number;
  seasonalRateOverrides?: SeasonalRateOverride[];
}): { roomSubtotal: number; roomLines: BookingRateLine[] } {
  const baseRate = Math.max(0, Number(input.baseRate) || 0);
  const weekendRate = Math.max(0, Number(input.weekendRate) || 0);
  const overrides = input.seasonalRateOverrides ?? [];
  const lines: BookingRateLine[] = [];

  for (const night of eachStayNight(input.checkIn, input.checkOut)) {
    const date = dateKey(night);
    const seasonal = getSeasonalRateForNight(night, input.roomType, overrides);
    const line = seasonal
      ? { source: "seasonal" as const, label: seasonal.name, nightlyRate: seasonal.rate }
      : isWeekendNight(night) && weekendRate
        ? { source: "weekend" as const, label: "Weekend nights", nightlyRate: weekendRate }
        : { source: "regular" as const, label: "Regular nights", nightlyRate: baseRate };
    const previous = lines[lines.length - 1];
    if (previous && previous.source === line.source && previous.label === line.label && previous.nightlyRate === line.nightlyRate) {
      previous.endDate = date;
      previous.nights += 1;
      previous.subtotal += line.nightlyRate;
    } else {
      lines.push({
        source: line.source,
        label: line.label,
        startDate: date,
        endDate: date,
        nights: 1,
        nightlyRate: line.nightlyRate,
        subtotal: line.nightlyRate
      });
    }
  }

  return {
    roomSubtotal: lines.reduce((total, line) => total + line.subtotal, 0),
    roomLines: lines
  };
}
