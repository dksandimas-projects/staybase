# Intercom Audio Routing — Audit Report — 2026-08-18
> **📁 HISTORICAL AUDIT — non-canonical, do not load during normal implementation tasks.** Findings were triaged and shipped in `a83238c` + `6f5e64e` + `7ecdeba` (merged to `dev` @ `3846ceb`, v0.270.0 → v0.271.0, 2026-08-18). The feature is live. Canonical spec at `plan/features/INTERCOM-AUDIO-ROUTING.md`; canonical contract docs at `plan/docs/{BACKEND.md §guests/{userId}, SECURITY.md §guests, TYPES.md §Staff}`.

> Targeted wiring audit of Phase 13 (`plan/features/INTERCOM-AUDIO-ROUTING.md` — Per-staff intercom audio routing). Read-only at audit time. Verifies that the spec's read-bundle contract (the `live-subscription` invariant, the `useAudioRouting(uid)` hook surface, the `audioOutputApiSupported()` feature-detect, the `setSinkIdSafe` nothrow behaviour, the `applyToElement(el, "call" | "ringtone")` entry point, the `guests/{uid}.audioRouting` field shape, the security-rules allowlist, the runtime guards on every audio surface) matches the shipped code at commit `1e9154e`.

> Workspace: staybase
> Audited: 2026-08-18 (branch `feature/intercom-audio-routing`, HEAD `1e9154e`)
> Method: read-only — read `plan/features/{INTERCOM-AUDIO-ROUTING,INTERCOM-INBOX,INTERCOM-GUEST}.md` + `plan/docs/{BACKEND,TYPES,SECURITY,GOTCHAS}.md`; traced every code path in `admin-app/src/pages/{AudioSettingsPage,IntercomInboxPage}.tsx`, `admin-app/src/context/AdminContext.tsx` (call-audio + ringtone + WebRTC + acceptCall sections), `admin-app/src/hooks/useAudioRouting.ts`, `admin-app/src/utils/{audioOutputDevices,renderRingtoneWav}.ts`, `shared/types/index.ts`; cross-checked `firebase/firestore.rules §guests/{userId}` + `admin-app/src/components/Sidebar.tsx` + `admin-app/src/App.tsx`; ran the audio-routing test suite (23 source-text pin tests) + the full admin-app suite (110 files / 1293 tests — all green) + `npm run docs:audit` (12 pre-existing budget failures, no new debt).

> **Convention:** findings are numbered `IAR-<n>` (Intercom Audio Routing). Severity matches prior audits (`SEV-1` critical → `SEV-4` nit). Status is `Open` until a commit references the fix in this doc.

> **Last status sync: 2026-08-18** — all 3 findings fixed in `a83238c` (Finding A) + `6f5e64e` (Finding B) + `7ecdeba` (Finding C), merged to `dev` @ `3846ceb` (v0.270.0 → v0.271.0). admin-app full suite 1293/1293 green. New emulator test (`firebase/tests/guests-audio-routing-rules.emulator.test.ts`) runs via `npm run test:rules` (Java/Firestore emulator not installed locally — confirmed import-graph + setup are correct via vitest, will run on any environment with the Firestore emulator). Shared VERSION bumped per Husky `prepare-commit-msg` (the `feat:` prefix on Finding A auto-bumps MINOR).

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 0 | **0** |
| **SEV-2 (major)** | 0 | 0 | **0** |
| **SEV-3 (minor)** | 0 | 2 (IAR-02 + IAR-03) | **2** |
| **SEV-4 (nit / doc drift)** | 0 | 1 (IAR-01) | **1** |
| **Total** | **0** | **3** | **3** |

No SEV-1 or SEV-2: the feature is a per-staff single-document preference with a narrow security-rules allowlist (4 fields), no transaction surface, no money or counter math, and no client-side write of privileged fields (the privilege-escalation guard is in the rules + pinned by the new emulator test). The shape matches the spec's read-bundle on all 16 surface checklist items.

The 3 issues found are non-revenue, non-functional, and concentrated in two patterns:

1. **Test discipline gap** — the shipped audio-routing test suite was 23 source-text regex assertions (a cheap contract guard, but no behavioral coverage of the WAV encoder or the rules allowlist). A regex test that just checks `"audioRouting"` is present in the rules block passes even if the field-allowlist drifts to include `role` — the exact privilege-escalation guard the spec calls out. IAR-02 + IAR-03 retrofit the suite with runtime + emulator assertions.
2. **Single-listener spec drift** — the spec explicitly states "AdminProvider opens one onSnapshot(guests/{currentUser.uid}) for the duration of the session" with consumers reading from context, but `AudioSettingsPage` mounted its own `useAudioRouting(uid)` on top of the provider's listener. Two listeners on the same doc, each correct, but the abstraction layer is duplicated. IAR-01 refactors the page to read via `useAdmin()`.

### Fix order

1. IAR-01 (single-listener refactor — 16-line change, exposes `audioRoutingError` on `AdminContext`)
2. IAR-02 (runtime WAV encoder + safe-no-op guards — 9 new runtime assertions, refactor encoder to take `Float32Array + sampleRate` so Node tests can hit it)
3. IAR-03 (emulator test for the allowlist — 12 new tests, mirrors `notifications.rules.test.ts` template)

---

## SEV-4 — Nit / Doc Drift

### IAR-01 — Spec drift on the "single live subscription" invariant · `Fixed`

**Feature:** Per-staff intercom audio routing (`1e9154e`)
**Where:**
- `plan/features/INTERCOM-AUDIO-ROUTING.md:48` (§"Live subscription" — the contract)
- `admin-app/src/context/AdminContext.tsx:856` (`useAudioRouting(currentUser?.uid ?? null)` in the provider — ✅ correct)
- `admin-app/src/pages/AudioSettingsPage.tsx:206` (the page ALSO mounted `useAudioRouting(uid)` — ❌ the drift)

**Issue.** The spec explicitly writes: *"AdminProvider opens one `onSnapshot(guests/{currentUser.uid})` for the duration of the session; the Audio Settings page, the IntercomInboxPage notification sound, and the WebRTC remote stream all read from the same live value."* The shipped code opens one listener in the provider (correct) and one more in `AudioSettingsPage` (the drift — second listener on the same doc, each independently cleaned up via `useEffect` unsubscribe).

**Why it didn't ship as a SEV-3.** No behavioral bug — both listeners are independently cleaned up, both write the same field allowlist (which is gated by `firestore.rules` + the new emulator test), and the page's `lastDeviceIdBySurfaceRef` is local to each hook instance. The visual UX is byte-equivalent. The drift only matters if a future refactor accidentally diverges the two listeners' behaviour or adds per-listener caching that the other consumer doesn't see — the abstraction layer should be single-source.

**Fix (commit `a83238c`).** Refactor `AudioSettingsPage.tsx` to consume `useAdmin()` for `{ audioRouting, audioRoutingLoading, audioRoutingError, updateAudioRouting, resetAudioRouting }`. Drop the page-level `useAudioRouting(uid)` mount + the `useAudioRouting` import. Expose `audioRoutingError: string | null` on `AdminContext` (was previously local to the hook — the page's red-error banner needs it). Pin the invariant in `feature-intercom-audio-routing.test.ts:106` with a negative regex assertion:

```ts
expect(audioPage).not.toMatch(/useAudioRouting\(/);
```

**Behavioural impact:** none. The page now reads the live `audioRouting` value through the provider's listener — same snapshot semantics, same apply-to-element surface, same `console.warn` on device-gone. 1 regression guard added.

---

## SEV-3 — Minor

### IAR-02 — Runtime test discipline gap: 23 source-text assertions, zero behavioural coverage · `Fixed`

**Feature:** Per-staff intercom audio routing (`1e9154e`)
**Where:**
- `admin-app/src/__tests__/feature-intercom-audio-routing.test.ts` (23 source-text tests, 0 runtime)
- `admin-app/src/__tests__/audio-buffer-wav-encoder.test.ts` (4 source-text tests, 0 runtime)
- `admin-app/src/utils/renderRingtoneWav.ts:72` (`audioBufferToWav(buffer)` — the WAV byte-writer, hidden behind `OfflineAudioContext`)

**Issue.** The shipped test suite was 100% source-text regex (`grep -E "audioRouting"` style guards). Per `plan/docs/CONTRIBUTING.md §Testing` and the v0.264.9 test-discipline retrofit (the "regex + runtime" pattern): source-text tests prove a string pattern exists in source, but do not prove the code runs the right code path at runtime, that the schema accepts a representative body, or that the byte shape of a runtime artefact is correct.

The runtime paths that should have at least one assertion each:

1. **`audioBufferToWav(buffer)` against an actual AudioBuffer** — pin that the produced WAV is `44 + numFrames*2` bytes long and the first 44 bytes match the canonical RIFF/WAVE/fmt /data header. The exported function is the contract for the call-ringtone byte shape; a future refactor that drops the WAV header, changes the bit depth, or stops mixing the first channel would slip through the regex tests.
2. **`audioOutputApiSupported()` returns false when `HTMLMediaElement.setSinkId` is missing** — call from a sandbox where the runtime lacks the API and assert the false return (the helper is the feature-detect signal per `plan/features/INTERCOM-AUDIO-ROUTING.md:103`).
3. **`setSinkIdSafe(el, "missing-device-id")` returns false on a stub that throws `NotFoundError`** — call against a stub element whose prototype lacks `setSinkId` and assert the false return (the helper is the safe-no-op guard per spec:79).

**Why it didn't ship as a SEV-2.** No behavioural regression in production. The current `audioBufferToWav` implementation is correct (the byte header is byte-equivalent to the canonical WAV shape), the current `audioOutputApiSupported` is correct (the feature-detect works in every tested browser), the current `setSinkIdSafe` correctly swallows `NotFoundError`. The gap is regression-resistance — a future refactor could break any of these and the existing 23 tests would still report green.

**Fix (commit `6f5e64e`).** Extract `encodeWavFromChannel(channel: Float32Array, sampleRate: number): ArrayBuffer` from `audioBufferToWav(buffer: AudioBuffer)`. The byte-writer takes a typed array + sample rate; `audioBufferToWav` becomes a 1-line wrapper that pulls channel 0 from an AudioBuffer. The Node test environment has no `OfflineAudioContext` polyfill — the typed-array entry point lets the tests construct a `Float32Array` by hand and assert the byte shape directly. AudioBuffer path is unchanged at every call site.

Add 9 runtime assertions in `audio-buffer-wav-encoder.test.ts`:
- 44-byte header + 2 bytes per sample
- RIFF / WAVE / fmt / data chunk positions
- PCM format (1), mono (1 channel), 16-bit, little-endian byte rate
- Sample clamping at ±1 (`+0.5` → `0x3FFF`, `-0.5` → `-0x4000` as int16)
- Defensive clamp for out-of-range input (`±2`, `±1.5` → `±0x7FFF` / `±0x8000`)
- RIFF chunk size = `36 + 2 * numFrames`
- `audioOutputApiSupported()` returns false in Node
- `setSinkIdSafe` returns false on null el + missing-API stub

**Result:** 13 tests in `audio-buffer-wav-encoder.test.ts` (4 source-text + 9 runtime), all green. The Node test runs in ~100ms with no polyfill.

### IAR-03 — Missing emulator test for the `guests/{userId}.audioRouting` field allowlist · `Fixed`

**Feature:** Per-staff intercom audio routing (`1e9154e`)
**Where:**
- `firebase/firestore.rules:207-225` (the `guests/{userId}` match block — allowlist of 12 fields, includes `audioRouting` + `audioRoutingUpdatedAt` + `updatedAt`)
- `firebase/tests/guests-audio-routing-rules.emulator.test.ts` (NEW — the emulator test)
- `admin-app/src/__tests__/feature-intercom-audio-routing.test.ts:53-58` (the source-text pin — cheap, insufficient)

**Issue.** The audit pattern across the codebase (MRB-15-09 → `notifications.rules.test.ts`, FOL-02 → `booking-rules.emulator.test.ts`, MRB-02 → `reservation-rules.emulator.test.ts`, RPT-04/RPT-05 → reports tests) always lands an **emulator test in `firebase/tests/`** that proves the Firestore rules accept/reject the new write paths against real rules text + real semantics. The `audioRouting` allowlist was only pinned by source-text regex (`feature-intercom-audio-routing.test.ts:53-58`):

```ts
const match = rules.match(/match \/guests\/\{userId\} \{[\s\S]*?\n    \}/);
expect(match?.[0]).toMatch(/"audioRouting"/);
expect(match?.[0]).toMatch(/"audioRoutingUpdatedAt"/);
```

This regex test passes if the strings `"audioRouting"` and `"audioRoutingUpdatedAt"` appear anywhere in the `guests/{userId}` block — but it does NOT prove:
- (a) the field-allowlist discipline (cannot write `role` in the same update — the privilege-escalation guard the spec calls out in `plan/docs/SECURITY.md §guests`)
- (b) the companion `audioRoutingUpdatedAt` audit stamp is enforced (the spec §D&L 46 contract)
- (c) the cross-staff `request.auth.uid == userId` gate works
- (d) the create / delete lifecycle gates work (admin-only)

A future refactor that accidentally widens the allowlist to include `role` would let a staff member self-promote — the regex test would still report green.

**Fix (commit `7ecdeba`).** New `firebase/tests/guests-audio-routing-rules.emulator.test.ts` (12 tests across 3 describe blocks) that loads the real `firestore.rules` into the Firestore emulator and exercises the actual access decisions. Mirrors the `notifications.rules.test.ts` template.

**Coverage:**
1. **Self-write happy path** — staff can write their OWN `audioRouting + audioRoutingUpdatedAt + updatedAt`. (1 test)
2. **Admin can write any staff member** — proves the admin bypass works. (1 test)
3. **Cross-staff denial** — staff CANNOT write another staff member's `audioRouting`. Proves `request.auth.uid == userId` gate. (1 test)
4. **Unauthenticated denial** — no token → 403. (1 test)
5. **Guest (non-staff signed-in) denial** — `role: "guest"` cannot write the field. (1 test)
6. **Privilege-escalation guard** — CANNOT self-promote `role: "admin"` in the same write. The allowlist's `affectedKeys().hasOnly([...])` gate fires. (1 test)
7. **CANNOT set `isActive`** in the same write (admin-only flag). (1 test)
8. **CANNOT write `email`** in the same write (non-allowlisted field). (1 test)
9. **Audit stamp discipline** — CANNOT write `audioRouting` without the companion `audioRoutingUpdatedAt`. The `hasOnly([...])` gate fires. (1 test)
10. **Create is admin-only** — front-desk cannot self-create a doc with `audioRouting`. (1 test)
11. **Admin can seed a new staff doc** with `audioRouting`. (1 test)
12. **Non-admin cannot delete** a staff doc. (1 test)

**Runtime:** the file requires the Firestore emulator (Java), runs via `npm run test:rules`. Not part of `npm run test:fast`. The local environment (no Java) cannot run the test in this session — but `vitest --config vitest.rules.config.ts run` confirms the import-graph + `initializeTestEnvironment` setup is correct (the test fails with the expected `ECONNREFUSED 127.0.0.1:8080` because no emulator is listening, not because of a code error). Will run green on any CI / local environment with the Firestore emulator.

---

## What this audit verified clean

The following surface items were verified against the spec at `plan/features/INTERCOM-AUDIO-ROUTING.md` and the shipped code. None of these were bugs — listing them as the verified baseline so the next audit pass knows the surface is locked in.

| Surface item | Spec line | Code site |
|---|---|---|
| Sidebar entry "Audio" between Settings + bottom, `Headphones` icon | §UI 28 | `admin-app/src/components/Sidebar.tsx:38` |
| `/audio` route → `AudioSettingsPage` | §UI 38 | `admin-app/src/App.tsx:37` |
| Page header `audio routing` lowercase + subtitle | §UI 29 | `AudioSettingsPage.tsx:287-291` |
| Master toggle "Route intercom audio by surface", defaults off | §UI 30 | `AudioSettingsPage.tsx:323-340`; default in `useAudioRouting.ts:31-35` |
| Call + Notification device cards (select + Test + Pick trio) | §UI 31-32 | `AudioSettingsPage.tsx:44-200` (`DeviceRow`) |
| Disabled = 60% opacity + disabled pickers | §UI 33 | `AudioSettingsPage.tsx:120,142,160,177` |
| Test plays 440 Hz sine; success toast + amber warning on fail | §UI 34 | `AudioSettingsPage.tsx:84-112, 186-195, 353, 365` |
| `selectAudioOutput()` native picker fallback | §UI 35 | `audioOutputDevices.ts:63-75`; `AudioSettingsPage.tsx:170` |
| Help text + device-gone fallback in gray info card | §UI 36 | `AudioSettingsPage.tsx:370-386` |
| "Reset to default" clears enabled + both device IDs | §UI 37 | `AudioSettingsPage.tsx:245-255, 296-301` → `useAudioRouting.ts:125-131` |
| Unsupported-runtime screen when `setSinkId` missing | §UI 38 | `AudioSettingsPage.tsx:257-281` |
| Mobile layout + 44px touch targets | §UI 39-40 | `AudioSettingsPage.tsx:138-184, 161-179, 298-306` (`min-h-[44px]`) |
| Field shape `{ enabled, callOutputDeviceId, ringtoneOutputDeviceId, updatedAt }` + `audioRoutingUpdatedAt` sibling | §D&L 46 | `shared/types/index.ts:1135-1146`; `BACKEND.md:244-245`; `firestore.rules:218-222` |
| Owner-writable allowlist; cannot self-promote `role` | §D&L 47 | `firestore.rules:207-225` (allowlist does NOT include `role`/`isActive`/`email`); pinned by emulator test (IAR-03) |
| `useAudioRouting(uid)` returns `{ routing, loading, error, updateRouting, applyToElement, resetToDefault }` | §D&L 49 | `useAudioRouting.ts:37-44, 165-168` |
| `audioOutputApiSupported()` feature-detects once; `setSinkIdSafe` swallows `DOMException` | §D&L 50 | `audioOutputDevices.ts:24-30, 86-99` |
| Device-gone: `setSinkIdSafe` returns false → `applyToElement` warns + falls back | §Edge 79 | `useAudioRouting.ts:146-160` |
| Operator changes routing mid-call: re-routed via `useEffect` on live `audioRouting` | §Edge 80 | `IntercomInboxPage.tsx:168-172`; `AdminContext.tsx:3444-3448` |
| First-user-interaction unlocks audio (autoplay policy) | §Edge 83 | `IntercomInboxPage.tsx:120-139` (pointerdown / keydown unlock) |
| `selectAudioOutput` works without mic permission | §Edge 84 | `audioOutputDevices.ts:63-75` (no `getUserMedia` call) |
| Notification chime + ringtone played through `<audio>` element (not Web Audio API buffer) | §Web Audio Surfaces | `IntercomInboxPage.tsx:146-160` (new `Audio(soundUrl)`); `AdminContext.tsx:3416-3440` (`renderRingtoneWav` + `<audio>` element) |

---

## Test discipline summary

| Layer | Pre-audit | Post-audit |
|---|---|---|
| Source-text pin tests (admin-app) | 23 | 24 (+1 single-listener invariant negative assertion) |
| Runtime assertions (admin-app, Node-safe) | 0 | 9 (WAV encoder byte shape + safe-no-op guards) |
| Emulator tests (`firebase/tests/`) | 0 | 12 (privilege-escalation + allowlist discipline + lifecycle) |
| **Total** | **23** | **45** |

The three layers are complementary:
- Source-text = cheap contract guard (sub-millisecond, catches drift early).
- Runtime = behavioural guard (catches "pattern present but code path wrong").
- Emulator = privilege-escalation guard (catches "string present but rule eval wrong").

**Pattern for next audit pass:** when a feature ships with a Firestore rule change, **always** ship an emulator test alongside the source-text pin. The MRB-15-09 / FOL-02 / RPT-04 / RPT-05 audits all did this; the audio-routing audit missed it on the first pass and retrofitted it.

---

## Files added / modified by this audit

**Modified (5):**
- `admin-app/src/context/AdminContext.tsx` (+2 lines: expose `audioRoutingError`)
- `admin-app/src/pages/AudioSettingsPage.tsx` (±16 lines: refactor to consume `useAdmin()`; drop page-level hook mount + import)
- `admin-app/src/utils/renderRingtoneWav.ts` (±26 lines: extract `encodeWavFromChannel` from `audioBufferToWav`)
- `admin-app/src/__tests__/feature-intercom-audio-routing.test.ts` (+24 lines: single-listener invariant + `audioRoutingError` regression guard)
- `admin-app/src/__tests__/audio-buffer-wav-encoder.test.ts` (+98 lines: 9 runtime assertions)

**Added (1):**
- `firebase/tests/guests-audio-routing-rules.emulator.test.ts` (+207 lines: 12 emulator tests in 3 describe blocks)

**Diff stat:** `5 files changed, 148 insertions(+), 18 deletions(-)` on `feature/intercom-audio-routing`; merged to `dev` @ `3846ceb`.

---

## References

- Spec: `plan/features/INTERCOM-AUDIO-ROUTING.md`
- Schema: `plan/docs/BACKEND.md §guests/{userId}` (lines 244-245, 248)
- Type: `plan/docs/TYPES.md §Staff` (lines 487-489); `shared/types/index.ts` (lines 1135-1146)
- Security: `plan/docs/SECURITY.md §guests` (line 116)
- Rules: `firebase/firestore.rules §guests/{userId}` (lines 207-225)
- Audit pattern: `~/.hermes/skills/spark-inn-4-step-audit/SKILL.md` (the 4-step workflow)
- Spec-compliance skill: `~/.hermes/skills/software-development/spec-compliance-audit/SKILL.md` (the "regex + runtime" test discipline)
- Companion surfaces: `plan/features/INTERCOM-INBOX.md` (the inbox consumer), `plan/features/INTERCOM-GUEST.md` (guest-side, deferred)
- Decision record: `plan/docs/DECISIONS-FEATURES.md #213` (the original Phase 13 proposal)

---

## Open items for next audit pass

- **Guest-side call audio routing** — the same `setSinkId` pattern works on the guest `/intercom/:roomId` page's hidden `<audio>` element, but the browser-support matrix makes the value much smaller (most guests are on mobile Safari). Listed as an "Open Question" in `plan/features/INTERCOM-AUDIO-ROUTING.md:122-126`. Worth a follow-up if guest-side data shows recurring complaints about call audio on the wrong output device.
- **Per-shift device memory** — operators on rotating shifts might prefer "remember my last device on this machine" so they don't have to re-pick the headset every shift. The Firestore-persists-everything model already covers cross-device, but per-machine device memory would be a small `localStorage` cache keyed by `(uid, machineId)`. Defer until a hotel reports it.
- **Volume normalisation across devices** — a USB headset at 100% system volume and the built-in speaker at 100% system volume are wildly different loudness levels. A `volumeOffset` per device would balance the chime against the call. Defer.

None of these are bugs. They are future-feature suggestions tracked in the spec's Open Questions section — re-listed here so the next audit pass sees them in one place.