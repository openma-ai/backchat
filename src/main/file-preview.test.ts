import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalFilePreview } from "./file-preview";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("resolveLocalFilePreview", () => {
  it("previews a generated DOCX sidecar while preserving the original open target", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-file-preview-"));
    temporaryRoots.push(root);
    const sourcePath = join(root, "未命名文档.docx");
    const previewPath = join(root, "docx_render_final", "未命名文档.pdf");
    await writeFile(sourcePath, "docx");
    await mkdir(join(root, "docx_render_final"));
    await writeFile(previewPath, "pdf");

    await expect(resolveLocalFilePreview(sourcePath)).resolves.toEqual({
      sourcePath,
      previewPath,
      kind: "document",
    });
  });

  it("uses a directly previewable PDF as both preview and open target", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-file-preview-"));
    temporaryRoots.push(root);
    const sourcePath = join(root, "report.pdf");
    await writeFile(sourcePath, "pdf");

    await expect(resolveLocalFilePreview(sourcePath)).resolves.toEqual({
      sourcePath,
      previewPath: sourcePath,
      kind: "document",
    });
  });
});
