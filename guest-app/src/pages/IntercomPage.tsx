import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { 
  Send, Phone, ShoppingBag, MessageSquare, Plus, Minus, Trash2, X, 
  ChevronRight, PhoneOff, Mic, MicOff, AlertCircle, Sparkles, 
  Upload, Info, Check, Loader2
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import config from "@config";
import { db, storage } from "../firebase/config";
import { formatPrice } from "../utils/format";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";

const rtcConfiguration: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// Interfaces
interface Message {
  id: string;
  sender: "guest" | "front-desk";
  text: string;
  timestamp: string;
  isRead?: boolean;
  isQuickRequest?: boolean;
  isStoreOrder?: boolean;
  orderRef?: string;
  isEarlyCheckInRequest?: boolean;
  isCancelledOrder?: boolean;
}

interface StoreItem {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number | null; // null represents unlimited
  imageUrl: string;
}

interface CartItem {
  item: StoreItem;
  quantity: number;
}

interface ActiveOrder {
  orderRef: string;
  items: CartItem[];
  totalAmount: number;
  paymentMethod: string;
  status: "placed" | "confirmed" | "out-for-delivery" | "delivered" | "cancelled";
  estimatedDelivery: string;
}

export function IntercomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Guest Identity States
  const [guestName, setGuestName] = useState<string>("");
  const [showNamePrompt, setShowNamePrompt] = useState<boolean>(true);
  const [nameInput, setNameInput] = useState<string>("");

  // Navigation Tab State
  const [activeTab, setActiveTab] = useState<"chat" | "shop">("chat");

  // Chat States
  const [messages, setMessages] = useState<Message[]>([]);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [typedMessage, setTypedMessage] = useState<string>("");
  const [isRoomLoading, setIsRoomLoading] = useState<boolean>(true);
  const [isValidRoom, setIsValidRoom] = useState<boolean>(false);
  const [roomNumber, setRoomNumber] = useState<string>(roomId || "");
  const [quickRequests, setQuickRequests] = useState<string[]>([]);
  const [isStoreEnabled, setIsStoreEnabled] = useState<boolean>(true);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [messageError, setMessageError] = useState<string>("");
  const [storeError, setStoreError] = useState<string>("");

  // Cart & Shop States
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCartDrawer, setShowCartDrawer] = useState<boolean>(false);
  const [checkoutStep, setCheckoutStep] = useState<"cart" | "payment">("cart");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bill" | "gcash">("cod");
  
  // GCash Screenshot State
  const [gcashFile, setGcashFile] = useState<File | null>(null);
  const [gcashPreview, setGcashPreview] = useState<string | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState<boolean>(false);

  // Active Order Tracker States
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);

  // Voice Call States
  const [callState, setCallState] = useState<"idle" | "requesting" | "ringing" | "connected" | "ended">("idle");
  const [callTimer, setCallTimer] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [callError, setCallError] = useState<string>("");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const guestPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const guestMediaStreamRef = useRef<MediaStream | null>(null);
  const callUnsubscribeRef = useRef<(() => void) | null>(null);
  const iceUnsubscribeRef = useRef<(() => void) | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedIceIdsRef = useRef<Set<string>>(new Set());

  const stopGuestCallResources = () => {
    callUnsubscribeRef.current?.();
    callUnsubscribeRef.current = null;
    iceUnsubscribeRef.current?.();
    iceUnsubscribeRef.current = null;
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    processedIceIdsRef.current.clear();
    guestPeerConnectionRef.current?.close();
    guestPeerConnectionRef.current = null;
    guestMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    guestMediaStreamRef.current = null;
  };

  // Init logic
  useEffect(() => {
    setGuestName("");
    setNameInput("");
    setShowNamePrompt(true);
  }, [roomId]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadRoomAndSettings() {
      if (!roomId) {
        setIsRoomLoading(false);
        setIsValidRoom(false);
        return;
      }

      setIsRoomLoading(true);
      try {
        let resolvedRoomNumber = roomId;
        const directRoom = await getDoc(doc(db, "rooms", roomId));
        if (directRoom.exists()) {
          resolvedRoomNumber = directRoom.data().roomNumber || roomId;
        } else {
          const roomsQuery = query(collection(db, "rooms"), where("roomNumber", "==", roomId), limit(1));
          const roomsSnapshot = await getDocs(roomsQuery);
          if (roomsSnapshot.empty) {
            if (!isMounted) return;
            setIsValidRoom(false);
            setIsRoomLoading(false);
            return;
          }
          resolvedRoomNumber = roomsSnapshot.docs[0].data().roomNumber || roomId;
        }

        const [hotelConfigDoc, storeConfigDoc] = await Promise.all([
          getDoc(doc(db, "settings", "hotelConfig")),
          getDoc(doc(db, "settings", "storeConfig"))
        ]);

        if (!isMounted) return;
        setRoomNumber(resolvedRoomNumber);
        setIsValidRoom(true);
        setQuickRequests(
          hotelConfigDoc.exists() && Array.isArray(hotelConfigDoc.data().intercomQuickRequests)
            ? hotelConfigDoc.data().intercomQuickRequests.filter(Boolean)
            : ["Extra Towels", "Bottled Water", "Room Cleaning", "Extra Pillow", "Do Not Disturb"]
        );
        setIsStoreEnabled(storeConfigDoc.exists() ? storeConfigDoc.data().isEnabled !== false : true);
      } catch (error) {
        console.error("Failed to load intercom room settings:", error);
        if (isMounted) {
          setIsValidRoom(false);
        }
      } finally {
        if (isMounted) {
          setIsRoomLoading(false);
        }
      }
    }

    void loadRoomAndSettings();
    return () => {
      isMounted = false;
    };
  }, [roomId]);

  useEffect(() => {
    if (!isValidRoom || !roomNumber) return;

    const messagesQuery = query(
      collection(db, "intercoms", roomNumber, "messages"),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const liveMessages = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const messageDate = data.timestamp?.toDate ? data.timestamp.toDate() : null;
          return {
            id: docSnap.id,
            sender: data.sender || "guest",
            text: data.text || "",
            timestamp: messageDate
              ? messageDate.toLocaleTimeString(config.locale, { hour: "2-digit", minute: "2-digit" })
              : "",
            isRead: !!data.isRead,
            isQuickRequest: !!data.isQuickRequest,
            isStoreOrder: !!data.isStoreOrder,
            orderRef: data.orderRef || undefined,
            isEarlyCheckInRequest: !!data.isEarlyCheckInRequest
          } satisfies Message;
        });
        setMessages(liveMessages);

        const unreadFrontDeskMessages = liveMessages.filter((message) => message.sender === "front-desk" && !message.isRead);
        unreadFrontDeskMessages.forEach((message) => {
          void updateDoc(doc(db, "intercoms", roomNumber, "messages", message.id), { isRead: true });
        });
      },
      (error) => {
        console.error("Failed to listen to intercom messages:", error);
        setMessageError("We could not load the chat. Please refresh or call the front desk.");
      }
    );

    return unsubscribe;
  }, [isValidRoom, roomNumber]);

  useEffect(() => {
    if (!isStoreEnabled) {
      setStoreItems([]);
      return;
    }

    const storeItemsQuery = query(
      collection(db, "storeItems"),
      where("isActive", "==", true)
    );

    const unsubscribe = onSnapshot(
      storeItemsQuery,
      (snapshot) => {
        setStoreItems(snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              name: data.name || "Store item",
              description: data.description || "",
              price: Number(data.price || 0),
              stock: data.stock ?? null,
              imageUrl: data.imageUrl || data.photoUrl || ""
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)));
      },
      (error) => {
        console.error("Failed to listen to store items:", error);
        setStoreError("The shop could not load items. Please try again later.");
      }
    );

    return unsubscribe;
  }, [isStoreEnabled]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStoreEnabled && activeTab === "shop") {
      setActiveTab("chat");
    }
  }, [activeTab, isStoreEnabled]);

  // Call timer effect
  useEffect(() => {
    let interval: any;
    if (callState === "connected") {
      interval = setInterval(() => {
        setCallTimer(prev => prev + 1);
      }, 1000);
    } else {
      setCallTimer(0);
    }
    return () => clearInterval(interval);
  }, [callState]);

  useEffect(() => {
    return () => {
      stopGuestCallResources();
    };
  }, []);

  const getFormattedTime = () => {
    return new Date().toLocaleTimeString(config.locale, {
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Name Prompt Submission
  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;

    const formattedName = nameInput.trim();
    setGuestName(formattedName);
    setShowNamePrompt(false);
  };

  // Text message sending
  const sendGuestMessage = async (text: string, options?: { isQuickRequest?: boolean; isStoreOrder?: boolean; orderRef?: string; isEarlyCheckInRequest?: boolean }) => {
    if (!roomNumber || !guestName.trim()) return;
    setMessageError("");

    try {
      await setDoc(doc(db, "intercoms", roomNumber), {
        roomId: roomNumber,
        roomNumber,
        guestName,
        resolved: false,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await addDoc(collection(db, "intercoms", roomNumber, "messages"), {
        text,
        sender: "guest",
        guestName,
        timestamp: serverTimestamp(),
        isRead: false,
        isQuickRequest: !!options?.isQuickRequest,
        isStoreOrder: !!options?.isStoreOrder,
        orderRef: options?.orderRef || "",
        isEarlyCheckInRequest: !!options?.isEarlyCheckInRequest
      });
    } catch (error) {
      console.error("Failed to send intercom message:", error);
      setMessageError("Your message was not sent. Please try again or call the front desk.");
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedMessage.trim()) return;

    const nextMessage = typedMessage.trim();
    setTypedMessage("");
    await sendGuestMessage(nextMessage);
  };

  // Quick Request Chips
  const handleQuickRequest = async (requestLabel: string) => {
    await sendGuestMessage(requestLabel, { isQuickRequest: true });
  };

  // Voice Call Signaling Actions
  const handleStartCall = async () => {
    if (!roomNumber || callState !== "idle") return;

    setCallError("");
    setCallState("requesting");

    try {
      const callRef = doc(db, "calls", roomNumber);
      const existingCall = await getDoc(callRef);
      const existingStatus = existingCall.exists() ? existingCall.data().status : "";
      if (existingStatus === "ringing" || existingStatus === "active") {
        setCallError("A front desk call is already active for this room. Please wait or send a message.");
        setCallState("idle");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      guestMediaStreamRef.current = stream;
      setMediaStream(stream);
      setIsMuted(false);

      const peerConnection = new RTCPeerConnection(rtcConfiguration);
      guestPeerConnectionRef.current = peerConnection;
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate) return;
        void addDoc(collection(db, "calls", roomNumber, "iceCandidates"), {
          candidate: event.candidate.toJSON(),
          from: "guest",
          createdAt: serverTimestamp()
        });
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      await setDoc(callRef, {
        offer: {
          type: offer.type,
          sdp: offer.sdp
        },
        answer: null,
        status: "ringing",
        guestName,
        startedAt: serverTimestamp(),
        endedAt: null
      });

      callUnsubscribeRef.current = onSnapshot(callRef, async (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();

        if (data.status === "active") {
          if (callTimeoutRef.current) {
            clearTimeout(callTimeoutRef.current);
            callTimeoutRef.current = null;
          }
          if (data.answer && !peerConnection.currentRemoteDescription) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
          setCallState("connected");
          return;
        }

        if (data.status === "ended") {
          stopGuestCallResources();
          setMediaStream(null);
          setCallState("ended");
          setTimeout(() => setCallState("idle"), 1000);
        }
      });

      iceUnsubscribeRef.current = onSnapshot(
        collection(db, "calls", roomNumber, "iceCandidates"),
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const data = change.doc.data();
            if (data.from !== "staff" || processedIceIdsRef.current.has(change.doc.id)) return;
            processedIceIdsRef.current.add(change.doc.id);
            if (data.candidate) {
              void peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
          });
        }
      );

      callTimeoutRef.current = setTimeout(async () => {
        const latestCall = await getDoc(callRef);
        if (latestCall.exists() && latestCall.data().status === "ringing") {
          await updateDoc(callRef, {
            status: "ended",
            endedAt: serverTimestamp()
          });
          setCallError("No answer from the front desk yet. Please try again or send a message.");
        }
      }, 30000);

      setCallState("ringing");

    } catch (err: any) {
      console.warn("Microphone access denied or not supported:", err);
      stopGuestCallResources();
      setMediaStream(null);
      setCallError("Could not access microphone. Fallback direct calling enabled.");
      setCallState("ended");
      setTimeout(() => {
        setCallState("idle");
      }, 5000);
    }
  };

  const handleEndCall = async () => {
    if (roomNumber) {
      try {
        await updateDoc(doc(db, "calls", roomNumber), {
          status: "ended",
          endedAt: serverTimestamp()
        });
      } catch (error) {
        console.error("Failed to end intercom call:", error);
      }
    }
    stopGuestCallResources();
    setMediaStream(null);
    setCallState("ended");
    setTimeout(() => {
      setCallState("idle");
    }, 1000);
  };

  const toggleMute = () => {
    const activeStream = mediaStream || guestMediaStreamRef.current;
    if (activeStream) {
      activeStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(prev => !prev);
    }
  };

  // Cart operations
  const addToCart = (item: StoreItem) => {
    if (item.stock === 0) return;
    
    setCart(prev => {
      const existing = prev.find(i => i.item.id === item.id);
      if (existing) {
        return prev.map(i => i.item.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateCartQuantity = (itemId: string, amount: number) => {
    setCart(prev => {
      const existing = prev.find(i => i.item.id === itemId);
      if (!existing) return prev;
      
      const newQty = existing.quantity + amount;
      if (newQty <= 0) {
        return prev.filter(i => i.item.id !== itemId);
      }
      return prev.map(i => i.item.id === itemId ? { ...i, quantity: newQty } : i);
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart(prev => prev.filter(i => i.item.id !== itemId));
  };

  const getCartCount = () => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  };

  const getCartSubtotal = () => {
    return cart.reduce((sum, item) => sum + (item.item.price * item.quantity), 0);
  };

  // GCash file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setGcashFile(file);
      setGcashPreview(URL.createObjectURL(file));
    }
  };

  // Order placement
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    if (paymentMethod === "gcash" && !gcashFile) {
      alert("Please upload your GCash payment confirmation screenshot.");
      return;
    }

    setIsUploadingProof(true);
    setStoreError("");

    try {
      let paymentProofUrl = "";
      if (paymentMethod === "gcash" && gcashFile) {
        const proofRef = ref(storage, `store-orders/${roomNumber}/payment-proof/${Date.now()}-${gcashFile.name}`);
        const uploadResult = await uploadBytes(proofRef, gcashFile);
        paymentProofUrl = await getDownloadURL(uploadResult.ref);
      }

      const response = await fetch("/api/store/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: roomNumber,
          roomNumber,
          guestName,
          items: cart.map(({ item, quantity }) => ({ itemId: item.id, quantity })),
          paymentMethod: paymentMethod === "bill" ? "add-to-bill" : paymentMethod,
          paymentProofUrl
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to place store order.");
      }

      setIsUploadingProof(false);
      const orderRef = result.data.orderRef;
      const total = result.data.totalAmount;
      const itemsText = cart.map(i => `${i.quantity}x ${i.item.name}`).join(", ");
      
      const paymentLabels: Record<string, string> = {
        cod: "Cash on Delivery",
        bill: "Room Bill",
        gcash: "GCash Transfer"
      };

      const newOrder: ActiveOrder = {
        orderRef,
        items: [...cart],
        totalAmount: total,
        paymentMethod: paymentLabels[paymentMethod],
        status: "placed",
        estimatedDelivery: "15-20 mins"
      };

      setActiveOrder(newOrder);

      void sendGuestMessage(
        `Ordered items: ${itemsText}. Total: ${formatPrice(total)} via ${paymentLabels[paymentMethod]}. Ref: ${orderRef}`,
        { isStoreOrder: true, orderRef }
      );

      // Clean cart drawer and states
      setCart([]);
      setGcashFile(null);
      setGcashPreview(null);
      setShowCartDrawer(false);
      setCheckoutStep("cart");
    } catch (error: any) {
      console.error("Failed to place store order:", error);
      setStoreError(error.message || "Unable to place order. Please try again.");
      setIsUploadingProof(false);
    }
  };

  // Cancel order
  const handleCancelOrder = () => {
    if (!activeOrder) return;

    const updatedOrder: ActiveOrder = {
      ...activeOrder,
      status: "cancelled"
    };

    setActiveOrder(updatedOrder);

    void sendGuestMessage(`Cancelled Order Ref: ${activeOrder.orderRef}`, {
      isStoreOrder: true,
      orderRef: activeOrder.orderRef
    });
  };

  // Debug tracker simulation
  const handleSimulateNextStatus = () => {
    if (!activeOrder) return;
    
    const statusSequence: ActiveOrder["status"][] = ["placed", "confirmed", "out-for-delivery", "delivered"];
    const currentIndex = statusSequence.indexOf(activeOrder.status);
    
    if (currentIndex !== -1 && currentIndex < statusSequence.length - 1) {
      const nextStatus = statusSequence[currentIndex + 1];
      
      const statusLabels: Record<string, string> = {
        confirmed: "Confirmed & Packing",
        "out-for-delivery": "Out for Delivery",
        delivered: "Delivered successfully"
      };

      const updatedOrder: ActiveOrder = {
        ...activeOrder,
        status: nextStatus
      };
      
      setActiveOrder(updatedOrder);

      void statusLabels[nextStatus];
    }
  };

  const getStatusStepIndex = (status: ActiveOrder["status"]) => {
    if (status === "placed") return 0;
    if (status === "confirmed") return 1;
    if (status === "out-for-delivery") return 2;
    if (status === "delivered") return 3;
    return -1; // Cancelled
  };

  const displayMessages: Message[] = messages.length > 0
    ? messages
    : [
        {
          id: "local-welcome",
          sender: "front-desk",
          text: `Mabuhay${guestName ? ` ${guestName}` : ""}! You're connected to the front desk for Room ${roomNumber || roomId || "guest"}. How can we help?`,
          timestamp: getFormattedTime(),
          isRead: true
        }
      ];

  if (isRoomLoading) {
    return (
      <main className="min-h-screen bg-gray-100 flex justify-center items-stretch font-body">
        <div className="w-full max-w-md bg-white shadow-2xl flex flex-col border-x border-gray-200">
          <div className="bg-gray-950 p-4 space-y-3">
            <div className="h-9 w-44 rounded bg-white/10 animate-pulse" />
            <div className="h-4 w-64 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="flex-1 p-4 space-y-4">
            <div className="h-16 w-4/5 rounded-2xl bg-gray-100 animate-pulse" />
            <div className="h-14 w-2/3 rounded-2xl bg-gray-100 animate-pulse ml-auto" />
            <div className="h-16 w-3/4 rounded-2xl bg-gray-100 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  if (!isValidRoom) {
    return (
      <main className="min-h-screen bg-gray-100 flex justify-center items-center font-body p-6">
        <div className="w-full max-w-md rounded-card-lg bg-white p-6 text-center shadow-xl ring-1 ring-gray-200">
          <div className="mx-auto h-12 w-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
            <AlertCircle size={24} />
          </div>
          <h1 className="mt-4 font-heading text-2xl lowercase text-gray-950">Invalid room QR code</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            This intercom link does not match an active room. Please call or visit the front desk so we can help you.
          </p>
          <a
            href={`tel:${config.frontDeskPhone}`}
            className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-5 text-sm font-bold text-white"
          >
            Call Front Desk
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 flex justify-center items-stretch font-body">
      {/* Mobile viewport container */}
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col justify-between relative overflow-hidden border-x border-gray-200">
        
        {/* Call Banner / Overlay */}
        {callState !== "idle" && (
          <div className="absolute inset-0 bg-gray-950/95 backdrop-blur-md z-45 flex flex-col justify-between p-8 text-white text-center">
            {/* Top row */}
            <div className="pt-8">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-xs font-semibold uppercase tracking-wider text-primary">
                <Sparkles size={12} />
                {config.brandName} Call
              </span>
              <p className="mt-6 text-xl font-heading tracking-tight lowercase">
                Room {roomNumber || roomId || "Guest"}
              </p>
            </div>

            {/* Middle status */}
            <div className="flex flex-col items-center gap-4 my-auto">
              <div className="relative flex items-center justify-center">
                {/* Ringing waves */}
                {(callState === "ringing" || callState === "requesting") && (
                  <div className="absolute h-32 w-32 rounded-full border border-primary/40 animate-ping" />
                )}
                <div className="h-24 w-24 rounded-full bg-primary flex items-center justify-center ring-4 ring-white/10 relative z-10 shadow-lg">
                  <Phone size={36} className="text-white" />
                </div>
              </div>
              
              <div className="mt-4 space-y-1">
                {callState === "requesting" && (
                  <p className="text-sm text-gray-400 font-semibold animate-pulse">Requesting media...</p>
                )}
                {callState === "ringing" && (
                  <p className="text-lg font-bold tracking-wide text-white animate-pulse">Ringing Front Desk...</p>
                )}
                {callState === "connected" && (
                  <>
                    <p className="text-lg font-bold tracking-wide text-green-400">Connected</p>
                    <p className="text-2xl font-mono mt-2 font-medium">
                      {Math.floor(callTimer / 60)}:{(callTimer % 60).toString().padStart(2, "0")}
                    </p>
                  </>
                )}
                {callState === "ended" && (
                  <p className="text-lg font-bold text-red-500">Call Ended</p>
                )}
              </div>
            </div>

            {/* Bottom Controls */}
            <div className="pb-8 space-y-4">
              <div className="flex justify-center gap-6">
                {callState === "connected" && (
                  <button
                    onClick={toggleMute}
                    className={`h-14 w-14 rounded-full flex items-center justify-center shadow-md active:scale-95 transition ${
                      isMuted ? "bg-white text-gray-900" : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                  >
                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                )}
                <button
                  onClick={handleEndCall}
                  className="h-14 w-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-md active:scale-95 transition"
                >
                  <PhoneOff size={20} />
                </button>
              </div>
              <p className="text-[10px] text-gray-500 font-medium">
                P2P Local Voice Connection
              </p>
            </div>
          </div>
        )}

        {/* Global Page Header */}
        <header className="bg-gray-950 text-white p-4 shadow-sm z-30 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary font-bold">
                {roomId || "G"}
              </div>
              <div>
                <h1 className="font-bold text-sm leading-tight text-white">Room {roomNumber || roomId || "Guest"}</h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${isOffline ? "bg-amber-400" : "bg-green-500 animate-pulse"}`} />
                  <span className="text-[10px] text-gray-400 font-semibold tracking-wide">
                    {isOffline ? "Offline - reconnecting" : "Connected to Front Desk"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleStartCall}
                className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark active:scale-[0.98] text-xs font-semibold text-white shadow-sm transition"
              >
                <Phone size={14} />
                Call Desk
              </button>
            </div>
          </div>

          {/* Fallback error message if mic permission fails */}
          {callError && (
            <div className="rounded bg-red-950/80 border border-red-800 p-2.5 text-[11px] text-red-200 flex gap-2 items-start animate-fade-in">
              <AlertCircle size={14} className="shrink-0 text-red-400 mt-0.5" />
              <div>
                <p className="font-semibold">{callError}</p>
                <p className="mt-1">
                  Direct Line:{" "}
                  <a href={`tel:${config.frontDeskPhone}`} className="underline font-bold text-white">
                    {config.frontDeskPhone}
                  </a>
                </p>
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex border-t border-white/10 pt-2.5 mt-1">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 pb-1.5 text-center text-xs font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${
                activeTab === "chat" 
                  ? "border-primary text-primary" 
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              <MessageSquare size={14} />
              Chat Support
            </button>
            {isStoreEnabled && (
              <button
                onClick={() => setActiveTab("shop")}
                className={`flex-1 pb-1.5 text-center text-xs font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${
                  activeTab === "shop"
                    ? "border-primary text-primary"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                <ShoppingBag size={14} />
                {config.storeName}
              </button>
            )}
          </div>
        </header>

        {/* Tab Page Contents */}
        <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-hidden relative">
          
          {/* Active Chat Tab */}
          {activeTab === "chat" && (
            <div className="flex-1 flex flex-col justify-between min-h-0">
              
              {/* Message scroll thread */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 select-text">
                {isOffline && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    You're offline. New messages will sync when your connection returns.
                  </div>
                )}

                {messageError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {messageError}
                  </div>
                )}

                {displayMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-[85%] ${
                      msg.sender === "guest" ? "ml-auto items-end" : "mr-auto items-start"
                    }`}
                  >
                    {/* Message Bubble */}
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed ${
                        msg.sender === "guest"
                          ? msg.isStoreOrder
                            ? "bg-primary-light text-primary-dark border border-primary/20 rounded-tr-none font-medium"
                            : msg.isQuickRequest
                              ? "bg-primary-light text-primary-dark border border-primary/20 rounded-tr-none font-bold"
                              : msg.isCancelledOrder
                                ? "bg-red-50 text-red-700 border border-red-200 rounded-tr-none font-medium"
                                : "bg-primary text-white rounded-tr-none"
                          : "bg-white text-gray-900 border border-gray-200 rounded-tl-none"
                      }`}
                    >
                      {msg.isQuickRequest && (
                        <span className="mb-1 block text-[10px] uppercase tracking-wider opacity-70">Quick request</span>
                      )}
                      {msg.text}
                    </div>

                    {/* Timestamp */}
                    <span className="text-[10px] text-gray-400 font-medium mt-1 px-1">
                      {msg.timestamp}
                    </span>
                  </div>
                ))}

                <div ref={messagesEndRef} />
              </div>

              {/* Chat footer with quick requests and free-text inputs */}
              <div className="bg-white border-t border-gray-150 p-3.5 space-y-3">
                
                {/* Quick requests drawer row */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Quick Requests</p>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none snap-x">
                    {quickRequests.map((req) => (
                      <button
                        key={req}
                        onClick={() => handleQuickRequest(req)}
                        className="snap-start shrink-0 min-h-[32px] px-3.5 rounded-full border border-gray-250 bg-white hover:bg-gray-50 active:scale-95 text-[11px] font-semibold text-gray-700 shadow-sm transition"
                      >
                        {req}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Standard Free text form */}
                <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Type your request here..."
                    value={typedMessage}
                    onChange={(e) => setTypedMessage(e.target.value)}
                    required
                    className="flex-1 min-h-[44px] rounded-lg border border-gray-200 bg-gray-50/50 py-2 px-3.5 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-light"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] w-12 rounded-lg bg-primary hover:bg-primary-dark active:scale-[0.98] text-white flex items-center justify-center shadow-sm transition shrink-0"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>

            </div>
          )}

          {/* Active Store Tab */}
          {activeTab === "shop" && (
            <div className="flex-1 flex flex-col justify-between overflow-y-auto p-4 space-y-6">
              
              {/* Active Delivery Status Tracker (If Order Exists) */}
              {activeOrder && (
                <div className="rounded-card bg-gradient-to-br from-primary-light/40 to-primary-light/10 border border-primary/20 p-5 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-mono text-primary-dark font-bold uppercase tracking-wider">
                        Active In-Room Delivery
                      </p>
                      <h3 className="font-heading text-lg lowercase mt-0.5">
                        Ref: {activeOrder.orderRef}
                      </h3>
                    </div>
                    <span className="text-xs bg-primary/20 text-primary-dark font-bold px-2 py-0.5 rounded">
                      {activeOrder.status.replace("-", " ")}
                    </span>
                  </div>

                  {activeOrder.status !== "cancelled" ? (
                    <div className="space-y-4">
                      {/* Stepper tracker */}
                      <div className="relative flex justify-between items-center mt-2 px-2">
                        {/* Connecting track line */}
                        <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-200 -translate-y-1/2 z-0" />
                        <div 
                          className="absolute top-1/2 left-0 h-1 bg-primary -translate-y-1/2 z-0 transition-all duration-500" 
                          style={{ width: `${(getStatusStepIndex(activeOrder.status) / 3) * 100}%` }}
                        />

                        {/* Step Dots */}
                        {["Placed", "Confirmed", "On Way", "Delivered"].map((step, idx) => {
                          const activeIdx = getStatusStepIndex(activeOrder.status);
                          const isDone = idx <= activeIdx;
                          return (
                            <div key={step} className="relative z-10 flex flex-col items-center gap-1">
                              <div 
                                className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition ${
                                  isDone 
                                    ? "bg-primary border-primary text-white" 
                                    : "bg-white border-gray-200 text-gray-400"
                                }`}
                              >
                                {isDone ? <Check size={10} /> : idx + 1}
                              </div>
                              <span className="text-[9px] font-bold text-gray-500">{step}</span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-gray-600 bg-white/50 p-2.5 rounded-lg border border-primary/10">
                        <Info size={14} className="text-primary" />
                        <span>Est. Delivery: <strong>{activeOrder.estimatedDelivery}</strong></span>
                      </div>

                      {/* Controls to simulate or cancel */}
                      <div className="flex gap-2 pt-1.5 justify-end">
                        {activeOrder.status === "placed" && (
                          <button
                            type="button"
                            onClick={handleCancelOrder}
                            className="min-h-[36px] px-3 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                          >
                            Cancel Order
                          </button>
                        )}
                        {activeOrder.status !== "delivered" && (
                          <button
                            type="button"
                            onClick={handleSimulateNextStatus}
                            className="min-h-[36px] px-3.5 rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary-dark transition flex items-center gap-1"
                          >
                            Simulate Progress
                            <ChevronRight size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-red-700 font-medium">
                      This order was cancelled. Your bill has been adjusted.
                    </div>
                  )}
                </div>
              )}

              {/* Shop Header Intro */}
              <div className="space-y-1.5">
                <h2 className="text-xl font-heading tracking-tight lowercase text-primary flex items-center gap-1.5">
                  <ShoppingBag size={20} />
                  {config.storeName}
                </h2>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Browse amenities and local Bohol goods. Items will be delivered directly to Room {roomId || ""}.
                </p>
              </div>

              {/* Items Grid */}
              <div className="grid gap-4 sm:grid-cols-2">
                {storeError && (
                  <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {storeError}
                  </div>
                )}

                {storeItems.length === 0 && !storeError && (
                  <div className="sm:col-span-2 rounded-card bg-white p-6 text-center shadow-sm ring-1 ring-gray-200">
                    <ShoppingBag size={28} className="mx-auto text-gray-300" />
                    <p className="mt-3 text-sm font-bold text-gray-900">The shop is currently unavailable.</p>
                    <p className="mt-1 text-xs text-gray-500">Please send a chat message for anything you need.</p>
                  </div>
                )}

                {storeItems.map((item) => {
                  const cartQty = cart.find(i => i.item.id === item.id)?.quantity || 0;
                  const isOutOfStock = item.stock === 0;

                  return (
                    <div
                      key={item.id}
                      className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between gap-3 transition hover:shadow-md"
                    >
                      <div className="space-y-2">
                        {/* Image placeholder simulation */}
                        <div className="h-28 w-full rounded-lg overflow-hidden bg-gray-100 border border-gray-100 relative">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-primary-light text-primary">
                              <ShoppingBag size={24} />
                            </div>
                          )}
                          <div className="absolute top-2 left-2">
                            {isOutOfStock ? (
                              <span className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-700 ring-1 ring-inset ring-red-600/10">
                                Out of Stock
                              </span>
                            ) : item.stock !== null ? (
                              <span className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/10">
                                {item.stock} Left
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded bg-green-50 px-1.5 py-0.5 text-[9px] font-bold text-green-700 ring-1 ring-inset ring-green-600/10">
                                Available
                              </span>
                            )}
                          </div>
                        </div>

                        <div>
                          <h3 className="text-sm font-bold text-gray-900 leading-snug">{item.name}</h3>
                          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{item.description}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                        <span className="text-sm font-bold text-gray-900">
                          {formatPrice(item.price)}
                        </span>

                        {isOutOfStock ? (
                          <button
                            disabled
                            className="min-h-[32px] px-3.5 rounded-lg bg-gray-100 text-xs font-semibold text-gray-400 cursor-not-allowed"
                          >
                            Sold Out
                          </button>
                        ) : cartQty > 0 ? (
                          <div className="flex items-center gap-2.5 bg-primary-light px-2 py-1.5 rounded-lg border border-primary/20">
                            <button
                              type="button"
                              onClick={() => updateCartQuantity(item.id, -1)}
                              className="text-primary hover:text-primary-dark"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="text-xs font-bold text-primary-dark">{cartQty}</span>
                            <button
                              type="button"
                              onClick={() => addToCart(item)}
                              className="text-primary hover:text-primary-dark"
                              disabled={item.stock !== null && cartQty >= item.stock}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addToCart(item)}
                            className="min-h-[32px] px-3.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom margin buffer */}
              <div className="h-14 shrink-0" />
            </div>
          )}

        </div>

        {/* Floating Cart Panel (Triggers Drawer) */}
        {activeTab === "shop" && getCartCount() > 0 && !showCartDrawer && (
          <div className="absolute bottom-4 left-4 right-4 bg-gray-950 text-white p-3.5 rounded-xl shadow-lg z-30 flex justify-between items-center animate-fade-in border border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center relative">
                <ShoppingBag size={16} />
                <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-[9px] font-bold text-white flex items-center justify-center">
                  {getCartCount()}
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-300">My Basket</p>
                <p className="text-sm font-bold text-white mt-0.5">{formatPrice(getCartSubtotal())}</p>
              </div>
            </div>

            <button
              onClick={() => {
                setCheckoutStep("cart");
                setShowCartDrawer(true);
              }}
              className="min-h-[36px] px-4 rounded-lg bg-primary hover:bg-primary-dark active:scale-[0.98] text-xs font-semibold text-white shadow-sm transition flex items-center gap-1"
            >
              Checkout
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Name Registration Modal Prompt */}
        {showNamePrompt && (
          <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="w-full bg-white rounded-card-lg p-6 shadow-2xl border border-gray-150 space-y-6">
              <div className="text-center space-y-1.5">
                <div className="h-12 w-12 rounded-full bg-primary-light flex items-center justify-center mx-auto text-primary">
                  <Sparkles size={24} />
                </div>
                <h2 className="font-heading text-2xl tracking-tight text-gray-950 mt-4 lowercase">
                  Welcome to {config.brandName}
                </h2>
                <p className="text-xs text-gray-600">
                  Please introduce yourself to start your chat session with the front desk.
                </p>
              </div>

              <form onSubmit={handleNameSubmit} className="space-y-4">
                <label className="grid gap-2 text-xs font-semibold text-gray-700">
                  What is your name?
                  <input
                    type="text"
                    required
                    placeholder="e.g. Maria Santos"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 px-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:bg-white"
                  />
                </label>

                <PrimaryButton type="submit" className="w-full text-sm font-semibold">
                  Start Chatting
                </PrimaryButton>
              </form>
            </div>
          </div>
        )}

        {/* Shopping Cart Drawer Sheet */}
        {showCartDrawer && (
          <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-sm z-40 flex items-end">
            <div className="w-full bg-white rounded-t-card-lg max-h-[85vh] overflow-y-auto flex flex-col justify-between shadow-2xl border-t border-gray-150">
              
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-150">
                <h3 className="font-bold text-sm text-gray-900">
                  {checkoutStep === "cart" ? "Your Basket" : "Payment & Checkout"}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCartDrawer(false)}
                  className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 transition"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Step 1: Cart listing */}
              {checkoutStep === "cart" && (
                <div className="p-5 flex-1 overflow-y-auto space-y-4">
                  <div className="divide-y divide-gray-100">
                    {cart.map((item) => (
                      <div key={item.item.id} className="py-3.5 flex justify-between items-center gap-3">
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-gray-900">{item.item.name}</p>
                          <p className="text-xs text-gray-500 font-medium">
                            {formatPrice(item.item.price)} each
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2.5 bg-gray-100 px-2 py-1.5 rounded-lg border border-gray-200">
                            <button
                              type="button"
                              onClick={() => updateCartQuantity(item.item.id, -1)}
                              className="text-gray-500 hover:text-gray-950"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="text-xs font-bold text-gray-800">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateCartQuantity(item.item.id, 1)}
                              className="text-gray-500 hover:text-gray-950"
                              disabled={item.item.stock !== null && item.quantity >= item.item.stock}
                            >
                              <Plus size={12} />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeFromCart(item.item.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-150 pt-4 space-y-3">
                    <div className="flex justify-between text-sm font-semibold">
                      <span className="text-gray-600">Total Items:</span>
                      <span className="text-gray-950">{getCartCount()}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold">
                      <span className="text-gray-900 font-heading lowercase">Total to Pay:</span>
                      <span className="text-primary-dark">{formatPrice(getCartSubtotal())}</span>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      type="button"
                      onClick={() => setCheckoutStep("payment")}
                      className="w-full min-h-[44px] rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm flex items-center justify-center gap-1.5 transition active:scale-95"
                    >
                      Choose Payment Method
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Payment Selector */}
              {checkoutStep === "payment" && (
                <form onSubmit={handleCheckoutSubmit} className="p-5 flex-1 space-y-6">
                  {/* Payment selection list */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Payment Option</p>
                    
                    {/* COD Option */}
                    <label 
                      className={`block rounded-lg border p-3.5 cursor-pointer relative transition ${
                        paymentMethod === "cod" 
                          ? "border-primary bg-primary-light/10" 
                          : "border-gray-250 hover:bg-gray-50"
                      }`}
                    >
                      <input 
                        type="radio" 
                        name="payment"
                        value="cod"
                        checked={paymentMethod === "cod"}
                        onChange={() => setPaymentMethod("cod")}
                        className="sr-only"
                      />
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-gray-900">Cash on Delivery (COD)</p>
                          <p className="text-[10px] text-gray-500 font-medium mt-0.5">Pay cash when items are delivered.</p>
                        </div>
                        {paymentMethod === "cod" && <div className="h-4 w-4 rounded-full bg-primary border-2 border-white ring-2 ring-primary shrink-0" />}
                      </div>
                    </label>

                    {/* Add to Bill Option */}
                    <label 
                      className={`block rounded-lg border p-3.5 cursor-pointer relative transition ${
                        paymentMethod === "bill" 
                          ? "border-primary bg-primary-light/10" 
                          : "border-gray-250 hover:bg-gray-50"
                      }`}
                    >
                      <input 
                        type="radio" 
                        name="payment"
                        value="bill"
                        checked={paymentMethod === "bill"}
                        onChange={() => setPaymentMethod("bill")}
                        className="sr-only"
                      />
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-gray-900">Charge to Room Bill</p>
                          <p className="text-[10px] text-gray-500 font-medium mt-0.5">Bill collected during your final hotel checkout.</p>
                        </div>
                        {paymentMethod === "bill" && <div className="h-4 w-4 rounded-full bg-primary border-2 border-white ring-2 ring-primary shrink-0" />}
                      </div>
                    </label>

                    {/* GCash Option */}
                    <label 
                      className={`block rounded-lg border p-3.5 cursor-pointer relative transition ${
                        paymentMethod === "gcash" 
                          ? "border-primary bg-primary-light/10" 
                          : "border-gray-250 hover:bg-gray-50"
                      }`}
                    >
                      <input 
                        type="radio" 
                        name="payment"
                        value="gcash"
                        checked={paymentMethod === "gcash"}
                        onChange={() => setPaymentMethod("gcash")}
                        className="sr-only"
                      />
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-gray-900">GCash Mobile Wallet</p>
                          <p className="text-[10px] text-gray-500 font-medium mt-0.5">Instant transfer. Proof upload required.</p>
                        </div>
                        {paymentMethod === "gcash" && <div className="h-4 w-4 rounded-full bg-primary border-2 border-white ring-2 ring-primary shrink-0" />}
                      </div>
                    </label>
                  </div>

                  {/* Bill Warning banner */}
                  {paymentMethod === "bill" && (
                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3.5 text-[11px] text-blue-800 flex gap-2">
                      <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                      <p>
                        This order will be registered to your room folio. Payment will be collected along with room taxes at the front desk when checking out.
                      </p>
                    </div>
                  )}

                  {/* GCash details and file upload layout */}
                  {paymentMethod === "gcash" && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-4">
                      <div className="text-center space-y-1.5">
                        <p className="text-xs font-bold text-gray-700">GCash Transfer Details</p>
                        <p className="text-sm font-bold text-primary-dark">0917 000 0000</p>
                        <p className="text-[10px] text-gray-500">Account: {config.legalName}</p>
                      </div>

                      {/* Mock File Uploader */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Upload Receipt screenshot</p>
                        
                        {gcashPreview ? (
                          <div className="relative rounded-lg overflow-hidden border border-gray-200 max-h-36 flex justify-center bg-black">
                            <img src={gcashPreview} alt="GCash Proof" className="h-full object-contain" />
                            <button
                              type="button"
                              onClick={() => {
                                setGcashFile(null);
                                setGcashPreview(null);
                              }}
                              className="absolute top-2 right-2 h-7 w-7 rounded-full bg-red-600 text-white flex items-center justify-center shadow"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg h-28 hover:bg-gray-100 cursor-pointer transition">
                            <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                              <Upload size={20} className="text-gray-400 mb-1.5" />
                              <p className="text-xs font-semibold text-gray-600">Click to upload image</p>
                              <p className="text-[9px] text-gray-400 mt-0.5">JPG, PNG up to 5MB</p>
                            </div>
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={handleFileChange}
                              required
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3 pt-2">
                    <GhostButton 
                      type="button" 
                      onClick={() => setCheckoutStep("cart")}
                      className="flex-1 text-xs font-semibold border-gray-200 text-gray-700 hover:bg-gray-50 min-h-[44px]"
                    >
                      Back
                    </GhostButton>
                    <PrimaryButton
                      type="submit"
                      disabled={isUploadingProof}
                      className="flex-[2] text-xs font-semibold min-h-[44px]"
                    >
                      {isUploadingProof ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <Loader2 className="animate-spin h-4 w-4" />
                          Submitting Order...
                        </span>
                      ) : (
                        `Place Order (${formatPrice(getCartSubtotal())})`
                      )}
                    </PrimaryButton>
                  </div>
                </form>
              )}

            </div>
          </div>
        )}

      </div>
    </main>
  );
}
