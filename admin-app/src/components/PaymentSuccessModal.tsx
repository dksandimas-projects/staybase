import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Mail, Pencil, Users } from "lucide-react";
import { Modal } from "./Modal";
import { formatPrice } from "../utils/format";

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

interface PaymentSuccessModalProps {
  open: boolean;
  onClose: () => void;
  // Booking context (for the success summary)
  bookingRef: string;
  guestName: string;
  guestEmail: string;
  roomType: string;
  /**
   * Per VPM-01 (decision #322): the room the guest is booked into.
   * The modal previously showed only the room TYPE, so a desk
   * juggling several proofs could not tell whose money they were
   * looking at. Falls back to `roomType` when absent.
   */
  roomLabel?: string;
  /**
   * Per VPM-01 (decision #322): the stay, rendered as a short
   * human label ("20 → 21 Nov 2026 · 1 night"). Optional — the
   * row is omitted when absent.
   */
  stayLabel?: string;
  // Payment summary
  amount: number;
  method: string;
  // Per the surface where the modal is rendered:
  // - "drawer": the BookingsPage booking drawer. The staff
  //   is already viewing the booking, so the secondary CTA
  //   is "Later" (just dismiss).
  // - "dashboard": the dashboard's pending-payments list. The
  //   staff is acting from a list, so the secondary CTA is
  //   "View booking" (navigate to the bookings page) so they
  //   can do further work if needed.
  surface: "drawer" | "dashboard";
  /**
   * TRUE iff the scope's BOOKING total is covered by the payment
   * (the server's own status rule — see
   * `shared/utils/verifyPaymentOutcome.ts`). This drives the
   * HEADLINE only.
   *
   * It does NOT decide the CTA. The CTA is decided by
   * `remainingBalance`: a booking whose room total is covered but
   * which still owes an other add-on is NOT free to confirm, so
   * the "Confirm with Balance" path (reason + four-eyes
   * threshold) is still required.
   */
  isFullPayment: boolean;
  /**
   * What is still owed on the FOLIO after this payment (the room
   * total + the BR-12 other add-ons + charges, minus everything
   * collected). `0` means nothing is outstanding.
   */
  remainingBalance?: number;
  /**
   * Per VPM-01 (decision #322): the scope's booking total, shown
   * so the desk can reconcile the amount they just recorded
   * against what the guest was charged.
   */
  bookingTotal?: number;
  /**
   * Per FOL-05 (decision #201): how many SIBLING rooms this
   * payment cleared in the same transaction. The server computes
   * it and the admin context parses it, but the modal used to
   * drop it — so a desk verifying a 3-room reservation was never
   * told that two other rooms had been cleared at the same time.
   * Rendered as a breadcrumb when > 0.
   */
  siblingFlippedCount?: number;
  /** The reservation's public reference, for the breadcrumb. */
  reservationRef?: string;
  // "Confirm Booking" CTA — only enabled when nothing is
  // outstanding, because a booking with money still owed must go
  // through the confirm-with-balance flow (a required reason plus
  // the four-eyes approval limit).
  onConfirmBooking?: () => void;
  confirmingBooking?: boolean;
  // Optional secondary CTA on the dashboard surface.
  onViewBooking?: () => void;
  // Optional human-readable method label, e.g. "GCash" or
  // "Bank Transfer". Falls back to the raw method key.
  methodLabel?: string;
  // Per CWB-04 / decision #122: primary CTA on the
  // partial-payment variant. Opens the confirm-with-
  // balance form so staff can transition the booking to
  // `confirmed` while recording the outstanding amount for
  // check-in. The parent owns the form open-state and the
  // current balance computation.
  onConfirmWithBalance?: () => void;
  confirmingWithBalance?: boolean;
  /**
   * Per VPM-01 (decision #322): an inline error. The confirm
   * action used to close the modal in its `finally` block, so a
   * failed confirmation left the desk with a toast and no modal
   * to retry from — the money state they were looking at
   * vanished. The modal now STAYS OPEN on failure and shows the
   * reason inline.
   */
  error?: string | null;
  /**
   * Per RAR-01 (decision #323): the rooms in the verified scope,
   * each with the room number the booking was PRE-ASSIGNED at
   * creation time. The modal renders them so the desk can CHECK
   * the assignment without opening the booking.
   *
   * When omitted, the modal renders no room-assignment section —
   * the pre-existing "Room" row in the summary card still shows
   * the room label.
   */
  roomAssignments?: RoomAssignment[];
  /**
   * Per RAR-01 (decision #323): the hotel's rooms, so the desk can
   * pick a different one. Only same-category rooms are offered;
   * the server enforces the same rule independently.
   */
  assignableRooms?: AssignableRoom[];
  /**
   * Per RAR-01 (decision #323): applies the override. Resolves
   * with the new room number on success, or an error message on
   * failure. The parent owns the API call; the modal owns the
   * picker + the inline error.
   */
  onAssignRoom?: (
    bookingId: string,
    roomId: string,
    reason: string
  ) => Promise<{ ok: boolean; error?: string; roomNumber?: string; roomId?: string }>;
}

// Per feat/payment-success-modal: closes the loop after
// "Verify & Record Payment" succeeds. Three jobs in one
// modal:
//   1. Confirm what just happened (amount + method + guest)
//   2. Tell the staff what the system did automatically
//      (the payment-confirmed email was sent)
//   3. Nudge the front desk to the natural next step —
//      confirming the booking.
//
// Per CWB-04 / decision #122: the partial variant ships with a
// **"Confirm with Balance"** primary CTA that opens the
// confirm-with-balance form so a partial payment can move the
// booking to `confirmed` with the outstanding amount recorded for
// collection at check-in.
//
// Per VPM-01 (decision #322): the CTA is now decided by the
// FOLIO balance, not by the booking total. Before this, the
// dashboard's "Confirm Booking" CTA fired on a booking that still
// owed an other add-on — with no reason recorded, no four-eyes
// approval, and no booking context on screen. The rule is now:
// **nothing outstanding → "Confirm Booking"; anything outstanding
// → "Confirm with Balance"** (which requires a reason and, above
// the approval limit, an admin). The headline still follows the
// server's own status rule so the desk sees "Payment confirmed"
// exactly when the server flipped the booking to `payment-confirmed`.
export function PaymentSuccessModal({
  open,
  onClose,
  bookingRef,
  guestName,
  guestEmail,
  roomType,
  roomLabel,
  stayLabel,
  amount,
  method,
  methodLabel,
  surface,
  isFullPayment,
  remainingBalance,
  bookingTotal,
  siblingFlippedCount,
  reservationRef,
  onConfirmBooking,
  confirmingBooking,
  onViewBooking,
  onConfirmWithBalance,
  confirmingWithBalance,
  error,
  roomAssignments,
  assignableRooms,
  onAssignRoom
}: PaymentSuccessModalProps) {
  // The single decision that matters: is money still owed?
  const hasOutstandingBalance = Number(remainingBalance || 0) > 0;
  const showConfirmWithBalance = hasOutstandingBalance;
  const busy = confirmingBooking || confirmingWithBalance;

  // Per RAR-01 (decision #323): the room-override picker state.
  // `editingBookingId` is the booking whose picker is open (only
  // one at a time — the desk overrides one room at a time).
  // `pendingRoomId` is the target room the desk picked but has
  // not applied yet. `assigningBookingId` marks the in-flight
  // request so the row can show a spinner and the other rows can
  // stay inert.
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<string>("");
  const [assignReason, setAssignReason] = useState<string>("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigningBookingId, setAssigningBookingId] = useState<string | null>(null);
  // The modal's own copy of the assignments, so a successful
  // override updates the row IMMEDIATELY (the parent also
  // updates its own state, and the Firestore listener will
  // confirm it a moment later).
  const [localAssignments, setLocalAssignments] = useState<RoomAssignment[] | null>(null);

  // Reset the picker whenever the modal opens — a new
  // verification is a new scope, and a stale open picker would
  // point at the previous booking's rooms.
  useEffect(() => {
    if (!open) return;
    setLocalAssignments(roomAssignments ? [...roomAssignments] : null);
    setEditingBookingId(null);
    setPendingRoomId("");
    setAssignReason("");
    setAssignError(null);
    setAssigningBookingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const assignments = localAssignments ?? roomAssignments ?? [];
  const rooms = assignableRooms ?? [];

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
        const list = previous ?? assignments;
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
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isFullPayment ? "Payment confirmed" : "Payment recorded"}
      className="max-w-md"
    >
      <div className="space-y-4">
        {/* Per FOL-05 (decision #201): the sibling rooms this
            payment cleared in the same transaction. The server
            computes the count; the desk needs it to know the
            payment covered more than the room on screen. */}
        {typeof siblingFlippedCount === "number" && siblingFlippedCount > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
          >
            <Users className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">
                {siblingFlippedCount} more room{siblingFlippedCount === 1 ? "" : "s"} cleared
              </span>
              {reservationRef ? ` — ${reservationRef}` : ""} — this payment covered them too.
            </span>
          </div>
        )}

        {/* Hero — celebratory on full, neutral on partial */}
        <div className="flex flex-col items-center text-center pt-2">
          <div
            className={
              isFullPayment
                ? "rounded-full bg-emerald-100 p-3"
                : "rounded-full bg-amber-100 p-3"
            }
          >
            {isFullPayment ? (
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            )}
          </div>
          <h3 className="mt-3 font-heading text-xl text-gray-950">
            {isFullPayment ? "Payment confirmed" : "Partial payment recorded"}
          </h3>
        </div>

        {/* Payment summary card — the staff's receipt */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-600">Amount</span>
            <span className="font-bold text-gray-900">{formatPrice(amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Method</span>
            <span className="font-semibold text-gray-900">
              {methodLabel || method}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Booking</span>
            <span className="font-mono font-semibold text-gray-900">
              {bookingRef}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Guest</span>
            <span className="font-semibold text-gray-900">{guestName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Room</span>
            <span className="font-semibold text-gray-900">
              {roomLabel || roomType}
            </span>
          </div>
          {stayLabel ? (
            <div className="flex justify-between">
              <span className="text-gray-600">Stay</span>
              <span className="font-semibold text-gray-900">{stayLabel}</span>
            </div>
          ) : null}
          {typeof bookingTotal === "number" && bookingTotal > 0 ? (
            <div className="flex justify-between">
              <span className="text-gray-600">Booking total</span>
              <span className="font-semibold text-gray-900">
                {formatPrice(bookingTotal)}
              </span>
            </div>
          ) : null}
        </div>

        {/* Per RAR-01 (decision #323): the room assignment. The
            booking was PRE-ASSIGNED a room when it was created —
            the server picks one automatically. The desk could see
            the room TYPE in the summary card above, but not the
            NUMBER, so they could not check the assignment without
            opening the booking. This section shows the number AND
            lets them re-point it at another room of the SAME
            CATEGORY, with the price untouched. */}
        {assignments.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Room assignment
              </h4>
              <span className="text-[10px] text-gray-400">Pre-assigned at booking</span>
            </div>
            <ul className="mt-2 space-y-2">
              {assignments.map((assignment) => {
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
        ) : null}

        {/* Email-sent confirmation — closes the "did the system
            actually notify the guest?" loop that used to be silent. */}
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Mail className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            A payment-confirmed email has been sent to{" "}
            <span className="font-semibold">{guestEmail}</span>.
          </span>
        </div>

        {/* Outstanding folio balance. Per VPM-01 (decision #322)
            this renders whenever ANY money is still owed — not
            only when the booking total is short. The two cases
            read differently on purpose: a covered room with an
            unpaid add-on is NOT the same as a partly-paid room,
            and the desk's next action differs. */}
        {hasOutstandingBalance && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">
                {isFullPayment ? "Still owing on the folio" : "Balance remaining"}
              </span>
              <span className="font-bold text-amber-900">
                {formatPrice(remainingBalance || 0)}
              </span>
            </div>
            <p className="mt-1 text-amber-800">
              {isFullPayment
                ? "The room and booking total are covered. This amount is other add-ons or charges on the folio — it is collected at check-in. Confirming still needs a reason, and an admin above the approval limit."
                : "Confirm with the balance owed (will be collected at check-in), or record another payment first."}
            </p>
          </div>
        )}

        {/* Per VPM-01 (decision #322): the confirm action's inline
            error. The modal stays open so the desk can read the
            reason against the money state and retry. */}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
          >
            {error}
          </p>
        ) : null}

        {/* CTAs */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {/* Surface-specific secondary: "View booking" on the
              dashboard (jump to the bookings page), nothing on
              the drawer (the booking is already visible). */}
          {surface === "dashboard" && onViewBooking && (
            <button
              type="button"
              onClick={onViewBooking}
              className="min-h-11 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
            >
              View booking
            </button>
          )}

          {/* Per VPM-01 (decision #322): the primary CTA is decided
              by the FOLIO balance, not by the booking total.
              "Confirm Booking" only when nothing is outstanding;
              otherwise "Confirm with Balance", which demands a
              reason and applies the four-eyes approval limit. */}
          {showConfirmWithBalance ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="min-h-11 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Later
              </button>
              <button
                type="button"
                onClick={onConfirmWithBalance}
                disabled={busy || !onConfirmWithBalance}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                Confirm with Balance
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="min-h-11 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Later
              </button>
              <button
                type="button"
                onClick={onConfirmBooking}
                disabled={busy || !onConfirmBooking}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirmingBooking ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Confirming…
                  </>
                ) : (
                  "Confirm Booking"
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
