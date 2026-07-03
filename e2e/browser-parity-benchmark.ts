import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BROWSER_PARITY_BENCHMARK_PLAN,
  buildBrowserParityEvidencePack,
  compareBrowserParityTracePair,
  selectStableBrowserParityTasks,
  type BrowserParityTrace,
  type BrowserParityTraceComparison,
} from "../src/shared/browser-parity-benchmark.js";
import { readImageDimensionsFromBytes } from "../src/shared/image-dimensions.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const outputDir = join(repoRoot, "artifacts/browser-parity-benchmark");

interface TracePairInput {
  id: string;
  taskId: string;
  leftPath: string;
  rightPath: string;
}

const tracePairs: TracePairInput[] = [
  {
    id: "iab-local-fixture",
    taskId: "custom.local-fixture.basic-form",
    leftPath: "artifacts/browser-tool-diff/codex-native-iab.json",
    rightPath: "artifacts/browser-tool-diff/backchat-iab.json",
  },
  {
    id: "chrome-local-fixture",
    taskId: "custom.local-fixture.basic-form",
    leftPath: "artifacts/browser-tool-diff/codex-native-chrome.json",
    rightPath: "artifacts/browser-tool-diff/backchat-chrome.json",
  },
  {
    id: "iab-miniwob-click-button",
    taskId: "miniwob.click-button",
    leftPath: "artifacts/browser-miniwob-diff/codex-native-iab-click-button.json",
    rightPath: "artifacts/browser-miniwob-diff/backchat-iab-click-button.json",
  },
  {
    id: "chrome-miniwob-click-button",
    taskId: "miniwob.click-button",
    leftPath: "artifacts/browser-miniwob-diff/codex-native-chrome-click-button.json",
    rightPath: "artifacts/browser-miniwob-diff/backchat-chrome-click-button.json",
  },
  {
    id: "iab-miniwob-enter-text",
    taskId: "miniwob.enter-text",
    leftPath: "artifacts/browser-miniwob-diff/codex-native-iab-enter-text.json",
    rightPath: "artifacts/browser-miniwob-diff/backchat-iab-enter-text.json",
  },
  {
    id: "chrome-miniwob-enter-text",
    taskId: "miniwob.enter-text",
    leftPath: "artifacts/browser-miniwob-diff/codex-native-chrome-enter-text.json",
    rightPath: "artifacts/browser-miniwob-diff/backchat-chrome-enter-text.json",
  },
  {
    id: "iab-wikipedia-selenium",
    taskId: "webvoyager.wikipedia.selenium-search",
    leftPath: "artifacts/browser-real-site-diff/codex-native-iab-wikipedia.json",
    rightPath: "artifacts/browser-real-site-diff/backchat-iab-wikipedia.json",
  },
  {
    id: "chrome-wikipedia-selenium",
    taskId: "webvoyager.wikipedia.selenium-search",
    leftPath: "artifacts/browser-real-site-diff/codex-native-chrome-wikipedia.json",
    rightPath: "artifacts/browser-real-site-diff/backchat-chrome-wikipedia.json",
  },
];

async function main(): Promise<void> {
  const comparisons: BrowserParityTraceComparison[] = [];
  const missingPairs: Array<{ id: string; missing: string[] }> = [];

  for (const pair of tracePairs) {
    const leftAbs = join(repoRoot, pair.leftPath);
    const rightAbs = join(repoRoot, pair.rightPath);
    const missing = [leftAbs, rightAbs].filter((candidate) => !existsSync(candidate));
    if (missing.length > 0) {
      missingPairs.push({ id: pair.id, missing });
      continue;
    }

    const [left, right] = await Promise.all([
      readTrace(leftAbs),
      readTrace(rightAbs),
    ]);
    comparisons.push(compareBrowserParityTracePair({
      id: pair.id,
      taskId: pair.taskId,
      left,
      right,
    }));
  }

  const tasks = selectStableBrowserParityTasks(DEFAULT_BROWSER_PARITY_BENCHMARK_PLAN);
  const pack = {
    ...buildBrowserParityEvidencePack({
      generatedAt: new Date().toISOString(),
      tasks,
      comparisons,
    }),
    missingPairs,
    sources: {
      miniwobPlusPlus: "https://github.com/Farama-Foundation/miniwob-plusplus",
      webVoyager: "https://github.com/MinorJerry/WebVoyager",
      onlineMind2Web: "https://github.com/OSU-NLP-Group/Online-Mind2Web",
      browserGym: "https://github.com/ServiceNow/BrowserGym",
    },
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "manifest.json"),
    `${JSON.stringify(pack, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(outputDir, "summary.md"), renderSummary(pack), "utf8");
  console.log(`Wrote ${join(outputDir, "manifest.json")}`);
  console.log(`Wrote ${join(outputDir, "summary.md")}`);
  console.log(JSON.stringify(pack.summary, null, 2));
}

async function readTrace(path: string): Promise<BrowserParityTrace> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as BrowserParityTrace;
  const screenshotPath = parsed.artifacts?.screenshot ?? stringOrNull(parsed.observations.screenshotPath);
  if (screenshotPath) {
    const absoluteScreenshotPath = isAbsolute(screenshotPath)
      ? screenshotPath
      : join(repoRoot, screenshotPath);
    if (existsSync(absoluteScreenshotPath)) {
      const dimensions = readImageDimensionsFromBytes(await readFile(absoluteScreenshotPath));
      if (dimensions) {
        parsed.observations.screenshotWidth = dimensions.width;
        parsed.observations.screenshotHeight = dimensions.height;
      }
    }
  }
  return parsed;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function renderSummary(pack: ReturnType<typeof buildBrowserParityEvidencePack> & {
  missingPairs: Array<{ id: string; missing: string[] }>;
  sources: Record<string, string>;
}): string {
  const lines = [
    "# Backchat Browser Parity Benchmark Evidence",
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Tasks selected: ${pack.summary.totalTasks}`,
    `- Comparisons completed: ${pack.summary.completedComparisons}`,
    `- Passing comparisons: ${pack.summary.passingComparisons}`,
    `- Partial comparisons: ${pack.summary.partialComparisons}`,
    `- Failing comparisons: ${pack.summary.failingComparisons}`,
    `- Missing pairs: ${pack.missingPairs.length}`,
    "",
    "## Completed Comparisons",
    "",
  ];

  for (const comparison of pack.comparisons) {
    lines.push(
      `### ${comparison.id}`,
      "",
      `- Task: ${comparison.taskId}`,
      `- Surfaces: ${comparison.left.surface} vs ${comparison.right.surface}`,
      `- Status: ${comparison.status}`,
      `- Left screenshot: ${comparison.left.screenshot ?? "none"}`,
      `- Right screenshot: ${comparison.right.screenshot ?? "none"}`,
      `- Diffs: ${comparison.diffs.length === 0 ? "none" : comparison.diffs.map((diff) => diff.field).join(", ")}`,
      "",
    );
  }

  if (pack.parityGaps.length > 0) {
    lines.push("## Parity Gaps", "");
    for (const gap of pack.parityGaps) {
      lines.push(`- ${gap.pairId} / ${gap.field}: ${String(gap.left)} vs ${String(gap.right)}`);
    }
    lines.push("");
  }

  lines.push("## Selected Task Sources", "");
  for (const task of pack.tasks) {
    lines.push(`- ${task.id}: ${task.source}; coverage=${task.coverage.join(", ")}`);
  }
  lines.push("");
  lines.push("## Benchmark References", "");
  for (const [name, url] of Object.entries(pack.sources)) {
    lines.push(`- ${name}: ${url}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

await main();
