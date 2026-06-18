import { useState } from "react";
import { useAdmin, Member, PointsLog } from "../context/AdminContext";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { Award, User, Mail, Phone, Calendar, Plus, ShieldAlert, AwardIcon, Coins, History } from "lucide-react";
import config from "@config";

export function MembersPage() {
  const { 
    members, 
    updateMemberPoints, 
    toggleMemberActive 
  } = useAdmin();
  const toast = useToast();

  // Search and Drawer state
  const [searchText, setSearchText] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Points adjustment form states
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState<PointsLog["type"]>("manual");
  const [adjustReason, setAdjustReason] = useState("");

  const handleRowClick = (member: Member) => {
    setSelectedMember(member);
    setIsDrawerOpen(true);
  };

  const handlePointsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember || !adjustAmount || !adjustReason.trim()) return;

    const amountNum = parseInt(adjustAmount);
    if (isNaN(amountNum)) return;

    // Call context modifier
    updateMemberPoints(selectedMember.id, amountNum, adjustType, adjustReason.trim());

    // Update selected member details in drawer state
    const nextPoints = selectedMember.rewardsPoints + amountNum;
    const newHistoryEntry: PointsLog = {
      id: `pt-${Date.now()}`,
      type: adjustType,
      points: amountNum,
      description: adjustType === "manual" ? `Manual Adjust (${adjustReason.trim()})` : "Loyalty reward",
      reason: adjustReason.trim(),
      bookingId: null,
      by: "admin-staff",
      at: new Date().toISOString()
    };

    setSelectedMember({
      ...selectedMember,
      rewardsPoints: Math.max(0, nextPoints),
      pointsHistory: [newHistoryEntry, ...selectedMember.pointsHistory]
    });

    setAdjustAmount("");
    setAdjustReason("");
    toast.success("Points balance updated", `${amountNum > 0 ? "+" : ""}${amountNum} pts — ${adjustType}`);
  };

  const handleToggleAccount = () => {
    if (selectedMember) {
      toggleMemberActive(selectedMember.id);
      setSelectedMember(prev => prev ? { ...prev, isActive: !prev.isActive } : null);
    }
  };

  // DataTable column definitions
  const columns: Array<DataTableColumn<Member>> = [
    { key: "memberNumber", header: "Member ID" },
    { key: "fullName", header: "Full Name" },
    { key: "email", header: "Email Address" },
    {
      key: "rewardsPoints",
      header: "Spark Points",
      align: "end",
      render: (row) => <strong className="font-bold">{row.rewardsPoints} pts</strong>
    },
    {
      key: "tier",
      header: "Tier",
      render: (row) => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
          row.tier === "gold" 
            ? "bg-yellow-50 text-yellow-700 border border-yellow-250" 
            : row.tier === "silver" 
            ? "bg-slate-100 text-slate-700 border border-slate-200" 
            : "bg-orange-50 text-orange-700 border border-orange-200"
        }`}>
          <Award size={10} />
          {row.tier}
        </span>
      )
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <StatusBadge label={row.isActive ? "Active" : "Suspended"} status={row.isActive ? "confirmed" : "dirty"} />
      )
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

  const renderMemberCard = (row: Member) => {
    const isSuspended = !row.isActive;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-base font-bold text-gray-900">{row.fullName}</p>
          <StatusBadge label={row.isActive ? "Active" : "Suspended"} status={row.isActive ? "confirmed" : "dirty"} />
        </div>
        <p className="text-xs text-gray-600">{row.email}</p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Member Since</p>
            <p className="text-xs text-gray-700">{row.memberSince}</p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${
              isSuspended ? "bg-gray-100 text-gray-500" : "bg-primary text-white"
            }`}
          >
            {row.rewardsPoints} pts
          </span>
        </div>
      </div>
    );
  };

  // Filtering row listings based on search box input
  const filteredMembers = members.filter(member => 
    member.fullName.toLowerCase().includes(searchText.toLowerCase()) ||
    member.email.toLowerCase().includes(searchText.toLowerCase()) ||
    member.memberNumber.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">Spark Rewards Members</h1>
        <p className="text-xs text-gray-500 mt-1">Audit guest loyalty profiles, execute points corrections, and inspect membership tiers.</p>
      </header>

      {/* Toolbar filter */}
      <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 flex gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search members by Name, Email, or Member ID..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm outline-none transition focus:border-primary focus:bg-white"
          />
        </div>
      </div>

      {/* Main Ledger Table */}
      <DataTable
        columns={columns}
        rows={filteredMembers}
        onRowClick={handleRowClick}
        renderMobileCard={renderMemberCard}
        emptyMessage="No members match the current search."
        mobileCardShowChevron
      />

      {/* Member Details Drawer (D-04) */}
      <Drawer
        title={selectedMember ? `Loyalty Profile: ${selectedMember.fullName}` : ""}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        {selectedMember && (
          <div className="space-y-8 text-sm">
            {/* Account Profile Status */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Account Active Tier</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      selectedMember.tier === "gold" 
                        ? "bg-yellow-50 text-yellow-700 border border-yellow-250" 
                        : "bg-orange-50 text-orange-700 border border-orange-200"
                    }`}>
                      <Award size={10} />
                      {selectedMember.tier}
                    </span>
                    <StatusBadge label={selectedMember.isActive ? "Active" : "Suspended"} status={selectedMember.isActive ? "confirmed" : "dirty"} />
                  </div>
                </div>

                <button
                  onClick={handleToggleAccount}
                  className={`min-h-[36px] px-3.5 rounded-lg text-xs font-bold shadow-sm transition ${
                    selectedMember.isActive
                      ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                      : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                  }`}
                >
                  {selectedMember.isActive ? "Suspend Profile" : "Activate Profile"}
                </button>
              </div>

              {/* General details grid */}
              <div className="grid gap-2 text-xs border-t border-gray-200 pt-3 text-gray-650">
                <div className="flex justify-between">
                  <span>Loyalty ID:</span>
                  <strong className="font-bold text-gray-800">{selectedMember.memberNumber}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Member Since:</span>
                  <span>{selectedMember.memberSince}</span>
                </div>
                <div className="flex justify-between">
                  <span>Login Portal:</span>
                  <span className="capitalize">{selectedMember.authProvider} Credentials</span>
                </div>
              </div>
            </div>

            {/* Profile Contact info */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact Records</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2.5">
                <p className="flex items-center gap-2 text-gray-800">
                  <User size={16} className="text-primary shrink-0" />
                  <span>{selectedMember.fullName}</span>
                </p>
                <p className="flex items-center gap-2 text-gray-600 text-xs">
                  <Mail size={16} className="text-gray-400 shrink-0" />
                  <span>{selectedMember.email}</span>
                </p>
                <p className="flex items-center gap-2 text-gray-600 text-xs">
                  <Phone size={16} className="text-gray-400 shrink-0" />
                  <span>{selectedMember.phone}</span>
                </p>
              </div>
            </div>

            {/* Points Ledger Balance panel */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rewards Summary</h3>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-[10px] text-primary-dark font-bold uppercase tracking-widest">Active points balance</span>
                  <p className="font-heading text-3xl text-gray-950 leading-none">{selectedMember.rewardsPoints} PTS</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-white border border-primary/20 text-primary flex items-center justify-center shadow-sm">
                  <Coins size={20} />
                </div>
              </div>
            </div>

            {/* Points adjustment form */}
            <form onSubmit={handlePointsSubmit} className="rounded-lg border border-gray-150 p-4 space-y-3 bg-white">
              <h4 className="text-xs font-bold text-gray-750 flex items-center gap-1">
                <AwardIcon size={14} className="text-primary" />
                Adjust Member Points Balance
              </h4>

              <div className="grid gap-3 grid-cols-2">
                <label className="flex flex-col gap-2 text-[10px] font-bold text-gray-500">
                  Points Adjustment Value
                  <input
                    type="number"
                    required
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="e.g. 500 or -200"
                    className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                  />
                </label>

                <label className="flex flex-col gap-2 text-[10px] font-bold text-gray-500">
                  Transaction Classification
                  <select
                    value={adjustType}
                    onChange={(e) => setAdjustType(e.target.value as PointsLog["type"])}
                    className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                  >
                    <option value="earn">Earn (Credits)</option>
                    <option value="redeem">Redeem (Deductions)</option>
                    <option value="manual">Manual Corrections</option>
                    <option value="expire">Expiration</option>
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-2 text-[10px] font-bold text-gray-500">
                Audited Reason for Adjustment
                <input
                  type="text"
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Courtesy compensation for check-in delays"
                  className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                />
              </label>

              <button
                type="submit"
                className="min-h-[36px] w-full rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm"
              >
                Log Points Update
              </button>
            </form>

            {/* Historical transaction logs feed */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <History size={12} />
                Transaction History Ledger
              </h3>

              <div className="divide-y divide-gray-150 border border-gray-200 rounded-lg max-h-[200px] overflow-y-auto pr-1">
                {selectedMember.pointsHistory.length > 0 ? (
                  selectedMember.pointsHistory.map((log) => {
                    const isPositive = log.points > 0;
                    return (
                      <div key={log.id} className="p-3 flex justify-between items-start text-xs bg-gray-50/50">
                        <div>
                          <p className="font-semibold text-gray-800 capitalize">{log.description}</p>
                          <p className="text-[9px] text-gray-450 mt-0.5 leading-normal">
                            Reason: {log.reason} • By {log.by} at {log.at.split("T")[0]}
                          </p>
                        </div>

                        <span className={`font-bold shrink-0 text-right ${
                          isPositive ? "text-green-700" : "text-red-700"
                        }`}>
                          {isPositive ? `+${log.points}` : log.points} pts
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-gray-400 italic p-3 text-center">No points transactions recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
