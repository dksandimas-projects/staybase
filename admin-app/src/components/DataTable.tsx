import { ArrowUpDown } from "lucide-react";
import { cn } from "../utils/cn";

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
}

export function DataTable<T extends { id: string }>({ columns, rows, loading = false, onRowClick }: DataTableProps<T>) {
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
            {loading
              ? Array.from({ length: 5 }).map((_, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={String(column.key)} className="px-4 py-4">
                        <div className="h-4 w-full max-w-32 animate-pulse rounded bg-gray-100" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(onRowClick && "cursor-pointer hover:bg-gray-50")}
                    onClick={() => onRowClick?.(row)}
                  >
                    {columns.map((column) => (
                      <td
                        key={String(column.key)}
                        className={cn(
                          "whitespace-nowrap px-4 py-4 text-gray-700",
                          column.align === "end" && "text-right"
                        )}
                      >
                        {column.render ? column.render(row) : String(row[column.key as keyof T] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
