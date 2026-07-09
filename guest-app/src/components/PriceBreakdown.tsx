import type { BookingRateBreakdown } from "@spark-inn/shared";
import { formatPrice } from "../utils/format";

function formatDateRange(startDate: string, endDate: string) {
  if (!startDate) return "";
  if (startDate === endDate) return startDate;
  return `${startDate} to ${endDate}`;
}

export function PriceBreakdown({ breakdown, total }: { breakdown?: BookingRateBreakdown | null; total: number }) {
  if (!breakdown?.roomLines?.length) return null;

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
      </div>
    </div>
  );
}
