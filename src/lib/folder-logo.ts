/**
 * Custom group logos are resized in the browser and stored as small data URLs,
 * next to the rest of the folder record in `app_settings`.
 *
 * The goal is a logo that still looks sharp when the group header draws it at
 * 28px: the canvas is 128px on the long side, which covers a 2× phone screen.
 * WebP is tried first because it keeps transparency and stores a photo-quality
 * 128px logo in a few KB; PNG is the fallback for browsers that cannot encode
 * it. Keeping the stored value small matters because up to 20 logos travel to
 * the server together, inside one action payload.
 */
export const FOLDER_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
/** Refuse absurd source files before spending time decoding them. */
export const MAX_FOLDER_LOGO_SOURCE_BYTES = 5 * 1024 * 1024;
/** Longest side of the stored image, in pixels. */
export const FOLDER_LOGO_SIZE = 128;
/**
 * Per-logo cap in characters of data URL. A 128px WebP logo is ~3 KB, but a
 * browser that can only encode PNG produces far more, so the encoder retries at
 * 96px and 64px to fit. 20 folders (MAX_FOLDERS) at this cap is ~520 KB of JSON,
 * which stays inside the 1 MB server-action body limit.
 */
export const MAX_FOLDER_LOGO_DATA_LENGTH = 26_000;

const DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;

/**
 * Accepts only the bounded image data URLs this module (or an older saved
 * layout) produces. Anything else is dropped, so a hand-edited setting cannot
 * inject a `javascript:` URL or an unbounded payload into every page.
 */
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
 * Turns a picked file into a ≤128px PNG data URL. A square canvas is used so a
 * wide or tall logo is centred and contained rather than cropped, and the
 * encodings fall back to a smaller canvas if the PNG is unexpectedly heavy.
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

  for (const size of [FOLDER_LOGO_SIZE, 96, 64]) {
    canvas.width = size;
    canvas.height = size;
    context.clearRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // Contain, not cover: a tall logo keeps its whole shape inside the square.
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(
      image,
      Math.round((size - width) / 2),
      Math.round((size - height) / 2),
      width,
      height,
    );

    for (const type of ["image/webp", "image/png"] as const) {
      const logo = normaliseFolderLogo(canvas.toDataURL(type, 0.85));
      // toDataURL silently returns PNG data for an unsupported type, which the
      // pattern still accepts — so an extra type check is not needed.
      if (logo) return logo;
    }
  }
  throw new Error("That logo is too detailed to store. Try a simpler or smaller image.");
}
