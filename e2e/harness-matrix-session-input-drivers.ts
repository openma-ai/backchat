import type { Locator } from "@playwright/test";
import { basename } from "node:path";

import type {
  MatrixDriverContext,
  MatrixDriverResult,
  MatrixFeatureDriver,
} from "./harness-matrix-driver-types.js";
import { openPersistedSession, reloadRenderer } from "./helpers.js";

type ResultInput = {
  target: Locator;
  selector: string;
  expected: string;
  observed: string;
  trigger: string;
};

function replayResult(input: ResultInput): MatrixDriverResult {
  return {
    ...input,
    status: "pass-replay",
    verificationMode: "replay",
  };
}

async function visible(target: Locator): Promise<Locator> {
  await target.waitFor({ state: "visible", timeout: 15_000 });
  return target;
}

async function visibleText(target: Locator): Promise<string> {
  await visible(target);
  const text = (await target.innerText()).trim();
  if (text) return text;
  return (
    (await target.getAttribute("aria-label"))
    ?? (await target.getAttribute("alt"))
    ?? (await target.getAttribute("title"))
    ?? "visible"
  );
}

function mainComposer(context: MatrixDriverContext): Locator {
  return context.page.locator('[data-chat-surface="main"] textarea').last();
}

async function setRunning(
  context: MatrixDriverContext,
  input: { queued?: Array<{ turn_id: string; text: string; created_at: number }> } = {},
): Promise<void> {
  await context.bridge.injectSessionEvent({
    type: "session.queue_update",
    session_id: context.sessionId,
    mode: "single",
    active_turn_id: context.turnId,
    queued: input.queued ?? [],
  });
}

async function openContextFork(context: MatrixDriverContext): Promise<void> {
  await context.injectSession({ supportsSessionFork: true });
  const actions = context.page.getByRole("button", {
    name: /Task actions|会话操作/,
  });
  await visible(actions);
  await actions.click();
  const openFork = context.page.getByRole("menuitem", {
    name: /Open context fork|打开上下文分支/,
  });
  await visible(openFork);
  await openFork.click();
  await visible(context.page.locator('[data-chat-surface="side"]'));
}

async function persistAndOpenReplay(
  context: MatrixDriverContext,
  input: { title: string; prompt: string; response: string },
): Promise<Locator> {
  await context.bridge.persistSessionFixture({
    sessionId: context.sessionId,
    agentId: context.harness.id,
    cwd: context.cwd,
    acpSessionId: `acp-${context.sessionId}`,
    title: input.title,
    events: [
      { type: "user_prompt", data: { text: input.prompt } },
      {
        type: "agent_message_chunk",
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: input.response },
        },
      },
    ],
  });
  await reloadRenderer(context.page);
  await openPersistedSession(context.page, input.title, basename(context.cwd));
  return context.page.getByText(input.response, { exact: true }).last();
}

const initializeReady: MatrixFeatureDriver = {
  id: "session.initialize-ready",
  async run(context) {
    await context.injectSession();
    const target = context.page.locator(
      '[data-session-runtime="true"][data-gui-feature="session.initialize-ready"]',
    );
    return replayResult({
      target: await visible(target),
      selector:
        '[data-session-runtime="true"][data-gui-feature="session.initialize-ready"]',
      expected: "The initialized ACP session identity and ready state are visible in the GUI.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: session.ready from the selected harness fixture",
    });
  },
};

const newWorkspace: MatrixFeatureDriver = {
  id: "session.new-workspace",
  async run(context) {
    await context.injectSession();
    const target = context.page
      .locator('[data-gui-feature="session.new-workspace"]')
      .filter({ hasText: context.cwd });
    return replayResult({
      target: await visible(target),
      selector: '[data-gui-feature="session.new-workspace"]',
      expected: `The session workspace is visibly bound to ${context.cwd}.`,
      observed: await visibleText(target),
      trigger: "test-bridge replay: session.ready.cwd",
    });
  },
};

const loadHistory: MatrixFeatureDriver = {
  id: "session.load-history",
  async run(context) {
    const token = `History loaded for ${context.harness.label}`;
    const target = await persistAndOpenReplay(context, {
      title: `Matrix history ${context.sessionId}`,
      prompt: "Load the persisted matrix history.",
      response: token,
    });
    return replayResult({
      target: await visible(target),
      selector: `text=${JSON.stringify(token)}`,
      expected: "Persisted ACP transcript history is loaded into the real chat timeline.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: persist transcript -> renderer reload -> sessionsLoadHistory",
    });
  },
};

const resume: MatrixFeatureDriver = {
  id: "session.resume",
  async run(context) {
    await context.injectSession({ supportsSessionResume: true });
    const input = mainComposer(context);
    await visible(input);
    const prompt = `Resume matrix session ${context.harness.label}`;
    await input.fill(prompt);
    await input.press("Enter");
    const target = context.page.locator('[data-session-capability="session.resume"]');
    await visible(target);
    await visible(context.page.getByText(prompt, { exact: true }).last());
    return replayResult({
      target,
      selector: '[data-session-capability="session.resume"]',
      expected: "The advertised session.resume capability remains visible while the resumed session accepts a prompt.",
      observed: `${await visibleText(target)}; prompt submitted`,
      trigger: "test-bridge replay: session.ready supports_session_resume + composer submit on existing acp_session_id",
    });
  },
};

const forkSideChat: MatrixFeatureDriver = {
  id: "session.fork-side-chat",
  async run(context) {
    await openContextFork(context);
    const target = context.page.locator('[data-chat-surface="side"] textarea').last();
    return replayResult({
      target: await visible(target),
      selector: '[data-chat-surface="side"] textarea',
      expected: "Open context fork creates a subordinate side-chat composer through the real GUI action.",
      observed: "Visible side-chat composer with fork inheritance selected",
      trigger: "GUI: Task actions -> Open context fork (session/fork advertised)",
    });
  },
};

const promoteSideChat: MatrixFeatureDriver = {
  id: "session.side-chat-promote",
  async run(context) {
    await openContextFork(context);
    const promote = context.page.getByRole("button", {
      name: /Promote to main chat|转为主对话/,
    });
    await visible(promote);
    await promote.click();
    const target = context.page.locator('[data-chat-surface="main"]');
    await visible(target);
    return replayResult({
      target,
      selector: '[data-chat-surface="main"]',
      expected: "Promoting the side chat navigates it into the independent main-chat surface.",
      observed: `Main chat visible after promotion at ${context.page.url()}`,
      trigger: "GUI: Open context fork -> Promote to main chat",
    });
  },
};

const closeTerminated: MatrixFeatureDriver = {
  id: "session.close-terminated",
  async run(context) {
    // TestBridge invoke completion precedes delivery of any queued ready
    // notifications from the isolated ACP process. Let those settle before
    // applying the terminal lifecycle event so an older ready cannot revive
    // the session after the assertion has begun.
    await context.page.waitForTimeout(500);
    await context.bridge.injectSessionEvent({
      type: "session.event",
      session_id: context.sessionId,
      turn_id: "",
      event: { sessionUpdate: "session_info_update" },
      openma_event: {
        event_id: `matrix-terminated-${context.sessionId}`,
        occurred_at: new Date().toISOString(),
        type: "session.terminated",
        session_id: context.sessionId,
        data: { reason: "matrix session close replay" },
      },
    });
    const target = context.page.locator(
      '[data-gui-feature="session.close-terminated"][data-session-terminated="true"]',
    );
    return replayResult({
      target: await visible(target),
      selector:
        '[data-gui-feature="session.close-terminated"][data-session-terminated="true"]',
      expected: "A terminated session remains visible and its composer is explicitly disabled.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: canonical session.terminated projection",
    });
  },
};

const localArchiveDelete: MatrixFeatureDriver = {
  id: "session.local-archive-delete",
  async run(context) {
    const actions = context.page.getByRole("button", {
      name: /Task actions|会话操作/,
    });
    await visible(actions);
    await actions.click();
    const archive = context.page.getByRole("menuitem", {
      name: /Archive|归档/,
    });
    await visible(archive);
    await archive.click();
    await context.page.waitForFunction(async (sessionId) =>
      (await window.backchat.sessionsListArchived()).some((row) => row.id === sessionId),
    context.sessionId);
    const settings = context.page.getByRole("link", {
      name: /Settings|设置/,
      exact: true,
    });
    await visible(settings);
    await settings.click();
    const archivedChats = context.page.getByRole("link", {
      name: /Archived chats|已归档对话/,
    });
    await visible(archivedChats);
    await archivedChats.click();
    const archiveRow = context.page.locator("li").filter({ hasText: context.sessionId });
    await visible(archiveRow);
    const deleteButton = archiveRow.getByRole("button", { name: "彻底删除" });
    await visible(deleteButton);
    await deleteButton.click();
    const target = archiveRow.getByRole("button", { name: "确认删除" });
    return replayResult({
      target: await visible(target),
      selector: 'role=button[name="确认删除"]',
      expected: "The locally archived chat exposes the real two-step permanent-delete confirmation.",
      observed: await visibleText(target),
      trigger: "GUI: Task actions -> Archive -> Settings -> Archived chats -> Delete once",
    });
  },
};

const restartReplay: MatrixFeatureDriver = {
  id: "session.restart-replay",
  async run(context) {
    const token = `Restart replay restored ${context.harness.label}`;
    const target = await persistAndOpenReplay(context, {
      title: `Matrix restart ${context.sessionId}`,
      prompt: "Restore this turn after a renderer restart.",
      response: token,
    });
    return replayResult({
      target: await visible(target),
      selector: `text=${JSON.stringify(token)}`,
      expected: "A renderer restart rebuilds the persisted conversation into the visible timeline.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: persisted transcript -> page.reload -> visible turn replay",
    });
  },
};

const promptText: MatrixFeatureDriver = {
  id: "input.prompt-text",
  async run(context) {
    const prompt = `Matrix prompt text for ${context.harness.label}`;
    const input = mainComposer(context);
    await visible(input);
    await input.fill(prompt);
    await input.press("Enter");
    const target = context.page.getByText(prompt, { exact: true }).last();
    return replayResult({
      target: await visible(target),
      selector: `text=${JSON.stringify(prompt)}`,
      expected: "Typed composer text is submitted and rendered as a real user turn.",
      observed: await visibleText(target),
      trigger: "GUI: main composer fill -> Enter -> sessionPrompt",
    });
  },
};

const imageAttachment: MatrixFeatureDriver = {
  id: "input.image-attachment",
  async run(context) {
    const name = `matrix-${context.harness.id}.svg`;
    await context.bridge.setPickedFiles([
      {
        id: `image-${context.sessionId}`,
        name,
        path: `${context.cwd}/${name}`,
        uri: `file://${context.cwd}/${name}`,
        kind: "image",
        mimeType: "image/svg+xml",
        size: 112,
        data: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiByeD0iMTIiIGZpbGw9IiMyZjgwZWQiLz48L3N2Zz4=",
      },
    ]);
    const attach = context.page.getByRole("button", {
      name: /Attach files|添加附件/,
    });
    await visible(attach);
    await attach.click();
    const target = context.page.getByRole("img", { name });
    return replayResult({
      target: await visible(target),
      selector: `role=img[name=${JSON.stringify(name)}]`,
      expected: "The selected image is visibly previewed in the composer attachment row.",
      observed: await visibleText(target),
      trigger: "GUI: Attach files -> native picker test bridge returns an image",
    });
  },
};

const resourceContext: MatrixFeatureDriver = {
  id: "input.resource-context",
  async run(context) {
    const name = `matrix-context-${context.harness.id}.md`;
    await context.bridge.setPickedFiles([
      {
        id: `resource-${context.sessionId}`,
        name,
        path: `${context.cwd}/${name}`,
        uri: `file://${context.cwd}/${name}`,
        kind: "file",
        mimeType: "text/markdown",
        size: 64,
      },
    ]);
    const input = mainComposer(context);
    await visible(input);
    await input.fill("@matrix-resource");
    const picker = context.page.getByRole("listbox", {
      name: /Mention another session|引用其他会话/,
    });
    await visible(picker);
    const browse = picker.getByRole("option", { name: /Choose a file.*browse/i });
    await visible(browse);
    await browse.click();
    const target = context.page.getByRole("button", { name: `Open ${name}` });
    return replayResult({
      target: await visible(target),
      selector: `role=button[name=${JSON.stringify(`Open ${name}`)}]`,
      expected: "A workspace resource selected through @ context is shown as an inline context chip.",
      observed: await visibleText(target),
      trigger: "GUI: type @ -> Choose a file -> native picker test bridge",
    });
  },
};

const sessionReference: MatrixFeatureDriver = {
  id: "input.session-reference",
  async run(context) {
    const referenceId = `e2e-ref-${context.sessionId}`;
    await context.bridge.injectSessionRow({
      session_id: referenceId,
      agent_id: context.harness.id,
      cwd: `${context.cwd}/referenced`,
    });
    const input = mainComposer(context);
    await visible(input);
    await input.fill(`@${referenceId}`);
    const picker = context.page.getByRole("listbox", {
      name: /Mention another session|引用其他会话/,
    });
    await visible(picker);
    const option = picker.getByRole("option").filter({ hasText: referenceId.slice(0, 12) });
    await visible(option);
    await option.click();
    const target = context.page.getByRole("button", {
      name: /Open referenced session:|打开引用的会话：/,
    });
    return replayResult({
      target: await visible(target),
      selector: '[aria-label^="Open referenced session:"]',
      expected: "Another Backchat session is selected and displayed as a navigable reference chip.",
      observed: await visibleText(target),
      trigger: "GUI: type @session-id -> choose session from mention picker",
    });
  },
};

const availableCommands: MatrixFeatureDriver = {
  id: "input.available-commands",
  async run(context) {
    const command = `matrix-${context.harness.id}`;
    await context.injectEvent({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        {
          name: command,
          description: `Visible command from ${context.harness.label}`,
        },
      ],
    });
    const input = mainComposer(context);
    await visible(input);
    await input.fill("/matrix");
    const panel = context.page.getByRole("listbox", { name: "Slash commands" });
    await visible(panel);
    const target = panel.getByRole("option", {
      name: new RegExp(`/${command}\\b`, "i"),
    });
    return replayResult({
      target: await visible(target),
      selector: `role=option[name~=${JSON.stringify(`/${command}`)}]`,
      expected: "ACP available_commands_update populates the visible slash-command picker.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: available_commands_update -> GUI type /matrix",
    });
  },
};

const mode: MatrixFeatureDriver = {
  id: "input.mode",
  async run(context) {
    await context.injectEvent({
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "mode",
          name: "Session mode",
          category: "mode",
          type: "select",
          currentValue: "matrix-ask",
          options: [
            { value: "matrix-ask", name: "Matrix ask", description: "Ask before edits" },
            { value: "matrix-auto", name: "Matrix auto", description: "Proceed automatically" },
          ],
        },
      ],
    });
    const modeControl = context.page.getByRole("button", { name: "Matrix ask" });
    await visible(modeControl);
    await modeControl.click();
    const target = context.page.getByRole("menuitem", { name: /Matrix auto/ });
    await visible(target);
    return replayResult({
      target,
      selector: 'role=menuitem[name~="Matrix auto"]',
      expected: "The ACP mode config option is visible and opens its real mode selector.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: config_option_update category=mode -> click mode control",
    });
  },
};

const configModelReasoning: MatrixFeatureDriver = {
  id: "input.config-model-reasoning",
  async run(context) {
    await context.injectEvent({
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "matrix-flash",
          options: [
            { value: "matrix-flash", name: "Matrix Flash" },
            { value: "matrix-pro", name: "Matrix Pro" },
          ],
        },
        {
          id: "reasoning",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue: "high",
          options: [
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
      ],
    });
    const run = context.page.getByRole("button", {
      name: /Run on Local with .* using Matrix Flash/,
    });
    await visible(run);
    await run.click();
    const target = context.page.getByRole("menu").last();
    await visible(target);
    return replayResult({
      target,
      selector: '[role="menu"]',
      expected: "The run menu visibly exposes both model and reasoning configuration sections.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: config_option_update model + thought_level -> open Run menu",
    });
  },
};

const cancelStop: MatrixFeatureDriver = {
  id: "input.cancel-stop",
  async run(context) {
    await setRunning(context);
    const target = context.page.getByRole("button", { name: /Stop|停止/ });
    return replayResult({
      target: await visible(target),
      selector: 'role=button[name="Stop"]',
      expected: "An active turn exposes the real Stop control in the composer.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: session.queue_update active_turn_id",
    });
  },
};

const steering: MatrixFeatureDriver = {
  id: "input.steering",
  async run(context) {
    const queuedTurnId = `${context.turnId}-steer`;
    await setRunning(context, {
      queued: [
        {
          turn_id: queuedTurnId,
          text: `Steer ${context.harness.label} now`,
          created_at: Date.now(),
        },
      ],
    });
    const target = context.page.getByRole("button", {
      name: "Steer queued message 1",
    });
    return replayResult({
      target: await visible(target),
      selector: 'role=button[name="Steer queued message 1"]',
      expected: "A queued prompt exposes the real Steer action without inventing provider support.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: active + queued prompt -> ComposerProgress Steer control",
    });
  },
};

const queue: MatrixFeatureDriver = {
  id: "input.queue",
  async run(context) {
    const queuedTurnId = `${context.turnId}-queued`;
    const text = `Queued matrix prompt for ${context.harness.label}`;
    await setRunning(context, {
      queued: [{ turn_id: queuedTurnId, text, created_at: Date.now() }],
    });
    const target = context.page.locator(`[data-queued-turn-id="${queuedTurnId}"]`);
    return replayResult({
      target: await visible(target),
      selector: '[data-composer-queue="true"] [data-queued-turn-id]',
      expected: "The local prompt queue displays the queued turn and its controls above the composer.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: session.queue_update with one queued prompt",
    });
  },
};

const streamingResponse: MatrixFeatureDriver = {
  id: "output.streaming-response",
  async run(context) {
    await setRunning(context);
    const text = `Streaming response from ${context.harness.label}`;
    await context.injectEvent({
      sessionUpdate: "agent_message_chunk",
      // Close the streamed Markdown paragraph while deliberately leaving the
      // turn itself in-flight. The streaming renderer otherwise keeps the
      // final character buffered until the next token arrives.
      content: { type: "text", text: `${text}\n\n` },
    });
    const target = context.page.getByText(text, { exact: true }).last();
    return replayResult({
      target: await visible(target),
      selector: `text=${JSON.stringify(text)}`,
      expected: "An in-flight ACP agent_message_chunk is visibly streamed before turn completion.",
      observed: await visibleText(target),
      trigger: "test-bridge replay: active turn + agent_message_chunk without session.complete",
    });
  },
};

export const SESSION_INPUT_MATRIX_DRIVERS: MatrixFeatureDriver[] = [
  initializeReady,
  newWorkspace,
  loadHistory,
  resume,
  forkSideChat,
  promoteSideChat,
  closeTerminated,
  localArchiveDelete,
  restartReplay,
  promptText,
  imageAttachment,
  resourceContext,
  sessionReference,
  availableCommands,
  mode,
  configModelReasoning,
  cancelStop,
  steering,
  queue,
  streamingResponse,
];

export default SESSION_INPUT_MATRIX_DRIVERS;
