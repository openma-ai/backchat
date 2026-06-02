import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { CircleStopIcon, SendIcon, SparklesIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Streamdown } from "streamdown";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  newDraftSession,
  selectActive,
  selectTurnsFor,
  sessionStore,
  useSessionStore,
  type Turn,
} from "@/lib/session-store";
import { reduceTurn, type TurnRender } from "@/lib/reduce-turn";
import { useSettings } from "@/lib/settings-store";
import { StreamingMarkdown } from "./StreamingMarkdown";

/**
 * ChatView — the right pane.
 *
 * Cold-create flow: if active.status === "draft", the composer's submit
 * promotes the draft (registers agent_id from settings, fires session.start
 * IPC), awaits session.ready via a one-shot subscription, then fires
 * session.prompt. The store flips to "ready" on session.ready.
 *
 * Without an active session in scope (e.g. /chat/$id with an unknown id),
 * the page shows a "start a chat" hint. The user clicks "+ New chat" in the
 * sidebar to get back to a real session.
 */
export function ChatView() {
  const active = useSessionStore(selectActive);
  const turnsSelector = useMemo(
    () =>
      active
        ? selectTurnsFor(active.id)
        : () => [] as ReturnType<ReturnType<typeof selectTurnsFor>>,
    [active?.id],
  );
  const turns = useSessionStore(turnsSelector);
  const settings = useSettings();
  const navigate = useNavigate();

  const onSubmit = async (text: string) => {
    let target = active;
    if (!target) {
      // No session at all — caller pressed Enter on the home page's empty
      // composer. Create a draft on the fly and route to it before
      // continuing. Most users will use the sidebar "+ New chat" instead,
      // but supporting this shape lets the home page act as one-shot ask.
      const sid = newDraftSession();
      target = sessionStore.get(sid)!;
      void navigate({ to: "/chat/$sessionId", params: { sessionId: sid } });
    }
    if (target.status === "draft") {
      const agentId = settings?.default.agent_id || "";
      sessionStore.promoteDraft(target.id, agentId, agentId || "(default agent)");
      // Fire session.start. We don't await — session.ready arrives via the
      // push channel and the store flips status. The prompt below races
      // against ready; SessionManager idempotently handles a prompt-before-
      // ready by erroring out. To keep things deterministic we wait for
      // ready (with a 10s budget) before firing prompt.
      void window.openma.sessionStart({ session_id: target.id, agent_id: agentId });
      await waitForReady(target.id, 10_000);
    }
    const turn_id = `turn-${Math.random().toString(36).slice(2, 10)}`;
    sessionStore.registerTurn(turn_id, target.id, text);
    await window.openma.sessionPrompt({ session_id: target.id, turn_id, text });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent
          className={cn(
            "mx-auto w-full max-w-3xl px-4 py-6",
            "flex min-h-full flex-col justify-end",
          )}
        >
          {!active || active.status === "draft" ? (
            <EmptyStateIntro
              hasDefaultAgent={!!settings?.default.agent_id}
            />
          ) : turns.length === 0 ? (
            <SessionIntro agentId={active.agent_id} cwd={active.cwd} />
          ) : (
            turns.map((turn) => <TurnBlock key={turn.id} turn={turn} />)
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <Composer
        disabled={
          (active?.status === "starting" && !!active?.agent_id) ||
          active?.status === "errored"
        }
        running={active?.status === "running"}
        placeholder={
          !active || active.status === "draft"
            ? "Ask anything to start. Enter to send."
            : active.status === "starting"
              ? "Starting…"
              : active.status === "errored"
                ? "Session errored. Start a new chat."
                : active.status === "running"
                  ? "Working… press Stop to cancel."
                  : "Ask anything. Enter to send, Shift+Enter for newline."
        }
        onSubmit={onSubmit}
        onCancel={() => {
          if (active?.activeTurnId) {
            void window.openma.sessionCancel({
              session_id: active.id,
              turn_id: active.activeTurnId,
            });
          }
        }}
      />

      {active?.status === "errored" && (
        <div className="bg-danger-subtle px-4 py-2 text-xs text-danger">
          {active.lastError ?? "Session errored."}
        </div>
      )}
    </div>
  );
}

/** One-shot await of session.ready for the given session id. Times out
 *  after `ms` and resolves anyway (the prompt will then error and the user
 *  sees the failure via session.error). */
function waitForReady(sessionId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve();
    }, ms);
    const off = window.openma.onSessionEvent((e) => {
      if (
        (e.type === "session.ready" || e.type === "session.error") &&
        e.session_id === sessionId
      ) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

function EmptyStateIntro({ hasDefaultAgent }: { hasDefaultAgent: boolean }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-2 text-center">
      <div className="mx-auto mb-4 inline-flex size-10 items-center justify-center rounded-full bg-brand-subtle text-brand-fg">
        <SparklesIcon className="size-5" />
      </div>
      <h2 className="text-base font-medium text-fg">
        {hasDefaultAgent ? "Start a chat" : "Pick a default agent"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        {hasDefaultAgent
          ? "Type a prompt below to spin up your default ACP agent. Conversation history stays on your machine."
          : "Open Settings → Agents and pick a default agent to use for new chats."}
      </p>
    </div>
  );
}

function SessionIntro({ agentId, cwd }: { agentId: string; cwd: string }) {
  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <div className="mb-3 size-10 rounded-full bg-bg-surface" />
      <h2 className="text-lg font-medium text-fg">
        New session with <span className="font-mono">{agentId}</span>
      </h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        Conversation runs in <span className="font-mono text-fg">{shortPath(cwd)}</span>.
        File access, terminal commands, and tool calls show up here as the
        agent works.
      </p>
    </div>
  );
}

function TurnBlock({ turn }: { turn: Turn }) {
  // For tool calls / plans / available_commands we still depend on the
  // event reducer — those structural pieces want React reconciliation
  // (they're low-frequency and want patch semantics for tool_call_update).
  const rendered: TurnRender = reduceTurn(turn.events);

  const isStreaming = turn.status === "running";
  const hasAssistant = turn.assistantText.length > 0;
  const hasThought = turn.thoughtText.length > 0;
  const hasAnything =
    hasAssistant ||
    hasThought ||
    rendered.tools.length > 0 ||
    rendered.plan.length > 0;

  return (
    <div className="group/turn mb-8 space-y-3" data-turn-id={turn.id}>
      {turn.promptText && (
        <Message from="user">
          <MessageContent>
            <p className="whitespace-pre-wrap">{turn.promptText}</p>
          </MessageContent>
        </Message>
      )}

      {(hasAnything ||
        rendered.notes.length > 0 ||
        (!hasAnything && isStreaming) ||
        turn.status === "error" ||
        turn.status === "cancelled") && (
        <AssistantGutter>
          {rendered.plan.length > 0 && <PlanBlock entries={rendered.plan} />}

          {hasThought && (
            <Reasoning isStreaming={isStreaming} defaultOpen={false}>
              <ReasoningTrigger />
              <ReasoningContent>
                {/* While streaming, render thought via the DOM-mutating
                    track. Once the turn is done, swap to a plain memoized
                    block. ReasoningContent itself is just a Collapsible
                    panel; we replace its inner text view based on status. */}
                {isStreaming ? (
                  <StreamingMarkdown turnId={turn.id} kind="thought" />
                ) : (
                  <div className="whitespace-pre-wrap font-mono text-xs">
                    {turn.thoughtText}
                  </div>
                )}
              </ReasoningContent>
            </Reasoning>
          )}

          {rendered.tools.length > 0 && (
            <div className="space-y-2">
              {rendered.tools.map((t) => (
                <ToolBlock key={t.toolCallId} tool={t} />
              ))}
            </div>
          )}

          {/* Assistant message — the dual track. While the turn streams we
              render via streaming-markdown directly into a ref'd div, no
              React reconciliation per chunk. Once the turn is `complete`
              we hand the final text to <Streamdown> for the canonical
              memoized render with shiki / mermaid / math plugins. The
              swap is a single React render, instant and visually
              continuous because both tracks produce structurally similar
              HTML (paragraphs, lists, code blocks). */}
          {(hasAssistant || isStreaming) && (
            <Message from="assistant">
              <MessageContent>
                {isStreaming ? (
                  <StreamingMarkdown turnId={turn.id} kind="assistant" />
                ) : (
                  // Streamdown's type expects `children?: string` plus
                  // ReactNode (intersection), which TS 6 + React 19 types
                  // interpret as needing multiple children. Spread the
                  // children via a known-good runtime path with the prop
                  // explicitly typed as string.
                  <StreamdownText className={cn(
                    "text-sm leading-relaxed text-fg",
                    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                  )} text={turn.assistantText} />
                )}
              </MessageContent>
            </Message>
          )}

          {rendered.notes.map((note, i) => (
            <p key={i} className="text-xs italic text-fg-muted">
              {note}
            </p>
          ))}

          {!hasAnything && isStreaming && (
            <p className="text-xs text-fg-muted">
              <span className="brand-loader-dot">·</span>{" "}
              <span
                className="brand-loader-dot"
                style={{ animationDelay: "120ms" }}
              >
                ·
              </span>{" "}
              <span
                className="brand-loader-dot"
                style={{ animationDelay: "240ms" }}
              >
                ·
              </span>
            </p>
          )}

          {turn.status === "error" && (
            <p className="rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
              {turn.errorMessage ?? "Turn failed."}
            </p>
          )}
          {turn.status === "cancelled" && (
            <p className="text-xs italic text-fg-subtle">cancelled</p>
          )}
        </AssistantGutter>
      )}
    </div>
  );
}

/** Wraps everything an assistant emits in one turn with a left-side
 *  avatar gutter — tiny dot at the top-left, content offset 32px right.
 *  Anchors the conversation as a vertical column, gives the assistant a
 *  consistent identity strip. */
function AssistantGutter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center pt-0.5">
        <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}

function PlanBlock({ entries }: { entries: { content: string; status?: string }[] }) {
  return (
    <div className="rounded-lg bg-bg-surface/60 p-3 text-sm">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        Plan
      </div>
      <ul className="space-y-1.5">
        {entries.map((p, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-1 size-1.5 shrink-0 rounded-full",
                p.status === "completed"
                  ? "bg-success"
                  : p.status === "in_progress"
                    ? "bg-brand"
                    : "bg-fg-subtle",
              )}
            />
            <span
              className={cn(
                p.status === "completed" ? "text-fg-muted line-through" : "text-fg",
              )}
            >
              {p.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolBlock({ tool }: { tool: ReturnType<typeof reduceTurn>["tools"][number] }) {
  const status = tool.status ?? "pending";
  return (
    <details
      className={cn(
        "group/tool rounded-lg bg-bg-surface/50",
        "open:bg-bg-surface transition-colors",
      )}
      open={status === "in_progress" || status === "failed"}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
        <span
          className={cn(
            "inline-block size-1.5 rounded-full",
            status === "completed"
              ? "bg-success"
              : status === "failed"
                ? "bg-danger"
                : status === "in_progress"
                  ? "bg-brand"
                  : "bg-warning",
          )}
        />
        <span className="font-mono text-[11px] text-fg-subtle">{tool.kind ?? "tool"}</span>
        <span className="truncate font-medium text-fg">{tool.title ?? tool.toolCallId}</span>
        <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px] capitalize">
          {status.replaceAll("_", " ")}
        </Badge>
      </summary>
      {(tool.rawInput !== undefined || tool.rawOutput !== undefined) && (
        <div className="grid gap-2 px-3 pb-2 text-[11px]">
          {tool.rawInput !== undefined && (
            <pre className="overflow-x-auto rounded bg-bg/70 p-2 font-mono">
              {safeJson(tool.rawInput)}
            </pre>
          )}
          {tool.rawOutput !== undefined && (
            <pre className="overflow-x-auto rounded bg-bg/70 p-2 font-mono">
              {safeJson(tool.rawOutput)}
            </pre>
          )}
        </div>
      )}
    </details>
  );
}

function Composer({
  disabled,
  running,
  placeholder,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  running: boolean | undefined;
  placeholder: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled && !running) taRef.current?.focus();
  }, [disabled, running]);

  const handlePromptSubmit = (msg: PromptInputMessage) => {
    const t = msg.text.trim();
    if (!t) return;
    onSubmit(t);
    setText("");
  };

  return (
    <div className="bg-bg px-4 pt-2 pb-3">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput
          onSubmit={handlePromptSubmit}
          className={cn(
            // Neutralize ai-elements' default InputGroup chrome — that's
            // where the bordered "input field" rectangle and brand-colored
            // focus ring come from. We replace it with a soft surface card
            // (matches the bg-bg-surface tone used elsewhere).
            "[&_[data-slot=input-group]]:border-0",
            "[&_[data-slot=input-group]]:rounded-xl",
            "[&_[data-slot=input-group]]:bg-bg-surface/60",
            "[&_[data-slot=input-group]]:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.05),0_4px_8px_-6px_rgb(0_0_0/0.06)]",
            "[&_[data-slot=input-group]]:transition-shadow",
            "[&_[data-slot=input-group]]:has-[textarea:focus]:bg-bg-surface",
            "[&_[data-slot=input-group]]:has-[textarea:focus]:shadow-[0_2px_4px_-2px_rgb(0_0_0/0.08),0_6px_12px_-6px_rgb(0_0_0/0.08)]",
            // Suppress the brand-colored focus ring that has-focus-visible
            // adds inside InputGroup; the shadow change above is the only
            // focus signal we want.
            "[&_[data-slot=input-group]]:has-[textarea:focus-visible]:ring-0",
            "[&_[data-slot=input-group]]:has-[textarea:focus-visible]:border-0",
          )}
        >
          <PromptInputBody className="px-3 pt-2">
            <PromptInputTextarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              disabled={disabled || !!running}
              className="min-h-[44px] resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0"
            />
          </PromptInputBody>
          <PromptInputFooter className="px-3 pb-2">
            <PromptInputTools />
            {running ? (
              <Button type="button" size="sm" variant="outline" onClick={onCancel}>
                <CircleStopIcon className="size-3.5" />
                Stop
              </Button>
            ) : (
              <PromptInputSubmit
                disabled={disabled || !text.trim()}
                status={running ? "streaming" : undefined}
              >
                <SendIcon className="size-3.5" />
              </PromptInputSubmit>
            )}
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Thin wrapper that hides Streamdown's awkward `children?: string`
 *  typing under TS 6 + React 19. Streamdown reads `children` at runtime
 *  to get the markdown source; we hand it the string via createElement to
 *  sidestep the JSX type intersection that TS can't reconcile. */
function StreamdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return createElement(Streamdown as unknown as React.ComponentType<{
    children: string;
    className?: string;
  }>, { className, children: text });
}

function shortPath(p: string): string {
  if (!p) return "(no cwd)";
  const home = "/Users/" + (navigator.userAgent.match(/User\/([^/]+)/)?.[1] ?? "");
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
