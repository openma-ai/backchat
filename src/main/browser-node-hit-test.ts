export interface BrowserNodeHitTestDebugger {
  sendCommand(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface BrowserNodeHit {
  node: Record<string, unknown>;
  frameId: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

async function namedCommand(
  debuggerApi: BrowserNodeHitTestDebugger,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await debuggerApi.sendCommand(method, params);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${method}: ${detail}`);
  }
}

export async function describeBrowserNodeAtPoint(
  debuggerApi: BrowserNodeHitTestDebugger,
  point: { x: number; y: number },
): Promise<BrowserNodeHit | null> {
  let location: Record<string, unknown> = {};
  try {
    location = asRecord(
      await debuggerApi.sendCommand("DOM.getNodeForLocation", {
        x: point.x,
        y: point.y,
        includeUserAgentShadowDOM: true,
        ignorePointerEventsNone: true,
      }),
    );
  } catch {
    // Older CDP implementations do not expose DOM.getNodeForLocation.
  }

  const backendNodeId = location.backendNodeId;
  let description: Record<string, unknown>;
  if (
    typeof backendNodeId === "number"
    && Number.isFinite(backendNodeId)
    && backendNodeId > 0
  ) {
    description = asRecord(
      await namedCommand(debuggerApi, "DOM.describeNode", { backendNodeId }),
    );
  } else {
    const evaluated = asRecord(
      await namedCommand(debuggerApi, "Runtime.evaluate", {
        expression: `document.elementFromPoint(${point.x}, ${point.y})`,
        objectGroup: "backchat-browser-annotation-hit-test",
        returnByValue: false,
        silent: true,
      }),
    );
    const objectId = asRecord(evaluated.result).objectId;
    if (typeof objectId !== "string" || !objectId) return null;
    try {
      description = asRecord(
        await namedCommand(debuggerApi, "DOM.describeNode", { objectId }),
      );
    } finally {
      await debuggerApi.sendCommand("Runtime.releaseObject", { objectId })
        .catch(() => undefined);
    }
  }

  const node = asRecord(description.node);
  return {
    node,
    frameId: typeof node.frameId === "string"
      ? node.frameId
      : typeof location.frameId === "string"
        ? location.frameId
        : "",
  };
}
