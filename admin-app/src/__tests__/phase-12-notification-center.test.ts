import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per Phase 12 — Notification Center (decision #120):
// regression tests for the AdminContext notifications
// listener, the bell + panel components, the firestore rule
// for `notifications`, and the retention cron. Source-pattern
// tests verify the integration points are wired in the same
// place the rest of the codebase lives; behavioral tests
// (notification-center-writes.test.ts in the API suite)
// verify the doc shape on the server.

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const layoutSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/AdminLayout.tsx"),
  "utf8"
);
const bellSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/NotificationBell.tsx"),
  "utf8"
);
const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);
const firestoreRules = readFileSync(
  resolve(__dirname, "../../../firebase/firestore.rules"),
  "utf8"
);
const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);
const vercelJson = JSON.parse(
  readFileSync(resolve(__dirname, "../../../vercel.json"), "utf8")
);
const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/apiRouter.ts"),
  "utf8"
);
const notifLibSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/lib/notifications.ts"),
  "utf8"
);
const storeHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/store.ts"),
  "utf8"
);
const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);

describe("Phase 12 — Notification Center (decision #120)", () => {
  describe("shared Notification type", () => {
    it("is exported from shared/types/index.ts", () => {
      expect(sharedTypesSrc).toMatch(/export type NotificationType/);
      expect(sharedTypesSrc).toMatch(/export type NotificationEntityType/);
      expect(sharedTypesSrc).toMatch(/export interface Notification/);
    });

    it("covers all 6 event types (booking / payment / message / arrival / departure / store-order)", () => {
      expect(sharedTypesSrc).toMatch(/["']booking["']\s*\|\s*["']payment["']\s*\|\s*["']message["']/);
      expect(sharedTypesSrc).toMatch(/["']arrival["']\s*\|\s*["']departure["']\s*\|\s*["']store-order["']/);
    });

    it("uses a Record<string, Date | null> readBy map (per-staff read trail)", () => {
      expect(sharedTypesSrc).toMatch(/readBy:\s*Record<string,\s*Date\s*\|\s*null>/);
    });

    it("never carries guest email or payment data (Hard Rule: no PII in logs)", () => {
      // The shared type must not include `guestEmail`, `paymentMethod`, etc.
      const notifInterfaceBlock = sharedTypesSrc.match(
        /export interface Notification \{[\s\S]*?\n\}/
      );
      expect(notifInterfaceBlock, "expected Notification interface").toBeTruthy();
      expect(notifInterfaceBlock![0]).not.toMatch(/guestEmail/);
      expect(notifInterfaceBlock![0]).not.toMatch(/paymentMethod/);
      expect(notifInterfaceBlock![0]).not.toMatch(/paymentProof/);
    });
  });

  describe("firestore.rules", () => {
    it("declares a `notifications/{notificationId}` match block", () => {
      expect(firestoreRules).toMatch(/match\s+\/notifications\/\{notificationId\}\s*\{/);
    });

    it("restricts create to Admin-SDK only (allow create: if false)", () => {
      const block = firestoreRules.match(
        /match\s+\/notifications\/\{notificationId\}\s*\{[\s\S]*?\}/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/allow create:\s*if\s*false\s*;/);
    });

    it("limits client update to the readBy field only", () => {
      const block = firestoreRules.match(
        /match\s+\/notifications\/\{notificationId\}\s*\{[\s\S]*?\}/
      );
      expect(block![0]).toMatch(/allow update:\s*if\s*isStaff\(\)/);
      expect(block![0]).toMatch(/affectedKeys\(\)\.hasOnly\(\[\s*["']readBy["']\s*\]\)/);
    });

    it("disallows client delete (retention cron uses Admin SDK)", () => {
      const block = firestoreRules.match(
        /match\s+\/notifications\/\{notificationId\}\s*\{[\s\S]*?\}/
      );
      expect(block![0]).toMatch(/allow delete:\s*if\s*false\s*;/);
    });

    it("restricts read to staff (guests must never see the bell log)", () => {
      const block = firestoreRules.match(
        /match\s+\/notifications\/\{notificationId\}\s*\{[\s\S]*?\}/
      );
      expect(block![0]).toMatch(/allow read:\s*if\s*isStaff\(\)/);
    });
  });

  describe("server-side writeNotification helper", () => {
    it("exists at guest-app/server/lib/notifications.ts", () => {
      expect(notifLibSrc).toMatch(/export async function writeNotification/);
    });

    it("truncates the title to 160 chars (defense in depth)", () => {
      expect(notifLibSrc).toMatch(/MAX_TITLE_LENGTH\s*=\s*160/);
    });

    it("exposes a pruneNotifications helper for the retention cron", () => {
      expect(notifLibSrc).toMatch(/export async function pruneNotifications/);
    });

    it("uses a bounded query (limit) so the cron can't OOM on a huge collection", () => {
      expect(notifLibSrc).toMatch(/\.limit\(batchSize\)/);
    });

    it("NC-03: deletes via Firestore BulkWriter (parallel + auto-retry)", () => {
      // The helper must use adminDb.bulkWriter() instead of
      // a serial `for await ... delete` loop. The source
      // wraps the delete call across lines, so we allow
      // whitespace.
      expect(notifLibSrc).toMatch(/adminDb\.bulkWriter\(\)/);
      expect(notifLibSrc).toMatch(/writer[\s\S]*?\.delete\(/);
      expect(notifLibSrc).toMatch(/await\s+writer\.close\(\)/);
      // Partial-success: a per-doc failure must be caught
      // and not crash the whole prune.
      expect(notifLibSrc).toMatch(/\.catch\(\(err\) =>[\s\S]*?console\.error/);
    });
  });

  describe("NC-01: server-side write sites use await (post-ship review)", () => {
    // Per NC-01 (post-ship review 2026-07-15): every
    // writeNotification call must be **awaited** so Vercel
    // does not freeze the instance after `res.json()` and
    // drop the doc. The helper swallows its own errors,
    // so awaiting is safe.
    it("handleCreateBooking awaits writeNotification (NC-01)", () => {
      const block = bookingsHandlerSrc.match(
        /handleCreateBooking[\s\S]*?export async function handleCreateWalkin/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/await\s+writeNotification\(/);
      expect(block![0]).not.toMatch(/void\s+writeNotification/);
    });

    it("handleCreateWalkin awaits writeNotification (NC-01)", () => {
      const block = bookingsHandlerSrc.match(
        /handleCreateWalkin[\s\S]*?export async function handleApplyBookingDiscount/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/await\s+writeNotification\(/);
      expect(block![0]).not.toMatch(/void\s+writeNotification/);
    });

    it("handleAddPayment awaits writeNotification (NC-01)", () => {
      const block = bookingsHandlerSrc.match(
        /handleAddPayment[\s\S]*?export async function handleAddRefund/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/await\s+writeNotification\(/);
      expect(block![0]).not.toMatch(/void\s+writeNotification/);
    });

    it("handleConfirmBooking awaits writeNotification (NC-01)", () => {
      const block = bookingsHandlerSrc.match(
        /handleConfirmBooking[\s\S]*?export async function handleCheckinBooking/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/await\s+writeNotification\(/);
      expect(block![0]).not.toMatch(/void\s+writeNotification/);
    });

    it("handleCheckinBooking awaits writeNotification (NC-01)", () => {
      const block = bookingsHandlerSrc.match(
        /handleCheckinBooking[\s\S]*?export async function handleCheckoutBooking/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/await\s+writeNotification\(/);
      expect(block![0]).not.toMatch(/void\s+writeNotification/);
    });

    it("handleCheckoutBooking awaits writeNotification BEFORE res.json (NC-01)", () => {
      // The original code had the void writeNotification
      // sitting AFTER the res.status(200).json(...) call.
      // The fix moves the block above res.json so the
      // instance can't be frozen before the write runs.
      const block = bookingsHandlerSrc.match(
        /handleCheckoutBooking[\s\S]*?export async function handleLookupBooking/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/await\s+writeNotification\(/);
      expect(block![0]).not.toMatch(/void\s+writeNotification/);
      // The write must come BEFORE the res.json call.
      const writeIdx = block![0].search(/await\s+writeNotification\(/);
      const resIdx = block![0].search(/res\.status\(200\)\.json\(/);
      expect(writeIdx).toBeGreaterThan(-1);
      expect(resIdx).toBeGreaterThan(-1);
      expect(writeIdx).toBeLessThan(resIdx);
    });

    it("handleCreateStoreOrder awaits writeNotification (NC-01)", () => {
      const block = storeHandlerSrc.match(
        /handleCreateStoreOrder[\s\S]*?export async function handleCancelStoreOrder/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/await\s+writeNotification\(/);
      expect(block![0]).not.toMatch(/void\s+writeNotification/);
    });
  });

  describe("NC-02: firestore rules tighten the readBy update scope (post-ship review)", () => {
    // Per NC-02: the original rule let any staff member
    // rewrite the entire readBy map (clear/forge another
    // staff member's read state). The fix asserts the
    // request's readBy keys are a subset of (existing keys
    // ∪ {writer's UID}) — the writer can only add or
    // update their own UID.
    it("requires the request's readBy keys to be a subset of (existing ∪ writer)", () => {
      const block = firestoreRules.match(
        /match\s+\/notifications\/\{notificationId\}\s*\{[\s\S]*?\}/
      );
      expect(block).toBeTruthy();
      // Has the keys-hasOnly check that asserts the subset
      // relationship: request.readBy.keys ⊆
      // resource.readBy.keys ∪ {request.auth.uid}. The rule
      // is multi-line; match the two halves independently.
      expect(block![0]).toMatch(/readBy\.keys\(\)\.hasOnly\(/);
      expect(block![0]).toMatch(/resource\.data\.readBy\.keys\(\)\.union\(\[request\.auth\.uid\]\)/);
    });

    it("requires the writer's own UID in readBy to be a timestamp", () => {
      const block = firestoreRules.match(
        /match\s+\/notifications\/\{notificationId\}\s*\{[\s\S]*?\}/
      );
      expect(block![0]).toMatch(
        /request\.resource\.data\.readBy\[request\.auth\.uid\]\s+is\s+timestamp/
      );
    });

    it("NC-02b: existing readBy keys must survive (no removal vector)", () => {
      // Per NC-02b (post-ship review 2026-07-15): the NC-02
      // tightening only bounded the *request* key set
      // (subset of existing ∪ writer). A staff member
      // could still submit `readBy = {me: ts}` and wipe
      // every other staff member's read entry. The fix
      // adds the inverse: every existing key must also
      // appear in the request, so the key set can only
      // *grow by the writer's own UID* (or stay the same).
      const block = firestoreRules.match(
        /match\s+\/notifications\/\{notificationId\}\s*\{[\s\S]*?\}/
      );
      expect(block).toBeTruthy();
      // Match the two halves independently — the rule
      // spans multiple lines.
      expect(block![0]).toMatch(/resource\.data\.readBy\.keys\(\)\.hasOnly\(/);
      expect(block![0]).toMatch(/request\.resource\.data\.readBy\.keys\(\)/);
    });
  });

  describe("server-side write sites", () => {
    it("handleCreateBooking writes a booking notification", () => {
      const block = bookingsHandlerSrc.match(
        /handleCreateBooking[\s\S]*?export async function handleCreateWalkin/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/writeNotification\(\s*\{[\s\S]*?type:\s*["']booking["']/);
    });

    it("handleCreateWalkin writes a booking notification", () => {
      const block = bookingsHandlerSrc.match(
        /handleCreateWalkin[\s\S]*?export async function handleApplyBookingDiscount/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/writeNotification\(\s*\{[\s\S]*?type:\s*["']booking["']/);
    });

    it("handleAddPayment writes a payment notification (skipped on idempotent replay)", () => {
      const block = bookingsHandlerSrc.match(
        /handleAddPayment[\s\S]*?export async function handleAddRefund/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/writeNotification\(\s*\{[\s\S]*?type:\s*["']payment["']/);
      expect(block![0]).toMatch(/!idempotentReplay/);
    });

    it("handleConfirmBooking writes a booking notification for the confirm transition", () => {
      const block = bookingsHandlerSrc.match(
        /handleConfirmBooking[\s\S]*?export async function handleCheckinBooking/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/writeNotification\(\s*\{[\s\S]*?type:\s*["']booking["']/);
    });

    it("handleCheckinBooking writes an arrival notification", () => {
      const block = bookingsHandlerSrc.match(
        /handleCheckinBooking[\s\S]*?export async function handleCheckoutBooking/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/writeNotification\(\s*\{[\s\S]*?type:\s*["']arrival["']/);
    });

    it("handleCheckoutBooking writes a departure notification", () => {
      const block = bookingsHandlerSrc.match(
        /handleCheckoutBooking[\s\S]*?export async function handleLookupBooking/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/writeNotification\(\s*\{[\s\S]*?type:\s*["']departure["']/);
    });

    it("handleCreateStoreOrder writes a store-order notification", () => {
      const block = storeHandlerSrc.match(
        /handleCreateStoreOrder[\s\S]*?export async function handleCancelStoreOrder/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/writeNotification\(\s*\{[\s\S]*?type:\s*["']store-order["']/);
    });
  });

  describe("retention cron", () => {
    it("adds a new notifications/prune cron to vercel.json", () => {
      const cronEntries = (vercelJson.crons || []) as Array<{ path: string; schedule: string }>;
      const entry = cronEntries.find((c) => c.path === "/api/notifications/prune");
      expect(entry, "expected /api/notifications/prune in vercel.json crons").toBeTruthy();
      // Daily — schedule is a string (5-field cron expression)
      expect(typeof entry!.schedule).toBe("string");
    });

    it("dispatches /api/notifications/prune in apiRouter.ts", () => {
      expect(apiRouterSrc).toMatch(/domain === ["']notifications["']\s*&&\s*action === ["']prune["']/);
    });

    it("the prune handler is CRON_SECRET-gated", () => {
      const notifHandlerSrc = readFileSync(
        resolve(__dirname, "../../../guest-app/server/handlers/notifications-prune.ts"),
        "utf8"
      );
      expect(notifHandlerSrc).toMatch(/isAuthorizedCronRequest/);
      expect(notifHandlerSrc).toMatch(/CRON_SECRET/);
    });
  });

  describe("AdminContext — notifications listener", () => {
    it("imports the Notification type + NotificationType from @spark-inn/shared", () => {
      expect(adminContextSrc).toMatch(/import\s*\{[^}]*Notification\s*,\s*type NotificationType[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
    });

    it("subscribes to onSnapshot on the notifications collection with a bounded query", () => {
      // Expect: collection(db, "notifications") + orderBy("createdAt", "desc") + limit(50)
      const notifBlock = adminContextSrc.match(
        /const notifRef = collection\(db, ["']notifications["']\);[\s\S]*?\}, \[currentUser\]\);/
      );
      expect(notifBlock, "expected notifications onSnapshot useEffect").toBeTruthy();
      expect(notifBlock![0]).toMatch(/orderBy\(["']createdAt["'],\s*["']desc["']\)/);
      expect(notifBlock![0]).toMatch(/limit\(50\)/);
    });

    it("guards the listener on currentUser (Firestore rules require auth)", () => {
      const notifBlock = adminContextSrc.match(
        /if \(!currentUser\)[\s\S]*?setNotifications\(\[\]\);[\s\S]*?return;/
      );
      expect(notifBlock, "expected currentUser guard in notifications listener").toBeTruthy();
    });

    it("unsubscribes in the useEffect cleanup (Hard Rule)", () => {
      const notifBlock = adminContextSrc.match(
        /const notifRef = collection\(db, ["']notifications["']\);[\s\S]*?\}, \[currentUser\]\);/
      );
      expect(notifBlock![0]).toMatch(/return\s+unsubscribe\s*;/);
    });

    it("exposes notifications + notificationsLoading + unreadNotificationCount on the context", () => {
      expect(adminContextSrc).toMatch(/notifications:\s*Notification\[\]/);
      expect(adminContextSrc).toMatch(/notificationsLoading:\s*boolean/);
      expect(adminContextSrc).toMatch(/unreadNotificationCount:\s*number/);
      expect(adminContextSrc).toMatch(/markNotificationRead:/);
      expect(adminContextSrc).toMatch(/markAllNotificationsRead:/);
    });

    it("computes the per-staff unread count by checking readBy[currentUser.uid]", () => {
      const memo = adminContextSrc.match(
        /const unreadNotificationCount = useMemo\(\(\) =>[\s\S]*?\}, \[notifications, currentUser\]\);/
      );
      expect(memo).toBeTruthy();
      expect(memo![0]).toMatch(/readBy\[myUid\]/);
    });

    it("markNotificationRead writes the uid into readBy via updateDoc (rule-safe)", () => {
      const fn = adminContextSrc.match(
        /const markNotificationRead = useCallback\(async \(notificationId: string\) =>[\s\S]*?\}, \[currentUser\]\);/
      );
      expect(fn).toBeTruthy();
      expect(fn![0]).toMatch(/updateDoc\(\s*doc\(db, ["']notifications["'], notificationId\)/);
      expect(fn![0]).toMatch(/readBy\.\$\{currentUser\.uid\}/);
      expect(fn![0]).toMatch(/serverTimestamp\(\)/);
    });

    it("markAllNotificationsRead stamps the uid into every currently-loaded unread doc", () => {
      const fn = adminContextSrc.match(
        /const markAllNotificationsRead = useCallback\(async \(\) =>[\s\S]*?\}, \[notifications, currentUser\]\);/
      );
      expect(fn).toBeTruthy();
      expect(fn![0]).toMatch(/Promise\.all/);
      expect(fn![0]).toMatch(/readBy\.\$\{myUid\}/);
    });

    it("the provider return value exposes the new context fields", () => {
      expect(adminContextSrc).toMatch(/notifications,\s*\n\s*notificationsLoading,\s*\n\s*unreadNotificationCount,\s*\n\s*markNotificationRead,\s*\n\s*markAllNotificationsRead/);
    });
  });

  describe("NotificationBell component", () => {
    it("imports the Bell icon from lucide-react", () => {
      expect(bellSrc).toMatch(/\bBell\b\s*,/);
    });

    it("renders an unread-count badge when there are unread notifications", () => {
      // The badge uses the primary color and the 99+ overflow cap.
      // The 99+ guard and the primary-color class are both in the
      // bell component; the regex stops at the first aria-hidden
      // attribute, so we assert on the full source instead.
      expect(bellSrc).toMatch(/unreadNotificationCount\s*>\s*0\s*&&/);
      expect(bellSrc).toMatch(/unreadNotificationCount\s*>\s*99\s*\?\s*["']99\+["']\s*:\s*unreadNotificationCount/);
      expect(bellSrc).toMatch(/bg-primary/);
    });

    it("renders a desktop dropdown panel + a mobile Drawer", () => {
      expect(bellSrc).toMatch(/<Drawer/);
      expect(bellSrc).toMatch(/role=["']dialog["']/);
      expect(bellSrc).toMatch(/useBreakpoint/);
      expect(bellSrc).toMatch(/isMobile/);
    });

    it("renders a 'Mark all as read' button", () => {
      expect(bellSrc).toMatch(/Mark all as read/);
    });

    it("shows the empty state when there are zero notifications", () => {
      expect(bellSrc).toMatch(/You're all caught up/);
    });

    it("uses skeleton rows during the first load (no spinner)", () => {
      expect(bellSrc).toMatch(/animate-pulse/);
    });
  });

  describe("AdminLayout integration", () => {
    it("imports and renders the NotificationBell in the header", () => {
      expect(layoutSrc).toMatch(/import\s*\{\s*NotificationBell\s*\}\s*from\s*["']\.\/NotificationBell["']/);
      expect(layoutSrc).toMatch(/<NotificationBell\s*\/>/);
    });

    it("keeps the sound mute button alongside the bell (Decision #97)", () => {
      expect(layoutSrc).toMatch(/setSoundsEnabled\(!soundsEnabled\)/);
      expect(layoutSrc).toMatch(/Volume2/);
      expect(layoutSrc).toMatch(/VolumeX/);
    });
  });

  describe("Deep links", () => {
    it("booking deep link routes to /bookings?bookingId=", () => {
      const fn = bellSrc.match(/function resolveDeepLink[\s\S]*?^\}/m);
      expect(fn).toBeTruthy();
      expect(fn![0]).toMatch(/case\s*["']booking["']/);
      expect(fn![0]).toMatch(/\/bookings\?bookingId=/);
    });

    it("store-order deep link routes to /bookings?tab=store&orderId= (Store tab is inside Bookings)", () => {
      const fn = bellSrc.match(/function resolveDeepLink[\s\S]*?^\}/m);
      expect(fn![0]).toMatch(/case\s*["']storeOrder["']/);
      expect(fn![0]).toMatch(/\/bookings\?tab=store&orderId=/);
    });

    it("intercom deep link routes to /intercom?room=", () => {
      const fn = bellSrc.match(/function resolveDeepLink[\s\S]*?^\}/m);
      expect(fn![0]).toMatch(/case\s*["']intercom["']/);
      expect(fn![0]).toMatch(/\/intercom\?room=/);
    });

    it("BookingsPage reads ?orderId= and opens the matching order drawer", () => {
      // The new useEffect that handles ?orderId= should:
      //  - switch to the store tab
      //  - find the matching order by id
      //  - open the order drawer
      expect(bookingsPageSrc).toMatch(/searchParams\.get\(["']orderId["']\)/);
      expect(bookingsPageSrc).toMatch(/storeOrders\.find\(\(order\) => order\.id === orderId\)/);
    });
  });
});
