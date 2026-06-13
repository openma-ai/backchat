import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BrainIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloudIcon,
  CornerDownLeftIcon,
  EyeIcon,
  FileEditIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GlobeIcon,
  ListChecksIcon,
  Loader2Icon,
  MonitorIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  ShieldAlertIcon,
  SlashIcon,
  SquareIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { safeJson } from "@/lib/format";
import {
  newDraftSession,
  newSideDraftSession,
  selectActive,
  selectSideActive,
  selectTurnsFor,
  sessionStore,
  useSessionStore,
  type AcpAvailableCommand,
  type BrokerAsk,
  type Turn,
} from "@/lib/session-store";
import { reduceTurn, type ToolContentBlock, type TurnRender } from "@/lib/reduce-turn";
import { useSettings } from "@/lib/settings-store";
import { AgentIcon } from "@/components/AgentIcon";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { ConversationTimeline } from "./ConversationTimeline";
import { isComposerAgentLocked, resolveComposerAgentId } from "@/lib/composer-agent";
import {
  CHAT_COMPOSER_FRAME_CLASS,
  CHAT_GENERATED_IMAGE_CLASS,
  CHAT_TURN_FRAME_CLASS,
} from "@/lib/chat-layout";

type AgentOption = {
  id: string;
  label: string;
  command: string;
  detected: boolean;
};

type AcpHarnessFamily = "codex" | "claude" | "gemini" | "opencode" | "generic";

type AcpModelProfile = {
  id: string;
  label: string;
  hint: string;
  harnessFamilies?: AcpHarnessFamily[];
};

const DEFAULT_ACP_MODEL_PROFILE_ID = "auto";

const ACP_MODEL_PROFILE_CATALOG: AcpModelProfile[] = [
  {
    id: DEFAULT_ACP_MODEL_PROFILE_ID,
    label: "Auto",
    hint: "Use the selected harness default",
  },
  {
    id: "codex:gpt-5.5",
    label: "GPT-5.5",
    hint: "Codex profile",
    harnessFamilies: ["codex"],
  },
  {
    id: "codex:gpt-5.4",
    label: "GPT-5.4",
    hint: "Codex compatibility profile",
    harnessFamilies: ["codex"],
  },
  {
    id: "claude:sonnet",
    label: "Claude Sonnet",
    hint: "Claude coding profile",
    harnessFamilies: ["claude"],
  },
  {
    id: "claude:opus",
    label: "Claude Opus",
    hint: "Claude high-reasoning profile",
    harnessFamilies: ["claude"],
  },
  {
    id: "gemini:pro",
    label: "Gemini Pro",
    hint: "Gemini pro profile",
    harnessFamilies: ["gemini"],
  },
  {
    id: "gemini:flash",
    label: "Gemini Flash",
    hint: "Gemini fast profile",
    harnessFamilies: ["gemini"],
  },
  {
    id: "opencode:default",
    label: "OpenCode Default",
    hint: "OpenCode profile",
    harnessFamilies: ["opencode"],
  },
];

function harnessFamilyForAgent(agentId: string): AcpHarnessFamily {
  if (agentId.includes("codex")) return "codex";
  if (agentId.includes("claude")) return "claude";
  if (agentId.includes("gemini")) return "gemini";
  if (agentId.includes("opencode")) return "opencode";
  return "generic";
}

function modelProfilesForAgent(agentId: string): AcpModelProfile[] {
  const family = harnessFamilyForAgent(agentId);
  return ACP_MODEL_PROFILE_CATALOG.filter((profile) => {
    if (profile.id === DEFAULT_ACP_MODEL_PROFILE_ID) return true;
    return profile.harnessFamilies?.includes(family) ?? false;
  });
}

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
 *
 * Dual-mode: when `mode === "side"` the view reads from the store's
 * sideActive pointer instead of the main active, cold-creates side
 * drafts (kind: "side"), and does not navigate on submit (side
 * sessions don't have URLs — the rail owns their lifecycle).
 */
export function ChatView({ mode = "main" }: { mode?: "main" | "side" } = {}) {
  const isSide = mode === "side";
  const activeSelector = isSide ? selectSideActive : selectActive;
  const active = useSessionStore(activeSelector);
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

  // Local workspace pick — used by the composer chip BEFORE the session
  // exists. We don't park it on SessionRow.chosenCwd because:
  //   1. On the home route there IS no session yet (active === null), so
  //      there's nothing to write to.
  //   2. Once a draft promotes, the cwd is locked into ACP's child and
  //      reflected back on `active.cwd` via session.ready — the local
  //      state stops mattering.
  // The lifetime is "from this composer mounting to the first submit",
  // which matches what the chip needs to remember.
  const [pickedCwd, setPickedCwd] = useState<string | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
  const [pickedModelProfileId, setPickedModelProfileId] = useState(
    DEFAULT_ACP_MODEL_PROFILE_ID,
  );
  // Re-baseline when the user navigates to a different session — picking
  // a workspace in session A shouldn't leak into draft B.
  useEffect(() => {
    setPickedCwd(null);
    setPickedAgentId(null);
    setPickedModelProfileId(DEFAULT_ACP_MODEL_PROFILE_ID);
  }, [active?.id]);

  const onSubmit = async (text: string) => {
    let target = active;
    if (!target) {
      const sid = isSide ? newSideDraftSession() : newDraftSession();
      target = sessionStore.get(sid)!;
      if (!isSide) {
        // Side sessions don't appear in the router — their lifecycle is
        // scoped to the right rail and they vanish on window close. Only
        // main sessions push a URL.
        void navigate({ to: "/chat/$sessionId", params: { sessionId: sid } });
      }
    }
    // Register the turn FIRST — this paints the user bubble immediately,
    // before any awaits. ACP events arrive via session.event push later
    // and get reduced into the same turn id. If session.start ends up
    // failing the turn gets marked errored, not vanished.
    const turn_id = `turn-${Math.random().toString(36).slice(2, 10)}`;
    console.log("[onSubmit] target", target?.id, target?.status, "text", text.slice(0, 30));
    sessionStore.registerTurn(turn_id, target.id, text);
    console.log("[onSubmit] after registerTurn, store turns for session:",
      sessionStore.turnsFor(target.id).length);

    if (target.status === "draft") {
      const agentId = pickedAgentId || settings?.default.agent_id || "";
      const label = deriveLabel(text);
      sessionStore.promoteDraft(target.id, agentId, label);
      // Cwd precedence:
      //   1. composer's just-picked workspace (this turn's chip)
      //   2. settings.default.workspace_path
      //   3. omit → main falls back to userData/sessions/<sessionId>/
      //      (the "app-managed" default — main process's ensureSessionCwd).
      // Intentionally no $HOME fallback: turning the ACP child loose in
      // the user's home dir surprised people (terminal / file tree both
      // rooted there until they noticed).
      const startCwd =
        pickedCwd?.trim() ||
        settings?.default.workspace_path?.trim() ||
        undefined;
      // Register the listener BEFORE firing sessionStart — otherwise the
      // session.ready push event can arrive in the IPC channel before
      // waitForReady's listener attaches, and we'd hang for 10s waiting
      // on an event that already fired.
      const readyPromise = waitForReady(target.id, 10_000);
      void window.backchat.sessionStart({
        session_id: target.id,
        agent_id: agentId,
        cwd: startCwd,
      });
      const r = await readyPromise;
      if (r !== "ready") return; // session.error already showed in topbar
    } else if (target.status === "ready" && !target.activeTurnId) {
      const readyPromise = waitForReady(target.id, 10_000);
      void window.backchat.sessionStart({
        session_id: target.id,
        agent_id: target.agent_id,
        cwd: target.cwd || undefined,
        resume: target.acp_session_id
          ? { acp_session_id: target.acp_session_id }
          : undefined,
      });
      const r = await readyPromise;
      if (r !== "ready") return;
    }
    await window.backchat.sessionPrompt({ session_id: target.id, turn_id, text });
  };

  const isEmpty = !active || active.status === "draft" || turns.length === 0;
  // Composer is locked the moment a turn registers (activeTurnId set in
  // the store) and stays locked until the turn completes / errors /
  // cancels. Without this, the gap between submit and the first
  // session.event arriving lets the user fire a second prompt and
  // collapse the conversation order.
  const hasActiveTurn = !!active?.activeTurnId;
  const boundComposerAgentId =
    active && active.status !== "draft" ? active.agent_id : undefined;
  const composer = (
    <Composer
      sessionAgentId={boundComposerAgentId}
      disabled={
        (active?.status === "starting" && !!active?.agent_id) ||
        active?.status === "errored"
      }
      running={active?.status === "running" || hasActiveTurn}
      availableCommands={active?.availableCommands}
      pendingAsk={active?.pendingAsks?.[0]}
      lockedAgentId={active && active.status !== "draft" ? active.agent_id : null}
      pickedAgentId={pickedAgentId}
      onPickAgent={setPickedAgentId}
      pickedModelProfileId={pickedModelProfileId}
      onPickModelProfile={setPickedModelProfileId}
      onResolveAsk={async (optionId, approve) => {
        const ask = active?.pendingAsks?.[0];
        if (!ask) return;
        if (ask.kind === "permission" && optionId) {
          await window.backchat.permissionRespond(ask.ask.requestId, optionId);
        } else if (ask.kind === "fsWrite") {
          await window.backchat.fsApprovalRespond(ask.ask.requestId, !!approve);
        }
        sessionStore.dequeueAsk(active!.id, ask.ask.requestId);
      }}
      placeholder={
        !active || active.status === "draft"
          ? "Ask anything…"
          : active.status === "starting"
            ? "Starting…"
            : active.status === "errored"
              ? "Session errored. Start a new chat."
              : active.status === "running"
                ? "Working…"
                : "Reply…"
      }
      onSubmit={onSubmit}
      onCancel={() => {
        if (active?.activeTurnId) {
          void window.backchat.sessionCancel({
            session_id: active.id,
            turn_id: active.activeTurnId,
          });
        }
      }}
    />
  );

  // Project / runtime / branch chip row — sits BELOW the composer card,
  // codex-style. Same vertical group, separate visual band so chips
  // don't crowd the composer's button row.
  // Project / runtime / branch chip row — only rendered on DRAFT
  // sessions where the user is still picking a workspace. Once the
  // session is ready the cwd is locked into the ACP child, and the
  // topbar already surfaces it (CwdChip + RuntimeChip + ModeChip) —
  // no need for a second row under the composer.
  const showChipRow = !active || active.status === "draft";
  const chipRow = showChipRow ? (
    <ProjectChipRow
      isDraft={true}
      activeCwd={pickedCwd || ""}
      onPickCwd={async () => {
        const next = await window.backchat.uiFsPickDir({
          defaultPath: pickedCwd || settings?.default.workspace_path || undefined,
        });
        if (next) setPickedCwd(next);
      }}
      onSetCwd={(p) => setPickedCwd(p)}
      onClearCwd={() => setPickedCwd(null)}
    />
  ) : null;

  // Track which "mode" we're in. When transitioning from empty → conversation
  // (user submitted first prompt), animate the composer sliding from the
  // empty-state center down to its conversation-state bottom-pinned slot.
  // Matches the sidebar's slide animation (same cubic-bezier).
  //
  // Only plays for IN-PLACE transitions on the same session. Switching
  // between sessions (sidebar click) crosses session ids and we sync the
  // ref without triggering — otherwise a switch from a draft to a real
  // conversation animates the composer for no reason.
  const [composerTransition, setComposerTransition] = useState<
    "idle" | "from-empty-to-conv"
  >("idle");
  const wasEmptyRef = useRef(isEmpty);
  const prevSessionIdRef = useRef(active?.id ?? null);
  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== (active?.id ?? null);
    if (sessionChanged) {
      // Crossed a session boundary — re-baseline silently. The next render
      // for this session decides on its own merits whether to animate.
      prevSessionIdRef.current = active?.id ?? null;
      wasEmptyRef.current = isEmpty;
      return;
    }
    if (wasEmptyRef.current && !isEmpty) {
      // Empty → conversation, same session: trigger slide.
      setComposerTransition("from-empty-to-conv");
      const t = setTimeout(() => setComposerTransition("idle"), 320);
      wasEmptyRef.current = isEmpty;
      return () => clearTimeout(t);
    }
    wasEmptyRef.current = isEmpty;
  }, [isEmpty, active?.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isEmpty ? (
        // Empty state — heading + composer form a single vertically
        // centered group. Group width matches the composer (max-w-2xl)
        // so the title sits visually above-its-composer instead of being
        // a tiny line above a wide bar.
        <div className="flex h-full min-h-0 flex-col items-center justify-center px-4">
          <div className="flex w-full max-w-2xl flex-col items-center gap-6 -mt-[8vh]">
            {(!active || active.status === "draft") ? (
              <EmptyStateIntro hasDefaultAgent={!!settings?.default.agent_id} />
            ) : (
              <SessionIntro agentId={active.agent_id} cwd={active.cwd} />
            )}
            <div className="w-full space-y-2">
              {composer}
              {chipRow}
            </div>
          </div>
        </div>
      ) : (
        // Conversation flow — turns scroll above a bottom-pinned composer.
        <>
          <Conversation key={active?.id ?? "none"} className="flex-1 min-h-0">
            <ConversationContent
              // ConversationContent is the inner scroller of
              // use-stick-to-bottom. Keep it full-width so the
              // scrollbar pill (drawn at the right edge of this
              // element) sits flush against the right edge of the
              // conversation, where the timeline strip and right
              // shell live. Horizontal breathing room belongs to the
              // turn frame below, which is inset to the composer's
              // rounded-corner safe line rather than the outer card edge.
              className={cn(
                "w-full px-0 py-6",
                "flex min-h-full flex-col",
              )}
            >
              <MarkdownCwdProvider cwd={active?.cwd}>
                <div
                  className={CHAT_TURN_FRAME_CLASS}
                  data-chat-column="turns"
                >
                  {turns.map((turn) => <TurnBlock key={turn.id} turn={turn} />)}
                </div>
              </MarkdownCwdProvider>
            </ConversationContent>
            <ConversationScrollButton />
            {!isSide && <ConversationTimeline turns={turns} />}
          </Conversation>
          <div
            data-chat-column="composer"
            className={cn(
              CHAT_COMPOSER_FRAME_CLASS,
              "space-y-2 pb-4",
              composerTransition === "from-empty-to-conv" && "composer-slide-in",
            )}
          >
            {composer}
            {chipRow}
          </div>
        </>
      )}

      {active?.status === "errored" && (
        <div className="bg-danger-subtle px-4 py-2 text-xs text-danger">
          {active.lastError ?? "Session errored."}
        </div>
      )}
    </div>
  );
}

/** One-shot await of session.ready for the given session id. Returns
 *  `"ready"` on success, `"error"` if session.error landed first, or
 *  `"timeout"` after `ms`. Caller skips the prompt fire if not ready. */
function waitForReady(
  sessionId: string,
  ms: number,
): Promise<"ready" | "error" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve("timeout");
    }, ms);
    const off = window.backchat.onSessionEvent((e) => {
      if (e.session_id !== sessionId) return;
      if (e.type === "session.ready") {
        clearTimeout(timer);
        off();
        resolve("ready");
      } else if (e.type === "session.error") {
        clearTimeout(timer);
        off();
        resolve("error");
      }
    });
  });
}

function EmptyStateIntro({ hasDefaultAgent }: { hasDefaultAgent: boolean }) {
  return (
    <div className="reveal-in flex flex-col items-center text-center">
      <h2 className="font-display text-2xl font-normal leading-tight text-fg">
        {hasDefaultAgent ? "What can I help with?" : "Pick a default agent"}
      </h2>
      {!hasDefaultAgent && (
        <p className="mt-2 max-w-sm text-sm text-fg-muted">
          Open Settings → Agents to choose one.
        </p>
      )}
    </div>
  );
}

function SessionIntro({ agentId: _agentId, cwd: _cwd }: { agentId: string; cwd: string }) {
  void _agentId;
  void _cwd;
  // Intentionally minimal — the topbar already shows the agent + status,
  // and a fresh session needs nothing more than the composer to focus
  // on. The previous "New session with claude-acp · Conversation runs
  // in ~/Library/..." block felt like a debug surface.
  return null;
}

export function TurnBlock({ turn }: { turn: Turn }) {
  const rendered: TurnRender = reduceTurn(turn.events);
  const cwd = useContext(MarkdownCwdContext);

  const isStreaming = turn.status === "running";
  const hasAnything =
    turn.assistantText.length > 0 ||
    turn.thoughtText.length > 0 ||
    rendered.tools.length > 0 ||
    rendered.plan.length > 0;

  return (
    <div className="group/turn reveal-in mb-6 space-y-2" data-turn-id={turn.id}>
      {turn.promptText && (
        <Message from="user">
          <MessageContent>
            <p className="whitespace-pre-wrap">{turn.promptText}</p>
          </MessageContent>
        </Message>
      )}

      <AssistantGutter>
        {rendered.plan.length > 0 && <PlanBlock entries={rendered.plan} />}

        {/* Thought block — wrapped in <Reasoning> so claude-acp's long
            english thinking dumps (image #99) don't masquerade as part
            of the assistant prose. Default open while streaming so the
            user sees live progress; collapsible once the turn is
            complete. The ai-elements Reasoning component handles the
            "Thinking… / Thought for Ns" header + chevron + collapse
            animation; we feed it the same dual-track body we'd use
            inline — StreamingMarkdown during stream, StreamdownText
            after. */}
        {turn.thoughtText.length > 0 && (
          <Reasoning isStreaming={isStreaming} defaultOpen={isStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>
              {isStreaming ? (
                <StreamingMarkdown
                  turnId={turn.id}
                  kind="thought"
                  className="text-fg-muted"
                  cwd={cwd}
                />
              ) : (
                <StreamdownText
                  className={cn(
                    "text-[13px] leading-6 text-fg-muted",
                    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                    "[&>p]:my-1.5 [&>ul]:my-1.5 [&>ol]:my-1.5 [&>pre]:my-2",
                  )}
                  text={turn.thoughtText}
                />
              )}
            </ReasoningContent>
          </Reasoning>
        )}

        {/* Tools + assistant text streamed inline by timeline order.
            Each item renders in the same flow as prose; tools are
            single-line rows that can expand to show body. While the
            turn is still running, items in flight pulse to indicate
            live update.

            Streaming mode also walks the timeline (instead of the old
            "all tools, then a text blob" layout that put a Read row
            ABOVE the agent's preamble text — image #105). For each
            past assistant_text segment (one that already has a tool
            after it) we render static markdown; the LIVE tail gets a
            single <StreamingMarkdown> bootstrapped with prefixSkip so
            the replayed accumulator doesn't double-print the earlier
            segments. */}
        {isStreaming ? (() => {
          // Sum the lengths of every assistant_text segment that
          // currently lives in the timeline — those are the "already
          // committed" chunks above the next break. prefixSkip lets the
          // tail StreamingMarkdown skip them during replay so the live
          // DOM mutation only owns the post-flush tail.
          let priorTextLen = 0;
          for (const item of rendered.timeline) {
            if (item.kind === "assistant_text") priorTextLen += item.text.length;
          }
          const lastItem = rendered.timeline[rendered.timeline.length - 1];
          const tailHandledByTimeline =
            lastItem?.kind === "assistant_text";
          return (
            <>
              {rendered.timeline.map((item, i) => {
                if (item.kind === "assistant_text") {
                  const isTail =
                    tailHandledByTimeline && i === rendered.timeline.length - 1;
                  if (isTail) {
                    // Drop the live StreamingMarkdown in place of the
                    // last segment so new chunks land in the right slot
                    // (right after the segments/tools above, not below
                    // everything). prefixSkip = (priorTextLen − this
                    // segment's length) so it replays only this tail.
                    return (
                      <div key={`it-${i}`} className="min-w-0">
                        <StreamingMarkdown
                          turnId={turn.id}
                          kind="assistant"
                          cwd={cwd}
                          prefixSkip={priorTextLen - item.text.length}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={`it-${i}`} className="min-w-0">
                      <StreamdownText
                        className={cn(
                          "text-[13px] leading-6 text-fg",
                          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                          "[&>p]:my-1.5 [&>ul]:my-1.5 [&>ol]:my-1.5 [&>pre]:my-2",
                        )}
                        text={item.text}
                      />
                    </div>
                  );
                }
                const tool = rendered.tools.find(
                  (x) => x.toolCallId === item.toolCallId,
                );
                if (!tool) return null;
                return <ToolRow key={`it-${i}`} tool={tool} />;
              })}
              {/* No assistant_text in the tail position — the live
                  stream will start a NEW segment (after the last tool).
                  Mount StreamingMarkdown with prefixSkip = total prior
                  length so the replayed accumulator is fully covered by
                  the static segments above and we only render fresh
                  deltas. */}
              {!tailHandledByTimeline && (
                <div className="min-w-0">
                  <StreamingMarkdown
                    turnId={turn.id}
                    kind="assistant"
                    cwd={cwd}
                    prefixSkip={priorTextLen}
                  />
                </div>
              )}
            </>
          );
        })() : (
          rendered.timeline.map((item, i) => {
            if (item.kind === "assistant_text") {
              return (
                <div key={`it-${i}`} className="min-w-0">
                  <StreamdownText
                    className={cn(
                      "text-[13px] leading-6 text-fg",
                      "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                      "[&>p]:my-1.5 [&>ul]:my-1.5 [&>ol]:my-1.5 [&>pre]:my-2",
                    )}
                    text={item.text}
                  />
                </div>
              );
            }
            const tool = rendered.tools.find(
              (x) => x.toolCallId === item.toolCallId,
            );
            if (!tool) return null;
            return <ToolRow key={`it-${i}`} tool={tool} />;
          })
        )}

        {/* Replay fallback — historical turns persist text as a single
            string on turn.assistantText (chunks aren't re-emitted), so
            the timeline above produces no assistant_text segments.
            Show the accumulated text as a final block in that case. */}
        {!isStreaming && rendered.timeline.every((t) => t.kind !== "assistant_text") && turn.assistantText && (
          <div className="min-w-0">
            <StreamdownText
              className={cn(
                "text-[13px] leading-6 text-fg",
                "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                "[&>p]:my-1.5 [&>ul]:my-1.5 [&>ol]:my-1.5 [&>pre]:my-2",
              )}
              text={turn.assistantText}
            />
          </div>
        )}

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
    </div>
  );
}

/** Wraps everything an assistant emits in one turn with a left-side
 *  avatar gutter — tiny dot at the top-left, content offset 32px right.
 *  Anchors the conversation as a vertical column, gives the assistant a
 *  consistent identity strip. */
/** Assistant content wrapper — plain markdown stream, no avatar /
 *  bubble. Identity is implicit (assistant is "everything not in a
 *  user bubble"); Claude Desktop / Codex follow the same pattern. */
function AssistantGutter({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2">{children}</div>;
}

function PlanBlock({ entries }: { entries: { content: string; status?: string }[] }) {
  const total = entries.length;
  const done = entries.filter((e) => e.status === "completed").length;
  return (
    <div className="rounded-lg border border-border/40 bg-bg-surface/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 text-fg-muted">
        <ListChecksIcon className="size-3.5" />
        <span className="text-xs">Plan</span>
        <span className="text-xs text-fg-subtle">
          {done} / {total}
        </span>
      </div>
      <ul className="space-y-0.5">
        {entries.map((p, i) => {
          const Icon =
            p.status === "completed"
              ? CheckSquareIcon
              : p.status === "in_progress"
                ? Loader2Icon
                : SquareIcon;
          return (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2 rounded-md px-1.5 py-1 text-sm",
                p.status === "in_progress" &&
                  "border-l-2 border-fg-subtle bg-bg-surface/40 pl-2",
              )}
            >
              <Icon
                className={cn(
                  "mt-1 size-3.5 shrink-0",
                  p.status === "completed"
                    ? "text-success"
                    : p.status === "in_progress"
                      ? "text-fg-muted animate-spin"
                      : "text-fg-subtle",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 leading-6",
                  p.status === "completed"
                    ? "text-fg-muted line-through"
                    : p.status === "in_progress"
                      ? "text-fg"
                      : "text-fg-muted",
                )}
              >
                {p.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Inline tool row — codex pattern. One line per call:
 *    <icon> <verb> <target>           [chevron when expandable]
 *  Simple tools with no content body get no chevron and don't
 *  expand. Tools with diff / terminal / locations / rawOutput
 *  expand inline below the row when clicked. */
function ToolRow({ tool }: { tool: ReturnType<typeof reduceTurn>["tools"][number] }) {
  const status = tool.status ?? "pending";
  const inProgress = status === "in_progress" || status === "pending";
  const Icon = pickToolIcon(tool.kind);
  // Skill-read special case: `Read tool reading
  // .codex/skills[/.system]/<name>/SKILL.md` is logically "consult the
  // <name> skill", not "open a markdown file". Show the skill name
  // (and drop the redundant SKILL.md target) so the row reads like
  // codex's own UI (`读取 Imagegen 技能`) instead of `已读取 SKILL.md`.
  // Falls through to the generic verb/target when no skill match.
  const skillName = detectSkillName(tool);
  const verb = skillName
    ? inProgress
      ? "读取中"
      : "读取"
    : pickToolVerb(tool.kind, status);
  const target = skillName
    ? `${capitalize(skillName)} 技能`
    : pickToolTarget(tool);

  // Split content blocks into "hoisted" (image bubbles that render
  // OUTSIDE the disclosure, always visible) vs "in-body" (text, diff,
  // terminal — stay behind the click-to-expand chevron).
  //
  // Why image is special: the row label "已调用 Image generation" tells
  // the user nothing about what was produced. The image IS the result —
  // hiding it behind a click defeats the whole "show, don't tell" point
  // (image #107). Same logic would apply to any future media block
  // (audio, video). Text content stays gated because it's the verbose
  // revised-prompt / log payload most users don't care about by default.
  const hoistedBlocks: ToolContentBlock[] = [];
  const bodyBlocks: ToolContentBlock[] = [];
  for (const b of tool.content ?? []) {
    if (b.type === "content" && b.content?.type === "image") hoistedBlocks.push(b);
    else bodyBlocks.push(b);
  }

  const hasBody =
    bodyBlocks.length > 0 ||
    !!(tool.locations?.length) ||
    (tool.rawOutput !== undefined && hoistedBlocks.length === 0);

  // Default-collapsed — including while the tool is still running.
  // Earlier we auto-opened in_progress rows to "show live progress",
  // but in practice that meant every chat scrolled with a stack of
  // open panels (revised-prompt blobs, raw command echoes), drowning
  // out the actual conversation. The row + 已读取 verb is enough live
  // signal; users who care about output click the chevron.
  // Controlled state so the toggle can hold summary position stable
  // — without it `<details>` push the surrounding chat content around.
  const [open, setOpen] = useState(false);

  const stick = useStickToBottomContext();
  const summaryRef = useRef<HTMLElement | null>(null);

  // Body's vertical cap. Static "≤ 50% viewport, ≤ 480px" instead of a
  // dynamic ResizeObserver — earlier we observed `scrollRef.current`
  // to compute "summary-bottom → scroller-bottom" precisely, but that
  // RO competed with use-stick-to-bottom's own RO during streaming
  // (each text chunk → snap to bottom → scrollEl reflow → our RO
  // fires → setState → re-render → competing again), which froze the
  // chat UI mid-stream (image #92 — read tool body visible, downstream
  // text chunks never rendered though backend kept emitting them).
  // Static cap is "good enough": the body's own `overflow-y: auto`
  // handles anything past the cap, and 50vh fits inside any reasonable
  // chat viewport without dominating.
  const bodyMaxH = "min(480px, 50vh)";

  // Toggle handler — anchor the summary to its current viewport-y so
  // the inline row NEVER moves on click, no matter where in the
  // scrollback the user clicked. Three things have to happen in
  // concert for "summary doesn't move":
  //
  //   1. Tell use-stick-to-bottom to release its at-bottom lock
  //      (`stopScroll`). Otherwise its ResizeObserver — which fires
  //      one frame after the body mounts/unmounts and changes the
  //      content height — will helpfully snap the conversation to its
  //      new bottom, which pulls the summary up off the screen.
  //   2. Measure summary's viewport top BEFORE flipping `open`.
  //   3. On the next paint, measure again and offset
  //      `scrollEl.scrollTop` by the delta. (Mostly a no-op once
  //      step 1 is in place, but covers edge cases like the
  //      conversation being short enough that opening the body
  //      reshapes the flex column.)
  //
  // Net effect: the row stays anchored on screen for both opens and
  // closes, regardless of scroll position or distance to bottom.
  const handleSummaryClick = (_e: React.MouseEvent) => {
    const scrollEl = stick.scrollRef.current;
    const sumEl = summaryRef.current;
    if (!scrollEl || !sumEl) {
      setOpen((o) => !o);
      return;
    }
    // (1) detach from at-bottom lock so the lib's RO won't snap.
    stick.stopScroll();
    // (2) snapshot.
    const before = sumEl.getBoundingClientRect().top;
    setOpen((o) => !o);
    // (3) re-anchor on next paint. rAF runs after React commit AND
    // after the browser style/layout pass triggered by the new DOM,
    // so getBoundingClientRect here reflects the post-toggle state.
    requestAnimationFrame(() => {
      const after = sumEl.getBoundingClientRect().top;
      const delta = after - before;
      if (Math.abs(delta) > 0.5) {
        scrollEl.scrollTop += delta;
      }
    });
  };

  return (
    <div
      className={cn(
        "py-0.5",
        inProgress && "animate-pulse",
      )}
    >
      <button
        ref={summaryRef as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={hasBody ? handleSummaryClick : undefined}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-1.5 rounded text-left text-[13px]",
          hasBody ? "cursor-pointer hover:bg-bg-surface/40" : "cursor-default",
        )}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            status === "failed" ? "text-danger" : "text-fg-muted",
          )}
        />
        <span
          className={cn(
            "shrink-0",
            status === "failed" ? "text-danger" : "text-fg-muted",
          )}
        >
          {verb}
        </span>
        {target && (
          <span className="min-w-0 truncate text-fg-muted/80" title={target}>
            {target}
          </span>
        )}
        {hasBody && (
          <ChevronRightIcon
            className={cn(
              "ml-auto size-3 shrink-0 text-fg-subtle transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {hasBody && open && (
        <div
          className={cn(
            "ml-5 mt-1 space-y-1.5 text-[12px]",
            // Body owns its own vertical overflow so a huge tool output
            // can't expand the chat scroller into a giant element.
            "overflow-y-auto",
          )}
          style={{ maxHeight: bodyMaxH }}
        >
          {tool.locations && tool.locations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tool.locations.map((loc, i) =>
                loc.path ? (
                  <span
                    key={`${loc.path}-${i}`}
                    className="rounded bg-bg-surface/60 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
                    title={loc.path}
                  >
                    {shortPath(loc.path)}
                    {loc.line != null ? `:${loc.line}` : ""}
                  </span>
                ) : null,
              )}
            </div>
          )}
          {bodyBlocks.map((block, i) => (
            <ToolContentRenderer key={i} block={block} />
          ))}
          {bodyBlocks.length === 0 && tool.rawOutput !== undefined && (
            <ToolRawOutputBody rawOutput={tool.rawOutput} />
          )}
        </div>
      )}
      {/* Hoisted blocks (images, media) — render OUTSIDE the
          disclosure so the produced artifact is the first thing the
          user sees, even with the row collapsed. Image generation is
          the canonical case: the row label says "已调用 Image
          generation" which is useless on its own; the image IS the
          result and belongs as a sibling, not buried behind a chevron
          (image #107). */}
      {hoistedBlocks.length > 0 && (
        <div className="ml-5 mt-1.5 space-y-1.5">
          {hoistedBlocks.map((block, i) => (
            <ToolContentRenderer key={`hoist-${i}`} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Renderer for a tool entry that has NO `content[]` blocks but DOES
 *  have a `rawOutput`. Most ACP "execute"-shape tools (read, edit,
 *  search, terminal) land here — codex-acp passes the whole
 *  command-execution receipt as one big rawOutput object:
 *
 *    { call_id, process_id, turn_id, command, cwd, parsed_cmd,
 *      stdout, stderr, exit_code, duration, ... }
 *
 *  The OLD behavior was `JSON.stringify(rawOutput, 2)` → expanded panel
 *  was a screenful of debug noise (image #110: a `Read SKILL.md` row
 *  expanded to a 30-line JSON dump of call_id / parsed_cmd metadata,
 *  with the actual file content buried at the end as `stdout`).
 *
 *  Heuristic: when the shape looks like an execute receipt (has a
 *  `stdout` string), surface the stdout as plain monospace text plus
 *  a thin warning row for stderr / non-zero exit. Anything else
 *  (`rawOutput` is an array, missing `stdout`, etc.) still falls back
 *  to JSON.stringify because there's no better universal shape. */
function ToolRawOutputBody({ rawOutput }: { rawOutput: unknown }) {
  if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    const r = rawOutput as Record<string, unknown>;
    const stdout = typeof r["stdout"] === "string" ? (r["stdout"] as string) : null;
    const stderr = typeof r["stderr"] === "string" ? (r["stderr"] as string) : null;
    const exitCode = typeof r["exit_code"] === "number" ? (r["exit_code"] as number) : null;
    if (stdout !== null) {
      return (
        <div className="space-y-1.5">
          {exitCode != null && exitCode !== 0 && (
            <div className="rounded bg-danger-subtle px-2 py-1 font-mono text-[11px] text-danger">
              exit {exitCode}
            </div>
          )}
          {stdout.length > 0 && (
            <pre className="overflow-x-auto rounded bg-bg-surface/60 p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
              {stdout}
            </pre>
          )}
          {stderr && stderr.length > 0 && (
            <pre className="overflow-x-auto rounded bg-bg-surface/60 p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted">
              {stderr}
            </pre>
          )}
        </div>
      );
    }
  }
  return (
    <pre className="overflow-x-auto rounded bg-bg-surface/60 p-2 font-mono text-[11px] text-fg-muted">
      {safeJson(rawOutput)}
    </pre>
  );
}

/** Chinese action verb per ACP tool kind. Matches codex's UI vocabulary:
 *  past-tense forms for completed work, generic "已调用" for unknown kinds.
 *  in_progress flips a few to present-progressive for live feel. */
function pickToolVerb(kind: string | undefined, status: string | undefined): string {
  const inProgress = status === "in_progress";
  switch (kind) {
    case "read":
      return inProgress ? "读取中" : "已读取";
    case "edit":
      return inProgress ? "编辑中" : "已编辑";
    case "delete":
      return inProgress ? "删除中" : "已删除";
    case "move":
      return inProgress ? "移动中" : "已移动";
    case "search":
    case "grep":
      return inProgress ? "搜索中" : "已搜索";
    case "execute":
    case "terminal":
      return inProgress ? "运行中" : "已运行";
    case "fetch":
    case "web":
      return inProgress ? "获取中" : "已获取";
    case "think":
      return inProgress ? "思考中" : "已思考";
    case "list":
    case "tree":
      return inProgress ? "列出中" : "已列出";
    case "switch_mode":
      return "切换模式";
    default:
      return inProgress ? "调用中" : "已调用";
  }
}

/** Choose the most informative one-line target text for the tool row.
 *  Priority: explicit title > first location path > first text content
 *  preview. Truncation handled by the caller's CSS truncate. */
function pickToolTarget(tool: ReturnType<typeof reduceTurn>["tools"][number]): string {
  if (tool.title) return tool.title;
  if (tool.locations?.length && tool.locations[0]?.path) {
    return shortPath(tool.locations[0].path);
  }
  if (tool.content?.length) {
    for (const b of tool.content) {
      if (b.type === "diff" && b.path) return shortPath(b.path);
      if (b.type === "content" && b.content?.type === "text" && b.content.text) {
        return b.content.text.split(/\r?\n/, 1)[0]!.trim();
      }
    }
  }
  return "";
}

/** Detect codex skill-document reads. Skill docs live under
 *  `~/.codex/skills/[.system/]<name>/SKILL.md` (or via cwd-relative
 *  paths) and the model loads them with a `sed -n …p SKILL.md` exec.
 *  When we spot the pattern, return the `<name>` segment so the row
 *  can label itself `读取 <name> 技能` instead of the generic
 *  `已读取 SKILL.md` (image #111 — codex's own UI shows the skill name,
 *  ours should too). Returns null if the path doesn't match. */
function detectSkillName(tool: ReturnType<typeof reduceTurn>["tools"][number]): string | null {
  // Match `/skills/[.system/]<name>/SKILL.md` — segment between
  // `skills[/.system]` and `/SKILL.md`. Anchored on `/` so a bogus
  // path containing the word "skills" elsewhere won't false-match.
  const SKILL_RE = /\/skills\/(?:\.system\/)?([^/]+)\/SKILL\.md(?:$|[?#])/i;
  for (const loc of tool.locations ?? []) {
    const m = loc.path?.match(SKILL_RE);
    if (m && m[1]) return m[1];
  }
  // codex-acp emits Read as an `execute` kind too — the path lives
  // inside rawInput.command (shell argv). Scan each arg.
  const ri = tool.rawInput as { command?: unknown } | null | undefined;
  if (ri && Array.isArray(ri.command)) {
    for (const arg of ri.command) {
      if (typeof arg === "string") {
        const m = arg.match(SKILL_RE);
        if (m && m[1]) return m[1];
      }
    }
  }
  return null;
}

/** Title-case a skill identifier for display. Skills are conventionally
 *  lowercase snake_case (`imagegen`, `web_research`) — the codex UI
 *  capitalizes the first letter only (image #111: `Imagegen`). */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Pick a lucide icon for a tool based on its ACP `kind`. The kind set
 *  is open (agents can invent their own) so this is a best-effort
 *  table — unknown kinds fall back to a generic wrench. */
function pickToolIcon(kind?: string): typeof FileTextIcon {
  switch (kind) {
    case "read":
      return FileTextIcon;
    case "edit":
      return FileEditIcon;
    case "search":
    case "grep":
      return SearchIcon;
    case "execute":
    case "terminal":
      return TerminalIcon;
    case "fetch":
    case "web":
      return GlobeIcon;
    case "think":
      return BrainIcon;
    case "list":
    case "tree":
      return FolderTreeIcon;
    default:
      return WrenchIcon;
  }
}

/** Pull a single line of "what just happened" out of the tool's content
 *  for the collapsed summary row. Priority: first diff path → first
 *  text content's first line → first location path. Falls back to null
 *  (the row just shows the title). */
function pickContentPeek(
  tool: ReturnType<typeof reduceTurn>["tools"][number],
): string | null {
  const blocks = tool.content;
  if (blocks?.length) {
    for (const b of blocks) {
      if (b.type === "diff" && b.path) return shortPath(b.path);
      if (b.type === "content" && b.content?.type === "text" && b.content.text) {
        const first = b.content.text.split(/\r?\n/, 1)[0]!.trim();
        if (first) return first;
      }
      if (b.type === "terminal") return "terminal output";
    }
  }
  if (tool.locations?.length && tool.locations[0]?.path) {
    return shortPath(tool.locations[0].path);
  }
  return null;
}

/** Renders one ACP tool content block. Three shapes: diff, terminal,
 *  generic content (text/image/uri). Each is intentionally minimal —
 *  the goal is "user can tell what happened without leaving the chat",
 *  not a full IDE diff viewer. */
function ToolContentRenderer({ block }: { block: ToolContentBlock }) {
  if (block.type === "diff") {
    return <DiffBlock path={block.path} oldText={block.oldText} newText={block.newText} />;
  }
  if (block.type === "terminal") {
    return (
      <div className="flex items-center gap-2 rounded bg-bg/70 px-2 py-1 text-fg-muted">
        <TerminalIcon className="size-3 text-fg-subtle" />
        <span className="font-mono text-[11px]">
          terminal {block.terminalId ?? ""}
        </span>
      </div>
    );
  }
  const c = block.content;
  if (!c) return null;
  if (c.type === "text" && c.text) {
    return (
      <pre className="overflow-x-auto rounded bg-bg/70 p-2 font-mono whitespace-pre-wrap">
        {c.text}
      </pre>
    );
  }
  if (c.type === "image") {
    // codex-acp 0.15.0 sends image content with both a uri (abs file
    // path on disk under ~/.codex/generated_images/) and the full
    // base64-encoded bytes. We must NOT use `<img src="file:///...">`
    // — the renderer's origin is http://localhost:5173 (dev) or
    // file://app/index.html (prod), and the browser refuses
    // cross-origin file:// loads (SecurityError).
    //
    // Route through `oma-file://`, a privileged custom protocol the
    // main process serves via streamed net.fetch from the on-disk
    // file. Important: the URL form is `oma-file://local/<abs-path>`
    // — a synthetic "local" host. Three slashes (`oma-file:///Users/`)
    // makes Electron parse the path's first segment as the hostname
    // (image #105 follow-up: the image silently never loaded because
    // hostname=Users, pathname=/minimax/... and the handler's
    // pathname-only check rejected it). The "local" host gives a
    // stable, ignored hostname so the entire abs path lives in
    // pathname where the handler expects it.
    //
    // Base64 data: URL is the fallback for paths outside the
    // allow-list roots — slow + memory-heavy for multi-MB PNGs, but
    // always works.
    const src = c.uri
      ? "oma-file://local" + encodeURI(c.uri)
      : c.data && c.mimeType
        ? `data:${c.mimeType};base64,${c.data}`
        : null;
    if (src) {
      return (
        <img
          src={src}
          alt=""
          className={CHAT_GENERATED_IMAGE_CLASS}
        />
      );
    }
  }
  if (c.uri) {
    return (
      <a
        href={c.uri}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-fg-muted underline-offset-2 hover:underline"
      >
        <GlobeIcon className="size-3" />
        {c.uri}
      </a>
    );
  }
  return null;
}

/** Tiny unified-diff renderer. Splits old/new on newlines and prints
 *  `-`/`+` rows tinted danger/success. No LCS — agents always send the
 *  whole region, so this is just two stacked blocks visually. Good
 *  enough for the common "rewrite of 5–30 lines" case; long diffs scroll
 *  in their own scroll container. */
function DiffBlock({
  path,
  oldText,
  newText,
}: {
  path?: string;
  oldText?: string;
  newText?: string;
}) {
  const oldLines = (oldText ?? "").split(/\r?\n/);
  const newLines = (newText ?? "").split(/\r?\n/);
  return (
    <div className="overflow-hidden rounded border border-border/40">
      {path && (
        <div className="border-b border-border/40 bg-bg/60 px-2 py-1 font-mono text-[11px] text-fg-muted">
          {path}
        </div>
      )}
      <div className="max-h-[260px] overflow-y-auto font-mono text-[11px]">
        {oldLines.map((l, i) => (
          <div key={`o-${i}`} className="flex bg-danger-subtle/40 text-danger">
            <span className="w-5 shrink-0 select-none px-1 text-right opacity-60">-</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
              {l || " "}
            </span>
          </div>
        ))}
        {newLines.map((l, i) => (
          <div key={`n-${i}`} className="flex bg-success-subtle/40 text-success">
            <span className="w-5 shrink-0 select-none px-1 text-right opacity-60">+</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
              {l || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compress a long absolute path to its last two segments. Hover shows
 *  the full path via the `title` attribute. */
function shortPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

function Composer({
  sessionAgentId,
  disabled,
  running,
  placeholder,
  availableCommands,
  pendingAsk,
  lockedAgentId,
  pickedAgentId,
  pickedModelProfileId,
  onPickAgent,
  onPickModelProfile,
  onResolveAsk,
  onSubmit,
  onCancel,
}: {
  sessionAgentId?: string;
  disabled: boolean;
  running: boolean | undefined;
  placeholder: string;
  availableCommands?: AcpAvailableCommand[];
  pendingAsk?: BrokerAsk;
  lockedAgentId: string | null;
  pickedAgentId: string | null;
  pickedModelProfileId: string;
  onPickAgent: (agentId: string) => void;
  onPickModelProfile: (profileId: string) => void;
  onResolveAsk?: (optionId: string | null, approve?: boolean) => void | Promise<void>;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const settings = useSettings();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.backchat.agentsList(),
    staleTime: 60_000,
  });
  const detectedAgents = agents.filter((a) => a.detected);
  const agentLocked = isComposerAgentLocked(sessionAgentId);
  const resolvedDefaultAgentId = resolveComposerAgentId({
    sessionAgentId,
    defaultAgentId: settings?.default.agent_id,
  });
  const currentAgentId =
    lockedAgentId ||
    pickedAgentId ||
    resolvedDefaultAgentId ||
    detectedAgents[0]?.id ||
    "";
  const currentAgent = agents.find((a) => a.id === currentAgentId);
  const modelProfiles = useMemo(
    () => modelProfilesForAgent(currentAgentId),
    [currentAgentId],
  );
  const currentModelProfile =
    modelProfiles.find((profile) => profile.id === pickedModelProfileId) ??
    modelProfiles[0] ??
    ACP_MODEL_PROFILE_CATALOG[0]!;

  useEffect(() => {
    if (modelProfiles.some((profile) => profile.id === pickedModelProfileId)) return;
    onPickModelProfile(DEFAULT_ACP_MODEL_PROFILE_ID);
  }, [modelProfiles, onPickModelProfile, pickedModelProfileId]);

  const pickAgent = (id: string) => {
    onPickAgent(id);
    const nextProfiles = modelProfilesForAgent(id);
    if (!nextProfiles.some((profile) => profile.id === pickedModelProfileId)) {
      onPickModelProfile(DEFAULT_ACP_MODEL_PROFILE_ID);
    }
  };

  useEffect(() => {
    if (!disabled && !running) taRef.current?.focus();
  }, [disabled, running]);

  // Slash command picker. Active when the textarea contents are a
  // single `/foo`-shaped token with no whitespace yet — once the user
  // types a space, they're providing the command's argument and the
  // picker steps out of the way. Filtering is case-insensitive prefix
  // match against `command.name`.
  const slashQuery = useSlashQuery(text);
  const filteredCommands = useMemo(() => {
    if (slashQuery == null || !availableCommands?.length) return null;
    const q = slashQuery.toLowerCase();
    return availableCommands.filter((c) => c.name.toLowerCase().startsWith(q));
  }, [slashQuery, availableCommands]);
  const showPicker = !!filteredCommands && filteredCommands.length > 0;
  const [pickerIndex, setPickerIndex] = useState(0);
  useEffect(() => {
    // Reset cursor whenever the candidate list changes shape — without
    // this the highlighted row can land outside `filteredCommands` and
    // Enter inserts an undefined command.
    setPickerIndex(0);
  }, [slashQuery, filteredCommands?.length]);

  const applyCommand = (cmd: AcpAvailableCommand) => {
    // Replace whatever `/foo` token the user was typing with `/name `
    // (trailing space) so the next keystroke goes into the argument.
    // If the command takes no argument, the trailing space is harmless
    // — agents trim it.
    setText(`/${cmd.name} `);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  return (
    <div
      className={cn(
        // Liquid-glass material — matches sidebar / side-chat rail /
        // side-chat composer. Three of the four floating cards in this
        // shell are liquid-glass; making the main composer match keeps
        // the chrome coherent. (The bottom terminal panel is the one
        // exception — it's a plain white card because xterm-addon-webgl
        // can't render onto a transparent backdrop. See AppShell.tsx
        // comment on that panel for the full rationale.)
        //
        // `composer-card` overrides .liquid-glass's 16/40 px far drop
        // shadow — that shadow lands on the stage gap between this
        // composer and the bottom terminal panel and reads as a
        // visible horizontal band (image #12). Inset rims (the glass
        // tells) are preserved.
        "relative flex flex-col gap-2 rounded-2xl px-3 py-3 liquid-glass composer-card",
        "transition-shadow",
      )}
    >
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Slash picker has first dibs on arrow / enter / escape. Only
          // when the picker is open AND has at least one match — a stale
          // "/" with no candidates falls through so the user can still
          // submit it as literal text if they want.
          if (showPicker && filteredCommands) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPickerIndex((i) => (i + 1) % filteredCommands.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setPickerIndex(
                (i) => (i - 1 + filteredCommands.length) % filteredCommands.length,
              );
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              const cmd = filteredCommands[pickerIndex];
              if (cmd) {
                e.preventDefault();
                applyCommand(cmd);
                return;
              }
            }
            if (e.key === "Tab") {
              const cmd = filteredCommands[pickerIndex];
              if (cmd) {
                e.preventDefault();
                applyCommand(cmd);
                return;
              }
            }
            if (e.key === "Escape") {
              e.preventDefault();
              // Cheapest dismiss — append a space so slashQuery() returns
              // null next render. Caret stays at end.
              setText((t) => `${t} `);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const t = text.trim();
            if (!t || disabled || running) return;
            onSubmit(t);
            setText("");
          }
        }}
        placeholder={placeholder}
        disabled={disabled || !!running}
        rows={1}
        className={cn(
          // Bigger min-h so the empty composer has presence (Codex / Claude
          // Desktop both run ~3 lines of breathing in the textarea row).
          "min-h-[60px] max-h-[240px] w-full resize-none bg-transparent px-1 text-sm leading-7 text-fg outline-none",
          "placeholder:text-fg-subtle",
          "[field-sizing:content]",
        )}
      />

      {/* Pending permission / fs-write ask — floats above the composer's
          top edge, exact same anchor as the slash picker. The two are
          mutually exclusive in practice (an ask blocks the agent so
          there's nothing the user could be /-typing about), but if
          they ever collide the ask wins for safety. */}
      {pendingAsk && onResolveAsk && (
        <InlineAskPanel ask={pendingAsk} onResolve={onResolveAsk} />
      )}

      {/* Slash command picker — floats above the composer's top edge.
          Only renders when the textarea contents are a `/`-prefixed
          token and the agent has declared `availableCommands` via ACP.
          Keyboard nav is wired into the textarea's onKeyDown above; this
          surface is mouse-only fallback. */}
      {!pendingAsk && showPicker && filteredCommands && (
        <div
          className={cn(
            "absolute left-3 right-3 bottom-full mb-2 z-30",
            "rounded-xl border border-border/60 bg-bg-surface/95 backdrop-blur",
            "shadow-lg",
            "max-h-[260px] overflow-y-auto p-1",
          )}
          role="listbox"
          aria-label="Slash commands"
        >
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={i === pickerIndex}
              onMouseEnter={() => setPickerIndex(i)}
              onClick={() => applyCommand(cmd)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                i === pickerIndex
                  ? "bg-bg text-fg"
                  : "text-fg-muted hover:bg-bg/60",
              )}
            >
              <SlashIcon className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-fg">{cmd.name}</span>
                  {cmd.input?.hint && (
                    <span className="text-[11px] text-fg-subtle">
                      {cmd.input.hint}
                    </span>
                  )}
                </div>
                {cmd.description && (
                  <div className="mt-0.5 truncate text-[11px] text-fg-subtle">
                    {cmd.description}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Attach (coming soon)"
            disabled
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
              "text-fg-muted opacity-60 cursor-not-allowed",
            )}
          >
            <PlusIcon className="size-4" />
          </button>
          <PermissionModeChip disabled={!!running} />
        </div>

        <div className="flex items-center gap-2">
          <SessionRunChip
            disabled={!!running}
            locked={!!lockedAgentId || agentLocked}
            agents={detectedAgents}
            currentAgentId={currentAgentId}
            currentAgentLabel={currentAgent?.label}
            modelProfiles={modelProfiles}
            currentModelProfileId={currentModelProfile.id}
            currentModelProfileLabel={currentModelProfile.label}
            onPickAgent={pickAgent}
            onPickModelProfile={onPickModelProfile}
          />

          {running ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop"
              title="Stop"
              className={cn(
                "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2",
                "text-fg-subtle hover:text-fg hover:bg-bg-surface",
                "transition-colors",
              )}
            >
              <SquareIcon className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const t = text.trim();
                if (!t) return;
                onSubmit(t);
                setText("");
              }}
              disabled={disabled || !text.trim()}
              aria-label="Send (Enter)"
              title="Send (↵)"
              className={cn(
                "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2",
                "text-fg-subtle hover:text-fg hover:bg-bg-surface",
                "disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40",
                "transition-colors",
              )}
            >
              <CornerDownLeftIcon className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionRunChip({
  disabled,
  locked,
  agents,
  currentAgentId,
  currentAgentLabel,
  modelProfiles,
  currentModelProfileId,
  currentModelProfileLabel,
  onPickAgent,
  onPickModelProfile,
}: {
  disabled: boolean;
  locked: boolean;
  agents: AgentOption[];
  currentAgentId: string;
  currentAgentLabel?: string;
  modelProfiles: AcpModelProfile[];
  currentModelProfileId: string;
  currentModelProfileLabel: string;
  onPickAgent: (agentId: string) => void;
  onPickModelProfile: (profileId: string) => void;
}) {
  const agentLabel = currentAgentLabel || (currentAgentId ? currentAgentId : "Choose agent");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex max-w-[280px] items-center gap-1 rounded-md px-2 text-xs text-fg-muted",
          "hover:bg-bg-surface/60 hover:text-fg",
          "focus:outline-none focus:bg-bg-surface/60",
          "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        style={{ height: "32px" }}
        aria-label={`Run on Local with ${agentLabel} using ${currentModelProfileLabel}`}
      >
        <MonitorIcon className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="shrink-0">Local</span>
        <span className="text-fg-subtle">·</span>
        <span className="truncate">{agentLabel}</span>
        <span className="text-fg-subtle">·</span>
        <span className="shrink-0">{currentModelProfileLabel}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[280px]">
        <SessionRunSection title="Runtime">
          <SessionRunItem
            icon={MonitorIcon}
            label="Local"
            hint="This machine"
            active
            onSelect={() => undefined}
          />
          <SessionRunItem
            icon={CloudIcon}
            label="Cloud"
            hint="Coming later"
            disabled
            onSelect={() => undefined}
          />
          <SessionRunItem
            icon={GlobeIcon}
            label="Other machine"
            hint="Not connected"
            disabled
            onSelect={() => undefined}
          />
        </SessionRunSection>

        <SessionRunSection title="Harness">
          {agents.length > 0 ? (
            agents.map((agent) => (
              <SessionRunItem
                key={agent.id}
                agentId={agent.id}
                label={agent.label}
                hint={agent.command}
                active={agent.id === currentAgentId}
                disabled={locked}
                onSelect={() => onPickAgent(agent.id)}
              />
            ))
          ) : (
            <SessionRunItem
              icon={TerminalIcon}
              label="No harness detected"
              hint="Install an ACP agent first"
              disabled
              onSelect={() => undefined}
            />
          )}
        </SessionRunSection>

        <SessionRunSection title="Model">
          {modelProfiles.map((profile) => (
            <SessionRunItem
              key={profile.id}
              icon={BrainIcon}
              label={profile.label}
              hint={profile.hint}
              active={profile.id === currentModelProfileId}
              disabled={locked}
              onSelect={() => onPickModelProfile(profile.id)}
            />
          ))}
        </SessionRunSection>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRunSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border/50 py-1 last:border-b-0">
      <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SessionRunItem({
  icon: Icon,
  agentId,
  label,
  hint,
  active,
  disabled,
  onSelect,
}: {
  icon?: typeof MonitorIcon;
  agentId?: string;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex items-start gap-2 px-2 py-1.5 text-xs",
        active && "text-fg",
      )}
    >
      {agentId ? (
        <AgentIcon agentId={agentId} className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
      ) : Icon ? (
        <Icon className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && (
          <span className="block truncate text-[11px] text-fg-subtle">{hint}</span>
        )}
      </span>
      {active && <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />}
    </DropdownMenuItem>
  );
}

/** Project / runtime / branch chip row — codex-style strip BELOW the
 *  composer card. Three chips:
 *
 *   1. Project chip — current workspace folder. Dropdown lists recent
 *      workspaces (deduped from persisted session cwds), a Browse... entry
 *      (native dir picker), and a None entry (clear).
 *   2. Runtime chip — "Local" for now. Dropdown holds a disabled "Cloud"
 *      entry as a placeholder until hosted execution lands.
 *   3. Branch chip — git branch for the workspace, read from .git/HEAD.
 *      Hidden when the dir isn't a repo or HEAD is detached.
 *
 *  On a draft session every chip is interactive (you can still change
 *  the workspace before the ACP child spawns). Once the session goes
 *  past `ready`, the cwd is locked into the spawned process — chips
 *  become read-only labels. */
function ProjectChipRow({
  isDraft,
  activeCwd,
  onPickCwd,
  onSetCwd,
  onClearCwd,
}: {
  isDraft: boolean;
  /** Path to display. For a draft session this is the user's pending
   *  pickedCwd. For a live session it's `active.cwd` from SessionRow,
   *  which was filled in by session.ready. */
  activeCwd: string;
  onPickCwd: () => void | Promise<void>;
  onSetCwd: (p: string) => void;
  onClearCwd: () => void;
}) {
  // Recent workspaces — dedupe by absolute path, keep most-recent-first
  // ordering implicit in sessionsList's sort.
  const { data: persisted = [] } = useQuery({
    queryKey: ["sessions-for-recent-cwds"],
    queryFn: () => window.backchat.sessionsList(50),
    staleTime: 30_000,
  });
  const recents = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of persisted) {
      const cwd = r.cwd?.trim();
      if (!cwd || seen.has(cwd)) continue;
      seen.add(cwd);
      out.push(cwd);
      if (out.length >= 8) break;
    }
    return out;
  }, [persisted]);

  // Live git branch for the current cwd. The IPC is cheap (one file read)
  // so we leave staleTime short — switching cwd should refresh promptly.
  const { data: branch } = useQuery({
    queryKey: ["git-branch", activeCwd],
    queryFn: () =>
      activeCwd
        ? window.backchat.uiFsGitBranch({ path: activeCwd })
        : Promise.resolve(null),
    enabled: !!activeCwd,
    staleTime: 10_000,
  });

  const cwdLabel = activeCwd ? shortPath(activeCwd) : "Choose project";

  return (
    <div className="flex items-center gap-2 px-3 text-xs text-fg-muted">
      {/* Project */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!isDraft}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1",
            "hover:bg-bg-surface/60 focus:outline-none focus:bg-bg-surface/60",
            "transition-colors disabled:cursor-default disabled:hover:bg-transparent",
          )}
          title={activeCwd || "Choose a project folder"}
        >
          <FolderOpenIcon className="size-3.5" />
          <span className="max-w-[200px] truncate">{cwdLabel}</span>
          {isDraft && <ChevronDownIcon className="size-3 opacity-60" />}
        </DropdownMenuTrigger>
        {isDraft && (
          <DropdownMenuContent align="start" sideOffset={6} className="min-w-[260px]">
            {recents.length > 0 && (
              <>
                {recents.map((p) => (
                  <DropdownMenuItem
                    key={p}
                    onSelect={() => onSetCwd(p)}
                    className="flex items-center gap-2 text-xs"
                    title={p}
                  >
                    <FolderOpenIcon className="size-3.5 text-fg-subtle" />
                    <span className="flex-1 truncate">{shortPath(p)}</span>
                    {p === activeCwd && (
                      <CheckIcon className="size-3.5 text-fg-muted" />
                    )}
                  </DropdownMenuItem>
                ))}
                <div className="my-1 h-px bg-border/60" />
              </>
            )}
            <DropdownMenuItem
              onSelect={() => void onPickCwd()}
              className="flex items-center gap-2 text-xs"
            >
              <FolderOpenIcon className="size-3.5 text-fg-subtle" />
              <span>Browse…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onClearCwd}
              className="flex items-center gap-2 text-xs"
            >
              <XIcon className="size-3.5 text-fg-subtle" />
              <span>No project — use a per-chat folder</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      {/* Runtime — Local only for now; Cloud is a placeholder until
          hosted execution lands. Always interactive (even on live
          sessions) — but selecting Cloud is a no-op today. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1",
            "hover:bg-bg-surface/60 focus:outline-none focus:bg-bg-surface/60",
            "transition-colors",
          )}
          title="Where this conversation runs"
        >
          <MonitorIcon className="size-3.5" />
          <span>Local</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-[220px]">
          <DropdownMenuItem className="flex items-center gap-2 text-xs">
            <MonitorIcon className="size-3.5 text-fg-subtle" />
            <span className="flex-1">Local</span>
            <CheckIcon className="size-3.5 text-fg-muted" />
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled
            className="flex items-start gap-2 text-xs opacity-60"
          >
            <CloudIcon className="mt-0.5 size-3.5 text-fg-subtle" />
            <div className="min-w-0 flex-1">
              <div>Cloud</div>
              <div className="text-[11px] text-fg-subtle">Coming soon</div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Branch — read-only label. Hidden when not a git repo / detached. */}
      {branch && (
        <span
          className="inline-flex items-center gap-1 rounded-md px-2 py-1"
          title={`Branch · ${branch}`}
        >
          <GitBranchIcon className="size-3.5" />
          <span className="max-w-[160px] truncate">{branch}</span>
        </span>
      )}
    </div>
  );
}

/** Floating ask panel — anchored above the composer's top edge,
 *  same coordinate system as the slash picker. One row of compact
 *  buttons; no modal scrim, no big preview. The minimal payload
 *  (tool kind + title for permission, path + size for fs write) sits
 *  in the header line so the user knows what they're approving without
 *  needing to scan a dialog. */
/** Bottom-sheet ask panel — anchored above the composer's top edge,
 *  full-width within the composer column, generous padding. Shape
 *  matches image #90: header (counter? + question), one card per
 *  option, footer with Skip + Submit (or just Cancel for single-tap
 *  flows). Used for both `permission` (allow_once / reject / etc.)
 *  and `fsWrite` (allow/deny) asks. Clicking an option resolves
 *  immediately — there's no "select then submit" step yet because
 *  current ACP asks are all single-choice. The Submit shape is kept
 *  in the layout so that when a future multi-select user-question ask
 *  lands it can drop in without a redesign. */
function InlineAskPanel({
  ask,
  onResolve,
}: {
  ask: BrokerAsk;
  onResolve: (optionId: string | null, approve?: boolean) => void | Promise<void>;
}) {
  // Esc as universal "dismiss / reject". For permission asks we pick
  // the first reject_* option (matches the visible "no" affordance);
  // for fsWrite we send approve=false.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (ask.kind === "permission") {
        const reject = ask.ask.options.find((o) => o.kind.startsWith("reject_"));
        void onResolve(reject?.optionId ?? ask.ask.options[0]?.optionId ?? null);
      } else {
        void onResolve(null, false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, onResolve]);

  if (ask.kind === "permission") {
    const a = ask.ask;
    const tool = a.toolCall as
      | { title?: string; kind?: string }
      | undefined;
    const title = tool?.title ?? "Approve this action?";
    return (
      <AskSheet
        title={title}
        meta={tool?.kind}
        onClose={() => {
          const reject = a.options.find((o) => o.kind.startsWith("reject_"));
          void onResolve(reject?.optionId ?? a.options[0]?.optionId ?? null);
        }}
      >
        {a.options.map((opt) => {
          const isPrimary = opt.kind === "allow_once" || opt.kind === "allow_always";
          const isDanger = opt.kind.startsWith("reject_");
          return (
            <AskOption
              key={opt.optionId}
              label={opt.name}
              tone={isPrimary ? "primary" : isDanger ? "danger" : "neutral"}
              onClick={() => void onResolve(opt.optionId)}
            />
          );
        })}
      </AskSheet>
    );
  }
  // fsWrite
  const a = ask.ask;
  return (
    <AskSheet
      title="Write outside workspace?"
      meta={a.path}
      footerMeta={`${a.byteSize}B`}
      onClose={() => void onResolve(null, false)}
    >
      <AskOption
        label="Allow this write"
        tone="primary"
        onClick={() => void onResolve(null, true)}
      />
      <AskOption
        label="Deny"
        tone="danger"
        onClick={() => void onResolve(null, false)}
      />
    </AskSheet>
  );
}

/** Shared chrome for ask sheets — header (title + optional meta), body
 *  slot for options, footer with close affordance. Anchors as an
 *  absolutely-positioned card above the composer (parent applies
 *  `relative`). Wrapped in role=dialog with aria-modal=false because
 *  it does NOT trap focus — typing into the composer textarea while a
 *  sheet is up is intentional (sometimes you want to draft the next
 *  prompt while reviewing). */
function AskSheet({
  title,
  meta,
  footerMeta,
  onClose,
  children,
}: {
  title: string;
  meta?: string;
  footerMeta?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute left-3 right-3 bottom-full mb-2 z-30",
        "rounded-2xl border border-border/60 bg-bg-surface/95 backdrop-blur",
        "shadow-xl",
        "flex flex-col",
        "max-h-[60vh]",
      )}
      role="dialog"
      aria-label={title}
    >
      {/* Header */}
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">{title}</div>
          {meta && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
              {meta}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-fg-subtle hover:bg-bg/60 hover:text-fg"
          aria-label="Dismiss"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {/* Options list */}
      <div className="flex flex-col gap-1 overflow-y-auto px-2 pb-2">
        {children}
      </div>
      {/* Footer (only when there's footer meta to show, e.g. byte size) */}
      {footerMeta && (
        <div className="border-t border-border/40 px-4 py-1.5 text-right text-[11px] text-fg-subtle">
          {footerMeta}
        </div>
      )}
    </div>
  );
}

/** Single option row inside an AskSheet. Three tones — primary (the
 *  "yes / approve / continue" path), danger (reject / deny), neutral
 *  (e.g. allow_always or other alternative approvals). One click
 *  resolves immediately; there's no separate Submit step for
 *  single-select ACP asks. The whole row is a button so the click
 *  target is generous (image #90 shows codex-style full-width rows). */
function AskOption({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "primary" | "danger" | "neutral";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
        "flex items-center justify-between gap-2",
        tone === "primary"
          ? "bg-bg/70 text-fg hover:bg-bg"
          : tone === "danger"
            ? "text-danger hover:bg-danger-subtle/40"
            : "text-fg-muted hover:bg-bg/60 hover:text-fg",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/** Permission-mode chip on the composer's left side. Three modes —
 *  ask / auto / read_only — written to settings.default.permission_mode.
 *  BrokerModal reads the same setting and auto-responds on the non-ask
 *  modes. The chip is the user-facing toggle for the gate; the modal
 *  remains as the fallback when "ask" is picked.
 *
 *  The "auto" mode shows a small warning glyph because it's the
 *  trust-the-agent path (matches Codex's amber warning on its full-
 *  access chip in image #3). */
function PermissionModeChip({ disabled }: { disabled: boolean }) {
  const settings = useSettings();
  const mode = settings?.default.permission_mode ?? "ask";

  const pick = async (next: "ask" | "auto" | "read_only") => {
    if (!settings) return;
    await window.backchat.settingsPatch({
      default: { ...settings.default, permission_mode: next },
    });
  };

  const meta = MODE_META[mode];
  const Icon = meta.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 text-xs",
          meta.toneClass,
          "hover:bg-bg-surface/60",
          "focus:outline-none focus:bg-bg-surface/60",
          "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        style={{ height: "32px" }}
        aria-label={`Permission mode: ${meta.label}`}
      >
        <Icon className="size-3.5" />
        <span>{meta.label}</span>
        <ChevronDownIcon className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[220px]">
        {(["auto", "ask", "read_only"] as const).map((m) => {
          const item = MODE_META[m];
          const ItemIcon = item.icon;
          return (
            <DropdownMenuItem
              key={m}
              onSelect={() => void pick(m)}
              className="flex items-start gap-2 text-xs"
            >
              <ItemIcon className={cn("mt-0.5 size-3.5 shrink-0", item.toneClass)} />
              <div className="min-w-0 flex-1">
                <div className={cn(m === mode && "text-fg")}>{item.label}</div>
                <div className="text-[11px] text-fg-subtle">{item.hint}</div>
              </div>
              {m === mode && <CheckIcon className="mt-0.5 size-3.5 text-fg-muted" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Icon + label + tone for each permission mode. Co-located so the
 *  trigger chip and the menu items share one source. */
const MODE_META: Record<
  "ask" | "auto" | "read_only",
  {
    icon: typeof ShieldAlertIcon;
    label: string;
    hint: string;
    /** Tailwind classes that tone the chip — auto picks up a warm hint
     *  so the trust-the-agent mode reads as a deliberate choice, not
     *  the boring default. */
    toneClass: string;
  }
> = {
  ask: {
    icon: ShieldAlertIcon,
    label: "Ask each time",
    hint: "Show a modal for every tool call.",
    toneClass: "text-fg-muted",
  },
  auto: {
    icon: ZapIcon,
    label: "Full access",
    hint: "Auto-approve every tool. Use with trusted agents.",
    toneClass: "text-warning",
  },
  read_only: {
    icon: EyeIcon,
    label: "Read-only",
    hint: "Auto-reject anything that writes.",
    toneClass: "text-fg-muted",
  },
};

/** Derive a sidebar label from the first prompt. Truncate at the first
 *  newline if any, then hard-cap at 40 chars + ellipsis. Empty prompts
 *  fall back to a short timestamp so the row at least has SOME identity
 *  — `(empty)` looks like an error string and a blank row vanishes. */
function deriveLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    const d = new Date();
    return `Chat · ${d.getHours().toString().padStart(2, "0")}:${d
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }
  const firstLine = trimmed.split(/\r?\n/)[0]!;
  if (firstLine.length <= 40) return firstLine;
  return firstLine.slice(0, 39).trimEnd() + "…";
}

/** Returns the slash-command query string if the composer text is a
 *  single `/foo` token (no leading whitespace, no internal whitespace
 *  yet), else null. `/` alone is a valid query (returns "") so the
 *  picker shows the full command catalog when the user first types it. */
function useSlashQuery(text: string): string | null {
  return useMemo(() => {
    if (!text.startsWith("/")) return null;
    // Match `/word` — the moment a space, newline, or tab appears the
    // user has committed past the command name into the argument.
    const m = /^\/([^\s]*)$/.exec(text);
    return m ? (m[1] ?? "") : null;
  }, [text]);
}

/** React context that supplies a base directory for resolving
 *  relative file links inside markdown. Agent output often contains
 *  bare paths like `[index.html](index.html)` that semantically
 *  reference *files in the session's cwd*, not URLs to be resolved
 *  against the renderer's origin. Wrap a subtree in
 *  `MarkdownCwdProvider value={cwd}` to make those links resolve to
 *  `<cwd>/<path>` and route to `uiFsOpenPath`. When null/absent,
 *  relative links render as inert spans. */
const MarkdownCwdContext = createContext<string | null>(null);

export function MarkdownCwdProvider({
  cwd,
  children,
}: {
  cwd: string | null | undefined;
  children: React.ReactNode;
}) {
  return (
    <MarkdownCwdContext.Provider value={cwd ?? null}>
      {children}
    </MarkdownCwdContext.Provider>
  );
}

/** Thin wrapper that hides Streamdown's awkward `children?: string`
 *  typing under TS 6 + React 19. Streamdown reads `children` at runtime
 *  to get the markdown source; we hand it the string via createElement to
 *  sidestep the JSX type intersection that TS can't reconcile.
 *
 *  Streamdown defaults render code blocks as **two stacked cards** — an
 *  outer `bg-sidebar` rounded container with a "lang + copy + download"
 *  header, and an inner `bg-background border` `<pre>`. User flagged the
 *  double border as 诡异 (image #89). We:
 *    • `controls.code=false` — kills the header chrome (copy/download/
 *      lang badge), so the outer card has nothing to anchor and collapses
 *      into the inner one.
 *    • `pre` override — strips the inner pre's own border/bg so what
 *      remains is one flat `bg-bg-surface` card with rounded corners.
 *    • `linkSafety=disabled` — kills the "Open external link?" modal
 *      that pops on every `<a>` click; the renderer already runs in a
 *      sandboxed Electron window where links go through our IPC.
 *  Inline `<code>` (backtick spans) still gets a subtle pill background. */
function StreamdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return createElement(
    Streamdown as unknown as React.ComponentType<{
      children: string;
      className?: string;
      controls?: { code?: boolean; table?: boolean; mermaid?: boolean };
      linkSafety?: boolean;
      components?: Record<string, React.ComponentType<unknown>>;
    }>,
    {
      className,
      children: text,
      controls: { code: false, table: false, mermaid: false },
      linkSafety: false,
      components: streamdownOverrides,
    },
  );
}

/** Component overrides that flatten Streamdown's default code-block
 *  visual into a single card. Default markup is:
 *    <div class="my-4 ... rounded-xl border bg-sidebar p-2">
 *      <pre class="overflow-x-auto rounded-md border bg-background p-4">
 *        <code class="language-ts">...</code>
 *      </pre>
 *    </div>
 *  We replace the inner pre so it has no border, no separate bg, and
 *  shrinks to flush against the outer container's padding — leaving one
 *  rounded surface that matches the rest of the message visual. */
const streamdownOverrides = {
  pre: ({
    className: _cls,
    children,
    ...rest
  }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      {...rest}
      className={cn(
        "my-2 overflow-x-auto rounded-lg border border-border/60 bg-bg-surface/60",
        "px-3 py-2 text-[12px] leading-5 font-mono",
      )}
    >
      {children}
    </pre>
  ),
  code: ({
    className,
    children,
    ...rest
  }: React.HTMLAttributes<HTMLElement>) => {
    // Block code (inside our overridden <pre>): pre wrapper sets the
    // border/padding, so we just render the raw <code> with no styling.
    if (className?.startsWith("language-")) {
      return (
        <code {...rest} className={className}>
          {children}
        </code>
      );
    }
    // Inline backtick code: subtle pill that reads inside flowing text.
    return (
      <code
        {...rest}
        className={cn(
          "rounded bg-bg-surface/70 px-[0.35em] py-[0.1em]",
          "font-mono text-[0.9em] text-fg",
        )}
      >
        {children}
      </code>
    );
  },
  a: MarkdownAnchor,
} as unknown as Record<string, React.ComponentType<unknown>>;

/** Markdown `<a>` override. Agent-emitted links can be one of three
 *  shapes; each routes differently so the renderer never navigates:
 *
 *    http(s)://...   → system browser (window.open → setWindowOpenHandler)
 *    file:// or /abs → uiFsOpenPath (OS default app)
 *    bare relative   → resolved against the surrounding
 *                      MarkdownCwdContext (typically the session's cwd)
 *                      and treated as a file path. Without a cwd in
 *                      scope, falls back to inert span so we don't
 *                      navigate to localhost:5174/<name>.
 *
 *  preventDefault on every click — Chromium's default for a clicked
 *  <a href> is to navigate the renderer, which would blow away React. */
function MarkdownAnchor({
  href,
  children,
  className: _cls,
  onClick: _onClick,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const cwd = useContext(MarkdownCwdContext);
  const url = (href ?? "").trim();
  const target = resolveLinkTarget(url, cwd);
  if (target.kind === "inert" || !url) {
    return (
      <span
        className="underline decoration-dotted underline-offset-2 text-fg"
        title="Bare relative path — no resolvable target"
      >
        {children}
      </span>
    );
  }
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (target.kind === "http") {
      window.open(target.url, "_blank", "noopener,noreferrer");
      return;
    }
    // HTML / HTM → render inline in the sidebar BrowserTab. Anything
    // else (images, pdfs, source files) → OS default app, since the
    // sidebar webview can technically render images/pdfs but the OS
    // app is usually a better experience for those, and we already
    // auto-open html into the sidebar elsewhere (see
    // session-store.#autoOpenHtml). Reusing the same code path here
    // means a manual click matches the auto-open behavior.
    if (/\.html?$/i.test(target.path)) {
      sessionStore.openSideTab(
        "browser",
        "file://" + target.path,
        target.path.split("/").pop() || target.path,
      );
      return;
    }
    window.backchat.uiFsOpenPath({ path: target.path }).then((err) => {
      // shell.openPath returns "" on success, an error string on failure.
      // Surface failures so silent "click did nothing" stops happening —
      // most common cause is the OS having no default app for the
      // extension (e.g. .md on a fresh install).
      console.log("[MarkdownAnchor] openPath", target.path, "err=", JSON.stringify(err));
      if (err) {
        toast.error("Couldn't open file", {
          description: `${target.path}\n\n${err}`,
        });
      }
    });
  };
  return (
    <a
      {...rest}
      href={url}
      onClick={onClick}
      className="text-fg underline underline-offset-2 hover:text-fg-muted"
    >
      {children}
    </a>
  );
}

/** Classify and resolve a link URL relative to a cwd. Returns:
 *    {kind:"http", url}      — open in system browser
 *    {kind:"file", path}     — abs path to send through uiFsOpenPath
 *    {kind:"inert"}          — render as non-clickable
 *
 *  Bare relative paths are resolved by simple `cwd + "/" + url` —
 *  enough for the common agent shapes (`index.html`, `out/foo.png`)
 *  without dragging in a path-resolution lib. `..` and absolute
 *  segments inside the relative aren't normalized; if the agent
 *  emits something exotic, uiFsOpenPath will fail and the user
 *  sees nothing happen, which is fine. */
function resolveLinkTarget(
  url: string,
  cwd: string | null,
):
  | { kind: "http"; url: string }
  | { kind: "file"; path: string }
  | { kind: "inert" } {
  if (!url) return { kind: "inert" };
  if (/^https?:\/\//i.test(url)) return { kind: "http", url };
  if (/^file:\/\//i.test(url)) return { kind: "file", path: url.slice(7) };
  if (url.startsWith("/")) return { kind: "file", path: url };
  if (url.startsWith("#") || url.startsWith("?") || url.startsWith("mailto:")) {
    return { kind: "inert" };
  }
  // Strip a leading `./` so `cwd + "/" + url` doesn't double-up the
  // separator. `../` is intentionally NOT normalized — uiFsOpenPath
  // forwards to shell.openPath which resolves it natively.
  const rel = url.replace(/^\.\//, "");
  if (cwd) return { kind: "file", path: cwd.replace(/\/$/, "") + "/" + rel };
  return { kind: "inert" };
}
