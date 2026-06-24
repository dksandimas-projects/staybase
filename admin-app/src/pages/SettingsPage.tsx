import { useEffect, useRef, useState } from "react";
import { useAdmin, type StoreItem } from "../context/AdminContext";
import { compressImageFile, MAX_ROOM_TYPE_PHOTOS, type RoomTypeEntry } from "@spark-inn/shared";
import {
  Settings, Globe, Gift, Coffee, ShoppingBag,
  Save, Landmark, Sparkles, Check, CheckSquare, Square,
  BedDouble, Plus, Trash2, ShieldAlert, ImageIcon, Package, Pencil,
  Mail, Users, Scale, MessageSquare, Volume2, GripVertical, UserCog, Lock,
  Upload, ChevronLeft, ChevronRight, X
} from "lucide-react";
import config from "@config";
import { formatPrice } from "../utils/format";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useBreakpoint } from "../utils/useBreakpoint";

type TabId = "hotel" | "roomtypes" | "website" | "rewards" | "breakfast" | "store" | "email" | "intercom" | "legal" | "staff";
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
    updateRoomType,
    deleteRoomType,
    uploadRoomTypePhoto,
    removeRoomTypePhoto,
    reorderRoomTypePhotos,
    storeItems,
    addStoreItem,
    updateStoreItem,
    deleteStoreItem,
    currentUser,
    staff,
    createStaff,
    disableStaff
  } = useAdmin();
  const toast = useToast();
  const { isMobile } = useBreakpoint();

  // Active Settings Section Tab
  const [activeTab, setActiveTab] = useState<TabId>("hotel");

  // On mobile, auto-scroll the horizontal tab bar to the active tab so
  // it's always visible. The user can still scroll the bar sideways to
  // reach any tab that falls outside the viewport.
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isMobile) return;
    const bar = tabBarRef.current;
    if (!bar) return;
    const activeEl = bar.querySelector<HTMLElement>(`[data-tab-id="${activeTab}"]`);
    if (activeEl) {
      const left = activeEl.offsetLeft - bar.offsetLeft;
      const targetLeft = left - (bar.clientWidth - activeEl.clientWidth) / 2;
      bar.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
    }
  }, [activeTab, isMobile]);

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
  const [earningMode, setEarningMode] = useState<"per-booking" | "per-spend">(rewardsConfig.earningMode);
  const [pointsPerBooking, setPointsPerBooking] = useState(String(rewardsConfig.pointsPerBooking));
  const [pointsPerHundred, setPointsPerHundred] = useState(String(rewardsConfig.pointsPerHundred));
  const [pointsRedemptionRate, setPointsRedemptionRate] = useState(String(rewardsConfig.pointsRedemptionRate));
  const [memberDiscountEnabled, setMemberDiscountEnabled] = useState(rewardsConfig.memberDiscountEnabled);
  const [memberDiscountPct, setMemberDiscountPct] = useState(String(rewardsConfig.memberDiscountPct));
  const [rewardsName, setRewardsName] = useState(rewardsConfig.rewardsName);
  const [rewardsTagline, setRewardsTagline] = useState(rewardsConfig.rewardsTagline);

  // 4. Breakfast Config states
  const [breakfastEnabled, setBreakfastEnabled] = useState(breakfastConfig.isEnabled);
  const [breakfastRate, setBreakfastRate] = useState(String(breakfastConfig.ratePerPersonPerNight));
  const [silogItems, setSilogItems] = useState<{ id: string; name: string; isActive: boolean }[]>(breakfastConfig.silogItems);

  // 5. Store Config states
  const [storeEnabled, setStoreEnabled] = useState(storeConfig.isEnabled);
  const [lowStockThreshold, setLowStockThreshold] = useState(String(storeConfig.lowStockThreshold));
  const [storePaymentMethods, setStorePaymentMethods] = useState<StorePaymentMethodSetting[]>(storeConfig.paymentMethods);
  const [editingStoreItemId, setEditingStoreItemId] = useState<string | null>(null);
  const [pendingDeleteStoreItemId, setPendingDeleteStoreItemId] = useState<string | null>(null);
  const [pendingDeleteRoomType, setPendingDeleteRoomType] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingDeleteStoreItemId) return;
    const timer = setTimeout(() => setPendingDeleteStoreItemId(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDeleteStoreItemId]);
  useEffect(() => {
    if (!pendingDeleteRoomType) return;
    const timer = setTimeout(() => setPendingDeleteRoomType(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDeleteRoomType]);

  // Room type photos manager state (per `plan/features/SETTINGS.md §Room Types`).
  const [photoTarget, setPhotoTarget] = useState<RoomTypeEntry | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Room type edit modal state (per W3.7). The modal carries a working
  // copy of the type and flushes it to `settings/hotelConfig.roomTypes[]`
  // via `updateRoomType` on save.
  const [editType, setEditType] = useState<RoomTypeEntry | null>(null);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const editTypeFormRef = useRef<HTMLFormElement | null>(null);
  // The room types stream can replace `photoTarget` while the modal is open;
  // re-sync whenever the underlying type changes.
  useEffect(() => {
    if (!photoTarget) return;
    const fresh = roomTypes.find((t) => t.value === photoTarget.value);
    if (fresh && fresh !== photoTarget) setPhotoTarget(fresh);
  }, [roomTypes, photoTarget]);
  const [isStoreItemModalOpen, setIsStoreItemModalOpen] = useState(false);
  const [storeCategoryFilter, setStoreCategoryFilter] = useState<StoreCategory | "all">("all");
  const [storeItemPhotoDataUrl, setStoreItemPhotoDataUrl] = useState("");
  const [storeItemPhotoStatus, setStoreItemPhotoStatus] = useState("");

  // 6. Intercom Config states
  const [intercomQuickRequests, setIntercomQuickRequests] = useState<string[]>(
    Array.isArray(hotelConfig.intercomQuickRequests) ? hotelConfig.intercomQuickRequests : []
  );
  const [notificationSoundUrl, setNotificationSoundUrl] = useState(hotelConfig.notificationSoundUrl || "");

  // 7. Legal Content states
  const [privacyPolicyBody, setPrivacyPolicyBody] = useState(websiteContent.privacyPolicyBody || "");
  const [cancellationPolicy, setCancellationPolicy] = useState(websiteContent.cancellationPolicy || "");
  const [houseRules, setHouseRules] = useState(websiteContent.houseRules || "");
  const [privacyPolicyLastUpdated, setPrivacyPolicyLastUpdated] = useState(
    websiteContent.privacyPolicyLastUpdated || config.privacyPolicyLastUpdated || ""
  );

  // 8. Staff Accounts states
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffPassword, setNewStaffPassword] = useState("");
  const [newStaffPhone, setNewStaffPhone] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<"front-desk" | "admin">("front-desk");
  const [isCreatingStaff, setIsCreatingStaff] = useState(false);
  const [staffFormMessage, setStaffFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [disablingStaff, setDisablingStaff] = useState<{ uid: string; name: string } | null>(null);
  const [isDisablingStaff, setIsDisablingStaff] = useState(false);
  const [disableStaffError, setDisableStaffError] = useState("");

  useEffect(() => {
    setStoreEnabled(storeConfig.isEnabled !== false);
    setLowStockThreshold(String(storeConfig.lowStockThreshold ?? 3));
    setStorePaymentMethods(Array.isArray(storeConfig.paymentMethods) ? storeConfig.paymentMethods : []);
    setIntercomQuickRequests(Array.isArray(hotelConfig.intercomQuickRequests) ? hotelConfig.intercomQuickRequests : []);
    setNotificationSoundUrl(hotelConfig.notificationSoundUrl || "");
    setPrivacyPolicyBody(websiteContent.privacyPolicyBody || "");
    setCancellationPolicy(websiteContent.cancellationPolicy || "");
    setHouseRules(websiteContent.houseRules || "");
    setPrivacyPolicyLastUpdated(websiteContent.privacyPolicyLastUpdated || config.privacyPolicyLastUpdated || "");
    setPointsEnabled(rewardsConfig.pointsEnabled !== false);
    setEarningMode(rewardsConfig.earningMode === "per-booking" ? "per-booking" : "per-spend");
    setPointsPerBooking(String(rewardsConfig.pointsPerBooking ?? 50));
    setPointsPerHundred(String(rewardsConfig.pointsPerHundred ?? 10));
    setPointsRedemptionRate(String(rewardsConfig.pointsRedemptionRate ?? 100));
    setMemberDiscountEnabled(rewardsConfig.memberDiscountEnabled !== false);
    setMemberDiscountPct(String(rewardsConfig.memberDiscountPct ?? 10));
    setRewardsName(rewardsConfig.rewardsName || "Spark Rewards");
    setRewardsTagline(rewardsConfig.rewardsTagline || "");
  }, [storeConfig, hotelConfig, websiteContent, rewardsConfig]);

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
      earningMode,
      pointsPerBooking: parseFloat(pointsPerBooking) || 0,
      pointsPerHundred: parseFloat(pointsPerHundred) || 0,
      pointsRedemptionRate: parseFloat(pointsRedemptionRate) || 0,
      memberDiscountEnabled,
      memberDiscountPct: parseFloat(memberDiscountPct) || 0,
      rewardsName: rewardsName.trim() || "Spark Rewards",
      rewardsTagline: rewardsTagline.trim()
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

  const handleSaveIntercom = () => {
    updateSettings("hotelConfig", {
      intercomQuickRequests,
      notificationSoundUrl
    });
  };

  const handleSaveLegal = () => {
    updateSettings("websiteContent", {
      ...websiteContent,
      privacyPolicyBody,
      cancellationPolicy,
      houseRules,
      privacyPolicyLastUpdated: new Date().toISOString().slice(0, 10)
    });
    setPrivacyPolicyLastUpdated(new Date().toISOString().slice(0, 10));
  };

  const handleCreateStaffSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newStaffName.trim() || !newStaffEmail.trim() || newStaffPassword.length < 8) {
      setStaffFormMessage({ type: "error", text: "Please fill in name, email, and an 8+ character password." });
      return;
    }
    setIsCreatingStaff(true);
    setStaffFormMessage(null);
    const result = await createStaff({
      fullName: newStaffName.trim(),
      email: newStaffEmail.trim(),
      password: newStaffPassword,
      phone: newStaffPhone.trim(),
      role: newStaffRole
    });
    setIsCreatingStaff(false);
    if (!result.success) {
      setStaffFormMessage({ type: "error", text: result.error || "Failed to create staff account." });
      return;
    }
    setStaffFormMessage({
      type: "success",
      text: `Staff account created for ${newStaffEmail.trim()}. They can sign in now.`
    });
    setNewStaffName("");
    setNewStaffEmail("");
    setNewStaffPassword("");
    setNewStaffPhone("");
    setNewStaffRole("front-desk");
  };

  const openDisableStaffConfirm = (member: { uid: string; fullName: string }) => {
    setDisablingStaff({ uid: member.uid, name: member.fullName });
    setDisableStaffError("");
  };

  const closeDisableStaffConfirm = () => {
    if (isDisablingStaff) return;
    setDisablingStaff(null);
    setDisableStaffError("");
  };

  const handleConfirmDisableStaff = async () => {
    if (!disablingStaff) return;
    setIsDisablingStaff(true);
    setDisableStaffError("");
    const result = await disableStaff(disablingStaff.uid);
    setIsDisablingStaff(false);
    if (!result.success) {
      setDisableStaffError(result.error || "Failed to disable staff account.");
      return;
    }
    setDisablingStaff(null);
  };

  const isAdmin = currentUser?.role === "admin";

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
    { id: "store" as const, label: "In-Room Store", icon: ShoppingBag },
    { id: "email" as const, label: "Email Config", icon: Mail },
    { id: "intercom" as const, label: "Intercom", icon: MessageSquare },
    { id: "legal" as const, label: "Legal Content", icon: Scale },
    { id: "staff" as const, label: "Staff Accounts", icon: UserCog }
  ];

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">configurations & settings</h1>
        <p className="text-xs text-gray-500 mt-1">Configure guest check-in defaults, landing page banners, loyalty multipliers, and food items.</p>
      </header>

      {/* Mobile horizontal tab bar — single-line, scrolls sideways.
          The active tab is auto-scrolled into view (see the
          useEffect above). On desktop the same tabs render as a
          vertical 260px left nav (the <aside> below). */}
      <div ref={tabBarRef} className="lg:hidden -mx-4 overflow-x-auto px-4 pb-1">
        <div className="flex min-w-max gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                data-tab-id={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-4 text-xs font-bold transition ${
                  isTabActive
                    ? "bg-primary text-white shadow-sm"
                    : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Split tab view layout */}
      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Left: Section Selection Navigation — desktop only */}
        <aside className="hidden lg:block rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 h-fit space-y-1">
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

          {/* TAB 3: REWARDS CONFIG — admin-only (per W3.2) */}
          {activeTab === "rewards" && (
            isAdmin ? (
            <form onSubmit={handleSaveRewards} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">{rewardsName} Modifiers</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Fine-tune loyalty point distributions, redemption rate, and member discount rules.</p>
              </div>

              {/* Program Identity */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Program Identity</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Program Display Name
                    <input
                      type="text"
                      required
                      value={rewardsName}
                      onChange={(e) => setRewardsName(e.target.value)}
                      placeholder="Spark Rewards"
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Program Tagline
                    <input
                      type="text"
                      value={rewardsTagline}
                      onChange={(e) => setRewardsTagline(e.target.value)}
                      placeholder="Earn points on completed stays, unlock member-only perks."
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                </div>
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
                  Enable Member Base Room Discount
                </label>
              </div>

              {/* Earning Mode */}
              <div className="space-y-3">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Earning Mode</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition ${
                    earningMode === "per-spend"
                      ? "border-primary bg-primary/5"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}>
                    <input
                      type="radio"
                      name="earningMode"
                      value="per-spend"
                      checked={earningMode === "per-spend"}
                      onChange={() => setEarningMode("per-spend")}
                      disabled={!pointsEnabled}
                      className="mt-1 h-4 w-4 cursor-pointer text-primary focus:ring-primary-light"
                    />
                    <div>
                      <p className="text-xs font-bold text-gray-800">Per ₱100 spent</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Awards points based on booking subtotal. Best for properties with wide price ranges.</p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition ${
                    earningMode === "per-booking"
                      ? "border-primary bg-primary/5"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}>
                    <input
                      type="radio"
                      name="earningMode"
                      value="per-booking"
                      checked={earningMode === "per-booking"}
                      onChange={() => setEarningMode("per-booking")}
                      disabled={!pointsEnabled}
                      className="mt-1 h-4 w-4 cursor-pointer text-primary focus:ring-primary-light"
                    />
                    <div>
                      <p className="text-xs font-bold text-gray-800">Flat per completed stay</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Awards a fixed number of points per stay regardless of total. Simpler for members to predict.</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  {earningMode === "per-booking" ? "Points per Completed Stay" : "Points Granted per ₱100 Spent"}
                  <input
                    type="number"
                    required
                    min="0"
                    value={earningMode === "per-booking" ? pointsPerBooking : pointsPerHundred}
                    onChange={(e) =>
                      earningMode === "per-booking"
                        ? setPointsPerBooking(e.target.value)
                        : setPointsPerHundred(e.target.value)
                    }
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Points per ₱1 Redemption Rate
                  <input
                    type="number"
                    required
                    min="1"
                    value={pointsRedemptionRate}
                    onChange={(e) => setPointsRedemptionRate(e.target.value)}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Member Discount Percentage (%)
                  <input
                    type="number"
                    required
                    min="0"
                    max="100"
                    value={memberDiscountPct}
                    onChange={(e) => setMemberDiscountPct(e.target.value)}
                    disabled={!memberDiscountEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              </div>

              <p className="text-[10px] leading-relaxed text-gray-500">
                Redemption rate is the number of points required to redeem ₱1 at booking checkout (server reads <code>settings/rewardsConfig.pointsRedemptionRate</code>).
                Earning mode is the server-side branch in <code>handleCreateBooking</code> that decides whether to award by subtotal or by flat count.
              </p>

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
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                <p className="font-semibold">Admin-only section</p>
                <p className="mt-1 leading-relaxed">The {rewardsName} settings are restricted to admin accounts. Ask a hotel owner to make loyalty changes.</p>
              </div>
            )
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
                          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-[10px] font-bold transition ${
                            pendingDeleteStoreItemId === item.id
                              ? "border-red-300 bg-red-600 text-white"
                              : "border-red-100 text-red-650 hover:bg-red-50"
                          }`}
                          onClick={() => {
                            if (pendingDeleteStoreItemId === item.id) {
                              deleteStoreItem(item.id);
                              if (editingStoreItemId === item.id) setEditingStoreItemId(null);
                              setPendingDeleteStoreItemId(null);
                            } else {
                              setPendingDeleteStoreItemId(item.id);
                            }
                          }}
                        >
                          <Trash2 size={13} />
                          {pendingDeleteStoreItemId === item.id ? "Click to confirm" : "Delete"}
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
                {isMobile ? (
                  <ul className="divide-y divide-gray-100 font-medium">
                    {roomTypes.map((type) => (
                      <li key={type.value} className="flex items-start justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="text-sm font-semibold text-gray-900 truncate">{type.label}</p>
                          <p className="font-mono text-[11px] text-gray-500 truncate">{type.value}</p>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-700 border border-gray-200">
                            {type.shortLabel}
                          </span>
                          <p className="text-[11px] text-gray-500 pt-1">
                            {type.imageUrls.length} / {MAX_ROOM_TYPE_PHOTOS} photos
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditType(type)}
                            className="min-h-[44px] inline-flex items-center gap-1 rounded border border-gray-200 px-2 text-[11px] font-bold text-gray-700 hover:border-primary hover:text-primary"
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setPhotoTarget(type)}
                            className="min-h-[44px] inline-flex items-center gap-1 rounded border border-primary px-2 text-[11px] font-bold text-primary hover:bg-primary-light"
                          >
                            <ImageIcon size={12} />
                            Photos
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (pendingDeleteRoomType === type.value) {
                                deleteRoomType(type.value);
                                setPendingDeleteRoomType(null);
                              } else {
                                setPendingDeleteRoomType(type.value);
                              }
                            }}
                            className={`shrink-0 font-bold hover:underline min-h-[44px] px-2 ${
                              pendingDeleteRoomType === type.value
                                ? "text-red-700"
                                : "text-red-650 hover:text-red-700"
                            }`}
                          >
                            {pendingDeleteRoomType === type.value ? "Click to confirm" : "Delete"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <table className="min-w-full divide-y divide-gray-150 text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-400 font-bold uppercase text-[9px] tracking-wider text-left">
                        <th className="px-4 py-2.5">Identifier Key</th>
                        <th className="px-4 py-2.5">Display Label</th>
                        <th className="px-4 py-2.5">Short Abbreviation</th>
                        <th className="px-4 py-2.5">Photos</th>
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
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setPhotoTarget(type)}
                              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-primary hover:text-primary"
                            >
                              <ImageIcon size={12} />
                              {type.imageUrls.length} / {MAX_ROOM_TYPE_PHOTOS}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditType(type)}
                                className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-primary hover:text-primary"
                              >
                                <Pencil size={12} />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (pendingDeleteRoomType === type.value) {
                                    deleteRoomType(type.value);
                                    setPendingDeleteRoomType(null);
                                  } else {
                                    setPendingDeleteRoomType(type.value);
                                  }
                                }}
                                className={`font-bold hover:underline ${
                                  pendingDeleteRoomType === type.value
                                    ? "text-red-700"
                                    : "text-red-650 hover:text-red-700"
                              }`}
                            >
                              {pendingDeleteRoomType === type.value ? "Click to confirm" : "Delete"}
                            </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
                    const bedDefinition = (form.elements.namedItem("bed") as HTMLInputElement).value.trim();
                    const description = (form.elements.namedItem("desc") as HTMLTextAreaElement).value.trim();
                    const amenitiesRaw = (form.elements.namedItem("amen") as HTMLInputElement).value.trim();
                    const amenities = amenitiesRaw
                      ? amenitiesRaw.split(",").map((a) => a.trim()).filter(Boolean)
                      : [];
                    const maxCapacity = parseInt((form.elements.namedItem("cap") as HTMLInputElement).value, 10) || 1;
                    const pricePerNight = parseFloat((form.elements.namedItem("baseRate") as HTMLInputElement).value) || 0;
                    const weekendRate = parseFloat((form.elements.namedItem("weekendRate") as HTMLInputElement).value) || pricePerNight;
                    const corporateRate = parseFloat((form.elements.namedItem("corpRate") as HTMLInputElement).value) || pricePerNight;

                    if (!value || !label || !shortLabel) return;
                    if (!bedDefinition) {
                      toast.error("Bed description is required", "Add a short bed description like \"1 queen + 1 single bed\".");
                      return;
                    }
                    if (roomTypes.some(t => t.value === value)) {
                      toast.error("Duplicate room type", `A room type with key "${value}" already exists.`);
                      return;
                    }

                    addRoomType({
                      value,
                      label,
                      shortLabel,
                      bedDefinition,
                      description,
                      amenities,
                      maxCapacity,
                      pricePerNight,
                      weekendRate,
                      corporateRate
                    });
                    form.reset();
                    toast.success(
                      "Room type added",
                      `${label} (${shortLabel}) — ${maxCapacity} guests, base ${formatPrice(pricePerNight)}/night.`
                    );
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

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Bed description
                      <input
                        name="bed"
                        type="text"
                        required
                        placeholder="e.g. 1 queen + 1 single bed"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Amenities (comma-separated)
                      <input
                        name="amen"
                        type="text"
                        placeholder="WiFi, AC, Work Desk, Private Bath"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                  </div>

                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Public description (shown on the guest rooms page)
                    <textarea
                      name="desc"
                      rows={2}
                      placeholder="Short marketing copy for the public rooms page."
                      className="min-h-[64px] w-full rounded border border-gray-250 bg-white px-3 py-2 text-sm font-medium focus:bg-white"
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-4">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Max guests
                      <input
                        name="cap"
                        type="number"
                        min={1}
                        defaultValue={2}
                        required
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Base rate / night ({config.currencySymbol})
                      <input
                        name="baseRate"
                        type="number"
                        min={0}
                        defaultValue={0}
                        required
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Weekend rate ({config.currencySymbol})
                      <input
                        name="weekendRate"
                        type="number"
                        min={0}
                        defaultValue={0}
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Corporate rate ({config.currencySymbol})
                      <input
                        name="corpRate"
                        type="number"
                        min={0}
                        defaultValue={0}
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                  </div>

                  <p className="text-[10px] leading-relaxed text-gray-500">
                    Per W3.6 + W3.7, all type fields live on the entry. You can edit them later via the
                    <strong> Edit</strong> button in the table above, and the rate matrix can also be updated in bulk from the
                    <strong> Rates</strong> tab.
                  </p>

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

          {/* ROOM TYPE EDIT MODAL (per W3.7 / `plan/features/SETTINGS.md §Room Types`) */}
          <Modal
            title={editType ? `Edit · ${editType.label}` : "Edit room type"}
            open={!!editType}
            onClose={() => {
              if (isEditSaving) return;
              setEditType(null);
            }}
            footer={
              editType ? (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setEditType(null)}
                    disabled={isEditSaving}
                    className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60 sm:min-h-[40px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="edit-room-type-form"
                    disabled={isEditSaving}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[40px]"
                  >
                    <Save size={14} />
                    {isEditSaving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              ) : null
            }
          >
            {editType ? (
              <form
                id="edit-room-type-form"
                ref={editTypeFormRef}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const get = (name: string) =>
                    (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value;
                  const label = get("lbl").trim();
                  const shortLabel = get("shortLbl").trim();
                  const bedDefinition = get("bed").trim();
                  const description = get("desc").trim();
                  const amenities = get("amen")
                    .split(",")
                    .map((a) => a.trim())
                    .filter(Boolean);
                  const maxCapacity = parseInt(get("cap"), 10) || 1;
                  const pricePerNight = parseFloat(get("baseRate")) || 0;
                  const weekendRate = parseFloat(get("weekendRate")) || pricePerNight;
                  const corporateRate = parseFloat(get("corpRate")) || pricePerNight;

                  if (!label || !shortLabel || !bedDefinition) {
                    toast.error("Missing required fields", "Label, short label, and bed description are required.");
                    return;
                  }

                  setIsEditSaving(true);
                  try {
                    await updateRoomType(editType.value, {
                      label,
                      shortLabel,
                      bedDefinition,
                      description,
                      amenities,
                      maxCapacity,
                      pricePerNight,
                      weekendRate,
                      corporateRate
                    });
                    toast.success(
                      "Room type updated",
                      `${label} — ${maxCapacity} guests, base ${formatPrice(pricePerNight)}/night.`
                    );
                    setEditType(null);
                  } catch (err) {
                    console.error("Error updating room type:", err);
                    toast.error("Failed to save changes", err instanceof Error ? err.message : "Unknown error");
                  } finally {
                    setIsEditSaving(false);
                  }
                }}
                className="space-y-4 text-sm"
              >
                <p className="text-[11px] text-gray-500">
                  Editing <span className="font-mono font-semibold">{editType.value}</span>. The identifier
                  key cannot be changed — delete and re-create the type if you need to rename it.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Full display name
                    <input
                      name="lbl"
                      type="text"
                      required
                      defaultValue={editType.label}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Short label (abbreviation)
                    <input
                      name="shortLbl"
                      type="text"
                      required
                      defaultValue={editType.shortLabel}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Bed description
                  <input
                    name="bed"
                    type="text"
                    required
                    defaultValue={editType.bedDefinition}
                    placeholder="e.g. 1 queen + 1 single bed"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Amenities (comma-separated)
                  <input
                    name="amen"
                    type="text"
                    defaultValue={editType.amenities.join(", ")}
                    placeholder="WiFi, AC, Work Desk, Private Bath"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Public description (shown on the guest rooms page)
                  <textarea
                    name="desc"
                    rows={3}
                    defaultValue={editType.description}
                    placeholder="Short marketing copy for the public rooms page."
                    className="min-h-[80px] w-full rounded border border-gray-250 bg-white px-3 py-2 text-sm font-medium focus:bg-white"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-4">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Max guests
                    <input
                      name="cap"
                      type="number"
                      min={1}
                      required
                      defaultValue={editType.maxCapacity}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Base rate / night ({config.currencySymbol})
                    <input
                      name="baseRate"
                      type="number"
                      min={0}
                      required
                      defaultValue={editType.pricePerNight}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Weekend rate ({config.currencySymbol})
                    <input
                      name="weekendRate"
                      type="number"
                      min={0}
                      defaultValue={editType.weekendRate}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Corporate rate ({config.currencySymbol})
                    <input
                      name="corpRate"
                      type="number"
                      min={0}
                      defaultValue={editType.corporateRate}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                </div>
              </form>
            ) : null}
          </Modal>

          {/* ROOM TYPE PHOTOS MANAGER (per `plan/features/SETTINGS.md §Room Types`) */}
          <Modal
            title={photoTarget ? `Photos · ${photoTarget.label}` : "Room type photos"}
            open={!!photoTarget}
            onClose={() => {
              setPhotoTarget(null);
              setPhotoUploading(false);
              if (photoFileInputRef.current) photoFileInputRef.current.value = "";
            }}
            footer={
              photoTarget ? (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoTarget(null);
                      setPhotoUploading(false);
                      if (photoFileInputRef.current) photoFileInputRef.current.value = "";
                    }}
                    className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:min-h-[40px]"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => photoFileInputRef.current?.click()}
                    disabled={photoUploading || photoTarget.imageUrls.length >= MAX_ROOM_TYPE_PHOTOS}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[40px]"
                  >
                    <Upload size={14} />
                    {photoUploading ? "Uploading…" : "Add photos"}
                  </button>
                </div>
              ) : null
            }
          >
            {photoTarget ? (
              <div className="space-y-4 text-sm">
                <input
                  ref={photoFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length === 0) return;
                    const remaining = MAX_ROOM_TYPE_PHOTOS - photoTarget.imageUrls.length;
                    if (files.length > remaining) {
                      toast.warning(
                        "Some photos skipped",
                        `Only ${remaining} slot${remaining === 1 ? "" : "s"} remaining (max ${MAX_ROOM_TYPE_PHOTOS} per type).`
                      );
                    }
                    const accepted = files.slice(0, remaining);
                    setPhotoUploading(true);
                    let successCount = 0;
                    for (const file of accepted) {
                      try {
                        const compressed = await compressImageFile(file);
                        const result = await uploadRoomTypePhoto(photoTarget.value, compressed.file);
                        if (result.success) successCount += 1;
                      } catch (err) {
                        console.error("Compress/upload failed:", err);
                      }
                    }
                    setPhotoUploading(false);
                    if (photoFileInputRef.current) photoFileInputRef.current.value = "";
                    if (successCount > 0) {
                      toast.success("Photos added", `${successCount} photo${successCount === 1 ? "" : "s"} uploaded.`);
                    } else if (accepted.length > 0) {
                      toast.error("Upload failed", "No photos could be uploaded. Check the file format and try again.");
                    }
                  }}
                />
                <p className="text-xs text-gray-600">
                  {photoTarget.imageUrls.length} / {MAX_ROOM_TYPE_PHOTOS} photos. All rooms of this type share the same gallery — the first photo is the hero image on the public rooms page.
                </p>

                {photoTarget.imageUrls.length === 0 ? (
                  <div className="rounded-card border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-xs text-gray-500">
                    No photos yet. Click <strong>Add photos</strong> to upload up to {MAX_ROOM_TYPE_PHOTOS}.
                  </div>
                ) : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photoTarget.imageUrls.map((url, index) => (
                      <li
                        key={url}
                        className="relative overflow-hidden rounded-card border border-gray-200 bg-white shadow-sm"
                      >
                        <div className="aspect-[4/3] bg-section-bg">
                          <img src={url} alt={`${photoTarget.label} photo ${index + 1}`} className="h-full w-full object-cover" />
                        </div>
                        <div className="flex items-center justify-between gap-1 border-t border-gray-100 px-2 py-1.5 text-[10px]">
                          <span className="font-semibold text-gray-500">
                            {index === 0 ? "Hero" : `#${index + 1}`}
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (index === 0) return;
                                const next = [...photoTarget.imageUrls];
                                const [moved] = next.splice(index, 1);
                                next.unshift(moved);
                                void reorderRoomTypePhotos(photoTarget.value, next);
                              }}
                              disabled={index === 0}
                              aria-label="Move to first"
                              className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (index === photoTarget.imageUrls.length - 1) return;
                                const next = [...photoTarget.imageUrls];
                                const [moved] = next.splice(index, 1);
                                next.splice(index + 1, 0, moved);
                                void reorderRoomTypePhotos(photoTarget.value, next);
                              }}
                              disabled={index === photoTarget.imageUrls.length - 1}
                              aria-label="Move to next"
                              className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronRight size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void removeRoomTypePhoto(photoTarget.value, url).then((res) => {
                                  if (res.success) {
                                    toast.success("Photo removed", `Photo #${index + 1} deleted.`);
                                  }
                                });
                              }}
                              aria-label="Delete photo"
                              className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Modal>

          {/* TAB 7: EMAIL CONFIG */}
          {activeTab === "email" && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Email Configuration</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Resend email delivery settings — managed via environment variables, read-only here.</p>
              </div>

              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-xs text-amber-800">
                <div className="flex items-start gap-2">
                  <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Code deploy required</p>
                    <p className="mt-1 leading-relaxed">Changing the Resend sender address or admin notification email requires updating environment variables and redeploying. Contact the development team to make these changes.</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-5 space-y-2">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Resend Sender Address</span>
                  <p className="text-sm font-semibold text-gray-900 font-mono">{config.supportEmail}</p>
                  <p className="text-[10px] text-gray-500">Used as the `from` address for all transactional emails.</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-5 space-y-2">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Admin Notification Email</span>
                  <p className="text-sm font-semibold text-gray-900 font-mono">{config.supportEmail}</p>
                  <p className="text-[10px] text-gray-500">Receives new corporate inquiry notifications and staff alerts.</p>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-150">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-3">Active Email Triggers</h4>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { label: "Booking Submitted", description: "Guest receives acknowledgment when a booking request is submitted", status: "active" },
                    { label: "Payment Confirmed", description: "Guest notified when their payment is verified and fully paid", status: "active" },
                    { label: "Booking Confirmed", description: "Guest notified when booking is confirmed by front desk", status: "active" },
                    { label: "Check-in Reminder", description: "Scheduled daily cron — guests with tomorrow's check-in get a reminder", status: "active" },
                    { label: "Booking Cancelled", description: "Guest receives cancellation confirmation", status: "active" },
                    { label: "Discount Rejected", description: "Guest notified when their Senior/PWD ID cannot be verified", status: "active" },
                    { label: "Corporate Inquiry", description: "Staff notification when a new corporate inquiry is submitted", status: "active" },
                    { label: "Early Check-in Request", description: "Staff notification when a member requests early check-in via Intercom", status: "planned" }
                  ].map(trigger => (
                    <div key={trigger.label} className="rounded-lg border border-gray-150 bg-white p-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${trigger.status === "active" ? "bg-green-500" : "bg-gray-300"}`} />
                        <span className="text-xs font-bold text-gray-800">{trigger.label}</span>
                        {trigger.status === "planned" && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">Planned</span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-relaxed">{trigger.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: INTERCOM CONFIG */}
          {activeTab === "intercom" && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Intercom Settings</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Quick request shortcuts and notification sound for the guest-to-staff intercom.</p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSaveIntercom(); }} className="space-y-6">
                <div className="space-y-4">
                  <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Quick Request Items</h4>
                  <p className="text-[10px] text-gray-500">These appear as tap-to-send shortcuts in the guest Intercom page. Guests can select one without typing.</p>
                  <div className="space-y-2">
                    {intercomQuickRequests.map((req, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={req}
                          onChange={(e) => {
                            const updated = [...intercomQuickRequests];
                            updated[index] = e.target.value;
                            setIntercomQuickRequests(updated);
                          }}
                          className="min-h-[40px] flex-1 rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIntercomQuickRequests(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="min-h-[40px] px-2 rounded border border-red-200 text-red-500 hover:bg-red-50 transition"
                          aria-label="Remove quick request"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setIntercomQuickRequests(prev => [...prev, ""])}
                      className="min-h-[40px] w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-primary hover:text-primary transition"
                    >
                      <Plus size={14} />
                      Add Quick Request
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Notification Sound</h4>
                  <p className="text-[10px] text-gray-500">URL of the audio file that plays in the admin Intercom Inbox when a new message arrives while the tab is not focused.</p>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Sound File URL
                    <input
                      type="url"
                      value={notificationSoundUrl}
                      onChange={(e) => setNotificationSoundUrl(e.target.value)}
                      placeholder="https://firebasestorage.googleapis.com/..."
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                  {notificationSoundUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const audio = new Audio(notificationSoundUrl);
                        audio.play().catch(() => toast.error("Could not play audio", "Check the URL is a valid audio file."));
                      }}
                      className="min-h-[36px] px-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-250 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
                    >
                      <Volume2 size={14} />
                      Preview Sound
                    </button>
                  )}
                </div>

                <div className="pt-2 border-t border-gray-150 flex justify-end">
                  <button
                    type="submit"
                    className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                  >
                    <Save size={14} />
                    Save Intercom Settings
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 9: LEGAL CONTENT */}
          {activeTab === "legal" && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Legal Content</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Manage legal documents displayed on the guest site. Changes take effect immediately.</p>
              </div>

              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-xs text-blue-800">
                <div className="flex items-start gap-2">
                  <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Deployment-managed fields</p>
                    <p className="mt-1 leading-relaxed">Some legal fields (legal name, DPO email, applicable law) are set at deployment in <code>hotel.config.ts</code> and require the development team to update.</p>
                  </div>
                </div>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSaveLegal(); }} className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Privacy Policy</h4>
                    {privacyPolicyLastUpdated && (
                      <span className="text-[10px] text-gray-400">Last updated: {privacyPolicyLastUpdated}</span>
                    )}
                  </div>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Privacy Policy Body
                    <textarea
                      value={privacyPolicyBody}
                      onChange={(e) => setPrivacyPolicyBody(e.target.value)}
                      rows={12}
                      placeholder="Enter the full Privacy Policy text. This is displayed on the guest-facing /privacy page. Uses plain text or simple markdown. If left blank, the page falls back to the deployment-configured content."
                      className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white leading-relaxed"
                    />
                  </label>
                  <p className="text-[10px] text-gray-500">Displayed at <code>/privacy</code>. If left blank, the guest page uses a deployment-configured fallback. New date is auto-set on save.</p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Cancellation Policy</h4>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Cancellation Policy
                    <textarea
                      value={cancellationPolicy}
                      onChange={(e) => setCancellationPolicy(e.target.value)}
                      rows={4}
                      placeholder="Cancellations made 48 hours or more before check-in are eligible for a full refund..."
                      className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white leading-relaxed"
                    />
                  </label>
                  <p className="text-[10px] text-gray-500">Shown at booking Step 3 and in confirmation emails. If left blank, a default policy is used.</p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">House Rules</h4>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    House Rules
                    <textarea
                      value={houseRules}
                      onChange={(e) => setHouseRules(e.target.value)}
                      rows={4}
                      placeholder="No smoking inside rooms. Quiet hours from 10 PM to 7 AM..."
                      className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white leading-relaxed"
                    />
                  </label>
                  <p className="text-[10px] text-gray-500">Used in the guest registration PDF at check-in. If left blank, the field is omitted from the printed form.</p>
                </div>

                <div className="pt-2 border-t border-gray-150 flex justify-end">
                  <button
                    type="submit"
                    className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                  >
                    <Save size={14} />
                    Save Legal Content
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 10: STAFF ACCOUNTS (admin-only) */}
          {activeTab === "staff" && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Staff Accounts</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Provision front-desk and admin accounts. All account actions are logged to <code>guests/{`{uid}`}</code> with the operator's UID.</p>
              </div>

              {!isAdmin ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-5 text-xs text-amber-800 flex gap-2.5 items-start">
                  <Lock size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Admin only</p>
                    <p className="mt-1 leading-relaxed">Only admin accounts can create or disable staff. Sign in with an admin account to manage the team.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-xs text-blue-800 flex gap-2.5 items-start">
                    <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">How staff accounts work</p>
                      <p className="mt-1 leading-relaxed">New accounts are created via the server-side <code>/api/admin/create-staff</code> route. The Firebase Auth user gets a <code>role</code> custom claim (<code>admin</code> or <code>front-desk</code>). The profile is mirrored to <code>guests/{`{uid}`}</code>. Disabling a staff member revokes their Auth sign-in and marks the profile inactive. You cannot disable your own account, and you cannot disable the last active admin.</p>
                    </div>
                  </div>

                  {/* Staff list */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Current Staff ({staff.length})</h4>
                      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[10px] font-bold text-gray-600">
                        <Users size={12} />
                        {staff.filter(s => s.role === "admin").length} admins, {staff.filter(s => s.role === "front-desk").length} front desk
                      </span>
                    </div>

                    {staff.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-250 bg-gray-50 p-8 text-center">
                        <UserCog size={24} className="mx-auto text-gray-400" />
                        <h5 className="mt-3 text-sm font-bold text-gray-900">No staff accounts yet</h5>
                        <p className="mx-auto mt-1 max-w-md text-[10px] leading-relaxed text-gray-500">
                          Use the form below to create the first admin or front-desk account.
                        </p>
                      </div>
                    ) : (
                      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                        {isMobile ? (
                          <ul className="divide-y divide-gray-100 font-medium">
                            {staff.map((member) => {
                              const isCurrentUser = member.uid === currentUser?.uid;
                              return (
                                <li key={member.uid} className="flex items-start justify-between gap-3 p-4">
                                  <div className="min-w-0 flex-1 space-y-1.5">
                                    <p className="text-sm font-semibold text-gray-900 truncate">
                                      {member.fullName || "(no name)"}
                                      {isCurrentUser ? <span className="ml-2 inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-dark">You</span> : null}
                                    </p>
                                    <p className="font-mono text-[11px] text-gray-500 truncate">{member.email}</p>
                                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                        member.role === "admin"
                                          ? "border-primary/30 bg-primary-light text-primary-dark"
                                          : "border-gray-200 bg-gray-100 text-gray-600"
                                      }`}>
                                        {member.role === "admin" ? "Admin" : "Front Desk"}
                                      </span>
                                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                        member.isActive
                                          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                                          : "border-gray-200 bg-gray-100 text-gray-500"
                                      }`}>
                                        {member.isActive ? "Active" : "Disabled"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="shrink-0">
                                    {member.isActive ? (
                                      <button
                                        type="button"
                                        disabled={isCurrentUser}
                                        onClick={() => openDisableStaffConfirm(member)}
                                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-100 px-3 text-[10px] font-bold text-red-650 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        title={isCurrentUser ? "You cannot disable your own account" : "Disable this staff account"}
                                      >
                                        <Lock size={13} />
                                        Disable
                                      </button>
                                    ) : (
                                      <span className="text-[10px] text-gray-400 italic">No actions</span>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <table className="min-w-full divide-y divide-gray-150 text-xs">
                            <thead>
                              <tr className="bg-gray-50 text-gray-400 font-bold uppercase text-[9px] tracking-wider text-left">
                                <th className="px-4 py-2.5">Name</th>
                                <th className="px-4 py-2.5">Email</th>
                                <th className="px-4 py-2.5">Role</th>
                                <th className="px-4 py-2.5">Status</th>
                                <th className="px-4 py-2.5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 font-medium">
                              {staff.map((member) => {
                                const isCurrentUser = member.uid === currentUser?.uid;
                                return (
                                  <tr key={member.uid} className="text-gray-800 hover:bg-gray-50/50">
                                    <td className="px-4 py-3 font-semibold text-gray-900">
                                      {member.fullName || "(no name)"}
                                      {isCurrentUser ? <span className="ml-2 inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-dark">You</span> : null}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700 font-mono text-[11px]">{member.email}</td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                        member.role === "admin"
                                          ? "border-primary/30 bg-primary-light text-primary-dark"
                                          : "border-gray-200 bg-gray-100 text-gray-600"
                                      }`}>
                                        {member.role === "admin" ? "Admin" : "Front Desk"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                        member.isActive
                                          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                                          : "border-gray-200 bg-gray-100 text-gray-500"
                                      }`}>
                                        {member.isActive ? "Active" : "Disabled"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      {member.isActive ? (
                                        <button
                                          type="button"
                                          disabled={isCurrentUser}
                                          onClick={() => openDisableStaffConfirm(member)}
                                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-100 px-3 text-[10px] font-bold text-red-650 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                          title={isCurrentUser ? "You cannot disable your own account" : "Disable this staff account"}
                                        >
                                          <Lock size={13} />
                                          Disable
                                        </button>
                                      ) : (
                                        <span className="text-[10px] text-gray-400 italic">No actions</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Create staff form */}
                  <div className="space-y-4 border-t border-gray-150 pt-5">
                    <h4 className="text-xs font-bold text-gray-750 flex items-center gap-1">
                      <Plus size={14} className="text-primary" />
                      Create Staff Account
                    </h4>

                    <form
                      onSubmit={handleCreateStaffSubmit}
                      className="space-y-4 bg-gray-50 p-5 rounded-xl border border-gray-150"
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                          Full Name
                          <input
                            type="text"
                            required
                            value={newStaffName}
                            onChange={(e) => setNewStaffName(e.target.value)}
                            placeholder="Jane Doe"
                            className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                          Email
                          <input
                            type="email"
                            required
                            value={newStaffEmail}
                            onChange={(e) => setNewStaffEmail(e.target.value)}
                            placeholder="janedoe@sparkinn.com"
                            className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                          />
                        </label>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                          Temporary Password
                          <input
                            type="text"
                            required
                            minLength={8}
                            value={newStaffPassword}
                            onChange={(e) => setNewStaffPassword(e.target.value)}
                            placeholder="At least 8 characters"
                            autoComplete="new-password"
                            className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white font-mono"
                          />
                          <span className="text-[10px] font-medium text-gray-500">Share securely with the new staff member. They can change it after first sign-in.</span>
                        </label>
                        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                          Phone (optional)
                          <input
                            type="tel"
                            value={newStaffPhone}
                            onChange={(e) => setNewStaffPhone(e.target.value)}
                            placeholder="+63 917 000 0000"
                            className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                          />
                        </label>
                      </div>
                      <fieldset className="space-y-2">
                        <legend className="text-xs font-semibold text-gray-700">Role</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-xs font-bold transition ${
                            newStaffRole === "front-desk"
                              ? "border-primary/30 bg-primary/5 text-primary-dark"
                              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                          }`}>
                            <input
                              type="radio"
                              name="newStaffRole"
                              value="front-desk"
                              checked={newStaffRole === "front-desk"}
                              onChange={() => setNewStaffRole("front-desk")}
                              className="h-4 w-4 accent-primary"
                            />
                            <div>
                              <div>Front Desk</div>
                              <div className="text-[10px] font-medium text-gray-500">Bookings, check-in, intercom, dashboard.</div>
                            </div>
                          </label>
                          <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-xs font-bold transition ${
                            newStaffRole === "admin"
                              ? "border-primary/30 bg-primary/5 text-primary-dark"
                              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                          }`}>
                            <input
                              type="radio"
                              name="newStaffRole"
                              value="admin"
                              checked={newStaffRole === "admin"}
                              onChange={() => setNewStaffRole("admin")}
                              className="h-4 w-4 accent-primary"
                            />
                            <div>
                              <div>Admin</div>
                              <div className="text-[10px] font-medium text-gray-500">All front-desk access + Settings, Rates, Members.</div>
                            </div>
                          </label>
                        </div>
                      </fieldset>

                      {staffFormMessage ? (
                        <div className={`rounded-lg border px-3 py-2 text-[10px] font-semibold ${
                          staffFormMessage.type === "success"
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-red-100 bg-red-50 text-red-700"
                        }`}>
                          {staffFormMessage.text}
                        </div>
                      ) : null}

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={isCreatingStaff}
                          className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Plus size={14} />
                          {isCreatingStaff ? "Creating..." : "Create Staff Account"}
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        title="Disable staff account?"
        open={Boolean(disablingStaff)}
        onClose={closeDisableStaffConfirm}
      >
        {disablingStaff ? (
          <div className="space-y-4 text-xs">
            <p className="text-xs text-gray-700 leading-relaxed">
              Disable <span className="font-bold">{disablingStaff.name}</span>? They will be signed out and unable to sign in again. You can re-enable by contacting the development team.
            </p>
            {disableStaffError ? (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700">
                {disableStaffError}
              </div>
            ) : null}
            <div className="flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDisableStaffConfirm}
                disabled={isDisablingStaff}
                className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDisableStaff}
                disabled={isDisablingStaff}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-red-650 px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Lock size={14} />
                {isDisablingStaff ? "Disabling..." : "Disable Account"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
