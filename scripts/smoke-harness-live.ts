import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AcpRuntimeImpl } from "../packages/acp/src/runtime.js";
import { NodeSpawner } from "../packages/acp/src/spawners/node.js";

type HarnessId = "claude" | "codex" | "cursor" | "pi" | "opencode" | "kilo" | "kimi";

const HARNESSES: Record<HarnessId, { command: string; version: string }> = {
  claude: { command: "/Users/xiaoyang/.oma/acp/bin/claude-agent-acp", version: "0.64.2" },
  codex: { command: "/Users/xiaoyang/.oma/acp/bin/codex-acp", version: "1.1.9" },
  cursor: { command: "/Users/xiaoyang/.oma/acp/bin/openma-acp-cursor", version: "2026.07.23" },
  pi: { command: "/Users/xiaoyang/.oma/acp/bin/openma-acp-pi-acp", version: "0.0.33" },
  opencode: { command: "/Users/xiaoyang/.oma/acp/bin/openma-acp-opencode", version: "1.18.12" },
  kilo: { command: "/Users/xiaoyang/.oma/acp/bin/openma-acp-kilo", version: "7.4.19" },
  kimi: { command: "/Users/xiaoyang/.oma/acp/bin/openma-acp-kimi", version: "0.33.0" },
};

const harnessId = process.argv[2] as HarnessId | undefined;
const scenario = process.argv[3] === "native-agent" ? "native-agent" : "final-response";
if (!harnessId || !HARNESSES[harnessId]) {
  throw new Error(`usage: tsx scripts/smoke-harness-live.ts <${Object.keys(HARNESSES).join("|")}>`);
}

const secret = process.env.BACKCHAT_DEEPSEEK_TEST_KEY;
if (harnessId !== "codex" && !secret) {
  throw new Error("BACKCHAT_DEEPSEEK_TEST_KEY is required for non-Codex live harnesses");
}

const endpoint = "https://api.deepseek.com/anthropic";
const model = "deepseek-v4-flash";
const configRoot = resolve("artifacts/harness-live-config");
const traceRoot = resolve("artifacts/harness-feature-matrix-staging/live-traces");
const diagnostics: string[] = [];
const prompt = scenario === "native-agent"
  ? "Use exactly one native subagent to reply exactly CHILD_OK. Then reply exactly PARENT_OK: CHILD_OK."
  : "Reply with exactly BACKCHAT_HARNESS_LIVE_OK and nothing else.";

function childEnv(): Record<string, string | undefined> {
  if (harnessId === "codex") {
    return {
      CODEX_PATH: process.env.CODEX_PATH ?? "/opt/homebrew/bin/codex",
      INITIAL_AGENT_MODE: "agent",
    };
  }
  if (harnessId === "claude") {
    return {
      CLAUDECODE: undefined,
      ANTHROPIC_BASE_URL: endpoint,
      ANTHROPIC_API_KEY: secret,
      ANTHROPIC_AUTH_TOKEN: secret,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      CLAUDE_CODE_SUBAGENT_MODEL: model,
    };
  }
  if (harnessId === "kimi") {
    return {
      KIMI_CODE_HOME: resolve(configRoot, "kimi-code-home"),
      KIMI_DISABLE_TELEMETRY: "1",
      KIMI_CODE_NO_AUTO_UPDATE: "1",
      KIMI_LOG_LEVEL: "warn",
      KIMI_MODEL_NAME: model,
      KIMI_MODEL_DISPLAY_NAME: "DeepSeek V4 Flash",
      KIMI_MODEL_PROVIDER_TYPE: "anthropic",
      KIMI_MODEL_BASE_URL: endpoint,
      KIMI_MODEL_API_KEY: secret,
      KIMI_MODEL_MAX_CONTEXT_SIZE: "1000000",
      KIMI_MODEL_MAX_OUTPUT_SIZE: "384000",
      KIMI_MODEL_CAPABILITIES: "thinking",
    };
  }
  if (harnessId === "pi") {
    return {
      PI_CODING_AGENT_DIR: resolve(configRoot, "pi"),
      PI_ACP_PI_COMMAND: "/Users/xiaoyang/.oma/acp/runtime/pi/node_modules/.bin/pi",
      BACKCHAT_DEEPSEEK_API_KEY: secret,
    };
  }
  if (harnessId === "opencode") {
    return {
      OPENCODE_CONFIG: resolve(configRoot, "opencode.json"),
      BACKCHAT_DEEPSEEK_API_KEY: secret,
    };
  }
  if (harnessId === "kilo") {
    return {
      KILO_CONFIG: resolve(configRoot, "kilo.json"),
      OPENCODE_CONFIG: resolve(configRoot, "kilo.json"),
      BACKCHAT_DEEPSEEK_API_KEY: secret,
    };
  }
  return {
    CURSOR_API_ENDPOINT: endpoint,
    CURSOR_API_KEY: secret,
  };
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return secret ? value.replaceAll(secret, "[REDACTED]") : value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, next]) => {
    if (/api[-_]?key|authorization|auth[-_]?token|secret/i.test(key)) {
      return [key, "[REDACTED]"];
    }
    return [key, sanitize(next)];
  }));
}

function visibleAssistantText(events: unknown[]): string {
  const chunks: string[] = [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    const update = record.sessionUpdate === "agent_message_chunk"
      ? record
      : record.update && typeof record.update === "object"
        ? record.update as Record<string, unknown>
        : null;
    if (update?.sessionUpdate !== "agent_message_chunk") continue;
    const content = update.content;
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const text = (content as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("");
}

await mkdir(traceRoot, { recursive: true });
await mkdir(resolve(configRoot, "kimi-code-home"), { recursive: true });
const runtime = new AcpRuntimeImpl(new NodeSpawner());
const harness = HARNESSES[harnessId];
const startedAt = new Date().toISOString();
const startResult = await runtime.start({
  agent: {
    command: harness.command,
    // The managed Cursor shim already invokes `cursor-agent acp`. The
    // installed ACP subcommand does not accept the global --model option.
    args: undefined,
    cwd: process.cwd(),
    env: childEnv(),
    onDiagnosticLine: (line) => diagnostics.push(line),
  },
  idleTimeoutMs: 0,
  perTurnTimeoutMs: 180_000,
  clientCallbacks: {
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  },
}).then(
  (session) => ({ session }),
  (error: unknown) => ({ error }),
);

if ("error" in startResult) {
  const failure = startResult.error instanceof Error
    ? startResult.error.message
    : String(startResult.error);
  const outFile = resolve(traceRoot, `${harnessId}-${scenario}.json`);
  const summary = sanitize({
    harness: harnessId,
    harnessVersion: harness.version,
    verificationMode: "live",
    provider: harnessId === "codex" ? "Codex default" : "DeepSeek Anthropic",
    endpoint: harnessId === "codex" ? null : endpoint,
    model: harnessId === "codex" ? null : model,
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: false,
    scenario,
    finalText: "",
    failure,
    diagnostics,
    events: [],
  });
  await writeFile(outFile, JSON.stringify(summary, null, 2), "utf8");
  process.stdout.write(JSON.stringify(sanitize({
    harness: harnessId,
    version: harness.version,
    passed: false,
    finalText: "",
    failure,
    eventCount: 0,
    outFile,
  }), null, 2) + "\n");
  process.exit(1);
}

const { session } = startResult;

const events: unknown[] = [];
let failure: string | null = null;
try {
  for await (const event of session.prompt(
    prompt,
  )) {
    events.push(event);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  await session.dispose();
}

const text = visibleAssistantText(events);
const serializedEvents = JSON.stringify(events);
const nativeSignal = scenario === "native-agent" && (
  /parentToolUseId|claudeCode/.test(serializedEvents)
  || /receiverThreadIds|agentsStates|codex\.subagent|collaboration/i.test(serializedEvents)
);
const passed = failure === null && (
  scenario === "native-agent"
    ? text.includes("CHILD_OK") && nativeSignal
    : text.includes("BACKCHAT_HARNESS_LIVE_OK")
);
const trace = sanitize({
  harness: harnessId,
  harnessVersion: harness.version,
  verificationMode: "live",
  provider: harnessId === "codex" ? "Codex default" : "DeepSeek Anthropic",
  endpoint: harnessId === "codex" ? null : endpoint,
  model: harnessId === "codex" ? null : model,
  startedAt,
  finishedAt: new Date().toISOString(),
  acpSessionId: session.acpSessionId,
  supportsSessionFork: session.supportsSessionFork,
  passed,
  scenario,
  nativeSignal,
  finalText: text,
  failure,
  diagnostics,
  events,
});
const outFile = resolve(traceRoot, `${harnessId}-${scenario}.json`);
await writeFile(outFile, JSON.stringify(trace, null, 2), "utf8");
process.stdout.write(JSON.stringify(sanitize({
  harness: harnessId,
  version: harness.version,
  passed,
  finalText: text,
  failure,
  eventCount: events.length,
  outFile,
}), null, 2) + "\n");
if (!passed) process.exitCode = 1;
