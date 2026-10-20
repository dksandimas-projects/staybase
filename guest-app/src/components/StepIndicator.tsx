import { Check } from "lucide-react";
import { cn } from "../utils/cn";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

/**
 * Per MBUX-01 (decision #253 reserved, 2026-10-15): the mobile
 * stepper is five connected positions in ONE row, with only the
 * current step's name visible.
 *
 * **Why the layout used to break.** The pre-MBUX-01 component kept
 * all five labels visible inside a `flex flex-wrap` row. At phone
 * widths five `Circle + Label` pairs do not fit on one line, so the
 * indicator wrapped into a tall two- or three-row block and pushed
 * the page's real content below the fold. It also repeated the
 * current step twice — once as a labelled circle and again as the
 * page's own `Step N of 5` eyebrow.
 *
 * **What replaces it.** Below `sm:` the labels collapse and the five
 * circles share the width evenly, joined by connector lines, with a
 * single caption underneath: `Step N of 5 · Current step name`. That
 * caption is why the page eyebrows are now `hidden sm:block` — the
 * position is stated once, not twice. From `sm:` up the full labelled
 * layout is retained unchanged, so desktop and the existing wide-screen
 * QA matrix are byte-equivalent.
 *
 * **State is never carried by colour alone.** A completed step pairs
 * the check glyph with an `sr-only` "Completed", the current step keeps
 * its number (a check alone would make the current position ambiguous —
 * see `BOOKING-MOBILE-UX.md §Rejected Alternatives`), and an upcoming
 * step keeps its number in gray.
 *
 * **Accessibility.** Ordered-list semantics are preserved (`<ol>`/`<li>`),
 * every step keeps an accessible name even where its label is visually
 * hidden (`sr-only` → `sm:not-sr-only`), and the current item carries
 * `aria-current="step"`. The visible caption is `aria-hidden` because it
 * would otherwise restate the `aria-current` step's own name.
 *
 * **Reduced motion.** The connector is a static 1px rule with no
 * transition, so there is nothing to suppress.
 *
 * BR-09 (2026-10-14) still applies: the step count is NOT hardcoded
 * (the public flow renders 5 entries, the corporate flow may differ),
 * and the legacy 4-column grid utility must stay gone —
 * `guest-app/tests/api/br-09-step-flow.test.ts` pins both. (That pin is
 * a source-text regex over this whole file, so the token is deliberately
 * never spelled out in this comment — see GOTCHAS.md's DR-01 note on
 * tests whose assertions must not be "restored" by copying a literal.)
 */
export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  const currentLabel = steps[currentStep - 1] ?? "";
  const total = steps.length;

  return (
    <div>
      <ol className="flex items-start sm:gap-x-4 sm:gap-y-3">
        {steps.map((step, index) => {
          const number = index + 1;
          const complete = number < currentStep;
          const active = number === currentStep;

          return (
            <li
              key={step}
              aria-current={active ? "step" : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center sm:flex-none sm:flex-row sm:items-center sm:gap-3"
            >
              {/* Connector to the previous position. Spans the full cell
                  width; the circle below paints over both of its ends
                  with a solid background, so the visible line runs from
                  one circle's edge to the next. Decorative — the step
                  names carry the meaning, not the rule. */}
              {index > 0 ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-[13.5px] h-px bg-gray-200 sm:hidden"
                />
              ) : null}
              <span
                className={cn(
                  "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset sm:h-9 sm:w-9 sm:text-sm",
                  complete || active
                    ? "bg-primary text-white ring-primary"
                    : "bg-white text-gray-500 ring-gray-200"
                )}
              >
                {complete ? (
                  <>
                    <Check size={14} aria-hidden />
                    <span className="sr-only">Completed</span>
                  </>
                ) : (
                  number
                )}
              </span>
              {/* Visually hidden on mobile, visible from `sm:` up. The
                  `not-sr-only` flip keeps the text in the accessibility
                  tree at every width, which is what gives each step its
                  accessible name once the label is not painted. */}
              <span
                className={cn(
                  "sr-only text-sm font-medium sm:not-sr-only",
                  active ? "text-gray-950" : "text-gray-500"
                )}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      {currentLabel ? (
        <p
          aria-hidden
          className="mt-2 text-center text-xs font-medium text-gray-600 sm:hidden"
          data-testid="step-indicator-caption"
        >
          Step {currentStep} of {total} · {currentLabel}
        </p>
      ) : null}
    </div>
  );
}