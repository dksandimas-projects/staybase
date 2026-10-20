// Per SR-01..05 (2026-10-12): the public booking Step 2
// special-requests block. Two sub-sections:
//
//   1. Bed set-up radios — always visible if the picked
//      room type offers any set-ups in
//      `roomTypes[i].bedSetupValues`. The guest picks one
//      per-room (multi-room support: a single radio set
//      covers all rooms of the same type, and the choice
//      broadcasts to every room of that type — same
//      "edit one, mirror to all" pattern used for
//      extra-bed count).
//
//   2. "Show additional preferences" — collapsed
//      accordion, default closed. Inside: a 2-column
//      checkbox grid of admin-configured preferences, a
//      free-text "additional request" box, and the
//      "Expected arrival time" dropdown (built from the
//      hotel's `checkInTime` for a fixed 24h window).
//
// The block is owned by both the BookingPage +
// CorporateBookingPage (public + corporate flows). The
// parent provides the catalog data + the per-field
// setters; this component owns the JSX form values +
// the local accordion state.
import { useState } from "react";
import {
  ADDITIONAL_REQUEST_MAX_LENGTH,
  type BedSetupOption,
  type BookingPreferenceOption,
  type RoomTypeEntry
} from "@spark-inn/shared";
import { buildArrivalTimeOptions } from "@spark-inn/shared";
import { Bed, ChevronDown } from "lucide-react";

interface SpecialRequestsBlockProps {
  // The catalog state from `useRoomTypes()`.
  bedSetups: BedSetupOption[];
  bookingPreferences: BookingPreferenceOption[];
  // The rooms in the current cart (one entry per
  // physical room — a 2-room booking has 2 entries,
  // even when both are the same type).
  selectedRooms: RoomTypeEntry[];
  // The current bed-set-up choice per room INDEX. The
  // key is the index in `selectedRooms`; the value is
  // the chosen `bedSetups[].value` (or `""` for
  // "no preference"). On radio change, the parent
  // updates the value for every index whose room type
  // matches.
  bedSelections: Record<number, string>;
  onSetBedSelections: (next: Record<number, string>) => void;
  // Reservation-level fields.
  additionalPreferences: string[];
  onSetAdditionalPreferences: (next: string[]) => void;
  additionalRequest: string;
  onSetAdditionalRequest: (next: string) => void;
  expectedArrivalTime: string | null;
  onSetExpectedArrivalTime: (next: string | null) => void;
  // Hotel check-in time string (e.g. "2:00 PM") used to
  // build the arrival-time dropdown. Falls back to "2:00 PM"
  // when missing.
  checkInTime: string;
  // Optional override for the locale the 12h time
  // formatter uses (defaults to en-US).
  locale?: string;
}

// Per SR-01..05 (2026-10-12): resolve the bed-setup
// options offered for a given room type. The catalog
// carries the global set-ups; the room type's
// `bedSetupValues` is the subset.
function resolveBedSetupOptions(
  bedSetups: BedSetupOption[],
  type: RoomTypeEntry | null | undefined
): BedSetupOption[] {
  if (!type || !Array.isArray(type.bedSetupValues) || type.bedSetupValues.length === 0) {
    return [];
  }
  const allowed = new Set(type.bedSetupValues);
  return bedSetups.filter((opt) => allowed.has(opt.value));
}

export function SpecialRequestsBlock({
  bedSetups,
  bookingPreferences,
  selectedRooms,
  bedSelections,
  onSetBedSelections,
  additionalPreferences,
  onSetAdditionalPreferences,
  additionalRequest,
  onSetAdditionalRequest,
  expectedArrivalTime,
  onSetExpectedArrivalTime,
  checkInTime,
  locale
}: SpecialRequestsBlockProps) {
  const [accordionOpen, setAccordionOpen] = useState(false);

  // Group rooms by type so a single radio group renders
  // for each unique type even when the cart has two
  // rooms of it. The radio group's value is anchored
  // to the FIRST index of that type; on change we
  // broadcast to every index of that type.
  const uniqueTypes: Array<{ type: RoomTypeEntry; indices: number[] }> = [];
  const seen = new Set<string>();
  selectedRooms.forEach((t, idx) => {
    if (seen.has(t.value)) {
      const existing = uniqueTypes.find((u) => u.type.value === t.value);
      existing?.indices.push(idx);
      return;
    }
    seen.add(t.value);
    uniqueTypes.push({ type: t, indices: [idx] });
  });

  const arrivalOptions = buildArrivalTimeOptions(checkInTime, locale);

  const togglePreference = (value: string) => {
    if (additionalPreferences.includes(value)) {
      onSetAdditionalPreferences(additionalPreferences.filter((v) => v !== value));
    } else {
      onSetAdditionalPreferences([...additionalPreferences, value]);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Bed set-up radios ──────────────────────────── */}
      {uniqueTypes.map(({ type, indices }) => {
        const options = resolveBedSetupOptions(bedSetups, type);
        if (options.length === 0) return null;
        // Anchor the radio group's `checked` value to
        // the first index of this type — all rooms of
        // the same type mirror the same choice.
        const anchorIdx = indices[0];
        const currentValue = bedSelections[anchorIdx] ?? "";
        return (
          <fieldset
            key={type.value}
            className="rounded-card border border-gray-200 bg-white p-4 shadow-sm"
          >
            <legend className="px-2 text-xs font-semibold text-gray-700">
              <Bed size={14} className="mr-1 inline-block text-primary" aria-hidden="true" />
              Bed set-up for {type.label}
              {indices.length > 1 ? (
                <span className="ml-1 font-normal text-gray-500">
                  ({indices.length} rooms)
                </span>
              ) : null}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {/* Per OCT-M2 (2026-10-20, decision #290): an
                  explicit "No preference" option. The server
                  always accepts the empty string (it only
                  validates a NON-empty `selection.bedSetup`),
                  so this is the escape hatch that guarantees the
                  guest can always submit the form — even if the
                  catalog changed between the page load and the
                  submit, or the stored type's subset does not
                  cover one of the options the guest was shown. */}
              {[{ value: "", label: "No preference" }, ...options].map((option) => {
                const checked = currentValue === option.value;
                // Per OCT-M2: the "No preference" option has an
                // empty VALUE, so its React key + DOM id get an
                // explicit suffix (an empty key / a trailing dash
                // would be fragile).
                const optionKey = option.value || "no-preference";
                const radioId = `bed-setup-${type.value}-${optionKey}`;
                return (
                  <label
                    key={optionKey}
                    htmlFor={radioId}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      checked
                        ? "border-primary bg-primary-light text-gray-900"
                        : "border-gray-200 bg-white text-gray-700 hover:border-primary/40"
                    }`}
                  >
                    <input
                      id={radioId}
                      type="radio"
                      name={`bedSetup_${type.value}`}
                      value={option.value}
                      checked={checked}
                      onChange={() => {
                        // Broadcast to every room of this
                        // type. For the per-room wire shape,
                        // the parent filters by `value`
                        // when assembling the body.
                        const next: Record<number, string> = { ...bedSelections };
                        indices.forEach((idx) => {
                          next[idx] = option.value;
                        });
                        onSetBedSelections(next);
                      }}
                      className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {/* ── Show additional preferences accordion ─────── */}
      <div className="rounded-card border border-gray-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setAccordionOpen((open) => !open)}
          className="flex w-full min-h-[40px] items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-primary hover:bg-primary-light/40"
          aria-expanded={accordionOpen}
          aria-controls="additional-preferences-panel"
        >
          <span>Show additional preferences</span>
          <ChevronDown
            size={16}
            className={`transition ${accordionOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {accordionOpen ? (
          <div
            id="additional-preferences-panel"
            className="space-y-4 border-t border-gray-100 px-4 py-4"
          >
            {bookingPreferences.length === 0 ? (
              <p className="text-xs text-gray-500">
                No preferences are configured for this booking yet.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {bookingPreferences.map((option) => {
                  const checked = additionalPreferences.includes(option.value);
                  const checkboxId = `pref-${option.value}`;
                  return (
                    <label
                      key={option.value}
                      htmlFor={checkboxId}
                      className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:border-primary"
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        value={option.value}
                        checked={checked}
                        onChange={() => togglePreference(option.value)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <span className="flex-1">
                        {option.label}
                        {option.surchargeNote ? (
                          <span className="ml-1 font-normal text-gray-500">
                            {option.surchargeNote}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <label className="block text-xs font-semibold text-gray-700">
              Any additional requests?
              <span className="ml-1 font-normal text-gray-500">
                Let us know in English
              </span>
              <textarea
                value={additionalRequest}
                onChange={(e) =>
                  onSetAdditionalRequest(e.target.value.slice(0, ADDITIONAL_REQUEST_MAX_LENGTH))
                }
                maxLength={ADDITIONAL_REQUEST_MAX_LENGTH}
                rows={3}
                placeholder="Enter any additional requests"
                className="mt-1 w-full rounded border border-gray-250 bg-white px-3 py-2 text-sm font-medium focus:bg-white"
              />
              <span className="mt-1 block text-[10px] font-normal text-gray-500">
                {additionalRequest.length} / {ADDITIONAL_REQUEST_MAX_LENGTH} characters
              </span>
            </label>

            <label className="block text-xs font-semibold text-gray-700">
              <span className="block">Let us know when you are arriving</span>
              <select
                value={expectedArrivalTime ?? ""}
                onChange={(e) =>
                  onSetExpectedArrivalTime(e.target.value === "" ? null : e.target.value)
                }
                className="mt-1 min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium"
              >
                {arrivalOptions.map((option) => (
                  <option
                    key={option.value ?? "none"}
                    value={option.value ?? ""}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] font-normal text-gray-500">
                We&apos;ll let the property or host know when to expect you.
              </span>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}