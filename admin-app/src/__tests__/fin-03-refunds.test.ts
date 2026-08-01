import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookings = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("FIN-03 refund surfaces", () => {
  it("provides an admin-only drawer workflow", () => {
    expect(bookings).toMatch(/currentUser\?\.role === "admin"/);
    expect(bookings).toMatch(/\/api\/bookings\/add-refund/);
    expect(bookings).toMatch(/Approve and record refund/);
  });

  it("renders refunds as negative audit entries", () => {
    expect(bookings).toMatch(/data\.type === "refund" \|\| Number\(data\.amount \|\| 0\) < 0/);
    expect(bookings).toMatch(/pay\.type === "refund"/);
    expect(bookings).toMatch(/approved by/);
  });

  it("reports gross, refunds, net, and cancelled bookings retaining funds", () => {
    expect(reports).toMatch(/grossCollectionsTotal/);
    expect(reports).toMatch(/refundsTotal/);
    expect(reports).toMatch(/cancelledOrNoShowWithCollections/);
    expect(reports).toMatch(/Cancelled and no-show bookings with money collected/);
    expect(reports).toMatch(/payment\.type/);
  });
});

describe("CRL-01 refund idempotency (client)", () => {
  // Per CRL-01: the client preallocates the refundId via a Firestore-generated
  // payments doc ID, holds it across uncertain responses, and clears it on
  // a successful submit. A 409 (same ID, different fields) also clears the
  // held ref so the next intentional submit mints a fresh one. Mirrors the
  // paymentSubmissionIdRef pattern.

  it("declares a refundSubmissionIdRef alongside the payment ref", () => {
    expect(bookings).toMatch(/refundSubmissionIdRef = useRef<string \| null>\(null\)/);
  });

  it("preallocates the refundId before the request using a Firestore-generated payments doc ID", () => {
    expect(bookings).toMatch(/refundSubmissionIdRef\.current[\s\S]+?doc\(collection\(db, "bookings", selectedBooking\.id, "payments"\)\)\.id/);
  });

  it("sends the preallocated refundId in the request body", () => {
    expect(bookings).toMatch(/body: JSON\.stringify\(\{ bookingId: selectedBooking\.id, refundId, amount, method: refundMethod, reason: refundReason\.trim\(\) \}\)/);
  });

  it("keeps the same refundId across an uncertain/network failure (replay path)", () => {
    // The held-ref pattern: set before the fetch, cleared only on success.
    expect(bookings).toMatch(/refundSubmissionIdRef\.current = refundId;[\s\S]+?if \(refundCompleted\) refundSubmissionIdRef\.current = null;/);
  });

  it("clears the held refundId on a 409 conflict so the next submit mints fresh", () => {
    expect(bookings).toMatch(/if \(response\.status === 409\)[\s\S]+?refundSubmissionIdRef\.current = null;/);
  });
});
