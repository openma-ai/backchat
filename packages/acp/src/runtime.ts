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
    const child = await this.#spawner.spawn(options.agent);
    const id = `acp-${Date.now()}-${nextId++}`;
    const session = new AcpSessionImpl({ child, options, id });
    try {
      await session.init();
    } catch (e) {
      await session.dispose();
      throw e;
    }
    return session;
  }
}
