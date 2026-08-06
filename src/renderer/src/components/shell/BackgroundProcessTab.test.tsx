import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "rightPanel.running": "Running",
      "rightPanel.exited": "Exited",
      "rightPanel.failed": "Failed",
      "rightPanel.cancelled": "Cancelled",
      "rightPanel.cancelling": "Cancelling",
      "rightPanel.stop": "Stop",
      "rightPanel.waitingForOutput": "Waiting for output…",
      "rightPanel.outputTruncated": "Earlier output was truncated.",
    })[key] ?? key,
  }),
}));

import * as backgroundProcessModule from "./BackgroundProcessTab";
import type { AcpTerminalSnapshot } from "@shared/api.js";

const runningSnapshot: AcpTerminalSnapshot = {
  sessionId: "session-1",
  terminalId: "term-acceptance-1",
  command: "pnpm",
  args: ["test"],
  cwd: "/tmp/backchat",
  startedAt: 1,
  exited: false,
  exitCode: null,
  signal: null,
  output: "42 tests passed\n",
  truncated: false,
};

describe("BackgroundProcessTab GUI contract", () => {
  it("renders a stable terminal reverse-callback detail surface", () => {
    const Details = (
      backgroundProcessModule as typeof backgroundProcessModule & {
        BackgroundProcessDetails?: React.ComponentType<{
          snapshot: AcpTerminalSnapshot;
          killing: boolean;
          onStop: () => void;
        }>;
      }
    ).BackgroundProcessDetails;

    expect(Details).toBeTypeOf("function");
    if (!Details) return;
    const html = renderToStaticMarkup(
      <Details snapshot={runningSnapshot} killing={false} onStop={vi.fn()} />,
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('data-testid="background-terminal-detail"');
    expect(html).toContain('data-callback-kind="terminal"');
    expect(html).toContain('data-terminal-id="term-acceptance-1"');
    expect(html).toContain('data-terminal-status="running"');
    expect(html).toContain("pnpm test");
    expect(html).toContain("/tmp/backchat");
    expect(html).toContain('data-testid="background-terminal-output"');
    expect(html).toContain("42 tests passed");
    expect(html).toContain('data-testid="background-terminal-stop"');
    expect(html).toContain('aria-label="Stop background process"');
  });

  it("keeps exit, failure, and cancellation outcomes visible", () => {
    const present = (
      backgroundProcessModule as typeof backgroundProcessModule & {
        backgroundProcessStatus?: (
          snapshot: AcpTerminalSnapshot,
          killing?: boolean,
        ) => { status: string; label: string };
      }
    ).backgroundProcessStatus;

    expect(present).toBeTypeOf("function");
    if (!present) return;
    expect(present({ ...runningSnapshot, exited: true, exitCode: 0 })).toEqual({
      status: "exited",
      label: "Exited · code 0",
    });
    expect(present({ ...runningSnapshot, exited: true, exitCode: 2 })).toEqual({
      status: "failed",
      label: "Failed · code 2",
    });
    expect(present({
      ...runningSnapshot,
      exited: true,
      exitCode: null,
      signal: "SIGTERM",
      terminationReason: "user_kill",
    } as AcpTerminalSnapshot)).toEqual({
      status: "cancelled",
      label: "Cancelled · SIGTERM",
    });
  });

  it("preserves the Stop reason delivered by the terminal exit frame", () => {
    const applyExit = (
      backgroundProcessModule as typeof backgroundProcessModule & {
        backgroundSnapshotAfterExit?: (
          snapshot: AcpTerminalSnapshot,
          frame: {
            exitCode: number | null;
            signal: string | null;
            terminationReason?: "user_kill";
          },
        ) => AcpTerminalSnapshot;
      }
    ).backgroundSnapshotAfterExit;

    expect(applyExit).toBeTypeOf("function");
    if (!applyExit) return;
    expect(applyExit(runningSnapshot, {
      exitCode: null,
      signal: "SIGTERM",
      terminationReason: "user_kill",
    })).toMatchObject({
      exited: true,
      exitCode: null,
      signal: "SIGTERM",
      terminationReason: "user_kill",
    });
  });
});
