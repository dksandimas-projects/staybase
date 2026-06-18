import { CheckCircle2, AlertCircle, Info, AlertTriangle, X, type LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  durationMs: number;
}

interface ToastContextValue {
  show: (item: Omit<ToastItem, "id" | "durationMs"> & { durationMs?: number }) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6000;

let externalShow: ToastContextValue["show"] | null = null;

export const notify = {
  success: (title: string, message?: string) => externalShow?.({ variant: "success", title, message }),
  error: (title: string, message?: string) => externalShow?.({ variant: "error", title, message, durationMs: ERROR_DURATION_MS }),
  info: (title: string, message?: string) => externalShow?.({ variant: "info", title, message }),
  warning: (title: string, message?: string) => externalShow?.({ variant: "warning", title, message })
};

function makeId() {
  return `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const variantStyles: Record<ToastVariant, { bg: string; border: string; icon: LucideIcon; iconColor: string }> = {
  success: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    icon: CheckCircle2,
    iconColor: "text-emerald-600"
  },
  error: {
    bg: "bg-red-50",
    border: "border-red-200",
    icon: AlertCircle,
    iconColor: "text-red-600"
  },
  info: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: Info,
    iconColor: "text-blue-600"
  },
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    icon: AlertTriangle,
    iconColor: "text-amber-600"
  }
};

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const style = variantStyles[toast.variant];
  const Icon = style.icon;
  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border ${style.border} ${style.bg} p-4 shadow-lg`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${style.iconColor}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
        {toast.message ? <p className="mt-1 text-xs leading-relaxed text-gray-700">{toast.message}</p> : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white/60"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastContextValue["show"]>((item) => {
    const id = makeId();
    const duration = item.durationMs ?? DEFAULT_DURATION_MS;
    setToasts((prev) => [...prev, { ...item, id, durationMs: duration }]);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(() => ({
    show,
    success: (title, message) => show({ variant: "success", title, message }),
    error: (title, message) => show({ variant: "error", title, message, durationMs: ERROR_DURATION_MS }),
    info: (title, message) => show({ variant: "info", title, message }),
    warning: (title, message) => show({ variant: "warning", title, message }),
    dismiss
  }), [show, dismiss]);

  useEffect(() => {
    externalShow = show;
    return () => {
      externalShow = null;
    };
  }, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
