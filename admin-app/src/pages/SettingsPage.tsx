import { useEffect, useState } from "react";
import { useAdmin, type StoreItem } from "../context/AdminContext";
import { compressImageFile } from "@spark-inn/shared";
import { 
  Settings, Globe, Gift, Coffee, ShoppingBag, 
  Save, Landmark, Sparkles, Check, CheckSquare, Square,
  BedDouble, Plus, Trash2, ShieldAlert, ImageIcon, Package, Pencil
} from "lucide-react";
import config from "@config";
import { formatPrice } from "../utils/format";
import { Modal } from "../components/Modal";

type TabId = "hotel" | "roomtypes" | "website" | "rewards" | "breakfast" | "store";
type StoreCategory = StoreItem["category"];
type StorePaymentMethodSetting = {
  method: string;
  label: string;
  isEnabled: boolean;
  qrUrl?: string;
  accountInfo?: string;
};

const storeCategories: { value: StoreCategory; label: string }[] = [
  { value: "drinks", label: "Drinks" },
  { value: "snacks", label: "Snacks" },
  { value: "toiletries", label: "Toiletries" },
  { value: "rentals", label: "Rentals" },
  { value: "other", label: "Other" }
];

export function SettingsPage() {
  const { 
    hotelConfig, 
    websiteContent, 
    rewardsConfig, 
    breakfastConfig, 
    storeConfig, 
    updateSettings,
    roomTypes,
    addRoomType,
    deleteRoomType,
    storeItems,
    addStoreItem,
    updateStoreItem,
    deleteStoreItem
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
  const [storePaymentMethods, setStorePaymentMethods] = useState<StorePaymentMethodSetting[]>(storeConfig.paymentMethods);
  const [editingStoreItemId, setEditingStoreItemId] = useState<string | null>(null);
  const [isStoreItemModalOpen, setIsStoreItemModalOpen] = useState(false);
  const [storeCategoryFilter, setStoreCategoryFilter] = useState<StoreCategory | "all">("all");
  const [storeItemPhotoDataUrl, setStoreItemPhotoDataUrl] = useState("");
  const [storeItemPhotoStatus, setStoreItemPhotoStatus] = useState("");

  useEffect(() => {
    setStoreEnabled(storeConfig.isEnabled !== false);
    setLowStockThreshold(String(storeConfig.lowStockThreshold ?? 3));
    setStorePaymentMethods(Array.isArray(storeConfig.paymentMethods) ? storeConfig.paymentMethods : []);
  }, [storeConfig]);

  // Handle Form submissions
  const handleSaveHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("hotelConfig", {
      hotelName,
      contactEmail,
      contactPhone,
      checkInTime,
      checkOutTime,
      missionStatement,
      hotelStory
    });
  };

  const handleSaveWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("websiteContent", {
      homepage: { ...websiteContent.homepage, heroHeading, heroSubtext },
      corporate: { ...websiteContent.corporate, heroHeading: corpHeading, heroSubtext: corpSubtext }
    });
  };

  const handleSaveRewards = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("rewardsConfig", {
      pointsEnabled,
      pointsPerHundred: parseFloat(pointsPerHundred) || 0,
      memberDiscountEnabled,
      memberDiscountPct: parseFloat(memberDiscountPct) || 0
    });
  };

  const handleSaveBreakfast = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("breakfastConfig", {
      isEnabled: breakfastEnabled,
      ratePerPersonPerNight: parseFloat(breakfastRate) || 300,
      silogItems
    });
  };

  const handleSaveStore = () => {
    updateSettings("storeConfig", {
      isEnabled: storeEnabled,
      lowStockThreshold: parseInt(lowStockThreshold) || 3,
      paymentMethods: storePaymentMethods
    });
  };

  // Toggle item status in local states
  const toggleSilogItem = (id: string) => {
    setSilogItems(prev => prev.map(item => item.id === id ? { ...item, isActive: !item.isActive } : item));
  };

  const togglePaymentMethod = (method: string) => {
    setStorePaymentMethods(prev => prev.map(m => m.method === method ? { ...m, isEnabled: !m.isEnabled } : m));
  };

  const updateStorePaymentMethod = (method: string, updates: Partial<StorePaymentMethodSetting>) => {
    setStorePaymentMethods(prev => prev.map(m => m.method === method ? { ...m, ...updates } : m));
  };

  const editingStoreItem = storeItems.find(item => item.id === editingStoreItemId) ?? null;
  const filteredStoreItems = storeCategoryFilter === "all"
    ? storeItems
    : storeItems.filter(item => item.category === storeCategoryFilter);
  const selectedStoreCategoryLabel = storeCategoryFilter === "all"
    ? "All items"
    : storeCategories.find(category => category.value === storeCategoryFilter)?.label ?? "All items";

  const openStoreItemModal = (itemId: string | null = null) => {
    const item = storeItems.find(storeItem => storeItem.id === itemId);
    setEditingStoreItemId(itemId);
    setStoreItemPhotoDataUrl(item?.imageUrl ?? "");
    setStoreItemPhotoStatus("");
    setIsStoreItemModalOpen(true);
  };

  const closeStoreItemModal = () => {
    setIsStoreItemModalOpen(false);
    setEditingStoreItemId(null);
    setStoreItemPhotoDataUrl("");
    setStoreItemPhotoStatus("");
  };

  const getStoreStockLabel = (item: StoreItem) => {
    if (item.stock === null) return "Unlimited";
    if (item.stock === 0) return "Out of stock";
    if (item.stock <= Number(lowStockThreshold || 0)) return `Low stock: ${item.stock}`;
    return `${item.stock} in stock`;
  };

  const getStoreStockClass = (item: StoreItem) => {
    if (item.stock === null) return "bg-blue-50 text-blue-700 border-blue-100";
    if (item.stock === 0) return "bg-red-50 text-red-700 border-red-100";
    if (item.stock <= Number(lowStockThreshold || 0)) return "bg-orange-50 text-orange-700 border-orange-100";
    return "bg-emerald-50 text-emerald-700 border-emerald-100";
  };

  const handleStorePhotoUpload = async (file: File | undefined) => {
    if (!file) return;

    try {
      setStoreItemPhotoStatus("Compressing image...");
      const image = await compressImageFile(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.84 });
      setStoreItemPhotoDataUrl(image.dataUrl);
      setStoreItemPhotoStatus(
        `Compressed to ${Math.max(1, Math.round(image.compressedSize / 1024))} KB at ${image.width}x${image.height}.`
      );
    } catch (error) {
      setStoreItemPhotoStatus(error instanceof Error ? error.message : "Unable to process image.");
    }
  };

  const handleStoreItemSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const hasUnlimitedStock = formData.get("stockMode") === "unlimited";
    const stockValue = Number(formData.get("stock") || 0);
    const itemData = {
      name: String(formData.get("name") || "").trim(),
      category: String(formData.get("category") || "other") as StoreCategory,
      description: String(formData.get("description") || "").trim(),
      price: Number(formData.get("price") || 0),
      stock: hasUnlimitedStock ? null : Math.max(0, stockValue),
      imageUrl: storeItemPhotoDataUrl,
      isActive: formData.get("isActive") === "on"
    };

    if (!itemData.name || itemData.price <= 0) return;

    if (editingStoreItem) {
      updateStoreItem(editingStoreItem.id, itemData);
      closeStoreItemModal();
    } else {
      addStoreItem(itemData);
      closeStoreItemModal();
    }

    form.reset();
  };

  // Nav item tabs helper
  const tabs = [
    { id: "hotel" as const, label: "Hotel Settings", icon: Landmark },
    { id: "roomtypes" as const, label: "Room Types", icon: BedDouble },
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
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 min-h-[400px] sm:p-7">
          {/* TAB 1: HOTEL METADATA CONFIG */}
          {activeTab === "hotel" && (
            <form onSubmit={handleSaveHotel} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Hotel Metadata Profile</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Control operational descriptors, contact links, and standard reception parameters.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Hotel Display Name
                  <input
                    type="text"
                    required
                    value={hotelName}
                    onChange={(e) => setHotelName(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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

              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Standard Check-in Time
                  <input
                    type="text"
                    required
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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

              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Hotel Mission Statement
                <textarea
                  value={missionStatement}
                  onChange={(e) => setMissionStatement(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white"
                />
              </label>

              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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
                
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Homepage Main Heading Banner
                  <input
                    type="text"
                    required
                    value={heroHeading}
                    onChange={(e) => setHeroHeading(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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
                
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Corporate Page Hero Heading
                  <input
                    type="text"
                    required
                    value={corpHeading}
                    onChange={(e) => setCorpHeading(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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
              <div className="space-y-3.5 bg-gray-50 p-5 rounded-xl border border-gray-150">
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
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
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

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 max-w-xs">
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
            <div className="space-y-6 text-xs">
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

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 max-w-xs">
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

                {storePaymentMethods.some(pm => pm.method === "gcash") ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h5 className="text-xs font-bold text-gray-900">GCash transfer details</h5>
                        <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                          These details appear in the guest store checkout when GCash is enabled.
                        </p>
                      </div>
                      <span className={`w-fit rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                        storePaymentMethods.find(pm => pm.method === "gcash")?.isEnabled
                          ? "bg-primary-light text-primary-dark"
                          : "bg-gray-100 text-gray-500"
                      }`}>
                        {storePaymentMethods.find(pm => pm.method === "gcash")?.isEnabled ? "Visible to guests" : "Hidden"}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[160px_1fr]">
                      <div className="flex min-h-40 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-3">
                        {storePaymentMethods.find(pm => pm.method === "gcash")?.qrUrl ? (
                          <img
                            src={storePaymentMethods.find(pm => pm.method === "gcash")?.qrUrl}
                            alt="Store GCash QR preview"
                            className="h-32 w-32 rounded-lg border border-gray-200 bg-white object-contain p-2"
                          />
                        ) : (
                          <div className="text-center">
                            <ImageIcon size={24} className="mx-auto text-gray-400" />
                            <p className="mt-2 text-[10px] font-semibold text-gray-500">No QR URL set</p>
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3">
                        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                          GCash QR image URL
                          <input
                            type="url"
                            value={storePaymentMethods.find(pm => pm.method === "gcash")?.qrUrl ?? ""}
                            onChange={(event) => updateStorePaymentMethod("gcash", { qrUrl: event.target.value })}
                            disabled={!storeEnabled}
                            placeholder="https://firebasestorage.googleapis.com/..."
                            className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed"
                          />
                        </label>

                        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                          GCash account info
                          <textarea
                            value={storePaymentMethods.find(pm => pm.method === "gcash")?.accountInfo ?? ""}
                            onChange={(event) => updateStorePaymentMethod("gcash", { accountInfo: event.target.value })}
                            disabled={!storeEnabled}
                            rows={3}
                            placeholder="GCash: 0917 000 0000 - spark inn"
                            className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3 border-t border-gray-150 pt-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Spark Essentials Catalog
                    </h4>
                    <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                      Manage item names, photos, descriptions, pricing, and stock counts shown in the guest store.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[10px] font-bold text-gray-600">
                      <Package size={12} />
                      {filteredStoreItems.length} of {storeItems.length} items
                    </span>
                    <button
                      type="button"
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white shadow-sm transition hover:bg-primary-dark"
                      onClick={() => openStoreItemModal()}
                    >
                      <Plus size={13} />
                      Add Item
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`min-h-[34px] rounded-full border px-3 text-[10px] font-bold transition ${
                      storeCategoryFilter === "all"
                        ? "border-primary bg-primary-light text-primary"
                        : "border-gray-200 bg-white text-gray-600 hover:border-primary"
                    }`}
                    onClick={() => setStoreCategoryFilter("all")}
                  >
                    All Items
                  </button>
                  {storeCategories.map((category) => (
                    <button
                      key={category.value}
                      type="button"
                      className={`min-h-[34px] rounded-full border px-3 text-[10px] font-bold transition ${
                        storeCategoryFilter === category.value
                          ? "border-primary bg-primary-light text-primary"
                          : "border-gray-200 bg-white text-gray-600 hover:border-primary"
                      }`}
                      onClick={() => setStoreCategoryFilter(category.value)}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {filteredStoreItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex gap-3">
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon size={22} className="text-gray-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h5 className="truncate text-sm font-bold text-gray-950">{item.name}</h5>
                              <span className="mt-1 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                                {storeCategories.find(category => category.value === item.category)?.label ?? "Other"}
                              </span>
                              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-gray-500">{item.description}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              item.isActive ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-100 text-gray-500"
                            }`}>
                              {item.isActive ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-gray-950">{formatPrice(item.price)}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${getStoreStockClass(item)}`}>
                              {getStoreStockLabel(item)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-3">
                        <button
                          type="button"
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 transition hover:bg-gray-50"
                          onClick={() => openStoreItemModal(item.id)}
                        >
                          <Pencil size={13} />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-100 px-3 text-[10px] font-bold text-red-650 transition hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Delete "${item.name}" from the wireframe catalog?`)) {
                              deleteStoreItem(item.id);
                              if (editingStoreItemId === item.id) setEditingStoreItemId(null);
                            }
                          }}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {filteredStoreItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-250 bg-gray-50 p-8 text-center lg:col-span-2">
                      <Package size={24} className="mx-auto text-gray-400" />
                      <h5 className="mt-3 text-sm font-bold text-gray-900">No {selectedStoreCategoryLabel.toLowerCase()} yet</h5>
                      <p className="mx-auto mt-1 max-w-md text-[10px] leading-relaxed text-gray-500">
                        Add an item in this category or switch back to all items to view the full catalog.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="button"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                  onClick={handleSaveStore}
                >
                  <Save size={14} />
                  Save Store Settings
                </button>
              </div>
            </div>
          )}

          <Modal
            title={editingStoreItem ? "Edit Store Item" : "Add Store Item"}
            open={isStoreItemModalOpen}
            onClose={closeStoreItemModal}
          >
            <form onSubmit={handleStoreItemSubmit} className="space-y-4 text-xs">
              <p className="text-[10px] leading-relaxed text-gray-500">
                Uploads are compressed in-browser before previewing. Later, the compressed file will be sent to Firebase Storage.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Item Name
                  <input
                    key={`modal-name-${editingStoreItem?.id ?? "new"}`}
                    name="name"
                    type="text"
                    required
                    defaultValue={editingStoreItem?.name ?? ""}
                    placeholder="Bohol Peanut Kisses"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Category
                  <select
                    key={`modal-category-${editingStoreItem?.id ?? "new"}`}
                    name="category"
                    defaultValue={editingStoreItem?.category ?? (storeCategoryFilter === "all" ? "snacks" : storeCategoryFilter)}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                  >
                    {storeCategories.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Price
                  <input
                    key={`modal-price-${editingStoreItem?.id ?? "new"}`}
                    name="price"
                    type="number"
                    min="1"
                    required
                    defaultValue={editingStoreItem?.price ?? ""}
                    placeholder="80"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Stock Quantity
                  <input
                    key={`modal-stock-${editingStoreItem?.id ?? "new"}`}
                    name="stock"
                    type="number"
                    min="0"
                    defaultValue={editingStoreItem?.stock ?? 0}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Description
                <textarea
                  key={`modal-description-${editingStoreItem?.id ?? "new"}`}
                  name="description"
                  rows={3}
                  defaultValue={editingStoreItem?.description ?? ""}
                  placeholder="Short guest-facing description."
                  className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:bg-white"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                  {storeItemPhotoDataUrl ? (
                    <img src={storeItemPhotoDataUrl} alt="Store item preview" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon size={24} className="text-gray-400" />
                  )}
                </div>
                <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-250 bg-white px-4 py-5 text-center transition hover:border-primary hover:bg-primary-light/30">
                  <ImageIcon size={20} className="text-primary" />
                  <span className="mt-2 text-xs font-bold text-gray-800">Upload item photo</span>
                  <span className="mt-1 text-[10px] leading-relaxed text-gray-500">
                    JPG, PNG, or WebP. Compressed automatically for efficient storage.
                  </span>
                  <input
                    key={`modal-image-${editingStoreItem?.id ?? "new"}`}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      void handleStorePhotoUpload(event.currentTarget.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              {storeItemPhotoStatus ? (
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-[10px] font-semibold text-gray-600">{storeItemPhotoStatus}</p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700">
                  <input
                    key={`modal-stock-mode-${editingStoreItem?.id ?? "new"}`}
                    name="stockMode"
                    type="checkbox"
                    value="unlimited"
                    defaultChecked={editingStoreItem?.stock === null}
                    className="h-4 w-4 accent-primary"
                  />
                  Unlimited stock
                </label>

                <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700">
                  <input
                    key={`modal-active-${editingStoreItem?.id ?? "new"}`}
                    name="isActive"
                    type="checkbox"
                    defaultChecked={editingStoreItem?.isActive ?? true}
                    className="h-4 w-4 accent-primary"
                  />
                  Active in guest store
                </label>
              </div>

              <div className="flex flex-col gap-2 border-t border-gray-150 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  onClick={closeStoreItemModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
                >
                  <Save size={14} />
                  {editingStoreItem ? "Update Item" : "Add Item"}
                </button>
              </div>
            </form>
          </Modal>

          {/* TAB 1.5: ROOM TYPES CONFIG */}
          {activeTab === "roomtypes" && (
            <div className="space-y-6 text-xs font-body">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Room Layout Classifications</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Define category keys, descriptive labels, and compact UI abbreviations used across booking screens.</p>
              </div>

              {/* Warnings / Cautions */}
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-4 text-[10px] text-orange-700 flex gap-2.5 items-start">
                <ShieldAlert size={16} className="shrink-0 text-orange-500 mt-0.5" />
                <div>
                  <strong className="font-bold">Caution on Deletion:</strong>
                  <p className="mt-0.5 leading-relaxed font-semibold">
                    Deleting a room type that is currently active on existing rooms or bookings may result in display mismatches. Remove room associations before deleting layouts.
                  </p>
                </div>
              </div>

              {/* Room Types Listing Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                <table className="min-w-full divide-y divide-gray-150 text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-400 font-bold uppercase text-[9px] tracking-wider text-left">
                      <th className="px-4 py-2.5">Identifier Key</th>
                      <th className="px-4 py-2.5">Display Label</th>
                      <th className="px-4 py-2.5">Short Abbreviation</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {roomTypes.map((type) => (
                      <tr key={type.value} className="text-gray-800 hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-mono text-[11px] text-gray-900">{type.value}</td>
                        <td className="px-4 py-3 text-gray-700">{type.label}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-105 text-gray-700 border border-gray-200">
                            {type.shortLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete the "${type.label}" room type?`)) {
                                deleteRoomType(type.value);
                              }
                            }}
                            className="text-red-650 hover:text-red-700 font-bold hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add Room Type Form */}
              <div className="border-t border-gray-150 pt-5 space-y-4">
                <h4 className="text-xs font-bold text-gray-750 flex items-center gap-1">
                  <Plus size={14} className="text-primary" />
                  Add New Room Classification
                </h4>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const value = (form.elements.namedItem("val") as HTMLInputElement).value.trim().toLowerCase().replace(/\s+/g, "-");
                    const label = (form.elements.namedItem("lbl") as HTMLInputElement).value.trim();
                    const shortLabel = (form.elements.namedItem("shortLbl") as HTMLInputElement).value.trim();

                    if (!value || !label || !shortLabel) return;
                    if (roomTypes.some(t => t.value === value)) {
                      alert("A room type with this identifier key already exists.");
                      return;
                    }

                    addRoomType({ value, label, shortLabel });
                    form.reset();
                    alert("New room type classification added successfully!");
                  }}
                  className="space-y-4 bg-gray-50 p-5 rounded-xl border border-gray-150"
                >
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Identifier Key (e.g. deluxe-villa)
                      <input
                        name="val"
                        type="text"
                        required
                        placeholder="deluxe-villa"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Full Display Name
                      <input
                        name="lbl"
                        type="text"
                        required
                        placeholder="Deluxe Pool Villa"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Short Label (abbreviation)
                      <input
                        name="shortLbl"
                        type="text"
                        required
                        placeholder="Deluxe Villa"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="min-h-[40px] px-5 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                    >
                      <Plus size={14} />
                      Register Room Type
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
