import { useState, useEffect } from "react";
import { useAdmin, Voucher, CorporateCode } from "../context/AdminContext";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { formatPrice } from "../utils/format";
import { useBreakpoint } from "../utils/useBreakpoint";
import {
  Plus, Tag, Gift, Trash2, Calendar, ShieldCheck,
  Landmark, Save, ShieldAlert, CreditCard, Landmark as BankIcon, Smartphone
} from "lucide-react";
import config from "@config";

export function RatesPage() {
  const {
    rooms,
    vouchers,
    addVoucher,
    toggleVoucherActive,
    corporateCodes,
    addCorporateCode,
    toggleCorporateCodeActive,
    deleteCorporateCode,
    hotelConfig,
    breakfastConfig,
    updateSettings,
    updateRoomConfig,
    roomTypes
  } = useAdmin();
  const { isMobile } = useBreakpoint();

  // Modal State
  const [isVchModalOpen, setIsVchModalOpen] = useState(false);
  const [isCorpModalOpen, setIsCorpModalOpen] = useState(false);

  // Two-click confirm state for the delete-corporate-code action.
  // Set to the code being confirmed; click 2 within 3s executes the delete.
  const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingDeleteCode) return;
    const timer = setTimeout(() => setPendingDeleteCode(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDeleteCode]);

  // Voucher Form States
  const [vchCode, setVchCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [usageCap, setUsageCap] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [applicableRooms, setApplicableRooms] = useState<string[]>([]);
  // Per W4.4 / decision #104: optional guest email — when set,
  // the server fires a voucher-issued email to the guest with
  // the code in a large monospace block.
  const [vchGuestEmail, setVchGuestEmail] = useState("");

  // Corporate Code Form States
  const [corpCode, setCorpCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  
  // Local pricing states per room type (Standard, Weekend, Flat Corporate)
  const [prices, setPrices] = useState<Record<string, { base: number; weekend: number; corporate: number }>>(() => {
    const initialPrices: Record<string, { base: number; weekend: number; corporate: number }> = {};
    roomTypes.forEach(t => {
      const match = rooms.find(r => r.type === t.value);
      initialPrices[t.value] = {
        base: match?.pricePerNight ?? 3200,
        weekend: match?.weekendRate ?? 3700,
        corporate: match?.corporateRate ?? 2880
      };
    });
    return initialPrices;
  });

  const [roomRates, setRoomRates] = useState<Record<string, string>>(() => {
    const initialRates: Record<string, string> = {};
    roomTypes.forEach(t => {
      initialRates[t.value] = "2880";
    });
    return initialRates;
  });

  // Keep prices and room rates in sync if room types change
  useEffect(() => {
    setPrices(prev => {
      const updated = { ...prev };
      roomTypes.forEach(t => {
        if (!updated[t.value]) {
          const match = rooms.find(r => r.type === t.value);
          updated[t.value] = {
            base: match?.pricePerNight ?? 3200,
            weekend: match?.weekendRate ?? 3700,
            corporate: match?.corporateRate ?? 2880
          };
        }
      });
      return updated;
    });

    setRoomRates(prev => {
      const updated = { ...prev };
      roomTypes.forEach(t => {
        if (!updated[t.value]) {
          updated[t.value] = "2880";
        }
      });
      return updated;
    });
  }, [roomTypes, rooms]);

  // Local breakfast rate state
  const [bfRate, setBfRate] = useState(String(breakfastConfig.ratePerPersonPerNight));

  // Local payment gateways states
  const [paymentMethods, setPaymentMethods] = useState<any[]>(() => {
    return hotelConfig.bookingPaymentMethods || [
      { method: "bank", label: "Bank Transfer", isEnabled: true, qrUrl: "bank-qr.png", accountInfo: "" },
      { method: "gcash", label: "GCash Wallet", isEnabled: true, qrUrl: "gcash-qr.png", accountInfo: "" },
      { method: "pay-at-hotel", label: "Pay at Hotel", isEnabled: true, qrUrl: "", accountInfo: "Pay in cash/card on arrival" }
    ];
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
      createdBy: "admin",
      guestEmail: vchGuestEmail.trim() || null
    });

    setVchCode("");
    setDiscountValue("");
    setUsageCap("");
    setExpiresAt("");
    setApplicableRooms([]);
    setIsVchModalOpen(false);
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
  };

  // Save room prices changes
  const handleSaveRates = async (e: React.FormEvent) => {
    e.preventDefault();
    const updates = rooms.map(room => {
      const typeRates = prices[room.type];
      if (typeRates) {
        return updateRoomConfig(room.id, {
          pricePerNight: typeRates.base,
          weekendRate: typeRates.weekend,
          corporateRate: typeRates.corporate
        });
      }
      return Promise.resolve();
    });
    await Promise.all(updates);
  };

  // Save breakfast pricing changes
  const handleSaveBreakfastRate = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("breakfastConfig", {
      ...breakfastConfig,
      ratePerPersonPerNight: parseFloat(bfRate) || 300
    });
  };

  // Save payment config changes
  const handleSavePayments = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("hotelConfig", {
      ...hotelConfig,
      bookingPaymentMethods: paymentMethods
    });
  };

  // Toggle payment method enabled/disabled
  const handleTogglePaymentMethod = (method: string) => {
    setPaymentMethods(prev => prev.map(m => m.method === method ? { ...m, isEnabled: !m.isEnabled } : m));
  };

  // Update payment method account details text
  const handleUpdateAccountInfo = (method: string, text: string) => {
    setPaymentMethods(prev => prev.map(m => m.method === method ? { ...m, accountInfo: text } : m));
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
    },
    {
      key: "action",
      header: "Actions",
      align: "end",
      render: (row) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => toggleCorporateCodeActive(row.code)}
            className={`min-h-[32px] px-3 rounded text-xs font-semibold shadow-sm transition ${
              row.isActive 
                ? "bg-red-50 text-red-700 hover:bg-red-100" 
                : "bg-green-50 text-green-700 hover:bg-green-100"
            }`}
          >
            {row.isActive ? "Deactivate" : "Activate"}
          </button>
          <button
            onClick={() => {
              if (pendingDeleteCode === row.code) {
                deleteCorporateCode(row.code);
                setPendingDeleteCode(null);
              } else {
                setPendingDeleteCode(row.code);
              }
            }}
            className={`min-h-[32px] px-3.5 inline-flex items-center gap-1 rounded text-xs font-semibold shadow-sm transition ${
              pendingDeleteCode === row.code
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-gray-50 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <Trash2 size={12} className="inline mr-1" />
            {pendingDeleteCode === row.code ? "Click to confirm" : "Delete"}
          </button>
        </div>
      )
    }
  ];

  const renderVoucherCard = (row: Voucher) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-bold text-primary-dark">{row.code}</span>
        <StatusBadge label={row.isActive ? "Active" : "Inactive"} status={row.isActive ? "confirmed" : "dirty"} />
      </div>
      <p className="text-base font-bold text-gray-900">
        {row.discountType === "percent" ? `${row.discountValue}% Off` : `${formatPrice(row.discountValue)} Off`}
      </p>
      <p className="text-xs text-gray-500">
        {row.usageCount} {row.usageCap ? `/ ${row.usageCap} limit` : "usages"} · {row.expiresAt || "Never expires"}
      </p>
    </div>
  );

  const renderCorpCard = (row: CorporateCode & { id: string }) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-bold text-primary-dark">{row.code}</span>
        <StatusBadge label={row.isActive ? "Active" : "Inactive"} status={row.isActive ? "confirmed" : "dirty"} />
      </div>
      <p className="text-base font-bold text-gray-900">{row.companyName}</p>
      <p className="text-xs text-gray-500">
        Double {formatPrice(row.ratePerRoomType["standard-double"] || 0)} · Exec {formatPrice(row.ratePerRoomType["executive"] || 0)} · {row.usageCount} bookings
      </p>
    </div>
  );

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">rates & promo configuration</h1>
        <p className="text-xs text-gray-500 mt-1">Configure base room pricing, weekend surcharges, public corporate rates, and payment gateways.</p>
      </header>

      {/* Grid: Core Pricing Systems */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column: Room Pricing Grid (2 cols wide on desktop) */}
        <div className="lg:col-span-2 rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-5">
          <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5 border-b border-gray-100 pb-3">
            <Landmark size={18} className="text-primary" />
            Tariff Rates Configurator
          </h2>

          <form onSubmit={handleSaveRates} className="space-y-5">
            {isMobile ? (
              <div className="space-y-3">
                {roomTypes.map((type) => (
                  <div key={type.value} className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">{type.label}</p>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">{type.value}</span>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Standard Rate (Base)</label>
                      <div className="relative mt-1 flex items-center">
                        <span className="absolute left-3 text-gray-400 font-semibold">{config.currencySymbol}</span>
                        <input
                          type="number"
                          required
                          min={0}
                          value={prices[type.value]?.base || 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPrices(prev => ({
                              ...prev,
                              [type.value]: { ...prev[type.value], base: val }
                            }));
                          }}
                          className="min-h-[44px] w-full rounded border border-gray-200 pl-7 pr-3 text-sm text-gray-800 font-medium"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Weekend Rate (Fri/Sat)</label>
                      <div className="relative mt-1 flex items-center">
                        <span className="absolute left-3 text-gray-400 font-semibold">{config.currencySymbol}</span>
                        <input
                          type="number"
                          required
                          min={0}
                          value={prices[type.value]?.weekend || 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPrices(prev => ({
                              ...prev,
                              [type.value]: { ...prev[type.value], weekend: val }
                            }));
                          }}
                          className="min-h-[44px] w-full rounded border border-gray-200 pl-7 pr-3 text-sm text-gray-800 font-medium"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Corporate Rate (Flat)</label>
                      <div className="relative mt-1 flex items-center">
                        <span className="absolute left-3 text-gray-400 font-semibold">{config.currencySymbol}</span>
                        <input
                          type="number"
                          required
                          min={0}
                          value={prices[type.value]?.corporate || 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPrices(prev => ({
                              ...prev,
                              [type.value]: { ...prev[type.value], corporate: val }
                            }));
                          }}
                          className="min-h-[44px] w-full rounded border border-gray-200 pl-7 pr-3 text-sm text-gray-800 font-medium"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-150 text-xs">
                  <thead>
                    <tr className="text-gray-400 font-bold uppercase text-[9px] tracking-wider text-left">
                      <th className="py-2.5">Room Type</th>
                      <th className="py-2.5">Standard Rate (Base)</th>
                      <th className="py-2.5">Weekend Rate (Fri/Sat)</th>
                      <th className="py-2.5">Corporate Rate (Flat)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {roomTypes.map((type) => (
                      <tr key={type.value} className="text-xs">
                        <td className="py-3 font-semibold text-gray-800">{type.label}</td>
                        <td className="py-2 pr-4">
                          <div className="relative flex items-center">
                            <span className="absolute left-2.5 text-gray-400 font-semibold">{config.currencySymbol}</span>
                            <input
                              type="number"
                              required
                              min={0}
                              value={prices[type.value]?.base || 0}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPrices(prev => ({
                                  ...prev,
                                  [type.value]: { ...prev[type.value], base: val }
                                }));
                              }}
                              className="min-h-[44px] w-full rounded border border-gray-200 pl-6 pr-2.5 text-xs text-gray-800 font-medium"
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="relative flex items-center">
                            <span className="absolute left-2.5 text-gray-400 font-semibold">{config.currencySymbol}</span>
                            <input
                              type="number"
                              required
                              min={0}
                              value={prices[type.value]?.weekend || 0}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPrices(prev => ({
                                  ...prev,
                                  [type.value]: { ...prev[type.value], weekend: val }
                                }));
                              }}
                              className="min-h-[44px] w-full rounded border border-gray-200 pl-6 pr-2.5 text-xs text-gray-800 font-medium"
                            />
                          </div>
                        </td>
                        <td className="py-2">
                          <div className="relative flex items-center">
                            <span className="absolute left-2.5 text-gray-400 font-semibold">{config.currencySymbol}</span>
                            <input
                              type="number"
                              required
                              min={0}
                              value={prices[type.value]?.corporate || 0}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPrices(prev => ({
                                  ...prev,
                                  [type.value]: { ...prev[type.value], corporate: val }
                                }));
                              }}
                              className="min-h-[44px] w-full rounded border border-gray-200 pl-6 pr-2.5 text-xs text-gray-800 font-medium"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
              <span className="text-[10px] text-gray-400 font-semibold leading-relaxed">
                Changes apply only to new bookings; existing reservations lock rates on creation.
              </span>
              <button
                type="submit"
                className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
              >
                <Save size={14} />
                Save Rates Matrix
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Breakfast & Discounts */}
        <div className="space-y-6">
          {/* Breakfast Card */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <h3 className="text-sm font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
              <Gift size={16} className="text-primary" />
              Breakfast & Discounts Config
            </h3>

            <form onSubmit={handleSaveBreakfastRate} className="space-y-4">
              <label className="flex flex-col gap-2 text-[10px] font-bold text-gray-500">
                Breakfast Service Charge (Per Guest / Night)
                <div className="relative flex items-center">
                  <span className="absolute left-2.5 text-gray-400 font-semibold">{config.currencySymbol}</span>
                  <input
                    type="number"
                    required
                    min={0}
                    value={bfRate}
                    onChange={(e) => setBfRate(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-200 pl-6 pr-2.5 text-xs text-gray-800 font-medium"
                  />
                </div>
              </label>

              <button
                type="submit"
                className="min-h-[38px] w-full rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white transition active:scale-95"
              >
                Update Breakfast Rate
              </button>
            </form>

            {/* Mandated Discounts (Read-only) */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">OSCA Legally Mandated Deductions</span>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-150 p-2.5 bg-gray-50/50 space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="font-semibold text-gray-650">Senior Citizen (OSCA)</span>
                  <span className="font-bold text-green-700">-20% Discount</span>
                </div>
                <div className="flex justify-between items-center text-[10px] pt-1.5">
                  <span className="font-semibold text-gray-655">Persons with Disabilities (PWD)</span>
                  <span className="font-bold text-green-700">-20% Discount</span>
                </div>
              </div>
              <p className="text-[9px] text-gray-400 leading-normal italic">
                * Governed by Philippine laws RA 9994 / RA 10754. Hardcoded values are locked from staff changes to maintain strict legal compliance.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Payment methods section */}
      <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-5">
        <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5 border-b border-gray-100 pb-3">
          <CreditCard size={18} className="text-primary" />
          Booking Payment Gateways
        </h2>

        <form onSubmit={handleSavePayments} className="space-y-4">
          <div className="grid gap-6 md:grid-cols-3">
            {paymentMethods.map((pm) => {
              const Icon = pm.method === "bank" ? BankIcon : pm.method === "gcash" ? Smartphone : CreditCard;
              return (
                <div key={pm.method} className={`rounded-xl border p-5 space-y-3.5 transition ${
                  pm.isEnabled ? "bg-white border-primary/20 ring-1 ring-primary/5" : "bg-gray-50/50 border-gray-200 opacity-60"
                }`}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2 font-bold text-xs text-gray-800">
                      <Icon size={16} className="text-primary" />
                      {pm.label}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePaymentMethod(pm.method)}
                      className={`h-5 w-9 rounded-full p-0.5 transition shrink-0 ${
                        pm.isEnabled ? "bg-primary" : "bg-gray-300"
                      }`}
                    >
                      <div className={`h-4 w-4 rounded-full bg-white transition transform ${
                        pm.isEnabled ? "translate-x-4" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  <label className="flex flex-col gap-1.5 text-[9px] font-bold text-gray-400 uppercase">
                    Account Info & Instructions
                    <input
                      type="text"
                      disabled={!pm.isEnabled}
                      value={pm.accountInfo}
                      onChange={(e) => handleUpdateAccountInfo(pm.method, e.target.value)}
                      className="min-h-[38px] w-full rounded border border-gray-200 bg-white px-2.5 text-xs text-gray-800 font-medium mt-1 disabled:opacity-50"
                    />
                  </label>

                  {pm.method !== "pay-at-hotel" && (
                    <div className="text-[10px] text-gray-500 font-semibold flex items-center gap-1.5">
                      <Smartphone size={12} className="text-gray-400" />
                      Remittance QR upload enabled
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button
              type="submit"
              className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
            >
              <Save size={14} />
              Save Payment Gateways
            </button>
          </div>
        </form>
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
          renderMobileCard={renderVoucherCard}
          emptyMessage="No vouchers configured yet."
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
          renderMobileCard={renderCorpCard}
          emptyMessage="No corporate codes configured yet."
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
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
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

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
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
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
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

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              Usage Cap (Limit)
              <input
                type="number"
                placeholder="Unlimited if empty"
                value={usageCap}
                onChange={(e) => setUsageCap(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              Expiration Date
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-255 px-3 text-sm"
              />
            </label>
          </div>

          {/* Per W4.4 / decision #104: optional guest email — when set, the
              server fires a voucher-issued email to the guest with the
              code in a large monospace block. */}
          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
            Guest Email (optional — sends the code to this address)
            <input
              type="email"
              placeholder="guest@example.com"
              value={vchGuestEmail}
              onChange={(e) => setVchGuestEmail(e.target.value)}
              className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
            />
            <span className="text-[10px] font-medium text-gray-500">Leave blank to keep the code in the admin only.</span>
          </label>

          {/* Room type check lists */}
          <div className="space-y-2">
            <p className="font-semibold text-gray-700">Applicable Room Layouts</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {roomTypes.map((t) => (
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
              className="min-h-[44px] px-5 rounded-lg border border-gray-255 text-xs font-semibold text-gray-700 hover:bg-gray-50"
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
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
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

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
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
              {roomTypes.map((t) => (
                <label key={t.value} className="flex flex-col gap-2 font-medium text-gray-600">
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
              className="min-h-[44px] px-5 rounded-lg border border-gray-255 text-xs font-semibold text-gray-700 hover:bg-gray-50"
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
