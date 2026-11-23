import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "./Modal";
import { cn } from "../utils/cn";

// Per decision #342 (2026-11-23): the Spark Essentials item photo.
//
// WHAT IT SOLVES: the shop grid renders every item photo as a 112px-tall
// `object-cover` crop. A guest who wants to see what they are actually
// ordering — the label on the bottle, the weave of the basket, the size of
// the towel — had no way to look closer: the grid crop was the only
// rendering of the photo, and a long-press to open the image in a new tab
// is not a discoverable gesture on the in-room phone (and it navigates the
// guest AWAY from the shop panel, losing their basket).
//
// THE ONE ACTION: TAP THE PHOTO TO VIEW IT FULL SIZE.
//
//   - The full view is the guest app's own `Modal` (as of decision #320 it
//     carries `role="dialog"`, `aria-modal`, a focus trap with focus
//     restored to the trigger, Escape-to-close and a body scroll lock), so
//     the lightbox inherits the accessibility contract instead of
//     hand-rolling a second one. See `plan/docs/FRONTEND.md §Modals`.
//
//   - The full view keeps the photo INSIDE the panel — the basket, the
//     filters and the tab stay exactly where they were, so the guest can
//     look, close and keep shopping. Nothing navigates away.
//
//   - The thumbnail is a real `<button>` with an `aria-label`, so the photo
//     is reachable by keyboard and announced as an action — a bare `<img>`
//     is not an affordance a screen-reader user can act on.
//
//   - The expand chip is ALWAYS visible, not hover-only: the in-room panel
//     is a phone surface, and a hover affordance is invisible on touch.
//
// The component is presentational and owns its own open state, so the shop
// grid stays declarative — the caller only passes the item's photo.

interface StoreItemImageProps {
  /** The item's name — used for the alt text and the accessible label. */
  name: string;
  /** The photo URL. The caller renders its own placeholder when empty. */
  imageUrl: string;
  /** Classes for the thumbnail `<img>`. */
  imageClassName?: string;
}

export function StoreItemImage({
  name,
  imageUrl,
  imageClassName = "h-full w-full object-cover"
}: StoreItemImageProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!imageUrl) return null;

  return (
    <>
      <button
        type="button"
        aria-label={`View the full photo of ${name}`}
        onClick={() => setIsOpen(true)}
        className="group relative block h-full w-full overflow-hidden rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <img
          src={imageUrl}
          alt={name}
          loading="lazy"
          decoding="async"
          className={cn("transition group-hover:opacity-90", imageClassName)}
        />
        {/* Always-visible expand chip — the touch affordance. The hover
            tint is the desktop affordance. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center justify-center rounded-md bg-gray-950/55 p-1.5 text-white transition group-hover:bg-gray-950/75"
        >
          <Maximize2 size={12} />
        </span>
      </button>

      <Modal open={isOpen} onClose={() => setIsOpen(false)} size="xl" title={name}>
        <div className="flex flex-col items-center gap-3">
          <img
            src={imageUrl}
            alt={name}
            className="max-h-[65vh] w-auto max-w-full rounded-lg border border-gray-200 bg-white object-contain p-2"
          />
          <p className="text-center text-xs text-gray-600">
            Tap outside the photo or press Escape to go back to the shop.
          </p>
        </div>
      </Modal>
    </>
  );
}
