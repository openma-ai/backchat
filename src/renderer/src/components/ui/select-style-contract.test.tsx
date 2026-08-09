import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("radix-ui", async () => {
  const React = await import("react");
  const element =
    (tag: "button" | "div" | "hr" | "span") =>
    ({
      children,
      asChild: _asChild,
      sideOffset: _sideOffset,
      ...props
    }: Record<string, unknown>) =>
      React.createElement(tag, props, children as React.ReactNode);
  const portal = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

  return {
    Select: {
      Root: element("div"),
      Group: element("div"),
      Value: element("span"),
      Trigger: element("button"),
      Icon: element("span"),
      Portal: portal,
      Content: element("div"),
      Viewport: element("div"),
      Label: element("div"),
      Item: element("div"),
      ItemIndicator: element("span"),
      ItemText: element("span"),
      Separator: element("hr"),
      ScrollUpButton: element("button"),
      ScrollDownButton: element("button"),
    },
    DropdownMenu: {
      Root: element("div"),
      Portal: portal,
      Trigger: element("button"),
      Content: element("div"),
      Group: element("div"),
      Item: element("div"),
      CheckboxItem: element("div"),
      RadioGroup: element("div"),
      RadioItem: element("div"),
      ItemIndicator: element("span"),
      Label: element("div"),
      Separator: element("hr"),
      Sub: element("div"),
      SubTrigger: element("div"),
      SubContent: element("div"),
    },
  };
});

vi.mock("cmdk", async () => {
  const React = await import("react");
  const element =
    (tag: "div" | "input") =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(tag, props, children as React.ReactNode);
  const Command = Object.assign(element("div"), {
    Input: element("input"),
    List: element("div"),
    Empty: element("div"),
    Group: element("div"),
    Separator: element("div"),
    Item: element("div"),
  });
  return { Command };
});

import {
  Command,
  CommandItem,
  CommandSeparator,
} from "./command";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./dropdown-menu";
import { SelectContent, SelectItem, SelectSeparator } from "./select";

describe("select primitive visual contract", () => {
  it("maps every select family onto the same semantic surface and state tokens", () => {
    const css = readFileSync(resolve(__dirname, "../../styles/index.css"), "utf8");

    expect(css).toContain(".app-select-content {");
    expect(css).toContain("background: var(--surface-panel);");
    expect(css).toContain(".app-select-item {");
    expect(css).toContain(
      '.app-select-focus:is(:focus, [data-highlighted], [data-selected="true"])',
    );
    expect(css).toContain("background: var(--control-bg-hover);");
    expect(css).toContain('.app-select-item[data-state="checked"],');
    expect(css).toContain('.app-select-item[data-checked="true"]');
    expect(css).toContain("background: var(--control-bg-open);");
    expect(css).toContain(".app-select-separator {");
  });

  it("gives Radix Select the shared surface and state classes", () => {
    const content = renderToStaticMarkup(<SelectContent>Options</SelectContent>);
    const item = renderToStaticMarkup(<SelectItem value="one">One</SelectItem>);
    const separator = renderToStaticMarkup(<SelectSeparator />);

    expect(content).toContain("app-select-content");
    expect(item).toContain("app-select-item");
    expect(item).toContain("app-select-focus");
    expect(item).toContain("app-select-selected");
    expect(separator).toContain("app-select-separator");
  });

  it("gives Radix Dropdown the same surface and state classes", () => {
    const content = renderToStaticMarkup(
      <DropdownMenuContent>Options</DropdownMenuContent>,
    );
    const item = renderToStaticMarkup(<DropdownMenuItem>One</DropdownMenuItem>);
    const selectedItem = renderToStaticMarkup(
      <DropdownMenuCheckboxItem checked>One</DropdownMenuCheckboxItem>,
    );
    const separator = renderToStaticMarkup(<DropdownMenuSeparator />);

    expect(content).toContain("app-select-content");
    expect(item).toContain("app-select-item");
    expect(item).toContain("app-select-focus");
    expect(selectedItem).toContain("app-select-selected");
    expect(separator).toContain("app-select-separator");
  });

  it("gives cmdk the same surface and state classes", () => {
    const content = renderToStaticMarkup(<Command>Options</Command>);
    const item = renderToStaticMarkup(<CommandItem>One</CommandItem>);
    const separator = renderToStaticMarkup(<CommandSeparator />);

    expect(content).toContain("app-select-content");
    expect(item).toContain("app-select-item");
    expect(item).toContain("app-select-focus");
    expect(item).toContain("app-select-selected");
    expect(separator).toContain("app-select-separator");
  });
});
