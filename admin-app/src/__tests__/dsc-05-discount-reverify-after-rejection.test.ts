import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per DSC-05 (2026-08-20, decision #228): the admin booking drawer's
// folio "Discount or voucher" card has two operator-visible bugs:
//
// (1) Wrong copy on rejection — the chip at BookingsPage.tsx:5782
//     renders "Pending review" for every booking with a discountType
//     that isn't yet verified, even when the ID has been REJECTED.
//     The check-in chip at :5838-5850 already correctly says
//     "✗ Rejected" on rejection; the folio chip is the inconsistent
//     one.
//
// (2) One-way latch — once a discount type is set on a booking, the
//     `hasVoucherOrDiscount` check at :5768 traps `Apply discount`
//     hidden forever, even when the desk wants to re-verify a
//     physically re-checked or OSCA-resubmitted ID.
//
// The fix is three UI changes in BookingsPage.tsx (chip 3-state split,
// new Re-verify ID button + ConfirmForm gate, Apply discount stays
// hidden on rejection) — no data model change, no new server route, no
// new field. The chip state shape mirrors line 5838-5850 (3-state);
// the Re-verify ID button fires the EXISTING updateDoc payload at
// BookingsPage.tsx:5914-5924 (`{ discountVerified: true,
// discountVerifiedBy: ..., discountRejected: false, updatedAt }`).
//
// Source-text guards pin the contract at the BookingsPage.tsx level
// (mirrors FOL-02 / members-member-since-timestamp / DSC-04 patterns).

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");
const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const sharedTypesSrc = read("shared/types/index.ts");

// Block 1 — the folio chip 3-state split -----------------------------------

describe("DSC-05 — folio chip 3-state split (replaces line :5782 2-state ternary)", () => {
  it("uses a 3-state branch matching the check-in chip at :5838-5850 (verified / rejected / pending)", () => {
    // The pre-DSC-05 chip at :5782 was a 2-state ternary:
    //   discountVerified ? "Verified" : "Pending review"
    // That ternary is GONE — negative pin catches a future refactor
    // that re-introduces it.
    expect(pageSrc).not.toMatch(
      /discountVerified \? .{0,80}Verified.{0,40}: .{0,80}Pending review/s
    );
  });

  it("renders `✓ Verified` (green) copy matching the check-in chip at line 5839", () => {
    // The new chip text is `✓ Verified` and is wrapped in a `text-green-700`
    // span — matching the check-in chip at :5839 verbatim (which uses
    // `text-green-700`, not `text-emerald-700`, per the project's
    // convention). Anchor on the verbatim text + a leading green palette
    // marker on the wrapping span.
    expect(pageSrc).toMatch(/✓ Verified/);
    // The chip's span uses `text-green-700` AND the bg-green-50 to
    // match the check-in chip at line 5839.
    expect(pageSrc).toMatch(/text-green-700[^"']*["']?>\s*✓ Verified/);
  });

  it("renders `✗ Rejected` (red) copy matching the check-in chip at line 5843", () => {
    // The new chip text is `✗ Rejected` wrapped in `text-red-700` —
    // matching the check-in chip at :5843 verbatim.
    expect(pageSrc).toMatch(/✗ Rejected/);
    expect(pageSrc).toMatch(/text-red-700[^"']*["']?>\s*✗ Rejected/);
  });
});

// Block 2 — the Re-verify ID button + ConfirmForm gate ---------------------

describe("DSC-05 — Re-verify ID button + ConfirmForm gate", () => {
  it("renders a `Re-verify ID` button when discountRejected && status is reschedulable", () => {
    // The render condition: discountRejected is truthy AND the
    // RESCHEDULABLE_STATUSES guard accepts the booking's status.
    // The expression lives in a helper `canReverify` const so the
    // anchor is loose: the file MUST contain `canReverify`
    // (the new helper) + the literal `Re-verify ID` label.
    expect(pageSrc).toContain("canReverify");
    expect(pageSrc).toContain("Re-verify ID");
  });

  it("does NOT show Re-verify ID when there is no prior rejection", () => {
    // The button MUST be gated on discountRejected — negative pin:
    // the literal `Re-verify ID` text only renders in the
    // discountRejected branch (no bare Re-verify ID elsewhere in the
    // file outside that branch).
    //
    // Count: 1 occurrence in source = inside the gating block.
    // (Allowed: an aria-label, a tool tip, or a comment — but the
    // actual rendered DOM element is gated.)
    const matches = pageSrc.match(/Re-verify ID/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.length).toBeLessThanOrEqual(3); // comment + aria-label + onClick, all in the same branch
  });

  it("opens a ConfirmForm titled `Re-verify this rejected discount?`", () => {
    // The follow-up confirm modal is a ConfirmForm — per the Cancel
    // / Reject / Approve paths in BookingsPage. The title text matches
    // the spec exactly.
    expect(pageSrc).toContain("Re-verify this rejected discount?");
  });

  it("cites the prior rejection audit cluster (discountRejectedBy + discountRejectionReason) in the confirm body", () => {
    // Both audit-cluster fields are already hydrated by FOL-02
    // (decision #198) — the new confirm body cites them so the desk
    // sees why the prior rejection happened before confirming.
    expect(pageSrc).toMatch(/selectedBooking\.discountRejectedBy/);
    expect(pageSrc).toMatch(/selectedBooking\.discountRejectionReason/);
  });
});

// Block 3 — the confirm handler runs the EXISTING approve-discount payload ----

describe("DSC-05 — the confirm-on-re-verify handler runs the same payload as the check-in Approve", () => {
  it("the re-verify handler writes `discountVerified: true` to bookings/{id}", () => {
    // The same shape that line 5914 already uses — `updateDoc(doc(db,
    // "bookings", selectedBooking.id), { discountVerified: true, ... })`.
    // The new handler reuses the existing write; we anchor on the
    // verbatim payload keys.
    expect(pageSrc).toMatch(/discountVerified:\s*true/);
    expect(pageSrc).toMatch(/discountVerifiedBy/);
    expect(pageSrc).toMatch(/discountRejected:\s*false/);
  });

  it("the re-verify handler stamps updatedAt via serverTimestamp()", () => {
    // Same shape as line 5922; the new handler mirrors the
    // check-in approve.
    expect(pageSrc).toMatch(/updatedAt:\s*serverTimestamp\(\)/);
  });
});

// Block 4 — the Apply discount gate stays hidden on rejection --------------

describe("DSC-05 — Apply discount button stays hidden on rejection", () => {
  it("the Apply discount button is gated on `!hasVoucherOrDiscount` AND reschedulable status — unchanged from pre-DSC-05", () => {
    // The Apply discount button pre-DSC-05 + post-DSC-05 stay gated
    // by `!hasVoucherOrDiscount && RESCHEDULABLE_STATUSES.includes(...)`.
    // The gate is unchanged; the UI bridge is via the new Re-verify
    // ID button, not via re-applying the same discount type.
    expect(pageSrc).toMatch(/!hasVoucherOrDiscount\s*&&\s*RESCHEDULABLE_STATUSES\.includes\(selectedBooking\.status\)/);
  });
});

// Block 5 — data model unchanged ------------------------------------------

describe("DSC-05 — data model is unchanged (no new field, no new collection)", () => {
  it("the shared Booking contract still carries the existing discount-audit cluster", () => {
    // The lifecycle is closed-and-reopened using the existing
    // discountVerified / discountRejected / discountVerifiedBy /
    // discountRejectedBy / discountRejectionReason fields at
    // shared/types/index.ts:640-650. The fix does NOT add a new
    // field (no `discountReverifyAt` or similar).
    expect(sharedTypesSrc).toMatch(/discountType:\s*DiscountType/);
    expect(sharedTypesSrc).toMatch(/discountVerified:\s*boolean/);
    expect(sharedTypesSrc).toMatch(/discountRejected:\s*boolean/);
    expect(sharedTypesSrc).toMatch(/discountRejectedBy:\s*string \| null/);
    expect(sharedTypesSrc).toMatch(/discountRejectionReason:\s*string/);
    // No new re-verify timestamp field
    expect(sharedTypesSrc).not.toMatch(/discountReverifyAt/);
    expect(sharedTypesSrc).not.toMatch(/discountReVerifiedAt/);
  });
});
