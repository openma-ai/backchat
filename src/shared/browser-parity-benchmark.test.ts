import { describe, expect, it } from "vitest";

import {
  DEFAULT_BROWSER_PARITY_BENCHMARK_PLAN,
  buildBrowserParityEvidencePack,
  compareBrowserParityTracePair,
  selectStableBrowserParityTasks,
  type BrowserParityTrace,
} from "./browser-parity-benchmark.js";

describe("browser parity benchmark", () => {
  it("selects stable low-side-effect tasks from synthetic and real-web benchmarks", () => {
    const selected = selectStableBrowserParityTasks(DEFAULT_BROWSER_PARITY_BENCHMARK_PLAN);

    expect(selected.map((task) => task.id)).toContain("miniwob.click-button");
    expect(selected.map((task) => task.id)).toContain("webvoyager.wikipedia.selenium-search");
    expect(selected.map((task) => task.id)).toContain("online-mind2web.wikipedia.article-search");
    expect(selected.every((task) => task.requiresAuth === false)).toBe(true);
    expect(selected.every((task) => task.sideEffectLevel === "read-only")).toBe(true);
    expect(new Set(selected.flatMap((task) => task.coverage)).has("viewport")).toBe(true);
    expect(new Set(selected.flatMap((task) => task.coverage)).has("real-site-dynamic-content")).toBe(true);
  });

  it("normalizes trace shape drift before comparing Codex and Backchat results", () => {
    const codex: BrowserParityTrace = {
      surface: "codex-native-chrome",
      ok: true,
      observations: {
        url: "https://en.wikipedia.org/wiki/Selenium_(software)",
        title: "Selenium (software) - Wikipedia",
        heading: "Selenium (software)",
        firstParagraphSnippet: "Selenium is an open source umbrella project.",
        linkCount: 317,
        domSnapshotContainsSelenium: true,
        screenshotMimeType: "image/jpeg",
        screenshotBase64Length: 1_649_332,
        tabClosed: true,
      },
      artifacts: { screenshot: "/tmp/codex.jpg" },
      steps: [{ name: "search", ok: true }],
      errors: [],
    };
    const backchat: BrowserParityTrace = {
      surface: "backchat-chrome",
      ok: true,
      observations: {
        finalUrl: "https://en.wikipedia.org/wiki/Selenium_(software)",
        title: "Selenium (software) - Wikipedia",
        heading: "Selenium (software)",
        firstParagraphSnippet: "Selenium is an open source umbrella project.",
        linkCount: 336,
        domSnapshotContainsSelenium: true,
        screenshotMimeType: "image/jpeg",
        screenshotBase64Length: 448_036,
        tabClosed: true,
      },
      artifacts: { screenshot: "/tmp/backchat.jpg" },
      steps: [{ name: "search", ok: true }],
      errors: [],
    };

    const comparison = compareBrowserParityTracePair({
      id: "chrome-wikipedia",
      taskId: "webvoyager.wikipedia.selenium-search",
      left: codex,
      right: backchat,
    });

    expect(comparison.matches.finalUrl).toBe(true);
    expect(comparison.matches.title).toBe(true);
    expect(comparison.matches.heading).toBe(true);
    expect(comparison.matches.tabClosed).toBe(true);
    expect(comparison.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "linkCount", left: 317, right: 336 }),
        expect.objectContaining({
          field: "screenshotBase64Length",
          left: 1_649_332,
          right: 448_036,
        }),
      ]),
    );
  });

  it("compares MiniWoB++ success fields while treating time-scaled reward as a recorded diff", () => {
    const codex: BrowserParityTrace = {
      surface: "codex-native-iab",
      ok: true,
      observations: {
        finalUrl: "http://127.0.0.1:61234/miniwob/click-button.html",
        title: "Click Button Task",
        miniwobTaskId: "click-button",
        benchmarkInstanceId: "miniwob.click-button:seed:button-v1",
        seed: "button-v1",
        utterance: 'Click on the "OK" button.',
        wobDone: true,
        wobRawReward: 1,
        wobReward: 0.97,
        domSnapshotContainsUtterance: true,
        screenshotMimeType: "image/jpeg",
        screenshotBase64Length: 120_000,
        tabClosed: true,
      },
      artifacts: { screenshot: "/tmp/codex-miniwob.jpg" },
      steps: [{ name: "solve", ok: true }],
      errors: [],
    };
    const backchat: BrowserParityTrace = {
      surface: "backchat-iab",
      ok: true,
      observations: {
        finalUrl: "http://127.0.0.1:61234/miniwob/click-button.html",
        title: "Click Button Task",
        miniwobTaskId: "click-button",
        benchmarkInstanceId: "miniwob.click-button:seed:button-v1",
        seed: "button-v1",
        utterance: 'Click on the "OK" button.',
        wobDone: true,
        wobRawReward: 1,
        wobReward: 0.91,
        domSnapshotContainsUtterance: true,
        screenshotMimeType: "image/jpeg",
        screenshotBase64Length: 120_000,
        tabClosed: true,
      },
      artifacts: { screenshot: "/tmp/backchat-miniwob.jpg" },
      steps: [{ name: "solve", ok: true }],
      errors: [],
    };

    const comparison = compareBrowserParityTracePair({
      id: "iab-miniwob-click-button",
      taskId: "miniwob.click-button",
      left: codex,
      right: backchat,
    });

    expect(comparison.status).toBe("pass");
    expect(comparison.matches.miniwobTaskId).toBe(true);
    expect(comparison.matches.benchmarkInstanceId).toBe(true);
    expect(comparison.matches.seed).toBe(true);
    expect(comparison.matches.utterance).toBe(true);
    expect(comparison.matches.wobDone).toBe(true);
    expect(comparison.matches.wobRawReward).toBe(true);
    expect(comparison.matches.domSnapshotContainsUtterance).toBe(true);
    expect(comparison.diffs).toEqual([
      { field: "wobReward", left: 0.97, right: 0.91 },
    ]);
  });

  it("treats screenshot geometry mismatches as parity mismatches", () => {
    const comparison = compareBrowserParityTracePair({
      id: "iab-miniwob-click-button",
      taskId: "miniwob.click-button",
      left: {
        surface: "codex-native-iab",
        ok: true,
        observations: {
          finalUrl: "http://127.0.0.1:61234/miniwob/click-button.html",
          title: "Click Button Task",
          miniwobTaskId: "click-button",
          benchmarkInstanceId: "miniwob.click-button:seed:button-v1",
          seed: "button-v1",
          utterance: 'Click on the "OK" button.',
          wobDone: true,
          wobRawReward: 1,
          domSnapshotContainsUtterance: true,
          screenshotMimeType: "image/jpeg",
          screenshotWidth: 960,
          screenshotHeight: 640,
          tabClosed: true,
        },
        artifacts: { screenshot: "/tmp/codex-miniwob.jpg" },
        steps: [{ name: "solve", ok: true }],
        errors: [],
      },
      right: {
        surface: "backchat-iab",
        ok: true,
        observations: {
          finalUrl: "http://127.0.0.1:61234/miniwob/click-button.html",
          title: "Click Button Task",
          miniwobTaskId: "click-button",
          benchmarkInstanceId: "miniwob.click-button:seed:button-v1",
          seed: "button-v1",
          utterance: 'Click on the "OK" button.',
          wobDone: true,
          wobRawReward: 1,
          domSnapshotContainsUtterance: true,
          screenshotMimeType: "image/jpeg",
          screenshotWidth: 2560,
          screenshotHeight: 1440,
          tabClosed: true,
        },
        artifacts: { screenshot: "/tmp/backchat-miniwob.jpg" },
        steps: [{ name: "solve", ok: true }],
        errors: [],
      },
    });

    expect(comparison.status).toBe("partial");
    expect(comparison.matches.screenshotWidth).toBe(false);
    expect(comparison.matches.screenshotHeight).toBe(false);
    expect(comparison.diffs).toEqual(
      expect.arrayContaining([
        { field: "screenshotWidth", left: 960, right: 2560 },
        { field: "screenshotHeight", left: 640, right: 1440 },
      ]),
    );
  });

  it("records real-site full-page height drift without failing semantic parity", () => {
    const comparison = compareBrowserParityTracePair({
      id: "iab-wikipedia-selenium",
      taskId: "webvoyager.wikipedia.selenium-search",
      left: {
        surface: "codex-native-iab",
        ok: true,
        observations: {
          finalUrl: "https://en.wikipedia.org/wiki/Selenium_(software)",
          title: "Selenium (software) - Wikipedia",
          heading: "Selenium (software)",
          firstParagraphSnippet: "Selenium is an open source project.",
          linkCount: 310,
          domSnapshotContainsSelenium: true,
          screenshotMimeType: "image/jpeg",
          screenshotWidth: 1265,
          screenshotHeight: 7360,
          tabClosed: true,
        },
        artifacts: { screenshot: "/tmp/codex-wikipedia.jpg" },
        steps: [{ name: "run", ok: true }],
        errors: [],
      },
      right: {
        surface: "backchat-iab",
        ok: true,
        observations: {
          finalUrl: "https://en.wikipedia.org/wiki/Selenium_(software)",
          title: "Selenium (software) - Wikipedia",
          heading: "Selenium (software)",
          firstParagraphSnippet: "Selenium is an open source project.",
          linkCount: 335,
          domSnapshotContainsSelenium: true,
          screenshotMimeType: "image/jpeg",
          screenshotWidth: 1265,
          screenshotHeight: 7747,
          tabClosed: true,
        },
        artifacts: { screenshot: "/tmp/backchat-wikipedia.jpg" },
        steps: [{ name: "run", ok: true }],
        errors: [],
      },
    });

    expect(comparison.status).toBe("pass");
    expect(comparison.diffs).toEqual(
      expect.arrayContaining([
        { field: "screenshotHeight", left: 7360, right: 7747 },
        { field: "linkCount", left: 310, right: 335 },
      ]),
    );
  });

  it("builds an auditable evidence pack with coverage and parity gaps", () => {
    const tasks = selectStableBrowserParityTasks(DEFAULT_BROWSER_PARITY_BENCHMARK_PLAN);
    const pack = buildBrowserParityEvidencePack({
      generatedAt: "2026-07-03T00:00:00.000Z",
      tasks,
      comparisons: [
        compareBrowserParityTracePair({
          id: "iab-local-fixture",
          taskId: "miniwob.click-button",
          left: {
            surface: "codex-native-iab",
            ok: true,
            observations: {
              finalUrl: "http://127.0.0.1/fixture",
              title: "Fixture",
              heading: "Fixture",
              resultAfterPing: "Ada:1",
              trustedResult: "trusted",
              domSnapshotContainsHeading: true,
              screenshotMimeType: "image/jpeg",
              screenshotBase64Length: 21_500,
              tabClosed: true,
            },
            artifacts: { screenshot: "/tmp/codex-iab.jpg" },
            steps: [{ name: "run", ok: true }],
            errors: [],
          },
          right: {
            surface: "backchat-iab",
            ok: true,
            observations: {
              finalUrl: "http://127.0.0.1/fixture",
              title: "Fixture",
              heading: "Fixture",
              resultAfterPing: "Ada:1",
              trustedResult: "trusted",
              domSnapshotContainsHeading: true,
              screenshotMimeType: "image/jpeg",
              screenshotBase64Length: 77_144,
              tabClosed: true,
            },
            artifacts: { screenshot: "/tmp/backchat-iab.jpg" },
            steps: [{ name: "run", ok: true }],
            errors: [],
          },
        }),
      ],
    });

    expect(pack.summary.totalTasks).toBeGreaterThanOrEqual(3);
    expect(pack.summary.completedComparisons).toBe(1);
    expect(pack.coverage).toEqual(
      expect.arrayContaining(["viewport", "screenshot", "tab-lifecycle"]),
    );
    expect(pack.parityGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pairId: "iab-local-fixture", field: "screenshotBase64Length" }),
      ]),
    );
  });
});
