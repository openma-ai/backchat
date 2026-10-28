import type { SessionMessage } from "@/lib/subagent-sessions";
import { StreamdownText } from "./ChatMarkdown";
import { ASSISTANT_MARKDOWN_CLASS, USER_PROMPT_MARKDOWN_CLASS } from "./ChatMarkdown";
import { ToolContentRenderer } from "./ToolPresentation";
import type { ToolContentBlock } from "@/lib/reduce-turn";
import { cn } from "@/lib/utils";

function messageText(message: SessionMessage): string {
  return (message.content ?? [])
    .flatMap((content) => {
      if (!content || typeof content !== "object") return [];
      const block = content as Record<string, unknown>;
      return block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("");
}

function isFromParent(message: SessionMessage, childAcpSessionId?: string): boolean {
  if (!message.senderSessionId) return false;
  if (childAcpSessionId && message.senderSessionId === childAcpSessionId) {
    return false;
  }
  if (message.recipientSessionId && childAcpSessionId) {
    return message.recipientSessionId === childAcpSessionId;
  }
  return true;
}

/** Agent-to-agent RFD session_message rows. Render like main-chat bubbles —
 *  parent instructions as user bubbles, child replies as assistant text —
 *  instead of a gray UUID→UUID activity card. */
export function SessionMessages({
  messages,
  childAcpSessionId,
  hideTexts = [],
}: {
  messages: readonly SessionMessage[];
  /** When set, messages sent by this ACP session render as assistant bubbles. */
  childAcpSessionId?: string;
  /** Exact text bodies already shown in the turn transcript (e.g. assistantText). */
  hideTexts?: readonly string[];
}) {
  const hidden = new Set(hideTexts.filter((text) => text.trim().length > 0));
  const visible = messages.filter((message) => {
    const text = messageText(message).trim();
    return !text || !hidden.has(text);
  });
  if (!visible.length) return null;

  return (
    <section data-session-messages className="my-3 space-y-3">
      {visible.map((message) => {
        const fromParent = isFromParent(message, childAcpSessionId);
        return (
          <article
            key={message.messageId}
            data-session-message-role={fromParent ? "user" : "assistant"}
            className={cn(
              "flex w-full flex-col gap-1",
              fromParent ? "items-end" : "items-start",
            )}
          >
            <div
              className={cn(
                fromParent
                  ? "is-user:dark ml-auto flex w-fit min-w-0 max-w-[95%] flex-col gap-2 overflow-hidden rounded-lg bg-secondary px-4 py-3 text-sm text-foreground"
                  : "w-full min-w-0 max-w-[95%] text-sm text-foreground",
              )}
            >
              {(message.content ?? []).map((content, index) => {
                if (!content || typeof content !== "object") return null;
                const block = content as Record<string, unknown>;
                return block.type === "text" && typeof block.text === "string" ? (
                  fromParent ? (
                    <StreamdownText
                      key={index}
                      className={USER_PROMPT_MARKDOWN_CLASS}
                      text={block.text}
                      cwd={null}
                      sessionId=""
                      surfacePrefix="session-message"
                    />
                  ) : (
                    <StreamdownText
                      key={index}
                      className={ASSISTANT_MARKDOWN_CLASS}
                      text={block.text}
                      cwd={null}
                      sessionId=""
                      surfacePrefix="session-message"
                    />
                  )
                ) : (
                  <ToolContentRenderer
                    key={index}
                    block={{ type: "content", content } as ToolContentBlock}
                  />
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}
