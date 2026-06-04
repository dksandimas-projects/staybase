import type { ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

interface QuickRequestChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function QuickRequestChip({ active = false, className, children, ...props }: QuickRequestChipProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition",
        active ? "bg-primary text-white" : "bg-primary-light text-primary hover:bg-primary hover:text-white",
        className
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
