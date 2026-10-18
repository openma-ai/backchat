import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

import {
  cancelPendingFor,
  createTerminal,
  killTerminal,
  releaseTerminal,
  terminalOutput,
  terminateAllTerminals,
  waitForTerminalExit,
} from "./brokers";

const posix = process.platform !== "win32";
const SESSION = "sess-process-group";
const spawnedPids: number[] = [];

afterEach(() => {
  cancelPendingFor(SESSION);
  for (const pid of spawnedPids.splice(0)) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
}

/** A shell that backgrounds a long sleep (a grandchild of the app) and
 *  prints the grandchild pid, like `npm run dev` leaving a server behind. */
async function startWithGrandchild(script: string): Promise<{ terminalId: string; grandchild: number }> {
  const { terminalId } = createTerminal(SESSION, process.cwd(), {
    command: "/bin/sh",
    args: ["-c", script],
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { output } = terminalOutput({ terminalId }) as { output: string };
    const match = /pid=(\d+)/.exec(output);
    if (match) {
      const grandchild = Number(match[1]);
      spawnedPids.push(grandchild);
      return { terminalId, grandchild };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("grandchild pid not reported");
}

describe.runIf(posix)("ACP terminal process groups", () => {
  it("release stops grandchildren, not only the direct child", async () => {
    const { terminalId, grandchild } = await startWithGrandchild(
      "sleep 60 & echo pid=$!; wait",
    );
    expect(alive(grandchild)).toBe(true);
    releaseTerminal({ terminalId });
    expect(await gone(grandchild, 1_000)).toBe(true);
  });

  it("user kill stops the whole group", async () => {
    const { terminalId, grandchild } = await startWithGrandchild(
      "sleep 60 & echo pid=$!; wait",
    );
    killTerminal({ terminalId });
    await waitForTerminalExit({ terminalId });
    expect(await gone(grandchild, 1_000)).toBe(true);
  });

  it("escalates to SIGKILL when the group ignores SIGTERM", async () => {
    const { terminalId, grandchild } = await startWithGrandchild(
      "trap '' TERM; sh -c \"trap '' TERM; sleep 60\" & echo pid=$!; wait",
    );
    releaseTerminal({ terminalId });
    expect(await gone(grandchild, 500)).toBe(false);
    expect(await gone(grandchild, 4_500)).toBe(true);
  }, 10_000);

  it("shutdown waits until every group is gone", async () => {
    const first = await startWithGrandchild("sleep 60 & echo pid=$!; wait");
    const second = await startWithGrandchild(
      "trap '' TERM; sh -c \"trap '' TERM; sleep 60\" & echo pid=$!; wait",
    );
    await terminateAllTerminals();
    expect(alive(first.grandchild)).toBe(false);
    expect(alive(second.grandchild)).toBe(false);
  }, 10_000);
});
