import { useState } from "react";
import { UtensilsCrossed } from "lucide-react";

export interface BreakfastMenuStripMeal {
  id: string;
  name: string;
  price: number;
  /** MBUX-04: optional admin-managed thumbnail. Absent for most meals. */
  imageUrl?: string;
  description?: string;
}

interface BreakfastMenuStripProps {
  meals: BreakfastMenuStripMeal[];
  formatPrice: (value: number) => string;
}

/**
 * The `Breakfast menu` thumbnail strip (MBUX-05, decision #257).
 *
 * **Why it exists.** Meal photos were shipped as an admin-managed
 * optional field in MBUX-04, but until something renders them a guest
 * never sees them. Native `<select>` options cannot render images
 * consistently on mobile browsers — the spec explicitly rejected
 * putting photos inside the dropdown — so the photos need a surface
 * ABOVE the selectors.
 *
 * **Why it is above the grid and not inside it.** The per-date ×
 * per-guest grid is the thing a guest is actually working through. The
 * menu answers "what does this look like?"; the grid answers "what am
 * I picking?". Interleaving them would make every one of the N × M
 * slots repeat the same catalogue, which is the exact repetition the
 * mobile refresh set out to remove.
 *
 * **Layout — per MBUX-12 (decision #265, 2026-10-16).** Pre-MBUX-12
 * the strip was a horizontal-scroll carousel (`flex snap-x
 * overflow-x-auto` with 128px cards on mobile). On a 375px phone that
 * put 2.5 cards visible and cut the third one in half — exactly the
 * "Longsilog is half off-screen" shape the owner flagged on Step 2.
 * The fix is a responsive CSS grid: 2 cols on mobile, 3 cols on `sm:`,
 * 4 cols on `lg:`. The `UtensilsCrossed` fallback icon stays for
 * missing/404 meal photos (a content gap, not a code gap — see MBUX-04
 * for the admin upload path).
 *
 * **Image states.** `loading="lazy"` (a breakfast catalogue is rarely
 * needed before the guest scrolls to it), a card-shaped skeleton while
 * loading, and a branded-neutral `UtensilsCrossed` tile when the meal
 * has no image, the URL 404s, or the network drops. The fallback is
 * decorative — the meal NAME is always rendered as text, so a missing
 * photo never removes information.
 *
 * **A thumbnail never fills a slot.** The strip is a read-only
 * reference; every card is a non-interactive `<div>`. Tapping a photo
 * must not be mistaken for choosing that meal, which is what would
 * happen if these were buttons wired to the selection handler.
 */
export function BreakfastMenuStrip({ meals, formatPrice }: BreakfastMenuStripProps) {
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});

  if (meals.length === 0) return null;

  return (
    <section
      className="mt-5"
      aria-label="Breakfast menu"
      data-testid="breakfast-menu-strip"
    >
      <h3 className="text-sm font-semibold text-gray-950">Breakfast menu</h3>
      {/* Per MBUX-12: responsive grid replacing the pre-MBUX-12
          horizontal-scroll carousel. 2 cols on mobile so guests
          see the catalogue without a swipe, 3 cols on `sm:` (the
          catalog's typical meal count fits comfortably), 4 cols on
          `lg:` so the desktop sidebar + menu can share the row. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {meals.map((meal) => {
          const showFallback = !meal.imageUrl || failedIds[meal.id];
          return (
            <div
              key={meal.id}
              className="w-full"
              data-testid={`breakfast-menu-card-${meal.id}`}
            >
              <div
                className="w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200"
                style={{ aspectRatio: "4 / 3" }}
              >
                {showFallback ? (
                  <span
                    className="flex h-full w-full items-center justify-center text-gray-400"
                    aria-hidden="true"
                  >
                    <UtensilsCrossed size={22} />
                  </span>
                ) : (
                  <img
                    src={meal.imageUrl}
                    alt=""
                    loading="lazy"
                    // Skeleton sits behind the image; the opaque image
                    // covers it once decoded, so there is no flash of
                    // empty grey box on a slow connection.
                    className="h-full w-full object-cover"
                    onError={() =>
                      setFailedIds((prev) => ({ ...prev, [meal.id]: true }))
                    }
                  />
                )}
              </div>
              <p className="mt-1.5 truncate text-xs font-semibold text-gray-950">
                {meal.name}
              </p>
              <p className="text-xs text-gray-500">{formatPrice(meal.price)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}