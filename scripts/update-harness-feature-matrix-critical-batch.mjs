#!/usr/bin/env node

import { execFile } from "node:child_process";
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  generateHarnessFeatureMatrixDraftReport,
} from "./generate-harness-feature-matrix-report.mjs";

const ACP_V1 = "https://agentclientprotocol.com/protocol/v1";
const ACP_ELICITATION = "https://agentclientprotocol.com/protocol/v1/elicitation";
const ACP_CONFIG = "https://agentclientprotocol.com/protocol/v1/session-config-options";
const ACP_CLOSE = "https://agentclientprotocol.com/rfds/session-close";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const execFileAsync = promisify(execFile);

function cellFor(manifest, feature, harness) {
  const cell = manifest.cells.find((candidate) => (
    candidate.feature === feature && candidate.harness === harness
  ));
  if (!cell) throw new Error(`Missing matrix cell: ${feature} × ${harness}`);
  return cell;
}

function assertion(selector, expected, observed) {
  return {
    selector,
    expected,
    observed,
    result: "passed",
    targetVisible: true,
    withinScreenshot: true,
  };
}

async function install(root, batchRoot, cell, harnessDir, sourceName) {
  const source = resolve(batchRoot, harnessDir, sourceName);
  const target = resolve(root, cell.screenshot);
  const bytes = await readFile(source);
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    await copyFile(source, target);
  } else {
    const candidate = `${target}.${process.pid}.png`;
    await execFileAsync("/usr/bin/sips", [
      "-s", "format", "png", source, "--out", candidate,
    ]);
    await rename(candidate, target);
  }
  return source;
}

async function markLive({
  manifest,
  root,
  batchRoot,
  runAt,
  feature,
  harness,
  harnessDir,
  sourceName,
  trigger,
  selector,
  expected,
  observed,
  protocol = ACP_V1,
  extraEvidence = [],
  durationMs = 1_200,
}) {
  const cell = cellFor(manifest, feature, harness);
  const source = await install(root, batchRoot, cell, harnessDir, sourceName);
  Object.assign(cell, {
    status: "pass-live",
    verificationMode: "live",
    trigger,
    runAt,
    durationMs,
    protocolBasis: "Official ACP v1 plus real Backchat Electron UI driven through Computer Use",
    assertion: assertion(selector, expected, observed),
    evidence: [protocol, `Computer Use source: ${source}`, ...extraEvidence],
  });
}

async function markReplay({
  manifest,
  root,
  batchRoot,
  runAt,
  feature,
  harness,
  harnessDir,
  sourceName,
  trigger,
  selector,
  expected,
  observed,
  protocol = ACP_V1,
}) {
  const cell = cellFor(manifest, feature, harness);
  const source = await install(root, batchRoot, cell, harnessDir, sourceName);
  Object.assign(cell, {
    status: "pass-replay",
    verificationMode: "replay",
    trigger,
    runAt,
    durationMs: 0,
    protocolBasis: "Official ACP v1 plus Backchat deterministic projection replay; no live harness claim",
    assertion: assertion(selector, expected, observed),
    evidence: [protocol, `Replay source: ${source}`],
  });
}

async function markLiveGap({
  manifest,
  root,
  batchRoot,
  runAt,
  feature,
  harness,
  harnessDir,
  sourceName,
  status,
  reason,
  selector,
  expected,
  observed,
  extraEvidence = [],
  trigger = "Computer Use: open the real native child pane after the parent turn reaches Idle",
  protocolBasis = "Official ACP v1 plus codex-acp namespaced _meta; no transcript or natural-language inference",
}) {
  const cell = cellFor(manifest, feature, harness);
  const source = await install(root, batchRoot, cell, harnessDir, sourceName);
  Object.assign(cell, {
    status,
    verificationMode: "live",
    trigger,
    runAt,
    durationMs: 1_100,
    protocolBasis,
    reason,
    assertion: assertion(selector, expected, observed),
    evidence: [ACP_V1, `Computer Use source: ${source}`, ...extraEvidence],
  });
}

async function updateRoot(root, batchRoot, runAt) {
  const manifestPath = resolve(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.generatedAt = runAt;

  const entries = [
    {
      feature: "session.initialize-ready", harness: "Codex", harnessDir: "codex",
      sourceName: "session-initialize-ready-current.jpg",
      trigger: "Computer Use: create and start a real Codex session in Electron",
      selector: "[data-session-runtime]", expected: "Codex reaches an initialized Idle ACP v1 session.",
      observed: "@agentclientprotocol/codex-acp 1.1.9, ACP v1, Idle, capabilities, CWD, context and queue are visible.",
    },
    {
      feature: "input.prompt-text", harness: "Codex", harnessDir: "codex",
      sourceName: "input-prompt-text-live.jpg",
      trigger: "Computer Use: type an exact real prompt into the active Codex composer without sending it",
      selector: "textarea", expected: "The exact user prompt is visible in the live composer before send.",
      observed: "BACKCHAT_CODEX_PROMPT_TEXT_20260807 and its exact calculation/final-output contract are visible in the active composer with the enabled send action.",
    },
    {
      feature: "input.resource-context", harness: "Cursor", harnessDir: "cursor",
      sourceName: "input-resource-context-live.png",
      trigger: "Computer Use: type @ in a real Cursor draft, choose a file, select README.md in the native macOS picker, send the exact prompt, and wait for the visible final reply",
      selector: "[data-context-resource][data-resource-name=\"README.md\"] + [data-session-turn-answer=true]",
      expected: "The selected workspace resource remains visible in the real session and Cursor reaches a visible resource-dependent final response.",
      observed: "The live Resources panel shows README.md; the completed Cursor turn visibly shows the exact prompt, Read File tool completion, RESOURCE_CURSOR_OK final response, Idle state and Queue 0.",
      durationMs: 62_000,
    },
    {
      feature: "input.resource-context", harness: "OpenCode", harnessDir: "opencode",
      sourceName: "input-resource-context-live.png",
      trigger: "Computer Use: type @ in a real OpenCode draft, choose a file, select README.md in the native macOS picker, send the exact prompt, and wait for the visible final reply",
      selector: "[data-context-resource][data-resource-name=\"README.md\"] + [data-session-turn-answer=true]",
      expected: "The selected README.md resource is visibly attached before send and the real OpenCode turn reaches the exact resource-dependent final response.",
      observed: "The trigger screenshot visibly shows the README.md mentioned-file chip, exact prompt and OpenCode Zen/DeepSeek V4 Flash Free; the completed turn visibly shows RESOURCE_CONTEXT_OPENCODE_OK, OpenCode 1.18.12 ACP v1, Idle and Queue 0.",
      protocol: "https://agentclientprotocol.com/protocol/v1/content",
      durationMs: 56_000,
      extraEvidence: [
        `Computer Use trigger source: ${resolve(batchRoot, "opencode", "input-resource-context-trigger.png")}`,
        `Computer Use in-progress source: ${resolve(batchRoot, "opencode", "input-resource-context-running.png")}`,
      ],
    },
    {
      feature: "input.session-reference", harness: "Cursor", harnessDir: "cursor",
      sourceName: "input-session-reference-live.png",
      trigger: "Computer Use: type @ in a real Cursor draft, choose the existing Readme Cursor session, send the exact prompt, approve the real session/request_permission request once, and wait for the visible final reply",
      selector: "[data-session-reference] + [data-session-turn-answer=true]",
      expected: "The selected session reference is visibly attached to the real prompt and Cursor reaches a reference-dependent final response after the required permission callback.",
      observed: "The trigger screenshot visibly shows the Readme Cursor reference chip; the live completion shows the real session/request_permission response, completed session read, SESSION_REFERENCE_CURSOR_OK final response, Idle state and Queue 0.",
      protocol: "https://agentclientprotocol.com/protocol/v1/content",
      durationMs: 58_000,
      extraEvidence: [
        `Computer Use trigger source: ${resolve(batchRoot, "cursor", "input-session-reference-trigger.png")}`,
        `Computer Use permission source: ${resolve(batchRoot, "cursor", "input-session-reference-permission.png")}`,
        `Computer Use in-progress source: ${resolve(batchRoot, "cursor", "input-session-reference-running.png")}`,
      ],
    },
    {
      feature: "input.session-reference", harness: "OpenCode", harnessDir: "opencode",
      sourceName: "input-session-reference-live.png",
      trigger: "Computer Use: choose OpenCode with OpenCode Zen/DeepSeek V4 Flash Free, type @ in a real draft, select the existing Readme Cursor session, send the exact prompt, and wait for the visible final reply",
      selector: "[data-session-reference] + [data-session-turn-answer=true]",
      expected: "The selected session reference is visibly attached to the real prompt, the referenced session is read through a real tool call, and OpenCode reaches a visible final response.",
      observed: "The trigger screenshot visibly shows the Readme Cursor reference chip and DeepSeek V4 Flash model; the completed turn shows OpenMA_Sessions_openma_sessions_read Completed, SESSION_REFERENCE_OPENCODE_OK, OpenCode 1.18.12 ACP v1, Idle, Queue 0 and a 35 second duration.",
      protocol: "https://agentclientprotocol.com/protocol/v1/content",
      durationMs: 35_000,
      extraEvidence: [
        `Computer Use trigger source: ${resolve(batchRoot, "opencode", "input-session-reference-trigger.png")}`,
        `Computer Use in-progress source: ${resolve(batchRoot, "opencode", "input-session-reference-running.png")}`,
      ],
    },
    {
      feature: "input.image-attachment", harness: "Codex", harnessDir: "codex",
      sourceName: "input-image-attachment-before.jpg",
      trigger: "Computer Use: click Add file, select the real Backchat logo in the macOS picker, send the prompt, and wait for Codex to inspect it",
      selector: "[data-composer-attachments]",
      expected: "The chosen image is visibly attached before send and the same real turn reaches a visible image-dependent final response.",
      observed: "The composer visibly shows the backchat-logo.png thumbnail before send; the completed turn visibly shows the image inspection prompt, IMAGEATTACHOK and Idle.",
      extraEvidence: [`Computer Use completion source: ${resolve(batchRoot, "codex", "input-image-attachment-final.jpg")}`],
    },
    {
      feature: "input.mode", harness: "Codex", harnessDir: "codex",
      sourceName: "input-mode-plan-active.png", protocol: ACP_CONFIG,
      trigger: "Computer Use: invoke the real /plan command and inspect the active composer mode",
      selector: "[data-composer-mode]", expected: "Codex Plan mode is visibly active after the ACP command succeeds.",
      observed: "Plan is visible in the composer and request_user_input becomes available.",
    },
    {
      feature: "input.available-commands", harness: "Codex", harnessDir: "codex",
      sourceName: "input-available-commands-plan.png",
      trigger: "Computer Use: type / in the real Codex composer and inspect the command catalog",
      selector: "[role=listbox]", expected: "The Codex slash-command catalog is visible in Plan mode.",
      observed: "The real /plan, /mcp, /skills, /status and /review commands are visible.",
    },
    {
      feature: "output.streaming-response", harness: "Codex", harnessDir: "codex",
      sourceName: "output-streaming-response.png",
      trigger: "Computer Use: send the real Codex prompt and observe the in-progress turn",
      selector: "[data-session-turn-id]", expected: "A live Codex response is visibly streaming before terminal completion.",
      observed: "The response/thought block is visible while the session is working.",
    },
    {
      feature: "output.thinking-reasoning", harness: "Codex", harnessDir: "codex",
      sourceName: "output-thinking-and-elicitation-request.png",
      trigger: "Computer Use: send the real Plan-mode elicitation prompt and expand the visible work block",
      selector: "[data-reasoning]", expected: "Non-empty Codex reasoning is rendered and remains distinct from the final answer.",
      observed: "The work/reasoning block and pending structured question are both visible.",
    },
    {
      feature: "output.notice-warning-error", harness: "Codex", harnessDir: "codex",
      sourceName: "output-notice-warning-error-live.jpg",
      trigger: "Computer Use: inspect the real Codex session after it reports a context-budget warning",
      selector: "[role=status]", expected: "A real provider/runtime warning is visible without crashing the completed session.",
      observed: "The GUI visibly warns that skill descriptions were shortened to fit the 2% skills context budget, provides corrective guidance, and keeps the Codex session Idle and usable.",
    },
    {
      feature: "output.usage-parent", harness: "Codex", harnessDir: "codex",
      sourceName: "output-usage-parent-live.jpg",
      trigger: "Computer Use: inspect the real Codex runtime summary after the turn",
      selector: "[title^=Context]", expected: "Parent context usage is visible as a session-level metric.",
      observed: "The parent runtime visibly reports Context 45,359 / 258,400 tokens, independently from the child and paused-goal surfaces below it.",
    },
    {
      feature: "output.session-status-goal-queue", harness: "Codex", harnessDir: "codex",
      sourceName: "output-session-status-goal-queue.jpg",
      trigger: "Computer Use: inspect the real Codex session after create_goal and native child work",
      selector: "[data-session-runtime]", expected: "Session state, queue depth, and the independent goal lifecycle are visibly distinct.",
      observed: "Session Idle, Queue 0 and Goal Verify Codex goal and native subagent GUI · paused are visible together, while the prior real child result remains in the transcript.",
    },
    {
      feature: "output.final-response", harness: "Codex", harnessDir: "codex",
      sourceName: "input-image-attachment-final.jpg",
      trigger: "Computer Use: send the real image-attachment prompt and wait for the correlated Codex answer",
      selector: "[data-session-turn-answer=true]", expected: "The real prompt reaches a visible terminal assistant reply.",
      observed: "The image-dependent final IMAGEATTACHOK is visibly paired with the real attachment prompt while codex-acp is Idle.",
    },
    {
      feature: "callback.elicitation-form", harness: "Codex", harnessDir: "codex",
      sourceName: "callback-elicitation-form-choice-before.png", protocol: ACP_ELICITATION,
      trigger: "Computer Use: invoke request_user_input in Plan mode and wait for the real structured question to replace the composer",
      selector: "[data-composer-ask]", expected: "A oneOf schema is rendered as numbered full-row choices in the composer slot.",
      observed: "The live Codex session is Running and visibly presents Permission, Subagents, Sessions, Other and Skip as a structured composer form.",
    },
    {
      feature: "runtime.vendor-raw", harness: "Codex", harnessDir: "codex",
      sourceName: "runtime-vendor-raw.png",
      trigger: "Computer Use: expand the real raw vendor event in the completed Codex turn",
      selector: "[data-raw-event]", expected: "Namespaced provider data remains inspectable without replacing canonical UI state.",
      observed: "The Codex vendor event and namespaced metadata are visibly inspectable.",
    },
    {
      feature: "output.plan-document", harness: "Claude", harnessDir: "claude",
      sourceName: "output-plan-document.jpg",
      trigger: "Computer Use: send a real planning prompt to Claude and inspect the completed plan",
      selector: "[data-plan]", expected: "Claude's structured plan is visibly rendered as a document/progress surface.",
      observed: "The real Claude plan with ordered entries is visible in the transcript.",
    },
    {
      feature: "output.task-list-progress", harness: "Claude", harnessDir: "claude",
      sourceName: "output-task-list-progress.jpg",
      trigger: "Computer Use: inspect the real Claude task-progress state during/after execution",
      selector: "[data-task-list]", expected: "Task progress and terminal completion are visible.",
      observed: "Claude task items and their progress/completion states are visible.",
    },
    {
      feature: "output.usage-parent", harness: "Claude", harnessDir: "claude",
      sourceName: "output-usage-parent.jpg",
      trigger: "Computer Use: inspect the real Claude parent runtime summary",
      selector: "[title^=Context]", expected: "Parent context usage is visible independently from child activity.",
      observed: "The Claude parent context usage is visible in the runtime summary.",
    },
    {
      feature: "agent.native-list-lifecycle", harness: "Claude", harnessDir: "claude",
      sourceName: "agent-native-list-lifecycle.jpg",
      trigger: "Computer Use: prompt Claude to use one native child and inspect Agents",
      selector: "[data-resource-category=agents]", expected: "The provider-created child appears with structured lifecycle state.",
      observed: "The Claude native child is visible in Agents with completed state.",
    },
    {
      feature: "agent.native-detail", harness: "Claude", harnessDir: "claude",
      sourceName: "agent-native-detail.jpg",
      trigger: "Computer Use: click the real Claude child in Agents",
      selector: "[role=tab][aria-selected=true]", expected: "The selected native child opens an identifiable detail tab.",
      observed: "The Claude child detail tab is selected and provider identity is visible.",
    },
    {
      feature: "agent.native-transcript", harness: "Claude", harnessDir: "claude",
      sourceName: "agent-native-transcript.jpg",
      trigger: "Computer Use: open the real Claude child after its structured nested transcript arrives",
      selector: "[data-session-turn-id]", expected: "Child-correlated structured text is shown only in the subordinate transcript.",
      observed: "CHILD_OK is visible inside the selected Claude native child transcript.",
    },
    {
      feature: "agent.native-final", harness: "Claude", harnessDir: "claude",
      sourceName: "agent-native-final.jpg",
      trigger: "Computer Use: wait for the real Claude child terminal event and inspect its subordinate session",
      selector: "[data-session-turn-answer=true]", expected: "The provider-structured child final is visibly terminal in the child session.",
      observed: "CHILD_OK is visibly terminal in the native child; the parent separately shows PARENT_OK: CHILD_OK.",
    },
    {
      feature: "output.tool-start-input", harness: "Claude", harnessDir: "claude",
      sourceName: "output-tool-start-input.jpg",
      trigger: "Computer Use: expand the real Claude Agent tool after the native child completes",
      selector: "[data-tool-call-id]", expected: "The Claude Agent tool remains attributable to its exact structured input after completion.",
      observed: "The expanded Agent card visibly shows description Reply CHILD_OK only, the exact CHILD_OK prompt, general-purpose subtype and Completed status.",
    },
    {
      feature: "output.tool-progress-output", harness: "Claude", harnessDir: "claude",
      sourceName: "output-tool-progress-output.jpg",
      trigger: "Computer Use: scroll through the completed real Claude Agent tool output and child result",
      selector: "[data-tool-output]", expected: "The provider output remains visibly associated with the same completed Agent tool.",
      observed: "CHILD_OK is visibly emitted below the structured Agent input, followed by the linked child tab and the separate PARENT_OK: CHILD_OK parent final.",
    },
    {
      feature: "output.tool-terminal", harness: "Claude", harnessDir: "claude",
      sourceName: "output-tool-terminal.jpg",
      trigger: "Computer Use: inspect the real Claude Agent tool after its terminal lifecycle update",
      selector: "[data-tool-status=completed]", expected: "The Agent tool reaches a visible terminal state without losing its input identity.",
      observed: "The Claude Agent row visibly retains its structured input and Completed terminal badge while the session is Idle.",
    },
    {
      feature: "output.session-status-goal-queue", harness: "Claude", harnessDir: "claude",
      sourceName: "output-session-status-goal-queue.jpg",
      trigger: "Computer Use: reopen the completed Claude task/subagent session and expand its persisted plan",
      selector: "[data-session-runtime]", expected: "Session status, queue depth, context usage and task state remain visibly distinct from the transcript.",
      observed: "The Claude runtime visibly reports Idle, CWD, Context 37,754 / 1,000,000, Queue 0 and Plan 0 / 1 above the retained real turn.",
    },
    {
      feature: "callback.permission", harness: "Kilo", harnessDir: "kilo",
      sourceName: "callback-permission-codex-style-final.png",
      trigger: "Computer Use: send a real file-writing prompt to Kilo, open the permission split menu, and allow once",
      selector: "[data-composer-ask]", expected: "The whole composer slot becomes a Codex-style permission form and the decision completes the tool.",
      observed: "Terminal command, Deny, Allow once split action and the completed Kilo final reply are visible across the captured flow.",
      extraEvidence: [
        "Three-stage source: callback-permission-codex-style.png",
        "Three-stage source: callback-permission-codex-style-menu.png",
        "Three-stage source: callback-permission-codex-style-complete.png",
      ],
    },
    {
      feature: "output.thinking-reasoning", harness: "OpenCode", harnessDir: "opencode",
      sourceName: "output-thinking-reasoning.jpg",
      trigger: "Computer Use: reopen the completed real OpenCode file task and inspect its work block",
      selector: "[data-reasoning]", expected: "Non-empty OpenCode reasoning is visibly separated from terminal tools and the final answer.",
      observed: "The expanded worked block visibly lists the requested terminal steps and expected final marker before the tool cards.",
    },
    {
      feature: "output.tool-start-input", harness: "OpenCode", harnessDir: "opencode",
      sourceName: "output-tool-start-input.jpg",
      trigger: "Computer Use: scroll the real OpenCode turn to the first terminal tool card",
      selector: "[data-tool-call-id]", expected: "The started tool row visibly identifies the terminal command and its input.",
      observed: "The completed first terminal row and its expanded command/workdir payload are visible below the OpenCode reasoning.",
    },
    {
      feature: "output.tool-progress-output", harness: "OpenCode", harnessDir: "opencode",
      sourceName: "output-tool-progress-output.jpg",
      trigger: "Computer Use: scroll through the real OpenCode terminal sequence after both commands complete",
      selector: "[data-tool-output]", expected: "Intermediate file-create/readback progress and output remain visible before the final answer.",
      observed: "The second terminal payload and the visible 16-byte readback verification are rendered in sequence.",
    },
    {
      feature: "output.tool-terminal", harness: "OpenCode", harnessDir: "opencode",
      sourceName: "output-tool-terminal.jpg",
      trigger: "Computer Use: inspect both terminal cards in the completed real OpenCode turn",
      selector: "[data-tool-status=completed]", expected: "Each terminal command has a visible terminal lifecycle state and attributable input.",
      observed: "Two distinct terminal rows are visible with Completed badges; the expanded command payload remains attached to each row.",
    },
    {
      feature: "output.tool-start-input", harness: "Kilo", harnessDir: "kilo",
      sourceName: "output-tool-start-input.jpg",
      trigger: "Computer Use: reopen the completed real Kilo file task and scroll to its first Bash tool row",
      selector: "[data-tool-call-id]", expected: "The started Kilo Bash tool visibly identifies its command input and lifecycle state.",
      observed: "The first Kilo terminal row is visible beneath non-empty reasoning with the file-creation command and Completed badge.",
    },
    {
      feature: "output.tool-progress-output", harness: "Kilo", harnessDir: "kilo",
      sourceName: "output-tool-progress-output.jpg",
      trigger: "Computer Use: inspect the second real Kilo Bash row after the file is read back",
      selector: "[data-tool-output]", expected: "The readback tool output stays attributable to the tool before the final answer.",
      observed: "The expanded cat e2e-kilo.txt payload, 12-byte verification, KILO_FILE_OK and final KILO_BATCH_OK:95 are visible in sequence.",
    },
    {
      feature: "output.tool-terminal", harness: "Kilo", harnessDir: "kilo",
      sourceName: "output-tool-terminal.jpg",
      trigger: "Computer Use: inspect both completed Kilo Bash cards in the real turn",
      selector: "[data-tool-status=completed]", expected: "Each Kilo terminal command has a visible terminal lifecycle badge and command payload.",
      observed: "Both file-create and file-read terminal rows are visible with separate Completed badges and expanded command data.",
    },
  ];

  for (const entry of entries) {
    await markLive({ manifest, root, batchRoot, runAt, ...entry });
  }

  await markReplay({
    manifest, root, batchRoot, runAt,
    feature: "runtime.vendor-raw", harness: "Codex",
    harnessDir: "../../harness-feature-matrix-staging/screenshots/matrix",
    sourceName: "45-runtime-vendor-raw--codex.png",
    trigger: "Deterministic replay: project a namespaced Codex extension notification into the raw-event inspector",
    selector: "[data-raw-event-inspector]",
    expected: "Namespaced provider data remains inspectable without replacing canonical UI state.",
    observed: "The replay visibly renders method, type, status, error and payload; no real Codex raw-notification run has been captured yet.",
  });

  // The strict rerun visibly selected Anthropic/DeepSeek V4 Flash, but the
  // current API key returned HTTP 401. Kilo then converted that failed prompt
  // into a zero-token end_turn without surfacing the provider error. Keep all
  // downstream permission/tool cells red until a valid-key rerun emits them.
  for (const { feature, sourceName } of [
    { feature: "callback.permission", sourceName: "deepseek-rerun-running.jpg" },
    { feature: "output.tool-start-input", sourceName: "deepseek-rerun-prompt-ready.jpg" },
    { feature: "output.tool-progress-output", sourceName: "deepseek-rerun-model-selected.jpg" },
    { feature: "output.tool-terminal", sourceName: "deepseek-rerun-no-tool-terminal-current.jpg" },
  ]) {
    await markLiveGap({
      manifest,
      root,
      batchRoot,
      runAt,
      feature,
      harness: "Kilo",
      harnessDir: "kilo",
      sourceName,
      status: "fail",
      reason: "The real Kilo GUI rerun used Anthropic/DeepSeek V4 Flash, but the configured key returned HTTP 401 and Kilo silently completed with zero tokens and no permission, tool, or assistant event.",
      trigger: "Computer Use: select Kilo with Anthropic/DeepSeek V4 Flash, send the real file-tool prompt, and wait through session completion",
      protocolBasis: "Official ACP v1 plus the user-required DeepSeek Anthropic routing contract; provider failures must remain visible and no downstream feature can pass without its actual ACP event",
      selector: "[data-composer-runtime-trigger]",
      expected: "Kilo must emit the real permission/tool lifecycle and final assistant response through Anthropic/DeepSeek V4 Flash.",
      observed: "The correct Anthropic/DeepSeek V4 Flash chip and submitted prompt are visible, but the session returns to Idle with no reasoning, permission, tool, or final reply; the direct endpoint check returned authentication_error (HTTP 401).",
      extraEvidence: [
        "Correct-route source: deepseek-rerun-model-selected.jpg",
        "Submitted-prompt source: deepseek-rerun-prompt-ready.jpg",
        "Direct ACP trace: artifacts/harness-feature-matrix-staging/live-traces/kilo-final-response.json (zero-token promptComplete)",
      ],
    });
  }
  await markLiveGap({
    manifest,
    root,
    batchRoot,
    runAt,
    feature: "output.notice-warning-error",
    harness: "Kilo",
    harnessDir: "kilo",
    sourceName: "deepseek-rerun-no-events.jpg",
    status: "fail",
    reason: "The real Kilo DeepSeek rerun hit HTTP 401, but Kilo converted it into a zero-token end_turn and the GUI returned to Idle without surfacing any warning or error notice.",
    trigger: "Computer Use: send the real Kilo DeepSeek prompt with the required route, wait for the provider rejection, and inspect the completed GUI",
    protocolBasis: "Official ACP v1 plus the user-required DeepSeek Anthropic routing contract; provider failure must remain visible to the client",
    selector: "[data-notice-kind=error]",
    expected: "The real provider authentication failure is visibly surfaced as an error notice and no final response is fabricated.",
    observed: "The submitted prompt and correct model chip remain visible, but the session silently returns to Idle with no notice, error, tool, or assistant final; the direct endpoint check returned authentication_error (HTTP 401).",
    extraEvidence: [
      "Correct-route source: deepseek-rerun-model-selected.jpg",
      "Submitted-prompt source: deepseek-rerun-prompt-ready.jpg",
      "Direct ACP trace: artifacts/harness-feature-matrix-staging/live-traces/kilo-final-response.json (zero-token promptComplete)",
    ],
  });

  const baseRuns = [
    {
      harness: "Claude",
      harnessDir: "../claude",
      promptFile: "01-prompt-entered.png",
      runningFile: "02-sent.png",
      initializeFile: "session-initialize-ready-current.jpg",
      initializeHarnessDir: "claude",
      finalFile: "output-final-response-current.jpg",
      finalHarnessDir: "claude",
      marker: "PARENT_OK: CHILD_OK",
      thinkingFile: "05-thinking-and-final.png",
      thinkingMarker: "CLAUDE_CU_OK: 95",
      thinking: true,
    },
    {
      harness: "Cursor",
      harnessDir: "../cursor",
      promptFile: "07-account-prompt-entered.png",
      runningFile: "08-account-running.png",
      initializeFile: "09-account-final-idle.png",
      finalFile: "output-final-response-preserved.jpg",
      finalHarnessDir: "cursor",
      marker: "CURSOR_CU_OK: 95",
      finalTrigger: "Computer Use: reopen the real Cursor session after its later connection stall and inspect the preserved successful answer",
      finalObserved: "CURSOR_CU_OK: 95 remains visibly preserved in the transcript; the runtime separately shows the later Error state instead of deleting the prior final.",
      thinking: false,
    },
    {
      harness: "Pi",
      harnessDir: "../pi",
      promptFile: "01-prompt-entered.png",
      runningFile: "session-initialize-running-valid.jpg",
      runningHarnessDir: "../batch-basic-20260807/pi",
      initializeFile: "session-initialize-ready-current.jpg",
      initializeHarnessDir: "pi",
      finalFile: "output-final-response-current.jpg",
      finalHarnessDir: "pi",
      marker: "PI_VALID_OK: 95",
      thinkingFile: "output-final-response-valid.jpg",
      thinkingHarnessDir: "../batch-basic-20260807/pi",
      thinkingMarker: "PI_VALID_OK: 95",
      thinking: true,
    },
    {
      harness: "OpenCode",
      harnessDir: "../opencode",
      promptFile: "04-retry-after-launch-fix-prompt.png",
      runningFile: "05-retry-running.png",
      initializeFile: "session-initialize-ready-current.jpg",
      initializeHarnessDir: "opencode",
      finalFile: "06-retry-final-idle.png",
      marker: "OPENCODE_CU_OK: 95",
      thinking: false,
    },
    {
      harness: "Kilo",
      harnessDir: "../kilo",
      promptFile: "04-retry-after-launch-fix-prompt.png",
      runningFile: "05-retry-running.png",
      initializeFile: "session-initialize-ready-current.jpg",
      initializeHarnessDir: "kilo",
      finalFile: "output-final-response-current.jpg",
      finalHarnessDir: "kilo",
      marker: "CODEX_STYLE_OK",
      thinkingFile: "06-retry-thinking-final-idle.png",
      thinkingMarker: "KILO_CU_OK: 95",
      thinking: true,
    },
    {
      harness: "Kimi Code",
      harnessDir: "kimi-code",
      promptFile: "fresh-input-prompt.jpg",
      runningFile: "session-fork-side-chat-running.jpg",
      initializeFile: "session-initialize-ready-current.jpg",
      finalFile: "fresh-output-final.jpg",
      marker: "KIMI-FRESH-TOOLS-OK",
      thinking: false,
    },
  ];
  for (const run of baseRuns) {
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "session.initialize-ready",
      harness: run.harness,
      harnessDir: run.initializeHarnessDir ?? run.harnessDir,
      sourceName: run.initializeFile ?? run.finalFile,
      trigger: "Computer Use: start the real harness, send a prompt, and wait for the Electron session to reach Idle",
      selector: "[data-session-runtime]",
      expected: "The real harness reaches an initialized, usable session and a terminal Idle state.",
      observed: `${run.harness} completed a real prompt and its runtime card is visibly Idle.`,
    });
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "input.prompt-text",
      harness: run.harness,
      harnessDir: run.harnessDir,
      sourceName: run.promptFile,
      trigger: "Computer Use: type the exact arithmetic validation prompt into the real harness composer",
      selector: "textarea",
      expected: "The exact unsent user prompt is visible in the composer.",
      observed: `${run.harness} validation prompt is visible before send.`,
    });
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "output.streaming-response",
      harness: run.harness,
      harnessDir: run.runningHarnessDir ?? run.harnessDir,
      sourceName: run.runningFile,
      trigger: "Computer Use: send the real prompt and capture the session before terminal completion",
      selector: "[data-session-turn-id]",
      expected: "The turn visibly enters a running/streaming state.",
      observed: `${run.harness} is visibly processing the sent prompt before the final reply.`,
    });
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "output.final-response",
      harness: run.harness,
      harnessDir: run.finalHarnessDir ?? run.harnessDir,
      sourceName: run.finalFile,
      trigger: run.finalTrigger ?? "Computer Use: wait for the real harness prompt to finish and inspect the assistant answer",
      selector: "[data-session-turn-answer=true]",
      expected: `The visible terminal answer contains ${run.marker}.`,
      observed: run.finalObserved ?? `${run.marker} is visible and the session is Idle.`,
    });
    if (run.thinking) {
      await markLive({
        manifest, root, batchRoot, runAt,
        feature: "output.thinking-reasoning",
        harness: run.harness,
        harnessDir: run.thinkingHarnessDir ?? run.harnessDir,
        sourceName: run.thinkingFile ?? run.finalFile,
        trigger: "Computer Use: send the real prompt and inspect the non-empty work/reasoning block before/with the final",
        selector: "[data-reasoning]",
        expected: "Non-empty provider reasoning is visible and separated from the final answer.",
        observed: `${run.harness} shows a non-empty work/reasoning block and the separate terminal ${run.thinkingMarker ?? run.marker}.`,
      });
    }
  }

  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "input.queue", harness: "Cursor",
    harnessDir: "../batch-table-20260807/cursor",
    sourceName: "input-queue-after.jpg",
    trigger: "Computer Use: submit a second real Cursor prompt while the first turn is running",
    selector: "[data-composer-queue]",
    expected: "The queued prompt is visible in the composer activity area until promoted.",
    observed: "The second Cursor prompt is visibly queued while the active turn continues.",
    extraEvidence: ["Before source: input-queue-before.jpg"],
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "input.steering", harness: "Cursor",
    harnessDir: "../batch-table-20260807/cursor",
    sourceName: "input-steering-applied.jpg",
    trigger: "Computer Use: send a real steering message during the active Cursor turn",
    selector: "[data-steering]",
    expected: "The steering instruction is visibly delivered to the active turn rather than shown as a completed answer.",
    observed: "The Cursor steering instruction is visible as applied while the same turn remains active.",
    extraEvidence: ["Before source: input-steering.jpg"],
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "callback.permission", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "callback-permission-composer.png",
    trigger: "Computer Use: run a real Cursor operation that requests client permission",
    selector: "[data-composer-ask]",
    expected: "The real terminal permission request replaces the composer with a compact command-aware form.",
    observed: "Cursor's Terminal command, Reject and Allow once actions are visibly awaiting a user decision in the composer slot.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.thinking-reasoning", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "output-tool-terminal-existing.png",
    trigger: "Computer Use: run a real Cursor terminal task and inspect the non-empty work block while the turn is active",
    selector: "[data-reasoning]",
    expected: "Non-empty Cursor reasoning is visibly separated from the final answer and tool activity.",
    observed: "The live Cursor session visibly shows a non-empty worked/reasoning block above the separate answer while the terminal task is running.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-start-input", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "output-tool-start-input.jpg",
    trigger: "Computer Use: reopen the completed real Cursor terminal tool row and expand its structured input",
    selector: "[data-tool-call-id]",
    expected: "The completed Cursor terminal tool remains attributable to its exact command input.",
    observed: "The expanded tool card visibly shows the full printf/readback/verification command, its structured command payload and Completed badge.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-progress-output", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "output-tool-progress-output.jpg",
    trigger: "Computer Use: scroll through the expanded real Cursor terminal tool output",
    selector: "[data-tool-output]",
    expected: "The terminal tool's output remains visibly associated with the same completed call.",
    observed: "The real tool output visibly includes READBACK: [CURSOR_FILE_OK] and VERIFY: OK, followed by the agent's matching readback summary and final reply.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-terminal", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "output-tool-terminal.jpg",
    trigger: "Computer Use: inspect the real Cursor terminal tool after its terminal lifecycle event",
    selector: "[data-tool-status=completed]",
    expected: "The terminal command reaches a visible Completed state without losing its command identity.",
    observed: "The Cursor tool row visibly retains the command, structured input and Completed terminal badge above the verified result summary.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-start-input", harness: "Codex",
    harnessDir: "codex",
    sourceName: "output-tool-start-input.jpg",
    trigger: "Computer Use: reopen the completed real Codex file task, expand its three-tool group and inspect the first terminal call",
    selector: "[data-tool-call-id]",
    expected: "The first Codex terminal tool remains attributable to its exact structured command after the group completes.",
    observed: "The expanded group visibly shows command -v apply_patch, its structured command payload and a Completed badge, followed by Editing files and Read file calls.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-progress-output", harness: "Codex",
    harnessDir: "codex",
    sourceName: "output-tool-progress-output.jpg",
    trigger: "Computer Use: expand the completed Codex Read file call inside the real three-tool group",
    selector: "[data-tool-output]",
    expected: "The file readback output remains visibly associated with the correct terminal call.",
    observed: "The Read file call is visibly Completed and its structured formatted_output is TOOL-OK for matrix-tools-codex.txt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-terminal", harness: "Codex",
    harnessDir: "codex",
    sourceName: "output-tool-terminal.jpg",
    trigger: "Computer Use: collapse the completed real Codex three-tool group and inspect its terminal summary",
    selector: "[data-tool-status=completed]",
    expected: "The grouped Codex tools reach visible terminal states and preserve their final group identity.",
    observed: "The collapsed 3 个工具调用 summary remains visible above TOOLS-FINAL-CODEX-TOOL-OK while the codex-acp session is Idle.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "callback.permission", harness: "Codex",
    harnessDir: "codex",
    sourceName: "callback-permission-before.jpg",
    trigger: "Computer Use: set Codex to request approval, submit a real terminal operation outside the session CWD, then click Allow Once in the composer-slot form",
    selector: "[data-composer-ask]",
    expected: "The real terminal permission request replaces the composer with a command-aware Reject / Allow Once form, then records the decision and completes the turn.",
    observed: "The before screenshot visibly shows the real terminal command with Reject and Allow Once in the composer slot; after the Computer Use click, the completed turn shows Callback decisions · 1 decision, the terminal call Completed, CODEXPERMISSIONWRITEOK and Idle.",
    extraEvidence: [`Computer Use completion source: ${resolve(batchRoot, "codex", "callback-permission-final.jpg")}`],
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "callback.filesystem", harness: "Codex",
    harnessDir: "codex",
    sourceName: "callback-filesystem.jpg",
    trigger: "Computer Use: expand the real Codex Editing files callback inside the completed three-tool group",
    selector: "[data-workspace-change]",
    expected: "A structured filesystem edit remains visibly attributable to its path and content delta.",
    observed: "The completed Editing files row visibly shows /Users/xiaoyang/.oma/sessions/sess-uuvsxy7s/matrix-tools-codex.txt and the green + TOOL-OK addition.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "callback.terminal", harness: "Codex",
    harnessDir: "codex",
    sourceName: "callback-terminal.jpg",
    trigger: "Computer Use: expand the real Codex terminal callback that probes apply_patch",
    selector: "[data-terminal-call]",
    expected: "The terminal callback remains visibly attributable to its exact command, CWD and terminal state.",
    observed: "The expanded completed terminal row visibly shows command -v apply_patch, CWD /Users/xiaoyang/.oma/sessions/sess-uuvsxy7s and a Completed badge.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.notice-warning-error", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "output-notice-warning-error-current.jpg",
    trigger: "Computer Use: inspect the selected Cursor session after its authenticated connection stalls",
    selector: "[data-notice-kind=error]",
    expected: "A real provider/runtime failure is visibly surfaced as an error rather than a fabricated final response.",
    observed: "The transcript visibly shows Internal error in red and the composer is replaced by 会话出错，请新建对话 while the prior verified tool content remains intact.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.session-status-goal-queue", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "output-session-status-goal-queue.jpg",
    trigger: "Computer Use: inspect Cursor's runtime header after the connection-stalled turn",
    selector: "[data-session-runtime]",
    expected: "The GUI visibly distinguishes the session's terminal status and queue count from transcript and local terminal state.",
    observed: "The runtime header visibly reports Cursor Error, the selected CWD and Queue 0 while the transcript separately shows RetrieableError: Connection stalled.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.fork-side-chat", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "session-fork-side-chat.jpg",
    trigger: "Computer Use: open the real Cursor main session menu, choose Open context fork, and inspect the selected side composer",
    selector: "[data-side-tab-type=chat]",
    expected: "A GUI-created subordinate side chat opens in the right rail and inherits the parent harness/config without replacing the main transcript.",
    observed: "The selected 上下文分支 tab is visible beside the unchanged Cursor parent transcript, and the side composer visibly inherits Cursor with Auto.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.side-chat-promote", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "session-side-chat-promote.jpg",
    trigger: "Computer Use: click 转为主对话 on the selected Cursor side draft after fixing promoted-draft harness binding",
    selector: "[data-chat-surface=main]",
    expected: "The promoted side chat becomes an independent main draft and preserves the inherited Cursor runtime/config.",
    observed: "The side tab disappears, the main New chat surface becomes active, and its composer visibly remains bound to Cursor with Auto rather than falling back to Kilo/DeepSeek.",
  });
  for (const run of [
    {
      harness: "Claude", harnessDir: "claude", runtime: "Claude with deepseek-v4-flash",
      forkKind: "ACP session/fork (advertised)",
    },
    {
      harness: "Codex", harnessDir: "codex", runtime: "Codex with GPT-5.6-Sol",
      forkKind: "fresh subordinate fallback because codex-acp does not advertise session/fork",
    },
    {
      harness: "Kilo", harnessDir: "kilo", runtime: "Kilo with Anthropic/DeepSeek V4 Flash",
      forkKind: "ACP session/fork (advertised)",
    },
    {
      harness: "Pi", harnessDir: "pi", runtime: "pi ACP with deepseek-anthropic/DeepSeek V4 Flash",
      forkKind: "fresh subordinate fallback because pi-acp does not advertise session/fork",
    },
  ]) {
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "session.fork-side-chat", harness: run.harness,
      harnessDir: run.harnessDir,
      sourceName: "session-fork-side-chat.jpg",
      trigger: `Computer Use: open the real ${run.harness} main-session menu, choose Open context fork, and inspect the selected side composer`,
      selector: "[data-side-tab-type=chat]",
      expected: "A GUI-created subordinate side chat opens in the right rail, uses ACP session/fork when advertised, and otherwise uses the documented fresh fallback while preserving harness/config.",
      observed: `The selected 上下文分支 tab is visible beside the unchanged parent transcript; the side composer visibly remains ${run.runtime}. Path: ${run.forkKind}.`,
    });
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "session.side-chat-promote", harness: run.harness,
      harnessDir: run.harnessDir,
      sourceName: "session-side-chat-promote.jpg",
      trigger: `Computer Use: click 转为主对话 on the selected ${run.harness} side draft`,
      selector: "[data-chat-surface=main]",
      expected: "The promoted side chat becomes an independent main draft and preserves the side draft's harness/config.",
      observed: `The side tab disappears, the main New chat surface becomes active, and its composer visibly remains ${run.runtime}.`,
    });
  }

  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "callback.permission", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-callback-permission.jpg",
    trigger: "Computer Use: ask a fresh Kimi Code session to write and read a file, then wait for its real Write permission callback",
    selector: "[data-composer-ask]",
    expected: "Kimi Code's Write approval request replaces the composer with Reject and Approve once actions.",
    observed: "The fresh Kimi Code session is visibly Running while Approval required, Write, Reject and Approve once replace the composer.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-start-input", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-output-tool-start-input.jpg",
    trigger: "Computer Use: approve the real Kimi Write request, then expand the first completed tool row",
    selector: "[data-tool-call-id]",
    expected: "The first Kimi tool stays attributable to its file path and input after completion.",
    observed: "Writing kimi-fresh-tool.txt is visible with a Completed badge and its structured path/content payload.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-progress-output", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-output-tool-progress-output.jpg",
    trigger: "Computer Use: inspect the completed Kimi Write followed by the real Read tool",
    selector: "[data-tool-output]",
    expected: "Write progress and the subsequent readback stay visibly ordered before the final answer.",
    observed: "The expanded TOOL-OK write payload and the separate Reading kimi-fresh-tool.txt Completed row are visible in sequence.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-terminal", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-output-tool-terminal.jpg",
    trigger: "Computer Use: ask the same fresh Kimi session to run pwd with its Bash tool and approve once",
    selector: "[data-tool-status=completed]",
    expected: "The Bash command has a visible completed lifecycle state and attributable command payload.",
    observed: "Running: pwd is visible with a Completed badge and the structured command payload attached beneath it.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "callback.filesystem", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-callback-filesystem.jpg",
    trigger: "Computer Use: complete Kimi's real Write and Read operations and inspect the canonical file UI",
    selector: "[data-tool-call-id]",
    expected: "The filesystem callback preserves the requested relative path, written content and completed readback.",
    observed: "Writing kimi-fresh-tool.txt shows content TOOL-OK and Reading kimi-fresh-tool.txt is separately visible as Completed.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "callback.terminal", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-callback-terminal.jpg",
    trigger: "Computer Use: run Kimi's real pwd Bash request through terminal/create, wait, output and release",
    selector: "[data-raw-event]",
    expected: "The terminal callback lifecycle remains inspectable and the background command reaches completion.",
    observed: "The terminal/release client response, Idle session, and completed /bin/bash background entry are visible together.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.vendor-raw", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-runtime-vendor-raw.jpg",
    trigger: "Computer Use: expand the provider/raw protocol events after the real Kimi terminal turn completes",
    selector: "[data-raw-event]",
    expected: "Kimi-specific raw events remain inspectable without replacing canonical final/tool UI.",
    observed: "KIMI-TERMINAL-OK and the raw terminal protocol event are visibly separate in the completed fresh session.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.background-work", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "output-tool-final.png",
    trigger: "Computer Use: execute the approved Kimi Code file task and inspect the Background resource section",
    selector: "[data-resource-category=background]",
    expected: "Background work is visible independently from the parent session's Idle state.",
    observed: "Kimi Code is visibly Idle while the right rail separately shows one completed background /bin/bash command.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.foreground-terminal", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-runtime-foreground-terminal.jpg",
    trigger: "Computer Use: open the Kimi session's right-rail Terminal resource, type echo KIMIUITERMOK and press Return",
    selector: "[data-terminal-id]",
    expected: "A user-opened foreground shell is interactive and visibly returns the entered command output.",
    observed: "The foreground terminal tab visibly shows echo KIMIUITERMOK, the KIMIUITERMOK output and a returned shell prompt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.resources", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-runtime-resources.jpg",
    trigger: "Computer Use: open the Kimi session's Files resource in the right rail after the real Write/Read task",
    selector: "[data-resource-category=files]",
    expected: "Session resources open in the right rail and expose real workspace state independently from the transcript.",
    observed: "The Files tab shows the live session CWD and kimi-fresh-tool.txt while the parent remains Idle.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.session-status-goal-queue", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "output-session-status-goal-queue.jpg",
    trigger: "Computer Use: reopen the completed real Kimi Code file-tool session and inspect its runtime header",
    selector: "[data-session-runtime]",
    expected: "The GUI visibly distinguishes ACP session status and queue count from reasoning, grouped tools and final response.",
    observed: "The Kimi runtime header visibly reports Idle, CWD /Users/xiaoyang/.oma/sessions/sess-xn2wy6b2 and Queue 0 above the real grouped tool turn and KIMI-FRESH-TOOLS-OK final.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.notice-warning-error", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "session-resume-auth-failure.jpg",
    trigger: "Computer Use: reload the real Kimi Code session while its runtime authentication is unavailable and inspect the recovered transcript",
    selector: "[data-notice-kind=error]",
    expected: "The authentication failure remains visibly attributable to the Kimi session without deleting its earlier successful response.",
    observed: "The real Kimi Code session visibly reports Error, Queue 0 and Authentication required while retaining its earlier KIMI_CODE_CU_OK: 95 final and completed background shell.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.usage-parent", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "fresh-output-usage-parent.jpg",
    trigger: "Computer Use: inspect the fresh Kimi parent runtime after its completed tool and terminal turns",
    selector: "[title^=Context]",
    expected: "Parent context usage is visible as a session-level metric separate from tools and side resources.",
    observed: "Context 29,066 / 1,000,000 tokens, Idle and Queue 0 are visibly grouped in the Kimi parent runtime card.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.fork-side-chat", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "session-fork-side-chat-final.jpg",
    trigger: "Computer Use: click Context fork, send a real prompt in the side composer, and wait for its terminal answer",
    selector: "[data-side-session-id]",
    expected: "A GUI-created subordinate side session inherits parent context, runs independently and reaches a visible final answer.",
    observed: "The right-rail Kimi side session is Idle and visibly answers SIDE_KIMI_OK:kimi-fresh-tool.txt from inherited parent context while the parent remains separate.",
    extraEvidence: [
      "Before-send source: session-fork-side-chat-before.jpg",
      "Running source: session-fork-side-chat-running.jpg",
    ],
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.side-chat-promote", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "session-side-chat-promote-final.jpg",
    trigger: "Computer Use: click Convert to main chat on the completed Kimi side session",
    selector: "[data-session-id]",
    expected: "Promotion removes the subordinate placement and makes the inherited session an independent selected main conversation.",
    observed: "The inherited Kimi conversation is selected in the main left conversation list, the right rail returns to resources, and SIDE_KIMI_OK:kimi-fresh-tool.txt remains visible.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.local-archive-delete", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "session-local-archive-delete-confirm.jpg",
    trigger: "Computer Use: archive the promoted Kimi test session, open Settings > Archived chats, choose Delete permanently, then confirm",
    selector: "role=button[name=\"确认删除\"]",
    expected: "The locally archived test chat exposes a two-step permanent-delete confirmation and disappears only after explicit confirmation.",
    observed: "The dedicated Kimi test session is visible in Archived sessions with Restore and Confirm delete; after confirmation the page visibly reports No archived sessions.",
    extraEvidence: [
      "Archived-list source: session-local-archive-delete-before.jpg",
      "Post-delete source: session-local-archive-delete-after.jpg",
      "Deleted target was the dedicated sess-xn2wy6b2 test session and its kimi-fresh-tool.txt; it is not recoverable",
    ],
  });

  for (const harness of ["Claude", "Codex", "OpenCode", "Kilo"]) {
    const harnessDir = harness.toLowerCase();
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "session.resume", harness,
      harnessDir,
      sourceName: "session-resume-current-live.png",
      trigger: `Computer Use: switch away from the persisted ${harness} session, reopen it from the real conversation list, and inspect the negotiated runtime`,
      selector: "[data-session-runtime]",
      expected: `The ${harness} adapter advertises sessionCapabilities.resume and the persisted session reconnects in a usable terminal state.`,
      observed: `${harness} visibly reopens with its persisted transcript, sessionCapabilities.resume, terminal Idle state and Queue 0.`,
      extraEvidence: [
        "Official ACP v1 session/resume is capability-gated and distinct from session/load history replay",
      ],
    });
  }

  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "session.resume", harness: "Pi",
    harnessDir: "pi",
    sourceName: "session-resume-current-live.png",
    status: "n-a",
    reason: "Pi ACP 0.0.33 exposes loadSession plus session list/delete, but does not advertise sessionCapabilities.resume; a successful legacy history load is not treated as ACP session/resume.",
    trigger: "Computer Use: reopen the persisted Pi session and inspect the complete negotiated capability list in the live runtime card",
    protocolBasis: "Official ACP v1 session/resume capability negotiation plus real Pi ACP 0.0.33 Electron behavior",
    selector: "[data-session-runtime]",
    expected: "Do not claim ACP session/resume unless sessionCapabilities.resume is visibly negotiated.",
    observed: "Pi visibly reopens Idle with its transcript through loadSession, while the runtime card advertises session list/delete and no sessionCapabilities.resume.",
  });

  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "session.resume", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "session-resume-current-live.png",
    status: "fail",
    reason: "The persisted Cursor transcript and files are restored, but the live runtime enters Error with Internal error and disables the session composer.",
    trigger: "Computer Use: switch away from the persisted Cursor session, reopen it from the real conversation list, and inspect the terminal runtime state",
    protocolBasis: "Official ACP v1 session/resume semantics plus real Cursor Agent Electron behavior",
    selector: "[data-session-runtime]",
    expected: "A resumed Cursor session reaches a usable terminal state after reconnecting to its persisted context.",
    observed: "Cursor visibly restores CURSOR_CU_OK: 95 and its Files resource, but the runtime is Error, shows Internal error, and the composer says to create a new chat.",
  });

  const restartReplayRuns = [
    { harness: "Claude", harnessDir: "claude", marker: "PARENT_OK: CHILD_OK", state: "Idle" },
    { harness: "Codex", harnessDir: "codex", marker: "PARENT_OK: CHILD_OK", state: "Idle" },
    { harness: "Cursor", harnessDir: "cursor", marker: "CURSOR_CU_OK: 95", state: "Error" },
    { harness: "Pi", harnessDir: "pi", marker: "PI_VALID_OK: 95", state: "Idle" },
    { harness: "OpenCode", harnessDir: "opencode", marker: "OPENCODE", state: "Idle" },
    { harness: "Kilo", harnessDir: "kilo", marker: "KILO", state: "Idle" },
    { harness: "Kimi Code", harnessDir: "kimi-code", marker: "KIMI_CODE_CU_OK: 95", state: "Idle" },
  ];
  for (const run of restartReplayRuns) {
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "session.restart-replay", harness: run.harness,
      harnessDir: run.harnessDir,
      sourceName: "session-restart-replay-current-live.png",
      trigger: `Computer Use: press Command-R in the real Electron window, then reopen the persisted ${run.harness} conversation from the rehydrated sidebar`,
      selector: "[data-session-turn-id]",
      expected: `After an Electron renderer restart, the ${run.harness} conversation and its prior terminal answer are visibly restored from persisted Backchat state.`,
      observed: `${run.harness} reappears after reload with its persisted transcript and ${run.marker} visible; its independently reported ACP runtime state is ${run.state}.`,
      extraEvidence: [
        run.harness === "Cursor"
          ? "Cursor local transcript/file replay passed even though its separate ACP reconnect state remains Error"
          : `${run.harness} runtime returned to ${run.state} with Queue 0`,
      ],
    });
  }

  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.resume", harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "session-resume-current-success.png",
    trigger: "Computer Use: reopen the persisted Kimi Code session after restarting Backchat with the verified provider environment",
    selector: "[data-session-runtime]",
    expected: "The persisted Kimi Code session resumes with its transcript, terminal Idle state and separate background resources intact.",
    observed: "Kimi Code 0.33.0 visibly resumes Idle with Queue 0 and the earlier KIMI_CODE_CU_OK: 95 transcript; its completed background command remains in the right resource rail and no longer creates composer chrome.",
    extraEvidence: [
      "Current screenshot was captured after the composer Activity Pill fix and shows background work only in the right resource rail",
    ],
  });

  const newWorkspaceRuns = [
    { harness: "Claude", harnessDir: "claude", model: "deepseek-v4-flash" },
    { harness: "Codex", harnessDir: "codex", model: "GPT-5.6-Sol" },
    { harness: "Cursor", harnessDir: "cursor", model: "Auto" },
    { harness: "Pi", harnessDir: "pi", model: "DeepSeek" },
    { harness: "OpenCode", harnessDir: "opencode", model: "Anthropic/DeepSeek V4 Flash" },
    { harness: "Kilo", harnessDir: "kilo", model: "Anthropic/DeepSeek V4 Flash" },
    { harness: "Kimi Code", harnessDir: "kimi-code", model: "Anthropic/DeepSeek V4 Flash" },
  ];
  for (const run of newWorkspaceRuns) {
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "session.new-workspace", harness: run.harness,
      harnessDir: run.harnessDir,
      sourceName: "session-new-workspace-current-live-responsive.jpg",
      trigger: `Computer Use: create a real New Chat, choose the conversation-specific workspace, and select ${run.harness} from the unlocked harness menu`,
      selector: "[data-slot=home-suggestions]",
      expected: `A fresh conversation-specific workspace keeps the composer unlocked, identifies ${run.harness}, and preserves access to files, browser and terminal resources before the first prompt.`,
      observed: `${run.harness} is visibly selected with ${run.model} in a fresh New Chat; the four suggestions reflow to two columns beside the open resource rail and the composer remains ready for the first prompt.`,
      extraEvidence: [
        "The same responsive grid was also verified at three columns with the resource rail collapsed",
        "The harness submenu no longer renders local executable paths",
      ],
    });
  }

  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.fork-side-chat", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "session-fork-side-chat-final.jpg",
    trigger: "Computer Use: click Context fork from the real OpenCode parent, send a prompt that depends on the parent's file task, and wait for its terminal answer",
    selector: "[data-side-session-id]",
    expected: "The side session inherits the parent harness, selected model/config and conversation context, then reaches an independent visible final answer.",
    observed: "The right-rail OpenCode side session is Idle and visibly answers SIDE_OPENCODE_OK:e2e-opencode.txt from inherited parent context; both parent and child show OpenCode using Anthropic/DeepSeek V4 Flash.",
    extraEvidence: [
      "Inherited-config source: session-fork-side-chat-inherited-config.jpg",
      "Before-send source: session-fork-side-chat-before.jpg",
      "Running source: session-fork-side-chat-running.jpg",
    ],
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "session.side-chat-promote", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "session-side-chat-promote-final.jpg",
    trigger: "Computer Use: click Convert to main chat on the completed OpenCode side session",
    selector: "[data-session-id]",
    expected: "Promotion removes the subordinate placement and makes the inherited OpenCode session an independently selected main conversation.",
    observed: "The inherited OpenCode conversation is selected in the main left conversation list, the right rail returns to resources, and SIDE_OPENCODE_OK:e2e-opencode.txt remains visible.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.resources", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "runtime-resources.jpg",
    trigger: "Computer Use: open the promoted OpenCode session's Files resource after the real inherited-context turn",
    selector: "[data-resource-category=files]",
    expected: "Session resources open in the right rail and expose real workspace state independently from the transcript.",
    observed: "The Files tab visibly shows the live OpenCode session CWD and e2e-opencode.txt while the promoted session remains Idle.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.foreground-terminal", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "runtime-foreground-terminal.jpg",
    trigger: "Computer Use: open the promoted OpenCode session's Terminal resource, type echo OPENCODEUITERMOK and press Return",
    selector: "[data-terminal-id]",
    expected: "A user-opened foreground shell is interactive and visibly returns the entered command output.",
    observed: "The foreground terminal visibly shows echo OPENCODEUITERMOK, the OPENCODEUITERMOK output and a returned shell prompt while the ACP session remains Idle.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.foreground-terminal", harness: "Codex",
    harnessDir: "codex",
    sourceName: "runtime-foreground-terminal.jpg",
    trigger: "Computer Use: open the completed Codex goal/subagent session's Terminal resource, create codexuiterminal.txt, print CODEXUITERMOK and list the file",
    selector: "[data-terminal-id]",
    expected: "A user-opened foreground shell is interactive and visibly returns the entered command output in the selected Codex session.",
    observed: "The screenshot visibly combines the codex-acp runtime, the real goal/subagent transcript, CODEXUITERMOK, codexuiterminal.txt and a returned shell prompt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.resources", harness: "Codex",
    harnessDir: "codex",
    sourceName: "runtime-resources.jpg",
    trigger: "Computer Use: open New tab > Files in the completed Codex session after the foreground terminal creates codexuiterminal.txt",
    selector: "[data-resource-category=files]",
    expected: "The Files resource exposes real state from the active Codex session CWD independently from the transcript.",
    observed: "The Codex runtime and goal/subagent transcript remain visible while the Files tab shows /Users/xiaoyang/.oma/sessions/sess-2yitf0o6 and codexuiterminal.txt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.foreground-terminal", harness: "Kilo",
    harnessDir: "kilo",
    sourceName: "runtime-foreground-terminal.jpg",
    trigger: "Computer Use: open the selected Kilo session's foreground terminal, create kilouiterminal.txt, print KILOUITERMOK and list the file",
    selector: "[data-terminal-id]",
    expected: "A user-opened foreground shell is isolated to the selected Kilo session and visibly returns the entered command output from that session's CWD.",
    observed: "The screenshot visibly combines Kilo 7.4.19, Anthropic/DeepSeek V4 Flash, CWD /Users/xiaoyang/.oma/sessions/sess-7udcu0j5, KILOUITERMOK, kilouiterminal.txt and a returned shell prompt; no Codex session path is present.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.resources", harness: "Kilo",
    harnessDir: "kilo",
    sourceName: "runtime-resources.jpg",
    trigger: "Computer Use: open the selected Kilo session's Files resource after its foreground terminal creates kilouiterminal.txt",
    selector: "[data-resource-category=files]",
    expected: "The Files resource exposes real state from the active Kilo session CWD and remains isolated from other harness sessions.",
    observed: "The Kilo runtime, selected Anthropic/DeepSeek V4 Flash config and transcript remain visible while the Files tab shows /Users/xiaoyang/.oma/sessions/sess-7udcu0j5 and kilouiterminal.txt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.session-status-goal-queue", harness: "Kilo",
    harnessDir: "kilo",
    sourceName: "output-session-status-goal-queue.jpg",
    trigger: "Computer Use: reopen the successful real Kilo file-tool session and inspect its runtime header independently from the tool rows",
    selector: "[data-session-runtime]",
    expected: "The GUI visibly distinguishes ACP session status and queue count from tool lifecycle and final-answer state.",
    observed: "The runtime header visibly reports Kilo 7.4.19, Idle, CWD /Users/xiaoyang/.oma/sessions/sess-zfg40vf6 and Queue 0 above the real completed tool turn.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.foreground-terminal", harness: "Claude",
    harnessDir: "claude",
    sourceName: "runtime-foreground-terminal.jpg",
    trigger: "Computer Use: open the completed Claude native-subagent session's foreground terminal, create claudeuiterminal.txt, print CLAUDEUITERMOK and list the file",
    selector: "[data-terminal-id]",
    expected: "A user-opened foreground shell is isolated to the selected Claude session and visibly returns the entered command output from that session's CWD.",
    observed: "The screenshot visibly combines Claude ACP Idle state, its terminal native child transcript, CWD /Users/xiaoyang/.oma/sessions/sess-h1gm6ddx, CLAUDEUITERMOK, claudeuiterminal.txt and a returned shell prompt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.resources", harness: "Claude",
    harnessDir: "claude",
    sourceName: "runtime-resources.jpg",
    trigger: "Computer Use: open New tab > Files in the completed Claude session after its foreground terminal creates claudeuiterminal.txt",
    selector: "[data-resource-category=files]",
    expected: "The Files resource exposes real state from the active Claude session CWD independently from the transcript.",
    observed: "The Claude runtime and native-subagent transcript remain visible while the Files tab shows /Users/xiaoyang/.oma/sessions/sess-h1gm6ddx and claudeuiterminal.txt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.foreground-terminal", harness: "Pi",
    harnessDir: "pi",
    sourceName: "runtime-foreground-terminal.jpg",
    trigger: "Computer Use: open the selected Pi session's foreground terminal, create piuiterminal.txt, print PIUITERMOK and list the file",
    selector: "[data-terminal-id]",
    expected: "A user-opened foreground shell is isolated to the selected Pi session and visibly returns the entered command output from that session's CWD.",
    observed: "The screenshot visibly combines pi-acp Idle state, DeepSeek V4 Flash, PI_VALID_OK: 95, CWD /Users/xiaoyang/.oma/sessions/sess-o8fo3x8n, PIUITERMOK, piuiterminal.txt and a returned shell prompt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.resources", harness: "Pi",
    harnessDir: "pi",
    sourceName: "runtime-resources.jpg",
    trigger: "Computer Use: open New tab > Files in the selected Pi session after its foreground terminal creates piuiterminal.txt",
    selector: "[data-resource-category=files]",
    expected: "The Files resource exposes real state from the active Pi session CWD independently from the transcript.",
    observed: "The Pi runtime, DeepSeek V4 Flash config and PI_VALID_OK: 95 remain visible while the Files tab shows /Users/xiaoyang/.oma/sessions/sess-o8fo3x8n and piuiterminal.txt.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.notice-warning-error", harness: "Pi",
    harnessDir: "pi",
    sourceName: "output-notice-warning-error.jpg",
    trigger: "Computer Use: open the real Pi auth-recovery session after its provider finishes without an assistant response",
    selector: "[data-notice-kind=error]",
    expected: "The provider failure is visibly surfaced as a terminal error and no final response is fabricated.",
    observed: "The Pi session visibly shows Error and the red notice 'The agent finished without a response. Its provider may have rejected or rate-limited the request' in both transcript and composer area.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.session-status-goal-queue", harness: "Pi",
    harnessDir: "pi",
    sourceName: "output-session-status-goal-queue.jpg",
    trigger: "Computer Use: switch back to the successful real Pi session and inspect its runtime header and transcript",
    selector: "[data-session-runtime]",
    expected: "The GUI visibly distinguishes ACP session status and queue count from the completed turn content.",
    observed: "The runtime header visibly reports pi-acp 0.0.33, Idle, the selected CWD and Queue 0 while PI_VALID_OK: 95 remains separately visible in the completed transcript.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-start-input", harness: "Pi",
    harnessDir: "pi",
    sourceName: "output-tool-start-input.jpg",
    trigger: "Computer Use: reopen the successful real Pi terminal-tool turn and expand its completed call",
    selector: "[data-tool-call-id]",
    expected: "The Pi terminal tool remains attributable to the exact command that created and read the test file.",
    observed: "The expanded real tool row visibly shows printf 'COMPOSER_SLOT_OK' > e2e-composer-slot.txt && cat e2e-composer-slot.txt, its terminal call id and Completed badge.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.tool-terminal", harness: "Pi",
    harnessDir: "pi",
    sourceName: "output-tool-terminal.jpg",
    trigger: "Computer Use: collapse the completed real Pi terminal call and inspect its terminal lifecycle state",
    selector: "[data-tool-status=completed]",
    expected: "The real Pi terminal call reaches a visible terminal state without losing command identity.",
    observed: "The tool row visibly retains the complete file command, a Completed badge and the subsequent COMPOSER_SLOT_OK final response while the ACP session is Idle.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.foreground-terminal", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "runtime-foreground-terminal.jpg",
    trigger: "Computer Use: open the selected Cursor session's Terminal resource, create cursoruiterminal.txt, print CURSORUITERMOK and list the file",
    selector: "[data-terminal-id]",
    expected: "A user-opened foreground shell is isolated to the selected Cursor session and visibly returns the entered command output from that session's CWD.",
    observed: "The terminal tab visibly shows CWD /Users/xiaoyang/.oma/sessions/sess-x3x4ak2q, CURSORUITERMOK, cursoruiterminal.txt and a returned prompt beside the Cursor transcript.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "runtime.resources", harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "runtime-resources.jpg",
    trigger: "Computer Use: open New tab > Files in the selected Cursor session after its foreground terminal creates cursoruiterminal.txt",
    selector: "[data-resource-category=files]",
    expected: "The Files resource exposes real state from the active Cursor session CWD independently from the transcript.",
    observed: "The Files tab visibly shows /Users/xiaoyang/.oma/sessions/sess-x3x4ak2q, cursoruiterminal.txt, e2e-cursor.txt and matrix-tools-cursor.txt beside the real Cursor transcript.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.session-status-goal-queue", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "output-session-status-goal-queue.jpg",
    trigger: "Computer Use: complete a real OpenCode terminal-tool turn and inspect the session runtime independently from its final answer",
    selector: "[data-session-runtime]",
    expected: "The GUI visibly distinguishes the session's terminal status and queue count from tool and terminal resource state.",
    observed: "OpenCode 1.18.12 is visibly Idle with Queue 0 above the completed printf tool and OPENCODEBGFINALOK; the foreground shell is tracked separately.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "output.notice-warning-error", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "output-notice-warning-error.jpg",
    trigger: "Computer Use: reopen the real OpenCode turn whose sleep 20 terminal call was stopped by the user and scroll to its terminal result",
    selector: "[data-turn-status=cancelled]",
    expected: "The aborted terminal turn is visibly marked as cancelled and does not fabricate the requested final marker.",
    observed: "The terminal output visibly contains <shell_metadata> User aborted the command, followed by the explicit cancelled notice; CANCELTESTFINISHED is absent while the session is Idle.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "input.cancel-stop", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "input-cancel-stop-cancelled.jpg",
    trigger: "Computer Use: submit a real prompt that starts the terminal command sleep 20, wait for its In progress state, then click Stop",
    selector: "[data-session-status=idle]",
    expected: "Stop cancels the active turn/tool, returns the session to Idle and does not fabricate the requested final response.",
    observed: "After Stop, the live OpenCode session is Idle, the sleep 20 tool is terminated and the transcript visibly ends with cancelled instead of CANCELTESTFINISHED.",
    extraEvidence: [
      "Before-stop source: input-cancel-stop-running.jpg",
    ],
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "input.queue", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "input-queue-editable.jpg",
    trigger: "Computer Use: start a real OpenCode turn, submit a second prompt through Queue, then click Edit on that pending item",
    selector: "[data-composer-queue]",
    expected: "The queued prompt remains visible and editable while the active turn continues, with runtime queue depth kept in sync.",
    observed: "OpenCode is visibly Running with Queue 1 while the pending prompt is shown in the composer slot as an editable field with Save.",
  });
  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "input.steering", harness: "OpenCode",
    harnessDir: "opencode",
    sourceName: "input-steering-unavailable.jpg",
    status: "n-a",
    reason: "OpenCode 1.18.12 does not negotiate the steering capability for this ACP session, so Backchat must keep the queued item FIFO instead of emulating steering with a concurrent prompt.",
    trigger: "Computer Use: queue a second prompt during a real OpenCode turn and inspect the Steer action after capability negotiation",
    protocolBasis: "Official ACP v1 capability negotiation plus the real OpenCode 1.18.12 session runtime, which advertises list/resume/close/fork but no steering extension",
    selector: "button[aria-label^=\"Steer queued message\"]:disabled",
    expected: "When steering is absent, the GUI disables the action and explains the capability gap instead of silently accepting an impossible operation.",
    observed: "The live queue shows Queue 1 and a disabled Steer control whose accessibility help reads Steering is not available for this harness.",
  });

  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "agent.native-list-lifecycle", harness: "Codex", harnessDir: "codex",
    sourceName: "agent-native-list-lifecycle.jpg",
    trigger: "Computer Use: run exactly one real Codex spawn_agent and inspect Agents",
    selector: "[data-resource-category=agents]",
    expected: "A native Codex child is listed from structured codex.subagent metadata.",
    observed: "/root/child_ok appears in Agents with the real child thread identity.",
  });
  await markLive({
    manifest, root, batchRoot, runAt,
    feature: "agent.native-detail", harness: "Codex", harnessDir: "codex",
    sourceName: "agent-native-detail-visible.jpg",
    trigger: "Computer Use: click the real Codex child tab created from codex.subagent metadata",
    selector: "[role=tab][aria-selected=true]",
    expected: "The child path and provider identity are visible in a subordinate detail pane.",
    observed: "/root/child_ok is selected and its Codex runtime identity is visible.",
  });
  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "agent.native-transcript", harness: "Codex", harnessDir: "codex",
    sourceName: "agent-native-transcript-unavailable.jpg",
    status: "n-a",
    reason: "codex-acp 1.1.9 exposes native child identity/lifecycle through _meta.codex.subagent, but session/resume does not replay child transcript.",
    selector: "[role=tab][aria-selected=true]",
    expected: "Do not claim a child transcript unless it arrives through structured ACP events or adapter _meta.",
    observed: "The selected /root/child_ok subordinate pane is visibly empty apart from terminal status unavailable; no transcript is fabricated from the parent answer.",
    extraEvidence: [
      "Direct ACP session/resume probe for the child thread returned zero history events",
    ],
  });
  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "agent.native-final", harness: "Codex", harnessDir: "codex",
    sourceName: "agent-native-final-unavailable.jpg",
    status: "n-a",
    reason: "codex-acp 1.1.9 real wait completion has no structured child result, so the parent final cannot be repurposed as a child final.",
    selector: "[data-session-turn-answer=true]",
    expected: "Do not claim a child final unless it arrives through structured ACP events or adapter _meta.",
    observed: "The main session visibly contains only PARENT_OK: CHILD_OK next to the child link; Backchat does not mislabel that parent answer as the child final.",
    extraEvidence: [
      "codex-acp 1.1.9 real wait event: rawOutput null, receiverThreadIds empty, agentsStates empty",
    ],
  });

  for (const entry of [
    {
      harness: "Claude",
      harnessDir: "claude",
      sourceName: "session-close-terminated-current-live.jpg",
      observed: "Claude is visibly Terminated, the composer is disabled, Queue is 0, and the negotiated session.close capability remains visible in the real session header.",
    },
    {
      harness: "Codex",
      harnessDir: "codex",
      sourceName: "session-close-terminated-current-live.jpg",
      observed: "Codex is visibly Terminated, the composer is disabled, Queue is 0, and the negotiated session.close capability remains visible while its native child pane stays subordinate.",
    },
    {
      harness: "OpenCode",
      harnessDir: "opencode",
      sourceName: "session-close-terminated-current-live.jpg",
      observed: "OpenCode is visibly Terminated, the composer is disabled, Queue is 0, and the negotiated session.close capability remains visible above the completed real turn.",
    },
    {
      harness: "Kilo",
      harnessDir: "kilo",
      sourceName: "session-close-terminated-current-live.jpg",
      observed: "Kilo is visibly Terminated, the composer is disabled, Queue is 0, and the negotiated session.close capability remains visible above the completed real tool turn.",
    },
  ]) {
    await markLive({
      manifest, root, batchRoot, runAt,
      feature: "session.close-terminated",
      harness: entry.harness,
      harnessDir: entry.harnessDir,
      sourceName: entry.sourceName,
      protocol: ACP_CLOSE,
      trigger: `Computer Use: open the completed real ${entry.harness} session menu, invoke the negotiated close action, and inspect the resulting session and composer state`,
      selector: "[data-gui-feature=\"session.close-terminated\"][data-session-terminated=\"true\"]",
      expected: "A successful session/close transitions the selected real session to Terminated and disables further composer submission without deleting its transcript or resources.",
      observed: entry.observed,
    });
  }

  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "session.close-terminated",
    harness: "Kimi Code",
    harnessDir: "kimi-code",
    sourceName: "session-close-terminated-current-live-failed.jpg",
    status: "fail",
    reason: "The installed Kimi Code harness failed authentication before a valid ACP session could negotiate or execute session/close; Backchat correctly surfaces the real error and must not claim a terminated session.",
    protocolBasis: "Official ACP session/close contract plus the real Kimi Code authentication failure observed before session initialization",
    trigger: "Computer Use: start a real Kimi Code session intended for close verification and inspect the terminal provider state",
    selector: "[data-session-status=\"error\"]",
    expected: "A real initialized Kimi Code ACP session must exist before session/close can be accepted as tested.",
    observed: "The live session visibly remains Error with Authentication required and a disabled error composer; no Terminated state or close success is fabricated.",
    extraEvidence: [ACP_CLOSE],
  });

  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "session.close-terminated",
    harness: "Cursor",
    harnessDir: "cursor",
    sourceName: "session-close-terminated-current-live-na.jpg",
    status: "n-a",
    reason: "The real Cursor ACP session does not advertise session.close, so Backchat omits the close action instead of inventing a side channel.",
    protocolBasis: "Official ACP capability negotiation and the real Cursor session header/menu",
    trigger: "Computer Use: open the real initialized Cursor session menu and inspect its negotiated capability header",
    selector: "[data-session-capability-close=\"false\"]",
    expected: "When session.close is not negotiated, the GUI must not expose an actionable close command.",
    observed: "Cursor is visibly Idle with its negotiated capabilities; the session menu contains Rename, Pin, Continue in new chat and Archive, but no close action.",
    extraEvidence: [ACP_CLOSE],
  });

  await markLiveGap({
    manifest, root, batchRoot, runAt,
    feature: "session.close-terminated",
    harness: "Pi",
    harnessDir: "pi",
    sourceName: "session-close-terminated-current-live-na.jpg",
    status: "n-a",
    reason: "The installed Pi ACP runtime is unavailable and the real session never negotiates session.close; Backchat cannot truthfully execute a close request for this harness.",
    protocolBasis: "Official ACP capability negotiation plus the real Pi runtime error shown in Electron",
    trigger: "Computer Use: inspect the real Pi session runtime and its session menu after the adapter executable lookup fails",
    selector: "[data-session-status=\"error\"]",
    expected: "Without an initialized ACP session and negotiated session.close capability, the close feature is unavailable rather than emulated.",
    observed: "Pi visibly reports that the pi executable is unavailable; its session menu contains Rename, Pin, Continue in new chat and Archive, but no close action.",
    extraEvidence: [ACP_CLOSE],
  });

  // A replay can demonstrate that the renderer knows how to present an
  // unsupported capability, but it cannot prove that the live harness omitted
  // or rejected that capability. Keep those cells visibly replay-only until a
  // real capability negotiation or real error state has been captured.
  for (const cell of manifest.cells) {
    if (cell.status !== "n-a" || cell.verificationMode === "live") continue;
    cell.status = "pass-replay";
    cell.reason = [
      "Unsupported status has only replay evidence; live harness capability/error evidence is still required.",
      cell.reason,
    ].filter(Boolean).join(" ");
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    resolve(root, "report.html"),
    generateHarnessFeatureMatrixDraftReport(manifest),
    "utf8",
  );
}

async function main(argv) {
  const [batchRoot, ...roots] = argv;
  if (!batchRoot || roots.length === 0) {
    throw new Error("usage: update-harness-feature-matrix-critical-batch.mjs <batch-root> <report-root> [...report-root]");
  }
  const runAt = new Date().toISOString();
  for (const root of roots) {
    await updateRoot(resolve(root), resolve(batchRoot), runAt);
  }
}

await main(process.argv.slice(2));
