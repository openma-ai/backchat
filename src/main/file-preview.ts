import { access, open, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export type LocalFilePreviewKind = "document" | "image" | "web" | "text" | "directory";

export interface LocalFilePreview {
  sourcePath: string;
  previewPath: string;
  kind: LocalFilePreviewKind;
}

const DIRECT_PREVIEW_TYPES = new Map<string, LocalFilePreviewKind>([
  [".pdf", "document"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".svg", "image"],
  [".avif", "image"],
  [".html", "web"],
  [".htm", "web"],
  [".txt", "text"],
  [".md", "text"],
  [".markdown", "text"],
  [".json", "text"],
  [".csv", "text"],
  [".log", "text"],
]);

async function existingFile(path: string): Promise<string | null> {
  return access(path).then(() => path, () => null);
}

async function resolveDocumentSidecar(sourcePath: string): Promise<string | null> {
  const parent = dirname(sourcePath);
  const stem = basename(sourcePath, extname(sourcePath));
  const fixedCandidates = [
    join(parent, "docx_render_final", `${stem}.pdf`),
    join(parent, "docx_render_final", "page-1.png"),
    join(parent, `${stem}.pdf`),
    join(parent, `${stem}_render`, `${stem}.pdf`),
    join(parent, `${stem}_render`, "page-1.png"),
  ];
  for (const candidate of fixedCandidates) {
    const found = await existingFile(candidate);
    if (found) return found;
  }

  // Document skills are allowed to choose a timestamped render directory.
  // Prefer a same-name PDF, then the first page image, in the newest-looking
  // render directory. This remains intentionally local to the source folder.
  const renderDirs = (await readdir(parent, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /(?:docx|document).*render|render.*(?:docx|document)/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const renderDir of renderDirs) {
    for (const name of [`${stem}.pdf`, "page-1.png"]) {
      const found = await existingFile(join(parent, renderDir, name));
      if (found) return found;
    }
  }
  return null;
}

/** Resolve an in-app preview without changing the native file open target. */
export async function resolveLocalFilePreview(
  sourcePath: string,
): Promise<LocalFilePreview | null> {
  const metadata = await stat(sourcePath).catch(() => null);
  if (metadata?.isDirectory()) {
    return { sourcePath, previewPath: sourcePath, kind: "directory" };
  }
  const extension = extname(sourcePath).toLowerCase();
  const directKind = DIRECT_PREVIEW_TYPES.get(extension);
  if (directKind && await existingFile(sourcePath)) {
    return { sourcePath, previewPath: sourcePath, kind: directKind };
  }
  if (extension === ".docx" || extension === ".doc") {
    const previewPath = await resolveDocumentSidecar(sourcePath);
    if (previewPath) {
      return { sourcePath, previewPath, kind: "document" };
    }
  }
  return null;
}

/** What the file panel can show inline for one local file. */
export type LocalFileContent =
  | { kind: "text"; content: string; size: number; truncated: boolean }
  | { kind: "image"; dataUrl: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "too-large"; size: number }
  | { kind: "directory" }
  | { kind: "error"; message: string };

/** Text beyond this is cut; the pane says so and offers the native app. */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

const IMAGE_MIME = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
]);

/** Read a local file for the in-panel viewer. Images come back as a data
 *  URL (the renderer's http origin cannot load file://); text is decoded as
 *  UTF-8 and capped; anything with a NUL byte in its head is binary. */
export async function readLocalFileContent(path: string): Promise<LocalFileContent> {
  const metadata = await stat(path).catch((error: unknown) => error as Error);
  if (metadata instanceof Error) return { kind: "error", message: metadata.message };
  if (metadata.isDirectory()) return { kind: "directory" };
  const size = metadata.size;
  const mime = IMAGE_MIME.get(extname(path).toLowerCase());
  if (mime) {
    if (size > IMAGE_PREVIEW_MAX_BYTES) return { kind: "too-large", size };
    const bytes = await readHead(path, size);
    return { kind: "image", size, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  }
  const head = await readHead(path, Math.min(size, TEXT_PREVIEW_MAX_BYTES));
  if (head.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: "binary", size };
  return {
    kind: "text",
    // A cut can land inside a multi-byte character; the decoder replaces
    // the broken tail instead of throwing.
    content: new TextDecoder("utf-8").decode(head),
    size,
    truncated: size > TEXT_PREVIEW_MAX_BYTES,
  };
}

async function readHead(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
