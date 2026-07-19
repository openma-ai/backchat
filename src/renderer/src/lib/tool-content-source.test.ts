import { describe, expect, it } from "vitest";
import { localFilePathFromProtocolUrl } from "../../../shared/local-file-url";
import { resolveToolImageSource } from "./tool-content-source";

describe("resolveToolImageSource", () => {
  it.each([
    "/Users/mini/.codex/generated_images/output image.png",
    "C:\\Users\\mini\\.codex\\generated_images\\output image.png",
  ])("routes a generated image path through the local file protocol: %s", (uri) => {
    const source = resolveToolImageSource({
      uri,
      data: "ignored-fallback",
      mimeType: "image/png",
    });

    expect(source).not.toBeNull();
    expect(localFilePathFromProtocolUrl(source!)).toBe(uri);
  });

  it("falls back to an inline image when no file path is available", () => {
    expect(
      resolveToolImageSource({
        data: "iVBORw0KGgo=",
        mimeType: "image/png",
      }),
    ).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("returns null for incomplete image content", () => {
    expect(resolveToolImageSource({ data: "bytes-only" })).toBeNull();
    expect(resolveToolImageSource({ mimeType: "image/png" })).toBeNull();
    expect(resolveToolImageSource({})).toBeNull();
  });
});
