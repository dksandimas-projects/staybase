import type { SeasonalRateOverride } from "../types";
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
  const baseRate = Math.max(0, Number(input.baseRate) || 0);
  const weekendRate = Math.max(0, Number(input.weekendRate) || 0);
  const overrides = input.seasonalRateOverrides ?? [];

  return eachStayNight(input.checkIn, input.checkOut).reduce((total, night) => {
    const seasonal = getSeasonalRateForNight(night, input.roomType, overrides);
    if (seasonal) return total + seasonal.rate;
    if (isWeekendNight(night) && weekendRate) return total + weekendRate;
    return total + baseRate;
  }, 0);
}
