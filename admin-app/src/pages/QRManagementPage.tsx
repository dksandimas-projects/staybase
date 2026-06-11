import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Check, Download, Printer, QrCode, RefreshCcw } from "lucide-react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import config from "@config";
import { useAdmin, Room } from "../context/AdminContext";
import { db } from "../firebase/config";

const qrSize = 136;

function getRoomQrValue(room: Room) {
  return room.qrToken || room.id;
}

function getIntercomUrl(room: Room) {
  return `https://${config.domain}/intercom/${encodeURIComponent(getRoomQrValue(room))}`;
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

function getPrintableCard(room: Room, compact = false) {
  const scanLink = getIntercomUrl(room);
  const qrMarkup = getQrMarkup(scanLink, compact ? 118 : 144);
  const logoUrl = getLogoUrl();

  return `
    <article class="qr-card">
      <header>
        <img src="${logoUrl}" alt="${config.brandName}" />
        <p>Room ${room.roomNumber}</p>
        <h2>${room.name || `Room ${room.roomNumber}`}</h2>
      </header>
      <div class="qr-box">${qrMarkup}</div>
      <p class="instruction">Scan to chat with the front desk</p>
      <p class="url">${scanLink}</p>
    </article>
  `;
}

function openPrintWindow(title: string, cardsHtml: string, isAll = false) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Print was blocked. Please allow popups for this page, then try again.");
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
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);
  const [regeneratingRoom, setRegeneratingRoom] = useState<Room | null>(null);
  const [qrError, setQrError] = useState("");
  const [qrSuccess, setQrSuccess] = useState("");

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

  const handlePrintRoom = (room: Room) => {
    openPrintWindow(`Room ${room.roomNumber} QR - ${config.brandName}`, getPrintableCard(room));
  };

  const handlePrintAll = () => {
    if (selectedRooms.length === 0) {
      setQrError("Select at least one room before printing QR sheets.");
      return;
    }

    openPrintWindow(
      `QR Room Cards - ${config.brandName}`,
      selectedRooms.map(room => getPrintableCard(room, true)).join(""),
      true
    );
  };

  const handleDownloadPng = async (room: Room) => {
    const scanLink = getIntercomUrl(room);
    const svgMarkup = getQrMarkup(scanLink, 512);
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(svgUrl);
        setQrError("Unable to prepare the QR PNG. Please try again.");
        return;
      }
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(svgUrl);

      const link = document.createElement("a");
      link.download = `${config.brandName.replace(/\s+/g, "-")}-room-${room.roomNumber}-qr.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };

    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      setQrError("Unable to download the QR image. Please try again.");
    };

    image.src = svgUrl;
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
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">QR Code Management</h1>
          <p className="text-xs text-gray-500 mt-1">Print room QR cards for guest intercom access and regenerate room links when needed.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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

      <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="grid gap-3 text-xs text-gray-600 md:grid-cols-3">
          <div>
            <span className="font-bold text-gray-900">QR destination</span>
            <p className="mt-1 font-mono text-[11px] text-gray-500">https://{config.domain}/intercom/[room]</p>
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
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sortedRooms.map(room => {
            const scanLink = getIntercomUrl(room);
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
