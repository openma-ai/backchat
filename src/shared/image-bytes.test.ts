import { describe, expect, it } from "vitest";

import {
  imageFileExtension,
  isPastedImageMimeType,
  sniffImageMimeType,
} from "./image-bytes";

function bytes(...values: Array<number | string>): Uint8Array {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === "number") out.push(value);
    else for (const char of value) out.push(char.charCodeAt(0));
  }
  return Uint8Array.from(out);
}

describe("sniffImageMimeType", () => {
  it("recognises the four raster formats a clipboard or drop can carry", () => {
    expect(sniffImageMimeType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, "IHDR")))
      .toBe("image/png");
    expect(sniffImageMimeType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, "JFIF")))
      .toBe("image/jpeg");
    expect(sniffImageMimeType(bytes("GIF89a", 1, 0, 1, 0))).toBe("image/gif");
    expect(sniffImageMimeType(bytes("GIF87a", 1, 0, 1, 0))).toBe("image/gif");
    expect(sniffImageMimeType(bytes("RIFF", 0x1a, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
  });

  it("rejects look-alikes and short buffers", () => {
    // A RIFF container that is not WebP (a WAV file) must not pass as an image.
    expect(sniffImageMimeType(bytes("RIFF", 0x1a, 0, 0, 0, "WAVEfmt "))).toBeNull();
    expect(sniffImageMimeType(bytes(0x89, "PN"))).toBeNull();
    expect(sniffImageMimeType(new Uint8Array())).toBeNull();
    expect(sniffImageMimeType(bytes("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"))).toBeNull();
  });
});

describe("pasted image mime helpers", () => {
  it("maps each supported mime type to the extension the saved file gets", () => {
    expect(imageFileExtension("image/png")).toBe(".png");
    expect(imageFileExtension("image/jpeg")).toBe(".jpg");
    expect(imageFileExtension("image/gif")).toBe(".gif");
    expect(imageFileExtension("image/webp")).toBe(".webp");
  });

  it("only accepts the raster types the capture store can validate", () => {
    expect(isPastedImageMimeType("image/png")).toBe(true);
    expect(isPastedImageMimeType("image/webp")).toBe(true);
    expect(isPastedImageMimeType("image/svg+xml")).toBe(false);
    expect(isPastedImageMimeType("text/plain")).toBe(false);
    expect(isPastedImageMimeType(undefined)).toBe(false);
  });
});
