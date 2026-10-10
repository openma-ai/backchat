/**
 * @vitest-environment happy-dom
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BrowserAnnotationMarker } from "@/lib/browser-element-annotation";
import type { BrowserElementHoverInfo } from "@shared/browser-element-picker.js";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
}));

import {
  BrowserTab,
  browserAnnotationOverlay,
  editAnnotationFromMarker,
  leaveAnnotationOverlay,
  pickerDragActive,
  preventOverlayMenu,
  stopOverlayEvent,
} from "./BrowserTab";

const hover = (y: number): BrowserElementHoverInfo => ({
  selector: "p",
  tag_name: "p",
  label: y >= 24 ? "below" : "above",
  rect: { x: 1, y, width: 20, height: 10 },
});

const marker = (kind: "element" | "region", id: string): BrowserAnnotationMarker => ({
  annotation: { id } as BrowserAnnotationMarker["annotation"],
  index: 3,
  kind,
  rect: { x: 2, y: 3, width: 4, height: 5 },
});

const handlers = {
  onClearHover: vi.fn(),
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onPointerCancel: vi.fn(),
  onEdit: vi.fn(),
};

function overlay(overrides: Partial<Parameters<typeof browserAnnotationOverlay>[0]> = {}) {
  return renderToStaticMarkup(<>{browserAnnotationOverlay({
    isPickingElement: true,
    resizeSnapshot: null,
    pickerHover: hover(40),
    regionSelection: null,
    markers: [],
    editingAnnotationId: null,
    canvasLabel: "Annotate",
    dragActive: false,
    ...handlers,
    ...overrides,
  })}</>);
}

describe("browser annotation overlay", () => {
  it("places the hover label above or below the box", () => {
    expect(overlay()).toContain("bottom-[calc(100%+4px)]");
    expect(overlay()).toContain("text-fg-on-fill");
    expect(overlay({ pickerHover: hover(4) })).toContain("top-[calc(100%+4px)]");
    expect(overlay({ pickerHover: null })).not.toContain("data-browser-element-hover");
  });

  it("draws a region selection instead of the hover box", () => {
    const html = overlay({
      pickerHover: hover(40),
      regionSelection: { x: 8, y: 9, width: 10, height: 11 },
    });
    expect(html).toContain("data-browser-region-selection");
    expect(html).not.toContain("data-browser-element-hover");
  });

  it("hides the picker while a resize snapshot is showing and renders markers", () => {
    expect(overlay({ isPickingElement: true, resizeSnapshot: "data:image/png" })).not.toContain(
      "data-browser-annotation-overlay",
    );
    expect(overlay({ isPickingElement: false })).not.toContain("data-browser-annotation-overlay");
    const html = overlay({
      markers: [marker("element", "ann-1"), marker("region", "ann-2")],
      editingAnnotationId: "ann-2",
    });
    expect(html).toContain("data-browser-annotation-marker=\"ann-1\"");
    expect(html).toContain("border-dashed");
    expect(html).toContain("text-fg-on-fill");
    expect(html).toContain("bg-[#3b82f6]/18");
  });

  it("clears hover only when a drag is not active", () => {
    const clear = vi.fn();
    leaveAnnotationOverlay(false, clear);
    expect(clear).toHaveBeenCalledWith(null);
    clear.mockClear();
    leaveAnnotationOverlay(true, clear);
    expect(clear).not.toHaveBeenCalled();
    expect(pickerDragActive(null)).toBe(false);
    expect(pickerDragActive({ start: { x: 0, y: 0 } })).toBe(true);
  });

  it("stops the marker event and edits that annotation", () => {
    const event = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    const onEdit = vi.fn();
    stopOverlayEvent(event);
    preventOverlayMenu(event);
    editAnnotationFromMarker(event, "ann-1", onEdit);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalledWith("ann-1");
  });

  it("runs the overlay leave, menu, and marker handlers", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const clear = vi.fn();
    const onEdit = vi.fn();
    let root: Root | null = null;
    act(() => {
      root = createRoot(host);
      root.render(
        browserAnnotationOverlay({
          isPickingElement: true,
          resizeSnapshot: null,
          pickerHover: null,
          regionSelection: null,
          markers: [marker("element", "ann-9")],
          editingAnnotationId: null,
          canvasLabel: "Annotate",
          dragActive: false,
          onClearHover: clear,
          onPointerDown: vi.fn(),
          onPointerMove: vi.fn(),
          onPointerUp: vi.fn(),
          onPointerCancel: vi.fn(),
          onEdit,
        }),
      );
    });
    const overlayEl = host.querySelector("[data-browser-annotation-overlay]");
    const button = host.querySelector("[data-browser-annotation-marker-button]");
    if (!(overlayEl instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      throw new Error("annotation overlay did not render");
    }
    const reactProps = (node: HTMLElement) => {
      const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
      if (!key) throw new Error(`no react props on ${node.tagName}`);
      return (node as unknown as Record<string, Record<string, (event?: object) => void>>)[key]!;
    };
    const overlayProps = reactProps(overlayEl);
    const buttonProps = reactProps(button);
    const menuEvent = { preventDefault: vi.fn() };
    const markerEvent = { stopPropagation: vi.fn() };
    act(() => {
      overlayProps.onPointerLeave?.();
      overlayProps.onContextMenu?.(menuEvent);
      buttonProps.onPointerDown?.(markerEvent);
      buttonProps.onClick?.(markerEvent);
    });
    expect(menuEvent.preventDefault).toHaveBeenCalled();
    expect(markerEvent.stopPropagation).toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith(null);
    expect(onEdit).toHaveBeenCalledWith("ann-9");
    act(() => root?.unmount());
    host.remove();
  });

  it("mounts the overlay from the browser tab", () => {
    const html = renderToStaticMarkup(
      <BrowserTab
        sessionId="session-1"
        tabId="tab-1"
        active
        visible
        initialUrl="https://example.com"
      />,
    );
    expect(html).toContain("<webview");
  });
});
