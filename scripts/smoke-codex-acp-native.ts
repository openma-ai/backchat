import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AcpRuntimeImpl } from "../packages/acp/src/runtime.js";
import { NodeSpawner } from "../packages/acp/src/spawners/node.js";

const outDir = resolve("test-results/native-agent-experiments");
const outFile = resolve(outDir, "codex-acp-native-smoke.json");
const command = process.env.CODEX_ACP_BIN || resolve("node_modules/.bin/codex-acp");
const cwd = process.env.CODEX_ACP_CWD || process.cwd();
const codexPath = process.env.CODEX_PATH || "/Applications/Codex.app/Contents/Resources/codex";

const diagnostics: string[] = [];
const runtime = new AcpRuntimeImpl(new NodeSpawner());
const session = await runtime.start({
  agent: {
    command,
    cwd,
    env: {
      CODEX_PATH: codexPath,
      INITIAL_AGENT_MODE: process.env.INITIAL_AGENT_MODE || "agent",
    },
    onDiagnosticLine: (line) => diagnostics.push(line),
  },
  idleTimeoutMs: 0,
  perTurnTimeoutMs: 120_000,
  clientCallbacks: {
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  },
});

const events: unknown[] = [];
try {
  for await (const event of session.prompt(
    "Use a Codex native subagent if available. " +
      "The child task is: reply exactly CHILD_OK. " +
      "The parent should report whether a subagent was used and include the child result.",
  )) {
    events.push(event);
  }
} finally {
  await session.dispose();
}

const childIds = new Set<string>();
const childMessages = new Set<string>();
const titles = new Set<string>();

function visit(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visit(item);
    return;
  }

  const record = value as Record<string, unknown>;
  const title = record.title;
  if (typeof title === "string") titles.add(title);

  const receiverThreadIds = record.receiverThreadIds ?? record.receiver_thread_ids;
  if (Array.isArray(receiverThreadIds)) {
    for (const id of receiverThreadIds) {
      if (typeof id === "string") childIds.add(id);
    }
  }

  const agentsStates = record.agentsStates ?? record.agents_states;
  if (agentsStates && typeof agentsStates === "object" && !Array.isArray(agentsStates)) {
    for (const [id, state] of Object.entries(agentsStates as Record<string, unknown>)) {
      childIds.add(id);
      if (state && typeof state === "object") {
        const message = (state as { message?: unknown }).message;
        if (typeof message === "string") childMessages.add(message);
      }
    }
  }

  for (const next of Object.values(record)) visit(next);
}

for (const event of events) visit(event);

const serializedEvents = JSON.stringify(events);
await mkdir(outDir, { recursive: true });
await writeFile(
  outFile,
  JSON.stringify(
    {
      command,
      cwd,
      codexPath,
      acpSessionId: session.acpSessionId,
      supportsSessionFork: session.supportsSessionFork,
      diagnostics,
      eventCount: events.length,
      titles: [...titles],
      childIds: [...childIds],
      childMessages: [...childMessages],
      childResultOk: serializedEvents.includes("CHILD_OK"),
      events,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      outFile,
      eventCount: events.length,
      supportsSessionFork: session.supportsSessionFork,
      titles: [...titles],
      childIds: [...childIds],
      childMessages: [...childMessages],
      childResultOk: serializedEvents.includes("CHILD_OK"),
    },
    null,
    2,
  ),
);
