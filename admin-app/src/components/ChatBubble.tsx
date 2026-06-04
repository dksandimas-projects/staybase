import { cn } from "../utils/cn";

interface ChatBubbleProps {
  sender: "guest" | "staff";
  name: string;
  time: string;
  children: string;
}

export function ChatBubble({ sender, name, time, children }: ChatBubbleProps) {
  const guest = sender === "guest";

  return (
    <div className={cn("flex", guest ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-card px-4 py-3 text-sm shadow-sm",
          guest ? "bg-primary text-white" : "bg-white text-gray-700 ring-1 ring-gray-200"
        )}
      >
        <div className={cn("mb-1 flex items-center gap-2 text-xs", guest ? "text-primary-light" : "text-gray-500")}>
          <span className="font-semibold">{name}</span>
          <span>{time}</span>
        </div>
        <p className="leading-6">{children}</p>
      </div>
    </div>
  );
}
