// Per BR-01 (Phase 13 — Breakfast Redesign, decision
// #231, 2026-10-12): the new meal-based breakfast model
// is gated by a server-enforced daily cutoff. The
// `cutoffForDate(serviceDate)` rule is
// `(serviceDate − 1 calendar day) at configured cutoffTime,
// in hotel timezone`. The server calls
// `computeBreakfastCutoffState` on every breakfast write
// to decide whether to accept the change; the client uses
// the same helper (exported via `@spark-inn/shared`) for
// the per-date countdown display, but the server is the
// authoritative gate.
//
// Per BR-10 (Phase 14 — Cut-off toggle + Skip add-ons,
// decision #244 reserved, 2026-10-14): the
// `cutoffsEnabled` flag on the input bypasses the lock
// when off. The math above is still run (so `cutoffAt`
// is populated for the UI to render the disabled hint),
// but `isLocked` is forced `false` and the response
// carries `reasonOrCutoff: "cutoffs-disabled"`. Every
// caller threads this flag from `breakfastConfig.cutoffsEnabled`
// (normalised to `true` for legacy docs by
// `normalizeBreakfastConfig`), so the bypass is global.
//
// The timezone math runs through the existing
// `getManilaDateInfo` helper shape (`toLocaleString` +
// `new Date(...)` round-trip) — see
// `shared/utils/bookingDates.ts` §`getManilaDateInfo` for
// the rationale. The hotel timezone comes from
// `hotel.config.ts` (default "Asia/Manila" per the
// constants file).

/**
 * The per-date cutoff state for one breakfast date.
 *
 * Returned by `computeBreakfastCutoffState`. Server
 * consumers gate every add / change / remove against
 * `isLocked`; client consumers render the countdown via
 * `minutesUntilCutoff`.
 *
 * Per BR-10 (decision #244 reserved, 2026-10-14 — Phase 14):
 * the `reasonOrCutoff` field carries an enum-stable label so
 * the client can render a per-state hint without re-running
 * the lock math itself. Values:
 *   - omitted (or absent on the wire) — the normal cutoff
 *     arm; the date is either locked or unlocked per the
 *     time-of-day rule.
 *   - `"cutoffs-disabled"` — the admin has flipped
 *     `cutoffsEnabled` off on `BreakfastConfig`. The cutoff
 *     math was still run (so `cutoffAt` is populated for the
 *     UI to render the would-be moment), but `isLocked` is
 *     forced `false` regardless.
 */
export interface CutoffState {
  /** True when `now >= cutoffAt` AND cutoffs are enabled (server-side authoritative gate). */
  isLocked: boolean;
  /** Minutes until the cutoff. Negative when locked. */
  minutesUntilCutoff: number;
  /** The cutoff instant as an ISO string in the hotel timezone. */
  cutoffAt: string;
  /** The service date the cutoff applies to (`YYYY-MM-DD`). */
  serviceDate: string;
  /**
   * Optional enum-stable reason label. Absent on the normal
   * cutoff arm; `"cutoffs-disabled"` when the admin toggle
   * bypassed the lock (per BR-10). String shape is stable so
   * a future feature can add new reasons without an interface
   * break.
   */
  reasonOrCutoff?: "cutoffs-disabled";
}

export interface ComputeCutoffStateInput {
  /** Service date (`YYYY-MM-DD`) the breakfast is served on. */
  serviceDate: string;
  /** Current wall clock (server time). */
  now: Date;
  /** Cutoff time of day (`HH:MM` 24h, e.g. `"20:00"`). */
  cutoffTime: string;
  /** IANA timezone string (e.g. `"Asia/Manila"`). */
  timezone: string;
  /**
   * Optional per BR-10 (decision #244 reserved, 2026-10-14 —
   * Phase 14). When `false`, the function short-circuits to
   * `isLocked: false` regardless of `now` vs. `cutoffAt`.
   * `cutoffAt` is still populated (the rule is still computed)
   * so the UI can render the disabled hint. Default `true` for
   * back-compat — pre-BR-10 callers that omit the flag keep
   * the locked behaviour they had before.
   */
  cutoffsEnabled?: boolean;
}

/**
 * Validate that `value` looks like a `YYYY-MM-DD` calendar
 * date and parses as a real date (not `2026-13-99` etc.).
 *
 * Local to this file because no existing helper covers the
 * "is this a real calendar date, not just a regex match"
 * check. Returns the Date in UTC midnight on success, null
 * on failure.
 */
function parseServiceDateUtc(value: string): Date | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through Date to catch invalid combinations
  // (e.g. "2026-02-31" silently rolls over to March 3 in
  // `new Date(...)`). Compare the parsed components to the
  // input — any disagreement means the input was bogus.
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}

/**
 * Validate that `value` matches the `HH:MM` 24h format and
 * the hour / minute are in range. Returns the parsed
 * `{ hour, minute }` on success, null on failure.
 */
function parseCutoffTime(value: string): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Validate that the timezone is a usable IANA zone. The
 * cheap check is `Intl.DateTimeFormat` — invalid zones throw
 * `RangeError` on construction. Returns `true` when the
 * zone is accepted.
 */
function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== "string" || timezone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert "wall-clock HH:MM in `timezone` on `dateUtc`" to
 * an absolute UTC `Date`.
 *
 * Implementation: subtract the timezone offset for the
 * target wall-clock time, computed via the
 * `Intl.DateTimeFormat` parts trick (same approach as the
 * `getManilaDateInfo` helper). The offset is the difference
 * between the wall-clock interpretation and UTC for the
 * target instant — DST-aware via Intl.
 */
function zonedWallClockToUtc(
  dateUtc: Date,
  hour: number,
  minute: number,
  timezone: string
): Date {
  // Build a "naive" UTC instant at the requested wall-clock.
  const naiveUtcMs = Date.UTC(
    dateUtc.getUTCFullYear(),
    dateUtc.getUTCMonth(),
    dateUtc.getUTCDate(),
    hour,
    minute,
    0,
    0
  );
  // Read the timezone offset for that instant via Intl. The
  // formatted wall-clock minus the UTC instant gives the
  // timezone's offset (in minutes) for that instant.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date(naiveUtcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Missing Intl part: ${type}`);
    return Number(found.value);
  };
  const tzAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second")
  );
  const offsetMs = tzAsUtcMs - naiveUtcMs;
  return new Date(naiveUtcMs - offsetMs);
}

/**
 * Compute the per-date cutoff state for one breakfast
 * service date.
 *
 * Returns a "safe locked" state — `{ isLocked: true,
 * minutesUntilCutoff: 0, cutoffAt: <now iso>,
 * serviceDate: <input or ""> }` — and `console.error`s
 * the reason when:
 *   - `serviceDate` is not a valid `YYYY-MM-DD` calendar date
 *   - `cutoffTime` is not a valid `HH:MM` 24h string
 *   - `timezone` is not a valid IANA zone
 *
 * The "fail to locked" behavior is defensive on purpose —
 * a misconfigured Settings entry must NOT silently allow
 * late changes; it must lock the date so the kitchen has a
 * finalized list. The error is logged for ops to investigate
 * (the misconfiguration surfaces in the Settings save flow
 * via the new BR-02 Zod validators before it ever reaches
 * this helper).
 *
 * @param input {@link ComputeCutoffStateInput}
 * @returns {@link CutoffState}
 */
export function computeBreakfastCutoffState(input: ComputeCutoffStateInput): CutoffState {
  const safeReturn = (reason: string): CutoffState => {
    // Per BR-01 defensive design: never throw from this hot
    // path. Log and return a "locked" state. The cut-off
    // server gate (BR-04 / BR-05) rejects the write because
    // `isLocked === true`, and ops can chase the misconfig
    // from the console log.
    // eslint-disable-next-line no-console
    console.error(
      `[breakfastCutoff] ${reason}; returning locked state for serviceDate=${input?.serviceDate}`
    );
    return {
      isLocked: true,
      minutesUntilCutoff: 0,
      cutoffAt: input?.now instanceof Date ? input.now.toISOString() : new Date(0).toISOString(),
      serviceDate: typeof input?.serviceDate === "string" ? input.serviceDate : ""
    };
  };

  if (!input || !(input.now instanceof Date)) {
    return safeReturn("invalid `now` argument");
  }
  const serviceDateUtc = parseServiceDateUtc(input.serviceDate);
  if (!serviceDateUtc) {
    return safeReturn(`invalid serviceDate (${input.serviceDate})`);
  }
  const cutoff = parseCutoffTime(input.cutoffTime);
  if (!cutoff) {
    return safeReturn(`invalid cutoffTime (${input.cutoffTime})`);
  }
  if (!isValidTimezone(input.timezone)) {
    return safeReturn(`invalid timezone (${input.timezone})`);
  }

  // Cutoff rule: `(serviceDate − 1 calendar day) at
  // cutoffTime` in the hotel timezone. We compute the
  // previous calendar day in the SAME timezone (a calendar
  // boundary in `Asia/Manila` is +8 from UTC, so this
  // matters around midnight UTC).
  const previousDayUtc = new Date(serviceDateUtc);
  previousDayUtc.setUTCDate(previousDayUtc.getUTCDate() - 1);

  // Convert the previous day's wall-clock at HH:MM in
  // `timezone` to a UTC instant.
  const cutoffAt = zonedWallClockToUtc(
    previousDayUtc,
    cutoff.hour,
    cutoff.minute,
    input.timezone
  );

  const nowMs = input.now.getTime();
  const cutoffMs = cutoffAt.getTime();
  const isLocked = nowMs >= cutoffMs;
  const minutesUntilCutoff = Math.floor((cutoffMs - nowMs) / 60_000);

  // Per BR-10 (decision #244 reserved, 2026-10-14 — Phase 14):
  // the admin-side "Cut-offs enabled" toggle short-circuits
  // the lock when off. We always compute the rule above so
  // `cutoffAt` is populated for the UI to render the
  // "would-be cutoff" hint, but we override `isLocked` to
  // `false` and stamp `reasonOrCutoff: "cutoffs-disabled"`.
  // The flag defaults to `true` so pre-BR-10 callers
  // (omitting the field) preserve the locked behaviour
  // they had before this change.
  if (input.cutoffsEnabled === false) {
    return {
      isLocked: false,
      // The countdown is meaningless when cut-offs are off,
      // but expose a large sentinel so any client renderer
      // accidentally feeding `minutesUntilCutoff` into a
      // "minutes remaining" line shows "always open" instead
      // of a negative countdown.
      minutesUntilCutoff: Number.MAX_SAFE_INTEGER,
      cutoffAt: cutoffAt.toISOString(),
      serviceDate: input.serviceDate,
      reasonOrCutoff: "cutoffs-disabled"
    };
  }

  return {
    isLocked,
    minutesUntilCutoff,
    cutoffAt: cutoffAt.toISOString(),
    serviceDate: input.serviceDate
  };
}