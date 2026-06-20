import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { exportSessionFiles, launchApp, persistSessionFixture } from "./helpers";

test.describe("file-first transcript export", () => {
  test("exports persisted SQLite sessions to JSONL and TOML files", async () => {
    const { page, home, cleanup } = await launchApp();
    try {
      const sessionId = "e2e-export";
      const title = "Export this: e2e-file-first-token";
      await persistSessionFixture(page, {
        sessionId,
        agentId: "codex-acp",
        cwd: join(home, "sessions", sessionId),
        acpSessionId: "",
        title,
        events: [
          { type: "user_prompt", data: { text: title } },
          { type: "agent_message", data: { text: "File-first export completed." } },
        ],
      });

      const result = await exportSessionFiles(page);

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        sessionId,
        eventCount: 2,
        skipped: false,
      });
      expect(result.sessions[0]!.transcriptPath.startsWith(home)).toBe(true);
      expect(result.sessions[0]!.metadataPath.startsWith(home)).toBe(true);

      const transcriptLines = (await readFile(result.sessions[0]!.transcriptPath, "utf-8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(transcriptLines).toMatchObject([
        {
          schema_version: "backchat.session_event.v1",
          seq: 1,
          type: "user_prompt",
          data: { text: title },
          source: "desktop",
        },
        {
          schema_version: "backchat.session_event.v1",
          seq: 2,
          type: "agent_message",
          data: { text: "File-first export completed." },
          source: "desktop",
        },
      ]);

      const metadata = parseToml(
        await readFile(result.sessions[0]!.metadataPath, "utf-8"),
      ) as Record<string, unknown>;
      expect(metadata).toMatchObject({
        schema_version: "backchat.session_meta.v1",
        session_id: sessionId,
        agent_id: "codex-acp",
        title,
        workdir: join(home, "sessions", sessionId),
      });
    } finally {
      await cleanup();
    }
  });

  test("skips existing transcript files unless overwrite is set", async () => {
    const { page, home, cleanup } = await launchApp();
    try {
      const sessionId = "e2e-export-overwrite";
      const title = "Export overwrite guard";
      await persistSessionFixture(page, {
        sessionId,
        agentId: "codex-acp",
        cwd: join(home, "sessions", sessionId),
        acpSessionId: "",
        title,
        events: [
          { type: "user_prompt", data: { text: title } },
          { type: "agent_message", data: { text: "Overwrite guard completed." } },
        ],
      });

      const first = await exportSessionFiles(page);
      const exported = first.sessions[0]!;
      await writeFile(exported.transcriptPath, "user edited transcript\n", "utf-8");

      const skipped = await exportSessionFiles(page);

      expect(skipped.sessions[0]).toMatchObject({
        sessionId,
        skipped: true,
      });
      await expect
        .poll(() => readFile(exported.transcriptPath, "utf-8"))
        .toBe("user edited transcript\n");

      const overwritten = await exportSessionFiles(page, { overwrite: true });

      expect(overwritten.sessions[0]).toMatchObject({
        sessionId,
        skipped: false,
      });
      const transcript = await readFile(exported.transcriptPath, "utf-8");
      expect(transcript).toContain('"schema_version":"backchat.session_event.v1"');
      expect(transcript).toContain("Overwrite guard completed.");
    } finally {
      await cleanup();
    }
  });
});
