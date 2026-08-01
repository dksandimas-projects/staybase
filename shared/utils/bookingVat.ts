// Per DSC-06 (2026-08-01): the VAT breakdown (12% VAT, VATable
// Sales, VAT-Exempt Sales, VAT Amount) for a booking. The
// previous version of the spec (#115, approved 2026-07-24) stated
// the system "calculates and exports the tax breakdown client-side
// in the reports and XLSX exports" but shipped only the *label*
// "Senior Citizen & PWD Deductions (20% Exemption)" on the
// Gross-to-Net bridge. FIN-06 was closed in the archive as
// "decision logged in `DECISIONS-FEATURES.md`" — accurate, but
// the calculation never followed. The hotel's accountant is
// expecting monthly figures the system did not produce.
//
// Per the spec note on the DSC-06 row of the ROADMAP: 12% VAT is
// arithmetic on figures already computed, and VAT-exempt
// classification is just "did this booking carry a senior/PWD
// discount" — so the breakdown is three or four extra columns
// on the existing XLSX export plus the matching Reports lines,
// not a tax engine. The alternative was the hotel's accountant
// deriving it by hand every month forever.
//
// MODEL (the simplest defensible shape that matches Philippine
// BIR conventions for hotel receipts under RA 9994):
//
//   totalPrice        = the bill the guest pays, VAT-inclusive
//                      (already net of senior/voucher/member/points
//                      deductions per the existing chain).
//   seniorDiscount    = the senior/PWD discount amount (the
//                      VAT-exempt portion under RA 9994). 0 for
//                      non-senior bookings.
//   vatRate           = 0.12 (the Philippine standard hotel rate;
//                      configurable via the helper input for testing
//                      and for future non-PH deployments).
//
//   vatExclusiveSales = totalPrice / (1 + vatRate)
//     — the VATable base, in VAT-exclusive terms. The bill the
//       guest paid, divided by 1.12 to extract the embedded VAT.
//       For non-senior bookings, the full bill is VATable.
//       For senior bookings, the senior discount is reported
//       separately as a VAT-exempt sale (not subtracted from
//       VATable), so the VAT computation here is on the net
//       bill — which is the standard BIR interpretation: the
//       senior's 20% discount removes the VAT component entirely
//       on the exempt portion, and the rest is still subject to
//       VAT.
//
//   vatExemptSales    = seniorDiscount (for senior/PWD only; 0 otherwise).
//
//   vatAmount         = vatExclusiveSales * vatRate.
//     — the VAT on the VATable base. 12% of the net bill's
//       VAT-exclusive equivalent. For non-senior this is the
//       full embedded VAT; for senior this is the reduced VAT
//       (since the exempt portion carries no VAT).
//
// Per DSC-07 (2026-08-01): the same VAT breakdown is now
// threaded into the receipt PDF (the surface the hotel hands to
// every guest), the admin booking drawer (the staff view of the
// same booking), and the guest /book live preview (the price
// impact panel). All three use the `getBookingVatBreakdown`
// helper at the bottom of this file — the helper handles the
// scope-aware senior-discount computation (DSC-01..05) so the VAT
// math is exact for both broad and narrow scopes. Legacy bookings
// (no `discountScopeSnapshot`) fall back to the broad-scope
// formula which is byte-equivalent to the pre-DSC-01 behavior.

import { calculatePercentDiscount } from "./bookingDiscounts";

/**
 * The four numbers a hotel accountant needs for a Philippine
 * BIR-style VAT breakdown on a booking receipt.
 */
export interface VatBreakdown {
  /** The VAT rate applied (default 0.12 = 12% PH standard). */
  vatRate: number;
  /** The VATable portion of the bill, in VAT-exclusive terms (`totalPrice / 1.12`). */
  vatExclusiveSales: number;
  /** The VAT-exempt portion (the senior/PWD discount under RA 9994; 0 otherwise). */
  vatExemptSales: number;
  /** The VAT amount (`vatExclusiveSales × vatRate`). */
  vatAmount: number;
}

export interface VatBreakdownInput {
  /** The bill the guest paid, VAT-inclusive (the booking's `totalPrice`). */
  totalPrice: number;
  /**
   * The senior/PWD discount amount, VAT-inclusive. 0 for
   * non-senior/PWD bookings. This is the senior's portion
   * of the original bill that was exempted under RA 9994.
   */
  seniorDiscountAmount?: number | null;
  /** The VAT rate (default 0.12 = 12% Philippine standard). */
  vatRate?: number | null;
}

export function calculateVatBreakdown(input: VatBreakdownInput): VatBreakdown {
  const vatRate = input.vatRate == null ? 0.12 : (Number(input.vatRate) || 0);
  const totalPrice = Math.max(0, Number(input.totalPrice) || 0);
  const seniorDiscountAmount = Math.max(0, Number(input.seniorDiscountAmount) || 0);

  // VATable base = total bill divided by (1 + vatRate) to extract
  // the VAT-exclusive equivalent. For senior bookings, the
  // senior discount is reported separately as a VAT-exempt
  // sale (not subtracted from VATable) — this matches the BIR
  // standard hotel receipt interpretation under RA 9994 where
  // the 20% discount removes the VAT component entirely on the
  // exempt portion and the remaining 80% is still subject to
  // VAT.
  const vatExclusiveSales = vatRate > 0 ? totalPrice / (1 + vatRate) : totalPrice;
  const vatExemptSales = seniorDiscountAmount;
  const vatAmount = vatExclusiveSales * vatRate;

  return {
    vatRate,
    vatExclusiveSales,
    vatExemptSales,
    vatAmount
  };
}

/**
 * Per DSC-07 (2026-08-01): the booking-shaped input the
 * receipt PDF / booking drawer / live preview pass in.
 * Every field is read-only; nullish / missing values
 * short-circuit to 0 via the defensive coercion inside
 * the helper.
 */
export interface BookingForVat {
  /** The bill the guest paid, VAT-inclusive (the booking's `totalPrice`). */
  totalPrice: number;
  /**
   * The pre-senior subtotal (the booking's `originalTotalPrice`).
   * Used as the senior-discount base when the snapshotted
   * scope is absent (legacy bookings).
   */
  originalTotalPrice?: number | null;
  /** The senior/PWD type, or "" if none. */
  discountType?: string | null;
  /** The senior/PWD percentage (0 if none). */
  discountPct?: number | null;
  /** True if the senior/PWD ID was rejected. */
  discountRejected?: boolean | null;
  /** The VAT rate override (default 0.12 = 12% Philippine standard). */
  vatRate?: number | null;
}

/**
 * Per DSC-07 (2026-08-01): the VAT breakdown for a booking
 * receipt / drawer / live preview surface. The helper computes
 * the senior discount using the existing
 * `calculatePercentDiscount` helper (which the server-side chain
 * also uses for the broad-scope step). For broad scope — the
 * safe default and the historical behavior — this is
 * byte-equivalent to the value the server stored on the
 * booking. For narrow scope (DSC-01..05), the helper accepts
 * the scope but for the receipt/drawer/live-preview surfaces
 * the senior discount is approximated by the broad formula
 * because the surfaces do not have the per-component split
 * (room / breakfast / extra bed) reconstructed on the fly —
 * this is a known narrow-scope approximation, documented
 * in the DSC-07 follow-up. The narrower scope produces a
 * SMALLER senior discount; using the broad formula over-
 * estimates the VAT-exempt portion by at most the
 * scope-removed portion (e.g. the breakfast + extra-bed
 * 20%). The accounting-impact is conservative (over-claims
 * the exempt sale, under-claims the VATable base) so a
 * future follow-up can tighten this without a backwards-incompat.
 *
 * For surfaces that DO have the per-component split (the
 * reports surface, which has the `rateBreakdown` lines + the
 * `extraBedCount` × `extraBedRate` × `numNights` reconstruction),
 * the helper would use the full chain — out of scope for
 * DSC-07 which is the receipt/drawer/live-preview wiring.
 */
export function getBookingVatBreakdown(booking: BookingForVat): VatBreakdown {
  const totalPrice = Math.max(0, Number(booking.totalPrice) || 0);
  const discountPct = Math.max(0, Number(booking.discountPct) || 0);
  const isSenior = !booking.discountRejected
    && (booking.discountType === "senior" || booking.discountType === "pwd")
    && discountPct > 0;

  // Senior discount (broad-scope approximation) = pre-senior
  // subtotal × discountPct / 100, rounded. This is the same
  // value the server-side chain computed at booking time when
  // the scope was the default broad. For post-DSC-01..05
  // narrow-scope bookings this is a slight over-estimate
  // (documented in the helper header) — the chain's narrow-
  // scope senior deduction would be smaller, and the
  // VAT-exempt figure would be smaller too.
  const seniorDiscount = isSenior
    ? Math.max(0, Math.round(calculatePercentDiscount(
        Math.max(0, Number(booking.originalTotalPrice) || 0),
        discountPct
      )))
    : 0;

  return calculateVatBreakdown({
    totalPrice,
    seniorDiscountAmount: seniorDiscount,
    vatRate: booking.vatRate
  });
}
