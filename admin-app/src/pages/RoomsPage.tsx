import { useState } from "react";
import { useAdmin, Room } from "../context/AdminContext";
import { Drawer } from "../components/Drawer";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { formatPrice } from "../utils/format";
import { BedDouble, Edit3, ShieldAlert, Sparkles, Plus, AlertCircle, EyeOff } from "lucide-react";
import config from "@config";

export function RoomsPage() {
  const { rooms, updateRoomConfig, addRoomBlock, roomTypes } = useAdmin();
  const toast = useToast();

  // Selected Room Drawer States
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Edit Form Fields
  const [bedDefinition, setBedDefinition] = useState("");
  const [maxCapacity, setMaxCapacity] = useState(2);
  const [pricePerNight, setPricePerNight] = useState(0);
  const [status, setStatus] = useState<Room["status"]>("available");
  
  // Block Schedule Form Fields
  const [blockFromDate, setBlockFromDate] = useState("");
  const [blockToDate, setBlockToDate] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const handleEditClick = (room: Room) => {
    setSelectedRoom(room);
    setBedDefinition(room.bedDefinition);
    setMaxCapacity(room.maxCapacity);
    setPricePerNight(room.pricePerNight);
    setStatus(room.status);
    setBlockFromDate("");
    setBlockToDate("");
    setBlockReason("");
    setIsDrawerOpen(true);
  };

  const handleConfigSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoom) {
      updateRoomConfig(selectedRoom.id, {
        bedDefinition,
        maxCapacity,
        pricePerNight,
        status
      });
      toast.success("Room updated", `Room ${selectedRoom.roomNumber} configuration saved`);
      setIsDrawerOpen(false);
    }
  };

  const handleBlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoom && blockFromDate && blockToDate && blockReason) {
      addRoomBlock(selectedRoom.id, { from: blockFromDate, to: blockToDate }, blockReason);
      toast.success("Room blocked", `Room ${selectedRoom.roomNumber} blocked for maintenance through ${blockToDate}`);
      setIsDrawerOpen(false);
    }
  };

  const roomTypesLabels = roomTypes.reduce((acc, t) => {
    acc[t.value] = t.label;
    return acc;
  }, {} as Record<string, string>);

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">room management</h1>
        <p className="text-xs text-gray-500 mt-1">Configure room capacities, set price matrices, and block rooms for maintenance.</p>
      </header>

      {/* Rooms Directory Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((room) => {
          const isBlocked = room.status === "blocked";

          return (
            <div
              key={room.id}
              className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between gap-5 transition hover:shadow-md"
            >
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">Room {room.roomNumber}</h3>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mt-0.5">
                      {room.type.replace("-", " ")}
                    </p>
                  </div>
                  <StatusBadge label={room.status.replace("-", " ")} status={room.status} />
                </div>

                <div className="text-xs text-gray-650 space-y-1.5 pt-2 border-t border-gray-150">
                  <p>Bed Setup: <strong>{room.bedDefinition}</strong></p>
                  <p>Limit: <strong>{room.maxCapacity} Guests</strong></p>
                  <p>Base Rate: <strong className="text-gray-900">{formatPrice(room.pricePerNight)}</strong></p>
                  {isBlocked && room.blockReason && (
                    <div className="mt-2.5 rounded bg-red-50 border border-red-200 p-2 text-[10px] text-red-700 flex gap-1.5 items-start">
                      <AlertCircle size={14} className="shrink-0 text-red-500 mt-0.5" />
                      <span>{room.blockReason}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-gray-100">
                <button
                  onClick={() => handleEditClick(room)}
                  className="min-h-[36px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 hover:border-primary hover:text-primary text-xs font-semibold text-gray-700 transition"
                >
                  <Edit3 size={12} />
                  Configure Room
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Room Edit Drawer (D-02) */}
      <Drawer
        title={selectedRoom ? `Configure: Room ${selectedRoom.roomNumber}` : ""}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        {selectedRoom && (
          <div className="space-y-8 text-sm">
            {/* Config Form */}
            <form onSubmit={handleConfigSubmit} className="space-y-4">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Room Specifications</h3>

              <div className="grid gap-4 grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Bed Description
                  <input
                    type="text"
                    required
                    value={bedDefinition}
                    onChange={(e) => setBedDefinition(e.target.value)}
                    className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Max Capacity
                  <input
                    type="number"
                    min={1}
                    required
                    value={maxCapacity}
                    onChange={(e) => setMaxCapacity(parseInt(e.target.value) || 2)}
                    className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                  />
                </label>
              </div>

              <div className="grid gap-4 grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Base Rate (PHP)
                  <input
                    type="number"
                    required
                    value={pricePerNight}
                    onChange={(e) => setPricePerNight(parseInt(e.target.value) || 0)}
                    className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Inventory Status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Room["status"])}
                    className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs bg-white"
                  >
                    <option value="available">Available</option>
                    <option value="occupied">Occupied</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </label>
              </div>

              <button
                type="submit"
                className="min-h-[40px] w-full rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95"
              >
                Save Room Configurations
              </button>
            </form>

            <div className="border-t border-gray-150 pt-6">
              {/* Block Schedule Form */}
              <form onSubmit={handleBlockSubmit} className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <EyeOff size={14} className="text-red-500" />
                  Block Room Schedule
                </h3>

                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Block room from public reservation during specific dates for maintenance or cleaning locks.
                </p>

                <div className="grid gap-4 grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Block Start
                    <input
                      type="date"
                      required
                      value={blockFromDate}
                      onChange={(e) => setBlockFromDate(e.target.value)}
                      className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Block End
                    <input
                      type="date"
                      required
                      value={blockToDate}
                      onChange={(e) => setBlockToDate(e.target.value)}
                      className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Block Reason note
                  <input
                    type="text"
                    required
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    placeholder="e.g. AC Maintenance, Deep Cleaning"
                    className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                  />
                </label>

                <button
                  type="submit"
                  className="min-h-[40px] w-full rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow-sm transition active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <EyeOff size={14} />
                  Initiate Maintenance Block
                </button>
              </form>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
