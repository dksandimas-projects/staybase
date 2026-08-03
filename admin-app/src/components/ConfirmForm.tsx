import { useState, type ReactNode } from "react";
import { cn } from "../utils/cn";

interface ConfirmFormProps {
  title: string;
  message: ReactNode;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonRequired?: boolean;
  // Per MRB-13 (2026-08-02, per decision #166):
  // optional extra fields rendered between the
  // reason textarea and the action row. The
  // BookingsPage cancel modal uses this slot to
  // surface the `This room` / `All N rooms` scope
  // selector for reservation-scope cancels. Other
  // callers (order cancel, discount reject) keep
  // the legacy reason-only shape.
  additionalFields?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  testId?: string;
}

export function ConfirmForm({
  title,
  message,
  reasonLabel,
  reasonPlaceholder,
  reasonRequired = false,
  additionalFields,
  confirmLabel,
  cancelLabel = "Back",
  variant = "primary",
  onConfirm,
  onCancel,
  testId
}: ConfirmFormProps) {
  const [reason, setReason] = useState("");
  const canConfirm = !reasonRequired || reason.trim().length > 0;

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
      data-testid={testId}
      role="alertdialog"
      aria-label={title}
    >
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <div className="mt-1 text-xs leading-relaxed text-gray-600">{message}</div>
      <label className="mt-3 block">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {reasonLabel ?? "Reason (optional)"}
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={reasonPlaceholder ?? "Provide context for the audit log"}
          rows={2}
          className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </label>
      {additionalFields && <div className="mt-3">{additionalFields}</div>}
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:min-h-[36px]"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim())}
          disabled={!canConfirm}
          className={cn(
            "min-h-[44px] rounded-lg px-4 text-xs font-bold text-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]",
            variant === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary-dark"
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
