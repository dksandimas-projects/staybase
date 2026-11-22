import { useState } from "react";
import { CheckCircle2, Eye, Pencil, ShieldCheck } from "lucide-react";
import { getIdVerificationState } from "@spark-inn/shared";
import { Booking } from "../context/AdminContext";

export interface IdSightPayload {
  idSightStatus: string;
  idSightNote: string;
  idSightBy: string;
  idSightAt: string;
}

interface GuestIdVerificationPanelProps {
  registration: Booking["guestRegistration"];
  /** Whether a photo copy of the guest's ID is on file. */
  hasPhoto: boolean;
  /** The acting staff member's display name (recorded with the attestation). */
  staffName: string;
  onSave: (payload: IdSightPayload) => void;
}

/**
 * Per Decision #338 (2026-11-22): the guest ID PHOTO is optional at
 * physical check-in. The mandatory ID evidence is this attestation —
 * the staff member confirms they sighted and verified the guest's
 * physical ID at the desk. A photo copy is still the strongest
 * evidence, so the panel keeps it one tap away, but a missing photo
 * no longer blocks the check-in: the staff records WHY instead.
 *
 * The desk's note is OPTIONAL (decision #339) — the attestation alone
 * is the evidence. The panel keeps the note as a free-text field for
 * context the next shift may want ("guest declined"), but nothing
 * blocks the save and nothing blocks the check-in.
 */
export function GuestIdVerificationPanel({
  registration,
  hasPhoto,
  staffName,
  onSave
}: GuestIdVerificationPanelProps) {
  const stored = getIdVerificationState({ registration, hasPhoto });

  const [sighted, setSighted] = useState(stored.sighted);
  const [note, setNote] = useState(stored.note);
  const [editing, setEditing] = useState(!stored.complete);

  const handleSave = () => {
    onSave({
      idSightStatus: sighted ? "sighted" : "",
      idSightNote: sighted ? note.trim() : "",
      idSightBy: sighted ? staffName : "",
      idSightAt: sighted ? new Date().toISOString() : ""
    });
    setEditing(false);
  };

  // ── Recorded state (collapsed) ────────────────────────────────────
  if (!editing && stored.complete) {
    return (
      <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <p className="text-[11px] font-bold text-gray-950">Physical ID sighted at the desk</p>
              <p className="mt-0.5 text-[10px] text-gray-600">
                {stored.sightedBy ? `Recorded by ${stored.sightedBy}` : "Recorded by the front desk"}
                {stored.sightedAt ? ` · ${formatSightedAt(stored.sightedAt)}` : ""}
              </p>
              <p className="mt-1 text-[10px] text-gray-600">
                {stored.hasPhoto
                  ? "ID photo attached."
                  : `No ID photo attached${stored.note ? ` — ${stored.note}` : ""}.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
          >
            <Pencil size={12} aria-hidden="true" />
            Edit
          </button>
        </div>
      </div>
    );
  }

  // ── Attestation form ──────────────────────────────────────────────
  return (
    <div className="rounded-card border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-gray-950">Confirm the guest&apos;s physical ID</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">
            The ID photo is optional. Tick the box to record that you sighted and verified the
            guest&apos;s physical ID. Add a note if it helps the next shift — e.g. the guest
            declined, or the ID has no camera-ready copy.
          </p>
        </div>
      </div>

      <label className="mt-3 flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-bold text-gray-800">
        <input
          type="checkbox"
          data-testid="guest-id-sight-checkbox"
          checked={sighted}
          onChange={(event) => setSighted(event.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <Eye size={14} className="shrink-0 text-gray-400" aria-hidden="true" />
        I sighted and verified the guest&apos;s physical ID
      </label>

      <label className="mt-2 flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
        Note (optional)
        <textarea
          data-testid="guest-id-sight-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={240}
          placeholder="e.g. guest declined to be photographed"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-800"
        />
      </label>

      <div className="mt-3 flex justify-end gap-2">
        {stored.complete ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          data-testid="guest-id-sight-save"
          onClick={handleSave}
          disabled={!sighted && !stored.complete}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 text-[10px] font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save ID verification
        </button>
      </div>
    </div>
  );
}

function formatSightedAt(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
