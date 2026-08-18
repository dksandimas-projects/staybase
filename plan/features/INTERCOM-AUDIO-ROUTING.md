# Intercom Audio Routing
> App: admin-app
> Phase: Phase 13 — Staff Audio Routing
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md, features/INTERCOM-INBOX.md, features/INTERCOM-GUEST.md

## Overview

Per-staff output-device routing for the intercom. The front desk wears a USB or Bluetooth headset during a shift; without routing, plugging in the headset redirects both the live call and the notification chime through it, which is the opposite of what the operator wants (chime on the desk speaker, voice in the ears). This feature exposes two output-device pickers on a new `/audio` page — one for the call audio, one for notification sounds + call ringtones — so the two surfaces can be split.

The preference persists on the staff profile (`guests/{uid}.audioRouting`) and follows the operator across machines they sign in on. Machines that can't honour the routing (Firefox, iOS Safari) silently fall back to the system default — the page still saves, but the runtime ignores it.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Single primary action is obvious — "Save" is the dominant CTA when changes are pending
- [x] Loading state uses skeleton, not spinner — the device pickers show a quiet loading state on first mount
- [x] Validation is inline (on blur), not on submit — the "Test" button validates per-device without a full save
- [x] Every error state has a plain-language message and a next step — `Couldn't load audio routing: …` red banner, `Couldn't save…` toast
- [x] Back navigation never loses user input — draft state is local until Save
- [x] Confirmation/success state feels celebratory, not just "OK" — `Heard it? Great — that's your call device.` toast after a successful Test

---

## UI Checklist

- [x] **Sidebar entry** — "Audio" between Settings and the bottom of the nav, `Headphones` icon, accessible to both front-desk and admin roles
- [x] **Page header** — `audio routing` (lowercase per the brand), one-sentence subtitle explaining the two-surface split
- [x] **Master toggle** — "Route intercom audio by surface" — defaults off (system default output for both surfaces)
- [x] **Call device card** — `Headphones` icon, `WebRTC` chip, "Call device" label, device `<select>`, "Test" button, "Pick…" native-picker button
- [x] **Notification device card** — `Volume2` icon, `Notifications + ringtones` chip, "Notification device" label, same `<select>` + Test + Pick trio
- [x] **Disabled-state treatment** — when the master toggle is off, the device cards are dimmed to 60% opacity and the pickers are disabled
- [x] **Test button** — plays a 0.5s 440Hz sine through the selected device; success = `Heard it? Great — that's your call device.` toast; failure = amber warning row `Couldn't play through that device. Try a different one.`
- [x] **Device-name unlock ("Pick…")** — two-step: try `navigator.mediaDevices.selectAudioOutput()` (Firefox only in practice — it is NOT shipped in stable Chrome/Edge), then fall back to a `getUserMedia({ audio: true })` microphone grant that is released immediately. The grant is what actually unhides labelled `enumerateDevices()` results; the routing itself is done by `setSinkId`, not by the picker
- [x] **Denied-mic banner** — when the fallback grant is refused, an amber row explains how to re-enable the microphone from the address-bar padlock, so `Pick…` never reads as a dead button
- [x] **Help text** — the iOS / Firefox limitation, plus the "device gone" fallback behaviour, in a single gray info card at the bottom
- [x] **Reset to default** — clears `enabled` + both device IDs, returns to "system default for both surfaces"
- [x] **Unsupported-runtime screen** — when `setSinkId` is missing, the page renders an amber warning card instead of the form
- [x] **Mobile layout** — pickers and buttons stack vertically below 768px, the device cards use the same `rounded-card` border as SettingsPage
- [x] **44×44px touch targets** — every button + the pickers meet the touch-height minimum

---

## Data & Logic Checklist

- [x] **Firestore field** — `guests/{uid}.audioRouting: { enabled: boolean, callOutputDeviceId: string | null, ringtoneOutputDeviceId: string | null, updatedAt: Timestamp }`; sibling `audioRoutingUpdatedAt: Timestamp` audit stamp on every write
- [x] **Owner-writable** — `audioRouting` and `audioRoutingUpdatedAt` are in the self-write allowlist on `guests/{userId}` (per `firebase/firestore.rules` + `plan/docs/SECURITY.md §guests`). A staff member can change their own routing; they cannot change another staff member's, and they cannot self-promote the `role` field
- [x] **Live subscription** — `AdminProvider` opens one `onSnapshot(guests/{currentUser.uid})` for the duration of the session; the Audio Settings page, the IntercomInboxPage notification sound, and the WebRTC remote stream all read from the same live value
- [x] **Two surfaces, one hook** — `useAudioRouting(uid)` returns `{ routing, loading, error, updateRouting, applyToElement, resetToDefault }`. `applyToElement(el, "call" | "ringtone")` is the one entry point for the consumer — it does the right `setSinkId` call and falls back to default + warns when the saved device is gone
- [x] **Feature detection** — `audioOutputApiSupported()` checks for `HTMLMediaElement.prototype.setSinkId` once. The whole feature degrades to a no-op when the API is missing — the page renders an unsupported-browser screen, every `setSinkIdSafe` returns `false`, and the audio surfaces keep their default behaviour

---

## Web Audio Surfaces — what gets routed

| Surface | Audio source | Routed through | Notes |
|---|---|---|---|
| Call audio (WebRTC remote stream) | `<audio>` element created in `AdminContext.acceptCall` | `applyAudioSink(remoteAudio, "call")` | The remote stream is assigned to a hidden `<audio>` element on every call connect; routing is re-applied if the operator changes the call device while a call is active (the next connect reuses the same element) |
| Inbox notification sound | `<audio>` element with `hotelConfig.notificationSoundUrl` | `applyAudioSink(audio, "ringtone")` | Replaces the previous Web Audio API buffer path (`decodeAudioData` + `createBufferSource`) — the buffer path couldn't honour `setSinkId` portably. The new element is created once on mount and re-routed when the routing preference changes |
| Call ringtone (looping trill before answer) | `<audio>` element with a pre-rendered 1.0s WAV blob | `applyAudioSink(audio, "ringtone")` | Replaces the previous Web Audio API oscillator tree with the same cadence (853/960 Hz, 14 Hz LFO warble, 0.4s on / 0.2s off / 0.4s on). The OfflineAudioContext renders the audio once on first use; the resulting Blob URL is reused for every subsequent play. `setSinkId` is applied at element creation and on every routing change |

---

## Browser Support Matrix

The Audio Output Devices API is partial across browsers. Every helper in `admin-app/src/utils/audioOutputDevices.ts` is a safe no-op on unsupported runtimes so the rest of the app keeps working.

> **Corrected 2026-08-19.** The original matrix claimed Chrome/Edge ship `selectAudioOutput()`. They do not — it sits behind `chrome://flags/#enable-experimental-web-platform-features` and only Firefox ships it unflagged. On the browser the front desk actually uses, `Pick…` could never open anything, which is why the page appeared broken. Device names are unlocked by a microphone-permission grant instead.

| Browser | `setSinkId` on `<audio>` | `selectAudioOutput` picker | Behaviour in Spark Inn |
|---|---|---|---|
| Chrome 110+ / Edge 110+ / Opera | ✅ | ❌ (flag-gated) | Full routing. `Pick…` falls back to the microphone-permission unlock to reveal device names. |
| Safari (macOS 14+) | ⚠️ partial | ❌ | Picker lists devices (labelled after a media-permission grant). Routing honours the chosen device. `Pick…` uses the microphone fallback. |
| Safari (iOS) | ❌ | ❌ | OS overrides any web-side routing. Audio always follows the system default output. The Audio Settings page still saves preferences so the operator's intent is recorded; the iOS device ignores them. |
| Firefox | ❌ | ❌ | `setSinkId` is not implemented. The Audio Settings page renders the unsupported-browser screen. The intercom falls back to the existing pre-feature behaviour (system default for everything). |

---

## Edge Cases & States

- [x] **Saved device disappears** (USB headset unplugged, Bluetooth disconnects) — `setSinkIdSafe` catches the `NotFoundError` and returns `false`; `applyToElement` falls back to system default and emits a single `console.warn` with the surface + missing deviceId so the operator can re-pick on the Audio Settings page
- [x] **Operator changes routing while a call is in progress** — the WebRTC remote stream is re-routed on the next `acceptCall`; the active call keeps its current routing for the rest of the session. Same for the notification sound — the existing `<audio>` element is re-routed in a `useEffect` that depends on the live routing value
- [x] **No devices enumerated** (permission not yet granted) — the picker shows a single "System default" row; `Pick…` runs the two-step unlock (native picker, then microphone grant). Until a media permission is held, `enumerateDevices()` returns one anonymised `audiooutput` row with an empty `deviceId` and empty `label`
- [x] **Master toggle flipped off** — both pickers clear (`callOutputDeviceId = null`, `ringtoneOutputDeviceId = null`); the saved `deviceId`s are wiped on save so a future re-enable starts from a clean slate. The `applyAudioSink` no-ops while `enabled` is `false`
- [x] **First user interaction unlocks audio** — autoplay policy still applies; the existing pointerdown / keydown unlock listener in `IntercomInboxPage.tsx` sets `isNotificationAudioUnlocked` so the first chime after page load waits for a click. The same gate guards the call ringtone
- [x] **Operator on a tab with no microphone permission yet** — device names stay hidden until a media permission is granted, so `Pick…` requests one via `getUserMedia({ audio: true })` and stops the track immediately. Staff already grant the same permission when they accept an intercom call (`AdminContext.acceptCall`), and `admin-app/vercel.json` ships `Permissions-Policy: microphone=(self)`, so this adds no new capability to the origin. Routing to the system default works with no permission at all
- [x] **Two staff on the same machine** — the routing is per-staff, so a shift hand-off requires each operator to re-pick their headset. A "last used device per machine" cache is intentionally out of scope; the page is one click away

---

## Manual QA

- [x] Open `/audio` in Chrome with a USB headset + built-in speakers — both devices appear in the pickers
- [x] Pick the headset for "Call device" and the speakers for "Notification device", save, accept a test call from the guest app — call audio plays in the headset, ringtone plays in the speakers
- [x] Unplug the headset during a call — audio falls back to the speakers; console shows a single warning; the Audio Settings page prompts to re-pick
- [x] Open `/audio` in Firefox — unsupported-browser screen renders, no broken UI
- [x] Open `/audio` on iOS Safari (iPhone) — the page still saves preferences; routing is ignored at runtime; the intercom behaves as it did before this feature
- [x] Two staff sign in on the same machine in different browser profiles — each sees their own routing
- [x] "Reset to default" clears the master toggle and both device pickers; subsequent save round-trips correctly

---

## Implementation Notes

- `audioOutputApiSupported` checks for `"setSinkId" in HTMLMediaElement.prototype` — the most portable feature-detect signal across Chrome / Edge / Opera / Safari
- `setSinkIdSafe` swallows `DOMException` (NotFoundError) and returns `false`. The caller decides the fallback behaviour
- The `Audio` surface type is exported from `admin-app/src/hooks/useAudioRouting.ts` and re-typed in `AdminContext` as a `type` import. The shape is intentionally narrow (`"call" | "ringtone"`) so new surfaces can be added with a single string union extension
- The `useAudioRouting` hook keeps a `lastDeviceIdBySurfaceRef` to skip redundant `setSinkId` round-trips when the routing hasn't changed. Calling `setSinkId` on the same `deviceId` is a no-op at the runtime level but a wasted async call
- The pre-rendered call ringtone uses an `OfflineAudioContext` so the same 853/960 Hz envelope as the previous Web Audio API code is byte-equivalent at the listener. The `audioBufferToWav` helper is in `admin-app/src/utils/renderRingtoneWav.ts` and is tested separately for the WAV header shape

---

## References

- Schema: `plan/docs/BACKEND.md §guests/{userId}` + `plan/docs/TYPES.md §Staff`
- Security rules: `firebase/firestore.rules §guests` + `plan/docs/SECURITY.md §guests`
- Intercom call surface: `plan/features/INTERCOM-INBOX.md §Voice Call (WebRTC)` (the routing hooks into the existing `acceptCall` flow)
- Guest intercom: `plan/features/INTERCOM-GUEST.md §Voice Call (WebRTC)` (guest-side call audio routing is a future extension — see [Open Questions](#open-questions))
- Settings page conventions: `plan/features/SETTINGS.md`
- Mobile building blocks: `plan/admin-app/CLAUDE.md §Mobile UX building blocks`

---

## Open Questions

- **Guest-side call audio routing** — the same `setSinkId` pattern works on the guest side (in the `/intercom/:roomId` page's hidden `<audio>` element), but the browser-support matrix makes the value much smaller (most guests are on mobile Safari). Worth a follow-up if guest-side data shows recurring complaints about call audio on the wrong output device.
- **Per-shift device memory** — operators on rotating shifts might prefer "remember my last device on this machine" so they don't have to re-pick the headset every shift. The current Firestore-persists-everything model already covers cross-device, but per-machine device memory would be a small `localStorage` cache keyed by `(uid, machineId)`. Defer until a hotel reports it.
- **Volume normalisation across devices** — a USB headset at 100% system volume and the built-in speaker at 100% system volume are wildly different loudness levels. A `volumeOffset` per device (e.g. `−20% on the built-in speaker`) would balance the chime against the call. Defer — the chime is short and the operator can adjust the system volume on either device.
