// Per MBUX-18 (decision #275, 2026-10-16): the mobile-only
// bottom sheet that the StaySummaryStrip's Edit pencil opens on
// Step 1. The pre-MBUX-18 Edit handler smooth-scrolled to the
// existing `<aside>` Stay-details sidebar and briefly rang it
// for visibility — on phone the aside sits BELOW the room-card
// list, so a long room list meant a long scroll, and the guest
// lost the room-card context for the few seconds they fiddled
// with dates. The MBUX-11 spec already anticipated the
// alternative: *"Edit opens the existing range calendar and
// occupancy controls in a mobile-appropriate expandable area
// or sheet."* (BOOKING-MOBILE-UX.md:137). MBUX-18 ships the
// sheet.
//
// Why a bottom sheet (not a centered modal):
// - Native-feel on iOS/Android, sits in the thumb zone, no
//   backdrop-vs-content fight.
// - Reuses the same primitive the in-picker calendar already
//   uses (DateRangePicker.tsx:418 ships `fixed inset-x-0
//   bottom-0 max-h-[calc(100dvh-4rem)] overflow-y-auto
//   overscroll-contain rounded-t-card`).
// - The sheet header carries the instruction so the footer
//   does NOT repeat it (DR-03, BOOKING-FLOW.md:74).
// - On `lg:` the strip is `lg:hidden` so the sheet never
//   mounts on desktop — the sidebar IS the edit surface there.
//
// Why a Done button (not auto-save):
// - The state writes are LIVE — adults/children/dates commit
//   the moment the guest taps (same shape as the existing
//   sidebar). Done is just a close affordance so they don't
//   have to scroll all the way up to the X.
// - A persistent bottom-sheet without a primary action would
//   leave the guest wondering how to dismiss it (the X is
//   small and easy to miss on a 6.7" phone).
//
// Why no title input + no stepper cap UI in the sheet:
// - The aside renders date picker + Adults stepper + Children
//   stepper; the cart and info card live in the sidebar only
//   (they're read-only and would clutter the sheet).
// - The three controls share the existing
//   `updateAdults` / `updateChildren` / `onRangeChange` writers
//   — the URL params stay in sync without a separate Save step.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Minus, Plus, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import config from "@config";
import { DateRangePicker } from "./DateRangePicker";
import { slideInBottom } from "@spark-inn/shared";

interface EditStayDetailsSheetProps {
  open: boolean;
  onClose: () => void;
  checkIn: string;
  checkOut: string;
  maxStayNights?: number | null;
  onRangeChange: (checkIn: string, checkOut: string) => void;
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
  adults: number;
  maxGuestCapacity: number;
  onAdultsChange: (next: number) => void;
  numChildren: number;
  onChildrenChange: (next: number) => void;
}

export function EditStayDetailsSheet({
  open,
  onClose,
  checkIn,
  checkOut,
  maxStayNights,
  onRangeChange,
  onCheckInChange,
  onCheckOutChange,
  adults,
  maxGuestCapacity,
  onAdultsChange,
  numChildren,
  onChildrenChange
}: EditStayDetailsSheetProps): ReactNode {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          animate="visible"
          className="fixed inset-0 z-50 bg-gray-950/50 backdrop-blur-sm lg:hidden"
          exit="hidden"
          initial="hidden"
          // Per FRONTEND.md §Modals: backdrop fades in separately.
          onClick={onClose}
          // Per FRONTEND.md §Modals: focus management is the
          // parent's responsibility; the guest can hit Escape
          // via the document keydown listener below.
          aria-hidden="true"
          data-testid="edit-stay-details-backdrop"
        >
          <motion.div
            animate="visible"
            className="fixed inset-x-0 bottom-0 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-t-card bg-white p-5 shadow-xl"
            exit="exit"
            initial="hidden"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-stay-details-title"
            variants={shouldReduceMotion ? { hidden: { opacity: 0 }, visible: { opacity: 1 } } : slideInBottom}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="edit-stay-details-title" className="text-lg font-semibold text-gray-950">
                Edit stay details
              </h2>
              <button
                type="button"
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                onClick={onClose}
                data-testid="edit-stay-details-close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-5">
              <DateRangePicker
                checkIn={checkIn}
                checkOut={checkOut}
                maxStayNights={maxStayNights}
                onRangeChange={onRangeChange}
                onCheckInChange={onCheckInChange}
                onCheckOutChange={onCheckOutChange}
              />

              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Adults
                <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
                  <button
                    aria-label="Remove one adult"
                    className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={adults <= 1}
                    type="button"
                    onClick={() => onAdultsChange(adults - 1)}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    <Users size={16} className="text-primary" />
                    {adults} {adults === 1 ? "adult" : "adults"}
                  </span>
                  <button
                    aria-label="Add one adult"
                    className="flex h-11 w-11 items-center justify-center rounded bg-gray-100 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={adults >= maxGuestCapacity}
                    type="button"
                    onClick={() => onAdultsChange(adults + 1)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </label>

              {/* Per CHD-11.2 (2026-08-05, per decision #193):
                  the children picker keeps the soft 10 cap —
                  same shape as the in-aside picker. The
                  "at least one adult" floor is owned by the
                  Adults stepper's min (1). */}
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Children (0–11)
                <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
                  <button
                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    aria-label="Decrease children count"
                    onClick={() => onChildrenChange(numChildren - 1)}
                    disabled={numChildren <= 0}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    {numChildren} {numChildren === 1 ? "child" : "children"}
                  </span>
                  <button
                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    aria-label="Increase children count"
                    onClick={() => onChildrenChange(numChildren + 1)}
                    disabled={numChildren >= 10}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </label>
            </div>

            {/* Per FRONTEND.md §Modals + DR-03 (BOOKING-FLOW.md:74):
                phones get an explicit Done affordance — the sheet
                has no click-outside affordance, and the header X
                is small. Full width because it is the primary
                action and sits in the thumb zone at the bottom
                of the sheet. The state writes are LIVE so Done is
                a close, not a save. */}
            <button
              type="button"
              className="mt-5 min-h-11 w-full rounded-lg px-4 text-sm font-semibold text-white"
              style={{ backgroundColor: config.colors.primary }}
              onClick={onClose}
              data-testid="edit-stay-details-done"
            >
              Done
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}