import { generateStoreOrderRef } from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";

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

      orderItems.forEach((orderItem, index) => {
        const itemData = itemDocs[index].data()!;
        if (itemData.stock !== null && itemData.stock !== undefined) {
          transaction.update(itemRefs[index], {
            stock: itemData.stock - orderItem.quantity,
            updatedAt: new Date()
          });
        }
      });

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
