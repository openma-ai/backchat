/**
 * Phase 2 smoke — drive the SessionManager end-to-end without Electron.
 *
 * Spawns a real claude-agent-acp child via the vendored ACP runtime, runs
 * one short prompt, prints every event that came through the SessionManager's
 * `Sender` callback, then disposes. Verifies that:
 *
 *   1. SessionManager.start spawns the agent and reports session.ready
 *      with an acp_session_id.
 *   2. SessionManager.prompt streams session.event payloads back.
 *   3. session.complete arrives at end of turn.
 *   4. dispose tears down cleanly.
 *
 * Run with: pnpm tsx scripts/smoke-session.ts
 *
 * Exits 0 on success, 1 on any error or missing claude binary.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSessionRoot } from "../src/main/session-cwd.js";
import { SessionManager } from "../src/main/session-manager.js";
import type { SessionEventOut } from "../src/shared/session-events.js";
import { loadRegistry } from "@open-managed-agents-desktop/acp/registry";

const AGENT_ID = process.env.ACP_AGENT ?? "claude-acp";
const PROMPT_TEXT = process.env.ACP_PROMPT ?? "respond with the single word: pong";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "openma-desktop-smoke-"));
  setSessionRoot(join(root, "sessions"));
  await loadRegistry({ cachePath: join(root, "registry-cache.json") }).catch(() => undefined);

  const events: SessionEventOut[] = [];
  let readyResolve: (() => void) | null = null;
  let completeResolve: (() => void) | null = null;
  let errorReject: ((e: Error) => void) | null = null;

  const ready = new Promise<void>((res) => (readyResolve = res));
  const complete = new Promise<void>((res, rej) => {
    completeResolve = res;
    errorReject = rej;
  });

  const manager = new SessionManager({
    send: (msg) => {
      events.push(msg);
      if (msg.type === "session.event") {
        // Print one-liner per ACP event so we see the streaming work.
        const ev = msg.event as { sessionUpdate?: string; type?: string };
        const t = ev?.sessionUpdate ?? ev?.type ?? "?";
        process.stdout.write(`  · ${t}\n`);
      } else {
        process.stdout.write(`[${msg.type}] ${("message" in msg && msg.message) || ""}\n`);
      }
      if (msg.type === "session.ready") readyResolve?.();
      if (msg.type === "session.complete") completeResolve?.();
      if (msg.type === "session.error") {
        // Session-wide errors (no turn_id) are fatal for the smoke test.
        // Per-turn errors might still resolve `complete` afterwards.
        if (!("turn_id" in msg) || !msg.turn_id) {
          errorReject?.(new Error(msg.message));
        }
      }
    },
    resolveMcpServers: () => [],
    buildCallbacks: () => ({}),
  });

  const session_id = `smoke-${Date.now()}`;
  process.stdout.write(`→ start ${AGENT_ID} sid=${session_id}\n`);
  void manager.start({ session_id, agent_id: AGENT_ID });
  await Promise.race([
    ready,
    new Promise<void>((_, rej) =>
      setTimeout(() => rej(new Error("session.ready timeout (10s)")), 10_000),
    ),
  ]);

  const turn_id = `turn-${Date.now()}`;
  process.stdout.write(`→ prompt turn=${turn_id} text=${JSON.stringify(PROMPT_TEXT)}\n`);
  void manager.prompt({ session_id, turn_id, text: PROMPT_TEXT });
  await Promise.race([
    complete,
    new Promise<void>((_, rej) =>
      setTimeout(() => rej(new Error("session.complete timeout (60s)")), 60_000),
    ),
  ]);

  process.stdout.write(`→ dispose\n`);
  await manager.dispose(session_id, { removeCwd: true });
  await rm(root, { recursive: true, force: true });

  process.stdout.write(
    `\nOK: ${events.length} events, ready+complete observed, child disposed.\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
