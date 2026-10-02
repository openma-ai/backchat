import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callControl } from "./client.mjs";
import { runCli } from "./backchat.mjs";
import { ExitCode } from "./exit-codes.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CLI streaming", () => {
  it("delivers the first NDJSON event before the response ends", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-stream-"));
    roots.push(root);
    const socketPath = join(root, "control.sock");
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
      res.write(`${JSON.stringify({ type: "permission", request_id: "perm-1" })}\n`);
      setTimeout(() => {
        res.write(`${JSON.stringify({ type: "result", status: "complete" })}\n`);
        res.end();
      }, 150);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
    const seen: string[] = [];
    const pending = callControl({
      socketPath,
      method: "session.send",
      params: { stream: true },
      onEvent: (event: { type?: string }) => {
        if (event.type) seen.push(event.type);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toEqual(["permission"]);
    await expect(pending).resolves.toMatchObject({
      events: [{ type: "permission" }, { type: "result" }],
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("prints --json argument errors as JSON on stderr", async () => {
    const stderr: string[] = [];
    const code = await runCli(["--json", "project", "create"], {}, {
      stdout: () => undefined,
      stderr: (line: string) => stderr.push(line),
    });
    expect(code).toBe(ExitCode.invalidArgs);
    expect(JSON.parse(stderr[0] ?? "{}")).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
  });
});
