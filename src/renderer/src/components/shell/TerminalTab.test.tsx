import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xterm/xterm", () => ({ Terminal: class Terminal {} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class FitAddon {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class WebglAddon {} }));

import * as terminalTabModule from "./TerminalTab";

const { TerminalTab } = terminalTabModule;

describe("TerminalTab GUI contract", () => {
  it("exposes the foreground xterm as an identifiable running terminal", () => {
    const html = renderToStaticMarkup(
      <TerminalTab terminalId="uiterm-acceptance-1" />,
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('data-testid="foreground-terminal"');
    expect(html).toContain('data-terminal-id="uiterm-acceptance-1"');
    expect(html).toContain('data-terminal-status="running"');
    expect(html).toContain('aria-label="Terminal uiterm-acceptance-1"');
    expect(html).toContain("Running");
  });

  it("keeps cancellation visible while the foreground terminal is stopping", () => {
    const props = {
      terminalId: "uiterm-acceptance-2",
      cancellationRequested: true,
    } as React.ComponentProps<typeof TerminalTab> & {
      cancellationRequested: boolean;
    };
    const html = renderToStaticMarkup(<TerminalTab {...props} />);

    expect(html).toContain('data-terminal-status="cancelling"');
    expect(html).toContain("Cancelling");
  });

  it("classifies clean, failed, and cancelled terminal exits for the visible badge", () => {
    const presentation = (
      terminalTabModule as typeof terminalTabModule & {
        terminalStatusPresentation?: (
          exit: { exitCode: number | null; signal: string | null } | null,
          cancellationRequested?: boolean,
        ) => { status: string; label: string };
      }
    ).terminalStatusPresentation;

    expect(presentation).toBeTypeOf("function");
    if (!presentation) return;
    expect(presentation({ exitCode: 0, signal: null })).toEqual({
      status: "exited",
      label: "Exited · code 0",
    });
    expect(presentation({ exitCode: 7, signal: null })).toEqual({
      status: "failed",
      label: "Failed · code 7",
    });
    expect(
      presentation({ exitCode: null, signal: "SIGTERM" }, true),
    ).toEqual({
      status: "cancelled",
      label: "Cancelled · SIGTERM",
    });
  });
});
