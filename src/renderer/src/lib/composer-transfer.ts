import type { PromptAttachment } from "@shared/session-events.js";
import {
  imageFileExtension,
  isPastedImageMimeType,
  type PastedImageMimeType,
} from "@shared/image-bytes.js";

/** The slice of `File` this module reads, so tests need no DOM. */
export interface TransferFileLike {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The slice of `DataTransfer` this module reads. Clipboard events populate
 *  `items`; drops populate `files`. */
export interface DataTransferLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): TransferFileLike | null }>;
  files?: ArrayLike<TransferFileLike>;
  types?: ArrayLike<string>;
}

export interface CollectedTransfer {
  files: TransferFileLike[];
  /** Plain text rode along with the files (a mixed paste). */
  hasText: boolean;
}

export function collectTransferFiles(
  transfer: DataTransferLike | null | undefined,
): CollectedTransfer {
  if (!transfer) return { files: [], hasText: false };
  const files: TransferFileLike[] = [];
  if (transfer.items) {
    for (const item of Array.from(transfer.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  } else if (transfer.files) {
    files.push(...Array.from(transfer.files));
  }
  const hasText = Array.from(transfer.types ?? []).includes("text/plain");
  return { files, hasText };
}

/** A paste is ours to swallow only when files are all it carried. A mixed
 *  paste (text plus an image) keeps its text: the textarea receives the
 *  default action and the files are attached alongside. */
export function shouldConsumePaste(collected: CollectedTransfer): boolean {
  return collected.files.length > 0 && !collected.hasText;
}

const EXTENSION_MIME: Record<string, PastedImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The bitmap type of a transfer file, from its declared type or, when the
 *  browser omitted one, its extension. Null for anything that is not a
 *  supported raster image. */
export function pastedImageMimeType(file: TransferFileLike): PastedImageMimeType | null {
  if (isPastedImageMimeType(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return extension && extension !== file.name.toLowerCase()
    ? EXTENSION_MIME[extension] ?? null
    : null;
}

/** Chromium names a clipboard bitmap "image.png" regardless of origin; that
 *  is not a name worth keeping. Anything else the user chose survives. */
export function pastedImageName(file: TransferFileLike, mimeType: PastedImageMimeType): string {
  const original = file.name.trim();
  if (original && original.toLowerCase() !== "image.png") return original;
  return `pasted-image${imageFileExtension(mimeType)}`;
}

export interface TransferIngestDeps {
  /** The OS path behind a File, or "" when it has none (clipboard bitmaps). */
  pathForFile(file: TransferFileLike): string;
  attachPaths(paths: string[]): Promise<PromptAttachment[]>;
  saveImage(input: {
    data: string;
    name: string;
    mimeType: PastedImageMimeType;
  }): Promise<PromptAttachment>;
}

export interface TransferIngestResult {
  attachments: PromptAttachment[];
  /** Names of files that had neither a path nor bitmap bytes. */
  unsupported: string[];
}

/** Turn transfer files into prompt attachments. Path-backed files (a Finder
 *  drop, a copied file) are attached by path through the main process, so
 *  the agent reads the original. Pathless bitmaps (a screenshot on the
 *  clipboard) are persisted through the capture store. */
export async function ingestTransferFiles(
  files: TransferFileLike[],
  deps: TransferIngestDeps,
): Promise<TransferIngestResult> {
  const paths: string[] = [];
  const bitmaps: Array<{ file: TransferFileLike; mimeType: PastedImageMimeType }> = [];
  const unsupported: string[] = [];
  for (const file of files) {
    const path = deps.pathForFile(file);
    if (path) {
      paths.push(path);
      continue;
    }
    const mimeType = pastedImageMimeType(file);
    if (mimeType) bitmaps.push({ file, mimeType });
    else unsupported.push(file.name);
  }
  const attachments: PromptAttachment[] = [];
  if (paths.length > 0) attachments.push(...await deps.attachPaths(paths));
  for (const { file, mimeType } of bitmaps) {
    attachments.push(await deps.saveImage({
      data: base64FromBytes(new Uint8Array(await file.arrayBuffer())),
      name: pastedImageName(file, mimeType),
      mimeType,
    }));
  }
  return { attachments, unsupported };
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
