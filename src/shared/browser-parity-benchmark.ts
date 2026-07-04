export type BrowserParityBenchmarkSource =
  | "miniwob++"
  | "webvoyager"
  | "online-mind2web"
  | "custom-smoke";

export type BrowserParityCoverage =
  | "auth"
  | "clipboard"
  | "dialogs"
  | "viewport"
  | "screenshot"
  | "dom-snapshot"
  | "error-recovery"
  | "extension-ux"
  | "iframe"
  | "installation"
  | "locator"
  | "permissions"
  | "shadow-dom"
  | "tab-lifecycle"
  | "chrome-extension"
  | "real-site-dynamic-content"
  | "input"
  | "navigation"
  | "upload-download"
  | "visual-regression";

export type BrowserParitySideEffectLevel = "read-only" | "local-only" | "external-write";
export type BrowserParityTaskStability = "stable" | "candidate" | "blocked";

export interface BrowserParityBenchmarkTask {
  id: string;
  source: BrowserParityBenchmarkSource;
  title: string;
  startUrl: string;
  instruction: string;
  successCriteria: string[];
  coverage: BrowserParityCoverage[];
  requiresAuth: boolean;
  sideEffectLevel: BrowserParitySideEffectLevel;
  stability: BrowserParityTaskStability;
  notes?: string;
}

export interface BrowserParityBenchmarkPlan {
  tasks: BrowserParityBenchmarkTask[];
}

export interface BrowserParityTrace {
  surface: string;
  ok: boolean;
  observations: Record<string, unknown>;
  artifacts?: Record<string, string | undefined>;
  steps?: Array<{ name: string; ok: boolean; summary?: unknown; error?: string }>;
  errors?: string[] | null;
}

export interface NormalizedBrowserParityTrace {
  surface: string;
  ok: boolean;
  finalUrl: string | null;
  title: string | null;
  heading: string | null;
  resultAfterPing: string | null;
  trustedResult: string | null;
  firstParagraphSnippet: string | null;
  paragraphHasSelenium: boolean | null;
  linkCount: number | null;
  miniwobTaskId: string | null;
  benchmarkInstanceId: string | null;
  seed: string | null;
  utterance: string | null;
  wobDone: boolean | null;
  wobRawReward: number | null;
  wobReward: number | null;
  domSnapshotContainsHeading: boolean | null;
  domSnapshotContainsSelenium: boolean | null;
  domSnapshotContainsUtterance: boolean | null;
  screenshotMimeType: string | null;
  screenshotWidth: number | null;
  screenshotHeight: number | null;
  screenshotBase64Length: number | null;
  tabClosed: boolean | null;
  screenshot: string | null;
  stepCount: number;
  failedSteps: string[];
  errors: string[];
}

export interface BrowserParityTraceComparison {
  id: string;
  taskId: string;
  left: NormalizedBrowserParityTrace;
  right: NormalizedBrowserParityTrace;
  matches: Record<string, boolean>;
  diffs: Array<{ field: string; left: unknown; right: unknown }>;
  status: "pass" | "partial" | "fail";
}

export type BrowserParityAcceptedDifferenceCategory =
  | "dynamic-content"
  | "dynamic-visual"
  | "encoded-visual"
  | "harness-implementation"
  | "timing-reward";

export interface BrowserParityAcceptedDifference {
  pairId: string;
  taskId: string;
  field: string;
  left: unknown;
  right: unknown;
  category: BrowserParityAcceptedDifferenceCategory;
  reason: string;
}

export interface BrowserParityUnexplainedGap {
  pairId: string;
  taskId: string;
  field: string;
  left: unknown;
  right: unknown;
  reason: string;
}

export interface BrowserParityGapAudit {
  requiredCoverage: BrowserParityCoverage[];
  missingCoverage: BrowserParityCoverage[];
  evidenceSources: BrowserParityEvidenceSource[];
  acceptedDifferences: BrowserParityAcceptedDifference[];
  unexplainedGaps: BrowserParityUnexplainedGap[];
  summary: {
    acceptedDifferences: number;
    unexplainedGaps: number;
    missingCoverage: number;
  };
}

export interface BrowserParityEvidenceSource {
  id: string;
  title: string;
  status: "verified" | "missing" | "stale";
  coverage: BrowserParityCoverage[];
  evidence: string[];
  notes?: string;
}

export interface BrowserParityEvidencePack {
  generatedAt: string;
  tasks: BrowserParityBenchmarkTask[];
  comparisons: BrowserParityTraceComparison[];
  evidenceSources: BrowserParityEvidenceSource[];
  coverage: BrowserParityCoverage[];
  parityGaps: Array<{ pairId: string; taskId: string; field: string; left: unknown; right: unknown }>;
  gapAudit: BrowserParityGapAudit;
  summary: {
    totalTasks: number;
    completedComparisons: number;
    passingComparisons: number;
    partialComparisons: number;
    failingComparisons: number;
  };
}

export const DEFAULT_BROWSER_PARITY_REQUIRED_COVERAGE: BrowserParityCoverage[] = [
  "auth",
  "chrome-extension",
  "clipboard",
  "dialogs",
  "dom-snapshot",
  "error-recovery",
  "extension-ux",
  "iframe",
  "input",
  "installation",
  "locator",
  "navigation",
  "permissions",
  "real-site-dynamic-content",
  "screenshot",
  "shadow-dom",
  "tab-lifecycle",
  "upload-download",
  "viewport",
  "visual-regression",
];

export const DEFAULT_BROWSER_PARITY_BENCHMARK_PLAN: BrowserParityBenchmarkPlan = {
  tasks: [
    {
      id: "custom.local-fixture.basic-form",
      source: "custom-smoke",
      title: "Local fixture form and trusted locator",
      startUrl: "http://127.0.0.1:<port>/fixture",
      instruction: "Fill the Name field, click Ping, click Trusted locator, screenshot, and close the tab.",
      successCriteria: [
        "The result output is Ada:1.",
        "The trusted locator output is trusted.",
        "A screenshot artifact is produced.",
        "The created tab disappears after close.",
      ],
      coverage: ["input", "locator", "dom-snapshot", "screenshot", "tab-lifecycle", "viewport"],
      requiresAuth: false,
      sideEffectLevel: "read-only",
      stability: "stable",
      notes: "Backchat-local deterministic smoke task used as a harness sanity check, not a public benchmark.",
    },
    {
      id: "miniwob.click-button",
      source: "miniwob++",
      title: "MiniWoB++ click-button",
      startUrl: "miniwob://click-button",
      instruction: "Click the target button and verify the local success state.",
      successCriteria: [
        "The requested button is clicked exactly once.",
        "The task reports a local success state.",
        "The tab closes cleanly after verification.",
      ],
      coverage: ["input", "locator", "screenshot", "tab-lifecycle", "viewport"],
      requiresAuth: false,
      sideEffectLevel: "read-only",
      stability: "stable",
      notes: "Synthetic deterministic interaction task; use a local MiniWoB++ runner or mirrored static page.",
    },
    {
      id: "miniwob.enter-text",
      source: "miniwob++",
      title: "MiniWoB++ enter-text",
      startUrl: "miniwob://enter-text",
      instruction: "Enter the prompted text into the field and submit the local form.",
      successCriteria: [
        "The field value matches the prompt.",
        "The local page reports success.",
      ],
      coverage: ["input", "locator", "dom-snapshot", "tab-lifecycle", "viewport"],
      requiresAuth: false,
      sideEffectLevel: "read-only",
      stability: "stable",
      notes: "Synthetic form task for keyboard and field-filling parity.",
    },
    {
      id: "webvoyager.wikipedia.selenium-search",
      source: "webvoyager",
      title: "Wikipedia article search for Selenium software",
      startUrl: "https://en.wikipedia.org/wiki/Main_Page",
      instruction: "Search for Selenium (software), open the article, and inspect the article summary.",
      successCriteria: [
        "Final URL is the Selenium software article.",
        "Article heading is Selenium (software).",
        "The first paragraph contains Selenium.",
        "A screenshot artifact is produced.",
      ],
      coverage: [
        "navigation",
        "input",
        "locator",
        "dom-snapshot",
        "screenshot",
        "tab-lifecycle",
        "real-site-dynamic-content",
      ],
      requiresAuth: false,
      sideEffectLevel: "read-only",
      stability: "stable",
      notes: "WebVoyager-style real-site task chosen because it is public and low side effect.",
    },
    {
      id: "online-mind2web.wikipedia.article-search",
      source: "online-mind2web",
      title: "Online-Mind2Web style article lookup",
      startUrl: "https://en.wikipedia.org/wiki/Main_Page",
      instruction: "Use Wikipedia search to reach a target article and extract a verifiable fact.",
      successCriteria: [
        "The browser reaches the requested article.",
        "The extracted answer is backed by page text.",
        "Dynamic page elements are recorded as possible diff sources.",
      ],
      coverage: [
        "navigation",
        "input",
        "locator",
        "dom-snapshot",
        "screenshot",
        "real-site-dynamic-content",
      ],
      requiresAuth: false,
      sideEffectLevel: "read-only",
      stability: "stable",
      notes: "Template for Online-Mind2Web public read-only tasks; concrete task ids should be pinned as they are imported.",
    },
  ],
};

export function selectStableBrowserParityTasks(
  plan: BrowserParityBenchmarkPlan,
): BrowserParityBenchmarkTask[] {
  return plan.tasks.filter((task) =>
    task.stability === "stable" &&
    task.requiresAuth === false &&
    task.sideEffectLevel === "read-only"
  );
}

export function normalizeBrowserParityTrace(
  trace: BrowserParityTrace,
): NormalizedBrowserParityTrace {
  const observations = trace.observations;
  const firstParagraphSnippet = stringOrNull(observations["firstParagraphSnippet"]);
  const errors = trace.errors ?? [];
  const steps = trace.steps ?? [];
  const screenshot = stringOrNull(
    trace.artifacts?.["screenshot"] ?? observations["screenshotPath"],
  );

  return {
    surface: trace.surface,
    ok: trace.ok === true,
    finalUrl: stringOrNull(observations["finalUrl"] ?? observations["url"]),
    title: stringOrNull(observations["title"]),
    heading: stringOrNull(observations["heading"]),
    resultAfterPing: stringOrNull(observations["resultAfterPing"]),
    trustedResult: stringOrNull(observations["trustedResult"]),
    firstParagraphSnippet,
    paragraphHasSelenium: firstParagraphSnippet === null
      ? null
      : firstParagraphSnippet.includes("Selenium"),
    linkCount: numberOrNull(observations["linkCount"]),
    miniwobTaskId: stringOrNull(observations["miniwobTaskId"]),
    benchmarkInstanceId: stringOrNull(observations["benchmarkInstanceId"]),
    seed: stringOrNull(observations["seed"]),
    utterance: stringOrNull(observations["utterance"]),
    wobDone: booleanOrNull(observations["wobDone"]),
    wobRawReward: numberOrNull(observations["wobRawReward"]),
    wobReward: numberOrNull(observations["wobReward"]),
    domSnapshotContainsHeading: booleanOrNull(observations["domSnapshotContainsHeading"]),
    domSnapshotContainsSelenium: booleanOrNull(observations["domSnapshotContainsSelenium"]),
    domSnapshotContainsUtterance: booleanOrNull(observations["domSnapshotContainsUtterance"]),
    screenshotMimeType: stringOrNull(observations["screenshotMimeType"]),
    screenshotWidth: numberOrNull(observations["screenshotWidth"]),
    screenshotHeight: numberOrNull(observations["screenshotHeight"]),
    screenshotBase64Length: numberOrNull(observations["screenshotBase64Length"]),
    tabClosed: booleanOrNull(observations["tabClosed"]),
    screenshot,
    stepCount: steps.length,
    failedSteps: steps.filter((step) => step.ok !== true).map((step) => step.name),
    errors: Array.isArray(errors) ? errors : [],
  };
}

export function compareBrowserParityTracePair(params: {
  id: string;
  taskId: string;
  left: BrowserParityTrace;
  right: BrowserParityTrace;
}): BrowserParityTraceComparison {
  const left = normalizeBrowserParityTrace(params.left);
  const right = normalizeBrowserParityTrace(params.right);
  const baseMatchFields: Array<keyof NormalizedBrowserParityTrace> = [
    "ok",
    "finalUrl",
    "title",
    "heading",
    "resultAfterPing",
    "trustedResult",
    "paragraphHasSelenium",
    "miniwobTaskId",
    "benchmarkInstanceId",
    "seed",
    "utterance",
    "wobDone",
    "wobRawReward",
    "domSnapshotContainsHeading",
    "domSnapshotContainsSelenium",
    "domSnapshotContainsUtterance",
    "screenshotMimeType",
    "screenshotWidth",
    "screenshotHeight",
    "tabClosed",
  ];
  const matchFields = baseMatchFields.filter((field) =>
    !(isRealSiteDynamicTask(params.taskId) && field === "screenshotHeight")
  );
  const diffFields: Array<keyof NormalizedBrowserParityTrace> = [
    ...matchFields,
    "linkCount",
    "wobReward",
    "screenshotHeight",
    "screenshotBase64Length",
    "stepCount",
  ];

  const matches: Record<string, boolean> = {};
  for (const field of matchFields) {
    matches[field] = sameValue(left[field], right[field]);
  }

  const diffs = diffFields
    .filter((field) => !sameValue(left[field], right[field]))
    .map((field) => ({ field, left: left[field], right: right[field] }));

  const leftFailed = left.ok !== true || left.failedSteps.length > 0 || left.errors.length > 0;
  const rightFailed = right.ok !== true || right.failedSteps.length > 0 || right.errors.length > 0;
  const status = leftFailed || rightFailed
    ? "fail"
    : Object.values(matches).every(Boolean)
      ? "pass"
      : "partial";

  return {
    id: params.id,
    taskId: params.taskId,
    left,
    right,
    matches,
    diffs,
    status,
  };
}

function isRealSiteDynamicTask(taskId: string): boolean {
  return taskId.startsWith("webvoyager.") || taskId.startsWith("online-mind2web.");
}

export function buildBrowserParityEvidencePack(params: {
  generatedAt: string;
  tasks: BrowserParityBenchmarkTask[];
  comparisons: BrowserParityTraceComparison[];
  evidenceSources?: BrowserParityEvidenceSource[];
}): BrowserParityEvidencePack {
  const coverage = [...new Set(params.tasks.flatMap((task) => task.coverage))].sort();
  const parityGaps = params.comparisons.flatMap((comparison) =>
    comparison.diffs.map((diff) => ({
      pairId: comparison.id,
      taskId: comparison.taskId,
      field: diff.field,
      left: diff.left,
      right: diff.right,
    }))
  );
  const gapAudit = auditBrowserParityEvidencePack({
    tasks: params.tasks,
    comparisons: params.comparisons,
    requiredCoverage: DEFAULT_BROWSER_PARITY_REQUIRED_COVERAGE,
    evidenceSources: params.evidenceSources ?? [],
  });

  return {
    generatedAt: params.generatedAt,
    tasks: params.tasks,
    comparisons: params.comparisons,
    evidenceSources: params.evidenceSources ?? [],
    coverage,
    parityGaps,
    gapAudit,
    summary: {
      totalTasks: params.tasks.length,
      completedComparisons: params.comparisons.length,
      passingComparisons: params.comparisons.filter((comparison) => comparison.status === "pass").length,
      partialComparisons: params.comparisons.filter((comparison) => comparison.status === "partial").length,
      failingComparisons: params.comparisons.filter((comparison) => comparison.status === "fail").length,
    },
  };
}

export function auditBrowserParityEvidencePack(params: {
  tasks: BrowserParityBenchmarkTask[];
  comparisons: BrowserParityTraceComparison[];
  requiredCoverage: BrowserParityCoverage[];
  evidenceSources?: BrowserParityEvidenceSource[];
}): BrowserParityGapAudit {
  const observedCoverage = new Set(params.tasks.flatMap((task) => task.coverage));
  const evidenceSources = params.evidenceSources ?? [];
  for (const source of evidenceSources) {
    if (source.status !== "verified") continue;
    for (const coverage of source.coverage) {
      observedCoverage.add(coverage);
    }
  }
  for (const comparison of params.comparisons) {
    if (isChromeSurface(comparison.left.surface) || isChromeSurface(comparison.right.surface)) {
      observedCoverage.add("chrome-extension");
    }
  }
  const requiredCoverage = [...params.requiredCoverage].sort();
  const missingCoverage = requiredCoverage.filter((coverage) => !observedCoverage.has(coverage));
  const acceptedDifferences: BrowserParityAcceptedDifference[] = [];
  const unexplainedGaps: BrowserParityUnexplainedGap[] = [];

  for (const comparison of params.comparisons) {
    for (const diff of comparison.diffs) {
      const accepted = comparison.status === "pass"
        ? classifyAcceptedDifference(comparison, diff)
        : null;
      if (accepted) {
        acceptedDifferences.push(accepted);
      } else {
        unexplainedGaps.push({
          pairId: comparison.id,
          taskId: comparison.taskId,
          field: diff.field,
          left: diff.left,
          right: diff.right,
          reason: comparison.status === "pass"
            ? "uncontracted-pass-diff"
            : `comparison-status-${comparison.status}`,
        });
      }
    }
  }

  return {
    requiredCoverage,
    missingCoverage,
    evidenceSources,
    acceptedDifferences,
    unexplainedGaps,
    summary: {
      acceptedDifferences: acceptedDifferences.length,
      unexplainedGaps: unexplainedGaps.length,
      missingCoverage: missingCoverage.length,
    },
  };
}

function isChromeSurface(surface: string): boolean {
  return surface.includes("chrome");
}

function classifyAcceptedDifference(
  comparison: BrowserParityTraceComparison,
  diff: { field: string; left: unknown; right: unknown },
): BrowserParityAcceptedDifference | null {
  const base = {
    pairId: comparison.id,
    taskId: comparison.taskId,
    field: diff.field,
    left: diff.left,
    right: diff.right,
  };
  if (diff.field === "screenshotBase64Length") {
    return {
      ...base,
      category: "encoded-visual",
      reason: "Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.",
    };
  }
  if (diff.field === "stepCount") {
    return {
      ...base,
      category: "harness-implementation",
      reason: "Harness step count records implementation trace granularity, not user-visible browser behavior.",
    };
  }
  if (diff.field === "wobReward" && comparison.taskId.startsWith("miniwob.")) {
    return {
      ...base,
      category: "timing-reward",
      reason: "MiniWoB shaped reward includes time scaling; done/raw reward remain the parity fields.",
    };
  }
  if (diff.field === "linkCount" && isRealSiteDynamicTask(comparison.taskId)) {
    return {
      ...base,
      category: "dynamic-content",
      reason: "Public real-site link inventory can drift while final URL, title, heading, and target text match.",
    };
  }
  if (diff.field === "screenshotHeight" && isRealSiteDynamicTask(comparison.taskId)) {
    return {
      ...base,
      category: "dynamic-visual",
      reason: "Public real-site full-page height can drift with banners, references, and responsive content.",
    };
  }
  return null;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
