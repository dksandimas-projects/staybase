import type { ReactNode } from "react";

interface StatsCardProps {
  label: string;
  value: string;
  trend?: string;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
  headerAction?: ReactNode;
  helpText?: string;
}

export function StatsCard({ label, value, trend, icon, onClick, className, headerAction, helpText }: StatsCardProps) {
  const isClickable = !!onClick;
  const Component = isClickable ? "button" : "article";

  return (
    <Component
      type={isClickable ? "button" : undefined}
      onClick={onClick}
      className={
        "rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 text-left w-full " +
        (isClickable ? "hover:bg-gray-50 active:bg-gray-100 transition cursor-pointer " : "") +
        (className || "")
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-h-[24px] items-center gap-2">
            <p className="text-sm font-medium text-gray-500">{label}</p>
            {helpText ? (
              <span
                tabIndex={0}
                title={helpText}
                aria-label={helpText}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 text-[11px] font-bold text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                i
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-3xl font-semibold text-gray-950">{value}</p>
        </div>
        {headerAction ?? (icon ? <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-light text-primary">{icon}</span> : null)}
      </div>
      {trend ? <p className="mt-4 text-sm font-medium text-green-700">{trend}</p> : null}
    </Component>
  );
}
