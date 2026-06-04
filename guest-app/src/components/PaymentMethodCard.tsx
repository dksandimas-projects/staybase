import type { ReactNode } from "react";
import { cn } from "../utils/cn";

interface PaymentMethodCardProps {
  label: string;
  description: string;
  icon?: ReactNode;
  checked: boolean;
  onSelect: () => void;
}

export function PaymentMethodCard({ label, description, icon, checked, onSelect }: PaymentMethodCardProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-24 w-full items-start gap-4 rounded-card border bg-white p-4 text-left transition",
        checked ? "border-primary ring-2 ring-primary-light" : "border-gray-200 hover:border-primary"
      )}
      onClick={onSelect}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
        {icon}
      </span>
      <span>
        <span className="block font-semibold text-gray-950">{label}</span>
        <span className="mt-1 block text-sm leading-5 text-gray-600">{description}</span>
      </span>
    </button>
  );
}
