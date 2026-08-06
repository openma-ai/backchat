import type { Locator, Page } from "@playwright/test";

import type {
  MatrixDriverContext,
  MatrixDriverResult,
  MatrixFeatureDriver,
} from "./harness-matrix-driver-types";
import { CLAUDE_AGENT_ACP_0_64_2_FIXTURE } from "../src/renderer/src/lib/fixtures/harness-events/claude-agent-acp-0.64.2";

const ACP_PROTOCOL = "https://agentclientprotocol.com/protocol/v1";

type VisibleResultInput = {
  target: Locator;
  selector: string;
  expected: string;
  trigger: string;
  status?: MatrixDriverResult["status"];
  evidence?: string[];
};

function attributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function harnessIdentity(context: MatrixDriverContext): string {
  return `${context.harness.id} ${context.harness.label}`.toLowerCase();
}

function isClaude(context: MatrixDriverContext): boolean {
  return harnessIdentity(context).includes("claude");
}

function isCodex(context: MatrixDriverContext): boolean {
  return harnessIdentity(context).includes("codex");
}

function isCursor(context: MatrixDriverContext): boolean {
  return harnessIdentity(context).includes("cursor");
}

function isOpenCode(context: MatrixDriverContext): boolean {
  return harnessIdentity(context).includes("opencode");
}

function isKilo(context: MatrixDriverContext): boolean {
  return harnessIdentity(context).includes("kilo");
}

async function observedText(target: Locator): Promise<string> {
  await target.waitFor({ state: "visible", timeout: 10_000 });
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((element) => {
    const text = (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    return text
      || element.getAttribute("aria-label")
      || element.getAttribute("title")
      || element.getAttribute("data-terminal-status")
      || element.getAttribute("data-resource-status")
      || `${element.tagName.toLowerCase()} is visible`;
  });
}

async function visibleResult(input: VisibleResultInput): Promise<MatrixDriverResult> {
  return {
    target: input.target,
    selector: input.selector,
    expected: input.expected,
    observed: await observedText(input.target),
    trigger: input.trigger,
    status: input.status ?? "pass-replay",
    verificationMode: "replay",
    evidence: input.evidence ?? [ACP_PROTOCOL],
  };
}

async function ensureRightPanelLauncher(page: Page): Promise<Locator> {
  // A preceding cell may intentionally have opened a Radix activity popover
  // for its screenshot. Close that transient surface before operating the
  // persistent right rail so it cannot intercept the next real click.
  await page.keyboard.press("Escape");
  const restoreSplit = page.getByRole("button", {
    name: "Restore split view",
    exact: true,
  });
  if (await restoreSplit.isVisible()) {
    await restoreSplit.click({ force: true });
  }
  const launcher = page.locator("[data-right-panel-launcher-list]");
  if (await launcher.isVisible()) return launcher;

  const openPanel = page.getByRole("button", { name: "Open side panel", exact: true });
  if (await openPanel.isVisible()) await openPanel.click();
  if (await launcher.isVisible()) return launcher;

  const newTab = page.getByRole("button", { name: "New tab", exact: true }).last();
  if (await newTab.isVisible()) await newTab.click();
  await launcher.waitFor({ state: "visible", timeout: 10_000 });
  return launcher;
}

async function openCallbackDecision(
  context: MatrixDriverContext,
  kind: "permission" | "filesystem" | "form" | "url",
  status: string,
): Promise<{ target: Locator; selector: string }> {
  const module = context.page.locator('[data-activity-module="callbacks"]').last();
  await module.waitFor({ state: "visible", timeout: 10_000 });
  await module.click();
  const selector = `[data-activity-item-id^="callback:${kind}:"][data-activity-item-status="${attributeValue(status)}"]`;
  const target = context.page.locator(selector).last();
  await target.waitFor({ state: "visible", timeout: 10_000 });
  return { target, selector };
}

async function callbackPermission(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  await context.bridge.beginBrokerRequest({
    kind: "permission",
    sessionId: context.sessionId,
    agentId: context.harness.id,
    params: {
      toolCall: {
        toolCallId: `permission-${context.sessionId}`,
        title: "Run matrix verification",
        kind: "execute",
        status: "pending",
        rawInput: { command: "pnpm test" },
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    },
  });
  const selector = '[role="dialog"]';
  const target = context.page.locator(selector).last();
  await target.getByRole("heading", { name: "Run matrix verification" }).waitFor();
  await target.getByText("pnpm test", { exact: true }).waitFor();
  const allowOnce = target.getByRole("button", { name: "Allow once" });
  await allowOnce.waitFor();
  await target.getByRole("button", { name: "Reject" }).waitFor();
  await allowOnce.click();
  await target.waitFor({ state: "hidden", timeout: 10_000 });
  const receipt = await openCallbackDecision(context, "permission", "selected");
  return visibleResult({
    ...receipt,
    expected: "After the real permission modal resolves, the GUI retains the selected Allow once decision as a callback receipt.",
    trigger: "Opened the production permission BrokerModal, inspected its real command and options, clicked Allow once, then opened the persisted Callback decisions activity.",
    evidence: [`${ACP_PROTOCOL}/agent-callbacks`],
  });
}

async function callbackFilesystem(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const path = `${context.cwd}-outside/matrix-output.txt`;
  await context.bridge.beginBrokerRequest({
    kind: "fs-write",
    sessionId: context.sessionId,
    cwd: context.cwd,
    params: {
      path,
      content: "callback filesystem projection",
    },
  });
  const selector = '[role="dialog"]';
  const target = context.page.locator(selector).last();
  await target.getByRole("heading", { name: "Write outside workspace?" }).waitFor();
  await target.getByText(path, { exact: true }).waitFor();
  const deny = target.getByRole("button", { name: "Deny" });
  await deny.waitFor();
  await target.getByRole("button", { name: "Allow write" }).waitFor();
  await deny.click();
  await target.waitFor({ state: "hidden", timeout: 10_000 });
  const receipt = await openCallbackDecision(context, "filesystem", "denied");
  return visibleResult({
    ...receipt,
    expected: "After the real filesystem modal is denied, the GUI retains the denied path as a callback receipt and no file is written.",
    trigger: "Opened the production out-of-workspace write BrokerModal, inspected its path and preview, clicked Deny, then opened the persisted Callback decisions activity.",
    evidence: [`${ACP_PROTOCOL}/file-system`],
  });
}

async function callbackTerminal(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const started = await context.bridge.beginBrokerRequest({
    kind: "terminal",
    sessionId: context.sessionId,
    cwd: context.cwd,
    params: {
      command: "/bin/sh",
      args: ["-lc", `printf callback-terminal-ok-${context.harness.id}`],
      cwd: context.cwd,
    },
  });
  if (!("terminalId" in started)) throw new Error("terminal broker did not return an id");
  await ensureRightPanelLauncher(context.page);
  const row = context.page.locator(
    `[data-resource-category="background"] [data-terminal-id="${attributeValue(started.terminalId)}"]`,
  );
  await row.waitFor({ state: "visible", timeout: 10_000 });
  await row.click();
  const selector = `[data-testid="background-terminal-detail"][data-callback-kind="terminal"][data-terminal-id="${attributeValue(started.terminalId)}"]`;
  const target = context.page.locator(selector).last();
  await target.getByTestId("background-terminal-output").filter({
    hasText: `callback-terminal-ok-${context.harness.id}`,
  }).waitFor({ state: "visible", timeout: 10_000 });
  return visibleResult({
    target,
    selector,
    expected: "The real terminal callback shows terminal id, command, output, exit result, and terminal lifecycle status.",
    trigger: "Called the production createTerminal broker through the test-only IPC hook, then opened its real Background detail surface.",
    evidence: [`${ACP_PROTOCOL}/terminals`],
  });
}

async function callbackElicitationForm(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  await context.bridge.beginBrokerRequest({
    kind: "elicitation-form",
    sessionId: context.sessionId,
    params: {
      sessionId: `acp-${context.sessionId}`,
      message: "Choose the matrix verification strategy.",
      fields: [{
        name: "strategy",
        title: "Verification strategy",
        type: "select",
        required: true,
        options: [
          { value: "strict", label: "Strict" },
          { value: "diagnostic", label: "Diagnostic" },
        ],
      }],
    },
  });
  const selector = '[role="dialog"]';
  const target = context.page.locator(selector).last();
  await target.getByRole("heading", {
    name: "Choose the matrix verification strategy.",
  }).waitFor();
  const strategy = target.getByLabel(/Verification strategy/);
  await strategy.waitFor();
  await strategy.selectOption("strict");
  const submit = target.getByRole("button", { name: "Submit" });
  await submit.waitFor();
  await target.getByRole("button", { name: "Decline" }).waitFor();
  await submit.click();
  await target.waitFor({ state: "hidden", timeout: 10_000 });
  const receipt = await openCallbackDecision(context, "form", "accept");
  return visibleResult({
    ...receipt,
    expected: "After the real required form is submitted, the GUI retains the accepted strategy: strict content as a callback receipt.",
    trigger: "Opened the production elicitation form, selected Strict in the required field, clicked Submit, then opened the persisted Callback decisions activity.",
    evidence: [`${ACP_PROTOCOL}/elicitation`],
  });
}

async function callbackElicitationUrl(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const elicitationId = `matrix-url-${context.sessionId}`;
  const url = `https://example.com/authorize?elicitationId=${encodeURIComponent(elicitationId)}`;
  await context.bridge.beginBrokerRequest({
    kind: "elicitation-url",
    sessionId: context.sessionId,
    params: {
      sessionId: `acp-${context.sessionId}`,
      elicitationId,
      url,
      message: "Authorize the matrix verification workflow.",
    },
  });
  const selector = '[role="dialog"]';
  const target = context.page.locator(selector).last();
  await target.getByRole("heading", {
    name: "Authorize the matrix verification workflow.",
  }).waitFor();
  await target.getByText(url, { exact: true }).waitFor();
  const decline = target.getByRole("button", { name: "Decline" });
  await decline.waitFor();
  await target.getByRole("button", { name: "Open example.com" }).waitFor();
  await decline.click();
  await target.waitFor({ state: "hidden", timeout: 10_000 });
  const receipt = await openCallbackDecision(context, "url", "decline");
  return visibleResult({
    ...receipt,
    expected: "After the real URL elicitation is declined, the GUI retains the correlated decline as a callback receipt without opening the external page.",
    trigger: "Opened the production URL elicitation, inspected its full target and host, clicked Decline, then opened the persisted Callback decisions activity.",
    evidence: [`${ACP_PROTOCOL}/elicitation`],
  });
}

async function callbackMcpExtension(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      type: "acp.mcp_notification",
      method: "mcp/resources/changed",
      params: {
        server: "matrix-fixture",
        resourceUri: "ui://backchat/matrix",
        revision: 2,
      },
    },
  });
  const selector = '[data-raw-event-kind="mcp-extension"][data-raw-event-method="mcp/resources/changed"]';
  return visibleResult({
    target: context.page.locator(selector).last(),
    selector,
    expected: "The MCP extension notification is visibly classified as MCP, with method, status, and payload retained.",
    trigger: "Replayed an ACP MCP notification and located the renderer's explicit mcp-extension protocol card.",
    evidence: [`${ACP_PROTOCOL}/extensibility`],
  });
}

async function runtimeForegroundTerminal(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const selector = '[data-testid="foreground-terminal"]';
  let target = context.page.locator(selector).last();
  if (!(await target.isVisible())) {
    const globalTerminal = context.page.getByRole("button", {
      name: "Open terminal",
      exact: true,
    });
    if (await globalTerminal.count()) {
      await globalTerminal.click({ force: true });
      await target.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    }
  }
  if (!(await target.isVisible())) {
    const launcher = await ensureRightPanelLauncher(context.page);
    await launcher.locator('[data-new-action="terminal"]').click({ force: true });
    target = context.page.locator(selector).last();
  }
  return visibleResult({
    target,
    selector,
    expected: "A real foreground shell is visible with a stable terminal identity and running/terminal status.",
    trigger: "Clicked Backchat's real Terminal action in the right-panel launcher and waited for the xterm foreground surface.",
    evidence: [`${ACP_PROTOCOL}/terminals`],
  });
}

async function runtimeBackgroundWork(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const processId = `matrix-bg-${context.sessionId}`;
  await context.injectEvent({
    type: "session.background_process",
    session_id: context.sessionId,
    process_id: processId,
    seq: 1,
    phase: "started",
    command: "pnpm",
    args: ["test"],
    cwd: context.cwd,
  });
  await context.injectEvent({
    type: "session.background_process",
    session_id: context.sessionId,
    process_id: processId,
    seq: 2,
    phase: "output",
    output: "matrix background verification running\n",
  });
  await ensureRightPanelLauncher(context.page);
  const selector = `[data-resource-category="background"] [data-resource-id="${attributeValue(processId)}"][data-resource-status="running"]`;
  return visibleResult({
    target: context.page.locator(selector).last(),
    selector,
    expected: "A callback-created background process is visible in the Background resource list with its running lifecycle state.",
    trigger: "Replayed the host-observed session.background_process start and output lifecycle and opened the real right-panel resource launcher.",
    evidence: [`${ACP_PROTOCOL}/terminals`],
  });
}

async function runtimeClaudeMonitor(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  if (!isClaude(context)) {
    const selector = '[data-gui-feature="session.initialize-ready"]';
    return visibleResult({
      target: context.page.locator(selector).last(),
      selector,
      expected: "Claude Monitor is provider-specific and is not claimed by a non-Claude harness.",
      trigger: `Inspected the visible initialized runtime identity for ${context.harness.label}; no Claude-specific Monitor event was injected or inferred.`,
      status: "n-a",
    });
  }

  for (const event of [
    CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorTaskStarted,
    CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorDelivery,
    CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorTaskCompleted,
  ]) {
    await context.injectEvent({
      type: "session.event",
      session_id: context.sessionId,
      turn_id: context.turnId,
      event,
    });
  }
  const selector = '[data-activity-module="monitor"]';
  const target = context.page.locator(selector).last();
  await target.waitFor({ state: "visible", timeout: 10_000 });
  await target.click();
  return visibleResult({
    target,
    selector,
    expected: "Claude's structured Monitor lifecycle and delivered event are visible in the dedicated Monitor activity module.",
    trigger: "Replayed Claude _claude/sdkMessage task_started, task-notification delivery, and terminal task_notification, then opened the real Monitor module.",
  });
}

async function runtimeResources(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const resourceName = `Matrix reference ${context.sessionId}`;
  const resourceUri = `https://example.com/backchat-matrix/${encodeURIComponent(context.sessionId)}`;
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call",
      toolCallId: `matrix-resource-${context.sessionId}`,
      title: "Fetch matrix reference",
      kind: "fetch",
      status: "completed",
      content: [{
        type: "content",
        content: {
          type: "resource_link",
          uri: resourceUri,
          name: resourceName,
          title: resourceName,
        },
      }],
    },
  });
  await ensureRightPanelLauncher(context.page);
  const selector = `[data-resource-category="sources"] button[title*="${attributeValue(resourceUri)}"]`;
  return visibleResult({
    target: context.page.locator(selector).last(),
    selector,
    expected: "A standard ACP resource link is visibly projected into the Sources resource list with its explicit URI.",
    trigger: "Replayed a completed tool call containing a standard resource_link content block and opened the real resource launcher.",
    evidence: [`${ACP_PROTOCOL}/content`],
  });
}

type NativeLifecycle = {
  task: string;
  childId: string;
  finalText: string;
};

async function injectClaudeNativeLifecycle(
  context: MatrixDriverContext,
): Promise<NativeLifecycle> {
  const task = `Audit matrix callbacks ${context.sessionId}`;
  const toolCallId = `claude-native-tool-${context.sessionId}`;
  const childId = `claude-native-child-${context.sessionId}`;
  const finalText = `Claude child verified callbacks for ${context.sessionId}.`;
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call",
      toolCallId,
      toolName: "Agent",
      title: "Agent",
      status: "in_progress",
      rawInput: { description: task, prompt: task, subagent_type: "Explore" },
      _meta: {
        claudeCode: {
          toolName: "Agent",
          subagent: true,
          toolResponse: { agentId: childId },
        },
      },
    },
  });
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      _meta: { claudeCode: { parentToolUseId: toolCallId } },
      content: { type: "text", text: finalText },
    },
  });
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      title: "Agent",
      status: "completed",
      _meta: {
        claudeCode: {
          toolName: "Agent",
          toolResponse: {
            status: "completed",
            agentId: childId,
            agentType: "Explore",
            content: [{ type: "text", text: finalText }],
            totalTokens: 144,
            usage: {
              input_tokens: 80,
              output_tokens: 40,
              cache_read_input_tokens: 16,
              cache_creation_input_tokens: 8,
            },
          },
        },
      },
    },
  });
  return { task, childId, finalText };
}

async function injectCodexNativeLifecycle(
  context: MatrixDriverContext,
): Promise<NativeLifecycle> {
  const task = `Audit matrix callbacks ${context.sessionId}`;
  const childId = `codex-native-child-${context.sessionId}`;
  const finalText = `Codex child verified callbacks for ${context.sessionId}.`;
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call",
      toolCallId: `codex-spawn-${context.sessionId}`,
      toolName: "spawn_agent",
      status: "completed",
      rawInput: {
        agent_type: "default",
        fork_context: false,
        message: task,
      },
      rawOutput: { agent_id: childId, nickname: `Matrix ${context.sessionId.slice(-6)}` },
    },
  });
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call_update",
      toolCallId: `codex-wait-${context.sessionId}`,
      toolName: "wait_agent",
      status: "completed",
      rawInput: { targets: [childId], timeout_ms: 60_000 },
      rawOutput: {
        status: { [childId]: { completed: finalText } },
        timed_out: false,
      },
    },
  });
  return { task, childId, finalText };
}

async function injectCursorNativeLifecycle(
  context: MatrixDriverContext,
): Promise<NativeLifecycle> {
  const task = `Audit matrix callbacks ${context.sessionId}`;
  const toolCallId = `cursor-native-tool-${context.sessionId}`;
  const childId = `cursor-native-child-${context.sessionId}`;
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: task,
      kind: "other",
      status: "in_progress",
      rawInput: {
        _toolName: "task",
        description: task,
        prompt: task,
        subagentType: "explore",
      },
    },
  });
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      type: "acp.extension_request",
      method: "cursor/task",
      params: {
        toolCallId,
        description: task,
        subagentType: "explore",
        agentId: childId,
        durationMs: 1250,
      },
    },
  });
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "completed",
      rawOutput: { durationMs: 1250, isBackground: false },
    },
  });
  return { task, childId, finalText: "" };
}

async function injectOpenCodeFamilyNativeLifecycle(
  context: MatrixDriverContext,
  provider: "opencode" | "kilo",
): Promise<NativeLifecycle> {
  const task = `Audit matrix callbacks ${context.sessionId}`;
  const toolCallId = `${provider}-native-tool-${context.sessionId}`;
  const childId = `${provider}-native-child-${context.sessionId}`;
  const rawInput = {
    description: task,
    prompt: task,
    subagent_type: "explore",
  };
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call",
      toolCallId,
      toolName: "task",
      title: task,
      kind: "think",
      status: "in_progress",
      rawInput,
    },
  });
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      toolName: "task",
      title: task,
      kind: "think",
      status: "completed",
      rawInput,
      rawOutput: {
        metadata: {
          parentSessionId: context.sessionId,
          sessionId: childId,
          model: provider === "opencode"
            ? { providerID: "deepseek", modelID: "deepseek-v4-pro" }
            : { providerID: "kilo", modelID: "auto" },
          ...(provider === "kilo" ? { variant: "high" } : {}),
        },
      },
    },
  });
  return { task, childId, finalText: "" };
}

async function injectNativeLifecycle(
  context: MatrixDriverContext,
): Promise<NativeLifecycle | null> {
  if (isClaude(context)) return injectClaudeNativeLifecycle(context);
  if (isCodex(context)) return injectCodexNativeLifecycle(context);
  if (isCursor(context)) return injectCursorNativeLifecycle(context);
  if (isOpenCode(context)) {
    return injectOpenCodeFamilyNativeLifecycle(context, "opencode");
  }
  if (isKilo(context)) {
    return injectOpenCodeFamilyNativeLifecycle(context, "kilo");
  }
  return null;
}

async function nativeNotApplicable(
  context: MatrixDriverContext,
  feature: string,
): Promise<MatrixDriverResult> {
  const selector = '[data-gui-feature="session.initialize-ready"]';
  return visibleResult({
    target: context.page.locator(selector).last(),
    selector,
    expected: `${context.harness.label} does not advertise the structured ${feature} capability, so this matrix cell is not applicable.`,
    trigger: `Inspected ${context.harness.label} ${context.harness.version}'s initialized runtime identity without injecting or inferring an undeclared native-agent event.`,
    status: "n-a",
  });
}

async function nativeAgentRow(
  context: MatrixDriverContext,
  lifecycle: NativeLifecycle,
): Promise<{ target: Locator; selector: string }> {
  await ensureRightPanelLauncher(context.page);
  const selector = `[data-resource-category="agents"] [title^="${attributeValue(lifecycle.task)}\\a"]`;
  let target = context.page.locator(selector).last();
  if (!(await target.isVisible())) {
    target = context.page
      .locator('[data-resource-category="agents"] button')
      .filter({ hasText: lifecycle.task })
      .last();
  }
  await target.waitFor({ state: "visible", timeout: 10_000 });
  return { target, selector };
}

async function nativeListLifecycle(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const lifecycle = await injectNativeLifecycle(context);
  if (!lifecycle) {
    return nativeNotApplicable(context, "native child list/lifecycle");
  }
  const row = await nativeAgentRow(context, lifecycle);
  return visibleResult({
    ...row,
    expected: "A provider-structured native child appears in Agents with its stable identity and completed lifecycle state.",
    trigger: `Replayed ${context.harness.label}'s structured native spawn and completion events and opened the real Agents resource list.`,
  });
}

async function nativeDetail(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const lifecycle = await injectNativeLifecycle(context);
  if (!lifecycle) return nativeNotApplicable(context, "native child detail");
  const row = await nativeAgentRow(context, lifecycle);
  await row.target.click();
  const selector = `[role="tab"][title="${attributeValue(
    isCodex(context) ? `Matrix ${context.sessionId.slice(-6)}` : lifecycle.task,
  )}"][aria-selected="true"]`;
  const target = context.page.locator(selector).last();
  return visibleResult({
    target,
    selector,
    expected: "Selecting the native child opens its real subordinate detail tab with provider identity preserved.",
    trigger: "Clicked the visible native child row in Agents and asserted the selected subordinate detail tab.",
  });
}

async function nativeTranscript(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  if (!isClaude(context) && !isCodex(context)) {
    return nativeNotApplicable(context, "native child transcript");
  }
  const lifecycle = await injectNativeLifecycle(context);
  if (!lifecycle) return nativeNotApplicable(context, "native child transcript");
  const row = await nativeAgentRow(context, lifecycle);
  await row.target.click();
  const selector = `[data-session-turn-id]`;
  let target = context.page.getByText(lifecycle.finalText, { exact: true }).last();
  await target.waitFor({ state: "visible", timeout: 10_000 });
  return visibleResult({
    target,
    selector: `${selector} text=${JSON.stringify(lifecycle.finalText)}`,
    expected: "The native child's structured final text is visible in its subordinate transcript, not copied into the parent answer.",
    trigger: "Opened the real native child detail and located the provider-correlated final transcript text.",
  });
}

async function nativeFinal(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  if (!isClaude(context) && !isCodex(context)) {
    return nativeNotApplicable(context, "native child final");
  }
  const lifecycle = await injectNativeLifecycle(context);
  if (!lifecycle) return nativeNotApplicable(context, "native child final");
  const row = await nativeAgentRow(context, lifecycle);
  await row.target.click();
  const selector = `[data-session-turn-id] text=${JSON.stringify(lifecycle.finalText)}`;
  const target = context.page.getByText(lifecycle.finalText, { exact: true }).last();
  return visibleResult({
    target,
    selector,
    expected: "The structured child final is visible in the provider-native subordinate session.",
    trigger: `Opened ${context.harness.label}'s structured native child and located its correlated final text.`,
  });
}

async function runtimeVendorRaw(
  context: MatrixDriverContext,
): Promise<MatrixDriverResult> {
  const method = `_${context.harness.id.replace(/[^a-z0-9_-]/giu, "_")}/runtime_signal`;
  await context.injectEvent({
    type: "session.event",
    session_id: context.sessionId,
    turn_id: context.turnId,
    event: {
      type: "acp.extension_notification",
      method,
      params: {
        status: "received",
        phase: "matrix-verification",
        harness: context.harness.label,
      },
    },
  });
  const selector = `[data-raw-event-kind="vendor-raw"][data-raw-event-method="${attributeValue(method)}"]`;
  return visibleResult({
    target: context.page.locator(selector).last(),
    selector,
    expected: "An unknown vendor extension remains visibly inspectable with its exact method, event type, status, error state, and payload.",
    trigger: "Replayed an unknown namespaced extension notification and located the renderer's explicit vendor-raw protocol card.",
    evidence: [`${ACP_PROTOCOL}/extensibility`],
  });
}

export const harnessMatrixCallbackNativeDrivers: MatrixFeatureDriver[] = [
  { id: "callback.permission", run: callbackPermission },
  { id: "callback.filesystem", run: callbackFilesystem },
  { id: "callback.terminal", run: callbackTerminal },
  { id: "callback.elicitation-form", run: callbackElicitationForm },
  { id: "callback.elicitation-url", run: callbackElicitationUrl },
  { id: "callback.mcp-extension", run: callbackMcpExtension },
  { id: "runtime.foreground-terminal", run: runtimeForegroundTerminal },
  { id: "runtime.background-work", run: runtimeBackgroundWork },
  { id: "runtime.claude-monitor", run: runtimeClaudeMonitor },
  { id: "runtime.resources", run: runtimeResources },
  { id: "agent.native-list-lifecycle", run: nativeListLifecycle },
  { id: "agent.native-detail", run: nativeDetail },
  { id: "agent.native-transcript", run: nativeTranscript },
  { id: "agent.native-final", run: nativeFinal },
  { id: "runtime.vendor-raw", run: runtimeVendorRaw },
];

export const CALLBACK_NATIVE_MATRIX_DRIVERS = harnessMatrixCallbackNativeDrivers;
