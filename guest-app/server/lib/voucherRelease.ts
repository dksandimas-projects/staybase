// Per MRB-13: a cancelled booking RELEASES the voucher and
// corporate-code uses it consumed.
//
// This module is the ONE implementation of that release, shared by
// every path that cancels a booking:
//
//   * `handleCancelBooking` (the guest + staff cancel) — the original
//   * `handleHoldExpiryCron` (the daily expiry cron)
//   * the in-transaction retirements in the create / walkin /
//     reschedule handlers (a new booking takes the room from an
//     expired hold)
//
// WHY IT IS SHARED
// ----------------
// The hold-expiry cron shipped without the release the guest cancel
// path had, and that gap was live in production for months: every
// expired hold burned a use of a voucher nobody spent, so a voucher's
// `usageCap` was consumed by bookings that were never completed and a
// legitimate guest could be refused a voucher that was never used.
//
// A second implementation of the same rule is a second thing that can
// drift. One helper, called from every cancellation site, is the fix.
//
// THE SHAPE
// ---------
// The release is a decrement of `usageCount`, floored at 0 (a
// double-release must never drive the count negative), with an
// `updatedAt` stamp.
//
// The COUNT is a caller-supplied number, because the count of uses to
// release differs by path: the guest cancel releases one use per
// cancelled CHILD (a reservation can span N rooms and consume N uses
// of the same code), while a hold expiry retires exactly ONE booking
// and therefore releases exactly one use.
//
// Firestore requires every read to precede every write in a
// transaction. The callers therefore use the two-phase shape:
//
//   const release = await readVoucherRelease(transaction, { code, count, now });
//   // ... every other read ...
//   applyVoucherRelease(transaction, release);
//
// `readVoucherRelease` does the READS and returns the writes to apply.
// `applyVoucherRelease` does the WRITES. A caller that skips the
// read phase gets no writes, so a missed release is a no-op rather
// than a crash.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";

export interface VoucherReleaseRequest {
  /** The voucher code, upper-cased. Empty / falsy means "nothing to release". */
  code: string;
  /** How many uses to release. */
  count: number;
  /** The timestamp stamped on the released document. */
  now: Date;
}

export interface VoucherRelease {
  /** The document references to update, with the decremented usageCount. */
  writes: Array<{ ref: any; data: { usageCount: number; updatedAt: Date } }>;
}

function normalizeCode(code: string): string {
  return String(code || "").trim().toUpperCase();
}

/**
 * READ phase. Reads each voucher's current `usageCount` and computes
 * the decremented value.
 *
 * Returns the writes to apply in the write phase. An unknown code, a
 * document that does not exist, or a count of zero yields NO writes —
 * the release is a no-op rather than an error, so a caller can pass a
 * booking that never had a voucher.
 *
 * When two requests name the same code, their counts are SUMMED: two
 * bookings that used the same voucher release two uses of it, not one.
 */
export async function readVoucherReleases(
  transaction: Transaction,
  requests: VoucherReleaseRequest[]
): Promise<VoucherRelease> {
  const writes: VoucherRelease["writes"] = [];

  // Sum the counts per code, so two retirements of the same code
  // release the right number of uses.
  const byCode = new Map<string, { count: number; now: Date }>();
  for (const request of requests) {
    const code = normalizeCode(request.code);
    const count = Number(request.count);
    if (!code || !Number.isFinite(count) || count <= 0) continue;
    const existing = byCode.get(code);
    if (existing) {
      existing.count += count;
    } else {
      byCode.set(code, { count, now: request.now });
    }
  }

  for (const [code, { count, now }] of byCode.entries()) {
    const voucherRef = adminDb.collection("vouchers").doc(code);
    const voucherDoc = await transaction.get(voucherRef);
    if (!voucherDoc.exists) continue;
    const data = voucherDoc.data() || {};
    writes.push({
      ref: voucherRef,
      data: {
        // The floor is the point of the whole release: a count that is
        // already 0 must not go negative.
        usageCount: Math.max((Number(data.usageCount) || 0) - count, 0),
        updatedAt: now
      }
    });
  }

  return { writes };
}

/**
 * WRITE phase. Applies the writes computed by `readVoucherReleases`.
 *
 * Kept separate from the read so a caller can honour Firestore's
 * read-before-write rule: every read in the transaction happens first,
 * then every write.
 */
export function applyVoucherReleases(transaction: Transaction, release: VoucherRelease): void {
  for (const write of release.writes) {
    transaction.update(write.ref, write.data);
  }
}

// ─────────────────────────────────────────────────────────────────────
// The corporate-code twin
//
// A corporate booking consumes a corporate-code use exactly the way it
// consumes a voucher use, so a cancellation releases BOTH. The shape is
// identical — same floor, same stamp, same two-phase read/write split —
// and it lives here so the two cannot drift apart.
// ─────────────────────────────────────────────────────────────────────

export interface CorporateCodeReleaseRequest {
  /** The corporate code. Empty / falsy means "nothing to release". */
  code: string;
  /** How many uses to release. */
  count: number;
  /** The timestamp stamped on the released document. */
  now: Date;
}

export interface CorporateCodeRelease {
  /** The document references to update, with the decremented usageCount. */
  writes: Array<{ ref: any; data: { usageCount: number; updatedAt: Date } }>;
}

/**
 * READ phase for the corporate-code release. The twin of
 * `readVoucherReleases` — same rules, same floor, same summing of
 * repeated codes.
 */
export async function readCorporateCodeReleases(
  transaction: Transaction,
  requests: CorporateCodeReleaseRequest[]
): Promise<CorporateCodeRelease> {
  const writes: CorporateCodeRelease["writes"] = [];

  const byCode = new Map<string, { count: number; now: Date }>();
  for (const request of requests) {
    const code = normalizeCode(request.code);
    const count = Number(request.count);
    if (!code || !Number.isFinite(count) || count <= 0) continue;
    const existing = byCode.get(code);
    if (existing) {
      existing.count += count;
    } else {
      byCode.set(code, { count, now: request.now });
    }
  }

  for (const [code, { count, now }] of byCode.entries()) {
    const ref = adminDb.collection("corporateCodes").doc(code);
    const doc = await transaction.get(ref);
    if (!doc.exists) continue;
    const data = doc.data() || {};
    writes.push({
      ref,
      data: {
        usageCount: Math.max((Number(data.usageCount) || 0) - count, 0),
        updatedAt: now
      }
    });
  }

  return { writes };
}

/** WRITE phase for the corporate-code release. */
export function applyCorporateCodeReleases(
  transaction: Transaction,
  release: CorporateCodeRelease
): void {
  for (const write of release.writes) {
    transaction.update(write.ref, write.data);
  }
}
