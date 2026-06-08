export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: "image/jpeg" | "image/webp";
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
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read compressed image."));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageFile(file: File, options: CompressImageOptions = {}): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  const settings = { ...defaultImageOptions, ...options };
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

  context.drawImage(imageBitmap, 0, 0, width, height);
  imageBitmap.close();

  const blob = await canvasToBlob(canvas, settings.mimeType, settings.quality);
  const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
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
}
