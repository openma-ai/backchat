/** ACP v1: `agentCapabilities.auth.logout` of `{}` advertises the logout method.
 *  Omitted or null means clients must not call it. */
export function acpLogoutAdvertised(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const auth = (capabilities as { auth?: unknown }).auth;
  if (!auth || typeof auth !== "object") return false;
  return (auth as { logout?: unknown }).logout != null;
}

export async function callAcpLogout(
  agent: {
    logout?: (params: { _meta?: Record<string, unknown> | null }) => Promise<unknown> | unknown;
  },
  capabilities: unknown,
): Promise<void> {
  if (!acpLogoutAdvertised(capabilities)) {
    throw new Error("This agent does not support ACP logout.");
  }
  if (typeof agent.logout !== "function") {
    throw new Error("ACP logout is not available on this connection.");
  }
  await agent.logout({});
}
