import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { 
  Send, Phone, ShoppingBag, MessageSquare, Plus, Minus, Trash2, X, 
  ChevronRight, PhoneOff, Mic, MicOff, AlertCircle, Sparkles, 
  Upload, Info, Check, HelpCircle, Loader2
} from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { formatPrice } from "../utils/format";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";

// Interfaces
interface Message {
  id: string;
  sender: "guest" | "staff";
  text: string;
  timestamp: string;
  isQuickRequest?: boolean;
  isStoreOrder?: boolean;
  orderRef?: string;
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

const mockStoreItems: StoreItem[] = [
  {
    id: "item-1",
    name: "San Miguel Pale Pilsen (Can)",
    description: "Ice-cold local Filipino pilsner beer, 330ml.",
    price: 120,
    stock: 15,
    imageUrl: "https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&q=80&w=256&h=256"
  },
  {
    id: "item-2",
    name: "Spark Bottled Mineral Water",
    description: "Premium purified drinking water in an eco-friendly glass bottle.",
    price: 60,
    stock: null, // Unlimited
    imageUrl: "https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&q=80&w=256&h=256"
  },
  {
    id: "item-3",
    name: "Bohol Peanut Kisses",
    description: "Famous crisp Bohol peanut cookies shaped like Chocolate Hills.",
    price: 80,
    stock: 5,
    imageUrl: "https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&q=80&w=256&h=256"
  },
  {
    id: "item-4",
    name: "Branded Beach Towel",
    description: "Extra large micro-fiber beach towel with premium hotel embroidering.",
    price: 450,
    stock: 0, // Out of stock
    imageUrl: "https://images.unsplash.com/photo-1576426863848-c28f0ca9ca68?auto=format&fit=crop&q=80&w=256&h=256"
  }
];

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
  const [typedMessage, setTypedMessage] = useState<string>("");
  const [typingState, setTypingState] = useState<boolean>(false);

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

  // Init logic
  useEffect(() => {
    const savedName = sessionStorage.getItem("intercom_guest_name");
    if (savedName) {
      setGuestName(savedName);
      setShowNamePrompt(false);
      initializeChat(savedName);
    }
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingState]);

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

  // Initialize Chat Thread with welcome message
  const initializeChat = (name: string) => {
    const defaultMessages: Message[] = [
      {
        id: "welcome-1",
        sender: "staff",
        text: `Mabuhay ${name}! Welcome to ${config.brandName}. This is the Front Desk. How can we help you in Room ${roomId || "guest"} today?`,
        timestamp: getFormattedTime()
      }
    ];
    setMessages(defaultMessages);
  };

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
    sessionStorage.setItem("intercom_guest_name", formattedName);
    setShowNamePrompt(false);
    initializeChat(formattedName);
  };

  // Text message sending
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedMessage.trim()) return;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      sender: "guest",
      text: typedMessage.trim(),
      timestamp: getFormattedTime()
    };

    setMessages(prev => [...prev, newMessage]);
    setTypedMessage("");

    // Simulate front desk reply
    triggerFrontDeskAutoReply(
      `Thank you, ${guestName}. We have received your message and a front desk agent will get back to you shortly.`
    );
  };

  // Quick Request Chips
  const handleQuickRequest = (requestLabel: string) => {
    const newMessage: Message = {
      id: `req-${Date.now()}`,
      sender: "guest",
      text: `Requested: ${requestLabel}`,
      timestamp: getFormattedTime(),
      isQuickRequest: true
    };

    setMessages(prev => [...prev, newMessage]);

    // Simulate custom replies per request type
    let responseText = `Received! We have dispatched our housekeeping team to deliver ${requestLabel} to Room ${roomId || ""} shortly. Let us know if you need anything else.`;
    if (requestLabel === "Do Not Disturb") {
      responseText = "Understood. We have updated your room status to Do Not Disturb and notified the housekeeping crew.";
    } else if (requestLabel === "Room Cleaning") {
      responseText = "Housekeeping team has been scheduled for your room. They will arrive shortly to clean your room.";
    }

    triggerFrontDeskAutoReply(responseText);
  };

  // Simulate auto response
  const triggerFrontDeskAutoReply = (replyText: string) => {
    setTypingState(true);
    setTimeout(() => {
      setTypingState(false);
      setMessages(prev => [
        ...prev,
        {
          id: `reply-${Date.now()}`,
          sender: "staff",
          text: replyText,
          timestamp: getFormattedTime()
        }
      ]);
    }, 2000);
  };

  // Voice Call Simulation Actions
  const handleStartCall = async () => {
    setCallError("");
    setCallState("requesting");

    try {
      // Prompt for real microphone permission to show hardware interactivity
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMediaStream(stream);
      
      setCallState("ringing");
      // Simulate ringing period
      setTimeout(() => {
        setCallState("connected");
      }, 3000);

    } catch (err: any) {
      console.warn("Microphone access denied or not supported:", err);
      setCallError(`Could not access microphone. Fallback direct calling enabled.`);
      setCallState("ended");
      
      // Auto dismiss ended state after 5 seconds to show tel: link fallback
      setTimeout(() => {
        setCallState("idle");
      }, 5000);
    }
  };

  const handleEndCall = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    setCallState("ended");
    setTimeout(() => {
      setCallState("idle");
    }, 1000);
  };

  const toggleMute = () => {
    if (mediaStream) {
      mediaStream.getAudioTracks().forEach(track => {
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
  const handleCheckoutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    if (paymentMethod === "gcash" && !gcashFile) {
      alert("Please upload your GCash payment confirmation screenshot.");
      return;
    }

    setIsUploadingProof(true);

    setTimeout(() => {
      setIsUploadingProof(false);
      const orderRef = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
      const total = getCartSubtotal();
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

      // Post order summary message into chat thread
      const orderMessage: Message = {
        id: `ord-msg-${Date.now()}`,
        sender: "guest",
        text: `🛒 Ordered items: ${itemsText}. Total: ${formatPrice(total)} via ${paymentLabels[paymentMethod]}. Ref: ${orderRef}`,
        timestamp: getFormattedTime(),
        isStoreOrder: true,
        orderRef
      };

      setMessages(prev => [...prev, orderMessage]);

      // Trigger automatic front desk confirmation response
      triggerFrontDeskAutoReply(
        `Order received! Reference ${orderRef} is placed and our team is gathering your items for delivery to Room ${roomId || ""}.`
      );

      // Clean cart drawer and states
      setCart([]);
      setGcashFile(null);
      setGcashPreview(null);
      setShowCartDrawer(false);
      setCheckoutStep("cart");
    }, 1500);
  };

  // Cancel order
  const handleCancelOrder = () => {
    if (!activeOrder) return;

    const updatedOrder: ActiveOrder = {
      ...activeOrder,
      status: "cancelled"
    };

    setActiveOrder(updatedOrder);

    // Post cancel message to thread
    const cancelMessage: Message = {
      id: `ord-cancel-${Date.now()}`,
      sender: "guest",
      text: `🚫 Cancelled Order Ref: ${activeOrder.orderRef}`,
      timestamp: getFormattedTime(),
      isCancelledOrder: true,
      orderRef: activeOrder.orderRef
    };

    setMessages(prev => [...prev, cancelMessage]);

    triggerFrontDeskAutoReply(
      `Understood. Order ${activeOrder.orderRef} has been cancelled successfully.`
    );
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

      // Trigger status update message from staff
      setMessages(prev => [
        ...prev,
        {
          id: `status-update-${Date.now()}`,
          sender: "staff",
          text: `📦 Update on order ${activeOrder.orderRef}: Status changed to "${statusLabels[nextStatus]}".`,
          timestamp: getFormattedTime()
        }
      ]);
    }
  };

  const getStatusStepIndex = (status: ActiveOrder["status"]) => {
    if (status === "placed") return 0;
    if (status === "confirmed") return 1;
    if (status === "out-for-delivery") return 2;
    if (status === "delivered") return 3;
    return -1; // Cancelled
  };

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
                Room {roomId || "Guest"}
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
                <h1 className="font-bold text-sm leading-tight text-white">Room {roomId || "Guest"}</h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-[10px] text-gray-400 font-semibold tracking-wide">Connected to Front Desk</span>
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
          </div>
        </header>

        {/* Tab Page Contents */}
        <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-hidden relative">
          
          {/* Active Chat Tab */}
          {activeTab === "chat" && (
            <div className="flex-1 flex flex-col justify-between min-h-0">
              
              {/* Message scroll thread */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 select-text">
                {messages.map((msg) => (
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
                            : msg.isCancelledOrder
                              ? "bg-red-50 text-red-700 border border-red-200 rounded-tr-none font-medium"
                              : "bg-primary text-white rounded-tr-none"
                          : "bg-white text-gray-900 border border-gray-200 rounded-tl-none"
                      }`}
                    >
                      {msg.text}
                    </div>

                    {/* Timestamp */}
                    <span className="text-[10px] text-gray-400 font-medium mt-1 px-1">
                      {msg.timestamp}
                    </span>
                  </div>
                ))}

                {/* Typing status indicator */}
                {typingState && (
                  <div className="flex flex-col items-start mr-auto max-w-[85%]">
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-none px-4 py-3 flex gap-1 items-center shadow-sm">
                      <span className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              {/* Chat footer with quick requests and free-text inputs */}
              <div className="bg-white border-t border-gray-150 p-3.5 space-y-3">
                
                {/* Quick requests drawer row */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Quick Requests</p>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none snap-x">
                    {["Extra Towels", "Bottled Water", "Room Cleaning", "Extra Pillow", "Do Not Disturb"].map((req) => (
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
                {mockStoreItems.map((item) => {
                  const cartQty = cart.find(i => i.item.id === item.id)?.quantity || 0;
                  const isOutOfStock = item.stock === 0;

                  return (
                    <div
                      key={item.id}
                      className="rounded-card bg-white p-4.5 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between gap-3 transition hover:shadow-md"
                    >
                      <div className="space-y-2">
                        {/* Image placeholder simulation */}
                        <div className="h-28 w-full rounded-lg overflow-hidden bg-gray-100 border border-gray-100 relative">
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
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
