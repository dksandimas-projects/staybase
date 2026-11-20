// ATR-05 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the ONE
// staff-UID → display-name resolver.
//
// WHY THIS FILE EXISTS (finding 9): three of the four working
// attribution surfaces printed a raw 28-character Firebase Auth UID —
// which tells a front-desk user NOTHING. The payments/refunds tables
// already resolved names via a `staffNameMap` built in `ReportsPage`;
// the three other surfaces (incidental charges, member points history,
// the drawer's discount block) did not.
//
// The resolver now lives HERE, in the shared package, so every
// surface — the existing payments/refunds tables AND the three
// retrofitted ones AND the new ATR-05 inline surfaces — resolves a UID
// through the SAME function. A second resolver is how the three
// surfaces drifted in the first place.
//
// WHY IT IS PURE: it takes the staff list as an argument rather than
// reading Firestore itself. The admin app's `AdminContext` already
// subscribes to the `guests` collection where the staff records live
// (the `role in ["front-desk","admin"]` query), so the context owns
// the subscription and this module owns only the mapping.

/**
 * The minimum shape a staff record needs for the resolver.
 *
 * Deliberately structural (not the admin app's `StaffMember` type) so
 * the shared package stays independent of the admin app, and so a
 * caller can pass a partially-populated list without a cast.
 */
export interface StaffNameSource {
  uid: string;
  fullName?: string | null;
  email?: string | null;
}

/**
 * The display name for a staff UID, or `null` when the UID is unknown.
 *
 * A deleted or disabled staff account is NOT in the list, so this
 * returns `null` rather than leaking the raw UID back to the screen.
 * Callers decide what to render in that case (the audit rows keep
 * their own `actorName` snapshot for exactly this reason — decision
 * 5).
 */
export function resolveStaffName(
  staff: readonly StaffNameSource[],
  uid: string | null | undefined
): string | null {
  if (!uid) return null;
  const match = staff.find((member) => member.uid === uid);
  if (!match) return null;
  return match.fullName || match.email || null;
}

/**
 * Build a reusable UID → display-name map.
 *
 * The map form is what the existing `staffNameMap` in `ReportsPage`
 * used, and what the admin surfaces want when they resolve MANY UIDs
 * in one render (the payments table resolves one per row). Building
 * it once per render is O(n) instead of O(n·m).
 *
 * A UID with no matching staff record is NOT in the map — the caller
 * falls back to its own "unknown" rendering rather than printing a
 * raw UID.
 */
export function buildStaffNameMap(
  staff: readonly StaffNameSource[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const member of staff) {
    const name = member.fullName || member.email;
    if (name) map.set(member.uid, name);
  }
  return map;
}

/**
 * Resolve a UID through a map, with an explicit fallback.
 *
 * This is the form the surfaces use: the fallback is what the surface
 * shows when the UID is unknown (a legacy record, or a staff account
 * that has since been deleted). It is a CALLER-SUPPLIED string so the
 * surface stays in control of its own copy.
 */
export function staffNameFor(
  staffNameMap: Map<string, string>,
  uid: string | null | undefined,
  fallback: string
): string {
  if (!uid) return fallback;
  return staffNameMap.get(uid) ?? fallback;
}
