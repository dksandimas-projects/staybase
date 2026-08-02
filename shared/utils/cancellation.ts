export interface CancellationPolicySnapshot {
  cutoffHours: number;
  refundPctBefore: number;
  refundPctAfter: number;
  policyText: string;
  scheduledCheckInTime: string; // The check-in ISO timestamp (UTC)
  source: "settings" | "corporate-override" | "legacy-fallback";
}

export interface CancellationEvaluation {
  refundPct: number;
  isBeforeCutoff: boolean;
  cutoffTimeMs: number;
  hoursRemaining: number;
  policySource: "settings" | "corporate-override" | "legacy-fallback";
}

export function parseCheckInTime(timeStr: string): { hours: number; minutes: number } {
  const normalized = timeStr.trim().toLowerCase();

  // Try 12h or 24h with colon: e.g. "14:00" or "2:00 PM"
  let match = normalized.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3];
    if (ampm === "pm" && hours < 12) {
      hours += 12;
    } else if (ampm === "am" && hours === 12) {
      hours = 0;
    }
    return { hours, minutes };
  }

  // Try 12h without colon: e.g. "2 PM" or "12 am"
  match = normalized.match(/^(\d{1,2})\s*(am|pm)$/);
  if (match) {
    let hours = parseInt(match[1]);
    const ampm = match[2];
    if (ampm === "pm" && hours < 12) {
      hours += 12;
    } else if (ampm === "am" && hours === 12) {
      hours = 0;
    }
    return { hours, minutes: 0 };
  }

  // Default fallback to 14:00
  return { hours: 14, minutes: 0 };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  const instantWithoutMilliseconds = Math.floor(date.getTime() / 1000) * 1000;
  return representedAsUtc - instantWithoutMilliseconds;
}

export function getCheckInInstant(dateKey: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const { hours, minutes } = parseCheckInTime(timeStr);
  const targetWallClock = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  let instant = targetWallClock;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timeZoneOffsetMs(new Date(instant), timeZone);
    const next = targetWallClock - offset;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function getLegacyCancellationPolicy(): string {
  return "Cancellations made 48 hours or more before check-in are eligible for a full refund. Cancellations within 48 hours of check-in are non-refundable. No-shows will be charged the full booking amount.";
}

export function evaluateCancellation(
  cancellationTime: Date | number,
  snapshot: CancellationPolicySnapshot | null | undefined,
  fallbackContext?: {
    checkInDateKey: string; // YYYY-MM-DD
    checkInTime?: string;   // e.g. "14:00"
    timeZone?: string;      // e.g. "Asia/Manila"
  }
): CancellationEvaluation {
  const cancellationMs = typeof cancellationTime === "number" ? cancellationTime : cancellationTime.getTime();

  const cutoffHours = snapshot?.cutoffHours ?? 48;
  const refundPctBefore = snapshot?.refundPctBefore ?? 100;
  const refundPctAfter = snapshot?.refundPctAfter ?? 0;
  const policySource = snapshot?.source ?? "legacy-fallback";

  let checkInMs: number;
  if (snapshot?.scheduledCheckInTime) {
    checkInMs = new Date(snapshot.scheduledCheckInTime).getTime();
  } else if (fallbackContext?.checkInDateKey) {
    checkInMs = getCheckInInstant(
      fallbackContext.checkInDateKey,
      fallbackContext.checkInTime || "14:00",
      fallbackContext.timeZone || "Asia/Manila"
    ).getTime();
  } else {
    checkInMs = Date.now();
  }

  const hoursRemaining = (checkInMs - cancellationMs) / (1000 * 60 * 60);
  const isBeforeCutoff = hoursRemaining >= cutoffHours;
  const cutoffTimeMs = checkInMs - (cutoffHours * 60 * 60 * 1000);
  const refundPct = isBeforeCutoff ? refundPctBefore : refundPctAfter;

  return {
    refundPct,
    isBeforeCutoff,
    cutoffTimeMs,
    hoursRemaining,
    policySource
  };
}

export function createCancellationPolicySnapshot(params: {
  websiteContent: {
    cancellationCutoffHours?: number;
    cancellationRefundPctBefore?: number;
    cancellationRefundPctAfter?: number;
    cancellationPolicy?: string;
  };
  hotelConfig: {
    checkInTime?: string;
    timezone?: string;
  };
  checkInDateKey: string; // YYYY-MM-DD
  corporateCodeData?: {
    cancellationCutoffHours?: number | null;
    cancellationRefundPctBefore?: number | null;
    cancellationRefundPctAfter?: number | null;
    cancellationPolicyText?: string | null;
  } | null;
}): CancellationPolicySnapshot {
  const tz = params.hotelConfig.timezone || "Asia/Manila";
  const stdCheckInTime = params.hotelConfig.checkInTime || "14:00";
  const checkInInstant = getCheckInInstant(params.checkInDateKey, stdCheckInTime, tz);

  let cutoffHours = typeof params.websiteContent.cancellationCutoffHours === "number"
    ? params.websiteContent.cancellationCutoffHours
    : 48;
  let refundPctBefore = typeof params.websiteContent.cancellationRefundPctBefore === "number"
    ? params.websiteContent.cancellationRefundPctBefore
    : 100;
  let refundPctAfter = typeof params.websiteContent.cancellationRefundPctAfter === "number"
    ? params.websiteContent.cancellationRefundPctAfter
    : 0;
  let policyText = params.websiteContent.cancellationPolicy || getLegacyCancellationPolicy();
  let source: "settings" | "corporate-override" | "legacy-fallback" = params.websiteContent.cancellationPolicy
    ? "settings"
    : "legacy-fallback";

  if (params.corporateCodeData) {
    let hasOverride = false;
    const corp = params.corporateCodeData;
    if (typeof corp.cancellationCutoffHours === "number") {
      cutoffHours = corp.cancellationCutoffHours;
      hasOverride = true;
    }
    if (typeof corp.cancellationRefundPctBefore === "number") {
      refundPctBefore = corp.cancellationRefundPctBefore;
      hasOverride = true;
    }
    if (typeof corp.cancellationRefundPctAfter === "number") {
      refundPctAfter = corp.cancellationRefundPctAfter;
      hasOverride = true;
    }
    if (typeof corp.cancellationPolicyText === "string" && corp.cancellationPolicyText.trim()) {
      policyText = corp.cancellationPolicyText.trim();
      hasOverride = true;
    }
    if (hasOverride) {
      source = "corporate-override";
    }
  }

  return {
    cutoffHours,
    refundPctBefore,
    refundPctAfter,
    policyText,
    scheduledCheckInTime: checkInInstant.toISOString(),
    source
  };
}

// Per CRL-06 (2026-08-02, decisions #171–172):
// the cancellation preview helper. Given the looked-up
// booking + the cancellable-children set + the
// reservation's net-collected total (the caller passes
// the value `getReservationFolioSummary(...).paymentsTotal`,
// sign-aware — refunds are negative), return the
// per-scope `CancellationPreview` shape. The helper is
// pure: no Firestore / no I/O. The handler does the reads
// + the net-collected sum, then hands the precomputed
// values to this function.
//
// Worst-case semantics (per the CRL-06 spec body):
// the aggregate `refundPct` is the MINIMUM per-room
// `refundPct` across the cancellable children — the
// amount the staff can guarantee without an exception.
// A higher per-room refund (e.g. a corporate code that
// overrules the standard policy) is reflected in the
// per-room `refundPct` field so the staff can see the
// upside, but the aggregate is the floor.
//
// `staffProcessingRequired` is true when the policy
// refunds money AND the guest has paid. The destructive
// cancel never auto-refunds per CRL-04 — when both
// conditions are met, the staff must record a refund
// after the cancel commits (CRL-07's admin workflow).
//
// The helper accepts a `null` reservation for the
// legacy per-booking path (pre-MRB-01, no
// `reservationId`); the net-collected total is then
// the looked-up booking's own `paymentsTotal` (the
// caller resolves this from the legacy
// `bookings/{id}/payments` subcollection via the
// existing `getReservationFolioSummary` adapter).

export interface CancelPreviewChild {
  id: string;
  bookingRef: string;
  status: string;
  roomType: string;
  totalPrice: number;
  reservationPosition?: number | null;
  cancellationPolicySnapshot: CancellationPolicySnapshot | null;
}

export interface CancelPreviewInput {
  scope: "room" | "reservation";
  now: Date;
  lookedUpBooking: CancelPreviewChild;
  reservation: {
    id: string;
    reservationRef: string;
    totalPrice: number;
  } | null;
  cancellableChildren: CancelPreviewChild[];
  reservationNetCollected: number;
  /**
   * Subtotal used to allocate a shared reservation folio. For a
   * whole-reservation preview this equals the cancellable subtotal.
   * For a room preview it is the subtotal of every currently
   * cancellable sibling, preventing one room from inheriting the
   * reservation's entire collected balance.
   */
  allocationSubtotal?: number;
}

export function evaluateCancelPreview(input: CancelPreviewInput): {
  kind: "single" | "reservation";
  scope: "room" | "reservation";
  bookingRef: string;
  reservationRef: string | null;
  room: {
    bookingId: string;
    bookingRef: string;
    position: number | null;
    roomType: string;
    status: string;
    subtotal: number;
    netCollected: number;
    policyRefund: number;
    retainedAmount: number;
    refundPct: number;
    isBeforeCutoff: boolean;
    hoursRemaining: number;
  } | null;
  rooms: Array<{
    bookingId: string;
    bookingRef: string;
    position: number | null;
    roomType: string;
    status: string;
    subtotal: number;
    netCollected: number;
    policyRefund: number;
    retainedAmount: number;
    refundPct: number;
    isBeforeCutoff: boolean;
    hoursRemaining: number;
  }> | null;
  subtotal: number;
  netCollected: number;
  policyRefund: number;
  retainedAmount: number;
  staffProcessingRequired: boolean;
  cutoffHours: number;
  cutoffTimeMs: number;
  hoursRemaining: number;
  isBeforeCutoff: boolean;
  refundPct: number;
  policyText: string;
  policySource: "settings" | "corporate-override" | "legacy-fallback";
} {
  // Per-room evaluation. Each cancellable child gets its
  // own `evaluateCancellation(now, snapshot)` so the per-
  // room `refundPct` reflects the per-room snapshot
  // (corporate codes can overrule the standard policy
  // per-room, and that override must surface in the
  // per-room projection). The `reservationPosition` is
  // the 1-indexed position the create handler stamps
  // per MRB-01 — falls back to `null` for legacy null-
  // `reservationId` bookings.
  const evalRoom = (child: CancelPreviewChild) => {
    const evaluation = evaluateCancellation(
      input.now,
      child.cancellationPolicySnapshot,
      // The fallback `fallbackContext` is unused when
      // the snapshot is present; we still pass it for
      // the legacy null-snapshot case so a child without
      // a snapshotted policy (pre-CRL-05) still evaluates
      // against the standard 48h / 100% / 0% rules.
      {
        checkInDateKey: "",
        checkInTime: "14:00",
        timeZone: "Asia/Manila"
      }
    );
    const subtotal = Math.max(Number(child.totalPrice) || 0, 0);
    return {
      child,
      evaluation,
      subtotal
    };
  };

  // For "room" scope the looked-up booking is the only
  // cancellable child. For "reservation" scope the
  // cancellable set is the input's `cancellableChildren`
  // (the handler filtered the children to the cancellable
  // set using the CRL-03 status matrix).
  const children = input.scope === "room"
    ? [input.lookedUpBooking]
    : input.cancellableChildren;
  const roomRows = children.map(evalRoom);

  // Pro-rata net-collected attribution. The reservation
  // folio's `paymentsTotal` (sign-aware — refunds are
  // negative) is the single source of truth; a child's
  // share is its fraction of the cancellable subtotal.
  // For the legacy per-booking path the caller passes the
  // booking's own `paymentsTotal` as
  // `reservationNetCollected` and the attribution is
  // exact (the booking owns the entire ledger).
  const cancellableSubtotal = roomRows.reduce((sum, r) => sum + r.subtotal, 0);
  const allocationSubtotal = Math.max(
    Number(input.allocationSubtotal) || cancellableSubtotal,
    cancellableSubtotal
  );
  const availableNetCollected = Math.max(Number(input.reservationNetCollected) || 0, 0);
  const netCollectedByRoom = roomRows.map((r) => {
    if (allocationSubtotal === 0) return 0;
    return Math.round(
      (r.subtotal / allocationSubtotal) * availableNetCollected * 100
    ) / 100;
  });

  const perRoom = roomRows.map((r, idx) => {
    const netCollected = netCollectedByRoom[idx];
    // A refund can only return money the guest actually paid.
    // Applying the policy percentage to the room subtotal would
    // overstate liability for unpaid and partially-paid bookings.
    const policyRefund = Math.round(netCollected * (r.evaluation.refundPct / 100) * 100) / 100;
    const retainedAmount = Math.round((netCollected - policyRefund) * 100) / 100;
    return {
      bookingId: r.child.id,
      bookingRef: r.child.bookingRef,
      position: r.child.reservationPosition ?? null,
      roomType: r.child.roomType,
      status: r.child.status,
      subtotal: r.subtotal,
      netCollected,
      policyRefund,
      retainedAmount,
      refundPct: r.evaluation.refundPct,
      isBeforeCutoff: r.evaluation.isBeforeCutoff,
      hoursRemaining: r.evaluation.hoursRemaining
    };
  });

  // Aggregate fields. For "room" scope the aggregate
  // is the per-room row; for "reservation" scope it's
  // the sum of the per-room rows. The aggregate
  // `refundPct` is the MINIMUM per-room `refundPct` —
  // the worst-case floor the staff can guarantee
  // without an exception (CRL-07). The aggregate
  // `policyText` + `cutoffHours` + `cutoffTimeMs` come
  // from the looked-up booking's snapshot (the
  // reservation's policy is the same across children
  // because every child snapshots the reservation's
  // policy at create time, and a corporate override
  // is per-reservation, not per-room).
  const aggregateSubtotal = cancellableSubtotal;
  const aggregateNetCollected = Math.round(
    netCollectedByRoom.reduce((sum, n) => sum + n, 0) * 100
  ) / 100;
  const aggregatePolicyRefund = perRoom.reduce((sum, r) => sum + r.policyRefund, 0);
  const aggregateRetained = Math.round((aggregateNetCollected - aggregatePolicyRefund) * 100) / 100;
  const aggregateRefundPct = perRoom.length > 0
    ? Math.min(...perRoom.map((r) => r.refundPct))
    : 0;
  // The first cancellable room's policy metadata is
  // representative — every child snapshots the same
  // reservation-level policy (corporate override or
  // settings snapshot). The per-room `refundPct` may
  // differ across rooms when the standard-vs-corporate
  // split exists, but the cutoff / cutoff time /
  // policy text are the same.
  const representativeEvaluation = roomRows[0]?.evaluation;

  // The destructive cancel never auto-refunds (CRL-04).
  // Staff processing is required when the policy
  // refunds money AND the guest has paid. The aggregate
  // net collected > 0 + aggregate policy refund > 0
  // is the right condition; partial-overlap cases
  // (refund > collected) collapse to "still need a
  // staff action to record what was actually refunded,
  // bounded by the collected amount".
  const staffProcessingRequired = aggregateNetCollected > 0 && aggregatePolicyRefund > 0;

  const isReservation = input.scope === "reservation" && input.reservation !== null;
  return {
    kind: isReservation ? "reservation" : "single",
    scope: input.scope,
    bookingRef: input.lookedUpBooking.bookingRef,
    reservationRef: input.reservation?.reservationRef ?? null,
    room: isReservation ? null : (perRoom[0] ?? null),
    rooms: isReservation ? perRoom : null,
    subtotal: Math.round(aggregateSubtotal * 100) / 100,
    netCollected: aggregateNetCollected,
    policyRefund: Math.round(aggregatePolicyRefund * 100) / 100,
    retainedAmount: aggregateRetained,
    staffProcessingRequired,
    cutoffHours: representativeEvaluation?.refundPct !== undefined
      ? (representativeEvaluation.cutoffTimeMs && input.lookedUpBooking.cancellationPolicySnapshot
          ? input.lookedUpBooking.cancellationPolicySnapshot.cutoffHours
          : 48)
      : 48,
    cutoffTimeMs: representativeEvaluation?.cutoffTimeMs ?? 0,
    hoursRemaining: representativeEvaluation?.hoursRemaining ?? 0,
    isBeforeCutoff: representativeEvaluation?.isBeforeCutoff ?? false,
    refundPct: aggregateRefundPct,
    policyText: input.lookedUpBooking.cancellationPolicySnapshot?.policyText ?? getLegacyCancellationPolicy(),
    policySource: representativeEvaluation?.policySource ?? "legacy-fallback"
  };
}
