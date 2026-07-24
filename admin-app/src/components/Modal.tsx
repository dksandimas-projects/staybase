import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { scaleIn, slideInBottom } from "@spark-inn/shared";
import { useId, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { useBreakpoint } from "../utils/useBreakpoint";
import { useFocusTrap } from "../utils/useFocusTrap";

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
  const prefersReducedMotion = !!useReducedMotion();
  const titleId = useId();

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
            // z-[60] (not z-40) so the backdrop always sits above any
            // nested panel — most importantly the booking drawer's panel
            // (z-50) when a modal opens on top of the drawer. With z-40
            // the modal backdrop was below the drawer panel and the right
            // ~480px of the viewport stayed unfaded. See ROADMAP §MBZ
            // and plan/admin-app/CLAUDE.md §Z-Index Scale.
            // /60 (not /50) matches QRManagementPage's pattern and is
            // obviously a "modal is open" signal at a glance.
            className="fixed inset-0 z-[60] bg-gray-950/60 backdrop-blur-sm"
            aria-hidden="true"
          />
          {isMobile ? (
            <MobileModalPanel
              key="modal-panel-mobile"
              title={title}
              titleId={titleId}
              prefersReducedMotion={prefersReducedMotion}
              onClose={onClose}
              footer={footer}
            >
              {children}
            </MobileModalPanel>
          ) : (
            <DesktopModalPanel
              key="modal-panel-desktop"
              title={title}
              titleId={titleId}
              prefersReducedMotion={prefersReducedMotion}
              onClose={onClose}
              footer={footer}
              className={className}
            >
              {children}
            </DesktopModalPanel>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

function MobileModalPanel({
  title,
  titleId,
  prefersReducedMotion,
  onClose,
  footer,
  children
}: {
  title: string;
  titleId: string;
  prefersReducedMotion: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLElement>(true, onClose);
  return (
    <motion.section
      ref={trapRef}
      variants={prefersReducedMotion ? undefined : slideInBottom}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[95vh] flex-col rounded-t-card-lg bg-white shadow-xl"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <div className="mx-auto h-1 w-12 rounded-full bg-gray-200" aria-hidden="true" />
        <h2 id={titleId} className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-gray-950">
          {title}
        </h2>
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
  );
}

function DesktopModalPanel({
  title,
  titleId,
  prefersReducedMotion,
  onClose,
  footer,
  className,
  children
}: {
  title: string;
  titleId: string;
  prefersReducedMotion: boolean;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLElement>(true, onClose);
  return (
    // Per `plan/docs/FRONTEND.md §Modals`: desktop modals are centered via
    // `top-1/2 left-1/2` with a -50% / -50% translate. The translate MUST
    // live on a STATIC wrapper (not on the motion.section) — Framer Motion
    // composes its own transform property for the `scaleIn` variant, which
    // would otherwise override any Tailwind translate class on the motion
    // element and drop the modal into the lower-right quadrant of the
    // viewport. Putting the translate on the wrapper sidesteps the
    // conflict entirely.
    <div
      className={cn(
        "pointer-events-auto fixed left-1/2 top-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card-lg bg-white shadow-xl max-h-[90vh]",
        className
      )}
    >
      <motion.section
        ref={trapRef}
        variants={prefersReducedMotion ? undefined : scaleIn}
        initial="hidden"
        animate="visible"
        exit="hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-gray-950">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3">{footer}</div> : null}
      </motion.section>
    </div>
  );
}
