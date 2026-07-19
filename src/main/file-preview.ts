import { access, readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export type LocalFilePreviewKind = "document" | "image" | "web" | "text";

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
