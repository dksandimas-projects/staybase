import { useState } from "react";
import { useAdmin, CorporateInquiry } from "../context/AdminContext";
import { Drawer } from "../components/Drawer";
import { StatusBadge } from "../components/StatusBadge";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Users, Plus, Mail, Phone, Calendar, ClipboardList, Send, Sparkles } from "lucide-react";
import config from "@config";

export function CorporateInquiriesPage() {
  const { 
    corporateInquiries, 
    updateInquiryStatus, 
    addInquiryNote,
    corporateCodes,
    addCorporateCode
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
        executive: parseFloat(corporateExecRate) || 4050
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
                <label className="grid gap-1 text-[10px] font-bold text-gray-450 uppercase">
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
                  <label className="grid gap-1.5 text-[10px] font-bold text-gray-500">
                    Negotiated Promo Code
                    <input
                      type="text"
                      required
                      value={promoCodeToGenerate}
                      onChange={(e) => setPromoCodeToGenerate(e.target.value.toUpperCase())}
                      className="min-h-[38px] w-full rounded border border-gray-200 bg-white px-2.5 text-xs font-mono"
                    />
                  </label>
                  
                  <label className="grid gap-1.5 text-[10px] font-bold text-gray-500">
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
                  <label className="grid gap-1.5 text-[10px] font-bold text-gray-500">
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
    </div>
  );
}
