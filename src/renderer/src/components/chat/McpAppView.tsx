import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  getToolUiResourceUri,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { Loader2Icon } from "lucide-react";
import { StatusNotice } from "@/components/ui/status-notice";
import type { ToolEntry } from "@/lib/reduce-turn";
import { clampMcpAppHeight } from "@/lib/mcp-app-sandbox";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { openBrowserAwareUrl } from "@/lib/browser-open";
import {
  MCP_APP_DISPLAY_MODES,
  mcpAppFrameHeight,
  negotiateMcpAppDisplayModes,
  resolveMcpAppDisplayMode,
  type McpAppDisplayMode,
} from "@/lib/mcp-app-display";
import { InteractiveFrameSurface } from "./InteractiveFrameSurface";

function uiResourceUri(tool: ToolEntry): string | undefined {
  try {
    return getToolUiResourceUri({ _meta: tool.meta } as Partial<Tool>);
  } catch {
    return undefined;
  }
}

function serverHint(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined;
  for (const key of ["mcp_server_name", "mcpServerName", "server_id", "serverId"]) {
    const value = meta[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function asArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asToolResult(value: unknown, failed: boolean): CallToolResult {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result = value as Record<string, unknown>;
    if (Array.isArray(result.content)) return result as unknown as CallToolResult;
  }
  return {
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value ?? null),
    }],
    ...(failed ? { isError: true } : {}),
  };
}

export function McpAppView({ tool, sessionId }: { tool: ToolEntry; sessionId: string }) {
  const resourceUri = uiResourceUri(tool);
  const serverHintValue = serverHint(tool.meta);
  const { locale, t } = useI18n();
  const { effective } = useTheme();
  const [resource, setResource] = useState<Awaited<ReturnType<typeof window.backchat.mcpAppResolve>>>();
  const [error, setError] = useState<string>();
  const [requestedHeight, setRequestedHeight] = useState(360);
  const [displayMode, setDisplayMode] = useState<McpAppDisplayMode>("inline");
  const [pipDimensions, setPipDimensions] = useState({ width: 480, height: 324 });
  const [availableDisplayModes, setAvailableDisplayModes] = useState<McpAppDisplayMode[]>(["inline"]);
  const [dismissed, setDismissed] = useState(false);
  const displayModeRef = useRef<McpAppDisplayMode>("inline");
  displayModeRef.current = displayMode;
  const availableDisplayModesRef = useRef<McpAppDisplayMode[]>(["inline"]);
  const [iframeElement, setIframeElement] = useState<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const lastResultRef = useRef<string | undefined>(undefined);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const dismissingRef = useRef<Promise<void> | null>(null);

  const dismissMcpApp = useCallback(() => {
    if (dismissingRef.current) return dismissingRef.current;
    const dismissing = (async () => {
      const bridge = bridgeRef.current;
      if (bridge && initializedRef.current) {
        try {
          await bridge.teardownResource({}, { timeout: 1_500 });
        } catch {
          // The host still owns the container and may close it if a View does
          // not acknowledge teardown within the bounded grace period.
        }
      }
      setDismissed(true);
    })();
    dismissingRef.current = dismissing;
    return dismissing;
  }, []);

  useEffect(() => {
    if (!resourceUri) return;
    let cancelled = false;
    setResource(undefined);
    setError(undefined);
    void window.backchat.mcpAppResolve({
      resource_uri: resourceUri,
      server_hint: serverHintValue,
      tool_name: tool.toolName,
      tool_title: tool.title,
    }).then((resolved) => {
      if (cancelled) return;
      if (!resolved) setError(t("mcpApp.unavailable"));
      else setResource(resolved);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [resourceUri, serverHintValue, tool.title, tool.toolName, t]);

  useEffect(() => {
    const iframe = iframeElement;
    if (!iframe || !resource) return;
    let disposed = false;
    initializedRef.current = false;
    lastResultRef.current = undefined;
    const bridge = new AppBridge(
      null,
      { name: "Backchat", version: "0.0.1" },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        sandbox: {
          permissions: resource.meta?.permissions as never,
          csp: resource.meta?.csp,
        },
        message: { text: {} },
      },
      {
        hostContext: {
          theme: effective,
          displayMode: displayModeRef.current,
          availableDisplayModes: [...MCP_APP_DISPLAY_MODES],
          containerDimensions: { maxHeight: 720 },
          locale,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          platform: "desktop",
          userAgent: "Backchat/0.0.1",
        },
      },
    );
    bridgeRef.current = bridge;
    bridge.onrequestteardown = () => { void dismissMcpApp(); };
    const request = (method: Parameters<typeof window.backchat.mcpAppRequest>[0]["method"], params: unknown) =>
      window.backchat.mcpAppRequest({
        server_id: resource.server_id,
        method,
        params: asArguments(params),
      });
    bridge.oncalltool = (params) => request("tools/call", params) as Promise<CallToolResult>;
    bridge.onlistresources = (params) => request("resources/list", params) as never;
    bridge.onlistresourcetemplates = (params) => request("resources/templates/list", params) as never;
    bridge.onreadresource = (params) => request("resources/read", params) as never;
    bridge.onlistprompts = (params) => request("prompts/list", params) as never;
    bridge.onopenlink = async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { isError: true };
      openBrowserAwareUrl(url);
      return {};
    };
    bridge.onmessage = async ({ content }) => {
      const text = content
        .filter((item): item is Extract<(typeof content)[number], { type: "text" }> => item.type === "text")
        .map((item) => item.text)
        .join("\n")
        .trim();
      if (!text) return { isError: true };
      await window.backchat.sessionPrompt({
        session_id: sessionId,
        turn_id: crypto.randomUUID(),
        text,
        prompt_intent: "queue",
        requested_delivery: "turn_end",
        effective_delivery: "turn_end",
      });
      return {};
    };
    bridge.onsizechange = ({ height: requestedHeight }) => {
      if (requestedHeight != null) setRequestedHeight(clampMcpAppHeight(requestedHeight));
    };
    bridge.onrequestdisplaymode = async ({ mode }) => {
      const next = resolveMcpAppDisplayMode(
        mode,
        displayModeRef.current,
        availableDisplayModesRef.current,
      );
      // Let AppBridge write the JSON-RPC response through the current iframe
      // before moving the View into another host container.
      window.setTimeout(() => setDisplayMode(next), 0);
      return { mode: next };
    };
    bridge.oninitialized = () => {
      initializedRef.current = true;
      const negotiatedModes = negotiateMcpAppDisplayModes(
        MCP_APP_DISPLAY_MODES,
        bridge.getAppCapabilities()?.availableDisplayModes,
      );
      availableDisplayModesRef.current = negotiatedModes;
      setAvailableDisplayModes(negotiatedModes);
      const current = toolRef.current;
      void bridge.sendToolInput({ arguments: asArguments(current.rawInput) });
      if (current.rawOutput !== undefined) {
        const result = asToolResult(current.rawOutput, current.status === "failed");
        lastResultRef.current = JSON.stringify(result);
        void bridge.sendToolResult(result);
      }
    };

    const start = async () => {
      const target = iframe.contentWindow;
      if (!target) throw new Error("MCP App iframe is unavailable");
      await bridge.connect(new PostMessageTransport(target, target));
      if (!disposed) iframe.src = resource.document_url;
    };
    void start().catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      disposed = true;
      initializedRef.current = false;
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      void bridge.close();
    };
  }, [dismissMcpApp, effective, iframeElement, locale, resource, sessionId]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current) return;
    bridge.setHostContext({
      theme: effective,
      displayMode,
      availableDisplayModes: [...MCP_APP_DISPLAY_MODES],
      containerDimensions: displayMode === "fullscreen"
        ? { height: Math.max(160, window.innerHeight - 76) }
        : displayMode === "pip"
          ? pipDimensions
          : { maxHeight: 720 },
      locale,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: "desktop",
      userAgent: "Backchat/0.0.1",
    });
  }, [displayMode, effective, locale, pipDimensions]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current || tool.rawOutput === undefined) return;
    const result = asToolResult(tool.rawOutput, tool.status === "failed");
    const serialized = JSON.stringify(result);
    if (lastResultRef.current === serialized) return;
    lastResultRef.current = serialized;
    void bridge.sendToolResult(result);
  }, [tool.rawOutput, tool.status]);

  if (!resourceUri || dismissed) return null;
  if (error) {
    return (
      <StatusNotice tone="danger" className="mt-2 min-h-16 items-center">
        <span className="break-words">{t("mcpApp.error")}: {error}</span>
      </StatusNotice>
    );
  }
  if (!resource) {
    return (
      <div className="mt-2 flex h-28 items-center justify-center gap-2 rounded-xl bg-bg-surface text-xs text-fg-muted" role="status">
        <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
        {t("mcpApp.loading")}
      </div>
    );
  }
  return (
    <InteractiveFrameSurface
      surfaceId={`mcp-app-${tool.toolCallId}`}
      sessionId={sessionId}
      label={tool.title ?? t("mcpApp.label")}
      displayMode={displayMode}
      onDisplayModeChange={setDisplayMode}
      availableDisplayModes={availableDisplayModes}
      onContainerSizeChange={setPipDimensions}
      onDismiss={dismissMcpApp}
    >
      <iframe
        ref={setIframeElement}
        title={tool.title ?? t("mcpApp.label")}
        sandbox="allow-scripts allow-forms"
        allow={buildAllowAttribute(resource.meta?.permissions as never)}
        className={displayMode === "pip"
          ? "block h-full w-full bg-transparent"
          : "block w-full bg-transparent transition-[height] duration-200 ease-out motion-reduce:transition-none"}
        style={{ height: mcpAppFrameHeight(displayMode, requestedHeight) }}
      />
    </InteractiveFrameSurface>
  );
}
