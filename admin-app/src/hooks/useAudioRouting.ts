// `plan/features/INTERCOM-AUDIO-ROUTING.md`
//
// Per-staff intercom audio routing. Reads `guests/{uid}.audioRouting`
// from Firestore, persists updates with the same field-allowlist
// discipline used by the rest of the admin app, and exposes a
// `applyToElement(el, surface)` helper for `<audio>` elements that
// should be pinned to either the call or ringtone output device.
//
// State flow:
//   1. The Audio Settings page calls `updateRouting({ ... })` to write
//      a new preference to Firestore.
//   2. The hook subscribes to `guests/{uid}` and exposes the live value.
//   3. The IntercomInboxPage + AdminContext call `applyToElement(audioEl,
//      "call" | "ringtone")` whenever they create a new audio element.
//      The helper no-ops when `enabled === false` or when the runtime
//      doesn't support output device selection.
//
// If the saved `deviceId` no longer exists (USB headset unplugged),
// `applyToElement` falls back to the system default and emits a single
// console.warn so the operator knows why their routing reverted. The
// next save will overwrite the stale `deviceId`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import type { AudioRouting as AudioRoutingShape } from "@spark-inn/shared";
import { db } from "../firebase/config";
import { setSinkIdSafe } from "../utils/audioOutputDevices";

export type AudioSurface = "call" | "ringtone";

const DEFAULT_ROUTING: AudioRoutingShape = {
  enabled: false,
  callOutputDeviceId: null,
  ringtoneOutputDeviceId: null
};

export interface UseAudioRoutingResult {
  routing: AudioRoutingShape;
  loading: boolean;
  error: string | null;
  updateRouting: (next: Partial<AudioRoutingShape>) => Promise<void>;
  applyToElement: (el: HTMLMediaElement | null | undefined, surface: AudioSurface) => Promise<boolean>;
  resetToDefault: () => Promise<void>;
}

/**
 * Subscribe to the current staff member's `audioRouting` field and
 * expose helpers to read, write, and apply it. `uid` is the staff
 * Firebase Auth UID; pass `null` when no user is signed in to skip the
 * listener entirely.
 */
export function useAudioRouting(uid: string | null | undefined): UseAudioRoutingResult {
  const [routing, setRouting] = useState<AudioRoutingShape>(DEFAULT_ROUTING);
  const [loading, setLoading] = useState<boolean>(!!uid);
  const [error, setError] = useState<string | null>(null);
  const lastDeviceIdBySurfaceRef = useRef<{ call: string | null; ringtone: string | null }>({
    call: null,
    ringtone: null
  });

  useEffect(() => {
    if (!uid) {
      setRouting(DEFAULT_ROUTING);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = doc(db, "guests", uid);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        const next: AudioRoutingShape = data?.audioRouting
          ? {
              enabled: !!data.audioRouting.enabled,
              callOutputDeviceId: data.audioRouting.callOutputDeviceId ?? null,
              ringtoneOutputDeviceId: data.audioRouting.ringtoneOutputDeviceId ?? null,
              updatedAt: data.audioRouting.updatedAt?.toDate?.() ?? undefined
            }
          : DEFAULT_ROUTING;
        setRouting(next);
        setLoading(false);
      },
      (err) => {
        console.error("useAudioRouting: snapshot error", err);
        setError(err.message || "Failed to load audio routing");
        setLoading(false);
      }
    );
    return () => {
      unsubscribe();
    };
  }, [uid]);

  const updateRouting = useCallback<UseAudioRoutingResult["updateRouting"]>(
    async (next) => {
      if (!uid) {
        setError("Not signed in");
        return;
      }
      const merged: AudioRoutingShape = {
        enabled: next.enabled ?? routing.enabled,
        callOutputDeviceId:
          next.callOutputDeviceId !== undefined ? next.callOutputDeviceId : routing.callOutputDeviceId,
        ringtoneOutputDeviceId:
          next.ringtoneOutputDeviceId !== undefined ? next.ringtoneOutputDeviceId : routing.ringtoneOutputDeviceId
      };
      try {
        await updateDoc(doc(db, "guests", uid), {
          audioRouting: merged,
          audioRoutingUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save audio routing";
        console.error("useAudioRouting: save error", err);
        setError(message);
        throw err;
      }
    },
    [uid, routing]
  );

  const resetToDefault = useCallback(async () => {
    await updateRouting({
      enabled: false,
      callOutputDeviceId: null,
      ringtoneOutputDeviceId: null
    });
  }, [updateRouting]);

  const applyToElement = useCallback<UseAudioRoutingResult["applyToElement"]>(
    async (el, surface) => {
      if (!el) return false;
      if (!routing.enabled) {
        // Disabled = clear any prior sink and let the system default apply.
        return setSinkIdSafe(el, null);
      }
      const targetDeviceId = surface === "call" ? routing.callOutputDeviceId : routing.ringtoneOutputDeviceId;
      if (lastDeviceIdBySurfaceRef.current[surface] === (targetDeviceId ?? null)) {
        // Already routed to the right device. `setSinkId` is a no-op when
        // the same ID is re-applied but avoid the round-trip anyway.
        return true;
      }
      const ok = await setSinkIdSafe(el, targetDeviceId);
      if (ok) {
        lastDeviceIdBySurfaceRef.current[surface] = targetDeviceId ?? null;
      } else {
        lastDeviceIdBySurfaceRef.current[surface] = null;
        if (targetDeviceId) {
          // Saved device is gone (USB headset unplugged, Bluetooth
          // device disconnected, etc.) — fall back to system default
          // and surface a single warning so the operator knows why.
          console.warn(
            `[useAudioRouting] Saved ${surface} output device ${targetDeviceId} is no longer available — falling back to system default. Open /audio to pick a new device.`
          );
        }
      }
      return ok;
    },
    [routing]
  );

  return useMemo(
    () => ({ routing, loading, error, updateRouting, applyToElement, resetToDefault }),
    [routing, loading, error, updateRouting, applyToElement, resetToDefault]
  );
}
