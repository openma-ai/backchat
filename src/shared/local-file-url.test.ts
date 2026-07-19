import { describe, expect, it } from "vitest";
import {
  localFilePathFromProtocolUrl,
  localFileProtocolUrl,
} from "./local-file-url";

describe("local file protocol URLs", () => {
  it.each([
    "/Users/mini/.codex/generated_images/画 面 #1.png",
    "C:\\Users\\mini\\.codex\\generated_images\\画 面 #1.png",
  ])("round-trips a platform path without changing its separators: %s", (path) => {
    const url = localFileProtocolUrl(path);

    expect(url).toMatch(/^oma-file:\/\/local\/file\?path=/);
    expect(localFilePathFromProtocolUrl(url)).toBe(path);
  });

  it("keeps decoding the legacy POSIX URL shape", () => {
    expect(
      localFilePathFromProtocolUrl(
        "oma-file://local/Users/mini/generated%20images/output.png",
      ),
    ).toBe("/Users/mini/generated images/output.png");
  });

  it("rejects URLs outside the local file protocol contract", () => {
    expect(localFilePathFromProtocolUrl("https://local/file?path=%2Ftmp%2Fa")).toBeNull();
    expect(localFilePathFromProtocolUrl("oma-file://other/file?path=%2Ftmp%2Fa")).toBeNull();
    expect(localFilePathFromProtocolUrl("not a url")).toBeNull();
  });
});
