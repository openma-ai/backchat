/**
 * AcpRuntime — the only public factory. Holds a Spawner, hands out AcpSessions.
 * Vendored from @open-managed-agents/acp-runtime (Apache-2.0). Verbatim.
 */

import { AcpSessionImpl } from "./session.js";
import type { AcpRuntime, AcpSession, SessionOptions, Spawner } from "./types.js";

let nextId = 1;

export class AcpRuntimeImpl implements AcpRuntime {
  #spawner: Spawner;

  constructor(spawner: Spawner) {
    this.#spawner = spawner;
  }

  async start(options: SessionOptions): Promise<AcpSession> {
    const startedAt = Date.now();
    const id = `acp-${startedAt}-${nextId++}`;
    const child = await this.#spawner.spawn(options.agent);
    const spawnedAt = Date.now();
    const session = new AcpSessionImpl({ child, options, id });
    try {
      await session.init();
      if (process.env.NODE_ENV !== "test") {
        process.stderr.write(
          `[acp-runtime] id=${id} command=${options.agent.command} spawn_ms=${spawnedAt - startedAt} init_ms=${Date.now() - spawnedAt} total_ms=${Date.now() - startedAt}\n`,
        );
      }
    } catch (e) {
      await session.dispose();
      throw e;
    }
    return session;
  }
}
