// Per MBUX-11 (decision #264, 2026-10-16): the
// mobile-first persistent top strip that sits directly under
// the StepIndicator on the booking flow's Step 1. Carries the
// selected date range + night count + guest count + an "Edit"
// affordance that smooth-scrolls to the existing
// `<aside>` "Stay details" sidebar and briefly rings it for
// visibility. On `lg:` the strip is hidden because the
// sidebar is already the primary surface — rendering both
// would put the same lines on screen twice.
//
// Why a top strip instead of a sticky bottom strip:
// the pre-MBUX-11 strip lived in the middle of the page
// (right of the hero on `md:`, stacked below on mobile).
// Agoda's pattern puts it on top with an "Edit" pencil so
// the guest never has to scroll to find their stay summary.
// The user explicitly asked for this in the MBUX-11 review:
// "the date selection should I think be on top part of the
// page for mobile but maybe make it hidden or collapsed by
// default since it was already populated before step 1,
// maybe add an edit button of something like that just
// like Agoda."
//
// The Edit button does NOT open a modal — it reuses the
// existing in-page picker (the `<DateRangePicker>` and the
// Adults/Children steppers) and just draws the guest's eye
// to it. This matches the existing Adjust-room CTA pattern
// at BookingPage.tsx:4656 (scroll + ring + 2-second timeout).

import { CalendarDays, Pencil, Users } from "lucide-react";
import config from "@config";

interface StaySummaryStripProps {
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  /** Element id of the stay-details sidebar; the Edit button
   * scrolls to this id and rings it. Defaults to
   * `"booking-stay-details-aside"` which BookingPage must
   * supply on its `<aside>`. */
  targetId?: string;
}

function formatStayDate(value: string): string {
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export function StaySummaryStrip({
  checkIn,
  checkOut,
  nights,
  guests,
  targetId = "booking-stay-details-aside"
}: StaySummaryStripProps) {
  function handleEdit(): void {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-primary", "ring-offset-2");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-primary", "ring-offset-2");
    }, 2000);
  }

  return (
    <div
      data-testid="stay-summary-strip"
      className="mx-auto mt-4 flex max-w-3xl items-center justify-between gap-3 rounded-card bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-gray-200 lg:hidden"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CalendarDays size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-950">
            {formatStayDate(checkIn)} – {formatStayDate(checkOut)}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
            <Users size={12} aria-hidden="true" className="shrink-0 text-gray-400" />
            <span>
              {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
            </span>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleEdit}
        data-testid="stay-summary-strip-edit"
        aria-label="Edit dates and guests"
        className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white transition hover:opacity-90 active:opacity-80"
      >
        <Pencil size={14} aria-hidden="true" />
        <span>Edit</span>
      </button>
    </div>
  );
}