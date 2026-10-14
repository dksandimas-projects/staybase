// Per BR-08 (decision #238, 2026-10-14 — close-out):
// MAJOR bump to 2.0.0 for the data-model change. The
// legacy `hasBreakfast` / `breakfastRate` /
// `breakfastIncludesChildren` / `extraBedBreakfast`
// fields on `Booking` + the `calculateBreakfastAddOn`
// helper + the `PublicRoomSelection` interface + the
// `DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT` constant
// are all deleted. Per the breaking-change policy
// (`plan/docs/CONTRIBUTING.md §Versioning`), any out-of-tree
// code carrying the old shape must fail at compile-time
// + run-time — the MAJOR bump advertises the cutover to
// consumers (see `shared/__tests__/br-08-closeout.test.ts`
// for the 13-tripwire close-out test).
export const VERSION = "2.0.0";
