import type { ReactNode } from "react";

interface StatsCardProps {
  label: string;
  value: string;
  trend?: string;
  icon?: ReactNode;
}

export function StatsCard({ label, value, trend, icon }: StatsCardProps) {
  return (
    <article className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-950">{value}</p>
        </div>
        {icon ? <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-light text-primary">{icon}</span> : null}
      </div>
      {trend ? <p className="mt-4 text-sm font-medium text-green-700">{trend}</p> : null}
    </article>
  );
}
