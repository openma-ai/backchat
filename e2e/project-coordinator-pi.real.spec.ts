import { expect, test, type Page } from "@playwright/test";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { realpathSync as resolveRealPath } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { launchAppWithHome, reloadRenderer } from "./helpers";

interface PiRuntimeEvidence {
  sessionId: string;
  agentInfo: { name?: string; version?: string };
  httpMcp: boolean;
}

async function openProjectCoordinator(page: Page, projectId: string): Promise<void> {
  const projects = page.getByRole("button", { name: "Projects", exact: true });
  if (await projects.getAttribute("aria-expanded") === "false") await projects.click();
  const project = page.locator(`[data-sidebar-project="project:${projectId}"]`);
  const toggle = project.locator("button[aria-expanded]").first();
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await page.locator(`[data-project-coordinator="project:${projectId}"]`).click();
}

interface ToolEvidence {
  id: string;
  sessionId?: string;
  turnId?: string;
  name?: string;
  input?: { path?: string };
  output?: {
    details?: { tool?: string; structuredContent?: ProjectStatusEvidence };
  };
  completed: boolean;
}

interface ProjectStatusEvidence {
  project: { id: string };
  pending: number;
  error: string | null;
  threads: {
    workThreadId: string;
    role: string;
    workerId?: string;
    session: { id: string };
    turn?: { id: string; state: string; summary?: string };
  }[];
}

function toolEvidence(
  events: readonly {
    type: string;
    data: unknown;
    session_id?: string;
    turn_id?: string;
    raw?: unknown;
  }[],
): ToolEvidence[] {
  const calls = new Map<string, ToolEvidence>();
  for (const event of events) {
    if (!event.type.startsWith("tool.")) continue;
    const data = event.data as {
      tool_call_id?: string;
      raw_input?: ToolEvidence["input"];
      raw_output?: ToolEvidence["output"];
    };
    if (!data.tool_call_id) continue;
    const key = `${event.session_id}:${data.tool_call_id}`;
    const call = calls.get(key) ?? {
      id: data.tool_call_id,
      sessionId: event.session_id,
      turnId: event.turn_id,
      completed: false,
    };
    const raw = event.raw as { payload?: { name?: string } } | undefined;
    call.name ??= raw?.payload?.name;
    if (data.raw_input !== undefined) call.input = data.raw_input;
    if (data.raw_output !== undefined) call.output = data.raw_output;
    if (event.type === "tool.completed") call.completed = true;
    calls.set(key, call);
  }
  return [...calls.values()];
}

function sessionMemory(session: { externalHandle?: unknown }) {
  const handle = session.externalHandle as { raw?: unknown } | null | undefined;
  const raw = handle?.raw as
    { cwd?: string; memoryDirectory?: string } | undefined;
  expect(raw?.cwd).toEqual(expect.any(String));
  expect(
    raw?.memoryDirectory,
    "Session must expose its thread memory directory",
  ).toEqual(expect.any(String));
  expect(isAbsolute(raw!.memoryDirectory!)).toBe(true);
  return raw as { cwd: string; memoryDirectory: string };
}

async function memoryTextFiles(directory: string) {
  const files: { path: string; content: string }[] = [];
  const visit = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const bytes = await readFile(path);
        if (bytes.includes(0)) continue;
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          continue;
        }
        files.push({ path: relative(directory, path), content });
      }
    }
  };
  await visit(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function assertMemoryEvidence(
  calls: ToolEvidence[],
  sessionId: string,
  memory: ReturnType<typeof sessionMemory>,
  files: Awaited<ReturnType<typeof memoryTextFiles>>,
  token: string,
) {
  const proofFiles = files.filter((file) => file.content.includes(token));
  expect(
    proofFiles.length,
    `Session ${sessionId} must save the token in a text file of its choice`,
  ).toBeGreaterThan(0);
  expect(
    calls.some(
      (call) =>
        call.sessionId === sessionId &&
        call.completed &&
        ["write", "edit"].includes(call.name ?? "") &&
        typeof call.input?.path === "string" &&
        proofFiles.some(
          (file) =>
          resolveRealPath(resolve(memory.cwd, call.input!.path!)) ===
          resolveRealPath(join(memory.memoryDirectory, file.path)),
        ),
    ),
    `Session ${sessionId} must write its own memory evidence through a native file tool`,
  ).toBe(true);
}

function isWithin(directory: string, path: string) {
  // macOS reports the same temporary directory through both /var and
  // /private/var. Compare resolved paths so this checks the actual boundary.
  const child = relative(resolveRealPath(directory), resolveRealPath(path));
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

function workerTestExits(
  events: readonly { type: string; data: unknown }[],
): number[] {
  const exits: number[] = [];
  const creates = new Set<string>();
  const terminals = new Set<string>();
  const waits = new Set<string>();
  for (const event of events) {
    const data = event.data as {
      callback_id?: string;
      method?: string;
      params?: { command?: string; args?: string[]; terminalId?: string };
      result?: { terminalId?: string; exitCode?: number };
    };
    if (!data.callback_id) continue;
    if (
      event.type === "callback.requested" &&
      data.method === "terminal/create" &&
      /node\s+--test\s+sum\.test\.mjs/.test(
        [data.params?.command, ...(data.params?.args ?? [])].join(" "),
      )
    )
      creates.add(data.callback_id);
    if (
      event.type === "callback.completed" &&
      creates.has(data.callback_id) &&
      data.result?.terminalId
    )
      terminals.add(data.result.terminalId);
    if (
      event.type === "callback.requested" &&
      data.method === "terminal/wait_for_exit" &&
      terminals.has(data.params?.terminalId ?? "")
    )
      waits.add(data.callback_id);
    if (
      event.type === "callback.completed" &&
      waits.has(data.callback_id) &&
      typeof data.result?.exitCode === "number"
    )
      exits.push(data.result.exitCode);
  }
  return exits;
}

// Opt-in: this uses the installed Pi and makes billable model requests.
test("Pi coordinator delegates a red-green repair and reviews the worker result in the same session", async ({}, testInfo) => {
  test.skip(
    process.env["OPENMA_REAL_PI_COORDINATOR_E2E"] !== "1",
    "Set OPENMA_REAL_PI_COORDINATOR_E2E=1 to use real Pi",
  );
  test.setTimeout(420_000);
  const command =
    process.env["OPENMA_REAL_PI_COMMAND"] ??
    join(homedir(), ".oma/acp/bin/openma-acp-pi-acp");
  await access(command);
  const home = await mkdtemp(join(tmpdir(), "backchat-real-pi-"));
  const evidence = async (name: string, body: string, contentType: string) => {
    const path = testInfo.outputPath(name);
    await writeFile(path, body);
    await testInfo.attach(name, { path, contentType });
  };
  const repo = join(home, "source");
  await mkdir(repo, { recursive: true });
  const git = (...args: string[]) => {
    const result = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const original = "export const add = (a, b) => a - b;\n";
  await writeFile(join(repo, "sum.mjs"), original);
  const testSource = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './sum.mjs';\ntest('adds positive numbers', () => assert.equal(add(2, 3), 5));\ntest('adds signed numbers', () => assert.equal(add(-4, 7), 3));\n`;
  await writeFile(join(repo, "sum.test.mjs"), testSource);
  git("init", "-b", "main");
  git(
    "-c",
    "user.name=Coordinator E2E",
    "-c",
    "user.email=e2e@example.invalid",
    "add",
    ".",
  );
  git(
    "-c",
    "user.name=Coordinator E2E",
    "-c",
    "user.email=e2e@example.invalid",
    "commit",
    "-m",
    "Failing addition fixture",
  );
  const runTests = (cwd: string) =>
    spawnSync(process.execPath, ["--test", "sum.test.mjs"], {
      cwd,
      encoding: "utf8",
    });
  const red = runTests(repo);
  expect(red.status).toBe(1);
  await evidence("red-before-request.txt", red.stdout, "text/plain");
  await writeFile(
    join(home, "registry-cache.json"),
    JSON.stringify({ fetchedAt: Date.now(), data: { version: 1, agents: [] } }),
  );

  const launched = await launchAppWithHome(home, { language: "en" });
  const { page, app } = launched;
  const projectId = "real-pi-coordinator";
  const view = () =>
    page.evaluate((id) => window.backchat.projectWorkView(id), projectId);
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 850),
    );
    await page.evaluate(
      async ({ command, projectId, repo }) => {
        const settings = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          default: {
            ...settings.default,
            permission_mode: "auto",
            prompt_queue_enabled: true,
          },
          agents: [
            {
              id: "pi-acp",
              enabled: true,
              command_override: command,
              args_override: [],
              env: [],
            },
          ],
        });
        await window.backchat.projectSave({
          project_id: projectId,
          name: "Pi coordinator TDD",
          source_folders: [repo],
        });
        await window.backchat.projectWorkSave({
          projectId,
          description: "Real coordinator delegation regression",
          context: "",
          resources: [],
          instructions:
            "Delegate source changes and review the worker's returned evidence without delegating again. Use native read/write/edit tools when maintaining thread notes so the evidence is visible in tool events.",
          coordinatorAgent: "pi-acp",
          workerAgent: "pi-acp",
          continuity: "per-scope",
          controls: ["delegate", "steer", "cancel", "complete"],
          execution: { kind: "local" },
        });
      },
      { command, projectId, repo },
    );
    await reloadRenderer(page);
    await page.evaluate(() => {
      const runtimes: Record<string, PiRuntimeEvidence> = {};
      Object.assign(window, { realPiRuntimes: runtimes });
      window.backchat.onSessionEvent((event) => {
        if (event.type !== "session.ready" || event.agent_id !== "pi-acp")
          return;
        const info = event.agent_info as
          PiRuntimeEvidence["agentInfo"] | undefined;
        const capabilities = event.agent_capabilities as
          { mcpCapabilities?: { http?: boolean } } | undefined;
        runtimes[event.session_id] = {
          sessionId: event.session_id,
          agentInfo: { name: info?.name, version: info?.version },
          httpMcp: capabilities?.mcpCapabilities?.http === true,
        };
      });
    });
    await openProjectCoordinator(page, projectId);
    const composer = page.getByLabel("Message coordinator", { exact: true });
    await composer.fill(
      "Use project.delegate to delegate exactly one worker with workerId addition-tdd. Copy ALL of these requirements into its task: In your assigned cwd, (1) execute exactly `node --test sum.test.mjs` as the only command in one bash tool call and observe exit code 1; (2) repair sum.mjs only using the edit tool, do not edit tests; (3) execute exactly `node --test sum.test.mjs` as the only command in a separate bash tool call and observe exit code 0. Do not pipe output, use grep/tail, combine steps with semicolons, mask exit status, or commit. Stay in your assigned source workspace. (4) Generate a random token using node:crypto and write it to worker-proof.txt. These are the only two source workspace files you may change or create. Save the exact token, RED/GREEN evidence and branch in a text file of your choice inside your thread's memoryDirectory, using native write/edit tools for notes. Choose the filename, organization and when to maintain it yourself. Report the token, the RED and GREEN test counts, and your branch. Coordinator: do not edit source files. After the delegation receipt, call project.status once with no worker filter and end the turn after reporting the observed facts. When the worker result comes back, call project.status with workerId addition-tdd, save its exact token and test results in a text file of your choice inside your own memoryDirectory, and report your review including that token. If project tools are unavailable, report the failure and do not use shell workarounds.",
    );
    await page
      .getByRole("button", { name: "Send (Enter)", exact: true })
      .click();
    await expect(composer).toHaveValue("");

    // Fail early when Pi cannot start or cannot see the project tools; waiting
    // for a worker timeout would hide the actual integration boundary.
    await expect
      .poll(
        async () => {
          const work = await view();
          return (
            work.facts.turns.some((turn) =>
              ["completed", "failed", "cancelled"].includes(turn.state),
            ) || !!work.error
          );
        },
        { timeout: 180_000 },
      )
      .toBe(true);
    const first = await view();
    expect(first.error).toBeNull();
    expect(
      first.facts.turns.some((turn) => turn.state === "completed"),
      JSON.stringify(
        first.facts.agentEvents.filter(
          (event) => event.type === "session.error",
        ),
      ),
    ).toBe(true);
    expect(
      toolEvidence(first.facts.agentEvents).some(
        (call) =>
          call.completed && call.output?.details?.tool === "project.delegate",
      ),
      "Coordinator must call the injected delegation tool",
    ).toBe(true);
    const coordinator = first.facts.sessions.find(
      (session) => session.agentId === "coordinator",
    )!;
    expect(coordinator).toBeTruthy();

    await expect
      .poll(
        async () => {
          const work = await view();
          return (
            work.facts.turns.filter((turn) => turn.state === "completed")
              .length >= 3 ||
            !!work.error ||
            work.facts.turns.some((turn) =>
              ["failed", "cancelled"].includes(turn.state),
            )
          );
        },
        { timeout: 240_000 },
      )
      .toBe(true);
    const result = await view();
    expect(result.error).toBeNull();
    expect(result.facts.turns.map((turn) => turn.state)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(
      result.facts.sessions
        .filter((session) => session.agentId === "coordinator")
        .map((session) => session.id),
    ).toEqual([coordinator.id]);
    expect(
      result.facts.sessions.filter((session) => session.agentId === "worker"),
    ).toHaveLength(1);
    const runtimes = await page.evaluate(() =>
      Object.values(
        (
          window as unknown as {
            realPiRuntimes: Record<string, PiRuntimeEvidence>;
          }
        ).realPiRuntimes,
      ),
    );
    const expectedVersion = process.env["OPENMA_REAL_PI_EXPECT_VERSION"];
    for (const session of result.facts.sessions) {
      const runtime = runtimes.find((item) => item.sessionId === session.id);
      expect(
        runtime,
        `Missing initialize evidence for ${session.agentId}`,
      ).toBeTruthy();
      expect(runtime!.httpMcp).toBe(true);
      if (expectedVersion)
        expect(runtime!.agentInfo.version).toBe(expectedVersion);
    }
    expect(
      result.facts.events.filter(
        (event) => event.type === "project.worker.requested",
      ),
    ).toHaveLength(1);
    const delegation = result.facts.agentEvents.find(
      (event) =>
        event.type === "tool.started" &&
        /delegate/.test(JSON.stringify(event.data)),
    );
    expect(delegation).toBeTruthy();
    const delegationId = (delegation!.data as { tool_call_id: string })
      .tool_call_id;
    expect(
      result.facts.agentEvents.some(
        (event) =>
          event.type === "tool.completed" &&
          (event.data as { tool_call_id?: string }).tool_call_id ===
            delegationId,
      ),
    ).toBe(true);
    const worker = result.workspaces!.find((workspace) =>
      workspace.workThreadId.includes(":worker:"),
    )!;
    const workerCwd = (worker.location as { cwd: string }).cwd;
    expect(workerCwd).not.toBe(repo);
    const green = runTests(workerCwd);
    expect(green.status, green.stdout + green.stderr).toBe(0);
    expect(await readFile(join(workerCwd, "sum.test.mjs"), "utf8")).toBe(
      testSource,
    );
    expect(await readFile(join(repo, "sum.mjs"), "utf8")).toBe(original);
    expect(git("status", "--porcelain")).toBe("");
    for (const [args, expected] of [
      [["diff", "HEAD", "--name-only"], "sum.mjs"],
      [["ls-files", "--others", "--exclude-standard"], "worker-proof.txt"],
    ] as const) {
      const changed = spawnSync("git", ["-C", workerCwd, ...args], {
        encoding: "utf8",
      });
      expect(changed.status, changed.stderr).toBe(0);
      expect(
        changed.stdout.trim(),
        "Source workspace must contain only the requested repair and proof file",
      ).toBe(expected);
    }
    const token = (
      await readFile(join(workerCwd, "worker-proof.txt"), "utf8")
    ).trim();
    expect(token.length).toBeGreaterThan(8);
    const returned = result.facts.contexts
      .flatMap((context) => context.items)
      .filter((item) => item.kind === "coordinator-worker-result");
    expect(returned).toHaveLength(1);
    expect(JSON.stringify(returned[0]!.value)).toContain(token);
    const workerSession = result.facts.sessions.find(
      (session) => session.agentId === "worker",
    )!;
    const workerTurn = result.facts.turns.find(
      (turn) => turn.sessionId === workerSession.id,
    )!;
    const coordinatorTurns = result.facts.turns.filter(
      (turn) => turn.sessionId === coordinator.id,
    );
    expect(coordinatorTurns).toHaveLength(2);
    const calls = toolEvidence(result.facts.agentEvents);
    const coordinatorMemory = sessionMemory(
      result.facts.sessions.find((session) => session.id === coordinator.id)!,
    );
    const workerMemory = sessionMemory(workerSession);
    expect(workerMemory.memoryDirectory).not.toBe(
      coordinatorMemory.memoryDirectory,
    );
    const sourceDirectories = [repo, coordinatorMemory.cwd, workerCwd];
    for (const memory of [coordinatorMemory, workerMemory]) {
      for (const cwd of sourceDirectories) {
        expect(
          isWithin(cwd, memory.memoryDirectory),
          `Memory must stay outside source workspace ${cwd}`,
        ).toBe(false);
      }
    }
    const [coordinatorNotes, workerNotes] = await Promise.all([
      memoryTextFiles(coordinatorMemory.memoryDirectory),
      memoryTextFiles(workerMemory.memoryDirectory),
    ]);
    assertMemoryEvidence(
      calls,
      coordinator.id,
      coordinatorMemory,
      coordinatorNotes,
      token,
    );
    assertMemoryEvidence(
      calls,
      workerSession.id,
      workerMemory,
      workerNotes,
      token,
    );
    const coordinatorWrites = calls.filter(
      (call) =>
        call.sessionId === coordinator.id &&
        call.completed &&
        ["write", "edit"].includes(call.name ?? ""),
    );
    expect(
      coordinatorWrites.every(
        (call) =>
          typeof call.input?.path === "string" &&
          isWithin(
            coordinatorMemory.memoryDirectory,
            resolve(coordinatorMemory.cwd, call.input.path),
          ),
      ),
      "Coordinator must modify only its own notes",
    ).toBe(true);
    const workerWrites = calls.filter(
      (call) =>
        call.sessionId === workerSession.id &&
        call.completed &&
        ["write", "edit"].includes(call.name ?? ""),
    );
    expect(
      workerWrites.some(
        (call) =>
          typeof call.input?.path === "string" &&
          isWithin(
            coordinatorMemory.memoryDirectory,
            resolve(workerMemory.cwd, call.input.path),
          ),
      ),
      "Worker must not edit the coordinator's memory",
    ).toBe(false);
    const statusQueries = calls.filter(
      (call) =>
        call.sessionId === coordinator.id &&
        call.completed &&
        call.output?.details?.tool === "project.status",
    );
    const firstStatus = statusQueries.find(
      (call) => call.turnId === coordinatorTurns[0]!.id,
    )?.output?.details?.structuredContent;
    expect(
      firstStatus,
      "Coordinator must observe runtime facts after delegation",
    ).toBeTruthy();
    expect(firstStatus!.project.id).toBe(projectId);
    expect(firstStatus!.error).toBeNull();
    expect(
      firstStatus!.threads.some(
        (thread) =>
          thread.role === "coordinator" &&
          thread.session.id === coordinator.id &&
          thread.turn?.state === "running",
      ),
    ).toBe(true);
    // The accepted command may still be queued, or already have created its worker.
    expect(
      firstStatus!.pending > 0 ||
        firstStatus!.threads.some(
          (thread) => thread.workerId === "addition-tdd",
        ),
    ).toBe(true);
    const reviewedStatus = statusQueries.find(
      (call) => call.turnId === coordinatorTurns[1]!.id,
    )?.output?.details?.structuredContent;
    expect(
      reviewedStatus,
      "Coordinator must verify the returned worker against runtime facts",
    ).toBeTruthy();
    expect(reviewedStatus!.error).toBeNull();
    const observedWorker = reviewedStatus!.threads.find(
      (thread) => thread.workerId === "addition-tdd",
    );
    expect(observedWorker).toMatchObject({
      workThreadId: workerSession.workThreadId,
      session: { id: workerSession.id },
      turn: { id: workerTurn.id, state: "completed" },
    });
    expect(observedWorker!.turn!.summary).toContain(token);
    expect(returned[0]!.provenance).toContainEqual({
      sourceType: "agent-turn",
      sourceId: workerTurn.id,
    });
    const workerExits = workerTestExits(
      result.facts.agentEvents.filter(
        (event) => event.turn_id === workerTurn.id,
      ),
    );
    expect(
      workerExits[0],
      "Worker must execute the failing tests before repairing the implementation",
    ).toBe(1);
    expect(workerExits.at(-1), "Worker must rerun the tests successfully").toBe(
      0,
    );
    await expect(page.locator(".project-transcript")).toContainText(token);
    await evidence(
      "coordinator-memory.json",
      JSON.stringify(coordinatorNotes, null, 2),
      "application/json",
    );
    await evidence(
      "worker-memory.json",
      JSON.stringify(workerNotes, null, 2),
      "application/json",
    );
    await evidence("green-after-worker.txt", green.stdout, "text/plain");
    await evidence(
      "coordinator-evidence.json",
      JSON.stringify(
        {
          runtimes,
          coordinatorId: coordinator.id,
          turns: result.facts.turns.map(({ id, sessionId, state }) => ({
            id,
            sessionId,
            state,
          })),
          workerCwd,
          branch: worker.branch,
          token,
          memory: { coordinator: coordinatorMemory, worker: workerMemory },
          statusQueries: statusQueries.map((call) => ({
            turnId: call.turnId,
            snapshot: call.output?.details?.structuredContent,
          })),
          workerTestExits: workerExits,
          red: red.status,
          green: green.status,
        },
        null,
        2,
      ),
      "application/json",
    );
  } finally {
    // Keep only scoped project facts (never settings, environment, or auth files).
    const work = await view().catch(() => null);
    if (work)
      await evidence(
        "project-facts.json",
        JSON.stringify(work.facts, null, 2),
        "application/json",
      );
    await page
      .screenshot({ path: testInfo.outputPath("coordinator-ui.png") })
      .catch(() => undefined);
    await launched.cleanup();
  }
});

// Opt-in: this uses the installed Pi and makes billable model requests.
test("Pi uses the WorkThread outcome tools", async ({}, testInfo) => {
  test.skip(
    process.env["OPENMA_REAL_PI_COORDINATOR_E2E"] !== "1",
    "Set OPENMA_REAL_PI_COORDINATOR_E2E=1 to use real Pi",
  );
  test.setTimeout(300_000);
  const command =
    process.env["OPENMA_REAL_PI_COMMAND"] ??
    join(homedir(), ".oma/acp/bin/openma-acp-pi-acp");
  await access(command);
  const home = await mkdtemp(join(tmpdir(), "backchat-real-pi-outcome-"));
  const repo = join(home, "source");
  await mkdir(repo, { recursive: true });
  const launched = await launchAppWithHome(home, { language: "en" });
  const { page } = launched;
  const projectId = "real-pi-outcome";
  const view = () =>
    page.evaluate((id) => window.backchat.projectWorkView(id), projectId);
  try {
    await page.evaluate(
      async ({ command, projectId, repo }) => {
        const settings = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          default: {
            ...settings.default,
            permission_mode: "auto",
            prompt_queue_enabled: true,
          },
          agents: [
            {
              id: "pi-acp",
              enabled: true,
              command_override: command,
              args_override: [],
              env: [],
            },
          ],
        });
        await window.backchat.projectSave({
          project_id: projectId,
          name: "Pi outcome",
          source_folders: [repo],
        });
        await window.backchat.projectWorkSave({
          projectId,
          description: "Verify the persistent WorkThread outcome.",
          context: "",
          resources: [],
          instructions:
            "Use the OpenMatter outcome tools exactly as requested. Do not use shell workarounds.",
          coordinatorAgent: "pi-acp",
          workerAgent: "pi-acp",
          continuity: "per-scope",
          controls: [],
          execution: { kind: "local" },
        });
      },
      { command, projectId, repo },
    );
    await reloadRenderer(page);
    await openProjectCoordinator(page, projectId);
    const composer = page.getByLabel("Message coordinator", { exact: true });
    await composer.fill(
      "For this WorkThread, use create_goal with objective exactly 'Verify the Pi outcome round trip'. Then use get_goal to read it back and update_goal with status complete and reason 'Verified by the coordinator'. Do all three in this turn.",
    );
    await page.getByRole("button", { name: "Send (Enter)", exact: true }).click();
    await expect
      .poll(
        async () => {
          const work = await view();
          return {
            status: work.facts.goals[0]?.status ?? null,
            turns: work.facts.turns.filter((turn) => turn.state === "completed").length,
          };
        },
        { timeout: 240_000 },
      )
      .toMatchObject({ status: "complete" });
    const work = await view();
    const coordinator = work.facts.sessions.find(
      (session) => session.agentId === "coordinator",
    );
    expect(coordinator).toBeTruthy();
    const coordinatorTurns = work.facts.turns.filter(
      (turn) => turn.sessionId === coordinator!.id,
    );
    expect(coordinatorTurns.length).toBeGreaterThanOrEqual(1);
    const calls = toolEvidence(work.facts.agentEvents).filter(
      (call) => call.sessionId === coordinator!.id && call.completed,
    );
    expect(
      calls.some((call) => call.output?.details?.tool === "create_goal"),
    ).toBe(true);
    expect(
      calls.some((call) => call.output?.details?.tool === "update_goal"),
    ).toBe(true);
    await testInfo.attach("outcome-facts.json", {
      body: JSON.stringify(work.facts, null, 2),
      contentType: "application/json",
    });
  } finally {
    await launched.cleanup();
  }
});
