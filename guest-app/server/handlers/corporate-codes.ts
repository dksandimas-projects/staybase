import { adminDb } from "../lib/firebase-admin";
import { validateCorporateCode } from "@spark-inn/shared";

function parseCorporateCodeExpiry(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  return null;
}

export async function handleValidateCorporateCode(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const { code } = req.body || {};
  if (!code) {
    return res.status(400).json({ success: false, error: "Corporate code is required." });
  }

  try {
    const formattedCode = String(code).trim().toUpperCase();
    const codeRef = adminDb.collection("corporateCodes").doc(formattedCode);
    const codeDoc = await codeRef.get();

    let data: any;

    if (!codeDoc.exists) {
      // Fallback query by code field
      const querySnapshot = await adminDb
        .collection("corporateCodes")
        .where("code", "==", formattedCode)
        .limit(1)
        .get();

      if (querySnapshot.empty) {
        return res.status(400).json({
          success: false,
          error: "That code is not recognized. Check the code, or continue without a code."
        });
      }

      data = querySnapshot.docs[0].data();
    } else {
      data = codeDoc.data();
    }

    if (!data) {
      return res.status(400).json({
        success: false,
        error: "That code is not recognized. Check the code, or continue without a code."
      });
    }

    const corporateCode = {
      isActive: data.isActive !== false,
      expiresAt: parseCorporateCodeExpiry(data.expiresAt),
      usageCap: data.usageCap ?? null,
      usageCount: data.usageCount || 0,
    };

    const validation = validateCorporateCode(corporateCode);
    if (!validation.valid) {
      // Map error messages to user-friendly corporate ones
      if (validation.error.includes("inactive")) {
        return res.status(400).json({
          success: false,
          error: "This code is currently inactive. Please contact the company travel admin before using it."
        });
      }
      if (validation.error.includes("expired")) {
        return res.status(400).json({
          success: false,
          error: "This corporate access code has expired. You can still continue with the flat corporate rate."
        });
      }
      if (validation.error.includes("usage limit")) {
        return res.status(400).json({
          success: false,
          error: "This code has reached its usage cap. Please ask your account manager for a refreshed code."
        });
      }
      return res.status(400).json({
        success: false,
        error: "That code is not recognized. Check the code, or continue without a code."
      });
    }

    // Compare corporateRate vs room rates to derive a discount percent (informational)
    const ratePerRoomType = data.ratePerRoomType || {};

    return res.status(200).json({
      success: true,
      data: {
        code: data.code || formattedCode,
        companyName: data.companyName,
        ratePerRoomType,
      }
    });
  } catch (error: any) {
    console.error("Error validating corporate code:", error);
    return res.status(500).json({
      success: false,
      error: "An error occurred while validating the code."
    });
  }
}
