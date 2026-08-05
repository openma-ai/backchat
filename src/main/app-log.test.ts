import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureAppLog,
  flushAppLog,
  logAppEvent,
} from "./app-log.js";

const roots: string[] = [];

afterEach(async () => {
  configureAppLog(null);
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("persistent app diagnostics", () => {
  it("writes structured ACP lifecycle events under the active OMA root", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-app-log-"));
    roots.push(root);
    configureAppLog(root);

    logAppEvent("acp.process.diagnostic", {
      session_id: "sess-log",
      agent_id: "codex-acp",
      line: "spawn codex app-server ENOENT",
    });
    await flushAppLog();

    const raw = await readFile(join(root, "logs", "backchat.log"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry).toMatchObject({
      event: "acp.process.diagnostic",
      session_id: "sess-log",
      agent_id: "codex-acp",
      line: "spawn codex app-server ENOENT",
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
