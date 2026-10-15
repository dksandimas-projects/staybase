import type { ReactNode } from "react";
import { cn } from "../utils/cn";

interface BookingStickyFooterProps {
  /** Left-hand block: the compact summary for the current decision. */
  summary: ReactNode;
  /** The step's action(s). One primary action per MBUX decision #17. */
  children: ReactNode;
  /**
   * Optional full-width strip rendered BELOW the summary/action row —
   * used by Step 1 for the occupancy-recovery guidance. Kept outside the
   * row so a long message can wrap across the footer instead of
   * squeezing the primary action.
   */
  detail?: ReactNode;
  className?: string;
}

/**
 * The shared sticky action footer for every step of the guest booking
 * flow (public `/book` + corporate `/corporate/book`).
 *
 * **Why this was extracted (MBUX-01, decision #253 reserved, 2026-10-15).**
 * All eight call sites — four steps on each page — carried a
 * byte-identical wrapper string. Standardising them in one component
 * is what makes the rules below enforceable rather than aspirational:
 *
 * **1. iOS safe-area padding.** The pre-MBUX-01 footer used a flat
 * `py-4`, so on a notched iPhone the home indicator sat on top of the
 * primary action and the button was only partly tappable.
 * `FRONTEND.md §Admin App — Mobile UX Checklist` already requires
 * `pb-[env(safe-area-inset-bottom)]` on sticky footers; the booking
 * flow was the surface that had been missing it. The padding is
 * `calc(...)` so it degrades to the plain 1rem on browsers that report
 * no inset.
 *
 * **2. Matching content reserve.** A fixed footer hides whatever sits
 * under it. Both booking shells therefore pair this component with
 * `pb-[calc(8rem+env(safe-area-inset-bottom))]` so the last interactive
 * element is never covered — MBUX's "never covers the last interactive
 * element" rule.
 *
 * **3. 44px targets.** The action slot is `w-full` on mobile so the
 * `PrimaryButton` spans the row and clears the 44px minimum on its own,
 * rather than relying on the caller.
 *
 * **Scope note.** This component standardises the footer's SHELL only.
 * It does not change which actions a step renders: Step 2's two
 * post-BR-10 CTAs and Step 4's `Place booking` stay exactly as they are
 * until MBUX-05 / MBUX-07 consolidate them. Merging those into "one
 * context-aware action" is a behaviour change and belongs to its own
 * task, not to a layout extraction.
 */
export function BookingStickyFooter({ summary, children, detail, className }: BookingStickyFooterProps) {
  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 pt-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur",
        "pb-[calc(1rem+env(safe-area-inset-bottom))]",
        className
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">{summary}</div>
        <div className="w-full sm:w-auto sm:min-w-56">{children}</div>
      </div>
      {detail}
    </div>
  );
}