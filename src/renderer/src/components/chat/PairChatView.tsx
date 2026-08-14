/**
 * PairChatView — multi-agent grid chat.
 *
 * Each pair member is rendered as a column. The user types ONCE in
 * the bottom composer; the prompt fans out to every member via the
 * normal sessionPrompt API. Each column reuses the existing TurnBlock renderer to
 * stream that member's events independently.
 *
 * The grid scales:
 *   - 2 members → 2 columns side-by-side
 *   - 3-4 members → 2x2 grid (third / fourth row wrap)
 *
 * Composer locks while any member is still streaming the current
 * turn — keyed off `PairRow.activeTurnId` which only clears once
 * every member completes.
 */

import { useEffect, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import type {
  PromptAttachment,
  PromptSessionReference,
} from "@shared/session-events.js";
import { Composer } from "./ChatView";
import { MarkdownCwdProvider } from "./ChatMarkdown";
import { TurnBlock } from "./ChatTurn";
import { cn } from "@/lib/utils";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  sessionStore,
  useSessionStore,
  selectTurnsFor,
  type SessionStore,
  type SessionRow,
  type PairRow,
} from "@/lib/session-store";
import {
  CHAT_COMPOSER_FRAME_CLASS,
  CHAT_TURN_FRAME_CLASS,
} from "@/lib/chat-layout";

const PAIR_HISTORY_LOADED = new Set<string>();
const PAIR_PREWARMED = new Set<string>();

export function PairChatView() {
  const params = useParams({ strict: false }) as { pairId?: string };
  const pair = useSessionStore((s) => (params.pairId ? s.pair(params.pairId) : null));
  const members = useSessionStore(
    useMemo(
      () => (st: ReturnType<typeof useSessionStore<unknown>> extends never ? never : any) => {
        if (!pair) return [] as SessionRow[];
        return pair.members
          .map((sid) => st.get(sid))
          .filter((s: SessionRow | null): s is SessionRow => !!s);
      },
      [pair?.id, pair?.members.join("|")],
    ),
  );
  const memberLifecycleKey = members
    .map((m) => `${m.id}:${m.status}:${m.acp_session_id}:${m.activeTurnId ?? ""}`)
    .join("|");

  useEffect(() => {
    if (typeof window === "undefined") return;
    for (const m of members) {
      if (!PAIR_HISTORY_LOADED.has(m.id)) {
        PAIR_HISTORY_LOADED.add(m.id);
        void window.backchat
          .sessionsLoadHistory(m.id)
          .then((rows) => sessionStore.replayHistory(m.id, rows));
      }
      if (
        !PAIR_PREWARMED.has(m.id) &&
        m.status === "ready" &&
        !m.activeTurnId &&
        m.acp_session_id
      ) {
        PAIR_PREWARMED.add(m.id);
        void window.backchat.sessionStart({
          session_id: m.id,
          agent_id: m.agent_id,
          cwd: m.cwd || undefined,
          resume: { acp_session_id: m.acp_session_id },
        });
      }
    }
  }, [memberLifecycleKey, members]);

  if (!pair) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        Pair not found.
      </div>
    );
  }

  const columnCount = pair.members.length;
  const gridClass =
    columnCount <= 2
      ? "grid-cols-2"
      : columnCount <= 4
        ? "grid-cols-2 grid-rows-2"
        : "grid-cols-3";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("grid min-h-0 flex-1", gridClass)}>
        {members.map((m, index) => (
          <PairColumn
            key={m.id}
            session={m}
            showLeftDivider={index > 0}
          />
        ))}
        {members.length === 0 && (
          <div className="col-span-full flex items-center justify-center text-sm text-fg-muted">
            Starting pair members…
          </div>
        )}
      </div>
      <PairComposer pair={pair} />
    </div>
  );
}

/** One column of the pair grid. Reuses the ordinary chat transcript
 *  surface; the AppShell topbar owns the pane logo marks. */
function PairColumn({
  session,
  showLeftDivider,
}: {
  session: SessionRow;
  showLeftDivider: boolean;
}) {
  const turns = useSessionStore(
    useMemo(() => selectTurnsFor(session.id), [session.id]),
  );

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        showLeftDivider && "border-l border-border/60",
      )}
      aria-label="Pair chat pane"
    >
      <Conversation key={session.id} className="min-h-0 flex-1">
        <ConversationContent
          className={cn(
            "w-full px-0 py-6",
            "flex min-h-full flex-col",
          )}
        >
          <MarkdownCwdProvider cwd={session.cwd}>
            <div className={CHAT_TURN_FRAME_CLASS} data-chat-column="turns">
              {turns.length === 0 && session.status !== "running" && (
                <div className="flex min-h-[160px] items-center justify-center text-[12px] text-fg-subtle">
                  尚无消息
                </div>
              )}
              {turns.map((t) => (
                <TurnBlock key={t.id} turn={t} />
              ))}
            </div>
          </MarkdownCwdProvider>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </section>
  );
}

/** Shared composer that fans out a prompt to every member of a pair.
 *  Locked while any member is still streaming the current turn. */
function PairComposer({ pair }: { pair: PairRow }) {
  const locked = !!pair.activeTurnId;
  const members = pair.members
    .map((sid) => sessionStore.get(sid))
    .filter((s): s is SessionRow => !!s);
  const memberCount = members.length || pair.members.length;
  const disabled = members.some(
    (m) => m.status === "starting" || m.status === "errored",
  );

  const submit = async (
    text: string,
    attachments: PromptAttachment[] = [],
    sessionReferences: PromptSessionReference[] = [],
  ) => {
    const displayText = derivePairPromptDisplayText(text, attachments, sessionReferences.length);
    if (!displayText || locked) return;
    await submitPairPrompt({
      store: sessionStore,
      pair,
      members,
      text,
      displayText,
      attachments,
      sessionReferences,
      sessionStart: window.backchat.sessionStart,
      sessionPrompt: window.backchat.sessionPrompt,
    });
  };

  return (
    <div
      data-chat-column="composer"
      className={cn(CHAT_COMPOSER_FRAME_CLASS, "space-y-2 pb-4")}
    >
      <Composer
        agentPickerLabel={`${memberCount} agents`}
        agentPickerAgentIds={members.map((m) => m.agent_id)}
        disabled={disabled}
        running={locked}
        lockedAgentId={null}
        pickedAgentId={null}
        onPickAgent={() => {}}
        placeholder={
          locked ? "等所有 agent 完成…" : `同时发送给 ${memberCount} 个 agent…`
        }
        attachmentDefaultPath={members.find((m) => m.cwd)?.cwd}
        onSubmit={(
          text,
          attachments,
          _intent,
          _configOverrides,
          _selectedAgentId,
          _annotations,
          sessionReferences,
        ) => void submit(text, attachments, sessionReferences)}
        onCancel={() => {
          if (!pair.memberTurnIds) return;
          for (const [session_id, turn_id] of Object.entries(pair.memberTurnIds)) {
            void window.backchat.sessionCancel({ session_id, turn_id });
          }
        }}
      />
    </div>
  );
}

export async function submitPairPrompt({
  store,
  pair,
  members,
  text,
  displayText,
  attachments,
  sessionReferences,
  sessionStart,
  sessionPrompt,
}: {
  store: SessionStore;
  pair: PairRow;
  members: SessionRow[];
  text: string;
  displayText: string;
  attachments: PromptAttachment[];
  sessionReferences: PromptSessionReference[];
  sessionStart: typeof window.backchat.sessionStart;
  sessionPrompt: typeof window.backchat.sessionPrompt;
}): Promise<void> {
  // Register first so both panes paint the user bubble in the same tick as
  // submit, even when cold-starting an ACP process takes several seconds.
  const targets = store.registerPairTurn(
    pair.id,
    displayText,
    sessionReferences,
    attachments,
  );
  if (!targets) return;
  const failedSessionIds = new Set<string>();

  for (const member of members) {
    if (member.status === "draft") {
      store.promoteDraft(member.id, member.agent_id, member.label);
    }
    if (
      member.status !== "draft"
      && (member.status !== "ready" || member.activeTurnId)
    ) {
      continue;
    }
    const startResult = await sessionStart({
      session_id: member.id,
      agent_id: member.agent_id,
      workspace_mode: member.status === "draft" ? "managed" : undefined,
      cwd: member.cwd || undefined,
      resume: member.acp_session_id
        ? { acp_session_id: member.acp_session_id }
        : undefined,
    });
    if (startResult.status !== "ready") {
      const target = targets.find(({ session_id }) => session_id === member.id);
      if (target) {
        failedSessionIds.add(member.id);
        store.apply({
          type: "session.error",
          session_id: member.id,
          turn_id: target.turn_id,
          message: startResult.status === "error"
            ? startResult.message
            : "Session start cancelled",
        });
      }
    }
  }

  await Promise.allSettled(
    targets
      .filter((target) => !failedSessionIds.has(target.session_id))
      .map((target) =>
        sessionPrompt({
          session_id: target.session_id,
          turn_id: target.turn_id,
          text,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(sessionReferences.length > 0
            ? { session_references: sessionReferences }
            : {}),
        })),
  );
}

function derivePairPromptDisplayText(
  text: string,
  attachments: PromptAttachment[],
  sessionReferenceCount = 0,
): string {
  if (!text.trim() && attachments.length === 0 && sessionReferenceCount > 0) {
    return sessionReferenceCount === 1
      ? "[1 referenced session]"
      : `[${sessionReferenceCount} referenced sessions]`;
  }
  if (attachments.length === 0) return text.trim();
  if (text.trim().length > 0) return text;
  if (attachments.length === 1) {
    const a = attachments[0]!;
    return `[Attached ${a.kind}: ${a.name}]`;
  }
  const names = attachments.map((a) => a.name).join(", ");
  return `[Attached ${attachments.length} files: ${names}]`;
}
