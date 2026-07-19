import { describe, expect, it } from "vitest";

import { describeBrowserNodeAtPoint } from "./browser-node-hit-test.js";

describe("describeBrowserNodeAtPoint", () => {
  it("describes the deepest CDP node at a viewport point", async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
    }> = [];
    const debuggerApi = {
      async sendCommand(
        method: string,
        params: Record<string, unknown> = {},
      ): Promise<unknown> {
        commands.push({ method, params });
        if (method === "DOM.getNodeForLocation") {
          return { backendNodeId: 42, frameId: "frame-shadow" };
        }
        if (method === "DOM.describeNode") {
          return {
            node: {
              backendNodeId: 42,
              frameId: "frame-shadow",
              localName: "button",
              attributes: ["id", "shadow-action"],
            },
          };
        }
        throw new Error(`Unexpected command: ${method}`);
      },
    };

    const result = await describeBrowserNodeAtPoint(debuggerApi, {
      x: 25,
      y: 30,
    });

    expect(result).toEqual({
      frameId: "frame-shadow",
      node: {
        backendNodeId: 42,
        frameId: "frame-shadow",
        localName: "button",
        attributes: ["id", "shadow-action"],
      },
    });
    expect(commands).toEqual([
      {
        method: "DOM.getNodeForLocation",
        params: {
          x: 25,
          y: 30,
          includeUserAgentShadowDOM: true,
          ignorePointerEventsNone: true,
        },
      },
      {
        method: "DOM.describeNode",
        params: { backendNodeId: 42 },
      },
    ]);
  });

  it("falls back to elementFromPoint and releases the remote object", async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
    }> = [];
    const debuggerApi = {
      async sendCommand(
        method: string,
        params: Record<string, unknown> = {},
      ): Promise<unknown> {
        commands.push({ method, params });
        if (method === "DOM.getNodeForLocation") {
          throw new Error("Method not found");
        }
        if (method === "Runtime.evaluate") {
          return { result: { objectId: "remote-hit-7" } };
        }
        if (method === "DOM.describeNode") {
          return {
            node: {
              backendNodeId: 7,
              frameId: "frame-main",
              localName: "a",
            },
          };
        }
        if (method === "Runtime.releaseObject") return {};
        throw new Error(`Unexpected command: ${method}`);
      },
    };

    const result = await describeBrowserNodeAtPoint(debuggerApi, {
      x: 8,
      y: 13,
    });

    expect(result).toMatchObject({
      frameId: "frame-main",
      node: {
        backendNodeId: 7,
        localName: "a",
      },
    });
    expect(commands.map(({ method }) => method)).toEqual([
      "DOM.getNodeForLocation",
      "Runtime.evaluate",
      "DOM.describeNode",
      "Runtime.releaseObject",
    ]);
    expect(commands[1]?.params).toMatchObject({
      expression: "document.elementFromPoint(8, 13)",
      objectGroup: "backchat-browser-annotation-hit-test",
      returnByValue: false,
      silent: true,
    });
    expect(commands[3]?.params).toEqual({ objectId: "remote-hit-7" });
  });

  it("names a fatal CDP command in its error", async () => {
    const debuggerApi = {
      async sendCommand(method: string): Promise<unknown> {
        if (method === "DOM.getNodeForLocation") {
          return { backendNodeId: 42 };
        }
        if (method === "DOM.describeNode") {
          throw new Error("Invalid parameters");
        }
        throw new Error(`Unexpected command: ${method}`);
      },
    };

    await expect(
      describeBrowserNodeAtPoint(debuggerApi, { x: 1, y: 2 }),
    ).rejects.toThrow("DOM.describeNode: Invalid parameters");
  });

  it("falls back when the location result has no usable backend node", async () => {
    const commands: string[] = [];
    const debuggerApi = {
      async sendCommand(method: string): Promise<unknown> {
        commands.push(method);
        if (method === "DOM.getNodeForLocation") {
          return { backendNodeId: 0 };
        }
        if (method === "Runtime.evaluate") {
          return { result: { objectId: "remote-hit-9" } };
        }
        if (method === "DOM.describeNode") {
          return { node: { backendNodeId: 9, localName: "input" } };
        }
        if (method === "Runtime.releaseObject") return {};
        throw new Error(`Unexpected command: ${method}`);
      },
    };

    const result = await describeBrowserNodeAtPoint(debuggerApi, {
      x: 3,
      y: 5,
    });

    expect(result?.node.backendNodeId).toBe(9);
    expect(commands).toEqual([
      "DOM.getNodeForLocation",
      "Runtime.evaluate",
      "DOM.describeNode",
      "Runtime.releaseObject",
    ]);
  });
});
