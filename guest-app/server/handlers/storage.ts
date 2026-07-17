import { z } from "zod";
import { adminStorage } from "../lib/firebase-admin";

const privateStoragePathSchema = z.object({
  path: z.string().trim().min(1).max(512)
}).strict();

const BOOKING_PRIVATE_PATH = /^bookings\/[A-Za-z0-9]{10,32}\/(?:payment-proof|discount-id)\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const STORE_PRIVATE_PATH = /^store-orders\/[A-Za-z0-9_-]{1,32}\/payment-proof\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

function isAllowedPrivatePath(path: string) {
  return BOOKING_PRIVATE_PATH.test(path) || STORE_PRIVATE_PATH.test(path);
}

export async function handleGetPrivateStorageUrl(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  if (!req.staff?.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }

  const parsed = privateStoragePathSchema.safeParse(req.body || {});
  if (!parsed.success || !isAllowedPrivatePath(parsed.data?.path || "")) {
    return res.status(400).json({ success: false, error: "Invalid private file path." });
  }

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    return res.status(500).json({ success: false, error: "Storage is not configured." });
  }

  try {
    const file = adminStorage.bucket(bucketName).file(parsed.data.path);
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ success: false, error: "Private file not found." });
    }
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const [url] = await file.getSignedUrl({ action: "read", expires: expiresAt });
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({
      success: true,
      data: { url, expiresAt: new Date(expiresAt).toISOString() }
    });
  } catch (error) {
    console.error("Private Storage URL signing failed:", error);
    return res.status(500).json({ success: false, error: "Unable to open the private file." });
  }
}
