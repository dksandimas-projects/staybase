// Per MBUX-11 (decision #264, 2026-10-16): the
// mobile-first persistent top strip that sits directly under
// the StepIndicator on the booking flow's Step 1. Carries the
// selected date range + night count + guest count + an "Edit"
// affordance.
//
// Per MBUX-18 (decision #275, 2026-10-16): the Edit pencil
// opens the EditStayDetailsSheet mobile bottom sheet (own
// component) instead of smooth-scrolling to the existing
// `<aside>` "Stay details" sidebar. The pre-MBUX-18 Edit
// handler scrolled to the aside + briefly rang it; on a phone
// the aside sits below the room-card list, so a long room list
// meant a long scroll and the guest lost the room-card context
// for the few seconds they fiddled with dates. The MBUX-11 spec
// already contemplated the alternative — *"Edit opens the
// existing range calendar and occupancy controls in a
// mobile-appropriate expandable area or sheet"* (BOOKING-MOBILE-UX.md:137).
// MBUX-18 ships the sheet.
//
// On `lg:` the strip is hidden because the sidebar is already
// the primary surface — rendering both would put the same lines
// on screen twice. The strip is therefore MOBILE-ONLY by
// construction: the Edit pencil never mounts on desktop.

import { CalendarDays, Pencil, Users } from "lucide-react";
import config from "@config";

interface StaySummaryStripProps {
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  /**
   * Per MBUX-18: the parent (BookingPage) owns the sheet
   * visibility state and supplies this callback. Tapping
   * Edit opens the mobile bottom sheet containing the same
   * DateRangePicker + Adults/Children steppers the sidebar
   * renders inline. The strip is `lg:hidden` so this handler
   * never fires on desktop — desktop uses the sidebar
   * directly.
   */
  onEdit?: () => void;
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
  onEdit
}: StaySummaryStripProps) {
  function handleEdit(): void {
    // Per MBUX-18: the parent owns the sheet; the strip is a
    // dumb trigger. If a parent forgets to wire `onEdit` the
    // button is a silent no-op rather than a broken scroll —
    // the worst case is the parent never updated its call
    // site, which is a developer-visible regression rather
    // than a guest-visible dead control.
    onEdit?.();
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