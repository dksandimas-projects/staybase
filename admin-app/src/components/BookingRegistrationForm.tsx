import { useState } from "react";
import { Booking } from "../context/AdminContext";
import { ClipboardCheck, Save, FileText } from "lucide-react";
import { getIdVerificationState } from "@spark-inn/shared";

interface BookingRegistrationFormProps {
  registration: Booking["guestRegistration"];
  status: Booking["status"];
  showEdit: boolean;
  onSetShowEdit: (v: boolean) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onPrintPdf: () => void;
  /**
   * Whether a photo copy of the guest's ID is on file. Per Decision
   * #338 (2026-11-22) the photo is OPTIONAL — this only shapes the
   * read-only summary line, never the form's required fields.
   */
  hasPhoto?: boolean;
  /**
   * The guest ID photo strip (preview + upload). Per Decision #340
   * (2026-11-23) it renders INSIDE this card so the whole check-in
   * capture is ONE form with ONE save button. The upload itself is
   * immediate — it never needed a save button of its own.
   */
  photoSlot?: React.ReactNode;
}

export function BookingRegistrationForm({
  registration: reg,
  status,
  showEdit,
  onSetShowEdit,
  onSubmit,
  onPrintPdf,
  hasPhoto = false,
  photoSlot
}: BookingRegistrationFormProps) {
  if (status !== "confirmed" && status !== "checked-in" && status !== "checked-out") return null;

  const isReadOnly = status === "checked-out";

  // Per Decision #338 (2026-11-22): the guest ID photo is optional.
  // The desk's attestation ("the physical ID was sighted") is the ID
  // evidence the check-in gate reads.
  const idVerification = getIdVerificationState({ registration: reg, hasPhoto });
  const idVerificationLabel = idVerification.sighted
    ? [
        `Sighted at the desk${idVerification.sightedBy ? ` by ${idVerification.sightedBy}` : ""}`,
        idVerification.hasPhoto
          ? "photo on file"
          : idVerification.note
            ? `no photo — ${idVerification.note}`
            : "no photo on file"
      ].join(" · ")
    : idVerification.hasPhoto
      ? "Photo on file — not yet sighted at the desk"
      : "Not yet sighted at the desk";

  const isComplete =
    reg?.signatureStatus === "signed" &&
    // Per Decision #340 (2026-11-23): the ID attestation is part of
    // THIS form now — so the form only collapses into its read-only
    // summary once the desk has attested the physical ID too. The
    // desk therefore always has one place to finish the check-in.
    reg?.idSightStatus === "sighted" &&
    reg?.nationality &&
    reg?.dateOfBirth &&
    reg?.gender &&
    // Per Decision #121 (2026-07-23): the purpose of stay is captured
    // at physical check-in. The "Other" branch carries the free-text
    // reason — captured too, but never a blocker (decision #344).
    reg?.purposeOfStay &&
    reg?.idNumber &&
    reg?.address &&
    reg?.emergencyContact &&
    (reg.purposeOfStay.trim().toLowerCase() !== "other" || !!reg?.otherPurpose?.trim());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
          <ClipboardCheck size={14} className="text-primary" />
          Check-in Registration
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
            reg?.signatureStatus === "signed"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-orange-50 text-orange-700"
          }`}
        >
          {reg?.signatureStatus === "signed" ? "Signed" : "Pending"}
        </span>
      </div>

      {(isComplete || isReadOnly) && !showEdit ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
          {photoSlot ? <div className="mb-3 border-b border-gray-100 pb-3">{photoSlot}</div> : null}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-gray-400">Nationality:</span>{" "}
              <span className="font-medium text-gray-800">{reg?.nationality}</span>
            </div>
            <div>
              <span className="text-gray-400">DOB:</span>{" "}
              <span className="font-medium text-gray-800">{reg?.dateOfBirth}</span>
            </div>
            <div>
              <span className="text-gray-400">Gender:</span>{" "}
              <span className="font-medium text-gray-800 capitalize">{reg?.gender}</span>
            </div>
            <div>
              <span className="text-gray-400">Purpose of stay:</span>{" "}
              <span className="font-medium text-gray-800">
                {reg?.purposeOfStay || "—"}
                {reg?.purposeOfStay?.trim().toLowerCase() === "other" && reg?.otherPurpose ? ` — ${reg.otherPurpose}` : ""}
              </span>
            </div>
            <div>
              <span className="text-gray-400">ID Type:</span>{" "}
              <span className="font-medium text-gray-800 capitalize">
                {reg?.idType?.replace(/-/g, " ")}
              </span>
            </div>
            <div>
              <span className="text-gray-400">ID Number:</span>{" "}
              <span className="font-medium text-gray-800">{reg?.idNumber}</span>
            </div>
            <div>
              <span className="text-gray-400">Emergency:</span>{" "}
              <span className="font-medium text-gray-800">{reg?.emergencyContact}</span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-400">Address:</span>{" "}
              <span className="font-medium text-gray-800">{reg?.address}</span>
            </div>
            {/* Per Decision #338 (2026-11-22) + #340 (2026-11-23):
                the ID verification line is read-only here — it is
                recorded by the SAME form, one save button below. */}
            <div className="col-span-2">
              <span className="text-gray-400">ID verification:</span>{" "}
              <span className="font-medium text-gray-800">{idVerificationLabel}</span>
            </div>
            {reg?.vehiclePlate && (
              <div className="col-span-2">
                <span className="text-gray-400">Vehicle:</span>{" "}
                <span className="font-medium text-gray-800">{reg?.vehiclePlate}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={onPrintPdf}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
            >
              <FileText size={13} />
              {isReadOnly ? "View / Download Registration PDF" : "Preview Registration PDF"}
            </button>
            {!isReadOnly && (
              <button
                type="button"
                onClick={() => onSetShowEdit(true)}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
              >
                <Save size={13} />
                Edit registration
              </button>
            )}
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            onSubmit(e);
            onSetShowEdit(false);
          }}
          className="rounded-lg border border-gray-200 bg-white p-5 space-y-4"
        >
          {photoSlot ? <div className="border-b border-gray-100 pb-4">{photoSlot}</div> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
              Nationality
              <input
                name="nationality"
                defaultValue={reg?.nationality ?? "Filipino"}
                className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
              Date of Birth
              <input
                name="dateOfBirth"
                type="date"
                defaultValue={reg?.dateOfBirth ?? ""}
                className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
              Gender
              <select
                name="gender"
                defaultValue={reg?.gender ?? ""}
                className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
              >
                <option value="">Select</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="prefer-not-to-say">Prefer not to say</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
              Purpose of stay
              <select
                name="purposeOfStay"
                defaultValue={reg?.purposeOfStay ?? "leisure"}
                className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
              >
                {/* Per Decision #121 (2026-07-23): the control opens with
                    Leisure selected. Staff can pick another supported
                    purpose before saving. "Other" requires a free-text
                    reason captured in the next field (otherPurpose) and
                    enforced by the check-in readiness gate. */}
                <option value="leisure">Leisure</option>
                <option value="business">Business</option>
                <option value="other">Other (specify below)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
              Valid ID Type
              <select
                name="idType"
                defaultValue={reg?.idType ?? "passport"}
                className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
              >
                <option value="passport">Passport</option>
                <option value="drivers-license">Driver's License</option>
                <option value="national-id">National ID</option>
                <option value="umid">UMID</option>
                <option value="other">Other Government ID</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
            {/* Per Decision #121 the reason is captured when the staff
                picks "Other". Per Decision #344 (2026-11-25) it is
                OPTIONAL — nothing here blocks the check-in — but it is
                always rendered (rather than conditionally shown) so
                the staff can pre-type a reason while the guest is
                thinking. It improves the form flow at the front desk. */}
            Purpose of stay — other reason
            <input
              name="otherPurpose"
              defaultValue={reg?.otherPurpose ?? ""}
              placeholder='e.g. "wedding", "medical", "long-stay relocation" — optional'
              className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
            ID Number
            <input
              name="idNumber"
              defaultValue={reg?.idNumber ?? ""}
              placeholder="Government ID reference"
              className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
            Home Address
            <textarea
              name="address"
              rows={2}
              defaultValue={reg?.address ?? ""}
              placeholder="Guest residential address"
              className="rounded border border-gray-200 p-2 text-xs text-gray-800"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
              Emergency Contact
              <input
                name="emergencyContact"
                defaultValue={reg?.emergencyContact ?? ""}
                placeholder="Name / Phone"
                className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
              Vehicle Plate
              <input
                name="vehiclePlate"
                defaultValue={reg?.vehiclePlate ?? ""}
                placeholder="Optional"
                className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
              />
            </label>
          </div>
          <label className="flex min-h-[38px] items-center gap-2 rounded border border-gray-200 px-2 text-[10px] font-bold text-gray-700">
            <input
              type="checkbox"
              name="signatureStatus"
              value="signed"
              defaultChecked={reg?.signatureStatus === "signed"}
              className="h-4 w-4 accent-primary"
            />
            Guest signed physical registration form
          </label>
          {/* Per Decision #338 (2026-11-22) + #340 (2026-11-23): the
              ID attestation lives in THIS form, so ONE save writes the
              registry fields AND the "physical ID sighted" record. The
              photo is optional; the attestation is what the check-in
              gate reads. */}
          <label className="flex min-h-[38px] items-center gap-2 rounded border border-gray-200 px-2 text-[10px] font-bold text-gray-700">
            <input
              type="checkbox"
              name="idSightStatus"
              value="sighted"
              data-testid="guest-id-sight-checkbox"
              defaultChecked={reg?.idSightStatus === "sighted"}
              className="h-4 w-4 accent-primary"
            />
            I sighted and verified the guest&apos;s physical ID
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
            Note (optional)
            <textarea
              name="idSightNote"
              data-testid="guest-id-sight-note"
              rows={2}
              maxLength={240}
              defaultValue={reg?.idSightNote ?? ""}
              placeholder="e.g. guest declined to be photographed"
              className="rounded border border-gray-200 p-2 text-xs text-gray-800"
            />
          </label>
          <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onPrintPdf}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
            >
              <FileText size={13} />
              Preview Registration PDF
            </button>
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white hover:bg-primary-dark"
            >
              <Save size={13} />
              Save Registration
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
