import { useEffect, useMemo, useRef, useState } from "react";
import { CreateRoomSchema, type CreateRoomInput } from "@spark-inn/shared";
import { useAdmin, type Room } from "../context/AdminContext";
import { Drawer } from "../components/Drawer";
import { Modal } from "../components/Modal";
import { ConfirmForm } from "../components/ConfirmForm";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { formatPrice } from "../utils/format";
import { BedDouble, Edit3, Plus, AlertCircle, EyeOff, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import config from "@config";

const EMPTY_FORM: CreateRoomInput = {
  name: "",
  roomNumber: "",
  type: "",
  description: "",
  bedDefinition: "",
  status: "available",
  housekeepingStatus: "clean",
  isActive: true,
  blockReason: "",
  remarks: ""
};

export function RoomsPage() {
  const {
    rooms,
    updateRoomConfig,
    addRoomBlock,
    createRoom,
    deleteRoom,
    hasActiveBookings,
    roomTypes
  } = useAdmin();
  const toast = useToast();

  // Edit drawer state
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

  // Edit drawer form fields — capacity + rate are on the type now
  // (per W3.6 / `plan/features/RATE-MANAGEMENT.md §W3.6`).
  const [bedDefinition, setBedDefinition] = useState("");
  const [status, setStatus] = useState<Room["status"]>("available");

  // Block schedule form fields
  const [blockFromDate, setBlockFromDate] = useState("");
  const [blockToDate, setBlockToDate] = useState("");
  const [blockReason, setBlockReason] = useState("");

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateRoomInput>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createRoomTypeOpen, setCreateRoomTypeOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const createRoomNumberRef = useRef<HTMLInputElement | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteAttempted, setDeleteAttempted] = useState(false);
  const activeBookingsForDelete = deleteTarget ? hasActiveBookings(deleteTarget.id) : 0;

  // Reset delete confirmation when target changes
  useEffect(() => {
    setDeleteAttempted(false);
    setIsDeleting(false);
  }, [deleteTarget?.id]);

  const handleEditClick = (room: Room) => {
    setSelectedRoom(room);
    setBedDefinition(room.bedDefinition);
    setStatus(room.status);
    setBlockFromDate("");
    setBlockToDate("");
    setBlockReason("");
    setIsEditDrawerOpen(true);
  };

  const handleConfigSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoom) {
      updateRoomConfig(selectedRoom.id, {
        bedDefinition,
        status
      });
      toast.success("Room updated", `Room ${selectedRoom.roomNumber} configuration saved`);
      setIsEditDrawerOpen(false);
    }
  };

  const handleBlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoom && blockFromDate && blockToDate && blockReason) {
      addRoomBlock(selectedRoom.id, { from: blockFromDate, to: blockToDate }, blockReason);
      toast.success("Room blocked", `Room ${selectedRoom.roomNumber} blocked for maintenance through ${blockToDate}`);
      setIsEditDrawerOpen(false);
    }
  };

  const openCreateModal = () => {
    setCreateForm({
      ...EMPTY_FORM,
      type: roomTypes[0]?.value ?? ""
    });
    setCreateErrors({});
    setCreateRoomTypeOpen(false);
    setIsCreateOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setCreateErrors({});
    setCreateForm(EMPTY_FORM);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = CreateRoomSchema.safeParse(createForm);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setCreateErrors(fieldErrors);
      return;
    }
    setIsCreating(true);
    setCreateErrors({});
    const result = await createRoom(parsed.data);
    setIsCreating(false);
    if (result.success) {
      toast.success(
        "Room created",
        `Room ${parsed.data.roomNumber} — ${parsed.data.name} is now live.`
      );
      closeCreateModal();
    } else {
      setCreateErrors({ _form: result.error || "Failed to create room." });
    }
  };

  const requestDelete = (room: Room) => {
    setDeleteTarget(room);
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
  };

  const performDelete = async (reason: string) => {
    if (!deleteTarget) return;
    if (activeBookingsForDelete > 0) {
      toast.warning(
        "Cannot delete room",
        `${activeBookingsForDelete} active booking${activeBookingsForDelete === 1 ? "" : "s"} must be resolved first.`
      );
      return;
    }
    setDeleteAttempted(true);
    setIsDeleting(true);
    const result = await deleteRoom(deleteTarget.id);
    setIsDeleting(false);
    if (result.success) {
      toast.success(
        "Room deleted",
        `Room ${deleteTarget.roomNumber} was removed${reason ? ` — ${reason}` : ""}.`
      );
      setDeleteTarget(null);
      if (isEditDrawerOpen && selectedRoom?.id === deleteTarget.id) {
        setIsEditDrawerOpen(false);
      }
    } else {
      toast.error("Failed to delete room", result.error || "Unknown error");
    }
  };

  const roomTypesLabels = useMemo(() => {
    return roomTypes.reduce((acc, t) => {
      acc[t.value] = t.label;
      return acc;
    }, {} as Record<string, string>);
  }, [roomTypes]);

  return (
    <div className="space-y-6 font-body sm:space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl text-gray-950 lowercase sm:text-3xl">room management</h1>
        <p className="text-xs text-gray-500 sm:text-sm">
          Configure room capacities, set price matrices, and block rooms for maintenance.
        </p>
        <button
          type="button"
          onClick={openCreateModal}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-[0.98] sm:hidden"
        >
          <Plus size={16} aria-hidden="true" />
          Add Room
        </button>
      </header>

      <div className="hidden justify-end sm:flex">
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-[0.98]"
        >
          <Plus size={16} aria-hidden="true" />
          Add Room
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {rooms.map((room) => {
          const isBlocked = room.status === "blocked";
          const activeCount = hasActiveBookings(room.id);

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
                      {roomTypesLabels[room.type] || room.type || "Untyped"}
                    </p>
                  </div>
                  <StatusBadge label={room.status.replace("-", " ")} status={room.status} />
                </div>

                <div className="text-xs text-gray-650 space-y-1.5 pt-2 border-t border-gray-150">
                  <p>Bed Setup: <strong>{room.bedDefinition}</strong></p>
                  <p>Limit: <strong>{roomTypes.find((t) => t.value === room.type)?.maxCapacity ?? "—"} Guests</strong></p>
                  <p>Base Rate: <strong className="text-gray-900">{formatPrice(roomTypes.find((t) => t.value === room.type)?.pricePerNight ?? 0)}</strong></p>
                  {isBlocked && room.blockReason && (
                    <div className="mt-2.5 rounded bg-red-50 border border-red-200 p-2 text-[10px] text-red-700 flex gap-1.5 items-start">
                      <AlertCircle size={14} className="shrink-0 text-red-500 mt-0.5" />
                      <span>{room.blockReason}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-100">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
                  {activeCount > 0 ? `${activeCount} active booking${activeCount === 1 ? "" : "s"}` : "No active bookings"}
                </span>
                <button
                  type="button"
                  onClick={() => handleEditClick(room)}
                  className="min-h-[44px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 hover:border-primary hover:text-primary text-xs font-semibold text-gray-700 transition"
                >
                  <Edit3 size={12} aria-hidden="true" />
                  Configure Room
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Drawer
        title={selectedRoom ? `Configure: Room ${selectedRoom.roomNumber}` : ""}
        open={isEditDrawerOpen}
        onClose={() => setIsEditDrawerOpen(false)}
        footer={
          selectedRoom ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => requestDelete(selectedRoom)}
                disabled={hasActiveBookings(selectedRoom.id) > 0}
                title={
                  hasActiveBookings(selectedRoom.id) > 0
                    ? "Resolve active bookings before deleting"
                    : "Delete this room"
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete Room
              </button>
              <button
                type="button"
                onClick={() => setIsEditDrawerOpen(false)}
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          ) : null
        }
      >
        {selectedRoom && (
          <div className="space-y-8 text-sm">
            <form onSubmit={handleConfigSubmit} className="space-y-4">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Room Specifications</h3>

              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Bed Description
                  <input
                    type="text"
                    required
                    value={bedDefinition}
                    onChange={(e) => setBedDefinition(e.target.value)}
                    className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Inventory Status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Room["status"])}
                    className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs bg-white"
                  >
                    <option value="available">Available</option>
                    <option value="occupied">Occupied</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </label>
              </div>

              <button
                type="submit"
                className="min-h-[44px] w-full rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95"
              >
                Save Room Configurations
              </button>
            </form>

            <div className="border-t border-gray-150 pt-6">
              <form onSubmit={handleBlockSubmit} className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <EyeOff size={14} className="text-red-500" aria-hidden="true" />
                  Block Room Schedule
                </h3>

                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Block room from public reservation during specific dates for maintenance or cleaning locks.
                </p>

                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Block Start
                    <input
                      type="date"
                      required
                      value={blockFromDate}
                      onChange={(e) => setBlockFromDate(e.target.value)}
                      className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Block End
                    <input
                      type="date"
                      required
                      value={blockToDate}
                      onChange={(e) => setBlockToDate(e.target.value)}
                      className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs"
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
                    className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs"
                  />
                </label>

                <button
                  type="submit"
                  className="min-h-[44px] w-full rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow-sm transition active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <EyeOff size={14} aria-hidden="true" />
                  Initiate Maintenance Block
                </button>
              </form>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        title="Add a new room"
        open={isCreateOpen}
        onClose={closeCreateModal}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeCreateModal}
              disabled={isCreating}
              className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60 sm:min-h-[40px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-room-form"
              disabled={isCreating}
              className="min-h-[44px] rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[40px]"
            >
              {isCreating ? "Creating…" : "Create Room"}
            </button>
          </div>
        }
      >
        <form id="create-room-form" onSubmit={handleCreateSubmit} className="space-y-4" noValidate>
          {createErrors._form && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {createErrors._form}
            </div>
          )}

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Display name
              <input
                type="text"
                required
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Executive Suite"
                aria-invalid={!!createErrors.name}
                className="min-h-[44px] w-full rounded border border-gray-200 px-3 text-xs"
              />
              {createErrors.name && <span className="text-[10px] font-normal text-red-600">{createErrors.name}</span>}
            </label>

            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Room number
              <input
                ref={createRoomNumberRef}
                type="text"
                required
                value={createForm.roomNumber}
                onChange={(e) => setCreateForm((f) => ({ ...f, roomNumber: e.target.value }))}
                placeholder="e.g. 202"
                aria-invalid={!!createErrors.roomNumber}
                className="min-h-[44px] w-full rounded border border-gray-200 px-3 text-xs"
              />
              {createErrors.roomNumber && <span className="text-[10px] font-normal text-red-600">{createErrors.roomNumber}</span>}
            </label>
          </div>

          <div className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            <span>Room type</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setCreateRoomTypeOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={createRoomTypeOpen}
                className="flex min-h-[44px] w-full items-center justify-between rounded border border-gray-200 bg-white px-3 text-xs font-normal text-gray-800"
              >
                <span>{roomTypesLabels[createForm.type] || "Select a type…"}</span>
                {createRoomTypeOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              </button>
              {createRoomTypeOpen && (
                <ul
                  role="listbox"
                  className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                >
                  {roomTypes.map((t) => (
                    <li key={t.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={createForm.type === t.value}
                        onClick={() => {
                          setCreateForm((f) => ({ ...f, type: t.value }));
                          setCreateRoomTypeOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gray-50 ${createForm.type === t.value ? "text-primary font-semibold" : "text-gray-700"}`}
                      >
                        <span>{t.label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">{t.shortLabel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {createErrors.type && <span className="text-[10px] font-normal text-red-600">{createErrors.type}</span>}
          </div>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Bed definition
            <input
              type="text"
              required
              value={createForm.bedDefinition}
              onChange={(e) => setCreateForm((f) => ({ ...f, bedDefinition: e.target.value }))}
              placeholder="e.g. 1 queen + 1 single bed"
              aria-invalid={!!createErrors.bedDefinition}
              className="min-h-[44px] w-full rounded border border-gray-200 px-3 text-xs"
            />
            {createErrors.bedDefinition && <span className="text-[10px] font-normal text-red-600">{createErrors.bedDefinition}</span>}
          </label>

          <p className="text-[10px] leading-relaxed text-gray-500">
            Max occupancy, base rate, weekend rate, and corporate rate are
            managed per room type in <strong>Settings → Room Types</strong> and the
            <strong> Rates</strong> tab. The room inherits these from its type.
          </p>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Initial status
              <select
                value={createForm.status}
                onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value as CreateRoomInput["status"] }))}
                className="min-h-[44px] w-full rounded border border-gray-200 px-3 text-xs bg-white"
              >
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Housekeeping
              <select
                value={createForm.housekeepingStatus}
                onChange={(e) => setCreateForm((f) => ({ ...f, housekeepingStatus: e.target.value as CreateRoomInput["housekeepingStatus"] }))}
                className="min-h-[44px] w-full rounded border border-gray-200 px-3 text-xs bg-white"
              >
                <option value="clean">Clean</option>
                <option value="dirty">Dirty</option>
                <option value="in-progress">In Progress</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Description (optional)
            <textarea
              rows={3}
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Shown on the public rooms page."
              className="min-h-[80px] w-full rounded border border-gray-200 px-3 py-2 text-xs"
            />
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Internal remarks (optional)
            <textarea
              rows={2}
              value={createForm.remarks}
              onChange={(e) => setCreateForm((f) => ({ ...f, remarks: e.target.value }))}
              placeholder="Not shown to guests — staff notes only."
              className="min-h-[64px] w-full rounded border border-gray-200 px-3 py-2 text-xs"
            />
          </label>

          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input
              type="checkbox"
              checked={createForm.isActive}
              onChange={(e) => setCreateForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            Visible on the public rooms page
          </label>

          <p className="text-[10px] leading-relaxed text-gray-500">
            Photos for this room are managed on its <strong>room type</strong> in Settings → Room Types. All rooms of the same type share the same gallery.
          </p>
        </form>
      </Modal>

      <Modal
        title="Delete room"
        open={!!deleteTarget}
        onClose={cancelDelete}
        footer={null}
      >
        {deleteTarget && (
          <div className="space-y-4 text-sm">
            {activeBookingsForDelete > 0 ? (
              <ConfirmForm
                title={`Room ${deleteTarget.roomNumber} has active bookings`}
                message={
                  <>
                    This room has <strong>{activeBookingsForDelete}</strong> active booking{activeBookingsForDelete === 1 ? "" : "s"}
                    {" "}(pending, confirmed, or in-house). Cancel or check them out first, then come back to delete the room.
                  </>
                }
                confirmLabel="Got it"
                cancelLabel="Back"
                variant="primary"
                onConfirm={() => cancelDelete()}
                onCancel={cancelDelete}
                testId="delete-room-blocked"
              />
            ) : (
              <>
                <p className="text-xs leading-relaxed text-gray-600">
                  You are about to permanently delete <strong>Room {deleteTarget.roomNumber}</strong>
                  {" "}({roomTypesLabels[deleteTarget.type] || deleteTarget.type || "Untyped"}). The room document, its photos, and any open intercom history will be removed.
                  Historical bookings keep their denormalized room number and type, but the room is gone for new reservations.
                </p>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                  This action cannot be undone.
                </p>
                <ConfirmForm
                  title="Type a reason and confirm"
                  message="Provide a short note for the audit log (e.g. “Renovation complete, room decommissioned”)."
                  reasonLabel="Reason (required)"
                  reasonRequired
                  reasonPlaceholder="Why is this room being removed?"
                  confirmLabel={isDeleting ? "Deleting…" : "Delete room permanently"}
                  variant="danger"
                  onConfirm={performDelete}
                  onCancel={cancelDelete}
                  testId="delete-room-confirm"
                />
                {deleteAttempted && !isDeleting && (
                  <p className="text-[10px] text-red-600">
                    Delete could not be completed. Review the toast and try again.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
