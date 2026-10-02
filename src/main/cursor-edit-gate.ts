import type { SessionPermissionPolicy } from "./permission-policy.js";

/**
 * Cursor's edit tool writes the file itself. It does not send
 * `session/request_permission` and it does not call `fs/write_text_file`,
 * whatever `clientCapabilities.fs` is. The only client-settable knobs are
 * the advertised modes (`agent`, `plan`, `ask`) and `configOptions`
 * (`mode`, `model`). `plan` and `ask` do not write files. This gate switches
 * to one of those modes before the first prompt.
 *
 * It does not write `.cursor/cli.json`. A deny `Write(**)` rule would also
 * block edits, but it would leave a config file in the user's checkout.
 */

export type CursorPermissionMode = "ask" | "auto" | "read_only";

const SAFE_MODES = ["ask", "plan"] as const;

export interface CursorEditSession {
  modes: {
    currentModeId: string;
    availableModes: ReadonlyArray<{ id: string }>;
  } | null;
  configOptions: ReadonlyArray<{
    id: string;
    type?: string;
    currentValue?: unknown;
    options?: unknown;
  }>;
  setMode(modeId: string): Promise<void>;
  setConfigOption(configId: string, value: string | boolean): Promise<readonly unknown[]>;
}

export type CursorEditGate =
  | { action: "allow" }
  | { action: "restricted"; mode: string }
  | { action: "blocked"; message: string };

export function isCursorHarness(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  return normalized === "cursor" || normalized === "cursor-acp" || normalized.includes("cursor");
}

/** Direct disk edits are allowed only when this session explicitly opts in. */
export function cursorMayEditDirectly(input: {
  policy?: SessionPermissionPolicy;
  permissionMode?: CursorPermissionMode;
}): boolean {
  if (input.permissionMode === "read_only") return false;
  if (input.policy === "ask" || input.policy === "auto-read") return false;
  if (input.policy === "auto-all") return true;
  return input.permissionMode === "auto";
}

export async function restrictCursorEdits(
  session: CursorEditSession,
  input: {
    agentId: string;
    policy?: SessionPermissionPolicy;
    permissionMode?: CursorPermissionMode;
  },
): Promise<CursorEditGate> {
  if (!isCursorHarness(input.agentId) || cursorMayEditDirectly(input)) {
    return { action: "allow" };
  }
  const advertised = advertisedModeIds(session);
  const target = SAFE_MODES.find((mode) => advertised.has(mode));
  if (!target) {
    return {
      action: "blocked",
      message: "Cursor writes files directly in agent mode and does not ask before an edit. This session requires approval, and Cursor did not advertise plan or ask mode, so Backchat did not start it. Pass --approve auto-all, or set permission mode to auto, to opt into those direct edits.",
    };
  }
  let applied = false;
  if (session.modes?.availableModes.some((mode) => mode.id === target)) {
    await session.setMode(target);
    applied = session.modes?.currentModeId === target;
  }
  if (configLists(session, target)) {
    try {
      await session.setConfigOption("mode", target);
      applied = applied || currentModeOption(session) === target;
    } catch {
      // session/set_mode is enough when it actually changed the mode.
    }
  }
  if (!applied) {
    return {
      action: "blocked",
      message: "Cursor stayed in a mode that writes files directly. Backchat did not start the session. Pass --approve auto-all, or set permission mode to auto, to opt into those direct edits.",
    };
  }
  return { action: "restricted", mode: target };
}

function advertisedModeIds(session: CursorEditSession): Set<string> {
  const ids = new Set(session.modes?.availableModes.map((mode) => mode.id) ?? []);
  for (const value of selectValues(session.configOptions.find((option) => option.id === "mode"))) {
    ids.add(value);
  }
  return ids;
}

function configLists(session: CursorEditSession, mode: string): boolean {
  return selectValues(session.configOptions.find((option) => option.id === "mode")).includes(mode);
}

function currentModeOption(session: CursorEditSession): string | undefined {
  const option = session.configOptions.find((entry) => entry.id === "mode");
  return typeof option?.currentValue === "string" ? option.currentValue : undefined;
}

function selectValues(option: { options?: unknown } | undefined): string[] {
  if (!option || !Array.isArray(option.options)) return [];
  const values: string[] = [];
  for (const entry of option.options) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { value?: unknown; options?: unknown };
    if (typeof record.value === "string") values.push(record.value);
    if (!Array.isArray(record.options)) continue;
    for (const nested of record.options) {
      if (nested && typeof nested === "object" && typeof (nested as { value?: unknown }).value === "string") {
        values.push((nested as { value: string }).value);
      }
    }
  }
  return values;
}
