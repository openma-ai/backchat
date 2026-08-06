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
  validateHarnessFeatureMatrixArtifacts,
} from "./publish-harness-feature-matrix-report.mjs";

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
    status: feature === "output.final-response" ? "pass-live" : "pass-replay",
    verificationMode: feature === "output.final-response" ? "live" : "replay",
    trigger: feature === "output.final-response"
      ? "Sent a real prompt through the configured harness process"
      : "Replayed captured harness trace trace-001",
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

function minimalPng() {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return bytes;
}

async function writeStrictStaging(root, manifest = strictManifest()) {
  await mkdir(resolve(root, "screenshots"), { recursive: true });
  for (const cell of manifest.cells) {
    await writeFile(resolve(root, cell.screenshot), minimalPng());
  }
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest), "utf8");
}

test("the strict harness report generator exists", () => {
  assert.equal(existsSync(resolve(scriptsDir, "generate-harness-feature-matrix-report.mjs")), true);
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
  assert.match(html, /PASS-LIVE/);
  assert.match(html, /PASS-REPLAY/);
  assert.match(html, /Visible locator/);
  assert.match(html, /Expected/);
  assert.match(html, /Observed/);
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
    /final response.*Claude.*PASS-LIVE/i,
  );
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

  const html = reportModule.generateHarnessFeatureMatrixDraftReport(manifest);
  assert.equal((html.match(/data-matrix-cell/g) ?? []).length, 315);
  assert.match(html, /data-report-acceptance="incomplete"/);
  assert.match(html, /未通过验收/);
  assert.match(html, /UPSTREAM-GAP/);
  assert.throws(
    () => generateHarnessFeatureMatrixReport(manifest),
    /final response.*Cursor.*PASS-LIVE/i,
  );
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
