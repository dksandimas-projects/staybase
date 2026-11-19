import { Download, Maximize2 } from "lucide-react";
import { useState } from "react";
import {
  paymentQrDownloadUrl,
  paymentQrFileExtension,
  paymentQrFileName
} from "@spark-inn/shared";
import { Modal } from "./Modal";
import { PrimaryButton } from "./PrimaryButton";
import { cn } from "../utils/cn";

// Per decision #320 (2026-11-19): the payment-method QR tile.
//
// WHAT IT SOLVES: the Review & Pay step of the guest booking flow
// rendered the selected method's QR as a 160px thumbnail and nothing
// else. A guest who wants to scan it had to squint at the thumbnail, and
// a guest who wants to SAVE it (to send to whoever is paying for them,
// or to keep it for a later transfer) had no way to do it at all —
// `<img>` cannot be long-pressed into a file on every platform, and the
// Storage URL is cross-origin, so the `download` attribute would be
// ignored anyway.
//
// THE TWO ACTIONS:
//
//   1. VIEW FULL SIZE — a modal with the QR rendered large enough to
//      scan from a phone screen. The modal is the guest app's own
//      `Modal`, which (as of this change) carries `role="dialog"`,
//      `aria-modal`, a focus trap, Escape-to-close and a body scroll
//      lock.
//
//   2. DOWNLOAD — a same-origin fetch of
//      `GET /api/public/payment-qr?method=<key>`, which streams the
//      admin-uploaded file back with `Content-Disposition: attachment`.
//      It MUST be same-origin: the Storage bucket echoes
//      `access-control-allow-origin` only for the origins the hotel
//      configured, so on a white-label domain a cross-origin `fetch()`
//      is blocked and a cross-origin `download` attribute is ignored.
//      See `shared/utils/paymentQr.ts`.
//
// The component is deliberately presentational: the caller supplies the
// method key, the label and the QR URL it already has, so the three
// surfaces that render a payment QR (the public booking flow, the
// corporate booking flow and the in-room store panel) share one
// implementation instead of three copies of the markup.

interface PaymentQrCodeProps {
  /** The admin-configured payment-method key (e.g. `gcash`). */
  method: string;
  /** The method's display label (e.g. `GCash`). */
  label: string;
  /** The QR image URL. When empty, the fallback notice is rendered. */
  qrUrl?: string;
  /** The thumbnail's own classes (the surfaces use different sizes). */
  imageClassName?: string;
  /** The copy shown when the hotel has not configured a QR yet. */
  fallbackText?: string;
  /** Classes for the component's root element. */
  className?: string;
  /** Whether to show the "tap to view full size" hint under the QR. */
  showHint?: boolean;
}

const DEFAULT_FALLBACK_TEXT =
  "QR code not yet configured. Please contact the front desk for payment details.";

export function PaymentQrCode({
  method,
  label,
  qrUrl,
  imageClassName = "h-40 w-40 object-contain rounded",
  fallbackText = DEFAULT_FALLBACK_TEXT,
  className,
  showHint = true
}: PaymentQrCodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(paymentQrDownloadUrl(method));
      if (!response.ok) {
        setDownloadError(
          "We could not prepare the download. Please try again, or contact the front desk for the payment details."
        );
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = paymentQrFileName(method, paymentQrFileExtension(blob.type));
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // The object URL is revoked on the next tick — revoking it
      // synchronously can cancel the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      setDownloadError(
        "We could not prepare the download. Please try again, or contact the front desk for the payment details."
      );
    } finally {
      setIsDownloading(false);
    }
  };

  if (!qrUrl) {
    return (
      <p className={cn("px-4 text-center text-xs text-gray-500", className)}>{fallbackText}</p>
    );
  }

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <button
        type="button"
        aria-label={`View ${label} QR code full size`}
        className="group relative flex items-center justify-center rounded focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        onClick={() => setIsOpen(true)}
      >
        <img src={qrUrl} alt={`${label} QR code`} className={imageClassName} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-gray-950/0 opacity-0 transition group-hover:bg-gray-950/40 group-hover:opacity-100"
        >
          <Maximize2 className="text-white" size={24} />
        </span>
      </button>

      {showHint ? (
        <p className="mt-2 text-center text-[11px] text-gray-500">
          Tap the QR code to view it full size.
        </p>
      ) : null}

      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        size="xl"
        title={`${label} QR Code`}
      >
        <div className="flex flex-col items-center gap-4">
          <img
            src={qrUrl}
            alt={`${label} QR code`}
            className="max-h-[55vh] w-auto max-w-full rounded-lg border border-gray-200 bg-white object-contain p-3"
          />
          <p className="text-center text-xs text-gray-600">
            Scan this code with your banking app to pay, or download it to save or share.
          </p>
          <PrimaryButton type="button" onClick={handleDownload} disabled={isDownloading}>
            <Download size={16} aria-hidden="true" />
            {isDownloading ? "Preparing download…" : "Download QR code"}
          </PrimaryButton>
          {downloadError ? (
            <p className="text-center text-xs font-medium text-red-600" role="alert">
              {downloadError}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
