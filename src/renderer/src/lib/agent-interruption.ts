/** Typed codex-acp process exit. A zero process exit code is not a successful
 * ACP prompt response, and restartability never authorizes automatic replay. */
export function isRestartableAgentInterruption(agentId: string | undefined, details: unknown): boolean {
  if (agentId !== "codex-acp" || !details || typeof details !== "object") return false;
  const error = details as Record<string, unknown>;
  const data = error.data;
  return error.code === 1001 && !!data && typeof data === "object" &&
    (data as Record<string, unknown>).restartable === true;
}
