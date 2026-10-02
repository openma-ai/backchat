import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "@playwright/test";

const repo = resolve(import.meta.dirname, "..");
const home = join(tmpdir(), "backchat-evidence-home");
const shots = join(tmpdir(), "pr-27-28");
const logPath = join(shots, "cli-log.txt");
const lines = [];

function log(text) {
  const block = String(text).replace(/\s+$/, "");
  lines.push(block);
  process.stdout.write(`${block}\n`);
}

function cli(args, timeout = 60_000, client = "cursor killer") {
  log(`\n$ backchat ${args.join(" ")}`);
  let result;
  try {
    const env = {
      ...process.env,
      BACKCHAT_TEST_HOOKS: "1",
      BACKCHAT_HOME: home,
    };
    if (client) env.BACKCHAT_CLIENT = client;
    result = spawnSync(process.execPath, [join(repo, "src/cli/backchat.mjs"), ...args], {
      env,
      encoding: "utf8",
      timeout,
    });
  } catch (error) {
    log(`spawn failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 1, stdout: "", stderr: String(error) };
  }
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  if (stdout) log(stdout);
  if (stderr) log(`stderr: ${stderr}`);
  log(`exit: ${result.status}`);
  return { status: result.status ?? 1, stdout, stderr };
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

async function makeRepo(root, name, file) {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  git(path, ["init", "-b", "main"]);
  git(path, ["config", "user.email", "evidence@example.test"]);
  git(path, ["config", "user.name", "Evidence"]);
  await writeFile(join(path, file), `${name}\n`);
  git(path, ["add", "."]);
  git(path, ["commit", "-m", "init"]);
  return path;
}

await rm(home, { recursive: true, force: true });
await mkdir(shots, { recursive: true });
await mkdir(home, { recursive: true });

log("# app not running");
cli(["project", "list", "--json"]);

const sourceRoot = join(home, "sources");
const appRepo = await makeRepo(sourceRoot, "minimaxhub_benchmark", "README.md");
const agentRepo = await makeRepo(sourceRoot, "hilo-agent-opencode", "README.md");

const app = await electron.launch({
  args: ["--no-sandbox", "--disable-gpu", join(repo, "out/main/index.js")],
  env: {
    ...process.env,
    BACKCHAT_TEST_HOOKS: "1",
    BACKCHAT_E2E_VISIBLE: "1",
    BACKCHAT_E2E_SKIP_AGENT_WARMUP: "1",
    BACKCHAT_HOME: home,
    NODE_ENV: "test",
  },
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByTestId("new-chat-button").waitFor({ timeout: 30_000 });
const fakeAgent = join(repo, "e2e/fixtures/fake-acp-agent.mjs");
await page.evaluate(async ({ nodePath, agentPath }) => {
  const current = await window.backchat.settingsGet();
  await window.backchat.settingsPatch({
    appearance: { ...current.appearance, language: "en" },
    agents: [{
      id: "fake-cli",
      enabled: true,
      command_override: nodePath,
      args_override: [agentPath],
      env: [{ name: "BACKCHAT_FAKE_SHORT_REPLY", value: "1" }],
    }],
  });
}, { nodePath: process.execPath, agentPath: fakeAgent });

log("\n# socket mode");
const stat = spawnSync("stat", ["-c", "%a %n", join(home, "control.sock")], { encoding: "utf8" });
log(`$ stat -c '%a %n' ${join(home, "control.sock")}`);
log((stat.stdout || stat.stderr).trim());
log(`exit: ${stat.status}`);

log("\n# not found");
cli(["session", "status", "sess-missing", "--json"]);

log("\n# project and workspace");
const created = cli([
  "project", "create", "--json",
  "--name", "hilo",
  "--source", appRepo,
  "--source", agentRepo,
]);
const project = JSON.parse(created.stdout);
const workspace = cli([
  "workspace", "create", "--json",
  "--project", project.id,
  "--branch", "feature/coord",
  "--base", "main",
]);
const workspaceInfo = JSON.parse(workspace.stdout);
cli(["workspace", "show", workspaceInfo.id, "--json"]);

log("\n# session");
const started = cli([
  "session", "start", "--json",
  "--workspace", workspaceInfo.id,
  "--agent", "fake-cli",
  "--approve", "ask",
]);
if (started.status !== 0) throw new Error(`session start failed: ${started.stdout}`);
const session = JSON.parse(started.stdout);
if (session.additional_directories?.length) {
  throw new Error(`fake agent without additionalDirectories should collapse roots, got ${JSON.stringify(session.additional_directories)}`);
}
if (session.cwd.includes("/01-") || session.cwd.includes("/02-")) {
  throw new Error(`cwd is still one repository: ${session.cwd}`);
}
log(`fallback cwd (fake agent, additionalDirectories off): ${session.cwd}`);
const streamed = cli([
  "session", "send", session.session_id, "EVIDENCE_HELLO",
  "--stream", "--timeout", "20",
]);
cli(["session", "transcript", session.session_id, "--json"]);
const transcript = JSON.parse(cli([
  "session", "transcript", session.session_id, "--since", "1", "--json",
]).stdout);
log(`transcript --since 1 events: ${transcript.events?.length ?? "n/a"}`);

log("\n# timeout");
const timeoutSession = cli([
  "session", "start", "--json",
  "--workspace", workspaceInfo.id,
  "--agent", "fake-cli",
]);
if (timeoutSession.status !== 0) throw new Error(`timeout session start failed: ${timeoutSession.stdout}`);
const timeoutId = JSON.parse(timeoutSession.stdout).session_id;
cli([
  "session", "send", timeoutId, "stall-until-cancelled-e2e",
  "--wait", "--timeout", "2", "--json",
]);

log("\n# pending / respond");
const permission = spawnSync(process.execPath, [
  join(repo, "src/cli/backchat.mjs"),
  "session", "send", session.session_id, "approve-workspace-artifact-e2e",
  "--json",
], {
  env: {
    ...process.env,
    BACKCHAT_TEST_HOOKS: "1",
    BACKCHAT_HOME: home,
    BACKCHAT_CLIENT: "cursor killer",
  },
  encoding: "utf8",
  timeout: 3_000,
});
log(`\n$ backchat session send ${session.session_id} approve-workspace-artifact-e2e --json`);
log(`spawn status: ${permission.status} signal: ${permission.signal ?? ""}`);
log((permission.stdout || permission.stderr || "").trim().slice(0, 500));
let requestId = "";
for (let attempt = 0; attempt < 20; attempt += 1) {
  const pending = cli(["session", "pending", session.session_id, "--json"]);
  const body = JSON.parse(pending.stdout);
  if (body.requests?.length) {
    requestId = body.requests[0].id;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (requestId) cli(["session", "respond", session.session_id, requestId, "write:once", "--json"]);

log("\n# built-in work, no client");
await page.evaluate(async (projectId) => {
  await window.backchat.projectWorkSave({
    projectId,
    description: "Evidence project",
    instructions: "Reply briefly.",
    context: "",
    resources: [],
    coordinatorAgent: "fake-cli",
    workerAgent: "fake-cli",
    continuity: "per-scope",
    controls: ["delegate", "steer", "cancel", "complete"],
    execution: { kind: "local" },
  });
}, project.id);
const builtinWork = cli([
  "work", "submit", "--json",
  "--project", project.id,
  "--type", "message",
  "--text", "Hello from the built-in coordinator",
], 60_000, "");
log(`builtin routed: ${builtinWork.stdout}`);

log("\n# external work on the configured project");
cli([
  "work", "submit", "--json",
  "--project", project.id,
  "--type", "delegate",
  "--worker", "review-1",
  "--text", "Review the branch",
]);

log("\n# fresh project, no built-in setup");
const freshRoot = await makeRepo(sourceRoot, "fresh-notes", "notes.txt");
const freshCreated = cli([
  "project", "create", "--json",
  "--name", "fresh",
  "--source", freshRoot,
]);
const fresh = JSON.parse(freshCreated.stdout);
const freshWork = cli([
  "work", "submit", "--json",
  "--project", fresh.id,
  "--text", "Fresh task without coordinator setup",
]);
if (freshWork.status !== 0) throw new Error(`fresh work submit failed: ${freshWork.stdout}`);
const freshView = JSON.parse(cli(["work", "view", "--project", fresh.id, "--json"]).stdout);
log(`fresh config: ${freshView.config ? "configured" : "none"}`);
log(`fresh tasks: ${JSON.stringify(freshView.external_tasks ?? [])}`);
if (freshView.config?.coordinatorAgent) throw new Error("fresh project should not have a built-in coordinator");
if (!freshView.external_tasks?.some((task) => task.text.includes("Fresh task"))) {
  throw new Error("fresh project did not record the external task");
}

await page.reload();
await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
const navigation = page.getByRole("navigation");
const projectButton = navigation.getByRole("button", { name: /hilo/ }).first();
await projectButton.waitFor({ timeout: 15_000 });
if ((await projectButton.getAttribute("aria-expanded")) !== "true") await projectButton.click();
const hiloItem = projectButton.locator("xpath=ancestor::li[1]");
const sessionButton = hiloItem.getByRole("button", { name: "EVIDENCE_HELLO", exact: true });
try {
  await hiloItem.getByTestId("project-coordinator-row").waitFor({ timeout: 15_000 });
  await sessionButton.waitFor({ timeout: 15_000 });
  await hiloItem.getByLabel("Started by cursor killer").first().waitFor({ timeout: 15_000 });
  const freshToggle = navigation.getByRole("button", { name: /fresh/ }).first();
  if (await freshToggle.count() && (await freshToggle.getAttribute("aria-expanded")) !== "true") {
    await freshToggle.click();
  }
} catch (error) {
  await page.screenshot({ path: join(shots, "sidebar-debug.png") });
  log(`sidebar text: ${await navigation.innerText().catch(() => "")}`);
  throw error;
}
await page.screenshot({ path: join(shots, "sidebar-cli-session.png") });
await sessionButton.click();
await page.getByText(/\[fake agent\] ok:/).first().waitFor({ timeout: 15_000 });
await page.locator("[data-testid=external-source-badge]:visible").first().waitFor({ timeout: 10_000 });
await page.screenshot({ path: join(shots, "session-title-and-badge.png") });

await hiloItem.getByTestId("project-coordinator-row").click();
await page.getByText("[fake agent] ok:").first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Tasks" }).click();
const threads = page.getByLabel("Threads");
await threads.getByText("Review the branch").waitFor({ timeout: 15_000 });
await threads.getByLabel("Started by cursor killer").waitFor({ timeout: 15_000 });
await page.screenshot({ path: join(shots, "project-builtin-hilo.png") });

const freshButton = navigation.getByRole("button", { name: /fresh/ }).first();
await freshButton.waitFor({ timeout: 15_000 });
if ((await freshButton.getAttribute("aria-expanded")) !== "true") await freshButton.click();
const freshItem = freshButton.locator("xpath=ancestor::li[1]");
await freshItem.getByTestId("project-coordinator-row").click();
await page.getByRole("button", { name: "Set up coordinator" }).waitFor({ timeout: 15_000 });
await page.getByRole("button", { name: "Tasks" }).click();
await page.getByLabel("Threads").getByText("Fresh task without coordinator setup").waitFor({ timeout: 15_000 });
await page.getByLabel("Threads").getByLabel("Started by cursor killer").waitFor({ timeout: 15_000 });
await page.screenshot({ path: join(shots, "fresh-no-builtin-setup.png") });

await writeFile(logPath, `${lines.join("\n")}\n`);
await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
await app.close().catch(() => undefined);
log(`\nscreenshots: ${shots}`);
