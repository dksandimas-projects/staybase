import { useId, useState, type ReactNode } from "react";
import { cn } from "../utils/cn";

type StatsTone = "primary" | "success" | "warning" | "info" | "neutral";

interface StatsCardProps {
  label: string;
  value: string;
  context?: string;
  trend?: string;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
  headerAction?: ReactNode;
  helpText?: string;
  tone?: StatsTone;
}

const toneClasses: Record<StatsTone, { card: string; icon: string; value: string; context: string }> = {
  primary: {
    card: "bg-white ring-gray-200",
    icon: "bg-primary-light text-primary",
    value: "text-gray-950",
    context: "text-primary-dark"
  },
  success: {
    card: "bg-green-50/40 ring-green-200",
    icon: "bg-green-50 text-green-700 ring-1 ring-green-200",
    value: "text-green-950",
    context: "text-green-700"
  },
  warning: {
    card: "bg-amber-50 ring-amber-200",
    icon: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    value: "text-amber-950",
    context: "text-amber-800"
  },
  info: {
    card: "bg-blue-50/40 ring-blue-200",
    icon: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    value: "text-blue-950",
    context: "text-blue-700"
  },
  neutral: {
    card: "bg-white ring-gray-200",
    icon: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
    value: "text-gray-700",
    context: "text-gray-500"
  }
};

export function StatsCard({ label, value, context, trend, icon, onClick, className, headerAction, helpText, tone = "primary" }: StatsCardProps) {
  const isClickable = !!onClick;
  const Component = isClickable ? "button" : "article";
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const classes = toneClasses[tone];

  return (
    <Component
      type={isClickable ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-card p-5 text-left w-full shadow-sm ring-1 transition",
        classes.card,
        isClickable ? "cursor-pointer hover:shadow-md active:bg-gray-100" : "",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[24px] items-center gap-2">
            {icon ? (
              <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", classes.icon)}>
                {icon}
              </span>
            ) : null}
            <p className="text-sm font-semibold text-gray-600">{label}</p>
            {helpText ? (
              <span className="relative inline-flex">
                <button
                  type="button"
                  onClick={() => setHelpOpen((open) => !open)}
                  onBlur={() => setHelpOpen(false)}
                  aria-expanded={helpOpen}
                  aria-controls={helpId}
                  aria-label={`About ${label}`}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 text-[11px] font-bold text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  i
                </button>
                <span
                  id={helpId}
                  role="tooltip"
                  className={
                    "absolute left-1/2 top-8 z-20 w-64 -translate-x-1/2 rounded-lg bg-gray-950 px-3 py-2 text-[11px] font-medium leading-relaxed text-white shadow-lg " +
                    (helpOpen ? "block" : "hidden")
                  }
                >
                  {helpText}
                </span>
              </span>
            ) : null}
          </div>
          <p
            className={cn("mt-3 text-2xl font-semibold sm:text-3xl", classes.value)}
            aria-label={value.includes("•") ? `${label} hidden` : undefined}
          >
            {value}
          </p>
          {context ? <p className={cn("mt-1 text-xs font-semibold leading-snug", classes.context)}>{context}</p> : null}
        </div>
        {headerAction ?? null}
      </div>
      {trend ? <p className="mt-4 text-sm font-medium text-green-700">{trend}</p> : null}
    </Component>
  );
}
