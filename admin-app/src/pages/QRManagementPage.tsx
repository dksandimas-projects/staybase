import { useState } from "react";
import { useAdmin } from "../context/AdminContext";
import { QrCode, Printer, RefreshCw, Eye, Sparkles, Check, Smartphone } from "lucide-react";
import config from "@config";

export function QRManagementPage() {
  const { rooms } = useAdmin();
  const [domainUrl, setDomainUrl] = useState("https://sparkinn-guest.web.app");
  const [selectedRooms, setSelectedRooms] = useState<string[]>(rooms.map(r => r.roomNumber));
  const [previewRoomNum, setPreviewRoomNum] = useState<string>("101");

  const toggleSelectRoom = (roomNum: string) => {
    if (selectedRooms.includes(roomNum)) {
      setSelectedRooms(prev => prev.filter(n => n !== roomNum));
    } else {
      setSelectedRooms(prev => [...prev, roomNum]);
    }
  };

  const selectAll = () => {
    setSelectedRooms(rooms.map(r => r.roomNumber));
  };

  const selectNone = () => {
    setSelectedRooms([]);
  };

  const handlePrint = () => {
    if (selectedRooms.length === 0) {
      alert("Please select at least one room to print QR sheets.");
      return;
    }

    // Spawn a print-ready window with custom styles
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker blocked the print window. Please allow popups for this page.");
      return;
    }

    const cardsHtml = selectedRooms.map(roomNum => {
      const scanLink = `${domainUrl}/intercom?room=${roomNum}`;
      return `
        <div class="standee-card">
          <div class="header">
            <div class="brand">${config.brandName}</div>
            <div class="subtitle">Boutique Comfort</div>
          </div>
          <div class="divider"></div>
          <div class="body">
            <div class="room-tag">ROOM ${roomNum}</div>
            
            <div class="qr-container">
              <!-- Inline QR SVG Mockup -->
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="qr-svg">
                <rect width="100" height="100" fill="none"/>
                <!-- Outer boundary markers -->
                <path d="M5,5 h20 v20 h-20 z M5,9 h12 v12 h-12 z" fill="#111827"/>
                <path d="M75,5 h20 v20 h-20 z M79,9 h12 v12 h-12 z" fill="#111827"/>
                <path d="M5,75 h20 v20 h-20 z M9,79 h12 v12 h-12 z" fill="#111827"/>
                
                <!-- Inner random code dots for visualization -->
                <rect x="35" y="5" width="8" height="8" fill="#111827"/>
                <rect x="45" y="15" width="12" height="6" fill="#111827"/>
                <rect x="60" y="5" width="6" height="12" fill="#111827"/>
                <rect x="35" y="25" width="20" height="8" fill="#111827"/>
                
                <rect x="5" y="35" width="12" height="8" fill="#111827"/>
                <rect x="20" y="45" width="8" height="15" fill="#111827"/>
                <rect x="35" y="40" width="10" height="10" fill="#EA8A1A"/> <!-- orange accent code -->
                <rect x="55" y="35" width="15" height="12" fill="#111827"/>
                <rect x="75" y="35" width="20" height="8" fill="#111827"/>
                
                <rect x="35" y="55" width="15" height="8" fill="#111827"/>
                <rect x="55" y="50" width="8" height="20" fill="#111827"/>
                <rect x="70" y="55" width="12" height="12" fill="#111827"/>
                
                <rect x="35" y="75" width="8" height="20" fill="#111827"/>
                <rect x="45" y="85" width="18" height="8" fill="#111827"/>
                <rect x="70" y="75" width="25" height="8" fill="#111827"/>
                <rect x="80" y="85" width="15" height="10" fill="#111827"/>
                
                <!-- Center decorative element -->
                <rect x="44" y="44" width="12" height="12" fill="#EA8A1A" rx="2"/>
              </svg>
            </div>
            
            <p class="scan-instructions">Scan to access the <strong>Digital Concierge</strong>. Order local delicacies, request toiletries, and chat with Reception instantly.</p>
          </div>
          <div class="footer">
            <p class="url-text">${scanLink}</p>
            <p class="brand-footer">Powered by ${config.brandName} Concierge</p>
          </div>
        </div>
      `;
    }).join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR Standees - ${config.brandName}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=Outfit:wght@400;600;700;800&display=swap');
            
            body {
              background-color: #fff;
              margin: 0;
              padding: 0;
              font-family: 'Inter', sans-serif;
              color: #111827;
            }
            
            @media print {
              .standee-card {
                page-break-after: always;
              }
            }
            
            .standee-card {
              width: 105mm; /* A6 size width approx */
              height: 148mm; /* A6 size height approx */
              box-sizing: border-box;
              border: 3px solid #111827;
              border-radius: 12px;
              margin: 20px auto;
              padding: 24px;
              display: flex;
              flex-col: column;
              flex-direction: column;
              justify-content: space-between;
              background-color: #fff;
              text-align: center;
              position: relative;
            }
            
            .header .brand {
              font-family: 'Outfit', sans-serif;
              font-size: 26px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 1.5px;
              color: #EA8A1A;
            }
            
            .header .subtitle {
              font-size: 10px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 2px;
              color: #4b5563;
              margin-top: 2px;
            }
            
            .divider {
              height: 2px;
              background: repeating-linear-gradient(to right, #111827, #111827 5px, transparent 5px, transparent 10px);
              margin: 12px 0;
            }
            
            .room-tag {
              display: inline-block;
              background-color: #111827;
              color: #fff;
              font-family: 'Outfit', sans-serif;
              font-weight: 900;
              font-size: 18px;
              padding: 6px 16px;
              border-radius: 8px;
              letter-spacing: 1px;
              margin-bottom: 16px;
            }
            
            .qr-container {
              display: flex;
              justify-content: center;
              margin: 12px 0;
            }
            
            .qr-svg {
              width: 130px;
              height: 130px;
            }
            
            .scan-instructions {
              font-size: 11px;
              line-height: 1.5;
              color: #374151;
              padding: 0 10px;
              margin: 14px 0 0 0;
            }
            
            .scan-instructions strong {
              color: #111827;
            }
            
            .footer {
              margin-top: 15px;
            }
            
            .url-text {
              font-family: monospace;
              font-size: 9px;
              color: #6b7280;
              margin: 0;
              word-break: break-all;
            }
            
            .brand-footer {
              font-size: 8px;
              font-weight: bold;
              text-transform: uppercase;
              color: #9ca3af;
              letter-spacing: 0.5px;
              margin: 6px 0 0 0;
            }
          </style>
        </head>
        <body>
          ${cardsHtml}
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const selectedRoomDetails = rooms.find(r => r.roomNumber === previewRoomNum) || rooms[0];

  return (
    <div className="space-y-8 font-body">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">QR Code Management</h1>
          <p className="text-xs text-gray-500 mt-1">Configure live guest lookup URLs, preview standee displays, and export print matrices.</p>
        </div>

        <button
          onClick={handlePrint}
          className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
        >
          <Printer size={16} />
          Print Selected Standees ({selectedRooms.length})
        </button>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left Panel: Configuration and selections */}
        <div className="space-y-6">
          {/* Target link setup */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-2">
              <Smartphone size={18} className="text-primary" />
              Target Live Host Domain
            </h2>
            
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Host Destination Endpoint
              <input
                type="url"
                required
                value={domainUrl}
                onChange={(e) => setDomainUrl(e.target.value)}
                placeholder="https://sparkinn-guest.web.app"
                className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm outline-none transition focus:border-primary focus:bg-white"
              />
            </label>
            <p className="text-[10px] text-gray-400 font-medium">
              This URL is used as the base path for QR scanners. Clicking a QR links to: <br/>
              <strong className="font-mono text-gray-700 text-[9px]">{domainUrl}/intercom?room=[roomNumber]</strong>
            </p>
          </div>

          {/* Room checklist selector */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-2">
                <QrCode size={18} className="text-primary" />
                Select Rooms for Printing
              </h2>

              <div className="flex gap-2">
                <button onClick={selectAll} className="text-[10px] font-bold text-primary hover:underline">All</button>
                <span className="text-gray-300 text-xs">•</span>
                <button onClick={selectNone} className="text-[10px] font-bold text-gray-500 hover:underline">None</button>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 max-h-[220px] overflow-y-auto pr-1">
              {rooms.map(room => {
                const isSelected = selectedRooms.includes(room.roomNumber);
                return (
                  <button
                    key={room.id}
                    onClick={() => toggleSelectRoom(room.roomNumber)}
                    className={`min-h-[44px] flex items-center justify-between px-3 rounded-lg border text-xs font-bold transition ${
                      isSelected 
                        ? "bg-primary/5 border-primary/30 text-primary-dark" 
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span>Room {room.roomNumber}</span>
                    {isSelected ? (
                      <Check size={14} className="text-primary" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border border-gray-300 bg-white" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Panel: Standee Previewer */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight flex items-center gap-1.5">
              <Eye size={18} className="text-primary" />
              Acrylic Standee Visualizer
            </h2>

            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              Preview Room:
              <select
                value={previewRoomNum}
                onChange={(e) => setPreviewRoomNum(e.target.value)}
                className="min-h-[32px] rounded border border-gray-250 bg-white px-2 py-0.5 text-xs"
              >
                {rooms.map(r => (
                  <option key={r.id} value={r.roomNumber}>Room {r.roomNumber}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Standee Preview Leaflet Box */}
          <div className="bg-gray-50 border border-gray-150 rounded-xl p-8 flex justify-center">
            <div className="w-[260px] h-[360px] border-2 border-gray-900 rounded-lg p-5 flex flex-col justify-between bg-white text-center shadow-lg relative">
              <header>
                <div className="font-heading text-lg font-black uppercase text-primary tracking-wider">{config.brandName}</div>
                <div className="text-[7px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Boutique Comfort</div>
              </header>

              <div className="border-t border-dashed border-gray-300 my-2" />

              <div className="flex-1 flex flex-col justify-center items-center gap-3">
                <div className="inline-block bg-gray-950 text-white font-heading font-extrabold text-xs px-3.5 py-1 rounded">
                  ROOM {previewRoomNum}
                </div>

                {/* Mock QR SVG */}
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-24 h-24">
                    <rect width="100" height="100" fill="none"/>
                    <path d="M5,5 h20 v20 h-20 z M5,9 h12 v12 h-12 z" fill="#111827"/>
                    <path d="M75,5 h20 v20 h-20 z M79,9 h12 v12 h-12 z" fill="#111827"/>
                    <path d="M5,75 h20 v20 h-20 z M9,79 h12 v12 h-12 z" fill="#111827"/>
                    
                    <rect x="35" y="5" width="8" height="8" fill="#111827"/>
                    <rect x="45" y="15" width="12" height="6" fill="#111827"/>
                    <rect x="60" y="5" width="6" height="12" fill="#111827"/>
                    <rect x="35" y="25" width="20" height="8" fill="#111827"/>
                    
                    <rect x="5" y="35" width="12" height="8" fill="#111827"/>
                    <rect x="20" y="45" width="8" height="15" fill="#111827"/>
                    <rect x="35" y="40" width="10" height="10" fill="#EA8A1A"/>
                    <rect x="55" y="35" width="15" height="12" fill="#111827"/>
                    
                    <rect x="35" y="55" width="15" height="8" fill="#111827"/>
                    <rect x="55" y="50" width="8" height="20" fill="#111827"/>
                    
                    <rect x="35" y="75" width="8" height="20" fill="#111827"/>
                    <rect x="45" y="85" width="18" height="8" fill="#111827"/>
                    <rect x="70" y="75" width="25" height="8" fill="#111827"/>
                    
                    <rect x="44" y="44" width="12" height="12" fill="#EA8A1A" rx="2"/>
                  </svg>
                </div>

                <p className="text-[8px] text-gray-650 leading-relaxed font-semibold px-2">
                  Scan to access the <strong>Digital Concierge</strong>. Order local delicacies, request toiletries, and chat with Reception instantly.
                </p>
              </div>

              <footer>
                <p className="text-[6px] font-mono text-gray-400 truncate max-w-[210px] mx-auto">
                  {domainUrl}/intercom?room={previewRoomNum}
                </p>
                <p className="text-[6px] font-bold uppercase tracking-wider text-gray-300 mt-1">
                  Powered by {config.brandName} Concierge
                </p>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
