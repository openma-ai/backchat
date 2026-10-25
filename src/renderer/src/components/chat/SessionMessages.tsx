import type { SessionMessage } from "@/lib/subagent-sessions";
import { StreamdownText } from "./ChatMarkdown";
import { ToolContentRenderer } from "./ToolPresentation";
import type { ToolContentBlock } from "@/lib/reduce-turn";

/** Agent-to-agent communication is not a human prompt or assistant reply. */
export function SessionMessages({ messages }: { messages: readonly SessionMessage[] }) {
  if (!messages.length) return null;
  return <section data-session-messages className="my-4 space-y-3">
    {messages.map((message) => <article key={message.messageId} className="rounded-lg border border-border p-3">
      <div className="mb-2 text-xs text-muted-foreground">
        {message.senderSessionId ?? "Agent"} → {message.recipientSessionId ?? "Agent"}
      </div>
      {(message.content ?? []).map((content, index) => {
        if (!content || typeof content !== "object") return null;
        const block = content as Record<string, unknown>;
        return block.type === "text" && typeof block.text === "string"
          ? <StreamdownText key={index} text={block.text} cwd={null} sessionId="" surfacePrefix="session-message" />
          : <ToolContentRenderer key={index} block={{ type: "content", content } as ToolContentBlock} />;
      })}
    </article>)}
  </section>;
}
