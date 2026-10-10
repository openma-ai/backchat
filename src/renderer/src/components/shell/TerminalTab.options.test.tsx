/**
 * @vitest-environment happy-dom
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const constructed: Array<Record<string, unknown>> = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class Terminal {
    cols = 80;
    rows = 24;
    options: { disableStdin?: boolean } = {};
    textarea: HTMLElement | null = null;
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
    }
    loadAddon() {}
    open() {}
    onData() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
    write() {}
    focus() {}
    dispose() {}
    hasSelection() { return false; }
    getSelection() { return ""; }
    clearSelection() {}
    paste() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddon {
    fit() {}
    proposeDimensions() { return { cols: 80, rows: 24 }; }
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class WebglAddon {
    onContextLoss() {}
    dispose() {}
  },
}));

import { TerminalTab } from "./TerminalTab";

describe("TerminalTab text options", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it("constructs xterm with a touching line box and custom glyphs", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    const backchat = {
      uiTermResize: vi.fn(),
      uiTermInput: vi.fn(),
      onUiTermData: () => () => undefined,
      onUiTermExit: () => () => undefined,
    };
    vi.stubGlobal("backchat", backchat);
    Object.assign(window, { backchat });

    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host);
      root.render(<TerminalTab terminalId="term-1" />);
    });

    expect(constructed[0]).toMatchObject({
      fontWeight: 400,
      fontSize: 12,
      lineHeight: 1,
      customGlyphs: true,
    });
    expect(String(constructed[0]?.fontFamily)).not.toContain("JetBrains");
  });
});
