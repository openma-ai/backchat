/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RendererCrashPage } from "./RendererCrashPage";

describe("RendererCrashPage", () => {
  it("renders the error id that matches the log entry", () => {
    const html = renderToStaticMarkup(
      <RendererCrashPage
        errorId="abc12345"
        message="kaboom"
        stack="Error: kaboom"
      />,
    );

    expect(html).toContain('data-renderer-crash-error-id="true"');
    expect(html).toContain("abc12345");
    expect(html).toContain('data-renderer-crash-page="true"');
    expect(html).toContain("Something went wrong");
  });

  it("omits the error-id row when no id was assigned", () => {
    const html = renderToStaticMarkup(<RendererCrashPage message="kaboom" />);

    expect(html).not.toContain("data-renderer-crash-error-id");
  });

  describe("interactions", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      (window as unknown as Record<string, unknown>).backchat = {
        onSettingsChanged: () => () => {},
        settingsGet: async () => null,
      };
    });

    afterEach(async () => {
      delete (window as unknown as Record<string, unknown>).backchat;
      if (root) {
        await act(async () => {
          root!.unmount();
        });
        root = null;
      }
      container.remove();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("copies crash details headed by the error id", async () => {
      vi.useFakeTimers();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      await act(async () => {
        root = createRoot(container);
        root.render(
          <RendererCrashPage
            errorId="abc12345"
            message="kaboom"
            stack="Error: kaboom"
          />,
        );
      });

      const [copyButton] = Array.from(
        container.querySelectorAll("button"),
      ).filter((b) => b.textContent === "Copy error info");
      expect(copyButton).toBeDefined();
      await act(async () => {
        copyButton.click();
      });

      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("Error ID: abc12345"),
      );
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("kaboom"),
      );
      expect(copyButton.textContent).toBe("Copied");

      // The label settles back to idle after the confirmation delay.
      await act(async () => {
        vi.advanceTimersByTime(2_500);
      });
      expect(copyButton.textContent).toBe("Copy error info");
      vi.useRealTimers();
    });

    it("expands the details collapsible to show stack and component stack", async () => {
      await act(async () => {
        root = createRoot(container);
        root.render(
          <RendererCrashPage
            errorId="abc12345"
            message="kaboom"
            stack="Error: kaboom\n    at render"
            componentStack="    at Thrower"
          />,
        );
      });

      const detailsTrigger = Array.from(
        container.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Error details"));
      expect(detailsTrigger).toBeDefined();
      await act(async () => {
        detailsTrigger!.click();
      });

      const details = container.querySelector("[data-renderer-crash-details]");
      expect(details?.textContent).toContain("Error ID: abc12345");
      expect(details?.textContent).toContain("kaboom");
      expect(details?.textContent).toContain("at Thrower");
      expect(
        detailsTrigger!.querySelector("svg")?.classList.contains("rotate-180"),
      ).toBe(true);
    });

    it("surfaces a copy failure instead of breaking the page", async () => {
      vi.useFakeTimers();
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await act(async () => {
        root = createRoot(container);
        root.render(<RendererCrashPage message="kaboom" />);
      });

      const [copyButton] = Array.from(
        container.querySelectorAll("button"),
      ).filter((b) => b.textContent === "Copy error info");
      await act(async () => {
        copyButton.click();
      });

      expect(copyButton.textContent).toBe("Couldn't copy");

      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      expect(copyButton.textContent).toBe("Copy error info");
      vi.useRealTimers();
    });

    it("reloads the window from the reload button", async () => {
      const reload = vi
        .spyOn(window.location, "reload")
        .mockImplementation(() => undefined);

      await act(async () => {
        root = createRoot(container);
        root.render(<RendererCrashPage message="kaboom" />);
      });

      const [reloadButton] = Array.from(
        container.querySelectorAll("button"),
      ).filter((b) => b.textContent === "Reload");
      expect(reloadButton).toBeDefined();
      await act(async () => {
        reloadButton.click();
      });

      expect(reload).toHaveBeenCalled();
    });
  });
});
