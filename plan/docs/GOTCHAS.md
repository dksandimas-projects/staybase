# Gotchas
> Requires: CLAUDE.md

Things agents must never do. Check this file before implementing any feature.

---

## Firebase

- **Always unsubscribe `onSnapshot` listeners** — return the unsubscribe function from `useEffect` cleanup. Failing to do so causes memory leaks and duplicate updates.
- **Never read-then-write for booking creation** — always use a Firestore transaction. The client's prior system had real overbooking incidents. See `plan/features/AVAILABILITY-LOCKING.md`.
- **Never re-initialize Firebase** — call `initializeApp` once in `firebase/config.ts`. Use `getFirestore()`, `getAuth()`, `getStorage()` everywhere else.
- **Never expose Firebase Admin SDK credentials client-side** — Admin SDK lives in `api/` only.
- **Always configure `cors.json` for Firebase Storage** before any file upload feature goes live — uploads will silently fail otherwise.
- **Firestore security rules block unexpected reads** — test rules in the Firebase emulator before deploying. A rule that looks correct in isolation may block legitimate reads.
- **Never deploy `firebase/firestore.rules` or `firebase/storage.rules` to a live project ahead of the app build that depends on them** — rules and client ship together, or rules ship second. Tightened rules against an older deployed client silently break guest flows with permission-denied errors (INC-01, 2026-07-17: staff-only Storage reads broke the old app's post-upload `getDownloadURL`, blocking online-payment bookings, and staff-only message creates killed guest intercom). Before any rules deploy, confirm the live app build already contains the matching client changes.

---

## Auth & Security

- **Never trust `isCorporate`, `corporateCode`, or role claims from the client** — always verify server-side via API route with Firebase Admin SDK.
- **Never validate voucher or corporate access codes client-side only** — always call the validation API route. Client-side validation is for UX feedback only; server-side is authoritative.
- **Never allow public registration for admin/front-desk accounts** — admin creates all staff accounts manually.
- **Always verify Firebase ID token in API routes** — use `Authorization: Bearer <token>` header and verify with Admin SDK before processing any authenticated request.
- **Never match or link a booking to a member by the token's `email` claim without checking `email_verified`** — Firebase email/password signup lets a user claim an arbitrary, unverified email. Any code that grants booking access based on `guestEmail == token.email` (registration `linkBookingsByEmail`, `/api/members/stays`, `/api/email/early-checkin-request` `findBooking`) must require `decodedToken.email_verified === true` first, or an attacker who registers with a stranger's email can link, read (the stays projection leaks `bookingRef` + `lookupToken` = the public cancel credential), and act on that stranger's bookings (Spark Rewards audit 2026-07-18, HIGH-1). Matching by `memberId == token.uid` is always safe; only the email path needs the `email_verified` gate.

---

## npm Workspaces & Shared Code

- **`shared/` is an npm workspace package (`@spark-inn/shared`)** — always import from the package name, never via relative paths like `../../shared/types`. Relative imports break when files move.
- **`api/` handlers run in Node.js, not Vite** — they cannot use Vite path aliases. Import `@spark-inn/shared` via the workspace package (works in Node.js), and import `hotel.config.ts` via relative path (`../../hotel.config.ts`).
- **`@spark-inn/shared` ships raw `.ts` source (its `package.json` `exports` point directly at `.ts` files)** — fine for Vite, which transpiles it natively, but Vercel's Node.js Function builder does **not** transpile TypeScript reached through `node_modules`/workspace packages, only the `api/*.ts` entry point itself. Any server code that imports `@spark-inn/shared` must go through the esbuild bundle described in `plan/docs/VERCEL-FUNCTION-LIMIT.md` — do not add a second, unbundled import path into `@spark-inn/shared` from anywhere Vercel compiles directly.
- **guest-app's real API router lives at `guest-app/server/apiRouter.ts`, not `guest-app/api/[...route].ts`** — `guest-app/api/[...route].js` is a **committed, build-generated bundle** (run `npm run build:api -w guest-app` and commit the result after changing `server/apiRouter.ts`, any `server/handlers/*`, `server/lib/*`, or `@spark-inn/shared`). Never gitignore it — Vercel's function-detection for `api/` does not see build-generated files that aren't in the git checkout, confirmed during the 2026-07-01/02 outage (see `plan/docs/VERCEL-FUNCTION-LIMIT.md`). Never add a `.ts` file back at `guest-app/api/[...route].ts` — a `.ts`/`.js` pair at the same path is a Vercel build error.
- **The pre-commit API-bundle check is mandatory** — staged changes under `guest-app/server/` or `shared/` trigger `npm run check:api-bundle`, which independently rebuilds to a temporary file and rejects a stale or unstaged `guest-app/api/[...route].js`. Do not bypass the hook; it prevents source fixes from being absent in Vercel's deployed function.
- **Never add files under `guest-app/api/` other than the committed `[...route].js` bundle** — Vercel treats every `.ts` / `.js` file in `api/` (and subdirs) as a separate serverless function. Hobby plan caps at 12. Handlers, lib, and tests all live outside `api/` (`server/` and `tests/api/`). See `plan/docs/VERCEL-FUNCTION-LIMIT.md`.
- **Never set `"type": "module"` in `guest-app/package.json`** — causes every deployed `/api/*` request to crash with `ERR_REQUIRE_ESM` (Vercel's Node builder emits CJS-style `require()` between compiled files).
- **`api/tsconfig.json` at the repo root must keep `"allowJs": true`** — the repo-root `api/[...route].ts` shim (`export { default } from "../guest-app/api/[...route]"`) resolves to a `.js` file; without `allowJs`, `tsc` throws `TS7016` and Vercel silently drops the function (404, no build error surfaced).
- **Always run `npm install` from the repo root** — not from inside individual app folders. The root `package.json` manages all workspace dependencies together.
- **Never add `@spark-inn/shared` to `devDependencies`** — it must be in `dependencies` so Vercel can resolve it during deployment.

## Vite & TypeScript

- **Never use `process.env` in Vite apps** — use `import.meta.env.VITE_*` instead.
- **Only `VITE_`-prefixed variables are exposed to the browser** — never prefix server secrets with `VITE_`.

---

## React 19

- **No `forwardRef` needed** — in React 19, pass `ref` as a regular prop directly to components.
- **No `useEffect` for derived state** — compute it inline or with `useMemo` instead.

---

## jsPDF (Receipts & PDFs)

- **Use stable jsPDF fonts unless custom TTFs are verified** — jsPDF cannot access system fonts, and unverified OTF/missing TTF assets can break generation. Use built-in fonts for reliability unless known-good base64 TTF assets are added and visually tested.
- **Test PDF output on multiple browsers** — rendering differences between Chrome, Firefox, and Safari can cause layout shifts in generated PDFs.

---

## Payments & Uploads

- **Payment proof uploads go to Firebase Storage** — store the download URL in the booking document's `paymentProofUrl` field.
- **Booking upload paths use a preallocated Firestore booking ID** — the client may reserve a `bookings/{bookingId}` document ID before Step 3 uploads, but `/api/bookings/create` must create that exact document inside the transaction. The guest-facing `bookingRef` is still generated server-side inside the transaction.
- **Never store raw file blobs in Firestore** — Firestore has a 1MB document size limit. Always use Firebase Storage for files.
- **Compress images before upload** — use the shared `compressImageFile()` utility for room photos, IDs, payment proofs, QR images, store item photos, and website content photos so uploads stay readable but efficient.

---

## Intercom (Web Audio API)

- **Notification sound requires a user gesture to unlock** — browser autoplay policy blocks audio until the user has interacted with the page. Unlock on first click after login. Do not play sound on page load.
- **Only play notification sound when the inbox tab is not focused** — do not alert staff who are actively viewing the inbox.
- **`Permissions-Policy` must keep `microphone=(self)` in every `vercel.json` (root, guest-app, admin-app)** — an empty allowlist (`microphone=()`) denies `getUserMedia` for the page's own origin, which silently kills the intercom WebRTC voice call in production while it keeps working in local dev (no headers there). Camera and geolocation stay fully locked (BI-06, booking-intercom audit 2026-07-06).

---

## Booking Flow

- **Always lock rate at booking time** — store `ratePerNight` in the booking document at the moment of creation. Never recompute from current room rates after booking.
- **Discount IDs are verified at check-in** — the system applies the discount at booking time on guest's honor; staff verifies ID physically. Do not build ID verification into the booking flow.

---

## Security & PII

- **Never log PII** — no `console.log(guestEmail)`, `console.log(guestName)`, or similar in any environment. Logs may be stored by Vercel and are accessible to anyone with project access.
- **Never expose payment proof URLs in guest-app** — `paymentProofUrl` is admin-only. Never include it in guest-facing API responses or Firestore queries from guest-app.
- **Never expose `remarks` field to guest-app** — room remarks are internal staff notes only. Filter before returning room data to guests.
- **Never create booking documents directly from the client** — public online/corporate bookings go through `/api/bookings/create`, and staff walk-ins go through authenticated `/api/bookings/create-walkin`. Direct client creates bypass the availability transaction and security checks. Authenticated staff/admin may still update existing booking documents directly for ordinary operational fields permitted by Firestore rules.
- **Never subscribe to or query the `bookings` collection from the guest client** — Firestore rules deny guest reads (`allow read: if isStaff()`). For Step 1 availability UX on the booking page, call `GET /api/rooms/availability?checkIn=...&checkOut=...` (PII-stripped, rate-limited). The actual double-booking prevention is the Firestore transaction in `/api/bookings/create`; the availability endpoint is a UX optimization only. See `plan/features/AVAILABILITY-LOCKING.md §Guest-side availability UX query`.
- **Never create corporate inquiry documents directly from the guest client** — public inquiry submissions must go through `/api/corporate/inquiry` so Turnstile, honeypot, validation, rate limiting, and staff notifications run server-side.
- **Never create Spark Rewards member documents directly from the guest client** — enrollment must go through `/api/members/register` so `memberNumber` is generated server-side and past booking linkage runs consistently.
- **Never change `members/{uid}.rewardsPoints` without a coupled `pointsHistory` entry in the same transaction** — the balance behaves like money; the invariant is `rewardsPoints == sum(pointsHistory.points)`. All server paths (checkout earn, settlement earn, `/api/members/redeem-points`, `/api/members/undo-redemption`) already do this and use deterministic history IDs (`earn-{bookingId}`) so a retry can't double-credit. The manual-adjustment path is still a client-side Firestore transaction, which forces the `members` update rule to allow `isStaff()` to write `rewardsPoints` directly (Spark Rewards audit 2026-07-18, MED-1) — meaning a stray client write could set a balance with no history entry. Preferred direction: move manual adjustment server-side and lock `rewardsPoints` to Admin-SDK-only writes in `firestore.rules`. Until then, never add a second client-side writer of `rewardsPoints`, and keep manual adjustment's member-update + `pointsHistory.add` inside one `runTransaction`.
- **Never trust client-supplied role, `isCorporate`, or `corporateCode`** — always derive from server-side token verification or Firestore lookup.
- **Booking lookup requires BOTH ref AND email** — never return booking data on ref alone. Prevents enumeration attacks.
- **Do not share PII via intercom chat** — staff must use the booking system for sensitive information. Intercom is open and unencrypted at rest.
- **Rate limit public API endpoints** — voucher validation, corporate code validation, and booking creation are unauthenticated and must be rate-limited to prevent abuse.
- **Firebase Storage payment proof files are not public** — Storage rules must restrict read access to authenticated staff. A leaked URL without proper rules gives anyone access.
- **Consent checkbox is required at booking Step 2** — do not allow booking submission without it. Links to `/privacy` and `/terms` pages.
- **Honeypot field must be hidden via CSS, not `display:none`** — bots detect and skip `display:none` fields. Use `position: absolute; opacity: 0; pointer-events: none` instead.
- **Honeypot rejection must be silent** — return `200` with a fake success response when honeypot is filled. Never return an error that reveals the anti-bot mechanism.
- **Turnstile token must be verified server-side** — client-side Turnstile rendering is not enough. Always POST the token to Cloudflare's verification endpoint in the API route before processing any request.
- **Never block a request on Turnstile verification failure with a technical error** — show a user-friendly "Something went wrong, please try again" message.
- **Turnstile bypasses are `NODE_ENV === "test"` only** — never accept sentinel tokens (`mock_token`, Cloudflare dummy tokens) in the API route outside unit tests, and never add client-side `|| "mock_token"` fallbacks. Both shipped once and made every bot gate decorative in production (BI-02, booking-intercom audit 2026-07-06). Local dev needs no bypass: non-production origins verify against Cloudflare's always-pass test secret.
- **Turnstile tokens are single-use** — reset the widget (`useTurnstileToken().reset()`) after every request that sent the token to siteverify, or the next submit fails with a duplicate-token error.
- **Render Turnstile through `useTurnstileToken` with a correct `enabled` gate** — never inline the widget mount in a page effect with `[]` deps; if the container div is conditionally rendered (step-gated forms, loading skeletons), an effect that bails on a null ref will never render the widget (BI-03). And never render a fake "verified" panel without a live widget behind it (BI-01).

---

## White-Label

- **Never hardcode hex color values in components** — always use Tailwind tokens (`primary`, `primary-dark`, `sidebar`). Hardcoded hex values break rebranding for other hotel clients.
- **Never hardcode logo filenames** — always use `config.logos.navbar`, `config.logos.white`, etc. Different clients have different filenames.
- **Never hardcode `spark inn` or any hotel name in UI copy** — always use `config.brandName`. Copy that reads "spark inn" in code will ship as "spark inn" for every client.
- **Never hardcode room count** — room count is dynamic from Firestore. Do not write `Array(14)` or similar anywhere.
- **`hotel.config.ts` is deploy-time, not runtime** — changes require a redeploy. It is not the same as `settings/hotelConfig` in Firestore which is runtime-editable.
- **`public/brand/` filenames must match `hotel.config.ts → logos` paths exactly** — a mismatch causes broken images with no build-time error.
- **Never hardcode room type strings** like `"single"` or `"executive"` in UI components — always iterate the active dynamic room types from context (admin app uses `roomTypes` from `AdminContext`, guest app uses `DEFAULT_ROOM_TYPES` from `@spark-inn/shared`). Hardcoded strings will be wrong for every non-Spark Inn client.
- **Never hardcode `₱`, `PHP`, `Asia/Manila`, `en-PH`, or `+63`** — use `config.currencySymbol`, `config.currency`, `config.timezone`, `config.locale`, `config.phoneCountryCode`.
- **Never hardcode `SI-` booking reference prefix** — use `config.bookingRefPrefix`.
- **`hotel.config.ts` is not editable at runtime** — it requires a redeploy. Do not instruct hotel admins to edit it. Runtime-editable content goes in Firestore Settings.
- **Cancellation policy and house rules come from Firestore, not config** — fetch from `settings/websiteContent` at runtime so hotel admins can update without DK.

---

## General

- **Never commit `.env` files** — all three are gitignored (`guest-app/.env`, `admin-app/.env`, `api/.env`).
- **Never add code snippets to MD files** — MDs are high-level specs only. Code lives in the codebase.
- **`FIREBASE_PRIVATE_KEY` in `api/.env` contains literal `\n` characters** — use `.replace(/\\n/g, '\n')` when initializing the Firebase Admin SDK, or the key will be malformed.
- **Brand name is always `spark inn`** — all lowercase. Never "Spark Inn" or "SPARK INN" in any UI copy.
- **Never add a granular `allow get: if true` (or `allow list`) next to a staff-only `allow read` in Storage rules** — allows are OR'd, so the public grant wins and the staff restriction becomes decorative. This shipped once on the payment-proof and discount-ID paths, making government-ID photos fetchable without auth (X-01, E2E audit 2026-07-17). If an anonymous uploader needs a preview, use a local blob URL client-side; mint download URLs server-side with the Admin SDK.
- **Never read `pricePerNight`, `weekendRate`, `corporateRate`, `maxCapacity`, `bedDefinition`, `description`, or `amenities` from a room document** — they moved to the RoomType entry in `settings/hotelConfig.roomTypes[]` (W3.6/W3.7). Reading them from `rooms/{id}` yields `undefined`, which silently prices bookings at ₱0 and disables capacity checks (C-01, E2E audit 2026-07-17). Always resolve the type entry (server: read `settings/hotelConfig` in the transaction; client: `useRoomTypes` helpers).
- **Never Zod-validate only part of a public API request body** — validate the entire body, including top-level scalar fields, with one strict schema. `/api/bookings/create` once validated only the nested `guestDetails` object while the top-level `guests` count reached price math unvalidated, letting negative/non-numeric values manipulate `totalPrice` (G-01, E2E audit 2026-07-17). Numeric fields that feed pricing must be validated as finite, integral, and range-bounded server-side.
