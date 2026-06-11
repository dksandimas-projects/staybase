import { useState, useEffect, useMemo, useRef } from "react";
import { useAdmin, IntercomMessage } from "../context/AdminContext";
import { 
  MessageSquare, Send, PhoneOff, Phone,
  Sparkles, CheckCheck, User, Radio, Volume2, Mic 
} from "lucide-react";
import config from "@config";

export function IntercomInboxPage() {
  const { 
    intercoms, 
    sendIntercomMessage, 
    markChatAsRead, 
    incomingCall, 
    acceptCall, 
    declineCall,
    rooms,
    hotelConfig
  } = useAdmin();

  // Active chat selection
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string>("");
  const [replyText, setReplyText] = useState("");
  const [isInboxFocused, setIsInboxFocused] = useState(!document.hidden && document.hasFocus());
  const [isNotificationAudioUnlocked, setIsNotificationAudioUnlocked] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const notificationBufferRef = useRef<AudioBuffer | null>(null);
  const notificationInitializedRef = useRef(false);
  const previousUnreadGuestIdsRef = useRef<Set<string>>(new Set());

  // Call timer simulation state
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [intercoms, selectedRoomNumber]);

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
  };

  // Helper: Format duration seconds to MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Get active rooms list that have intercom history or are currently occupied
  const activeRooms = useMemo(
    () => rooms.filter(r => r.status === "occupied" || intercoms[r.roomNumber]),
    [intercoms, rooms]
  );

  // Current chat logs
  const activeChatMessages = intercoms[selectedRoomNumber] || [];
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

  useEffect(() => {
    if (selectedRoomNumber && activeRooms.some((room) => room.roomNumber === selectedRoomNumber)) return;
    setSelectedRoomNumber(activeRooms[0]?.roomNumber || "");
  }, [activeRooms, selectedRoomNumber]);

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

    if (notificationInitializedRef.current && hasNewUnreadGuestMessage && !isInboxFocused) {
      const audioContext = audioContextRef.current;
      const notificationBuffer = notificationBufferRef.current;
      if (audioContext && notificationBuffer && audioContext.state === "running") {
        const source = audioContext.createBufferSource();
        source.buffer = notificationBuffer;
        source.connect(audioContext.destination);
        source.start();
      }
    }

    notificationInitializedRef.current = true;
    previousUnreadGuestIdsRef.current = currentUnreadGuestIds;
  }, [isInboxFocused, unreadGuestMessages]);

  return (
    <div className="space-y-8 font-body">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">intercom & reception</h1>
          <p className="text-xs text-gray-500 mt-1">Review active room chat logs, dispatch quick-request orders, and process voice signaling calls.</p>
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
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2">Active Channels</h2>
          
          <div className="space-y-1.5 overflow-y-auto max-h-[440px]">
            {activeRooms.map((room) => {
              const messages = intercoms[room.roomNumber] || [];
              const hasUnread = messages.some(m => !m.isRead && m.sender === "guest");
              const lastMessage = messages[messages.length - 1];

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
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Message dialog box */}
        <div className="rounded-card bg-white shadow-sm ring-1 ring-gray-200 flex flex-col justify-between overflow-hidden min-h-[460px]">
          {/* Header */}
          <div className="bg-gray-50/50 border-b border-gray-200 p-4 flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                {selectedRoomNumber}
              </div>
              <div>
                <h3 className="font-bold text-xs text-gray-900 leading-none">Intercom Feed Room {selectedRoomNumber}</h3>
                <span className="text-[9px] text-gray-400 capitalize mt-1 inline-block">Active stay room link</span>
              </div>
            </div>

            <span className="inline-flex items-center gap-1 text-[10px] text-green-700 font-bold bg-green-50 border border-green-200 px-2 py-0.5 rounded">
              <CheckCheck size={10} />
              Operational feed online
            </span>
          </div>

          {/* Message History Viewport */}
          <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[340px] bg-gray-50/20">
            {activeChatMessages.length > 0 ? (
              activeChatMessages.map((msg) => {
                const isFd = msg.sender === "front-desk";

                return (
                  <div key={msg.id} className={`flex gap-3 max-w-[85%] ${isFd ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      isFd ? "bg-primary/10 text-primary" : "bg-gray-150 text-gray-650"
                    }`}>
                      {isFd ? "FD" : <User size={12} />}
                    </div>

                    <div className="space-y-1">
                      <div className={`rounded-xl p-3 text-xs leading-relaxed ${
                        isFd 
                          ? "bg-primary text-white font-medium shadow-sm rounded-tr-none" 
                          : msg.isQuickRequest
                            ? "bg-primary-light text-primary-dark border border-primary/20 font-bold rounded-tl-none"
                            : "bg-white text-gray-800 border border-gray-200 rounded-tl-none"
                      }`}>
                        {msg.isQuickRequest && !isFd && (
                          <span className="mb-1 block text-[9px] uppercase tracking-wider opacity-70">Quick request</span>
                        )}
                        {msg.text}
                      </div>
                      
                      <p className={`text-[8px] text-gray-400 font-semibold px-1 ${isFd ? "text-right" : "text-left"}`}>
                        {msg.timestamp}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 space-y-2">
                <MessageSquare size={32} className="text-gray-300" />
                <p className="text-xs italic">No message feeds recorded for Room {selectedRoomNumber}. Send a greeting below.</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply Form */}
          <form onSubmit={handleSendMessage} className="border-t border-gray-200 p-4 flex gap-3 bg-white">
            <input
              type="text"
              required
              disabled={!selectedRoomNumber}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={selectedRoomNumber ? `Type reply statement to Room ${selectedRoomNumber}...` : "Select a room conversation first"}
              className="min-h-[44px] flex-1 rounded-lg border border-gray-250 bg-white px-3 text-xs outline-none focus:border-primary"
            />
            
            <button
              type="submit"
              disabled={!selectedRoomNumber}
              className="min-h-[44px] px-5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm flex items-center gap-1.5 transition active:scale-95"
            >
              <Send size={12} />
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
