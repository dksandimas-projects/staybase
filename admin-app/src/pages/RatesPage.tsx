import { useState, useEffect } from "react";
import { useAdmin, Voucher, CorporateCode } from "../context/AdminContext";
import { getSeasonalRateForNight, isWeekendNight, DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT } from "@spark-inn/shared";
import type { SeasonalRateOverride } from "@spark-inn/shared";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { useToast } from "../components/Toast";
import { formatPrice } from "../utils/format";
import { useBreakpoint } from "../utils/useBreakpoint";
import {
  Plus, Tag, Gift, Trash2, Calendar, ShieldCheck, Pencil,
  Landmark, Save, ShieldAlert, CreditCard, Info, ChevronLeft, ChevronRight, X
} from "lucide-react";
import config from "@config";

function startOfMonthUtc(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addMonthsUtc(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function addDaysUtc(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function getMonthDates(value: Date) {
  const start = startOfMonthUtc(value);
  const nextMonth = addMonthsUtc(start, 1);
  const dates: Date[] = [];
  for (let cursor = start; cursor < nextMonth; cursor = addDaysUtc(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat(config.locale, { month: "long", year: "numeric" }).format(value);
}

function formatRateDay(value: Date) {
  return new Intl.DateTimeFormat(config.locale, { weekday: "short", day: "numeric" }).format(value);
}

function toDateInputValue(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function isDateInInclusiveRange(dateKey: string, startDate: string, endDate: string) {
  return dateKey >= startDate && dateKey <= endDate;
}

export function RatesPage() {
  const {
    vouchers,
    addVoucher,
    updateVoucher,
    toggleVoucherActive,
    corporateCodes,
    addCorporateCode,
    updateCorporateCode,
    toggleCorporateCodeActive,
    deleteCorporateCode,
    seasonalRateOverrides,
    breakfastConfig,
    updateSettings,
    updateRoomType,
    roomTypes,
    currentUser,
    ratesLoading
  } = useAdmin();
  const { isMobile } = useBreakpoint();
  const toast = useToast();

  // Modal State
  const [isVchModalOpen, setIsVchModalOpen] = useState(false);
  const [isCorpModalOpen, setIsCorpModalOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [editingCorporateCode, setEditingCorporateCode] = useState<CorporateCode | null>(null);

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
  const [vchIsActive, setVchIsActive] = useState(true);
  // Per W4.4 / decision #104: optional guest email — when set,
  // the server fires a voucher-issued email to the guest with
  // the code in a large monospace block.
  const [vchGuestEmail, setVchGuestEmail] = useState("");

  // Corporate Code Form States
  const [corpCode, setCorpCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [corpExpiresAt, setCorpExpiresAt] = useState("");
  const [corpUsageCap, setCorpUsageCap] = useState("");
  const [corpIsActive, setCorpIsActive] = useState(true);

  // Local pricing state per room type — the source of truth now lives on
  // the RoomType entry itself (per W3.6 / `plan/features/RATE-MANAGEMENT.md
  // §W3.6`), so the local state is just the in-flight form buffer that
  // is flushed via `updateRoomType` on save.
  const [prices, setPrices] = useState<Record<string, { base: number; weekend: number; corporate: number }>>({});
  const [dirtyRateFields, setDirtyRateFields] = useState<Set<string>>(() => new Set());
  const [roomRates, setRoomRates] = useState<Record<string, string>>({});
  const [dirtyCorporateRateTypes, setDirtyCorporateRateTypes] = useState<Set<string>>(() => new Set());
  const [seasonalName, setSeasonalName] = useState("");
  const [seasonalStart, setSeasonalStart] = useState("");
  const [seasonalEnd, setSeasonalEnd] = useState("");
  const [seasonalRate, setSeasonalRate] = useState("");
  const [seasonalRoomTypes, setSeasonalRoomTypes] = useState<string[]>([]);
  const [isSavingSeasonal, setIsSavingSeasonal] = useState(false);
  const [rateCalendarMonth, setRateCalendarMonth] = useState(() => startOfMonthUtc(new Date()));
  const [rateSelection, setRateSelection] = useState<{
    startDate: string;
    endDate: string;
    roomTypeValues: string[];
  } | null>(null);
  const [calendarOverrideName, setCalendarOverrideName] = useState("");
  const [calendarOverrideRate, setCalendarOverrideRate] = useState("");
  const [isSavingCalendarOverride, setIsSavingCalendarOverride] = useState(false);
  const [editingSeasonalOverride, setEditingSeasonalOverride] = useState<SeasonalRateOverride | null>(null);
  const [editSeasonalName, setEditSeasonalName] = useState("");
  const [editSeasonalStart, setEditSeasonalStart] = useState("");
  const [editSeasonalEnd, setEditSeasonalEnd] = useState("");
  const [editSeasonalRate, setEditSeasonalRate] = useState("");
  const [editSeasonalRoomTypes, setEditSeasonalRoomTypes] = useState<string[]>([]);
  const [editSeasonalActive, setEditSeasonalActive] = useState(true);

  // Keep form buffers synced with Firestore-backed room types until the
  // admin edits a field. This prevents deploy-time defaults from clobbering
  // live rates when the settings snapshot arrives after first paint.
  useEffect(() => {
    const initialPrices: Record<string, { base: number; weekend: number; corporate: number }> = {};
    roomTypes.forEach(t => {
      initialPrices[t.value] = {
        base: t.pricePerNight,
        weekend: t.weekendRate,
        corporate: t.corporateRate
      };
    });

    setPrices(prev => {
      const updated = { ...prev };
      roomTypes.forEach(t => {
        const current = updated[t.value] || { base: 0, weekend: 0, corporate: 0 };
        updated[t.value] = {
          base: dirtyRateFields.has(`${t.value}.base`) ? current.base : initialPrices[t.value].base,
          weekend: dirtyRateFields.has(`${t.value}.weekend`) ? current.weekend : initialPrices[t.value].weekend,
          corporate: dirtyRateFields.has(`${t.value}.corporate`) ? current.corporate : initialPrices[t.value].corporate
        };
      });
      return updated;
    });

    setRoomRates(prev => {
      const updated = { ...prev };
      roomTypes.forEach(t => {
        if (!dirtyCorporateRateTypes.has(t.value)) {
          updated[t.value] = String(t.corporateRate || t.pricePerNight || 0);
        }
      });
      return updated;
    });
  }, [roomTypes, dirtyRateFields, dirtyCorporateRateTypes]);

  // Local breakfast rate state
  const [bfRate, setBfRate] = useState(String(breakfastConfig.ratePerPersonPerNight));
  const [bfRateDirty, setBfRateDirty] = useState(false);
  useEffect(() => {
    if (!bfRateDirty) {
      setBfRate(String(breakfastConfig.ratePerPersonPerNight));
    }
  }, [breakfastConfig.ratePerPersonPerNight, bfRateDirty]);

  const updateRateField = (typeValue: string, field: "base" | "weekend" | "corporate", value: number) => {
    setDirtyRateFields(prev => new Set(prev).add(`${typeValue}.${field}`));
    setPrices(prev => ({
      ...prev,
      [typeValue]: {
        base: prev[typeValue]?.base ?? 0,
        weekend: prev[typeValue]?.weekend ?? 0,
        corporate: prev[typeValue]?.corporate ?? 0,
        [field]: value
      }
    }));
  };

  const updateCorporateRoomRate = (typeValue: string, value: string) => {
    setDirtyCorporateRateTypes(prev => new Set(prev).add(typeValue));
    setRoomRates(prev => ({ ...prev, [typeValue]: value }));
  };

  // Booking payment methods are managed in Settings → Payment
  // Methods (per `plan/features/SETTINGS.md §Payment Methods`).
  // This page deep-links there from the "Manage payment methods"
  // button at the bottom of the page.

  // Toggle applicable room checkbox
  const handleRoomCheckbox = (typeVal: string) => {
    if (applicableRooms.includes(typeVal)) {
      setApplicableRooms(prev => prev.filter(t => t !== typeVal));
    } else {
      setApplicableRooms(prev => [...prev, typeVal]);
    }
  };

  const saveSeasonalOverrides = async (next: SeasonalRateOverride[]) => {
    await updateSettings("hotelConfig", {
      seasonalRateOverrides: next,
      updatedAt: new Date()
    });
  };

  const toggleSeasonalRoomType = (typeValue: string) => {
    setSeasonalRoomTypes(prev =>
      prev.includes(typeValue)
        ? prev.filter(value => value !== typeValue)
        : [...prev, typeValue]
    );
  };

  const handleSeasonalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seasonalName.trim() || !seasonalStart || !seasonalEnd || !seasonalRate) {
      toast.warning("Missing seasonal rate details", "Add a name, date range, and nightly rate.");
      return;
    }
    if (seasonalEnd < seasonalStart) {
      toast.warning("Invalid date range", "End date must be on or after the start date.");
      return;
    }

    const rate = Number(seasonalRate);
    if (!Number.isFinite(rate) || rate < 0) {
      toast.warning("Invalid nightly rate", "Enter a zero or positive amount.");
      return;
    }

    setIsSavingSeasonal(true);
    try {
      const override: SeasonalRateOverride = {
        id: `seasonal-${Date.now()}`,
        name: seasonalName.trim(),
        startDate: seasonalStart,
        endDate: seasonalEnd,
        rate,
        roomTypeValues: seasonalRoomTypes,
        isActive: true
      };
      await saveSeasonalOverrides([override, ...seasonalRateOverrides]);
      setSeasonalName("");
      setSeasonalStart("");
      setSeasonalEnd("");
      setSeasonalRate("");
      setSeasonalRoomTypes([]);
      toast.success("Seasonal rate added", "New bookings in that date range will use the override.");
    } catch (err) {
      console.error("Failed to save seasonal rate:", err);
      toast.error("Seasonal rate not saved", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSavingSeasonal(false);
    }
  };

  const toggleSeasonalActive = async (id: string) => {
    try {
      const next = seasonalRateOverrides.map((override) =>
        override.id === id ? { ...override, isActive: !override.isActive } : override
      );
      await saveSeasonalOverrides(next);
      toast.success("Status updated", "Seasonal override status has been updated.");
    } catch (err) {
      console.error("Failed to toggle seasonal active status:", err);
      toast.error("Failed to update status", err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  const deleteSeasonalOverride = async (id: string) => {
    try {
      await saveSeasonalOverrides(seasonalRateOverrides.filter((override) => override.id !== id));
      toast.success("Override removed", "Seasonal override has been deleted.");
    } catch (err) {
      console.error("Failed to delete seasonal override:", err);
      toast.error("Failed to delete override", err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  const formatSeasonalRoomScope = (override: SeasonalRateOverride) => {
    if (override.roomTypeValues.length === 0) return "All room types";
    return override.roomTypeValues
      .map((value) => roomTypes.find((type) => type.value === value)?.shortLabel || value)
      .join(", ");
  };

  const rateCalendarDates = getMonthDates(rateCalendarMonth);
  const activeRoomTypeValues = roomTypes.map((type) => type.value);
  const selectionRoomTypes = rateSelection?.roomTypeValues || [];
  const selectedCalendarRoomLabels = selectionRoomTypes
    .map((value) => roomTypes.find((type) => type.value === value)?.shortLabel || value)
    .join(", ");
  const selectionDateCount = rateSelection
    ? Math.floor((parseDateKey(rateSelection.endDate).getTime() - parseDateKey(rateSelection.startDate).getTime()) / 86_400_000) + 1
    : 0;

  const getRateCalendarCell = (roomType: typeof roomTypes[number], date: Date) => {
    const seasonal = getSeasonalRateForNight(date, roomType.value, seasonalRateOverrides);
    if (seasonal) {
      return {
        rate: seasonal.rate,
        source: "seasonal",
        label: seasonal.name,
        override: seasonal
      };
    }

    if (isWeekendNight(date) && roomType.weekendRate) {
      return {
        rate: roomType.weekendRate,
        source: "weekend",
        label: "Weekend",
        override: null
      };
    }

    return {
      rate: roomType.pricePerNight,
      source: "regular",
      label: "Regular",
      override: null
    };
  };

  const isRateCellSelected = (roomTypeValue: string, dateKey: string) => {
    return Boolean(
      rateSelection &&
      rateSelection.roomTypeValues.includes(roomTypeValue) &&
      isDateInInclusiveRange(dateKey, rateSelection.startDate, rateSelection.endDate)
    );
  };

  const handleRateCellClick = (roomTypeValue: string, dateKey: string) => {
    if (!rateSelection) {
      setRateSelection({ startDate: dateKey, endDate: dateKey, roomTypeValues: [roomTypeValue] });
      return;
    }

    if (isRateCellSelected(roomTypeValue, dateKey)) {
      setRateSelection(null);
      return;
    }

    const nextRoomTypeValues = rateSelection.roomTypeValues.includes(roomTypeValue)
      ? rateSelection.roomTypeValues
      : [...rateSelection.roomTypeValues, roomTypeValue];
    const nextStart = dateKey < rateSelection.startDate ? dateKey : rateSelection.startDate;
    const nextEnd = dateKey > rateSelection.endDate ? dateKey : rateSelection.endDate;
    setRateSelection({
      startDate: nextStart,
      endDate: nextEnd,
      roomTypeValues: nextRoomTypeValues
    });
  };

  const toggleEditSeasonalRoomType = (typeValue: string) => {
    setEditSeasonalRoomTypes(prev =>
      prev.includes(typeValue)
        ? prev.filter(value => value !== typeValue)
        : [...prev, typeValue]
    );
  };

  const findOverlappingSeasonalOverrides = (
    startDate: string,
    endDate: string,
    roomTypeValues: string[],
    exceptId?: string
  ) => {
    const selectedTypes = roomTypeValues.length > 0 ? roomTypeValues : activeRoomTypeValues;
    return seasonalRateOverrides.filter((override) => {
      if (override.id === exceptId || !override.isActive) return false;
      if (endDate < override.startDate || startDate > override.endDate) return false;
      const overrideTypes = override.roomTypeValues.length > 0 ? override.roomTypeValues : activeRoomTypeValues;
      return selectedTypes.some((value) => overrideTypes.includes(value));
    });
  };

  const handleSaveCalendarOverride = async () => {
    if (!rateSelection || !calendarOverrideName.trim() || !calendarOverrideRate) {
      toast.warning("Missing rate details", "Select dates, add a label, and enter a nightly rate.");
      return;
    }

    const rate = Number(calendarOverrideRate);
    if (!Number.isFinite(rate) || rate < 0) {
      toast.warning("Invalid nightly rate", "Enter a zero or positive amount.");
      return;
    }

    const roomTypeValues = rateSelection.roomTypeValues.length === activeRoomTypeValues.length ? [] : rateSelection.roomTypeValues;
    const overlaps = findOverlappingSeasonalOverrides(rateSelection.startDate, rateSelection.endDate, roomTypeValues);
    setIsSavingCalendarOverride(true);
    try {
      const override: SeasonalRateOverride = {
        id: `seasonal-${Date.now()}`,
        name: calendarOverrideName.trim(),
        startDate: rateSelection.startDate,
        endDate: rateSelection.endDate,
        rate,
        roomTypeValues,
        isActive: true
      };
      await saveSeasonalOverrides([override, ...seasonalRateOverrides]);
      toast.success(
        "Rate calendar updated",
        overlaps.length > 0 ? `Saved. Review ${overlaps.length} overlapping override${overlaps.length === 1 ? "" : "s"}.` : "Seasonal rate saved."
      );
      setRateSelection(null);
      setCalendarOverrideName("");
      setCalendarOverrideRate("");
    } catch (err) {
      console.error("Failed to save calendar rate:", err);
      toast.error("Rate not saved", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSavingCalendarOverride(false);
    }
  };

  const openSeasonalOverrideEditor = (override: SeasonalRateOverride) => {
    setEditingSeasonalOverride(override);
    setEditSeasonalName(override.name);
    setEditSeasonalStart(override.startDate);
    setEditSeasonalEnd(override.endDate);
    setEditSeasonalRate(String(override.rate));
    setEditSeasonalRoomTypes(override.roomTypeValues);
    setEditSeasonalActive(override.isActive);
  };

  const closeSeasonalOverrideEditor = () => {
    setEditingSeasonalOverride(null);
    setEditSeasonalName("");
    setEditSeasonalStart("");
    setEditSeasonalEnd("");
    setEditSeasonalRate("");
    setEditSeasonalRoomTypes([]);
    setEditSeasonalActive(true);
  };

  const handleUpdateSeasonalOverride = async () => {
    if (!editingSeasonalOverride || !editSeasonalName.trim() || !editSeasonalStart || !editSeasonalEnd || !editSeasonalRate) {
      toast.warning("Missing override details", "Add a name, date range, and nightly rate.");
      return;
    }
    if (editSeasonalEnd < editSeasonalStart) {
      toast.warning("Invalid date range", "End date must be on or after the start date.");
      return;
    }

    const rate = Number(editSeasonalRate);
    if (!Number.isFinite(rate) || rate < 0) {
      toast.warning("Invalid nightly rate", "Enter a zero or positive amount.");
      return;
    }

    const overlaps = findOverlappingSeasonalOverrides(
      editSeasonalStart,
      editSeasonalEnd,
      editSeasonalRoomTypes,
      editingSeasonalOverride.id
    );

    const next = seasonalRateOverrides.map((override) =>
      override.id === editingSeasonalOverride.id
        ? {
            ...override,
            name: editSeasonalName.trim(),
            startDate: editSeasonalStart,
            endDate: editSeasonalEnd,
            rate,
            roomTypeValues: editSeasonalRoomTypes,
            isActive: editSeasonalActive
          }
        : override
    );
    await saveSeasonalOverrides(next);
    toast.success(
      "Seasonal override updated",
      overlaps.length > 0 ? `Review ${overlaps.length} overlapping override${overlaps.length === 1 ? "" : "s"}.` : "Rate calendar cells refreshed."
    );
    closeSeasonalOverrideEditor();
  };

  const handleDeleteEditingSeasonalOverride = async () => {
    if (!editingSeasonalOverride) return;
    await deleteSeasonalOverride(editingSeasonalOverride.id);
    toast.success("Seasonal override deleted", "The rate calendar has been updated.");
    closeSeasonalOverrideEditor();
  };

  const resetVoucherForm = () => {
    setEditingVoucher(null);
    setVchCode("");
    setDiscountType("percent");
    setDiscountValue("");
    setUsageCap("");
    setExpiresAt("");
    setApplicableRooms([]);
    setVchGuestEmail("");
    setVchIsActive(true);
  };

  const openCreateVoucherModal = () => {
    resetVoucherForm();
    setIsVchModalOpen(true);
  };

  const openVoucherEditor = (voucher: Voucher) => {
    setEditingVoucher(voucher);
    setVchCode(voucher.code);
    setDiscountType(voucher.discountType);
    setDiscountValue(String(voucher.discountValue));
    setUsageCap(voucher.usageCap === null ? "" : String(voucher.usageCap));
    setExpiresAt(toDateInputValue(voucher.expiresAt));
    setApplicableRooms(voucher.applicableRoomTypes || []);
    setVchGuestEmail(voucher.guestEmail || "");
    setVchIsActive(voucher.isActive);
    setIsVchModalOpen(true);
  };

  const closeVoucherModal = () => {
    setIsVchModalOpen(false);
    resetVoucherForm();
  };

  const resetCorporateCodeForm = () => {
    setEditingCorporateCode(null);
    setCorpCode("");
    setCompanyName("");
    setCorpExpiresAt("");
    setCorpUsageCap("");
    setCorpIsActive(true);
    setDirtyCorporateRateTypes(new Set());
  };

  const openCreateCorporateModal = () => {
    resetCorporateCodeForm();
    const nextRates: Record<string, string> = {};
    roomTypes.forEach(type => {
      nextRates[type.value] = String(type.corporateRate || type.pricePerNight || 0);
    });
    setRoomRates(nextRates);
    setIsCorpModalOpen(true);
  };

  const openCorporateCodeEditor = (code: CorporateCode) => {
    setEditingCorporateCode(code);
    setCorpCode(code.code);
    setCompanyName(code.companyName);
    setCorpExpiresAt(toDateInputValue(code.expiresAt));
    setCorpUsageCap(code.usageCap === null ? "" : String(code.usageCap));
    setCorpIsActive(code.isActive);
    const nextRates: Record<string, string> = {};
    roomTypes.forEach(type => {
      nextRates[type.value] = String(code.ratePerRoomType?.[type.value] ?? type.corporateRate ?? type.pricePerNight ?? 0);
    });
    setRoomRates(nextRates);
    setDirtyCorporateRateTypes(new Set(roomTypes.map(type => type.value)));
    setIsCorpModalOpen(true);
  };

  const closeCorporateModal = () => {
    setIsCorpModalOpen(false);
    resetCorporateCodeForm();
  };

  const handleVoucherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vchCode || !discountValue) return;

    const voucherPayload = {
      code: vchCode.trim().toUpperCase(),
      discountType,
      discountValue: parseFloat(discountValue) || 0,
      usageCap: usageCap ? parseInt(usageCap) : null,
      expiresAt: expiresAt || null,
      applicableRoomTypes: applicableRooms,
      isActive: vchIsActive,
      createdBy: currentUser?.uid || "staff",
      guestEmail: vchGuestEmail.trim() || null
    };

    const result = editingVoucher
      ? await updateVoucher(editingVoucher.id, {
          discountType: voucherPayload.discountType,
          discountValue: voucherPayload.discountValue,
          usageCap: voucherPayload.usageCap,
          expiresAt: voucherPayload.expiresAt,
          applicableRoomTypes: voucherPayload.applicableRoomTypes,
          isActive: voucherPayload.isActive,
          guestEmail: voucherPayload.guestEmail
        })
      : await addVoucher({
          code: vchCode.trim().toUpperCase(),
          discountType,
          discountValue: parseFloat(discountValue) || 0,
          usageCap: usageCap ? parseInt(usageCap) : null,
          expiresAt: expiresAt || null,
          applicableRoomTypes: applicableRooms,
          isActive: vchIsActive,
          createdBy: currentUser?.uid || "staff",
          guestEmail: vchGuestEmail.trim() || null
        });
    if (!result.success) {
      toast.error(editingVoucher ? "Voucher not updated" : "Voucher not created", result.error || "Please review the voucher details.");
      return;
    }

    const savedCode = vchCode.trim().toUpperCase();
    const wasEditing = Boolean(editingVoucher);
    closeVoucherModal();
    toast.success(wasEditing ? "Voucher updated" : "Voucher created", `${savedCode} is ready.`);
  };

  const handleCorpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corpCode || !companyName) return;

    const rateMap: Record<string, number> = {};
    roomTypes.forEach(type => {
      rateMap[type.value] = parseFloat(roomRates[type.value]) || type.corporateRate || type.pricePerNight || 0;
    });

    const corporatePayload = {
      code: corpCode.trim().toUpperCase(),
      companyName,
      ratePerRoomType: rateMap,
      expiresAt: corpExpiresAt || null,
      usageCap: corpUsageCap ? parseInt(corpUsageCap) : null,
      usageCount: 0,
      linkedInquiryId: "",
      createdBy: currentUser?.uid || "staff",
      createdAt: new Date().toISOString(),
      isActive: corpIsActive
    };

    const result = editingCorporateCode
      ? await updateCorporateCode(editingCorporateCode.code, {
          companyName: corporatePayload.companyName,
          ratePerRoomType: corporatePayload.ratePerRoomType,
          expiresAt: corporatePayload.expiresAt,
          usageCap: corporatePayload.usageCap,
          isActive: corporatePayload.isActive
        })
      : await addCorporateCode(corporatePayload);
    if (!result.success) {
      toast.error(editingCorporateCode ? "Corporate code not updated" : "Corporate code not created", result.error || "Please review the corporate code details.");
      return;
    }

    const savedCode = corpCode.trim().toUpperCase();
    const wasEditing = Boolean(editingCorporateCode);
    closeCorporateModal();
    toast.success(wasEditing ? "Corporate code updated" : "Corporate code created", `${savedCode} is ready.`);
  };

  // Save room prices changes — per W3.6 the rate matrix lives on the
  // room type, so we flush one `updateRoomType` per type rather than
  // batching across rooms of that type.
  const [isSavingRates, setIsSavingRates] = useState(false);
  const handleSaveRates = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingRates(true);
    try {
      const updates = roomTypes.map(t => {
        const next = prices[t.value];
        if (!next) return Promise.resolve();
        return updateRoomType(t.value, {
          pricePerNight: next.base,
          weekendRate: next.weekend,
          corporateRate: next.corporate
        });
      });
      await Promise.all(updates);
      setDirtyRateFields(new Set());
      toast.success("Rates saved", "Rate matrix updated for all room types.");
    } catch (err) {
      console.error("Error saving rates:", err);
      toast.error("Failed to save rates", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSavingRates(false);
    }
  };

  // Save breakfast pricing changes
  const handleSaveBreakfastRate = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("breakfastConfig", {
      ...breakfastConfig,
      ratePerPersonPerNight: parseFloat(bfRate) || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT
    });
    setBfRateDirty(false);
  };

  const formatCorporateRateSummary = (rateMap: Record<string, number>) => {
    const configuredTypes = roomTypes.filter((type) => rateMap[type.value] !== undefined);
    const entries = configuredTypes.length > 0
      ? configuredTypes
      : Object.keys(rateMap).map((value) => ({ value, shortLabel: value, label: value }));
    return entries
      .map((type) => `${type.shortLabel || type.label}: ${formatPrice(rateMap[type.value] || 0)}`)
      .join(" • ");
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
        <div className="flex justify-end gap-2">
          <button
            onClick={() => openVoucherEditor(row)}
            className="min-h-[32px] px-3 inline-flex items-center gap-1 rounded bg-gray-50 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-200"
          >
            <Pencil size={12} aria-hidden="true" />
            Edit
          </button>
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
        </div>
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
          {formatCorporateRateSummary(row.ratePerRoomType)}
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
            onClick={() => openCorporateCodeEditor(row)}
            className="min-h-[32px] px-3 inline-flex items-center gap-1 rounded bg-gray-50 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-200"
          >
            <Pencil size={12} aria-hidden="true" />
            Edit
          </button>
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
      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={() => openVoucherEditor(row)}
          className="inline-flex min-h-[36px] items-center gap-1 rounded bg-gray-50 px-3 text-xs font-semibold text-gray-700"
        >
          <Pencil size={12} aria-hidden="true" />
          Edit
        </button>
        <button
          type="button"
          onClick={() => toggleVoucherActive(row.id)}
          className={`min-h-[36px] rounded px-3 text-xs font-semibold ${
            row.isActive ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {row.isActive ? "Deactivate" : "Activate"}
        </button>
      </div>
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
        {formatCorporateRateSummary(row.ratePerRoomType)} · {row.usageCount} bookings
      </p>
      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={() => openCorporateCodeEditor(row)}
          className="inline-flex min-h-[36px] items-center gap-1 rounded bg-gray-50 px-3 text-xs font-semibold text-gray-700"
        >
          <Pencil size={12} aria-hidden="true" />
          Edit
        </button>
        <button
          type="button"
          onClick={() => toggleCorporateCodeActive(row.code)}
          className={`min-h-[36px] rounded px-3 text-xs font-semibold ${
            row.isActive ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {row.isActive ? "Deactivate" : "Activate"}
        </button>
      </div>
    </div>
  );

  if (ratesLoading) {
    return (
      <div className="space-y-8 font-body">
        <header className="space-y-2">
          <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-gray-100" />
        </header>
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-4 rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 lg:col-span-2">
            <div className="h-5 w-44 animate-pulse rounded bg-gray-200" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-4">
                <div className="h-10 animate-pulse rounded bg-gray-100" />
                <div className="h-10 animate-pulse rounded bg-gray-100" />
                <div className="h-10 animate-pulse rounded bg-gray-100" />
                <div className="h-10 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
          <div className="space-y-4 rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
            <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
            <div className="h-12 animate-pulse rounded bg-gray-100" />
            <div className="h-10 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
        <div className="h-72 rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <div className="h-full animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    );
  }

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

          <section className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm ring-1 ring-blue-100">
                <Info size={16} />
              </div>
              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-blue-950">Pricing priority</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-blue-900">
                    Nightly room pricing is selected in this order before breakfast, vouchers, points, or mandated discounts are applied.
                  </p>
                </div>
                <div className="grid gap-2 text-[11px] leading-relaxed text-blue-950 sm:grid-cols-3">
                  <div className="rounded-md bg-white/80 p-3 ring-1 ring-blue-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">1. Corporate</span>
                    <p className="mt-1 font-semibold">Valid corporate codes use their negotiated room rate first.</p>
                  </div>
                  <div className="rounded-md bg-white/80 p-3 ring-1 ring-blue-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">2. Seasonal</span>
                    <p className="mt-1 font-semibold">Seasonal overrides apply when no corporate rate is used.</p>
                  </div>
                  <div className="rounded-md bg-white/80 p-3 ring-1 ring-blue-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">3. Regular</span>
                    <p className="mt-1 font-semibold">Base or weekend rates are the fallback for normal bookings.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

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
                          onChange={(e) => updateRateField(type.value, "base", parseFloat(e.target.value) || 0)}
                          className="min-h-[44px] w-full rounded border border-gray-200 pl-7 pr-3 text-sm text-gray-800 font-medium"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Weekend Rate (Sat/Sun)</label>
                      <div className="relative mt-1 flex items-center">
                        <span className="absolute left-3 text-gray-400 font-semibold">{config.currencySymbol}</span>
                        <input
                          type="number"
                          required
                          min={0}
                          value={prices[type.value]?.weekend || 0}
                          onChange={(e) => updateRateField(type.value, "weekend", parseFloat(e.target.value) || 0)}
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
                          onChange={(e) => updateRateField(type.value, "corporate", parseFloat(e.target.value) || 0)}
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
                      <th className="py-2.5">Weekend Rate (Sat/Sun)</th>
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
                              onChange={(e) => updateRateField(type.value, "base", parseFloat(e.target.value) || 0)}
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
                              onChange={(e) => updateRateField(type.value, "weekend", parseFloat(e.target.value) || 0)}
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
                              onChange={(e) => updateRateField(type.value, "corporate", parseFloat(e.target.value) || 0)}
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
                disabled={isSavingRates}
                className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={14} />
                {isSavingRates ? "Saving…" : "Save Rates Matrix"}
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
                    onChange={(e) => {
                      setBfRateDirty(true);
                      setBfRate(e.target.value);
                    }}
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

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
              <Calendar size={18} className="text-primary" />
              Rate Calendar
            </h2>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-gray-500">
              Month view for effective public nightly rates. Click cells to multi-select dates and room types, then save a seasonal or holiday override.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRateCalendarMonth(addMonthsUtc(rateCalendarMonth, -1))}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-200"
            >
              <ChevronLeft size={14} />
              Prev
            </button>
            <button
              type="button"
              onClick={() => setRateCalendarMonth(startOfMonthUtc(new Date()))}
              className="min-h-[38px] rounded-lg bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 transition hover:bg-gray-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setRateCalendarMonth(addMonthsUtc(rateCalendarMonth, 1))}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-200"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-gray-150">
            <div
              className="grid min-w-max text-xs"
              style={{ gridTemplateColumns: `150px repeat(${rateCalendarDates.length}, minmax(92px, 1fr))` }}
            >
              <div className="sticky left-0 z-20 flex min-h-[58px] items-center border-b border-r border-gray-150 bg-gray-50 px-3">
                <div>
                  <p className="text-sm font-bold text-gray-950">{formatMonth(rateCalendarMonth)}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Room type</p>
                </div>
              </div>
              {rateCalendarDates.map((day) => {
                const weekend = isWeekendNight(day);
                return (
                  <div key={toDateKey(day)} className={`flex min-h-[58px] flex-col justify-center border-b border-r border-gray-100 px-2 text-center ${weekend ? "bg-amber-50/70" : "bg-gray-50"}`}>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{formatRateDay(day).split(" ")[0]}</span>
                    <span className="text-sm font-bold text-gray-900">{day.getUTCDate()}</span>
                  </div>
                );
              })}

              {roomTypes.map((type) => (
                <div key={type.value} className="contents">
                  <div key={`${type.value}-label`} className="sticky left-0 z-10 flex min-h-[88px] items-center border-r border-t border-gray-150 bg-white px-3">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{type.shortLabel || type.label}</p>
                      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{type.value}</p>
                    </div>
                  </div>
                  {rateCalendarDates.map((day) => {
                    const dateKey = toDateKey(day);
                    const cell = getRateCalendarCell(type, day);
                    const selected = isRateCellSelected(type.value, dateKey);
                    const sourceClass = cell.source === "seasonal"
                      ? "border-emerald-200 bg-emerald-50"
                      : cell.source === "weekend"
                        ? "border-amber-200 bg-amber-50/70"
                        : "border-gray-100 bg-white";
                    return (
                      <button
                        key={`${type.value}-${dateKey}`}
                        type="button"
                        onClick={() => handleRateCellClick(type.value, dateKey)}
                        className={`relative flex min-h-[88px] flex-col items-center justify-center border-r border-t px-2 py-2 text-center transition hover:bg-primary/5 ${sourceClass} ${selected ? "ring-2 ring-inset ring-primary" : ""}`}
                      >
                        {selected && (
                          <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                            selected
                          </span>
                        )}
                        <span className="text-sm font-bold text-gray-950">{formatPrice(cell.rate)}</span>
                        <span className={`mt-1 max-w-[76px] truncate rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          cell.source === "seasonal"
                            ? "bg-emerald-100 text-emerald-700"
                            : cell.source === "weekend"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-500"
                        }`}>
                          {cell.label}
                        </span>
                        {cell.override && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              openSeasonalOverrideEditor(cell.override);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                openSeasonalOverrideEditor(cell.override);
                              }
                            }}
                            className="mt-1 rounded bg-white/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700 shadow-sm ring-1 ring-emerald-100"
                          >
                            Edit
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-lg border border-gray-150 bg-gray-50 p-4 xl:w-80">
            {rateSelection ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Selected range</p>
                    <p className="mt-1 text-sm font-bold text-gray-950">{rateSelection.startDate} to {rateSelection.endDate}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {selectionDateCount} date{selectionDateCount === 1 ? "" : "s"} · {selectedCalendarRoomLabels}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRateSelection(null)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-500 shadow-sm ring-1 ring-gray-200 hover:text-gray-900"
                    aria-label="Clear selected rate calendar cells"
                  >
                    <X size={14} />
                  </button>
                </div>

                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Holiday / Seasonal Label
                  <input
                    type="text"
                    value={calendarOverrideName}
                    onChange={(e) => setCalendarOverrideName(e.target.value)}
                    placeholder="Christmas Peak"
                    className="min-h-[44px] rounded border border-gray-200 px-3 text-xs font-medium normal-case tracking-normal text-gray-900"
                  />
                </label>

                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Nightly Rate
                  <div className="relative flex items-center">
                    <span className="absolute left-2.5 text-gray-400 font-semibold">{config.currencySymbol}</span>
                    <input
                      type="number"
                      min={0}
                      value={calendarOverrideRate}
                      onChange={(e) => setCalendarOverrideRate(e.target.value)}
                      className="min-h-[44px] w-full rounded border border-gray-200 pl-6 pr-2.5 text-xs font-medium text-gray-900"
                    />
                  </div>
                </label>

                <button
                  type="button"
                  onClick={handleSaveCalendarOverride}
                  disabled={isSavingCalendarOverride}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={14} />
                  {isSavingCalendarOverride ? "Saving…" : "Set seasonal rate"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Bulk edit</p>
                <p className="text-xs leading-relaxed text-gray-500">
                  Click a rate cell to start a selection. Click another date or room type to expand it. Click selected cells to unselect.
                </p>
                <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-gray-150">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-gray-500">Seasonal</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">Holiday label</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-gray-500">Weekend</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">Sat/Sun</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-gray-500">Regular</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 font-bold text-gray-500">Base</span>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>

      <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1 lg:max-w-xs">
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
              <Calendar size={18} className="text-primary" />
              Seasonal Rate Overrides
            </h2>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Overrides apply to new standard and walk-in bookings for each stay night in range. Corporate negotiated rates stay unchanged.
            </p>
          </div>

          <form onSubmit={handleSeasonalSubmit} className="grid flex-1 gap-3 lg:grid-cols-12">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 lg:col-span-3">
              Name
              <input
                type="text"
                value={seasonalName}
                onChange={(e) => setSeasonalName(e.target.value)}
                placeholder="Holy Week"
                className="min-h-[44px] rounded border border-gray-200 px-3 text-xs font-medium normal-case tracking-normal text-gray-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 lg:col-span-2">
              Start
              <input
                type="date"
                value={seasonalStart}
                onChange={(e) => setSeasonalStart(e.target.value)}
                className="min-h-[44px] rounded border border-gray-200 px-3 text-xs font-medium text-gray-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 lg:col-span-2">
              End
              <input
                type="date"
                value={seasonalEnd}
                onChange={(e) => setSeasonalEnd(e.target.value)}
                className="min-h-[44px] rounded border border-gray-200 px-3 text-xs font-medium text-gray-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 lg:col-span-2">
              Nightly Rate
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-gray-400 font-semibold">{config.currencySymbol}</span>
                <input
                  type="number"
                  min={0}
                  value={seasonalRate}
                  onChange={(e) => setSeasonalRate(e.target.value)}
                  className="min-h-[44px] w-full rounded border border-gray-200 pl-6 pr-2.5 text-xs font-medium text-gray-900"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={isSavingSeasonal}
              className="mt-auto inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 lg:col-span-3"
            >
              <Plus size={14} />
              {isSavingSeasonal ? "Adding…" : "Add Override"}
            </button>

            <div className="lg:col-span-12">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Room Type Scope</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSeasonalRoomTypes([])}
                  className={`min-h-[36px] rounded-lg px-3 text-[11px] font-semibold transition ${
                    seasonalRoomTypes.length === 0
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  All types
                </button>
                {roomTypes.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => toggleSeasonalRoomType(type.value)}
                    className={`min-h-[36px] rounded-lg px-3 text-[11px] font-semibold transition ${
                      seasonalRoomTypes.includes(type.value)
                        ? "bg-primary text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {type.shortLabel || type.label}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </div>

        <div className="mt-5 border-t border-gray-100 pt-4">
          {seasonalRateOverrides.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs font-semibold text-gray-500">
              No seasonal overrides configured yet.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {seasonalRateOverrides.map((override) => (
                <div key={override.id} className="rounded-lg border border-gray-150 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-gray-900">{override.name}</p>
                        <StatusBadge
                          label={override.isActive ? "Active" : "Inactive"}
                          status={override.isActive ? "confirmed" : "dirty"}
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {override.startDate} to {override.endDate} · {formatSeasonalRoomScope(override)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-gray-950">{formatPrice(override.rate)}</p>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSeasonalActive(override.id)}
                      className="min-h-[36px] rounded bg-white px-3 text-[11px] font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
                    >
                      {override.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSeasonalOverride(override.id)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded bg-red-50 px-3 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Booking payment methods are now managed in Settings →
          Payment Methods. Per `plan/features/SETTINGS.md §Payment
          Methods` the full CRUD (add / remove / reorder / enable /
          disable / per-method QR upload) lives there. This page
          only owns the rate matrix, vouchers, corporate codes,
          breakfast rate, and OSCA discounts. */}
      <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
              <CreditCard size={18} className="text-primary" />
              Booking Payment Methods
            </h2>
            <p className="mt-1 text-[10px] text-gray-500 leading-relaxed">
              GCash, Maya, Bank Transfer, PayPal, and Pay at Hotel are all managed from one place — including per-method QR upload. Changes reflect on the guest booking page on the next snapshot.
            </p>
          </div>
          <a
            href="/settings?tab=payment"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 shrink-0"
          >
            <CreditCard size={13} aria-hidden="true" />
            Manage payment methods
          </a>
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
            onClick={openCreateVoucherModal}
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
            onClick={openCreateCorporateModal}
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
        title={editingVoucher ? "Edit Promo Voucher" : "Create Promo Voucher"}
        open={isVchModalOpen}
        onClose={closeVoucherModal}
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
                disabled={Boolean(editingVoucher)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium disabled:bg-gray-100 disabled:text-gray-500"
              />
              {editingVoucher ? (
                <span className="text-[10px] font-medium text-gray-500">Codes are locked after creation so guest links and redemptions keep working.</span>
              ) : null}
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

          <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-700">
            <input
              type="checkbox"
              checked={vchIsActive}
              onChange={(e) => setVchIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
            />
            Voucher is active
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
              onClick={closeVoucherModal}
              className="min-h-[44px] px-5 rounded-lg border border-gray-255 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" className="min-w-[150px]">
              {editingVoucher ? "Save Voucher" : "Spawn Voucher"}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* Modal: Create Corporate Code */}
      <Modal
        title={editingCorporateCode ? "Edit Corporate Partner Code" : "Add Corporate Partner Code"}
        open={isCorpModalOpen}
        onClose={closeCorporateModal}
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
                disabled={Boolean(editingCorporateCode)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium disabled:bg-gray-100 disabled:text-gray-500"
              />
              {editingCorporateCode ? (
                <span className="text-[10px] font-medium text-gray-500">Access codes are locked after creation because guests may already have them.</span>
              ) : null}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              Expiration Date
              <input
                type="date"
                value={corpExpiresAt}
                onChange={(e) => setCorpExpiresAt(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              Usage Cap
              <input
                type="number"
                min={0}
                placeholder="Unlimited if empty"
                value={corpUsageCap}
                onChange={(e) => setCorpUsageCap(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>
          </div>

          <div className="space-y-2.5 pt-2">
            <p className="font-semibold text-gray-700">Set Custom Flat Rate per Room Type (PHP)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {roomTypes.map((t) => (
                <label key={t.value} className="flex flex-col gap-2 font-medium text-gray-600">
                  {t.label} (Base: {formatPrice(t.pricePerNight)})
                  <input
                    type="number"
                    value={roomRates[t.value] || ""}
                    onChange={(e) => updateCorporateRoomRate(t.value, e.target.value)}
                    className="min-h-[38px] w-full rounded border border-gray-255 px-2 text-xs text-gray-900 font-medium"
                  />
                </label>
              ))}
            </div>
          </div>

          <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-700">
            <input
              type="checkbox"
              checked={corpIsActive}
              onChange={(e) => setCorpIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
            />
            Corporate code is active
          </label>

          <div className="flex gap-3 pt-4 justify-end">
            <button
              type="button"
              onClick={closeCorporateModal}
              className="min-h-[44px] px-5 rounded-lg border border-gray-255 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" className="min-w-[150px]">
              {editingCorporateCode ? "Save Partnership" : "Confirm Partnership"}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <Modal
        title="Edit Seasonal Rate"
        open={Boolean(editingSeasonalOverride)}
        onClose={closeSeasonalOverrideEditor}
      >
        <div className="space-y-4 text-xs font-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              Holiday / Seasonal Label
              <input
                type="text"
                value={editSeasonalName}
                onChange={(e) => setEditSeasonalName(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              Nightly Rate
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-gray-400 font-semibold">{config.currencySymbol}</span>
                <input
                  type="number"
                  min={0}
                  value={editSeasonalRate}
                  onChange={(e) => setEditSeasonalRate(e.target.value)}
                  className="min-h-[44px] w-full rounded border border-gray-250 pl-6 pr-3 text-sm font-medium"
                />
              </div>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              Start Date
              <input
                type="date"
                value={editSeasonalStart}
                onChange={(e) => setEditSeasonalStart(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
              End Date
              <input
                type="date"
                value={editSeasonalEnd}
                onChange={(e) => setEditSeasonalEnd(e.target.value)}
                className="min-h-[44px] w-full rounded border border-gray-250 px-3 text-sm font-medium"
              />
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Room Type Scope</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditSeasonalRoomTypes([])}
                className={`min-h-[36px] rounded-lg px-3 text-[11px] font-semibold transition ${
                  editSeasonalRoomTypes.length === 0
                    ? "bg-primary text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                All types
              </button>
              {roomTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => toggleEditSeasonalRoomType(type.value)}
                  className={`min-h-[36px] rounded-lg px-3 text-[11px] font-semibold transition ${
                    editSeasonalRoomTypes.includes(type.value)
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {type.shortLabel || type.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-700">
            Active override
            <input
              type="checkbox"
              checked={editSeasonalActive}
              onChange={(e) => setEditSeasonalActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
            />
          </label>

          <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={handleDeleteEditingSeasonalOverride}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-red-50 px-4 text-xs font-semibold text-red-700 transition hover:bg-red-100"
            >
              <Trash2 size={14} />
              Delete Override
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeSeasonalOverrideEditor}
                className="min-h-[44px] px-5 rounded-lg border border-gray-255 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <PrimaryButton type="button" onClick={handleUpdateSeasonalOverride} className="min-w-[150px]">
                Save Changes
              </PrimaryButton>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
