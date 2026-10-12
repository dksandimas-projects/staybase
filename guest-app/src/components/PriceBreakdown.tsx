import type { BookingRateBreakdown } from "@spark-inn/shared";
import { calculateVatBreakdown, isVatEnabled } from "@spark-inn/shared";
import { formatPrice } from "../utils/format";
// Per VAT-01 (2026-10-12): the guest `/book` live preview
// (BookingPage Step 3) + the booking confirmation page +
// the booking lookup page all render this `PriceBreakdown`.
// The VAT sub-block is gated on the admin Tax (VAT) toggle
// surfaced through the public site content hook so the toggle
// is enforced consistently with the admin drawer + Reports.
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";

function formatDateRange(startDate: string, endDate: string) {
  if (!startDate) return "";
  if (startDate === endDate) return startDate;
  return `${startDate} to ${endDate}`;
}

// Per DSC-07 (2026-08-01, per #115): extract the senior discount
// from the booking's rateBreakdown.deductions for the VAT-exempt
// line. The senior discount is the deduction line whose label
// starts with "Senior" or "PWD". Fall back to scanning the chain
// for any "Senior" / "PWD" / "Spark Rewards" / "Voucher" prefix
// so the helper is robust to label-format changes.
function extractSeniorDiscountFromBreakdown(breakdown: BookingRateBreakdown): number {
  const seniorLine = breakdown.deductions.find((line) => {
    const label = line.label.toLowerCase();
    return label.startsWith("senior") || label.startsWith("pwd");
  });
  return Math.max(0, Number(seniorLine?.amount) || 0);
}

export function PriceBreakdown({ breakdown, total }: { breakdown?: BookingRateBreakdown | null; total: number }) {
  // Per VAT-01 (2026-10-12): the admin Tax (VAT) toggle
  // is surfaced through the public site content hook
  // (same fetch as the rest of the hotelConfig read).
  // The `usePublicSiteContent` hook defaults to the
  // BIR-compliant `{ enabled: true }` so a missing
  // snapshot never collapses the live preview to a
  // zero-VAT state during the cold-load window.
  const { vatConfig } = usePublicSiteContent();
  const vatEnabled = isVatEnabled(vatConfig);
  if (!breakdown?.roomLines?.length) return null;

  // Per DSC-07 (2026-08-01, per #115): the live preview now
  // shows the 12% VAT reconciliation the same way the receipt
  // PDF + XLSX export do. The senior discount is read from
  // the rateBreakdown's deductions list (the chain already
  // wrote it there at server time), so the VAT math is exact
  // for both broad and narrow scope.
  //
  // Per VAT-01 (2026-10-12): when the admin toggle is OFF,
  // the entire sub-block is hidden — the bill is the
  // operator's net amount, no VAT to reconcile.
  const seniorDiscountAmount = extractSeniorDiscountFromBreakdown(breakdown);
  const vat = calculateVatBreakdown({
    totalPrice: breakdown.finalTotal || total,
    seniorDiscountAmount,
    vatRate: vatEnabled ? 0.12 : 0
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
      <h3 className="font-semibold text-gray-950">Price breakdown</h3>
      <div className="mt-3 space-y-2">
        {breakdown.roomLines.map((line, index) => (
          <div key={`${line.source}-${line.startDate}-${index}`} className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-gray-800">{line.label}</p>
              <p className="text-xs text-gray-500">
                {line.nights} {line.nights === 1 ? "night" : "nights"} x {formatPrice(line.nightlyRate)}
                {line.startDate ? ` · ${formatDateRange(line.startDate, line.endDate)}` : ""}
              </p>
            </div>
            <span className="font-semibold text-gray-900">{formatPrice(line.subtotal)}</span>
          </div>
        ))}
        {breakdown.addOns.map((line, index) => (
          <div key={`add-on-${index}`} className="flex justify-between gap-4 text-gray-700">
            <span>{line.label}</span>
            <span className="font-medium">{formatPrice(line.amount)}</span>
          </div>
        ))}
        {breakdown.deductions.map((line, index) => (
          <div key={`deduction-${index}`} className="flex justify-between gap-4 text-status-red-text">
            <span>{line.label}</span>
            <span className="font-medium">-{formatPrice(line.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-gray-200 pt-3 text-base font-bold text-gray-950">
          <span>Total</span>
          <span>{formatPrice(breakdown.finalTotal || total)}</span>
        </div>
        {/* Per DSC-07 (2026-08-01, per #115): the 12% VAT
            breakdown sub-block. Three muted lines for the
            BIR-reconcilable figures. The senior discount
            (RA 9994) is the VAT-exempt portion when the
            booking carried one.
            Per VAT-01 (2026-10-12): gated on the admin Tax
            (VAT) toggle. When OFF, the entire sub-block is
            omitted (no zero lines) — the bill is the
            operator's net amount. */}
        {vatEnabled && (
        <div className="mt-2 space-y-1 border-t border-dashed border-gray-300 pt-2 text-xs text-gray-500">
          <div className="flex justify-between">
            <span>VATable Sales (VAT-exclusive)</span>
            <span className="font-mono">{formatPrice(vat.vatExclusiveSales)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT-Exempt Sales (RA 9994 Senior/PWD)</span>
            <span className="font-mono">{formatPrice(vat.vatExemptSales)}</span>
          </div>
          <div className="flex justify-between font-semibold text-gray-700">
            <span>VAT Amount (12% × VATable)</span>
            <span className="font-mono">{formatPrice(vat.vatAmount)}</span>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
