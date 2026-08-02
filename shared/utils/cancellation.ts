import { toDateOrNull } from "./bookingDates";

export interface CancellationPolicySnapshot {
  cutoffHours: number;
  refundPctBefore: number;
  refundPctAfter: number;
  policyText: string;
  scheduledCheckInTime: string; // The check-in ISO timestamp (UTC)
  source: "settings" | "corporate-override" | "legacy-fallback";
}

export interface CancellationEvaluation {
  refundPct: number;
  isBeforeCutoff: boolean;
  cutoffTimeMs: number;
  hoursRemaining: number;
  policySource: "settings" | "corporate-override" | "legacy-fallback";
}

export function parseCheckInTime(timeStr: string): { hours: number; minutes: number } {
  const normalized = timeStr.trim().toLowerCase();

  // Try 12h or 24h with colon: e.g. "14:00" or "2:00 PM"
  let match = normalized.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3];
    if (ampm === "pm" && hours < 12) {
      hours += 12;
    } else if (ampm === "am" && hours === 12) {
      hours = 0;
    }
    return { hours, minutes };
  }

  // Try 12h without colon: e.g. "2 PM" or "12 am"
  match = normalized.match(/^(\d{1,2})\s*(am|pm)$/);
  if (match) {
    let hours = parseInt(match[1]);
    const ampm = match[2];
    if (ampm === "pm" && hours < 12) {
      hours += 12;
    } else if (ampm === "am" && hours === 12) {
      hours = 0;
    }
    return { hours, minutes: 0 };
  }

  // Default fallback to 14:00
  return { hours: 14, minutes: 0 };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  const instantWithoutMilliseconds = Math.floor(date.getTime() / 1000) * 1000;
  return representedAsUtc - instantWithoutMilliseconds;
}

export function getCheckInInstant(dateKey: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const { hours, minutes } = parseCheckInTime(timeStr);
  const targetWallClock = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  let instant = targetWallClock;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timeZoneOffsetMs(new Date(instant), timeZone);
    const next = targetWallClock - offset;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function getLegacyCancellationPolicy(): string {
  return "Cancellations made 48 hours or more before check-in are eligible for a full refund. Cancellations within 48 hours of check-in are non-refundable. No-shows will be charged the full booking amount.";
}

export function evaluateCancellation(
  cancellationTime: Date | number,
  snapshot: CancellationPolicySnapshot | null | undefined,
  fallbackContext?: {
    checkInDateKey: string; // YYYY-MM-DD
    checkInTime?: string;   // e.g. "14:00"
    timeZone?: string;      // e.g. "Asia/Manila"
  }
): CancellationEvaluation {
  const cancellationMs = typeof cancellationTime === "number" ? cancellationTime : cancellationTime.getTime();

  const cutoffHours = snapshot?.cutoffHours ?? 48;
  const refundPctBefore = snapshot?.refundPctBefore ?? 100;
  const refundPctAfter = snapshot?.refundPctAfter ?? 0;
  const policySource = snapshot?.source ?? "legacy-fallback";

  let checkInMs: number;
  if (snapshot?.scheduledCheckInTime) {
    checkInMs = new Date(snapshot.scheduledCheckInTime).getTime();
  } else if (fallbackContext?.checkInDateKey) {
    checkInMs = getCheckInInstant(
      fallbackContext.checkInDateKey,
      fallbackContext.checkInTime || "14:00",
      fallbackContext.timeZone || "Asia/Manila"
    ).getTime();
  } else {
    checkInMs = Date.now();
  }

  const hoursRemaining = (checkInMs - cancellationMs) / (1000 * 60 * 60);
  const isBeforeCutoff = hoursRemaining >= cutoffHours;
  const cutoffTimeMs = checkInMs - (cutoffHours * 60 * 60 * 1000);
  const refundPct = isBeforeCutoff ? refundPctBefore : refundPctAfter;

  return {
    refundPct,
    isBeforeCutoff,
    cutoffTimeMs,
    hoursRemaining,
    policySource
  };
}

export function createCancellationPolicySnapshot(params: {
  websiteContent: {
    cancellationCutoffHours?: number;
    cancellationRefundPctBefore?: number;
    cancellationRefundPctAfter?: number;
    cancellationPolicy?: string;
  };
  hotelConfig: {
    checkInTime?: string;
    timezone?: string;
  };
  checkInDateKey: string; // YYYY-MM-DD
  corporateCodeData?: {
    cancellationCutoffHours?: number | null;
    cancellationRefundPctBefore?: number | null;
    cancellationRefundPctAfter?: number | null;
    cancellationPolicyText?: string | null;
  } | null;
}): CancellationPolicySnapshot {
  const tz = params.hotelConfig.timezone || "Asia/Manila";
  const stdCheckInTime = params.hotelConfig.checkInTime || "14:00";
  const checkInInstant = getCheckInInstant(params.checkInDateKey, stdCheckInTime, tz);

  let cutoffHours = typeof params.websiteContent.cancellationCutoffHours === "number"
    ? params.websiteContent.cancellationCutoffHours
    : 48;
  let refundPctBefore = typeof params.websiteContent.cancellationRefundPctBefore === "number"
    ? params.websiteContent.cancellationRefundPctBefore
    : 100;
  let refundPctAfter = typeof params.websiteContent.cancellationRefundPctAfter === "number"
    ? params.websiteContent.cancellationRefundPctAfter
    : 0;
  let policyText = params.websiteContent.cancellationPolicy || getLegacyCancellationPolicy();
  let source: "settings" | "corporate-override" | "legacy-fallback" = params.websiteContent.cancellationPolicy
    ? "settings"
    : "legacy-fallback";

  if (params.corporateCodeData) {
    let hasOverride = false;
    const corp = params.corporateCodeData;
    if (typeof corp.cancellationCutoffHours === "number") {
      cutoffHours = corp.cancellationCutoffHours;
      hasOverride = true;
    }
    if (typeof corp.cancellationRefundPctBefore === "number") {
      refundPctBefore = corp.cancellationRefundPctBefore;
      hasOverride = true;
    }
    if (typeof corp.cancellationRefundPctAfter === "number") {
      refundPctAfter = corp.cancellationRefundPctAfter;
      hasOverride = true;
    }
    if (typeof corp.cancellationPolicyText === "string" && corp.cancellationPolicyText.trim()) {
      policyText = corp.cancellationPolicyText.trim();
      hasOverride = true;
    }
    if (hasOverride) {
      source = "corporate-override";
    }
  }

  return {
    cutoffHours,
    refundPctBefore,
    refundPctAfter,
    policyText,
    scheduledCheckInTime: checkInInstant.toISOString(),
    source
  };
}
