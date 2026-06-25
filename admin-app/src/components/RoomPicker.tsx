import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BedDouble, GripVertical } from "lucide-react";
import { MAX_FEATURED_ROOMS } from "@spark-inn/shared";
import type { RoomTypeEntry } from "@spark-inn/shared";

// The picker only needs a handful of room fields. Defining its own
// structural type (instead of importing the shared `Room` or the
// admin `Room`) keeps the component decoupled from the rest of the
// admin app's Room shape — including the `createdAt` / `updatedAt`
// fields the shared `Room` requires.
interface PickerRoom {
  id: string;
  name: string;
  roomNumber: string;
  type: string;
  isActive: boolean;
}

// Featured-rooms picker. The admin can pick up to MAX_FEATURED_ROOMS
// active rooms to surface on the homepage's "Featured Rooms" section.
// The component takes the full rooms + roomTypes lists and the
// current featuredRoomIds; it emits the new ordered array up. The
// UI is a two-pane selector: available rooms on the left, picked
// rooms on the right, with up/down reorder on the picked side.
interface RoomPickerProps {
  label?: string;
  helper?: string;
  rooms: PickerRoom[];
  roomTypes: RoomTypeEntry[];
  value: string[];
  onChange: (next: string[]) => void;
  maxItems?: number;
}

function findTypeImage(roomTypes: RoomTypeEntry[], type: string): string | null {
  const t = roomTypes.find((entry) => entry.value === type);
  if (!t || t.imageUrls.length === 0) return null;
  return t.imageUrls[0];
}

export function RoomPicker({
  label = "Featured rooms",
  helper = "Pick up to 3 active rooms to surface on the homepage. Drag to reorder; the first one is shown leftmost.",
  rooms,
  roomTypes,
  value,
  onChange,
  maxItems = MAX_FEATURED_ROOMS
}: RoomPickerProps) {
  const [highlightedAvailable, setHighlightedAvailable] = useState<string | null>(null);

  // Active rooms only — inactive rooms can never be featured.
  const activeRooms = useMemo(() => rooms.filter((r) => r.isActive), [rooms]);

  const available = useMemo(
    () => activeRooms.filter((r) => !value.includes(r.id)),
    [activeRooms, value]
  );
  const picked = useMemo(
    () =>
      value
        .map((id) => activeRooms.find((r) => r.id === id))
        .filter((r): r is PickerRoom => Boolean(r)),
    [value, activeRooms]
  );

  function add(roomId: string) {
    if (value.length >= maxItems) return;
    if (value.includes(roomId)) return;
    onChange([...value, roomId]);
  }

  function remove(roomId: string) {
    onChange(value.filter((id) => id !== roomId));
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
        {/* Available rooms */}
        <div className="rounded-card border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Available rooms
            </p>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold text-gray-600">
              {available.length}
            </span>
          </div>
          {available.length === 0 ? (
            <p className="px-3 py-4 text-[10px] text-gray-500">
              {activeRooms.length === 0
                ? "No active rooms yet. Add rooms in Room Management first."
                : `All ${activeRooms.length} active rooms are already featured.`}
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {available.map((room) => {
                const img = findTypeImage(roomTypes, room.type);
                return (
                  <li
                    key={room.id}
                    onMouseEnter={() => setHighlightedAvailable(room.id)}
                    onMouseLeave={() => setHighlightedAvailable(null)}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-section-bg text-gray-300">
                      {img ? (
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <BedDouble size={16} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-800">{room.name}</p>
                      <p className="text-[10px] text-gray-500">Room {room.roomNumber} · {room.type}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => add(room.id)}
                      disabled={value.length >= maxItems}
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

        {/* Picked rooms (the homepage render order) */}
        <div className="rounded-card border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Featured on homepage
            </p>
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
              No rooms picked. The guest site falls back to the first {maxItems} active rooms when this is empty.
            </p>
          ) : (
            <ol className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {picked.map((room, index) => {
                const img = findTypeImage(roomTypes, room.type);
                return (
                  <li key={room.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                      {index + 1}
                    </span>
                    <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-section-bg text-gray-300">
                      {img ? (
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <BedDouble size={16} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-800">{room.name}</p>
                      <p className="text-[10px] text-gray-500">Room {room.roomNumber} · {room.type}</p>
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
                        onClick={() => remove(room.id)}
                        aria-label="Remove"
                        className="inline-flex min-h-[28px] items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        <ArrowLeft size={11} />
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
      {/* Hidden helpers for tests / debugging */}
      <span data-testid="room-picker-highlight" className="hidden">
        {highlightedAvailable ?? ""}
      </span>
    </div>
  );
}
