import { z } from "zod";
import { adminDb } from "../lib/firebase-admin";
import { sendCorporateInquiryTrigger } from "./email";

const inquirySchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  contactPerson: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(6).max(40),
  numRooms: z.coerce.number().int().min(1).max(500),
  preferredDates: z.string().trim().min(1).max(160),
  specialRequirements: z.string().trim().max(2000).optional().default("")
}).strict();

export async function handleCreateCorporateInquiry(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const { _hp, turnstileToken, ...inquiryBody } = req.body || {};
  const parsed = inquirySchema.safeParse(inquiryBody);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the inquiry form and try again."
    });
  }

  const inquiry = {
    ...parsed.data,
    status: "new",
    handler: "",
    notes: [],
    accessCodeId: "",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  try {
    const docRef = await adminDb.collection("corporateInquiries").add(inquiry);

    try {
      await sendCorporateInquiryTrigger({ id: docRef.id, ...inquiry });
    } catch (emailError) {
      console.error("Corporate inquiry notification failed:", emailError);
    }

    return res.status(200).json({
      success: true,
      data: { inquiryId: docRef.id }
    });
  } catch (error) {
    console.error("Corporate inquiry creation failed:", error);
    return res.status(500).json({
      success: false,
      error: "We could not submit your inquiry right now. Please try again."
    });
  }
}
