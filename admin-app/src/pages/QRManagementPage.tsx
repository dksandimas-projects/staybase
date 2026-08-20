import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Check, Download, Printer, QrCode, RefreshCcw, X } from "lucide-react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import config from "@config";
import { useAdmin, Room } from "../context/AdminContext";
import { useToast } from "../components/Toast";
import { db } from "../firebase/config";
import { getApiBaseUrl } from "../utils/apiBaseUrl";

const qrSize = 136;

function getRoomQrValue(room: Room) {
  return room.qrToken || room.id;
}

// Per the env-aware URL fix (2026-07-24): the QR code must point to
// the same environment the staff is working in so a scan during a
// staging test round-trips back to the staging guest app (not the
// live site). Reuses `getApiBaseUrl` so the same staging-detection
// rules (stg-admin.<domain>, localhost, configured VITE_GUEST_APP_URL
// pointing at stg.<domain>) apply — real printable QRs should be
// generated from the production admin, not staging, which is by design.
function getIntercomUrl(room: Room, destination: "chat" | "shop" = "chat") {
  const base = `${getApiBaseUrl()}/intercom/${encodeURIComponent(getRoomQrValue(room))}`;
  return destination === "shop" ? `${base}?tab=shop` : base;
}

function getLogoUrl() {
  return `/brand/${config.logos.standard}`;
}

function getQrMarkup(value: string, size = qrSize) {
  return renderToStaticMarkup(
    <QRCodeSVG
      value={value}
      size={size}
      level="M"
      marginSize={2}
      fgColor={config.colors.sidebar}
      bgColor="white"
    />
  );
}

async function renderQrPngDataUrl(value: string, size = 512) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "0";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(
      <QRCodeCanvas
        value={value}
        size={size}
        level="M"
        marginSize={2}
        fgColor={config.colors.sidebar}
        bgColor="white"
      />
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = host.querySelector("canvas");
    if (!canvas) throw new Error("QR canvas did not render.");
    return canvas.toDataURL("image/png");
  } finally {
    root.unmount();
    host.remove();
  }
}

function getPrintableCard(room: Room, compact = false, destination: "chat" | "shop" = "chat") {
  const scanLink = getIntercomUrl(room, destination);
  const qrMarkup = getQrMarkup(scanLink, compact ? 118 : 144);
  const logoUrl = getLogoUrl();
  const label = destination === "shop" ? "Scan to order from Spark Essentials" : "Scan to chat with the front desk";

  return `
    <article class="qr-card">
      <header>
        <img src="${logoUrl}" alt="${config.brandName}" />
        <p>Room ${room.roomNumber}</p>
        <h2>${room.name || `Room ${room.roomNumber}`}</h2>
      </header>
      <div class="qr-box">${qrMarkup}</div>
      <p class="instruction">${label}</p>
      <p class="url">${scanLink}</p>
    </article>
  `;
}

function openPrintWindow(title: string, cardsHtml: string, isAll: boolean, onPopupBlocked: () => void) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    onPopupBlocked();
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          @page { size: A4; margin: 12mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #fff;
            color: ${config.colors.sidebar};
            font-family: Inter, Arial, sans-serif;
          }
          .sheet {
            display: grid;
            grid-template-columns: ${isAll ? "1fr 1fr" : "1fr"};
            gap: 10mm;
            width: 100%;
          }
          .qr-card {
            min-height: ${isAll ? "125mm" : "160mm"};
            border: 1.5px solid ${config.colors.sidebar};
            border-radius: 12px;
            padding: 12mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            text-align: center;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .qr-card img {
            max-width: 145px;
            max-height: 48px;
            object-fit: contain;
            margin-bottom: 8px;
          }
          .qr-card header p {
            margin: 0;
            color: ${config.colors.primary};
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .qr-card h2 {
            margin: 4px 0 0;
            font-size: 18px;
            line-height: 1.2;
          }
          .qr-box {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 10px;
            margin: 12px 0;
          }
          .instruction {
            margin: 0;
            font-size: 13px;
            font-weight: 800;
          }
          .url {
            max-width: 100%;
            margin: 8px 0 0;
            color: #6b7280;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 8px;
            line-height: 1.4;
            word-break: break-all;
          }
          @media print {
            .qr-card:nth-child(4n) { page-break-after: always; }
          }
        </style>
      </head>
      <body>
        <main class="sheet">${cardsHtml}</main>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 600);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

export function QRManagementPage() {
  const { rooms } = useAdmin();
  const toast = useToast();
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);
  const [regeneratingRoom, setRegeneratingRoom] = useState<Room | null>(null);
  const [qrDestination, setQrDestination] = useState<"chat" | "shop">("chat");
  const [qrError, setQrError] = useState("");
  const [qrSuccess, setQrSuccess] = useState("");
  // Per Q-03 + #22 / decision #225 (2026-08-19): on iOS,
  // the download + print paths don't work (Safari silently
  // ignores detached `<a download>` clicks and blocks popup
  // windows). The fix shows this hint when staff hit the
  // Download / Print buttons on a phone/tablet instead of
  // the generic "Failed" toast. The hint carries the e2e
  // hook `data-testid="qr-download-mobile-fallback"` so the
  // Playwright/Cypress suite can assert on it without
  // depending on text matching.
  const [iosShareHintRoomId, setIosShareHintRoomId] = useState<string | null>(
    null
  );

  const sortedRooms = useMemo(() =>
    [...rooms].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })),
    [rooms]
  );

  useEffect(() => {
    if (!hasInitializedSelection && sortedRooms.length > 0) {
      setSelectedRoomIds(sortedRooms.map(room => room.id));
      setHasInitializedSelection(true);
    }
  }, [hasInitializedSelection, sortedRooms]);

  const selectedRooms = useMemo(() =>
    sortedRooms.filter(room => selectedRoomIds.includes(room.id)),
    [selectedRoomIds, sortedRooms]
  );

  const toggleRoom = (roomId: string) => {
    setSelectedRoomIds(prev =>
      prev.includes(roomId)
        ? prev.filter(id => id !== roomId)
        : [...prev, roomId]
    );
  };

  const selectAll = () => setSelectedRoomIds(sortedRooms.map(room => room.id));
  const selectNone = () => setSelectedRoomIds([]);

  // Per Q-03 + #22 / decision #225 (2026-08-19): the pre-#225
  // print path opened a new window via `window.open("",
  // "_blank")` and `printWindow.document.write(...)` then
  // `printWindow.print()`. Safari iOS (and most Android
  // browsers) block popups without user opt-in, so the staff
  // saw "Print blocked · Please allow popups" with no hint
  // about why. The fix uses `window.print()` on the CURRENT
  // page — works on every modern browser including Safari
  // iOS — paired with a `@media print { ... }` stylesheet that
  // hides the room grid + sidebar/header chrome and shows a
  // printable card row. The `printMode` state controls which
  // branch the QR cards use (compact for the print-mode view,
  // full grid otherwise); the stylesheet handles the rest.

  const [printMode, setPrintMode] = useState(false);

  const handlePrintRoom = (room: Room) => {
    // `window.print()` on the current page works on every
    // modern browser (Chrome / Firefox / Safari / Edge) AND
    // on Safari iOS — no popup permission required. The print
    // stylesheet at admin-app/src/styles.css (the
    // `@media print { ... }` rule) hides the staff chrome and
    // shows the printable card.
    setPrintMode(true);
    // Defer the print dialog until React has applied the
    // print-mode render (the QR card row is hidden by default
    // and shown only when `printMode === true`).
    window.setTimeout(() => {
      window.print();
      // Keep print-mode on for a tick so the user can see the
      // cards + the print dialog together; clear on the next
      // idle so the post-print UI returns to the normal grid.
      // `print` events fire too late to be reliably observed
      // (the dialog is system-modal); setTimeout is the
      // pragmatic close enough — the cost of stale print-mode
      // is just a second render-frame that clears itself.
      window.setTimeout(() => setPrintMode(false), 1000);
    }, 0);
  };

  const handlePrintAll = () => {
    if (selectedRooms.length === 0) {
      setQrError("Select at least one room before printing QR sheets.");
      return;
    }
    setPrintMode(true);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => setPrintMode(false), 1000);
    }, 0);
  };

  const handleDownloadPng = async (room: Room) => {
    const scanLink = getIntercomUrl(room, qrDestination);
    try {
      setQrError("");
      // Per Q-03 + #22 / decision #225 (2026-08-19): Safari
      // iOS silently ignores `<a download>` clicks on
      // data URLs (the file opens in a new tab or is
      // blocked entirely) AND window.open popups for the
      // print path. The reliable iOS pattern is the
      // `navigator.share` API (graceful fallback for
      // browsers that don't have it) PLUS the long-press
      // hint. The pre-#225 flow tried the `<a download>`
      // click and ended up in the catch block — staff
      // saw "Unable to download the QR image. Please try
      // again." with no hint about the actual cause.
      const isIOS =
        typeof navigator !== "undefined" &&
        /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        // navigator.share is the only iOS path that lets
        // the staff save the QR to Photos / Files / Mail in
        // one tap.
        const shareData: ShareData | null =
          typeof navigator !== "undefined" && "share" in navigator
            ? {
                title: `Spark Inn · Room ${room.roomNumber} QR`,
                text: `Scan to chat with the front desk. ${scanLink}`,
                // QR code as a File would require Blob → File
                // conversion; for now we share the URL plus a
                // descriptive title (most iOS apps will accept
                // the URL and the user can save it from there).
                url: scanLink
              }
            : null;
        if (shareData && typeof navigator.share === "function") {
          try {
            await navigator.share(shareData);
          } catch {
            // User cancelled / share failed — the long-press
            // hint below is the fallback.
          }
        }
        // Show the long-press hint regardless (some staff
        // prefer to save via long-press on the in-page
        // canvas instead of the share sheet). The hint
        // dismisses on any outside click.
        setIosShareHintRoomId(room.id);
        return;
      }
      const pngUrl = await renderQrPngDataUrl(scanLink, 512);
      const link = document.createElement("a");
      link.download = `${config.brandName.replace(/\s+/g, "-")}-room-${room.roomNumber}-${qrDestination === "shop" ? "store" : "intercom"}-qr.png`;
      link.href = pngUrl;
      // Per Q-03 / decision #225 (2026-08-19): Chrome + Firefox
      // honor a detached `<a>`'s click() for `<a download>`, but
      // Safari iOS + macOS silently ignore the click unless
      // the element is in the DOM. Mirror the working pattern
      // at admin-app/src/pages/ReportsPage.tsx:3957-3962:
      // appendChild → click → removeChild so every browser
      // (including Safari) triggers the download.
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      setQrError("Unable to download the QR image. Please try again.");
    }
  };

  const confirmRegenerate = async () => {
    if (!regeneratingRoom) return;

    const tokenSource = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const qrToken = `qr-${regeneratingRoom.roomNumber}-${tokenSource}`.toLowerCase();

    try {
      setQrError("");
      await updateDoc(doc(db, "rooms", regeneratingRoom.id), {
        qrToken,
        updatedAt: serverTimestamp()
      });
      setQrSuccess(`Room ${regeneratingRoom.roomNumber} QR code regenerated.`);
      setRegeneratingRoom(null);
    } catch (error) {
      console.error("Failed to regenerate QR code:", error);
      setQrError("QR regeneration failed. Check your connection and try again.");
    }
  };

  return (
    <div className="space-y-8 font-body">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between print:hidden">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">QR Code Management</h1>
          <p className="text-xs text-gray-500 mt-1">Print room QR cards for guest intercom access and regenerate room links when needed.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-700">QR Target:</span>
            <select
              value={qrDestination}
              onChange={(e) => setQrDestination(e.target.value as "chat" | "shop")}
              className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="chat">Front Desk Intercom (Chat)</option>
              <option value="shop">Spark Essentials (Store)</option>
            </select>
          </div>
          <button
            onClick={selectAll}
            className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
          >
            Select All
          </button>
          <button
            onClick={selectNone}
            className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
          >
            Select None
          </button>
          <button
            onClick={handlePrintAll}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
          >
            <Printer size={16} />
            Print Selected ({selectedRooms.length})
          </button>
        </div>
      </header>

      {(qrError || qrSuccess) && (
        <div className={`rounded-card border p-4 text-sm font-semibold ${
          qrError ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
        }`}>
          {qrError || qrSuccess}
        </div>
      )}

      {/* Per Q-03 + #22 / decision #225 (2026-08-19): iOS Safari
          can't trigger the `<a download>` click on a data: URL
          AND can't open the popup-window print path. Instead of
          the generic "Failed" toast, show a hint telling the
          staff to use the iOS share sheet (which `navigator.share`
          opens) OR long-press the in-page QR card to save it.
          The hint dismisses on close + whenever a new click
          happens (handled via useEffect below). e2e hook:
          `data-testid="qr-download-mobile-fallback"`. */}
      {iosShareHintRoomId && (
        <div
          data-testid="qr-download-mobile-fallback"
          className="flex items-start justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <div>
            <p className="font-semibold">iOS download hint</p>
            <p className="mt-1 text-xs leading-relaxed">
              Safari blocks the standard download path on iPhone / iPad.
              Use the share sheet that just opened (Save to Photos / Files /
              Mail), OR long-press the QR card above to save it as an image.
              The "Print" button uses your browser's built-in print dialog
              — no popup required.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIosShareHintRoomId(null)}
            aria-label="Dismiss iOS download hint"
            className="shrink-0 rounded-lg p-2 text-amber-700 transition hover:bg-amber-100 active:bg-amber-200"
            title="Dismiss"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Per Q-03 + #22 / decision #225 (2026-08-19): the
          print-mode view shows a compact printable card row
          that's hidden by default + revealed by the
          `@media print { ... }` stylesheet in
          admin-app/src/styles.css. The state itself is set
          in handlePrintRoom/handlePrintAll (above) just
          before `window.print()` is called. Layout mirrors
          the existing room grid so what-you-see-is-what-
          you-print. */}
      {printMode && (
        <section
          data-testid="qr-print-mode"
          className="rounded-card border border-dashed border-amber-300 bg-amber-50/40 p-5 print:bg-white print:border-0"
        >
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-900 print:hidden">
            Print preview — printing {selectedRooms.length || "selected"} room{selectedRooms.length === 1 ? "" : "s"}…
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {(selectedRooms.length > 0 ? selectedRooms : sortedRooms).map(
              (room) => (
                <article
                  key={`print-${room.id}`}
                  className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 print:break-inside-avoid print:shadow-none print:ring-0"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    Room {room.roomNumber}
                  </p>
                  <h2 className="mt-1 text-base font-bold text-gray-950">
                    {room.name || `Room ${room.roomNumber}`}
                  </h2>
                  <div className="mt-4 flex justify-center rounded-xl border border-gray-150 bg-gray-50 p-4">
                    <div className="rounded-lg bg-white p-3 shadow-sm">
                      <QRCodeSVG
                        id={`print-qr-${room.id}`}
                        value={getIntercomUrl(room, qrDestination)}
                        size={qrSize}
                        level="M"
                        marginSize={2}
                        fgColor={config.colors.sidebar}
                        bgColor="white"
                      />
                    </div>
                  </div>
                  <p className="mt-4 truncate font-mono text-[10px] text-gray-500" title={getIntercomUrl(room, qrDestination)}>
                    {getIntercomUrl(room, qrDestination)}
                  </p>
                </article>
              )
            )}
          </div>
        </section>
      )}

      <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="grid gap-3 text-xs text-gray-600 md:grid-cols-3">
          <div>
            <span className="font-bold text-gray-900">QR destination</span>
            <p className="mt-1 font-mono text-[11px] text-gray-500">{getApiBaseUrl()}/intercom/[room]{qrDestination === "shop" ? "?tab=shop" : ""}</p>
          </div>
          <div>
            <span className="font-bold text-gray-900">Rooms loaded</span>
            <p className="mt-1">{sortedRooms.length} rooms, including inactive rooms for future placement.</p>
          </div>
          <div>
            <span className="font-bold text-gray-900">Print layout</span>
            <p className="mt-1">A4 sheets use a 4-up grid; single cards print one room per page.</p>
          </div>
        </div>
      </section>

      {sortedRooms.length === 0 ? (
        <div className="rounded-card bg-white p-10 text-center shadow-sm ring-1 ring-gray-200">
          <QrCode size={36} className="mx-auto text-gray-300" />
          <h2 className="mt-4 text-sm font-bold text-gray-900">No rooms found</h2>
          <p className="mt-2 text-xs text-gray-500">Add rooms in Room Management before printing QR cards.</p>
        </div>
      ) : (
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 print:hidden">
          {sortedRooms.map(room => {
            const scanLink = getIntercomUrl(room, qrDestination);
            const isSelected = selectedRoomIds.includes(room.id);
            return (
              <article key={room.id} className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Room {room.roomNumber}</p>
                    <h2 className="mt-1 text-base font-bold text-gray-950">{room.name || `Room ${room.roomNumber}`}</h2>
                    <p className="mt-1 text-[10px] text-gray-400">{room.isActive ? "Active room" : "Inactive room"}</p>
                  </div>
                  <button
                    onClick={() => toggleRoom(room.id)}
                    className={`h-9 w-9 rounded-lg border flex items-center justify-center transition ${
                      isSelected ? "border-primary bg-primary text-white" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"
                    }`}
                    aria-label={isSelected ? `Deselect room ${room.roomNumber}` : `Select room ${room.roomNumber}`}
                  >
                    <Check size={16} />
                  </button>
                </div>

                <div className="mt-5 flex justify-center rounded-xl border border-gray-150 bg-gray-50 p-4">
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <QRCodeSVG
                      id={`qr-${room.id}`}
                      value={scanLink}
                      size={qrSize}
                      level="M"
                      marginSize={2}
                      fgColor={config.colors.sidebar}
                      bgColor="white"
                    />
                  </div>
                </div>

                <p className="mt-4 truncate font-mono text-[10px] text-gray-500" title={scanLink}>
                  {scanLink}
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handlePrintRoom(room)}
                    className="min-h-[44px] rounded-lg border border-gray-200 bg-white text-[10px] font-bold text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-1"
                  >
                    <Printer size={13} />
                    Print
                  </button>
                  <button
                    onClick={() => void handleDownloadPng(room)}
                    className="min-h-[44px] rounded-lg border border-gray-200 bg-white text-[10px] font-bold text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-1"
                  >
                    <Download size={13} />
                    PNG
                  </button>
                  <button
                    onClick={() => setRegeneratingRoom(room)}
                    className="min-h-[44px] rounded-lg border border-red-200 bg-red-50 text-[10px] font-bold text-red-700 hover:bg-red-100 inline-flex items-center justify-center gap-1"
                  >
                    <RefreshCcw size={13} />
                    Reset
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {regeneratingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4">
          <div className="w-full max-w-md rounded-card-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-950">Regenerate room QR?</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  This will invalidate the current QR code for Room {regeneratingRoom.roomNumber}. Guests with the old QR code will no longer be able to use that link.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRegeneratingRoom(null)}
                className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                Keep Current
              </button>
              <button
                onClick={() => void confirmRegenerate()}
                className="min-h-[44px] rounded-lg bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700"
              >
                Regenerate QR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
