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
// The helper does NOT depend on the booking's discount scope
// (DSC-01..05) for the VAT math itself — the VAT is computed
// on the net bill. The *senior discount amount* is the input
// the caller passes in; the reports surface already computes
// that from the per-booking chain (`seniorDiscount` in the
// discountsSummary loop). This keeps the helper minimal and
// scope-agnostic: it doesn't need to know about room vs.
// breakfast vs. extra-bed, just the two numbers the BIR
// breakdown cares about.

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
