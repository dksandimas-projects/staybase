import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { slideInBottom, slideInRight } from "@spark-inn/shared";
import { useEffect, useId, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { useBreakpoint } from "../utils/useBreakpoint";
import { useFocusTrap } from "../utils/useFocusTrap";

interface DrawerProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function Drawer({ title, children, footer, open, onClose, className }: DrawerProps) {
  const { isMobile } = useBreakpoint();
  const prefersReducedMotion = !!useReducedMotion();
  const titleId = useId();

  useLockBodyScroll(open && isMobile);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-backdrop"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            // z-[60] (not z-40) so the backdrop always sits above any
            // nested panel — most importantly the panel of another modal
            // (z-50) that opens on top of this drawer. With z-40 the
            // drawer's backdrop was below the modal panel and the modal
            // appeared unfaded. See ROADMAP §MBZ and
            // plan/admin-app/CLAUDE.md §Z-Index Scale.
            // /60 (not /50) matches QRManagementPage's pattern and
            // matches the Modal backdrop for visual consistency.
            className="fixed inset-0 z-[60] bg-gray-950/60 backdrop-blur-sm"
            aria-hidden="true"
          />
          {isMobile ? (
            <MobileDrawerPanel
              key="drawer-panel-mobile"
              title={title}
              titleId={titleId}
              prefersReducedMotion={prefersReducedMotion}
              onClose={onClose}
              footer={footer}
              className={className}
            >
              {children}
            </MobileDrawerPanel>
          ) : (
            <DesktopDrawerPanel
              key="drawer-panel-desktop"
              title={title}
              titleId={titleId}
              prefersReducedMotion={prefersReducedMotion}
              onClose={onClose}
              footer={footer}
              className={className}
            >
              {children}
            </DesktopDrawerPanel>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

function MobileDrawerPanel({
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
  className?: string;
}) {
  const trapRef = useFocusTrap<HTMLElement>(true, onClose);
  return (
    <motion.aside
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
    </motion.aside>
  );
}

function DesktopDrawerPanel({
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
    // Per `plan/admin-app/CLAUDE.md §Layout` + `plan/docs/FRONTEND.md
    // §Spacing & Sizing`: the desktop drawer is a right-side slide-in,
    // 240–480px wide, pinned to the right edge of the viewport. The
    // positioning MUST live on a static wrapper — before the Phase 11.7
    // refactor the aside was a child of the fixed-positioned backdrop
    // and inherited its positioning context. The refactor made the
    // aside a sibling, so the positioning context is gone and the
    // panel falls into the document flow at the bottom of the page
    // (lower-right of the page content).
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-50 ml-auto flex h-full w-full flex-col bg-white shadow-xl",
        className || "max-w-[480px]"
      )}
    >
      <motion.aside
        ref={trapRef}
        variants={prefersReducedMotion ? undefined : slideInRight}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full flex-col"
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
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3">{footer}</div> : null}
      </motion.aside>
    </div>
  );
}

function useLockBodyScroll(lock: boolean) {
  useEffect(() => {
    if (!lock) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [lock]);
}
