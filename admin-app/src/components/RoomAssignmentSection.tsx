import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

/**
 * Per RAR-01 (decision #323): one room of the verified scope.
 * The room the booking was PRE-ASSIGNED at creation time —
 * the server auto-assigns a room when the booking is created —
 * together with the booking that owns it (so the override can be
 * applied to the right document).
 */
export interface RoomAssignment {
  bookingId: string;
  roomId: string;
  roomNumber: string;
  /** The room-type KEY (e.g. "superior") — used to match candidates. */
  roomType: string;
  /** The human label for the room type. Falls back to the key. */
  roomTypeLabel?: string;
}

/**
 * Per RAR-01 (decision #323): a room of the hotel that the desk
 * may re-assign the booking to. The list is filtered to the
 * booking's CURRENT room type — a category change is a different
 * action ("Move / upgrade room") that re-prices deliberately.
 */
export interface AssignableRoom {
  id: string;
  roomNumber: string;
  /** The room-type KEY. */
  type: string;
  /** The human label for the room type. */
  typeLabel: string;
  isActive: boolean;
}

interface RoomAssignmentSectionProps {
  /** The rooms to show — one row each. */
  assignments: RoomAssignment[];
  /** The hotel's rooms, so the desk can pick a different one. */
  rooms: AssignableRoom[];
  /**
   * Applies the override. Resolves with the new room number on
   * success, or an error message on failure. The parent owns the
   * API call; this component owns the picker + the inline error.
   */
  onAssignRoom?: (
    bookingId: string,
    roomId: string,
    reason: string
  ) => Promise<{ ok: boolean; error?: string; roomNumber?: string; roomId?: string }>;
  /** The section heading. Defaults to "Room assignment". */
  heading?: string;
  /** The sub-heading. Defaults to "Pre-assigned at booking". */
  subheading?: string;
  /**
   * Fired when an override starts and finishes, so a parent can
   * disable its OWN primary action (the confirm button) while a
   * room change is in flight. Without it the desk could confirm a
   * booking and change its room at the same time, and the two
   * server calls would race.
   */
  onBusyChange?: (busy: boolean) => void;
  /**
   * Changing this value RESETS the picker (closes it, clears the
   * selected room + the reason + the error) and re-reads
   * `assignments`. The parent passes something that changes when
   * the scope changes — e.g. the booking id for the drawer's
   * confirm modal, or the booking reference for the post-verify
   * success modal.
   */
  resetKey?: string;
}

// Per RAR-01 (decision #323): the room-override panel.
//
// The server AUTO-ASSIGNS a room to every booking at creation time,
// and the desk may need to CORRECT that assignment — the room needs
// cleaning, the guest prefers the other side of the hall. The
// override re-points the booking at another room of the SAME
// CATEGORY and, by construction, leaves the money alone (the server
// reads the stay window and the total from the booking and carries
// both forward verbatim — see `POST /api/bookings/assign-room`).
//
// This component is deliberately SURFACE-AGNOSTIC: it is used by the
// post-verify success modal (where the scope is the whole verified
// reservation) AND by the booking drawer's confirm-booking modal
// (where the scope is the single booking being confirmed). Both
// render the same picker, the same same-category rule and the same
// audit-trail reason field.
export function RoomAssignmentSection({
  assignments,
  rooms,
  onAssignRoom,
  heading = "Room assignment",
  subheading = "Pre-assigned at booking",
  onBusyChange,
  resetKey
}: RoomAssignmentSectionProps) {
  // `editingBookingId` is the booking whose picker is open (only one
  // at a time — the desk overrides one room at a time).
  // `pendingRoomId` is the target room the desk picked but has not
  // applied yet. `assigningBookingId` marks the in-flight request so
  // the row can show a spinner.
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<string>("");
  const [assignReason, setAssignReason] = useState<string>("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigningBookingId, setAssigningBookingId] = useState<string | null>(null);
  // This component's own copy of the assignments, so a successful
  // override updates the row IMMEDIATELY (the parent also updates
  // its own state, and the Firestore listener will confirm it a
  // moment later).
  const [localAssignments, setLocalAssignments] = useState<RoomAssignment[]>(assignments);

  // Reset the picker whenever the scope changes. A stale open picker
  // would point at the previous booking's rooms.
  useEffect(() => {
    setLocalAssignments(assignments);
    setEditingBookingId(null);
    setPendingRoomId("");
    setAssignReason("");
    setAssignError(null);
    setAssigningBookingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const rows = localAssignments.length > 0 ? localAssignments : assignments;

  // Per RAR-01 (decision #323): the candidate rooms for one
  // assignment. SAME CATEGORY ONLY — the server enforces the
  // same rule, so offering a different category here would only
  // produce a failed round trip.
  const candidatesFor = (assignment: RoomAssignment) =>
    rooms.filter((r) => r.isActive && r.type === assignment.roomType && r.id !== assignment.roomId);

  const startEditing = (assignment: RoomAssignment) => {
    setEditingBookingId(assignment.bookingId);
    setPendingRoomId("");
    setAssignReason("");
    setAssignError(null);
  };

  const cancelEditing = () => {
    setEditingBookingId(null);
    setPendingRoomId("");
    setAssignReason("");
    setAssignError(null);
  };

  const applyAssignment = async (assignment: RoomAssignment) => {
    if (!onAssignRoom || !pendingRoomId) return;
    setAssigningBookingId(assignment.bookingId);
    setAssignError(null);
    onBusyChange?.(true);
    try {
      const result = await onAssignRoom(
        assignment.bookingId,
        pendingRoomId,
        assignReason.trim() || "Room re-assigned at the front desk"
      );
      if (!result.ok) {
        setAssignError(result.error || "Could not re-assign the room.");
        return;
      }
      const target = rooms.find((r) => r.id === pendingRoomId);
      setLocalAssignments((previous) => {
        const list = previous.length > 0 ? previous : assignments;
        return list.map((a) =>
          a.bookingId === assignment.bookingId
            ? {
                ...a,
                roomId: result.roomId || pendingRoomId,
                roomNumber: result.roomNumber || target?.roomNumber || a.roomNumber
              }
            : a
        );
      });
      cancelEditing();
    } catch (err: any) {
      setAssignError(err?.message || "Could not re-assign the room.");
    } finally {
      setAssigningBookingId(null);
      onBusyChange?.(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
          {heading}
        </h4>
        <span className="text-[10px] text-gray-400">{subheading}</span>
      </div>
      <ul className="mt-2 space-y-2">
        {rows.map((assignment) => {
          const typeLabel = assignment.roomTypeLabel || assignment.roomType;
          const isEditing = editingBookingId === assignment.bookingId;
          const isAssigning = assigningBookingId === assignment.bookingId;
          const candidates = candidatesFor(assignment);
          return (
            <li key={assignment.bookingId} className="rounded-md bg-gray-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    Room {assignment.roomNumber}
                  </p>
                  <p className="text-xs text-gray-500">{typeLabel}</p>
                </div>
                {!isEditing && onAssignRoom ? (
                  <button
                    type="button"
                    onClick={() => startEditing(assignment)}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Change
                  </button>
                ) : null}
              </div>

              {isEditing ? (
                <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
                  {candidates.length === 0 ? (
                    <p className="text-xs font-semibold text-amber-800">
                      No other active {typeLabel} room to swap to.
                    </p>
                  ) : (
                    <>
                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
                        Move to
                        <select
                          value={pendingRoomId}
                          onChange={(e) => setPendingRoomId(e.target.value)}
                          className="min-h-11 rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal text-gray-900"
                        >
                          <option value="">Select a room</option>
                          {candidates.map((r) => (
                            <option key={r.id} value={r.id}>
                              Room {r.roomNumber} ({r.typeLabel})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
                        Reason (audit trail)
                        <input
                          type="text"
                          maxLength={500}
                          value={assignReason}
                          onChange={(e) => setAssignReason(e.target.value)}
                          placeholder="e.g. Pre-assigned room needs cleaning"
                          className="min-h-11 rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal text-gray-900"
                        />
                      </label>

                      {assignError ? (
                        <p
                          role="alert"
                          className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                        >
                          {assignError}
                        </p>
                      ) : null}

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEditing}
                          disabled={isAssigning}
                          className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void applyAssignment(assignment)}
                          disabled={isAssigning || !pendingRoomId}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAssigning ? (
                            <>
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              Saving…
                            </>
                          ) : (
                            "Apply"
                          )}
                        </button>
                      </div>

                      <p className="text-[10px] leading-relaxed text-gray-500">
                        Same category only — the price does not change. A different room
                        type is a “Move / upgrade room” action on the booking.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
