import { useState } from "react";
import { useAdmin } from "../context/AdminContext";
import { 
  Settings, Globe, Gift, Coffee, ShoppingBag, 
  Save, Landmark, Sparkles, Check, CheckSquare, Square 
} from "lucide-react";
import config from "@config";

type TabId = "hotel" | "website" | "rewards" | "breakfast" | "store";

export function SettingsPage() {
  const { 
    hotelConfig, 
    websiteContent, 
    rewardsConfig, 
    breakfastConfig, 
    storeConfig, 
    updateSettings 
  } = useAdmin();

  // Active Settings Section Tab
  const [activeTab, setActiveTab] = useState<TabId>("hotel");

  // Local state form mirrors
  // 1. Hotel Config Form States
  const [hotelName, setHotelName] = useState(hotelConfig.hotelName);
  const [contactEmail, setContactEmail] = useState(hotelConfig.contactEmail);
  const [contactPhone, setContactPhone] = useState(hotelConfig.contactPhone);
  const [checkInTime, setCheckInTime] = useState(hotelConfig.checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(hotelConfig.checkOutTime);
  const [missionStatement, setMissionStatement] = useState(hotelConfig.missionStatement);
  const [hotelStory, setHotelStory] = useState(hotelConfig.hotelStory);

  // 2. Website Content states
  const [heroHeading, setHeroHeading] = useState(websiteContent.homepage.heroHeading);
  const [heroSubtext, setHeroSubtext] = useState(websiteContent.homepage.heroSubtext);
  const [corpHeading, setCorpHeading] = useState(websiteContent.corporate.heroHeading);
  const [corpSubtext, setCorpSubtext] = useState(websiteContent.corporate.heroSubtext);

  // 3. Rewards Config states
  const [pointsEnabled, setPointsEnabled] = useState(rewardsConfig.pointsEnabled);
  const [pointsPerHundred, setPointsPerHundred] = useState(String(rewardsConfig.pointsPerHundred));
  const [memberDiscountEnabled, setMemberDiscountEnabled] = useState(rewardsConfig.memberDiscountEnabled);
  const [memberDiscountPct, setMemberDiscountPct] = useState(String(rewardsConfig.memberDiscountPct));

  // 4. Breakfast Config states
  const [breakfastEnabled, setBreakfastEnabled] = useState(breakfastConfig.isEnabled);
  const [breakfastRate, setBreakfastRate] = useState(String(breakfastConfig.ratePerPersonPerNight));
  const [silogItems, setSilogItems] = useState<{ id: string; name: string; isActive: boolean }[]>(breakfastConfig.silogItems);

  // 5. Store Config states
  const [storeEnabled, setStoreEnabled] = useState(storeConfig.isEnabled);
  const [lowStockThreshold, setLowStockThreshold] = useState(String(storeConfig.lowStockThreshold));
  const [storePaymentMethods, setStorePaymentMethods] = useState<{ method: string; label: string; isEnabled: boolean }[]>(storeConfig.paymentMethods);

  // Handle Form submissions
  const handleSaveHotel = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings("hotelConfig", {
      hotelName,
      contactEmail,
      contactPhone,
      checkInTime,
      checkOutTime,
      missionStatement,
      hotelStory
    });
    alert("Hotel metadata configurations saved successfully!");
  };

  const handleSaveWebsite = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings("websiteContent", {
      homepage: { ...websiteContent.homepage, heroHeading, heroSubtext },
      corporate: { ...websiteContent.corporate, heroHeading: corpHeading, heroSubtext: corpSubtext }
    });
    alert("Website content configurations saved successfully!");
  };

  const handleSaveRewards = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings("rewardsConfig", {
      pointsEnabled,
      pointsPerHundred: parseFloat(pointsPerHundred) || 0,
      memberDiscountEnabled,
      memberDiscountPct: parseFloat(memberDiscountPct) || 0
    });
    alert("Loyalty rewards rules configurations saved successfully!");
  };

  const handleSaveBreakfast = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings("breakfastConfig", {
      isEnabled: breakfastEnabled,
      ratePerPersonPerNight: parseFloat(breakfastRate) || 300,
      silogItems
    });
    alert("Breakfast silog menu selections saved successfully!");
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings("storeConfig", {
      isEnabled: storeEnabled,
      lowStockThreshold: parseInt(lowStockThreshold) || 3,
      paymentMethods: storePaymentMethods
    });
    alert("In-room store configurations saved successfully!");
  };

  // Toggle item status in local states
  const toggleSilogItem = (id: string) => {
    setSilogItems(prev => prev.map(item => item.id === id ? { ...item, isActive: !item.isActive } : item));
  };

  const togglePaymentMethod = (method: string) => {
    setStorePaymentMethods(prev => prev.map(m => m.method === method ? { ...m, isEnabled: !m.isEnabled } : m));
  };

  // Nav item tabs helper
  const tabs = [
    { id: "hotel" as const, label: "Hotel Settings", icon: Landmark },
    { id: "website" as const, label: "Website Content", icon: Globe },
    { id: "rewards" as const, label: "Loyalty Rewards", icon: Gift },
    { id: "breakfast" as const, label: "Breakfast & Dining", icon: Coffee },
    { id: "store" as const, label: "In-Room Store", icon: ShoppingBag }
  ];

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">configurations & settings</h1>
        <p className="text-xs text-gray-500 mt-1">Configure guest check-in defaults, landing page banners, loyalty multipliers, and food items.</p>
      </header>

      {/* Split tab view layout */}
      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Left: Section Selection Navigation */}
        <aside className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 h-fit space-y-1">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider px-3 mb-3">Settings Categories</h2>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-xs font-bold transition ${
                  isTabActive
                    ? "bg-primary text-white shadow-sm"
                    : "text-gray-650 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </aside>

        {/* Right: Tab content viewports */}
        <div className="rounded-card bg-white p-6.5 shadow-sm ring-1 ring-gray-200 min-h-[400px]">
          {/* TAB 1: HOTEL METADATA CONFIG */}
          {activeTab === "hotel" && (
            <form onSubmit={handleSaveHotel} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Hotel Metadata Profile</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Control operational descriptors, contact links, and standard reception parameters.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Hotel Display Name
                  <input
                    type="text"
                    required
                    value={hotelName}
                    onChange={(e) => setHotelName(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Reception Contact Phone
                  <input
                    type="tel"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>
              </div>

              <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                Contact Support Email
                <input
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Standard Check-in Time
                  <input
                    type="text"
                    required
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Standard Check-out Time
                  <input
                    type="text"
                    required
                    value={checkOutTime}
                    onChange={(e) => setCheckOutTime(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>
              </div>

              <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                Hotel Mission Statement
                <textarea
                  value={missionStatement}
                  onChange={(e) => setMissionStatement(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white"
                />
              </label>

              <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                The Spark Story History
                <textarea
                  value={hotelStory}
                  onChange={(e) => setHotelStory(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white"
                />
              </label>

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                >
                  <Save size={14} />
                  Save Hotel Profile
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: WEBSITE CONTENT CONFIG */}
          {activeTab === "website" && (
            <form onSubmit={handleSaveWebsite} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Guest Web Landing Editor</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Edit heading statements and tagline copy shown to guests on public views.</p>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Homepage Hero Segment</h4>
                
                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Homepage Main Heading Banner
                  <input
                    type="text"
                    required
                    value={heroHeading}
                    onChange={(e) => setHeroHeading(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Homepage Supporting Tagline
                  <input
                    type="text"
                    required
                    value={heroSubtext}
                    onChange={(e) => setHeroSubtext(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Corporate Stays Banners</h4>
                
                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Corporate Page Hero Heading
                  <input
                    type="text"
                    required
                    value={corpHeading}
                    onChange={(e) => setCorpHeading(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Corporate Supporting Summary
                  <textarea
                    required
                    value={corpSubtext}
                    onChange={(e) => setCorpSubtext(e.target.value)}
                    rows={2}
                    className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white"
                  />
                </label>
              </div>

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                >
                  <Save size={14} />
                  Save Landing Content
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: REWARDS CONFIG */}
          {activeTab === "rewards" && (
            <form onSubmit={handleSaveRewards} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Spark Rewards Modifiers</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Fine-tune loyalty point distributions and member discount rules.</p>
              </div>

              {/* Toggles */}
              <div className="space-y-3.5 bg-gray-50 p-4.5 rounded-xl border border-gray-150">
                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => setPointsEnabled(!pointsEnabled)}
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      pointsEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      pointsEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Activate Loyalty Points Earning System
                </label>

                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => setMemberDiscountEnabled(!memberDiscountEnabled)}
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      memberDiscountEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      memberDiscountEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Enable Member Base Room 10% Discount
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Points Granted per ₱100 Spent
                  <input
                    type="number"
                    required
                    value={pointsPerHundred}
                    onChange={(e) => setPointsPerHundred(e.target.value)}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
                  Member Discount Percentage (%)
                  <input
                    type="number"
                    required
                    value={memberDiscountPct}
                    onChange={(e) => setMemberDiscountPct(e.target.value)}
                    disabled={!memberDiscountEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              </div>

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                >
                  <Save size={14} />
                  Save Rewards Matrix
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: BREAKFAST MENU CONFIG */}
          {activeTab === "breakfast" && (
            <form onSubmit={handleSaveBreakfast} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Breakfast Silog Management</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Toggle breakfast service rates and configure menu items for walk-ins.</p>
              </div>

              {/* Breakfast service toggles */}
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => setBreakfastEnabled(!breakfastEnabled)}
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      breakfastEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      breakfastEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Enable Guest Daily Breakfast Add-on
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-gray-700 max-w-xs">
                  Breakfast Tariff Rate (PHP / Person / Night)
                  <input
                    type="number"
                    required
                    value={breakfastRate}
                    onChange={(e) => setBreakfastRate(e.target.value)}
                    disabled={!breakfastEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed"
                  />
                </label>
              </div>

              {/* Menu items toggler checkboxes */}
              <div className="space-y-3">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">
                  Available Breakfast Silog Menu Items
                </h4>
                
                <div className="grid gap-3 sm:grid-cols-2">
                  {silogItems.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleSilogItem(item.id)}
                      className={`min-h-[44px] flex items-center justify-between px-3.5 rounded-lg border text-xs font-semibold transition ${
                        item.isActive 
                          ? "bg-primary/5 border-primary/30 text-primary-dark" 
                          : "bg-white border-gray-200 text-gray-550 hover:bg-gray-50"
                      }`}
                    >
                      <span>{item.name} Service</span>
                      {item.isActive ? (
                        <CheckSquare size={16} className="text-primary" />
                      ) : (
                        <Square size={16} className="text-gray-300" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                >
                  <Save size={14} />
                  Save Dining Settings
                </button>
              </div>
            </form>
          )}

          {/* TAB 5: IN-ROOM STORE CONFIG */}
          {activeTab === "store" && (
            <form onSubmit={handleSaveStore} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Mini Bar & Store Portal</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Control low stock reminders and active cashier payout modes.</p>
              </div>

              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => setStoreEnabled(!storeEnabled)}
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      storeEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      storeEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Activate In-room Mini Bar Web Catalog
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-gray-700 max-w-xs">
                  Low Stock Threshold Reminder Alert
                  <input
                    type="number"
                    required
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(e.target.value)}
                    disabled={!storeEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">
                  Allowed Payment Settlement Methods
                </h4>
                
                <div className="grid gap-3 sm:grid-cols-3">
                  {storePaymentMethods.map(pm => (
                    <button
                      key={pm.method}
                      type="button"
                      onClick={() => togglePaymentMethod(pm.method)}
                      disabled={!storeEnabled}
                      className={`min-h-[44px] flex items-center justify-between px-3.5 rounded-lg border text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        pm.isEnabled 
                          ? "bg-primary/5 border-primary/30 text-primary-dark" 
                          : "bg-white border-gray-200 text-gray-550 hover:bg-gray-50"
                      }`}
                    >
                      <span>{pm.label}</span>
                      {pm.isEnabled ? (
                        <CheckSquare size={16} className="text-primary" />
                      ) : (
                        <Square size={16} className="text-gray-300" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                >
                  <Save size={14} />
                  Save Store Settings
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
