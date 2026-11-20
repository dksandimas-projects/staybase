import { useMemo } from "react";
import { History } from "lucide-react";
import { useAdmin, type Booking } from "../context/AdminContext";
// Per ATR-05 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the ONE
// shared staff-UID → display-name resolver. The drawer used to print
// raw 28-character Firebase Auth UIDs — or the literal "Staff" —
// which tells a front-desk user nothing.
import { buildStaffNameMap, staffNameFor } from "@spark-inn/shared";

/**
 * Per ATR-05 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the
 * booking drawer's PROVENANCE line — who created this booking, who
 * checked the guest in, who checked them out, and who last touched it.
 *
 * WHY IT IS HERE: the owner's first question about a booking is
 * "who made this?" — and until ATR-04 the answer was a blank. The
 * drawer is where the desk already is, so the answer belongs there
 * (and it is Front-Desk-readable, unlike the full audit log).
 *
 * EVERY FIELD IS OPTIONAL. A booking written before ATR-04 carries
 * none of them, and this component renders NOTHING in that case
 * rather than an empty attribution ("Created by —"). A segment with
 * no attribution is omitted; the rest of the line still renders.
 */
export function BookingProvenanceLine({ booking }: { booking: Booking }) {
  const { staff } = useAdmin();
  const staffNameMap = useMemo(() => buildStaffNameMap(staff), [staff]);

  /**
   * One attribution segment.
   *
   * The `*ByName` companion — the display name AT WRITE TIME
   * (decision 5) — wins when present, because it survives a staff
   * account that has since been renamed or deleted. The uid is the
   * fallback, resolved through the shared map.
   *
   * Returns `null` when there is no attributable actor, which is
   * what makes the segment disappear rather than read "—".
   */
  const actor = (
    name: string | null | undefined,
    uid: string | null | undefined
  ): string | null => {
    if (name) return name;
    if (!uid) return null;
    return staffNameFor(staffNameMap, uid, "") || null;
  };

  const creatorLabel =
    booking.createdByName ||
    (booking.createdBy === "guest" ? "Guest" : null) ||
    actor(null, booking.createdBy);
  const checkedInLabel = actor(booking.checkedInByName, booking.checkedInBy);
  const checkedOutLabel = actor(booking.checkedOutByName, booking.checkedOutBy);
  // Per ATR-04: `handledBy` keeps its current behaviour — it is the
  // LAST staff member to touch this booking. It is documented (not
  // renamed) as such.
  const handledByLabel = actor(null, booking.handledBy);

  const segments = (
    [
      { key: "created", label: "Created by", value: creatorLabel },
      { key: "checked-in", label: "Checked in by", value: checkedInLabel },
      { key: "checked-out", label: "Checked out by", value: checkedOutLabel },
      { key: "handled-by", label: "Last updated by", value: handledByLabel }
    ] as Array<{ key: string; label: string; value: string | null }>
  ).filter((segment): segment is { key: string; label: string; value: string } =>
    Boolean(segment.value)
  );

  // A legacy booking with no attribution at all renders NOTHING —
  // not an empty line, not a row of em-dashes.
  if (segments.length === 0) return null;

  return (
    <p
      data-testid="booking-provenance-line"
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500"
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
