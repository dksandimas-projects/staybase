# Notification Center

> App: admin-app
> Phase: Phase 12 — Post-Launch (proposed 2026-07-15 · **shipped** `feature/notification-center` commit `408f6ce` · post-ship review 2026-07-15, see §Post-ship review)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, docs/TYPES.md, plan/admin-app/CLAUDE.md, plan/features/ADMIN-MOBILE.md
> Related: [Intercom Inbox](INTERCOM-INBOX.md), [Store Management](STORE-MANAGEMENT.md), [Bookings Management](BOOKINGS-MANAGEMENT.md)

## Overview

The admin app already **rings** for five distinct events — new booking, pending payment, new guest message, guest arrival (check-in), guest departure (check-out) — via `playSynthNotification(type)` in `admin-app/src/context/AdminContext.tsx` (declared line ~541, implemented ~2049, emitted at lines 1141/1143/1145/1147 from the `bookings` snapshot diff and line 2237 from the `intercoms` snapshot diff). Because the emitter lives in `AdminContext`, the sound already fires on **every** page, not just the Intercom Inbox.

The gap this feature closes: **the ring is ephemeral.** Each event type has a distinct synthesized waveform, but if a staff member is looking away, walks past the desk, or the tab is backgrounded, the tone plays once and vanishes — leaving no record of *what happened* or *what to act on*. Front desk cannot answer "the app just beeped — what was it?"

The Notification Center is a **header bell + unread badge + panel** listing recent events with type, entity reference, timestamp, and a deep link to the relevant page — backed by a **persisted `notifications` Firestore collection** so the log survives reloads and is shared across every staff device and shift.

---

## Chosen design — Option B: persisted `notifications` collection

> **Decision (2026-07-15, owner):** build the persisted collection, not the session-only ring buffer. Rationale: the owner wants a durable, cross-device record so any staff member (or the next shift) can see what came in while nobody was watching, and a who-saw-what read trail. Record this in `DECISIONS-FEATURES.md` when the build opens.
>
> **Cost/scale note (carry into the build):** unlike a session buffer, this adds one Firestore **write per operational event** plus per-staff read-state updates, and the panel runs a live `onSnapshot`. Fine at 14-room single-desk scale. Add a **retention job** (see below) so the collection does not grow unbounded on Blaze — this is the FLR-03-style linear-growth trap, so bound it from day one.

### Collection: `notifications/{notificationId}`

Operational alerts for staff. One document per event. Written **server-side via the Admin SDK** (see write path) — clients never create these directly.

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"booking"` \| `"payment"` \| `"message"` \| `"arrival"` \| `"departure"` \| `"store-order"` — mirrors `playSynthNotification` types plus store orders |
| `title` | string | Plain-language summary, e.g. "New booking — Room 202" |
| `entityType` | string | `"booking"` \| `"storeOrder"` \| `"intercom"` — what the deep link targets |
| `entityId` | string | Booking ID / store order ID / room number for the deep link |
| `roomNumber` | string \| null | Denormalized for display; **never store guest email or payment data** (Hard Rule: no PII in logs) |
| `bookingRef` | string \| null | e.g. `"SI-2026-0042"` for display |
| `readBy` | map<string, timestamp> | Keyed by staff UID → when they marked it read. Absence of my UID = unread for me. Avoids per-staff document fan-out. |
| `createdBy` | string | `"system"` (API route) — never a guest |
| `createdAt` | timestamp | Server timestamp; the panel orders by this desc |

**Unread-for-me** = `createdAt` within the retention window AND my UID not present in `readBy`. "Mark all read" writes my UID into `readBy` for the currently loaded set; "mark one" on click.

### Write path — the one real wrinkle (must resolve before build)

Because the stack is **Auth + Firestore + Storage only — no Cloud Functions** (Hard Rule), there is no database trigger to author notifications. So writes must originate from a trusted server route. This splits the five+ event types cleanly into two groups:

- **Events that already pass through an API route → write the notification in that route (Admin SDK), one doc, trustworthy, cross-device.** These are: new booking (`/api/bookings/create`), payment reaching a booking (`/api/bookings/add-payment` / confirm), check-in (`/api/bookings/checkin` → `arrival`), check-out (departure), store order placed (`/api/store/*`). This covers every *actionable* alert.
- **Guest chat messages have no server route.** Guests write directly to `intercoms/{roomId}/messages` under the open (physical-QR-gated) rules; there is no Admin SDK hop to piggyback a notification write on, and we will not open `notifications` to client/guest creation (abuse + PII risk). **Decided (2026-07-15, owner): B1 — message alerts stay live-derived.** The bell panel merges, at read time, the persisted `notifications` docs (operational events) with unread guest messages sourced from the existing `intercoms` `onSnapshot` (exactly as they ring today). Messages are already fully queryable as unread, so nothing is lost; only chat alerts skip persistence — zero new infra, honest about the no-Cloud-Functions stack.

  > **Rejected: B2** (route guest sends through a new `/api/intercom/message` endpoint so the server writes both the message and a `message` notification). Cleaner single data model, but adds an API route + rate limiting, changes the guest send path, and re-introduces a server hop on the hot chat path. Not built. Revisit only if durable chat history in the notification trail is later explicitly requested.

  **Panel-merge consequence:** unread guest messages are **not** `notifications` documents, so their read-state is *not* tracked in `readBy` — it continues to follow the existing intercom unread/read model (a message is "read" once a staff member opens its thread). Only the persisted operational events use `readBy`. The bell's unread badge sums both sources.

### Security rules (add to `firebase/firestore.rules` + BACKEND.md §Security Rules Summary at build)

| Collection | Read | Write |
|---|---|---|
| `notifications` | Staff/Admin only (`isStaff()`) | Create = API/Admin SDK only; Update = Staff/Admin but **only the `readBy` field** (mark-read); Delete = Admin (or retention job via Admin SDK) |

Guests must never read or write this collection.

### Retention (build alongside, do not defer)

The panel loads a bounded query — `orderBy("createdAt","desc").limit(50)` — never the whole collection. Prune old docs so history stays bounded: a Vercel Cron entry in `vercel.json` (same pattern as the existing check-in-reminder cron) hitting a new admin route that hard-deletes `notifications` older than N days (e.g. 30). Without this, the collection grows linearly forever (the FLR-03 pattern already flagged in the roadmap).

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Bell reachable from every admin page (lives in the shared header / `AdminLayout`), not just Intercom
- [ ] Unread count is obvious at a glance; badge reflects **my** unread (UID not in `readBy`), not a global count
- [ ] Each entry states in plain language what happened and links to the next step — no dead ends
- [ ] Empty state ("You're all caught up") explains there's nothing pending
- [ ] Loading uses existing skeleton conventions; no spinner
- [ ] Works at < 768px per `ADMIN-MOBILE.md` — panel is a bottom sheet / full-width drawer on mobile, not a clipped desktop dropdown

---

## UI Checklist

- [ ] **Bell icon in the admin header** with an unread-count badge — persistent across all routes via `AdminLayout`
- [ ] **Notification panel** (dropdown on desktop, drawer/bottom-sheet on mobile) — live `onSnapshot` on `notifications` (bounded `limit(50)`, `orderBy createdAt desc`), merged with live-derived unread guest messages from the existing `intercoms` listener (B1)
- [ ] Per-entry: event-type icon + label (Booking / Payment / Message / Arrival / Departure / Store order), `title`, room #/booking ref, relative timestamp
- [ ] Clicking an entry deep-links via `entityType`/`entityId`: booking → `/bookings` (open drawer), message → `/intercom` (open thread), store order → Store Management, arrival/departure → `/bookings` or Dashboard arrivals list — and writes my UID into `readBy`
- [ ] "Mark all as read" action — writes my UID into `readBy` for the loaded set
- [ ] Read/unread state is **per staff** and survives reload + follows me across devices (that is the whole point of Option B)
- [ ] Respects the existing **sound mute** setting (`soundsEnabled` / per-staff `localStorage` mute, Decision #97) — muting silences the tone but the panel still logs and badges events (visual-only mode)
- [ ] Store orders included as an event type — the store order API route writes a `store-order` notification (today store orders ring via the Intercom Inbox path; unify them here)

---

## Data / wiring notes

- **New shared type** `Notification` in `@spark-inn/shared` (add to `plan/docs/TYPES.md`) matching the schema table above.
- **Server writes:** the API routes listed in the write-path section each `add` one `notifications` doc via Admin SDK after their primary Firestore write succeeds. Keep it best-effort/non-blocking — a failed notification write must never fail the booking/payment it describes.
- **Client read:** a `useNotifications` hook (`onSnapshot`, bounded query) feeding the bell/panel via `AdminContext`, matching the codebase's "Firestore via custom hooks + context" pattern. **Always unsubscribe in cleanup** (GOTCHAS).
- **Do not add a second `bookings`/`intercoms` listener** — the existing snapshot diffs stay the *sound* trigger; persistence happens server-side (operational events) and the bell reads the `notifications` collection.
- **Never log PII** (Hard Rule) — entries carry room number / booking ref / order ref, never guest email or payment data.
- Reuse `Toast`, `Drawer` (admin), `useBreakpoint`, and `BottomTabBar`/focus-trap building blocks from `ADMIN-MOBILE.md` for the mobile panel.
- Role-aware: Front Desk and Admin both see the center (rules: `isStaff()`); all event types are operational, not admin-only.
- **MD sync at build:** add the `notifications` collection to `BACKEND.md` (schema table + Security Rules Summary row), the `Notification` type to `TYPES.md`, the notification-write side-effect to the relevant routes in `API-ROUTES.md`, and the retention cron to `vercel.json` + the cron list.

---

## Out of scope (for the first cut)

- Browser push / Web Notifications API (system-level toasts when the tab is closed) — needs Firebase Cloud Messaging, which is **out of the "Auth + Firestore + Storage only, no Cloud Functions" stack constraint** and requires a stack decision.
- B2 server-relayed guest chat messages (see write path) — rejected 2026-07-15 in favor of B1; revisit only if durable chat history in the notification trail is later requested.
- Per-event-type mute granularity (today mute is all-or-nothing).

---

## Post-ship review (2026-07-15)

Code review of the shipped `feature/notification-center` (commit `408f6ce`); fixes landed on `fix/notification-center-postship` (commit `07ee8b9`) and were re-reviewed. Full item tracking lives in `plan/project/ROADMAP.md §Notification Center — post-ship review`. Status summary:

**Fixed + verified:**
- **NC-01 (SEV-2) ✅ — notification writes were fire-and-forget on Vercel.** Every write site used `void writeNotification(...)` (not awaited), unlike the adjacent `await`ed email sends, so on Vercel the instance could freeze/recycle after `res.json()` flushed and silently drop the doc — worst case `handleCheckoutBooking`, which called it *after* the response was sent. **Fixed:** all 7 write sites now `await`, and the checkout block moved above `res.json`. Verified: typecheck clean, 7 source-pattern tests assert the await + ordering.
- **NC-03 (SEV-4) ✅ — retention prune deleted serially.** A 500-iteration `await` loop. **Fixed:** now uses `adminDb.bulkWriter()` with per-doc `.catch`; `deleted`/`deletedIds` reflect only docs that actually landed. Verified: happy + partial-success tests pass.

**`readBy` rule hardening (NC-02 / NC-02b / NC-02c):**
- **NC-02 (SEV-4) ✅ — rewrite-whole-map scope.** Tightened so any *added* key may only be the writer's own UID and the writer's own value must be a timestamp — closes UID injection + junk-value injection.
- **NC-02b (SEV-4) ✅ — removal vector.** Added the inverse check so every existing key must survive; combined with NC-02, the key set can only grow by the writer's own UID. Value-tampering on others' *existing* entries stays reachable (rules can't loop over map values) and is **knowingly accepted** at this severity.
- **NC-02c (SEV-4) ✅ — the NC-02 clause was functionally broken.** It used `keys().union([uid])`, but `keys()` is a List and `.union()` is Set-only — the Firebase rules validator errored it, which on an `allow update` **denies the write**, so staff could not mark *any* notification read in production. Missed because the rules tests are grep-based (assert text, don't evaluate). **Fixed:** replaced with a List-only `keys().removeAll(existing).hasOnly([uid])` clause; validator now returns **"No errors detected."**
- **NC-02d (SEV-4) ✅ — real rules test added.** `firebase/tests/notifications.rules.test.ts` loads `firestore.rules` into the Firestore emulator and evaluates actual decisions (mark-own-read allowed; removal / foreign-UID / non-timestamp / non-readBy-field / non-staff / create / delete denied; the value-forgery residual pinned as `assertSucceeds`). Run via `npm run test:rules` (needs the emulator/Java; not in default `npm test`). This is the guard that would have caught NC-02c — grep tests can't catch an invalid-but-present rule.

**Verified correct (no action):** PII-safe titles (ref + room only); idempotent payment writes (`!idempotentReplay`); client hook auth-gated, `limit(50)`-bounded, unsubscribed; dot-path `readBy.${uid}` mark-read; mute-independent bell (Decision #97); deep links resolve (`?orderId=` handles the store-order load race, `?room=` opens the thread); CRON_SECRET-gated cron with capped inputs; single-field queries (no composite index needed).
