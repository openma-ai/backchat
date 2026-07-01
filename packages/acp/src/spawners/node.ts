/**
 * NodeSpawner — `child_process.spawn` adapter to the cross-host ChildHandle
 * shape. Vendored from @open-managed-agents/acp-runtime (Apache-2.0).
 */

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { AgentSpec, ChildHandle, Spawner } from "../types.js";

export class NodeSpawner implements Spawner {
  async spawn(spec: AgentSpec): Promise<ChildHandle> {
    const merged: Record<string, string | undefined> = {
      ...process.env,
      ...(spec.env ?? {}),
    };
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(merged)) {
      if (typeof v === "string") env[k] = v;
    }
    const child: ChildProcessWithoutNullStreams = nodeSpawn(spec.command, spec.args ?? [], {
      env,
      cwd: spec.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (spec.onDiagnosticLine) {
      let stderrBuffer = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) spec.onDiagnosticLine?.(line);
      });
      child.stderr.on("end", () => {
        if (stderrBuffer) spec.onDiagnosticLine?.(stderrBuffer);
      });
    }

    const stdin = (Writable as unknown as {
      toWeb(s: NodeJS.WritableStream): WritableStream<Uint8Array>;
    }).toWeb(child.stdin);
    const stdout = (Readable as unknown as {
      toWeb(s: NodeJS.ReadableStream): ReadableStream<Uint8Array>;
    }).toWeb(child.stdout);
    const stderr = (Readable as unknown as {
      toWeb(s: NodeJS.ReadableStream): ReadableStream<Uint8Array>;
    }).toWeb(child.stderr);

    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      let settled = false;
      const settle = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal });
      };
      child.once("exit", settle);
      child.once("close", settle);
      child.once("error", () => settle(null, null));
    });

    const kill = async (signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      await exited;
    };

    return { stdin, stdout, stderr, kill, exited };
  }
}
