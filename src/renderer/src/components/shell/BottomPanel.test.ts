import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BottomPanel terminal cancellation contract", () => {
  it("uses the shared panel and raised surface vocabulary", () => {
    const panel = readFileSync(new URL("./BottomPanel.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
    const terminal = readFileSync(new URL("./TerminalTab.tsx", import.meta.url), "utf8");

    expect(shell).toContain('"app-panel-surface rounded-2xl"');
    expect(panel).toContain("app-raised-surface");
    expect(terminal).toContain('background: "var(--bg-surface)"');
    expect(terminal).toContain("app-raised-surface");
  });

  it("keeps a running tab mounted until xterm can paint its cancelled state", () => {
    const source = readFileSync(new URL("./BottomPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("cancellationRequested: true");
    expect(source).toContain("cancellationRequested={t.cancellationRequested}");
    expect(source).toContain('aria-label={t.alive ? "Cancel terminal" : "Close terminal"}');
    expect(source).toContain('data-testid="foreground-terminal-close"');
  });

  it("keeps foreground terminal tabs isolated by the active session", () => {
    const source = readFileSync(new URL("./BottomPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("const sessionKey = active?.id ?? NO_SESSION_BUCKET");
    expect(source).toContain("const [buckets, setBuckets]");
    expect(source).toContain("buckets[sessionKey]");
    expect(source).not.toContain("const [tabs, setTabs]");
  });
});
