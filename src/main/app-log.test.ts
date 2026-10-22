import { context, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
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

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "backchat-app-log-"));
  roots.push(root);
  return root;
}

async function records(root: string, name = "backchat.log"): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(join(root, "logs", name), "utf8");
  return raw.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("persistent app diagnostics", () => {
  it("writes structured records with level and component under the active OMA root", async () => {
    const root = await tempRoot();
    configureAppLog(root);

    logAppEvent("acp.process.diagnostic", {
      session_id: "sess-log",
      agent_id: "codex-acp",
      line: "spawn codex app-server ENOENT",
    }, { level: "warn" });
    logAppEvent("app.renderer_crash", { message: "gone" }, { level: "error", component: "renderer" });
    logAppEvent("app.startup");
    await flushAppLog();

    const [diagnostic, crash, startup] = await records(root);
    expect(diagnostic).toMatchObject({
      level: "warn",
      component: "main",
      event: "acp.process.diagnostic",
      session_id: "sess-log",
      agent_id: "codex-acp",
      line: "spawn codex app-server ENOENT",
    });
    expect(diagnostic?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(crash).toMatchObject({ level: "error", component: "renderer" });
    expect(startup).toMatchObject({ level: "info", event: "app.startup" });
    expect(startup).not.toHaveProperty("trace_id");
  });

  it("correlates a record with the active span, unless the record carries its own ids", async () => {
    const root = await tempRoot();
    configureAppLog(root);
    // The Node provider installs the async context manager the app uses.
    const provider = new NodeTracerProvider();
    provider.register();
    const span = trace.getTracer("t").startSpan("work");
    context.with(trace.setSpan(context.active(), span), () => {
      logAppEvent("inside");
      logAppEvent("span.end", { trace_id: "a".repeat(32), span_id: "b".repeat(16) });
    });
    await flushAppLog();
    trace.disable();
    context.disable();
    const [inside, summary] = await records(root);
    expect(inside).toMatchObject({ trace_id: span.spanContext().traceId, span_id: span.spanContext().spanId });
    expect(summary).toMatchObject({ trace_id: "a".repeat(32), span_id: "b".repeat(16) });
  });

  it("rotates when the file would pass its size bound and keeps writing to backchat.log", async () => {
    const root = await tempRoot();
    const at = new Date(2026, 9, 18, 10, 0, 0);
    configureAppLog(root, { retention: { maxFileBytes: 300 }, clock: () => at });
    for (let index = 0; index < 6; index += 1) logAppEvent("tick", { index, pad: "x".repeat(20) });
    await flushAppLog();

    const rotated = (await readdir(join(root, "logs")))
      .filter((name) => name !== "backchat.log")
      .sort((a, b) => Number(/-(\d+)\.log$/.exec(a.replace("-100000.log", "-100000-0.log"))?.[1])
        - Number(/-(\d+)\.log$/.exec(b.replace("-100000.log", "-100000-0.log"))?.[1]));
    expect(rotated.length).toBeGreaterThan(1);
    expect(rotated[0]).toBe("backchat-20261018-100000.log");
    for (const name of [...rotated, "backchat.log"]) {
      const raw = await readFile(join(root, "logs", name), "utf8");
      expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(300);
    }
    const all: unknown[] = [];
    for (const name of [...rotated, "backchat.log"]) all.push(...(await records(root, name)).map((record) => record.index));
    expect(all).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("rotates an existing file from an earlier day on the first write", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "logs"), { recursive: true });
    const active = join(root, "logs", "backchat.log");
    await writeFile(active, `${JSON.stringify({ event: "yesterday" })}\n`);
    const yesterday = new Date(2026, 9, 17, 23, 0, 0);
    await utimes(active, yesterday, yesterday);
    configureAppLog(root, { clock: () => new Date(2026, 9, 18, 9, 30, 5) });
    logAppEvent("today");
    await flushAppLog();
    expect((await records(root)).map((record) => record.event)).toEqual(["today"]);
    expect((await records(root, "backchat-20261018-093005.log")).map((record) => record.event)).toEqual(["yesterday"]);
  });

  it("deletes only its own rotated files beyond the age and total bounds", async () => {
    const root = await tempRoot();
    const dir = join(root, "logs");
    await mkdir(dir, { recursive: true });
    const now = new Date(2026, 9, 18, 12, 0, 0);
    const file = async (name: string, bytes: number, ageDays: number) => {
      await writeFile(join(dir, name), "x".repeat(bytes));
      const time = new Date(now.getTime() - ageDays * 86_400_000);
      await utimes(join(dir, name), time, time);
    };
    await file("backchat-20261001-000000.log", 10, 17);
    await file("backchat-20261016-000000.log", 400, 2);
    await file("backchat-20261017-000000.log", 400, 1);
    await file("backchat-dev.log", 10, 30);
    await file("notes.txt", 10, 30);
    await writeFile(join(dir, "backchat.log"), "x".repeat(250));
    configureAppLog(root, { retention: { maxFileBytes: 300, maxTotalBytes: 1000, maxAgeDays: 7 }, clock: () => now });
    logAppEvent("rotate", { pad: "y".repeat(80) });
    await flushAppLog();

    expect((await readdir(dir)).sort()).toEqual([
      "backchat-20261017-000000.log",
      "backchat-20261018-120000.log",
      "backchat-dev.log",
      "backchat.log",
      "notes.txt",
    ]);
  });

  it("writes nothing when unconfigured", async () => {
    configureAppLog(null);
    logAppEvent("dropped");
    await expect(flushAppLog()).resolves.toBeUndefined();
  });
});
