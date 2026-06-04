import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

interface DrawerProps {
  title: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function Drawer({ title, children, open, onClose, className }: DrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/50 backdrop-blur-sm">
      <aside className={cn("ml-auto flex h-full w-full max-w-[480px] flex-col bg-white shadow-xl", className)}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
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
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </aside>
    </div>
  );
}
