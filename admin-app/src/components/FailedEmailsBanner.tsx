// Per #11 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §Open Operator-Reported Bugs → #11
// row`): the desk-facing surface for the Resend DLQ.
// The `failed_emails` Firestore collection has the
// durable audit trail (written by `sendEmail` in
// `guest-app/server/handlers/email.ts`); this banner
// surfaces a count + a click-through to a list of
// `{ recipient, subject, error, lastAttemptAt,
// retryCount }` rows. Admin-only — front-desk staff
// can't see failed emails (they can't resolve them
// without Resend credentials); the listener resets
// the state on non-admin sessions.
//
// The banner is rendered at the top of the dashboard
// (above the existing IDG alert card), so the desk
// sees it on every dashboard load. The collapse/expand
// pattern mirrors the existing "alert card" surface
// in `DashboardPage.tsx` (the IDG Senior/PWD gate +
// the overdue checkouts + the new corporate
// inquiries) — clicking the banner header toggles a
// detailed list of failures.

import { useState } from "react";
import { useAdmin } from "../context/AdminContext";
import { FailedEmail } from "@spark-inn/shared";

// Per the existing DashboardPage pattern for
// formatting the overdue-checkout timestamp
// (e.g. `new Date(checkOut).toLocaleString()`),
// use a localized date+time formatter inline
// rather than depending on a shared util. The
// banner's formatting is a small surface (3 chars
// for time, 10 chars for date) and matches the
// Manila timezone the rest of the admin app uses
// (per `config.timezone` in `hotel.config.ts`).
function formatDateTime(d: Date): string {
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function FailedEmailsBanner() {
  const { failedEmails, failedEmailsLoading, currentUser } = useAdmin();
  // Admin-only — the listener resets the state on
  // non-admin sessions, but we also gate the
  // render so a stale state (e.g. role change
  // mid-session) doesn't accidentally surface
  // failures to a front-desk user.
  if (currentUser?.role !== "admin") return null;
  // Loading state — show a subtle placeholder
  // rather than nothing so the desk knows the
  // data is on its way (a silent empty state
  // could be mistaken for "no failures").
  if (failedEmailsLoading) {
    return (
      <div
        className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-[11px] text-amber-700"
        data-testid="failed-emails-banner-loading"
        role="status"
        aria-live="polite"
      >
        Loading email failure status…
      </div>
    );
  }
  // No failures — render nothing (the banner is
  // intentionally a "bad news only" surface; a
  // persistent "all good" banner would be
  // noise).
  if (failedEmails.length === 0) return null;

  return (
    <FailedEmailsBannerBody failedEmails={failedEmails} />
  );
}

function FailedEmailsBannerBody({ failedEmails }: { failedEmails: FailedEmail[] }) {
  // Default expanded when there are failures so
  // the desk sees the list on first dashboard
  // load. The collapse lets the desk dismiss
  // the list when they're triaging.
  const [expanded, setExpanded] = useState(true);
  const count = failedEmails.length;
  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 shadow-sm ring-1 ring-amber-100"
      data-testid="failed-emails-banner"
      role="alert"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        data-testid="failed-emails-banner-header"
        aria-expanded={expanded}
      >
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-amber-950">
            <span data-testid="failed-emails-banner-icon" aria-hidden="true">⚠</span>
            {count} email{count === 1 ? "" : "s"} failed to send
          </h2>
          <p className="mt-0.5 text-[11px] text-amber-800">
            The desk banner lists every failure. Click to {expanded ? "collapse" : "expand"} the details.
          </p>
        </div>
        <span className="text-amber-700 text-xs font-semibold" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div
          className="border-t border-amber-200 divide-y divide-amber-100 max-h-96 overflow-y-auto"
          data-testid="failed-emails-list"
        >
          {failedEmails.map((failure) => (
            <div
              key={failure.id}
              className="px-4 py-2 text-[11px]"
              data-testid="failed-emails-row"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-amber-950 truncate" title={failure.subject}>
                  {failure.subject || "(no subject)"}
                </span>
                <span className="shrink-0 text-amber-700" title={failure.lastAttemptAt.toISOString()}>
                  {formatDateTime(failure.lastAttemptAt)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-amber-800 truncate" title={failure.recipient}>
                  → {failure.recipient || "(no recipient)"}
                </span>
                <span className="shrink-0 text-rose-700 font-mono" title={failure.error}>
                  {failure.error || "(no error message)"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}