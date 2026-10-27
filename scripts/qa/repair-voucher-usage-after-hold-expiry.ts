// REPAIR the stale voucher usage counts left by the hold-expiry cron's
// missing release (the bug fixed in this branch).
//
// SCOPE — deliberately narrow:
//   * a voucher whose `usageCount` exceeds the number of LIVE (non-
//     cancelled) bookings carrying it, AND
//   * the difference is fully explained by bookings that were CANCELLED
//     with `cancellationReason: "payment-hold-expired"` (the cron's
//     signature), AND
//   * the voucher is NOT `usageCap`-limited in a way that would make
//     the repair ambiguous.
//
// The repair sets `usageCount` to the LIVE count — the number the guest
// can actually redeem against. It never touches a voucher whose numbers
// do not reconcile.
//
// READ-ONLY unless `--apply` is passed.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

function L(f: string) {
  const o: Record<string, string> = {};
  for (const raw of readFileSync(f, "utf8").split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const e = l.indexOf("=");
    if (e === -1) continue;
    let v = l.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[l.slice(0, e).trim()] = v;
  }
  return o;
}
const vars = L("guest-app/.env.spark-inn-prod");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: vars.FIREBASE_PROJECT_ID,
      clientEmail: vars.FIREBASE_CLIENT_EMAIL,
      privateKey: String(vars.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n")
    })
  });
}
const db = getFirestore();
const APPLY = process.argv.includes("--apply");

const HOLD_REASON = "payment-hold-expired";
const vouchers = await db.collection("vouchers").get();
const bk = await db.collection("bookings").get();
const all = bk.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

let repaired = 0;
for (const v of vouchers.docs) {
  const vd = v.data() as any;
  const code = String(vd.code || v.id).trim().toUpperCase();
  const recorded = Number(vd.usageCount || 0);

  const carrying = all.filter(
    (b) => String(b.voucherCode || "").trim().toUpperCase() === code
  );
  const live = carrying.filter((b) => b.status !== "cancelled");
  const holdCancelled = carrying.filter(
    (b) => b.status === "cancelled" && String(b.cancellationReason || "") === HOLD_REASON
  );
  const otherCancelled = carrying.filter(
    (b) => b.status === "cancelled" && String(b.cancellationReason || "") !== HOLD_REASON
  );

  // The drift is only ours to fix when EVERY cancelled booking carrying
  // this code was cancelled by the hold-expiry cron. If any other
  // cancellation is involved, the count may be legitimate (a
  // staff cancel releases the voucher through the normal path).
  if (otherCancelled.length > 0) {
    console.log(`  ${code}: skipped — ${otherCancelled.length} cancellation(s) not from the hold cron`);
    continue;
  }
  if (recorded === live.length) {
    console.log(`  ${code}: already consistent (usageCount ${recorded} = ${live.length} live)`);
    continue;
  }
  if (holdCancelled.length === 0) {
    console.log(`  ${code}: skipped — no hold-cron cancellations, the count is not explained by this bug`);
    continue;
  }
  if (recorded < live.length) {
    console.log(`  ${code}: skipped — usageCount ${recorded} is BELOW the live count ${live.length}`);
    continue;
  }

  console.log(
    `  ${code}: usageCount ${recorded} → ${live.length} ` +
      `(${live.length} live + ${holdCancelled.length} hold-expired ${live.length === recorded - holdCancelled.length ? "= the drift" : "(not fully explained)"})`
  );
  if (live.length + holdCancelled.length !== recorded) {
    console.log(`     → NOT fully explained (${live.length} + ${holdCancelled.length} != ${recorded}). Skipping.`);
    continue;
  }

  if (APPLY) {
    await v.ref.update({ usageCount: live.length, updatedAt: new Date() });
    console.log(`     → APPLIED`);
    repaired += 1;
  } else {
    console.log(`     → would apply (pass --apply to write)`);
  }
}
console.log(APPLY ? `\n  repaired ${repaired} voucher(s)` : "\n  dry run — nothing written");
