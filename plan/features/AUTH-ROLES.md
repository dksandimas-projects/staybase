# Auth & Roles
> App: admin-app
> Requires: CLAUDE.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Login

## Overview

Firebase Email/Password authentication for all staff. No public registration — admin creates all accounts. Two roles: Front Desk and Admin. Roles stored as Firebase Auth custom claims and enforced both client-side (UI rendering) and server-side (API routes).

---

## UI Checklist

- [ ] Login page (`/login`) — email + password fields, Sign In button (Spark Orange), spark inn logo centered
- [ ] Error message for invalid credentials — friendly, not technical ("Incorrect email or password.")
- [ ] Loading state on Sign In button
- [ ] No "forgot password" link on login page — admin resets passwords manually
- [ ] No public registration link
- [ ] Redirect to `/` (dashboard) on successful login
- [ ] Redirect unauthenticated users from any protected route to `/login`
- [ ] Redirect authenticated users away from `/login` to `/`
- [ ] Role-restricted pages (Rates, Settings) show "Access denied" for Front Desk users — do not hide nav links, show restricted state instead

## Data & Logic Checklist

- [ ] Firebase Auth `signInWithEmailAndPassword` on form submit
- [ ] `onAuthStateChanged` listener in auth hook — unsubscribe on cleanup
- [ ] Role sourced from Firebase Auth custom claims (`claims.role`) — fetched via `getIdTokenResult(true)` after login
- [ ] Custom claims set by DK/admin via Firebase Admin SDK or Firebase Console — not settable client-side
- [ ] Auth state stored in React Context — available to all admin-app components
- [ ] Protected route wrapper — checks auth state before rendering, redirects to `/login` if unauthenticated
- [ ] Role check wrapper — checks `claims.role` before rendering admin-only pages
- [ ] Client-side role check for UI only — API routes always re-verify token server-side

## Roles

| Role | Value in claims | Pages accessible |
|---|---|---|
| Front Desk | `"front-desk"` | Dashboard, Bookings, Rooms, Reports, Corporate Inquiries, Intercom, QR Management |
| Admin | `"admin"` | All of the above + Rates, Settings |

## Edge Cases & States

- [ ] Session expired — Firebase Auth handles token refresh automatically; on hard expiry, redirect to login
- [ ] User disabled in Firebase Console — `onAuthStateChanged` fires with `null`, redirect to login
- [ ] Role claim missing — treat as front-desk (least privilege fallback)
- [ ] Network offline on login — show "Unable to connect. Check your internet connection."

## Manual QA

- [ ] Front desk account can log in and access dashboard
- [ ] Front desk account cannot access Rates or Settings — sees access denied state
- [ ] Admin account can access all pages
- [ ] Invalid credentials show error, not console error
- [ ] Unauthenticated access to `/bookings` redirects to `/login`
- [ ] After login, redirect goes to dashboard (not login page again)
- [ ] Logging out clears auth state and redirects to `/login`

## References

- Firebase Auth setup: `plan/docs/BACKEND.md §Firebase SDK Usage`
- Role-based rendering: `plan/admin-app/CLAUDE.md §Role-Based Access`
- API route auth verification: `plan/docs/API-ROUTES.md §Authentication`
