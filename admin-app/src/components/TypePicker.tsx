import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BedDouble, GripVertical } from "lucide-react";
import { MAX_FEATURED_TYPES } from "@spark-inn/shared";

// Featured-types picker. Replaces the old RoomPicker — see
// `MAX_FEATURED_TYPES` in `shared/constants/index.ts` for the
// rationale (the card content is type-driven, not room-driven).
// The admin picks up to MAX_FEATURED_TYPES room types; the
// homepage resolves each to its first active room.
//
// Two-pane selector:
//   - Left: available types, each row shows the type label +
//     short label + the count of active rooms of that type.
//     Types with zero active rooms are grayed out and can't be
//     added.
//   - Right: picked types, up/down reorder, capped at
//     MAX_FEATURED_TYPES. The order here is the render order on
//     the public homepage.

interface PickerRoomType {
  value: string;
  label: string;
  shortLabel?: string;
}

interface TypePickerProps {
  label?: string;
  helper?: string;
  roomTypes: PickerRoomType[];
  activeRoomCounts: Record<string, number>;
  value: string[];
  onChange: (next: string[]) => void;
  maxItems?: number;
}

export function TypePicker({
  label = "Featured room types",
  helper = "Pick up to 3 room types to surface on the homepage. The card for each type shows the type's photo, bed, amenities, capacity, and price. The order here is the render order on the guest site. When empty, the homepage falls back to the first 3 types that have at least one active room.",
  roomTypes,
  activeRoomCounts,
  value,
  onChange,
  maxItems = MAX_FEATURED_TYPES
}: TypePickerProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // A type is selectable when it has at least one active room.
  // We still render types with zero active rooms so the admin
  // sees them (and understands why they can't be added) — but
  // they are grayed out and the Add button is disabled.
  const counts = activeRoomCounts;
  const withMeta = useMemo(
    () =>
      roomTypes.map((t) => ({
        ...t,
        activeCount: counts[t.value] ?? 0
      })),
    [roomTypes, counts]
  );

  const available = withMeta.filter((t) => !value.includes(t.value));
  const picked = value
    .map((v) => withMeta.find((t) => t.value === v))
    .filter((t): t is PickerRoomType & { activeCount: number } => Boolean(t));

  function add(typeValue: string) {
    const meta = withMeta.find((t) => t.value === typeValue);
    if (!meta || meta.activeCount <= 0) return;
    if (value.length >= maxItems) return;
    if (value.includes(typeValue)) return;
    onChange([...value, typeValue]);
  }

  function remove(typeValue: string) {
    onChange(value.filter((v) => v !== typeValue));
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...value];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-gray-800">{label}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{helper}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Available types */}
        <div className="rounded-card border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Available types</p>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold text-gray-600">
              {available.length}
            </span>
          </div>
          {available.length === 0 ? (
            <p className="px-3 py-4 text-[10px] text-gray-500">
              {picked.length >= maxItems
                ? `Already at the cap of ${maxItems} types. Remove one to add another.`
                : "All available types are already featured."}
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {available.map((t) => {
                const disabled = t.activeCount <= 0;
                return (
                  <li
                    key={t.value}
                    onMouseEnter={() => setHighlighted(t.value)}
                    onMouseLeave={() => setHighlighted(null)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs ${disabled ? "opacity-50" : ""}`}
                  >
                    <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded bg-section-bg text-gray-300">
                      <BedDouble size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-800">{t.label}</p>
                      <p className="text-[10px] text-gray-500">
                        {t.shortLabel && t.shortLabel !== t.label ? `${t.shortLabel} · ` : ""}
                        {disabled
                          ? "No active rooms"
                          : `${t.activeCount} active room${t.activeCount === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => add(t.value)}
                      disabled={disabled || value.length >= maxItems}
                      className="inline-flex min-h-[28px] items-center gap-1 rounded border border-primary px-2 py-0.5 text-[10px] font-semibold text-primary transition hover:bg-primary-light disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ArrowRight size={11} />
                      Add
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Picked types (the render order on the homepage) */}
        <div className="rounded-card border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Featured on homepage</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                value.length === 0
                  ? "bg-gray-100 text-gray-500"
                  : value.length >= maxItems
                    ? "bg-primary-light text-primary-dark"
                    : "bg-amber-50 text-amber-700"
              }`}
            >
              {value.length} / {maxItems}
            </span>
          </div>
          {picked.length === 0 ? (
            <p className="px-3 py-4 text-[10px] text-gray-500">
              No types picked. The guest site falls back to the first {maxItems} types that have at least one active room.
            </p>
          ) : (
            <ol className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {picked.map((t, index) => (
                <li key={t.value} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                    {index + 1}
                  </span>
                  <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded bg-section-bg text-gray-300">
                    <BedDouble size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-800">{t.label}</p>
                    <p className="text-[10px] text-gray-500">
                      {t.activeCount} active room{t.activeCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <GripVertical size={13} className="rotate-180" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === picked.length - 1}
                      aria-label="Move down"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <GripVertical size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(t.value)}
                      aria-label="Remove"
                      className="inline-flex min-h-[28px] items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      <ArrowLeft size={11} />
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <span data-testid="type-picker-highlight" className="hidden">
        {highlighted ?? ""}
      </span>
    </div>
  );
}
