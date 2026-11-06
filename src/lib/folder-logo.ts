/** Custom group logos are resized in the browser and stored as small data URLs. */
export const FOLDER_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
export const MAX_FOLDER_LOGO_SOURCE_BYTES = 5 * 1024 * 1024;
/** Keeps even 20 groups comfortably below the server-action body limit. */
export const MAX_FOLDER_LOGO_DATA_LENGTH = 30_000;

const DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;

/** Accepts only the bounded image data URLs produced by `folderLogoFromFile`. */
export function normaliseFolderLogo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const logo = value.trim();
  if (logo.length === 0 || logo.length > MAX_FOLDER_LOGO_DATA_LENGTH) return undefined;
  return DATA_URL_PATTERN.test(logo) ? logo : undefined;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read. Try a PNG, JPG, or WebP logo."));
    };
    image.src = url;
  });
}

/**
 * Converts an image to a transparent, at-most-96px WebP where the browser
 * supports it (PNG otherwise). Progressively smaller encodings guarantee a
 * small persisted value without rejecting a high-resolution source logo.
 */
export async function folderLogoFromFile(file: File): Promise<string> {
  if (typeof document === "undefined") throw new Error("Choose a logo in the browser.");
  if (!FOLDER_LOGO_ACCEPT.split(",").includes(file.type)) {
    throw new Error("Choose a PNG, JPG, or WebP image.");
  }
  if (file.size <= 0) throw new Error("That image file is empty.");
  if (file.size > MAX_FOLDER_LOGO_SOURCE_BYTES) {
    throw new Error("Choose an image smaller than 5 MB. It will be resized for the group.");
  }

  const image = await loadImage(file);
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("That image has no visible pixels.");
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not process the logo.");

  for (const maxSide of [96, 64, 48]) {
    const scale = Math.min(1, maxSide / image.naturalWidth, maxSide / image.naturalHeight);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.68, 0.5]) {
      const logo = normaliseFolderLogo(canvas.toDataURL("image/webp", quality));
      if (logo) return logo;
    }
  }
  throw new Error("That logo is too detailed to store. Try a simpler or smaller image.");
}
