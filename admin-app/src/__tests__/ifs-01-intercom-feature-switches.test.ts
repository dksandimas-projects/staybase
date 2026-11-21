// Per IFS-01 (2026-11-20, decision #318) — the hotel-wide in-room
// feature switches for the intercom, on the two admin surfaces.
//
// THE FEATURE
// -----------
// The hotel asked to be able to switch off the in-room intercom CHAT
// and the intercom VOICE CALL for a while (the Spark Essentials store
// already had a master switch).
//
// THREE SURFACES, THREE CONTRACTS
// --------------------------------
//   1. THE GUEST PANEL (`guest-app/src/pages/IntercomPage.tsx`)
//      - the "Call Desk" button disappears when the voice call is off
//      - the chat tab becomes a phone-only fallback card when the chat
//        is off
//      - the call handler refuses to start even on a stale render
//
//   2. THE DESK (`admin-app/src/context/AdminContext.tsx` +
//      `admin-app/src/pages/IntercomInboxPage.tsx`)
//      - incoming calls do NOT ring the desk while the voice call is
//        off, and an in-flight call is dropped the moment the switch
//        flips
//      - the inbox shows a "Calls Off" chip so staff can explain to a
//        guest why the button is missing
//
//   3. THE SETTINGS TAB (`admin-app/src/pages/SettingsPage.tsx`)
//      - both switches are editable and are SAVED with the rest of the
//        Intercom settings
//
// These are source-text tripwires (per `plan/docs/CONTRIBUTING.md
// §Testing`) — cheap, deterministic, and the only thing standing
// between a refactor and a silently re-enabled feature.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const GUEST_PAGE = resolve(ROOT, "guest-app/src/pages/IntercomPage.tsx");
const ADMIN_CONTEXT = resolve(ROOT, "admin-app/src/context/AdminContext.tsx");
const INBOX_PAGE = resolve(ROOT, "admin-app/src/pages/IntercomInboxPage.tsx");
const SETTINGS_PAGE = resolve(ROOT, "admin-app/src/pages/SettingsPage.tsx");

const guestSrc = readFileSync(GUEST_PAGE, "utf8");
const adminContextSrc = readFileSync(ADMIN_CONTEXT, "utf8");
const inboxSrc = readFileSync(INBOX_PAGE, "utf8");
const settingsSrc = readFileSync(SETTINGS_PAGE, "utf8");

describe("IFS-01 — the guest panel honours both switches", () => {
  it("reads both switches from the public hotel-config projection", () => {
    expect(guestSrc).toMatch(
      /setIntercomChatEnabled\(publicConfig\?\.intercomChatEnabled !== false\)/
    );
    expect(guestSrc).toMatch(
      /setIntercomCallsEnabled\(publicConfig\?\.intercomCallsEnabled !== false\)/
    );
  });

  it("hides the \"Call Desk\" button when the voice call is off", () => {
    // The button must be GONE, not merely disabled — a dead control
    // in the header is worse than no control.
    expect(guestSrc).toMatch(/\{intercomCallsEnabled && \(\s*<button/);
    expect(guestSrc).toMatch(/Call Desk/);
  });

  it("the call handler refuses to start when the voice call is off", () => {
    // Belt-and-braces for a screen that was open before the switch
    // flipped.
    const fnStart = guestSrc.indexOf("const handleStartCall");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = guestSrc.slice(fnStart, fnStart + 2000);
    expect(fnBody).toMatch(/if\s*\(\s*!intercomCallsEnabled\s*\)/);
  });

  it("renders the phone-only fallback card when the chat is off", () => {
    expect(guestSrc).toMatch(/inRoomChatTabSurface === "chat" \? \(/);
    expect(guestSrc).toMatch(/IntercomUnavailableCard/);
  });

  it("the fallback card offers a tap-to-call link (never a dead end)", () => {
    const cardStart = guestSrc.indexOf("function IntercomUnavailableCard");
    expect(cardStart).toBeGreaterThan(-1);
    const cardBody = guestSrc.slice(cardStart, cardStart + 3000);
    expect(cardBody).toMatch(/href=\{`tel:\$\{phone\}`\}/);
    expect(cardBody).toMatch(/Call Front Desk/);
  });

  it("falls back to the whole-panel card only when EVERY in-room feature is off", () => {
    // Per IFS-01 follow-up (decision #335, 2026-11-21): the whole-panel
    // card has NO header, so it takes the "Call Desk" button with it.
    // It must therefore only appear when the voice call is off too —
    // otherwise the guest loses a channel the hotel left open.
    //
    // The RULE lives in `shared/utils/intercomFeatures.ts`; this pins
    // that the panel is wired to the shared resolver (not to a second,
    // hand-rolled copy of the same condition).
    expect(guestSrc).toMatch(
      /everyInRoomFeatureIsOff = everyInRoomFeatureIsOffResolver\(\s*\n?\s*intercomChatEnabled,\s*\n?\s*intercomCallsEnabled,\s*\n?\s*isStoreEnabled\s*\n?\s*\)/
    );
    expect(guestSrc).toMatch(/if \(!isValidRoom \|\| everyInRoomFeatureIsOff\)/);
  });
});

describe("IFS-01 follow-up — the guest panel honours the switch MATRIX (decision #335)", () => {
  it("chat OFF + call ON → the in-room CALL is the card's primary action", () => {
    // The guest's next step is the call, not the phone number. The
    // card's primary button is the SAME handler as the header button.
    expect(guestSrc).toMatch(
      /onCallDesk=\{inRoomChatTabSurface === "call" \? handleStartCall : undefined\}/
    );
    // The card's message points at the call, not at the phone.
    expect(guestSrc).toMatch(
      /Use Call Desk to reach the front desk by voice/
    );
  });

  it("the panel resolves the surface through the SHARED resolver", () => {
    // One definition, shared: the panel and any future surface cannot
    // drift apart on what the guest is offered.
    expect(guestSrc).toMatch(
      /resolveInRoomChatTabSurface\(\s*\n?\s*intercomChatEnabled,\s*\n?\s*intercomCallsEnabled\s*\n?\s*\)/
    );
  });

  it("the in-app Call Desk button only renders when a call handler is passed", () => {
    const cardStart = guestSrc.indexOf("function IntercomUnavailableCard");
    expect(cardStart).toBeGreaterThan(-1);
    const cardBody = guestSrc.slice(cardStart, cardStart + 3000);
    expect(cardBody).toMatch(/\{onCallDesk && \(/);
    expect(cardBody).toMatch(/onClick=\{onCallDesk\}/);
    expect(cardBody).toMatch(/Call Desk/);
  });

  it("chat OFF + call OFF → the card is phone-only (no in-app call)", () => {
    // Both switches off: there is no in-room channel left, so the phone
    // number is the action. The phone link ALWAYS renders — the guest
    // never lands on a dead panel.
    expect(guestSrc).toMatch(
      /onCallDesk=\{inRoomChatTabSurface === "call" \? handleStartCall : undefined\}/
    );
    const cardStart = guestSrc.indexOf("function IntercomUnavailableCard");
    const cardBody = guestSrc.slice(cardStart, cardStart + 3000);
    expect(cardBody).toMatch(/href=\{`tel:\$\{phone\}`\}/);
    expect(cardBody).toMatch(/Call Front Desk/);
  });

  it("chat ON + call OFF → the header carries NO call button", () => {
    // The "Call Desk" button is gated on the call switch alone, so a
    // hotel with the chat on and the call off shows no call control at
    // all — there is no dead control to tap.
    expect(guestSrc).toMatch(/\{intercomCallsEnabled && \(\s*<button/);
  });

  it("the whole-panel copy names the voice call too", () => {
    expect(guestSrc).toMatch(
      /In-room chat, voice calls and the in-room store are switched off/
    );
  });
});

describe("IFS-01 — the desk stops ringing while the voice call is off", () => {
  it("the incoming-call listener reads the switch through a ref (no stale closure)", () => {
    expect(adminContextSrc).toMatch(/intercomCallsEnabledRef/);
    // The gate is applied to the LIST, not to `nextCall`, so the
    // `const nextCall = activeCalls[0] || null` line keeps the literal
    // shape decision #94's supersede tripwire anchors on.
    expect(adminContextSrc).toMatch(
      /intercomCallsEnabledRef\.current\s*\?\s*snapshot\.docs/
    );
    expect(adminContextSrc).toMatch(/const nextCall = activeCalls\[0\] \|\| null;/);
  });

  it("drops an in-flight call when the switch flips off", () => {
    expect(adminContextSrc).toMatch(
      /intercomCallsEnabledRef\.current = enabled;[\s\S]{0,600}setIncomingCall\(null\);/
    );
  });

  it("the drop does NOT write a misleading \"call missed\" system message", () => {
    // The desk did not MISS the call — the feature was switched off.
    // `cleanupAdminCall` dispatches that message; `clearCallRefsOnly`
    // does not. The switch-off path must use the latter.
    const idx = adminContextSrc.indexOf("intercomCallsEnabledRef.current = enabled;");
    expect(idx).toBeGreaterThan(-1);
    const block = adminContextSrc.slice(idx, idx + 600);
    expect(block).toMatch(/clearCallRefsOnly\(\)/);
    expect(block).not.toMatch(/cleanupAdminCall\(\)/);
  });

  it("the inbox shows a \"Calls Off\" chip so staff can explain the missing button", () => {
    expect(inboxSrc).toMatch(/hotelConfig\?\.intercomCallsEnabled === false/);
    expect(inboxSrc).toMatch(/Calls Off/);
  });
});

describe("IFS-01 — the Settings tab owns both switches", () => {
  it("renders a toggle for each switch", () => {
    expect(settingsSrc).toMatch(
      /onClick=\{\(\) => void handleIntercomFeatureSwitchToggle\("chat", !intercomChatEnabled\)\}/
    );
    expect(settingsSrc).toMatch(
      /onClick=\{\(\) => void handleIntercomFeatureSwitchToggle\("calls", !intercomCallsEnabled\)\}/
    );
  });

  it("persists each switch the moment it is clicked — no Save step", () => {
    // Per IFS-01 follow-up (decision #330 follow-up, 2026-11-21): the switches are
    // KILL-SWITCHES. The owner flipped one, saw it move, and the guest
    // panel kept offering "Call Desk" — because the write only happened
    // when "Save Intercom Settings" (at the bottom of the tab) was
    // pressed. A switch that looks live but is not stored is worse than
    // no switch, so the write moved into the click handler.
    expect(settingsSrc).toMatch(/const handleIntercomFeatureSwitchToggle = async \(/);
    expect(settingsSrc).toMatch(/updateSettings\("hotelConfig", \{ \[field\]: next \}\)/);
    // The Save button must NOT carry the switches any more — one write
    // path per switch, so the two can never disagree.
    const fnStart = settingsSrc.indexOf("const handleSaveIntercom");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = settingsSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).not.toMatch(/intercomChatEnabled/);
    expect(fnBody).not.toMatch(/intercomCallsEnabled/);
  });

  it("reverts the switch when the write fails, so the UI never lies", () => {
    const fnStart = settingsSrc.indexOf("const handleIntercomFeatureSwitchToggle");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = settingsSrc.slice(fnStart, fnStart + 1800);
    expect(fnBody).toMatch(/if \(saved\) return;/);
    expect(fnBody).toMatch(/setIntercomChatEnabled\(previous\)/);
    expect(fnBody).toMatch(/setIntercomCallsEnabled\(previous\)/);
    expect(fnBody).toMatch(/setIntercomFeatureSwitchesError\(/);
  });

  it("says the switches apply immediately, so no Save is expected", () => {
    expect(settingsSrc).toMatch(/apply to the whole hotel the moment you flip them/);
  });

  it("hydrates the switches from the settings document with the shared normalisers", () => {
    expect(settingsSrc).toMatch(
      /normalizeIntercomChatEnabled\(hotelConfig\.intercomChatEnabled\)/
    );
    expect(settingsSrc).toMatch(
      /normalizeIntercomCallsEnabled\(hotelConfig\.intercomCallsEnabled\)/
    );
  });

  it("re-syncs the switches from the live snapshot (guarded, so a mid-toggle snapshot cannot clobber)", () => {
    expect(settingsSrc).toMatch(/intercomFeatureSwitchesSyncRef/);
  });

  it("points the operator at the store switch, which lives in its own tab", () => {
    expect(settingsSrc).toMatch(/Spark Essentials Store/);
    expect(settingsSrc).toMatch(/setActiveTab\("store"\)/);
  });
});
