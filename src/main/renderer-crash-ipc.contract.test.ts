import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer crash IPC contract", () => {
  it("registers the renderer crash log invoke channel end-to-end", () => {
    const channels = readFileSync(
      resolve(__dirname, "../shared/ipc-channels.ts"),
      "utf8",
    );
    const ipc = readFileSync(resolve(__dirname, "ipc.ts"), "utf8");
    const preload = readFileSync(
      resolve(__dirname, "../preload/index.ts"),
      "utf8",
    );
    const api = readFileSync(
      resolve(__dirname, "../shared/api.ts"),
      "utf8",
    );
    const main = readFileSync(resolve(__dirname, "index.ts"), "utf8");
    const entry = readFileSync(
      resolve(__dirname, "../renderer/src/main.tsx"),
      "utf8",
    );

    expect(channels).toContain('AppRendererCrashLog: "app:rendererCrashLog"');
    expect(ipc).toContain("InvokeChannel.AppRendererCrashLog");
    expect(ipc).toContain("logRendererCrash(report)");
    expect(preload).toContain("rendererCrashLog");
    expect(api).toContain("rendererCrashLog");
    expect(main).toContain('source: "render-process-gone"');
    expect(main).toContain('source: "unresponsive"');
    expect(entry).toContain("RendererErrorBoundary");
    expect(entry).toContain("RendererCrashPage");
    expect(entry).toContain("installRendererCrashHandlers");
  });
});
