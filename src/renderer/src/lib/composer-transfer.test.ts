import { describe, expect, it, vi } from "vitest";

import type { PromptAttachment } from "@shared/session-events.js";
import {
  collectTransferFiles,
  ingestTransferFiles,
  pastedImageMimeType,
  pastedImageName,
  shouldConsumePaste,
  type TransferFileLike,
} from "./composer-transfer";

function file(
  name: string,
  type: string,
  content: string | Uint8Array = "",
): TransferFileLike {
  const bytes = typeof content === "string"
    ? Uint8Array.from(content, (char) => char.charCodeAt(0))
    : content;
  return {
    name,
    type,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

function attachment(name: string, kind: PromptAttachment["kind"] = "file"): PromptAttachment {
  return {
    id: name,
    name,
    path: `/tmp/${name}`,
    uri: `file:///tmp/${name}`,
    kind,
  };
}

describe("collectTransferFiles", () => {
  it("takes file items from a clipboard and notes whether plain text rides along", () => {
    const png = file("image.png", "image/png");
    const collected = collectTransferFiles({
      items: [
        { kind: "string", type: "text/html", getAsFile: () => null },
        { kind: "file", type: "image/png", getAsFile: () => png },
        // Chromium reports some clipboard entries as files with no File body.
        { kind: "file", type: "image/png", getAsFile: () => null },
      ],
      types: ["text/html", "Files"],
    });

    expect(collected.files).toEqual([png]);
    expect(collected.hasText).toBe(false);
  });

  it("reports plain text so a mixed paste keeps its text", () => {
    const collected = collectTransferFiles({
      items: [{ kind: "file", type: "image/png", getAsFile: () => file("a.png", "image/png") }],
      types: ["text/plain", "Files"],
    });

    expect(collected.hasText).toBe(true);
  });

  it("falls back to the files list for a drop", () => {
    const dropped = file("notes.md", "text/markdown");
    const collected = collectTransferFiles({ files: [dropped], types: ["Files"] });

    expect(collected.files).toEqual([dropped]);
    expect(collected.hasText).toBe(false);
  });

  it("is empty for a missing transfer", () => {
    expect(collectTransferFiles(null)).toEqual({ files: [], hasText: false });
  });
});

describe("shouldConsumePaste", () => {
  it("swallows the paste only when files are all it carried", () => {
    const png = file("image.png", "image/png");
    expect(shouldConsumePaste({ files: [png], hasText: false })).toBe(true);
    expect(shouldConsumePaste({ files: [png], hasText: true })).toBe(false);
    expect(shouldConsumePaste({ files: [], hasText: true })).toBe(false);
    expect(shouldConsumePaste({ files: [], hasText: false })).toBe(false);
  });
});

describe("pastedImageMimeType", () => {
  it("uses the declared type and falls back to the extension", () => {
    expect(pastedImageMimeType(file("image.png", "image/png"))).toBe("image/png");
    expect(pastedImageMimeType(file("photo.JPG", ""))).toBe("image/jpeg");
    expect(pastedImageMimeType(file("anim.gif", "application/octet-stream"))).toBe("image/gif");
  });

  it("does not treat vector or non-image files as pasteable bitmaps", () => {
    expect(pastedImageMimeType(file("logo.svg", "image/svg+xml"))).toBeNull();
    expect(pastedImageMimeType(file("notes.txt", "text/plain"))).toBeNull();
  });
});

describe("pastedImageName", () => {
  it("keeps a meaningful original name", () => {
    expect(pastedImageName(file("diagram.png", "image/png"), "image/png")).toBe("diagram.png");
    expect(pastedImageName(file("shot.jpeg", "image/jpeg"), "image/jpeg")).toBe("shot.jpeg");
  });

  it("names anonymous clipboard bitmaps after what they are", () => {
    expect(pastedImageName(file("image.png", "image/png"), "image/png")).toBe("pasted-image.png");
    expect(pastedImageName(file("", "image/jpeg"), "image/jpeg")).toBe("pasted-image.jpg");
  });
});

describe("ingestTransferFiles", () => {
  it("attaches path-backed files through the main process in one batch, in order", async () => {
    const deps = {
      pathForFile: (candidate: TransferFileLike) => `/Users/me/${candidate.name}`,
      attachPaths: vi.fn(async (paths: string[]) =>
        paths.map((path) => attachment(path.split("/").pop()!))),
      saveImage: vi.fn(),
    };

    const result = await ingestTransferFiles(
      [file("a.md", "text/markdown"), file("b.png", "image/png")],
      deps,
    );

    expect(deps.attachPaths).toHaveBeenCalledTimes(1);
    expect(deps.attachPaths).toHaveBeenCalledWith(["/Users/me/a.md", "/Users/me/b.png"]);
    expect(deps.saveImage).not.toHaveBeenCalled();
    expect(result.attachments.map((item) => item.name)).toEqual(["a.md", "b.png"]);
    expect(result.unsupported).toEqual([]);
  });

  it("saves a pathless bitmap through the capture store as base64", async () => {
    const saveImage = vi.fn(async (input: { name: string; mimeType: string }) =>
      attachment(input.name, "image"));

    const result = await ingestTransferFiles(
      [file("image.png", "image/png", "hi")],
      { pathForFile: () => "", attachPaths: vi.fn(), saveImage },
    );

    expect(saveImage).toHaveBeenCalledWith({
      data: "aGk=",
      name: "pasted-image.png",
      mimeType: "image/png",
    });
    expect(result.attachments).toEqual([attachment("pasted-image.png", "image")]);
  });

  it("reports pathless non-images instead of inventing a file for them", async () => {
    const attachPaths = vi.fn();
    const saveImage = vi.fn();

    const result = await ingestTransferFiles(
      [file("clip.txt", "text/plain", "x"), file("logo.svg", "image/svg+xml", "<svg/>")],
      { pathForFile: () => "", attachPaths, saveImage },
    );

    expect(attachPaths).not.toHaveBeenCalled();
    expect(saveImage).not.toHaveBeenCalled();
    expect(result.attachments).toEqual([]);
    expect(result.unsupported).toEqual(["clip.txt", "logo.svg"]);
  });

  it("keeps path attachments ahead of saved bitmaps", async () => {
    const result = await ingestTransferFiles(
      [file("image.png", "image/png", "x"), file("doc.pdf", "application/pdf")],
      {
        pathForFile: (candidate) => candidate.name === "doc.pdf" ? "/tmp/doc.pdf" : "",
        attachPaths: async () => [attachment("doc.pdf")],
        saveImage: async (input) => attachment(input.name, "image"),
      },
    );

    expect(result.attachments.map((item) => item.name)).toEqual(["doc.pdf", "pasted-image.png"]);
  });
});
