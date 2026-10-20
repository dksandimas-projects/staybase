// Per OCT-H11 (2026-10-20, decision #287): the focus-management
// primitive for the guest app's modal surfaces.
//
// The admin app already ships the correct pattern —
// `admin-app/src/utils/useFocusTrap.ts` (decision #107): initial
// focus + Escape close + Tab wrap + focus restore. The guest app
// had NO equivalent, so the MBUX-18 edit sheet declared
// `role="dialog" aria-modal="true"` with no focus trap, no
// Escape handling, no focus restore and no scroll lock — while its
// own backdrop comment claimed "the guest can hit Escape via the
// document keydown listener below" (there is no such listener in
// the file).
//
// Consequences of the gap:
//   - A keyboard or screen-reader guest tabs straight out of the
//     sheet into a page that `aria-modal` has hidden from the AT
//     tree, so focus lands on an invisible target.
//   - Escape does nothing — the only dismiss paths are the small X
//     and the backdrop.
//   - On a phone, dragging the dimmed backdrop scrolls the page
//     behind the sheet.
//
// The two hooks below are the guest-app port of the admin
// primitive. They are deliberately NOT shared through
// `@spark-inn/shared`: that package is imported by the server
// bundle (which has no React and no DOM), and adding a React hook
// there would drag `react` into the server's dependency graph.
//
// Usage:
//   const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);
//   const scrollRef = useBodyScrollLock(open);
//   ...
//   <div ref={trapRef}> ... </div>

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]:not([disabled]):not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"]):not([type="hidden"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'details>summary:first-of-type:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])'
].join(",");

/**
 * Trap keyboard focus inside `containerRef` while `active` is
 * true.
 *
 * - On activation: the previously focused element is remembered,
 *   and focus moves to the first focusable descendant (or the
 *   container itself when there is none).
 * - While active: `Tab` / `Shift+Tab` wrap at the edges, and
 *   `Escape` calls `onEscape`.
 * - On deactivation (or unmount): focus is restored to the
 *   previously focused element when it is still in the document.
 *
 * @param active Whether the trap is engaged.
 * @param onEscape Called when the user presses Escape.
 * @returns The ref to attach to the dialog container.
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape: () => void
): React.MutableRefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Keep the latest callback without re-running the effect (the
  // effect's dependency is `active` alone — re-running it would
  // re-capture the focused element and steal focus mid-edit).
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    const focusables = collectFocusables(container);
    const first = focusables[0];
    if (first) {
      first.focus();
    } else {
      // No focusable child — make the container itself the focus
      // target so screen readers still land inside the dialog.
      container.setAttribute("tabindex", "-1");
      container.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const liveFocusables = collectFocusables(container);
      if (liveFocusables.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = liveFocusables[0];
      const lastEl = liveFocusables[liveFocusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const isInside = activeEl ? container.contains(activeEl) : false;

      if (event.shiftKey) {
        if (!isInside || activeEl === firstEl) {
          event.preventDefault();
          lastEl.focus();
        }
      } else if (!isInside || activeEl === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const previous = previouslyFocused.current;
      if (previous && document.contains(previous) && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, [active]);

  return containerRef;
}

/**
 * Lock the document body behind an open overlay.
 *
 * The guest app had no `document.body.style.overflow` write
 * anywhere (0 hits repo-wide), so dragging the dimmed backdrop of
 * a bottom sheet scrolled the page behind it — the sheet's own
 * `overscroll-contain` only contains the scroll WITHIN the sheet.
 *
 * The previous inline value is restored on deactivation, and the
 * `scrollbar-gutter` compensation keeps the layout from shifting
 * when the scrollbar disappears.
 *
 * @param active Whether the lock is engaged.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [active]);
}

function collectFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && isVisible(el)
  );
}

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return false;
  // `offsetParent` is null for `display: none` subtrees; a
  // `position: fixed` element has a null `offsetParent` too, so
  // fall back to the rect check for that case.
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
