export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  // PNG is lossless and preserves the alpha channel — required for
  // transparent logos (per W3.13). JPEG is the default for
  // everything else (hero photos, room photos) where alpha doesn't
  // matter and smaller file size is preferred.
  mimeType?: "image/jpeg" | "image/webp" | "image/png";
}

export interface CompressedImage {
  file: File;
  dataUrl: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
}

const defaultImageOptions: Required<CompressImageOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
  mimeType: "image/jpeg"
};

// Per W3.13 — when a caller asks for PNG or WebP output, the
// filename extension must match. JPEG (the default) is always
// encoded as .jpg; WebP as .webp; PNG as .png. The previous
// implementation hardcoded .jpg for every output, which silently
// lied about the actual file type when callers requested PNG.
const MIME_TO_EXTENSION: Record<"image/jpeg" | "image/webp" | "image/png", string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/png": "png"
};

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to compress image."));
      },
      mimeType,
      quality
    );
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    if (reader.onerror) {
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read compressed image."));
    }
    reader.readAsDataURL(blob);
  });
}

export async function compressImageFile(file: File, options: CompressImageOptions = {}): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  const settings = { ...defaultImageOptions, ...options };
  try {
    const imageBitmap = await createImageBitmap(file);
    const scale = Math.min(settings.maxWidth / imageBitmap.width, settings.maxHeight / imageBitmap.height, 1);
    const width = Math.max(1, Math.round(imageBitmap.width * scale));
    const height = Math.max(1, Math.round(imageBitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      imageBitmap.close();
      throw new Error("Unable to prepare image compression.");
    }

    // Paint background white for formats without alpha channel (JPEG)
    const outputSupportsAlpha = settings.mimeType !== "image/jpeg";
    if (!outputSupportsAlpha) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(imageBitmap, 0, 0, width, height);
    imageBitmap.close();

    const blob = await canvasToBlob(canvas, settings.mimeType, settings.quality);
    const ext = MIME_TO_EXTENSION[settings.mimeType];
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const compressedFile = new File([blob], `${baseName}.${ext}`, {
      type: settings.mimeType,
      lastModified: Date.now()
    });
    const dataUrl = await blobToDataUrl(blob);

    return {
      file: compressedFile,
      dataUrl,
      width,
      height,
      originalSize: file.size,
      compressedSize: compressedFile.size
    };
  } catch (error) {
    console.warn("Image compression failed, falling back to original file:", error);
    try {
      const dataUrl = await blobToDataUrl(file);
      return {
        file,
        dataUrl,
        width: 0,
        height: 0,
        originalSize: file.size,
        compressedSize: file.size
      };
    } catch (fallbackError) {
      throw new Error("Unable to process or read the selected image file.");
    }
  }
}
