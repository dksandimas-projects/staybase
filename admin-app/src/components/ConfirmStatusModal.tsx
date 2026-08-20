import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "../utils/cn";

type IconTone = "primary" | "warning" | "success";
type ConfirmTone = "primary" | "warning" | "danger";

interface ConfirmStatusModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  description?: string;
  icon?: LucideIcon;
  iconTone?: IconTone;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirming?: boolean;
  confirmDisabled?: boolean;
  confirmTone?: ConfirmTone;
  onConfirm: () => void | Promise<void>;
  // Override the default Cancel + Confirm footer.
  // Used by the check-out modal's blocked state (UCO-02/03
  // admin-only threshold), which renders a red callout +
  // a single Close button instead of the default pair.
  footer?: ReactNode;
}

const ICON_TONE_CLASSES: Record<IconTone, string> = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-amber-100 text-amber-700",
  success: "bg-green-100 text-green-700"
};

const CONFIRM_TONE_CLASSES: Record<ConfirmTone, string> = {
  primary: "bg-primary hover:bg-primary-dark",
  warning: "bg-orange-600 hover:bg-orange-700",
  danger: "bg-red-600 hover:bg-red-700"
};

// Per CLS-01 (2026-08-09, decision #208): a generic
// confirmation modal that wraps the existing `<Modal>` shell
// for the three lifecycle transition buttons in the booking
// drawer (Confirm booking / Verify & check in / Review folio &
// check out). The shell owns the focus trap + ESC + backdrop
// dismiss + mobile bottom-sheet + framer animations (inherited
// from `<Modal>`), so each call site only has to supply the
// transition-specific context (children) and a confirm handler.
//
// The shell exposes a `confirmTone` to match the existing
// primary-action footer button color (orange for "balance due",
// red for destructive, default primary) so the CTA inside the
// modal matches the button the desk just clicked.
//
// The shell is intentionally minimal — no toast, no async error
// UI, no scope selector. The parent owns the submit error
// rendering and the success-toast dispatch so the existing
// `unpaidCheckoutError` / `unpaidCheckoutBlocked` paths keep
// working through the same shape as the legacy UnpaidCheckoutForm
// modal.
export function ConfirmStatusModal({
  open,
  onClose,
  title,
  subtitle,
  description,
  icon: Icon,
  iconTone = "primary",
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  confirming = false,
  confirmDisabled = false,
  confirmTone = "primary",
  onConfirm,
  footer
}: ConfirmStatusModalProps) {
  return (
    <Modal
      title={title}
      open={open}
      onClose={() => {
        if (confirming) return;
        onClose();
      }}
      className="max-w-lg"
      footer={
        footer ?? (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={confirming}
              className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={confirming || confirmDisabled}
              className={cn(
                "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-bold text-white disabled:opacity-50",
                CONFIRM_TONE_CLASSES[confirmTone]
              )}
            >
              {confirming ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Working…
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div
              className={cn(
                "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                ICON_TONE_CLASSES[iconTone]
              )}
              aria-hidden="true"
            >
              <Icon size={20} />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            {subtitle ? (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {subtitle}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-gray-600">
              {description}
            </p>
          </div>
        </div>
        {children}
      </div>
    </Modal>
  );
}
