import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAdmin, IntercomMessage, StoreOrder } from "../context/AdminContext";
import { formatPrice } from "../utils/format";
import { useBreakpoint } from "../utils/useBreakpoint";
import { Drawer } from "../components/Drawer";
import { IntercomChatPanel, type ThreadFilter } from "../components/IntercomChatPanel";
import { StoreOrderMessageCard } from "../components/StoreOrderMessageCard";
import { ArrowLeft } from "lucide-react";
import {
  MessageSquare, Send, PhoneOff, Phone,
  ArchiveRestore, CheckCheck, CheckCircle2, User, Radio, RotateCcw, Volume2, Mic, ShoppingBag, ExternalLink,
  Bell, BellOff
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
    hotelConfig,
    storeOrders
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
  const notificationBufferRef = useRef<AudioBuffer | null>(null);
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

  useEffect(() => {
    const unlockNotificationAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      void audioContextRef.current.resume().then(() => setIsNotificationAudioUnlocked(true));
    };

    window.addEventListener("pointerdown", unlockNotificationAudio, { once: true });
    window.addEventListener("keydown", unlockNotificationAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockNotificationAudio);
      window.removeEventListener("keydown", unlockNotificationAudio);
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    const soundUrl = hotelConfig?.notificationSoundUrl;
    notificationBufferRef.current = null;
    if (!soundUrl || !audioContextRef.current || !isNotificationAudioUnlocked) return;

    let isCancelled = false;
    fetch(soundUrl)
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => audioContextRef.current?.decodeAudioData(arrayBuffer))
      .then((audioBuffer) => {
        if (!isCancelled && audioBuffer) {
          notificationBufferRef.current = audioBuffer;
        }
      })
      .catch(() => {
        notificationBufferRef.current = null;
      });

    return () => {
      isCancelled = true;
    };
  }, [hotelConfig?.notificationSoundUrl, isNotificationAudioUnlocked]);

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
    const audioContext = audioContextRef.current;
    const notificationBuffer = notificationBufferRef.current;
    if (!audioContext || !notificationBuffer || audioContext.state !== "running") return;

    const source = audioContext.createBufferSource();
    source.buffer = notificationBuffer;
    source.connect(audioContext.destination);
    source.start();
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
      {incomingCall && (
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
                {/* Voice connected indicators */}
                <div className="hidden lg:flex items-center gap-1 bg-white/60 rounded px-2.5 py-1 border border-gray-150 text-[10px] text-gray-500 font-semibold">
                  <Mic size={10} className="text-primary" />
                  Audio Stream: Active
                </div>
                
                <button
                  onClick={() => void declineCall()}
                  className="min-h-[44px] px-6 rounded-lg bg-red-650 hover:bg-red-700 text-xs font-bold text-white shadow-sm transition flex items-center gap-1.5"
                >
                  <PhoneOff size={14} />
                  Disconnect Call
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
