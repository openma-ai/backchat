import { randomUUID } from "node:crypto";
import lucideRuntime from "lucide/dist/umd/lucide.min.js?raw";
import type { McpAppResourceMeta } from "../shared/mcp-app.js";
import { buildMcpAppDocument } from "../shared/mcp-app-document.js";

const MAX_DOCUMENTS = 128;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const documents = new Map<string, string>();
const LUCIDE_ASSET_PATH = "/__assets/lucide@1.17.0.js";

export interface SandboxResource {
  body: string;
  contentType: string;
}

export function registerSandboxDocument(document: string): string {
  if (Buffer.byteLength(document, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error("Sandbox documents must be 4 MB or smaller");
  }
  const token = randomUUID();
  documents.set(token, document);
  while (documents.size > MAX_DOCUMENTS) {
    const oldest = documents.keys().next().value;
    if (!oldest) break;
    documents.delete(oldest);
  }
  return `oma-mcp-app://view/${token}`;
}

export function registerMcpAppDocument(
  html: string,
  csp?: McpAppResourceMeta["csp"],
): string {
  return registerSandboxDocument(buildMcpAppDocument(html, csp));
}

export function resolveMcpAppDocument(requestUrl: string): string | undefined {
  const resource = resolveSandboxResource(requestUrl);
  return resource?.contentType.startsWith("text/html") ? resource.body : undefined;
}

export function resolveSandboxResource(requestUrl: string): SandboxResource | undefined {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== "oma-mcp-app:" || url.hostname !== "view") return undefined;
    if (url.pathname === LUCIDE_ASSET_PATH) {
      return {
        body: lucideRuntime,
        contentType: "text/javascript; charset=utf-8",
      };
    }
    const token = url.pathname.slice(1);
    const document = token && !token.includes("/") ? documents.get(token) : undefined;
    return document
      ? { body: document, contentType: "text/html; charset=utf-8" }
      : undefined;
  } catch {
    return undefined;
  }
}
