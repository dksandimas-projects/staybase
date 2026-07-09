import { useEffect, useRef } from "react";
import {
  ArchiveRestore,
  CheckCheck,
  MessageSquare,
  RotateCcw,
  Send,
  User,
  type LucideIcon
} from "lucide-react";
import { cn } from "../utils/cn";
import { useBreakpoint } from "../utils/useBreakpoint";
import { StoreOrderMessageCard } from "./StoreOrderMessageCard";
import type { IntercomMessage, StoreOrder } from "../context/AdminContext";

export type ThreadFilter = "active" | "resolved";

interface IntercomChatPanelProps {
  roomNumber: string;
  messages: IntercomMessage[];
  storeOrdersByRef: Map<string, StoreOrder | undefined>;
  threadFilter: ThreadFilter;
  isResolved: boolean;
  onToggleResolved: () => void;
  replyText: string;
  onReplyTextChange: (text: string) => void;
  onSend: () => void;
  onBack?: () => void;
  BackIcon?: LucideIcon;
  variant?: "panel" | "drawer";
}

export function IntercomChatPanel({
  roomNumber,
  messages,
  storeOrdersByRef,
  threadFilter,
  isResolved,
  onToggleResolved,
  replyText,
  onReplyTextChange,
  onSend,
  onBack,
  BackIcon,
  variant = "panel"
}: IntercomChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const { isMobile } = useBreakpoint();
  const inDrawer = variant === "drawer";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, roomNumber]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-white",
        inDrawer ? "flex-1" : "rounded-card shadow-sm ring-1 ring-gray-200 min-h-[460px]"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-gray-200 bg-gray-50/50",
          inDrawer ? "px-4 py-3" : "p-4"
        )}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to threads"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200"
          >
            {BackIcon ? <BackIcon size={18} aria-hidden="true" /> : null}
          </button>
        )}
        <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-center text-xs font-bold leading-8 text-primary">
          {roomNumber || "--"}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-bold leading-none text-gray-900">
            {inDrawer ? `Room ${roomNumber || "unselected"}` : `Intercom Feed Room ${roomNumber || "unselected"}`}
          </h3>
          <span className="mt-1 inline-block text-[9px] capitalize text-gray-400">
            {isResolved ? "Resolved conversation" : "Active stay room link"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold",
              isResolved ? "border-green-200 bg-green-50 text-green-700" : "border-primary/20 bg-primary/5 text-primary-dark"
            )}
          >
            <CheckCheck size={10} />
            {isResolved ? "Resolved" : "Operational feed online"}
          </span>

          <button
            type="button"
            disabled={!roomNumber}
            onClick={onToggleResolved}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[10px] font-bold text-gray-700 transition hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isResolved ? <RotateCcw size={12} /> : <ArchiveRestore size={12} />}
            {isResolved ? "Reopen" : "Mark Resolved"}
          </button>
        </div>
      </div>

      {/* Message history */}
      <div
        className={cn(
          "flex-1 space-y-4 overflow-y-auto bg-gray-50/20",
          isMobile || inDrawer ? "p-4" : "max-h-[340px] p-6"
        )}
      >
        {messages.length > 0 ? (
          messages.map((msg) => {
            const isFd = msg.sender === "front-desk";
            const storeOrder = msg.orderRef ? storeOrdersByRef.get(msg.orderRef) : undefined;

            return (
              <div
                key={msg.id}
                className={cn("flex max-w-[85%] gap-3", isFd ? "ml-auto flex-row-reverse" : "mr-auto")}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    isFd ? "bg-primary/10 text-primary" : "bg-gray-150 text-gray-650"
                  )}
                >
                  {isFd ? "FD" : <User size={12} />}
                </div>

                <div className="space-y-1">
                  {msg.isStoreOrder && !isFd ? (
                    <StoreOrderMessageCard message={msg} order={storeOrder} />
                  ) : (
                    <div
                      className={cn(
                        "rounded-xl p-3 text-xs leading-relaxed",
                        isFd
                          ? "bg-primary font-medium text-white shadow-sm rounded-tr-none"
                          : msg.isQuickRequest
                            ? "rounded-tl-none rounded-xl border border-primary/20 bg-primary-light font-bold text-primary-dark"
                            : "rounded-tl-none rounded-xl border border-gray-200 bg-white text-gray-800"
                      )}
                    >
                      {msg.isQuickRequest && !isFd && (
                        <span className="mb-1 block text-[9px] uppercase tracking-wider opacity-70">Quick request</span>
                      )}
                      {msg.text}
                    </div>
                  )}

                  <p
                    className={cn(
                      "px-1 text-[8px] font-semibold text-gray-400",
                      isFd ? "text-right" : "text-left"
                    )}
                  >
                    {msg.timestamp}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full flex-col items-center justify-center space-y-2 text-center text-gray-400">
            <MessageSquare size={32} className="text-gray-300" />
            <p className="text-xs italic">
              {roomNumber
                ? `No message feeds recorded for Room ${roomNumber}. Send a greeting below.`
                : `No ${threadFilter} conversations to show.`}
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className={cn(
          "flex shrink-0 gap-3 border-t border-gray-200 bg-white",
          inDrawer ? "px-4 py-3" : "p-4"
        )}
      >
        <input
          type="text"
          required
          disabled={!roomNumber}
          value={replyText}
          onChange={(e) => onReplyTextChange(e.target.value)}
          placeholder={roomNumber ? `Type reply statement to Room ${roomNumber}...` : "Select a room conversation first"}
          className="min-h-[44px] flex-1 rounded-lg border border-gray-250 bg-white px-3 text-xs outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={!roomNumber}
          className="min-h-[44px] rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5"
        >
          <Send size={12} aria-hidden="true" />
          Send
        </button>
      </form>
    </div>
  );
}
