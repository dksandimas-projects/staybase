import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

interface ModalProps {
  title: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function Modal({ title, children, open, onClose, className }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4 backdrop-blur-sm">
      <section className={cn("max-h-[90vh] w-full max-w-2xl overflow-auto rounded-card-lg bg-white shadow-xl flex flex-col", className)}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 shrink-0">
          <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
          <button
            aria-label="Close"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
            type="button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
