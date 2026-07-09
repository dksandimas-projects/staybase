import { useMemo } from "react";
import { getDateKeyInTimezone } from "@spark-inn/shared";
import config from "@config";
import { cn } from "../utils/cn";

type DateRangePickerOrientation = "horizontal" | "vertical";

interface DateRangePickerProps {
  checkIn: string;
  checkOut: string;
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
  orientation?: DateRangePickerOrientation;
}

function todayIso() {
  return getDateKeyInTimezone(config.timezone);
}

export function DateRangePicker({
  checkIn,
  checkOut,
  onCheckInChange,
  onCheckOutChange,
  orientation = "vertical"
}: DateRangePickerProps) {
  const minCheckOut = useMemo(() => {
    if (!checkIn) return todayIso();
    const next = new Date(`${checkIn}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const year = next.getFullYear();
    const month = String(next.getMonth() + 1).padStart(2, "0");
    const day = String(next.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [checkIn]);

  return (
    <div
      className={cn(
        "grid gap-3",
        orientation === "horizontal" && "sm:grid-cols-2"
      )}
    >
      <label className="grid gap-2 text-sm font-medium text-gray-700">
        Check-in
        <input
          className="min-h-11 rounded-lg border border-gray-200 px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          min={todayIso()}
          type="date"
          value={checkIn}
          onChange={(event) => {
            const val = event.target.value;
            if (val.length === 10) {
              const minVal = todayIso();
              if (val < minVal) {
                onCheckInChange(minVal);
                return;
              }
            }
            onCheckInChange(val);
          }}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-gray-700">
        Check-out
        <input
          className="min-h-11 rounded-lg border border-gray-200 px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          min={minCheckOut}
          type="date"
          value={checkOut}
          onChange={(event) => {
            const val = event.target.value;
            if (val.length === 10) {
              if (val < minCheckOut) {
                onCheckOutChange(minCheckOut);
                return;
              }
            }
            onCheckOutChange(val);
          }}
        />
      </label>
    </div>
  );
}
