import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getKnownAgents, type KnownAgentEntry } from "@open-managed-agents-desktop/acp/registry";
import {
  OPENMA_NPM_HARNESS_IDS,
  readAcpHarnessInstallState,
} from "@openma/common/acp-harnesses/installer";
import type { AcpAgentSetupService } from "./index.js";

/** Background re-check for @openma/* self-hosted harness npm `latest` dist-tags. */
export const OPENMA_NPM_HARNESS_UPGRADE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type OpenMaHarnessUpgradeTrigger = "startup" | "periodic";

export type OpenMaHarnessUpgradeOutcome =
  | { agentId: string; action: "skipped"; reason: "not-installed" | "up-to-date" | "latest-unavailable" | "not-managed" }
  | { agentId: string; action: "upgraded"; fromVersion: string; toVersion: string }
  | { agentId: string; action: "failed"; fromVersion?: string; toVersion?: string; error: string };

export type OpenMaHarnessUpgradeLogEvent =
  | { kind: "check-started"; trigger: OpenMaHarnessUpgradeTrigger }
  | { kind: "check-settled"; trigger: OpenMaHarnessUpgradeTrigger; outcomes: OpenMaHarnessUpgradeOutcome[] }
  | { kind: "version-changed"; agentId: string; fromVersion: string; toVersion: string; trigger: OpenMaHarnessUpgradeTrigger };

export interface OpenMaNpmHarnessUpgradeDeps {
  acpBinDir: string;
  acpInstallRoot: string;
  fetchImpl?: typeof fetch;
  npmRegistryUrls?: string[];
  catalogEntries?: () => readonly KnownAgentEntry[];
}

export interface StartOpenMaNpmHarnessAutoUpdaterOptions extends OpenMaNpmHarnessUpgradeDeps {
  disabled?: boolean;
  intervalMs?: number;
  onEvent?: (event: OpenMaHarnessUpgradeLogEvent) => void;
}

let upgradeCheckInflight: Promise<OpenMaHarnessUpgradeOutcome[]> | null = null;

export async function runOpenMaNpmHarnessUpgradeCheck(
  service: Pick<AcpAgentSetupService, "upgradeAgent">,
  deps: OpenMaNpmHarnessUpgradeDeps,
  trigger: OpenMaHarnessUpgradeTrigger,
  onEvent?: (event: OpenMaHarnessUpgradeLogEvent) => void,
): Promise<OpenMaHarnessUpgradeOutcome[]> {
  if (upgradeCheckInflight) {
    return upgradeCheckInflight;
  }
  const run = async (): Promise<OpenMaHarnessUpgradeOutcome[]> => {
    onEvent?.({ kind: "check-started", trigger });
    const outcomes: OpenMaHarnessUpgradeOutcome[] = [];
    const entries = (deps.catalogEntries?.() ?? getKnownAgents()).filter(
      (entry) => OPENMA_NPM_HARNESS_IDS.has(entry.registryId ?? entry.id),
    );
    await Promise.all(entries.map(async (entry) => {
      const outcome = await upgradeHarnessIfNeeded(service, deps, entry, trigger, onEvent);
      outcomes.push(outcome);
    }));
    onEvent?.({ kind: "check-settled", trigger, outcomes });
    return outcomes;
  };
  upgradeCheckInflight = run().finally(() => {
    upgradeCheckInflight = null;
  });
  return upgradeCheckInflight;
}

export function startOpenMaNpmHarnessAutoUpdater(
  service: Pick<AcpAgentSetupService, "upgradeAgent">,
  options: StartOpenMaNpmHarnessAutoUpdaterOptions,
): () => void {
  if (options.disabled) {
    return () => undefined;
  }
  const intervalMs = options.intervalMs ?? OPENMA_NPM_HARNESS_UPGRADE_CHECK_INTERVAL_MS;
  const { onEvent, ...deps } = options;
  void runOpenMaNpmHarnessUpgradeCheck(service, deps, "startup", onEvent);
  const timer = setInterval(() => {
    void runOpenMaNpmHarnessUpgradeCheck(service, deps, "periodic", onEvent);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function upgradeHarnessIfNeeded(
  service: Pick<AcpAgentSetupService, "upgradeAgent">,
  deps: OpenMaNpmHarnessUpgradeDeps,
  entry: KnownAgentEntry,
  trigger: OpenMaHarnessUpgradeTrigger,
  onEvent?: (event: OpenMaHarnessUpgradeLogEvent) => void,
): Promise<OpenMaHarnessUpgradeOutcome> {
  const agentId = entry.id;
  if (entry.installSource !== "registry" || !entry.registryId) {
    return { agentId, action: "skipped", reason: "not-managed" };
  }
  const installState = await readAcpHarnessInstallState({
    entry,
    binDir: deps.acpBinDir,
    installRoot: deps.acpInstallRoot,
    fetchImpl: deps.fetchImpl,
    npmRegistryUrls: deps.npmRegistryUrls,
  });
  if (!installState.installed) {
    return { agentId, action: "skipped", reason: "not-installed" };
  }
  if (!installState.updateAvailable) {
    return { agentId, action: "skipped", reason: "up-to-date" };
  }
  const toVersion = installState.latestVersion;
  if (!toVersion) {
    return { agentId, action: "skipped", reason: "latest-unavailable" };
  }
  const fromVersion = installState.installedVersion ?? "unknown";
  try {
    await service.upgradeAgent(agentId);
    await recordHarnessRollbackMetadata(deps.acpInstallRoot, entry.registryId, fromVersion);
    onEvent?.({
      kind: "version-changed",
      agentId,
      fromVersion,
      toVersion,
      trigger,
    });
    return { agentId, action: "upgraded", fromVersion, toVersion };
  } catch (error) {
    return {
      agentId,
      action: "failed",
      fromVersion,
      toVersion,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function recordHarnessRollbackMetadata(
  installRoot: string,
  registryId: string,
  previousVersion: string,
): Promise<void> {
  const metadataPath = join(
    installRoot,
    "registry",
    registryId.replace(/[^a-zA-Z0-9._-]/g, "-"),
    "install.json",
  );
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    if (typeof parsed.version === "string" && parsed.version !== previousVersion) {
      parsed.previousVersion = previousVersion;
      await writeFile(metadataPath, JSON.stringify(parsed, null, 2), "utf8");
    }
  } catch {
    // Best-effort rollback hint; versioned install dirs remain on disk.
  }
}

/** @internal Reset mutex between vitest cases. */
export function _resetOpenMaNpmHarnessUpgradeCheck(): void {
  upgradeCheckInflight = null;
}
