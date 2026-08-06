import type { Locator } from "@playwright/test";

import type {
  MatrixDriverContext,
  MatrixDriverResult,
  MatrixFeatureDriver,
} from "./harness-matrix-driver-types";

function cssAttributeValue(value: string): string {
  return JSON.stringify(value);
}

function turnSelector(context: MatrixDriverContext): string {
  return `[data-turn-id=${cssAttributeValue(context.turnId)}]`;
}

function toolSelector(toolCallId: string): string {
  return `[data-tool-call-id=${cssAttributeValue(toolCallId)}]`;
}

async function revealToolRow(
  context: MatrixDriverContext,
  toolCallId: string,
): Promise<Locator> {
  const row = context.page.locator(
    `${turnSelector(context)} ${toolSelector(toolCallId)}`,
  );
  if (!(await row.isVisible())) {
    const collapsedGroup = context.page.locator(
      `${turnSelector(context)} [data-tool-group-trigger][aria-expanded="false"]`,
    ).last();
    await collapsedGroup.click();
  }
  await row.waitFor({ state: "visible" });
  return row;
}

async function visibleText(target: Locator): Promise<string> {
  await target.waitFor({ state: "visible" });
  return ((await target.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function openDisclosure(root: Locator): Promise<void> {
  const button = root.locator("button").first();
  await button.waitFor({ state: "visible" });
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
  }
}

function replayResult(
  context: MatrixDriverContext,
  result: Omit<MatrixDriverResult, "status" | "verificationMode" | "evidence">,
): MatrixDriverResult {
  return {
    ...result,
    status: "pass-replay",
    verificationMode: "replay",
    evidence: [
      `TestBridge replay through the real Electron renderer for ${context.harness.label} ${context.harness.version}`,
    ],
  };
}

const thinkingReasoning: MatrixFeatureDriver = {
  id: "output.thinking-reasoning",
  async run(context) {
    const thought = `${context.harness.label} matrix reasoning evidence`;
    const isCodex = context.harness.id.toLowerCase().includes("codex");
    await context.bridge.injectSessionEvent({
      type: "session.queue_update",
      session_id: context.sessionId,
      mode: "single",
      active_turn_id: context.turnId,
      queued: [],
    });
    await context.injectEvent({
      sessionUpdate: "agent_thought_chunk",
      messageId: `matrix-thought-${context.turnId}`,
      // End the Markdown paragraph so the streaming parser does not retain
      // the final character while the turn remains deliberately in-flight.
      // Codex projects only the latest paragraph as its transient activity;
      // a trailing blank paragraph would intentionally hide that activity,
      // so a non-whitespace sentence terminator is its flush token instead.
      content: { type: "text", text: isCodex ? `${thought}.` : `${thought}\n\n` },
    });

    const selector = isCodex
      ? `${turnSelector(context)} [data-current-activity]`
      : `${turnSelector(context)} [data-session-turn-response="true"]`;
    const target = isCodex
      ? context.page.locator(selector).filter({ hasText: thought })
      : context.page.locator(selector).filter({ hasText: thought });
    await target.waitFor({ state: "visible" });
    return replayResult(context, {
      target,
      selector,
      expected: `Visible reasoning content: ${thought}`,
      observed: await visibleText(target),
      trigger: "ACP agent_thought_chunk injected through TestBridge",
    });
  },
};

const noticeWarningError: MatrixFeatureDriver = {
  id: "output.notice-warning-error",
  async run(context) {
    const errorMessage = `Matrix provider error for ${context.harness.label}`;
    // session.error decorates an existing turn; establish that turn through
    // the same ACP session.event path before delivering the failure.
    await context.injectEvent({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "" },
    });
    await context.bridge.injectSessionEvent({
      type: "session.error",
      session_id: context.sessionId,
      turn_id: context.turnId,
      message: errorMessage,
    });

    const selector = `${turnSelector(context)} [data-slot="status-notice"][data-tone="danger"][data-appearance="surface"]`;
    const target = context.page.locator(selector);
    await target.filter({ hasText: errorMessage }).waitFor({ state: "visible" });
    return replayResult(context, {
      target,
      selector,
      expected: `Visible turn error notice: ${errorMessage}`,
      observed: await visibleText(target),
      trigger: "TestBridge session.error injected for the active turn",
    });
  },
};

const toolStartInput: MatrixFeatureDriver = {
  id: "output.tool-start-input",
  async run(context) {
    const toolCallId = `${context.turnId}-tool-start`;
    const inputMarker = `matrix-start-input-${context.harness.id}`;
    await context.injectEvent({
      sessionUpdate: "tool_call",
      toolCallId,
      title: "Read matrix input",
      kind: "read",
      status: "pending",
      rawInput: { path: inputMarker },
    });

    const selector = `${turnSelector(context)} ${toolSelector(toolCallId)}[data-tool-status="started"]`;
    const target = context.page.locator(selector);
    await target.locator(`[data-tool-input=${cssAttributeValue(toolCallId)}]`).filter({
      hasText: inputMarker,
    }).waitFor({ state: "visible" });
    return replayResult(context, {
      target,
      selector,
      expected: `Started tool row with visible raw input ${inputMarker}`,
      observed: await visibleText(target),
      trigger: "ACP tool_call(pending, rawInput) injected through TestBridge",
    });
  },
};

const toolProgressOutput: MatrixFeatureDriver = {
  id: "output.tool-progress-output",
  async run(context) {
    const toolCallId = `${context.turnId}-tool-progress`;
    const outputMarker = `matrix-progress-output-${context.harness.id}`;
    await context.injectEvent({
      sessionUpdate: "tool_call",
      toolCallId,
      title: "Run matrix progress check",
      kind: "execute",
      status: "pending",
      rawInput: { command: "matrix-progress-check" },
    });
    await context.injectEvent({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "in_progress",
      rawOutput: { stdout: outputMarker, exit_code: 0 },
    });

    const selector = `${turnSelector(context)} ${toolSelector(toolCallId)}[data-tool-status="progress"]`;
    const target = await revealToolRow(context, toolCallId);
    await target.waitFor({ state: "visible" });
    await target.locator("button").first().click();
    await target.locator('[data-tool-output-body="true"]').filter({
      hasText: outputMarker,
    }).waitFor({ state: "visible" });
    return replayResult(context, {
      target,
      selector,
      expected: `In-progress tool row with visible output ${outputMarker}`,
      observed: await visibleText(target),
      trigger: "ACP tool_call followed by tool_call_update(in_progress, rawOutput)",
    });
  },
};

const toolTerminal: MatrixFeatureDriver = {
  id: "output.tool-terminal",
  async run(context) {
    const toolCallId = `${context.turnId}-tool-terminal`;
    const terminalId = `terminal-${context.harness.id}-${context.turnId}`;
    await context.injectEvent({
      sessionUpdate: "tool_call",
      toolCallId,
      title: "Open matrix terminal",
      kind: "terminal",
      status: "completed",
      content: [{ type: "terminal", terminalId }],
    });

    const rowSelector = `${turnSelector(context)} ${toolSelector(toolCallId)}[data-tool-status="completed"]`;
    const row = await revealToolRow(context, toolCallId);
    await row.locator("button").first().click();
    const selector = `${rowSelector} [data-tool-terminal-id=${cssAttributeValue(terminalId)}]`;
    const target = context.page.locator(selector);
    await target.waitFor({ state: "visible" });
    return replayResult(context, {
      target,
      selector,
      expected: `Visible terminal content block for ${terminalId}`,
      observed: await visibleText(target),
      trigger: "ACP completed tool_call with a terminal content block",
    });
  },
};

const planDocument: MatrixFeatureDriver = {
  id: "output.plan-document",
  async run(context) {
    const planMarker = `Matrix plan document for ${context.harness.label}`;
    await context.injectEvent({
      sessionUpdate: "plan_update",
      plan: {
        id: `${context.turnId}-plan-document`,
        title: "Matrix acceptance plan",
        content: { markdown: `# ${planMarker}\n\n1. Inspect\n2. Verify` },
      },
    });

    const rootSelector = `${turnSelector(context)} [data-plan-document="true"]`;
    const root = context.page.locator(rootSelector);
    const planDocumentVisible = await root.waitFor({
      state: "visible",
      timeout: 1_500,
    }).then(() => true, () => false);
    if (!planDocumentVisible) {
      const fallbackRootSelector = `${turnSelector(context)} [data-plan-activity="true"]`;
      const fallbackRoot = context.page.locator(fallbackRootSelector).filter({
        hasText: planMarker,
      });
      await fallbackRoot.waitFor({ state: "visible" });
      await openDisclosure(fallbackRoot);
      const selector = `${fallbackRootSelector} [data-task-status="in_progress"]`;
      const target = context.page.locator(selector).filter({ hasText: planMarker });
      await target.waitFor({ state: "visible" });
      return {
        target,
        selector,
        expected: `Dedicated Markdown plan document containing ${planMarker}`,
        observed: `Gap: Markdown plan was projected into the task-list surface: ${await visibleText(target)}`,
        trigger: "ACP plan_update(markdown document) replayed through TestBridge",
        status: "fail",
        verificationMode: "replay",
        evidence: [
          `Real renderer gap for ${context.harness.label} ${context.harness.version}: no data-plan-document target`,
        ],
      };
    }
    await openDisclosure(root);
    const selector = `${rootSelector} [data-plan-document-content="true"]`;
    const target = context.page.locator(selector).filter({ hasText: planMarker });
    await target.waitFor({ state: "visible" });
    return replayResult(context, {
      target,
      selector,
      expected: `Expanded Markdown plan document containing ${planMarker}`,
      observed: await visibleText(target),
      trigger: "ACP plan_update(markdown document) replayed and expanded in the GUI",
    });
  },
};

const taskListProgress: MatrixFeatureDriver = {
  id: "output.task-list-progress",
  async run(context) {
    const activeTask = `Verify ${context.harness.label} task progress`;
    await context.injectEvent({
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect matrix fixture", status: "completed", priority: "high" },
        { content: activeTask, status: "in_progress", priority: "high" },
        { content: "Capture GUI evidence", status: "pending", priority: "medium" },
      ],
    });

    const rootSelector = `${turnSelector(context)} [data-plan-activity="true"]`;
    const root = context.page.locator(rootSelector);
    await openDisclosure(root);
    const selector = `${rootSelector} [data-task-status="in_progress"]`;
    const target = context.page.locator(selector).filter({ hasText: activeTask });
    await target.waitFor({ state: "visible" });
    return replayResult(context, {
      target,
      selector,
      expected: `Visible in-progress task: ${activeTask}`,
      observed: await visibleText(target),
      trigger: "ACP plan task-list snapshot injected and expanded in the GUI",
    });
  },
};

const usageParent: MatrixFeatureDriver = {
  id: "output.usage-parent",
  async run(context) {
    const used = 48_000;
    const size = 120_000;
    await context.injectEvent({
      sessionUpdate: "usage_update",
      used,
      size,
      cost: { amount: 0.12, currency: "USD" },
    });

    const selector = `[data-session-id=${cssAttributeValue(context.sessionId)}] [data-gui-feature="output.usage-parent"][data-usage-scope="parent"]`;
    const target = context.page.locator(selector);
    await target.waitFor({ state: "visible" });
    const observedUsed = await target.getAttribute("data-context-used");
    const observedSize = await target.getAttribute("data-context-size");
    return replayResult(context, {
      target,
      selector,
      expected: `Visible parent usage attributes ${used}/${size}`,
      observed: `${observedUsed}/${observedSize}; ${await visibleText(target)}`,
      trigger: "ACP usage_update injected through TestBridge",
    });
  },
};

const sessionStatusGoalQueue: MatrixFeatureDriver = {
  id: "output.session-status-goal-queue",
  async run(context) {
    const objective = `Verify ${context.harness.label} matrix status`;
    if (context.harness.id.toLowerCase().includes("codex")) {
      await context.injectEvent({
        sessionUpdate: "session_info_update",
        _meta: { codex: { goal: { objective, status: "active" } } },
      });
    }
    await context.bridge.injectSessionEvent({
      type: "session.queue_update",
      session_id: context.sessionId,
      mode: "single",
      active_turn_id: context.turnId,
      queued: [
        {
          turn_id: `${context.turnId}-queued`,
          text: `Queued matrix check for ${context.harness.label}`,
          created_at: 1,
        },
      ],
    });

    const selector = `section[data-session-runtime="true"][data-session-id=${cssAttributeValue(context.sessionId)}]:has([data-gui-feature="output.session-status-goal-queue"])`;
    const target = context.page.locator(selector);
    await target.locator('[data-session-status="running"]').waitFor({
      state: "visible",
    });
    await target.locator('[data-session-queue-depth="1"]').waitFor({
      state: "visible",
    });
    if (context.harness.id.toLowerCase().includes("codex")) {
      await target.locator('[data-session-goal-status="active"]').filter({
        hasText: objective,
      }).waitFor({ state: "visible" });
    }
    return replayResult(context, {
      target,
      selector,
      expected: context.harness.id.toLowerCase().includes("codex")
        ? `Running status, queue depth 1, and active Goal ${objective}`
        : "Running status and queue depth 1 on the session runtime surface",
      observed: await visibleText(target),
      trigger: context.harness.id.toLowerCase().includes("codex")
        ? "ACP session_info_update goal plus TestBridge session.queue_update"
        : "TestBridge session.queue_update",
    });
  },
};

export const harnessMatrixOutputStatusDrivers: MatrixFeatureDriver[] = [
  thinkingReasoning,
  noticeWarningError,
  toolStartInput,
  toolProgressOutput,
  toolTerminal,
  planDocument,
  taskListProgress,
  usageParent,
  sessionStatusGoalQueue,
];

export const OUTPUT_STATUS_MATRIX_DRIVERS = harnessMatrixOutputStatusDrivers;

export default harnessMatrixOutputStatusDrivers;
