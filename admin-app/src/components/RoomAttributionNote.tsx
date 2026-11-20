import { useMemo } from "react";
import { History } from "lucide-react";
import { useAdmin, type Room } from "../context/AdminContext";
// Per ATR-05 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the ONE
// shared staff-UID → display-name resolver.
import { buildStaffNameMap, staffNameFor } from "@spark-inn/shared";

/**
 * Per ATR-03 / ATR-05 (2026-11-20,
 * `plan/features/AUDIT-TRAIL.md`): the room's attribution note.
 *
 * Before ATR-03 a room record carried NO trace of who touched it —
 * the owner's first question ("who put this room out of service?")
 * had no answer at all. The denormalized `updatedBy` /
 * `statusChangedBy` / `housekeepingUpdatedBy` triples on the room
 * document are that answer, and this note is where they surface.
 *
 * HOUSEKEEPING GETS ITS OWN SEGMENT because it is the
 * highest-frequency room write (a tap per room per day) and would
 * otherwise bury every other room change under the general
 * "last updated" stamp.
 *
 * EVERY FIELD IS OPTIONAL. A room written before ATR-03 carries none
 * of them, and this component renders NOTHING in that case rather
 * than an empty attribution.
 */
export function RoomAttributionNote({ room }: { room: Room }) {
  const { staff } = useAdmin();
  const staffNameMap = useMemo(() => buildStaffNameMap(staff), [staff]);

  /**
   * The display name for one attribution triple.
   *
   * The `*ByName` companion — the display name AT WRITE TIME
   * (decision 5) — wins when present, because it survives a staff
   * account that has since been renamed or deleted. The uid is the
   * fallback, resolved through the shared map.
   */
  const actor = (
    name: string | null | undefined,
    uid: string | null | undefined
  ): string | null => {
    if (name) return name;
    if (!uid) return null;
    return staffNameFor(staffNameMap, uid, "") || null;
  };

  const updatedLabel = actor(room.updatedByName, room.updatedBy);
  const statusLabel = actor(room.statusChangedByName, room.statusChangedBy);
  const housekeepingLabel = actor(
    room.housekeepingUpdatedByName,
    room.housekeepingUpdatedBy
  );

  const segments = (
    [
      { key: "updated", label: "Last updated by", value: updatedLabel },
      { key: "status", label: "Status changed by", value: statusLabel },
      { key: "housekeeping", label: "Housekeeping by", value: housekeepingLabel }
    ] as Array<{ key: string; label: string; value: string | null }>
  ).filter((segment): segment is { key: string; label: string; value: string } =>
    Boolean(segment.value)
  );

  // A legacy room with no attribution at all renders NOTHING.
  if (segments.length === 0) return null;

  return (
    <p
      data-testid="room-attribution-note"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500"
    >
      <History size={12} aria-hidden="true" className="text-gray-400" />
      {segments.map((segment) => (
        <span key={segment.key} className="inline-flex items-center gap-1">
          {segment.label}{" "}
          <span className="font-semibold text-gray-700">{segment.value}</span>
        </span>
      ))}
    </p>
  );
}
