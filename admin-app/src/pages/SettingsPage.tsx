import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAdmin, type StoreItem } from "../context/AdminContext";
import {
  compressImageFile,
  DEFAULT_CORPORATE_PAGE_CONTENT,
  MAX_PAYMENT_METHOD_QR_BYTES,
  MAX_ROOM_TYPE_PHOTOS,
  PROTECTED_PAYMENT_METHODS,
  UNSUPPORTED_PAYMENT_METHODS,
  getEffectiveStorePaymentMethods,
  type PaymentMethodConfig,
  type ProtectedPaymentMethod,
  type RoomTypeEntry
} from "@spark-inn/shared";
import {
  Settings, Globe, Gift, Coffee, ShoppingBag,
  Save, Landmark, Sparkles, Check, CheckSquare, Square,
  BedDouble, Plus, Trash2, ShieldAlert, ImageIcon, Package, Pencil,
  Mail, Users, Scale, MessageSquare, Volume2, GripVertical, UserCog, Lock,
  Upload, ChevronLeft, ChevronRight, X, Palette, ImagePlus, RotateCcw, Building2,
  Award, Star, CreditCard, AlertTriangle, ArrowUp, ArrowDown, Wallet, Banknote
} from "lucide-react";
import config from "@config";
import { formatPrice } from "../utils/format";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useBreakpoint } from "../utils/useBreakpoint";
import { ListEditor, type ListEditorItem } from "../components/ListEditor";
import { TypePicker } from "../components/TypePicker";

type TabId = "hotel" | "payment" | "roomtypes" | "branding" | "website" | "rewards" | "breakfast" | "store" | "email" | "intercom" | "legal" | "staff";

const VALID_TAB_IDS: TabId[] = [
  "hotel",
  "payment",
  "roomtypes",
  "branding",
  "website",
  "rewards",
  "breakfast",
  "store",
  "email",
  "intercom",
  "legal",
  "staff"
];

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
  return { method: "", label: "", accountName: "", accountNumber: "", qrUrl: "", isEnabled: true };
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
      isEnabled: pm.isEnabled
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
        <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Booking Payment Methods</h3>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Add, edit, and remove the payment methods shown to guests on <code>/book</code> Step 3. QR codes are uploaded once per method and rendered inline in the booking page.
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
            return (
              <div
                key={pm.method}
                className={`rounded-xl border bg-white p-4 shadow-sm transition ${
                  pm.isEnabled ? "border-gray-200" : "border-gray-200 opacity-60"
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
                      {!pm.isEnabled && (
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
                    {/* Per #111 (per-method surface toggles):
                        three independent switches control which
                        surfaces the method is shown on. The leftmost
                        switch is the existing `isEnabled` (the
                        regular-booking surface). The next two pills
                        toggle `showInStore` and `showInCorporate`.
                        Each click persists via `onUpdate` so the
                        UI is optimistic + the Firestore doc is
                        updated in place. The pills use a clear
                        color (orange = on, gray = off) so admins
                        can see the current surface availability
                        at a glance. */}
                    <div className="flex items-center gap-1.5 mr-1">
                      {/* Booking (existing enable toggle) */}
                      <button
                        type="button"
                        onClick={() => handleToggle(pm.method)}
                        title={pm.isEnabled ? "Visible on regular booking" : "Hidden from regular booking"}
                        aria-label={pm.isEnabled ? `Hide ${pm.label} from regular booking` : `Show ${pm.label} on regular booking`}
                        className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                          pm.isEnabled ? "bg-primary" : "bg-gray-200"
                        }`}
                      >
                        <div
                          className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                            pm.isEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      {/* In-store surface pill */}
                      <button
                        type="button"
                        onClick={() => handleToggleSurface(pm.method, "showInStore")}
                        title={pm.showInStore !== false ? "Visible on in-room store" : "Hidden from in-room store"}
                        aria-label={pm.showInStore !== false ? `Hide ${pm.label} from in-room store` : `Show ${pm.label} on in-room store`}
                        className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                          pm.showInStore !== false ? "bg-primary" : "bg-gray-200"
                        }`}
                      >
                        <div
                          className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                            pm.showInStore !== false ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      {/* Corporate surface pill */}
                      <button
                        type="button"
                        onClick={() => handleToggleSurface(pm.method, "showInCorporate")}
                        title={pm.showInCorporate !== false ? "Visible on corporate booking" : "Hidden from corporate booking"}
                        aria-label={pm.showInCorporate !== false ? `Hide ${pm.label} from corporate booking` : `Show ${pm.label} on corporate booking`}
                        className={`h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                          pm.showInCorporate !== false ? "bg-primary" : "bg-gray-200"
                        }`}
                      >
                        <div
                          className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                            pm.showInCorporate !== false ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
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

// Read-only panel rendered in the Store tab when
// `useBookingPaymentMethods === true`. Shows the de-duped,
// source-tagged list computed by
// `getEffectiveStorePaymentMethods` in
// `shared/utils/storePaymentMethods.ts`. Each row is either a
// store-sourced method (`cod` / `add-to-bill`, label editable
// inline) or a booking-sourced method (label + a "Configure →"
// deep link to the booking tab). Toggling the methods on/off
// for the booking-sourced entries happens in the booking tab —
// the store tab never edits the booking list directly.
interface EffectiveStoreMethodsPanelProps {
  storeConfig: {
    useBookingPaymentMethods: true;
    paymentMethods: Array<{
      method: string;
      label: string;
      isEnabled: boolean;
      qrUrl?: string;
      accountInfo?: string;
    }>;
  };
  bookingMethods: Array<{
    method: string;
    label: string;
    isEnabled: boolean;
    qrUrl?: string;
    accountName?: string;
    accountNumber?: string;
  }>;
  storeEnabled: boolean;
  onConfigureBooking: () => void;
  onEditCodLabel: (label: string) => void;
  onEditAddToBillLabel: (label: string) => void;
}

function EffectiveStoreMethodsPanel({
  storeConfig,
  bookingMethods,
  storeEnabled,
  onConfigureBooking,
  onEditCodLabel,
  onEditAddToBillLabel
}: EffectiveStoreMethodsPanelProps) {
  const effective = getEffectiveStorePaymentMethods(storeConfig, bookingMethods);
  if (effective.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-sm font-semibold text-gray-700">No payment methods available</p>
        <p className="mt-1 text-[11px] text-gray-500">
          Enable at least one method in <button type="button" onClick={onConfigureBooking} className="font-semibold text-primary underline">Settings → Payment Methods</button>.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {effective.map((m) => {
          const isStoreSpecific = m.source === "store";
          const isCod = m.method === "cod";
          const isAddToBill = m.method === "add-to-bill";
          return (
            <div
              key={m.method}
              className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-gray-900 truncate">{m.label}</p>
                  <p className="mt-0.5 text-[10px] font-mono text-gray-500">{m.method}</p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    isStoreSpecific
                      ? "bg-gray-100 text-gray-600"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {isStoreSpecific ? "Store" : "Booking"}
                </span>
              </div>
              {isCod ? (
                <label className="mt-3 flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                  Label
                  <input
                    type="text"
                    value={m.label}
                    onChange={(e) => onEditCodLabel(e.target.value)}
                    disabled={!storeEnabled}
                    placeholder="Cash on Delivery"
                    className="min-h-[36px] w-full rounded border border-gray-250 bg-gray-50/50 px-2.5 text-xs font-medium text-gray-800 focus:bg-white disabled:cursor-not-allowed"
                  />
                </label>
              ) : isAddToBill ? (
                <label className="mt-3 flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                  Label
                  <input
                    type="text"
                    value={m.label}
                    onChange={(e) => onEditAddToBillLabel(e.target.value)}
                    disabled={!storeEnabled}
                    placeholder="Add to Bill"
                    className="min-h-[36px] w-full rounded border border-gray-250 bg-gray-50/50 px-2.5 text-xs font-medium text-gray-800 focus:bg-white disabled:cursor-not-allowed"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={onConfigureBooking}
                  className="mt-3 inline-flex min-h-[36px] items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                >
                  Configure in Payment Methods →
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-500">
        Toggle each method on/off in <button type="button" onClick={onConfigureBooking} className="font-semibold text-primary underline">Settings → Payment Methods</button>. Store-specific labels can be edited inline above.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const {
    hotelConfig,
    websiteContent,
    websiteContentLoading,
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
    paymentMethods,
    addPaymentMethod,
    updatePaymentMethod,
    reorderPaymentMethods,
    deletePaymentMethod,
    uploadPaymentMethodQr,
    resetPaymentMethodQr
  } = useAdmin();
  const toast = useToast();
  const { isMobile } = useBreakpoint();

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
  const [visionStatement, setVisionStatement] = useState(hotelConfig.visionStatement);
  const [hotelStory, setHotelStory] = useState(hotelConfig.hotelStory);
  // Phase 11.8 PR 3 — the 6 hotel contact details become admin-
  // editable runtime overrides. Each falls back to the deploy-time
  // `hotel.config.ts` value via `pickString` in the public hook
  // when these state values are empty (i.e. the admin hasn't
  // overridden yet).
  const [address, setAddress] = useState(hotelConfig.address);
  const [frontDeskPhone, setFrontDeskPhone] = useState(hotelConfig.frontDeskPhone);
  const [supportEmail, setSupportEmail] = useState(hotelConfig.supportEmail);
  const [dpoEmail, setDpoEmail] = useState(hotelConfig.dpoEmail);
  const [facebookUrl, setFacebookUrl] = useState(hotelConfig.facebookUrl);
  const [instagramUrl, setInstagramUrl] = useState(hotelConfig.instagramUrl);

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
  // Per `plan/features/SETTINGS.md §11 Store` — when `true`, the
  // store inherits the enabled methods from
  // `settings/hotelConfig.paymentMethods[]` (filtered by
  // `getEffectiveStorePaymentMethods` in
  // `shared/utils/storePaymentMethods.ts`). The `cod` and
  // `add-to-bill` entries remain editable for their labels; the
  // `gcash` QR + accountInfo fields on the legacy
  // `storeConfig.paymentMethods[]` entry are ignored in this
  // mode (the booking method's `qrUrl` / `accountName` /
  // `accountNumber` are used instead). Default `false`
  // preserves the legacy 3-method UX exactly.
  const [useBookingPaymentMethods, setUseBookingPaymentMethods] = useState<boolean>(
    storeConfig.useBookingPaymentMethods === true
  );
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
    setUseBookingPaymentMethods(storeConfig.useBookingPaymentMethods === true);
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
  }, [storeConfig, hotelConfig, websiteContent, rewardsConfig]);

  // Handle Form submissions
  const handleSaveHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("hotelConfig", {
      hotelName,
      address,
      frontDeskPhone,
      supportEmail,
      dpoEmail,
      facebookUrl,
      instagramUrl,
      contactEmail,
      contactPhone,
      checkInTime,
      checkOutTime,
      missionStatement,
      visionStatement,
      hotelStory
    });
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
    await updateSettings("websiteContent", {
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
      }
    });
  };

  // Persist all hero copy fields to `settings/websiteContent`. Logo
  // and hero-photo overrides are saved on their own (upload / reset
  // buttons) and do not flow through this form.
  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings("websiteContent", {
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
      }
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
      paymentMethods: storePaymentMethods,
      useBookingPaymentMethods
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
    { id: "payment" as const, label: "Payment Methods", icon: CreditCard },
    { id: "roomtypes" as const, label: "Room Types", icon: BedDouble },
    { id: "branding" as const, label: "Branding", icon: Palette },
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
                Hotel Vision Statement
                <textarea
                  value={visionStatement}
                  onChange={(e) => setVisionStatement(e.target.value)}
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
                  Optional runtime overrides of the deploy-time white-label values. Leave a field blank to use the white-label default.
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
                <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
              </div>

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

                <div className="space-y-4 rounded-card border border-gray-150 bg-gray-50/40 p-4">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    About hero
                  </div>
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

                <div className="space-y-4 rounded-card border border-gray-150 bg-gray-50/40 p-4">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <Building2 size={12} /> Corporate hero
                  </div>
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

                <div className="space-y-4 rounded-card border border-gray-150 bg-gray-50/40 p-4">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <Award size={12} /> Rewards hero
                  </div>
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

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                >
                  <Save size={14} />
                  Save Hero Copy
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: WEBSITE CONTENT — list-shaped homepage content
              (amenities, services, featured rooms, Spark Rewards
              promo). Hero photos + hero copy live in the Branding
              tab. All sub-objects persist to settings/websiteContent
              via the single "Save Content" button. */}
          {activeTab === "website" && (
            <form onSubmit={handleSaveWebsiteContent} className="space-y-8 text-xs">
              <div>
                <h3 className="text-base font-heading text-gray-950 lowercase tracking-tight">Guest Web Landing Editor</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  List-based content for the public site. Hero photos and hero copy live in the{" "}
                  <button type="button" onClick={() => setActiveTab("branding")} className="font-bold text-primary hover:underline">Branding</button>{" "}
                  tab.
                </p>
              </div>

              {/* Amenities grid */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Homepage Amenities</h4>
                <p className="text-[10px] text-gray-500">
                  Four-up grid on the homepage. Each card shows an icon, a title, and a short description. Disabled items are hidden from the guest site.
                </p>
                <ListEditor
                  label="Amenity items"
                  helper="Add or remove the boutique amenities shown to guests on the homepage. Reorder by using the up/down handles."
                  value={homepageAmenities}
                  onChange={setHomepageAmenities}
                  defaultIcon="sparkles"
                />
              </div>

              {/* Featured types selector (replaces the old per-room
                  picker; see TypePicker for the rationale). The
                  admin picks room types; the homepage renders one
                  card per type with the type's photo, bed,
                  amenities, capacity, and price. */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Featured Room Types</h4>
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
              </div>

              {/* Services cards */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Homepage Services</h4>
                <p className="text-[10px] text-gray-500">
                  Two-up service cards (Tour Packages, Car Rentals) that link to the contact form. The CTA is always &quot;Contact us&quot; → <code>/contact</code> and is not editable.
                </p>
                <ListEditor
                  label="Service items"
                  helper="Add or remove the service cards. Disable to hide a card from the homepage without deleting its content."
                  value={homepageServices}
                  onChange={setHomepageServices}
                  defaultIcon="palmtree"
                />
              </div>

              {/* Spark Rewards promo */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100 pb-1.5">Spark Rewards Promo</h4>
                <p className="text-[10px] text-gray-500">
                  The dark promo block on the homepage that advertises the loyalty program. Hides entirely when disabled.
                </p>
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
              </div>

              {/* Corporate page — perks, rooms overview copy, and the
                  retreat CTA banner. The corporate hero is owned by
                  the Branding tab; this section owns the rest of the
                  page. Fields with no override here fall back to
                  hardcoded copy in `CorporateStaysPage` so the page
                  is never blank on a fresh deploy. */}
              <div className="space-y-6 rounded-card border border-gray-150 bg-gray-50/30 p-5">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  <Building2 size={12} /> Corporate page
                </div>
                <p className="text-[10px] text-gray-500 -mt-3">
                  Editable content for <code>/corporate</code> other than the hero. The dark hero (eyebrow, heading, subtext, photo) lives in the{" "}
                  <button type="button" onClick={() => setActiveTab("branding")} className="font-bold text-primary hover:underline">Branding</button>{" "}
                  tab.
                </p>

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
              </div>

              <div className="pt-2 border-t border-gray-150 flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-6 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                >
                  <Save size={14} />
                  Save Content
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

                {/* Toggle: use the booking payment list as the
                    single source of truth. When ON, the store
                    inherits the enabled methods from
                    `settings/hotelConfig.paymentMethods[]`
                    (filtered to `isEnabled: true`, excluding
                    `pay-at-hotel`) plus the 2 store-specific
                    methods (`cod` + `add-to-bill`). When OFF,
                    the legacy 3-method UI below is shown. The
                    effective list is computed at read time by
                    `getEffectiveStorePaymentMethods` in
                    `shared/utils/storePaymentMethods.ts` — no
                    denormalization, no migration risk when
                    toggling on/off. See
                    `plan/features/SETTINGS.md §11 Store`. */}
                <label className={`flex items-start gap-3 text-xs font-bold ${storeEnabled ? "text-gray-800 cursor-pointer" : "text-gray-400 cursor-not-allowed"}`}>
                  <button
                    type="button"
                    onClick={() => storeEnabled && setUseBookingPaymentMethods(!useBookingPaymentMethods)}
                    disabled={!storeEnabled}
                    aria-pressed={useBookingPaymentMethods}
                    aria-label="Use booking payment methods"
                    className={`mt-0.5 h-6 w-11 rounded-full p-0.5 transition shrink-0 ${
                      useBookingPaymentMethods ? "bg-primary" : "bg-gray-200"
                    } disabled:opacity-50`}
                  >
                    <div className={`h-5 w-5 rounded-full bg-white transition shadow-sm transform ${
                      useBookingPaymentMethods ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  <span className="flex-1 min-w-0">
                    Use booking payment methods
                    <span className="mt-0.5 block text-[10px] font-normal leading-relaxed text-gray-500">
                      When on, the store inherits the enabled methods from Settings → Payment Methods. "Cash on Delivery" and "Add to Bill" are always available.
                    </span>
                  </span>
                </label>

                {useBookingPaymentMethods ? (
                  <EffectiveStoreMethodsPanel
                    storeConfig={{ useBookingPaymentMethods: true, paymentMethods: storePaymentMethods }}
                    bookingMethods={Array.isArray(hotelConfig?.paymentMethods) ? hotelConfig.paymentMethods : []}
                    onConfigureBooking={() => setActiveTab("payment")}
                    onEditCodLabel={(label) => updateStorePaymentMethod("cod", { label })}
                    onEditAddToBillLabel={(label) => updateStorePaymentMethod("add-to-bill", { label })}
                    storeEnabled={storeEnabled}
                  />
                ) : (
                  <>
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
                  </>
                )}
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
