import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import { SeoPublishSchema } from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";

export async function handlePublishSeo(req: VercelRequest, res: VercelResponse) {
  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK_URL?.trim();
  if (!deployHookUrl) {
    return res.status(503).json({
      success: false,
      error: "SEO publishing is not configured. Add VERCEL_DEPLOY_HOOK_URL to the guest app environment."
    });
  }

  const parsed = SeoPublishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || "Review the SEO fields and try again."
    });
  }

  const staff = (req as any).staff as { uid?: string; email?: string } | undefined;
  await adminDb.doc("settings/seo").set({
    draft: {
      metaDescription: parsed.data.metaDescription,
      priceRange: parsed.data.priceRange,
      ogImage: parsed.data.ogImage
    },
    published: parsed.data,
    publishedAt: FieldValue.serverTimestamp(),
    publishedBy: staff?.uid || staff?.email || "admin"
  }, { merge: true });

  try {
    const hookResponse = await fetch(deployHookUrl, { method: "POST" });
    if (!hookResponse.ok) throw new Error(`Deploy hook returned ${hookResponse.status}`);
  } catch (error) {
    console.error("SEO deploy hook failed:", error);
    return res.status(502).json({
      success: false,
      error: "The SEO snapshot was saved, but the website rebuild could not be started. Please try publishing again."
    });
  }

  await adminDb.doc("settings/seo").set({ sourceChangesPending: false }, { merge: true });

  return res.status(202).json({
    success: true,
    message: "SEO changes were published and the website rebuild has started."
  });
}
