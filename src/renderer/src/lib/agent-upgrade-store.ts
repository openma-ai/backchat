import { useSyncExternalStore } from "react";

/**
 * In-flight managed-agent upgrades, shared across surfaces.
 *
 * The sidebar control starts the upgrade, but Settings → About also shows
 * the managed-agent half of the combined update status. A module-level
 * registry keeps both surfaces on the same "Upgrading…" line instead of the
 * About page claiming an agent is up to date while npm is still running.
 *
 * The snapshot is cached so `useSyncExternalStore` sees a stable reference
 * between renders.
 */

const upgrading = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: readonly string[] = [];

function publish(): void {
  snapshot = [...upgrading];
  for (const listener of listeners) listener();
}

/**
 * Claim or release an agent upgrade.
 *
 * Returns true when the registry changed. A second claim on the same agent
 * is refused, so a double-click cannot start two npm upgrades at once.
 */
export function markAgentUpgrading(agentId: string, active: boolean): boolean {
  if (active) {
    if (upgrading.has(agentId)) return false;
    upgrading.add(agentId);
  } else {
    if (!upgrading.delete(agentId)) return false;
  }
  publish();
  return true;
}

export function agentUpgradeSnapshot(): readonly string[] {
  return snapshot;
}

export function subscribeAgentUpgrades(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The agent currently being upgraded, or null. */
export function useUpgradingAgentId(): string | null {
  const ids = useSyncExternalStore(
    subscribeAgentUpgrades,
    agentUpgradeSnapshot,
    agentUpgradeSnapshot,
  );
  return ids.length > 0 ? ids[0]! : null;
}

/** Every agent currently being upgraded. */
export function useUpgradingAgentIds(): readonly string[] {
  return useSyncExternalStore(
    subscribeAgentUpgrades,
    agentUpgradeSnapshot,
    agentUpgradeSnapshot,
  );
}
