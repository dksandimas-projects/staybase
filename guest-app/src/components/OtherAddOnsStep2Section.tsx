// Per OCT-M4 (2026-10-20, decision #297): the guest Step 2
// "Other Add-Ons" section.
//
// BR-12 shipped the catalog, the staff walk-in grid and the
// post-booking Manage page — but the GUEST booking flow never had
// one. `BookingPage.tsx` contained ZERO occurrences of "otherAddOn",
// so a guest could not order an airport transfer at booking time at
// all.
//
// The layout mirrors the post-booking "Manage Other Add-Ons" page
// (add-on-major: one card per add-on, one row per service date) so
// a guest who has used that page sees the same shape here.
//
// Per BR-12 decision 3 the quantity is PER DAY × PER ADD-ON — the
// number of guests using the add-on that day, editable `0..guest
// count`. It is NOT the per-guest × per-date slot shape that
// breakfast uses.
//
// Per OCT-M5 (decision #292) the cut-off is anchored on the BOOKING's
// check-in date for every row — the lock is per add-on, not per date.

import type { ReactNode } from "react";
import { Calendar, Lock } from "lucide-react";
import { computeOtherAddOnCutoffState } from "@spark-inn/shared";
import type { OtherAddOnDraftCatalogRow } from "@spark-inn/shared";

export interface OtherAddOnsStep2SectionProps {
  addOns: OtherAddOnDraftCatalogRow[];
  /** The stay's service dates (one per night). */
  dates: string[];
  /** The booking's check-in date (`yyyy-mm-dd`) — the cut-off anchor. */
  checkIn: string;
  /** The booking's total guest count — the per-day quantity ceiling. */
  guestCount: number;
  /** The guest's quantities, keyed `yyyy-mm-dd-{addOnId}`. */
  quantities: Record<string, number>;
  onQuantityChange: (date: string, addOnId: string, quantity: number) => void;
  /** Format a PHP amount. */
  formatPrice: (value: number) => string;
  /** Format a service date for display. */
  formatDateLabel: (date: string) => string;
  /** True while the catalog is loading — the section renders nothing until it settles. */
  isLoading?: boolean;
  /** A non-fatal load error. */
  error?: string | null;
}

export function OtherAddOnsStep2Section({
  addOns,
  dates,
  checkIn,
  guestCount,
  quantities,
  onQuantityChange,
  formatPrice,
  formatDateLabel,
  isLoading = false,
  error = null
}: OtherAddOnsStep2SectionProps): ReactNode {
  // Nothing to offer: either the hotel turned other add-ons off
  // (OCT-M1) or the catalog is empty. In both cases the section
  // renders NOTHING — a heading with an empty grid under it reads as
  // a broken page.
  if (isLoading) return null;
  if (error) {
    return (
      <div
        className="mb-6 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        data-testid="other-addons-error"
        role="status"
      >
        {error}
      </div>
    );
  }
  if (!addOns || addOns.length === 0) return null;

  const maxGuests = Math.max(1, Math.floor(Number(guestCount) || 1));

  return (
    <div
      className="mb-6 rounded-card border border-primary/20 bg-primary/5 p-5"
      data-testid="other-addons-section"
    >
      <h2 className="font-heading text-xl text-gray-950">Other add-ons</h2>
      <p className="mt-1 text-sm text-gray-600">
        Add extra services to your stay. You can also change these later from your booking.
      </p>
      {/* Per OCT-M4 (2026-10-20, decision #297): the other add-ons
          are NOT inside the room bill. Per
          `plan/features/OTHER-ADD-ONS.md` decision 2 they are
          "added on top of it for the balance" — the same model the
          walk-in and the post-booking Manage page use. Saying so
          here keeps the guest from expecting the transfer on the
          online total. */}
      <p className="mt-1 text-xs text-gray-500">
        Other add-ons are charged separately from your room rate and
        settled with you at the hotel.
      </p>

      <div className="mt-4 space-y-4">
        {addOns.map((addOn) => {
          // Per OCT-M5: the cut-off is anchored on the BOOKING's
          // check-in for every date — the lock is per add-on.
          const cutoff = computeOtherAddOnCutoffState({
            checkInDate: checkIn,
            addOn: {
              isEnabled: addOn.isEnabled !== false,
              cutoffHoursBeforeCheckIn: addOn.cutoffHoursBeforeCheckIn ?? 24
            }
          });
          const isLocked = cutoff.isLocked;
          const cutoffLabel = cutoff.reasonOrCutoff === "addons-disabled"
            ? "Unavailable"
            : "Ordering closed";

          return (
            <div
              key={addOn.id}
              className="rounded-lg bg-white p-4 ring-1 ring-gray-200"
              data-testid={`other-addon-card-${addOn.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-950">{addOn.name}</p>
                  {addOn.description ? (
                    <p className="mt-1 text-sm text-gray-600">{addOn.description}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-gray-950">
                    {formatPrice(addOn.price)}{" "}
                    <span className="text-xs text-gray-500">
                      per {addOn.unit === "per-stay" ? "stay" : "guest"}
                    </span>
                  </p>
                </div>
                {isLocked ? (
                  <span
                    data-testid={`other-addon-locked-${addOn.id}`}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
                  >
                    <Lock className="h-3 w-3" />
                    {cutoffLabel}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 space-y-2">
                {dates.map((date) => {
                  const key = `${date}-${addOn.id}`;
                  const quantity = Math.max(
                    0,
                    Math.min(
                      maxGuests,
                      Math.floor(Number(quantities?.[key]) || 0)
                    )
                  );
                  return (
                    <div
                      key={date}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-100"
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <p className="text-sm font-semibold text-gray-950">
                          {formatDateLabel(date)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label
                          htmlFor={`other-addon-qty-${key}`}
                          className="text-sm text-gray-700"
                        >
                          Guests
                        </label>
                        <input
                          id={`other-addon-qty-${key}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={maxGuests}
                          value={quantity}
                          disabled={isLocked}
                          onChange={(event) => {
                            const raw = Math.floor(Number(event.target.value || 0));
                            const next = Math.max(0, Math.min(maxGuests, raw));
                            onQuantityChange(date, addOn.id, next);
                          }}
                          data-testid={`other-addon-qty-${date}-${addOn.id}`}
                          className="h-11 w-20 rounded-lg border border-gray-200 bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <span className="text-xs text-gray-500">/ {maxGuests} guests</span>
                        <span className="ml-auto text-sm font-semibold text-gray-950">
                          {formatPrice(quantity * Math.max(0, Number(addOn.price) || 0))}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
