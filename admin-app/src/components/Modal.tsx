import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { scaleIn, slideInBottom } from "@spark-inn/shared";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { useBreakpoint } from "../utils/useBreakpoint";

interface ModalProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function Modal({ title, children, footer, open, onClose, className }: ModalProps) {
  const { isMobile } = useBreakpoint();
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="modal-backdrop"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-gray-950/50 backdrop-blur-sm"
            aria-hidden="true"
          />
          {isMobile ? (
            <motion.section
              key="modal-panel-mobile"
              variants={prefersReducedMotion ? undefined : slideInBottom}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[95vh] flex-col rounded-t-card-lg bg-white shadow-xl"
              style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
                <div className="mx-auto h-1 w-12 rounded-full bg-gray-200" aria-hidden="true" />
                <h2 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-gray-950">{title}</h2>
                <button
                  type="button"
                  aria-label="Close"
                  className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                  onClick={onClose}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
              {footer ? (
                <div
                  className="shrink-0 border-t border-gray-200 bg-white px-5 py-3"
                  style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
                >
                  {footer}
                </div>
              ) : null}
            </motion.section>
          ) : (
            <motion.section
              key="modal-panel-desktop"
              variants={prefersReducedMotion ? undefined : scaleIn}
              initial="hidden"
              animate="visible"
              exit="hidden"
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={cn("pointer-events-auto fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex w-full max-w-2xl flex-col overflow-hidden rounded-card-lg bg-white shadow-xl", className)}
              style={{ maxHeight: "90vh" }}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
                <button
                  type="button"
                  aria-label="Close"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                  onClick={onClose}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">{children}</div>
              {footer ? (
                <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3">{footer}</div>
              ) : null}
            </motion.section>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
