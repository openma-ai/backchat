import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalFileContent, resolveLocalFilePreview, TEXT_PREVIEW_MAX_BYTES } from "./file-preview";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("resolveLocalFilePreview", () => {
  it.each(["backend", "docs.md"])("recognizes directory %s before checking extensions", async (name) => {
    const root = await mkdtemp(join(tmpdir(), "openma-file-preview-"));
    temporaryRoots.push(root);
    const sourcePath = join(root, name);
    await mkdir(sourcePath);
    await expect(resolveLocalFilePreview(sourcePath)).resolves.toEqual({
      sourcePath, previewPath: sourcePath, kind: "directory",
    });
  });
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

  it.each([
    [".html", "web"],
    [".csv", "text"],
  ] as const)("directly previews %s outputs in the task sidebar", async (extension, kind) => {
    const root = await mkdtemp(join(tmpdir(), "openma-file-preview-"));
    temporaryRoots.push(root);
    const sourcePath = join(root, `output${extension}`);
    await writeFile(sourcePath, "preview");

    await expect(resolveLocalFilePreview(sourcePath)).resolves.toEqual({
      sourcePath,
      previewPath: sourcePath,
      kind,
    });
  });
});

describe("readLocalFileContent", () => {
  const fixture = async (name: string, content: string | Buffer) => {
    const root = await mkdtemp(join(tmpdir(), "openma-file-content-"));
    temporaryRoots.push(root);
    const path = join(root, name);
    await writeFile(path, content);
    return path;
  };

  it("returns UTF-8 text with its size", async () => {
    const path = await fixture("main.ts", "export const 值 = 1;\n");
    const result = await readLocalFileContent(path);
    expect(result).toMatchObject({ kind: "text", content: "export const 值 = 1;\n", truncated: false });
  });

  it("classifies a file with NUL bytes as binary", async () => {
    const path = await fixture(".DS_Store", Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]));
    await expect(readLocalFileContent(path)).resolves.toEqual({ kind: "binary", size: 8 });
  });

  it("returns images as a data URL", async () => {
    const path = await fixture("logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    const result = await readLocalFileContent(path);
    expect(result.kind).toBe("image");
    expect(result.kind === "image" && result.dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("caps long text and marks it truncated", async () => {
    const path = await fixture("big.log", "a".repeat(TEXT_PREVIEW_MAX_BYTES + 10));
    const result = await readLocalFileContent(path);
    expect(result.kind === "text" && result.content.length).toBe(TEXT_PREVIEW_MAX_BYTES);
    expect(result.kind === "text" && result.truncated).toBe(true);
  });

  it("reports directories and missing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-file-content-"));
    temporaryRoots.push(root);
    await expect(readLocalFileContent(root)).resolves.toEqual({ kind: "directory" });
    await expect(readLocalFileContent(join(root, "nope.txt"))).resolves.toMatchObject({ kind: "error" });
  });
});
