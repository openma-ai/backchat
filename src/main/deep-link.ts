export type BackchatDeepLink =
  | { kind: "session"; id: string; path: string }
  | { kind: "pair"; id: string; path: string };

export const BACKCHAT_PROTOCOL = "backchat";

export function parseBackchatDeepLink(raw: string): BackchatDeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${BACKCHAT_PROTOCOL}:`) return null;

  const parts = [url.hostname, ...url.pathname.split("/")].filter(Boolean);
  if (parts.length !== 2) return null;

  const [resource, encodedId] = parts;
  if (!encodedId) return null;

  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return null;
  }
  if (!id) return null;

  if (resource === "session" || resource === "sessions") {
    return {
      kind: "session",
      id,
      path: `/chat/${encodeURIComponent(id)}`,
    };
  }
  if (resource === "pair" || resource === "pairs") {
    return {
      kind: "pair",
      id,
      path: `/pair/${encodeURIComponent(id)}`,
    };
  }
  return null;
}

export function findBackchatDeepLink(argv: readonly string[]): BackchatDeepLink | null {
  for (const arg of argv) {
    const parsed = parseBackchatDeepLink(arg);
    if (parsed) return parsed;
  }
  return null;
}
