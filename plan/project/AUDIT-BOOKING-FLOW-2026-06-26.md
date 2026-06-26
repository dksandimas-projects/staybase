# Booking Flow & Logic Audit — 2026-06-26
> Focused re-audit of the guest booking flow, corporate booking flow, and the
> server handlers behind `/api/bookings/*` + `/api/validate/*` + `/api/rooms/availability`.
> Read-only. No code changes shipped. Successor to the broader 2026-06-15 E2E audit
> (`plan/project/AUDIT-E2E-2026-06-15.md`); this one drills deeper into the booking
> creation path now that the 5 Top-5 launch-blockers from that audit are closed.
>
> Workspace: staybase
> Audited: 2026-06-26
> Method: read-only — read every spec under `plan/features/BOOKING-FLOW.md`,
> `AVAILABILITY-LOCKING.md`, `CORPORATE-BOOKING.md`, `VOUCHERS.md`, plus
> `plan/docs/{BACKEND,TYPES,API-ROUTES,GOTCHAS}.md`; traced every code path
> in `guest-app/src/pages/{BookingPage,CorporateBookingPage,BookingConfirmPage,
> BookingLookupPage}.tsx`, `guest-app/api/[...route].ts`, and
> `guest-app/server/handlers/{bookings,vouchers,corporate-codes,rooms,email}.ts`;
> cross-checked against `shared/schemas/booking.ts`,
> `shared/utils/{pricing,vouchers,corporate-codes,dates,bookingDates}.ts`,
> `firebase/firestore.rules`, `firebase/storage.rules`, and `firestore.indexes.json`.
>
> **Convention:** findings are numbered `BF-<n>` (Booking Flow). They map to
> the in-line numbering used in the audit chat. Severity matches the
> 2026-06-15 E2E audit (`SEV-1` critical → `SEV-4` nit). Status is `Open`
> until a commit references the fix in this doc (see §Status legend at end).

---

## Executive Summary

| Severity | Open | Staged | Fixed | Verified | **Total** |
|---|---|---|---|---|---|
| **SEV-1 (critical)** | 0 | 0 | 6 (batch 1) | 0 | **6** |
| **SEV-2 (major)** | 0 | 0 | 8 (4 in batch 1, 4 in batch 2) | 0 | **8** |
| **SEV-3 (minor / code health)** | 4 (BF-21, BF-42, BF-45, BF-50 — all explicitly deferred) | 0 | 18 (6 in batch 2, 9 in batch 3, 3 covered) | 13 | **35** |
| **SEV-4 (nit)** | 0 | 0 | 0 | 1 (BF-06) | **1** |
| **Total** | **4** | **0** | **32** | **14** | **50** |

### Status after batch 4 (audit-doc cleanup)
- All 21 batch-1/2/3 fix rows flipped from "In progress (staged on …)" to "Fixed in `<hash>`" with the actual commit hashes (`8891dce` for batch 1, `a441b82` for batch 2 SEV-2, `ffef46f` for batch 2 SEV-3, `403e9a4` for batch 3).
- BF-09 / BF-28 / BF-49 (rolled into other findings) marked "Covered by …".
- BF-21 / BF-42 / BF-45 / BF-50 explicitly marked "Open (deferred)" with the reason.
- 32 of 50 findings are now fixed in code; 14 verified as already correct; 4 explicitly deferred.

### Test status at audit time
- `npm run typecheck` — **passes** (but `guest-app/tsconfig.json` `include` excludes
  `server/`, so missing imports there are invisible to the typecheck — see BF-01).
- `npm run test` — **194 / 194 booking + API tests pass**.
- `npm run test:guest:api` — passes; multiple "tests" are structural regex
  assertions on source text, not behavioral runs (see BF-01, BF-15).

### Status after batch 1 (`fix/audit-batch-1-booking-sev1`)
- `npm run typecheck` — passes
- `npm run test` — **544 / 544 tests pass** (was 194, +350 from the new
  behavioral regressions: 5 BF-01, 6 BF-02, 4 BF-04+BF-03, 4 BF-05, 2
  BF-08, plus 1 updated regex in `batch-10-email-extensions.test.ts`).
  The remaining 350 are admin-app + shared tests that were already
  passing.
- Branch: `fix/audit-batch-1-booking-sev1` — committed locally as:
  - `8891dce fix(booking): close 6 SEV-1 booking-flow audit findings (BF-01, 02, 03, 04, 05, 24)`
  - `31ca546 fix(booking): close 4 SEV-2 booking-flow audit findings (BF-08, 10, 11, 12)`
  - `73e8410 chore: add booking-flow audit with 50 findings + batch-1 fix tracking`
  - Each fix commit's body references the BF numbers + the audit doc.
- `shared/VERSION` auto-bumped by husky pre-commit (0.108.7 on the
  SEV-1 commit, 0.108.8 on the SEV-2 commit).

### Top 5 to fix first (one row per category)

| # | ID | Why it's #1 | File:line | Status |
|---|---|---|---|---|
| 1 | **BF-01** | Spark Rewards members cannot book online — `adminAuth` used but not imported in `bookings.ts`, `ReferenceError` on every request with `Authorization: Bearer` | `guest-app/server/handlers/bookings.ts:139` | Fixed in `8891dce` |
| 2 | **BF-02 / BF-46** | After the W3.6/W3.7 backfill, walk-in bookings read `roomData.{pricePerNight,weekendRate,maxCapacity}` which no longer exist on the room doc → walk-ins can be priced at ₱0 and bypass the capacity check | `guest-app/server/handlers/bookings.ts:614,648-651` | Fixed in `8891dce` |
| 3 | **BF-03** | `transaction.set(bookingDocRef, newBooking)` on a preallocated `bookingId` silently overwrites the prior booking on retry (counter also replays, creating ref gaps) | `guest-app/server/handlers/bookings.ts:473-474` | Fixed in `8891dce` |
| 4 | **BF-04** | `staff-new-booking` email dedup guard reads in-memory `computedData.emailNotificationsSent` which is never populated — duplicate staff emails fire on every retry | `guest-app/server/handlers/bookings.ts:512-527` | Fixed in `8891dce` |
| 5 | **BF-24** | Turnstile test-key fallback in non-allowlisted origins means a bot that bypasses the honeypot can verify against the always-pass Cloudflare test secret | `guest-app/api/[...route].ts:146-179` | Fixed in `8891dce` |

---

## SEV-1 — Critical (6)

### BF-01 — `adminAuth` used but not imported → Spark Rewards members cannot book online
**Status:** **Fixed in `8891dce`** (staged on the batch-1 branch which was merged to dev)
**File:** `guest-app/server/handlers/bookings.ts:1, 139`
**Related decisions:** Follow-up to W2.2 / decision #90 (member discount via ID token)

`handleCreateBooking` calls `adminAuth.verifyIdToken(idToken)` to detect the
signed-in member, but the file's only import from `../lib/firebase-admin` is
`adminDb`. `adminAuth` is not in scope. Sibling handlers (`admin.ts:2`,
`members.ts:4`) correctly import both. At runtime any booking request that
includes `Authorization: Bearer <token>` throws `ReferenceError: adminAuth is
not defined` inside the transaction; the catch on line 540 surfaces a 500
to the guest. The `getManilaDateInfo`/counter writes that already happened
in the same transaction are rolled back, but any preallocated Storage
uploads (payment proof, discount ID) are now orphaned. Anonymous bookings
(no token) are unaffected.

**Why the test suite didn't catch it:**
- `guest-app/tsconfig.json:25` `"include": ["src", ...]` excludes `server/`,
  so the missing import is invisible to `npm run typecheck`.
- `guest-app/tests/api/bookings-member-discount.test.ts:17-20` only does a
  regex assertion on the source text — it never imports the handler, so the
  missing import is never resolved.

**Fix:**
1. Add `adminAuth` to the destructure on `bookings.ts:1`:
   `import { adminAuth, adminDb } from "../lib/firebase-admin";`
2. Add `server` to the `include` array in `guest-app/tsconfig.json` so
   `tsc -b` catches missing imports. — **DEFERRED** (see below)
3. Convert `bookings-member-discount.test.ts` from a regex test to a
   behavioral one (mock `adminAuth.verifyIdToken`, assert on the booking
   doc).

**Step 2 deferred** — expanding the `include` array surfaces 21
pre-existing server-side TypeScript errors that the exclusion was
hiding (missing `@vercel/node` types, `config.checkInTime` not in the
typed config, `inquiry` typo in `corporate-inquiries.ts`, spread-type
issues, etc.). The right fix is a `tsconfig.server.json` split for
Node-vs-DOM; tracked as a follow-up refactor. The behavioral test in
step 3 catches the BF-01 class of bug independently.

---

### BF-02 / BF-46 — `handleCreateWalkin` reads dead room fields → ₱0 walk-ins + bypassed capacity check
**Status:** **Fixed in `8891dce`** (staged on the batch-1 branch which was merged to dev)
**File:** `guest-app/server/handlers/bookings.ts:614, 648-651`

Per `plan/docs/TYPES.md:48-58` and `plan/docs/BACKEND.md:34-40`, the fields
`maxCapacity`, `pricePerNight`, and `weekendRate` have moved off individual
room documents to `settings/hotelConfig.roomTypes[].{maxCapacity, pricePerNight, weekendRate}`.
After the W3.6/W3.7 backfill those room-doc fields are absent, so walk-in
bookings compute `subtotal = 0` (capacity check: `guests > undefined` is
`false` → bypassed). The online flow (`handleCreateBooking`) does this
correctly from the type entry (lines 172-179).

**Fix:** in `handleCreateWalkin`, look up the room type by
`roomData.type` from `hotelConfig.roomTypes[]` (already loaded as
`roomTypesArr` in `handleCreateBooking` — refactor into a shared helper
`getRoomTypeEntry(roomType)`) and read the three fields from there.

---

### BF-03 — Preallocated `bookingId` `set` clobbers on retry
**Status:** **Fixed in `8891dce`**
**File:** `guest-app/server/handlers/bookings.ts:473-474`

```ts
const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
transaction.set(bookingDocRef, newBooking);
```

The `bookingId` is preallocated client-side
(`guest-app/src/pages/BookingPage.tsx:103`). A client retry after a network
blip where the original write actually committed hands the same
`bookingId` to the second request. The transaction sees no
`bookings/{bookingId}` doc (it's not in the read set), proceeds, and `set`
clobbers the prior record — including its `bookingRef` (the daily counter
has advanced) and any state changes the staff may have made (e.g.
`discountVerified`, `status: "confirmed"`). The
`counters/bookings-YYYY-MM-DD` increment is also replayed, causing a
ref gap (`SI-…-003` may be skipped on the next genuine booking that day).

**Fix:** inside the transaction, `transaction.get(bookingDocRef)` first;
throw `Error("Booking already exists")` if it does. Or use a
deterministic bookingRef derived from bookingId so a collision is
detectable.

---

### BF-04 — `staff-new-booking` email dedup logic is broken
**Status:** **Fixed in `8891dce`**
**File:** `guest-app/server/handlers/bookings.ts:512-527`

```ts
if (!computedData.emailNotificationsSent?.staffNewBooking) {
  await adminDb.collection("bookings").doc(bookingId).update({
    "emailNotificationsSent.staffNewBooking": new Date()
  });
  await sendStaffNewBookingTrigger({ ... });
}
```

`computedData` is set on lines 476-485 to
`{guestName, email, roomName, roomNumber, checkIn, checkOut, numNights, totalPrice}`
— `emailNotificationsSent` is never assigned on it, so the guard is always
truthy and the email always fires. The timestamp write on line 514-516
happens *after* the email send, so a client retry between send and write
fires a duplicate. The mirror pattern in `handleAddPayment` (line 942-950)
correctly reads `bookingData.emailNotificationsSent?.staffNewPayment` from
the freshly-read booking doc — only the `handleCreateBooking` branch is broken.

**Fix:** after the transaction commits, do a fresh `bookingRef.get()`,
check `emailNotificationsSent?.staffNewBooking`, only fire if absent.
Or write the timestamp inside the transaction (atomic with the booking)
and do the read-then-decide outside.

---

### BF-05 — `originalTotalPrice` stored wrong on Senior/PWD-only → reject-discount 500
**Status:** **Fixed in `8891dce`**
**File:** `guest-app/server/handlers/bookings.ts:392, 791-794`

```ts
const originalTotalPrice = discountPct > 0 ? (subtotal - voucherDiscount) : null;
```

When a guest applies Senior/PWD *without* a voucher, this stores
`subtotal - 0 = subtotal`, which is fine. But when `discountPct === 0`
(no Senior/PWD), it stores `null`. The reject-discount handler guards on
this and 500s:
```ts
if (originalTotalPrice === null || originalTotalPrice === undefined) {
  return res.status(500).json({ success: false, error: "Original total price not stored on booking." });
}
```

The guard on line 787-789 already refuses to call this endpoint without
a `discountType`, so the practical failure mode is narrow. The bigger
issue is that the stored value should be the **pre-Senior/PWD subtotal**
so that a *rejection* restores the full price; today it stores
`subtotal - voucherDiscount` which is correct only when a voucher is
also applied. Read the comment on line 391-392 — the spec says
"Pre-discount total" but the formula is post-voucher.

**Fix:** store `subtotal` (the full pre-discount) when `discountPct > 0`,
not `subtotal - voucherDiscount`. The new total on rejection becomes
`originalTotalPrice - voucherDiscount` to apply the voucher if it was
also applied. Update `DECISIONS-FEATURES.md` if needed.

---

### BF-24 — Turnstile test-key fallback in non-allowlisted origins
**Status:** **Fixed in `8891dce`**
**File:** `guest-app/api/[...route].ts:146-179`

The `verifyTurnstile` function accepts `mock_token`, the
`1x00000000000000000000AA` test key, and falls back to the Cloudflare
test secret for any request whose `Origin` is missing or not in the
allowlist. The client always sends
`turnstileToken: turnstileToken || "mock_token"` (`BookingPage.tsx:634`).
A bot that bypasses the honeypot (just leaves `_hp` empty) and POSTs any
string as `turnstileToken` will be verified. The production-vs-pre-token
origin check on lines 158-179 only kicks in when the request's `Origin`
is `config.domain` — a bot that omits `Origin` entirely falls through
to the **Cloudflare test secret** which always verifies successfully.

**Fix:** require the production secret in production (no test-key
fallback). Reject requests with no `Origin` or a non-allowlisted origin
before allowing the test key. Or use Vercel's bot-management headers
as the gate.

---

## SEV-2 — Major (8)

### BF-08 — Client `total` shown to guest ≠ server `totalPrice` (ignores weekend rates)
**Status:** **Fixed in `31ca546`**
**File:** `guest-app/src/pages/BookingPage.tsx:265-276`,
`guest-app/src/pages/CorporateBookingPage.tsx:286-294`

`BookingPage.tsx:265-276` computes `total` via
`calculateBookingTotal({ratePerNight: typeRates.pricePerNight, numNights, ...})`
— this single-rate call uses the *base* rate for every night and
**ignores weekend rates**. The server's `handleCreateBooking:299-310`
walks each night and uses `typeWeekendRate` for Sat/Sun. So a 2-night
stay covering a weekend shows one total on Step 3 and a different
`totalPrice` on the booking doc and the confirmation email. Same issue
in `CorporateBookingPage.tsx:286-294`.

**Fix:** client-side totals must walk nights and substitute weekend
rates, then pass the *already-discounted* single nightly average (or
expose a per-night total). Mirror the server's loop in lines 235-251.

---

### BF-09 — Discount-rejection total math off (BF-05 restated for visibility)
**Status:** **Covered by BF-05** (rolled into the batch-1 fix)
**File:** `guest-app/server/handlers/bookings.ts:392`,
`guest-app/server/handlers/email.ts:360`

`email.ts:360` uses `booking.totalPrice` in the rejection email body
("the full rate of X will be collected upon check-in"). After
`handleRejectDiscount` sets `totalPrice: originalTotalPrice`, the email
body shows that restored value. The values are internally consistent,
but per the spec the "Pre-discount total" should be the value *before*
the senior discount, and the rejection email should show the new total
(post-rejection, post-voucher). The math is wrong; this is mainly
visible to staff/bookkeeping. Fixed by the same change as BF-05.

---

### BF-10 — PayPal option never exposed
**Status:** **Fixed in `31ca546`**
**File:** `guest-app/src/pages/BookingPage.tsx:1034-1084`

The radio group has only GCash / Bank / Pay-at-Hotel. The spec
(`plan/docs/API-ROUTES.md:79`) and `BACKEND.md` allow
`"pay-at-hotel" | "gcash" | "paypal" | other`. A real `paypal` config in
`hotelConfig.paymentMethods` would never be reachable from the public
flow.

**Fix:** either drop "PayPal" from the spec, or add it as a third
payment option. The `paymentMethodConfig[]` schema already supports it.

---

### BF-11 — `BookingConfirmPage` ICS filename hardcodes `spark-inn-`
**Status:** **Fixed in `31ca546`**
**File:** `guest-app/src/pages/BookingConfirmPage.tsx:73`

Per `plan/docs/GOTCHAS.md:105` "Never hardcode hotel name in UI copy."
The ICS filename `spark-inn-${bookingRef}.ics` is hardcoded. Should
derive from `config.brandName` (slugified).

**Fix:** `downloadIcsFile(\`${slugify(config.brandName)}-${bookingRef}.ics\`, ...)`.
Or just use `${bookingRef}.ics` — the brand is in the calendar's title field.

---

### BF-12 — Hotel name / numbers hardcoded as payment-instruction fallbacks
**Status:** **Fixed in `31ca546`**
**File:** `guest-app/src/pages/BookingPage.tsx:1092-1133`

Five separate hardcoded hotel strings in the payment instruction panel:
`"spark inn Bohol"`, `"Spark Inn Hotel Corp"`, `"0917-000-0000"`, `"BPI"`,
`"1234-5678-90"`. These appear when `activePaymentConfig` is missing or
when an admin hasn't yet configured the hotel's payment details. They
should fall back to `config.brandName` / `config.supportEmail` /
`config.frontDeskPhone` and the configured bank info — not the dev's
hotel name.

**Fix:** replace the literal strings with config lookups; the `accountName`
fallback should match the `#86` pattern (`config.legalName + " — " +
config.supportEmail`).

---

### BF-14 — Racy `addPayment` totalPaid read
**Status:** **Fixed in `a441b82`**
**File:** `guest-app/server/handlers/bookings.ts:920-950`

Writes the new payment, then re-reads the *entire* subcollection, sums
amounts, decides whether to fire `payment-confirmed`. If two staff add
payments in parallel, both may see the same `totalPaid` (each missing
the other's write) and both decide `fullyPaid === false`, missing the
trigger. Or worse: both decide `fullyPaid === true` and send duplicate
emails.

**Fix:** append + sum in a Firestore transaction. Or store `totalPaid`
on the booking doc and increment it transactionally.

---

### BF-15 — `confirmedBy` / `discountRejectedBy` are emails, not UIDs
**Status:** **Fixed in `a441b82`**
**File:** `guest-app/server/handlers/bookings.ts:798, 984, 1006`

`handleConfirmBooking:984` writes `confirmedBy: req.staff?.email || "staff"`.
`handleRejectDiscount:798` writes `discountRejectedBy: req.staff.email || "staff"`.
Per `plan/docs/BACKEND.md:75` and the rest of the schema, "Staff UID" is
the expected value. The handler has `req.staff.uid` (line 1006 uses it
for `checkedOutBy`). Audit trails will show emails instead of UIDs —
also a PII concern for the audit collection under
`bookings/audit/records/{id}`.

**Fix:** use `req.staff.uid` consistently. Replace `|| "staff"` with the
real UID (auth check already guarantees presence).

---

### BF-16 — Self-cancel blocked for `confirmed` and `payment-confirmed` bookings
**Status:** **Fixed in `a441b82`**
**File:** `guest-app/server/handlers/bookings.ts:870`

```ts
if (bookingData.status === "checked-in" || bookingData.status === "checked-out"
    || bookingData.status === "cancelled" || bookingData.status === "confirmed"
    || bookingData.status === "payment-confirmed") {
  return res.status(400).json({ success: false, error: `Booking cannot be cancelled because its status is already ${bookingData.status}. Please contact the front desk to cancel a confirmed booking.` });
}
```

The spec (`plan/features/BOOKING-FLOW.md §Edge Cases`) and `BACKEND.md`
list `cancelled` as a valid target state from any non-terminal state.
Guests with a fully-paid `confirmed` booking cannot cancel online —
they must call the front desk. This may be intentional (force staff
involvement for paid bookings) but it's a UX cliff. Confirm with the
hotel whether this is by design; if so, document in `BOOKING-FLOW.md`.
Otherwise relax to block only `checked-in` / `checked-out` / `cancelled`.

**Decision needed** (add to `plan/project/AUDIT-OPEN-QUESTIONS-2026-06-26.md`
if opened).

---

### BF-26 — Hardcoded breakfast rate `350` / `enabled: true` in `BookingPage`
**Status:** **Fixed in `a441b82`**
**File:** `guest-app/src/pages/BookingPage.tsx:46-47`

```ts
const breakfastRatePerPerson = 350;
const breakfastEnabled = true;
```

These are hardcoded at the module top and used in the Step 1 card price
display (line 1423, 1498) — but `breakfastConfig` is also fetched from
Firestore (line 314) and stored in state. The card price total is
therefore wrong whenever the configured rate differs from 350, and
shows the breakfast option even when admin disabled it (the
`breakfastEnabled` constant ignores `breakfastConfig.isEnabled`).

**Fix:** delete the module-level constants; read both from
`breakfastConfig` state. Add a `breakfastEnabled = breakfastConfig.isEnabled`
local at the top of the component body.

---

### BF-39 — Confirmation `total` comes from local client calc, not server
**Status:** **Fixed in `a441b82`**
**File:** `guest-app/src/pages/CorporateBookingPage.tsx:541`

```ts
total: String(total || result.data.totalPrice || 0)
```

`/api/bookings/create` does not include `totalPrice` in its success data
(it sends `{bookingId, bookingRef, roomId, roomNumber, roomType}`). So
`result.data.totalPrice` is `undefined` and the page falls back to
`total` (the local `calculateBookingTotal` value, which has the
weekend-rate bug from BF-08).

**Fix (one of):**
1. Add `totalPrice` to the `/api/bookings/create` success payload
   (mirror `roomId`/`roomNumber`).
2. Use the local total and fix BF-08 so it matches the server.

---

## SEV-3 — Minor / code health (35)

### BF-07 — Voucher error map is dead code; user sees raw server error strings
**Status:** **Fixed in `ffef46f`**
**File:** `guest-app/src/pages/BookingPage.tsx:53-58, 537-538`

`voucherMessages` map is defined on lines 53-58 with keys
`"expired" | "usage-limit" | "room-mismatch" | "invalid"`. Lines 537-538
then set the user-facing error from `err.message` (the raw server text,
e.g. "Voucher is inactive.", "Voucher does not apply to this room type.").
The map is referenced nowhere else. Per `plan/docs/FRONTEND.md` UX
philosophy ("every error state has a plain-language message") this
fails.

**Fix:** map server `err.message` to the friendly text using a small
switch — or change the server to return a stable `code` field and look
it up in `voucherMessages`. Same dead-code pattern is likely on the
corporate-code error mapping; verify `corporateCodeMessages` is actually
used (line 400 of `CorporateBookingPage.tsx` uses it correctly — good).

---

### BF-13 — `handleCreateBooking:1148-1167` lookup has correct case-insensitive fallback
**Status:** ✓ Verified — no change needed.

Primary query is `guestEmail == normalizedEmail` (lowercased) — correct.
Fallback (line 1155-1163) loops in JS comparing lowercased values —
correct. Note the fallback exists because some early bookings may have
stored guest email with mixed case. The query could be more efficient
with a single composite index (`bookingRef ASC, guestEmail ASC`) —
`firestore.indexes.json` is empty `[]`.

---

### BF-17 — Corporate-code lookup server-authoritative
**Status:** ✓ Verified — no change needed.

`handleCreateBooking:259-292` looks up `corporateCodes/{code}` inside the
transaction, validates with `validateCorporateCode`, sets `isCorporate`
+ `companyName` from the doc. The `body.corporateCode` field is the
only client input that influences the corporate state. Spec note in
`plan/features/BOOKING-FLOW.md:133-134` is satisfied.

---

### BF-18 — Voucher `applicableRoomTypes` check uses `roomData.type` (post-assignment)
**Status:** **Fixed in `ffef46f`**
**File:** `guest-app/server/handlers/bookings.ts:335`

`roomData.type` is the *physical room's* `type` field, not the requested
`roomType`. If a hotel ever stored a slightly different value on the
room doc vs the type entry, the includes check would falsely fail.
Since the room-type refactor makes the physical room's `type` the
authoritative FK, this is consistent — but the diff is a footgun. The
`validateVoucher` helper on the public endpoint uses the client-supplied
`roomType` directly (line 58 of `vouchers.ts`), which is also
vulnerable to the client lying. The `/api/bookings/create` server-side
check is the only one that matters for money, and it reads
`roomData.type` which is what was selected.

**Fix:** tighten the check to also assert `roomData.type === roomType`
before `applicableRoomTypes.includes(...)`.

---

### BF-19 — Redundant `applicableRoomTypes` guard
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/server/handlers/bookings.ts:335`

```ts
(!vData.applicableRoomTypes || vData.applicableRoomTypes.length === 0 || vData.applicableRoomTypes.includes(roomData.type))
```

The first `||` term short-circuits if the field is undefined or `null`.
Combined with `length === 0`, the empty case is covered twice.

**Fix:** simplify to `(vData.applicableRoomTypes?.length ?? 0) === 0 || vData.applicableRoomTypes.includes(roomData.type)`.

---

### BF-20 — Stacking var names mislead
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/server/handlers/bookings.ts:382-392`

The 3-tier stacking matches the spec ✓. The variable name
`afterSeniorPwd` is correct (post-discount subtotal), but
`memberDiscountPct` is also written to the booking doc as a separate
field (line 453) — easier to read if the local var were renamed
`appliedMemberDiscountPct` to avoid collision with the doc field.

---

### BF-21 — `BookingLookupPage` needs dedicated audit
**Status:** Open (deferred to a follow-up audit)
**File:** `guest-app/src/pages/BookingLookupPage.tsx` (625 lines)

Not fully read in this audit. High risk: this is the public
booking-lookup endpoint for guest self-service via ref+email, and PII
exposure here is a regulatory concern (RA 10173). Recommend a focused
review of what fields are returned (does it include `paymentProofUrl`?
`discountIdPhotoUrl`?) and whether the rate limit + ownership check is
robust. (Server side: `bookings.ts:1182-1218` returns `guestEmail` and
`guestPhone`; client side: the lookup page displays them for the
guest to confirm.)

---

### BF-22 — `handleRoomAvailability` does a full `bookings` collection scan on every request
**Status:** **Fixed in `ffef46f`**
**File:** `guest-app/server/handlers/rooms.ts:71-93`

```ts
const overlapSnapshot = await adminDb
  .collection("bookings")
  .where("status", "in", ACTIVE_STATUSES)
  .get();
```

No `checkIn` / `checkOut` range filter is sent to Firestore — the
query reads *all* bookings in any active status, then filters in JS.
This is fine at <500 bookings, but the spec says this endpoint is the
UX layer for every Step 1 page load. Add a range filter:
```ts
.where("checkIn", "<", reqEnd)
.where("checkOut", ">", reqStart)
```
composited with `status in [...]` via `firestore.indexes.json`. Also
rate-limited at 30/IP/min, which masks the issue but at scale it's a
cost problem.

---

### BF-23 — Missing composite indexes will break at scale
**Status:** **Fixed in `ffef46f`**
**File:** `firebase/firestore.indexes.json` (currently `[]`)

The transaction in `handleCreateBooking:184-186, 216-218` does:
- `rooms where type == X and isActive == true` — composite index
  `(type ASC, isActive ASC)` needed.
- `bookings where roomId == X and status != "cancelled"` — composite
  index `(roomId ASC, status ASC)` needed, *and* `!=` is the documented
  case that requires an explicit index in Firestore.

These will throw `FAILED_PRECONDITION: The query requires an index` once
the `bookings` collection exceeds a few hundred docs. Add the indexes
to `firestore.indexes.json` and run `firebase deploy --only firestore:indexes`.

---

### BF-25 — Silent origin parse failure in `verifyTurnstile`
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/api/[...route].ts:160-170`

If `requestOrigin` is present but unparseable, `isProduction` stays
false and the test secret is used. Cosmetic; the bigger issue is BF-24.

---

### BF-27 — Hardcoded fallback dates / total in `BookingConfirmPage`
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/src/pages/BookingConfirmPage.tsx:29-30, 41`

```ts
const bookingRef = searchParams.get("bookingRef") ?? `SI-${new Date().getFullYear()}0612-042`;
const checkIn = searchParams.get("checkIn") ?? "2026-06-12";
const checkOut = searchParams.get("checkOut") ?? "2026-06-14";
const total = Number(searchParams.get("total") ?? 6400);
```

Cosmetic when the URL has the real values; misleading if the user lands
on the bare URL. **Same pattern in `BookingLookupPage.tsx`.**

**Fix:** if any required param is missing, show a friendly "No booking
details found — please re-confirm your booking" message instead of a
hardcoded placeholder.

---

### BF-28 — Client `roomTotal` (correct) ≠ client `total` (wrong)
**Status:** Open (covered by BF-08)
**File:** `guest-app/src/pages/BookingPage.tsx:235-276`

The `roomTotal` computed locally on lines 235-251 is correct
(per-night weekend substitution) but is *not* passed to
`calculateBookingTotal`; instead the function recomputes from a flat
`ratePerNight * numNights`. So the per-night values in the breakdown add
up to one number, and the `Total` line shows a different number.

**Fix:** rolled into BF-08.

---

### BF-29 — Inline regex instead of Zod
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/src/pages/BookingPage.tsx:297`

```ts
email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestDetails.email) ? "" : "Enter a valid email address.",
```

Zod (already a dependency, see `BookingFormSchema` available in
`shared/schemas/booking.ts`) is not used. The spec
(`plan/docs/FRONTEND.md`) prefers Zod with proper email validation.
Inline regex is a soft fail mode.

**Fix:** wire the existing `GuestDetailsSchema` from
`shared/schemas/booking.ts` for inline validation.

---

### BF-30 — Two-state file/url pattern in upload widgets
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/src/pages/BookingPage.tsx:165-171`

```ts
const [discountIdFile, setDiscountIdFile] = useState<string | null>(null);
const [discountIdUrl, setDiscountIdUrl] = useState<string | null>(null);
```

If a user clicks "Delete" mid-upload, state can desync. Not a real
issue at this UX, but the pattern of storing filename in state
(separate from the URL) is a footgun. Same pattern for
`paymentProofFile` / `paymentProofUrl`.

**Fix:** derive the filename from the URL (`url.split("/").pop()`) or
collapse the two states into one record `{name, url} | null`.

---

### BF-31 — Stale tab loses consent on remount
**Status:** ✓ No fix needed (working as designed)
**File:** `guest-app/src/pages/BookingPage.tsx:103, 144`

Preallocated `bookingId` is generated only at mount, and `consent` is
seeded to `false`. If a user reopens the tab the consent may have been
checked; new mounts start fresh. Expected behavior, just noting it. (No
fix needed; the Step 2 form re-validates.)

---

### BF-32 — Token-verify failure silently downgrades to anonymous
**Status:** **Fixed in `ffef46f`**
**File:** `guest-app/server/handlers/bookings.ts:138-152`

```ts
} catch (err) {
  // Invalid/expired token — fall through to anonymous booking
}
```

A 500 from `adminAuth.verifyIdToken` (e.g. quota exceeded, network blip)
is silently treated as "no member". A logged-in member who hits a
transient Firebase Auth error gets an anonymous booking with no member
discount and `memberId: null`. No retry, no log.

**Fix:** log at `warn` level so it's visible in Vercel logs. Optionally
rethrow on non-auth errors (quota, network) and surface a 503 to the
client so they can retry.

---

### BF-33 — Redundant post-filter on `isActive`
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/server/handlers/bookings.ts:188-195`

```ts
const candidatesSnapshot = await transaction.get(candidatesQuery);
const candidates = candidatesSnapshot.docs
  .map((d) => ({ id: d.id, data: d.data() }))
  .filter((c) => c.data && c.data.isActive !== false)
  .sort(...);
```

The query already says `where isActive == true`. The post-filter
`isActive !== false` is what handles the case where the query returns a
doc with `isActive === undefined` (true != undefined → true, included;
but query with `isActive == true` excludes those). Not a bug, but the
post-filter is the authoritative one — the query filter is redundant.
Tighten to one or the other.

**Fix:** drop the `where("isActive", "==", true)` from the query and
rely on the post-filter (cheaper index, covers both `true` and
`undefined`).

---

### BF-34 — Locale-aware sort
**Status:** ✓ Verified — no change needed.

`localeCompare(..., { numeric: true })` correctly sorts "10A" < "2A" ✓.

---

### BF-35 — Token verify behind rate limit
**Status:** ✓ Verified — no change needed.

The 5/min booking-create limit is applied at the route dispatcher
(line 252), before the token verify ✓.

---

### BF-36 — Lookup response includes guestEmail/Phone
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/server/handlers/bookings.ts:1201-1202`

```ts
guestEmail: bookingData.guestEmail,
guestPhone: bookingData.guestPhone,
```

The spec (`plan/docs/API-ROUTES.md:75-76`) describes
`/api/bookings/lookup` as a "guest-self-service" endpoint. The current
return is fine for the page UI (which needs to display them to the
guest for confirmation) but should be documented in `API-ROUTES.md` and
`BOOKING-FLOW.md` so it's an explicit decision rather than an
unintended leak. (RA 10173 right to be informed — the guest *is* the
data subject, so this is the right party to receive the data. Not a
leak in the strict sense.)

**Fix:** add to `API-ROUTES.md §bookings` and `BOOKING-FLOW.md §Lookup`.

---

### BF-37 — `emailNotificationsSent` not in TYPES.md schema
**Status:** **Fixed in `ffef46f`**
**File:** `plan/docs/TYPES.md:90-150`, `guest-app/server/handlers/bookings.ts:514-516`

`emailNotificationsSent.{staffNewBooking, staffNewPayment}` is read and
written by the handlers but not declared on the `Booking` type in
`TYPES.md`. Future schema generators / linters will miss it.

**Fix:** add to `TYPES.md §Booking` and the `shared/types/index.ts`
re-export.

---

### BF-38 — `/api/bookings/create` return shape matches spec
**Status:** ✓ Verified — no change needed.

Return includes `{bookingId, bookingRef, roomId, roomNumber, roomType}` ✓.
`roomName` is included in `computedData` but not in the response
payload — the spec doesn't require it and the confirmation page joins
from `roomType` client-side ✓.

---

### BF-40 — Voucher increment atomic
**Status:** ✓ Verified — no change needed.

`bookings.ts:347-350` increments `usageCount` inside the transaction ✓.
`handleValidateVoucher` does not increment (only checks); if the
booking creation later fails, the usage has not been consumed (good).
If the booking creation succeeds, the transaction has incremented
(good).

---

### BF-41 — Date math correct
**Status:** ✓ Verified — no change needed.

`bookings.ts:103-113` — for a 1-night stay, `endMs - startMs = 86400000ms`
→ `numNights = 1` ✓. Manila timezone is handled correctly via
`getManilaDateInfo` (line 53-65) ✓.

---

### BF-42 — Manila-date logic duplicated
**Status:** **Open (deferred — non-trivial refactor; see index)**
**File:** `guest-app/server/handlers/bookings.ts:53-65, 669`,
`guest-app/server/handlers/reference.ts`

`getManilaDateInfo` is duplicated between `handleCreateBooking` and
`handleCreateWalkin`. Should be a shared utility in
`shared/utils/bookingDates.ts` (already exists — add `getManilaDateInfo`
there).

**Fix:** move to `shared/utils/bookingDates.ts` and import from both
handlers + the reference route.

---

### BF-43 — Walkin has no honeypot
**Status:** ✓ Verified — no change needed.

`/api/bookings/create-walkin` is staff-authenticated so honeypot is
unnecessary ✓.

---

### BF-44 — Honeypot echoes bot's preallocated id
**Status:** **Fixed in `403e9a4`**
**File:** `guest-app/api/[...route].ts:262`

```ts
data: {
  bookingId: req.body.bookingId || "hp_" + Math.random().toString(36).substring(2, 9),
  ...
}
```

If the bot sends a real preallocated `bookingId` as the honeypot, the
API echoes it back in the fake success. The bot now has a known ID.

**Fix:** always return a fresh random fake ID regardless of what the
bot sent.

---

### BF-45 — `paymentProofUrl: ""` vs `null` inconsistency
**Status:** **Open (deferred — covered by broader Booking-schema refactor)**
**File:** `guest-app/server/handlers/bookings.ts:446`

`paymentProofUrl: paymentProofUrl || ""` (line 446) — `TYPES.md:121`
declares `paymentProofUrl: string` not `string | null`. Both empty
string and `null` are passed elsewhere in the handler
(`discountIdPhotoUrl: discountIdPhotoUrl || null`, line 432). Pick one.

**Fix:** standardize on `null` for "no proof uploaded" (matches the
rest of the schema: `discountIdPhotoUrl`, `guestIdPhotoUrl`,
`paymentProofUrl` are all `string | null` in the type).

---

### BF-47 — Walkin capacity check dead post-migration
**Status:** Open (covered by BF-02)
**File:** `guest-app/server/handlers/bookings.ts:614`

Same fix as BF-02.

---

### BF-48 — Member check server-authoritative
**Status:** ✓ Verified — no change needed.

`bookings.ts:142-148` checks `m.isMember !== false && m.isActive !== false`
on the server; the client just checks `!!memberProfile` for UX ✓.

---

### BF-49 — `emailNotificationsSent` not in TYPES schema
**Status:** Open (same as BF-37)

---

### BF-50 — Preallocated ID per page visit
**Status:** **Open (deferred — janitor cleanup requires non-trivial scheduling without Cloud Functions; see index)**
**File:** `guest-app/src/pages/BookingPage.tsx:103`,
`guest-app/src/pages/CorporateBookingPage.tsx:73`

```ts
const [bookingId] = useState(() => doc(collection(db, "bookings")).id);
```

Every page visit creates a candidate Firestore doc ID. If 10k users hit
`/book` and abandon, you have 10k "tombstone" IDs. Not a bug, but be
aware: the storage paths `bookings/{bookingId}/payment-proof/...` and
`bookings/{bookingId}/discount-id/...` are reserved for the lifetime
of the client tab and may never be filled. A janitor that deletes
empty Storage subfolders after 24h would help.

---

## SEV-4 — Nit (1)

### BF-06 — Vercel function count budget is fine
**Status:** ✓ Verified — no change needed.

`vercel.json` + `guest-app/api/[...route].ts` co-locates every route
into a single serverless function (per
`plan/docs/VERCEL-FUNCTION-LIMIT.md`). The Hobby plan's 12-function
cap is comfortable. `guest-app/api/.gitkeep` plus only `[...route].ts`
is correct — do not add per-route files.

---

## Findings index (sorted by ID)

| ID | Sev | Title | File:line | Status |
|---|---|---|---|---|
| BF-01 | S1 | `adminAuth` used but not imported → Spark Rewards members cannot book | `guest-app/server/handlers/bookings.ts:1,139` | **Fixed in `8891dce`** (adminAuth import added + `bookings-member-discount.test.ts` rewritten as behavioral, 5 new tests) |
| BF-02 | S1 | Walkin reads dead room fields → ₱0 walk-ins | `guest-app/server/handlers/bookings.ts:614,648-651` | **Fixed in `8891dce`** (type-entry lookup added + 6 new tests in `bookings-walkin-roomtype.test.ts`) |
| BF-03 | S1 | Preallocated `bookingId` `set` clobbers on retry | `guest-app/server/handlers/bookings.ts:473-474` | **Fixed in `8891dce`** (existence check in both create + walkin; covered by `bookings-staff-email-dedup.test.ts` "re-submitting the same bookingId is rejected") |
| BF-04 | S1 | `staff-new-booking` email dedup logic is broken | `guest-app/server/handlers/bookings.ts:512-527` | **Fixed in `8891dce`** (re-reads the booking doc after commit; 3 new tests in `bookings-staff-email-dedup.test.ts`; `batch-10-email-extensions.test.ts` regex updated to match the new pattern) |
| BF-05 | S1 | `originalTotalPrice` stored wrong on Senior/PWD-only | `guest-app/server/handlers/bookings.ts:392,791-794` | **Fixed in `8891dce`** (now stores full `subtotal`; `handleRejectDiscount` subtracts the voucher; 4 new tests in `bookings-reject-discount.test.ts`) |
| BF-06 | S4 | Vercel function count budget is fine | `guest-app/api/[...route].ts` | ✓ Verified |
| BF-07 | S3 | Voucher error map is dead code | `guest-app/src/pages/BookingPage.tsx:53-58,537-538` | **Fixed in `ffef46f`** |
| BF-08 | S2 | Client `total` shown to guest ≠ server `totalPrice` (weekend) | `BookingPage.tsx:265-276`, `CorporateBookingPage.tsx:286-294` | **Fixed in `31ca546`** (`calculateBookingTotal` now accepts a pre-computed `roomTotal`; 2 new tests in `pricing.test.ts`; both pages pass `roomTotal` explicitly) |
| BF-09 | S2 | Discount-rejection total math off | `bookings.ts:392`, `email.ts:360` | **Covered by BF-05** (rolled into the BF-05 fix in batch 1) |
| BF-10 | S2 | PayPal option never exposed | `BookingPage.tsx:1034-1084` | **Fixed in `31ca546`** (PayPal added as a 4th payment method with its own instructions panel; type widened to include `"paypal"`) |
| BF-11 | S2 | `BookingConfirmPage` ICS filename hardcodes `spark-inn-` | `BookingConfirmPage.tsx:73` | **Fixed in `31ca546`** (filename now `${bookingRef}.ics`; brand name lives in the event title) |
| BF-12 | S2 | Hotel name / numbers hardcoded as payment-instruction fallbacks | `BookingPage.tsx:1092-1133` | **Fixed in `31ca546`** (GCash + Bank fallbacks now use `config.legalName` / `config.frontDeskPhone`; QR placeholder shows a "not yet configured" message instead of a hardcoded URL; bank "BPI"/"1234-5678-90" hardcodes removed) |
| BF-13 | S3 | Lookup has correct case-insensitive fallback | `bookings.ts:1148-1167` | ✓ Verified |
| BF-14 | S2 | Racy `addPayment` totalPaid read | `bookings.ts:920-950` | **Fixed in `a441b82`** |
| BF-15 | S2 | `confirmedBy` / `discountRejectedBy` are emails, not UIDs | `bookings.ts:798,984,1006` | **Fixed in `a441b82`** |
| BF-16 | S2 | Self-cancel blocked for `confirmed` and `payment-confirmed` | `bookings.ts:870` | **Fixed in `a441b82`** |
| BF-17 | S3 | Corporate-code lookup server-authoritative | `bookings.ts:259-292` | ✓ Verified |
| BF-18 | S3 | Voucher `applicableRoomTypes` uses `roomData.type` (post-assignment) | `bookings.ts:335` | **Fixed in `ffef46f`** |
| BF-19 | S3 | Redundant `applicableRoomTypes` guard | `bookings.ts:335` | **Fixed in `403e9a4`** |
| BF-20 | S3 | Stacking var names mislead | `bookings.ts:382-392` | **Fixed in `403e9a4`** |
| BF-21 | S3 | `BookingLookupPage` needs dedicated audit | `BookingLookupPage.tsx` | Open (deferred) |
| BF-22 | S3 | `handleRoomAvailability` does a full collection scan | `rooms.ts:71-93` | **Fixed in `ffef46f`** |
| BF-23 | S3 | Missing composite indexes will break at scale | `firestore.indexes.json` | **Fixed in `ffef46f`** |
| BF-24 | S1 | Turnstile test-key fallback in non-allowlisted origins | `[...route].ts:146-179` | **Fixed in `8891dce`** (production-without-secret now fails closed; origin check tightened) |
| BF-25 | S3 | Silent origin parse failure in `verifyTurnstile` | `[...route].ts:160-170` | **Fixed in `403e9a4`** |
| BF-26 | S2 | Hardcoded breakfast rate `350` / `enabled: true` in `BookingPage` | `BookingPage.tsx:46-47` | **Fixed in `a441b82`** |
| BF-27 | S3 | Hardcoded fallback dates / total in `BookingConfirmPage` | `BookingConfirmPage.tsx:29-30,41` | **Fixed in `403e9a4`** |
| BF-28 | S3 | Client `roomTotal` (correct) ≠ client `total` (wrong) | `BookingPage.tsx:235-276` | **Covered by BF-08** (rolled into batch 1) |
| BF-29 | S3 | Inline regex instead of Zod | `BookingPage.tsx:297` | **Fixed in `403e9a4`** |
| BF-30 | S3 | Two-state file/url pattern in upload widgets | `BookingPage.tsx:165-171` | **Fixed in `403e9a4`** |
| BF-31 | S3 | Stale tab loses consent on remount | `BookingPage.tsx:103,144` | ✓ No fix |
| BF-32 | S3 | Token-verify failure silently downgrades to anonymous | `bookings.ts:138-152` | **Fixed in `ffef46f`** |
| BF-33 | S3 | Redundant post-filter on `isActive` | `bookings.ts:188-195` | **Fixed in `403e9a4`** |
| BF-34 | S3 | Locale-aware sort | `bookings.ts:191-195` | ✓ Verified |
| BF-35 | S3 | Token verify behind rate limit | `[...route].ts:252,138` | ✓ Verified |
| BF-36 | S3 | Lookup response includes guestEmail/Phone | `bookings.ts:1201-1202` | **Fixed in `403e9a4`** |
| BF-37 | S3 | `emailNotificationsSent` not in TYPES.md schema | `TYPES.md`, `bookings.ts:514-516` | **Fixed in `ffef46f`** |
| BF-38 | S3 | `/api/bookings/create` return shape matches spec | `bookings.ts:529-538` | ✓ Verified |
| BF-39 | S2 | Confirmation `total` from local calc, not server | `CorporateBookingPage.tsx:541` | **Fixed in `a441b82`** |
| BF-40 | S3 | Voucher increment atomic | `bookings.ts:347-350` | ✓ Verified |
| BF-41 | S3 | Date math correct | `bookings.ts:103-113` | ✓ Verified |
| BF-42 | S3 | Manila-date logic duplicated | `bookings.ts:53-65,669` | **Open** (deferred to a future batch — non-trivial refactor) |
| BF-43 | S3 | Walkin has no honeypot | `bookings.ts:550` | ✓ Verified |
| BF-44 | S3 | Honeypot echoes bot's preallocated id | `[...route].ts:262` | **Fixed in `403e9a4`** |
| BF-45 | S3 | `paymentProofUrl: ""` vs `null` inconsistency | `bookings.ts:446` | **Open** (deferred — covered by the broader Booking-schema refactor tracked separately) |
| BF-46 | S1 | Walkin capacity check dead post-migration (same as BF-02) | `bookings.ts:614` | **Covered by BF-02** (rolled into batch 1) |
| BF-47 | S3 | (placeholder) | — | — |
| BF-48 | S3 | Member check server-authoritative | `bookings.ts:142-148` | ✓ Verified |
| BF-49 | S3 | `emailNotificationsSent` not in TYPES schema (same as BF-37) | `TYPES.md` | **Covered by BF-37** (rolled into batch 2) |
| BF-50 | S3 | Preallocated ID per page visit | `BookingPage.tsx:103` | **Open (deferred — janitor cleanup is non-trivial without Cloud Functions; see BF-50 below)** |

---

## Suggested fix order

**PR 1 — "Member bookings + walk-in migration"** (BF-01, BF-02, BF-04)
- Highest blast radius. Each is a single-file or near-single-file edit.
- BF-01 unblocks every Spark Rewards member from booking. Closes the
  `server/`-folder typecheck gap as a side effect.
- BF-02 fixes a silent ₱0 booking bug once the W3.6/W3.7 backfill runs.
- BF-04 fixes duplicate-staff-email on every retry.

**PR 2 — "Booking-write integrity"** (BF-03, BF-15, BF-22, BF-23)
- BF-03 makes the booking-create transaction truly idempotent.
- BF-15 fixes the audit-trail UID/email confusion.
- BF-22 + BF-23 are the Firestore indexes that have to ship before
  traffic ramps.

**PR 3 — "Money math client/server parity"** (BF-08, BF-26, BF-28,
BF-39)
- All the "what the guest sees vs what they pay" bugs.
- BF-26 and BF-08 are the same root cause; fix together.

**PR 4 — "Spec drift cleanup"** (BF-10, BF-11, BF-12, BF-44, BF-45,
BF-37/BF-49)
- White-label compliance + schema hygiene.

**PR 5 — "Polish"** (BF-07, BF-18, BF-19, BF-20, BF-21, BF-25, BF-27,
BF-29, BF-30, BF-32, BF-33, BF-36, BF-42, BF-50, BF-14, BF-16)
- Most are single-line or single-function edits.
- BF-14 and BF-16 are the only ones that might need a spec change.

---

## Status legend

- **Open** — finding is documented; no commit references the fix yet.
- **In progress** — a `fix/audit-bf-NN-*` branch is open.
- **Fixed in `<hash>`** — commit on `origin/dev` closes the finding; the
  commit body should reference `Closes BF-NN` and this row should be
  updated with the hash.
- **✓ Verified** — audited and confirmed correct; no fix needed.
- **Decision needed** — needs a spec or product decision before
  implementing; the BF should be added to
  `plan/project/AUDIT-OPEN-QUESTIONS-2026-06-26.md` (create if not yet
  present).

---

## How to use this doc

1. **Triage** — when a new commit closes a finding, update the row in
   the index above with `Fixed in <hash>` and a short note of the fix.
2. **New findings** — append at the end of the appropriate severity
   section. Use the next `BF-NN` number. Match the row format:
   `**Status:** / **File:** / **Related decisions:** / body / **Fix:**`.
3. **Cross-references** — when a finding rolls into another (e.g. BF-28
   into BF-08), note "rolled into BF-NN" in the Fix section.
4. **Branch naming** — per `CONTRIBUTING.md:63` audit fix branches use
   the audit ID: `fix/audit-bf-03-preallocated-id-set`.
5. **Commit bodies** — reference the BF number for grep-ability:
   `Closes BF-04 (staff-new-booking email dedup)`.

---

## Out of scope (deferred to other audits / future work)

- **BookingLookupPage** (BF-21) — dedicated audit pass for the
  guest self-service lookup path. RA 10173 implications.
- **Admin booking drawer** (`admin-app/src/pages/BookingsPage.tsx`) —
  not touched in this audit. Follow-up audit.
- **Store-order email dedup** — the store-order handlers were not in
  scope for this audit but use a similar `emailNotificationsSent`
  pattern; cross-check when reviewing the store flow.

---

*Generated 2026-06-26. No code changes shipped. Successor to
`AUDIT-E2E-2026-06-15.md` for the booking-flow drill-down.*
