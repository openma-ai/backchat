/** Live ACP v1 RFD smoke. Runs the selected real adapter, never fakes child output. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AcpRuntimeImpl } from "../packages/acp/src/runtime.js";
import { NodeSpawner } from "../packages/acp/src/spawners/node.js";

const command = process.argv[2] ?? resolve("node_modules/.bin/claude-agent-acp");
const events: unknown[] = [];
const diagnostics: string[] = [];
let failure: string | undefined;
let session: Awaited<ReturnType<AcpRuntimeImpl["start"]>> | undefined;
try {
session = await new AcpRuntimeImpl(new NodeSpawner()).start({
  agent: { command, cwd: process.cwd(), env: { CLAUDECODE: undefined },
    onDiagnosticLine: (line) => diagnostics.push(line) },
  clientCapabilityOverlay: { subagents: {} },
  perTurnTimeoutMs: 90_000,
  clientCallbacks: { requestPermission: async () => ({ outcome: { outcome: "cancelled" } }) },
});
  for await (const event of session.prompt("Use exactly one native subagent. Its task: reply exactly CHILD_RFD_OK without tools. After it finishes reply PARENT_RFD_OK.")) events.push(event);
} catch (error) { failure = error instanceof Error ? error.message + " " + JSON.stringify((error as { data?: unknown }).data) : String(error); }
finally { await session?.dispose(); }
const updates = events as Array<Record<string, unknown>>;
const associations = updates.filter((event) => event.sessionUpdate === "subagent_update");
const children = new Set(associations.map((event) => event.sessionId));
const childOutput = updates.filter((event) => {
  const context = event["_openma.acp.notification"] as { session_id?: string } | undefined;
  return children.has(context?.session_id) && (event.sessionUpdate === "agent_message_chunk" || event.sessionUpdate === "session_message");
});
const passed = associations.length > 0 && childOutput.length > 0 && associations.some((event) => (event.state as { state?: string } | undefined)?.state === "idle");
await mkdir("test-results/native-agent-experiments", { recursive: true });
const path = "test-results/native-agent-experiments/rfd-live.json";
await writeFile(path, JSON.stringify({ command, passed, failure, associations: associations.length, childOutput: childOutput.length, events, diagnostics }, null, 2));
console.log(JSON.stringify({ passed, associations: associations.length, childOutput: childOutput.length, path }));
if (!passed) process.exitCode = 1;
