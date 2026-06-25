/// <reference types="vite/client" />

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  action?: string;
  cData?: string;
  appearance?: "always" | "execute" | "interaction-only";
  execution?: "render" | "execute";
  theme?: "light" | "dark" | "auto";
  language?: string;
  tabindex?: number;
  "response-field"?: boolean;
  "size"?: "normal" | "flexible" | "compact";
  retry?: "auto" | "never";
  "retry-interval"?: number;
  "refresh-expired"?: "auto" | "manual" | "never";
  "feedback-enabled"?: boolean;
}

interface Turnstile {
  render: (container: string | HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
  execute: (container?: string | HTMLElement, options?: TurnstileRenderOptions) => void;
  getResponse: (container?: string | HTMLElement) => string | undefined;
}

interface Window {
  turnstile?: Turnstile;
}
