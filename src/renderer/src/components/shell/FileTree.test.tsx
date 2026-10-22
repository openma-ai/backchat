/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/file-icons", () => ({ fileIconUrl: () => "/file.svg", folderIconUrl: () => "/folder.svg" }));
const elements: HTMLDivElement[] = [];
afterEach(() => { elements.splice(0).forEach((e) => e.remove()); vi.unstubAllGlobals(); });
it("loads nested directories on demand and opens a third-level file", async () => {
  const list = vi.fn(async ({ path }: { path: string }) => ({
    "/repo": [{ name: "src", isDir: true }],
    "/repo/src": [{ name: "components", isDir: true }],
    "/repo/src/components": [{ name: "Button.tsx", isDir: false }],
  })[path] ?? []);
  Object.defineProperty(window, "backchat", { configurable: true, value: { uiFsListDir: list } });
  const host = document.createElement("div"); document.body.append(host); elements.push(host);
  const root = createRoot(host);
  const open = vi.fn();
  const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
  await act(async () => root.render(<FileTree rootPath="/repo" onOpenFile={open} />));
  await settle();
  expect(list).toHaveBeenCalledWith({ path: "/repo" });
  expect(list).not.toHaveBeenCalledWith({ path: "/repo/src" });
  const click = async (name: string) => {
    const row = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((e) => e.textContent?.includes(name));
    expect(row, name).toBeTruthy();
    await act(async () => row!.click()); await settle();
  };
  await click("src");
  await click("components");
  await click("Button.tsx");
  expect(open).toHaveBeenCalledWith("/repo/src/components/Button.tsx");
  await click("src");
  expect(host.textContent).not.toContain("Button.tsx");
  await click("src");
  expect(host.textContent).toContain("Button.tsx");
  expect(list.mock.calls.filter(([request]) => request.path === "/repo/src")).toHaveLength(1);
  await act(async () => root.unmount());
});
