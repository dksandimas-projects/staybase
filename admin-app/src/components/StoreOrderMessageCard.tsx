import { ShoppingBag, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { formatPrice } from "../utils/format";
import type { IntercomMessage, StoreOrder } from "../context/AdminContext";

type StorePaymentMethod = "cod" | "add-to-bill" | "gcash";

const paymentLabels: Record<StorePaymentMethod, string> = {
  cod: "Cash on delivery",
  "add-to-bill": "Room bill",
  gcash: "GCash"
};

interface StoreOrderMessageCardProps {
  message: IntercomMessage;
  order?: StoreOrder;
}

export function StoreOrderMessageCard({ message, order }: StoreOrderMessageCardProps) {
  const itemRows = order?.items ?? [];
  const orderRef = order?.orderRef || message.orderRef || "Pending ref";
  const paymentLabel = order ? paymentLabels[order.paymentMethod] : "See order";
  const bookingPath = `/bookings?tab=store${orderRef ? `&orderRef=${encodeURIComponent(orderRef)}` : ""}`;

  return (
    <div className="w-full max-w-md rounded-xl border border-primary/20 bg-primary-light/30 p-3 text-xs text-gray-800 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-primary shadow-sm ring-1 ring-primary/10">
            <ShoppingBag size={15} aria-hidden="true" />
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
        <ExternalLink size={11} aria-hidden="true" />
      </Link>
    </div>
  );
}
