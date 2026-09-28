import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  snapshotProjectAttachments,
  materializeProjectAttachments,
} from "./project-attachments.js";
import {
  projectPromptAttachments,
  projectContextText,
} from "@openmatter/project-host";
it("snapshots bytes before queuing and restores a file after its source disappears", async () => {
  const dir = await mkdtemp(join(tmpdir(), "project-attachment-"));
  try {
    const path = join(dir, "notes.txt");
    await writeFile(path, "original bytes");
    const files = await snapshotProjectAttachments([
      {
        id: "f",
        name: "notes.txt",
        path,
        uri: "file://" + path,
        kind: "file",
        mimeType: "text/plain",
      },
    ]);
    await rm(path);
    const items = [
      { kind: "event", value: { payload: { attachments: files } } },
    ];
    expect(projectPromptAttachments(items)).toEqual(files);
    expect(projectContextText(items)).not.toContain(files[0]!.data);
    const restored = await materializeProjectAttachments(files, join(dir, "restored"));
    expect(await readFile(restored[0]!.path, "utf8")).toBe("original bytes");
    expect(files[0]).not.toHaveProperty("path");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
