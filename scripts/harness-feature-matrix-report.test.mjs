import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateHarnessFeatureMatrixReport } from "./generate-harness-feature-matrix-report.mjs";
import {
  publishHarnessFeatureMatrixReport,
  validateHarnessFeatureMatrixDraftArtifacts,
  validateHarnessFeatureMatrixArtifacts,
} from "./publish-harness-feature-matrix-report.mjs";
import { syncHarnessLiveEvidence } from "./sync-harness-live-evidence.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const harnesses = [
  "Claude",
  "Codex",
  "Cursor",
  "Pi",
  "OpenCode",
  "Kilo",
  "Kimi Code",
];
const features = Array.from({ length: 45 }, (_, index) => (
  index === 20 ? "output.final-response" : `feature-${String(index + 1).padStart(2, "0")}`
));

function strictCell(feature, harness, overrides = {}) {
  return {
    feature,
    harness,
    harnessVersion: "1.0.0",
    status: "pass-live",
    verificationMode: "live",
    trigger: "Clicked the real Electron GUI and observed the harness response",
    provider: harness === "Codex" ? "Codex default" : "DeepSeek Anthropic",
    model: harness === "Codex" ? "runtime-default" : "deepseek-v4-flash",
    runAt: "2026-08-06T00:00:00.000Z",
    durationMs: 123,
    protocolBasis: "ACP v1 session/update projection",
    screenshot: `screenshots/${feature}--${harness}.png`,
    assertion: {
      selector: `[data-feature="${feature}"]`,
      expected: `${harness} visible value`,
      observed: `${harness} visible value`,
      result: "passed",
      targetVisible: true,
      withinScreenshot: true,
    },
    evidence: [`${harness}@1.0.0 trace-001`],
    ...overrides,
  };
}

function strictManifest() {
  return {
    title: "Harness GUI Feature Matrix",
    generatedAt: "2026-08-06T00:00:00.000Z",
    features,
    harnesses,
    cells: features.flatMap((feature) => harnesses.map((harness) => strictCell(feature, harness))),
  };
}

function minimalPng(uniqueMarker = 0) {
  const bytes = Buffer.alloc(28);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  bytes.writeUInt32BE(uniqueMarker, 24);
  return bytes;
}

async function writeStrictStaging(root, manifest = strictManifest()) {
  await mkdir(resolve(root, "screenshots"), { recursive: true });
  for (const [index, cell] of manifest.cells.entries()) {
    await writeFile(resolve(root, cell.screenshot), minimalPng(index));
  }
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest), "utf8");
}

test("the strict harness report generator exists", () => {
  assert.equal(existsSync(resolve(scriptsDir, "generate-harness-feature-matrix-report.mjs")), true);
});

test("refreshes final-response cells from the latest answer-only live evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-live-evidence-"));
  try {
    const manifest = strictManifest();
    for (const cell of manifest.cells) {
      if (cell.feature === "output.final-response") {
        cell.assertion.observed = "stale whole-turn transcript";
      }
    }
    await mkdir(resolve(root, "live-gui"), { recursive: true });
    await writeFile(
      resolve(root, "manifest.json"),
      JSON.stringify(manifest),
      "utf8",
    );
    for (const harness of harnesses) {
      const marker = `LIVE_${harness.replaceAll(" ", "_").toUpperCase()}`;
      const evidence = strictCell("output.final-response", harness, {
        assertion: {
          selector: '[data-session-turn-answer="true"]',
          expected: `Visible assistant answer equals ${marker}`,
          observed: marker,
          result: "passed",
          targetVisible: true,
          withinScreenshot: true,
        },
      });
      await writeFile(
        resolve(root, "live-gui", `${harness}-final-response.json`),
        JSON.stringify(evidence),
        "utf8",
      );
    }

    const refreshed = await syncHarnessLiveEvidence(root);

    const finalCells = refreshed.cells.filter(
      (cell) => cell.feature === "output.final-response",
    );
    assert.equal(finalCells.length, 7);
    assert.equal(
      finalCells.every((cell) => cell.assertion.selector.includes("turn-answer")),
      true,
    );
    assert.match(
      await readFile(resolve(root, "report.html"), "utf8"),
      /data-report-acceptance="incomplete"/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Cursor live GUI run uses the authorized file credential store", async () => {
  const source = await readFile(
    resolve(scriptsDir, "../e2e/harness-final-response.real.spec.ts"),
    "utf8",
  );
  assert.match(
    source,
    /AGENT_CLI_CREDENTIAL_STORE:\s*["']file["']/,
    "Cursor's Electron child process must use the same file credential store as login",
  );
});

test("renders all 45 GUI features × 7 harnesses with explicit GUI assertions", () => {
  const html = generateHarnessFeatureMatrixReport(strictManifest());

  assert.equal((html.match(/data-matrix-cell/g) ?? []).length, 315);
  assert.equal((html.match(/data-summary-cell/g) ?? []).length, 315);
  assert.equal((html.match(/<img /g) ?? []).length, 315);
  assert.match(html, /315 \/ 315/);
  assert.match(html, /LIVE-E2E/);
  assert.match(html, /Visible locator/);
  assert.match(html, /Expected/);
  assert.match(html, /Observed/);
});

test("refuses to publish an accepted report when any cell is replay-only", () => {
  const manifest = strictManifest();
  manifest.cells[0] = strictCell(features[0], harnesses[0], {
    status: "pass-replay",
    verificationMode: "replay",
    trigger: "test-bridge replay: session.ready from a fixture",
  });

  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /accepted report.*LIVE-E2E|replay.*not.*accept/i,
  );
});

test("rejects a generic passed status because it does not distinguish live from replay", () => {
  const manifest = strictManifest();
  manifest.cells[0] = strictCell(features[0], harnesses[0], { status: "passed" });
  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /invalid status.*passed/i,
  );
});

test("rejects pass-live or pass-replay without a visible in-frame GUI assertion", () => {
  for (const assertion of [
    undefined,
    { selector: "", expected: "x", observed: "x", result: "passed", targetVisible: true, withinScreenshot: true },
    { selector: "[role=log]", expected: "x", observed: "x", result: "passed", targetVisible: false, withinScreenshot: true },
    { selector: "[role=log]", expected: "x", observed: "x", result: "passed", targetVisible: true, withinScreenshot: false },
  ]) {
    const manifest = strictManifest();
    manifest.cells[0] = strictCell(features[0], harnesses[0], { assertion });
    assert.throws(
      () => generateHarnessFeatureMatrixReport(manifest),
      /gui assertion|visible|screenshot frame/i,
    );
  }
});

test("rejects cells without provider, model, run time, duration, or protocol basis", () => {
  for (const [field, value] of [
    ["provider", ""],
    ["model", ""],
    ["runAt", ""],
    ["durationMs", undefined],
    ["protocolBasis", ""],
  ]) {
    const manifest = strictManifest();
    manifest.cells[0] = strictCell(features[0], harnesses[0], { [field]: value });
    assert.throws(
      () => generateHarnessFeatureMatrixReport(manifest),
      /provider|model|run time|duration|protocol basis/i,
    );
  }
});

test("rejects failure and gap cells without a visible in-frame GUI state", () => {
  for (const status of ["fail", "blocked", "upstream-gap", "n-a"]) {
    const manifest = strictManifest();
    manifest.cells[0] = strictCell(features[0], harnesses[0], {
      status,
      verificationMode: "live",
      reason: `${status} evidence`,
      assertion: undefined,
    });
    assert.throws(
      () => generateHarnessFeatureMatrixReport(manifest),
      /GUI assertion|visible/i,
    );
  }
});

test("rejects secret-shaped values anywhere in the rendered manifest", () => {
  const manifest = strictManifest();
  manifest.routing = [{
    harness: "Claude",
    provider: "DeepSeek",
    status: "configured",
    detail: "credential sk-secret-material-must-not-render",
  }];
  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /secret|credential/i,
  );
});

test("rejects replay evidence for any harness final response", () => {
  const manifest = strictManifest();
  const index = manifest.cells.findIndex((cell) => (
    cell.feature === "output.final-response" && cell.harness === "Claude"
  ));
  manifest.cells[index] = strictCell("output.final-response", "Claude", {
    status: "pass-replay",
    verificationMode: "replay",
  });
  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /final response.*Claude.*LIVE-E2E/i,
  );
});

test("rejects replay-only evidence for N/A and other gap outcomes in an accepted report", () => {
  for (const status of ["n-a", "fail", "pending", "blocked", "upstream-gap"]) {
    const manifest = strictManifest();
    manifest.cells[0] = strictCell(features[0], harnesses[0], {
      status,
      verificationMode: "replay",
      reason: `${status} was inferred from replay-only evidence`,
    });
    assert.throws(
      () => generateHarnessFeatureMatrixReport(manifest),
      /N\/A|FAILED|PENDING|BLOCKED|UPSTREAM-GAP|live GUI evidence/i,
    );
  }
});

test("renders an explicitly incomplete staging report without weakening the strict final-response gate", async () => {
  const reportModule = await import("./generate-harness-feature-matrix-report.mjs");
  assert.equal(typeof reportModule.generateHarnessFeatureMatrixDraftReport, "function");

  const manifest = strictManifest();
  const index = manifest.cells.findIndex((cell) => (
    cell.feature === "output.final-response" && cell.harness === "Cursor"
  ));
  manifest.cells[index] = strictCell("output.final-response", "Cursor", {
    status: "upstream-gap",
    verificationMode: "live",
    reason: "Cursor stayed running without a final response",
  });
  manifest.cells[0] = strictCell(features[0], harnesses[0], {
    status: "pass-replay",
    verificationMode: "replay",
  });
  manifest.cells[1] = strictCell(features[0], harnesses[1], {
    status: "pending",
    verificationMode: "live",
    reason: "Real GUI click has not been executed yet",
  });

  const html = reportModule.generateHarnessFeatureMatrixDraftReport(manifest);
  assert.equal((html.match(/data-matrix-cell/g) ?? []).length, 315);
  assert.match(html, /data-report-acceptance="incomplete"/);
  assert.match(html, /未通过验收/);
  assert.match(html, /UPSTREAM-GAP/);
  assert.match(html, /LIVE-E2E/);
  assert.match(html, /REPLAY-ONLY/);
  assert.doesNotMatch(html, /PASS-REPLAY/);
  assert.match(html, /PENDING/);
  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /final response.*Cursor.*LIVE-E2E/i,
  );
});

test("validates a complete draft artifact set without weakening the accepted LIVE-E2E gate", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-matrix-draft-validation-"));
  const staging = resolve(root, "staging");
  const published = resolve(root, "published");
  try {
    const manifest = strictManifest();
    manifest.cells[0] = strictCell(features[0], harnesses[0], {
      status: "pass-replay",
      verificationMode: "replay",
      trigger: "Fixture replay for draft diagnostics only",
    });
    await writeStrictStaging(staging, manifest);

    const validated = await validateHarnessFeatureMatrixDraftArtifacts(staging);
    assert.equal(validated.screenshots.length, 315);
    assert.match(validated.html, /data-report-acceptance="incomplete"/);
    const validation = JSON.parse(await readFile(
      resolve(staging, "artifact-validation.json"),
      "utf8",
    ));
    assert.equal(validation.screenshotCount, 315);
    assert.equal(validation.uniqueScreenshotCount, 315);
    assert.equal(validation.uniqueScreenshotContentCount, 315);
    assert.equal(validation.secretLeaks, 0);

    await assert.rejects(
      validateHarnessFeatureMatrixArtifacts(staging),
      /accepted report.*LIVE-E2E|replay.*not.*accept/i,
    );
    await assert.rejects(
      publishHarnessFeatureMatrixReport(staging, published),
      /accepted report.*LIVE-E2E|replay.*not.*accept/i,
    );
    assert.equal(existsSync(published), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("draft artifact validation reuses screenshot completeness, uniqueness, hash, and secret guards", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-matrix-draft-guards-"));
  const manifest = strictManifest();
  manifest.cells[0].status = "pass-replay";
  manifest.cells[0].verificationMode = "replay";
  await writeStrictStaging(root, manifest);
  try {
    await t.test("missing screenshot", async () => {
      await rm(resolve(root, manifest.cells[0].screenshot));
      await assert.rejects(
        validateHarnessFeatureMatrixDraftArtifacts(root),
        /ENOENT|no such file/i,
      );
      await writeFile(
        resolve(root, manifest.cells[0].screenshot),
        minimalPng(0),
      );
    });

    await t.test("reused screenshot path", async () => {
      const originalScreenshot = manifest.cells[1].screenshot;
      manifest.cells[1].screenshot = manifest.cells[0].screenshot;
      await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest), "utf8");
      await assert.rejects(
        validateHarnessFeatureMatrixDraftArtifacts(root),
        /315 unique screenshots/i,
      );
      manifest.cells[1].screenshot = originalScreenshot;
      await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest), "utf8");
    });

    await t.test("duplicate screenshot content", async () => {
      await writeFile(
        resolve(root, manifest.cells[1].screenshot),
        await readFile(resolve(root, manifest.cells[0].screenshot)),
      );
      await assert.rejects(
        validateHarnessFeatureMatrixDraftArtifacts(root),
        /duplicate screenshot content/i,
      );
      await writeFile(
        resolve(root, manifest.cells[1].screenshot),
        minimalPng(1),
      );
    });

    await t.test("secret-shaped manifest material", async () => {
      manifest.cells[0].secret = "sk-draft-secret-material-must-fail";
      await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest), "utf8");
      await assert.rejects(
        validateHarnessFeatureMatrixDraftArtifacts(root),
        /secret|credential/i,
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a duplicate cell that hides a missing feature × harness combination", () => {
  const manifest = strictManifest();
  manifest.cells[1] = { ...manifest.cells[0], screenshot: "screenshots/duplicate.png" };
  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /duplicate.*feature-01.*Claude|missing.*feature-01.*Codex/i,
  );
});

test("rejects secret-shaped material even in otherwise ignored manifest fields", () => {
  const manifest = strictManifest();
  manifest.cells[0].secrets = { apiKey: "sk-test-secret-must-never-render" };
  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /secret|credential/i,
  );
});

test("strict artifact validation rejects one screenshot reused across matrix cells", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-matrix-reused-"));
  try {
    const manifest = strictManifest();
    for (const cell of manifest.cells) cell.screenshot = "screenshots/reused.png";
    await writeStrictStaging(root, manifest);
    await assert.rejects(
      validateHarnessFeatureMatrixArtifacts(root),
      /315 unique screenshots/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict artifact validation rejects duplicate image content under different paths", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-matrix-duplicate-content-"));
  try {
    const manifest = strictManifest();
    await writeStrictStaging(root, manifest);
    const first = resolve(root, manifest.cells[0].screenshot);
    const second = resolve(root, manifest.cells[1].screenshot);
    await writeFile(second, await readFile(first));
    await assert.rejects(
      validateHarnessFeatureMatrixArtifacts(root),
      /duplicate screenshot content/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict publisher atomically replaces a prior report only after all artifacts validate", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-matrix-publish-"));
  const staging = resolve(root, "staging");
  const published = resolve(root, "published");
  try {
    await writeStrictStaging(staging);
    await mkdir(published, { recursive: true });
    await writeFile(resolve(published, "report.html"), "OLD REPORT", "utf8");

    await publishHarnessFeatureMatrixReport(staging, published);

    assert.match(await readFile(resolve(published, "report.html"), "utf8"), /315 \/ 315/);
    const validation = JSON.parse(await readFile(
      resolve(published, "artifact-validation.json"),
      "utf8",
    ));
    assert.equal(validation.screenshotCount, 315);
    assert.equal(validation.uniqueScreenshotCount, 315);
    assert.equal(validation.uniqueScreenshotContentCount, 315);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
