import type { Page } from "@playwright/test";

import type {
  PromptAttachment,
  SessionPromptParams,
  SessionRunCommandParams,
  SessionSetConfigOptionParams,
} from "../src/shared/session-events.js";

export type SessionRowFixture = {
  session_id: string;
  agent_id: string;
  cwd: string;
  acp_session_id?: string;
};

export type PersistedSessionFixture = {
  sessionId: string;
  agentId?: string;
  cwd?: string;
  acpSessionId?: string;
  title?: string;
  events: Array<{ type: string; data: unknown; ts?: number }>;
};

export type ExportSessionFilesResult = {
  sessions: Array<{
    sessionId: string;
    eventCount: number;
    transcriptPath: string;
    metadataPath: string;
    skipped: boolean;
  }>;
  pairs: Array<{ pairId: string; metadataPath: string; skipped: boolean }>;
};

export type AgentSetupFixture = {
  agents: unknown[];
  authenticateResults?: Record<string, unknown[]>;
  probeResults?: Record<string, unknown[]>;
};

/** Typed access to the dev-only preload bridge used by E2E setup/assertions. */
export class TestBridge {
  constructor(readonly page: Page) {}

  async injectSessionRow(fixture: SessionRowFixture): Promise<void> {
    await this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      await window.__backchatTest.injectSessionRow(payload);
    }, fixture);
  }

  async injectSessionEvent(event: unknown): Promise<void> {
    await this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      await window.__backchatTest.injectSessionEvent(payload);
    }, event);
  }

  async beginBrokerRequest(request: {
    kind: "permission" | "fs-write" | "elicitation-form" | "elicitation-url" | "terminal";
    sessionId: string;
    cwd?: string;
    agentId?: string;
    params: Record<string, unknown>;
  }): Promise<{ started: true } | { terminalId: string }> {
    return this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      return window.__backchatTest.beginBrokerRequest(payload);
    }, request);
  }

  async persistSessionFixture(fixture: PersistedSessionFixture): Promise<void> {
    await this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      await window.__backchatTest.persistSessionFixture(payload);
    }, fixture);
  }

  async exportSessionFiles(
    options: { overwrite?: boolean } = {},
  ): Promise<ExportSessionFilesResult> {
    return this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      return window.__backchatTest.exportSessionFiles(payload);
    }, options);
  }

  async readSessionPrompts(): Promise<SessionPromptParams[]> {
    return this.page.evaluate(async () => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      return window.__backchatTest.readSessionPrompts();
    });
  }

  async readSessionCommands(): Promise<SessionRunCommandParams[]> {
    return this.page.evaluate(async () => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      return window.__backchatTest.readSessionCommands();
    });
  }

  async readSessionConfigOptions(): Promise<SessionSetConfigOptionParams[]> {
    return this.page.evaluate(async () => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      return window.__backchatTest.readSessionConfigOptions();
    });
  }

  async setPickedFiles(attachments: PromptAttachment[]): Promise<void> {
    await this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      await window.__backchatTest.setPickedFiles(payload);
    }, attachments);
  }

  async setPickedDirs(directories: string[]): Promise<void> {
    await this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      await window.__backchatTest.setPickedDirs(payload);
    }, directories);
  }

  async setAgentSetupFixture(fixture: AgentSetupFixture): Promise<void> {
    await this.page.evaluate(async (payload) => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      await window.__backchatTest.setAgentSetupFixture(payload);
    }, fixture);
  }

  async readAgentSetupCalls(): Promise<unknown[]> {
    return this.page.evaluate(async () => {
      // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
      return window.__backchatTest.agentSetupCalls();
    });
  }

  async browserTool<T>(
    taskId: string,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    return this.page.evaluate(
      ({ taskId, name, args }) => {
        // @ts-expect-error — only exposed when BACKCHAT_TEST_HOOKS=1
        return window.__backchatTest.browserTool({ taskId, name, args });
      },
      { taskId, name, args },
    );
  }
}
