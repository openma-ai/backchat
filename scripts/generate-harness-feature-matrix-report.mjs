#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STATUS_LABELS = Object.freeze({
  "pass-live": "PASS-LIVE",
  "pass-replay": "PASS-REPLAY",
  fail: "FAIL",
  blocked: "BLOCKED",
  "upstream-gap": "UPSTREAM-GAP",
  "n-a": "N/A",
});

const PASS_STATUSES = new Set(["pass-live", "pass-replay"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requireText(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
}

function validatePassAssertion(cell) {
  const assertion = cell.assertion;
  if (!assertion || typeof assertion !== "object") {
    throw new Error(`Missing GUI assertion: ${cell.feature} × ${cell.harness}`);
  }
  requireText(
    assertion.selector,
    `GUI assertion requires a visible locator: ${cell.feature} × ${cell.harness}`,
  );
  requireText(
    assertion.expected,
    `GUI assertion requires an expected value: ${cell.feature} × ${cell.harness}`,
  );
  requireText(
    assertion.observed,
    `GUI assertion requires an observed value: ${cell.feature} × ${cell.harness}`,
  );
  if (assertion.result !== "passed") {
    throw new Error(`GUI assertion did not pass: ${cell.feature} × ${cell.harness}`);
  }
  if (assertion.targetVisible !== true) {
    throw new Error(`GUI assertion target is not visible: ${cell.feature} × ${cell.harness}`);
  }
  if (assertion.withinScreenshot !== true) {
    throw new Error(`GUI assertion target is outside the screenshot frame: ${cell.feature} × ${cell.harness}`);
  }
}

function validateManifest(manifest, { requireAllFinalLive = true } = {}) {
  const serializedManifest = JSON.stringify(manifest);
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(serializedManifest)) {
    throw new Error("Secret-shaped credential material is forbidden in the harness report manifest");
  }
  const features = Array.isArray(manifest?.features) ? manifest.features : [];
  const harnesses = Array.isArray(manifest?.harnesses) ? manifest.harnesses : [];
  const cells = Array.isArray(manifest?.cells) ? manifest.cells : [];
  if (features.length === 0 || harnesses.length === 0) {
    throw new Error("Strict matrix requires non-empty features and harnesses");
  }

  const cellKeys = new Set();
  for (const cell of cells) {
    const key = JSON.stringify([cell?.feature, cell?.harness]);
    if (cellKeys.has(key)) {
      throw new Error(`Duplicate matrix cell: ${cell?.feature} × ${cell?.harness}`);
    }
    cellKeys.add(key);
    if (!Object.hasOwn(STATUS_LABELS, cell?.status)) {
      throw new Error(`Invalid status ${String(cell?.status)}: ${cell?.feature} × ${cell?.harness}`);
    }
    requireText(cell?.harnessVersion, `Missing harness version: ${cell?.feature} × ${cell?.harness}`);
    requireText(cell?.provider, `Missing provider: ${cell?.feature} × ${cell?.harness}`);
    requireText(cell?.model, `Missing model: ${cell?.feature} × ${cell?.harness}`);
    requireText(cell?.runAt, `Missing run time: ${cell?.feature} × ${cell?.harness}`);
    if (!Number.isFinite(Date.parse(cell.runAt))) {
      throw new Error(`Invalid run time: ${cell?.feature} × ${cell?.harness}`);
    }
    if (!Number.isFinite(cell?.durationMs) || cell.durationMs < 0) {
      throw new Error(`Missing or invalid duration: ${cell?.feature} × ${cell?.harness}`);
    }
    requireText(
      cell?.protocolBasis,
      `Missing protocol basis: ${cell?.feature} × ${cell?.harness}`,
    );
    requireText(cell?.screenshot, `Missing screenshot: ${cell?.feature} × ${cell?.harness}`);
    validatePassAssertion(cell);
    if (PASS_STATUSES.has(cell.status)) {
      const requiredMode = cell.status === "pass-live" ? "live" : "replay";
      if (cell.verificationMode !== requiredMode) {
        throw new Error(
          `${STATUS_LABELS[cell.status]} requires verificationMode=${requiredMode}: ${cell.feature} × ${cell.harness}`,
        );
      }
      requireText(cell.trigger, `Missing ${requiredMode} trigger: ${cell.feature} × ${cell.harness}`);
    }
  }

  for (const feature of features) {
    for (const harness of harnesses) {
      if (!cellKeys.has(JSON.stringify([feature, harness]))) {
        throw new Error(`Missing matrix cell: ${feature} × ${harness}`);
      }
    }
  }
  const expected = features.length * harnesses.length;
  if (cells.length !== expected) {
    throw new Error(`Strict matrix must contain exactly ${expected} cells; received ${cells.length}`);
  }

  if (requireAllFinalLive && features.includes("output.final-response")) {
    for (const harness of harnesses) {
      const cell = cells.find((candidate) => (
        candidate.feature === "output.final-response" && candidate.harness === harness
      ));
      if (cell?.status !== "pass-live" || cell?.verificationMode !== "live") {
        throw new Error(`Final response for ${harness} must be PASS-LIVE`);
      }
    }
  }

  if (requireAllFinalLive) {
    const replayCell = cells.find((cell) => cell.status === "pass-replay");
    if (replayCell) {
      throw new Error(
        `Accepted report requires LIVE-E2E for supported cells; replay evidence is not acceptance: ${replayCell.feature} × ${replayCell.harness}`,
      );
    }
  }

  return { features, harnesses, cells };
}

function renderEvidenceList(cell) {
  const evidence = Array.isArray(cell.evidence) ? cell.evidence : [];
  if (evidence.length === 0) return "";
  return `<div class="evidence"><h3>Evidence</h3><ul>${evidence.map((item) => (
    `<li>${escapeHtml(item)}</li>`
  )).join("")}</ul></div>`;
}

function renderAssertion(cell) {
  const assertion = cell.assertion;
  if (!assertion || typeof assertion !== "object") {
    return `<dl class="facts"><div><dt>Failure / gap</dt><dd>${escapeHtml(cell.error || cell.reason || "No GUI assertion recorded")}</dd></div></dl>`;
  }
  return `<dl class="facts">
    <div><dt>Provider / model</dt><dd>${escapeHtml(cell.provider)} · ${escapeHtml(cell.model)}</dd></div>
    <div><dt>Run</dt><dd>${escapeHtml(cell.runAt)} · ${escapeHtml(cell.durationMs)} ms</dd></div>
    <div><dt>Protocol basis</dt><dd>${escapeHtml(cell.protocolBasis)}</dd></div>
    <div><dt>Visible locator</dt><dd><code>${escapeHtml(assertion.selector)}</code></dd></div>
    <div><dt>Expected</dt><dd>${escapeHtml(assertion.expected)}</dd></div>
    <div><dt>Observed</dt><dd>${escapeHtml(assertion.observed)}</dd></div>
    <div><dt>In screenshot</dt><dd>${assertion.withinScreenshot === true ? "yes" : "no"}</dd></div>
  </dl>`;
}

function renderHarnessFeatureMatrixReport(manifest, { requireAllFinalLive, acceptance }) {
  const { features, harnesses, cells } = validateManifest(manifest, { requireAllFinalLive });
  const routing = Array.isArray(manifest?.routing) ? manifest.routing : [];
  const notes = Array.isArray(manifest?.notes) ? manifest.notes : [];
  const expected = features.length * harnesses.length;
  const complete = cells.filter((cell) => cell.screenshot).length;
  const byStatus = cells.reduce((counts, cell) => {
    counts[cell.status] = (counts[cell.status] ?? 0) + 1;
    return counts;
  }, {});
  const byCell = new Map(cells.map((cell) => [
    JSON.stringify([cell.feature, cell.harness]),
    cell,
  ]));

  const cards = cells.map((cell) => {
    const featureIndex = features.indexOf(cell.feature);
    const harnessIndex = harnesses.indexOf(cell.harness);
    return `<article id="cell-${featureIndex}-${harnessIndex}" class="cell status-${escapeHtml(cell.status)}" data-matrix-cell>
      <header><div><p class="eyebrow">${escapeHtml(cell.feature)}</p><h2>${escapeHtml(cell.harness)} <small>${escapeHtml(cell.harnessVersion)}</small></h2></div><span class="status">${STATUS_LABELS[cell.status]}</span></header>
      <div class="run-meta"><span>${escapeHtml(cell.verificationMode || "none")}</span><p>${escapeHtml(cell.trigger || cell.reason || cell.error || "No trigger recorded")}</p></div>
      <a class="shot" href="${escapeHtml(cell.screenshot)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(cell.screenshot)}" alt="${escapeHtml(`${cell.feature} · ${cell.harness}`)}" loading="lazy"></a>
      ${renderAssertion(cell)}${renderEvidenceList(cell)}
    </article>`;
  }).join("");

  const statusSummary = Object.entries(STATUS_LABELS).map(([status, label]) => (
    `<span><i class="dot status-${escapeHtml(status)}"></i>${label} ${byStatus[status] ?? 0}</span>`
  )).join("");
  const comparisonRows = features.map((feature, featureIndex) => `<tr><th scope="row">${escapeHtml(feature)}</th>${harnesses.map((harness, harnessIndex) => {
    const cell = byCell.get(JSON.stringify([feature, harness]));
    const target = `cell-${featureIndex}-${harnessIndex}`;
    return `<td data-summary-cell><a class="summary-cell status-${escapeHtml(cell.status)}" href="#${target}" title="${escapeHtml(`${feature} × ${harness}: ${STATUS_LABELS[cell.status]}`)}"><i class="dot status-${escapeHtml(cell.status)}"></i>${STATUS_LABELS[cell.status]}</a></td>`;
  }).join("")}</tr>`).join("");
  const routingTable = routing.length === 0 ? "" : `<section class="routing"><h2>Live harness / provider routing</h2><div class="matrix-wrap"><table><thead><tr><th>Harness</th><th>Provider</th><th>Status</th><th>Detail</th></tr></thead><tbody>${routing.map((row) => `<tr data-routing-row><th>${escapeHtml(row.harness)}</th><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.detail)}</td></tr>`).join("")}</tbody></table></div></section>`;
  const notesBlock = notes.length === 0 ? "" : `<section class="notes"><h2>Notes and gaps</h2><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></section>`;

  const acceptanceBanner = acceptance === "incomplete"
    ? `<section class="acceptance-warning"><strong>未通过验收</strong><p>这是 staging 诊断报告，仅展示当前真实证据；不得作为正式验收报告发布。</p></section>`
    : "";

  return `<!doctype html>
<html lang="zh-CN" data-report-acceptance="${escapeHtml(acceptance)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(manifest?.title ?? "Harness GUI Feature Matrix")}</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#080a0f;color:#eef0f6}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0%,#172034 0,transparent 30rem),#080a0f}main{width:min(1880px,calc(100% - 40px));margin:auto;padding:40px 0 80px}.acceptance-warning{position:sticky;top:0;z-index:10;border:1px solid #ef4444;border-radius:14px;background:#450a0a;color:#fecaca;padding:14px 18px;margin-bottom:20px}.acceptance-warning strong{font-size:18px}.acceptance-warning p{margin:4px 0 0}.hero,.routing,.notes{border:1px solid #2b3140;border-radius:20px;background:#11141c;padding:24px;margin-bottom:20px}.hero h1{margin:4px 0 12px;font-size:clamp(28px,4vw,54px)}.hero p,.notes li{color:#aab3c4}.summary{display:flex;flex-wrap:wrap;gap:10px 18px;font-size:13px}.summary span,.summary-cell{display:inline-flex;align-items:center;gap:7px}.dot{width:9px;height:9px;border-radius:99px;background:#64748b}.filters{position:sticky;top:0;z-index:5;display:flex;gap:8px;overflow:auto;padding:14px 0;background:linear-gradient(#080a0f 75%,transparent)}.filters a{white-space:nowrap;color:#cbd5e1;text-decoration:none;border:1px solid #2b3140;border-radius:999px;padding:7px 10px;background:#11141c}.matrix-wrap{overflow:auto;border:1px solid #292f3d;border-radius:16px;background:#10131a;margin-bottom:20px}table{width:100%;min-width:1200px;border-collapse:collapse}th,td{padding:11px 12px;border:1px solid #272d39;text-align:left;font-size:11px}thead th{position:sticky;top:0;background:#171b24}.summary-cell{color:#cbd5e1;text-decoration:none}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px}.cell{overflow:hidden;border:1px solid #292f3d;border-radius:18px;background:#10131a}.cell header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px}.eyebrow{margin:0 0 3px;color:#8d98ad;font-size:11px;text-transform:uppercase}.cell h2{margin:0;font-size:18px}.cell h2 small{color:#8490a5;font-size:12px}.status{border-radius:999px;padding:6px 9px;background:#252b38;font-size:11px;font-weight:700}.run-meta{padding:0 18px 14px;color:#aab3c4}.run-meta span{text-transform:uppercase;color:#d5dbea;font-size:11px}.run-meta p{margin:5px 0 0;font-size:12px;line-height:1.45}.shot{display:block;aspect-ratio:16/10;background:#080a0f;border-block:1px solid #242a36}.shot img{display:block;width:100%;height:100%;object-fit:contain}.facts{margin:0;padding:14px 18px;display:grid;gap:8px}.facts div{display:grid;grid-template-columns:110px 1fr;gap:12px}.facts dt{color:#7f8ba1;font-size:11px}.facts dd{margin:0;color:#cbd5e1;font-size:12px;overflow-wrap:anywhere}.facts code{color:#a5b4fc}.evidence{padding:0 18px 16px;color:#aab3c4}.evidence h3{font-size:11px;text-transform:uppercase}.evidence li{font-size:11px;line-height:1.45}.status-pass-live .status,.dot.status-pass-live{background:#14532d;color:#bbf7d0}.status-pass-replay .status,.dot.status-pass-replay{background:#1e3a5f;color:#bfdbfe}.status-fail .status,.dot.status-fail{background:#7f1d1d;color:#fecaca}.status-blocked .status,.dot.status-blocked{background:#78350f;color:#fde68a}.status-upstream-gap .status,.dot.status-upstream-gap{background:#4c1d3f;color:#fbcfe8}.status-n-a .status,.dot.status-n-a{background:#334155;color:#cbd5e1}@media(max-width:700px){main{width:calc(100% - 20px)}.grid{grid-template-columns:1fr}.facts div{grid-template-columns:1fr}}
</style></head><body><main>
${acceptanceBanner}
<section class="hero"><p>Backchat · strict harness GUI acceptance</p><h1>${escapeHtml(manifest?.title ?? "Harness GUI Feature Matrix")}</h1><p>生成时间 ${escapeHtml(manifest?.generatedAt ?? "unknown")} · 截图覆盖 ${complete} / ${expected}</p><div class="summary">${statusSummary}</div></section>
<nav class="filters">${features.map((feature, index) => `<a href="#cell-${index}-0">${escapeHtml(feature)}</a>`).join("")}</nav>
<div class="matrix-wrap"><table><thead><tr><th>GUI feature</th>${harnesses.map((harness) => `<th>${escapeHtml(harness)}</th>`).join("")}</tr></thead><tbody>${comparisonRows}</tbody></table></div>
${routingTable}${notesBlock}<section class="grid">${cards}</section>
</main></body></html>`;
}

export function generateHarnessFeatureMatrixReport(manifest) {
  return renderHarnessFeatureMatrixReport(manifest, {
    requireAllFinalLive: true,
    acceptance: "accepted",
  });
}

export function generateHarnessFeatureMatrixDraftReport(manifest) {
  return renderHarnessFeatureMatrixReport(manifest, {
    requireAllFinalLive: false,
    acceptance: "incomplete",
  });
}

async function main(argv) {
  const manifestPath = argv[0];
  const outputPath = argv[1];
  if (!manifestPath || !outputPath) {
    throw new Error("usage: generate-harness-feature-matrix-report.mjs <manifest.json> <report.html>");
  }
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  await writeFile(resolve(outputPath), generateHarnessFeatureMatrixReport(manifest), "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
