import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, type ReactNode } from "react";
import { fadeIn, scaleIn } from "@spark-inn/shared";
import { cn } from "../utils/cn";
// Per OCT-H11 (2026-10-20, decision #287): the guest app's focus
// primitives. The guest `Modal` shipped WITHOUT them — it declared no
// `role="dialog"`, kept no focus trap, ignored Escape and never locked
// the body scroll, so a keyboard guest could tab straight out of an
// open dialog and Escape did nothing. Every overlay in the guest app
// goes through this component, so the fix belongs HERE rather than in
// each caller.
import { useBodyScrollLock, useFocusTrap } from "../utils/useFocusTrap";

interface ModalProps {
  title: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  className?: string;
  /**
   * The panel's max width. The width class is chosen here (not left to
   * `className`) because the guest app's `cn` is a plain join — a
   * `className` that carried its own `max-w-*` would leave TWO width
   * classes on the element and the rendered width would depend on
   * stylesheet order.
   */
  size?: "md" | "lg" | "xl";
}

const SIZE_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-4xl"
};

export function Modal({ title, children, open, onClose, className, size = "md" }: ModalProps) {
  const shouldReduceMotion = useReducedMotion();
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLElement>(open, onClose);
  useBodyScrollLock(open);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          animate="visible"
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4 backdrop-blur-sm"
          exit="hidden"
          initial="hidden"
          onClick={onClose}
          variants={fadeIn}
        >
          <motion.section
            animate="visible"
            aria-labelledby={titleId}
            aria-modal="true"
            className={cn(
              "max-h-[90vh] w-full overflow-auto rounded-card-lg bg-white shadow-xl",
              SIZE_CLASSES[size] ?? SIZE_CLASSES.md,
              className
            )}
            exit="hidden"
            initial="hidden"
            onClick={(event) => event.stopPropagation()}
            ref={panelRef}
            role="dialog"
            variants={shouldReduceMotion ? fadeIn : scaleIn}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-950" id={titleId}>
                {title}
              </h2>
              <button
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                type="button"
                onClick={onClose}
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
