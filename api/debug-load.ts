import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {
    const mod = await import("../guest-app/api/_handler.js");
    return res.status(200).json({ success: true, message: "Successfully loaded _handler" });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
      stack: err.stack
    });
  }
}
