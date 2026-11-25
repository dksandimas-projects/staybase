import { createRoot } from "react-dom/client";
import { QRCodeCanvas } from "qrcode.react";
import config from "@config";

/**
 * Rasterise a QR code to a PNG data URL, for embedding in a jsPDF
 * document (`pdf.addImage(..., "PNG", ...)`) or an `<img>` in print
 * markup.
 *
 * `qrcode.react` only renders as a React element, so the canvas is
 * mounted off-screen, read once it has painted, and torn down. Two
 * nested `requestAnimationFrame`s are the wait: one to let React commit,
 * one to let the browser paint the canvas it committed.
 *
 * Shared by the QR management printables and the booking receipt PDF.
 */
export async function renderQrPngDataUrl(value: string, size = 512) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "0";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(
      <QRCodeCanvas
        value={value}
        size={size}
        level="M"
        marginSize={2}
        fgColor={config.colors.sidebar}
        bgColor="white"
      />
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = host.querySelector("canvas");
    if (!canvas) throw new Error("QR canvas did not render.");
    return canvas.toDataURL("image/png");
  } finally {
    root.unmount();
    host.remove();
  }
}
