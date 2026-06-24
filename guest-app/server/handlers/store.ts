import { generateStoreOrderRef } from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";
import { sendStoreOrderTrigger } from "./email";

interface StoreOrderItemInput {
  itemId: string;
  quantity: number;
}

interface CreateStoreOrderBody {
  roomId: string;
  roomNumber: string;
  guestName: string;
  items: StoreOrderItemInput[];
  paymentMethod: "cod" | "add-to-bill" | "gcash";
  paymentProofUrl?: string;
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

function getManilaDateInfo() {
  const d = new Date();
  const manilaStr = d.toLocaleString("en-US", { timeZone: "Asia/Manila" });
  const manilaDate = new Date(manilaStr);
  const year = manilaDate.getFullYear();
  const month = String(manilaDate.getMonth() + 1).padStart(2, "0");
  const day = String(manilaDate.getDate()).padStart(2, "0");
  return {
    todayStr: `${year}-${month}-${day}`,
    manilaDate
  };
}

export async function handleCreateStoreOrder(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = req.body as CreateStoreOrderBody;
  if (!body || !body.roomId || !body.roomNumber || !body.guestName || !Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ success: false, error: "Missing required store order fields." });
  }

  if (!["cod", "add-to-bill", "gcash"].includes(body.paymentMethod)) {
    return res.status(400).json({ success: false, error: "Invalid store payment method." });
  }

  const parsedItems = body.items.map((item) => ({
    itemId: String(item.itemId || "").trim(),
    quantity: Number(item.quantity)
  }));

  if (parsedItems.some((item) => !item.itemId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
    return res.status(400).json({ success: false, error: "Invalid store order item quantity." });
  }

  if (body.paymentMethod === "gcash" && !body.paymentProofUrl) {
    return res.status(400).json({ success: false, error: "GCash payment proof is required." });
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

      if (Array.isArray(storeConfig.paymentMethods) && storeConfig.paymentMethods.length > 0) {
        const paymentMethodConfig = storeConfig.paymentMethods.find((method: any) => method.method === body.paymentMethod);
        if (paymentMethodConfig && paymentMethodConfig.isEnabled === false) {
          throw new Error("PAYMENT_METHOD_DISABLED");
        }
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
        .where("roomNumber", "==", body.roomNumber)
        .where("status", "in", ["confirmed", "checked-in"])
        .limit(1);
      const activeBookingSnapshot = await transaction.get(activeBookingQuery);
      if (!activeBookingSnapshot.empty) {
        bookingId = activeBookingSnapshot.docs[0].id;
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
        roomId: body.roomId,
        roomNumber: body.roomNumber,
        bookingId,
        guestName: body.guestName.trim(),
        items: orderItems,
        totalAmount,
        paymentMethod: body.paymentMethod,
        paymentProofUrl: body.paymentProofUrl || "",
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
            roomNumber: body.roomNumber,
            guestEmail,
            guestName: body.guestName.trim(),
            items: responseData.items,
            totalAmount: responseData.totalAmount,
            paymentMethod: body.paymentMethod,
            status: "placed"
          });
        }
      } catch (emailErr) {
        console.error("Failed to send store-order-placed email:", emailErr);
      }
    }

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    console.error("Store order creation failed:", error);
    const knownErrors: Record<string, { status: number; message: string }> = {
      STORE_DISABLED: { status: 403, message: "The in-room store is currently unavailable." },
      PAYMENT_METHOD_DISABLED: { status: 400, message: "That payment method is currently unavailable." },
      ITEM_NOT_FOUND: { status: 404, message: "One of the selected items is no longer available." },
      ITEM_INACTIVE: { status: 409, message: "One of the selected items is no longer available." },
      INSUFFICIENT_STOCK: { status: 409, message: "One of the selected items no longer has enough stock." }
    };
    const mapped = knownErrors[error.message];
    return res.status(mapped?.status || 500).json({
      success: false,
      error: mapped?.message || "Unable to place store order. Please try again."
    });
  }
}

export async function handleCancelStoreOrder(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = req.body as CancelStoreOrderBody;
  if (!body || !body.orderId || !body.roomNumber || !body.orderRef) {
    return res.status(400).json({ success: false, error: "Missing required cancellation fields." });
  }

  try {
    let cancelledOrder: any = null;
    await adminDb.runTransaction(async (transaction) => {
      const orderRef = adminDb.collection("storeOrders").doc(body.orderId);
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const orderData = orderDoc.data()!;
      if (orderData.roomNumber !== body.roomNumber) {
        throw new Error("ORDER_ROOM_MISMATCH");
      }
      if (orderData.orderRef !== body.orderRef) {
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

      transaction.update(orderRef, {
        status: "cancelled",
        cancellationReason: body.cancellationReason || "Guest cancelled from intercom",
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
          const freshDoc = await adminDb.collection("storeOrders").doc(cancelledOrder.orderRef || "").get();
          const fresh = freshDoc.exists ? freshDoc.data() : cancelledOrder;
          await sendStoreOrderTrigger("store-order-cancelled", {
            orderRef: fresh.orderRef,
            orderId: body.orderId,
            roomNumber: body.roomNumber,
            guestEmail,
            guestName: fresh.guestName,
            items: fresh.items,
            totalAmount: fresh.totalAmount,
            paymentMethod: fresh.paymentMethod,
            status: "cancelled",
            cancellationReason: body.cancellationReason || "Guest cancelled from intercom"
          });
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

  const body = req.body as StoreOrderStatusBody;
  if (!body || !body.orderId || !body.roomNumber || !body.orderRef) {
    return res.status(400).json({ success: false, error: "Missing required order status fields." });
  }

  try {
    const orderDoc = await adminDb.collection("storeOrders").doc(body.orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ success: false, error: "Store order was not found." });
    }

    const orderData = orderDoc.data()!;
    if (orderData.roomNumber !== body.roomNumber || orderData.orderRef !== body.orderRef) {
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
