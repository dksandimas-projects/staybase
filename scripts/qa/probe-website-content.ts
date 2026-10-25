// AI-BROWSER-QA (2026-10-23) — website content: the About hero heading and
// the SEO block. READ-ONLY.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}
const env = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  })
});
const db = getFirestore();
const d = await db.collection("settings").doc("websiteContent").get();
const wc = d.data() as Record<string, any>;

console.log("=== websiteContent.about ===");
console.log(JSON.stringify(wc.about, null, 1).slice(0, 2000));
console.log("\n=== websiteContent.corporate ===");
console.log(JSON.stringify(wc.corporate, null, 1).slice(0, 1200));
console.log("\n=== websiteContent.rewards ===");
console.log(JSON.stringify(wc.rewards, null, 1).slice(0, 800));
console.log("\n=== top-level keys ===");
console.log(Object.keys(wc).join(", "));
