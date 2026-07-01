// Per BF-50 (booking-flow audit 2026-06-26): the booking
// form pre-allocates a Firestore doc id client-side
// (`doc(collection(db, "bookings")).id`) and uploads images
// to `bookings/{id}/discount-id/...` and
// `bookings/{id}/payment-proof/...` as the user fills the
// form. If the user navigates away without submitting,
// the doc never gets created but the Storage subfolders
// live forever.
//
// This module exposes a pure function
// `sweepBookingsStorage` that walks the `bookings/` prefix
// in Firebase Storage, asks Firestore whether each
// `{id}/` subfolder has a matching doc, and deletes the
// subfolder if not. The HTTP wrapper
// (`server/handlers/janitor.ts`) auth-gates it with the
// `CRON_SECRET` header and is invoked by a Vercel Cron job
// declared in `vercel.json`.

/**
 * Minimal subset of the @google-cloud/storage Bucket
 * interface that the sweeper relies on. Exists so the
 * sweep can be unit-tested with a hand-rolled mock
 * without depending on the Admin SDK at test time.
 */
export interface SweepBucket {
  getFiles(query: {
    prefix?: string;
    delimiter?: string;
    autoPaginate?: boolean;
    maxResults?: number;
    pageToken?: string;
  }): Promise<[Array<{ name: string }>, (string | undefined | null)?, ...any[]]>;
  deleteFiles(query: { prefix: string; force?: boolean }): Promise<void>;
}

/**
 * Minimal subset of firebase-admin/firestore that the
 * sweeper relies on — `collection(doc(id)).get()`.
 */
export interface SweepFirestore {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean }>;
    };
  };
}

export interface SweepResult {
  scanned: number;
  deleted: number;
  kept: number;
  errors: Array<{ id: string; error: string }>;
  nextPageToken: string | null;
  dryRun: boolean;
  durationMs: number;
}

export interface SweepOptions {
  /** Storage bucket handle. */
  bucket: SweepBucket;
  /** Firestore handle. */
  db: SweepFirestore;
  /** Top-level prefix to scan (default `"bookings/"`). */
  prefix?: string;
  /** Cap the work per invocation (Vercel cron 10s budget). */
  maxItems?: number;
  /** If true, report what would be deleted without actually deleting. */
  dryRun?: boolean;
  /** Continuation token from a previous run. */
  pageToken?: string;
  /** Override for tests. */
  now?: () => number;
}

const DEFAULT_PREFIX = "bookings/";
const DEFAULT_MAX_ITEMS = 500;

/**
 * One sweep pass. Returns counts + a continuation token if
 * the prefix has more subfolders than `maxItems`.
 */
export async function sweepBookingsStorage(
  options: SweepOptions
): Promise<SweepResult> {
  const {
    bucket,
    db,
    prefix = DEFAULT_PREFIX,
    maxItems = DEFAULT_MAX_ITEMS,
    dryRun = false,
    pageToken,
    now = Date.now
  } = options;

  const startedAt = now();
  const errors: Array<{ id: string; error: string }> = [];

  const [files, nextPageToken] = await bucket.getFiles({
    prefix,
    delimiter: "/",
    autoPaginate: false,
    maxResults: maxItems,
    pageToken
  });

  // When `delimiter: "/"` is set, @google-cloud/storage
  // returns the subfolders as "files" whose `name` ends in
  // `/` (e.g. `bookings/abc123/`). We strip the prefix +
  // trailing slash to get the bare id.
  const subfolderIds = files
    .map((f) => f.name)
    .filter((name) => name.startsWith(prefix) && name.endsWith("/"))
    .map((name) => name.slice(prefix.length, -1))
    .filter((id) => id.length > 0);

  let deleted = 0;
  let kept = 0;

  for (const id of subfolderIds) {
    try {
      const snap = await db.collection("bookings").doc(id).get();
      if (snap.exists) {
        kept += 1;
        continue;
      }
      if (!dryRun) {
        await bucket.deleteFiles({ prefix: `${prefix}${id}/`, force: true });
      }
      deleted += 1;
    } catch (err) {
      errors.push({
        id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    scanned: subfolderIds.length,
    deleted,
    kept,
    errors,
    nextPageToken: nextPageToken ?? null,
    dryRun,
    durationMs: now() - startedAt
  };
}

// Per H5 (hardening batch 2026-06-26): a small ring buffer
// of the last 50 sweep results in module memory so the
// `GET /api/janitor/stats` endpoint can surface them for
// ops dashboards without needing an external metrics store.
// In serverless deployments the buffer lives only for the
// lifetime of the warm instance, which is fine for "did
// the cron actually run?" debugging.

const MAX_HISTORY = 50;
const sweepHistory: Array<SweepResult & { at: number }> = [];

export function recordSweepResult(result: SweepResult): void {
  sweepHistory.unshift({ ...result, at: Date.now() });
  if (sweepHistory.length > MAX_HISTORY) {
    sweepHistory.length = MAX_HISTORY;
  }
}

export function getSweepHistory(): ReadonlyArray<SweepResult & { at: number }> {
  return sweepHistory;
}

export function clearSweepHistory(): void {
  sweepHistory.length = 0;
}

// Per S1 (soft batch 2026-06-26): a reusable cursor store
// for batched backfill jobs. The H2 lookup-token backfill
// is the first consumer; future one-time migrations can
// share the same shape. The cursor is just the last
// document id seen — `startAfter(lastId)` resumes from
// there on the next invocation.

export interface BackfillOptions {
  /**
   * The Firestore collection to scan.
   * Mirrored as a parameter so the unit tests can drive
   * it with a hand-rolled mock.
   */
  collection: {
    /** Returns up to `limit` docs whose id is strictly greater than `afterId`, ordered by id. */
    query(afterId: string | null, limit: number): Promise<Array<{ id: string; data: any }>>;
    /** Patches a single doc with a partial update. */
    update(id: string, patch: Record<string, any>): Promise<void>;
  };
  /** Predicate that decides whether a doc needs the patch. */
  needsUpdate: (doc: { id: string; data: any }) => boolean;
  /** Returns the patch to apply to a given doc id. */
  buildPatch: (doc: { id: string; data: any }) => Record<string, any>;
  /** Max docs to touch per invocation. */
  batchSize?: number;
  /** Optional callback invoked once per updated doc (for the result counter). */
  onUpdate?: (id: string) => void;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  nextCursor: string | null;
  exhausted: boolean;
  durationMs: number;
}

export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const {
    collection,
    needsUpdate,
    buildPatch,
    batchSize = 500,
    onUpdate
  } = options;
  const startedAt = Date.now();
  // We sort by id ascending and paginate by id strictly
  // greater than the last seen. The first call passes
  // `afterId = null`; subsequent calls use the cursor
  // returned by the previous run.
  const afterId: string | null = null;
  const docs = await collection.query(afterId, batchSize);
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  for (const doc of docs) {
    scanned += 1;
    if (!needsUpdate(doc)) {
      skipped += 1;
      continue;
    }
    const patch = buildPatch(doc);
    await collection.update(doc.id, patch);
    updated += 1;
    if (onUpdate) onUpdate(doc.id);
  }
  const exhausted = docs.length < batchSize;
  return {
    scanned,
    updated,
    skipped,
    nextCursor: exhausted ? null : (docs[docs.length - 1]?.id ?? null),
    exhausted,
    durationMs: Date.now() - startedAt
  };
}
