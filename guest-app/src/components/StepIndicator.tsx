import { Check } from "lucide-react";
import { cn } from "../utils/cn";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

/**
 * Per BR-09 (2026-10-14): the stepper now adapts to any
 * step count (the BR-09 refactor split Step 2 into two
 * steps, so the public booking flow renders 5 entries
 * instead of 4). The grid uses a flex layout so the
 * per-row gap scales with the count without forcing a
 * hardcoded column count.
 */
export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-3">
      {steps.map((step, index) => {
        const number = index + 1;
        const complete = number < currentStep;
        const active = number === currentStep;

        return (
          <li key={step} className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset",
                complete || active
                  ? "bg-primary text-white ring-primary"
                  : "bg-white text-gray-500 ring-gray-200"
              )}
            >
              {complete ? <Check size={16} /> : number}
            </span>
            <span className={cn("text-sm font-medium", active ? "text-gray-950" : "text-gray-500")}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
