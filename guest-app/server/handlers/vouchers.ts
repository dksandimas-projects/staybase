import { adminDb } from "../lib/firebase-admin";
import { validateVoucher } from "@spark-inn/shared";

export async function handleValidateVoucher(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const { code, roomType } = req.body || {};
  if (!code) {
    return res.status(400).json({ success: false, error: "Voucher code is required." });
  }

  try {
    const formattedCode = String(code).trim().toUpperCase();
    const voucherRef = adminDb.collection("vouchers").doc(formattedCode);
    const voucherDoc = await voucherRef.get();

    let data: any;

    if (!voucherDoc.exists) {
      // Fallback query by code field
      const querySnapshot = await adminDb
        .collection("vouchers")
        .where("code", "==", formattedCode)
        .limit(1)
        .get();

      if (querySnapshot.empty) {
        return res.status(400).json({
          success: false,
          error: "We could not find that voucher. Check the code and try again."
        });
      }

      data = querySnapshot.docs[0].data();
    } else {
      data = voucherDoc.data();
    }

    if (!data) {
      return res.status(400).json({
        success: false,
        error: "We could not find that voucher. Check the code and try again."
      });
    }

    const voucher = {
      discountType: data.discountType,
      discountValue: data.discountValue,
      usageCap: data.usageCap ?? null,
      usageCount: data.usageCount || 0,
      expiresAt: data.expiresAt ? data.expiresAt.toDate() : null,
      applicableRoomTypes: data.applicableRoomTypes || [],
      isActive: data.isActive !== false
    };

    const validation = validateVoucher(voucher, roomType || "");
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    return res.status(200).json({
      success: true,
      data: {
        code: data.code || formattedCode,
        discountType: data.discountType,
        discountValue: data.discountValue
      }
    });
  } catch (error: any) {
    console.error("Error validating voucher:", error);
    return res.status(500).json({
      success: false,
      error: "An error occurred while validating the voucher."
    });
  }
}
