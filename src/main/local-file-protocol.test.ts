import { describe, expect, it } from "vitest";
import { localFileProtocolUrl } from "../shared/local-file-url";
import { resolveAllowedLocalFilePath } from "./local-file-protocol";

describe("resolveAllowedLocalFilePath", () => {
  it("accepts files inside an allowed POSIX root", () => {
    expect(
      resolveAllowedLocalFilePath(
        localFileProtocolUrl("/Users/mini/.codex/generated_images/output.png"),
        ["/Users/mini/.oma", "/Users/mini/.codex/generated_images"],
      ),
    ).toBe("/Users/mini/.codex/generated_images/output.png");
  });

  it("rejects traversal and sibling-prefix paths", () => {
    const roots = ["/Users/mini/.oma"];

    expect(
      resolveAllowedLocalFilePath(
        localFileProtocolUrl("/Users/mini/.oma/../private/output.png"),
        roots,
      ),
    ).toBeNull();
    expect(
      resolveAllowedLocalFilePath(
        localFileProtocolUrl("/Users/mini/.oma-backup/output.png"),
        roots,
      ),
    ).toBeNull();
  });

  it("normalizes Windows paths with Windows semantics", () => {
    const root = String.raw`C:\Users\mini\.codex\generated_images`;
    const file = String.raw`C:\Users\mini\.codex\generated_images\output.png`;
    const escaped = String.raw`C:\Users\mini\.codex\generated_images\..\secret.png`;

    expect(resolveAllowedLocalFilePath(localFileProtocolUrl(file), [root])).toBe(file);
    expect(resolveAllowedLocalFilePath(localFileProtocolUrl(escaped), [root])).toBeNull();
  });
});
