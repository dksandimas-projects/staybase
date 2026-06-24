import * as React from "react";
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

export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape: () => void
): React.MutableRefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter(
      (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && isVisible(el)
    );

    const first = focusables[0];
    if (first instanceof HTMLElement) {
      first.focus();
    } else {
      container.setAttribute("tabindex", "-1");
      container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;

      const liveFocusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && isVisible(el)
      );
      if (liveFocusables.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = liveFocusables[0];
      const lastEl = liveFocusables[liveFocusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const isInside = activeEl ? container.contains(activeEl) : false;

      if (e.shiftKey) {
        if (!isInside || activeEl === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (!isInside || activeEl === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
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
  }, [active, onEscape]);

  return containerRef;
}

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
