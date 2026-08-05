import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  openSideTab: vi.fn(() => "preview-tab"),
  patchSideTab: vi.fn(),
}));

vi.mock("./session-store", () => ({ sessionStore: store }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { previewLocalFile } from "./file-preview";

const backchat = {
  uiFsResolvePreview: vi.fn(),
  uiFsOpenPath: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { backchat },
  });
});

describe("previewLocalFile", () => {
  it.each(["doc", "docx", "ppt", "pptx", "xls", "xlsx"])(
    "opens .%s files as right-sidebar artifact tabs when no preview exists",
    async (extension) => {
      const path = `/tmp/output.${extension}`;
      backchat.uiFsResolvePreview.mockResolvedValue(null);

      await previewLocalFile(path);

      expect(store.openSideTab).toHaveBeenCalledWith(
        "artifact",
        path,
        `output.${extension}`,
      );
      expect(backchat.uiFsOpenPath).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["pdf", "document"],
    ["html", "web"],
    ["csv", "text"],
  ] as const)("opens .%s previews as right-sidebar tabs", async (extension, kind) => {
    const sourcePath = `/tmp/output.${extension}`;
    backchat.uiFsResolvePreview.mockResolvedValue({
      sourcePath,
      previewPath: sourcePath,
      kind,
    });

    await previewLocalFile(sourcePath);

    expect(store.openSideTab).toHaveBeenCalledWith(
      "browser",
      expect.stringContaining(`output.${extension}`),
      `output.${extension}`,
    );
    expect(backchat.uiFsOpenPath).not.toHaveBeenCalled();
  });
});
