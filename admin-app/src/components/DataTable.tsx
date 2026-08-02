import { ArrowUpDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { useBreakpoint } from "../utils/useBreakpoint";

export interface DataTableColumn<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: "start" | "end";
}

interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  renderMobileCard?: (row: T) => ReactNode;
  emptyMessage?: string;
  mobileCardShowChevron?: boolean;
  // Per MRB-07 (2026-08-02, per decision #159): a reservation covering
  // several rooms renders as one parent row with its room stays nested
  // beneath it. The caller supplies the already-flattened row list (a
  // parent followed by its visible children) and classifies each row
  // here; the table only owns the visual nesting, so grouping logic
  // stays with the caller that knows the domain.
  rowVariant?: (row: T) => "parent" | "child" | undefined;
}

function MobileCardSkeleton() {
  return (
    <div className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200" aria-hidden="true">
      <div className="flex items-center justify-between gap-2">
        <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-100" />
      </div>
      <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-gray-100" />
      <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-gray-100" />
      <div className="mt-3 h-6 w-24 animate-pulse rounded bg-gray-100" />
    </div>
  );
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading = false,
  onRowClick,
  renderMobileCard,
  emptyMessage = "No data to show.",
  mobileCardShowChevron = false,
  rowVariant
}: DataTableProps<T>) {
  const { isMobile } = useBreakpoint();
  const useMobileCards = isMobile && renderMobileCard !== undefined;

  if (useMobileCards) {
    return (
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => (
            <MobileCardSkeleton key={index} />
          ))
        ) : rows.length === 0 ? (
          <div
            className="rounded-card border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm font-semibold text-gray-500"
            role="status"
          >
            {emptyMessage}
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                "rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 transition",
                onRowClick && "cursor-pointer hover:shadow-md active:scale-[0.99]",
                // Per MRB-07: a nested room stay is indented and tinted
                // so the card list reads as "reservation, then its
                // rooms" on a phone the same way the table does.
                rowVariant?.(row) === "child" && "ml-4 bg-gray-50/70 ring-gray-150",
                rowVariant?.(row) === "parent" && "ring-gray-300"
              )}
              onClick={() => onRowClick?.(row)}
              onKeyDown={(e) => {
                if (!onRowClick) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick(row);
                }
              }}
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              <div className={cn(mobileCardShowChevron && "pr-6")}>
                {renderMobileCard!(row)}
              </div>
              {mobileCardShowChevron && onRowClick ? (
                <ChevronRight
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
                />
              ) : null}
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className={cn(
                    "px-4 py-3 text-left font-semibold text-gray-600",
                    column.align === "end" && "text-right"
                  )}
                >
                  <span className={cn("inline-flex items-center gap-2", column.align === "end" && "justify-end")}>
                    {column.header}
                    <ArrowUpDown size={14} className="text-gray-400" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={String(column.key)} className="px-4 py-4">
                      <div className="h-4 w-full max-w-32 animate-pulse rounded bg-gray-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm font-semibold text-gray-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    onRowClick && "cursor-pointer hover:bg-gray-50",
                    // Per MRB-07: nested room stays sit on a tinted
                    // band under their reservation row, and the
                    // reservation row itself keeps a normal white
                    // background so it reads as the group header.
                    rowVariant?.(row) === "child" && "bg-gray-50/70"
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((column, columnIndex) => (
                    <td
                      key={String(column.key)}
                      className={cn(
                        "whitespace-nowrap px-4 py-4 text-gray-700",
                        column.align === "end" && "text-right",
                        // Indent only the first cell so the nesting is
                        // visible without shifting every column.
                        columnIndex === 0 && rowVariant?.(row) === "child" && "pl-10"
                      )}
                    >
                      {column.render ? column.render(row) : String(row[column.key as keyof T] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
