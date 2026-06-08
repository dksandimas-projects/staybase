import config from "@config";

export function formatPrice(value: number) {
  return new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: config.currency,
    maximumFractionDigits: 0
  }).format(value);
}
