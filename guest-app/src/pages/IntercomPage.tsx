import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Send, Phone, ShoppingBag, MessageSquare, Plus, Minus, Trash2, X,
  ChevronRight, PhoneOff, Mic, MicOff, AlertCircle, Sparkles,
  Upload, Info, Check, Loader2, Search
} from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
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
import { ref, uploadBytes } from "firebase/storage";
import config from "@config";
import { db, storage } from "../firebase/config";
import { formatPrice } from "../utils/format";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { getEffectiveStorePaymentMethods, type EffectiveStorePaymentMethod } from "@spark-inn/shared";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  category: StoreCategory;
  description: string;
  price: number;
  stock: number | null; // null represents unlimited
  imageUrl: string;
}

// GSD-01: store item categories are owned by the admin catalog
// (SettingsPage → Store). The guest client mirrors the same 5-value
// union with a stable label map so chip text stays consistent with
// what staff see when editing items. Legacy/missing values fall
// back to "other" (see `normalizeStoreCategory` in
// `admin-app/src/context/AdminContext.tsx` for the matching
// server-side normalization).
type StoreCategory = "drinks" | "snacks" | "toiletries" | "rentals" | "other";

const STORE_CATEGORY_VALUES: readonly StoreCategory[] = [
  "drinks",
  "snacks",
  "toiletries",
  "rentals",
  "other"
] as const;

const STORE_CATEGORY_LABELS: Record<StoreCategory, string> = {
  drinks: "Drinks",
  snacks: "Snacks",
  toiletries: "Toiletries",
  rentals: "Rentals",
  other: "Other"
};

const STORE_CATEGORY_LABEL_ORDER: readonly StoreCategory[] = [
  "drinks",
  "snacks",
  "toiletries",
  "rentals",
  "other"
] as const;

function normalizeStoreCategory(value: unknown): StoreCategory {
  return STORE_CATEGORY_VALUES.includes(value as StoreCategory)
    ? (value as StoreCategory)
    : "other";
}

interface CartItem {
  item: StoreItem;
  quantity: number;
}

// The store payment method key — see `EffectiveStorePaymentMethod`
// (re-exported from `@spark-inn/shared`) for the full union
// shape. The key is owned by Settings → Payment Methods and can be
// any configured store-visible method (`cod`, `add-to-bill`,
// `gcash`, `maya`, etc.). The type stays `string` so the
// order-create API can accept any configured key.
type StorePaymentMethod = string;

// Renamed for clarity — used to render the per-method payment
// details panel (QR + account info + screenshot upload) for any
// non-`cod`/non-`add-to-bill` method. The legacy 3-key
// `StorePaymentMethodConfig` interface is preserved as an alias
// for backwards compat with the rest of the file.
type StorePaymentMethodConfig = EffectiveStorePaymentMethod;

interface ActiveOrder {
  orderId: string;
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
  const [currentStayId, setCurrentStayId] = useState<string>("");
  const [isVerifyingGuest, setIsVerifyingGuest] = useState<boolean>(false);
  const [verificationError, setVerificationError] = useState<string>("");

  // Navigation Tab State
  const [activeTab, setActiveTab] = useState<"chat" | "shop">("chat");

  // Chat States
  const INITIAL_MESSAGE_LIMIT = 50;
  const LOAD_MORE_STEP = 30;

  const [messages, setMessages] = useState<Message[]>([]);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [messageLimit, setMessageLimit] = useState(INITIAL_MESSAGE_LIMIT);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [typedMessage, setTypedMessage] = useState<string>("");
  const [isRoomLoading, setIsRoomLoading] = useState<boolean>(true);
  const [isValidRoom, setIsValidRoom] = useState<boolean>(false);
  const [roomAccessError, setRoomAccessError] = useState<"invalid" | "vacant" | "">("");
  const [roomNumber, setRoomNumber] = useState<string>(roomId || "");
  const [quickRequests, setQuickRequests] = useState<string[]>([]);
  const [isStoreEnabled, setIsStoreEnabled] = useState<boolean>(true);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [messageError, setMessageError] = useState<string>("");
  const [storeError, setStoreError] = useState<string>("");
  const [unreadFromFrontDesk, setUnreadFromFrontDesk] = useState(0);

  // Cart & Shop States
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCartDrawer, setShowCartDrawer] = useState<boolean>(false);
  const [checkoutStep, setCheckoutStep] = useState<"cart" | "payment">("cart");
  const [paymentMethod, setPaymentMethod] = useState<StorePaymentMethod>("cod");
  const [storePaymentMethods, setStorePaymentMethods] = useState<StorePaymentMethodConfig[]>([
    { method: "cod", label: "Cash on Delivery", isEnabled: true, source: "payment" },
    { method: "add-to-bill", label: "Room Bill", isEnabled: true, source: "payment" },
    { method: "gcash", label: "GCash Wallet", isEnabled: true, source: "payment" }
  ]);

  // GSD-01 (Store Catalog Discovery) — search + category filter
  // state. Lives at the IntercomPage scope (not inside the Shop
  // sub-tree) so it survives Shop/Chat/cart/checkout view
  // switches, and is independent from the `cart` state so adding
  // or removing items never clears the active filter.
  const [storeSearch, setStoreSearch] = useState<string>("");
  const [storeCategoryFilter, setStoreCategoryFilter] = useState<StoreCategory | "all">("all");

  // GSD-01: client-side filter + sort derived from the existing
  // real-time item snapshot — typing and category changes issue no
  // additional Firestore reads. Search matches name + description,
  // trimmed and case-insensitive; combined with the category chip
  // via AND. Sort groups in-stock items (alphabetical) before
  // out-of-stock items (alphabetical).
  const filteredStoreItems = useMemo(() => {
    const normalizedQuery = storeSearch.trim().toLowerCase();
    const filtered = storeItems.filter((item) => {
      if (storeCategoryFilter !== "all" && item.category !== storeCategoryFilter) {
        return false;
      }
      if (normalizedQuery.length > 0) {
        const haystack = `${item.name} ${item.description}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return false;
        }
      }
      return true;
    });

    const isInStock = (item: StoreItem) => item.stock === null || item.stock > 0;
    return [...filtered].sort((a, b) => {
      const aInStock = isInStock(a);
      const bInStock = isInStock(b);
      if (aInStock !== bInStock) {
        return aInStock ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [storeItems, storeSearch, storeCategoryFilter]);

  // GSD-01: only render category chips for categories that
  // actually exist in the live store catalog. Order follows
  // STORE_CATEGORY_LABEL_ORDER so the chip rail stays stable
  // (All → Drinks → Snacks → Toiletries → Rentals → Other).
  const representedStoreCategories = useMemo<StoreCategory[]>(() => {
    const present = new Set<StoreCategory>();
    for (const item of storeItems) {
      present.add(item.category);
    }
    return STORE_CATEGORY_LABEL_ORDER.filter((category) => present.has(category));
  }, [storeItems]);

  const hasActiveStoreFilters = storeSearch.trim().length > 0 || storeCategoryFilter !== "all";

  const clearStoreFilters = () => {
    setStoreSearch("");
    setStoreCategoryFilter("all");
  };
  
  // Payment proof screenshot state — used for any non-`cod` /
  // non-`add-to-bill` method (GCash, Maya, PayPal, etc.). The state
  // variables keep the legacy `gcash*` prefix for backwards
  // compat with the checkout submit handler and the per-method
  // panel; the field is just used generically now.
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
  const guestRemoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const guestAudioContextRef = useRef<AudioContext | null>(null);
  const ringbackIntervalRef = useRef<any>(null);
  const callUnsubscribeRef = useRef<(() => void) | null>(null);
  const iceUnsubscribeRef = useRef<(() => void) | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedIceIdsRef = useRef<Set<string>>(new Set());
  const pendingIceCandidatesRef = useRef<RTCIceCandidate[]>([]);

  const playGuestRingbackTone = () => {
    try {
      if (!guestAudioContextRef.current) {
        guestAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = guestAudioContextRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      const now = ctx.currentTime;
      const frequencies = [440, 480];
      const duration = 1.5;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.06, now + 0.05);
      gainNode.gain.setValueAtTime(0.06, now + duration - 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      const oscs = frequencies.map((freq) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now);
        osc.connect(gainNode);
        return osc;
      });

      gainNode.connect(ctx.destination);

      oscs.forEach((osc) => {
        osc.start(now);
        osc.stop(now + duration);
      });
    } catch (e) {
      console.warn("Failed to play guest ringback tone:", e);
    }
  };

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
    pendingIceCandidatesRef.current = [];
    guestPeerConnectionRef.current?.close();
    guestPeerConnectionRef.current = null;
    guestMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    guestMediaStreamRef.current = null;
    if (guestRemoteAudioRef.current) {
      guestRemoteAudioRef.current.pause();
      guestRemoteAudioRef.current.srcObject = null;
      guestRemoteAudioRef.current = null;
    }
    if (ringbackIntervalRef.current) {
      clearInterval(ringbackIntervalRef.current);
      ringbackIntervalRef.current = null;
    }
  };

  // Init logic
  useEffect(() => {
    setGuestName("");
    setNameInput("");
    setCurrentStayId("");
    setVerificationError("");
    setRoomAccessError("");
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
        setRoomAccessError("invalid");
        return;
      }

      setIsRoomLoading(true);
      try {
        let resolvedRoomNumber = roomId;
        let resolvedRoomStatus = "";
        const directRoom = await getDoc(doc(db, "rooms", roomId));
        if (directRoom.exists()) {
          const roomData = directRoom.data();
          resolvedRoomNumber = roomData.roomNumber || roomId;
          resolvedRoomStatus = roomData.status || "";
        } else {
          const roomsQuery = query(collection(db, "rooms"), where("roomNumber", "==", roomId), limit(1));
          const roomsSnapshot = await getDocs(roomsQuery);
          if (!roomsSnapshot.empty) {
            const roomData = roomsSnapshot.docs[0].data();
            resolvedRoomNumber = roomData.roomNumber || roomId;
            resolvedRoomStatus = roomData.status || "";
          } else {
            const tokenQuery = query(collection(db, "rooms"), where("qrToken", "==", roomId), limit(1));
            const tokenSnapshot = await getDocs(tokenQuery);
            if (tokenSnapshot.empty) {
              if (!isMounted) return;
              setIsValidRoom(false);
              setRoomAccessError("invalid");
              setIsRoomLoading(false);
              return;
            }
            const roomData = tokenSnapshot.docs[0].data();
            resolvedRoomNumber = roomData.roomNumber || roomId;
            resolvedRoomStatus = roomData.status || "";
          }
          if (!resolvedRoomNumber) {
            if (!isMounted) return;
            setIsValidRoom(false);
            setRoomAccessError("invalid");
            setIsRoomLoading(false);
            return;
          }
        }

        if (resolvedRoomStatus !== "occupied") {
          if (!isMounted) return;
          setRoomNumber(resolvedRoomNumber);
          setIsValidRoom(false);
          setRoomAccessError("vacant");
          setIsRoomLoading(false);
          return;
        }

        const [hotelConfigDoc, storeConfigDoc] = await Promise.all([
          getDoc(doc(db, "settings", "hotelConfig")),
          getDoc(doc(db, "settings", "storeConfig"))
        ]);

        if (!isMounted) return;
        setRoomNumber(resolvedRoomNumber);
        setIsValidRoom(true);
        setRoomAccessError("");
        setQuickRequests(
          hotelConfigDoc.exists() && Array.isArray(hotelConfigDoc.data().intercomQuickRequests)
            ? hotelConfigDoc.data().intercomQuickRequests.filter(Boolean)
            : ["Extra Towels", "Bottled Water", "Room Cleaning", "Extra Pillow", "Do Not Disturb"]
        );
        const hotelConfigData = hotelConfigDoc.exists() ? hotelConfigDoc.data() : null;
        const storeConfig = storeConfigDoc.exists() ? storeConfigDoc.data() : null;
        setIsStoreEnabled(storeConfig ? storeConfig.isEnabled !== false : true);
        const paymentMethods = Array.isArray(hotelConfigData?.paymentMethods)
          ? hotelConfigData.paymentMethods
          : [];
        const effective = getEffectiveStorePaymentMethods(paymentMethods);
        setStorePaymentMethods(effective);
        if (effective.length > 0) {
          setPaymentMethod(effective[0].method);
        } else {
          setPaymentMethod("");
        }

        const cachedVerification = localStorage.getItem(`intercomVerified:${resolvedRoomNumber}`);
        if (cachedVerification) {
          try {
            const parsed = JSON.parse(cachedVerification) as { bookingId?: string; guestName?: string };
            if (parsed.bookingId) {
              const response = await fetch("/api/intercom/verify-guest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomNumber: resolvedRoomNumber, bookingId: parsed.bookingId })
              });
              const result = await response.json();
              if (response.ok && result.success && result.data?.bookingId && isMounted) {
                setCurrentStayId(result.data.bookingId);
                setGuestName(parsed.guestName || "Guest");
                setShowNamePrompt(false);
              }
            }
          } catch {
            localStorage.removeItem(`intercomVerified:${resolvedRoomNumber}`);
          }
        }
      } catch (error) {
        console.error("Failed to load intercom room settings:", error);
        if (isMounted) {
          setIsValidRoom(false);
          setRoomAccessError("invalid");
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
    if (!isValidRoom || !roomNumber || !currentStayId || showNamePrompt) return;

    const messagesQuery = query(
      collection(db, "intercoms", roomNumber, "messages"),
      orderBy("timestamp", "asc"),
      limit(messageLimit)
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const liveMessages = snapshot.docs.flatMap((docSnap) => {
          const data = docSnap.data();
          if (data.currentStayId !== currentStayId) return [];
          const messageDate = data.timestamp?.toDate ? data.timestamp.toDate() : null;
          return [{
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
          } satisfies Message];
        });

        setAllMessagesLoaded(snapshot.docs.length < messageLimit);
        setMessages(liveMessages);

        // Only mark as read when guest is on the Chat tab
        if (activeTab === "chat") {
          const unreadFrontDeskMessages = liveMessages.filter(
            (message) => message.sender === "front-desk" && !message.isRead
          );
          unreadFrontDeskMessages.forEach((message) => {
            void updateDoc(doc(db, "intercoms", roomNumber, "messages", message.id), { isRead: true });
          });
          setUnreadFromFrontDesk(0);
        } else {
          // On Shop tab — count unread for the pulse indicator
          const count = liveMessages.filter(
            (message) => message.sender === "front-desk" && !message.isRead
          ).length;
          setUnreadFromFrontDesk(count);
        }
      },
      (error) => {
        console.error("Failed to listen to intercom messages:", error);
        setMessageError("We could not load the chat. Please refresh or call the front desk.");
      }
    );

    return unsubscribe;
  }, [isValidRoom, roomNumber, currentStayId, showNamePrompt, messageLimit, activeTab]);

  // Mark unread FD messages as read when guest switches to Chat tab
  useEffect(() => {
    if (activeTab !== "chat" || !roomNumber || !isValidRoom || !currentStayId) return;
    const unreadOnChat = messages.filter((m) => m.sender === "front-desk" && !m.isRead);
    if (unreadOnChat.length === 0) return;
    unreadOnChat.forEach((message) => {
      void updateDoc(doc(db, "intercoms", roomNumber, "messages", message.id), { isRead: true });
    });
    setUnreadFromFrontDesk(0);
  }, [activeTab, messages, roomNumber, isValidRoom, currentStayId]);

  const handleLoadMore = () => {
    setMessageLimit((prev) => prev + LOAD_MORE_STEP);
  };

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
              // GSD-01: keep `category` on the guest item; fall back
              // to "other" for legacy items missing the field. The
              // matching admin-side normalizer lives in
              // `AdminContext.tsx → normalizeStoreCategory`.
              category: normalizeStoreCategory(data.category),
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

  useEffect(() => {
    if (!activeOrder || !roomNumber || activeOrder.status === "delivered" || activeOrder.status === "cancelled") return;

    const { orderId, orderRef } = activeOrder;
    let isCancelled = false;

    const refreshOrderStatus = async () => {
      try {
        const response = await fetch("/api/store/order-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, orderRef, roomNumber })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to refresh order status.");
        }

        if (isCancelled) return;
        const nextStatus = result.data?.status as ActiveOrder["status"] | undefined;
        if (!nextStatus || !["placed", "confirmed", "out-for-delivery", "delivered", "cancelled"].includes(nextStatus)) return;
        setActiveOrder((currentOrder) => (
          currentOrder?.orderId === orderId
            ? { ...currentOrder, status: nextStatus }
            : currentOrder
        ));
      } catch (error) {
        console.error("Failed to refresh store order status:", error);
      }
    };

    void refreshOrderStatus();
    const refreshInterval = window.setInterval(() => {
      void refreshOrderStatus();
    }, 10000);

    return () => {
      isCancelled = true;
      window.clearInterval(refreshInterval);
    };
  }, [activeOrder?.orderId, activeOrder?.orderRef, activeOrder?.status, roomNumber]);

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
    if (callState === "ringing" || callState === "requesting") {
      if (!ringbackIntervalRef.current) {
        playGuestRingbackTone();
        ringbackIntervalRef.current = setInterval(() => {
          playGuestRingbackTone();
        }, 4500);
      }
    } else {
      if (ringbackIntervalRef.current) {
        clearInterval(ringbackIntervalRef.current);
        ringbackIntervalRef.current = null;
      }
    }

    return () => {
      if (ringbackIntervalRef.current) {
        clearInterval(ringbackIntervalRef.current);
        ringbackIntervalRef.current = null;
      }
    };
  }, [callState]);

  useEffect(() => {
    return () => {
      stopGuestCallResources();
      if (guestAudioContextRef.current) {
        void guestAudioContextRef.current.close();
        guestAudioContextRef.current = null;
      }
    };
  }, []);

  const getFormattedTime = () => {
    return new Date().toLocaleTimeString(config.locale, {
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const canSendGuestMessage = () => {
    if (!roomNumber) return false;
    const now = Date.now();
    const key = `intercomRate:${roomNumber}`;
    try {
      const recent = JSON.parse(localStorage.getItem(key) || "[]")
        .filter((value: unknown) => typeof value === "number" && now - value < 10 * 60 * 1000);
      if (recent.length >= 30) return false;
      recent.push(now);
      localStorage.setItem(key, JSON.stringify(recent));
    } catch {
      return true;
    }
    return true;
  };

  // Name Prompt Submission
  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lastName = nameInput.trim();
    if (!lastName || !roomNumber) return;

    setIsVerifyingGuest(true);
    setVerificationError("");
    try {
      const response = await fetch("/api/intercom/verify-guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomNumber, lastName })
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.data?.bookingId) {
        throw new Error(result.error || "We could not verify this room.");
      }

      const verifiedGuestName = result.data.guestName || lastName;
      setCurrentStayId(result.data.bookingId);
      setGuestName(verifiedGuestName);
      localStorage.setItem(`intercomVerified:${roomNumber}`, JSON.stringify({
        bookingId: result.data.bookingId,
        guestName: verifiedGuestName
      }));
      setShowNamePrompt(false);
    } catch (error: any) {
      setVerificationError(error?.message || "We could not verify this room.");
    } finally {
      setIsVerifyingGuest(false);
    }
  };

  // Text message sending
  const sendGuestMessage = async (text: string, options?: { isQuickRequest?: boolean; isStoreOrder?: boolean; orderRef?: string; isEarlyCheckInRequest?: boolean; isCancelledOrder?: boolean }) => {
    if (!roomNumber || !guestName.trim() || !currentStayId) return;
    setMessageError("");
    if (!canSendGuestMessage()) {
      setMessageError("Too many messages sent from this room. Please wait a few minutes or call the front desk.");
      return;
    }

    // G-04 (E2E audit 2026-07-17): guest messages are now routed
    // through the rate-limited API endpoint instead of direct
    // Firestore writes. Firestore rules block guest creates.
    try {
      const response = await fetch("/api/intercom/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomNumber,
          guestName,
          currentStayId,
          text,
          isQuickRequest: !!options?.isQuickRequest,
          isStoreOrder: !!options?.isStoreOrder,
          orderRef: options?.orderRef || "",
          isEarlyCheckInRequest: !!options?.isEarlyCheckInRequest,
          isCancelledOrder: !!options?.isCancelledOrder
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Message was not sent.");
      }
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
    if (!roomNumber || !currentStayId || callState !== "idle") return;

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
      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        const remoteAudio = guestRemoteAudioRef.current ?? new Audio();
        remoteAudio.autoplay = true;
        remoteAudio.srcObject = remoteStream;
        guestRemoteAudioRef.current = remoteAudio;
        void remoteAudio.play().catch(() => {
          // Browser autoplay policy can still require guest interaction.
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
            // Flush pending ICE candidates once remoteDescription is set
            while (pendingIceCandidatesRef.current.length > 0) {
              const candidate = pendingIceCandidatesRef.current.shift();
              if (candidate) {
                void peerConnection.addIceCandidate(candidate).catch((err) => {
                  console.warn("Failed to add queued ICE candidate:", err);
                });
              }
            }
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
              const cand = new RTCIceCandidate(data.candidate);
              if (peerConnection.remoteDescription) {
                void peerConnection.addIceCandidate(cand).catch((err) => {
                  console.warn("Failed to add ICE candidate directly:", err);
                });
              } else {
                pendingIceCandidatesRef.current.push(cand);
              }
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
        // Per W2.10 / decision #98: delete the call doc after a 30s
        // grace period (both sides have observed status: "ended").
        // Prevents the calls collection from growing unboundedly.
        setTimeout(() => {
          if (roomNumber) {
            deleteDoc(doc(db, "calls", roomNumber)).catch((err) => {
              console.error("Error deleting call doc:", err);
            });
          }
        }, 30000);
      } catch (error) {
        console.error("Error ending call:", error);
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

  // Methods that don't require a payment proof upload. The
  // `cod` (cash on delivery) and `add-to-bill` (room folio)
  // methods are store-specific and never need a screenshot;
  // every other configured method (GCash, Maya, PayPal, etc.)
  // is an "online" payment that requires the guest to upload
  // proof of transfer before the order can be placed. Mirrors
  // the server-side check in
  // `guest-app/server/handlers/store.ts`.
  const isOnlinePaymentMethod = (method: string) => method !== "cod" && method !== "add-to-bill";

  const getPaymentLabel = (method: StorePaymentMethod) => {
    const configuredMethod = storePaymentMethods.find(payment => payment.method === method);
    if (configuredMethod?.label) return configuredMethod.label;
    if (method === "cod") return "Cash on Delivery";
    if (method === "add-to-bill") return "Add to Room Bill";
    if (method === "gcash") return "GCash Transfer";
    if (method === "maya") return "Maya Transfer";
    if (method === "paypal") return "PayPal";
    if (method === "bank") return "Bank Transfer";
    return method;
  };

  // Currently-selected method's config — used to render the
  // payment details panel (QR + account info + screenshot
  // upload) for any non-`cod`/non-`add-to-bill` method. Empty
  // when no method is selected.
  const currentPaymentMethodConfig = storePaymentMethods.find(method => method.method === paymentMethod);

  // GCash file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!ACCEPTED_UPLOAD_TYPES.has(file.type)) {
        setStoreError("Please upload a JPG, PNG, or WEBP receipt image.");
        e.target.value = "";
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setStoreError("Please upload a receipt image that is 5MB or smaller.");
        e.target.value = "";
        return;
      }
      setStoreError("");
      setGcashFile(file);
      setGcashPreview(URL.createObjectURL(file));
    }
  };

  // Order placement
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    if (!storePaymentMethods.some(method => method.method === paymentMethod)) {
      setStoreError("That payment method is no longer available. Please choose another option.");
      return;
    }

    // Any non-`cod`/non-`add-to-bill` method requires a payment
    // proof screenshot. The variable name keeps the legacy
    // `gcashFile` for backwards compat — the field is just
    // used generically now (works for GCash, Maya, PayPal,
    // bank transfer, etc.).
    if (isOnlinePaymentMethod(paymentMethod) && !gcashFile) {
      alert("Please upload your payment confirmation screenshot.");
      return;
    }

    setIsUploadingProof(true);
    setStoreError("");

    try {
      let paymentProofPath = "";
      if (isOnlinePaymentMethod(paymentMethod) && gcashFile) {
        const extension = gcashFile.name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? "";
        const proofRef = ref(storage, `store-orders/${roomNumber}/payment-proof/${crypto.randomUUID()}${extension}`);
        const uploadResult = await uploadBytes(proofRef, gcashFile);
        paymentProofPath = uploadResult.ref.fullPath;
      }

      const response = await fetch("/api/store/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: roomNumber,
          roomNumber,
          guestName,
          items: cart.map(({ item, quantity }) => ({ itemId: item.id, quantity })),
          paymentMethod,
          paymentProofPath
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
      const paymentLabel = getPaymentLabel(paymentMethod);

      const newOrder: ActiveOrder = {
        orderId: result.data.orderId,
        orderRef,
        items: [...cart],
        totalAmount: total,
        paymentMethod: paymentLabel,
        status: "placed",
        estimatedDelivery: "15-20 mins"
      };

      setActiveOrder(newOrder);

      void sendGuestMessage(
        `Ordered items: ${itemsText}. Total: ${formatPrice(total)} via ${paymentLabel}. Ref: ${orderRef}`,
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
  const handleCancelOrder = async () => {
    if (!activeOrder) return;

    setStoreError("");

    try {
      const response = await fetch("/api/store/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: activeOrder.orderId,
          orderRef: activeOrder.orderRef,
          roomNumber,
          cancellationReason: "Guest cancelled from intercom"
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to cancel store order.");
      }

      const updatedOrder: ActiveOrder = {
        ...activeOrder,
        status: "cancelled"
      };

      setActiveOrder(updatedOrder);

      void sendGuestMessage(`Cancelled Order Ref: ${activeOrder.orderRef}`, {
        isStoreOrder: true,
        isCancelledOrder: true,
        orderRef: activeOrder.orderRef
      });
    } catch (error: any) {
      console.error("Failed to cancel store order:", error);
      setStoreError(error.message || "Unable to cancel order. Please contact the front desk.");
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
      <main className="h-[100dvh] bg-gray-100 flex justify-center items-stretch font-body">
        <div className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col border-x border-gray-200">
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
    const isVacantRoom = roomAccessError === "vacant";
    return (
      <main className="h-[100dvh] bg-gray-100 flex justify-center items-center font-body p-6">
        <div className="w-full max-w-md rounded-card-lg bg-white p-6 text-center shadow-xl ring-1 ring-gray-200">
          <div className="mx-auto h-12 w-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
            <AlertCircle size={24} />
          </div>
          <h1 className="mt-4 font-heading text-2xl lowercase text-gray-950">
            {isVacantRoom ? "Intercom not active yet" : "Invalid room QR code"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            {isVacantRoom
              ? "This room intercom opens after check-in. Please call or visit the front desk so we can help you."
              : "This intercom link does not match an active room. Please call or visit the front desk so we can help you."}
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
    <main className="h-[100dvh] bg-gray-100 flex justify-center items-stretch font-body">
      {/* Mobile viewport container */}
      <div className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col justify-between relative overflow-hidden border-x border-gray-200">
        
        {/* Call Banner / Overlay */}
        {callState !== "idle" && (
          <div
            className="absolute inset-0 bg-gray-950/95 backdrop-blur-md z-50 flex flex-col justify-between px-8 py-6 text-white text-center"
            style={{
              paddingTop: "max(1.5rem, env(safe-area-inset-top))",
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))"
            }}
          >
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
            <div className="space-y-4">
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
              <div className="h-9 w-9 shrink-0 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-xs text-primary font-bold overflow-hidden">
                {roomNumber || "G"}
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
          <div className="flex gap-2 border-t border-white/10 pt-3 mt-1">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 min-h-[44px] rounded-lg text-center text-sm font-bold transition flex items-center justify-center gap-2 relative ${
                activeTab === "chat" 
                  ? "bg-primary text-white shadow-sm"
                  : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <MessageSquare size={18} />
              Chat Support
              {unreadFromFrontDesk > 0 && activeTab !== "chat" && (
                <span className="absolute -top-1 right-2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white shadow-sm animate-pulse">
                  {unreadFromFrontDesk > 9 ? "9+" : unreadFromFrontDesk}
                </span>
              )}
            </button>
            {isStoreEnabled && (
              <button
                onClick={() => setActiveTab("shop")}
                className={`flex-1 min-h-[44px] rounded-lg text-center text-sm font-bold transition flex items-center justify-center gap-2 ${
                  activeTab === "shop"
                    ? "bg-primary text-white shadow-sm"
                    : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <ShoppingBag size={18} />
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

                {!allMessagesLoaded && messages.length >= messageLimit && (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    className="mx-auto block min-h-[32px] px-4 rounded-lg border border-gray-200 bg-white text-[10px] font-bold text-gray-500 hover:bg-gray-50 hover:text-primary transition"
                  >
                    Load earlier messages
                  </button>
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
                
                {quickRequests.length > 0 && (
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
                )}

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

                      {activeOrder.status === "placed" && (
                        <div className="flex gap-2 pt-1.5 justify-end">
                          <button
                            type="button"
                            onClick={handleCancelOrder}
                            className="min-h-[36px] px-3 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                          >
                            Cancel Order
                          </button>
                        </div>
                      )}
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
                  Browse amenities and local Bohol goods. Items will be delivered directly to Room {roomNumber || roomId || ""}.
                </p>
              </div>

              {/* GSD-01: Catalog Discovery — search + category chips
                  + result count + clear-all. Hidden while the live
                  catalog is still empty so the unavailable/empty
                  empty-state copy stays the single source of truth
                  in that case. */}
              {storeItems.length > 0 && (
                <div className="space-y-2.5">
                  <div className="relative">
                    <Search
                      size={14}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="search"
                      inputMode="search"
                      value={storeSearch}
                      onChange={(event) => setStoreSearch(event.target.value)}
                      placeholder="Search the shop"
                      aria-label="Search the shop"
                      className="w-full min-h-[44px] rounded-lg border border-gray-200 bg-white pl-9 pr-9 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                    />
                    {storeSearch.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setStoreSearch("")}
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {representedStoreCategories.length > 0 && (
                    <div
                      role="tablist"
                      aria-label="Filter shop by category"
                      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={storeCategoryFilter === "all"}
                        aria-pressed={storeCategoryFilter === "all"}
                        onClick={() => setStoreCategoryFilter("all")}
                        className={`min-h-[44px] shrink-0 rounded-full px-4 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          storeCategoryFilter === "all"
                            ? "bg-primary text-white shadow-sm"
                            : "bg-white text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        All
                      </button>
                      {representedStoreCategories.map((category) => {
                        const isActive = storeCategoryFilter === category;
                        return (
                          <button
                            key={category}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-pressed={isActive}
                            onClick={() => setStoreCategoryFilter(category)}
                            className={`min-h-[44px] shrink-0 rounded-full px-4 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                              isActive
                                ? "bg-primary text-white shadow-sm"
                                : "bg-white text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            {STORE_CATEGORY_LABELS[category]}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span aria-live="polite">
                      {filteredStoreItems.length === storeItems.length
                        ? `${storeItems.length} item${storeItems.length === 1 ? "" : "s"} available`
                        : `${filteredStoreItems.length} of ${storeItems.length} item${storeItems.length === 1 ? "" : "s"} match your filters`}
                    </span>
                    {hasActiveStoreFilters && (
                      <button
                        type="button"
                        onClick={clearStoreFilters}
                        className="min-h-[28px] rounded-md px-2 text-[11px] font-semibold text-primary hover:bg-primary-light/40 transition"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
              )}

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

                {/* GSD-01: distinct no-match state — only when the
                    catalog has items but the active filter pair
                    produces zero. Different copy + a focused
                    "Clear filters" action so the user has an
                    obvious next step back to the full catalog. */}
                {storeItems.length > 0 && filteredStoreItems.length === 0 && !storeError && (
                  <div className="sm:col-span-2 rounded-card bg-white p-6 text-center shadow-sm ring-1 ring-gray-200">
                    <Search size={28} className="mx-auto text-gray-300" aria-hidden="true" />
                    <p className="mt-3 text-sm font-bold text-gray-900">No items match your filters.</p>
                    <p className="mt-1 text-xs text-gray-500">Try a different search or category.</p>
                    <button
                      type="button"
                      onClick={clearStoreFilters}
                      className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark active:scale-[0.98]"
                    >
                      Clear filters
                    </button>
                  </div>
                )}

                {filteredStoreItems.map((item) => {
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

        {/* Stay Verification Modal Prompt */}
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
                  Enter the booking last name for Room {roomNumber || roomId || "guest"} to start your front desk session.
                </p>
              </div>

              <form onSubmit={handleNameSubmit} className="space-y-4">
                <label className="grid gap-2 text-xs font-semibold text-gray-700">
                  Booking last name
                  <input
                    type="text"
                    required
                    placeholder="e.g. Santos"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    disabled={isVerifyingGuest}
                    className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 px-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:bg-white"
                  />
                </label>

                {verificationError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {verificationError}
                  </div>
                )}

                <PrimaryButton type="submit" disabled={isVerifyingGuest} className="w-full text-sm font-semibold">
                  {isVerifyingGuest ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Verifying
                    </span>
                  ) : (
                    "Start Chatting"
                  )}
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

                    {storePaymentMethods.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-[11px] font-medium text-amber-800">
                        Store checkout is temporarily unavailable because no payment method is enabled. Please message the front desk.
                      </div>
                    ) : (
                      storePaymentMethods.map((method) => {
                        const helperText =
                          method.method === "cod"
                            ? "Pay cash when items are delivered."
                            : method.method === "add-to-bill"
                              ? "This will be added to your room bill and collected at checkout."
                              : `Send payment via ${method.label}, then upload your receipt screenshot.`;

                        return (
                          <label
                            key={method.method}
                            className={`block rounded-lg border p-3.5 cursor-pointer relative transition ${
                              paymentMethod === method.method
                                ? "border-primary bg-primary-light/10"
                                : "border-gray-250 hover:bg-gray-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="payment"
                              value={method.method}
                              checked={paymentMethod === method.method}
                              onChange={() => setPaymentMethod(method.method)}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold text-gray-900">{method.label}</p>
                                <p className="text-[10px] text-gray-500 font-medium mt-0.5">{helperText}</p>
                              </div>
                              {paymentMethod === method.method && <div className="h-4 w-4 rounded-full bg-primary border-2 border-white ring-2 ring-primary shrink-0" />}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>

                  {/* Bill Warning banner */}
                  {paymentMethod === "add-to-bill" && (
                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3.5 text-[11px] text-blue-800 flex gap-2">
                      <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                      <p>
                        This order will be registered to your room folio. Payment will be collected along with room taxes at the front desk when checking out.
                      </p>
                    </div>
                  )}

                  {/* Online payment details + screenshot upload —
                      shown for ANY non-`cod`/non-`add-to-bill` method
                      configured in Settings → Payment Methods. The
                      rendering is identical for every method: the
                      method's QR (if any) + its account name +
                      account number + a required screenshot. */}
                  {isOnlinePaymentMethod(paymentMethod) && currentPaymentMethodConfig && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-4">
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-gray-700 text-center">
                          {currentPaymentMethodConfig.label} Transfer Details
                        </p>
                        {currentPaymentMethodConfig.qrUrl && (
                          <img
                            src={currentPaymentMethodConfig.qrUrl}
                            alt={`${currentPaymentMethodConfig.label} QR`}
                            className="mx-auto h-36 w-36 rounded-lg border border-gray-200 bg-white object-contain p-2"
                          />
                        )}
                        <div className="text-[10px] text-gray-500 space-y-1">
                          {currentPaymentMethodConfig.accountName && (
                            <p>Account name: <span className="font-semibold text-gray-700">{currentPaymentMethodConfig.accountName}</span></p>
                          )}
                          {currentPaymentMethodConfig.accountNumber && (
                            <p>Account number: <span className="font-semibold text-gray-700">{currentPaymentMethodConfig.accountNumber}</span></p>
                          )}
                          {currentPaymentMethodConfig.accountInfo && (
                            <p>{currentPaymentMethodConfig.accountInfo}</p>
                          )}
                          {!currentPaymentMethodConfig.accountName && !currentPaymentMethodConfig.accountNumber && !currentPaymentMethodConfig.accountInfo && (
                            <p>Account: {config.legalName}</p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Upload Receipt screenshot</p>

                        {gcashPreview ? (
                          <div className="relative rounded-lg overflow-hidden border border-gray-200 max-h-36 flex justify-center bg-black">
                            <img src={gcashPreview} alt="Payment Proof" className="h-full object-contain" />
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
                              accept="image/jpeg,image/png,image/webp"
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
                      disabled={isUploadingProof || storePaymentMethods.length === 0}
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
