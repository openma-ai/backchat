import type { ReactNode } from "react";
import { AgentChatView } from "@openma/common/chat-ui";
import type { AgentUITurnState } from "@openma/common/agent-ui";
import type { Turn } from "@/lib/session-store";
import { MarkdownCwdProvider } from "./ChatMarkdown";
import { ProjectMessageAttachments } from "./ProjectMessageAttachments";
import { TurnBlock } from "./ChatTurn";

/** Project delivery stays in OpenMatter while the visible chat stays identical. */
export function ProjectConversation({
  turns,
  cwd,
  composer,
  promptPayloads,
}: {
  turns: readonly Turn[];
  cwd: string | null;
  composer: ReactNode;
  promptPayloads?: ReadonlyMap<string, unknown>;
}) {
  const chatTurns: AgentUITurnState[] = turns.map((turn) => ({
    id: turn.id,
    status: turn.status === "complete" ? "completed" : turn.status === "error" ? "failed" : turn.status,
    items: [],
  }));
  const turnsById = new Map(turns.map((turn) => [turn.id, turn] as const));
  return (
    <AgentChatView
      surface="project"
      sessionId={turns.at(-1)?.sessionId}
      phase="active"
      className="flex-1 text-sm"
      turns={chatTurns}
      renderTurn={({ turn }) => {
        const source = turnsById.get(turn.id);
        return source ? (
          <>
            <ProjectMessageAttachments payload={promptPayloads?.get(turn.id)} />
            <TurnBlock turn={source} />
          </>
        ) : null;
      }}
      slots={{
        empty: null,
        composer,
        wrapConversationContent: (content) => (
          <MarkdownCwdProvider cwd={cwd}>{content}</MarkdownCwdProvider>
        ),
      }}
    />
  );
}
