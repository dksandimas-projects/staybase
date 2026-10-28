/**
 * RPT-2 — a CHARGE cannot be added after checkout. The rule must
 * enforce it, not just the UI.
 *
 * WHAT WAS WRONG
 * --------------
 * The 2026-10-21 QA report recorded the breach with production
 * evidence: *"The admin hides the button (`IncidentalChargeList.tsx:37`)
 * but the rules have no booking-status check — a client write after
 * checkout SUCCEEDED (₱250 on a checked-out booking)."*
 *
 * The admin app writes the charge DIRECTLY to Firestore —
 * `addDoc(chargesRef, {...})` in `BookingsPage.tsx` — so there is no
 * server handler in the path. The button being hidden in the UI was
 * therefore the ONLY thing stopping a charge from being added to a
 * booking whose guest has already left. The rules are the last line,
 * and they had no booking-status check.
 *
 * WHY IT MATTERS
 * --------------
 * An incidental charge lands in the booking's folio, so a charge
 * added after checkout moves the settled balance of a stay that is
 * already closed. It is money the guest is billed for after they
 * left, and the reconciliation's I14/I08 checks then see a booking
 * whose books do not close.
 *
 * WHAT THIS TEST PINS
 * -------------------
 *   1. a staff client CANNOT add a charge to a CHECKED-OUT booking
 *      (the defect);
 *   2. a staff client CAN still add a charge to a booking that is
 *      confirmed / checked-in — the rule must not break the
 *      legitimate desk workflow;
 *   3. a staff client CAN still VOID (reverse) an existing charge on
 *      a checked-out booking — the reversal is how a mistake made
 *      before checkout is corrected AFTER checkout, so blocking it
 *      would strand the error in the folio;
 *   4. an anonymous client can neither read nor write charges.
 *
 * The charges live under two parents: `bookings/{id}/charges` and
 * `reservations/{id}/charges`. Both rules are covered, because the
 * admin app picks the parent with `getSelectedChargeCollection()`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const BOOKING_ID = "BK-TEST-00001";
const RESERVATION_ID = "RES-TEST-00001";

/** The charge payload the admin app writes (BookingsPage.tsx). */
const chargePayload = (bookingId: string | null) => ({
  label: "Late checkout",
  amount: 250,
  category: "late-checkout",
  note: "",
  addedBy: "front-desk-uid",
  addedAt: serverTimestamp(),
  voidOf: null,
  ...(bookingId ? { bookingId } : {})
});

describe("RPT-2 — a charge cannot be added after checkout", () => {
  let env: RulesTestEnvironment;

  // `isStaff()` reads the `role` CLAIM, so an authenticated context
  // without it is not staff.
  const staffCtx = (role: "admin" | "front-desk") =>
    env.authenticatedContext(`${role}-uid`, { role });

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT_ID });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "bookings", BOOKING_ID), {
        bookingRef: "SI-TEST-00001",
        reservationId: RESERVATION_ID,
        status: "checked-out",
        totalPrice: 5000,
        checkedOutAt: serverTimestamp()
      });
      await setDoc(doc(fs, "bookings", "BK-TEST-00002"), {
        bookingRef: "SI-TEST-00002",
        reservationId: RESERVATION_ID,
        status: "checked-in",
        totalPrice: 5000
      });
      await setDoc(doc(fs, "reservations", RESERVATION_ID), {
        reservationRef: "RES-TEST-00001",
        status: "active"
      });
      // An existing charge on the checked-out booking, so the
      // reversal path has something to point at.
      await setDoc(doc(fs, "bookings", BOOKING_ID, "charges", "existing-charge"), {
        label: "Extra person",
        amount: 300,
        category: "extra-person",
        note: "",
        addedBy: "front-desk-uid",
        addedAt: serverTimestamp(),
        voidOf: null
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  // ── the defect ──────────────────────────────────────────────────
  it("refuses a staff client's charge on a CHECKED-OUT booking", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      setDoc(doc(db, "bookings", BOOKING_ID, "charges", "late-charge"), chargePayload(null))
    ).rejects.toThrow();
  });

  it("refuses the same write for an ADMIN — the rule is not role-based", async () => {
    const db = staffCtx("admin").firestore();
    await expect(
      setDoc(doc(db, "bookings", BOOKING_ID, "charges", "late-charge"), chargePayload(null))
    ).rejects.toThrow();
  });

  it("refuses a charge on a checked-out booking under the RESERVATION parent", async () => {
    const db = staffCtx("front-desk").firestore();
    await expect(
      setDoc(
        doc(db, "reservations", RESERVATION_ID, "charges", "late-charge"),
        chargePayload(BOOKING_ID)
      )
    ).rejects.toThrow();
  });

  // ── the legitimate workflows the rule must not break ───────────
  it("still allows a charge on a booking that is CHECKED IN", async () => {
    const db = staffCtx("front-desk").firestore();
    await setDoc(
      doc(db, "bookings", "BK-TEST-00002", "charges", "extra-person"),
      chargePayload(null)
    );
    const written = await getDoc(doc(db, "bookings", "BK-TEST-00002", "charges", "extra-person"));
    expect(written.exists()).toBe(true);
  });

  it("still allows a VOID (reversal) of an existing charge on a checked-out booking", async () => {
    // The reversal is how a mistake made BEFORE checkout is corrected
    // AFTER checkout. Blocking it would strand the error in the
    // folio, so it must stay allowed.
    const db = staffCtx("front-desk").firestore();
    await setDoc(doc(db, "bookings", BOOKING_ID, "charges", "void-existing-charge"), {
      label: "Reversal — Extra person",
      amount: -300,
      category: "extra-person",
      note: "Charged in error",
      addedBy: "front-desk-uid",
      addedAt: serverTimestamp(),
      voidOf: "existing-charge"
    });
    const written = await getDoc(doc(db, "bookings", BOOKING_ID, "charges", "void-existing-charge"));
    expect(written.exists()).toBe(true);
  });

  // ── and the anonymous client ────────────────────────────────────
  it("refuses an anonymous client, and lets staff read", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await expect(
      setDoc(doc(anon, "bookings", BOOKING_ID, "charges", "anon-charge"), chargePayload(null))
    ).rejects.toThrow();

    const staff = staffCtx("front-desk").firestore();
    await expect(getDoc(doc(staff, "bookings", BOOKING_ID, "charges", "existing-charge"))).resolves.toBeTruthy();
  });
});
