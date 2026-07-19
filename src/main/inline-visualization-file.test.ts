import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readInlineVisualizationFile } from "./inline-visualization-file";
import * as inlineVisualizationFile from "./inline-visualization-file";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
  roots.length = 0;
});

describe("readInlineVisualizationFile", () => {
  it("reads a nested HTML fragment inside the session workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-inline-vis-"));
    roots.push(root);
    await mkdir(join(root, "visuals"));
    await writeFile(join(root, "visuals", "chart.html"), '<div id="chart">ok</div>');

    await expect(
      readInlineVisualizationFile({ cwd: root, file: "visuals/chart.html" }),
    ).resolves.toEqual({
      file: "visuals/chart.html",
      content: '<div id="chart">ok</div>',
    });
  });

  it("rejects traversal, non-HTML files, and oversized fragments", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-inline-vis-"));
    roots.push(root);
    await writeFile(join(root, "chart.txt"), "no");
    await writeFile(join(root, "huge.html"), "x".repeat(2 * 1024 * 1024 + 1));

    await expect(
      readInlineVisualizationFile({ cwd: root, file: "../secret.html" }),
    ).rejects.toThrow("inside the workspace");
    await expect(
      readInlineVisualizationFile({ cwd: root, file: "chart.txt" }),
    ).rejects.toThrow("HTML");
    await expect(
      readInlineVisualizationFile({ cwd: root, file: "huge.html" }),
    ).rejects.toThrow("2 MB");
  });

  it("resolves the newest thread-scoped Codex visualization outside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openma-inline-vis-workspace-"));
    const visualizationRoot = await mkdtemp(join(tmpdir(), "openma-inline-vis-codex-"));
    roots.push(workspace, visualizationRoot);
    await mkdir(join(visualizationRoot, "2026", "07", "16", "thread-a"), { recursive: true });
    await writeFile(
      join(visualizationRoot, "2026", "07", "16", "thread-a", "latency.html"),
      '<div id="latency">streaming</div>',
    );

    await expect(readInlineVisualizationFile(
      { cwd: workspace, file: "latency.html" },
      { visualizationRoot },
    )).resolves.toMatchObject({
      file: "latency.html",
      content: '<div id="latency">streaming</div>',
    });
  });

  it("notifies the host when a visualization fragment grows", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-inline-vis-watch-"));
    roots.push(root);
    await writeFile(join(root, "chart.html"), '<div id="chart">one</div>');
    let resolveChanged!: () => void;
    const changed = new Promise<void>((resolve) => { resolveChanged = resolve; });
    const watchInlineVisualizationFile = (inlineVisualizationFile as unknown as {
      watchInlineVisualizationFile?: (
        input: { cwd: string; file: string },
        onChange: () => void,
        options?: { interval?: number },
      ) => Promise<() => void>;
    }).watchInlineVisualizationFile;
    expect(typeof watchInlineVisualizationFile).toBe("function");
    if (!watchInlineVisualizationFile) return;
    const close = await watchInlineVisualizationFile(
      { cwd: root, file: "chart.html" },
      resolveChanged,
      { interval: 50 },
    );

    await writeFile(join(root, "chart.html"), '<div id="chart">one two</div>');
    await changed;
    close();
  });
});
