/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedCollapse } from "./animated-collapse";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AnimatedCollapse", () => {
  it("renders only the closed shell, not the body, while closed", () => {
    // A collapsed sidebar group must not keep its rows (and their menus)
    // mounted: 3 visible rows were costing 24 mounted ones.
    const closed = renderToStaticMarkup(
      <AnimatedCollapse open={false}><button type="button">Chat</button></AnimatedCollapse>,
    );
    expect(closed).toContain('data-state="closed"');
    expect(closed).toContain('aria-hidden="true" inert=""');
    expect(closed).not.toContain("Chat");

    const open = renderToStaticMarkup(
      <AnimatedCollapse open lightweight><button type="button">Chat</button></AnimatedCollapse>,
    );
    expect(open).toContain('data-state="open"');
    expect(open).toContain('data-motion="lightweight"');
    expect(open).not.toContain('inert=""');
    expect(open).toContain(">Chat</button>");
  });

  it("keeps the body through the close animation, then unmounts it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<AnimatedCollapse open><span data-body="1" /></AnimatedCollapse>));
    expect(host.querySelector("[data-body]")).not.toBeNull();

    act(() => root.render(<AnimatedCollapse open={false}><span data-body="1" /></AnimatedCollapse>));
    // Still mounted so the height/opacity transition has something to animate.
    expect(host.querySelector("[data-body]")).not.toBeNull();

    const shell = host.querySelector('[data-slot="animated-collapse"]')!;
    act(() => {
      // A child's transition bubbling up must not end the shell's close.
      host.querySelector("[data-body]")!.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });
    expect(host.querySelector("[data-body]")).not.toBeNull();
    act(() => {
      const event = new Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "height" });
      shell.dispatchEvent(event);
    });
    expect(host.querySelector("[data-body]")).toBeNull();

    // Reopening mounts it again immediately.
    act(() => root.render(<AnimatedCollapse open><span data-body="1" /></AnimatedCollapse>));
    expect(host.querySelector("[data-body]")).not.toBeNull();
    act(() => root.unmount());
  });

  it("does not unmount the intrinsic body on opacity finishing before height", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<AnimatedCollapse open><span data-body="1" /></AnimatedCollapse>));
    act(() => root.render(<AnimatedCollapse open={false}><span data-body="1" /></AnimatedCollapse>));
    const shell = host.querySelector('[data-slot="animated-collapse"]')!;
    const opacity = new Event("transitionend", { bubbles: true });
    Object.defineProperty(opacity, "propertyName", { value: "opacity" });
    act(() => shell.dispatchEvent(opacity));
    expect(host.querySelector("[data-body]")).not.toBeNull();
    const height = new Event("transitionend", { bubbles: true });
    Object.defineProperty(height, "propertyName", { value: "height" });
    act(() => shell.dispatchEvent(height));
    expect(host.querySelector("[data-body]")).toBeNull();
    act(() => root.unmount());
  });

  it("does not drop the body if it reopens before the close finishes", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<AnimatedCollapse open><span data-body="1" /></AnimatedCollapse>));
    act(() => root.render(<AnimatedCollapse open={false}><span data-body="1" /></AnimatedCollapse>));
    act(() => root.render(<AnimatedCollapse open><span data-body="1" /></AnimatedCollapse>));
    const shell = host.querySelector('[data-slot="animated-collapse"]')!;
    act(() => {
      const event = new Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "height" });
      shell.dispatchEvent(event);
    });
    expect(host.querySelector("[data-body]")).not.toBeNull();
    act(() => root.unmount());
  });
});
