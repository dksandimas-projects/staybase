import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  Check,
  Info,
  Mail,
  MessageSquareText,
  Minus,
  Phone,
  Plus,
  ShieldCheck,
  UserRound,
  Users
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  calculateBookingTotal,
  getNumNights,
  staggerChild,
  staggerContainer
} from "@spark-inn/shared";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { PrimaryButton } from "../components/PrimaryButton";
import { StepIndicator } from "../components/StepIndicator";
import { rooms } from "../data/rooms";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";

const steps = ["Select Room", "Guest Details", "Review & Pay", "Confirmation"];
const breakfastRatePerPerson = 350;
const breakfastEnabled = true;

type RateChoice = "room-only" | "room-breakfast";
type GuestField = "firstName" | "lastName" | "email" | "phone" | "guestCount";

function formatStayDate(value: string) {
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export function BookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const currentStepKey = searchParams.get("step") ?? "select-room";
  const isGuestDetailsStep = currentStepKey === "guest-details";
  const [checkIn, setCheckIn] = useState(searchParams.get("checkIn") ?? "2026-06-12");
  const [checkOut, setCheckOut] = useState(searchParams.get("checkOut") ?? "2026-06-14");
  const [guests, setGuests] = useState(Number(searchParams.get("guests") ?? 2));
  const [selectedType, setSelectedType] = useState("all");
  const [selectedRoomId, setSelectedRoomId] = useState(searchParams.get("roomId") ?? "");
  const [rateChoice, setRateChoice] = useState<RateChoice>(
    searchParams.get("breakfast") === "yes" ? "room-breakfast" : "room-only"
  );
  const [guestDetails, setGuestDetails] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    guestCount: String(Number(searchParams.get("guests") ?? 2)),
    requests: "",
    consent: false
  });
  const [touchedFields, setTouchedFields] = useState<Record<GuestField, boolean>>({
    firstName: false,
    lastName: false,
    email: false,
    phone: false,
    guestCount: false
  });

  const nights = Math.max(getNumNights(checkIn, checkOut), 1);
  const availableRooms = useMemo(
    () =>
      rooms.filter((room) => {
        const typeMatches = selectedType === "all" || room.type === selectedType;
        return room.isActive && room.status === "available" && room.maxCapacity >= guests && typeMatches;
      }),
    [guests, selectedType]
  );
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0];
  const hasBreakfast = breakfastEnabled && rateChoice === "room-breakfast";
  const total = selectedRoom
    ? calculateBookingTotal({
        ratePerNight: selectedRoom.pricePerNight,
        numNights: nights,
        numGuests: guests,
        breakfastRate: breakfastRatePerPerson,
        hasBreakfast
      })
    : 0;
  const nightlyTotal = selectedRoom ? selectedRoom.pricePerNight + (hasBreakfast ? breakfastRatePerPerson * guests : 0) : 0;
  const continueParams = new URLSearchParams({
    step: "guest-details",
    checkIn,
    checkOut,
    guests: String(guests),
    roomId: selectedRoom?.id ?? "",
    breakfast: hasBreakfast ? "yes" : "no"
  });
  const reviewParams = new URLSearchParams(continueParams);
  reviewParams.set("step", "review");
  reviewParams.set("firstName", guestDetails.firstName);
  reviewParams.set("lastName", guestDetails.lastName);
  const guestErrors = {
    firstName: guestDetails.firstName.trim() ? "" : "First name is required.",
    lastName: guestDetails.lastName.trim() ? "" : "Last name is required.",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestDetails.email) ? "" : "Enter a valid email address.",
    phone: guestDetails.phone.trim().length >= 8 ? "" : "Phone number is required.",
    guestCount:
      Number(guestDetails.guestCount) >= 1 && selectedRoom && Number(guestDetails.guestCount) <= selectedRoom.maxCapacity
        ? ""
        : `Guest count must be between 1 and ${selectedRoom?.maxCapacity ?? guests}.`
  };
  const canContinueToReview =
    Object.values(guestErrors).every((error) => !error) && guestDetails.consent && Boolean(selectedRoom);

  useEffect(() => {
    if (!selectedRoomId && availableRooms[0]) {
      setSelectedRoomId(availableRooms[0].id);
      return;
    }

    if (selectedRoomId && !availableRooms.some((room) => room.id === selectedRoomId) && availableRooms[0]) {
      setSelectedRoomId(availableRooms[0].id);
    }
  }, [availableRooms, selectedRoomId]);

  function updateDateParams(nextCheckIn = checkIn, nextCheckOut = checkOut, nextGuests = guests) {
    const next = new URLSearchParams(searchParams);
    next.set("checkIn", nextCheckIn);
    next.set("checkOut", nextCheckOut);
    next.set("guests", String(nextGuests));
    if (selectedRoomId) next.set("roomId", selectedRoomId);
    setSearchParams(next, { replace: true });
  }

  function updateGuests(nextGuests: number) {
    const safeGuests = Math.min(Math.max(nextGuests, 1), 6);
    setGuests(safeGuests);
    updateDateParams(checkIn, checkOut, safeGuests);
  }

  function selectRoom(roomId: string, nextRateChoice: RateChoice) {
    setSelectedRoomId(roomId);
    setRateChoice(nextRateChoice);
    const next = new URLSearchParams(searchParams);
    next.set("roomId", roomId);
    next.set("checkIn", checkIn);
    next.set("checkOut", checkOut);
    next.set("guests", String(guests));
    setSearchParams(next, { replace: true });
  }

  function updateGuestDetail(field: keyof typeof guestDetails, value: string | boolean) {
    setGuestDetails((current) => ({
      ...current,
      [field]: value
    }));
  }

  function markTouched(field: GuestField) {
    setTouchedFields((current) => ({
      ...current,
      [field]: true
    }));
  }

  const bookingShell = (content: React.ReactNode) => (
    <main className="min-h-screen bg-gray-50 pb-32 font-body text-gray-900">
      <BookingHeader backTo={isGuestDetailsStep ? `/book?${continueParams.toString()}` : "/rooms"} />
      {content}
    </main>
  );

  if (isGuestDetailsStep) {
    return bookingShell(
      <>
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <StepIndicator steps={steps} currentStep={2} />
          </div>
          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 2 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Guest details</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Add the guest information for this stay. Required fields show inline validation once touched.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <motion.form
            animate="visible"
            className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6"
            initial={shouldReduceMotion ? false : "hidden"}
            variants={staggerContainer}
          >
            <motion.div className="grid gap-5 sm:grid-cols-2" variants={staggerChild}>
              <TextField
                error={touchedFields.firstName ? guestErrors.firstName : ""}
                icon={<UserRound size={17} />}
                label="First name"
                onBlur={() => markTouched("firstName")}
                onChange={(value) => updateGuestDetail("firstName", value)}
                placeholder="Maria"
                required
                value={guestDetails.firstName}
              />
              <TextField
                error={touchedFields.lastName ? guestErrors.lastName : ""}
                icon={<UserRound size={17} />}
                label="Last name"
                onBlur={() => markTouched("lastName")}
                onChange={(value) => updateGuestDetail("lastName", value)}
                placeholder="Santos"
                required
                value={guestDetails.lastName}
              />
            </motion.div>

            <motion.div className="mt-5 grid gap-5 sm:grid-cols-2" variants={staggerChild}>
              <TextField
                error={touchedFields.email ? guestErrors.email : ""}
                icon={<Mail size={17} />}
                label="Email"
                onBlur={() => markTouched("email")}
                onChange={(value) => updateGuestDetail("email", value)}
                placeholder="maria@example.com"
                required
                type="email"
                value={guestDetails.email}
              />
              <TextField
                error={touchedFields.phone ? guestErrors.phone : ""}
                icon={<Phone size={17} />}
                label="Phone number"
                onBlur={() => markTouched("phone")}
                onChange={(value) => updateGuestDetail("phone", value)}
                placeholder={`${config.phoneCountryCode} 917 000 0000`}
                required
                type="tel"
                value={guestDetails.phone}
              />
            </motion.div>

            <motion.div className="mt-5 grid gap-5 sm:grid-cols-[220px_1fr]" variants={staggerChild}>
              <TextField
                error={touchedFields.guestCount ? guestErrors.guestCount : ""}
                icon={<Users size={17} />}
                label="Number of guests"
                onBlur={() => markTouched("guestCount")}
                onChange={(value) => updateGuestDetail("guestCount", value)}
                placeholder="2"
                required
                type="number"
                value={guestDetails.guestCount}
              />
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Special requests
                <span className="relative">
                  <MessageSquareText size={17} className="absolute left-3 top-3 text-primary" />
                  <textarea
                    className="min-h-28 w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    onChange={(event) => updateGuestDetail("requests", event.target.value)}
                    placeholder="Late check-in, dietary notes, room preferences..."
                    value={guestDetails.requests}
                  />
                </span>
              </label>
            </motion.div>

            <motion.div className="mt-6 rounded-card bg-primary-light p-4" variants={staggerChild}>
              <label className="flex items-start gap-3 text-sm leading-6 text-gray-700">
                <input
                  checked={guestDetails.consent}
                  className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  onChange={(event) => updateGuestDetail("consent", event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I agree to the{" "}
                  <Link className="font-semibold text-primary underline" target="_blank" to="/privacy">
                    Privacy Policy
                  </Link>{" "}
                  and consent to the collection of my personal data for booking purposes.
                </span>
              </label>
            </motion.div>

            <motion.div className="mt-6 flex gap-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700" variants={staggerChild}>
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
              <p>This static wireframe keeps details in local React state only. Booking creation will happen later through the API.</p>
            </motion.div>
          </motion.form>

          <BookingReviewAside
            checkIn={checkIn}
            checkOut={checkOut}
            guests={Number(guestDetails.guestCount) || guests}
            hasBreakfast={hasBreakfast}
            nights={nights}
            room={selectedRoom}
            total={total}
          />
        </section>

        <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-600">Guest details</p>
              <p className="text-lg font-semibold text-gray-950">
                {canContinueToReview ? "Ready for review and payment" : "Complete required fields and consent"}
              </p>
            </div>
            {canContinueToReview ? (
              <PrimaryButton to={`/book?${reviewParams.toString()}`} className="sm:min-w-56">
                Continue to Step 3
              </PrimaryButton>
            ) : (
              <PrimaryButton disabled type="button" className="sm:min-w-56">
                Continue to Step 3
              </PrimaryButton>
            )}
          </div>
        </div>
      </>
    );
  }

  return bookingShell(
    <>
      <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <StepIndicator steps={steps} currentStep={1} />
        </div>
        <div className="mt-10 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 1 of 4</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Select your stay</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Choose dates, guests, and a room option. This is static wireframe data shaped for the future booking context.
            </p>
          </div>
          <div className="rounded-card bg-white p-4 text-sm shadow-sm ring-1 ring-gray-200">
            <p className="font-semibold text-gray-950">{formatStayDate(checkIn)} - {formatStayDate(checkOut)}</p>
            <p className="mt-1 text-gray-600">
              {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[320px_1fr] lg:px-8">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-lg font-semibold text-gray-950">Stay details</h2>
            <div className="mt-5 space-y-6">
              <DateRangePicker
                checkIn={checkIn}
                checkOut={checkOut}
                onCheckInChange={(value) => {
                  setCheckIn(value);
                  updateDateParams(value, checkOut, guests);
                }}
                onCheckOutChange={(value) => {
                  setCheckOut(value);
                  updateDateParams(checkIn, value, guests);
                }}
              />

              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Guests
                <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                    type="button"
                    onClick={() => updateGuests(guests - 1)}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    <Users size={16} className="text-primary" />
                    {guests} {guests === 1 ? "guest" : "guests"}
                  </span>
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                    type="button"
                    onClick={() => updateGuests(guests + 1)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </label>

              <div>
                <p className="text-sm font-medium text-gray-700">Room type</p>
                <div className="mt-3 grid gap-2">
                  {[{ value: "all", label: "All Types" }, ...config.roomTypes].map((type) => (
                    <button
                      key={type.value}
                      className={cn(
                        "flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm font-medium transition",
                        selectedType === type.value
                          ? "border-primary bg-primary-light text-primary"
                          : "border-gray-200 bg-white text-gray-700 hover:border-primary"
                      )}
                      type="button"
                      onClick={() => setSelectedType(type.value)}
                    >
                      {type.label}
                      {selectedType === type.value ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 rounded-lg bg-primary-light p-4 text-sm text-gray-700">
                <Info size={18} className="mt-0.5 shrink-0 text-primary" />
                <p>Prices are based on selected dates. Breakfast is a static add-on for this wireframe pass.</p>
              </div>
            </div>
          </div>
        </aside>

        <div>
          <div className="mb-5 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <p className="font-semibold text-gray-950">{availableRooms.length} available rooms</p>
            <p className="text-sm text-gray-600">Select Room Only or Room + Breakfast to lock the Step 1 summary.</p>
          </div>

          {availableRooms.length > 0 ? (
            <motion.div
              animate="visible"
              className="grid gap-6"
              initial={shouldReduceMotion ? false : "hidden"}
              variants={staggerContainer}
            >
              {availableRooms.map((room, index) => {
                const isSelected = room.id === selectedRoom?.id;
                const roomOnlyTotal = calculateBookingTotal({
                  ratePerNight: room.pricePerNight,
                  numNights: nights
                });
                const breakfastTotal = calculateBookingTotal({
                  ratePerNight: room.pricePerNight,
                  numNights: nights,
                  numGuests: guests,
                  breakfastRate: breakfastRatePerPerson,
                  hasBreakfast: true
                });
                const typeLabel = config.roomTypes.find((type) => type.value === room.type)?.label ?? room.type;

                return (
                  <motion.article
                    key={room.id}
                    className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200"
                    variants={staggerChild}
                    whileHover={shouldReduceMotion ? undefined : { y: -4 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <div className="grid md:grid-cols-[280px_1fr]">
                      <div className="relative min-h-64 overflow-hidden bg-section-bg">
                        <img src={room.imageUrls[0]} alt={room.name} className="h-full w-full object-cover" />
                        {index === 0 ? (
                          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary shadow-sm">
                            Recommended
                          </span>
                        ) : null}
                      </div>
                      <div className="p-5 sm:p-6">
                        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                          <div>
                            <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
                              {typeLabel}
                            </span>
                            <h2 className="mt-3 text-2xl font-semibold text-gray-950">{room.name}</h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-gray-600">{room.description}</p>
                          </div>
                          <div className="sm:text-right">
                            <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
                            <p className="text-2xl font-semibold text-gray-950">{formatPrice(room.pricePerNight)}</p>
                            <p className="text-sm text-gray-500">per night</p>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-2">
                            <BedDouble size={16} className="text-primary" />
                            {room.bedDefinition}
                          </span>
                          <span className="flex items-center gap-2">
                            <Users size={16} className="text-primary" />
                            Up to {room.maxCapacity}
                          </span>
                          <span className="flex items-center gap-2">
                            <CalendarDays size={16} className="text-primary" />
                            {nights} {nights === 1 ? "night" : "nights"}
                          </span>
                        </div>

                        <div className="mt-6 grid gap-3">
                          <RateOption
                            active={isSelected && rateChoice === "room-only"}
                            label="Room Only"
                            helper="Simple stay, flexible payment at the hotel"
                            priceLabel={`${formatPrice(room.pricePerNight)} / night`}
                            totalLabel={`${formatPrice(roomOnlyTotal)} total`}
                            onSelect={() => selectRoom(room.id, "room-only")}
                          />
                          {breakfastEnabled ? (
                            <RateOption
                              active={isSelected && rateChoice === "room-breakfast"}
                              label="Room + Breakfast"
                              helper="Includes daily local breakfast for selected guests"
                              priceLabel={`${formatPrice(room.pricePerNight + breakfastRatePerPerson * guests)} / night`}
                              totalLabel={`${formatPrice(breakfastTotal)} total`}
                              onSelect={() => selectRoom(room.id, "room-breakfast")}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
          ) : (
            <div className="rounded-card bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
              <h2 className="text-xl font-semibold text-gray-950">No available rooms match this stay</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
                Try fewer guests or choose all room types to continue the wireframe flow.
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-gray-600">
              Total for {nights} {nights === 1 ? "night" : "nights"}, {guests} {guests === 1 ? "guest" : "guests"}
            </p>
            <p className="text-2xl font-semibold text-gray-950">
              {formatPrice(total)} <span className="text-sm font-normal text-gray-500">including selected options</span>
            </p>
          </div>
          <PrimaryButton to={`/book?${continueParams.toString()}`} className="sm:min-w-56">
            Continue to Step 2
          </PrimaryButton>
        </div>
      </div>
    </>
  );
}

function BookingHeader({ backTo }: { backTo: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 px-4 py-4 shadow-sm backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link
          aria-label="Back"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          to={backTo}
        >
          <ArrowLeft size={20} />
        </Link>
        <Link to="/" aria-label={config.brandName} className="flex items-center justify-center">
          <img src={`/brand/${config.logos.navbar}`} alt={config.brandName} className="h-10 w-auto" />
        </Link>
        <span className="min-h-11 min-w-11" />
      </div>
    </header>
  );
}

interface TextFieldProps {
  error?: string;
  icon: React.ReactNode;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  type?: string;
  value: string;
}

function TextField({ error, icon, label, onBlur, onChange, placeholder, required, type = "text", value }: TextFieldProps) {
  return (
    <label className="grid gap-2 text-sm font-medium text-gray-700">
      {label}
      {required ? <span className="sr-only">required</span> : null}
      <span className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary">{icon}</span>
        <input
          className={cn(
            "min-h-11 w-full rounded-lg border bg-white py-2 pl-10 pr-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light",
            error ? "border-red-300" : "border-gray-200"
          )}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
      </span>
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
    </label>
  );
}

interface BookingReviewAsideProps {
  checkIn: string;
  checkOut: string;
  guests: number;
  hasBreakfast: boolean;
  nights: number;
  room: (typeof rooms)[number] | undefined;
  total: number;
}

function BookingReviewAside({ checkIn, checkOut, guests, hasBreakfast, nights, room, total }: BookingReviewAsideProps) {
  if (!room) return null;

  return (
    <aside className="lg:sticky lg:top-28 lg:self-start">
      <div className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
        <img src={room.imageUrls[0]} alt={room.name} className="h-52 w-full object-cover" />
        <div className="p-5">
          <h2 className="text-xl font-semibold text-gray-950">{room.name}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{room.description}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 border-y border-gray-200 py-4 text-sm">
            <SummaryCell label="Check-in" value={formatStayDate(checkIn)} />
            <SummaryCell alignEnd label="Check-out" value={formatStayDate(checkOut)} />
            <SummaryCell label="Guests" value={`${guests} ${guests === 1 ? "guest" : "guests"}`} />
            <SummaryCell alignEnd label="Duration" value={`${nights} ${nights === 1 ? "night" : "nights"}`} />
          </div>
          <div className="mt-5 space-y-3 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Room rate</span>
              <span>{formatPrice(room.pricePerNight * nights)}</span>
            </div>
            {hasBreakfast ? (
              <div className="flex justify-between">
                <span>Breakfast add-on</span>
                <span>{formatPrice(breakfastRatePerPerson * guests * nights)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-dashed border-gray-200 pt-3 text-lg font-semibold text-gray-950">
              <span>Total</span>
              <span className="text-primary">{formatPrice(total)}</span>
            </div>
          </div>
          <div className="mt-5 flex gap-3 rounded-lg bg-primary-light p-4 text-sm text-gray-700">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
            <p>Best rate guarantee. No hidden booking fees for direct reservations.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SummaryCell({ alignEnd, label, value }: { alignEnd?: boolean; label: string; value: string }) {
  return (
    <div className={alignEnd ? "text-right" : undefined}>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 font-medium text-gray-950">{value}</p>
    </div>
  );
}

interface RateOptionProps {
  active: boolean;
  label: string;
  helper: string;
  priceLabel: string;
  totalLabel: string;
  onSelect: () => void;
}

function RateOption({ active, label, helper, priceLabel, totalLabel, onSelect }: RateOptionProps) {
  return (
    <button
      className={cn(
        "flex min-h-20 w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition",
        active ? "border-primary bg-primary-light ring-1 ring-primary" : "border-gray-200 bg-white hover:border-primary"
      )}
      type="button"
      onClick={onSelect}
    >
      <span className="flex gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            active ? "border-primary bg-primary text-white" : "border-gray-300"
          )}
        >
          {active ? <Check size={13} /> : null}
        </span>
        <span>
          <span className="block text-sm font-semibold text-gray-950">{label}</span>
          <span className="mt-1 block text-sm text-gray-600">{helper}</span>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold text-gray-950">{priceLabel}</span>
        <span className="mt-1 block text-xs text-gray-500">{totalLabel}</span>
      </span>
    </button>
  );
}
