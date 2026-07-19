import { describe, expect, it } from "vitest";

import {
  attachmentExtensionLabel,
  mergeComposerAttachments,
} from "./composer-attachments";
import type { PromptAttachment } from "@shared/session-events.js";

function attachment(
  id: string,
  path = `/tmp/${id}.txt`,
): PromptAttachment {
  return {
    id,
    name: `${id}.txt`,
    path,
    uri: `file://${path}`,
    kind: "file",
    mimeType: "text/plain",
    size: 10,
  };
}

describe("composer attachments", () => {
  it("replaces duplicate paths with the latest attachment without reordering", () => {
    const original = attachment("old", "/tmp/shared.txt");
    const latest = {
      ...attachment("latest", "/tmp/shared.txt"),
      name: "shared-new.txt",
    };

    expect(mergeComposerAttachments(
      [original, attachment("second")],
      [latest],
    )).toEqual([
      latest,
      attachment("second"),
    ]);
  });

  it("falls back to id deduplication and caps the composer at ten attachments", () => {
    const existing = Array.from({ length: 9 }, (_, index) =>
      attachment(`file-${index + 1}`));
    const pathless = { ...attachment("pathless"), path: "" };
    const updatedPathless = { ...pathless, name: "updated.txt" };

    const merged = mergeComposerAttachments(
      [...existing, pathless],
      [updatedPathless, attachment("overflow")],
    );

    expect(merged).toHaveLength(10);
    expect(merged[9]).toEqual(updatedPathless);
    expect(merged.some((item) => item.id === "overflow")).toBe(false);
  });

  it("uses a compact final extension label with a file fallback", () => {
    expect(attachmentExtensionLabel("archive.tar.gz")).toBe("gz");
    expect(attachmentExtensionLabel("component.typescript")).toBe("type");
    expect(attachmentExtensionLabel("README")).toBe("FILE");
    expect(attachmentExtensionLabel(".env")).toBe("env");
  });
});
