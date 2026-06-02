import { useEffect, useMemo, useRef, useState } from "react";
import { CircleStopIcon, SendIcon, SparklesIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
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
  selectActive,
  selectTurnsFor,
  useSessionStore,
} from "@/lib/session-store";
import { reduceTurn, type TurnRender } from "@/lib/reduce-turn";

/**
 * ChatView — the right pane. Renders the active session's turns through the
 * ai-elements primitives. Phase 3 covers the visible 80% of the protocol:
 * user bubbles, assistant text, tool calls, optional thinking, plan list,
 * and the synthetic permission/error notes. Phase 5 adds markdown rendering
 * (Streamdown), DiffBlock for `kind=edit`, TerminalBlock for `kind=execute`,
 * etc.
 */
export function ChatView({
  onPrompt,
  onStartSession,
  agents,
}: {
  onPrompt: (sessionId: string, text: string) => void;
  onStartSession: (agentId: string) => void;
  agents: Array<{ id: string; label: string; detected: boolean; installHint?: string }>;
}) {
  const active = useSessionStore(selectActive);
  const turnsSelector = useMemo(
    () => (active ? selectTurnsFor(active.id) : () => [] as ReturnType<ReturnType<typeof selectTurnsFor>>),
    [active?.id],
  );
  const turns = useSessionStore(turnsSelector);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent
          className={cn(
            "mx-auto w-full max-w-3xl px-4 py-6",
            // Pin content to the bottom of the viewport when short — chat
            // surfaces feel wrong when the latest message floats near the
            // top with empty space below. min-h-full makes the column at
            // least as tall as the scroller; flex-col + justify-end puts
            // gravity at the bottom.
            "flex min-h-full flex-col justify-end",
          )}
        >
          {!active ? (
            <NoSessionIntro agents={agents} onStart={onStartSession} />
          ) : turns.length === 0 ? (
            <SessionIntro agentId={active.agent_id} cwd={active.cwd} />
          ) : (
            turns.map((turn) => (
              <TurnBlock
                key={turn.id}
                turnId={turn.id}
                promptText={turn.promptText}
                events={turn.events}
                status={turn.status}
                errorMessage={turn.errorMessage}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <Composer
        disabled={!active || active.status === "starting" || active.status === "errored"}
        running={active?.status === "running"}
        placeholder={
          !active
            ? "Pick an agent above to start a session."
            : active.status === "starting"
              ? "Starting session…"
              : active.status === "errored"
                ? "Session errored. Start a new one."
                : active.status === "running"
                  ? "Working… press Stop to cancel."
                  : "Ask anything. Enter to send, Shift+Enter for newline."
        }
        onSubmit={(text) => active && onPrompt(active.id, text)}
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

function NoSessionIntro({
  agents,
  onStart,
}: {
  agents: Array<{ id: string; label: string; detected: boolean }>;
  onStart: (agentId: string) => void;
}) {
  const detected = agents.filter((a) => a.detected);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-2 text-center">
      <div className="mx-auto mb-4 inline-flex size-10 items-center justify-center rounded-full bg-brand-subtle text-brand-fg">
        <SparklesIcon className="size-5" />
      </div>
      <h2 className="text-base font-medium text-fg">Start a session</h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        Pick any installed ACP agent. Conversation history stays on your machine.
      </p>
      {detected.length > 0 ? (
        <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-1 text-left">
          {detected.slice(0, 6).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onStart(a.id)}
              className={cn(
                "group flex items-center gap-2 rounded-md bg-bg-surface/50 px-3 py-2",
                "text-sm hover:bg-bg-surface transition-colors",
              )}
            >
              <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
              <span className="flex-1 truncate font-medium text-fg">{a.label}</span>
              <span className="font-mono text-[10px] text-fg-subtle group-hover:text-fg-muted">
                {a.id}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-5 max-w-md rounded-md bg-warning-subtle px-3 py-2 text-xs text-fg">
          No ACP agents detected on PATH. Install{" "}
          <span className="font-mono">claude-agent-acp</span>,{" "}
          <span className="font-mono">codex-acp</span>, or any other and restart.
        </p>
      )}
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

function TurnBlock({
  turnId,
  promptText,
  events,
  status,
  errorMessage,
}: {
  turnId: string;
  promptText: string;
  events: { payload: unknown }[];
  status: string;
  errorMessage?: string;
}) {
  const rendered: TurnRender = reduceTurn(events);
  const hasAnything =
    rendered.assistantText ||
    rendered.thoughtText ||
    rendered.tools.length > 0 ||
    rendered.plan.length > 0;

  return (
    <div className="group/turn mb-8 space-y-3" data-turn-id={turnId}>
      {promptText && (
        <Message from="user">
          <MessageContent>
            <p className="whitespace-pre-wrap">{promptText}</p>
          </MessageContent>
        </Message>
      )}

      {/* Assistant pieces all share a 32px gutter on the left so the
          conversation reads as a column anchored against an avatar slot
          rather than text crashing into the card edge. The avatar dot itself
          is rendered by the AssistantGutter wrapper below. */}
      {(rendered.plan.length > 0 ||
        rendered.thoughtText ||
        rendered.tools.length > 0 ||
        rendered.assistantText ||
        rendered.notes.length > 0 ||
        (!hasAnything && status === "running") ||
        status === "error" ||
        status === "cancelled") && (
        <AssistantGutter>
          {rendered.plan.length > 0 && <PlanBlock entries={rendered.plan} />}

          {rendered.thoughtText && (
            <Reasoning isStreaming={status === "running"} defaultOpen={false}>
              <ReasoningTrigger />
              <ReasoningContent>{rendered.thoughtText}</ReasoningContent>
            </Reasoning>
          )}

          {rendered.tools.length > 0 && (
            <div className="space-y-2">
              {rendered.tools.map((t) => (
                <ToolBlock key={t.toolCallId} tool={t} />
              ))}
            </div>
          )}

          {rendered.assistantText && (
            <Message from="assistant">
              <MessageContent>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
                  {rendered.assistantText}
                </div>
              </MessageContent>
            </Message>
          )}

          {rendered.notes.map((note, i) => (
            <p key={i} className="text-xs italic text-fg-muted">
              {note}
            </p>
          ))}

          {!hasAnything && status === "running" && (
            <p className="text-xs text-fg-muted">
              <span className="brand-loader-dot">·</span>{" "}
              <span className="brand-loader-dot" style={{ animationDelay: "120ms" }}>·</span>{" "}
              <span className="brand-loader-dot" style={{ animationDelay: "240ms" }}>·</span>
            </p>
          )}

          {status === "error" && (
            <p className="rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
              {errorMessage ?? "Turn failed."}
            </p>
          )}
          {status === "cancelled" && (
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

function shortPath(p: string): string {
  if (!p) return "(no cwd)";
  const home = "/Users/" + (navigator.userAgent.match(/User\/([^/]+)/)?.[1] ?? "");
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
