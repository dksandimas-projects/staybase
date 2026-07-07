import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 7 — two more audit fixes:
//
//   W2.9 — per-staff notification sound mute (decision #97)
//   S2.4 — RewardsLandingPage enroll button (was a UI mock, now
//          wired to /api/members/register)
//
// Both are source-pattern tests that prevent the regressions from
// sneaking back in.

const inboxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/IntercomInboxPage.tsx"),
  "utf8"
);
const rewardsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/RewardsLandingPage.tsx"),
  "utf8"
);
const guestAuthSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/context/GuestAuthContext.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 7 — notification mute + real enroll flow", () => {
  describe("W2.9 — per-staff notification sound mute", () => {
    it("imports Bell + BellOff from lucide-react", () => {
      expect(inboxSrc).toMatch(/\bBell\s*,\s*BellOff\b/);
    });

    it("initializes the mute preference from localStorage on mount", () => {
      // The state initializer must read from localStorage. The key
      // is declared as a constant `NOTIFICATION_MUTED_KEY`; the
      // assertion matches either the literal key or the constant
      // reference.
      const useStateBlock = inboxSrc.match(
        /useState<boolean>\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)/
      );
      expect(useStateBlock, "expected useState<boolean> initializer").toBeTruthy();
      expect(useStateBlock![0]).toMatch(/localStorage\.getItem\(/);
      expect(useStateBlock![0]).toMatch(
        /(NOTIFICATION_MUTED_KEY|["']intercom-notification-muted["'])/
      );
      expect(useStateBlock![0]).toMatch(/===\s*["']true["']/);
    });

    it("persists the mute preference to localStorage on change", () => {
      // A useEffect must write the new value to localStorage whenever
      // isNotificationMuted changes. The key is the constant
      // `NOTIFICATION_MUTED_KEY`; the value is the boolean string;
      // the dep array includes `isNotificationMuted`.
      const persistenceEffect = inboxSrc.match(
        /useEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?localStorage\.setItem\(\s*NOTIFICATION_MUTED_KEY\s*,\s*isNotificationMuted\s*\?\s*["']true["']\s*:\s*["']false["']\s*\)[\s\S]*?\}\s*,\s*\[isNotificationMuted\]\s*\)/
      );
      expect(
        persistenceEffect,
        "expected a useEffect that persists isNotificationMuted to localStorage with the correct dep array"
      ).toBeTruthy();
    });

    it("does not play the notification sound when muted", () => {
      // The effect that calls playNotificationSound() must guard on
      // !isNotificationMuted. The block must include all three
      // existing guards (initialized, hasNewUnreadGuestMessage,
      // !isInboxFocused) plus the new mute guard.
      const effectMatch = inboxSrc.match(
        /if\s*\(\s*notificationInitializedRef\.current\s*&&\s*hasNewUnreadGuestMessage\s*&&\s*!isInboxFocused\s*&&\s*!isNotificationMuted\s*\)\s*\{\s*playNotificationSound\(\)\s*;/
      );
      expect(effectMatch, "expected the sound-play guard to include !isNotificationMuted").toBeTruthy();
    });

    it("renders a Bell / BellOff toggle in the inbox header", () => {
      // The button must toggle isNotificationMuted and render the
      // correct icon depending on state.
      const buttonBlock = inboxSrc.match(
        /<button[\s\S]*?setIsNotificationMuted\(\s*\(prev\)\s*=>\s*!prev\s*\)[\s\S]*?<\/button>/
      );
      expect(buttonBlock, "expected the mute toggle button block").toBeTruthy();
      expect(buttonBlock![0]).toMatch(/aria-pressed=\{isNotificationMuted\}/);
      expect(buttonBlock![0]).toMatch(/aria-label=/);
      // The button body must show the right icon for the current state
      expect(buttonBlock![0]).toMatch(
        /\{isNotificationMuted\s*\?\s*<BellOff\s*size=\{14\}\s*\/>\s*:\s*<Bell\s*size=\{14\}\s*\/\>/
      );
    });
  });

  describe("S2.4 — RewardsLandingPage wires enroll to /api/members/register", () => {
    it("uses the real GuestAuthContext (not sessionStorage)", () => {
      // The page must consume useGuestAuth (user + memberProfile + refreshMemberProfile)
      // and must NOT persist a fake `sim_auth_state` to sessionStorage.
      expect(rewardsSrc).toMatch(/useGuestAuth\(\)/);
      expect(rewardsSrc).toMatch(/refreshMemberProfile/);
      expect(rewardsSrc).not.toMatch(/sim_auth_state/);
      expect(rewardsSrc).not.toMatch(/sessionStorage\.getItem\(/);
      expect(rewardsSrc).not.toMatch(/sessionStorage\.setItem\(/);
    });

    it("drops the Wireframe Tester Panel from production markup", () => {
      // The previous bottom-right dev panel must be gone.
      expect(rewardsSrc).not.toMatch(/Wireframe Tester Panel/);
      expect(rewardsSrc).not.toMatch(/SIMULATED AUTH CONTROLLER WIDGET FOR INTERACTIVE TESTING/);
      // The fake state enum + setAuthState sessionStorage setter
      // are also gone.
      expect(rewardsSrc).not.toMatch(/"logged-out"|"logged-in-non-member"|"logged-in-member"/);
    });

    it("calls /api/members/register with a Bearer token on enroll", () => {
      expect(rewardsSrc).toMatch(/registerCurrentMember\(\)/);
      expect(guestAuthSrc).toMatch(
        /fetch\(\s*["']\/api\/members\/register["']/
      );
      expect(guestAuthSrc).toMatch(
        /Authorization:\s*`Bearer\s+\$\{idToken\}`/
      );
      expect(guestAuthSrc).toMatch(/method:\s*["']POST["']/);
    });

    it("no longer uses setTimeout to fake the enroll", () => {
      // The old `setTimeout(() => { setEnrolling(false); setAuthState("logged-in-member") }, 1000)`
      // is gone — the real flow awaits fetch() and then refreshes + navigates.
      expect(rewardsSrc).not.toMatch(/setTimeout\(/);
    });

    it("shows real loading / error states (AlertCircle for failures)", () => {
      expect(rewardsSrc).toMatch(/enrolling/);
      expect(rewardsSrc).toMatch(/enrollError/);
      expect(rewardsSrc).toMatch(/<AlertCircle/);
      expect(rewardsSrc).toMatch(/role="alert"/);
    });

    it("redirects to /account/rewards on successful enroll", () => {
      expect(rewardsSrc).toMatch(/navigate\(\s*["']\/account\/rewards["']/);
    });
  });
});
