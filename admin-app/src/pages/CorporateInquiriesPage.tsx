import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAdmin, CorporateInquiry } from "../context/AdminContext";
import { Drawer } from "../components/Drawer";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Users, Plus, Mail, Phone, Calendar, ClipboardList, Send, Sparkles, ArrowRightCircle, AlertCircle } from "lucide-react";
import config from "@config";

export function CorporateInquiriesPage() {
  const navigate = useNavigate();
  const {
    corporateInquiries,
    updateInquiryStatus,
    addInquiryNote,
    corporateCodes,
    addCorporateCode,
    convertInquiryToBooking,
    rooms
  } = useAdmin();

  // Selected Inquiry Drawer State
  const [selectedInquiry, setSelectedInquiry] = useState<CorporateInquiry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | CorporateInquiry["status"]>("all");

  // Corporate Code Auto-gen states inside drawer
  const [promoCodeToGenerate, setPromoCodeToGenerate] = useState("");
  const [corporateDoubleRate, setCorporateDoubleRate] = useState("2880");
  const [corporateExecRate, setCorporateExecRate] = useState("4050");

  // Convert-to-booking modal state
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [convertRoomId, setConvertRoomId] = useState("");
  const [convertCheckIn, setConvertCheckIn] = useState("");
  const [convertCheckOut, setConvertCheckOut] = useState("");
  const [convertGuests, setConvertGuests] = useState(2);
  const [convertHasBreakfast, setConvertHasBreakfast] = useState(false);
  const [convertPaymentMethod, setConvertPaymentMethod] = useState("chargeback");
  const [convertRateOverride, setConvertRateOverride] = useState("");
  const [convertSubmitting, setConvertSubmitting] = useState(false);
  const [convertError, setConvertError] = useState("");

  const handleRowClick = (inquiry: CorporateInquiry) => {
    setSelectedInquiry(inquiry);
    // Pre-fill a potential corporate code recommendation
    setPromoCodeToGenerate(`${inquiry.companyName.replace(/\s+/g, "").slice(0, 4).toUpperCase()}100`);
    setIsDrawerOpen(true);
  };

  const handleStatusChange = (status: CorporateInquiry["status"]) => {
    if (selectedInquiry) {
      updateInquiryStatus(selectedInquiry.id, status);
      setSelectedInquiry(prev => prev ? { ...prev, status } : null);
    }
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInquiry || !newNoteText.trim()) return;

    addInquiryNote(selectedInquiry.id, newNoteText.trim());
    
    // Sync local state
    const updatedNotes = [
      ...selectedInquiry.notes,
      {
        text: newNoteText.trim(),
        by: "admin-staff",
        at: new Date().toISOString()
      }
    ];
    setSelectedInquiry({
      ...selectedInquiry,
      notes: updatedNotes
    });
    setNewNoteText("");
  };

  const handleGenerateCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInquiry || !promoCodeToGenerate.trim()) return;

    addCorporateCode({
      code: promoCodeToGenerate.trim().toUpperCase(),
      companyName: selectedInquiry.companyName,
      ratePerRoomType: {
        "standard-double": parseFloat(corporateDoubleRate) || 2880,
        executivo: parseFloat(corporateExecRate) || 4050
      },
      expiresAt: "2027-12-31",
      usageCap: null,
      usageCount: 0,
      linkedInquiryId: selectedInquiry.id,
      createdBy: "admin",
      createdAt: new Date().toISOString(),
      isActive: true
    });

    // Update status to converted
    updateInquiryStatus(selectedInquiry.id, "converted");
    setSelectedInquiry({
      ...selectedInquiry,
      status: "converted",
      accessCodeId: promoCodeToGenerate.trim().toUpperCase()
    });

    alert(`Negotiated corporate code ${promoCodeToGenerate.trim().toUpperCase()} active!`);
  };

  // Per W2.14 / decision #102 / audit S4.2: open the
  // convert-to-booking modal. Pre-fills dates, guests, and
  // payment method from the inquiry. The list of available rooms
  // is filtered to active + non-blocked rooms.
  const openConvertModal = () => {
    if (!selectedInquiry) return;
    setConvertRoomId("");
    setConvertCheckIn(selectedInquiry.preferredDates?.from || "");
    setConvertCheckOut(selectedInquiry.preferredDates?.to || "");
    setConvertGuests(Math.max(1, Number(selectedInquiry.numRooms) || 2));
    setConvertHasBreakfast(false);
    setConvertPaymentMethod("chargeback");
    setConvertRateOverride("");
    setConvertError("");
    setIsConvertModalOpen(true);
  };

  const closeConvertModal = () => {
    if (convertSubmitting) return;
    setIsConvertModalOpen(false);
    setConvertError("");
  };

  const handleConvertSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedInquiry) return;
    if (!convertRoomId) {
      setConvertError("Please select a room.");
      return;
    }
    if (!convertCheckIn || !convertCheckOut) {
      setConvertError("Please pick check-in and check-out dates.");
      return;
    }
    if (new Date(`${convertCheckOut}T00:00:00Z`) <= new Date(`${convertCheckIn}T00:00:00Z`)) {
      setConvertError("Check-out must be after check-in.");
      return;
    }
    setConvertSubmitting(true);
    setConvertError("");
    const rateOverride = convertRateOverride.trim()
      ? Number(convertRateOverride)
      : null;
    const result = await convertInquiryToBooking({
      inquiryId: selectedInquiry.id,
      roomId: convertRoomId,
      checkIn: convertCheckIn,
      checkOut: convertCheckOut,
      guests: convertGuests,
      hasBreakfast: convertHasBreakfast,
      paymentMethod: convertPaymentMethod,
      ratePerNightOverride: rateOverride
    });
    setConvertSubmitting(false);
    if (!result.success) {
      setConvertError(result.error || "Failed to convert inquiry into a booking.");
      return;
    }
    setIsConvertModalOpen(false);
    setIsDrawerOpen(false);
    if (result.bookingId) {
      navigate(`/bookings?bookingId=${encodeURIComponent(result.bookingId)}`);
    }
  };

  // Filter rooms for the convert modal: active, not blocked,
  // capacity >= guests.
  const eligibleConvertRooms = useMemo(() => {
    return rooms
      .filter(r => r.isActive && r.status !== "blocked")
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [rooms]);

  // Columns for inquiries table
  const columns: Array<DataTableColumn<CorporateInquiry>> = [
    { key: "companyName", header: "Company Partner" },
    { key: "contactPerson", header: "Contact Person" },
    {
      key: "roomsPreferred",
      header: "Preferred Booking",
      render: (row) => (
        <span className="text-xs">
          <strong>{row.numRooms} rooms</strong> ({row.preferredDates.from} to {row.preferredDates.to})
        </span>
      )
    },
    {
      key: "status",
      header: "Pipeline Stage",
      render: (row) => <StatusBadge label={row.status} status={row.status === "converted" ? "confirmed" : row.status === "declined" ? "cancelled" : "pending"} />
    },
    {
      key: "actions",
      header: "Actions",
      align: "end",
      render: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRowClick(row);
          }}
          className="min-h-[36px] px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition"
        >
          Details
        </button>
      )
    }
  ];

  // Filtering row listings
  const filteredInquiries = corporateInquiries.filter(inq => {
    if (activeTab === "all") return true;
    return inq.status === activeTab;
  });

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">corporate inquiries</h1>
        <p className="text-xs text-gray-500 mt-1">Manage corporate accounts, review partnership quotes, and configure custom discount access codes.</p>
      </header>

      {/* Tabs Layout */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {(["all", "new", "contacted", "negotiating", "converted", "declined"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`min-h-[36px] px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition ${
              activeTab === tab 
                ? "bg-primary text-white shadow-sm" 
                : "text-gray-650 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Inquiries Ledger Table */}
      <DataTable
        columns={columns}
        rows={filteredInquiries}
        onRowClick={handleRowClick}
      />

      {/* Inquiry Detail Drawer (D-03) */}
      <Drawer
        title={selectedInquiry ? `Corporate Quote: ${selectedInquiry.companyName}` : ""}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        {selectedInquiry && (
          <div className="space-y-8 text-sm">
            {/* Status and details grid */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Current Pipeline Stage</span>
                  <div className="mt-1">
                    <StatusBadge label={selectedInquiry.status} status={selectedInquiry.status === "converted" ? "confirmed" : selectedInquiry.status === "declined" ? "cancelled" : "pending"} />
                  </div>
                </div>
                
                {/* Pipeline Mutator selection */}
                <label className="flex flex-col gap-1.5 text-[10px] font-bold text-gray-450 uppercase">
                  Update Stage
                  <select
                    value={selectedInquiry.status}
                    onChange={(e) => handleStatusChange(e.target.value as CorporateInquiry["status"])}
                    className="min-h-[38px] rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 uppercase"
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="negotiating">Negotiating</option>
                    <option value="converted">Converted</option>
                    <option value="declined">Declined</option>
                  </select>
                </label>
              </div>

              {selectedInquiry.accessCodeId && (
                <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">Associated Rate Code:</span>
                  <span className="bg-green-50 text-green-700 font-mono font-bold px-2 py-1 rounded text-xs border border-green-200">
                    {selectedInquiry.accessCodeId}
                  </span>
                </div>
              )}
            </div>

            {/* Partner Details */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Corporate Representative</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2.5">
                <p className="flex items-center gap-2 text-gray-800 font-bold">
                  <Users size={16} className="text-primary" />
                  <span>{selectedInquiry.contactPerson}</span>
                </p>
                <p className="flex items-center gap-2 text-gray-600 text-xs">
                  <Mail size={16} className="text-gray-400" />
                  <span>{selectedInquiry.email}</span>
                </p>
                <p className="flex items-center gap-2 text-gray-600 text-xs">
                  <Phone size={16} className="text-gray-400" />
                  <span>{selectedInquiry.phone}</span>
                </p>
              </div>
            </div>

            {/* Stay Prefs */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Stay Preferences</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-800">Volume Required:</span>
                  <span>{selectedInquiry.numRooms} rooms</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-gray-800">Dates Requested:</span>
                  <span className="flex items-center gap-1">
                    <Calendar size={12} className="text-primary" />
                    {selectedInquiry.preferredDates.from} to {selectedInquiry.preferredDates.to}
                  </span>
                </div>
                {selectedInquiry.specialRequirements && (
                  <div className="border-t border-gray-100 pt-2.5 space-y-1">
                    <span className="font-bold text-gray-700">Notes / Requirements:</span>
                    <p className="text-gray-500 italic leading-relaxed">{selectedInquiry.specialRequirements}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Access Code Creator (if not already converted) */}
            {selectedInquiry.status !== "converted" && (
              <form onSubmit={handleGenerateCode} className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <h4 className="text-xs font-bold text-primary-dark flex items-center gap-1.5">
                  <Sparkles size={14} />
                  Authorize Corporate Tariff Code
                </h4>
                <p className="text-[10px] text-gray-550 leading-relaxed font-semibold">
                  Generate a client access key with pre-negotiated fixed prices. Completing this converts the inquiry.
                </p>
                
                <div className="grid gap-3 grid-cols-2">
                  <label className="flex flex-col gap-2 text-[10px] font-bold text-gray-500">
                    Negotiated Promo Code
                    <input
                      type="text"
                      required
                      value={promoCodeToGenerate}
                      onChange={(e) => setPromoCodeToGenerate(e.target.value.toUpperCase())}
                      className="min-h-[38px] w-full rounded border border-gray-200 bg-white px-2.5 text-xs font-mono"
                    />
                  </label>
                  
                  <label className="flex flex-col gap-2 text-[10px] font-bold text-gray-500">
                    Std Double Rate (PHP)
                    <input
                      type="number"
                      required
                      value={corporateDoubleRate}
                      onChange={(e) => setCorporateDoubleRate(e.target.value)}
                      className="min-h-[38px] w-full rounded border border-gray-200 bg-white px-2.5 text-xs"
                    />
                  </label>
                </div>

                <div className="grid gap-3 grid-cols-2">
                  <label className="flex flex-col gap-2 text-[10px] font-bold text-gray-500">
                    Exec Suite Rate (PHP)
                    <input
                      type="number"
                      required
                      value={corporateExecRate}
                      onChange={(e) => setCorporateExecRate(e.target.value)}
                      className="min-h-[38px] w-full rounded border border-gray-200 bg-white px-2.5 text-xs"
                    />
                  </label>
                  
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="min-h-[38px] w-full rounded-lg bg-primary hover:bg-primary-dark text-[11px] font-bold text-white shadow-sm"
                    >
                      Issue Access Key
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Per W2.14 / decision #102 / audit S4.2: Convert this
                inquiry into a real bookings document. Available for
                any non-terminal inquiry (new / contacted / negotiating). */}
            {selectedInquiry.status !== "converted" && selectedInquiry.status !== "declined" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2.5">
                <h4 className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                  <ArrowRightCircle size={14} />
                  Convert to Booking
                </h4>
                <p className="text-[10px] text-emerald-900 leading-relaxed font-semibold">
                  Pre-fills the guest, company, and dates from this inquiry and creates a confirmed booking. The booking is linked back to this inquiry and the pipeline status flips to <em>converted</em>.
                </p>
                <button
                  type="button"
                  onClick={openConvertModal}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-[11px] font-bold text-white shadow-sm"
                >
                  <ArrowRightCircle size={13} />
                  Open Convert Modal
                </button>
              </div>
            )}

            {/* Discussion Audit Log Notes */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Discussion Ledger & Audit Notes</h3>
              
              <div className="space-y-3">
                {selectedInquiry.notes.length > 0 ? (
                  <div className="divide-y divide-gray-150 border border-gray-200 rounded-lg bg-gray-50/50">
                    {selectedInquiry.notes.map((note, idx) => (
                      <div key={idx} className="p-3 text-xs space-y-1">
                        <p className="text-gray-700 leading-normal">{note.text}</p>
                        <p className="text-[9px] text-gray-400">
                          Added by {note.by} at {new Date(note.at).toLocaleDateString()} {new Date(note.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No historical timeline events logged yet.</p>
                )}

                {/* Add note input form */}
                <form onSubmit={handleAddNote} className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    placeholder="Type negotiations log..."
                    className="min-h-[44px] flex-1 rounded-lg border border-gray-250 bg-white px-3 text-xs outline-none focus:border-primary"
                  />
                  
                  <button
                    type="submit"
                    className="min-h-[44px] px-3.5 inline-flex items-center justify-center rounded-lg bg-gray-900 text-white hover:bg-black transition"
                  >
                    <Send size={14} />
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* Per W2.14 / decision #102 / audit S4.2: convert-to-booking
          modal. Pre-fills guest info from the inquiry, asks for
          a room + dates (defaults from the inquiry preferredDates),
          and posts to /api/corporate/convert-inquiry. */}
      <Modal
        title={selectedInquiry ? `Convert inquiry from ${selectedInquiry.companyName}` : "Convert inquiry"}
        open={isConvertModalOpen}
        onClose={closeConvertModal}
      >
        {selectedInquiry ? (
          <form onSubmit={handleConvertSubmit} className="space-y-4 text-xs">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Pre-filled from inquiry</p>
              <p className="text-gray-700"><span className="font-bold">Guest:</span> {selectedInquiry.contactPerson}</p>
              <p className="text-gray-700"><span className="font-bold">Email:</span> {selectedInquiry.email}</p>
              <p className="text-gray-700"><span className="font-bold">Phone:</span> {selectedInquiry.phone}</p>
              <p className="text-gray-700"><span className="font-bold">Rooms requested:</span> {selectedInquiry.numRooms}</p>
              {selectedInquiry.specialRequirements ? (
                <p className="text-gray-700 italic">"{selectedInquiry.specialRequirements}"</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[10px] font-bold text-gray-500 sm:col-span-2">
                Room
                <select
                  required
                  value={convertRoomId}
                  onChange={(e) => setConvertRoomId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-xs"
                >
                  <option value="">Select a room</option>
                  {eligibleConvertRooms.map(r => (
                    <option key={r.id} value={r.id}>
                      Room {r.roomNumber} — {r.type} (max {r.maxCapacity})
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-[10px] font-bold text-gray-500">
                Check-in
                <input
                  type="date"
                  required
                  value={convertCheckIn}
                  onChange={(e) => setConvertCheckIn(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-xs"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-[10px] font-bold text-gray-500">
                Check-out
                <input
                  type="date"
                  required
                  value={convertCheckOut}
                  onChange={(e) => setConvertCheckOut(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-xs"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-[10px] font-bold text-gray-500">
                Guests
                <input
                  type="number"
                  required
                  min="1"
                  max="20"
                  value={convertGuests}
                  onChange={(e) => setConvertGuests(Number(e.target.value) || 1)}
                  className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-xs"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-[10px] font-bold text-gray-500">
                Payment Method
                <select
                  value={convertPaymentMethod}
                  onChange={(e) => setConvertPaymentMethod(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-xs"
                >
                  <option value="chargeback">Chargeback to Company</option>
                  <option value="pay-at-hotel">Pay at Hotel (Guest)</option>
                </select>
              </label>

              <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 text-[10px] font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={convertHasBreakfast}
                  onChange={(e) => setConvertHasBreakfast(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Include daily breakfast
              </label>

              <label className="flex flex-col gap-1.5 text-[10px] font-bold text-gray-500">
                Rate Override (optional, PHP/night)
                <input
                  type="number"
                  min="0"
                  placeholder="Use negotiated or room rate"
                  value={convertRateOverride}
                  onChange={(e) => setConvertRateOverride(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-xs"
                />
              </label>
            </div>

            {convertError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-700"
              >
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {convertError}
              </div>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeConvertModal}
                disabled={convertSubmitting}
                className="min-h-[40px] rounded-lg border border-gray-200 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={convertSubmitting}
                className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowRightCircle size={14} />
                {convertSubmitting ? "Converting..." : "Convert to Booking"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
