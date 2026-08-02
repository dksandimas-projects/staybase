# HISTORICAL ARCHIVE — Backend Schema & API Evolution Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical schema migration notes, implementation narratives for multi-room booking (MRB-01..06), pending booking expiry (PEX), and past audit refactor histories. Do not read routinely for active tasks. For canonical Firestore schemas, see [`plan/docs/BACKEND.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/docs/BACKEND.md).

---

## Historical Implementation Narratives & Migration Logs

### 1. Multi-Room Bookings (MRB-01..06) Backend Evolution
- **MRB-01 Schema & Header (`reservations/{id}`):** Introduced top-level header collection `reservations/{reservationId}` with public `reservationRef` (`R-YYYYMMDD-NNNNN`), lead guest details, aggregate counters (`roomCount`, `activeRoomCount`, `cancelledRoomCount`, `checkedInRoomCount`, `checkedOutRoomCount`), `paymentStatus`, `holdExpiresAt`, and `requestFingerprint`. Child `bookings/{bookingId}` records carry non-null `reservationId` link.
- **MRB-02 / MRB-02.x Transactional Create & Idempotency:**
  - Single-room transactional create (`/api/bookings/create`): wired to `reservations/{id}` header via UUIDv4 `reservationId` + `requestFingerprint` SHA-256. Replay returns 200 with `idempotentReplay: true`. Fingerprint mismatch returns 409 `RESERVATION_ID_FINGERPRINT_CONFLICT`.
  - Walk-in transactional create (`/api/bookings/create-walkin`): auto-mints `reservationId` UUIDv4 if omitted. Reads room doc → reservation header → booking doc.
  - Reschedule transaction (`/api/bookings/reschedule`): updates reservation header dates, `numNights`, `totalPrice`, and `requestFingerprint` atomically in the same transaction.
  - Corporate booking preallocation (`/corporate/book`): preallocates `reservationId` client-side; server fingerprint includes corporate intent flag.
- **MRB-06 Auto-Assignment & Multi-Room Write Loop:**
  - Candidate loop generalized to N>1 in one transaction. Checks `totalExtraBeds = extraBedCount × assignedRooms.length` against EXB-10 inventory.
  - N-booking write loop: creates N `bookings/{id}` docs with per-room `roomId`, `roomNumber`, `reservationPosition` (1..N), and `reservationRoomCount` (N).
- **MRB-04 Reservation Folio Migration:**
  - `ReservationPayment`, `ReservationCharge`, `ReservationFolioSummary` types and subcollection rules (`reservations/{id}/payments` and `reservations/{id}/charges`).
  - `handleAddPayment`, `handleAddRefund`, and `handleVerifyAndRecordPayment` write to `reservations/{id}` subcollections for new reservations, with legacy fallbacks for null-`reservationId` bookings.
  - Transactional operational folio resolver and admin drawer reservation folio integration.

### 2. Pending Booking Expiry & Hold Window (PEX-01..06)
- **PEX-01 Hold Window Configuration:** Added `paymentHoldWindowHours` (1..72h, default 24h) to `settings/hotelConfig`.
- **PEX-02 / PEX-03 Timestamp Calculation:** `holdExpiresAt` calculated as `createdAt + paymentHoldWindowHours` in server transactions across `/api/bookings/create`, `/api/bookings/create-walkin`, and `/api/bookings/reschedule`.
- **PEX-06 Automated Expiration Cron:** `/api/holds/expire` cron queries `holdExpiresAt <= now` on `pending` bookings, cancelling expired holds and stamping `cancelledBy: "system"` and `cancellationSource: "system"` per CRL-02.

### 3. Retired Schema Fields & Data Model Refactors
- **`paymentReferenceNumber` (Retired 2026-07-24):** Retired top-level string field in favor of per-payment `transactionReference` on `bookings/{id}/payments/{paymentId}` ledger entries (and post-MRB-04 `reservations/{id}/payments/{paymentId}`).
- **`checkedOutWithBalance` / Departure Snapshots (UCO-01..06, 2026-07-16):** Stamped at checkout for unpaid departures alongside `unpaidCheckoutReason`, `unpaidCheckoutApprovedBy`, and departure-time balance snapshots.
- **`confirmedWithBalance` Audit (CWB-01..05, 2026-07-24):** Stamped when confirming pending bookings with an outstanding balance (`confirmedWithBalance`, `confirmedWithBalanceReason`, `confirmedWithBalanceAt`, `confirmedWithBalanceBy`).
