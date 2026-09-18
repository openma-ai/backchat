/** Raster image types a paste or drop can hand the composer as raw bytes.
 *  SVG is deliberately absent: it is a document, not a bitmap, and the
 *  capture store validates by signature. */
export type PastedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

const EXTENSIONS: Record<PastedImageMimeType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function isPastedImageMimeType(
  value: string | null | undefined,
): value is PastedImageMimeType {
  return typeof value === "string" && value in EXTENSIONS;
}

export function imageFileExtension(mimeType: PastedImageMimeType): string {
  return EXTENSIONS[mimeType];
}

/** Identify a bitmap by its magic bytes. Returns null for anything that is
 *  not one of the supported raster formats, including a RIFF container that
 *  is not WebP. */
export function sniffImageMimeType(bytes: Uint8Array): PastedImageMimeType | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const head = ascii(bytes, 0, 6);
  if (head === "GIF89a" || head === "GIF87a") {
    return "image/gif";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return "";
  let out = "";
  for (let index = start; index < end; index += 1) {
    out += String.fromCharCode(bytes[index] ?? 0);
  }
  return out;
}
