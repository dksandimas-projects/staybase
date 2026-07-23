import { useState } from "react";
import { Booking } from "../context/AdminContext";
import { ClipboardCheck, Save, FileText } from "lucide-react";

interface BookingRegistrationFormProps {
  registration: Booking["guestRegistration"];
  status: Booking["status"];
  showEdit: boolean;
  onSetShowEdit: (v: boolean) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onPrintPdf: () => void;
}

export function BookingRegistrationForm({
  registration: reg,
  status,
  showEdit,
  onSetShowEdit,
  onSubmit,
  onPrintPdf,
}: BookingRegistrationFormProps) {
  if (status !== "confirmed" && status !== "checked-in" && status !== "checked-out") return null;

  const isReadOnly = status === "checked-out";

  const isComplete =
    reg?.signatureStatus === "signed" &&
    reg?.nationality &&
    reg?.dateOfBirth &&
    reg?.gender &&
    reg?.idNumber &&
    reg?.address &&
    reg?.emergencyContact;

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
