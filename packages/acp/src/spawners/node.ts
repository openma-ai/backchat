/**
 * NodeSpawner — `child_process.spawn` adapter to the cross-host ChildHandle
 * shape. Vendored from @open-managed-agents/acp-runtime (Apache-2.0).
 */

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
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

    const stdin = nodeWritableToWeb(child.stdin);
    const stdout = nodeReadableToWeb(child.stdout);
    const stderr = nodeReadableToWeb(child.stderr);

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

function nodeReadableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const cleanup = () => {
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("close", onEnd);
        stream.off("error", onError);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const onData = (chunk: Buffer | string) => {
        if (closed) return;
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        try {
          controller.enqueue(new Uint8Array(bytes));
        } catch {
          closed = true;
          cleanup();
        }
      };
      const onEnd = () => close();
      const onError = (error: Error) => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.error(error);
        } catch {
          /* already closed */
        }
      };

      stream.on("data", onData);
      stream.once("end", onEnd);
      stream.once("close", onEnd);
      stream.once("error", onError);
    },
    cancel() {
      stream.destroy();
    },
  });
}

function nodeWritableToWeb(stream: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      if (stream.destroyed || stream.writableEnded) return;
      return new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          stream.off("error", onError);
          stream.off("drain", onDrain);
        };
        stream.once("error", onError);
        const canContinue = stream.write(Buffer.from(chunk), (error?: Error | null) => {
          if (error) onError(error);
          else if (canContinue) {
            cleanup();
            resolve();
          }
        });
        if (!canContinue) stream.once("drain", onDrain);
      });
    },
    close() {
      if (stream.destroyed || stream.writableEnded) return;
      return new Promise<void>((resolve) => stream.end(resolve));
    },
    abort() {
      stream.destroy();
    },
  });
}
