import { useState } from "react";
import { Check, GripVertical, Plus, Square, Trash2 } from "lucide-react";
import { KNOWN_CONTENT_ICONS } from "@spark-inn/shared";

// Generic CRUD list editor for the public site's list-shaped
// content (homepage amenities / services / spark rewards perks,
// corporate perks). Each row exposes:
//   - title (text)
//   - description (text, optional)
//   - icon (string, picked from KNOWN_CONTENT_ICONS)
//   - isEnabled (bool, optional — only when `withEnabled` is true)
//
// The parent owns the data — `value` and `onChange` flow the full
// array up, the editor just mutates a local draft and emits on
// Save. Drafts are reset whenever the upstream `value` changes
// (e.g. Firestore listener delivers a new snapshot) so the form
// stays in sync with the server.
export interface ListEditorItem {
  title: string;
  description: string;
  icon: string;
  isEnabled?: boolean;
}

interface ListEditorProps {
  label: string;
  helper?: string;
  value: ListEditorItem[];
  onChange: (next: ListEditorItem[]) => void;
  withEnabled?: boolean;
  withDescription?: boolean;
  defaultIcon?: string;
  emptyItem?: ListEditorItem;
  // Optional cap so the UI can disable the Add button when reached.
  maxItems?: number;
}

const EMPTY_ITEM: ListEditorItem = { title: "", description: "", icon: "sparkles" };

export function ListEditor({
  label,
  helper,
  value,
  onChange,
  withEnabled = true,
  withDescription = true,
  defaultIcon = "sparkles",
  emptyItem = EMPTY_ITEM,
  maxItems
}: ListEditorProps) {
  // Local edit draft — flushing to the parent on every change would
  // re-render the whole list and lose focus on the currently edited
  // field. Instead, we mutate the local copy and emit only when the
  // parent asks (the parent re-keys the editor when it persists).
  const [items, setItems] = useState<ListEditorItem[]>(() => value);

  // Re-sync when the upstream value changes shape (e.g. a Firestore
  // snapshot arrives with a different array).
  const [lastIncoming, setLastIncoming] = useState(value);
  if (value !== lastIncoming) {
    setLastIncoming(value);
    setItems(value);
  }

  function commit(next: ListEditorItem[]) {
    setItems(next);
    onChange(next);
  }

  function add() {
    if (maxItems && items.length >= maxItems) return;
    commit([...items, { ...emptyItem, icon: emptyItem.icon || defaultIcon }]);
  }

  function remove(index: number) {
    commit(items.filter((_, i) => i !== index));
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...items];
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  function patch(index: number, updates: Partial<ListEditorItem>) {
    commit(items.map((row, i) => (i === index ? { ...row, ...updates } : row)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-800">{label}</p>
          {helper && <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{helper}</p>}
        </div>
        <button
          type="button"
          onClick={add}
          disabled={Boolean(maxItems && items.length >= maxItems)}
          className="min-h-[36px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={13} />
          Add item
        </button>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-[10px] text-gray-500">
          No items yet. Add the first one to populate this section on the guest site.
        </p>
      ) : (
        <ol className="space-y-2">
          {items.map((row, index) => (
            <li
              key={index}
              className={`rounded-lg border bg-white p-3 ${
                row.isEnabled === false ? "border-gray-200 opacity-60" : "border-gray-200"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-1 text-gray-400">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <GripVertical size={14} className="rotate-180" />
                  </button>
                  <span className="text-[10px] font-bold">{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="Move down"
                    className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <GripVertical size={14} />
                  </button>
                </div>
                <div className="grid flex-1 gap-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                    <input
                      type="text"
                      placeholder="Title"
                      value={row.title}
                      onChange={(e) => patch(index, { title: e.target.value })}
                      className="min-h-[36px] rounded border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-800 focus:border-primary focus:ring-1 focus:ring-primary-light"
                    />
                    <select
                      value={row.icon || defaultIcon}
                      onChange={(e) => patch(index, { icon: e.target.value })}
                      className="min-h-[36px] rounded border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-primary focus:ring-1 focus:ring-primary-light"
                    >
                      {KNOWN_CONTENT_ICONS.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {withDescription && (
                    <textarea
                      placeholder="Short description (optional)"
                      rows={2}
                      value={row.description}
                      onChange={(e) => patch(index, { description: e.target.value })}
                      className="rounded border border-gray-200 bg-white p-2 text-xs text-gray-700 focus:border-primary focus:ring-1 focus:ring-primary-light"
                    />
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {withEnabled && (
                    <button
                      type="button"
                      onClick={() => patch(index, { isEnabled: row.isEnabled === false })}
                      className={`inline-flex min-h-[28px] items-center gap-1 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition ${
                        row.isEnabled === false
                          ? "border border-gray-200 bg-white text-gray-500"
                          : "bg-primary-light text-primary-dark"
                      }`}
                      title={row.isEnabled === false ? "Enable this item" : "Disable this item"}
                    >
                      {row.isEnabled === false ? <Square size={11} /> : <Check size={11} />}
                      {row.isEnabled === false ? "Disabled" : "Enabled"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label="Remove item"
                    className="inline-flex min-h-[28px] items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    <Trash2 size={11} />
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
