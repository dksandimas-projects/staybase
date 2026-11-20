# Staff Audit Trail (ATR) — Feature Spec

> Requires: `CLAUDE.md`, `plan/docs/BACKEND.md`, `plan/docs/TYPES.md`, `plan/docs/SECURITY.md`, `plan/docs/GOTCHAS.md`, `plan/docs/API-ROUTES.md`, `plan/features/BOOKINGS-MANAGEMENT.md`, `plan/features/ROOM-MANAGEMENT.md`, `plan/features/AUTH-ROLES.md`, `plan/features/SETTINGS.md`

Status: **proposed 2026-11-20** — specced, not implemented. Roadmap block: `plan/project/ROADMAP.md §Staff Audit Trail (ATR)`. Decisions reserved: **#330** (the trail model) + **#331** (retention + read scope). Per `plan/docs/CONTRIBUTING.md §Feature Intake`, the decision entries are written when the implementation lands, not now.

---

## Why

The owner asked, in Bisaya, on 2026-11-20:

> *"naa ba to n features DK nga ma trace kinsa nga staff nag change sa room or other changes.. kinsay nag handle check in and nag walkin book?"*

Three questions: **who changed a room**, **who handled a check-in**, **who created a walk-in booking**. The honest answer today is *no* to all three as a product surface, for three different reasons — and the three reasons are what this block is shaped around.

### What exists today (verified against code 2026-11-20, not against MDs)

| The owner's question | Today | Evidence |
|---|---|---|
| Who changed a room? | **Nothing.** Zero attribution on `rooms` or `roomPrivate`. | `admin-app/src/context/AdminContext.tsx:1625` (`toggleHousekeepingStatus`), `:1653` (`updateRoomConfig`), `:1706` (`createRoom`) all write `updatedAt: serverTimestamp()` and no actor field. `plan/docs/BACKEND.md §rooms` confirms the schema carries only `createdAt` / `updatedAt`. |
| Who handled check-in? | **Written, but invisible and untyped.** | The server stamps `checkedInBy` + `checkedInAt` at `guest-app/server/handlers/bookings.ts:11927` + `:12042`. The field is **not** in `shared/types/index.ts`, **not** in `BACKEND.md §bookings`, and read by **no** screen. A repo-wide grep returns exactly three hits — two in the writer, one in a test-run field list. The data is in Firestore and nobody can see it. |
| Who created the walk-in? | **Recorded at create, then destroyed.** | The walk-in modal stamps `handledBy: currentUser?.uid` (`admin-app/src/pages/BookingsPage.tsx:5050`), but `handledBy` is a single mutable field that every later staff action overwrites — `AdminContext.tsx:3414` plus the confirm / verify-payment / add-payment server handlers (`guest-app/server/handlers/bookings.ts:6300`, and the `bookingUpdates.handledBy = staffUid` pattern in the payment-verify path). One confirm and the walk-in creator is gone. |

### What does exist, scattered

Single-value "last person who did this one thing" stamps, never a history:

- **`bookings/*`** — `handledBy` (overwritten), `checkedInBy`, `checkedOutBy`, `cancelledBy`, `discountVerifiedBy`, `discountRejectedBy`, `paymentRejectedBy`, `louReceivedBy`, `pointsRedeemedBy`, `specialRequestsUpdatedBy`
- **`reservations/*/payments/*`** — `recordedBy`. **The only trail with a UI**: `admin-app/src/pages/ReportsPage.tsx:1026` builds a `staffNameMap` and renders real staff names at `:3810` + `:5654`. This is the shape to copy.
- **`bookings/*/breakfastAudit`, `bookings/*/otherAddOnAudit`** — real append-only per-booking trails carrying `actorUid`, server-written. Read by exactly one Reports metric (`ReportsPage.tsx:520`).
- **`roomBlocks/*`, `vouchers/*`, `guests/*`** — `createdBy`
- **`auditLogs/{auditId}`** — the right shape already (`action`, `targetCollection`, `targetId`, `actor`, `actorName`, `before`, `after`, `timestamp`), with append-only rules at `firebase/firestore.rules:132`. Written from **one** place for **one** action family: add-on catalog CRUD at `admin-app/src/pages/SettingsPage.tsx:3172`. The code comment at `:3159` states the position plainly — *"`auditLogs` is a write-only trail as far as the product is concerned: the rows are written (and are admin-readable per the rules), but no screen reads them."*

**So the foundation is built and unused.** The collection exists, its rules are correct, and a staff-UID→name resolver already ships in Reports. What is missing is writers on the other mutations, attribution on rooms at all, a non-destructive booking-creator field, and any screen that reads it.

---

## Findings the investigation turned up (nobody asked for these)

Labelled per `CONTRIBUTING.md §Rules that earned their place` — these are the items most likely to be dropped.

1. **THE REAL TRAP — a new collection without its rules block loses every write, silently.** `auditLogs` shipped in BR-12.1 with no rule block. The default-deny caught every row, the writer swallows the failure by design (`console.warn`, never roll back the primary write — `SettingsPage.tsx:3182`), and so **every `addons.create` / `addons.update` / `addons.delete` row between BR-12.1 and OCT-C3 (2026-10-20) was permanently lost**. Recorded as decision #279 and in the rule comment at `firestore.rules:124`. Any new action family, index, or collection in this block ships **in the same commit as its rules**, with a `firestore-rules-coverage` test pinning it. A swallowed audit write is the correct failure mode for the primary mutation and the worst possible failure mode for the audit — ATR-01 resolves that tension explicitly (below).
2. **CONFIRMED — a client-written audit row is advisory, not forensic.** Anyone with staff credentials and a browser console can write a direct Firestore mutation and simply not write the audit row, or write a row naming someone else (`actor` is client-supplied). Rules can enforce append-only; they cannot enforce *append*. This does not make client-side rows worthless — they catch the ordinary "who moved this?" question, which is the owner's actual need — but the trail must be **labelled with its own trust level** (`source: "client" | "server"`) so a future reader does not treat it as evidence it isn't. Server-written rows are the forensic ones because the client never supplies the actor.
3. **CONFIRMED — `auditLogs` reads are admin-only** (`firestore.rules:133`), so Front Desk cannot read the trail at all. The owner's question is partly a *front-desk* question ("who checked this guest in?" gets asked at the desk, by the desk). Inline attribution therefore must **not** come from `auditLogs` — it comes from denormalized fields on the record itself, which Front Desk can already read. The global log stays admin-only. This split is a feature, not a workaround: the desk sees the current record's provenance, the admin sees everyone's history.
4. **⚠ PII — a naive `before`/`after` snapshot copies guest personal data into a second collection with different retention.** A booking diff would carry `guestName`, `guestEmail`, `guestPhone`, `guestRegistration`, `guestIdPhotoUrl` and `paymentProofUrl` into `auditLogs`. `plan/docs/GOTCHAS.md §Security & PII` forbids exposing payment-proof URLs outside admin surfaces and forbids logging PII; `plan/docs/SECURITY.md` carries the RA 10173 data-minimisation posture. The audit row records **what changed**, not **what it changed to**, for any field on the redaction list. See §Data shape.
5. **ADJACENT FINDING — `handledBy` is load-bearing and misnamed.** Three server handlers and one client path write it as "the staff member who last touched this booking", while the walk-in modal writes it as "the staff member who created this booking". Both readings are live in the same field. Renaming it is a cross-surface refactor with no behavioural payoff; the fix is to add the field that was actually missing (`createdBy`, stamped once) and document `handledBy` as last-touch in `TYPES.md` so the next reader stops guessing.
6. **ADJACENT FINDING — `BACKEND.md` has no budget headroom, so the `checkedInBy` drift fix could not ship with this spec.** `plan/docs/BACKEND.md` sits at ~12,483 est. tokens against its 12,500 ratchet ceiling (`CONTRIBUTING.md §Documentation Budgets`) — **67 characters of room.** Adding the `checkedInAt` / `checkedInBy` schema row plus an `auditLogs` scope pointer put `npm run docs:audit` over the ceiling, so both were reverted and the schema sync rides with **ATR-04** instead (where `CONTRIBUTING.md §Feature Intake` says it belongs anyway — docs change when the implementation lands). Whoever picks up ATR-04 must compact `BACKEND.md` toward 10,000 first, per the ratchet note. Until then the production `checkedInBy` / `checkedInAt` fields are documented **here** and nowhere else.
7. **ADJACENT FINDING — decisions #328 + #329 are cited in `ROADMAP.md:934-935` but have no entries in `DECISIONS-FEATURES.md`.** Unrelated to this block, flagged because it is the same class of drift `CONTRIBUTING.md §Feature Intake` step 2 exists to catch (`FIN-06`, 2026-07-31: closed as "decision logged", calculation never followed). Not fixed here — a `docs/` branch of its own.

---

## Decisions

Decided from code and convention; no owner input needed unless marked. Numbers reserved: #330 (1–6), #331 (7–8).

1. **One top-level append-only collection, `auditLogs/{auditId}`** — extend what exists rather than add a parallel surface. It already has the right shape, correct append-only rules, and admin-only reads.
2. **The row records changed field *names*, plus values only for non-PII fields.** No full-document snapshots. A shared redaction list is the single source of truth for which fields are name-only (§Data shape).
3. **Two writers, both labelled.** Server (Admin SDK, inside the existing transaction where one exists) for every mutation already behind an authenticated API route — these carry `source: "server"` and a server-derived actor the client cannot forge. Client (admin app) for mutations that are still direct Firestore writes — `source: "client"`. **The audit write never rolls back the primary mutation** (the existing `SettingsPage.tsx` posture is right), but a *server-side* audit write inside a transaction commits atomically with the mutation, so the forensic rows cannot be silently lost the way the BR-12.1 rows were.
4. **Inline attribution is denormalized onto the record; history lives in `auditLogs`.** The booking drawer and the room modal read `*By` / `*ByName` fields on the record itself — Front-Desk-readable, one read, no extra query. The full history is an admin-only page. Two surfaces, two audiences, one write path.
5. **Staff display names are resolved once and cached**, reusing the `staffNameMap` pattern already in `ReportsPage.tsx:1026`. Rows also store `actorName` at write time so a deleted or renamed staff account does not blank out history retroactively — the name in the row is the name as it was.
6. **The existing per-booking `breakfastAudit` / `otherAddOnAudit` subcollections stay where they are.** They are server-written, correct, and already read by a Reports metric. Migrating them into `auditLogs` is churn with no new capability; the admin page links to them instead.
7. **Retention: 12 months**, pruned by a new `/api/janitor/audit-prune` cron inside the existing catch-all — the same shape as `/api/notifications/prune` (`API-ROUTES.md:286`). **Audit rows are explicitly NOT on the notifications' 30-day schedule** — 30 days cannot answer "who checked this guest in last season". *Owner decision — see CVQ.*
8. **Reads stay admin-only; no backfill.** Rows begin at ship date. Historical attribution that exists in the scattered `*By` fields is surfaced inline (decision 4) and so is not lost; it simply has no history rows behind it. *Owner decision — see CVQ.*

### Rejected alternatives

- **Per-record `bookings/{id}/history` subcollections only** — cannot answer "what did staff X do today" without a `collectionGroup` scan across every record, and gives rooms, settings and rates no uniform home. The per-booking add-on trails already prove the pattern's ceiling: they exist, they work, and they are read by exactly one metric because a per-record trail is invisible from anywhere else.
- **Firestore triggers / Cloud Functions to capture diffs automatically** — forbidden by `CLAUDE.md §Hard Rules` (Firebase Auth + Firestore + Storage only; no Cloud Functions). Would also have been the only approach that cannot be skipped by a direct client write, which is worth recording as the real cost of that rule.
- **Full `before` / `after` document snapshots** — PII (finding 4) and unbounded row size. A booking document with `breakfastSelections` and `otherAddOnSelections` maps is large; two copies per edit, forever, is the FLR-03 linear-growth trap with a compliance surface attached.
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

`guestName` · `guestEmail` · `guestPhone` · `guestRegistration` · `guestIdPhotoUrl` · `paymentProofUrl` · `paymentProofPath` · `discountIdPhotoUrl` · `lookupToken` · `qrToken` · `remarks` · any `members/*` personal field

Rationale: `GOTCHAS.md §Security & PII` (never log PII, never expose payment-proof URLs outside admin) + `SECURITY.md` RA 10173 data minimisation. `remarks` is on the list because `GOTCHAS.md` already forbids it reaching guest surfaces and it is free staff prose that may quote a guest.

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
- Links out to the per-booking `breakfastAudit` / `otherAddOnAudit` trails rather than duplicating them (decision 6).

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

- ⬜ **ATR-01** — Shared contract in `shared/`: `AuditLogEntry` type, Zod schema, closed action vocabulary, redaction list, `buildAuditEntry()` pure helper. One source of truth for both writers.
- ⬜ **ATR-02** — Server-side writers on every authenticated staff mutation, inside the existing transaction where there is one (check-in, checkout, confirm, cancel, reschedule, room reassign, payment add/verify/reject, refund, discount verify/reject, walk-in create). `source: "server"`.
- ⬜ **ATR-03** — Room attribution: the denormalized `rooms` fields above + `rooms.*` audit rows from `AdminContext` (`toggleHousekeepingStatus`, `updateRoomConfig`, `createRoom`, delete cascade) and `roomPrivate` block-reason writes. The owner's first question.
- ⬜ **ATR-04** — Non-destructive booking attribution: `createdBy` / `createdByName` stamped once at every create path; `checkedInByName` / `checkedOutByName`; `checkedInBy` + `checkedInAt` added to `shared/types` and `BACKEND.md`; `handledBy` documented as last-touch. **Compact `BACKEND.md` toward 10,000 tokens before adding rows to it** — it has 67 characters of headroom (finding 6).
- ⬜ **ATR-05** — Inline surfaces: booking drawer provenance line, room modal, dashboard housekeeping chip. Front-Desk-readable, no `auditLogs` read.
- ⬜ **ATR-06** — Admin-only `/audit` page: filters, pagination, CSV export, mobile card list, deep links.
- ⬜ **ATR-07** — Rules field validation + the three composite indexes + `/api/janitor/audit-prune` + the `vercel.json §crons` entry. Rules and writers in **one** commit (finding 1).
- ⬜ **ATR-08** — **Tests + MD sync.** Tests: shared (schema, redaction, action vocabulary), guest-api (a server writer per action family; the transaction commits the row atomically), admin (inline surfaces render and omit cleanly on legacy records; the page's query shape and pagination), rules (`firestore-rules-coverage`: append-only holds, `actor` spoofing denied, unknown action denied, Front Desk read denied). MDs: `BACKEND.md` (`auditLogs` schema + `rooms` / `bookings` fields + Security Rules Summary row), `TYPES.md` (`AuditLogEntry`, the new record fields, the `handledBy` clarification), `API-ROUTES.md` (the prune route + the cron list), `SECURITY.md` (retention + redaction posture + RA 10173 note), `GOTCHAS.md` (the finding-1 rule: a new collection ships with its rules block, and an audit writer never rolls back its primary mutation), `ROOM-MANAGEMENT.md`, `BOOKINGS-MANAGEMENT.md`, `DASHBOARD-OVERVIEW.md`, `SETTINGS.md`, `ADMIN-MOBILE.md`, `AUTH-ROLES.md`, `WHITE-LABEL.md` (retention is per-client config), `DECISIONS-FEATURES.md` **#330** + **#331**, `ROADMAP.md`.

### Suggested sequencing

ATR-01 → ATR-03 + ATR-04 (the two questions with no answer at all today, and both cheap) → ATR-05 (inline, makes the first two visible) → ATR-02 (the forensic writers, the largest item) → ATR-07 → ATR-06 (the page is worth least until there are rows in it) → ATR-08 rides with each item.

ATR-03 + ATR-04 + ATR-05 alone answer all three of the owner's questions for everything that happens *after* they ship. That is the natural first slice if the block needs splitting.
