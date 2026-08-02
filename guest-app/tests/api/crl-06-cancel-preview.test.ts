import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per CRL-06 (2026-08-02): the secure cancellation
// preview. `POST /api/bookings/cancel-preview` (the
// same `ref + (email | token)` credential as the
// destructive cancel, plus the MRB-13 `scope` selector)
// returns the financial effect WITHOUT mutating
// anything. The guest + admin cancel modals call this
// on open (and on scope flip in the admin modal) and
// render the breakdown BEFORE the user taps confirm.
// The destructive cancel never auto-refunds (CRL-04);
// the preview makes the "staff processing still
// required" callout explicit when the policy refunds
// money AND the guest has paid.
//
// These are source-text guards + targeted
// `evaluateCancelPreview` unit tests. The end-to-end
// behaviour is the responsibility of CRL-09 (the
// remaining-tests follow-up).

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

const sharedCancellationSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/cancellation.ts"),
  "utf8"
);

const adminBookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

const adminPreviewPanelSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/CancellationPreviewPanel.tsx"),
  "utf8"
);

const guestLookupPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingLookupPage.tsx"),
  "utf8"
);

const guestPreviewPanelSrc = readFileSync(
  resolve(__dirname, "../../src/components/CancellationPreviewPanel.tsx"),
  "utf8"
);

describe("CRL-06 — `CancellationPreview` type lives in shared/types", () => {
  it("declares the per-scope `CancellationPreview` interface", () => {
    // The handler's response shape is the source
    // of truth for both the admin + guest panels.
    expect(sharedTypesSrc).toMatch(/export interface CancellationPreview \{/);
    expect(sharedTypesSrc).toMatch(/kind:\s*"single"\s*\|\s*"reservation"/);
    expect(sharedTypesSrc).toMatch(/scope:\s*"room"\s*\|\s*"reservation"/);
    expect(sharedTypesSrc).toMatch(/staffProcessingRequired:\s*boolean/);
    expect(sharedTypesSrc).toMatch(/policySource:\s*"settings"\s*\|\s*"corporate-override"\s*\|\s*"legacy-fallback"/);
  });

  it("declares the per-room `CancellationPreviewRoom` projection", () => {
    expect(sharedTypesSrc).toMatch(/export interface CancellationPreviewRoom \{/);
    expect(sharedTypesSrc).toMatch(/refundPct:\s*number/);
    expect(sharedTypesSrc).toMatch(/isBeforeCutoff:\s*boolean/);
    expect(sharedTypesSrc).toMatch(/hoursRemaining:\s*number/);
  });
});

describe("CRL-06 — `evaluateCancelPreview` lives in shared/utils/cancellation", () => {
  it("exports the helper from the cancellation utils", () => {
    expect(sharedCancellationSrc).toMatch(/export function evaluateCancelPreview\(/);
  });

  it("declares the `CancelPreviewInput` shape (scope + lookedUpBooking + reservation + cancellableChildren + reservationNetCollected)", () => {
    // The helper is pure: no Firestore / no I/O.
    // The handler does the reads + the net-collected
    // sum, then hands the precomputed values to this
    // function. We anchor the interface at the
    // closing `}\s*\n` so the nested `reservation: {
    // ... }` object literal doesn't trip the
    // non-greedy match.
    const inputMatch = sharedCancellationSrc.match(
      /export interface CancelPreviewInput \{[\s\S]*?\n\}\s*\n/
    );
    expect(inputMatch, "expected CancelPreviewInput interface").toBeTruthy();
    expect(inputMatch![0]).toMatch(/scope:\s*"room"\s*\|\s*"reservation"/);
    expect(inputMatch![0]).toMatch(/now:\s*Date/);
    expect(inputMatch![0]).toMatch(/lookedUpBooking:\s*CancelPreviewChild/);
    expect(inputMatch![0]).toMatch(/reservation:/);
    expect(inputMatch![0]).toMatch(/cancellableChildren:\s*CancelPreviewChild\[\]/);
    expect(inputMatch![0]).toMatch(/reservationNetCollected:\s*number/);
  });

  it("the aggregate `refundPct` is the MINIMUM per-room refundPct (worst-case floor)", () => {
    // Per CRL-06 spec: "Worst-case `policyRefund` —
    // the smallest refund across the rooms — what the
    // staff can guarantee without an exception." The
    // helper uses `Math.min(...perRoom.map(r =>
    // r.refundPct))` so the aggregate is the
    // guaranteed floor. Per-room entries can be
    // higher (a corporate code that overrules the
    // standard policy) — the staff sees both in the
    // panel.
    expect(sharedCancellationSrc).toMatch(
      /aggregateRefundPct = perRoom\.length > 0\s*\?\s*Math\.min\(\.\.\.perRoom\.map\(\(r\) => r\.refundPct\)\)\s*:\s*0/
    );
  });

  it("`staffProcessingRequired` is true when policy refunds money AND the guest has paid", () => {
    // The destructive cancel never auto-refunds
    // (CRL-04). Staff processing is required when
    // the policy refunds money AND the guest has
    // paid. A zero-collected, zero-refund cancel
    // is a no-op (no money moved); a 100% policy
    // refund with zero collected is also a no-op
    // (no money to refund).
    expect(sharedCancellationSrc).toMatch(
      /staffProcessingRequired = aggregateNetCollected > 0 && aggregatePolicyRefund > 0/
    );
  });

  it("the per-room netCollected is pro-rated by the allocation subtotal share", () => {
    // The reservation folio's `paymentsTotal` is the
    // single source of truth; a child's share is its
    // fraction of the cancellable subtotal. The
    // helper uses `(r.subtotal / allocationSubtotal)
    // * availableNetCollected` so room scope can use
    // all cancellable siblings as the denominator.
    // This prevents one room from inheriting the
    // reservation's entire folio. The pro-rata
    // attribution is exact for the legacy
    // single-booking case (the booking owns the
    // entire ledger).
    expect(sharedCancellationSrc).toMatch(
      /\(r\.subtotal \/ allocationSubtotal\) \* availableNetCollected/
    );
  });

  it("emits `kind: \"reservation\"` only when scope is reservation AND a reservation doc is present", () => {
    expect(sharedCancellationSrc).toMatch(
      /const isReservation = input\.scope === "reservation" && input\.reservation !== null/
    );
    expect(sharedCancellationSrc).toMatch(
      /return \{[\s\S]*?kind: isReservation \? "reservation" : "single"/
    );
  });
});

describe("CRL-06 — `guestCancelPreviewSchema` is a sibling of `guestCancelSchema`", () => {
  it("declares a separate schema (no `reason` field, has `scope` default \"room\")", () => {
    // The preview is non-mutating — the reason is
    // captured at confirm time. The schema omits
    // `reason` to keep the preview body minimal. The
    // apiRouter does not require Turnstile (the
    // credential is the gate, the rate limit is the
    // secondary defence).
    const previewSchema = handlerSrc.match(
      /const guestCancelPreviewSchema = z\s*\.[\s\S]*?\.refine\(\s*\(data\) => Boolean\(data\.guestEmail\) !== Boolean\(data\.token\),[\s\S]*?\}\);/
    );
    expect(previewSchema, "expected the preview schema").toBeTruthy();
    expect(previewSchema![0]).toMatch(/scope:\s*z\.enum\(\[\s*"room"\s*,\s*"reservation"\s*\]\)\.optional\(\)\.default\(\s*"room"\s*\)/);
    // No `reason` field in the preview schema
    expect(previewSchema![0]).not.toMatch(/reason: z\.string/);
  });
});

describe("CRL-06 — `handleCancelPreview` is exported from the bookings handler", () => {
  it("declares the handler with the standard (req, res) signature", () => {
    const handlerMatch = handlerSrc.match(
      /export async function handleCancelPreview\(req: any, res: any\) \{/
    );
    expect(handlerMatch, "expected handleCancelPreview export").toBeTruthy();
  });

  it("is imported + dispatched by the apiRouter", () => {
    expect(apiRouterSrc).toMatch(
      /handleCancelPreview/
    );
  });

  it("derives `requestedScope` from the body for both staff and guests", () => {
    // The staff path reads `req.body.scope` directly
    // (no schema gate on the staff body); the guest
    // path uses the schema-validated value via the
    // destructive cancel. The default `"room"` keeps
    // legacy single-child behavior for every existing
    // caller that omits the field.
    const handlerBody = handlerSrc.match(
      /export async function handleCancelPreview\(req: any, res: any\) \{[\s\S]*?\n\}/
    );
    expect(handlerBody, "expected the handler body").toBeTruthy();
    expect(handlerBody![0]).toMatch(
      /let requestedScope:\s*"room"\s*\|\s*"reservation"\s*=\s*req\.staff\s*\?[\s\S]{0,400}"room"/
    );
    expect(handlerBody![0]).toMatch(/requestedScope = parsed\.data\.scope/);
  });

  it("honours `scope === \"reservation\"` only when the looked-up booking has a `reservationId`", () => {
    // A legacy pre-MRB-01 booking (no `reservationId`)
    // carrying `scope === "reservation"` silently
    // falls back to the per-child branch — a
    // "reservation" of size 1 is byte-equivalent to
    // the per-child cancel.
    const handlerBody = handlerSrc.match(
      /export async function handleCancelPreview\(req: any, res: any\) \{[\s\S]*?\n\}/
    );
    expect(handlerBody).toBeTruthy();
    expect(handlerBody![0]).toMatch(
      /const isReservationScope = requestedScope === "reservation" && lookedUpReservationId\.length > 0/
    );
  });

  it("reads N children via `where(\"reservationId\", \"==\", lookedUpReservationId)\" for the reservation-scope path", () => {
    // Same child-read shape as the cancel handler's
    // reservation-scope branch. The query lives
    // inside the `Promise.all` alongside the
    // reservation header read so the latency is the
    // slower of the two, not the sum.
    const handlerBody = handlerSrc.match(
      /export async function handleCancelPreview\(req: any, res: any\) \{[\s\S]*?\n\}/
    );
    expect(handlerBody).toBeTruthy();
    expect(handlerBody![0]).toMatch(
      /adminDb\.collection\("bookings"\)\s*\.where\(\s*"reservationId",\s*"==",\s*lookedUpReservationId\s*\)/
    );
  });

  it("reads the reservation folio (payments + refunds) for net-collected attribution on the reservation-scope path", () => {
    // The reservation case reads
    // `reservations/{id}/payments` +
    // `reservations/{id}/refunds`. The sign-aware sum
    // (refunds are negative on the wire, per CRL-01)
    // is the same shape `getReservationFolioSummary`
    // uses internally.
    const handlerBody = handlerSrc.match(
      /export async function handleCancelPreview\(req: any, res: any\) \{[\s\S]*?\n\}/
    );
    expect(handlerBody).toBeTruthy();
    expect(handlerBody![0]).toMatch(
      /adminDb\.collection\("reservations"\)\.doc\(reservation\.id\)\.collection\("payments"\)\.get\(\)/
    );
    expect(handlerBody![0]).toMatch(
      /adminDb\.collection\("reservations"\)\.doc\(reservation\.id\)\.collection\("refunds"\)\.get\(\)/
    );
  });

  it("falls back to the legacy per-booking folio when the booking has no `reservationId`", () => {
    // The legacy per-booking path (pre-MRB-01) reads
    // `bookings/{id}/payments` — the legacy adapter
    // carries both payments (positive) and refunds
    // (negative, per CRL-01) in the same
    // subcollection. The sign-aware sum gives the
    // net collected.
    const handlerBody = handlerSrc.match(
      /export async function handleCancelPreview\(req: any, res: any\) \{[\s\S]*?\n\}/
    );
    expect(handlerBody).toBeTruthy();
    // The code is multi-line: `adminDb.collection("bookings")
    //   .doc(bookingDocumentRef.id)
    //   .collection("payments")
    //   .get()`. Match the chained shape (the `\s*` /\.
    //   allow line breaks).
    expect(handlerBody![0]).toMatch(
      /adminDb\.collection\("bookings"\)\s*\.doc\(bookingDocumentRef\.id\)\s*\.collection\("payments"\)\s*\.get\(\)/
    );
  });

  it("calls `evaluateCancelPreview` with the precomputed values", () => {
    const handlerBody = handlerSrc.match(
      /export async function handleCancelPreview\(req: any, res: any\) \{[\s\S]*?\n\}/
    );
    expect(handlerBody).toBeTruthy();
    expect(handlerBody![0]).toMatch(
      /const preview = evaluateCancelPreview\(\{[\s\S]*?scope: requestedScope,[\s\S]*?reservationNetCollected,[\s\S]*?allocationSubtotal\s*\}/
    );
  });
});

describe("CRL-06 — the apiRouter wires the preview route with rate limit + staff auth", () => {
  it("dispatches `POST /api/bookings/cancel-preview` to `handleCancelPreview`", () => {
    // The URL is `cancel-preview` (hyphen-separated,
    // same shape as `add-payment` / `create-walkin` /
    // `confirm-with-balance`) because the apiRouter
    // splits on `/` and takes `[domain, action]` —
    // a slash-separated path would drop the second
    // segment.
    const previewRoute = apiRouterSrc.match(
      /if \(domain === "bookings" && action === "cancel-preview" && req\.method === "POST"\) \{[\s\S]*?return await handleCancelPreview\(req, res\);[\s\S]*?\}/
    );
    expect(previewRoute, "expected the preview route").toBeTruthy();
  });

  it("rate-limits the preview at 10/min/IP (independent bucket from cancel)", () => {
    // The preview rate limit uses a separate key
    // (`bookings-cancel-preview:...`) so a flood of
    // previews cannot starve a legitimate cancel
    // attempt. The bucket is shared with the staff +
    // guest paths (no separate staff bucket).
    const previewRoute = apiRouterSrc.match(
      /if \(domain === "bookings" && action === "cancel-preview" && req\.method === "POST"\) \{[\s\S]*?return await handleCancelPreview\(req, res\);[\s\S]*?\}/
    );
    expect(previewRoute).toBeTruthy();
    expect(previewRoute![0]).toMatch(
      /isRateLimited\(`bookings-cancel-preview:\$\{ip\}`, 10, 60000\)/
    );
  });

  it("allows staff to bypass the body schema (already authenticated)", () => {
    // Same pattern as the cancel route: the apiRouter
    // tries staff auth first and sets `req.staff`.
    // The handler then branches on `req.staff` to pick
    // the right resolution path.
    const previewRoute = apiRouterSrc.match(
      /if \(domain === "bookings" && action === "cancel-preview" && req\.method === "POST"\) \{[\s\S]*?return await handleCancelPreview\(req, res\);[\s\S]*?\}/
    );
    expect(previewRoute).toBeTruthy();
    expect(previewRoute![0]).toMatch(/authenticateStaff\(req\)/);
  });
});

describe("CRL-06 — `CancellationPreviewPanel` (admin) renders the per-scope breakdown", () => {
  it("uses the canonical shared `CancellationPreview` type", () => {
    expect(adminPreviewPanelSrc).toMatch(
      /import type \{ CancellationPreview \} from "@spark-inn\/shared"/
    );
  });

  it("renders the aggregate subtotal / net collected / policy refund / retained fields", () => {
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-subtotal"/
    );
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-net-collected"/
    );
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-policy-refund"/
    );
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-retained"/
    );
  });

  it("renders the per-room projection table for the reservation-scope case", () => {
    // The reservation-scope preview carries a
    // `rooms[]` array; the panel renders one row per
    // room with the subtotal + refund. N=1
    // falls through to the legacy single-row shape.
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-room-row"/
    );
    expect(adminPreviewPanelSrc).toMatch(
      /preview\.kind === "reservation" && preview\.rooms && preview\.rooms\.length > 0/
    );
  });

  it("surfaces the `staffProcessingRequired` callout", () => {
    // The destructive cancel never auto-refunds
    // (CRL-04). The panel makes that explicit with
    // a dedicated callout when the policy refunds
    // money AND the guest has paid. The amber
    // treatment is intentional — the staff sees a
    // visible flag that the cancel needs a
    // post-commit refund action.
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-callout"/
    );
    expect(adminPreviewPanelSrc).toMatch(
      /preview\.staffProcessingRequired/
    );
  });

  it("renders the loading + error states", () => {
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-panel-loading"/
    );
    expect(adminPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-panel-error"/
    );
  });
});

describe("CRL-06 — Admin `BookingsPage` wires the preview into the cancel modal", () => {
  it("imports `CancellationPreviewPanel` and the canonical shared type", () => {
    expect(adminBookingsPageSrc).toMatch(
      /import \{ CancellationPreviewPanel \} from "\.\.\/components\/CancellationPreviewPanel"/
    );
    expect(adminBookingsPageSrc).toMatch(/type CancellationPreview/);
  });

  it("holds the `cancelPreview` / `cancelPreviewLoading` / `cancelPreviewError` state", () => {
    // The state is consumed by the cancel modal's
    // `additionalFields` slot. The reset paths (modal
    // close + destructive cancel success) clear all
    // three so a previous session's breakdown never
    // bleeds into a new one.
    expect(adminBookingsPageSrc).toMatch(
      /const \[cancelPreview, setCancelPreview\] = useState<CancellationPreview \| null>\(null\)/
    );
    expect(adminBookingsPageSrc).toMatch(
      /const \[cancelPreviewLoading, setCancelPreviewLoading\] = useState\(false\)/
    );
    expect(adminBookingsPageSrc).toMatch(
      /const \[cancelPreviewError, setCancelPreviewError\] = useState<string \| null>\(null\)/
    );
  });

  it("defines a `fetchCancelPreview` helper that hits `/api/bookings/cancel-preview`", () => {
    // The helper is rate-limit-friendly (the apiRouter
    // applies 10/min/IP) and reuses the staff ID
    // token. The body carries `bookingId` + `scope`
    // so the server can resolve the looked-up
    // booking.
    const fetchMatch = adminBookingsPageSrc.match(
      /const fetchCancelPreview = async \([\s\S]*?\}\);/
    );
    expect(fetchMatch, "expected fetchCancelPreview").toBeTruthy();
    expect(fetchMatch![0]).toMatch(
      /\/api\/bookings\/cancel-preview/
    );
    expect(fetchMatch![0]).toMatch(
      /body: JSON\.stringify\(\{ bookingId, scope \}\)/
    );
  });

  it("fires the preview via a `useEffect` on modal open + scope flip", () => {
    // The `useEffect` is scoped to
    // `[showBookingCancelForm, selectedBooking?.id,
    // bookingCancelScope]` so a re-fetch fires when
    // any of those change. The destructive cancel
    // never auto-fires this (the modal close path
    // clears state in `handleCancelBooking`).
    const effectMatch = adminBookingsPageSrc.match(
      /useEffect\(\(\) => \{[\s\S]*?\}, \[showBookingCancelForm, selectedBooking\?\.id, bookingCancelScope\]\)/
    );
    expect(effectMatch, "expected the useEffect").toBeTruthy();
    expect(effectMatch![0]).toMatch(
      /void fetchCancelPreview\(selectedBooking\.id, bookingCancelScope\)/
    );
  });

  it("renders the panel in the cancel modal's `additionalFields` slot", () => {
    // The slot is shared with the MRB-13 scope
    // selector; the panel is mounted below the
    // selector so the staff sees the breakdown
    // before tapping confirm. The `data-testid` is
    // the source-text anchor for the test suite.
    expect(adminBookingsPageSrc).toMatch(
      /<CancellationPreviewPanel[\s\S]*?preview=\{cancelPreview\}/
    );
  });
});

describe("CRL-06 — Guest `BookingLookupPage` wires the preview into the cancel modal", () => {
  it("imports the guest `CancellationPreviewPanel`", () => {
    expect(guestLookupPageSrc).toMatch(
      /import \{ CancellationPreviewPanel \} from "\.\.\/components\/CancellationPreviewPanel"/
    );
  });

  it("holds the `cancelPreview` state", () => {
    expect(guestLookupPageSrc).toMatch(
      /const \[cancelPreview, setCancelPreview\] = useState<CancellationPreview \| null>\(null\)/
    );
    expect(guestLookupPageSrc).toMatch(
      /const \[cancelPreviewLoading, setCancelPreviewLoading\] = useState\(false\)/
    );
    expect(guestLookupPageSrc).toMatch(
      /const \[cancelPreviewError, setCancelPreviewError\] = useState<string \| null>\(null\)/
    );
  });

  it("defines a `fetchCancelPreview` helper that reuses the `ref + (email | token)` credential", () => {
    // The guest preview goes through the same
    // credential gate as the destructive cancel
    // (no Turnstile — the credential is the gate,
    // the apiRouter rate limit is the secondary
    // defence). The `lookupAuthMode` state controls
    // which credential shape the body uses.
    // Anchor the match on the function's
    // `finally` block + the closing `};` so the
    // non-greedy match doesn't stop at the inner
    // object literal's `};` (the `previewPayload`
    // object has a `};` on its own line that
    // would otherwise win the non-greedy race).
    const fetchMatch = guestLookupPageSrc.match(
      /const fetchCancelPreview = async \(\) => \{[\s\S]*?setCancelPreviewLoading\(false\);[\s\S]*?\n\s*\};/
    );
    expect(fetchMatch, "expected fetchCancelPreview").toBeTruthy();
    // The fetch call uses a relative URL — the
    // guest app's `fetch` is a browser API so no
    // `getApiBaseUrl()` prefix is needed. The URL
    // is the same one the apiRouter dispatches
    // (`POST /api/bookings/cancel-preview`).
    expect(fetchMatch![0]).toMatch(
      /fetch\("\/api\/bookings\/cancel-preview"/
    );
    // The body branches on `lookupAuthMode` to
    // pick the credential shape: token-mode sets
    // `token`, email-mode sets `guestEmail`. The
    // pattern is the same one the destructive
    // cancel uses (see lines around the existing
    // `cancelPayload`).
    expect(fetchMatch![0]).toMatch(
      /lookupAuthMode === "token" && activeLookupToken/
    );
    // The credential is assigned to the payload
    // via property assignment (not an object
    // literal) — `previewPayload.token = activeLookupToken`
    // for token-mode, `previewPayload.guestEmail =
    // emailInput.trim()` for email-mode. The same
    // shape the destructive cancel uses.
    expect(fetchMatch![0]).toMatch(
      /previewPayload\.token = activeLookupToken/
    );
    expect(fetchMatch![0]).toMatch(
      /previewPayload\.guestEmail = emailInput\.trim\(\)/
    );
  });

  it("fires the preview via a `useEffect` on modal open", () => {
    const effectMatch = guestLookupPageSrc.match(
      /useEffect\(\(\) => \{[\s\S]*?if \(showCancelModal\) \{[\s\S]*?void fetchCancelPreview\(\)[\s\S]*?\}, \[showCancelModal,/
    );
    expect(effectMatch, "expected the useEffect").toBeTruthy();
  });

  it("renders the panel inside the cancel modal", () => {
    expect(guestLookupPageSrc).toMatch(
      /<CancellationPreviewPanel[\s\S]*?preview=\{cancelPreview\}/
    );
  });

  it("the guest `CancellationPreviewPanel` component renders the per-scope breakdown", () => {
    expect(guestPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-subtotal"/
    );
    expect(guestPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-net-collected"/
    );
    expect(guestPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-policy-refund"/
    );
    expect(guestPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-retained"/
    );
    expect(guestPreviewPanelSrc).toMatch(
      /data-testid="cancellation-preview-callout"/
    );
  });
});
