import type { ReactNode } from "react";

interface StatsCardProps {
  label: string;
  value: string;
  trend?: string;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function StatsCard({ label, value, trend, icon, onClick, className }: StatsCardProps) {
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
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-950">{value}</p>
        </div>
        {icon ? <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-light text-primary">{icon}</span> : null}
      </div>
      {trend ? <p className="mt-4 text-sm font-medium text-green-700">{trend}</p> : null}
    </Component>
  );
}
