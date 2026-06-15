import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useAdmin, IntercomMessage, StoreOrder } from "../context/AdminContext";
import { formatPrice } from "../utils/format";
import { 
  MessageSquare, Send, PhoneOff, Phone,
  ArchiveRestore, CheckCheck, CheckCircle2, User, Radio, RotateCcw, Volume2, Mic, ShoppingBag, ExternalLink
} from "lucide-react";
import config from "@config";

const paymentLabels: Record<StoreOrder["paymentMethod"], string> = {
  cod: "Cash on delivery",
  "add-to-bill": "Room bill",
  gcash: "GCash"
};

function StoreOrderMessageCard({ message, order }: { message: IntercomMessage; order?: StoreOrder }) {
  const itemRows = order?.items ?? [];
  const orderRef = order?.orderRef || message.orderRef || "Pending ref";
  const paymentLabel = order ? paymentLabels[order.paymentMethod] : "See order";
  const bookingPath = `/bookings?tab=store${orderRef ? `&orderRef=${encodeURIComponent(orderRef)}` : ""}`;

  return (
    <div className="w-full max-w-md rounded-xl border border-primary/20 bg-primary-light/30 p-3 text-xs text-gray-800 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-primary shadow-sm ring-1 ring-primary/10">
            <ShoppingBag size={15} />
          </span>
          <div>
            <span className="block text-[9px] font-bold uppercase tracking-wider text-primary-dark">Store order</span>
            <p className="font-bold text-gray-950">{orderRef}</p>
          </div>
        </div>
        {order?.status && (
          <span className="rounded-full border border-primary/20 bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-dark">
            {order.status.replace(/-/g, " ")}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2 rounded-lg bg-white/70 p-2 ring-1 ring-primary/10">
        {itemRows.length > 0 ? (
          itemRows.map((item) => (
            <div key={`${item.itemId}-${item.name}`} className="flex items-start justify-between gap-3">
              <span className="font-semibold text-gray-700">{item.quantity}x {item.name}</span>
              <span className="font-bold text-gray-950">{formatPrice(item.price * item.quantity)}</span>
            </div>
          ))
        ) : (
          <p className="text-[11px] font-semibold text-gray-650">{message.text}</p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-lg bg-white/70 px-2 py-1.5 ring-1 ring-primary/10">
          <span className="block font-bold uppercase tracking-wider text-gray-400">Payment</span>
          <span className="font-bold text-gray-850">{paymentLabel}</span>
        </div>
        <div className="rounded-lg bg-white/70 px-2 py-1.5 text-right ring-1 ring-primary/10">
          <span className="block font-bold uppercase tracking-wider text-gray-400">Total</span>
          <span className="font-bold text-primary-dark">{order ? formatPrice(order.totalAmount) : "View order"}</span>
        </div>
      </div>

      <Link
        to={bookingPath}
        className="mt-3 inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white transition hover:bg-primary-dark"
      >
        View Order
        <ExternalLink size={11} />
      </Link>
    </div>
  );
}

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

  // Active chat selection
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string>("");
  const [threadFilter, setThreadFilter] = useState<"active" | "resolved">("active");
  const [replyText, setReplyText] = useState("");
  const [isInboxFocused, setIsInboxFocused] = useState(!document.hidden && document.hasFocus());
  const [isNotificationAudioUnlocked, setIsNotificationAudioUnlocked] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const notificationBufferRef = useRef<AudioBuffer | null>(null);
  const notificationInitializedRef = useRef(false);
  const previousUnreadGuestIdsRef = useRef<Set<string>>(new Set());
  const previousRingingCallKeyRef = useRef("");

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
    if (selectedRoomNumber && filteredRooms.some((room) => room.roomNumber === selectedRoomNumber)) return;
    setSelectedRoomNumber(filteredRooms[0]?.roomNumber || "");
  }, [filteredRooms, selectedRoomNumber]);

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
      playNotificationSound();
    }

    notificationInitializedRef.current = true;
    previousUnreadGuestIdsRef.current = currentUnreadGuestIds;
  }, [isInboxFocused, unreadGuestMessages]);

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

        {/* Right: Message dialog box */}
        <div className="rounded-card bg-white shadow-sm ring-1 ring-gray-200 flex flex-col justify-between overflow-hidden min-h-[460px]">
          {/* Header */}
          <div className="bg-gray-50/50 border-b border-gray-200 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                {selectedRoomNumber || "--"}
              </div>
              <div>
                <h3 className="font-bold text-xs text-gray-900 leading-none">Intercom Feed Room {selectedRoomNumber || "unselected"}</h3>
                <span className="text-[9px] text-gray-400 capitalize mt-1 inline-block">
                  {isSelectedThreadResolved ? "Resolved conversation" : "Active stay room link"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold border px-2 py-0.5 rounded ${
                isSelectedThreadResolved
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-primary/20 bg-primary/5 text-primary-dark"
              }`}>
                <CheckCheck size={10} />
                {isSelectedThreadResolved ? "Resolved" : "Operational feed online"}
              </span>

              <button
                type="button"
                disabled={!selectedRoomNumber}
                onClick={() => void handleToggleResolved()}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[10px] font-bold text-gray-700 transition hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSelectedThreadResolved ? <RotateCcw size={12} /> : <ArchiveRestore size={12} />}
                {isSelectedThreadResolved ? "Reopen" : "Mark Resolved"}
              </button>
            </div>
          </div>

          {/* Message History Viewport */}
          <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[340px] bg-gray-50/20">
            {activeChatMessages.length > 0 ? (
              activeChatMessages.map((msg) => {
                const isFd = msg.sender === "front-desk";
                const storeOrder = msg.orderRef ? storeOrdersByRef.get(msg.orderRef) : undefined;

                return (
                  <div key={msg.id} className={`flex gap-3 max-w-[85%] ${isFd ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      isFd ? "bg-primary/10 text-primary" : "bg-gray-150 text-gray-650"
                    }`}>
                      {isFd ? "FD" : <User size={12} />}
                    </div>

                    <div className="space-y-1">
                      {msg.isStoreOrder && !isFd ? (
                        <StoreOrderMessageCard message={msg} order={storeOrder} />
                      ) : (
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
                      )}
                      
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
                <p className="text-xs italic">
                  {selectedRoomNumber
                    ? `No message feeds recorded for Room ${selectedRoomNumber}. Send a greeting below.`
                    : `No ${threadFilter} conversations to show.`}
                </p>
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
