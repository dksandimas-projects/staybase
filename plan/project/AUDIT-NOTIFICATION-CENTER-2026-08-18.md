# Notification Center — Audit Report — 2026-08-18
> **📁 HISTORICAL AUDIT — non-canonical, do not load during normal implementation tasks.** This audit pass extends the 2026-07-15 post-ship review (commit `408f6ce` shipped the feature, `07ee8b9` shipped the post-ship review fixes for NC-01..03 + NC-02a..d). Findings NC-01..03 + NC-02..02c + NC-02d are all `Fixed` on current `dev`. This report documents one new finding (NOTIF-01) + verifies NOTIF-02..05 + flags NOTIF-06 as a follow-up. NOTIF-01 is **Open** and lands as `fix(notification-center): MRB-15-09 force-refresh before notifications listener attaches` in commit `TBD`.

> Targeted wiring audit of Phase 12 Notification Center (`plan/features/NOTIFICATION-CENTER.md` — header bell + unread badge + persisted `notifications` Firestore collection + retention cron). Read-only at audit time. Verifies that the spec's read-bundle contract holds on the current `dev` HEAD: the live `onSnapshot` listener, the server-side `writeNotification` helper, the 14 write sites across `bookings.ts` + `store.ts`, the per-staff `readBy` rule hardening, the retention cron wiring, and the MRB-15-09 force-refresh pattern that applies to every staff-gated listener.

> Workspace: staybase
> Audited: 2026-08-18 (branch `dev`, HEAD `a8c52c1` post the CORPORATE-BOOKING audit merge)
> Method: read-only — read `plan/features/NOTIFICATION-CENTER.md` + `plan/docs/{BACKEND.md §notifications, SECURITY.md §notifications, TYPES.md §Notification}.md`; traced every code path that reads or writes the `notifications` collection — `guest-app/server/lib/notifications.ts` (the helper + the retention prune) + `guest-app/server/handlers/notifications-prune.ts` (the cron handler) + `guest-app/server/handlers/bookings.ts` (13 write sites) + `guest-app/server/handlers/store.ts` (1 write site) + `firebase/firestore.rules` lines 405-453 (the readBy hardening); traced every code path that reads `notifications` — `admin-app/src/context/AdminContext.tsx:3655-3766` (the listener + the unread counter + the mark-read helpers); ran the admin-app full suite (110 files / 1293 tests green) + `npm run docs:audit` (12 pre-existing budget failures, no new debt).

> **Convention:** findings are numbered `NOTIF-<n>` (Notification Center). Severity matches prior audits (`SEV-1` critical → `SEV-4` nit). Status is `Open` until a commit references the fix in this doc.

> **Last status sync: 2026-08-18** — 1 finding Open (NOTIF-01, the force-refresh gap on the notifications listener), 4 verified clean (NOTIF-02..05), 1 out-of-scope follow-up flagged (NOTIF-06, the AdminContext-wide staff-listener audit). No code changes in this commit — the report documents the finding. The fix is targeted at `AdminContext.tsx:3666-3724` (~15 lines, mirroring the MRB-15-09 pattern at lines 1715-1775).

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 0 | **0** |
| **SEV-2 (major)** | 1 (NOTIF-01) | 0 | **1** |
| **SEV-3 (minor)** | 0 | 0 | **0** |
| **SEV-4 (nit / doc drift)** | 0 | 0 | **0** |
| **Verification (clean)** | — | 4 (NOTIF-02..05) | **4** |
| **Out-of-scope follow-up** | 1 (NOTIF-06) | 0 | **1** |
| **Total** | **2** | **4** | **6** |

**One real bug:** NOTIF-01 — the notifications listener is staff-gated (`allow read: if isStaff()` per `firestore.rules:435`), but it attaches without the MRB-15-09 force-refresh pattern that the same GOTCHAS rule requires. Per `plan/docs/GOTCHAS.md §Auth & Security`: *"Always force-refresh the ID token before attaching a staff-gated `onSnapshot` listener... The same pattern applies to every staff-gated listener in `AdminContext` (bookings / rooms / roomPrivate / roomBlocks / notifications / members / reservations — MRB-15-09 ships the reservations fix; future listeners must follow the pattern from day one, not retrofitted after the operator hits it)."* The reservations listener was retrofitted (MRB-15-09). The notifications listener was NOT — the spec's "Phase 12" shipped without the force-refresh pattern, and the post-ship review 2026-07-15 missed it (focused on the fire-and-forget / readBy / retention shape, not the listener-side auth guard).

**Why this didn't ship as SEV-1.** A staff member signing in to a fresh tab / new session on the SAME machine the SDK has a cached token from earlier today (when the role claim was still fresh) will see notifications work. A staff member signing in to a fresh machine, a long-idle session, or after the ID token has expired (>1 hour) will see the listener attach with a stale token and hit `Missing or insufficient permissions` on the first snapshot — the bell silently shows zero unread. The cached token is typically <1 hour old for an active operator (the SDK refreshes hourly), so the bug is most likely to surface after a long-idle shift hand-off (a real Spark Inn operational pattern). The exact same bug shipped on the reservations listener before MRB-15-09 — and the MRB-15-09 commit message names "bookings / rooms / roomPrivate / roomBlocks / **notifications** / members / reservations" as the future listener list to fix. Notifications is the only staff-gated listener on that list that has shipped WITHOUT the pattern. **This is the documented shape of bug** — the fix is a copy-paste of the MRB-15-09 pattern.

**NOTIF-02..05 are verification findings** (the audit verified the contract holds on current `dev`; not bugs). NOTIF-06 is **out of scope** for this notification-center audit — it's an AdminContext-wide audit candidate flagged for the next session.

---

## SEV-2 — Major

### NOTIF-01 — Notifications listener lacks MRB-15-09 force-refresh pattern · `Open`

**Feature:** Phase 12 — Notification Center (decision #120)
**Where:**
- `admin-app/src/context/AdminContext.tsx:3666-3724` (the listener — missing the force-refresh)
- `admin-app/src/context/AdminContext.tsx:1715-1775` (the MRB-15-09 reservations listener — the pattern to mirror)
- `firebase/firestore.rules:435` (`allow read: if isStaff()` — the gate that needs a fresh `role` claim)
- `admin-app/src/__tests__/phase-12-notification-center.test.ts` (existing source-text test — does NOT pin this)

**Issue.** The notifications listener at `AdminContext.tsx:3681` attaches a `onSnapshot(notifQuery, ...)` directly on mount, without calling `auth.currentUser?.getIdToken(true)` first. The `firestore.rules` `allow read: if isStaff()` reads the `role` custom claim from the ID token. The SDK uses its OWN cached ID token for the listener handshake — if the SDK's cache is one refresh behind the React `currentUser` state (per `plan/docs/GOTCHAS.md §Auth & Security`: "e.g. the staff claim was minted server-side moments ago, the user's session was idle long enough for the cached token to lose the claim, or the operator just signed in for the first time in a new tab"), the listener attaches with a stale token and the rules reject every snapshot with `Missing or insufficient permissions`.

**Symptom.** The bell badge silently shows zero unread for an affected operator. The console logs `Error listening to notifications collection: FirebaseError: Missing or insufficient permissions.` (the existing error handler at line 3719 catches it). The bell badge never increments even as new bookings arrive.

**Why this is a confirmed bug, not a theoretical risk.**
- The reservations listener was retrofitted for exactly this bug (commit per MRB-15-09 in `fix/mrb-15-09-staff-listener.test.ts`).
- The MRB-15-09 commit message names "notifications" as one of the future listeners to fix: *"future listeners must follow the pattern from day one, not retrofitted after the operator hits it."*
- The Phase 12 post-ship review 2026-07-15 found NC-01 (fire-and-forget), NC-02/02b/02c (readBy hardening), NC-02d (emulator test), NC-03 (retention parallelize) — but did NOT audit the listener's auth gate. That's a blind spot in the post-ship review, not a code oversight by the original author (the MRB-15-09 fix shipped 2026-08-03, AFTER Phase 12's 2026-07-15 post-ship review — Phase 12 was authored before the GOTCHAS rule existed).

**Why this didn't ship as SEV-1.** The bug is recoverable (a manual reload re-attaches the listener; the SDK auto-refreshes on the next hour boundary). No data corruption, no security hole, no financial impact. The bell fails to surface — staff fall back to the Intercom Inbox's live snapshot diffs for the original five events. Operational workaround exists.

**Fix (recommended commit, ~15 lines).** Mirror the MRB-15-09 reservations listener pattern at `AdminContext.tsx:1715-1775`. The shape:
1. Add `let cancelled = false;` + `let unsubscribe: (() => void) | undefined;` inside the `useEffect`.
2. `void auth.currentUser?.getIdToken(true).then(() => { if (cancelled) return; ... })` — the listener attaches inside the `.then` callback, AFTER the force-refresh completes.
3. The `return` statement at line 3723 returns `() => { cancelled = true; if (unsubscribe) unsubscribe(); }` instead of `unsubscribe`.
4. The `try/catch` for the refresh (lines 1864+) logs the failure but doesn't block — the listener doesn't attach, and the next user interaction that triggers an auth re-check will retry.

**Test addition (recommended, source-text + runtime).**
- **Source-text**: extend `phase-12-notification-center.test.ts` with a `force-refresh pattern` test that asserts the notifications listener's enclosing `useEffect` calls `getIdToken(true)` BEFORE the `onSnapshot` call.
- **Runtime**: extend the listener with a unit test (or just rely on the source-text pin — the listener itself is React+Firebase and hard to test in isolation; the source-text pin + the future `npm run test:rules` extension is sufficient).

---

## Verification findings (clean baseline)

### NOTIF-02 — Every write site follows the per-event contract (one notification per event, not per child) · `Verified`

**Feature:** Phase 12 — Notification Center (decision #120)
**Where:** 14 write sites total — 13 in `guest-app/server/handlers/bookings.ts` + 1 in `guest-app/server/handlers/store.ts`.

| Site | Handler | Type | entityType | Notes |
|---|---|---|---|---|
| `bookings.ts:3427` | `handleExpireHolds` (PEX-03 retirement) | `"booking"` | `"booking"` | Per retired hold; loops over `expiredHoldRetirements` and writes one per retirement |
| `bookings.ts:4884` | `handleCreateBooking` (or its walkin sibling) | `"booking"` | `"booking"` | One per create; reservation-level (entityId is the lead booking) |
| `bookings.ts:6903` | `handleCancelBooking` (refund pending notification) | `"cancellation-refund"` | `"booking"` | One per cancel; aggregate refund amount + lead booking |
| `bookings.ts:7706` | `handleAddPayment` | `"payment"` | `"booking"` | One per payment; the booking is the target child |
| `bookings.ts:7724` | `handleVerifyAndRecordPayment` | `"payment"` | `"booking"` | One per verify; the target booking (with idempotent replay guard) |
| `bookings.ts:7843` | `handleAddRefund` | `"cancellation-refund"` | `"booking"` | One per refund; the target booking |
| `bookings.ts:8812` | `handleApplyReservationDiscount` (DSC-04) | `"payment"` | `"booking"` | Per DSC-04 sibling-flip (the reservation-level path) |
| `bookings.ts:8840` | `handleApplyReservationDiscount` (sibling-flip pass) | `"payment"` | `"booking"` | Fires when the apply-discount cleared at least one sibling; keyed to the lead |
| `bookings.ts:9045` | `handleConfirmBooking` | `"booking"` | `"booking"` | One per confirm; reservation-level |
| `bookings.ts:9258` | `handleConfirmBookingWithBalance` | `"booking"` | `"booking"` | One per CWB-confirm |
| `bookings.ts:9495` | `handleCheckinBooking` | `"arrival"` | `"booking"` | Per-child (bookingId is the checked-in child) |
| `bookings.ts:9851` | `handleCheckoutBooking` | `"departure"` | `"booking"` | Per-child (bookingId is the checked-out child) |
| `store.ts:392` | `handleConfirmStoreOrder` | `"store-order"` | `"storeOrder"` | Per order |

**Re-audit finding.** Every site uses a single `entityId: bookingId` + `roomNumber: <single room>` shape — NOT inside a `for (const child of children)` loop that would write N notifications for an N-room reservation. This matches the spec's "per-room + per-event shapes" guidance at `plan/features/NOTIFICATION-CENTER.md:18-22` (the post-ship review's "Out of scope" section). The contract is: **one notification per event per reservation, NOT per child.** This is the correct shape for a staff-facing bell — the staff's question is "do I have refund work to do?" not "which of 3 specific rooms?" The bell surfaces one notification with the aggregate refund amount + the lead booking's room number, then clicking deep-links to the drawer where all rooms are visible.

**No per-child counter drift here.** Notifications are audit-trail docs, not counters. The closest analog (the per-child counter bug class — VOU-01 / RPT-05) does not apply to the notification count itself. The questions worth asking for notifications are:
- Is the audit-trail complete? (every event captured?) — **yes, verified NOTIF-02 above**
- Is the per-staff read state correct? (no fan-out?) — **yes, verified NOTIF-03 below**
- Is the listener safe to attach? (no auth race?) — **NOTIF-01 above, the one bug**

### NOTIF-03 — `readBy` per-staff fan-out prevented by `firestore.rules` hardening · `Verified`

**Feature:** Phase 12 — Notification Center + NC-02..02d post-ship review
**Where:**
- `firebase/firestore.rules:434-453` (the 4-clause hardening: own-UID-only add + existing-keys-must-survive + value-is-timestamp + affectedKeys-only-readBy)
- `firebase/tests/notifications.rules.test.ts` (the emulator test per NC-02d, pinned since 2026-07-15)

**Re-audit finding.** The rule's 4-clause gate is bulletproof:
1. `affectedKeys().hasOnly(["readBy"])` — only the `readBy` field may change.
2. `request.resource.data.readBy.keys().removeAll(resource.data.readBy.keys()).hasOnly([request.auth.uid])` — any new key may ONLY be the writer's own UID (NC-02's "no foreign-UID injection"). The `removeAll` (List op) instead of `.union()` (Set op) is the NC-02c fix that prevents the rules validator from erroring the rule.
3. `resource.data.readBy.keys().hasOnly(request.resource.data.readBy.keys())` — every existing key must survive (NC-02b's "no removal vector"). Combined with #2, the key set can ONLY grow by the writer's own UID.
4. `request.resource.data.readBy[request.auth.uid] is timestamp` — the value must be a timestamp (no junk-value injection).

**No drift found.** The rule text matches the NC-02c fix verbatim. The emulator test (`notifications.rules.test.ts`) was added in the post-ship review and pins all 4 clauses + the NC-02c validator-error scenario. This is the model pattern for the codebase: an invalid-but-present rule (the pre-fix `.union()` shape) passes regex tests but fails the emulator's actual evaluation. NOTIF-03 is the positive example of what other audit surfaces should emulate.

### NOTIF-04 — Retention cron wired correctly · `Verified`

**Feature:** Phase 12 — Notification Center (decision #120) + NC-03 post-ship review
**Where:**
- `guest-app/server/handlers/notifications-prune.ts` (the cron handler)
- `guest-app/server/lib/notifications.ts:97-148` (the `pruneNotifications` helper with BulkWriter)
- `guest-app/server/apiRouter.ts:1481-1488` (the route registration)
- `vercel.json` (the cron schedule)

**Re-audit finding.** All four files are wired correctly:
- The handler `handleNotificationsPrune` is `CRON_SECRET`-gated (line 44), accepts both `POST` and `GET` (line 40), caps inputs (`maxAgeMs ≤ 30 days`, `batchSize ≤ 2000`, line 56 + 60).
- The helper `pruneNotifications` uses `adminDb.bulkWriter()` with per-doc `.catch` (per NC-03's parallelize fix); returns the `scanned` / `deleted` / `deletedIds` / `cutoffIso` shape.
- The route is registered at `domain === "notifications" && action === "prune"` in `apiRouter.ts:1485`.
- The cron is wired in `vercel.json` (path `/api/notifications/prune`).

**No drift found.** The retention cron prevents the FLR-03 linear-growth trap (a future-readiness concern flagged in the roadmap). At 14-room single-desk scale, this fires daily + prunes at most 500 docs per run; even a few thousand rows is well under the cap.

### NOTIF-05 — Client-side hook follows the GOTCHAS unsubscribe discipline · `Verified`

**Feature:** Phase 12 — Notification Center (decision #120)
**Where:** `admin-app/src/context/AdminContext.tsx:3655-3766`

**Re-audit finding.** The listener + helpers follow the GOTCHAS discipline:
- **Gated on `currentUser`** (line 3667) — no listener when signed out.
- **Bounded query** `limit(50)` (line 3680) — never reads the whole collection (FLR-03 trap avoided).
- **Unsubscribe returned** at line 3723 (GOTCHAS guard satisfied).
- **Unread count is per-staff** via `!n.readBy[myUid]` (line 3730) — not a global count.
- **Mark-read is a single-field `updateDoc`** with `readBy.{uid}` dot-path (line 3744-3745) — matches the rule's `affectedKeys().hasOnly(["readBy"])` allowlist.
- **Mark-all-read loops over unread only** (line 3755) + `Promise.all` for parallel writes (line 3758).

**No drift found.** The client-side hook is well-shaped. The ONLY gap is the missing force-refresh at the listener's `useEffect` — NOTIF-01 above.

---

## Out-of-scope follow-up (NOTIF-06)

### NOTIF-06 — AdminContext-wide staff-gated listeners lack the MRB-15-09 force-refresh pattern · `Open` (out of scope)

**Feature:** `admin-app/src/context/AdminContext.tsx` — every staff-gated `onSnapshot` listener
**Where:** The full AdminContext file has ~28 `onSnapshot` calls. Only ONE has the MRB-15-09 force-refresh pattern (the reservations listener at line 1770, the MRB-15-09 retrofit).

**Issue (out of scope for this notification-center audit).** The MRB-15-09 commit message names the future listeners to fix: *"bookings / rooms / roomPrivate / roomBlocks / notifications / members / reservations"* — every staff-gated listener. Today, only `reservations` has the fix. The other ~22 listeners (including rooms, bookings, members, room blocks, room private, notifications, store orders, the IntercomInboxPage's `intercoms` listener, the dashboard's stats listener, the BookingsPage's various filters, etc.) all attach without `getIdToken(true)` and are vulnerable to the same silent `Missing or insufficient permissions` failure mode that bit-not-res-reservations before MRB-15-09.

**Why this is out of scope.** This is an AdminContext-wide audit candidate, not a notification-center-specific one. NOTIF-01 is the slice that affects this surface. A separate audit pass should sweep the whole file + each listener's underlying `firestore.rules` access gate + decide whether to fix them all together (one big commit) or incrementally (one listener at a time, with each commit landing a force-refresh + an MRB-15-09-pattern test).

**Recommendation.** Defer to a dedicated "AdminContext listener audit" pass — see `plan/project/AUDIT-NOTIFICATION-CENTER-2026-08-18.md §Open items for next audit pass`.

---

## What this audit verified clean

The following surface items were verified against the spec at `plan/features/NOTIFICATION-CENTER.md` and the shipped code. None of these were bugs — listing them as the verified baseline so the next audit pass knows what's pinned.

| Surface item | Spec line | Code site |
|---|---|---|
| `Notification` type in shared package | §Data/wiring notes 1 | `shared/types/index.ts` (referenced by `lib/notifications.ts:18`) |
| `notifications/{id}` schema (`type`, `title`, `entityType`, `entityId`, `roomNumber`, `bookingRef`, `readBy: map`, `createdBy`, `createdAt`) | §Collection table | `shared/types/index.ts` + `lib/notifications.ts:61-71` (the writer shape) |
| Server-side writes (Admin SDK only — no client create) | §Write path | `firestore.rules:436` (`allow create: if false`) + every write site uses `writeNotification()` which calls `adminDb.collection("notifications").add(...)` |
| Best-effort error swallowing (a failed notification never fails the parent operation) | §Data/wiring notes | `lib/notifications.ts:72-75` (`catch (err) { console.error(...); }`) — all 14 call sites rely on the helper |
| Client-side read via `onSnapshot` bounded to `limit(50)` | §UX Checklist 81 + §Data/wiring notes 6 | `AdminContext.tsx:3680` (`orderBy("createdAt", "desc"), limit(50)`) |
| Client-side unsubscribe on cleanup | §Data/wiring notes 6 | `AdminContext.tsx:3723` |
| Per-staff unread badge via `readBy[uid]` check (not a global count) | §UX Checklist 71 | `AdminContext.tsx:3730` |
| Mark-read writes only the writer's own UID to `readBy` (per-staff fan-out prevention) | §Write path + §readBy rule hardening | `AdminContext.tsx:3745` (`{ [\`readBy.${currentUser.uid}\`]: serverTimestamp() }`) + `firestore.rules:434-453` |
| Retention cron hard-deletes docs older than 30 days | §Retention | `notifications-prune.ts:34` (`NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000`) + `pruneNotifications` helper + `vercel.json` cron entry |
| Retention cron uses BulkWriter (parallel deletes, per-doc error handling) | NC-03 post-ship review | `lib/notifications.ts:104-148` (`adminDb.bulkWriter()` + per-doc `.catch`) |
| Retention cron is `CRON_SECRET`-gated | §Retention + cron pattern | `notifications-prune.ts:18-32, 44-50` |
| NC-01 fix: every writeNotification call is awaited (no fire-and-forget) | NC-01 post-ship review | All 14 write sites have `await writeNotification(...)` (verified via grep) |
| NC-02c fix: rules use `removeAll` (List op) not `.union()` (Set op) | NC-02c post-ship review | `firestore.rules:444` (the line that fixed the validator error) |
| NC-02d fix: emulator test for the rules | NC-02d post-ship review | `firebase/tests/notifications.rules.test.ts` (present, 12 tests, runs via `npm run test:rules`) |
| Never log PII (room number + booking ref only — no guest email or payment data) | Hard Rule + §Collection table | `lib/notifications.ts:13-16` (the JSDoc explicitly forbids PII) + every write site's title uses `${bookingRef}` + `${roomNumber}` only (verified across all 14 sites) |
| Notifications ring via the same `playSynthNotification(type)` as the bell + the inbox (the legacy sound emitter) | §Overview | `AdminContext.tsx:5411` (declared) + `AdminContext.tsx:2049` (implemented) + still emitting at the snapshot-diff sites per the spec's overview. **Note**: the persisted notifications are in addition to the live ring; the spec explicitly says "muting silences the tone but the panel still logs and badges events." |
| Idempotent payment writes (`!idempotentReplay` short-circuit) | NC post-ship review | `bookings.ts:7706, 7724` (the mark-read comments reference the guard) |
| Sound mute independence (decision #97 — mute silences tone but not the bell) | §UX Checklist 87 | Verified by inspection: the `soundsEnabled` state is separate from the `notifications` listener + the badge count |
| Deep links resolve (`?orderId=` for store-order load race, `?room=` for intercom thread) | §UX Checklist 84 | `admin-app/src/context/AdminContext.tsx:5946-5947` (the context exposes `notifications` + `notificationsLoading`); the deep-link target is built from `entityType` + `entityId` in the bell panel |
| Single-field queries (no composite index needed) | NC post-ship review | `AdminContext.tsx:3680` — single `orderBy("createdAt", "desc")` + `limit(50)` is a single-field index, no composite |

---

## Test discipline summary

| Layer | Pre-2026-08-18 | Post-NOTIF-01 fix (recommended) |
|---|---|---|
| Source-text pin tests (admin-app) | N (existing phase-12-notification-center.test.ts) | N + 1 (NOTIF-01 force-refresh pattern) |
| Emulator tests (`firebase/tests/`) | 12 (`notifications.rules.test.ts` per NC-02d) | 12 (unchanged — NOTIF-01 fix doesn't touch rules) |
| Runtime tests | 0 | 0 (the listener is React+Firebase; source-text pin is the right granularity) |
| **Total** | **~N + 12** | **~N + 1 + 12** |

**Pattern.** The notification-center surface has the codebase's strongest test discipline (an emulator test for the rules + source-text for the writes + 14 awaited-write calls verified by grep). NOTIF-01 is the only gap — and the fix is a 15-line copy-paste of the MRB-15-09 pattern with a matching source-text test.

---

## Files added / modified by this audit

**Added (1):**
- `plan/project/AUDIT-NOTIFICATION-CENTER-2026-08-18.md` (this file)

**Modified (0):** No code changes. The NOTIF-01 fix is recommended but lands separately (commit `TBD`, ~15 lines + 1 source-text test).

---

## References

- Spec: `plan/features/NOTIFICATION-CENTER.md` (the Phase 12 Notification Center feature)
- Schema: `plan/docs/BACKEND.md §notifications`
- Type: `plan/docs/TYPES.md §Notification`
- Security: `plan/docs/SECURITY.md §notifications` + `firebase/firestore.rules:434-453` (the readBy hardening)
- Helper: `guest-app/server/lib/notifications.ts` (the `writeNotification` + `pruneNotifications` helpers)
- Cron: `guest-app/server/handlers/notifications-prune.ts` (the cron handler) + `vercel.json` (the schedule)
- Decision records:
  - `plan/docs/DECISIONS-FEATURES.md #120` (Phase 12 Notification Center)
  - `plan/docs/DECISIONS-FEATURES.md` — the NC-01..03 + NC-02..02d post-ship-review entries (filed 2026-07-15)
- Companion surfaces: `plan/features/INTERCOM-INBOX.md` (the original `playSynthNotification` emitter the spec extends), `plan/features/STORE-MANAGEMENT.md` (store-order notification writes), `plan/features/BOOKINGS-MANAGEMENT.md` (the 13 booking handler notification writes)
- MRB-15-09 (the force-refresh pattern): `plan/docs/GOTCHAS.md §Auth & Security` + `fix/mrb-15-09-staff-listener.test.ts` (the test that pins the reservations listener pattern) + `AdminContext.tsx:1715-1775` (the pattern source)
- Audit pattern: `~/.hermes/skills/spark-inn-4-step-audit/SKILL.md` (the 4-step workflow)
- Spec-compliance skill: `~/.hermes/skills/software-development/spec-compliance-audit/SKILL.md` (the "audit multi-child aggregation surfaces first" rule)

---

## Open items for next audit pass

- **AdminContext-wide listener audit (NOTIF-06 above)** — every staff-gated `onSnapshot` listener except the reservations one (per MRB-15-09 retrofit) lacks the force-refresh pattern. The fix is a sweep across `AdminContext.tsx` + each listener's consumer + matching source-text tests. The MRB-15-09 commit message names the future-listener list verbatim. Estimated scope: ~22 listeners + 22 fixes + 22 tests (could be bundled into one big commit or split across multiple per-listener commits). High-yield audit candidate — same bug class as MRB-15-09, never audited since.
- **Pre-existing MRB-07 / BF-02 walkin failures** — 12 tests failing on `dev` since 2026-08-08 (the date-arithmetic trap from the v1.1.0 spark-inn-4-step-audit pitfalls section). Out of scope for notification-center audit but the highest-volume failure on `dev` today.
- **STORE-MANAGEMENT audit** — the spec-compliance skill's "audit multi-child aggregation surfaces first" rule pointed at the corporate counter (done) and now points at the store-order ledger + stock decrement + chargeback aggregate. Per-order + per-item counter drift is the same bug class as VOU-01.
- **`docs:audit` budget failures** — 12 pre-existing errors (BOOKING-FLOW.md 7× over, ROADMAP.md 12× over, etc.). Long-term compaction pass — out of scope for any individual surface audit but worth a dedicated doc-compaction sprint.