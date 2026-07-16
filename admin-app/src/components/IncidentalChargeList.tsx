import { Booking, IncidentalCharge } from "../context/AdminContext";
import { ConfirmForm } from "./ConfirmForm";
import { FileText, Plus, ChevronRight } from "lucide-react";
import { formatPrice } from "../utils/format";
import React from "react";

interface IncidentalChargeListProps {
  charges: IncidentalCharge[];
  booking: Booking;
  chargeToVoid: IncidentalCharge | null;
  onAddCharge: () => void;
  onSetChargeToVoid: (charge: IncidentalCharge | null) => void;
  onVoidCharge: (reason: string) => Promise<void>;
}

export function IncidentalChargeList({
  charges,
  booking,
  chargeToVoid,
  onAddCharge,
  onSetChargeToVoid,
  onVoidCharge,
}: IncidentalChargeListProps) {
  if (!["confirmed", "checked-in", "checked-out"].includes(booking.status)) return null;

  return (
    <>
      <div className="rounded-card border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
              <FileText size={14} className="text-primary" />
              Incidental charges
            </h3>
            <p className="mt-1 text-[11px] text-gray-500">Fees and reversals added by staff.</p>
          </div>
          {booking.status !== "checked-out" && (
            <button
              type="button"
              onClick={onAddCharge}
              className="inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:w-auto"
            >
              <Plus size={14} />
              Add charge
            </button>
          )}
        </div>
        <div className="space-y-3">
          {charges.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">
              No incidental charges recorded.
            </p>
          ) : (() => {
            const chargeList = (
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-150">
                {charges.map((charge) => (
                  <div key={charge.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800">{charge.label}</p>
                      <p className="mt-0.5 text-[10px] text-gray-500 capitalize">
                        {charge.category.replace(/-/g, " ")} ·{" "}
                        {charge.addedAt ? charge.addedAt.slice(0, 10) : "Pending timestamp"}
                        {charge.voidOf ? " · reversal" : ""}
                      </p>
                      {charge.note ? (
                        <p className="mt-1 text-[10px] text-gray-500">{charge.note}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`font-bold ${charge.amount < 0 ? "text-red-600" : "text-gray-900"}`}
                      >
                        {formatPrice(charge.amount)}
                      </span>
                      {!charge.voidOf &&
                      charge.amount > 0 &&
                      !charges.some((entry) => entry.voidOf === charge.id) &&
                      booking.status !== "checked-out" ? (
                        <button
                          type="button"
                          onClick={() => onSetChargeToVoid(charge)}
                          className="min-h-[44px] rounded-lg px-3 text-[10px] font-bold text-red-600 hover:bg-red-50"
                        >
                          Void
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            );
            if (charges.length >= 4) {
              return (
                <details className="group" defaultChecked>
                  <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-800 [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
                    {charges.length} entries
                  </summary>
                  <div className="mt-2">{chargeList}</div>
                </details>
              );
            }
            return chargeList;
          })()}
        </div>
      </div>

      {chargeToVoid ? (
        <ConfirmForm
          title="Void incidental charge?"
          message={
            <>
              A negative reversal for <strong>{chargeToVoid.label}</strong> (
              {formatPrice(chargeToVoid.amount)}) will be appended. The original entry will remain
              in the audit trail.
            </>
          }
          reasonLabel="Void reason"
          reasonPlaceholder="Required audit note"
          confirmLabel="Add reversal"
          cancelLabel="Keep charge"
          variant="danger"
          reasonRequired
          onConfirm={(reason) => void onVoidCharge(reason)}
          onCancel={() => onSetChargeToVoid(null)}
        />
      ) : null}
    </>
  );
}
