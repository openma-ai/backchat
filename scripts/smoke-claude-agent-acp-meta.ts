import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AcpRuntimeImpl } from "../packages/acp/src/runtime.js";
import { NodeSpawner } from "../packages/acp/src/spawners/node.js";

const outDir = resolve("test-results/native-agent-experiments");
const outFile = resolve(outDir, "claude-agent-acp-meta-smoke.json");
const command = process.env.CLAUDE_AGENT_ACP_BIN || resolve("node_modules/.bin/claude-agent-acp");
const cwd = process.env.CLAUDE_AGENT_ACP_CWD || process.cwd();

const diagnostics: string[] = [];
const runtime = new AcpRuntimeImpl(new NodeSpawner());
const session = await runtime.start({
  agent: {
    command,
    cwd,
    env: {
      // Claude Code refuses to launch nested sessions when it sees the parent
      // marker. Backchat's SessionManager applies the same scrub.
      CLAUDECODE: undefined,
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
    "Use a Claude Code native Task/Agent subagent if available. " +
      "The child task is: reply exactly CHILD_OK. " +
      "The parent should report whether a subagent was used.",
  )) {
    events.push(event);
  }
} finally {
  await session.dispose();
}

const metaEvents = events.filter((event) =>
  JSON.stringify(event).includes('"parentToolUseId"') ||
  JSON.stringify(event).includes('"claudeCode"') ||
  JSON.stringify(event).includes('"Task"') ||
  JSON.stringify(event).includes('"Agent"')
);

await mkdir(outDir, { recursive: true });
await writeFile(
  outFile,
  JSON.stringify(
    {
      command,
      cwd,
      acpSessionId: session.acpSessionId,
      supportsSessionFork: session.supportsSessionFork,
      diagnostics,
      eventCount: events.length,
      metaEvents,
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
      metaEventCount: metaEvents.length,
      supportsSessionFork: session.supportsSessionFork,
    },
    null,
    2,
  ),
);
