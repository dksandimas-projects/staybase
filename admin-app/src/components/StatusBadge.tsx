import { cn } from "../utils/cn";

type StatusTone =
  | "success"
  | "danger"
  | "warning"
  | "neutral"
  | "info"
  | "primary"
  | "purple";

const statusTone: Record<string, StatusTone> = {
  available: "success",
  confirmed: "success",
  clean: "success",
  occupied: "danger",
  cancelled: "danger",
  dirty: "danger",
  "check-in-today": "warning",
  warning: "warning",
  "in-progress": "warning",
  blocked: "neutral",
  "checked-out": "neutral",
  pending: "info",
  "checked-in": "primary",
  "payment-uploaded": "purple"
};

const toneClasses: Record<StatusTone, string> = {
  success: "bg-green-50 text-green-700 ring-green-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  neutral: "bg-gray-100 text-gray-600 ring-gray-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
  primary: "bg-primary-light text-primary-dark ring-primary",
  purple: "bg-violet-50 text-violet-700 ring-violet-200"
};

interface StatusBadgeProps {
  label: string;
  status?: string;
  className?: string;
}

export function StatusBadge({ label, status, className }: StatusBadgeProps) {
  const tone = statusTone[status ?? label.toLowerCase().replace(/\s+/g, "-")] ?? "neutral";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset",
        toneClasses[tone],
        className
      )}
    >
      {label}
    </span>
  );
}
