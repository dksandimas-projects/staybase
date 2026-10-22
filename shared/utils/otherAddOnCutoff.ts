// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the per-add-on cut-off state helper.
//
// Mirrors `computeBreakfastCutoffState` (BR-01) but the rule
// is per-add-on (`cutoffHoursBeforeCheckIn` hours before the
// check-in date) instead of per-hotel (a single `cutoffTime`
// of day). The decision axis is:
//
//   1. `addOn.isEnabled === false` → locked with
//      `reasonOrCutoff: "addons-disabled"` (mirrors the
//      breakfast `"cutoffs-disabled"` label).
//   2. `now >= cutoffAt` → locked with `reasonOrCutoff:
//      "cutoff-passed"` (the actual time has passed).
//   3. otherwise → unlocked.
//
// `cutoffAt` is always returned (even when the add-on is
// disabled) so the UI can render a "would-be cutoff" hint.
// BR-12 v1 does NOT have a hotel-wide `otherAddOnCutoffsEnabled`
// toggle (that's a future BR-13 add). When the per-add-on
// `isEnabled === false`, the helper returns `isLocked: true`
// directly — the catalog disable is itself a lock.

export interface OtherAddOnCutoffState {
  isLocked: boolean;
  cutoffAt: string;
  minutesUntilCutoff: number;
  /** Diagnostic label — `"addons-disabled"` for catalog-off, `"cutoff-passed"` for time-passed, otherwise `undefined`. */
  reasonOrCutoff?: "addons-disabled" | "cutoff-passed";
}

export interface ComputeOtherAddOnCutoffStateInput {
  /** The booking's check-in date (`yyyy-mm-dd`). */
  checkInDate: string;
  /**
   * Snapshot from the catalog (the `AddOn` row at the booking's snapshot time, NOT the live doc).
   *
   * `isEnabled` is OPTIONAL on purpose: the PUBLIC catalog payload
   * (`GET /api/bookings/addons/config`) deliberately does not carry it
   * — the endpoint already dropped the disabled rows — so a row read
   * from that endpoint has no `isEnabled` at all. Making the field
   * required forced the admin app to cast the public rows to the
   * internal `AddOn` shape (`as AddOn[]`), which is a type lie that
   * hid the fact that `isEnabled` was `undefined` at runtime.
   * `undefined` is treated as "not disabled" (rule 1 only fires on an
   * explicit `false`), which is exactly right for an
   * already-filtered public row.
   */
  addOn: { cutoffHoursBeforeCheckIn: number; isEnabled?: boolean };
  /** Defaults to `new Date()` when omitted. */
  now?: Date;
}

/**
 * Compute the per-add-on cut-off state for one booking's
 * check-in date. Returns `isLocked` + the absolute cutoff
 * timestamp + a minutes-until-cutoff number (negative when
 * past, `Number.MAX_SAFE_INTEGER` when the add-on is
 * disabled).
 *
 * The composite "selection key" (date + addOnId) is built
 * at the call site — this helper only knows the per-add-on
 * rules, not which add-on is being checked. Callers must
 * call once per (date, addOn) pair.
 */
export function computeOtherAddOnCutoffState(
  input: ComputeOtherAddOnCutoffStateInput
): OtherAddOnCutoffState {
  const { checkInDate, addOn, now = new Date() } = input;

  // The base cutoff is `checkInDate - cutoffHoursBeforeCheckIn`.
  // We anchor the date at UTC midnight (same pattern as the
  // breakfast `enumerateBreakfastDates` helper) so the math
  // is timezone-stable on the API server. A future BR-13 may
  // thread the hotel timezone — v1 uses UTC so the lock
  // semantics are deterministic across all staff + guest
  // clients.
  const checkInMs = Date.parse(`${checkInDate}T00:00:00Z`);
  if (!Number.isFinite(checkInMs)) {
    return {
      isLocked: false,
      cutoffAt: now.toISOString(),
      minutesUntilCutoff: Number.MAX_SAFE_INTEGER
    };
  }
  const leadHours = Math.min(168, Math.max(0, Number(addOn.cutoffHoursBeforeCheckIn) || 24));
  const cutoffMs = checkInMs - leadHours * 3_600_000;
  const cutoffAt = new Date(cutoffMs).toISOString();
  const minutesUntilCutoff = Math.floor((cutoffMs - now.getTime()) / 60_000);

  if (addOn.isEnabled === false) {
    return {
      isLocked: true,
      cutoffAt,
      minutesUntilCutoff: Number.MAX_SAFE_INTEGER,
      reasonOrCutoff: "addons-disabled"
    };
  }
  if (now.getTime() >= cutoffMs) {
    return {
      isLocked: true,
      cutoffAt,
      minutesUntilCutoff,
      reasonOrCutoff: "cutoff-passed"
    };
  }
  return { isLocked: false, cutoffAt, minutesUntilCutoff };
}