import type { BreakfastSelectionEntry } from "@shared/types";

export type BreakfastSelections = Record<string, BreakfastSelectionEntry>;

export interface CopyBreakfastDateInput {
  /** Current selections map, keyed `${serviceDate}-${slotId}`. */
  selections: BreakfastSelections;
  /** The date whose guest-slot choices are copied FROM. */
  sourceDate: string;
  /**
   * Dates to copy TO, in stay order. Callers MUST pass only dates
   * that are still editable — the helper deliberately does not know
   * about cut-off locks, because "never overwrite a locked date" is a
   * gate the caller owns and already computes.
   */
  targetDates: string[];
  /** Guest slot ids to copy, in render order. */
  slotIds: string[];
  /** Injectable clock so tests are deterministic. */
  now: string;
}

export interface CopyBreakfastDateResult {
  selections: BreakfastSelections;
  /** How many target dates actually received a change. */
  updatedDates: number;
}

export function breakfastSlotKey(serviceDate: string, slotId: string): string {
  return `${serviceDate}-${slotId}`;
}

/**
 * Per OCT-M8 (2026-10-20, decision #294): how long the "copied to the
 * remaining days" confirmation stays on screen.
 *
 * The confirmation is transient by nature — it reports what a single tap
 * just did. Left up forever it reads as a standing status ("these choices
 * are set for your whole stay") and it can contradict the guest's own
 * later edits. Eight seconds is long enough to read a one-line message
 * and short enough that it cannot be mistaken for permanent state.
 */
export const BREAKFAST_COPY_NOTICE_TIMEOUT_MS = 8000;

export interface BreakfastCopyNotice {
  /**
   * The service date whose card the confirmation belongs to. The notice
   * is rendered INSIDE the per-date map, so without this anchor the same
   * string would be rendered once per date — a 3-night stay showed
   * "Applied these choices to 2 remaining days." three times.
   */
  date: string;
  message: string;
}

/**
 * Build the copy confirmation for a tap on "use these choices for all
 * remaining days".
 *
 * The count is the number of dates that ACTUALLY changed, so the message
 * can never overstate what the tap did.
 */
export function buildBreakfastCopyNotice(
  sourceDate: string,
  updatedDates: number
): BreakfastCopyNotice {
  const message =
    updatedDates === 0
      ? "Those choices are already set on every remaining day."
      : `Applied these choices to ${updatedDates} remaining day${
          updatedDates === 1 ? "" : "s"
        }.`;
  return { date: sourceDate, message };
}

/**
 * Whether the confirmation should be rendered inside the card for
 * `date`. Exactly one card matches — the one the guest acted on.
 *
 * Declared as a type guard so the call site narrows the notice to
 * non-null and can read `.message` without a second check.
 */
export function shouldShowBreakfastCopyNotice(
  notice: BreakfastCopyNotice | null,
  date: string
): notice is BreakfastCopyNotice {
  return notice !== null && notice.date === date;
}

/**
 * Per MBUX-05 (decision #257, 2026-10-15): copy one breakfast date's
 * guest-slot choices onto the remaining editable dates.
 *
 * A multi-night stay means the same meal matrix repeated N times. On a
 * phone that is the single most tedious thing in the booking flow: a
 * guest travelling with three others picks the same four meals every
 * morning and has to re-pick them by hand for every night.
 *
 * The four rules that make this safe:
 *
 * 1. **`No breakfast` is a real choice and it copies.** An empty slot
 *    on the source date clears the matching target slot rather than
 *    leaving the target's stale value behind. Copying only the filled
 *    slots would produce a result that differs from what the guest
 *    actually chose on the source date.
 * 2. **Locked dates are never touched.** The caller passes only
 *    editable targets — lock state is a cut-off computation the caller
 *    already performs, and re-deriving it here would be a second
 *    source of truth that could disagree.
 * 3. **The snapshot is re-stamped, not shared.** Each copied entry
 *    gets fresh audit timestamps. The `mealId` / `mealName` / `price`
 *    triple is copied verbatim — that IS the snapshot, and copying it
 *    by reference would make a later mutation of one date's entry
 *    silently rewrite another's.
 * 4. **`updatedDates` counts real changes only.** A target date that
 *    already held exactly these choices is not counted, so the
 *    confirmation the guest reads ("Updated 3 days") is never
 *    inflated.
 */
export function copyBreakfastDateToRemaining(
  input: CopyBreakfastDateInput
): CopyBreakfastDateResult {
  const { selections, sourceDate, targetDates, slotIds, now } = input;

  const sourceHasAnyChoice = slotIds.some((slotId) =>
    Boolean(selections[breakfastSlotKey(sourceDate, slotId)])
  );

  if (!sourceHasAnyChoice || targetDates.length === 0) {
    return { selections, updatedDates: 0 };
  }

  const next: BreakfastSelections = { ...selections };
  let updatedDates = 0;

  for (const targetDate of targetDates) {
    let changedThisDate = false;

    for (const slotId of slotIds) {
      const targetKey = breakfastSlotKey(targetDate, slotId);
      const source = selections[breakfastSlotKey(sourceDate, slotId)];

      if (!source) {
        // Rule 1: an empty source slot clears the target.
        if (targetKey in next) {
          delete next[targetKey];
          changedThisDate = true;
        }
        continue;
      }

      const existing = next[targetKey];
      const isSameChoice =
        existing &&
        existing.mealId === source.mealId &&
        existing.mealName === source.mealName &&
        existing.price === source.price;

      if (isSameChoice) continue;

      // Rule 3: fresh audit fields, copied snapshot triple.
      next[targetKey] = {
        ...source,
        addedAt: now,
        lastModifiedAt: now,
        lastModifiedBy: "guest"
      };
      changedThisDate = true;
    }

    // Rule 4: count dates that actually changed.
    if (changedThisDate) updatedDates += 1;
  }

  return { selections: next, updatedDates };
}