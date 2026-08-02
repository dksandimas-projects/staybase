# HISTORICAL ARCHIVE — Backend Schema & API Evolution Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical schema migration notes, implementation narratives for multi-room booking (MRB-01..06), pending booking expiry (PEX), and past audit refactor histories. Do not read routinely for active tasks. For canonical Firestore schemas, see [`plan/docs/BACKEND.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/docs/BACKEND.md).

---

## Historical Implementation Narratives & Migration Logs

### MRB-02 / MRB-02.x Transactional Create & Idempotency
- Single-room transactional create & idempotency (`/api/bookings/create`): wired to `reservations/{id}` header via UUIDv4 `reservationId` + `requestFingerprint` SHA-256. Replay returns 200 with `idempotentReplay: true`. Fingerprint mismatch returns 409 `RESERVATION_ID_FINGERPRINT_CONFLICT`.
- Walk-in transactional create (`/api/bookings/create-walkin`): auto-mints `reservationId` UUIDv4 if omitted. Reads room doc → reservation header → booking doc.
- Reschedule transaction (`/api/bookings/reschedule`): updates reservation header dates, `numNights`, `totalPrice`, and `requestFingerprint` atomically in the same transaction.
- Corporate booking preallocation (`/corporate/book`): preallocates `reservationId` client-side; server fingerprint includes corporate intent flag.

### MRB-06 Auto-Assignment & Multi-Room Booking Loop
- Phase 1 auto-assignment: candidates loop generalized to N>1 in one transaction. Checks `totalExtraBeds = extraBedCount × assignedRooms.length` against EXB-10 inventory.
- Phase 2 N-booking write loop: creates N `bookings/{id}` docs with per-room `roomId`, `roomNumber`, `reservationPosition` (1..N), and `reservationRoomCount` (N).

### MRB-04 Reservation Folio Migration Phases
- Phase 1: `ReservationPayment`, `ReservationCharge`, `ReservationFolioSummary` types and subcollection rules (`reservations/{id}/payments` and `reservations/{id}/charges`).
- Phase 2 / 2.x: `handleAddPayment`, `handleAddRefund`, and `handleVerifyAndRecordPayment` write to `reservations/{id}` subcollections for new reservations, with legacy fallbacks for null-`reservationId` bookings.
- Phase 4 / 5A: Transactional operational folio resolver and admin drawer reservation folio integration.
