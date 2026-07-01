import type { VercelRequest, VercelResponse } from "@vercel/node";
import runHandler from "./_handler";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always set CORS headers for debugging so the browser doesn't block the error details
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    return await runHandler(req, res);
  } catch (err: any) {
    console.error("Critical error in guest-app handler:", err);
    return res.status(500).json({
      success: false,
      error: "Runtime crash in guest-app handler",
      message: err.message || String(err),
      stack: err.stack
    });
  }
}
