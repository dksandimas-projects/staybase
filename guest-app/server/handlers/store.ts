import { generateStoreOrderRef, getEffectiveStorePaymentMethods, getManilaDateInfo } from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";
import { writeNotification } from "../lib/notifications";
import { sendStaffRefundReviewTrigger, sendStoreOrderTrigger } from "./email";

interface StoreOrderItemInput {
  itemId: string;
  quantity: number;
}

interface CreateStoreOrderBody {
  roomId: string;
  roomNumber: string;
  guestName: string;
  items: StoreOrderItemInput[];
  // `paymentMethod` is the open string key the admin configured
  // for the store — see `plan/features/SETTINGS.md §11 Store`.
  // Open string key from `settings/hotelConfig.paymentMethods[]`.
  // Store visibility is controlled by each method's `showInStore`
  // flag; the server validates the key against
  // `getEffectiveStorePaymentMethods(...)` inside the Firestore
  // transaction below.
  paymentMethod: string;
  paymentProofUrl?: string;
  paymentProofPath?: string;
}

interface CancelStoreOrderBody {
  orderId: string;
  roomNumber: string;
  orderRef: string;
  cancellationReason?: string;
}

interface StoreOrderStatusBody {
  orderId: string;
  roomNumber: string;
  orderRef: string;
}

interface DeliverStoreOrderBody {
  orderId: string;
}

// Per H4 (hardening batch 2026-06-26): bounded lengths on
// every free-form string the store-order endpoints accept.
// A 100KB body used to land in the order doc as-is. Values
// mirror the booking-schema caps so the two surfaces
// stay consistent.
const MAX_GUEST_NAME_LENGTH = 120;
const MAX_NOTES_LENGTH = 500;
const MAX_ROOM_NUMBER_LENGTH = 12;
const MAX_ORDER_REF_LENGTH = 40;
const MAX_REASON_LENGTH = 500;

export async function handleDeliverStoreOrder(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = (req.body || {}) as DeliverStoreOrderBody;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId || orderId.length > 64) {
    return res.status(400).json({ success: false, error: "A valid store order ID is required." });
  }

  try {
    let responseData: Record<string, unknown> = {};
    await adminDb.runTransaction(async (transaction) => {
      const orderRef = adminDb.collection("storeOrders").doc(orderId);
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const order = orderDoc.data()!;
      if (order.status === "delivered") {
        responseData = {
          orderId,
          status: "delivered",
          tenderRecorded: order.paymentMethod !== "add-to-bill"
        };
        return;
      }
      if (order.status !== "out-for-delivery") {
        throw new Error("ORDER_NOT_DELIVERABLE");
      }

      const totalAmount = Number(order.totalAmount);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0 || totalAmount > 1_000_000) {
        throw new Error("INVALID_ORDER_TOTAL");
      }

      const deliveredAt = new Date();
      const staffUid = req.staff?.uid || "staff";
      const isDirectPaid = order.paymentMethod !== "add-to-bill";

      transaction.update(orderRef, {
        status: "delivered",
        deliveredAt,
        updatedAt: deliveredAt,
        handledBy: staffUid
      });

      if (isDirectPaid) {
        // A deterministic document id makes retries idempotent. Store tenders
        // live under the order (not the linked booking), so they participate in
        // the collection-group reconciliation without reducing the room folio.
        const tenderRef = orderRef.collection("payments").doc("delivery-tender");
        transaction.set(tenderRef, {
          type: "payment",
          amount: totalAmount,
          method: order.paymentMethod === "cod" ? "cash" : String(order.paymentMethod || "unknown"),
          note: `Direct store payment for ${String(order.orderRef || orderId)}`.slice(0, 500),
          reason: null,
          approvedBy: null,
          recordedBy: staffUid,
          recordedAt: deliveredAt,
          source: "store-order",
          sourceId: orderId,
          orderRef: String(order.orderRef || orderId),
          bookingId: order.bookingId || null,
          roomNumber: String(order.roomNumber || ""),
          guestName: String(order.guestName || "")
        });
      }

      responseData = {
        orderId,
        status: "delivered",
        tenderRecorded: isDirectPaid
      };
    });

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    const knownErrors: Record<string, { status: number; message: string }> = {
      ORDER_NOT_FOUND: { status: 404, message: "Store order was not found." },
      ORDER_NOT_DELIVERABLE: { status: 409, message: "Only an order out for delivery can be marked delivered." },
      INVALID_ORDER_TOTAL: { status: 409, message: "The store order total is invalid and cannot be recorded." }
    };
    const mapped = knownErrors[error.message];
    if (!mapped) console.error("Store order delivery failed:", error);
    return res.status(mapped?.status || 500).json({
      success: false,
      error: mapped?.message || "Unable to mark the store order delivered."
    });
  }
}

// Per BF-42 (booking-flow audit 2026-06-26): the
// `getManilaDateInfo()` helper was duplicated in 5
// server-side files. The shared implementation lives in
// `shared/utils/bookingDates.ts` and is imported as
// `getManilaDateInfo` above. Local definition removed BF-42.

export async function handleCreateStoreOrder(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = (req.body || {}) as CreateStoreOrderBody;
  if (!body || !body.roomId || !body.roomNumber || !body.guestName || !Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ success: false, error: "Missing required store order fields." });
  }

  // Per H4 (hardening batch 2026-06-26): trim + cap every
  // free-form string up front so a 100KB body doesn't reach
  // the transaction. Trims happen before the length check
  // so leading/trailing whitespace doesn't count against
  // the cap.
  const roomId = String(body.roomId).trim();
  const roomNumber = String(body.roomNumber).trim();
  const guestName = String(body.guestName).trim();
  if (roomId.length === 0 || roomId.length > 64) {
    return res.status(400).json({ success: false, error: "Invalid room id." });
  }
  if (roomNumber.length === 0 || roomNumber.length > MAX_ROOM_NUMBER_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid room number." });
  }
  if (guestName.length === 0 || guestName.length > MAX_GUEST_NAME_LENGTH) {
    return res.status(400).json({ success: false, error: "Please share the guest's name (up to 120 characters)." });
  }

  if (typeof body.paymentMethod !== "string" || body.paymentMethod.length === 0) {
    return res.status(400).json({ success: false, error: "Invalid store payment method." });
  }

  const parsedItems = body.items.map((item) => ({
    itemId: String(item.itemId || "").trim(),
    quantity: Number(item.quantity)
  }));

  if (parsedItems.some((item) => !item.itemId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
    return res.status(400).json({ success: false, error: "Invalid store order item quantity." });
  }

  // Per #110 (store toggle): any non-`cod`/non-`add-to-bill`
  // method is an "online" payment that requires a proof of
  // transfer screenshot. Mirrors the client-side check in
  // `IntercomPage.tsx → isOnlinePaymentMethod`. New uploads send a
  // private object path; `paymentProofUrl` remains legacy-only.
  // Either may be empty for `cod` / `add-to-bill` (we
  // coalesce to `""` when writing the order doc).
  const isOnlinePaymentMethod = body.paymentMethod !== "cod" && body.paymentMethod !== "add-to-bill";
  const expectedProofPrefix = `store-orders/${roomNumber}/payment-proof/`;
  const paymentProofPath = typeof body.paymentProofPath === "string" ? body.paymentProofPath.trim() : "";
  const proofFileName = paymentProofPath.slice(expectedProofPrefix.length);
  if (paymentProofPath && (!paymentProofPath.startsWith(expectedProofPrefix) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(proofFileName))) {
    return res.status(400).json({ success: false, error: "Invalid payment proof path." });
  }
  if (isOnlinePaymentMethod && !paymentProofPath && !body.paymentProofUrl) {
    return res.status(400).json({ success: false, error: "Payment proof is required for this method." });
  }

  const normalizedItems = Array.from(
    parsedItems.reduce((itemsById, item) => {
      const current = itemsById.get(item.itemId) || 0;
      itemsById.set(item.itemId, current + item.quantity);
      return itemsById;
    }, new Map<string, number>())
  ).map(([itemId, quantity]) => ({ itemId, quantity }));

  try {
    let responseData: { orderId: string; orderRef: string; totalAmount: number; bookingId: string | null; items: any[] } | null = null;
    const { todayStr, manilaDate } = getManilaDateInfo();

    await adminDb.runTransaction(async (transaction) => {
      const storeConfigRef = adminDb.collection("settings").doc("storeConfig");
      const storeConfigDoc = await transaction.get(storeConfigRef);
      const storeConfig = storeConfigDoc.exists ? storeConfigDoc.data()! : { isEnabled: true, paymentMethods: [] };

      if (storeConfig.isEnabled === false) {
        throw new Error("STORE_DISABLED");
      }

      // Store payment methods now come from the single Payment
      // Methods list (`settings/hotelConfig.paymentMethods[]`).
      // Reading `hotelConfig` inside the transaction keeps the
      // allowlist in sync with any concurrent admin edits.
      const hotelConfigRef = adminDb.collection("settings").doc("hotelConfig");
      const hotelConfigDoc = await transaction.get(hotelConfigRef);
      const hotelConfigData = hotelConfigDoc.exists ? hotelConfigDoc.data() : null;
      const paymentMethods = Array.isArray(hotelConfigData?.paymentMethods)
        ? hotelConfigData.paymentMethods
        : [];
      const effectiveMethods = getEffectiveStorePaymentMethods(paymentMethods);
      const effectiveSet = new Set<string>(effectiveMethods.map((m) => m.method));
      if (!effectiveSet.has(body.paymentMethod)) {
        throw new Error("PAYMENT_METHOD_DISABLED");
      }

      const itemRefs = normalizedItems.map((item) => adminDb.collection("storeItems").doc(item.itemId));
      const itemDocs = await Promise.all(itemRefs.map((itemRef) => transaction.get(itemRef)));

      const orderItems = itemDocs.map((itemDoc, index) => {
        if (!itemDoc.exists) {
          throw new Error("ITEM_NOT_FOUND");
        }

        const data = itemDoc.data()!;
        if (data.isActive === false) {
          throw new Error("ITEM_INACTIVE");
        }

        const requested = normalizedItems[index];
        const stock = data.stock ?? null;
        if (stock !== null && stock < requested.quantity) {
          throw new Error("INSUFFICIENT_STOCK");
        }

        return {
          itemId: itemDoc.id,
          name: data.name || "Store item",
          price: Number(data.price || 0),
          quantity: requested.quantity
        };
      });

      let bookingId: string | null = null;
      const activeBookingQuery = adminDb.collection("bookings")
        .where("roomNumber", "==", roomNumber)
        .where("status", "in", ["confirmed", "checked-in"])
        .limit(1);
      const activeBookingSnapshot = await transaction.get(activeBookingQuery);
      if (!activeBookingSnapshot.empty) {
        bookingId = activeBookingSnapshot.docs[0].id;
      }

      // Per H4 (hardening batch 2026-06-26): the in-room
      // store is intended for guests of an active
      // reservation. Previously anyone with a room number
      // + item id could place an order — fine for the
      // in-room tablet, but a bot on the hotel Wi-Fi could
      // order items to any room. We require an active
      // booking tied to the room; a payment trace is
      // optional (the room can be in `confirmed` status
      // even before check-in).
      //
      // Staff walk-ins (handled by the staff app, which
      // authenticates with a Firebase ID token + sets
      // `req.staff`) bypass this check via the route
      // allowlist.
      if (!bookingId) {
        throw new Error("NO_ACTIVE_BOOKING");
      }

      const counterRef = adminDb.collection("counters").doc(`store-orders-${todayStr}`);
      const counterDoc = await transaction.get(counterRef);
      const sequence = counterDoc.exists ? (counterDoc.data()?.count || 0) + 1 : 1;
      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence });
      } else {
        transaction.set(counterRef, { count: sequence });
      }

      const orderRef = generateStoreOrderRef(manilaDate, sequence);
      const totalAmount = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const orderDocRef = adminDb.collection("storeOrders").doc();

      transaction.set(orderDocRef, {
        orderRef,
        roomId,
        roomNumber,
        bookingId,
        guestName,
        items: orderItems,
        totalAmount,
        paymentMethod: body.paymentMethod,
        paymentProofUrl: body.paymentProofUrl || "",
        paymentProofPath: paymentProofPath || "",
        status: "placed",
        stockRestoredAt: null,
        stockDecrementedAt: null,
        isBilled: false,
        billedAt: null,
        cancellationReason: "",
        handledBy: "",
        notes: "",
        createdAt: new Date(),
        updatedAt: new Date()
      });

      responseData = {
        orderId: orderDocRef.id,
        orderRef,
        totalAmount,
        bookingId,
        items: orderItems
      };
    });

    // Per W4.4 / decision #104: fire the placed email after the
    // transaction commits. The guest's email is looked up from
    // the active booking (if any) by Admin SDK. Idempotent — the
    // email helper no-ops if guestEmail is missing.
    if (responseData) {
      try {
        let guestEmail = "";
        if (responseData.bookingId) {
          const bookingDoc = await adminDb.collection("bookings").doc(responseData.bookingId).get();
          if (bookingDoc.exists) {
            guestEmail = String(bookingDoc.data()?.guestEmail || "");
          }
        }
        if (guestEmail) {
          await sendStoreOrderTrigger("store-order-placed", {
            orderRef: responseData.orderRef,
            orderId: responseData.orderId,
            roomNumber,
            guestEmail,
            guestName,
            items: responseData.items,
            totalAmount: responseData.totalAmount,
            paymentMethod: body.paymentMethod,
            status: "placed"
          });
        }
      } catch (emailErr) {
        console.error("Failed to send store-order-placed email:", emailErr);
      }

      // Per Phase 12 — Notification Center (decision #120):
      // persist a `notifications` doc for the bell panel so
      // the front desk sees the store order in the persistent
      // log. Deep-links to /store-management via entityId.
      //
      // Per NC-01 (post-ship review 2026-07-15): awaited
      // so Vercel does not freeze the instance after
      // `res.json()` and drop the doc. Safe — the helper
      // never throws.
      await writeNotification({
        type: "store-order",
        title: `New store order — ${responseData.orderRef} (Room ${roomNumber})`,
        entityType: "storeOrder",
        entityId: responseData.orderId,
        roomNumber,
        bookingRef: null
      });
    }

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    console.error("Store order creation failed:", error);
    const knownErrors: Record<string, { status: number; message: string }> = {
      STORE_DISABLED: { status: 403, message: "The in-room store is currently unavailable." },
      PAYMENT_METHOD_DISABLED: { status: 400, message: "That payment method is currently unavailable." },
      ITEM_NOT_FOUND: { status: 404, message: "One of the selected items is no longer available." },
      ITEM_INACTIVE: { status: 409, message: "One of the selected items is no longer available." },
      INSUFFICIENT_STOCK: { status: 409, message: "One of the selected items no longer has enough stock." },
      NO_ACTIVE_BOOKING: {
        // Per H4: the in-room store requires an active
        // reservation. Return 403 (not 404) so the client
        // distinguishes "no booking" from "stock error".
        status: 403,
        message: "Store orders require an active reservation in this room."
      }
    };
    const mapped = knownErrors[error.message];
    return res.status(mapped?.status || 500).json({
      success: false,
      error: mapped?.message || "Unable to place store order. Please try again."
    });
  }
}

// Per DECISIONS-FEATURES.md #80 + plan/features/STORE-MANAGEMENT.md:67:
// stock decrement happens on order confirmation, not on order
// creation. This is the missing half of the create-then-confirm
// split. The cancel handler at line ~427 checks `stockDecrementedAt`
// before restoring — that check has always been there; what was
// missing is the matching confirm-side write that SETS
// `stockDecrementedAt`. Without this handler, stock is never
// decremented and an order can be "confirmed" without any
// inventory change.
//
// STR-01 (2026-08-14, found during the audit pass that followed
// RPT-05 + EXB-12.1 + VOU-01): the spec promised this handler but
// it was never built. The handler composes with the cancel
// handler's `!stockRestoredAt && stockDecrementedAt` guard —
// confirm writes `stockDecrementedAt`, cancel reads it.
//
// Behavior:
//   1. Staff-authenticated (the deliver-order endpoint is the
//      same shape; the desk confirms orders as part of the
//      placed → confirmed → out-for-delivery → delivered flow).
//   2. Reads the order + each storeItems doc in one transaction
//      (FOL-03 reads-before-writes rule).
//   3. Idempotent: if `stockDecrementedAt` is already set, return
//      success without decrementing again. This handles the
//      "desk double-clicks Confirm" race + the "confirm-order is
//      retried after a Vercel freeze" case.
//   4. For each item with `stock !== null && stock !== undefined`
//      (skipping unlimited inventory items), decrements
//      `stock` by `item.quantity`. Throws `OUT_OF_STOCK` if any
//      decrement would push stock below 0 — the transaction
//      aborts, the desk sees the error, no partial decrement.
//   5. Sets `status: "confirmed"`, `stockDecrementedAt: now`,
//      `handledBy: req.staff?.uid`, `updatedAt: now` on the
//      order doc.
//   6. Best-effort email (mirrors the deliver-order flow).
export async function handleConfirmStoreOrder(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = (req.body || {}) as CancelStoreOrderBody;
  if (!body || !body.orderId || !body.roomNumber || !body.orderRef) {
    return res.status(400).json({ success: false, error: "Missing required confirmation fields." });
  }

  // Per H4 (hardening batch 2026-06-26): trim + cap
  // every free-form string before the transaction. Same
  // trim/cap pattern as handleCancelStoreOrder.
  const orderId = String(body.orderId).trim();
  const roomNumber = String(body.roomNumber).trim();
  const orderRef = String(body.orderRef).trim();
  if (orderId.length === 0 || orderId.length > 64) {
    return res.status(400).json({ success: false, error: "Invalid order id." });
  }
  if (roomNumber.length === 0 || roomNumber.length > MAX_ROOM_NUMBER_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid room number." });
  }
  if (orderRef.length === 0 || orderRef.length > MAX_ORDER_REF_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid order reference." });
  }

  // Per STR-01: confirm is a staff operation. The
  // router wraps this in `authenticateStaff`; the
  // handler reads `req.staff?.uid` for `handledBy`.
  const staffUid = String(req.staff?.uid || "staff");

  try {
    let confirmedOrder: any = null;
    await adminDb.runTransaction(async (transaction) => {
      const orderRefDoc = adminDb.collection("storeOrders").doc(orderId);
      const orderDoc = await transaction.get(orderRefDoc);
      if (!orderDoc.exists) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const orderData = orderDoc.data()!;
      if (String(orderData.roomNumber || "").trim() !== roomNumber) {
        throw new Error("ORDER_ROOM_MISMATCH");
      }
      if (String(orderData.orderRef || "").trim() !== orderRef) {
        throw new Error("ORDER_REF_MISMATCH");
      }
      if (orderData.status !== "placed") {
        throw new Error("ORDER_NOT_CONFIRMABLE");
      }

      // Idempotency: if the operator double-clicks
      // Confirm, the second call returns success
      // without decrementing again. Also covers the
      // Vercel-freeze retry case where the first call
      // committed but the response didn't reach the
      // client.
      if (orderData.stockDecrementedAt) {
        confirmedOrder = orderData;
        return;
      }

      // Per FOL-03 reads-before-writes: read the order
      // + every storeItem doc BEFORE any writes. The
      // stock decrement + the order-doc writes go in
      // one contiguous write block after the reads.
      const orderItems = Array.isArray(orderData.items) ? orderData.items : [];
      const itemRefs = orderItems.map((item: any) => adminDb.collection("storeItems").doc(item.itemId));
      const itemDocs = await Promise.all(itemRefs.map((itemRef) => transaction.get(itemRef)));

      for (let index = 0; index < orderItems.length; index++) {
        const item = orderItems[index];
        const itemDoc = itemDocs[index];
        if (!itemDoc.exists) continue;
        const itemData = itemDoc.data()!;
        // Skip unlimited stock items (stock: null).
        if (itemData.stock === null || itemData.stock === undefined) continue;
        const currentStock = Number(itemData.stock || 0);
        const requestedQuantity = Number(item.quantity || 0);
        const newStock = currentStock - requestedQuantity;
        // Race-safety: a concurrent order between stock
        // check + decrement could push stock negative.
        // Throw to abort the transaction (no partial
        // decrement lands) so the desk never confirms
        // an order the inventory can't fill.
        if (newStock < 0) {
          throw new Error("OUT_OF_STOCK");
        }
        transaction.update(itemRefs[index], {
          stock: newStock,
          updatedAt: new Date()
        });
      }

      transaction.update(orderRefDoc, {
        status: "confirmed",
        stockDecrementedAt: new Date(),
        handledBy: staffUid,
        updatedAt: new Date()
      });

      confirmedOrder = { ...orderData, status: "confirmed", stockDecrementedAt: new Date() };
    });

    // Per W4.4 / decision #104: fire the confirmed
    // email after the transaction commits. The guest's
    // email is looked up from the active booking (if
    // any) by Admin SDK. Idempotent — the email helper
    // no-ops if guestEmail is missing. The "store-order-confirmed"
    // action is already in the EmailAction enum
    // (email.ts:77) and the template is built at email.ts:1778 —
    // this handler was the missing caller.
    if (confirmedOrder) {
      try {
        let guestEmail = "";
        if (confirmedOrder.bookingId) {
          const bookingDoc = await adminDb.collection("bookings").doc(confirmedOrder.bookingId).get();
          if (bookingDoc.exists) {
            guestEmail = String(bookingDoc.data()?.guestEmail || "");
          }
        }
        await sendStoreOrderTrigger("store-order-confirmed", {
          ...confirmedOrder,
          guestEmail,
          handledBy: staffUid
        });
      } catch (emailErr) {
        console.error("Failed to send store confirmation email:", emailErr);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        orderId,
        status: "confirmed",
        idempotentReplay: confirmedOrder ? !confirmedOrder.stockDecrementedAt || false : false
      }
    });
  } catch (error: any) {
    const message = error.message || "Unable to confirm the store order.";
    const statusMap: Record<string, number> = {
      ORDER_NOT_FOUND: 404,
      ORDER_ROOM_MISMATCH: 403,
      ORDER_REF_MISMATCH: 403,
      ORDER_NOT_CONFIRMABLE: 400,
      OUT_OF_STOCK: 409
    };
    const status = statusMap[message] || 500;
    return res.status(status).json({ success: false, error: message });
  }
}

export async function handleCancelStoreOrder(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = (req.body || {}) as CancelStoreOrderBody;
  if (!body || !body.orderId || !body.roomNumber || !body.orderRef) {
    return res.status(400).json({ success: false, error: "Missing required cancellation fields." });
  }

  // Per H4 (hardening batch 2026-06-26): trim + cap
  // every free-form string before the transaction. The
  // room-number + order-ref comparison below used to
  // fail silently on trailing whitespace — a legitimate
  // copy-paste bug, but also a way for a bot to
  // distinguish "no match" from "match" via timing.
  const orderId = String(body.orderId).trim();
  const roomNumber = String(body.roomNumber).trim();
  const orderRef = String(body.orderRef).trim();
  const cancellationReason = typeof body.cancellationReason === "string"
    ? body.cancellationReason.trim().slice(0, MAX_REASON_LENGTH)
    : "";
  if (orderId.length === 0 || orderId.length > 64) {
    return res.status(400).json({ success: false, error: "Invalid order id." });
  }
  if (roomNumber.length === 0 || roomNumber.length > MAX_ROOM_NUMBER_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid room number." });
  }
  if (orderRef.length === 0 || orderRef.length > MAX_ORDER_REF_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid order reference." });
  }

  try {
    let cancelledOrder: any = null;
    await adminDb.runTransaction(async (transaction) => {
      const orderRefDoc = adminDb.collection("storeOrders").doc(orderId);
      const orderDoc = await transaction.get(orderRefDoc);
      if (!orderDoc.exists) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const orderData = orderDoc.data()!;
      if (String(orderData.roomNumber || "").trim() !== roomNumber) {
        throw new Error("ORDER_ROOM_MISMATCH");
      }
      if (String(orderData.orderRef || "").trim() !== orderRef) {
        throw new Error("ORDER_REF_MISMATCH");
      }
      if (orderData.status !== "placed") {
        throw new Error("ORDER_NOT_CANCELLABLE");
      }

      const orderItems = Array.isArray(orderData.items) ? orderData.items : [];
      const itemRefs = orderItems.map((item: any) => adminDb.collection("storeItems").doc(item.itemId));
      const itemDocs = await Promise.all(itemRefs.map((itemRef) => transaction.get(itemRef)));

      if (!orderData.stockRestoredAt && orderData.stockDecrementedAt) {
        orderItems.forEach((item: any, index: number) => {
          const itemDoc = itemDocs[index];
          if (!itemDoc.exists) return;
          const itemData = itemDoc.data()!;
          if (itemData.stock !== null && itemData.stock !== undefined) {
            transaction.update(itemRefs[index], {
              stock: Number(itemData.stock || 0) + Number(item.quantity || 0),
              updatedAt: new Date()
            });
          }
        });
      }

      transaction.update(orderRefDoc, {
        status: "cancelled",
        // Per H4: prefer the (now-capped) `cancellationReason`
        // collected at the top of the handler, falling back to
        // the default message if the guest supplied nothing.
        cancellationReason: cancellationReason || "Guest cancelled from intercom",
        stockRestoredAt: new Date(),
        updatedAt: new Date()
      });

      // Capture the order snapshot for the post-transaction
      // email. The guest's email is looked up from the active
      // booking (if any) — see post-transaction block below.
      cancelledOrder = orderData;
    });

    // Per W4.4 / decision #104: fire the cancelled email. We
    // re-read the order to get the latest status (cancelled) +
    // the cancellation reason.
    if (cancelledOrder) {
      try {
        let guestEmail = "";
        if (cancelledOrder.bookingId) {
          const bookingDoc = await adminDb.collection("bookings").doc(cancelledOrder.bookingId).get();
          if (bookingDoc.exists) {
            guestEmail = String(bookingDoc.data()?.guestEmail || "");
          }
        }
        if (guestEmail) {
          // Per H4 (hardening batch 2026-06-26): the
          // previous code queried `cancelledOrder.orderRef`
          // as the doc id, which is wrong — that's the
          // human-readable ref (e.g. `SO-20260615-001`),
          // not the Firestore doc id (`body.orderId`).
          // The query returned `exists: false` and the
          // email used the stale snapshot. The fix binds
          // the re-read to `orderId`.
          const freshDoc = await adminDb.collection("storeOrders").doc(orderId).get();
          const fresh = freshDoc.exists ? freshDoc.data() : cancelledOrder;
          await sendStoreOrderTrigger("store-order-cancelled", {
            orderRef: fresh.orderRef,
            orderId,
            roomNumber,
            guestEmail,
            guestName: fresh.guestName,
            items: fresh.items,
            totalAmount: fresh.totalAmount,
            paymentMethod: fresh.paymentMethod,
            status: "cancelled",
            cancellationReason: cancellationReason || "Guest cancelled from intercom"
          });
        }

        // Per CRL-04 (2026-08-02): a paid GCash store order
        // was cancelled — the guest has already sent money
        // via GCash, and the cancellation alone does not
        // issue a refund. The guest email mentions that
        // the front desk will reach out, but the staff
        // also need a dedicated, queue-able alert so the
        // refund review has an owner. COD (`paymentMethod
        // === "cod"`) and Add-to-Bill orders do not need
        // a refund review: the money has either not been
        // collected yet (COD) or rolls into the booking
        // folio (Add-to-Bill, settled at checkout).
        const freshDoc = await adminDb.collection("storeOrders").doc(orderId).get();
        const fresh = freshDoc.exists ? freshDoc.data() : cancelledOrder;
        if (fresh && fresh.paymentMethod === "gcash" && fresh.paymentProofUrl) {
          try {
            await sendStaffRefundReviewTrigger({
              orderRef: fresh.orderRef,
              orderId,
              roomNumber,
              guestName: fresh.guestName,
              totalAmount: fresh.totalAmount,
              paymentMethod: fresh.paymentMethod,
              paymentProofUrl: fresh.paymentProofUrl,
              cancellationReason: cancellationReason || "Guest cancelled from intercom",
              bookingId: fresh.bookingId || null
            });
          } catch (staffEmailErr) {
            // Best-effort: the staff alert is a queue item,
            // not a payment. A failure here does not block
            // the cancellation; the order's audit row is
            // the canonical record.
            console.error("Failed to send staff refund-review alert:", staffEmailErr);
          }
        }
      } catch (emailErr) {
        console.error("Failed to send store-order-cancelled email:", emailErr);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Store order cancellation failed:", error);
    const knownErrors: Record<string, { status: number; message: string }> = {
      ORDER_NOT_FOUND: { status: 404, message: "Store order was not found." },
      ORDER_ROOM_MISMATCH: { status: 403, message: "This order does not belong to this room." },
      ORDER_REF_MISMATCH: { status: 403, message: "This order reference does not match." },
      ORDER_NOT_CANCELLABLE: { status: 409, message: "This order can no longer be cancelled from the guest page." }
    };
    const mapped = knownErrors[error.message];
    return res.status(mapped?.status || 500).json({
      success: false,
      error: mapped?.message || "Unable to cancel store order. Please contact the front desk."
    });
  }
}

export async function handleGetStoreOrderStatus(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = (req.body || {}) as StoreOrderStatusBody;
  if (!body || !body.orderId || !body.roomNumber || !body.orderRef) {
    return res.status(400).json({ success: false, error: "Missing required order status fields." });
  }

  // Per H4 (hardening batch 2026-06-26): same trim + cap
  // pattern as the cancel handler so a 100KB body or a
  // trailing-space room number doesn't reach Firestore.
  const orderId = String(body.orderId).trim();
  const roomNumber = String(body.roomNumber).trim();
  const orderRef = String(body.orderRef).trim();
  if (orderId.length === 0 || orderId.length > 64) {
    return res.status(400).json({ success: false, error: "Invalid order id." });
  }
  if (roomNumber.length === 0 || roomNumber.length > MAX_ROOM_NUMBER_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid room number." });
  }
  if (orderRef.length === 0 || orderRef.length > MAX_ORDER_REF_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid order reference." });
  }

  try {
    const orderDoc = await adminDb.collection("storeOrders").doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ success: false, error: "Store order was not found." });
    }

    const orderData = orderDoc.data()!;
    if (String(orderData.roomNumber || "").trim() !== roomNumber || String(orderData.orderRef || "").trim() !== orderRef) {
      return res.status(403).json({ success: false, error: "This order does not belong to this room." });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: orderData.status || "placed",
        updatedAt: orderData.updatedAt?.toDate ? orderData.updatedAt.toDate().toISOString() : null
      }
    });
  } catch (error) {
    console.error("Store order status lookup failed:", error);
    return res.status(500).json({ success: false, error: "Unable to refresh store order status." });
  }
}
