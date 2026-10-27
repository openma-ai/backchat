/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleInfo } from "@shared/schedules.js";
import type { SubagentActivity } from "@/lib/session-store";
import { RightPanelLauncher } from "./RightPanelLauncher";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const interactiveRoots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of interactiveRoots.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
});

function schedule(overrides: Partial<ScheduleInfo> = {}): ScheduleInfo {
  return {
    id: "schedule-1",
    name: "Refresh release notes",
    prompt: "Refresh the release notes.",
    trigger: { type: "interval", everyMs: 60_000 },
    target: "current_task",
    status: "active",
    notificationPolicy: "failures",
    sourceSessionId: "session-1",
    agentId: "codex",
    cwd: "/tmp/project",
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 2,
    lastRunAt: null,
    ...overrides,
  };
}

function subagent(
  overrides: Partial<SubagentActivity> = {},
): SubagentActivity {
  return {
    parentSessionId: "session-1",
    childSessionId: "child-session-1",
    viewSessionId: "child-session-1",
    avatarId: "1_01",
    inheritance: "fresh",
    task: "Audit source handling",
    status: "running",
    startedAt: 1,
    updatedAt: 1,
    native: {
      provider: "opencode",
      childThreadId: "child-session-1",
      agentType: "explore",
    },
    ...overrides,
  };
}

describe("RightPanelLauncher", () => {
  it("places product actions above left-aligned resource categories", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: ["/tmp/project/release-notes.pptx"], services: [], sources: [] },
      subagents: [],
      processes: [],
      schedules: [schedule()],
      sourceAttachments: [
        {
          id: "attachment-1",
          name: "reference.png",
          path: "/tmp/project/reference.png",
          uri: "file:///tmp/project/reference.png",
          kind: "image",
          mimeType: "image/png",
        },
      ],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    const actionsIndex = markup.indexOf('data-new-actions="true"');
    const resourcesIndex = markup.indexOf('data-resource-list="true"');

    expect(actionsIndex).toBeGreaterThanOrEqual(0);
    expect(resourcesIndex).toBeGreaterThan(actionsIndex);
    expect(markup).toContain('data-new-action="chat"');
    expect(markup).toContain('data-new-action="file"');
    expect(markup).toContain('data-new-action="browser"');
    expect(markup).toContain('data-new-action="terminal"');
    expect(markup).toContain('data-resource-category="outputs"');
    expect(markup).toContain('data-resource-category="background"');
    expect(markup).toContain('data-resource-category="sources"');
    expect(markup).toContain("release-notes.pptx");
    expect(markup).toContain("Refresh release notes");
    expect(markup).toContain("reference.png");
    expect(markup).not.toContain("rightPanel.projectFiles");
    expect(markup).not.toContain("text-center");
  });

  it("shows registered background tasks in the task workspace", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      processes: [],
      schedules: [schedule()],
    } as React.ComponentProps<typeof RightPanelLauncher> & {
      schedules: ScheduleInfo[];
    };

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);

    expect(markup).toContain("Refresh release notes");
    expect(markup).toContain('data-resource-list="true"');
  });

  it("projects non-agent canonical work items into Background", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      workItems: [
        {
          id: "bash-1",
          kind: "bash" as const,
          status: "running" as const,
          title: "pnpm test",
          output: [],
        },
      ],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    const backgroundSection =
      markup.match(/data-resource-category="background"[\s\S]*?<\/section>/)?.[0];

    expect(backgroundSection).toContain("pnpm test");
    expect(backgroundSection).toContain("running");
    expect(backgroundSection).toContain('data-resource-id="bash-1"');
    expect(backgroundSection).toContain('data-resource-status="running"');
    expect(backgroundSection).toContain('data-resource-kind="background"');
    expect(markup).not.toContain('data-resource-category="agents"');
  });

  it("keeps Monitor subscriptions out of the generic Background section", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      workItems: [{
        id: "monitor-1",
        kind: "monitor" as const,
        status: "running" as const,
        title: "Watch production alerts",
        output: [],
      }],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);

    expect(markup).not.toContain("Watch production alerts");
    expect(markup).not.toContain('data-resource-category="background"');
  });

  it("uses the canonical terminal work item without duplicating its process row", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      workItems: [
        {
          id: "term-1",
          kind: "bash" as const,
          status: "running" as const,
          title: "pnpm test",
          output: [],
        },
      ],
      processes: [
        {
          sessionId: "session-1",
          terminalId: "term-1",
          command: "pnpm",
          args: ["test"],
          cwd: "/tmp/project",
          startedAt: 1,
          exited: false,
          exitCode: null,
          signal: null,
        },
      ],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    const backgroundSection =
      markup.match(/data-resource-category="background"[\s\S]*?<\/section>/)?.[0] ?? "";

    expect(backgroundSection.match(/<button/g)).toHaveLength(1);
    expect(backgroundSection).toContain("pnpm test");
    expect(backgroundSection).toContain('data-callback-kind="terminal"');
    expect(backgroundSection).toContain('data-terminal-id="term-1"');
    expect(backgroundSection).toContain('data-resource-status="running"');
    expect(backgroundSection).not.toMatch(/<button[^>]*\sdisabled(?:=|>)/);
  });

  it("shows subagents in Agents instead of Background", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [subagent()],
      processes: [],
      schedules: [schedule()],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    const agentsSection =
      markup.match(/data-resource-category="agents"[\s\S]*?<\/section>/)?.[0];
    const backgroundSection =
      markup.match(/data-resource-category="background"[\s\S]*?<\/section>/)?.[0];

    expect(agentsSection).toContain("Aster");
    expect(agentsSection).toContain("rightPanel.agents");
    expect(backgroundSection).toContain("Refresh release notes");
    expect(backgroundSection).not.toContain("Audit source handling");
  });

  it("shows structured per-agent token usage in the existing Agent row hint", () => {
    const activity = subagent({
      childSessionId: "agent-usage-1",
      native: {
        provider: "claude",
        childThreadId: "agent-usage-1",
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          cachedReadTokens: 30,
          cachedWriteTokens: 10,
          totalTokens: 110,
        },
      },
    });
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [activity],
      workItems: [{
        id: "agent-usage-1",
        kind: "agent" as const,
        status: "running" as const,
        title: "Inspect token accounting",
        output: [],
      }],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    const agentsSection =
      markup.match(/data-resource-category="agents"[\s\S]*?<\/section>/)?.[0] ?? "";

    expect(agentsSection).toContain("running · 110 tokens");
  });

  it("shows Claude total-only progress tokens without inventing billed usage", () => {
    const activity = subagent({
      childSessionId: "agent-progress-1",
      native: {
        provider: "claude",
        childThreadId: "agent-progress-1",
        progress: {
          kind: "subagent_progress",
          usage: { totalTokens: 901, toolUses: 4, durationMs: 1_250 },
        },
      },
    });
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [activity],
      workItems: [{
        id: "agent-progress-1",
        kind: "agent" as const,
        status: "running" as const,
        title: "Inspect token accounting",
        output: [],
      }],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    const agentsSection =
      markup.match(/data-resource-category="agents"[\s\S]*?<\/section>/)?.[0] ?? "";

    expect(agentsSection).toContain("running · 901 tokens");
    expect(activity.native?.usage).toBeUndefined();
  });

  it("omits resource categories that have no task items", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);

    expect(markup).not.toContain('data-resource-category="outputs"');
    expect(markup).not.toContain('data-resource-category="agents"');
    expect(markup).not.toContain('data-resource-category="background"');
    expect(markup).not.toContain('data-resource-category="sources"');
    expect(markup).not.toContain("rightPanel.projectFiles");
  });

  it("does not present a detected local website as an Output", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: {
        files: [],
        services: ["http://localhost:4173"],
        sources: [],
      },
      subagents: [],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);

    expect(markup).not.toContain('data-resource-category="outputs"');
    expect(markup).not.toContain("localhost:4173");
  });

  it("shows provider-registered WebFetch URLs as sources", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: {
        files: [],
        services: [],
        sources: [
          {
            kind: "web",
            uri: "https://example.com/docs",
            label: "OpenMA docs",
          },
        ],
      },
      subagents: [],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);

    expect(markup).toContain("OpenMA docs");
    expect(markup).toContain("https://example.com/docs");
  });

  it("shows files and images attached to the task prompt as sources", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      processes: [],
      schedules: [],
      sourceAttachments: [
        {
          id: "attachment-1",
          name: "reference-board.png",
          path: "/tmp/reference-board.png",
          uri: "file:///tmp/reference-board.png",
          kind: "image",
          mimeType: "image/png",
        },
      ],
    } as React.ComponentProps<typeof RightPanelLauncher> & {
      sourceAttachments: Array<{
        id: string;
        name: string;
        path: string;
        uri: string;
        kind: "image";
        mimeType: string;
      }>;
    };

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);

    expect(markup).toContain("reference-board.png");
    expect(markup).toContain("/tmp/reference-board.png");
  });

  it("keeps a user attachment in Sources even if a tool also touched its path", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: {
        files: ["/tmp/user-upload.pptx"],
        services: [],
        sources: [],
      },
      subagents: [],
      processes: [],
      schedules: [],
      sourceAttachments: [
        {
          id: "attachment-1",
          name: "user-upload.pptx",
          path: "/tmp/user-upload.pptx",
          uri: "file:///tmp/user-upload.pptx",
          kind: "file",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      ],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);

    expect(markup).not.toContain('data-resource-category="outputs"');
    expect(markup).toContain('data-resource-category="sources"');
  });

  it("shows a fresh side-chat hint when fork inheritance is unavailable", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      canForkSideChat: false,
      browserEnabled: false,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      processes: [],
      schedules: [],
      sourceAttachments: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    expect(markup).toContain("sideChat.freshHint");
    expect(markup).not.toContain("sideChat.forkHint");
  });

  it("hides the Subagents NewAction when no subagents or agent work items exist", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [],
      workItems: [],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    expect(markup).not.toContain('data-new-action="subagents"');
  });

  it("shows the Subagents NewAction alongside other New actions when subagents exist", () => {
    const props = {
      onPick: vi.fn(),
      onPickSubagent: vi.fn(),
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [subagent()],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const markup = renderToStaticMarkup(<RightPanelLauncher {...props} />);
    const actionsIndex = markup.indexOf('data-new-actions="true"');
    const subagentsActionIndex = markup.indexOf('data-new-action="subagents"');
    expect(subagentsActionIndex).toBeGreaterThan(actionsIndex);
    expect(markup).toContain("rightPanel.subagents");
    expect(markup).toContain("rightPanel.subagentsHint");
    expect(markup).toContain('data-new-view="actions"');
  });

  it("opens the subagent list from the NewAction and enters a picked subagent", () => {
    const onPickSubagent = vi.fn();
    const activity = subagent();
    const props = {
      onPick: vi.fn(),
      onPickSubagent,
      onPickProcess: vi.fn(),
      onOpenSchedule: vi.fn(),
      canStartSideChat: true,
      browserEnabled: true,
      artifacts: { files: [], services: [], sources: [] },
      subagents: [activity],
      processes: [],
      schedules: [],
    } as React.ComponentProps<typeof RightPanelLauncher>;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    interactiveRoots.push({ root, host });

    act(() => {
      root.render(<RightPanelLauncher {...props} />);
    });

    const entry = host.querySelector('[data-new-action="subagents"]');
    expect(entry).not.toBeNull();
    act(() => {
      entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector('[data-new-view="subagents"]')).not.toBeNull();
    expect(host.querySelector("[data-new-subagents-list]")).not.toBeNull();
    expect(host.querySelector("[data-new-actions]")).toBeNull();
    expect(onPickSubagent).not.toHaveBeenCalled();

    const row = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Aster"),
    );
    expect(row).toBeTruthy();
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onPickSubagent).toHaveBeenCalledTimes(1);
    expect(onPickSubagent).toHaveBeenCalledWith(activity);
  });
});
