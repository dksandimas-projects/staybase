import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAdmin, IntercomMessage, StoreOrder } from "../context/AdminContext";
import { formatPrice } from "../utils/format";
import { useBreakpoint } from "../utils/useBreakpoint";
import { Drawer } from "../components/Drawer";
import { IntercomChatPanel, type IntercomBookingSummary, type ThreadFilter } from "../components/IntercomChatPanel";
import { StoreOrderMessageCard } from "../components/StoreOrderMessageCard";
import { ArrowLeft } from "lucide-react";
import {
  MessageSquare, Send, PhoneOff, Phone,
  ArchiveRestore, CheckCheck, CheckCircle2, User, Radio, RotateCcw, Volume2, Mic, MicOff, ShoppingBag, ExternalLink,
  Bell, BellOff, Headphones
} from "lucide-react";
import config from "@config";

const NOTIFICATION_MUTED_KEY = "intercom-notification-muted";

export function IntercomInboxPage() {
  const {
    intercoms,
    intercomThreads,
    sendIntercomMessage,
    markChatAsRead,
    setIntercomResolved,
    incomingCall,
    acceptCall,
    declineCall,
    rooms,
    bookings,
    hotelConfig,
    storeOrders,
    applyAudioSink,
    audioRouting,
    // Per-call microphone mute state + toggle. Owned by AdminContext
    // (the local MediaStream lives there). See feature/INTERCOM-AUDIO-
    // ROUTING.md §"Call mute" for the lifecycle contract.
    isMicMuted,
    toggleMicMute,
    // Per decision #206 (2026-08-19): the current staff UID is
    // needed to compare against `incomingCall.acceptedBy.uid` so
    // the banner can render "Connected" (we accepted) vs
    // "Already answered by {Name}" (another staff claimed the
    // call first).
    currentUser
  } = useAdmin();
  const { isMobile } = useBreakpoint();

  const [searchParams, setSearchParams] = useSearchParams();
  const roomQueryParam = searchParams.get("room") || "";

  // Active chat selection
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string>("");

  useEffect(() => {
    if (roomQueryParam) {
      setSelectedRoomNumber(roomQueryParam);
      
      const thread = intercomThreads[roomQueryParam];
      const hasThreadsLoaded = Object.keys(intercomThreads).length > 0;
      
      if (thread) {
        if (thread.resolved) {
          setThreadFilter("resolved");
        }
        // Clean up the URL search params
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("room");
        setSearchParams(nextParams, { replace: true });
      } else if (hasThreadsLoaded) {
        // Clean up anyway if threads have loaded and this room is not in them
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("room");
        setSearchParams(nextParams, { replace: true });
      }
    }
  }, [roomQueryParam, intercomThreads, searchParams, setSearchParams]);
  const [threadFilter, setThreadFilter] = useState<"active" | "resolved">("active");
  const [replyText, setReplyText] = useState("");
  const [isInboxFocused, setIsInboxFocused] = useState(!document.hidden && document.hasFocus());
  const [isNotificationAudioUnlocked, setIsNotificationAudioUnlocked] = useState(false);
  // Mobile chat drawer — opens when the user taps a thread on mobile.
  // On desktop, the chat is always visible inline so this stays false.
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  // Per audit W2.9 / decision #97: per-staff mute preference stored
  // in localStorage so the inbox stays quiet across reloads. Defaults
  // to `false` (sounds on). The header exposes a Bell / BellOff
  // toggle so the user can flip it without leaving the page.
  const [isNotificationMuted, setIsNotificationMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(NOTIFICATION_MUTED_KEY) === "true";
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
  const notificationInitializedRef = useRef(false);
  const previousUnreadGuestIdsRef = useRef<Set<string>>(new Set());
  const previousRingingCallKeyRef = useRef("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTIFICATION_MUTED_KEY, isNotificationMuted ? "true" : "false");
  }, [isNotificationMuted]);

  // Call timer simulation state
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const updateFocusState = () => {
      setIsInboxFocused(!document.hidden && document.hasFocus());
    };

    window.addEventListener("focus", updateFocusState);
    window.addEventListener("blur", updateFocusState);
    document.addEventListener("visibilitychange", updateFocusState);

    return () => {
      window.removeEventListener("focus", updateFocusState);
      window.removeEventListener("blur", updateFocusState);
      document.removeEventListener("visibilitychange", updateFocusState);
    };
  }, []);

  // Per `plan/features/INTERCOM-AUDIO-ROUTING.md`: the notification
  // sound is now a hidden `<audio>` element (not a Web Audio API
  // buffer) so `setSinkId` can pin it to the staff's chosen
  // ringtone output device. The autoplay-unlock listener still
  // applies — the first `.play()` after page load needs a user
  // gesture in every browser. The unlock is also what gates
  // `isNotificationAudioUnlocked`, which the chime player reads.
  useEffect(() => {
    const unlockNotificationAudio = () => {
      if (audioContextRef.current === null && typeof window !== "undefined" && "AudioContext" in window) {
        audioContextRef.current = new AudioContext();
        void audioContextRef.current.resume();
      }
      setIsNotificationAudioUnlocked(true);
    };

    window.addEventListener("pointerdown", unlockNotificationAudio, { once: true });
    window.addEventListener("keydown", unlockNotificationAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockNotificationAudio);
      window.removeEventListener("keydown", unlockNotificationAudio);
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      notificationAudioRef.current = null;
    };
  }, []);

  // Wire the notification sound URL to the routed `<audio>` element.
  // When the URL changes we tear down the old element and create a
  // fresh one so a new sound file is honoured. `applyAudioSink` is
  // a safe no-op when audio routing is disabled — the element still
  // plays through the system default in that case.
  useEffect(() => {
    const soundUrl = hotelConfig?.notificationSoundUrl;
    if (!soundUrl) {
      notificationAudioRef.current = null;
      return;
    }
    const audio = new Audio(soundUrl);
    audio.preload = "auto";
    void applyAudioSink(audio, "ringtone").catch(() => undefined);
    notificationAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      notificationAudioRef.current = null;
    };
  }, [hotelConfig?.notificationSoundUrl, applyAudioSink]);

  // Re-route the notification audio when the routing preference
  // changes (e.g. the operator picks a new ringtone device). Same
  // for the in-call WebRTC audio: the AdminContext side has the
  // ref so a re-route is handled there, but for the inbox's own
  // `<audio>` element we re-apply on every change.
  useEffect(() => {
    const audio = notificationAudioRef.current;
    if (!audio) return;
    void applyAudioSink(audio, "ringtone").catch(() => undefined);
  }, [audioRouting, applyAudioSink]);

  // Handle active call duration timer
  useEffect(() => {
    if (incomingCall && incomingCall.status === "active") {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setCallDuration(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [incomingCall?.status]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedRoomNumber) return;

    sendIntercomMessage(selectedRoomNumber, replyText.trim(), "front-desk");
    setReplyText("");
  };

  const handleSelectRoom = (roomNum: string) => {
    setSelectedRoomNumber(roomNum);
    markChatAsRead(roomNum);
    if (isMobile) {
      setIsMobileChatOpen(true);
    }
  };

  const closeMobileChat = () => setIsMobileChatOpen(false);

  // Helper: Format duration seconds to MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const playNotificationSound = () => {
    const audio = notificationAudioRef.current;
    if (!audio) return;
    // Rewind to the start so back-to-back chimes don't drop the
    // first 100ms. `setSinkId` was already applied at element
    // creation; calling it again here is harmless.
    try {
      audio.currentTime = 0;
    } catch {
      // Some Safari builds throw when the element hasn't loaded
      // enough to seek. Fall through — the .play() call will
      // surface the same error and we silently skip.
    }
    void audio.play().catch(() => {
      // Autoplay policy can still gate the first play after a
      // cold page load. The unlock-on-pointerdown listener above
      // covers subsequent plays. Silent skip per the original
      // design — no toast for a missed chime.
    });
  };

  // Get rooms with active occupancy or intercom history, then filter by resolved state
  const allThreadRooms = useMemo(
    () => rooms.filter((room) => room.status === "occupied" || intercoms[room.roomNumber]),
    [intercoms, rooms]
  );
  const filteredRooms = useMemo(
    () => allThreadRooms.filter((room) => {
      const isResolved = !!intercomThreads[room.roomNumber]?.resolved;
      return threadFilter === "resolved" ? isResolved : !isResolved;
    }),
    [allThreadRooms, intercomThreads, threadFilter]
  );

  // Current chat logs
  const activeChatMessages = intercoms[selectedRoomNumber] || [];
  const selectedThread = intercomThreads[selectedRoomNumber];
  const isSelectedThreadResolved = !!selectedThread?.resolved;
  const unreadGuestMessages = useMemo(
    () => Object.values(intercoms)
      .flat()
      .filter((message) => message.sender === "guest" && !message.isRead),
    [intercoms]
  );
  const unreadGuestCount = unreadGuestMessages.length;
  const selectedUnreadSignature = activeChatMessages
    .filter((message) => message.sender === "guest" && !message.isRead)
    .map((message) => message.id)
    .join(",");
  const storeOrdersByRef = useMemo(
    () => new Map(storeOrders.map((order) => [order.orderRef, order])),
    [storeOrders]
  );
  const selectedBookingSummary = useMemo<IntercomBookingSummary | null>(() => {
    if (!selectedRoomNumber) return null;
    const activeStatuses = ["checked-in", "confirmed", "payment-confirmed"];
    const matching = bookings
      .filter((booking) => booking.roomNumber === selectedRoomNumber && activeStatuses.includes(booking.status))
      .sort((a, b) => {
        const priority = (status: string) => status === "checked-in" ? 0 : status === "confirmed" ? 1 : 2;
        return priority(a.status) - priority(b.status);
      })[0];
    if (!matching) return null;
    return {
      guestName: matching.guestName,
      bookingRef: matching.bookingRef,
      checkIn: matching.checkIn,
      checkOut: matching.checkOut,
      status: matching.status,
      specialRequests: matching.specialRequests || matching.notes || ""
    };
  }, [bookings, selectedRoomNumber]);

  useEffect(() => {
    // On mobile, the user explicitly taps a thread to open it. Auto-
    // selecting the first thread would open the chat drawer on every
    // mount and on every rooms/filter change, which is jarring.
    if (isMobile) return;
    if (selectedRoomNumber && filteredRooms.some((room) => room.roomNumber === selectedRoomNumber)) return;
    setSelectedRoomNumber(filteredRooms[0]?.roomNumber || "");
  }, [filteredRooms, isMobile, selectedRoomNumber]);

  useEffect(() => {
    if (!isInboxFocused || !selectedRoomNumber || !selectedUnreadSignature) return;
    void markChatAsRead(selectedRoomNumber);
  }, [isInboxFocused, markChatAsRead, selectedRoomNumber, selectedUnreadSignature]);

  useEffect(() => {
    const baseTitle = "Intercom Inbox";
    document.title = unreadGuestCount > 0 ? `(${unreadGuestCount}) ${baseTitle}` : baseTitle;

    return () => {
      document.title = config.brandName;
    };
  }, [unreadGuestCount]);

  useEffect(() => {
    const currentUnreadGuestIds = new Set(unreadGuestMessages.map((message) => message.id));
    const hasNewUnreadGuestMessage = unreadGuestMessages.some((message) => !previousUnreadGuestIdsRef.current.has(message.id));

    if (notificationInitializedRef.current && hasNewUnreadGuestMessage && !isInboxFocused && !isNotificationMuted) {
      playNotificationSound();
    }

    notificationInitializedRef.current = true;
    previousUnreadGuestIdsRef.current = currentUnreadGuestIds;
  }, [isInboxFocused, isNotificationMuted, unreadGuestMessages]);

  useEffect(() => {
    const ringingCallKey = incomingCall?.status === "ringing" ? incomingCall.roomId : "";
    const hasNewRingingCall = ringingCallKey && ringingCallKey !== previousRingingCallKeyRef.current;

    if (hasNewRingingCall && !isInboxFocused) {
      playNotificationSound();
    }

    previousRingingCallKeyRef.current = ringingCallKey;
  }, [incomingCall?.roomId, incomingCall?.status, isInboxFocused]);

  const handleToggleResolved = async () => {
    if (!selectedRoomNumber) return;
    await setIntercomResolved(selectedRoomNumber, !isSelectedThreadResolved);
  };

  return (
    <>
      <div className="space-y-8 font-body">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">intercom & reception</h1>
          <p className="text-xs text-gray-500 mt-1">Review active room chat logs, dispatch quick-request orders, and process voice signaling calls.</p>
        </div>
        <div className="flex items-center gap-2">
          {/*
           * Audio settings shortcut (refactor/audio-discovery). The
           * /audio route owns per-staff call + ringtone output device
           * routing and is the natural place to tune the sounds this
           * page produces (notification chime + ringtone + the live
           * intercom call). Previously this lived as a sidebar item
           * — easy to miss from the inbox where the user actually
           * hears the sound. Now it sits one click away from the
           * inbox header, grouped with the existing sound On/Off
           * toggle since both relate to "what does this inbox
           * sound like?".
           *
           * Uses the same ghost-border / uppercase-chip pattern as
           * the Bell toggle for visual consistency. The 44px tap
           * target is preserved per CLAUDE.md hard rules.
           */}
          <Link
            to="/audio"
            aria-label="Open audio routing settings"
            title="Per-staff audio routing — call + ringtone output devices"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 transition hover:bg-gray-50"
          >
            <Headphones size={14} aria-hidden="true" />
            Audio Settings
          </Link>
          <button
            type="button"
            onClick={() => setIsNotificationMuted((prev) => !prev)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-[10px] font-bold uppercase tracking-wider transition ${
              isNotificationMuted
                ? "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                : "border-primary/30 bg-primary-light text-primary-dark hover:bg-primary/10"
            }`}
            title={isNotificationMuted ? "Notification sound is muted. Click to unmute." : "Notification sound is on. Click to mute."}
            aria-label={isNotificationMuted ? "Unmute notification sound" : "Mute notification sound"}
            aria-pressed={isNotificationMuted}
          >
            {isNotificationMuted ? <BellOff size={14} /> : <Bell size={14} />}
            {isNotificationMuted ? "Sound Off" : "Sound On"}
          </button>
        </div>
      </header>

      {/* WebRTC Signaling Call Banner Overlay */}
      {incomingCall && (() => {
        // Per decision #206 (2026-08-19): the call banner has three
        // states, not two. The pre-#206 banner had only "ringing"
        // (Accept / Ignore) and "active" (Mute / Disconnect). The
        // new "claimed by another staff" state appears when the
        // runTransaction claim in `acceptCall` committed for a
        // different staff member — this tab's snapshot will see
        // `status: "active" + acceptedBy.uid !== currentUser.uid`
        // and the banner needs to render an informational surface
        // (no Accept/Ignore/Mute/Disconnect buttons) so the loser
        // doesn't click through to a half-built WebRTC connection.
        // The banner auto-dismisses when the winner ends the call
        // (the snapshot listener clears incomingCall on status
        // flip to "ended" via the activeCalls filter).
        const isClaimedByOtherStaff =
          incomingCall.status === "active" &&
          !!incomingCall.acceptedBy &&
          !!currentUser?.uid &&
          incomingCall.acceptedBy.uid !== currentUser.uid;

        if (isClaimedByOtherStaff) {
          return (
            <div
              data-testid="call-already-claimed-banner"
              className="rounded-xl border border-gray-200 bg-gray-50 p-6 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6 animate-fade-in z-20"
            >
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full flex items-center justify-center text-gray-500 bg-gray-200 shrink-0">
                  <PhoneOff size={24} />
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                    Call Already Answered
                  </span>
                  <h2 className="font-heading text-xl text-gray-700 lowercase mt-1">
                    Room {incomingCall.roomId} ({incomingCall.guestName})
                  </h2>
                  <p className="text-xs text-gray-500 mt-1.5 font-bold">
                    Answered by{" "}
                    <span className="text-gray-800">
                      {incomingCall.acceptedBy?.name ?? "another staff member"}
                    </span>
                    . This banner clears when they hang up.
                  </p>
                </div>
              </div>
            </div>
          );
        }

        return (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 shadow-sm ring-4 ring-primary/10 flex flex-col md:flex-row justify-between items-center gap-6 animate-fade-in z-20">
          <div className="flex items-center gap-4">
            <div className={`h-14 w-14 rounded-full flex items-center justify-center text-white shrink-0 ${
              incomingCall.status === "ringing" ? "bg-green-600 animate-bounce" : "bg-primary animate-pulse"
            }`}>
              <Phone size={24} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-red-500 animate-ping" />
                <span className="text-[10px] text-primary-dark font-bold uppercase tracking-wider">
                  {incomingCall.status === "ringing" ? "Incoming WebRTC Ringing" : "Connected Session Active"}
                </span>
              </div>
              <h2 className="font-heading text-2xl text-gray-950 lowercase mt-1">
                Room {incomingCall.roomId} ({incomingCall.guestName})
              </h2>
              {incomingCall.status === "active" && (
                <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-1.5 font-bold">
                  <Radio size={12} className="text-primary animate-pulse" />
                  Call Duration: <span className="font-mono text-gray-800">{formatTime(callDuration)}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {incomingCall.status === "ringing" ? (
              <>
                <button
                  onClick={() => void declineCall()}
                  className="min-h-[44px] px-5 rounded-lg border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50 transition"
                >
                  Ignore Call
                </button>
                <button
                  onClick={() => void acceptCall()}
                  className="min-h-[44px] px-6 rounded-lg bg-green-600 hover:bg-green-700 text-xs font-bold text-white shadow-sm transition flex items-center gap-1.5"
                >
                  <Volume2 size={14} />
                  Accept Voice
                </button>
              </>
            ) : (
              <>
                {/* Live mic status pill — always visible so the
                 * operator can see the current mic state at a
                 * glance, not just the action label of the toggle
                 * button below. Pre-#218 the indicator was
                 * `hidden lg:flex` (desktop only) and the toggle
                 * button label was the only status cue on
                 * mobile/tablet — that made the post-accept
                 * "Mute" label read as "I'm muted" even when the
                 * mic was open (operator-reported 2026-08-19).
                 * The pill now shows on every breakpoint with a
                 * green/red dot + a clear state label
                 * ("Mic open" / "Mic muted"). The toggle button
                 * below keeps the action label ("Mute" /
                 * "Unmute") so the two surfaces don't compete.
                 */}
                <div
                  data-testid={`call-mic-status-pill-${incomingCall.roomId}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border ${
                    isMicMuted
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      isMicMuted ? "bg-red-500" : "bg-emerald-500"
                    }`}
                  />
                  {isMicMuted ? "Mic muted" : "Mic open"}
                </div>

                {/*
                 * Per-call mic mute toggle. Owned by AdminContext so
                 * it sees the local MediaStream and reads/writes its
                 * audio track's `enabled` property. The toggle is
                 * purely client-side — the remote end hears silence
                 * only while muted, and the flag auto-resets on the
                 * next call (or on Disconnect), so a stale mute can't
                 * surprise the operator on the next guest.
                 *
                 * Visual states mirror the conventions:
                 *   Mute (idle / unmuted)    → primary-on-light chip
                 *   Unmute (mid-call mute)   → amber-on-light chip
                 * The amber draws the eye without screaming "error".
                 *
                 * The button label is the ACTION ("Mute" = click to
                 * mute), not the current state — the live status
                 * pill above carries the current state. Together
                 * they read as "Mic open · Mute" / "Mic muted ·
                 * Unmute" which is unambiguous even on first read.
                 */}
                <button
                  type="button"
                  onClick={() => void toggleMicMute()}
                  aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                  aria-pressed={isMicMuted}
                  title={isMicMuted
                    ? "Mic is muted. The guest can't hear you. Click to unmute."
                    : "Mic is open. The guest can hear you. Click to mute."}
                  data-testid={`call-mute-toggle-${incomingCall.roomId}`}
                  className={`min-h-[44px] px-5 rounded-lg border text-xs font-bold shadow-sm transition flex items-center gap-1.5 ${
                    isMicMuted
                      ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                      : "border-primary/30 bg-primary-light text-primary-dark hover:bg-primary/10"
                  }`}
                >
                  {isMicMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  {isMicMuted ? "Unmute" : "Mute"}
                </button>

                {/*
                 * Per-call disconnect. Calls declineCall() which
                 * sets adminCallExplicitDeclineRef=true and routes
                 * through cleanupAdminCall — the terminal event
                 * that fires the "call-answered" audit message (the
                 * `answered` branch wins the if/else over explicit
                 * decline because the answer ref is already set at
                 * this point in the lifecycle).
                 *
                 * Pre-#218 the className used `bg-red-650` which is
                 * not in the Tailwind palette (the standard scale
                 * jumps 600 → 700) so the button rendered with NO
                 * background and was effectively invisible against
                 * the white card. Fixed to `bg-red-600` + the
                 * standard `hover:bg-red-700` (operator-reported
                 * 2026-08-19).
                 */}
                <button
                  onClick={() => void declineCall()}
                  className="min-h-[44px] px-6 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow-sm transition flex items-center gap-1.5"
                >
                  <PhoneOff size={14} />
                  Disconnect Call
                </button>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* Main Inbox layout */}
      <div className="grid gap-6 lg:grid-cols-[280px_1fr] min-h-[500px]">
        {/* Left: Chat thread list */}
        <div className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 px-2">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Channels</h2>
            <span className="text-[10px] font-bold text-gray-400">{filteredRooms.length}</span>
          </div>

          <div className="grid grid-cols-2 rounded-lg bg-gray-100 p-1">
            {(["active", "resolved"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setThreadFilter(filter)}
                className={`min-h-[36px] rounded-md text-[10px] font-bold capitalize transition ${
                  threadFilter === filter
                    ? "bg-white text-primary shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
          
          <div className="space-y-1.5 overflow-y-auto max-h-[440px]">
            {filteredRooms.map((room) => {
              const messages = intercoms[room.roomNumber] || [];
              const hasUnread = messages.some(m => !m.isRead && m.sender === "guest");
              const lastMessage = messages[messages.length - 1];
              const thread = intercomThreads[room.roomNumber];

              return (
                <button
                  key={room.id}
                  onClick={() => handleSelectRoom(room.roomNumber)}
                  className={`w-full text-left p-3 rounded-lg border transition flex items-start gap-3 ${
                    selectedRoomNumber === room.roomNumber 
                      ? "bg-primary/5 border-primary/20 ring-1 ring-primary/10" 
                      : "bg-white border-transparent hover:bg-gray-50"
                  }`}
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                    {room.roomNumber}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-xs text-gray-900 leading-snug">Room {room.roomNumber}</span>
                      {hasUnread && (
                        <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                      )}
                    </div>
                    
                    <p className="text-[10px] text-gray-500 font-medium truncate mt-0.5">
                      {lastMessage ? lastMessage.text : "No messages yet."}
                    </p>
                    {thread?.resolved && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-green-700">
                        <CheckCircle2 size={10} />
                        Resolved
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {filteredRooms.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-200 px-3 py-8 text-center">
                <MessageSquare size={22} className="mx-auto text-gray-300" />
                <p className="mt-2 text-xs font-semibold text-gray-500">
                  No {threadFilter} conversations.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Message dialog box — desktop only. On mobile, the chat
            is shown in a full-screen Drawer (see below) so the user
            sees a single-pane thread list and opens a chat on tap. */}
        {!isMobile && (
          <IntercomChatPanel
            roomNumber={selectedRoomNumber}
            messages={activeChatMessages}
            storeOrdersByRef={storeOrdersByRef}
            bookingSummary={selectedBookingSummary}
            threadFilter={threadFilter as ThreadFilter}
            isResolved={isSelectedThreadResolved}
            onToggleResolved={() => void handleToggleResolved()}
            replyText={replyText}
            onReplyTextChange={setReplyText}
            onSend={() => handleSendMessage({ preventDefault: () => undefined } as unknown as React.FormEvent)}
            variant="panel"
          />
        )}
      </div>

      </div>

      {/* Mobile chat drawer — full-screen bottom sheet with a
          'Back to threads' button. The bottom tab bar still
          floats over it (per the persistent-inside-drawers rule). */}
      <Drawer
        title={selectedRoomNumber ? `Room ${selectedRoomNumber}` : "Chat"}
        open={isMobile && isMobileChatOpen && Boolean(selectedRoomNumber)}
        onClose={closeMobileChat}
      >
        <IntercomChatPanel
          roomNumber={selectedRoomNumber}
          messages={activeChatMessages}
          storeOrdersByRef={storeOrdersByRef}
          bookingSummary={selectedBookingSummary}
          threadFilter={threadFilter as ThreadFilter}
          isResolved={isSelectedThreadResolved}
          onToggleResolved={() => void handleToggleResolved()}
          replyText={replyText}
          onReplyTextChange={setReplyText}
          onSend={() => handleSendMessage({ preventDefault: () => undefined } as unknown as React.FormEvent)}
          onBack={closeMobileChat}
          BackIcon={ArrowLeft}
          variant="drawer"
        />
      </Drawer>
    </>
  );
}
