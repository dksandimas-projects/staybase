import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateBookingRef } from "@spark-inn/shared";
import config from "../../../hotel.config";
import { adminDb } from "../lib/firebase-admin";

function getLocalDate(timezone: string) {
  const localDateString = new Date().toLocaleString("en-US", {
    timeZone: timezone
  });
  return new Date(localDateString);
}

function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function handleGenerateReference(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  try {
    const timezone = config.timezone || "Asia/Manila";
    const today = getLocalDate(timezone);
    const counterId = `bookings-${getDateKey(today)}`;
    const counterRef = adminDb.collection("counters").doc(counterId);

    let bookingRef = "";
    await adminDb.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const sequence = counterDoc.exists ? (counterDoc.data()?.count || 0) + 1 : 1;

      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence, updatedAt: new Date() });
      } else {
        transaction.set(counterRef, { count: sequence, createdAt: new Date(), updatedAt: new Date() });
      }

      bookingRef = generateBookingRef(config.bookingRefPrefix || "SI", today, sequence);
    });

    return res.status(200).json({
      success: true,
      data: { bookingRef }
    });
  } catch (error) {
    console.error("Reference generation failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to generate booking reference. Please try again."
    });
  }
}
