/**
 * Per B-10 / B-10c / decision #223 (2026-08-19): both the
 * payment-proof upload and the Senior/PWD discount-ID upload in
 * `/book` call `uploadBytes(...)` on Firebase Storage directly
 * (`guest-app/src/pages/BookingPage.tsx:1345` + `:1313`). Firebase
 * Storage direct uploads have no built-in timeout — on a
 * mobile connection with auth-token-in-flight the Promise can
 * stay pending forever. The UI's `finally { setUploading…(false) }`
 * never runs, so the spinner stays up indefinitely and the staff
 * (or the guest themselves for the PWD discount) sees an
 * unresponsive form.
 *
 * The fix wraps the upload in `Promise.race` with a configurable
 * timeout. Surface: 90s for payment proof (large screenshot),
 * 90s for the discount ID (also large, needs to be readable).
 * The race throws a tagged Error ("Upload timed out after Ns")
 * that the caller's `try/catch` already handles — existing
 * error UI at line 1351 / `:1322` displays the unified
 * "Receipt upload failed. Please check your connection and try
 * again." / "ID upload failed..." copy.
 *
 * Why a Promise.race wrapper instead of a SharedWorker-side
 * UploadTask: per Decision #216 (2026-08-19) rule, the upload
 * is a single direct write to Firebase Storage client SDK —
 * Vercel Hobby is at the function cap so we deliberately avoid
 * routing this through a Vercel function. `AbortController` is
 * an alternative, but Firebase Storage v9 SDK does not consume
 * a generic AbortSignal on `uploadBytes` (it only consumes the
 * internal UploadTask controller). Promise.race is the cheapest
 * portable guard until we adopt `uploadBytesResumable` (which
 * has built-in cancellation) — when we do, this helper becomes
 * a thin wrapper around the new SDK.
 */
export async function raceUploadWithTimeout<T>(
  uploadPromise: Promise<T>,
  timeoutMs: number,
  label = "Upload"
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(timeoutMs / 1000)}s. Please check your connection and retry.`
        )
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([uploadPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

// Canonical timeout for direct Firebase Storage uploads on
// slow mobile networks. 90s covers the worst-case 5MB upload
// over a 3G connection (~50KB/s) plus auth handshake + SDK
// round-trips. Anything longer is a hang, not a slow network.
export const DEFAULT_UPLOAD_TIMEOUT_MS = 90_000;
