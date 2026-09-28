import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  PROJECT_ATTACHMENT_LIMIT,
  validateProjectAttachments,
  type ProjectAttachment,
} from "@openmatter/project-host";
import type { PromptAttachment } from "../shared/session-events.js";
import { openmaRoot } from "./storage-root.js";

export async function snapshotProjectAttachments(
  files: readonly PromptAttachment[] = [],
): Promise<ProjectAttachment[]> {
  if (files.length > 20) throw new Error("Attach up to 20 files");
  const result: ProjectAttachment[] = [];
  let total = 0;
  for (const file of files) {
    let data = file.data;
    if (data === undefined) {
      const info = await stat(file.path);
      if (!info.isFile() || total + info.size > PROJECT_ATTACHMENT_LIMIT)
        throw new Error("Attachments must be files totaling 20 MB or less");
      data = (await readFile(file.path)).toString("base64");
    }
    total += Buffer.byteLength(data, "base64");
    result.push({
      id: file.id,
      name: file.name,
      kind: file.kind,
      mimeType: file.mimeType || "application/octet-stream",
      data,
    });
    validateProjectAttachments(result);
  }
  return result;
}
export async function materializeProjectAttachments(
  files: readonly ProjectAttachment[],
  root = join(openmaRoot(), "backchat", "projects", "attachments"),
): Promise<PromptAttachment[]> {
  return Promise.all(
    files.map(async (file) => {
      const hash = createHash("sha256").update(file.data).digest("hex");
      const directory = join(root, hash);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const name =
        file.name.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "_") ||
        "attachment";
      const path = join(directory, name);
      await writeFile(path, Buffer.from(file.data, "base64"), { mode: 0o600 });
      return {
        ...file,
        path,
        uri: pathToFileURL(path).href,
        size: Buffer.byteLength(file.data, "base64"),
      };
    }),
  );
}
