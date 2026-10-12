/**
 * @vitest-environment happy-dom
 */
import { act, createRef, type ErrorInfo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRendererCrashHandlersForTest } from "@/lib/renderer-crash-report";
import { RendererErrorBoundary } from "./RendererErrorBoundary";

const rendererCrashLog = vi.fn().mockResolvedValue(undefined);

let container: HTMLDivElement;
let root: Root | null = null;

function Thrower(): never {
  throw new Error("kaboom");
}

async function render(node: React.ReactNode): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
}

beforeEach(() => {
  resetRendererCrashHandlersForTest();
  rendererCrashLog.mockClear();
  (window as unknown as Record<string, unknown>).backchat = {
    rendererCrashLog,
    onSettingsChanged: () => () => {},
    settingsGet: async () => null,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  // React reports caught errors to console.error — keep the test log quiet.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  container.remove();
  delete (window as unknown as Record<string, unknown>).backchat;
  vi.restoreAllMocks();
});

describe("RendererErrorBoundary", () => {
  it("renders children when nothing throws", async () => {
    await render(
      <RendererErrorBoundary>
        <p>healthy</p>
      </RendererErrorBoundary>,
    );

    expect(container.textContent).toContain("healthy");
    expect(container.querySelector("[data-renderer-crash-page]")).toBeNull();
    expect(rendererCrashLog).not.toHaveBeenCalled();
  });

  it("reports the error and swaps in the crash page with a matching error id", async () => {
    await render(
      <RendererErrorBoundary>
        <Thrower />
      </RendererErrorBoundary>,
    );

    expect(rendererCrashLog).toHaveBeenCalledTimes(1);
    const report = rendererCrashLog.mock.calls[0][0] as {
      source: string;
      errorId: string;
      message: string;
      stack?: string;
      componentStack?: string;
    };
    expect(report.source).toBe("error-boundary");
    expect(report.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(report.message).toBe("kaboom");
    expect(report.stack).toContain("kaboom");
    expect(report.componentStack).toContain("Thrower");

    // The crash page shows the same errorId the log entry carries.
    const page = container.querySelector("[data-renderer-crash-page]");
    expect(page).not.toBeNull();
    expect(
      container.querySelector("[data-renderer-crash-error-id]")?.textContent,
    ).toContain(report.errorId);
    expect(container.textContent).toContain("Error details");
  });

  it("renders a fallback message and omits empty context fields", async () => {
    const boundary = createRef<RendererErrorBoundary>();

    await render(
      <RendererErrorBoundary ref={boundary}>
        <p>healthy</p>
      </RendererErrorBoundary>,
    );

    // React can hand componentDidCatch an error with an empty message and
    // no componentStack — the crash view must still be self-explanatory.
    const error = new Error("");
    await act(async () => {
      boundary.current!.setState({ error });
      boundary.current!.componentDidCatch(error, {
        componentStack: "",
      } as ErrorInfo);
    });

    const report = rendererCrashLog.mock.calls.at(-1)?.[0] as {
      message: string;
      componentStack?: string;
      errorId: string;
    };
    expect(report.message).toBe("Error");
    expect(report.componentStack).toBeUndefined();
    expect(container.querySelector("[data-renderer-crash-page]")).not.toBeNull();

    const detailsTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Error details"));
    await act(async () => {
      detailsTrigger!.click();
    });
    expect(
      container.querySelector("[data-renderer-crash-details]")?.textContent,
    ).toContain("Unknown error");
  });
});
