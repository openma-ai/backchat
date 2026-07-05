import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AcpRuntimeImpl } from "../packages/acp/src/runtime.js";
import { NodeSpawner } from "../packages/acp/src/spawners/node.js";

const outDir = resolve("test-results/native-agent-experiments");
const outFile = resolve(outDir, "claude-agent-acp-fork-smoke.json");
const command = process.env.CLAUDE_AGENT_ACP_BIN || resolve("node_modules/.bin/claude-agent-acp");
const cwd = process.env.CLAUDE_AGENT_ACP_CWD || process.cwd();
const token = `BACKCHAT_FORK_TOKEN_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const diagnostics: string[] = [];
const runtime = new AcpRuntimeImpl(new NodeSpawner());

function options(forkFromAcpSessionId?: string) {
  return {
    agent: {
      command,
      cwd,
      env: { CLAUDECODE: undefined },
      onDiagnosticLine: (line: string) => diagnostics.push(line),
    },
    idleTimeoutMs: 0,
    perTurnTimeoutMs: 120_000,
    forkFromAcpSessionId,
    clientCallbacks: {
      requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
    },
  };
}

async function collect(session: Awaited<ReturnType<AcpRuntimeImpl["start"]>>, prompt: string) {
  const events: unknown[] = [];
  for await (const event of session.prompt(prompt)) events.push(event);
  return events;
}

function eventText(events: unknown[]): string {
  return events
    .map((event) => {
      if (!event || typeof event !== "object") return "";
      const content = (event as { content?: { text?: unknown } }).content;
      return typeof content?.text === "string" ? content.text : "";
    })
    .join("");
}

const parent = await runtime.start(options());
let child: Awaited<ReturnType<AcpRuntimeImpl["start"]>> | undefined;
let parentEvents: unknown[] = [];
let childEvents: unknown[] = [];

try {
  parentEvents = await collect(
    parent,
    `Remember this exact token for this conversation: ${token}. Reply "remembered".`,
  );
  child = await runtime.start(options(parent.acpSessionId));
  childEvents = await collect(
    child,
    "What exact token did I ask you to remember? Reply with only the token.",
  );
} finally {
  if (child) await child.dispose();
  await parent.dispose();
}

const childText = eventText(childEvents);
await mkdir(outDir, { recursive: true });
await writeFile(
  outFile,
  JSON.stringify(
    {
      command,
      cwd,
      token,
      parentAcpSessionId: parent.acpSessionId,
      childAcpSessionId: child?.acpSessionId,
      parentSupportsSessionFork: parent.supportsSessionFork,
      childSupportsSessionFork: child?.supportsSessionFork,
      childMentionedToken: childText.includes(token),
      childText,
      diagnostics,
      parentEvents,
      childEvents,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      outFile,
      token,
      parentSupportsSessionFork: parent.supportsSessionFork,
      childSupportsSessionFork: child?.supportsSessionFork,
      childMentionedToken: childText.includes(token),
    },
    null,
    2,
  ),
);
