export const MCP_APP_ALLOWED_METHODS = [
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
  "prompts/get",
] as const;

export type McpAppMethod = (typeof MCP_APP_ALLOWED_METHODS)[number];

export interface McpAppResolveInput {
  tool_name?: string;
  tool_title?: string;
  resource_uri?: string;
  server_hint?: string;
}

export interface McpAppResourceMeta {
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };
  permissions?: Record<string, unknown>;
  prefersBorder?: boolean;
}

export interface McpAppResolved {
  server_id: string;
  resource_uri: string;
  html: string;
  document_url: string;
  meta?: McpAppResourceMeta;
}

export interface McpAppRequestInput {
  server_id: string;
  method: McpAppMethod;
  params?: Record<string, unknown>;
}
