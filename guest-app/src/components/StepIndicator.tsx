import { Check } from "lucide-react";
import { cn } from "../utils/cn";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <ol className="grid gap-3 sm:grid-cols-4">
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
