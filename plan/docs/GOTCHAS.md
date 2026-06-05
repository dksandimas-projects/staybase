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

---

## Auth & Security

- **Never trust `isCorporate`, `corporateCode`, or role claims from the client** — always verify server-side via API route with Firebase Admin SDK.
- **Never validate voucher or corporate access codes client-side only** — always call the validation API route. Client-side validation is for UX feedback only; server-side is authoritative.
- **Never allow public registration for admin/front-desk accounts** — admin creates all staff accounts manually.
- **Always verify Firebase ID token in API routes** — use `Authorization: Bearer <token>` header and verify with Admin SDK before processing any authenticated request.

---

## npm Workspaces & Shared Code

- **`shared/` is an npm workspace package (`@spark-inn/shared`)** — always import from the package name, never via relative paths like `../../shared/types`. Relative imports break when files move.
- **`api/` handlers run in Node.js, not Vite** — they cannot use Vite path aliases. Import `@spark-inn/shared` via the workspace package (works in Node.js), and import `hotel.config.ts` via relative path (`../../hotel.config.ts`).
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

- **Apollo and Inter fonts must be embedded as base64** — jsPDF cannot access system fonts. Failure to embed fonts results in garbled or missing text in generated PDFs.
- **Test PDF output on multiple browsers** — rendering differences between Chrome, Firefox, and Safari can cause layout shifts in generated PDFs.

---

## Payments & Uploads

- **Payment proof uploads go to Firebase Storage** — store the download URL in the booking document's `paymentProofUrl` field.
- **Never store raw file blobs in Firestore** — Firestore has a 1MB document size limit. Always use Firebase Storage for files.
- **Compress images before upload** — use the shared `compressImageFile()` utility for room photos, IDs, payment proofs, QR images, store item photos, and website content photos so uploads stay readable but efficient.

---

## Intercom (Web Audio API)

- **Notification sound requires a user gesture to unlock** — browser autoplay policy blocks audio until the user has interacted with the page. Unlock on first click after login. Do not play sound on page load.
- **Only play notification sound when the inbox tab is not focused** — do not alert staff who are actively viewing the inbox.

---

## Booking Flow

- **Always lock rate at booking time** — store `ratePerNight` in the booking document at the moment of creation. Never recompute from current room rates after booking.
- **Discount IDs are verified at check-in** — the system applies the discount at booking time on guest's honor; staff verifies ID physically. Do not build ID verification into the booking flow.

---

## Security & PII

- **Never log PII** — no `console.log(guestEmail)`, `console.log(guestName)`, or similar in any environment. Logs may be stored by Vercel and are accessible to anyone with project access.
- **Never expose payment proof URLs in guest-app** — `paymentProofUrl` is admin-only. Never include it in guest-facing API responses or Firestore queries from guest-app.
- **Never expose `remarks` field to guest-app** — room remarks are internal staff notes only. Filter before returning room data to guests.
- **Never write booking documents directly from the client** — all booking creation goes through `/api/bookings/create`. Direct client writes bypass the availability transaction and security checks.
- **Never trust client-supplied role, `isCorporate`, or `corporateCode`** — always derive from server-side token verification or Firestore lookup.
- **Booking lookup requires BOTH ref AND email** — never return booking data on ref alone. Prevents enumeration attacks.
- **Do not share PII via intercom chat** — staff must use the booking system for sensitive information. Intercom is open and unencrypted at rest.
- **Rate limit public API endpoints** — voucher validation, corporate code validation, and booking creation are unauthenticated and must be rate-limited to prevent abuse.
- **Firebase Storage payment proof files are not public** — Storage rules must restrict read access to authenticated staff. A leaked URL without proper rules gives anyone access.
- **Consent checkbox is required at booking Step 2** — do not allow booking submission without it. Links to `/privacy` page.
- **Honeypot field must be hidden via CSS, not `display:none`** — bots detect and skip `display:none` fields. Use `position: absolute; opacity: 0; pointer-events: none` instead.
- **Honeypot rejection must be silent** — return `200` with a fake success response when honeypot is filled. Never return an error that reveals the anti-bot mechanism.
- **Turnstile token must be verified server-side** — client-side Turnstile rendering is not enough. Always POST the token to Cloudflare's verification endpoint in the API route before processing any request.
- **Never block a request on Turnstile verification failure with a technical error** — show a user-friendly "Something went wrong, please try again" message.

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
