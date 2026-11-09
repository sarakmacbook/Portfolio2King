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
/**
 * What the OS file picker offers. Deliberately broad: the list is only a hint to
 * Finder/Files, and a real check happens in `folderLogoFromFile`, because a
 * macOS file can arrive with an empty or unfamiliar MIME type.
 */
export const FOLDER_LOGO_ACCEPT = "image/*,.heic,.heif,.avif,.svg,.gif,.bmp,.tiff,.tif";

/**
 * Extensions a user may reasonably drag out of Finder. macOS reports the modern
 * `image/heic` type, but a file renamed on disk can carry no usable type at all,
 * so the extension is the fallback.
 */
const ALLOWED_EXTENSIONS = [
  "png", "jpg", "jpeg", "jpe", "webp", "gif", "bmp", "avif", "heic", "heif",
  "svg", "tif", "tiff", "ico",
] as const;

/** Formats every current browser decodes; anything else is trusted only by sniffing. */
const SAFE_IMAGE_TYPES = [
  "image/png", "image/jpeg", "image/jpg", "image/webp",
  "image/gif", "image/bmp", "image/avif", "image/heic", "image/heif",
  "image/svg+xml", "image/tiff", "image/x-icon", "image/vnd.microsoft.icon",
] as const;
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

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

function isAllowedExtension(name: string): boolean {
  const extension = extensionOf(name);
  return extension !== "" && (ALLOWED_EXTENSIONS as readonly string[]).includes(extension);
}

/**
 * macOS sometimes hands a dropped item over with an empty `type`, and a file
 * saved without an extension has nothing but its bytes to go on. The first
 * bytes of every format this app accepts are distinctive, so sniff them rather
 * than rejecting a perfectly good picture.
 */
function hasImageSignature(bytes: Uint8Array): boolean {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, index) => bytes[offset + index] === value);
  if (bytes.length < 4) return false;

  // PNG
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return true;
  // JPEG
  if (at(0, 0xff, 0xd8, 0xff)) return true;
  // GIF87a / GIF89a
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return true;
  // BMP
  if (at(0, 0x42, 0x4d)) return true;
  // WebP: "RIFF" .... "WEBP"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && bytes.length >= 12 && at(8, 0x57, 0x45, 0x42, 0x50)) return true;
  // AVIF / HEIC / HEIF: an ISO-BMFF box whose type is "ftyp" at offset 4
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return true;
  // TIFF, little- and big-endian
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return true;
  // ICO / CUR
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return true;
  // SVG is text, so look for an XML/SVG preamble in the first bytes.
  const head = new TextDecoder().decode(bytes).trimStart().toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

/**
 * True when a dropped or picked file looks like an image this app can decode.
 * Never throws: it is used to decide whether to accept a drag at all.
 */
export async function looksLikeImage(file: File): Promise<boolean> {
  if (file.size <= 0) return false;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  } catch {
    // A file the browser will not let us read cannot be decoded either.
    bytes = new Uint8Array();
  }

  // The bytes are the truth: a zip renamed "logo.png" fails here.
  if (hasImageSignature(bytes)) return true;

  // Nothing to sniff (a very short or unreadable file): fall back to what the
  // OS claims, which is all a Finder drop of a valid image sometimes offers.
  if (bytes.length < 4) return isAllowedExtension(file.name) || file.type.startsWith("image/");

  // An explicitly image-typed file in a format this list does not name (say
  // image/jxl) still gets a chance; `<img>` decoding is the final judge.
  return file.type.startsWith("image/");
}

/**
 * The first file from a drop. Chrome puts a dragged file in `files`, while
 * Safari only exposes it through `items`, so both are consulted.
 */
export function imageFileFromDrop(transfer: DataTransfer | null): File | undefined {
  if (!transfer) return undefined;
  const fromFiles = Array.from(transfer.files ?? []);
  const fromItems = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return fromFiles[0] ?? fromItems[0];
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
      reject(new Error("That image could not be read. Try a PNG, JPG, WebP, GIF, HEIC, or SVG logo."));
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
  if (file.size <= 0) throw new Error("That file is empty.");
  if (file.size > MAX_FOLDER_LOGO_SOURCE_BYTES) {
    throw new Error("Choose an image smaller than 5 MB. It will be resized for the group.");
  }
  // The type is only a hint (Finder can report nothing), so ask the bytes too.
  if (!(await looksLikeImage(file))) {
    throw new Error("That file is not an image. Choose a PNG, JPG, WebP, GIF, HEIC, or SVG file.");
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
