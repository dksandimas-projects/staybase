import { adminDb } from "../lib/firebase-admin";
import { sendContactInquiryTrigger } from "./email";

interface ContactInquiryBody {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  turnstileToken?: string;
  _hp?: string;
}

function isNonEmptyString(value: unknown, maxLen: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLen;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isLikelySpam(name: string, email: string, subject: string, message: string): boolean {
  const urlPattern = /https?:\/\//i;
  const repeated = /(.)\1{12,}/;
  const tooManyLinks = (value: string) => (value.match(/https?:\/\//gi) || []).length > 4;
  return (
    urlPattern.test(name) ||
    urlPattern.test(subject) ||
    tooManyLinks(message) ||
    repeated.test(message)
  );
}

export async function handleCreateContactInquiry(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = (req.body || {}) as ContactInquiryBody;
  const { _hp, turnstileToken, ...rest } = body;
  const name = typeof rest.name === "string" ? rest.name.trim() : "";
  const email = typeof rest.email === "string" ? rest.email.trim().toLowerCase() : "";
  const subject = typeof rest.subject === "string" ? rest.subject.trim() : "";
  const message = typeof rest.message === "string" ? rest.message.trim() : "";

  if (!isNonEmptyString(name, 120)) {
    return res.status(400).json({ success: false, error: "Please share your name." });
  }
  if (!isNonEmptyString(email, 160) || !isLikelyEmail(email)) {
    return res.status(400).json({ success: false, error: "Please share a valid email." });
  }
  if (!isNonEmptyString(subject, 160)) {
    return res.status(400).json({ success: false, error: "Please add a short subject." });
  }
  if (!isNonEmptyString(message, 4000)) {
    return res.status(400).json({ success: false, error: "Please share a message (up to 4000 characters)." });
  }

  if (isLikelySpam(name, email, subject, message)) {
    return res.status(400).json({ success: false, error: "Your message was flagged by our spam filter. Please rephrase." });
  }

  const inquiry = {
    name,
    email,
    subject,
    message,
    status: "new" as const,
    isRead: false,
    handledBy: "",
    notes: [] as string[],
    source: "contact-page",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  try {
    const docRef = await adminDb.collection("contactInquiries").add(inquiry);

    try {
      await sendContactInquiryTrigger({ id: docRef.id, ...inquiry });
    } catch (emailError) {
      console.error("Contact inquiry notification failed:", emailError);
    }

    return res.status(200).json({
      success: true,
      data: { inquiryId: docRef.id }
    });
  } catch (error) {
    console.error("Contact inquiry creation failed:", error);
    return res.status(500).json({
      success: false,
      error: "We could not send your message right now. Please try again in a moment."
    });
  }
}

export const __testing__ = { isLikelySpam, escapeRegExp };
