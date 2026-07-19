import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { BrowserElementPickerService } from "./browser-element-picker.js";

class FakeDebugger extends EventEmitter {
  attached = false;
  rejectZeroDescribeDepth = false;
  rejectMethod: string | null = null;
  readonly commands: Array<{ method: string; params: Record<string, unknown> }> = [];
  runtimeCallCount = 0;
  runtimeEvaluateCount = 0;

  isAttached(): boolean {
    return this.attached;
  }

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
    this.emit("detach", {}, "target closed");
  }

  async sendCommand(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    this.commands.push({ method, params });
    if (method === this.rejectMethod) throw new Error("Invalid parameters");
    switch (method) {
      case "Page.getLayoutMetrics":
        return {
          cssLayoutViewport: {
            pageX: 10,
            pageY: 20,
            clientWidth: 1200,
            clientHeight: 800,
          },
        };
      case "DOM.getBoxModel":
        return {
          model: {
            border: [50, 80, 210, 80, 210, 128, 50, 128],
          },
        };
      case "DOM.getNodeForLocation":
        return {
          backendNodeId: 42,
          frameId: "frame-main",
        };
      case "DOM.describeNode":
        if (this.rejectZeroDescribeDepth && params.depth === 0) {
          throw new Error("Invalid parameters");
        }
        return {
          node: {
            backendNodeId: 42,
            frameId: "frame-main",
            localName: "button",
            nodeName: "BUTTON",
            attributes: ["id", "save", "class", "primary action"],
          },
        };
      case "Page.createIsolatedWorld":
        return { executionContextId: 73 };
      case "DOM.resolveNode":
        return { object: { objectId: "remote-button-42" } };
      case "Runtime.callFunctionOn": {
        this.runtimeCallCount += 1;
        if (this.runtimeCallCount === 1) {
          return {
            result: {
              value: {
                url: "https://example.test/settings",
                title: "Settings",
                selector: "#save",
                dom_path: "html > body > main > button:nth-of-type(1)",
                tag_name: "button",
                id: "save",
                class_names: ["primary", "action"],
                role: "button",
                aria_label: "Save settings",
                text: "Save",
                attributes: {
                  id: "save",
                  class: "primary action",
                  type: "button",
                },
                outer_html: '<button id="save" class="primary action" type="button">Save</button>',
                computed_styles: {
                  color: "rgb(15, 17, 21)",
                  background: "rgb(255, 255, 255)",
                  opacity: "1",
                  "font-family": "Inter, sans-serif",
                  "font-size": "14px",
                  "font-weight": "600",
                  "line-height": "20px",
                  "border-radius": "6px",
                },
                rect: { x: 50, y: 80, width: 160, height: 48 },
                viewport: {
                  width: 1200,
                  height: 800,
                  device_pixel_ratio: 2,
                },
              },
            },
          };
        }
        return { result: { value: true } };
      }
      case "Page.captureScreenshot":
        return { data: "iVBORw0KGgoAAAANSUhEUg==" };
      case "Runtime.evaluate":
        if (String(params.expression).includes("document.elementFromPoint")) {
          return {
            result: {
              objectId: "hit-node-42",
            },
          };
        }
        this.runtimeEvaluateCount += 1;
        return this.runtimeEvaluateCount === 1
          ? { result: { value: { devicePixelRatio: 2 } } }
          : { result: { value: true } };
      default:
        return {};
    }
  }
}

class FakeTarget extends EventEmitter {
  readonly id = 17;
  readonly debugger = new FakeDebugger();

  isDestroyed(): boolean {
    return false;
  }

  isLoading(): boolean {
    return false;
  }

  getURL(): string {
    return "https://example.test/settings";
  }

  getTitle(): string {
    return "Settings";
  }
}

describe("BrowserElementPickerService", () => {
  it("hits the page through elementFromPoint when DOM.getNodeForLocation is unavailable", async () => {
    const target = new FakeTarget();
    target.debugger.rejectMethod = "DOM.getNodeForLocation";
    const picker = new BrowserElementPickerService();

    await picker.begin(target);
    const hover = await picker.hover(target.id, { x: 25, y: 30 });

    expect(hover?.selector).toBe("#save");
    expect(target.debugger.commands).toContainEqual(
      expect.objectContaining({ method: "DOM.getNodeForLocation" }),
    );
    expect(
      target.debugger.commands.find(
        (command) => command.method === "Runtime.evaluate",
      )?.params.expression,
    ).toContain("document.elementFromPoint(25, 30)");
  });

  it("describes the hovered node with protocol-valid depth parameters", async () => {
    const target = new FakeTarget();
    target.debugger.rejectZeroDescribeDepth = true;
    const picker = new BrowserElementPickerService();

    await picker.begin(target);
    const hover = await picker.hover(target.id, { x: 25, y: 30 });

    expect(hover?.selector).toBe("#save");
  });

  it("names the CDP command when hover fails", async () => {
    const target = new FakeTarget();
    target.debugger.rejectMethod = "DOM.getBoxModel";
    const picker = new BrowserElementPickerService();

    await picker.begin(target);

    await expect(picker.hover(target.id, { x: 25, y: 30 })).rejects.toThrow(
      "DOM.getBoxModel: Invalid parameters",
    );
  });

  it("hits a DOM node through CDP and commits structured context with a PNG", async () => {
    const target = new FakeTarget();
    const picker = new BrowserElementPickerService();

    await picker.begin(target);
    const hover = await picker.hover(target.id, { x: 25, y: 30 });

    expect(hover).toEqual({
      selector: "#save",
      tag_name: "button",
      rect: { x: 40, y: 60, width: 160, height: 48 },
      label: "#save  160x48",
    });
    expect(
      target.debugger.commands.find(
        (command) => command.method === "DOM.getNodeForLocation",
      )?.params,
    ).toMatchObject({
      x: 25,
      y: 30,
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: true,
    });
    expect(
      target.debugger.commands.find(
        (command) => command.method === "DOM.describeNode",
      )?.params,
    ).toMatchObject({ backendNodeId: 42 });

    const result = await picker.commit(target.id);

    expect(result).toMatchObject({
      screenshotData: "iVBORw0KGgoAAAANSUhEUg==",
      element: {
        url: "https://example.test/settings",
        selector: "#save",
        dom_path: "html > body > main > button:nth-of-type(1)",
        tag_name: "button",
        text: "Save",
        computed_styles: expect.objectContaining({
          opacity: "1",
          "font-size": "14px",
        }),
        rect: { x: 40, y: 60, width: 160, height: 48 },
      },
    });
    expect(target.debugger.commands.map((command) => command.method)).toEqual(
      expect.arrayContaining([
        "DOM.enable",
        "Page.enable",
        "Runtime.enable",
        "DOM.resolveNode",
        "Runtime.callFunctionOn",
        "Page.captureScreenshot",
        "Runtime.releaseObject",
      ]),
    );
    expect(
      target.debugger.commands.find(
        (command) => command.method === "Page.createIsolatedWorld",
      )?.params,
    ).toMatchObject({ frameId: "frame-main" });
    expect(
      target.debugger.commands.find(
        (command) => command.method === "DOM.resolveNode",
      )?.params,
    ).toMatchObject({ backendNodeId: 42, executionContextId: 73 });
    expect(
      target.debugger.commands.find(
        (command) => command.method === "Runtime.callFunctionOn"
          && typeof command.params.functionDeclaration === "string"
          && String(command.params.functionDeclaration).includes("getComputedStyle"),
      )?.params.functionDeclaration,
    ).toContain("dom_path");
    expect(
      target.debugger.commands.find(
        (command) => command.method === "Runtime.callFunctionOn"
          && Array.isArray(command.params.arguments),
      )?.params,
    ).toMatchObject({ awaitPromise: true });
    expect(target.debugger.attached).toBe(false);
  });

  it("ignores subframe navigation but cancels and detaches for a main-frame navigation", async () => {
    const target = new FakeTarget();
    const picker = new BrowserElementPickerService();

    await picker.begin(target);
    target.emit(
      "did-start-navigation",
      {},
      "https://frame.example.test",
      false,
      false,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(target.debugger.attached).toBe(true);

    target.emit(
      "did-start-navigation",
      {},
      "https://example.test/next",
      false,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(target.debugger.attached).toBe(false);
    await expect(picker.hover(target.id, { x: 1, y: 1 })).rejects.toThrow(
      "not active",
    );
  });

  it("captures a dragged viewport region without resolving a DOM node", async () => {
    const target = new FakeTarget();
    const picker = new BrowserElementPickerService();

    await picker.begin(target);
    const result = await picker.captureRegion(target.id, {
      x: 350,
      y: 300,
      width: -200,
      height: -100,
    });

    expect(result).toEqual({
      screenshotData: "iVBORw0KGgoAAAANSUhEUg==",
      region: {
        url: "https://example.test/settings",
        title: "Settings",
        rect: { x: 150, y: 200, width: 200, height: 100 },
        viewport: {
          width: 1200,
          height: 800,
          device_pixel_ratio: 2,
        },
      },
    });
    expect(
      target.debugger.commands.some(
        (command) => command.method === "DOM.resolveNode",
      ),
    ).toBe(false);
    expect(
      target.debugger.commands.filter(
        (command) => command.method === "Runtime.evaluate",
      )[0]?.params,
    ).toMatchObject({ awaitPromise: true });
    expect(
      target.debugger.commands.filter(
        (command) => command.method === "Runtime.evaluate",
      ),
    ).toHaveLength(2);
    expect(target.debugger.attached).toBe(false);
  });
});
