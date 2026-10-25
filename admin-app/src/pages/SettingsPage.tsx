import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAdmin, type StoreItem, type StaffMember } from "../context/AdminContext";
import type { TestRun } from "@spark-inn/shared";
import {
  compressImageFile,
  // Per BR-02 (decision #231, 2026-10-12, breakfast redesign):
  // the Breakfast & Dining tab now seeds the cutoff + served-grace
  // inputs from the new shared constants (replacing the legacy flat
  // rate). Per BR-08 (decision #238, 2026-10-14 — close-out):
  // `DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT` import was
  // removed — the constant was deleted from `shared/constants`.
  // The AdminContext default state no longer seeds it.
  DEFAULT_BREAKFAST_CUTOFF_TIME,
  DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES,
  DEFAULT_CORPORATE_PAGE_CONTENT,
  MAX_PAYMENT_METHOD_QR_BYTES,
  MAX_ROOM_TYPE_PHOTOS,
  PROTECTED_BOOKING_SOURCES,
  PROTECTED_PAYMENT_METHODS,
  UNSUPPORTED_PAYMENT_METHODS,
  // Per SR-01..05 (2026-10-12): the Booking Preferences
  // tab uses the shared types for the bed set-ups +
  // additional preferences catalogs.
  type BedSetupOption,
  type BookingPreferenceOption,
  // Per the IFH-01.3 (Settings UI editor) follow-up:
  // the shared clamp helper + the IFH-01.2 min/max
  // bounds + the clamp pattern from bookingOccupancy
  // for the post-Confirm hold window.
  MAX_PAYMENT_HOLD_WINDOW_HOURS,
  MIN_PAYMENT_HOLD_WINDOW_HOURS,
  MAX_IN_FLOW_HOLD_MINUTES,
  MIN_IN_FLOW_HOLD_MINUTES,
  clampIntegerInRange,
  // Per MSL-01 (2026-10-15): bounds for the stay-length cap editor.
  // `0` is legal here and means "no limit", so `clampIntegerInRange`
  // (which requires `min >= 1`) cannot be reused for this field.
  MAX_MAX_STAY_NIGHTS,
  MIN_MAX_STAY_NIGHTS,
  DEFAULT_MAX_STAY_NIGHTS,
  type BookingSourceConfig,
  type DiscountScope,
  type PaymentMethodConfig,
  type ProtectedPaymentMethod,
  type RoomTypeEntry,
  // Per BR-02 (decision #231, 2026-10-12, breakfast redesign):
  // the Breakfast & Dining tab now hydrates + saves against the
  // new shared `BreakfastConfig` / `BreakfastMeal` shapes (replacing
  // the legacy `silogItems` / `ratePerPersonPerNight` fields). The
  // legacy `breakfastIncludesChildrenDefault` toggle is gone from
  // the save payload entirely — children are ordinary meal slots
  // per spec decision #4. BR-03 deletes the `breakfastConfig`
  // legacy shape from the AdminContext default state.
  type BreakfastConfig,
  type BreakfastMeal,
  // Per VAT-01 (2026-10-12): the admin toggle for the
  // hotel's VAT-registration status. The Tax card on
  // the Discounts tab mirrors the existing `isVatEnabled`
  // helper so the toggle hides the 12% VAT breakdown
  // across every product surface (Reports, admin drawer,
  // admin receipt PDF, guest live preview).
  isVatEnabled,
  type VatConfig,
  // Per BR-12.1 (2026-10-15, decision #247 reserved): the
  // "Other Add-Ons" tab catalog CRUD uses the same normalized
  // AddOn shape the public config endpoint serves. The
  // pre-seed constant seeds the first "Airport transfer" row
  // on a brand-new install.
  AIRPORT_TRANSFER_PRESEED,
  // Per OCT-M1 (2026-10-20, decision #295): the normalizer for the
  // hotel-wide "Add-ons enabled" master switch
  // (`settings/hotelConfig.otherAddOnsEnabled`). Shared with the
  // server so the admin's stored value and the value the public
  // catalog endpoint reads can never disagree on what "off" means.
  normalizeOtherAddOnsEnabled,
  // Per QA-2026-10-23 §3.2 (2026-10-25): the normalizer for the
  // hotel-wide bot-protection mode
  // (`settings/hotelConfig.botProtectionMode`). Shared with the
  // guest-app server gate so the admin's stored value and the value
  // the server reads can never disagree on what "off" means. FAIL
  // CLOSED — only the exact string "disabled" opens the gate.
  normalizeBotProtectionMode,
  BOT_PROTECTION_MODE_DEFAULT,
  type BotProtectionMode,
  type AddOn,
  // Per Phase 2 of the Spark Rewards tier system (2026-10-12):
  // Zod schema + inferred types for the settings/rewardsConfig
  // payload — used for client-side validation before save (the
  // API also re-validates as defense-in-depth).
  RewardsConfigSchema,
  type LevelDef
} from "@spark-inn/shared";
import {
  // Per BR-12.1 (2026-10-15, decision #247 reserved): the
  // "Other Add-Ons" tab catalog CRUD uses the same
  // normalized AddOn shape the public config endpoint
  // serves. The pre-seed constant seeds the first
  // "Airport transfer" row on a brand-new install.
  AddOnSchema
} from "@spark-inn/shared/schemas/booking";
import { BreakfastConfigSchema, BreakfastMealSchema } from "@spark-inn/shared/schemas/booking";
import {
  Settings, Globe, Gift, Coffee, ShoppingBag,
  Save, Landmark, Sparkles, Check, CheckSquare, Square,
  BedDouble, Plus, Trash2, ShieldAlert, ImageIcon, Package, Pencil,
  Mail, Users, Scale, MessageSquare, Volume2, GripVertical, UserCog, Lock,
  // Per SR-01..05 (2026-10-12): `ListChecks` icon for the
  // new Booking Preferences tab.
  ListChecks,
  Upload, ChevronLeft, ChevronRight, X, Palette, ImagePlus, RotateCcw, Building2,
  Award, Star, CreditCard, AlertTriangle, ArrowUp, ArrowDown, Wallet, Banknote, Eye, RefreshCw,
  ChevronDown, ChevronUp, FlaskConical, Tag, Percent, Database,
  // Per the IFH-01.3 (Settings UI editor) follow-up:
  // the Booking & Holds tab uses Clock4 for the
  // post-Confirm + in-flow hold windows (a clock
  // matches the countdown-banner mental model).
  Clock4,
  // Per SET-SBG-01 (2026-10-12, settings-sidebar-grouping):
  // `Megaphone` for the "Marketing & Reach" group header and
  // `Shield` for the back-of-house "Admin" group header.
  Megaphone, Shield
} from "lucide-react";
import config from "@config";
import { auth } from "../firebase/auth";
import { db, storage } from "../firebase/config";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { addDoc, collection, deleteDoc, deleteField, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc } from "firebase/firestore";
import { formatPrice } from "../utils/format";
import { Modal } from "../components/Modal";
import { ConfirmForm } from "../components/ConfirmForm";
import { useToast } from "../components/Toast";
import { useBreakpoint } from "../utils/useBreakpoint";
import { getApiBaseUrl, isStagingAdminEnvironment } from "../utils/apiBaseUrl";
import { ListEditor, type ListEditorItem } from "../components/ListEditor";
import { TypePicker } from "../components/TypePicker";

type TabId = "hotel" | "payment" | "sources" | "roomtypes" | "preferences" | "branding" | "website" | "seo" | "rewards" | "breakfast" | "addons" | "store" | "email" | "intercom" | "legal" | "staff" | "environment" | "discounts" | "holds";
type SettingsSaveKey = "hotel" | "branding" | "website" | "seo" | "rewards" | "breakfast" | "store" | "intercom" | "legal" | "discounts" | "holds" | "vat";
type SettingsSaveStatus = "idle" | "saving" | "saved" | "error";

interface EmailTriggerCatalogItem {
  action: string;
  description: string;
  label: string;
}

const EMAIL_TRIGGER_GROUPS: Array<{ label: string; triggers: EmailTriggerCatalogItem[] }> = [
  {
    label: "Bookings & payments",
    triggers: [
      { label: "Booking Submitted", description: "Guest receives acknowledgment when a booking request is submitted", action: "booking-submitted" },
      { label: "Payment Confirmed", description: "Guest notified when their payment is verified and fully paid", action: "payment-confirmed" },
      { label: "Payment Rejected", description: "Guest receives the rejection reason and a link to upload a corrected proof", action: "payment-rejected" },
      { label: "Booking Confirmed", description: "Guest notified when booking is confirmed by front desk", action: "booking-confirmed" },
      { label: "Check-in Reminder", description: "Scheduled daily cron reminds guests checking in tomorrow", action: "checkin-reminder" },
      { label: "Booking Rescheduled", description: "Guest notified when their booking dates or room are updated", action: "booking-rescheduled" },
      { label: "Booking Cancelled", description: "Guest receives cancellation confirmation", action: "booking-cancelled" },
      { label: "Discount Rejected", description: "Guest notified when their Senior/PWD ID cannot be verified", action: "discount-rejected" }
    ]
  },
  {
    label: "Requests & promotions",
    triggers: [
      { label: "Corporate Inquiry — Staff", description: "Staff notified when a new corporate inquiry is submitted", action: "corporate-inquiry" },
      { label: "Corporate Inquiry — Guest", description: "Submitter receives confirmation that their corporate inquiry was received", action: "corporate-inquiry-confirmation" },
      { label: "Contact Inquiry — Staff", description: "Staff receives the details from a new public contact-form submission", action: "contact-inquiry" },
      { label: "Contact Inquiry — Guest", description: "Submitter receives confirmation that their contact message was received", action: "contact-confirmation" },
      { label: "Early Check-in Request", description: "Staff notified when a member requests early check-in", action: "early-checkin-request" },
      { label: "Early Check-in Resolution", description: "Guest notified when an early check-in request is approved or declined", action: "early-checkin-resolve" },
      { label: "Voucher Issued", description: "Guest receives a newly issued promotional voucher and redemption details", action: "voucher-issued" },
      { label: "Rewards Email Verification", description: "Member receives a verification link to confirm their email address", action: "spark-rewards-email-verification" }
    ]
  },
  {
    label: "In-room store",
    triggers: [
      { label: "Store Order Placed", description: "Guest receives an order receipt immediately after checkout", action: "store-order-placed" },
      { label: "Store Order Confirmed", description: "Guest notified when staff confirms and starts preparing the order", action: "store-order-confirmed" },
      { label: "Store Order Out for Delivery", description: "Guest notified when the order is heading to their room", action: "store-order-out-for-delivery" },
      { label: "Store Order Delivered", description: "Guest receives delivery confirmation and a feedback link", action: "store-order-delivered" },
      { label: "Store Order Cancelled", description: "Guest receives cancellation and payment guidance", action: "store-order-cancelled" }
    ]
  },
  {
    label: "Staff alerts",
    triggers: [
      { label: "New Online Booking", description: "Staff notified when a guest creates a new online booking", action: "staff-new-booking" },
      { label: "New Payment Proof", description: "Staff notified when a guest uploads a payment proof", action: "staff-new-payment" }
    ]
  }
];

const VALID_TAB_IDS: TabId[] = [
  "hotel",
  "payment",
  "sources",
  "roomtypes",
  // Per SR-01..05 (2026-10-12): the Booking
  // Preferences tab (bed set-ups + additional
  // preferences catalogs). Without this whitelist
  // entry, the deep-link `?tab=preferences` falls
  // back to "hotel" (the default) and the
  // BookingPreferencesTabBody never renders —
  // clicks on the sidebar tab silently do nothing.
  "preferences",
  "branding",
  "website",
  "seo",
  "rewards",
  "breakfast",
  "store",
  "email",
  "intercom",
  "legal",
  "staff",
  "environment",
  "discounts",
  "holds",
  // Per BR-12.1 (2026-10-15, decision #247 reserved): the
  // new "Other Add-Ons" catalog management tab. Without
  // this whitelist entry, the deep-link `?tab=addons`
  // falls back to "hotel" and the new tab never renders.
  "addons"
];

// Per SET-SBG-01 (2026-10-12, settings-sidebar-grouping):
// the 18 settings tabs are clustered into 5 stakeholder-oriented
// groups. Display order inside each group is the order shown
// in the sidebar (and the order used to build the deep-link
// whitelist above is the same, just flattened).
type SettingsGroup = {
  id: string;
  label: string;
  tabs: readonly TabId[];
};

const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: "property",  label: "Property",             tabs: ["hotel", "roomtypes", "branding"] },
  { id: "bookings",  label: "Bookings & Revenue",   tabs: ["preferences", "sources", "holds", "payment", "discounts"] },
  { id: "guest",     label: "Guest Experience",     tabs: ["rewards", "breakfast", "addons", "store", "intercom"] },
  { id: "reach",     label: "Marketing & Reach",    tabs: ["website", "seo", "email"] },
  { id: "admin",     label: "Admin",                tabs: ["staff", "legal", "environment"] }
];

// LocalStorage key for the user's collapsed/expanded preferences
// on the desktop sidebar. Each `SettingsGroup.id` may be present
// (collapsing this group) or absent (expanding this group).
// The active group is always force-expanded — its id is removed
// on every render before applying the persisted set.
const SETTINGS_GROUPS_COLLAPSED_STORAGE_KEY = "settings.sidebar.collapsedGroups.v1";

const DEFAULT_OG_IMAGE_URL = config.ogImage.startsWith("http")
  ? config.ogImage
  : `https://${config.domain}/${config.ogImage.replace(/^\/+/, "")}`;

function normalizeSeoImageOverride(value?: string) {
  if (!value || value === config.ogImage || value === DEFAULT_OG_IMAGE_URL) return "";
  return value;
}

// Per `plan/features/SETTINGS.md §Payment Methods`: the booking
// payment list is a fully dynamic admin-managed array. The schema
// stays open (`method: string`) so the admin can add custom
// keys, but the UI surfaces two policies:
//   1. `SUPPORTED_PAYMENT_METHODS` is the canonical list of
//      methods the platform ships with. The persistent callout
//      at the top of the tab lists them.
//   2. `UNSUPPORTED_PAYMENT_METHODS` triggers an inline warning
//      + two-step save confirm when the admin types one of
//      these keys. The schema is not hard-blocked, so future
//      business changes don't require a code deploy.

// Map a payment method key to a `lucide-react` icon. Used in
// the tab list and the QR previews so admins can scan methods
// visually without reading every label.
function paymentMethodIcon(method: string) {
  switch (method) {
    case "gcash":
    case "maya":
      return Wallet;
    case "bank":
      return Landmark;
    case "paypal":
      return CreditCard;
    case "pay-at-hotel":
      return Banknote;
    default:
      return CreditCard;
  }
}
type StoreCategory = StoreItem["category"];

const storeCategories: { value: StoreCategory; label: string }[] = [
  { value: "drinks", label: "Drinks" },
  { value: "snacks", label: "Snacks" },
  { value: "toiletries", label: "Toiletries" },
  { value: "rentals", label: "Rentals" },
  { value: "other", label: "Other" }
];

function SaveActionButton({
  label,
  status,
  // Per the IFH-01.3 (Settings UI editor) follow-up:
  // the Booking & Holds tab disables Save when the
  // hold windows are out of range (the existing
  // HTML5 `<input type="number" min max required>`
  // validation also blocks submit, but a clean
  // `disabled` prop is the explicit UX signal that
  // mirrors the other "Save" CTAs in the page).
  disabled
}: {
  label: string;
  status: SettingsSaveStatus;
  disabled?: boolean;
}) {
  const isSaving = status === "saving";
  const isSaved = status === "saved";
  const isError = status === "error";
  const Icon = isSaving ? RefreshCw : isSaved ? Check : Save;
  const text = isSaving ? "Saving..." : isSaved ? "Saved" : isError ? "Try again" : label;

  return (
    <button
      type="submit"
      disabled={isSaving || disabled}
      className={`min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-80 ${
        isSaved
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : isError
            ? "bg-red-600 text-white hover:bg-red-700"
            : "bg-primary hover:bg-primary-dark text-white"
      }`}
    >
      <Icon size={14} className={isSaving ? "animate-spin" : ""} aria-hidden="true" />
      {text}
    </button>
  );
}

function SaveActionFooter({
  label,
  status,
  onClick,
  // Per the IFH-01.3 (Settings UI editor) follow-up:
  // the Booking & Holds tab disables Save when the
  // hold windows are out of range (the existing
  // `<input type="number" min max required>` HTML5
  // validation also blocks submit, but a clean
  // `disabled` prop is the explicit UX signal that
  // mirrors the other "Save" CTAs in the page).
  disabled
}: {
  label: string;
  status: SettingsSaveStatus;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const message =
    status === "saved"
      ? "Saved just now."
      : status === "error"
        ? "Save failed. Review the message and try again."
        : status === "saving"
          ? "Saving changes..."
          : "";

  return (
    <div className="pt-2 border-t border-gray-150 flex flex-col items-end gap-2 sm:flex-row sm:justify-end sm:items-center">
      {message ? (
        <span
          role={status === "error" ? "alert" : "status"}
          className={`text-[10px] font-semibold ${
            status === "error" ? "text-red-600" : status === "saved" ? "text-emerald-700" : "text-gray-500"
          }`}
        >
          {message}
        </span>
      ) : null}
      {onClick ? (
        <button
          type="button"
          disabled={status === "saving" || disabled}
          onClick={onClick}
          className={`min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-80 ${
            status === "saved"
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : status === "error"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-primary hover:bg-primary-dark text-white"
          }`}
        >
          {status === "saving" ? (
            <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
          ) : status === "saved" ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Save size={14} aria-hidden="true" />
          )}
          {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : status === "error" ? "Try again" : label}
        </button>
      ) : (
        <SaveActionButton label={label} status={status} disabled={disabled} />
      )}
    </div>
  );
}

function WebsiteContentSection({
  title,
  helper,
  icon,
  defaultOpen = false,
  children
}: {
  title: string;
  helper: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelId = `website-content-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section className="rounded-card border border-gray-150 bg-gray-50/30">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-card px-4 py-3 text-left transition hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {icon}
            {title}
          </span>
          <span className="mt-1 block text-[10px] leading-relaxed text-gray-500">{helper}</span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500">
          {isOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </span>
      </button>

      {isOpen ? (
        <div id={panelId} className="space-y-4 border-t border-gray-150 p-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

// Reusable uploader for a single branding asset (hero photo or logo).
// `value` is the currently stored URL in `settings/websiteContent`
// (may be the empty string when no override is set). `fallback` is the
// deploy-time asset the guest app uses when `value === ""`. `label`
// and `helper` describe what the asset is shown to users as. The
// component shows the live preview (uploaded URL or fallback),
// exposes an upload button + a reset button when an override exists,
// and surfaces upload errors inline.
//
// `loading` (default `false`) — when `true`, the preview pane
// renders an animated skeleton instead of the value/fallback. This
// is the fix for the "fallback image flashes before the custom
// upload loads" bug on mobile: until the first
// `settings/websiteContent` snapshot arrives the live `value` is
// the empty string, which would otherwise resolve to the static
// `fallback` (logos) or the "No asset yet" placeholder (hero
// photos). Skeletoning the preview until the snapshot lands is
// consistent with the guest app's `usePublicSiteContent` pattern
// (see `buildEmptyState` in that file for the same idea).
interface BrandingAssetRowProps {
  label: string;
  helper: string;
  value: string;
  fallback?: string;
  fallbackLabel?: string;
  onUpload: (file: File) => Promise<{ success: boolean; error?: string }>;
  onReset: () => Promise<{ success: boolean; error?: string }>;
  previewClassName?: string;
  loading?: boolean;
}

function BrandingAssetRow({
  label,
  helper,
  value,
  fallback,
  fallbackLabel,
  onUpload,
  onReset,
  previewClassName,
  loading = false
}: BrandingAssetRowProps) {
  const [status, setStatus] = useState<"idle" | "uploading" | "resetting">("idle");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewSrc = value || fallback || "";
  const hasOverride = value.length > 0;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError("");
    setStatus("uploading");
    const result = await onUpload(file);
    if (!result.success) {
      setError(result.error || "Upload failed");
    }
    setStatus("idle");
  }

  async function handleReset() {
    if (!hasOverride) return;
    setError("");
    setStatus("resetting");
    const result = await onReset();
    if (!result.success) {
      setError(result.error || "Reset failed");
    }
    setStatus("idle");
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[120px_1fr] sm:items-start">
      <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-section-bg sm:h-20 sm:w-28">
        {loading ? (
          // Skeleton covers the exact same dimensions as the
          // image / placeholder so the row doesn't shift when
          // the snapshot lands. `animate-pulse` is a Tailwind
          // utility — same one used by the rooms page skeletons
          // elsewhere in the app.
          <div className="h-full w-full animate-pulse bg-gradient-to-br from-gray-200 to-gray-300" />
        ) : previewSrc ? (
          <img
            src={previewSrc}
            alt={`${label} preview`}
            className={`h-full w-full ${previewClassName ?? "object-contain"}`}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 text-center text-[10px] text-gray-500">
            <ImagePlus size={18} className="opacity-50" />
            <p className="mt-1 font-semibold opacity-70">{fallbackLabel || "No asset yet"}</p>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-xs font-semibold text-gray-800">{label}</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{helper}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            disabled={status === "uploading"}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[36px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload size={13} />
            {status === "uploading" ? "Uploading..." : hasOverride ? "Replace" : "Upload"}
          </button>
          {hasOverride && (
            <button
              type="button"
              disabled={status === "resetting"}
              onClick={handleReset}
              className="min-h-[36px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw size={13} />
              {status === "resetting" ? "Resetting..." : "Reset to default"}
            </button>
          )}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              hasOverride
                ? "bg-primary-light text-primary-dark"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {hasOverride ? "Custom override" : "Using default"}
          </span>
        </div>
        {error && <p className="text-[10px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

interface BookingSourcesTabBodyProps {
  bookingSources: BookingSourceConfig[];
  onAdd: (config: BookingSourceConfig) => Promise<void>;
  onUpdate: (source: string, updates: Partial<Omit<BookingSourceConfig, "source">>) => Promise<void>;
  onReorder: (next: BookingSourceConfig[]) => Promise<void>;
  onDelete: (source: string) => Promise<void>;
}

type BookingSourceEditModalState =
  | { open: false }
  | { open: true; isNew: boolean; source: BookingSourceConfig };

function emptyBookingSource(): BookingSourceConfig {
  return {
    source: "",
    label: "",
    isEnabled: true,
    selectableAtFrontDesk: true
  };
}

function BookingSourcesTabBody({
  bookingSources,
  onAdd,
  onUpdate,
  onReorder,
  onDelete
}: BookingSourcesTabBodyProps) {
  const toast = useToast();
  const [editModal, setEditModal] = useState<BookingSourceEditModalState>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    const timer = setTimeout(() => setPendingDelete(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDelete]);

  const isProtected = (source: string) =>
    (PROTECTED_BOOKING_SOURCES as readonly string[]).includes(source);

  const runMutation = async (
    action: () => Promise<void>,
    successTitle: string,
    successMessage: string
  ) => {
    try {
      await action();
      toast.success(successTitle, successMessage);
      return true;
    } catch (error) {
      toast.error(
        "Could not update booking sources",
        error instanceof Error ? error.message : "Please try again."
      );
      return false;
    }
  };

  const handleToggleEnabled = async (entry: BookingSourceConfig) => {
    await runMutation(
      () => onUpdate(entry.source, { isEnabled: !entry.isEnabled }),
      entry.isEnabled ? "Booking source disabled" : "Booking source enabled",
      `${entry.label} is ${entry.isEnabled ? "hidden from active source options; historical bookings stay intact" : "available again"}.`
    );
  };

  const handleToggleFrontDesk = async (entry: BookingSourceConfig) => {
    if (isProtected(entry.source)) return;
    await runMutation(
      () => onUpdate(entry.source, { selectableAtFrontDesk: !entry.selectableAtFrontDesk }),
      "Front-desk visibility updated",
      `${entry.label} is ${entry.selectableAtFrontDesk ? "no longer" : "now"} available in New Booking.`
    );
  };

  const handleReorder = async (source: string, direction: "up" | "down") => {
    const index = bookingSources.findIndex((entry) => entry.source === source);
    if (index < 0) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= bookingSources.length) return;
    const next = [...bookingSources];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    await runMutation(
      () => onReorder(next),
      "Booking sources reordered",
      "The new order is live in Settings and source filters."
    );
  };

  const handleDelete = async (entry: BookingSourceConfig) => {
    if (pendingDelete !== entry.source) {
      setPendingDelete(entry.source);
      toast.info("Confirm delete", "Click the delete button again within 3 seconds to confirm.");
      return;
    }
    setPendingDelete(null);
    await runMutation(
      () => onDelete(entry.source),
      "Booking source deleted",
      `${entry.label} was removed from the configured source list.`
    );
  };

  const openAddModal = () => {
    setEditModal({ open: true, isNew: true, source: emptyBookingSource() });
  };

  const openEditModal = (entry: BookingSourceConfig) => {
    setEditModal({ open: true, isNew: false, source: { ...entry } });
  };

  const closeModal = () => setEditModal({ open: false });

  const handleModalField = (
    field: keyof BookingSourceConfig,
    value: string | boolean
  ) => {
    if (!editModal.open) return;
    setEditModal({
      open: true,
      isNew: editModal.isNew,
      source: { ...editModal.source, [field]: value }
    });
  };

  const handleSaveModal = async () => {
    if (!editModal.open) return;
    const sourceKey = editModal.source.source.trim().toLowerCase();
    const label = editModal.source.label.trim();
    if (!sourceKey) {
      toast.error("Source key is required", "Use a short identifier such as “booking-com” or “travel-agent”.");
      return;
    }
    if (!/^[a-z0-9-]+$/.test(sourceKey)) {
      toast.error("Invalid source key", "Use lowercase letters, numbers, and hyphens only.");
      return;
    }
    if (!label) {
      toast.error("Label is required", "Enter the staff-facing name shown in booking filters and reports.");
      return;
    }
    const protectedSource = isProtected(sourceKey);
    const normalized: BookingSourceConfig = {
      source: sourceKey,
      label,
      isEnabled: editModal.source.isEnabled,
      selectableAtFrontDesk: protectedSource
        ? false
        : editModal.source.selectableAtFrontDesk
    };
    const saved = await runMutation(
      () => editModal.isNew
        ? onAdd(normalized)
        : onUpdate(editModal.source.source, {
            label: normalized.label,
            isEnabled: normalized.isEnabled,
            selectableAtFrontDesk: normalized.selectableAtFrontDesk
          }),
      editModal.isNew ? "Booking source added" : "Booking source updated",
      `${label} is ready for source filters and reporting.`
    );
    if (saved) closeModal();
  };

  return (
    <div className="space-y-6 text-xs">
      <div>
        <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Booking Sources</h3>
        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
          Control the channels used by New Booking, booking filters, and acquisition reports.
          System-assigned sources stay protected; custom sources can be offered to the front desk.
        </p>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-xs font-bold">Keep reporting consistent</p>
            <p className="mt-1 text-[11px] leading-relaxed">
              Online, walk-in, and corporate are assigned by the system and cannot be deleted or offered
              in the front-desk picker. Disable a source to hide it from active filters without rewriting
              historical bookings.
            </p>
          </div>
        </div>
      </div>

      {bookingSources.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center">
          <Tag size={28} className="mx-auto text-gray-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-gray-700">No booking sources configured</p>
          <p className="mt-1 text-[11px] text-gray-500">
            Add a channel so staff can classify new bookings and reports can attribute them correctly.
          </p>
          <button
            type="button"
            onClick={openAddModal}
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
          >
            <Plus size={14} aria-hidden="true" />
            Add booking source
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {bookingSources.map((entry, index) => {
            const protectedSource = isProtected(entry.source);
            const armed = pendingDelete === entry.source;
            return (
              <article
                key={entry.source}
                className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${entry.isEnabled ? "" : "opacity-70"}`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{entry.label || entry.source}</p>
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-600">
                        {entry.source}
                      </code>
                      {protectedSource && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">
                          <Lock size={10} aria-hidden="true" />
                          Required
                        </span>
                      )}
                      {!entry.isEnabled && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {protectedSource
                        ? "System assigned — never shown in the New Booking source picker."
                        : entry.selectableAtFrontDesk
                          ? "Available to staff in New Booking."
                          : "Hidden from the New Booking source picker."}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <button
                      type="button"
                      onClick={() => void handleToggleEnabled(entry)}
                      aria-pressed={entry.isEnabled}
                      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${
                        entry.isEnabled
                          ? "border-primary/30 bg-primary-light text-primary-dark"
                          : "border-gray-200 bg-gray-50 text-gray-600"
                      }`}
                    >
                      {entry.isEnabled ? <CheckSquare size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
                      {entry.isEnabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleFrontDesk(entry)}
                      disabled={protectedSource}
                      aria-pressed={entry.selectableAtFrontDesk}
                      title={protectedSource ? "System-assigned sources cannot be selected manually." : undefined}
                      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        entry.selectableAtFrontDesk
                          ? "border-primary/30 bg-primary-light text-primary-dark"
                          : "border-gray-200 bg-white text-gray-600"
                      }`}
                    >
                      <Users size={14} aria-hidden="true" />
                      Front desk
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReorder(entry.source, "up")}
                      disabled={index === 0}
                      aria-label={`Move ${entry.label} up`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReorder(entry.source, "down")}
                      disabled={index === bookingSources.length - 1}
                      aria-label={`Move ${entry.label} down`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(entry)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil size={13} aria-hidden="true" />
                      Edit
                    </button>
                    {!protectedSource && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry)}
                        aria-label={armed ? `Confirm delete ${entry.label}` : `Delete ${entry.label}`}
                        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${
                          armed
                            ? "border-red-300 bg-red-100 text-red-700"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-red-50 hover:text-red-700"
                        }`}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        {armed ? "Tap again to confirm" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {bookingSources.length > 0 && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
          >
            <Plus size={14} aria-hidden="true" />
            Add booking source
          </button>
        </div>
      )}

      {editModal.open && (
        <Modal
          open
          onClose={closeModal}
          title={editModal.isNew ? "Add booking source" : `Edit “${editModal.source.label || editModal.source.source}”`}
          footer={
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-200 bg-white px-5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveModal()}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
              >
                <Save size={14} aria-hidden="true" />
                Save
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 font-semibold text-gray-700">
                Source key
                <input
                  type="text"
                  maxLength={80}
                  value={editModal.source.source}
                  onChange={(event) => handleModalField("source", event.target.value.toLowerCase())}
                  disabled={!editModal.isNew}
                  placeholder="e.g. booking-com"
                  className="min-h-[44px] rounded-lg border border-gray-250 bg-gray-50/50 px-3 font-mono text-sm font-medium focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="text-[10px] font-normal text-gray-500">
                  {editModal.isNew
                    ? "Immutable identifier stored on each booking. Use lowercase letters, numbers, and hyphens."
                    : "Cannot be renamed because historical bookings store this key."}
                </span>
              </label>
              <label className="flex flex-col gap-2 font-semibold text-gray-700">
                Display label
                <input
                  type="text"
                  maxLength={80}
                  value={editModal.source.label}
                  onChange={(event) => handleModalField("label", event.target.value)}
                  placeholder="e.g. Booking.com"
                  className="min-h-[44px] rounded-lg border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                />
                <span className="text-[10px] font-normal text-gray-500">
                  Shown to staff in New Booking, booking filters, and acquisition reports.
                </span>
              </label>
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 font-semibold text-gray-700">
              <button
                type="button"
                onClick={() => handleModalField("isEnabled", !editModal.source.isEnabled)}
                aria-pressed={editModal.source.isEnabled}
                className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${editModal.source.isEnabled ? "bg-primary" : "bg-gray-200"}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition ${editModal.source.isEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              Enabled in active source filters and reports
            </label>

            <label className={`flex min-h-[44px] items-center gap-3 font-semibold text-gray-700 ${isProtected(editModal.source.source) ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <button
                type="button"
                disabled={isProtected(editModal.source.source)}
                onClick={() => handleModalField("selectableAtFrontDesk", !editModal.source.selectableAtFrontDesk)}
                aria-pressed={editModal.source.selectableAtFrontDesk}
                className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition disabled:cursor-not-allowed ${editModal.source.selectableAtFrontDesk ? "bg-primary" : "bg-gray-200"}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition ${editModal.source.selectableAtFrontDesk ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              Available to staff in the New Booking source picker
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Per `plan/features/SETTINGS.md §Payment Methods` — the body of
// the Payment Methods tab. Owns the local Add/Edit modal state,
// the per-row reorder/toggle/delete state, the QR uploader
// (mirrors `BrandingAssetRow`), and the Pesonet two-step confirm.
//
// Persistence is delegated to the parent via the
// `onAdd` / `onUpdate` / `onReorder` / `onDelete` /
// `onUploadQr` / `onResetQr` callbacks from `useAdmin()` so the
// Firestore writes live in `AdminContext` (single source of
// truth for the data path).
interface PaymentMethodsTabBodyProps {
  paymentMethods: PaymentMethodConfig[];
  onAdd: (config: PaymentMethodConfig) => Promise<void>;
  onUpdate: (method: string, updates: Partial<PaymentMethodConfig>) => Promise<void>;
  onReorder: (next: PaymentMethodConfig[]) => Promise<void>;
  onDelete: (method: string) => Promise<void>;
  onUploadQr: (method: string, file: File) => Promise<{ success: boolean; error?: string; url?: string }>;
  onResetQr: (method: string) => Promise<{ success: boolean; error?: string }>;
}

type EditModalState =
  | { open: false }
  | { open: true; isNew: boolean; method: PaymentMethodConfig };

function emptyPaymentMethod(): PaymentMethodConfig {
  return { method: "", label: "", accountName: "", accountNumber: "", qrUrl: "", isEnabled: true, showInStore: true, showInCorporate: true, requireReferenceNumber: true };
}

// Per SR-01..05 (2026-10-12): the Booking Preferences tab
// body. Two sub-sections — the bed set-ups catalog (drives
// the guest Step 2 bed-set-up radio group) + the
// additional preferences catalog (drives the Step 2
// checkbox grid). Each row is editable via its own modal,
// and deletes go through the same
// "click-twice-within-3-seconds" confirmation pattern
// used by `BookingSourcesTabBody` above.
//
// Both lists persist as a single full-replace write to
// `settings/hotelConfig.bedSetups` +
// `settings/hotelConfig.bookingPreferences` via the
// `updateBedSetups` + `updateBookingPreferences` callbacks
// passed in from `useAdmin()`.
interface BookingPreferencesTabBodyProps {
  bedSetups: BedSetupOption[];
  bookingPreferences: BookingPreferenceOption[];
  onUpdateBedSetups: (next: BedSetupOption[]) => Promise<void>;
  onUpdateBookingPreferences: (next: BookingPreferenceOption[]) => Promise<void>;
}

type BedSetupModalState =
  | { open: false }
  | { open: true; isNew: boolean; entry: BedSetupOption };

type BookingPreferenceModalState =
  | { open: false }
  | { open: true; isNew: boolean; entry: BookingPreferenceOption };

function slugifyCatalogValue(raw: string): string {
  // Per the Zod schemas in `shared/schemas/bookingPreferences.ts`:
  // kebab-case (lowercase letters, digits, '-' or '_'), max
  // 64 chars. We trim, lowercase, replace whitespace + any
  // non-conforming char with `-`, then collapse runs.
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function CatalogEditor<T extends { value: string; label: string }>({
  title,
  subtitle,
  rows,
  isPending,
  pendingValue,
  onAdd,
  onEdit,
  onDelete,
  renderRow,
  renderModal,
  beginLabel
}: {
  title: string;
  subtitle: string;
  rows: T[];
  isPending: (value: string) => boolean;
  pendingValue: string | null;
  onAdd: () => void;
  onEdit: (entry: T) => void;
  onDelete: (entry: T) => Promise<void> | void;
  renderRow: (entry: T, idx: number) => React.ReactNode;
  renderModal: () => React.ReactNode;
  beginLabel: string;
}) {
  const toast = useToast();

  useEffect(() => {
    if (!pendingValue) return;
    const timer = setTimeout(() => {
      // Parent listens on `pendingValue` to arm/disarm.
    }, 3000);
    return () => clearTimeout(timer);
  }, [pendingValue]);

  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          <p className="mt-1 text-[11px] text-gray-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
        >
          <Plus size={14} />
          {beginLabel}
        </button>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-xs text-gray-500">
          No entries yet — click <strong>{beginLabel}</strong> to add the first one.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-card border border-gray-200">
          {rows.map((entry, idx) => (
            <li key={entry.value} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                {renderRow(entry, idx)}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(entry)}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded border border-gray-200 px-2 text-[11px] font-bold text-gray-700 hover:border-primary hover:text-primary"
                  aria-label={`Edit ${entry.label}`}
                >
                  <Pencil size={12} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!isPending(entry.value)) {
                      toast.info("Confirm delete", "Click the delete button again within 3 seconds to confirm.");
                      // Surface the arm via a custom event so the
                      // parent can lift state into the prop-driven
                      // pending state without prop drilling here.
                      // We dispatch a synthetic event the parent
                      // listens on. Alternative: parent passes a
                        // callback. We do that below in
                        // `handleArmDelete`.
                      window.dispatchEvent(
                        new CustomEvent("booking-preferences-arm-delete", { detail: { value: entry.value } })
                      );
                      return;
                    }
                    try {
                      await onDelete(entry);
                    } catch (err) {
                      toast.error("Could not delete", err instanceof Error ? err.message : "Unknown error");
                    }
                  }}
                  className={`min-h-[44px] px-2 text-[11px] font-bold ${
                    isPending(entry.value)
                      ? "text-red-700 hover:underline"
                      : "text-red-650 hover:text-red-700 hover:underline"
                  }`}
                  aria-label={`Delete ${entry.label}`}
                >
                  {isPending(entry.value) ? "Click again to confirm" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {renderModal()}
    </div>
  );
}

function BookingPreferencesTabBody({
  bedSetups,
  bookingPreferences,
  onUpdateBedSetups,
  onUpdateBookingPreferences
}: BookingPreferencesTabBodyProps) {
  const toast = useToast();
  const [bedSetupsPendingDelete, setBedSetupsPendingDelete] = useState<string | null>(null);
  const [prefsPendingDelete, setPrefsPendingDelete] = useState<string | null>(null);
  const [bedSetupModal, setBedSetupModal] = useState<BedSetupModalState>({ open: false });
  const [prefsModal, setPrefsModal] = useState<BookingPreferenceModalState>({ open: false });

  // The CatalogEditor above is generic; we use a single
  // shared "arm" timer per catalog. The custom-event
  // dispatch is the simplest way to keep the editor
  // component prop-light while still letting the parent own
  // the pending state. (Alternative would be prop drilling
  // two more callbacks — not for two screens.)
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ value: string }>).detail;
      if (!detail) return;
      // Route to whichever catalog owns the value.
      if (bedSetups.some((b) => b.value === detail.value)) {
        setBedSetupsPendingDelete(detail.value);
      } else if (bookingPreferences.some((p) => p.value === detail.value)) {
        setPrefsPendingDelete(detail.value);
      }
    };
    window.addEventListener("booking-preferences-arm-delete", handler as EventListener);
    return () => {
      window.removeEventListener("booking-preferences-arm-delete", handler as EventListener);
    };
  }, [bedSetups, bookingPreferences]);

  // Auto-disarm after 3 seconds (the existing "click
  // twice" pattern).
  useEffect(() => {
    if (!bedSetupsPendingDelete) return;
    const timer = setTimeout(() => setBedSetupsPendingDelete(null), 3000);
    return () => clearTimeout(timer);
  }, [bedSetupsPendingDelete]);
  useEffect(() => {
    if (!prefsPendingDelete) return;
    const timer = setTimeout(() => setPrefsPendingDelete(null), 3000);
    return () => clearTimeout(timer);
  }, [prefsPendingDelete]);

  // ── Bed Set-ups ────────────────────────────────────────
  const handleBedSetupSave = async (entry: BedSetupOption, isNew: boolean) => {
    const slug = slugifyCatalogValue(entry.value);
    if (!slug) {
      toast.error("Invalid identifier", "Use letters, digits, '-' or '_'.");
      return false;
    }
    if (!entry.label.trim()) {
      toast.error("Label required", "Add a display label for the option.");
      return false;
    }
    const collides = bedSetups.some((b) => b.value === slug && (isNew || b.value !== entry.value));
    if (collides) {
      toast.error("Duplicate identifier", `"${slug}" is already in the catalog.`);
      return false;
    }
    const next: BedSetupOption[] = isNew
      ? [...bedSetups, { value: slug, label: entry.label.trim(), icon: entry.icon?.trim() || undefined }]
      : bedSetups.map((b) =>
          b.value === entry.value
            ? { value: slug, label: entry.label.trim(), icon: entry.icon?.trim() || undefined }
            : b
        );
    try {
      await onUpdateBedSetups(next);
      toast.success("Bed set-ups saved", `${entry.label} ${isNew ? "added" : "updated"}.`);
      return true;
    } catch (err) {
      toast.error("Could not save", err instanceof Error ? err.message : "Unknown error");
      return false;
    }
  };

  const handleBedSetupDelete = async (entry: BedSetupOption) => {
    if (bedSetupsPendingDelete !== entry.value) {
      setBedSetupsPendingDelete(entry.value);
      toast.info("Confirm delete", "Click delete again within 3 seconds to confirm.");
      return;
    }
    setBedSetupsPendingDelete(null);
    try {
      await onUpdateBedSetups(bedSetups.filter((b) => b.value !== entry.value));
      toast.success("Bed set-up removed", `${entry.label} was removed from the catalog.`);
    } catch (err) {
      toast.error("Could not delete", err instanceof Error ? err.message : "Unknown error");
    }
  };

  // ── Booking Preferences ─────────────────────────────────
  const handlePreferenceSave = async (entry: BookingPreferenceOption, isNew: boolean) => {
    const slug = slugifyCatalogValue(entry.value);
    if (!slug) {
      toast.error("Invalid identifier", "Use letters, digits, '-' or '_'.");
      return false;
    }
    if (!entry.label.trim()) {
      toast.error("Label required", "Add a display label for the preference.");
      return false;
    }
    const collides = bookingPreferences.some(
      (p) => p.value === slug && (isNew || p.value !== entry.value)
    );
    if (collides) {
      toast.error("Duplicate identifier", `"${slug}" is already in the catalog.`);
      return false;
    }
    const normalized: BookingPreferenceOption = {
      value: slug,
      label: entry.label.trim(),
      icon: entry.icon?.trim() || undefined,
      surchargeNote: entry.surchargeNote?.trim() || undefined
    };
    const next: BookingPreferenceOption[] = isNew
      ? [...bookingPreferences, normalized]
      : bookingPreferences.map((p) => (p.value === entry.value ? normalized : p));
    try {
      await onUpdateBookingPreferences(next);
      toast.success("Preference saved", `${entry.label} ${isNew ? "added" : "updated"}.`);
      return true;
    } catch (err) {
      toast.error("Could not save", err instanceof Error ? err.message : "Unknown error");
      return false;
    }
  };

  const handlePreferenceDelete = async (entry: BookingPreferenceOption) => {
    if (prefsPendingDelete !== entry.value) {
      setPrefsPendingDelete(entry.value);
      toast.info("Confirm delete", "Click delete again within 3 seconds to confirm.");
      return;
    }
    setPrefsPendingDelete(null);
    try {
      await onUpdateBookingPreferences(bookingPreferences.filter((p) => p.value !== entry.value));
      toast.success("Preference removed", `${entry.label} was removed from the catalog.`);
    } catch (err) {
      toast.error("Could not delete", err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div className="space-y-6 text-xs font-body">
      <div>
        <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">
          Booking Preferences
        </h3>
        <p className="mt-1 text-[11px] text-gray-500">
          Two catalogs the guest sees on the public booking Step 2. Bed set-ups appear as
          a radio group when the picked room type offers a choice; additional preferences
          are the checkbox grid in the "Show additional preferences" accordion.
        </p>
      </div>

      <CatalogEditor<BedSetupOption>
        title="Bed set-ups"
        subtitle="Per-room-type subset of these options appears on the public booking Step 2. Empty subset = no set-up choice for that type."
        rows={bedSetups}
        isPending={(v) => bedSetupsPendingDelete === v}
        pendingValue={bedSetupsPendingDelete}
        onAdd={() =>
          setBedSetupModal({ open: true, isNew: true, entry: { value: "", label: "" } })
        }
        onEdit={(entry) => setBedSetupModal({ open: true, isNew: false, entry: { ...entry } })}
        onDelete={handleBedSetupDelete}
        beginLabel="Add bed set-up"
        renderRow={(entry) => (
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-gray-900">{entry.label}</p>
            <p className="font-mono text-[11px] text-gray-500">{entry.value}</p>
          </div>
        )}
        renderModal={() => (
          <Modal
            open={bedSetupModal.open}
            onClose={() => setBedSetupModal({ open: false })}
            title={
              bedSetupModal.open && bedSetupModal.isNew
                ? "Add bed set-up"
                : `Edit “${bedSetupModal.open ? bedSetupModal.entry.label : ""}”`
            }
            footer={null}
          >
            {bedSetupModal.open ? (
              <form
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  const ok = await handleBedSetupSave(bedSetupModal.entry, bedSetupModal.isNew);
                  if (ok) setBedSetupModal({ open: false });
                }}
                className="space-y-4 text-sm"
              >
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Display label
                  <input
                    required
                    type="text"
                    value={bedSetupModal.entry.label}
                    onChange={(e) =>
                      setBedSetupModal({
                        ...bedSetupModal,
                        entry: { ...bedSetupModal.entry, label: e.target.value }
                      })
                    }
                    placeholder="I'd like a large bed"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium"
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Identifier key (kebab-case slug)
                  <input
                    required
                    type="text"
                    value={bedSetupModal.entry.value}
                    onChange={(e) =>
                      setBedSetupModal({
                        ...bedSetupModal,
                        entry: { ...bedSetupModal.entry, value: e.target.value }
                      })
                    }
                    placeholder="large-bed"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 font-mono text-sm font-medium"
                  />
                  <span className="text-[10px] font-normal leading-relaxed text-gray-500">
                    Lowercase letters, digits, '-' or '_'. Used by the room type's
                    `bedSetupValues` subset.
                  </span>
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBedSetupModal({ open: false })}
                    className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:min-h-[40px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 sm:min-h-[40px]"
                  >
                    <Save size={14} />
                    {bedSetupModal.isNew ? "Add" : "Save changes"}
                  </button>
                </div>
              </form>
            ) : null}
          </Modal>
        )}
      />

      <CatalogEditor<BookingPreferenceOption>
        title="Additional preferences"
        subtitle="The checkbox grid in the public booking Step 2 “Show additional preferences” accordion. The `surchargeNote` renders next to the label (informational only)."
        rows={bookingPreferences}
        isPending={(v) => prefsPendingDelete === v}
        pendingValue={prefsPendingDelete}
        onAdd={() =>
          setPrefsModal({ open: true, isNew: true, entry: { value: "", label: "" } })
        }
        onEdit={(entry) => setPrefsModal({ open: true, isNew: false, entry: { ...entry } })}
        onDelete={handlePreferenceDelete}
        beginLabel="Add preference"
        renderRow={(entry) => (
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-gray-900">
              {entry.label}
              {entry.surchargeNote ? (
                <span className="ml-1 font-normal text-gray-500">{entry.surchargeNote}</span>
              ) : null}
            </p>
            <p className="font-mono text-[11px] text-gray-500">{entry.value}</p>
          </div>
        )}
        renderModal={() => (
          <Modal
            open={prefsModal.open}
            onClose={() => setPrefsModal({ open: false })}
            title={
              prefsModal.open && prefsModal.isNew
                ? "Add preference"
                : `Edit “${prefsModal.open ? prefsModal.entry.label : ""}”`
            }
            footer={null}
          >
            {prefsModal.open ? (
              <form
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  const ok = await handlePreferenceSave(prefsModal.entry, prefsModal.isNew);
                  if (ok) setPrefsModal({ open: false });
                }}
                className="space-y-4 text-sm"
              >
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Display label
                  <input
                    required
                    type="text"
                    value={prefsModal.entry.label}
                    onChange={(e) =>
                      setPrefsModal({
                        ...prefsModal,
                        entry: { ...prefsModal.entry, label: e.target.value }
                      })
                    }
                    placeholder="I'd like a quiet room"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium"
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Identifier key (kebab-case slug)
                  <input
                    required
                    type="text"
                    value={prefsModal.entry.value}
                    onChange={(e) =>
                      setPrefsModal({
                        ...prefsModal,
                        entry: { ...prefsModal.entry, value: e.target.value }
                      })
                    }
                    placeholder="quiet-room"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 font-mono text-sm font-medium"
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Surcharge note (optional)
                  <input
                    type="text"
                    value={prefsModal.entry.surchargeNote ?? ""}
                    onChange={(e) =>
                      setPrefsModal({
                        ...prefsModal,
                        entry: { ...prefsModal.entry, surchargeNote: e.target.value }
                      })
                    }
                    placeholder="(additional charges may apply)"
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium"
                  />
                  <span className="text-[10px] font-normal leading-relaxed text-gray-500">
                    Renders next to the label on the guest form. Informational only —
                    no surcharge is wired to the booking total.
                  </span>
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPrefsModal({ open: false })}
                    className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:min-h-[40px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 sm:min-h-[40px]"
                  >
                    <Save size={14} />
                    {prefsModal.isNew ? "Add" : "Save changes"}
                  </button>
                </div>
              </form>
            ) : null}
          </Modal>
        )}
      />
    </div>
  );
}

function PaymentMethodsTabBody({
  paymentMethods,
  onAdd,
  onUpdate,
  onReorder,
  onDelete,
  onUploadQr,
  onResetQr
}: PaymentMethodsTabBodyProps) {
  const toast = useToast();
  const [editModal, setEditModal] = useState<EditModalState>({ open: false });
  // Two-step confirm state for `pay-at-hotel`-style destructive
  // actions. Set to the method key being confirmed; click 2
  // within 3s executes the action. Mirrors the corporate-code
  // delete pattern in `RatesPage.tsx:39-45`.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingArmPesonet, setPendingArmPesonet] = useState(false);
  useEffect(() => {
    if (!pendingDelete) return;
    const timer = setTimeout(() => setPendingDelete(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDelete]);
  useEffect(() => {
    if (!pendingArmPesonet) return;
    const timer = setTimeout(() => setPendingArmPesonet(false), 5000);
    return () => clearTimeout(timer);
  }, [pendingArmPesonet]);

  const isUnsupportedMethod = (m: string) =>
    UNSUPPORTED_PAYMENT_METHODS.includes(m.toLowerCase() as (typeof UNSUPPORTED_PAYMENT_METHODS)[number]);

  const handleToggle = (method: string) => {
    const target = paymentMethods.find((p) => p.method === method);
    if (!target) return;
    void onUpdate(method, { isEnabled: !target.isEnabled });
  };

  // Per #111 (per-method surface toggles): each method owns
  // two extra boolean flags — `showInStore` and
  // `showInCorporate` — that hide the method from those
  // surfaces independently. Both default to `true` when
  // missing (pre-#111 entries). The click toggles the flag
  // and persists via the same `onUpdate` path used by the
  // existing `isEnabled` toggle.
  const handleToggleSurface = (
    method: string,
    surface: "showInStore" | "showInCorporate"
  ) => {
    const target = paymentMethods.find((p) => p.method === method);
    if (!target) return;
    const current = (target as unknown as Record<string, unknown>)[surface];
    const next = current === false ? true : false;
    void onUpdate(method, { [surface]: next } as Partial<PaymentMethodConfig>);
  };

  const surfaceOptions = [
    { key: "booking", label: "Booking", icon: Globe },
    { key: "store", label: "Store", icon: ShoppingBag },
    { key: "corporate", label: "Corp", icon: Building2 }
  ] as const;

  const isSurfaceVisible = (pm: PaymentMethodConfig, surface: (typeof surfaceOptions)[number]["key"]) => {
    if (surface === "booking") return pm.isEnabled;
    if (surface === "store") return pm.showInStore !== false;
    return pm.showInCorporate !== false;
  };

  const toggleSurface = (pm: PaymentMethodConfig, surface: (typeof surfaceOptions)[number]["key"]) => {
    if (surface === "booking") {
      handleToggle(pm.method);
      return;
    }
    handleToggleSurface(pm.method, surface === "store" ? "showInStore" : "showInCorporate");
  };

  const handleReorder = (method: string, direction: "up" | "down") => {
    const idx = paymentMethods.findIndex((p) => p.method === method);
    if (idx === -1) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= paymentMethods.length) return;
    const next = [...paymentMethods];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    void onReorder(next);
  };

  const handleDelete = async (method: string) => {
    if (pendingDelete !== method) {
      setPendingDelete(method);
      toast.info("Confirm delete", "Click the trash button again within 3 seconds to confirm.");
      return;
    }
    setPendingDelete(null);
    await onDelete(method);
  };

  const openAddModal = () => {
    setPendingArmPesonet(false);
    setEditModal({ open: true, isNew: true, method: emptyPaymentMethod() });
  };

  const openEditModal = (pm: PaymentMethodConfig) => {
    setPendingArmPesonet(false);
    setEditModal({ open: true, isNew: false, method: { ...pm } });
  };

  const closeModal = () => {
    setEditModal({ open: false });
    setPendingArmPesonet(false);
  };

  const handleSaveModal = async () => {
    if (!editModal.open) return;
    const pm = editModal.method;
    const trimmedMethod = pm.method.trim();
    const trimmedLabel = pm.label.trim();
    if (!trimmedMethod) {
      toast.error("Method key is required", "Use a short, unique identifier (e.g. \"gcash\", \"maya\", \"custom-bank\").");
      return;
    }
    if (!/^[a-z0-9-]+$/.test(trimmedMethod)) {
      toast.error("Invalid method key", "Use lowercase letters, numbers, and hyphens only (e.g. \"gcash\", \"maya\", \"custom-bank\").");
      return;
    }
    if (!trimmedLabel) {
      toast.error("Label is required", "This is the display name shown to guests (e.g. \"GCash\", \"Bank Transfer\").");
      return;
    }
    const unsupported = isUnsupportedMethod(trimmedMethod);
    if (unsupported && !pendingArmPesonet) {
      setPendingArmPesonet(true);
      toast.warning(
        "Pesonet is not supported",
        "Pesonet is a batch-based system with cut-off windows and T+1 settlement — incompatible with instant booking confirmation. Click Save again within 5 seconds to add this method anyway."
      );
      return;
    }
    const normalized: PaymentMethodConfig = {
      method: trimmedMethod,
      label: trimmedLabel,
      accountName: pm.accountName.trim(),
      accountNumber: pm.accountNumber.trim(),
      qrUrl: pm.qrUrl,
      isEnabled: pm.isEnabled,
      showInStore: pm.showInStore,
      showInCorporate: pm.showInCorporate,
      requireReferenceNumber: pm.requireReferenceNumber !== false
    };
    if (editModal.isNew) {
      await onAdd(normalized);
    } else {
      await onUpdate(editModal.method.method, normalized);
    }
    closeModal();
  };

  const handleModalField = (field: keyof PaymentMethodConfig, value: string | boolean) => {
    if (!editModal.open) return;
    setEditModal({
      open: true,
      isNew: editModal.isNew,
      method: { ...editModal.method, [field]: value as never }
    });
  };

  const handleModalQrUpload = async (file: File) => {
    if (!editModal.open) return { success: false, error: "Modal not open" };
    return onUploadQr(editModal.method.method, file);
  };

  const handleModalQrReset = async () => {
    if (!editModal.open) return { success: false, error: "Modal not open" };
    return onResetQr(editModal.method.method);
  };

  return (
    <div className="space-y-6 text-xs">
      <div>
        <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Payment Methods</h3>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Add payment details once, then choose where each method appears: booking, in-room store, or corporate booking. QR codes are uploaded once per method.
        </p>
      </div>

      {/* Persistent Pesonet warning callout — not dismissible
          because it is policy, not a tip. Per the plan
          recommendation, the callout also lists the supported
          methods explicitly so admins know what to add. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-1.5">
            <p className="text-xs font-bold">Payment methods we currently support</p>
            <p className="text-[11px] leading-relaxed">
              <span className="font-semibold">GCash</span>, <span className="font-semibold">Maya</span>, <span className="font-semibold">Bank Transfer (InstaPay)</span>, <span className="font-semibold">PayPal</span>, and <span className="font-semibold">Pay at Hotel</span>. You can also add custom methods, but please do not add <span className="font-bold underline decoration-amber-400 decoration-2 underline-offset-2">Pesonet</span> — it is a batch-based bank transfer system with cut-off windows and T+1 settlement, which is incompatible with our instant-reservation confirmation flow. The schema is not hard-blocked, so an unscheduled business change can be reflected here without a code deploy.
            </p>
          </div>
        </div>
      </div>

      {/* Method list */}
      {paymentMethods.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center">
          <CreditCard size={28} className="mx-auto text-gray-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-gray-700">No payment methods yet</p>
          <p className="mt-1 text-[11px] text-gray-500">Add your first payment method to make it available to guests on the booking page.</p>
          <button
            type="button"
            onClick={openAddModal}
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
          >
            <Plus size={14} />
            Add payment method
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {paymentMethods.map((pm, idx) => {
            const Icon = paymentMethodIcon(pm.method);
            const armed = pendingDelete === pm.method;
            const unsupported = isUnsupportedMethod(pm.method);
            const isProtected = (PROTECTED_PAYMENT_METHODS as readonly string[]).includes(pm.method);
            const hasAnySurface = surfaceOptions.some((surface) => isSurfaceVisible(pm, surface.key));
            return (
              <div
                key={pm.method}
                className={`rounded-xl border bg-white p-4 shadow-sm transition ${
                  hasAnySurface ? "border-gray-200" : "border-gray-200 opacity-70"
                }`}
              >
                <div className="grid gap-4 lg:grid-cols-[80px_1fr_auto] lg:items-center">
                  {/* Icon + QR preview */}
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-section-bg">
                    {pm.qrUrl ? (
                      <img
                        src={pm.qrUrl}
                        alt={`${pm.label} QR code`}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Icon size={26} className="text-gray-400" aria-hidden="true" />
                    )}
                  </div>
                  {/* Label + key + unsupported tag */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{pm.label || pm.method}</p>
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-600">{pm.method}</code>
                      {unsupported && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">
                          <AlertTriangle size={10} aria-hidden="true" />
                          Unsupported
                        </span>
                      )}
                      {isProtected && (
                        <span
                          title="This payment method is required and cannot be removed. Use the on/off toggle to hide it from guests."
                          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700"
                        >
                          <Lock size={10} aria-hidden="true" />
                          Required
                        </span>
                      )}
                      {!hasAnySurface && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                          Hidden
                        </span>
                      )}
                    </div>
                    {(pm.accountName || pm.accountNumber) && (
                      <p className="mt-1 truncate text-[11px] text-gray-600">
                        {pm.accountName}
                        {pm.accountName && pm.accountNumber ? " · " : ""}
                        {pm.accountNumber}
                      </p>
                    )}
                    {pm.qrUrl ? (
                      <p className="mt-0.5 text-[10px] text-gray-400">QR uploaded</p>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-gray-400">No QR uploaded — guests see the account name &amp; number only</p>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <div className="mr-1 rounded-xl border border-gray-200 bg-gray-50/70 p-1">
                      <div className="mb-1 px-1 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                        Visible on
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {surfaceOptions.map((surface) => {
                          const visible = isSurfaceVisible(pm, surface.key);
                          const SurfaceIcon = surface.icon;
                          return (
                            <button
                              key={surface.key}
                              type="button"
                              onClick={() => toggleSurface(pm, surface.key)}
                              title={visible ? `Hide ${pm.label} from ${surface.label}` : `Show ${pm.label} on ${surface.label}`}
                              aria-pressed={visible}
                              aria-label={visible ? `Hide ${pm.label} from ${surface.label}` : `Show ${pm.label} on ${surface.label}`}
                              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-bold transition ${
                                visible
                                  ? "bg-primary text-white shadow-sm"
                                  : "bg-white text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50"
                              }`}
                            >
                              <SurfaceIcon size={12} aria-hidden="true" />
                              {surface.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* Reorder up */}
                    <button
                      type="button"
                      onClick={() => handleReorder(pm.method, "up")}
                      disabled={idx === 0}
                      aria-label={`Move ${pm.label} up`}
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    {/* Reorder down */}
                    <button
                      type="button"
                      onClick={() => handleReorder(pm.method, "down")}
                      disabled={idx === paymentMethods.length - 1}
                      aria-label={`Move ${pm.label} down`}
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    {/* Edit */}
                    <button
                      type="button"
                      onClick={() => openEditModal(pm)}
                      aria-label={`Edit ${pm.label}`}
                      className="min-h-[36px] px-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                    >
                      <Pencil size={13} aria-hidden="true" />
                      Edit
                    </button>
                    {/* Delete — two-step confirm. Hidden for protected
                        methods (see PROTECTED_PAYMENT_METHODS in
                        shared/constants). The underlying
                        `deletePaymentMethod` in AdminContext also
                        blocks deletion as a second line of defense. */}
                    {!isProtected && (
                      <button
                        type="button"
                        onClick={() => handleDelete(pm.method)}
                        aria-label={armed ? `Confirm delete ${pm.label}` : `Delete ${pm.label}`}
                        className={`min-h-[36px] px-3 inline-flex items-center gap-1.5 rounded-lg border text-xs font-semibold transition active:scale-95 ${
                          armed
                            ? "border-red-300 bg-red-100 text-red-700"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-red-50 hover:text-red-700"
                        }`}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        {armed ? "Tap again to confirm" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add button — always visible at the bottom of the tab */}
      {paymentMethods.length > 0 && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
          >
            <Plus size={14} aria-hidden="true" />
            Add payment method
          </button>
        </div>
      )}

      {/* Add / Edit modal */}
      {editModal.open && (
        <Modal
          open
          onClose={closeModal}
          title={editModal.isNew ? "Add payment method" : `Edit "${editModal.method.label || editModal.method.method}"`}
          footer={
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-200 bg-white px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-5 text-xs font-semibold text-white shadow-sm transition active:scale-95 ${
                  pendingArmPesonet
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-primary hover:bg-primary-dark"
                }`}
              >
                <Save size={14} aria-hidden="true" />
                {pendingArmPesonet ? "I understand, save anyway" : "Save"}
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Method key + Label — side by side on desktop */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Method key
                <input
                  type="text"
                  value={editModal.method.method}
                  onChange={(event) => handleModalField("method", event.target.value.toLowerCase())}
                  disabled={!editModal.isNew}
                  placeholder="e.g. gcash, maya, custom-bank"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 font-mono text-sm font-medium focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="text-[10px] font-normal text-gray-500">
                  {editModal.isNew
                    ? "Unique identifier stored in `paymentMethod` on each booking. Lowercase letters, numbers, and hyphens."
                    : "Cannot be changed after creation — used as the `paymentMethod` value on existing booking records."}
                </span>
              </label>
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Label
                <input
                  type="text"
                  value={editModal.method.label}
                  onChange={(event) => handleModalField("label", event.target.value)}
                  placeholder="e.g. GCash, Bank Transfer, Pay at Hotel"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                />
                <span className="text-[10px] font-normal text-gray-500">Display name shown to guests on the booking page.</span>
              </label>
            </div>

            {/* Account name + Account number */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Account name
                <input
                  type="text"
                  value={editModal.method.accountName}
                  onChange={(event) => handleModalField("accountName", event.target.value)}
                  placeholder="e.g. Spark Inn Hotel Corp"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                />
                <span className="text-[10px] font-normal text-gray-500">Shown beside the QR code. Leave empty if not applicable.</span>
              </label>
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Account number
                <input
                  type="text"
                  value={editModal.method.accountNumber}
                  onChange={(event) => handleModalField("accountNumber", event.target.value)}
                  placeholder="e.g. 0917-000-0000"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                />
                <span className="text-[10px] font-normal text-gray-500">For PayPal, use the PayPal email address.</span>
              </label>
            </div>

            {/* Enable toggle */}
            <label className="flex items-center gap-3 cursor-pointer text-xs font-semibold text-gray-700">
              <button
                type="button"
                onClick={() => handleModalField("isEnabled", !editModal.method.isEnabled)}
                aria-label={editModal.method.isEnabled ? "Disable method" : "Enable method"}
                className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                  editModal.method.isEnabled ? "bg-primary" : "bg-gray-200"
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                    editModal.method.isEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              Visible to guests on the booking page
            </label>

            {/* Require Reference Number toggle */}
            <label className="flex items-center gap-3 cursor-pointer text-xs font-semibold text-gray-700">
              <button
                type="button"
                onClick={() => handleModalField("requireReferenceNumber", editModal.method.requireReferenceNumber === false)}
                aria-label={editModal.method.requireReferenceNumber !== false ? "Disable reference number requirement" : "Enable reference number requirement"}
                className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                  editModal.method.requireReferenceNumber !== false ? "bg-primary" : "bg-gray-200"
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                    editModal.method.requireReferenceNumber !== false ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              Require guest to provide a payment reference number
            </label>

            {/* QR code uploader — visible only on edit, not add.
                For new methods the admin must save first so we have
                a method key for the Storage path
                `assets/payment-methods/{method}/`. The QR uploader
                then appears in the same modal. */}
            {!editModal.isNew && (
              <PaymentMethodQrUploader
                method={editModal.method.method}
                label={editModal.method.label}
                qrUrl={editModal.method.qrUrl}
                onUpload={handleModalQrUpload}
                onReset={handleModalQrReset}
              />
            )}

            {/* Pesonet inline warning */}
            {isUnsupportedMethod(editModal.method.method) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold">Pesonet is not supported</p>
                    <p className="text-[11px] leading-relaxed">
                      Pesonet is a batch-based bank transfer system with cut-off windows and T+1 settlement — incompatible with our instant-reservation confirmation flow. Click <span className="font-semibold">Save</span> again within 5 seconds to add this method anyway.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// QR uploader for the Payment Methods tab — mirrors the
// `BrandingAssetRow` semantics (file input + preview + Upload /
// Replace / Reset + status pill). Inlined here rather than
// abstracted because the surrounding layout is different and the
// reset/delete flow is unique to the payment methods context.
interface PaymentMethodQrUploaderProps {
  method: string;
  label: string;
  qrUrl: string;
  onUpload: (file: File) => Promise<{ success: boolean; error?: string; url?: string }>;
  onReset: () => Promise<{ success: boolean; error?: string }>;
}

function PaymentMethodQrUploader({ method, label, qrUrl, onUpload, onReset }: PaymentMethodQrUploaderProps) {
  const [status, setStatus] = useState<"idle" | "uploading" | "resetting">("idle");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasOverride = qrUrl.length > 0;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError("");
    setStatus("uploading");
    const result = await onUpload(file);
    if (!result.success) {
      setError(result.error || "Upload failed");
    }
    setStatus("idle");
  }

  async function handleReset() {
    if (!hasOverride) return;
    setError("");
    setStatus("resetting");
    const result = await onReset();
    if (!result.success) {
      setError(result.error || "Reset failed");
    }
    setStatus("idle");
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-800">QR code</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Upload a PNG / JPEG / WebP image (max {Math.round(MAX_PAYMENT_METHOD_QR_BYTES / 1024 / 1024)} MB). QR codes are sharp monochrome — PNG is recommended to avoid JPEG artifacts that can break scanners.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0 ${
            hasOverride
              ? "bg-primary-light text-primary-dark"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {hasOverride ? "Custom override" : "No QR"}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr] sm:items-start">
        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white sm:h-24 sm:w-24">
          {hasOverride ? (
            <img src={qrUrl} alt={`${label} QR code preview`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 text-center text-[10px] text-gray-500">
              <ImagePlus size={20} className="opacity-50" aria-hidden="true" />
              <p className="mt-1 font-semibold opacity-70">No QR yet</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={status === "uploading"}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={status !== "idle"}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload size={13} aria-hidden="true" />
              {status === "uploading" ? "Uploading..." : hasOverride ? "Replace QR" : "Upload QR"}
            </button>
            {hasOverride && (
              <button
                type="button"
                disabled={status !== "idle"}
                onClick={handleReset}
                className="min-h-[44px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw size={13} aria-hidden="true" />
                {status === "resetting" ? "Removing..." : "Remove QR"}
              </button>
            )}
          </div>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-semibold text-red-700">
              {error}
            </p>
          )}
          <p className="text-[10px] text-gray-400">
            Saved to <code className="font-mono">assets/payment-methods/{method || "<method-key>"}/</code> in Firebase Storage.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const {
    hotelConfig,
    websiteContent,
    websiteContentLoading,
    settingsLoading,
    rewardsConfig,
    breakfastConfig,
    storeConfig,
    seoSettings,
    updateSettings,
    roomTypes,
    addRoomType,
    updateRoomType,
    deleteRoomType,
    uploadRoomTypePhoto,
    removeRoomTypePhoto,
    reorderRoomTypePhotos,
    // Per SR-01..05 (2026-10-12): the Booking Preferences
    // tab pulls the live catalogs + update helpers from
    // `useAdmin()` so the writes go through the same
    // `settings/hotelConfig` channel as everything else.
    bedSetupsCatalog,
    bookingPreferencesCatalog,
    updateBedSetups,
    updateBookingPreferences,
    uploadBrandingAsset,
    resetBrandingAsset,
    storeItems,
    rooms,
    addStoreItem,
    updateStoreItem,
    deleteStoreItem,
    currentUser,
    staff,
    createStaff,
    disableStaff,
    updateStaff,
    sendPasswordReset,
    paymentMethods,
    addPaymentMethod,
    updatePaymentMethod,
    reorderPaymentMethods,
    deletePaymentMethod,
    uploadPaymentMethodQr,
    resetPaymentMethodQr,
    uploadBreakfastMealImage,
    removeBreakfastMealImage,
    bookingSources,
    addBookingSource,
    updateBookingSource,
    reorderBookingSources,
    deleteBookingSource,
    testRuns,
    testRunsLoading,
    createTestRun,
    closeTestRun,
    deleteTestRun,
    refreshTestRuns
  } = useAdmin();
  const toast = useToast();
  const { isMobile } = useBreakpoint();
  const [saveStatuses, setSaveStatuses] = useState<Partial<Record<SettingsSaveKey, SettingsSaveStatus>>>({});
  const saveStatusTimersRef = useRef<Partial<Record<SettingsSaveKey, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    return () => {
      Object.values(saveStatusTimersRef.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  const getSaveStatus = (key: SettingsSaveKey): SettingsSaveStatus => saveStatuses[key] ?? "idle";

  const runSettingsSave = async (
    key: SettingsSaveKey,
    toastTitle: string,
    action: () => Promise<boolean>,
    successMessage = "Changes saved and are live now."
  ) => {
    const existingTimer = saveStatusTimersRef.current[key];
    if (existingTimer) clearTimeout(existingTimer);
    setSaveStatuses((prev) => ({ ...prev, [key]: "saving" }));

    try {
      const success = await action();
      if (success) {
        setSaveStatuses((prev) => ({ ...prev, [key]: "saved" }));
        toast.success(toastTitle, successMessage);
        saveStatusTimersRef.current[key] = setTimeout(() => {
          setSaveStatuses((prev) => ({ ...prev, [key]: "idle" }));
        }, 3500);
        return true;
      }
    } catch (error) {
      console.error(`Settings save failed for ${key}:`, error);
      toast.error("Failed to save settings", error instanceof Error ? error.message : "Please try again.");
    }

    setSaveStatuses((prev) => ({ ...prev, [key]: "error" }));
    return false;
  };

  // Active Settings Section Tab — driven by the `?tab=` query
  // param so deep links (e.g. `/settings?tab=payment` from
  // `/rates`) jump straight to the right section. Unknown /
  // missing values fall back to `"hotel"`.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId = (VALID_TAB_IDS as string[]).includes(tabParam || "")
    ? (tabParam as TabId)
    : "hotel";
  const setActiveTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams);
    if (next === "hotel") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    setSearchParams(params, { replace: true });
  };

  const [activeFromEmail, setActiveFromEmail] = useState<string>("");
  const [activeAdminEmail, setActiveAdminEmail] = useState<string>("");

  useEffect(() => {
    if (activeTab !== "email") return;

    let isMounted = true;
    const fetchEmailConfig = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/admin/email-config`, {
          headers: {
            "Authorization": token ? `Bearer ${token}` : ""
          }
        });
        const data = await res.json();
        if (data.success && isMounted) {
          setActiveFromEmail(data.fromEmail);
          setActiveAdminEmail(data.adminEmail);
        }
      } catch (err) {
        console.error("Failed to load email config:", err);
      }
    };
    void fetchEmailConfig();

    return () => {
      isMounted = false;
    };
  }, [activeTab]);

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

  // Per SET-SBG-01 (2026-10-12, settings-sidebar-grouping):
  // the desktop sidebar groups the 18 settings tabs into 5
  // collapsible sections. The user's collapsed/expanded
  // preferences persist in `localStorage` so the sidebar
  // remembers their layout across reloads. The active group
  // is always force-expanded — visibility of "where you are
  // in the app" wins over the user's collapsing preference.
  const validGroupIds = useMemo(
    () => new Set(SETTINGS_GROUPS.map((group) => group.id)),
    []
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(SETTINGS_GROUPS_COLLAPSED_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is string =>
        typeof value === "string" && validGroupIds.has(value)
      );
    } catch {
      // Corrupted localStorage JSON or quota error — start fresh.
      return [];
    }
  });

  const persistedCollapsedSet = useMemo(
    () => new Set(collapsedGroupIds),
    [collapsedGroupIds]
  );

  // `groupOfTab` — resolve the active tab to its group id. The
  // `setCollapsedGroupIds` setter down below wraps persistence.
  const groupOfTab = useCallback(
    (tabId: TabId): string => {
      for (const group of SETTINGS_GROUPS) {
        if (group.tabs.includes(tabId)) return group.id;
      }
      return SETTINGS_GROUPS[0]!.id;
    },
    []
  );

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      const serialized = JSON.stringify(Array.from(next));
      try {
        window.localStorage.setItem(SETTINGS_GROUPS_COLLAPSED_STORAGE_KEY, serialized);
      } catch {
        // Quota error or storage disabled — keep in-memory state
        // but skip persistence. Re-mount will forget the toggle.
      }
      return Array.from(next);
    });
  }, []);

  // Active group is auto-expanded on every `activeTab` change —
  // when the operator navigates into a section its visibility
  // takes priority over their previous collapsing choice.
  useEffect(() => {
    const activeGroupId = groupOfTab(activeTab);
    setCollapsedGroupIds((prev) => {
      if (!prev.includes(activeGroupId)) return prev;
      const next = prev.filter((id) => id !== activeGroupId);
      try {
        window.localStorage.setItem(
          SETTINGS_GROUPS_COLLAPSED_STORAGE_KEY,
          JSON.stringify(next)
        );
      } catch {
        // Ignore persistence failure — in-memory state still wins.
      }
      return next;
    });
  }, [activeTab, groupOfTab]);

  // Local state form mirrors
  // 1. Hotel Config Form States
  const [checkInTime, setCheckInTime] = useState(hotelConfig.checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(hotelConfig.checkOutTime);
  const [seoMetaDescription, setSeoMetaDescription] = useState(seoSettings.draft?.metaDescription || config.metaDescription);
  const [seoPriceRange, setSeoPriceRange] = useState(seoSettings.draft?.priceRange || config.priceRange);
  const [seoOgImage, setSeoOgImage] = useState(normalizeSeoImageOverride(seoSettings.draft?.ogImage));
  const [isPublishingSeo, setIsPublishingSeo] = useState(false);
  // Canonical runtime hotel contact fields. Missing values fall back
  // to deploy-time config; explicitly blank social values hide icons.
  const [address, setAddress] = useState(hotelConfig.address);
  const [frontDeskPhone, setFrontDeskPhone] = useState(hotelConfig.frontDeskPhone);
  const [supportEmail, setSupportEmail] = useState(hotelConfig.supportEmail);
  const [dpoEmail, setDpoEmail] = useState(hotelConfig.dpoEmail);
  const [facebookUrl, setFacebookUrl] = useState(hotelConfig.facebookUrl);
  const [instagramUrl, setInstagramUrl] = useState(hotelConfig.instagramUrl);
  const [twitterHandle, setTwitterHandle] = useState(hotelConfig.twitterHandle ?? config.twitterHandle);

  // Per DSC-01..05 (2026-08-01, per CVQ-06): per-class
  // discount scope. The Discounts tab renders a 3×3
  // checkbox editor (senior row admin-only per DSC-03);
  // this state mirrors the editor and persists via
  // `handleSaveDiscounts`. The snapshot is written to
  // `settings/hotelConfig.discountScope` and read by the
  // server on every new booking. Legacy settings hydrate
  // to the broad default via `normalizeDiscountScope` in
  // `AdminContext`.
  const [discountScope, setDiscountScope] = useState<DiscountScope>(hotelConfig.discountScope);

  // Per VAT-01 (2026-10-12): the Tax card on the Discounts
  // tab. The single boolean — `vatEnabled` — drives the
  // `settings/hotelConfig.vatConfig.enabled` field; every
  // product surface that renders the 12% VAT breakdown
  // (Reports + XLSX, admin booking drawer, admin print-to-PDF
  // receipt, guest `/book` live preview) consults
  // `isVatEnabled(hotelConfig.vatConfig)` to decide whether
  // to show the block. Default ON — BIR-compliant state —
  // so existing hotels hydrate byte-equivalent. The owner's
  // toggle is a one-click flip; the only other real-world
  // state is "below the BIR threshold" (0%).
  const [vatEnabled, setVatEnabled] = useState<boolean>(isVatEnabled(hotelConfig.vatConfig));

  // Per the IFH-01.3 (Settings UI editor) follow-up: the
  // Booking & Holds tab. Two number inputs (post-Confirm
  // hold window in hours + in-flow hold window in
  // minutes) that persist via `handleSaveHolds`. Both
  // fields are snapshotted onto each booking + each
  // hold at create/start time (a later Settings change
  // never shortens or lengthens an existing guest's
  // promise), so the snapshot is the only authority
  // the rest of the system reads. The `clampIntegerInRange`
  // helper validates the input at the form layer (Save
  // is disabled when the value is out of range, hand-
  // typed, or non-finite). The server-side normalize
  // helpers (`normalizePaymentHoldWindowHours` from
  // `shared/utils/bookingOccupancy.ts` +
  // `normalizeInFlowHoldMinutes` from
  // `shared/utils/bookingInFlowHold.ts`) are the
  // last-line-of-defense — they always coerce a
  // legacy / hand-edited Firestore doc to the
  // allowed range on hydrate.
  const [paymentHoldWindowHoursInput, setPaymentHoldWindowHoursInput] = useState<string>(
    String(hotelConfig.paymentHoldWindowHours)
  );
  const [inFlowHoldMinutesInput, setInFlowHoldMinutesInput] = useState<string>(
    String(hotelConfig.inFlowHoldMinutes)
  );

  // Per MSL-01 (2026-10-15): the maximum stay length. `AdminContext`
  // holds the RESOLVED value, so "no limit" arrives as `Infinity` and
  // is rendered back as the literal `0` the admin actually saved.
  const [maxStayNightsInput, setMaxStayNightsInput] = useState<string>(() =>
    Number.isFinite(hotelConfig.maxStayNights)
      ? String(hotelConfig.maxStayNights)
      : "0"
  );

  // Per OCT-H3 (2026-10-20, decision #282): the three Booking &
  // Holds inputs above were initialized from `hotelConfig` with
  // `useState`'s lazy initializer, which only runs on the FIRST
  // render — BEFORE the Firestore snapshot lands. On a direct
  // load of `/settings` (F5 / bookmark / shared URL) the fields
  // were therefore stuck at the pre-snapshot defaults, and the
  // next save of an UNRELATED field silently rewrote the stored
  // policy: a hotel that had set the stay cap to "no limit"
  // (`0`) had it replaced with `30`, with the field still
  // displaying "30" so there was no signal that anything
  // changed. The guest site then started refusing 31+ night
  // stays it previously accepted.
  //
  // The fix re-syncs each input from the snapshot, but ONLY when
  // that field's SOURCE value actually changed since the last
  // sync. A snapshot that arrives while the admin is mid-typing
  // therefore cannot clobber the in-progress edit, while the
  // initial hydration (and any genuine external change) does
  // land.
  const holdsFormSyncRef = useRef<{
    paymentHoldWindowHours: string;
    inFlowHoldMinutes: string;
    maxStayNights: string;
  } | null>(null);

  useEffect(() => {
    const next = {
      paymentHoldWindowHours: String(hotelConfig.paymentHoldWindowHours),
      inFlowHoldMinutes: String(hotelConfig.inFlowHoldMinutes),
      // `resolveMaxStayNights` maps the stored `0` ("no limit")
      // to `Infinity`; render it back as the literal `0` the
      // admin saved so the field round-trips.
      maxStayNights: Number.isFinite(hotelConfig.maxStayNights)
        ? String(hotelConfig.maxStayNights)
        : "0"
    };
    const prev = holdsFormSyncRef.current;
    holdsFormSyncRef.current = next;
    // First run: the snapshot has not landed yet, so these are
    // the pre-snapshot defaults the `useState` initializers
    // already used. Record them WITHOUT touching the inputs so
    // the real snapshot is treated as a genuine change.
    if (!prev) return;
    if (prev.paymentHoldWindowHours !== next.paymentHoldWindowHours) {
      setPaymentHoldWindowHoursInput(next.paymentHoldWindowHours);
    }
    if (prev.inFlowHoldMinutes !== next.inFlowHoldMinutes) {
      setInFlowHoldMinutesInput(next.inFlowHoldMinutes);
    }
    if (prev.maxStayNights !== next.maxStayNights) {
      setMaxStayNightsInput(next.maxStayNights);
    }
  }, [
    hotelConfig.paymentHoldWindowHours,
    hotelConfig.inFlowHoldMinutes,
    hotelConfig.maxStayNights
  ]);

  // `0` = no limit is a LEGAL value here, so this cannot use
  // `clampIntegerInRange` (whose `min` is >= 1 for every other field).
  // Rejects: blank, non-numeric, fractional, negative, and anything
  // past the booking horizon (a stay longer than the horizon is
  // unreachable, so the horizon is the honest upper bound).
  const maxStayNightsValid = (() => {
    const trimmed = maxStayNightsInput.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed);
    if (!Number.isInteger(value)) return null;
    if (value < 0 || value > MAX_MAX_STAY_NIGHTS) return null;
    return value;
  })();

  // Validate at the form layer. `clampIntegerInRange`
  // returns `null` for out-of-range / non-finite /
  // non-integer — the form surfaces an inline error
  // and disables Save. Mirrors the
  // `normalizePaymentHoldWindowHours` / `normalizeInFlowHoldMinutes`
  // server-side clamps.
  const paymentHoldWindowHoursValid = clampIntegerInRange(
    paymentHoldWindowHoursInput,
    MIN_PAYMENT_HOLD_WINDOW_HOURS,
    MAX_PAYMENT_HOLD_WINDOW_HOURS
  );
  const inFlowHoldMinutesValid = clampIntegerInRange(
    inFlowHoldMinutesInput,
    MIN_IN_FLOW_HOLD_MINUTES,
    MAX_IN_FLOW_HOLD_MINUTES
  );
  const holdsFormValid =
    paymentHoldWindowHoursValid !== null &&
    inFlowHoldMinutesValid !== null &&
    maxStayNightsValid !== null;

  // 2. Website Content states (Branding tab). Hero copy for every page
  // lives here. The Website Content tab (amenities / services / etc.)
  // no longer owns any hero copy — see `handleSaveBranding` below.
  // The `?? ""` guards are belt-and-suspenders: AdminContext already
  // normalizes partial Firestore documents to the full shape, but
  // any regression there should not crash this page.
  const [homepageHeroEyebrow, setHomepageHeroEyebrow] = useState(websiteContent.homepage?.heroEyebrow ?? "");
  const [homepageHeroHeading, setHomepageHeroHeading] = useState(websiteContent.homepage?.heroHeading ?? "");
  const [homepageHeroSubtext, setHomepageHeroSubtext] = useState(websiteContent.homepage?.heroSubtext ?? "");
  const [aboutHeroEyebrow, setAboutHeroEyebrow] = useState(websiteContent.about?.heroEyebrow ?? "");
  const [aboutHeroHeading, setAboutHeroHeading] = useState(websiteContent.about?.heroHeading ?? "");
  const [aboutHeroSubtext, setAboutHeroSubtext] = useState(websiteContent.about?.heroSubtext ?? "");
  const [corporateHeroEyebrow, setCorporateHeroEyebrow] = useState(websiteContent.corporate?.heroEyebrow ?? "");
  const [corporateHeroHeading, setCorporateHeroHeading] = useState(websiteContent.corporate?.heroHeading ?? "");
  const [corporateHeroSubtext, setCorporateHeroSubtext] = useState(websiteContent.corporate?.heroSubtext ?? "");
  const [rewardsHeroEyebrow, setRewardsHeroEyebrow] = useState(websiteContent.rewards?.heroEyebrow ?? "");
  const [rewardsHeroHeading, setRewardsHeroHeading] = useState(websiteContent.rewards?.heroHeading ?? "");
  const [rewardsHeroSubtext, setRewardsHeroSubtext] = useState(websiteContent.rewards?.heroSubtext ?? "");

  // Website Content tab — list-based content for the homepage
  // (amenities, services, featured rooms, Spark Rewards promo).
  // Hydrated from websiteContent; persisted via handleSaveWebsiteContent
  // using the existing `updateSettings("websiteContent", ...)` path.
  const [homepageAmenities, setHomepageAmenities] = useState<ListEditorItem[]>(
    websiteContent.homepage?.amenities ?? []
  );
  const [homepageServices, setHomepageServices] = useState<ListEditorItem[]>(
    websiteContent.homepage?.services ?? []
  );
  const [homepageFeaturedTypeValues, setHomepageFeaturedTypeValues] = useState<string[]>(
    websiteContent.homepage?.featuredTypeValues ?? []
  );
  const [sparkRewardsEnabled, setSparkRewardsEnabled] = useState<boolean>(
    websiteContent.homepage?.sparkRewards?.isEnabled ?? true
  );
  const [sparkRewardsHeading, setSparkRewardsHeading] = useState<string>(
    websiteContent.homepage?.sparkRewards?.heading ?? ""
  );
  const [sparkRewardsDescription, setSparkRewardsDescription] = useState<string>(
    websiteContent.homepage?.sparkRewards?.description ?? ""
  );
  const [sparkRewardsPerks, setSparkRewardsPerks] = useState<ListEditorItem[]>(
    websiteContent.homepage?.sparkRewards?.perks ?? []
  );

  // Corporate page content (Website Content → Corporate page). The
  // corporate hero is owned by the Branding tab; this section owns
  // the rest of the page: perks grid, rooms overview copy, and the
  // retreat CTA banner. All fields are plain strings; perks share
  // the homepage's `ListEditor` shape (title / description / icon /
  // isEnabled) so the editor is identical to the one used for
  // homepage amenities / services / Spark Rewards perks.
  const [corporatePerks, setCorporatePerks] = useState<ListEditorItem[]>(
    websiteContent.corporate?.perks ?? []
  );
  const [corporateRoomsOverviewEyebrow, setCorporateRoomsOverviewEyebrow] = useState<string>(
    websiteContent.corporate?.roomsOverviewEyebrow ?? ""
  );
  const [corporateRoomsOverviewHeading, setCorporateRoomsOverviewHeading] = useState<string>(
    websiteContent.corporate?.roomsOverviewHeading ?? ""
  );
  const [corporateRoomsOverviewDescription, setCorporateRoomsOverviewDescription] = useState<string>(
    websiteContent.corporate?.roomsOverviewDescription ?? ""
  );
  const [corporateRetreatHeading, setCorporateRetreatHeading] = useState<string>(
    websiteContent.corporate?.retreatHeading ?? ""
  );
  const [corporateRetreatDescription, setCorporateRetreatDescription] = useState<string>(
    websiteContent.corporate?.retreatDescription ?? ""
  );
  const [corporateRetreatCtaLabel, setCorporateRetreatCtaLabel] = useState<string>(
    websiteContent.corporate?.retreatCtaLabel ?? ""
  );

  const [aboutMissionStatement, setAboutMissionStatement] = useState<string>(
    websiteContent.about?.missionStatement || ""
  );
  const [aboutVisionStatement, setAboutVisionStatement] = useState<string>(
    websiteContent.about?.visionStatement || ""
  );
  const [aboutHotelStory, setAboutHotelStory] = useState<string>(
    websiteContent.about?.hotelStory || ""
  );

  // Rooms Catalog, Contact, and Not Found page copy states
  const [roomsCatalogHeroEyebrow, setRoomsCatalogHeroEyebrow] = useState(websiteContent.roomsCatalog?.heroEyebrow ?? "");
  const [roomsCatalogHeroHeading, setRoomsCatalogHeroHeading] = useState(websiteContent.roomsCatalog?.heroHeading ?? "");
  const [roomsCatalogHeroSubtext, setRoomsCatalogHeroSubtext] = useState(websiteContent.roomsCatalog?.heroSubtext ?? "");

  const [contactHeroEyebrow, setContactHeroEyebrow] = useState(websiteContent.contact?.heroEyebrow ?? "");
  const [contactHeroHeading, setContactHeroHeading] = useState(websiteContent.contact?.heroHeading ?? "");
  const [contactHeroSubtext, setContactHeroSubtext] = useState(websiteContent.contact?.heroSubtext ?? "");

  const [notFoundHeroEyebrow, setNotFoundHeroEyebrow] = useState(websiteContent.notFound?.heroEyebrow ?? "");
  const [notFoundHeroHeading, setNotFoundHeroHeading] = useState(websiteContent.notFound?.heroHeading ?? "");
  const [notFoundHeroSubtext, setNotFoundHeroSubtext] = useState(websiteContent.notFound?.heroSubtext ?? "");

  // Homepage Section Headers states
  const [roomsEyebrow, setRoomsEyebrow] = useState(websiteContent.homepage?.sectionHeaders?.roomsEyebrow ?? "");
  const [roomsHeading, setRoomsHeading] = useState(websiteContent.homepage?.sectionHeaders?.roomsHeading ?? "");
  const [roomsSubtext, setRoomsSubtext] = useState(websiteContent.homepage?.sectionHeaders?.roomsSubtext ?? "");
  const [amenitiesEyebrow, setAmenitiesEyebrow] = useState(websiteContent.homepage?.sectionHeaders?.amenitiesEyebrow ?? "");
  const [amenitiesHeading, setAmenitiesHeading] = useState(websiteContent.homepage?.sectionHeaders?.amenitiesHeading ?? "");
  const [amenitiesSubtext, setAmenitiesSubtext] = useState(websiteContent.homepage?.sectionHeaders?.amenitiesSubtext ?? "");
  const [servicesEyebrow, setServicesEyebrow] = useState(websiteContent.homepage?.sectionHeaders?.servicesEyebrow ?? "");
  const [servicesHeading, setServicesHeading] = useState(websiteContent.homepage?.sectionHeaders?.servicesHeading ?? "");
  const [servicesSubtext, setServicesSubtext] = useState(websiteContent.homepage?.sectionHeaders?.servicesSubtext ?? "");



  // 3. Rewards Config states
  // Per EC-02 (2026-08-21): the `earlyCheckInEnabled` toggle
  // joins the existing `pointsEnabled` + `memberDiscountEnabled`
  // toggles in the Rewards tab. When off, the booking flow
  // hides the "Request Early Check-In" button on Step 4 (the
  // confirmation page) AND the guest-app server rejects the
  // write with 403 (defense-in-depth — never trust the
  // client per Hard Rule #1). The toggle defaults to true so
  // existing deployments keep the perk on until the admin
  // explicitly turns it off.
  const [earlyCheckInEnabled, setEarlyCheckInEnabled] = useState<boolean>(
    rewardsConfig.earlyCheckInEnabled !== false
  );
  // Per PR #9 (2026-10-13): admin opt-in for member self-service
  // points redemption at booking Step 3. Default OFF (false) so
  // existing deployments preserve the front-desk-mediated flow.
  const [allowMemberPointsRedemption, setAllowMemberPointsRedemption] = useState<boolean>(
    rewardsConfig.allowMemberPointsRedemption === true
  );
  const [pointsEnabled, setPointsEnabled] = useState(rewardsConfig.pointsEnabled);
  const [earningMode, setEarningMode] = useState<"per-booking" | "per-spend">(rewardsConfig.earningMode);
  const [pointsPerBooking, setPointsPerBooking] = useState(String(rewardsConfig.pointsPerBooking));
  const [pointsPerHundred, setPointsPerHundred] = useState(String(rewardsConfig.pointsPerHundred));
  const [pointsRedemptionRate, setPointsRedemptionRate] = useState(String(rewardsConfig.pointsRedemptionRate));
  const [memberDiscountEnabled, setMemberDiscountEnabled] = useState(rewardsConfig.memberDiscountEnabled);
  const [memberDiscountPct, setMemberDiscountPct] = useState(String(rewardsConfig.memberDiscountPct));
  // Per Phase 2 of the Spark Rewards tier system (2026-10-12):
  // six new scalars + the levels array. All read from
  // `rewardsConfig` with safe defaults so a fresh deploy
  // (or a pre-Phase-2 doc with the fields absent) renders
  // identically to the legacy single-toggle UI.
  const [welcomePoints, setWelcomePoints] = useState(String(rewardsConfig.welcomePoints ?? 0));
  const [minPointsToRedeem, setMinPointsToRedeem] = useState(String(rewardsConfig.minPointsToRedeem ?? 0));
  const [pointsCanPayUpToBillPct, setPointsCanPayUpToBillPct] = useState(String(rewardsConfig.pointsCanPayUpToBillPct ?? 100));
  const [freeNightEvery, setFreeNightEvery] = useState(String(rewardsConfig.freeNightEvery ?? 0));
  const [levels, setLevels] = useState<LevelDef[]>(Array.isArray(rewardsConfig.levels) ? rewardsConfig.levels : []);

  // 4. Breakfast Config states
  // Per BR-02 / decision #231 (2026-10-12, breakfast redesign):
  // the Breakfast & Dining tab now hydrates against the new shared
  // `BreakfastConfig` shape (replacing the legacy `silogItems` /
  // `ratePerPersonPerNight` / `breakfastIncludesChildrenDefault`
  // fields). The old fields are still on the AdminContext default
  // state until BR-03 migrates the create path; the form hydrates
  // defensively when the legacy shape is the only thing available
  // (e.g. an existing settings doc that hasn't been re-saved yet).
  const [breakfastEnabled, setBreakfastEnabled] = useState(breakfastConfig.isEnabled ?? false);
  // Default 8:00 PM per spec §Decisions Locked #5. The hotel
  // timezone (used by the cut-off rule) is sourced from
  // `hotel.config.ts` and rendered read-only below — it is NOT a
  // form input and is NOT a `useState`.
  const [breakfastCutoffTime, setBreakfastCutoffTime] = useState(
    breakfastConfig.cutoffTime ?? DEFAULT_BREAKFAST_CUTOFF_TIME
  );
  // Per BR-10 (decision #244 reserved, 2026-10-14 —
  // Phase 14): the cut-off enforcement toggle. Defaults
  // to `true` (pre-BR-10 behaviour) for legacy / missing
  // values. When flipped off, the shared
  // `computeBreakfastCutoffState` helper short-circuits
  // to `isLocked: false` on every read path (guest
  // Add-ons step, Manage Breakfast, staff drawer,
  // walk-in + calendar-create modals, and the server
  // gate). The `cutoffTime` + `cutoffTimezone` settings
  // stay on the doc so flipping the toggle back on
  // restores the original cut-off without re-entering.
  const [breakfastCutoffsEnabled, setBreakfastCutoffsEnabled] = useState(
    breakfastConfig.cutoffsEnabled !== false
  );
  // Per spec decision #7: defensive default `true` — historical
  // behavior allowed staff to override the cut-off, so a missing
  // config field hydrates to the permissive side until the admin
  // explicitly opts into the strict policy.
  const [breakfastFrontDeskOverrideEnabled, setBreakfastFrontDeskOverrideEnabled] = useState(
    breakfastConfig.frontDeskOverrideEnabled ?? true
  );
  // Shown in Step 2 + Manage Booking + booking review per spec.
  // Capped at 2000 chars by `BreakfastConfigSchema`.
  const [breakfastDefaultMealInstructions, setBreakfastDefaultMealInstructions] = useState(
    breakfastConfig.defaultMealInstructions ?? ""
  );
  // Per Open Item #5 (BR-02): the served-grace window in minutes.
  // Default 15 per the spec recommendation; 0 disables the grace
  // window (every un-serve needs an override reason).
  const [breakfastServedGraceMinutes, setBreakfastServedGraceMinutes] = useState(
    String(breakfastConfig.servedGraceMinutes ?? DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES)
  );
  // The catalog itself. Hydration order (per BR-02 acceptance criteria):
  //   1. If the new shape's `meals[]` is populated, use it.
  //   2. Otherwise, if the legacy `silogItems[]` is populated, derive
  //      a new-shape `meals[]` from it (price/description backfilled
  //      with safe defaults so the AdminContext's seed catalog doesn't
  //      lose its rows on first save).
  //   3. Otherwise, default to `[]` (the AdminContext's empty-state
  //      branch — the operator must add at least one meal).
  const [breakfastMeals, setBreakfastMeals] = useState<BreakfastMeal[]>(() => {
    if (Array.isArray(breakfastConfig.meals) && breakfastConfig.meals.length > 0) {
      return breakfastConfig.meals;
    }
    if (Array.isArray(breakfastConfig.silogItems) && breakfastConfig.silogItems.length > 0) {
      const now = new Date().toISOString();
      // Per CFG-1 (QA pass 2026-10-21): the derived price was
      // hardcoded to `0`, but BR-08 (decision #238) deleted the
      // legacy `ratePerPersonPerNight` READ from the guest + server
      // paths. So a hotel that still had a legacy `silogItems` doc
      // and then saved Dining settings silently converted its
      // breakfast from a priced add-on into a FREE one: every
      // derived meal row was written with `price: 0`, the guest's
      // booking snapshotted a ₱0 breakfast, and the hotel collected
      // nothing for it. The admin UI showed "₱0" on every meal row,
      // which reads like a deliberate free-meal promotion rather than
      // a data-loss bug.
      //
      // The legacy `ratePerPersonPerNight` IS the per-person-per-
      // night equivalent of the new per-meal price (the legacy model
      // charged one flat rate per guest per night for whichever
      // silog they picked; the new model charges the meal's price),
      // so it is carried straight through. A legacy doc with no rate
      // at all still derives `0` — but `handleSaveBreakfast` now
      // warns about an active meal priced at ₱0 so the operator
      // sees it instead of discovering it in the revenue report.
      const legacyRate = Number(breakfastConfig.ratePerPersonPerNight);
      const derivedPrice = Number.isFinite(legacyRate) && legacyRate > 0 ? legacyRate : 0;
      return breakfastConfig.silogItems.map((item: { id: string; name: string; isActive: boolean }, index: number): BreakfastMeal => ({
        id: item.id,
        name: item.name,
        description: "",
        price: derivedPrice,
        isActive: item.isActive,
        displayOrder: index,
        createdAt: now,
        updatedAt: now
      }));
    }
    return [];
  });

  // 4b. Other Add-Ons catalog states (BR-12.1, 2026-10-15, decision #247
  //     reserved). The catalog is the `addOns/{addOnId}` collection
  //     (BR-12) and the tab CRUDs it directly through Firestore. The
  //     live snapshot is the source of truth; the local state mirrors
  //     it for instant render after a write.
  const [addOnsCatalog, setAddOnsCatalog] = useState<AddOn[]>([]);
  const [addOnsCatalogLoading, setAddOnsCatalogLoading] = useState(true);
  // Per OCT-C3 (2026-10-20, audit `plan/project/AUDIT-OCTOBER-2026.md`):
  // the `onSnapshot` error handler used to swallow the failure and
  // just clear the loading flag, so a PERMISSION_DENIED read
  // rendered the SAME "No add-ons yet" empty state as a genuinely
  // empty catalog — telling the admin to create a row that already
  // existed and that they could not read. Surface the failure.
  const [addOnsCatalogError, setAddOnsCatalogError] = useState<string | null>(null);
  const [editingAddOnId, setEditingAddOnId] = useState<string | null>(null);
  const [editingAddOnDraft, setEditingAddOnDraft] = useState<AddOn | null>(null);
  // Per OCT-M1 (2026-10-20, decision #295): the hotel-wide
  // "Add-ons enabled" master switch.
  //
  // This used to be a bare `useState(true)` — no Firestore read, no
  // write, no localStorage mirror — while the copy under it claimed
  // that turning it off would empty every `getEnabledAddOnsByHotel`
  // call. An admin who flipped it believed other add-ons were off
  // sale while guests kept buying the airport transfer.
  //
  // It is now REAL: the value persists to
  // `settings/hotelConfig.otherAddOnsEnabled` and the public
  // `/api/bookings/addons/config` endpoint reads it, so "off" means
  // the guest-facing catalog is genuinely empty.
  const [addOnsEnabled, setAddOnsEnabled] = useState(
    normalizeOtherAddOnsEnabled(hotelConfig.otherAddOnsEnabled)
  );
  // Per OCT-M1: the sync guard for the switch above. Mirrors the
  // OCT-H3 (decision #282) pattern used by the Booking & Holds
  // inputs — `useState`'s lazy initializer only runs on the FIRST
  // render, which is BEFORE the Firestore snapshot lands, so a
  // direct load of `/settings` would show the pre-snapshot default
  // instead of the stored value. The ref records the last SEEN
  // snapshot value so a snapshot that arrives while the admin is
  // mid-toggle cannot clobber the in-progress change.
  const addOnsEnabledSyncRef = useRef<boolean | null>(null);
  const [confirmDeleteAddOn, setConfirmDeleteAddOn] = useState<AddOn | null>(null);
  const [addOnSaveStatus, setAddOnSaveStatus] = useState<SettingsSaveStatus>("idle");
  const [addOnSaveError, setAddOnSaveError] = useState<string | null>(null);

  // Per OCT-M1 (decision #295): re-sync the master switch from the
  // live `settings/hotelConfig` snapshot. Only a GENUINE change in
  // the SOURCE value lands, so a snapshot that arrives while the
  // admin is mid-toggle cannot clobber the in-progress change.
  useEffect(() => {
    const next = normalizeOtherAddOnsEnabled(hotelConfig.otherAddOnsEnabled);
    const prev = addOnsEnabledSyncRef.current;
    addOnsEnabledSyncRef.current = next;
    // First run: the snapshot has not landed yet, so this is the
    // pre-snapshot default the `useState` initializer already used.
    // Record it WITHOUT touching the state so the real snapshot is
    // treated as a genuine change.
    if (prev === null) return;
    if (prev !== next) setAddOnsEnabled(next);
  }, [hotelConfig.otherAddOnsEnabled]);

  // Live snapshot of the `addOns` collection — the
  // source of truth. The tab mutates this directly via
  // `setDoc` / `deleteDoc` (no separate admin route; the
  // BR-12 brief routes everything through the existing
  // catch-all dispatcher + the public config endpoint).
  useEffect(() => {
    const q = query(collection(db, "addOns"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: AddOn[] = [];
        snap.forEach((d) => {
          const raw = { id: d.id, ...d.data() } as any;
          // Defensive normalization — never trust the
          // raw doc shape because a hand-written doc
          // could carry a corrupt `unit` or a missing
          // `isEnabled`. The shared `AddOnSchema`
          // would be ideal but parsing every doc is
          // expensive on the admin-tab load path;
          // instead we re-use the lenient validation
          // rules from `AddOnSchema` and drop rows
          // that fail the `id` / `name` invariants.
          if (!raw || typeof raw !== "object") return;
          const id = String(raw.id || d.id || "").trim();
          const name = String(raw.name || "").trim();
          if (!id || !name) return;
          rows.push({
            id,
            name,
            description: String(raw.description || "").trim().slice(0, 500),
            price: Math.max(0, Number(raw.price) || 0),
            unit: raw.unit === "per-stay" ? "per-stay" : "per-person",
            isEnabled: raw.isEnabled !== false,
            cutoffHoursBeforeCheckIn: Math.max(
              0,
              Math.min(168, Math.floor(Number(raw.cutoffHoursBeforeCheckIn) || 24))
            ),
            displayOrder: Math.floor(Number(raw.displayOrder) || 0),
            updatedAt: raw.updatedAt || new Date().toISOString(),
            updatedBy: String(raw.updatedBy || "")
          });
        });
        rows.sort((a, b) => {
          if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
          return a.name.localeCompare(b.name);
        });
        setAddOnsCatalog(rows);
        setAddOnsCatalogLoading(false);
        setAddOnsCatalogError(null);
      },
      (err) => {
        setAddOnsCatalogLoading(false);
        setAddOnsCatalogError(
          err?.message
            ? `Could not load the other add-ons catalog: ${err.message}`
            : "Could not load the other add-ons catalog."
        );
      }
    );
    return () => unsub();
  }, []);

  // Per BR-12.1: pre-seed the catalog with the
  // "Airport transfer" row on first visit if the
  // collection is empty. The seed is best-effort:
  // a failed write is logged + swallowed so a
  // permission-denied edge case doesn't crash the
  // tab. The check is reactive (re-runs on every
  // snapshot) but the write only fires once because
  // `getDocs(addOns).empty` is the gate.
  useEffect(() => {
    if (addOnsCatalogLoading) return;
    if (addOnsCatalog.length > 0) return;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "addOns")));
        if (!snap.empty) return;
        const now = new Date().toISOString();
        const seed = {
          ...AIRPORT_TRANSFER_PRESEED,
          updatedAt: now,
          updatedBy: currentUser?.uid || "seed"
        };
        await setDoc(doc(db, "addOns", "airport-transfer"), seed);
      } catch (err) {
        // The pre-seed is best-effort. A failure
        // here is non-blocking — the admin can
        // add the row manually via "Add add-on".
        // eslint-disable-next-line no-console
        console.warn("addOns pre-seed failed", err);
      }
    })();
  }, [addOnsCatalogLoading, addOnsCatalog.length, currentUser?.uid]);

  // Audit-log writer for catalog CRUD. Every
  // add/edit/delete writes one row to the top-level
  // `auditLogs/{auditId}` collection with the
  // BR-12.1 action set
  // (`addons.create` | `addons.update` | `addons.delete`).
  //
  // Per the October 2026 audit closeout (2026-10-20): this comment
  // previously claimed "The Reports late-change metric reads the same
  // collection (via collectionGroup on a top-level
  // `targetCollection: "addOns"` filter)". That was wrong — there is
  // NO `auditLogs` read anywhere in the admin app. The Reports →
  // Sales → Add-Ons sub-tab's late-change metric reads the per-booking
  // `otherAddOnAudit` subcollection (`collectionGroup(db,
  // "otherAddOnAudit")`, `ReportsPage.tsx:520`), which is the
  // PER-BOOKING op trail, not the catalog trail.
  //
  // So `auditLogs` is a write-only trail as far as the product is
  // concerned: the rows are written (and are admin-readable per the
  // rules), but no screen reads them. The catalog rows here are the
  // source of truth for "who changed the catalog"; the per-booking
  // audit trail is the source of truth for "who changed this
  // booking's add-ons".
  const writeAddOnAuditLog = async (input: {
    action: "addons.create" | "addons.update" | "addons.delete";
    targetId: string;
    before: AddOn | null;
    after: AddOn | null;
  }) => {
    try {
      await addDoc(collection(db, "auditLogs"), {
        action: input.action,
        targetCollection: "addOns",
        targetId: input.targetId,
        actor: currentUser?.uid || "staff",
        actorName: currentUser?.displayName || currentUser?.email || "staff",
        before: input.before,
        after: input.after,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      // Audit log is a side-effect of the save —
      // a failed log entry must not roll back the
      // primary write. Log + swallow so the
      // operator still sees the success toast.
      // eslint-disable-next-line no-console
      console.warn("auditLogs write failed", err);
    }
  };

  // CRUD: create / update an add-on. The id is
  // generated from the name (kebab-cased) so the
  // admin doesn't have to type an id. If the id
  // already exists (edit mode) the call updates
  // in place. New rows are seeded with the
  // `updatedAt` / `updatedBy` audit fields.
  const handleSaveAddOn = async (row: AddOn) => {
    setAddOnSaveStatus("saving");
    setAddOnSaveError(null);
    const existing = addOnsCatalog.find((a) => a.id === row.id) || null;
    const validated = AddOnSchema.safeParse({
      ...row,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.uid || "staff"
    });
    if (!validated.success) {
      setAddOnSaveStatus("error");
      setAddOnSaveError(validated.error.issues[0]?.message || "Invalid add-on payload.");
      return;
    }
    try {
      await setDoc(
        doc(db, "addOns", row.id),
        {
          ...validated.data,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid || "staff"
        },
        { merge: true }
      );
      await writeAddOnAuditLog({
        action: existing ? "addons.update" : "addons.create",
        targetId: row.id,
        before: existing,
        after: { ...validated.data, id: row.id } as AddOn
      });
      setAddOnSaveStatus("saved");
      setEditingAddOnId(null);
      setEditingAddOnDraft(null);
      setTimeout(() => setAddOnSaveStatus("idle"), 1200);
    } catch (err: any) {
      setAddOnSaveStatus("error");
      setAddOnSaveError(err?.message || "Failed to save add-on.");
    }
  };

  // Per-add-on enabled toggle. The brief says
  // "no save button" — the per-add-on `isEnabled`
  // toggle writes immediately on click. The
  // write goes through `setDoc({ merge: true })`
  // so the rest of the row stays untouched.
  const handleToggleAddOnEnabled = async (row: AddOn, next: boolean) => {
    const before = row;
    const after: AddOn = { ...row, isEnabled: next };
    // Optimistic local update so the toggle
    // feels instant; the snapshot subscriber
    // reconciles in a few hundred ms.
    setAddOnsCatalog((p) =>
      p.map((a) => (a.id === row.id ? after : a))
    );
    try {
      await setDoc(
        doc(db, "addOns", row.id),
        { isEnabled: next, updatedAt: serverTimestamp(), updatedBy: currentUser?.uid || "staff" },
        { merge: true }
      );
      await writeAddOnAuditLog({
        action: "addons.update",
        targetId: row.id,
        before,
        after
      });
    } catch (err) {
      // Revert on failure so the UI doesn't drift
      // from the source of truth.
      setAddOnsCatalog((p) =>
        p.map((a) => (a.id === row.id ? before : a))
      );
      // eslint-disable-next-line no-console
      console.warn("toggle add-on enabled failed", err);
    }
  };

  // Delete: confirmation modal → `deleteDoc` +
  // audit log. The `confirmDeleteAddOn` state
  // holds the row pending confirmation.
  const handleConfirmDeleteAddOn = async () => {
    if (!confirmDeleteAddOn) return;
    const target = confirmDeleteAddOn;
    try {
      await deleteDoc(doc(db, "addOns", target.id));
      await writeAddOnAuditLog({
        action: "addons.delete",
        targetId: target.id,
        before: target,
        after: null
      });
      setConfirmDeleteAddOn(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("delete add-on failed", err);
    }
  };

  // 5. Store Config states
  const [storeEnabled, setStoreEnabled] = useState(storeConfig.isEnabled);
  const [lowStockThreshold, setLowStockThreshold] = useState(String(storeConfig.lowStockThreshold));
  const [editingStoreItemId, setEditingStoreItemId] = useState<string | null>(null);
  const [pendingDeleteStoreItemId, setPendingDeleteStoreItemId] = useState<string | null>(null);
  // Per RTS-05 (2026-08-01): the room-type delete now uses a proper
  // Modal + ConfirmForm (matching the RoomsPage delete flow) instead
  // of a 3-second auto-disarm "Click to confirm" button — the old
  // pattern could be re-armed indefinitely by a hesitant click and
  // therefore never delete anything.
  const [pendingDeleteRoomType, setPendingDeleteRoomType] = useState<RoomTypeEntry | null>(null);
  const [isDeletingRoomType, setIsDeletingRoomType] = useState(false);

  // Email preview states
  const [previewingTemplate, setPreviewingTemplate] = useState<string | null>(null);
  const [previewingLabel, setPreviewingLabel] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Environment Testing (ETR)
  const [newRunName, setNewRunName] = useState("");
  const [newRunEnv, setNewRunEnv] = useState<"staging" | "production">("staging");
  const [newRunDuration, setNewRunDuration] = useState(60);
  const [confirmDeleteRun, setConfirmDeleteRun] = useState<TestRun | null>(null);

  // Staging Reset (ETR-S)
  const [stagingResetPreview, setStagingResetPreview] = useState<any>(null);
  const [stagingResetLoading, setStagingResetLoading] = useState(false);
  const [stagingResetConfirmText, setStagingResetConfirmText] = useState("");
  const [stagingResetProjectName, setStagingResetProjectName] = useState("");
  const [showStagingResetModal, setShowStagingResetModal] = useState(false);

  // Staging Refresh (ETR-R): the
  // "Refresh Staging From Production"
  // section. The 5-gate state for the
  // unsanitized-diagnostic mode + the
  // scope manifest + the preview
  // result.
  const [refreshMode, setRefreshMode] = useState<"sanitized-snapshot" | "config-only" | "unsanitized-diagnostic">("sanitized-snapshot");
  const [refreshDpoApproval, setRefreshDpoApproval] = useState("");
  const [refreshDefectReference, setRefreshDefectReference] = useState("");
  const [refreshProjectConfirmation, setRefreshProjectConfirmation] = useState("");
  const [refreshAcknowledged, setRefreshAcknowledged] = useState(false);
  const [refreshScopeBookingIds, setRefreshScopeBookingIds] = useState("");
  const [refreshScopeMemberIds, setRefreshScopeMemberIds] = useState("");
  const [refreshTtlHours, setRefreshTtlHours] = useState(24);
  const [refreshSensitiveFileOptIn, setRefreshSensitiveFileOptIn] = useState(false);
  const [refreshPreview, setRefreshPreview] = useState<any>(null);
  const [refreshSnapshotId, setRefreshSnapshotId] = useState<string | null>(null);
  const [refreshLoading, setRefreshLoading] = useState<"preview" | "import" | "destroy" | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [showDestroyConfirm, setShowDestroyConfirm] = useState(false);
  const [destroyConfirmText, setDestroyConfirmText] = useState("");
  const [refreshExportJson, setRefreshExportJson] = useState<string>("");

  // Per BR-02 (decision #231, 2026-10-12, breakfast redesign):
  // the legacy `isBreakfastItemModalOpen` / `editingSilogItem` /
  // `breakfastItemNameInput` CRUD modal was replaced by the inline
  // meals table on the Breakfast & Dining tab. The modal would
  // surface as unused-state warnings; deleted as part of the
  // shape migration. New meal adds now open an inline edit row
  // (see `handleAddBreakfastMeal` below).

  useEffect(() => {
    if (!pendingDeleteStoreItemId) return;
    const timer = setTimeout(() => setPendingDeleteStoreItemId(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDeleteStoreItemId]);
  // Per RTS-05 (2026-08-01): no more 3-second auto-disarm timer on the
  // room-type delete — the confirm now lives in a Modal + ConfirmForm
  // (matching the RoomsPage delete flow). The Modal's `onClose` cancels
  // the pending delete; the ConfirmForm's `onCancel` does the same.

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
  const [storeItemPhotoFile, setStoreItemPhotoFile] = useState<File | null>(null);
  const [storeItemPhotoStatus, setStoreItemPhotoStatus] = useState("");

  // 6. Intercom Config states
  const [intercomQuickRequests, setIntercomQuickRequests] = useState<string[]>(
    Array.isArray(hotelConfig.intercomQuickRequests) ? hotelConfig.intercomQuickRequests : []
  );
  const [notificationSoundUrl, setNotificationSoundUrl] = useState(hotelConfig.notificationSoundUrl || "");

  // 7. Legal Content states
  const [privacyPolicyBody, setPrivacyPolicyBody] = useState(websiteContent.privacyPolicyBody || "");
  const [cancellationPolicy, setCancellationPolicy] = useState(websiteContent.cancellationPolicy || "");
  const [cancellationCutoffHours, setCancellationCutoffHours] = useState<string>(
    websiteContent.cancellationCutoffHours !== undefined ? String(websiteContent.cancellationCutoffHours) : "48"
  );
  const [cancellationRefundPctBefore, setCancellationRefundPctBefore] = useState<string>(
    websiteContent.cancellationRefundPctBefore !== undefined ? String(websiteContent.cancellationRefundPctBefore) : "100"
  );
  const [cancellationRefundPctAfter, setCancellationRefundPctAfter] = useState<string>(
    websiteContent.cancellationRefundPctAfter !== undefined ? String(websiteContent.cancellationRefundPctAfter) : "0"
  );
  const [houseRules, setHouseRules] = useState(websiteContent.houseRules || "");
  // Per LCE-01 (decision #137, 2026-07-25): the Terms of
  // Service body + version + last-updated are now admin-
  // editable. The version is server-bumped on every save
  // (1.0.0 → 1.0.1) — the local `termsVersion` state is a
  // display mirror of the persisted value, populated from
  // the Firestore snapshot. The `termsLastUpdated` is set
  // by the server (the audit trail of when this version
  // went live).
  const [termsBody, setTermsBody] = useState(websiteContent.termsBody || "");
  const [termsVersion, setTermsVersion] = useState(websiteContent.termsVersion || "");
  const [termsLastUpdated, setTermsLastUpdated] = useState(websiteContent.termsLastUpdated || config.termsLastUpdated || "");
  const [termsSavedAt, setTermsSavedAt] = useState<{ version: string; lastUpdated: string } | null>(null);
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

  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editStaffName, setEditStaffName] = useState("");
  const [editStaffEmail, setEditStaffEmail] = useState("");
  const [editStaffPhone, setEditStaffPhone] = useState("");
  const [editStaffRole, setEditStaffRole] = useState<"front-desk" | "admin">("front-desk");
  const [editStaffPassword, setEditStaffPassword] = useState("");
  const [isUpdatingStaff, setIsUpdatingStaff] = useState(false);
  const [editStaffFormMessage, setEditStaffFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSendingResetEmail, setIsSendingResetEmail] = useState(false);

  useEffect(() => {
    setStoreEnabled(storeConfig.isEnabled !== false);
    setLowStockThreshold(String(storeConfig.lowStockThreshold ?? 3));
    setIntercomQuickRequests(Array.isArray(hotelConfig.intercomQuickRequests) ? hotelConfig.intercomQuickRequests : []);
    setNotificationSoundUrl(hotelConfig.notificationSoundUrl || "");
    setPrivacyPolicyBody(websiteContent.privacyPolicyBody || "");
    setCancellationPolicy(websiteContent.cancellationPolicy || "");
    setCancellationCutoffHours(
      websiteContent.cancellationCutoffHours !== undefined ? String(websiteContent.cancellationCutoffHours) : "48"
    );
    setCancellationRefundPctBefore(
      websiteContent.cancellationRefundPctBefore !== undefined ? String(websiteContent.cancellationRefundPctBefore) : "100"
    );
    setCancellationRefundPctAfter(
      websiteContent.cancellationRefundPctAfter !== undefined ? String(websiteContent.cancellationRefundPctAfter) : "0"
    );
    setHouseRules(websiteContent.houseRules || "");
    // Per LCE-01: hydrate the terms fields when the websiteContent
    // snapshot arrives (the useEffect fires on every snapshot
    // because the Firestore `onSnapshot` is the source of truth).
    setTermsBody(websiteContent.termsBody || "");
    setTermsVersion(websiteContent.termsVersion || "");
    setTermsLastUpdated(websiteContent.termsLastUpdated || config.termsLastUpdated || "");
    setPrivacyPolicyLastUpdated(websiteContent.privacyPolicyLastUpdated || config.privacyPolicyLastUpdated || "");
    setPointsEnabled(rewardsConfig.pointsEnabled !== false);
    setEarningMode(rewardsConfig.earningMode === "per-booking" ? "per-booking" : "per-spend");
    setPointsPerBooking(String(rewardsConfig.pointsPerBooking ?? 50));
    setPointsPerHundred(String(rewardsConfig.pointsPerHundred ?? 10));
    setPointsRedemptionRate(String(rewardsConfig.pointsRedemptionRate ?? 100));
    setMemberDiscountEnabled(rewardsConfig.memberDiscountEnabled !== false);
    setMemberDiscountPct(String(rewardsConfig.memberDiscountPct ?? 10));
    // Per EC-02 (2026-08-21): rehydrate the early-check-in
    // toggle alongside the other Rewards-tab fields when the
    // `useEffect` fires after a snapshot update. Default to
    // true when absent so pre-EC-02 deployments keep the perk
    // on until the admin explicitly turns it off.
    setEarlyCheckInEnabled(rewardsConfig.earlyCheckInEnabled !== false);
    setAllowMemberPointsRedemption(rewardsConfig.allowMemberPointsRedemption === true);
    // Phase 2 rehydrate — match the initial-state defaults above
    // (welcomePoints=0, minPointsToRedeem=0, pointsCanPayUpToBillPct=100,
    // freeNightEvery=0, levels=[]) so the form never renders
    // stale or undefined values when the snapshot updates mid-edit.
    setWelcomePoints(String(rewardsConfig.welcomePoints ?? 0));
    setMinPointsToRedeem(String(rewardsConfig.minPointsToRedeem ?? 0));
    setPointsCanPayUpToBillPct(String(rewardsConfig.pointsCanPayUpToBillPct ?? 100));
    setFreeNightEvery(String(rewardsConfig.freeNightEvery ?? 0));
    setLevels(Array.isArray(rewardsConfig.levels) ? rewardsConfig.levels : []);
    setHomepageHeroEyebrow(websiteContent.homepage?.heroEyebrow || "");
    setHomepageHeroHeading(websiteContent.homepage?.heroHeading || "");
    setHomepageHeroSubtext(websiteContent.homepage?.heroSubtext || "");
    setAboutHeroEyebrow(websiteContent.about?.heroEyebrow || "");
    setAboutHeroHeading(websiteContent.about?.heroHeading || "");
    setAboutHeroSubtext(websiteContent.about?.heroSubtext || "");
    // Per `feat/corporate-content-editable` — the four corporate
    // hero fields are pre-populated from the shared
    // `DEFAULT_CORPORATE_PAGE_CONTENT` constant when the Firestore
    // value is empty, so the editor inputs show the current text
    // instead of blank fields. Same source of truth as the guest
    // app's `||` fallback in `CorporateStaysPage` and the one-time
    // Firestore backfill in `AdminContext`.
    setCorporateHeroEyebrow(websiteContent.corporate?.heroEyebrow || DEFAULT_CORPORATE_PAGE_CONTENT.hero.eyebrow);
    setCorporateHeroHeading(websiteContent.corporate?.heroHeading || DEFAULT_CORPORATE_PAGE_CONTENT.hero.heading);
    setCorporateHeroSubtext(websiteContent.corporate?.heroSubtext || DEFAULT_CORPORATE_PAGE_CONTENT.hero.subtext);
    setRewardsHeroEyebrow(websiteContent.rewards?.heroEyebrow || "");
    setRewardsHeroHeading(websiteContent.rewards?.heroHeading || "");
    setRewardsHeroSubtext(websiteContent.rewards?.heroSubtext || "");
    setHomepageAmenities(websiteContent.homepage?.amenities || []);
    setHomepageServices(websiteContent.homepage?.services || []);
    setHomepageFeaturedTypeValues(websiteContent.homepage?.featuredTypeValues || []);
    setSparkRewardsEnabled(websiteContent.homepage?.sparkRewards?.isEnabled !== false);
    setSparkRewardsHeading(websiteContent.homepage?.sparkRewards?.heading || "");
    setSparkRewardsDescription(websiteContent.homepage?.sparkRewards?.description || "");
    setSparkRewardsPerks(websiteContent.homepage?.sparkRewards?.perks || []);
    setCorporatePerks(websiteContent.corporate?.perks || []);
    // Per `feat/corporate-content-editable` — the six new
    // corporate page fields are pre-populated from
    // `DEFAULT_CORPORATE_PAGE_CONTENT` when the Firestore value
    // is empty, mirroring the same pattern as the corporate hero
    // fields above and the one-time Firestore backfill in
    // `AdminContext`.
    setCorporateRoomsOverviewEyebrow(
      websiteContent.corporate?.roomsOverviewEyebrow || DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.eyebrow
    );
    setCorporateRoomsOverviewHeading(
      websiteContent.corporate?.roomsOverviewHeading || DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.heading
    );
    setCorporateRoomsOverviewDescription(
      websiteContent.corporate?.roomsOverviewDescription || DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.description
    );
    setCorporateRetreatHeading(
      websiteContent.corporate?.retreatHeading || DEFAULT_CORPORATE_PAGE_CONTENT.retreat.heading
    );
    setCorporateRetreatDescription(
      websiteContent.corporate?.retreatDescription || DEFAULT_CORPORATE_PAGE_CONTENT.retreat.description
    );
    setCorporateRetreatCtaLabel(
      websiteContent.corporate?.retreatCtaLabel || DEFAULT_CORPORATE_PAGE_CONTENT.retreat.ctaLabel
    );
    setAboutMissionStatement(websiteContent.about?.missionStatement || "");
    setAboutVisionStatement(websiteContent.about?.visionStatement || "");
    setAboutHotelStory(websiteContent.about?.hotelStory || "");

    // Sync Rooms Catalog, Contact, and Not Found page copy
    setRoomsCatalogHeroEyebrow(websiteContent.roomsCatalog?.heroEyebrow || "");
    setRoomsCatalogHeroHeading(websiteContent.roomsCatalog?.heroHeading || "");
    setRoomsCatalogHeroSubtext(websiteContent.roomsCatalog?.heroSubtext || "");
    setContactHeroEyebrow(websiteContent.contact?.heroEyebrow || "");
    setContactHeroHeading(websiteContent.contact?.heroHeading || "");
    setContactHeroSubtext(websiteContent.contact?.heroSubtext || "");
    setNotFoundHeroEyebrow(websiteContent.notFound?.heroEyebrow || "");
    setNotFoundHeroHeading(websiteContent.notFound?.heroHeading || "");
    setNotFoundHeroSubtext(websiteContent.notFound?.heroSubtext || "");

    // Sync Homepage Section Headers
    setRoomsEyebrow(websiteContent.homepage?.sectionHeaders?.roomsEyebrow || "");
    setRoomsHeading(websiteContent.homepage?.sectionHeaders?.roomsHeading || "");
    setRoomsSubtext(websiteContent.homepage?.sectionHeaders?.roomsSubtext || "");
    setAmenitiesEyebrow(websiteContent.homepage?.sectionHeaders?.amenitiesEyebrow || "");
    setAmenitiesHeading(websiteContent.homepage?.sectionHeaders?.amenitiesHeading || "");
    setAmenitiesSubtext(websiteContent.homepage?.sectionHeaders?.amenitiesSubtext || "");
    setServicesEyebrow(websiteContent.homepage?.sectionHeaders?.servicesEyebrow || "");
    setServicesHeading(websiteContent.homepage?.sectionHeaders?.servicesHeading || "");
    setServicesSubtext(websiteContent.homepage?.sectionHeaders?.servicesSubtext || "");

    // Sync Hotel Info (Hotel Profile) states
    setCheckInTime(hotelConfig.checkInTime || "");
    setCheckOutTime(hotelConfig.checkOutTime || "");
    setFrontDeskPhone(hotelConfig.frontDeskPhone || "");
    setSupportEmail(hotelConfig.supportEmail || "");
    setDpoEmail(hotelConfig.dpoEmail || "");
    setFacebookUrl(hotelConfig.facebookUrl || "");
    setInstagramUrl(hotelConfig.instagramUrl || "");
    setSeoMetaDescription(seoSettings.draft?.metaDescription || config.metaDescription);
    setSeoPriceRange(seoSettings.draft?.priceRange || config.priceRange);
    setSeoOgImage(normalizeSeoImageOverride(seoSettings.draft?.ogImage));
    setTwitterHandle(hotelConfig.twitterHandle ?? config.twitterHandle);
    // Per DSC-01..05 (2026-08-01, per CVQ-06): sync the
    // discount scope from the latest snapshot (already
    // normalized in AdminContext).
    setDiscountScope(hotelConfig.discountScope);

    // Per VAT-01 (2026-10-12): sync the local toggle from the
    // latest hotelConfig snapshot (already normalized to
    // `{ enabled: boolean }` by AdminContext).
    setVatEnabled(isVatEnabled(hotelConfig.vatConfig));

    // Safely format address: if it's a seeded object, convert to single-line string.
    let addrStr = "";
    if (hotelConfig.address) {
      if (typeof hotelConfig.address === "string") {
        addrStr = hotelConfig.address;
      } else if (typeof hotelConfig.address === "object") {
        const addr = hotelConfig.address as any;
        addrStr = [addr.street, addr.city, addr.region, addr.postalCode].filter(Boolean).join(", ");
      }
    }
    setAddress(addrStr);
  }, [storeConfig, hotelConfig, websiteContent, rewardsConfig, seoSettings]);

  // Environment Testing handlers (ETR)
  const handleCreateRun = async () => {
    if (!newRunName.trim()) return;
    const result = await createTestRun({
      name: newRunName.trim(),
      environment: newRunEnv,
      durationMinutes: newRunDuration
    });
    if (result.success) {
      toast.success("Test run created", "Admin SDK service account is required for server route.");
      setNewRunName("");
    } else {
      toast.error("Failed to create test run", result.error || "Unknown error");
    }
  };

  const handleCloseRun = async (runId: string) => {
    const result = await closeTestRun(runId);
    if (result.success) {
      toast.success("Test run closed", "Closing generated the manifest. Review it before cleanup.");
    } else {
      toast.error("Failed to close test run", result.error || "Unknown error");
    }
  };

  const handleConfirmCleanup = async () => {
    if (!confirmDeleteRun) return;
    const result = await deleteTestRun(confirmDeleteRun.id);
    if (result.success) {
      toast.success("Cleanup completed", "Test data has been removed.");
    } else {
      toast.error("Failed to clean up", result.error || "Unknown error");
    }
    setConfirmDeleteRun(null);
  };

  // Staging Reset handlers (ETR-S)
  const handleStagingResetPreview = async () => {
    try {
      setStagingResetLoading(true);
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/staging-reset-preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStagingResetPreview(data.data);
        setShowStagingResetModal(true);
      } else {
        toast.error("Staging reset unavailable", data.error || "This project is not authorized for reset.");
      }
    } catch (err: any) {
      toast.error("Failed to preview", err?.message || "Could not reach server.");
    } finally {
      setStagingResetLoading(false);
    }
  };

  // Staging Refresh handlers (ETR-R).
  // The 3-step flow: preview → import
  // → destroy. The preview returns a
  // snapshotId + the sanitizedExport;
  // the import writes it to staging;
  // the destroy reverses the import.
  // Per the spec at
  // `plan/features/ENVIRONMENT-TEST-RESET.md`:
  // the sanitized mode requires no
  // gates; the unsanitized-diagnostic
  // mode requires 5 server-enforced
  // gates (D01..D05) + a scope
  // manifest (D03) + a sensitive-file
  // opt-in (D04).
  const handleRefreshPreview = async () => {
    setRefreshError(null);
    // Parse the export JSON. The
    // operator pastes in the JSON they
    // exported from production
    // (via the `scripts/export-prod-data.mjs`
    // script or equivalent).
    let exportPayload: any;
    try {
      exportPayload = JSON.parse(refreshExportJson);
    } catch (err: any) {
      setRefreshError(`Invalid export JSON: ${err?.message || "parse failed"}`);
      return;
    }
    if (!exportPayload?.export?.bookings || !exportPayload?.export?.storeOrders || !exportPayload?.export?.members) {
      setRefreshError("Export must have `export.bookings`, `export.storeOrders`, `export.members`.");
      return;
    }
    // For unsanitized mode, validate
    // the 5 gates client-side first
    // (so the user gets immediate
    // feedback; the server still
    // re-validates).
    if (refreshMode === "unsanitized-diagnostic") {
      if (!refreshDpoApproval) { setRefreshError("DPO approval reference is required for restricted mode."); return; }
      if (!refreshDefectReference) { setRefreshError("Defect reference is required for restricted mode."); return; }
      if (!refreshProjectConfirmation) { setRefreshError("Project confirmation is required for restricted mode."); return; }
      if (!refreshAcknowledged) { setRefreshError("You must acknowledge that this is real PII."); return; }
      const bookingIds = refreshScopeBookingIds.split(",").map(s => s.trim()).filter(Boolean);
      const memberIds = refreshScopeMemberIds.split(",").map(s => s.trim()).filter(Boolean);
      if (bookingIds.length === 0 && memberIds.length === 0) {
        setRefreshError("Restricted mode requires an explicit scope (at least one bookingId or memberId).");
        return;
      }
    }
    try {
      setRefreshLoading("preview");
      const token = await auth.currentUser?.getIdToken(true);
      const body: any = {
        export: exportPayload.export,
        options: {
          mode: refreshMode,
          dpoApprovalReference: refreshDpoApproval,
          defectReference: refreshDefectReference,
          projectConfirmation: refreshProjectConfirmation,
          reauthenticatedAt: new Date().toISOString(),
          acknowledgedRestrictedMode: refreshAcknowledged,
          scopeManifest: {
            bookingIds: refreshScopeBookingIds.split(",").map(s => s.trim()).filter(Boolean),
            memberIds: refreshScopeMemberIds.split(",").map(s => s.trim()).filter(Boolean)
          },
          ttlHours: refreshTtlHours,
          sensitiveFileOptIn: refreshSensitiveFileOptIn
        }
      };
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/staging-refresh-preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRefreshPreview(data.data);
        setRefreshSnapshotId(data.data.snapshotId);
        setShowRefreshModal(true);
      } else {
        if (data?.missingGates) {
          setRefreshError(`Missing gates: ${data.missingGates.join(", ")}`);
        } else {
          setRefreshError(data.error || "Preview failed.");
        }
      }
    } catch (err: any) {
      setRefreshError(err?.message || "Could not reach server.");
    } finally {
      setRefreshLoading(null);
    }
  };

  const handleRefreshImport = async () => {
    if (!refreshPreview || !refreshSnapshotId) return;
    setRefreshError(null);
    try {
      setRefreshLoading("import");
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/staging-refresh-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          snapshotId: refreshSnapshotId,
          sanitizedExport: refreshPreview.sanitizedExport
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const summary = data.data?.writeSummary;
        const parts: string[] = [];
        if (summary) {
          parts.push(`${summary.bookingsWritten} bookings`);
          parts.push(`${summary.storeOrdersWritten} store orders`);
          parts.push(`${summary.membersWritten} members`);
          if (summary.bookingsDropped) parts.push(`(${summary.bookingsDropped} dropped by scope)`);
          if (summary.membersDropped) parts.push(`(${summary.membersDropped} members dropped)`);
        }
        toast.success("Refresh imported", parts.join(", ") || "Import complete.");
        setShowRefreshModal(false);
        setRefreshPreview(null);
        setRefreshSnapshotId(null);
      } else {
        setRefreshError(data.error || "Import failed.");
      }
    } catch (err: any) {
      setRefreshError(err?.message || "Could not reach server.");
    } finally {
      setRefreshLoading(null);
    }
  };

  const handleRefreshDestroy = async () => {
    if (!refreshSnapshotId) return;
    setRefreshError(null);
    try {
      setRefreshLoading("destroy");
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/staging-refresh-destroy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ snapshotId: refreshSnapshotId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const dd = data.data;
        toast.success("Snapshot destroyed", `${dd.deletedBookings || 0} bookings + ${dd.deletedStoreOrders || 0} orders + ${dd.deletedMembers || 0} members removed.`);
        setShowDestroyConfirm(false);
        setShowRefreshModal(false);
        setRefreshPreview(null);
        setRefreshSnapshotId(null);
        setDestroyConfirmText("");
      } else {
        setRefreshError(data.error || "Destroy failed.");
      }
    } catch (err: any) {
      setRefreshError(err?.message || "Could not reach server.");
    } finally {
      setRefreshLoading(null);
    }
  };

  const handleStagingResetExecute = async () => {
    try {
      setStagingResetLoading(true);
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/test-runs/staging-reset-execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          confirmation: stagingResetConfirmText,
          projectName: stagingResetProjectName,
          previewId: stagingResetPreview?.previewId
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Staging reset complete", `${data.data.bookingsDeleted} bookings, ${data.data.storeOrdersDeleted} orders removed.`);
        setShowStagingResetModal(false);
        setStagingResetPreview(null);
        setStagingResetConfirmText("");
        setStagingResetProjectName("");
        refreshTestRuns();
      } else {
        toast.error("Reset failed", data.error || "Could not execute staging reset.");
      }
    } catch (err: any) {
      toast.error("Reset failed", err?.message || "Could not reach server.");
    } finally {
      setStagingResetLoading(false);
    }
  };

  // Handle Form submissions
  const handleSaveHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    const published = seoSettings.published;
    const sources = getSeoSourceValues();
    const affectsPublishedSeo = !published
      || published.address !== sources.address
      || published.frontDeskPhone !== sources.frontDeskPhone
      || published.facebookUrl !== sources.facebookUrl
      || published.instagramUrl !== sources.instagramUrl
      || published.twitterHandle !== sources.twitterHandle
      || published.checkInTime !== sources.checkInTime
      || published.checkOutTime !== sources.checkOutTime;
    await runSettingsSave(
      "hotel",
      "Hotel profile saved",
      async () => {
        const saved = await updateSettings("hotelConfig", {
          address,
          frontDeskPhone,
          supportEmail,
          dpoEmail,
          facebookUrl,
          instagramUrl,
          twitterHandle,
          checkInTime,
          checkOutTime
        });
        if (!saved) return false;

        if (!affectsPublishedSeo) return true;
        return updateSettings("seo", { sourceChangesPending: true });
      },
      affectsPublishedSeo
        ? "Public details are live. SEO has changes pending—open SEO & Search and publish when ready."
        : "Changes saved and are live now."
    );
  };

  // Per QA-2026-10-23 §3.2 (2026-10-25): the hotel-wide
  // bot-protection mode, edited from the Settings → Environment Testing
  // tab. Mirrors the OCT-M1 master switch on the Other Add-Ons tab —
  // local state, a sync guard, revert-on-failure and a save error
  // message.
  //
  // The sync guard has the same job as `addOnsEnabledSyncRef`: the
  // `useState` initializer only runs on the FIRST render, which is
  // BEFORE the Firestore snapshot lands, so the ref records the last
  // SEEN snapshot value. A snapshot that arrives while the admin is
  // mid-toggle cannot clobber the in-progress change.
  const botProtectionSyncRef = useRef<string | null>(null);
  const [botProtectionMode, setBotProtectionMode] = useState<BotProtectionMode>(
    BOT_PROTECTION_MODE_DEFAULT
  );
  const [botProtectionReason, setBotProtectionReason] = useState("");
  const [botProtectionSaveError, setBotProtectionSaveError] = useState<string | null>(null);
  // The audit trail of the CURRENT disabled window: who turned the gate
  // off, when, and why. Mirrored locally so the banner can show the
  // reason the moment the write succeeds, before the Firestore
  // snapshot comes back.
  const [botProtectionAudit, setBotProtectionAudit] = useState<{
    by: string;
    at: string;
    reason: string;
  }>({ by: "", at: "", reason: "" });

  // Re-sync the mode + audit trail from the live `settings/hotelConfig`
  // snapshot. Only a GENUINE change in the SOURCE value lands, so a
  // snapshot that arrives while the admin is mid-toggle cannot clobber
  // the in-progress change.
  useEffect(() => {
    const nextMode = normalizeBotProtectionMode(hotelConfig.botProtectionMode);
    const nextAudit = {
      by: String(hotelConfig.botProtectionDisabledBy || ""),
      at: String(hotelConfig.botProtectionDisabledAt || ""),
      reason: String(hotelConfig.botProtectionReason || "")
    };
    const signature = `${nextMode}|${nextAudit.by}|${nextAudit.at}|${nextAudit.reason}`;
    const prev = botProtectionSyncRef.current;
    botProtectionSyncRef.current = signature;
    // First run: the snapshot has not landed yet, so this is the
    // pre-snapshot default the `useState` initializer already used.
    // Record it WITHOUT touching the state so the real snapshot is
    // treated as a genuine change.
    if (prev === null) return;
    if (prev === signature) return;
    setBotProtectionMode(nextMode);
    setBotProtectionAudit(nextAudit);
  }, [
    hotelConfig.botProtectionMode,
    hotelConfig.botProtectionDisabledBy,
    hotelConfig.botProtectionDisabledAt,
    hotelConfig.botProtectionReason
  ]);

  // Per QA-2026-10-23 §3.2 (2026-10-25): switch the hotel-wide bot
  // protection mode.
  //
  // Turning the gate OFF is a deliberate, audited act: it needs a
  // reason, and it records WHO turned it off and WHEN. Turning it back
  // ON clears the audit trail — there is no longer a disabled window
  // to explain.
  //
  // The write goes through the same `updateSettings("hotelConfig", …)`
  // channel every other hotel-wide setting uses, and a failed write is
  // reverted so the switch never shows a value that is not stored.
  const handleBotProtectionToggle = async (next: BotProtectionMode) => {
    setBotProtectionSaveError(null);

    if (next === "disabled") {
      const reason = botProtectionReason.trim();
      if (!reason) {
        setBotProtectionSaveError(
          "A reason is required before bot protection can be turned off."
        );
        return;
      }
      const by = currentUser?.uid || "unknown";
      const at = new Date().toISOString();
      const saved = await updateSettings("hotelConfig", {
        botProtectionMode: "disabled",
        botProtectionDisabledBy: by,
        botProtectionDisabledAt: at,
        botProtectionReason: reason
      });
      if (!saved) {
        setBotProtectionSaveError(
          "Failed to save the bot-protection mode. The previous setting is still in effect."
        );
        return;
      }
      setBotProtectionMode("disabled");
      setBotProtectionAudit({ by, at, reason });
      return;
    }

    const saved = await updateSettings("hotelConfig", {
      botProtectionMode: "turnstile",
      // `deleteField()` REMOVES the audit trail instead of writing an
      // empty value over it.
      botProtectionDisabledBy: deleteField(),
      botProtectionDisabledAt: deleteField(),
      botProtectionReason: deleteField()
    });
    if (!saved) {
      setBotProtectionSaveError(
        "Failed to save the bot-protection mode. The previous setting is still in effect."
      );
      return;
    }
    setBotProtectionMode("turnstile");
    setBotProtectionAudit({ by: "", at: "", reason: "" });
    setBotProtectionReason("");
  };

  // Who turned the gate off? The audit field stores the admin's uid;
  // the staff list resolves it to a name an admin recognises. Falls
  // back to the raw uid when that admin is no longer on the list.
  const botProtectionDisabledByName = useMemo(() => {
    const uid = botProtectionAudit.by;
    if (!uid) return "an unknown admin";
    const member = staff.find((s) => s.uid === uid);
    if (!member) return uid;
    return member.fullName || member.email || uid;
  }, [botProtectionAudit.by, staff]);

  // When was the gate turned off? The audit field stores an ISO string.
  const botProtectionDisabledAtLabel = useMemo(() => {
    const at = botProtectionAudit.at;
    if (!at) return "an unknown time";
    const parsed = new Date(at);
    if (Number.isNaN(parsed.getTime())) return at;
    return parsed.toLocaleString();
  }, [botProtectionAudit.at]);

  const seoDraft = () => ({
    metaDescription: seoMetaDescription.trim(),
    priceRange: seoPriceRange.trim(),
    ogImage: seoOgImage.trim() || DEFAULT_OG_IMAGE_URL
  });

  const getSeoSourceValues = () => ({
    address: typeof address === "string"
      ? address.trim()
      : [address?.street, address?.city, address?.region, address?.postalCode].filter(Boolean).join(", "),
    frontDeskPhone: frontDeskPhone.trim() || config.frontDeskPhone,
    facebookUrl: facebookUrl.trim(),
    instagramUrl: instagramUrl.trim(),
    twitterHandle: twitterHandle.trim(),
    checkInTime: checkInTime.trim() || config.checkInTime,
    checkOutTime: checkOutTime.trim() || config.checkOutTime
  });

  const handleSaveSeoDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSettingsSave(
      "seo",
      "SEO draft saved",
      () => updateSettings("seo", { draft: seoDraft() }),
      "Draft saved. Publish when you are ready to rebuild the public website."
    );
  };

  const handleUploadSeoImage = async (file: File): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, or WebP image.");
      const compressed = await compressImageFile(file, { maxWidth: 1200, maxHeight: 630, quality: 0.85 });
      const safeName = compressed.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileRef = storageRef(storage, `assets/seo/og-image/${Date.now()}-${safeName}`);
      await uploadBytes(fileRef, compressed.file, { contentType: compressed.file.type });
      const url = await getDownloadURL(fileRef);
      const saved = await updateSettings("seo", { draft: { ...seoDraft(), ogImage: url } });
      if (!saved) throw new Error("The image uploaded, but its SEO draft could not be saved.");
      setSeoOgImage(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Image upload failed." };
    }
  };

  const handleResetSeoImage = async (): Promise<{ success: boolean; error?: string }> => {
    const previousUrl = seoOgImage;
    const saved = await updateSettings("seo", { draft: { ...seoDraft(), ogImage: DEFAULT_OG_IMAGE_URL } });
    if (!saved) return { success: false, error: "The default image could not be restored." };
    setSeoOgImage("");
    if (previousUrl.includes("firebasestorage.googleapis.com")) {
      try {
        await deleteObject(storageRef(storage, previousUrl));
      } catch {
        // The draft already points at the safe default. An orphaned
        // object is preferable to rolling back a successful reset.
      }
    }
    return { success: true };
  };

  const handlePublishSeo = async () => {
    if (isPublishingSeo) return;
    setIsPublishingSeo(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Your session has expired. Sign in again and retry.");

      const payload = {
        ...seoDraft(),
        ...getSeoSourceValues()
      };

      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/admin/publish-seo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "SEO publishing failed.");
      toast.success("SEO publish started", "The public website is rebuilding with the published search metadata.");
    } catch (error) {
      toast.error("Could not publish SEO", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setIsPublishingSeo(false);
    }
  };

  // The Website Content tab is a stub while the list-based content
  // editors (amenities, services, featured rooms, spark rewards
  // promo) are still pending. Hero copy was moved to the Branding
  // tab in this change.

  // Persist the list-shaped homepage content (amenities, services,
  // featured rooms, Spark Rewards promo) + the corporate page
  // content (perks, rooms overview, retreat CTA) to
  // `settings/websiteContent`. Hero copy + photos are owned by the
  // Branding tab; we only touch the sub-objects this form owns and
  // leave everything else (hero copy, etc.) intact via the spread.
  const handleSaveWebsiteContent = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSettingsSave("website", "Website content saved", () => updateSettings("websiteContent", {
      homepage: {
        ...(websiteContent.homepage || {}),
        amenities: homepageAmenities,
        services: homepageServices,
        featuredTypeValues: homepageFeaturedTypeValues,
        sparkRewards: {
          ...((websiteContent.homepage?.sparkRewards as Record<string, unknown>) || {}),
          isEnabled: sparkRewardsEnabled,
          heading: sparkRewardsHeading,
          description: sparkRewardsDescription,
          perks: sparkRewardsPerks
        },
        sectionHeaders: {
          roomsEyebrow: roomsEyebrow.trim(),
          roomsHeading: roomsHeading.trim(),
          roomsSubtext: roomsSubtext.trim(),
          amenitiesEyebrow: amenitiesEyebrow.trim(),
          amenitiesHeading: amenitiesHeading.trim(),
          amenitiesSubtext: amenitiesSubtext.trim(),
          servicesEyebrow: servicesEyebrow.trim(),
          servicesHeading: servicesHeading.trim(),
          servicesSubtext: servicesSubtext.trim()
        }
      },
      corporate: {
        ...(websiteContent.corporate || {}),
        perks: corporatePerks,
        roomsOverviewEyebrow: corporateRoomsOverviewEyebrow,
        roomsOverviewHeading: corporateRoomsOverviewHeading,
        roomsOverviewDescription: corporateRoomsOverviewDescription,
        retreatHeading: corporateRetreatHeading,
        retreatDescription: corporateRetreatDescription,
        retreatCtaLabel: corporateRetreatCtaLabel
      },
      about: {
        ...(websiteContent.about || {}),
        missionStatement: aboutMissionStatement,
        visionStatement: aboutVisionStatement,
        hotelStory: aboutHotelStory
      }
    }));
  };

  // Persist all hero copy fields to `settings/websiteContent`. Logo
  // and hero-photo overrides are saved on their own (upload / reset
  // buttons) and do not flow through this form.
  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSettingsSave("branding", "Hero copy saved", () => updateSettings("websiteContent", {
      homepage: {
        ...(websiteContent.homepage || {}),
        heroEyebrow: homepageHeroEyebrow,
        heroHeading: homepageHeroHeading,
        heroSubtext: homepageHeroSubtext
      },
      about: {
        ...(websiteContent.about || {}),
        heroEyebrow: aboutHeroEyebrow,
        heroHeading: aboutHeroHeading,
        heroSubtext: aboutHeroSubtext
      },
      corporate: {
        ...(websiteContent.corporate || {}),
        heroEyebrow: corporateHeroEyebrow,
        heroHeading: corporateHeroHeading,
        heroSubtext: corporateHeroSubtext
      },
      rewards: {
        ...(websiteContent.rewards || {}),
        heroEyebrow: rewardsHeroEyebrow,
        heroHeading: rewardsHeroHeading,
        heroSubtext: rewardsHeroSubtext
      },
      roomsCatalog: {
        ...(websiteContent.roomsCatalog || {}),
        heroEyebrow: roomsCatalogHeroEyebrow,
        heroHeading: roomsCatalogHeroHeading,
        heroSubtext: roomsCatalogHeroSubtext
      },
      contact: {
        ...(websiteContent.contact || {}),
        heroEyebrow: contactHeroEyebrow,
        heroHeading: contactHeroHeading,
        heroSubtext: contactHeroSubtext
      },
      notFound: {
        ...(websiteContent.notFound || {}),
        heroEyebrow: notFoundHeroEyebrow,
        heroHeading: notFoundHeroHeading,
        heroSubtext: notFoundHeroSubtext
      }
    }));
  };

  // Per Phase 2 of the Spark Rewards tier system (2026-10-12):
// helpers for the Levels table editor. The `+ Add a level`
// button appends a sensible default tier (id from
// `crypto.randomUUID()` or a timestamp fallback, name
// "New tier", threshold one above the current max, 5% off,
// 1× points, empty perks blurb). The row-delete handler is a
// straight filter — the snap-down member migration that the
// spec describes happens at Phase 3 (member-side counters)
// and Phase 5 (free-night voucher), not in the UI handler.
const handleAddLevel = () => {
    setLevels((prev) => {
      const maxFromStays = prev.length > 0 ? Math.max(...prev.map((l) => l.fromStays)) : 0;
      const newLevel: LevelDef = {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tier_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: "New tier",
        fromStays: maxFromStays + 1,
        discountPct: 5,
        pointsMultiplier: 1,
        perks: "",
      };
      return [...prev, newLevel];
    });
  };

  const handleRemoveLevel = (id: string) => {
    setLevels((prev) => prev.filter((l) => l.id !== id));
  };

  const handleUpdateLevelField = (
    id: string,
    field: "name" | "fromStays" | "discountPct" | "pointsMultiplier" | "perks",
    raw: string
  ) => {
    setLevels((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      if (field === "name" || field === "perks") {
        return { ...l, [field]: raw };
      }
      // Numeric fields — empty string becomes 0 (matches the
      // sibling scalar inputs' `parseFloat(...) || 0` pattern).
      const parsed = field === "pointsMultiplier" ? parseFloat(raw) : parseInt(raw, 10);
      return { ...l, [field]: Number.isFinite(parsed) ? parsed : 0 };
    }));
  };

  const handleSaveRewards = async (e: React.FormEvent) => {
    e.preventDefault();
    // Per EC-02 (2026-08-21): the early-check-in toggle rides
    // on the same `updateSettings("rewardsConfig", {...})`
    // write as the other Rewards-tab fields. One save
    // persists the whole tab so the admin never sees a
    // partial update. The flag defaults to true server-side
    // (via `rewardsConfig.earlyCheckInEnabled !== false`) so a
    // missing field on the legacy doc is treated as enabled.
    //
    // Per Phase 2 (2026-10-12): the payload now also carries
    // the six new scalars + the levels array. Client-side
    // Zod validation runs first as a UX guard (the API also
    // re-validates as defense-in-depth — Hard Rule #1).
    const candidate = {
      pointsEnabled,
      earningMode,
      pointsPerBooking: parseFloat(pointsPerBooking) || 0,
      pointsPerHundred: parseFloat(pointsPerHundred) || 0,
      memberDiscountEnabled,
      memberDiscountPct: parseFloat(memberDiscountPct) || 0,
      pointsRedemptionRate: parseFloat(pointsRedemptionRate) || 0,
      earlyCheckInEnabled,
      welcomePoints: parseInt(welcomePoints, 10) || 0,
      minPointsToRedeem: parseInt(minPointsToRedeem, 10) || 0,
      pointsCanPayUpToBillPct: parseFloat(pointsCanPayUpToBillPct) || 100,
      freeNightEvery: parseInt(freeNightEvery, 10) || 0,
      allowMemberPointsRedemption,
      // Sort ascending by `fromStays` before save so the
      // canonical Firestore shape matches the UI's display
      // order — defends against an admin who edits values
      // out of order (the resolveCurrentLevel helper is
      // defensive too, but a sorted write is friendlier to
      // anyone reading the doc raw).
      levels: [...levels].sort((a, b) => a.fromStays - b.fromStays),
    };
    const validation = RewardsConfigSchema.safeParse(candidate);
    if (!validation.success) {
      const first = validation.error.issues[0];
      const where = first.path.length > 0 ? first.path.join(".") : "settings";
      toast.error(`Cannot save: ${where} — ${first.message}`);
      return;
    }
    await runSettingsSave("rewards", "Rewards settings saved", () => updateSettings("rewardsConfig", validation.data));
  };

  const handleOpenPreview = async (action: string, label: string) => {
    setPreviewingTemplate(action);
    setPreviewingLabel(label);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewHtml(null);

    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/email/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ template: action })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to load preview." }));
        throw new Error(errorData.error || "Failed to load preview.");
      }

      const html = await res.text();
      setPreviewHtml(html);
    } catch (err: any) {
      console.error("Email preview fetch failed:", err);
      setPreviewError(err?.message || "Failed to load email template preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  // Per BR-02 (decision #231, 2026-10-12, breakfast redesign): the
// Per BR-02 (decision #231, 2026-10-12, breakfast redesign): the
// Breakfast & Dining save handler writes the new
// `BreakfastConfig` shape only (no legacy `ratePerPersonPerNight` /
// `breakfastIncludesChildrenDefault` / `silogItems`). The payload
// is Zod-validated against `BreakfastConfigSchema` from
// `@spark-inn/shared/schemas/booking` (added in BR-01) so a
// malformed `cutoffTime` ("25:99") or a meal row that exceeds the
// 10,000 PHP price cap is rejected client-side with a toast. The
// server is still the authoritative gate (per Hard Rule — never
// trust the client); this is a UX hint + early-feedback layer.
//
// `cutoffTimezone` is sourced from `hotel.config.ts` (the property
// timezone — the only authoritative source). It is rendered
// read-only in the UI and NOT a `useState` (per BR-02 acceptance).
//
// `servedGraceMinutes` (per spec §Open Items #5) is included in the
// payload. BR-01 originally omitted it from the shared schema (gap
// patched in the BR-01 close-out commit, see `shared/types/index.ts`
// `BreakfastConfig.servedGraceMinutes` + `BreakfastConfigSchema`).
// The UI input is wired up + hydrated from
// `DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES`.
//
// After the save commits, a one-shot diff against the previous
// `breakfastConfig` snapshot writes a
// `settings/breakfastConfig/breakfastConfigChangeLog/{auditId}`
// entry for each changed CONFIG field (cutoff time, override flag,
// instructions). Meal-row changes are content — not config —
// and are NOT audited (per spec §Admin Settings). The audit
// subcollection lives under the existing `settings/breakfastConfig`
// doc, not a new top-level collection, so the BR-02 "no new
// collections" constraint is honored.
const handleSaveBreakfast = async (e: React.FormEvent) => {
    e.preventDefault();
    // Per CFG-1 (QA pass 2026-10-21): warn on an ACTIVE meal priced
    // at ₱0. The legacy→new derivation used to write `price: 0` for
    // every meal (see the `breakfastMeals` initializer), which made
    // breakfast free for every guest with no visible sign in the
    // revenue report. The derivation now carries the legacy rate
    // across, so this warning is the second line of defence: if the
    // operator explicitly sets ₱0 on a live meal, they are told the
    // guests will not be charged for it.
    //
    // Non-blocking on purpose — a zero-price meal can be a deliberate
    // "complimentary" promotion. The warning makes the consequence
    // explicit instead of silently accepting it.
    const freeActiveMeal = breakfastMeals.find(
      (meal) => meal.isActive !== false && !(Number(meal.price) > 0)
    );
    if (freeActiveMeal) {
      toast.warning(
        "Breakfast meal priced at ₱0",
        `"${freeActiveMeal.name}" is active with a ₱0 price — guests will not be charged for it. Set a price, or mark the meal inactive to take it off the menu.`
      );
    }
    const payload = {
      isEnabled: breakfastEnabled,
      // Per BR-10 (decision #244 reserved, 2026-10-14
      // — Phase 14): the cut-off enforcement toggle is
      // explicit on every write. The Zod schema
      // requires a boolean so the writer can never
      // silently lose the field. The reader
      // (`normalizeBreakfastConfig`) defaults missing
      // values to `true` for legacy docs.
      cutoffsEnabled: breakfastCutoffsEnabled,
      cutoffTime: breakfastCutoffTime,
      cutoffTimezone: config.timezone,
      frontDeskOverrideEnabled: breakfastFrontDeskOverrideEnabled,
      servedGraceMinutes: parseInt(breakfastServedGraceMinutes, 10) || DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES,
      defaultMealInstructions: breakfastDefaultMealInstructions,
      meals: breakfastMeals,
      updatedBy: currentUser?.uid || currentUser?.email || "staff",
      updatedAt: new Date().toISOString()
    };
    const parsed = BreakfastConfigSchema.safeParse(payload);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      toast.error(
        "Invalid breakfast config",
        firstIssue?.message ?? "Review the cutoff time and meal rows, then try again."
      );
      return;
    }
    await runSettingsSave("breakfast", "Dining settings saved", async () => {
      const success = await updateSettings("breakfastConfig", parsed.data);
      if (success) {
        // Capture the before-state for the audit diff. The audit
        // log only fires for CONFIG fields — not meal rows (per
        // spec). The previous snapshot may be undefined on the
        // first-ever save; in that case every config field is
        // "new" and a single entry per field is still too noisy,
        // so we short-circuit when no prior snapshot exists.
        const previous = (breakfastConfig ?? {}) as Partial<BreakfastConfig>;
        const previousSnapshot: Record<string, unknown> = {
          // Per BR-10 (decision #244 reserved,
          // 2026-10-14 — Phase 14): the cut-off
          // enforcement toggle is part of the
          // config-level audit diff. A flip to / from
          // `false` writes a single audit entry naming
          // `cutoffsEnabled` so the change is
          // traceable (a hotel can recover who
          // disabled cut-offs and when). Legacy docs
          // hydrate to `true` (`!== false` defensively),
          // so a first-ever save writes every config
          // field once.
          cutoffsEnabled: previous.cutoffsEnabled !== false,
          cutoffTime: previous.cutoffTime,
          frontDeskOverrideEnabled: previous.frontDeskOverrideEnabled,
          servedGraceMinutes: previous.servedGraceMinutes,
          defaultMealInstructions: previous.defaultMealInstructions
        };
        const nextSnapshot: Record<string, unknown> = {
          cutoffsEnabled: parsed.data.cutoffsEnabled,
          cutoffTime: parsed.data.cutoffTime,
          frontDeskOverrideEnabled: parsed.data.frontDeskOverrideEnabled,
          servedGraceMinutes: parsed.data.servedGraceMinutes,
          defaultMealInstructions: parsed.data.defaultMealInstructions
        };
        const auditRef = collection(db, "settings", "breakfastConfig", "breakfastConfigChangeLog");
        const changedBy = currentUser?.uid || currentUser?.email || "staff";
        const writes: Promise<unknown>[] = [];
        for (const field of Object.keys(nextSnapshot)) {
          if (previousSnapshot[field] !== nextSnapshot[field]) {
            writes.push(
              addDoc(auditRef, {
                field,
                before: previousSnapshot[field] ?? null,
                after: nextSnapshot[field] ?? null,
                changedBy,
                changedAt: serverTimestamp()
              }).catch((err) => {
                // The audit log is a side-effect of the save —
                // a failed log entry must not roll back the
                // primary write. Log + swallow so the operator
                // still sees the success toast.
                // eslint-disable-next-line no-console
                console.warn("breakfastConfigChangeLog write failed", err);
              })
            );
          }
        }
        // Run all writes in parallel; do not block the success
        // toast on their resolution (the caller awaits the save
        // promise, not the audit promise).
        void Promise.all(writes);
      }
      return success;
    });
  };

  // Per DSC-01..05 (2026-08-01, per CVQ-06): save the per-class
  // discount scope to `settings/hotelConfig.discountScope`. The
  // server snapshots this onto every new booking; existing
  // bookings are unaffected (the snapshot is per-booking).
  // Front-desk users cannot reach the editor (admin-only), and
  // the senior row's checkboxes are disabled for non-admins if
  // the page is reached by a different path.
  const handleSaveDiscounts = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSettingsSave("discounts", "Discount scope saved", () => updateSettings("hotelConfig", {
      discountScope
    }));
  };

  // Per VAT-01 (2026-10-12): save the Tax (VAT) toggle to
  // `settings/hotelConfig.vatConfig.enabled`. The Settings tab
  // is the only editor; the source of truth is the Firestore
  // doc. Every product surface reads through the shared
  // `isVatEnabled` helper so a future schema change (e.g.
  // adding a `rate` field) is a one-line helper update, not
  // a per-surface rewrite.
  const handleSaveVat = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSettingsSave("vat", "Tax settings saved", () => updateSettings("hotelConfig", {
      vatConfig: { enabled: vatEnabled }
    }));
  };

  // Per the IFH-01.3 (Settings UI editor) follow-up:
  // persists the two hold windows to
  // `settings/hotelConfig.{paymentHoldWindowHours,
  // inFlowHoldMinutes}`. Both fields are clamped at the
  // server via the `normalizePaymentHoldWindowHours` /
  // `normalizeInFlowHoldMinutes` helpers — the form
  // disables Save when the input is out of range, but
  // the server is the authoritative gate. Existing
  // bookings + active holds are unaffected (the
  // snapshot is per-booking / per-hold).
  const handleSaveHolds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holdsFormValid) {
      toast.error(
        "Please enter a valid value — payment hold must be 1..72 hours, in-flow hold must be 5..30 minutes, and maximum stay must be 0 (no limit) or 1..365 nights."
      );
      return;
    }
    await runSettingsSave("holds", "Booking limits saved", () => updateSettings("hotelConfig", {
      paymentHoldWindowHours: paymentHoldWindowHoursValid!,
      inFlowHoldMinutes: inFlowHoldMinutesValid!,
      // Per MSL-01 (2026-10-15): written as the literal integer the
      // admin typed, including `0` for "no limit". `resolveMaxStayNights`
      // on the read side turns that `0` into `Infinity` for the clamp
      // arithmetic; storing `Infinity` here would be meaningless in
      // Firestore and would break the reader.
      maxStayNights: maxStayNightsValid!
    }));
  };

  const handleSaveStore = async () => {
    await runSettingsSave("store", "Store settings saved", () => updateSettings("storeConfig", {
      isEnabled: storeEnabled,
      lowStockThreshold: parseInt(lowStockThreshold) || 3
    }));
  };

  const handleSaveIntercom = async () => {
    await runSettingsSave("intercom", "Intercom settings saved", () => updateSettings("hotelConfig", {
      intercomQuickRequests,
      notificationSoundUrl
    }));
  };

  const handleSaveLegal = async () => {
    const cutoff = parseInt(cancellationCutoffHours);
    const before = parseFloat(cancellationRefundPctBefore);
    const after = parseFloat(cancellationRefundPctAfter);

    if (isNaN(cutoff) || cutoff < 0) {
      toast.error("Please enter a valid cutoff window (minimum 0 hours).");
      return;
    }
    if (isNaN(before) || before < 0 || before > 100) {
      toast.error("Refund percentage before cutoff must be between 0 and 100.");
      return;
    }
    if (isNaN(after) || after < 0 || after > 100) {
      toast.error("Refund percentage after cutoff must be between 0 and 100.");
      return;
    }

    const saved = await runSettingsSave("legal", "Legal content saved", () => updateSettings("websiteContent", {
      ...websiteContent,
      privacyPolicyBody,
      cancellationPolicy,
      cancellationCutoffHours: cutoff,
      cancellationRefundPctBefore: before,
      cancellationRefundPctAfter: after,
      houseRules,
      privacyPolicyLastUpdated: new Date().toISOString().slice(0, 10)
    }));
    if (saved) {
      setPrivacyPolicyLastUpdated(new Date().toISOString().slice(0, 10));
    }
  };

  // Per LCE-01 (decision #137, 2026-07-25): the Terms of
  // Service is editable from a dedicated save path because
  // the server auto-bumps the patch version (1.0.0 → 1.0.1)
  // and stamps `termsLastUpdated` atomically with the new
  // body. The generic `updateSettings("websiteContent", ...)`
  // path would not bump the version — the dedicated endpoint
  // is the only write path that produces a fresh consent
  // version for the booking audit trail. Front-desk callers
  // get a 403 from the server.
  const handleSaveTerms = async () => {
    const token = await auth.currentUser?.getIdToken(true);
    const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/admin/update-terms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token ? `Bearer ${token}` : ""
      },
      body: JSON.stringify({ termsBody })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      toast.error("Could not save terms", data?.error || "Please try again.");
      return;
    }
    // The server returns the new version + last-updated;
    // mirror them in local state so the user sees the
    // post-save values without a Firestore round-trip.
    setTermsVersion(data.data.termsVersion);
    setTermsLastUpdated(data.data.termsLastUpdated);
    setTermsSavedAt({
      version: data.data.termsVersion,
      lastUpdated: data.data.termsLastUpdated
    });
    toast.success(`Terms saved (version ${data.data.termsVersion})`);
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

  const openEditStaffModal = (member: StaffMember) => {
    setEditingStaff(member);
    setEditStaffName(member.fullName);
    setEditStaffEmail(member.email);
    setEditStaffPhone(member.phone || "");
    setEditStaffRole(member.role);
    setEditStaffPassword("");
    setEditStaffFormMessage(null);
  };

  const handleUpdateStaffSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingStaff) return;

    if (!editStaffName.trim() || !editStaffEmail.trim()) {
      setEditStaffFormMessage({ type: "error", text: "Name and email are required." });
      return;
    }

    if (editStaffPassword && editStaffPassword.length < 8) {
      setEditStaffFormMessage({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }

    setIsUpdatingStaff(true);
    setEditStaffFormMessage(null);

    const result = await updateStaff({
      uid: editingStaff.uid,
      fullName: editStaffName.trim(),
      email: editStaffEmail.trim(),
      phone: editStaffPhone.trim(),
      role: editStaffRole,
      password: editStaffPassword || undefined
    });

    setIsUpdatingStaff(false);

    if (!result.success) {
      setEditStaffFormMessage({ type: "error", text: result.error || "Failed to update staff account." });
      return;
    }

    toast.success("Staff updated", `Staff account for ${editStaffEmail} was successfully updated.`);
    setEditingStaff(null);
  };

  const handleSendResetPasswordEmail = async () => {
    if (!editingStaff) return;
    setIsSendingResetEmail(true);
    setEditStaffFormMessage(null);
    try {
      await sendPasswordReset(editStaffEmail.trim());
      setEditStaffFormMessage({
        type: "success",
        text: `Password reset email sent to ${editStaffEmail.trim()}.`
      });
    } catch (err: any) {
      setEditStaffFormMessage({
        type: "error",
        text: err?.message || "Failed to send password reset email."
      });
    } finally {
      setIsSendingResetEmail(false);
    }
  };

  const isAdmin = currentUser?.role === "admin";
  const stagingResetAvailable = typeof window !== "undefined"
    && isStagingAdminEnvironment(
      window.location.hostname,
      config.domain,
      import.meta.env.VITE_GUEST_APP_URL
    );

  // Toggle item status in local states
  // Per BR-02 (decision #231, 2026-10-12, breakfast redesign):
  // the legacy `toggleSilogItem` / `handleAddSilogItemClick` /
  // `handleEditSilogItem` / `handleDeleteSilogItem` /
  // `handleSaveSilogItemSubmit` helpers are replaced by inline
  // table-row editing. The table exposes per-row price /
  // description / display-order / isActive controls; adding a
  // new meal appends an empty edit row at the bottom. The new
  // meal id is `meal-{nanoid(8)}` (Math.random + Date.now,
  // matching the QRManagementPage id pattern at
  // admin-app/src/pages/QRManagementPage.tsx:368 — no `nanoid`
  // dependency).
  //
  // Meal-row changes are CONTENT (catalog) — not CONFIG — and
  // are NOT written to `settings/breakfastConfigChangeLog`
  // (per spec §Admin Settings: the audit subcollection is for
  // config-shape changes only). The setter mutates
  // `breakfastMeals` in place; the next Save click writes the
  // full array to Firestore.
  const handleAddBreakfastMeal = () => {
    const maxOrder = breakfastMeals.reduce(
      (max, meal) => (meal.displayOrder > max ? meal.displayOrder : max),
      -1
    );
    const newId = `meal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    setBreakfastMeals((prev) => [
      ...prev,
      {
        id: newId,
        name: "",
        description: "",
        price: 0,
        isActive: true,
        displayOrder: maxOrder + 1,
        createdAt: now,
        updatedAt: now
      }
    ]);
  };

  // Per MBUX-04 (decision #256, 2026-10-15): per-meal thumbnail
  // upload state. Kept as a Set of meal ids rather than one global
  // flag so an admin can see exactly which row is mid-upload in a
  // table of rows.
  const [uploadingMealImageIds, setUploadingMealImageIds] = useState<Set<string>>(new Set());

  // Per MBUX-04: upload (or replace) one meal's thumbnail.
  //
  // ORDER MATTERS. The new object is uploaded FIRST and the catalog
  // row is only repointed once the upload resolves. The superseded
  // object is deleted LAST, after the row no longer references it.
  // Reversing either step can leave the guest menu strip pointing at a
  // deleted file — a broken image in front of a paying guest.
  // Per OCT-H10 (2026-10-20, decision #284): a meal-photo change is
  // PERSISTED immediately, so the guest-facing catalog never lags
  // the admin's screen. Before this, the upload only mutated local
  // state and toasted "Meal image uploaded" — the guest still saw
  // no photo until the admin separately pressed Save, and
  // navigating away orphaned the Storage object so the upload
  // appeared lost.
  //
  // Only the `meals` array is written (`updateSettings` merges at
  // the top level of the doc), so the rest of the Dining form keeps
  // its own Save semantics — an unsaved cut-off-time edit is never
  // committed as a side effect of a photo action.
  const persistBreakfastMeals = async (meals: BreakfastMeal[]) => {
    const parsed = BreakfastMealSchema.array().safeParse(meals);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      toast.error(
        "Could not save the meal photo",
        firstIssue?.message ?? "The meal row is invalid — fix it and try again."
      );
      return false;
    }
    return updateSettings("breakfastConfig", {
      meals: parsed.data,
      updatedBy: currentUser?.uid || currentUser?.email || "staff",
      updatedAt: new Date().toISOString()
    });
  };

  const handleUploadBreakfastMealImage = async (mealId: string, file: File | undefined) => {
    if (!file) return;
    const previousUrl = breakfastMeals.find((meal) => meal.id === mealId)?.imageUrl;
    setUploadingMealImageIds((prev) => new Set(prev).add(mealId));
    try {
      const result = await uploadBreakfastMealImage(mealId, file);
      if (result.success && result.url) {
        // Per OCT-H10: build the next array explicitly (the
        // `setBreakfastMeals` state update is async, so reading
        // `breakfastMeals` inside the same tick would still see the
        // OLD array) and persist it right away.
        const nextMeals = applyBreakfastMealPatch(breakfastMeals, mealId, { imageUrl: result.url });
        handleUpdateBreakfastMeal(mealId, { imageUrl: result.url });
        const saved = await persistBreakfastMeals(nextMeals);
        if (saved) {
          if (previousUrl) {
            void removeBreakfastMealImage(mealId, previousUrl);
          }
          toast.success("Meal image uploaded");
        }
      }
    } finally {
      setUploadingMealImageIds((prev) => {
        const next = new Set(prev);
        next.delete(mealId);
        return next;
      });
    }
  };

  // Per MBUX-04: clear a meal's thumbnail. The row is cleared first so
  // the guest UI immediately falls back to its no-image state, then the
  // object is best-effort removed.
  const handleRemoveBreakfastMealImage = async (mealId: string) => {
    const previousUrl = breakfastMeals.find((meal) => meal.id === mealId)?.imageUrl;
    if (!previousUrl) return;
    // Per OCT-H10: persist the removal immediately, for the same
    // reason as the upload. The Storage object is deleted only
    // AFTER the row no longer references it, so the guest menu can
    // never point at a deleted file.
    const nextMeals = applyBreakfastMealPatch(breakfastMeals, mealId, { imageUrl: undefined });
    handleUpdateBreakfastMeal(mealId, { imageUrl: undefined });
    const saved = await persistBreakfastMeals(nextMeals);
    if (!saved) return;
    await removeBreakfastMealImage(mealId, previousUrl);
    toast.success("Meal image removed");
  };

  // Per OCT-H5 (2026-10-20, decision #283) + OCT-H10 (decision
  // #284): the ONE place a meal-row patch is applied. The inline
  // editors, the photo upload and the photo removal all route
  // through it, so the `undefined`-key rule is enforced identically
  // on every path.
  //
  // WHY THE RULE EXISTS: object spread copies own enumerable keys
  // INCLUDING undefined-valued ones, so a `{ imageUrl: undefined }`
  // patch left the meal object OWNING an `imageUrl` key with the
  // value `undefined`. Zod's `.optional()` validates the VALUE, not
  // the key's presence, so the bad payload passed schema validation
  // and then threw `Unsupported field value: undefined` at the
  // Firestore SDK boundary — which made EVERY Dining settings save
  // fail, not just the image removal.
  //
  // The fix drops undefined-valued keys from the patch so the key is
  // simply ABSENT, and — when the patch explicitly cleared a
  // previously-set optional field — removes the key from the merged
  // meal so neither the stale value nor an unwritable `undefined`
  // can survive.
  const applyBreakfastMealPatch = (
    meals: BreakfastMeal[],
    id: string,
    patch: Partial<Omit<BreakfastMeal, "id" | "createdAt">>
  ): BreakfastMeal[] =>
    meals.map((meal) => {
      if (meal.id !== id) return meal;
      const patchKeys = Object.keys(patch);
      const cleanPatch = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
      ) as Partial<Omit<BreakfastMeal, "id" | "createdAt">>;
      const next = { ...meal, ...cleanPatch, updatedAt: new Date().toISOString() };
      if (patchKeys.includes("imageUrl") && cleanPatch.imageUrl === undefined) {
        // The photo was removed: the key must be GONE (so the
        // rewritten `meals` array element has no `imageUrl`), not
        // left as `undefined` (unwritable) and not left holding the
        // old URL (which would point at a deleted Storage object).
        delete (next as { imageUrl?: string }).imageUrl;
      }
      return next;
    });

  const handleUpdateBreakfastMeal = (
    id: string,
    patch: Partial<Omit<BreakfastMeal, "id" | "createdAt">>
  ) => {
    setBreakfastMeals((prev) => applyBreakfastMealPatch(prev, id, patch));
  };

  const handleDeleteBreakfastMeal = (id: string) => {
    setBreakfastMeals((prev) => prev.filter((meal) => meal.id !== id));
  };

  const handleMoveBreakfastMeal = (id: string, direction: -1 | 1) => {
    setBreakfastMeals((prev) => {
      const sorted = [...prev].sort((a, b) => a.displayOrder - b.displayOrder);
      const idx = sorted.findIndex((meal) => meal.id === id);
      if (idx < 0) return prev;
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= sorted.length) return prev;
      const tmp = sorted[idx].displayOrder;
      sorted[idx] = { ...sorted[idx], displayOrder: sorted[swapIdx].displayOrder, updatedAt: new Date().toISOString() };
      sorted[swapIdx] = { ...sorted[swapIdx], displayOrder: tmp, updatedAt: new Date().toISOString() };
      return sorted;
    });
  };

  const editingStoreItem = storeItems.find(item => item.id === editingStoreItemId) ?? null;
  const filteredStoreItems = storeCategoryFilter === "all"
    ? storeItems
    : storeItems.filter(item => item.category === storeCategoryFilter);

  const countRoomsUsingType = (typeValue: string) => rooms.filter((room) => room.type === typeValue).length;

  const handleDeleteRoomType = async (typeValue: string) => {
    const attachedRooms = countRoomsUsingType(typeValue);
    if (attachedRooms > 0) {
      toast.error(
        "Cannot delete room type",
        `${attachedRooms} room${attachedRooms === 1 ? "" : "s"} still use this type. Reassign those rooms before deleting it.`
      );
      setPendingDeleteRoomType(null);
      return;
    }
    setIsDeletingRoomType(true);
    try {
      await deleteRoomType(typeValue);
      setPendingDeleteRoomType(null);
    } catch (error) {
      toast.error("Cannot delete room type", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsDeletingRoomType(false);
    }
  };
  const selectedStoreCategoryLabel = storeCategoryFilter === "all"
    ? "All items"
    : storeCategories.find(category => category.value === storeCategoryFilter)?.label ?? "All items";

  const openStoreItemModal = (itemId: string | null = null) => {
    const item = storeItems.find(storeItem => storeItem.id === itemId);
    setEditingStoreItemId(itemId);
    setStoreItemPhotoDataUrl(item?.imageUrl ?? "");
    setStoreItemPhotoFile(null);
    setStoreItemPhotoStatus("");
    setIsStoreItemModalOpen(true);
  };

  const closeStoreItemModal = () => {
    setIsStoreItemModalOpen(false);
    setEditingStoreItemId(null);
    setStoreItemPhotoDataUrl("");
    setStoreItemPhotoFile(null);
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
      setStoreItemPhotoFile(image.file);
      setStoreItemPhotoStatus(
        `Compressed to ${Math.max(1, Math.round(image.compressedSize / 1024))} KB at ${image.width}x${image.height}. It will upload to Storage on save.`
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
      imageFile: storeItemPhotoFile,
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
    { id: "payment" as const, label: "Payment Methods", icon: CreditCard },
    { id: "sources" as const, label: "Booking Sources", icon: Tag },
    { id: "roomtypes" as const, label: "Room Types", icon: BedDouble },
    // Per SR-01..05 (2026-10-12): the Booking Preferences
    // tab (bed set-ups + additional preferences catalogs).
    { id: "preferences" as const, label: "Booking Preferences", icon: ListChecks },
    { id: "branding" as const, label: "Branding", icon: Palette },
    { id: "website" as const, label: "Website Content", icon: Globe },
    { id: "seo" as const, label: seoSettings.sourceChangesPending ? "SEO & Search •" : "SEO & Search", icon: Eye },
    { id: "rewards" as const, label: "Loyalty Rewards", icon: Gift },
    { id: "breakfast" as const, label: "Breakfast & Dining", icon: Coffee },
    // Per BR-12.1 (2026-10-15, decision #247): the Other Add-Ons
    // tab body reads/writes the `addOns/{addOnId}` collection.
    // This entry was added post-merge (decision #251 follow-up)
    // because the SETTINGS_GROUPS.guest.tabs entry referenced
    // "addons" but the `tabs` array below was missing the
    // matching entry — the pill/sidebar render does
    // `tabs.find(...)` and silently returned `null`, so the
    // tab was hidden from both the mobile pill bar and the
    // desktop sidebar even though the badge counter said "5".
    { id: "addons" as const, label: "Other Add-Ons", icon: Package },
    { id: "store" as const, label: "In-Room Store", icon: ShoppingBag },
    { id: "email" as const, label: "Email Config", icon: Mail },
    { id: "intercom" as const, label: "Intercom", icon: MessageSquare },
    { id: "legal" as const, label: "Legal Content", icon: Scale },
    { id: "environment" as const, label: "Environment Testing", icon: FlaskConical },
    { id: "staff" as const, label: "Staff Accounts", icon: UserCog },
    { id: "discounts" as const, label: "Discounts", icon: Percent },
    { id: "holds" as const, label: "Booking & Holds", icon: Clock4 }
  ];

  if (settingsLoading) {
    return (
      <div className="space-y-8 font-body">
        <header className="space-y-2">
          <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-gray-100" />
        </header>
        {/* Mobile horizontal tab bar skeleton — matches the grouped
            pill row (5 groups × ~3-5 pills separated by dividers). */}
        <div className="lg:hidden -mx-4 overflow-hidden px-4 pb-1">
          <div className="flex min-w-max items-center gap-1.5">
            {SETTINGS_GROUPS.flatMap((group, groupIdx) => {
              const pills = Array.from({ length: group.tabs.length }).map((_, idx) => (
                <div
                  key={`${group.id}-${idx}`}
                  className="h-11 w-28 animate-pulse rounded-full bg-gray-100"
                />
              ));
              const isLastGroup = groupIdx === SETTINGS_GROUPS.length - 1;
              return [
                ...pills,
                ...(isLastGroup
                  ? []
                  : [
                      <span
                        key={`${group.id}-divider`}
                        aria-hidden="true"
                        className="mx-1 h-5 w-px shrink-0 bg-gray-200"
                      />
                    ])
              ];
            })}
          </div>
        </div>
        <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
          {/* Desktop sidebar skeleton — mirrors the grouped
              layout so there's no jump between skeleton and real
              content. 5 group headers + ~3-5 nested rows each. */}
          <aside className="hidden lg:block rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <div className="h-3 w-32 animate-pulse rounded bg-gray-100 mb-4" />
            <div className="space-y-3">
              {SETTINGS_GROUPS.map((group) => (
                <div key={group.id} className="space-y-1">
                  <div className="h-7 w-full animate-pulse rounded-lg bg-gray-100" />
                  {group.tabs.map((tabId) => (
                    <div
                      key={tabId}
                      className="ml-7 h-10 w-[calc(100%-1.75rem)] animate-pulse rounded-lg bg-gray-100"
                    />
                  ))}
                </div>
              ))}
            </div>
          </aside>
          <div className="min-h-[400px] rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 sm:p-7">
            <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">configurations & settings</h1>
        <p className="text-xs text-gray-500 mt-1">Configure guest check-in defaults, landing page banners, loyalty multipliers, and food items.</p>
      </header>

      {/* Mobile horizontal tab bar — single-line, scrolls sideways.
          The active tab is auto-scrolled into view (see the
          useEffect above). On desktop the same tabs render as a
          vertical 260px left nav (the <aside> below). The pills
          are separated by visual dividers that mark the SETTINGS_GROUPS
          boundaries (the 5 sidebar groups defined below). */}
      <div ref={tabBarRef} className="lg:hidden -mx-4 overflow-x-auto px-4 pb-1">
        <div className="flex min-w-max items-center gap-1.5">
          {SETTINGS_GROUPS.flatMap((group, groupIdx) => {
            const pills = group.tabs.map((tabId) => {
              const tab = tabs.find((entry) => entry.id === tabId);
              if (!tab) return null;
              const Icon = tab.icon;
              const isTabActive = activeTab === tabId;
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
            });
            const isLastGroup = groupIdx === SETTINGS_GROUPS.length - 1;
            return [
              ...pills,
              ...(isLastGroup
                ? []
                : [
                    <span
                      key={`divider-${group.id}`}
                      aria-hidden="true"
                      className="mx-1 h-5 w-px shrink-0 bg-gray-200"
                    />
                  ])
            ];
          })}
        </div>
      </div>

      {/* Split tab view layout */}
      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Left: Section Selection Navigation — desktop only.
            Per SET-SBG-01 (2026-10-12, settings-sidebar-grouping):
            the 18 tabs are clustered into 5 collapsible groups
            (see `SETTINGS_GROUPS`). The active group is always
            force-expanded so the operator can see where they
            are; the others respect the persisted user choice. */}
        <aside className="hidden lg:block rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 h-fit">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider px-3 mb-3">Settings Categories</h2>
          <div className="space-y-3">
            {SETTINGS_GROUPS.map((group) => {
              const isActiveGroup = group.id === groupOfTab(activeTab);
              const isCollapsed = !isActiveGroup && persistedCollapsedSet.has(group.id);
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isActiveGroup) return;
                      toggleGroup(group.id);
                    }}
                    aria-expanded={!isCollapsed}
                    aria-controls={`settings-group-${group.id}`}
                    className={`group/header w-full flex min-h-[36px] items-center justify-between gap-2 rounded-lg px-3 text-xs transition ${
                      isActiveGroup
                        ? "text-gray-700 cursor-default"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    }`}
                  >
                    <span className="font-bold uppercase tracking-wider text-[11px]">{group.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none ${
                          isActiveGroup
                            ? "bg-primary text-white"
                            : "bg-gray-100 text-gray-600 group-hover/header:bg-gray-200"
                        }`}
                      >
                        {group.tabs.length}
                      </span>
                      {isCollapsed ? (
                        <ChevronDown size={14} aria-hidden="true" />
                      ) : (
                        <ChevronUp size={14} aria-hidden="true" />
                      )}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div
                      id={`settings-group-${group.id}`}
                      className="mt-1 space-y-0.5"
                      role="group"
                      aria-label={group.label}
                    >
                      {group.tabs.map((tabId) => {
                        const tab = tabs.find((entry) => entry.id === tabId);
                        if (!tab) return null;
                        const Icon = tab.icon;
                        const isTabActive = activeTab === tabId;
                        return (
                          <button
                            key={tabId}
                            type="button"
                            onClick={() => setActiveTab(tabId)}
                            aria-current={isTabActive ? "page" : undefined}
                            className={`w-full min-h-[44px] flex items-center gap-3 pl-9 pr-3 rounded-lg text-xs font-bold transition ${
                              isTabActive
                                ? "bg-primary text-white shadow-sm"
                                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            }`}
                          >
                            <Icon size={16} aria-hidden="true" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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

              {/* Phase 11.8 PR 3 — hotel contact details. Each field
                  is admin-editable from this form; the public hook
                  falls back to the deploy-time `hotel.config.ts`
                  value when these are empty. The address stays a
                  single text input (matches the existing TYPES.md
                  schema — structured address is deferred to a
                  future phase). */}
              <div className="space-y-4 rounded-card border border-gray-150 bg-gray-50/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Hotel Contact Details
                </div>
                <p className="text-[11px] text-gray-500 -mt-2">
                  Contact overrides for the public site. Blank social fields hide their footer icons; other blank fields use the white-label default.
                </p>
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Address
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={config.address.street + ", " + config.address.city + ", " + config.address.region + " " + config.address.postalCode}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Front Desk Phone
                    <input
                      type="tel"
                      value={frontDeskPhone}
                      onChange={(e) => setFrontDeskPhone(e.target.value)}
                      placeholder={config.frontDeskPhone}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Support Email
                    <input
                      type="email"
                      value={supportEmail}
                      onChange={(e) => setSupportEmail(e.target.value)}
                      placeholder={config.supportEmail}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  DPO Email
                  <input
                    type="email"
                    value={dpoEmail}
                    onChange={(e) => setDpoEmail(e.target.value)}
                    placeholder={config.dpoEmail}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Facebook URL
                    <input
                      type="url"
                      value={facebookUrl}
                      onChange={(e) => setFacebookUrl(e.target.value)}
                      placeholder={config.facebookUrl}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Instagram URL
                    <input
                      type="url"
                      value={instagramUrl}
                      onChange={(e) => setInstagramUrl(e.target.value)}
                      placeholder={config.instagramUrl}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    X Handle
                    <input
                      type="text"
                      value={twitterHandle}
                      onChange={(e) => setTwitterHandle(e.target.value)}
                      placeholder="@hotelhandle"
                      pattern="@?[A-Za-z0-9_]*"
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                </div>
              </div>

              <SaveActionFooter label="Save Hotel Profile" status={getSaveStatus("hotel")} />
            </form>
          )}

          {/* TAB: PAYMENT METHODS — dynamic CRUD + per-method QR
              upload. Per `plan/features/SETTINGS.md §Payment Methods`.
              The booking payment list on `/book` Step 3 renders
              directly from this array — add, remove, reorder, and
              toggle from here and the guest site reflects it on
              the next snapshot tick.

              UX structure:
                1. Persistent amber callout listing the supported
                   methods + the explicit "no Pesonet" warning.
                2. Method list — one card per method with: icon,
                   label, key pill, enable toggle, QR preview,
                   edit, delete, up/down reorder buttons.
                3. "Add payment method" button at the bottom.
                4. Add/Edit modal with QR uploader (mirrors
                   `BrandingAssetRow` semantics). Pesonet triggers
                   a two-step save confirm.
           */}
          {activeTab === "payment" && <PaymentMethodsTabBody
            paymentMethods={paymentMethods}
            onAdd={addPaymentMethod}
            onUpdate={updatePaymentMethod}
            onReorder={reorderPaymentMethods}
            onDelete={deletePaymentMethod}
            onUploadQr={uploadPaymentMethodQr}
            onResetQr={resetPaymentMethodQr}
          />}

          {/* NBS-04 — admin-managed booking channel list. The data
              layer already owns normalization, backfill, bulk writes,
              and protected/reference delete guards. This tab is the
              single UI surface for those operations. */}
          {activeTab === "sources" && (
            isAdmin ? (
              <BookingSourcesTabBody
                bookingSources={bookingSources}
                onAdd={addBookingSource}
                onUpdate={updateBookingSource}
                onReorder={reorderBookingSources}
                onDelete={deleteBookingSource}
              />
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                <p className="font-semibold">Admin-only section</p>
                <p className="mt-1 leading-relaxed">
                  Booking source configuration affects acquisition reporting and the New Booking
                  workflow. Ask a hotel owner to make these changes.
                </p>
              </div>
            )
          )}

          {/* TAB 2: BRANDING — hero photos, hero copy, and logo
              overrides. Per `plan/features/SETTINGS.md §Branding`.
              Every public page's hero lives here, with its photo
              uploader + heading/subtext inputs grouped together. The
              Website Content tab (next) only owns non-hero copy:
              amenities, services, featured rooms, spark rewards. */}
          {activeTab === "branding" && (
            <form onSubmit={handleSaveBranding} className="space-y-8 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Branding &amp; Heroes</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Upload hero photos, edit hero copy, and override logos for every public page. Logo overrides win over the deploy-time assets in <code>hotel.config.ts</code>; leave them empty to keep the originals.
                </p>
              </div>

              {/* Hero Photos */}
              <div className="space-y-5">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Hero Photos</h4>

                <BrandingAssetRow
                  label="Homepage hero photo"
                  helper="Full-bleed background for /. Recommended 1920x1080. Shows behind the headline and the Book / View rooms buttons."
                  value={websiteContent.homepage?.heroPhotoUrl ?? ""}
                  fallbackLabel="Default: hotel pool photo"
                  onUpload={async (file) => {
                    const compressed = await compressImageFile(file, { maxWidth: 1920, maxHeight: 1080, quality: 0.85 });
                    return uploadBrandingAsset("homepage.heroPhotoUrl", compressed.file);
                  }}
                  onReset={() => resetBrandingAsset("homepage.heroPhotoUrl")}
                  loading={websiteContentLoading}
                />

                <BrandingAssetRow
                  label="About hero photo"
                  helper="Top of /about. Recommended 1920x600."
                  value={websiteContent.about?.heroPhotoUrl ?? ""}
                  fallbackLabel="Default: boutique hotel photo"
                  onUpload={async (file) => {
                    const compressed = await compressImageFile(file, { maxWidth: 1920, maxHeight: 600, quality: 0.85 });
                    return uploadBrandingAsset("about.heroPhotoUrl", compressed.file);
                  }}
                  onReset={() => resetBrandingAsset("about.heroPhotoUrl")}
                  loading={websiteContentLoading}
                />

                <BrandingAssetRow
                  label="Corporate hero photo"
                  helper="Top of /corporate. Recommended 1920x1080."
                  value={websiteContent.corporate?.heroPhotoUrl ?? ""}
                  fallbackLabel="Default: corporate boardroom photo"
                  onUpload={async (file) => {
                    const compressed = await compressImageFile(file, { maxWidth: 1920, maxHeight: 1080, quality: 0.85 });
                    return uploadBrandingAsset("corporate.heroPhotoUrl", compressed.file);
                  }}
                  onReset={() => resetBrandingAsset("corporate.heroPhotoUrl")}
                  loading={websiteContentLoading}
                />

                <BrandingAssetRow
                  label="Rewards hero photo"
                  helper="Top of /rewards. Recommended 1920x1080."
                  value={websiteContent.rewards?.heroPhotoUrl ?? ""}
                  fallbackLabel="Default: warm lobby interior"
                  onUpload={async (file) => {
                    const compressed = await compressImageFile(file, { maxWidth: 1920, maxHeight: 1080, quality: 0.85 });
                    return uploadBrandingAsset("rewards.heroPhotoUrl", compressed.file);
                  }}
                  onReset={() => resetBrandingAsset("rewards.heroPhotoUrl")}
                  loading={websiteContentLoading}
                />
              </div>

              {/* Hero Copy */}
              <div className="space-y-5">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Hero Copy</h4>

                <WebsiteContentSection
                  title="Homepage Hero"
                  helper="Hero copy for the homepage (/). Eyebrow, heading, and subtext."
                  icon={<Globe size={12} aria-hidden="true" />}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Homepage eyebrow
                        <input
                          type="text"
                          value={homepageHeroEyebrow}
                          onChange={(e) => setHomepageHeroEyebrow(e.target.value)}
                          placeholder={config.tagline}
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 sm:col-span-2">
                        Homepage heading
                        <input
                          type="text"
                          required
                          value={homepageHeroHeading}
                          onChange={(e) => setHomepageHeroHeading(e.target.value)}
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Homepage subtext
                      <input
                        type="text"
                        required
                        value={homepageHeroSubtext}
                        onChange={(e) => setHomepageHeroSubtext(e.target.value)}
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                  </div>
                </WebsiteContentSection>

                <WebsiteContentSection
                  title="About Hero"
                  helper={`Discover the vision and heart behind ${config.brandName}'s intentional hospitality in Bohol.`}
                  icon={<Award size={12} aria-hidden="true" />}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={aboutHeroEyebrow}
                          onChange={(e) => setAboutHeroEyebrow(e.target.value)}
                          placeholder="Our Story"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          required
                          value={aboutHeroHeading}
                          onChange={(e) => setAboutHeroHeading(e.target.value)}
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Subtext
                      <textarea
                        rows={2}
                        value={aboutHeroSubtext}
                        onChange={(e) => setAboutHeroSubtext(e.target.value)}
                        placeholder={`Discover the vision and heart behind ${config.brandName}'s intentional hospitality in Bohol.`}
                        className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </WebsiteContentSection>

                <WebsiteContentSection
                  title="Corporate Hero"
                  helper="Hero copy for the corporate page (/corporate)."
                  icon={<Building2 size={12} aria-hidden="true" />}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={corporateHeroEyebrow}
                          onChange={(e) => setCorporateHeroEyebrow(e.target.value)}
                          placeholder="Curated hospitality for executive comfort"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 sm:col-span-2">
                        Heading
                        <input
                          type="text"
                          required
                          value={corporateHeroHeading}
                          onChange={(e) => setCorporateHeroHeading(e.target.value)}
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Subtext
                      <textarea
                        required
                        rows={2}
                        value={corporateHeroSubtext}
                        onChange={(e) => setCorporateHeroSubtext(e.target.value)}
                        className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </WebsiteContentSection>

                <WebsiteContentSection
                  title="Rewards Hero"
                  helper={`Hero copy for the loyalty program page (/rewards).`}
                  icon={<Star size={12} aria-hidden="true" />}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Eyebrow pill (right of the program name)
                        <input
                          type="text"
                          value={rewardsHeroEyebrow}
                          onChange={(e) => setRewardsHeroEyebrow(e.target.value)}
                          placeholder="Loyalty Program"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                        <span className="text-[10px] text-gray-500">Renders as &quot;{config.rewardsName || "Spark Rewards"} {rewardsHeroEyebrow || "Loyalty Program"}&quot; in the pill.</span>
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          required
                          value={rewardsHeroHeading}
                          onChange={(e) => setRewardsHeroHeading(e.target.value)}
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Subtext
                      <textarea
                        required
                        rows={2}
                        value={rewardsHeroSubtext}
                        onChange={(e) => setRewardsHeroSubtext(e.target.value)}
                        className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </WebsiteContentSection>

                <WebsiteContentSection
                  title="Rooms Catalog Hero"
                  helper="Hero copy for the rooms catalog page (/rooms)."
                  icon={<BedDouble size={12} aria-hidden="true" />}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={roomsCatalogHeroEyebrow}
                          onChange={(e) => setRoomsCatalogHeroEyebrow(e.target.value)}
                          placeholder="Rooms & rates"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          value={roomsCatalogHeroHeading}
                          onChange={(e) => setRoomsCatalogHeroHeading(e.target.value)}
                          placeholder="Our rooms"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Subtext
                      <textarea
                        rows={2}
                        value={roomsCatalogHeroSubtext}
                        onChange={(e) => setRoomsCatalogHeroSubtext(e.target.value)}
                        placeholder="Browse every room type we offer, then pick your dates in the next step."
                        className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </WebsiteContentSection>

                <WebsiteContentSection
                  title="Contact Page Hero"
                  helper="Hero copy for the contact page (/contact)."
                  icon={<Mail size={12} aria-hidden="true" />}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={contactHeroEyebrow}
                          onChange={(e) => setContactHeroEyebrow(e.target.value)}
                          placeholder="Get in Touch"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          value={contactHeroHeading}
                          onChange={(e) => setContactHeroHeading(e.target.value)}
                          placeholder="contact us"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Subtext
                      <textarea
                        rows={2}
                        value={contactHeroSubtext}
                        onChange={(e) => setContactHeroSubtext(e.target.value)}
                        placeholder="Have a question about reservations, amenities, or negotiated corporate rates? Our team is here to assist."
                        className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </WebsiteContentSection>

                <WebsiteContentSection
                  title="Not Found Page (404) Hero"
                  helper="Hero copy for the 404 page when a guest visits an invalid path."
                  icon={<AlertTriangle size={12} aria-hidden="true" />}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={notFoundHeroEyebrow}
                          onChange={(e) => setNotFoundHeroEyebrow(e.target.value)}
                          placeholder="Page not found"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          value={notFoundHeroHeading}
                          onChange={(e) => setNotFoundHeroHeading(e.target.value)}
                          placeholder="lost in bohol?"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Subtext
                      <textarea
                        rows={2}
                        value={notFoundHeroSubtext}
                        onChange={(e) => setNotFoundHeroSubtext(e.target.value)}
                        placeholder="We couldn't find the page you were looking for. Let's get you back on track to your comfortable stay."
                        className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </WebsiteContentSection>
              </div>

              {/* Logo Overrides */}
              <div className="space-y-5">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Logo Overrides</h4>
                <p className="text-[10px] text-gray-500">
                  Uploads here override the deploy-time logos in <code>hotel.config.ts</code>. The Navbar uses the <em>on-dark</em> variant when transparent over a hero and the regular variant when scrolled. If you only upload one variant it&apos;s mirrored across both states.
                </p>

                <BrandingAssetRow
                  label="Navbar logo (solid background)"
                  helper="Used in the sticky/scrolled state and on every non-hero page. Colored version on a light background. Transparent PNGs are preserved as-is."
                  value={websiteContent.branding?.logoNavbar ?? ""}
                  fallback={`/brand/${config.logos.navbar}`}
                  onUpload={async (file) => {
                    // Logos need their alpha channel preserved. PNG
                    // is lossless + supports transparency; the
                    // previous default (JPEG) flattened the canvas
                    // to white, which is why a transparent logo
                    // showed up with a white box. The `quality`
                    // knob is meaningless for PNG and is silently
                    // ignored by canvas.toBlob.
                    const compressed = await compressImageFile(file, {
                      maxWidth: 600,
                      maxHeight: 200,
                      mimeType: "image/png"
                    });
                    return uploadBrandingAsset("branding.logoNavbar", compressed.file);
                  }}
                  onReset={() => resetBrandingAsset("branding.logoNavbar")}
                  loading={websiteContentLoading}
                />

                <BrandingAssetRow
                  label="Navbar logo (over hero, dark background)"
                  helper="Use a light/white version for visibility over the dark hero photo. This is the variant that fixes the dark-on-dark logo bug in the over-hero state. Transparent PNGs are preserved as-is."
                  value={websiteContent.branding?.logoNavbarOnDark ?? ""}
                  fallback={`/brand/${config.logos.navbar}`}
                  onUpload={async (file) => {
                    const compressed = await compressImageFile(file, {
                      maxWidth: 600,
                      maxHeight: 200,
                      mimeType: "image/png"
                    });
                    return uploadBrandingAsset("branding.logoNavbarOnDark", compressed.file);
                  }}
                  onReset={() => resetBrandingAsset("branding.logoNavbarOnDark")}
                  loading={websiteContentLoading}
                />

                <BrandingAssetRow
                  label="Footer logo"
                  helper="White version for the dark sidebar footer. Transparent PNGs are preserved as-is."
                  value={websiteContent.branding?.logoFooter ?? ""}
                  fallback={`/brand/${config.logos.white}`}
                  onUpload={async (file) => {
                    const compressed = await compressImageFile(file, {
                      maxWidth: 600,
                      maxHeight: 200,
                      mimeType: "image/png"
                    });
                    return uploadBrandingAsset("branding.logoFooter", compressed.file);
                  }}
                  onReset={() => resetBrandingAsset("branding.logoFooter")}
                  loading={websiteContentLoading}
                />
              </div>

              <SaveActionFooter label="Save Hero Copy" status={getSaveStatus("branding")} />
            </form>
          )}

          {/* TAB 3: WEBSITE CONTENT — list-shaped homepage content
              (amenities, services, featured rooms, Spark Rewards
              promo). Hero photos + hero copy live in the Branding
              tab. All sub-objects persist to settings/websiteContent
              via the single "Save Content" button. */}
          {activeTab === "website" && (
            <form onSubmit={handleSaveWebsiteContent} className="space-y-8 text-xs">
              {/* Section Headers editor */}
              <WebsiteContentSection
                title="Homepage Section Headers"
                helper="Customize the headings and subtext for the main sections of the homepage."
                icon={<Globe size={12} aria-hidden="true" />}
              >
                <div className="space-y-4">
                  {/* Rooms Section */}
                  <div className="rounded-lg border border-gray-100 bg-white p-3 space-y-3">
                    <p className="font-bold text-gray-700 text-[10px] uppercase">Featured Rooms Section (&quot;Stay with us&quot;)</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={roomsEyebrow}
                          onChange={(e) => setRoomsEyebrow(e.target.value)}
                          placeholder="Stay with us"
                          className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          value={roomsHeading}
                          onChange={(e) => setRoomsHeading(e.target.value)}
                          placeholder="Unassuming comfort, carefully kept"
                          className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                      Subtext
                      <input
                        type="text"
                        value={roomsSubtext}
                        onChange={(e) => setRoomsSubtext(e.target.value)}
                        placeholder="Rooms are intentionally simple..."
                        className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                      />
                    </label>
                  </div>

                  {/* Amenities Section */}
                  <div className="rounded-lg border border-gray-100 bg-white p-3 space-y-3">
                    <p className="font-bold text-gray-700 text-[10px] uppercase">Amenities Section</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={amenitiesEyebrow}
                          onChange={(e) => setAmenitiesEyebrow(e.target.value)}
                          placeholder="Amenities"
                          className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          value={amenitiesHeading}
                          onChange={(e) => setAmenitiesHeading(e.target.value)}
                          placeholder="Everything important, nothing fussy"
                          className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                      Subtext
                      <input
                        type="text"
                        value={amenitiesSubtext}
                        onChange={(e) => setAmenitiesSubtext(e.target.value)}
                        placeholder="A boutique hotel should make the basics feel graceful..."
                        className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                      />
                    </label>
                  </div>

                  {/* Services Section */}
                  <div className="rounded-lg border border-gray-100 bg-white p-3 space-y-3">
                    <p className="font-bold text-gray-700 text-[10px] uppercase">Services Section</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                        Eyebrow
                        <input
                          type="text"
                          value={servicesEyebrow}
                          onChange={(e) => setServicesEyebrow(e.target.value)}
                          placeholder="Services"
                          className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                        Heading
                        <input
                          type="text"
                          value={servicesHeading}
                          onChange={(e) => setServicesHeading(e.target.value)}
                          placeholder="Plans made easier"
                          className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-700">
                      Subtext
                      <input
                        type="text"
                        value={servicesSubtext}
                        onChange={(e) => setServicesSubtext(e.target.value)}
                        placeholder="For tours and transportation, our team can help coordinate..."
                        className="min-h-[38px] rounded border border-gray-250 bg-white px-3 text-xs font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </div>
              </WebsiteContentSection>

              {/* Amenities grid */}
              <WebsiteContentSection
                title="Homepage Amenities"
                helper="Four-up grid on the homepage. Disabled items are hidden from the guest site."
                icon={<Sparkles size={12} aria-hidden="true" />}
              >
                <ListEditor
                  label="Amenity items"
                  helper="Add or remove the boutique amenities shown to guests on the homepage. Reorder by using the up/down handles."
                  value={homepageAmenities}
                  onChange={setHomepageAmenities}
                  defaultIcon="sparkles"
                />
              </WebsiteContentSection>

              {/* Featured types selector (replaces the old per-room
                  picker; see TypePicker for the rationale). The
                  admin picks room types; the homepage renders one
                  card per type with the type's photo, bed,
                  amenities, capacity, and price. */}
              <WebsiteContentSection
                title="Featured Room Types"
                helper="Choose up to three room types for the homepage Stay with us section."
                icon={<BedDouble size={12} aria-hidden="true" />}
              >
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[10px] text-blue-800">
                  <p className="font-bold">Heads-up — types, not rooms</p>
                  <p className="mt-1 leading-relaxed">
                    Featured rooms now picks room <em>types</em>, not specific rooms. The card for each type shows the type's photo, bed, amenities, capacity, and price — all of which are type-level. If your previous selection used room IDs (e.g. &quot;room-201&quot;), it has been auto-mapped to its type.
                  </p>
                </div>
                <TypePicker
                  roomTypes={roomTypes}
                  activeRoomCounts={(() => {
                    const counts: Record<string, number> = {};
                    for (const r of rooms) {
                      if (r.isActive) counts[r.type] = (counts[r.type] ?? 0) + 1;
                    }
                    return counts;
                  })()}
                  value={homepageFeaturedTypeValues}
                  onChange={setHomepageFeaturedTypeValues}
                />
              </WebsiteContentSection>

              {/* Services cards */}
              <WebsiteContentSection
                title="Homepage Services"
                helper={<>Two-up service cards that link to the contact form. CTA stays fixed to <code>/contact</code>.</>}
                icon={<Package size={12} aria-hidden="true" />}
              >
                <ListEditor
                  label="Service items"
                  helper="Add or remove the service cards. Disable to hide a card from the homepage without deleting its content."
                  value={homepageServices}
                  onChange={setHomepageServices}
                  defaultIcon="palmtree"
                />
              </WebsiteContentSection>

              {/* Spark Rewards promo */}
              <WebsiteContentSection
                title="Spark Rewards Promo"
                helper="The dark promo block on the homepage. Hides entirely when disabled."
                icon={<Star size={12} aria-hidden="true" />}
              >
                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => setSparkRewardsEnabled(!sparkRewardsEnabled)}
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      sparkRewardsEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                  >
                    <div
                      className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                        sparkRewardsEnabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <span className="flex items-center gap-2">
                    <Star size={12} className="text-primary" />
                    Show the Spark Rewards block on the homepage
                  </span>
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Heading
                    <input
                      type="text"
                      value={sparkRewardsHeading}
                      onChange={(e) => setSparkRewardsHeading(e.target.value)}
                      placeholder="Stay often, feel known"
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Description
                    <textarea
                      value={sparkRewardsDescription}
                      onChange={(e) => setSparkRewardsDescription(e.target.value)}
                      rows={2}
                      placeholder="One-line marketing copy shown above the perks grid."
                      className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                </div>
                <ListEditor
                  label="Perks"
                  helper="Perks shown in the dark block. Disabled perks stay in the data so the order is preserved; they just don't render."
                  value={sparkRewardsPerks}
                  onChange={setSparkRewardsPerks}
                  defaultIcon="sparkles"
                  emptyItem={{ title: "", description: "", icon: "sparkles" }}
                />
              </WebsiteContentSection>

              {/* About page — body copy below the hero. The hero
                  itself is owned by the Branding tab; these fields
                  drive the mission, vision, and story sections on
                  `/about`. */}
              <WebsiteContentSection
                title="About us page"
                helper={<>Body content for <code>/about</code>. Hero copy and photo live in Branding.</>}
                icon={<Award size={12} aria-hidden="true" />}
              >

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Mission statement
                    <textarea
                      value={aboutMissionStatement}
                      onChange={(e) => setAboutMissionStatement(e.target.value)}
                      rows={4}
                      placeholder="Short mission copy shown in the first card."
                      className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Vision statement
                    <textarea
                      value={aboutVisionStatement}
                      onChange={(e) => setAboutVisionStatement(e.target.value)}
                      rows={4}
                      placeholder="Short vision copy shown in the second card."
                      className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Hotel story
                  <textarea
                    value={aboutHotelStory}
                    onChange={(e) => setAboutHotelStory(e.target.value)}
                    rows={8}
                    placeholder="Long-form story copy. Separate paragraphs with a blank line."
                    className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                  />
                </label>
              </WebsiteContentSection>

              {/* Corporate page — perks, rooms overview copy, and the
                  retreat CTA banner. The corporate hero is owned by
                  the Branding tab; this section owns the rest of the
                  page. Fields with no override here fall back to
                  hardcoded copy in `CorporateStaysPage` so the page
                  is never blank on a fresh deploy. */}
              <WebsiteContentSection
                title="Corporate page"
                helper={<>Content for <code>/corporate</code> other than the hero, which lives in Branding.</>}
                icon={<Building2 size={12} aria-hidden="true" />}
              >

                {/* Perks grid */}
                <div className="space-y-3">
                  <h5 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Perks Grid</h5>
                  <p className="text-[10px] text-gray-500">
                    Three-up grid on <code>/corporate</code> showing the corporate benefits (negotiated rates, group bookings, dedicated support, etc.). Disabled perks are hidden from the guest site.
                  </p>
                  <ListEditor
                    label="Perks"
                    helper="Add, remove, or reorder the perks. Disable to hide a perk without deleting its content."
                    value={corporatePerks}
                    onChange={setCorporatePerks}
                    defaultIcon="coins"
                    emptyItem={{ title: "", description: "", icon: "coins" }}
                  />
                </div>

                {/* Rooms overview copy */}
                <div className="space-y-3">
                  <h5 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Rooms Overview</h5>
                  <p className="text-[10px] text-gray-500">
                    The eyebrow + heading + subtext shown above the room type cards on <code>/corporate</code>. The cards themselves are driven by the live room types, not this editor.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Eyebrow
                      <input
                        type="text"
                        value={corporateRoomsOverviewEyebrow}
                        onChange={(e) => setCorporateRoomsOverviewEyebrow(e.target.value)}
                        placeholder="Accommodation Types"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Heading
                      <input
                        type="text"
                        value={corporateRoomsOverviewHeading}
                        onChange={(e) => setCorporateRoomsOverviewHeading(e.target.value)}
                        placeholder="Rooms Built for Productivity & Rest"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Subtext
                    <textarea
                      value={corporateRoomsOverviewDescription}
                      onChange={(e) => setCorporateRoomsOverviewDescription(e.target.value)}
                      rows={3}
                      placeholder="Marketing copy shown beneath the rooms overview heading."
                      className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                    />
                  </label>
                </div>

                {/* Retreat CTA banner */}
                <div className="space-y-3">
                  <h5 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Retreat CTA Banner</h5>
                  <p className="text-[10px] text-gray-500">
                    The orange banner between the rooms overview and the inquiry form. The button scrolls to the inquiry form (target is not editable).
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 sm:col-span-2">
                      Heading
                      <input
                        type="text"
                        value={corporateRetreatHeading}
                        onChange={(e) => setCorporateRetreatHeading(e.target.value)}
                        placeholder="Partner with us for your next team retreat."
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 sm:col-span-2">
                      Description
                      <textarea
                        value={corporateRetreatDescription}
                        onChange={(e) => setCorporateRetreatDescription(e.target.value)}
                        rows={2}
                        placeholder="One-line marketing copy shown under the heading."
                        className="w-full rounded border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 sm:col-span-2">
                      Button label
                      <input
                        type="text"
                        value={corporateRetreatCtaLabel}
                        onChange={(e) => setCorporateRetreatCtaLabel(e.target.value)}
                        placeholder="Get in Touch"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>
                </div>
              </WebsiteContentSection>

              <SaveActionFooter label="Save Content" status={getSaveStatus("website")} />
            </form>
          )}

          {activeTab === "seo" && (
            isAdmin ? (
              <form onSubmit={handleSaveSeoDraft} className="space-y-6 text-xs">
                <div>
                  <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">SEO &amp; Search</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    Save a draft here, then publish to rebuild the crawler-facing HTML, social metadata, and hotel schema.
                  </p>
                </div>

                <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-5">
                  <label className="flex flex-col gap-2 font-semibold text-gray-700">
                    Default search description
                    <textarea
                      required
                      minLength={50}
                      maxLength={160}
                      rows={3}
                      value={seoMetaDescription}
                      onChange={(event) => setSeoMetaDescription(event.target.value)}
                      className="w-full rounded-lg border border-gray-250 bg-white p-3 text-sm font-medium focus:border-primary"
                    />
                    <span className="text-[10px] font-normal text-gray-500">{seoMetaDescription.length}/160 characters. Aim for 120–160.</span>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-1">
                    <label className="flex flex-col gap-2 font-semibold text-gray-700 sm:max-w-sm">
                      Price category
                      <input
                        required
                        type="text"
                        maxLength={20}
                        value={seoPriceRange}
                        onChange={(event) => setSeoPriceRange(event.target.value)}
                        placeholder="₱₱"
                        className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                      />
                    </label>
                  </div>

                  <BrandingAssetRow
                    label="Social preview image"
                    helper="Shown when the website is shared. Upload a 1200×630 PNG, JPEG, or WebP image; larger files are compressed automatically."
                    value={seoOgImage}
                    fallback={DEFAULT_OG_IMAGE_URL}
                    fallbackLabel="Default social image"
                    previewClassName="object-cover"
                    onUpload={handleUploadSeoImage}
                    onReset={handleResetSeoImage}
                  />
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-[11px] leading-relaxed text-blue-900">
                  <p className="font-bold">Operational details come from Hotel Settings</p>
                  <p className="mt-1">
                    Publishing snapshots the current address, front-desk phone, Facebook, Instagram, and check-in/out times. Update Hotel Settings first if any of those are incorrect.
                  </p>
                  <p className={`mt-2 font-semibold ${seoSettings.sourceChangesPending ? "text-amber-700" : "text-blue-700"}`}>
                    {seoSettings.sourceChangesPending
                      ? "Hotel Settings changed after the last SEO publish. Publish SEO changes to update crawler-facing details."
                      : seoSettings.published
                        ? "Published SEO is synchronized with Hotel Settings."
                        : "No SEO snapshot has been published yet; deployments use hotel.config.ts defaults."}
                  </p>
                </div>

                <div className="flex flex-col gap-3 border-t border-gray-150 pt-4 sm:flex-row sm:items-center sm:justify-end">
                  <SaveActionButton label="Save draft" status={getSaveStatus("seo")} />
                  <button
                    type="button"
                    disabled={isPublishingSeo}
                    onClick={() => void handlePublishSeo()}
                    className="min-h-[44px] rounded-lg bg-gray-900 px-6 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPublishingSeo ? "Starting rebuild..." : "Publish SEO changes"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">Only admins can manage SEO publishing.</div>
            )
          )}

          {/* TAB 3: REWARDS CONFIG — admin-only (per W3.2) */}
          {activeTab === "rewards" && (
            isAdmin ? (
            <form onSubmit={handleSaveRewards} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">{config.rewardsName} Modifiers</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Configure earning rate, redemption value, welcome bonus, redemption thresholds, and the member tier program.
                </p>
              </div>

              {/* Master toggle — matches the screenshot's "Spark Rewards
                  is on" line. When off, all guest-app surfaces hide and
                  the booking-engine points earn step becomes a no-op
                  (per the existing `pointsEnabled` branch in
                  `guest-app/server/handlers/bookings.ts`). */}
              <div className="rounded-xl border border-gray-150 bg-gray-50 p-4">
                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => setPointsEnabled(!pointsEnabled)}
                    aria-label="Toggle Spark Rewards program"
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      pointsEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      pointsEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  <span>
                    {config.rewardsName} is on
                    <span className="block mt-0.5 text-[10px] font-medium text-gray-500">
                      Shown on the website, members can join and earn.
                    </span>
                  </span>
                </label>
              </div>

              {/* Phase 2 scalar inputs — 6 in a 3-column grid
                  (2 rows), matching the Settings → Rewards tab
                  screenshot. The first two fields are RELABELED
                  reciprocals of the existing per-spend inputs so
                  the admin thinks in "1 point = N peso" terms
                  (cleaner mental model). The underlying values
                  stay the same — `pointsPerHundred` and
                  `pointsRedemptionRate` — so no behavior change. */}
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="flex flex-col gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  ₱ Spent for 1 Point
                  <input
                    type="number"
                    min="1"
                    value={Math.max(1, Math.round(100 / (parseFloat(pointsPerHundred) || 10)))}
                    onChange={(e) => {
                      const php = Math.max(1, parseInt(e.target.value, 10) || 100);
                      setPointsPerHundred(String(Math.max(1, Math.round(100 / php))));
                    }}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold text-gray-900 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="flex flex-col gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  1 Point is Worth ₱
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={(parseFloat(pointsRedemptionRate) || 100) / 100}
                    onChange={(e) => {
                      const val = Math.max(0.01, parseFloat(e.target.value) || 1);
                      setPointsRedemptionRate(String(Math.max(1, Math.round(val * 100))));
                    }}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold text-gray-900 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="flex flex-col gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Welcome Points
                  <input
                    type="number"
                    min="0"
                    value={welcomePoints}
                    onChange={(e) => setWelcomePoints(e.target.value)}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold text-gray-900 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="flex flex-col gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Use at Least (Points)
                  <input
                    type="number"
                    min="0"
                    value={minPointsToRedeem}
                    onChange={(e) => setMinPointsToRedeem(e.target.value)}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold text-gray-900 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="flex flex-col gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Points Can Pay Up To (% of Bill)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={pointsCanPayUpToBillPct}
                    onChange={(e) => setPointsCanPayUpToBillPct(e.target.value)}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold text-gray-900 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="flex flex-col gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Free Night Every (Stays, 0 = Off)
                  <input
                    type="number"
                    min="0"
                    value={freeNightEvery}
                    onChange={(e) => setFreeNightEvery(e.target.value)}
                    disabled={!pointsEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold text-gray-900 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              </div>

              {/* Levels table editor — matches the screenshot's
                  5-column grid. Each row is a controllable LevelDef.
                  The "+ Add a level" button appends a sensible
                  default. The UI auto-sorts rows ascending by
                  `fromStays` on render so the admin sees the
                  canonical order even if they edited values out
                  of sequence. (The save handler also re-sorts
                  defensively before writing — see handleSaveRewards.) */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-heading text-gray-900">Levels</h4>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    Level depends on the number of completed stays as a member. The member discount is never added on top of a promo; the bigger one is used.
                  </p>
                </div>

                {/* Table header — only visible when there's at least
                    one row to label (an empty array hides the whole
                    table header to keep the empty state clean). */}
                {levels.length > 0 && (
                  <div className="hidden gap-2 sm:grid sm:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_2.2fr_auto] text-[10px] font-bold uppercase tracking-wider text-gray-500 px-1">
                    <span>Level Name</span>
                    <span>From Stays</span>
                    <span>Discount %</span>
                    <span>Points ×</span>
                    <span>Perks</span>
                    <span className="sr-only">Remove</span>
                  </div>
                )}

                <div className="space-y-2">
                  {[...levels]
                    .sort((a, b) => a.fromStays - b.fromStays)
                    .map((level) => (
                      <div
                        key={level.id}
                        className="grid items-center gap-2 sm:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_2.2fr_auto]"
                      >
                        <input
                          type="text"
                          value={level.name}
                          maxLength={24}
                          onChange={(e) => handleUpdateLevelField(level.id, "name", e.target.value)}
                          placeholder="Tier name"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold focus:border-primary"
                          aria-label="Level name"
                        />
                        <input
                          type="number"
                          min="0"
                          value={level.fromStays}
                          onChange={(e) => handleUpdateLevelField(level.id, "fromStays", e.target.value)}
                          placeholder="0"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold focus:border-primary"
                          aria-label="Stays required"
                        />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={level.discountPct}
                          onChange={(e) => handleUpdateLevelField(level.id, "discountPct", e.target.value)}
                          placeholder="0"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold focus:border-primary"
                          aria-label="Discount percentage"
                        />
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={level.pointsMultiplier}
                          onChange={(e) => handleUpdateLevelField(level.id, "pointsMultiplier", e.target.value)}
                          placeholder="1"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-semibold focus:border-primary"
                          aria-label="Points multiplier"
                        />
                        <input
                          type="text"
                          value={level.perks}
                          maxLength={280}
                          onChange={(e) => handleUpdateLevelField(level.id, "perks", e.target.value)}
                          placeholder="Member-facing perks blurb (≤ 280 chars)"
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary"
                          aria-label="Perks"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveLevel(level.id)}
                          aria-label={`Remove ${level.name} tier`}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 transition hover:bg-red-50 active:scale-95"
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                </div>

                <button
                  type="button"
                  onClick={handleAddLevel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-primary/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-primary transition hover:bg-primary/10 active:scale-95"
                >
                  <Plus size={14} aria-hidden="true" />
                  Add a Level
                </button>

                {levels.length === 0 && (
                  <p className="text-[11px] leading-relaxed text-gray-500">
                    No tiers configured. The booking engine falls back to the legacy member discount percentage below for tier-less members.
                  </p>
                )}
              </div>

              {/* Advanced / legacy controls — the per-booking /
                  per-spend branch + the EC-02 early check-in toggle
                  + the legacy member-discount toggle + the global
                  `memberDiscountPct` fallback. Kept accessible so
                  no existing functionality regresses; the primary
                  tier-editing surface is the Levels table above. */}
              <details className="rounded-xl border border-gray-150 bg-gray-50 p-4">
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-gray-700">
                  Advanced / legacy controls
                </summary>
                <div className="mt-4 space-y-5">

                  <label className="flex items-start gap-3 cursor-pointer text-xs font-bold text-gray-800">
                    <button
                      type="button"
                      onClick={() => setMemberDiscountEnabled(!memberDiscountEnabled)}
                      aria-label="Toggle global member discount"
                      className={`mt-0.5 h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                        memberDiscountEnabled ? "bg-primary" : "bg-gray-200"
                      }`}
                    >
                      <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                        memberDiscountEnabled ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                    <span>
                      Enable Global Member Discount Fallback
                      <span className="block mt-0.5 text-[10px] font-medium text-gray-500 leading-relaxed">
                        When on, the Member Discount % below applies to tier-less members. When your Levels table has a 0-stay base tier, that tier's discount takes precedence and this fallback is dormant.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer text-xs font-bold text-gray-800">
                    <button
                      type="button"
                      onClick={() => setAllowMemberPointsRedemption(!allowMemberPointsRedemption)}
                      aria-label="Toggle member self-service points redemption at checkout"
                      className={`mt-0.5 h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                        allowMemberPointsRedemption ? "bg-primary" : "bg-gray-200"
                      }`}
                    >
                      <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                        allowMemberPointsRedemption ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                    <span>
                      Allow Member Self-Redemption at Checkout
                      <span className="block mt-0.5 text-[10px] font-medium text-gray-500 leading-relaxed">
                        When on, signed-in members can apply their own points balance to a booking from the Step 3 review panel. The same min-redeem, bill cap, and balance guards still run server-side — only the actor changes. When off (the default), points redemption remains admin-only via the booking drawer.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer text-xs font-bold text-gray-800">
                    <button
                      type="button"
                      onClick={() => setEarlyCheckInEnabled(!earlyCheckInEnabled)}
                      aria-label="Toggle Spark Rewards early check-in requests"
                      className={`mt-0.5 h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                        earlyCheckInEnabled ? "bg-primary" : "bg-gray-200"
                      }`}
                    >
                      <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                        earlyCheckInEnabled ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                    <span>
                      Allow Spark Rewards Early Check-In Requests
                      <span className="block mt-0.5 text-[10px] font-medium text-gray-500 leading-relaxed">
                        When off, the button disappears from the booking confirmation page and the server rejects new requests with 403. Pending + historical requests on existing bookings stay visible until resolved.
                      </span>
                    </span>
                  </label>

                  <div className="space-y-3">
                    <h5 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Earning Mode</h5>
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        {earningMode === "per-booking" ? "Points per Completed Stay" : "Points Granted per ₱100 Spent"}
                        <input
                          type="number"
                          min="0"
                          value={earningMode === "per-booking" ? pointsPerBooking : pointsPerHundred}
                          onChange={(e) =>
                            earningMode === "per-booking"
                              ? setPointsPerBooking(e.target.value)
                              : setPointsPerHundred(e.target.value)
                          }
                          disabled={!pointsEnabled}
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                        Member Discount Percentage (%)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={memberDiscountPct}
                          onChange={(e) => setMemberDiscountPct(e.target.value)}
                          disabled={!memberDiscountEnabled}
                          className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </details>

              <SaveActionFooter label="Save Settings" status={getSaveStatus("rewards")} />
            </form>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                <p className="font-semibold">Admin-only section</p>
                <p className="mt-1 leading-relaxed">The {config.rewardsName} settings are restricted to admin accounts. Ask a hotel owner to make loyalty changes.</p>
              </div>
            )
          )}

          {/* TAB 4: BREAKFAST MENU CONFIG */}
          {activeTab === "breakfast" && (
            <form onSubmit={handleSaveBreakfast} className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Breakfast &amp; Dining</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Configure the daily cut-off, per-meal pricing, and meal instructions shown
                  to guests at Step 2, on the booking review, and on the Manage Breakfast page.
                </p>
              </div>

              {/* Master toggle (per spec §Admin Settings: keeps the
                  existing isEnabled behavior — when off, the Step 2
                  section + Manage Booking + the booking-drawer
                  breakfast tab all hide). */}
              <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => setBreakfastEnabled(!breakfastEnabled)}
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      breakfastEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                    aria-pressed={breakfastEnabled}
                    aria-label="Enable Guest Daily Breakfast Add-on"
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      breakfastEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Enable Guest Daily Breakfast Add-on
                </label>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  When off, the breakfast section disappears from public Step 2, the guest
                  Manage Breakfast page, and the admin booking drawer. Existing bookings with
                  ordered meals keep their snapshotted prices (the snapshot is immutable).
                </p>
              </div>

              {/* Cutoff &amp; override config (per BR-02). The
                  cutoff rule is `(serviceDate - 1 calendar day) at
                  cutoffTime, in hotel timezone`. The cut-off applies
                  to add, change, AND remove (server-enforced; this
                  input is the source of truth the server reads). */}
              <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-1.5">
                  Cutoff &amp; Override
                </h4>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Cutoff time (HH:MM, 24h)
                    <input
                      type="time"
                      data-testid="breakfast-cutoff-time"
                      value={breakfastCutoffTime}
                      onChange={(e) => setBreakfastCutoffTime(e.target.value)}
                      disabled={!breakfastEnabled}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed"
                    />
                    <span className="text-[10px] font-normal text-gray-500 leading-relaxed">
                      Guests must order breakfast for the next day before this time. Default is
                      8:00 PM. After this time, the date&apos;s meal grid locks and staff must
                      use the override flow to add/change/remove.
                    </span>
                  </label>

                  <div className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    <span>Hotel timezone</span>
                    <div
                      data-testid="breakfast-cutoff-timezone"
                      className="min-h-[44px] inline-flex items-center rounded border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-700"
                    >
                      {config.timezone}
                    </div>
                    <span className="text-[10px] font-normal text-gray-500 leading-relaxed">
                      Cutoffs are enforced in hotel timezone. Contact the developer to change.
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-3 text-xs font-semibold text-gray-700 cursor-pointer">
                  <button
                    type="button"
                    onClick={() => setBreakfastFrontDeskOverrideEnabled(!breakfastFrontDeskOverrideEnabled)}
                    disabled={!breakfastEnabled}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      breakfastFrontDeskOverrideEnabled ? "bg-primary" : "bg-gray-300"
                    }`}
                    aria-pressed={breakfastFrontDeskOverrideEnabled}
                    aria-label="Allow front desk to override the breakfast cutoff"
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      breakfastFrontDeskOverrideEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Front desk can override the cutoff
                </label>

                {/* Per BR-10 (decision #244 reserved, 2026-10-14 —
                    Phase 14): the cut-off enforcement toggle. When
                    off, every per-date breakfast lock is bypassed
                    and guests can edit meals up until the morning of
                    service. Visual mirror of the "Front desk can
                    override the cutoff" toggle — `bg-primary` for
                    the on state per FRONTEND.md brand colors. The
                    helper text calls out the BR-10 intent (a guest
                    who edits at 11:59 PM the night before still
                    goes through). */}
                <label className="flex items-center gap-3 text-xs font-semibold text-gray-700 cursor-pointer">
                  <button
                    type="button"
                    onClick={() => setBreakfastCutoffsEnabled(!breakfastCutoffsEnabled)}
                    disabled={!breakfastEnabled}
                    data-testid="breakfast-cutoffs-enabled-toggle"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      breakfastCutoffsEnabled ? "bg-primary" : "bg-gray-300"
                    }`}
                    aria-pressed={breakfastCutoffsEnabled}
                    aria-label="Enforce the breakfast cutoff"
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      breakfastCutoffsEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  <span className="flex flex-col gap-0.5">
                    <span>Cut-offs enabled</span>
                    <span className="text-[10px] font-normal text-gray-500 leading-relaxed">
                      When off, guests can edit breakfast meals up until the morning of service.
                    </span>
                  </span>
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  <span className="flex items-center justify-between">
                    Default meal instructions
                    <span className="text-[10px] font-normal text-gray-400">
                      {breakfastDefaultMealInstructions.length} / 2000
                    </span>
                  </span>
                  <textarea
                    data-testid="breakfast-default-meal-instructions"
                    value={breakfastDefaultMealInstructions}
                    onChange={(e) => setBreakfastDefaultMealInstructions(e.target.value.slice(0, 2000))}
                    disabled={!breakfastEnabled}
                    maxLength={2000}
                    rows={3}
                    placeholder='e.g. "Order by 8:00 PM the evening before your breakfast date. Same-day orders must go through the front desk."'
                    className="min-h-[88px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 py-2 text-xs font-medium focus:bg-white disabled:cursor-not-allowed"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700 max-w-xs">
                  Served-grace window (minutes)
                  <input
                    type="number"
                    data-testid="breakfast-served-grace-minutes"
                    min={0}
                    max={60}
                    step={1}
                    value={breakfastServedGraceMinutes}
                    onChange={(e) => setBreakfastServedGraceMinutes(e.target.value)}
                    disabled={!breakfastEnabled}
                    className="min-h-[44px] w-full rounded border border-gray-250 bg-gray-50/50 px-3 text-sm font-medium focus:bg-white disabled:cursor-not-allowed"
                  />
                  <span className="text-[10px] font-normal text-gray-500 leading-relaxed">
                    How long after a meal is marked served can staff un-serve without an
                    override reason. After this window, un-serving requires a reason. Default
                    is 15 minutes.
                  </span>
                </label>
              </div>

              {/* Meals table (per BR-02). Replaces the legacy 2-column
                  `silogItems` grid. Columns: order · name · price ·
                  description · isActive · delete. Inline edit; the
                  `id` becomes immutable once a booking references it
                  (server-enforced; the form never re-keys). Inactive
                  rows show a red "Inactive" pill per spec. */}
              <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Breakfast meal catalog
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddBreakfastMeal}
                    disabled={!breakfastEnabled}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 text-[10px] font-bold text-gray-500 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={12} aria-hidden="true" />
                    Add meal
                  </button>
                </div>

                {breakfastMeals.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-[10px] text-gray-500">
                    No meals yet. Click <strong>Add meal</strong> to create the first one.
                    The Step 2 + Manage Booking sections are hidden until at least one
                    active meal exists.
                  </p>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                        <th className="w-12 px-2 py-2 font-bold">Order</th>
                        <th className="px-2 py-2 font-bold">Name</th>
                        <th className="w-32 px-2 py-2 font-bold">Price (PHP)</th>
                        <th className="px-2 py-2 font-bold">Description</th>
                        <th className="w-20 px-2 py-2 font-bold">Active</th>
                        <th className="w-10 px-2 py-2 font-bold" aria-label="Row actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...breakfastMeals]
                        .sort((a, b) => a.displayOrder - b.displayOrder)
                        .map((meal) => {
                          const descRemaining = 200 - meal.description.length;
                          const priceValid =
                            Number.isFinite(meal.price) && meal.price >= 0 && meal.price <= 10000;
                          return (
                            <tr
                              key={meal.id}
                              data-testid={`breakfast-meal-row-${meal.id}`}
                              className="border-t border-gray-100 align-top"
                            >
                              <td className="px-2 py-2">
                                <div className="flex flex-col items-center gap-1">
                                  <span className="font-mono text-[10px] text-gray-500">
                                    {meal.displayOrder}
                                  </span>
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => handleMoveBreakfastMeal(meal.id, -1)}
                                      disabled={!breakfastEnabled}
                                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                      title="Move up"
                                      aria-label={`Move ${meal.name} up`}
                                    >
                                      <ArrowUp size={12} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveBreakfastMeal(meal.id, 1)}
                                      disabled={!breakfastEnabled}
                                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                      title="Move down"
                                      aria-label={`Move ${meal.name} down`}
                                    >
                                      <ArrowDown size={12} aria-hidden="true" />
                                    </button>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="text"
                                  data-testid={`breakfast-meal-name-${meal.id}`}
                                  value={meal.name}
                                  maxLength={80}
                                  onChange={(e) =>
                                    handleUpdateBreakfastMeal(meal.id, { name: e.target.value })
                                  }
                                  disabled={!breakfastEnabled}
                                  placeholder="e.g. Tapsilog"
                                  className="min-h-[36px] w-full rounded border border-gray-250 bg-white px-2 text-xs font-semibold focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                />
                                <span className="mt-1 block font-mono text-[10px] text-gray-400">
                                  id: {meal.id}
                                </span>
                                {/* Per MBUX-04 (decision #256, 2026-10-15):
                                    the optional meal thumbnail. Upload /
                                    preview / replace / remove, with
                                    per-row progress. The image is OPTIONAL:
                                    a meal with no file is a valid meal, and
                                    the guest menu strip falls back to its
                                    no-image tile rather than a broken img.
                                    The row is saved through the ordinary
                                    handleSaveBreakfast path, so the Zod
                                    schema validates it like any other edit. */}
                                <div
                                  className="mt-2 flex items-center gap-2"
                                  data-testid={`breakfast-meal-image-${meal.id}`}
                                >
                                  {meal.imageUrl ? (
                                    <img
                                      src={meal.imageUrl}
                                      alt=""
                                      // Consistent 4:3 crop per spec, so a
                                      // mixed-format catalog still reads as
                                      // one grid in the guest menu strip.
                                      className="h-12 w-16 shrink-0 rounded border border-gray-200 bg-gray-100 object-cover"
                                      style={{ aspectRatio: "4 / 3" }}
                                    />
                                  ) : (
                                    <span
                                      className="flex h-12 w-16 shrink-0 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-[9px] font-semibold uppercase tracking-wide text-gray-400"
                                      aria-hidden="true"
                                    >
                                      No image
                                    </span>
                                  )}
                                  <span className="flex flex-col gap-1">
                                    <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded border border-primary px-2 text-[11px] font-semibold text-primary hover:bg-primary-light focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
                                      {uploadingMealImageIds.has(meal.id)
                                        ? "Uploading…"
                                        : meal.imageUrl
                                          ? "Replace image"
                                          : "Upload image"}
                                      <input
                                        type="file"
                                        className="sr-only"
                                        data-testid={`breakfast-meal-image-input-${meal.id}`}
                                        accept="image/jpeg,image/png,image/webp"
                                        disabled={uploadingMealImageIds.has(meal.id)}
                                        onChange={(e) => {
                                          void handleUploadBreakfastMealImage(meal.id, e.target.files?.[0]);
                                          // Reset so re-picking the SAME file
                                          // fires change again — otherwise
                                          // "replace" silently does nothing
                                          // when the admin re-selects the
                                          // identical file after a failed
                                          // compression step.
                                          e.target.value = "";
                                        }}
                                      />
                                    </label>
                                    {meal.imageUrl ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleRemoveBreakfastMealImage(meal.id)}
                                        data-testid={`breakfast-meal-image-remove-${meal.id}`}
                                        className="min-h-11 rounded border border-gray-200 px-2 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                                      >
                                        Remove image
                                      </button>
                                    ) : null}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="number"
                                  data-testid={`breakfast-meal-price-${meal.id}`}
                                  value={Number.isFinite(meal.price) ? meal.price : 0}
                                  min={0}
                                  max={10000}
                                  step="0.01"
                                  onChange={(e) =>
                                    handleUpdateBreakfastMeal(meal.id, {
                                      price: parseFloat(e.target.value) || 0
                                    })
                                  }
                                  disabled={!breakfastEnabled}
                                  className={`min-h-[36px] w-full rounded border bg-white px-2 text-xs font-medium focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                                    priceValid ? "border-gray-250" : "border-red-300 bg-red-50"
                                  }`}
                                />
                                {!priceValid ? (
                                  <span className="mt-1 block text-[10px] font-semibold text-red-600">
                                    Must be 0–10,000 PHP
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="text"
                                  data-testid={`breakfast-meal-description-${meal.id}`}
                                  value={meal.description}
                                  maxLength={200}
                                  onChange={(e) =>
                                    handleUpdateBreakfastMeal(meal.id, {
                                      description: e.target.value
                                    })
                                  }
                                  disabled={!breakfastEnabled}
                                  placeholder="Optional marketing copy"
                                  className="min-h-[36px] w-full rounded border border-gray-250 bg-white px-2 text-xs font-medium focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                />
                                <span
                                  className={`mt-1 block text-[10px] ${
                                    descRemaining < 0 ? "text-red-600" : "text-gray-400"
                                  }`}
                                >
                                  {meal.description.length} / 200
                                </span>
                              </td>
                              <td className="px-2 py-2">
                                <div className="flex flex-col items-start gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateBreakfastMeal(meal.id, {
                                        isActive: !meal.isActive
                                      })
                                    }
                                    disabled={!breakfastEnabled}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                      meal.isActive ? "bg-primary" : "bg-gray-300"
                                    }`}
                                    aria-pressed={meal.isActive}
                                    aria-label={`Toggle ${meal.name} active`}
                                  >
                                    <div className={`h-4 w-4 rounded-full bg-white transition shadow-sm transform ${
                                      meal.isActive ? "translate-x-4" : "translate-x-0"
                                    }`} />
                                  </button>
                                  {!meal.isActive ? (
                                    <span
                                      className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"
                                      title="Existing bookings still reference this meal. They will continue to show it on their record (snapshot is immutable)."
                                    >
                                      Inactive
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteBreakfastMeal(meal.id)}
                                  disabled={!breakfastEnabled}
                                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Delete meal"
                                  aria-label={`Delete ${meal.name}`}
                                >
                                  <Trash2 size={12} aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              <SaveActionFooter label="Save Dining Settings" status={getSaveStatus("breakfast")} />
            </form>
          )}

          {/* TAB 4b: OTHER ADD-ONS (BR-12.1, 2026-10-15, decision #247) */}
          {activeTab === "addons" && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Other Add-Ons</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Manage the per-day add-on catalog shown on the public booking Step 2, the
                  guest Manage page, and the admin booking-drawer Other Add-Ons tab. v1 ships
                  the airport transfer; admins can add/edit/delete the catalog freely.
                </p>
              </div>

              {/* Hotel-wide setting: add-ons enabled. Per OCT-M1
                  (2026-10-20, decision #295) this switch is now
                  REAL. It used to be a bare `useState` with no
                  persistence at all — no Firestore read, no write,
                  no localStorage mirror — while the copy under it
                  claimed that turning it off would empty every
                  `getEnabledAddOnsByHotel` call. An admin who
                  flipped it believed other add-ons were off sale
                  while guests kept buying the airport transfer.

                  It now persists to
                  `settings/hotelConfig.otherAddOnsEnabled` and
                  `GET /api/bookings/addons/config` reads it, so
                  "off" genuinely empties the guest-facing catalog.
                  The per-row Status toggle in the catalog table
                  below stays the finer-grained control: it takes
                  ONE add-on off sale while this switch takes the
                  whole category off. */}
              <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !addOnsEnabled;
                      setAddOnsEnabled(next);
                      setAddOnSaveError(null);
                      // Persist through the same `settings/hotelConfig`
                      // channel every other hotel-wide setting uses.
                      // `updateSettings` surfaces its own failure
                      // toast; the local state is reverted so the
                      // switch never shows a value that is not
                      // stored.
                      void updateSettings("hotelConfig", {
                        otherAddOnsEnabled: next
                      }).then((ok) => {
                        if (!ok) {
                          setAddOnsEnabled(!next);
                          setAddOnSaveError(
                            "Failed to save the add-ons switch. The previous setting is still in effect."
                          );
                        }
                      });
                    }}
                    data-testid="addons-enabled-toggle"
                    className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      addOnsEnabled ? "bg-primary" : "bg-gray-200"
                    }`}
                    aria-pressed={addOnsEnabled}
                    aria-label="Enable Other Add-Ons"
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      addOnsEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Add-ons enabled
                </label>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  {/* Per OCT-M1 (2026-10-20, decision #295): the copy
                      now matches the behaviour. The switch persists
                      to `settings/hotelConfig.otherAddOnsEnabled` and
                      the public `/api/bookings/addons/config` endpoint
                      reads it, so turning it off genuinely empties
                      the guest-facing catalog — the booking flow's
                      add-ons grid and the guest Manage page both show
                      the "Add-ons are currently disabled" state.

                      The previous copy claimed this effect while the
                      switch was a dead `useState` (audit OCT-M1), and
                      an earlier revision admitted it was NOT wired up
                      at all. Neither matched reality; this one does. */}
                  When off, other add-ons are hidden from guests across
                  the whole site — the booking flow, the guest{" "}
                  <strong>Manage</strong> page, and the staff booking
                  drawer — and the add-ons grid shows the{" "}
                  <strong>Add-ons are currently disabled</strong> state.
                  This saves immediately. To take a single add-on off
                  sale instead, switch its <strong>Status</strong> to{" "}
                  <strong>Off</strong> in the catalog table below.
                </p>
                {addOnSaveError ? (
                  <p
                    role="alert"
                    data-testid="addons-enabled-error"
                    className="text-[10px] font-semibold text-red-600"
                  >
                    {addOnSaveError}
                  </p>
                ) : null}
              </div>

              {/* Catalog sub-section: table of all addOns/{id} docs
                  with name + price + unit + cutoff + enabled + edit +
                  delete columns. Per BR-12.1 the per-row enabled
                  toggle writes immediately on click (no save
                  button) — the existing admin-CRUD pattern. */}
              <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Add-on catalog
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAddOnId("__new__");
                      setEditingAddOnDraft({
                        id: "",
                        name: "",
                        description: "",
                        price: 0,
                        unit: "per-person",
                        isEnabled: true,
                        cutoffHoursBeforeCheckIn: 24,
                        displayOrder: (addOnsCatalog[addOnsCatalog.length - 1]?.displayOrder ?? 0) + 10,
                        updatedAt: new Date().toISOString(),
                        updatedBy: currentUser?.uid || "staff"
                      });
                    }}
                    data-testid="add-addon-button"
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 text-[10px] font-bold text-gray-500 transition hover:border-primary hover:text-primary"
                  >
                    <Plus size={12} aria-hidden="true" />
                    Add add-on
                  </button>
                </div>

                {addOnsCatalogLoading ? (
                  <p className="text-[10px] text-gray-500">Loading catalog…</p>
                ) : addOnsCatalogError ? (
                  // Per OCT-C3 (2026-10-20): a failed read must NOT
                  // masquerade as an empty catalog. Before this, a
                  // PERMISSION_DENIED read rendered the "No add-ons
                  // yet" panel below, which told the admin to create
                  // a row that may already have existed.
                  <div
                    data-testid="addons-catalog-error"
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-[11px] text-red-700"
                  >
                    <p className="font-bold">Could not load the other add-ons catalog.</p>
                    <p className="mt-1">{addOnsCatalogError}</p>
                    <p className="mt-2 text-red-600">
                      The catalog is stored in the <code>addOns</code> collection. If this says
                      &ldquo;Missing or insufficient permissions&rdquo;, the Firestore rules may
                      not have been deployed yet.
                    </p>
                  </div>
                ) : addOnsCatalog.length === 0 ? (
                  <div
                    data-testid="addons-catalog-empty"
                    className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-[11px] text-gray-500"
                  >
                    No add-ons yet. Use the "Add add-on" button above to create the first row.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-[10px] uppercase tracking-wider text-gray-500">
                          <th className="px-2 py-1.5">Name</th>
                          <th className="px-2 py-1.5">Price</th>
                          <th className="px-2 py-1.5">Unit</th>
                          <th className="px-2 py-1.5">Cutoff (h)</th>
                          <th className="px-2 py-1.5">Status</th>
                          <th className="px-2 py-1.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {addOnsCatalog.map((row) => (
                          <tr
                            key={row.id}
                            data-testid={`addons-row-${row.id}`}
                            className="border-b border-gray-100 last:border-0"
                          >
                            <td className="px-2 py-2 font-semibold text-gray-800">
                              {row.name}
                              {row.description ? (
                                <p className="text-[10px] font-normal text-gray-500">{row.description.slice(0, 80)}</p>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 text-gray-700">₱{row.price.toLocaleString()}</td>
                            <td className="px-2 py-2 text-gray-700">{row.unit}</td>
                            <td className="px-2 py-2 text-gray-700">{row.cutoffHoursBeforeCheckIn}</td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => handleToggleAddOnEnabled(row, !row.isEnabled)}
                                data-testid={`addons-toggle-${row.id}`}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                                  row.isEnabled ? "bg-primary" : "bg-gray-300"
                                }`}
                                aria-pressed={row.isEnabled}
                                aria-label={`Toggle ${row.name}`}
                              >
                                <div className={`h-4 w-4 rounded-full bg-white transition shadow-sm transform ${
                                  row.isEnabled ? "translate-x-4" : "translate-x-0"
                                }`} />
                              </button>
                            </td>
                            <td className="px-2 py-2 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAddOnId(row.id);
                                    setEditingAddOnDraft({ ...row });
                                  }}
                                  data-testid={`addons-edit-${row.id}`}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[10px] font-semibold text-gray-700 hover:border-primary hover:text-primary"
                                >
                                  <Pencil size={11} aria-hidden="true" /> Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteAddOn(row)}
                                  data-testid={`addons-delete-${row.id}`}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[10px] font-semibold text-red-600 hover:border-red-400"
                                >
                                  <Trash2 size={11} aria-hidden="true" /> Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {addOnSaveError ? (
                <p role="alert" className="text-[10px] text-red-600">
                  {addOnSaveError}
                </p>
              ) : null}
            </div>
          )}

          {/* ADD/EDIT ADD-ON MODAL (BR-12.1) */}
          {editingAddOnId && editingAddOnDraft ? (
            <Modal
              open={!!editingAddOnId}
              onClose={() => {
                setEditingAddOnId(null);
                setEditingAddOnDraft(null);
                setAddOnSaveError(null);
              }}
              title={editingAddOnId === "__new__" ? "Add add-on" : `Edit “${editingAddOnDraft.name || ""}”`}
              footer={null}
            >
              <form
                data-testid="addon-edit-form"
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  const draft = editingAddOnDraft;
                  if (!draft) return;
                  // Derive a stable id from the name (kebab-cased) for
                  // new rows. Editing keeps the existing id.
                  const id =
                    editingAddOnId === "__new__"
                      ? String(draft.name || "")
                          .toLowerCase()
                          .trim()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-+|-+$/g, "")
                          .slice(0, 80) || "add-on"
                      : editingAddOnId;
                  await handleSaveAddOn({ ...draft, id });
                }}
                className="space-y-3 text-sm"
              >
                <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                  Name
                  <input
                    required
                    type="text"
                    data-testid="addon-name-input"
                    value={editingAddOnDraft.name}
                    onChange={(e) =>
                      setEditingAddOnDraft((p: AddOn | null) => (p ? { ...p, name: e.target.value } : p))
                    }
                    className="min-h-[44px] rounded border border-gray-250 bg-white px-3 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                  Description (optional)
                  <textarea
                    rows={2}
                    maxLength={500}
                    data-testid="addon-description-input"
                    value={editingAddOnDraft.description}
                    onChange={(e) =>
                      setEditingAddOnDraft((p: AddOn | null) =>
                        p ? { ...p, description: e.target.value.slice(0, 500) } : p
                      )
                    }
                    className="min-h-[60px] rounded border border-gray-250 bg-white px-3 py-2 text-xs"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                    Price (₱)
                    <input
                      required
                      type="number"
                      min={0}
                      max={10000}
                      data-testid="addon-price-input"
                      value={editingAddOnDraft.price}
                      onChange={(e) =>
                        setEditingAddOnDraft((p: AddOn | null) =>
                          p ? { ...p, price: Math.max(0, Number(e.target.value) || 0) } : p
                        )
                      }
                      className="min-h-[44px] rounded border border-gray-250 bg-white px-3 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                    Unit
                    <select
                      data-testid="addon-unit-input"
                      value={editingAddOnDraft.unit}
                      onChange={(e) =>
                        setEditingAddOnDraft((p: AddOn | null) =>
                          p ? { ...p, unit: e.target.value as "per-person" | "per-stay" } : p
                        )
                      }
                      className="min-h-[44px] rounded border border-gray-250 bg-white px-3 text-sm"
                    >
                      <option value="per-person">per-person</option>
                      <option value="per-stay">per-stay</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                    Cutoff (hours before check-in)
                    <input
                      type="number"
                      min={0}
                      max={168}
                      data-testid="addon-cutoff-input"
                      value={editingAddOnDraft.cutoffHoursBeforeCheckIn}
                      onChange={(e) =>
                        setEditingAddOnDraft((p: AddOn | null) =>
                          p
                            ? {
                                ...p,
                                cutoffHoursBeforeCheckIn: Math.max(
                                  0,
                                  Math.min(168, Math.floor(Number(e.target.value) || 0))
                                )
                              }
                            : p
                        )
                      }
                      className="min-h-[44px] rounded border border-gray-250 bg-white px-3 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                    Display order
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      data-testid="addon-display-order-input"
                      value={editingAddOnDraft.displayOrder}
                      onChange={(e) =>
                        setEditingAddOnDraft((p: AddOn | null) =>
                          p
                            ? {
                                ...p,
                                displayOrder: Math.max(
                                  0,
                                  Math.min(1000, Math.floor(Number(e.target.value) || 0))
                                )
                              }
                            : p
                        )
                      }
                      className="min-h-[44px] rounded border border-gray-250 bg-white px-3 text-sm"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-3 cursor-pointer text-xs font-semibold text-gray-700">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingAddOnDraft((p: AddOn | null) =>
                        p ? { ...p, isEnabled: !p.isEnabled } : p
                      )
                    }
                    data-testid="addon-enabled-toggle"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      editingAddOnDraft.isEnabled ? "bg-primary" : "bg-gray-300"
                    }`}
                    aria-pressed={editingAddOnDraft.isEnabled}
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      editingAddOnDraft.isEnabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  Enabled
                </label>
                {addOnSaveError ? (
                  <p role="alert" className="text-[10px] text-red-600">{addOnSaveError}</p>
                ) : null}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAddOnId(null);
                      setEditingAddOnDraft(null);
                      setAddOnSaveError(null);
                    }}
                    className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="addon-save-button"
                    disabled={addOnSaveStatus === "saving"}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:opacity-50"
                  >
                    <Save size={14} />
                    {addOnSaveStatus === "saving" ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </Modal>
          ) : null}

          {/* DELETE ADD-ON CONFIRMATION MODAL (BR-12.1) */}
          {confirmDeleteAddOn ? (
            <Modal
              open={!!confirmDeleteAddOn}
              onClose={() => setConfirmDeleteAddOn(null)}
              title={`Delete ${confirmDeleteAddOn.name}?`}
              footer={null}
            >
              <div
                data-testid="addon-delete-confirm"
                className="space-y-4 text-sm"
              >
                <p className="text-gray-700">
                  This will remove the add-on from any future bookings.
                </p>
                <p className="text-[11px] text-gray-500">
                  Existing bookings with this add-on will retain their snapshots.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAddOn(null)}
                    className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="addon-delete-confirm-button"
                    onClick={handleConfirmDeleteAddOn}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-red-700 active:scale-95"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            </Modal>
          ) : null}

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
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold text-gray-900">Managed from Payment Methods</p>
                      <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-gray-500">
                        The in-room store now uses the same payment list as booking. Use each method&apos;s Store visibility toggle to show or hide it here. Add to Bill stays protected because it powers the guest folio charge flow.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("payment")}
                      className="inline-flex min-h-[36px] w-fit items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[10px] font-bold text-primary transition hover:bg-gray-50"
                    >
                      Configure payment methods
                      <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {paymentMethods
                      .filter((pm) => pm.method !== "pay-at-hotel" && pm.showInStore !== false)
                      .map((pm) => (
                        <div key={pm.method} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-gray-900">{pm.label || pm.method}</p>
                              <p className="mt-0.5 font-mono text-[10px] text-gray-500">{pm.method}</p>
                            </div>
                            {pm.method === "add-to-bill" && (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">
                                Folio
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    {paymentMethods.filter((pm) => pm.method !== "pay-at-hotel" && pm.showInStore !== false).length === 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] font-medium text-amber-800 sm:col-span-2 lg:col-span-3">
                        No payment methods are visible on the store. Open Payment Methods and enable the Store toggle for at least one method.
                      </div>
                    )}
                  </div>
                </div>
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

              <SaveActionFooter
                label="Save Store Settings"
                status={getSaveStatus("store")}
                onClick={() => void handleSaveStore()}
              />
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
                          <p className="text-[11px] text-gray-500">
                            Up to {type.maxCapacity} adult{type.maxCapacity === 1 ? "" : "s"} · {type.maxChildren ?? 0} child{(type.maxChildren ?? 0) === 1 ? "" : "ren"}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            {countRoomsUsingType(type.value)} room{countRoomsUsingType(type.value) === 1 ? "" : "s"} using this type
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
                            onClick={() => setPendingDeleteRoomType(type)}
                            className="shrink-0 font-bold hover:underline min-h-[44px] px-2 text-red-650 hover:text-red-700"
                          >
                            Delete
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
                        <th className="px-4 py-2.5">Occupancy Caps</th>
                        <th className="px-4 py-2.5">Photos</th>
                        <th className="px-4 py-2.5">In Use</th>
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
                          <td className="px-4 py-3 text-[11px] text-gray-600">
                            <span className="font-semibold text-gray-800">{type.maxCapacity}</span> adult{type.maxCapacity === 1 ? "" : "s"}
                            <span className="mx-1 text-gray-300">·</span>
                            <span className="font-semibold text-gray-800">{type.maxChildren ?? 0}</span> child{(type.maxChildren ?? 0) === 1 ? "" : "ren"}
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
                          <td className="px-4 py-3 text-[11px] text-gray-500">
                            {countRoomsUsingType(type.value)} room{countRoomsUsingType(type.value) === 1 ? "" : "s"}
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
                                onClick={() => setPendingDeleteRoomType(type)}
                                className="font-bold hover:underline text-red-650 hover:text-red-700"
                              >
                                Delete
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
                    // Per CHD-03 (2026-08-01): `maxCapacity` is the
                    // adult cap; children have their own non-negative
                    // per-type cap.
                    const maxChildren = Math.max(
                      0,
                      parseInt((form.elements.namedItem("maxChildren") as HTMLInputElement).value, 10) || 0
                    );
                    const pricePerNight = parseFloat((form.elements.namedItem("baseRate") as HTMLInputElement).value) || 0;
                    const weekendRate = parseFloat((form.elements.namedItem("weekendRate") as HTMLInputElement).value) || pricePerNight;
                    const corporateRate = parseFloat((form.elements.namedItem("corpRate") as HTMLInputElement).value) || pricePerNight;
                    // Per EXB-01 (2026-07-31): extra-bed allowance + rate.
                    // `maxExtraBeds` of 0 means the type does not allow
                    // extra beds (no separate `allowsExtraBed` boolean
                    // per the spec). Absent fields default to 0.
                    const maxExtraBeds = parseInt((form.elements.namedItem("maxExtraBeds") as HTMLInputElement).value, 10) || 0;
                    const extraBedRate = parseFloat((form.elements.namedItem("extraBedRate") as HTMLInputElement).value) || 0;

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
                      maxChildren,
                      pricePerNight,
                      weekendRate,
                      corporateRate,
                      // Per EXB-01 (2026-07-31).
                      maxExtraBeds,
                      extraBedRate,
                      // Per SR-01..05 (2026-10-12): a new
                      // room type starts with an empty
                      // `bedSetupValues` subset. The admin
                      // picks the subset in the Edit modal
                      // after creation (the Add form
                      // intentionally omits the picker to
                      // keep the form tidy).
                      bedSetupValues: []
                    });
                    form.reset();
                    toast.success(
                      "Room type added",
                      `${label} (${shortLabel}) — up to ${maxCapacity} adult${maxCapacity === 1 ? "" : "s"} and ${maxChildren} child${maxChildren === 1 ? "" : "ren"}, base ${formatPrice(pricePerNight)}/night${maxExtraBeds > 0 ? `, +${maxExtraBeds} extra bed${maxExtraBeds === 1 ? "" : "s"} at ${formatPrice(extraBedRate)}/night` : ""}.`
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

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Maximum adults (12+)
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
                      Maximum children (0–11)
                      <input
                        name="maxChildren"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={0}
                        required
                        aria-describedby="add-room-type-child-cap-help"
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                      <span id="add-room-type-child-cap-help" className="text-[10px] font-normal leading-relaxed text-gray-500">
                        Children are free of the room rate. Set 0 when this room type does not accommodate children.
                      </span>
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
                    {/* Per EXB-01 (2026-07-31): extra-bed allowance
                        + rate. The selector appears on the guest
                        /book page only when `maxExtraBeds > 0`; the
                        "no separate `allowsExtraBed` boolean" rule
                        (per the spec) means the count itself is the
                        gate. Leave at 0 to keep the type's offering
                        unchanged. */}
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Max extra beds (0 = not offered)
                      <input
                        name="maxExtraBeds"
                        type="number"
                        min={0}
                        max={5}
                        step={1}
                        defaultValue={0}
                        className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                      Extra bed rate ({config.currencySymbol} / bed / night)
                      <input
                        name="extraBedRate"
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

          {/* Per SR-01..05 (2026-10-12): the Booking
              Preferences tab. Self-contained tab body
              (see `BookingPreferencesTabBody` above). The
              tab body owns the edit / delete modals +
              the "click-twice-to-confirm" delete pattern;
              SettingsPage just hands it the live
              catalogs + the two update callbacks. */}
          {activeTab === "preferences" && (
            <BookingPreferencesTabBody
              bedSetups={bedSetupsCatalog}
              bookingPreferences={bookingPreferencesCatalog}
              onUpdateBedSetups={updateBedSetups}
              onUpdateBookingPreferences={updateBookingPreferences}
            />
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
                  // Per CHD-03 (2026-08-01): persist the child cap
                  // alongside the adult cap in the same room-types
                  // array write.
                  const maxChildren = Math.max(0, parseInt(get("maxChildren"), 10) || 0);
                  const pricePerNight = parseFloat(get("baseRate")) || 0;
                  const weekendRate = parseFloat(get("weekendRate")) || pricePerNight;
                  const corporateRate = parseFloat(get("corpRate")) || pricePerNight;
                  // Per EXB-01 (2026-07-31): extra-bed allowance + rate.
                  const maxExtraBeds = parseInt(get("maxExtraBeds"), 10) || 0;
                  const extraBedRate = parseFloat(get("extraBedRate")) || 0;
                  // Per SR-01..05 (2026-10-12): read every
                  // checked `bedSetupValues` checkbox. The
                  // `intersectBedSetupValues` helper inside
                  // `updateRoomType` further dedupes +
                  // filters against the live catalog (so a
                  // stale reference is removed at the write).
                  const bedSetupValues = Array.from(
                    form.querySelectorAll<HTMLInputElement>(
                      'input[name="bedSetupValues"]:checked'
                    )
                  ).map((input) => input.value);

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
                      maxChildren,
                      pricePerNight,
                      weekendRate,
                      corporateRate,
                      // Per EXB-01 (2026-07-31).
                      maxExtraBeds,
                      extraBedRate,
                      // Per SR-01..05 (2026-10-12): the
                      // per-type bed-set-up subset. Already
                      // deduped + filtered against the live
                      // catalog inside `updateRoomType`.
                      bedSetupValues
                    });
                    toast.success(
                      "Room type updated",
                      `${label} — up to ${maxCapacity} adult${maxCapacity === 1 ? "" : "s"} and ${maxChildren} child${maxChildren === 1 ? "" : "ren"}, base ${formatPrice(pricePerNight)}/night.`
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

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Maximum adults (12+)
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
                    Maximum children (0–11)
                    <input
                      name="maxChildren"
                      type="number"
                      min={0}
                      step={1}
                      required
                      defaultValue={editType.maxChildren ?? 0}
                      aria-describedby="edit-room-type-child-cap-help"
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                    <span id="edit-room-type-child-cap-help" className="text-[10px] font-normal leading-relaxed text-gray-500">
                      Children are free of the room rate. Set 0 when this room type does not accommodate children.
                    </span>
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
                  {/* Per EXB-01 (2026-07-31): extra-bed allowance
                      + rate. The selector appears on the guest
                      /book page only when `maxExtraBeds > 0`. */}
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Max extra beds (0 = not offered)
                    <input
                      name="maxExtraBeds"
                      type="number"
                      min={0}
                      max={5}
                      step={1}
                      defaultValue={editType.maxExtraBeds ?? 0}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Extra bed rate ({config.currencySymbol} / bed / night)
                    <input
                      name="extraBedRate"
                      type="number"
                      min={0}
                      defaultValue={editType.extraBedRate ?? 0}
                      className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                    />
                  </label>
                </div>

                {/* Per SR-01..05 (2026-10-12): the per-type
                    bed-set-up subset. Each option in the
                    admin-configured `bedSetups` catalog
                    shows as a row; the saved subset is sent
                    through `updateRoomType(...,
                    { bedSetupValues })`. Empty = the guest
                    booking Step 2 selector is hidden for
                    this type. Hidden entirely when the
                    global catalog is empty (defensive —
                    don't render a section that's always
                    empty). */}
                {bedSetupsCatalog.length > 0 ? (
                  <fieldset className="space-y-2">
                    <legend className="text-xs font-semibold text-gray-700">
                      Bed set-up options offered for this type
                    </legend>
                    <p className="text-[10px] font-normal leading-relaxed text-gray-500">
                      Tick the options to offer the guest on the booking Step 2. Leave
                      unticked to hide the set-up selector entirely for this type.
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {bedSetupsCatalog.map((option) => {
                        const checked =
                          Array.isArray(editType.bedSetupValues) &&
                          editType.bedSetupValues.includes(option.value);
                        return (
                          <label
                            key={option.value}
                            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:border-primary"
                          >
                            <input
                              type="checkbox"
                              name="bedSetupValues"
                              value={option.value}
                              defaultChecked={checked}
                              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="flex-1">{option.label}</span>
                            <span className="font-mono text-[10px] text-gray-400">
                              {option.value}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}
              </form>
            ) : null}
          </Modal>

          {/* ROOM TYPE DELETE CONFIRM (per RTS-05, 2026-08-01) */}
          <Modal
            title={pendingDeleteRoomType ? `Delete · ${pendingDeleteRoomType.label}` : "Delete room type"}
            open={!!pendingDeleteRoomType}
            onClose={() => {
              if (isDeletingRoomType) return;
              setPendingDeleteRoomType(null);
            }}
            footer={null}
          >
            {pendingDeleteRoomType ? (
              <div className="space-y-4 text-sm">
                <p className="text-xs leading-relaxed text-gray-600">
                  You are about to permanently delete the <strong>{pendingDeleteRoomType.label}</strong> room type
                  ({pendingDeleteRoomType.value}). Any new bookings will no longer be able to select this type. Historical
                  bookings keep their denormalized type, but the type is gone for new reservations and any associated
                  room-classification UI.
                </p>
                {countRoomsUsingType(pendingDeleteRoomType.value) > 0 ? (
                  <ConfirmForm
                    title="Cannot delete this room type yet"
                    message={
                      <>
                        <strong>{countRoomsUsingType(pendingDeleteRoomType.value)}</strong> room{countRoomsUsingType(pendingDeleteRoomType.value) === 1 ? "" : "s"} still
                        use this type. Reassign those rooms to a different type before deleting it.
                      </>
                    }
                    confirmLabel="Got it"
                    cancelLabel="Back"
                    variant="primary"
                    onConfirm={() => setPendingDeleteRoomType(null)}
                    onCancel={() => setPendingDeleteRoomType(null)}
                    testId="delete-room-type-blocked"
                  />
                ) : (
                  <ConfirmForm
                    title="Type a reason and confirm"
                    message={`Provide a short note for the audit log (e.g. \u201CMigrated all Standard Doubles to Deluxe, decommissioning the type\u201D).`}
                    reasonLabel="Reason (required)"
                    reasonRequired
                    reasonPlaceholder="Why is this room type being removed?"
                    confirmLabel={isDeletingRoomType ? "Deleting…" : "Delete room type permanently"}
                    variant="danger"
                    onConfirm={() => void handleDeleteRoomType(pendingDeleteRoomType.value)}
                    onCancel={() => {
                      if (isDeletingRoomType) return;
                      setPendingDeleteRoomType(null);
                    }}
                    testId="delete-room-type-confirm"
                  />
                )}
              </div>
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
                        const compressed = await compressImageFile(file, {
                          maxWidth: 1600,
                          maxHeight: 1200,
                          quality: 0.85
                        });
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
                <p className="text-[10px] leading-relaxed text-gray-500">
                  Recommended 1600x1200 (4:3). Compressed to JPEG automatically. The first photo is the hero image shown on the corporate and rooms pages.
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
                  <p className="text-sm font-semibold text-gray-900 font-mono">{activeFromEmail || config.supportEmail}</p>
                  <p className="text-[10px] text-gray-500">Used as the `from` address for all transactional emails.</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-5 space-y-2">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Admin Notification Email</span>
                  <p className="text-sm font-semibold text-gray-900 font-mono">{activeAdminEmail || config.supportEmail}</p>
                  <p className="text-[10px] text-gray-500">Receives new corporate inquiry notifications and staff alerts.</p>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-150">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Active Email Templates</h4>
                  <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold text-green-700">
                    {EMAIL_TRIGGER_GROUPS.reduce((total, group) => total + group.triggers.length, 0)} active
                  </span>
                </div>
                <div className="space-y-6">
                  {EMAIL_TRIGGER_GROUPS.map((group) => (
                    <section key={group.label} aria-labelledby={`email-group-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                      <h5
                        id={`email-group-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                        className="mb-2 text-xs font-bold text-gray-700"
                      >
                        {group.label}
                      </h5>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {group.triggers.map((trigger) => (
                          <div key={trigger.action} className="flex min-h-[92px] items-start justify-between gap-3 rounded-lg border border-gray-150 bg-white p-3 shadow-sm">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                                <span className="text-xs font-bold text-gray-800">{trigger.label}</span>
                              </div>
                              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{trigger.description}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleOpenPreview(trigger.action, trigger.label)}
                              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-primary-light hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                              title="Preview template"
                              aria-label={`Preview ${trigger.label} email template`}
                            >
                              <Eye size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
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

              <form onSubmit={(e) => { e.preventDefault(); void handleSaveIntercom(); }} className="space-y-6">
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

                <SaveActionFooter label="Save Intercom Settings" status={getSaveStatus("intercom")} />
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

              <form onSubmit={(e) => { e.preventDefault(); void handleSaveLegal(); }} className="space-y-6">
                {/* Per LCE-01 (decision #137, 2026-07-25): the
                    Terms of Service body is admin-editable.
                    Placed ABOVE Privacy Policy because it's the
                    first document the guest encounters during
                    booking consent (Step 2's "I agree to the
                    Terms" link) — surface the highest-touch
                    legal doc first. The version is auto-bumped
                    on every save (1.0.0 → 1.0.1) by the
                    dedicated POST /api/admin/update-terms
                    endpoint, so each save produces a fresh
                    consent version for the booking audit
                    trail. */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Terms of Service</h4>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                      {termsVersion && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono font-semibold text-primary">v{termsVersion}</span>}
                      {termsLastUpdated && <span>Last updated: {termsLastUpdated}</span>}
                    </div>
                  </div>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Terms of Service Body
                    <textarea
                      value={termsBody}
                      onChange={(e) => setTermsBody(e.target.value)}
                      rows={16}
                      maxLength={50000}
                      placeholder="Enter the full Terms of Service text. This is displayed on the guest-facing /terms page. If left blank, the page falls back to the deploy-configured content. Saving bumps the version (1.0.0 → 1.0.1) and is captured on every new booking's consentVersion field for the audit trail."
                      className="w-full rounded border border-gray-250 bg-gray-50/50 p-3 text-sm font-medium focus:bg-white leading-relaxed"
                    />
                  </label>
                  <p className="text-[10px] text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>Displayed at <code>/terms</code>.</span>
                    <span>Plain text only — preserves paragraph + list structure via <code>whitespace-pre-line</code> on the public page.</span>
                    <span>{termsBody.length.toLocaleString()} / 50,000 characters.</span>
                    <span>Versioning: each save auto-bumps the patch level (the major + minor are preserved).</span>
                  </p>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSaveTerms()}
                      disabled={!termsBody.trim() || termsBody.trim().length > 50000}
                      className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Save Terms (bumps version)
                    </button>
                  </div>
                </div>

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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
                      Cutoff Window (hours)
                      <input
                        type="number"
                        min="0"
                        value={cancellationCutoffHours}
                        onChange={(e) => setCancellationCutoffHours(e.target.value)}
                        className="w-full rounded border border-gray-250 bg-gray-50/50 p-2.5 text-sm font-medium focus:bg-white focus:outline-none"
                        placeholder="48"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
                      Refund % Before Cutoff
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={cancellationRefundPctBefore}
                        onChange={(e) => setCancellationRefundPctBefore(e.target.value)}
                        className="w-full rounded border border-gray-250 bg-gray-50/50 p-2.5 text-sm font-medium focus:bg-white focus:outline-none"
                        placeholder="100"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-semibold text-gray-750">
                      Refund % After Cutoff
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={cancellationRefundPctAfter}
                        onChange={(e) => setCancellationRefundPctAfter(e.target.value)}
                        className="w-full rounded border border-gray-250 bg-gray-50/50 p-2.5 text-sm font-medium focus:bg-white focus:outline-none"
                        placeholder="0"
                      />
                    </label>
                  </div>
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

                <SaveActionFooter label="Save Legal Content" status={getSaveStatus("legal")} />
              </form>
            </div>
          )}

          {/* TAB 10: ENVIRONMENT TESTING (admin-only) */}
          {activeTab === "environment" && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Environment Testing</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">Create and manage time-limited test runs for production and staging environments. Test data is visually distinct and automatically cleaned up.</p>
              </div>

              {!isAdmin ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-5 text-xs text-amber-800 flex gap-2.5 items-start">
                  <Lock size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Admin only</p>
                    <p className="mt-1 leading-relaxed">Only admin accounts can manage test runs. Sign in with an admin account to use this feature.</p>
                  </div>
                </div>
              ) : (
                <>
                  {testRunsLoading && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <RefreshCw size={14} className="animate-spin" />
                      Loading test runs...
                    </div>
                  )}

                  {/* Active run warning banner */}
                  {testRuns.filter(r => r.status === "active").length > 0 && (
                    <div className="rounded-lg bg-amber-50 border border-amber-300 p-4 text-xs text-amber-900 flex gap-2.5 items-start">
                      <FlaskConical size={16} className="shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Active Test Run</p>
                        {testRuns.filter(r => r.status === "active").map(run => (
                          <p key={run.id} className="mt-1 leading-relaxed">
                            <strong>{run.name}</strong> ({run.environment}) — expires{" "}
                            {new Date(run.expiresAt).toLocaleString()}
                          </p>
                        ))}
                        <p className="mt-2 text-amber-700">Test data is clearly marked with TEST DATA badges.</p>
                      </div>
                    </div>
                  )}

                  {/* Per QA-2026-10-23 §3.2 (2026-10-25): the hotel-wide
                      bot-protection mode. While the gate is OPEN a loud
                      banner names WHO turned it off and WHEN — a
                      testing window must never be forgotten. */}
                  {botProtectionMode === "disabled" && (
                    <div
                      role="alert"
                      data-testid="bot-protection-disabled-banner"
                      className="rounded-lg bg-red-50 border border-red-300 p-4 text-xs text-red-900 flex gap-2.5 items-start"
                    >
                      <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Bot protection is OFF</p>
                        <p className="mt-1 leading-relaxed">
                          Every public guest write endpoint — booking create / cancel /
                          extend-stay / lookup, breakfast update, add-ons update,
                          voucher, corporate code, inquiry and contact — is
                          accepting requests <strong>without a Turnstile bot token</strong>.
                        </p>
                        <p className="mt-1 leading-relaxed">
                          Turned off by <strong>{botProtectionDisabledByName}</strong>{" "}
                          on <strong>{botProtectionDisabledAtLabel}</strong>.
                        </p>
                        {botProtectionAudit.reason ? (
                          <p className="mt-1 leading-relaxed">
                            Reason: {botProtectionAudit.reason}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {/* Bot protection mode. Mirrors the OCT-M1 master
                      switch on the Other Add-Ons tab: the switch saves
                      immediately, and a failed write is reverted so the
                      switch never shows a value that is not stored. */}
                  <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
                    <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-gray-800">
                      <button
                        type="button"
                        onClick={() => {
                          void handleBotProtectionToggle(
                            botProtectionMode === "disabled" ? "turnstile" : "disabled"
                          );
                        }}
                        data-testid="bot-protection-toggle"
                        className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                          botProtectionMode === "disabled" ? "bg-red-500" : "bg-primary"
                        }`}
                        aria-pressed={botProtectionMode !== "disabled"}
                        aria-label="Enable bot protection"
                      >
                        <div
                          className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                            botProtectionMode === "disabled" ? "translate-x-0" : "translate-x-5"
                          }`}
                        />
                      </button>
                      Bot protection (Cloudflare Turnstile)
                    </label>
                    <p className="text-[10px] text-gray-500 leading-relaxed">
                      While this is <strong>ON</strong>, every public guest write endpoint
                      requires a Turnstile bot token. Turning it <strong>OFF</strong> opens
                      all of them — use it only for a short, supervised testing window
                      (for example when the Cloudflare challenge platform is unreachable
                      from the QA host), and turn it back on afterwards. The switch
                      stores the mode, who turned it off and when, and the reason, and
                      the server falls back to keeping the gate ON if it cannot read
                      the setting.
                    </p>
                    <label className="flex flex-col gap-1.5">
                      <span className="font-bold text-gray-700">
                        Reason (required to turn the gate off)
                      </span>
                      <textarea
                        value={botProtectionReason}
                        onChange={(e) => setBotProtectionReason(e.target.value)}
                        placeholder="e.g. QA run 2026-10-25 — Cloudflare challenge platform unreachable from the QA host"
                        rows={2}
                        data-testid="bot-protection-reason"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-xs min-h-[44px] focus:border-primary focus:outline-none"
                      />
                    </label>
                    {botProtectionSaveError ? (
                      <p
                        role="alert"
                        data-testid="bot-protection-error"
                        className="text-[10px] font-semibold text-red-600"
                      >
                        {botProtectionSaveError}
                      </p>
                    ) : null}
                  </div>

                  {/* Create test run */}
                  <div className="rounded-lg border border-gray-200 p-5 space-y-4">
                    <h4 className="font-bold text-gray-900">Create Test Run</h4>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="font-bold text-gray-700">Run name</span>
                        <input
                          type="text"
                          value={newRunName}
                          onChange={(e) => setNewRunName(e.target.value)}
                          placeholder="e.g. Q3 smoke test"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-primary focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="font-bold text-gray-700">Environment</span>
                        <select
                          value={newRunEnv}
                          onChange={(e) => setNewRunEnv(e.target.value as "staging" | "production")}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-primary focus:outline-none"
                        >
                          <option value="staging">Staging</option>
                          <option value="production">Production</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="font-bold text-gray-700">Duration</span>
                        <select
                          value={newRunDuration}
                          onChange={(e) => setNewRunDuration(Number(e.target.value))}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-primary focus:outline-none"
                        >
                          <option value={15}>15 minutes</option>
                          <option value={60}>1 hour</option>
                          <option value={360}>6 hours</option>
                          <option value={1440}>24 hours</option>
                          <option value={4320}>72 hours</option>
                          <option value={10080}>7 days</option>
                          <option value={43200}>30 days</option>
                        </select>
                      </label>
                    </div>
                    <button
                      onClick={handleCreateRun}
                      disabled={testRunsLoading || !newRunName.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50 transition"
                    >
                      <FlaskConical size={14} />
                      Create Test Run
                    </button>
                  </div>

                  {/* Run history */}
                  {testRuns.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-bold text-gray-900">Run History</h4>
                      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                        {testRuns.map(run => (
                          <div key={run.id} className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-3">
                              <FlaskConical size={14} className={run.status === "active" ? "text-amber-500" : run.status === "closed" ? "text-blue-500" : "text-gray-400"} />
                              <div>
                                <p className="font-bold text-gray-900">{run.name}</p>
                                <p className="text-[10px] text-gray-500">
                                  {run.environment} · Created {new Date(run.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                run.status === "active"
                                  ? "border-amber-100 bg-amber-50 text-amber-700"
                                  : run.status === "closed"
                                    ? "border-blue-100 bg-blue-50 text-blue-700"
                                    : run.status === "cleanup-in-progress"
                                      ? "border-purple-100 bg-purple-50 text-purple-700"
                                      : "border-gray-100 bg-gray-50 text-gray-500"
                              }`}>
                                {run.status === "cleanup-in-progress" ? "Cleaning..." : run.status}
                              </span>
                              {run.status === "active" && (
                                <button
                                  onClick={() => handleCloseRun(run.id)}
                                  disabled={testRunsLoading}
                                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
                                >
                                  Close
                                </button>
                              )}
                              {run.status === "closed" && (
                                <button
                                  onClick={() => setConfirmDeleteRun(run)}
                                  disabled={testRunsLoading}
                                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 transition"
                                >
                                  Clean up
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!testRunsLoading && testRuns.length === 0 && (
                    <p className="text-gray-500 italic">No test runs yet. Create one above.</p>
                  )}

                  {/* Reset operational data (staging only) */}
                  <div className="border-t border-red-200 pt-6 mt-8">
                    <div className="rounded-lg border border-red-300 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <AlertTriangle size={16} className="text-red-600" />
                        <h4 className="font-bold text-red-800">Reset Operational Data</h4>
                      </div>
                      <p className="text-red-700 text-xs leading-relaxed">
                        Deletes all bookings, store orders, notifications, intercom history, and test runs.
                        Preserves hotel settings, rooms, rates, staff accounts, catalog, and vouchers.
                        <strong className="block mt-1">This is a staging-only action.</strong>
                      </p>
                      {stagingResetAvailable ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleStagingResetPreview}
                            disabled={stagingResetLoading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-100 disabled:opacity-50 transition"
                          >
                            <RefreshCw size={14} className={stagingResetLoading ? "animate-spin" : ""} />
                            Preview & reset
                          </button>
                          {stagingResetLoading && <span className="text-xs text-gray-500">Generating manifest...</span>}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                          This control is disabled on production. Open the{" "}
                          <a
                            href={`https://stg-admin.${config.domain}`}
                            className="font-bold underline underline-offset-2"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            staging Admin app
                          </a>{" "}
                          to reset staging operational data.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Refresh Staging From Production (ETR-R) */}
                  <div className="border-t border-blue-200 pt-6 mt-8">
                    <div className="rounded-lg border border-blue-300 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <RefreshCw size={16} className="text-blue-600" />
                        <h4 className="font-bold text-blue-800">Refresh Staging From Production</h4>
                      </div>
                      <p className="text-blue-700 text-xs leading-relaxed">
                        Copy production data into staging for bug reproduction or load testing.{" "}
                        <strong className="block mt-1">This is a staging-only action.</strong>
                        Three modes:{" "}
                        <span className="font-mono">sanitized-snapshot</span> (PII replaced),{" "}
                        <span className="font-mono">config-only</span> (no bookings/orders), or{" "}
                        <span className="font-mono">unsanitized-diagnostic</span> (real PII with 5 server-enforced gates).
                      </p>
                      {stagingResetAvailable ? (
                        <div className="space-y-4">
                          {/* Mode toggle */}
                          <div>
                            <label className="block text-xs font-bold text-gray-900 mb-1.5">Mode</label>
                            <div className="flex gap-2">
                              {(["sanitized-snapshot", "config-only", "unsanitized-diagnostic"] as const).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setRefreshMode(m)}
                                  className={`min-h-[36px] rounded-lg border px-3 text-[11px] font-semibold transition ${
                                    refreshMode === m
                                      ? "border-blue-500 bg-blue-50 text-blue-800"
                                      : "border-gray-250 bg-white text-gray-700 hover:bg-gray-50"
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Export JSON input */}
                          <div>
                            <label className="block text-xs font-bold text-gray-900 mb-1.5">
                              Production export (JSON)
                            </label>
                            <p className="text-[10px] text-gray-500 mb-1.5">
                              Paste the JSON from <code>scripts/export-prod-data.mjs</code>. Must have{" "}
                              <code>export.bookings</code>, <code>export.storeOrders</code>,{" "}
                              <code>export.members</code>.
                            </p>
                            <textarea
                              value={refreshExportJson}
                              onChange={(e) => setRefreshExportJson(e.target.value)}
                              placeholder='{ "export": { "bookings": [...], "storeOrders": [...], "members": [...] } }'
                              className="w-full h-32 rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-mono focus:border-blue-400 focus:outline-none"
                            />
                          </div>

                          {/* Restricted-mode gates (only show when unsanitized-diagnostic) */}
                          {refreshMode === "unsanitized-diagnostic" && (
                            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
                              <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                                <Lock size={14} /> 5 server-enforced gates (all required)
                              </p>
                              <div>
                                <label className="block text-[11px] font-bold text-amber-900 mb-1">DPO approval reference</label>
                                <input
                                  type="text"
                                  value={refreshDpoApproval}
                                  onChange={(e) => setRefreshDpoApproval(e.target.value)}
                                  placeholder="DPO-2026-08-21-verbatim"
                                  className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs focus:border-amber-400 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-amber-900 mb-1">Defect / issue reference</label>
                                <input
                                  type="text"
                                  value={refreshDefectReference}
                                  onChange={(e) => setRefreshDefectReference(e.target.value)}
                                  placeholder="INV-1234"
                                  className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs focus:border-amber-400 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-amber-900 mb-1">Project confirmation (type the staging project name)</label>
                                <input
                                  type="text"
                                  value={refreshProjectConfirmation}
                                  onChange={(e) => setRefreshProjectConfirmation(e.target.value)}
                                  placeholder="spark-inn-staging"
                                  className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs focus:border-amber-400 focus:outline-none font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-amber-900 mb-1">Scope (booking IDs, comma-separated)</label>
                                <input
                                  type="text"
                                  value={refreshScopeBookingIds}
                                  onChange={(e) => setRefreshScopeBookingIds(e.target.value)}
                                  placeholder="bk-abc123, bk-def456"
                                  className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs focus:border-amber-400 focus:outline-none font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-amber-900 mb-1">Scope (member IDs, comma-separated)</label>
                                <input
                                  type="text"
                                  value={refreshScopeMemberIds}
                                  onChange={(e) => setRefreshScopeMemberIds(e.target.value)}
                                  placeholder="mem-789, mem-012"
                                  className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs focus:border-amber-400 focus:outline-none font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-amber-900 mb-1">TTL (hours, max 168 = 1 week)</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={168}
                                  value={refreshTtlHours}
                                  onChange={(e) => setRefreshTtlHours(Number(e.target.value))}
                                  className="w-32 rounded-lg border border-amber-200 px-3 py-2 text-xs focus:border-amber-400 focus:outline-none font-mono"
                                />
                              </div>
                              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                                <label className="flex items-start gap-2 text-[11px] font-bold text-red-900">
                                  <input
                                    type="checkbox"
                                    checked={refreshSensitiveFileOptIn}
                                    onChange={(e) => setRefreshSensitiveFileOptIn(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  <span>
                                    Include sensitive files (IDs, payment proofs, signatures) — usually leave UNCHECKED.
                                  </span>
                                </label>
                              </div>
                              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                                <label className="flex items-start gap-2 text-[11px] font-bold text-red-900">
                                  <input
                                    type="checkbox"
                                    checked={refreshAcknowledged}
                                    onChange={(e) => setRefreshAcknowledged(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  <span>
                                    I acknowledge that this brings real production PII (names, emails, phone numbers,
                                    payment data) into staging. Side effects (emails, webhooks, notifications) will
                                    be force-disabled for the snapshot duration.
                                  </span>
                                </label>
                              </div>
                            </div>
                          )}

                          {refreshError && (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                              <strong>Error:</strong> {refreshError}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleRefreshPreview}
                              disabled={refreshLoading !== null}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-50 transition"
                            >
                              <RefreshCw size={14} className={refreshLoading === "preview" ? "animate-spin" : ""} />
                              {refreshLoading === "preview" ? "Generating preview..." : "Generate preview"}
                            </button>
                            {refreshLoading && <span className="text-xs text-gray-500">Working...</span>}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                          This control is disabled on production. Open the{" "}
                          <a
                            href={`https://stg-admin.${config.domain}`}
                            className="font-bold underline underline-offset-2"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            staging Admin app
                          </a>{" "}
                          to refresh staging from production.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 11: STAFF ACCOUNTS (admin-only) */}
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
                                  <div className="shrink-0 flex flex-col gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openEditStaffModal(member)}
                                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 transition hover:bg-gray-50"
                                      title="Edit this staff account"
                                    >
                                      <Pencil size={13} />
                                      Edit
                                    </button>
                                    {member.isActive ? (
                                      <button
                                        type="button"
                                        disabled={isCurrentUser}
                                        onClick={() => openDisableStaffConfirm(member)}
                                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-100 px-3 text-[10px] font-bold text-red-650 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        title={isCurrentUser ? "You cannot disable your own account" : "Disable this staff account"}
                                      >
                                        <Lock size={13} />
                                        Disable
                                      </button>
                                    ) : null}
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
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => openEditStaffModal(member)}
                                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 transition hover:bg-gray-50"
                                          title="Edit this staff account"
                                        >
                                          <Pencil size={13} />
                                          Edit
                                        </button>
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
                                        ) : null}
                                      </div>
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

          {/* TAB 12: DISCOUNTS — per-class discount scope editor
              (DSC-01..05, 2026-08-01, per CVQ-06). Admin-only:
              front-desk staff cannot reach this surface. The
              senior row's checkboxes are additionally disabled
              for non-admins (DSC-03 guardrail — RA 9994 / RA 10754
              statutory scope). The 3×3 matrix controls which
              charge components (room · breakfast · extra bed)
              each discount class (senior · voucher · member)
              applies to. The "broad" default (all cells true)
              is byte-equivalent to the pre-DSC-01 behavior and
              matches the historical "apply to the whole bill"
              expectation. Narrowing is opt-in via unchecking
              cells; broadening back is the safe direction. */}
          {activeTab === "discounts" && (
            isAdmin ? (
              <form onSubmit={handleSaveDiscounts} className="space-y-6 text-xs">
                <div>
                  <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Discount Scope</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Choose which charge components (room · breakfast · extra bed) each discount class
                    (senior · voucher · member) applies to. The scope is snapshotted onto every new
                    booking; existing bookings are unaffected. Uncheck a cell to exclude that component
                    from the discount's base.
                  </p>
                </div>

                {(() => {
                  // The 3×3 matrix. Three classes (senior · voucher · member)
                  // × three components (room · breakfast · extra bed). The
                  // senior row is admin-only per DSC-03; non-admins see the
                  // checkboxes disabled. `row.senior/voucher/member` is the
                  // shape stored on `settings/hotelConfig.discountScope`.
                  const componentLabels: Array<{ key: "room" | "breakfast" | "extraBed"; label: string }> = [
                    { key: "room", label: "Room" },
                    { key: "breakfast", label: "Breakfast" },
                    { key: "extraBed", label: "Extra bed" }
                  ];
                  const classLabels: Array<{ key: "senior" | "voucher" | "member"; label: string; hint: string }> = [
                    {
                      key: "senior",
                      label: "Senior / PWD discount",
                      hint: "RA 9994 / RA 10754 — statutory. Admin-only."
                    },
                    {
                      key: "voucher",
                      label: "Voucher discount",
                      hint: "Hotel-issued flat or percent voucher."
                    },
                    {
                      key: "member",
                      label: `${config.rewardsName} member discount`,
                      hint: "Loyalty member base room discount."
                    }
                  ];
                  const updateScope = (
                    cls: "senior" | "voucher" | "member",
                    component: "room" | "breakfast" | "extraBed",
                    value: boolean
                  ) => {
                    setDiscountScope((prev) => ({
                      ...prev,
                      [cls]: { ...prev[cls], [component]: value }
                    }));
                  };
                  const isBroad = (cls: "senior" | "voucher" | "member") =>
                    componentLabels.every((c) => discountScope[cls][c.key]);
                  const setClassAll = (cls: "senior" | "voucher" | "member", value: boolean) => {
                    setDiscountScope((prev) => ({
                      ...prev,
                      [cls]: {
                        room: value,
                        breakfast: value,
                        extraBed: value
                      }
                    }));
                  };
                  return (
                    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left px-4 py-3 font-semibold text-gray-700 w-1/2">Discount class</th>
                            {componentLabels.map((c) => (
                              <th key={c.key} className="px-3 py-3 font-semibold text-gray-700 text-center">{c.label}</th>
                            ))}
                            <th className="px-3 py-3 font-semibold text-gray-500 text-center w-24">All</th>
                          </tr>
                        </thead>
                        <tbody>
                          {classLabels.map((cls) => {
                            const isSeniorRow = cls.key === "senior";
                            return (
                              <tr key={cls.key} className="border-b border-gray-100 last:border-0">
                                <td className="px-4 py-3 align-top">
                                  <p className="font-bold text-gray-800">{cls.label}</p>
                                  <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{cls.hint}</p>
                                </td>
                                {componentLabels.map((c) => {
                                  const checked = discountScope[cls.key][c.key];
                                  return (
                                    <td key={c.key} className="px-3 py-3 text-center align-middle">
                                      <label className="inline-flex items-center justify-center cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => updateScope(cls.key, c.key, e.target.checked)}
                                          className="h-4 w-4 cursor-pointer text-primary focus:ring-primary-light rounded border-gray-300"
                                          aria-label={`${cls.label} applies to ${c.label}`}
                                        />
                                      </label>
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-3 text-center align-middle">
                                  <button
                                    type="button"
                                    onClick={() => setClassAll(cls.key, !isBroad(cls.key))}
                                    className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
                                  >
                                    {isBroad(cls.key) ? "Uncheck all" : "Check all"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-amber-800 text-[11px] leading-relaxed">
                  <p className="font-bold flex items-center gap-1.5">
                    <ShieldAlert size={14} className="shrink-0" />
                    Senior / PWD scope (RA 9994 / RA 10754)
                  </p>
                  <p className="mt-1">
                    Narrowing the senior row below the statutory default can configure the
                    hotel into non-compliance. The chain always applies the senior
                    percentage to whichever components the scope allows; vouchers and
                    member discounts apply to the remaining components after the senior
                    step. The saved scope is snapshotted onto every new booking — a later
                    policy change here never rewrites an existing bill.
                  </p>
                </div>

                <SaveActionFooter label="Save Discount Scope" status={getSaveStatus("discounts")} />
              </form>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                <p className="font-semibold">Admin-only section</p>
                <p className="mt-1 leading-relaxed">
                  The discount scope is restricted to admin accounts. Senior/PWD scoping is
                  statutorily bounded under RA 9994 / RA 10754 — the senior row is gated
                  to admins even when this surface is reached. Ask a hotel owner to make
                  discount-scope changes.
                </p>
              </div>
            )
          )}

          {/* Per VAT-01 (2026-10-12): the Tax (VAT) card on the
              Discounts tab. Single toggle: when ON (default,
              BIR-compliant) the 12% VAT breakdown renders on
              every product surface — Reports + XLSX, admin
              booking drawer, admin print-to-PDF receipt, and
              the guest `/book` live preview. When OFF, every
              one of those sub-blocks is hidden entirely. The
              toggle is intentionally a single boolean — the
              only two real-world states are "VAT-registered"
              (12%) and "below the BIR threshold" (0%).

              Lives on the same Discounts tab as the discount-
              scope editor because both controls touch the BIR-
              reconcilable figures on the receipt. Admin-only —
              the same RA 9994-style guardrail as the discount-
              scope row. */}
          {activeTab === "discounts" && (
            isAdmin ? (
              <form onSubmit={handleSaveVat} className="space-y-6 text-xs">
                <div>
                  <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Tax (VAT)</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Turn the 12% VAT breakdown on or off across every surface. Leave ON for
                    VAT-registered hotels. Turn OFF when the hotel is below the BIR
                    VAT-registration threshold (currently ₱3M annual gross sales) — the
                    guest bill stays the same; the breakdown lines are hidden everywhere.
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="p-5">
                    <label className="flex items-start gap-3 cursor-pointer text-xs text-gray-700">
                      <button
                        type="button"
                        onClick={() => setVatEnabled((prev) => !prev)}
                        aria-label={vatEnabled ? "Turn VAT off" : "Turn VAT on"}
                        aria-pressed={vatEnabled}
                        data-testid="vat-toggle"
                        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                          vatEnabled ? "bg-primary" : "bg-gray-200"
                        }`}
                      >
                        <div
                          className={`h-5 w-5 rounded-full bg-white shadow-sm transition transform ${
                            vatEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <span className="flex-1">
                        <span className="block font-bold text-gray-800">
                          {vatEnabled ? "Show 12% VAT breakdown" : "Hide 12% VAT breakdown"}
                        </span>
                        <span className="block text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                          {vatEnabled
                            ? "Every receipt, the booking drawer, Reports, the XLSX export, and the guest live preview show the VATable Sales / VAT-Exempt Sales / VAT Amount lines (12% Philippine standard)."
                            : "VAT-exempt property. The receipt, booking drawer, Reports, XLSX export, and guest live preview omit the breakdown entirely. The bill total is unchanged."}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-blue-900 text-[11px] leading-relaxed">
                  <p className="font-bold">BIR notes</p>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    <li>Philippine VAT-registration threshold: ₱3,000,000 annual gross sales (BIR Form 1903/2551Q).</li>
                    <li>When the toggle is ON, the system computes the VAT breakdown client-side (12% PH standard) on every surface that shows a bill.</li>
                    <li>When the toggle is OFF, no VAT is added to the bill — the operator's published rate is the guest's net amount.</li>
                    <li>This control only affects what the system shows. It does NOT register or de-register the hotel with the BIR — file Form 1903 / 1904 to change registration status.</li>
                  </ul>
                </div>

                <SaveActionFooter label="Save Tax Settings" status={getSaveStatus("vat")} />
              </form>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                <p className="font-semibold">Admin-only section</p>
                <p className="mt-1 leading-relaxed">
                  The Tax (VAT) toggle is restricted to admin accounts. Changing the
                  hotel's VAT-registration status is a BIR-facing decision — ask the
                  hotel owner to make the change.
                </p>
              </div>
            )
          )}

          {/* Per the IFH-01.3 (Settings UI editor) follow-up:
              the Booking & Holds tab. Two number inputs
              (post-Confirm hold window in hours + in-flow
              hold window in minutes). Admin-only — the
              post-Confirm window is the payment-deadline
              surface (PEX-01) and the in-flow window is
              the Steps 2 + 3 countdown-banner surface
              (IFH-01). Both fields are snapshotted onto
              each booking + each hold at create / start
              time, so a later Settings change never
              shortens or lengthens an existing guest's
              promise. */}
          {activeTab === "holds" && (
            isAdmin ? (
              <form onSubmit={handleSaveHolds} className="space-y-6 text-xs">
                <div>
                  <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Booking &amp; Holds</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Two hold windows that control how long a guest's room reservation stays
                    locked, plus the longest stay a guest may book. The hold values are
                    snapshotted at the moment they matter (booking create for the payment
                    hold, hold start for the in-flow hold), so changing either here never
                    shortens or lengthens a promise already in flight. The maximum stay
                    length is NOT snapshotted — it applies to every booking from the moment
                    you save it, including stays already checked in. Front-desk users
                    cannot reach this editor.
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="grid gap-0 sm:grid-cols-2">
                    <div className="p-5 border-b sm:border-b-0 sm:border-r border-gray-100">
                      <label htmlFor="paymentHoldWindowHours" className="block text-xs font-bold text-gray-800">
                        Payment hold window
                      </label>
                      <p className="mt-1 text-[10px] text-gray-500 leading-relaxed">
                        How long a <code className="rounded bg-gray-100 px-1 py-0.5">pending</code> booking
                        (created online with payment-method = "pay-at-hotel" or
                        "gcash" + proof uploaded) holds the room before the daily
                        PEX-06 cron auto-expires it. Range
                        {" "}
                        {MIN_PAYMENT_HOLD_WINDOW_HOURS}..{MAX_PAYMENT_HOLD_WINDOW_HOURS} hours, default
                        {" "}
                        {MIN_PAYMENT_HOLD_WINDOW_HOURS === 1 ? 24 : 24}.
                        Snapshotted onto <code className="rounded bg-gray-100 px-1 py-0.5">bookings/{`{id}`}.holdExpiresAt</code> at create time.
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          id="paymentHoldWindowHours"
                          type="number"
                          inputMode="numeric"
                          min={MIN_PAYMENT_HOLD_WINDOW_HOURS}
                          max={MAX_PAYMENT_HOLD_WINDOW_HOURS}
                          step={1}
                          required
                          value={paymentHoldWindowHoursInput}
                          onChange={(e) => setPaymentHoldWindowHoursInput(e.target.value)}
                          aria-invalid={paymentHoldWindowHoursValid === null}
                          aria-describedby="paymentHoldWindowHours-help"
                          className={`w-24 rounded-lg border bg-white px-3 py-2 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 ${
                            paymentHoldWindowHoursValid === null
                              ? "border-red-300 focus:ring-red-200"
                              : "border-gray-200 focus:ring-primary/30"
                          }`}
                        />
                        <span className="text-xs text-gray-600">hours</span>
                      </div>
                      <p
                        id="paymentHoldWindowHours-help"
                        className="mt-2 text-[10px] text-gray-500"
                      >
                        {paymentHoldWindowHoursValid === null
                          ? `Enter a whole number between ${MIN_PAYMENT_HOLD_WINDOW_HOURS} and ${MAX_PAYMENT_HOLD_WINDOW_HOURS}.`
                          : "Looks good."}
                      </p>
                    </div>

                    <div className="p-5">
                      <label htmlFor="inFlowHoldMinutes" className="block text-xs font-bold text-gray-800">
                        In-flow hold window
                      </label>
                      <p className="mt-1 text-[10px] text-gray-500 leading-relaxed">
                        How long the Steps 2 + 3 countdown banner shows on the
                        public booking flow after the guest enters the form.
                        Range
                        {" "}
                        {MIN_IN_FLOW_HOLD_MINUTES}..{MAX_IN_FLOW_HOLD_MINUTES} minutes, default
                        {" "}
                        15. Snapshotted onto <code className="rounded bg-gray-100 px-1 py-0.5">bookingHolds/{`{id}`}.holdMinutes</code> at hold start.
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          id="inFlowHoldMinutes"
                          type="number"
                          inputMode="numeric"
                          min={MIN_IN_FLOW_HOLD_MINUTES}
                          max={MAX_IN_FLOW_HOLD_MINUTES}
                          step={1}
                          required
                          value={inFlowHoldMinutesInput}
                          onChange={(e) => setInFlowHoldMinutesInput(e.target.value)}
                          aria-invalid={inFlowHoldMinutesValid === null}
                          aria-describedby="inFlowHoldMinutes-help"
                          className={`w-24 rounded-lg border bg-white px-3 py-2 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 ${
                            inFlowHoldMinutesValid === null
                              ? "border-red-300 focus:ring-red-200"
                              : "border-gray-200 focus:ring-primary/30"
                          }`}
                        />
                        <span className="text-xs text-gray-600">minutes</span>
                      </div>
                      <p
                        id="inFlowHoldMinutes-help"
                        className="mt-2 text-[10px] text-gray-500"
                      >
                        {inFlowHoldMinutesValid === null
                          ? `Enter a whole number between ${MIN_IN_FLOW_HOLD_MINUTES} and ${MAX_IN_FLOW_HOLD_MINUTES}.`
                          : "Looks good."}
                      </p>
                    </div>
                  </div>

                  {/* Per MSL-01 (2026-10-15): maximum stay length.
                      Full-width because `0` = "no limit" needs more
                      explanation than the two bounded windows above,
                      and a half-width cell would truncate that copy. */}
                  <div className="border-t border-gray-100 p-5">
                    <label htmlFor="maxStayNights" className="block text-xs font-bold text-gray-800">
                      Maximum stay length
                    </label>
                    <p className="mt-1 text-[10px] text-gray-500 leading-relaxed">
                      The longest single stay a guest may book on the public site. Enter{" "}
                      <code className="rounded bg-gray-100 px-1 py-0.5">0</code> for{" "}
                      <strong>no limit</strong>. Default{" "}
                      {DEFAULT_MAX_STAY_NIGHTS}, maximum {MAX_MAX_STAY_NIGHTS} (anything longer is
                      unreachable — the calendar stops at the booking horizon anyway).
                      Enforced by the server on guest booking, walk-in, and reschedule.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        id="maxStayNights"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_MAX_STAY_NIGHTS}
                        step={1}
                        required
                        value={maxStayNightsInput}
                        onChange={(e) => setMaxStayNightsInput(e.target.value)}
                        aria-invalid={maxStayNightsValid === null}
                        aria-describedby="maxStayNights-help"
                        className={`min-h-11 w-32 rounded-lg border bg-white px-3 py-2 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 ${
                          maxStayNightsValid === null
                            ? "border-red-300 focus:ring-red-200"
                            : "border-gray-200 focus:ring-primary/30"
                        }`}
                      />
                      <span className="text-xs text-gray-600">
                        {maxStayNightsValid === 0 ? "no limit" : "nights"}
                      </span>
                    </div>
                    <p
                      id="maxStayNights-help"
                      className="mt-2 text-[10px] text-gray-500"
                    >
                      {maxStayNightsValid === null
                        ? `Enter 0 for no limit, or a whole number between ${MIN_MAX_STAY_NIGHTS} and ${MAX_MAX_STAY_NIGHTS}.`
                        : maxStayNightsValid === 0
                          ? "Unlimited — the guest can book any stay length the horizon allows."
                          : "Looks good."}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-[10px] text-blue-900/80 leading-relaxed">
                  <p>
                    <span className="font-semibold">What this doesn't change:</span> the
                    authoritative double-booking guarantee is the Firestore transaction
                    in <code className="rounded bg-white/70 px-1 py-0.5">handleCreateBooking</code> (per
                    <code className="rounded bg-white/70 px-1 py-0.5">plan/features/AVAILABILITY-LOCKING.md</code>).
                    The in-flow hold is a UX signal — shortening it does not free the
                    room faster. The payment hold controls the unpaid-pending cron (PEX-06);
                    shortening it can cancel more bookings per day.
                  </p>
                </div>

                <SaveActionFooter
                  label="Save Booking Limits"
                  status={getSaveStatus("holds")}
                  disabled={!holdsFormValid}
                />
              </form>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                <p className="font-semibold">Admin-only section</p>
                <p className="mt-1 leading-relaxed">
                  The hold windows and the maximum stay length are restricted to admin
                  accounts. The payment hold deadline is a guest-facing promise (PEX-01);
                  the in-flow hold controls the Steps 2 + 3 countdown banner on the public
                  booking flow (IFH-01); the maximum stay length decides what the public
                  date picker will accept (MSL-01). Ask a hotel owner to change these.
                </p>
              </div>
            )
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

      <Modal
        title="Edit Staff Account"
        open={Boolean(editingStaff)}
        onClose={() => !isUpdatingStaff && setEditingStaff(null)}
      >
        {editingStaff ? (
          <form onSubmit={handleUpdateStaffSubmit} className="space-y-4 text-xs">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Full Name
                <input
                  type="text"
                  required
                  value={editStaffName}
                  onChange={(e) => setEditStaffName(e.target.value)}
                  placeholder="Jane Doe"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                />
              </label>
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Email
                <input
                  type="email"
                  required
                  value={editStaffEmail}
                  onChange={(e) => setEditStaffEmail(e.target.value)}
                  placeholder="janedoe@sparkinn.com"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Phone (optional)
                <input
                  type="tel"
                  value={editStaffPhone}
                  onChange={(e) => setEditStaffPhone(e.target.value)}
                  placeholder="+63 917 000 0000"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white"
                />
              </label>
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                New Password (leave blank to keep current)
                <input
                  type="text"
                  minLength={8}
                  value={editStaffPassword}
                  onChange={(e) => setEditStaffPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="min-h-[44px] w-full rounded border border-gray-250 bg-white px-3 text-sm font-medium focus:bg-white font-mono"
                />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-gray-700">Role</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-xs font-bold transition ${
                  editStaffRole === "front-desk"
                    ? "border-primary/30 bg-primary/5 text-primary-dark"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}>
                  <input
                    type="radio"
                    name="editStaffRole"
                    value="front-desk"
                    checked={editStaffRole === "front-desk"}
                    onChange={() => setEditStaffRole("front-desk")}
                    className="h-4 w-4 accent-primary"
                  />
                  <div>
                    <div>Front Desk</div>
                    <div className="text-[10px] font-medium text-gray-500">Bookings, check-in, intercom, dashboard.</div>
                  </div>
                </label>
                <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-xs font-bold transition ${
                  editStaffRole === "admin"
                    ? "border-primary/30 bg-primary/5 text-primary-dark"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}>
                  <input
                    type="radio"
                    name="editStaffRole"
                    value="admin"
                    checked={editStaffRole === "admin"}
                    onChange={() => setEditStaffRole("admin")}
                    className="h-4 w-4 accent-primary"
                  />
                  <div>
                    <div>Admin</div>
                    <div className="text-[10px] font-medium text-gray-500">All front-desk access + Settings, Rates, Members.</div>
                  </div>
                </label>
              </div>
            </fieldset>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <button
                type="button"
                disabled={isSendingResetEmail || isUpdatingStaff}
                onClick={handleSendResetPasswordEmail}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-primary/30 px-4 text-xs font-semibold text-primary-dark hover:bg-primary-light transition disabled:opacity-60"
              >
                <Mail size={14} />
                {isSendingResetEmail ? "Sending..." : "Send Reset Email Link"}
              </button>
              
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  disabled={isUpdatingStaff || isSendingResetEmail}
                  className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingStaff || isSendingResetEmail}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={14} />
                  {isUpdatingStaff ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>

            {editStaffFormMessage ? (
              <div className={`rounded-lg border px-3 py-2 text-[10px] font-semibold ${
                editStaffFormMessage.type === "success"
                  ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                  : "border-red-100 bg-red-50 text-red-700"
              }`}>
                {editStaffFormMessage.text}
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>

      <Modal
        title={`Email Preview: ${previewingLabel || ""}`}
        open={Boolean(previewingTemplate)}
        onClose={() => {
          setPreviewingTemplate(null);
          setPreviewingLabel(null);
          setPreviewHtml(null);
          setPreviewError(null);
        }}
      >
        <div className="space-y-4">
          <p className="text-[10px] text-gray-500">
            Note: This is a preview using mock database values. Real emails will feature dynamic guest names, dates, pricing, and hotel details.
          </p>

          {previewLoading && (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <RefreshCw className="animate-spin text-primary" size={24} />
              <p className="text-xs text-gray-500 font-semibold">Generating email preview...</p>
            </div>
          )}

          {previewError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800 space-y-2">
              <p className="font-bold">Error generating preview</p>
              <p>{previewError}</p>
              <button
                type="button"
                onClick={() => void handleOpenPreview(previewingTemplate!, previewingLabel!)}
                className="rounded bg-red-100 hover:bg-red-200 px-3 py-1 font-semibold text-red-950 transition active:scale-95"
              >
                Retry
              </button>
            </div>
          )}

          {previewHtml && (
            <div className="rounded-lg border border-gray-200 overflow-hidden bg-gray-50 max-h-[600px] overflow-y-auto">
              <iframe
                title="Email Template Preview"
                srcDoc={previewHtml}
                className="w-full min-h-[500px] border-0"
              />
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-gray-150">
            <button
              type="button"
              onClick={() => {
                setPreviewingTemplate(null);
                setPreviewingLabel(null);
                setPreviewHtml(null);
                setPreviewError(null);
              }}
              className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Per BR-02 (decision #231, 2026-10-12, breakfast redesign):
          the legacy "Add/Edit Breakfast Menu Item" Modal is gone.
          The new meals table on the Breakfast & Dining tab uses
          inline editing (no modal). The `Modal` block above (the
          bottom of the previous file) used `editingSilogItem` /
          `isBreakfastItemModalOpen` / `breakfastItemNameInput` —
          all three state hooks were removed from the SettingsPage
          body in this same ticket. */}

      {/* Cleanup confirmation modal */}
      <Modal
        title="Clean up test data?"
        open={confirmDeleteRun !== null}
        onClose={() => setConfirmDeleteRun(null)}
      >
        <div className="space-y-4 text-xs">
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-800">
            <p className="font-bold">This action is irreversible.</p>
            <p className="mt-1">
              All data tagged under this test run will be permanently deleted.
              {confirmDeleteRun?.manifest && (
                <span className="block mt-2">
                  Manifest: {confirmDeleteRun.manifest.bookings} bookings, {confirmDeleteRun.manifest.storeOrders} store orders
                </span>
              )}
            </p>
          </div>
          <p>
            Rooms affected by the test run will be reset to available/clean.
            Reference counters are preserved.
          </p>
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setConfirmDeleteRun(null)}
              className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmCleanup}
              disabled={testRunsLoading}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-600 px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50 active:scale-95"
            >
              <Trash2 size={14} />
              Clean up data
            </button>
          </div>
        </div>
      </Modal>

      {/* Staging Reset confirmation modal */}
      <Modal
        title="Reset operational data?"
        open={showStagingResetModal}
        onClose={() => {
          setShowStagingResetModal(false);
          setStagingResetConfirmText("");
          setStagingResetProjectName("");
        }}
      >
        <div className="space-y-5 text-xs">
          {stagingResetPreview && (
            <>
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-800 space-y-2">
                <p className="font-bold flex items-center gap-2">
                  <AlertTriangle size={14} />
                  This will permanently delete all operational data
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
                  <span>Project:</span>
                  <span className="font-mono font-bold">{stagingResetPreview.projectId}</span>
                  <span>Bookings:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.bookings}</span>
                  <span>Store orders:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.storeOrders}</span>
                  <span>Notifications:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.notifications}</span>
                  <span>Intercom stays:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.intercomStays}</span>
                  <span>Test runs:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.testRuns}</span>
                  <span>Call sessions:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.calls}</span>
                  <span>Daily Close records:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.dailyCloses}</span>
                  <span>Corporate inquiries:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.corporateInquiries}</span>
                  <span>Room blocks:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.roomBlocks}</span>
                  <span>Cleanup history:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.cleanupHistory}</span>
                  <span>Affected rooms:</span>
                  <span className="font-bold">{stagingResetPreview.manifest.affectedRooms.length}</span>
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-blue-800">
                <p className="font-bold">The following are preserved:</p>
                <ul className="mt-1 list-disc list-inside text-[11px] space-y-0.5">
                  <li>Hotel settings, branding, legal content</li>
                  <li>Rooms, room types, rates</li>
                  <li>Staff accounts</li>
                  <li>Payment methods</li>
                  <li>Store catalog and items</li>
                  <li>Vouchers and corporate codes</li>
                  <li>Reference counters (no reused references)</li>
                </ul>
              </div>

              <div className="space-y-3">
                <p className="font-bold text-gray-900">Type <code className="text-red-600">RESET STAGING</code> to confirm:</p>
                <input
                  type="text"
                  value={stagingResetConfirmText}
                  onChange={(e) => setStagingResetConfirmText(e.target.value)}
                  placeholder="RESET STAGING"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-red-400 focus:outline-none font-mono"
                />
                <p className="font-bold text-gray-900">Type the project name to confirm:</p>
                <input
                  type="text"
                  value={stagingResetProjectName}
                  onChange={(e) => setStagingResetProjectName(e.target.value)}
                  placeholder={stagingResetPreview.projectId}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-red-400 focus:outline-none font-mono"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setShowStagingResetModal(false);
                setStagingResetConfirmText("");
                setStagingResetProjectName("");
              }}
              className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStagingResetExecute}
              disabled={stagingResetLoading || stagingResetConfirmText !== "RESET STAGING" || stagingResetProjectName !== stagingResetPreview?.projectId}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-600 px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50 active:scale-95"
            >
              <Trash2 size={14} />
              {stagingResetLoading ? "Resetting..." : "Execute reset"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Staging Refresh preview modal (ETR-R) */}
      <Modal
        title="Refresh preview"
        open={showRefreshModal}
        onClose={() => {
          setShowRefreshModal(false);
          setRefreshError(null);
        }}
      >
        <div className="space-y-5 text-xs">
          {refreshPreview && (
            <>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900 space-y-2">
                <p className="font-bold">Sanitized export summary</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
                  <span>Mode:</span>
                  <span className="font-mono font-bold">{refreshPreview.options?.mode || refreshMode}</span>
                  <span>Snapshot ID:</span>
                  <span className="font-mono text-[10px]">{refreshSnapshotId}</span>
                  <span>Bookings (sanitized):</span>
                  <span className="font-bold">{refreshPreview.sanitizedCounts?.bookings ?? refreshPreview.sanitizedExport?.bookings?.length ?? 0}</span>
                  <span>Store orders (sanitized):</span>
                  <span className="font-bold">{refreshPreview.sanitizedCounts?.storeOrders ?? refreshPreview.sanitizedExport?.storeOrders?.length ?? 0}</span>
                  <span>Members (sanitized):</span>
                  <span className="font-bold">{refreshPreview.sanitizedCounts?.members ?? refreshPreview.sanitizedExport?.members?.length ?? 0}</span>
                  <span>Source hash (SHA-256):</span>
                  <span className="font-mono text-[10px] truncate" title={refreshPreview.sourceHash}>
                    {refreshPreview.sourceHash ? `${refreshPreview.sourceHash.slice(0, 16)}…` : "—"}
                  </span>
                  <span>Sanitization version:</span>
                  <span className="font-mono">{refreshPreview.sanitizationVersion || "1.0"}</span>
                </div>
              </div>

              {refreshPreview.denylistHits && refreshPreview.denylistHits.length > 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 space-y-2">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} />
                    Denylist hits found — import will fail closed
                  </p>
                  <ul className="list-disc list-inside text-[11px] space-y-1">
                    {refreshPreview.denylistHits.map((hit: any, i: number) => (
                      <li key={i}>
                        <span className="font-mono">{hit.collection}</span> / <span className="font-mono">{hit.field}</span> matched{" "}
                        <span className="font-mono">{hit.pattern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {refreshPreview.mode === "unsanitized-diagnostic" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 space-y-2">
                  <p className="font-bold">Restricted Diagnostic Mode is active</p>
                  <ul className="list-disc list-inside text-[11px] space-y-0.5">
                    <li>Real PII lands in staging (PII sanitization is OFF)</li>
                    <li>Side effects (emails, webhooks, notifications) are force-disabled</li>
                    <li>Auto-destroy at: {refreshPreview.expiresAt ? new Date(refreshPreview.expiresAt).toLocaleString() : "24h from import"}</li>
                  </ul>
                </div>
              )}

              {refreshError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <strong>Error:</strong> {refreshError}
                </div>
              )}

              <div className="flex justify-between gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowDestroyConfirm(true)}
                  disabled={refreshLoading !== null || refreshPreview.alreadyImported !== true}
                  title={refreshPreview.alreadyImported !== true ? "Import first, then destroy" : ""}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 text-xs font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                  {refreshLoading === "destroy" ? "Destroying..." : "Destroy snapshot"}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRefreshModal(false);
                      setRefreshError(null);
                    }}
                    className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshImport}
                    disabled={refreshLoading !== null || refreshPreview.alreadyImported === true || (refreshPreview.denylistHits && refreshPreview.denylistHits.length > 0)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 active:scale-95"
                  >
                    <Database size={14} />
                    {refreshLoading === "import" ? "Importing..." : refreshPreview.alreadyImported ? "Already imported" : "Import to staging"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Staging Refresh destroy confirmation modal (ETR-R) */}
      <Modal
        title="Destroy refresh snapshot?"
        open={showDestroyConfirm}
        onClose={() => {
          setShowDestroyConfirm(false);
          setDestroyConfirmText("");
        }}
      >
        <div className="space-y-5 text-xs">
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-800 space-y-2">
            <p className="font-bold flex items-center gap-2">
              <AlertTriangle size={14} />
              This will permanently delete every booking, store order, and member imported by this snapshot.
            </p>
            <p className="text-[11px]">
              The query key is <code className="font-mono">sourceSanitization.snapshotId</code>. Docs that
              were not imported by this snapshot are NOT affected.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-bold text-gray-900">Type <code className="text-red-600">DESTROY SNAPSHOT</code> to confirm:</p>
            <input
              type="text"
              value={destroyConfirmText}
              onChange={(e) => setDestroyConfirmText(e.target.value)}
              placeholder="DESTROY SNAPSHOT"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-red-400 focus:outline-none font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setShowDestroyConfirm(false);
                setDestroyConfirmText("");
              }}
              className="min-h-[40px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRefreshDestroy}
              disabled={refreshLoading === "destroy" || destroyConfirmText !== "DESTROY SNAPSHOT"}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-600 px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50 active:scale-95"
            >
              <Trash2 size={14} />
              {refreshLoading === "destroy" ? "Destroying..." : "Destroy snapshot"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
