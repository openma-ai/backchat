export type OpenmaPetDeepLink = {
  harness: string;
  event: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  label?: string;
};

export const OPENMA_PET_PROTOCOL = "openma-pet";

export function parseOpenmaPetDeepLink(raw: string): OpenmaPetDeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${OPENMA_PET_PROTOCOL}:`) return null;

  const parts = [url.hostname, ...url.pathname.split("/")].filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "event") return null;
  const [, harness, event] = parts;
  if (!harness || !event) return null;

  const link: OpenmaPetDeepLink = { harness, event };
  setOptional(link, "sessionId", url.searchParams.get("sessionId"));
  setOptional(link, "threadId", url.searchParams.get("threadId"));
  setOptional(link, "turnId", url.searchParams.get("turnId"));
  setOptional(link, "agentId", url.searchParams.get("agentId"));
  setOptional(link, "label", url.searchParams.get("label"));
  return link;
}

export function findOpenmaPetDeepLink(argv: readonly string[]): OpenmaPetDeepLink | null {
  for (const arg of argv) {
    const parsed = parseOpenmaPetDeepLink(arg);
    if (parsed) return parsed;
  }
  return null;
}

function setOptional<T extends keyof OpenmaPetDeepLink>(
  target: OpenmaPetDeepLink,
  key: T,
  value: string | null,
): void {
  if (value) {
    target[key] = value as OpenmaPetDeepLink[T];
  }
}
