import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateBookingRef, getManilaDateInfo } from "@spark-inn/shared";
import config from "../../../hotel.config";
import { adminDb } from "../lib/firebase-admin";

// Per BF-42 (booking-flow audit 2026-06-26): the
// `getLocalDate` + `getDateKey` helpers here were a third
// copy of the Asia/Manila date logic that the other handlers
// had. The shared `getManilaDateInfo()` now provides the
// equivalent (`todayStr` = the YYYY-MM-DD counter key). Local
// helpers removed.

export async function handleGenerateReference(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  try {
    const timezone = config.timezone || "Asia/Manila";
    const { todayStr: counterId, manilaDate: today } = getManilaDateInfo(timezone);
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
