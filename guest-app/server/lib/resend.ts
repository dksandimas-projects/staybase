import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;

if (!resendApiKey) {
  console.warn("⚠️ Missing RESEND_API_KEY. Emails will fail to send.");
}

export const resend = new Resend(resendApiKey || "re_mock_key");
