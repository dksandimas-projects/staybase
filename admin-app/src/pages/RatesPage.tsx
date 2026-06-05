import { useState } from "react";
import { useAdmin, Voucher, CorporateCode } from "../context/AdminContext";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { formatPrice } from "../utils/format";
import { Plus, Tag, Gift, Trash2, Calendar, ShieldCheck, Landmark } from "lucide-react";
import config from "@config";

export function RatesPage() {
  const { 
    rooms,
    vouchers, 
    addVoucher, 
    toggleVoucherActive, 
    corporateCodes, 
    addCorporateCode 
  } = useAdmin();

  // Modal State
  const [isVchModalOpen, setIsVchModalOpen] = useState(false);
  const [isCorpModalOpen, setIsCorpModalOpen] = useState(false);

  // Voucher Form States
  const [vchCode, setVchCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [usageCap, setUsageCap] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [applicableRooms, setApplicableRooms] = useState<string[]>([]);

  // Corporate Code Form States
  const [corpCode, setCorpCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [roomRates, setRoomRates] = useState<Record<string, string>>({
    single: "2880",
    "standard-double": "2880",
    "standard-twin": "2880",
    executive: "4050",
    family: "6750"
  });

  // Toggle applicable room checkbox
  const handleRoomCheckbox = (typeVal: string) => {
    if (applicableRooms.includes(typeVal)) {
      setApplicableRooms(prev => prev.filter(t => t !== typeVal));
    } else {
      setApplicableRooms(prev => [...prev, typeVal]);
    }
  };

  const handleVoucherSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vchCode || !discountValue) return;

    addVoucher({
      code: vchCode.trim().toUpperCase(),
      discountType,
      discountValue: parseFloat(discountValue) || 0,
      usageCap: usageCap ? parseInt(usageCap) : null,
      expiresAt: expiresAt || null,
      applicableRoomTypes: applicableRooms,
      isActive: true,
      createdBy: "admin"
    });

    // Reset fields
    setVchCode("");
    setDiscountValue("");
    setUsageCap("");
    setExpiresAt("");
    setApplicableRooms([]);
    setIsVchModalOpen(false);
    alert("Promo voucher created successfully!");
  };

  const handleCorpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!corpCode || !companyName) return;

    const rateMap: Record<string, number> = {};
    Object.keys(roomRates).forEach(k => {
      rateMap[k] = parseFloat(roomRates[k]) || 0;
    });

    addCorporateCode({
      code: corpCode.trim().toUpperCase(),
      companyName,
      ratePerRoomType: rateMap,
      expiresAt: "2027-12-31",
      usageCap: null,
      usageCount: 0,
      linkedInquiryId: "",
      createdBy: "admin",
      createdAt: new Date().toISOString(),
      isActive: true
    });

    setCorpCode("");
    setCompanyName("");
    setIsCorpModalOpen(false);
    alert("Negotiated corporate access code created successfully!");
  };

  // Voucher Columns
  const voucherColumns: Array<DataTableColumn<Voucher>> = [
    { key: "code", header: "Voucher Code" },
    {
      key: "discountValue",
      header: "Value",
      render: (row) => (
        <span>
          {row.discountType === "percent" ? `${row.discountValue}% Off` : `${formatPrice(row.discountValue)} Off`}
        </span>
      )
    },
    {
      key: "usageCount",
      header: "Usage Count",
      render: (row) => (
        <span className="text-xs">
          {row.usageCount} {row.usageCap ? `/ ${row.usageCap} limit` : "usages"}
        </span>
      )
    },
    {
      key: "expiresAt",
      header: "Expiration",
      render: (row) => <span className="text-xs text-gray-500">{row.expiresAt || "Never"}</span>
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <StatusBadge label={row.isActive ? "Active" : "Inactive"} status={row.isActive ? "confirmed" : "dirty"} />
      )
    },
    {
      key: "action",
      header: "Actions",
      align: "end",
      render: (row) => (
        <button
          onClick={() => toggleVoucherActive(row.id)}
          className={`min-h-[32px] px-3 rounded text-xs font-semibold shadow-sm transition ${
            row.isActive 
              ? "bg-red-50 text-red-700 hover:bg-red-100" 
              : "bg-green-50 text-green-700 hover:bg-green-100"
          }`}
        >
          {row.isActive ? "Deactivate" : "Activate"}
        </button>
      )
    }
  ];

  // Corporate Code Columns
  const corpColumns: Array<DataTableColumn<CorporateCode & { id: string }>> = [
    { key: "code", header: "Negotiated Code" },
    { key: "companyName", header: "Company Partner" },
    {
      key: "rates",
      header: "Custom Rates",
      render: (row) => (
        <span className="text-[11px] text-gray-500">
          Double: <strong>{formatPrice(row.ratePerRoomType["standard-double"] || 0)}</strong> • Exec: <strong>{formatPrice(row.ratePerRoomType["executive"] || 0)}</strong>
        </span>
      )
    },
    {
      key: "usageCount",
      header: "Usage",
      render: (row) => <span className="text-xs">{row.usageCount} bookings</span>
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <StatusBadge label={row.isActive ? "Active" : "Inactive"} status={row.isActive ? "confirmed" : "dirty"} />
      )
    }
  ];

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">rates & promo codes</h1>
        <p className="text-xs text-gray-500 mt-1">Configure weekend rate surcharges, negotiable corporate partnerships, and public vouchers.</p>
      </header>

      {/* Row: Surcharges info and Corporate Actions */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Base Rate & Weekend surcharges */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
            <Landmark size={18} className="text-primary" />
            Tariff Surcharges Config
          </h2>
          
          <div className="rounded-lg border border-gray-150 p-4 space-y-3 bg-gray-50/50">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-gray-700">Weekend Surcharge</span>
              <span className="text-xs bg-primary/10 text-primary-dark font-bold px-2 py-0.5 rounded">
                +₱500 / night
              </span>
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed font-semibold">
              Weekend surcharge is automatically added to checking days falling on Friday or Saturday nights. Calculated dynamically.
            </p>
          </div>
        </div>

        {/* Member Discount */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
            <Gift size={18} className="text-primary" />
            Member Loyalty Discount
          </h2>
          
          <div className="rounded-lg border border-gray-150 p-4 space-y-3 bg-gray-50/50">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-gray-700">Spark Member Discount</span>
              <span className="text-xs bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded border border-green-200">
                10% Off Base Room
              </span>
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed font-semibold">
              Logged-in loyalty program subscribers receive a flat 10% deduction off base rates. Configured in Settings tab.
            </p>
          </div>
        </div>
      </div>

      {/* Vouchers Panel */}
      <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
            <Tag size={18} className="text-primary" />
            Vouchers & Promo Codes
          </h2>
          
          <button
            onClick={() => setIsVchModalOpen(true)}
            className="min-h-[36px] px-3.5 inline-flex items-center gap-1 rounded bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
          >
            <Plus size={14} />
            Create Voucher
          </button>
        </div>

        <DataTable
          columns={voucherColumns}
          rows={vouchers}
        />
      </div>

      {/* Corporate codes panel */}
      <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
            <ShieldCheck size={18} className="text-primary" />
            Corporate Negotiated Rates
          </h2>
          
          <button
            onClick={() => setIsCorpModalOpen(true)}
            className="min-h-[36px] px-3.5 inline-flex items-center gap-1 rounded bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
          >
            <Plus size={14} />
            Add Corporate Code
          </button>
        </div>

        <DataTable
          columns={corpColumns}
          rows={corporateCodes.map(c => ({ ...c, id: c.code }))}
        />
      </div>

      {/* Modal: Create Voucher (M-06) */}
      <Modal
        title="Create Promo Voucher"
        open={isVchModalOpen}
        onClose={() => setIsVchModalOpen(false)}
      >
        <form onSubmit={handleVoucherSubmit} className="space-y-4 text-xs font-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-gray-750">
              Voucher Code
              <input
                type="text"
                required
                placeholder="e.g. SUMMER2026"
                value={vchCode}
                onChange={(e) => setVchCode(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-gray-750">
              Discount Type
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as "percent" | "flat")}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm bg-white"
              >
                <option value="percent">Percentage (%)</option>
                <option value="flat">Fixed Amount (PHP)</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-1.5 text-xs font-semibold text-gray-750">
              Discount Value
              <input
                type="number"
                required
                placeholder="e.g. 20"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-gray-750">
              Usage Cap (Limit)
              <input
                type="number"
                placeholder="Unlimited if empty"
                value={usageCap}
                onChange={(e) => setUsageCap(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-gray-750">
              Expiration Date
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm"
              />
            </label>
          </div>

          {/* Room type check lists */}
          <div className="space-y-2">
            <p className="font-semibold text-gray-700">Applicable Room Layouts</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {config.roomTypes.map((t) => (
                <label key={t.value} className="flex items-center gap-2 cursor-pointer font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={applicableRooms.includes(t.value)}
                    onChange={() => handleRoomCheckbox(t.value)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-4 justify-end">
            <button
              type="button"
              onClick={() => setIsVchModalOpen(false)}
              className="min-h-[44px] px-5 rounded-lg border border-gray-250 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" className="min-w-[150px]">
              Spawn Voucher
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* Modal: Create Corporate Code */}
      <Modal
        title="Add Corporate Partner Code"
        open={isCorpModalOpen}
        onClose={() => setIsCorpModalOpen(false)}
      >
        <form onSubmit={handleCorpSubmit} className="space-y-4 text-xs font-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-gray-750">
              Negotiated Access Code
              <input
                type="text"
                required
                placeholder="e.g. GLOBE2026"
                value={corpCode}
                onChange={(e) => setCorpCode(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-gray-750">
              Company Partner Name
              <input
                type="text"
                required
                placeholder="Globe Telecom"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>
          </div>

          <div className="space-y-2.5 pt-2">
            <p className="font-semibold text-gray-700">Set Custom Flat Rate per Room Type (PHP)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {config.roomTypes.map((t) => (
                <label key={t.value} className="grid gap-1.5 font-medium text-gray-600">
                  {t.label} (Base: ₱{rooms.find(r => r.type === t.value)?.pricePerNight || 3200})
                  <input
                    type="number"
                    value={roomRates[t.value] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRoomRates(prev => ({ ...prev, [t.value]: val }));
                    }}
                    className="min-h-[38px] w-full rounded border border-gray-255 px-2 text-xs text-gray-900 font-medium"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-4 justify-end">
            <button
              type="button"
              onClick={() => setIsCorpModalOpen(false)}
              className="min-h-[44px] px-5 rounded-lg border border-gray-250 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" className="min-w-[150px]">
              Confirm Partnership
            </PrimaryButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
