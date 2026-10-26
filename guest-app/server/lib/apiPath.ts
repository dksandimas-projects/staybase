// Per QA §3.8 (2026-10-26): the API's fallback 404 used to interpolate
// `/api/${domain}/${action}`, and `action` is `undefined` for a
// single-segment path — so `/api/version` answered
//
//   "Endpoint /api/version/undefined not found."
//
// The fix is to echo the path the caller actually asked for. This
// helper owns that formatting so it can be tested without booting the
// whole router.

/**
 * Format the endpoint path a caller asked for, for the fallback 404.
 *
 * @param pathSegments the request's path segments AFTER `/api/`, with
 *   empty segments already removed (the router filters them).
 * @returns the path as the caller wrote it, e.g. `/api/version` or
 *   `/api/bookings/breakfast/manage`.
 */
export function formatUnknownEndpoint(pathSegments: string[]): string {
  const clean = pathSegments.filter((segment) => typeof segment === "string" && segment.length > 0);
  return clean.length > 0 ? `/api/${clean.join("/")}` : "/api";
}
