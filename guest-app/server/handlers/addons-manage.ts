// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the guest Manage Other Add-Ons read endpoint.
//
//   GET /api/bookings/addons/manage?ref={bookingRef}&token={lookupToken}
//
// Returns the booking's current `otherAddOnSelections` +
// per-add-on cut-off state + served records + the enabled
// add-on catalog. Lookup-token gated (the same magic-link
// auth the BR-04 /my-booking/breakfast page uses); rate-
// limited at 10/min/IP at the apiRouter layer.
//
// Read pattern mirrors `handleGetBreakfastManage`: strip
// PII, compute the per-date × per-add-on cutoff states
// server-side, return the add-on catalog with admin-only
// fields removed.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../lib/firebase-admin";
import { loadOtherAddOnsHotelEnabled } from "../lib/otherAddOns-settings";
import {
  computeOtherAddOnCutoffState,
  normalizeAddOn,
  getEnabledAddOnsByHotel,
  hasAnyOtherAddOns,
  recomputeOtherAddOnTotal,
  parseOtherAddOnSelectionKey,
  isOtherAddOnBookingMutable,
  type AddOn,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function enumerateDates(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return out;
  const maxDays = 60;
  for (let ms = a, i = 0; ms < b && i < maxDays; ms += 86_400_000, i += 1) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

export async function handleGetAddOnsManage(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const ref = String(req.query.ref || "").trim();
  const token = String(req.query.token || "").trim();
  if (!ref || !token) {
    return res.status(400).json({ success: false, error: "Missing bookingRef or token." });
  }

  let bookingSnap: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let bookingData: Record<string, any> | undefined;
  try {
    const q = await adminDb
      .collection("bookings")
      .where("bookingRef", "==", ref)
      .limit(1)
      .get();
    if (q.empty) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    const doc = q.docs[0];
    bookingSnap = doc;
    bookingData = doc.data();
    if (String(bookingData.lookupToken || "") !== token) {
      return res.status(403).json({ success: false, error: "Invalid token." });
    }
  } catch {
    return res.status(500).json({ success: false, error: "Failed to load booking." });
  }

  if (!bookingSnap || !bookingData) {
    return res.status(404).json({ success: false, error: "Booking not found." });
  }

  const checkIn = bookingData.checkIn;
  const checkOut = bookingData.checkOut;
  const checkInDate = isIsoDate(checkIn)
    ? checkIn
    : typeof checkIn === "object" && checkIn && typeof (checkIn as any).toDate === "function"
      ? (() => {
          const d: Date = (checkIn as any).toDate();
          const yyyy = d.getUTCFullYear();
          const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(d.getUTCDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        })()
      : "";
  const checkOutDate = isIsoDate(checkOut)
    ? checkOut
    : typeof checkOut === "object" && checkOut && typeof (checkOut as any).toDate === "function"
      ? (() => {
          const d: Date = (checkOut as any).toDate();
          const yyyy = d.getUTCFullYear();
          const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(d.getUTCDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        })()
      : "";

  const status = String(bookingData.status || "").trim();
  // Per OCT-M3 (2026-10-20, decision #291): the read-only rule is
  // the shared `isOtherAddOnBookingMutable` — the SAME helper the
  // write paths use. A local copy here could disagree with the
  // server (e.g. on a case difference), which would show the guest
  // editable controls for a booking the save path refuses.
  const readOnly = !isOtherAddOnBookingMutable(status);

  // Load the add-on catalog (no admin-only fields needed for
  // the public Manage Other Add-Ons page).
  //
  // Per OCT-M1 (2026-10-20, decision #295): the hotel-wide master
  // switch is threaded in here too. When the hotel has taken other
  // add-ons off sale, the page must show an EMPTY catalog — the
  // guest must not see an add-on they cannot buy.
  const hotelEnabled = await loadOtherAddOnsHotelEnabled();
  let enabledAddOns: AddOn[] = [];
  try {
    const snap = await adminDb.collection("addOns").get();
    for (const d of snap.docs) {
      const norm = normalizeAddOn({ id: d.id, ...d.data() }, d.id);
      if (norm) enabledAddOns.push(norm);
    }
    enabledAddOns = getEnabledAddOnsByHotel(enabledAddOns, hotelEnabled);
  } catch {
    // fall through with empty catalog
  }

  const existingSelections: Record<string, OtherAddOnSelectionEntry[]> =
    bookingData.otherAddOnSelections && typeof bookingData.otherAddOnSelections === "object"
      ? bookingData.otherAddOnSelections
      : {};

  const dates = enumerateDates(checkInDate, checkOutDate);
  const now = new Date();
  const addOnById = new Map<string, AddOn>();
  for (const a of enabledAddOns) addOnById.set(a.id, a);

  // Compute per-add-on lock state. BR-12 v1: lock is
  // per-add-on only (no hotel-wide toggle yet).
  interface AddOnDateLock {
      date: string;
      addOnId: string;
      isLocked: boolean;
      cutoffAt: string;
      minutesUntilCutoff: number;
      reasonOrCutoff?: string;
    }
  const dateLockByAddOn: AddOnDateLock[] = [];
  for (const date of dates) {
    for (const a of enabledAddOns) {
      // Per OCT-M5 (2026-10-20, decision #292): the cut-off
      // anchor is the BOOKING's check-in date, not this row's
      // service date. The per-service-date anchor slid the lock
      // forward one day per row, so the guest could add a transfer
      // a full day past the hotel's stated cut-off — and the
      // Manage page showed the SAME wrong lock state.
      const state = computeOtherAddOnCutoffState({
        checkInDate,
        addOn: { isEnabled: a.isEnabled, cutoffHoursBeforeCheckIn: a.cutoffHoursBeforeCheckIn },
        now
      });
      dateLockByAddOn.push({
        date,
        addOnId: a.id,
        isLocked: state.isLocked,
        cutoffAt: state.cutoffAt,
        minutesUntilCutoff: state.minutesUntilCutoff,
        reasonOrCutoff: state.reasonOrCutoff
      });
    }
  }

  const served =
    bookingData.otherAddOnServed && typeof bookingData.otherAddOnServed === "object"
      ? bookingData.otherAddOnServed
      : {};

  // Pending refunds with category: "otherAddOn".
  let refunds: Array<Record<string, any>> = [];
  try {
    const refundSnap = await adminDb
      .collection("bookings")
      .doc(bookingSnap.id)
      .collection("refunds")
      .where("category", "==", "otherAddOn")
      .get();
    for (const d of refundSnap.docs) {
      refunds.push({ id: d.id, ...d.data() });
    }
  } catch {
    refunds = [];
  }

  const totalPrice = Number(bookingData.totalPrice || 0);
  const otherAddOnTotal = recomputeOtherAddOnTotal(existingSelections);
  const hasAny = hasAnyOtherAddOns(existingSelections);
  const paidAmount = Number(bookingData.paidAmount || 0);
  const balance = Math.max(0, totalPrice + otherAddOnTotal - paidAmount);

  return res.status(200).json({
    success: true,
    data: {
      readOnly,
      booking: {
        id: bookingSnap.id,
        bookingRef: ref,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        numNights: dates.length,
        numGuests: Number(bookingData.numGuests || 0),
        numAdults: Number(bookingData.numAdults || bookingData.numGuests || 0),
        numChildren: Number(bookingData.numChildren || 0),
        totalPrice,
        otherAddOnTotal,
        hasAnyOtherAddOns: hasAny,
        paidAmount,
        balance,
        status
      },
      otherAddOnSelections: existingSelections,
      otherAddOnServed: served,
      refunds,
      addOns: enabledAddOns.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        price: a.price,
        unit: a.unit,
        cutoffHoursBeforeCheckIn: a.cutoffHoursBeforeCheckIn,
        displayOrder: a.displayOrder
      })),
      dateLockByAddOn
    }
  });
}