import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { configureAppLog, flushAppLog } from "./app-log.js";
import { logRendererCrash } from "./renderer-crash-log.js";

const roots: string[] = [];

afterEach(async () => {
  configureAppLog(null);
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("renderer crash logging", () => {
  it("writes structured renderer crash events to backchat.log", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-renderer-crash-"));
    roots.push(root);
    configureAppLog(root);

    logRendererCrash({
      source: "error-boundary",
      message: "Cannot read properties of undefined",
      stack: "TypeError: Cannot read properties of undefined\n    at Chat",
      componentStack: "\n    in ChatView",
    });
    await flushAppLog();

    const raw = await readFile(join(root, "logs", "backchat.log"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry).toMatchObject({
      event: "app.renderer_crash",
      source: "error-boundary",
      message: "Cannot read properties of undefined",
      stack: expect.stringContaining("TypeError"),
      component_stack: expect.stringContaining("ChatView"),
    });
  });
});
