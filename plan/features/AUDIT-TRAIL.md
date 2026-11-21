# Staff Audit Trail (ATR) — Feature Spec

> Requires: `CLAUDE.md`, `plan/docs/BACKEND.md`, `plan/docs/TYPES.md`, `plan/docs/SECURITY.md`, `plan/docs/GOTCHAS.md`, `plan/docs/API-ROUTES.md`, `plan/features/BOOKINGS-MANAGEMENT.md`, `plan/features/ROOM-MANAGEMENT.md`, `plan/features/AUTH-ROLES.md`, `plan/features/SETTINGS.md`

Status: **proposed 2026-11-20** — specced, not implemented. Roadmap block: `plan/project/ROADMAP.md §Staff Audit Trail (ATR)`. Decisions reserved: **#330** (the trail model) + **#331** (retention + read scope). Per `plan/docs/CONTRIBUTING.md §Feature Intake`, the decision entries are written when the implementation lands, not now.

---

## Why

The owner asked, in Bisaya, on 2026-11-20:

> *"naa ba to n features DK nga ma trace kinsa nga staff nag change sa room or other changes.. kinsay nag handle check in and nag walkin book?"*

Three questions: **who changed a room**, **who handled a check-in**, **who created a walk-in booking**. The honest answer today is *no* to all three as a product surface, for three different reasons — and the three reasons are what this block is shaped around.

### What existed when the investigation ran (verified against code 2026-11-20)

| The owner's question | Then | Now |
|---|---|---|
| Who changed a room? | **Nothing.** Zero attribution on `rooms` / `roomPrivate`. | ATR-03. |
| Who handled check-in? | **Written, but invisible and untyped.** `checkedInBy` / `checkedInAt` were stamped and read by no screen. | ATR-04 + ATR-05. |
| Who created the walk-in? | **Recorded at create, then destroyed.** `handledBy` is one mutable field every later action overwrites. | ATR-04. |

### What did exist, scattered

Single-value "last person who did this one thing" stamps, never a history:

- **`bookings/*`** — `handledBy` (overwritten), `checkedInBy`, `checkedOutBy`, `cancelledBy`, `discountVerifiedBy`, `discountRejectedBy`, `paymentRejectedBy`, `louReceivedBy`, `pointsRedeemedBy`, `specialRequestsUpdatedBy`
- **`reservations/*/payments/*`** — `recordedBy`. **The only surface that rendered a staff NAME**: `ReportsPage.tsx:1026` builds a `staffNameMap`, used at `:3810` + `:5654`. This is the shape to copy. (Incidental charges and member points history also had readers, but printed raw UIDs — finding 9.)
- **`bookings/*/breakfastAudit`, `bookings/*/otherAddOnAudit`** — real append-only per-booking trails carrying `actorUid`, server-written. Read at `ReportsPage.tsx:581` + `:604` **only to compute a late-change counter** — the rows were never rendered (finding 8).
- **`roomBlocks/*`, `vouchers/*`, `guests/*`** — `createdBy`
- **`auditLogs/{auditId}`** — the right shape already, with append-only rules. Written from **one** place for **one** action family: add-on catalog CRUD.

**So the foundation was built and unused.** The collection, its rules, and a staff-UID→name resolver already existed. What was missing: writers on the other mutations, attribution on rooms, a non-destructive booking-creator field, and any screen that reads it. ATR-02 closed the first two; ATR-06 owns the last.

---

## Findings the investigation turned up (nobody asked for these)

1. **THE REAL TRAP — a new collection without its rules block loses every write, silently.** `auditLogs` shipped in BR-12.1 with no rule block. The default-deny caught every row, the writer swallows the failure by design (`console.warn`, never roll back the primary write), and so **every `addons.create` / `addons.update` / `addons.delete` row between BR-12.1 and OCT-C3 (2026-10-20) was permanently lost**. Recorded as decision #279. Any new action family, index, or collection in this block ships **in the same commit as its rules**, with a rules test pinning it. A swallowed audit write is the correct failure mode for the primary mutation and the worst possible failure mode for the audit — ATR-01 resolves that tension explicitly (below).
2. **CONFIRMED — a client-written audit row is advisory, not forensic.** Anyone with staff credentials and a browser console can write a direct Firestore mutation and simply not write the audit row, or write a row naming someone else (`actor` is client-supplied). Rules can enforce append-only; they cannot enforce *append*. Client-side rows are not worthless — they catch the ordinary "who moved this?" question — but the trail must be **labelled with its own trust level** (`source: "client" | "server"`) so a reader does not treat them as evidence they are not. Server rows are the forensic ones: the client never supplies the actor.
3. **CONFIRMED — `auditLogs` reads are admin-only** (`firestore.rules:133`), so Front Desk cannot read the trail at all. The owner's question is partly a *front-desk* question ("who checked this guest in?" gets asked at the desk, by the desk). Inline attribution therefore must **not** come from `auditLogs` — it comes from denormalized fields on the record itself, which Front Desk can already read. The global log stays admin-only. This split is a feature, not a workaround: the desk sees the current record's provenance, the admin sees everyone's history.
4. **⚠ PII — a naive `before`/`after` snapshot copies guest personal data into a second collection with different retention.** A booking diff would carry `guestName`, `guestEmail`, `guestPhone`, `guestRegistration`, `guestIdPhotoUrl` and `paymentProofUrl` into `auditLogs`. `plan/docs/GOTCHAS.md §Security & PII` forbids exposing payment-proof URLs outside admin surfaces and forbids logging PII; `plan/docs/SECURITY.md` carries the RA 10173 data-minimisation posture. The audit row records **what changed**, not **what it changed to**, for any field on the redaction list.
5. **ADJACENT FINDING — `handledBy` is load-bearing and misnamed.** Three server handlers and one client path write it as "the staff member who last touched this booking", while the walk-in modal writes it as "the staff member who created this booking". Renaming it is a cross-surface refactor with no behavioural payoff; the fix is to add the field that was missing (`createdBy`, stamped once) and document `handledBy` as last-touch in `TYPES.md`.
6. **ADJACENT FINDING — ✅ RESOLVED (first slice).** `BACKEND.md` was compacted first (finding 6 was a budget blocker), then the `checkedInAt` / `checkedInBy` schema rows shipped.
7. **⚠ CONFIRMED — ✅ RESOLVED (first slice) — three attribution fields were client-writable with NO `request.auth.uid` constraint, and one of them gated a money decision.** The `bookings` update rule's `affectedKeys().hasOnly([...])` allowlist let a staff client write **`discountVerifiedBy`**, **`specialRequestsUpdatedBy`** and **`handledBy`** with no rule tying any of them to the caller's own UID — so a Front Desk user with a browser console could approve a 20% senior/PWD discount and stamp **another staff member's UID** as the approver. The `charges` block in the same file already enforced `addedBy == request.auth.uid`; ATR-07 now applies the same pattern to the three fields, with emulator cases denying a write that claims another staff member's UID.
8. **CONFIRMED — ✅ PARTIALLY RESOLVED (booking drawer, 2026-11-21) — the add-on trails had no row-level reader, and the rules promised a Settings audit view that was never built.** `ReportsPage.tsx:581` + `:604` subscribe to `breakfastAudit` / `otherAddOnAudit` only to increment a counter on `occurredAfterCutoff === true` — **one integer**. And the `firestore.rules` comment on the ETR access audit claims it is *"read by Admin (for the audit-log view in Settings)"*, while a repo-wide grep returns **zero** reads of `refresh-access-audit` — the same comment drift as the `auditLogs` claim corrected on 2026-10-20. **Consequence:** decision 6 + ATR-06 are amended below.
9. **CONFIRMED — ✅ RESOLVED (first slice) — three of the four existing attribution surfaces printed raw UIDs.** `staffNameMap` (`ReportsPage.tsx:1026`) resolved a UID to a display name in exactly **one** place: the payments/refunds tables. Raw 28-character UIDs appeared in incidental charges (+ both CSV exports), member points history and the drawer's discount block (falling back to the literal `"Staff"`). ATR-05 lifted the resolver into `shared/utils/staffNames.ts` and retrofitted every surface onto it.

---

## Decisions

Decided from code and convention; no owner input needed unless marked. Numbers reserved: #330 (1–6), #331 (7–8).

1. **One top-level append-only collection, `auditLogs/{auditId}`** — extend what exists rather than add a parallel surface. It already has the right shape, correct append-only rules, and admin-only reads.
2. **The row records changed field *names*, plus values only for non-PII fields.** No full-document snapshots. A shared redaction list is the single source of truth for which fields are name-only (§Data shape).
3. **Two writers, both labelled.** Server (Admin SDK, inside the existing transaction where one exists) for every mutation already behind an authenticated API route — these carry `source: "server"` and a server-derived actor the client cannot forge. Client (admin app) for mutations that are still direct Firestore writes — `source: "client"`. **The audit write never rolls back the primary mutation** (the existing `SettingsPage.tsx` posture is right), but a *server-side* audit write inside a transaction commits atomically with the mutation, so the forensic rows cannot be silently lost the way the BR-12.1 rows were.
4. **Inline attribution is denormalized onto the record; history lives in `auditLogs`.** The booking drawer and the room modal read `*By` / `*ByName` fields on the record itself — Front-Desk-readable, one read, no extra query. The full history is an admin-only page. Two surfaces, two audiences, one write path.
5. **Staff display names are resolved once and cached**, reusing the `staffNameMap` pattern already in `ReportsPage.tsx:1026`. Rows also store `actorName` at write time so a deleted or renamed staff account does not blank out history retroactively — the name in the row is the name as it was.
6. **The existing per-booking `breakfastAudit` / `otherAddOnAudit` subcollections stay where they are.** They are server-written and correct. Migrating them into `auditLogs` is churn with no new capability. **Amended 2026-11-20 (finding 8):** they fed only a late-change *counter* — ATR-06 must render their rows in the per-record history. **Updated 2026-11-21:** the drawer's History tab is that reader.
7. **Retention: 12 months**, pruned by a new `/api/janitor/audit-prune` cron inside the existing catch-all — the same shape as `/api/notifications/prune` (`API-ROUTES.md:286`). **Audit rows are explicitly NOT on the notifications' 30-day schedule** — 30 days cannot answer "who checked this guest in last season". *Owner decision — see CVQ.*
8. **Reads stay admin-only; no backfill.** Rows begin at ship date. Historical attribution that exists in the scattered `*By` fields is surfaced inline (decision 4) and so is not lost; it simply has no history rows behind it. *Owner decision — see CVQ.*

### Rejected alternatives

- **Per-record `bookings/{id}/history` subcollections only** — cannot answer "what did staff X do today" without a `collectionGroup` scan across every record, and gives rooms, settings and rates no uniform home. The per-booking add-on trails already prove the pattern's ceiling: they exist, they work, and they are read by exactly one metric — a per-record trail is invisible from anywhere else.
- **Firestore triggers / Cloud Functions to capture diffs automatically** — forbidden by `CLAUDE.md §Hard Rules`. Would also have been the only approach that cannot be skipped by a direct client write, which is worth recording as the real cost of that rule.
- **Full `before` / `after` document snapshots** — PII (finding 4) and unbounded row size. A booking document with its selection maps is large; two copies per edit, forever, is the FLR-03 linear-growth trap with a compliance surface attached.
- **Reusing `notifications`** — 30-day retention, a `readBy` mutation surface, and a deliberately bounded 50-row query. It is a read-state surface, not an immutable record.
- **A new Vercel function per audit route** — the Hobby plan caps the deployment at 12 functions (`plan/docs/VERCEL-FUNCTION-LIMIT.md`). Everything dispatches through the existing `api/[...route].js` catch-all. **This block adds zero functions.**

---

## Data shape

### `auditLogs/{auditId}` — extended

Existing fields are unchanged; new fields are additive, so the BR-12.1 `addons.*` rows written after OCT-C3 stay readable.

| Field | Type | Notes |
|---|---|---|
| `action` | string | `"<domain>.<verb>"` from the closed vocabulary below. Validated by a shared Zod schema. |
| `targetCollection` | string | `"bookings"` \| `"rooms"` \| `"roomPrivate"` \| `"addOns"` \| `"settings"` \| `"rates"` \| `"vouchers"` \| `"guests"` |
| `targetId` | string | Document id |
| `targetLabel` | string | **New.** Human-readable: `"SI-20260601-001"`, `"Room 202 — Executive"`. Denormalized so the log renders without N lookups. Never contains guest PII. |
| `changedFields` | string[] | **New.** Field names that changed. The only record of a redacted field's change. |
| `before` / `after` | map \| null | Non-redacted changed fields only (see redaction list). `null` for creates / deletes respectively. |
| `actor` | string | Staff Firebase Auth UID. Server rows derive it from the verified token; client rows supply it (see finding 2). |
| `actorName` | string | Display name at write time (decision 5). |
| `actorRole` | string | **New.** `"admin"` \| `"front-desk"` — the role as it was, since roles change. |
| `source` | string | **New.** `"server"` (Admin SDK, forensic) \| `"client"` (admin app, advisory). |
| `reason` | string \| null | **New.** Optional free text where the UI already collects one (room reassignment reason, cancellation reason, block reason). |
| `timestamp` | timestamp | `serverTimestamp()`. |

### Redaction list

Lives in `shared/` as the single source of truth, imported by both writers. A field on this list is recorded in `changedFields` and **never** copied into `before` / `after`:

`guestName` · `guestEmail` · `guestPhone` · `guestRegistration` · `guestIdPhotoUrl` · `paymentProofUrl` · `paymentProofPath` · `discountIdPhotoUrl` · `discountIdPhotoPath` · `lookupToken` · `qrToken` · `remarks` · any `members/*` personal field · the booking documents' OWN guest-identity names — `leadGuestName` · `leadGuestEmail` · `leadGuestPhone` · `leadGuestDetails` · `guestDetails` (added by ATR-02)

Rationale: `GOTCHAS.md §Security & PII` (never log PII, never expose payment-proof URLs outside admin) + `SECURITY.md` RA 10173 data minimisation. `remarks` is on the list because `GOTCHAS.md` already forbids it reaching guest surfaces and it is free staff prose that may quote a guest. The `leadGuest*` names are on it because the documents carry the guest's identity under THOSE names — a whole-document snapshot would otherwise copy the guest's personal data into `auditLogs`.

### Action vocabulary (closed set, Zod-validated)

```
bookings.create-walkin   bookings.checkin        bookings.checkout
bookings.confirm         bookings.cancel         bookings.reschedule
bookings.room-reassign   bookings.payment-add    bookings.payment-verify
bookings.payment-reject  bookings.refund         bookings.discount-verify
bookings.discount-reject bookings.update
rooms.create             rooms.update            rooms.delete
rooms.status-change      rooms.housekeeping      rooms.block
addons.create            addons.update           addons.delete
settings.update          rates.update            vouchers.create
vouchers.update          staff.create            staff.disable
```

A closed set keeps the log filterable and makes an unknown action a test failure rather than a silently-dropped row — the `NBS-08` failure mode ("Reports silently drops unknown sources — no error, no warning") applied to the audit log.

### Denormalized inline attribution

New fields on the records themselves, for the Front-Desk-readable inline surface (decision 4).

**`rooms/{roomId}`** — the owner's first question, and today's total blank:

| Field | Type |
|---|---|
| `updatedBy` / `updatedByName` | string \| null |
| `statusChangedAt` / `statusChangedBy` / `statusChangedByName` | timestamp / string \| null |
| `housekeepingUpdatedAt` / `housekeepingUpdatedBy` / `housekeepingUpdatedByName` | timestamp / string \| null |
| `createdBy` / `createdByName` | string \| null |

Housekeeping gets its own triple because it is the highest-frequency room write (a tap per room per day) and would otherwise bury every other room change under itself in `updatedBy`.

**`bookings/{bookingId}`**:

| Field | Type | Notes |
|---|---|---|
| `createdBy` / `createdByName` | string \| null | **Stamped once at create, never overwritten.** This is what answers *"kinsay nag walkin book?"*. `"guest"` for public online bookings, the staff UID for walk-ins and staff-created bookings. |
| `checkedInByName` | string \| null | Companion to the **already-written** `checkedInBy` (finding: it exists in production and is in no type or MD). |
| `checkedOutByName` | string \| null | Companion to the existing `checkedOutBy`. |
| `paymentConfirmedBy` / `paymentConfirmedByName` | string \| null | **ATR-09.** The payment VERIFIER's stamp, written in the same write as `paymentConfirmedAt` and never overwritten — `handledBy` is last-touch, so it cannot answer "who verified?". |

`handledBy` keeps its current behaviour and is documented in `TYPES.md` as **last staff to touch this booking** (finding 5). No rename.

### Rules, indexes, retention

- **Rules** — `firestore.rules §auditLogs` stays `read: isAdmin()`, `create: isStaff()`, `update, delete: false`. Add field validation on create: `action` in the closed set, `actor == request.auth.uid` (a client row cannot name someone else), `timestamp == request.time`. Ship **in the same commit** as the writers (finding 1), with a `firestore-rules-coverage` case per new action family.
- **Indexes** — the admin page filters by actor, action, target and date. Composite indexes in `firebase/firestore.indexes.json`: `(actor, timestamp desc)`, `(targetCollection, targetId, timestamp desc)`, `(action, timestamp desc)`. A missing composite index throws `FAILED_PRECONDITION` and takes the whole page down — the `bookingHolds` sweep lesson in `API-ROUTES.md:182`.
- **Retention** — `/api/janitor/audit-prune`, `CRON_SECRET`-authed, hard-deletes rows older than 12 months, scheduled in `guest-app/vercel.json §crons` (the single authoritative cron list). Inside the existing catch-all: **no new Vercel function**.
- **Query bound** — the admin page queries `orderBy("timestamp","desc").limit(50)` with a `startAfter` cursor, per the FLR-03 pagination pattern. Never an unbounded collection read.

---

## Surfaces

### Inline (Front Desk + Admin) — the question asked at the desk

- **Booking drawer** — a quiet provenance line under the status block: *"Created by Maria (walk-in) · Checked in by Jun · Checked out by Maria"*, names resolved via `staffNameMap`, omitted where the field is absent (legacy bookings).
- **Room edit modal** (`ROOM-MANAGEMENT.md`) — *"Last changed by Jun, 2:14 PM"*; the block-reason row shows who set it.
- **Dashboard room grid** (`DASHBOARD-OVERVIEW.md`) — the housekeeping chip's tooltip / long-press shows who last toggled it and when. Mobile needs a tap target, not a hover (`ADMIN-MOBILE.md`).

### Audit Log page (Admin only) — the question asked by the owner

`/audit`, admin-only via the existing route guard (`AUTH-ROLES.md`), in the Settings sidebar group.

- Reverse-chronological rows: **when · who (name + role) · what (action label) · which record (`targetLabel`, deep-linked) · what changed (`changedFields`, expandable to `before`/`after` where present) · source badge** (server = forensic, client = advisory).
- Filters: staff member, action family, target collection, date range. Default view = today.
- CSV export, reusing the Reports export helper.
- Mobile: card list, not a table (`ADMIN-MOBILE.md §Mobile UX building blocks` — `DataTable` collapses below 768px).
- Renders the per-booking `breakfastAudit` / `otherAddOnAudit` rows in the target's history rather than duplicating the data into `auditLogs` (decision 6 as amended). **The booking drawer's History tab is that reader since 2026-11-21**; the `/audit` page still has to build its own (ATR-06).

---

## Client Validation Queue (ATR)

Nothing here hard-blocks: every row has a working default, so implementation can proceed and the answers only change config.

| # | Question | Working default | Affected | Why it matters |
|---|---|---|---|---|
| CVQ-ATR-01 | How long should audit rows be kept? | **12 months** | ATR-07 | Retention is a compliance posture (RA 10173 data minimisation) as much as a storage question. 30 days is useless for the owner's question; "forever" is the FLR-03 linear-growth trap plus an ever-growing PII-adjacent store. **This is the only row that changes engineering cost** — "forever" means no cron, "per-year archive export" means a new export path. Ask this one first. |
| CVQ-ATR-02 | Should Front Desk read the full audit log, or only the inline attribution? | **Inline only; full log admin-only** | ATR-05, ATR-06 | Matches today's rules. Staff knowing they are logged is a deterrent; staff reading each other's full history is a workplace-dynamics call that belongs to the owner, not to us. |
| CVQ-ATR-03 | Should the log record *reads* of sensitive records (who viewed a guest's ID photo), or only writes? | **Writes only** | ATR-02 | Read logging is the stronger RA 10173 posture and roughly doubles the write volume. Deferrable without rework — the row shape already supports it. |
| CVQ-ATR-04 | Does a room reassignment or cancellation need a **mandatory** reason, now that it is permanently attributed? | **Keep current behaviour** (cancellation reason already required; room reassignment reason optional) | ATR-03, ATR-05 | `reason` is already collected on both surfaces (`RoomAssignmentSection.tsx`). Making it mandatory is a one-line validation change but adds desk friction on a hot path. |

---

## Build checklist

Items are tracked in `plan/project/ROADMAP.md §Staff Audit Trail (ATR)`; this file owns the contract.

- ✅ **ATR-01** — **SHIPPED (first slice).** `shared/schemas/audit.ts`: the `AuditLogEntry` type, the Zod schema, the closed action vocabulary, the PII redaction list, and the `buildAuditEntry()` pure helper. One source of truth for both writers. The shared staff resolver (`shared/utils/staffNames.ts`) sits beside it.
- ✅ **ATR-02** — **SHIPPED (2026-11-21).** Server-side writers on every authenticated staff mutation, inside the existing transaction where there is one (check-in, checkout, confirm, cancel, reschedule, room reassign, payment add/verify/reject, refund, discount verify/reject, walk-in create). `source: "server"`. The guest-cancel path records no row — it is not a staff mutation.
- ✅ **ATR-03** — **SHIPPED (first slice).** The denormalized `rooms` fields above + the `rooms.*` audit rows from `AdminContext` (`toggleHousekeepingStatus`, `updateRoomConfig`, `createRoom`, `addRoomBlock`, delete cascade) and the `roomPrivate` block-reason writes. The owner's first question.
- ✅ **ATR-04** — **SHIPPED (first slice).** `createdBy` / `createdByName` stamped once at every create path; `checkedInByName` / `checkedOutByName`; `checkedInBy` + `checkedInAt` added to `shared/types` and `BACKEND.md`; `handledBy` documented as last-touch. (`BACKEND.md` was compacted toward 10,000 first — finding 6.)
- ✅ **ATR-05** — **SHIPPED (first slice).** Inline surfaces: the booking drawer provenance line, the room modal note, the dashboard housekeeping chip. Front-Desk-readable, no `auditLogs` read. Every UID resolves through the SHARED resolver (`shared/utils/staffNames.ts`, lifted out of `ReportsPage` — finding 9), and the three raw-UID surfaces (charges + both exports, points history, the discount block) are retrofitted onto it.
- ⬜ **ATR-06** — Admin-only `/audit` page: filters, pagination, CSV export, mobile card list, deep links.
- 🟡 **ATR-07** — **RULES HALF SHIPPED (first slice):** the `auditLogs` create-time field validation, the three composite indexes, and the three-field `request.auth.uid` constraint on the `bookings` update rule — `discountVerifiedBy` / `specialRequestsUpdatedBy` / `handledBy` (finding 7), copying the constraint the `charges` block in the same file already uses, with emulator cases denying a write that claims another staff member's UID. ⬜ **STILL OPEN:** `/api/janitor/audit-prune` + the `vercel.json §crons` entry (retention — CVQ-ATR-01).
- 🟡 **ATR-08** — **Tests + MD sync ride with each item.** ✅ for this slice: shared (schema, redaction, action vocabulary), admin (inline surfaces render + omit cleanly on legacy records; the staffNameMap retrofit), guest-api (the ATR-02 writer-per-action-family tests), rules (`firebase/tests/atr-audit-trail-rules.emulator.test.ts` — append-only, actor spoofing, unknown action, Front Desk read, and a write claiming another staff UID all denied). ⬜ still open with ATR-06: the `/audit` page's query + pagination, and the retention MDs (`API-ROUTES.md`, `SECURITY.md`, `WHITE-LABEL.md`).
- ✅ **ATR-09** — **SHIPPED (2026-11-21).** Every milestone on the drawer timeline names its actor. The "Payment verified" row resolves `paymentConfirmedBy` (the verifier, above); the "Booking created" row resolves `createdBy` (the creator); a record written before either stamp existed falls back to `handledBy` — documented, not silent. The desk no longer sees a bare "Staff".
- ✅ **ATR-10** — **SHIPPED (2026-11-21).** The ROOM CHANGE now appears in the drawer's history (the write was always there; the READ was lossy). Decision **#333**.

### Suggested sequencing

ATR-01 → ATR-03 + ATR-04 → ATR-05 (the first slice — **shipped**) → ATR-02 (the forensic writers, the largest item) → ATR-07 (rules half shipped) → ATR-06 (the page is worth least until there are rows in it) → ATR-08 rides with each item.

### Second-slice notes (2026-11-21)

ATR-02 shipped the writers (`guest-app/server/lib/audit-writer.ts`). The contract points it added:

- **Rows are BUILT inside the transaction, after every read** — `before` / `after` carry the real values; Firestore requires reads before writes (FOL-03). A commit-time failure fails the transaction: the booking and its record should agree.
- **Free text is recorded BY NAME ONLY** — `specialRequests` / `notes` name, no value; operational prose (a cancellation / refund / room-reassignment reason) rides `reason`.
- **Reservation-scope facts are recorded per child booking** — `AUDIT_TARGET_COLLECTIONS` has no `reservations` entry, so a reservation-scope cancel writes one row per child.
- **A milestone with no actor renders a bare "Staff"** (ATR-09) — the desk reported it. The actor resolution lives in `shared/utils/bookingHistory.ts`: `paymentConfirmedBy` names the verifier, `createdBy` the creator, `handledBy` the documented fallback for a pre-stamp record.

The slice's other decisions are in `plan/project/ROADMAP.md §Staff Audit Trail (ATR)`.

### First-slice notes (2026-11-20)

The first slice shipped ATR-01 + ATR-03 + ATR-04 + ATR-05 + the ATR-07 rules half. Five things it decided:

- **`reason` is the channel for operational prose; the redaction list governs snapshots.** The row's `reason` carries the free text the UI already collects (the room block reason) — `blockReason` is therefore NOT on the list.
- **ONE resolver.** The `staffNameMap` was lifted out of `ReportsPage` into `shared/utils/staffNames.ts`; every surface routes through it. A second resolver is how the three surfaces drifted in the first place.
- **`rooms` is PUBLICLY READABLE.** The ATR-03 attribution fields live on the `rooms` document, so the staff display names on them are publicly visible. `rooms` carries no guest PII, and `roomPrivate` stays staff-only.
- **The `auditLogs` create rule requires `source` + `changedFields`.** The source says how far to trust a row; `changedFields` is the only record that a redacted field changed at all.
- **The per-booking trails finally have a reader (2026-11-21).** The drawer's History tab merges `breakfastAudit` + `otherAddOnAudit` + the charge ledger + the milestone stamps into one timeline — finding 8 was a READER gap, not a data gap.
