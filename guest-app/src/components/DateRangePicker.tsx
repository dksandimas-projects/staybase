import { useMemo } from "react";

interface DateRangePickerProps {
  checkIn: string;
  checkOut: string;
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function DateRangePicker({ checkIn, checkOut, onCheckInChange, onCheckOutChange }: DateRangePickerProps) {
  const minCheckOut = useMemo(() => {
    if (!checkIn) return todayIso();
    const next = new Date(`${checkIn}T00:00:00`);
    next.setDate(next.getDate() + 1);
    return next.toISOString().slice(0, 10);
  }, [checkIn]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium text-gray-700">
        Check-in
        <input
          className="min-h-11 rounded-lg border border-gray-200 px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          min={todayIso()}
          type="date"
          value={checkIn}
          onChange={(event) => onCheckInChange(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-gray-700">
        Check-out
        <input
          className="min-h-11 rounded-lg border border-gray-200 px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          min={minCheckOut}
          type="date"
          value={checkOut}
          onChange={(event) => onCheckOutChange(event.target.value)}
        />
      </label>
    </div>
  );
}
