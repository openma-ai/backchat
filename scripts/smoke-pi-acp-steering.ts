/** Smoke: does Backchat's own ACP runtime negotiate `_session/steering` with a
 *  pi-acp build that carries svkozak/pi-acp#115, and does a live steer land?
 *  Usage: PI_ACP_BIN=/path/to/pi-acp pnpm exec tsx scripts/smoke-pi-acp-steering.ts */
import { AcpRuntimeImpl } from "../packages/acp/src/runtime.js";
import { NodeSpawner } from "../packages/acp/src/spawners/node.js";

const command = process.env.PI_ACP_BIN || "pi-acp";
const cwd = process.env.PI_ACP_CWD || process.cwd();
const diagnostics: string[] = [];
const runtime = new AcpRuntimeImpl(new NodeSpawner());
const session = await runtime.start({
  agent: { command, cwd, onDiagnosticLine: (line) => diagnostics.push(line) },
  idleTimeoutMs: 0,
  perTurnTimeoutMs: 240_000,
  clientCallbacks: {
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  },
});
const out: Record<string, unknown> = {
  command,
  agentInfo: session.agentInfo,
  supportsSteering: session.supportsSteering,
  initializeMeta: session.initializeMeta,
};
try {
  out.idleSteer = await session.steer("idle steer");
  const events: unknown[] = [];
  const run = (async () => {
    for await (const event of session.prompt(
      "Use the bash tool to run `sleep 8`. When it finishes, reply with exactly the single word DONE and nothing else.",
    )) events.push(event);
  })();
  await new Promise((resolve) => setTimeout(resolve, 4000));
  out.liveSteer = await session.steer(
    "Steering update from the user: after DONE, also print the word STEERED on its own line.",
  );
  await run;
  const text = events.map((event) => JSON.stringify(event)).join("\n");
  out.eventCount = events.length;
  out.steeredTextSeen = text.includes("STEERED");
  out.toolCalls = events
    .map((event) => event as { sessionUpdate?: string; title?: string; update?: { sessionUpdate?: string; title?: string } })
    .map((event) => event.update ?? event)
    .filter((update) => update.sessionUpdate === "tool_call")
    .map((update) => update.title);
} catch (error) {
  out.error = error instanceof Error ? error.message : String(error);
} finally {
  await session.dispose();
}
console.log(JSON.stringify(out, null, 1));
